-- The tycoon itself: hotel ownership, rooms, income, the cash register,
-- build buttons, upgrades, the fusion cauldron, rebirths and player stats.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local Shared = ReplicatedStorage.Shared
local Config = require(Shared.Config)
local Format = require(Shared.Format)
local Formulas = require(Shared.Formulas)
local GhostFactory = require(Shared.GhostFactory)

local DataService = require(script.Parent.DataService)
local Loop = require(script.Parent.Loop)
local MapBuilder = require(script.Parent.MapBuilder)
local PassCache = require(script.Parent.PassCache)
local Remotes = require(script.Parent.Remotes)

type Plot = MapBuilder.Plot

type State = {
	Data: any,
	Plot: Plot,
	RoomModels: { [number]: Model },
	Income: number,
	Multiplier: number,
	LastCollect: number,
	LastBuild: number,
	LastFullWarning: number,
	LastTeleport: number,
}

local HotelService = {}

local plots: { Plot } = {}
local states: { [Player]: State } = {}

local ROOM_GHOST_MAX_SIZE = 4.6
local COLOR_OPEN = Color3.fromRGB(90, 255, 220)
local COLOR_NEXT = Color3.fromRGB(255, 255, 255)
local COLOR_LOCKED = Color3.fromRGB(70, 70, 80)
local COLOR_VIP = Color3.fromRGB(255, 200, 60)

--------------------------------------------------------------------------
-- Helpers
--------------------------------------------------------------------------
local function playerFromHit(hit: BasePart): Player?
	local character = hit:FindFirstAncestorOfClass("Model")
	return character and Players:GetPlayerFromCharacter(character)
end

local function makePrompt(
	parent: Instance,
	action: string,
	object: string,
	hold: number,
	owner: Player?
): ProximityPrompt
	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = action
	prompt.ObjectText = object
	prompt.HoldDuration = hold
	prompt.MaxActivationDistance = 10
	prompt.RequiresLineOfSight = false
	prompt.Style = Enum.ProximityPromptStyle.Default
	-- The client hides owner-only prompts from everybody else.
	prompt:SetAttribute("OwnerOnly", true)
	prompt:SetAttribute("OwnerUserId", if owner then owner.UserId else 0)
	prompt.Parent = parent
	return prompt
end

local function clearPrompts(parent: Instance)
	for _, child in parent:GetChildren() do
		if child:IsA("ProximityPrompt") then
			child:Destroy()
		end
	end
end

local function isOwner(player: Player, plot: Plot): boolean
	return plot.Owner == player and states[player] ~= nil
end

local function effect(player: Player?, kind: string, position: Vector3)
	if player then
		Remotes.Effect:FireClient(player, kind, position)
	else
		Remotes.Effect:FireAllClients(kind, position)
	end
end

--------------------------------------------------------------------------
-- Stats
--------------------------------------------------------------------------
function HotelService.getStats(player: Player): Formulas.Stats
	local state = states[player]
	return {
		Rebirths = if state then state.Data.Rebirths else 0,
		Builds = if state then state.Data.Builds else 0,
		DoubleCash = PassCache.owns(player, "DoubleCash"),
		VIP = PassCache.owns(player, "VIP"),
		Premium = PassCache.isPremium(player),
	}
end

function HotelService.getIncomePerSecond(player: Player): number
	local state = states[player]
	return if state then state.Income else 0
end

function HotelService.getVacuumPower(player: Player): number
	local state = states[player]
	if not state then
		return 1
	end
	return Formulas.vacuumPower(state.Data.VacuumLevel, state.Data.Rebirths, PassCache.owns(player, "MegaVacuum"))
end

function HotelService.getBackpackCapacity(player: Player): number
	local state = states[player]
	if not state then
		return 0
	end
	return Formulas.backpackCapacity(state.Data.BackpackLevel, PassCache.owns(player, "BigBackpack"))
end

function HotelService.isBackpackFull(player: Player): boolean
	local state = states[player]
	return state == nil or #state.Data.Backpack >= HotelService.getBackpackCapacity(player)
end

function HotelService.getPlot(player: Player): Plot?
	local state = states[player]
	return state and state.Plot
end

