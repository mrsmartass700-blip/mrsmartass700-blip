--!nocheck
-- Offline unit tests, run with Lune from the project root:
--   lune run tests/run
--
-- Loads the real game modules into Lune's Roblox instance model, so every
-- property the map / ghost builders set is validated against Roblox's API.

local fs = require("@lune/fs")
local luau = require("@lune/luau")
local process = require("@lune/process")
local roblox = require("@lune/roblox")

local Loader = require("./lib/Loader")

local game = roblox.Instance.new("DataModel")
local workspace = game:GetService("Workspace")
local Vector3 = roblox.Vector3
local Random = require("./lib/Random")

local loader = Loader.new(game)
local load = loader.require
local shared = loader.mount(game:GetService("ReplicatedStorage"), "Shared", "src/shared")
local server = loader.mount(game:GetService("ServerScriptService"), "Server", "src/server")

-- Tiny test framework --------------------------------------------------------
local passed, failed = 0, 0
local function test(name: string, fn: () -> ())
	local ok, err = pcall(fn)
	if ok then
		passed += 1
		print("  ✓ " .. name)
	else
		failed += 1
		print("  ✗ " .. name .. "\n      " .. tostring(err))
	end
end
local function expect(condition: any, message: string?)
	if not condition then
		error(message or "expectation failed", 2)
	end
end
local function near(a: number, b: number, epsilon: number?): boolean
	return math.abs(a - b) <= (epsilon or 1e-6)
end

-- 1. Every source file compiles ---------------------------------------------
print("Compile")
for _, directory in { "src/shared", "src/server", "src/client" } do
	for _, file in fs.readDir(directory) do
		test(directory .. "/" .. file, function()
			luau.compile(fs.readFile(directory .. "/" .. file))
		end)
	end
end

local Config = load(shared.Config)
local Format = load(shared.Format)
local Formulas = load(shared.Formulas)
local Odds = load(shared.Odds)
local GhostFactory = load(shared.GhostFactory)

-- 2. Config sanity ---------------------------------------------------------
print("Config")
test("every rarity has at least one ghost", function()
	for index, rarity in Config.Rarities do
		local found = false
		for _, ghost in Config.Ghosts do
			found = found or ghost.Rarity == index
		end
		expect(found, rarity.Name .. " has no ghosts")
	end
end)
test("ghost ids are unique and income grows with rarity", function()
	local seen = {}
	local lastMax = 0
	for index = 1, #Config.Rarities do
		local minIncome, maxIncome = math.huge, 0
		for _, ghost in Config.Ghosts do
			if ghost.Rarity == index then
				expect(not seen[ghost.Id], "duplicate id " .. ghost.Id)
				seen[ghost.Id] = true
				minIncome = math.min(minIncome, ghost.Income)
				maxIncome = math.max(maxIncome, ghost.Income)
			end
		end
		expect(minIncome > lastMax, "income overlaps at rarity " .. index)
		lastMax = maxIncome
	end
end)
test("monetization keys are unique", function()
	local keys = {}
	for _, item in Config.GamePasses do
		expect(not keys[item.Key], item.Key)
		keys[item.Key] = true
	end
	for _, item in Config.Products do
		expect(not keys[item.Key], item.Key)
		keys[item.Key] = true
	end
end)

-- 3. Format ------------------------------------------------------------------
print("Format")
test("abbreviate", function()
	local cases = {
		[0] = "0",
		[7] = "7",
		[999] = "999",
		[1000] = "1K",
		[1234] = "1.23K",
		[15500] = "15.5K",
		[999999] = "1M",
		[2500000] = "2.5M",
		[1e12] = "1T",
	}
	for value, expected in cases do
		expect(Format.abbreviate(value) == expected, value .. " -> " .. Format.abbreviate(value))
	end
	expect(Format.money(-1500) == "$-1.5K", Format.money(-1500))
end)
test("time and percent", function()
	expect(Format.time(75) == "1:15", Format.time(75))
	expect(Format.time(3725) == "1:02:05", Format.time(3725))
	expect(Format.time(-5) == "0:00", Format.time(-5))
	expect(Format.percent(58) == "58%", Format.percent(58))
	expect(Format.percent(0.5) == "0.5%", Format.percent(0.5))
	expect(Format.percent(0.02) == "0.02%", Format.percent(0.02))
end)

