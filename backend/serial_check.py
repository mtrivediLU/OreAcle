#!/usr/bin/env python3
"""
OreAcle Serial Checker
Auto-detects a Raspberry Pi Pico W on macOS, reads JSON telemetry at 115200 baud,
validates all OreAcle fields, and pretty-prints each reading.
Stop with Ctrl+C for a success summary.
"""

import glob
import json
import sys
import time
from datetime import datetime

try:
    import serial
except ImportError:
    sys.exit("pyserial is not installed. Run: pip install pyserial")

# ── field spec ────────────────────────────────────────────────────────────────
REQUIRED_FIELDS = {
    "source":     str,
    "zone":       str,
    "temp_c":     (int, float),
    "humidity":   (int, float),
    "vib_rms":    (int, float),
    "occupancy":  (int, float),
    "co_ppm":     (int, float),
    "no2_ppm":    (int, float),
    "airflow":    (int, float),
    "fan_pct":    (int, float),
    "status":     str,
}

# ── ANSI colours ──────────────────────────────────────────────────────────────
R  = "\033[0m"       # reset
B  = "\033[1m"       # bold
GR = "\033[32m"      # green
YL = "\033[33m"      # yellow
RD = "\033[31m"      # red
CY = "\033[36m"      # cyan
DM = "\033[2m"       # dim


def find_pico_port() -> str | None:
    """Return the first /dev/tty.usbmodem* or /dev/tty.usbserial* device found."""
    candidates = glob.glob("/dev/tty.usbmodem*") + glob.glob("/dev/tty.usbserial*")
    return candidates[0] if candidates else None


def validate(data: dict) -> list[str]:
    """Return a list of validation error strings (empty = OK)."""
    errors = []
    for field, expected_type in REQUIRED_FIELDS.items():
        if field not in data:
            errors.append(f"missing field '{field}'")
        elif not isinstance(data[field], expected_type):
            errors.append(
                f"'{field}' expected {expected_type.__name__ if isinstance(expected_type, type) else 'number'}, "
                f"got {type(data[field]).__name__}"
            )
    return errors


def fmt_value(key: str, val) -> str:
    """Format a field value with units where applicable."""
    units = {
        "temp_c": "°C", "humidity": "%", "vib_rms": " g",
        "co_ppm": " ppm", "no2_ppm": " ppm", "airflow": " m/s",
        "fan_pct": "%",
    }
    unit = units.get(key, "")
    if isinstance(val, float):
        return f"{val:.3f}{unit}"
    return f"{val}{unit}"


def status_colour(s: str) -> str:
    s_lower = s.lower()
    if s_lower in ("ok", "normal", "good"):
        return GR
    if s_lower in ("warn", "warning", "watch"):
        return YL
    if s_lower in ("alert", "alarm", "critical", "danger"):
        return RD
    return CY


def print_reading(data: dict, index: int) -> None:
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    zone = data.get("zone", "?")
    src  = data.get("source", "?")
    st   = str(data.get("status", "?"))
    sc   = status_colour(st)

    print(f"\n{B}{DM}─── #{index}  {ts}  zone={zone}  src={src}  status={sc}{st}{R}{B}{DM} ───{R}")

    display_order = [
        ("temp_c", "Temp"), ("humidity", "Humidity"), ("vib_rms", "Vibration"),
        ("occupancy", "Occupancy"), ("co_ppm", "CO"), ("no2_ppm", "NO₂"),
        ("airflow", "Airflow"), ("fan_pct", "Fan"),
    ]
    col_w = 14
    row = ""
    for i, (key, label) in enumerate(display_order):
        val = data.get(key, "N/A")
        cell = f"{DM}{label}{R}: {B}{fmt_value(key, val)}{R}"
        row += f"  {cell:<{col_w + 20}}"
        if (i + 1) % 4 == 0:
            print(row)
            row = ""
    if row:
        print(row)

    # any extra fields not in spec
    known = set(REQUIRED_FIELDS) | {"ts", "timestamp"}
    extras = {k: v for k, v in data.items() if k not in known}
    if extras:
        print(f"  {DM}extra: {json.dumps(extras)}{R}")


def main() -> None:
    port = find_pico_port()
    if not port:
        print(f"{YL}No Pico W port found. Plug in the device and retry.{R}")
        print("Expected pattern: /dev/tty.usbmodem* or /dev/tty.usbserial*")
        sys.exit(1)

    print(f"{B}OreAcle Serial Checker{R}")
    print(f"  Port : {GR}{port}{R}")
    print(f"  Baud : 115200")
    print(f"  Fields validated: {', '.join(REQUIRED_FIELDS)}")
    print(f"  Press {B}Ctrl+C{R} to stop\n")

    total = 0
    valid = 0
    invalid = 0
    parse_errors = 0

    try:
        with serial.Serial(port, baudrate=115200, timeout=2) as ser:
            print(f"{GR}Connected.{R} Waiting for data…\n")
            buffer = ""
            while True:
                chunk = ser.read(256).decode("utf-8", errors="replace")
                if not chunk:
                    continue
                buffer += chunk
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    line = line.strip()
                    if not line:
                        continue
                    total += 1
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError as e:
                        parse_errors += 1
                        print(f"{RD}[#{total}] JSON parse error:{R} {e}")
                        print(f"  {DM}Raw: {line[:120]}{'…' if len(line) > 120 else ''}{R}")
                        continue

                    errors = validate(data)
                    if errors:
                        invalid += 1
                        print(f"{YL}[#{total}] Validation issues:{R}")
                        for err in errors:
                            print(f"  • {err}")
                        print(f"  {DM}Raw: {json.dumps(data)}{R}")
                    else:
                        valid += 1
                        print_reading(data, total)

    except serial.SerialException as e:
        print(f"\n{RD}Serial error:{R} {e}")
    except KeyboardInterrupt:
        pass

    # ── summary ───────────────────────────────────────────────────────────────
    print(f"\n{B}{'─' * 48}{R}")
    print(f"{B}Session Summary{R}")
    print(f"  Total lines received : {B}{total}{R}")
    print(f"  {GR}Valid readings       : {valid}{R}")
    if invalid:
        print(f"  {YL}Validation failures  : {invalid}{R}")
    if parse_errors:
        print(f"  {RD}JSON parse errors    : {parse_errors}{R}")
    if total:
        pct = 100 * valid / total
        bar_len = 30
        filled = round(bar_len * valid / total)
        bar = GR + "█" * filled + R + DM + "░" * (bar_len - filled) + R
        print(f"  Success rate         : {bar} {pct:.1f}%")
    print(f"{B}{'─' * 48}{R}\n")


if __name__ == "__main__":
    main()
