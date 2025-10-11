
import mongoose from "mongoose";

const prizePoolWalletSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  appId: { type: String, required: true, index: true }, // Discord bot application ID
  address: { type: String, required: true },
  privateKey: { type: String, required: true },
}, { timestamps: true });

// Compound unique index: one prize pool per guild + bot combination
prizePoolWalletSchema.index({ guildId: 1, appId: 1 }, { unique: true });

export default mongoose.model("PrizePoolWallet", prizePoolWalletSchema);



// import mongoose from "mongoose";

// const prizePoolWalletSchema = new mongoose.Schema({
//   guildId: { type: String, required: true, unique: true },
//   address: { type: String, required: true },
//   privateKey: { type: String, required: true },
// }, { timestamps: true });

// //export default mongoose.model("PrizePoolWallet", prizePoolWalletSchema);
// export default prizePoolWalletSchema;


// prizePoolWallet.js



// import mongoose from "mongoose";

// const prizePoolWalletSchema = new mongoose.Schema({
//   guildId: { type: String, required: true, unique: true },
//   address: { type: String, required: true },
//   privateKey: { type: String, required: true },
// }, { timestamps: true });

// const PrizePoolWallet = mongoose.model("PrizePoolWallet", prizePoolWalletSchema);

// export { prizePoolWalletSchema, PrizePoolWallet };
