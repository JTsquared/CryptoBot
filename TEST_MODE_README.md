# Testing Withdraw Fee Logic - Simulating Failures

## Option 1: Force Failure with Environment Variable (RECOMMENDED)

Add a test mode flag to simulate withdraw failures after fee collection.

### Setup:
Add to `.env.test`:
```bash
TEST_WITHDRAW_FAILURE=true
```

### Implementation:
Add this at the top of `attemptTokenWithdraw()`:

```javascript
async function attemptTokenWithdraw(interaction, withdrawAttemptRecord, address, amount, tokenTicker, signer, provider) {
  // TEST MODE: Force failure after fee collection
  if (process.env.TEST_WITHDRAW_FAILURE === 'true') {
    console.log('🧪 TEST MODE: Simulating withdraw failure');
    throw new Error('TEST_MODE: Simulated transfer failure');
  }

  try {
    let withdrawTx;
    // ... rest of function
```

### Test Scenarios:

**Scenario 1: Partial Withdraw (Less than fee-paid)**
```bash
# Set test mode ON
echo "TEST_WITHDRAW_FAILURE=true" >> .env.test

# Restart bot
node index.js --env=test

# In Discord:
/withdraw address:0xYOUR_WALLET token:AVAX amount:1

# Fee succeeds, transfer fails (stored in DB)

# Set test mode OFF
# Remove TEST_WITHDRAW_FAILURE from .env.test

# Restart bot and try smaller amount
/withdraw address:0xYOUR_WALLET token:AVAX amount:0.5

# Should show confirmation button!
```

---

## Option 2: Use Invalid Token Contract (For ERC-20 testing)

Temporarily modify the token contract address to point to an invalid contract.

### Setup:
In `utils/tokenConfig.js`, change SQRD address:

```javascript
export const TESTNET_TOKEN_MAP = {
  // ... other tokens
  "SQRD": "0x0000000000000000000000000000000000000001", // Invalid address
};
```

### Test:
```bash
/withdraw address:0xYOUR_WALLET token:SQRD amount:10
# Fee succeeds, transfer fails (contract doesn't exist)
```

**Remember to revert after testing!**

---

## Option 3: Insufficient Gas Limit (Advanced)

Modify gas limit to be too low for the transaction.

### Implementation:
In `attemptTokenWithdraw()`, change:

```javascript
// Original
const gasEstimate = await tokenContract.transfer.estimateGas(address, withdrawAmount);

// Test mode - use 50% of estimated gas (will fail)
let gasEstimate = await tokenContract.transfer.estimateGas(address, withdrawAmount);
if (process.env.TEST_LOW_GAS === 'true') {
  gasEstimate = gasEstimate / 2n; // Use half the gas
  console.log('🧪 TEST MODE: Using insufficient gas limit');
}

withdrawTx = await tokenContract.transfer(address, withdrawAmount, {
  gasPrice: feeData.gasPrice,
  gasLimit: gasEstimate,
});
```

---

## Option 4: Network Disconnection (Manual)

1. Start the withdraw process
2. Immediately disconnect your network AFTER fee transaction confirms
3. Transfer will fail due to network timeout
4. Reconnect and retry

**Not recommended - timing is hard to control**

---

## Option 5: Database Manipulation (Advanced)

Manually create a withdraw attempt record in the database with `status: 'fee_collected_pending_withdraw'`.

### Steps:

```javascript
// In MongoDB shell or script
db.withdrawattempts.insertOne({
  discordId: "YOUR_DISCORD_ID",
  userAddress: "YOUR_WALLET_ADDRESS",
  destinationAddress: "0xDEST_WALLET",
  tokenTicker: "AVAX",
  requestedAmount: "10",
  feeInAVAX: "0.005",
  feeInWei: "5000000000000000",
  tokenPriceUSD: "35.50",
  avaxPriceUSD: "35.50",
  isNFT: false,
  status: "fee_collected_pending_withdraw",
  feeTransactionHash: "0xFAKE_TX_HASH",
  createdAt: new Date()
});
```

Then test retry scenarios:
```bash
# Same amount - should retry without fee
/withdraw address:0xDEST token:AVAX amount:10

# Less amount - should show confirmation
/withdraw address:0xDEST token:AVAX amount:5

# More amount - should charge additional fee
/withdraw address:0xDEST token:AVAX amount:15
```

---

## Option 6: Create a Test Command (BEST FOR REPEATED TESTING)

Create a special test-only command that skips the transfer step.

### Create: `commands/testwithdraw.js`

```javascript
import { SlashCommandBuilder } from "discord.js";
import Wallet from "../database/models/wallet.js";
import WithdrawAttempt from "../database/models/withdrawAttempt.js";
import { ethers } from "ethers";

export default {
  data: new SlashCommandBuilder()
    .setName("testwithdraw")
    .setDescription("[TEST] Create a failed withdraw scenario")
    .addStringOption(option =>
      option.setName("token")
        .setDescription("Token ticker")
        .setRequired(true))
    .addNumberOption(option =>
      option.setName("amount")
        .setDescription("Amount")
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const tokenTicker = interaction.options.getString("token");
    const amount = interaction.options.getNumber("amount");

    // Check if wallet exists
    const wallet = await Wallet.findOne({ discordId: interaction.user.id });
    if (!wallet) {
      return interaction.editReply("You don't have a wallet. Use /createwallet");
    }

    // Create fake withdraw attempt (simulating fee collected but transfer failed)
    const withdrawAttempt = new WithdrawAttempt({
      discordId: interaction.user.id,
      userAddress: wallet.address,
      destinationAddress: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb", // Fake dest
      tokenTicker,
      requestedAmount: amount.toString(),
      feeInAVAX: "0.005",
      feeInWei: ethers.parseEther("0.005").toString(),
      tokenPriceUSD: "35.50",
      avaxPriceUSD: "35.50",
      isNFT: false,
      status: "fee_collected_pending_withdraw",
      feeTransactionHash: "0xFAKE_TEST_TX_HASH_" + Date.now(),
      createdAt: new Date()
    });

    await withdrawAttempt.save();

    await interaction.editReply(
      `✅ Test withdraw scenario created!\n\n` +
      `**Token:** ${tokenTicker}\n` +
      `**Amount:** ${amount}\n` +
      `**Status:** Fee collected, transfer pending\n\n` +
      `Now test retry scenarios:\n` +
      `• Same amount: \`/withdraw token:${tokenTicker} amount:${amount}\`\n` +
      `• Less amount: \`/withdraw token:${tokenTicker} amount:${amount * 0.5}\`\n` +
      `• More amount: \`/withdraw token:${tokenTicker} amount:${amount * 1.5}\``
    );
  }
};
```

### Usage:
```bash
# Create test scenario
/testwithdraw token:AVAX amount:10

# Now test all retry scenarios without actually sending transactions!
/withdraw address:0xWALLET token:AVAX amount:10   # Retry same
/withdraw address:0xWALLET token:AVAX amount:5    # Confirmation prompt
/withdraw address:0xWALLET token:AVAX amount:15   # Additional fee
```

---

## My Recommendation:

**Use Option 6 (Test Command)** - It's:
- ✅ Clean and repeatable
- ✅ No need to modify core code
- ✅ No network manipulation needed
- ✅ Easy to test all scenarios quickly
- ✅ No risk of breaking production code

Would you like me to create the test command for you?
