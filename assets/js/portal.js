/* ============================================================
   Coast Nation — OFC Portal (team sign-in + gate official)

   A team member signs in with their @coastnation.net email. The session
   token lives on this phone for 24 hours; every call hands it back to the
   database, which decides what they may do. Gate officials get the scanner
   and their own numbers — nothing else exists on this page.
   ============================================================ */
(function () {
  const $ = CN.$, esc = CN.esc;
  const KEY = "cn_team";
  const EV_KEY = "cn_team_event";

  const store = {
    get(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode — lasts this visit */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* nothing to clear */ } }
  };

  let token = store.get(KEY);
  let me = null;
  let events = [];
  let eventId = store.get(EV_KEY);
  let stats = null;
  let cam = null;
  let busy = false;
  let poll = null;

  CN.applyBrand();
  boot();

  async function boot() {
    if (!token) return showSignIn();
    try {
      me = await CN.rpc("team_me", { p_token: token });
      showApp();
    } catch (e) {
      if (isExpired(e)) return signOut(true);
      // offline or flaky signal: keep them signed in and let them retry
      $("#booting").innerHTML = `<div class="pin-card"><p class="muted">Couldn't reach the server.</p>
        <button class="btn btn-primary btn-block" onclick="location.reload()">Try again</button></div>`;
    }
  }

  const isExpired = (e) => /SESSION_EXPIRED|session/i.test(String(e && e.message));

  /* ---------------- sign in ---------------- */
  function showSignIn(msg) {
    $("#booting").classList.add("hidden");
    $("#app").classList.add("hidden");
    $("#signIn").classList.remove("hidden");
    $("#signMsg").textContent = msg || "";
    const email = $("#tmEmail");
    // typing just the name is fine — the domain is always the same
    email.onblur = () => {
      const v = email.value.trim();
      if (v && !v.includes("@")) email.value = v + "@coastnation.net";
    };
    $("#signCard").onsubmit = signIn;
  }

  async function signIn(e) {
    e.preventDefault();
    const email = $("#tmEmail").value.trim();
    const pass = $("#tmPass").value;
    if (!email || !pass) return;
    const btn = $("#signGo");
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    $("#signMsg").textContent = "";
    try {
      const r = await CN.rpc("team_login", { p_email: email, p_password: pass });
      if (!r || !r.ok) {
        $("#signMsg").textContent = (r && r.message) || "Couldn't sign in.";
        $("#signCard").classList.add("shake");
        setTimeout(() => $("#signCard").classList.remove("shake"), 450);
        $("#tmPass").value = "";
        return;
      }
      token = r.token;
      store.set(KEY, token);
      me = { name: r.name, role: r.role, email: r.email };
      $("#tmPass").value = "";
      showApp();
    } catch (err) {
      $("#signMsg").textContent = err.message;
    } finally {
      btn.disabled = false; btn.textContent = "Sign in";
    }
  }

  async function signOut(expired) {
    clearInterval(poll);
    await stopCamera();
    if (token && !expired) CN.rpc("team_logout", { p_token: token }).catch(() => {});
    token = ""; me = null;
    store.del(KEY);
    showSignIn(expired ? "Your session ended. Sign in again." : "");
  }

  /* ---------------- the gate ---------------- */
  async function showApp() {
    $("#booting").classList.add("hidden");
    $("#signIn").classList.add("hidden");
    $("#app").classList.remove("hidden");
    $("#whoLine").textContent = `${me.name} · Gate official`;
    $("#signOut").onclick = () => signOut(false);
    CN.applyBrand();

    $("#gate").innerHTML = `<div class="panel center"><span class="spinner"></span> Loading events…</div>`;
    try {
      events = await CN.rpc("team_events", { p_token: token }) || [];
    } catch (e) {
      if (isExpired(e)) return signOut(true);
      $("#gate").innerHTML = `<div class="panel"><p class="muted">${esc(e.message)}</p></div>`;
      return;
    }
    if (!events.length) {
      $("#gate").innerHTML = `<div class="empty"><h3>No events to scan</h3>
        <p class="small">When an event is published it shows up here for check-in.</p></div>`;
      return;
    }
    if (!events.some((x) => x.id === eventId)) eventId = nearestEvent().id;
    render();
    await loadStats();
    clearInterval(poll);
    // the other gates are scanning too — keep the totals honest
    poll = setInterval(() => { if (!document.hidden) loadStats(); }, 15000);
  }

  function nearestEvent() {
    const d = new Date();          // local date, not UTC — Kenya is 3 hours ahead
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return events.find((x) => x.event_date >= today) || events[events.length - 1];
  }

  function current() { return events.find((x) => x.id === eventId); }

  function render() {
    const ev = current();
    $("#gate").innerHTML = `
      <div class="gate-event">
        ${ev.image_url ? `<img class="ticket-poster" src="${esc(ev.image_url)}" alt="">`
                       : `<div class="ticket-poster placeholder">${esc(CN.initials(ev.name))}</div>`}
        <div style="min-width:0;flex:1">
          ${events.length > 1
            ? `<select id="evPick" aria-label="Event">${events.map((x) =>
                `<option value="${x.id}" ${x.id === eventId ? "selected" : ""}>${esc(x.name)} · ${esc(CN.prettyDate(x.event_date))}</option>`).join("")}</select>`
            : `<div class="gate-event-name">${esc(ev.name)}</div>`}
          <div class="small muted" style="margin-top:4px">${esc(CN.prettyDate(ev.event_date))}${ev.venue ? " · " + esc(ev.venue) : ""}</div>
        </div>
      </div>

      <div id="statsBox">${statsHtml()}</div>

      <div class="panel gate-scan">
        <button class="btn btn-primary btn-block gate-cam-btn" id="camBtn">${cameraIcon()} Start scanning</button>
        <div id="reader"></div>
        <div id="scanOut"></div>
        <form id="codeForm" class="gate-code">
          <input id="codeIn" placeholder="Or type the ticket ID, e.g. CN1A2B3C4D5E" autocomplete="off"
                 autocapitalize="characters" spellcheck="false">
          <button class="btn btn-soft" type="submit">Check in</button>
        </form>
      </div>

      <div class="panel" style="margin-top:18px">
        <h3 style="margin:0 0 12px">Your last scans</h3>
        <div id="recentBox">${recentHtml()}</div>
      </div>`;

    const pick = $("#evPick");
    if (pick) pick.onchange = async () => {
      eventId = pick.value;
      store.set(EV_KEY, eventId);
      stats = null;
      await stopCamera();          // render() replaces the viewfinder
      render();
      await loadStats();
    };
    $("#camBtn").onclick = toggleCamera;
    $("#codeForm").onsubmit = (e) => {
      e.preventDefault();
      const v = $("#codeIn").value.trim();
      if (v) scan(v);
    };
  }

  function cameraIcon() {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" style="vertical-align:-3px"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.2-2h6l1.2 2h1.8A2.5 2.5 0 0 1 20 8.5v9A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.4"/></svg>`;
  }

  /* ---------------- numbers ---------------- */
  async function loadStats() {
    const id = eventId;
    try {
      const s = await CN.rpc("team_stats", { p_token: token, p_event_id: id });
      if (id !== eventId) return;          // they switched events while this was in flight
      stats = s;
      const sb = $("#statsBox"), rb = $("#recentBox");
      if (sb) sb.innerHTML = statsHtml();
      if (rb) rb.innerHTML = recentHtml();
    } catch (e) {
      if (isExpired(e)) return signOut(true);
    }
  }

  function statsHtml() {
    if (!stats) return `<div class="gate-stats"><div class="stat"><div class="k">Loading</div><div class="v">…</div></div></div>`;
    const total = stats.total || 0, inside = stats.checked_in || 0, left = Math.max(0, total - inside);
    const pct = total ? Math.round((inside / total) * 100) : 0;
    return `
      <div class="gate-stats">
        <div class="stat teal"><div class="k">You scanned</div><div class="v">${stats.mine || 0}</div></div>
        <div class="stat"><div class="k">Checked in</div><div class="v">${inside}<span class="small muted" style="font-size:.9rem"> / ${total}</span></div></div>
        <div class="stat accent"><div class="k">Still to scan</div><div class="v">${left}</div></div>
      </div>
      <div class="gate-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"
           aria-label="${inside} of ${total} tickets checked in"><span style="width:${pct}%"></span></div>
      <div class="small muted" style="margin:6px 0 18px">${pct}% of tickets for this event are through the gate (all gates).</div>`;
  }

  function recentHtml() {
    const rows = (stats && stats.recent) || [];
    if (!rows.length) return `<p class="muted small" style="margin:0">Nobody yet. Your check-ins will show here.</p>`;
    return rows.map((r) => `
      <div class="gate-recent">
        <div style="min-width:0"><b>${esc(r.buyer || "—")}</b><div class="small muted">${esc(r.type || "")} · <span class="ticket-code" style="font-size:.8rem">${esc(r.code)}</span></div></div>
        <div class="small muted" style="flex:none">${esc(timeOf(r.used_at))}</div>
      </div>`).join("");
  }

  function timeOf(ts) {
    const d = new Date(ts);
    return isNaN(d) ? "" : d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
  }

  /* ---------------- scanning ---------------- */
  const IC = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.4l2.7 2.6L16 9.5"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 4l9 15.5H3z"/><path d="M12 10v4M12 17.2v.1"/></svg>',
    cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>'
  };

  async function scan(text) {
    const out = $("#scanOut");
    out.innerHTML = `<div class="scan-result"><span class="spinner"></span></div>`;
    let r;
    try {
      r = await CN.rpc("team_scan", { p_token: token, p_event_id: eventId, p_code: text });
    } catch (e) {
      if (isExpired(e)) return signOut(true);
      out.innerHTML = `<div class="scan-result bad"><div class="big">${IC.cross}Couldn't check</div>
        <div class="small">${esc(e.message)} — check your signal and scan again.</div></div>`;
      buzz(false);
      return;
    }
    const map = {
      valid: ["valid", IC.check + "Let them in", ""],
      already_used: ["used", IC.warn + "Already scanned",
        [r.used_at ? "At " + timeOf(r.used_at) : "", r.scanned_by ? "by " + r.scanned_by : ""].filter(Boolean).join(" ")],
      void: ["bad", IC.cross + "Ticket cancelled", "This ticket was cancelled. Don't let them in."],
      wrong_event: ["bad", IC.cross + "Wrong event", r.event ? `This ticket is for ${r.event}.` : ""],
      not_found: ["bad", IC.cross + "Not a valid ticket", "Nothing in the system matches this code."]
    };
    const [cls, title, note] = map[r.result] || map.not_found;
    out.innerHTML = `<div class="scan-result ${cls}">
      <div class="big">${title}</div>
      ${r.buyer ? `<div style="font-weight:600">${esc(r.buyer)}</div>` : ""}
      ${r.type ? `<div class="small muted">${esc(r.type)}${r.code ? " · " + esc(r.code) : ""}</div>` : ""}
      ${note ? `<div class="small muted" style="margin-top:6px">${esc(note)}</div>` : ""}
    </div>`;
    buzz(r.result === "valid");
    const inp = $("#codeIn"); if (inp) inp.value = "";
    if (r.result === "valid") loadStats();
  }

  function buzz(ok) {
    if (navigator.vibrate) navigator.vibrate(ok ? 80 : [80, 60, 80, 60, 80]);
  }

  async function toggleCamera() {
    if (cam) return stopCamera();
    if (!window.Html5Qrcode) return CN.toast("Camera didn't load — type the ticket ID instead.", "err");
    const btn = $("#camBtn");
    $("#reader").innerHTML = `<div id="readerInner" class="gate-reader"></div>`;
    cam = new window.Html5Qrcode("readerInner");
    btn.disabled = true;
    try {
      await cam.start({ facingMode: "environment" }, { fps: 10, qrbox: 240 }, async (text) => {
        if (busy) return;          // one read per QR
        busy = true;
        try { cam.pause(true); } catch (e) { /* already paused */ }
        try { await scan(text); }
        finally {
          setTimeout(() => {
            try { cam && cam.resume(); } catch (e) { /* stopped meanwhile */ }
            busy = false;
          }, 1500);
        }
      });
      btn.innerHTML = "Stop camera";
      btn.classList.replace("btn-primary", "btn-soft");
    } catch (e) {
      cam = null;
      $("#reader").innerHTML = `<p class="small muted" style="margin:12px 0 0">Couldn't open the camera (${esc(e.message || e)}).
        Allow camera access for this site in your browser settings, or type the ticket ID below.</p>`;
    } finally {
      btn.disabled = false;
    }
  }

  async function stopCamera() {
    if (!cam) return;
    const c = cam; cam = null; busy = false;
    try { await c.stop(); } catch (e) { /* already stopped */ }
    const r = $("#reader"); if (r) r.innerHTML = "";
    const btn = $("#camBtn");
    if (btn) { btn.innerHTML = cameraIcon() + " Start scanning"; btn.classList.replace("btn-soft", "btn-primary"); }
  }
})();
