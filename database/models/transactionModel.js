import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema({
  senderId: { type: String, required: true }, // Discord ID
  recipientId: { type: String, required: true }, // Discord ID
  token: { type: String, default: "AVAX" }, // Default to AVAX, can be extended for other tokens
  amount: { type: String, required: true }, // Stored in ETH units as string
  txHash: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

export default mongoose.model("Transaction", transactionSchema);
