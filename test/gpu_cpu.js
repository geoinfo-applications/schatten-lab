// Run in index.html (window.__app): compare the GPU shadow texture with the CPU rays at every Ort for several times.
(async () => {
    const { sunAt } = await import("/js/app.js");
    const { parseZurich } = await import("/js/time.js");
    const { data, view } = window.__app;
    const out = [];
    for (const t of ["08:15", "09:30", "12:00", "14:30", "16:15"]) {
        for (const fine of [false, true]) {
            const { ray } = sunAt(parseZurich(`2026-11-17T${t}`), data.meta);
            view.setSun(ray, fine);
            let litDiff = 0;
            const mismatches = [];
            for (const o of data.meta.orte) {
                const cpu = data.terrain.ray(o.e, o.n, ray);
                const gpu = view.probe(o.e, o.n);
                if ((gpu.lit > 0.5) !== cpu.lit) { litDiff++; mismatches.push(o.name); }
            }
            out.push(`${t} ${fine ? "25m" : "50m"}: lit differs at ${litDiff}/${data.meta.orte.length} ${mismatches.slice(0, 4).join(", ")}`);
        }
    }
    window.__app.update();
    return out.join("\n");
})()
