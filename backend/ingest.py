"""
Ingest pipeline: annotate -> VOD -> alert text -> persist -> return enriched reading.
One AnomalyDetector instance is shared for the process lifetime.
"""
from __future__ import annotations

from backend.anomaly import AnomalyDetector
from backend.vod import compute_fan_pct
from backend.llm import generate_alert
from backend import db

_detector = AnomalyDetector()


def process(reading: dict, manual_fan: float | None = None) -> dict:
    r = _detector.annotate(reading)
    r["fan_pct"] = compute_fan_pct(r, manual_fan)
    if r.get("status") != "OK":
        r["alert_text"] = generate_alert(r)
    else:
        r["alert_text"] = ""
    db.insert_reading(r)
    return r
