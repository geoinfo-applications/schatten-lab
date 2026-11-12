// Height grids in the .dem.png scheme (see tools/build_data.py), decoded without canvas colour management.
// Works in the browser and in node (both have DecompressionStream).

async function inflateIdat(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const idat = [];
    for (let p = 8; p < bytes.length;) {
        const length = view.getUint32(p);
        const kind = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
        if (kind === "IDAT") {
            idat.push(bytes.subarray(p + 8, p + 8 + length));
        }
        p += 12 + length;
    }
    const stream = new Blob(idat).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decodeDem(bytes, meta) {
    const rows = await inflateIdat(bytes);
    const { w, h } = meta;
    const q = new Uint16Array(w * h);
    for (let r = 0; r < h; r++) {
        const lo = r * (w + 1) + 1;
        const hi = (r + h) * (w + 1) + 1;
        for (let x = 0; x < w; x++) {
            q[r * w + x] = rows[lo + x] | (rows[hi + x] << 8);
        }
    }
    const values = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            let v = q[i];
            if (x > 0) v += q[i - 1];
            if (y > 0) v += q[i - w];
            if (x > 0 && y > 0) v -= q[i - w - 1];
            q[i] = v & 0xffff;
            values[i] = q[i] / 10;
        }
    }
    return { meta, values };
}

export async function fetchBytes(url) {
    return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

// Bilinear sample with texel centres at (i + 0.5) * cell, clamped at the edge: the same rule a GPU LINEAR sampler uses.
export function sample(grid, e, n) {
    const { w, h, x0, y1, cell } = grid.meta;
    const fx = Math.min(w - 1, Math.max(0, (e - x0) / cell - 0.5));
    const fy = Math.min(h - 1, Math.max(0, (y1 - n) / cell - 0.5));
    const ix = Math.min(w - 2, Math.floor(fx));
    const iy = Math.min(h - 2, Math.floor(fy));
    const tx = fx - ix;
    const ty = fy - iy;
    const v = grid.values;
    const a = v[iy * w + ix];
    const b = v[iy * w + ix + 1];
    const c = v[(iy + 1) * w + ix];
    const d = v[(iy + 1) * w + ix + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

export function bounds(meta) {
    return { e0: meta.x0, e1: meta.x0 + meta.w * meta.cell, n0: meta.y1 - meta.h * meta.cell, n1: meta.y1 };
}
