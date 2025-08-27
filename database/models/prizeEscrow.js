import mongoose from "mongoose";

const EscrowSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  discordId: { type: String, required: true },
  token: { type: String, required: true },
  amount: { type: String, required: true }, // store as string to avoid float precision issues
  createdAt: { type: Date, default: Date.now },
  claimed: { type: Boolean, default: false },
});

export default mongoose.model("PrizeEscrow", EscrowSchema);
