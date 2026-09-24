-- Builds the whole world out of parts at server start: the haunted
-- graveyard in the middle and one hotel plot per player around it.

local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local Formulas = require(ReplicatedStorage.Shared.Formulas)

local MapBuilder = {}

-- Layout -------------------------------------------------------------------
local PLOT_WIDTH = 50
local PLOT_DEPTH = 64
local PLOT_ENTRANCE_Z = 40 -- distance from the centre line to a plot's entrance
local PLOT_X = { -84, -28, 28, 84 }
local FLOOR_TOP = 0.5
local ROOM_ROW_X = 17
local ROOM_FIRST_DEPTH = 11
local ROOM_SPACING = 6.8

MapBuilder.GraveyardMin = Vector3.new(-110, 0, -32)
MapBuilder.GraveyardMax = Vector3.new(110, 0, 32)

-- Palette -----------------------------------------------------------------
local COLORS = {
	Ground = Color3.fromRGB(38, 52, 40),
	Dirt = Color3.fromRGB(58, 48, 44),
	Stone = Color3.fromRGB(95, 92, 105),
	DarkStone = Color3.fromRGB(55, 52, 64),
	Wood = Color3.fromRGB(70, 48, 38),
	Floor = Color3.fromRGB(60, 45, 70),
	Purple = Color3.fromRGB(170, 90, 255),
	Green = Color3.fromRGB(110, 255, 140),
	Orange = Color3.fromRGB(255, 140, 40),
	Gold = Color3.fromRGB(255, 200, 60),
	Locked = Color3.fromRGB(120, 120, 130),
}
MapBuilder.Colors = COLORS

export type Room = {
	Index: number,
	Base: BasePart,
	Ring: BasePart,
	Label: TextLabel,
	GhostCFrame: CFrame,
}

export type Plot = {
	Index: number,
	Model: Model,
	Origin: CFrame,
	SpawnCFrame: CFrame,
	Rooms: { Room },
	Register: BasePart,
	RegisterLabel: TextLabel,
	BuildPad: BasePart,
	BuildLabel: TextLabel,
	Stations: { [string]: BasePart },
	StationLabels: { [string]: TextLabel },
	SignLabel: TextLabel,
	StarsLabel: TextLabel,
	Builds: { [string]: Model },
	Owner: Player?,
}

-- Helpers -----------------------------------------------------------------
local function part(props: { [string]: any }): BasePart
	local instance = Instance.new(props.ClassName or "Part")
	instance.Anchored = true
	instance.TopSurface = Enum.SurfaceType.Smooth
	instance.BottomSurface = Enum.SurfaceType.Smooth
	instance.Material = Enum.Material.SmoothPlastic
	for key, value in props do
		if key ~= "ClassName" and key ~= "Parent" then
			(instance :: any)[key] = value
		end
	end
	instance.Parent = props.Parent
	return instance
end

local VERTICAL = CFrame.Angles(0, 0, math.pi / 2)

local function cylinder(
	parent: Instance,
	name: string,
	cframe: CFrame,
	height: number,
	diameter: number,
	color: Color3,
	material: Enum.Material?
): BasePart
	return part({
		Name = name,
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(height, diameter, diameter),
		CFrame = cframe * VERTICAL,
		Color = color,
		Material = material or Enum.Material.SmoothPlastic,
		Parent = parent,
	})
end

local function light(parent: Instance, color: Color3, range: number, brightness: number?)
	local pointLight = Instance.new("PointLight")
	pointLight.Color = color
	pointLight.Range = range
	pointLight.Brightness = brightness or 1.5
	pointLight.Shadows = false
	pointLight.Parent = parent
end

