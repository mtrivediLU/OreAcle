/* ============================================================
   OreAcle: Pitch Deck controller  (#/deck view)
   14-slide zoom-scaled presentation with notes panel.
   Keys: ←/→ Arrow, PageUp/Down, Space, Home, End, N (notes)
   ============================================================ */
(function () {
  "use strict";

  const NOTES = [
    "Open with the promise: free, open-source AI that watches a mine, spots danger, explains it in plain English, and acts, all offline for $0. Cursor Hackathon Sudbury, Track 03. Solo build by Mihir Trivedi. The software is live right now at mtrivedilu.github.io/OreAcle.",
    "Two km down you can't smell CO until it's already too late. Vibration anomalies hide in noise. A supervisor watches dozens of gauges simultaneously. That cognitive load — pattern recognition under pressure — is exactly what AI should take over. This is the core problem.",
    "These companies already solved the hard part: getting sensors underground and keeping workers physically safe. Maestro, Sandvik, Vale IROC — they collect the data. OreAcle adds the AI interpretation layer on top, vendor-neutral and free.",
    "The gap isn't sensors — it's the brain behind the sensors. Numbers on a screen don't tell you what to do. And every existing solution is proprietary, subscription-based, or cloud-dependent. OreAcle is the first open-source, offline AI interpretation layer for mine sensor data.",
    "Sense → Think → Explain → Act. The Pico W reads the physical world. Isolation Forest detects when something is wrong. Llama 3.2 explains it in plain English. VOD logic automatically adjusts the fan. All local, all free, all connected by a single USB cable.",
    "One USB cable, zero cloud. The Pico W streams JSON at 2 Hz. FastAPI ingests and persists everything to SQLite. Isolation Forest and VOD run on the laptop. Ollama serves the LLM locally. The browser dashboard connects via WebSocket. Same JSON contract for both simulator and real hardware.",
    "Two AI techniques, $0 cost. Isolation Forest detects anomalous combinations — when no single sensor crossed a threshold but together they indicate a problem. Llama 3.2 3B via Ollama turns every anomaly into a human-readable alert with recommended action. Both run permanently offline.",
    "Everything in the demo is real and running right now. Open the Live Console, trigger Gas Buildup, and watch the Isolation Forest flag the anomaly, VOD ramp the fan, and the LLM generate a plain-English alert — all within 2 seconds, all local.",
    "Honest status: the AI pipeline is done and working end-to-end. The Pico W hardware integration is in progress — DHT11 temperature and humidity are wired, MPU6050 vibration is being calibrated. The gap between this POC and a production deployment is hardware, not software.",
    "OreAcle hits every Track 03 criterion: innovation (first open-source offline mine AI), industry relevance (designed around Vale/Glencore/Maestro Sudbury deployments), technical execution (full working stack), offline operation, $0 cost, and a direct plug-in path for Key Logic's sensor products.",
    "$0 recurring AI cost. No vendor lock-in. Open-source and auditable. Hardware-agnostic JSON interface that plugs onto any existing sensor network. The commercial model is: free software, premium support or deployment partnerships.",
    "Solo developer. Mihir Trivedi, student at Laurentian University, built the entire stack — backend, AI pipeline, firmware, and frontend — during the Cursor Hackathon Sudbury window. The academic context is MERC, the industry context is Vale/Glencore/Key Logic.",
    "Common questions: Why not GPT-4? Cloud AI is unavailable underground, sends sensitive data off-site, and costs thousands/month. How does the Pico W run AI? It doesn't — it only senses and acts; the laptop does all the thinking. What if Ollama is offline? Deterministic template fallback keeps everything running.",
    "Key terms for the judges: VOD = Ventilation-on-Demand (40-60% fan energy savings); Isolation Forest = scikit-learn anomaly detection without labelled failure examples; Ollama = local LLM runtime; Llama 3.2 3B = Meta's offline small model; Pico W = $10 edge microcontroller; IROC = Vale's remote ops centre in Sudbury."
  ];

  let cur     = 0;
  let total   = 0;
  let slides  = [];
  let booted  = false;

  /* -- fit / zoom ---------------------------------------------------------- */

  function fit() {
    const s = document.getElementById("stage");
    if (!s) return;
    s.style.zoom = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  }

  /* -- navigation ---------------------------------------------------------- */

  function go(n) {
    if (!booted || total === 0) return;
    n = Math.max(0, Math.min(total - 1, n));
    slides[cur].classList.remove("active");
    cur = n;
    slides[cur].classList.add("active");

    const curEl = document.getElementById("curNum");
    if (curEl) curEl.textContent = cur + 1;

    const bar = document.getElementById("progFill");
    if (bar) bar.style.width = ((cur + 1) / total * 100) + "%";

    const nb = document.getElementById("notesBody");
    if (nb) nb.textContent = NOTES[cur] || "";

    const prev = document.getElementById("deckPrev");
    const next = document.getElementById("deckNext");
    if (prev) prev.disabled = cur === 0;
    if (next) next.disabled = cur === total - 1;
  }

  function toggleNotes() {
    const panel = document.getElementById("notesPanel");
    if (panel) panel.classList.toggle("open");
  }

  /* -- keyboard ------------------------------------------------------------ */

  function onKey(e) {
    const v = document.getElementById("view-deck");
    if (!v || !v.classList.contains("view-active")) return;
    const tag = (document.activeElement || {}).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    switch (e.key) {
      case "ArrowRight": case "ArrowDown": case "PageDown":
        e.preventDefault(); go(cur + 1); break;
      case " ":
        e.preventDefault(); e.shiftKey ? go(cur - 1) : go(cur + 1); break;
      case "ArrowLeft": case "ArrowUp": case "PageUp":
        e.preventDefault(); go(cur - 1); break;
      case "Home": e.preventDefault(); go(0);         break;
      case "End":  e.preventDefault(); go(total - 1); break;
      case "n": case "N": e.preventDefault(); toggleNotes(); break;
    }
  }

  /* -- boot ---------------------------------------------------------------- */

  function boot() {
    if (booted) return;
    const stage = document.getElementById("stage");
    if (!stage) return;

    slides = Array.from(stage.querySelectorAll(".slide"));
    total  = slides.length;

    const prev = document.getElementById("deckPrev");
    const next = document.getElementById("deckNext");
    const notesBtn = document.getElementById("deckNotesBtn");
    if (prev) prev.addEventListener("click", () => go(cur - 1));
    if (next) next.addEventListener("click", () => go(cur + 1));
    if (notesBtn) notesBtn.addEventListener("click", toggleNotes);

    window.addEventListener("resize", fit);
    booted = true;
  }

  /* -- lifecycle (called by main.js router) -------------------------------- */

  window.MGDeck = {
    start() {
      boot();
      fit();
      go(0);
      document.addEventListener("keydown", onKey);
    },
    stop() {
      document.removeEventListener("keydown", onKey);
      // close notes panel when leaving deck
      const panel = document.getElementById("notesPanel");
      if (panel) panel.classList.remove("open");
    }
  };
})();
