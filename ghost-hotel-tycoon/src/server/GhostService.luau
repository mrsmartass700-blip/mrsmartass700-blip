-- Ghost hunting: ghosts spawn and float around the graveyard, players hold
-- the Ghost Vacuum to suck them in. Rarer ghosts take longer to catch and
-- several hunters can fight over the same ghost — first to 100% wins.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage.Shared
local Config = require(Shared.Config)
local GhostFactory = require(Shared.GhostFactory)
local Odds = require(Shared.Odds)

local EventService = require(script.Parent.EventService)
local HotelService = require(script.Parent.HotelService)
local Loop = require(script.Parent.Loop)
local MapBuilder = require(script.Parent.MapBuilder)
local Remotes = require(script.Parent.Remotes)

type Ghost = {
	Model: Model,
	Root: BasePart,
	Attachment: Attachment,
	Align: AlignPosition,
	Orient: AlignOrientation,
	Id: string,
	Mutation: string?,
	Rarity: number,
	Target: Vector3,
	NextWander: number,
	SpawnedAt: number,
	Phase: number,
	Progress: { [Player]: number },
	PulledBy: Player?,
	Fill: Frame?,
	Bar: Frame?,
	Captured: boolean,
}

type Hunter = {
	Tool: Tool,
	Beam: Beam,
	Active: boolean,
	Target: Ghost?,
	LastFullNotice: number,
}

local GhostService = {}

local TICK = 0.1
local FLOAT_HEIGHT = 3

local ghosts: { Ghost } = {}
local hunters: { [Player]: Hunter } = {}
local rng = Random.new()
local ghostFolder: Folder

--------------------------------------------------------------------------
-- Spawning
--------------------------------------------------------------------------
local function randomGraveyardPoint(): Vector3
	local min, max = MapBuilder.GraveyardMin, MapBuilder.GraveyardMax
	return Vector3.new(rng:NextNumber(min.X + 4, max.X - 4), 0, rng:NextNumber(min.Z + 4, max.Z - 4))
end

local function floatHeight(ghost: Ghost): number
	return FLOAT_HEIGHT + ghost.Root.Size.Y / 2
end

local function pickWanderTarget(ghost: Ghost)
	local min, max = MapBuilder.GraveyardMin, MapBuilder.GraveyardMax
	local current = ghost.Root.Position
	local offset = Vector3.new(rng:NextNumber(-35, 35), 0, rng:NextNumber(-20, 20))
	local target = Vector3.new(
		math.clamp(current.X + offset.X, min.X + 3, max.X - 3),
		floatHeight(ghost) + rng:NextNumber(0, 2.5),
		math.clamp(current.Z + offset.Z, min.Z + 3, max.Z - 3)
	)
	ghost.Target = target
	ghost.NextWander = os.clock() + rng:NextNumber(3, 7)
end

local function spawnGhost()
	local definition = Odds.rollGhost(EventService.getLuck(), rng)
	local mutation = Odds.rollMutation(rng)
	local model = GhostFactory.build(definition.Id, mutation)
	local root = model.PrimaryPart :: BasePart

	local point = randomGraveyardPoint()
	local start = Vector3.new(point.X, FLOAT_HEIGHT + root.Size.Y / 2, point.Z)
	model:PivotTo(CFrame.new(start) * CFrame.Angles(0, rng:NextNumber(0, math.pi * 2), 0))

	local attachment = Instance.new("Attachment")
	attachment.Name = "GhostAttachment"
	attachment.Parent = root

	local align = Instance.new("AlignPosition")
	align.Mode = Enum.PositionAlignmentMode.OneAttachment
	align.Attachment0 = attachment
	align.Position = start
	align.MaxForce = math.huge
	align.MaxVelocity = Config.Rarities[definition.Rarity].Speed
	align.Responsiveness = 25
	align.Parent = root

	local orient = Instance.new("AlignOrientation")
	orient.Mode = Enum.OrientationAlignmentMode.OneAttachment
	orient.Attachment0 = attachment
	orient.CFrame = root.CFrame.Rotation
	orient.MaxTorque = math.huge
	orient.Responsiveness = 12
	orient.Parent = root

	root.Anchored = false
	model.Parent = ghostFolder
	pcall(function()
		root:SetNetworkOwner(nil)
	end)

	local info = root:FindFirstChild("Info")
	local bar = info and info:FindFirstChild("Progress")

	local ghost: Ghost = {
		Model = model,
		Root = root,
		Attachment = attachment,
		Align = align,
		Orient = orient,
		Id = definition.Id,
		Mutation = mutation,
		Rarity = definition.Rarity,
		Target = start,
		NextWander = 0,
		SpawnedAt = os.clock(),
		Phase = rng:NextNumber(0, math.pi * 2),
		Progress = {},
		PulledBy = nil,
		Bar = bar,
		Fill = bar and bar:FindFirstChild("Fill"),
		Captured = false,
	}
	pickWanderTarget(ghost)
	table.insert(ghosts, ghost)

	if definition.Rarity >= Config.AnnounceFromRarity then
		local rarity = Config.Rarities[definition.Rarity]
		local prefix = if mutation then string.upper(mutation) .. " " else ""
		Remotes.notifyAll(
			string.format(
				"👻 A %s%s %s appeared in the graveyard!",
				prefix,
				string.upper(rarity.Name),
				definition.Name
			),
			"event"
		)
	end
