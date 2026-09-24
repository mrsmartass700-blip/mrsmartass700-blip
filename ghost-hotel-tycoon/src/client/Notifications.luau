-- Toast notifications stacked under the cash display.

local TweenService = game:GetService("TweenService")

local Ui = require(script.Parent.Ui)

local Notifications = {}

local MAX_TOASTS = 5
local LIFETIME = 4.5

local KIND_COLORS = {
	info = Ui.Colors.Purple,
	success = Ui.Colors.Green,
	error = Ui.Colors.Red,
	event = Ui.Colors.Gold,
	rare = Color3.fromRGB(255, 90, 220),
}

local container: Frame

function Notifications.mount(screen: ScreenGui)
	container = Ui.new("Frame", {
		Name = "Notifications",
		BackgroundTransparency = 1,
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 0, 0, 118),
		Size = UDim2.new(0.9, 0, 0, 260),
		Parent = screen,
	}, {
		Ui.new("UIListLayout", {
			SortOrder = Enum.SortOrder.LayoutOrder,
			HorizontalAlignment = Enum.HorizontalAlignment.Center,
			Padding = UDim.new(0, 6),
		}),
		Ui.new("UISizeConstraint", { MaxSize = Vector2.new(520, math.huge) }),
	})
end

local order = 0

function Notifications.show(text: string, kind: string?)
	if not container then
		return
	end
	order += 1
	local color = KIND_COLORS[kind or "info"] or KIND_COLORS.info

	local toast = Ui.new("Frame", {
		Name = "Toast",
		BackgroundColor3 = Ui.Colors.Panel,
		BackgroundTransparency = 0.1,
		Size = UDim2.new(1, 0, 0, 40),
		LayoutOrder = order,
		Parent = container,
	}, {
		Ui.corner(10),
		Ui.stroke(color, 2),
	})
	local label = Ui.label({
		Size = UDim2.new(1, -20, 1, -8),
		Position = UDim2.fromScale(0.5, 0.5),
		AnchorPoint = Vector2.new(0.5, 0.5),
		Text = text,
		TextColor3 = if kind == "error" then Color3.fromRGB(255, 190, 190) else Ui.Colors.Text,
		MaxTextSize = 22,
		Parent = toast,
	})
	local scale = Ui.new("UIScale", { Scale = 0.6, Parent = toast })
	TweenService:Create(scale, TweenInfo.new(0.25, Enum.EasingStyle.Back), { Scale = 1 }):Play()

	local toasts = {}
	for _, child in container:GetChildren() do
		if child:IsA("Frame") then
			table.insert(toasts, child)
		end
	end
	table.sort(toasts, function(a, b)
		return a.LayoutOrder < b.LayoutOrder
	end)
	while #toasts > MAX_TOASTS do
		table.remove(toasts, 1):Destroy()
	end

	task.delay(LIFETIME, function()
		if not toast.Parent then
			return
		end
		local fade = TweenInfo.new(0.35)
		TweenService:Create(toast, fade, { BackgroundTransparency = 1 }):Play()
		TweenService:Create(label, fade, { TextTransparency = 1, TextStrokeTransparency = 1 }):Play()
		local stroke = toast:FindFirstChildOfClass("UIStroke")
		if stroke then
			TweenService:Create(stroke, fade, { Transparency = 1 }):Play()
		end
		task.wait(0.4)
		toast:Destroy()
	end)
end

return Notifications
