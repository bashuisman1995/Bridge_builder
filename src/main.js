import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LEVELS, VEHICLES, isInsideTerrain } from './levels.js';
import { MATERIALS, MATERIAL_ORDER, beamCost } from './materials.js';
import { Simulation } from './sim.js';
import { createWorld, createWater, createLights, DECK_TOP } from './world.js';
import { BridgeView, createBeamObject, placeBeam, stressColor } from './bridgeView.js';
import { createVehicle, updateVehicleMesh } from './vehicle.js';
import { Effects } from './effects.js';
import { sfx } from './audio.js';

const GRID = 0.5;
const SIM_STEP = 1 / 60;
const $ = (id) => document.getElementById(id);
const snap = (v) => Math.round(v / GRID) * GRID;
const fmt = (n) => '€' + Math.round(n).toLocaleString('nl-NL');

// ---------------------------------------------------------------- scene setup
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd3f0);
scene.fog = new THREE.Fog(0x9fd3f0, 90, 230);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.62;
controls.minDistance = 6;
controls.maxDistance = 120;

const sun = createLights(scene);
const view = new BridgeView(scene);
const effects = new Effects(scene);

const markerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 });
const marker = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), markerMat);
marker.renderOrder = 10;
scene.add(marker);

const tip = document.createElement('div');
tip.className = 'tip';
Object.assign(tip.style, {
  position: 'fixed', pointerEvents: 'none', fontSize: '12px', padding: '3px 8px', borderRadius: '6px',
  background: 'rgba(0,0,0,0.7)', color: '#fff', display: 'none', whiteSpace: 'nowrap',
});
document.body.appendChild(tip);

// ---------------------------------------------------------------- state
const state = {
  levelIndex: 0,
  level: null,
  design: null,
  tool: 'road',
  startNode: null,
  target: null,
  highlight: {},
  mode: 'build',
  sim: null,
  vehicleMesh: null,
  vehiclePrevX: 0,
  slow: false,
  showStress: true,
  follow: true,
  undo: [],
  redo: [],
  acc: 0,
  resultTimer: null,
};
let worldGroup = null;
let water = null;
let grid = null;
let preview = null;

// ---------------------------------------------------------------- persistence
const storage = {
  get(k) {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k, v) {
    try { localStorage.setItem(k, v); } catch { /* ignore */ }
  },
};

function emptyDesign(level) {
  const nodes = level.anchors.map(([x, y], i) => ({ id: i + 1, x, y, anchor: true }));
  return { nodes, beams: [], nextId: nodes.length + 1 };
}

function loadDesign(level) {
  const raw = storage.get(`bb:design:${level.id}`);
  if (!raw) return emptyDesign(level);
  try {
    const d = JSON.parse(raw);
    // Make sure all anchors of the level exist and are flagged.
    for (const [x, y] of level.anchors) {
      const n = d.nodes.find((m) => m.x === x && m.y === y);
      if (n) n.anchor = true;
      else d.nodes.push({ id: d.nextId++, x, y, anchor: true });
    }
    return d;
  } catch {
    return emptyDesign(level);
  }
}

const saveDesign = () => storage.set(`bb:design:${state.level.id}`, JSON.stringify(state.design));
const isDone = (level) => storage.get(`bb:done:${level.id}`) === '1';

// ---------------------------------------------------------------- design helpers
const nodeById = (id) => state.design.nodes.find((n) => n.id === id);
const nodeAt = (x, y) => state.design.nodes.find((n) => Math.abs(n.x - x) < 1e-6 && Math.abs(n.y - y) < 1e-6);

function beamLength(b) {
  const a = nodeById(b.a);
  const c = nodeById(b.b);
  return Math.hypot(c.x - a.x, c.y - a.y);
}

function totalCost() {
  return state.design.beams.reduce((s, b) => s + beamCost(b.mat, beamLength(b)), 0);
}

function pushUndo() {
  state.undo.push(JSON.stringify(state.design));
  if (state.undo.length > 200) state.undo.shift();
  state.redo = [];
}

