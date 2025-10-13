import mongoose from "mongoose";

const withdrawAttemptSchema = new mongoose.Schema({
    discordId: { type: String, required: true },
    userAddress: { type: String, required: true },
    destinationAddress: { type: String, required: true },

    // Token fields
    tokenTicker: { type: String }, // Required for token withdraws
    requestedAmount: { type: String }, // Required for token withdraws
    tokenPriceUSD: { type: String }, // Only for token withdraws

    // NFT fields
    isNFT: { type: Boolean, default: false },
    nftCollection: { type: String }, // Required for NFT withdraws
    nftTokenId: { type: String }, // Required for NFT withdraws

    // Fee fields
    feeInAVAX: { type: String, required: true },
    feeInWei: { type: String, required: true },
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