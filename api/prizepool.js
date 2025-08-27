// prizepool.js (API route)

import express from "express";
const router = express.Router();

// Fake "database" for demo purposes
const wallets = {}; // { guildId: { walletId, address } }

// POST /prizepool/create
router.post("/create", async (req, res) => {
  const { guildId } = req.body;

  // Check if wallet already exists
  if (wallets[guildId]) {
    return res.json({
      success: false,
      error: "WALLET_ALREADY_EXISTS",
      walletId: wallets[guildId].walletId,
      address: wallets[guildId].address,
    });
  }

  // Otherwise, create a new wallet
  const newWallet = {
    walletId: Math.random().toString(36).substring(2, 10),
    address: "0x" + (Math.random().toString(16).substring(2, 10) + "deadbeef"),
  };
  wallets[guildId] = newWallet;

  return res.json({
    success: true,
    walletId: newWallet.walletId,
    address: newWallet.address,
  });
});

// GET /prizepool/balance
router.get("/balance/:guildId", async (req, res) => {
  const { guildId } = req.params;

  if (!wallets[guildId]) {
    return res.json({
      success: false,
      error: "NO_WALLET_FOUND",
    });
  }

  // Normally here you'd fetch balances from blockchain
  const balances = {
    ETH: "0.5",
    USDC: "120.0",
    DAI: "55.4",
  };

  return res.json({
    success: true,
    walletId: wallets[guildId].walletId,
    address: wallets[guildId].address,
    balances,
  });
});

export default router;
