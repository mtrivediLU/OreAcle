/* ============================================================
   OreAcle: Mock Operator Console
   A self-contained simulation that mimics the production app:
   sensors -> anomaly detection -> AI alerts -> ventilation control -> copilot.
   ALL DATA IS SIMULATED. In production these come from the Pico W + a local LLM.
   ============================================================ */
(function () {
  "use strict";

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const round = (v, d = 0) => { const p = 10 ** d; return Math.round(v * p) / p; };
  const ease = (cur, tgt, k = 0.12) => cur + (tgt - cur) * k;

  // ---------- config / thresholds ----------
  const TH = {
    co:   { watch: 25, alert: 35, min: 0, max: 70 },     // ppm (SIM)
    vib:  { watch: 0.18, alert: 0.25, min: 0, max: 0.40 }, // RMS g
    heat: { watch: 30, alert: 33 },                       // index
    temp: { min: 15, max: 45 },
    hum:  { min: 0, max: 100 },
    air:  { min: 0, max: 1.0 },                            // m3/s (SIM)
  };
  const heatIndex = (t, h) => t + (h - 50) * 0.06 + (t > 28 ? (t - 28) * 0.3 : 0);

  // Ventilation-on-Demand: occupancy + air quality + heat -> target fan %
  function vodTarget(z) {
    let f = 30 + clamp(z.occupancy, 0, 3) * 15;            // base + per person (cap ~45)
    f += clamp((z.co / TH.co.alert) * 40, 0, 50);          // air quality term
    const hi = heatIndex(z.temp, z.humidity);
    if (hi > TH.heat.watch) f += (hi - TH.heat.watch) * 4; // heat term
    return clamp(Math.round(f), 0, 100);
  }

  // ---------- state ----------
  function baseZone(id, name, occ) {
    return {
      id, name, occupancy: occ,
      co: rnd(8, 12), no2: rnd(0.2, 0.4), vib: rnd(0.05, 0.08),
      temp: rnd(23, 25), humidity: rnd(52, 58), airflow: rnd(0.42, 0.5),
      fan: 35, mode: "auto",
      tgt: { co: 10, vib: 0.06, temp: 24, humidity: 55, airflow: 0.46, occupancy: occ },
      status: "ok", reasons: [], lastKey: "", lastAlertAt: 0, wasAbnormal: false,
    };
  }
  const state = {
    zones: [
      baseZone("Z3", "North-3", 2),  // active, detailed
      baseZone("Z1", "North-1", 1),
      baseZone("Z2", "East-2", 0),
      baseZone("Z4", "Deep-4", 1),
    ],
    active: "Z3",
    scenario: "normal", scenarioT: 0,
    clock: 14 * 3600,            // sim shift clock seconds (starts 14:00:00)
    hist: { co: [], vib: [], fan: [] },
    feed: [],
    running: false, timer: null, inited: false,
  };
  const HIST_N = 60;
  const activeZone = () => state.zones.find(z => z.id === state.active);

  // ---------- assessment ----------
  function assess(z) {
    const reasons = [];
    if (z.co >= TH.co.alert) reasons.push({ key: "gas", sev: "alert" });
    else if (z.co >= TH.co.watch) reasons.push({ key: "gas", sev: "watch" });
    if (z.vib >= TH.vib.alert) reasons.push({ key: "vib", sev: "alert" });
    else if (z.vib >= TH.vib.watch) reasons.push({ key: "vib", sev: "watch" });
    const hi = heatIndex(z.temp, z.humidity);
    if (hi >= TH.heat.alert) reasons.push({ key: "heat", sev: "alert" });
    else if (hi >= TH.heat.watch) reasons.push({ key: "heat", sev: "watch" });
    let status = "ok";
    if (reasons.some(r => r.sev === "alert")) status = "alert";
    else if (reasons.some(r => r.sev === "watch")) status = "watch";
    z.status = status; z.reasons = reasons;
    return status;
  }
  const worstZone = () => {
    const rank = { ok: 0, watch: 1, alert: 2 };
    return state.zones.slice().sort((a, b) => rank[b.status] - rank[a.status])[0];
  };

  // ---------- AI text (templated to feel like the LLM) ----------
  function alertText(z, key) {
    const co = Math.round(z.co), vib = z.vib.toFixed(2), t = Math.round(z.temp), h = Math.round(z.humidity);
    switch (key) {
      case "gas": return { sev: z.co >= TH.co.alert ? "alert" : "watch",
        text: `<b>${z.name}</b>: CO rising to ${co} ppm with ${z.occupancy} worker${z.occupancy === 1 ? "" : "s"} present.`,
        action: "Increase ventilation now · check diesel equipment" };
      case "vib": return { sev: z.vib >= TH.vib.alert ? "alert" : "watch",
        text: `<b>${z.name}</b>: abnormal vibration (RMS ${vib}); likely bearing wear before failure.`,
        action: "Schedule equipment inspection" };
      case "heat": return { sev: heatIndex(z.temp, z.humidity) >= TH.heat.alert ? "alert" : "watch",
        text: `<b>${z.name}</b>: heat-stress index elevated (${t}°C / ${h}% RH).`,
        action: "Rotate crew · raise airflow" };
      default: return { sev: "ok",
        text: `<b>${z.name}</b>: conditions normalised; ventilation easing to baseline.`, action: "" };
    }
  }

  // ---------- scenarios ----------
  function applyScenario(dt) {
    state.scenarioT += dt;
    const z = activeZone();
    const s = state.scenario, T = state.scenarioT;
    if (s === "normal" || s === "reset") {
      z.tgt.co = 10; z.tgt.vib = 0.06; z.tgt.temp = 24; z.tgt.humidity = 55; z.tgt.airflow = 0.46; z.tgt.occupancy = 2;
    } else if (s === "gas") {
      z.tgt.occupancy = 2; z.tgt.temp = 26;
      // CO climbs; once fan has responded strongly, simulate clearance
      if (z.fan > 72 && T > 10) z.tgt.co = Math.max(10, z.tgt.co - 6);
      else z.tgt.co = Math.min(58, 10 + T * 4.2);
    } else if (s === "bearing") {
      z.tgt.vib = Math.min(0.34, 0.06 + T * 0.035); // ramps and stays (does not self-clear)
    } else if (s === "blast") {
      z.tgt.occupancy = 0;
      if (T < 6) { z.tgt.co = Math.min(62, 12 + T * 9); z.tgt.airflow = 0.25; }
      else { z.tgt.airflow = 0.9; z.tgt.co = Math.max(10, z.tgt.co - 7); } // clearance airflow rises, gas clears
    }
  }

  // ---------- tick ----------
  function tick() {
    const dt = 1;
    state.clock += dt;
    applyScenario(dt);

    state.zones.forEach(z => {
      const noise = (s) => rnd(-s, s);
      // background drift for non-active zones so they feel alive
      if (z.id !== state.active) {
        z.tgt.co = clamp(z.tgt.co + noise(1.2), 6, 16);
        z.tgt.vib = clamp(z.tgt.vib + noise(0.006), 0.04, 0.1);
      }
      z.co = clamp(ease(z.co, z.tgt.co) + noise(0.6), 0, 80);
      z.vib = clamp(ease(z.vib, z.tgt.vib) + noise(0.004), 0, 0.5);
      z.temp = ease(z.temp, z.tgt.temp) + noise(0.15);
      z.humidity = clamp(ease(z.humidity, z.tgt.humidity) + noise(0.4), 20, 95);
      z.airflow = clamp(ease(z.airflow, z.tgt.airflow) + noise(0.01), 0, 1);
      z.occupancy = Math.round(ease(z.occupancy, z.tgt.occupancy, 0.25));

      const prev = z.status;
      assess(z);

      // fan logic
      const target = z.mode === "auto" ? vodTarget(z) : z.fan;
      z.fan = clamp(Math.round(ease(z.fan, target, 0.18)), 0, 100);

      // feed / alert generation (debounced)
      const worstReason = z.reasons.slice().sort((a, b) => (b.sev === "alert") - (a.sev === "alert"))[0];
      const key = worstReason ? worstReason.key : "ok";
      const now = state.clock;
      const escalated = prev !== z.status && z.status !== "ok";
      const stale = z.status !== "ok" && now - z.lastAlertAt > 12;
      const recovered = prev !== "ok" && z.status === "ok" && z.wasAbnormal;
      if (escalated || (stale && key)) { pushAlert(z, key); z.lastKey = key; z.lastAlertAt = now; z.wasAbnormal = true; }
      else if (recovered) { pushAlert(z, "ok"); z.wasAbnormal = false; z.lastAlertAt = now; }
    });

    // history (active zone)
    const a = activeZone();
    pushHist(state.hist.co, a.co); pushHist(state.hist.vib, a.vib); pushHist(state.hist.fan, a.fan);

    render();
  }
  function pushHist(arr, v) { arr.push(v); if (arr.length > HIST_N) arr.shift(); }
  function pushAlert(z, key) {
    const a = alertText(z, key);
    state.feed.unshift({ t: fmtClock(state.clock), sev: a.sev, text: a.text });
    if (state.feed.length > 30) state.feed.pop();
    renderFeed();
  }

  // ---------- rendering ----------
  function fmtClock(s) {
    s = Math.floor(s) % 86400; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    const p = n => String(n).padStart(2, "0"); return `${p(h)}:${p(m)}:${p(ss)}`;
  }
  function render() {
    $("#simClock") && ($("#simClock").textContent = fmtClock(state.clock));
    renderZones(); renderGauges(); renderChart(); renderBanner(); renderVent();
  }

  function renderZones() {
    const el = $("#zones"); if (!el) return;
    el.innerHTML = state.zones.map(z => {
      const label = z.status.toUpperCase();
      return `<div class="zone-card status-${z.status}${z.id === state.active ? " is-active" : ""}">
        <div class="zone-top"><span class="zone-name">${z.name}</span>
          <span class="zone-state">${label}</span><span class="zone-dot"></span></div>
        <div class="zone-metrics">
          <span>CO <b>${Math.round(z.co)}</b></span>
          <span>Vib <b>${z.vib.toFixed(2)}</b></span>
          <span>👤 <b>${z.occupancy}</b></span>
          <span>Fan <b>${z.fan}%</b></span>
        </div></div>`;
    }).join("");
  }

  // gauge factory
  function polar(cx, cy, r, deg) { const a = (deg - 90) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
  function arc(cx, cy, r, start, end) {
    const [x1, y1] = polar(cx, cy, r, start), [x2, y2] = polar(cx, cy, r, end);
    const large = (end - start) % 360 > 180 ? 1 : 0;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }
  const GA_START = -135, GA_SWEEP = 270;
  const GAUGES = [
    { k: "co", label: "CO", unit: "ppm", sim: true, th: TH.co, fmt: v => Math.round(v) },
    { k: "vib", label: "Vibration", unit: "RMS", sim: false, th: TH.vib, fmt: v => v.toFixed(2) },
    { k: "temp", label: "Temp", unit: "°C", sim: false, th: null, range: [15, 40], fmt: v => Math.round(v) },
    { k: "humidity", label: "Humidity", unit: "%", sim: false, th: null, range: [0, 100], fmt: v => Math.round(v) },
    { k: "airflow", label: "Airflow", unit: "m³/s", sim: true, th: null, range: [0, 1], fmt: v => v.toFixed(2) },
    { k: "fan", label: "Fan", unit: "%", sim: false, th: null, range: [0, 100], accent: true, fmt: v => Math.round(v) },
  ];
  function gaugeColor(g, val) {
    if (g.th) { if (val >= g.th.alert) return "var(--alert)"; if (val >= g.th.watch) return "var(--watch)"; return "var(--ok)"; }
    return g.accent ? "var(--accent-2)" : "var(--accent)";
  }
  function renderGauges() {
    const el = $("#gauges"); if (!el) return;
    const z = activeZone();
    if (!el.dataset.built) {
      el.innerHTML = GAUGES.map(g => `
        <div class="gauge" data-k="${g.k}">
          <svg viewBox="0 0 100 70">
            <path d="${arc(50, 40, 33, GA_START, GA_START + GA_SWEEP)}" fill="none" stroke="var(--line)" stroke-width="8" stroke-linecap="round"/>
            <path class="g-val" d="" fill="none" stroke="var(--accent)" stroke-width="8" stroke-linecap="round"/>
          </svg>
          <div class="gauge-val"><span class="g-num">-</span></div>
          <div class="gauge-label">${g.label}${g.sim ? ' <span class="sim-badge">SIM</span>' : ""}</div>
        </div>`).join("");
      el.dataset.built = "1";
    }
    GAUGES.forEach(g => {
      const val = z[g.k];
      const [min, max] = g.th ? [g.th.min, g.th.max] : g.range;
      const frac = clamp((val - min) / (max - min), 0, 1);
      const node = el.querySelector(`.gauge[data-k="${g.k}"]`);
      const path = node.querySelector(".g-val");
      path.setAttribute("d", frac > 0.001 ? arc(50, 40, 33, GA_START, GA_START + GA_SWEEP * frac) : "");
      path.setAttribute("stroke", gaugeColor(g, val));
      node.querySelector(".g-num").innerHTML = `${g.fmt(val)}<small> ${g.unit}</small>`;
    });
  }

  function renderChart() {
    const svg = $("#trendChart"); if (!svg) return;
    const W = 600, H = 220, pad = 8;
    const series = [
      { arr: state.hist.co, min: 0, max: 70, color: "#ff7a45", label: "CO ppm" },
      { arr: state.hist.vib, min: 0, max: 0.4, color: "#8b6cff", label: "Vibration" },
      { arr: state.hist.fan, min: 0, max: 100, color: "#36d6e7", label: "Fan %" },
    ];
    let grid = "";
    for (let i = 0; i <= 4; i++) { const y = pad + (H - 2 * pad) * i / 4; grid += `<line class="grid-line" x1="0" y1="${y}" x2="${W}" y2="${y}"/>`; }
    const lines = series.map(s => {
      const n = s.arr.length; if (!n) return "";
      const pts = s.arr.map((v, i) => {
        const x = n === 1 ? 0 : (i / (HIST_N - 1)) * W;
        const f = clamp((v - s.min) / (s.max - s.min), 0, 1);
        const y = (H - pad) - f * (H - 2 * pad);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(" ");
      return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    }).join("");
    svg.innerHTML = grid + lines;
    const lg = $("#chartLegend");
    if (lg && !lg.dataset.built) {
      lg.innerHTML = series.map(s => `<span class="lg-item"><span class="lg-swatch" style="background:${s.color}"></span>${s.label}</span>`).join("");
      lg.dataset.built = "1";
    }
  }

  function renderFeed() {
    const el = $("#feed"); if (!el) return;
    if (!state.feed.length) { el.innerHTML = `<li class="feed-empty">No alerts yet. Trigger a scenario above to see the AI respond.</li>`; return; }
    el.innerHTML = state.feed.map(f =>
      `<li class="feed-item sev-${f.sev}"><span class="feed-time">${f.t}</span><span class="feed-text">${f.text}</span></li>`).join("");
  }

  function renderBanner() {
    const b = $("#alertBanner"); if (!b) return;
    const w = worstZone();
    b.classList.remove("status-ok", "status-watch", "status-alert");
    b.classList.add("status-" + w.status);
    const stateTxt = { ok: "ALL CLEAR", watch: "CAUTION", alert: "DANGER" }[w.status];
    $("#abState").textContent = stateTxt;
    const reason = w.reasons.slice().sort((a, c) => (c.sev === "alert") - (a.sev === "alert"))[0];
    if (w.status === "ok") {
      $("#abHeadline").textContent = "All monitored zones are within safe limits.";
      $("#abAction").hidden = true;
    } else {
      const a = alertText(w, reason ? reason.key : "ok");
      $("#abHeadline").innerHTML = a.text;
      if (a.action) { $("#abAction").hidden = false; $("#abActionChip").textContent = a.action; }
      else $("#abAction").hidden = true;
    }
  }

  function renderVent() {
    const z = activeZone();
    $("#fanPct") && ($("#fanPct").textContent = z.fan);
    $("#ventAirflow") && ($("#ventAirflow").textContent = z.airflow.toFixed(2) + " m³/s");
    $("#ventLogic") && ($("#ventLogic").textContent = z.mode === "auto" ? "occupancy + air" : "manual override");
    const blades = $("#fanBlades");
    if (blades) {
      if (z.fan < 2) blades.style.animationPlayState = "paused";
      else { blades.style.animationPlayState = "running"; blades.style.animationDuration = (1.9 - z.fan / 100 * 1.7).toFixed(2) + "s"; }
    }
    const slider = $("#fanSlider");
    if (slider && document.activeElement !== slider && z.mode === "auto") slider.value = z.fan;
  }

  // ---------- copilot ----------
  function copilotAnswer(q) {
    q = q.toLowerCase();
    const z = activeZone(), w = worstZone();
    const unsafe = state.zones.filter(x => x.status !== "ok");
    const reasonText = (x) => x.reasons.map(r => ({ gas: `CO ${Math.round(x.co)} ppm`, vib: `vibration RMS ${x.vib.toFixed(2)}`, heat: `heat index ${Math.round(heatIndex(x.temp, x.humidity))}` }[r.key])).join(", ");
    if (/(unsafe|which zone|status|danger|alert|risk)/.test(q)) {
      if (!unsafe.length) return "All four zones are within safe limits right now. Fans are matching demand and no anomalies are flagged.";
      return unsafe.map(x => `${x.name} is in ${x.status.toUpperCase()}: ${reasonText(x)} (${x.occupancy} present, fan ${x.fan}%).`).join(" ");
    }
    if (/(what.*do|action|recommend|should i|next step)/.test(q)) {
      if (w.status === "ok") return "Nothing required. Conditions are normal. Keep ventilation in Auto (demand-based) mode.";
      const key = (w.reasons[0] || {}).key;
      return alertText(w, key).action + ` for ${w.name}, and keep the crew clear until levels normalise.`;
    }
    if (/(co|gas|carbon|air quality)/.test(q)) return state.zones.map(x => `${x.name}: ${Math.round(x.co)} ppm`).join(" · ") + ". Alert limit is 35 ppm.";
    if (/(vibration|bearing|equipment|machine)/.test(q)) return state.zones.map(x => `${x.name}: RMS ${x.vib.toFixed(2)}`).join(" · ") + ". Alert limit is 0.25; rising RMS signals bearing wear.";
    if (/(fan|ventilation|vod|airflow)/.test(q)) return `${z.name} fan is at ${z.fan}% in ${z.mode === "auto" ? "Auto (demand-based)" : "Manual"} mode, airflow ${z.airflow.toFixed(2)} m³/s. Demand logic uses occupancy + air quality + heat.`;
    if (/(temp|heat|humid)/.test(q)) return `${z.name}: ${Math.round(z.temp)}°C, ${Math.round(z.humidity)}% RH (heat index ${Math.round(heatIndex(z.temp, z.humidity))}). Watch above 30.`;
    if (/(summary|report|overview|brief|last)/.test(q)) {
      const al = unsafe.length ? `${unsafe.length} zone(s) need attention: ${unsafe.map(x => x.name + " (" + x.status + ")").join(", ")}.` : "No active alerts.";
      return `Shift snapshot @ ${fmtClock(state.clock)}: 4 zones monitored, ${state.zones.reduce((a, x) => a + x.occupancy, 0)} workers underground. ${al} Ventilation running demand-based.`;
    }
    return "I can answer about zone status, gas/CO, vibration, ventilation, temperature/heat, or give a shift summary. Try one of the suggestions below.";
  }
  function cpAdd(who, html) {
    const box = $("#cpMessages"); if (!box) return null;
    const el = document.createElement("div");
    el.className = "cp-msg " + (who === "user" ? "cp-user" : "cp-ai");
    el.innerHTML = who === "ai" ? `<div class="cp-who">OreAcle AI</div>${html}` : html;
    box.appendChild(el); box.scrollTop = box.scrollHeight; return el;
  }
  function cpAsk(q) {
    if (!q.trim()) return;
    cpAdd("user", escapeHtml(q));
    const thinking = cpAdd("ai", `<div class="cp-typing"><span></span><span></span><span></span></div>`);
    setTimeout(() => { thinking.innerHTML = `<div class="cp-who">OreAcle AI</div>${escapeHtml(copilotAnswer(q))}`;
      $("#cpMessages").scrollTop = $("#cpMessages").scrollHeight; }, 650);
  }
  function escapeHtml(s) { return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // ---------- controls ----------
  function setScenario(name) {
    state.scenario = name; state.scenarioT = 0;
    if (name === "reset") state.scenario = "normal";
    $$(".sc-btn").forEach(b => b.classList.toggle("is-active", b.dataset.scenario === name));
    if (name === "reset") { state.feed = []; renderFeed(); $$(".sc-btn").forEach(b => b.classList.toggle("is-active", b.dataset.scenario === "normal")); }
  }
  function wireControls() {
    $$(".sc-btn").forEach(b => b.addEventListener("click", () => setScenario(b.dataset.scenario)));
    // vent mode
    $$("#ventMode .seg-btn").forEach(b => b.addEventListener("click", () => {
      $$("#ventMode .seg-btn").forEach(x => x.classList.remove("is-active"));
      b.classList.add("is-active");
      const mode = b.dataset.mode; activeZone().mode = mode;
      const slider = $("#fanSlider"); if (slider) slider.disabled = mode !== "manual";
    }));
    const slider = $("#fanSlider");
    if (slider) slider.addEventListener("input", () => { const z = activeZone(); if (z.mode === "manual") { z.fan = +slider.value; renderVent(); } });
    const ack = $("#abAck"); if (ack) ack.addEventListener("click", () => { const b = $("#alertBanner"); b.style.opacity = ".55"; setTimeout(() => b.style.opacity = "", 400); });
    // copilot
    const form = $("#cpForm");
    if (form) form.addEventListener("submit", e => { e.preventDefault(); const i = $("#cpInput"); cpAsk(i.value); i.value = ""; });
    const sugg = ["Which zones are unsafe and why?", "What should I do right now?", "Summarize the last few minutes", "What are the CO levels?"];
    const sc = $("#cpSuggest");
    if (sc) sc.innerHTML = sugg.map(s => `<button class="cp-chip" type="button">${s}</button>`).join("");
    $$(".cp-chip").forEach(c => c.addEventListener("click", () => cpAsk(c.textContent)));
  }

  // ---------- lifecycle ----------
  function init() {
    if (state.inited) return;
    // pre-fill trend history so the chart is immediately populated
    for (let i = 0; i < HIST_N; i++) { state.hist.co.push(rnd(8, 12)); state.hist.vib.push(rnd(0.05, 0.08)); state.hist.fan.push(35); }
    wireControls();
    cpAdd("ai", "Console online. I'm watching four zones on simulated sensor data. Ask me anything, or trigger a scenario above to see how I respond.");
    renderFeed(); render();
    state.inited = true;
  }
  function start() { init(); if (state.running) return; state.running = true; tick(); state.timer = setInterval(tick, 1000); }
  function stop() { state.running = false; if (state.timer) clearInterval(state.timer); state.timer = null; }

  window.MGConsole = { start, stop, init };
})();
