// commands/withdraw.js - Sequential approach with pricing
import { SlashCommandBuilder } from "discord.js";
import Wallet from "../database/models/wallet.js";
import WithdrawAttempt from "../database/models/withdrawAttempt.js";
import { ethers } from "ethers";
import { decrypt } from "../utils/encryption.js";
import { ERC20_ABI, getTokenAddress, isNativeToken, testnetMainnetTokenMap } from "../utils/tokenConfig.js";
import axios from "axios";
import { getTokenMap, getTokenChoices } from "../utils/tokenConfig.js";

const TOKEN_MAP = getTokenMap();
const TOKEN_CHOICES = getTokenChoices();

// Price caching utilities
const priceCache = new Map();
const PRICE_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

function hasPrice(address) {
  const cached = priceCache.get(address.toLowerCase());
  if (!cached) return false;
  return Date.now() - cached.timestamp < PRICE_CACHE_DURATION;
}

function getCachedPrice(address) {
  const cached = priceCache.get(address.toLowerCase());
  return cached ? cached.price : 0;
}

function setCachedPrice(address, price) {
  priceCache.set(address.toLowerCase(), {
    price,
    timestamp: Date.now()
  });
}

async function getTokenPriceUSD(tokenAddress) {
  const address = tokenAddress.toLowerCase();
  
  // Check cache first
  if (hasPrice(address)) {
    return getCachedPrice(address);
  }

  const mainnetAddress = testnetMainnetTokenMap[address] || address;

  try {
    // Try DexScreener first
    const { data } = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${mainnetAddress}`,
      { timeout: 5000 }
    );
    const price = parseFloat(data.pairs?.[0]?.priceUsd || "0");

    if (price > 0) {
      setCachedPrice(address, price);
      console.log(`Cached price for ${address}: $${price}`);
      return price;
    }
  } catch (err) {
    console.warn(`DexScreener failed for ${address}:`, err.message);
  }

  try {
    // Fallback to GeckoTerminal
    const { data } = await axios.get(
      `https://api.geckoterminal.com/api/v2/search/pools?query=${mainnetAddress}`,
      { timeout: 5000 }
    );
    const pools = data?.data;
    if (pools?.length > 0) {
      const bestPool = pools[0];
      const geckoPrice = parseFloat(
        bestPool?.attributes?.base_token_price_usd || "0"
      );

      if (geckoPrice > 0) {
        setCachedPrice(address, geckoPrice);
        console.log(`Cached price from GeckoTerminal for ${address}: $${geckoPrice}`);
        return geckoPrice;
      }
    }
  } catch (fallbackErr) {
    console.error("GeckoTerminal fallback failed for", address, fallbackErr.message);
  }

  throw new Error("Unable to fetch token price from any source");
}

async function getAVAXPriceUSD() {
  // AVAX mainnet address for pricing
  const AVAX_ADDRESS = "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7";
  return await getTokenPriceUSD(AVAX_ADDRESS);
}

