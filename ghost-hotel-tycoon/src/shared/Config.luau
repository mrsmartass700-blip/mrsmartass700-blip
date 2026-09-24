-- Central game configuration: economy, ghosts, odds and monetization.
-- Everything a designer might want to tune lives here.

local Config = {}

Config.GameName = "Ghost Hotel Tycoon"

--------------------------------------------------------------------------
-- Economy
--------------------------------------------------------------------------
Config.StartingCash = 0
Config.ReleaseSeconds = 30 -- releasing a ghost pays this many seconds of its income
Config.OfflineEarningsRate = 0.1 -- fraction of income earned while offline
Config.OfflineEarningsMaxSeconds = 2 * 60 * 60
Config.PremiumIncomeBonus = 0.1 -- Roblox Premium members earn +10%
Config.VipIncomeBonus = 0.2

Config.Rebirth = {
	BaseCost = 1_000_000,
	CostGrowth = 4, -- every rebirth costs 4x the previous one
	IncomeBonus = 0.5, -- +50% income per rebirth
	VacuumBonus = 0.15, -- +15% vacuum power per rebirth
	StartCash = 250, -- cash you restart with after a rebirth
}

--------------------------------------------------------------------------
-- Hotel
--------------------------------------------------------------------------
Config.MaxPlots = 8 -- set the place's server size to 8
Config.RoomsPerSide = 7 -- rooms are built in two rows
Config.VipRooms = 2 -- the last room of each row is VIP-only
Config.StartRooms = 4 -- rooms a brand new hotel owns
Config.RoomBaseCost = 250 -- price of the first room you unlock
Config.RoomCostGrowth = 2.2

-- Classic tycoon build buttons. They appear one after another in front of
-- your hotel; buying one builds that part of the hotel and raises its
-- star rating, which boosts all income.
Config.HotelBuilds = {
	{ Key = "Fence", Name = "Spooky Fence", Price = 50, IncomeBonus = 0.05 },
	{ Key = "Lamps", Name = "Ghost Lamps", Price = 400, IncomeBonus = 0.1 },
	{ Key = "Sign", Name = "Neon Sign", Price = 2_000, IncomeBonus = 0.1 },
	{ Key = "Carpet", Name = "Red Carpet", Price = 8_000, IncomeBonus = 0.15 },
	{ Key = "Fountain", Name = "Slime Fountain", Price = 35_000, IncomeBonus = 0.2 },
	{ Key = "Tower", Name = "Haunted Tower", Price = 150_000, IncomeBonus = 0.25 },
	{ Key = "Garden", Name = "Pumpkin Garden", Price = 600_000, IncomeBonus = 0.3 },
	{ Key = "Moon", Name = "Blood Moon Beacon", Price = 2_500_000, IncomeBonus = 0.5 },
}

Config.Upgrades = {
	Vacuum = {
		Name = "Vacuum",
		Icon = "🌀",
		MaxLevel = 10,
		BaseCost = 100,
		CostGrowth = 2.6,
		PowerPerLevel = 0.35, -- capture speed +35% per level
	},
	Backpack = {
		Name = "Backpack",
		Icon = "🎒",
		MaxLevel = 8,
		BaseCost = 150,
		CostGrowth = 2.8,
		BaseCapacity = 3,
		CapacityPerLevel = 1,
	},
}

--------------------------------------------------------------------------
-- Ghost hunting
--------------------------------------------------------------------------
Config.MaxGhosts = 22
Config.SpawnInterval = 1.8 -- seconds between ghost spawns
Config.GhostLifetime = 80 -- seconds before an uncaught ghost fades away
Config.VacuumRange = 24
Config.VacuumPullSpeed = 3 -- studs/s a ghost is dragged toward you
Config.ProgressDecay = 0.35 -- capture progress lost per second when nobody vacuums

Config.WalkSpeed = 18
Config.SpeedCoilWalkSpeed = 27
Config.HomeTeleportCooldown = 8

-- Witching Hour: a server-wide event with better odds and more ghosts.
Config.WitchingHour = {
	Every = 10 * 60, -- happens naturally this often
	Duration = 60,
	Luck = 3,
	SpawnRate = 2,
}

--------------------------------------------------------------------------
-- Rarities (ordered from most common to rarest)
-- CaptureTime: seconds of vacuuming needed at vacuum power 1.
--------------------------------------------------------------------------
Config.Rarities = {
	{ Name = "Common", Color = Color3.fromRGB(215, 215, 225), Weight = 58, Size = 2.6, CaptureTime = 1, Speed = 4 },
	{ Name = "Uncommon", Color = Color3.fromRGB(95, 225, 115), Weight = 26, Size = 3, CaptureTime = 1.8, Speed = 5 },
	{ Name = "Rare", Color = Color3.fromRGB(70, 155, 255), Weight = 11, Size = 3.4, CaptureTime = 3, Speed = 6 },
	{ Name = "Epic", Color = Color3.fromRGB(185, 95, 255), Weight = 4, Size = 4, CaptureTime = 4.5, Speed = 7 },
	{ Name = "Legendary", Color = Color3.fromRGB(255, 190, 40), Weight = 0.8, Size = 4.7, CaptureTime = 7, Speed = 8 },
	{ Name = "Mythic", Color = Color3.fromRGB(255, 60, 95), Weight = 0.18, Size = 5.4, CaptureTime = 10, Speed = 9 },
	{ Name = "Secret", Color = Color3.fromRGB(255, 255, 255), Weight = 0.02, Size = 6.3, CaptureTime = 15, Speed = 10 },
}

