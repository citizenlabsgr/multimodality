#!/usr/bin/env python

"""
Regenerate data/parking/private/garages.json and data/parking/private/lots.json
from OpenStreetMap via the Overpass API.

Queries all amenity=parking (nodes, ways, relations) in a Grand Rapids metro
bounding box, then keeps only features within MAX_MILES_FROM_CENTER of downtown
(same center and radius as fetch_bike_parking.py).

Split (see https://wiki.openstreetmap.org/wiki/Key:parking):
  * Garages: parking~multi-storey, underground, rooftop; or building=parking.
  * Lots: surface, street_side, lane, on_street, etc., plus missing/ambiguous
    parking=* (default to lots — see per-file notes).

Rows with operator=Grand Rapids Parking Services are skipped (same DASH / city
lots as fetch_car_parking_arcgis.py).

Data © OpenStreetMap contributors, ODbL — https://www.openstreetmap.org/copyright
"""

from __future__ import annotations

import json
import math
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_BBOX = (42.85, -85.88, 43.12, -85.45)

GR_CENTER_LAT = 42.96333
GR_CENTER_LON = -85.66806
MAX_MILES_FROM_CENTER = 1.75

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_GARAGES = REPO_ROOT / "data/parking/private/garages.json"
OUT_LOTS = REPO_ROOT / "data/parking/private/lots.json"

USER_AGENT = "multimodality-fetch-car-parking-osm/1.0 (+https://github.com/citizenlabs/multimodality)"

MAX_AVAIL_LEN = 520

# City visitor map (fetch_car_parking_arcgis.py) already includes these DASH surface lots.
_SKIP_OPERATOR_CASEFOLD = "grand rapids parking services"


def _should_skip_operator(tags: dict) -> bool:
    op = (tags.get("operator") or "").strip().casefold()
    return op == _SKIP_OPERATOR_CASEFOLD


def parking_osm_bucket(tags: dict) -> str:
    """Return 'garage' or 'lot' for splitting output files."""
    if (tags.get("building") or "").strip().casefold() == "parking":
        return "garage"

    raw = (tags.get("parking") or "").strip().casefold()
    if raw in ("", "yes", "no"):
        return "lot"

    tokens = [t.strip() for t in re.split(r"[,;|/]", raw) if t.strip()]

    def token_is_garage(t: str) -> bool:
        tl = t.lower()
        if "underground" in tl:
            return True
        if "rooftop" in tl or tl == "rooftop":
            return True
        if "multi-storey" in tl or "multi storey" in tl or "multilevel" in tl:
            return True
        return False

    if any(token_is_garage(t) for t in tokens):
        return "garage"

    return "lot"


def overpass_query(south: float, west: float, north: float, east: float) -> str:
    return f"""[out:json][timeout:180];
(
  node["amenity"="parking"]({south},{west},{north},{east});
  way["amenity"="parking"]({south},{west},{north},{east});
  relation["amenity"="parking"]({south},{west},{north},{east});
);
out center tags;
"""


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    to_rad = math.pi / 180.0
    r = 3959.0
    d_lat = (lat2 - lat1) * to_rad
    d_lon = (lon2 - lon1) * to_rad
    a = math.sin(d_lat / 2) ** 2 + math.cos(lat1 * to_rad) * math.cos(
        lat2 * to_rad
    ) * math.sin(d_lon / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1 - a)))


def item_within_gr_center(item: dict) -> bool:
    loc = item.get("location") or {}
    lat, lon = loc.get("latitude"), loc.get("longitude")
    if lat is None or lon is None:
        return False
    return (
        haversine_miles(float(lat), float(lon), GR_CENTER_LAT, GR_CENTER_LON)
        <= MAX_MILES_FROM_CENTER
    )


def http_post_overpass(query: str) -> dict:
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    req = urllib.request.Request(
        OVERPASS_URL,
        data=body,
        method="POST",
        headers={
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        },
    )
    with urllib.request.urlopen(req, timeout=240) as resp:
        return json.loads(resp.read().decode())


def element_lat_lon(el: dict) -> tuple[float, float] | None:
    if el.get("type") == "node":
        lat, lon = el.get("lat"), el.get("lon")
        if lat is not None and lon is not None:
            return float(lat), float(lon)
        return None
    center = el.get("center") or {}
    lat, lon = center.get("lat"), center.get("lon")
    if lat is not None and lon is not None:
        return float(lat), float(lon)
    return None


def build_address(tags: dict) -> str | None:
    if tags.get("addr:full"):
        return str(tags["addr:full"]).strip()
    parts: list[str] = []
    hn = tags.get("addr:housenumber")
    st = tags.get("addr:street")
    if hn and st:
        parts.append(f"{hn} {st}".strip())
    elif st:
        parts.append(str(st).strip())
    city = tags.get("addr:city")
    if city:
        parts.append(str(city).strip())
    state = tags.get("addr:state")
    if state:
        parts.append(str(state).strip())
    if not parts:
        return None
    return ", ".join(parts)


def _trunc(s: str, max_len: int) -> str:
    s = s.strip()
    if len(s) <= max_len:
        return s
    return s[: max_len - 1] + "…"


