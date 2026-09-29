// Модели из примитивов: бабка, игроки, предметы, капкан, замки на двери.
import * as THREE from 'three';
import { fabric } from './textures.js';

const M = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });
const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };

// ================= Бабка =================
export function createGranny() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const dressMat = new THREE.MeshLambertMaterial({ map: fabric('#3d3446') });
  const skin = M(0xcfbfa6);
  const hair = M(0xb9b6ae);
  const dark = M(0x1a1512);

  body.add(mesh(new THREE.CylinderGeometry(0.22, 0.44, 1.0, 12), dressMat, 0, 0.5, 0));
  body.add(mesh(new THREE.CylinderGeometry(0.17, 0.23, 0.5, 12), dressMat, 0, 1.22, 0));
  // фартук
  const apron = mesh(new THREE.BoxGeometry(0.34, 0.7, 0.02), M(0x8d8577), 0, 0.75, -0.3);
  apron.rotation.x = -0.28;
  body.add(apron);
  // сгорбленная спина
  body.add(mesh(new THREE.SphereGeometry(0.2, 12, 10), dressMat, 0, 1.38, 0.08));

  const head = new THREE.Group();
  head.position.set(0, 1.58, -0.05);
  body.add(head);
  head.add(mesh(new THREE.SphereGeometry(0.16, 16, 14), skin));
  const cap = mesh(new THREE.SphereGeometry(0.168, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 0.01, 0.015);
  head.add(cap);
  head.add(mesh(new THREE.SphereGeometry(0.1, 12, 10), hair, 0, 0.1, 0.14)); // пучок
  head.add(mesh(new THREE.SphereGeometry(0.035, 8, 6), skin, 0, -0.02, -0.16)); // нос
  // глаза
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xdedbd2 });
  const eyeL = mesh(new THREE.SphereGeometry(0.025, 8, 6), eyeMat, -0.055, 0.03, -0.14);
  const eyeR = mesh(new THREE.SphereGeometry(0.025, 8, 6), eyeMat, 0.055, 0.03, -0.14);
  head.add(eyeL, eyeR);
  // очки
  const glass = M(0x222222);
  const lensL = mesh(new THREE.TorusGeometry(0.038, 0.006, 6, 14), glass, -0.055, 0.03, -0.15);
  const lensR = mesh(new THREE.TorusGeometry(0.038, 0.006, 6, 14), glass, 0.055, 0.03, -0.15);
  head.add(lensL, lensR);
  // рот
  head.add(mesh(new THREE.BoxGeometry(0.07, 0.012, 0.01), dark, 0, -0.08, -0.145));

  const mkArm = (side) => {
    const a = new THREE.Group();
    a.position.set(0.24 * side, 1.4, 0);
    a.add(mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.55, 8), dressMat, 0, -0.27, 0));
    a.add(mesh(new THREE.SphereGeometry(0.05, 8, 6), skin, 0, -0.57, 0));
    body.add(a);
    return a;
  };
  const armL = mkArm(-1), armR = mkArm(1);
  // бита
  const bat = new THREE.Group();
  bat.position.set(0, -0.58, 0);
  bat.rotation.x = -Math.PI / 2 + 0.3;
  const batMesh = mesh(new THREE.CylinderGeometry(0.055, 0.025, 0.85, 10), M(0x6b4423), 0, 0.38, 0);
  bat.add(batMesh);
  armR.add(bat);

  const eyeLight = new THREE.PointLight(0xff2200, 0, 2.5, 2);
  eyeLight.position.set(0, 0.03, -0.3);
  head.add(eyeLight);

  let phase = 0, attackT = 0, prevAnim = 'idle';
  root.userData.update = (dt, anim, state) => {
    const moving = anim === 'walk' || anim === 'run';
    phase += dt * (anim === 'run' ? 11 : 6.5) * (moving ? 1 : 0.2);
    const angry = state === 'chase' || state === 'attack';
    eyeMat.color.setHex(angry ? 0xff3010 : state === 'stunned' ? 0x777777 : 0xdedbd2);
    eyeLight.intensity = angry ? 1.5 : 0;
    body.position.y = moving ? Math.abs(Math.sin(phase)) * 0.05 : 0;
    body.rotation.x = anim === 'run' ? 0.18 : 0.08;
    body.rotation.z = moving ? Math.sin(phase) * 0.04 : 0;
    head.rotation.y = state === 'look' || state === 'search' ? Math.sin(performance.now() / 500) * 0.6 : 0;

    if (anim === 'attack') {
      if (prevAnim !== 'attack') attackT = 0;
      attackT += dt;
      const k = Math.min(1, attackT / 0.55);
      armR.rotation.x = k < 0.7 ? -2.6 * (k / 0.7) : -2.6 + 3.4 * ((k - 0.7) / 0.3);
      armL.rotation.x = -0.4;
    } else if (anim === 'stunned') {
      armR.rotation.x = 2.5 + Math.sin(performance.now() / 90) * 0.2;
      armL.rotation.x = 2.5 + Math.cos(performance.now() / 90) * 0.2;
      body.rotation.z = Math.sin(performance.now() / 300) * 0.15;
    } else if (anim === 'open') {
      armL.rotation.x = 1.3; armR.rotation.x = 0.3;
    } else {
      armL.rotation.x = moving ? Math.sin(phase) * 0.5 : 0.05;
      armR.rotation.x = moving ? -Math.sin(phase) * 0.35 + 0.3 : 0.3;
    }
    prevAnim = anim;
  };
  root.traverse(o => { o.castShadow = false; });
  return root;
}

