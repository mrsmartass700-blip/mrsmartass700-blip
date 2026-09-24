-- Tiny UI toolkit: instance creation + the game's visual style.

local Ui = {}

Ui.Colors = {
	Panel = Color3.fromRGB(28, 20, 44),
	PanelLight = Color3.fromRGB(46, 34, 70),
	Stroke = Color3.fromRGB(150, 100, 255),
	Text = Color3.fromRGB(255, 255, 255),
	Muted = Color3.fromRGB(190, 175, 220),
	Cash = Color3.fromRGB(120, 255, 140),
	Gold = Color3.fromRGB(255, 205, 70),
	Green = Color3.fromRGB(70, 210, 120),
	Blue = Color3.fromRGB(80, 160, 255),
	Purple = Color3.fromRGB(160, 90, 255),
	Red = Color3.fromRGB(240, 80, 90),
	Grey = Color3.fromRGB(110, 105, 125),
}

Ui.Font = Enum.Font.FredokaOne

function Ui.new(className: string, props: { [string]: any }?, children: { Instance }?): any
	local instance = Instance.new(className)
	local parent = nil
	for key, value in props or {} do
		if key == "Parent" then
			parent = value
		else
			(instance :: any)[key] = value
		end
	end
	for _, child in children or {} do
		child.Parent = instance
	end
	instance.Parent = parent
	return instance
end

function Ui.corner(radius: number?): UICorner
	return Ui.new("UICorner", { CornerRadius = UDim.new(0, radius or 12) })
end

function Ui.stroke(color: Color3?, thickness: number?): UIStroke
	return Ui.new("UIStroke", {
		Color = color or Ui.Colors.Stroke,
		Thickness = thickness or 2,
		ApplyStrokeMode = Enum.ApplyStrokeMode.Border,
	})
end

function Ui.padding(pixels: number): UIPadding
	local amount = UDim.new(0, pixels)
	return Ui.new("UIPadding", {
		PaddingTop = amount,
		PaddingBottom = amount,
		PaddingLeft = amount,
		PaddingRight = amount,
	})
end

function Ui.gradient(top: Color3, bottom: Color3): UIGradient
	return Ui.new("UIGradient", {
		Color = ColorSequence.new(top, bottom),
		Rotation = 90,
	})
end

function Ui.label(props: { [string]: any }): TextLabel
	local defaults = {
		BackgroundTransparency = 1,
		Font = Ui.Font,
		TextColor3 = Ui.Colors.Text,
		TextScaled = true,
		RichText = true,
	}
	for key, value in props do
		if key ~= "MaxTextSize" then
			defaults[key] = value
		end
	end
	local label = Ui.new("TextLabel", defaults)
	Ui.new("UITextSizeConstraint", { MaxTextSize = props.MaxTextSize or 40, Parent = label })
	return label
end

-- Chunky game button with a darker bottom edge and a press animation.
function Ui.button(props: { [string]: any }): TextButton
	local color: Color3 = props.Color or Ui.Colors.Green
	local button = Ui.new("TextButton", {
		Name = props.Name or "Button",
		Size = props.Size or UDim2.fromOffset(160, 50),
		Position = props.Position or UDim2.new(),
		AnchorPoint = props.AnchorPoint or Vector2.zero,
		BackgroundColor3 = color,
		AutoButtonColor = false,
		Text = "",
		LayoutOrder = props.LayoutOrder or 0,
		Parent = props.Parent,
	}, {
		Ui.corner(props.Radius or 12),
		Ui.stroke(Color3.new(0, 0, 0), 2),
		Ui.gradient(Color3.new(1, 1, 1), Color3.fromRGB(200, 200, 200)),
	})
	Ui.label({
		Name = "Label",
		Size = UDim2.new(1, -12, 1, -8),
		Position = UDim2.fromScale(0.5, 0.5),
		AnchorPoint = Vector2.new(0.5, 0.5),
		Text = props.Text or "",
		TextStrokeTransparency = 0.4,
		MaxTextSize = props.MaxTextSize or 28,
		Parent = button,
	})
	local scale = Ui.new("UIScale", { Parent = button })
	button.MouseButton1Down:Connect(function()
		scale.Scale = 0.92
	end)
	button.MouseButton1Up:Connect(function()
		scale.Scale = 1
	end)
	button.MouseLeave:Connect(function()
		scale.Scale = 1
	end)
	return button
end

function Ui.setButtonText(button: TextButton, text: string)
	local label = button:FindFirstChild("Label") :: TextLabel?
	if label then
		label.Text = text
	end
end

return Ui
