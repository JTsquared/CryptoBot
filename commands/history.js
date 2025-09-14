import { SlashCommandBuilder } from "discord.js";
import Transaction from "../database/models/transactionModel.js";
import Wallet from "../database/models/wallet.js";

export default {
  data: new SlashCommandBuilder()
    .setName("history")
    .setDescription("View your recent tips")
    .addStringOption(option => option.setName("type")
      .setDescription("sent or received")
      .addChoices(
        { name: "sent", value: "sent" },
        { name: "received", value: "received" }
      )
    ),
  async execute(interaction) {
    const type = interaction.options.getString("type") || "sent";
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
