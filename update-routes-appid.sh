#!/bin/bash
# Script to add appId extraction to all routes

FILE="api/prizePoolRoutes.js"

# Backup first
cp $FILE ${FILE}.bak

echo "Adding appId extraction to routes..."

# For each route that needs appId, add the extraction line after guildId extraction
# The pattern: After "const { guildId } = req.params;" add "const appId = req.query.appId || req.body?.appId || null;"

sed -i.tmp '
/const { guildId } = req.params;/ {
    a\    const appId = req.query.appId || req.body?.appId || null; // Optional appId
}
' $FILE

# Update service method calls (only the ones that need updating, skip those already done)
# balance endpoint
sed -i.tmp 's/await prizePoolService.getBalance(guildId, ticker/await prizePoolService.getBalance(guildId, appId, ticker/g' $FILE

# donate endpoint
sed -i.tmp 's/prizePoolService.donateToPool(guildId, senderDiscordId/prizePoolService.donateToPool(guildId, appId, senderDiscordId/g' $FILE

# payout endpoint
sed -i.tmp 's/prizePoolService.payout(guildId, recipientDiscordId/prizePoolService.payout(guildId, appId, recipientDiscordId/g' $FILE

# claimEscrow endpoint
sed -i.tmp 's/prizePoolService.claimEscrow(guildId, discordId)/prizePoolService.claimEscrow(guildId, appId, discordId)/g' $FILE

# donate-nft endpoint
sed -i.tmp 's/prizePoolService.donateNFT(guildId, senderDiscordId/prizePoolService.donateNFT(guildId, appId, senderDiscordId/g' $FILE

# payout-nft endpoint
sed -i.tmp 's/prizePoolService.payoutNFT(guildId, recipientDiscordId/prizePoolService.payoutNFT(guildId, appId, recipientDiscordId/g' $FILE

# withdraw-nft endpoint (note: different parameter order)
sed -i.tmp 's/prizePoolService.withdrawNFT(senderDiscordId, toAddress, collection, tokenId, guildId)/prizePoolService.withdrawNFT(senderDiscordId, toAddress, collection, tokenId, guildId, appId)/g' $FILE

# Clean up temp files
rm ${FILE}.tmp

echo "✅ Routes updated with appId support"
echo "⚠️  Backup saved to ${FILE}.bak"
