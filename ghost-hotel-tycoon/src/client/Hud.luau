-- Always-visible HUD: cash, income, backpack, event banner and side menu.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Format = require(Shared.Format)

local Ui = require(script.Parent.Ui)

local player = Players.LocalPlayer

local Hud = {}

export type Callbacks = {
	OnShop: () -> (),
	OnRebirth: () -> (),
	OnHome: () -> (),
}

local function sideButton(
	parent: Instance,
	icon: string,
	text: string,
	color: Color3,
	order: number,
	callback: () -> ()
)
	local button = Ui.new("TextButton", {
		Name = text,
		Size = UDim2.fromOffset(74, 74),
		BackgroundColor3 = color,
		AutoButtonColor = false,
		Text = "",
		LayoutOrder = order,
		Parent = parent,
	}, {
		Ui.corner(16),
		Ui.stroke(Color3.new(0, 0, 0), 2.5),
		Ui.gradient(Color3.new(1, 1, 1), Color3.fromRGB(185, 185, 185)),
	})
	Ui.label({
		Size = UDim2.fromScale(1, 0.62),
		Position = UDim2.fromScale(0, 0.04),
		Text = icon,
		MaxTextSize = 36,
		Parent = button,
	})
	Ui.label({
		Size = UDim2.new(1, -6, 0.3, 0),
		Position = UDim2.new(0, 3, 0.66, 0),
		Text = text,
		TextStrokeTransparency = 0.3,
		MaxTextSize = 16,
		Parent = button,
	})
	local scale = Ui.new("UIScale", { Parent = button })
	button.MouseEnter:Connect(function()
		TweenService:Create(scale, TweenInfo.new(0.12), { Scale = 1.08 }):Play()
	end)
	button.MouseLeave:Connect(function()
		TweenService:Create(scale, TweenInfo.new(0.12), { Scale = 1 }):Play()
	end)
	button.Activated:Connect(callback)
	return button
end

