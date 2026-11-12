"""Build the site data from the source files in sources/ (read only).

Writes into site/data/:
  far.dem.png                whole DEM extent (canton SG + 60 km) at 100 m, for long shadow rays
  near.dem.png               the rendered window at 50 m, for the 3D mesh and short rays
  borders.json               canton borders clipped to the window, simplified to 20 m, as LV95 polylines
  meta.json                  grids, grid convergence, Orte in the window with >= 100 inhabitants

usage: tools/fetch_borders.sh; python3 tools/build_data.py [<source dir, default sources/>]
"""
import csv
import json
import math
import struct
import sys
import zlib
from pathlib import Path

import numpy as np
from osgeo import gdal, ogr, osr

gdal.UseExceptions()
ogr.UseExceptions()

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "sources")
OUT = Path(__file__).resolve().parent.parent / "site/data"
FAR = {"cell": 100.0, "bounds": (2642000, 1133000, 2830000, 1329000)}
NEAR = {"cell": 50.0, "bounds": (2682000, 1188000, 2772000, 1290000)}
ORTE_MARGIN = 1000  # Orte at least 1 km inside the window


def png_chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def png_gray8(w, h, rows):
    head = struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0)
    idat = zlib.compress(rows.tobytes(), 9)
    return b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", head) + png_chunk(b"IDAT", idat) + png_chunk(b"IEND", b"")


def encode_dem(arr):
    """Same scheme as grueninger-night/tools/encode_dem.py: 0.1 m uint16, 2D predictor, low/high byte planes."""
    q = np.clip(np.round(arr * 10), 0, 65535).astype(np.int64)
    r = q.copy()
    r[:, 1:] -= q[:, :-1]
    r[1:, :] -= q[:-1, :]
    r[1:, 1:] += q[:-1, :-1]
    r = (r % 65536).astype(np.uint16)
    h, w = arr.shape
    planes = np.frombuffer(r.tobytes(), np.uint8).reshape(-1, 2).T.reshape(2 * h, w)
    rows = np.zeros((2 * h, w + 1), np.uint8)
    rows[:, 1:] = planes
    return png_gray8(w, 2 * h, rows)


def warp(src, grid):
    e0, n0, e1, n1 = grid["bounds"]
    ds = gdal.Warp("", str(src), format="MEM", outputBounds=(e0, n0, e1, n1), xRes=grid["cell"], yRes=grid["cell"],
                   resampleAlg="average")
    a = ds.ReadAsArray().astype(np.float64)
    a[~np.isfinite(a) | (a < -100) | (a > 6000)] = np.nan
    return np.where(np.isnan(a), np.nanmin(a), a)


def write_grid(name, grid, arr):
    blob = encode_dem(arr)
    (OUT / f"{name}.dem.png").write_bytes(blob)
    e0, n0, e1, n1 = grid["bounds"]
    meta = {"w": arr.shape[1], "h": arr.shape[0], "x0": e0, "y1": n1, "cell": grid["cell"],
            "min": round(float(arr.min()), 1), "max": round(float(arr.max()), 1), "bytes": len(blob)}
    print(name, json.dumps(meta))
    return meta


def borders(cantons):
    """Canton outlines as polylines inside the window. Shared edges appear twice; drawn faint, that does not show."""
    e0, n0, e1, n1 = NEAR["bounds"]
    window = ogr.CreateGeometryFromWkt(f"POLYGON(({e0} {n0},{e1} {n0},{e1} {n1},{e0} {n1},{e0} {n0}))")
    lines = []
    for canton in cantons:
        outline = canton["geometry"].GetBoundary().SimplifyPreserveTopology(20).Intersection(window)
        parts = [outline] if outline.GetGeometryType() in (ogr.wkbLineString, ogr.wkbLineString25D) else \
            [outline.GetGeometryRef(i) for i in range(outline.GetGeometryCount())]
        for part in parts:
            points = [[round(part.GetX(k)), round(part.GetY(k))] for k in range(part.GetPointCount())]
            if len(points) > 1:
                lines.append(points)
    (OUT / "borders.json").write_text(json.dumps(lines, separators=(",", ":")))
    print("borders", len(lines), "lines", sum(len(l) for l in lines), "points")


