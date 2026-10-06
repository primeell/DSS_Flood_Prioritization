"""Build a lightweight, dependency-free GeoJSON asset for the PRIORA dashboard.

The source boundary is intentionally read-only. This script parses the ESRI
Shapefile and DBF formats with Python's standard library, simplifies rings for
web display, and writes a compact dashboard-only derivative.
"""

from __future__ import annotations

import argparse
import json
import math
import struct
from pathlib import Path


def read_dbf(path: Path) -> list[dict[str, str]]:
    with path.open("rb") as handle:
        header = handle.read(32)
        record_count = struct.unpack("<I", header[4:8])[0]
        header_length = struct.unpack("<H", header[8:10])[0]
        record_length = struct.unpack("<H", header[10:12])[0]

        fields: list[tuple[str, int]] = []
        while True:
            descriptor = handle.read(32)
            if descriptor[0] == 0x0D:
                break
            name = descriptor[:11].replace(b"\x00", b"").decode("latin-1").strip()
            fields.append((name, descriptor[16]))

        handle.seek(header_length)
        rows: list[dict[str, str]] = []
        for _ in range(record_count):
            record = handle.read(record_length)
            if not record or record[0:1] == b"*":
                rows.append({})
                continue
            cursor = 1
            row: dict[str, str] = {}
            for name, length in fields:
                raw = record[cursor : cursor + length]
                row[name] = raw.decode("utf-8", errors="replace").replace("\x00", "").strip()
                cursor += length
            rows.append(row)
    return rows


def point_line_distance(point, start, end) -> float:
    px, py = point
    sx, sy = start
    ex, ey = end
    dx, dy = ex - sx, ey - sy
    if dx == 0 and dy == 0:
        return math.hypot(px - sx, py - sy)
    t = max(0.0, min(1.0, ((px - sx) * dx + (py - sy) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (sx + t * dx), py - (sy + t * dy))


def douglas_peucker(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    if len(points) <= 2:
        return points
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        max_distance = 0.0
        index = -1
        for idx in range(start + 1, end):
            distance = point_line_distance(points[idx], points[start], points[end])
            if distance > max_distance:
                index, max_distance = idx, distance
        if index >= 0 and max_distance > tolerance:
            keep.add(index)
            stack.append((start, index))
            stack.append((index, end))
    return [points[idx] for idx in sorted(keep)]


def simplify_ring(points: list[tuple[float, float]], tolerance: float) -> list[list[float]]:
    if len(points) < 4:
        return []
    if points[0] == points[-1]:
        points = points[:-1]
    if len(points) < 3:
        return []

    anchor = 0
    opposite = max(range(1, len(points)), key=lambda idx: math.dist(points[anchor], points[idx]))
    first_chain = points[anchor : opposite + 1]
    second_chain = points[opposite:] + [points[anchor]]
    simplified = douglas_peucker(first_chain, tolerance)[:-1] + douglas_peucker(second_chain, tolerance)

    deduplicated: list[tuple[float, float]] = []
    for point in simplified:
        rounded = (round(point[0], 4), round(point[1], 4))
        if not deduplicated or rounded != deduplicated[-1]:
            deduplicated.append(rounded)
    if len(deduplicated) < 3:
        return []
    if deduplicated[0] != deduplicated[-1]:
        deduplicated.append(deduplicated[0])
    return [[x, y] for x, y in deduplicated]


def read_shapes(path: Path, tolerance: float):
    with path.open("rb") as handle:
        handle.seek(100)
        while True:
            record_header = handle.read(8)
            if not record_header:
                break
            _, length_words = struct.unpack(">2i", record_header)
            payload = handle.read(length_words * 2)
            shape_type = struct.unpack("<i", payload[:4])[0]
            if shape_type == 0:
                yield []
                continue
            if shape_type not in (5, 15, 25):
                raise ValueError(f"Unsupported polygon shape type: {shape_type}")
            part_count, point_count = struct.unpack("<2i", payload[36:44])
            part_offset = 44
            parts = list(struct.unpack(f"<{part_count}i", payload[part_offset : part_offset + 4 * part_count]))
            points_offset = part_offset + 4 * part_count
            points = [
                struct.unpack("<2d", payload[points_offset + idx * 16 : points_offset + (idx + 1) * 16])
                for idx in range(point_count)
            ]
            parts.append(point_count)
            rings = []
            for idx in range(part_count):
                ring = simplify_ring(points[parts[idx] : parts[idx + 1]], tolerance)
                if ring:
                    rings.append([ring])
            yield rings


def build_geojson(shp_path: Path, output_path: Path, tolerance: float) -> None:
    rows = read_dbf(shp_path.with_suffix(".dbf"))
    shapes = list(read_shapes(shp_path, tolerance))
    if len(rows) != len(shapes):
        raise RuntimeError(f"DBF/SHP record mismatch: {len(rows)} vs {len(shapes)}")

    features = []
    for row, polygons in zip(rows, shapes):
        region_id = row.get("KODE_KK", "").strip()
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "region_id": region_id,
                    "province": row.get("PROVINSI", "").strip(),
                    "district": row.get("KAB_KOTA", "").strip(),
                },
                "geometry": {"type": "MultiPolygon", "coordinates": polygons},
            }
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump({"type": "FeatureCollection", "features": features}, handle, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {len(features)} features to {output_path} ({output_path.stat().st_size:,} bytes)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("shapefile", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--tolerance", type=float, default=0.012, help="Simplification tolerance in source CRS degrees")
    args = parser.parse_args()
    build_geojson(args.shapefile, args.output, args.tolerance)


if __name__ == "__main__":
    main()
