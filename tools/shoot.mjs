// Screenshot one page at one size over CDP, in one connection so the device emulation holds.
// usage: CDP_PORT=9371 node tools/shoot.mjs <url> <out.png> <width> <height> [waitMs] [js to run before the shot]
// Prints console errors and exceptions; exits 1 if there were any.
import { writeFileSync } from "node:fs";

const [url, out, width, height, wait = "5000", js] = process.argv.slice(2);
const base = `http://127.0.0.1:${process.env.CDP_PORT ?? 9371}`;
const page = (await (await fetch(`${base}/json`)).json()).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const problems = [];
ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
    } else if (msg.method === "Runtime.exceptionThrown") {
        problems.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
    } else if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) {
        problems.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
    } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
        problems.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ""}`);
    }
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
});
const w = Number(width);
await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: w, height: Number(height), deviceScaleFactor: w < 800 ? 2 : 1, mobile: w < 800 });
await send("Emulation.setTouchEmulationEnabled", { enabled: w < 800 });
await send("Page.navigate", { url });
await new Promise((r) => setTimeout(r, Number(wait)));
if (js) {
    const r = await send("Runtime.evaluate", { expression: js, awaitPromise: true, returnByValue: true });
    console.log(JSON.stringify(r.result?.result?.value));
    await new Promise((r) => setTimeout(r, 800));
}
const scroll = await send("Runtime.evaluate", { expression: "document.documentElement.scrollWidth", returnByValue: true });
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
console.log(`saved ${out} scrollWidth=${scroll.result.result.value}`);
for (const p of problems) {
    console.log(p);
}
await send("Emulation.clearDeviceMetricsOverride");
ws.close();
process.exit(problems.length ? 1 : 0);