function HotelService.isLoaded(player: Player): boolean
	return states[player] ~= nil
end

local function backpackString(data): string
	local parts = {}
	for _, ghost in data.Backpack do
		table.insert(parts, ghost.Id .. ":" .. (ghost.Mutation or ""))
	end
	return table.concat(parts, ",")
end

local function updateLeaderstats(player: Player, data)
	local leaderstats = player:FindFirstChild("leaderstats")
	if not leaderstats then
		return
	end
	leaderstats.Cash.Value = Format.money(data.Cash)
	leaderstats.Ghosts.Value = data.Caught
	leaderstats.Rebirths.Value = data.Rebirths
end

local function updateCashAttributes(player: Player, data)
	player:SetAttribute("Cash", data.Cash)
	player:SetAttribute("Stored", math.floor(data.Stored))
	updateLeaderstats(player, data)
end

local function applyWalkSpeed(player: Player)
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if humanoid then
		humanoid.WalkSpeed = if PassCache.owns(player, "SpeedCoil") then Config.SpeedCoilWalkSpeed else Config.WalkSpeed
	end
end

--------------------------------------------------------------------------
-- Money
--------------------------------------------------------------------------
function HotelService.addCash(player: Player, amount: number)
	local state = states[player]
	if not state or amount <= 0 then
		return
	end
	state.Data.Cash += amount
	updateCashAttributes(player, state.Data)
end

function HotelService.trySpend(player: Player, amount: number): boolean
	local state = states[player]
	if not state then
		return false
	end
	if state.Data.Cash < amount then
		Remotes.notify(
			player,
			"Not enough cash! You need " .. Format.money(amount - state.Data.Cash) .. " more.",
			"error"
		)
		return false
	end
	state.Data.Cash -= amount
	updateCashAttributes(player, state.Data)
	return true
end

--------------------------------------------------------------------------
-- Plot visuals
--------------------------------------------------------------------------
local function updateStations(player: Player)
	local state = states[player]
	if not state then
		return
	end
	local data, plot = state.Data, state.Plot

	for kind, upgrade in Config.Upgrades do
		local level = if kind == "Vacuum" then data.VacuumLevel else data.BackpackLevel
		local cost = Formulas.upgradeCost(kind, level)
		local stat = if kind == "Vacuum"
			then "Power x" .. string.format("%.2f", HotelService.getVacuumPower(player))
			else "Holds " .. HotelService.getBackpackCapacity(player) .. " ghosts"
		local nextText = if cost then "Upgrade: " .. Format.money(cost) else "MAX LEVEL"
		plot.StationLabels[kind].Text = string.format(
			'%s %s <font color="#9fe0ff">Lv %d</font>\n<font size="18">%s • %s</font>',
			upgrade.Icon,
			upgrade.Name,
			level,
			stat,
			nextText
		)
		local prompt = plot.Stations[kind]:FindFirstChildOfClass("ProximityPrompt")
		if prompt then
			prompt.ObjectText = if cost then Format.money(cost) else "MAX"
			-- Visibility is decided on the client (owner only), see WorldEffects.
			prompt:SetAttribute("ServerEnabled", cost ~= nil)
		end
	end

	plot.StationLabels.Cauldron.Text = '🧪 Fusion Cauldron\n<font size="18">3 identical ghosts → 1 mutated</font>'

	local nextBuild = Config.HotelBuilds[data.Builds + 1]
	plot.BuildLabel.Text = if nextBuild
		then string.format(
			'🔨 Build: %s\n<font color="#7dff9b">%s</font> <font size="18">(+%d%% income)</font>',
			nextBuild.Name,
			Format.money(nextBuild.Price),
			math.floor(nextBuild.IncomeBonus * 100 + 0.5)
		)
		else "🏆 Hotel complete!"
	plot.BuildPad.Transparency = if nextBuild then 0 else 0.7
end

local function updateRegister(player: Player)
	local state = states[player]
	if not state then
		return
	end
	state.Plot.RegisterLabel.Text = string.format(
		'💰 %s\n<font size="18">Step here to collect</font>',
		Format.money(math.floor(state.Data.Stored))
	)
end

