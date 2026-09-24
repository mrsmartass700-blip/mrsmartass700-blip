--!nocheck
-- Loads the game's ModuleScripts into Lune's Roblox instance model.
-- Every module gets its own `script` global pointing at a real ModuleScript
-- instance, so `require(script.Parent.X)` and
-- `require(ReplicatedStorage.Shared.X)` resolve exactly like in Roblox.

local fs = require("@lune/fs")
local luau = require("@lune/luau")
local roblox = require("@lune/roblox")
local task = require("@lune/task")

local Random = require("./Random")

local Loader = {}

function Loader.new(game)
	local paths = {}
	local cache = {}
	local loader = {}

	local environment = {
		game = game,
		workspace = game:GetService("Workspace"),
		Instance = roblox.Instance,
		Random = Random,
		task = task,
	}
	for _, name in
		{
			"Vector3",
			"Vector2",
			"CFrame",
			"Color3",
			"UDim",
			"UDim2",
			"Enum",
			"ColorSequence",
			"ColorSequenceKeypoint",
			"NumberSequence",
			"NumberSequenceKeypoint",
			"NumberRange",
		}
	do
		environment[name] = roblox[name]
	end

	function loader.setGlobal(name: string, value: any)
		environment[name] = value
	end

	local function load(module)
		if cache[module] ~= nil then
			return cache[module]
		end
		local path = assert(paths[module], "no source for " .. module:GetFullName())
		local env = { script = module, require = load }
		for key, value in environment do
			env[key] = value
		end
		local chunk = luau.load(fs.readFile(path), { debugName = path, environment = env })
		local result = chunk()
		cache[module] = result
		return result
	end
	loader.require = load

	function loader.mount(parent, name: string, directory: string)
		local folder = roblox.Instance.new("Folder")
		folder.Name = name
		folder.Parent = parent
		for _, file in fs.readDir(directory) do
			local scriptName, kind = string.match(file, "^([%w_]+)%.(%a+)%.luau$")
			local moduleName = string.match(file, "^([%w_]+)%.luau$")
			local instance = nil
			if moduleName then
				instance = roblox.Instance.new("ModuleScript")
				instance.Name = moduleName
			elseif scriptName and (kind == "server" or kind == "client") then
				instance = roblox.Instance.new(if kind == "server" then "Script" else "LocalScript")
				instance.Name = scriptName
			end
			if instance then
				instance.Parent = folder
				paths[instance] = directory .. "/" .. file
			end
		end
		return folder
	end

	return loader
end

return Loader