-- Luck multiplies the weight of every rarity from this index upwards.
Config.LuckAffectsFromRarity = 3 -- Rare and better

-- Rarities from this index upwards are announced to the whole server.
Config.AnnounceFromRarity = 5 -- Legendary and better

--------------------------------------------------------------------------
-- Mutations: rolled for every ghost that spawns (rarest checked first).
-- They multiply income. The Cauldron fuses 3 identical ghosts into one
-- ghost of the next tier: none -> Gold -> Diamond -> Rainbow.
--------------------------------------------------------------------------
Config.Mutations = {
	{ Name = "Gold", Chance = 0.05, Multiplier = 4, Color = Color3.fromRGB(255, 200, 45) },
	{ Name = "Diamond", Chance = 0.01, Multiplier = 15, Color = Color3.fromRGB(140, 230, 255) },
	{ Name = "Rainbow", Chance = 0.002, Multiplier = 50, Color = Color3.fromRGB(255, 120, 220) },
}
Config.FuseCount = 3

--------------------------------------------------------------------------
-- Ghosts. Shape: Classic | Round | Tall
-- Hat: None | Crown | Witch | Halo | Horns | Top | Antenna | Stem | Bow
--------------------------------------------------------------------------
-- stylua: ignore start
Config.Ghosts = {
	-- Common
	{ Id = "boo_blob", Name = "Boo Blob", Rarity = 1, Income = 1, Shape = "Round", Color = Color3.fromRGB(240, 240, 255), Accent = Color3.fromRGB(150, 150, 190), Hat = "None" },
	{ Id = "sheet_sam", Name = "Sheet Sam", Rarity = 1, Income = 2, Shape = "Classic", Color = Color3.fromRGB(225, 225, 230), Accent = Color3.fromRGB(90, 90, 100), Hat = "Bow" },
	{ Id = "pumpkin_puff", Name = "Pumpkin Puff", Rarity = 1, Income = 3, Shape = "Round", Color = Color3.fromRGB(255, 150, 50), Accent = Color3.fromRGB(70, 150, 60), Hat = "Stem" },
	{ Id = "candle_kid", Name = "Candle Kid", Rarity = 1, Income = 4, Shape = "Tall", Color = Color3.fromRGB(250, 235, 200), Accent = Color3.fromRGB(255, 170, 40), Hat = "Antenna" },

	-- Uncommon
	{ Id = "slime_spook", Name = "Slime Spook", Rarity = 2, Income = 9, Shape = "Round", Color = Color3.fromRGB(120, 230, 90), Accent = Color3.fromRGB(60, 150, 50), Hat = "None" },
	{ Id = "bat_boo", Name = "Bat Boo", Rarity = 2, Income = 15, Shape = "Classic", Color = Color3.fromRGB(120, 80, 170), Accent = Color3.fromRGB(40, 20, 60), Hat = "Horns" },
	{ Id = "mummy_mo", Name = "Mummy Mo", Rarity = 2, Income = 22, Shape = "Tall", Color = Color3.fromRGB(230, 215, 175), Accent = Color3.fromRGB(170, 150, 110), Hat = "Bow" },

	-- Rare
	{ Id = "candy_wisp", Name = "Candy Wisp", Rarity = 3, Income = 55, Shape = "Classic", Color = Color3.fromRGB(255, 190, 90), Accent = Color3.fromRGB(255, 255, 255), Hat = "Stem" },
	{ Id = "frost_phantom", Name = "Frost Phantom", Rarity = 3, Income = 85, Shape = "Tall", Color = Color3.fromRGB(170, 225, 255), Accent = Color3.fromRGB(80, 160, 255), Hat = "Crown" },
	{ Id = "lantern_lurker", Name = "Lantern Lurker", Rarity = 3, Income = 130, Shape = "Round", Color = Color3.fromRGB(255, 230, 110), Accent = Color3.fromRGB(80, 60, 30), Hat = "Antenna" },

	-- Epic
	{ Id = "witch_wisp", Name = "Witch Wisp", Rarity = 4, Income = 320, Shape = "Classic", Color = Color3.fromRGB(170, 120, 255), Accent = Color3.fromRGB(35, 25, 50), Hat = "Witch" },
	{ Id = "count_boocula", Name = "Count Boocula", Rarity = 4, Income = 500, Shape = "Tall", Color = Color3.fromRGB(235, 225, 240), Accent = Color3.fromRGB(180, 20, 40), Hat = "Top" },
	{ Id = "skelly_shade", Name = "Skelly Shade", Rarity = 4, Income = 700, Shape = "Round", Color = Color3.fromRGB(245, 245, 235), Accent = Color3.fromRGB(30, 30, 30), Hat = "Horns" },

	-- Legendary
	{ Id = "pumpking", Name = "Pumpking", Rarity = 5, Income = 2_500, Shape = "Round", Color = Color3.fromRGB(255, 120, 20), Accent = Color3.fromRGB(255, 215, 60), Hat = "Crown" },
	{ Id = "moon_wraith", Name = "Moon Wraith", Rarity = 5, Income = 4_500, Shape = "Tall", Color = Color3.fromRGB(200, 215, 255), Accent = Color3.fromRGB(110, 130, 255), Hat = "Halo" },

	-- Mythic
	{ Id = "phantom_pharaoh", Name = "Phantom Pharaoh", Rarity = 6, Income = 25_000, Shape = "Tall", Color = Color3.fromRGB(80, 120, 230), Accent = Color3.fromRGB(255, 205, 60), Hat = "Crown" },
	{ Id = "void_kraken", Name = "Void Kraken", Rarity = 6, Income = 45_000, Shape = "Classic", Color = Color3.fromRGB(70, 30, 110), Accent = Color3.fromRGB(0, 255, 200), Hat = "Antenna" },

	-- Secret
	{ Id = "glitch_ghost", Name = "Glitch Ghost", Rarity = 7, Income = 450_000, Shape = "Classic", Color = Color3.fromRGB(20, 20, 25), Accent = Color3.fromRGB(0, 255, 90), Hat = "Antenna" },
	{ Id = "headless_hotelier", Name = "Headless Hotelier", Rarity = 7, Income = 1_000_000, Shape = "Tall", Color = Color3.fromRGB(40, 40, 50), Accent = Color3.fromRGB(255, 60, 60), Hat = "Top" },
}
-- stylua: ignore end