export default {
  data: new SlashCommandBuilder()
    .setName("withdraw")
    .setDescription("Withdraw tokens to another address (2% fee in AVAX)")
    .addStringOption(option =>
      option.setName("address")
        .setDescription("Destination AVAX address")
        .setRequired(true))
    .addNumberOption(option =>
      option.setName("amount")
        .setDescription("Amount to withdraw")
        .setRequired(true))
    .addStringOption(option => 
      option.setName("token")
        .setDescription("Token to withdraw")
        .setRequired(true)
        .addChoices(...TOKEN_CHOICES)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const address = interaction.options.getString("address");
    const amount = interaction.options.getNumber("amount");
    const tokenTicker = interaction.options.getString("token");
    const DEV_WALLET_ADDRESS = process.env.DEV_WALLET_ADDRESS; // Your fee collection address

    // Validation
    if (!amount || amount <= 0) {
      return interaction.editReply("Enter a valid amount greater than 0.");
    }
    if (!ethers.isAddress(address)) {
      return interaction.editReply("Invalid AVAX address format.");
    }
    if (!DEV_WALLET_ADDRESS || !ethers.isAddress(DEV_WALLET_ADDRESS)) {
      return interaction.editReply("Fee collection address not configured.");
    }

    const existingWallet = await Wallet.findOne({ discordId: interaction.user.id });
    if (!existingWallet) {
      return interaction.editReply("You don't have a wallet yet. Use `/createwallet` first.");
    }

    let withdrawAttemptRecord = null;
    
    try {
      // Step 1: Check for existing escrow for this exact withdraw
      const existingEscrow = await WithdrawAttempt.findOne({
        discordId: interaction.user.id,
        tokenTicker,
        requestedAmount: amount.toString(),
        status: 'fee_collected_pending_withdraw'
      });

      if (existingEscrow) {
        // Skip fee collection and go straight to withdraw attempt
        return await retryTokenWithdraw(interaction, existingEscrow, address);
      }

      // Step 2: Get token price for fee calculation
      await interaction.editReply("Fetching current token prices...");
      
      let tokenPriceUSD;
      let avaxPriceUSD;
      
      try {
        const contractAddress = getTokenAddress(tokenTicker);
        
        if (isNativeToken(tokenTicker)) {
          // For AVAX withdraws, fee is 2% of the AVAX amount
          avaxPriceUSD = await getAVAXPriceUSD();
          tokenPriceUSD = avaxPriceUSD;
        } else {
          // For token withdraws, get both token and AVAX prices
          [tokenPriceUSD, avaxPriceUSD] = await Promise.all([
            getTokenPriceUSD(contractAddress),
            getAVAXPriceUSD()
          ]);
        }
      } catch (priceError) {
        console.error("Price fetch failed:", priceError);
        return interaction.editReply(
          "❌ Unable to fetch current token prices. Please try again in a few minutes."
        );
      }

      // Step 3: Calculate 2% fee in AVAX
      const tokenValueUSD = amount * tokenPriceUSD;
      const feeValueUSD = tokenValueUSD * 0.02; // 2% fee
      const feeInAVAX = feeValueUSD / avaxPriceUSD;
      const feeInWei = ethers.parseEther(feeInAVAX.toFixed(18));

      await interaction.editReply(
        `Processing withdraw...\n` +
        `**Token Value:** $${tokenValueUSD.toFixed(2)} USD\n` +
        `**Fee (2%):** ${feeInAVAX.toFixed(6)} AVAX ($${feeValueUSD.toFixed(2)} USD)`
      );

      // Step 4: Setup provider and signer
      const provider = new ethers.JsonRpcProvider(process.env.AVALANCHE_RPC);
      await provider.getNetwork();
      
      const privateKey = await decrypt(existingWallet.privateKey);
      const signer = new ethers.Wallet(privateKey, provider);

      // Step 4.5: Check token balance BEFORE doing anything else
      let tokenBalance = 0n;
      let tokenDecimals = 18;

      if (isNativeToken(tokenTicker)) {
        // For AVAX, check native balance
        tokenBalance = await provider.getBalance(existingWallet.address);
        tokenDecimals = 18;
      } else {
        // For ERC-20 tokens, check token contract balance
        const contractAddress = getTokenAddress(tokenTicker);
        const tokenContract = new ethers.Contract(contractAddress, ERC20_ABI, provider);
        tokenBalance = await tokenContract.balanceOf(existingWallet.address);
        tokenDecimals = Number(await tokenContract.decimals());
      }

      // Check if user has sufficient token balance
      const requestedAmount = ethers.parseUnits(amount.toString(), tokenDecimals);
      if (tokenBalance < requestedAmount) {
        const balanceFormatted = ethers.formatUnits(tokenBalance, tokenDecimals);
        return interaction.editReply(
          `You don't have enough ${tokenTicker} to complete this withdraw.\n\n` +
          `You're trying to withdraw **${amount} ${tokenTicker}** but only have **${balanceFormatted} ${tokenTicker}** available.`
        );
      }

      // Step 5: Check AVAX balance for fee + gas
      const avaxBalance = await provider.getBalance(existingWallet.address);
      const feeData = await provider.getFeeData();
      
      // Estimate gas for fee transaction
      const feeGasEstimate = await provider.estimateGas({
        to: DEV_WALLET_ADDRESS,
        value: feeInWei,
        from: existingWallet.address,
      });
      const feeGasCost = feeGasEstimate * feeData.gasPrice;

      if (avaxBalance < feeInWei + feeGasCost) {
        const requiredAVAX = ethers.formatEther(feeInWei + feeGasCost);
        const availableAVAX = ethers.formatEther(avaxBalance);
        return interaction.editReply(
          `❌ Insufficient AVAX for fee and gas.\n` +
          `**Required:** ${requiredAVAX} AVAX\n` +
          `**Available:** ${availableAVAX} AVAX`
        );
      }

      // Step 6: Create withdraw attempt record
      withdrawAttemptRecord = new WithdrawAttempt({
        discordId: interaction.user.id,
        userAddress: existingWallet.address,
        destinationAddress: address,
        tokenTicker,
        requestedAmount: amount.toString(),
        feeInAVAX: feeInAVAX.toString(),
        feeInWei: feeInWei.toString(),
        tokenPriceUSD: tokenPriceUSD.toString(),
        avaxPriceUSD: avaxPriceUSD.toString(),
        status: 'pending'
      });
      await withdrawAttemptRecord.save();

      // Step 7: Collect AVAX fee
      try {
        const feeTx = await signer.sendTransaction({
          to: DEV_WALLET_ADDRESS,
          value: feeInWei,
          gasPrice: feeData.gasPrice,
          gasLimit: feeGasEstimate,
        });

        await feeTx.wait();
        console.log(`Fee collected: ${feeTx.hash}`);

        // Update withdraw attempt
        withdrawAttemptRecord.feeTransactionHash = feeTx.hash;
        withdrawAttemptRecord.status = 'fee_collected_pending_withdraw';
        await withdrawAttemptRecord.save();

      } catch (feeError) {
        console.error("Fee collection failed:", feeError);
        withdrawAttemptRecord.status = 'fee_collection_failed';
        await withdrawAttemptRecord.save();
        
        return interaction.editReply(
          "❌ Fee collection failed. Please try again later."
        );
      }

      // Step 9: Attempt token withdraw
      await attemptTokenWithdraw(interaction, withdrawAttemptRecord, address, amount, tokenTicker, signer, provider);

    } catch (error) {
      console.error("withdraw error:", error);
      
      // Show user-friendly error messages based on error type
      if (error.code === 'INSUFFICIENT_FUNDS') {
        if (isNativeToken(tokenTicker)) {
          await interaction.editReply(
            `You don't have enough AVAX to complete this transaction. Please add more AVAX to your wallet and try again.`
          );
        } else {
          await interaction.editReply(
            `You don't have enough AVAX to pay the transaction fees. Please add more AVAX to your wallet and try again.`
          );
        }
      } else if (error.message && error.message.includes('insufficient funds')) {
        if (isNativeToken(tokenTicker)) {
          await interaction.editReply(
            `You don't have enough AVAX to complete this transaction. Please add more AVAX to your wallet and try again.`
          );
        } else {
          await interaction.editReply(
            `You don't have enough AVAX to pay the transaction fees. Please add more AVAX to your wallet and try again.`
          );
        }
      } else if (error.message && error.message.includes('network')) {
        await interaction.editReply(
          `There's a network issue right now. Please try again in a few minutes.`
        );
      } else {
        await interaction.editReply(
          `Something went wrong with your withdraw. Please try again later or contact support if the issue persists.`
        );
      }
    }
  }
};

