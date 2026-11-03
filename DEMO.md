# SettleMesh — demo video script & shot list

**Target length:** ~2:45 (hard cap 3:00)
**Format:** screen recording, terminal + dashboard, with voiceover (or captions).
**Setup before recording:**

- Terminal, large font (16–18pt), dark theme. Run `npm run demo` once before
  recording so `dashboard/state.json` exists and the flow is rehearsed.
- Have the dashboard open in a browser tab (`npm run dashboard`, then
  http://localhost:8080) — refresh it after the terminal run finishes.
- For the testnet cut (preferred if time allows): fund the throwaway key,
  run `npm run demo:testnet`, and keep the HashKey testnet explorer open in
  another tab for the tx-link shots.
- Record at 1080p; crop to the terminal/browser, no desktop clutter.

---

## Script & shots

### 0:00–0:20 — Hook (dashboard hero shot)

**Shot:** Dashboard full screen; slow scroll from the header to the ⛔
refusal banner.

**VO:**
> "AI agents are starting to pay each other. The question nobody has answered
> is: what stops an agent from paying the *wrong* thing? This is SettleMesh —
> agent-to-agent payments where the spending policy is enforced by the chain
> itself."

### 0:20–0:45 — The setup (terminal)

**Shot:** Terminal. Run `npm run demo`. Pause on the first lines: contract
deployed, policy published, seller allowlisted, escrow funded.

**VO:**
> "A buyer agent, TreasuryBot, publishes its policy on-chain: never more than
> 0.005 tHSK per payment, 0.012 per day, and only one allowlisted seller. Then
> it funds the SettleMesh escrow. Every rule you just saw lives in the
> contract — not in the agent's prompt, not in its config. In the contract."

### 0:45–1:15 — Scene 1: a normal settlement

**Shot:** Terminal scrolling through Scene 1 — quote, job escrowed, delivery
attested, hash verified, payment released. End on the 💸 line.

**VO:**
> "The buyer hires InsightAPI for a token risk report: 0.003 testnet HSK.
> The price is escrowed, the seller delivers the report and attests its
> SHA-256 hash on-chain, the buyer verifies the bytes match — and only then
> is payment released. No delivery, no money. Ever."

### 1:15–1:55 — Scene 2: THE REFUSAL (the moment — slow down here)

**Shot:** Terminal on Scene 2. Let the ⛔ lines sit on screen for a full two
seconds. Zoom or highlight: `REFUSED … exceeds per-payment cap`, then
`ExceedsPerPaymentCap` from the chain.

**VO:**
> "Now the seller quotes a premium deep-dive: 0.009 — above the buyer's cap.
> The agent refuses. That's expected. But watch: we attempt the payment
> anyway. And the *contract* refuses it — `ExceedsPerPaymentCap` — with the
> amounts, on-chain, for anyone to audit. A prompt-injected agent, a buggy
> agent, a manipulated agent — it doesn't matter. The money cannot move."

### 1:55–2:15 — Scenes 3–4: rogue payee & daily cap (faster cuts)

**Shot:** Quick cuts: rogue refusal (`PayeeNotAllowlisted`), then the
daily-cap refusal (`ExceedsDailyCap`).

**VO:**
> "Same story for a stranger: an unvetted agent asks for payment — refused
> by the allowlist. And the daily cap is enforced in aggregate, across jobs,
> so an agent can't drain the budget in slices either."

### 2:15–2:30 — Scene 5: no delivery, no payment

**Shot:** Scene 5 refund lines.

**VO:**
> "And when a paid job is never delivered, the escrow refunds automatically
> after its deadline and restores the buyer's budget."

### 2:30–2:45 — Close (dashboard + explorer)

**Shot:** Refresh the dashboard; show jobs table (Released / Refunded) and
the settlement log. If on testnet, click one tx link into the HashKey
explorer. End frame: dashboard header + repo URL on screen.

**VO:**
> "SettleMesh: bounded payment authority for the agent economy — policy in
> the contract, escrow instead of trust, delivery bound to payment by hash.
> Built on HashKey Chain. The code, tests and this demo are all in the repo —
> link below."

---

## Shot checklist

- [ ] Dashboard hero + refusal banner (opening frame)
- [ ] `npm run demo` full terminal run, all 5 scenes visible
- [ ] Close-up hold (≥2s) on both ⛔ refusal lines in Scene 2
- [ ] Jobs table + settlement log in dashboard (closing)
- [ ] (Testnet cut) One explorer page for a real settlement tx
- [ ] End frame with project name + repo URL

## Fallbacks

- If testnet recording fails (faucet/RPC issues), the local run is visually
  identical except explorer links; say "running on HashKey testnet" only if
  the footage actually is.
- If VO isn't possible, burn in captions using the same script text.
