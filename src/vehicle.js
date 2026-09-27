// Low-poly vehicle meshes. Origin sits on the road surface, centred between the axles.
import * as THREE from 'three';
import { VEHICLES } from './levels.js';

const tireMat = new THREE.MeshStandardMaterial({ color: 0x1d1e22, roughness: 0.9 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.7, roughness: 0.3 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fd0ef, metalness: 0.3, roughness: 0.1 });
const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff6c8, emissive: 0xfff0a0, emissiveIntensity: 0.6 });
const cargoMat = new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.7 });

function part(geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function createVehicle(type) {
  const spec = VEHICLES[type];
  const L = spec.length;
  const wheelbase = L * 0.62;
  const bodyMat = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.35, metalness: 0.3 });
  const g = new THREE.Group();
  const r = type === 'truck' ? 0.55 : 0.4;
  const wheels = [];
  const tireGeo = new THREE.CylinderGeometry(r, r, 0.35, 16).rotateX(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.37, 10).rotateX(Math.PI / 2);
  for (const x of [-wheelbase / 2, wheelbase / 2]) {
    for (const z of [-0.85, 0.85]) {
      const w = new THREE.Group();
      w.add(part(tireGeo, tireMat, 0, 0, 0));
      w.add(part(rimGeo, rimMat, 0, 0, 0));
      w.position.set(x, r, z * (type === 'truck' ? 1.1 : 1));
      g.add(w);
      wheels.push(w);
    }
  }

  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  if (type === 'car') {
    g.add(part(box(L, 0.6, 1.8), bodyMat, 0, r + 0.35, 0));
    g.add(part(box(L * 0.5, 0.55, 1.6), bodyMat, -L * 0.05, r + 0.9, 0));
    g.add(part(box(L * 0.52, 0.42, 1.62), glassMat, -L * 0.05, r + 0.9, 0));
  } else if (type === 'van') {
    g.add(part(box(L, 1.5, 1.9), bodyMat, 0, r + 0.9, 0));
    g.add(part(box(0.1, 0.6, 1.7), glassMat, L / 2, r + 1.2, 0));
  } else {
    g.add(part(box(L * 0.28, 1.7, 2.2), bodyMat, L * 0.36, r + 1.05, 0));
    g.add(part(box(0.1, 0.7, 2.0), glassMat, L * 0.5, r + 1.45, 0));
    g.add(part(box(L * 0.7, 2.1, 2.3), cargoMat, -L * 0.14, r + 1.3, 0));
    g.add(part(box(L, 0.25, 2.1), rimMat, 0, r + 0.15, 0));
  }
  for (const z of [-0.6, 0.6]) g.add(part(box(0.08, 0.2, 0.3), lightMat, L / 2, r + 0.45, z));

  g.userData = { wheels, radius: r, distance: 0 };
  return g;
}

export function updateVehicleMesh(mesh, veh, deckTop, prevX) {
  mesh.position.set(veh.x, veh.y + deckTop, 0);
  mesh.rotation.z = veh.angle;
  const d = veh.x - prevX;
  for (const w of mesh.userData.wheels) w.rotation.z -= d / mesh.userData.radius;
}
