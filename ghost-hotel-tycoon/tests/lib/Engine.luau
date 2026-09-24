--!nocheck
-- A small stand-in for the parts of the Roblox engine the server scripts
-- touch: events, remotes, players/characters, pivots, tweens, DataStores and
-- MarketplaceService. Installed on top of Lune's Roblox instance model.
--
-- Needs a Lune build where implemented properties take precedence over
-- reflected ones (see tests/README.md).

local roblox = require("@lune/roblox")
local serde = require("@lune/serde")
local task = require("@lune/task")

local Instance = roblox.Instance
local CFrame = roblox.CFrame
local Enum = roblox.Enum

local Engine = {
	ClientLog = {}, -- { { Player, Remote, Args } }
	Kicked = {}, -- [Player] = message
	CloseHandlers = {},
	Stores = {}, -- [name] = FakeStore
	OwnedPasses = {}, -- ["userId:passId"] = true
	DevProducts = {}, -- { { ProductId, Name } }
	JobId = "test-server-1",
	ProcessReceipt = nil,
	-- client side
	LocalPlayer = nil,
	Errors = {}, -- errors raised inside event handlers
	PurchasePrompts = {}, -- { { Kind, Id } }
	Prices = {}, -- [id] = PriceInRobux
	OnIncomingMessage = nil,
}

--------------------------------------------------------------------------
-- Signals
--------------------------------------------------------------------------
local Signal = {}
Signal.__index = Signal

function Signal.new()
	return setmetatable({ Handlers = {} }, Signal)
end

function Signal:Connect(handler)
	local handlers = self.Handlers
	table.insert(handlers, handler)
	return {
		Disconnect = function()
			local index = table.find(handlers, handler)
			if index then
				table.remove(handlers, index)
			end
		end,
	}
end

function Signal:Fire(...)
	for _, handler in table.clone(self.Handlers) do
		task.spawn(function(...)
			local ok, err = pcall(handler, ...)
			if not ok then
				table.insert(Engine.Errors, tostring(err))
				print("[handler error] " .. tostring(err))
			end
		end, ...)
	end
end

function Signal:Wait()
	local thread = coroutine.running()
	local connection
	connection = self:Connect(function(...)
		connection.Disconnect()
		task.spawn(thread, ...)
	end)
	return coroutine.yield()
end

Engine.Signal = Signal

local signals = {}

function Engine.signal(instance, name: string)
	signals[instance] = signals[instance] or {}
	local signal = signals[instance][name]
	if not signal then
		signal = Signal.new()
		signals[instance][name] = signal
	end
	return signal
end

local function event(className: string, name: string)
	roblox.implementProperty(className, name, function(instance)
		return Engine.signal(instance, name)
	end)
end

--------------------------------------------------------------------------
-- Fake DataStore (JSON round trip, like the real thing)
--------------------------------------------------------------------------
local FakeStore = {}
FakeStore.__index = FakeStore

function FakeStore.new()
	return setmetatable({ Data = {}, Writes = 0, FailNext = 0 }, FakeStore)
end

function FakeStore:UpdateAsync(key: string, transform)
	if self.FailNext > 0 then
		self.FailNext -= 1
		error("simulated DataStore outage")
	end
	local raw = self.Data[key]
	local current = if raw then serde.decode("json", raw) else nil
	local result = transform(current)
	if result ~= nil then
		self.Data[key] = serde.encode("json", result)
		self.Writes += 1
	end
	return result
end

function FakeStore:read(key: string)
	local raw = self.Data[key]
	return if raw then serde.decode("json", raw) else nil
end

--------------------------------------------------------------------------
-- Characters
--------------------------------------------------------------------------
function Engine.makeCharacter(player)
	local character = Instance.new("Model")
	character.Name = player.Name
	local root = Instance.new("Part")
	root.Name = "HumanoidRootPart"
	root.Size = roblox.Vector3.new(2, 2, 1)
	root.CFrame = CFrame.new(0, 3, 0)
	root.Parent = character
	character.PrimaryPart = root
	local humanoid = Instance.new("Humanoid")
	humanoid.Health = 100
	humanoid.MaxHealth = 100
	humanoid.WalkSpeed = 16
	humanoid.Parent = character
	return character
end

--------------------------------------------------------------------------
-- Install
--------------------------------------------------------------------------
local membership = {}

