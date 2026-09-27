// 2D truss simulation using small-step XPBD. Pure logic, no rendering.
import { MATERIALS } from './materials.js';
import { VEHICLES, terrainHeight } from './levels.js';

export const GRAVITY = 9.81;
const JOINT_MASS = 15;
const SUBSTEPS = 24;
const AXIAL_DAMPING = 0.08;
const GLOBAL_DAMPING = 0.4;
const FORCE_SMOOTHING = 0.15;
const START_DELAY = 1.5;
const GRAVITY_RAMP = 1.0; // seconds to fade in gravity, avoids a shock load at start

export class Simulation {
  /**
   * @param design {nodes:[{id,x,y,anchor}], beams:[{a,b,mat}]} (a/b are node ids)
   */
  constructor(design, level) {
    this.level = level;
    const index = new Map();
    this.nodes = design.nodes.map((n, i) => {
      index.set(n.id, i);
      return { x: n.x, y: n.y, vx: 0, vy: 0, ox: 0, oy: 0, fx: 0, fy: 0, mass: JOINT_MASS, fixed: !!n.anchor, w: 0 };
    });
    this.beams = design.beams.map((b) => {
      const a = index.get(b.a);
      const c = index.get(b.b);
      const mat = MATERIALS[b.mat];
      const na = this.nodes[a];
      const nb = this.nodes[c];
      const rest = Math.hypot(nb.x - na.x, nb.y - na.y);
      const mass = mat.density * rest;
      na.mass += mass / 2;
      nb.mass += mass / 2;
      return { a, b: c, mat: b.mat, rest, compliance: rest / mat.stiffness, force: 0, stress: 0, broken: false };
    });
    for (const n of this.nodes) n.w = n.fixed ? 0 : 1 / n.mass;

    const vt = VEHICLES[level.vehicle];
    const startX = level.leftEdge - 6;
    this.vehicle = {
      type: level.vehicle,
      mass: vt.mass,
      speed: vt.speed,
      wheelbase: vt.length * 0.62,
      x: startX,
      y: level.leftY,
      vy: 0,
      angle: 0,
      spin: 0,
      state: 'waiting', // waiting | drive | fall | done
      axles: [{ y: level.leftY }, { y: level.leftY }],
    };
    this.finishX = level.rightEdge + 5;
    this.time = 0;
    this.result = null; // 'success' | 'fail'
    this.events = [];
  }

