--[[
    ╔══════════════════════════════════════════════════════════════════╗
    ║         PS99 Mailbox Deposit Watcher  —  Executor Script        ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║  Run this in your executor on the RECEIVER account (the         ║
    ║  Roblox account players send gems to).                          ║
    ║                                                                  ║
    ║  HOW IT WORKS                                                    ║
    ║  1. Player runs /link <robloxUsername> in Discord.              ║
    ║  2. Player runs /deposit in Discord to see the amount to send.  ║
    ║  3. Player sends gems via PS99 mailbox — no code needed in msg. ║
    ║  4. This script detects the mail, reads the SENDER's Roblox     ║
    ║     username, looks it up in the bot DB, and credits them.      ║
    ║                                                                  ║
    ║  SETUP                                                           ║
    ║  • Set ENDPOINT and SECRET below, then paste into your executor ║
    ╚══════════════════════════════════════════════════════════════════╝
]]

-- ── CONFIG ────────────────────────────────────────────────────────────────────
local ENDPOINT      = "http://YOUR_WISPBYTE_IP:3000/deposit"  -- ← your server
local SECRET        = "change_me_to_a_long_random_string"      -- ← DEPOSIT_SECRET from .env
local POLL_INTERVAL = 2    -- seconds between mailbox checks
local MIN_GEMS      = 1    -- ignore mails with fewer gems than this (e.g. 1000000 for 1M min)
-- ─────────────────────────────────────────────────────────────────────────────

local HttpService       = game:GetService("HttpService")
local Players           = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local LocalPlayer = Players.LocalPlayer

