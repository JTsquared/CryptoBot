// api/prizePoolRoutes.js
import express from "express";
import { PrizePoolService } from "../services/prizePoolService.js";
import PrizeEscrow from "../database/models/prizeEscrow.js";
import { ethers } from "ethers";
import dotenv from "dotenv";
import Wallet from "../database/models/wallet.js";

// Default env file
let envFile = ".env";

// Look for --env=xxx in process args
const envArg = process.argv.find(arg => arg.startsWith("--env="));
if (envArg) {
  const file = envArg.split("=")[1];
  if (file === "test") envFile = ".env.test";
  else if (file === "prod") envFile = ".env.prod";
  else envFile = ".env"; // fallback
}

console.log(`Loading env file: ${envFile}`);
dotenv.config({ path: envFile });

const router = express.Router();
const provider = new ethers.JsonRpcProvider(process.env.AVALANCHE_RPC);
console.log("AVALANCHE_RPC from env:", process.env.AVALANCHE_RPC);

const prizePoolService = new PrizePoolService(provider);

//create wallet
router.post("/create/:guildId", async (req, res) => {
  try {
    const { guildId } = req.params;
    const result = await prizePoolService.getOrCreateWallet(guildId);

    if (!result.success) {
      if (result.error === "WALLET_ALREADY_EXISTS") {
        return res.status(400).json(result);
      }
      return res.status(500).json(result);
    }

    res.json(result);
  } catch (err) {
    console.error("Error creating wallet:", err);
    res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});

// GET /api/prizepool/balances/:guildId?includeZeros=true|false
router.get("/balances/:guildId", async (req, res) => {
  try {
    const { guildId } = req.params;
    const includeZeros = String(req.query.includeZeros || "false") === "true";

    const out = await prizePoolService.getAllBalances(guildId, { includeZeros });
    const escrowed = await PrizeEscrow.aggregate([
      { $match: { claimed: false } },
      { $group: { _id: "$token", total: { $sum: { $toDouble: "$amount" } } } }
    ]);

    if (!out.success) {
      if (out.error === "NO_WALLET") return res.status(404).json(out);
      if (out.error === "NETWORK_ERROR") return res.status(503).json(out);
      return res.status(500).json({ success: false, error: "SERVER_ERROR" });
    }

    const adjustedBalances = out.balances.map(b => {
      const reserved = escrowed.find(e => e._id === b.ticker)?.total || 0;
      return { ...b, reserved, available: Number(b.formatted) - reserved };
    });

    console.log("Adjusted balances:", adjustedBalances);
    console.log("Original balances:", out.balances);
    console.log("Escrowed amounts:", escrowed);

    return res.json({
      success: true,
      address: out.address,
      balances: adjustedBalances
    });
  } catch (err) {
    console.error("Get prize pool balances error:", err);
    return res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});

// Optional: GET /api/prizepool/balance/:guildId/:ticker  (single token)
router.get("/balance/:guildId/:ticker", async (req, res) => {
  try {
    const { guildId, ticker } = req.params;
    const out = await prizePoolService.getBalance(guildId, ticker.toUpperCase());
    const escrowed = await PrizeEscrow.aggregate([
      { $match: { claimed: false } },
      { $group: { _id: "$token", total: { $sum: { $toDouble: "$amount" } } } }
    ]);

    if (!out.success) {
      if (out.error === "NO_WALLET") return res.status(404).json(out);
      if (out.error === "UNKNOWN_TOKEN") return res.status(400).json(out);
      if (out.error === "NETWORK_ERROR") return res.status(503).json(out);
      return res.status(500).json({ success: false, error: "SERVER_ERROR" });
    }

    const adjustedBalance = out.balances.map(b => {
      const reserved = escrowed.find(e => e._id === b.ticker)?.total || 0;
      return { ...b, reserved, available: Number(b.formatted) - reserved };
    });

    return res.json(adjustedBalance);
  } catch (err) {
    console.error("Get single prize pool balance error:", err);
    return res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});

// POST /api/prizepool/donate/:guildId
router.post("/donate/:guildId", async (req, res) => {
  try {
    const { guildId } = req.params;
    const { senderDiscordId, amount, ticker } = req.body;

    if (!senderDiscordId || !amount || !ticker) {
      return res.status(400).json({ success: false, error: "MISSING_PARAMS" });
    }

    const out = await prizePoolService.donateToPool(guildId, senderDiscordId, amount, ticker);

    if (!out.success) {
      if (out.error === "NO_WALLET") return res.status(404).json(out);
      if (out.error === "NETWORK_ERROR") return res.status(503).json(out);
      if (out.error === "INSUFFICIENT_FUNDS") return res.status(400).json(out);
      return res.status(500).json({ success: false, error: "SERVER_ERROR" });
    }

    return res.json(out);
  } catch (err) {
    console.error("Prize pool donate error:", err);
    return res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});

// POST /api/prizepool/payout/:guildId
router.post("/payout/:guildId", async (req, res) => {
  try {
    const { guildId } = req.params;
    let { toAddress, recipientDiscordId, ticker, amount } = req.body;

    // If Discord ID is provided, resolve it to a wallet address
    if (recipientDiscordId && !toAddress) {
      const walletDoc = await Wallet.findOne({ discordId: recipientDiscordId });
      if (!walletDoc) {
        return res.status(404).json({ success: false, error: "NO_SENDER_WALLET" });
      }
      toAddress = walletDoc.address;
    }

    if (!toAddress) {
      return res.status(400).json({ success: false, error: "NO_ADDRESS_PROVIDED" });
    }

    const out = await prizePoolService.payout(guildId, recipientDiscordId, toAddress, ticker, amount);

    if (!out.success) {
      if (out.error === "NO_WALLET") return res.status(404).json(out);
      if (out.error === "UNKNOWN_TOKEN") return res.status(400).json(out);
      if (out.error === "NO_FUNDS") return res.status(400).json(out);
      if (out.error === "NETWORK_ERROR") return res.status(503).json(out);
      return res.status(500).json({ success: false, error: "SERVER_ERROR" });
    }

    return res.json(out);
  } catch (err) {
    console.error("Payout route error:", err);
    return res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});

//POST /api/prizepool/escrow/claim/:guildId
router.post("/escrow/claim/:guildId", async (req, res) => {
  try {
    const { guildId } = req.params;
    const { discordId } = req.body;

    console.log("Claiming escrow for guildId:", guildId, "discordId:", discordId);

    if (!discordId) {
      return res.status(400).json({ success: false, error: "Missing discordId" });
    }

    const result = await prizePoolService.claimEscrow(guildId, discordId);
    console.log("Escrow claim result:", result);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    res.json({ success: true, message: result.message, data: result.data });
  } catch (err) {
    console.error("Error in /escrow/claim:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/escrow/create/:guildId", async (req, res) => {
  try {
    const { guildId } = req.params;
    const { discordId, token, amount } = req.body;
    console.log("Creating escrow entry for guildId:", guildId, "discordId:", discordId, "token:", token, "amount:", amount);

    if (!discordId || !token || !amount) {
      return res.status(400).json({ success: false, error: "MISSING_FIELDS" });
    }

    console.log("Received escrow creation request:", { guildId, discordId, token, amount });
    // Use the service method to handle 'all' scenarios
    const result = await prizePoolService.createEscrowEntries(guildId, discordId, token, amount);
    
    console.log("Escrow creation result:", result);

    if (!result.success) {
      let statusCode = 500;
      if (result.error === "NO_WALLET" || result.error === "TOKEN_NOT_FOUND" || result.error === "NO_ELIGIBLE_TOKENS") {
        statusCode = 400;
      }
      return res.status(statusCode).json({ success: false, error: result.error });
    }

    console.log(`Successfully created ${result.entriesCreated} escrow entries.`);
    return res.json({ 
      success: true, 
      entriesCreated: result.entriesCreated,
      message: `Created ${result.entriesCreated} escrow ${result.entriesCreated === 1 ? 'entry' : 'entries'}`
    });
    
  } catch (err) {
    console.error("Error in escrow creation route:", err);
    return res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});



export default router;
