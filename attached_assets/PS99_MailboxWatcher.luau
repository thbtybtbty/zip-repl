--[[
    ╔══════════════════════════════════════════════════════════════════╗
    ║         PS99 Mailbox Deposit Watcher  —  Executor Script        ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║  Run this in your executor on the RECEIVER account (the         ║
    ║  Roblox account players send gems to).                          ║
    ║                                                                  ║
    ║  HOW IT WORKS                                                    ║
    ║  1. A player runs /deposit in Discord.                          ║
    ║  2. The bot shows them their personal code (their Discord ID).   ║
    ║  3. They send gems via PS99 mailbox and write that code in the  ║
    ║     mail message field.                                          ║
    ║  4. This script detects the new mail, reads the Discord ID from  ║
    ║     the message, reads the gem count from the mail data, and    ║
    ║     automatically credits them on the bot.                      ║
    ║                                                                  ║
    ║  SETUP                                                           ║
    ║  • Set ENDPOINT and SECRET below then paste into your executor  ║
    ╚══════════════════════════════════════════════════════════════════╝
]]

-- ── CONFIG ────────────────────────────────────────────────────────────────────
local ENDPOINT       = "http://YOUR_WISPBYTE_IP:3000/deposit"  -- ← your server
local SECRET         = "change_me_to_a_long_random_string"      -- ← DEPOSIT_SECRET from .env
local POLL_INTERVAL  = 2   -- seconds between mailbox checks
local MIN_GEMS       = 1   -- ignore mails with fewer gems than this (set to 1000000 for 1M minimum)
-- ─────────────────────────────────────────────────────────────────────────────

local HttpService       = game:GetService("HttpService")
local Players           = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService        = game:GetService("RunService")

local LocalPlayer = Players.LocalPlayer

-- ── Helpers ───────────────────────────────────────────────────────────────────

-- Extract a Discord ID (17-19 consecutive digits) from any string
local function extractDiscordId(text)
    if type(text) ~= "string" then return nil end
    -- Match 17-19 digit sequence (Discord snowflake IDs)
    return text:match("%f[%d](%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d?%d?%d?)%f[%D]")
        or text:match("^(%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d?%d?%d?)$")
end

-- POST a deposit to the bot server
local function postDeposit(discordId, amount, senderName)
    local bodyTable = { discordId = discordId, amount = amount }
    local body = HttpService:JSONEncode(bodyTable)

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
        warn(("[MailboxWatcher] HTTP error for %s (discord %s): %s"):format(senderName, discordId, tostring(response)))
        return false
    end

    local decodeOk, data = pcall(HttpService.JSONDecode, HttpService, response.Body)
    data = decodeOk and data or {}

    if response.StatusCode == 200 and data.ok then
        print(("[MailboxWatcher] ✅ Credited %d gems to discord:%s (Roblox: %s) | new balance: %s")
            :format(amount, discordId, senderName, tostring(data.newBalance)))
        return true
    else
        warn(("[MailboxWatcher] ❌ Server rejected deposit for discord:%s — %s (%d)")
            :format(discordId, tostring(data.error or response.Body), response.StatusCode))
        return false
    end
end

-- ── Mail source detection ─────────────────────────────────────────────────────
-- PS99 stores mail data in a table accessible through the game's data/UI.
-- We try several common locations used by exploit scripts in this game.

local function findMailboxRemote()
    -- Search ReplicatedStorage for any Remote with "mail" in the name
    for _, obj in ipairs(ReplicatedStorage:GetDescendants()) do
        if obj:IsA("RemoteFunction") or obj:IsA("RemoteEvent") then
            local name = obj.Name:lower()
            if name:find("mail") or name:find("inbox") or name:find("letter") then
                return obj
            end
        end
    end
    return nil
end

-- Try to read the raw mail list from the game's internal data tables.
-- PS99 typically exposes this via a module or a BindableFunction.
local function getRawMailList()
    -- Approach 1: BindableFunction named GetMail / MailData in ReplicatedStorage
    for _, obj in ipairs(ReplicatedStorage:GetDescendants()) do
        if obj:IsA("BindableFunction") then
            local name = obj.Name:lower()
            if name:find("mail") or name:find("inbox") then
                local s, result = pcall(function() return obj:Invoke() end)
                if s and type(result) == "table" then
                    return result
                end
            end
        end
    end

    -- Approach 2: PlayerData on LocalPlayer (common PS99 pattern)
    local data = LocalPlayer:FindFirstChild("Data") or LocalPlayer:FindFirstChild("PlayerData")
    if data then
        local mailFolder = data:FindFirstChild("Mail") or data:FindFirstChild("Inbox")
        if mailFolder then
            local mails = {}
            for _, item in ipairs(mailFolder:GetChildren()) do
                -- Each mail item may be a folder or a StringValue with JSON
                if item:IsA("StringValue") then
                    local ok, decoded = pcall(HttpService.JSONDecode, HttpService, item.Value)
                    if ok then table.insert(mails, decoded) end
                elseif item:IsA("Folder") then
                    local entry = {}
                    for _, v in ipairs(item:GetChildren()) do
                        entry[v.Name] = v.Value
                    end
                    table.insert(mails, entry)
                end
            end
            if #mails > 0 then return mails end
        end
    end

    return nil
