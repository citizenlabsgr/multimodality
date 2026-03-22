#!/usr/bin/env python

"""
Regenerate data/parking/racks.json from OpenStreetMap via the Overpass API.

Queries amenity=bicycle_parking within a bounding box around Grand Rapids, MI,
then keeps only points within MAX_MILES_FROM_CENTER mi of downtown Grand Rapids.
Data © OpenStreetMap contributors, ODbL — https://www.openstreetmap.org/copyright
"""

from __future__ import annotations

import json
import math
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Grand Rapids metro-ish bbox: south, west, north, east (WGS84)
DEFAULT_BBOX = (42.85, -85.88, 43.12, -85.45)

# Downtown Grand Rapids (approx. city center); filter racks to within this radius
GR_CENTER_LAT = 42.96333
GR_CENTER_LON = -85.66806
MAX_MILES_FROM_CENTER = 1.75

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_RACKS = REPO_ROOT / "data/parking/racks.json"

USER_AGENT = "multimodality-fetch-bike-parking/1.0 (+https://github.com/citizenlabs/multimodality)"


def overpass_query(south: float, west: float, north: float, east: float) -> str:
    return f"""[out:json][timeout:120];
(
  node["amenity"="bicycle_parking"]({south},{west},{north},{east});
  way["amenity"="bicycle_parking"]({south},{west},{north},{east});
  relation["amenity"="bicycle_parking"]({south},{west},{north},{east});
);
out center tags;
"""


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in statute miles (WGS84)."""
    to_rad = math.pi / 180.0
    r = 3959.0  # Earth radius in miles
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
    with urllib.request.urlopen(req, timeout=180) as resp:
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


def build_availability(tags: dict) -> str | None:
    parts: list[str] = []
    cap = tags.get("capacity")
    if cap:
        parts.append(f"Capacity: {cap}")
    access = tags.get("access")
    if access and access not in ("yes", "public"):
        parts.append(f"Access: {access}")
    cov = tags.get("covered")
    if cov == "yes":
        parts.append("Covered")
    if not parts:
        return None
    return "; ".join(parts)


def element_to_item(el: dict) -> dict | None:
    coords = element_lat_lon(el)
    if not coords:
        return None
    lat, lon = coords
    tags = el.get("tags") or {}
    name = tags.get("name") or tags.get("ref")
    if not name:
        name = "Bicycle parking"

    item: dict = {
        "name": str(name).strip(),
        "location": {
            "latitude": round(lat, 6),
            "longitude": round(lon, 6),
        },
    }
    addr = build_address(tags)
    if addr:
        item["address"] = addr
    av = build_availability(tags)
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
                "Usage: fetch_bike_parking.py [south west north east]",
                file=sys.stderr,
            )
            return 1
    elif len(sys.argv) != 1:
        print(
            "Usage: fetch_bike_parking.py [south west north east]",
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

    elements = data.get("elements") or []
    items_raw: list[dict] = []
    for el in elements:
        item = element_to_item(el)
        if item and item_within_gr_center(item):
            items_raw.append(item)

    items = sort_items(dedupe_items(items_raw))
    note = (
        "Generated by scripts/fetch_bike_parking.py from OpenStreetMap "
        "(amenity=bicycle_parking) via Overpass API. "
        f"Points are limited to within {MAX_MILES_FROM_CENTER:g} mi of downtown Grand Rapids "
        f"({GR_CENTER_LAT:.5f}, {GR_CENTER_LON:.5f}). "
        "Data © OpenStreetMap contributors, ODbL — https://www.openstreetmap.org/copyright"
    )
    doc = {
        "name": "Bike Racks",
        "modes": ["bike"],
        "note": note,
        "items": items,
    }

    OUT_RACKS.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(items)} racks -> {OUT_RACKS.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
