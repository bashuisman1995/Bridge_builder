// Material properties. Units: metres, kilograms, newtons, euro.
// stiffness = axial rigidity EA (N), spring constant of a beam is EA / length.
export const MATERIALS = {
  road: {
    name: 'Wegdek',
    key: '1',
    color: 0x55565e,
    cost: 200,
    density: 80,
    stiffness: 4e7,
    maxForce: 70000,
    maxLen: 2.5,
  },
  wood: {
    name: 'Hout',
    key: '2',
    color: 0xb3793f,
    cost: 90,
    density: 20,
    stiffness: 2e7,
    maxForce: 55000,
    maxLen: 2.5,
  },
  steel: {
    name: 'Staal',
    key: '3',
    color: 0xc2412d,
    cost: 260,
    density: 55,
    stiffness: 6e7,
    maxForce: 150000,
    maxLen: 4,
  },
  cable: {
    name: 'Kabel',
    key: '4',
    color: 0x2a2d33,
    cost: 140,
    density: 8,
    stiffness: 4e7,
    maxForce: 120000,
    maxLen: 12,
    tensionOnly: true,
  },
};

export const MATERIAL_ORDER = ['road', 'wood', 'steel', 'cable'];

export function beamCost(mat, length) {
  return Math.round(MATERIALS[mat].cost * length);
}
