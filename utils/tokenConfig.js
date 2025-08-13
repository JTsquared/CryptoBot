// utils/tokenConfig.js

// Token mapping - contract addresses to tickers
export const TOKEN_MAP = {
    "AVAX": "native", // Special case for native AVAX
    "DISH": "0xc18A73e3a4Ad464A6e95D842689D3FBaa896a908",
    "SOCK": "0xe3315f7EE916eD355Fd69B7fB61C54313A8309a7",
    "FLD": "0x26dc8c4B2d52C659FBfDFE53391C1Db11402926d",
    "DEGEN": "0xA0f1De56d6a4384fb47c68565b6312A9dEA77eA5",
    "VAPE": "0xB68Ea2Ea0AEcb7Fc5f0EDF19546F5E272B9349b8"
  };
  
  // ERC-20 ABI (minimal - just what we need)
  export const ERC20_ABI = [
    "function transfer(address to, uint256 amount) external returns (bool)",
    "function balanceOf(address owner) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function name() view returns (string)"
  ];
  
  // Get all token choices for slash commands
  export const TOKEN_CHOICES = Object.keys(TOKEN_MAP).map(token => ({
    name: token,
    value: token
  }));
  
  // Helper function to get contract address
  export const getTokenAddress = (ticker) => {
    return TOKEN_MAP[ticker];
  };
  
  // Helper function to check if token is native AVAX
  export const isNativeToken = (ticker) => {
    return ticker === "AVAX";
  };