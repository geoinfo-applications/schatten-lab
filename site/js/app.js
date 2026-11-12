// Shared page setup: load the grids, build the CPU terrain and the WebGL view, place HTML labels over the 3D view.

import { decodeDem, fetchBytes } from "./grid.js";
import { Terrain, sunVector } from "./shadow.js";
import { sunPosition } from "./sun.js";
import { TerrainView } from "./terrain.js";

export async function loadData(base = "data/") {
    const meta = await (await fetch(`${base}meta.json`)).json();
    const [nearBytes, farBytes, borders] = await Promise.all([fetchBytes(`${base}near.dem.png`), fetchBytes(`${base}far.dem.png`),
        fetch(`${base}borders.json`).then((r) => r.json())]);
    const [near, far] = await Promise.all([decodeDem(nearBytes, meta.near), decodeDem(farBytes, meta.far)]);
    const terrain = new Terrain(near, far);
    return { meta, near, far, borders, terrain, heightAt: (e, n) => terrain.height(e, n) };
}

export function sunAt(utcMs, meta) {
    const sun = sunPosition(utcMs, meta.sunSite.lat, meta.sunSite.lon);
    return { sun, ray: sunVector(sun, meta.sunSite.convergenceDeg) };
}

export function createView(canvas, data, options) {
    const view = new TerrainView(canvas, data, options);
    window.__view = view;
    return view;
}

// Labels: [{ key, e, n, text, className }] positioned on every render; hidden when off screen.
export class Labels {
    constructor(container, view) {
        this.container = container;
        this.view = view;
        this.items = new Map();
        view.onRender(() => this.place());
    }

    set(items) {
        const keep = new Set(items.map((i) => i.key));
        for (const [key, entry] of this.items) {
            if (!keep.has(key)) {
                entry.element.remove();
                this.items.delete(key);
            }
        }
        for (const item of items) {
            let entry = this.items.get(item.key);
            if (!entry) {
                const element = document.createElement(item.onClick ? "button" : "div");
                element.type = item.onClick ? "button" : undefined;
                this.container.append(element);
                entry = { element, z: this.view.heightAt(item.e, item.n) };
                this.items.set(item.key, entry);
            }
            entry.item = item;
            entry.element.className = `label ${item.className ?? ""}`;
            entry.element.textContent = item.text;
            entry.element.onclick = item.onClick ?? null;
        }
        this.place();
    }

    place() {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        for (const { element, item, z } of this.items.values()) {
            const p = this.view.viewProj ? this.view.project(item.e, item.n, z) : null;
            const visible = p && p[0] > -50 && p[0] < w + 50 && p[1] > -20 && p[1] < h + 20;
            element.hidden = !visible;
            if (visible) {
                element.style.transform = `translate(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px)`;
            }
        }
    }
}
