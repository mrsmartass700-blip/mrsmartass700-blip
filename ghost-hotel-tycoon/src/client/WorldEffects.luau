-- Client-side juice: owner-only prompts, rainbow ghosts, bobbing room
-- ghosts, mini ghosts orbiting hunters, particle bursts, sounds and the
-- VIP chat tag.

local CollectionService = game:GetService("CollectionService")
local Debris = game:GetService("Debris")
local Players = game:GetService("Players")
local ProximityPromptService = game:GetService("ProximityPromptService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local SoundService = game:GetService("SoundService")
local TextChatService = game:GetService("TextChatService")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local GhostFactory = require(Shared.GhostFactory)

local player = Players.LocalPlayer

local WorldEffects = {}

local BOB_DISTANCE = 140
local MAX_MINIS = 6

--------------------------------------------------------------------------
-- Sounds
--------------------------------------------------------------------------
local SOUNDS = {
	collect = { Id = "rbxasset://sounds/electronicpingshort.wav", Pitch = 1.25, Volume = 0.6 },
	capture = { Id = "rbxasset://sounds/swordlunge.wav", Pitch = 1.5, Volume = 0.7 },
	rare = { Id = "rbxasset://sounds/electronicpingshort.wav", Pitch = 1.7, Volume = 0.8 },
	build = { Id = "rbxasset://sounds/electronicpingshort.wav", Pitch = 0.8, Volume = 0.7 },
	error = { Id = "rbxasset://sounds/clickfast.wav", Pitch = 0.8, Volume = 0.5 },
}

function WorldEffects.playSound(name: string)
	local info = SOUNDS[name]
	if not info then
		return
	end
	local sound = Instance.new("Sound")
	sound.SoundId = info.Id
	sound.PlaybackSpeed = info.Pitch
	sound.Volume = info.Volume
	sound.Parent = SoundService
	sound:Play()
	Debris:AddItem(sound, 3)
end

--------------------------------------------------------------------------
-- Particle bursts
--------------------------------------------------------------------------
local effectsFolder = Instance.new("Folder")
effectsFolder.Name = "LocalEffects"
effectsFolder.Parent = Workspace

local function burst(position: Vector3, color: Color3, count: number, speed: number)
	local anchor = Instance.new("Part")
	anchor.Anchored = true
	anchor.CanCollide = false
	anchor.CanQuery = false
	anchor.CanTouch = false
	anchor.Transparency = 1
	anchor.Size = Vector3.one
	anchor.Position = position
	anchor.Parent = effectsFolder

	local emitter = Instance.new("ParticleEmitter")
	emitter.Color = ColorSequence.new(color)
	emitter.LightEmission = 1
	emitter.Size = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 0.9),
		NumberSequenceKeypoint.new(1, 0),
	})
	emitter.Speed = NumberRange.new(speed * 0.5, speed)
	emitter.SpreadAngle = Vector2.new(180, 180)
	emitter.Lifetime = NumberRange.new(0.5, 1)
	emitter.Drag = 3
	emitter.Rate = 0
	emitter.Parent = anchor
	emitter:Emit(count)
	Debris:AddItem(anchor, 2)
end

local EFFECT_COLORS = {
	collect = Color3.fromRGB(120, 255, 140),
	checkin = Color3.fromRGB(90, 255, 220),
	build = Color3.fromRGB(255, 220, 90),
	fuse = Color3.fromRGB(190, 110, 255),
	release = Color3.fromRGB(220, 220, 255),
	rebirth = Color3.fromRGB(190, 110, 255),
	fade = Color3.fromRGB(180, 170, 210),
}

local function onEffect(kind: string, position: Vector3, rarity: number?)
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
	local near = root ~= nil and (root.Position - position).Magnitude < 90

	if kind == "capture" then
		local color = if rarity and Config.Rarities[rarity] then Config.Rarities[rarity].Color else Color3.new(1, 1, 1)
		burst(position, color, 18 + (rarity or 1) * 6, 12)
		if near then
			WorldEffects.playSound(if rarity and rarity >= 4 then "rare" else "capture")
		end
	elseif kind == "fade" then
		burst(position, EFFECT_COLORS.fade, 10, 5)
	else
		burst(position + Vector3.new(0, 2, 0), EFFECT_COLORS[kind] or Color3.new(1, 1, 1), 24, 14)
		if near then
			WorldEffects.playSound(if kind == "collect" then "collect" else "build")
		end
	end
end

--------------------------------------------------------------------------
-- Owner-only prompts
--------------------------------------------------------------------------
local function watchPrompt(prompt: ProximityPrompt)
	if not prompt:GetAttribute("OwnerOnly") then
		return
	end
	local function apply()
		local isOwner = prompt:GetAttribute("OwnerUserId") == player.UserId
		prompt.Enabled = isOwner and prompt:GetAttribute("ServerEnabled") ~= false
	end
	apply()
	prompt:GetAttributeChangedSignal("OwnerUserId"):Connect(apply)
	prompt:GetAttributeChangedSignal("ServerEnabled"):Connect(apply)
end

