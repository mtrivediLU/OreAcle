# OreAcle / MineGuardian Build Progress Log — ChatGPT Session

**Created with:** ChatGPT  
**Project:** OreAcle / MineGuardian Hackathon Demo  
**Repo location used:** `~/Documents/GitHub/OreAcle`  
**Current approach:** Single existing OreAcle project, main branch, simulator-first demo.

---

## 1. Decision Made

We decided to keep everything inside the existing **OreAcle** project instead of creating a separate `mineguardian` repo.

Reason:
- The existing repo already has the web app.
- Only one developer is working on it.
- The hackathon/demo timeline is short.
- Fast implementation is more important than perfect branching structure.

We also decided:
- Use **Claude Code** for repo-wide code edits.
- Use **Grok Build** mainly for terminal/install troubleshooting.
- Use the **backend simulator first**, then connect hardware later if time allows.

---

## 2. Environment Setup Completed

### Verified / installed tools

The initial checks showed:

| Tool | Status |
|---|---|
| Homebrew | Installed |
| Node.js | Installed |
| npm | Installed |
| Git | Installed |
| Python system version | 3.9.6 |
| Python 3.11 | Installed later |
| Apify CLI | Not installed, intentionally skipped for now |

### Python 3.11 setup

Python 3.11 was installed using Homebrew:

```bash
brew install python@3.11
```

Because the Mac is Intel-based, the correct Homebrew path was:

```bash
/usr/local/opt/python@3.11/bin/python3.11
```

Verified result:

```bash
Python 3.11.15
```

A wrong Apple Silicon path was removed from `~/.zprofile`, and the Intel Homebrew Python path was added.

---

## 3. Backup and Repo Setup

A quick full-folder backup was created outside the repo:

```bash
cd ~/Documents/GitHub/OreAcle
cp -R . ../OreAcle_backup_$(date +%Y%m%d_%H%M%S)
```

Confirmed branch:

```bash
main
```

Confirmed Git status before backend work:

```bash
nothing to commit, working tree clean
```

Backend-related folders/files were added directly in the existing repo:

```bash
mkdir -p backend firmware data docs

touch backend/requirements.txt
touch backend/api.py backend/db.py backend/simulator.py backend/anomaly.py backend/vod.py backend/llm.py backend/ingest.py
touch firmware/main.py
touch Makefile
```

---

## 4. Backend Simulator Added

Claude Code created the backend simulator and API.

### Files created / updated

| File | Purpose |
|---|---|
| `backend/__init__.py` | Makes backend a Python package |
| `backend/requirements.txt` | Python backend dependencies |
| `backend/db.py` | SQLite database initialization, insert, recent query |
| `backend/simulator.py` | Four-zone mine sensor simulator |
| `backend/anomaly.py` | IsolationForest + rule-based safety detection |
| `backend/vod.py` | Ventilation-on-Demand fan percentage logic |
| `backend/llm.py` | Ollama LLM integration with deterministic fallback |
| `backend/ingest.py` | Pipeline: annotate → VOD → alert → persist |
| `backend/api.py` | FastAPI API and WebSocket server |
| `Makefile` | Convenience commands for backend/sim/web |

### Backend dependencies installed

A virtual environment was created:

```bash
python3.11 -m venv .venv
source .venv/bin/activate
```

Dependencies were installed:

```bash
pip install --upgrade pip
pip install -r backend/requirements.txt
```

Important installed packages included:

- FastAPI
- Uvicorn
- WebSockets
- pandas
- numpy
- scikit-learn
- pyserial
- ollama
- httpx

---

## 5. Backend API Implemented

Backend runs at:

```text
http://localhost:8000
```

### Implemented endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | Backend health check |
| `WS /ws` | Streams live readings every 0.5 seconds |
| `POST /scenario/{name}` | Changes demo scenario |
| `POST /fan` | Sets manual fan percentage |
| `POST /copilot` | Sends question to copilot / fallback answer |

### Scenarios implemented

| Scenario | Purpose |
|---|---|
| `normal` | All zones normal |
| `gas_buildup` | CO rises in active zones |
| `bearing_failure` | Vibration rises in equipment bay |
| `blast_clearance` | Post-blast ventilation scenario |
| `reset` | Returns to normal |

### Streamed reading fields

Each WebSocket reading includes:

```text
ts
zone
vib_rms
temp_c
humidity
occupancy
distance_cm
co_ppm
no2_ppm
airflow
fan_pct
status
reasons
alert_text
```

---

## 6. Backend Tests Completed

### Health check

Browser opened:

```text
http://localhost:8000/health
```

Expected/confirmed response:

```json
{"status":"ok","scenario":"normal","clients":0}
```

Opening `http://localhost:8000` showed:

```json
{"detail":"Not Found"}
```

This was identified as harmless because `/` is not implemented. The correct test URL is `/health`.

### Scenario test

Command used:

```bash
curl -X POST http://localhost:8000/scenario/gas_buildup
```

Confirmed response:

```json
{"scenario":"gas_buildup"}
```

### WebSocket test

Claude verified that `/ws` sends frames for all four zones:

```text
Zone A - Entry/Shaft
Zone B - Active Stope
Zone C - Equipment Bay
Zone D - Refuge
```

Field check confirmed all expected frontend fields are present.

### Normal scenario behavior

Confirmed:

```text
All 4 zones stream as OK
```

### Gas buildup behavior

Confirmed:

```text
Zone B and Zone C escalate to WATCH / ALERT as CO climbs.
Alert text appears.
Fan percentage increases.
```

