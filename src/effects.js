// Short-lived visual effects: falling beam pieces and water splashes.
import * as THREE from 'three';
import { createBeamObject, placeBeam } from './bridgeView.js';

const dropGeo = new THREE.SphereGeometry(0.12, 6, 4);
const dropMat = new THREE.MeshStandardMaterial({ color: 0xcfeaff, transparent: true, opacity: 0.85 });

export class Effects {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.items = [];
  }

  clear() {
    this.group.clear();
    this.items = [];
  }

  /** Spawn two half beams that fall away from a broken beam. */
  breakBeam(beam, na, nb, waterY, color) {
    const mx = (na.x + nb.x) / 2;
    const my = (na.y + nb.y) / 2;
    for (const [n, sign] of [[na, -1], [nb, 1]]) {
      const obj = createBeamObject(beam.mat, { ownMaterial: true });
      obj.userData.material.color.copy(color);
      placeBeam(obj, n.x, n.y, mx, my);
      this.group.add(obj);
      this.items.push({
        obj,
        vx: n.vx * 0.6 + sign * (0.5 + Math.random()),
        vy: n.vy * 0.6 + Math.random() * 1.5,
        spin: (Math.random() - 0.5) * 6,
        floor: waterY - 4,
        life: 8,
      });
    }
  }

  splash(x, y, count = 60) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(dropGeo, dropMat);
      m.position.set(x + (Math.random() - 0.5) * 2, y, (Math.random() - 0.5) * 3);
      this.group.add(m);
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 3;
      this.items.push({
        obj: m,
        vx: Math.cos(a) * sp,
        vz: Math.sin(a) * sp,
        vy: 4 + Math.random() * 6,
        spin: 0,
        floor: y - 0.2,
        life: 3,
      });
    }
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.vy -= 9.81 * dt;
      it.obj.position.x += it.vx * dt;
      it.obj.position.y += it.vy * dt;
      if (it.vz) it.obj.position.z += it.vz * dt;
      it.obj.rotation.z += it.spin * dt;
      it.life -= dt;
      if (it.obj.position.y < it.floor || it.life <= 0) {
        this.group.remove(it.obj);
        this.items.splice(i, 1);
      }
    }
  }
}