local function billboard(
	adornee: BasePart,
	size: UDim2,
	offset: Vector3,
	maxDistance: number?
): (BillboardGui, TextLabel)
	local gui = Instance.new("BillboardGui")
	gui.Size = size
	gui.StudsOffset = offset
	gui.MaxDistance = maxDistance or 90
	gui.LightInfluence = 0
	gui.ResetOnSpawn = false
	local label = Instance.new("TextLabel")
	label.Name = "Text"
	label.BackgroundTransparency = 1
	label.Size = UDim2.fromScale(1, 1)
	label.Font = Enum.Font.FredokaOne
	label.TextScaled = true
	label.TextColor3 = Color3.new(1, 1, 1)
	label.TextStrokeTransparency = 0.15
	label.RichText = true
	label.Text = ""
	label.Parent = gui
	gui.Parent = adornee
	return gui, label
end

-- Lighting ----------------------------------------------------------------
local function setupLighting()
	Lighting.ClockTime = 20.8
	Lighting.Brightness = 1.6
	Lighting.Ambient = Color3.fromRGB(75, 65, 100)
	Lighting.OutdoorAmbient = Color3.fromRGB(95, 85, 130)
	Lighting.EnvironmentDiffuseScale = 0.4
	Lighting.EnvironmentSpecularScale = 0.4
	Lighting.GlobalShadows = true

	local atmosphere = Instance.new("Atmosphere")
	atmosphere.Density = 0.32
	atmosphere.Offset = 0.1
	atmosphere.Color = Color3.fromRGB(120, 95, 170)
	atmosphere.Decay = Color3.fromRGB(60, 40, 95)
	atmosphere.Glare = 0
	atmosphere.Haze = 1.6
	atmosphere.Parent = Lighting

	local bloom = Instance.new("BloomEffect")
	bloom.Intensity = 0.7
	bloom.Size = 28
	bloom.Threshold = 1.4
	bloom.Parent = Lighting

	local grading = Instance.new("ColorCorrectionEffect")
	grading.Name = "Grading"
	grading.Saturation = 0.15
	grading.Contrast = 0.05
	grading.Parent = Lighting
end

-- Graveyard ---------------------------------------------------------------
local function tombstone(parent: Instance, position: Vector3, rng: Random)
	local height = rng:NextNumber(2.6, 4)
	local angle = CFrame.Angles(0, rng:NextNumber(-0.25, 0.25), rng:NextNumber(-0.08, 0.08))
	local base = CFrame.new(position) * angle
	part({
		Name = "Tombstone",
		Size = Vector3.new(2.6, height, 0.7),
		CFrame = base * CFrame.new(0, height / 2, 0),
		Color = COLORS.Stone,
		Material = Enum.Material.Slate,
		Parent = parent,
	})
	cylinder(
		parent,
		"TombTop",
		base * CFrame.new(0, height, 0) * CFrame.Angles(0, math.pi / 2, math.pi / 2),
		0.7,
		2.6,
		COLORS.Stone,
		Enum.Material.Slate
	)
	part({
		Name = "Grave",
		Size = Vector3.new(3, 0.3, 5),
		CFrame = base * CFrame.new(0, 0.15, 3),
		Color = COLORS.Dirt,
		Material = Enum.Material.Ground,
		Parent = parent,
	})
end

local function deadTree(parent: Instance, position: Vector3, rng: Random)
	local height = rng:NextNumber(10, 16)
	local base = CFrame.new(position) * CFrame.Angles(0, rng:NextNumber(0, math.pi * 2), 0)
	cylinder(parent, "Trunk", base * CFrame.new(0, height / 2, 0), height, 1.6, COLORS.Wood, Enum.Material.Wood)
	for index = 1, 4 do
		local y = height * (0.45 + index * 0.12)
		local length = rng:NextNumber(3, 6)
		local branch = CFrame.new(position + Vector3.new(0, y, 0))
			* CFrame.Angles(0, index * 1.7 + rng:NextNumber(0, 0.5), 0)
			* CFrame.Angles(0, 0, math.rad(rng:NextNumber(35, 60)))
			* CFrame.new(0, length / 2, 0)
		cylinder(parent, "Branch", branch, length, 0.6, COLORS.Wood, Enum.Material.Wood)
	end
