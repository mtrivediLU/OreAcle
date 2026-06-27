"""
Anomaly detection: IsolationForest (trained on synthetic normal data) + hard threshold rules.
Annotates each reading with status (OK / WATCH / ALERT) and a reasons list.
"""
from __future__ import annotations
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

FEATURES = ["vib_rms", "temp_c", "humidity", "co_ppm", "no2_ppm", "airflow"]

# (field, operator, threshold, severity, message_template)
_RULES: list[tuple] = [
    ("co_ppm",  ">", 50.0, "ALERT", "CO critical: {:.1f} ppm (limit 50)"),
    ("co_ppm",  ">", 25.0, "WATCH", "CO elevated: {:.1f} ppm (limit 25)"),
    ("no2_ppm", ">",  5.0, "ALERT", "NO2 critical: {:.2f} ppm (limit 5)"),
    ("no2_ppm", ">",  2.5, "WATCH", "NO2 elevated: {:.2f} ppm (limit 2.5)"),
    ("vib_rms", ">",  0.8, "ALERT", "Vibration critical: {:.3f} RMS"),
    ("vib_rms", ">",  0.4, "WATCH", "Vibration elevated: {:.3f} RMS"),
    ("temp_c",  ">", 35.0, "ALERT", "Temperature critical: {:.1f} C"),
    ("temp_c",  ">", 28.0, "WATCH", "Temperature elevated: {:.1f} C"),
    ("airflow", "<",  0.8, "ALERT", "Airflow critically low: {:.2f} m/s"),
    ("airflow", "<",  1.2, "WATCH", "Airflow low: {:.2f} m/s"),
]

_SEV = {"OK": 0, "WATCH": 1, "ALERT": 2}


class AnomalyDetector:
    def __init__(self) -> None:
        self._scaler = StandardScaler()
        self._model: IsolationForest | None = None
        self._train()

    def _train(self) -> None:
        """
        Synthetic normal data drawn from all four zone profiles so the model
        knows what normal looks like across the full operating range.
        """
        rng = np.random.default_rng(42)
        n_per_zone = 500
        # (vib_rms, temp_c, humidity, co_ppm, no2_ppm, airflow) means per zone
        zone_params = [
            (0.05, 18.0, 55.0,  3.0, 0.50, 2.1),  # Zone A - Entry/Shaft
            (0.12, 24.0, 70.0,  8.0, 1.20, 1.8),  # Zone B - Active Stope
            (0.20, 22.0, 60.0, 12.0, 2.00, 2.5),  # Zone C - Equipment Bay
            (0.03, 19.0, 50.0,  2.0, 0.30, 1.5),  # Zone D - Refuge
        ]
        stds = [0.015, 1.5, 6.0, 2.0, 0.30, 0.25]  # shared std devs
        chunks = []
        for means in zone_params:
            chunk = np.column_stack([
                rng.normal(m, s, n_per_zone) for m, s in zip(means, stds)
            ])
            chunks.append(chunk)
        X = np.clip(np.vstack(chunks), 0, None)
        self._scaler.fit(X)
        self._model = IsolationForest(n_estimators=100, contamination=0.03, random_state=42)
        self._model.fit(self._scaler.transform(X))

    def annotate(self, reading: dict) -> dict:
        r = dict(reading)
        reasons: list[str] = list(r.get("reasons", []))
        status = "OK"

        # 1) hard threshold rules
        for field, op, thresh, sev, tmpl in _RULES:
            val = float(r.get(field, 0))
            hit = (val > thresh) if op == ">" else (val < thresh)
            if hit:
                reasons.append(tmpl.format(val))
                if _SEV[sev] > _SEV[status]:
                    status = sev

        # 2) IsolationForest — adds WATCH if no hard rule fired but pattern is anomalous
        if self._model is not None and status == "OK":
            try:
                feat = np.array([[float(r.get(f, 0)) for f in FEATURES]])
                feat = np.clip(feat, 0, None)
                feat_s = self._scaler.transform(feat)
                pred  = int(self._model.predict(feat_s)[0])   # +1 normal, -1 anomaly
                score = float(self._model.score_samples(feat_s)[0])
                if pred == -1:
                    status = "WATCH"
                    reasons.append(f"Isolation Forest anomaly (score {score:.3f})")
            except Exception:
                pass

        r["status"] = status
        r["reasons"] = reasons
        return r
