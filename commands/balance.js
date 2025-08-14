import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import Wallet from "../database/models/wallet.js";
import { ethers } from "ethers";
import { TOKEN_MAP, ERC20_ABI, isNativeToken } from "../utils/tokenConfig.js";

export default {
  data: new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Check your AVAX and token balances"),
  async execute(interaction) {
    await interaction.deferReply({ flags: 64 }); // Ephemeral

    const walletDoc = await Wallet.findOne({ discordId: interaction.user.id });
    if (!walletDoc) {
      return interaction.editReply("You don't have a wallet yet. Use `/createwallet`.");
    }

    try {
      const provider = new ethers.JsonRpcProvider(process.env.AVALANCHE_RPC);
      
      // Verify provider connection
      try {
        await provider.getNetwork();
      } catch (providerError) {
        console.error("Provider connection failed:", providerError);
        return interaction.editReply("❌ Network connection failed. Please try again later.");
      }

      const balances = [];
      
      // Get balances for all tokens
      for (const [ticker, contractAddress] of Object.entries(TOKEN_MAP)) {
        try {
          let balance;
          let formattedBalance;

          if (isNativeToken(ticker)) {
            // Get AVAX balance
            balance = await provider.getBalance(walletDoc.address);
            formattedBalance = ethers.formatEther(balance);
          } else {
            // Get ERC-20 token balance
            const tokenContract = new ethers.Contract(contractAddress, ERC20_ABI, provider);
            balance = await tokenContract.balanceOf(walletDoc.address);
            const decimals = await tokenContract.decimals();
            formattedBalance = ethers.formatUnits(balance, decimals);
          }

          // Only include tokens with non-zero balances or AVAX (always show AVAX)
          const balanceNum = parseFloat(formattedBalance);
          if (balanceNum > 0 || ticker === "AVAX") {
            balances.push({
              ticker,
              balance: formattedBalance,
              hasBalance: balanceNum > 0
            });
          }

        } catch (tokenError) {
          console.error(`Error fetching ${ticker} balance:`, tokenError);
          // Continue with other tokens if one fails
        }
      }

      if (balances.length === 0) {
        return interaction.editReply("❌ Could not fetch any token balances. Please try again later.");
      }

      // Create embed with balance information
      const embed = new EmbedBuilder()
        .setColor(0x00ff99)
        .setTitle(`💰 ${interaction.user.username}'s Wallet`)
        .setDescription(`**Address:** \`${walletDoc.address}\``)
        .setTimestamp()
        .setFooter({ text: "Avalanche Fuji Testnet" });

      // Add balance fields
      const balanceFields = [];
      let hasAnyTokens = false;

      for (const { ticker, balance, hasBalance } of balances) {
        const displayBalance = parseFloat(balance).toFixed(6); // Show up to 6 decimals
        const cleanBalance = parseFloat(displayBalance); // Remove trailing zeros
        
        if (ticker === "AVAX") {
          balanceFields.unshift(`**${ticker}:** ${cleanBalance}`); // Put AVAX first
        } else if (hasBalance) {
          balanceFields.push(`**${ticker}:** ${cleanBalance}`);
          hasAnyTokens = true;
        }
      }

      // Add main balance field
      embed.addFields({
        name: "💎 Balances",
        value: balanceFields.join('\n') || "No balances found",
        inline: false
      });

      // Add helpful note if user only has AVAX
      if (!hasAnyTokens && balanceFields.length === 1) {
        embed.addFields({
          name: "ℹ️ Note",
          value: "You currently only have AVAX. Use `/tip` or `/rain` to send tokens to others!",
          inline: false
        });
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error("Balance check error:", err);
      return interaction.editReply("❌ Failed to fetch balances. Please try again later.");
    }
  },
};