end

local function pumpkin(parent: Instance, position: Vector3, size: number)
	local body = part({
		Name = "Pumpkin",
		Shape = Enum.PartType.Ball,
		Size = Vector3.one * size,
		CFrame = CFrame.new(position + Vector3.new(0, size * 0.4, 0)),
		Color = COLORS.Orange,
		Parent = parent,
	})
	cylinder(
		parent,
		"Stem",
		CFrame.new(body.CFrame.Position + Vector3.new(0, size * 0.5, 0)),
		size * 0.3,
		size * 0.15,
		Color3.fromRGB(80, 130, 50)
	)
	for _, side in { -1, 1 } do
		part({
			Name = "Eye",
			Size = Vector3.new(size * 0.18, size * 0.18, 0.1),
			CFrame = CFrame.new(body.CFrame.Position + Vector3.new(side * size * 0.18, size * 0.1, -size * 0.47)),
			Color = Color3.fromRGB(255, 220, 90),
			Material = Enum.Material.Neon,
			Parent = parent,
		})
	end
	light(body, Color3.fromRGB(255, 160, 60), size * 3, 1.2)
end

local function lampPost(parent: Instance, position: Vector3, color: Color3)
	cylinder(
		parent,
		"Pole",
		CFrame.new(position + Vector3.new(0, 4, 0)),
		8,
		0.5,
		Color3.fromRGB(35, 30, 40),
		Enum.Material.Metal
	)
	local bulb = part({
		Name = "Lamp",
		Shape = Enum.PartType.Ball,
		Size = Vector3.one * 1.4,
		CFrame = CFrame.new(position + Vector3.new(0, 8.4, 0)),
		Color = color,
		Material = Enum.Material.Neon,
		CanCollide = false,
		Parent = parent,
	})
	light(bulb, color, 18, 1.6)
end

