# SettleMesh — DoraHacks BUIDL submission copy

*Paste-ready copy for the BUIDL form. Bracketed items are filled in at
submission time (repo URL, video URL, live demo URL, deploy address).*

---

## Project name

SettleMesh

## One-line intro

Policy-guarded agent-to-agent payments: an on-chain escrow on HashKey Chain
that refuses — by itself — any agent payment that breaks the owner's spending
policy.

## Track

**Agent Payments & A2A Settlement**

## Vision / detailed description

AI agents are starting to hire each other: buying data, analysis, inference
and services, agent-to-agent, with no human in the loop. The missing piece is
not payment rails — it is *safe* payment authority. An agent with a wallet
can be prompt-injected into overpaying, loop payments until the wallet is
empty, or be talked into paying a scammer by a counterparty agent. Trusting
the agent's own code is not a security model.

**SettleMesh is the settlement layer for the agent economy: a spending-policy
escrow.** The buyer agent's owner publishes a policy on-chain — a per-payment
cap, a daily cap, and an allowlist of payees. Every settlement then flows
through the SettleMesh contract on HashKey Chain:

1. The buyer escrows the job price with the contract. Policy is checked at
   job creation: over-cap, over-daily-budget, or non-allowlisted payments
   **revert with machine-readable errors** — they are not merely discouraged,
   they are impossible.
2. The seller agent delivers the work off-chain and attests the SHA-256 hash
   of the delivered artifact on-chain.
3. The buyer verifies the artifact against the attestation and releases
   payment. No delivery → cancel any time, or an automatic-path refund after
   the deadline, with the reserved budget restored.

The demo's key moment: a seller agent quotes a premium service priced above
the buyer's cap. The buyer agent refuses — and then the payment is attempted
anyway, and **the contract itself refuses it on-chain**
(`ExceedsPerPaymentCap`). Defense in depth: the agent layer for clear,
explainable refusals; the contract layer for the guarantee.

### What was built

- **`SettleMesh.sol`** — escrow + policy-enforcement contract (per-payment
  cap, daily cap with budget reservation, payee allowlist, delivery-hash
  attestation, cancel/refund paths), with **19 passing tests** covering every
  policy refusal and settlement path.
- **Buyer agent ("TreasuryBot")** — evaluates a policy engine before every
  payment, escrows jobs, verifies delivered artifacts byte-for-byte against
  the on-chain hash, and releases payment.
- **Seller agent ("InsightAPI")** — a priced data/analysis service (token
  risk reports, portfolio scans, deep dives) with hash-attested delivery;
  also runnable as a standalone HTTP quote/deliver service.
- **A 5-scene end-to-end demo** — happy-path settlement, the over-cap
  refusal, a non-allowlisted "rogue agent" refusal, a daily-cap refusal, and
  an undelivered-job refund — runnable locally in one command and on HashKey
  testnet with explorer-linked transactions.
- **A live dashboard** — policy, agents, escrow jobs and the full settlement
  log, with the on-chain refusals headlined.

### Why it matters

Every serious agent framework will need bounded payment authority. SettleMesh
shows the pattern: policies as on-chain, auditable, machine-readable rules;
escrow instead of trust; delivery bound to payment by content hash; and
refusals that are provable, not anecdotal. It is a small, complete,
production-shaped building block for A2A commerce on HashKey Chain — and a
natural base for stablecoin settlement, multi-agent treasuries, reputation
and dispute layers.

## Tech used

Solidity 0.8.24 · HashKey Chain (testnet chain ID 133) · Hardhat · ethers.js
v6 · TypeScript · Node.js · static HTML/CSS/JS dashboard · SHA-256
content-hash delivery attestation · custom Solidity errors for
machine-readable policy refusals

## Links (fill at submission)

- GitHub repo: [REPO URL]
- Demo video: [VIDEO URL]
- Live demo (dashboard): [DASHBOARD URL]
- Contract (HashKey testnet, the instance the demo below ran on):
  `0xd9faa7CB899Ca84b63c4896BfB42FaC5BE1d0666`
  - Explorer: https://testnet.hsk.xyz/address/0xd9faa7CB899Ca84b63c4896BfB42FaC5BE1d0666
  - Deployment tx: https://testnet.hsk.xyz/tx/0x77efcd77d996a9b6ff759f193c6a1a9a2712dfb7adda689b034c64e944d2bf87
    (block 35077718, status success, deployed 2026-10-30 from the throwaway
    dev address `0x2Ad2C0d69CCE1B7aDC3cD6231340dEdf12a8c784`)
  - (An earlier identical deployment from the initial build session sits at
    `0x79169b4ACD33a1405508d620698024648272Db24`, deployment tx
    0x92be987d887bbf4fb65558305e65ad5aa0cdc95d578424f13a680de7e43c64d2.)
