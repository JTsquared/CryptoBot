// services/prizePoolService.js
import PrizePoolWallet from "../database/models/prizePoolWallet.js";
// import prizePoolWalletSchema from "../database/models/prizePoolWallet.js";
import { generateWallet } from "../utils/wallet.js";
import { getTokenMap, isNativeToken, ERC20_ABI, ERC721_ABI } from "../utils/tokenConfig.js";
import { getNFTMap, isNFTCollection, getNFTAddress } from "../utils/nftConfig.js";
import { ethers } from "ethers";
import { encrypt, decrypt } from "../utils/encryption.js";
import Wallet from "../database/models/wallet.js";
import PrizeEscrow from "../database/models/prizeEscrow.js";
import Transaction from "../database/models/transactionModel.js";

export class PrizePoolService {
  constructor(provider) {
    this.provider = provider;
  }

  async getOrCreateWallet(guildId, appId = null) {
    // Check if wallet already exists (with or without appId)
    let existing;
    if (appId) {
      existing = await PrizePoolWallet.findOne({ guildId, appId });
    } else {
      // Legacy: Find wallet without appId field
      existing = await PrizePoolWallet.findOne({
        guildId,
        appId: { $exists: false }
      });
    }

    if (existing) {
      return {
        success: false,
        error: "WALLET_ALREADY_EXISTS",
        wallet: existing
      };
    }

    const { address, pk } = generateWallet();
    const walletData = {
      guildId,
      address,
      privateKey: await encrypt(pk)
    };

    // Only add appId if provided (allows creating legacy wallets)
    if (appId) {
      walletData.appId = appId;
    }

    const newWallet = await PrizePoolWallet.create(walletData);
    return { success: true, wallet: newWallet };
  }

  async getPrizePoolWallet(guildId, appId = null) {
    // Smart fallback: Try with appId first, then without (legacy)
    if (appId) {
      const wallet = await PrizePoolWallet.findOne({ guildId, appId });
      if (wallet) return wallet;
    }

    // Fall back to legacy wallet (no appId field) for backwards compatibility
    return await PrizePoolWallet.findOne({
      guildId,
      appId: { $exists: false }
    });
  }
  
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

  /**
   * Get balance for a single token (by ticker) for a guild prize-pool wallet.
   * Returns { success, address, balance } or { success:false, error }
   */
  async getBalance(guildId, appId = null, ticker) {
    const wallet = await this.getPrizePoolWallet(guildId, appId);
    if (!wallet) return { success: false, error: "NO_WALLET" };

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
   * Get balances for ALL whitelisted tokens for a guild prize-pool wallet.
   * Mirrors your /balance command behavior: always include AVAX, include others if > 0 (default).
   * Options: { includeZeros:boolean } – set true to return all tickers regardless of amount.
   *
   * Returns { success, address, balances: [{ ticker, formatted, raw, decimals, hasBalance }] }
   */
  async getAllBalances(guildId, appId = null, { includeZeros = false } = {}) {
    const TOKEN_MAP = getTokenMap();
    const wallet = await this.getPrizePoolWallet(guildId, appId);
    if (!wallet) {
      return { success: false, error: "NO_WALLET" };
    }

    try {
      const net = await this.provider.getNetwork();
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
        // Log and continue so one bad token doesn’t break the entire response
        console.error(`Error fetching ${ticker} balance:`, err);
      }
    }

    // Make sure AVAX is first, keep others in insertion order
    balances.sort((a, b) => (a.ticker === "AVAX" ? -1 : b.ticker === "AVAX" ? 1 : 0));

    return { success: true, address: wallet.address, balances };
  }
  

  // async getBalance(guildId, ticker) {
  //   //const wallet = await this.getOrCreateWallet(guildId);
  //   if (isNativeToken(ticker)) {
  //     const balance = await this.provider.getBalance(wallet.address);
  //     return ethers.formatEther(balance);
  //   } else {
  //     const tokenAddress = getTokenAddress(ticker);
  //     const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
  //     const balance = await contract.balanceOf(wallet.address);
  //     const decimals = await contract.decimals();
  //     return ethers.formatUnits(balance, decimals);
  //   }
  // }

