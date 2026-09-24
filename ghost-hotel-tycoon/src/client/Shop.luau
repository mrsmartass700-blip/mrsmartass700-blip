-- Robux shop: game passes, cash packs and the Witching Hour (with odds).

local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Format = require(Shared.Format)
local Formulas = require(Shared.Formulas)
local Odds = require(Shared.Odds)

local Notifications = require(script.Parent.Notifications)
local Panel = require(script.Parent.Panel)
local Ui = require(script.Parent.Ui)

local player = Players.LocalPlayer

local Shop = {}

local priceCache: { [string]: number } = {}

local function getIds(): Instance?
	return ReplicatedStorage:FindFirstChild("MonetizationIds")
end

local function getId(kind: string, key: string): number
	local ids = getIds()
	return if ids then ids:GetAttribute(kind .. "_" .. key) or 0 else 0
end

local function fetchPrice(kind: string, id: number, callback: (number) -> ())
	local cacheKey = kind .. id
	if priceCache[cacheKey] then
		callback(priceCache[cacheKey])
		return
	end
	task.spawn(function()
		local ok, info = pcall(function()
			local infoType = if kind == "Pass" then Enum.InfoType.GamePass else Enum.InfoType.Product
			return MarketplaceService:GetProductInfoAsync(id, infoType)
		end)
		if ok and info and info.PriceInRobux then
			priceCache[cacheKey] = info.PriceInRobux
			callback(info.PriceInRobux)
		end
	end)
end

local function sectionTitle(parent: Instance, text: string, order: number)
	Ui.label({
		Size = UDim2.new(1, 0, 0, 34),
		Text = text,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextColor3 = Ui.Colors.Gold,
		MaxTextSize = 26,
		LayoutOrder = order,
		Parent = parent,
	})
end

