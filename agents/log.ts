/** Small structured logger + event recorder shared by the agents and demo.
 *  Every notable moment is both printed (clear, tagged console log) and
 *  recorded into an event list that the demo exports to the dashboard. */

export interface DemoEvent {
  ts: string; // ISO timestamp
  actor: "BUYER" | "SELLER" | "ROGUE" | "CHAIN" | "SYSTEM";
  kind:
    | "info"
    | "policy"
    | "quote"
    | "job"
    | "delivery"
    | "payment"
    | "refusal" // agent-side policy refusal
    | "chain-refusal" // on-chain revert enforcing the policy
    | "refund";
  message: string;
  txHash?: string;
  explorerUrl?: string | null;
}

export class EventLog {
  readonly events: DemoEvent[] = [];

  constructor(private readonly explorerTxBase: string | null) {}

  private push(
    actor: DemoEvent["actor"],
    kind: DemoEvent["kind"],
    message: string,
    txHash?: string
  ) {
    const ev: DemoEvent = {
      ts: new Date().toISOString(),
      actor,
      kind,
      message,
      txHash,
      explorerUrl:
        txHash && this.explorerTxBase ? `${this.explorerTxBase}${txHash}` : null,
    };
    this.events.push(ev);
    const tag = actor.padEnd(6, " ");
    const marker =
      kind === "refusal" || kind === "chain-refusal"
        ? "⛔"
        : kind === "payment"
          ? "💸"
          : kind === "delivery"
            ? "📦"
            : "·";
    console.log(`[${tag}] ${marker} ${message}${txHash ? `  (tx ${txHash.slice(0, 18)}…)` : ""}`);
    return ev;
  }

  info(actor: DemoEvent["actor"], msg: string) {
    return this.push(actor, "info", msg);
  }
  policy(msg: string) {
    return this.push("BUYER", "policy", msg);
  }
  quote(actor: DemoEvent["actor"], msg: string) {
    return this.push(actor, "quote", msg);
  }
  job(msg: string, txHash?: string) {
    return this.push("BUYER", "job", msg, txHash);
  }
  delivery(msg: string, txHash?: string) {
    return this.push("SELLER", "delivery", msg, txHash);
  }
  payment(msg: string, txHash?: string) {
    return this.push("CHAIN", "payment", msg, txHash);
  }
  refusal(actor: DemoEvent["actor"], msg: string) {
    return this.push(actor, "refusal", msg);
  }
  chainRefusal(msg: string, txHash?: string) {
    return this.push("CHAIN", "chain-refusal", msg, txHash);
  }
  refund(msg: string, txHash?: string) {
    return this.push("CHAIN", "refund", msg, txHash);
  }
}
