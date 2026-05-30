#!/usr/bin/env python

"""
Fetch Ellis map parking facilities and per-lot rate details from the same JSON
endpoints used by https://www.ellisparking.com/location (Express /map routes).

Writes:
  * data/parking/private/garages-ellis.json — lotType 1 (ramps / structured facilities)
  * data/parking/private/lots-ellis.json — lotType 2 (surface-style lots), plus any
    name listed in `ELLIS_NAMES_FORCE_LOT` when Ellis mis-tags a lot as type 1

lotType 3 (valet locations on Ellis’s map) is omitted. Loaded as **`ellisGarages`** / **`ellisLots`** in `loadData()` for **`#/data/parking`** and under private garage/lot toggles on **`#/visit`**.

Grand Rapids rows are limited to within MAX_MILES_FROM_CENTER of downtown
(same center as fetch_car_parking_arcgis.py). Lansing and Kalamazoo are not
distance-filtered (optional --all-cities).
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ELLIS_BASE = "https://www.ellisparking.com"
# Short `owner` / dataset title label in JSON (full vendor: ELLIS_BASE).
ELLIS_OWNER = "Ellis"
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))
from parking_pricing_schema import ellis_rates_to_pricing as rates_to_pricing  # noqa: E402

OUT_GARAGES = REPO_ROOT / "data/parking/private/garages-ellis.json"
OUT_LOTS = REPO_ROOT / "data/parking/private/lots-ellis.json"

USER_AGENT = "multimodality-fetch-car-parking-ellis/1.0 (+https://github.com/citizenlabs/multimodality)"

GR_CENTER_LAT = 42.96333
GR_CENTER_LON = -85.66806
MAX_MILES_FROM_CENTER = 1.75

# Ellis map: 1 = ramp/garage-style, 2 = lot, 3 = valet (skipped here)
LOT_TYPE_GARAGE = 1
LOT_TYPE_LOT = 2
LOT_TYPE_VALET = 3

# Ellis sometimes marks a surface lot as lotType 1; force these into lots-ellis.json.
ELLIS_NAMES_FORCE_LOT: frozenset[str] = frozenset({"90 Market"})

ELLIS_CITIES = ("Grand Rapids", "Lansing", "Kalamazoo")


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    to_rad = math.pi / 180.0
    r = 3959.0
    d_lat = (lat2 - lat1) * to_rad
    d_lon = (lon2 - lon1) * to_rad
    a = math.sin(d_lat / 2) ** 2 + math.cos(lat1 * to_rad) * math.cos(
        lat2 * to_rad
    ) * math.sin(d_lon / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1 - a)))


def http_get_json(url: str) -> object:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())


def fetch_locations(city: str) -> list[dict]:
    qs = urllib.parse.urlencode({"city": city})
    raw = http_get_json(f"{ELLIS_BASE}/map/locations?{qs}")
    if not isinstance(raw, list):
        return []
    return [x for x in raw if isinstance(x, dict)]


def fetch_location_detail(lot_id: str) -> dict | None:
    qs = urllib.parse.urlencode({"_id": lot_id})
    raw = http_get_json(f"{ELLIS_BASE}/map/location?{qs}")
    if not isinstance(raw, list) or not raw:
        return None
    first = raw[0]
    return first if isinstance(first, dict) else None


def strip_html(html: str) -> str:
    t = re.sub(r"(?is)<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", t).strip()


def fmt_dollars(v: object) -> str | None:
    if v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(x):
        return None
    if abs(x - round(x)) < 1e-6:
        return f"${int(round(x))}"
    return f"${x:.2f}".rstrip("0").rstrip(".")


def build_address(loc: dict) -> str | None:
    parts: list[str] = []
    s1 = loc.get("street1")
    if s1:
        parts.append(str(s1).strip())
    s2 = loc.get("street2")
    if s2:
        s2t = str(s2).strip()
        if s2t:
            parts.append(s2t)
    city_line: list[str] = []
    for key in ("suburb", "state", "postcode"):
        v = loc.get(key)
        if v:
            city_line.append(str(v).strip())
    if city_line:
        parts.append(", ".join(city_line))
    if not parts:
        return None
    return ", ".join(parts)


def lot_lat_lon(loc: dict) -> tuple[float, float] | None:
    geo = loc.get("geo")
    if not isinstance(geo, list) or len(geo) < 2:
        return None
    try:
        lon, lat = float(geo[0]), float(geo[1])
    except (TypeError, ValueError):
        return None
    if not math.isfinite(lat) or not math.isfinite(lon):
        return None
    return lat, lon


def within_gr_downtown(lat: float, lon: float) -> bool:
    return (
        haversine_miles(lat, lon, GR_CENTER_LAT, GR_CENTER_LON) <= MAX_MILES_FROM_CENTER
    )


def lot_type_int(lot: dict) -> int | None:
    t = lot.get("lotType")
    if t is None:
        return None
    try:
        return int(t)
    except (TypeError, ValueError):
        return None


def sort_by_name(items: list[dict]) -> list[dict]:
    return sorted(
        items,
        key=lambda x: ((x.get("name") or "").lower(), x.get("location", {}).get("latitude") or 0),
    )


def lot_to_item(
    lot: dict,
    city: str,
    detail: dict | None,
    *,
    apply_gr_filter: bool,
) -> dict | None:
    loc = lot.get("location") or {}
    if not isinstance(loc, dict):
        return None
    ll = lot_lat_lon(loc)
    if not ll:
        return None
    lat, lon = ll
    if apply_gr_filter and not within_gr_downtown(lat, lon):
        return None

    name = lot.get("name")
    item: dict = {
        "location": {
            "latitude": round(lat, 6),
            "longitude": round(lon, 6),
        },
        "owner": ELLIS_OWNER,
    }
    if name:
        item["name"] = str(name).strip()
    addr = build_address(loc)
    if addr:
        item["address"] = addr

    availability_parts: list[str] = []
    if city:
        availability_parts.append(city)
    if detail:
        sp = detail.get("spaces")
        if sp is not None:
            try:
                availability_parts.append(f"{int(sp)} spaces")
            except (TypeError, ValueError):
                availability_parts.append(f"{sp} spaces")
        rates = detail.get("rates")
        if isinstance(rates, dict):
            mo = fmt_dollars(rates.get("monthly"))
            if mo:
                availability_parts.append(f"Monthly from {mo}")
        desc = detail.get("description")
        if isinstance(desc, str) and desc.strip():
            plain = strip_html(desc)
            if plain and plain not in " ".join(availability_parts):
                if len(plain) > 240:
                    plain = plain[:237] + "…"
                availability_parts.append(plain)
    if availability_parts:
        item["availability"] = "; ".join(availability_parts)

    rates = detail.get("rates") if detail else None
    p = rates_to_pricing(rates if isinstance(rates, dict) else None)
    if p:
        item["pricing"] = p

    return item


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--city",
        default="Grand Rapids",
        help=f'Ellis city label (default: Grand Rapids). Known: {", ".join(ELLIS_CITIES)}',
    )
    p.add_argument(
        "--all-cities",
        action="store_true",
        help="Fetch Grand Rapids, Lansing, and Kalamazoo into the same output files.",
    )
    p.add_argument(
        "--no-details",
        action="store_true",
        help="Skip /map/location requests (faster; no numeric rates or space counts).",
    )
    p.add_argument(
        "--sleep",
        type=float,
        default=0.2,
        metavar="SEC",
        help="Delay between detail requests (default: 0.2).",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    cities = list(ELLIS_CITIES) if args.all_cities else [args.city]

    garages_raw: list[dict] = []
    lots_raw: list[dict] = []

    for city in cities:
        apply_gr = city.strip().casefold() == "grand rapids".casefold()
        try:
            rows = fetch_locations(city)
        except (urllib.error.URLError, json.JSONDecodeError, OSError) as e:
            print(f"Failed to fetch locations for {city!r}: {e}", file=sys.stderr)
            return 1

        for lot in rows:
            lt = lot_type_int(lot)
            if lt is None or lt == LOT_TYPE_VALET:
                continue
            if lt not in (LOT_TYPE_GARAGE, LOT_TYPE_LOT):
                continue
            name_norm = str(lot.get("name") or "").strip()
            if name_norm in ELLIS_NAMES_FORCE_LOT:
                lt = LOT_TYPE_LOT

            lot_id = lot.get("_id")
            detail = None
            if not args.no_details and isinstance(lot_id, str) and lot_id:
                try:
                    detail = fetch_location_detail(lot_id)
                except (urllib.error.URLError, json.JSONDecodeError, OSError) as e:
                    print(
                        f"Warning: detail for {lot_id!r} ({lot.get('name')}): {e}",
                        file=sys.stderr,
                    )
                if args.sleep > 0:
                    time.sleep(args.sleep)

            item = lot_to_item(lot, city, detail, apply_gr_filter=apply_gr)
            if not item:
                continue
            if lt == LOT_TYPE_GARAGE:
                garages_raw.append(item)
            else:
                lots_raw.append(item)

    garages = sort_by_name(garages_raw)
    lots = sort_by_name(lots_raw)

    note_common = (
        "Generated by scripts/fetch_car_parking_ellis.py from Ellis map JSON at "
        f"{ELLIS_BASE}/map/locations and /map/location (same source as the Ellis "
        "website). Undocumented API; schema may change. Valet-only pins (lotType 3) "
        "are omitted. "
    )
    note_gr = (
        f"Grand Rapids points are limited to within {MAX_MILES_FROM_CENTER:g} mi of "
        f"downtown ({GR_CENTER_LAT:.5f}, {GR_CENTER_LON:.5f}). "
    )
    note_tail = (
        "Merged in loadData() as ellisGarages / ellisLots; "
        "on #/visit they appear with private garage/lot toggles."
    )
    city_note = "Cities: " + ", ".join(cities) + ". "
    note_g = note_common + (note_gr if any(c.strip().casefold() == "grand rapids" for c in cities) else "") + city_note + note_tail
    note_l = note_g

    OUT_GARAGES.parent.mkdir(parents=True, exist_ok=True)

    OUT_GARAGES.write_text(
        json.dumps(
            {
                "name": f"{ELLIS_OWNER} garages",
                "modes": ["drive"],
                "note": note_g,
                "items": garages,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    OUT_LOTS.write_text(
        json.dumps(
            {
                "name": f"{ELLIS_OWNER} lots",
                "modes": ["drive"],
                "note": note_l,
                "items": lots,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"Wrote {len(garages)} Ellis garages -> {OUT_GARAGES.relative_to(REPO_ROOT)}")
    print(f"Wrote {len(lots)} Ellis lots -> {OUT_LOTS.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
