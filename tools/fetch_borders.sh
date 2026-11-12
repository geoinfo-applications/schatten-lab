#!/usr/bin/env bash
# Canton polygons (swissBOUNDARIES3D via the geo.admin API) for every canton touching the terrain window -> sources/kantone.json
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p sources
curl -sf -m 120 -o sources/kantone.json \
  "https://api3.geo.admin.ch/rest/services/api/MapServer/identify?geometryType=esriGeometryEnvelope&geometry=2682000,1188000,2772000,1290000&layers=all:ch.swisstopo.swissboundaries3d-kanton-flaeche.fill&tolerance=0&returnGeometry=true&geometryFormat=geojson&sr=2056&limit=50"
echo "sources/kantone.json: $(python3 -c 'import json; print(len(json.load(open("sources/kantone.json"))["results"]))') cantons"
