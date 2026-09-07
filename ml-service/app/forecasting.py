"""Forecasting.

We implement additive Holt-Winters (level + trend + seasonal) directly in numpy
so the service does not depend on a statsmodels cp314 wheel being present. When
history is short (< 18 monthly points) we fall back to a damped linear trend.

Backtest MAPE is reported so the UI can show confidence — a forecast is never
presented as certain (CONTRACT.md §6, SRS §23).
"""
from __future__ import annotations

import numpy as np

SEASON = 12  # monthly seasonality
MIN_HW_POINTS = 18


def _holt_winters_additive(
    y: np.ndarray,
    horizon: int,
    season: int = SEASON,
    alpha: float = 0.4,
    beta: float = 0.1,
    gamma: float = 0.2,
):
    """Additive Holt-Winters. Returns (fitted, forecast).

    level  l_t = alpha*(y_t - s_{t-m}) + (1-alpha)*(l_{t-1}+b_{t-1})
    trend  b_t = beta*(l_t - l_{t-1}) + (1-beta)*b_{t-1}
    season s_t = gamma*(y_t - l_t) + (1-gamma)*s_{t-m}
    """
    n = len(y)
    # Seasonal init: average of first `season` points as level; seasonal deviations.
    l = float(y[:season].mean())
    b = float((y[season : 2 * season].mean() - y[:season].mean()) / season) if n >= 2 * season else 0.0
    s = [float(y[i] - l) for i in range(season)]

    fitted = np.full(n, np.nan)
    for t in range(n):
        seasonal = s[t % season]
        if t >= season:
            prev_l, prev_b = l, b
            l = alpha * (y[t] - s[t % season]) + (1 - alpha) * (prev_l + prev_b)
            b = beta * (l - prev_l) + (1 - beta) * prev_b
            s[t % season] = gamma * (y[t] - l) + (1 - gamma) * s[t % season]
            fitted[t] = prev_l + prev_b + seasonal
        else:
            fitted[t] = l + seasonal

    fc = np.empty(horizon)
    for h in range(1, horizon + 1):
        fc[h - 1] = l + h * b + s[(n + h - 1) % season]
    return fitted, fc


def _damped_linear(y: np.ndarray, horizon: int, phi: float = 0.9):
    """Damped linear trend for short history. Returns (fitted, forecast)."""
    n = len(y)
    x = np.arange(n)
    # least-squares line
    A = np.vstack([x, np.ones(n)]).T
    slope, intercept = np.linalg.lstsq(A, y, rcond=None)[0]
    fitted = slope * x + intercept
    last = fitted[-1]
    fc = np.empty(horizon)
    damp = 0.0
    for h in range(1, horizon + 1):
        damp += phi ** h
        fc[h - 1] = last + slope * damp
    return fitted, fc


def _mape(actual: np.ndarray, predicted: np.ndarray) -> float:
    mask = actual != 0
    if not mask.any():
        return float("nan")
    return float(np.mean(np.abs((actual[mask] - predicted[mask]) / actual[mask])) * 100.0)


def forecast_series(values: list[float], horizon: int):
    """Fit, backtest, and forecast. Returns (forecast_array, model_name, mape, resid_std)."""
    y = np.asarray(values, dtype=float)
    n = len(y)

    if n >= MIN_HW_POINTS:
        model = "holt_winters_additive"
        fitted, fc = _holt_winters_additive(y, horizon)
        # backtest MAPE over the in-sample fitted region (skip the first season)
        valid = ~np.isnan(fitted)
        valid[:SEASON] = False
        mape = _mape(y[valid], fitted[valid]) if valid.any() else float("nan")
        resid = y[valid] - fitted[valid]
    else:
        model = "damped_linear_trend"
        fitted, fc = _damped_linear(y, horizon)
        mape = _mape(y, fitted)
        resid = y - fitted

    resid_std = float(np.std(resid)) if resid.size else float(np.std(y) * 0.1)
    # Confidence band widens with horizon (sqrt(h)), never presented as certain.
    return fc, model, mape, resid_std
