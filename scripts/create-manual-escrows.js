#!/usr/bin/env node

/**
 * Flexible script to manually create escrow entries for failed payouts
 * Supports both ERC-20 tokens and ERC-721 NFTs
 *
 * Usage:
 *   node scripts/create-manual-escrows.js [--env=prod] [--dry-run]
 *
 * Configuration:
 *   Edit the ESCROWS array below to add the entries you need to create
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
  else envFile = ".env";
}

console.log(`Loading env file: ${envFile}`);

// Load environment
dotenv.config({ path: join(__dirname, '..', envFile) });

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIGURATION: Add your escrows here
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const ESCROWS = [
  // ─────────────────────────────────────────────────────────────────────────
  // TOKEN ESCROWS (ERC-20)
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: 'TOKEN',
    guildId: '1243983776024101005',         // Your guild ID
    appId: '1243747782691524680',           // DegenRumble bot ID
    discordId: '907083340614619257',        // Winner's Discord ID
    token: 'VPND',                          // Token ticker
    amount: '500',                          // Amount as string
    note: 'Bounty reward for killing xyz'  // Description
  },

  // ─────────────────────────────────────────────────────────────────────────
  // NFT ESCROWS (ERC-721)
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: 'NFT',
    guildId: '1243983776024101005',         // Your guild ID
    appId: '1243747782691524680',           // DegenRumble bot ID
    discordId: '761795930315817000',        // Winner's Discord ID
    collection: 'OBEEZ',                    // NFT collection name
    tokenId: '441',                         // NFT token ID
    contractAddress: '0x5E870b3d315F7A8d7089E8B829eD8C3d9cef06eF', // NFT contract address (optional if you have it)
    nftName: 'OBEEZ #414',                  // Display name (optional)
    nftImageUrl: 'https://images-ext-1.discordapp.net/external/kWKUf-NQi5YwiaQieJ3ZzN187_F4W_pB_dRlVdNNejA/https/i.ibb.co/1MZcSZh/813.png?format=webp&quality=lossless&width=795&height=795',             // Image URL (optional)
    note: 'Rumble prize - bot restart failure'
  }
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCRIPT LOGIC - No need to modify below this line
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function createManualEscrows() {
  try {
    // Validate configuration
    if (ESCROWS.length === 0) {
      console.error('❌ Error: No escrows configured. Please edit the ESCROWS array.');
      process.exit(1);
    }

    // Connect to MongoDB
    console.log('🔌 Connecting to MongoDB...');
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
      console.error('❌ Error: MONGODB_URI environment variable not found');
      process.exit(1);
    }
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // Validate and categorize escrows
    const tokenEscrows = [];
    const nftEscrows = [];
    const errors = [];

    for (let i = 0; i < ESCROWS.length; i++) {
      const escrow = ESCROWS[i];
      const prefix = `Entry ${i + 1}`;

      // Common validation
      if (!escrow.type) {
        errors.push(`${prefix}: Missing 'type' (must be 'TOKEN' or 'NFT')`);
        continue;
      }
      if (!['TOKEN', 'NFT'].includes(escrow.type)) {
        errors.push(`${prefix}: Invalid type '${escrow.type}' (must be 'TOKEN' or 'NFT')`);
        continue;
      }
      if (!escrow.guildId) errors.push(`${prefix}: Missing 'guildId'`);
      if (!escrow.appId) errors.push(`${prefix}: Missing 'appId'`);
      if (!escrow.discordId) errors.push(`${prefix}: Missing 'discordId'`);

      // Type-specific validation
      if (escrow.type === 'TOKEN') {
        if (!escrow.token) errors.push(`${prefix}: Missing 'token'`);
        if (!escrow.amount) errors.push(`${prefix}: Missing 'amount'`);
        if (errors.length === 0) tokenEscrows.push(escrow);
      } else if (escrow.type === 'NFT') {
        if (!escrow.collection) errors.push(`${prefix}: Missing 'collection'`);
        if (!escrow.tokenId) errors.push(`${prefix}: Missing 'tokenId'`);
        if (errors.length === 0) nftEscrows.push(escrow);
      }
    }

    if (errors.length > 0) {
      console.error('❌ Configuration Errors:\n');
      errors.forEach(err => console.error(`   ${err}`));
      console.error('');
      await mongoose.connection.close();
      process.exit(1);
    }

    // Display summary
    console.log('📋 Escrow Creation Summary:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total Entries:  ${ESCROWS.length}`);
    console.log(`  - Tokens:     ${tokenEscrows.length}`);
    console.log(`  - NFTs:       ${nftEscrows.length}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Check for duplicates
    console.log('🔍 Checking for existing escrow entries...\n');

    const duplicateChecks = [];
    for (const escrow of tokenEscrows) {
      duplicateChecks.push({
        guildId: escrow.guildId,
        appId: escrow.appId,
        discordId: escrow.discordId,
        token: escrow.token,
        amount: escrow.amount,
        claimed: false,
        isNFT: false
      });
    }
    for (const escrow of nftEscrows) {
      duplicateChecks.push({
        guildId: escrow.guildId,
        appId: escrow.appId,
        discordId: escrow.discordId,
        token: escrow.collection,
        tokenId: escrow.tokenId,
        claimed: false,
        isNFT: true
      });
    }

    if (duplicateChecks.length > 0) {
      const existingEscrows = await PrizeEscrow.find({
        $or: duplicateChecks
      });

      if (existingEscrows.length > 0) {
        console.log(`⚠️  Warning: Found ${existingEscrows.length} potentially duplicate escrow entries:\n`);
        for (const escrow of existingEscrows) {
          if (escrow.isNFT) {
            console.log(`   - NFT: ${escrow.token} #${escrow.tokenId} → ${escrow.discordId}`);
          } else {
            console.log(`   - Token: ${escrow.amount} ${escrow.token} → ${escrow.discordId}`);
          }
          console.log(`     ID: ${escrow._id}\n`);
        }
        console.log('⚠️  These may be duplicates. Review before proceeding.\n');
      }
    }

    // Display what will be created
    console.log('📝 Escrows to Create:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (tokenEscrows.length > 0) {
      console.log('💰 TOKEN ESCROWS:');
      tokenEscrows.forEach((escrow, index) => {
        console.log(`\n${index + 1}. ${escrow.amount} ${escrow.token}`);
        console.log(`   Winner:  ${escrow.discordId}`);
        console.log(`   Guild:   ${escrow.guildId}`);
        console.log(`   App:     ${escrow.appId}`);
        if (escrow.note) console.log(`   Note:    ${escrow.note}`);
      });
      console.log('\n');
    }

    if (nftEscrows.length > 0) {
      console.log('🖼️  NFT ESCROWS:');
      nftEscrows.forEach((escrow, index) => {
        const nftName = escrow.nftName || `${escrow.collection} #${escrow.tokenId}`;
        console.log(`\n${index + 1}. ${nftName}`);
        console.log(`   Collection: ${escrow.collection}`);
        console.log(`   Token ID:   ${escrow.tokenId}`);
        console.log(`   Winner:     ${escrow.discordId}`);
        console.log(`   Guild:      ${escrow.guildId}`);
        console.log(`   App:        ${escrow.appId}`);
        if (escrow.contractAddress) console.log(`   Contract:   ${escrow.contractAddress}`);
        if (escrow.nftImageUrl) console.log(`   Image:      ${escrow.nftImageUrl}`);
        if (escrow.note) console.log(`   Note:       ${escrow.note}`);
      });
      console.log('\n');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (dryRun) {
      console.log('✅ DRY RUN COMPLETE - No changes made to database\n');
      console.log('To create these escrow entries, run without --dry-run flag:\n');
      console.log(`  node scripts/create-manual-escrows.js ${envArg ? envArg : ''}\n`);
      await mongoose.connection.close();
      process.exit(0);
    }

    // Create escrow entries
    console.log('🔄 Creating escrow entries...\n');

    const createdEscrows = [];

    // Create token escrows
    for (const escrow of tokenEscrows) {
      const escrowEntry = new PrizeEscrow({
        guildId: escrow.guildId,
        appId: escrow.appId,
        discordId: escrow.discordId,
        token: escrow.token,
        amount: escrow.amount,
        claimed: false,
        isNFT: false,
        metadata: {
          source: 'manual_backfill',
          note: escrow.note || 'Manual escrow creation',
          createdBy: 'create-manual-escrows.js',
          createdAt: new Date().toISOString()
        }
      });

      await escrowEntry.save();
      createdEscrows.push(escrowEntry);
      console.log(`✅ Created TOKEN escrow: ${escrow.amount} ${escrow.token} → ${escrow.discordId}`);
      console.log(`   ID: ${escrowEntry._id}`);
      if (escrow.note) console.log(`   Note: ${escrow.note}`);
      console.log('');
    }

    // Create NFT escrows
    for (const escrow of nftEscrows) {
      const escrowEntry = new PrizeEscrow({
        guildId: escrow.guildId,
        appId: escrow.appId,
        discordId: escrow.discordId,
        token: escrow.collection,
        amount: '1', // NFTs always have amount 1
        claimed: false,
        isNFT: true,
        contractAddress: escrow.contractAddress || null,
        tokenId: escrow.tokenId,
        nftName: escrow.nftName || null,
        nftImageUrl: escrow.nftImageUrl || null,
        metadata: {
          source: 'manual_backfill',
          note: escrow.note || 'Manual NFT escrow creation',
          createdBy: 'create-manual-escrows.js',
          createdAt: new Date().toISOString()
        }
      });

      await escrowEntry.save();
      createdEscrows.push(escrowEntry);
      const nftName = escrow.nftName || `${escrow.collection} #${escrow.tokenId}`;
      console.log(`✅ Created NFT escrow: ${nftName} → ${escrow.discordId}`);
      console.log(`   ID: ${escrowEntry._id}`);
      if (escrow.note) console.log(`   Note: ${escrow.note}`);
      console.log('');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ Successfully created ${createdEscrows.length} escrow entries!`);
    console.log(`   - Tokens: ${tokenEscrows.length}`);
    console.log(`   - NFTs:   ${nftEscrows.length}\n`);

    // Summary by user
    const byUser = {};
    for (const escrow of tokenEscrows) {
      if (!byUser[escrow.discordId]) {
        byUser[escrow.discordId] = { tokens: [], nfts: [] };
      }
      byUser[escrow.discordId].tokens.push(`${escrow.amount} ${escrow.token}`);
    }
    for (const escrow of nftEscrows) {
      if (!byUser[escrow.discordId]) {
        byUser[escrow.discordId] = { tokens: [], nfts: [] };
      }
      const nftName = escrow.nftName || `${escrow.collection} #${escrow.tokenId}`;
      byUser[escrow.discordId].nfts.push(nftName);
    }

    console.log('📊 Escrow Summary by Winner:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const [discordId, prizes] of Object.entries(byUser)) {
      console.log(`\n${discordId}:`);
      if (prizes.tokens.length > 0) {
        console.log(`  Tokens: ${prizes.tokens.join(', ')}`);
      }
      if (prizes.nfts.length > 0) {
        console.log(`  NFTs:   ${prizes.nfts.join(', ')}`);
      }
    }
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('📋 Next Steps:');
    console.log('  1. Winners can now claim their prizes using /claimprize');
    console.log('  2. Verify token escrows: db.prizeescrows.find({ claimed: false, isNFT: false })');
    console.log('  3. Verify NFT escrows: db.prizeescrows.find({ claimed: false, isNFT: true })');
    console.log('  4. Check prize pool balance to ensure sufficient funds');
    console.log('  5. Verify NFTs are in the prize pool wallet\n');

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
createManualEscrows();