function Engine.install(game)
	-- Generic
	roblox.implementMethod("Instance", "WaitForChild", function(self, name)
		return self:FindFirstChild(name)
	end)
	roblox.implementProperty("BasePart", "Position", function(self)
		return self.CFrame.Position
	end, function(self, position)
		self.CFrame = CFrame.new(position) * self.CFrame.Rotation
	end)
	roblox.implementMethod("BasePart", "SetNetworkOwner", function() end)
	-- Lune cannot assign nil to Ref properties; keep beam targets in Lua.
	local beamTargets = {}
	roblox.implementProperty("Beam", "Attachment1", function(self)
		return beamTargets[self]
	end, function(self, value)
		beamTargets[self] = value
	end)

	local function getPivot(model)
		if model.PrimaryPart then
			return model.PrimaryPart.CFrame
		end
		for _, descendant in model:GetDescendants() do
			if descendant:IsA("BasePart") then
				return descendant.CFrame
			end
		end
		return CFrame.new()
	end
	roblox.implementMethod("Model", "GetPivot", getPivot)
	roblox.implementMethod("Model", "PivotTo", function(self, target)
		local delta = target * getPivot(self):Inverse()
		for _, descendant in self:GetDescendants() do
			if descendant:IsA("BasePart") then
				descendant.CFrame = delta * descendant.CFrame
			end
		end
	end)

	-- Events
	event("BasePart", "Touched")
	event("ProximityPrompt", "Triggered")
	for _, name in { "Activated", "Deactivated", "Equipped", "Unequipped" } do
		event("Tool", name)
	end
	event("RemoteEvent", "OnServerEvent")
	event("RemoteEvent", "OnClientEvent")
	event("BindableEvent", "Event")
	event("Humanoid", "Died")
	event("Player", "CharacterAdded")
	for _, name in { "PlayerAdded", "PlayerRemoving", "PlayerMembershipChanged" } do
		event("Players", name)
	end
	event("MarketplaceService", "PromptGamePassPurchaseFinished")

	roblox.implementMethod("BindableEvent", "Fire", function(self, ...)
		Engine.signal(self, "Event"):Fire(...)
	end)
	roblox.implementMethod("RemoteEvent", "FireClient", function(self, player, ...)
		table.insert(Engine.ClientLog, { Player = player, Remote = self.Name, Args = { ... } })
		if player == Engine.LocalPlayer then
			Engine.signal(self, "OnClientEvent"):Fire(...)
		end
	end)
	roblox.implementMethod("RemoteEvent", "FireAllClients", function(self, ...)
		table.insert(Engine.ClientLog, { Player = "all", Remote = self.Name, Args = { ... } })
		if Engine.LocalPlayer then
			Engine.signal(self, "OnClientEvent"):Fire(...)
		end
	end)
	roblox.implementMethod("RemoteEvent", "FireServer", function(self, ...)
		Engine.signal(self, "OnServerEvent"):Fire(Engine.LocalPlayer, ...)
	end)

	-- Client-side engine pieces
	roblox.implementProperty("Players", "LocalPlayer", function()
		return Engine.LocalPlayer
	end)
	roblox.implementMethod("Instance", "GetAttributeChangedSignal", function(self, name)
		return Engine.signal(self, "Attribute:" .. name)
	end)
	event("Instance", "DescendantAdded")
	for _, name in { "Activated", "MouseButton1Down", "MouseButton1Up", "MouseEnter", "MouseLeave" } do
		event("GuiButton", name)
	end
	event("RunService", "RenderStepped")
	event("RunService", "Heartbeat")
	event("ProximityPromptService", "PromptTriggered")
	roblox.implementMethod("CollectionService", "GetTagged", function(_, tag)
		local list = {}
		for _, descendant in game:GetDescendants() do
			if descendant:HasTag(tag) then
				table.insert(list, descendant)
			end
		end
		return list
	end)
	roblox.implementMethod("CollectionService", "GetInstanceAddedSignal", function(self, tag)
		return Engine.signal(self, "Added:" .. tag)
	end)
	roblox.implementMethod("CollectionService", "GetInstanceRemovedSignal", function(self, tag)
		return Engine.signal(self, "Removed:" .. tag)
	end)
	roblox.implementProperty("TextChatService", "OnIncomingMessage", function()
		return Engine.OnIncomingMessage
	end, function(_, callback)
		Engine.OnIncomingMessage = callback
	end)
	roblox.implementMethod("MarketplaceService", "GetProductInfoAsync", function(_, id)
		return { PriceInRobux = Engine.Prices[id] }
	end)
	roblox.implementMethod("MarketplaceService", "PromptGamePassPurchase", function(_, _player, id)
		table.insert(Engine.PurchasePrompts, { Kind = "Pass", Id = id })
	end)
	roblox.implementMethod("MarketplaceService", "PromptProductPurchase", function(_, _player, id)
		table.insert(Engine.PurchasePrompts, { Kind = "Product", Id = id })
	end)
	roblox.implementMethod("Debris", "AddItem", function() end)
	roblox.implementProperty("Camera", "ViewportSize", function()
		return roblox.Vector2.new(1280, 720)
	end)
	roblox.implementMethod("Sound", "Play", function() end)
	roblox.implementMethod("ParticleEmitter", "Emit", function() end)

	-- Players
	roblox.implementMethod("Players", "GetPlayers", function(self)
		local list = {}
		for _, child in self:GetChildren() do
			if child:IsA("Player") then
				table.insert(list, child)
			end
		end
		return list
	end)
	roblox.implementMethod("Players", "GetPlayerByUserId", function(self, userId)
		for _, child in self:GetChildren() do
			if child:IsA("Player") and child.UserId == userId then
				return child
			end
		end
		return nil
	end)
	roblox.implementMethod("Players", "GetPlayerFromCharacter", function(self, character)
		for _, child in self:GetChildren() do
			if child:IsA("Player") and child.Character == character then
				return child
			end
		end
		return nil
	end)
	roblox.implementProperty("Player", "MembershipType", function(self)
		return membership[self] or Enum.MembershipType.None
	end, function(self, value)
		membership[self] = value
	end)
	roblox.implementMethod("Player", "Kick", function(self, message)
		Engine.Kicked[self] = message or ""
	end)
	roblox.implementMethod("Player", "LoadCharacter", function(self)
		local old = self.Character
		if old then
			old:Destroy()
		end
		local character = Engine.makeCharacter(self)
		self.Character = character
		character.Parent = game:GetService("Workspace")
		Engine.signal(self, "CharacterAdded"):Fire(character)
	end)
	roblox.implementMethod("Humanoid", "EquipTool", function(self, tool)
		tool.Parent = self.Parent
	end)

	-- Services
	roblox.implementMethod("Workspace", "GetServerTimeNow", function()
		return os.clock()
	end)
	roblox.implementMethod("DataModel", "BindToClose", function(_, handler)
		table.insert(Engine.CloseHandlers, handler)
	end)
	roblox.implementProperty("DataModel", "JobId", function()
		return Engine.JobId
	end)
	roblox.implementMethod("RunService", "IsStudio", function()
		return false
	end)
	roblox.implementMethod("TweenService", "Create", function(_, instance, _info, goals)
		return {
			Play = function()
				for key, value in goals do
					instance[key] = value
				end
			end,
		}
	end)
	roblox.implementMethod("DataStoreService", "GetDataStore", function(_, name)
		Engine.Stores[name] = Engine.Stores[name] or FakeStore.new()
		return Engine.Stores[name]
	end)
	roblox.implementProperty("MarketplaceService", "ProcessReceipt", function()
		return Engine.ProcessReceipt
	end, function(_, callback)
		Engine.ProcessReceipt = callback
	end)
	roblox.implementMethod("MarketplaceService", "UserOwnsGamePassAsync", function(_, userId, passId)
		return Engine.OwnedPasses[userId .. ":" .. passId] == true
	end)
	roblox.implementMethod("MarketplaceService", "GetDeveloperProductsAsync", function()
		return {
			IsFinished = true,
			GetCurrentPage = function()
				return Engine.DevProducts
			end,
			AdvanceToNextPageAsync = function() end,
		}
	end)
