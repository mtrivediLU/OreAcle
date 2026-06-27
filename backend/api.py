"""
OreAcle FastAPI backend.
Endpoints:
  GET  /health
  WS   /ws          -- streams one reading per zone every 0.5 s
  POST /scenario/{name}
  POST /fan
  POST /copilot
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend import db
from backend.simulator import Simulator
from backend.ingest import process

# ------------------------------------------------------------------ shared state
_sim = Simulator()
_manual_fan: dict[str, float | None] = {}  # zone -> manual override (None = auto)
_clients: set[WebSocket] = set()


# ------------------------------------------------------------------ lifespan
@asynccontextmanager
async def _lifespan(app: FastAPI):
    db.init_db()
    task = asyncio.create_task(_sim_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="OreAcle API", version="0.1.0", lifespan=_lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------ sim loop
async def _sim_loop() -> None:
    while True:
        raw_readings = _sim.tick()
        for raw in raw_readings:
            zone = raw["zone"]
            enriched = process(raw, _manual_fan.get(zone))
            await _broadcast(enriched)
        await asyncio.sleep(0.5)


async def _broadcast(data: dict) -> None:
    dead: set[WebSocket] = set()
    for ws in list(_clients):
        try:
            await ws.send_json(data)
        except Exception:
            dead.add(ws)
    _clients.difference_update(dead)


# ------------------------------------------------------------------ routes
@app.get("/health")
async def health():
    return {"status": "ok", "scenario": _sim.scenario, "clients": len(_clients)}


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    _clients.add(websocket)
    try:
        # keep alive; client can send anything (ignored)
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _clients.discard(websocket)


_VALID_SCENARIOS = {"normal", "gas_buildup", "bearing_failure", "blast_clearance", "reset"}


@app.post("/scenario/{name}")
async def set_scenario(name: str):
    if name not in _VALID_SCENARIOS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown scenario '{name}'. Valid: {sorted(_VALID_SCENARIOS)}",
        )
    canonical = "normal" if name == "reset" else name
    if name == "reset":
        _manual_fan.clear()
    _sim.set_scenario(canonical)
    return {"scenario": canonical}


class FanRequest(BaseModel):
    zone: Optional[str] = None
    pct: float


@app.post("/fan")
async def set_fan(req: FanRequest):
    pct = round(max(0.0, min(100.0, req.pct)), 1)
    if req.zone:
        _manual_fan[req.zone] = pct
        return {"zone": req.zone, "fan_pct": pct}
    # apply to all zones
    from backend.simulator import ZONES
    for z in ZONES:
        _manual_fan[z] = pct
    return {"zone": "all", "fan_pct": pct}


class CopilotRequest(BaseModel):
    question: str


@app.post("/copilot")
async def copilot(req: CopilotRequest):
    from backend.llm import answer_copilot
    recent = db.get_recent(n=20)
    answer = answer_copilot(req.question, recent)
    return {"answer": answer}