Config.GhostsById = {}
for _, ghost in Config.Ghosts do
	Config.GhostsById[ghost.Id] = ghost
end

Config.MutationsByName = {}
for index, mutation in Config.Mutations do
	mutation.Tier = index
	Config.MutationsByName[mutation.Name] = mutation
end

--------------------------------------------------------------------------
-- Monetization
--
-- 1. Publish the place, then create the Game Passes and Developer Products
--    in the Creator Dashboard (Monetization tab) using the names below.
-- 2. Game Passes: paste each pass ID into `Id`.
-- 3. Developer Products: either paste the ID into `Id`, or leave it at 0 —
--    the server looks products up by their exact `Name` at startup.
--
-- `SuggestedPrice` is only a hint for the dashboard; the in-game shop shows
-- the real price that Roblox reports.
--------------------------------------------------------------------------
Config.GamePasses = {
	{
		Key = "DoubleCash",
		Id = 0,
		Name = "2x Cash",
		Icon = "💰",
		Description = "Every ghost pays double. Forever.",
		SuggestedPrice = 199,
	},
	{
		Key = "VIP",
		Id = 0,
		Name = "VIP",
		Icon = "👑",
		Description = "2 golden VIP rooms, +20% income and a [VIP] chat tag.",
		SuggestedPrice = 299,
	},
	{
		Key = "MegaVacuum",
		Id = 0,
		Name = "Mega Vacuum",
		Icon = "🌪️",
		Description = "Capture ghosts twice as fast.",
		SuggestedPrice = 249,
	},
	{
		Key = "BigBackpack",
		Id = 0,
		Name = "Big Backpack",
		Icon = "🎒",
		Description = "Carry 5 more ghosts at once.",
		SuggestedPrice = 149,
	},
	{
		Key = "SpeedCoil",
		Id = 0,
		Name = "Speed Coil",
		Icon = "⚡",
		Description = "Run 50% faster. Beat everyone to the rare ghosts.",
		SuggestedPrice = 99,
	},
}

Config.MegaVacuumMultiplier = 2
Config.BigBackpackBonus = 5

Config.Products = {
	{
		Key = "CashSmall",
		Id = 0,
		Name = "Small Cash Pack",
		Icon = "💵",
		Kind = "Cash",
		Minutes = 10, -- scales with the buyer's income
		MinAmount = 1_000,
		SuggestedPrice = 25,
	},
	{
		Key = "CashMedium",
		Id = 0,
		Name = "Medium Cash Pack",
		Icon = "💰",
		Kind = "Cash",
		Minutes = 60,
		MinAmount = 10_000,
		SuggestedPrice = 99,
	},
	{
		Key = "CashLarge",
		Id = 0,
		Name = "Huge Cash Pack",
		Icon = "🏦",
		Kind = "Cash",
		Minutes = 300,
		MinAmount = 100_000,
		SuggestedPrice = 399,
	},
	{
		Key = "WitchingHour",
		Id = 0,
		Name = "Summon Witching Hour",
		Icon = "🌕",
		Kind = "WitchingHour",
		Duration = 5 * 60, -- stacks: buying again adds more time
		SuggestedPrice = 149,
	},
}

Config.GamePassesByKey = {}
for _, pass in Config.GamePasses do
	Config.GamePassesByKey[pass.Key] = pass
end

Config.ProductsByKey = {}
for _, product in Config.Products do
	Config.ProductsByKey[product.Key] = product
end

return Config
