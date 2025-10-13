// commands/withdraw.js - Token and NFT withdrawals with intelligent fee handling
import { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from "discord.js";
import Wallet from "../database/models/wallet.js";
import WithdrawAttempt from "../database/models/withdrawAttempt.js";
import { ethers } from "ethers";
import { decrypt } from "../utils/encryption.js";
import { ERC20_ABI, ERC721_ABI, getTokenAddress, isNativeToken, testnetMainnetTokenMap, getTokenChoices } from "../utils/tokenConfig.js";
import { getNFTAddress, getNFTChoices } from "../utils/nftConfig.js";
import axios from "axios";

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

  if (hasPrice(address)) {
    return getCachedPrice(address);
  }

  const mainnetAddress = testnetMainnetTokenMap[address] || address;

  try {
    const { data } = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${mainnetAddress}`,
      { timeout: 5000 }
    );
    const price = parseFloat(data.pairs?.[0]?.priceUsd || "0");

    if (price > 0) {
      setCachedPrice(address, price);
      return price;
    }
  } catch (err) {
    console.warn(`DexScreener failed for ${address}:`, err.message);
  }

  try {
    const { data } = await axios.get(
      `https://api.geckoterminal.com/api/v2/search/pools?query=${mainnetAddress}`,
      { timeout: 5000 }
    );
    const pools = data?.data;
    if (pools?.length > 0) {
      const geckoPrice = parseFloat(pools[0]?.attributes?.base_token_price_usd || "0");

      if (geckoPrice > 0) {
        setCachedPrice(address, geckoPrice);
        return geckoPrice;
      }
    }
  } catch (fallbackErr) {
    console.error("GeckoTerminal fallback failed for", address, fallbackErr.message);
  }

  throw new Error("Unable to fetch token price from any source");
}

async function getAVAXPriceUSD() {
  const AVAX_ADDRESS = "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7";
  return await getTokenPriceUSD(AVAX_ADDRESS);
}

export default {
  data: new SlashCommandBuilder()
    .setName("withdraw")
    .setDescription("Withdraw tokens or NFTs to another address")
    .addStringOption(option =>
      option.setName("address")
        .setDescription("Destination AVAX address")
        .setRequired(true))
    .addStringOption(option =>
      option.setName("token")
        .setDescription("Token to withdraw")
        .setRequired(false)
        .addChoices(...getTokenChoices())
    )
    .addNumberOption(option =>
      option.setName("amount")
        .setDescription("Amount to withdraw (required for tokens)")
        .setRequired(false))
    .addStringOption(option =>
      option.setName("collection")
        .setDescription("NFT collection to withdraw")
        .setRequired(false)
        .addChoices(...getNFTChoices())
    )
    .addStringOption(option =>
      option.setName("tokenid")
        .setDescription("NFT Token ID (required for NFTs)")
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const address = interaction.options.getString("address");
    const tokenTicker = interaction.options.getString("token");
    const amount = interaction.options.getNumber("amount");
    const nftCollection = interaction.options.getString("collection");
    const nftTokenId = interaction.options.getString("tokenid");

    const DEV_WALLET_ADDRESS = process.env.DEV_WALLET_ADDRESS;

    // Validation
    if (!ethers.isAddress(address)) {
      return interaction.editReply("Invalid AVAX address format.");
    }
    if (!DEV_WALLET_ADDRESS || !ethers.isAddress(DEV_WALLET_ADDRESS)) {
      return interaction.editReply("Fee collection address not configured.");
    }

    // Determine if token or NFT withdraw
    const isNFTWithdraw = !!(nftCollection && nftTokenId);
    const isTokenWithdraw = !!(tokenTicker && amount);

    if (!isNFTWithdraw && !isTokenWithdraw) {
      return interaction.editReply(
        "Please provide either:\n" +
        "• **Token & Amount** for token withdraws, OR\n" +
        "• **Collection & TokenID** for NFT withdraws"
      );
    }

    if (isNFTWithdraw && isTokenWithdraw) {
      return interaction.editReply("Please choose either token OR NFT withdraw, not both.");
    }

    if (isTokenWithdraw && (!amount || amount <= 0)) {
      return interaction.editReply("Enter a valid amount greater than 0.");
    }

    let existingWallet;
    try {
      existingWallet = await Wallet.findOne({ discordId: interaction.user.id }).maxTimeMS(5000);
    } catch (dbError) {
      console.error("Database query error:", dbError);
      return interaction.editReply("❌ Database connection issue. Please try again later.");
    }

    if (!existingWallet) {
      return interaction.editReply("You don't have a wallet yet. Use `/createwallet` first.");
    }

    try {
      if (isNFTWithdraw) {
        await handleNFTWithdraw(interaction, existingWallet, address, nftCollection, nftTokenId, DEV_WALLET_ADDRESS);
      } else {
        await handleTokenWithdraw(interaction, existingWallet, address, tokenTicker, amount, DEV_WALLET_ADDRESS);
      }
    } catch (error) {
      console.error("withdraw error:", error);
      await handleWithdrawError(interaction, error, isNFTWithdraw ? nftCollection : tokenTicker);
    }
  }
};

