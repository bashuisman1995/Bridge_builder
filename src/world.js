// Static scenery for a level: cliffs, water, rocks, pillars, trees and hills.
import * as THREE from 'three';

export const DECK_HALF_WIDTH = 2.2; // road is 4.4 m wide
export const TRUSS_Z = 2.1; // side trusses sit at z = ±TRUSS_Z
export const DECK_TOP = 0.15; // road surface is 0.15 m above the beam line

const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a7a68, roughness: 0.95, flatShading: true });
const grassMat = new THREE.MeshStandardMaterial({ color: 0x5fa347, roughness: 1 });
const asphaltMat = new THREE.MeshStandardMaterial({ color: 0x3c3d42, roughness: 0.9 });
const lineMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });
const concreteMat = new THREE.MeshStandardMaterial({ color: 0xb9b5ad, roughness: 0.85 });
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
const leafMats = [0x3f8f3a, 0x4d9e42, 0x2f7a35].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }));

// Deterministic pseudo random so scenery doesn't jump around between rebuilds.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function tree(rand) {
  const g = new THREE.Group();
  const h = 2 + rand() * 2.5;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, h * 0.4, 6), trunkMat);
  trunk.position.y = h * 0.2;
  trunk.castShadow = true;
  g.add(trunk);
  const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.9 + rand() * 0.6, h, 7), leafMats[Math.floor(rand() * leafMats.length)]);
  leaves.position.y = h * 0.4 + h * 0.5;
  leaves.castShadow = true;
  g.add(leaves);
  return g;
}

function cliff(group, x0, x1, top, bottom, rand, side) {
  const w = x1 - x0;
  const cx = (x0 + x1) / 2;
  group.add(box(w, top - bottom, 40, rockMat, cx, (top + bottom) / 2 - 0.3, 0));
  group.add(box(w, 0.3, 40, grassMat, cx, top - 0.15, 0));
  // Road on top of the cliff, flush with the bridge deck surface.
  group.add(box(w, 0.3, DECK_HALF_WIDTH * 2, asphaltMat, cx, top, 0));
  for (let x = x0 + 1; x < x1 - 1; x += 3) {
    group.add(box(1.5, 0.02, 0.15, lineMat, x + 0.75, top + 0.16, 0));
  }
  // Trees, kept away from the road.
  for (let i = 0; i < 14; i++) {
    const t = tree(rand);
    // Only behind the road so trees never block the default camera.
    const z = -(5 + rand() * 16);
    const dist = 2 + rand() * Math.min(24, w - 3);
    const x = side < 0 ? x1 - dist : x0 + dist;
    t.position.set(x, top, z);
    group.add(t);
  }
  // A few boulders on the cliff face for texture.
  for (let i = 0; i < 6; i++) {
    const r = 0.8 + rand() * 1.4;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rockMat);
    const face = side < 0 ? x1 : x0;
    m.position.set(face + side * r * 0.5, bottom + rand() * (top - bottom) * 0.7, (rand() - 0.5) * 30);
    m.rotation.set(rand() * 3, rand() * 3, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
}

export function createWater(level) {
  const geo = new THREE.PlaneGeometry(260, 260, 64, 64);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2a86c0,
    roughness: 0.15,
    metalness: 0.1,
    transparent: true,
    opacity: 0.88,
    flatShading: true,
  });
  const water = new THREE.Mesh(geo, mat);
  water.position.y = level.waterY;
  water.receiveShadow = true;
  const base = geo.attributes.position.array.slice();
  water.userData.update = (t) => {
    const pos = geo.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      const x = base[i];
      const z = base[i + 2];
      pos[i + 1] = Math.sin(x * 0.35 + t * 1.3) * 0.12 + Math.cos(z * 0.3 + t * 0.9) * 0.1;
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  };
  return water;
}

export function createWorld(level) {
  const group = new THREE.Group();
  const rand = rng(level.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const bottom = level.waterY - 12;
  cliff(group, level.leftEdge - 45, level.leftEdge, level.leftY, bottom, rand, -1);
  cliff(group, level.rightEdge, level.rightEdge + 45, level.rightY, bottom, rand, 1);

  for (const r of level.rocks) {
    const w = r.x1 - r.x0;
    group.add(box(w, r.top - bottom, 7, rockMat, (r.x0 + r.x1) / 2, (r.top + bottom) / 2, 0));
    for (let i = 0; i < 5; i++) {
      const s = 0.6 + rand();
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
      m.position.set(r.x0 + rand() * w, level.waterY + rand() * 0.5, (rand() - 0.5) * 7);
      m.castShadow = true;
      group.add(m);
    }
  }

  // Pillars are towers on both sides of the road with a crossbeam on top.
  for (const p of level.pillars) {
    for (const z of [-TRUSS_Z - 0.35, TRUSS_Z + 0.35]) {
      group.add(box(0.8, p.y1 - p.y0 + 0.6, 0.8, concreteMat, p.x, (p.y0 + p.y1) / 2 + 0.3, z));
    }
    group.add(box(0.8, 0.7, TRUSS_Z * 2 + 1.5, concreteMat, p.x, p.y1 + 0.35, 0));
  }

  // Distant hills for depth.
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x7fae6a, roughness: 1, flatShading: true });
  const mid = (level.leftEdge + level.rightEdge) / 2;
  for (let i = 0; i < 9; i++) {
    const r = 12 + rand() * 18;
    const hill = new THREE.Mesh(new THREE.ConeGeometry(r, r * (0.5 + rand() * 0.6), 7), hillMat);
    hill.position.set(mid - 90 + i * 22 + rand() * 8, level.waterY, -70 - rand() * 30);
    group.add(hill);
  }
  return group;
}

export function createLights(scene) {
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x4d6a3a, 1.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  sun.position.set(-20, 35, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const c = sun.shadow.camera;
  c.left = -45;
  c.right = 45;
  c.top = 35;
  c.bottom = -25;
  c.near = 1;
  c.far = 120;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);
  return sun;
}
