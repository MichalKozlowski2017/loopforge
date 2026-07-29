#!/usr/bin/env python3
"""Download BRouter .rd5 segments (poland / italy / europe / planet)."""

from __future__ import annotations

import os
import re
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

BASE_URL = os.environ.get(
    "BROUTER_SEGMENTS_BASE_URL", "https://brouter.de/brouter/segments4"
).rstrip("/")
SEG_DIR = Path(os.environ.get("BROUTER_SEGMENTS_DIR", "infra/brouter/segments4"))
MODE = os.environ.get("BROUTER_SEGMENTS_MODE", "planet")
JOBS = max(1, int(os.environ.get("BROUTER_DOWNLOAD_JOBS", "4")))
EXPLICIT = [f for f in os.environ.get("BROUTER_SEGMENT_FILES", "").split() if f]

NAME_RE = re.compile(r"([EW])(\d+)_([NS])(\d+)\.rd5")


def parse_corner(name: str) -> tuple[int, int]:
    m = NAME_RE.fullmatch(name)
    if not m:
        raise ValueError(name)
    hemi_lon, lon_s, hemi_lat, lat_s = m.groups()
    lon = int(lon_s) if hemi_lon == "E" else -int(lon_s)
    lat = int(lat_s) if hemi_lat == "N" else -int(lat_s)
    return lon, lat


def list_planet() -> list[str]:
    with urllib.request.urlopen(f"{BASE_URL}/", timeout=60) as resp:
        html = resp.read().decode("utf-8", errors="replace")
    return sorted(set(re.findall(r"[EW]\d+_[NS]\d+\.rd5", html)))


def filter_bbox(
    names: list[str], min_lon: int, max_lon: int, min_lat: int, max_lat: int
) -> list[str]:
    out: list[str] = []
    for name in names:
        lon, lat = parse_corner(name)
        if min_lon <= lon <= max_lon and min_lat <= lat <= max_lat:
            out.append(name)
    return out


def resolve_files() -> list[str]:
    if MODE in ("poland", "minimal"):
        if not EXPLICIT:
            raise SystemExit(f"{MODE} mode requires BROUTER_SEGMENT_FILES")
        return EXPLICIT
    planet = list_planet()
    if MODE == "planet":
        return planet
    if MODE == "italy":
        return filter_bbox(planet, 5, 15, 35, 45)
    if MODE == "europe":
        return filter_bbox(planet, -15, 40, 35, 70)
    raise SystemExit(f"Unknown mode: {MODE}")


def download_one(name: str) -> tuple[str, str]:
    dest = SEG_DIR / name
    if dest.is_file() and dest.stat().st_size > 0:
        return name, "skip"
    url = f"{BASE_URL}/{name}"
    partial = dest.with_suffix(dest.suffix + ".partial")
    try:
        with urllib.request.urlopen(url, timeout=180) as resp, open(
            partial, "wb"
        ) as out:
            while True:
                chunk = resp.read(1024 * 256)
                if not chunk:
                    break
                out.write(chunk)
        partial.replace(dest)
        return name, "ok"
    except (urllib.error.URLError, OSError, TimeoutError) as err:
        try:
            partial.unlink(missing_ok=True)
        except OSError:
            pass
        return name, f"fail:{err}"


def main() -> int:
    SEG_DIR.mkdir(parents=True, exist_ok=True)
    files = resolve_files()
    print(f"→ {MODE}: {len(files)} plików, jobs={JOBS}, dest={SEG_DIR}")

    ok = skip = fail = 0
    failures: list[str] = []
    done = 0

    with ThreadPoolExecutor(max_workers=JOBS) as pool:
        futures = {pool.submit(download_one, name): name for name in files}
        for fut in as_completed(futures):
            name, status = fut.result()
            done += 1
            if status == "ok":
                ok += 1
                print(f"  ✓ {name}")
            elif status == "skip":
                skip += 1
            else:
                fail += 1
                failures.append(f"{name} ({status})")
                print(f"  ✗ {name} — {status}")
            if done % 50 == 0 or done == len(files):
                print(f"  … {done}/{len(files)} (ok={ok} skip={skip} fail={fail})")

    print(f"✓ gotowe: ok={ok} skip={skip} fail={fail}")
    if failures:
        print("Błędy:")
        for line in failures[:20]:
            print(f"  - {line}")
        if len(failures) > 20:
            print(f"  … i {len(failures) - 20} więcej")
        print("Uruchom ponownie ten sam setup, żeby dociągnąć braki.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
