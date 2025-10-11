// api/prizePoolRoutes.js
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
import { PrizePoolService } from "../services/prizePoolService.js";
import PrizeEscrow from "../database/models/prizeEscrow.js";
import NFTInventory from "../database/models/nftInventory.js";
import { ethers } from "ethers";
import Wallet from "../database/models/wallet.js";
import { requireGuildAccess } from "../middleware/validateGuildAccess.js";

const router = express.Router();
const provider = new ethers.JsonRpcProvider(process.env.AVALANCHE_RPC);
console.log("AVALANCHE_RPC from env:", process.env.AVALANCHE_RPC);

const prizePoolService = new PrizePoolService(provider);

//create wallet
router.post("/create/:guildId", requireGuildAccess, async (req, res) => {
  try {
    const { guildId } = req.params;
    const appId = req.query.appId || req.body?.appId || null; // Optional appId
    const result = await prizePoolService.getOrCreateWallet(guildId, appId);

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
router.get("/balances/:guildId", requireGuildAccess, async (req, res) => {
  try {
    const { guildId } = req.params;
    const appId = req.query.appId || null; // Optional appId
    const includeZeros = String(req.query.includeZeros || "false") === "true";

    const out = await prizePoolService.getAllBalances(guildId, appId, { includeZeros });
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
router.get("/balance/:guildId/:ticker", requireGuildAccess, async (req, res) => {
  try {
    const { guildId, ticker } = req.params;
    const appId = req.query.appId || null; // Optional appId
    const out = await prizePoolService.getBalance(guildId, appId, ticker.toUpperCase());
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
router.post("/donate/:guildId", requireGuildAccess, async (req, res) => {
  try {
    const { guildId } = req.params;
    const appId = req.query.appId || req.body?.appId || null; // Optional appId
    const { senderDiscordId, amount, ticker } = req.body;

    if (!senderDiscordId || !amount || !ticker) {
      return res.status(400).json({ success: false, error: "MISSING_PARAMS" });
    }

    const out = await prizePoolService.donateToPool(guildId, appId, senderDiscordId, amount, ticker);

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
router.post("/payout/:guildId", requireGuildAccess, async (req, res) => {
  try {
    const { guildId } = req.params;
    const appId = req.query.appId || req.body?.appId || null; // Optional appId
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

    const out = await prizePoolService.payout(guildId, appId, recipientDiscordId, toAddress, ticker, amount);

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
router.post("/escrow/claim/:guildId", requireGuildAccess, async (req, res) => {
  try {
    const { guildId } = req.params;
    const appId = req.query.appId || req.body?.appId || null; // Optional appId
    const { discordId } = req.body;

    console.log("Claiming escrow for guildId:", guildId, "appId:", appId, "discordId:", discordId);

    if (!discordId) {
      return res.status(400).json({ success: false, error: "Missing discordId" });
    }

    const result = await prizePoolService.claimEscrow(guildId, appId, discordId);
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

router.post("/escrow/create/:guildId", requireGuildAccess, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { discordId, token, amount, isNFT, contractAddress, tokenId, nftName, nftImageUrl } = req.body;
    console.log("Creating escrow entry for guildId:", guildId, "discordId:", discordId, "token:", token, "amount:", amount, "isNFT:", isNFT);

    // For NFTs, create escrow directly with NFT fields
    if (isNFT) {
      if (!discordId || !token || !contractAddress || !tokenId) {
        return res.status(400).json({ success: false, error: "MISSING_NFT_FIELDS" });
      }

      const nftEscrow = await PrizeEscrow.create({
        guildId,
        discordId,
        token, // NFT collection name
        amount: "1", // NFTs are quantity 1
        isNFT: true,
        contractAddress,
        tokenId,
        nftName: nftName || null,
        nftImageUrl: nftImageUrl || null,
        claimed: false
      });

      console.log("Created NFT escrow entry:", nftEscrow);
      return res.json({
        success: true,
        entriesCreated: 1,
        message: 'Created NFT escrow entry'
      });
    }

    // For tokens, use existing logic
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

// POST /api/prizepool/developer-payment/:guildId
router.post("/developer-payment/:guildId", requireGuildAccess, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { senderDiscordId, amount, ticker } = req.body;

    console.log("Developer payment request for guildId:", guildId, "sender:", senderDiscordId, "amount:", amount, "ticker:", ticker);

    if (!senderDiscordId || !amount || !ticker) {
      return res.status(400).json({ success: false, error: "MISSING_PARAMS" });
    }

    // Get developer wallet from environment (secure - not from request)
    const developerWallet = process.env.DEVELOPER_WALLET;

    if (!developerWallet) {
      console.error("DEVELOPER_WALLET not configured in environment");
      return res.status(500).json({ success: false, error: "DEVELOPER_WALLET_NOT_CONFIGURED" });
    }

    const result = await prizePoolService.payDeveloper(
      senderDiscordId,
      amount,
      ticker,
      developerWallet
    );

    if (!result.success) {
      if (result.error === "NO_SENDER_WALLET") return res.status(404).json(result);
      if (result.error === "INSUFFICIENT_FUNDS") return res.status(400).json(result);
      if (result.error === "INSUFFICIENT_GAS") return res.status(400).json(result);
      if (result.error === "UNKNOWN_TOKEN") return res.status(400).json(result);
      if (result.error === "NETWORK_ERROR") return res.status(503).json(result);
      return res.status(500).json({ success: false, error: "SERVER_ERROR" });
    }

    console.log(`Successfully paid developer ${amount} ${ticker}`);
    return res.json(result);
  } catch (err) {
    console.error("Developer payment route error:", err);
    return res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});

// =====================
// NFT-specific endpoints
// =====================

// POST /api/prizepool/donate-nft/:guildId
router.post("/donate-nft/:guildId", requireGuildAccess, async (req, res) => {
  try {
    const { guildId } = req.params;
    const appId = req.query.appId || req.body?.appId || null; // Optional appId
    const { senderDiscordId, collection, tokenId } = req.body;

    if (!senderDiscordId || !collection || !tokenId) {
      return res.status(400).json({ success: false, error: "MISSING_PARAMS" });
    }

    const result = await prizePoolService.donateNFT(guildId, appId, senderDiscordId, collection, tokenId);

    if (!result.success) {
      if (result.error === "NO_WALLET") return res.status(404).json(result);
      if (result.error === "NO_SENDER_WALLET") return res.status(404).json(result);
      if (result.error === "UNKNOWN_NFT_COLLECTION") return res.status(400).json(result);
      if (result.error === "NOT_NFT_OWNER") return res.status(403).json(result);
      if (result.error === "INSUFFICIENT_GAS") return res.status(400).json(result);
      if (result.error === "NETWORK_ERROR") return res.status(503).json(result);
      return res.status(500).json(result);
    }

    // Add NFT to inventory
    try {
      // Fetch NFT metadata for storage
      const metadata = await prizePoolService.fetchNFTMetadata(result.contractAddress, tokenId);

      await NFTInventory.create({
        guildId: guildId,
        collection: collection,
        tokenId: tokenId,
        contractAddress: result.contractAddress,
        name: metadata.success ? metadata.name : `${collection} #${tokenId}`,
        imageUrl: metadata.success ? metadata.imageUrl : null,
        addedBy: senderDiscordId
      });

      console.log(`Added NFT ${collection} #${tokenId} to inventory`);
    } catch (inventoryErr) {
      // If it's a duplicate key error, that's fine (NFT already in inventory)
      if (inventoryErr.code !== 11000) {
        console.error('Failed to add NFT to inventory:', inventoryErr);
      }
    }

    console.log(`Successfully donated NFT ${collection} #${tokenId} to prize pool`);
    return res.json(result);
  } catch (err) {
    console.error("NFT donate route error:", err);
    return res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});

// POST /api/prizepool/payout-nft/:guildId
router.post("/payout-nft/:guildId", requireGuildAccess, async (req, res) => {
  try {
    const { guildId } = req.params;
    const appId = req.query.appId || req.body?.appId || null; // Optional appId
    let { toAddress, recipientDiscordId, collection, tokenId } = req.body;

    // If Discord ID is provided, resolve it to a wallet address
    if (recipientDiscordId && !toAddress) {
      const walletDoc = await Wallet.findOne({ discordId: recipientDiscordId });
      if (!walletDoc) {
        return res.status(404).json({ success: false, error: "NO_RECIPIENT_WALLET" });
      }
      toAddress = walletDoc.address;
    }

    if (!toAddress || !collection || !tokenId) {
      return res.status(400).json({ success: false, error: "MISSING_PARAMS" });
    }

    const result = await prizePoolService.payoutNFT(guildId, appId, recipientDiscordId, toAddress, collection, tokenId);

    if (!result.success) {
      if (result.error === "NO_WALLET") return res.status(404).json(result);
      if (result.error === "UNKNOWN_NFT_COLLECTION") return res.status(400).json(result);
      if (result.error === "POOL_NOT_OWNER") return res.status(400).json(result);
      if (result.error === "INSUFFICIENT_GAS") return res.status(400).json(result);
      if (result.error === "NETWORK_ERROR") return res.status(503).json(result);
      return res.status(500).json(result);
    }

    // Remove NFT from inventory after successful payout (if it exists)
    try {
      const deleted = await NFTInventory.findOneAndDelete({
        guildId: guildId,
        collection: collection,
        tokenId: tokenId
      });
      if (deleted) {
        console.log(`Removed NFT ${collection} #${tokenId} from inventory`);
      } else {
        console.log(`NFT ${collection} #${tokenId} not in inventory (legacy escrow)`);
      }
    } catch (inventoryErr) {
      console.error('Failed to remove NFT from inventory:', inventoryErr);
      // Don't fail the payout if inventory update fails
    }

    console.log(`Successfully paid out NFT ${collection} #${tokenId} to ${toAddress}`);
    return res.json(result);
  } catch (err) {
    console.error("NFT payout route error:", err);
    return res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});

// POST /api/prizepool/withdraw-nft/:guildId
router.post("/withdraw-nft/:guildId", requireGuildAccess, async (req, res) => {
  try {
    const { guildId } = req.params;
    const appId = req.query.appId || req.body?.appId || null; // Optional appId
    let { toAddress, senderDiscordId, collection, tokenId } = req.body;

    if (!senderDiscordId || !collection || !tokenId) {
      return res.status(400).json({ success: false, error: "MISSING_PARAMS" });
    }

    // If toAddress not provided, use sender's wallet address
    if (!toAddress) {
      const walletDoc = await Wallet.findOne({ discordId: senderDiscordId });
      if (!walletDoc) {
        return res.status(404).json({ success: false, error: "NO_SENDER_WALLET" });
      }
      toAddress = walletDoc.address;
    }

    const result = await prizePoolService.withdrawNFT(senderDiscordId, toAddress, collection, tokenId, guildId, appId);

    if (!result.success) {
      if (result.error === "NO_WALLET") return res.status(404).json(result);
      if (result.error === "NO_SENDER_WALLET") return res.status(404).json(result);
      if (result.error === "UNKNOWN_NFT_COLLECTION") return res.status(400).json(result);
      if (result.error === "POOL_NOT_OWNER") return res.status(400).json(result);
      if (result.error === "INSUFFICIENT_FUNDS_FOR_FEE") return res.status(400).json(result);
      if (result.error === "INSUFFICIENT_POOL_GAS") return res.status(400).json(result);
      if (result.error === "NETWORK_ERROR") return res.status(503).json(result);
      return res.status(500).json(result);
    }

    console.log(`Successfully withdrew NFT ${collection} #${tokenId} to ${toAddress}`);
    return res.json(result);
  } catch (err) {
    console.error("NFT withdraw route error:", err);
    return res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});

// POST /api/prizepool/verify-nft/:guildId
router.post("/verify-nft/:guildId", requireGuildAccess, async (req, res) => {
  try {
    const { guildId } = req.params;
    const appId = req.query.appId || req.body?.appId || null; // Optional appId
    const { collection, tokenId } = req.body;

    if (!collection || !tokenId) {
      return res.status(400).json({ success: false, error: "MISSING_PARAMS" });
    }

    const poolWallet = await prizePoolService.getPrizePoolWallet(guildId, appId);
    if (!poolWallet) {
      return res.status(404).json({ success: false, error: "NO_WALLET" });
    }

    // Verify NFT ownership using prizePoolService
    const ownershipResult = await prizePoolService.verifyNFTOwnership(poolWallet.address, collection, tokenId);

    if (!ownershipResult.success) {
      return res.json(ownershipResult);
    }

    // Check if NFT is already escrowed (reserved for someone else)
    const escrowedNFT = await PrizeEscrow.findOne({
      guildId: guildId,
      token: collection,
      tokenId: tokenId,
      isNFT: true,
      claimed: false
    });

    if (escrowedNFT) {
      return res.json({
        success: false,
        error: "NFT_RESERVED",
        message: `${collection} #${tokenId} is already reserved for another user`
      });
    }

    return res.json(ownershipResult);
  } catch (err) {
    console.error("NFT verification route error:", err);
    return res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});

// GET /api/prizepool/nft-balances/:guildId
router.get("/nft-balances/:guildId", requireGuildAccess, async (req, res) => {
  try {
    const { guildId } = req.params;
    const appId = req.query.appId || null; // Optional appId

    const poolWallet = await prizePoolService.getPrizePoolWallet(guildId, appId);
    if (!poolWallet) {
      return res.status(404).json({ success: false, error: "NO_WALLET" });
    }

    // Get NFT balances using prizePoolService (total count per collection)
    const result = await prizePoolService.getNFTBalances(poolWallet.address);

    if (!result.success) {
      return res.json(result);
    }

    // Get escrowed NFTs for this guild
    const escrowedNFTs = await PrizeEscrow.find({
      guildId: guildId,
      isNFT: true,
      claimed: false
    }).select('token tokenId contractAddress nftName nftImageUrl');

    // Get all NFTs in inventory
    const inventoryNFTs = await NFTInventory.find({
      guildId: guildId
    }).select('collection tokenId contractAddress name imageUrl');

    // Create a Set of escrowed tokenIds for quick lookup
    const escrowedTokenIds = new Set(
      escrowedNFTs.map(e => `${e.token}:${e.tokenId}`)
    );

    // Filter available NFTs (in inventory but not escrowed)
    const availableNFTs = inventoryNFTs
      .filter(nft => !escrowedTokenIds.has(`${nft.collection}:${nft.tokenId}`))
      .map(nft => ({
        collection: nft.collection,
        tokenId: nft.tokenId,
        contractAddress: nft.contractAddress,
        name: nft.name || `${nft.collection} #${nft.tokenId}`,
        imageUrl: nft.imageUrl || null,
        available: true
      }));

    // Format escrowed NFTs for response
    const reservedNFTs = escrowedNFTs.map(escrow => ({
      collection: escrow.token,
      tokenId: escrow.tokenId,
      contractAddress: escrow.contractAddress,
      name: escrow.nftName || `${escrow.token} #${escrow.tokenId}`,
      imageUrl: escrow.nftImageUrl || null,
      reserved: true
    }));

    return res.json({
      ...result,
      availableNFTs: availableNFTs,
      reservedNFTs: reservedNFTs
    });
  } catch (err) {
    console.error("NFT balances route error:", err);
    return res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});

// Get NFT metadata (name and image)
router.post("/nft-metadata", async (req, res) => {
  try {
    const { contractAddress, tokenId } = req.body;

    if (!contractAddress || !tokenId) {
      return res.status(400).json({ success: false, error: "MISSING_PARAMETERS" });
    }

    const result = await prizePoolService.fetchNFTMetadata(contractAddress, tokenId);
    return res.json(result);
  } catch (err) {
    console.error("NFT metadata route error:", err);
    return res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});

export default router;
