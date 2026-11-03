import { createHash } from "crypto";
import { ethers } from "ethers";
import * as http from "http";
import { EventLog } from "./log";

/**
 * Seller agent — offers a paid on-chain data/analysis service ("InsightAPI").
 *
 * Services are priced in tHSK. Delivery is a JSON report; the seller commits
 * the report's SHA-256 hash on-chain as the delivery attestation, and the
 * buyer independently recomputes the hash before releasing payment — so the
 * payment is bound to the exact bytes delivered.
 */

export interface ServiceDef {
  id: string;
  name: string;
  description: string;
  priceWei: bigint;
}

export interface Quote {
  serviceId: string;
  subject: string;
  priceWei: bigint;
  /** keccak256 of the canonical service agreement (service + subject + price). */
  serviceRef: string;
}

export interface Delivery {
  quote: Quote;
  /** The delivered artifact (canonical JSON string). */
  artifact: string;
  /** SHA-256 of `artifact`, committed on-chain via attestDelivery. */
  deliveryHash: string;
  report: RiskReport;
}

export interface RiskReport {
  subject: string;
  generatedAt: string;
  riskScore: number; // 0 (safest) .. 100 (riskiest)
  volatilityBand: "low" | "moderate" | "high" | "extreme";
  liquidityScore: number; // 0..100
  smartContractRisk: "low" | "moderate" | "high";
  summary: string;
  signals: string[];
}

export const SERVICES: ServiceDef[] = [
  {
    id: "token-risk-report",
    name: "Token Risk Report",
    description:
      "Risk scoring for one token: volatility band, liquidity depth, contract risk and key signals.",
    priceWei: ethers.parseEther("0.003"),
  },
  {
    id: "portfolio-scan",
    name: "Portfolio Scan",
    description: "Risk scan across a small basket of tokens with aggregate exposure notes.",
    priceWei: ethers.parseEther("0.005"),
  },
  {
    id: "deep-dive-report",
    name: "Deep-Dive Due Diligence",
    description:
      "Premium manual-grade deep dive: holder concentration, unlock schedule, governance and audit review.",
    priceWei: ethers.parseEther("0.009"),
  },
];

/** Deterministic PRNG seeded from a string — makes report generation
 *  reproducible, so the buyer can verify the delivery hash byte-for-byte. */
function seededRandom(seed: string) {
  let h = createHash("sha256").update(seed).digest();
  let i = 0;
  return () => {
    if (i >= h.length) {
      h = createHash("sha256").update(h).digest();
      i = 0;
    }
    return h[i++] / 255;
  };
}

export class SellerAgent {
  constructor(
    readonly address: string,
    private readonly log: EventLog,
    readonly name = "InsightAPI (Seller Agent)"
  ) {}

  listServices(): ServiceDef[] {
    return SERVICES;
  }

  quote(serviceId: string, subject: string): Quote {
    const svc = SERVICES.find((s) => s.id === serviceId);
    if (!svc) throw new Error(`unknown service: ${serviceId}`);
    const serviceRef = ethers.keccak256(
      ethers.toUtf8Bytes(`settlemesh:${serviceId}:${subject}:${svc.priceWei}`)
    );
    this.log.quote(
      "SELLER",
      `${this.name} quotes "${svc.name}" for ${subject}: ${ethers.formatEther(svc.priceWei)} tHSK`
    );
    return { serviceId, subject, priceWei: svc.priceWei, serviceRef };
  }

  /** Produce the report artifact for a quote. In production this is where an
   *  LLM + market-data pipeline would run; here generation is deterministic
   *  so the demo is reproducible and the delivery hash verifiable. */
  deliver(quote: Quote): Delivery {
    const rnd = seededRandom(`${quote.serviceId}:${quote.subject}`);
    const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
    const riskScore = Math.round(15 + rnd() * 70);
    const report: RiskReport = {
      subject: quote.subject,
      generatedAt: new Date().toISOString(),
      riskScore,
      volatilityBand: pick(["low", "moderate", "high", "extreme"] as const),
      liquidityScore: Math.round(20 + rnd() * 80),
      smartContractRisk: pick(["low", "moderate", "high"] as const),
      summary: "",
      signals: [],
    };
    report.signals = [
      `24h volume trend ${rnd() > 0.5 ? "expanding" : "contracting"} vs 7d average`,
      `top-10 holder concentration ${(20 + rnd() * 55).toFixed(1)}% of supply`,
      `liquidity depth supports exits up to ~${(10 + rnd() * 240).toFixed(0)}k USD within 2% slippage`,
      rnd() > 0.45
        ? "no abnormal mint/burn events in the last 30 days"
        : "elevated transfer velocity from dormant wallets — monitor",
    ];
    report.summary =
      `${report.subject}: risk ${report.riskScore}/100, ${report.volatilityBand} volatility, ` +
      `liquidity ${report.liquidityScore}/100, contract risk ${report.smartContractRisk}. ` +
      (report.riskScore > 60
        ? "Position sizing should be conservative; prefer staged entries."
        : "Risk profile is within normal bounds for its category.");

    const artifact = JSON.stringify(report, null, 2);
    const deliveryHash =
      "0x" + createHash("sha256").update(artifact, "utf8").digest("hex");
    this.log.delivery(
      `delivered "${quote.serviceId}" for ${quote.subject} — report hash ${deliveryHash.slice(0, 18)}…`
    );
    return { quote, artifact, deliveryHash, report };
  }
}

/** Optional standalone mode: run the seller as a tiny HTTP service so a buyer
 *  agent (or a human with curl) can request quotes and deliveries A2A-style.
 *  Run with: npx ts-node agents/seller-server.ts (or via demo harness). */
export function startSellerServer(seller: SellerAgent, port = 8402) {
  const server = http.createServer((req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/services") {
      return send(
        200,
        SERVICES.map((s) => ({ ...s, priceWei: s.priceWei.toString() }))
      );
    }
    if (req.method === "POST" && (req.url === "/quote" || req.url === "/deliver")) {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        try {
          const { serviceId, subject } = JSON.parse(raw || "{}");
          const q = seller.quote(serviceId, subject);
          if (req.url === "/quote") {
            return send(200, { ...q, priceWei: q.priceWei.toString() });
          }
          const d = seller.deliver(q);
          return send(200, {
            artifact: d.artifact,
            deliveryHash: d.deliveryHash,
            report: d.report,
          });
        } catch (e) {
          return send(400, { error: (e as Error).message });
        }
      });
      return;
    }
    return send(404, { error: "not found" });
  });
  server.listen(port, () =>
    console.log(`[SELLER] InsightAPI HTTP service listening on :${port}`)
  );
  return server;
}