function undo() {
  if (!state.undo.length) return;
  state.redo.push(JSON.stringify(state.design));
  state.design = JSON.parse(state.undo.pop());
  state.startNode = null;
  refresh();
}

function redo() {
  if (!state.redo.length) return;
  state.undo.push(JSON.stringify(state.design));
  state.design = JSON.parse(state.redo.pop());
  state.startNode = null;
  refresh();
}

function pruneOrphans() {
  const used = new Set();
  for (const b of state.design.beams) {
    used.add(b.a);
    used.add(b.b);
  }
  state.design.nodes = state.design.nodes.filter((n) => n.anchor || used.has(n.id));
}

function nearestNode(x, y, radius) {
  let best = null;
  let bd = radius;
  for (const n of state.design.nodes) {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

function nearestBeam(x, y, radius) {
  let best = null;
  let bd = radius;
  for (const b of state.design.beams) {
    const a = nodeById(b.a);
    const c = nodeById(b.b);
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(a.x + dx * t - x, a.y + dy * t - y);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

/** Snap the pointer to the grid / a node and clamp to the material's max length. */
function computeTarget(raw) {
  let x = snap(raw.x);
  let y = snap(raw.y);
  const near = nearestNode(raw.x, raw.y, 0.4);
  if (near) {
    x = near.x;
    y = near.y;
  }
  if (state.startNode != null && state.tool !== 'delete') {
    const s = nodeById(state.startNode);
    const maxLen = MATERIALS[state.tool].maxLen;
    if (Math.hypot(x - s.x, y - s.y) > maxLen + 1e-6) {
      const dx = raw.x - s.x;
      const dy = raw.y - s.y;
      const L = Math.hypot(dx, dy) || 1;
      const tx = s.x + (dx / L) * maxLen;
      const ty = s.y + (dy / L) * maxLen;
      let best = null;
      let bd = Infinity;
      for (let i = -3; i <= 3; i++) {
        for (let j = -3; j <= 3; j++) {
          const gx = snap(tx) + i * GRID;
          const gy = snap(ty) + j * GRID;
          const len = Math.hypot(gx - s.x, gy - s.y);
          if (len > maxLen + 1e-6 || len < GRID - 1e-6) continue;
          const d = Math.hypot(gx - tx, gy - ty);
          if (d < bd) {
            bd = d;
            best = [gx, gy];
          }
        }
      }
      if (best) [x, y] = best;
    }
  }
  const existing = nodeAt(x, y);
  return { x, y, nodeId: existing ? existing.id : null };
}

function validateBeam(startId, target) {
  const s = nodeById(startId);
  const len = Math.hypot(target.x - s.x, target.y - s.y);
  if (len < GRID - 1e-6) return 'Te kort';
  if (len > MATERIALS[state.tool].maxLen + 1e-6) return `Te lang (max ${MATERIALS[state.tool].maxLen} m)`;
  if (target.nodeId == null && isInsideTerrain(state.level, target.x, target.y)) return 'Kan niet in de grond bouwen';
  if (target.nodeId != null) {
    const dup = state.design.beams.some(
      (b) => (b.a === startId && b.b === target.nodeId) || (b.b === startId && b.a === target.nodeId),
    );
    if (dup) return 'Hier ligt al een balk';
  }
  return null;
}

function addBeam(startId, target) {
  pushUndo();
  const d = state.design;
  let endId = target.nodeId;
  if (endId == null) {
    endId = d.nextId++;
    d.nodes.push({ id: endId, x: target.x, y: target.y, anchor: false });
  }
  d.beams.push({ id: d.nextId++, a: startId, b: endId, mat: state.tool });
  sfx.place();
  return endId;
}

function deleteAt(raw) {
  const n = nearestNode(raw.x, raw.y, 0.35);
  if (n && !n.anchor) {
    pushUndo();
    state.design.beams = state.design.beams.filter((b) => b.a !== n.id && b.b !== n.id);
    pruneOrphans();
    sfx.remove();
    return true;
  }
  const b = nearestBeam(raw.x, raw.y, 0.35);
  if (b) {
    pushUndo();
    state.design.beams = state.design.beams.filter((m) => m !== b);
    pruneOrphans();
    sfx.remove();
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- UI
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

function buildToolbar() {
  const wrap = $('materialButtons');
  for (const k of MATERIAL_ORDER) {
    const m = MATERIALS[k];
    const b = document.createElement('button');
    b.className = 'tool';
    b.dataset.tool = k;
    b.innerHTML =
      `<span class="swatch" style="background:#${m.color.toString(16).padStart(6, '0')}"></span>` +
      `<span class="tool-name">${m.name}<small>€${m.cost}/m · max ${m.maxLen} m</small></span><kbd>${m.key}</kbd>`;
    wrap.appendChild(b);
  }
  document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
}

function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  if (preview) scene.remove(preview);
  preview = tool === 'delete' ? null : createBeamObject(tool, { ghost: true });
  if (preview) {
    preview.visible = false;
    scene.add(preview);
  }
  if (tool === 'delete') state.startNode = null;
  updatePreview();
}

function buildLevelSelect() {
  const sel = $('levelSelect');
  sel.innerHTML = '';
  LEVELS.forEach((l, i) => {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = (isDone(l) ? '✓ ' : '') + l.name;
    sel.appendChild(o);
  });
  sel.value = state.levelIndex;
}

function updateBudget() {
  const cost = totalCost();
  const budget = state.level.budget;
  $('costText').textContent = fmt(cost);
  $('budgetText').textContent = fmt(budget);
  $('budgetFill').style.width = Math.min(100, (cost / budget) * 100) + '%';
  document.querySelector('.budget').classList.toggle('over', cost > budget);
}

function refresh() {
  if (state.mode === 'build') view.showDesign(state.design, state.highlight);
  updateBudget();
  saveDesign();
  $('undoBtn').disabled = !state.undo.length;
  $('redoBtn').disabled = !state.redo.length;
  updatePreview();
}

function updatePreview() {
  const t = state.target;
  const building = state.mode === 'build' && t;
  marker.visible = !!building && state.tool !== 'delete';
  if (preview) preview.visible = false;
  tip.style.display = 'none';
  if (!building) return;
  marker.position.set(t.x, t.y, 0);
  if (state.tool === 'delete') return;
  const err = state.startNode != null ? validateBeam(state.startNode, t) : null;
  markerMat.color.set(state.startNode == null ? (t.nodeId != null ? 0xf6b73c : 0xffffff) : err ? 0xe5533d : 0x4cc97a);
  if (state.startNode != null && preview) {
    const s = nodeById(state.startNode);
    const len = Math.hypot(t.x - s.x, t.y - s.y);
    if (len > 1e-6) {
      placeBeam(preview, s.x, s.y, t.x, t.y);
      preview.userData.material.color.set(err ? 0xe5533d : MATERIALS[state.tool].color);
      preview.visible = true;
    }
    tip.textContent = err || `${len.toFixed(2)} m · ${fmt(beamCost(state.tool, len))}`;
    tip.style.display = 'block';
  }
}

function showHint() {
  const l = state.level;
  const v = VEHICLES[l.vehicle];
  $('hint').innerHTML =
    `<b>${l.name}</b>${isDone(l) ? ' ✓' : ''}<br>${l.hint}<br>` +
    `<span style="color:var(--muted)">Voertuig: ${v.name} (${v.mass.toLocaleString('nl-NL')} kg)</span>`;
}

// ---------------------------------------------------------------- level / view
function buildGrid(level) {
  const x0 = level.leftEdge - 6;
  const x1 = level.rightEdge + 6;
  const top = Math.max(level.leftY, level.rightY, ...level.anchors.map((a) => a[1])) + 8;
  const y0 = snap(level.waterY + 0.5);
  const minor = [];
  const major = [];
  for (let x = snap(x0); x <= x1; x += GRID) {
    const arr = Math.abs(x / 2.5 - Math.round(x / 2.5)) < 1e-6 ? major : minor;
    arr.push(x, y0, 0, x, top, 0);
  }
  for (let y = y0; y <= top; y += GRID) {
    const arr = Math.abs(y / 2.5 - Math.round(y / 2.5)) < 1e-6 ? major : minor;
    arr.push(x0, y, 0, x1, y, 0);
  }
  const g = new THREE.Group();
  for (const [arr, opacity] of [[minor, 0.13], [major, 0.3]]) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false });
    g.add(new THREE.LineSegments(geo, mat));
  }
  return g;
}

function levelFrame(level) {
  const ys = level.anchors.map((a) => a[1]);
  const midX = (level.leftEdge + level.rightEdge) / 2;
  const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const span = level.rightEdge - level.leftEdge;
  return { midX, midY, span };
}

function resetView(front = state.mode === 'build') {
  const { midX, midY, span } = levelFrame(state.level);
  const dist = Math.max(22, span * 1.25 + 8);
  controls.target.set(midX, midY, 0);
  if (front) camera.position.set(midX, midY + 1.5, dist);
  else camera.position.set(midX - span * 0.6, midY + 6, dist * 0.8);
  controls.update();
}

function setControlsForMode() {
  if (state.mode === 'build') {
    controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_PAN };
  } else {
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  }
}

function loadLevel(i) {
  stopTest();
  state.levelIndex = i;
  const level = (state.level = LEVELS[i]);
  if (worldGroup) scene.remove(worldGroup);
  if (water) scene.remove(water);
  if (grid) scene.remove(grid);
  worldGroup = createWorld(level);
  water = createWater(level);
  grid = buildGrid(level);
  scene.add(worldGroup, water, grid);

  const { midX } = levelFrame(level);
  sun.target.position.set(midX, 0, 0);
  sun.position.set(midX - 20, 35, 25);

  state.design = loadDesign(level);
  state.undo = [];
  state.redo = [];
  state.startNode = null;
  state.highlight = {};
  $('levelSelect').value = i;
  storage.set('bb:level', String(i));
  showHint();
  resetView(true);
  refresh();
}

// ---------------------------------------------------------------- test mode
function startTest() {
  if (state.mode === 'test') return;
  state.mode = 'test';
  document.body.classList.add('testing');
  state.startNode = null;
  state.target = null;
  state.highlight = {};
  grid.visible = false;
  updatePreview();
  state.sim = new Simulation(state.design, state.level);
  view.showSim(state.sim);
  state.vehicleMesh = createVehicle(state.level.vehicle);
  state.vehiclePrevX = state.sim.vehicle.x;
  updateVehicleMesh(state.vehicleMesh, state.sim.vehicle, DECK_TOP, state.vehiclePrevX);
  scene.add(state.vehicleMesh);
  state.acc = 0;
  setControlsForMode();
  $('testBtn').textContent = '■ Stoppen';
}

function stopTest() {
  if (state.mode !== 'test') return;
  state.mode = 'build';
  document.body.classList.remove('testing');
  clearTimeout(state.resultTimer);
  if (state.vehicleMesh) scene.remove(state.vehicleMesh);
  state.vehicleMesh = null;
  state.sim = null;
  effects.clear();
  grid.visible = true;
  $('banner').classList.add('hidden');
  $('testBtn').textContent = '▶ Testen';
  setControlsForMode();
  refresh();
}

function handleSimEvents() {
  const sim = state.sim;
  const tmp = new THREE.Color();
  for (const e of sim.events.splice(0)) {
    if (e.type === 'break') {
      const b = sim.beams[e.beam];
      effects.breakBeam(b, sim.nodes[b.a], sim.nodes[b.b], state.level.waterY, state.showStress ? stressColor(1, tmp) : tmp.set(MATERIALS[b.mat].color));
      sfx.crack();
    } else if (e.type === 'splash') {
      effects.splash(e.x, state.level.waterY);
      sfx.splash();
    } else if (e.type === 'result') {
      state.resultTimer = setTimeout(() => showResult(e.result), e.result === 'success' ? 400 : 900);
    }
  }
}

function showResult(result) {
  const cost = totalCost();
  const budget = state.level.budget;
  const banner = $('banner');
  const underBudget = cost <= budget;
  const win = result === 'success' && underBudget;
  banner.className = 'banner ' + (result === 'success' ? 'success' : 'fail');
  if (result === 'success') {
    $('bannerTitle').textContent = win ? 'Gelukt! 🎉' : 'Bijna!';
    $('bannerText').textContent = win
      ? `De ${VEHICLES[state.level.vehicle].name.toLowerCase()} is veilig overgestoken. Kosten: ${fmt(cost)} van ${fmt(budget)}.`
      : `Het voertuig is over, maar je zit ${fmt(cost - budget)} boven budget.`;
    if (win) {
      storage.set(`bb:done:${state.level.id}`, '1');
      buildLevelSelect();
      showHint();
    }
    sfx.success();
  } else {
    $('bannerTitle').textContent = 'Ingestort!';
    $('bannerText').textContent = 'Het voertuig is in het water beland. Kijk welke balken rood werden en versterk ze.';
    sfx.fail();
  }
  $('bannerNext').classList.toggle('hidden', !win || state.levelIndex >= LEVELS.length - 1);
}

// ---------------------------------------------------------------- input
const raycaster = new THREE.Raycaster();
const buildPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const ndc = new THREE.Vector2();

function pointerWorld(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const p = new THREE.Vector3();
  return raycaster.ray.intersectPlane(buildPlane, p) ? p : null;
}

function setHighlight(h) {
  if (h.beamId === state.highlight.beamId && h.nodeId === state.highlight.nodeId) return;
  state.highlight = h;
  view.showDesign(state.design, h);
}

function updateHover(e) {
  if (state.mode !== 'build') return;
  const raw = pointerWorld(e);
  if (!raw) return;
  state.target = computeTarget(raw);
  tip.style.left = e.clientX + 14 + 'px';
  tip.style.top = e.clientY + 14 + 'px';
  const deleting = state.tool === 'delete' || e.shiftKey;
  if (deleting) {
    const n = nearestNode(raw.x, raw.y, 0.35);
    const b = n && !n.anchor ? null : nearestBeam(raw.x, raw.y, 0.35);
    setHighlight({ nodeId: n && !n.anchor ? n.id : undefined, beamId: b ? b.id : undefined });
  } else {
    setHighlight({});
  }
  updatePreview();
}

let rightDown = null;
canvas.addEventListener('pointermove', updateHover);
canvas.addEventListener('pointerleave', () => {
  state.target = null;
  updatePreview();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  if (state.mode !== 'build') return;
  if (e.button === 2) {
    rightDown = [e.clientX, e.clientY];
    return;
  }
  if (e.button !== 0) return;
  const raw = pointerWorld(e);
  if (!raw) return;
  if (state.tool === 'delete' || e.shiftKey) {
    state.startNode = null;
    if (deleteAt(raw)) {
      state.highlight = {};
      refresh();
    }
    return;
  }
  const t = computeTarget(raw);
  if (state.startNode == null) {
    if (t.nodeId != null) state.startNode = t.nodeId;
    else toast('Begin bij een geel ankerpunt of een bestaand knooppunt');
  } else if (t.nodeId === state.startNode) {
    state.startNode = null;
  } else {
    const err = validateBeam(state.startNode, t);
    if (err) toast(err);
    else {
      state.startNode = addBeam(state.startNode, t);
      refresh();
    }
  }
  state.target = computeTarget(raw);
  updatePreview();
});

canvas.addEventListener('pointerup', (e) => {
  if (e.button === 2 && rightDown) {
    const moved = Math.hypot(e.clientX - rightDown[0], e.clientY - rightDown[1]);
    if (moved < 5) {
      state.startNode = null;
      updatePreview();
    }
    rightDown = null;
  }
});

function toggleTest() {
  if (state.mode === 'build') startTest();
  else stopTest();
}

function toggleButton(id, key) {
  state[key] = !state[key];
  $(id).classList.toggle('on', state[key]);
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLSelectElement) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') {
    e.preventDefault();
    if (state.mode === 'build') (e.shiftKey ? redo : undo)();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && k === 'y') {
    e.preventDefault();
    if (state.mode === 'build') redo();
    return;
  }
  if (k === ' ') {
    e.preventDefault();
    toggleTest();
    return;
  }
  if (k === 'escape') {
    if (state.mode === 'test') stopTest();
    state.startNode = null;
    updatePreview();
    return;
  }
  if (k === 'v') resetView();
  if (k === 's') toggleButton('slowBtn', 'slow');
  if (k === 'b') toggleButton('stressBtn', 'showStress');
  if (k === 'f') toggleButton('followBtn', 'follow');
  if (state.mode !== 'build') return;
  if (k === 'x') setTool('delete');
  const mat = MATERIAL_ORDER.find((m) => MATERIALS[m].key === k);
  if (mat) setTool(mat);
});

