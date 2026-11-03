import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

/**
 * Generate a FRESH throwaway developer key for HashKey Chain TESTNET ONLY.
 * This key is created locally for this hackathon project, holds no real
 * funds, and is never a user's wallet. Stored in .throwaway-key.json,
 * which is git-ignored and must never be committed or shared.
 */
async function main() {
  const keyFile = path.join(__dirname, "..", ".throwaway-key.json");
  if (fs.existsSync(keyFile)) {
    const existing = JSON.parse(fs.readFileSync(keyFile, "utf8"));
    console.log(`Throwaway key already exists for address ${existing.address}`);
    console.log(`Fund it with testnet tHSK (chain 133) via the HashKey faucet.`);
    return;
  }
  const wallet = ethers.Wallet.createRandom();
  fs.writeFileSync(
    keyFile,
    JSON.stringify(
      { address: wallet.address, privateKey: wallet.privateKey, createdAt: new Date().toISOString(), note: "TESTNET ONLY throwaway dev key — no real funds, not a user wallet." },
      null,
      2
    ),
    { mode: 0o600 }
  );
  console.log(`Created throwaway testnet dev key: ${wallet.address}`);
  console.log(`Saved to .throwaway-key.json (git-ignored).`);
  console.log(`Next: fund it with tHSK from the HashKey Chain testnet faucet (chain ID 133).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
