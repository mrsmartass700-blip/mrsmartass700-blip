-- Client entry point: builds the UI and hooks up remotes.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Hud = require(script.Parent.Hud)
local Notifications = require(script.Parent.Notifications)
local RebirthPanel = require(script.Parent.RebirthPanel)
local Shop = require(script.Parent.Shop)
local WorldEffects = require(script.Parent.WorldEffects)

local player = Players.LocalPlayer
local remotes = ReplicatedStorage:WaitForChild("Remotes")

local screen = Instance.new("ScreenGui")
screen.Name = "HotelUI"
screen.ResetOnSpawn = false
screen.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
screen.Parent = player:WaitForChild("PlayerGui")

Notifications.mount(screen)
local shop = Shop.mount(screen)
local rebirth = RebirthPanel.mount(screen)

Hud.mount(screen, {
	OnShop = function()
		shop:toggle()
	end,
	OnRebirth = function()
		rebirth:toggle()
	end,
	OnHome = function()
		remotes.TeleportHome:FireServer()
	end,
})

remotes:WaitForChild("Notify").OnClientEvent:Connect(function(text: string, kind: string?)
	Notifications.show(text, kind)
	if kind == "error" then
		WorldEffects.playSound("error")
	elseif kind == "rare" or kind == "event" then
		WorldEffects.playSound("rare")
	end
end)

WorldEffects.start()