end

-- ── Mail event hook ───────────────────────────────────────────────────────────
-- Hook the RemoteEvent that fires when a new mail arrives so we catch it
-- in real time instead of only on the next poll tick.

local hooked = false

local function tryHookMailEvent()
    if hooked then return end

    local remote = findMailboxRemote()
    if not remote then return end

    if remote:IsA("RemoteEvent") then
        -- FireServer is how the client triggers server actions;
        -- we want OnClientEvent which is what the server uses to push mail to us.
        local conn = remote.OnClientEvent:Connect(function(...)
            -- Some executors expose this; standard scripts can connect too.
            local args = {...}
            -- The payload is usually a table — inspect it for mail fields
            for _, arg in ipairs(args) do
                if type(arg) == "table" then
                    -- Look for message / note / text field containing a Discord ID
                    local msg  = arg.message or arg.note or arg.text or arg.body or arg.msg or ""
                    local gems = arg.gems or arg.amount or arg.count or arg.value or 0
                    local from = arg.from or arg.sender or arg.username or "Unknown"

                    local discordId = extractDiscordId(tostring(msg))
                    local gemCount  = math.floor(tonumber(gems) or 0)

                    if discordId and gemCount >= MIN_GEMS then
                        print(("[MailboxWatcher] 📬 Mail event — from: %s | gems: %d | discord: %s")
                            :format(tostring(from), gemCount, discordId))
                        task.spawn(postDeposit, discordId, gemCount, tostring(from))
                    end
                end
            end
        end)
        hooked = true
        print("[MailboxWatcher] ✅ Hooked mail RemoteEvent: " .. remote.Name)
        return conn
    end
end

-- ── Polling loop ──────────────────────────────────────────────────────────────
-- Even with the hook above, we poll as a safety net to catch mails that
-- arrived before the script started or were missed by the event.

local seenMailIds = {}   -- tracks mail IDs we have already processed

local function processMail(mail)
    -- Build a dedup key from whatever unique fields are available
    local id = tostring(mail.id or mail.mailId or mail.uid
                     or mail.timestamp or mail.time
                     or HttpService:JSONEncode(mail))

    if seenMailIds[id] then return end  -- already handled
    seenMailIds[id] = true

    -- Extract the Discord ID from the message the player wrote
    local msg  = mail.message or mail.note or mail.text or mail.body or mail.msg or ""
    local gems = mail.gems or mail.amount or mail.count or mail.value or 0
    local from = mail.from or mail.sender or mail.username or mail.robloxName or "Unknown"

    -- Also check subject/title as a fallback
    if msg == "" then
        msg = mail.subject or mail.title or ""
    end

    local discordId = extractDiscordId(tostring(msg))
    local gemCount  = math.floor(tonumber(gems) or 0)

    if not discordId then
        -- No Discord ID found — log and skip
        print(("[MailboxWatcher] ⚠️  Mail from %s has no Discord ID in message — skipped (msg: %q)")
            :format(tostring(from), tostring(msg):sub(1, 80)))
        return
    end

    if gemCount < MIN_GEMS then
        print(("[MailboxWatcher] ⚠️  Mail from %s (discord:%s) has %d gems < minimum %d — skipped")
            :format(tostring(from), discordId, gemCount, MIN_GEMS))
        return
    end

    print(("[MailboxWatcher] 📬 New mail — from: %s | gems: %d | discord: %s")
        :format(tostring(from), gemCount, discordId))

    task.spawn(postDeposit, discordId, gemCount, tostring(from))
end

-- ── Main loop ─────────────────────────────────────────────────────────────────
print("[MailboxWatcher] 🚀 Starting — polling every " .. POLL_INTERVAL .. "s")
print("[MailboxWatcher] Endpoint: " .. ENDPOINT)

-- Attempt to hook the mail event (real-time, instant processing)
task.spawn(tryHookMailEvent)

-- Also hook when RemoteEvents appear later (game loads async)
ReplicatedStorage.DescendantAdded:Connect(function(obj)
    if not hooked and (obj:IsA("RemoteEvent") or obj:IsA("RemoteFunction")) then
        local name = obj.Name:lower()
        if name:find("mail") or name:find("inbox") or name:find("letter") then
            task.spawn(tryHookMailEvent)
        end
    end
end)

-- Polling safety-net loop
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