def load_cantons():
    data = json.loads((Path(__file__).resolve().parent.parent / "sources/kantone.json").read_text())
    return [{"ak": r["properties"]["ak"], "geometry": ogr.CreateGeometryFromJson(json.dumps(r["geometry"]))} for r in data["results"]]


def orte_in_window(cantons):
    """swissNAMES3D Objektart Ort with >= 100 inhabitants inside the window, one name per point (St. Gallen is listed in four
    languages; the official endonym wins), tagged with its canton."""
    pop = {"100 bis 999": 100, "1'000 bis 1'999": 1000, "2'000 bis 9'999": 2000, "10'000 bis 49'999": 10000,
           "50'000 bis 100'000": 50000, "> 100'000": 100000}
    e0, n0, e1, n1 = NEAR["bounds"]
    best = {}
    with open(SRC / "data/names/swissNAMES3D_PKT.csv", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle, delimiter=";"):
            if row["OBJEKTART"] != "Ort" or row["EINWOHNERKATEGORIE"] not in pop:
                continue
            e, n = float(row["E"]), float(row["N"])
            if not (e0 + ORTE_MARGIN < e < e1 - ORTE_MARGIN and n0 + ORTE_MARGIN < n < n1 - ORTE_MARGIN):
                continue
            rank = (row["STATUS"] == "offiziell") + (row["NAMEN_TYP"] == "Endonym")
            if (e, n) not in best or rank > best[(e, n)]["rank"]:
                best[(e, n)] = {"name": row["NAME"], "e": e, "n": n, "pop": pop[row["EINWOHNERKATEGORIE"]], "rank": rank}
    orte = list(best.values())
    for o in orte:
        point = ogr.Geometry(ogr.wkbPoint)
        point.AddPoint_2D(o["e"], o["n"])
        o["ak"] = next((c["ak"] for c in cantons if c["geometry"].Contains(point)), None)
    orte.sort(key=lambda o: (-o["pop"], o["name"]))
    return [{"name": o["name"], "e": o["e"], "n": o["n"], "pop": o["pop"], "ak": o["ak"]} for o in orte]


def convergence_deg(e, n):
    """Grid bearing of true north at (e, n), measured by projecting two points on one meridian. Positive = clockwise."""
    lv95 = osr.SpatialReference()
    lv95.ImportFromEPSG(2056)
    wgs = osr.SpatialReference()
    wgs.ImportFromEPSG(4326)
    wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    lv95.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    to_wgs = osr.CoordinateTransformation(lv95, wgs)
    to_lv95 = osr.CoordinateTransformation(wgs, lv95)
    lon, lat, _ = to_wgs.TransformPoint(e, n)
    a = to_lv95.TransformPoint(lon, lat - 0.05)
    b = to_lv95.TransformPoint(lon, lat + 0.05)
    return math.degrees(math.atan2(b[0] - a[0], b[1] - a[1])), lat, lon


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    dem = SRC / "data/dem25.tif"
    far = warp(dem, FAR)
    near = warp(dem, NEAR)
    far_meta = write_grid("far", FAR, far)
    near_meta = write_grid("near", NEAR, near)
    cantons = load_cantons()
    borders(cantons)

    centre = ((NEAR["bounds"][0] + NEAR["bounds"][2]) / 2, (NEAR["bounds"][1] + NEAR["bounds"][3]) / 2)
    centre_gamma, centre_lat, centre_lon = convergence_deg(*centre)
    print("centre", round(centre_gamma, 4), round(centre_lat, 4), round(centre_lon, 4))

    orte = orte_in_window(cantons)
    meta = {
        "near": near_meta, "far": far_meta,
        "sunSite": {"lat": round(centre_lat, 5), "lon": round(centre_lon, 5), "e": centre[0], "n": centre[1],
                    "convergenceDeg": round(centre_gamma, 4)},
        "orte": orte,
    }
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False))
    print("orte", len(orte), {ak: sum(1 for o in orte if str(o["ak"]) == ak) for ak in sorted({str(o["ak"]) for o in orte})})


if __name__ == "__main__":
    main()
