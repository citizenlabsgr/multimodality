"""Parse and emit parking `pricing` objects (float tiers + optional metadata)."""

from __future__ import annotations

import math
import re
from typing import Any

PRICING_AMOUNT_KEYS = (
    "events",
    "evening",
    "hourly",
    "rate",
    "daily",
)

_DOLLAR_RE = re.compile(r"\$(\d+(?:\.\d+)?)")
_RANGE_RE = re.compile(
    r"\$(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\b",
)


def parse_dollar_amounts(text: str) -> list[float]:
    if not text or not str(text).strip():
        return []
    s = str(text).strip()
    nums: list[float] = []
    for m in _DOLLAR_RE.finditer(s):
        n = float(m.group(1))
        if math.isfinite(n):
            nums.append(n)
    for m in _RANGE_RE.finditer(s):
        for g in (m.group(1), m.group(2)):
            n = float(g)
            if math.isfinite(n):
                nums.append(n)
    return nums


def _single_amount(nums: list[float]) -> float | None:
    if not nums:
        return None
    return round(max(nums), 4)


def _scale_amount(val: float | list[float], factor: float) -> float | list[float]:
    if isinstance(val, list) and len(val) == 2:
        return [round(float(val[0]) * factor, 4), round(float(val[1]) * factor, 4)]
    return round(float(val) * factor, 4)


def amount_to_hourly(
    val: float | list[float],
    raw: str | None = None,
    *,
    default_half_hour: bool = False,
) -> float | list[float]:
    """Convert a source rate to dollars per hour (half-hour sources are ×2)."""
    text = str(raw).lower() if raw else ""
    if "per hour" in text and "per half hour" not in text:
        return val
    if "per half hour" in text or default_half_hour:
        return _scale_amount(val, 2)
    return val


def _set_hourly(pricing: dict[str, Any], val: float | list[float]) -> None:
    pricing["hourly"] = val


def _range_amount(nums: list[float], text: str) -> list[float] | None:
    m = _RANGE_RE.search(text)
    if m:
        lo, hi = float(m.group(1)), float(m.group(2))
        if math.isfinite(lo) and math.isfinite(hi):
            return [round(min(lo, hi), 4), round(max(lo, hi), 4)]
    if len(nums) >= 2:
        lo, hi = min(nums), max(nums)
        return [round(lo, 4), round(hi, 4)]
    return None


def tier_from_legacy_string(key: str, text: str) -> tuple[Any, dict[str, str]]:
    """Convert a legacy display string to (amount, meta)."""
    meta: dict[str, str] = {}
    raw = str(text).strip()
    if not raw:
        return None, meta

    lower = raw.lower()
    if key == "hourly" and "$" not in raw and (
        "weekend" in lower or "weekday" in lower
    ):
        return None, {"hourlyFreeWhen": raw}

    if key == "rate" and "early bird" in lower:
        nums = parse_dollar_amounts(raw)
        amount = _single_amount(nums) if nums else 0.0
        return amount if amount is not None else 0.0, {"rateLabel": "Early bird"}

    half_hour = "per half hour" in lower
    per_hour = ("per hour" in lower or bool(re.search(r"\bper\s+hour\b", lower))) and not half_hour

    if key == "rate" and "in prime areas" in lower:
        meta["rateNote"] = "in prime areas"

    if key == "daily" and raw.lower().startswith("max "):
        nums = parse_dollar_amounts(raw)
        amount = _single_amount(nums)
        return amount, meta

    nums = parse_dollar_amounts(raw)
    if not nums:
        return None, meta

    if re.search(r"\$\d+(?:\.\d+)?\s*[-–—]\s*\$?\d+(?:\.\d+)?", raw):
        rng = _range_amount(nums, raw)
        if rng is not None:
            return rng, meta

    amount = _single_amount(nums)
    if amount is None:
        return None, meta
    if key == "hourly" or (key == "rate" and "early bird" not in lower):
        return amount_to_hourly(amount, raw, default_half_hour=half_hour or key == "rate"), meta
    return amount, meta


