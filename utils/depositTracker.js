import axios from 'axios';
import { ethers } from 'ethers';

/**
 * Fetches onchain deposits to a wallet address using Snowtrace API
 * @param {string} walletAddress - The wallet address to check for deposits
 * @param {string} network - Network type: "mainnet" or "testnet"
 * @returns {Promise<Array>} Array of deposit transactions
 */
export async function fetchDeposits(walletAddress, network = process.env.NETWORK) {
  const deposits = [];

  // Determine API endpoint based on network
  const apiUrl = network === 'mainnet'
    ? 'https://api.snowtrace.io/api'
    : 'https://api-testnet.snowtrace.io/api';

  try {
    // Fetch ERC-20 token transfers (incoming only)
    const tokenTxUrl = `${apiUrl}?module=account&action=tokentx&address=${walletAddress}&sort=desc&page=1&offset=100`;
    console.log(`Fetching token transfers from Snowtrace...`);

    const tokenResponse = await axios.get(tokenTxUrl);

    if (tokenResponse.data.status === '1' && tokenResponse.data.result) {
      const tokenTxs = tokenResponse.data.result;

      // Filter only incoming transfers (where 'to' is our wallet)
      const incomingTokenTxs = tokenTxs.filter(tx =>
        tx.to.toLowerCase() === walletAddress.toLowerCase()
      );

      console.log(`Found ${incomingTokenTxs.length} incoming token transfers`);

      for (const tx of incomingTokenTxs) {
        const decimals = parseInt(tx.tokenDecimal);
        const amount = ethers.formatUnits(tx.value, decimals);

        deposits.push({
          token: tx.tokenSymbol,
          amount: amount,
          txHash: tx.hash,
          timestamp: new Date(parseInt(tx.timeStamp) * 1000),
          from: tx.from
        });
      }
    }

    // Fetch native AVAX transactions (incoming only)
    const avaxTxUrl = `${apiUrl}?module=account&action=txlist&address=${walletAddress}&sort=desc&page=1&offset=100`;
    console.log(`Fetching AVAX transactions from Snowtrace...`);

    const avaxResponse = await axios.get(avaxTxUrl);

    if (avaxResponse.data.status === '1' && avaxResponse.data.result) {
      const avaxTxs = avaxResponse.data.result;

      // Filter only incoming transfers with value > 0
      const incomingAvaxTxs = avaxTxs.filter(tx =>
        tx.to.toLowerCase() === walletAddress.toLowerCase() &&
        tx.value !== '0' &&
        tx.isError === '0' // Only successful transactions
      );

      console.log(`Found ${incomingAvaxTxs.length} incoming AVAX transactions`);

      for (const tx of incomingAvaxTxs) {
        const amount = ethers.formatEther(tx.value);

        deposits.push({
          token: 'AVAX',
          amount: amount,
          txHash: tx.hash,
          timestamp: new Date(parseInt(tx.timeStamp) * 1000),
          from: tx.from
        });
      }
    }

  } catch (err) {
    console.error('Error fetching deposits from Snowtrace:', err.message);
  }

  // Sort by timestamp descending (newest first)
  deposits.sort((a, b) => b.timestamp - a.timestamp);

  console.log(`Total deposits found: ${deposits.length}`);
  return deposits;
}
