/* ============================================================
   OreAcle: Live Console
   Backend-first: connects to ws://localhost:8000/ws for live readings.
   Falls back to the built-in simulator when the backend is offline.
   ============================================================ */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd   = (a, b) => a + Math.random() * (b - a);
  const ease  = (cur, tgt, k = 0.12) => cur + (tgt - cur) * k;

  // ------------------------------------------------------------------ config
  const WS_URL  = "ws://localhost:8000/ws";
  const API_URL = "http://localhost:8000";

  const ZONES = [
    "Zone A - Entry/Shaft",
    "Zone B - Active Stope",
    "Zone C - Equipment Bay",
    "Zone D - Refuge",
  ];
  const ZONE_LABEL = {
    "Zone A - Entry/Shaft":   "Entry / Shaft",
    "Zone B - Active Stope":  "Active Stope",
    "Zone C - Equipment Bay": "Equip. Bay",
    "Zone D - Refuge":        "Refuge",
  };

  // thresholds match backend rules exactly
  const TH = {
    co:      { watch: 25,  alert: 50  },
    no2:     { watch: 2.5, alert: 5.0 },
    vib:     { watch: 0.4, alert: 0.8 },
    temp:    { watch: 28,  alert: 35  },
    airflow: { watchLow: 1.2, alertLow: 0.8 },
  };

  // ------------------------------------------------------------------ state
  const HIST_N = 60;
  const state = {
    mode: "offline",        // "live" | "offline"
    ws: null,
    retryTimer: null,
    latestByZone: {},       // zone name → last backend reading
    lastAlertText: {},      // zone name → last alert_text pushed to feed
    activeZone: ZONES[0],
    feed: [],
    hist: { co: [], vib: [], fan: [] },
    // sim fallback
    simZones: [],
    simScenario: "normal",
    simT: 0,
    // ui
    running: false,
    timer: null,
    inited: false,
    rafPending: false,
    fanMode: "auto",
  };

  // ------------------------------------------------------------------ WebSocket
  function connectWS() {
    if (state.ws) return;
    let ws;
    try { ws = new WebSocket(WS_URL); }
    catch (e) { scheduleRetry(); return; }
    state.ws = ws;

    ws.onopen = () => {
      clearRetry();
      setConnStatus("live");
      cpAdd("ai", "Backend connected. Watching all four zones with live sensor data. Ask me anything, or trigger a scenario.");
    };

    ws.onmessage = evt => {
      try { onReading(JSON.parse(evt.data)); }
      catch (e) { /* ignore malformed frames */ }
    };

    const onLost = () => {
      state.ws = null;
      setConnStatus("offline");
      scheduleRetry();
    };
    ws.onclose = ws.onerror = onLost;
  }

  function scheduleRetry() {
    if (state.retryTimer) return;
    state.retryTimer = setTimeout(() => { state.retryTimer = null; connectWS(); }, 3000);
  }
  function clearRetry() {
    if (state.retryTimer) { clearTimeout(state.retryTimer); state.retryTimer = null; }
  }

  function setConnStatus(mode) {
    state.mode = mode;
    const el = $("#connStatus");
    if (el) {
      el.className = "conn-status " + (mode === "live" ? "conn-online" : "conn-offline");
      el.textContent = mode === "live" ? "Connected" : "Backend offline";
    }
    const badge = $("#simBadge");
    if (badge) badge.textContent = mode === "live" ? "LIVE DATA · BACKEND" : "SAMPLE DATA · SIMULATION";
    const disc = $("#cpDisclaimer");
    if (disc) disc.textContent = mode === "live"
      ? "Connected to OreAcle backend. Answers use the live local LLM (Ollama) with a smart template fallback."
      : "Backend offline — copilot is answering from the built-in simulation.";
  }

  // ------------------------------------------------------------------ reading handler
  function onReading(r) {
    state.latestByZone[r.zone] = r;

    if (r.zone === state.activeZone) {
      pushHist(state.hist.co,  r.co_ppm);
      pushHist(state.hist.vib, r.vib_rms);
      pushHist(state.hist.fan, r.fan_pct);
    }

    // feed: push only when alert_text appears, changes, or clears
    const prev = state.lastAlertText[r.zone];
    if (r.alert_text && r.alert_text !== prev) {
      state.lastAlertText[r.zone] = r.alert_text;
      pushFeedItem(fmtTime(), r.status.toLowerCase(), r.alert_text);
    } else if (!r.alert_text && prev) {
      state.lastAlertText[r.zone] = null;
      pushFeedItem(fmtTime(), "ok", `${ZONE_LABEL[r.zone] || r.zone}: conditions returned to normal.`);
    }

    // batch all 4 zone frames into one rAF render
    if (!state.rafPending) {
      state.rafPending = true;
      requestAnimationFrame(() => { state.rafPending = false; renderAll(); });
    }
  }

  // ------------------------------------------------------------------ backend API calls
  async function postScenario(name) {
    try { await fetch(`${API_URL}/scenario/${name}`, { method: "POST" }); }
    catch (e) { /* silently degrade when offline */ }
  }

  async function postFan(pct) {
    try {
      await fetch(`${API_URL}/fan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pct }),
      });
    } catch (e) { /* silently degrade */ }
  }

  async function postCopilot(question) {
    const resp = await fetch(`${API_URL}/copilot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (!resp.ok) throw new Error("copilot error");
    return (await resp.json()).answer;
  }

  // ------------------------------------------------------------------ fallback simulator
  const SIM_BASE = {
    "Zone A - Entry/Shaft":   { co: 3,  no2: 0.5, vib: 0.05, temp: 18, hum: 55, af: 2.1 },
    "Zone B - Active Stope":  { co: 8,  no2: 1.2, vib: 0.12, temp: 24, hum: 70, af: 1.8 },
    "Zone C - Equipment Bay": { co: 12, no2: 2.0, vib: 0.20, temp: 22, hum: 60, af: 2.5 },
    "Zone D - Refuge":        { co: 2,  no2: 0.3, vib: 0.03, temp: 19, hum: 50, af: 1.5 },
  };

  function initSimZones() {
    state.simZones = ZONES.map(name => {
      const b = SIM_BASE[name];
      return {
        zone: name,                                           // shared key with backend
        co_ppm: b.co, no2_ppm: b.no2, vib_rms: b.vib,
        temp_c: b.temp, humidity: b.hum, airflow: b.af,
        occupancy: 1, fan_pct: 30,
        tgt: { co: b.co, no2: b.no2, vib: b.vib, temp: b.temp, hum: b.hum, af: b.af, occ: 1 },
        status: "OK", reasons: [], alert_text: "",
        lastAlertAt: 0, wasAbnormal: false,
      };
    });
  }

  function simTick() {
    state.simT++;
    const T = state.simT;
    const sc = state.simScenario;

    state.simZones.forEach((z, i) => {
      const b = SIM_BASE[z.zone];

      // scenario targets
      if (sc === "gas_buildup") {
        if (i === 1 || i === 2) {
          z.tgt.co  = Math.min(b.co  + Math.min(T * 1.8, 72), 82);
          z.tgt.no2 = Math.min(b.no2 + Math.min(T * 0.07, 5), b.no2 + 5.5);
        }
      } else if (sc === "bearing_failure") {
        if (i === 2) {
          z.tgt.vib  = Math.min(b.vib  + T * 0.04, 1.4);
          z.tgt.temp = Math.min(b.temp + T * 0.12, b.temp + 10);
        }
      } else if (sc === "blast_clearance") {
        z.tgt.occ = 0;
        const peak = 20 * Math.exp(-((T - 8) ** 2) / 25);
        z.tgt.co  = Math.max(b.co,  b.co  + peak);
        z.tgt.no2 = Math.max(b.no2, b.no2 + peak * 0.3);
        z.fan_pct = 95;
      } else {                                               // normal / reset
        Object.assign(z.tgt, { co: b.co, no2: b.no2, vib: b.vib, temp: b.temp, hum: b.hum, af: b.af, occ: 1 });
      }

      const n = s => rnd(-s, s);
      z.co_ppm   = clamp(ease(z.co_ppm,   z.tgt.co)  + n(0.6),  0, 100);
      z.no2_ppm  = clamp(ease(z.no2_ppm,  z.tgt.no2) + n(0.1),  0, 20);
      z.vib_rms  = clamp(ease(z.vib_rms,  z.tgt.vib) + n(0.004),0, 2);
      z.temp_c   = ease(z.temp_c,          z.tgt.temp) + n(0.15);
      z.humidity = clamp(ease(z.humidity,  z.tgt.hum) + n(0.4),  20, 95);
      z.airflow  = clamp(ease(z.airflow,   z.tgt.af)  + n(0.01), 0, 5);
      z.occupancy = Math.round(ease(z.occupancy, z.tgt.occ, 0.25));

      simAssess(z);

      // VOD fan (unless scenario forced it)
      if (sc !== "blast_clearance") {
        z.fan_pct = clamp(Math.round(ease(z.fan_pct, simVOD(z), 0.18)), 0, 100);
      }

      // sim feed alerts (debounced)
      const prevStatus = z.status;
      const now = state.simT;
      const escalated = prevStatus !== z.status && z.status !== "OK";
      const stale = z.status !== "OK" && now - z.lastAlertAt > 12;
      const recovered = prevStatus !== "OK" && z.status === "OK" && z.wasAbnormal;
      if (escalated || (stale && z.status !== "OK")) {
        pushFeedItem(fmtTime(), z.status.toLowerCase(), simAlertText(z));
        z.lastAlertAt = now; z.wasAbnormal = true;
      } else if (recovered) {
        pushFeedItem(fmtTime(), "ok", `${ZONE_LABEL[z.zone] || z.zone}: conditions normalised.`);
        z.wasAbnormal = false; z.lastAlertAt = now;
      }
    });

    const az = state.simZones.find(z => z.zone === state.activeZone);
    if (az) {
      pushHist(state.hist.co,  az.co_ppm);
      pushHist(state.hist.vib, az.vib_rms);
      pushHist(state.hist.fan, az.fan_pct);
    }
    renderAll();
  }

  function simAssess(z) {
    const r = []; let st = "OK";
    const bump = (sev) => { if (sev === "ALERT" || (sev === "WATCH" && st === "OK")) st = sev; };
    if (z.co_ppm  >= TH.co.alert)       { r.push("CO ALERT");      bump("ALERT"); }
    else if (z.co_ppm  >= TH.co.watch)  { r.push("CO WATCH");      bump("WATCH"); }
    if (z.no2_ppm >= TH.no2.alert)      { r.push("NO2 ALERT");     bump("ALERT"); }
    else if (z.no2_ppm >= TH.no2.watch) { r.push("NO2 WATCH");     bump("WATCH"); }
    if (z.vib_rms >= TH.vib.alert)      { r.push("Vib ALERT");     bump("ALERT"); }
    else if (z.vib_rms >= TH.vib.watch) { r.push("Vib WATCH");     bump("WATCH"); }
    if (z.airflow < TH.airflow.alertLow) { r.push("Airflow ALERT"); bump("ALERT"); }
    else if (z.airflow < TH.airflow.watchLow) { r.push("Airflow WATCH"); bump("WATCH"); }
    z.status = st; z.reasons = r;
  }

  function simVOD(z) {
    let p = 25;
    p += Math.min(z.co_ppm  / 50 * 55, 55);
    p += Math.min(z.no2_ppm /  5 * 20, 20);
    if (!z.occupancy)        p = Math.max(p, 55);
    if (z.airflow < 1.2)     p += 20;
    if (z.status === "ALERT") p = Math.max(p, 85);
    else if (z.status === "WATCH") p = Math.max(p, 55);
    return clamp(p, 0, 100);
  }

  function simAlertText(z) {
    const lab = ZONE_LABEL[z.zone] || z.zone;
    if (z.co_ppm  >= TH.co.alert)  return `${lab}: CO at ${z.co_ppm.toFixed(0)} ppm — evacuate and activate emergency ventilation.`;
    if (z.co_ppm  >= TH.co.watch)  return `${lab}: CO rising to ${z.co_ppm.toFixed(0)} ppm — increase ventilation now.`;
    if (z.vib_rms >= TH.vib.alert) return `${lab}: abnormal vibration at ${z.vib_rms.toFixed(3)} RMS — inspect equipment.`;
    if (z.vib_rms >= TH.vib.watch) return `${lab}: elevated vibration at ${z.vib_rms.toFixed(3)} RMS — schedule inspection.`;
    if (z.no2_ppm >= TH.no2.alert) return `${lab}: NO2 at ${z.no2_ppm.toFixed(2)} ppm — increase ventilation.`;
    return `${lab}: anomalous conditions (${z.reasons[0] || "check sensors"}).`;
  }

  // ------------------------------------------------------------------ data helpers
  function getAllReadings() {
    if (state.mode === "live") {
      return ZONES.map(z => state.latestByZone[z] || blankReading(z));
    }
    return state.simZones;
  }
  function blankReading(zone) {
    return { zone, status: "OK", co_ppm: 0, no2_ppm: 0, vib_rms: 0, temp_c: 0, humidity: 0, airflow: 0, occupancy: 0, fan_pct: 0, reasons: [], alert_text: "" };
  }
  function getActiveReading() {
    return state.mode === "live"
      ? (state.latestByZone[state.activeZone] || blankReading(state.activeZone))
      : (state.simZones.find(z => z.zone === state.activeZone) || blankReading(state.activeZone));
  }
  function worstReading() {
    const rank = { OK: 0, ok: 0, WATCH: 1, watch: 1, ALERT: 2, alert: 2 };
    return getAllReadings().reduce((a, b) => (rank[b.status] || 0) > (rank[a.status] || 0) ? b : a);
  }

  // ------------------------------------------------------------------ rendering
  function renderAll() {
    renderZones();
    renderGauges();
    renderChart();
    renderBanner();
    renderVent();
    renderFeed();
    $("#simClock") && ($("#simClock").textContent = fmtTime());
  }

  // -- zones --
  function renderZones() {
    const el = $("#zones"); if (!el) return;
    el.innerHTML = getAllReadings().map(r => {
      const zoneName = r.zone;
      const status   = (r.status || "OK").toLowerCase();
      const isActive = zoneName === state.activeZone;
      const lab      = ZONE_LABEL[zoneName] || zoneName;
      const co  = +(r.co_ppm   ?? 0);
      const no2 = +(r.no2_ppm  ?? 0);
      const vib = +(r.vib_rms  ?? 0);
      const fan = +(r.fan_pct  ?? 0);
      const occ = +(r.occupancy ?? 0);
      return `<div class="zone-card status-${status}${isActive ? " is-active" : ""}" data-zone="${escHtml(zoneName)}">
        <div class="zone-top">
          <span class="zone-name">${escHtml(lab)}</span>
          <span class="zone-state">${status.toUpperCase()}</span>
          <span class="zone-dot"></span>
        </div>
        <div class="zone-metrics">
          <span>CO <b>${co.toFixed(0)}</b><small>ppm</small></span>
          <span>NO&#x2082; <b>${no2.toFixed(1)}</b><small>ppm</small></span>
          <span>Vib <b>${vib.toFixed(2)}</b></span>
          <span>Fan <b>${Math.round(fan)}%</b></span>
        </div>
        <div class="zone-occ">&#128100; ${occ} worker${occ !== 1 ? "s" : ""}</div>
      </div>`;
    }).join("");

    el.querySelectorAll(".zone-card[data-zone]").forEach(card =>
      card.addEventListener("click", () => {
        state.activeZone = card.dataset.zone;
        state.hist = { co: [], vib: [], fan: [] };
        updateZoneLabel();
        renderZones();
        renderGauges();
      })
    );
  }

  function updateZoneLabel() {
    const lab = ZONE_LABEL[state.activeZone] || state.activeZone;
    const el  = $("#activeZoneName");  if (el)  el.textContent = lab;
    const gh  = $("#gaugeZoneTitle");  if (gh)  gh.textContent = "Sensors: " + lab;
  }

  // -- gauges --
  const GA_START = -135, GA_SWEEP = 270;
  const GAUGES = [
    { k: "co_ppm",   label: "CO",        unit: "ppm", range: [0, 70],  th: TH.co,  fmt: v => v.toFixed(0)  },
    { k: "no2_ppm",  label: "NO₂",  unit: "ppm", range: [0, 10],  th: TH.no2, fmt: v => v.toFixed(2)  },
    { k: "vib_rms",  label: "Vibration", unit: "RMS", range: [0, 1.5], th: TH.vib, fmt: v => v.toFixed(3)  },
    { k: "temp_c",   label: "Temp",      unit: "°C", range: [15, 40], th: null, fmt: v => v.toFixed(0) },
    { k: "humidity", label: "Humidity",  unit: "%",   range: [0, 100], th: null, fmt: v => v.toFixed(0)     },
    { k: "fan_pct",  label: "Fan",       unit: "%",   range: [0, 100], th: null, accent: true, fmt: v => v.toFixed(0) },
  ];

  function polar(cx, cy, r, deg) { const a = (deg - 90) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
  function arc(cx, cy, r, s, e) {
    const [x1, y1] = polar(cx, cy, r, s), [x2, y2] = polar(cx, cy, r, e);
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${((e - s) % 360 > 180 ? 1 : 0)} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }
  function gaugeColor(g, val) {
    if (!g.th) return g.accent ? "var(--accent-2)" : "var(--accent)";
    if (val >= g.th.alert) return "var(--alert)";
    if (val >= g.th.watch) return "var(--watch)";
    return "var(--ok)";
  }

  function renderGauges() {
    const el = $("#gauges"); if (!el) return;
    if (!el.dataset.built) {
      el.innerHTML = GAUGES.map(g => `
        <div class="gauge" data-k="${g.k}">
          <svg viewBox="0 0 100 70">
            <path d="${arc(50,40,33,GA_START,GA_START+GA_SWEEP)}" fill="none" stroke="var(--line)" stroke-width="8" stroke-linecap="round"/>
            <path class="g-val" d="" fill="none" stroke="var(--accent)" stroke-width="8" stroke-linecap="round"/>
          </svg>
          <div class="gauge-val"><span class="g-num">-</span></div>
          <div class="gauge-label">${g.label}</div>
        </div>`).join("");
      el.dataset.built = "1";
    }
    const r = getActiveReading();
    GAUGES.forEach(g => {
      const val  = parseFloat(r[g.k] ?? 0);
      const [mn, mx] = g.range;
      const frac = clamp((val - mn) / (mx - mn), 0, 1);
      const node = el.querySelector(`.gauge[data-k="${g.k}"]`); if (!node) return;
      const path = node.querySelector(".g-val");
      path.setAttribute("d", frac > 0.001 ? arc(50,40,33,GA_START,GA_START+GA_SWEEP*frac) : "");
      path.setAttribute("stroke", gaugeColor(g, val));
      node.querySelector(".g-num").innerHTML = `${g.fmt(val)}<small> ${g.unit}</small>`;
    });
  }

  // -- chart --
  function renderChart() {
    const svg = $("#trendChart"); if (!svg) return;
    const W = 600, H = 220, pad = 8;
    const series = [
      { arr: state.hist.co,  min: 0, max: 70,  color: "#ff7a45", label: "CO ppm"    },
      { arr: state.hist.vib, min: 0, max: 1.5, color: "#8b6cff", label: "Vibration" },
      { arr: state.hist.fan, min: 0, max: 100, color: "#36d6e7", label: "Fan %"     },
    ];
    let grid = "";
    for (let i = 0; i <= 4; i++) { const y = pad + (H - 2*pad) * i/4; grid += `<line class="grid-line" x1="0" y1="${y}" x2="${W}" y2="${y}"/>`; }
    const lines = series.map(s => {
      const n = s.arr.length; if (!n) return "";
      const pts = s.arr.map((v, i) => {
        const x = n === 1 ? 0 : (i / (HIST_N - 1)) * W;
        const y = (H - pad) - clamp((v - s.min)/(s.max - s.min), 0, 1) * (H - 2*pad);
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

  // -- alert banner --
  function renderBanner() {
    const b = $("#alertBanner"); if (!b) return;
    const w = worstReading();
    const status = (w.status || "OK").toLowerCase();
    b.classList.remove("status-ok", "status-watch", "status-alert");
    b.classList.add("status-" + status);
    const abState = $("#abState");
    if (abState) abState.textContent = { ok: "ALL CLEAR", watch: "CAUTION", alert: "DANGER" }[status] || "ALL CLEAR";
    const abHead   = $("#abHeadline");
    const abAct    = $("#abAction");
    const abChip   = $("#abActionChip");
    const lab      = ZONE_LABEL[w.zone] || w.zone || "All zones";
    if (status === "ok") {
      if (abHead) abHead.textContent = "All monitored zones are within safe limits.";
      if (abAct)  abAct.hidden = true;
    } else {
      const text = w.alert_text || simAlertText(w);
      if (abHead) abHead.textContent = text;
      if (abAct)  { abAct.hidden = false; }
      if (abChip) abChip.textContent = status === "alert"
        ? "Evacuate if CO > 50 ppm · increase ventilation immediately"
        : "Monitor closely · consider increasing ventilation";
    }
  }

  // -- ventilation panel --
  function renderVent() {
    const r = getActiveReading();
    const fan = +(r.fan_pct ?? 0);
    const af  = +(r.airflow  ?? 0);
    if ($("#fanPct"))     $("#fanPct").textContent     = Math.round(fan);
    if ($("#ventAirflow")) $("#ventAirflow").textContent = af.toFixed(2) + " m/s";
    if ($("#ventLogic"))  $("#ventLogic").textContent  = state.fanMode === "manual" ? "manual override" : "VOD: auto";
    const blades = $("#fanBlades");
    if (blades) {
      if (fan < 2) { blades.style.animationPlayState = "paused"; }
      else { blades.style.animationPlayState = "running"; blades.style.animationDuration = (1.9 - fan/100*1.7).toFixed(2) + "s"; }
    }
    const slider = $("#fanSlider");
    if (slider && document.activeElement !== slider && state.fanMode === "auto") slider.value = Math.round(fan);
  }

  // -- alert feed --
  function pushFeedItem(t, sev, text) {
    state.feed.unshift({ t, sev, text });
    if (state.feed.length > 40) state.feed.pop();
    renderFeed();
  }
  function renderFeed() {
    const el = $("#feed"); if (!el) return;
    if (!state.feed.length) {
      el.innerHTML = `<li class="feed-empty">No alerts yet. Trigger a scenario to see the AI respond.</li>`;
      return;
    }
    el.innerHTML = state.feed.map(f =>
      `<li class="feed-item sev-${f.sev}"><span class="feed-time">${f.t}</span><span class="feed-text">${escHtml(f.text)}</span></li>`
    ).join("");
  }

  // ------------------------------------------------------------------ copilot
  function cpAdd(who, html) {
    const box = $("#cpMessages"); if (!box) return null;
    const el = document.createElement("div");
    el.className = "cp-msg " + (who === "user" ? "cp-user" : "cp-ai");
    el.innerHTML = who === "ai" ? `<div class="cp-who">OreAcle AI</div>${html}` : html;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
    return el;
  }

  async function cpAsk(q) {
    if (!q.trim()) return;
    cpAdd("user", escHtml(q));
    const thinking = cpAdd("ai", `<div class="cp-typing"><span></span><span></span><span></span></div>`);
    if (state.mode === "live") {
      try {
        const answer = await postCopilot(q);
        if (thinking) thinking.innerHTML = `<div class="cp-who">OreAcle AI</div>${escHtml(answer)}`;
      } catch (e) {
        if (thinking) thinking.innerHTML = `<div class="cp-who">OreAcle AI</div>${escHtml(cpFallback(q))}`;
      }
    } else {
      setTimeout(() => {
        if (thinking) thinking.innerHTML = `<div class="cp-who">OreAcle AI</div>${escHtml(cpFallback(q))}`;
      }, 650);
    }
    const box = $("#cpMessages"); if (box) box.scrollTop = box.scrollHeight;
  }

  function cpFallback(q) {
    q = q.toLowerCase();
    const all    = getAllReadings();
    const alerts = all.filter(r => (r.status || "OK").toUpperCase() !== "OK");
    const worst  = all.reduce((a, b) => {
      const rank = { OK:0, ok:0, WATCH:1, watch:1, ALERT:2, alert:2 };
      return (rank[b.status]||0) > (rank[a.status]||0) ? b : a;
    });
    const lab = z => ZONE_LABEL[z.zone] || z.zone;
    if (/(safe|danger|risk|hazard|status|alert|which zone)/.test(q)) {
      if (!alerts.length) return "All four zones are within safe limits right now.";
      return alerts.map(r => `${lab(r)} is ${r.status}: CO ${+(r.co_ppm??0).toFixed(0)} ppm, fan ${Math.round(r.fan_pct??0)}%.`).join(" ");
    }
    if (/(co|gas|carbon)/.test(q))
      return all.map(r => `${lab(r)}: ${(+(r.co_ppm??0)).toFixed(0)} ppm`).join(", ") + ". Alert threshold is 50 ppm.";
    if (/(no2|nitrogen)/.test(q))
      return all.map(r => `${lab(r)}: ${(+(r.no2_ppm??0)).toFixed(2)} ppm`).join(", ") + ". Alert threshold is 5 ppm.";
    if (/(fan|vent|airflow|vod)/.test(q)) {
      const r = getActiveReading();
      return `Active zone fan at ${Math.round(r.fan_pct??0)}%, airflow ${(+(r.airflow??0)).toFixed(2)} m/s. Ventilation runs demand-based (VOD).`;
    }
    if (/(vib|bearing|equip)/.test(q))
      return all.map(r => `${lab(r)}: ${(+(r.vib_rms??0)).toFixed(3)} RMS`).join(", ") + ". Alert threshold is 0.8 RMS.";
    if (/(temp|heat|humid)/.test(q)) {
      const hot = all.reduce((a, b) => (+(a.temp_c??0)) > (+(b.temp_c??0)) ? a : b);
      return `Highest temp: ${(+(hot.temp_c??0)).toFixed(1)}°C in ${lab(hot)}. Alert threshold is 35°C.`;
    }
    if (/(summary|report|overview|brief)/.test(q)) {
      const al = alerts.length ? `${alerts.length} zone(s) need attention: ${alerts.map(lab).join(", ")}.` : "No active alerts.";
      return `${all.length} zones monitored. ${al} Ventilation is demand-based.`;
    }
    return "Ask about CO levels, NO2, vibration, ventilation, temperature, or overall zone safety.";
  }

  // ------------------------------------------------------------------ controls
  function setScenario(name) {
    const canonical = name === "reset" ? "normal" : name;
    state.simScenario = canonical;
    state.simT = 0;
    $$(".sc-btn").forEach(b => b.classList.toggle("is-active", b.dataset.scenario === canonical));
    if (name === "reset") { state.feed = []; renderFeed(); }
    if (state.mode === "live") postScenario(name);
  }

  function wireControls() {
    $$(".sc-btn").forEach(b => b.addEventListener("click", () => setScenario(b.dataset.scenario)));

    $$("#ventMode .seg-btn").forEach(b => b.addEventListener("click", () => {
      $$("#ventMode .seg-btn").forEach(x => x.classList.remove("is-active"));
      b.classList.add("is-active");
      state.fanMode = b.dataset.mode;
      const slider = $("#fanSlider");
      if (slider) slider.disabled = state.fanMode !== "manual";
    }));

    const slider = $("#fanSlider");
    if (slider) slider.addEventListener("input", () => {
      if (state.fanMode !== "manual") return;
      const pct = +slider.value;
      if (state.mode === "live") postFan(pct);
      const z = state.simZones.find(z => z.zone === state.activeZone);
      if (z) z.fan_pct = pct;
      renderVent();
    });

    const ack = $("#abAck");
    if (ack) ack.addEventListener("click", () => {
      const b = $("#alertBanner");
      if (b) { b.style.opacity = ".5"; setTimeout(() => b.style.opacity = "", 400); }
    });

    const form = $("#cpForm");
    if (form) form.addEventListener("submit", e => {
      e.preventDefault();
      const i = $("#cpInput");
      cpAsk(i.value);
      i.value = "";
    });

    const sugg = [
      "Which zones are unsafe and why?",
      "What are the CO and NO2 levels?",
      "What should I do right now?",
      "How is the ventilation?",
    ];
    const sc = $("#cpSuggest");
    if (sc) {
      sc.innerHTML = sugg.map(s => `<button class="cp-chip" type="button">${s}</button>`).join("");
      $$(".cp-chip").forEach(c => c.addEventListener("click", () => cpAsk(c.textContent)));
    }
  }

  // ------------------------------------------------------------------ helpers
  function fmtTime() {
    return new Date().toLocaleTimeString("en-CA", { hour12: false });
  }
  function escHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function pushHist(arr, v) { arr.push(+v); if (arr.length > HIST_N) arr.shift(); }

  // ------------------------------------------------------------------ lifecycle
  function init() {
    if (state.inited) return;
    initSimZones();
    // pre-fill chart with baseline noise so it looks alive immediately
    const b0 = SIM_BASE[ZONES[0]];
    for (let i = 0; i < HIST_N; i++) {
      state.hist.co.push(rnd(b0.co * 0.85, b0.co * 1.15));
      state.hist.vib.push(rnd(b0.vib * 0.85, b0.vib * 1.15));
      state.hist.fan.push(30 + rnd(-3, 3));
    }
    wireControls();
    updateZoneLabel();
    cpAdd("ai", "Console online. Connecting to the backend… I'll watch all four zones once the WebSocket is up. Try triggering a scenario while we connect.");
    renderFeed();
    renderAll();
    state.inited = true;
  }

  function start() {
    init();
    if (state.running) return;
    state.running = true;
    connectWS();
    // sim loop always ticks; it's a no-op when mode === "live" (backend drives renders)
    state.timer = setInterval(() => {
      if (state.mode === "offline") simTick();
    }, 1000);
  }

  function stop() {
    state.running = false;
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    if (state.ws) { state.ws.close(); state.ws = null; }
    clearRetry();
  }

  window.MGConsole = { start, stop, init };
})();
