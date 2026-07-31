--[[
	MailboxDeposit.luau
	───────────────────
	Place this Script inside the Mailbox tool / ServerScript that handles
	gem deposits on your Roblox game server.

	SETUP
	-----
	1. Set ENDPOINT to your Wispbyte server's public URL + "/deposit"
	   e.g. "http://123.456.78.90:3000/deposit"
	   (or your domain if you have one: "https://yourbot.example.com/deposit")

	2. Set DEPOSIT_SECRET to the same value as DEPOSIT_SECRET in your
	   Wispbyte .env file.

	3. Call  MailboxDeposit.send(discordId, amountGems)  from your mailbox
	   handler whenever a player successfully deposits gems.
]]

local HttpService = game:GetService("HttpService")

-- ── Config ────────────────────────────────────────────────────────────────────
local ENDPOINT      = "http://YOUR_WISPBYTE_IP:3000/deposit"  -- ← change this
local DEPOSIT_SECRET = "change_me_to_a_long_random_string"     -- ← must match .env

-- ── Module ────────────────────────────────────────────────────────────────────
local MailboxDeposit = {}

--[[
	Send a deposit notification to the bot.

	@param discordId  string   The player's Discord user ID (e.g. "123456789012345678")
	@param amount     number   Whole number of gems to credit (e.g. 1000000 for 1M)
	@return ok        boolean  true if the server accepted the deposit
	@return result    any      Decoded JSON response body, or error message string
]]
function MailboxDeposit.send(discordId: string, amount: number): (boolean, any)
	assert(type(discordId) == "string" and #discordId > 0, "discordId must be a non-empty string")
	assert(type(amount) == "number" and amount > 0 and math.floor(amount) == amount,
		"amount must be a positive integer")

	local body = HttpService:JSONEncode({
		discordId = discordId,
		amount    = amount,
	})

	local success, response = pcall(function()
		return HttpService:RequestAsync({
			Url    = ENDPOINT,
			Method = "POST",
			Headers = {
				["Content-Type"]  = "application/json",
				["Authorization"] = "Bearer " .. DEPOSIT_SECRET,
			},
			Body = body,
		})
	end)

	if not success then
		-- Network error / HTTP disabled
		warn("[MailboxDeposit] Request failed:", response)
		return false, tostring(response)
	end

	-- Decode response
	local ok, decoded = pcall(HttpService.JSONDecode, HttpService, response.Body)
	local data = ok and decoded or { ok = false, error = response.Body }

	if response.StatusCode ~= 200 then
		warn(string.format(
			"[MailboxDeposit] Server returned %d for discordId=%s amount=%d — %s",
			response.StatusCode, discordId, amount,
			(type(data) == "table" and data.error) or response.Body
		))
		return false, data
	end

	return true, data
end

return MailboxDeposit

--[[
── USAGE EXAMPLE ──────────────────────────────────────────────────────────────

local MailboxDeposit = require(path.to.MailboxDeposit)

-- Called from your mailbox handler after verifying the deposit:
local ok, result = MailboxDeposit.send("123456789012345678", 5000000)  -- 5M gems

if ok then
	print("Deposit credited! New balance:", result.newBalance)
else
	warn("Deposit failed:", result)
end

──────────────────────────────────────────────────────────────────────────────]]
