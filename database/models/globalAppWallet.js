import mongoose from "mongoose";

const globalAppWalletSchema = new mongoose.Schema(
  {
    appId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    appName: {
      type: String,
      required: true,
    },
    address: {
      type: String,
      required: true,
    },
    privateKey: {
      type: String,
      required: true, // Encrypted using encryption.js
    },
  },
  { timestamps: true }
);

const GlobalAppWallet = mongoose.model("GlobalAppWallet", globalAppWalletSchema);

export default GlobalAppWallet;
