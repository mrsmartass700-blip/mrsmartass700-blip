-- Builds ghost models out of plain parts (no uploaded assets needed).
-- Used by the server for real ghosts and by the client for backpack minis.
--
-- Every ghost is a Model whose PrimaryPart "Root" is an invisible part;
-- all visible parts are welded to it. Front of the ghost is -Z.

local Config = require(script.Parent.Config)
local Format = require(script.Parent.Format)
local Formulas = require(script.Parent.Formulas)

local GhostFactory = {}

export type BuildOptions = {
	Scale: number?,
	Billboard: boolean?,
	Light: boolean?,
}

local CHEEK_COLOR = Color3.fromRGB(255, 150, 175)
local EYE_COLOR = Color3.fromRGB(25, 20, 35)
local VERTICAL = CFrame.Angles(0, 0, math.pi / 2)

-- Per shape: body size factors, body centre height and where the face sits.
local SHAPES = {
	Classic = { Body = Vector3.new(0.9, 1.1, 0.9), BodyY = 0.1, Top = 0.65, Front = 0.42, Skirt = true },
	Round = { Body = Vector3.new(0.95, 0.95, 0.95), BodyY = 0, Top = 0.47, Front = 0.44, Skirt = false },
	Tall = { Body = Vector3.new(0.75, 1.4, 0.75), BodyY = 0.15, Top = 0.85, Front = 0.35, Skirt = true },
}

local function makePart(
	model: Model,
	root: BasePart,
	props: { [string]: any },
	offset: CFrame,
	mesh: Enum.MeshType?
): BasePart
	local part = Instance.new("Part")
	part.Anchored = false
	part.CanCollide = false
	part.CanTouch = false
	part.CanQuery = false
	part.Massless = true
	part.CastShadow = false
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	part.Material = Enum.Material.SmoothPlastic
	for key, value in props do
		(part :: any)[key] = value
	end
	if mesh then
		local specialMesh = Instance.new("SpecialMesh")
		specialMesh.MeshType = mesh
		specialMesh.Parent = part
	end
	part.CFrame = root.CFrame * offset
	local weld = Instance.new("WeldConstraint")
	weld.Part0 = root
	weld.Part1 = part
	weld.Parent = part
	part.Parent = model
	return part
end

local function ellipsoid(model, root, name, size: Vector3, color: Color3, offset: CFrame): BasePart
	return makePart(model, root, { Name = name, Size = size, Color = color }, offset, Enum.MeshType.Sphere)
end

local function cylinder(model, root, name, height: number, diameter: number, color: Color3, offset: CFrame): BasePart
	return makePart(model, root, {
		Name = name,
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(height, diameter, diameter),
		Color = color,
	}, offset * VERTICAL)
end

