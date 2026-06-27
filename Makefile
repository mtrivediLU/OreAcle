.PHONY: backend sim install web help

# ── install Python deps ────────────────────────────────────────────────────────
install:
	pip install -r backend/requirements.txt

# ── start the FastAPI backend (http://localhost:8000) ─────────────────────────
backend: install
	uvicorn backend.api:app --reload --host 0.0.0.0 --port 8000

# ── run the simulator standalone (prints JSON to stdout) ──────────────────────
# Usage:  make sim                   (normal)
#         make sim SCENARIO=gas_buildup
SCENARIO ?= normal
sim:
	python -m backend.simulator $(SCENARIO)

# ── serve the static front-end (http://localhost:8080) ────────────────────────
web:
	python3 -m http.server 8080

# ── help ──────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "  make backend            Install deps and start FastAPI on :8000"
	@echo "  make sim                Run simulator standalone (SCENARIO=gas_buildup etc.)"
	@echo "  make web                Serve static front-end on :8080"
	@echo "  make install            pip install backend/requirements.txt only"
	@echo ""
