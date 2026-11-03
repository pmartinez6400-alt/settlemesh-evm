import { ethers } from "ethers";

/**
 * SettleMesh agent-side policy engine.
 *
 * The buyer agent evaluates every payment request against this policy BEFORE
 * touching the chain and refuses out-of-policy requests with a clear reason.
 * The same rules are ALSO enforced by the SettleMesh contract on-chain, so a
 * refusal here is a courtesy layer — the guarantee does not depend on it.
 */

export interface SpendingPolicy {
  /** Max amount for a single payment, in wei. */
  perPaymentCapWei: bigint;
  /** Max total job value per UTC day, in wei. */
  dailyCapWei: bigint;
  /** Allowlisted payee addresses (lowercased). */
  allowlist: Set<string>;
}

export interface PaymentRequest {
  payee: string;
  amountWei: bigint;
  service: string;
}

export interface PolicyDecision {
  approved: boolean;
  /** Human-readable refusal reasons; empty when approved. */
  reasons: string[];
  /** Machine-readable violation codes, mirroring the contract's errors. */
  violations: Array<
    "ExceedsPerPaymentCap" | "ExceedsDailyCap" | "PayeeNotAllowlisted"
  >;
}

export class PolicyEngine {
  constructor(private readonly policy: SpendingPolicy) {}

  evaluate(req: PaymentRequest, spentTodayWei: bigint): PolicyDecision {
    const reasons: string[] = [];
    const violations: PolicyDecision["violations"] = [];
    const fmt = (w: bigint) => `${ethers.formatEther(w)} tHSK`;

    if (req.amountWei > this.policy.perPaymentCapWei) {
      violations.push("ExceedsPerPaymentCap");
      reasons.push(
        `amount ${fmt(req.amountWei)} exceeds per-payment cap ${fmt(this.policy.perPaymentCapWei)}`
      );
    }
    if (!this.policy.allowlist.has(req.payee.toLowerCase())) {
      violations.push("PayeeNotAllowlisted");
      reasons.push(`payee ${req.payee} is not on the allowlist`);
    }
    if (spentTodayWei + req.amountWei > this.policy.dailyCapWei) {
      violations.push("ExceedsDailyCap");
      reasons.push(
        `amount ${fmt(req.amountWei)} on top of today's ${fmt(spentTodayWei)} exceeds daily cap ${fmt(this.policy.dailyCapWei)}`
      );
    }
    return { approved: violations.length === 0, reasons, violations };
  }
}
