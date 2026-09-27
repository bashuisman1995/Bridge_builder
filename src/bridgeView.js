// 3D representation of a 2D bridge design. Each beam becomes a road slab
// or a pair of side members (one per truss at z = ±TRUSS_Z).
import * as THREE from 'three';
import { MATERIALS } from './materials.js';
import { TRUSS_Z, DECK_HALF_WIDTH } from './world.js';

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 8).rotateZ(Math.PI / 2);
const boltGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.5, 12).rotateX(Math.PI / 2);
const anchorGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.55, 16).rotateX(Math.PI / 2);

const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.6 });
const boltMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.6, roughness: 0.35 });
const anchorMat = new THREE.MeshStandardMaterial({ color: 0xf6b73c, metalness: 0.3, roughness: 0.4, emissive: 0x3a2500 });

const baseMaterials = {};
for (const [k, m] of Object.entries(MATERIALS)) {
  baseMaterials[k] = new THREE.MeshStandardMaterial({
    color: m.color,
    roughness: k === 'steel' ? 0.45 : 0.8,
    metalness: k === 'steel' || k === 'cable' ? 0.4 : 0.05,
  });
}

// Cross-section per material: [height, depth] of each side member.
const SECTION = {
  wood: [0.26, 0.26],
  steel: [0.3, 0.2],
  cable: [0.08, 0.08],
};

const lowColor = new THREE.Color(0x3fbf5f);
const midColor = new THREE.Color(0xf2d33b);
const highColor = new THREE.Color(0xe5533d);

export function stressColor(s, target) {
  s = Math.min(1, Math.max(0, s));
  if (s < 0.5) return target.copy(lowColor).lerp(midColor, s * 2);
  return target.copy(midColor).lerp(highColor, (s - 0.5) * 2);
}

/** A beam object: group positioned at the beam start, rotated along the beam. */
export function createBeamObject(mat, { ownMaterial = false, ghost = false } = {}) {
  const group = new THREE.Group();
  let material = ownMaterial || ghost ? baseMaterials[mat].clone() : baseMaterials[mat];
  if (ghost) {
    material.transparent = true;
    material.opacity = 0.55;
    material.depthWrite = false;
  }
  const parts = [];
  if (mat === 'road') {
    const slab = new THREE.Mesh(unitBox, material);
    slab.scale.set(1, 0.3, DECK_HALF_WIDTH * 2);
    parts.push(slab);
    if (!ghost) {
      const stripe = new THREE.Mesh(unitBox, stripeMat);
      stripe.scale.set(1, 0.02, 0.15);
      stripe.position.y = 0.16;
      stripe.userData.stripe = true;
      parts.push(stripe);
    }
  } else {
    const [h, d] = SECTION[mat];
    for (const z of [-TRUSS_Z, TRUSS_Z]) {
      const m = new THREE.Mesh(mat === 'cable' ? unitCyl : unitBox, material);
      m.scale.set(1, h, d);
      m.position.z = z;
      parts.push(m);
    }
  }
  for (const p of parts) {
    p.castShadow = !ghost;
    p.receiveShadow = !ghost;
    group.add(p);
  }
  group.userData = { mat, material, parts };
  return group;
}

export function placeBeam(obj, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  obj.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
  obj.rotation.set(0, 0, Math.atan2(dy, dx));
  for (const p of obj.userData.parts) {
    p.scale.x = p.userData.stripe ? len * 0.45 : len + (obj.userData.mat === 'road' ? 0.05 : 0);
  }
}

export function createNodeObject(anchor) {
  const g = new THREE.Group();
  for (const z of [-TRUSS_Z, TRUSS_Z]) {
    const m = new THREE.Mesh(anchor ? anchorGeo : boltGeo, anchor ? anchorMat : boltMat);
    m.position.z = z;
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

/** Renders a design (build mode) or a running simulation (test mode). */
export class BridgeView {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.beamObjs = [];
    this.nodeObjs = [];
    this.tmpColor = new THREE.Color();
  }

  clear() {
    for (const o of this.beamObjs) {
      if (o.userData.material !== baseMaterials[o.userData.mat]) o.userData.material.dispose();
    }
    this.group.clear();
    this.beamObjs = [];
    this.nodeObjs = [];
  }

  /** Build-mode: design with node ids. highlight = {beamId, nodeId} to tint for delete-hover. */
  showDesign(design, highlight = {}) {
    this.clear();
    const byId = new Map(design.nodes.map((n) => [n.id, n]));
    for (const b of design.beams) {
      const a = byId.get(b.a);
      const c = byId.get(b.b);
      const hl = highlight.beamId === b.id;
      const obj = createBeamObject(b.mat, { ownMaterial: hl });
      if (hl) obj.userData.material.color.set(0xff4d3d);
      placeBeam(obj, a.x, a.y, c.x, c.y);
      this.group.add(obj);
      this.beamObjs.push(obj);
    }
    for (const n of design.nodes) {
      const obj = createNodeObject(n.anchor);
      obj.position.set(n.x, n.y, 0);
      if (highlight.nodeId === n.id) obj.scale.setScalar(1.6);
      this.group.add(obj);
      this.nodeObjs.push(obj);
    }
  }

  /** Test-mode: one object per sim beam/node, updated each frame. */
  showSim(sim) {
    this.clear();
    for (const b of sim.beams) {
      const obj = createBeamObject(b.mat, { ownMaterial: true });
      this.group.add(obj);
      this.beamObjs.push(obj);
    }
    for (const n of sim.nodes) {
      const obj = createNodeObject(n.fixed);
      this.group.add(obj);
      this.nodeObjs.push(obj);
    }
    this.updateSim(sim, true);
  }

  updateSim(sim, showStress) {
    sim.beams.forEach((b, i) => {
      const obj = this.beamObjs[i];
      if (b.broken) {
        obj.visible = false;
        return;
      }
      const na = sim.nodes[b.a];
      const nb = sim.nodes[b.b];
      placeBeam(obj, na.x, na.y, nb.x, nb.y);
      const m = obj.userData.material;
      if (showStress) stressColor(b.stress, m.color);
      else m.color.set(MATERIALS[b.mat].color);
    });
    sim.nodes.forEach((n, i) => {
      const obj = this.nodeObjs[i];
      obj.position.set(n.x, n.y, 0);
      // Hide joints that no longer hold any beam.
      obj.visible = n.fixed || sim.beams.some((b) => !b.broken && (b.a === i || b.b === i));
    });
  }
}