$('testBtn').addEventListener('click', toggleTest);
$('slowBtn').addEventListener('click', () => toggleButton('slowBtn', 'slow'));
$('stressBtn').addEventListener('click', () => toggleButton('stressBtn', 'showStress'));
$('followBtn').addEventListener('click', () => toggleButton('followBtn', 'follow'));
$('viewBtn').addEventListener('click', () => resetView());
$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);
$('clearBtn').addEventListener('click', () => {
  if (!state.design.beams.length) return;
  if (!confirm('Alle balken van dit level verwijderen?')) return;
  pushUndo();
  state.design = { ...emptyDesign(state.level) };
  state.startNode = null;
  refresh();
});
$('levelSelect').addEventListener('change', (e) => loadLevel(Number(e.target.value)));
$('bannerRetry').addEventListener('click', stopTest);
$('bannerNext').addEventListener('click', () => loadLevel(Math.min(LEVELS.length - 1, state.levelIndex + 1)));

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------- main loop
const clock = new THREE.Clock();
const followTarget = new THREE.Vector3();
let elapsed = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  elapsed += dt;
  const speed = state.slow ? 0.25 : 1;
  water.userData.update(elapsed);

  if (state.mode === 'test' && state.sim) {
    const sim = state.sim;
    state.acc += dt * speed;
    let steps = 0;
    while (state.acc >= SIM_STEP && steps < 4) {
      sim.step(SIM_STEP);
      state.acc -= SIM_STEP;
      steps++;
      handleSimEvents();
    }
    if (steps === 4) state.acc = 0;
    view.updateSim(sim, state.showStress);
    updateVehicleMesh(state.vehicleMesh, sim.vehicle, DECK_TOP, state.vehiclePrevX);
    state.vehiclePrevX = sim.vehicle.x;
    if (state.follow) {
      followTarget.set(sim.vehicle.x, Math.max(sim.vehicle.y, state.level.waterY) + 1, 0);
      const delta = followTarget.sub(controls.target).multiplyScalar(1 - Math.exp(-2.5 * dt));
      controls.target.add(delta);
      camera.position.add(delta);
    }
  }
  effects.update(dt * speed);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot
buildToolbar();
setTool('road');
setControlsForMode();
resize();
const savedLevel = Number(storage.get('bb:level'));
state.levelIndex = Number.isInteger(savedLevel) && LEVELS[savedLevel] ? savedLevel : 0;
buildLevelSelect();
loadLevel(state.levelIndex);
requestAnimationFrame(frame);

// Handy for debugging in the browser console.
window.bridge = {
  state,
  LEVELS,
  toScreen(x, y) {
    const v = new THREE.Vector3(x, y, 0).project(camera);
    const r = canvas.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  },
};
