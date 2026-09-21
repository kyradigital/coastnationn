/* ============================================================
   Coast Nation — shared helpers
   ============================================================ */
const CN = (() => {
  const cfg = window.CN_CONFIG;
  const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  });

  /* ---------- tiny DOM helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  /* ---------- formatting ---------- */
  let currency = "KES";
  // money(): prices — 0 reads as "Free". amount(): totals/revenue — always a number.
  const amount = (n) =>
    currency + " " + Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 });
  const money = (n) => (Number(n || 0) === 0 ? "Free" : amount(n));
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

  function dateParts(d) {
    if (!d) return null;
    const dt = new Date(d + "T00:00:00");
    if (isNaN(dt)) return null;
    return { day: dt.getDate(), mon: MONTHS[dt.getMonth()], year: dt.getFullYear(), weekday: DAYS[dt.getDay()], dt };
  }
  function prettyDate(d) {
    const p = dateParts(d);
    return p ? `${p.weekday}, ${p.day} ${p.mon} ${p.year}` : "Date to be announced";
  }
  function prettyTime(t) {
    if (!t) return "";
    const [h, m] = t.split(":").map(Number);
    const ap = h >= 12 ? "PM" : "AM";
    const hh = h % 12 === 0 ? 12 : h % 12;
    return `${hh}:${String(m).padStart(2, "0")} ${ap}`;
  }
  function prettyDateTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  }
  const isPast = (d) => {
    const p = dateParts(d);
    if (!p) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return p.dt < today;
  };

  /* ---------- toast ---------- */
  let toastEl, toastTimer;
  function toast(msg, kind = "") {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.className = "show " + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.className = kind), 3600);
  }

  /* ---------- settings ---------- */
  let settingsCache = null;
  async function settings() {
    if (settingsCache) return settingsCache;
    const { data, error } = await db.from("settings").select("key,value");
    settingsCache = {};
    if (!error && data) data.forEach((r) => (settingsCache[r.key] = r.value));
    if (settingsCache.currency) currency = settingsCache.currency;
    return settingsCache;
  }

  function forgetSettings() { settingsCache = null; }

  /* ---------- rpc wrapper ---------- */
  async function rpc(fn, args = {}) {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(friendlyError(error.message));
    return data;
  }
  function friendlyError(m) {
    const map = {
      INVALID_PIN: "That PIN is not right.",
      SOLD_OUT: "Sorry — that ticket just sold out.",
      SALES_CLOSED: "Ticket sales for this event have closed.",
      NO_TICKETS_SELECTED: "Pick at least one ticket first.",
      MISSING_BUYER_DETAILS: "Please fill in your name, email and phone number.",
      EVENT_NOT_AVAILABLE: "This event is not on sale right now.",
      TICKET_TYPE_NOT_FOUND: "That ticket type is no longer available.",
      ORDER_NOT_FOUND: "We could not find that order.",
      PIN_TOO_SHORT: "The new PIN must be at least 4 characters."
    };
    for (const k in map) if (String(m).includes(k)) return map[k];
    return m;
  }

  /* ---------- footer + secret admin door ---------- */
  function renderFooter(el) {
    const y = new Date().getFullYear();
    el.innerHTML = `
      <div class="wrap footer-inner">
        <div>
          <div class="brand" style="margin-bottom:8px">
            <div class="brand-mark">CN</div>
            <div><span data-brand-name>Coast Nation</span><span class="sub">Events &amp; ticketing, Kenya</span></div>
          </div>
          <div class="small muted">Buy tickets online. Show the QR at the gate.</div>
        </div>
        <div style="text-align:right">
          <div class="footer-links" style="justify-content:flex-end;margin-bottom:10px">
            <a href="index.html">Events</a>
            <a href="ticket.html">Find my ticket</a>
            <a id="waLink" href="#" target="_blank" rel="noopener">WhatsApp us</a>
          </div>
          <div id="secretKey" title="">&copy; ${y} All rights reserved &middot; Coast Nation</div>
        </div>
      </div>`;
    settings().then((s) => {
      const wa = $("#waLink", el);
      if (wa && s.contact_whatsapp) wa.href = "https://wa.me/" + s.contact_whatsapp.replace(/\D/g, "");
      const sk = $("#secretKey", el);
      if (sk && s.site_name) sk.innerHTML = `&copy; ${y} All rights reserved &middot; ${esc(s.site_name)}`;
      applyBrand();
    });
    armSecret($("#secretKey", el));
  }

  /* ---------- brand mark: profile picture + site name everywhere ---------- */
  async function applyBrand() {
    const s = await settings();
    const logo = s.site_logo_url;
    const name = s.site_name || "Coast Nation";
    $$(".brand-mark").forEach((el) => {
      if (logo) {
        el.classList.add("has-logo");
        el.innerHTML = `<img src="${esc(logo)}" alt="${esc(name)}">`;
      } else {
        el.classList.remove("has-logo");
        el.textContent = name.split(/\s+/).map((w) => w.charAt(0).toUpperCase()).join("").slice(0, 2) || "CN";
      }
    });
    $$("[data-brand-name]").forEach((el) => (el.textContent = name));
  }

  function armSecret(node) {
    if (!node) return;
    const need = window.CN_CONFIG.SECRET_CLICKS || 3;
    const win = window.CN_CONFIG.SECRET_WINDOW_MS || 2500;
    let hits = 0, timer = null;
    const reset = () => { hits = 0; node.classList.remove("armed"); };
    node.addEventListener("click", (e) => {
      e.preventDefault();
      hits++;
      clearTimeout(timer);
      if (hits >= need) {
        reset();
        sessionStorage.setItem("cn_door", "1");
        window.location.href = "admin.html";
        return;
      }
      if (hits > 1) node.classList.add("armed");
      timer = setTimeout(reset, win);
    });
  }

  /* ---------- top bar ---------- */
  function renderTopbar(el, opts = {}) {
    el.innerHTML = `
      <div class="wrap topbar-inner">
        <a class="brand" href="index.html">
          <div class="brand-mark">CN</div>
          <div><span data-brand-name>Coast Nation</span><span class="sub">Tickets, Kenya</span></div>
        </a>
        <div class="nav-actions">
          <a class="btn btn-ghost btn-sm" href="ticket.html">My tickets</a>
          ${opts.back ? `<a class="btn btn-soft btn-sm" href="index.html">All events</a>` : ""}
        </div>
      </div>`;
    applyBrand();
  }

  /* ---------- misc ---------- */
  const qs = (k) => new URLSearchParams(location.search).get(k);
  const initials = (s) => String(s || "?").trim().charAt(0).toUpperCase();

  function ticketsLeft(tt) {
    if (!tt.quantity_total || tt.quantity_total <= 0) return Infinity;
    return Math.max(0, tt.quantity_total - (tt.quantity_sold || 0));
  }
  function salesClosed(tt) {
    if (tt.sales_end && new Date(tt.sales_end) < new Date()) return true;
    return ticketsLeft(tt) === 0;
  }
  function fromPrice(types) {
    const live = (types || []).filter((t) => t.is_active !== false);
    if (!live.length) return null;
    return Math.min(...live.map((t) => Number(t.price || 0)));
  }

  return {
    db, $, $$, esc, money, amount, prettyDate, prettyTime, prettyDateTime, dateParts, isPast,
    toast, settings, forgetSettings, rpc, renderFooter, renderTopbar, applyBrand, armSecret, qs, initials,
    ticketsLeft, salesClosed, fromPrice,
    get currency() { return currency; }
  };
})();
