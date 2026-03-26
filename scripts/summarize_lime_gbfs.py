#!/usr/bin/env python

"""
Fetch Lime partner GBFS for a city slug (default: grand_rapids), summarize each
feed (counts / keys), and write a JSON report under tmp/.

Primary URL pattern (per MobilityData systems.csv):
  https://data.lime.bike/api/partners/v2/gbfs/<slug>/gbfs.json

The report shows which feeds are present and non-empty. Lime’s US partner GBFS
often exposes only a single placeholder station, not per-corral parking; see
grand_rapids_context in the report for local follow-ups.

Usage:
  python scripts/summarize_lime_gbfs.py [slug]

Example:
  python scripts/summarize_lime_gbfs.py grand_rapids
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

GBFS_BASE = "https://data.lime.bike/api/partners/v2/gbfs"
REPO_ROOT = Path(__file__).resolve().parent.parent


def report_path_for_slug(slug: str) -> Path:
    return REPO_ROOT / "tmp" / f"lime_gbfs_{slug}_report.json"

USER_AGENT = "multimodality-summarize-lime-gbfs/1.0 (+https://github.com/citizenlabs/multimodality)"

# Pointers for Grand Rapids–specific parking / micromobility data outside GBFS.
GR_CONTEXT = {
    "lime_partner_gbfs_index": f"{GBFS_BASE}/grand_rapids/gbfs.json",
    "mobilitydata_catalog": (
        "https://raw.githubusercontent.com/MobilityData/gbfs/master/systems.csv"
    ),
    "city_shared_micromobility": (
        "https://www.grandrapidsmi.gov/departments/mobile-gr/mobility/"
        "shared-micromobility/"
    ),
    "city_open_data_portal": (
        "https://www.grandrapidsmi.gov/Government/Open-Data-Portal"
    ),
    "grdata_arcgis_hub": "https://grdata-grandrapids.opendata.arcgis.com/",
    "notes": (
        "City pages describe designated parking zones for the Lime program; "
        "corral geometries may appear on GRData or only in operator/city "
        "systems—search the hub for micromobility, scooter, or parking layers."
    ),
}


def http_get_json(url: str, timeout: int = 60) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def summarize_feed_body(name: str, body: dict[str, Any]) -> dict[str, Any]:
    """Return a small summary dict for one GBFS feed JSON object."""
    out: dict[str, Any] = {
        "version": body.get("version"),
        "last_updated": body.get("last_updated"),
        "ttl": body.get("ttl"),
    }
    data = body.get("data")
    if not isinstance(data, dict):
        out["data_type"] = type(data).__name__
        return out

    out["data_top_level_keys"] = sorted(data.keys())

    if name == "system_information":
        sys_info = {k: data[k] for k in data if k != "rental_uris"}
        out["system_information_fields"] = sys_info
        return out

    if name == "station_information":
        stations = data.get("stations")
        if isinstance(stations, list):
            out["stations_count"] = len(stations)
            if stations:
                first = stations[0]
                if isinstance(first, dict):
                    out["sample_station_keys"] = sorted(first.keys())
                    out["sample_station_id"] = first.get("station_id")
                    out["sample_name"] = first.get("name")
        return out

    if name == "station_status":
        stations = data.get("stations")
        if isinstance(stations, list):
            out["stations_count"] = len(stations)
        return out

    if name == "free_bike_status":
        bikes = data.get("bikes")
        if isinstance(bikes, list):
            out["bikes_count"] = len(bikes)
            types: dict[str, int] = {}
            for b in bikes:
                if not isinstance(b, dict):
                    continue
                vt = b.get("vehicle_type") or b.get("vehicle_type_id") or "unknown"
                types[str(vt)] = types.get(str(vt), 0) + 1
            if types:
                out["vehicle_type_counts"] = dict(sorted(types.items()))
        return out

    if name == "vehicle_types":
        vtypes = data.get("vehicle_types")
        if isinstance(vtypes, list):
            out["vehicle_types_count"] = len(vtypes)
            if vtypes and isinstance(vtypes[0], dict):
                out["sample_vehicle_type_keys"] = sorted(vtypes[0].keys())
        return out

    # geofencing_zones or other feeds: shallow summary
    for key, label in (
        ("stations", "stations_count"),
        ("bikes", "bikes_count"),
        ("vehicles", "vehicles_count"),
        ("zones", "zones_count"),
        ("features", "features_count"),
    ):
        val = data.get(key)
        if isinstance(val, list):
            out[label] = len(val)
    return out


def fetch_feed_summary(name: str, url: str) -> dict[str, Any]:
    row: dict[str, Any] = {"name": name, "url": url, "ok": False}
    try:
        body = http_get_json(url)
    except urllib.error.HTTPError as e:
        row["error"] = f"HTTP {e.code}"
        return row
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as e:
        row["error"] = str(e)
        return row

    row["ok"] = True
    row["summary"] = summarize_feed_body(name, body)
    return row


def main() -> int:
    slug = "grand_rapids"
    if len(sys.argv) == 2:
        slug = sys.argv[1].strip().lower().replace("-", "_")
    elif len(sys.argv) > 2:
        print("Usage: summarize_lime_gbfs.py [slug]", file=sys.stderr)
        return 1

    index_url = f"{GBFS_BASE}/{slug}/gbfs.json"
    print(f"Lime GBFS — {slug}")
    print(f"Index: {index_url}")
    print()

    try:
        index = http_get_json(index_url)
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as e:
        print(f"Failed to fetch GBFS index: {e}", file=sys.stderr)
        return 1

    feeds_meta: list[dict[str, str]] = []
    data = index.get("data") or {}
    if isinstance(data, dict) and "en" in data:
        en = data["en"]
        if isinstance(en, dict):
            raw_feeds = en.get("feeds") or []
            for f in raw_feeds:
                if isinstance(f, dict) and f.get("name") and f.get("url"):
                    feeds_meta.append(
                        {"name": str(f["name"]), "url": str(f["url"])}
                    )
    if not feeds_meta:
        print("No feeds[] found under data.en.feeds; raw index keys:", file=sys.stderr)
        print(list(data.keys()) if isinstance(data, dict) else type(data), file=sys.stderr)
        return 1

    feed_rows: list[dict[str, Any]] = []
    for fm in feeds_meta:
        row = fetch_feed_summary(fm["name"], fm["url"])
        feed_rows.append(row)
        if row.get("ok"):
            s = row.get("summary") or {}
            bits: list[str] = []
            for key in (
                "stations_count",
                "bikes_count",
                "vehicles_count",
                "zones_count",
                "features_count",
                "vehicle_types_count",
            ):
                if key in s:
                    bits.append(f"{key}={s[key]}")
            if "vehicle_type_counts" in s:
                bits.append(f"vehicle_types={s['vehicle_type_counts']}")
            extra = f" ({', '.join(bits)})" if bits else ""
            print(f"  OK  {fm['name']}{extra}")
        else:
            print(f"  ERR {fm['name']}: {row.get('error', 'unknown')}")

    report: dict[str, Any] = {
        "slug": slug,
        "gbfs_index_url": index_url,
        "fetched_at_utc": datetime.now(timezone.utc).isoformat(),
        "index_last_updated": index.get("last_updated"),
        "index_version": index.get("version"),
        "feeds": feed_rows,
    }
    if slug == "grand_rapids":
        report["grand_rapids_context"] = GR_CONTEXT

    out_path = report_path_for_slug(slug)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print()
    print(f"Wrote {out_path.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
