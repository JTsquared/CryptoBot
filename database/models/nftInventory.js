// database/models/nftInventory.js
import mongoose from 'mongoose';

const NFTInventorySchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  collection: { type: String, required: true }, // e.g. "OBEEZ"
  tokenId: { type: String, required: true },
  contractAddress: { type: String, required: true },
  name: { type: String },
  imageUrl: { type: String },
  addedAt: { type: Date, default: Date.now },
  addedBy: { type: String }, // Discord ID of donor
});

// Compound index to ensure we don't add the same NFT twice
NFTInventorySchema.index({ guildId: 1, collection: 1, tokenId: 1 }, { unique: true });

const NFTInventory = mongoose.model('NFTInventory', NFTInventorySchema);

export default NFTInventory;