// ================= Игрок =================
function labelSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,0.55)';
  const w = Math.min(250, g.measureText(text).width + 24);
  g.fillRect(128 - w / 2, 12, w, 40);
  g.fillStyle = color; g.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(1.1, 0.28, 1);
  s.renderOrder = 10;
  return s;
}

export function createPlayerModel(name, color) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const shirt = M(new THREE.Color(color));
  const skin = M(0xe0b899);
  const jeans = M(0x2c3e50);
  const legL = mesh(new THREE.BoxGeometry(0.14, 0.8, 0.16), jeans, -0.1, 0.4, 0);
  const legR = mesh(new THREE.BoxGeometry(0.14, 0.8, 0.16), jeans, 0.1, 0.4, 0);
  legL.geometry.translate(0, -0.4, 0); legL.position.y = 0.8;
  legR.geometry = legL.geometry; legR.position.y = 0.8;
  body.add(legL, legR);
  body.add(mesh(new THREE.BoxGeometry(0.42, 0.6, 0.22), shirt, 0, 1.1, 0));
  const head = mesh(new THREE.SphereGeometry(0.15, 14, 12), skin, 0, 1.58, 0);
  body.add(head);
  body.add(mesh(new THREE.SphereGeometry(0.155, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), M(0x3a2a1a), 0, 1.6, 0.01));
  const armGeo = new THREE.BoxGeometry(0.11, 0.58, 0.12); armGeo.translate(0, -0.29, 0);
  const armL = mesh(armGeo, shirt, -0.27, 1.38, 0);
  const armR = mesh(armGeo, shirt, 0.27, 1.38, 0);
  body.add(armL, armR);
  const torch = mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.2, 8), M(0x222222), 0, -0.58, -0.08);
  torch.rotation.x = Math.PI / 2;
  armR.add(torch);
  const label = labelSprite(name, color);
  label.position.y = 2.0;
  root.add(label);

  const held = new THREE.Group();
  held.position.set(0, -0.6, -0.05);
  armL.add(held);

  let phase = 0;
  root.userData = {
    held, torch, label,
    update(dt, st) {
      const moving = st.mv && !st.hid;
      phase += dt * (st.run ? 12 : 7) * (moving ? 1 : 0);
      const sw = moving ? Math.sin(phase) * (st.run ? 0.8 : 0.5) : 0;
      legL.rotation.x = sw; legR.rotation.x = -sw;
      armL.rotation.x = -sw * 0.6 + (st.held ? 0.6 : 0);
      armR.rotation.x = 1.2 + (st.pitch || 0) * 0.8; // держит фонарик перед собой
      body.scale.y = st.cr ? 0.62 : 1;
      label.position.y = st.cr ? 1.35 : 2.0;
      head.rotation.x = -(st.pitch || 0) * 0.5;
    },
  };
  return root;
}

