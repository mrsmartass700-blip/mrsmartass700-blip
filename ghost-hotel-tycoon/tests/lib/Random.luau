--!nocheck
-- Deterministic stand-in for Roblox's Random (Park–Miller LCG).

local Random = {}
Random.__index = Random

function Random.new(seed: number?)
	local state = math.floor(seed or os.clock() * 1e6) % 2147483646 + 1
	return setmetatable({ state = state }, Random)
end

function Random:NextNumber(min: number?, max: number?): number
	self.state = (self.state * 48271) % 2147483647
	local unit = self.state / 2147483647
	if min and max then
		return min + (max - min) * unit
	end
	return unit
end

function Random:NextInteger(min: number, max: number): number
	return math.min(max, min + math.floor(self:NextNumber() * (max - min + 1)))
end

return Random
