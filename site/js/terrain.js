// WebGL2 terrain in light and dark. Pass 1 ray-marches every 50 m cell of the canton window toward the sun into a
// shadow texture (only when the sun moves). Pass 2 drapes it on the 3D mesh. The march mirrors shadow.js line by line.

import { EFFECTIVE_RADIUS, SHADOW } from "./shadow.js";
import { bounds } from "./grid.js";
import { Camera } from "./camera.js";

const f = (v) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

const QUAD_VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const HEIGHT_GLSL = `
uniform sampler2D uNear;
uniform sampler2D uFar;
uniform vec4 uNearBox;   // local e0, local n1, width, height (m)
uniform vec4 uFarBox;
uniform float uNearCell;

vec2 boxUv(vec4 box, vec2 p) { return vec2((p.x - box.x) / box.z, (box.y - p.y) / box.w); }
bool insideNear(vec2 p) {
    return p.x > uNearBox.x + uNearCell && p.x < uNearBox.x + uNearBox.z - uNearCell
        && p.y < uNearBox.y - uNearCell && p.y > uNearBox.y - uNearBox.w + uNearCell;
}
bool insideFar(vec2 p) {
    return p.x > uFarBox.x && p.x < uFarBox.x + uFarBox.z && p.y < uFarBox.y && p.y > uFarBox.y - uFarBox.w;
}
float heightAt(vec2 p) {
    return insideNear(p) ? texture(uNear, boxUv(uNearBox, p)).r : texture(uFar, boxUv(uFarBox, p)).r;
}`;

const SHADOW_FS = `#version 300 es
precision highp float;
${HEIGHT_GLSL}
uniform vec4 uRaster;    // local e0, local n0, cell, unused
uniform vec3 uSun;       // dx, dy, tan(altitude)
uniform float uSunUp;
uniform float uMaxHeight;
out vec4 outColor;

const float FIRST = ${f(SHADOW.firstStep)};
const float GROWTH = ${f(SHADOW.growth)};
const float MAX_DIST = ${f(SHADOW.maxDistance)};
const float TWO_R = ${f(2 * EFFECTIVE_RADIUS)};
const float EYE = ${f(SHADOW.eyeHeight)};

float reachesSun(vec2 p0, float z0) {
    for (float d = FIRST; d < MAX_DIST; d += max(FIRST, d * GROWTH)) {
        vec2 p = p0 + d * uSun.xy;
        float rayHeight = z0 + d * uSun.z;
        if (rayHeight > uMaxHeight || !insideFar(p)) return 1.0;
        if (heightAt(p) - d * d / TWO_R > rayHeight) return 0.0;
    }
    return 1.0;
}

void main() {
    vec2 p0 = uRaster.xy + gl_FragCoord.xy * uRaster.z;
    if (uSunUp < 0.5) { outColor = vec4(0.0); return; }
    float z0 = heightAt(p0) + EYE;
    outColor = vec4(reachesSun(p0, z0), 0.0, 0.0, 1.0);
}`;

const TERRAIN_VS = `#version 300 es
precision highp float;
uniform sampler2D uNear;
uniform vec4 uNearBox;
uniform mat4 uViewProj;
uniform float uExaggeration;
in vec2 aPos;
out vec2 vPos;
void main() {
    vec2 uv = vec2((aPos.x - uNearBox.x) / uNearBox.z, (uNearBox.y - aPos.y) / uNearBox.w);
    float z = textureLod(uNear, uv, 0.0).r;
    vPos = aPos;
    gl_Position = uViewProj * vec4(aPos, z * uExaggeration, 1.0);
}`;