// ================= Предметы =================
export function createItemModel(type, color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.25) });
  const metal = new THREE.MeshLambertMaterial({ color: 0x9aa0a6, emissive: 0x222222 });
  const wood = new THREE.MeshLambertMaterial({ color: 0x7a4a24, emissive: 0x1a0d05 });
  switch (type) {
    case 'key': {
      const ring = mesh(new THREE.TorusGeometry(0.05, 0.015, 8, 16), mat, -0.09, 0, 0);
      g.add(ring, mesh(new THREE.BoxGeometry(0.16, 0.02, 0.02), mat, 0.03, 0, 0));
      g.add(mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), mat, 0.09, -0.025, 0), mesh(new THREE.BoxGeometry(0.02, 0.035, 0.02), mat, 0.055, -0.02, 0));
      g.rotation.x = -Math.PI / 2;
      break;
    }
    case 'hammer':
      g.add(mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.32, 8), wood, 0, 0, 0));
      g.add(mesh(new THREE.BoxGeometry(0.14, 0.05, 0.05), metal, 0, 0.16, 0));
      g.rotation.z = Math.PI / 2;
      break;
    case 'pliers': {
      const a = mesh(new THREE.BoxGeometry(0.26, 0.02, 0.025), mat, 0, 0, 0); a.rotation.y = 0.25;
      const b = mesh(new THREE.BoxGeometry(0.26, 0.02, 0.025), mat, 0, 0, 0); b.rotation.y = -0.25;
      g.add(a, b, mesh(new THREE.BoxGeometry(0.08, 0.025, 0.04), metal, 0.14, 0, 0));
      break;
    }
    case 'spray':
      g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.17, 12), mat, 0, 0.085, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 8), M(0x111111), 0, 0.19, 0));
      break;
    case 'bottle':
      g.add(mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.22, 12),
        new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.8, emissive: 0x0c200c }), 0, 0.11, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.015, 0.03, 0.1, 8), mat, 0, 0.27, 0));
      break;
    case 'teddy':
      g.add(mesh(new THREE.SphereGeometry(0.09, 10, 8), mat, 0, 0.09, 0));
      g.add(mesh(new THREE.SphereGeometry(0.065, 10, 8), mat, 0, 0.22, 0));
      g.add(mesh(new THREE.SphereGeometry(0.025, 6, 6), mat, -0.05, 0.28, 0), mesh(new THREE.SphereGeometry(0.025, 6, 6), mat, 0.05, 0.28, 0));
      g.add(mesh(new THREE.SphereGeometry(0.012, 6, 6), M(0x000000), -0.022, 0.23, -0.058), mesh(new THREE.SphereGeometry(0.012, 6, 6), M(0x000000), 0.022, 0.23, -0.058));
      break;
    default:
      g.add(mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15), mat));
  }
  return g;
}

export function createTrap() {
  const g = new THREE.Group();
  const metal = new THREE.MeshLambertMaterial({ color: 0x6d6d6d, emissive: 0x111111 });
  const ring = mesh(new THREE.TorusGeometry(0.22, 0.02, 6, 24), metal, 0, 0.03, 0);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  g.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 12), metal, 0, 0.02, 0));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const t = mesh(new THREE.ConeGeometry(0.02, 0.07, 4), metal, Math.cos(a) * 0.2, 0.07, Math.sin(a) * 0.2);
    g.add(t);
  }
  return g;
}

// Замки на входной двери: {padlock, boards, chain}
export function createExitLocks(axis) {
  const g = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: 0x8b6a45 });
  const metal = new THREE.MeshLambertMaterial({ color: 0x777777, emissive: 0x151515 });
  const gold = new THREE.MeshLambertMaterial({ color: 0xd4af37, emissive: 0x2a2000 });
  const boards = new THREE.Group();
  for (const [y, r] of [[0.7, 0.25], [1.5, -0.2], [2.1, 0.12]]) {
    const b = mesh(new THREE.BoxGeometry(1.5, 0.16, 0.05), wood, 0, y, 0);
    b.rotation.z = r;
    boards.add(b);
  }
  const chain = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const l = mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 10), metal, -0.45 + i * 0.1, 1.2 + Math.sin(i / 8 * Math.PI) * -0.08, 0);
    l.rotation.y = i % 2 ? Math.PI / 2 : 0;
    chain.add(l);
  }
  const padlock = new THREE.Group();
  padlock.add(mesh(new THREE.BoxGeometry(0.14, 0.12, 0.05), gold, 0, 1.05, 0));
  const sh = mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 12, Math.PI), metal, 0, 1.11, 0);
  padlock.add(sh);
  g.add(boards, chain, padlock);
  g.userData = { boards, chain, padlock };
  if (axis === 'z') g.rotation.y = Math.PI / 2;
  return g;
}
