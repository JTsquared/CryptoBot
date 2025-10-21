// commands/createGlobalWallet.js
import { SlashCommandBuilder } from 'discord.js';
import { GlobalAppWalletService } from '../services/globalAppWalletService.js';
import { ethers } from 'ethers';

// Create an ethers provider
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

// Instantiate the GlobalAppWalletService
const globalWalletService = new GlobalAppWalletService(provider);

export default {
  hidden: true, // Only available in dev mode
  data: new SlashCommandBuilder()
    .setName('createglobalwallet')
    .setDescription('[DEV ONLY] Create or replace global app wallet')
    .addStringOption(option =>
      option
        .setName('appname')
        .setDescription('App name (e.g., ServerWars)')
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option
        .setName('replace')
        .setDescription('Replace existing wallet if it exists')
        .setRequired(false)
    ),

  async execute(interaction) {
    // Security check: Only allow in development mode
    if (process.env.NETWORK !== 'testnet') {
      return interaction.reply({
        content: '❌ This command is only available in development mode.',
        ephemeral: true
      });
    }

    // Get the appId from the bot that's running this command
    const appId = interaction.client.user.id;
    const appName = interaction.options.getString('appname');
    const shouldReplace = interaction.options.getBoolean('replace') || false;

    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await globalWalletService.createOrReplaceWallet(appId, appName, shouldReplace);

      if (!result.success) {
        if (result.error === "WALLET_ALREADY_EXISTS") {
          return interaction.editReply({
            content: `ℹ️ Global wallet for **${appName}** already exists.\n` +
                     `Address: \`${result.wallet.address}\`\n\n` +
                     `Use \`replace: true\` to create a new wallet (this will invalidate the old one).`
          });
        }

        return interaction.editReply({
          content: `❌ Failed to create global wallet: ${result.error}`
        });
      }

      const action = result.replaced ? "replaced" : "created";
      const emoji = result.replaced ? "🔄" : "✅";

      return interaction.editReply({
        content: `${emoji} Global wallet ${action} for **${appName}**\n\n` +
                 `**App ID:** \`${appId}\`\n` +
                 `**Address:** \`${result.wallet.address}\`\n\n` +
                 `${result.replaced ? '⚠️ **Warning:** The old wallet is no longer accessible via this bot.' : ''}`
      });
    } catch (err) {
      console.error("Error in createGlobalWallet command:", err);
      return interaction.editReply({
        content: `❌ An error occurred while creating the global wallet: ${err.message}`
      });
    }
  }
};