async function handleTokenWithdraw(interaction, existingWallet, address, tokenTicker, amount, DEV_WALLET_ADDRESS) {
  // Check for existing pending attempts for this token
  const pendingAttempts = await WithdrawAttempt.find({
    discordId: interaction.user.id,
    tokenTicker,
    status: 'fee_collected_pending_withdraw'
  }).sort({ createdAt: -1 });

  if (pendingAttempts.length > 0) {
    const existingAttempt = pendingAttempts[0];
    const existingAmount = parseFloat(existingAttempt.requestedAmount);

    if (amount < existingAmount) {
      // User wants to withdraw LESS than they already paid fee for
      return await promptPartialWithdraw(interaction, existingAttempt, address, amount, tokenTicker);
    } else if (amount === existingAmount) {
      // Same amount - just retry
      return await retryTokenWithdraw(interaction, existingAttempt, address);
    } else {
      // User wants to withdraw MORE - need to charge difference
      return await handleIncreasedWithdraw(interaction, existingAttempt, address, amount, tokenTicker, existingWallet, DEV_WALLET_ADDRESS);
    }
  }

  // No existing attempt - proceed with new withdraw
  await processNewTokenWithdraw(interaction, existingWallet, address, tokenTicker, amount, DEV_WALLET_ADDRESS);
}

async function handleNFTWithdraw(interaction, existingWallet, address, collection, tokenId, DEV_WALLET_ADDRESS) {
  // Check for existing NFT withdraw attempt
  const existingAttempt = await WithdrawAttempt.findOne({
    discordId: interaction.user.id,
    nftCollection: collection,
    nftTokenId: tokenId,
    status: 'fee_collected_pending_withdraw'
  });

  if (existingAttempt) {
    // Retry without charging fee again
    return await retryNFTWithdraw(interaction, existingAttempt, address);
  }

  // New NFT withdraw - charge flat 0.02 AVAX fee
  await processNewNFTWithdraw(interaction, existingWallet, address, collection, tokenId, DEV_WALLET_ADDRESS);
}

async function promptPartialWithdraw(interaction, existingAttempt, address, newAmount, tokenTicker) {
  const paidForAmount = parseFloat(existingAttempt.requestedAmount);

  const confirmButton = new ButtonBuilder()
    .setCustomId(`confirm_partial_withdraw_${existingAttempt._id}`)
    .setLabel(`Yes, withdraw ${newAmount} ${tokenTicker}`)
    .setStyle(ButtonStyle.Success);

  const cancelButton = new ButtonBuilder()
    .setCustomId('cancel_partial_withdraw')
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

  const response = await interaction.editReply({
    content:
      `⚠️ **Fee Already Paid**\n\n` +
      `You already paid a withdraw fee for **${paidForAmount} ${tokenTicker}**.\n\n` +
      `You're now trying to withdraw only **${newAmount} ${tokenTicker}**.\n\n` +
      `Do you want to proceed **without paying another fee**?`,
    components: [row]
  });

  const collectorFilter = i => i.user.id === interaction.user.id;
  try {
    const confirmation = await response.awaitMessageComponent({
      filter: collectorFilter,
      time: 60000
    });

    if (confirmation.customId.startsWith('confirm_partial_withdraw')) {
      await confirmation.update({ content: 'Processing withdraw...', components: [] });

      // Update the existing attempt with new amount and proceed
      existingAttempt.requestedAmount = newAmount.toString();
      existingAttempt.destinationAddress = address;
      await existingAttempt.save();

      await retryTokenWithdraw(confirmation, existingAttempt, address);
    } else {
      await confirmation.update({
        content: 'Withdraw cancelled.',
        components: []
      });
    }
  } catch (e) {
    await interaction.editReply({
      content: 'Confirmation timeout - withdraw cancelled.',
      components: []
    });
  }
}

