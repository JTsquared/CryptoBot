#!/usr/bin/env node

/**
 * One-time script to create escrow entries for unpaid bounties
 *
 * Usage:
 *   node scripts/create-bounty-escrows.js [--env=prod] [--dry-run]
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import PrizeEscrow from '../database/models/prizeEscrow.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse env file argument
let envFile = ".env";
const envArg = process.argv.find(arg => arg.startsWith("--env="));
if (envArg) {
  const file = envArg.split("=")[1];
  if (file === "test") envFile = ".env.test";
  else if (file === "prod") envFile = ".env.prod";
  else envFile = ".env"; // fallback
}

console.log(`Loading env file: ${envFile}`);

// Load environment
dotenv.config({ path: join(__dirname, '..', envFile) });

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

// Guild and app info
const GUILD_ID = '1304108977113665547';
const APP_ID = '1243747782691524680';
const TOKEN = 'DISH';

// Bounty data - winner gets the bounty
const BOUNTIES = [
  { winner: '550501211288109066', amount: 4444, note: 'bidloperv killed anej5' },
  { winner: '761795930315817000', amount: 4444, note: 'Badger killed ridnime' },
  { winner: '401423933322297355', amount: 4444, note: 'refund to dimifw for sipofcoke bounty' },
  { winner: '331322816999981057', amount: 4444, note: 'trip_draw killed jtsquared' },
  { winner: '1030303747815002183', amount: 1, note: 'sipofcoke killed badger.ca' },
  { winner: '841633058238496789', amount: 4444, note: 'carefortherare killed triz_draw' },
  { winner: '401423933322297355', amount: 4444, note: 'refund to dimifw for annyone.any bounty' },
  { winner: '401423933322297355', amount: 4444, note: 'refund to dimifw for carefortherare bounty' },
  { winner: '401423933322297355', amount: 4444, note: 'refund to dimifw for gryphus987 bounty' },
  { winner: '1030303747815002183', amount: 4445, note: 'sipofcoke killed badger.ca (second bounty)' },
  { winner: '761795930315817000', amount: 5555, note: 'badger killed dimifw' },
  { winner: '331322816999981057', amount: 4444, note: 'triz_draw killed espitheking' },
  { winner: '550501211288109066', amount: 4444, note: 'bidloperv killed josephk17' },
  { winner: '401423933322297355', amount: 4444, note: 'refund to dimifw for bidloperv bounty' }
];

async function createBountyEscrows() {
  try {
    // Connect to MongoDB
    console.log('🔌 Connecting to MongoDB...');
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
      console.error('❌ Error: MONGODB_URI environment variable not found');
      process.exit(1);
    }
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // Calculate total
    const totalAmount = BOUNTIES.reduce((sum, b) => sum + b.amount, 0);
    console.log('📋 Bounty Escrow Summary:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Guild ID:     ${GUILD_ID}`);
    console.log(`App ID:       ${APP_ID}`);
    console.log(`Token:        ${TOKEN}`);
    console.log(`Total Amount: ${totalAmount} ${TOKEN}`);
    console.log(`Bounties:     ${BOUNTIES.length}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Check for existing escrows
    console.log('🔍 Checking for existing escrow entries...');
    const existingEscrows = await PrizeEscrow.find({
      guildId: GUILD_ID,
      appId: APP_ID,
      token: TOKEN,
      claimed: false,
      discordId: { $in: BOUNTIES.map(b => b.winner) }
    });

    if (existingEscrows.length > 0) {
      console.log(`⚠️  Found ${existingEscrows.length} existing unclaimed escrow entries:`);
      for (const escrow of existingEscrows) {
        console.log(`   - ${escrow.discordId}: ${escrow.amount} ${escrow.token}`);
      }
      console.log('\n');
    }

    // Display bounties to create
    console.log('📝 Bounties to Create:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    BOUNTIES.forEach((bounty, index) => {
      console.log(`${index + 1}. ${bounty.amount} ${TOKEN} → ${bounty.winner}`);
      console.log(`   Note: ${bounty.note}`);
    });
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (dryRun) {
      console.log('✅ DRY RUN COMPLETE - No changes made to database\n');
      console.log('To create these escrow entries, run without --dry-run flag:\n');
      console.log(`  node scripts/create-bounty-escrows.js\n`);
      await mongoose.connection.close();
      process.exit(0);
    }

    // Create escrow entries
    console.log('🔄 Creating escrow entries...\n');

    const createdEscrows = [];
    for (const bounty of BOUNTIES) {
      const escrowEntry = new PrizeEscrow({
        guildId: GUILD_ID,
        appId: APP_ID,
        discordId: bounty.winner,
        token: TOKEN,
        amount: bounty.amount.toString(),
        claimed: false,
        metadata: {
          source: 'bounty_backfill',
          note: bounty.note,
          createdBy: 'create-bounty-escrows.js'
        }
      });

      await escrowEntry.save();
      createdEscrows.push(escrowEntry);
      console.log(`✅ Created escrow: ${bounty.amount} ${TOKEN} → ${bounty.winner}`);
      console.log(`   ID: ${escrowEntry._id}`);
      console.log(`   Note: ${bounty.note}\n`);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ Successfully created ${createdEscrows.length} escrow entries!`);
    console.log(`   Total escrowed: ${totalAmount} ${TOKEN}\n`);

    // Group by winner
    const byWinner = {};
    for (const bounty of BOUNTIES) {
      if (!byWinner[bounty.winner]) {
        byWinner[bounty.winner] = 0;
      }
      byWinner[bounty.winner] += bounty.amount;
    }

    console.log('📊 Escrow Summary by Winner:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const [winner, total] of Object.entries(byWinner)) {
      const count = BOUNTIES.filter(b => b.winner === winner).length;
      console.log(`${winner}: ${total} ${TOKEN} (${count} bounties)`);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('📋 Next Steps:');
    console.log('  1. Winners can now claim their prizes using /claimprize');
    console.log('  2. Verify escrows with: db.prizeescrows.find({ guildId: "1304108977113665547", claimed: false })');
    console.log('  3. Check prize pool balance to ensure sufficient funds\n');

    await mongoose.connection.close();
    console.log('🔌 Database connection closed');

  } catch (error) {
    console.error('\n❌ Script failed with error:', error);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

// Run the script
createBountyEscrows();
