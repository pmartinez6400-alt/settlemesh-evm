import { createHash } from "crypto";
import { ethers } from "ethers";
import { PolicyEngine, SpendingPolicy } from "./policy";
import { SellerAgent } from "./seller";
import { EventLog } from "./log";

/**
 * Buyer agent — hires seller agents for data/analysis services and settles
 * payment through the SettleMesh escrow.
 *
 * Safety model:
 *  1. The agent evaluates its PolicyEngine before every payment and refuses
 *     out-of-policy requests with explicit reasons.
 *  2. The SAME policy is enforced by the SettleMesh contract on-chain, so
 *     even a tricked or buggy agent cannot move money outside the policy.
 *  3. Funds sit in escrow and are released only after the delivered
 *     artifact's hash matches the payee's on-chain attestation.
 */

export interface HireResult {
  status: "settled" | "refused" | "chain-refused";
  jobId?: number;
  amountWei?: bigint;
  reasons?: string[];
  chainError?: string;
}

const JOB_CREATED_TOPIC = ethers.id(
  "JobCreated(uint256,address,address,uint256,bytes32,uint64)"
);

/** Extract a readable custom-error name from a revert, if possible. */
export function decodeRevert(err: any, iface: ethers.Interface): string {
  const candidates = [err?.data, err?.error?.data, err?.info?.error?.data];
  for (const data of candidates) {
    if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
      try {
        const parsed = iface.parseError(data);
        if (parsed) {
          const args = parsed.args?.length
            ? `(${[...parsed.args].map((a) => a?.toString()).join(", ")})`
            : "";
          return `${parsed.name}${args}`;
        }
      } catch {
        /* try next candidate */
      }
    }
  }
  return err?.shortMessage || err?.message || "revert";
}

export class BuyerAgent {
  readonly policy: PolicyEngine;

  constructor(
    private readonly signer: ethers.Signer,
    private readonly mesh: ethers.Contract,
    policy: SpendingPolicy,
    private readonly log: EventLog
  ) {
    this.policy = new PolicyEngine(policy);
  }

  get address(): Promise<string> {
    return this.signer.getAddress();
  }

  /** Publish the spending policy + payee allowlist on-chain and fund escrow. */
  async setup(policy: SpendingPolicy, fundWei: bigint) {
    const me = await this.address;
    // Explicit gas limits on every state-changing call: the HashKey testnet
    // RPC's eth_estimateGas can badly underestimate against a lagging node
    // (observed: 22,465 estimated for a 91,031-gas setPolicy, which then
    // reverted out-of-gas). Unused gas is refunded, so generous static
    // limits are free insurance. Local runs are unaffected.
    let tx = await this.mesh.setPolicy(policy.perPaymentCapWei, policy.dailyCapWei, {
      gasLimit: 500_000,
    });
    await tx.wait();
    this.log.policy(
      `policy published on-chain: per-payment cap ${ethers.formatEther(policy.perPaymentCapWei)} tHSK, ` +
        `daily cap ${ethers.formatEther(policy.dailyCapWei)} tHSK`
    );
    for (const payee of policy.allowlist) {
      tx = await this.mesh.setPayeeAllowed(payee, true, { gasLimit: 200_000 });
      await tx.wait();
      this.log.policy(`allowlisted payee ${payee}`);
    }
    tx = await this.mesh.deposit({ value: fundWei, gasLimit: 200_000 });
    const receipt = await tx.wait();
    this.log.job(
      `deposited ${ethers.formatEther(fundWei)} tHSK into escrow (buyer ${me})`,
      receipt.hash
    );
  }

  /** Attempt a raw createJob; returns the decoded on-chain refusal, if any. */
  async attemptJob(
    payee: string,
    amountWei: bigint,
    serviceRef: string,
    ttlSeconds = 3600
  ): Promise<{ ok: boolean; jobId?: number; chainError?: string; txHash?: string }> {
    try {
      const tx = await this.mesh.createJob(payee, amountWei, serviceRef, ttlSeconds, {
        gasLimit: 500_000,
      });
      const receipt = await tx.wait();
      const log = receipt.logs.find((l: any) => l.topics[0] === JOB_CREATED_TOPIC);
      const parsed = log ? this.mesh.interface.parseLog(log) : null;
      return {
        ok: true,
        jobId: parsed ? Number(parsed.args.jobId) : undefined,
        txHash: receipt.hash,
      };
    } catch (err) {
      // The tx may have been broadcast and reverted on-chain; ethers does
      // not always attach the revert data in that case, so decodeRevert can
      // only return the generic message. Replay the identical call via
      // eth_call to recover the typed custom error. No other job interleaves
      // between the mined attempt and this immediate replay, so the policy
      // verdict the replay produces is the one the chain enforced.
      let chainError = decodeRevert(err, this.mesh.interface);
      const txHash = (err as any)?.receipt?.hash as string | undefined;
      if (chainError === ((err as any)?.shortMessage ?? "transaction execution reverted")) {
        try {
          await this.mesh.createJob.staticCall(payee, amountWei, serviceRef, ttlSeconds);
        } catch (replayErr) {
          const decoded = decodeRevert(replayErr, this.mesh.interface);
          if (decoded !== ((replayErr as any)?.shortMessage ?? "transaction execution reverted")) {
            chainError = decoded;
          }
        }
      }
      return { ok: false, chainError, txHash };
    }
  }

