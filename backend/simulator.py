"""
Sensor data simulator for OreAcle.
Generates realistic readings for 4 mine zones; no hardware required.
Run standalone:  python -m backend.simulator [scenario]
"""
from __future__ import annotations
import math
import random
import time
from datetime import datetime, timezone

ZONES = [
    "Zone A - Entry/Shaft",
    "Zone B - Active Stope",
    "Zone C - Equipment Bay",
    "Zone D - Refuge",
]

# Normal operating baselines per zone
_BASE: dict[str, dict] = {
    "Zone A - Entry/Shaft":   dict(vib_rms=0.05, temp_c=18.0, humidity=55.0, co_ppm=3.0,  no2_ppm=0.50, airflow=2.1),
    "Zone B - Active Stope":  dict(vib_rms=0.12, temp_c=24.0, humidity=70.0, co_ppm=8.0,  no2_ppm=1.20, airflow=1.8),
    "Zone C - Equipment Bay": dict(vib_rms=0.20, temp_c=22.0, humidity=60.0, co_ppm=12.0, no2_ppm=2.00, airflow=2.5),
    "Zone D - Refuge":        dict(vib_rms=0.03, temp_c=19.0, humidity=50.0, co_ppm=2.0,  no2_ppm=0.30, airflow=1.5),
}


def _jitter(v: float, pct: float = 0.03) -> float:
    return v * (1.0 + random.gauss(0, pct))


class Simulator:
    def __init__(self) -> None:
        self.scenario: str = "normal"
        self._tick: int = 0
        # last computed value per zone (used for smooth transitions)
        self._prev: dict[str, dict] = {z: dict(_BASE[z]) for z in ZONES}

    def set_scenario(self, name: str) -> None:
        self.scenario = name
        self._tick = 0

    def tick(self) -> list[dict]:
        self._tick += 1
        return [self._reading(z, self._tick) for z in ZONES]

    # ------------------------------------------------------------------
    def _reading(self, zone: str, t: int) -> dict:
        base = _BASE[zone]
        sc = self.scenario

        vib  = _jitter(base["vib_rms"])
        temp = _jitter(base["temp_c"],   0.008)
        hum  = _jitter(base["humidity"], 0.015)
        co   = _jitter(base["co_ppm"])
        no2  = _jitter(base["no2_ppm"])
        af   = _jitter(base["airflow"],  0.04)
        occ  = 1
        dist = _jitter(150.0, 0.10)
        fan  = 30.0

        if sc == "gas_buildup":
            if zone in ("Zone B - Active Stope", "Zone C - Equipment Bay"):
                rise = min(t * 1.8, 72.0)
                co   = base["co_ppm"] + rise + random.gauss(0, 2.0)
                no2  = base["no2_ppm"] + min(t * 0.07, 5.0) + random.gauss(0, 0.2)
                af   = max(0.4, base["airflow"] - min(t * 0.025, 1.2))

        elif sc == "bearing_failure":
            if zone == "Zone C - Equipment Bay":
                vib  = base["vib_rms"] + min(t * 0.04, 1.4) + abs(random.gauss(0, 0.07))
                temp = base["temp_c"]  + min(t * 0.12, 10.0)

        elif sc == "blast_clearance":
            occ = 0
            peak = 20.0 * math.exp(-((t - 8) ** 2) / 25.0)
            co  = base["co_ppm"]  + peak + random.gauss(0, 1.0)
            no2 = base["no2_ppm"] + peak * 0.3 + random.gauss(0, 0.15)
            fan = 95.0

        # clamp
        co  = max(0.0, co)
        no2 = max(0.0, no2)
        vib = max(0.0, vib)
        fan = max(0.0, min(100.0, fan))

        return {
            "ts":          datetime.now(timezone.utc).isoformat(),
            "zone":        zone,
            "vib_rms":     round(vib,  4),
            "temp_c":      round(temp, 2),
            "humidity":    round(hum,  1),
            "occupancy":   int(occ),
            "distance_cm": round(dist, 1),
            "co_ppm":      round(co,   2),
            "no2_ppm":     round(no2,  3),
            "airflow":     round(af,   3),
            "fan_pct":     round(fan,  1),
            "status":      "OK",
            "reasons":     [],
            "alert_text":  "",
        }


# ---------- standalone demo ----------
if __name__ == "__main__":
    import json
    import sys

    scenario = sys.argv[1] if len(sys.argv) > 1 else "normal"
    sim = Simulator()
    sim.set_scenario(scenario)
    print(f"OreAcle simulator  |  scenario={scenario}  |  Ctrl-C to stop\n")
    try:
        while True:
            for r in sim.tick():
                print(json.dumps(r))
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nStopped.")
