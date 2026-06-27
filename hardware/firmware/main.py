# OreAcle - Calibrated Pico W potentiometer airflow firmware
# Reads potentiometer on GP26 / ADC0 and sends a smoothed, stable JSON
# airflow signal over USB serial at 115200 baud.
#
# Calibration notes:
#   CAL_RAW_MIN / CAL_RAW_MAX define the observed ADC window for a small
#   physical potentiometer.  Values outside this window are clamped so that
#   electrical noise at the extremes never produces garbage readings.
#   SMOOTHING_ALPHA < 0.10 gives a slow, stable trace — good for demo use.
#   DEADBAND_MPS suppresses micro-jitter: the displayed value only advances
#   when the smoothed estimate moves by at least this amount.

import time
import json
from machine import Pin, ADC

led = Pin("LED", Pin.OUT)
pot = ADC(26)  # GP26 / ADC0

ZONE = "Zone E - Edge Node (Pico W)"

# ADC window observed on demo hardware.  Widen if the knob feels truncated.
CAL_RAW_MIN = 9000
CAL_RAW_MAX = 15000

# Change to True if turning the knob up decreases airflow instead of increasing.
INVERT = False

SAMPLES_PER_READING = 50   # average 50 samples to reduce ADC noise
SMOOTHING_ALPHA     = 0.08 # low-pass weight; smaller = smoother / slower
DEADBAND_MPS        = 0.10 # ignore changes smaller than this (m/s)
SEND_EVERY          = 0.75 # seconds between JSON lines


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def read_raw_avg():
    """Return the mean of SAMPLES_PER_READING ADC readings (reduces noise)."""
    total = 0
    for _ in range(SAMPLES_PER_READING):
        total += pot.read_u16()
        time.sleep_ms(2)
    return total // SAMPLES_PER_READING


def raw_to_airflow(raw):
    """Map a raw ADC value to m/s within the calibrated window (0.0 – 5.0)."""
    frac = (raw - CAL_RAW_MIN) / (CAL_RAW_MAX - CAL_RAW_MIN)
    frac = clamp(frac, 0.0, 1.0)
    if INVERT:
        frac = 1.0 - frac
    return clamp(frac * 5.0, 0.0, 5.0)


def assess(airflow):
    if airflow >= 1.7:
        status = "OK"
    elif airflow >= 0.8:
        status = "WATCH"
    else:
        status = "ALERT"

    deficit = max(0.0, 2.5 - airflow) / 2.5
    fan_pct = int(clamp(30 + deficit * 70, 30, 100))
    return status, fan_pct


print("OreAcle Pico W stable potentiometer airflow starting...")

raw = read_raw_avg()
smoothed_airflow = raw_to_airflow(raw)
display_airflow = smoothed_airflow

while True:
    raw = read_raw_avg()
    instant_airflow = raw_to_airflow(raw)

    smoothed_airflow = (
        SMOOTHING_ALPHA * instant_airflow
        + (1 - SMOOTHING_ALPHA) * smoothed_airflow
    )

    if abs(smoothed_airflow - display_airflow) >= DEADBAND_MPS:
        display_airflow = smoothed_airflow

    airflow = round(display_airflow, 2)
    status, fan_pct = assess(airflow)

    reading = {
        "source": "pico_w",
        "zone": ZONE,
        "temp_c": 24.0,
        "humidity": 46.0,
        "vib_rms": 0.18,
        "occupancy": 1,
        "co_ppm": 8.0,
        "no2_ppm": 0.4,
        "airflow": airflow,
        "raw_adc": raw,
        "fan_pct": fan_pct,
        "status": status,
    }

    led.on()
    print(json.dumps(reading))
    time.sleep(0.05)
    led.off()

    time.sleep(SEND_EVERY)