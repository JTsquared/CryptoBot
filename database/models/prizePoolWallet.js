
// import mongoose from "mongoose";

// const prizePoolWalletSchema = new mongoose.Schema({
//   guildId: { type: String, required: true, unique: true },
//   address: { type: String, required: true },
//   privateKey: { type: String, required: true },
// }, { timestamps: true });

// //export default mongoose.model("PrizePoolWallet", prizePoolWalletSchema);
// export default prizePoolWalletSchema;


// prizePoolWallet.js
import mongoose from "mongoose";

const prizePoolWalletSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  address: { type: String, required: true },
  privateKey: { type: String, required: true },
}, { timestamps: true });

const PrizePoolWallet = mongoose.model("PrizePoolWallet", prizePoolWalletSchema);

export { prizePoolWalletSchema, PrizePoolWallet };