local function roomGhostCFrame(plot: Plot, room: number, ghostId: string, scale: number): CFrame
	local size = GhostFactory.getSize(ghostId, scale)
	return plot.Rooms[room].GhostCFrame * CFrame.new(0, 1.6 + size / 2, 0)
end

local function renderRoom(player: Player, room: number)
	local state = states[player]
	if not state then
		return
	end
	local data, plot = state.Data, state.Plot
	local info = plot.Rooms[room]

	local old = state.RoomModels[room]
	if old then
		old:Destroy()
		state.RoomModels[room] = nil
	end
	clearPrompts(info.Base)

	local entry = data.Rooms[tostring(room)]
	local vip = PassCache.owns(player, "VIP")
	local isVipRoom = Formulas.isVipRoom(room)
	local open = Formulas.isRoomOpen(room, data.UnlockedRooms, vip)

	if entry and Config.GhostsById[entry.Id] then
		local scale = math.min(1, ROOM_GHOST_MAX_SIZE / GhostFactory.getSize(entry.Id))
		local model = GhostFactory.build(entry.Id, entry.Mutation, { Scale = scale })
		model:PivotTo(roomGhostCFrame(plot, room, entry.Id, scale))
		model:SetAttribute("OwnerUserId", player.UserId)
		model:SetAttribute("Room", room)
		model:AddTag("RoomGhost")

		local value = Formulas.releaseValue(entry.Id, entry.Mutation, state.Multiplier)
		local prompt = makePrompt(model.PrimaryPart :: BasePart, "Release", "+" .. Format.money(value), 0.8, player)
		prompt.Triggered:Connect(function(who)
			if who == player then
				HotelService.releaseGhost(player, room)
			end
		end)

		model.Parent = plot.Model
		state.RoomModels[room] = model
		info.Ring.Color = Config.Rarities[Config.GhostsById[entry.Id].Rarity].Color
		info.Label.Text = ""
	elseif open then
		info.Ring.Color = if isVipRoom then COLOR_VIP else COLOR_OPEN
		info.Label.Text = if isVipRoom then "👑 VIP room\nEmpty" else "Empty room"
	elseif isVipRoom then
		info.Ring.Color = COLOR_VIP
		info.Label.Text = '👑 VIP ROOM\n<font size="16">Get the VIP pass</font>'
	elseif room == Formulas.nextLockedRoom(data.UnlockedRooms) then
		local cost = Formulas.roomCost(data.UnlockedRooms) or 0
		info.Ring.Color = COLOR_NEXT
		info.Label.Text = "🔒 Unlock\n" .. Format.money(cost)
		local prompt = makePrompt(info.Base, "Unlock Room", Format.money(cost), 0.3, player)
		prompt.Triggered:Connect(function(who)
			if who == player then
				HotelService.unlockRoom(player)
			end
		end)
	else
		info.Ring.Color = COLOR_LOCKED
		info.Label.Text = "🔒"
	end
end

local function renderAllRooms(player: Player)
	for room = 1, Formulas.TotalRooms do
		renderRoom(player, room)
	end
end

local function setBuildVisible(plot: Plot, key: string, visible: boolean, animate: boolean)
	local model = plot.Builds[key]
	if not model then
		return
	end
	if not visible then
		model.Parent = nil
		return
	end
	if model.Parent == plot.Model then
		return
	end
	model.Parent = plot.Model
	if animate then
		for _, descendant in model:GetDescendants() do
			if descendant:IsA("BasePart") then
				local target = descendant.CFrame
				descendant.CFrame = target * CFrame.new(0, -4, 0)
				TweenService:Create(descendant, TweenInfo.new(0.7, Enum.EasingStyle.Back), { CFrame = target }):Play()
			end
		end
	end
end

local function renderBuilds(player: Player, animateLatest: boolean)
	local state = states[player]
	if not state then
		return
	end
	for index, build in Config.HotelBuilds do
		local owned = index <= state.Data.Builds
		setBuildVisible(state.Plot, build.Key, owned, animateLatest and index == state.Data.Builds)
	end
end