const TERRAIN_FS = `#version 300 es
precision highp float;
uniform sampler2D uNear;
uniform sampler2D uShadow;
uniform vec4 uNearBox;
uniform float uNearCell;
uniform vec4 uRasterBox;  // local e0, local n0, width, height
uniform vec3 uSunDir;
uniform float uSunUp;
uniform vec3 uTones;      // lit, grazing, shadow
in vec2 vPos;
out vec4 outColor;

float h(vec2 p) { return texture(uNear, vec2((p.x - uNearBox.x) / uNearBox.z, (uNearBox.y - p.y) / uNearBox.w)).r; }

void main() {
    vec2 c = vec2(uNearCell, 0.0);
    vec3 normal = normalize(vec3(h(vPos - c.xy) - h(vPos + c.xy), h(vPos - c.yx) - h(vPos + c.yx), 2.0 * uNearCell));
    vec2 suv = (vPos - uRasterBox.xy) / uRasterBox.zw;
    float cast_ = texture(uShadow, suv).r * uSunUp;
    float facing = dot(normal, uSunDir);
    float lit = cast_ * smoothstep(-0.02, 0.05, facing) * uSunUp;
    float relief = dot(normal, normalize(vec3(-0.5, 0.6, 0.62)));
    float dark = uTones.z + 0.035 * (relief - 0.6);
    float bright = mix(uTones.y, uTones.x, smoothstep(0.22, 0.30, facing));
    float tone = mix(dark, bright, lit);
    outColor = vec4(vec3(tone), 1.0);
}`;

const BORDER_VS = `#version 300 es
uniform mat4 uViewProj;
uniform float uExaggeration;
in vec3 aPos;
void main() { gl_Position = uViewProj * vec4(aPos.xy, aPos.z * uExaggeration, 1.0); }`;

