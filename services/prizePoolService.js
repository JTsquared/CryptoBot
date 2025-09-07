// services/prizePoolService.js
import PrizePoolWallet from "../database/models/prizePoolWallet.js";
// import prizePoolWalletSchema from "../database/models/prizePoolWallet.js";
import { generateWallet } from "../utils/wallet.js"; 
import { getTokenAddress, isNativeToken, ERC20_ABI } from "../utils/tokenConfig.js";
import { ethers } from "ethers";
import { encrypt, decrypt } from "../utils/encryption.js";
import { TOKEN_MAP } from "../utils/tokenConfig.js";
import Wallet from "../database/models/wallet.js";
import PrizeEscrow from "../database/models/prizeEscrow.js";
import Transaction from "../database/models/transactionModel.js";

export class PrizePoolService {
  constructor(provider) {
    this.provider = provider;
  }

  async getOrCreateWallet(guildId) {
    let existing = await PrizePoolWallet.findOne({ guildId });
  
    if (existing) {
      return {
        success: false,
        error: "WALLET_ALREADY_EXISTS",
        wallet: existing
      };
    }
  
    const { address, pk } = generateWallet();
    const newWallet = await PrizePoolWallet.create({
      guildId,
      address,
      privateKey: await encrypt(pk)
    });
    return { success: true, wallet: newWallet };
  }

  async getPrizePoolWallet(guildId) {
    return PrizePoolWallet.findOne({ guildId });
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
  async getBalance(guildId, ticker) {
    const wallet = await this.getPrizePoolWallet(guildId);
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
  async getAllBalances(guildId, { includeZeros = false } = {}) {
    const wallet = await this.getPrizePoolWallet(guildId);
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

  async donateToPool(guildId, senderDiscordId, amount, ticker) {
    const poolWallet = await this.getPrizePoolWallet(guildId);
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
      if (isNativeToken(ticker)) {
        const amountWei = ethers.parseEther(amount.toString());
  
        const feeData = await provider.getFeeData();
        if (!feeData.gasPrice) return { success: false, error: "NETWORK_ERROR" };
  
        const gasEstimate = await provider.estimateGas({
          to: poolWallet.address,
          value: amountWei,
          from: senderWalletDoc.address,
        });
  
        const gasCost = gasEstimate * feeData.gasPrice;
        const balance = await provider.getBalance(senderWalletDoc.address);
        if (balance < amountWei + gasCost) {
          return { success: false, error: "INSUFFICIENT_FUNDS" };
        }
  
        tx = await signer.sendTransaction({
          to: poolWallet.address,
          value: amountWei,
          gasPrice: feeData.gasPrice,
          gasLimit: gasEstimate,
        });
      } else {
        const contractAddress = TOKEN_MAP[ticker];
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

// Fixed payout method with escrow claim support
async payout(guildId, recipientDiscordId, toAddress, ticker, amount = "all", isEscrowClaim = false) {
  const poolWallet = await this.getPrizePoolWallet(guildId);
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

  async getPendingClaims(guildId, discordId) {
    return await PrizeEscrow.find({ guildId, discordId, claimed: false });
  }

  async getEscrowedAmountForToken(guildId, token) {
    const pending = await PrizeEscrow.find({ guildId, token, claimed: false });
    return pending.reduce((sum, esc) => sum + BigInt(esc.amount), 0n);
  }

  async claimEscrow(guildId, userId) {
    try {
      const wallet = await Wallet.findOne({ discordId: userId });
      if (!wallet) {
        return {
          success: false,
          error: "NO_WALLET",
        };
      }
  
      const pendingClaims = await this.getPendingClaims(guildId, userId);
  
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
          // Pass isEscrowClaim = true to skip reserved balance calculations
          const payoutResult = await this.payout(
            entry.guildId,
            entry.discordId,
            wallet.address, // Use wallet.address instead of entry.toAddress
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
        } catch (err) {
          console.error("Claim payout error:", err);
          failMsgs.push(
            `⚠️ Error claiming ${entry.amount} ${entry.token}. Try again later.`
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

  async createEscrowEntries(guildId, discordId, token, amount) {
    try {
      console.log(`Creating escrow entries - token: ${token}, amount: ${amount} (type: ${typeof amount})`);
      
      // Get current balances to resolve 'all' values
      const balancesResult = await this.getAllBalances(guildId);
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
}
