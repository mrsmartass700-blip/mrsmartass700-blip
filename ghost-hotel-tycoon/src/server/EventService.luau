-- Witching Hour: a server-wide event with boosted rare ghost odds and
-- more spawns. Happens on a timer and can be summoned with Robux.
-- State is mirrored on ReplicatedStorage attributes for the client UI.

local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local Config = require(ReplicatedStorage.Shared.Config)
local Loop = require(script.Parent.Loop)
local Remotes = require(script.Parent.Remotes)

local EventService = {}

local endsAt = 0
local active = false

local NORMAL = {
	ClockTime = 20.8,
	Ambient = Color3.fromRGB(75, 65, 100),
	OutdoorAmbient = Color3.fromRGB(95, 85, 130),
	Tint = Color3.new(1, 1, 1),
}
local WITCHING = {
	ClockTime = 0,
	Ambient = Color3.fromRGB(110, 50, 120),
	OutdoorAmbient = Color3.fromRGB(140, 60, 150),
	Tint = Color3.fromRGB(255, 205, 235),
}

local function now(): number
	return workspace:GetServerTimeNow()
end

local function applyLighting(preset)
	local info = TweenInfo.new(3, Enum.EasingStyle.Sine)
	TweenService:Create(Lighting, info, {
		ClockTime = preset.ClockTime,
		Ambient = preset.Ambient,
		OutdoorAmbient = preset.OutdoorAmbient,
	}):Play()
	local grading = Lighting:FindFirstChild("Grading")
	if grading then
		TweenService:Create(grading, info, { TintColor = preset.Tint }):Play()
	end
end

local function publish()
	ReplicatedStorage:SetAttribute("WitchingHour", active)
	ReplicatedStorage:SetAttribute("WitchingHourEndsAt", endsAt)
end

function EventService.isActive(): boolean
	return active
end

function EventService.getLuck(): number
	return if active then Config.WitchingHour.Luck else 1
end

function EventService.getSpawnRate(): number
	return if active then Config.WitchingHour.SpawnRate else 1
end

-- Starts the event or extends it when it is already running.
function EventService.start(duration: number, summonedBy: Player?)
	local wasActive = active
	endsAt = math.max(endsAt, now()) + duration
	active = true
	publish()
	if not wasActive then
		applyLighting(WITCHING)
	end
	if summonedBy then
		Remotes.notifyAll("🌕 " .. summonedBy.DisplayName .. " summoned the WITCHING HOUR! Rare ghosts x3!", "event")
	elseif not wasActive then
		Remotes.notifyAll("🌕 The WITCHING HOUR has begun! Rare ghosts x3!", "event")
	end
end

function EventService.run()
	publish()
	local nextNatural = now() + Config.WitchingHour.Every
	Loop.every(1, "WitchingHour", function()
		local time = now()
		if active and time >= endsAt then
			active = false
			publish()
			applyLighting(NORMAL)
			Remotes.notifyAll("☀️ The Witching Hour is over.", "info")
			nextNatural = math.max(nextNatural, time + Config.WitchingHour.Every / 2)
		elseif not active and time >= nextNatural then
			EventService.start(Config.WitchingHour.Duration)
			nextNatural = time + Config.WitchingHour.Every
		end
	end)
end

return EventService
