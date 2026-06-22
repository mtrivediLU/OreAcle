/* ============================================================
   MineGuardian — Docs renderer
   Renders the embedded master project plan (window.PROJECT_DOC) into the app,
   builds a Table of Contents, and wires up scroll-spy. Single source of truth:
   js/plan-content.js is auto-generated from the .md file.
   ============================================================ */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  let rendered = false;

  function slugify(t) {
    return t.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "section";
  }

  function render() {
    if (rendered) return;
    const host = $("#docContent");
    const md = window.PROJECT_DOC;
    if (!host) return;
    if (!md) { host.innerHTML = '<p class="docs-loading">Could not load the project document (js/plan-content.js missing).</p>'; return; }

    // 1) markdown -> html (marked from CDN; graceful fallback)
    let html;
    try {
      if (window.marked) html = (window.marked.parse ? window.marked.parse(md) : window.marked(md));
      else throw new Error("no marked");
    } catch (e) {
      host.innerHTML = '<pre style="white-space:pre-wrap">' +
        md.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])) + "</pre>";
      rendered = true; return;
    }
    host.innerHTML = html;

    // 2) replace the mermaid code block with a friendly pointer to the visual diagram
    $$("#docContent code").forEach(code => {
      if ((code.className || "").includes("language-mermaid")) {
        const note = document.createElement("div");
        note.className = "docs-mermaid-note";
        note.innerHTML = '📐 <b>Architecture diagram</b> — view the interactive, on-brand version in the ' +
          '<a href="#architecture" data-scroll>Architecture section</a>. (Raw Mermaid source hidden for readability.)';
        const pre = code.closest("pre") || code;
        pre.replaceWith(note);
      }
    });

    // 3) ids on headings + TOC (h2, with h3 nested)
    const toc = $("#tocNav");
    const used = {};
    const items = [];
    $$("#docContent h2, #docContent h3").forEach(h => {
      let id = slugify(h.textContent);
      if (used[id] != null) { used[id]++; id = id + "-" + used[id]; } else used[id] = 0;
      h.id = id;
      items.push({ id, text: h.textContent.replace(/^\d+\.\s*/, ""), level: h.tagName === "H3" ? 3 : 2 });
    });
    if (toc) {
      toc.innerHTML = items.map(i =>
        `<a href="#${i.id}" class="${i.level === 3 ? "toc-h3" : ""}" data-doc-link>${i.text}</a>`).join("");
      $$("#tocNav a").forEach(a => a.addEventListener("click", e => {
        e.preventDefault();
        const t = document.getElementById(a.getAttribute("href").slice(1));
        if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 84, behavior: "smooth" });
      }));
    }

    // 4) scroll-spy
    const links = {};
    $$("#tocNav a").forEach(a => links[a.getAttribute("href").slice(1)] = a);
    const heads = items.map(i => document.getElementById(i.id));
    const spy = () => {
      let cur = heads[0];
      for (const h of heads) { if (h && h.getBoundingClientRect().top - 100 <= 0) cur = h; }
      $$("#tocNav a").forEach(a => a.classList.remove("active"));
      if (cur && links[cur.id]) {
        links[cur.id].classList.add("active");
        links[cur.id].scrollIntoView({ block: "nearest" });
      }
    };
    window.addEventListener("scroll", () => { if (isDocsActive()) requestAnimationFrame(spy); }, { passive: true });

    rendered = true;
  }
  function isDocsActive() { const v = $("#view-docs"); return v && v.classList.contains("view-active"); }

  window.MGDocs = { render };
})();