end

local function removeGhost(ghost: Ghost)
	ghost.Captured = true
	local index = table.find(ghosts, ghost)
	if index then
		table.remove(ghosts, index)
	end
	for _, hunter in hunters do
		if hunter.Target == ghost then
			hunter.Target = nil
			hunter.Beam.Attachment1 = nil
			hunter.Beam.Enabled = false
		end
	end
	ghost.Model:Destroy()
end

--------------------------------------------------------------------------
-- The vacuum tool
--------------------------------------------------------------------------
local function weldTo(handle: BasePart, part: BasePart, offset: CFrame)
	part.CFrame = handle.CFrame * offset
	part.Anchored = false
	part.CanCollide = false
	part.Massless = true
	local weld = Instance.new("WeldConstraint")
	weld.Part0 = handle
	weld.Part1 = part
	weld.Parent = part
end

local function createVacuum(): (Tool, Beam)
	local tool = Instance.new("Tool")
	tool.Name = "Ghost Vacuum"
	tool.ToolTip = "Hold to suck up ghosts!"
	tool.CanBeDropped = false
	tool.RequiresHandle = true
	-- Forward is -Z; hold the vacuum near its back end.
	tool.GripPos = Vector3.new(0, 0, 1)

	local handle = Instance.new("Part")
	handle.Name = "Handle"
	handle.Size = Vector3.new(0.9, 0.9, 3.4)
	handle.Color = Color3.fromRGB(60, 60, 75)
	handle.Material = Enum.Material.Metal
	handle.CanCollide = false
	handle.Parent = tool

	local tank = Instance.new("Part")
	tank.Name = "Tank"
	tank.Shape = Enum.PartType.Cylinder
	tank.Size = Vector3.new(2, 1.2, 1.2)
	tank.Color = Color3.fromRGB(120, 255, 200)
	tank.Material = Enum.Material.Neon
	tank.Transparency = 0.2
	weldTo(handle, tank, CFrame.new(0, 0.9, 0.5) * CFrame.Angles(0, math.pi / 2, 0))
	tank.Parent = tool

	local nozzle = Instance.new("Part")
	nozzle.Name = "Nozzle"
	nozzle.Shape = Enum.PartType.Cylinder
	nozzle.Size = Vector3.new(0.4, 1.4, 1.4)
	nozzle.Color = Color3.fromRGB(170, 90, 255)
	nozzle.Material = Enum.Material.Neon
	weldTo(handle, nozzle, CFrame.new(0, 0, -1.8) * CFrame.Angles(0, math.pi / 2, 0))
	nozzle.Parent = tool

	local tip = Instance.new("Attachment")
	tip.Name = "Tip"
	tip.Position = Vector3.new(0, 0, -2)
	tip.Parent = handle

	local beam = Instance.new("Beam")
	beam.Name = "VacuumBeam"
	beam.Attachment0 = tip
	beam.Color = ColorSequence.new(Color3.fromRGB(120, 255, 220), Color3.fromRGB(190, 110, 255))
	beam.Transparency = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 0.1),
		NumberSequenceKeypoint.new(1, 0.55),
	})
	beam.Width0 = 0.8
	beam.Width1 = 3
	beam.FaceCamera = true
	beam.LightEmission = 1
	beam.Segments = 12
	beam.Enabled = false
	beam.Parent = handle

	return tool, beam