local function buildGraveyard(world: Instance)
	local folder = Instance.new("Folder")
	folder.Name = "Graveyard"
	folder.Parent = world

	local size = MapBuilder.GraveyardMax - MapBuilder.GraveyardMin
	part({
		Name = "GraveyardGround",
		Size = Vector3.new(size.X + 8, 0.2, size.Z + 8),
		CFrame = CFrame.new(Vector3.new(0, 0.1, 0)),
		Color = Color3.fromRGB(45, 55, 45),
		Material = Enum.Material.Grass,
		Parent = folder,
	})

	local rng = Random.new(2026)
	local function freeSpot(): Vector3
		for _ = 1, 30 do
			local x = rng:NextNumber(MapBuilder.GraveyardMin.X + 6, MapBuilder.GraveyardMax.X - 6)
			local z = rng:NextNumber(MapBuilder.GraveyardMin.Z + 6, MapBuilder.GraveyardMax.Z - 6)
			local nearPath = math.abs(z) < 4
			local nearEntrance = false
			for _, plotX in PLOT_X do
				if math.abs(x - plotX) < 10 and math.abs(z) > 20 then
					nearEntrance = true
				end
			end
			if not nearPath and not nearEntrance and Vector2.new(x, z).Magnitude > 14 then
				return Vector3.new(x, 0.2, z)
			end
		end
		return Vector3.new(0, 0.2, 20)
	end

	for _ = 1, 30 do
		tombstone(folder, freeSpot(), rng)
	end
	for _ = 1, 10 do
		deadTree(folder, freeSpot(), rng)
	end
	for _ = 1, 16 do
		pumpkin(folder, freeSpot(), rng:NextNumber(1.6, 3))
	end

	-- Main path with lamps
	part({
		Name = "Path",
		Size = Vector3.new(size.X, 0.25, 6),
		CFrame = CFrame.new(Vector3.new(0, 0.15, 0)),
		Color = COLORS.Dirt,
		Material = Enum.Material.Cobblestone,
		Parent = folder,
	})
	for x = -100, 100, 25 do
		lampPost(folder, Vector3.new(x, 0.2, 4), COLORS.Green)
		lampPost(folder, Vector3.new(x, 0.2, -4), COLORS.Purple)
	end

	-- Central haunted gate (spawn point)
	for _, side in { -1, 1 } do
		part({
			Name = "GatePillar",
			Size = Vector3.new(2.5, 14, 2.5),
			CFrame = CFrame.new(Vector3.new(side * 9, 7, 0)),
			Color = COLORS.DarkStone,
			Material = Enum.Material.Slate,
			Parent = folder,
		})
		local orb = part({
			Name = "GateOrb",
			Shape = Enum.PartType.Ball,
			Size = Vector3.one * 2.4,
			CFrame = CFrame.new(Vector3.new(side * 9, 15.2, 0)),
			Color = COLORS.Purple,
			Material = Enum.Material.Neon,
			Parent = folder,
		})
		light(orb, COLORS.Purple, 24, 2)
	end
	local arch = part({
		Name = "GateArch",
		Size = Vector3.new(20.5, 2, 2.5),
		CFrame = CFrame.new(Vector3.new(0, 13, 0)),
		Color = COLORS.DarkStone,
		Material = Enum.Material.Slate,
		Parent = folder,
	})
	local _, gateLabel = billboard(arch, UDim2.fromOffset(420, 90), Vector3.new(0, 4, 0), 250)
	gateLabel.Text = "👻 " .. string.upper(Config.GameName) .. " 👻"
	gateLabel.TextColor3 = Color3.fromRGB(200, 160, 255)

	local spawn = Instance.new("SpawnLocation")
	spawn.Name = "GraveyardSpawn"
	spawn.Anchored = true
	spawn.Neutral = true
	spawn.Duration = 0
	spawn.Size = Vector3.new(8, 0.4, 8)
	spawn.CFrame = CFrame.new(0, 0.3, 0)
	spawn.Transparency = 1
	spawn.CanCollide = false
	spawn.Parent = folder
end

