import mongoose from "mongoose";

const withdrawAttemptSchema = new mongoose.Schema({
    discordId: { type: String, required: true },
    userAddress: { type: String, required: true },
    destinationAddress: { type: String, required: true },
    tokenTicker: { type: String, required: true },
    requestedAmount: { type: String, required: true },
    feeInAVAX: { type: String, required: true },
    feeInWei: { type: String, required: true },
    tokenPriceUSD: { type: String, required: true },
    avaxPriceUSD: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'fee_collected_pending_withdraw', 'completed', 'fee_collection_failed'],
      default: 'pending'
    },
    feeTransactionHash: String,
    withdrawTransactionHash: String,
    lastError: String,
    createdAt: { type: Date, default: Date.now }
  });
  
  export default mongoose.model("withdrawAttempt", withdrawAttemptSchema);