function Hud.mount(screen: ScreenGui, callbacks: Callbacks)
	-- Cash --------------------------------------------------------------
	local cashPanel = Ui.new("Frame", {
		Name = "Cash",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 0, 0, 8),
		Size = UDim2.fromOffset(300, 64),
		BackgroundColor3 = Ui.Colors.Panel,
		BackgroundTransparency = 0.08,
		Parent = screen,
	}, {
		Ui.corner(16),
		Ui.stroke(Ui.Colors.Cash, 2.5),
	})
	local cashLabel = Ui.label({
		Size = UDim2.new(1, -16, 0.62, 0),
		Position = UDim2.fromOffset(8, 4),
		Text = "💰 $0",
		TextColor3 = Ui.Colors.Cash,
		TextStrokeTransparency = 0.3,
		MaxTextSize = 34,
		Parent = cashPanel,
	})
	local incomeLabel = Ui.label({
		Size = UDim2.new(1, -16, 0.3, 0),
		Position = UDim2.new(0, 8, 0.64, 0),
		Text = "+$0/s",
		TextColor3 = Ui.Colors.Muted,
		MaxTextSize = 18,
		Parent = cashPanel,
	})
	local cashScale = Ui.new("UIScale", { Parent = cashPanel })

	local lastCash = 0
	local function updateCash()
		local cash = player:GetAttribute("Cash") or 0
		cashLabel.Text = "💰 " .. Format.money(cash)
		if cash > lastCash then
			cashScale.Scale = 1.08
			TweenService:Create(cashScale, TweenInfo.new(0.25, Enum.EasingStyle.Back), { Scale = 1 }):Play()
		end
		lastCash = cash
	end
	local function updateIncome()
		local income = player:GetAttribute("IncomePerSec") or 0
		local stored = player:GetAttribute("Stored") or 0
		local text = "+" .. Format.perSecond(income)
		if stored >= 1 then
			text ..= '  <font color="#ffd966">• ' .. Format.money(stored) .. " in register</font>"
		end
		incomeLabel.Text = text
	end
	player:GetAttributeChangedSignal("Cash"):Connect(updateCash)
	player:GetAttributeChangedSignal("IncomePerSec"):Connect(updateIncome)
	player:GetAttributeChangedSignal("Stored"):Connect(updateIncome)
	updateCash()
	updateIncome()

	-- Witching Hour banner ---------------------------------------------
	local banner = Ui.new("Frame", {
		Name = "EventBanner",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 0, 0, 78),
		Size = UDim2.fromOffset(360, 34),
		BackgroundColor3 = Color3.fromRGB(90, 20, 90),
		Visible = false,
		Parent = screen,
	}, {
		Ui.corner(12),
		Ui.stroke(Color3.fromRGB(255, 120, 255), 2),
	})
	local bannerLabel = Ui.label({
		Size = UDim2.new(1, -12, 1, -6),
		Position = UDim2.fromScale(0.5, 0.5),
		AnchorPoint = Vector2.new(0.5, 0.5),
		Text = "",
		MaxTextSize = 20,
		Parent = banner,
	})
	task.spawn(function()
		while true do
			local active = ReplicatedStorage:GetAttribute("WitchingHour") == true
			banner.Visible = active
			if active then
				local left = (ReplicatedStorage:GetAttribute("WitchingHourEndsAt") or 0) - workspace:GetServerTimeNow()
				bannerLabel.Text = "🌕 WITCHING HOUR • Rare ghosts x3 • " .. Format.time(left)
			end
			task.wait(0.5)
		end
	end)

	-- Side menu ----------------------------------------------------------
	local menu = Ui.new("Frame", {
		Name = "Menu",
		AnchorPoint = Vector2.new(0, 0.5),
		Position = UDim2.new(0, 10, 0.5, 0),
		Size = UDim2.fromOffset(74, 250),
		BackgroundTransparency = 1,
		Parent = screen,
	}, {
		Ui.new("UIListLayout", {
			SortOrder = Enum.SortOrder.LayoutOrder,
			Padding = UDim.new(0, 10),
			VerticalAlignment = Enum.VerticalAlignment.Center,
		}),
	})
	sideButton(menu, "🛒", "Shop", Ui.Colors.Gold, 1, callbacks.OnShop)
	sideButton(menu, "♻️", "Rebirth", Ui.Colors.Purple, 2, callbacks.OnRebirth)
	sideButton(menu, "🏨", "Hotel", Ui.Colors.Blue, 3, callbacks.OnHome)

	-- Backpack / vacuum ---------------------------------------------------
	local bag = Ui.new("Frame", {
		Name = "Backpack",
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -86),
		Size = UDim2.fromOffset(290, 40),
		BackgroundColor3 = Ui.Colors.Panel,
		BackgroundTransparency = 0.12,
		Parent = screen,
	}, {
		Ui.corner(12),
		Ui.stroke(Ui.Colors.Stroke, 2),
	})
	local bagLabel = Ui.label({
		Size = UDim2.new(1, -16, 1, -8),
		Position = UDim2.fromScale(0.5, 0.5),
		AnchorPoint = Vector2.new(0.5, 0.5),
		Text = "",
		MaxTextSize = 22,
		Parent = bag,
	})
	local hint = Ui.label({
		Name = "Hint",
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -132),
		Size = UDim2.fromOffset(460, 30),
		Text = "",
		TextColor3 = Color3.fromRGB(255, 240, 150),
		TextStrokeTransparency = 0.2,
		MaxTextSize = 22,
		Parent = screen,
	})

	local function updateBag()
		local count = player:GetAttribute("BackpackCount") or 0
		local capacity = player:GetAttribute("BackpackCapacity") or 0
		local power = player:GetAttribute("VacuumPower") or 1
		local color = if capacity > 0 and count >= capacity then "#ff8080" else "#ffffff"
		bagLabel.Text =
			string.format('🎒 <font color="%s">%d/%d</font>   🌀 Power x%.2f', color, count, capacity, power)
		local caught = player:GetAttribute("Caught") or 0
		if caught == 0 then
			hint.Text = "👻 Go to the graveyard and HOLD click near a ghost to vacuum it!"
		elseif capacity > 0 and count >= capacity then
			hint.Text = "🎒 Backpack full! Walk into your hotel to check the ghosts in."
		elseif caught < 4 and count > 0 then
			hint.Text = "🏨 Walk into your hotel to check ghosts in. Collect cash at the green register!"
		else
			hint.Text = ""
		end
	end
	for _, attribute in { "BackpackCount", "BackpackCapacity", "VacuumPower", "Caught" } do
		player:GetAttributeChangedSignal(attribute):Connect(updateBag)
	end
	updateBag()
end

return Hud
