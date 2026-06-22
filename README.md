# MineGuardian — Project Site & Live Mock Console

A production-style, single-page website for **MineGuardian**, an open-source AI safety & ventilation co-pilot for underground mines (Cursor Hackathon Sudbury · "Build the North" · Track 03).

It does three jobs in one app:

1. **Showcase** — a polished landing experience explaining the project, the problem, the real-world industry context (Vale, Glencore, Maestro, Newtrax), a custom **architecture diagram**, the **hardware** used, and the **open-source AI** stack.
2. **Live Console** — a fully interactive **mock operator dashboard** running on a built-in simulator (no hardware needed). Trigger scenarios and watch anomaly detection, AI alerts, the copilot, and the ventilation fan respond in real time. This is the "feel" of the production app before any hardware arrives.
3. **Documentation** — the **entire master project plan** rendered inside the app with an auto-generated table of contents.

> Everything is plain **HTML + CSS + vanilla JS** — no build step, no framework, no backend. It runs as static files and is ready for **GitHub Pages**.

---

## Quick start

**Option A — open directly:** double-click `index.html`. Works offline; the only things that need internet are the web-fonts and the markdown renderer (used by the Docs tab). If offline, the Docs tab gracefully falls back to plain text and the rest of the site is unaffected.

**Option B — run a tiny local server (best fidelity):**

```bash
cd mineguardian-website
python3 -m http.server 8080
# open http://localhost:8080
```

---

## Publish on GitHub Pages

1. Create a new GitHub repo (e.g. `mineguardian`) and push the contents of this `mineguardian-website/` folder to the repo root.
   ```bash
   cd mineguardian-website
   git init && git add . && git commit -m "MineGuardian site"
   git branch -M main
   git remote add origin https://github.com/<you>/mineguardian.git
   git push -u origin main
   ```
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, pick **main / (root)**, Save.
3. Wait ~1 minute; your site is live at `https://<you>.github.io/mineguardian/`.
4. Edit the **GitHub** button link in `index.html` (`id="githubLink"`) to point at your repo.

The included `.nojekyll` file tells GitHub Pages to serve everything as-is.

---

## File structure

```
mineguardian-website/
├── index.html                 # all 3 views (Home / Live Console / Docs)
├── css/
│   └── styles.css             # full design system (dark + light themes)
├── js/
│   ├── plan-content.js        # the master plan embedded as a JS string (AUTO-GENERATED)
│   ├── dashboard.js           # the mock console simulation + UI
│   ├── docs.js                # renders the plan + builds the TOC
│   └── main.js                # router, theme toggle, nav, scroll-spy, animations
├── MineGuardian_Master_Project_Plan.md   # the source document (also viewable on GitHub)
├── .nojekyll
└── README.md                  # this file
```

---

## How the Live Console works (and what's real vs. simulated)

The console is driven entirely by `js/dashboard.js`. **All data is simulated** so you can demo the UX without hardware:

- A 1-second tick loop evolves four zones of sensor values with realistic noise.
- The **scenario buttons** (Gas build-up, Bearing failure, Blast clearance) script those values so you can show a clean before/after story.
- **Anomaly detection** is mimicked with thresholds + status logic (the same OK / WATCH / ALERT model the real app uses).
- **AI alerts and the copilot** are template-generated to read like the local LLM's output.
- The **Ventilation-on-Demand** logic and the animated fan mirror the real control loop.

Everything is clearly labelled **SAMPLE DATA · SIMULATION** and **SIM** badges mark values that are software-generated in the proof-of-concept.

---

## Roadmap — swapping the mock for the real system

When the hardware + AI are ready (see the full plan), you replace the simulation with live data **without changing the UI**:

| Mock piece (now) | Production piece (later) |
| --- | --- |
| `dashboard.js` tick loop generating values | **WebSocket** feed from the FastAPI backend (`/ws`) carrying real Pico W readings |
| Threshold status logic | **scikit-learn Isolation Forest** + rules in `backend/anomaly.py` |
| Templated alert text | **Ollama / Llama 3.2 3B** local LLM (`backend/llm.py`) |
| `copilotAnswer()` keyword matching | `POST /copilot` to the local LLM over your real sensor history |
| Fan animation only | `POST /fan` → Pico W spins the real motor |

The cleanest path: keep this UI, point the data layer at `ws://localhost:8000/ws`, and delete the simulator. The component layout, theming, and interactions all stay.

---

## Updating the embedded document

The Docs tab reads `js/plan-content.js`, which is generated from `MineGuardian_Master_Project_Plan.md`. To refresh it after editing the plan:

```bash
python3 - "MineGuardian_Master_Project_Plan.md" "js/plan-content.js" <<'PY'
import json,sys
src,dst=sys.argv[1],sys.argv[2]
md=open(src,encoding="utf-8").read()
open(dst,"w",encoding="utf-8").write("window.PROJECT_DOC = "+json.dumps(md)+";\n")
PY
```

---

## Customisation

- **Colors / theme:** edit the CSS variables at the top of `css/styles.css` (`--accent`, `--accent-2`, status colors). A light theme is included via the toggle in the navbar.
- **Fonts:** Space Grotesk (display), Inter (body), JetBrains Mono (data) — swap in the `<link>` in `index.html`.
- **Rename the product:** search/replace `MineGuardian` across `index.html`.
- **Content:** the Home sections (Overview, Architecture, Hardware, AI Stack) are plain HTML in `index.html` — edit freely.

---

## Credits

Designed and built by **Mihir Trivedi** for the Cursor Hackathon Sudbury, June 27 2026.
Open-source, $0 AI cost, built to run on hardware mines already own.
