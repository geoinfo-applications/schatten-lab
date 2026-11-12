// The canton at the real sun position, re-rendered every minute. ?t=2026-11-17T09:30 fixes the time (Zurich).

import { Labels, createView, loadData, sunAt } from "./app.js";
import { sunriseSunset } from "./sun.js";
import { hhmm, longDate, parseZurich, zurichParts, zurichToUtc } from "./time.js";

const $ = (id) => document.getElementById(id);

function list(names) {
    if (names.length <= 1) {
        return names.join("");
    }
    return `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`;
}

function dayTimes(utcMs, meta) {
    const p = zurichParts(utcMs);
    const start = zurichToUtc(p.year, p.month, p.day, 0, 0);
    return sunriseSunset(start, meta.sunSite.lat, meta.sunSite.lon);
}

// One line for the state of the canton. Plain facts, said dryly.
export function quip({ count, total, sun, utcMs, dark, day, nextSunrise }) {
    if (sun.altitude <= 0) {
        return utcMs < day.noon
            ? `${total} von ${total}. Man nennt es Nacht. Sonnenaufgang um ${hhmm(nextSunrise)}.`
            : `${total} von ${total}. Man nennt es Nacht. Die Sonne kommt um ${hhmm(nextSunrise)} wieder.`;
    }
    if (count === 0) {
        return "Kein einziger Ort im Schatten. Das kommt selten vor. Bitte rausgehen.";
    }
    const biggest = dark.slice(0, 3).map((o) => o.name);
    if (Math.abs(utcMs - day.noon) < 75 * 60000) {
        return `Mittag. Trotzdem im Schatten: ${list(dark.length > 3 ? [...biggest, `${dark.length - 3} weitere`] : biggest)}.`;
    }
    if (sun.altitude < 4) {
        return "Die Sonne steht tief, die Berge stehen höher.";
    }
    if (count > total / 2) {
        return utcMs < day.noon ? "Mehr als die Hälfte wartet noch auf die Sonne." : "Mehr als die Hälfte hat die Sonne schon wieder verloren.";
    }
    if (count <= 3) {
        return `Nur noch ${list(biggest)}. Durchhalten.`;
    }
    return utcMs < day.noon
        ? `Die Sonne arbeitet sich vor. Noch im Schatten unter anderem: ${list(biggest)}.`
        : `Die Berge holen sich die Landschaft zurück, angefangen mit ${list(biggest)}.`;
}

async function main() {
    const data = await loadData();
    const { meta, terrain } = data;
    const view = createView($("map"), data, {
        exaggeration: 1.4, background: 0.078, meshStep: 100,
        tones: [0.95, 0.76, 0.12],
    });
    view.camera.set({ target: [0, -3000, 900], distance: innerWidth < innerHeight ? 150000 : 118000, yaw: 0.1, pitch: 0.95 });
    const labels = new Labels($("labels"), view);
    $("status").remove();
    $("total").textContent = String(meta.orte.length);
    $("definition").textContent = "Ein Ort liegt im Schatten, wenn Gelände bis 60 km weit den Strahl zur Sonne verdeckt (Erdkrümmung eingerechnet) "
        + "oder die Sonne unter dem Horizont steht. Gelände 50 m, alle Orte ab 100 Einwohnern im gezeigten Gelände.";

    const fixed = parseZurich(new URLSearchParams(location.search).get("t"));
    let selected = null;
    let state = null;

    function update() {
        const utcMs = fixed ?? Date.now();
        const { sun, ray } = sunAt(utcMs, meta);
        view.setSun(ray, true);
        const dark = meta.orte.filter((o) => !terrain.ray(o.e, o.n, ray).lit);
        const day = dayTimes(utcMs, meta);
        const nextSunrise = utcMs < day.sunrise ? day.sunrise : dayTimes(utcMs + 86400000, meta).sunrise;
        state = { utcMs, sun, dark };
        $("clock").textContent = hhmm(utcMs);
        $("sunline").textContent = sun.altitude > 0
            ? `${fixed ? `${longDate(utcMs)} · ` : ""}Sonne ${sun.altitude.toFixed(1)}° hoch, Azimut ${sun.azimuth.toFixed(0)}°`
            : `${fixed ? `${longDate(utcMs)} · ` : ""}Sonne ${Math.abs(sun.altitude).toFixed(1)}° unter dem Horizont`;
        $("count").textContent = String(dark.length);
        $("quip").textContent = quip({ count: dark.length, total: meta.orte.length, sun, utcMs, dark, day, nextSunrise });
        $("listhead").textContent = sun.altitude > 0 ? `Im Schatten (${dark.length})` : "Im Schatten: alle. Eine Auswahl";
        renderList(sun.altitude > 0 ? dark : dark.slice(0, 25));
        renderLabels();
    }

    function renderList(orte) {
        const ul = $("list");
        ul.replaceChildren(...orte.map((o) => {
            const li = document.createElement("li");
            const button = document.createElement("button");
            button.type = "button";
            button.innerHTML = "<span></span><span class=\"meta\"></span>";
            button.children[0].textContent = o.name;
            button.children[1].textContent = o.pop >= 1000 ? `ab ${o.pop.toLocaleString("de-CH")} Einw.` : "100 bis 999 Einw.";
            button.setAttribute("aria-current", String(o === selected));
            button.addEventListener("click", () => pick(o));
            li.append(button);
            return li;
        }));
    }

    function pick(ort) {
        selected = ort;
        view.flyTo(ort.e, ort.n, 16000);
        for (const button of $("list").querySelectorAll("button")) {
            button.setAttribute("aria-current", String(button.children[0].textContent === ort.name));
        }
        renderLabels();
    }

    function renderLabels() {
        const darkSet = new Set(state.dark);
        const items = meta.orte.filter((o) => o === selected || darkSet.has(o)).map((o) => ({
            key: o.name, e: o.e, n: o.n, text: o === selected ? o.name : "",
            className: `${o === selected ? "current" : "dot"}${darkSet.has(o) ? " dark" : ""}`,
        }));
        labels.set(items);
    }

    update();
    if (!fixed) {
        const schedule = () => setTimeout(() => {
            update();
            schedule();
        }, 60000 - (Date.now() % 60000) + 50);
        schedule();
    }
    window.__app = { data, view, update, pick, state: () => state };
}

main().catch((error) => {
    $("status").textContent = `Fehler: ${error.message}`;
    console.error(error);
});
