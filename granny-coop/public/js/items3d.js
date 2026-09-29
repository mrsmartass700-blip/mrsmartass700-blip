// Модели предметов (PBR). Размеры — реальные, в метрах.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const std = (color, metal = 0, rough = 0.5, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, ...extra });
const M = {
  steel: std(0x9aa0a6, 1, 0.32), darkSteel: std(0x44474a, 1, 0.4), brass: std(0xc9a14a, 1, 0.28), wood: std(0x7a4a24, 0, 0.6),
  redRubber: std(0xa02018, 0, 0.7), blackPlastic: std(0x151515, 0, 0.45), red: std(0xa8281c, 0.3, 0.45), green: std(0x2f5a2a, 0, 0.1, { transparent: true, opacity: 0.85 }),
  label: std(0xd8ccaa, 0, 0.8), fur: std(0x8a5a36, 0, 1), black: std(0x080808, 0, 0.3), orange: std(0xe0691e, 0.4, 0.35), rust: std(0x7a2a18, 0.6, 0.6),
};
const mesh = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; return m; };

export function createItem(model, color) {
  const g = new THREE.Group();
  const tint = std(color, 0.8, 0.3);
  switch (model) {
    case 'key': {
      g.add(mesh(new THREE.TorusGeometry(0.018, 0.005, 8, 20), tint, -0.035, 0.006, 0, Math.PI / 2));
      g.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.07, 8), tint, 0.015, 0.006, 0, 0, 0, Math.PI / 2));
      g.add(mesh(new THREE.BoxGeometry(0.004, 0.004, 0.018), tint, 0.045, 0.006, 0.008));
      g.add(mesh(new THREE.BoxGeometry(0.004, 0.004, 0.012), tint, 0.035, 0.006, 0.005));
      break;
    }
    case 'carkey': {
      g.add(mesh(new RoundedBoxGeometry(0.035, 0.012, 0.022, 2, 0.005), M.blackPlastic, -0.02, 0.006, 0));
      g.add(mesh(new THREE.BoxGeometry(0.045, 0.003, 0.009), M.steel, 0.02, 0.006, 0));
      g.add(mesh(new THREE.TorusGeometry(0.012, 0.0025, 6, 14), M.steel, -0.045, 0.006, 0, Math.PI / 2));
      break;
    }
    case 'hammer':
      g.add(mesh(new THREE.CylinderGeometry(0.013, 0.016, 0.32, 10), M.wood, 0, 0.015, 0, 0, 0, Math.PI / 2));
      g.add(mesh(new THREE.BoxGeometry(0.03, 0.028, 0.1), M.darkSteel, 0.17, 0.015, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 10), M.steel, 0.17, 0.015, 0.06, Math.PI / 2));
      g.add(mesh(new THREE.BoxGeometry(0.02, 0.014, 0.06), M.darkSteel, 0.17, 0.02, -0.07, 0.35));
      break;
    case 'pliers':
      for (const s of [-1, 1]) {
        g.add(mesh(new THREE.BoxGeometry(0.11, 0.012, 0.014), M.redRubber, -0.05, 0.007, s * 0.018, 0, s * 0.18));
        g.add(mesh(new THREE.BoxGeometry(0.06, 0.012, 0.012), M.steel, 0.04, 0.007, s * 0.004, 0, -s * 0.08));
      }
      g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.016, 10), M.steel, 0.01, 0.007, 0));
      break;
    case 'fuel': {
      g.add(mesh(new RoundedBoxGeometry(0.34, 0.44, 0.16, 3, 0.03), M.red, 0, 0.22, 0));
      g.add(mesh(new THREE.BoxGeometry(0.22, 0.03, 0.05), M.red, -0.03, 0.47, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.06, 10), M.blackPlastic, 0.12, 0.47, 0, 0, 0, -0.5));
      for (const s of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.26, 0.36, 0.004), M.rust, 0, 0.22, s * 0.081));
      break;
    }
    case 'wrench':
      g.add(mesh(new THREE.BoxGeometry(0.2, 0.008, 0.022), M.steel, 0, 0.004, 0));
      for (const x of [-0.1, 0.1]) {
        g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.008, 12), M.steel, x, 0.004, 0));
        g.add(mesh(new THREE.BoxGeometry(0.014, 0.01, 0.012), M.black, x + Math.sign(x) * 0.012, 0.005, 0));
      }
      break;
    case 'crowbar': {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.3, 0, 0), new THREE.Vector3(0.22, 0, 0), new THREE.Vector3(0.3, 0.02, 0.02), new THREE.Vector3(0.32, 0.06, 0.05)]);
      g.add(mesh(new THREE.TubeGeometry(curve, 30, 0.011, 8), M.rust, 0, 0.012, 0));
      g.add(mesh(new THREE.BoxGeometry(0.03, 0.006, 0.02), M.darkSteel, -0.31, 0.012, 0, 0, 0, 0.2));
      break;
    }
    case 'spray':
      g.add(mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.15, 16), M.orange, 0, 0.075, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.02, 0.028, 0.02, 16), M.steel, 0, 0.16, 0));
      g.add(mesh(new THREE.BoxGeometry(0.018, 0.02, 0.025), M.black, 0, 0.18, 0.004));
      g.add(mesh(new THREE.CylinderGeometry(0.0285, 0.0285, 0.06, 16), M.label, 0, 0.07, 0));
      break;
    case 'bottle': {
      const pts = [[0, 0], [0.034, 0], [0.036, 0.02], [0.036, 0.17], [0.03, 0.2], [0.013, 0.23], [0.012, 0.29], [0.014, 0.3], [0, 0.3]].map(([r, y]) => new THREE.Vector2(r, y));
      g.add(mesh(new THREE.LatheGeometry(pts, 16), M.green));
      g.add(mesh(new THREE.CylinderGeometry(0.0365, 0.0365, 0.07, 16, 1, true), M.label, 0, 0.1, 0));
      break;
    }
    case 'teddy':
      g.add(mesh(new THREE.SphereGeometry(0.075, 14, 12), M.fur, 0, 0.075, 0));
      g.add(mesh(new THREE.SphereGeometry(0.055, 14, 12), M.fur, 0, 0.18, 0));
      for (const s of [-1, 1]) {
        g.add(mesh(new THREE.SphereGeometry(0.02, 8, 8), M.fur, s * 0.04, 0.23, 0));
        g.add(mesh(new THREE.SphereGeometry(0.028, 8, 8), M.fur, s * 0.07, 0.1, -0.01));
        g.add(mesh(new THREE.SphereGeometry(0.03, 8, 8), M.fur, s * 0.04, 0.02, -0.03));
        g.add(mesh(new THREE.SphereGeometry(0.008, 6, 6), M.black, s * 0.02, 0.19, -0.05));
      }
      g.add(mesh(new THREE.SphereGeometry(0.018, 8, 8), std(0xc8a07a, 0, 1), 0, 0.17, -0.05));
      break;
    default:
      g.add(mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), tint, 0, 0.05, 0));
  }
  return g;
}

// капкан
export function createTrap() {
  const g = new THREE.Group();
  const metal = std(0x5a5a5a, 1, 0.5);
  const ring = mesh(new THREE.TorusGeometry(0.2, 0.012, 6, 28), metal, 0, 0.02, 0, Math.PI / 2);
  g.add(ring, mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.015, 14), metal, 0, 0.012, 0));
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; g.add(mesh(new THREE.ConeGeometry(0.012, 0.05, 4), metal, Math.cos(a) * 0.19, 0.05, Math.sin(a) * 0.19)); }
  const chainMat = std(0x444444, 1, 0.5);
  for (let i = 0; i < 6; i++) g.add(mesh(new THREE.TorusGeometry(0.015, 0.004, 5, 8), chainMat, 0.22 + i * 0.025, 0.006, 0.02 * Math.sin(i), Math.PI / 2, i % 2 ? Math.PI / 2 : 0));
  return g;
}
