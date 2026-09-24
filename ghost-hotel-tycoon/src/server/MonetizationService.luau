-- Robux monetization: game passes, developer products (ProcessReceipt) and
-- publishing the resolved IDs for the client shop.

local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage.Shared
local Config = require(Shared.Config)
local Format = require(Shared.Format)
local Formulas = require(Shared.Formulas)

local DataService = require(script.Parent.DataService)
local EventService = require(script.Parent.EventService)
local HotelService = require(script.Parent.HotelService)
local PassCache = require(script.Parent.PassCache)
local Remotes = require(script.Parent.Remotes)

local MonetizationService = {}

-- Resolved IDs (config IDs, or looked up by product name).
local productIds: { [string]: number } = {}
local productsById: { [number]: any } = {}

local idsFolder = Instance.new("Configuration")
idsFolder.Name = "MonetizationIds"

local function publishIds()
	for _, pass in Config.GamePasses do
		idsFolder:SetAttribute("Pass_" .. pass.Key, pass.Id)
	end
	for _, product in Config.Products do
		idsFolder:SetAttribute("Product_" .. product.Key, productIds[product.Key] or 0)
	end
end

-- Developer products left at Id = 0 are found by their exact name.
local function resolveProductIds()
	local missing = false
	for _, product in Config.Products do
		if product.Id ~= 0 then
			productIds[product.Key] = product.Id
		else
			missing = true
		end
	end

	if missing then
		local ok, err = pcall(function()
			local pages = MarketplaceService:GetDeveloperProductsAsync()
			while true do
				for _, info in pages:GetCurrentPage() do
					for _, product in Config.Products do
						if product.Id == 0 and info.Name == product.Name then
							productIds[product.Key] = info.ProductId
						end
					end
				end
				if pages.IsFinished then
					break
				end
				pages:AdvanceToNextPageAsync()
			end
		end)
		if not ok then
			warn("[Monetization] Could not list developer products:", err)
		end
	end

	for _, product in Config.Products do
		local id = productIds[product.Key]
		if id and id ~= 0 then
			productsById[id] = product
		else
			warn("[Monetization] Developer product '" .. product.Name .. "' has no ID yet (see README).")
		end
	end
	publishIds()
end

local function grantProduct(player: Player, product): boolean
	if product.Kind == "Cash" then
		local amount = Formulas.cashProductAmount(product, HotelService.getIncomePerSecond(player))
		HotelService.addCash(player, amount)
		Remotes.notify(player, "💰 +" .. Format.money(amount) .. " added. Thank you!", "success")
		return true
	elseif product.Kind == "WitchingHour" then
		EventService.start(product.Duration, player)
		return true
	end
	warn("[Monetization] Unknown product kind", product.Kind)
	return false
end

local function processReceipt(receipt)
	local player = Players:GetPlayerByUserId(receipt.PlayerId)
	if not player then
		-- Roblox retries the receipt the next time the player joins.
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end

	-- Wait for the player's data to finish loading.
	local deadline = os.clock() + 20
	while not HotelService.isLoaded(player) and player.Parent and os.clock() < deadline do
		task.wait(0.5)
	end
	if not HotelService.isLoaded(player) then
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end

	local purchaseId = tostring(receipt.PurchaseId)
	if DataService.hasPurchase(player, purchaseId) then
		return Enum.ProductPurchaseDecision.PurchaseGranted
	end

	local product = productsById[receipt.ProductId]
	if not product then
		warn("[Monetization] Receipt for unknown product", receipt.ProductId)
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end

	local ok, granted = pcall(grantProduct, player, product)
	if not ok or not granted then
		warn("[Monetization] Failed to grant", product.Name, granted)
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end

	DataService.addPurchase(player, purchaseId)
	-- Only confirm once the grant is safely saved. If the save fails the
	-- receipt is retried, and the recorded PurchaseId prevents a double grant.
	if not DataService.save(player) then
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end
	return Enum.ProductPurchaseDecision.PurchaseGranted
end

function MonetizationService.start()
	idsFolder.Parent = ReplicatedStorage
	publishIds()
	task.spawn(resolveProductIds)

	MarketplaceService.ProcessReceipt = processReceipt

	MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player, passId, purchased)
		if not purchased then
			return
		end
		for _, pass in Config.GamePasses do
			if pass.Id ~= 0 and pass.Id == passId then
				PassCache.grant(player, pass.Key)
				Remotes.notify(player, pass.Icon .. " " .. pass.Name .. " unlocked! Thank you!", "success")
				Remotes.notifyAll("✨ " .. player.DisplayName .. " bought " .. pass.Name .. "!", "event")
			end
		end
	end)
end

return MonetizationService
