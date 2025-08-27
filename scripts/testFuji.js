import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider("https://api.avax-test.network/ext/bc/C/rpc");

(async () => {
  try {
    const net = await provider.getNetwork();
    console.log("Connected:", net);
  } catch (err) {
    console.error("Provider error:", err);
  }
})();