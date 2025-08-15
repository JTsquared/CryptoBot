// services/prizePoolService.js
import PrizePoolWallet from "../models/PrizePoolWallet.js";
import { generateWallet } from "../models/Wallet.js"; 
import { getTokenAddress, isNativeToken, ERC20_ABI } from "../utils/tokenConfig.js";
import { ethers } from "ethers";

export class PrizePoolService {
  constructor(provider) {
    this.provider = provider;
  }

  async getOrCreateWallet(guildId) {
    let wallet = await PrizePoolWallet.findOne({ guildId });
    if (!wallet) {
      const { address, privateKey } = generateWallet();
      wallet = new PrizePoolWallet({ guildId, address, privateKey });
      await wallet.save();
    }
    return wallet;
  }

  async getBalance(guildId, ticker) {
    const wallet = await this.getOrCreateWallet(guildId);
    if (isNativeToken(ticker)) {
      const balance = await this.provider.getBalance(wallet.address);
      return ethers.formatEther(balance);
    } else {
      const tokenAddress = getTokenAddress(ticker);
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const balance = await contract.balanceOf(wallet.address);
      const decimals = await contract.decimals();
      return ethers.formatUnits(balance, decimals);
    }
  }

  async donateToPool(guildId, fromSigner, ticker, amount) {
    const wallet = await this.getOrCreateWallet(guildId);

    if (isNativeToken(ticker)) {
      const tx = await fromSigner.sendTransaction({
        to: wallet.address,
        value: ethers.parseEther(amount.toString())
      });
      return tx.wait();
    } else {
      const tokenAddress = getTokenAddress(ticker);
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, fromSigner);
      const decimals = await contract.decimals();
      const tx = await contract.transfer(wallet.address, ethers.parseUnits(amount.toString(), decimals));
      return tx.wait();
    }
  }

  async payout(guildId, toAddress, ticker) {
    const wallet = await this.getOrCreateWallet(guildId);
    const signer = new ethers.Wallet(wallet.privateKey, this.provider);

    if (isNativeToken(ticker)) {
      const balance = await this.provider.getBalance(wallet.address);
      if (balance === 0n) throw new Error("No balance to payout.");
      const tx = await signer.sendTransaction({
        to: toAddress,
        value: balance
      });
      return tx.wait();
    } else {
      const tokenAddress = getTokenAddress(ticker);
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
      const balance = await contract.balanceOf(wallet.address);
      if (balance === 0n) throw new Error("No balance to payout.");
      const tx = await contract.transfer(toAddress, balance);
      return tx.wait();
    }
  }

  async getGuildWallet(guildId) {
    return await PrizePoolWallet.findOne({ guildId });
  }
}
