#!/usr/bin/env python3
"""One-shot: convert legacy string `pricing` tiers in JSON to float / [low, high]."""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from parking_pricing_schema import migrate_pricing_object  # noqa: E402

TARGETS = [
    REPO_ROOT / "data/parking/public/garages-arcgis.json",
    REPO_ROOT / "data/parking/public/lots-arcgis.json",
    REPO_ROOT / "data/parking/public/meters.json",
    REPO_ROOT / "data/parking/private/garages-ellis.json",
    REPO_ROOT / "data/parking/private/lots-ellis.json",
    REPO_ROOT / "data/overrides.json",
]


def migrate_file(path: Path) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    if path.name == "overrides.json":
        items = data
        for item in items:
            if isinstance(item.get("pricing"), dict):
                item["pricing"] = migrate_pricing_object(item["pricing"])
        path.write_text(
            json.dumps(items, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return
    for item in data.get("items") or []:
        if isinstance(item.get("pricing"), dict):
            item["pricing"] = migrate_pricing_object(item["pricing"])
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    for path in TARGETS:
        if not path.is_file():
            print(f"skip {path}")
            continue
        migrate_file(path)
        print(f"migrated {path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