local function grid(parent: Instance, order: number): Frame
	return Ui.new("Frame", {
		Size = UDim2.fromScale(1, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		BackgroundTransparency = 1,
		LayoutOrder = order,
		Parent = parent,
	}, {
		Ui.new("UIGridLayout", {
			CellSize = UDim2.new(0.5, -6, 0, 150),
			CellPadding = UDim2.fromOffset(12, 12),
			SortOrder = Enum.SortOrder.LayoutOrder,
		}),
	})
end

type CardInfo = {
	Icon: string,
	Title: string,
	Description: string,
	Order: number,
	Color: Color3,
}

local function card(parent: Instance, info: CardInfo): (Frame, TextButton, TextLabel)
	local frame = Ui.new("Frame", {
		BackgroundColor3 = Ui.Colors.PanelLight,
		LayoutOrder = info.Order,
		Parent = parent,
	}, {
		Ui.corner(14),
		Ui.stroke(info.Color, 2),
	})
	Ui.label({
		Size = UDim2.fromOffset(56, 56),
		Position = UDim2.fromOffset(8, 8),
		Text = info.Icon,
		MaxTextSize = 44,
		Parent = frame,
	})
	Ui.label({
		Size = UDim2.new(1, -76, 0, 28),
		Position = UDim2.fromOffset(70, 10),
		Text = info.Title,
		TextXAlignment = Enum.TextXAlignment.Left,
		MaxTextSize = 24,
		Parent = frame,
	})
	local description = Ui.label({
		Size = UDim2.new(1, -76, 0, 50),
		Position = UDim2.fromOffset(70, 38),
		Text = info.Description,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextYAlignment = Enum.TextYAlignment.Top,
		TextColor3 = Ui.Colors.Muted,
		TextWrapped = true,
		MaxTextSize = 16,
		Parent = frame,
	})
	local button = Ui.button({
		Size = UDim2.new(1, -16, 0, 44),
		Position = UDim2.new(0, 8, 1, -52),
		Text = "...",
		Color = Ui.Colors.Green,
		MaxTextSize = 24,
		Parent = frame,
	})
	return frame, button, description
end

function Shop.mount(screen: ScreenGui)
	local panel = Panel.new(screen, "🛒 SHOP", Ui.Colors.Gold)
	local list = panel.Content

	-- Game passes -------------------------------------------------------
	sectionTitle(list, "✨ Game Passes (forever)", 1)
	local passGrid = grid(list, 2)
	for index, pass in Config.GamePasses do
		local _, button = card(passGrid, {
			Icon = pass.Icon,
			Title = pass.Name,
			Description = pass.Description,
			Order = index,
			Color = Ui.Colors.Gold,
		})

		local function refresh()
			local id = getId("Pass", pass.Key)
			if player:GetAttribute("Pass_" .. pass.Key) then
				Ui.setButtonText(button, "✅ OWNED")
				button.BackgroundColor3 = Ui.Colors.Grey
			elseif id == 0 then
				Ui.setButtonText(button, "Coming soon")
				button.BackgroundColor3 = Ui.Colors.Grey
			else
				button.BackgroundColor3 = Ui.Colors.Green
				Ui.setButtonText(button, "Buy")
				fetchPrice("Pass", id, function(price)
					if not player:GetAttribute("Pass_" .. pass.Key) then
						Ui.setButtonText(button, "R$ " .. price)
					end
				end)
			end
		end
		button.Activated:Connect(function()
			local id = getId("Pass", pass.Key)
			if player:GetAttribute("Pass_" .. pass.Key) then
				return
			end
			if id == 0 then
				Notifications.show("This pass isn't set up yet.", "error")
				return
			end
			MarketplaceService:PromptGamePassPurchase(player, id)
		end)
		player:GetAttributeChangedSignal("Pass_" .. pass.Key):Connect(refresh)
		panel.Opened:Connect(refresh)
		refresh()
	end

	-- Products ------------------------------------------------------------
	sectionTitle(list, "💰 Cash & Boosts", 3)
	local productGrid = grid(list, 4)
	for index, product in Config.Products do
		local description = if product.Kind == "WitchingHour"
			then string.format(
				"Rare ghosts x%d + double spawns for EVERYONE for %s!",
				Config.WitchingHour.Luck,
				Format.time(product.Duration)
			)
			else ""
		local _, button, descriptionLabel = card(productGrid, {
			Icon = product.Icon,
			Title = product.Name,
			Description = description,
			Order = index,
			Color = if product.Kind == "WitchingHour" then Color3.fromRGB(255, 120, 255) else Ui.Colors.Cash,
		})

		local function refresh()
			if product.Kind == "Cash" then
				local amount = Formulas.cashProductAmount(product, player:GetAttribute("IncomePerSec") or 0)
				descriptionLabel.Text = '<font color="#7dff9b">+' .. Format.money(amount) .. "</font> cash instantly"
			end
			local id = getId("Product", product.Key)
			if id == 0 then
				Ui.setButtonText(button, "Coming soon")
				button.BackgroundColor3 = Ui.Colors.Grey
			else
				button.BackgroundColor3 = Ui.Colors.Green
				Ui.setButtonText(button, "Buy")
				fetchPrice("Product", id, function(price)
					Ui.setButtonText(button, "R$ " .. price)
				end)
			end
		end
		button.Activated:Connect(function()
			local id = getId("Product", product.Key)
			if id == 0 then
				Notifications.show("This item isn't set up yet.", "error")
				return
			end
			MarketplaceService:PromptProductPurchase(player, id)
		end)
		panel.Opened:Connect(refresh)
		refresh()
	end

	-- Odds disclosure -------------------------------------------------------
	sectionTitle(list, "🎲 Ghost odds (normal → Witching Hour)", 5)
	local oddsBox = Ui.new("Frame", {
		Size = UDim2.fromScale(1, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		BackgroundColor3 = Ui.Colors.PanelLight,
		LayoutOrder = 6,
		Parent = list,
	}, {
		Ui.corner(12),
		Ui.padding(10),
		Ui.new("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 2) }),
	})
	local normal = Odds.getChances(1)
	local boosted = Odds.getChances(Config.WitchingHour.Luck)
	for index, rarity in Config.Rarities do
		Ui.label({
			Size = UDim2.new(1, 0, 0, 22),
			Text = string.format(
				'<font color="#%s">%s</font>   %s → <font color="#ff9cff">%s</font>',
				rarity.Color:ToHex(),
				rarity.Name,
				Format.percent(normal[index]),
				Format.percent(boosted[index])
			),
			TextXAlignment = Enum.TextXAlignment.Left,
			MaxTextSize = 18,
			LayoutOrder = index,
			Parent = oddsBox,
		})
	end
	local mutationText = {}
	for _, mutation in Config.Mutations do
		table.insert(
			mutationText,
			string.format("%s %s (x%d)", mutation.Name, Format.percent(mutation.Chance * 100), mutation.Multiplier)
		)
	end
	Ui.label({
		Size = UDim2.new(1, 0, 0, 36),
		Text = "Mutations: " .. table.concat(mutationText, " • "),
		TextXAlignment = Enum.TextXAlignment.Left,
		TextColor3 = Ui.Colors.Muted,
		TextWrapped = true,
		MaxTextSize = 16,
		LayoutOrder = 100,
		Parent = oddsBox,
	})

	return panel
end

return Shop
