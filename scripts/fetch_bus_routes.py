#!/usr/bin/env python3

"""
Download The Rapid's official GTFS static feed and extract downtown Grand Rapids
bus routes: polylines from shapes.txt and stop locations from stops.txt. Stops in
the JSON are limited to within STOP_MAX_MILES_FROM_CITY_CENTER (1.5 mi) of
downtown center; route shapes are not clipped.

Routes are split into:
  * dash_routes — DASH (Downtown Area Shuttle), identified by "DASH" in route names.
  * rapid_routes — other The Rapid bus lines (same GTFS route_type) that serve
    downtown by stop location and/or pass through downtown on a shape polyline.

Dataset (full agency feed; we filter geographically and by mode):
  http://connect.ridetherapid.org/InfoPoint/gtfs-zip.ashx

Catalog / mirror context:
  https://www.transit.land/feeds/f-dpe-therapid

Writes data/bus/routes.json

Usage:
  python3 scripts/fetch_bus_routes.py
  python3 scripts/fetch_bus_routes.py --radius-miles 1.75
  python3 scripts/fetch_bus_routes.py --dry-run
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import sys
import urllib.error
import urllib.request
import zipfile
from collections import defaultdict
from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_GTFS_URL = "http://connect.ridetherapid.org/InfoPoint/gtfs-zip.ashx"

# Downtown Grand Rapids — same center as scripts/fetch_bike_parking.py
GR_CENTER_LAT = 42.96333
GR_CENTER_LON = -85.66806
DEFAULT_DOWNTOWN_RADIUS_MILES = 1.65
# Exported stop markers only (tighter than route eligibility); matches data view filter.
STOP_MAX_MILES_FROM_CITY_CENTER = 1.5

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "data/bus/routes.json"

USER_AGENT = "multimodality-fetch-bus-routes/1.0 (+https://github.com/citizenlabs/multimodality)"


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    to_rad = math.pi / 180.0
    r = 3959.0
    d_lat = (lat2 - lat1) * to_rad
    d_lon = (lon2 - lon1) * to_rad
    a = math.sin(d_lat / 2) ** 2 + math.cos(lat1 * to_rad) * math.cos(
        lat2 * to_rad
    ) * math.sin(d_lon / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1 - a)))


def fetch_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def iter_dict_rows_from_zip(z: zipfile.ZipFile, member: str) -> Iterator[dict[str, str]]:
    with z.open(member, "r") as raw:
        text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
        yield from csv.DictReader(text)


def is_dash_route(row: dict[str, str]) -> bool:
    parts = [
        row.get("route_long_name") or "",
        row.get("route_desc") or "",
        row.get("route_short_name") or "",
    ]
    return any("DASH" in p.upper() for p in parts)


def is_bus_route(row: dict[str, str]) -> bool:
    # GTFS route_type: 3 = bus (The Rapid local feed uses 3 for these lines)
    try:
        return int(str(row.get("route_type", "")).strip()) == 3
    except ValueError:
        return False


def build_route_outputs(
    route_rows: list[dict[str, str]],
    shapes_seen_per_route: dict[str, list[str]],
    shape_points: dict[str, list[tuple[int, float, float]]],
    stops_by_id: dict[str, dict[str, str]],
    stop_ids_by_route: dict[str, set[str]],
) -> list[dict]:
    out: list[dict] = []
    for r in sorted(route_rows, key=lambda x: (x.get("route_sort_order") or "", x["route_id"])):
        rid = r["route_id"]
        shapes_out = []
        for shape_id in shapes_seen_per_route.get(rid, []):
            pts = shape_points.get(shape_id, [])
            pts.sort(key=lambda x: x[0])
            coords = [{"latitude": la, "longitude": lo} for _, la, lo in pts]
            if coords:
                shapes_out.append({"shape_id": shape_id, "coordinates": coords})

        stops_out = []
        for stop_id in sorted(stop_ids_by_route.get(rid, ())):
            s = stops_by_id.get(stop_id)
            if not s:
                continue
            try:
                lat = float(s["stop_lat"])
                lon = float(s["stop_lon"])
            except (KeyError, ValueError):
                continue
            if (
                haversine_miles(GR_CENTER_LAT, GR_CENTER_LON, lat, lon)
                > STOP_MAX_MILES_FROM_CITY_CENTER
            ):
                continue
            stops_out.append(
                {
                    "stop_id": stop_id,
                    "name": (s.get("stop_name") or "").strip() or stop_id,
                    "latitude": lat,
                    "longitude": lon,
                }
            )

        out.append(
            {
                "route_id": rid,
                "route_short_name": (r.get("route_short_name") or "").strip(),
                "route_long_name": (r.get("route_long_name") or "").strip(),
                "route_color": (r.get("route_color") or "").strip(),
                "shapes": shapes_out,
                "stops": stops_out,
            }
        )
    return out


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fetch downtown Grand Rapids bus routes from The Rapid GTFS (DASH vs Rapid).",
    )
    parser.add_argument(
        "--url",
        default=DEFAULT_GTFS_URL,
        help="GTFS zip URL (default: The Rapid InfoPoint static feed)",
    )
    parser.add_argument(
        "--radius-miles",
        type=float,
        default=DEFAULT_DOWNTOWN_RADIUS_MILES,
        help=f"Radius from downtown center to count as in-downtown (default: {DEFAULT_DOWNTOWN_RADIUS_MILES})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse only; print counts and skip writing JSON",
    )
    args = parser.parse_args()

    try:
        blob = fetch_bytes(args.url)
    except urllib.error.URLError as e:
        print(f"Download failed: {e}", file=sys.stderr)
        return 1

    z = zipfile.ZipFile(io.BytesIO(blob))
    names = z.namelist()
    for req in ("routes.txt", "trips.txt", "shapes.txt", "stops.txt", "stop_times.txt"):
        if req not in names:
            print(f"GTFS zip missing {req}", file=sys.stderr)
            return 1

    bus_routes = [row for row in iter_dict_rows_from_zip(z, "routes.txt") if is_bus_route(row)]
    bus_route_ids = {r["route_id"] for r in bus_routes}
    if not bus_route_ids:
        print("No bus routes (route_type=3) in feed.", file=sys.stderr)
        return 1

    stops_by_id = {s["stop_id"]: s for s in iter_dict_rows_from_zip(z, "stops.txt")}
    downtown_stop_ids: set[str] = set()
    for sid, s in stops_by_id.items():
        try:
            lat = float(s["stop_lat"])
            lon = float(s["stop_lon"])
        except (KeyError, ValueError):
            continue
        if haversine_miles(GR_CENTER_LAT, GR_CENTER_LON, lat, lon) <= args.radius_miles:
            downtown_stop_ids.add(sid)

    trips = [t for t in iter_dict_rows_from_zip(z, "trips.txt") if t.get("route_id") in bus_route_ids]
    trip_to_route: dict[str, str] = {}
    shapes_seen_per_route: dict[str, list[str]] = defaultdict(list)
    shape_order: dict[str, set[str]] = defaultdict(set)

    for t in trips:
        rid = t.get("route_id") or ""
        tid = (t.get("trip_id") or "").strip()
        if tid:
            trip_to_route[tid] = rid
        shp = (t.get("shape_id") or "").strip()
        if shp and shp not in shape_order[rid]:
            shapes_seen_per_route[rid].append(shp)
            shape_order[rid].add(shp)

    routes_with_downtown_stop: set[str] = set()
    for row in iter_dict_rows_from_zip(z, "stop_times.txt"):
        tid = (row.get("trip_id") or "").strip()
        rid = trip_to_route.get(tid)
        if rid is None:
            continue
        if (row.get("stop_id") or "").strip() in downtown_stop_ids:
            routes_with_downtown_stop.add(rid)

    downtown_shape_ids: set[str] = set()
    for row in iter_dict_rows_from_zip(z, "shapes.txt"):
        try:
            lat = float(row["shape_pt_lat"])
            lon = float(row["shape_pt_lon"])
        except (KeyError, ValueError):
            continue
        if haversine_miles(GR_CENTER_LAT, GR_CENTER_LON, lat, lon) <= args.radius_miles:
            sid = (row.get("shape_id") or "").strip()
            if sid:
                downtown_shape_ids.add(sid)

    routes_with_downtown_shape: set[str] = set()
    for t in trips:
        rid = t.get("route_id") or ""
        shp = (t.get("shape_id") or "").strip()
        if shp and shp in downtown_shape_ids:
            routes_with_downtown_shape.add(rid)

    eligible_route_ids = routes_with_downtown_stop | routes_with_downtown_shape
    if not eligible_route_ids:
        print("No routes intersect downtown radius.", file=sys.stderr)
        return 1

    stop_ids_by_route: dict[str, set[str]] = defaultdict(set)
    for row in iter_dict_rows_from_zip(z, "stop_times.txt"):
        tid = (row.get("trip_id") or "").strip()
        rid = trip_to_route.get(tid)
        if rid is None or rid not in eligible_route_ids:
            continue
        sid = (row.get("stop_id") or "").strip()
        if sid:
            stop_ids_by_route[rid].add(sid)

    shape_points: dict[str, list[tuple[int, float, float]]] = defaultdict(list)
    needed_shape_ids = set()
    for rid in eligible_route_ids:
        for s in shapes_seen_per_route.get(rid, []):
            needed_shape_ids.add(s)

    for row in iter_dict_rows_from_zip(z, "shapes.txt"):
        sid = (row.get("shape_id") or "").strip()
        if sid not in needed_shape_ids:
            continue
        try:
            seq = int(row["shape_pt_sequence"])
            lat = float(row["shape_pt_lat"])
            lon = float(row["shape_pt_lon"])
        except (KeyError, ValueError):
            continue
        shape_points[sid].append((seq, lat, lon))

    routes_by_id = {r["route_id"]: r for r in bus_routes}
    downtown_rows = [routes_by_id[rid] for rid in sorted(eligible_route_ids) if rid in routes_by_id]
    dash_rows = [r for r in downtown_rows if is_dash_route(r)]
    rapid_rows = [r for r in downtown_rows if not is_dash_route(r)]

    dash_out = build_route_outputs(
        dash_rows,
        dict(shapes_seen_per_route),
        shape_points,
        stops_by_id,
        stop_ids_by_route,
    )
    rapid_out = build_route_outputs(
        rapid_rows,
        dict(shapes_seen_per_route),
        shape_points,
        stops_by_id,
        stop_ids_by_route,
    )

    payload = {
        "meta": {
            "gtfs_static_url": args.url,
            "publisher": "The Rapid (Interurban Transit Partnership)",
            "reference": "https://www.transit.land/feeds/f-dpe-therapid",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "downtown_center": {
                "latitude": GR_CENTER_LAT,
                "longitude": GR_CENTER_LON,
            },
            "downtown_radius_miles": args.radius_miles,
            "filter_note": (
                "Bus routes (GTFS route_type=3) with at least one stop inside the "
                "radius and/or a scheduled shape vertex inside the radius."
            ),
            "stop_max_miles_from_city_center": STOP_MAX_MILES_FROM_CITY_CENTER,
            "stop_filter_note": (
                f"Stops listed per route are within {STOP_MAX_MILES_FROM_CITY_CENTER:g} mi "
                "of downtown center (polylines are not clipped)."
            ),
        },
        "dash_routes": dash_out,
        "rapid_routes": rapid_out,
    }

    if args.dry_run:
        print(
            f"Downtown radius: {args.radius_miles} mi from ({GR_CENTER_LAT}, {GR_CENTER_LON})"
        )
        print(f"Eligible downtown bus routes: {len(downtown_rows)}")
        print(f"  DASH: {len(dash_out)}")
        print(f"  Rapid (non-DASH): {len(rapid_out)}")
        for label, arr in ("DASH", dash_out), ("Rapid", rapid_out):
            for rr in arr:
                n_pts = sum(len(s["coordinates"]) for s in rr["shapes"])
                print(
                    f"  [{label}] {rr['route_id']} {rr['route_short_name']} — "
                    f"{len(rr['shapes'])} shape(s), {n_pts} polyline pts, {len(rr['stops'])} stops"
                )
        return 0

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {OUT_PATH.relative_to(REPO_ROOT)} "
        f"({len(dash_out)} DASH, {len(rapid_out)} Rapid)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
