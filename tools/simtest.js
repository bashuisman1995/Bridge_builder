// Headless sanity check of the physics: good designs must hold, bad ones must fail.
// Run with: npm test
import { Simulation } from '../src/sim.js';
import { LEVELS } from '../src/levels.js';
import { beamCost } from '../src/materials.js';

function builder(level) {
  const nodes = [];
  const beams = [];
  const anchorSet = new Set(level.anchors.map(([x, y]) => `${x},${y}`));
  const node = (x, y) => {
    const k = `${x},${y}`;
    let n = nodes.find((m) => m.key === k);
    if (!n) {
      n = { id: nodes.length + 1, key: k, x, y, anchor: anchorSet.has(k) };
      nodes.push(n);
    }
    return n.id;
  };
  const beam = (x0, y0, x1, y1, mat) => beams.push({ a: node(x0, y0), b: node(x1, y1), mat });
  const cost = () =>
    beams.reduce((s, b) => {
      const a = nodes[b.a - 1];
      const c = nodes[b.b - 1];
      return s + beamCost(b.mat, Math.hypot(c.x - a.x, c.y - a.y));
    }, 0);
  return { beam, design: { nodes, beams }, cost };
}

// Road from (x0,y0) to (x1,y1) in n panels plus a truss at offset dy (negative = below).
function trussBridge(level, { x0, y0, x1, y1, panels, dy, mat, road = true, chord = true }, B = builder(level)) {
  const px = (i) => x0 + ((x1 - x0) * i) / panels;
  const py = (i) => y0 + ((y1 - y0) * i) / panels;
  for (let i = 0; i < panels; i++) {
    if (road) B.beam(px(i), py(i), px(i + 1), py(i + 1), 'road');
  }
  if (dy) {
    for (let i = 0; i < panels; i++) {
      const cx = (px(i) + px(i + 1)) / 2;
      const cy = (py(i) + py(i + 1)) / 2 + dy;
      B.beam(px(i), py(i), cx, cy, mat);
      B.beam(cx, cy, px(i + 1), py(i + 1), mat);
      if (chord && i < panels - 1) {
        const nx = (px(i + 1) + px(i + 2)) / 2;
        const ny = (py(i + 1) + py(i + 2)) / 2 + dy;
        B.beam(cx, cy, nx, ny, mat);
      }
    }
  }
  return B;
}

function run(name, level, B, expect) {
  const sim = new Simulation(B.design, level);
  const dt = 1 / 60;
  let maxStress = 0;
  while (!sim.result && sim.time < 40) {
    sim.step(dt);
    for (const b of sim.beams) if (!b.broken) maxStress = Math.max(maxStress, b.stress);
  }
  const broken = sim.beams.filter((b) => b.broken).length;
  const result = sim.result || 'timeout';
  const ok = result === expect;
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} ${level.name.padEnd(24)} ${name.padEnd(28)} -> ${result.padEnd(8)} ` +
      `broken=${broken} maxStress=${maxStress.toFixed(2)} cost=${B.cost()}/${level.budget}`,
  );
  return ok;
}

const L = Object.fromEntries(LEVELS.map((l) => [l.id, l]));
let allOk = true;
const check = (...a) => (allOk = run(...a) && allOk);

check('alleen wegdek', L.sloot, trussBridge(L.sloot, { x0: 0, y0: 0, x1: 10, y1: 0, panels: 4 }), 'fail');
check('geen brug', L.sloot, builder(L.sloot), 'fail');
check('hout truss eronder', L.sloot, trussBridge(L.sloot, { x0: 0, y0: 0, x1: 10, y1: 0, panels: 5, dy: -1.5, mat: 'wood' }), 'success');

check('alleen wegdek', L.rivier, trussBridge(L.rivier, { x0: 0, y0: 0, x1: 16, y1: 0, panels: 8 }), 'fail');
check('hout truss erboven', L.rivier, trussBridge(L.rivier, { x0: 0, y0: 0, x1: 16, y1: 0, panels: 8, dy: 1.5, mat: 'wood' }), 'fail');
check('staal truss erboven', L.rivier, trussBridge(L.rivier, { x0: 0, y0: 0, x1: 16, y1: 0, panels: 8, dy: 1.5, mat: 'steel' }), 'success');
{
  // Arch-supported: wood truss below, extra struts to the low anchors.
  const B = trussBridge(L.rivier, { x0: 0, y0: 0, x1: 16, y1: 0, panels: 8, dy: -1.5, mat: 'wood' });
  B.beam(0, -3, 1, -1.5, 'wood');
  B.beam(16, -3, 15, -1.5, 'wood');
  check('hout truss eronder + steun', L.rivier, B, 'success');
}

check('alleen wegdek', L.scheef, trussBridge(L.scheef, { x0: 0, y0: 0, x1: 14, y1: 2, panels: 7 }), 'fail');
check('staal truss eronder', L.scheef, trussBridge(L.scheef, { x0: 0, y0: 0, x1: 14, y1: 2, panels: 7, dy: -1.5, mat: 'steel' }), 'success');

{
  const B = trussBridge(L.rots, { x0: 0, y0: 0, x1: 24, y1: 0, panels: 12, dy: 1.5, mat: 'wood' });
  check('hout truss zonder rots', L.rots, B, 'fail');
}
{
  // Two steel spans resting on the rock via struts.
  const B = trussBridge(L.rots, { x0: 0, y0: 0, x1: 24, y1: 0, panels: 12, dy: 1.5, mat: 'steel' });
  B.beam(11, -3, 10, 0, 'steel');
  B.beam(11, -3, 12, 0, 'steel');
  B.beam(13, -3, 12, 0, 'steel');
  B.beam(13, -3, 14, 0, 'steel');
  check('staal truss + rots', L.rots, B, 'success');
}

{
  // Suspension bridge: road in 2.5 m panels, cables from pillar tops to deck nodes.
  const B = builder(L.kloof);
  const n = 12;
  for (let i = 0; i < n; i++) B.beam(i * 2.5, 0, (i + 1) * 2.5, 0, 'road');
  for (let i = 1; i < n; i++) {
    const x = i * 2.5;
    const [ax, ay] = x <= 15 ? [-1, 9] : [31, 9];
    if (Math.hypot(x - ax, ay) <= 12) B.beam(ax, ay, x, 0, 'cable');
  }
  check('alleen kabels (te kort)', L.kloof, B, 'fail');
}
{
  const B = builder(L.kloof);
  const n = 12;
  for (let i = 0; i < n; i++) B.beam(i * 2.5, 0, (i + 1) * 2.5, 0, 'road');
  // Main cable: parabola between the pillar tops through (15, 3).
  const cy = (x) => 3 + (6 * ((x - 15) / 16) ** 2);
  const pts = [[-1, 9]];
  for (let i = 1; i < n; i++) pts.push([i * 2.5, Math.round(cy(i * 2.5) * 2) / 2]);
  pts.push([31, 9]);
  for (let i = 0; i < pts.length - 1; i++) B.beam(...pts[i], ...pts[i + 1], 'cable');
  for (let i = 1; i < n; i++) B.beam(i * 2.5, pts[i][1], i * 2.5, 0, 'cable');
  check('hangbrug', L.kloof, B, 'success');
}

console.log(allOk ? '\nAlle checks geslaagd.' : '\nEr zijn checks mislukt.');
process.exit(allOk ? 0 : 1);