end

local function giveVacuum(player: Player)
	local backpack = player:FindFirstChildOfClass("Backpack")
	if not backpack then
		return
	end
	local tool, beam = createVacuum()
	local hunter: Hunter = {
		Tool = tool,
		Beam = beam,
		Active = false,
		Target = nil,
		LastFullNotice = 0,
	}
	tool.Activated:Connect(function()
		hunter.Active = true
	end)
	tool.Deactivated:Connect(function()
		hunter.Active = false
	end)
	tool.Unequipped:Connect(function()
		hunter.Active = false
	end)
	tool.Parent = backpack
	hunters[player] = hunter

	-- Equip it right away so new players immediately know what to do.
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if humanoid then
		humanoid:EquipTool(tool)
	end
end

--------------------------------------------------------------------------
-- Simulation
--------------------------------------------------------------------------
local function findTarget(root: BasePart): Ghost?
	local best, bestScore = nil, math.huge
	for _, ghost in ghosts do
		if not ghost.Captured then
			local offset = ghost.Root.Position - root.Position
			local distance = offset.Magnitude
			if distance <= Config.VacuumRange and distance > 0 then
				local facing = root.CFrame.LookVector:Dot(offset.Unit)
				local score = distance * (1.6 - facing)
				if score < bestScore then
					best, bestScore = ghost, score
				end
			end
		end
	end
	return best
end

local function capture(ghost: Ghost, player: Player)
	if not HotelService.addToBackpack(player, ghost.Id, ghost.Mutation) then
		ghost.Progress[player] = 0.99
		return
	end
	local definition = Config.GhostsById[ghost.Id]
	local rarity = Config.Rarities[ghost.Rarity]
	local mutationText = if ghost.Mutation then ghost.Mutation .. " " else ""
	Remotes.notify(
		player,
		string.format("👻 Caught %s%s! (%s)", mutationText, definition.Name, rarity.Name),
		if ghost.Rarity >= 4 then "rare" else "success"
	)
	if ghost.Rarity >= Config.AnnounceFromRarity then
		Remotes.notifyAll(
			string.format(
				"🎉 %s caught a %s%s %s!",
				player.DisplayName,
				mutationText,
				string.upper(rarity.Name),
				definition.Name
			),
			"event"
		)
	end
	Remotes.Effect:FireAllClients("capture", ghost.Root.Position, ghost.Rarity)
	removeGhost(ghost)
end

local function stepHunters(dt: number)
	for player, hunter in hunters do
		local character = player.Character
		local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
		local humanoid = character and character:FindFirstChildOfClass("Humanoid")
		local equipped = hunter.Tool.Parent == character
		local alive = humanoid ~= nil and humanoid.Health > 0

		local target: Ghost? = nil
		if hunter.Active and equipped and alive and root then
			if HotelService.isBackpackFull(player) then
				if os.clock() - hunter.LastFullNotice > 6 then
					hunter.LastFullNotice = os.clock()
					Remotes.notify(player, "🎒 Backpack full! Bring your ghosts to your hotel.", "error")
				end
			else
				target = hunter.Target
				local valid = target ~= nil
					and not target.Captured
					and (target.Root.Position - root.Position).Magnitude <= Config.VacuumRange * 1.25
				if not valid then
					target = findTarget(root)
				end
			end
		end

		hunter.Target = target
		if target and root then
			target.PulledBy = player
			local rarity = Config.Rarities[target.Rarity]
			local gain = dt * HotelService.getVacuumPower(player) / rarity.CaptureTime
			target.Progress[player] = (target.Progress[player] or 0) + gain
			hunter.Beam.Attachment1 = target.Attachment
			hunter.Beam.Enabled = true
			if target.Progress[player] >= 1 then
				capture(target, player)
			end
		elseif hunter.Beam.Enabled then
			hunter.Beam.Enabled = false
			hunter.Beam.Attachment1 = nil
		end
	end
end

