# Deployment Checklist - API Key Security & Bug Fixes

## Changes Made:
1. ✅ NFT persistence fixes (gameState saves nftPrize)
2. ✅ API key authentication system
3. ✅ Guild-scoped API key validation (fixed bug)
4. ✅ Warning suppressions (collection field, duplicate indexes)

---

## Critical Fixes Before Testing:

### 1. Fix HardcoreRumble/DegenRumble CRYPTOBOT_URL

**Problem:** Your bot is using external IP, getting blocked by API security

**Fix on VM:**
```bash
# Edit HardcoreRumble .env file
nano /path/to/HardcoreRumble/.env

# Change this line:
CRYPTOBOT_URL=http://34.162.131.64:3000  # ❌ WRONG

# To this:
CRYPTOBOT_URL=http://localhost:3000      # ✅ CORRECT
```

**Then restart:**
```bash
pm2 restart hardcorerumble
pm2 logs hardcorerumble --lines 20
```

---

### 2. Deploy Code Changes to VM

**Copy these files to VM:**
```bash
# From your Mac, run:
scp -r /Users/jonathanturner/PersonalProjects/CryptoBot/commands/*.js \
  turner_e_jonathan@34.162.131.64:/path/to/CryptoBot/commands/

scp /Users/jonathanturner/PersonalProjects/CryptoBot/database/models/apiKey.js \
  turner_e_jonathan@34.162.131.64:/path/to/CryptoBot/database/models/

scp /Users/jonathanturner/PersonalProjects/CryptoBot/database/models/nftInventory.js \
  turner_e_jonathan@34.162.131.64:/path/to/CryptoBot/database/models/

scp /Users/jonathanturner/PersonalProjects/CryptoBot/index.js \
  turner_e_jonathan@34.162.131.64:/path/to/CryptoBot/

# Or use git if you prefer:
cd /path/to/CryptoBot
git pull
```

---

### 3. Restart CryptoBot on VM

```bash
pm2 restart cryptobot
pm2 logs cryptobot --lines 50
```

**Expected output:**
- ✅ "Connected to MongoDB"
- ✅ "API server running on http://0.0.0.0:3000"
- ✅ No more warnings about "collection" or duplicate indexes

---

## Testing Steps:

### Test 1: Internal Bot Access (No API Key)
```bash
# SSH into VM
ssh turner_e_jonathan@34.162.131.64

# Test from localhost
curl http://localhost:3000/api/prizepool/balances/YOUR_GUILD_ID

# Expected: Success (or NO_WALLET if no wallet created)
# Should NOT see: "Unauthorized - API key required"
```

### Test 2: Generate Production API Key
In Discord (production server):
```
/generate-api-key name:Test Key
```
Save the key it gives you!

### Test 3: External Access WITH Valid Key
From your Mac:
```bash
curl -H "X-API-Key: YOUR_PROD_KEY" \
  http://34.162.131.64:3000/api/prizepool/balances/YOUR_GUILD_ID

# Expected: Success or NO_WALLET
```

### Test 4: External Access WITHOUT Key (Should Block)
```bash
curl http://34.162.131.64:3000/api/prizepool/balances/YOUR_GUILD_ID

# Expected: {"success":false,"error":"Unauthorized - API key required for external access"}
```

### Test 5: Wrong Guild Access (Should Block)
```bash
# Use key for Guild A, try to access Guild B
curl -H "X-API-Key: GUILD_A_KEY" \
  http://34.162.131.64:3000/api/prizepool/balances/DIFFERENT_GUILD_ID

# Expected: {"success":false,"error":"Forbidden - API key does not have access to this guild"}
```

### Test 6: DegenRumble Commands Work
In Discord:
```
/createprizepool
/cryptorumble
```
Both should work without API key errors!

---

## If Something Goes Wrong:

### Check CryptoBot Logs:
```bash
pm2 logs cryptobot --lines 100
```

Look for:
- 🚨 BLOCKED messages (should only see external IPs, not localhost)
- ✅ Authenticated messages (for valid API keys)
- MongoDB connection errors

### Check HardcoreRumble Logs:
```bash
pm2 logs hardcorerumble --lines 50
```

Look for:
- API call failures
- 403 Forbidden errors

### Rollback if Needed:
```bash
# Revert to previous code version
git checkout HEAD~1

# Or restore backups
cp /backup/index.js /path/to/CryptoBot/index.js

# Restart
pm2 restart cryptobot
```

---

## Success Criteria:

✅ HardcoreRumble bot can call API without API key (uses localhost)
✅ External requests require valid API key
✅ API keys are guild-scoped (can't access other guilds)
✅ `/generate-api-key` command works in production
✅ No more mongoose warnings in logs
✅ NFT prizes persist across bot restarts

---

## Next Steps After Successful Deployment:

1. Share API key generation instructions with partners
2. Monitor logs for security issues (`pm2 logs cryptobot | grep BLOCKED`)
3. Consider adding key expiration (future enhancement)
4. Document API for partners
