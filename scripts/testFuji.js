import mongoose from "mongoose";
import dotenv from "dotenv";
import Wallet from "../database/models/wallet.js";
import { ethers } from "ethers";
import { decrypt } from "../utils/encryption.js"; // where your encrypt/decrypt functions live

dotenv.config();

(async () => {
  try {
    // 1. Connect to DB
    await mongoose.connect(process.env.MONGO_URI);

    // 2. Fetch your wallet from DB
    const myWalletDoc = await Wallet.findOne({ discordId: "YOUR_DISCORD_ID" });
    if (!myWalletDoc) {
      console.error("No wallet found for this user.");
      process.exit(1);
    }

    // 3. Decrypt private key
    const pk = decrypt(myWalletDoc.privateKey);

    // 4. Connect to Fuji RPC
    const provider = new ethers.JsonRpcProvider(process.env.AVALANCHE_RPC);
    const wallet = new ethers.Wallet(pk, provider);

    console.log("Wallet Address:", wallet.address);
    console.log("Balance:", ethers.formatEther(await wallet.getBalance()), "AVAX");

    // 5. Send tip to another wallet
    const recipient = "RECIPIENT_WALLET_ADDRESS"; // replace with friend's address
    const tx = await wallet.sendTransaction({
      to: recipient,
      value: ethers.parseEther("0.01") // 0.01 AVAX
    });

    console.log("Transaction sent:", tx.hash);
    await tx.wait();
    console.log("Transaction confirmed.");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
