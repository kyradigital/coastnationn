/* ============================================================
   Coast Nation — OFC Portal (gate scanner)

   No sign-in: open the page and you're scanning. The lock is the
   "gate check-ins" switch in admin — while it's ON this page is handed a
   gate session; while it's OFF nothing can be checked or admitted.

   Scanning is one step: a valid ticket is admitted the moment it's read
   (the database re-checks it under a lock, so two gates can't both let the
   same ticket in), shows green for 2 seconds, and the next scan is ready.
   ============================================================ */
(function () {
  const $ = CN.$, $$ = CN.$$, esc = CN.esc;
  const KEY = "cn_team";
  const EV_KEY = "cn_team_event";
  const SHOW_MS = { ok: 2000, warn: 4000, bad: 4000 };   // how long each result stays up

  const store = {
    get(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode — lasts this visit */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* nothing to clear */ } }
  };

  let token = store.get(KEY);
  let events = [];
  let eventId = store.get(EV_KEY);
  let stats = null;
  let cam = null;
  let busy = false;
  let poll = null;
  let gateOpen = true;
  let zoom = 1;               // 1 or 2
  let zoomMode = null;        // "track" (camera zoom) | "lens" (telephoto camera) | null
  let lens = null;            // telephoto camera id, when that's how this phone does 2x
  let sheetTimer = null;
  let last = { text: "", at: 0 };   // the QR still in front of the lens after a result

  CN.applyBrand();
  boot();

  /* ---------------- getting in ---------------- */
  const isExpired = (e) => /SESSION_EXPIRED|session/i.test(String(e && e.message));

  async function boot() {
    if (token) {
      try { await CN.rpc("team_me", { p_token: token }); return showApp(); }
      catch (e) { if (!isExpired(e)) return offline(); }
    }
    await openSession();
  }

  async function openSession() {
    token = "";
    store.del(KEY);
    let r;
    try { r = await CN.rpc("gate_open_session", {}); } catch (e) { return offline(); }
    if (r && r.ok) { token = r.token; store.set(KEY, token); return showApp(); }
    if (r && r.closed) return showClosed();
    showBlocked((r && r.message) || "Couldn't open the scanner.");
  }

  function offline() {
    $("#booting").innerHTML = `<div class="pin-card"><p class="muted">Couldn't reach the server. Check your signal.</p>
      <button class="btn btn-primary btn-block" onclick="location.reload()">Try again</button></div>`;
  }

  function showBlocked(msg) {
    $("#booting").innerHTML = `<div class="pin-card"><p class="muted">${esc(msg)}</p>
      <button class="btn btn-primary btn-block" onclick="location.reload()">Try again</button></div>`;
  }

  // check-ins are off: wait here and come alive by itself when the owner turns them on
  function showClosed() {
    clearInterval(poll);
    stopCamera();
    closeSheet(true);
    $("#app").classList.add("hidden");
    const b = $("#booting");
    b.classList.remove("hidden");
    b.innerHTML = `
      <div class="pin-card">
        <div class="brand" style="justify-content:center;margin-bottom:14px">
          <div class="brand-mark">CN</div>
          <div style="text-align:left"><span data-brand-name>Coast Nation</span><span class="sub">OFC Portal</span></div>
        </div>
        <h2 style="margin:0 0 8px">Gate check-ins are off</h2>
        <p class="muted small" style="margin:0">The scanner opens by itself as soon as check-ins are turned on. Keep this page open.</p>
        <div style="margin-top:18px"><span class="spinner"></span></div>
      </div>`;
    CN.applyBrand();
    poll = setInterval(async () => {
      if (document.hidden) return;
      try {
        const s = await CN.rpc("gate_status", {});
        if (s && s.open) { clearInterval(poll); openSession(); }
      } catch (e) { /* try again next tick */ }
    }, 8000);
  }

  /* ---------------- the gate ---------------- */
  async function showApp() {
    $("#booting").classList.add("hidden");
    $("#app").classList.remove("hidden");
    CN.applyBrand();

    $("#gate").innerHTML = `<div class="panel center"><span class="spinner"></span></div>`;
    try {
      events = await CN.rpc("team_events", { p_token: token }) || [];
    } catch (e) {
      if (isExpired(e)) return openSession();
      $("#gate").innerHTML = `<div class="panel"><p class="muted">${esc(e.message)}</p></div>`;
      return;
    }
    if (!events.length) {
      $("#gate").innerHTML = `<div class="empty"><h3>No events to scan</h3>
        <p class="small">When an event is published it shows up here for check-in.</p></div>`;
      return;
    }
    if (!events.some((x) => x.id === eventId)) eventId = nearestEvent().id;
    gateOpen = true;
    render();
    await loadStats();
    if (gateOpen) startCamera();
    clearInterval(poll);
    // other gates are scanning too, and the owner can close check-ins any time
    poll = setInterval(() => { if (!document.hidden) loadStats(); }, 10000);
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
          <div class="small muted" style="margin-top:2px">${esc(CN.prettyDate(ev.event_date))}${ev.venue ? " · " + esc(ev.venue) : ""}</div>
        </div>
      </div>

      <div class="panel gate-scan">
        <div class="gate-cam" id="camBox">
          <div id="reader"></div>
          <div class="gate-cam-off" id="camOff">
            <button class="btn btn-primary gate-cam-btn" id="camBtn">${cameraIcon()} Start camera</button>
          </div>
          <div class="gate-zoom hidden" id="zoomBox" role="group" aria-label="Zoom">
            <button data-z="1" class="active">1×</button><button data-z="2">2×</button>
          </div>
        </div>
        <form id="codeForm" class="gate-code" autocomplete="off">
          <label for="codeIn" class="gate-code-label">No QR? Type the 6-digit ticket number</label>
          <div class="gate-code-row">
            <span class="gate-code-prefix">CN-</span>
            <input id="codeIn" inputmode="numeric" pattern="[0-9]*" placeholder="482913"
                   autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="go">
            <button class="btn btn-soft" type="submit">Check</button>
          </div>
        </form>
      </div>

      <div id="statsBox">${statsHtml()}</div>

      <div class="panel" style="margin-top:14px">
        <h3 style="margin:0 0 10px;font-size:1rem">Latest at the gate</h3>
        <div id="recentBox">${recentHtml()}</div>
      </div>`;

    const pick = $("#evPick");
    if (pick) pick.onchange = async () => {
      eventId = pick.value;
      store.set(EV_KEY, eventId);
      stats = null;
      $("#statsBox").innerHTML = statsHtml();
      await loadStats();
    };
    $("#camBtn").onclick = () => { unlockAudio(); startCamera(); };
    $$("#zoomBox [data-z]").forEach((b) => (b.onclick = () => setZoom(Number(b.dataset.z))));
    $("#codeForm").onsubmit = (e) => {
      e.preventDefault();
      const v = $("#codeIn").value.trim();
      if (v) { $("#codeIn").blur(); scan(v, true); }
    };
    // the 6th digit checks the ticket by itself — no Enter, no button
    $("#codeIn").oninput = () => {
      const inp = $("#codeIn");
      const digits = inp.value.replace(/\D/g, "");
      if (/^\d*$/.test(inp.value.replace(/[\s-]/g, "")) && digits.length === 6) {
        inp.blur();
        scan(digits, true);
      }
    };
  }

  function cameraIcon() {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" style="vertical-align:-3px"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.2-2h6l1.2 2h1.8A2.5 2.5 0 0 1 20 8.5v9A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.4"/></svg>`;
  }

  /* ---------------- numbers ---------------- */
  // "This phone" is counted on the phone itself — every gate shares one gate account
  const mineKey = () => "cn_gate_mine_" + eventId;
  const mine = () => Number(store.get(mineKey())) || 0;

  async function loadStats() {
    const id = eventId;
    try {
      const s = await CN.rpc("team_stats", { p_token: token, p_event_id: id });
      if (id !== eventId) return;
      stats = s;
      if (s.gate_open === false) return showClosed();
      const sb = $("#statsBox"), rb = $("#recentBox");
      if (sb) sb.innerHTML = statsHtml();
      if (rb) rb.innerHTML = recentHtml();
    } catch (e) {
      if (isExpired(e)) return openSession();
    }
  }

  function statsHtml() {
    if (!stats) return `<div class="gate-stats"><div class="stat"><div class="k">Loading</div><div class="v">…</div></div></div>`;
    const total = stats.total || 0, inside = stats.checked_in || 0, left = Math.max(0, total - inside);
    const pct = total ? Math.round((inside / total) * 100) : 0;
    return `
      <div class="gate-stats">
        <div class="stat teal"><div class="k">This phone</div><div class="v">${mine()}</div></div>
        <div class="stat"><div class="k">Checked in</div><div class="v">${inside}<span class="small muted" style="font-size:.9rem"> / ${total}</span></div></div>
        <div class="stat accent"><div class="k">Still to come</div><div class="v">${left}</div></div>
      </div>
      <div class="gate-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"
           aria-label="${inside} of ${total} tickets checked in"><span style="width:${pct}%"></span></div>`;
  }

  function recentHtml() {
    const rows = (stats && stats.recent) || [];
    if (!rows.length) return `<p class="muted small" style="margin:0">Nobody yet. Check-ins show here.</p>`;
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

  /* ---------------- scanning: read → admitted → next ---------------- */
  const IC = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.4l2.7 2.6L16 9.5"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 4l9 15.5H3z"/><path d="M12 10v4M12 17.2v.1"/></svg>',
    cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>'
  };

  async function scan(text, typed) {
    // the same QR is still in front of the lens right after its result: ignore it for a few seconds
    if (!typed && text === last.text && Date.now() - last.at < 6000) return;
    busy = true;
    pauseCamera();
    showSheet("wait");
    let r;
    try {
      r = await CN.rpc("team_accept", { p_token: token, p_event_id: eventId, p_code: text });
    } catch (e) {
      if (isExpired(e)) { closeSheet(true); return openSession(); }
      last = { text, at: Date.now() };
      return showSheet("error", { message: e.message });
    }
    last = { text, at: Date.now() };
    const inp = $("#codeIn"); if (inp) inp.value = "";
    if (r.result === "closed") return showClosed();
    if (r.result === "admitted") {
      store.set(mineKey(), String(mine() + 1));
      loadStats();
    }
    showSheet(r.result, r);
  }

  const INVALID_HELP = `
    <div class="verdict-help">
      <b>Do not let them in.</b> If they say they bought a ticket, ask for their
      <b>confirmation email from Coast Nation</b> and type the 6-digit ticket number from it below the camera.
    </div>`;

  function showSheet(kind, r = {}) {
    clearTimeout(sheetTimer);
    let host = $("#verdict");
    if (!host) {
      host = document.createElement("div");
      host.id = "verdict";
      document.body.appendChild(host);
    }
    const who = r.buyer ? `<div class="verdict-name">${esc(r.buyer)}</div>` : "";
    const meta = r.type || r.code
      ? `<div class="verdict-meta">${esc(r.type || "")}${r.type && r.code ? " · " : ""}<span class="ticket-code">${esc(r.code || "")}</span></div>` : "";

    const views = {
      wait: () => ["wait", `<div class="center" style="padding:22px 0"><span class="spinner" style="width:30px;height:30px;border-width:3px"></span></div>`],
      admitted: () => ["ok", `<div class="verdict-title">${IC.check} VALID — let them in</div>${who}${meta}`],
      already_used: () => ["warn", `
        <div class="verdict-title">${IC.warn} ALREADY SCANNED</div>${who}${meta}
        <div class="verdict-by">Let in${r.used_at ? " at <b>" + esc(timeOf(r.used_at)) + "</b>" : ""}${r.scanned_by && r.scanned_by !== "Gate" ? " by <b>" + esc(r.scanned_by) + "</b>" : ""}. Don't let them in again.</div>`],
      wrong_event: () => ["bad", `
        <div class="verdict-title">${IC.cross} INVALID — wrong event</div>${who}${meta}
        <div class="verdict-by">This ticket is for <b>${esc(r.event || "another event")}</b>.</div>${INVALID_HELP}`],
      void: () => ["bad", `<div class="verdict-title">${IC.cross} INVALID — ticket cancelled</div>${who}${meta}${INVALID_HELP}`],
      not_found: () => ["bad", `<div class="verdict-title">${IC.cross} INVALID</div>
        <div class="verdict-by">This isn't a Coast Nation ticket.</div>${INVALID_HELP}`],
      error: () => ["bad", `<div class="verdict-title">${IC.cross} Couldn't check</div>
        <div class="verdict-by">${esc(r.message || "")} — check your signal and scan again.</div>`]
    };
    const [tone, html] = (views[kind] || views.not_found)();
    host.className = `verdict ${tone}`;
    host.innerHTML = `<div class="verdict-card" role="alertdialog" aria-live="assertive">${html}
      ${kind === "wait" ? "" : `<div class="verdict-timer" style="animation-duration:${SHOW_MS[tone] || 3000}ms"></div>`}</div>`;
    if (kind === "wait") return;
    buzz(tone);
    beep(kind === "admitted" ? "done" : tone);
    // tap anywhere to clear it early; otherwise it clears itself
    host.onclick = () => closeSheet();
    sheetTimer = setTimeout(closeSheet, SHOW_MS[tone] || 3000);
  }

  function closeSheet(quiet) {
    clearTimeout(sheetTimer);
    const host = $("#verdict");
    if (host) host.remove();
    if (!quiet) resumeCamera();
  }

  // handheld scanners type like a keyboard: Enter/Escape clear a result early
  document.addEventListener("keydown", (e) => {
    if ($("#verdict")) {
      if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); closeSheet(); }
      return;
    }
    const inp = $("#codeIn");
    if (inp && document.activeElement !== inp && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
        && document.activeElement?.tagName !== "SELECT") inp.focus();
  });

  /* ---------------- sound + vibration ---------------- */
  let audio = null;
  function unlockAudio() {
    // iPhones only play sound after a tap — the first tap anywhere unlocks it
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
    } catch (e) { audio = null; }
  }
  document.addEventListener("pointerdown", unlockAudio, { passive: true });

  function beep(kind) {
    if (!audio) return;
    const notes = { ok: [[880, .09]], done: [[880, .07], [1320, .11]], warn: [[520, .14], [520, .14]], bad: [[220, .32]] }[kind];
    if (!notes) return;
    try {
      let t = audio.currentTime;
      notes.forEach(([f, d]) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = kind === "bad" ? "square" : "sine";
        o.frequency.value = f;
        g.gain.setValueAtTime(.0001, t);
        g.gain.exponentialRampToValueAtTime(.25, t + .01);
        g.gain.exponentialRampToValueAtTime(.0001, t + d);
        o.connect(g).connect(audio.destination);
        o.start(t); o.stop(t + d + .02);
        t += d + .05;
      });
    } catch (e) { /* sound is a bonus */ }
  }

  function buzz(tone) {
    if (!navigator.vibrate) return;
    navigator.vibrate(tone === "ok" ? 80 : tone === "warn" ? [120, 80, 120] : [80, 60, 80, 60, 80]);
  }

  /* keep the phone awake while the scanner is open */
  let wake = null;
  async function keepAwake(on) {
    try {
      if (on && "wakeLock" in navigator && !wake) {
        wake = await navigator.wakeLock.request("screen");
        wake.addEventListener("release", () => { wake = null; });
      } else if (!on && wake) { await wake.release(); wake = null; }
    } catch (e) { wake = null; }
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && cam) keepAwake(true); });

  /* ---------------- camera ---------------- */
  function boxSize() {
    const w = ($("#camBox") || document.body).clientWidth || 320;
    return Math.max(180, Math.min(280, Math.round(w * 0.68)));
  }

  async function startCamera(deviceId) {
    if (cam) return;
    if (!window.Html5Qrcode) return CN.toast("Camera didn't load — type the ticket number instead.", "err");
    $("#reader").innerHTML = `<div id="readerInner" class="gate-reader"></div>`;
    cam = new window.Html5Qrcode("readerInner", { verbose: false });
    const btn = $("#camBtn"); if (btn) btn.disabled = true;
    try {
      const size = boxSize();
      await cam.start(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" },
        { fps: 12, qrbox: { width: size, height: size }, aspectRatio: 1 },
        (text) => { if (!busy && !$("#verdict")) scan(text); });
      $("#camOff").classList.add("hidden");
      keepAwake(true);
      await setupZoom();
    } catch (e) {
      cam = null;
      $("#camOff").classList.remove("hidden");
      $("#camOff").insertAdjacentHTML("beforeend",
        `<p class="small muted" style="margin:10px 0 0;max-width:260px">Allow camera access for this site, then tap Start camera. Or type the ticket number below.</p>`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* 2× zoom: use the camera's own zoom when the phone allows it (most Android),
     otherwise switch to the telephoto lens if there is one (iPhone Pro). If the
     phone has neither, the 1×/2× buttons stay hidden. */
  async function setupZoom() {
    const box = $("#zoomBox");
    zoomMode = null;
    try {
      const caps = cam.getRunningTrackCapabilities ? cam.getRunningTrackCapabilities() : {};
      if (caps && caps.zoom && caps.zoom.max >= 2) zoomMode = "track";
    } catch (e) { /* not supported */ }
    if (!zoomMode) {
      try {
        const cams = await window.Html5Qrcode.getCameras();
        const tele = (cams || []).find((c) => /tele/i.test(c.label || ""));
        if (tele) { zoomMode = "lens"; lens = tele.id; }
      } catch (e) { /* no camera list */ }
    }
    if (box) box.classList.toggle("hidden", !zoomMode);
    paintZoom();
    // after a lens switch, put the zoom back where it was
    if (zoomMode === "track" && zoom === 2) applyTrackZoom(2);
  }

  function paintZoom() {
    $$("#zoomBox [data-z]").forEach((b) => b.classList.toggle("active", Number(b.dataset.z) === zoom));
  }

  async function applyTrackZoom(z) {
    try { await cam.applyVideoConstraints({ advanced: [{ zoom: z }] }); return true; }
    catch (e) { return false; }
  }

  async function setZoom(z) {
    if (!cam || z === zoom) return;
    if (zoomMode === "track") {
      if (await applyTrackZoom(z)) { zoom = z; paintZoom(); }
      return;
    }
    if (zoomMode === "lens") {
      zoom = z;
      paintZoom();
      await stopCamera(true);
      await startCamera(z === 2 ? lens : undefined);
    }
  }

  function pauseCamera() {
    busy = true;
    if (cam) { try { cam.pause(true); } catch (e) { /* not scanning yet */ } }
  }
  function resumeCamera() {
    setTimeout(() => {
      if (cam) { try { cam.resume(); } catch (e) { /* stopped meanwhile */ } }
      busy = false;
    }, 250);
  }

  async function stopCamera(keepZoom) {
    if (!cam) return;
    const c = cam; cam = null; busy = false;
    if (!keepZoom) { keepAwake(false); zoom = 1; }
    try { await c.stop(); } catch (e) { /* already stopped */ }
    const r = $("#reader"); if (r) r.innerHTML = "";
    const off = $("#camOff"); if (off && !keepZoom) off.classList.remove("hidden");
  }
})();
