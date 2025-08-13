import { SlashCommandBuilder } from "discord.js";
import Wallet from "../database/models/wallet.js";
import { ethers } from "ethers";
import { encrypt } from "../utils/encryption.js";

export default {
  data: new SlashCommandBuilder()
    .setName("createwallet")
    .setDescription("Create a custodial wallet linked to your Discord ID"),

  async execute(interaction) {
    const existingWallet = await Wallet.findOne({ discordId: interaction.user.id });
    if (existingWallet) {
      return interaction.reply({
        content: `You already have a wallet: \`${existingWallet.address}\``,
        ephemeral: true
      });
    }

    const wallet = ethers.Wallet.createRandom();
    const newWallet = new Wallet({
      discordId: interaction.user.id,
      address: wallet.address,
      privateKey: encrypt(wallet.privateKey)
    });

    await newWallet.save();

    await interaction.reply({
      content: `Wallet created! Address: \`${wallet.address}\`\n**Save this address** — the bot securely stores your private key.`,
      ephemeral: true
    });
  }
};
