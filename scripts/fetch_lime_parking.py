#!/usr/bin/env python

"""
Regenerate data/parking/private/micromobility.json from Lime partner GBFS (Grand Rapids).

Official designated parking zones are not published as points in Lime’s GBFS for
this market (only a single placeholder station). We approximate high-traffic
parking by clustering current scooter and e-bike positions from
free_bike_status into a fixed lat/lon grid; centroids are *hints*, not legal
corral boundaries—riders should follow the Lime app.

Each successful fetch is stored under data/parking/.lime/ as w{weekday}_h{hour}.json
(weekday Monday=0..Sunday=6, hour 00–23, America/Detroit). Re-running in the same
bucket overwrites that file. micromobility.json is the merge of all bucket files:
seed anchors plus union of clustered points deduped by the same grid. Clustered
points and seeds are limited to within 1.75 mi of downtown Grand Rapids (same
radius as bicycle rack data).

Data: https://data.lime.bike/api/partners/v2/gbfs/grand_rapids/free_bike_status
Terms: https://www.li.me/gbfs-terms

Usage:
  python scripts/fetch_lime_parking.py [grid_deg] [min_vehicles]
  python scripts/fetch_lime_parking.py --merge-only [grid_deg]

Defaults: grid_deg=0.003 (~330 m), min_vehicles=4
"""

from __future__ import annotations

import json
import math
import re
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

GBFS_FREE_BIKE = (
    "https://data.lime.bike/api/partners/v2/gbfs/grand_rapids/free_bike_status"
)
REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "data/parking/private/micromobility.json"
RUNS_DIR = REPO_ROOT / "data/parking/.lime"
TZ = ZoneInfo("America/Detroit")
BUCKET_FILE_RE = re.compile(r"^w([0-6])_h([01][0-9]|2[0-3])\.json$")

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

CLUSTER_NAME = "Designated Parking Zone"

# Match scripts/fetch_bike_parking.py — downtown Grand Rapids
GR_CENTER_LAT = 42.96333
GR_CENTER_LON = -85.66806
MAX_MILES_FROM_CENTER = 1.75


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    to_rad = math.pi / 180.0
    r = 3959.0
    d_lat = (lat2 - lat1) * to_rad
    d_lon = (lon2 - lon1) * to_rad
    a = math.sin(d_lat / 2) ** 2 + math.cos(lat1 * to_rad) * math.cos(
        lat2 * to_rad
    ) * math.sin(d_lon / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1 - a)))


def miles_from_gr_center(lat: float, lon: float) -> float:
    return haversine_miles(lat, lon, GR_CENTER_LAT, GR_CENTER_LON)


def item_within_gr_center(item: dict) -> bool:
    loc = item.get("location") or {}
    lat, lon = loc.get("latitude"), loc.get("longitude")
    if lat is None or lon is None:
        return False
    return miles_from_gr_center(float(lat), float(lon)) <= MAX_MILES_FROM_CENTER


def seeds_in_gr_center() -> list[dict]:
    return [s for s in SEED_ITEMS if item_within_gr_center(s)]


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
                "name": CLUSTER_NAME,
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


def bucket_path(now: datetime) -> Path:
    """One file per (weekday, hour) in America/Detroit; Monday=0."""
    local = now.astimezone(TZ)
    w = local.weekday()
    h = local.hour
    return RUNS_DIR / f"w{w}_h{h:02d}.json"


def is_clustered_lime_item(item: dict) -> bool:
    return item.get("name") == CLUSTER_NAME and isinstance(
        item.get("location"), dict
    )


def iter_snapshot_paths() -> list[Path]:
    if not RUNS_DIR.is_dir():
        return []
    paths: list[Path] = []
    for p in sorted(RUNS_DIR.iterdir()):
        if p.is_file() and BUCKET_FILE_RE.match(p.name):
            paths.append(p)
    return paths


def merge_clustered_from_snapshots(grid_deg: float) -> list[dict]:
    """
    Union clustered centroids from all bucket files; collapse to one point per
    grid cell (average of all observations in that cell).
    """
    cells: dict[tuple[int, int], list[tuple[float, float]]] = defaultdict(list)
    for path in iter_snapshot_paths():
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        for item in doc.get("items") or []:
            if not is_clustered_lime_item(item):
                continue
            loc = item.get("location") or {}
            lat, lon = loc.get("latitude"), loc.get("longitude")
            if lat is None or lon is None:
                continue
            lat_f, lon_f = float(lat), float(lon)
            if miles_from_gr_center(lat_f, lon_f) > MAX_MILES_FROM_CENTER:
                continue
            key = (int(lat_f / grid_deg), int(lon_f / grid_deg))
            cells[key].append((lat_f, lon_f))

    merged: list[dict] = []
    for _key, pts in cells.items():
        avg_lat = sum(p[0] for p in pts) / len(pts)
        avg_lon = sum(p[1] for p in pts) / len(pts)
        merged.append(
            {
                "name": CLUSTER_NAME,
                "location": {
                    "latitude": round(avg_lat, 5),
                    "longitude": round(avg_lon, 5),
                },
                "availability": (
                    "Seen across multiple Lime GBFS samples at different times—"
                    "approximate parking activity, not official zones. Use the Lime app."
                ),
            }
        )
    return [m for m in merged if item_within_gr_center(m)]


