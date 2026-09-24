--!nocheck
-- End-to-end server simulation: boots the real Main.server script on a
-- mocked engine and plays the game — join, hunt a ghost, check it in, earn,
-- build, upgrade, fuse, buy with Robux, rebirth, leave and rejoin.
--
--   lune run tests/simulate      (needs the patched Lune, see tests/README.md)

local process = require("@lune/process")
local roblox = require("@lune/roblox")
local task = require("@lune/task")

local Engine = require("./lib/Engine")
local Loader = require("./lib/Loader")

local game = roblox.Instance.new("DataModel")
Engine.install(game)

local Workspace = game:GetService("Workspace")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local MarketplaceService = game:GetService("MarketplaceService")
local Enum = roblox.Enum
local CFrame = roblox.CFrame
local Vector3 = roblox.Vector3

local loader = Loader.new(game)
loader.setGlobal("TweenInfo", Engine.TweenInfo)
local shared = loader.mount(ReplicatedStorage, "Shared", "src/shared")
local server = loader.mount(game:GetService("ServerScriptService"), "Server", "src/server")

-- Configure monetization like a published game would.
local Config = loader.require(shared.Config)
local Formulas = loader.require(shared.Formulas)
local CASH_SMALL_ID, WITCHING_ID, VIP_PASS_ID = 111, 444, 777
Config.ProductsByKey.CashSmall.Id = CASH_SMALL_ID
Config.GamePassesByKey.VIP.Id = VIP_PASS_ID
Engine.DevProducts = { { ProductId = WITCHING_ID, Name = "Summon Witching Hour" } }

-- Boot the real server entry point.
loader.require(server.Main)

local DataService = loader.require(server.DataService)
local EventService = loader.require(server.EventService)
local HotelService = loader.require(server.HotelService)
local MapBuilder = loader.require(server.MapBuilder)

--------------------------------------------------------------------------
local passed, failed = 0, 0
local function step(name: string, fn: () -> ())
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
local function attr(player, name)
	return player:GetAttribute(name)
