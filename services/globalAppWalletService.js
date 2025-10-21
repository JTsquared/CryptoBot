// services/globalAppWalletService.js
import GlobalAppWallet from "../database/models/globalAppWallet.js";
import { generateWallet } from "../utils/wallet.js";
import { getTokenMap, isNativeToken, ERC20_ABI } from "../utils/tokenConfig.js";
import { ethers } from "ethers";
import { encrypt, decrypt } from "../utils/encryption.js";

export class GlobalAppWalletService {
  constructor(provider) {
    this.provider = provider;
  }

  /**
   * Create or replace a global app wallet
   * @param {string} appId - Discord bot application ID
   * @param {string} appName - Human-readable app name (e.g., "ServerWars")
   * @param {boolean} forceReplace - If true, will replace existing wallet
   * @returns {Promise<{success: boolean, wallet?: Object, error?: string}>}
   */
  async createOrReplaceWallet(appId, appName, forceReplace = false) {
    try {
      const existing = await GlobalAppWallet.findOne({ appId });

      if (existing && !forceReplace) {
        return {
          success: false,
          error: "WALLET_ALREADY_EXISTS",
          wallet: existing
        };
      }

      // Generate new wallet
      const { address, pk } = generateWallet();
      const encryptedPrivateKey = await encrypt(pk);

      if (existing && forceReplace) {
        // Replace existing wallet
        existing.address = address;
        existing.privateKey = encryptedPrivateKey;
        existing.appName = appName;
        await existing.save();

        return { success: true, wallet: existing, replaced: true };
      } else {
        // Create new wallet
        const newWallet = await GlobalAppWallet.create({
          appId,
          appName,
          address,
          privateKey: encryptedPrivateKey
        });

        return { success: true, wallet: newWallet, replaced: false };
      }
    } catch (err) {
      console.error("Error creating global app wallet:", err);
      return { success: false, error: "CREATE_FAILED", detail: err.message };
    }
  }

  /**
   * Get the global app wallet for an appId
   * @param {string} appId - Discord bot application ID
   * @returns {Promise<Object|null>}
   */
  async getGlobalWallet(appId) {
    return await GlobalAppWallet.findOne({ appId });
  }

  /**
   * Get the decrypted private key for a global app wallet
   * SECURITY: Only use this in secure contexts (dev mode, admin operations)
   * @param {string} appId - Discord bot application ID
   * @returns {Promise<{success: boolean, privateKey?: string, error?: string}>}
   */
  async getDecryptedPrivateKey(appId) {
    try {
      const wallet = await this.getGlobalWallet(appId);
      if (!wallet) {
        return { success: false, error: "NO_WALLET" };
      }

      const decryptedKey = await decrypt(wallet.privateKey);
      return { success: true, privateKey: decryptedKey };
    } catch (err) {
      console.error("Error decrypting private key:", err);
      return { success: false, error: "DECRYPT_FAILED", detail: err.message };
    }
  }

  /**
   * Get balance for a single token for the global app wallet
   * @param {string} appId - Discord bot application ID
   * @param {string} ticker - Token ticker (e.g., "AVAX", "USDC")
   * @returns {Promise<{success: boolean, address?: string, balance?: Object, error?: string}>}
   */
  async getBalance(appId, ticker) {
    const wallet = await this.getGlobalWallet(appId);
    if (!wallet) {
      return { success: false, error: "NO_WALLET" };
    }

    try {
      await this.provider.getNetwork();
    } catch {
      console.error("Network error when checking provider.");
      return { success: false, error: "NETWORK_ERROR" };
    }

    const upTicker = ticker.toUpperCase();
    try {
      const balance = await this._getTokenBalanceByAddress(wallet.address, upTicker);
      return { success: true, address: wallet.address, balance };
    } catch (err) {
      if (String(err.message || "").startsWith("UNKNOWN_TOKEN")) {
        return { success: false, error: "UNKNOWN_TOKEN" };
      }
      return { success: false, error: "SERVER_ERROR" };
    }
  }

  /**
   * Get balances for all whitelisted tokens for the global app wallet
   * @param {string} appId - Discord bot application ID
   * @param {Object} options - { includeZeros: boolean }
   * @returns {Promise<{success: boolean, address?: string, balances?: Array, error?: string}>}
   */
  async getAllBalances(appId, { includeZeros = false } = {}) {
    const TOKEN_MAP = getTokenMap();
    const wallet = await this.getGlobalWallet(appId);
    if (!wallet) {
      return { success: false, error: "NO_WALLET" };
    }

    try {
      await this.provider.getNetwork();
    } catch (err) {
      console.error("Network error when checking provider:", err);
      return { success: false, error: "NETWORK_ERROR" };
    }

    const balances = [];
    for (const ticker of Object.keys(TOKEN_MAP)) {
      try {
        const b = await this._getTokenBalanceByAddress(wallet.address, ticker);
        const num = Number(b.formatted);
        const hasBalance = num > 0;

        if (includeZeros || ticker === "AVAX" || hasBalance) {
          balances.push({ ...b, hasBalance });
        }
      } catch (err) {
        console.error(`Error fetching ${ticker} balance:`, err);
      }
    }

    // Make sure AVAX is first
    balances.sort((a, b) => (a.ticker === "AVAX" ? -1 : b.ticker === "AVAX" ? 1 : 0));

    return { success: true, address: wallet.address, balances };
  }

