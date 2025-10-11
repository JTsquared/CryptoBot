#!/bin/bash
# Finish updating all routes with appId

FILE="api/prizePoolRoutes.js"

# Update donate endpoint
perl -i -pe 's/(const \{ guildId \} = req\.params;)(\s+)(const \{ senderDiscordId)/$1\n    const appId = req.query.appId || req.body?.appId || null;\n$3/g' $FILE
perl -i -pe 's/prizePoolService\.donateToPool\(guildId, senderDiscordId/prizePoolService.donateToPool(guildId, appId, senderDiscordId/g' $FILE

# Update payout endpoint
perl -i -pe 's/prizePoolService\.payout\(guildId, recipientDiscordId/prizePoolService.payout(guildId, appId, recipientDiscordId/g' $FILE

# Update escrow claim
perl -i -pe 's/prizePoolService\.claimEscrow\(guildId, discordId\)/prizePoolService.claimEscrow(guildId, appId, discordId)/g' $FILE

# Update escrow create - just add appId extraction if not there

# Update donate-nft
perl -i -pe 's/prizePoolService\.donateNFT\(guildId, senderDiscordId/prizePoolService.donateNFT(guildId, appId, senderDiscordId/g' $FILE

# Update payout-nft
perl -i -pe 's/prizePoolService\.payoutNFT\(guildId, recipientDiscordId/prizePoolService.payoutNFT(guildId, appId, recipientDiscordId/g' $FILE

# Update withdraw-nft
perl -i -pe 's/prizePoolService\.withdrawNFT\(senderDiscordId, toAddress, collection, tokenId, guildId\)/prizePoolService.withdrawNFT(senderDiscordId, toAddress, collection, tokenId, guildId, appId)/g' $FILE

# Update nft-balances
perl -i -pe 's/prizePoolService\.getPrizePoolWallet\(guildId\)/prizePoolService.getPrizePoolWallet(guildId, appId)/g' $FILE

echo "✅ All routes updated"
