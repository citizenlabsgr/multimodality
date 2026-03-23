#!/usr/bin/env python

"""
Regenerate data/parking/micromobility.json from Lime partner GBFS (Grand Rapids).

Official designated parking zones are not published as points in Lime’s GBFS for
this market (only a single placeholder station). We approximate high-traffic
parking by clustering current scooter and e-bike positions from
free_bike_status into a fixed lat/lon grid; centroids are *hints*, not legal
corral boundaries—riders should follow the Lime app.

Data: https://data.lime.bike/api/partners/v2/gbfs/grand_rapids/free_bike_status
Terms: https://www.li.me/gbfs-terms

Usage:
  python scripts/fetch_lime_parking.py [grid_deg] [min_vehicles]

Defaults: grid_deg=0.003 (~330 m), min_vehicles=4
"""

from __future__ import annotations

import json
import math
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

GBFS_FREE_BIKE = (
    "https://data.lime.bike/api/partners/v2/gbfs/grand_rapids/free_bike_status"
)
REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "data/parking/micromobility.json"

USER_AGENT = "multimodality-fetch-lime-parking/1.0 (+https://github.com/citizenlabs/multimodality)"

# Hand-picked anchors (venue-adjacent zones, etc.) always included first.
SEED_ITEMS: list[dict] = [
    {
        "name": "Van Andel Arena zone",
        "location": {"latitude": 42.9608, "longitude": -85.67369},
        "availability": (
            "End your ride in the designated zone in the Lime app to avoid fees"
        ),
    },
]


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    to_rad = math.pi / 180.0
    r = 3959.0
    d_lat = (lat2 - lat1) * to_rad
    d_lon = (lon2 - lon1) * to_rad
    a = math.sin(d_lat / 2) ** 2 + math.cos(lat1 * to_rad) * math.cos(
        lat2 * to_rad
    ) * math.sin(d_lon / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1 - a)))


def http_get_json(url: str) -> dict:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        return json.loads(resp.read().decode())


def cluster_items(
    bikes: list[dict], grid_deg: float, min_vehicles: int
) -> list[dict]:
    cells: dict[tuple[int, int], list[tuple[float, float]]] = defaultdict(list)
    for b in bikes:
        lat = float(b["lat"])
        lon = float(b["lon"])
        key = (int(lat / grid_deg), int(lon / grid_deg))
        cells[key].append((lat, lon))

    out: list[dict] = []
    for _key, pts in cells.items():
        if len(pts) < min_vehicles:
            continue
        avg_lat = sum(p[0] for p in pts) / len(pts)
        avg_lon = sum(p[1] for p in pts) / len(pts)
        n = len(pts)
        out.append(
            {
                "name": "Lime parking area (approx.)",
                "location": {
                    "latitude": round(avg_lat, 5),
                    "longitude": round(avg_lon, 5),
                },
                "availability": (
                    f"About {n} Lime vehicles nearby in public GBFS—common end-ride "
                    "spots, not official zone polygons. Use the Lime app for "
                    "designated parking."
                ),
            }
        )
    return out


def dedupe_against_seeds(
    clustered: list[dict], seeds: list[dict], min_sep_miles: float
) -> list[dict]:
    seed_coords = [
        (float(s["location"]["latitude"]), float(s["location"]["longitude"]))
        for s in seeds
        if s.get("location")
    ]
    kept: list[dict] = []
    for item in clustered:
        loc = item.get("location") or {}
        lat, lon = loc.get("latitude"), loc.get("longitude")
        if lat is None or lon is None:
            continue
        too_close = False
        for slat, slon in seed_coords:
            if haversine_miles(float(lat), float(lon), slat, slon) < min_sep_miles:
                too_close = True
                break
        if not too_close:
            kept.append(item)
    return kept


def sort_items(items: list[dict]) -> list[dict]:
    return sorted(
        items,
        key=lambda x: (
            float((x.get("location") or {}).get("latitude") or 0),
            float((x.get("location") or {}).get("longitude") or 0),
        ),
    )


def main() -> int:
    grid_deg = 0.003
    min_vehicles = 4
    if len(sys.argv) >= 2:
        grid_deg = float(sys.argv[1])
    if len(sys.argv) >= 3:
        min_vehicles = int(sys.argv[2])
    if len(sys.argv) > 3:
        print(
            "Usage: fetch_lime_parking.py [grid_deg] [min_vehicles]",
            file=sys.stderr,
        )
        return 1

    try:
        body = http_get_json(GBFS_FREE_BIKE)
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as e:
        print(f"Lime GBFS request failed: {e}", file=sys.stderr)
        return 1

    bikes = body.get("data", {}).get("bikes") or []
    usable = [
        b
        for b in bikes
        if isinstance(b, dict)
        and b.get("vehicle_type") in ("scooter", "e-bike")
        and not b.get("is_disabled")
    ]
    clustered = cluster_items(usable, grid_deg, min_vehicles)
    clustered = dedupe_against_seeds(clustered, SEED_ITEMS, min_sep_miles=0.04)

    items = [*SEED_ITEMS, *sort_items(clustered)]
    note = (
        "Generated by scripts/fetch_lime_parking.py from Lime partner "
        "GBFS (free_bike_status, Grand Rapids). Points are grid-cluster centroids "
        "of available scooters and e-bikes—useful as approximate parking activity, "
        "not as legal corral geometry. Designated zones appear in the Lime app. "
        f"Grid≈{grid_deg}°, min {min_vehicles} vehicles per cell. "
        "https://www.li.me/gbfs-terms"
    )
    doc = {
        "name": "Micromobility Lots",
        "modes": ["micromobility"],
        "note": note,
        "items": items,
    }
    OUT_PATH.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {len(items)} locations ({len(SEED_ITEMS)} seed + "
        f"{len(clustered)} clusters) -> {OUT_PATH.relative_to(REPO_ROOT)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
