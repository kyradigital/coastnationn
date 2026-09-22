/* ============================================================
   Coast Nation — ticket check (what a scanned QR opens)

   Anyone holding the link sees whether the ticket is good.
   Only someone with the staff PIN can spend it.
   ============================================================ */
(async function () {
  const view = CN.$("#view");
  const token = CN.qs("t");
  await CN.settings();

  const ICONS = {
    ok:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.4l2.7 2.6L16 9.5"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l9 15.5H3z"/><path d="M12 10v4M12 17.2v.1"/></svg>',
    bad:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>'
  };

  if (!token) return paintMissing();
  await load();

  async function load() {
    let r;
    try {
      r = await CN.rpc("verify_ticket", { p_token: token });
    } catch (e) {
      return paint("bad", ICONS.bad, "Couldn't check", e.message, "");
    }
    if (!r || r.result === "invalid") {
      return paint("bad", ICONS.bad, "Invalid ticket",
        "This code isn't in the system. It was not issued by Coast Nation.", "");
    }

    const rows = `
      <div class="verify-rows">
        <div><span class="k">Name</span><span class="v">${CN.esc(r.holder || "—")}</span></div>
        <div><span class="k">Event</span><span class="v">${CN.esc(r.event || "—")}</span></div>
        <div><span class="k">Date</span><span class="v">${CN.esc(CN.prettyDate(r.event_date))}</span></div>
        ${r.venue ? `<div><span class="k">Venue</span><span class="v">${CN.esc(r.venue)}</span></div>` : ""}
        <div><span class="k">Ticket</span><span class="v">${CN.esc(r.type || "—")}</span></div>
        <div><span class="k">ID</span><span class="v ticket-code" style="font-size:.85rem">${CN.esc(r.code)}</span></div>
      </div>`;

    if (r.result === "used") {
      return paint("warn", ICONS.warn, "Already used",
        `Scanned at ${CN.esc(CN.prettyDateTime(r.used_at))}. Someone has already come in on this ticket.`, rows);
    }
    if (r.result === "void") {
      return paint("bad", ICONS.bad, "Ticket cancelled",
        "This ticket was cancelled by Coast Nation and cannot be used.", rows);
    }
    paint("ok", ICONS.ok, "Valid ticket", "", rows, true);
  }

  function paint(kind, icon, title, note, rows, allowUse) {
    view.innerHTML = `
      <div class="verify-card ${kind}">
        <div class="verify-head">
          <div class="verify-icon">${icon}</div>
          <div>
            <div class="verify-title">${CN.esc(title)}</div>
            <div class="small muted">Coast Nation</div>
          </div>
        </div>
        ${note ? `<p class="muted" style="margin:0 0 4px">${note}</p>` : ""}
        ${rows}
        ${allowUse ? `
          <div id="useBox">
            <button class="btn btn-primary btn-block" id="useBtn">Mark as used — let them in</button>
            <p class="small muted center" style="margin:10px 0 0">Staff only. Asks for the gate PIN.</p>
          </div>` : ""}
        <p class="small muted center" style="margin:16px 0 0">
          <a href="index.html" style="color:var(--teal)">Coast Nation tickets</a>
        </p>
      </div>`;
    if (allowUse) CN.$("#useBtn").onclick = askPin;
  }

  function paintMissing() {
    paint("bad", ICONS.bad, "Nothing to check",
      "This link is missing its ticket code. Scan the QR on the ticket itself.", "");
  }

  /* ---- spending the ticket needs the staff PIN ---- */
  function askPin() {
    const box = CN.$("#useBox");
    box.innerHTML = `
      <div class="field" style="margin-bottom:10px">
        <label>Gate PIN</label>
        <input id="pin" type="password" inputmode="numeric" autocomplete="off" placeholder="Staff PIN">
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-soft" id="pinCancel" style="flex:1">Cancel</button>
        <button class="btn btn-primary" id="pinGo" style="flex:2">Confirm entry</button>
      </div>
      <div id="pinMsg" class="small" style="margin-top:10px"></div>`;
    CN.$("#pin").focus();
    CN.$("#pinCancel").onclick = load;
    CN.$("#pinGo").onclick = doUse;
    CN.$("#pin").addEventListener("keydown", (e) => { if (e.key === "Enter") doUse(); });
  }

  async function doUse() {
    const pin = CN.$("#pin").value.trim();
    const msg = CN.$("#pinMsg");
    const btn = CN.$("#pinGo");
    if (!pin) return;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      const r = await CN.rpc("admin_use_ticket", { p_pin: pin, p_token: token });
      if (r.result === "used") {
        if (navigator.vibrate) navigator.vibrate(60);
        return load();          // repaint — it now reads "already used"
      }
      msg.innerHTML = `<span style="color:var(--danger)">Couldn't use this ticket.</span>`;
      btn.disabled = false; btn.textContent = "Confirm entry";
    } catch (e) {
      msg.innerHTML = `<span style="color:var(--danger)">${CN.esc(e.message)}</span>`;
      btn.disabled = false; btn.textContent = "Confirm entry";
    }
  }
})();
