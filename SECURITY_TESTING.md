# 🔐 Security Testing - Guild-Scoped API Keys

## Critical Security Fix Applied

### The Vulnerability (FIXED):
**Before:** Middleware tried to extract `guildId` before route matching, and if extraction failed, the check was skipped entirely.

**Impact:** An API key for Guild A could access Guild B's data if guildId extraction failed.

### The Fix:
1. **Middleware**: Only validates API key is valid and active
2. **Per-Route Validation**: `requireGuildAccess` middleware on EVERY route with `guildId`
3. **Explicit Validation**: Each route explicitly checks `req.apiGuildId === req.params.guildId`
4. **No Fallthrough**: If validation fails, request is blocked with 403 Forbidden

---

## How Security Works Now

### Request Flow:
```
External Request
  ↓
[1] IP Check: Is it localhost?
  ├─ YES → Skip API key check, allow access
  └─ NO  → Require API key
         ↓
[2] API Key Validation: Does key exist and is active?
  ├─ NO  → 401 Unauthorized, BLOCKED
  └─ YES → Store req.apiGuildId = keyRecord.guildId
         ↓
[3] Route Handler: Does req.params.guildId === req.apiGuildId?
  ├─ NO  → 403 Forbidden, BLOCKED
  └─ YES → Allow access to route
```

### Security Guarantees:
✅ **Localhost (HardcoreRumble bot)** → No API key required, full access
✅ **External requests** → Require valid API key
✅ **Guild-scoped** → API key ONLY works for its own guild
✅ **No bypasses** → Middleware on EVERY route with guildId
✅ **Explicit validation** → No implicit checks that can be skipped

---

## Comprehensive Security Tests

### Test 1: Localhost Access (Internal Bot)
```bash
# SSH into VM
ssh turner_e_jonathan@34.162.131.64

# Test internal bot access (no API key)
curl http://localhost:3000/api/prizepool/balances/1243983776024101005

# Expected: Success (or NO_WALLET if wallet doesn't exist)
# Should NOT see: "Unauthorized - API key required"
```

**Validates:**
- Internal bot (HardcoreRumble) can access API without API key
- Localhost requests bypass API key requirement

---

### Test 2: External Access Without API Key (Should Block)
```bash
# From your Mac (external IP)
curl http://34.162.131.64:3000/api/prizepool/balances/1243983776024101005

# Expected:
{
  "success": false,
  "error": "Unauthorized - API key required for external access"
}
```

**Validates:**
- External requests cannot access API without API key
- Returns 401 Unauthorized

---

### Test 3: External Access With Invalid API Key (Should Block)
```bash
# From your Mac with fake/invalid key
curl -H "X-API-Key: fakekeyinvalidnotindb123456789abcdef" \
  http://34.162.131.64:3000/api/prizepool/balances/1243983776024101005

# Expected:
{
  "success": false,
  "error": "Unauthorized - Invalid or revoked API key"
}
```

**Validates:**
- Invalid API keys are rejected
- Returns 401 Unauthorized

---

### Test 4: External Access With Valid Key for CORRECT Guild (Should Work)
```bash
# Generate key in Discord for guild 1243983776024101005
/generate-api-key name:Security Test

# Use the key to access THAT guild's data
curl -H "X-API-Key: YOUR_GENERATED_KEY" \
  http://34.162.131.64:3000/api/prizepool/balances/1243983776024101005

# Expected: Success (or NO_WALLET if wallet doesn't exist)
# Should NOT see: "Forbidden" or "Unauthorized"
```

**Validates:**
- Valid API key can access its own guild's data
- Returns actual data or NO_WALLET error

---

### Test 5: ⚠️ CRITICAL - External Access With Valid Key for WRONG Guild (Should Block)
```bash
# Use Guild A's API key to try accessing Guild B's data
curl -H "X-API-Key: GUILD_A_KEY" \
  http://34.162.131.64:3000/api/prizepool/balances/DIFFERENT_GUILD_ID

# Expected:
{
  "success": false,
  "error": "Forbidden - API key does not have access to this guild"
}

# Logs should show:
# 🚨 BLOCKED: API key for guild 1243983776024101005 tried to access guild DIFFERENT_GUILD_ID
```

**Validates:**
- ✅ **THE CRITICAL FIX** - API keys are guild-scoped
- Returns 403 Forbidden (not 401 Unauthorized)
- Logs show blocked cross-guild access attempt

---

### Test 6: Test ALL Endpoints (Full Coverage)

Test guild-scoping on every endpoint:

