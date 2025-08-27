import { ethers } from 'ethers';

export function generateWallet() {
  const wallet = ethers.Wallet.createRandom();
  return {
    address: wallet.address,
    pk: wallet.privateKey,
  };
}
