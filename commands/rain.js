import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import Wallet from "../database/models/wallet.js";
import Transaction from "../database/models/transactionModel.js";
import { ethers } from "ethers";
import { decrypt } from "../utils/encryption.js";
import { ERC20_ABI, getTokenAddress, isNativeToken } from "../utils/tokenConfig.js";
import { getTokenMap, getTokenChoices } from "../utils/tokenConfig.js";

const TOKEN_MAP = getTokenMap();
const TOKEN_CHOICES = getTokenChoices();

export default {
  data: new SlashCommandBuilder()
    .setName("rain")
    .setDescription("Send an equally distributed amount of AVAX or tokens to a role or all members")
    .addStringOption(option =>
      option
        .setName("target")
        .setDescription("Role ID or 'all'")
        .setRequired(true)
    )
    .addNumberOption(option =>
      option
        .setName("amount")
        .setDescription("Total amount to distribute")
        .setRequired(true)
    )
    .addStringOption(option => 
      option.setName("token")
        .setDescription("Token to send")
        .setRequired(true)
        .addChoices(...TOKEN_CHOICES)
    )
    .addIntegerOption(option =>
      option
        .setName("user_count")
        .setDescription("Number of users to randomly select (optional - defaults to all eligible users)")
        .setRequired(false)
        .setMinValue(1)
    ),

  async execute(interaction) {
    // Start with ephemeral reply for error handling
    await interaction.deferReply({ flags: 64 }); // 64 = EPHEMERAL flag

    const senderDiscordId = interaction.user.id;
    const target = interaction.options.getString("target");
    const totalAmount = interaction.options.getNumber("amount");
    const tokenTicker = interaction.options.getString("token");
    const userCount = interaction.options.getInteger("user_count"); // This will be null if not provided

    if (!totalAmount || totalAmount <= 0) {
      return interaction.editReply("Enter a valid amount greater than 0.");
    }

    const senderWalletDoc = await Wallet.findOne({ discordId: senderDiscordId });
    if (!senderWalletDoc) {
      return interaction.editReply("You don't have a wallet yet. Use `/createwallet`.");
    }

    await interaction.guild.members.fetch();

    let members;
    let targetName; // Store the target name for display
    
    if (target.toLowerCase() === "all") {
      members = interaction.guild.members.cache.filter(
        m => !m.user.bot && m.id !== senderDiscordId
      );
      targetName = "everyone";
    } else {
      let role;
      if (/^<@&\d+>$/.test(target)) {
        const roleId = target.replace(/[<@&>]/g, "");
        role = interaction.guild.roles.cache.get(roleId);
      } else if (/^\d+$/.test(target)) {
        role = interaction.guild.roles.cache.get(target);
      } else {
        role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === target.toLowerCase());
      }
      
      if (!role) {
        return interaction.editReply(`Role not found: \`${target}\``);
      }
      
      targetName = role.name; // Store the role name
      members = role.members.filter(m => !m.user.bot && m.id !== senderDiscordId);
    }

    if (members.size === 0) {
      return interaction.editReply("No eligible members found to rain on.");
    }

    // 🔹 Filter to only members with wallets
    const eligibleMembers = [];
    for (const [id, member] of members) {
      const walletDoc = await Wallet.findOne({ discordId: id });
      if (walletDoc) {
        eligibleMembers.push({ id, member, walletDoc });
      }
    }

    if (eligibleMembers.length === 0) {
      return interaction.editReply("No eligible members with wallets found to rain on.");
    }

    // 🔹 NEW: Random selection logic
    let selectedMembers = eligibleMembers;
    let selectionInfo = "";

    if (userCount && userCount < eligibleMembers.length) {
      // Randomly select the specified number of users
      const shuffled = [...eligibleMembers].sort(() => 0.5 - Math.random());
      selectedMembers = shuffled.slice(0, userCount);
      selectionInfo = ` (randomly selected ${userCount} out of ${eligibleMembers.length} eligible users)`;
    } else if (userCount && userCount >= eligibleMembers.length) {
      // User requested more than available, use all
      selectionInfo = ` (requested ${userCount} users, but only ${eligibleMembers.length} eligible users available)`;
    }

    // Divide only among selected members
    const perUserAmount = totalAmount / selectedMembers.length;
    const perUserRounded = parseFloat(perUserAmount.toFixed(18));

    try {
      const provider = new ethers.JsonRpcProvider(process.env.AVALANCHE_RPC);
      const decryptedKey = await decrypt(senderWalletDoc.privateKey);
      const signer = new ethers.Wallet(decryptedKey, provider);

      const contractAddress = getTokenAddress(tokenTicker);
      let tokenContract;
      let decimals;
      let amountInWei;

      // Get gas price
      const feeData = await provider.getFeeData();
      if (!feeData.gasPrice) {
        return interaction.editReply("Could not fetch gas price from provider.");
      }
      const gasPrice = feeData.gasPrice;

      if (isNativeToken(tokenTicker)) {
        // Handle native AVAX
        decimals = 18;
        amountInWei = ethers.parseEther(perUserRounded.toString());

        // Check AVAX balance
        const balance = await provider.getBalance(senderWalletDoc.address);
        const gasEstimate = await provider.estimateGas({
          to: senderWalletDoc.address,
          value: amountInWei,
          from: senderWalletDoc.address,
        });

        const totalGasCost = gasEstimate * gasPrice * BigInt(selectedMembers.length);
        const totalCost = ethers.parseEther(totalAmount.toString()) + totalGasCost;

        if (balance < totalCost) {
          return interaction.editReply(
            `Insufficient funds. You need ${totalAmount} AVAX + gas for ${selectedMembers.length} transactions.`
          );
        }
      } else {
        // Handle ERC-20 token
        tokenContract = new ethers.Contract(contractAddress, ERC20_ABI, signer);
        decimals = await tokenContract.decimals();
        amountInWei = ethers.parseUnits(perUserRounded.toString(), decimals);

        // Check token balance
        const tokenBalance = await tokenContract.balanceOf(senderWalletDoc.address);
        const totalTokensNeeded = ethers.parseUnits(totalAmount.toString(), decimals);
        
        if (tokenBalance < totalTokensNeeded) {
          const balanceHuman = ethers.formatUnits(tokenBalance, decimals);
          return interaction.editReply(
            `Insufficient ${tokenTicker} balance. You have ${balanceHuman} ${tokenTicker}, need ${totalAmount} ${tokenTicker}.`
          );
        }

        // Check AVAX balance for gas fees
        const gasEstimate = await tokenContract.transfer.estimateGas(senderWalletDoc.address, amountInWei);
        const totalGasCost = gasEstimate * gasPrice * BigInt(selectedMembers.length);
        const avaxBalance = await provider.getBalance(senderWalletDoc.address);

        if (avaxBalance < totalGasCost) {
          const gasHuman = ethers.formatEther(totalGasCost);
          return interaction.editReply(
            `Insufficient AVAX for gas fees. You need ~${gasHuman} AVAX for gas.`
          );
        }
      }

      let successfulTransactions = [];
      let failedTransactions = [];

      // Get starting nonce to avoid conflicts
      let currentNonce = await provider.getTransactionCount(senderWalletDoc.address, "pending");

      for (let i = 0; i < selectedMembers.length; i++) {
        const { id, member, walletDoc } = selectedMembers[i];
        try {
          // Use incremented nonce and slightly higher gas price for each transaction
          const adjustedGasPrice = gasPrice + BigInt(i);
          let tx;

          if (isNativeToken(tokenTicker)) {
            // Send AVAX transaction
            tx = await signer.sendTransaction({
              to: walletDoc.address,
              value: amountInWei,
              gasPrice: adjustedGasPrice,
              gasLimit: await provider.estimateGas({
                to: walletDoc.address,
                value: amountInWei,
                from: senderWalletDoc.address,
              }),
              nonce: currentNonce + i,
            });
          } else {
            // Send ERC-20 token transaction
            tx = await tokenContract.transfer(walletDoc.address, amountInWei, {
              gasPrice: adjustedGasPrice,
              gasLimit: await tokenContract.transfer.estimateGas(walletDoc.address, amountInWei),
              nonce: currentNonce + i,
            });
          }

          successfulTransactions.push({ 
            user: member.user.username, 
            userId: id,
            amount: perUserRounded,
            hash: tx.hash 
          });

          await Transaction.create({
            senderId: senderDiscordId,
            recipientId: id,
            amount: perUserRounded.toString(),
            token: tokenTicker,
            txHash: tx.hash,
          });
          
          // Small delay between transactions to avoid network issues
          if (i < selectedMembers.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
          }
        } catch (err) {
          console.error(`❌ Failed to send to ${member.user.username}:`, err.message);
          failedTransactions.push({
            user: member.user.username,
            error: err.message
          });
        }
      }

      // Calculate actual total distributed (only successful transactions)
      const actualTotalDistributed = successfulTransactions.reduce((sum, t) => sum + t.amount, 0);

      // Create embed with updated description showing selection info
      const embed = new EmbedBuilder()
        .setColor(0x00ff99)
        .setTitle(`🌧️ ${interaction.user.username} made it rain ${tokenTicker} on ${targetName}!`)
        .setDescription(`**Total Distributed: ${actualTotalDistributed} ${tokenTicker}**\n**Recipients: ${successfulTransactions.length}**${selectionInfo}`)
        .setFooter({ text: `Rain command executed in ${interaction.guild.name}` })
        .setTimestamp();

      // Add each successful recipient on their own line
      if (successfulTransactions.length > 0) {
        const recipientList = successfulTransactions
          .map(t => `• **${t.user}** - ${t.amount} ${tokenTicker}`)
          .join('\n');
        
        embed.addFields({
          name: `💰 Recipients`,
          value: recipientList,
          inline: false
        });
      } else {
        // If no successful transactions, show a different message
        embed.setDescription("**No successful transactions**")
          .setColor(0xff6666);
      }

      // Send successful rain as a public message to channel (independent of the interaction)
      await interaction.channel.send({ embeds: [embed] });
      // Delete the ephemeral reply
      await interaction.deleteReply();

    } catch (err) {
      console.error("Rain failed:", err);
      return interaction.editReply(
        `Transaction failed: ${err.reason || err.message || err}`
      );
    }
  },
};