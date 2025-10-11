import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import ApiKey from '../database/models/apiKey.js';

export default {
  data: new SlashCommandBuilder()
    .setName('revoke-api-key')
    .setDescription('Revoke an API key')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption(option =>
      option.setName('key-hash')
        .setDescription('First 16 characters of the key hash (from /list-api-keys)')
        .setRequired(true)
    ),

  async execute(interaction) {

    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guild.id;
    const keyHashPrefix = interaction.options.getString('key-hash');

    try {
      // Find all keys for this guild
      const apiKeys = await ApiKey.find({ guildId: guildId, isActive: true });

      // Find the key that starts with the provided hash prefix
      const matchingKey = apiKeys.find(key => key.keyHash.startsWith(keyHashPrefix));

      if (!matchingKey) {
        return interaction.editReply({
          content: `❌ No active API key found with hash starting with \`${keyHashPrefix}\`\n\n` +
            `Use \`/list-api-keys\` to see all active keys.`
        });
      }

      // Revoke the key
      matchingKey.isActive = false;
      await matchingKey.save();

      await interaction.editReply({
        content: `✅ **API Key Revoked**\n\n` +
          `**Name:** ${matchingKey.name}\n` +
          `**Hash:** \`${matchingKey.keyHash.substring(0, 16)}...\`\n\n` +
          `This key can no longer be used to access the API.`
      });

    } catch (error) {
      console.error('Error revoking API key:', error);
      return interaction.editReply({
        content: '❌ Failed to revoke API key. Please try again later.'
      });
    }
  }
};
