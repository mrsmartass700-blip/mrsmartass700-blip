-- Rebirth window: shows the cost, what you keep and what you gain.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Format = require(Shared.Format)
local Formulas = require(Shared.Formulas)

local Panel = require(script.Parent.Panel)
local Ui = require(script.Parent.Ui)

local player = Players.LocalPlayer

local RebirthPanel = {}

function RebirthPanel.mount(screen: ScreenGui)
	local remotes = ReplicatedStorage:WaitForChild("Remotes")
	local panel = Panel.new(screen, "♻️ REBIRTH", Ui.Colors.Purple)
	local list = panel.Content

	local function row(order: number, height: number, color: Color3?): TextLabel
		return Ui.label({
			Size = UDim2.new(1, 0, 0, height),
			Text = "",
			TextColor3 = color or Ui.Colors.Text,
			TextWrapped = true,
			MaxTextSize = 24,
			LayoutOrder = order,
			Parent = list,
		})
	end

	local status = row(1, 40)
	local gains = row(2, 90, Ui.Colors.Cash)
	local warning = row(3, 60, Color3.fromRGB(255, 170, 170))
	warning.Text =
		"⚠️ Resets your cash, ghosts, rooms, upgrades and hotel builds.\nRebirths and game passes are kept."

	local progressBack = Ui.new("Frame", {
		Size = UDim2.new(1, 0, 0, 26),
		BackgroundColor3 = Color3.fromRGB(20, 14, 30),
		LayoutOrder = 4,
		Parent = list,
	}, { Ui.corner(13) })
	local progressFill = Ui.new("Frame", {
		Size = UDim2.fromScale(0, 1),
		BackgroundColor3 = Ui.Colors.Purple,
		Parent = progressBack,
	}, { Ui.corner(13) })
	local progressText = Ui.label({
		Size = UDim2.fromScale(1, 1),
		Text = "",
		MaxTextSize = 18,
		Parent = progressBack,
	})

	local button = Ui.button({
		Size = UDim2.new(1, 0, 0, 60),
		Text = "REBIRTH",
		Color = Ui.Colors.Purple,
		MaxTextSize = 32,
		LayoutOrder = 5,
		Parent = list,
	})

	local function refresh()
		local rebirths = player:GetAttribute("Rebirths") or 0
		local cash = player:GetAttribute("Cash") or 0
		local cost = Formulas.rebirthCost(rebirths)
		status.Text = "Rebirths: " .. rebirths .. "   •   Cost: " .. Format.money(cost)
		gains.Text = string.format(
			"✅ +%d%% income forever (x%.1f → x%.1f)\n✅ +%d%% vacuum power forever",
			Config.Rebirth.IncomeBonus * 100,
			1 + rebirths * Config.Rebirth.IncomeBonus,
			1 + (rebirths + 1) * Config.Rebirth.IncomeBonus,
			Config.Rebirth.VacuumBonus * 100
		)
		local ratio = math.clamp(cash / cost, 0, 1)
		progressFill.Size = UDim2.fromScale(ratio, 1)
		progressText.Text = Format.money(cash) .. " / " .. Format.money(cost)
		local ready = cash >= cost
		button.BackgroundColor3 = if ready then Ui.Colors.Purple else Ui.Colors.Grey
		Ui.setButtonText(button, if ready then "♻️ REBIRTH NOW" else "Not enough cash")
	end

	button.Activated:Connect(function()
		local cost = Formulas.rebirthCost(player:GetAttribute("Rebirths") or 0)
		if (player:GetAttribute("Cash") or 0) >= cost then
			remotes.Rebirth:FireServer()
			panel:close()
		end
	end)

	player:GetAttributeChangedSignal("Cash"):Connect(function()
		if panel.IsOpen then
			refresh()
		end
	end)
	player:GetAttributeChangedSignal("Rebirths"):Connect(refresh)
	panel.Opened:Connect(refresh)
	refresh()

	return panel
end

return RebirthPanel