--------------------------------------------------------------------------
-- Room ghost bobbing
--------------------------------------------------------------------------
local bobbing: { [Model]: { Base: CFrame, Phase: number } } = {}

local function trackRoomGhost(instance: Instance)
	if instance:IsA("Model") then
		bobbing[instance] = { Base = instance:GetPivot(), Phase = math.random() * math.pi * 2 }
	end
end

--------------------------------------------------------------------------
-- Mini ghosts orbiting players who carry ghosts
--------------------------------------------------------------------------
local minis: { [Player]: { Key: string, Models: { Model } } } = {}

local function rebuildMinis(owner: Player, key: string)
	local entry = minis[owner]
	if entry then
		for _, model in entry.Models do
			model:Destroy()
		end
	end
	local models = {}
	if key ~= "" then
		for index, item in string.split(key, ",") do
			if index > MAX_MINIS then
				break
			end
			local parts = string.split(item, ":")
			local ghostId = parts[1]
			local mutation = if parts[2] and parts[2] ~= "" then parts[2] else nil
			if Config.GhostsById[ghostId] then
				local model = GhostFactory.build(ghostId, mutation, { Scale = 0.32, Billboard = false, Light = false })
				model.Parent = effectsFolder
				table.insert(models, model)
			end
		end
	end
	minis[owner] = { Key = key, Models = models }
end

local function updateMinis(now: number)
	for _, owner in Players:GetPlayers() do
		local key = owner:GetAttribute("BackpackIds") or ""
		local entry = minis[owner]
		if not entry or entry.Key ~= key then
			rebuildMinis(owner, key)
			entry = minis[owner]
		end
		local character = owner.Character
		local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
		local count = #entry.Models
		for index, model in entry.Models do
			if root then
				local angle = now * 1.6 + index * (math.pi * 2 / count)
				local offset =
					Vector3.new(math.cos(angle) * 3.2, 1.2 + math.sin(now * 3 + index) * 0.35, math.sin(angle) * 3.2)
				model:PivotTo(CFrame.new(root.Position + offset) * CFrame.Angles(0, -angle, 0))
			else
				model:PivotTo(CFrame.new(0, -500, 0))
			end
		end
	end
	for owner, entry in minis do
		if not owner.Parent then
			for _, model in entry.Models do
				model:Destroy()
			end
			minis[owner] = nil
		end
	end
end

--------------------------------------------------------------------------
-- Start
--------------------------------------------------------------------------
function WorldEffects.start()
	local remotes = ReplicatedStorage:WaitForChild("Remotes")
	remotes:WaitForChild("Effect").OnClientEvent:Connect(onEffect)

	for _, descendant in Workspace:GetDescendants() do
		if descendant:IsA("ProximityPrompt") then
			watchPrompt(descendant)
		end
	end
	Workspace.DescendantAdded:Connect(function(descendant)
		if descendant:IsA("ProximityPrompt") then
			watchPrompt(descendant)
		end
	end)
	ProximityPromptService.PromptTriggered:Connect(function()
		WorldEffects.playSound("collect")
	end)

	for _, instance in CollectionService:GetTagged("RoomGhost") do
		trackRoomGhost(instance)
	end
	CollectionService:GetInstanceAddedSignal("RoomGhost"):Connect(trackRoomGhost)
	CollectionService:GetInstanceRemovedSignal("RoomGhost"):Connect(function(instance)
		bobbing[instance :: Model] = nil
	end)

	RunService.RenderStepped:Connect(function()
		local now = os.clock()
		local camera = Workspace.CurrentCamera
		local cameraPosition = if camera then camera.CFrame.Position else Vector3.zero

		-- Rainbow mutation
		local rainbow = Color3.fromHSV((now * 0.25) % 1, 0.55, 1)
		for _, part in CollectionService:GetTagged("Rainbow") do
			(part :: BasePart).Color = rainbow
		end
		for _, gradient in CollectionService:GetTagged("RainbowGradient") do
			local uiGradient = (gradient :: Instance):FindFirstChildOfClass("UIGradient")
			if uiGradient then
				uiGradient.Offset = Vector2.new(math.sin(now * 1.5) * 0.4, 0)
			end
		end

		-- Room ghosts gently float
		for model, info in bobbing do
			if not model.Parent then
				bobbing[model] = nil
			elseif (info.Base.Position - cameraPosition).Magnitude < BOB_DISTANCE then
				local lift = math.sin(now * 2 + info.Phase) * 0.35
				local sway = math.sin(now * 0.8 + info.Phase) * 0.25
				model:PivotTo(info.Base * CFrame.new(0, lift, 0) * CFrame.Angles(0, sway, 0))
			end
		end

		updateMinis(now)
	end)

	-- [VIP] chat tag
	TextChatService.OnIncomingMessage = function(message: TextChatMessage)
		local source = message.TextSource
		local speaker = source and Players:GetPlayerByUserId(source.UserId)
		if speaker and speaker:GetAttribute("Pass_VIP") then
			local properties = Instance.new("TextChatMessageProperties")
			properties.PrefixText = '<font color="#FFD34D">[VIP]</font> ' .. message.PrefixText
			return properties
		end
		return nil
	end
end

return WorldEffects
