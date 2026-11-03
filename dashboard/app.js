const short = (a) => (a && a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

async function main() {
  const state = await (await fetch("state.json")).json();

  document.getElementById("network").textContent =
    `${state.network} · chain ${state.chainId}`;
  const addrBase = state.explorer?.addressBase;
  document.getElementById("contract").innerHTML =
    `escrow: ` +
    (addrBase
      ? `<a href="${addrBase}${state.contractAddress}" target="_blank" rel="noopener">${short(state.contractAddress)}</a>`
      : short(state.contractAddress));
  document.getElementById("generated").textContent =
    `demo state from ${new Date(state.generatedAt).toLocaleString()}`;

  // Policy
  document.getElementById("cap-per").textContent = `${state.policy.perPaymentCap} tHSK`;
  document.getElementById("cap-daily").textContent = `${state.policy.dailyCap} tHSK`;
  document.getElementById("allowlist").textContent =
    state.policy.allowlist.map(short).join(", ");

  // Agents
  const a = state.agents;
  const rows = [
    { ...a.buyer, stats: `escrow free: ${a.buyer.escrowFree} tHSK · spent today: ${a.buyer.spentToday} tHSK` },
    { ...a.seller, stats: `earned from released jobs: ${a.seller.earned} tHSK` },
    { ...a.rogue, stats: `not allowlisted — every payment request refused` },
  ];
  document.getElementById("agents").innerHTML = rows
    .map(
      (r) => `<div class="agent">
        <div class="name">${r.name}</div>
        <div class="mono small dim">${r.address}</div>
        <div class="stats">${r.stats}</div>
      </div>`
    )
    .join("");

  // Jobs
  document.getElementById("jobs").innerHTML = state.jobs
    .map(
      (j) => `<tr>
        <td>${j.id}</td>
        <td class="mono">${short(j.payee)}</td>
        <td>${j.amount}</td>
        <td><span class="pill ${j.status}">${j.status}</span></td>
        <td class="mono small">${j.deliveryHash === "0x" + "0".repeat(64) ? "—" : short(j.deliveryHash)}</td>
      </tr>`
    )
    .join("");

  // Refusals banner (the headline moment)
  const refusals = state.events.filter((e) => e.kind === "chain-refusal");
  if (refusals.length) {
    document.getElementById("refusals").hidden = false;
    document.getElementById("refusal-list").innerHTML = refusals
      .map((e) => `<li>${e.message}</li>`)
      .join("");
  }

  // Event log
  document.getElementById("events").innerHTML = state.events
    .map((e) => {
      const tx = e.explorerUrl
        ? ` <a href="${e.explorerUrl}" target="_blank" rel="noopener">tx ↗</a>`
        : e.txHash
          ? ` <span class="mono small dim">tx ${short(e.txHash)}</span>`
          : "";
      return `<li class="kind-${e.kind}"><span class="actor">${e.actor}</span><span>${e.message}${tx}</span></li>`;
    })
    .join("");
}

main().catch((err) => {
  document.getElementById("network").textContent =
    "Could not load state.json — run `npm run demo` first.";
  console.error(err);
});