-- ── Send deposit to bot server ─────────────────────────────────────────────────
-- Now sends robloxUser (the sender's Roblox name) instead of a Discord ID.
-- The bot looks up the linked Discord account automatically.
local function postDeposit(robloxUser, amount)
    local body = HttpService:JSONEncode({ robloxUser = robloxUser, amount = amount })

    local ok, response = pcall(function()
        return HttpService:RequestAsync({
            Url    = ENDPOINT,
            Method = "POST",
            Headers = {
                ["Content-Type"]  = "application/json",
                ["Authorization"] = "Bearer " .. SECRET,
            },
            Body = body,
        })
    end)

    if not ok then
        warn(("[MailboxWatcher] HTTP error for roblox:%s — %s"):format(robloxUser, tostring(response)))
        return false
    end

    local decodeOk, data = pcall(HttpService.JSONDecode, HttpService, response.Body)
    data = decodeOk and data or {}

    if response.StatusCode == 200 and data.ok then
        print(("[MailboxWatcher] ✅ Credited %d gems to roblox:%s (discord:%s) | new balance: %s")
            :format(amount, robloxUser, tostring(data.discordId), tostring(data.newBalance)))
        return true
    elseif response.StatusCode == 404 then
        warn(("[MailboxWatcher] ⚠️  roblox:%s has not run /link in Discord yet — gems NOT credited")
            :format(robloxUser))
        return false
    else
        warn(("[MailboxWatcher] ❌ Server error for roblox:%s — %s (%d)")
            :format(robloxUser, tostring(data.error or response.Body), response.StatusCode))
        return false
    end
end

-- ── Find the mailbox remote ────────────────────────────────────────────────────
local function findMailboxRemote()
    for _, obj in ipairs(ReplicatedStorage:GetDescendants()) do
        if obj:IsA("RemoteEvent") or obj:IsA("RemoteFunction") then
            local name = obj.Name:lower()
            if name:find("mail") or name:find("inbox") or name:find("letter") then
                return obj
            end
        end
    end
    return nil
end

-- ── Read raw mail list from game data ─────────────────────────────────────────
local function getRawMailList()
    -- Approach 1: BindableFunction named GetMail / MailData
    for _, obj in ipairs(ReplicatedStorage:GetDescendants()) do
        if obj:IsA("BindableFunction") then
            local name = obj.Name:lower()
            if name:find("mail") or name:find("inbox") then
                local s, result = pcall(function() return obj:Invoke() end)
                if s and type(result) == "table" then return result end
            end
        end
    end

    -- Approach 2: PlayerData folder on LocalPlayer
    local data = LocalPlayer:FindFirstChild("Data") or LocalPlayer:FindFirstChild("PlayerData")
    if data then
        local mailFolder = data:FindFirstChild("Mail") or data:FindFirstChild("Inbox")
        if mailFolder then
            local mails = {}
            for _, item in ipairs(mailFolder:GetChildren()) do
                if item:IsA("StringValue") then
                    local ok, decoded = pcall(HttpService.JSONDecode, HttpService, item.Value)
                    if ok then table.insert(mails, decoded) end
                elseif item:IsA("Folder") then
                    local entry = {}
                    for _, v in ipairs(item:GetChildren()) do entry[v.Name] = v.Value end
                    table.insert(mails, entry)
                end
            end
            if #mails > 0 then return mails end
        end
    end

    return nil
end

-- ── Process a single mail entry ────────────────────────────────────────────────
local seenMailIds = {}

local function processMail(mail)
    local id = tostring(
        mail.id or mail.mailId or mail.uid or mail.timestamp or mail.time
        or HttpService:JSONEncode(mail)
    )
    if seenMailIds[id] then return end
    seenMailIds[id] = true

    -- The sender's Roblox username — this is what we send to the server now
    local robloxUser = mail.from or mail.sender or mail.username or mail.robloxName or mail.senderName
    local gems       = mail.gems or mail.amount or mail.count or mail.value or 0
    local gemCount   = math.floor(tonumber(gems) or 0)

    if not robloxUser or tostring(robloxUser):gsub("%s", "") == "" then
        warn("[MailboxWatcher] ⚠️  Mail has no sender name — skipped")
        return
    end

    robloxUser = tostring(robloxUser)

    if gemCount < MIN_GEMS then
        print(("[MailboxWatcher] ⏭️  Skipped mail from %s — %d gems < minimum %d")
            :format(robloxUser, gemCount, MIN_GEMS))
        return
    end

    print(("[MailboxWatcher] 📬 New mail — from: %s | gems: %d"):format(robloxUser, gemCount))
    task.spawn(postDeposit, robloxUser, gemCount)
end

-- ── Real-time hook on mail RemoteEvent ────────────────────────────────────────
local hooked = false

local function tryHookMailEvent()
    if hooked then return end
    local remote = findMailboxRemote()
    if not remote or not remote:IsA("RemoteEvent") then return end

    remote.OnClientEvent:Connect(function(...)
        for _, arg in ipairs({...}) do
            if type(arg) == "table" then
                local robloxUser = arg.from or arg.sender or arg.username or arg.robloxName or arg.senderName
                local gems       = arg.gems or arg.amount or arg.count or arg.value or 0
                local gemCount   = math.floor(tonumber(gems) or 0)

                if robloxUser and gemCount >= MIN_GEMS then
                    print(("[MailboxWatcher] 📬 Mail event — from: %s | gems: %d"):format(tostring(robloxUser), gemCount))
                    task.spawn(postDeposit, tostring(robloxUser), gemCount)
                end
            end
        end
    end)

    hooked = true
    print("[MailboxWatcher] ✅ Hooked mail RemoteEvent: " .. remote.Name)
end

-- Hook immediately + re-try as descendants load
task.spawn(tryHookMailEvent)
ReplicatedStorage.DescendantAdded:Connect(function(obj)
    if not hooked and (obj:IsA("RemoteEvent") or obj:IsA("RemoteFunction")) then
        local name = obj.Name:lower()
        if name:find("mail") or name:find("inbox") or name:find("letter") then
            task.spawn(tryHookMailEvent)
        end
    end
end)

-- ── Polling safety-net ────────────────────────────────────────────────────────
print("[MailboxWatcher] 🚀 Started — polling every " .. POLL_INTERVAL .. "s")
print("[MailboxWatcher] Endpoint: " .. ENDPOINT)

while true do
    task.wait(POLL_INTERVAL)
    local ok, mailList = pcall(getRawMailList)
    if ok and mailList then
        for _, mail in ipairs(mailList) do
            if type(mail) == "table" then
                processMail(mail)
            end
        end
    end
end