--------------------------------------------------------------------------
-- Refresh: recompute derived stats and push them to the client
--------------------------------------------------------------------------
function HotelService.refresh(player: Player)
	local state = states[player]
	if not state then
		return
	end
	local data = state.Data
	state.Multiplier = Formulas.incomeMultiplier(HotelService.getStats(player))

	local income = 0
	for _, entry in data.Rooms do
		income += Formulas.ghostIncome(entry.Id, entry.Mutation)
	end
	state.Income = income * state.Multiplier

	player:SetAttribute("IncomePerSec", state.Income)
	player:SetAttribute("Multiplier", state.Multiplier)
	player:SetAttribute("Rebirths", data.Rebirths)
	player:SetAttribute("Builds", data.Builds)
	player:SetAttribute("Caught", data.Caught)
	player:SetAttribute("VacuumLevel", data.VacuumLevel)
	player:SetAttribute("BackpackLevel", data.BackpackLevel)
	player:SetAttribute("VacuumPower", HotelService.getVacuumPower(player))
	player:SetAttribute("BackpackCount", #data.Backpack)
	player:SetAttribute("BackpackCapacity", HotelService.getBackpackCapacity(player))
	player:SetAttribute("BackpackIds", backpackString(data))
	updateCashAttributes(player, data)

	-- Release prices depend on the multiplier, keep the prompts in sync.
	for room, model in state.RoomModels do
		local entry = data.Rooms[tostring(room)]
		local prompt = model.PrimaryPart and model.PrimaryPart:FindFirstChildOfClass("ProximityPrompt")
		if entry and prompt then
			prompt.ObjectText = "+" .. Format.money(Formulas.releaseValue(entry.Id, entry.Mutation, state.Multiplier))
		end
	end
	updateStations(player)
	updateRegister(player)
	applyWalkSpeed(player)

	local stars = data.Builds
	state.Plot.SignLabel.Text = player.DisplayName .. "'s Hotel"
	state.Plot.StarsLabel.Text = string.rep("★", stars) .. string.rep("☆", #Config.HotelBuilds - stars)
end

--------------------------------------------------------------------------
-- Gameplay actions
--------------------------------------------------------------------------
local function freeRooms(player: Player): { number }
	local state = states[player]
	local free = {}
	if not state then
		return free
	end
	local vip = PassCache.owns(player, "VIP")
	local order = table.clone(Formulas.RoomOrder)
	for room = 1, Formulas.TotalRooms do
		if Formulas.isVipRoom(room) then
			table.insert(order, room)
		end
	end
	for _, room in order do
		if Formulas.isRoomOpen(room, state.Data.UnlockedRooms, vip) and state.Data.Rooms[tostring(room)] == nil then
			table.insert(free, room)
		end
	end
	return free
end

-- Adds a freshly caught ghost to the player's backpack.
function HotelService.addToBackpack(player: Player, ghostId: string, mutation: string?): boolean
	local state = states[player]
	if not state or HotelService.isBackpackFull(player) then
		return false
	end
	table.insert(state.Data.Backpack, { Id = ghostId, Mutation = mutation })
	state.Data.Caught += 1
	HotelService.refresh(player)
	return true
end

-- Moves ghosts from the backpack into free rooms.
function HotelService.checkIn(player: Player)
	local state = states[player]
	if not state or #state.Data.Backpack == 0 then
		return
	end
	local free = freeRooms(player)
	local count = 0
	while #state.Data.Backpack > 0 and #free > 0 do
		local ghost = table.remove(state.Data.Backpack, 1)
		local room = table.remove(free, 1) :: number
		state.Data.Rooms[tostring(room)] = { Id = ghost.Id, Mutation = ghost.Mutation }
		renderRoom(player, room)
		count += 1
	end
	if count > 0 then
		HotelService.refresh(player)
		Remotes.notify(
			player,
			"🏨 Checked in " .. count .. " ghost" .. (if count > 1 then "s" else "") .. "!",
			"success"
		)
		effect(player, "checkin", state.Plot.Register.Position)
	end
	if #state.Data.Backpack > 0 and os.clock() - state.LastFullWarning > 12 then
		state.LastFullWarning = os.clock()
		Remotes.notify(player, "Your hotel is full! Unlock rooms or release ghosts.", "error")
	end
end

function HotelService.releaseGhost(player: Player, room: number)
	local state = states[player]
	if not state then
		return
	end
	local entry = state.Data.Rooms[tostring(room)]
	if not entry then
		return
	end
	local value = Formulas.releaseValue(entry.Id, entry.Mutation, state.Multiplier)
	state.Data.Rooms[tostring(room)] = nil
	state.Data.Cash += value
	renderRoom(player, room)
	HotelService.refresh(player)
	Remotes.notify(
		player,
		"👋 Released " .. Config.GhostsById[entry.Id].Name .. " for +" .. Format.money(value),
		"success"
	)
	effect(player, "release", state.Plot.Rooms[room].Base.Position)
end

function HotelService.unlockRoom(player: Player)
	local state = states[player]
	if not state then
		return
	end
	local cost = Formulas.roomCost(state.Data.UnlockedRooms)
	if not cost or not HotelService.trySpend(player, cost) then
		return
	end
	state.Data.UnlockedRooms += 1
	renderAllRooms(player)
	HotelService.refresh(player)
	Remotes.notify(player, "🔓 New room unlocked!", "success")
	effect(player, "build", state.Plot.Register.Position)
	HotelService.checkIn(player)
end

function HotelService.upgrade(player: Player, kind: string)
	local state = states[player]
	if not state then
		return
	end
	local field = if kind == "Vacuum" then "VacuumLevel" else "BackpackLevel"
	local cost = Formulas.upgradeCost(kind, state.Data[field])
	if not cost or not HotelService.trySpend(player, cost) then
		return
	end
	state.Data[field] += 1
	HotelService.refresh(player)
	Remotes.notify(
		player,
		Config.Upgrades[kind].Icon .. " " .. kind .. " upgraded to level " .. state.Data[field] .. "!",
		"success"
	)
	effect(player, "build", state.Plot.Stations[kind].Position)
end

function HotelService.buyNextBuild(player: Player)
	local state = states[player]
	if not state or os.clock() - state.LastBuild < 1 then
		return
	end
	local build = Config.HotelBuilds[state.Data.Builds + 1]
	if not build then
		return
	end
	state.LastBuild = os.clock()
	if not HotelService.trySpend(player, build.Price) then
		return
	end
	state.Data.Builds += 1
	renderBuilds(player, true)
	HotelService.refresh(player)
	Remotes.notify(
		player,
		string.format("🔨 Built %s! Income +%d%%", build.Name, math.floor(build.IncomeBonus * 100 + 0.5)),
		"success"
	)
	effect(player, "build", state.Plot.BuildPad.Position)
end

function HotelService.fuse(player: Player)
	local state = states[player]
	if not state then
		return
	end
	local groups: { [string]: { number } } = {}
	for key, entry in state.Data.Rooms do
		if Formulas.nextMutation(entry.Mutation) then
			local groupKey = entry.Id .. "|" .. (entry.Mutation or "")
			groups[groupKey] = groups[groupKey] or {}
			table.insert(groups[groupKey], tonumber(key) :: number)
		end
	end

	local bestRooms, bestIncome = nil, -1
	for _, rooms in groups do
		if #rooms >= Config.FuseCount then
			local entry = state.Data.Rooms[tostring(rooms[1])]
			local income = Formulas.ghostIncome(entry.Id, Formulas.nextMutation(entry.Mutation))
			if income > bestIncome then
				bestRooms, bestIncome = rooms, income
			end
		end
	end

	if not bestRooms then
		Remotes.notify(
			player,
			"🧪 Put " .. Config.FuseCount .. " identical ghosts (same mutation) in your rooms to fuse!",
			"error"
		)
		return
	end

	table.sort(bestRooms)
	local first = state.Data.Rooms[tostring(bestRooms[1])]
	local result = { Id = first.Id, Mutation = Formulas.nextMutation(first.Mutation) }
	for index = 1, Config.FuseCount do
		state.Data.Rooms[tostring(bestRooms[index])] = nil
	end
	state.Data.Rooms[tostring(bestRooms[1])] = result
	for index = 1, Config.FuseCount do
		renderRoom(player, bestRooms[index])
	end
	HotelService.refresh(player)
	Remotes.notify(
		player,
		string.format("🧪 Fused into a %s %s!", string.upper(result.Mutation), Config.GhostsById[result.Id].Name),
		"success"
	)
	effect(player, "fuse", state.Plot.Stations.Cauldron.Position)
end

function HotelService.collect(player: Player)
	local state = states[player]
	if not state or os.clock() - state.LastCollect < 0.5 then
		return
	end
	local amount = math.floor(state.Data.Stored)
	if amount < 1 then
		return
	end
	state.LastCollect = os.clock()
	state.Data.Stored -= amount
	state.Data.Cash += amount
	updateCashAttributes(player, state.Data)
	updateRegister(player)
	effect(player, "collect", state.Plot.Register.Position)
end

function HotelService.rebirth(player: Player)
	local state = states[player]
	if not state then
		return
	end
	local data = state.Data
	local cost = Formulas.rebirthCost(data.Rebirths)
	if data.Cash < cost then
		Remotes.notify(player, "You need " .. Format.money(cost) .. " to rebirth.", "error")
		return
	end
	data.Rebirths += 1
	data.Cash = Config.Rebirth.StartCash
	data.Stored = 0
	data.Builds = 0
	data.UnlockedRooms = Config.StartRooms
	data.Rooms = {}
	data.Backpack = {}
	data.VacuumLevel = 1
	data.BackpackLevel = 1
	renderBuilds(player, false)
	renderAllRooms(player)
	HotelService.refresh(player)
	Remotes.notifyAll("♻️ " .. player.DisplayName .. " rebirthed! (Rebirth " .. data.Rebirths .. ")", "event")
	effect(nil, "rebirth", state.Plot.Register.Position)
	task.spawn(DataService.save, player)
end

function HotelService.teleportHome(player: Player)
	local state = states[player]
	local character = player.Character
	if not state or not character or os.clock() - state.LastTeleport < Config.HomeTeleportCooldown then
		return
	end
	state.LastTeleport = os.clock()
	character:PivotTo(state.Plot.SpawnCFrame)
end

--------------------------------------------------------------------------
-- Player lifecycle
--------------------------------------------------------------------------
function HotelService.assign(player: Player): Plot?
	for _, plot in plots do
		if plot.Owner == nil then
			plot.Owner = player
			return plot
		end
	end
	return nil
end

function HotelService.setup(player: Player, plot: Plot, data)
	local state: State = {
		Data = data,
		Plot = plot,
		RoomModels = {},
		Income = 0,
		Multiplier = 1,
		LastCollect = 0,
		LastBuild = 0,
		LastFullWarning = 0,
		LastTeleport = 0,
	}
	states[player] = state
	plot.Owner = player
	plot.Model:SetAttribute("OwnerUserId", player.UserId)
	for _, station in plot.Stations do
		local prompt = station:FindFirstChildOfClass("ProximityPrompt")
		if prompt then
			prompt:SetAttribute("OwnerUserId", player.UserId)
		end
	end

	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"
	local cash = Instance.new("StringValue")
	cash.Name = "Cash"
	cash.Parent = leaderstats
	local ghosts = Instance.new("IntValue")
	ghosts.Name = "Ghosts"
	ghosts.Parent = leaderstats
	local rebirths = Instance.new("IntValue")
	rebirths.Name = "Rebirths"
	rebirths.Parent = leaderstats
	leaderstats.Parent = player

	-- Drop anything that no longer exists in the config.
	for key, entry in data.Rooms do
		if not Config.GhostsById[entry.Id] then
			data.Rooms[key] = nil
		end
	end
	for index = #data.Backpack, 1, -1 do
		if not Config.GhostsById[data.Backpack[index].Id] then
			table.remove(data.Backpack, index)
		end
	end

	HotelService.refresh(player)
	renderBuilds(player, false)
	renderAllRooms(player)

	-- Offline earnings
	if data.LastOnline > 0 and state.Income > 0 then
		local away = math.min(os.time() - data.LastOnline, Config.OfflineEarningsMaxSeconds)
		local earned = math.floor(state.Income * math.max(away, 0) * Config.OfflineEarningsRate)
		if earned > 0 then
			data.Cash += earned
			updateCashAttributes(player, data)
			task.delay(3, function()
				if player.Parent then
					Remotes.notify(
						player,
						"🌙 Your ghosts earned " .. Format.money(earned) .. " while you were away!",
						"success"
					)
				end
			end)
		end
	end

	player:SetAttribute("PlotIndex", plot.Index)
	player:SetAttribute("Loaded", true)
end

function HotelService.cleanup(player: Player)
	local state = states[player]
	for _, plot in plots do
		if plot.Owner == player then
			plot.Owner = nil
		end
	end
	if not state then
		return
	end
	local plot = state.Plot
	for _, model in state.RoomModels do
		model:Destroy()
	end
	for room = 1, Formulas.TotalRooms do
		local info = plot.Rooms[room]
		clearPrompts(info.Base)
		info.Ring.Color = COLOR_LOCKED
		info.Label.Text = ""
	end
	for key in plot.Builds do
		setBuildVisible(plot, key, false, false)
	end
	for key, label in plot.StationLabels do
		label.Text = ""
		local prompt = plot.Stations[key]:FindFirstChildOfClass("ProximityPrompt")
		if prompt then
			prompt:SetAttribute("OwnerUserId", 0)
		end
	end
	plot.Model:SetAttribute("OwnerUserId", 0)
	plot.SignLabel.Text = "Empty Hotel"
	plot.StarsLabel.Text = ""
	plot.RegisterLabel.Text = ""
	plot.BuildLabel.Text = ""
	states[player] = nil
end

function HotelService.onCharacterAdded(player: Player, character: Model)
	local state = states[player]
	if not state then
		return
	end
	local root = character:WaitForChild("HumanoidRootPart", 10)
	if root and states[player] == state then
		task.defer(function()
			character:PivotTo(state.Plot.SpawnCFrame)
		end)
	end
	applyWalkSpeed(player)
end

--------------------------------------------------------------------------
-- Startup
--------------------------------------------------------------------------
local function ownerTouch(part: BasePart, plotRef: Plot, callback: (Player) -> ())
	part.Touched:Connect(function(hit)
		local player = playerFromHit(hit)
		if player and isOwner(player, plotRef) then
			callback(player)
		end
	end)
end

function HotelService.init(builtPlots: { Plot })
	plots = builtPlots
	for _, plot in plots do
		ownerTouch(plot.Register, plot, HotelService.collect)
		ownerTouch(plot.BuildPad, plot, HotelService.buyNextBuild)

		for kind in Config.Upgrades do
			local prompt = makePrompt(plot.Stations[kind], "Upgrade " .. kind, "", 0.3, nil)
			prompt.Triggered:Connect(function(player)
				if isOwner(player, plot) then
					HotelService.upgrade(player, kind)
				end
			end)
		end
		local fusePrompt = makePrompt(plot.Stations.Cauldron, "Fuse Ghosts", "3 → 1", 1, nil)
		fusePrompt.Triggered:Connect(function(player)
			if isOwner(player, plot) then
				HotelService.fuse(player)
			end
		end)
	end
end

function HotelService.start()
	PassCache.Changed:Connect(function(player)
		if states[player] then
			renderAllRooms(player)
			HotelService.refresh(player)
			HotelService.checkIn(player)
		end
	end)

	Remotes.Rebirth.OnServerEvent:Connect(HotelService.rebirth)
	Remotes.TeleportHome.OnServerEvent:Connect(HotelService.teleportHome)

	-- Income tick
	Loop.every(1, "Income", function()
		for player, state in states do
			if state.Income > 0 then
				state.Data.Stored += state.Income
				state.Data.TotalEarned += state.Income
				player:SetAttribute("Stored", math.floor(state.Data.Stored))
				updateRegister(player)
			end
		end
	end)

	-- Automatically check ghosts in when their hunter walks into the hotel.
	Loop.every(0.5, "CheckIn", function()
		for player, state in states do
			local character = player.Character
			local root = character and character:FindFirstChild("HumanoidRootPart")
			if root and #state.Data.Backpack > 0 and MapBuilder.isInside(state.Plot, (root :: BasePart).Position) then
				HotelService.checkIn(player)
			end
		end
	end)
end

return HotelService
