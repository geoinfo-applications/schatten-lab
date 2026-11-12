# Schatten-Lab

**Jetzt gerade im Schatten**: a map for the #30DayMapChallenge 2026, day 17 "Light & dark", by GEOINFO. Eastern
Switzerland in 3D, drawn only as light and shadow, with the shadows the terrain really casts at the
sun position of right now (Europe/Zurich). It re-renders every minute and counts the Orte in shadow.

- `?t=2026-11-17T09:30` fixes the time (Zurich wall time).
- Every swissNAMES3D Ort with at least 100 inhabitants inside the rendered terrain (848, any canton, plus
  Liechtenstein), and faint canton borders.

Plain WebGL2 and ES modules, no build step, no CDN library. The site is about 8 MB, data included.

## Run

```bash
python3 tools/serve.py 8871      # serves site/ without caching
# http://127.0.0.1:8871/
```

Any static server works; `serve.py` only adds `Cache-Control: no-store`.

## How the shadows are computed

- Terrain: swissALTIRegio, resampled (average) to 50 m over the rendered window E 2682000–2772000, N 1188000–1290000
  (`near`) and to 100 m over canton SG plus 60 km (`far`, E 2642000–2830000, N 1133000–1329000). Rays from the west edge
  of the window leave the far grid after about 40 km westward and count as lit from there.
- Sun: NOAA/Meeus algorithm with Bennett refraction (10 °C, 1010 hPa), at one site for the whole window
  (window centre, 47.2897 N, 9.1176 E). True azimuth is turned into LV95 grid bearing by the measured convergence, −1.23°.
- Ray: from 2 m above the ground toward the sun, first 50 m steps, then steps of 1.5 % of the distance, up to 60 km.
  Earth curvature with refraction coefficient k = 0.13: terrain drops by d²/(2R/(1−k)). Inside the 50 m window the
  50 m grid is used, outside it the 100 m grid. Sun below 0° apparent altitude counts as shadow everywhere.
- The same rules run twice: `site/js/shadow.js` on the CPU (counter and list) and the GLSL pass in `site/js/terrain.js`
  (the picture, 50 m cells while playing, 25 m at rest).

## Rebuild the data

Needs Python 3 with numpy and GDAL bindings, curl, and the source data in `sources/` (not committed):
`data/dem25.tif` (swissALTIRegio resampled to 25 m, EPSG:2056) and `data/names/swissNAMES3D_PKT.csv`.

```bash
tools/fetch_borders.sh                          # canton polygons from api3.geo.admin.ch -> sources/ (not committed)
python3 tools/build_data.py                     # reads sources/, or pass another source dir
```

It writes `site/data/near.dem.png`, `far.dem.png`, `borders.json` and `meta.json`. Heights are 0.1 m steps in the
`.dem.png` scheme (2D predictor, byte planes, decoded in `site/js/grid.js` without canvas colour management).
Orte: swissNAMES3D Objektart Ort at least 1 km inside the window with at least 100 inhabitants. swissNAMES3D lists
St. Gallen in four languages at one point; the build keeps one name per point (the official endonym), which leaves 848.

## Checks

```bash
node --test test/sun.test.mjs     # sun vs JPL DE421 (skyfield) for 17 Nov 2026, one row per minute
```

In-page checks, with the server running and a Chromium on CDP port 9371
(`chromium --headless=new --remote-debugging-port=9371 --use-angle=vulkan --ignore-gpu-blocklist`):

```bash
node tools/shoot.mjs "http://127.0.0.1:8871/?t=2026-11-17T12:00" /tmp/b.png 1280 800 5000 "$(cat test/gpu_cpu.js)"
node tools/shoot.mjs "http://127.0.0.1:8871/?t=2026-11-17T10:00" /tmp/a.png 1920 1080 5000 "$(cat test/bench.js)"
```

`gpu_cpu.js` reads the GPU shadow texture back at every Ort and compares it with the CPU ray. `bench.js` reports fps and
GPU ms per frame. `shoot.mjs` exits 1 on any console error.

## Deploy

`.github/workflows/pages.yml` uploads `site/` as the Pages artifact on every push to `main`. The data is committed, so
there is no release download. Pages needs a public repository on the free plan, and Settings → Pages → Source set to
"GitHub Actions".

## Data

- Gelände: swisstopo swissALTIRegio. Outside Switzerland swissALTIRegio contains DGM Österreich (geoland.at), DGM1
  Bayern and Baden-Württemberg and others, see the swisstopo product page.
- Ortsnamen: swisstopo swissNAMES3D.
- Kantonsgrenzen: swisstopo swissBOUNDARIES3D, via the geo.admin.ch API.
- Terms of use: https://www.swisstopo.admin.ch/ogd-conditions
