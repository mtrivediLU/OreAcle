/* ============================================================
   OreAcle: Pitch Deck controller
   Keyboard-navigable 14-slide presentation for #view-deck.
   Keys: ←/→ Arrow, PageUp/Down, Space, Home, End
   ============================================================ */
(function () {
  "use strict";

  let cur = 0;
  let slides = [];
  let total = 0;
  let booted = false;

  function boot() {
    if (booted) return;
    const stageEl = document.getElementById("deckSlides");
    if (!stageEl) return;
    slides = Array.from(stageEl.querySelectorAll(".ds-slide"));
    total = slides.length;
    const totalEl = document.getElementById("deckTotal");
    if (totalEl) totalEl.textContent = total;
    const prev = document.getElementById("deckPrev");
    const next = document.getElementById("deckNext");
    if (prev) prev.addEventListener("click", () => go(cur - 1));
    if (next) next.addEventListener("click", () => go(cur + 1));
    booted = true;
  }

  function go(n) {
    if (!booted) boot();
    if (total === 0) return;
    n = Math.max(0, Math.min(total - 1, n));
    if (slides[cur]) slides[cur].classList.remove("ds-active");
    cur = n;
    const slide = slides[cur];
    if (slide) {
      slide.classList.add("ds-active");
      slide.scrollTop = 0;
      // Staggered entrance animation: remove, reflow, then add
      slide.querySelectorAll(".ds-anim").forEach((el, i) => {
        el.classList.remove("ds-in");
        el.style.transitionDelay = "0s";
        requestAnimationFrame(() => requestAnimationFrame(() => {
          el.style.transitionDelay = `${i * 0.07}s`;
          el.classList.add("ds-in");
        }));
      });
    }
    const curEl = document.getElementById("deckCurrent");
    const bar   = document.getElementById("deckBar");
    const prev  = document.getElementById("deckPrev");
    const next  = document.getElementById("deckNext");
    if (curEl) curEl.textContent = cur + 1;
    if (bar)   bar.style.transform = `scaleX(${(cur + 1) / total})`;
    if (prev)  prev.disabled = cur === 0;
    if (next)  next.disabled = cur === total - 1;
  }

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
    }
  }

  window.MGDeck = {
    start() { boot(); go(0); document.addEventListener("keydown", onKey); },
    stop()  { document.removeEventListener("keydown", onKey); }
  };
})();
