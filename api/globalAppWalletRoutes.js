// api/globalAppWalletRoutes.js
import dotenv from "dotenv";

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

import express from "express";
import { GlobalAppWalletService } from "../services/globalAppWalletService.js";
import { ethers } from "ethers";
import { requireAppId } from "../middleware/validateGuildAccess.js";

const router = express.Router();
const provider = new ethers.JsonRpcProvider(process.env.AVALANCHE_RPC);
console.log("AVALANCHE_RPC from env:", process.env.AVALANCHE_RPC);

const globalWalletService = new GlobalAppWalletService(provider);

// POST /api/globalwallet/create
// Create or replace a global app wallet
router.post("/create", requireAppId, async (req, res) => {
  try {
    const appId = req.query.appId || req.body?.appId;
    const { appName, forceReplace } = req.body;

    if (!appName) {
      return res.status(400).json({ success: false, error: "MISSING_APP_NAME" });
    }

    const result = await globalWalletService.createOrReplaceWallet(
      appId,
      appName,
      forceReplace || false
    );

    if (!result.success) {
      if (result.error === "WALLET_ALREADY_EXISTS") {
        return res.status(400).json(result);
      }
      return res.status(500).json(result);
    }

    res.json(result);
  } catch (err) {
    console.error("Error creating global wallet:", err);
    res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});

// GET /api/globalwallet/info
// Get global wallet info (address, appName, etc.)
router.get("/info", requireAppId, async (req, res) => {
  try {
    const appId = req.query.appId;

    const wallet = await globalWalletService.getGlobalWallet(appId);

    if (!wallet) {
      return res.status(404).json({ success: false, error: "NO_WALLET" });
    }

    // Return wallet info without private key
    res.json({
      success: true,
      wallet: {
        appId: wallet.appId,
        appName: wallet.appName,
        address: wallet.address,
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt
      }
    });
  } catch (err) {
    console.error("Error getting global wallet info:", err);
    res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});

// GET /api/globalwallet/privatekey
// Get decrypted private key (SECURITY SENSITIVE - only for dev/admin use)
router.get("/privatekey", requireAppId, async (req, res) => {
  try {
    const appId = req.query.appId;

    const result = await globalWalletService.getDecryptedPrivateKey(appId);

    if (!result.success) {
      if (result.error === "NO_WALLET") {
        return res.status(404).json(result);
      }
      return res.status(500).json(result);
    }

    res.json(result);
  } catch (err) {
    console.error("Error getting private key:", err);
    res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});

// GET /api/globalwallet/balance/:ticker
// Get balance for a single token
router.get("/balance/:ticker", requireAppId, async (req, res) => {
  try {
    const appId = req.query.appId;
    const { ticker } = req.params;

    const result = await globalWalletService.getBalance(appId, ticker.toUpperCase());

    if (!result.success) {
      if (result.error === "NO_WALLET") return res.status(404).json(result);
      if (result.error === "UNKNOWN_TOKEN") return res.status(400).json(result);
      if (result.error === "NETWORK_ERROR") return res.status(503).json(result);
      return res.status(500).json({ success: false, error: "SERVER_ERROR" });
    }

    return res.json(result);
  } catch (err) {
    console.error("Get global wallet balance error:", err);
    return res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});

// GET /api/globalwallet/balances
// Get all token balances
router.get("/balances", requireAppId, async (req, res) => {
  try {
    const appId = req.query.appId;
    const includeZeros = String(req.query.includeZeros || "false") === "true";

    const result = await globalWalletService.getAllBalances(appId, { includeZeros });

    if (!result.success) {
      if (result.error === "NO_WALLET") return res.status(404).json(result);
      if (result.error === "NETWORK_ERROR") return res.status(503).json(result);
      return res.status(500).json({ success: false, error: "SERVER_ERROR" });
    }

    return res.json(result);
  } catch (err) {
    console.error("Get global wallet balances error:", err);
    return res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});

// POST /api/globalwallet/transfer
// Transfer tokens from global wallet to recipient
router.post("/transfer", requireAppId, async (req, res) => {
  try {
    const appId = req.query.appId || req.body?.appId;
    const { toAddress, ticker, amount } = req.body;

    if (!toAddress || !ticker || !amount) {
      return res.status(400).json({ success: false, error: "MISSING_PARAMS" });
    }

    const result = await globalWalletService.transfer(appId, toAddress, ticker, amount);

    if (!result.success) {
      if (result.error === "NO_WALLET") return res.status(404).json(result);
      if (result.error === "UNKNOWN_TOKEN") return res.status(400).json(result);
      if (result.error === "INSUFFICIENT_FUNDS") return res.status(400).json(result);
      if (result.error === "INSUFFICIENT_GAS") return res.status(400).json(result);
      if (result.error === "NETWORK_ERROR") return res.status(503).json(result);
      return res.status(500).json({ success: false, error: "SERVER_ERROR" });
    }

    return res.json(result);
  } catch (err) {
    console.error("Global wallet transfer error:", err);
    return res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});

export default router;
