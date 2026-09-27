// Level definitions. The bridge is designed in the x/y plane (y up).
// leftEdge/rightEdge: x of the cliff faces, leftY/rightY: height of the road on each side.
export const VEHICLES = {
  car: { name: 'Auto', mass: 1200, speed: 4, length: 3.6, color: 0x2f7dd1 },
  van: { name: 'Busje', mass: 2200, speed: 3.5, length: 4.4, color: 0xf0b429 },
  truck: { name: 'Vrachtwagen', mass: 4000, speed: 3, length: 5.6, color: 0x3aa162 },
};

export const LEVELS = [
  {
    id: 'sloot',
    name: '1. De Sloot',
    hint: 'Leg een wegdek en ondersteun het met houten driehoeken.',
    leftEdge: 0, rightEdge: 10, leftY: 0, rightY: 0, waterY: -6,
    budget: 5000,
    vehicle: 'car',
    anchors: [[0, 0], [10, 0], [0, -2], [10, -2]],
    rocks: [], pillars: [],
  },
  {
    id: 'rivier',
    name: '2. De Rivier',
    hint: 'Een langere overspanning: een vakwerk (truss) boven of onder de weg helpt.',
    leftEdge: 0, rightEdge: 16, leftY: 0, rightY: 0, waterY: -7,
    budget: 9000,
    vehicle: 'car',
    anchors: [[0, 0], [16, 0], [0, -3], [16, -3]],
    rocks: [], pillars: [],
  },
  {
    id: 'scheef',
    name: '3. Scheve Oversteek',
    hint: 'De overkant ligt hoger. Het busje is zwaarder.',
    leftEdge: 0, rightEdge: 14, leftY: 0, rightY: 2, waterY: -7,
    budget: 14000,
    vehicle: 'van',
    anchors: [[0, 0], [14, 2], [0, -3], [14, -1]],
    rocks: [], pillars: [],
  },
  {
    id: 'rots',
    name: '4. Rots in de Branding',
    hint: 'Gebruik de rots in het midden als steunpunt voor de vrachtwagen.',
    leftEdge: 0, rightEdge: 24, leftY: 0, rightY: 0, waterY: -8,
    budget: 27000,
    vehicle: 'truck',
    anchors: [[0, 0], [24, 0], [0, -3], [24, -3], [11, -3], [13, -3]],
    rocks: [{ x0: 10.5, x1: 13.5, top: -3 }],
    pillars: [],
  },
  {
    id: 'kloof',
    name: '5. De Grote Kloof',
    hint: 'Te ver voor alleen balken. Hang de weg op aan kabels vanaf de pijlers.',
    leftEdge: 0, rightEdge: 30, leftY: 0, rightY: 0, waterY: -10,
    budget: 20000,
    vehicle: 'car',
    anchors: [[0, 0], [30, 0], [0, -3], [30, -3], [-1, 9], [31, 9]],
    rocks: [],
    pillars: [{ x: -1, y0: 0, y1: 9 }, { x: 31, y0: 0, y1: 9 }],
  },
];

export function terrainHeight(level, x) {
  if (x <= level.leftEdge) return level.leftY;
  if (x >= level.rightEdge) return level.rightY;
  return null;
}

export function isInsideTerrain(level, x, y) {
  const eps = 1e-6;
  if (x < level.leftEdge - eps && y < level.leftY + eps) return true;
  if (x > level.rightEdge + eps && y < level.rightY + eps) return true;
  for (const r of level.rocks) {
    if (x > r.x0 + eps && x < r.x1 - eps && y < r.top - eps) return true;
  }
  return false;
}
