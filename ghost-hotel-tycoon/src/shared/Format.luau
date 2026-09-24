-- Number / time formatting helpers shared by server and client.

local Format = {}

local SUFFIXES = { "", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc" }

local function trimZeros(text: string): string
	if string.find(text, "%.") then
		text = string.gsub(text, "0+$", "")
		text = string.gsub(text, "%.$", "")
	end
	return text
end

-- 1234 -> "1.23K", 15000000 -> "15M"
function Format.abbreviate(value: number): string
	if value ~= value then
		return "0"
	end
	local negative = value < 0
	value = math.abs(value)

	local tier = 1
	while value >= 1000 and tier < #SUFFIXES do
		value /= 1000
		tier += 1
	end

	-- Rounding can push 999.999 up to "1000", so carry into the next tier.
	local decimals = if value >= 100 then 0 elseif value >= 10 then 1 else 2
	local rounded = math.floor(value * 10 ^ decimals + 0.5) / 10 ^ decimals
	if rounded >= 1000 and tier < #SUFFIXES then
		rounded /= 1000
		tier += 1
		decimals = 2
	end

	local text = if tier == 1
		then tostring(math.floor(rounded + 0.5))
		else trimZeros(string.format("%." .. decimals .. "f", rounded))

	return (if negative then "-" else "") .. text .. SUFFIXES[tier]
end

function Format.money(value: number): string
	return "$" .. Format.abbreviate(value)
end

function Format.perSecond(value: number): string
	return "$" .. Format.abbreviate(value) .. "/s"
end

-- 75 -> "1:15", 3725 -> "1:02:05"
function Format.time(seconds: number): string
	seconds = math.max(0, math.floor(seconds))
	local hours = seconds // 3600
	local minutes = (seconds % 3600) // 60
	local secs = seconds % 60
	if hours > 0 then
		return string.format("%d:%02d:%02d", hours, minutes, secs)
	end
	return string.format("%d:%02d", minutes, secs)
end

-- 0.18 -> "0.18%", 58 -> "58%", 0.0021 -> "0.0021%"
function Format.percent(value: number): string
	if value >= 10 then
		return string.format("%.1f%%", value):gsub("%.0%%", "%%")
	end
	if value >= 0.1 then
		return trimZeros(string.format("%.2f", value)) .. "%"
	end
	return trimZeros(string.format("%.4f", value)) .. "%"
end

return Format