async function handleIncreasedWithdraw(interaction, existingAttempt, address, newAmount, tokenTicker, wallet, DEV_WALLET_ADDRESS) {
  const paidForAmount = parseFloat(existingAttempt.requestedAmount);
  const additionalAmount = newAmount - paidForAmount;

  await interaction.editReply(
    `ℹ️ You already paid a fee for **${paidForAmount} ${tokenTicker}**.\n\n` +
    `You're now withdrawing **${newAmount} ${tokenTicker}** (${additionalAmount} more).\n\n` +
    `Calculating additional fee...`
  );

  try {
    // Get prices
    const contractAddress = getTokenAddress(tokenTicker);
    const [tokenPriceUSD, avaxPriceUSD] = isNativeToken(tokenTicker)
      ? [await getAVAXPriceUSD(), await getAVAXPriceUSD()]
      : await Promise.all([getTokenPriceUSD(contractAddress), getAVAXPriceUSD()]);

    // Calculate fee for additional amount only
    const additionalValueUSD = additionalAmount * tokenPriceUSD;
    const additionalFeeUSD = additionalValueUSD * 0.02;
    const additionalFeeAVAX = additionalFeeUSD / avaxPriceUSD;
    const additionalFeeWei = ethers.parseEther(additionalFeeAVAX.toFixed(18));

    // Collect additional fee
    const provider = new ethers.JsonRpcProvider(process.env.AVALANCHE_RPC);
    const privateKey = await decrypt(wallet.privateKey);
    const signer = new ethers.Wallet(privateKey, provider);

    const feeData = await provider.getFeeData();
    const avaxBalance = await provider.getBalance(wallet.address);
    const feeGasEstimate = await provider.estimateGas({
      to: DEV_WALLET_ADDRESS,
      value: additionalFeeWei,
      from: wallet.address,
    });
    const feeGasCost = feeGasEstimate * feeData.gasPrice;

    if (avaxBalance < additionalFeeWei + feeGasCost) {
      const required = ethers.formatEther(additionalFeeWei + feeGasCost);
      const available = ethers.formatEther(avaxBalance);
      return interaction.editReply(
        `❌ Insufficient AVAX for additional fee.\n` +
        `**Required:** ${required} AVAX\n**Available:** ${available} AVAX`
      );
    }

    // Charge additional fee
    const feeTx = await signer.sendTransaction({
      to: DEV_WALLET_ADDRESS,
      value: additionalFeeWei,
      gasPrice: feeData.gasPrice,
      gasLimit: feeGasEstimate,
    });
    await feeTx.wait();

    // Update attempt record
    const totalFeeAVAX = parseFloat(existingAttempt.feeInAVAX) + additionalFeeAVAX;
    existingAttempt.requestedAmount = newAmount.toString();
    existingAttempt.feeInAVAX = totalFeeAVAX.toString();
    existingAttempt.destinationAddress = address;
    await existingAttempt.save();

    await interaction.editReply(
      `✅ Additional fee collected: ${additionalFeeAVAX.toFixed(6)} AVAX\n` +
      `Total fee paid: ${totalFeeAVAX.toFixed(6)} AVAX\n\n` +
      `Proceeding with withdraw...`
    );

    // Now execute the withdraw
    await attemptTokenWithdraw(interaction, existingAttempt, address, newAmount, tokenTicker, signer, provider);

  } catch (error) {
    console.error("Additional fee collection failed:", error);
    return interaction.editReply("❌ Failed to collect additional fee. Please try again.");
  }
}

