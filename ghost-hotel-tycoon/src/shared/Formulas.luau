-- Pure economy formulas shared by server (authoritative) and client (display).

local Config = require(script.Parent.Config)

local Formulas = {}

export type Stats = {
	Rebirths: number,
	Builds: number,
	DoubleCash: boolean,
	VIP: boolean,
	Premium: boolean,
}

--------------------------------------------------------------------------
-- Ghost value
--------------------------------------------------------------------------
function Formulas.mutationMultiplier(mutation: string?): number
	local info = mutation and Config.MutationsByName[mutation]
	return if info then info.Multiplier else 1
end

function Formulas.ghostIncome(ghostId: string, mutation: string?): number
	local ghost = Config.GhostsById[ghostId]
	if not ghost then
		return 0
	end
	return ghost.Income * Formulas.mutationMultiplier(mutation)
end

function Formulas.releaseValue(ghostId: string, mutation: string?, incomeMultiplier: number): number
	return math.floor(Formulas.ghostIncome(ghostId, mutation) * incomeMultiplier * Config.ReleaseSeconds)
end

-- Next mutation tier for the Cauldron, or nil when already at the top.
function Formulas.nextMutation(mutation: string?): string?
	local tier = if mutation then Config.MutationsByName[mutation].Tier else 0
	local nextInfo = Config.Mutations[tier + 1]
	return nextInfo and nextInfo.Name
end

--------------------------------------------------------------------------
-- Multipliers
--------------------------------------------------------------------------
function Formulas.buildBonus(builds: number): number
	local bonus = 0
	for index = 1, math.min(builds, #Config.HotelBuilds) do
		bonus += Config.HotelBuilds[index].IncomeBonus
	end
	return bonus
end

function Formulas.incomeMultiplier(stats: Stats): number
	local rebirth = 1 + stats.Rebirths * Config.Rebirth.IncomeBonus
	local additive = 1 + Formulas.buildBonus(stats.Builds)
	if stats.VIP then
		additive += Config.VipIncomeBonus
	end
	if stats.Premium then
		additive += Config.PremiumIncomeBonus
	end
	local double = if stats.DoubleCash then 2 else 1
	return rebirth * additive * double
end

function Formulas.vacuumPower(level: number, rebirths: number, mega: boolean): number
	local upgrade = Config.Upgrades.Vacuum
	local power = 1 + (level - 1) * upgrade.PowerPerLevel
	power *= 1 + rebirths * Config.Rebirth.VacuumBonus
	if mega then
		power *= Config.MegaVacuumMultiplier
	end
	return power
end

function Formulas.backpackCapacity(level: number, bigBackpack: boolean): number
	local upgrade = Config.Upgrades.Backpack
	local capacity = upgrade.BaseCapacity + (level - 1) * upgrade.CapacityPerLevel
	if bigBackpack then
		capacity += Config.BigBackpackBonus
	end
	return capacity
end

--------------------------------------------------------------------------
-- Costs
--------------------------------------------------------------------------
-- Cost to go from `level` to `level + 1`, or nil when maxed.
function Formulas.upgradeCost(kind: string, level: number): number?
	local upgrade = Config.Upgrades[kind]
	if not upgrade or level >= upgrade.MaxLevel then
		return nil
	end
	return math.floor(upgrade.BaseCost * upgrade.CostGrowth ^ (level - 1))
end

function Formulas.rebirthCost(rebirths: number): number
	return Config.Rebirth.BaseCost * Config.Rebirth.CostGrowth ^ rebirths
end

function Formulas.cashProductAmount(product, incomePerSecond: number): number
	return math.max(product.MinAmount, math.floor(incomePerSecond * product.Minutes * 60))
end

--------------------------------------------------------------------------
-- Rooms
--
-- Rooms are numbered 1..N (row A then row B). The last room of every row
-- is a VIP room. Regular rooms unlock alternating between the two rows.
--------------------------------------------------------------------------
Formulas.TotalRooms = Config.RoomsPerSide * 2

local vipRooms: { [number]: boolean } = {}
local roomOrder: { number } = {}
do
	local perSide = Config.RoomsPerSide
	local vipPerSide = Config.VipRooms // 2
	for index = 1, vipPerSide do
		vipRooms[perSide - index + 1] = true
		vipRooms[perSide * 2 - index + 1] = true
	end
	for row = 1, perSide do
		for _, room in { row, perSide + row } do
			if not vipRooms[room] then
				table.insert(roomOrder, room)
			end
		end
	end
end

Formulas.RoomOrder = roomOrder
Formulas.RegularRooms = #roomOrder

function Formulas.isVipRoom(room: number): boolean
	return vipRooms[room] == true
end

-- Cost of unlocking the next regular room when `unlocked` are owned.
function Formulas.roomCost(unlocked: number): number?
	if unlocked >= Formulas.RegularRooms then
		return nil
	end
	local extra = unlocked - Config.StartRooms
	return math.floor(Config.RoomBaseCost * Config.RoomCostGrowth ^ math.max(0, extra))
end

-- Is the room usable for a hotel with `unlocked` regular rooms?
function Formulas.isRoomOpen(room: number, unlocked: number, vip: boolean): boolean
	if vipRooms[room] then
		return vip
	end
	local position = table.find(roomOrder, room)
	return position ~= nil and position <= unlocked
end

-- The next locked regular room (the one showing the "unlock" prompt).
function Formulas.nextLockedRoom(unlocked: number): number?
	return roomOrder[unlocked + 1]
end

return Formulas