- Testnet demo transactions — the full 5-scene demo ran on HashKey testnet
  on 2026-10-30 with rescaled demo economics (the faucet drips only
  0.1 tHSK per address per 24h, so the demo amounts are 10× smaller than
  the original design: per-payment cap 0.005 tHSK, daily cap 0.012 tHSK,
  escrow deposit 0.02 tHSK; the policy logic and refusal paths are
  identical, and the same amounts are used by `npm run demo` locally):

  Setup (buyer policy: cap 0.005 / daily 0.012, seller allowlisted,
  0.02 tHSK escrow deposit):
  - setPolicy: https://testnet.hsk.xyz/tx/0x493493d8e357a36d8b1fa5fc801eaadb2f099bb3c75eb46935a7a84f176c328d
  - setPayeeAllowed: https://testnet.hsk.xyz/tx/0x6193ca565b85956f09fa1560802a0121dffef9667cc5c04e437d4075af107b35
  - deposit 0.02 tHSK: https://testnet.hsk.xyz/tx/0xa4c07a53167c31caf4f764968d84406a7172a16b873420e35990f3ccba026b61

  - **Scene 1 — settlement (token risk report, 0.003 tHSK):**
    createJob https://testnet.hsk.xyz/tx/0xaa77dbce32b39cfee35cab22834a733a85bf0c7dadb641f70a4c1079fbcd4276 ·
    attestDelivery https://testnet.hsk.xyz/tx/0x96d2ae06a5561439a7b5c1c4e34a25a7e881a95696f6025fd5b0fb9a57f44735 ·
    releasePayment https://testnet.hsk.xyz/tx/0xdbc799f4565e7c3030c0977149be085cb24317b11d1e5a90b92aa39a5bd00231
  - **Scene 2 — over-cap refusal (deep-dive quoted 0.009 vs cap 0.005):**
    the buyer's on-chain createJob attempt reverted with
    `ExceedsPerPaymentCap`: https://testnet.hsk.xyz/tx/0xc7da79c2ccb2f7c8b6961e7006b6e4b31f0ae2e1506146d1616e06645a222f12
  - **Scene 3 — non-allowlisted payee refusal (0.003 tHSK):**
    createJob reverted with `PayeeNotAllowlisted`: https://testnet.hsk.xyz/tx/0x2f2b11a856baba1fc48b019ccda277cb01f380281eacea910f37e103cb116acb
  - **Scene 4 — daily-cap refusal:** the 0.005 tHSK portfolio-scan job was
    escrowed and its delivery attested on-chain (createJob
    https://testnet.hsk.xyz/tx/0x9173afdf034d07c60ae840b48f500914514f52930fc21a94b362378e6f10cd28 ·
    attestDelivery https://testnet.hsk.xyz/tx/0xa54731fe89702fd2a53e4c99b2679f94dd28f2f5152cee59255f47fae1d07618);
    the follow-up 0.005 tHSK job (0.008 already reserved + 0.005 > 0.012
    daily cap) reverted with `ExceedsDailyCap`: https://testnet.hsk.xyz/tx/0x459f23c5af3cae6c9cc68488980cbf9cec4b78eb34626fc46cfdd4c1653bbe33
  - **Scene 5 — undelivered job refunded (0.002 tHSK):**
    createJob https://testnet.hsk.xyz/tx/0xc4064b9075e25d8a1dab31a2a0a225ee618c8ba2aef339a16bff809ccee074fb ·
    refundJob https://testnet.hsk.xyz/tx/0x558641119a4d30dad072b09123719448e08ee17c9e1d72a3bf1dfb47c969a710

  Honest notes on this run: (1) In scene 4 the buyer agent skipped the
  release step after attestation — its immediate `getJob` read was served
  a stale (pre-attestation) state by a lagging RPC node, so it reported a
  hash mismatch and held the payment; the job stands `Delivered` on-chain
  with the payment still escrowed (the safe direction to fail). The agent
  now polls until the attested hash is visible before verifying
  (read-your-writes), and agent refusals now decode the chain's typed
  errors and record the reverted tx hashes; the fixed flow passes the
  full 5-scene demo locally (`npm run demo`, all settlements and refusals
  as designed) and the contract test suite is 19/19. A clean-slate
  testnet re-run of the fixed flow needs ~0.031 tHSK in the throwaway
  deployer (one more 0.1 tHSK faucet drip — the faucet allows one drip
  per address per 24h and prior demo floats sit in one-time random agent
  wallets); deployer balance at the time of writing is ~0.0012 tHSK.
  (2) Two infrastructure quirks of this testnet were found and worked
  around in the agent code: the RPC's `eth_estimateGas` badly
  underestimated a state-changing call against a lagging node (22,465
  estimated vs 91,031 actual), so all demo transactions carry explicit
  gas limits.
- How to run locally: `npm install && npm test && npm run demo`

## Team

Solo build — [HACKER NAME / DoraHacks username], [contact: X / Telegram]

## Track-fit statement (short version, if the form asks)

SettleMesh is squarely an Agent Payments & A2A Settlement project: two
autonomous agents negotiate and settle a paid service through an on-chain
escrow, with the payer's spending policy enforced by the settlement contract
itself — the core infrastructure primitive agent-to-agent commerce needs to
be safe.