  /**
   * Transfer tokens from global wallet to a recipient address
   * @param {string} appId - Discord bot application ID
   * @param {string} toAddress - Recipient wallet address
   * @param {string} ticker - Token ticker
   * @param {string|number} amount - Amount to send
   * @returns {Promise<{success: boolean, txHash?: string, error?: string}>}
   */
  async transfer(appId, toAddress, ticker, amount) {
    const TOKEN_MAP = getTokenMap();
    const wallet = await this.getGlobalWallet(appId);
    if (!wallet) {
      return { success: false, error: "NO_WALLET" };
    }

    try {
      const provider = this.provider;
      const decryptedKey = await decrypt(wallet.privateKey);
      const signer = new ethers.Wallet(decryptedKey, provider);

      let tx;

      if (isNativeToken(ticker)) {
        // Native token transfer (AVAX)
        const amountWei = ethers.parseEther(amount.toString());
        const feeData = await provider.getFeeData();
        if (!feeData.gasPrice) return { success: false, error: "NETWORK_ERROR" };

        const gasEstimate = await provider.estimateGas({
          to: toAddress,
          value: amountWei,
          from: wallet.address,
        });

        const gasCost = gasEstimate * feeData.gasPrice;
        const balance = await provider.getBalance(wallet.address);
        if (balance < amountWei + gasCost) {
          return { success: false, error: "INSUFFICIENT_FUNDS" };
        }

        tx = await signer.sendTransaction({
          to: toAddress,
          value: amountWei,
          gasPrice: feeData.gasPrice,
          gasLimit: gasEstimate,
        });
      } else {
        // ERC-20 token transfer
        const contractAddress = TOKEN_MAP[ticker];
        if (!contractAddress) return { success: false, error: "UNKNOWN_TOKEN" };

        const token = new ethers.Contract(contractAddress, ERC20_ABI, signer);
        const decimals = await token.decimals();
        const amountWei = ethers.parseUnits(amount.toString(), decimals);

        const balance = await token.balanceOf(wallet.address);
        if (balance < amountWei) {
          return { success: false, error: "INSUFFICIENT_FUNDS" };
        }

        const feeData = await provider.getFeeData();
        if (!feeData.gasPrice) return { success: false, error: "NETWORK_ERROR" };

        const gasEstimate = await token.transfer.estimateGas(toAddress, amountWei);
        const gasCost = gasEstimate * feeData.gasPrice;

        const avaxBalance = await provider.getBalance(wallet.address);
        if (avaxBalance < gasCost) {
          return { success: false, error: "INSUFFICIENT_GAS" };
        }

        tx = await token.transfer(toAddress, amountWei, {
          gasPrice: feeData.gasPrice,
          gasLimit: gasEstimate,
        });
      }

      await tx.wait();

      return {
        success: true,
        txHash: tx.hash,
        amount,
        ticker,
        recipientAddress: toAddress,
      };
    } catch (err) {
      console.error("Global wallet transfer error:", err);
      return { success: false, error: "TX_FAILED", detail: err.message };
    }
  }

  // ===== PRIVATE HELPER METHODS =====

  async _getTokenBalanceByAddress(address, ticker) {
    if (isNativeToken(ticker)) {
      const raw = await this.provider.getBalance(address);
      return {
        ticker,
        raw: raw.toString(),
        decimals: 18,
        formatted: ethers.formatEther(raw),
      };
    }

    const TOKEN_MAP = getTokenMap();
    const contractAddress = TOKEN_MAP[ticker];
    if (!contractAddress) {
      console.error(`Unknown token ticker: ${ticker}`);
      throw new Error(`UNKNOWN_TOKEN:${ticker}`);
    }

    const token = new ethers.Contract(contractAddress, ERC20_ABI, this.provider);
    const [raw, decimalsBn] = await Promise.all([
      token.balanceOf(address),
      token.decimals(),
    ]);

    const decimals = Number(decimalsBn);

    return {
      ticker,
      raw: raw.toString(),
      decimals,
      formatted: ethers.formatUnits(raw, decimals),
    };
  }
}
