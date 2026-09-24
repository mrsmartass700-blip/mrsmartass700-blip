-- Player data persistence with a lightweight session lock, so a player who
-- hops servers quickly never loads stale data or gets rolled back.

local DataStoreService = game:GetService("DataStoreService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Config = require(ReplicatedStorage.Shared.Config)
local Loop = require(script.Parent.Loop)

local STORE_NAME = "GhostHotel_v1"
local AUTOSAVE_INTERVAL = 90
local LOAD_ATTEMPTS = 5
local LOAD_RETRY_DELAY = 6
local STALE_SESSION_SECONDS = 10 * 60
local MAX_PURCHASE_HISTORY = 100

local DEFAULT_DATA = {
	Cash = Config.StartingCash,
	Rebirths = 0,
	Builds = 0,
	UnlockedRooms = Config.StartRooms,
	Rooms = {}, -- ["<room>"] = { Id = ghostId, Mutation = name? }
	Backpack = {}, -- { { Id = ghostId, Mutation = name? } }
	VacuumLevel = 1,
	BackpackLevel = 1,
	Stored = 0, -- cash waiting in the register
	TotalEarned = 0,
	Caught = 0,
	LastOnline = 0,
	Purchases = {}, -- recent developer product PurchaseIds (idempotency)
}

type Profile = {
	Data: any,
	Key: string,
	CanSave: boolean,
	Releasing: boolean,
}

local DataService = {}

local profiles: { [Player]: Profile } = {}

local store: DataStore? = nil
do
	local ok, result = pcall(function()
		return DataStoreService:GetDataStore(STORE_NAME)
	end)
	if ok then
		store = result
	else
		warn("[DataService] DataStores unavailable:", result)
	end
end

local function deepCopy(value: any): any
	if type(value) ~= "table" then
		return value
	end
	local copy = {}
	for key, inner in value do
		copy[key] = deepCopy(inner)
	end
	return copy
end

-- Adds keys that were introduced after the player's data was first saved.
local function reconcile(data: any): any
	for key, default in DEFAULT_DATA do
		if data[key] == nil then
			data[key] = deepCopy(default)
		end
	end
	return data
end

local function keyFor(player: Player): string
	return "player_" .. player.UserId
end

local function studioFallback(player: Player): any
	warn(
		"[DataService] Using temporary data for "
			.. player.Name
			.. " (enable 'Studio Access to API Services' to test saving)."
	)
	local data = deepCopy(DEFAULT_DATA)
	profiles[player] = { Data = data, Key = keyFor(player), CanSave = false, Releasing = false }
	return data
end

-- Loads (and session-locks) the player's data. Yields. Returns nil when the
-- data could not be loaded safely; the caller should kick the player.
function DataService.load(player: Player): any?
	if not store then
		return if RunService:IsStudio() then studioFallback(player) else nil
	end

	local key = keyFor(player)
	for attempt = 1, LOAD_ATTEMPTS do
		local locked = false
		local loaded = nil
		local ok, err = pcall(function()
			(store :: DataStore):UpdateAsync(key, function(stored)
				locked = false
				stored = stored or {}
				local session = stored.Session
				local isForeign = session ~= nil and session.JobId ~= game.JobId
				local isFresh = session ~= nil and os.time() - (session.Time or 0) < STALE_SESSION_SECONDS
				-- On the last attempt we take the lock over: the other server
				-- most likely crashed without releasing it.
				if isForeign and isFresh and attempt < LOAD_ATTEMPTS then
					locked = true
					return nil
				end
				stored.Session = { JobId = game.JobId, Time = os.time() }
				loaded = stored.Data
				return stored
			end)
		end)

		if ok and not locked then
			local data = reconcile(loaded or deepCopy(DEFAULT_DATA))
			profiles[player] = { Data = data, Key = key, CanSave = true, Releasing = false }
			if not player.Parent then
				-- Left while loading: give the session lock straight back.
				task.spawn(DataService.release, player)
				return nil
			end
			return data
		end

		if not player.Parent then
			return nil
		end

		if not ok then
			warn("[DataService] Load attempt", attempt, "failed for", player.Name, err)
			if RunService:IsStudio() then
				return studioFallback(player)
			end
		end
		task.wait(LOAD_RETRY_DELAY)
	end

	return nil
end

function DataService.get(player: Player): any?
	local profile = profiles[player]
	return profile and profile.Data
end

local function write(player: Player, profile: Profile, release: boolean): boolean
	if not profile.CanSave then
		return true
	end
	profile.Data.LastOnline = os.time()

	local lostSession = false
	local ok, err = pcall(function()
		(store :: DataStore):UpdateAsync(profile.Key, function(stored)
			lostSession = false
			stored = stored or {}
			local session = stored.Session
			if session and session.JobId ~= game.JobId then
				lostSession = true
				return nil
			end
			stored.Data = profile.Data
			stored.Session = if release then nil else { JobId = game.JobId, Time = os.time() }
			return stored
		end)
	end)

	if lostSession then
		-- Another server owns this player's data now; never overwrite it.
		profile.CanSave = false
		warn("[DataService] Session for", player.Name, "was taken over; stopped saving here.")
		return false
	end
	if not ok then
		warn("[DataService] Save failed for", player.Name, err)
	end
	return ok
end

function DataService.save(player: Player): boolean
	local profile = profiles[player]
	if not profile or profile.Releasing then
		return false
	end
	return write(player, profile, false)
end

-- Final save + unlock. Call when the player leaves.
function DataService.release(player: Player)
	local profile = profiles[player]
	if not profile or profile.Releasing then
		return
	end
	profile.Releasing = true
	for _ = 1, 3 do
		if write(player, profile, true) then
			break
		end
		task.wait(2)
	end
	profiles[player] = nil
end

-- Remembers a developer product purchase so it is never granted twice.
function DataService.hasPurchase(player: Player, purchaseId: string): boolean
	local data = DataService.get(player)
	return data ~= nil and table.find(data.Purchases, purchaseId) ~= nil
end

function DataService.addPurchase(player: Player, purchaseId: string)
	local data = DataService.get(player)
	if not data then
		return
	end
	table.insert(data.Purchases, purchaseId)
	while #data.Purchases > MAX_PURCHASE_HISTORY do
		table.remove(data.Purchases, 1)
	end
end

function DataService.start()
	Loop.every(AUTOSAVE_INTERVAL, "Autosave", function()
		for player in profiles do
			task.spawn(DataService.save, player)
		end
	end)

	game:BindToClose(function()
		local pending = 0
		for player in profiles do
			pending += 1
			task.spawn(function()
				DataService.release(player)
				pending -= 1
			end)
		end
		local deadline = os.clock() + 25
		while (pending > 0 or next(profiles) ~= nil) and os.clock() < deadline do
			task.wait(0.2)
		end
	end)
end

return DataService
