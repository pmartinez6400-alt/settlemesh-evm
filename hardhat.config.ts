import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as fs from "fs";
import * as path from "path";

// Optional throwaway dev key for HashKey Chain *testnet only*.
// Generated locally by `npm run genkey`. NEVER a user's wallet, NEVER mainnet.
function throwawayKey(): string[] {
  const keyFile = path.join(__dirname, ".throwaway-key.json");
  if (fs.existsSync(keyFile)) {
    try {
      const { privateKey } = JSON.parse(fs.readFileSync(keyFile, "utf8"));
      if (typeof privateKey === "string" && privateKey.startsWith("0x")) {
        return [privateKey];
      }
    } catch {
      /* ignore malformed key file */
    }
  }
  return [];
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: {
      // Local demo network (in-process). Chain id 31337 is Hardhat default.
    },
    hashkeyTestnet: {
      // HashKey Chain Testnet — chain ID 133, native token tHSK.
      url: process.env.HSK_TESTNET_RPC || "https://testnet.hsk.xyz",
      chainId: 133,
      accounts: throwawayKey(),
    },
  },
  // Block explorer base used to build links in demo output / dashboard state.
  // Testnet explorer: https://testnet-explorer.hsk.xyz
};

export default config;
