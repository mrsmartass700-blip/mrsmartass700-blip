-- Server entry point: builds the world, starts every service and runs the
-- player lifecycle (load data -> assign hotel -> spawn -> save on leave).

local Players = game:GetService("Players")

local Services = script.Parent
local DataService = require(Services.DataService)
local EventService = require(Services.EventService)
local GhostService = require(Services.GhostService)
local HotelService = require(Services.HotelService)
local MapBuilder = require(Services.MapBuilder)
local MonetizationService = require(Services.MonetizationService)
local PassCache = require(Services.PassCache)

Players.CharacterAutoLoads = false

local plots = MapBuilder.build()
HotelService.init(plots)

DataService.start()
PassCache.start()
EventService.run()
HotelService.start()
GhostService.start()
MonetizationService.start()

local function onCharacterAdded(player: Player, character: Model)
	HotelService.onCharacterAdded(player, character)
	GhostService.onCharacterAdded(player, character)

	local humanoid = character:WaitForChild("Humanoid", 10) :: Humanoid?
	if humanoid then
		humanoid.Died:Connect(function()
			task.wait(3)
			if player.Parent and player.Character == character then
				player:LoadCharacter()
			end
		end)
	end
end

local function onPlayerAdded(player: Player)
	local plot = HotelService.assign(player)
	if not plot then
		player:Kick("This server is full. Please join another server!")
		return
	end

	PassCache.load(player)
	local data = DataService.load(player)
	if not player.Parent then
		HotelService.cleanup(player)
		return
	end
	if not data then
		HotelService.cleanup(player)
		player:Kick("Your data could not be loaded. Please rejoin in a minute!")
		return
	end

	HotelService.setup(player, plot, data)

	player.CharacterAdded:Connect(function(character)
		onCharacterAdded(player, character)
	end)
	player:LoadCharacter()
end

Players.PlayerAdded:Connect(onPlayerAdded)
for _, player in Players:GetPlayers() do
	task.spawn(onPlayerAdded, player)
end

Players.PlayerRemoving:Connect(function(player)
	GhostService.onPlayerRemoving(player)
	HotelService.cleanup(player)
	DataService.release(player)
end)
