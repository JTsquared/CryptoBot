// src/prizePool/prizePool.js
// Server-scoped prize pool manager for CryptoTip.
// Requires: ethers v6, your existing Wallet model, decrypt() util, and a token registry.

import { ethers } from "ethers";
import Wallet from "../database/models/wallet.js";
import Transaction from "../database/models/Transaction.js";
import { decrypt } from "../utils/encryption.js";
// import { getSupportedTokens, getTokenBySymbol } from "../utils/tokenRegistry.js";
import { TOKEN_MAP, ERC20_ABI, isNativeToken, getTokenAddress } from "../utils/tokenConfig.js";

export function getSupportedTokens() {
  return Object.keys(TOKEN_MAP).filter(t => !isNativeToken(t));
}

export function getTokenBySymbol(symbol) {
  return TOKEN_MAP[symbol] && !isNativeToken(symbol)
    ? { symbol, address: TOKEN_MAP[symbol], decimals: 18 } // default 18 unless you want per-token
    : null;
}


const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint256 amount) returns (bool)"
];

function getProvider() {
  const rpc = process.env.AVALANCHE_RPC;
  if (!rpc) throw new Error("Missing AVALANCHE_RPC in environment");
  return new ethers.JsonRpcProvider(rpc);
}

// --- Helpers ---------------------------------------------------------------

function prizePoolDiscordId(guildId) {
  // We store prize pool wallets in the same collection as user wallets,
  // but with a deterministic "discordId" namespace.
  return `prizepool:${guildId}`;
}

async function getOrCreatePrizePoolWallet(guildId) {
  const id = prizePoolDiscordId(guildId);
  let doc = await Wallet.findOne({ discordId: id });
  if (doc) return doc;

  // If you already have a wallet-creation helper, use it. Otherwise:
  const wallet = ethers.Wallet.createRandom();
  const provider = getProvider();
  const connected = wallet.connect(provider);

  doc = await Wallet.create({
    discordId: id,
    address: connected.address,
    privateKey: encryptIfNeeded(wallet.privateKey), // If you already encrypt in model hook, you can pass raw
  });

  return doc;
}

// If your app already encrypts on write via a model hook, you can delete this and use that.
// Otherwise, import your existing encrypt() util.
import { encrypt as encryptPK } from "../utils/encryption.js";
function encryptIfNeeded(pk) { return encryptPK(pk); }

// Format human amounts
function fmt(n, decimals = 4) {
  return Number(n).toFixed(decimals);
}

// --- Balances --------------------------------------------------------------

export async function getPrizePoolBalance(guildId) {
  const provider = getProvider();
  const pool = await getOrCreatePrizePoolWallet(guildId);

  const balances = {};
  // Native AVAX
  const avaxBalWei = await provider.getBalance(pool.address);
  balances["AVAX"] = ethers.formatEther(avaxBalWei);

  // ERC-20s from your registry
  const tokens = getSupportedTokens(); // [{symbol, address, decimals}, ...]
  for (const t of tokens) {
    try {
      const erc20 = new ethers.Contract(t.address, ERC20_ABI, provider);
      const raw = await erc20.balanceOf(pool.address);
      balances[t.symbol] = ethers.formatUnits(raw, t.decimals);
    } catch (e) {
      // ignore a bad token entry rather than crashing the whole call
      console.warn(`Balance read failed for ${t.symbol}:`, e.message);
    }
  }

  return { address: pool.address, balances };
}

/**
 * Check that the prize pool has at least:
 *  - <amount> of <tokenSymbol> (ERC-20 or AVAX if you choose to allow it)
 *  - <avaxThreshold> AVAX for gas (e.g., 0.02)
 */
export async function hasSufficientFunds(guildId, tokenSymbol, amount, avaxThreshold = 0.02) {
  const { balances } = await getPrizePoolBalance(guildId);

  // Gas check
  const avax = parseFloat(balances["AVAX"] ?? "0");
  if (avax < avaxThreshold) {
    return { ok: false, reason: `Insufficient AVAX for gas. Need at least ${avaxThreshold} AVAX in the prize pool wallet.` };
  }

  // Token check
  if (tokenSymbol.toUpperCase() === "AVAX") {
    const have = avax;
    if (have < amount) {
      return { ok: false, reason: `Insufficient AVAX prize balance. Need ${amount} AVAX.` };
    }
    return { ok: true };
  }

  const haveStr = balances[tokenSymbol?.toUpperCase()];
  if (haveStr === undefined) {
    return { ok: false, reason: `Token ${tokenSymbol} is not supported by CryptoTip.` };
  }
  const have = parseFloat(haveStr);
  if (have < amount) {
    return { ok: false, reason: `Insufficient prize balance. Need ${amount} ${tokenSymbol}.` };
  }

  return { ok: true };
}

// --- Donations -------------------------------------------------------------

/**
 * Donate to the prize pool for this server from the caller's wallet.
 * Supports AVAX and ERC-20 (preferred).
 */
