import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { BuyerAgent } from "./buyer";
import { SellerAgent } from "./seller";
import { PolicyEngine } from "./policy";
import { EventLog } from "./log";

/**
 * SettleMesh end-to-end demo (run: `npm run demo`, or `npm run demo:testnet`).
 *
 * Cast:
 *  - Buyer agent "TreasuryBot": holds a spending policy (per-payment cap
 *    0.005 tHSK, daily cap 0.012 tHSK, allowlist = the vetted seller only).
 *  - Seller agent "InsightAPI": sells token-risk analysis reports.
 *  - Rogue agent: an unvetted seller that tries to get paid anyway.
 *
 * Scenes:
 *  1. HAPPY PATH — buyer hires seller for a 0.003 tHSK risk report; escrow →
 *     delivery attestation → hash verification → payment released.
 *  2. THE REFUSAL — seller quotes a 0.009 tHSK premium deep-dive, above the
 *     per-payment cap. The buyer agent refuses… and then attempts the payment
 *     on-chain anyway, proving the CONTRACT refuses it too.
 *  3. STRANGER DANGER — the rogue (non-allowlisted) agent's payment request
 *     is refused by policy and by the chain.
 *  4. DAILY CAP — after further settlements, an in-cap payment is refused
 *     because it would breach the daily cap.
 *  5. NO DELIVERY, NO PAYMENT — an escrowed job that is never delivered is
 *     refunded after its deadline; budget restored.
 *
 * Exports dashboard/state.json for the static dashboard.
 */

