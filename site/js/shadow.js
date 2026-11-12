// Cast shadows from the heightmap: one horizon ray per point toward the sun. The GPU pass in terrain.js runs the same
// schedule and the same rules (its GLSL constants come from SHADOW below), so the picture and the list agree.

import { bounds, sample } from "./grid.js";

export const SHADOW = {
    refractionK: 0.13,
    earthRadius: 6371000,
    maxDistance: 60000,
    firstStep: 50,          // = near grid cell; linear steps until 1.5 % of the distance is larger
    growth: 0.015,
    eyeHeight: 2,           // the point sits 2 m above the DEM, so it does not shade itself
};

export const EFFECTIVE_RADIUS = SHADOW.earthRadius / (1 - SHADOW.refractionK);

// Grid bearing of the sun: true azimuth plus the grid bearing of true north (negative east of Bern).
export function sunVector(sun, convergenceDeg) {
    const bearing = (sun.azimuth + convergenceDeg) * Math.PI / 180;
    const altitude = sun.altitude * Math.PI / 180;
    return { dx: Math.sin(bearing), dy: Math.cos(bearing), tanAltitude: Math.tan(altitude), up: sun.altitude > 0 };
}

export class Terrain {
    constructor(near, far) {
        this.near = near;
        this.far = far;
        this.nearBounds = bounds(near.meta);
        this.farBounds = bounds(far.meta);
        this.maxHeight = far.meta.max;
    }

    insideNear(e, n) {
        const b = this.nearBounds;
        const margin = this.near.meta.cell;
        return e > b.e0 + margin && e < b.e1 - margin && n > b.n0 + margin && n < b.n1 - margin;
    }

    insideFar(e, n) {
        const b = this.farBounds;
        return e > b.e0 && e < b.e1 && n > b.n0 && n < b.n1;
    }

    height(e, n) {
        return this.insideNear(e, n) ? sample(this.near, e, n) : sample(this.far, e, n);
    }

    // { lit }: lit = the ray reaches the sun.
    ray(e0, n0, sunRay) {
        if (!sunRay.up) {
            return { lit: false };
        }
        return { lit: this.reachesSun(e0, n0, this.height(e0, n0) + SHADOW.eyeHeight, sunRay) };
    }

    reachesSun(e0, n0, z0, { dx, dy, tanAltitude }) {
        for (let d = SHADOW.firstStep; d < SHADOW.maxDistance; d += Math.max(SHADOW.firstStep, d * SHADOW.growth)) {
            const e = e0 + d * dx;
            const n = n0 + d * dy;
            const rayHeight = z0 + d * tanAltitude;
            if (rayHeight > this.maxHeight || !this.insideFar(e, n)) {
                return true;
            }
            if (this.height(e, n) - d * d / (2 * EFFECTIVE_RADIUS) > rayHeight) {
                return false;
            }
        }
        return true;
    }
}
