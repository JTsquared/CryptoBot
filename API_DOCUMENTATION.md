# CryptoTip API Reference

Prize pool management API for Discord bots on Avalanche C-Chain.

**Base URL:** `http://34.162.131.64:3000/api/prizepool`

---

## Authentication

### External Requests
Include API key in header:
```
x-api-key: your-api-key-here
```

### Rate Limiting
- 100 requests per 15 minutes per IP
- Localhost requests excluded

---

## Parameters

### Global Parameters
| Parameter |  Type  | Location   | Required | Description                |
|-----------|--------|------------|----------|----------------------------|
| `appId`   | string | query/body |  **Yes** | Discord bot Application ID |
| `guildId` | string |    path    |  **Yes** | Discord guild/server ID    |

---

## Endpoints

### Create Wallet
`POST /create/:guildId`

Creates a new prize pool wallet.

**Parameters:**
```
?appId={botAppId}
```

**Response:**
```json
{
  "success": true,
  "wallet": {
    "guildId": "123456789",
    "appId": "1243747782691524680",
    "address": "0x..."
  }
}
```

**Errors:** `WALLET_ALREADY_EXISTS`

---

### Get Balances
`GET /balances/:guildId`

Get all token balances with available/reserved amounts.

**Parameters:**
```
?appId={botAppId}
&includeZeros=false  // optional
```

**Response:**
```json
{
  "success": true,
  "address": "0x...",
  "balances": [
    {
      "ticker": "AVAX",
      "formatted": "1.5",
      "reserved": 0.5,
      "available": 1.0,
      "decimals": 18
    }
  ]
}
```

**Errors:** `NO_WALLET`, `NETWORK_ERROR`

---

### Get Single Balance
`GET /balance/:guildId/:ticker`

Get balance for one token.

**Parameters:**
```
?appId={botAppId}
```

**Response:** Same as balances endpoint

**Errors:** `NO_WALLET`, `UNKNOWN_TOKEN`

---

### Donate Tokens
`POST /donate/:guildId`

Transfer tokens from user wallet to prize pool.

**Body:**
```json
{
  "appId": "1243747782691524680",
  "senderDiscordId": "401423933322297355",
  "amount": "100",
  "ticker": "DISH"
}
```

**Response:**
```json
{
  "success": true,
  "txHash": "0x...",
  "amount": "100",
  "ticker": "DISH",
  "poolAddress": "0x..."
}
```

**Errors:** `NO_WALLET`, `NO_SENDER_WALLET`, `INSUFFICIENT_FUNDS`

---

### Payout Tokens
`POST /payout/:guildId`

Send tokens from prize pool to user. Creates escrow if transfer fails.

**Body:**
```json
{
  "appId": "1243747782691524680",
  "recipientDiscordId": "401423933322297355",
  "ticker": "DISH",
  "amount": "100"  // or "all"
}
```

**Response:**
```json
{
  "success": true,
  "txs": [
    {
      "token": "DISH",
      "txHash": "0x...",
      "amount": "100"
    }
  ],
  "failures": [],
  "escrowEntries": [],
  "summary": {
    "successful": 1,
    "failed": 0,
    "escrowed": 0
  }
}
```

**Errors:** `NO_WALLET`, `NO_SENDER_WALLET`, `NO_FUNDS`, `INSUFFICIENT_GAS`

---

### Create Escrow
`POST /escrow/create/:guildId`

Reserve tokens for future payout.

**Body (Token):**
```json
{
  "appId": "1243747782691524680",
  "discordId": "401423933322297355",
  "token": "DISH",
  "amount": "100"  // or "all"
}
```

**Body (NFT):**
```json
{
  "appId": "1243747782691524680",
  "discordId": "401423933322297355",
  "token": "Obeez",
  "isNFT": true,
  "contractAddress": "0x...",
  "tokenId": "1234"
}
```

**Response:**
```json
{
  "success": true,
  "entriesCreated": 1,
  "message": "Created 1 escrow entry"
}
```

---

### Claim Escrow
`POST /escrow/claim/:guildId`

Attempt to send all pending escrow on-chain.

**Body:**
```json
{
  "appId": "1243747782691524680",
  "discordId": "401423933322297355"
}
```