end

-- Globals the scripts use that Lune does not provide.
Engine.TweenInfo = {
	new = function(...)
		return { ... }
	end,
}

--------------------------------------------------------------------------
-- Helpers for tests
--------------------------------------------------------------------------
function Engine.newPlayer(game, userId: number, name: string)
	local player = Instance.new("Player")
	player.Name = name
	player.DisplayName = name
	player.UserId = userId
	local backpack = Instance.new("Backpack")
	backpack.Parent = player
	local playerGui = Instance.new("PlayerGui")
	playerGui.Parent = player
	player.Parent = game:GetService("Players")
	return player
end

function Engine.notificationsFor(player): { string }
	local list = {}
	for _, entry in Engine.ClientLog do
		if entry.Remote == "Notify" and (entry.Player == player or entry.Player == "all") then
			table.insert(list, entry.Args[1])
		end
	end
	return list
end

-- Sets an attribute and fires its changed signal (Lune does not do that).
function Engine.setAttribute(instance, name: string, value: any)
	instance:SetAttribute(name, value)
	Engine.signal(instance, "Attribute:" .. name):Fire()
end

-- Finds the first descendant matching a predicate.
function Engine.find(root, predicate: (any) -> boolean)
	for _, descendant in root:GetDescendants() do
		if predicate(descendant) then
			return descendant
		end
	end
	return nil
end

function Engine.click(button)
	Engine.signal(button, "Activated"):Fire()
	task.wait(0.05)
end

function Engine.waitFor(predicate: () -> boolean, timeout: number): boolean
	local deadline = os.clock() + timeout
	while os.clock() < deadline do
		if predicate() then
			return true
		end
		task.wait(0.05)
	end
	return predicate()
end

return Engine
