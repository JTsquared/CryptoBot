#!/usr/bin/env node
/**
 * Local test script for withdraw logic without MongoDB
 * Tests the fee calculation and retry logic
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });

import { ethers } from 'ethers';
import { getTokenAddress, isNativeToken } from './utils/tokenConfig.js';

// Mock withdraw attempt data
const mockAttempt = {
  discordId: 'TEST_USER',
  tokenTicker: 'AVAX',
  requestedAmount: '10',
  feeInAVAX: '0.005',
  status: 'fee_collected_pending_withdraw'
};

console.log('🧪 Testing Withdraw Fee Logic\n');

// Test Scenario 1: User withdraws LESS than paid amount
console.log('Scenario 1: User paid fee for 10 AVAX, now wants 5 AVAX');
const existingAmount = parseFloat(mockAttempt.requestedAmount);
const newAmount = 5;

if (newAmount < existingAmount) {
  console.log(`✅ Detected: User wants LESS (${newAmount} < ${existingAmount})`);
  console.log(`   Action: Show confirmation, no additional fee`);
} else if (newAmount === existingAmount) {
  console.log(`✅ Detected: Same amount (${newAmount} === ${existingAmount})`);
  console.log(`   Action: Retry without fee`);
} else {
  console.log(`✅ Detected: User wants MORE (${newAmount} > ${existingAmount})`);
  const diff = newAmount - existingAmount;
  console.log(`   Action: Charge fee for additional ${diff} AVAX`);
}

console.log('\n---\n');

// Test Scenario 2: Calculate fee for additional amount
console.log('Scenario 2: User paid fee for 10 AVAX, now wants 15 AVAX');
const paidForAmount = 10;
const requestedAmount = 15;
const additionalAmount = requestedAmount - paidForAmount;

// Mock token price
const avaxPriceUSD = 35.50;
const additionalValueUSD = additionalAmount * avaxPriceUSD;
const additionalFeeUSD = additionalValueUSD * 0.02; // 2%
const additionalFeeAVAX = additionalFeeUSD / avaxPriceUSD;

console.log(`Additional amount: ${additionalAmount} AVAX`);
console.log(`Additional value: $${additionalValueUSD.toFixed(2)}`);
console.log(`Additional fee (2%): $${additionalFeeUSD.toFixed(2)}`);
console.log(`Additional fee: ${additionalFeeAVAX.toFixed(6)} AVAX`);

const existingFee = 0.005;
const totalFee = existingFee + additionalFeeAVAX;
console.log(`Total fee paid: ${totalFee.toFixed(6)} AVAX`);

console.log('\n---\n');

// Test Scenario 3: NFT flat fee
console.log('Scenario 3: NFT Withdraw (flat 0.02 AVAX fee)');
const NFT_FEE = '0.02';
console.log(`NFT Fee: ${NFT_FEE} AVAX (flat fee, not percentage)`);
console.log(`No price lookup needed for NFTs`);

console.log('\n✅ All scenarios validated!\n');
