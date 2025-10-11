import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import ApiKey from '../database/models/apiKey.js';

export default {
  data: new SlashCommandBuilder()
    .setName('list-api-keys')
    .setDescription('List all API keys for this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {

    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guild.id;

    try {
      const apiKeys = await ApiKey.find({ guildId: guildId }).sort({ createdAt: -1 });

      if (apiKeys.length === 0) {
        return interaction.editReply({
          content: '📋 No API keys found for this server.\n\nGenerate one with `/generate-api-key`'
        });
      }

      const embed = new EmbedBuilder()
        .setColor(0x00ff99)
        .setTitle(`🔑 API Keys for ${interaction.guild.name}`)
        .setDescription(`Total: ${apiKeys.length} key(s)`)
        .setFooter({ text: 'Use /revoke-api-key to revoke a key' });

      for (const key of apiKeys) {
        const creator = await interaction.guild.members.fetch(key.createdBy).catch(() => null);
        const creatorName = creator ? creator.user.username : 'Unknown';
        const status = key.isActive ? '✅ Active' : '❌ Revoked';
        const lastUsed = key.lastUsedAt ? `<t:${Math.floor(key.lastUsedAt.getTime() / 1000)}:R>` : 'Never';

        embed.addFields({
          name: `${key.name}`,
          value: `**Status:** ${status}\n` +
            `**Hash:** \`${key.keyHash.substring(0, 16)}...\`\n` +
            `**Created by:** ${creatorName}\n` +
            `**Created:** <t:${Math.floor(key.createdAt.getTime() / 1000)}:R>\n` +
            `**Last used:** ${lastUsed}`,
          inline: false
        });
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Error listing API keys:', error);
      return interaction.editReply({
        content: '❌ Failed to list API keys. Please try again later.'
      });
    }
  }
};
