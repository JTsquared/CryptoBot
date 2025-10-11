import mongoose from "mongoose";

const EscrowSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  appId: { type: String, required: false }, // Bot application ID for multi-bot support
  discordId: { type: String, required: true },
  token: { type: String, required: true }, // Token ticker or NFT collection name
  amount: { type: String }, // Token amount (not required for NFTs)

  // NFT-specific fields
  isNFT: { type: Boolean, default: false },
  contractAddress: { type: String }, // NFT contract address
  tokenId: { type: String }, // NFT token ID
  nftName: { type: String }, // Cached NFT name
  nftImageUrl: { type: String }, // Cached NFT image URL

  createdAt: { type: Date, default: Date.now },
  claimed: { type: Boolean, default: false },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }, // Optional metadata (e.g., bountyId, isBounty)
});

// Index for efficient querying by guild+app combination
EscrowSchema.index({ guildId: 1, appId: 1, claimed: 1 });

export default mongoose.model("PrizeEscrow", EscrowSchema);