const BORDER_FS = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = uColor; }`;

function compile(gl, vs, fs) {
    const program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error(gl.getShaderInfoLog(shader));
        }
        gl.attachShader(program, shader);
    }
    gl.bindAttribLocation(program, 0, "aPos");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program));
    }
    const uniforms = {};
    for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
        const name = gl.getActiveUniform(program, i).name;
        uniforms[name.replace("[0]", "")] = gl.getUniformLocation(program, name);
    }
    return { program, uniforms };
}

export class TerrainView {
    // data: { near, far, borders }, options: { tones, exaggeration, meshStep, background }
    constructor(canvas, data, options) {
        this.canvas = canvas;
        this.data = data;
        this.options = options;
        const gl = canvas.getContext("webgl2", { antialias: true, preserveDrawingBuffer: true });
        if (!gl) {
            throw new Error("WebGL2 fehlt");
        }
        this.gl = gl;
        const nb = bounds(data.near.meta);
        this.origin = { e: (nb.e0 + nb.e1) / 2, n: (nb.n0 + nb.n1) / 2 };
        this.nearBox = this.box(data.near.meta);
        this.farBox = this.box(data.far.meta);
        this.floatLinear = !!gl.getExtension("OES_texture_float_linear");
        this.nearTexture = this.heightTexture(data.near);
        this.farTexture = this.heightTexture(data.far);
        this.shadowProgram = compile(gl, QUAD_VS, SHADOW_FS);
        this.terrainProgram = compile(gl, TERRAIN_VS, TERRAIN_FS);
        this.quad = this.buffer(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
        this.buildMesh(options.meshStep ?? 100);
        this.borderProgram = compile(gl, BORDER_VS, BORDER_FS);
        this.buildBorders(data.borders ?? []);
        this.rasters = { coarse: this.buildRaster(data.near.meta.cell), fine: this.buildRaster(data.near.meta.cell / 2) };
        this.raster = this.rasters.coarse;
        this.camera = new Camera(canvas, () => this.requestRender());
        this.sun = null;
        this.listeners = [];
        this.timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
        new ResizeObserver(() => this.requestRender()).observe(canvas);
    }

    box(meta) {
        const b = bounds(meta);
        return [b.e0 - this.origin.e, b.n1 - this.origin.n, b.e1 - b.e0, b.n1 - b.n0];
    }

    local(e, n) {
        return [e - this.origin.e, n - this.origin.n];
    }

    heightTexture(grid) {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, this.floatLinear ? gl.R32F : gl.R16F, grid.meta.w, grid.meta.h, 0, gl.RED, gl.FLOAT, grid.values);
        this.sampling(gl.LINEAR);
        return texture;
    }

    sampling(filter) {
        const gl = this.gl;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    buffer(array, target = this.gl.ARRAY_BUFFER) {
        const gl = this.gl;
        const buffer = gl.createBuffer();
        gl.bindBuffer(target, buffer);
        gl.bufferData(target, array, gl.STATIC_DRAW);
        return buffer;
    }

    buildMesh(step) {
        const [e0, n1, width, height] = this.nearBox;
        const cols = Math.round(width / step) + 1;
        const rows = Math.round(height / step) + 1;
        const positions = new Float32Array(cols * rows * 2);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                positions[(r * cols + c) * 2] = e0 + Math.min(width, c * step);
                positions[(r * cols + c) * 2 + 1] = n1 - Math.min(height, r * step);
            }
        }
        const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);
        let k = 0;
        for (let r = 0; r < rows - 1; r++) {
            for (let c = 0; c < cols - 1; c++) {
                const a = r * cols + c;
                indices.set([a, a + cols, a + 1, a + 1, a + cols, a + cols + 1], k);
                k += 6;
            }
        }
        this.meshPositions = this.buffer(positions);
        this.meshIndices = this.buffer(indices, this.gl.ELEMENT_ARRAY_BUFFER);
        this.meshCount = indices.length;
    }

    // Canton borders as line segments draped 25 m above the terrain, densified to 100 m so they follow the relief.
    buildBorders(lines) {
        const points = [];
        for (const line of lines) {
            for (let k = 0; k + 1 < line.length; k++) {
                const [e0, n0] = line[k];
                const [e1, n1] = line[k + 1];
                const steps = Math.max(1, Math.ceil(Math.hypot(e1 - e0, n1 - n0) / 100));
                for (let i = 0; i < steps; i++) {
                    for (const t of [i / steps, (i + 1) / steps]) {
                        const e = e0 + (e1 - e0) * t;
                        const n = n0 + (n1 - n0) * t;
                        points.push(...this.local(e, n), this.data.heightAt(e, n) + 25);
                    }
                }
            }
        }
        this.borderBuffer = this.buffer(new Float32Array(points));
        this.borderCount = points.length / 3;
    }

    buildRaster(cell) {
        const gl = this.gl;
        const [e0, n1, width, height] = this.nearBox;
        const raster = { e0, n0: n1 - height, cell, w: Math.round(width / cell), h: Math.round(height / cell) };
        raster.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, raster.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, raster.w, raster.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        this.sampling(gl.LINEAR);
        raster.framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, raster.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, raster.texture, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return raster;
    }

    bindHeights(program) {
        const gl = this.gl;
        const u = program.uniforms;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.nearTexture);
        gl.uniform1i(u.uNear, 0);
        if (u.uFar) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.farTexture);
            gl.uniform1i(u.uFar, 1);
            gl.uniform4fv(u.uFarBox, this.farBox);
        }
        gl.uniform4fv(u.uNearBox, this.nearBox);
        if (u.uNearCell) {
            gl.uniform1f(u.uNearCell, this.data.near.meta.cell);
        }
    }

    // ray: { dx, dy, tanAltitude, up } from shadow.js sunVector. Recomputes the shadow texture, 50 m or (fine) 25 m.
    setSun(ray, fine = false) {
        const gl = this.gl;
        this.sun = ray;
        this.raster = fine ? this.rasters.fine : this.rasters.coarse;
        const { program, uniforms: u } = this.shadowProgram;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.raster.framebuffer);
        gl.viewport(0, 0, this.raster.w, this.raster.h);
        gl.disable(gl.DEPTH_TEST);
        gl.useProgram(program);
        this.bindHeights(this.shadowProgram);
        gl.uniform4f(u.uRaster, this.raster.e0, this.raster.n0, this.raster.cell, 0);
        gl.uniform3f(u.uSun, ray.dx, ray.dy, ray.tanAltitude);
        gl.uniform1f(u.uSunUp, ray.up ? 1 : 0);
        gl.uniform1f(u.uMaxHeight, this.data.far.meta.max);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.requestRender();
    }

    // Read the shadow texture back at an LV95 point: { lit } as 0..1. For tests.
    probe(e, n) {
        const gl = this.gl;
        const [x, y] = this.local(e, n);
        const i = Math.floor((x - this.raster.e0) / this.raster.cell);
        const j = Math.floor((y - this.raster.n0) / this.raster.cell);
        const out = new Uint8Array(4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.raster.framebuffer);
        gl.readPixels(i, j, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { lit: out[0] / 255 };
    }

    heightAt(e, n) {
        return this.data.heightAt(e, n);
    }

    requestRender() {
        if (!this.pending) {
            this.pending = requestAnimationFrame(() => {
                this.pending = 0;
                this.render();
            });
        }
    }

    onRender(listener) {
        this.listeners.push(listener);
    }

    resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
        const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
    }

    render() {
        const gl = this.gl;
        this.resize();
        this.camera.step();
        const { program, uniforms: u } = this.terrainProgram;
        const exaggeration = this.options.exaggeration ?? 1;
        this.viewProj = this.camera.viewProjection(this.canvas.width / this.canvas.height, exaggeration);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        const bg = this.options.background;
        gl.clearColor(bg, bg, bg, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.useProgram(program);
        this.bindHeights(this.terrainProgram);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.raster.texture);
        gl.uniform1i(u.uShadow, 2);
        gl.uniformMatrix4fv(u.uViewProj, false, this.viewProj);
        gl.uniform1f(u.uExaggeration, exaggeration);
        gl.uniform4f(u.uRasterBox, this.raster.e0, this.raster.n0, this.raster.w * this.raster.cell, this.raster.h * this.raster.cell);
        const ray = this.sun ?? { dx: 0, dy: 1, tanAltitude: 0, up: false };
        const cosAltitude = 1 / Math.sqrt(1 + ray.tanAltitude * ray.tanAltitude);
        gl.uniform3f(u.uSunDir, ray.dx * cosAltitude, ray.dy * cosAltitude, ray.tanAltitude * cosAltitude);
        gl.uniform1f(u.uSunUp, ray.up ? 1 : 0);
        gl.uniform3fv(u.uTones, this.options.tones);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.meshPositions);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshIndices);
        gl.drawElements(gl.TRIANGLES, this.meshCount, gl.UNSIGNED_INT, 0);
        if (this.borderCount) {
            const border = this.borderProgram;
            gl.useProgram(border.program);
            gl.uniformMatrix4fv(border.uniforms.uViewProj, false, this.viewProj);
            gl.uniform1f(border.uniforms.uExaggeration, exaggeration);
            gl.uniform4fv(border.uniforms.uColor, this.options.borderColor ?? [0.55, 0.55, 0.55, 0.6]);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.borderBuffer);
            gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.LINES, 0, this.borderCount);
            gl.disable(gl.BLEND);
        }
        for (const listener of this.listeners) {
            listener();
        }
        if (this.camera.moving()) {
            this.requestRender();
        }
    }

    // LV95 + height -> CSS pixels in the canvas, or null behind the camera.
    project(e, n, z) {
        const [x, y] = this.local(e, n);
        const m = this.viewProj;
        const zz = z * (this.options.exaggeration ?? 1);
        const cx = m[0] * x + m[4] * y + m[8] * zz + m[12];
        const cy = m[1] * x + m[5] * y + m[9] * zz + m[13];
        const cw = m[3] * x + m[7] * y + m[11] * zz + m[15];
        if (cw <= 0) {
            return null;
        }
        return [(cx / cw * 0.5 + 0.5) * this.canvas.clientWidth, (0.5 - cy / cw * 0.5) * this.canvas.clientHeight];
    }

    flyTo(e, n, distance) {
        const [x, y] = this.local(e, n);
        this.camera.flyTo([x, y, this.data.heightAt(e, n) * (this.options.exaggeration ?? 1)], distance);
    }

    // GPU milliseconds of one shadow pass, from a timer query when the driver has one, else wall time after a sync.
    async timeShadowPass(ray, fine = false) {
        const gl = this.gl;
        const t0 = performance.now();
        if (this.timer) {
            const query = gl.createQuery();
            gl.beginQuery(this.timer.TIME_ELAPSED_EXT, query);
            this.setSun(ray, fine);
            gl.endQuery(this.timer.TIME_ELAPSED_EXT);
            for (let i = 0; i < 200; i++) {
                await new Promise((r) => setTimeout(r, 10));
                if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
                    return { gpuMs: gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6, timer: true };
                }
            }
        }
        this.setSun(ray, fine);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        return { gpuMs: performance.now() - t0, timer: false };
    }
}