-- 4. Odds --------------------------------------------------------------------
print("Odds")
test("chances sum to 100 and luck favours rare ghosts", function()
	for _, luck in { 1, 2, 3, 8 } do
		local total = 0
		for _, chance in Odds.getChances(luck) do
			total += chance
		end
		expect(near(total, 100, 1e-9), "sum " .. total)
	end
	local normal, lucky = Odds.getChances(1), Odds.getChances(3)
	expect(lucky[1] < normal[1], "common should drop")
	expect(lucky[#lucky] > normal[#normal], "secret should rise")
end)
test("rolls follow the weights", function()
	local rng = Random.new(7)
	local counts = {}
	local rolls = 200000
	for _ = 1, rolls do
		local rarity = Odds.rollRarity(1, rng)
		counts[rarity] = (counts[rarity] or 0) + 1
	end
	local chances = Odds.getChances(1)
	for index = 1, 4 do
		local observed = (counts[index] or 0) / rolls * 100
		expect(math.abs(observed - chances[index]) < 0.6, Config.Rarities[index].Name .. " " .. observed)
	end
	local ghost = Odds.rollGhost(1, rng)
	expect(Config.GhostsById[ghost.Id] == ghost)
end)
test("mutations roll at roughly the configured rate", function()
	local rng = Random.new(99)
	local counts = {}
	local rolls = 200000
	for _ = 1, rolls do
		local mutation = Odds.rollMutation(rng)
		if mutation then
			counts[mutation] = (counts[mutation] or 0) + 1
		end
	end
	local gold = (counts.Gold or 0) / rolls
	expect(math.abs(gold - 0.05 * (1 - 0.01) * (1 - 0.002)) < 0.004, "gold " .. gold)
	expect((counts.Rainbow or 0) > 0, "rainbow never rolled")
end)

-- 5. Formulas ----------------------------------------------------------------
print("Formulas")
test("room layout", function()
	expect(Formulas.TotalRooms == 14)
	expect(Formulas.RegularRooms == 12)
	expect(Formulas.isVipRoom(7) and Formulas.isVipRoom(14) and not Formulas.isVipRoom(1))
	expect(Formulas.RoomOrder[1] == 1 and Formulas.RoomOrder[2] == 8, "rooms alternate rows")
	local open = 0
	for room = 1, Formulas.TotalRooms do
		if Formulas.isRoomOpen(room, Config.StartRooms, false) then
			open += 1
		end
	end
	expect(open == Config.StartRooms, "start rooms " .. open)
	expect(Formulas.isRoomOpen(7, 0, true), "VIP room opens with VIP")
	expect(Formulas.nextLockedRoom(Config.StartRooms) == Formulas.RoomOrder[Config.StartRooms + 1])
	expect(Formulas.roomCost(Formulas.RegularRooms) == nil, "no cost when all unlocked")
	expect(Formulas.roomCost(Config.StartRooms) == Config.RoomBaseCost)
end)
test("costs grow and cap", function()
	for kind, upgrade in Config.Upgrades do
		local last = 0
		for level = 1, upgrade.MaxLevel - 1 do
			local cost = Formulas.upgradeCost(kind, level)
			expect(cost and cost > last, kind .. " level " .. level)
			last = cost
		end
		expect(Formulas.upgradeCost(kind, upgrade.MaxLevel) == nil, kind .. " max")
	end
	expect(Formulas.rebirthCost(1) == Config.Rebirth.BaseCost * Config.Rebirth.CostGrowth)
end)
test("income multiplier", function()
	local base = { Rebirths = 0, Builds = 0, DoubleCash = false, VIP = false, Premium = false }
	expect(Formulas.incomeMultiplier(base) == 1)
	local all = { Rebirths = 2, Builds = #Config.HotelBuilds, DoubleCash = true, VIP = true, Premium = true }
	local expected = (1 + 2 * Config.Rebirth.IncomeBonus)
		* (1 + Formulas.buildBonus(#Config.HotelBuilds) + Config.VipIncomeBonus + Config.PremiumIncomeBonus)
		* 2
	expect(near(Formulas.incomeMultiplier(all), expected), tostring(Formulas.incomeMultiplier(all)))
end)
test("fusion ladder and value", function()
	expect(Formulas.nextMutation(nil) == "Gold")
	expect(Formulas.nextMutation("Gold") == "Diamond")
	expect(Formulas.nextMutation("Diamond") == "Rainbow")
	expect(Formulas.nextMutation("Rainbow") == nil)
	-- Fusing must always be an upgrade over keeping three ghosts.
	local previous = 1
	for _, mutation in Config.Mutations do
		expect(mutation.Multiplier > previous * Config.FuseCount, mutation.Name .. " not worth fusing")
		previous = mutation.Multiplier
	end
end)
test("vacuum and backpack", function()
	expect(Formulas.vacuumPower(1, 0, false) == 1)
	expect(near(Formulas.vacuumPower(3, 0, true), (1 + 2 * 0.35) * 2))
	expect(Formulas.backpackCapacity(1, false) == 3)
	expect(Formulas.backpackCapacity(8, true) == 3 + 7 + Config.BigBackpackBonus)
	expect(Formulas.cashProductAmount(Config.ProductsByKey.CashSmall, 0) == 1000)
	expect(Formulas.cashProductAmount(Config.ProductsByKey.CashSmall, 100) == 60000)
end)
test("every ghost can be caught at max vacuum in reasonable time", function()
	local power = Formulas.vacuumPower(Config.Upgrades.Vacuum.MaxLevel, 0, false)
	for _, rarity in Config.Rarities do
		expect(rarity.CaptureTime / power < 5, rarity.Name)
	end
end)

-- 6. Ghost models (real Roblox instances) -------------------------------------
print("GhostFactory")
test("builds every ghost with every mutation", function()
	local mutations = { false }
	for _, mutation in Config.Mutations do
		table.insert(mutations, mutation.Name)
	end
	for _, ghost in Config.Ghosts do
		for _, mutation in mutations do
			local model = GhostFactory.build(ghost.Id, mutation or nil)
			expect(model.PrimaryPart and model.PrimaryPart.Name == "Root", ghost.Id .. " root")
			local parts = 0
			for _, descendant in model:GetDescendants() do
				if descendant:IsA("BasePart") and descendant ~= model.PrimaryPart then
					parts += 1
					expect(not descendant.Anchored and not descendant.CanCollide, "physics flags")
					local weld = descendant:FindFirstChildOfClass("WeldConstraint")
					expect(weld and weld.Part0 == model.PrimaryPart, "weld on " .. descendant.Name)
				end
			end
			expect(parts >= 8, ghost.Id .. " has " .. parts .. " parts")
			expect(model.PrimaryPart:FindFirstChild("Info"), "billboard")
			if mutation then
				expect(model:GetAttribute("Mutation") == mutation)
			end
			model:Destroy()
		end
	end
end)
test("mini ghosts skip billboard and light", function()
	local model = GhostFactory.build("pumpking", nil, { Scale = 0.3, Billboard = false, Light = false })
	expect(model.PrimaryPart:FindFirstChild("Info") == nil)
	expect(model.PrimaryPart:FindFirstChildOfClass("PointLight") == nil)
	expect(math.abs(model.PrimaryPart.Size.X - Config.Rarities[5].Size * 0.3) < 1e-4)
end)

-- 7. World generation (real Roblox instances) ---------------------------------
print("MapBuilder")
test("builds the world and every plot", function()
	local MapBuilder = load(server.MapBuilder)
	local plots = MapBuilder.build()
	expect(#plots == Config.MaxPlots, "plot count")
	expect(workspace:FindFirstChild("World"), "world folder")

	for _, plot in plots do
		expect(#plot.Rooms == Formulas.TotalRooms, "rooms")
		for _, build in Config.HotelBuilds do
			local model = plot.Builds[build.Key]
			expect(model and #model:GetChildren() > 0, "build " .. build.Key)
			expect(model.Parent == nil, "builds start hidden")
		end
		for _, key in { "Vacuum", "Backpack", "Cauldron" } do
			expect(plot.Stations[key] and plot.StationLabels[key], "station " .. key)
		end
		-- Everything important sits inside the plot.
		expect(MapBuilder.isInside(plot, plot.Register.CFrame.Position), "register inside")
		expect(MapBuilder.isInside(plot, plot.SpawnCFrame.Position), "spawn inside")
		for _, room in plot.Rooms do
			expect(MapBuilder.isInside(plot, room.Base.CFrame.Position), "room inside")
		end
		expect(not MapBuilder.isInside(plot, Vector3.new(0, 3, 0)), "graveyard is outside")
		-- The plot opens toward the graveyard and extends away from it.
		local entrance = plot.Origin.Position
		expect(plot.Origin.LookVector:Dot(Vector3.new(0, 0, entrance.Z).Unit) > 0.99, "plot faces the wrong way")
		local floor = plot.Model:FindFirstChild("Floor").CFrame.Position
		expect(math.abs(floor.Z) > math.abs(entrance.Z), "plot floor overlaps the graveyard")
		for x = MapBuilder.GraveyardMin.X, MapBuilder.GraveyardMax.X, 5 do
			for z = MapBuilder.GraveyardMin.Z, MapBuilder.GraveyardMax.Z, 4 do
				expect(
					not MapBuilder.isInside(plot, Vector3.new(x, 3, z)),
					"plot covers graveyard at " .. x .. "," .. z
				)
			end
		end
		expect(plot.SpawnCFrame.LookVector:Dot(plot.Origin.LookVector) < -0.99, "spawn should face the exit")
	end

	-- Plots must not overlap each other or the graveyard.
	for i, a in plots do
		for j, b in plots do
			if i ~= j then
				expect(not MapBuilder.isInside(a, b.Register.CFrame.Position), "plots overlap")
			end
		end
		local min, max = MapBuilder.GraveyardMin, MapBuilder.GraveyardMax
		for _, corner in
			{
				Vector3.new(min.X, 3, min.Z),
				Vector3.new(max.X, 3, max.Z),
				Vector3.new(min.X, 3, max.Z),
				Vector3.new(max.X, 3, min.Z),
			}
		do
			expect(not MapBuilder.isInside(a, corner), "graveyard overlaps plot")
		end
	end

	-- Rooms in a row must not overlap (5.6 stud bases).
	local plot = plots[1]
	for a = 1, Formulas.TotalRooms do
		for b = a + 1, Formulas.TotalRooms do
			local distance = (plot.Rooms[a].Base.CFrame.Position - plot.Rooms[b].Base.CFrame.Position).Magnitude
			expect(distance > 6, "rooms " .. a .. " and " .. b .. " overlap")
		end
	end

	local lighting = game:GetService("Lighting")
	expect(lighting:FindFirstChild("Grading"), "color grading")

	-- Save a preview of the generated world for inspection in Studio.
	fs.writeDir("build")
	fs.writeFile("build/WorldPreview.rbxlx", roblox.serializePlace(game, true))
end)

print(string.format("\n%d passed, %d failed", passed, failed))
if failed > 0 then
	process.exit(1)
end