def build_note(grid_deg: float, min_vehicles: int, n_buckets: int) -> str:
    runs_rel = RUNS_DIR.relative_to(REPO_ROOT)
    return (
        "Generated by scripts/fetch_lime_parking.py from Lime partner "
        "GBFS (free_bike_status, Grand Rapids). Points combine hand-picked zones "
        f"with grid-cluster centroids from snapshots in {runs_rel}/ "
        f"({n_buckets} weekday×hour buckets, America/Detroit)—useful as approximate "
        "parking activity, not as legal corral geometry. Designated zones appear "
        "in the Lime app. "
        f"Locations within {MAX_MILES_FROM_CENTER:g} mi of downtown "
        f"({GR_CENTER_LAT:.5f}, {GR_CENTER_LON:.5f}), matching bicycle rack coverage. "
        f"Grid≈{grid_deg}°, min {min_vehicles} vehicles per cell per fetch. "
        "https://www.li.me/gbfs-terms"
    )


def write_merged_output(grid_deg: float, min_vehicles: int) -> tuple[int, int, int]:
    """Returns (n_seeds, n_merged_clusters, n_bucket_files)."""
    seeds = seeds_in_gr_center()
    clustered = merge_clustered_from_snapshots(grid_deg)
    clustered = dedupe_against_seeds(clustered, seeds, min_sep_miles=0.04)
    items = [*seeds, *sort_items(clustered)]
    n_buckets = len(iter_snapshot_paths())
    doc = {
        "name": "Micromobility Lots",
        "modes": ["micromobility"],
        "note": build_note(grid_deg, min_vehicles, n_buckets),
        "items": items,
    }
    OUT_PATH.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    return len(seeds), len(clustered), n_buckets


def main() -> int:
    grid_deg = 0.003
    min_vehicles = 4
    args = [a for a in sys.argv[1:] if a]
    merge_only = False
    if args and args[0] == "--merge-only":
        merge_only = True
        args = args[1:]
    if len(args) >= 1:
        grid_deg = float(args[0])
    if len(args) >= 2:
        min_vehicles = int(args[1])
    if len(args) > 2:
        print(
            "Usage: fetch_lime_parking.py [--merge-only] [grid_deg] [min_vehicles]",
            file=sys.stderr,
        )
        return 1

    if merge_only:
        n_seeds, n_clusters, n_buckets = write_merged_output(grid_deg, min_vehicles)
        if n_buckets == 0:
            print(
                f"No bucket files in {RUNS_DIR.relative_to(REPO_ROOT)}; "
                "nothing to merge.",
                file=sys.stderr,
            )
            return 1
        print(
            f"Merged {n_buckets} bucket(s) -> {n_seeds + n_clusters} locations "
            f"({n_seeds} seed + {n_clusters} clusters) -> "
            f"{OUT_PATH.relative_to(REPO_ROOT)}"
        )
        return 0

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
    clustered = [c for c in clustered if item_within_gr_center(c)]
    seeds = seeds_in_gr_center()
    clustered = dedupe_against_seeds(clustered, seeds, min_sep_miles=0.04)

    items = [*seeds, *sort_items(clustered)]
    now = datetime.now(TZ)
    bucket_file = bucket_path(now)
    RUNS_DIR.mkdir(parents=True, exist_ok=True)

    note = (
        "Generated by scripts/fetch_lime_parking.py from Lime partner "
        "GBFS (free_bike_status, Grand Rapids). Points are grid-cluster centroids "
        "of available scooters and e-bikes—useful as approximate parking activity, "
        "not as legal corral geometry. Designated zones appear in the Lime app. "
        f"Clustered points within {MAX_MILES_FROM_CENTER:g} mi of downtown "
        f"({GR_CENTER_LAT:.5f}, {GR_CENTER_LON:.5f}). "
        f"Grid≈{grid_deg}°, min {min_vehicles} vehicles per cell. "
        "https://www.li.me/gbfs-terms"
    )
    snapshot = {
        "name": "Micromobility Lots",
        "modes": ["micromobility"],
        "note": note,
        "items": items,
        "_meta": {
            "captured_at": now.isoformat(),
            "bucket_weekday": now.weekday(),
            "bucket_hour": now.hour,
            "timezone": "America/Detroit",
        },
    }
    bucket_file.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")

    n_seeds, n_merged_clusters, n_buckets = write_merged_output(grid_deg, min_vehicles)
    print(
        f"Wrote bucket {bucket_file.relative_to(REPO_ROOT)} "
        f"({len(items)} locations: {len(seeds)} seed + {len(clustered)} clusters)"
    )
    print(
        f"Merged {n_buckets} bucket(s) -> {n_seeds + n_merged_clusters} locations "
        f"({n_seeds} seed + {n_merged_clusters} merged clusters) -> "
        f"{OUT_PATH.relative_to(REPO_ROOT)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
