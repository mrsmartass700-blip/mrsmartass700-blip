-- Creates every RemoteEvent the client talks through.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local folder = Instance.new("Folder")
folder.Name = "Remotes"

local function event(name: string): RemoteEvent
	local remote = Instance.new("RemoteEvent")
	remote.Name = name
	remote.Parent = folder
	return remote
end

local Remotes = {
	-- server -> client: (text, kind?) toast notification
	Notify = event("Notify"),
	-- server -> client: (kind, position) one-shot visual/sound effect
	Effect = event("Effect"),
	-- client -> server: request a rebirth
	Rebirth = event("Rebirth"),
	-- client -> server: teleport back to your hotel
	TeleportHome = event("TeleportHome"),
}

folder.Parent = ReplicatedStorage

function Remotes.notify(player: Player, text: string, kind: string?)
	Remotes.Notify:FireClient(player, text, kind or "info")
end

function Remotes.notifyAll(text: string, kind: string?)
	Remotes.Notify:FireAllClients(text, kind or "info")
end

return Remotes