### Database write check

SQLite database confirmed at:

```text
data/oreacle.db
```

---

## 7. Backend Restart Commands

If backend is stopped, restart with:

```bash
cd ~/Documents/GitHub/OreAcle
source .venv/bin/activate
python3.11 -m uvicorn backend.api:app --reload --host 127.0.0.1 --port 8000
```

If port 8000 is stuck:

```bash
pkill -f uvicorn
```

Then restart backend.

---

## 8. Frontend Server Started

The existing static frontend was served with:

```bash
cd ~/Documents/GitHub/OreAcle
python3 -m http.server 8080
```

Frontend URL:

```text
http://localhost:8080
```

Backend URL:

```text
http://localhost:8000/health
```

Current clean testing setup:

| Terminal | Command |
|---|---|
| Terminal 1 | Backend on port 8000 |
| Terminal 2 | Frontend static server on port 8080 |
| Browser | `http://localhost:8080` |

---

## 9. Frontend Integration Added

Claude Code connected the existing static OreAcle frontend to the backend.

### Files edited

| File | Change |
|---|---|
| `js/dashboard.js` | Full rewrite for backend WebSocket integration |
| `index.html` | Surgical edits for connection badge, scenario controls, dynamic labels |
| `css/styles.css` | Added connection status and occupancy styling |

### Frontend features added

- Connects to:

```text
ws://localhost:8000/ws
```

- Retries connection every 3 seconds.
- Shows backend connection status:
  - Connected
  - Backend offline
- Maintains latest reading per zone.
- Shows four zone cards:
  - Zone A - Entry/Shaft
  - Zone B - Active Stope
  - Zone C - Equipment Bay
  - Zone D - Refuge
- Shows live values:
  - status
  - CO ppm
  - NO2 ppm
  - vibration RMS
  - temperature
  - humidity
  - airflow
  - occupancy
  - fan percentage
- Adds alert feed for WATCH / ALERT.
- Adds scenario buttons:
  - Normal
  - Gas Buildup
  - Bearing Failure
  - Blast Clearance
  - Reset
- Adds fan slider that posts to:

```text
POST http://localhost:8000/fan
```

- Adds copilot question box that posts to:

```text
POST http://localhost:8000/copilot
```

- Adds built-in frontend simulation fallback if backend disconnects.

---

## 10. Claude Code Verified Frontend Integration

Claude verified:

```text
Normal scenario: all 4 zones stream as OK
gas_buildup: Zone B and C escalate to WATCH / ALERT with alert text as CO climbs
Ollama absent: fallback templates kick in silently
DB writes confirmed at data/oreacle.db
WebSocket receives all 4 zones
All frontend-required fields are present
```

---

## 11. Clean Restart Procedure

To restart everything from scratch:

### Step 1 — Kill old processes

```bash
pkill -f uvicorn
pkill -f "http.server"
```

Optional port check:

```bash
lsof -i :8000
lsof -i :8080
```

### Step 2 — Start backend

```bash
cd ~/Documents/GitHub/OreAcle
source .venv/bin/activate
python3.11 -m uvicorn backend.api:app --reload --host 127.0.0.1 --port 8000
```

Test:

```text
http://localhost:8000/health
```

Expected:

```json
{"status":"ok","scenario":"normal","clients":0}
```

### Step 3 — Start frontend

Open a second terminal:

```bash
cd ~/Documents/GitHub/OreAcle
python3 -m http.server 8080
```

Open:

```text
http://localhost:8080
```

Hard refresh:

```text
Cmd + Shift + R
```

---

## 12. Current Browser State Observed

Frontend successfully loaded at:

```text
http://localhost:8080
```

Backend health successfully loaded at:

```text
http://localhost:8000/health
```

Browser showed:

```json
{"status":"ok","scenario":"normal","clients":0}
```

A manual scenario trigger was run:

```bash
curl -X POST http://localhost:8000/scenario/gas_buildup
```

Response:

```json
{"scenario":"gas_buildup"}
```

---

## 13. What To Do Next

### Immediate next testing steps

1. Open:

```text
http://localhost:8080
```

2. Click the navigation item:

```text
Live Console
```

3. Confirm the dashboard shows:

```text
Connected
```

4. Click:

```text
Gas Buildup
```

5. Wait 10–15 seconds.

6. Confirm:
   - Zone B / Zone C change from OK to WATCH or ALERT.
   - CO rises.
   - Fan percentage increases.
   - Alert feed shows warning text.
   - Copilot can answer: “Which zones are unsafe and why?”

7. Click:

```text
Reset
```

---

## 14. Important Notes

- `http://localhost:8000` showing `Not Found` is normal.
- Use `http://localhost:8000/health` to check backend.
- Use `http://localhost:8080` to view the frontend.
- `favicon.ico 404` is harmless.
- The WebSocket client count may remain `0` until the Live Console tab/page actually connects.
- Hardware is not required yet.
- The current software demo is presentable even without Pico hardware.

---

## 15. Current Demo Story

The demo now supports this story:

1. OreAcle watches four simulated underground mine zones.
2. Backend streams live readings over WebSocket.
3. Frontend dashboard updates in real time.
4. Gas buildup scenario raises CO in active zones.
5. Safety rules / anomaly logic move zones to WATCH or ALERT.
6. Ventilation-on-Demand increases fan percentage.
7. Alert feed explains what is happening.
8. Copilot answers operational questions.
9. Everything runs locally on the MacBook with no cloud dependency.
