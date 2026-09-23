/* ============================================================
   Coast Nation — admin dashboard
   ============================================================ */
(function () {
  const $ = CN.$, $$ = CN.$$, esc = CN.esc;
  let PIN = sessionStorage.getItem("cn_pin") || "";
  let tab = "dash";
  let cache = { events: [], orders: [], stats: {}, settings: {} };

  /* ==========================================================
     PIN SCREEN
     ========================================================== */
  const pinInput = $("#pinInput");
  const keys = ["1","2","3","4","5","6","7","8","9","⌫","0","C"];
  $("#keypad").innerHTML = keys.map((k) => `<button data-k="${k}">${k}</button>`).join("");
  $$("#keypad button").forEach((b) =>
    b.addEventListener("click", () => {
      const k = b.dataset.k;
      if (k === "C") pinInput.value = "";
      else if (k === "⌫") pinInput.value = pinInput.value.slice(0, -1);
      else pinInput.value += k;
      drawDots();
    })
  );
  pinInput.addEventListener("input", drawDots);
  pinInput.addEventListener("keydown", (e) => { if (e.key === "Enter") tryLogin(); });
  $("#pinGo").addEventListener("click", () => tryLogin(false));
  $("#lockBtn").addEventListener("click", () => {
    sessionStorage.removeItem("cn_pin");
    sessionStorage.removeItem("cn_door");
    location.href = "index.html";
  });

  function drawDots() {
    const n = Math.min(pinInput.value.length, 12);
    $("#pinDots").innerHTML = Array.from({ length: Math.max(n, 4) }, (_, i) =>
      `<div class="pin-dot ${i < n ? "filled" : ""}"></div>`).join("");
  }
  drawDots();

  async function tryLogin(silent) {
    const pin = silent ? PIN : pinInput.value.trim();
    if (!pin) return;
    const btn = $("#pinGo");
    if (!silent) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
    try {
      const res = await CN.rpc("admin_login", { p_pin: pin });
      if (res && res.ok) {
        PIN = pin;
        sessionStorage.setItem("cn_pin", pin);
        $("#pinScreen").classList.add("hidden");
        $("#shell").classList.remove("hidden");
        boot();
        return;
      }
      if (!silent) {
        $("#pinCard").classList.add("shake");
        setTimeout(() => $("#pinCard").classList.remove("shake"), 450);
        CN.toast(
          res && res.locked
            ? res.message
            : "Wrong PIN." + (res && res.attempts_left != null ? ` ${res.attempts_left} tries left before a 15-minute lockout.` : ""),
          "err"
        );
        pinInput.value = ""; drawDots();
      }
    } catch (e) {
      if (!silent) CN.toast(e.message, "err");
    } finally {
      btn.disabled = false; btn.textContent = "Unlock";
    }
  }
  if (PIN) tryLogin(true);

  /* ==========================================================
     SHELL
     ========================================================== */
  $$("#sideNav button").forEach((b) =>
    b.addEventListener("click", async () => {
      $$("#sideNav button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      tab = b.dataset.tab;
      render();
      if (tab === "analytics" && !cache.analytics) {
        await loadAnalytics();
        render();
      }
    })
  );

  function goTab(name) {
    const b = $(`#sideNav button[data-tab="${name}"]`);
    if (b) b.click();
  }

  async function boot() {
    await refresh();
    CN.applyBrand();
    render();
  }

  async function refresh() {
    try {
      const [stats, events, orders, settings] = await Promise.all([
        CN.rpc("admin_stats", { p_pin: PIN }),
        CN.rpc("admin_events", { p_pin: PIN }),
        CN.rpc("admin_orders", { p_pin: PIN, p_event_id: null, p_limit: 300, p_search: null }),
        CN.rpc("admin_settings", { p_pin: PIN })
      ]);
      cache = { stats, events: events || [], orders: orders || [], settings: settings || {}, analytics: cache.analytics };
    } catch (e) {
      CN.toast(e.message, "err");
    }
  }

  function render() {
    const main = $("#main");
    if (tab === "dash") main.innerHTML = viewDash();
    if (tab === "events") main.innerHTML = viewEvents();
    if (tab === "orders") main.innerHTML = viewOrders();
    if (tab === "analytics") main.innerHTML = viewAnalytics();
    if (tab === "checkin") main.innerHTML = viewCheckin();
    if (tab === "settings") main.innerHTML = viewSettings();
    wire();
    if (tab === "analytics") drawAnalytics();
  }

  /* A checkout that was never paid for isn't a purchase — it's someone who
     walked away. Those are never listed; only real, settled purchases are.
     (The counts in the delete panel still mention them, so they can be cleared.) */
  const settled = (rows) => (rows || []).filter((o) => o.status !== "pending");

  /* ==========================================================
     DASHBOARD
     ========================================================== */
  function viewDash() {
    const s = cache.stats || {};
    const recent = settled(cache.orders).slice(0, 8);
    return `
      <div class="admin-head">
        <div>
          <h1 style="font-size:1.8rem;margin:0">Dashboard</h1>
          <p class="muted small" style="margin:4px 0 0">Everything happening across Coast Nation.</p>
        </div>
        <button class="btn btn-primary" data-act="new-event">+ Create event</button>
      </div>

      <div class="stat-grid">
        <div class="stat accent"><div class="k">Revenue (paid)</div><div class="v">${esc(CN.amount(s.revenue))}</div></div>
        <div class="stat teal"><div class="k">Tickets sold</div><div class="v">${s.tickets_sold ?? 0}</div></div>
        <div class="stat"><div class="k">Purchases</div><div class="v">${s.orders_total ?? 0}</div></div>
        <div class="stat"><div class="k">Live events</div><div class="v">${s.events_published ?? 0}<span class="small muted" style="font-size:.9rem"> / ${s.events_total ?? 0}</span></div></div>
        <div class="stat"><div class="k">Scanned in</div><div class="v">${s.tickets_used ?? 0}</div></div>
      </div>

      ${!cache.events.length ? `
        <div class="empty">
          <h3>No events yet</h3>
          <p class="small">Create your first event, add a ticket type, then publish it — it appears on the public site instantly.</p>
          <button class="btn btn-primary" data-act="new-event">Create your first event</button>
        </div>` : `
        <div class="panel">
          <div class="panel-head"><h3 style="margin:0">Latest purchases</h3>
            <div style="display:flex;gap:8px">
              <button class="btn btn-soft btn-sm" data-act="go-analytics">Analytics</button>
              <button class="btn btn-soft btn-sm" data-act="go-orders">See all</button>
            </div></div>
          ${recent.length ? ordersTable(recent) : `<p class="muted small">No purchases yet.</p>`}
        </div>`}`;
  }

  /* ==========================================================
     EVENTS
     ========================================================== */
  function viewEvents() {
    return `
      <div class="admin-head">
        <div>
          <h1 style="font-size:1.8rem;margin:0">Events &amp; tickets</h1>
          <p class="muted small" style="margin:4px 0 0">Create an event, add ticket types, then publish.</p>
        </div>
        <button class="btn btn-primary" data-act="new-event">+ Create event</button>
      </div>
      ${cache.events.length
        ? cache.events.map(eventCard).join("")
        : `<div class="empty"><h3>No events yet</h3><p class="small">Hit “Create event” to get going.</p></div>`}`;
  }

  function eventCard(ev) {
    const types = ev.ticket_types || [];
    const thumb = ev.image_url
      ? `<img src="${esc(ev.image_url)}" alt="">`
      : `<div style="width:100%;height:100%;display:grid;place-items:center;font-family:Sora;font-size:1.6rem;color:rgba(255,255,255,.3)">${esc(CN.initials(ev.name))}</div>`;
    const statusBadge =
      ev.status === "published" ? `<span class="badge ok">Live</span>`
        : ev.status === "archived" ? `<span class="badge dim">Archived</span>`
          : `<span class="badge warn">Draft</span>`;

    return `
      <div class="admin-event-card">
        <div class="thumb">${thumb}</div>
        <div class="grow">
          <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
            <h3 style="margin:0">${esc(ev.name)}</h3>${statusBadge}
            ${ev.featured ? `<span class="badge info">Featured</span>` : ""}
          </div>
          <div class="small muted">${esc(CN.prettyDate(ev.event_date))}${ev.start_time ? " · " + esc(CN.prettyTime(ev.start_time)) : ""} · ${esc([ev.venue, ev.town].filter(Boolean).join(", ") || "Venue TBA")}</div>
          <div class="small" style="margin-top:6px">
            <b>${ev.tickets_sold || 0}</b> <span class="muted">tickets sold</span> ·
            <b style="color:var(--coral)">${esc(CN.amount(ev.revenue))}</b>
          </div>

          ${types.length
            ? types.map((t) => ticketRow(ev, t)).join("")
            : `<div class="tt-row" style="border-style:dashed">
                 <span class="muted small">No ticket types yet — add your first ticket.</span>
                 <button class="btn btn-primary btn-sm" data-act="new-tt" data-ev="${ev.id}">+ Add first ticket</button>
               </div>`}
          ${types.length ? `<button class="btn btn-ghost btn-sm" style="margin-top:10px" data-act="new-tt" data-ev="${ev.id}">+ Add another ticket type</button>` : ""}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;min-width:140px">
          <button class="btn btn-soft btn-sm" data-act="edit-event" data-ev="${ev.id}">Edit details</button>
          <button class="btn btn-soft btn-sm" data-act="toggle-pub" data-ev="${ev.id}">
            ${ev.status === "published" ? "Unpublish" : "Publish"}</button>
          <a class="btn btn-ghost btn-sm" href="event.html?e=${encodeURIComponent(ev.slug || ev.id)}" target="_blank">Preview ↗</a>
          <button class="btn btn-danger btn-sm" data-act="del-event" data-ev="${ev.id}">Delete</button>
        </div>
      </div>`;
  }

  function ticketRow(ev, t) {
    const left = CN.ticketsLeft(t);
    const sold = t.quantity_sold || 0;
    const pct = t.quantity_total > 0 ? Math.min(100, (sold / t.quantity_total) * 100) : 0;
    const soldOut = t.quantity_total > 0 && left === 0;
    const state = !t.is_active
      ? `<span class="badge dim">Unavailable</span>`
      : soldOut
        ? `<span class="badge bad">Sold out</span>`
        : `<span class="badge ok">On sale</span>`;

    return `
      <div class="tt-row${t.is_active ? "" : " off"}">
        <div style="flex:1;min-width:170px">
          <div style="font-weight:600">${esc(t.name)} ${state}</div>
          <div class="small muted">${esc(CN.money(t.price))} · ${sold} sold${t.quantity_total > 0 ? ` of ${t.quantity_total} (${left} left)` : " · unlimited"}</div>
          ${t.quantity_total > 0 ? `<div class="progress"><i style="width:${pct}%"></i></div>` : ""}
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <label class="switch" title="${t.is_active ? "Available to buy — click to take it off sale" : "Unavailable — click to put it on sale"}">
            <input type="checkbox" data-act="toggle-tt" data-ev="${ev.id}" data-tt="${t.id}" ${t.is_active ? "checked" : ""}>
            <span class="track"><span class="knob"></span></span>
            <span class="small">${t.is_active ? "Available" : "Unavailable"}</span>
          </label>
          <button class="btn btn-soft btn-sm" data-act="edit-tt" data-ev="${ev.id}" data-tt="${t.id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-act="del-tt" data-tt="${t.id}" title="Delete ticket type">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/></svg>
          </button>
        </div>
      </div>`;
  }

  /* ==========================================================
     ORDERS
     ========================================================== */
  function viewOrders() {
    return `
      <div class="admin-head">
        <div><h1 style="font-size:1.8rem;margin:0">Purchases</h1>
          <p class="muted small" style="margin:4px 0 0">Every ticket purchase, newest first.</p></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <div class="search-box" style="margin:0;min-width:210px">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
            <input id="orderSearch" type="search" placeholder="Name, email, phone, ref or ticket ID" value="${esc(orderSearch)}">
          </div>
          <select id="orderFilter" style="width:auto">
            <option value="">All events</option>
            ${cache.events.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("")}
          </select>
          <button class="btn btn-soft" data-act="export"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m0 0l-4-4m4 4l4-4"/><path d="M5 19h14"/></svg> Export CSV</button>
        </div>
      </div>
      <div id="ordersBox">${settled(cache.orders).length ? ordersTable(settled(cache.orders)) : `<div class="empty"><h3>No purchases yet</h3><p class="small">They'll show up here the moment someone buys.</p></div>`}</div>

      ${cache.orders.length ? `
      <div class="panel danger-zone" style="margin-top:22px">
        <h3>Delete purchases</h3>
        <p class="small muted" style="margin-bottom:6px">
          Deleting is permanent — the purchase, its tickets and its QR codes are gone for good, and the
          buyer's ticket link stops working. Tickets from a <b>paid</b> purchase are put back on sale.
          If you only want to stop someone entering, <b>Cancel</b> is the safer move: it voids the tickets
          but keeps the record.
        </p>
        <div class="danger-row">
          <div><b>Delete cancelled purchases</b>
            <div class="small muted">${cache.orders.filter((o) => o.status === "cancelled").length} cancelled right now</div></div>
          <button class="btn btn-danger btn-sm" data-act="wipe" data-status="cancelled">Delete all cancelled</button>
        </div>
        <div class="danger-row">
          <div><b>Delete pending purchases</b>
            <div class="small muted">${cache.orders.filter((o) => o.status === "pending").length} never paid — abandoned checkouts</div></div>
          <button class="btn btn-danger btn-sm" data-act="wipe" data-status="pending">Delete all pending</button>
        </div>
        <div class="danger-row">
          <div><b>Delete everything</b>
            <div class="small muted">All ${cache.orders.length} purchases, paid ones included. Export the CSV first.</div></div>
          <button class="btn btn-danger btn-sm" data-act="wipe" data-status="all">Delete all purchases</button>
        </div>
      </div>` : ""}`;
  }

  function ordersTable(rows) {
    return `
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Reference</th><th>Buyer</th><th>Event</th><th>Tickets</th><th>Amount</th><th>Status</th><th>Ticket</th><th>When</th><th></th>
        </tr></thead>
        <tbody>
        ${rows.map((o) => {
          const tix = (o.items || []).reduce((a, i) => a + i.quantity, 0);
          const badge = o.status === "paid"
            ? `<span class="badge ok">Paid</span>${o.payment_verified ? "" : ` <span class="badge warn" title="Payment reported by the browser but not verified with the gateway">unverified</span>`}`
            : o.status === "cancelled" ? `<span class="badge bad">Cancelled</span>`
              : `<span class="badge warn">Pending</span>`;
          return `<tr>
            <td><span class="ticket-code" style="font-size:.82rem">${esc(o.reference)}</span></td>
            <td>${esc(o.buyer_name)}<div class="small muted">${esc(o.buyer_phone)}<br>${esc(o.buyer_email)}</div></td>
            <td>${esc(o.event_name)}</td>
            <td>${tix}<div class="small muted">${esc((o.items || []).map((i) => i.name + "×" + i.quantity).join(", "))}</div>
                ${(o.tickets || []).length ? `<div class="small muted" style="margin-top:3px">${(o.tickets || []).map((t) =>
                  `<span class="ticket-code" style="font-size:.72rem">${esc(t.code)}</span>${t.status === "used" ? " <span class=\"badge dim\">used</span>" : t.status === "void" ? " <span class=\"badge bad\">void</span>" : ""}`).join("<br>")}</div>` : ""}</td>
            <td><b>${esc(CN.amount(o.total_amount))}</b></td>
            <td>${badge}</td>
            <td class="small">
              ${o.contact_verified ? `<span class="badge ok" title="Email verified by code before paying">verified</span><br>` : `<span class="badge dim">unverified</span><br>`}
              <span class="muted">${esc(o.delivery_method || "email")}</span>
              ${o.delivered_at ? `<br><span class="muted" style="font-size:.72rem">sent ${esc(CN.prettyDateTime(o.delivered_at))}</span>`
                : o.delivery_error ? `<br><span style="color:var(--danger);font-size:.72rem">not sent</span>` : ""}
            </td>
            <td class="small muted">${esc(CN.prettyDateTime(o.created_at))}</td>
            <td>
              <div class="row-actions">
              ${o.status === "pending" ? `<button class="btn btn-primary btn-sm" data-act="mark-paid" data-o="${o.id}">Mark paid</button>` : ""}
              ${o.status !== "cancelled" ? `<button class="btn btn-soft btn-sm" data-act="cancel-order" data-o="${o.id}">Cancel</button>` : ""}
              ${o.status === "paid" ? `<button class="btn btn-soft btn-sm" data-act="resend-ticket" data-o="${o.id}" title="Email the ticket again">Resend</button>` : ""}
              ${o.status === "paid" && cache.settings.telegram_chat_id ? `<button class="btn btn-soft btn-sm" data-act="tg-resend" data-o="${o.id}" title="Send this sale to Telegram again">Re-alert</button>` : ""}
              <button class="btn btn-danger btn-sm" data-act="del-order" data-o="${o.id}" title="Delete this purchase for good">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/></svg>
              </button>
              </div>
            </td>
          </tr>`;
        }).join("")}
        </tbody></table></div>`;
  }

  /* ==========================================================
     ANALYTICS
     ========================================================== */
  let analyticsDays = 30;
  let orderSearch = "";

  function viewAnalytics() {
    const a = cache.analytics;
    if (!a) {
      return `<div class="admin-head"><div><h1 style="font-size:1.8rem;margin:0">Analytics</h1></div></div>
        <div class="panel center"><span class="spinner"></span> Crunching the numbers…</div>`;
    }
    const t = a.totals || {};
    const checkPct = t.tickets_live ? Math.round((t.checked_in / t.tickets_live) * 100) : 0;

    return `
      <div class="admin-head">
        <div><h1 style="font-size:1.8rem;margin:0">Analytics</h1>
          <p class="muted small" style="margin:4px 0 0">How Coast Nation is actually doing.</p></div>
        <div class="filters" style="margin:0">
          ${[7, 30, 90].map((d) => `<button class="chip ${d === analyticsDays ? "active" : ""}" data-act="range" data-days="${d}">Last ${d} days</button>`).join("")}
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat accent"><div class="k">Revenue · last ${a.days} days</div><div class="v">${esc(CN.amount(t.revenue_window))}</div></div>
        <div class="stat"><div class="k">Revenue · all time</div><div class="v">${esc(CN.amount(t.revenue_all))}</div></div>
        <div class="stat teal"><div class="k">Tickets sold</div><div class="v">${t.tickets_all ?? 0}</div></div>
        <div class="stat"><div class="k">Average purchase</div><div class="v">${esc(CN.amount(t.avg_order))}</div></div>
        <div class="stat"><div class="k">Checkout completion</div><div class="v">${t.conversion ?? 0}<span class="small muted" style="font-size:.9rem">%</span></div></div>
        <div class="stat"><div class="k">Checked in at the gate</div><div class="v">${t.checked_in ?? 0}<span class="small muted" style="font-size:.9rem"> / ${t.tickets_live ?? 0} · ${checkPct}%</span></div></div>
      </div>

      <div class="chart-grid full"><div id="chRevenue"></div></div>
      <div class="chart-grid full"><div id="chTickets"></div></div>
      <div class="chart-grid">
        <div id="chEvents"></div>
        <div id="chTypes"></div>
        <div id="chStatus"></div>
        <div id="chHours"></div>
      </div>`;
  }

  function drawAnalytics() {
    const a = cache.analytics;
    if (!a || !window.CNChart) return;
    const cur = cache.settings.currency || "KES";
    const money = (n) => cur + " " + Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 });

    CNChart.line($("#chRevenue"), a.daily, {
      title: "Revenue per day",
      subtitle: `Paid purchases only · last ${a.days} days`,
      color: "#ff6b3d", yKey: "revenue", fmt: money, label: "Revenue"
    });

    CNChart.columns($("#chTickets"), a.daily, {
      title: "Tickets sold per day",
      subtitle: `Last ${a.days} days`,
      color: "#2ee6c5", yKey: "tickets", fmt: CNChart.fmtInt, label: "Tickets"
    });

    CNChart.bars($("#chEvents"), a.by_event || [], {
      title: "Revenue by event",
      subtitle: "All time, paid purchases",
      color: "#ff6b3d", yKey: "revenue", fmt: money, label: "Revenue",
      empty: "No paid purchases yet — this fills in after your first sale."
    });

    CNChart.bars($("#chTypes"), a.by_type || [], {
      title: "Tickets sold by type",
      subtitle: "All time, paid purchases",
      color: "#2ee6c5", yKey: "tickets", fmt: CNChart.fmtInt, label: "Tickets",
      empty: "No tickets sold yet."
    });

    CNChart.status($("#chStatus"), a.status || {}, {
      title: "Purchases by status",
      subtitle: "Where every checkout ended up"
    });

    const busiest = (a.by_hour || []).map((h) => ({ h: h.h, purchases: h.purchases }));
    CNChart.columns($("#chHours"), busiest, {
      title: "When people buy",
      subtitle: "Hour of day, Kenyan time · all purchases",
      color: "#2ee6c5", xKey: "h", yKey: "purchases",
      xFmt: (h) => (h === 0 ? "12am" : h < 12 ? h + "am" : h === 12 ? "12pm" : (h - 12) + "pm"),
      fmt: CNChart.fmtInt, label: "Purchases"
    });
  }

  let resizeTimer;
  window.addEventListener("resize", () => {
    if (tab !== "analytics" || !cache.analytics) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawAnalytics, 180);
  });

  async function loadAnalytics() {
    try {
      cache.analytics = await CN.rpc("admin_analytics", { p_pin: PIN, p_days: analyticsDays });
    } catch (e) {
      CN.toast(e.message, "err");
    }
  }

  /* ==========================================================
     CHECK-IN
     ========================================================== */
  function viewCheckin() {
    return `
      <div class="admin-head">
        <div><h1 style="font-size:1.8rem;margin:0">Gate check-in</h1>
          <p class="muted small" style="margin:4px 0 0">Scan the QR on the ticket, or type the code underneath it.</p></div>
      </div>
      <div class="panel" style="max-width:560px">
        <div class="field"><label>Ticket code</label>
          <input id="scanCode" placeholder="CN1A2B3C4D5E" autocomplete="off" style="text-transform:uppercase"></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-primary" data-act="scan">Check in</button>
          <button class="btn btn-soft" data-act="peek">Check only (don't mark used)</button>
          <button class="btn btn-danger" data-act="void-ticket" title="Stop a ticket working at the gate">Cancel a ticket</button>
          <button class="btn btn-ghost" data-act="camera"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.2-2h6l1.2 2h1.8A2.5 2.5 0 0 1 20 8.5v9A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.4"/></svg> Use camera</button>
        </div>
        <div id="reader" style="margin-top:16px"></div>
        <div id="scanOut"></div>
      </div>`;
  }

  /* ==========================================================
     SETTINGS
     ========================================================== */
  function viewSettings() {
    const s = cache.settings || {};
    const val = (k, d = "") => esc(s[k] ?? d);
    const webhookUrl = (CN_CONFIG.SUPABASE_URL || "").replace(/\/+$/, "") + "/functions/v1/paystack-webhook";
    return `
      <div class="admin-head">
        <div><h1 style="font-size:1.8rem;margin:0">Settings</h1>
          <p class="muted small" style="margin:4px 0 0">Branding, payments, phone alerts and your access PIN.</p></div>
      </div>

      <div class="panel" style="max-width:640px">
        <h3>Profile picture</h3>
        <p class="small muted">Your logo. It replaces the “CN” badge in the header and footer of the whole site.</p>
        <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
          <div class="logo-drop" id="logoDrop">
            ${s.site_logo_url ? `<img src="${val("site_logo_url")}">` : `<span class="small muted">Click<br>to upload</span>`}
          </div>
          <div>
            <input type="file" id="logoFile" accept="image/*" class="hidden">
            <button class="btn btn-soft btn-sm" id="logoPick">Choose image</button>
            <button class="btn btn-ghost btn-sm" id="logoClear" style="${s.site_logo_url ? "" : "display:none"}">Remove</button>
            <div class="small muted" style="margin-top:8px">Square image, PNG or JPG, max 5MB.<br>Saves as soon as it finishes uploading.</div>
          </div>
        </div>
      </div>

      <div class="panel" style="max-width:640px">
        <h3>Site</h3>
        <div class="field"><label>Site name</label><input data-set="site_name" value="${val("site_name")}"></div>
        <div class="field"><label>Tagline</label><input data-set="site_tagline" value="${val("site_tagline")}"></div>
        <div class="field-row">
          <div class="field"><label>Currency code</label><input data-set="currency" value="${val("currency", "KES")}"></div>
          <div class="field"><label>WhatsApp number (with country code)</label><input data-set="contact_whatsapp" value="${val("contact_whatsapp")}"></div>
        </div>
        <div class="field"><label>Contact email</label><input data-set="contact_email" value="${val("contact_email")}"></div>
        <button class="btn btn-primary" data-act="save-settings">Save site settings</button>
      </div>

      <div class="panel" style="max-width:640px">
        <h3>Payments</h3>
        <p class="small muted">Paste the <b>public</b> key from your payment dashboard. Never the secret key — this page runs in the customer's browser.</p>
        <div class="field"><label>Provider</label>
          <select data-set="payment_provider">
            <option value="paystack" ${s.payment_provider === "paystack" ? "selected" : ""}>Paystack (card + M-Pesa)</option>
            <option value="flutterwave" ${s.payment_provider === "flutterwave" ? "selected" : ""}>Flutterwave (card + M-Pesa)</option>
          </select></div>
        <div class="field"><label>Paystack public key</label><input data-set="paystack_public_key" placeholder="pk_live_…" value="${val("paystack_public_key")}"></div>
        <div class="field"><label>Flutterwave public key</label><input data-set="flutterwave_public_key" placeholder="FLWPUBK-…" value="${val("flutterwave_public_key")}"></div>
        <button class="btn btn-primary" data-act="save-settings">Save payment settings</button>
        <p class="small" style="margin-top:12px">${s.paystack_public_key || s.flutterwave_public_key
          ? `<span class="badge ok">Live</span> <span class="muted">A payment key is set — customers pay online and get their QR instantly.</span>`
          : `<span class="badge warn">Not set</span> <span class="muted">Purchases are saved as <b>pending</b> and customers are told to pay you on WhatsApp; you release their tickets with <b>Mark paid</b> under Purchases.</span>`}</p>
      </div>

      <div class="panel" style="max-width:640px">
        <h3>Email &amp; ticket delivery</h3>
        <p class="small muted">Used for the 6-digit verification code and for emailing tickets after payment.</p>
        <ol class="setup-steps small">
          <li>Create a free account at <b>resend.com</b> → Domains → add your domain and paste the DNS records it gives you.</li>
          <li>API Keys → Create → copy the key (starts <code>re_</code>) and paste it below.</li>
          <li>Set the "from" address to something on that verified domain.</li>
        </ol>
        <div class="field"><label>Resend API key</label>
          <input data-set="resend_api_key" type="password" placeholder="re_..." value="${val("resend_api_key")}"></div>
        <div class="field-row">
          <div class="field"><label>Sender name</label><input data-set="mail_from_name" value="${val("mail_from_name")}"></div>
          <div class="field"><label>Sender address</label><input data-set="mail_from_email" placeholder="tickets@yourdomain.com" value="${val("mail_from_email")}"></div>
        </div>
        <div class="field"><label>Public site address (QR codes and email links point here)</label>
          <input data-set="site_url" placeholder="https://yourdomain.com" value="${val("site_url")}"></div>
        <label class="checkbox" style="margin-bottom:16px">
          <input type="checkbox" data-set-bool="otp_required" ${s.otp_required !== "false" ? "checked" : ""}>
          Require buyers to verify their email with a code before paying</label>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-primary" data-act="save-settings">Save</button>
          <button class="btn btn-soft" data-act="mail-test">Send myself a test email</button>
        </div>
        <div id="mailOut" class="small" style="margin-top:12px"></div>
        <p class="small" style="margin-top:12px">${s.resend_api_key && s.mail_from_email
          ? `<span class="badge ok">Ready</span> <span class="muted">Codes and tickets will send.</span>`
          : `<span class="badge warn">Not set up</span> <span class="muted">Until this is filled in, verification codes cannot be sent — buyers will be stuck at the code screen.</span>`}</p>
      </div>

      <div class="panel" style="max-width:640px">
        <h3>Payment confirmation</h3>
        <p class="small muted">Tickets are only created when Paystack itself confirms the payment, never because a browser said so. That needs the webhook.</p>
        <ol class="setup-steps small">
          <li>Paystack dashboard → Settings → API Keys &amp; Webhooks.</li>
          <li>Paste this as the <b>Webhook URL</b>:<br>
            <code style="word-break:break-all">${esc(webhookUrl)}</code></li>
          <li>Copy your <b>secret key</b> (<code>sk_live_...</code>) into the box below <i>and</i> into Supabase → Edge Functions → paystack-webhook → Secrets as <code>PAYSTACK_SECRET_KEY</code>.</li>
        </ol>
        <div class="field"><label>Paystack secret key</label>
          <input data-set="paystack_secret_key" type="password" placeholder="sk_live_..." value="${val("paystack_secret_key")}"></div>
        <button class="btn btn-primary" data-act="save-settings">Save</button>
        <p class="small" style="margin-top:12px">${s.paystack_secret_key
          ? `<span class="badge ok">Set</span> <span class="muted">The webhook can confirm payments.</span>`
          : `<span class="badge bad">Missing</span> <span class="muted">Without this, a paid purchase will stay pending until you mark it paid by hand.</span>`}</p>
      </div>

      <div class="panel" style="max-width:640px">
        <h3>Sale alerts on your phone</h3>
        <p class="small muted">Get a Telegram message the second anyone pays — works with your phone in your pocket.</p>

        <ol class="setup-steps small">
          <li>In Telegram, open <b>@BotFather</b> → send <b>/newbot</b> → pick any name. He replies with a token that looks like <code>8123456789:AAH...</code>. Paste it below and save.</li>
          <li>Open your new bot and send it any message (just "hi").</li>
          <li>Press <b>Find my chat ID</b>, then <b>Send test message</b>.</li>
        </ol>

        <div class="field"><label>Bot token</label>
          <input data-set="telegram_bot_token" type="password" placeholder="8123456789:AAH…" value="${val("telegram_bot_token")}"></div>
        <div class="field"><label>Chat ID</label>
          <input data-set="telegram_chat_id" id="tgChat" placeholder="press “Find my chat ID”" value="${val("telegram_chat_id")}"></div>
        <label class="checkbox" style="margin-bottom:16px">
          <input type="checkbox" data-set-bool="telegram_enabled" ${s.telegram_enabled !== "false" ? "checked" : ""}> Alerts on</label>

        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-primary" data-act="save-settings">Save</button>
          <button class="btn btn-soft" data-act="tg-find">Find my chat ID</button>
          <button class="btn btn-ghost" data-act="tg-test">Send test message</button>
        </div>
        <div id="tgOut" class="small" style="margin-top:12px"></div>
        <p class="small muted" style="margin-top:12px">${s.telegram_bot_token && s.telegram_chat_id
          ? `<span class="badge ok">Connected</span> <span class="muted">Every paid purchase pings your phone.</span>`
          : `<span class="badge warn">Not set up</span> <span class="muted">Follow the three steps above — takes about two minutes.</span>`}</p>
      </div>

      <div class="panel" style="max-width:640px">
        <h3>Access PIN</h3>
        <p class="small muted">This is the only thing standing between the internet and your dashboard. Change it if anyone else has seen it.</p>
        <div class="field-row">
          <div class="field"><label>New PIN</label><input id="newPin" type="password" placeholder="at least 4 characters"></div>
          <div class="field"><label>Repeat new PIN</label><input id="newPin2" type="password"></div>
        </div>
        <button class="btn btn-primary" data-act="change-pin">Change PIN</button>
      </div>`;
  }

  /* ==========================================================
     EVENT MODAL
     ========================================================== */
  function eventModal(ev) {
    const e = ev || {};
    const isNew = !e.id;
    let imageUrl = e.image_url || "";

    $("#modalHost").innerHTML = `
      <div class="modal-backdrop" id="backdrop">
        <div class="modal">
          <div class="modal-head">
            <h3 style="margin:0">${isNew ? "Create event" : "Edit event"}</h3>
            <button class="x-btn" data-close>&times;</button>
          </div>
          <div class="modal-body">
            ${isNew ? `<div class="steps">
              <div class="step active">1 · Event details</div>
              <div class="step">2 · Add tickets</div>
              <div class="step">3 · Publish</div></div>` : ""}

            <div class="field-row" style="grid-template-columns:200px 1fr;align-items:start">
              <div>
                <label>Poster (square works best)</label>
                <div class="img-drop" id="imgDrop">
                  ${imageUrl ? `<img src="${esc(imageUrl)}" id="imgPrev">`
                    : `<div class="small muted" id="imgHint">Click to upload<br>JPG / PNG · max 5MB</div>`}
                </div>
                <input type="file" id="imgFile" accept="image/*" class="hidden">
                <button class="btn btn-ghost btn-sm btn-block" id="imgClear" style="margin-top:8px;${imageUrl ? "" : "display:none"}">Remove image</button>
              </div>
              <div>
                <div class="field"><label>Event name *</label><input id="f_name" value="${esc(e.name || "")}" placeholder="e.g. Sundowner Sessions Vol. 4"></div>
                <div class="field"><label>Short tagline</label><input id="f_tagline" value="${esc(e.tagline || "")}" placeholder="One line that sells it"></div>
                <div class="field-row">
                  <div class="field"><label>Category</label><input id="f_category" value="${esc(e.category || "")}" placeholder="Party, Concert, Sports…"></div>
                  <div class="field"><label>Town</label><input id="f_town" value="${esc(e.town || "")}" placeholder="Mombasa"></div>
                </div>
              </div>
            </div>

            <div class="field"><label>Venue</label><input id="f_venue" value="${esc(e.venue || "")}" placeholder="e.g. Nyali Beach Club"></div>
            <div class="field-row-3">
              <div class="field"><label>Date</label><input id="f_date" type="date" value="${esc(e.event_date || "")}"></div>
              <div class="field"><label>Start time</label><input id="f_start" type="time" value="${esc((e.start_time || "").slice(0, 5))}"></div>
              <div class="field"><label>End time</label><input id="f_end" type="time" value="${esc((e.end_time || "").slice(0, 5))}"></div>
            </div>
            <div class="field"><label>Description</label><textarea id="f_desc" placeholder="Line-up, dress code, what to expect…">${esc(e.description || "")}</textarea></div>

            <h3 style="margin-top:22px">Event / organiser contact</h3>
            <div class="field-row">
              <div class="field"><label>Organiser name</label><input id="f_oname" value="${esc(e.organizer_name || "")}"></div>
              <div class="field"><label>Phone</label><input id="f_ophone" value="${esc(e.organizer_phone || "")}" placeholder="07XX XXX XXX"></div>
            </div>
            <div class="field-row">
              <div class="field"><label>Email</label><input id="f_oemail" value="${esc(e.organizer_email || "")}"></div>
              <div class="field"><label>Instagram</label><input id="f_oig" value="${esc(e.organizer_instagram || "")}" placeholder="@handle"></div>
            </div>

            <div class="field-row" style="align-items:center">
              <div class="field" style="margin:0"><label>Status</label>
                <select id="f_status">
                  <option value="draft" ${e.status === "draft" || !e.status ? "selected" : ""}>Draft — hidden from the public</option>
                  <option value="published" ${e.status === "published" ? "selected" : ""}>Published — live on the site</option>
                  <option value="archived" ${e.status === "archived" ? "selected" : ""}>Archived</option>
                </select></div>
              <label class="checkbox" style="margin-top:20px">
                <input type="checkbox" id="f_featured" ${e.featured ? "checked" : ""}> Feature on the homepage</label>
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn btn-soft" data-close>Cancel</button>
            <button class="btn btn-primary" id="saveEvent">${isNew ? "Save &amp; add tickets →" : "Save changes"}</button>
          </div>
        </div>
      </div>`;

    closers();

    const drop = $("#imgDrop"), file = $("#imgFile");
    drop.onclick = () => file.click();
    $("#imgClear").onclick = () => {
      imageUrl = "";
      drop.innerHTML = `<div class="small muted">Click to upload<br>JPG / PNG · max 5MB</div>`;
      $("#imgClear").style.display = "none";
    };
    file.onchange = async () => {
      const f = file.files[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) return CN.toast("That image is over 5MB.", "err");
      drop.innerHTML = `<span class="spinner"></span>`;
      try {
        const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
        const path = `events/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await CN.db.storage.from(CN_CONFIG.STORAGE_BUCKET).upload(path, f, { cacheControl: "31536000", upsert: false });
        if (error) throw error;
        imageUrl = CN.db.storage.from(CN_CONFIG.STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
        drop.innerHTML = `<img src="${esc(imageUrl)}">`;
        $("#imgClear").style.display = "";
      } catch (err) {
        drop.innerHTML = `<div class="small" style="color:var(--danger)">Upload failed — tap to retry</div>`;
        CN.toast(err.message || "Upload failed", "err");
      }
    };

    $("#saveEvent").onclick = async () => {
      const name = $("#f_name").value.trim();
      if (!name) return CN.toast("The event needs a name.", "err");
      const btn = $("#saveEvent");
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving…';
      try {
        const saved = await CN.rpc("admin_save_event", {
          p_pin: PIN,
          p_event: {
            id: e.id || "",
            name,
            tagline: $("#f_tagline").value.trim(),
            description: $("#f_desc").value.trim(),
            category: $("#f_category").value.trim(),
            venue: $("#f_venue").value.trim(),
            town: $("#f_town").value.trim(),
            event_date: $("#f_date").value,
            start_time: $("#f_start").value,
            end_time: $("#f_end").value,
            image_url: imageUrl,
            organizer_name: $("#f_oname").value.trim(),
            organizer_phone: $("#f_ophone").value.trim(),
            organizer_email: $("#f_oemail").value.trim(),
            organizer_instagram: $("#f_oig").value.trim(),
            status: $("#f_status").value,
            featured: $("#f_featured").checked
          }
        });
        closeModal();
        await refresh();
        tab = "events";
        $$("#sideNav button").forEach((x) => x.classList.toggle("active", x.dataset.tab === "events"));
        render();
        CN.toast(isNew ? "Event created — now add a ticket type." : "Event updated.", "ok");
        if (isNew) ticketModal(saved.id, null);
      } catch (err) {
        CN.toast(err.message, "err");
        btn.disabled = false; btn.textContent = "Save";
      }
    };
  }

  /* ==========================================================
     TICKET TYPE MODAL
     ========================================================== */
  function ticketModal(eventId, tt) {
    const t = tt || {};
    const ev = cache.events.find((x) => x.id === eventId);
    $("#modalHost").innerHTML = `
      <div class="modal-backdrop" id="backdrop">
        <div class="modal" style="max-width:520px">
          <div class="modal-head">
            <div>
              <h3 style="margin:0">${t.id ? "Edit ticket type" : "Add a ticket"}</h3>
              <div class="small muted">${esc(ev ? ev.name : "")}</div>
            </div>
            <button class="x-btn" data-close>&times;</button>
          </div>
          <div class="modal-body">
            <div class="field"><label>Ticket name *</label>
              <input id="t_name" value="${esc(t.name || "")}" placeholder="Early Bird · Regular · VIP · Table of 6"></div>
            <div class="field"><label>What's included (optional)</label>
              <input id="t_desc" value="${esc(t.description || "")}" placeholder="e.g. Entry + one welcome drink"></div>
            <div class="field-row">
              <div class="field"><label>Price (${esc(cache.settings.currency || "KES")}) — 0 for free</label>
                <input id="t_price" type="number" min="0" step="1" value="${esc(t.price ?? 1000)}"></div>
              <div class="field"><label>Quantity (0 = unlimited)</label>
                <input id="t_qty" type="number" min="0" step="1" value="${esc(t.quantity_total ?? 100)}"></div>
            </div>
            <div class="field"><label>Stop selling at (optional)</label>
              <input id="t_end" type="datetime-local" value="${t.sales_end ? new Date(t.sales_end).toISOString().slice(0, 16) : ""}"></div>
            <label class="checkbox"><input type="checkbox" id="t_active" ${t.is_active === false ? "" : "checked"}> Available to buy (shows on the public page)</label>
            ${t.id ? `<p class="small muted" style="margin-top:14px">${t.quantity_sold || 0} already sold.</p>` : ""}
          </div>
          <div class="modal-foot">
            <button class="btn btn-soft" data-close>Cancel</button>
            <button class="btn btn-primary" id="saveTt">${t.id ? "Save ticket" : "Add ticket"}</button>
          </div>
        </div>
      </div>`;
    closers();

    $("#saveTt").onclick = async () => {
      const name = $("#t_name").value.trim();
      if (!name) return CN.toast("Give the ticket a name.", "err");
      const btn = $("#saveTt");
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
      try {
        await CN.rpc("admin_save_ticket_type", {
          p_pin: PIN,
          p_tt: {
            id: t.id || "",
            event_id: eventId,
            name,
            description: $("#t_desc").value.trim(),
            price: Number($("#t_price").value || 0),
            quantity_total: Number($("#t_qty").value || 0),
            sales_end: $("#t_end").value ? new Date($("#t_end").value).toISOString() : "",
            is_active: $("#t_active").checked,
            sort_order: t.sort_order || 0
          }
        });
        closeModal();
        await refresh();
        render();
        CN.toast("Ticket saved.", "ok");
      } catch (err) {
        CN.toast(err.message, "err");
        btn.disabled = false; btn.textContent = "Save";
      }
    };
  }

  function closers() {
    $$("[data-close]").forEach((b) => (b.onclick = closeModal));
    const bd = $("#backdrop");
    if (bd) bd.addEventListener("click", (e) => { if (e.target.id === "backdrop") closeModal(); });
  }
  function closeModal() { $("#modalHost").innerHTML = ""; }

  /* ==========================================================
     ACTION WIRING
     ========================================================== */
  function wire() {
    $$("[data-act]").forEach((el) => (el.onclick = () => handle(el.dataset.act, el.dataset)));

    const os = $("#orderSearch");
    if (os) {
      let t;
      os.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          orderSearch = os.value.trim();
          const rows = settled(await CN.rpc("admin_orders", { p_pin: PIN, p_event_id: $("#orderFilter")?.value || null, p_limit: 300, p_search: orderSearch || null }));
          $("#ordersBox").innerHTML = rows.length
            ? ordersTable(rows)
            : `<div class="empty"><h3>Nothing matches “${esc(orderSearch)}”</h3><p class="small">Try part of a name, an email, a phone number, a reference or a ticket ID.</p></div>`;
          wire();
          const again = $("#orderSearch");
          if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
        }, 260);
      });
    }

    const of = $("#orderFilter");
    if (of) of.onchange = () => {
      const id = of.value;
      const rows = settled(id ? cache.orders.filter((o) => o.event_id === id) : cache.orders);
      $("#ordersBox").innerHTML = rows.length ? ordersTable(rows) : `<div class="empty"><h3>No purchases for that event yet</h3></div>`;
      wire();
    };

    const sc = $("#scanCode");
    if (sc) sc.addEventListener("keydown", (e) => { if (e.key === "Enter") handle("scan", {}); });

    wireLogo();
  }

  /* ---------- profile picture ---------- */
  function wireLogo() {
    const drop = $("#logoDrop"), file = $("#logoFile");
    if (!drop || !file) return;
    const pick = () => file.click();
    drop.onclick = pick;
    $("#logoPick").onclick = pick;
    $("#logoClear").onclick = async () => {
      await saveLogo("");
      drop.innerHTML = `<span class="small muted">Click<br>to upload</span>`;
      $("#logoClear").style.display = "none";
    };
    file.onchange = async () => {
      const f = file.files[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) return CN.toast("That image is over 5MB.", "err");
      drop.innerHTML = `<span class="spinner"></span>`;
      try {
        const ext = (f.name.split(".").pop() || "png").toLowerCase();
        const path = `brand/logo-${Date.now()}.${ext}`;
        const { error } = await CN.db.storage.from(CN_CONFIG.STORAGE_BUCKET).upload(path, f, { cacheControl: "3600", upsert: false });
        if (error) throw error;
        const url = CN.db.storage.from(CN_CONFIG.STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
        await saveLogo(url);
        drop.innerHTML = `<img src="${esc(url)}">`;
        $("#logoClear").style.display = "";
      } catch (err) {
        drop.innerHTML = `<span class="small" style="color:var(--danger)">Failed — tap to retry</span>`;
        CN.toast(err.message || "Upload failed", "err");
      }
    };
  }

  async function saveLogo(url) {
    await CN.rpc("admin_save_setting", { p_pin: PIN, p_key: "site_logo_url", p_value: url });
    cache.settings.site_logo_url = url;
    CN.forgetSettings();
    await CN.applyBrand();
    CN.toast(url ? "Profile picture updated." : "Profile picture removed.", "ok");
  }

  async function handle(act, d) {
    try {
      if (act === "new-event") return eventModal(null);
      if (act === "edit-event") return eventModal(cache.events.find((e) => e.id === d.ev));
      if (act === "go-orders") return goTab("orders");
      if (act === "go-analytics") return goTab("analytics");
      if (act === "range") {
        analyticsDays = Number(d.days) || 30;
        await loadAnalytics();
        return render();
      }
      if (act === "del-order") {
        const o = cache.orders.find((x) => x.id === d.o);
        const warn = o.status === "paid"
          ? `\n\nThis one is PAID (${CN.amount(o.total_amount)}). Its ${o.ticket_count || 0} ticket(s) will be destroyed and put back on sale.`
          : "";
        if (!confirm(`Permanently delete purchase ${o.reference} by ${o.buyer_name}?${warn}\n\nThis cannot be undone.`)) return;
        await CN.rpc("admin_delete_order", { p_pin: PIN, p_order_id: d.o });
        CN.toast(`${o.reference} deleted.`, "ok");
        await refresh();
        if (cache.analytics) await loadAnalytics();
        return render();
      }
      if (act === "wipe") {
        const status = d.status;
        const affected = status === "all" ? cache.orders : cache.orders.filter((o) => o.status === status);
        if (!affected.length) return CN.toast("There's nothing to delete there.", "err");
        const noun = affected.length === 1 ? "purchase" : "purchases";
        const label = status === "all"
          ? `all ${affected.length} ${noun} — paid ones included`
          : `${affected.length} ${status} ${noun}`;
        if (!confirm(`Permanently delete ${label}?\n\nTickets and QR codes go with them. This cannot be undone.`)) return;
        if (status === "all" || status === "paid") {
          const typed = prompt(`This includes paid purchases and real money records.\nType DELETE to confirm.`);
          if (typed !== "DELETE") return CN.toast("Cancelled — nothing was deleted.", "err");
        }
        const res = await CN.rpc("admin_delete_orders", { p_pin: PIN, p_status: status, p_event_id: null });
        CN.toast(`${res.deleted} purchase${res.deleted === 1 ? "" : "s"} deleted.`, "ok");
        await refresh();
        if (cache.analytics) await loadAnalytics();
        return render();
      }
      if (act === "toggle-pub") {
        const ev = cache.events.find((e) => e.id === d.ev);
        await CN.rpc("admin_save_event", { p_pin: PIN, p_event: { id: ev.id, name: ev.name, status: ev.status === "published" ? "draft" : "published" } });
        CN.toast(ev.status === "published" ? "Taken off the site." : "Now live on the public site.", "ok");
        await refresh(); return render();
      }
      if (act === "del-event") {
        const ev = cache.events.find((e) => e.id === d.ev);
        if (!confirm(`Delete “${ev.name}” and all its tickets and orders? This cannot be undone.`)) return;
        await CN.rpc("admin_delete_event", { p_pin: PIN, p_id: d.ev });
        CN.toast("Event deleted.", "ok");
        await refresh(); return render();
      }
      if (act === "toggle-tt") {
        const ev = cache.events.find((e) => e.id === d.ev);
        const tt = (ev.ticket_types || []).find((t) => t.id === d.tt);
        const now = !tt.is_active;
        await CN.rpc("admin_save_ticket_type", { p_pin: PIN, p_tt: { id: tt.id, is_active: now } });
        CN.toast(now ? `“${tt.name}” is on sale.` : `“${tt.name}” is now unavailable.`, "ok");
        await refresh(); return render();
      }
      if (act === "new-tt") return ticketModal(d.ev, null);
      if (act === "edit-tt") {
        const ev = cache.events.find((e) => e.id === d.ev);
        return ticketModal(d.ev, (ev.ticket_types || []).find((t) => t.id === d.tt));
      }
      if (act === "del-tt") {
        if (!confirm("Delete this ticket type?")) return;
        await CN.rpc("admin_delete_ticket_type", { p_pin: PIN, p_id: d.tt });
        CN.toast("Ticket type deleted.", "ok");
        await refresh(); return render();
      }
      if (act === "mark-paid") {
        await CN.rpc("admin_mark_paid", { p_pin: PIN, p_order_id: d.o });
        CN.toast("Marked as paid — tickets issued.", "ok");
        await refresh();
        if (cache.analytics) await loadAnalytics();
        return render();
      }
      if (act === "cancel-order") {
        if (!confirm("Cancel this purchase and void its tickets?")) return;
        await CN.rpc("admin_cancel_order", { p_pin: PIN, p_order_id: d.o });
        CN.toast("Purchase cancelled.", "ok");
        await refresh();
        if (cache.analytics) await loadAnalytics();
        return render();
      }
      if (act === "resend-ticket") {
        const r = await CN.rpc("admin_resend_ticket", { p_pin: PIN, p_order_id: d.o });
        return CN.toast(r.message || (r.ok ? "Queued." : "Could not resend."), r.ok ? "ok" : "err");
      }
      if (act === "void-ticket") {
        const code = prompt("Ticket ID to cancel (this stops it working at the gate):");
        if (!code) return;
        const r = await CN.rpc("admin_void_ticket", { p_pin: PIN, p_code: code.trim() });
        CN.toast(r.ok ? `Ticket ${code.trim()} cancelled.` : r.message, r.ok ? "ok" : "err");
        await refresh(); return render();
      }
      if (act === "tg-resend") {
        await CN.rpc("admin_telegram_resend", { p_pin: PIN, p_order_id: d.o });
        return CN.toast("Sent to Telegram.", "ok");
      }
      if (act === "export") return exportCsv();
      if (act === "scan") return doScan(true);
      if (act === "peek") return doScan(false);
      if (act === "camera") return startCamera();
      if (act === "save-settings") return saveSettings();
      if (act === "mail-test") return mailTest();
      if (act === "tg-find") return telegramFind();
      if (act === "tg-pick") {
        $("#tgChat").value = d.chat;
        await CN.rpc("admin_save_setting", { p_pin: PIN, p_key: "telegram_chat_id", p_value: String(d.chat) });
        return tgSay("Saved. Now send a test message.", "ok");
      }
      if (act === "tg-test") return telegramTest();
      if (act === "change-pin") return changePin();
    } catch (e) {
      CN.toast(e.message, "err");
    }
  }

  /* ---------- CSV ---------- */
  function exportCsv() {
    const rows = [["Reference", "Buyer", "Email", "Phone", "Event", "Tickets", "Amount", "Status", "Created"]];
    settled(cache.orders).forEach((o) =>
      rows.push([
        o.reference, o.buyer_name, o.buyer_email, o.buyer_phone, o.event_name,
        (o.items || []).map((i) => `${i.name} x${i.quantity}`).join(" | "),
        o.total_amount, o.status, o.created_at
      ])
    );
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `coast-nation-purchases-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  /* ---------- scanning ---------- */
  async function doScan(markUsed, codeOverride) {
    const code = (codeOverride || $("#scanCode").value).trim();
    if (!code) return;
    const out = $("#scanOut");
    out.innerHTML = `<div class="scan-result"><span class="spinner"></span></div>`;
    try {
      const r = await CN.rpc("admin_scan_ticket", { p_pin: PIN, p_code: code, p_mark_used: markUsed });
      const ic = {
        check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.4l2.7 2.6L16 9.5"/></svg>',
        warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 4l9 15.5H3z"/><path d="M12 10v4M12 17.2v.1"/></svg>',
        block: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M6 6l12 12"/></svg>',
        cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>'
      };
      const map = {
        valid: ["valid", ic.check + "Let them in", ""],
        already_used: ["used", ic.warn + "Already scanned", r.used_at ? "Used at " + CN.prettyDateTime(r.used_at) : ""],
        void: ["bad", ic.block + "Ticket voided", "This purchase was cancelled."],
        not_found: ["bad", ic.cross + "Not a valid code", "Nothing in the system matches that."]
      };
      const [cls, title, note] = map[r.result] || map.not_found;
      out.innerHTML = `<div class="scan-result ${cls}">
        <div class="big">${title}</div>
        ${r.code ? `<div class="ticket-code">${esc(r.code)}</div>` : ""}
        ${r.buyer ? `<div style="margin-top:8px"><b>${esc(r.buyer)}</b></div>` : ""}
        ${r.type ? `<div class="small muted">${esc(r.type)} · ${esc(r.event || "")}</div>` : ""}
        ${note ? `<div class="small muted" style="margin-top:6px">${esc(note)}</div>` : ""}
      </div>`;
      const inp = $("#scanCode"); if (inp) { inp.value = ""; inp.focus(); }
      if (navigator.vibrate) navigator.vibrate(r.result === "valid" ? 60 : [60, 60, 60]);
      if (r.result === "valid" && markUsed) await refresh();
    } catch (e) {
      out.innerHTML = `<div class="scan-result bad"><div class="big">Error</div><div class="small">${esc(e.message)}</div></div>`;
    }
  }

  let cam = null;
  async function startCamera() {
    const box = $("#reader");
    if (cam) { await cam.stop().catch(() => {}); cam = null; box.innerHTML = ""; return; }
    if (!window.Html5Qrcode) return CN.toast("Camera library didn't load — type the code instead.", "err");
    box.innerHTML = `<div id="readerInner" style="max-width:340px;border-radius:14px;overflow:hidden"></div>`;
    cam = new window.Html5Qrcode("readerInner");
    try {
      await cam.start({ facingMode: "environment" }, { fps: 10, qrbox: 230 }, async (text) => {
        await cam.pause(true);
        await doScan(true, text);
        setTimeout(() => cam && cam.resume(), 1400);
      });
    } catch (e) {
      box.innerHTML = `<p class="small muted">Couldn't open the camera (${esc(e.message || e)}). Type the code instead.</p>`;
      cam = null;
    }
  }


  /* ---------- email test ---------- */
  async function mailTest() {
    const out = $("#mailOut");
    const to = prompt("Send the test email to which address?", cache.settings.contact_email || "");
    if (!to) return;
    out.innerHTML = `<span class="badge warn">Sending</span> queueing…`;
    try {
      for (const k of ["resend_api_key", "mail_from_name", "mail_from_email", "site_url"]) {
        const el = $(`[data-set="${k}"]`);
        if (el) await CN.rpc("admin_save_setting", { p_pin: PIN, p_key: k, p_value: el.value.trim() });
      }
      const r = await CN.rpc("admin_mail_test", { p_pin: PIN, p_to: to.trim() });
      out.innerHTML = r.ok
        ? `<span class="badge ok">Queued</span> <span class="muted">${esc(r.message)}</span>`
        : `<span class="badge bad">Problem</span> <span class="muted">${esc(r.message)}</span>`;
      await refresh();
    } catch (e) {
      out.innerHTML = `<span class="badge bad">Problem</span> <span class="muted">${esc(e.message)}</span>`;
    }
  }

  /* ---------- telegram ---------- */
  function tgSay(html, kind) {
    const out = $("#tgOut");
    if (out) out.innerHTML = `<span class="badge ${kind}">${kind === "ok" ? "Done" : kind === "warn" ? "Wait" : "Problem"}</span> ${html}`;
  }

  async function telegramFind() {
    tgSay("Asking Telegram…", "warn");
    try {
      // save whatever token is in the box first, so the lookup uses it
      const tok = $('[data-set="telegram_bot_token"]');
      if (tok && tok.value.trim()) {
        await CN.rpc("admin_save_setting", { p_pin: PIN, p_key: "telegram_bot_token", p_value: tok.value.trim() });
      }
      const r = await CN.rpc("admin_telegram_find_chat", { p_pin: PIN });
      if (!r.ok) return tgSay(esc(r.message), "bad");
      const chats = r.chats || [];
      if (chats.length === 1) {
        $("#tgChat").value = chats[0].chat_id;
        await CN.rpc("admin_save_setting", { p_pin: PIN, p_key: "telegram_chat_id", p_value: String(chats[0].chat_id) });
        cache.settings.telegram_chat_id = String(chats[0].chat_id);
        return tgSay(`Found <b>${esc(chats[0].name || "your chat")}</b> and saved it. Now send a test message.`, "ok");
      }
      tgSay("Several chats found — pick one: " + chats.map((c) =>
        `<button class="btn btn-soft btn-sm" data-act="tg-pick" data-chat="${esc(c.chat_id)}">${esc(c.name || c.chat_id)}</button>`).join(" "), "warn");
      wire();
    } catch (e) { tgSay(esc(e.message), "bad"); }
  }

  async function telegramTest() {
    tgSay("Sending…", "warn");
    try {
      // make sure what is on screen is what we test with
      for (const k of ["telegram_bot_token", "telegram_chat_id"]) {
        const el = $(`[data-set="${k}"]`);
        if (el) await CN.rpc("admin_save_setting", { p_pin: PIN, p_key: k, p_value: el.value.trim() });
      }
      const r = await CN.rpc("admin_telegram_test", { p_pin: PIN });
      if (r.ok) {
        await refresh();
        render();                       // so the "Connected" badge updates
        tgSay(esc(r.message), "ok");
      } else {
        tgSay(esc(r.message), "bad");
      }
    } catch (e) { tgSay(esc(e.message), "bad"); }
  }

  /* ---------- settings ---------- */
  async function saveSettings() {
    const inputs = $$("[data-set]");
    const toggles = $$("[data-set-bool]");
    try {
      for (const el of inputs) {
        await CN.rpc("admin_save_setting", { p_pin: PIN, p_key: el.dataset.set, p_value: el.value.trim() });
      }
      for (const el of toggles) {
        await CN.rpc("admin_save_setting", { p_pin: PIN, p_key: el.dataset.setBool, p_value: el.checked ? "true" : "false" });
      }
      CN.toast("Settings saved.", "ok");
      CN.forgetSettings();
      await CN.applyBrand();
      await refresh();
      render();
    } catch (e) { CN.toast(e.message, "err"); }
  }

  async function changePin() {
    const a = $("#newPin").value, b = $("#newPin2").value;
    if (a !== b) return CN.toast("The two PINs don't match.", "err");
    if (a.length < 4) return CN.toast("Use at least 4 characters.", "err");
    await CN.rpc("admin_change_pin", { p_pin: PIN, p_new_pin: a });
    PIN = a;
    sessionStorage.setItem("cn_pin", a);
    CN.toast("PIN changed. Write it down somewhere safe.", "ok");
    $("#newPin").value = ""; $("#newPin2").value = "";
  }
})();
