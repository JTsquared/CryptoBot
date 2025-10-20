// utils/tokenConfig.js
  export const TESTNET_TOKEN_MAP = {
    "AVAX": "native", // Special case for native AVAX
    "DISH": "0xc18A73e3a4Ad464A6e95D842689D3FBaa896a908",
    "SOCK": "0xe3315f7EE916eD355Fd69B7fB61C54313A8309a7",
    "FLD": "0x26dc8c4B2d52C659FBfDFE53391C1Db11402926d",
    "DEGEN": "0xA0f1De56d6a4384fb47c68565b6312A9dEA77eA5",
    "VAPE": "0xB68Ea2Ea0AEcb7Fc5f0EDF19546F5E272B9349b8",
    "SQRD": "0xc281684d4cdc182304a95537655e94330dbf500e",
  }

  export const MAINNET_TOKEN_MAP = {
    "AVAX": "native", // Special case for native AVAX
    "DISH": "0x40146E96EE5297187022D1ca62A3169B5e45B0a4",
    "SOCK": "0xBEd8E312Bcb5C5a283e0030449c254F4c59C092E",
    "FLD": "0x88F89BE3E9b1dc1C5F208696fb9cABfcc684bD5F",
    "DEGEN": "0x95430905F4B0dA123d41BA96600427d2C92B188a",
    "VAPE": "0x7bddaF6DbAB30224AA2116c4291521C7a60D5f55",
    "BTC.b": "0x152b9d0FdC40C096757F570A51E494bd4b943E50",
    "ART": "0xF99516BC189AF00FF8EfFD5A1f2295B67d70a90e",
    "BLAZE": "0x297731Eb3CAB3834525fc9Ea061fd71d8f4645C9",
    "FREAK": "0x201d04f88Bc9B3bdAcdf0519a95E117f25062D38",
    "VPND": "0x83a283641C6B4DF383BCDDf807193284C84c5342",
  }

  export const testnetMainnetTokenMap = {
    // Fuji => Mainnet
    "0xd00ae08403b9bbb9124bb305c09058e32c39a48c": "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", // WAVAX
    "0x5425890298aed601595a70ab815c96711a31bc65": "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e", // USDC
    "0x200ad2e097d1ffa24f243c04c8d7dd1be26c1f05": "0xacc95afa65768aa74044e6f6e267ad6417cd3e55", // BOI
    "0x7dba53d2232e1d17b3f5fb1f5aa45cbb3cb403ff": "0x152b9d0fdc40c096757f570a51e494bd4b943e50", // BTC.b
    "0xe3315f7ee916ed355fd69b7fb61c54313a8309a7": "0xbed8e312bcb5c5a283e0030449c254f4c59c092e", // SOCK
    "0x0256B279D973C8d687264AC3eB36bE09232D4474": "0x0256B279D973C8d687264AC3eB36bE09232D4474", // MYST
    "0xc18a73e3a4ad464a6e95d842689d3fbaa896a908": "0x40146e96ee5297187022d1ca62a3169b5e45b0a4", // DISH
    "0x26dc8c4b2d52c659fbfdfe53391c1db11402926d": "0x88f89be3e9b1dc1c5f208696fb9cabfcc684bd5f", // FLD
    "0xa0f1de56d6a4384fb47c68565b6312a9dea77ea5": "0x95430905f4b0da123d41ba96600427d2c92b188a", // DEGEN
    "0xb68ea2ea0aecb7fc5f0edf19546f5e272b9349b8": "0x7bddaf6dbab30224aa2116c4291521c7a60d5f55", // VAPE
  };
  
  // ERC-20 ABI (minimal - just what we need)
  export const ERC20_ABI = [
    "function transfer(address to, uint256 amount) external returns (bool)",
    "function balanceOf(address owner) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function name() view returns (string)",
    "event Transfer(address indexed from, address indexed to, uint256 value)"
  ];

  // ERC-721 ABI (for NFTs)
  export const ERC721_ABI = [
    "function balanceOf(address owner) view returns (uint256)",
    "function transferFrom(address from, address to, uint256 tokenId)",
    "function safeTransferFrom(address from, address to, uint256 tokenId)",
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function tokenURI(uint256 tokenId) view returns (string)",
    "function approve(address to, uint256 tokenId)",
    "function setApprovalForAll(address operator, bool approved)",
    "function getApproved(uint256 tokenId) view returns (address)",
    "function isApprovedForAll(address owner, address operator) view returns (bool)",
    "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
  ];
  
  // Get all token choices for slash commands
// ✅ Token choices, evaluated at runtime
// export function getTokenChoices() {
//   const map = getTokenMap();
//   console.log(map);
//   return Object.keys(map).map(token => ({
//     name: token,
//     value: token,
//   }));
// }

// ✅ Safe getter for address
export function getTokenAddress(ticker) {
  const map = getTokenMap();
  console.log(`Getting address for ticker: ${ticker}`);
  return map[ticker];
}

// ✅ Native token check — doesn't rely on the map
export function isNativeToken(ticker) {
  return ticker === "AVAX";
}

  // export function getTokenMap() {
  //   const network = process.env.NETWORK;
  //   console.log('network: ' + network);
  //   const map = network === "mainnet" ? MAINNET_TOKEN_MAP : TESTNET_TOKEN_MAP;
  //   console.log(`DISH address for ‘${network}’: ${map.DISH}`);
  //   return map;
  // }

  export function getTokenMap(network = process.env.NETWORK) {
    console.log('network: ' + network);
    return network === "mainnet" ? MAINNET_TOKEN_MAP : TESTNET_TOKEN_MAP;
  }
  
  export function getTokenChoices(network = process.env.NETWORK) {
    const tokenMap = getTokenMap(network);
    return Object.keys(tokenMap).map(ticker => ({ name: ticker, value: ticker }));
  }