  async donateToPool(guildId, appId = null, senderDiscordId, amount, ticker) {
    const TOKEN_MAP = getTokenMap();
    const poolWallet = await this.getPrizePoolWallet(guildId, appId);
    if (!poolWallet) {
      return { success: false, error: "NO_WALLET" };
    }

    const senderWalletDoc = await Wallet.findOne({ discordId: senderDiscordId });
    if (!senderWalletDoc) {
      return { success: false, error: "NO_SENDER_WALLET" };
    }

    try {
      const provider = this.provider;
      const decryptedKey = await decrypt(senderWalletDoc.privateKey);
      const signer = new ethers.Wallet(decryptedKey, provider);

      let tx;
      console.log("isNativeToken?", ticker, isNativeToken(ticker));

      if (isNativeToken(ticker)) {
        console.log("...");
        const amountWei = ethers.parseEther(amount.toString());
        console.log("....");
        const feeData = await provider.getFeeData();
        if (!feeData.gasPrice) return { success: false, error: "NETWORK_ERROR" };

        console.log(".....");
        const gasEstimate = await provider.estimateGas({
          to: poolWallet.address,
          value: amountWei,
          from: senderWalletDoc.address,
        });

        const gasCost = gasEstimate * feeData.gasPrice;
        console.log("...6");
        const balance = await provider.getBalance(senderWalletDoc.address);
        if (balance < amountWei + gasCost) {
          return { success: false, error: "INSUFFICIENT_FUNDS" };
        }

        console.log("...7");
        tx = await signer.sendTransaction({
          to: poolWallet.address,
          value: amountWei,
          gasPrice: feeData.gasPrice,
          gasLimit: gasEstimate,
        });
      } else {
        console.log("ENV.NETWORK:", process.env.NETWORK);
console.log("Using TOKEN_MAP for DISH:", TOKEN_MAP["DISH"]);
        const contractAddress = TOKEN_MAP[ticker];
        console.log("donateToPool => ticker:", ticker, "address:", contractAddress);
        if (!contractAddress) return { success: false, error: "UNKNOWN_TOKEN" };

        console.log("...how bout now");
        const token = new ethers.Contract(contractAddress, ERC20_ABI, signer);

        console.log("token: " + token);
        console.log("decimals: " + token.decimals());
        const decimals = await token.decimals();
        console.log("parsing");
        const amountWei = ethers.parseUnits(amount.toString(), decimals);

        const balance = await token.balanceOf(senderWalletDoc.address);
        if (balance < amountWei) {
          return { success: false, error: "INSUFFICIENT_FUNDS" };
        }

        const feeData = await provider.getFeeData();
        if (!feeData.gasPrice) return { success: false, error: "NETWORK_ERROR" };

        const gasEstimate = await token.transfer.estimateGas(poolWallet.address, amountWei);
        const gasCost = gasEstimate * feeData.gasPrice;

        const avaxBalance = await provider.getBalance(senderWalletDoc.address);
        if (avaxBalance < gasCost) {
          return { success: false, error: "INSUFFICIENT_GAS" };
        }

        tx = await token.transfer(poolWallet.address, amountWei, {
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
        poolAddress: poolWallet.address,
      };
    } catch (err) {
      console.error("donateToPool error:", err);
      return { success: false, error: "TX_FAILED", detail: err.message };
    }
  }

  async payDeveloper(senderDiscordId, amount, ticker, developerAddress) {
    const TOKEN_MAP = getTokenMap();

    if (!developerAddress) {
      return { success: false, error: "NO_DEVELOPER_WALLET" };
    }

    const senderWalletDoc = await Wallet.findOne({ discordId: senderDiscordId });
    if (!senderWalletDoc) {
      return { success: false, error: "NO_SENDER_WALLET" };
    }

    try {
      const provider = this.provider;
      const decryptedKey = await decrypt(senderWalletDoc.privateKey);
      const signer = new ethers.Wallet(decryptedKey, provider);

      let tx;
      console.log("payDeveloper: isNativeToken?", ticker, isNativeToken(ticker));

      if (isNativeToken(ticker)) {
        const amountWei = ethers.parseEther(amount.toString());
        const feeData = await provider.getFeeData();
        if (!feeData.gasPrice) return { success: false, error: "NETWORK_ERROR" };

        const gasEstimate = await provider.estimateGas({
          to: developerAddress,
          value: amountWei,
          from: senderWalletDoc.address,
        });

        const gasCost = gasEstimate * feeData.gasPrice;
        const balance = await provider.getBalance(senderWalletDoc.address);
        if (balance < amountWei + gasCost) {
          return { success: false, error: "INSUFFICIENT_FUNDS" };
        }

        tx = await signer.sendTransaction({
          to: developerAddress,
          value: amountWei,
          gasPrice: feeData.gasPrice,
          gasLimit: gasEstimate,
        });
      } else {
        const contractAddress = TOKEN_MAP[ticker];
        console.log("payDeveloper => ticker:", ticker, "address:", contractAddress);
        if (!contractAddress) return { success: false, error: "UNKNOWN_TOKEN" };

        const token = new ethers.Contract(contractAddress, ERC20_ABI, signer);

        const decimals = await token.decimals();
        const amountWei = ethers.parseUnits(amount.toString(), decimals);

        const balance = await token.balanceOf(senderWalletDoc.address);
        if (balance < amountWei) {
          return { success: false, error: "INSUFFICIENT_FUNDS" };
        }

        const feeData = await provider.getFeeData();
        if (!feeData.gasPrice) return { success: false, error: "NETWORK_ERROR" };

        const gasEstimate = await token.transfer.estimateGas(developerAddress, amountWei);
        const gasCost = gasEstimate * feeData.gasPrice;

        const avaxBalance = await provider.getBalance(senderWalletDoc.address);
        if (avaxBalance < gasCost) {
          return { success: false, error: "INSUFFICIENT_GAS" };
        }

        tx = await token.transfer(developerAddress, amountWei, {
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
        developerAddress,
      };
    } catch (err) {
      console.error("payDeveloper error:", err);
      return { success: false, error: "TX_FAILED", detail: err.message };
    }
  }

// Fixed payout method with escrow claim support
async payout(guildId, appId = null, recipientDiscordId, toAddress, ticker, amount = "all", isEscrowClaim = false) {
  const TOKEN_MAP = getTokenMap();
  const poolWallet = await this.getPrizePoolWallet(guildId, appId);
  if (!poolWallet) {
    return { success: false, error: "NO_WALLET" };
  }

  try {
    const provider = this.provider;
    const decryptedKey = await decrypt(poolWallet.privateKey);
    const signer = new ethers.Wallet(decryptedKey, provider);

    // Get gas price once
    const feeData = await provider.getFeeData();
    if (!feeData || !feeData.gasPrice) {
      return { success: false, error: "NETWORK_ERROR" };
    }
    const gasPrice = feeData.gasPrice;

    console.log(`Payout requested: ${amount} ${ticker} to ${toAddress} from guild ${guildId} (escrowClaim: ${isEscrowClaim})`);
    
    // Helper function to create escrow entry with error handling
    const createEscrowEntry = async (token, amountFormatted, errorMessage) => {
      try {
        const escrowEntry = await PrizeEscrow.create({
          guildId,
          discordId: recipientDiscordId,
          token: token,
          amount: amountFormatted,
          claimed: false,
          createdAt: new Date()
        });
        
        console.log(`📦 Created escrow entry for failed ${token} transfer: ${amountFormatted}`);
        return escrowEntry;
      } catch (escrowError) {
        console.error(`Failed to create escrow entry for ${token}:`, escrowError);
        return null;
      }
    };

    // Helper: get reserved escrow in token units (as BigInt wei/units)
    const getReservedWei = async (tk, decimals) => {
      // Skip reserved calculation for escrow claims
      if (isEscrowClaim) {
        console.log(`Skipping reserved calculation for escrow claim of ${tk}`);
        return 0n;
      }
      
      const entries = await PrizeEscrow.find({ guildId, token: tk, claimed: false });
      let reserved = 0n;
      for (const e of entries) {
        try {
          reserved += ethers.parseUnits(String(e.amount), decimals);
        } catch (err) {
          console.warn(`Failed to parse escrow amount "${e.amount}" for ${tk}:`, err);
        }
      }
      return reserved;
    };

    // Helper: pool AVAX balance (used to pay gas for ERC-20 transfers)
    let poolAvaxBalance = await provider.getBalance(poolWallet.address);
    console.log(`Pool AVAX balance: ${ethers.formatEther(poolAvaxBalance)} AVAX`);
    
    // Case A: ticker === "all" -> iterate all *non-native* tokens
    if (ticker.toUpperCase() === "ALL") {
      const txs = [];
      const ops = [];

      console.log("Processing payout for all tokens except native AVAX");
      for (const t of Object.keys(TOKEN_MAP)) {
        console.log(`Checking token: ${t}`);
        if (isNativeToken(t)) continue;

        const contractAddr = TOKEN_MAP[t];
        console.log(`Token address: ${contractAddr}`);
        if (!contractAddr) continue;

        const contract = new ethers.Contract(contractAddr, ERC20_ABI, signer);
        const balance = await contract.balanceOf(poolWallet.address);
        console.log(`Balance of ${t}: ${ethers.formatUnits(balance, await contract.decimals())} (${balance} in raw units)`);
        if (!balance || balance === 0n) continue;

        const decimals = Number(await contract.decimals());
        const reserved = await getReservedWei(t, decimals);
        const available = balance - reserved;
        console.log(`Reserved in escrow: ${ethers.formatUnits(reserved, decimals)} (${reserved} in raw units)`);
        console.log(`Available for payout: ${ethers.formatUnits(available, decimals)}`);
        
        // For escrow claims, use total balance; for regular payouts, use available balance
        const usableBalance = isEscrowClaim ? balance : available;
        if (usableBalance <= 0n) continue;

        // Compute desired send amount for this token
        let amountToSend;
        if (amount === "all") {
          console.log(`Using ${isEscrowClaim ? 'total' : 'available'} amount for ${t}: ${ethers.formatUnits(usableBalance, decimals)}`);
          amountToSend = usableBalance;
        } else {
          console.log(`Parsing fixed amount: ${amount} with decimals: ${decimals}`);
          amountToSend = ethers.parseUnits(String(amount), decimals);
          if (amountToSend > usableBalance) {
            return { success: false, error: "NO_FUNDS" };
          }
        }

        // Estimate gas for this ERC20 transfer
        const gasEstimate = await contract.transfer.estimateGas(toAddress, amountToSend);
        const gasCost = gasEstimate * gasPrice;

        console.log(`Estimated gas for ${t} transfer: ${gasEstimate} at ${ethers.formatUnits(gasPrice, "gwei")} gwei = ${ethers.formatEther(gasCost)} AVAX`);
        ops.push({ token: t, contract, amountToSend, gasEstimate, gasCost, decimals });
      }

      console.log(`Prepared ${ops.length} token transfer operations.`);
      // Check total gas cost vs pool AVAX
      const totalGasCost = ops.reduce((acc, o) => acc + o.gasCost, 0n);
      if (poolAvaxBalance < totalGasCost) {
        return { success: false, error: "INSUFFICIENT_GAS" };
      }
      
      console.log(`Total estimated gas cost for all transfers: ${ethers.formatEther(totalGasCost)} AVAX`);

      // Execute ops sequentially with escrow fallback for failures
      const successfulTxs = [];
      const failedOps = [];

      for (const op of ops) {
        try {
          console.log(`Attempting to transfer ${ethers.formatUnits(op.amountToSend, op.decimals)} ${op.token} to ${toAddress}`);
          
          const tx = await op.contract.transfer(toAddress, op.amountToSend, {
            gasLimit: op.gasEstimate,
            gasPrice
          });
          
          await tx.wait();
          console.log(`✅ Successfully transferred ${op.token} - TX: ${tx.hash}`);
          
          const amountFormatted = ethers.formatUnits(op.amountToSend, op.decimals);
          
          // Log successful transaction to database
          try {
            await Transaction.create({
              senderId: poolWallet.address,
              recipientId: recipientDiscordId,
              token: op.token,
              amount: amountFormatted,
              txHash: tx.hash
            });
            console.log(`📝 Logged ${op.token} transaction to database`);
          } catch (logError) {
            console.error(`Failed to log ${op.token} transaction:`, logError);
          }
          
          successfulTxs.push({ 
            token: op.token, 
            txHash: tx.hash, 
            amount: amountFormatted 
          });
        } catch (error) {
          console.error(`❌ Failed to transfer ${op.token}:`, error);
          
          // Add failed operation to escrow instead (only for non-escrow claims)
          const amountFormatted = ethers.formatUnits(op.amountToSend, op.decimals);
          
          failedOps.push({
            token: op.token,
            amount: amountFormatted,
            error: error.message
          });
        }
      }

      // Create escrow entries for failed operations (skip for escrow claims)
      const escrowEntries = [];
      if (!isEscrowClaim) {
        for (const failedOp of failedOps) {
          const escrowEntry = await createEscrowEntry(
            failedOp.token, 
            failedOp.amount, 
            failedOp.error
          );
          if (escrowEntry) {
            escrowEntries.push(escrowEntry);
          }
        }
      }

      // Return comprehensive result - mark as failed if ANY operation failed
      const hasFailures = failedOps.length > 0;
      return { 
        success: !hasFailures,
        error: hasFailures ? "PAYOUT_FAILURE" : undefined,
        txs: successfulTxs,
        failures: failedOps,
        escrowEntries: escrowEntries,
        summary: {
          successful: successfulTxs.length,
          failed: failedOps.length,
          escrowed: escrowEntries.length
        }
      };
    }

    // Case B: specific ticker (native or ERC20)
    if (isNativeToken(ticker)) {
      // Native AVAX payout - escrow claims can use full balance
      const balance = await provider.getBalance(poolWallet.address);
      console.log(`Native AVAX balance: ${ethers.formatEther(balance)} AVAX`);
      if (balance === 0n) return { success: false, error: "NO_FUNDS" };

      try {
        if (amount === "all") {
          console.log("Payout entire AVAX balance minus gas");
          const gasEstimate = await provider.estimateGas({
            to: toAddress,
            from: poolWallet.address,
            value: balance
          });
          const gasCost = gasEstimate * gasPrice;
          console.log(`Estimated gas: ${gasEstimate} at ${ethers.formatUnits(gasPrice, "gwei")} gwei = ${ethers.formatEther(gasCost)} AVAX`);
          if (balance <= gasCost) return { success: false, error: "INSUFFICIENT_GAS" };

          const valueToSend = balance - gasCost;
          console.log(`Sending value: ${ethers.formatEther(valueToSend)} AVAX to ${toAddress}`);
          const tx = await signer.sendTransaction({
            to: toAddress,
            value: valueToSend,
            gasPrice,
            gasLimit: gasEstimate
          });
          await tx.wait();
          
          // Log successful AVAX transaction
          const amountFormatted = ethers.formatEther(valueToSend);
          try {
            await Transaction.create({
              senderId: poolWallet.address,
              recipientId: recipientDiscordId,
              token: 'AVAX',
              amount: amountFormatted,
              txHash: tx.hash
            });
            console.log(`📝 Logged AVAX transaction to database`);
          } catch (logError) {
            console.error(`Failed to log AVAX transaction:`, logError);
          }
          
          return { 
            success: true, 
            txs: [{ token: 'AVAX', txHash: tx.hash, amount: amountFormatted }],
            failures: [],
            escrowEntries: [],
            summary: {
              successful: 1,
              failed: 0,
              escrowed: 0
            }
          };
        } else {
          console.log(`Payout fixed AVAX amount: ${amount}`);
          const amountWei = ethers.parseUnits(String(amount), 18);
          const gasEstimate = await provider.estimateGas({
            to: toAddress,
            from: poolWallet.address,
            value: amountWei
          });
          const gasCost = gasEstimate * gasPrice;
          if (balance < amountWei + gasCost) return { success: false, error: "INSUFFICIENT_FUNDS" };

          console.log(`Estimated gas: ${gasEstimate} at ${ethers.formatUnits(gasPrice, "gwei")} gwei = ${ethers.formatEther(gasCost)} AVAX`);
          const tx = await signer.sendTransaction({
            to: toAddress,
            value: amountWei,
            gasPrice,
            gasLimit: gasEstimate
          });
          await tx.wait();
          
          // Log successful AVAX transaction
          try {
            await Transaction.create({
              senderId: poolWallet.address,
              recipientId: recipientDiscordId,
              token: 'AVAX',
              amount: String(amount),
              txHash: tx.hash
            });
            console.log(`📝 Logged AVAX transaction to database`);
          } catch (logError) {
            console.error(`Failed to log AVAX transaction:`, logError);
          }
          
          return { 
            success: true, 
            txs: [{ token: 'AVAX', txHash: tx.hash, amount: String(amount) }],
            failures: [],
            escrowEntries: [],
            summary: {
              successful: 1,
              failed: 0,
              escrowed: 0
            }
          };
        }
      } catch (error) {
        console.error(`❌ Failed to transfer AVAX:`, error);
        
        // Create escrow entry for failed AVAX transfer (skip for escrow claims)
        const amountFormatted = amount === "all" ? 
          ethers.formatEther(balance) : 
          String(amount);
        
        const escrowEntry = !isEscrowClaim ? await createEscrowEntry('AVAX', amountFormatted, error.message) : null;
        
        return { 
          success: false, 
          error: "PAYOUT_FAILURE", 
          txs: [],
          failures: [{ token: 'AVAX', amount: amountFormatted, error: error.message }],
          escrowEntries: escrowEntry ? [escrowEntry] : [],
          summary: {
            successful: 0,
            failed: 1,
            escrowed: escrowEntry ? 1 : 0
          }
        };
      }
    } else {
      // ERC-20 token payout
      console.log(`Payout ERC-20 token: ${ticker}`);
      const contractAddress = TOKEN_MAP[ticker];
      console.log(`Token contract address: ${contractAddress}`);
      if (!contractAddress) return { success: false, error: "UNKNOWN_TOKEN" };

      const contract = new ethers.Contract(contractAddress, ERC20_ABI, signer);
      const balance = await contract.balanceOf(poolWallet.address);
      console.log(`Token balance: ${ethers.formatUnits(balance, await contract.decimals())} (${balance} in raw units)`);
      if (!balance || balance === 0n) return { success: false, error: "NO_FUNDS" };

      const decimals = Number(await contract.decimals());
      const reserved = await getReservedWei(ticker, decimals);
      const available = balance - reserved;
      console.log(`Reserved in escrow: ${ethers.formatUnits(reserved, decimals)} (${reserved} in raw units)`);
      console.log(`Available for payout: ${ethers.formatUnits(available, decimals)}`);
      
      // For escrow claims, use total balance; for regular payouts, use available balance
      const usableBalance = isEscrowClaim ? balance : available;
      if (usableBalance <= 0n) return { success: false, error: "NO_FUNDS" };

      let amountToSend;
      if (amount === "all") {
        amountToSend = usableBalance;
        console.log(`Using ${isEscrowClaim ? 'total' : 'available'} amount: ${ethers.formatUnits(amountToSend, decimals)}`);
      } else {
        amountToSend = ethers.parseUnits(String(amount), decimals);
        console.log(`Parsed fixed amount to send: ${ethers.formatUnits(amountToSend, decimals)}`);
        if (amountToSend > usableBalance) return { success: false, error: "NO_FUNDS" };
      }

      // Estimate gas for this ERC20 transfer and make sure pool has AVAX for gas
      const gasEstimate = await contract.transfer.estimateGas(toAddress, amountToSend);
      const gasCost = gasEstimate * gasPrice;
      poolAvaxBalance = await provider.getBalance(poolWallet.address);
      if (poolAvaxBalance < gasCost) return { success: false, error: "INSUFFICIENT_GAS" };

      try {
        console.log(`Estimated gas: ${gasEstimate} at ${ethers.formatUnits(gasPrice, "gwei")} gwei = ${ethers.formatEther(gasCost)} AVAX`);
        const tx = await contract.transfer(toAddress, amountToSend, {
          gasLimit: gasEstimate,
          gasPrice
        });
        await tx.wait();

        // Log successful ERC-20 transaction
        const amountFormatted = ethers.formatUnits(amountToSend, decimals);
        try {
          await Transaction.create({
            senderId: poolWallet.address,
            recipientId: recipientDiscordId,
            token: ticker,
            amount: amountFormatted,
            txHash: tx.hash
          });
          console.log(`📝 Logged ${ticker} transaction to database`);
        } catch (logError) {
          console.error(`Failed to log ${ticker} transaction:`, logError);
        }

        console.log(`Payout successful: ${amountFormatted} ${ticker} sent to ${toAddress} in tx ${tx.hash}`);
        return {
          success: true,
          txs: [{ token: ticker, txHash: tx.hash, amount: amountFormatted }],
          failures: [],
          escrowEntries: [],
          summary: {
            successful: 1,
            failed: 0,
            escrowed: 0
          }
        };
      } catch (error) {
        console.error(`❌ Failed to transfer ${ticker}:`, error);
        
        // Create escrow entry for failed ERC-20 transfer (skip for escrow claims)
        const amountFormatted = ethers.formatUnits(amountToSend, decimals);
        const escrowEntry = !isEscrowClaim ? await createEscrowEntry(ticker, amountFormatted, error.message) : null;
        
        return { 
          success: false, 
          error: "PAYOUT_FAILURE", 
          txs: [],
          failures: [{ token: ticker, amount: amountFormatted, error: error.message }],
          escrowEntries: escrowEntry ? [escrowEntry] : [],
          summary: {
            successful: 0,
            failed: 1,
            escrowed: escrowEntry ? 1 : 0
          }
        };
      }
    }
    } catch (err) {
      console.error("payout error:", err);
      if (err.code === "NETWORK_ERROR") return { success: false, error: "NETWORK_ERROR" };
      return { success: false, error: "TX_FAILED", detail: err.message || String(err) };
    }
  }
  
  async getGuildWallet(guildId) {
    return await PrizePoolWallet.findOne({ guildId });
  }

  async getPendingClaims(guildId, appId = null, discordId) {
    const query = { guildId, discordId, claimed: false };
    if (appId) {
      query.appId = appId;
    } else {
      // Legacy: no appId field
      query.appId = { $exists: false };
    }
    return await PrizeEscrow.find(query);
  }

  async getEscrowedAmountForToken(guildId, token) {
    const pending = await PrizeEscrow.find({ guildId, token, claimed: false });
    return pending.reduce((sum, esc) => sum + BigInt(esc.amount), 0n);
  }

  async claimEscrow(guildId, appId = null, userId) {
    try {
      const wallet = await Wallet.findOne({ discordId: userId });
      if (!wallet) {
        return {
          success: false,
          error: "NO_WALLET",
        };
      }
  
      const pendingClaims = await this.getPendingClaims(guildId, appId, userId);
  
      if (!pendingClaims || pendingClaims.length === 0) {
        return {
          success: false,
          error: "NO_ESCROW",
        };
      }
  
      const successMsgs = [];
      const failMsgs = [];
  
      for (const entry of pendingClaims) {
        try {
          let payoutResult;

          // Check if this is an NFT escrow
          if (entry.isNFT) {
            // Use NFT payout for NFT escrows
            payoutResult = await this.payoutNFT(
              entry.guildId,
              appId, // Pass through appId for wallet lookup
              entry.discordId,
              wallet.address,
              entry.token, // collection
              entry.tokenId
            );

            if (payoutResult.success) {
              // Mark as claimed and save
              entry.claimed = true;
              await entry.save();
              successMsgs.push(`✅ Claimed ${entry.token} #${entry.tokenId} - TX: ${payoutResult.txHash}`);
            } else {
              failMsgs.push(
                `⚠️ Failed to claim ${entry.token} #${entry.tokenId}: ${payoutResult.error}`
              );
            }
          } else {
            // Use regular token payout for token escrows
            // Pass isEscrowClaim = true to skip reserved balance calculations
            payoutResult = await this.payout(
              entry.guildId,
              appId, // Pass through appId for wallet lookup
              entry.discordId,
              wallet.address,
              entry.token,
              entry.amount,
              true // isEscrowClaim = true
            );

            if (payoutResult.success) {
              // Mark as claimed and save
              entry.claimed = true;
              await entry.save();

              // Use the transaction info from the new response format
              if (payoutResult.txs && payoutResult.txs.length > 0) {
                const tx = payoutResult.txs[0]; // Should only be one for single claims
                successMsgs.push(`✅ Claimed ${tx.amount} ${tx.token} - TX: ${tx.txHash}`);
              } else {
                successMsgs.push(`✅ Claimed ${entry.amount} ${entry.token}`);
              }
            } else {
              failMsgs.push(
                `⚠️ Failed to claim ${entry.amount} ${entry.token}: ${payoutResult.error}`
              );
            }
          }
        } catch (err) {
          console.error("Claim payout error:", err);
          const displayName = entry.isNFT ? `${entry.token} #${entry.tokenId}` : `${entry.amount} ${entry.token}`;
          failMsgs.push(
            `⚠️ Error claiming ${displayName}. Try again later.`
          );
        }
      }
  
      return {
        success: failMsgs.length === 0,
        error: failMsgs.length > 0 ? "PARTIAL_FAILURE" : null,
        successMsgs,
        failMsgs,
        summary: {
          totalClaims: pendingClaims.length,
          successful: successMsgs.length,
          failed: failMsgs.length
        }
      };
    } catch (err) {
      console.error("Error in claimEscrow:", err);
      return {
        success: false,
        error: "NETWORK_ERROR",
        detail: err.message,
      };
    }
  }

  // Add this method to your PrizePoolService class

  async createEscrowEntries(guildId, appId = null, discordId, token, amount) {
    try {
      console.log(`🔍 [ESCROW SERVICE] Creating escrow entries - guildId: ${guildId}, appId: ${appId}, token: ${token}, amount: ${amount} (type: ${typeof amount})`);

      // Get current balances to resolve 'all' values
      const balancesResult = await this.getAllBalances(guildId, appId);
      if (!balancesResult.success) {
        return { success: false, error: balancesResult.error };
      }
  
      // Get escrowed amounts to calculate available balances
      const escrowed = await PrizeEscrow.aggregate([
        { $match: { claimed: false } },
        { $group: { _id: "$token", total: { $sum: { $toDouble: "$amount" } } } }
      ]);
  
      // Calculate adjusted balances with available amounts
      const balances = balancesResult.balances.map(b => {
        const reserved = escrowed.find(e => e._id === b.ticker)?.total || 0;
        return { ...b, reserved, available: Number(b.formatted) - reserved };
      });
      const escrowEntries = [];
  
      // Normalize both token and amount parameters to handle string/type issues
      const normalizedToken = token ? token.toString().toLowerCase() : null;
      const normalizedAmount = amount ? amount.toString().toLowerCase() : null;
  
      if (normalizedToken === "all") {
        // Multiple tokens case
        const eligibleTokens = balances.filter(b => b.available > 0 && b.ticker !== "AVAX");
        
        if (eligibleTokens.length === 0) {
          return { success: false, error: "NO_ELIGIBLE_TOKENS" };
        }
  
        for (const tokenBalance of eligibleTokens) {
          let escrowAmount;
          
          if (normalizedAmount === "all") {
            // All available of each token
            escrowAmount = tokenBalance.available.toString();
            console.log(`Using all available ${tokenBalance.ticker}: ${escrowAmount}`);
          } else if (normalizedAmount && !isNaN(parseFloat(normalizedAmount))) {
            // Fixed amount of each token
            escrowAmount = parseFloat(normalizedAmount).toString();
            console.log(`Using fixed amount ${tokenBalance.ticker}: ${escrowAmount}`);
          } else {
            console.error(`Invalid amount for ${tokenBalance.ticker}: ${amount}`);
            return { success: false, error: "INVALID_AMOUNT" };
          }
  
          escrowEntries.push({
            guildId,
            appId, // Include appId for multi-bot support
            discordId,
            token: tokenBalance.ticker,
            amount: escrowAmount
          });
        }
      } else {
        // Single token case
        const tokenBalance = balances.find(b => b.ticker === token);
        if (!tokenBalance) {
          return { success: false, error: "TOKEN_NOT_FOUND" };
        }
  
        let escrowAmount;
        if (normalizedAmount === "all") {
          // All available of this token
          escrowAmount = tokenBalance.available.toString();
          console.log(`Using all available ${token}: ${escrowAmount}`);
        } else if (normalizedAmount && !isNaN(parseFloat(normalizedAmount))) {
          // Fixed amount
          escrowAmount = parseFloat(normalizedAmount).toString();
          console.log(`Using fixed amount ${token}: ${escrowAmount}`);
        } else {
          console.error(`Invalid amount for ${token}: ${amount}`);
          return { success: false, error: "INVALID_AMOUNT" };
        }
  
        escrowEntries.push({
          guildId,
          appId, // Include appId for multi-bot support
          discordId,
          token: token,
          amount: escrowAmount
        });
      }
  
      console.log(`Creating ${escrowEntries.length} escrow entries:`, escrowEntries);
  
      // Create all escrow entries
      for (const entry of escrowEntries) {
        await PrizeEscrow.create(entry);
      }
  
      return { 
        success: true, 
        entriesCreated: escrowEntries.length,
        entries: escrowEntries 
      };
  
    } catch (err) {
      console.error("Error creating escrow entries:", err);
      return { success: false, error: "SERVER_ERROR" };
    }
  }

  // =====================
  // NFT-specific methods
  // =====================

  /**
   * Fetch NFT metadata from tokenURI
   * Returns { success, name, imageUrl } or { success: false, error }
   */
  async fetchNFTMetadata(contractAddress, tokenId) {
    try {
      const nftContract = new ethers.Contract(contractAddress, ERC721_ABI, this.provider);
      const tokenURI = await nftContract.tokenURI(tokenId);

      // Handle IPFS URLs
      let metadataURL = tokenURI;
      if (tokenURI.startsWith('ipfs://')) {
        metadataURL = tokenURI.replace('ipfs://', 'https://ipfs.io/ipfs/');
      }

      // Fetch metadata JSON
      const response = await fetch(metadataURL);
      if (!response.ok) {
        return { success: false, error: "METADATA_FETCH_FAILED" };
      }

      const metadata = await response.json();

      // Extract name and image
      let imageUrl = metadata.image || metadata.image_url || '';
      if (imageUrl.startsWith('ipfs://')) {
        imageUrl = imageUrl.replace('ipfs://', 'https://ipfs.io/ipfs/');
      }

      return {
        success: true,
        name: metadata.name || `NFT #${tokenId}`,
        imageUrl: imageUrl
      };
    } catch (err) {
      console.error('Error fetching NFT metadata:', err);
      return {
        success: false,
        error: "METADATA_ERROR",
        detail: err.message
      };
    }
  }

  /**
   * Donate NFT from user wallet to prize pool wallet
   * Handles approval automatically
   */
  async donateNFT(guildId, appId = null, senderDiscordId, collection, tokenId) {
    const NFT_MAP = getNFTMap();
    const poolWallet = await this.getPrizePoolWallet(guildId, appId);
    if (!poolWallet) {
      return { success: false, error: "NO_WALLET" };
    }

    const senderWalletDoc = await Wallet.findOne({ discordId: senderDiscordId });
    if (!senderWalletDoc) {
      return { success: false, error: "NO_SENDER_WALLET" };
    }

    const nftInfo = NFT_MAP[collection];
    if (!nftInfo) {
      return { success: false, error: "UNKNOWN_NFT_COLLECTION" };
    }

    try {
      const provider = this.provider;
      const decryptedKey = await decrypt(senderWalletDoc.privateKey);
      const signer = new ethers.Wallet(decryptedKey, provider);

      const nftContract = new ethers.Contract(nftInfo.address, ERC721_ABI, signer);

      // Verify sender owns the NFT
      const owner = await nftContract.ownerOf(tokenId);
      if (owner.toLowerCase() !== senderWalletDoc.address.toLowerCase()) {
        return { success: false, error: "NOT_NFT_OWNER" };
      }

      // Check if already approved
      const approvedAddress = await nftContract.getApproved(tokenId);
      const isApprovedForAll = await nftContract.isApprovedForAll(senderWalletDoc.address, poolWallet.address);

      // Auto-approve if needed
      if (approvedAddress.toLowerCase() !== poolWallet.address.toLowerCase() && !isApprovedForAll) {
        console.log(`Auto-approving NFT ${collection} #${tokenId} for transfer`);
        const feeData = await provider.getFeeData();
        if (!feeData.gasPrice) return { success: false, error: "NETWORK_ERROR" };

        const approveTx = await nftContract.approve(poolWallet.address, tokenId, {
          gasPrice: feeData.gasPrice
        });
        await approveTx.wait();
        console.log(`Approval successful: ${approveTx.hash}`);
      }

      // Transfer NFT to pool
      const feeData = await provider.getFeeData();
      if (!feeData.gasPrice) return { success: false, error: "NETWORK_ERROR" };

      const gasEstimate = await nftContract.transferFrom.estimateGas(
        senderWalletDoc.address,
        poolWallet.address,
        tokenId
      );

      const gasCost = gasEstimate * feeData.gasPrice;
      const avaxBalance = await provider.getBalance(senderWalletDoc.address);
      if (avaxBalance < gasCost) {
        return { success: false, error: "INSUFFICIENT_GAS" };
      }

      const tx = await nftContract.transferFrom(
        senderWalletDoc.address,
        poolWallet.address,
        tokenId,
        {
          gasPrice: feeData.gasPrice,
          gasLimit: gasEstimate
        }
      );

      await tx.wait();

      // Fetch metadata for caching
      const metadata = await this.fetchNFTMetadata(nftInfo.address, tokenId);

      return {
        success: true,
        txHash: tx.hash,
        collection,
        tokenId,
        poolAddress: poolWallet.address,
        metadata: metadata.success ? { name: metadata.name, imageUrl: metadata.imageUrl } : null
      };
    } catch (err) {
      console.error('donateNFT error:', err);
      return { success: false, error: "TX_FAILED", detail: err.message };
    }
  }

  /**
   * Payout NFT from prize pool to recipient
   */
  async payoutNFT(guildId, appId = null, recipientDiscordId, toAddress, collection, tokenId) {
    const NFT_MAP = getNFTMap();
    const poolWallet = await this.getPrizePoolWallet(guildId, appId);
    if (!poolWallet) {
      return { success: false, error: "NO_WALLET" };
    }

    const nftInfo = NFT_MAP[collection];
    if (!nftInfo) {
      return { success: false, error: "UNKNOWN_NFT_COLLECTION" };
    }

    try {
      const provider = this.provider;
      const decryptedKey = await decrypt(poolWallet.privateKey);
      const signer = new ethers.Wallet(decryptedKey, provider);

      const nftContract = new ethers.Contract(nftInfo.address, ERC721_ABI, signer);

      // Verify pool owns the NFT
      const owner = await nftContract.ownerOf(tokenId);
      if (owner.toLowerCase() !== poolWallet.address.toLowerCase()) {
        return { success: false, error: "POOL_NOT_OWNER" };
      }

      // Transfer NFT to recipient
      const feeData = await provider.getFeeData();
      if (!feeData.gasPrice) return { success: false, error: "NETWORK_ERROR" };

      const gasEstimate = await nftContract.transferFrom.estimateGas(
        poolWallet.address,
        toAddress,
        tokenId
      );

      const gasCost = gasEstimate * feeData.gasPrice;
      const poolAvaxBalance = await provider.getBalance(poolWallet.address);
      if (poolAvaxBalance < gasCost) {
        return { success: false, error: "INSUFFICIENT_GAS" };
      }

      const tx = await nftContract.transferFrom(
        poolWallet.address,
        toAddress,
        tokenId,
        {
          gasPrice: feeData.gasPrice,
          gasLimit: gasEstimate
        }
      );

      await tx.wait();

      console.log(`✅ Successfully transferred NFT ${collection} #${tokenId} to ${toAddress} - TX: ${tx.hash}`);

      return {
        success: true,
        txHash: tx.hash,
        collection,
        tokenId,
        recipientAddress: toAddress
      };
    } catch (err) {
      console.error('payoutNFT error:', err);
      return { success: false, error: "TX_FAILED", detail: err.message };
    }
  }

  /**
   * Verify that a wallet owns a specific NFT
   */
  async verifyNFTOwnership(walletAddress, collection, tokenId) {
    const NFT_MAP = getNFTMap();
    const nftInfo = NFT_MAP[collection];

    if (!nftInfo) {
      return { success: false, error: "UNKNOWN_NFT_COLLECTION" };
    }

    try {
      const nftContract = new ethers.Contract(nftInfo.address, ERC721_ABI, this.provider);
      const owner = await nftContract.ownerOf(tokenId);

      if (owner.toLowerCase() === walletAddress.toLowerCase()) {
        return { success: true, owner: walletAddress };
      } else {
        return { success: false, error: "NOT_OWNER", actualOwner: owner };
      }
    } catch (err) {
      console.error('NFT ownership verification error:', err);
      return { success: false, error: "VERIFICATION_FAILED", detail: err.message };
    }
  }

  /**
   * Get NFT balances for a wallet address
   */
  async getNFTBalances(walletAddress) {
    const NFT_MAP = getNFTMap();
    const nfts = [];

    for (const [collection, nftInfo] of Object.entries(NFT_MAP)) {
      try {
        const nftContract = new ethers.Contract(nftInfo.address, ERC721_ABI, this.provider);
        const balance = await nftContract.balanceOf(walletAddress);
        const balanceNum = Number(balance);

        if (balanceNum > 0) {
          nfts.push({
            collection,
            name: nftInfo.name,
            count: balanceNum
          });
        }
      } catch (err) {
        console.error(`Error fetching ${collection} NFT balance:`, err);
        // Continue with other NFTs if one fails
      }
    }

    return { success: true, nfts };
  }

  /**
   * Withdraw NFT from prize pool (used by bounty/escrow systems)
   * NO FEE - this is for withdrawing NFTs that were won/donated to prize pool
   *
   * Note: This is NOT for personal wallet → external wallet transfers
   * (that would be a separate feature with 0.02 AVAX fee)
   */
  async withdrawNFTFromPrizePool(senderDiscordId, toAddress, collection, tokenId, guildId, appId = null) {
    const NFT_MAP = getNFTMap();

    const poolWallet = await this.getPrizePoolWallet(guildId, appId);
    if (!poolWallet) {
      return { success: false, error: "NO_WALLET" };
    }

    const nftInfo = NFT_MAP[collection];
    if (!nftInfo) {
      return { success: false, error: "UNKNOWN_NFT_COLLECTION" };
    }

    try {
      const provider = this.provider;
      const decryptedPoolKey = await decrypt(poolWallet.privateKey);
      const poolSigner = new ethers.Wallet(decryptedPoolKey, provider);

      const nftContract = new ethers.Contract(nftInfo.address, ERC721_ABI, poolSigner);

      // Verify pool owns the NFT
      const owner = await nftContract.ownerOf(tokenId);
      if (owner.toLowerCase() !== poolWallet.address.toLowerCase()) {
        return { success: false, error: "POOL_NOT_OWNER" };
      }

      const feeData = await provider.getFeeData();
      if (!feeData.gasPrice) return { success: false, error: "NETWORK_ERROR" };

      const transferGasEstimate = await nftContract.transferFrom.estimateGas(
        poolWallet.address,
        toAddress,
        tokenId
      );

      const transferGasCost = transferGasEstimate * feeData.gasPrice;
      const poolBalance = await provider.getBalance(poolWallet.address);
      if (poolBalance < transferGasCost) {
        return { success: false, error: "INSUFFICIENT_POOL_GAS" };
      }

      const transferTx = await nftContract.transferFrom(
        poolWallet.address,
        toAddress,
        tokenId,
        {
          gasPrice: feeData.gasPrice,
          gasLimit: transferGasEstimate
        }
      );

      await transferTx.wait();

      console.log(`✅ NFT withdrawn from prize pool: ${collection} #${tokenId} to ${toAddress} - TX: ${transferTx.hash}`);

      return {
        success: true,
        txHash: transferTx.hash,
        collection,
        tokenId,
        recipientAddress: toAddress
      };
    } catch (err) {
      console.error('withdrawNFTFromPrizePool error:', err);
      return { success: false, error: "TX_FAILED", detail: err.message };
    }
  }

  /**
   * DEPRECATED: Use withdrawNFTFromPrizePool instead
   * Keeping for backwards compatibility
   */
  async withdrawNFT(senderDiscordId, toAddress, collection, tokenId, guildId, appId = null) {
    return this.withdrawNFTFromPrizePool(senderDiscordId, toAddress, collection, tokenId, guildId, appId);
  }
}
