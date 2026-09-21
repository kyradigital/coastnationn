/* ============================================================
   Coast Nation — public event listing
   ============================================================ */
(async function () {
  CN.renderTopbar(CN.$("#topbar"));
  CN.renderFooter(CN.$("#footer"));
  await CN.settings();

  const grid = CN.$("#grid");
  let events = [];
  let filter = "upcoming";
  let term = "";

  try {
    const { data, error } = await CN.db
      .from("events")
      .select("*, ticket_types(*)")
      .order("event_date", { ascending: true });
    if (error) throw error;
    events = data || [];
  } catch (e) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">
      <h3>We couldn't load the events</h3>
      <p class="small">${CN.esc(e.message || e)}</p></div>`;
    return;
  }

  renderStats();
  render();

  CN.$$(".chip").forEach((c) =>
    c.addEventListener("click", () => {
      CN.$$(".chip").forEach((x) => x.classList.remove("active"));
      c.classList.add("active");
      filter = c.dataset.filter;
      render();
    })
  );
  CN.$("#search").addEventListener("input", (e) => {
    term = e.target.value.trim().toLowerCase();
    render();
  });

  function renderStats() {
    const upcoming = events.filter((e) => !CN.isPast(e.event_date)).length;
    CN.$("#heroStats").innerHTML = `
      <div class="hero-stat"><b>${upcoming}</b><span>Events on sale</span></div>
      <div class="hero-stat"><b>Instant</b><span>QR delivery</span></div>`;
  }

  function matches(ev) {
    if (term) {
      const hay = [ev.name, ev.venue, ev.town, ev.category, ev.tagline].join(" ").toLowerCase();
      if (!hay.includes(term)) return false;
    }
    const past = CN.isPast(ev.event_date);
    if (filter === "upcoming") return !past;
    if (filter === "past") return past;
    if (filter === "month") {
      const p = CN.dateParts(ev.event_date);
      const now = new Date();
      return p && !past && p.dt.getMonth() === now.getMonth() && p.dt.getFullYear() === now.getFullYear();
    }
    return true;
  }

  function render() {
    let list = events.filter(matches);
    list.sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      return String(a.event_date || "9999").localeCompare(String(b.event_date || "9999"));
    });

    if (!list.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1">
        <h3>Nothing here yet</h3>
        <p class="small">${term ? "No events match your search." : "New events are announced all the time — check back soon."}</p>
      </div>`;
      return;
    }

    grid.innerHTML = list.map(card).join("");
  }

  function card(ev) {
    const p = CN.dateParts(ev.event_date);
    const types = (ev.ticket_types || []).filter((t) => t.is_active);
    const allClosed = types.length > 0 && types.every(CN.salesClosed);
    const past = CN.isPast(ev.event_date);

    // the ticket that is on sale right now (cheapest of the ones still available)
    const onSale = types
      .filter((t) => !CN.salesClosed(t))
      .sort((a, b) => (a.sort_order - b.sort_order) || Number(a.price) - Number(b.price))[0];

    const priceBlock = past
      ? `<div class="price"><small>Tickets</small>Closed</div>`
      : onSale
        ? `<div class="price"><small>Current ticket</small>${CN.esc(onSale.name)} &middot; ${CN.esc(CN.money(onSale.price))}</div>`
        : types.length
          ? `<div class="price"><small>Tickets</small>Sold out</div>`
          : `<div class="price"><small>Tickets</small>Coming soon</div>`;

    const img = ev.image_url
      ? `<img src="${CN.esc(ev.image_url)}" alt="${CN.esc(ev.name)}" loading="lazy">`
      : `<div class="placeholder">${CN.esc(CN.initials(ev.name))}</div>`;

    let tag = "";
    if (past) tag = `<div class="tag" style="background:rgba(255,255,255,.2)">Past</div>`;
    else if (allClosed) tag = `<div class="tag soldout">Sold out</div>`;
    else if (ev.featured) tag = `<div class="tag">Featured</div>`;

    return `
      <a class="event-card" href="event.html?e=${encodeURIComponent(ev.slug || ev.id)}">
        <div class="event-img">
          ${img}
          ${p ? `<div class="date-badge"><b>${p.day}</b><span>${p.mon}</span></div>` : ""}
          ${tag}
        </div>
        <div class="event-body">
          <h3>${CN.esc(ev.name)}</h3>
          <div class="meta-row">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>
            ${CN.esc([ev.venue, ev.town].filter(Boolean).join(", ") || "Venue to be announced")}
          </div>
          <div class="meta-row">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>
            ${CN.esc(CN.prettyDate(ev.event_date))}${ev.start_time ? " &middot; " + CN.esc(CN.prettyTime(ev.start_time)) : ""}
          </div>
          <div class="event-foot">
            ${priceBlock}
            <span class="btn btn-primary btn-sm">${past || allClosed ? "View" : "Get tickets"}</span>
          </div>
        </div>
      </a>`;
  }
})();
