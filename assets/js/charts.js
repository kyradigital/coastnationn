/* ============================================================
   Coast Nation — tiny SVG chart kit (no libraries)
   One series per chart, dark surface, hover tooltips, table view.
   ============================================================ */
const CNChart = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- scales & helpers ---------- */
  function niceMax(v) {
    if (!v || v <= 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / mag;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    let out = step * mag;
    if (out < 10) out = Math.ceil(out / 2) * 2;   // keep the midpoint tick a whole number
    return out;
  }
  const fmtInt = (n) => Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 });
  function fmtShort(n) {
    const v = Number(n || 0);
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 1) + "M";
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(v % 1e3 === 0 ? 0 : 1) + "k";
    return fmtInt(v);
  }
  const shortDate = (iso) => {
    const d = new Date(iso + "T00:00:00");
    return d.getDate() + " " + ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
  };
  function roundedTop(x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, h, w / 2));
    const y0 = y + h;
    return `M${x},${y0} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y0} Z`;
  }
  function roundedRight(x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w, h / 2));
    return `M${x},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} L${x},${y + h} Z`;
  }

  /* ---------- shared chrome ---------- */
  function figure(host, { title, subtitle, table }) {
    host.innerHTML = `
      <figure class="chart">
        <figcaption>
          <h3>${esc(title)}</h3>
          ${subtitle ? `<p class="small muted">${esc(subtitle)}</p>` : ""}
        </figcaption>
        <div class="chart-plot"><div class="chart-tip" hidden></div></div>
        ${table ? `<details class="chart-table"><summary>Show the numbers</summary>${table}</details>` : ""}
      </figure>`;
    return {
      plot: host.querySelector(".chart-plot"),
      tip: host.querySelector(".chart-tip")
    };
  }

  function tipMover(plot, tip) {
    return (visible, xFrac, html) => {
      if (!visible) { tip.hidden = true; return; }
      tip.hidden = false;
      tip.innerHTML = html;
      const w = plot.clientWidth;
      const tw = tip.offsetWidth;
      let left = xFrac * w - tw / 2;
      left = Math.max(4, Math.min(w - tw - 4, left));
      tip.style.left = left + "px";
    };
  }

  /* ============================================================
     LINE / AREA — one series over time
     ============================================================ */
  function line(host, rows, opts = {}) {
    const {
      title, subtitle, color = "#ff6b3d",
      xKey = "d", yKey = "value",
      fmt = fmtInt, label = "Value"
    } = opts;

    const table = `<table><thead><tr><th>Date</th><th>${esc(label)}</th></tr></thead><tbody>${
      rows.map((r) => `<tr><td>${esc(shortDate(r[xKey]))}</td><td>${esc(fmt(r[yKey]))}</td></tr>`).join("")
    }</tbody></table>`;
    const { plot, tip } = figure(host, { title, subtitle, table });

    const W = Math.max(300, Math.round(plot.clientWidth || 640)), H = 220, P = { l: 54, r: 30, t: 14, b: 28 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const max = niceMax(Math.max(...rows.map((r) => Number(r[yKey]) || 0)));
    const X = (i) => P.l + (rows.length <= 1 ? iw / 2 : (i / (rows.length - 1)) * iw);
    const Y = (v) => P.t + ih - (Math.max(0, Number(v) || 0) / max) * ih;

    const ticks = [0, max / 2, max];
    const grid = ticks.map((t) => `
      <line x1="${P.l}" x2="${W - P.r}" y1="${Y(t)}" y2="${Y(t)}" class="c-grid"/>
      <text x="${P.l - 10}" y="${Y(t) + 4}" class="c-axis" text-anchor="end">${esc(fmtShort(t))}</text>`).join("");

    const pts = rows.map((r, i) => `${X(i)},${Y(r[yKey])}`).join(" ");
    const area = `M${P.l},${P.t + ih} L${pts.split(" ").join(" L")} L${X(rows.length - 1)},${P.t + ih} Z`;

    const lastI = rows.length - 1;
    const lastV = Number(rows[lastI]?.[yKey]) || 0;

    const xLabels = [0, Math.floor(lastI / 2), lastI].map(
      (i) => `<text x="${X(i)}" y="${H - 8}" class="c-axis" text-anchor="${i === 0 ? "start" : i === lastI ? "end" : "middle"}">${esc(shortDate(rows[i][xKey]))}</text>`
    ).join("");

    plot.insertAdjacentHTML("afterbegin", `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
        ${grid}
        <path d="${area}" fill="${color}" opacity=".1"/>
        <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"
                  stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${X(lastI)}" cy="${Y(lastV)}" r="4.5" fill="${color}" stroke="var(--card)" stroke-width="2"/>
        <line class="c-cross" x1="0" x2="0" y1="${P.t}" y2="${P.t + ih}" hidden/>
        <circle class="c-hot" r="4.5" fill="${color}" stroke="var(--card)" stroke-width="2" hidden/>
        ${xLabels}
      </svg>`);

    const svg = plot.querySelector("svg");
    const cross = svg.querySelector(".c-cross");
    const hot = svg.querySelector(".c-hot");
    const move = tipMover(plot, tip);

    svg.addEventListener("pointermove", (e) => {
      const b = svg.getBoundingClientRect();
      const frac = (e.clientX - b.left) / b.width;
      const i = Math.max(0, Math.min(rows.length - 1, Math.round(((frac * W) - P.l) / (iw / Math.max(1, rows.length - 1)))));
      const r = rows[i];
      cross.hidden = false; hot.hidden = false;
      cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i));
      hot.setAttribute("cx", X(i)); hot.setAttribute("cy", Y(r[yKey]));
      move(true, X(i) / W, `<b>${esc(shortDate(r[xKey]))}</b><span>${esc(label)}: ${esc(fmt(r[yKey]))}</span>`);
    });
    svg.addEventListener("pointerleave", () => { cross.hidden = true; hot.hidden = true; move(false); });
  }

  /* ============================================================
     COLUMNS — one series, discrete buckets
     ============================================================ */
  function columns(host, rows, opts = {}) {
    const {
      title, subtitle, color = "#2ee6c5",
      xKey = "d", yKey = "value", xFmt = shortDate,
      fmt = fmtInt, label = "Value"
    } = opts;

    const table = `<table><thead><tr><th>Bucket</th><th>${esc(label)}</th></tr></thead><tbody>${
      rows.map((r) => `<tr><td>${esc(xFmt(r[xKey]))}</td><td>${esc(fmt(r[yKey]))}</td></tr>`).join("")
    }</tbody></table>`;
    const { plot, tip } = figure(host, { title, subtitle, table });

    const W = Math.max(300, Math.round(plot.clientWidth || 640)), H = 220, P = { l: 54, r: 18, t: 14, b: 28 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const max = niceMax(Math.max(...rows.map((r) => Number(r[yKey]) || 0)));
    const band = iw / rows.length;
    const bw = Math.min(24, Math.max(3, band - 2));          // 2px surface gap between neighbours
    const bx = (i) => P.l + i * band + (band - bw) / 2;
    const Y = (v) => P.t + ih - (Math.max(0, Number(v) || 0) / max) * ih;

    const ticks = [0, max / 2, max];
    const grid = ticks.map((t) => `
      <line x1="${P.l}" x2="${W - P.r}" y1="${Y(t)}" y2="${Y(t)}" class="c-grid"/>
      <text x="${P.l - 10}" y="${Y(t) + 4}" class="c-axis" text-anchor="end">${esc(fmtShort(t))}</text>`).join("");

    const bars = rows.map((r, i) => {
      const v = Math.max(0, Number(r[yKey]) || 0);
      const h = (v / max) * ih;
      if (h <= 0) return "";
      return `<path d="${roundedTop(bx(i), Y(v), bw, h, 4)}" fill="${color}"/>`;
    }).join("");

    const lastI = rows.length - 1;
    const xLabels = [0, Math.floor(lastI / 2), lastI].map(
      (i) => `<text x="${bx(i) + bw / 2}" y="${H - 8}" class="c-axis" text-anchor="${i === 0 ? "start" : i === lastI ? "end" : "middle"}">${esc(xFmt(rows[i][xKey]))}</text>`
    ).join("");

    plot.insertAdjacentHTML("afterbegin", `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
        ${grid}
        <rect class="c-band" y="${P.t}" height="${ih}" fill="#fff" opacity=".05" hidden/>
        ${bars}
        ${xLabels}
      </svg>`);

    const svg = plot.querySelector("svg");
    const bandRect = svg.querySelector(".c-band");
    const move = tipMover(plot, tip);

    svg.addEventListener("pointermove", (e) => {
      const b = svg.getBoundingClientRect();
      const x = ((e.clientX - b.left) / b.width) * W;
      const i = Math.max(0, Math.min(rows.length - 1, Math.floor((x - P.l) / band)));
      const r = rows[i];
      bandRect.hidden = false;
      bandRect.setAttribute("x", P.l + i * band);
      bandRect.setAttribute("width", band);
      move(true, (bx(i) + bw / 2) / W, `<b>${esc(xFmt(r[xKey]))}</b><span>${esc(label)}: ${esc(fmt(r[yKey]))}</span>`);
    });
    svg.addEventListener("pointerleave", () => { bandRect.hidden = true; move(false); });
  }

  /* ============================================================
     HORIZONTAL BARS — ranked categories, value at the tip
     ============================================================ */
  function bars(host, rows, opts = {}) {
    const {
      title, subtitle, color = "#ff6b3d",
      nameKey = "name", yKey = "value",
      fmt = fmtInt, label = "Value", empty = "Nothing to show yet."
    } = opts;

    if (!rows.length) {
      host.innerHTML = `<figure class="chart"><figcaption><h3>${esc(title)}</h3></figcaption>
        <p class="muted small" style="padding:18px 2px">${esc(empty)}</p></figure>`;
      return;
    }

    const table = `<table><thead><tr><th>Name</th><th>${esc(label)}</th></tr></thead><tbody>${
      rows.map((r) => `<tr><td>${esc(r[nameKey])}</td><td>${esc(fmt(r[yKey]))}</td></tr>`).join("")
    }</tbody></table>`;
    const { plot, tip } = figure(host, { title, subtitle, table });

    const shown = rows.slice(0, 8);
    const W = Math.max(280, Math.round(plot.clientWidth || 640));
    const rowH = 38, barH = 14, P = { l: 0, r: 4, t: 6 };
    const H = P.t + shown.length * rowH;
    const labelW = Math.round(Math.min(190, Math.max(96, W * 0.34)));
    const valueW = Math.round(Math.min(110, Math.max(64, W * 0.2)));
    const trackX = labelW, trackW = W - labelW - valueW - P.r;
    const max = Math.max(...shown.map((r) => Number(r[yKey]) || 0)) || 1;

    const items = shown.map((r, i) => {
      const y = P.t + i * rowH;
      const v = Math.max(0, Number(r[yKey]) || 0);
      const w = Math.max(2, (v / max) * trackW);
      const name = String(r[nameKey] ?? "");
      const maxChars = Math.max(8, Math.floor(labelW / 7.4));
      const clipped = name.length > maxChars ? name.slice(0, maxChars - 1) + "…" : name;
      return `
        <g class="c-row" data-i="${i}">
          <rect x="0" y="${y}" width="${W}" height="${rowH}" fill="transparent"/>
          <text x="0" y="${y + rowH / 2 + 4}" class="c-name">${esc(clipped)}</text>
          <rect x="${trackX}" y="${y + (rowH - barH) / 2}" width="${trackW}" height="${barH}" rx="4" class="c-track"/>
          <path d="${roundedRight(trackX, y + (rowH - barH) / 2, w, barH, 4)}" fill="${color}"/>
          <text x="${trackX + trackW + 10}" y="${y + rowH / 2 + 4}" class="c-value">${esc(fmt(v))}</text>
        </g>`;
    }).join("");

    plot.insertAdjacentHTML("afterbegin", `
      <svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(title)}" class="c-hbars">${items}</svg>`);

    const svg = plot.querySelector("svg");
    const move = tipMover(plot, tip);
    svg.querySelectorAll(".c-row").forEach((g) => {
      g.addEventListener("pointerenter", () => {
        const r = shown[+g.dataset.i];
        move(true, 0.5, `<b>${esc(r[nameKey])}</b><span>${esc(label)}: ${esc(fmt(r[yKey]))}</span>`);
      });
    });
    svg.addEventListener("pointerleave", () => move(false));
  }

  /* ============================================================
     STATUS ROWS — paid / pending / cancelled (status palette + labels)
     ============================================================ */
  function status(host, counts, opts = {}) {
    const { title = "Purchases by status", subtitle } = opts;
    const defs = [
      { key: "paid", label: "Paid", color: "var(--ok)", note: "tickets issued" },
      { key: "pending", label: "Pending", color: "var(--warn)", note: "awaiting your confirmation" },
      { key: "cancelled", label: "Cancelled", color: "var(--danger)", note: "tickets voided" }
    ];
    const total = defs.reduce((a, d) => a + (counts[d.key] || 0), 0);

    host.innerHTML = `
      <figure class="chart">
        <figcaption><h3>${esc(title)}</h3>${subtitle ? `<p class="small muted">${esc(subtitle)}</p>` : ""}</figcaption>
        <div class="status-rows">
          ${defs.map((d) => {
            const n = counts[d.key] || 0;
            const pct = total ? Math.round((n / total) * 100) : 0;
            return `
              <div class="status-row">
                <div class="status-key"><i style="background:${d.color}"></i>${esc(d.label)}</div>
                <div class="status-track"><i style="width:${pct}%;background:${d.color}"></i></div>
                <div class="status-val"><b>${n}</b> <span class="muted small">${pct}%</span></div>
              </div>`;
          }).join("")}
        </div>
        ${total === 0 ? `<p class="muted small" style="margin:10px 0 0">No purchases yet.</p>` : ""}
      </figure>`;
  }

  return { line, columns, bars, status, fmtInt, fmtShort, shortDate, niceMax };
})();

window.CNChart = CNChart;
