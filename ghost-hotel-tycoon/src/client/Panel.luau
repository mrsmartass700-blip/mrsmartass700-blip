-- Reusable modal window with a title bar, close button and scrolling body.
-- Only one panel is open at a time.

local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local Ui = require(script.Parent.Ui)

local Panel = {}
Panel.__index = Panel

export type Panel = {
	Frame: Frame,
	Content: ScrollingFrame,
	Opened: RBXScriptSignal,
	IsOpen: boolean,
	open: (self: Panel) -> (),
	close: (self: Panel) -> (),
	toggle: (self: Panel) -> (),
}

local current = nil

function Panel.new(screen: ScreenGui, title: string, accent: Color3)
	local frame = Ui.new("Frame", {
		Name = title,
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.52),
		Size = UDim2.fromScale(0.92, 0.8),
		BackgroundColor3 = Ui.Colors.Panel,
		Visible = false,
		Parent = screen,
	}, {
		Ui.corner(20),
		Ui.stroke(accent, 3),
		Ui.new("UISizeConstraint", { MaxSize = Vector2.new(660, 540) }),
	})
	local scale = Ui.new("UIScale", { Parent = frame })

	Ui.label({
		Size = UDim2.new(1, -120, 0, 44),
		Position = UDim2.fromOffset(18, 10),
		Text = title,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextColor3 = accent,
		MaxTextSize = 34,
		Parent = frame,
	})

	local closeButton = Ui.button({
		Size = UDim2.fromOffset(44, 44),
		AnchorPoint = Vector2.new(1, 0),
		Position = UDim2.new(1, -10, 0, 10),
		Text = "✕",
		Color = Ui.Colors.Red,
		Parent = frame,
	})

	local content = Ui.new("ScrollingFrame", {
		Name = "Content",
		Position = UDim2.fromOffset(14, 64),
		Size = UDim2.new(1, -28, 1, -78),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		CanvasSize = UDim2.new(),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		ScrollBarThickness = 6,
		ScrollBarImageColor3 = accent,
		Parent = frame,
	}, {
		Ui.new("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 10) }),
		Ui.new("UIPadding", { PaddingRight = UDim.new(0, 10), PaddingBottom = UDim.new(0, 10) }),
	})

	local opened = Instance.new("BindableEvent")
	local self = setmetatable({
		Frame = frame,
		Content = content,
		Opened = opened.Event,
		IsOpen = false,
		_opened = opened,
		_scale = scale,
	}, Panel)

	closeButton.Activated:Connect(function()
		self:close()
	end)

	return self
end

function Panel:open()
	if current and current ~= self then
		current:close()
	end
	current = self
	self.IsOpen = true
	self.Frame.Visible = true
	local camera = Workspace.CurrentCamera
	local fit = if camera then math.clamp(camera.ViewportSize.Y / 640, 0.6, 1) else 1
	self._scale.Scale = fit * 0.85
	TweenService:Create(self._scale, TweenInfo.new(0.2, Enum.EasingStyle.Back), { Scale = fit }):Play()
	self._opened:Fire()
end

function Panel:close()
	self.IsOpen = false
	self.Frame.Visible = false
	if current == self then
		current = nil
	end
end

function Panel:toggle()
	if self.IsOpen then
		self:close()
	else
		self:open()
	end
end

return Panel