async function attemptTokenWithdraw(interaction, withdrawAttemptRecord, address, amount, tokenTicker, signer, provider) {
  try {
    let withdrawTx;

    if (isNativeToken(tokenTicker)) {
      // AVAX withdraw
      const withdrawAmount = ethers.parseEther(amount.toString());
      const feeData = await provider.getFeeData();
      
      const gasEstimate = await provider.estimateGas({
        to: address,
        value: withdrawAmount,
        from: await signer.getAddress(),
      });

      withdrawTx = await signer.sendTransaction({
        to: address,
        value: withdrawAmount,
        gasPrice: feeData.gasPrice,
        gasLimit: gasEstimate,
      });

    } else {
      // ERC-20 token withdraw
      const contractAddress = getTokenAddress(tokenTicker);
      const tokenContract = new ethers.Contract(contractAddress, ERC20_ABI, signer);
      const decimals = await tokenContract.decimals();
      const withdrawAmount = ethers.parseUnits(amount.toString(), decimals);

      // Check token balance
      const tokenBalance = await tokenContract.balanceOf(await signer.getAddress());
      if (tokenBalance < withdrawAmount) {
        throw new Error(`Insufficient ${tokenTicker} balance`);
      }

      const feeData = await provider.getFeeData();
      const gasEstimate = await tokenContract.transfer.estimateGas(address, withdrawAmount);

      withdrawTx = await tokenContract.transfer(address, withdrawAmount, {
        gasPrice: feeData.gasPrice,
        gasLimit: gasEstimate,
      });
    }

    await withdrawTx.wait();
    console.log(`withdraw successful: ${withdrawTx.hash}`);

    // Update withdraw attempt as completed
    withdrawAttemptRecord.withdrawTransactionHash = withdrawTx.hash;
    withdrawAttemptRecord.status = 'completed';
    await withdrawAttemptRecord.save();

    await interaction.editReply(
      `✅ withdraw completed successfully!\n` +
      `**Amount:** ${amount} ${tokenTicker}\n` +
      `**To:** \`${address}\`\n` +
      `**Fee:** ${parseFloat(withdrawAttemptRecord.feeInAVAX).toFixed(6)} AVAX\n` +
      `**TX:** https://testnet.snowtrace.io/tx/${withdrawTx.hash}`
    );

  } catch (withdrawError) {
    console.error("Token withdraw failed:", withdrawError);
    
    // Update withdraw attempt to show withdraw failed but fee was collected
    withdrawAttemptRecord.status = 'fee_collected_pending_withdraw';
    withdrawAttemptRecord.lastError = withdrawError.message;
    await withdrawAttemptRecord.save();

    await interaction.editReply(
      `Your token transfer couldn't be completed, but your withdraw fee was already collected.\n\n` +
      `Don't worry - your funds are safe! Run this same withdraw command again and you won't be charged the fee a second time.`
    );
  }
}

