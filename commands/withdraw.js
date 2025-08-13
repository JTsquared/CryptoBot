// commands/withdraw.js
import { SlashCommandBuilder } from "discord.js";
import Wallet from "../database/models/wallet.js";
import { ethers } from "ethers";
import { decrypt } from "../utils/encryption.js";
import { TOKEN_MAP, ERC20_ABI, TOKEN_CHOICES, getTokenAddress, isNativeToken } from "../utils/tokenConfig.js";

export default {
  data: new SlashCommandBuilder()
    .setName("withdraw")
    .setDescription("Withdraw AVAX or tokens to another address")
    .addStringOption(option =>
      option.setName("address")
        .setDescription("Destination AVAX address")
        .setRequired(true))
    .addNumberOption(option =>
      option.setName("amount")
        .setDescription("Amount to withdraw")
        .setRequired(true))
    .addStringOption(option => 
      option.setName("token")
        .setDescription("Token to withdraw")
        .setRequired(true)
        .addChoices(...TOKEN_CHOICES)
    ),
  async execute(interaction) {
    await interaction.deferReply({ flags: 64 }); // 64 = ephemeral flag

    const address = interaction.options.getString("address");
    const amount = interaction.options.getNumber("amount");
    const tokenTicker = interaction.options.getString("token");

    // Validate amount
    if (!amount || amount <= 0) {
      return interaction.editReply("Enter a valid amount greater than 0.");
    }

    // Validate address format (basic check)
    if (!ethers.isAddress(address)) {
      return interaction.editReply("Invalid AVAX address format.");
    }

    const existingWallet = await Wallet.findOne({ discordId: interaction.user.id });

    if (!existingWallet) {
      return interaction.editReply("You don't have a wallet yet. Use `/createwallet` first.");
    }

    try {
      // Use the same RPC as your other commands
      const provider = new ethers.JsonRpcProvider(process.env.AVALANCHE_RPC);
      
      // Verify the provider can connect
      try {
        await provider.getNetwork();
      } catch (providerError) {
        console.error("Provider connection failed:", providerError);
        return interaction.editReply("❌ Network connection failed. Please try again later.");
      }

      const privateKey = decrypt(existingWallet.privateKey);
      const signer = new ethers.Wallet(privateKey, provider);

      const contractAddress = getTokenAddress(tokenTicker);
      let tx;

      if (isNativeToken(tokenTicker)) {
        // Handle AVAX withdraw
        const withdrawAmount = ethers.parseEther(amount.toString());

        // Get gas estimate
        const feeData = await provider.getFeeData();
        if (!feeData.gasPrice) {
          return interaction.editReply("Could not fetch gas price from provider.");
        }

        const gasEstimate = await provider.estimateGas({
          to: address,
          value: withdrawAmount,
          from: existingWallet.address,
        });

        const gasCost = gasEstimate * feeData.gasPrice;
        const totalCost = withdrawAmount + gasCost;

        // Check balance
        const balance = await provider.getBalance(existingWallet.address);
        if (balance < totalCost) {
          const balanceInAvax = ethers.formatEther(balance);
          const gasCostInAvax = ethers.formatEther(gasCost);
          return interaction.editReply(
            `❌ Insufficient funds. You have ${balanceInAvax} AVAX but need ${amount} AVAX + ${gasCostInAvax} AVAX for gas.`
          );
        }

        tx = await signer.sendTransaction({
          to: address,
          value: withdrawAmount,
          gasPrice: feeData.gasPrice,
          gasLimit: gasEstimate,
        });

      } else {
        // Handle ERC-20 token withdraw
        const tokenContract = new ethers.Contract(contractAddress, ERC20_ABI, signer);

        // Get token decimals
        const decimals = await tokenContract.decimals();
        const withdrawAmount = ethers.parseUnits(amount.toString(), decimals);

        // Check token balance
        const tokenBalance = await tokenContract.balanceOf(existingWallet.address);
        if (tokenBalance < withdrawAmount) {
          const balanceHuman = ethers.formatUnits(tokenBalance, decimals);
          return interaction.editReply(
            `❌ Insufficient ${tokenTicker} balance. You have ${balanceHuman} ${tokenTicker}, need ${amount} ${tokenTicker}.`
          );
        }

        // Get gas estimate for token transfer
        const feeData = await provider.getFeeData();
        if (!feeData.gasPrice) {
          return interaction.editReply("Could not fetch gas price from provider.");
        }

        const gasEstimate = await tokenContract.transfer.estimateGas(address, withdrawAmount);
        const gasCost = gasEstimate * feeData.gasPrice;

        // Check AVAX balance for gas
        const avaxBalance = await provider.getBalance(existingWallet.address);
        if (avaxBalance < gasCost) {
          const gasCostInAvax = ethers.formatEther(gasCost);
          return interaction.editReply(
            `❌ Insufficient AVAX for gas fees. You need ~${gasCostInAvax} AVAX for gas.`
          );
        }

        tx = await tokenContract.transfer(address, withdrawAmount, {
          gasPrice: feeData.gasPrice,
          gasLimit: gasEstimate,
        });
      }

      await interaction.editReply(
        `✅ Withdraw sent!\n**Amount:** ${amount} ${tokenTicker}\n**To:** \`${address}\`\n**TX:** https://testnet.snowtrace.io/tx/${tx.hash}`
      );

      console.log(`✅ withdraw successful: ${interaction.user.username} withdrew ${amount} ${tokenTicker} - TX: ${tx.hash}`);

    } catch (error) {
      console.error("withdraw error:", error);
      await interaction.editReply(
        `❌ withdraw failed: ${error.reason || error.message || "Unknown error"}`
      );
    }
  }
};