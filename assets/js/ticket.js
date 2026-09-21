/* ============================================================
   Coast Nation — order confirmation / ticket wallet
   ============================================================ */
(async function () {
  CN.renderTopbar(CN.$("#topbar"), { back: true });
  CN.renderFooter(CN.$("#footer"));
  const cfg = await CN.settings();
  const view = CN.$("#view");
  const ref = CN.qs("ref");

  if (!ref) return lookupForm();
  await show(ref);

  function lookupForm(msg) {
    view.innerHTML = `
      <div class="panel" style="max-width:460px;margin:0 auto">
        <h2>Find my ticket</h2>
        <p class="muted small">Enter the order reference from your confirmation (it looks like CN-260921-A1B2C3).</p>
        ${msg ? `<p class="small" style="color:var(--danger)">${CN.esc(msg)}</p>` : ""}
        <div class="field"><label>Order reference</label><input id="refIn" placeholder="CN-260921-A1B2C3"></div>
        <button class="btn btn-primary btn-block" id="findBtn">Show my tickets</button>
      </div>`;
    CN.$("#findBtn").onclick = () => {
      const v = CN.$("#refIn").value.trim();
      if (v) window.location.href = "ticket.html?ref=" + encodeURIComponent(v);
    };
    CN.$("#refIn").addEventListener("keydown", (e) => { if (e.key === "Enter") CN.$("#findBtn").click(); });
  }

  async function show(reference) {
    view.innerHTML = `<div class="panel center"><span class="spinner"></span> Loading your order…</div>`;
    let o;
    try {
      o = await CN.rpc("get_order", { p_reference: reference.toUpperCase() });
    } catch (e) {
      return lookupForm(e.message);
    }
    if (!o) return lookupForm("We couldn't find an order with that reference.");

    const paid = o.status === "paid";
    const cancelled = o.status === "cancelled";
    const wa = (cfg.contact_whatsapp || "").replace(/\D/g, "");

    const head = paid
      ? `<div class="panel" style="border-color:rgba(61,220,151,.4);background:rgba(61,220,151,.07)">
           <h2 style="margin-bottom:6px;display:flex;align-items:center;gap:10px">
             <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#3ddc97" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.4l2.7 2.6L16 9.5"/></svg>
             You're in</h2>
           <p class="muted" style="margin:0">Show the QR code below at the gate. Screenshot it — it works offline.</p>
         </div>`
      : cancelled
        ? `<div class="panel" style="border-color:rgba(255,95,109,.4);background:rgba(255,95,109,.07)">
             <h2 style="margin-bottom:6px">Order cancelled</h2>
             <p class="muted" style="margin:0">This order was cancelled. Talk to us if that's a mistake.</p></div>`
        : `<div class="panel" style="border-color:rgba(255,200,87,.4);background:rgba(255,200,87,.07)">
             <h2 style="margin-bottom:6px">Order reserved — payment pending</h2>
             <p class="muted" style="margin:0 0 12px">Your tickets are held under reference <b>${CN.esc(o.reference)}</b>. Send payment and we'll release your QR codes.</p>
             ${wa ? `<a class="btn btn-primary btn-sm no-print" target="_blank" rel="noopener"
                   href="https://wa.me/${wa}?text=${encodeURIComponent("Hi Coast Nation, I want to pay for order " + o.reference + " (" + o.event.name + ")")}">Pay via WhatsApp</a>` : ""}
           </div>`;

    const items = (o.items || [])
      .map((i) => `<div class="meta-row" style="justify-content:space-between"><span>${CN.esc(i.name)} × ${i.quantity}</span><span>${CN.money(i.unit_price * i.quantity)}</span></div>`)
      .join("");

    view.innerHTML = `
      ${head}
      <div class="panel" style="margin-top:18px">
        <div class="panel-head">
          <div>
            <h3 style="margin:0">${CN.esc(o.event.name)}</h3>
            <div class="small muted">${CN.esc(CN.prettyDate(o.event.event_date))}${o.event.start_time ? " · " + CN.esc(CN.prettyTime(o.event.start_time)) : ""} · ${CN.esc([o.event.venue, o.event.town].filter(Boolean).join(", "))}</div>
          </div>
          <span class="badge ${paid ? "ok" : cancelled ? "bad" : "warn"}">${CN.esc(o.status)}</span>
        </div>
        ${items}
        <div class="total-row"><span class="muted">Total</span><b>${CN.amount(o.total_amount)}</b></div>
        <div class="small muted">Reference <b class="ticket-code" style="font-size:.9rem">${CN.esc(o.reference)}</b> · ${CN.esc(o.buyer_name)} · ${CN.esc(o.buyer_phone)}</div>
      </div>

      <div id="stubs" style="margin-top:18px"></div>

      ${paid ? `<div class="center no-print" style="margin-top:22px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button class="btn btn-soft" onclick="window.print()">Print / save as PDF</button>
          <a class="btn btn-ghost" href="index.html">Browse more events</a>
        </div>` : ""}`;

    const stubs = CN.$("#stubs");
    if (paid && (o.tickets || []).length) {
      stubs.innerHTML = o.tickets
        .map(
          (t, i) => `
        <div class="ticket-stub">
          <div class="qr"><canvas data-qr="${CN.esc(t.code)}"></canvas></div>
          <div style="flex:1;min-width:180px">
            <div class="small muted">Ticket ${i + 1} of ${o.tickets.length}</div>
            <div style="font-weight:600;font-size:1.05rem">${CN.esc(t.type)}</div>
            <div class="ticket-code">${CN.esc(t.code)}</div>
            <div style="margin-top:6px"><span class="badge ${t.status === "used" ? "dim" : "ok"}">${t.status === "used" ? "Already scanned" : "Valid"}</span></div>
          </div>
        </div>`
        )
        .join("");
      CN.$$("canvas[data-qr]").forEach((c) =>
        window.QRCode.toCanvas(c, c.dataset.qr, { width: 118, margin: 1, color: { dark: "#0b1620", light: "#ffffff" } })
      );
    }
  }
})();
