#!/usr/bin/env node

/**
 * Migration Script: Add appId to Existing Prize Pool Wallets
 *
 * This script adds the appId field to existing prize pool wallets
 * to enable multi-bot support per guild.
 *
 * Usage:
 *   node scripts/migrate-add-appid.js --app-id=YOUR_BOT_APP_ID [--dry-run] [--env=prod]
 *
 * Arguments:
 *   --app-id        Required. The Discord bot application ID to assign to existing wallets
 *   --dry-run       Optional. Preview changes without modifying the database
 *   --env           Optional. Specify environment: prod, test, or default (.env)
 *
 * Examples:
 *   # Dry run to preview changes
 *   node scripts/migrate-add-appid.js --app-id=1234567890 --dry-run
 *
 *   # Apply migration to production
 *   node scripts/migrate-add-appid.js --app-id=1234567890 --env=prod
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import readline from 'readline';

// Parse command line arguments
const args = process.argv.slice(2);
const appIdArg = args.find(arg => arg.startsWith('--app-id='));
const dryRun = args.includes('--dry-run');
const envArg = args.find(arg => arg.startsWith('--env='));

// Load appropriate .env file
let envFile = '.env';
if (envArg) {
  const env = envArg.split('=')[1];
  if (env === 'test') envFile = '.env.test';
  else if (env === 'prod') envFile = '.env.prod';
}

console.log(`📁 Loading environment from: ${envFile}`);
dotenv.config({ path: envFile });

// Validate arguments
if (!appIdArg) {
  console.error('\n❌ Error: --app-id argument is required\n');
  console.log('Usage:');
  console.log('  node scripts/migrate-add-appid.js --app-id=YOUR_BOT_APP_ID [--dry-run] [--env=prod]\n');
  console.log('Example:');
  console.log('  node scripts/migrate-add-appid.js --app-id=1234567890 --dry-run\n');
  process.exit(1);
}

const defaultAppId = appIdArg.split('=')[1];

if (!defaultAppId || defaultAppId.trim() === '') {
  console.error('\n❌ Error: --app-id cannot be empty\n');
  process.exit(1);
}

// Define schema (same as in database/models/prizePoolWallet.js)
const prizePoolWalletSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  appId: { type: String, required: false, index: true }, // Optional during migration
  address: { type: String, required: true },
  privateKey: { type: String, required: true },
}, { timestamps: true });

const PrizePoolWallet = mongoose.model('PrizePoolWallet', prizePoolWalletSchema);

/**
 * Prompt user for confirmation
 */
function askConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().trim() === 'yes');
    });
  });
}

/**
 * Main migration function
 */
async function migrate() {
  try {
    // Connect to MongoDB
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find all wallets without appId field
    const walletsWithoutAppId = await PrizePoolWallet.find({
      appId: { $exists: false }
    });

    console.log('📊 Migration Summary:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Environment:        ${envFile}`);
    console.log(`Mode:               ${dryRun ? 'DRY RUN (no changes)' : 'LIVE (will modify database)'}`);
    console.log(`Default appId:      ${defaultAppId}`);
    console.log(`Wallets found:      ${walletsWithoutAppId.length}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (walletsWithoutAppId.length === 0) {
      console.log('✅ No wallets need migration. All wallets already have appId field.');
      await mongoose.connection.close();
      return;
    }

    // Display wallets that will be updated
    console.log('📋 Wallets to be updated:\n');
    walletsWithoutAppId.forEach((wallet, index) => {
      console.log(`${index + 1}. Guild: ${wallet.guildId}`);
      console.log(`   Address: ${wallet.address}`);
      console.log(`   Created: ${wallet.createdAt ? wallet.createdAt.toISOString() : 'Unknown'}`);
      console.log(`   → Will add appId: ${defaultAppId}\n`);
    });

    // Confirm migration
    if (!dryRun) {
      console.log('⚠️  WARNING: This will modify the database!');
      console.log('⚠️  Make sure you have a backup before proceeding.\n');

      const confirmed = await askConfirmation('Type "yes" to proceed with migration: ');

      if (!confirmed) {
        console.log('\n❌ Migration cancelled by user.');
        await mongoose.connection.close();
        return;
      }
    }

    // Perform migration
    if (dryRun) {
      console.log('\n✅ DRY RUN COMPLETE - No changes made to database');
      console.log('\nTo apply these changes, run without --dry-run flag:\n');
      console.log(`  node scripts/migrate-add-appid.js --app-id=${defaultAppId} --env=${envFile.replace('.env.', '').replace('.env', 'default')}\n`);
    } else {
      console.log('\n🔄 Applying migration...\n');

      let successCount = 0;
      let errorCount = 0;

      for (const wallet of walletsWithoutAppId) {
        try {
          // Update wallet with appId
          wallet.appId = defaultAppId;
          await wallet.save();
          console.log(`✅ Updated wallet for guild ${wallet.guildId}`);
          successCount++;
        } catch (error) {
          console.error(`❌ Failed to update wallet for guild ${wallet.guildId}:`, error.message);
          errorCount++;
        }
      }

      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📊 Migration Results:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`✅ Successfully updated: ${successCount}`);
      if (errorCount > 0) {
        console.log(`❌ Failed to update:     ${errorCount}`);
      }
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      if (errorCount === 0) {
        console.log('🎉 Migration completed successfully!\n');

        // Update indexes
        console.log('🔄 Updating database indexes...');
        try {
          // Drop old single-field index on guildId if it exists with unique constraint
          const existingIndexes = await PrizePoolWallet.collection.getIndexes();
          console.log('Current indexes:', Object.keys(existingIndexes).join(', '));

          // Check if we need to create compound index
          if (!existingIndexes['guildId_1_appId_1']) {
            console.log('Creating compound index on { guildId: 1, appId: 1 }...');
            await PrizePoolWallet.collection.createIndex(
              { guildId: 1, appId: 1 },
              { unique: true }
            );
            console.log('✅ Compound index created successfully');
          } else {
            console.log('✅ Compound index already exists');
          }
        } catch (indexError) {
          console.error('⚠️  Warning: Failed to update indexes:', indexError.message);
          console.log('You may need to manually update indexes in MongoDB');
        }

        console.log('\n📝 Next Steps:');
        console.log('1. Update your Discord bots to pass appId in API calls');
        console.log('2. Test the multi-bot functionality in a test server');
        console.log('3. Monitor logs for any issues\n');
      } else {
        console.log('⚠️  Migration completed with errors. Please review the failed updates.\n');
      }
    }

    // Close connection
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');

  } catch (error) {
    console.error('\n❌ Migration failed with error:', error);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

// Run migration
migrate();
