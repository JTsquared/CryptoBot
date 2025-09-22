import { SlashCommandBuilder } from "discord.js";
import Wallet from "../database/models/wallet.js";
import Transaction from "../database/models/transactionModel.js";
import { ethers } from "ethers";
import { decrypt } from "../utils/encryption.js";
import { EmbedBuilder } from "discord.js";
import { ERC20_ABI, getTokenAddress, isNativeToken } from "../utils/tokenConfig.js";
import { getTokenChoices } from "../utils/tokenConfig.js";

export default {
  data: new SlashCommandBuilder()
    .setName("tip")
    .setDescription("Send AVAX or ERC-20 tokens to another user's wallet")
    .addUserOption(option => option.setName("recipient").setDescription("User to tip").setRequired(true))
    .addNumberOption(option => option.setName("amount").setDescription("Amount to send").setRequired(true))
    .addStringOption(option => 
      option.setName("token")
        .setDescription("Token to send")
        .setRequired(true)
        .addChoices(...getTokenChoices())
    ),
  async execute(interaction) {
    // Start with ephemeral reply for error handling
    await interaction.deferReply({ flags: 64 }); // 64 = EPHEMERAL flag

    const senderDiscordId = interaction.user.id;
    const recipientUser = interaction.options.getUser("recipient");
    const amount = interaction.options.getNumber("amount");
    const tokenTicker = interaction.options.getString("token");

    if (!amount || amount <= 0) {
      return interaction.editReply("Enter a valid amount greater than 0.");
    }

    if (recipientUser.id === senderDiscordId) {
      return interaction.editReply("You cannot tip yourself.");
    }

    const senderWalletDoc = await Wallet.findOne({ discordId: senderDiscordId });
    const recipientWalletDoc = await Wallet.findOne({ discordId: recipientUser.id });

    if (!senderWalletDoc) {
      return interaction.editReply("You don't have a wallet yet. Use `/createwallet`.");
    }
    if (!recipientWalletDoc) {
      return interaction.editReply(`${recipientUser.username} does not have a wallet yet.`);
    }

    try {
      const provider = new ethers.JsonRpcProvider(process.env.AVALANCHE_RPC);
      const decryptedKey = await decrypt(senderWalletDoc.privateKey);
      const signer = new ethers.Wallet(decryptedKey, provider);

      const contractAddress = getTokenAddress(tokenTicker);
      let tx;
      let gasCost;

      if (isNativeToken(tokenTicker)) {
        // Handle native AVAX transfer
        const amountWei = ethers.parseEther(amount.toString());

        // Get gas price
        const feeData = await provider.getFeeData();
        if (!feeData.gasPrice) {
          return interaction.editReply("Could not fetch gas price from provider.");
        }
        const gasPrice = feeData.gasPrice;

        // Estimate gas
        const gasEstimate = await provider.estimateGas({
          to: recipientWalletDoc.address,
          value: amountWei,
          from: senderWalletDoc.address
        });

        gasCost = gasEstimate * gasPrice;

        // Check balance
        const balance = await provider.getBalance(senderWalletDoc.address);
        if (balance < amountWei + gasCost) {
          const balHuman = ethers.formatEther(balance);
          const gasHuman = ethers.formatEther(gasCost);
          return interaction.editReply(
            `Insufficient funds. Your balance: ${balHuman} AVAX. You need ${amount} AVAX + ~${gasHuman} AVAX for gas.`
          );
        }

        // Send AVAX transaction
        tx = await signer.sendTransaction({
          to: recipientWalletDoc.address,
          value: amountWei,
          gasPrice,
          gasLimit: gasEstimate
        });

      } else {
        // Handle ERC-20 token transfer
        const tokenContract = new ethers.Contract(contractAddress, ERC20_ABI, signer);

        // Get token decimals
        const decimals = await tokenContract.decimals();
        const amountWei = ethers.parseUnits(amount.toFixed(20), decimals);

        // Check token balance
        const tokenBalance = await tokenContract.balanceOf(senderWalletDoc.address);
        if (tokenBalance < amountWei) {
          const balanceHuman = ethers.formatUnits(tokenBalance, decimals);
          return interaction.editReply(
            `Insufficient ${tokenTicker} balance. You have ${balanceHuman} ${tokenTicker}, need ${amount} ${tokenTicker}.`
          );
        }

        // Get gas price for ERC-20 transaction
        const feeData = await provider.getFeeData();
        if (!feeData.gasPrice) {
          return interaction.editReply("Could not fetch gas price from provider.");
        }
        const gasPrice = feeData.gasPrice;

        // Estimate gas for token transfer
        const gasEstimate = await tokenContract.transfer.estimateGas(recipientWalletDoc.address, amountWei);
        gasCost = gasEstimate * gasPrice;

        // Check AVAX balance for gas
        const avaxBalance = await provider.getBalance(senderWalletDoc.address);
        if (avaxBalance < gasCost) {
          const gasHuman = ethers.formatEther(gasCost);
          return interaction.editReply(
            `Insufficient AVAX for gas fees. You need ~${gasHuman} AVAX for gas.`
          );
        }

        // Send ERC-20 token transaction
        tx = await tokenContract.transfer(recipientWalletDoc.address, amountWei, {
          gasPrice,
          gasLimit: gasEstimate
        });
      }

      const displayAmount = amount.toFixed(20).replace(/\.?0+$/, '');

      // Create success embed
      const embed = new EmbedBuilder()
        .setColor(0x00ff99)
        .setDescription(`**${interaction.user.username}** tipped **${recipientUser.username}** ${displayAmount} ${tokenTicker}!`)
        .setTimestamp();

      // Send public message to channel (independent of the interaction)
      await interaction.channel.send({ embeds: [embed] });
      // Delete the ephemeral reply
      await interaction.deleteReply();

      // Log transaction in DB
      await Transaction.create({
        senderId: senderDiscordId,
        recipientId: recipientUser.id,
        amount: amount.toString(),
        token: tokenTicker,
        txHash: tx.hash
      });

    } catch (err) {
      console.error("Tip failed:", err);
      return interaction.editReply(
        `❌ Transaction failed: ${err.reason || err.message || "Unknown error"}`
      );
    }
  },
};