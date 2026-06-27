/* ============================================================
   OreAcle: app controller
   View router (home / console / docs), theme, nav, scroll-spy, reveals.
   ============================================================ */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ---------- theme ---------- */
  function initTheme() {
    const saved = (() => { try { return localStorage.getItem("mg-theme"); } catch (e) { return null; } })();
    document.documentElement.setAttribute("data-theme", saved || "light");
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("mg-theme", next); } catch (e) {}
  }

  /* ---------- view router ---------- */
  const VIEWS = { home: "view-home", console: "view-console", docs: "view-docs", tracker: "view-tracker", deck: "view-deck" };
  let current = "home";

  function showView(name, sectionId) {
    if (!VIEWS[name]) name = "home";
    current = name;
    Object.entries(VIEWS).forEach(([k, id]) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle("view-active", k === name);
    });
    // lifecycle hooks
    if (window.MGConsole) { name === "console" ? window.MGConsole.start() : window.MGConsole.stop(); }
    if (name === "docs" && window.MGDocs) window.MGDocs.render();
    if (window.MGDeck) { name === "deck" ? window.MGDeck.start() : window.MGDeck.stop(); }
    // full-immersion deck mode: hide navbar while presenting
    document.documentElement.classList.toggle("deck-mode", name === "deck");

    // nav highlight for top-level views
    $$(".nav-link[data-view]").forEach(a => a.classList.toggle("active", a.getAttribute("data-view") === name && name !== "home"));

    closeMenu();
    if (sectionId) {
      // wait a frame so the view is visible before measuring
      requestAnimationFrame(() => {
        const t = document.getElementById(sectionId);
        if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 80, behavior: "smooth" });
        else window.scrollTo(0, 0);
      });
    } else {
      window.scrollTo(0, 0);
    }
    refreshReveals();
  }

  function route() {
    const raw = (location.hash || "").replace(/^#/, "");
    if (raw === "/console") return showView("console");
    if (raw === "/docs") return showView("docs");
    if (raw === "/tracker") return showView("tracker");
    if (raw === "/deck") return showView("deck");
    if (raw && raw !== "/home" && document.getElementById(raw)) return showView("home", raw);
    return showView("home");
  }

  /* ---------- nav interactions (delegated) ---------- */
  function handleNavClick(e) {
    const view = e.target.closest("[data-view]");
    const scroll = e.target.closest("[data-scroll]");
    if (view) {
      e.preventDefault();
      const name = view.getAttribute("data-view");
      // setting the hash triggers route(); use canonical forms
      location.hash = name === "home" ? "/home" : "/" + name;
    } else if (scroll) {
      e.preventDefault();
      const id = scroll.getAttribute("href").replace(/^#/, "");
      if (current !== "home") { location.hash = id; }      // route() will switch home + scroll
      else {
        const t = document.getElementById(id);
        if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 80, behavior: "smooth" });
        history.replaceState(null, "", "#" + id);
        closeMenu();
      }
    }
  }

  /* ---------- mobile menu ---------- */
  function toggleMenu() {
    const links = $("#navLinks"), btn = $("#hamburger");
    const open = links.classList.toggle("open");
    btn.classList.toggle("open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  }
  function closeMenu() {
    const links = $("#navLinks"), btn = $("#hamburger");
    if (links) links.classList.remove("open");
    if (btn) { btn.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); }
  }

  /* ---------- home scroll-spy ---------- */
  function initScrollSpy() {
    const ids = ["overview", "architecture", "hardware", "ai-stack", "industry"];
    const map = {};
    ids.forEach(id => { const a = $(`.nav-link[href="#${id}"]`); if (a) map[id] = a; });
    const obs = new IntersectionObserver((entries) => {
      if (current !== "home") return;
      entries.forEach(en => {
        if (en.isIntersecting) {
          Object.values(map).forEach(a => a.classList.remove("active"));
          if (map[en.target.id]) map[en.target.id].classList.add("active");
        }
      });
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });
    ids.forEach(id => { const s = document.getElementById(id); if (s) obs.observe(s); });
  }

  /* ---------- reveal on scroll ---------- */
  let revealObs;
  function initReveal() {
    revealObs = new IntersectionObserver((entries) => {
      entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add("in"); revealObs.unobserve(en.target); } });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    refreshReveals();
  }
  function refreshReveals() {
    if (!revealObs) return;
    $$(".reveal:not(.in)").forEach(el => {
      // reveal immediately if already in viewport (e.g., hero), else observe
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) el.classList.add("in");
      else revealObs.observe(el);
    });
  }

  /* ---------- misc ---------- */
  function initChrome() {
    const nav = $("#navbar");
    const toTop = $("#toTop");
    const onScroll = () => {
      if (nav) nav.classList.toggle("scrolled", window.scrollY > 8);
      if (toTop) toTop.classList.toggle("show", current === "docs" && window.scrollY > 500);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    if (toTop) toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    const y = $("#year"); if (y) y.textContent = new Date().getFullYear();
  }

  /* ---------- boot ---------- */
  function boot() {
    initTheme();
    document.addEventListener("click", handleNavClick);
    const tt = $("#themeToggle"); if (tt) tt.addEventListener("click", toggleTheme);
    const hb = $("#hamburger"); if (hb) hb.addEventListener("click", toggleMenu);
    window.addEventListener("hashchange", route);
    initReveal();
    initScrollSpy();
    initChrome();
    route();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
