-- Runs a function on an interval forever. An error in one tick is logged
-- and the loop keeps going, so one bad frame can never stop the game.

local Loop = {}

function Loop.every(interval: number, name: string, callback: (dt: number) -> ())
	task.spawn(function()
		local lastWarning = 0
		while true do
			local dt = task.wait(interval)
			local ok, err = pcall(callback, dt)
			if not ok and os.clock() - lastWarning > 10 then
				lastWarning = os.clock()
				warn("[Loop:" .. name .. "] " .. tostring(err))
			end
		end
	end)
end

return Loop
