-- Tracks game pass ownership and Roblox Premium for every player.
-- Ownership is mirrored onto player attributes ("Pass_VIP" = true) so the
-- client UI can read it.

local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)

local PassCache = {}

local owned: { [Player]: { [string]: boolean } } = {}
local changed = Instance.new("BindableEvent")

-- Fires (player, passKey?) whenever a player's perks change.
PassCache.Changed = changed.Event

local function set(player: Player, key: string, value: boolean)
	owned[player] = owned[player] or {}
	if owned[player][key] == value then
		return
	end
	owned[player][key] = value
	player:SetAttribute("Pass_" .. key, value)
	changed:Fire(player, key)
end

function PassCache.owns(player: Player, key: string): boolean
	local passes = owned[player]
	return passes ~= nil and passes[key] == true
end

function PassCache.isPremium(player: Player): boolean
	return player.MembershipType == Enum.MembershipType.Premium
end

function PassCache.getPassId(key: string): number
	local pass = Config.GamePassesByKey[key]
	return if pass then pass.Id else 0
end

function PassCache.grant(player: Player, key: string)
	set(player, key, true)
end

-- Checks every configured pass. Yields.
function PassCache.load(player: Player)
	owned[player] = owned[player] or {}
	player:SetAttribute("Premium", PassCache.isPremium(player))
	for _, pass in Config.GamePasses do
		player:SetAttribute("Pass_" .. pass.Key, false)
	end
	for _, pass in Config.GamePasses do
		if pass.Id ~= 0 then
			task.spawn(function()
				local ok, result = pcall(function()
					return MarketplaceService:UserOwnsGamePassAsync(player.UserId, pass.Id)
				end)
				if ok and result and player.Parent then
					set(player, pass.Key, true)
				elseif not ok then
					warn("[PassCache] Could not check pass", pass.Name, result)
				end
			end)
		end
	end
end

function PassCache.start()
	Players.PlayerMembershipChanged:Connect(function(player)
		player:SetAttribute("Premium", PassCache.isPremium(player))
		changed:Fire(player, "Premium")
	end)

	Players.PlayerRemoving:Connect(function(player)
		owned[player] = nil
	end)
end

return PassCache