-- Hotel builds (the tycoon buttons) ---------------------------------------
local function buildHotelBuilds(at: (number, number, number) -> CFrame): { [string]: Model }
	local builds = {}
	local function newBuild(key: string): Model
		local model = Instance.new("Model")
		model.Name = "Build_" .. key
		builds[key] = model
		return model
	end

	-- 1. Fence
	do
		local model = newBuild("Fence")
		local function fence(x: number, depth: number, width: number, length: number)
			part({
				Name = "Fence",
				Size = Vector3.new(width, 3, length),
				CFrame = at(x, 1.5, depth),
				Color = COLORS.Wood,
				Material = Enum.Material.WoodPlanks,
				Parent = model,
			})
		end
		local half = PLOT_WIDTH / 2
		fence(-half + 0.4, PLOT_DEPTH / 2, 0.8, PLOT_DEPTH)
		fence(half - 0.4, PLOT_DEPTH / 2, 0.8, PLOT_DEPTH)
		fence(0, PLOT_DEPTH - 0.4, PLOT_WIDTH, 0.8)
		fence(-(half + 8) / 2, 0.4, half - 8, 0.8)
		fence((half + 8) / 2, 0.4, half - 8, 0.8)
		for depth = 0, PLOT_DEPTH, 16 do
			for _, x in { -half + 0.4, half - 0.4 } do
				part({
					Name = "Post",
					Size = Vector3.new(1.4, 4.4, 1.4),
					CFrame = at(x, 2.2, math.clamp(depth, 0.7, PLOT_DEPTH - 0.7)),
					Color = COLORS.DarkStone,
					Material = Enum.Material.Slate,
					Parent = model,
				})
			end
		end
	end

	-- 2. Lamps
	do
		local model = newBuild("Lamps")
		for _, depth in { 6, 32, 58 } do
			for _, x in { -22, 22 } do
				local position = at(x, 0, depth).Position
				lampPost(model, position, if x < 0 then COLORS.Purple else COLORS.Green)
			end
		end
	end

	-- 3. Neon sign arch over the entrance
	do
		local model = newBuild("Sign")
		for _, x in { -8.5, 8.5 } do
			part({
				Name = "SignPillar",
				Size = Vector3.new(1.6, 14, 1.6),
				CFrame = at(x, 7, 0.4),
				Color = COLORS.DarkStone,
				Material = Enum.Material.Slate,
				Parent = model,
			})
		end
		local board = part({
			Name = "SignBoard",
			Size = Vector3.new(19, 3.6, 0.8),
			CFrame = at(0, 14.5, 0.4),
			Color = Color3.fromRGB(30, 20, 40),
			Parent = model,
		})
		local surface = Instance.new("SurfaceGui")
		surface.Face = Enum.NormalId.Back
		surface.LightInfluence = 0
		surface.PixelsPerStud = 40
		local text = Instance.new("TextLabel")
		text.BackgroundTransparency = 1
		text.Size = UDim2.fromScale(1, 1)
		text.Font = Enum.Font.FredokaOne
		text.TextScaled = true
		text.Text = "✦ GHOST HOTEL ✦"
		text.TextColor3 = Color3.fromRGB(255, 120, 255)
		text.Parent = surface
		surface.Parent = board
		local tube = part({
			Name = "SignNeon",
			Size = Vector3.new(19.4, 0.3, 0.3),
			CFrame = at(0, 12.6, 0.2),
			Color = Color3.fromRGB(255, 120, 255),
			Material = Enum.Material.Neon,
			Parent = model,
		})
		light(tube, Color3.fromRGB(255, 120, 255), 20, 2)
	end

	-- 4. Red carpet
	do
		local model = newBuild("Carpet")
		part({
			Name = "Carpet",
			Size = Vector3.new(7, 0.1, PLOT_DEPTH - 8),
			CFrame = at(0, 0.05, (PLOT_DEPTH - 8) / 2),
			Color = Color3.fromRGB(170, 25, 45),
			Material = Enum.Material.Fabric,
			CanCollide = false,
			Parent = model,
		})
		for _, x in { -3.6, 3.6 } do
			part({
				Name = "CarpetTrim",
				Size = Vector3.new(0.25, 0.12, PLOT_DEPTH - 8),
				CFrame = at(x, 0.06, (PLOT_DEPTH - 8) / 2),
				Color = COLORS.Gold,
				Material = Enum.Material.Neon,
				CanCollide = false,
				Parent = model,
			})
		end
	end

	-- 5. Slime fountain
	do
		local model = newBuild("Fountain")
		local center = at(0, 0, 33)
		cylinder(model, "Basin", center * CFrame.new(0, 0.75, 0), 1.5, 9, COLORS.Stone, Enum.Material.Slate)
		cylinder(model, "Slime", center * CFrame.new(0, 1.55, 0), 0.2, 8, COLORS.Green, Enum.Material.Neon)
		cylinder(model, "Spout", center * CFrame.new(0, 3, 0), 3.5, 1.4, COLORS.Stone, Enum.Material.Slate)
		local top = part({
			Name = "SpoutOrb",
			Shape = Enum.PartType.Ball,
			Size = Vector3.one * 2,
			CFrame = center * CFrame.new(0, 5.2, 0),
			Color = COLORS.Green,
			Material = Enum.Material.Neon,
			Parent = model,
		})
		light(top, COLORS.Green, 22, 2)
		local particles = Instance.new("ParticleEmitter")
		particles.Color = ColorSequence.new(COLORS.Green)
		particles.LightEmission = 1
		particles.Rate = 20
		particles.Speed = NumberRange.new(4, 7)
		particles.SpreadAngle = Vector2.new(25, 25)
		particles.Lifetime = NumberRange.new(0.8, 1.2)
		particles.Acceleration = Vector3.new(0, -12, 0)
		particles.Size = NumberSequence.new(0.4, 0.1)
		particles.Parent = top
	end

	-- 6. Haunted tower (back left corner)
	do
		local model = newBuild("Tower")
		local base = at(-20, 0, 60)
		part({
			Name = "Tower",
			Size = Vector3.new(7, 24, 7),
			CFrame = base * CFrame.new(0, 12, 0),
			Color = COLORS.DarkStone,
			Material = Enum.Material.Slate,
			Parent = model,
		})
		for index, size in { 8.5, 6.5, 4.5, 2 } do
			part({
				Name = "Roof",
				Size = Vector3.new(size, 2, size),
				CFrame = base * CFrame.new(0, 24 + index * 2 - 1, 0),
				Color = Color3.fromRGB(80, 40, 110),
				Material = Enum.Material.Slate,
				Parent = model,
			})
		end
		for _, y in { 8, 14, 20 } do
			local window = part({
				Name = "Window",
				Size = Vector3.new(2, 2.6, 0.2),
				CFrame = base * CFrame.new(0, y, 3.55),
				Color = Color3.fromRGB(255, 220, 110),
				Material = Enum.Material.Neon,
				Parent = model,
			})
			light(window, Color3.fromRGB(255, 200, 100), 14, 1)
		end
	end

	-- 7. Pumpkin garden (back right corner)
	do
		local model = newBuild("Garden")
		local base = at(20, 0, 60)
		part({
			Name = "Soil",
			Size = Vector3.new(7, 0.4, 7),
			CFrame = base * CFrame.new(0, 0.2, 0),
			Color = COLORS.Dirt,
			Material = Enum.Material.Ground,
			Parent = model,
		})
		for index = 0, 5 do
			local offset = Vector3.new(-2.2 + (index % 3) * 2.2, 0.4, -1.4 + (index // 3) * 2.8)
			pumpkin(model, (base * CFrame.new(offset)).Position, if index == 4 then 2.6 else 1.8)
		end
	end

	-- 8. Blood moon beacon floating high above the hotel
	do
		local model = newBuild("Moon")
		local moon = part({
			Name = "BloodMoon",
			Shape = Enum.PartType.Ball,
			Size = Vector3.one * 14,
			CFrame = at(0, 60, 32),
			Color = Color3.fromRGB(255, 50, 60),
			Material = Enum.Material.Neon,
			CanCollide = false,
			Parent = model,
		})
		light(moon, Color3.fromRGB(255, 60, 70), 60, 3)
		local beam = cylinder(model, "MoonBeam", at(0, 30, 32), 58, 3, Color3.fromRGB(255, 80, 90), Enum.Material.Neon)
		beam.Transparency = 0.7
		beam.CanCollide = false
	end

	return builds
end

-- Plots -------------------------------------------------------------------
local function buildPlot(world: Instance, index: number, xCenter: number, side: number): Plot
	-- Looks away from the graveyard, into the plot (+Z for side 1, -Z for side -1).
	local origin = CFrame.new(xCenter, FLOOR_TOP, side * PLOT_ENTRANCE_Z)
		* CFrame.Angles(0, if side == 1 then math.pi else 0, 0)
	-- x: left/right across the plot, depth: distance from the entrance.
	local function at(x: number, y: number, depth: number): CFrame
		return origin * CFrame.new(x, y, -depth)
	end

	local model = Instance.new("Model")
	model.Name = "Plot" .. index
	model:SetAttribute("PlotIndex", index)

	part({
		Name = "Floor",
		Size = Vector3.new(PLOT_WIDTH, 1, PLOT_DEPTH),
		CFrame = at(0, -0.5, PLOT_DEPTH / 2),
		Color = COLORS.Floor,
		Material = Enum.Material.Slate,
		Parent = model,
	})
	-- Walkway from the graveyard to the entrance
	part({
		Name = "Walkway",
		Size = Vector3.new(10, 0.3, PLOT_ENTRANCE_Z - 30),
		CFrame = at(0, -0.4, -(PLOT_ENTRANCE_Z - 30) / 2),
		Color = COLORS.Dirt,
		Material = Enum.Material.Cobblestone,
		Parent = model,
	})

	-- Owner sign above the entrance
	local signAnchor = part({
		Name = "OwnerSign",
		Size = Vector3.new(1, 1, 1),
		CFrame = at(0, 10, 0),
		Transparency = 1,
		CanCollide = false,
		CanQuery = false,
		Parent = model,
	})
	local signGui, signLabel = billboard(signAnchor, UDim2.fromOffset(360, 110), Vector3.new(0, 0, 0), 160)
	signLabel.Size = UDim2.fromScale(1, 0.6)
	signLabel.Text = "Empty Hotel"
	local stars = Instance.new("TextLabel")
	stars.Name = "Stars"
	stars.BackgroundTransparency = 1
	stars.Size = UDim2.fromScale(1, 0.4)
	stars.Position = UDim2.fromScale(0, 0.6)
	stars.Font = Enum.Font.FredokaOne
	stars.TextScaled = true
	stars.TextColor3 = COLORS.Gold
	stars.TextStrokeTransparency = 0.2
	stars.Text = ""
	stars.Parent = signGui

	-- Rooms
	local rooms: { Room } = {}
	for room = 1, Formulas.TotalRooms do
		local row = if room <= Config.RoomsPerSide then -1 else 1
		local slot = (room - 1) % Config.RoomsPerSide
		local x = row * ROOM_ROW_X
		local depth = ROOM_FIRST_DEPTH + slot * ROOM_SPACING
		local center = at(x, 0, depth)
		local base = cylinder(
			model,
			"RoomBase" .. room,
			center * CFrame.new(0, 0.5, 0),
			1,
			5.6,
			COLORS.DarkStone,
			Enum.Material.Slate
		)
		local ring = cylinder(
			model,
			"RoomRing" .. room,
			center * CFrame.new(0, 1.05, 0),
			0.15,
			5.9,
			COLORS.Locked,
			Enum.Material.Neon
		)
		ring.CanCollide = false
		local _, label = billboard(base, UDim2.fromOffset(170, 50), Vector3.new(0, 3.2, 0), 60)
		-- Ghosts face the aisle.
		local facing = at(0, 0, depth).Position
		local ghostPosition = center.Position
		local ghostCFrame = CFrame.lookAt(ghostPosition, Vector3.new(facing.X, ghostPosition.Y, facing.Z))
		rooms[room] = {
			Index = room,
			Base = base,
			Ring = ring,
			Label = label,
			GhostCFrame = ghostCFrame,
		}
	end

	-- Cash register (collect pad)
	local register = part({
		Name = "Register",
		Size = Vector3.new(6, 0.4, 6),
		CFrame = at(-7.5, 0.2, 7),
		Color = Color3.fromRGB(60, 200, 110),
		Material = Enum.Material.Neon,
		Parent = model,
	})
	local _, registerLabel = billboard(register, UDim2.fromOffset(240, 70), Vector3.new(0, 4, 0), 80)

	-- Tycoon build button
	local buildPad = part({
		Name = "BuildButton",
		Size = Vector3.new(5, 0.4, 5),
		CFrame = at(7.5, 0.2, 7),
		Color = Color3.fromRGB(80, 170, 255),
		Material = Enum.Material.Neon,
		Parent = model,
	})
	local _, buildLabel = billboard(buildPad, UDim2.fromOffset(260, 80), Vector3.new(0, 4, 0), 80)

	-- Upgrade stations and the cauldron at the back
	local stations = {}
	local stationLabels = {}
	local function station(key: string, x: number, color: Color3)
		local block = part({
			Name = key .. "Station",
			Size = Vector3.new(4, 3, 4),
			CFrame = at(x, 1.5, 59),
			Color = color,
			Material = Enum.Material.Metal,
			Parent = model,
		})
		local glow = part({
			Name = key .. "Glow",
			Size = Vector3.new(4.2, 0.3, 4.2),
			CFrame = at(x, 3.1, 59),
			Color = color,
			Material = Enum.Material.Neon,
			Parent = model,
		})
		light(glow, color, 12, 1.2)
		local _, label = billboard(block, UDim2.fromOffset(230, 80), Vector3.new(0, 5, 0), 70)
		stations[key] = block
		stationLabels[key] = label
	end
	station("Vacuum", -9, Color3.fromRGB(90, 200, 255))
	station("Backpack", 9, Color3.fromRGB(255, 170, 60))

	local cauldronCenter = at(0, 0, 58)
	local pot = cylinder(
		model,
		"CauldronStation",
		cauldronCenter * CFrame.new(0, 1.6, 0),
		3.2,
		5,
		Color3.fromRGB(25, 22, 30),
		Enum.Material.Metal
	)
	local brew = cylinder(
		model,
		"CauldronBrew",
		cauldronCenter * CFrame.new(0, 3.25, 0),
		0.2,
		4.3,
		COLORS.Purple,
		Enum.Material.Neon
	)
	light(brew, COLORS.Purple, 16, 2)
	local bubbles = Instance.new("ParticleEmitter")
	bubbles.Color = ColorSequence.new(COLORS.Purple)
	bubbles.LightEmission = 1
	bubbles.Rate = 8
	bubbles.Speed = NumberRange.new(1, 2)
	bubbles.Lifetime = NumberRange.new(1, 1.6)
	bubbles.Size = NumberSequence.new(0.5, 0)
	bubbles.Parent = brew
	local _, cauldronLabel = billboard(pot, UDim2.fromOffset(230, 80), Vector3.new(0, 5, 0), 70)
	stations.Cauldron = pot
	stationLabels.Cauldron = cauldronLabel

	model.Parent = world

	local plot: Plot = {
		Index = index,
		Model = model,
		Origin = origin,
		SpawnCFrame = at(0, 3, 4) * CFrame.Angles(0, math.pi, 0),
		Rooms = rooms,
		Register = register,
		RegisterLabel = registerLabel,
		BuildPad = buildPad,
		BuildLabel = buildLabel,
		Stations = stations,
		StationLabels = stationLabels,
		SignLabel = signLabel,
		StarsLabel = stars,
		Builds = {},
		Owner = nil,
	}
	plot.Builds = buildHotelBuilds(at)
	return plot
end

-- Is `position` inside the plot's walls?
function MapBuilder.isInside(plot: Plot, position: Vector3): boolean
	local localPosition = plot.Origin:PointToObjectSpace(position)
	local depth = -localPosition.Z
	return math.abs(localPosition.X) <= PLOT_WIDTH / 2
		and depth >= 0
		and depth <= PLOT_DEPTH
		and localPosition.Y > -6
		and localPosition.Y < 60
end

function MapBuilder.build(): { Plot }
	setupLighting()

	local world = Instance.new("Folder")
	world.Name = "World"

	part({
		Name = "Ground",
		Size = Vector3.new(700, 2, 700),
		CFrame = CFrame.new(Vector3.new(0, -1, 0)),
		Color = COLORS.Ground,
		Material = Enum.Material.Grass,
		Parent = world,
	})

	buildGraveyard(world)

	local plots = {}
	for index = 1, Config.MaxPlots do
		local column = (index - 1) % #PLOT_X + 1
		local side = if index <= #PLOT_X then 1 else -1
		plots[index] = buildPlot(world, index, PLOT_X[column], side)
	end

	world.Parent = workspace
	return plots
end

return MapBuilder
