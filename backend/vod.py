"""
Ventilation on Demand: computes required fan percentage from zone readings.
Returns a float in [0, 100].
"""
from __future__ import annotations


def compute_fan_pct(reading: dict, manual_override: float | None = None) -> float:
    if manual_override is not None:
        return round(max(0.0, min(100.0, manual_override)), 1)

    co   = float(reading.get("co_ppm",   0))
    no2  = float(reading.get("no2_ppm",  0))
    occ  = int(reading.get("occupancy",  1))
    af   = float(reading.get("airflow",  2.0))
    temp = float(reading.get("temp_c",   20.0))
    st   = reading.get("status", "OK")

    pct = 25.0  # idle baseline

    # gas demand (scaled to max contribution)
    pct += min(co  / 50.0 * 55.0, 55.0)
    pct += min(no2 /  5.0 * 20.0, 20.0)

    # keep flushing when empty (post-blast)
    if occ == 0:
        pct = max(pct, 55.0)

    # compensate for low actual airflow
    if af < 1.2:
        pct += 20.0

    # heat load
    if temp > 30.0:
        pct += 10.0

    # status floor
    if st == "ALERT":
        pct = max(pct, 85.0)
    elif st == "WATCH":
        pct = max(pct, 55.0)

    return round(min(100.0, pct), 1)