async function processNewTokenWithdraw(interaction, wallet, address, tokenTicker, amount, DEV_WALLET_ADDRESS) {
  await interaction.editReply("Fetching current token prices...");

  let tokenPriceUSD, avaxPriceUSD;

  try {
    const contractAddress = getTokenAddress(tokenTicker);

    if (isNativeToken(tokenTicker)) {
      avaxPriceUSD = await getAVAXPriceUSD();
      tokenPriceUSD = avaxPriceUSD;
    } else {
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

  // Calculate 2% fee in AVAX
  const tokenValueUSD = amount * tokenPriceUSD;
  const feeValueUSD = tokenValueUSD * 0.02;
  const feeInAVAX = feeValueUSD / avaxPriceUSD;
  const feeInWei = ethers.parseEther(feeInAVAX.toFixed(18));

  await interaction.editReply(
    `Processing withdraw...\n` +
    `**Token Value:** $${tokenValueUSD.toFixed(2)} USD\n` +
    `**Fee (2%):** ${feeInAVAX.toFixed(6)} AVAX ($${feeValueUSD.toFixed(2)} USD)`
  );

  const provider = new ethers.JsonRpcProvider(process.env.AVALANCHE_RPC);
  await provider.getNetwork();

  const privateKey = await decrypt(wallet.privateKey);
  const signer = new ethers.Wallet(privateKey, provider);

  // Check token balance
  let tokenBalance = 0n;
  let tokenDecimals = 18;

  if (isNativeToken(tokenTicker)) {
    tokenBalance = await provider.getBalance(wallet.address);
  } else {
    const contractAddress = getTokenAddress(tokenTicker);
    const tokenContract = new ethers.Contract(contractAddress, ERC20_ABI, provider);
    tokenBalance = await tokenContract.balanceOf(wallet.address);
    tokenDecimals = Number(await tokenContract.decimals());
  }

  const requestedAmount = ethers.parseUnits(amount.toString(), tokenDecimals);
  if (tokenBalance < requestedAmount) {
    const balanceFormatted = ethers.formatUnits(tokenBalance, tokenDecimals);
    return interaction.editReply(
      `You don't have enough ${tokenTicker} to complete this withdraw.\n\n` +
      `You're trying to withdraw **${amount} ${tokenTicker}** but only have **${balanceFormatted} ${tokenTicker}** available.`
    );
  }

  // Check AVAX for fee + gas
  const avaxBalance = await provider.getBalance(wallet.address);
  const feeData = await provider.getFeeData();

  const feeGasEstimate = await provider.estimateGas({
    to: DEV_WALLET_ADDRESS,
    value: feeInWei,
    from: wallet.address,
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

  // Create withdraw attempt record
  const withdrawAttemptRecord = new WithdrawAttempt({
    discordId: interaction.user.id,
    userAddress: wallet.address,
    destinationAddress: address,
    tokenTicker,
    requestedAmount: amount.toString(),
    feeInAVAX: feeInAVAX.toString(),
    feeInWei: feeInWei.toString(),
    tokenPriceUSD: tokenPriceUSD.toString(),
    avaxPriceUSD: avaxPriceUSD.toString(),
    isNFT: false,
    status: 'pending'
  });
  await withdrawAttemptRecord.save();

  // Collect fee
  try {
    const feeTx = await signer.sendTransaction({
      to: DEV_WALLET_ADDRESS,
      value: feeInWei,
      gasPrice: feeData.gasPrice,
      gasLimit: feeGasEstimate,
    });

    await feeTx.wait();
    console.log(`Fee collected: ${feeTx.hash}`);

    withdrawAttemptRecord.feeTransactionHash = feeTx.hash;
    withdrawAttemptRecord.status = 'fee_collected_pending_withdraw';
    await withdrawAttemptRecord.save();

  } catch (feeError) {
    console.error("Fee collection failed:", feeError);
    withdrawAttemptRecord.status = 'fee_collection_failed';
    await withdrawAttemptRecord.save();

    return interaction.editReply("❌ Fee collection failed. Please try again later.");
  }

  // Attempt token withdraw
  await attemptTokenWithdraw(interaction, withdrawAttemptRecord, address, amount, tokenTicker, signer, provider);
}

async function processNewNFTWithdraw(interaction, wallet, address, collection, tokenId, DEV_WALLET_ADDRESS) {
  await interaction.editReply("Processing NFT withdraw...");

  const FLAT_FEE_AVAX = "0.02";
  const feeInWei = ethers.parseEther(FLAT_FEE_AVAX);

  const provider = new ethers.JsonRpcProvider(process.env.AVALANCHE_RPC);
  await provider.getNetwork();

  const privateKey = await decrypt(wallet.privateKey);
  const signer = new ethers.Wallet(privateKey, provider);

  // Verify NFT ownership
  const nftAddress = getNFTAddress(collection);
  if (!nftAddress) {
    return interaction.editReply(`❌ Unknown NFT collection: ${collection}`);
  }

  const nftContract = new ethers.Contract(nftAddress, ERC721_ABI, provider);

  try {
    const owner = await nftContract.ownerOf(tokenId);
    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
      return interaction.editReply(`❌ You don't own ${collection} #${tokenId}`);
    }
  } catch (error) {
    return interaction.editReply(`❌ Could not verify ownership of ${collection} #${tokenId}`);
  }

  // Check AVAX for fee + gas
  const avaxBalance = await provider.getBalance(wallet.address);
  const feeData = await provider.getFeeData();

  const feeGasEstimate = await provider.estimateGas({
    to: DEV_WALLET_ADDRESS,
    value: feeInWei,
    from: wallet.address,
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

  const avaxPriceUSD = await getAVAXPriceUSD();

  // Create NFT withdraw attempt
  const withdrawAttemptRecord = new WithdrawAttempt({
    discordId: interaction.user.id,
    userAddress: wallet.address,
    destinationAddress: address,
    isNFT: true,
    nftCollection: collection,
    nftTokenId: tokenId,
    feeInAVAX: FLAT_FEE_AVAX,
    feeInWei: feeInWei.toString(),
    avaxPriceUSD: avaxPriceUSD.toString(),
    status: 'pending'
  });
  await withdrawAttemptRecord.save();

  // Collect flat fee
  try {
    const feeTx = await signer.sendTransaction({
      to: DEV_WALLET_ADDRESS,
      value: feeInWei,
      gasPrice: feeData.gasPrice,
      gasLimit: feeGasEstimate,
    });

    await feeTx.wait();
    console.log(`NFT withdraw fee collected: ${feeTx.hash}`);

    withdrawAttemptRecord.feeTransactionHash = feeTx.hash;
    withdrawAttemptRecord.status = 'fee_collected_pending_withdraw';
    await withdrawAttemptRecord.save();

  } catch (feeError) {
    console.error("NFT fee collection failed:", feeError);
    withdrawAttemptRecord.status = 'fee_collection_failed';
    await withdrawAttemptRecord.save();

    return interaction.editReply("❌ Fee collection failed. Please try again later.");
  }

  // Attempt NFT transfer
  await attemptNFTWithdraw(interaction, withdrawAttemptRecord, address, collection, tokenId, signer, provider);
}

async function attemptTokenWithdraw(interaction, withdrawAttemptRecord, address, amount, tokenTicker, signer, provider) {
  try {
    let withdrawTx;

    if (isNativeToken(tokenTicker)) {
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
      const contractAddress = getTokenAddress(tokenTicker);
      const tokenContract = new ethers.Contract(contractAddress, ERC20_ABI, signer);
      const decimals = await tokenContract.decimals();
      const withdrawAmount = ethers.parseUnits(amount.toString(), decimals);

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
    console.log(`Token withdraw successful: ${withdrawTx.hash}`);

    withdrawAttemptRecord.withdrawTransactionHash = withdrawTx.hash;
    withdrawAttemptRecord.status = 'completed';
    await withdrawAttemptRecord.save();

    await interaction.editReply({
      content:
        `✅ Withdraw completed successfully!\n` +
        `**Amount:** ${amount} ${tokenTicker}\n` +
        `**To:** \`${address}\`\n` +
        `**Fee:** ${parseFloat(withdrawAttemptRecord.feeInAVAX).toFixed(6)} AVAX\n` +
        `**TX:** https://testnet.snowtrace.io/tx/${withdrawTx.hash}`,
      components: []
    });

  } catch (withdrawError) {
    console.error("Token withdraw failed:", withdrawError);

    withdrawAttemptRecord.status = 'fee_collected_pending_withdraw';
    withdrawAttemptRecord.lastError = withdrawError.message;
    await withdrawAttemptRecord.save();

    await interaction.editReply({
      content:
        `Your token transfer couldn't be completed, but your withdraw fee was already collected.\n\n` +
        `Don't worry - your funds are safe! Run this same withdraw command again and you won't be charged the fee a second time.`,
      components: []
    });
  }
}

async function attemptNFTWithdraw(interaction, withdrawAttemptRecord, address, collection, tokenId, signer, provider) {
  try {
    const nftAddress = getNFTAddress(collection);
    const nftContract = new ethers.Contract(nftAddress, ERC721_ABI, signer);
    const userAddress = await signer.getAddress();

    const feeData = await provider.getFeeData();
    const gasEstimate = await nftContract.transferFrom.estimateGas(userAddress, address, tokenId);

    const transferTx = await nftContract.transferFrom(userAddress, address, tokenId, {
      gasPrice: feeData.gasPrice,
      gasLimit: gasEstimate,
    });

    await transferTx.wait();
    console.log(`NFT withdraw successful: ${transferTx.hash}`);

    withdrawAttemptRecord.withdrawTransactionHash = transferTx.hash;
    withdrawAttemptRecord.status = 'completed';
    await withdrawAttemptRecord.save();

    await interaction.editReply({
      content:
        `✅ NFT withdraw completed successfully!\n` +
        `**NFT:** ${collection} #${tokenId}\n` +
        `**To:** \`${address}\`\n` +
        `**Fee:** 0.02 AVAX\n` +
        `**TX:** https://testnet.snowtrace.io/tx/${transferTx.hash}`,
      components: []
    });

  } catch (withdrawError) {
    console.error("NFT withdraw failed:", withdrawError);

    withdrawAttemptRecord.status = 'fee_collected_pending_withdraw';
    withdrawAttemptRecord.lastError = withdrawError.message;
    await withdrawAttemptRecord.save();

    await interaction.editReply({
      content:
        `Your NFT transfer couldn't be completed, but your withdraw fee was already collected.\n\n` +
        `Don't worry - your NFT is safe! Run this same withdraw command again and you won't be charged the fee a second time.`,
      components: []
    });
  }
}

async function retryTokenWithdraw(interaction, existingEscrow, address) {
  await interaction.editReply("Found existing withdraw attempt. Checking your balance before retrying...");

  try {
    const provider = new ethers.JsonRpcProvider(process.env.AVALANCHE_RPC);
    const privateKey = await decrypt((await Wallet.findOne({ discordId: interaction.user.id })).privateKey);
    const signer = new ethers.Wallet(privateKey, provider);

    const tokenTicker = existingEscrow.tokenTicker;
    const amount = parseFloat(existingEscrow.requestedAmount);

    let tokenBalance = 0n;
    let tokenDecimals = 18;

    if (isNativeToken(tokenTicker)) {
      tokenBalance = await provider.getBalance(await signer.getAddress());
    } else {
      const contractAddress = getTokenAddress(tokenTicker);
      const tokenContract = new ethers.Contract(contractAddress, ERC20_ABI, provider);
      tokenBalance = await tokenContract.balanceOf(await signer.getAddress());
      tokenDecimals = Number(await tokenContract.decimals());
    }

    const requestedAmount = ethers.parseUnits(amount.toString(), tokenDecimals);
    const balanceFormatted = ethers.formatUnits(tokenBalance, tokenDecimals);

    if (tokenBalance < requestedAmount) {
      return interaction.editReply(
        `You still don't have enough ${tokenTicker} to complete this withdraw.\n\n` +
        `You're trying to withdraw **${amount} ${tokenTicker}** but only have **${balanceFormatted} ${tokenTicker}** available.\n\n` +
        `Add more ${tokenTicker} to your wallet and try again.`
      );
    }

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

async function retryNFTWithdraw(interaction, existingAttempt, address) {
  await interaction.editReply("Found existing NFT withdraw attempt. Retrying transfer...");

  try {
    const provider = new ethers.JsonRpcProvider(process.env.AVALANCHE_RPC);
    const privateKey = await decrypt((await Wallet.findOne({ discordId: interaction.user.id })).privateKey);
    const signer = new ethers.Wallet(privateKey, provider);

    await attemptNFTWithdraw(
      interaction,
      existingAttempt,
      address,
      existingAttempt.nftCollection,
      existingAttempt.nftTokenId,
      signer,
      provider
    );

  } catch (error) {
    console.error("NFT retry error:", error);
    await interaction.editReply(
      `Retry failed: ${error.message}\nPlease try again later or contact support.`
    );
  }
}

async function handleWithdrawError(interaction, error, assetName) {
  if (error.code === 'INSUFFICIENT_FUNDS' || error.message?.includes('insufficient funds')) {
    await interaction.editReply(
      `You don't have enough AVAX to pay the transaction fees. Please add more AVAX to your wallet and try again.`
    );
  } else if (error.message?.includes('network')) {
    await interaction.editReply(
      `There's a network issue right now. Please try again in a few minutes.`
    );
  } else {
    await interaction.editReply(
      `Something went wrong with your withdraw. Please try again later or contact support if the issue persists.`
    );
  }
}
