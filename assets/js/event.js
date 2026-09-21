/* ============================================================
   Coast Nation — event detail + checkout
   ============================================================ */
(async function () {
  CN.renderTopbar(CN.$("#topbar"), { back: true });
  CN.renderFooter(CN.$("#footer"));
  const cfg = await CN.settings();

  const key = CN.qs("e");
  const host = CN.$("#detail");
  const cart = {}; // ticket_type_id -> qty
  let ev = null;

  if (!key) { host.innerHTML = notFound(); return; }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(key);
  const { data, error } = await CN.db
    .from("events")
    .select("*, ticket_types(*)")
    .eq(isUuid ? "id" : "slug", key)
    .maybeSingle();

  if (error || !data) { host.innerHTML = notFound(); return; }
  ev = data;
  document.title = ev.name + " — Coast Nation";
  render();

  /* ---------------- render ---------------- */
  function notFound() {
    return `<div class="empty" style="grid-column:1/-1">
      <h3>Event not found</h3>
      <p class="small">It may have been taken down.</p>
      <a class="btn btn-primary" href="index.html">Browse all events</a></div>`;
  }

  function render() {
    const past = CN.isPast(ev.event_date);
    const types = (ev.ticket_types || [])
      .filter((t) => t.is_active)
      .sort((a, b) => (a.sort_order - b.sort_order) || Number(a.price) - Number(b.price));

    const poster = ev.image_url
      ? `<img src="${CN.esc(ev.image_url)}" alt="${CN.esc(ev.name)}">`
      : `<div class="placeholder" style="width:100%;height:100%;display:grid;place-items:center;background:linear-gradient(135deg,#123044,#1d4a4a);font-family:Sora;font-size:4rem;color:rgba(255,255,255,.25)">${CN.esc(CN.initials(ev.name))}</div>`;

    host.innerHTML = `
      <div>
        <div class="detail-top">
          <div class="detail-poster">${poster}</div>
          <div>
            ${ev.category ? `<span class="badge info">${CN.esc(ev.category)}</span>` : ""}
            ${ev.featured ? `<span class="badge warn" style="margin-left:6px">Featured</span>` : ""}
            <h1 style="margin-top:12px;font-size:clamp(1.7rem,3.4vw,2.6rem)">${CN.esc(ev.name)}</h1>
            ${ev.tagline ? `<p class="muted" style="font-size:1.02rem">${CN.esc(ev.tagline)}</p>` : ""}
            <div class="info-list">
              ${info("calendar", "Date", CN.prettyDate(ev.event_date))}
              ${ev.start_time ? info("clock", "Time", CN.prettyTime(ev.start_time) + (ev.end_time ? " – " + CN.prettyTime(ev.end_time) : "")) : ""}
              ${info("pin", "Venue", [ev.venue, ev.town].filter(Boolean).join(", ") || "To be announced")}
              ${ev.organizer_name ? info("user", "Organised by", ev.organizer_name) : ""}
            </div>
          </div>
        </div>
        <div style="margin-top:26px">
          ${ev.description ? `<h3>About this event</h3><p style="white-space:pre-wrap;color:#c7d6e2">${CN.esc(ev.description)}</p>` : ""}

          ${ev.organizer_phone || ev.organizer_email || ev.organizer_instagram ? `
            <h3 style="margin-top:26px">Contact the organiser</h3>
            <div class="small muted" style="display:flex;gap:16px;flex-wrap:wrap">
              ${ev.organizer_phone ? `<a href="tel:${CN.esc(ev.organizer_phone)}">${CN.esc(ev.organizer_phone)}</a>` : ""}
              ${ev.organizer_email ? `<a href="mailto:${CN.esc(ev.organizer_email)}">${CN.esc(ev.organizer_email)}</a>` : ""}
              ${ev.organizer_instagram ? `<a target="_blank" rel="noopener" href="https://instagram.com/${CN.esc(String(ev.organizer_instagram).replace(/^@/, ""))}">@${CN.esc(String(ev.organizer_instagram).replace(/^@/, ""))}</a>` : ""}
            </div>` : ""}
        </div>
      </div>

      <aside class="buy-box">
        <div class="panel">
          <h3 style="margin-bottom:14px">${past ? "This event has passed" : "Get your tickets"}</h3>
          <div id="ttList">${
            past
              ? `<p class="muted small">Ticket sales are closed.</p>`
              : types.length
                ? types.map(ttRow).join("")
                : `<p class="muted small">Tickets for this event haven't been released yet. Check back soon.</p>`
          }</div>
          ${!past && types.length ? `
            <div class="total-row"><span class="muted">Total</span><b id="total">${CN.amount(0)}</b></div>
            <button class="btn btn-primary btn-block" id="checkoutBtn" disabled>Select tickets to continue</button>
            <p class="small muted center" style="margin:12px 0 0">Your QR ticket is issued instantly after payment.</p>` : ""}
        </div>
      </aside>`;

    if (!past) wireQty();
  }

  function info(icon, k, v) {
    const icons = {
      calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      pin: '<path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
      user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>'
    };
    return `<div class="info-item">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2ee6c5" stroke-width="1.8" style="margin-top:3px;flex:none">${icons[icon]}</svg>
      <div><div class="k">${CN.esc(k)}</div><div class="v">${CN.esc(v)}</div></div></div>`;
  }

  function ttRow(t) {
    const left = CN.ticketsLeft(t);
    const closed = CN.salesClosed(t);
    const note = closed
      ? `<span class="badge bad">Sold out</span>`
      : left !== Infinity && left <= 10
        ? `<span class="badge warn">${left} left</span>`
        : "";
    return `
      <div class="tt-option" data-tt="${t.id}">
        <div>
          <div class="name">${CN.esc(t.name)} ${note}</div>
          ${t.description ? `<div class="small muted">${CN.esc(t.description)}</div>` : ""}
          <div class="small" style="color:var(--sand);margin-top:2px">${CN.money(t.price)}</div>
        </div>
        ${closed ? `<span class="small muted">—</span>` : `
          <div class="qty">
            <button data-act="minus" aria-label="less">−</button>
            <span data-q>0</span>
            <button data-act="plus" aria-label="more">+</button>
          </div>`}
      </div>`;
  }

  function wireQty() {
    CN.$$(".tt-option").forEach((row) => {
      const id = row.dataset.tt;
      const tt = ev.ticket_types.find((x) => x.id === id);
      const out = row.querySelector("[data-q]");
      row.querySelectorAll("button[data-act]").forEach((b) =>
        b.addEventListener("click", () => {
          const max = Math.min(10, CN.ticketsLeft(tt) === Infinity ? 10 : CN.ticketsLeft(tt));
          let q = cart[id] || 0;
          q += b.dataset.act === "plus" ? 1 : -1;
          q = Math.max(0, Math.min(max, q));
          cart[id] = q;
          out.textContent = q;
          row.classList.toggle("picked", q > 0);
          refreshTotal();
        })
      );
    });
    CN.$("#checkoutBtn")?.addEventListener("click", openBuyerModal);
  }

  function cartTotal() {
    return Object.entries(cart).reduce((sum, [id, q]) => {
      const tt = ev.ticket_types.find((x) => x.id === id);
      return sum + (tt ? Number(tt.price) * q : 0);
    }, 0);
  }
  function cartCount() {
    return Object.values(cart).reduce((a, b) => a + b, 0);
  }
  function refreshTotal() {
    const n = cartCount();
    CN.$("#total").textContent = CN.amount(cartTotal());
    const btn = CN.$("#checkoutBtn");
    btn.disabled = n === 0;
    btn.textContent = n === 0 ? "Select tickets to continue" : `Checkout · ${n} ticket${n > 1 ? "s" : ""}`;
  }

  /* ---------------- checkout ---------------- */
  function openBuyerModal() {
    const total = cartTotal();
    const lines = Object.entries(cart)
      .filter(([, q]) => q > 0)
      .map(([id, q]) => {
        const tt = ev.ticket_types.find((x) => x.id === id);
        return `<div class="meta-row" style="justify-content:space-between"><span>${CN.esc(tt.name)} × ${q}</span><span>${CN.money(Number(tt.price) * q)}</span></div>`;
      })
      .join("");

    CN.$("#modalHost").innerHTML = `
      <div class="modal-backdrop" id="backdrop">
        <div class="modal" style="max-width:520px">
          <div class="modal-head">
            <h3 style="margin:0">Your details</h3>
            <button class="x-btn" id="closeModal">&times;</button>
          </div>
          <div class="modal-body">
            <div class="panel" style="background:rgba(255,255,255,.03);padding:14px;margin-bottom:18px">
              <div style="font-weight:600;margin-bottom:6px">${CN.esc(ev.name)}</div>
              ${lines}
              <div class="total-row" style="padding:10px 0 0"><span class="muted">Total</span><b>${CN.amount(total)}</b></div>
            </div>
            <div class="field"><label>Full name</label><input id="bName" placeholder="Jina lako kamili" autocomplete="name"></div>
            <div class="field"><label>Email (your ticket link is sent here)</label><input id="bEmail" type="email" placeholder="you@example.com" autocomplete="email"></div>
            <div class="field"><label>Phone number</label><input id="bPhone" placeholder="07XX XXX XXX" autocomplete="tel"></div>
            <p class="small muted" style="margin:0">By continuing you agree that tickets are non-refundable unless the event is cancelled.</p>
          </div>
          <div class="modal-foot">
            <button class="btn btn-soft" id="cancelModal">Back</button>
            <button class="btn btn-primary" id="payBtn">${total === 0 ? "Get free ticket" : "Pay " + CN.amount(total)}</button>
          </div>
        </div>
      </div>`;

    const close = () => (CN.$("#modalHost").innerHTML = "");
    CN.$("#closeModal").onclick = close;
    CN.$("#cancelModal").onclick = close;
    CN.$("#backdrop").addEventListener("click", (e) => { if (e.target.id === "backdrop") close(); });
    CN.$("#payBtn").onclick = startCheckout;
  }

  async function startCheckout() {
    const btn = CN.$("#payBtn");
    const buyer = {
      name: CN.$("#bName").value.trim(),
      email: CN.$("#bEmail").value.trim(),
      phone: CN.$("#bPhone").value.trim()
    };
    if (!buyer.name || !buyer.email || !buyer.phone) return CN.toast("Please fill in all three fields.", "err");
    if (!/^\S+@\S+\.\S+$/.test(buyer.email)) return CN.toast("That email doesn't look right.", "err");

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Creating order…';

    let order;
    try {
      order = await CN.rpc("create_order", {
        p_event_id: ev.id,
        p_buyer_name: buyer.name,
        p_buyer_email: buyer.email,
        p_buyer_phone: buyer.phone,
        p_items: Object.entries(cart)
          .filter(([, q]) => q > 0)
          .map(([ticket_type_id, quantity]) => ({ ticket_type_id, quantity }))
      });
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Try again";
      return CN.toast(e.message, "err");
    }

    const total = Number(order.total);

    // Free tickets — issue immediately.
    if (total <= 0) {
      await finish(order.reference, "free", "FREE");
      return;
    }

    const provider = (cfg.payment_provider || "paystack").toLowerCase();
    const pk = provider === "flutterwave" ? cfg.flutterwave_public_key : cfg.paystack_public_key;

    if (!pk) {
      // No gateway configured yet — the order is saved as pending and Coast Nation confirms manually.
      window.location.href = "ticket.html?ref=" + encodeURIComponent(order.reference) + "&pending=1";
      return;
    }

    btn.innerHTML = "Opening secure checkout…";

    if (provider === "flutterwave") {
      window.FlutterwaveCheckout({
        public_key: pk,
        tx_ref: order.reference,
        amount: total,
        currency: CN.currency || "KES",
        payment_options: "card,mpesa,mobilemoneyghana",
        customer: { email: buyer.email, phone_number: buyer.phone, name: buyer.name },
        customizations: { title: "Coast Nation", description: ev.name, logo: ev.image_url || "" },
        callback: (resp) => finish(order.reference, "flutterwave", String(resp.transaction_id || resp.tx_ref || "")),
        onclose: () => { btn.disabled = false; btn.textContent = "Pay " + CN.amount(total); }
      });
      return;
    }

    const handler = window.PaystackPop.setup({
      key: pk,
      email: buyer.email,
      amount: Math.round(total * 100),
      currency: CN.currency || "KES",
      ref: order.reference,
      metadata: {
        custom_fields: [
          { display_name: "Event", variable_name: "event", value: ev.name },
          { display_name: "Buyer phone", variable_name: "phone", value: buyer.phone }
        ]
      },
      callback: (resp) => finish(order.reference, "paystack", resp.reference),
      onClose: () => { btn.disabled = false; btn.textContent = "Pay " + CN.amount(total); }
    });
    handler.openIframe();
  }

  async function finish(reference, provider, providerRef) {
    try {
      await CN.rpc("confirm_order_payment", {
        p_reference: reference,
        p_provider: provider,
        p_provider_ref: providerRef
      });
    } catch (e) {
      console.error(e);
    }
    window.location.href = "ticket.html?ref=" + encodeURIComponent(reference);
  }
})();
