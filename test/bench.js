// Run in either page: GPU ms per terrain frame (timer query) and rAF fps while the camera orbits for 4 s.
(async () => {
    const view = window.__view;
    const gl = view.gl;
    const timer = view.timer;
    const gpu = [];
    let frames = 0;
    const t0 = performance.now();
    await new Promise((resolve) => {
        function frame(now) {
            view.camera.yaw += 0.01;
            let query = null;
            if (timer && frames % 10 === 0) {
                query = gl.createQuery();
                gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
            }
            view.render();
            if (query) {
                gl.endQuery(timer.TIME_ELAPSED_EXT);
                const q = query;
                const poll = () => gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) ? gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6) : setTimeout(poll, 5);
                setTimeout(poll, 5);
            }
            frames++;
            if (now - t0 < 4000) requestAnimationFrame(frame); else resolve();
        }
        requestAnimationFrame(frame);
    });
    const seconds = (performance.now() - t0) / 1000;
    gpu.sort((a, b) => a - b);
    return { fps: +(frames / seconds).toFixed(1), gpuMsMedian: +gpu[Math.floor(gpu.length / 2)]?.toFixed(2), canvas: [gl.drawingBufferWidth, gl.drawingBufferHeight] };
})()
