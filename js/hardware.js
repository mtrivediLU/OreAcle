/* ============================================================
   OreAcle: Hardware POC controller  (#/hardware view)
   Manages the Web Serial connection to the Raspberry Pi Pico W
   running hardware/firmware/main_potentiometer.py.
   Follows the same MGxxx / start() + stop() lifecycle as MGConsole.
   ============================================================ */
(function () {
  "use strict";

  const $ = id => document.getElementById(id);

  let booted       = false;
  let keepReading  = false;
  let port         = null;

  /* -- helpers ------------------------------------------------------------ */

  function setConn(on, text) {
    const dot  = $("hwConnDot");
    const msg  = $("hwConnText");
    const btn  = $("hwConnectBtn");
    if (dot) dot.classList.toggle("hw-dot-on", on);
    if (msg) msg.textContent = text;
    if (btn) btn.disabled = on;
  }

  function colorFor(status) {
    const s = (status || "").toUpperCase();
    const styles = getComputedStyle(document.documentElement);
    if (s === "OK")    return styles.getPropertyValue("--ok").trim();
    if (s === "WATCH") return styles.getPropertyValue("--watch").trim();
    return styles.getPropertyValue("--alert").trim();
  }

  function render(d) {
    const airflow = Number(d.airflow);
    const fanPct  = Number(d.fan_pct);
    const status  = d.status || "--";
    const col     = colorFor(status);

    /* airflow */
    const afEl = $("hwAirflow");
    if (afEl) afEl.textContent = airflow.toFixed(2);

    const bar = $("hwAirflowBar");
    if (bar) {
      bar.style.width      = Math.max(0, Math.min(100, (airflow / 5) * 100)) + "%";
      bar.style.background = col;
    }

    /* status light + label */
    const light = $("hwLight");
    if (light) {
      light.style.background = col;
      light.style.boxShadow  = `0 0 18px 4px ${col}55`;
    }
    const stEl = $("hwStatus");
    if (stEl) { stEl.textContent = status; stEl.style.color = col; }

    /* fan */
    const fanEl = $("hwFanPct");
    if (fanEl) fanEl.textContent = fanPct + "%";

    const fanSvg = $("hwFan");
    if (fanSvg) {
      /* 30 % → ~2.2 s/rev  |  100 % → ~0.25 s/rev */
      const dur = Math.max(0.25, 2.2 - (fanPct / 100) * 1.95);
      fanSvg.style.animationDuration = dur.toFixed(2) + "s";
    }

    /* detail table */
    if ($("hwZone"))    $("hwZone").textContent    = d.zone   || "--";
    if ($("hwSource"))  $("hwSource").textContent  = d.source || "--";
    if ($("hwTemp"))    $("hwTemp").textContent    = d.temp_c != null ? d.temp_c + " °C" : "--";
    if ($("hwRawAdc"))  $("hwRawAdc").textContent  = d.raw_adc != null ? d.raw_adc : "--";

    const badge = $("hwSrcBadge");
    if (badge && d.source === "pico_w") badge.style.display = "inline-flex";

    /* reading counter */
    const cnt = $("hwCount");
    if (cnt) cnt.textContent = (parseInt(cnt.textContent, 10) || 0) + 1;
  }

  /* -- Web Serial connection ----------------------------------------------- */

  async function connect() {
    if (!("serial" in navigator)) {
      const hint = $("hwHint");
      if (hint) hint.innerHTML =
        '<span style="color:var(--alert)">Web Serial is not supported in this browser. ' +
        "Use Chrome or Edge opened over <b>http://localhost</b>.</span>";
      return;
    }

    try {
      port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      setConn(true, "Connected — Pico W live");
      keepReading = true;

      const decoder = new TextDecoderStream();
      port.readable.pipeTo(decoder.writable);
      const reader = decoder.readable.getReader();
      let buffer = "";

      while (keepReading) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer     = buffer.slice(nl + 1);
          if (line.startsWith("{")) {
            try {
              render(JSON.parse(line));
            } catch (_) { /* ignore garbled JSON */ }
          }
        }
      }
    } catch (err) {
      setConn(false, "Connection failed — " + err.message);
      const hint = $("hwHint");
      if (hint) hint.innerHTML =
        `<span style="color:var(--alert)">${err.message}</span><br>` +
        "Make sure Thonny is closed and the Pico is plugged in, then try again.";
    }
  }

  /* -- lifecycle (called by main.js router) -------------------------------- */

  function boot() {
    if (booted) return;
    const btn = $("hwConnectBtn");
    if (btn) btn.addEventListener("click", connect);
    booted = true;
  }

  window.MGHardware = {
    start() { boot(); },
    stop()  { /* connection stays open if user navigates away */ }
  };
})();