**Response:**
```json
{
  "success": true,
  "successMsgs": [
    "✅ Claimed 100 DISH - TX: 0x..."
  ],
  "failMsgs": [],
  "summary": {
    "totalClaims": 1,
    "successful": 1,
    "failed": 0
  }
}
```

**Errors:** `NO_WALLET`, `NO_ESCROW`

---

### Donate NFT
`POST /donate-nft/:guildId`

Transfer NFT from user to prize pool.

**Body:**
```json
{
  "appId": "1243747782691524680",
  "senderDiscordId": "401423933322297355",
  "collection": "Obeez",
  "tokenId": "1234"
}
```

**Response:**
```json
{
  "success": true,
  "txHash": "0x...",
  "collection": "Obeez",
  "tokenId": "1234"
}
```

---

### Payout NFT
`POST /payout-nft/:guildId`

Send NFT from prize pool to user.

**Body:**
```json
{
  "appId": "1243747782691524680",
  "recipientDiscordId": "401423933322297355",
  "collection": "Obeez",
  "tokenId": "1234"
}
```

**Response:**
```json
{
  "success": true,
  "txHash": "0x...",
  "collection": "Obeez",
  "tokenId": "1234"
}
```

---

### Verify NFT
`POST /verify-nft/:guildId`

Check if prize pool owns NFT and if it's reserved.

**Body:**
```json
{
  "appId": "1243747782691524680",
  "collection": "Obeez",
  "tokenId": "1234"
}
```

**Response:**
```json
{
  "success": true,
  "owner": "0x..."
}
```

**Errors:** `NOT_OWNER`, `NFT_RESERVED`

---

### Get NFT Balances
`GET /nft-balances/:guildId`

List all NFTs in prize pool.

**Parameters:**
```
?appId={botAppId}
```

**Response:**
```json
{
  "success": true,
  "nfts": [
    {
      "collection": "Obeez",
      "name": "Obeez",
      "count": 3
    }
  ],
  "availableNFTs": [
    {
      "collection": "Obeez",
      "tokenId": "1234",
      "contractAddress": "0x...",
      "name": "Obeez #1234",
      "available": true
    }
  ],
  "reservedNFTs": []
}
```

---

### Get NFT Metadata
`POST /nft-metadata`

Fetch NFT name and image from contract.

**Body:**
```json
{
  "contractAddress": "0x...",
  "tokenId": "1234"
}
```

**Response:**
```json
{
  "success": true,
  "name": "Obeez #1234",
  "imageUrl": "https://..."
}
```

---

## Supported Tokens

- AVAX (native)
- SOCK
- DISH
- DEGEN
- VAPE
- FLD
- BTC.b
- ART

## Supported NFT Collections

- Obeez
- Dimish
- Salvor

---

## Error Codes

| Code | Description |
|------|-------------|
| `WALLET_ALREADY_EXISTS` | Wallet for this guild+appId exists |
| `NO_WALLET` | Prize pool wallet not found |
| `NO_SENDER_WALLET` | User has no registered wallet |
| `UNKNOWN_TOKEN` | Token not in whitelist |
| `UNKNOWN_NFT_COLLECTION` | NFT collection not whitelisted |
| `INSUFFICIENT_FUNDS` | Not enough tokens |
| `INSUFFICIENT_GAS` | Not enough AVAX for gas |
| `NO_FUNDS` | No available balance after escrow |
| `NOT_NFT_OWNER` | User doesn't own the NFT |
| `POOL_NOT_OWNER` | Prize pool doesn't own the NFT |
| `NFT_RESERVED` | NFT is escrowed |
| `NETWORK_ERROR` | RPC provider error |
| `PAYOUT_FAILURE` | Transfer failed (check failures array) |
| `SERVER_ERROR` | Internal error |

---

## Example: Node.js

```javascript
const CRYPTOBOT_URL = 'http://34.162.131.64:3000';
const BOT_APP_ID = client.user.id;

// Get balances
const response = await fetch(
  `${CRYPTOBOT_URL}/api/prizepool/balances/${guildId}?appId=${BOT_APP_ID}`
);
const { balances } = await response.json();

// Payout tokens
await fetch(
  `${CRYPTOBOT_URL}/api/prizepool/payout/${guildId}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appId: BOT_APP_ID,
      recipientDiscordId: winner.id,
      ticker: 'DISH',
      amount: '100'
    })
  }
);
```
