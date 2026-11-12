// Europe/Zurich wall time <-> UTC, independent of the viewer's own time zone.

const PARTS = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    second: "2-digit",
});

export function zurichParts(utcMs) {
    const parts = Object.fromEntries(PARTS.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
    return { year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour, minute: +parts.minute, second: +parts.second };
}

function offsetMs(utcMs) {
    const p = zurichParts(utcMs);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}

export function zurichToUtc(year, month, day, hour = 0, minute = 0) {
    const wall = Date.UTC(year, month - 1, day, hour, minute);
    let utc = wall - offsetMs(wall);
    utc = wall - offsetMs(utc);
    return utc;
}

// "2026-11-17T09:30" (Zurich wall time) -> UTC ms, or null.
export function parseZurich(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?$/.exec(text ?? "");
    return m ? zurichToUtc(+m[1], +m[2], +m[3], +(m[4] ?? 12), +(m[5] ?? 0)) : null;
}

export function hhmm(utcMs) {
    const p = zurichParts(utcMs);
    return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

export function longDate(utcMs) {
    const p = zurichParts(utcMs);
    const weekday = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
    return `${weekday}, ${p.day}. ${MONTHS[p.month - 1]} ${p.year}`;
}
