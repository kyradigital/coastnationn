/* ============================================================
   Coast Nation — vehicle registration (public)

   Driver fills in their details + the car + a photo. The photo goes
   straight to the vehicle-photos bucket, then the database checks the
   whole thing and files it as "pending" for the admin to approve.
   ============================================================ */
(async function () {
  const $ = CN.$, esc = CN.esc;
  CN.renderTopbar($("#topbar"), { back: true });
  CN.renderFooter($("#footer"));
  const view = $("#vrView");

  // events you can register a car for: published and not yet over
  let events = [];
  try {
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const { data } = await CN.db.from("events").select("id,name,event_date")
      .eq("status", "published").gte("event_date", today).order("event_date");
    events = data || [];
  } catch (e) { /* the form still works without an event list */ }

  let photo = null;          // { blob, url } once picked and shrunk
  if (!CN.vehicleRegOpen(await CN.settings())) closed();
  else form();

  function closed() {
    view.innerHTML = `
      <div class="center" style="padding:18px 0">
        <h2 style="margin:0 0 8px">Registration is closed</h2>
        <p class="muted" style="margin:0 auto 20px;max-width:400px">We're not taking vehicle registrations right now. Check back soon, or follow us for the next round.</p>
        <a class="btn btn-primary" href="index.html">Browse events</a>
      </div>`;
  }

  // the car goes on the event in the link (?e=…), else the next event coming up
  const targetEvent = () => (events.find((e) => e.id === CN.qs("e")) || events[0] || {}).id || "";

  function form(keep = {}) {
    view.innerHTML = `
      <form id="vrForm" novalidate>
        <h3 class="vr-h" style="margin-top:0">You</h3>
        <div class="field-row">
          <div class="field"><label for="vName">Full name</label>
            <input id="vName" autocomplete="name" placeholder="Jina lako kamili" value="${esc(keep.name || "")}"></div>
          <div class="field"><label for="vPhone">Phone</label>
            <input id="vPhone" inputmode="tel" autocomplete="tel" placeholder="07XX XXX XXX" value="${esc(keep.phone || "")}"></div>
        </div>

        <h3 class="vr-h">Your car</h3>
        <div class="field-row-3">
          <div class="field"><label for="vMake">Make</label>
            <input id="vMake" placeholder="e.g. Subaru" autocapitalize="words" value="${esc(keep.make || "")}"></div>
          <div class="field"><label for="vModel">Model</label>
            <input id="vModel" placeholder="e.g. WRX STI" value="${esc(keep.model || "")}"></div>
          <div class="field"><label for="vPlate">Number plate</label>
            <input id="vPlate" class="vr-plate" placeholder="KCA 123A" autocapitalize="characters" autocomplete="off" spellcheck="false" value="${esc(keep.plate || "")}"></div>
        </div>

        <div class="field"><label>Photo of the car</label>
          <label class="vr-photo" id="vPhotoDrop" for="vPhoto">
            ${photo ? `<img src="${photo.url}" alt="Your car">` : photoHint()}
          </label>
          <input type="file" id="vPhoto" accept="image/*" class="hidden">
          <div class="small muted" style="margin-top:6px">A clear photo of the whole car, number plate visible if you can. Max 5MB.</div>
        </div>

        <div id="vMsg" class="small" style="min-height:20px;color:var(--danger);margin-bottom:8px"></div>
        <button class="btn btn-primary btn-block" id="vGo" type="submit">Submit registration</button>
        <p class="small muted center" style="margin:12px 0 0">We'll review it and contact you on the phone number above.</p>
      </form>`;

    $("#vPhoto").onchange = pickPhoto;
    $("#vPlate").oninput = (e) => { e.target.value = e.target.value.toUpperCase(); };
    $("#vrForm").onsubmit = submit;
  }

  function photoHint() {
    return `<div class="vr-photo-hint">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.2-2h6l1.2 2h1.8A2.5 2.5 0 0 1 20 8.5v9A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.4"/></svg>
      <b>Tap to add a photo</b><span class="small muted">Take one now or pick from your gallery</span></div>`;
  }

  /* Phone photos are often 4–8MB. Shrink to a sharp 1600px JPEG before upload:
     faster on mobile data, and comfortably under the 5MB limit. */
  async function pickPhoto(e) {
    const f = e.target.files[0];
    if (!f) return;
    const drop = $("#vPhotoDrop");
    drop.innerHTML = `<span class="spinner"></span>`;
    try {
      const blob = await shrink(f).catch(() => f);
      if (blob.size > 5 * 1024 * 1024) throw new Error("That photo is over 5MB — try another one.");
      if (photo) URL.revokeObjectURL(photo.url);
      photo = { blob, url: URL.createObjectURL(blob) };
      drop.innerHTML = `<img src="${photo.url}" alt="Your car"><span class="vr-photo-change">Change photo</span>`;
    } catch (err) {
      drop.innerHTML = photoHint();
      $("#vMsg").textContent = err.message;
    }
  }

  function shrink(file, max = 1600) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode")); };
      img.src = url;
    });
  }

  function read() {
    return {
      event_id: targetEvent(),
      name: $("#vName").value.trim(),
      phone: $("#vPhone").value.trim(),
      make: $("#vMake").value.trim(),
      model: $("#vModel").value.trim(),
      plate: $("#vPlate").value.trim()
    };
  }

  async function submit(e) {
    e.preventDefault();
    const d = read();
    const msg = $("#vMsg");
    const missing = [!d.name && "your name", !d.phone && "your phone", !d.make && "the make", !d.model && "the model",
                     !d.plate && "the number plate", !photo && "a photo"].filter(Boolean);
    if (missing.length) { msg.textContent = "Please add " + missing.join(", ").replace(/, ([^,]*)$/, " and $1") + "."; return; }
    msg.textContent = "";

    const btn = $("#vGo");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Uploading photo…';
    try {
      const ext = photo.blob.type === "image/jpeg" ? "jpg" : (photo.blob.type.split("/")[1] || "jpg").replace(/[^a-z0-9]/g, "");
      const path = `submissions/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const up = await CN.db.storage.from("vehicle-photos").upload(path, photo.blob, {
        cacheControl: "31536000", upsert: false, contentType: photo.blob.type || "image/jpeg"
      });
      if (up.error) throw new Error(up.error.message || "The photo didn't upload — try again.");
      const photoUrl = CN.db.storage.from("vehicle-photos").getPublicUrl(path).data.publicUrl;

      btn.innerHTML = '<span class="spinner"></span> Submitting…';
      const r = await CN.rpc("submit_vehicle_registration", {
        p_event_id: d.event_id || null, p_full_name: d.name, p_phone: d.phone, p_email: null,
        p_make: d.make, p_model: d.model, p_year: null, p_colour: null,
        p_plate: d.plate, p_photo_url: photoUrl, p_notes: null
      });
      if (r && r.closed) return closed();
      if (!r || !r.ok) throw new Error((r && r.message) || "Couldn't submit — try again.");
      done(r.reference, d);
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
      btn.textContent = "Submit registration";
    }
  }

  function done(ref, d) {
    const ev = events.find((x) => x.id === d.event_id);
    view.innerHTML = `
      <div class="center" style="padding:10px 0">
        <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="#3ddc97" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.4l2.7 2.6L16 9.5"/></svg>
        <h2 style="margin:12px 0 6px">Registration received</h2>
        <p class="muted" style="margin:0 auto 18px;max-width:420px">Thanks, ${esc(d.name.split(" ")[0])}. Your ${esc(d.make)} ${esc(d.model)}
          (<b>${esc(d.plate.toUpperCase())}</b>)${ev ? ` for <b>${esc(ev.name)}</b>` : ""} is now waiting for approval. We'll contact you on ${esc(d.phone)}.</p>
        <div class="panel" style="display:inline-block;padding:12px 18px;margin-bottom:20px">
          <div class="small muted">Your reference</div>
          <div class="ticket-code" style="font-size:1.3rem">${esc(ref)}</div>
        </div>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <a class="btn btn-primary" href="${ev ? "event.html?e=" + encodeURIComponent(ev.id) : "index.html"}">${ev ? "Get your tickets" : "Browse events"}</a>
          <button class="btn btn-soft" id="vAnother">Register another car</button>
        </div>
      </div>`;
    if (photo) { URL.revokeObjectURL(photo.url); photo = null; }
    $("#vAnother").onclick = () => form({ name: d.name, phone: d.phone });
    view.scrollIntoView({ behavior: "smooth", block: "start" });
  }
})();
