// utils/nftConfig.js

export const TESTNET_NFT_MAP = {
  "OBEEZ": {
    address: "0x5dbC5A50df2B7b61b5C67FecFe552D8984424315",
    standard: "ERC721",
    name: "Obeez"
  }
};

export const MAINNET_NFT_MAP = {
  "OBEEZ": {
    address: "0x5E870b3d315F7A8d7089E8B829eD8C3d9cef06eF",
    standard: "ERC721",
    name: "Obeez"
  }
};

export function getNFTMap(network = process.env.NETWORK) {
  console.log('NFT network: ' + network);
  return network === "mainnet" ? MAINNET_NFT_MAP : TESTNET_NFT_MAP;
}

export function isNFTCollection(ticker) {
  const nftMap = getNFTMap();
  return !!nftMap[ticker];
}

export function getNFTAddress(ticker) {
  const nftMap = getNFTMap();
  return nftMap[ticker]?.address;
}

export function getNFTStandard(ticker) {
  const nftMap = getNFTMap();
  return nftMap[ticker]?.standard;
}

export function getNFTChoices(network = process.env.NETWORK) {
  const nftMap = getNFTMap(network);
  return Object.keys(nftMap).map(ticker => ({
    name: `${nftMap[ticker].name} (NFT)`,
    value: ticker
  }));
}
