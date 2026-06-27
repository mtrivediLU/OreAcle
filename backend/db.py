"""
SQLite persistence for OreAcle sensor readings.
DB lives at data/oreacle.db relative to the project root.
"""
from __future__ import annotations
import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "oreacle.db"


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS readings (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                ts          TEXT    NOT NULL,
                zone        TEXT    NOT NULL,
                vib_rms     REAL,
                temp_c      REAL,
                humidity    REAL,
                occupancy   INTEGER,
                distance_cm REAL,
                co_ppm      REAL,
                no2_ppm     REAL,
                airflow     REAL,
                fan_pct     REAL,
                status      TEXT,
                reasons     TEXT,
                alert_text  TEXT
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_ts   ON readings(ts)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_zone ON readings(zone)")
        c.commit()


def insert_reading(r: dict) -> None:
    with _conn() as c:
        c.execute(
            """
            INSERT INTO readings
              (ts, zone, vib_rms, temp_c, humidity, occupancy, distance_cm,
               co_ppm, no2_ppm, airflow, fan_pct, status, reasons, alert_text)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                r.get("ts"), r.get("zone"),
                r.get("vib_rms"), r.get("temp_c"), r.get("humidity"),
                r.get("occupancy"), r.get("distance_cm"),
                r.get("co_ppm"), r.get("no2_ppm"), r.get("airflow"),
                r.get("fan_pct"), r.get("status"),
                json.dumps(r.get("reasons", [])),
                r.get("alert_text", ""),
            ),
        )
        c.commit()


def get_recent(zone: str | None = None, n: int = 20) -> list[dict]:
    with _conn() as c:
        if zone:
            rows = c.execute(
                "SELECT * FROM readings WHERE zone=? ORDER BY ts DESC LIMIT ?",
                (zone, n),
            ).fetchall()
        else:
            rows = c.execute(
                "SELECT * FROM readings ORDER BY ts DESC LIMIT ?", (n,)
            ).fetchall()
    out = []
    for row in rows:
        d = dict(row)
        d["reasons"] = json.loads(d.get("reasons") or "[]")
        out.append(d)
    return out
