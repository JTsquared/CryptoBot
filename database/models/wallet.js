import mongoose from "mongoose";

const walletSchema = new mongoose.Schema({
  discordId: { type: String, unique: true, required: true },
  address: { type: String, required: true },
  privateKey: { type: String, required: true }, // encrypted if possible
  balance: { type: String, default: "0" }
});

export default mongoose.model("Wallet", walletSchema);