def build_availability(tags: dict, osm_type: str, osm_id: int) -> str | None:
    parts: list[str] = []
    for label, key, mlen in (
        ("Operator", "operator", 120),
        ("Brand", "brand", 80),
        ("Type", "parking", 40),
        ("Access", "access", 40),
        ("Fee", "fee", 40),
        ("Capacity", "capacity", 24),
        ("Surface", "surface", 32),
        ("Operator type", "operator:type", 32),
        ("Hours", "opening_hours", 100),
    ):
        v = tags.get(key)
        if v is None or str(v).strip() == "":
            continue
        parts.append(f"{label}: {_trunc(str(v), mlen)}")
    parts.append(f"OSM {osm_type}/{osm_id}")
    s = "; ".join(parts)
    return _trunc(s, MAX_AVAIL_LEN) if s else None


def build_name(tags: dict) -> str:
    if tags.get("name"):
        return str(tags["name"]).strip()
    ref = tags.get("ref")
    if ref:
        return f"Parking {str(ref).strip()}"
    op = tags.get("operator")
    if op:
        return f"{str(op).strip()} parking"
    brand = tags.get("brand")
    if brand:
        return f"{str(brand).strip()} parking"
    return "Unknown"


def element_to_item(el: dict) -> dict | None:
    coords = element_lat_lon(el)
    if not coords:
        return None
    lat, lon = coords
    tags = el.get("tags") or {}
    if _should_skip_operator(tags):
        return None
    name = build_name(tags)

    item: dict = {
        "name": name,
        "location": {
            "latitude": round(lat, 6),
            "longitude": round(lon, 6),
        },
    }
    addr = build_address(tags)
    if addr:
        item["address"] = addr
    av = build_availability(tags, el.get("type") or "?", int(el.get("id") or 0))
    if av:
        item["availability"] = av
    return item


def dedupe_items(items: list[dict]) -> list[dict]:
    seen: set[tuple[int, int]] = set()
    out: list[dict] = []
    for it in items:
        loc = it.get("location") or {}
        lat = loc.get("latitude")
        lon = loc.get("longitude")
        if lat is None or lon is None:
            continue
        key = (round(float(lat) * 1e5), round(float(lon) * 1e5))
        if key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out


def sort_items(items: list[dict]) -> list[dict]:
    return sorted(
        items,
        key=lambda x: (
            (x.get("name") or "").lower(),
            x["location"]["latitude"],
            x["location"]["longitude"],
        ),
    )


def main() -> int:
    south, west, north, east = DEFAULT_BBOX
    if len(sys.argv) == 5:
        try:
            south, west, north, east = (float(sys.argv[i]) for i in range(1, 5))
        except ValueError:
            print(
                "Usage: fetch_car_parking_osm.py [south west north east]",
                file=sys.stderr,
            )
            return 1
    elif len(sys.argv) != 1:
        print(
            "Usage: fetch_car_parking_osm.py [south west north east]",
            file=sys.stderr,
        )
        return 1

    query = overpass_query(south, west, north, east)
    try:
        data = http_post_overpass(query)
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as e:
        print(f"Overpass request failed: {e}", file=sys.stderr)
        return 1

    if data.get("remark"):
        print(f"Overpass remark: {data['remark']}", file=sys.stderr)

    garages_raw: list[dict] = []
    lots_raw: list[dict] = []
    for el in data.get("elements") or []:
        tags = el.get("tags") or {}
        item = element_to_item(el)
        if not item or not item_within_gr_center(item):
            continue
        if parking_osm_bucket(tags) == "garage":
            garages_raw.append(item)
        else:
            lots_raw.append(item)

    garages = sort_items(dedupe_items(garages_raw))
    lots = sort_items(dedupe_items(lots_raw))

    note_common = (
        "Generated by scripts/fetch_car_parking_osm.py from OpenStreetMap "
        "(amenity=parking: nodes, ways, relations) via Overpass API. "
        "Excludes operator=Grand Rapids Parking Services (covered by fetch_car_parking_arcgis.py). "
        "Tags are crowdsourced and often incomplete (access, fee, capacity). "
        f"Points are limited to within {MAX_MILES_FROM_CENTER:g} mi of downtown Grand Rapids "
        f"({GR_CENTER_LAT:.5f}, {GR_CENTER_LON:.5f}). "
        "Data © OpenStreetMap contributors, ODbL — https://www.openstreetmap.org/copyright"
    )
    note_garages = (
        f"{note_common} This file: parking=* garage-like values "
        "(multi-storey, underground, rooftop) and building=parking."
    )
    note_lots = (
        f"{note_common} This file: surface, street_side, lane, on_street, etc., "
        "and any feature without a clear garage tag (including missing parking=*)."
    )

    garages_doc = {
        "name": "Private Parking Garages",
        "modes": ["drive"],
        "note": note_garages,
        "items": garages,
    }
    lots_doc = {
        "name": "Private Parking Lots",
        "modes": ["drive"],
        "note": note_lots,
        "items": lots,
    }

    OUT_GARAGES.write_text(json.dumps(garages_doc, indent=2) + "\n", encoding="utf-8")
    OUT_LOTS.write_text(json.dumps(lots_doc, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {len(garages)} garages -> {OUT_GARAGES.relative_to(REPO_ROOT)}, "
        f"{len(lots)} lots -> {OUT_LOTS.relative_to(REPO_ROOT)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