```bash
# Replace with your actual API key and guild IDs
API_KEY="YOUR_API_KEY"
CORRECT_GUILD="YOUR_GUILD_ID"
WRONG_GUILD="999999999999999999"

# Test each endpoint with wrong guild
echo "Testing /create..."
curl -H "X-API-Key: $API_KEY" \
  http://34.162.131.64:3000/api/prizepool/create/$WRONG_GUILD \
  -X POST

echo "Testing /balances..."
curl -H "X-API-Key: $API_KEY" \
  http://34.162.131.64:3000/api/prizepool/balances/$WRONG_GUILD

echo "Testing /donate..."
curl -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"senderDiscordId":"123","amount":"1","ticker":"AVAX"}' \
  http://34.162.131.64:3000/api/prizepool/donate/$WRONG_GUILD

echo "Testing /payout..."
curl -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"recipientDiscordId":"123","amount":"1","ticker":"AVAX"}' \
  http://34.162.131.64:3000/api/prizepool/payout/$WRONG_GUILD

echo "Testing /donate-nft..."
curl -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"senderDiscordId":"123","collection":"OBEEZ","tokenId":"1"}' \
  http://34.162.131.64:3000/api/prizepool/donate-nft/$WRONG_GUILD

echo "Testing /nft-balances..."
curl -H "X-API-Key: $API_KEY" \
  http://34.162.131.64:3000/api/prizepool/nft-balances/$WRONG_GUILD
```

**All should return:**
```json
{"success":false,"error":"Forbidden - API key does not have access to this guild"}
```

**Validates:**
- Guild validation works on EVERY endpoint
- No endpoint can be bypassed

---

### Test 7: Revoked API Key (Should Block)
```bash
# In Discord
/generate-api-key name:Test Key
# Copy the key

# Test it works
curl -H "X-API-Key: COPIED_KEY" \
  http://34.162.131.64:3000/api/prizepool/balances/YOUR_GUILD_ID
# Should work

# Revoke it
/list-api-keys
# Copy hash prefix (first 16 chars)
/revoke-api-key key-hash:abc123...

# Try using it again
curl -H "X-API-Key: COPIED_KEY" \
  http://34.162.131.64:3000/api/prizepool/balances/YOUR_GUILD_ID

# Expected:
{
  "success": false,
  "error": "Unauthorized - Invalid or revoked API key"
}
```

**Validates:**
- Revoked API keys cannot be used
- Key revocation is immediate

---

## Attack Scenarios (All Should Fail)

### Attack 1: URL Path Manipulation
```bash
# Try to bypass validation by manipulating URL
curl -H "X-API-Key: GUILD_A_KEY" \
  "http://34.162.131.64:3000/api/prizepool/balances/GUILD_B/../GUILD_A"

# Expected: 403 Forbidden (route won't match, or validation catches it)
```

### Attack 2: Parameter Injection
```bash
# Try to override guildId via query params
curl -H "X-API-Key: GUILD_A_KEY" \
  "http://34.162.131.64:3000/api/prizepool/balances/GUILD_B?guildId=GUILD_A"

# Expected: 403 Forbidden (middleware uses req.params, not req.query)
```

### Attack 3: Case Sensitivity
```bash
# Try uppercase/lowercase variations
curl -H "x-api-key: GUILD_A_KEY" \
  http://34.162.131.64:3000/api/prizepool/balances/GUILD_B

# Expected: 401 Unauthorized (Express headers are case-insensitive, key not found)
```

### Attack 4: API Key Brute Force
```bash
# Try random API keys
for i in {1..100}; do
  curl -H "X-API-Key: $(openssl rand -hex 32)" \
    http://34.162.131.64:3000/api/prizepool/balances/GUILD_A
done

# Expected: All return 401 Unauthorized
# Rate limiting recommended (future enhancement)
```

---

## Security Checklist

✅ **API Key Authentication**
- [x] External requests require API key
- [x] Invalid keys are rejected (401)
- [x] Revoked keys are rejected (401)
- [x] Keys are hashed (SHA-256) in database

✅ **Guild-Scoped Access**
- [x] API keys tied to specific guild
- [x] Cross-guild access blocked (403)
- [x] Validation on EVERY route with guildId
- [x] No fallthrough if validation fails

✅ **Internal Bot Access**
- [x] Localhost bypasses API key requirement
- [x] HardcoreRumble bot can access all guilds

✅ **Error Handling**
- [x] Clear error messages for debugging
- [x] No sensitive data leaked in errors
- [x] Proper HTTP status codes (401, 403, 404, 500)

✅ **Logging & Monitoring**
- [x] Blocked requests logged with IP
- [x] Successful auth logged
- [x] Cross-guild attempts logged

---

## Monitoring & Maintenance

### Check Logs for Security Issues:
```bash
# SSH into VM
ssh turner_e_jonathan@34.162.131.64

# Watch for blocked requests
pm2 logs cryptobot | grep "🚨 BLOCKED"

# Watch for suspicious patterns
pm2 logs cryptobot | grep -E "(BLOCKED|Unauthorized|Forbidden)" | tail -50
```

### Regular Security Tasks:
1. **Weekly**: Review logs for unusual access patterns
2. **Monthly**: Audit active API keys (`/list-api-keys` in each server)
3. **Quarterly**: Review and revoke unused keys
4. **As needed**: Rotate keys if compromised

---

## Future Security Enhancements

Consider adding:
1. **Rate limiting** - Prevent brute force attacks (e.g., 100 requests/hour per IP)
2. **Key expiration** - Auto-revoke keys after 90 days
3. **IP whitelisting per key** - Key only works from specific IPs
4. **Audit trail** - Track all API calls with timestamps
5. **Webhook notifications** - Alert on suspicious activity
6. **Permission scopes** - Keys with read-only vs read-write access
