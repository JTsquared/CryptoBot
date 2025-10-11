# Multi-Bot Prize Pool Support - AppID Migration

## Overview

Adding support for multiple bots to have separate prize pools in the same guild.

**Before:** Prize pools scoped by `guildId` only
**After:** Prize pools scoped by `{guildId, appId}` compound key

---

## Schema Changes

### PrizePoolWallet Model ✅ DONE
```javascript
// Before
{ guildId: String (unique), address, privateKey }

// After
{ guildId: String, appId: String, address, privateKey }
// Compound unique index: { guildId, appId }
```

---

## Service Method Changes Required

All methods in `prizePoolService.js` need to accept `appId` as second parameter:

### Core Methods ✅ DONE
- [x] `getOrCreateWallet(guildId, appId)`
- [x] `getPrizePoolWallet(guildId, appId)`

### Methods That Need Updating
- [ ] `getBalance(guildId, ticker)` → `getBalance(guildId, appId, ticker)`
- [ ] `getAllBalances(guildId, options)` → `getAllBalances(guildId, appId, options)`
- [ ] `donateToPool(guildId, ...)` → `donateToPool(guildId, appId, ...)`
- [ ] `payout(guildId, ...)` → `payout(guildId, appId, ...)`
- [ ] `claimEscrow(guildId, userId)` → `claimEscrow(guildId, appId, userId)`
- [ ] `donateNFT(guildId, ...)` → `donateNFT(guildId, appId, ...)`
- [ ] `payoutNFT(guildId, ...)` → `payoutNFT(guildId, appId, ...)`
- [ ] `withdrawNFT(guildId, ...)` → `withdrawNFT(guildId, appId, ...)`
- [ ] `verifyNFTOwnership(guildId, ...)` → `verifyNFTOwnership(guildId, appId, ...)`
- [ ] `getNFTBalances(address)` - No change needed (uses address directly)

### Pattern for Updates:
```javascript
// Before
async getBalance(guildId, ticker) {
  const wallet = await this.getPrizePoolWallet(guildId);
  if (!wallet) return { success: false, error: "NO_WALLET" };
  // ...
}

// After
async getBalance(guildId, appId, ticker) {
  const wallet = await this.getPrizePoolWallet(guildId, appId);
  if (!wallet) return { success: false, error: "NO_WALLET" };
  // ...
}
```

---

## API Route Changes Required

### URL Structure
Use query parameter for `appId` (better for optional/backwards compat):

```
GET  /api/prizepool/balances/:guildId?appId=123456789
POST /api/prizepool/donate/:guildId?appId=123456789
POST /api/prizepool/payout/:guildId?appId=123456789
```

### Middleware Update - validateGuildAccess.js
```javascript
export function requireGuildAccess(req, res, next) {
  if (!req.isExternalRequest) {
    return next();
  }

  const requestedGuildId = req.params.guildId;
  const requestedAppId = req.query.appId || req.body?.appId; // ← ADD THIS

  // Existing guild validation...

  // Store appId for route handlers
  req.appId = requestedAppId; // ← ADD THIS
  next();
}
```

### Route Handler Pattern:
```javascript
// Before
router.post("/donate/:guildId", requireGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const { senderDiscordId, amount, ticker } = req.body;

  const out = await prizePoolService.donateToPool(guildId, senderDiscordId, amount, ticker);
  // ...
});

// After
router.post("/donate/:guildId", requireGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const appId = req.query.appId || req.body?.appId; // ← ADD THIS
  const { senderDiscordId, amount, ticker } = req.body;

  if (!appId) {
    return res.status(400).json({ success: false, error: "MISSING_APP_ID" });
  }

  const out = await prizePoolService.donateToPool(guildId, appId, senderDiscordId, amount, ticker);
  // ...
});
```

---

## Discord Command Changes

Commands need to pass their bot's application ID:

```javascript
// In createPrizePool.js
const appId = interaction.client.user.id; // Bot's application ID

const response = await fetch(
  `${process.env.CRYPTOBOT_URL}/api/prizepool/create/${guildId}?appId=${appId}`,
  { method: "POST" }
);
```

---

## Migration Script for Existing Wallets

Existing prize pool wallets don't have `appId`. Need to:
1. Set default `appId` (DegenRumble's ID: get from env)
2. Drop old unique index on `guildId`
3. Create new compound index on `{guildId, appId}`

```javascript
// migration/add-appid-to-wallets.js
import mongoose from 'mongoose';
import PrizePoolWallet from '../database/models/prizePoolWallet.js';

const DEGENRUMBLE_APP_ID = process.env.DEGENRUMBLE_APP_ID || 'YOUR_BOT_ID';

async function migrate() {
  await mongoose.connect(process.env.MONGO_URI);

  console.log('🔄 Migrating prize pool wallets to include appId...');

  // Drop old unique index
  try {
    await PrizePoolWallet.collection.dropIndex('guildId_1');
    console.log('✅ Dropped old guildId index');
  } catch (err) {
    console.log('⚠️  Old index not found (already migrated?)');
  }

  // Update all existing wallets with default appId
  const result = await PrizePoolWallet.updateMany(
    { appId: { $exists: false } }, // Wallets without appId
    { $set: { appId: DEGENRUMBLE_APP_ID } }
  );

  console.log(`✅ Updated ${result.modifiedCount} wallets with appId: ${DEGENRUMBLE_APP_ID}`);

  // Create new compound index (should happen automatically from schema)
  await PrizePoolWallet.createIndexes();
  console.log('✅ Created compound index on {guildId, appId}');

  console.log('🎉 Migration complete!');
  process.exit(0);
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
```

---

## Testing Plan

### Test 1: Create Prize Pool via API (HTTP)
```bash
# Create wallet for DegenRumble bot
curl -X POST "http://localhost:3000/api/prizepool/create/YOUR_GUILD_ID?appId=DEGENRUMBLE_APP_ID"

# Expected: { success: true, wallet: { address: "0x..." } }
```

### Test 2: Multiple Bots in Same Guild
```bash
# Create wallet for Bot A
curl -X POST "http://localhost:3000/api/prizepool/create/GUILD_123?appId=BOT_A_ID"

# Create wallet for Bot B (same guild!)
curl -X POST "http://localhost:3000/api/prizepool/create/GUILD_123?appId=BOT_B_ID"

# Both should succeed - separate wallets for same guild
```

### Test 3: Check Balances for Specific Bot
```bash
curl "http://localhost:3000/api/prizepool/balances/GUILD_123?appId=BOT_A_ID"
curl "http://localhost:3000/api/prizepool/balances/GUILD_123?appId=BOT_B_ID"

# Should return different wallets/balances
```

---

## Implementation Order

1. ✅ Update PrizePoolWallet schema
2. ✅ Update core service methods (getOrCreateWallet, getPrizePoolWallet)
3. ⏳ Update remaining service methods (getBalance, getAllBalances, etc.)
4. ⏳ Update validateGuildAccess middleware
5. ⏳ Update API routes to extract and pass appId
6. ⏳ Create migration script
7. ⏳ Update Discord commands to pass appId
8. ⏳ Run migration on production
9. ⏳ Test with multiple bots

---

## Breaking Changes

**API Routes:** All routes now require `appId` query parameter

**Before:**
```
GET /api/prizepool/balances/:guildId
```

**After:**
```
GET /api/prizepool/balances/:guildId?appId=123456789
```

**Migration Path:** Run migration script to assign default appId to existing wallets, then update all API calls.