export async function donateToPrizePool({ guildId, donorDiscordId, tokenSymbol, amount }) {
  if (amount <= 0) throw new Error("Amount must be greater than 0.");

  const provider = getProvider();

  const donor = await Wallet.findOne({ discordId: donorDiscordId });
  if (!donor) throw new Error("You don't have a CryptoTip wallet yet. Use /createwallet first.");

  const pool = await getOrCreatePrizePoolWallet(guildId);

  const donorKey = decrypt(donor.privateKey);
  const signer = new ethers.Wallet(donorKey, provider);

  if (tokenSymbol.toUpperCase() === "AVAX") {
    const value = ethers.parseEther(amount.toString());

    // estimate native transfer
    const feeData = await provider.getFeeData();
    if (!feeData.gasPrice) throw new Error("Could not fetch gas price.");

    const gasEstimate = await provider.estimateGas({
      to: pool.address,
      value,
      from: donor.address
    });

    const gasCost = gasEstimate * feeData.gasPrice;
    const balance = await provider.getBalance(donor.address);

    if (balance < value + gasCost) {
      throw new Error(`Insufficient funds. You need ${ethers.formatEther(value + gasCost)} AVAX including gas.`);
    }

    const tx = await signer.sendTransaction({
      to: pool.address,
      value,
      gasPrice: feeData.gasPrice,
      gasLimit: gasEstimate
    });

    await tx.wait();

    await Transaction.create({
      type: "PRIZEPOOL_DONATION",
      token: "AVAX",
      senderId: donorDiscordId,
      recipientId: prizePoolDiscordId(guildId),
      amount: amount.toString(),
      txHash: tx.hash
    });

    return { hash: tx.hash };
  }

  // ERC-20 donation
  const token = getTokenBySymbol(tokenSymbol);
  if (!token) throw new Error(`Token ${tokenSymbol} is not supported.`);

  const erc20 = new ethers.Contract(token.address, ERC20_ABI, signer);
  const value = ethers.parseUnits(amount.toString(), token.decimals);

  // gas estimate for ERC-20 transfer
  const feeData = await provider.getFeeData();
  if (!feeData.gasPrice) throw new Error("Could not fetch gas price.");

  const gasEstimate = await erc20.transfer.estimateGas(pool.address, value);
  const gasCost = gasEstimate * feeData.gasPrice;

  const avaxBal = await provider.getBalance(donor.address);
  if (avaxBal < gasCost) {
    throw new Error(`Insufficient AVAX for gas. Need ~${ethers.formatEther(gasCost)} AVAX in your wallet.`);
  }

  const tx = await erc20.transfer(pool.address, value, { gasPrice: feeData.gasPrice, gasLimit: gasEstimate });
  await tx.wait();

  await Transaction.create({
    type: "PRIZEPOOL_DONATION",
    token: token.symbol,
    senderId: donorDiscordId,
    recipientId: prizePoolDiscordId(guildId),
    amount: amount.toString(),
    txHash: tx.hash
  });

  return { hash: tx.hash };
}

// --- Payout ---------------------------------------------------------------

/**
 * Payout the prize from the server's pool to the winner wallet.
 * By default: send EXACT <amount> <tokenSymbol>.
 * If you want "send ALL of tokenSymbol" behavior, set `amount = "ALL"`.
 */
export async function payoutPrize({ guildId, winnerDiscordId, tokenSymbol, amount }) {
  const provider = getProvider();
  const pool = await getOrCreatePrizePoolWallet(guildId);

  const winner = await Wallet.findOne({ discordId: winnerDiscordId });
  if (!winner) throw new Error("Winner does not have a CryptoTip wallet.");

  const poolKey = decrypt(pool.privateKey);
  const signer = new ethers.Wallet(poolKey, provider);

  if (tokenSymbol.toUpperCase() === "AVAX") {
    // Native payout
    const balance = await provider.getBalance(pool.address);
    const feeData = await provider.getFeeData();
    if (!feeData.gasPrice) throw new Error("Could not fetch gas price.");
    const wantedWei = amount === "ALL" ? balance : ethers.parseEther(amount.toString());

    const gasEstimate = await provider.estimateGas({
      to: winner.address,
      value: wantedWei,
      from: pool.address
    });
    const gasCost = gasEstimate * feeData.gasPrice;

    if (balance < wantedWei + gasCost) {
      throw new Error(`Pool doesn't have enough AVAX (including gas).`);
    }

    const tx = await signer.sendTransaction({
      to: winner.address,
      value: wantedWei,
      gasPrice: feeData.gasPrice,
      gasLimit: gasEstimate
    });
    await tx.wait();

    await Transaction.create({
      type: "PRIZEPOOL_PAYOUT",
      token: "AVAX",
      senderId: prizePoolDiscordId(guildId),
      recipientId: winnerDiscordId,
      amount: amount === "ALL" ? ethers.formatEther(wantedWei) : amount.toString(),
      txHash: tx.hash
    });

    return { hash: tx.hash };
  }

  // ERC-20 payout
  const token = getTokenBySymbol(tokenSymbol);
  if (!token) throw new Error(`Token ${tokenSymbol} is not supported.`);

  const erc20 = new ethers.Contract(token.address, ERC20_ABI, signer);

  const poolRaw = await erc20.balanceOf(pool.address);
  const poolBal = ethers.formatUnits(poolRaw, token.decimals);

  const sendAmount = amount === "ALL" ? poolBal : amount;
  const value = ethers.parseUnits(sendAmount.toString(), token.decimals);

  // ensure gas (AVAX) available in pool
  const feeData = await provider.getFeeData();
  if (!feeData.gasPrice) throw new Error("Could not fetch gas price.");
  const gasEstimate = await erc20.transfer.estimateGas(winner.address, value);
  const gasCost = gasEstimate * feeData.gasPrice;
  const avaxBal = await provider.getBalance(pool.address);
  if (avaxBal < gasCost) {
    throw new Error(`Prize pool is low on AVAX for gas. Top it up and retry.`);
  }

  const tx = await erc20.transfer(winner.address, value, { gasPrice: feeData.gasPrice, gasLimit: gasEstimate });
  await tx.wait();

  await Transaction.create({
    type: "PRIZEPOOL_PAYOUT",
    token: token.symbol,
    senderId: prizePoolDiscordId(guildId),
    recipientId: winnerDiscordId,
    amount: sendAmount.toString(),
    txHash: tx.hash
  });

  return { hash: tx.hash };
}