  /**
   * Full A2A settlement flow with one seller agent.
   * @param opts.attemptOnChainWhenRefused If true, an agent-side refusal is
   *   followed by a real on-chain attempt, demonstrating that the contract
   *   independently refuses the payment (used in the demo's key scene).
   */
  async hire(
    seller: SellerAgent,
    sellerMesh: ethers.Contract,
    serviceId: string,
    subject: string,
    opts: { ttlSeconds?: number; attemptOnChainWhenRefused?: boolean } = {}
  ): Promise<HireResult> {
    const quote = seller.quote(serviceId, subject);
    const spentToday: bigint = await this.mesh.spentToday(await this.address);
    const decision = this.policy.evaluate(
      { payee: seller.address, amountWei: quote.priceWei, service: serviceId },
      spentToday
    );

    if (!decision.approved) {
      this.log.refusal(
        "BUYER",
        `REFUSED "${serviceId}" for ${subject} @ ${ethers.formatEther(quote.priceWei)} tHSK — ${decision.reasons.join("; ")}`
      );
      if (opts.attemptOnChainWhenRefused) {
        const attempt = await this.attemptJob(
          seller.address,
          quote.priceWei,
          quote.serviceRef,
          opts.ttlSeconds ?? 3600
        );
        if (!attempt.ok) {
          this.log.chainRefusal(
            `contract independently REFUSED the same payment on-chain: ${attempt.chainError}`,
            attempt.txHash
          );
          return { status: "chain-refused", reasons: decision.reasons, chainError: attempt.chainError };
        }
      }
      return { status: "refused", reasons: decision.reasons };
    }

    // Policy approved — escrow the payment on-chain.
    const created = await this.attemptJob(
      seller.address,
      quote.priceWei,
      quote.serviceRef,
      opts.ttlSeconds ?? 3600
    );
    if (!created.ok || created.jobId === undefined) {
      this.log.chainRefusal(`contract refused a policy-approved job: ${created.chainError}`);
      return { status: "chain-refused", chainError: created.chainError };
    }
    const jobId = created.jobId;
    this.log.job(
      `job #${jobId} escrowed: ${ethers.formatEther(quote.priceWei)} tHSK for "${serviceId}" (${subject})`,
      created.txHash
    );

    // Seller delivers off-chain and attests the artifact hash on-chain.
    const delivery = seller.deliver(quote);
    const attestTx = await sellerMesh.attestDelivery(jobId, delivery.deliveryHash, {
      gasLimit: 300_000,
    });
    const attestReceipt = await attestTx.wait();
    this.log.delivery(`seller attested delivery hash on-chain for job #${jobId}`, attestReceipt.hash);

    // Buyer verifies the artifact it received against the on-chain hash.
    const recomputed =
      "0x" + createHash("sha256").update(delivery.artifact, "utf8").digest("hex");
    // Read-your-writes: a remote RPC endpoint can serve a just-mined
    // attestation from a lagging node, returning deliveryHash = 0x0 for a
    // job that IS attested on-chain (observed on HashKey testnet, where an
    // immediate getJob read raced the attestation tx). Poll briefly until
    // the attested hash is visible before judging the delivery.
    let job = await this.mesh.getJob(jobId);
    for (
      let attempt = 0;
      job.deliveryHash !== delivery.deliveryHash && attempt < 12;
      attempt++
    ) {
      await new Promise((r) => setTimeout(r, 1500));
      job = await this.mesh.getJob(jobId);
    }
    if (recomputed !== delivery.deliveryHash || job.deliveryHash !== recomputed) {
      this.log.refusal("BUYER", `delivery hash mismatch for job #${jobId} — payment NOT released`);
      return { status: "refused", jobId, reasons: ["delivery hash mismatch"] };
    }
    this.log.info("BUYER", `delivery verified for job #${jobId} (hash matches attestation) — releasing payment`);

    const releaseTx = await this.mesh.releasePayment(jobId, { gasLimit: 300_000 });
    const releaseReceipt = await releaseTx.wait();
    this.log.payment(
      `job #${jobId} settled: ${ethers.formatEther(quote.priceWei)} tHSK released to seller ${seller.address}`,
      releaseReceipt.hash
    );
    return { status: "settled", jobId, amountWei: quote.priceWei };
  }
}