const STATUS = ["None", "Funded", "Delivered", "Released", "Cancelled", "Refunded"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const isLocal = chainId === 31337;
  const explorerTx = isLocal ? null : "https://testnet-explorer.hsk.xyz/tx/";
  const log = new EventLog(explorerTx);

  // --- Cast -------------------------------------------------------------
  let buyerSigner: any, sellerSigner: any, rogueSigner: any, deployer: any;
  if (isLocal) {
    [deployer, buyerSigner, sellerSigner, rogueSigner] = await ethers.getSigners();
  } else {
    // Testnet: a single throwaway dev key funds three fresh agent wallets.
    [deployer] = await ethers.getSigners();
    const deployerBal = await ethers.provider.getBalance(deployer.address);
    if (deployerBal < ethers.parseEther("0.035")) {
      console.error(
        `\nThrowaway deployer ${deployer.address} has only ${ethers.formatEther(deployerBal)} tHSK.\n` +
          `Fund it (>= 0.035 tHSK) from the HashKey testnet faucet, then re-run.\n`
      );
      process.exit(1);
    }
    buyerSigner = ethers.Wallet.createRandom().connect(ethers.provider);
    sellerSigner = ethers.Wallet.createRandom().connect(ethers.provider);
    rogueSigner = ethers.Wallet.createRandom().connect(ethers.provider);
    // Funding is sized to each wallet's role and to the faucet-constrained
    // deployer balance (~0.1 tHSK per drip): the buyer transacts in every
    // scene (policy, 0.02 escrow deposit, jobs, releases, refund — roughly
    // 0.001 tHSK of gas in total), the seller only attests two deliveries,
    // and the rogue never sends a transaction.
    const funding: Array<[any, string]> = [
      [buyerSigner, "0.024"],
      [sellerSigner, "0.003"],
      [rogueSigner, "0.001"],
    ];
    for (const [w, amount] of funding) {
      const tx = await deployer.sendTransaction({
        to: w.address,
        value: ethers.parseEther(amount),
      });
      await tx.wait();
    }
    log.info("SYSTEM", "funded three fresh agent wallets from the throwaway deployer key");
  }
  const buyerAddr = await buyerSigner.getAddress();
  const sellerAddr = await sellerSigner.getAddress();
  const rogueAddr = await rogueSigner.getAddress();

  // --- Deploy -----------------------------------------------------------
  const factory = await ethers.getContractFactory("SettleMesh", deployer);
  const mesh = await factory.deploy({ gasLimit: 3_000_000 });
  await mesh.waitForDeployment();
  const meshAddr = await mesh.getAddress();
  log.info("SYSTEM", `SettleMesh deployed at ${meshAddr} (chain ${chainId}${isLocal ? ", local" : ", HashKey testnet"})`);

  const meshAsBuyer = mesh.connect(buyerSigner) as any;
  const meshAsSeller = mesh.connect(sellerSigner) as any;
  const meshAsRogue = mesh.connect(rogueSigner) as any;

  // --- Policy -----------------------------------------------------------
  const policy = {
    perPaymentCapWei: ethers.parseEther("0.005"),
    dailyCapWei: ethers.parseEther("0.012"),
    allowlist: new Set([sellerAddr.toLowerCase()]),
  };
  const buyer = new BuyerAgent(buyerSigner, meshAsBuyer, policy, log);
  const seller = new SellerAgent(sellerAddr, log);
  const rogue = new SellerAgent(rogueAddr, log, "RogueAgent (unvetted)");

  await buyer.setup(policy, ethers.parseEther("0.02"));

  // --- Scene 1: happy path ----------------------------------------------
  console.log("\n=== SCENE 1 · Happy path: buy a token risk report (0.003 tHSK) ===");
  const r1 = await buyer.hire(seller, meshAsSeller, "token-risk-report", "HSK", {
    ttlSeconds: 3600,
  });

  // --- Scene 2: the refusal (over per-payment cap) -----------------------
  console.log("\n=== SCENE 2 · The refusal: premium deep-dive quoted at 0.009 tHSK (cap is 0.005) ===");
  const r2 = await buyer.hire(seller, meshAsSeller, "deep-dive-report", "HSK", {
    attemptOnChainWhenRefused: true,
  });

  // --- Scene 3: non-allowlisted rogue payee ------------------------------
  console.log("\n=== SCENE 3 · Stranger danger: unvetted agent requests payment (0.003 tHSK) ===");
  const r3 = await buyer.hire(rogue, meshAsRogue, "token-risk-report", "HSK", {
    attemptOnChainWhenRefused: true,
  });

  // --- Scene 4: daily cap -------------------------------------------------
  console.log("\n=== SCENE 4 · One more legit job (0.005), then the daily cap bites ===");
  const r4 = await buyer.hire(seller, meshAsSeller, "portfolio-scan", "HSK+BTC+ETH", {
    ttlSeconds: 3600,
  });
  const engine = new PolicyEngine(policy);
  const spentNow: bigint = await meshAsBuyer.spentToday(buyerAddr);
  // A further 0.005 portfolio scan is within the per-payment cap, but
  // 0.008 already spent + 0.005 = 0.013 > 0.012 daily cap — it must be refused.
  const quote5 = seller.quote("portfolio-scan", "BTC+ETH+SOL");
  const decision5 = engine.evaluate(
    { payee: sellerAddr, amountWei: quote5.priceWei, service: "portfolio-scan" },
    spentNow
  );
  if (!decision5.approved) {
    log.refusal(
      "BUYER",
      `REFUSED another portfolio scan @ ${ethers.formatEther(quote5.priceWei)} tHSK — ${decision5.reasons.join("; ")}`
    );
    const attempt = await buyer.attemptJob(sellerAddr, quote5.priceWei, quote5.serviceRef);
    if (!attempt.ok) {
      log.chainRefusal(`contract independently REFUSED it on-chain: ${attempt.chainError}`, attempt.txHash);
    }
  }

  // --- Scene 5: no delivery → refund after deadline -----------------------
  console.log("\n=== SCENE 5 · Escrow without delivery: refund after deadline ===");
  // Fresh buyer budget check: use a small job under a fresh policy allowance.
  // (Daily spend so far: scenes 1+4 = 0.008 of 0.012 cap, so 0.002 fits.)
  const ghostQuote = seller.quote("token-risk-report", "GHOST");
  const ghost = await buyer.attemptJob(sellerAddr, ethers.parseEther("0.002"), ghostQuote.serviceRef, 5);
  if (ghost.ok && ghost.jobId !== undefined) {
    log.job(`job #${ghost.jobId} escrowed 0.002 tHSK — seller never delivers`, ghost.txHash);
    if (isLocal) {
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine", []);
    } else {
      console.log("   …waiting ~8s for the job deadline to pass on testnet…");
      await sleep(9000);
    }
    const refundTx = await meshAsBuyer.refundJob(ghost.jobId, { gasLimit: 300_000 });
    const refundReceipt = await refundTx.wait();
    log.refund(`job #${ghost.jobId} expired undelivered — 0.002 tHSK refunded, daily budget restored`, refundReceipt.hash);
  } else {
    log.info("SYSTEM", `scene 5 setup job failed unexpectedly: ${ghost.chainError}`);
  }

  // --- Summary + dashboard state ------------------------------------------
  const spentToday: bigint = await meshAsBuyer.spentToday(buyerAddr);
  const escrowFree: bigint = await meshAsBuyer.balanceOf(buyerAddr);

  const jobCount: bigint = await meshAsBuyer.jobCount();
  const jobs: any[] = [];
  let releasedTotal = 0n;
  for (let i = 0; i < Number(jobCount); i++) {
    const j = await meshAsBuyer.getJob(i);
    if (STATUS[Number(j.status)] === "Released") releasedTotal += j.amount;
    jobs.push({
      id: i,
      buyer: j.buyer,
      payee: j.payee,
      amount: ethers.formatEther(j.amount),
      amountWei: j.amount.toString(),
      serviceRef: j.serviceRef,
      deliveryHash: j.deliveryHash,
      deadline: Number(j.deadline),
      status: STATUS[Number(j.status)],
    });
  }
  // "Earned" = sum of released job payments (seller's raw balance delta
  // would also include the gas it paid to attest deliveries).
  const sellerEarned = releasedTotal;

  console.log("\n=== SUMMARY ===");
  console.log(`Seller earned:        ${ethers.formatEther(sellerEarned)} tHSK (released job payments)`);
  console.log(`Buyer spent today:    ${ethers.formatEther(spentToday)} tHSK (daily cap 0.012)`);
  console.log(`Buyer escrow balance: ${ethers.formatEther(escrowFree)} tHSK free`);
  console.log(
    `Outcomes: scene1=${r1.status} scene2=${r2.status} scene3=${r3.status} scene4=${r4.status}`
  );

  const state = {
    generatedAt: new Date().toISOString(),
    network: isLocal ? "Hardhat (local)" : "HashKey Chain Testnet",
    chainId,
    contractAddress: meshAddr,
    explorer: {
      txBase: explorerTx,
      addressBase: isLocal ? null : "https://testnet-explorer.hsk.xyz/address/",
    },
    policy: {
      perPaymentCap: ethers.formatEther(policy.perPaymentCapWei),
      dailyCap: ethers.formatEther(policy.dailyCapWei),
      allowlist: [...policy.allowlist],
    },
    agents: {
      buyer: { name: "TreasuryBot (Buyer Agent)", address: buyerAddr, escrowFree: ethers.formatEther(escrowFree), spentToday: ethers.formatEther(spentToday) },
      seller: { name: "InsightAPI (Seller Agent)", address: sellerAddr, earned: ethers.formatEther(sellerEarned) },
      rogue: { name: "RogueAgent (unvetted)", address: rogueAddr },
    },
    jobs,
    events: log.events,
  };
  const outPath = path.join(__dirname, "..", "dashboard", "state.json");
  fs.writeFileSync(outPath, JSON.stringify(state, null, 2));
  console.log(`\nDashboard state written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