local function buildHat(model: Model, root: BasePart, hat: string, s: number, top: number, accent: Color3)
	local y = top * s
	if hat == "Crown" then
		local band = cylinder(model, root, "Hat", 0.25 * s, 0.5 * s, accent, CFrame.new(0, y + 0.08 * s, 0))
		band.Material = Enum.Material.Metal
		for index = 0, 4 do
			local angle = index / 5 * math.pi * 2
			local spike = ellipsoid(
				model,
				root,
				"Hat",
				Vector3.new(0.1, 0.18, 0.1) * s,
				accent,
				CFrame.new(math.cos(angle) * 0.22 * s, y + 0.26 * s, math.sin(angle) * 0.22 * s)
			)
			spike.Material = Enum.Material.Metal
		end
	elseif hat == "Witch" then
		cylinder(model, root, "Hat", 0.05 * s, 0.95 * s, accent, CFrame.new(0, y, 0))
		cylinder(model, root, "Hat", 0.22 * s, 0.5 * s, accent, CFrame.new(0, y + 0.13 * s, 0))
		cylinder(model, root, "Hat", 0.22 * s, 0.34 * s, accent, CFrame.new(0.02 * s, y + 0.34 * s, 0.02 * s))
		cylinder(model, root, "Hat", 0.2 * s, 0.18 * s, accent, CFrame.new(0.06 * s, y + 0.53 * s, 0.05 * s))
		cylinder(model, root, "Hat", 0.06 * s, 0.52 * s, Color3.fromRGB(150, 70, 255), CFrame.new(0, y + 0.06 * s, 0))
	elseif hat == "Halo" then
		local halo = cylinder(model, root, "Hat", 0.05 * s, 0.6 * s, accent, CFrame.new(0, y + 0.22 * s, 0))
		halo.Material = Enum.Material.Neon
	elseif hat == "Horns" then
		for _, side in { -1, 1 } do
			ellipsoid(
				model,
				root,
				"Hat",
				Vector3.new(0.12, 0.32, 0.12) * s,
				accent,
				CFrame.new(side * 0.22 * s, y + 0.02 * s, 0) * CFrame.Angles(0, 0, -side * 0.45)
			)
		end
	elseif hat == "Top" then
		cylinder(model, root, "Hat", 0.05 * s, 0.68 * s, accent, CFrame.new(0, y, 0))
		cylinder(model, root, "Hat", 0.42 * s, 0.42 * s, accent, CFrame.new(0, y + 0.23 * s, 0))
		cylinder(model, root, "Hat", 0.07 * s, 0.43 * s, Color3.fromRGB(200, 30, 50), CFrame.new(0, y + 0.08 * s, 0))
	elseif hat == "Antenna" then
		cylinder(model, root, "Hat", 0.35 * s, 0.05 * s, Color3.fromRGB(60, 60, 70), CFrame.new(0, y + 0.12 * s, 0))
		local bulb = ellipsoid(model, root, "Hat", Vector3.one * 0.16 * s, accent, CFrame.new(0, y + 0.32 * s, 0))
		bulb.Material = Enum.Material.Neon
	elseif hat == "Stem" then
		cylinder(
			model,
			root,
			"Hat",
			0.22 * s,
			0.12 * s,
			Color3.fromRGB(80, 140, 60),
			CFrame.new(0, y + 0.05 * s, 0) * CFrame.Angles(0.3, 0, 0)
		)
		ellipsoid(
			model,
			root,
			"Hat",
			Vector3.new(0.25, 0.06, 0.14) * s,
			accent,
			CFrame.new(0.14 * s, y + 0.1 * s, 0) * CFrame.Angles(0, 0, 0.4)
		)
	elseif hat == "Bow" then
		for _, side in { -1, 1 } do
			ellipsoid(
				model,
				root,
				"Hat",
				Vector3.new(0.2, 0.14, 0.08) * s,
				accent,
				CFrame.new(0.2 * s + side * 0.12 * s, y - 0.02 * s, -0.1 * s) * CFrame.Angles(0, 0, side * 0.3)
			)
		end
		ellipsoid(model, root, "Hat", Vector3.one * 0.08 * s, accent, CFrame.new(0.2 * s, y - 0.02 * s, -0.12 * s))
	end
end

local function applyMutation(model: Model, bodyParts: { BasePart }, mutation: string?)
	local info = mutation and Config.MutationsByName[mutation]
	if not info then
		return
	end
	for _, part in bodyParts do
		part.Color = info.Color
		if info.Name == "Gold" then
			part.Material = Enum.Material.Foil
			part.Transparency = 0
		elseif info.Name == "Diamond" then
			part.Material = Enum.Material.Glass
			part.Transparency = 0.25
		elseif info.Name == "Rainbow" then
			part:AddTag("Rainbow")
		end
	end
	local sparkles = Instance.new("Sparkles")
	sparkles.SparkleColor = info.Color
	sparkles.Parent = bodyParts[1]
	model:SetAttribute("Mutation", info.Name)
end

