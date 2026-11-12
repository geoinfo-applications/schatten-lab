// Orbit camera over a z-up world in metres. Drag pans, right-drag or shift-drag turns, wheel and pinch zoom.

function lookAt(eye, target) {
    const f = normalize(sub(target, eye));
    const s = normalize(cross(f, [0, 0, 1]));
    const u = cross(s, f);
    return [s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0,
        -dot(s, eye), -dot(u, eye), dot(f, eye), 1];
}

function perspective(fovY, aspect, near, far) {
    const t = 1 / Math.tan(fovY / 2);
    return [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
}

function multiply(a, b) {
    const out = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
            for (let k = 0; k < 4; k++) {
                out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
            }
        }
    }
    return new Float32Array(out);
}

function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(a) {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
}

export class Camera {
    constructor(element, onChange) {
        this.element = element;
        this.onChange = onChange;
        this.target = [0, 0, 600];
        this.distance = 90000;
        this.yaw = 0;
        this.pitch = 0.75;
        this.flight = null;
        this.pointers = new Map();
        this.listen();
    }

    set(view) {
        Object.assign(this, view);
        this.flight = null;
        this.onChange();
    }

    view() {
        return { target: [...this.target], distance: this.distance, yaw: this.yaw, pitch: this.pitch };
    }

    eye() {
        const c = Math.cos(this.pitch);
        return [this.target[0] - this.distance * c * Math.sin(this.yaw), this.target[1] - this.distance * c * Math.cos(this.yaw),
            this.target[2] + this.distance * Math.sin(this.pitch)];
    }

    viewProjection(aspect) {
        const view = lookAt(this.eye(), this.target);
        const fov = aspect < 0.8 ? 0.95 : 0.62;
        return multiply(perspective(fov, aspect, this.distance * 0.02, this.distance * 4 + 150000), view);
    }

    flyTo(target, distance) {
        this.flight = { from: this.view(), to: { target, distance, yaw: this.yaw, pitch: Math.max(this.pitch, 0.6) }, t0: performance.now() };
        this.onChange();
    }

    moving() {
        return this.flight !== null;
    }

    step() {
        if (!this.flight) {
            return;
        }
        const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        const t = reduced ? 1 : Math.min(1, (performance.now() - this.flight.t0) / 1400);
        const k = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        const { from, to } = this.flight;
        this.target = from.target.map((v, i) => v + (to.target[i] - v) * k);
        this.distance = Math.exp(Math.log(from.distance) + (Math.log(to.distance) - Math.log(from.distance)) * k);
        this.pitch = from.pitch + (to.pitch - from.pitch) * k;
        if (t >= 1) {
            this.flight = null;
        }
    }

    pan(dx, dy) {
        const scale = this.distance * 0.0016 * (900 / Math.max(400, this.element.clientHeight));
        const s = Math.sin(this.yaw);
        const c = Math.cos(this.yaw);
        this.target[0] += (-dx * c + dy * s / Math.max(0.3, Math.sin(this.pitch))) * scale;
        this.target[1] += (dx * s + dy * c / Math.max(0.3, Math.sin(this.pitch))) * scale;
        this.target[0] = Math.max(-40000, Math.min(40000, this.target[0]));
        this.target[1] = Math.max(-45000, Math.min(45000, this.target[1]));
    }

    turn(dx, dy) {
        this.yaw += dx * 0.005;
        this.pitch = Math.max(0.25, Math.min(1.5, this.pitch + dy * 0.004));
    }

    zoom(factor) {
        this.distance = Math.max(3000, Math.min(180000, this.distance * factor));
    }

    listen() {
        const el = this.element;
        el.addEventListener("contextmenu", (event) => event.preventDefault());
        el.addEventListener("wheel", (event) => {
            event.preventDefault();
            this.flight = null;
            this.zoom(Math.exp(event.deltaY * 0.0012));
            this.onChange();
        }, { passive: false });
        el.addEventListener("pointerdown", (event) => {
            el.setPointerCapture(event.pointerId);
            this.flight = null;
            this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, turn: event.button === 2 || event.shiftKey });
        });
        const end = (event) => this.pointers.delete(event.pointerId);
        el.addEventListener("pointerup", end);
        el.addEventListener("pointercancel", end);
        el.addEventListener("pointermove", (event) => {
            const p = this.pointers.get(event.pointerId);
            if (!p) {
                return;
            }
            const dx = event.clientX - p.x;
            const dy = event.clientY - p.y;
            if (this.pointers.size === 2) {
                const [a, b] = [...this.pointers.values()];
                const before = Math.hypot(a.x - b.x, a.y - b.y);
                p.x = event.clientX;
                p.y = event.clientY;
                const after = Math.hypot(a.x - b.x, a.y - b.y);
                if (before > 0 && after > 0) {
                    this.zoom(before / after);
                }
                this.turn(0, -dy * 0.5);
            } else {
                p.x = event.clientX;
                p.y = event.clientY;
                if (p.turn) {
                    this.turn(dx, -dy);
                } else {
                    this.pan(dx, dy);
                }
            }
            this.onChange();
        });
        el.addEventListener("keydown", (event) => {
            const keys = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
            if (keys[event.key]) {
                this.pan(...keys[event.key]);
            } else if (event.key === "+") {
                this.zoom(0.8);
            } else if (event.key === "-") {
                this.zoom(1.25);
            } else {
                return;
            }
            event.preventDefault();
            this.onChange();
        });
    }
}
