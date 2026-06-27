"""
LLM integration via Ollama.
Gracefully falls back to deterministic templates if Ollama is not running.
"""
from __future__ import annotations

_OLLAMA_OK = False
try:
    import ollama as _ollama  # type: ignore
    _OLLAMA_OK = True
except ImportError:
    pass

MODEL = "llama3.2:3b"


# ------------------------------------------------------------------ alerts
def generate_alert(reading: dict) -> str:
    if reading.get("status") == "OK":
        return ""
    if _OLLAMA_OK:
        return _llm_alert(reading)
    return _template_alert(reading)


def _llm_alert(reading: dict) -> str:
    zone    = reading.get("zone", "unknown zone")
    status  = reading.get("status", "WATCH")
    co      = reading.get("co_ppm",  0)
    no2     = reading.get("no2_ppm", 0)
    vib     = reading.get("vib_rms", 0)
    temp    = reading.get("temp_c",  0)
    fan     = reading.get("fan_pct", 0)
    reasons = "; ".join(reading.get("reasons", []))

    prompt = (
        f"Mine zone: {zone}. Status: {status}. "
        f"Readings: CO={co:.1f}ppm, NO2={no2:.2f}ppm, vibration={vib:.3f}RMS, "
        f"temp={temp:.1f}C, fan={fan:.0f}%. "
        f"Triggered rules: {reasons}. "
        "Write a concise 1-2 sentence mine-safety alert for the shift supervisor. "
        "Be specific, professional, and actionable. No markdown."
    )
    try:
        resp = _ollama.chat(
            model=MODEL,
            messages=[{"role": "user", "content": prompt}],
            options={"temperature": 0.3, "num_predict": 90},
        )
        return resp["message"]["content"].strip()
    except Exception:
        return _template_alert(reading)


def _template_alert(reading: dict) -> str:
    zone   = reading.get("zone", "unknown zone")
    status = reading.get("status", "WATCH")
    co     = float(reading.get("co_ppm",  0))
    no2    = float(reading.get("no2_ppm", 0))
    vib    = float(reading.get("vib_rms", 0))
    temp   = float(reading.get("temp_c",  0))
    af     = float(reading.get("airflow", 2))

    if co > 50:
        return (f"ALERT {zone}: CO at {co:.1f} ppm exceeds safe limit of 50 ppm. "
                "Evacuate immediately and activate emergency ventilation.")
    if co > 25:
        return (f"WARNING {zone}: CO rising to {co:.1f} ppm. "
                "Increase ventilation and monitor personnel.")
    if vib > 0.8:
        return (f"ALERT {zone}: Abnormal vibration at {vib:.3f} RMS. "
                "Inspect bearings and halt non-essential equipment.")
    if vib > 0.4:
        return (f"WARNING {zone}: Elevated vibration at {vib:.3f} RMS. "
                "Schedule equipment inspection.")
    if temp > 35:
        return (f"ALERT {zone}: Heat-stress index at {temp:.1f} C. "
                "Increase cooling airflow and check worker welfare.")
    if no2 > 5:
        return (f"ALERT {zone}: NO2 at {no2:.2f} ppm. "
                "Increase ventilation and limit exposure.")
    if af < 0.8:
        return (f"ALERT {zone}: Airflow critically low at {af:.2f} m/s. "
                "Check ventilation ducting immediately.")
    reasons = reading.get("reasons", [])
    primary = reasons[0] if reasons else "anomalous readings"
    return f"{status} {zone}: {primary}. Monitor and investigate."


# ------------------------------------------------------------------ copilot
def answer_copilot(question: str, recent: list[dict]) -> str:
    if not recent:
        return ("No sensor data available yet. "
                "Start the backend and wait a few seconds for readings to appear.")
    if _OLLAMA_OK:
        return _llm_copilot(question, recent)
    return _template_copilot(question, recent)


def _llm_copilot(question: str, recent: list[dict]) -> str:
    seen: set[str] = set()
    lines: list[str] = []
    for r in recent[:8]:
        z = r.get("zone", "")
        if z in seen:
            continue
        seen.add(z)
        lines.append(
            f"  {z}: CO={r.get('co_ppm',0):.1f}ppm, NO2={r.get('no2_ppm',0):.2f}ppm, "
            f"vib={r.get('vib_rms',0):.3f}RMS, temp={r.get('temp_c',0):.1f}C, "
            f"fan={r.get('fan_pct',0):.0f}%, status={r.get('status','?')}"
        )
    ctx = "\n".join(lines)
    prompt = (
        "You are OreAcle, an AI mine-safety assistant. "
        f"Current sensor snapshot:\n{ctx}\n\n"
        f"Shift supervisor asks: {question}\n"
        "Answer in 2-3 sentences. Be specific, practical, and direct. No markdown."
    )
    try:
        resp = _ollama.chat(
            model=MODEL,
            messages=[{"role": "user", "content": prompt}],
            options={"temperature": 0.4, "num_predict": 130},
        )
        return resp["message"]["content"].strip()
    except Exception:
        return _template_copilot(question, recent)


def _template_copilot(question: str, readings: list[dict]) -> str:
    q = question.lower()
    alerts = [r for r in readings if r.get("status") != "OK"]
    worst_co  = max(readings, key=lambda r: r.get("co_ppm", 0),  default={})
    worst_vib = max(readings, key=lambda r: r.get("vib_rms", 0), default={})
    worst_tmp = max(readings, key=lambda r: r.get("temp_c", 0),  default={})

    if any(w in q for w in ("safe", "danger", "risk", "hazard", "status")):
        if not alerts:
            return "All zones are currently within normal parameters. No active hazards detected."
        zones = sorted({r.get("zone", "") for r in alerts})
        return (f"Active alerts in: {', '.join(zones)}. "
                "Review the alert feed for details and recommended actions.")

    if any(w in q for w in ("co", "carbon monoxide", "gas")):
        co = worst_co.get("co_ppm", 0)
        zn = worst_co.get("zone", "unknown")
        return (f"Highest CO reading is {co:.1f} ppm in {zn}. "
                "WATCH threshold is 25 ppm; ALERT threshold is 50 ppm.")

    if any(w in q for w in ("fan", "ventilation", "airflow", "vent")):
        fans = {r.get("zone"): r.get("fan_pct", 0) for r in readings if r.get("zone")}
        top  = max(fans, key=lambda z: fans[z]) if fans else None
        return (f"Fan running hardest in {top} at {fans.get(top, 0):.0f}%. "
                "Speed is auto-adjusted based on CO, NO2, occupancy, and temperature.")

    if any(w in q for w in ("temp", "heat", "hot", "temperature")):
        return (f"Highest temperature is {worst_tmp.get('temp_c', 0):.1f} C "
                f"in {worst_tmp.get('zone', 'unknown')}. Alert threshold is 35 C.")

    if any(w in q for w in ("vibration", "vib", "bearing", "equipment", "motor")):
        return (f"Highest vibration is {worst_vib.get('vib_rms', 0):.3f} RMS "
                f"in {worst_vib.get('zone', 'unknown')}. Alert threshold is 0.8 RMS.")

    return ("I can answer questions about CO levels, ventilation, temperature, vibration, "
            "and overall zone safety. Try: 'What is the CO level?' or 'Which zones are at risk?'")