local function buildBillboard(root: BasePart, ghost, mutation: string?, s: number)
	local rarity = Config.Rarities[ghost.Rarity]

	local gui = Instance.new("BillboardGui")
	gui.Name = "Info"
	gui.Size = UDim2.fromOffset(220, 96)
	gui.StudsOffset = Vector3.new(0, s * 0.9 + 1.4, 0)
	gui.MaxDistance = 80
	gui.LightInfluence = 0
	gui.ResetOnSpawn = false

	local layout = Instance.new("UIListLayout")
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.HorizontalAlignment = Enum.HorizontalAlignment.Center
	layout.VerticalAlignment = Enum.VerticalAlignment.Bottom
	layout.Parent = gui

	local function label(name: string, text: string, color: Color3, height: number, order: number): TextLabel
		local textLabel = Instance.new("TextLabel")
		textLabel.Name = name
		textLabel.BackgroundTransparency = 1
		textLabel.Size = UDim2.new(1, 0, 0, height)
		textLabel.Font = Enum.Font.FredokaOne
		textLabel.TextScaled = true
		textLabel.Text = text
		textLabel.TextColor3 = color
		textLabel.TextStrokeTransparency = 0.2
		textLabel.LayoutOrder = order
		textLabel.Parent = gui
		return textLabel
	end

	if mutation then
		label("Mutation", mutation, Config.MutationsByName[mutation].Color, 18, 1)
	end
	label("GhostName", ghost.Name, Color3.new(1, 1, 1), 24, 2)
	local rarityLabel = label("Rarity", rarity.Name, rarity.Color, 20, 3)
	if rarity.Name == "Secret" or rarity.Name == "Mythic" then
		local gradient = Instance.new("UIGradient")
		gradient.Color = ColorSequence.new({
			ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 80, 80)),
			ColorSequenceKeypoint.new(0.33, Color3.fromRGB(255, 230, 80)),
			ColorSequenceKeypoint.new(0.66, Color3.fromRGB(80, 220, 255)),
			ColorSequenceKeypoint.new(1, Color3.fromRGB(220, 90, 255)),
		})
		gradient.Parent = rarityLabel
		rarityLabel.TextColor3 = Color3.new(1, 1, 1)
		rarityLabel:AddTag("RainbowGradient")
	end
	label("Income", Format.perSecond(Formulas.ghostIncome(ghost.Id, mutation)), Color3.fromRGB(120, 255, 120), 20, 4)

	local bar = Instance.new("Frame")
	bar.Name = "Progress"
	bar.Size = UDim2.new(0.8, 0, 0, 10)
	bar.BackgroundColor3 = Color3.fromRGB(30, 20, 45)
	bar.BorderSizePixel = 0
	bar.Visible = false
	bar.LayoutOrder = 5
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(1, 0)
	corner.Parent = bar
	local fill = Instance.new("Frame")
	fill.Name = "Fill"
	fill.Size = UDim2.fromScale(0, 1)
	fill.BackgroundColor3 = Color3.fromRGB(120, 255, 200)
	fill.BorderSizePixel = 0
	fill.Parent = bar
	corner:Clone().Parent = fill
	bar.Parent = gui

	gui.Parent = root
end

function GhostFactory.getSize(ghostId: string, scale: number?): number
	local ghost = Config.GhostsById[ghostId]
	return Config.Rarities[ghost.Rarity].Size * (scale or 1)
end