end
local function lastNotification(player): string
	local list = Engine.notificationsFor(player)
	return list[#list] or ""
end
local function hasNotification(player, pattern: string): boolean
	for _, text in Engine.notificationsFor(player) do
		if string.find(text, pattern) then
			return true
		end
	end
	return false
end
local function join(userId: number, name: string)
	local player = Engine.newPlayer(game, userId, name)
	Engine.signal(Players, "PlayerAdded"):Fire(player)
	expect(
		Engine.waitFor(function()
			return attr(player, "Loaded") == true and player.Character ~= nil
		end, 5),
		name .. " never finished loading"
	)
	task.wait(0.1)
	return player
end
local function root(player)
	return player.Character:FindFirstChild("HumanoidRootPart")
end
local function promptOn(instance)
	return instance:FindFirstChildOfClass("ProximityPrompt")
end
local function trigger(prompt, player)
	Engine.signal(prompt, "Triggered"):Fire(player)
	task.wait(0.05)
end
local function touch(part, player)
	Engine.signal(part, "Touched"):Fire(root(player))
	task.wait(0.05)
end

print("Simulation")

local alice, plot
step("player joins, gets a hotel, a character and the vacuum", function()
	alice = join(1001, "Alice")
	plot = HotelService.getPlot(alice)
	expect(plot and plot.Owner == alice, "plot assigned")
	expect(attr(alice, "Cash") == Config.StartingCash, "starting cash")
	expect(attr(alice, "BackpackCapacity") == 3, "backpack capacity")
	expect(alice:FindFirstChild("leaderstats"):FindFirstChild("Cash").Value == "$0", "leaderstats")
	expect(plot.SignLabel.Text == "Alice's Hotel", plot.SignLabel.Text)
	expect(MapBuilder.isInside(plot, root(alice).Position), "spawned inside the hotel")
	expect(alice.Character:FindFirstChild("Ghost Vacuum"), "vacuum equipped")
	-- Rooms: 4 open, the next one is purchasable, the rest locked.
	expect(plot.Rooms[1].Label.Text == "Empty room", plot.Rooms[1].Label.Text)
	local nextRoom = Formulas.nextLockedRoom(Config.StartRooms)
	expect(promptOn(plot.Rooms[nextRoom].Base), "unlock prompt on next room")
	expect(string.find(plot.BuildLabel.Text, "Spooky Fence"), plot.BuildLabel.Text)
end)

step("ghosts spawn in the graveyard", function()
	expect(
		Engine.waitFor(function()
			return #Workspace.Ghosts:GetChildren() >= 2
		end, 6),
		"no ghosts spawned"
	)
	for _, model in Workspace.Ghosts:GetChildren() do
		local position = model.PrimaryPart.Position
		expect(position.X >= MapBuilder.GraveyardMin.X and position.X <= MapBuilder.GraveyardMax.X, "ghost x")
		expect(position.Z >= MapBuilder.GraveyardMin.Z and position.Z <= MapBuilder.GraveyardMax.Z, "ghost z")
		expect(model.PrimaryPart:FindFirstChildOfClass("AlignPosition"), "ghost physics")
	end
end)

step("holding the vacuum next to a ghost catches it", function()
	-- Pick the easiest ghost and stand next to it.
	local target, rarity = nil, math.huge
	for _, model in Workspace.Ghosts:GetChildren() do
		local value = model:GetAttribute("Rarity")
		if value < rarity then
			target, rarity = model, value
		end
	end
	root(alice).CFrame = CFrame.new(target.PrimaryPart.Position + Vector3.new(0, 0, 6))
	local tool = alice.Character:FindFirstChild("Ghost Vacuum")
	Engine.signal(tool, "Activated"):Fire()
	local seconds = Config.Rarities[rarity].CaptureTime + 1.5
	expect(
		Engine.waitFor(function()
			return attr(alice, "BackpackCount") == 1
		end, seconds),
		"ghost not caught in " .. seconds .. "s"
	)
	Engine.signal(tool, "Deactivated"):Fire()
	expect(target.Parent == nil, "caught ghost removed from the world")
	expect(hasNotification(alice, "Caught"), lastNotification(alice))
	expect(attr(alice, "Caught") == 1)
	expect(attr(alice, "BackpackIds") ~= "", "backpack visual data")
end)

step("walking into the hotel checks the ghost in and it earns money", function()
	root(alice).CFrame = plot.SpawnCFrame
	expect(
		Engine.waitFor(function()
			return attr(alice, "BackpackCount") == 0
		end, 2),
		"not checked in"
	)
	expect(attr(alice, "IncomePerSec") > 0, "income")
	expect(
		Engine.waitFor(function()
			return (attr(alice, "Stored") or 0) >= 1
		end, 2.5),
		"register never filled"
	)
	local before = attr(alice, "Cash")
	touch(plot.Register, alice)
	expect(attr(alice, "Cash") > before, "collect did not pay")
	expect(attr(alice, "Stored") == 0)
end)

step("build button, room unlock and upgrades cost cash", function()
	touch(plot.BuildPad, alice)
	expect(attr(alice, "Builds") == 0, "built without money")
	expect(hasNotification(alice, "Not enough cash"), "no error shown")

	HotelService.addCash(alice, 100000)
	task.wait(1.05) -- build button debounce
	local cash = attr(alice, "Cash")
	touch(plot.BuildPad, alice)
	expect(attr(alice, "Builds") == 1, "fence not built")
	expect(attr(alice, "Cash") == cash - Config.HotelBuilds[1].Price, "wrong build price")
	expect(plot.Builds.Fence.Parent == plot.Model, "fence not visible")
	expect(attr(alice, "Multiplier") > 1, "build bonus missing")

	local nextRoom = Formulas.nextLockedRoom(Config.StartRooms)
	cash = attr(alice, "Cash")
	trigger(promptOn(plot.Rooms[nextRoom].Base), alice)
	expect(DataService.get(alice).UnlockedRooms == Config.StartRooms + 1, "room not unlocked")
	expect(attr(alice, "Cash") == cash - Config.RoomBaseCost, "wrong room price")
	expect(promptOn(plot.Rooms[nextRoom].Base) == nil, "unlock prompt left behind")

	cash = attr(alice, "Cash")
	trigger(promptOn(plot.Stations.Vacuum), alice)
	expect(attr(alice, "VacuumLevel") == 2, "vacuum not upgraded")
	expect(attr(alice, "Cash") == cash - Config.Upgrades.Vacuum.BaseCost)
	trigger(promptOn(plot.Stations.Backpack), alice)
	expect(attr(alice, "BackpackCapacity") == 4, "backpack not upgraded")
end)

step("cauldron fuses three identical ghosts", function()
	local data = DataService.get(alice)
	data.Rooms = {}
	for _, room in { 1, 8, 2 } do
		data.Rooms[tostring(room)] = { Id = "boo_blob" }
	end
	HotelService.refresh(alice)
	trigger(promptOn(plot.Stations.Cauldron), alice)
	local count, result = 0, nil
	for _, entry in data.Rooms do
		count += 1
		result = entry
	end
	expect(count == 1, "expected 1 ghost after fusing, got " .. count)
	expect(result.Mutation == "Gold", "fused ghost should be Gold")
	expect(hasNotification(alice, "Fused"), lastNotification(alice))

	trigger(promptOn(plot.Stations.Cauldron), alice)
	expect(hasNotification(alice, "identical ghosts"), "missing 'need 3' hint")
end)

step("releasing a ghost pays its release value", function()
	local data = DataService.get(alice)
	local roomKey, entry = next(data.Rooms)
	local model = nil
	for _, child in plot.Model:GetChildren() do
		if child:GetAttribute("Room") == tonumber(roomKey) then
			model = child
		end
	end
	expect(model, "room ghost model missing")
	expect(model:GetAttribute("OwnerUserId") == alice.UserId)
	local expected = Formulas.releaseValue(entry.Id, entry.Mutation, attr(alice, "Multiplier"))
	local cash = attr(alice, "Cash")
	trigger(promptOn(model.PrimaryPart), alice)
	expect(attr(alice, "Cash") == cash + expected, "release paid wrong amount")
	expect(data.Rooms[roomKey] == nil, "room not emptied")
	expect(model.Parent == nil, "model not removed")
end)

local bob
step("a second player gets a different hotel and cannot use Alice's", function()
	bob = join(1002, "Bob")
	local bobPlot = HotelService.getPlot(bob)
	expect(bobPlot ~= plot, "same plot")
	expect(promptOn(plot.Stations.Vacuum):GetAttribute("OwnerUserId") == alice.UserId)
	expect(promptOn(bobPlot.Stations.Vacuum):GetAttribute("OwnerUserId") == bob.UserId)
	HotelService.addCash(bob, 1000000)
	local level = attr(alice, "VacuumLevel")
	trigger(promptOn(plot.Stations.Vacuum), bob)
	expect(attr(alice, "VacuumLevel") == level and attr(bob, "VacuumLevel") == 1, "Bob upgraded Alice's vacuum")
	-- Room prompts belong to Alice too (exploiters can fire any prompt).
	local nextRoom = Formulas.nextLockedRoom(DataService.get(alice).UnlockedRooms)
	local bobRooms = DataService.get(bob).UnlockedRooms
	trigger(promptOn(plot.Rooms[nextRoom].Base), bob)
	expect(DataService.get(bob).UnlockedRooms == bobRooms, "Bob unlocked a room via Alice's prompt")
	DataService.get(bob).Rooms["1"] = { Id = "slime_spook" }
	expect(HotelService.addToBackpack(alice, "boo_blob", nil), "backpack")
	HotelService.checkIn(alice)
	local aliceGhost = nil
	for _, child in plot.Model:GetChildren() do
		if child:GetAttribute("Room") ~= nil then
			aliceGhost = child
		end
	end
	expect(aliceGhost, "Alice's ghost was not rendered")
	trigger(promptOn(aliceGhost.PrimaryPart), bob)
	expect(DataService.get(bob).Rooms["1"] ~= nil, "Bob released his own ghost via Alice's prompt")
	expect(aliceGhost.Parent ~= nil, "Bob released Alice's ghost")
	trigger(promptOn(aliceGhost.PrimaryPart), alice)
	DataService.get(bob).Rooms["1"] = nil

	local cash = attr(bob, "Cash")
	root(bob).CFrame = CFrame.new(plot.Register.Position)
	Engine.signal(plot.Register, "Touched"):Fire(root(bob))
	task.wait(0.05)
	expect(attr(bob, "Cash") == cash, "Bob collected Alice's register")
end)

step("developer products are granted exactly once", function()
	local cash = attr(alice, "Cash")
	local receipt = { PlayerId = alice.UserId, PurchaseId = "p-1", ProductId = CASH_SMALL_ID }
	local decision = Engine.ProcessReceipt(receipt)
	expect(decision == Enum.ProductPurchaseDecision.PurchaseGranted, tostring(decision))
	local expected = Formulas.cashProductAmount(Config.ProductsByKey.CashSmall, attr(alice, "IncomePerSec"))
	expect(attr(alice, "Cash") == cash + expected, "wrong cash pack amount")
	expect(Engine.ProcessReceipt(receipt) == Enum.ProductPurchaseDecision.PurchaseGranted, "retry not granted")
	expect(attr(alice, "Cash") == cash + expected, "granted twice!")

	local unknown = Engine.ProcessReceipt({ PlayerId = alice.UserId, PurchaseId = "p-2", ProductId = 999 })
	expect(unknown == Enum.ProductPurchaseDecision.NotProcessedYet, "unknown product granted")
	local offline = Engine.ProcessReceipt({ PlayerId = 424242, PurchaseId = "p-3", ProductId = CASH_SMALL_ID })
	expect(offline == Enum.ProductPurchaseDecision.NotProcessedYet, "offline player granted")
end)

step("Witching Hour product is found by name and starts the event", function()
	local ids = ReplicatedStorage:FindFirstChild("MonetizationIds")
	expect(ids:GetAttribute("Product_WitchingHour") == WITCHING_ID, "product id not resolved by name")
	expect(ids:GetAttribute("Product_CashSmall") == CASH_SMALL_ID)
	local decision = Engine.ProcessReceipt({ PlayerId = bob.UserId, PurchaseId = "w-1", ProductId = WITCHING_ID })
	expect(decision == Enum.ProductPurchaseDecision.PurchaseGranted)
	expect(EventService.isActive() and EventService.getLuck() == Config.WitchingHour.Luck, "event not active")
	expect(ReplicatedStorage:GetAttribute("WitchingHour") == true, "event not replicated")
	expect(hasNotification(alice, "summoned the WITCHING HOUR"), "no server announcement")
end)

step("buying the VIP pass opens the VIP rooms and boosts income", function()
	local multiplier = attr(alice, "Multiplier")
	Engine.signal(MarketplaceService, "PromptGamePassPurchaseFinished"):Fire(alice, VIP_PASS_ID, true)
	task.wait(0.1)
	expect(attr(alice, "Pass_VIP") == true, "pass attribute")
	expect(attr(alice, "Multiplier") > multiplier, "VIP bonus missing")
	expect(string.find(plot.Rooms[7].Label.Text, "Empty"), plot.Rooms[7].Label.Text)
	expect(Formulas.isRoomOpen(14, DataService.get(alice).UnlockedRooms, true))
end)

step("rebirth resets progress and grants the bonus", function()
	HotelService.addCash(alice, Formulas.rebirthCost(0))
	Engine.signal(ReplicatedStorage.Remotes.Rebirth, "OnServerEvent"):Fire(alice)
	task.wait(0.05)
	local data = DataService.get(alice)
	expect(data.Rebirths == 1, "rebirth not applied")
	expect(data.Cash == Config.Rebirth.StartCash and data.Builds == 0 and data.VacuumLevel == 1, "not reset")
	expect(next(data.Rooms) == nil, "rooms not cleared")
	expect(plot.Builds.Fence.Parent == nil, "fence still visible")
	expect(attr(alice, "Multiplier") >= 1.5, "rebirth bonus missing")

	Engine.signal(ReplicatedStorage.Remotes.Rebirth, "OnServerEvent"):Fire(alice)
	task.wait(0.05)
	expect(data.Rebirths == 1, "rebirthed without cash")
end)

--------------------------------------------------------------------------
-- Client: run the real LocalScripts as Alice
--------------------------------------------------------------------------
local gui
local function textOf(label)
	return if label then label.Text else "<missing>"
end
local function labelWithText(root, text: string)
	return Engine.find(root, function(instance)
		return instance:IsA("TextLabel") and instance.Text == text
	end)
end
local function buttonOfCard(root, title: string)
	local titleLabel = labelWithText(root, title)
	return titleLabel and titleLabel.Parent:FindFirstChildOfClass("TextButton")
end

step("client UI boots without errors", function()
	Engine.LocalPlayer = alice
	Engine.Prices[CASH_SMALL_ID] = 25
	Engine.Prices[WITCHING_ID] = 149
	Engine.Prices[VIP_PASS_ID] = 299
	local starterScripts = game:GetService("StarterPlayer"):FindFirstChildOfClass("StarterPlayerScripts")
		or roblox.Instance.new("StarterPlayerScripts", game:GetService("StarterPlayer"))
	local client = loader.mount(starterScripts, "Client", "src/client")
	loader.require(client.Main)
	task.wait(0.2)
	gui = alice.PlayerGui:FindFirstChild("HotelUI")
	expect(gui, "HotelUI missing")
	expect(gui:FindFirstChild("Cash") and gui:FindFirstChild("Menu") and gui:FindFirstChild("Backpack"), "HUD parts")
	expect(#Engine.Errors == 0, "handler errors: " .. table.concat(Engine.Errors, " | "))
end)

step("HUD follows the player's stats", function()
	Engine.setAttribute(alice, "Cash", 12345)
	Engine.setAttribute(alice, "IncomePerSec", 250)
	Engine.setAttribute(alice, "BackpackCount", 2)
	task.wait(0.1)
	local cashLabel = gui.Cash:FindFirstChildOfClass("TextLabel")
	expect(textOf(cashLabel) == "💰 $12.3K", textOf(cashLabel))
	expect(string.find(gui.Backpack:FindFirstChildOfClass("TextLabel").Text, "2/"), "backpack counter")
end)

step("shop shows real prices, owned passes and prompts purchases", function()
	Engine.click(gui.Menu.Shop)
	task.wait(0.2)
	local shop = gui:FindFirstChild("🛒 SHOP")
	expect(shop and shop.Visible, "shop did not open")
	local vip = buttonOfCard(shop, "VIP")
	expect(textOf(vip:FindFirstChild("Label")) == "✅ OWNED", textOf(vip:FindFirstChild("Label")))
	local double = buttonOfCard(shop, "2x Cash")
	expect(textOf(double:FindFirstChild("Label")) == "Coming soon", "unconfigured pass should say Coming soon")
	local small = buttonOfCard(shop, "Small Cash Pack")
	expect(textOf(small:FindFirstChild("Label")) == "R$ 25", textOf(small:FindFirstChild("Label")))
	local witching = buttonOfCard(shop, "Summon Witching Hour")
	expect(textOf(witching:FindFirstChild("Label")) == "R$ 149", "witching price")
	Engine.click(small)
	local last = Engine.PurchasePrompts[#Engine.PurchasePrompts]
	expect(last and last.Kind == "Product" and last.Id == CASH_SMALL_ID, "purchase prompt not shown")
	expect(labelWithText(shop, "🎲 Ghost odds (normal → Witching Hour)"), "odds disclosure missing")
	Engine.click(gui.Menu.Shop)
	expect(not shop.Visible, "shop did not close")
end)

step("rebirth button in the UI performs a rebirth", function()
	Engine.click(gui.Menu.Rebirth)
	local panel = gui:FindFirstChild("♻️ REBIRTH")
	expect(panel and panel.Visible, "rebirth panel did not open")
	HotelService.addCash(alice, Formulas.rebirthCost(1))
	Engine.signal(alice, "Attribute:Cash"):Fire()
	task.wait(0.05)
	local button = labelWithText(panel, "♻️ REBIRTH NOW")
	expect(button, "rebirth button not ready")
	Engine.click(button.Parent)
	task.wait(0.1)
	expect(DataService.get(alice).Rebirths == 2, "UI rebirth did not reach the server")
	expect(not panel.Visible, "panel should close after rebirth")
end)

step("notifications, effects, prompts, minis and chat tag", function()
	local toasts = gui.Notifications:GetChildren()
	local count = 0
	for _, child in toasts do
		if child:IsA("Frame") then
			count += 1
		end
	end
	expect(count > 0 and count <= 5, "toasts: " .. count)

	-- Only the owner sees their hotel's prompts.
	local alicePrompt = plot.Stations.Vacuum:FindFirstChildOfClass("ProximityPrompt")
	local bobPrompt = HotelService.getPlot(bob).Stations.Vacuum:FindFirstChildOfClass("ProximityPrompt")
	expect(alicePrompt.Enabled == true, "Alice cannot see her own prompt")
	expect(bobPrompt.Enabled == false, "Alice can see Bob's prompt")

	-- Mini ghosts orbit hunters carrying ghosts.
	bob:SetAttribute("BackpackIds", "boo_blob:,pumpking:Gold")
	local RunService = game:GetService("RunService")
	Engine.signal(RunService, "RenderStepped"):Fire(1 / 60)
	task.wait(0.05)
	local minis = {}
	for _, child in Workspace.LocalEffects:GetChildren() do
		if child:IsA("Model") then
			table.insert(minis, child)
		end
	end
	expect(#minis == 2, "expected 2 minis, got " .. #minis)
	local distance = (minis[1].PrimaryPart.Position - root(bob).Position).Magnitude
	expect(distance < 6, "minis not around Bob: " .. distance)

	Engine.signal(ReplicatedStorage.Remotes.Effect, "OnClientEvent"):Fire("capture", root(alice).Position, 5)
	task.wait(0.05)

	local properties = Engine.OnIncomingMessage({ TextSource = { UserId = alice.UserId }, PrefixText = "Alice:" })
	expect(properties and string.find(properties.PrefixText, "VIP"), "VIP chat tag missing")
	expect(#Engine.Errors == 0, "handler errors: " .. table.concat(Engine.Errors, " | "))
end)

step("leaving saves to the DataStore and frees the hotel", function()
	local data = DataService.get(alice)
	data.Rooms["1"] = { Id = "pumpking", Mutation = "Diamond" }
	HotelService.refresh(alice)
	alice.Parent = nil
	Engine.signal(Players, "PlayerRemoving"):Fire(alice)
	task.wait(0.1)
	expect(plot.Owner == nil and plot.SignLabel.Text == "Empty Hotel", "plot not freed")
	local store = Engine.Stores.GhostHotel_v1
	local saved = store:read("player_1001")
	expect(saved and saved.Data, "nothing saved")
	expect(saved.Session == nil, "session lock not released")
	expect(saved.Data.Rebirths == 2 and saved.Data.Rooms["1"].Mutation == "Diamond", "wrong data saved")
	expect(#saved.Data.Purchases == 1, "purchase history not saved")
end)

step("rejoining restores the saved hotel", function()
	local again = join(1001, "Alice")
	local data = DataService.get(again)
	expect(data.Rebirths == 2, "rebirths lost")
	expect(data.Rooms["1"] and data.Rooms["1"].Id == "pumpking", "rooms lost")
	expect(attr(again, "IncomePerSec") > 0, "income not restored")
	local newPlot = HotelService.getPlot(again)
	local model = nil
	for _, child in newPlot.Model:GetChildren() do
		if child:GetAttribute("Room") == 1 then
			model = child
		end
	end
	expect(model and model:GetAttribute("Mutation") == "Diamond", "room ghost not rendered")
	local store = Engine.Stores.GhostHotel_v1
	expect(store:read("player_1001").Session.JobId == Engine.JobId, "session not locked")
end)

step("server shutdown saves everyone", function()
	local store = Engine.Stores.GhostHotel_v1
	local writes = store.Writes
	for _, handler in Engine.CloseHandlers do
		handler()
	end
	expect(store.Writes >= writes + 2, "not everyone saved")
	expect(store:read("player_1002").Session == nil, "Bob's session still locked")
end)

print(string.format("\n%d passed, %d failed", passed, failed))
process.exit(if failed > 0 then 1 else 0)