local function stepGhosts(dt: number)
	local now = os.clock()
	for index = #ghosts, 1, -1 do
		local ghost = ghosts[index]
		local root = ghost.Root
		if not root.Parent then
			table.remove(ghosts, index)
			continue
		end

		-- Decay progress from hunters who stopped vacuuming this ghost.
		local best = 0
		for player, progress in ghost.Progress do
			local hunter = hunters[player]
			if not hunter or hunter.Target ~= ghost then
				progress -= Config.ProgressDecay * dt
				ghost.Progress[player] = if progress > 0 then progress else nil
			end
			best = math.max(best, ghost.Progress[player] or 0)
		end
		if ghost.Bar and ghost.Fill then
			ghost.Bar.Visible = best > 0
			ghost.Fill.Size = UDim2.fromScale(math.clamp(best, 0, 1), 1)
		end

		local puller = ghost.PulledBy
		local pullerHunter = puller and hunters[puller]
		local pullerRoot = puller
			and puller.Character
			and puller.Character:FindFirstChild("HumanoidRootPart") :: BasePart?
		local position = root.Position

		local toHunter = if pullerRoot then pullerRoot.Position - position else Vector3.zero
		if pullerHunter and pullerHunter.Target == ghost and pullerRoot and toHunter.Magnitude > 0.1 then
			-- Being vacuumed: drift toward the hunter and wobble.
			local stop = pullerRoot.Position - toHunter.Unit * 6
			ghost.Align.Position = Vector3.new(stop.X, pullerRoot.Position.Y + 2, stop.Z)
			ghost.Align.MaxVelocity = Config.VacuumPullSpeed
			local shake = CFrame.Angles(0, 0, math.sin(now * 30) * 0.25)
			ghost.Orient.CFrame = CFrame.lookAt(
				position,
				Vector3.new(pullerRoot.Position.X, position.Y, pullerRoot.Position.Z)
			).Rotation * shake
		else
			ghost.PulledBy = nil
			if now - ghost.SpawnedAt > Config.GhostLifetime and next(ghost.Progress) == nil then
				Remotes.Effect:FireAllClients("fade", position, ghost.Rarity)
				removeGhost(ghost)
				continue
			end
			local flat = Vector3.new(ghost.Target.X - position.X, 0, ghost.Target.Z - position.Z)
			if flat.Magnitude < 3 or now > ghost.NextWander then
				pickWanderTarget(ghost)
				flat = Vector3.new(ghost.Target.X - position.X, 0, ghost.Target.Z - position.Z)
			end
			local bob = math.sin(now * 2 + ghost.Phase) * 0.8
			ghost.Align.Position = ghost.Target + Vector3.new(0, bob, 0)
			ghost.Align.MaxVelocity = Config.Rarities[ghost.Rarity].Speed
			if flat.Magnitude > 0.5 then
				ghost.Orient.CFrame = CFrame.lookAt(Vector3.zero, flat.Unit)
			end
		end
	end
end

--------------------------------------------------------------------------
-- Startup
--------------------------------------------------------------------------
function GhostService.onCharacterAdded(player: Player, character: Model)
	local old = hunters[player]
	if old then
		old.Tool:Destroy()
		hunters[player] = nil
	end
	character:WaitForChild("Humanoid", 10)
	if player.Character == character then
		giveVacuum(player)
	end
end

function GhostService.onPlayerRemoving(player: Player)
	hunters[player] = nil
	for _, ghost in ghosts do
		ghost.Progress[player] = nil
		if ghost.PulledBy == player then
			ghost.PulledBy = nil
		end
	end
end

function GhostService.start()
	ghostFolder = Instance.new("Folder")
	ghostFolder.Name = "Ghosts"
	ghostFolder.Parent = workspace

	Loop.every(TICK, "Hunters", stepHunters)
	Loop.every(TICK, "Ghosts", stepGhosts)

	local spawnTimer = 0
	Loop.every(TICK, "Spawner", function(dt)
		spawnTimer += dt
		local interval = Config.SpawnInterval / EventService.getSpawnRate()
		local cap = Config.MaxGhosts * (if EventService.isActive() then 1.5 else 1)
		if spawnTimer >= interval then
			spawnTimer = 0
			if #ghosts < cap and #Players:GetPlayers() > 0 then
				spawnGhost()
			end
		end
	end)
end

return GhostService
