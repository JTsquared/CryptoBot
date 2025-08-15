// commands/createprizepool.js
import { SlashCommandBuilder } from 'discord.js';
import prizePoolService from '../services/prizePoolService.js';
import PrizePoolWallet from '../models/PrizePoolWallet.js';

export default {
  hidden: true,
  data: new SlashCommandBuilder()
    .setName('createprizepool')
    .setDescription('Create a prize pool wallet for this server (admin only)'),
  async execute(interaction) {
    if (!interaction.member.permissions.has('ManageGuild')) {
      return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
    }

    const guildId = interaction.guild.id;
    const existingWallet = await PrizePoolWallet.findOne({ guildId });

    if (existingWallet) {
      return interaction.reply({
        content: `ℹ️ This server already has a prize pool wallet: \`${existingWallet.address}\``,
        ephemeral: true
      });
    }

    const newWallet = await prizePoolService.createWallet(guildId);
    await interaction.reply({
      content: `✅ Prize pool wallet created: \`${newWallet.address}\`\nSend donations here to fund Crypto Rumbles.`,
      ephemeral: false
    });
  }
};
