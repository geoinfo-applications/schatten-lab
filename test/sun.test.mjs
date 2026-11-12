// Compare site/js/sun.js with a per-minute JPL DE421 table (skyfield, standard refraction) at 47.20 N 9.27 E.
// usage: node --test test/sun.test.mjs   (SUN_TABLE overrides the table path)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sunPosition } from "../site/js/sun.js";
import { parseZurich, zurichParts } from "../site/js/time.js";

const tablePath = process.env.SUN_TABLE ?? new URL("sun_table_2026-11-17.json", import.meta.url);
const table = JSON.parse(readFileSync(tablePath, "utf8"));

function errors(rows) {
    let alt = 0;
    let az = 0;
    for (const row of rows) {
        const utcMs = Date.UTC(2026, 10, 17, 0, row.cet - 60);
        const sun = sunPosition(utcMs, 47.2, 9.27);
        alt = Math.max(alt, Math.abs(sun.altitude - row.alt));
        az = Math.max(az, Math.abs(((sun.azimuth - row.az + 540) % 360) - 180));
    }
    return { alt, az, n: rows.length };
}

test("sun matches DE421 above 2° altitude within 0.03°", () => {
    const e = errors(table.filter((r) => r.alt > 2));
    console.log("alt > 2°:", e);

    assert.ok(e.alt < 0.03 && e.az < 0.02);
});

test("sun matches DE421 near the horizon within 0.05°", () => {
    const e = errors(table.filter((r) => r.alt <= 2));
    console.log("alt <= 2°:", e);

    assert.ok(e.alt < 0.05 && e.az < 0.02);
});

test("Zurich wall time converts in winter and in summer", () => {
    const winter = parseZurich("2026-11-17T09:30");
    const summer = parseZurich("2026-07-01T09:30");

    assert.equal(new Date(winter).toISOString(), "2026-11-17T08:30:00.000Z");
    assert.equal(new Date(summer).toISOString(), "2026-07-01T07:30:00.000Z");
    assert.equal(zurichParts(summer).hour, 9);
});

test("sun at summer solstice noon stands about 66.2° high", () => {
    const sun = sunPosition(Date.UTC(2026, 5, 21, 11, 25), 47.2, 9.27);

    assert.ok(Math.abs(sun.altitude - 66.2) < 0.1, `altitude ${sun.altitude}`);
    assert.ok(Math.abs(sun.azimuth - 180) < 2, `azimuth ${sun.azimuth}`);
});
