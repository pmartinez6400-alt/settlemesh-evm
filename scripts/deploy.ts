import { ethers } from "hardhat";

/** Deploy SettleMesh to the selected network.
 *  Local:   npm run deploy:local
 *  Testnet: npm run genkey  (once, then fund the address from the faucet)
 *           npm run deploy:testnet
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(
    `Deploying SettleMesh from ${deployer.address} on chain ${network.chainId} ` +
      `(balance ${ethers.formatEther(balance)} tHSK)`
  );
  if (balance === 0n) {
    throw new Error("Deployer has no funds. On testnet, use the HashKey faucet first.");
  }
  const factory = await ethers.getContractFactory("SettleMesh");
  const mesh = await factory.deploy();
  await mesh.waitForDeployment();
  const address = await mesh.getAddress();
  console.log(`SettleMesh deployed: ${address}`);
  if (Number(network.chainId) === 133) {
    console.log(`Explorer: https://testnet-explorer.hsk.xyz/address/${address}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
