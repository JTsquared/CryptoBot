import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import Wallet from "../database/models/wallet.js";

export default {
  data: new SlashCommandBuilder()
    .setName('removewallet')
    .setDescription('Removes your wallet from the bot (cannot be undone).'),
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.user.id;

    const existingWallet = await Wallet.findOne({ discordId: userId });
    if (!existingWallet) {
      return interaction.editReply("❌ You don't have a wallet to remove.");
    }

    // Optional: confirm action
    await interaction.editReply(
      "⚠ Are you sure you want to remove your wallet? Type `YES` within 30 seconds to confirm."
    );

    const filter = m => m.author.id === userId && m.content.trim().toUpperCase() === 'YES';
    try {
      const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] });
      if (collected.size > 0) {
        await Wallet.deleteOne({ discordId: userId });
        await interaction.followUp({ content: "✅ Your wallet has been removed. You can now use `/createWallet` to make a new one.", ephemeral: true });
      }
    } catch {
      await interaction.followUp({ content: "❌ Wallet removal timed out. Nothing was deleted.", ephemeral: true });
    }
  }
};
