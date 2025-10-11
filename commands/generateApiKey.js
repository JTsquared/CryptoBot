import { SlashCommandBuilder } from 'discord.js';
import ApiKey from '../database/models/apiKey.js';
import crypto from 'crypto';

export default {
  hidden: true,
  data: new SlashCommandBuilder()
    .setName('generate-api-key')
    .setDescription('Generate an API key for external access to your prize pool (admin only)')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('A name to identify this API key')
        .setRequired(false)
    ),

  async execute(interaction) {
    // Check if user has admin permissions
    if (!interaction.member.permissions.has('ManageGuild')) {
      return interaction.reply({
        content: '❌ You do not have permission to use this command.',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guild.id;
    const createdBy = interaction.user.id;
    const keyName = interaction.options.getString('name') || 'Default API Key';

    try {
      // Generate a random API key (32 bytes = 64 hex characters)
      const apiKey = crypto.randomBytes(32).toString('hex');

      // Hash the API key for storage (SHA-256)
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

      // Save to database
      const newApiKey = await ApiKey.create({
        guildId: guildId,
        keyHash: keyHash,
        name: keyName,
        createdBy: createdBy,
        isActive: true
      });

      // Return the API key to the user (ONLY TIME IT'S SHOWN IN PLAINTEXT)
      await interaction.editReply({
        content: `✅ **API Key Generated Successfully!**\n\n` +
          `**Name:** ${keyName}\n` +
          `**Key:** \`${apiKey}\`\n\n` +
          `⚠️ **IMPORTANT:**\n` +
          `• Save this key immediately - it will not be shown again!\n` +
          `• This key only works for ${interaction.guild.name}'s prize pool\n` +
          `• Include this key in the \`X-API-Key\` header for all API requests\n` +
          `• You can revoke this key anytime with \`/revoke-api-key\`\n\n` +
          `**Example usage:**\n` +
          `\`\`\`bash\n` +
          `curl -H "X-API-Key: ${apiKey}" \\\n` +
          `  http://34.162.131.64:3000/api/prizepool/balances/${guildId}\n` +
          `\`\`\``
      });

    } catch (error) {
      console.error('Error generating API key:', error);

      if (error.code === 11000) {
        return interaction.editReply({
          content: '❌ Key generation failed due to collision. Please try again.'
        });
      }

      return interaction.editReply({
        content: '❌ Failed to generate API key. Please try again later.'
      });
    }
  }
};