function GhostFactory.build(ghostId: string, mutation: string?, options: BuildOptions?): Model
	local opts: BuildOptions = options or {}
	local ghost = assert(Config.GhostsById[ghostId], "Unknown ghost " .. tostring(ghostId))
	local rarity = Config.Rarities[ghost.Rarity]
	local shape = SHAPES[ghost.Shape] or SHAPES.Classic
	local s = rarity.Size * (opts.Scale or 1)

	local model = Instance.new("Model")
	model.Name = ghost.Name
	model:SetAttribute("GhostId", ghost.Id)

	local root = Instance.new("Part")
	root.Name = "Root"
	root.Size = Vector3.one * s
	root.Transparency = 1
	root.Anchored = true
	root.CanCollide = false
	root.CanTouch = false
	root.CanQuery = false
	root.CastShadow = false
	root.CFrame = CFrame.new()
	root.Parent = model
	model.PrimaryPart = root

	local bodyParts: { BasePart } = {}
	local function body(part: BasePart)
		part.Transparency = 0.12
		table.insert(bodyParts, part)
	end

	body(ellipsoid(model, root, "Body", shape.Body * s, ghost.Color, CFrame.new(0, shape.BodyY * s, 0)))

	if shape.Skirt then
		local width = shape.Body.X * s
		for index, x in { -0.32, 0, 0.32 } do
			local wobble = if index == 2 then 0.06 else -0.02
			body(
				ellipsoid(
					model,
					root,
					"Skirt",
					Vector3.new(0.36 * width, 0.42 * width, 0.36 * width),
					ghost.Color,
					CFrame.new(x * width, (shape.BodyY - shape.Body.Y * 0.45 - wobble) * s, 0)
				)
			)
		end
	else
		body(ellipsoid(model, root, "Tail", Vector3.one * 0.35 * s, ghost.Color, CFrame.new(0, -0.5 * s, 0.22 * s)))
	end

	for _, side in { -1, 1 } do
		body(
			ellipsoid(
				model,
				root,
				"Arm",
				Vector3.new(0.22, 0.34, 0.22) * s,
				ghost.Color,
				CFrame.new(side * shape.Body.X * 0.52 * s, shape.BodyY * s - 0.05 * s, 0)
					* CFrame.Angles(0, 0, side * 0.6)
			)
		)
	end

	-- Face
	local front = -shape.Front * s
	for _, side in { -1, 1 } do
		ellipsoid(
			model,
			root,
			"Eye",
			Vector3.new(0.15, 0.25, 0.08) * s,
			EYE_COLOR,
			CFrame.new(side * 0.17 * s, (shape.BodyY + 0.14) * s, front)
		)
		local shine = ellipsoid(
			model,
			root,
			"EyeShine",
			Vector3.one * 0.06 * s,
			Color3.new(1, 1, 1),
			CFrame.new(side * 0.17 * s + 0.03 * s, (shape.BodyY + 0.2) * s, front - 0.04 * s)
		)
		shine.Material = Enum.Material.Neon
		local cheek = ellipsoid(
			model,
			root,
			"Cheek",
			Vector3.new(0.14, 0.08, 0.05) * s,
			CHEEK_COLOR,
			CFrame.new(side * shape.Body.X * 0.3 * s, (shape.BodyY - 0.02) * s, -shape.Body.Z * 0.4 * s)
		)
		cheek.Transparency = 0.35
	end
	ellipsoid(
		model,
		root,
		"Mouth",
		Vector3.new(0.13, 0.11, 0.06) * s,
		EYE_COLOR,
		CFrame.new(0, (shape.BodyY - 0.06) * s, front + 0.01 * s)
	)

	buildHat(model, root, ghost.Hat, s, shape.Top + shape.BodyY * 0.2, ghost.Accent)
	applyMutation(model, bodyParts, mutation)

	if opts.Light ~= false and (ghost.Rarity >= 3 or mutation ~= nil) then
		local light = Instance.new("PointLight")
		light.Color = if mutation then Config.MutationsByName[mutation].Color else rarity.Color
		light.Range = math.clamp(s * 2.5, 8, 18)
		light.Brightness = 1.5
		light.Shadows = false
		light.Parent = root
	end

	if opts.Billboard ~= false then
		buildBillboard(root, ghost, mutation, s)
	end

	model:SetAttribute("Rarity", ghost.Rarity)
	return model
end

return GhostFactory