async function retryTokenWithdraw(interaction, existingEscrow, address) {
  await interaction.editReply("Found existing withdraw attempt. Checking your balance before retrying...");
  
  try {
    const provider = new ethers.JsonRpcProvider(process.env.AVALANCHE_RPC);
    const privateKey = await decrypt((await Wallet.findOne({ discordId: interaction.user.id })).privateKey);
    const signer = new ethers.Wallet(privateKey, provider);
    
    // Add balance validation to the retry path too
    const tokenTicker = existingEscrow.tokenTicker;
    const amount = parseFloat(existingEscrow.requestedAmount);
    
    console.log(`Retry: Checking balance for ${amount} ${tokenTicker}`);
    
    let tokenBalance = 0n;
    let tokenDecimals = 18;
    
    if (isNativeToken(tokenTicker)) {
      tokenBalance = await provider.getBalance((await signer.getAddress()));
      tokenDecimals = 18;
    } else {
      const contractAddress = getTokenAddress(tokenTicker);
      const tokenContract = new ethers.Contract(contractAddress, ERC20_ABI, provider);
      tokenBalance = await tokenContract.balanceOf(await signer.getAddress());
      tokenDecimals = Number(await tokenContract.decimals());
    }
    
    const requestedAmount = ethers.parseUnits(amount.toString(), tokenDecimals);
    const balanceFormatted = ethers.formatUnits(tokenBalance, tokenDecimals);
    
    console.log(`Retry: User has ${balanceFormatted} ${tokenTicker}, requesting ${amount} ${tokenTicker}`);
    
    if (tokenBalance < requestedAmount) {
      console.log(`Retry: Insufficient ${tokenTicker} balance - stopping retry`);
      return interaction.editReply(
        `You still don't have enough ${tokenTicker} to complete this withdraw.\n\n` +
        `You're trying to withdraw **${amount} ${tokenTicker}** but only have **${balanceFormatted} ${tokenTicker}** available.\n\n` +
        `Add more ${tokenTicker} to your wallet and try again.`
      );
    }
    
    console.log(`Retry: Balance check passed, proceeding with retry`);
    
    await interaction.editReply("Balance confirmed. Retrying token transfer...");
    
    await attemptTokenWithdraw(
      interaction, 
      existingEscrow, 
      address, 
      amount,
      tokenTicker, 
      signer, 
      provider
    );
    
  } catch (error) {
    console.error("Retry error:", error);
    await interaction.editReply(
      `Retry failed: ${error.message}\nPlease try again later or contact support.`
    );
  }
}