  step(dt) {
    const h = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) this.substep(h);
  }

  substep(h) {
    this.time += h;
    const nodes = this.nodes;
    const beams = this.beams;
    const veh = this.vehicle;

    // External forces.
    const g = GRAVITY * Math.min(1, this.time / GRAVITY_RAMP);
    for (const n of nodes) {
      n.fx = 0;
      n.fy = -n.mass * g;
    }
    this.updateVehicle(h);

    // Predict.
    const damp = Math.exp(-GLOBAL_DAMPING * h);
    for (const n of nodes) {
      if (n.w === 0) continue;
      n.vx = (n.vx + n.fx * n.w * h) * damp;
      n.vy = (n.vy + n.fy * n.w * h) * damp;
      n.ox = n.x;
      n.oy = n.y;
      n.x += n.vx * h;
      n.y += n.vy * h;
    }

    // Solve beams.
    const h2 = h * h;
    for (const b of beams) {
      if (b.broken) continue;
      const na = nodes[b.a];
      const nb = nodes[b.b];
      const w = na.w + nb.w;
      const dx = nb.x - na.x;
      const dy = nb.y - na.y;
      const len = Math.hypot(dx, dy) || 1e-9;
      const C = len - b.rest;
      if (w === 0) continue;
      if (MATERIALS[b.mat].tensionOnly && C < 0) {
        b.force += (0 - b.force) * FORCE_SMOOTHING;
        continue;
      }
      const alpha = b.compliance / h2;
      const dl = -C / (w + alpha);
      const nx = dx / len;
      const ny = dy / len;
      na.x -= na.w * dl * nx;
      na.y -= na.w * dl * ny;
      nb.x += nb.w * dl * nx;
      nb.y += nb.w * dl * ny;
      const force = -dl / h2; // positive = tension
      b.force += (force - b.force) * FORCE_SMOOTHING;
    }

    // Update velocities.
    for (const n of nodes) {
      if (n.w === 0) continue;
      n.vx = (n.x - n.ox) / h;
      n.vy = (n.y - n.oy) / h;
    }

    // Axial damping + breaking.
    for (let i = 0; i < beams.length; i++) {
      const b = beams[i];
      if (b.broken) continue;
      const na = nodes[b.a];
      const nb = nodes[b.b];
      const w = na.w + nb.w;
      const mat = MATERIALS[b.mat];
      b.stress = Math.abs(b.force) / mat.maxForce;
      if (mat.tensionOnly && b.force < 0) b.stress = 0;
      if (b.stress > 1) {
        b.broken = true;
        this.events.push({ type: 'break', beam: i });
        continue;
      }
      if (w === 0) continue;
      const dx = nb.x - na.x;
      const dy = nb.y - na.y;
      const len = Math.hypot(dx, dy) || 1e-9;
      const nx = dx / len;
      const ny = dy / len;
      const rv = (nb.vx - na.vx) * nx + (nb.vy - na.vy) * ny;
      if (mat.tensionOnly && len < b.rest) continue;
      const imp = (rv * AXIAL_DAMPING) / w;
      na.vx += na.w * imp * nx;
      na.vy += na.w * imp * ny;
      nb.vx -= nb.w * imp * nx;
      nb.vy -= nb.w * imp * ny;
    }

    // Stop simulating debris far below the water.
    const floor = this.level.waterY - 6;
    for (const n of nodes) {
      if (n.w !== 0 && n.y < floor) {
        n.w = 0;
        n.vx = n.vy = 0;
      }
    }
  }

  /** Find the road surface under x, near the expected height y. */
  support(x, y) {
    const t = terrainHeight(this.level, x);
    if (t !== null) return { y: t, beam: -1, t: 0 };
    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < this.beams.length; i++) {
      const b = this.beams[i];
      if (b.broken || b.mat !== 'road') continue;
      const na = this.nodes[b.a];
      const nb = this.nodes[b.b];
      const x0 = Math.min(na.x, nb.x);
      const x1 = Math.max(na.x, nb.x);
      if (x < x0 || x > x1 || x1 - x0 < 0.05) continue;
      const u = (x - na.x) / (nb.x - na.x);
      const sy = na.y + (nb.y - na.y) * u;
      const d = sy - y;
      if (d > 0.6 || d < -0.9) continue;
      if (Math.abs(d) < bestDist) {
        bestDist = Math.abs(d);
        best = { y: sy, beam: i, t: u };
      }
    }
    return best;
  }

  updateVehicle(h) {
    const v = this.vehicle;
    if (v.state === 'waiting') {
      if (this.time >= START_DELAY) v.state = 'drive';
      return;
    }
    if (v.state === 'done') return;

    if (v.state === 'drive') {
      v.x += v.speed * h;
      const half = v.wheelbase / 2;
      const xs = [v.x - half, v.x + half];
      const sup = xs.map((ax, i) => this.support(ax, v.axles[i].y));
      if (sup[0] && sup[1]) {
        for (let i = 0; i < 2; i++) {
          v.axles[i].y = sup[i].y;
          if (sup[i].beam >= 0) {
            const b = this.beams[sup[i].beam];
            const load = (v.mass * GRAVITY) / 2;
            this.nodes[b.a].fy -= load * (1 - sup[i].t);
            this.nodes[b.b].fy -= load * sup[i].t;
          }
        }
        const ny = (sup[0].y + sup[1].y) / 2;
        v.vy = (ny - v.y) / h;
        v.y = ny;
        v.angle = Math.atan2(sup[1].y - sup[0].y, v.wheelbase);
        if (v.x >= this.finishX) {
          v.state = 'done';
          this.setResult('success');
        }
      } else {
        v.state = 'fall';
        v.vy = Math.min(v.vy, 0);
        v.spin = sup[1] ? 0.4 : -0.9;
        this.events.push({ type: 'fall' });
      }
      return;
    }

    // Falling.
    v.vy -= GRAVITY * h;
    v.y += v.vy * h;
    v.x += v.speed * 0.6 * h;
    v.angle += v.spin * h;
    if (v.y < this.level.waterY - 0.5) {
      v.state = 'done';
      this.events.push({ type: 'splash', x: v.x });
      this.setResult('fail');
    }
  }

  setResult(r) {
    if (this.result) return;
    this.result = r;
    this.events.push({ type: 'result', result: r });
  }
}
