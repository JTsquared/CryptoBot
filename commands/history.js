import { SlashCommandBuilder } from "discord.js";
import Transaction from "../database/models/transactionModel.js";
import Wallet from "../database/models/wallet.js";
import WithdrawAttempt from "../database/models/withdrawAttempt.js";
import { fetchDeposits } from "../utils/depositTracker.js";

export default {
  data: new SlashCommandBuilder()
    .setName("history")
    .setDescription("View your recent tips, deposits, or withdrawals")
    .addStringOption(option => option.setName("type")
      .setDescription("sent, received, deposits, or withdrawals")
      .addChoices(
        { name: "sent", value: "sent" },
        { name: "received", value: "received" },
        { name: "deposits", value: "deposits" },
        { name: "withdrawals", value: "withdrawals" }
      )
    ),
  async execute(interaction) {
    const type = interaction.options.getString("type") || "sent";

    // Handle withdrawals separately
    if (type === "withdrawals") {
      const withdrawals = await WithdrawAttempt.find({
        discordId: interaction.user.id,
        status: "completed"
      }).sort({ createdAt: -1 }).limit(5);

      if (!withdrawals.length) {
        return interaction.reply({ content: "No completed withdrawals found.", ephemeral: true });
      }

      const lines = withdrawals.map(w => {
        const shortDest = `${w.destinationAddress.slice(0, 6)}...${w.destinationAddress.slice(-4)}`;
        return `⬆️ ${w.requestedAmount} ${w.tokenTicker} to ${shortDest} - TX: \`${w.withdrawTransactionHash}\``;
      });

      return interaction.reply({ content: `**Last withdrawals:**\n${lines.join("\n")}`, ephemeral: true });
    }

    // Handle deposits separately
    if (type === "deposits") {
      await interaction.deferReply({ ephemeral: true });

      const wallet = await Wallet.findOne({ discordId: interaction.user.id });
      if (!wallet) {
        return interaction.editReply("You don't have a wallet yet. Use `/createwallet`.");
      }

      try {
        // Fetch deposits using Snowtrace API (fast, no need to scan blocks)
        const deposits = await fetchDeposits(wallet.address);

        if (!deposits.length) {
          return interaction.editReply("No deposits found.");
        }

        const lines = deposits.slice(0, 5).map(dep => {
          const shortFrom = `${dep.from.slice(0, 6)}...${dep.from.slice(-4)}`;
          return `⬇️ ${dep.amount} ${dep.token} from ${shortFrom} - TX: \`${dep.txHash}\``;
        });

        return interaction.editReply({ content: `**Last deposits:**\n${lines.join("\n")}` });
      } catch (err) {
        console.error("Error fetching deposits:", err);
        return interaction.editReply("Failed to fetch deposits. Please try again later.");
      }
    }

    // Handle sent/received tips (existing logic)
    let filter = {};

    if (type === "sent") {
      filter.senderId = interaction.user.id;
    } else {
      filter.recipientId = interaction.user.id;
    }

    const transactions = await Transaction.find(filter).sort({ timestamp: -1 }).limit(5);

    if (!transactions.length) {
      return interaction.reply({ content: `No ${type} transactions found.`, ephemeral: true });
    }

    const lines = await Promise.all(transactions.map(async (tx) => {
      const otherId = type === "sent" ? tx.recipientId : tx.senderId;
      const tokenTicker = tx.token && tx.token !== "" ? tx.token : "AVAX";
      return `${type === "sent" ? "➡️" : "⬅️"} ${tx.amount} ${tokenTicker} with <@${otherId}> - TX: \`${tx.txHash}\``;
    }));

    return interaction.reply({ content: `**Last ${type} tips:**\n${lines.join("\n")}`, ephemeral: true });
  },
};
