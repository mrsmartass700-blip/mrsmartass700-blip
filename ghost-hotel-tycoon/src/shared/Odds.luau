-- Rarity / mutation odds. Shared so the shop can show exact chances.

local Config = require(script.Parent.Config)

local Odds = {}

local ghostsByRarity: { [number]: { any } } = {}
for _, ghost in Config.Ghosts do
	ghostsByRarity[ghost.Rarity] = ghostsByRarity[ghost.Rarity] or {}
	table.insert(ghostsByRarity[ghost.Rarity], ghost)
end

function Odds.getWeights(luck: number): { number }
	local weights = {}
	for index, rarity in Config.Rarities do
		local weight = rarity.Weight
		if index >= Config.LuckAffectsFromRarity then
			weight *= luck
		end
		weights[index] = weight
	end
	return weights
end

-- Chance (in percent) of every rarity for the given luck multiplier.
function Odds.getChances(luck: number): { number }
	local weights = Odds.getWeights(luck)
	local total = 0
	for _, weight in weights do
		total += weight
	end
	local chances = {}
	for index, weight in weights do
		chances[index] = weight / total * 100
	end
	return chances
end

function Odds.rollRarity(luck: number, rng: Random): number
	local weights = Odds.getWeights(luck)
	local total = 0
	for _, weight in weights do
		total += weight
	end
	local roll = rng:NextNumber() * total
	for index, weight in weights do
		roll -= weight
		if roll <= 0 then
			return index
		end
	end
	return #weights
end

function Odds.rollGhost(luck: number, rng: Random)
	local rarity = Odds.rollRarity(luck, rng)
	local pool = ghostsByRarity[rarity]
	return pool[rng:NextInteger(1, #pool)]
end

-- Returns a mutation name or nil. Rarest mutations are checked first.
function Odds.rollMutation(rng: Random): string?
	for index = #Config.Mutations, 1, -1 do
		local mutation = Config.Mutations[index]
		if rng:NextNumber() < mutation.Chance then
			return mutation.Name
		end
	end
	return nil
end

return Odds