def migrate_pricing_object(pricing: dict[str, Any] | None) -> dict[str, Any] | None:
    if not pricing or not isinstance(pricing, dict):
        return pricing
    out: dict[str, Any] = {}
    for key, val in pricing.items():
        if key in ("maxDuration", "enforcement", "free"):
            out[key] = val
            continue
        tier_key = "daily" if key == "daytime" else key
        if tier_key in PRICING_AMOUNT_KEYS:
            if isinstance(val, (int, float)) and math.isfinite(float(val)):
                out[tier_key] = round(float(val), 4)
                continue
            if (
                isinstance(val, list)
                and len(val) == 2
                and all(isinstance(x, (int, float)) for x in val)
            ):
                out[tier_key] = [round(float(val[0]), 4), round(float(val[1]), 4)]
                continue
            if isinstance(val, str):
                amount, meta = tier_from_legacy_string(tier_key, val)
                if amount is not None:
                    store_key = tier_key
                    if tier_key == "rate" and "rateLabel" not in meta:
                        store_key = "hourly"
                    out[store_key] = amount
                for mk, mv in meta.items():
                    out[mk] = mv
            continue
        if isinstance(val, str):
            out[key] = val
    if "daytime" in out:
        if "daily" not in out:
            out["daily"] = out["daytime"]
        del out["daytime"]
    normalize_per_unit_rates(out)
    return out or None


def normalize_per_unit_rates(pricing: dict[str, Any]) -> None:
    """Drop `ratePer`; move per-unit `rate` amounts into `hourly` (early bird stays on `rate`)."""
    rate_per = pricing.pop("ratePer", None)
    rate = pricing.get("rate")
    if rate is None or pricing.get("rateLabel"):
        return
    per_hour = rate_per == "hour"
    hourly_val = (
        rate
        if per_hour
        else amount_to_hourly(rate, default_half_hour=True)
    )
    if "hourly" not in pricing:
        pricing["hourly"] = hourly_val
    del pricing["rate"]


def arcgis_tier_value(text: str | None) -> float | list[float] | None:
    if text is None:
        return None
    s = str(text).strip()
    if not s or s.lower() in ("no rate", "n/a", "none"):
        return None
    nums = parse_dollar_amounts(s)
    if not nums:
        return None
    if re.search(r"\$\d+(?:\.\d+)?\s*[-–—]\s*\$?\d+(?:\.\d+)?", s):
        rng = _range_amount(nums, s)
        if rng is not None:
            return rng
    amount = _single_amount(nums)
    return amount


def build_arcgis_pricing(attrs: dict) -> dict | None:
    pricing: dict[str, Any] = {}
    for key, raw in (
        ("daily", attrs.get("DAILY_MAX")),
        ("evening", attrs.get("evening")),
        ("events", attrs.get("EVENT_CHRG")),
    ):
        val = arcgis_tier_value(raw)
        if val is not None:
            pricing[key] = val
    half_hr_raw = attrs.get("HALF_HR_RT")
    half_val = arcgis_tier_value(half_hr_raw)
    if half_val is not None:
        _set_hourly(
            pricing,
            amount_to_hourly(half_val, half_hr_raw, default_half_hour=True),
        )
    hr_raw = attrs.get("Hour_Rate")
    hr_val = arcgis_tier_value(hr_raw)
    if (
        hr_raw
        and isinstance(hr_raw, str)
        and "$" not in hr_raw
        and "weekend" in hr_raw.lower()
    ):
        pricing.pop("hourly", None)
        pricing["hourlyFreeWhen"] = hr_raw.strip()
    elif hr_val is not None:
        _set_hourly(pricing, amount_to_hourly(hr_val, hr_raw))
    return pricing or None


def ellis_rates_to_pricing(rates: dict | None) -> dict | None:
    if not rates or not isinstance(rates, dict):
        return None
    pricing: dict[str, Any] = {}
    eb = rates.get("earlyBird")
    if eb is not None:
        try:
            pricing["rate"] = round(float(eb), 4)
            pricing["rateLabel"] = "Early bird"
        except (TypeError, ValueError):
            pass
    ph = rates.get("perHalfHour")
    if ph is not None:
        try:
            pricing["hourly"] = round(float(ph) * 2, 4)
        except (TypeError, ValueError):
            pass
    ev = rates.get("evening")
    if ev is not None:
        try:
            pricing["evening"] = round(float(ev), 4)
        except (TypeError, ValueError):
            pass
    md = rates.get("maxDay")
    if md is not None:
        try:
            pricing["daily"] = round(float(md), 4)
        except (TypeError, ValueError):
            pass
    return pricing or None
