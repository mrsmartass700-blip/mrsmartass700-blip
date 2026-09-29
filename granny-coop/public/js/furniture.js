// Детализированная мебель и реквизит. Статичные детали собираются в «пакеты» по материалам (мало draw-call'ов).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------- пакетирование ----------------
export class Batcher {
  constructor() { this.byMat = new Map(); }
  add(geo, mat, matrix) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(matrix);
    if (!this.byMat.has(mat)) this.byMat.set(mat, []);
    this.byMat.get(mat).push(g);
  }
  build(parent, { shadows = true } = {}) {
    for (const [mat, list] of this.byMat) {
      const merged = mergeGeometries(list, false);
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = shadows && !mat.transparent; m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      parent.add(m);
    }
    this.byMat.clear();
  }
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const geoCache = new Map();
const G = (key, fn) => { if (!geoCache.has(key)) geoCache.set(key, fn()); return geoCache.get(key); };
const BOX = () => G('box', () => new THREE.BoxGeometry(1, 1, 1));
const RBOX = (r) => G('rbox' + r, () => new RoundedBoxGeometry(1, 1, 1, 3, r));
const CYL = (seg = 16) => G('cyl' + seg, () => new THREE.CylinderGeometry(0.5, 0.5, 1, seg));
const SPH = (seg = 16) => G('sph' + seg, () => new THREE.SphereGeometry(0.5, seg, Math.max(8, seg * 0.75)));
const lathe = (key, pts, seg = 16) => G('lathe' + key, () => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg));

// Контекст сборки: базовая матрица T (позиция/поворот мебели) + пакет
export class Builder {
  constructor(batch, mats) { this.b = batch; this.m = mats; this.T = new THREE.Matrix4(); }
  at(x, y, z, ry = 0) { this.T.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(0, ry, 0)), _s.set(1, 1, 1)); return this; }
  put(geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
    this.b.add(geo, mat, new THREE.Matrix4().multiplyMatrices(this.T, _m));
  }
  box(mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) { this.put(BOX(), mat, x, y, z, w, h, d, rx, ry, rz); }
  rbox(mat, w, h, d, x, y, z, r = 0.1, ry = 0) { this.put(RBOX(r), mat, x, y, z, w, h, d, 0, ry, 0); }
  cyl(mat, rad, h, x, y, z, rx = 0, rz = 0, seg = 16, ry = 0) { this.put(CYL(seg), mat, x, y, z, rad * 2, h, rad * 2, rx, ry, rz); }
  sph(mat, rx, ry, rz, x, y, z, seg = 16) { this.put(SPH(seg), mat, x, y, z, rx * 2, ry * 2, rz * 2); }
  lathe(key, pts, mat, x, y, z, s = 1, seg = 16) { this.put(lathe(key, pts, seg), mat, x, y, z, s, s, s); }
}

// точёная ножка
const LEG = [[0.0, 0], [0.028, 0], [0.03, 0.04], [0.022, 0.08], [0.02, 0.3], [0.03, 0.36], [0.022, 0.42], [0.026, 0.6], [0.034, 0.66], [0.034, 0.72], [0, 0.72]];

// ---------------- мебель (локально: +Z смотрит в комнату, центр клетки в 0) ----------------
export function wardrobe(B, C) {
  const m = B.m;
  B.box(m.wood, 1.3, 2.25, 0.62, 0, 1.2, -C / 2 + 0.36);                 // корпус
  B.box(m.wood, 1.42, 0.1, 0.72, 0, 2.38, -C / 2 + 0.36);                // карниз
  B.box(m.wood, 1.36, 0.06, 0.68, 0, 2.3, -C / 2 + 0.36);
  B.box(m.wood, 1.34, 0.08, 0.64, 0, 0.1, -C / 2 + 0.36);                // цоколь
  for (const sx of [-0.33, 0.33]) {
    B.box(m.woodLight, 0.6, 2.0, 0.025, sx, 1.2, -C / 2 + 0.68);         // двери
    B.box(m.wood, 0.46, 0.8, 0.03, sx, 1.7, -C / 2 + 0.695);             // филёнки
    B.box(m.wood, 0.46, 0.8, 0.03, sx, 0.72, -C / 2 + 0.695);
    B.cyl(m.brass, 0.012, 0.12, sx < 0 ? -0.05 : 0.05, 1.2, -C / 2 + 0.71);
  }
  for (const sx of [-0.6, 0.6]) for (const sz of [-0.25, 0.25]) B.lathe('foot', [[0, 0], [0.04, 0], [0.03, 0.06], [0, 0.07]], m.wood, sx, 0, -C / 2 + 0.36 + sz);
}

export function bed(B, len, mats, opts = {}) {
  const m = mats;
  const w = opts.width ?? 1.25, L = len;
  B.box(m.wood, L, 0.28, w, 0, 0.36, 0);                                  // рама
  B.rbox(m.fabricWhite, L - 0.08, 0.2, w - 0.06, 0, 0.6, 0, 0.06);        // матрас
  // голова и изножье
  B.box(m.wood, 0.08, 1.15, w + 0.04, -L / 2 + 0.04, 0.6, 0);
  B.box(m.wood, 0.06, 0.5, w - 0.1, -L / 2 + 0.05, 0.95, 0);
  B.box(m.wood, 0.08, 0.72, w + 0.04, L / 2 - 0.04, 0.4, 0);
  for (const sz of [-1, 1]) {
    B.cyl(m.wood, 0.045, 1.25, -L / 2 + 0.04, 0.62, sz * (w / 2), 0, 0, 12);
    B.sph(m.brass, 0.05, 0.05, 0.05, -L / 2 + 0.04, 1.28, sz * (w / 2), 10);
    B.cyl(m.wood, 0.04, 0.82, L / 2 - 0.04, 0.41, sz * (w / 2), 0, 0, 12);
  }
  // подушки и покрывало со складками
  B.rbox(m.fabricWhite, 0.4, 0.14, w * 0.42, -L / 2 + 0.32, 0.75, -w * 0.23, 0.07);
  B.rbox(m.fabricWhite, 0.4, 0.14, w * 0.42, -L / 2 + 0.32, 0.75, w * 0.23, 0.07);
  const blanket = G('blanket' + L + w, () => {
    const g = new THREE.PlaneGeometry(L * 0.72, w + 0.14, 24, 16);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const edge = Math.max(0, Math.abs(y) - w / 2 + 0.02);
      p.setZ(i, 0.02 * Math.sin(x * 9 + y * 3) + 0.015 * Math.sin(y * 17) - edge * 2.4);
    }
    g.rotateX(-Math.PI / 2); g.computeVertexNormals();
    return g;
  });
  B.put(blanket, opts.blanket || m.fabricRed, L * 0.12, 0.72, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(m.wood, 0.07, 0.24, 0.07, sx * (L / 2 - 0.05), 0.12, sz * (w / 2 - 0.05));
}

export function crib(B, mats) {
  const m = mats;
  B.box(m.woodLight, 1.1, 0.06, 0.62, 0, 0.45, 0);
  B.rbox(m.fabricWhite, 1.04, 0.1, 0.56, 0, 0.53, 0, 0.04);
  for (let i = 0; i <= 12; i++) for (const sz of [-0.3, 0.3]) B.cyl(m.woodLight, 0.012, 0.5, -0.5 + i * (1 / 12), 0.75, sz, 0, 0, 6);
  for (const sz of [-0.3, 0.3]) B.box(m.woodLight, 1.1, 0.04, 0.04, 0, 1.0, sz);
  for (const sx of [-0.54, 0.54]) for (const sz of [-0.3, 0.3]) B.box(m.woodLight, 0.05, 1.02, 0.05, sx, 0.51, sz);
}

export function table(B, w, d, mats, opts = {}) {
  const m = mats;
  const h = opts.h ?? 0.76;
  B.rbox(opts.top || m.wood, w, 0.05, d, 0, h, 0, 0.012);
  B.box(m.wood, w - 0.14, 0.09, 0.03, 0, h - 0.07, d / 2 - 0.08);
  B.box(m.wood, w - 0.14, 0.09, 0.03, 0, h - 0.07, -d / 2 + 0.08);
  B.box(m.wood, 0.03, 0.09, d - 0.14, w / 2 - 0.08, h - 0.07, 0);
  B.box(m.wood, 0.03, 0.09, d - 0.14, -w / 2 + 0.08, h - 0.07, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.lathe('leg', LEG, m.wood, sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08), h / 0.72);
  if (opts.cloth) {
    const cloth = G('cloth' + w + d, () => {
      const g = new THREE.PlaneGeometry(w * 0.7, d * 0.6, 12, 8);
      g.rotateX(-Math.PI / 2); return g;
    });
    B.put(cloth, m.fabricWhite, 0, h + 0.03, 0);
  }
}

export function desk(B, C, mats) {
  const m = mats;
  table(B, 1.4, 0.72, mats, { h: 0.76 });
  B.box(m.wood, 0.42, 0.62, 0.66, 0.46, 0.4, 0);
  for (let i = 0; i < 3; i++) { B.box(m.woodLight, 0.4, 0.17, 0.02, 0.46, 0.2 + i * 0.2, 0.34); B.cyl(m.brass, 0.012, 0.03, 0.46, 0.2 + i * 0.2, 0.36, Math.PI / 2); }
  // лампа и бумаги
  B.lathe('lampbase', [[0, 0], [0.08, 0], [0.07, 0.02], [0.015, 0.03], [0.012, 0.35], [0, 0.35]], m.brass, -0.45, 0.78, -0.15);
  B.lathe('lampshade', [[0.06, 0.1], [0.16, 0], [0.155, -0.01], [0.055, 0.09]], m.shade, -0.45, 1.1, -0.15);
  B.box(m.paper, 0.3, 0.005, 0.22, 0.1, 0.788, 0.05, 0, 0.2);
  B.box(m.paper, 0.28, 0.005, 0.2, 0.15, 0.792, 0.02, 0, -0.1);
}

export function counter(B, C, mats, kind = 'cabinet') {
  const m = mats;
  const z0 = -C / 2 + 0.33;
  if (kind === 'stove') {
    B.box(m.enamel, 0.76, 0.86, 0.64, 0, 0.43, z0);
    B.box(m.black, 0.62, 0.36, 0.02, 0, 0.36, z0 + 0.33);                 // духовка
    B.box(m.chrome, 0.5, 0.025, 0.03, 0, 0.6, z0 + 0.35);
    for (const [bx, bz] of [[-0.18, -0.12], [0.18, -0.12], [-0.18, 0.13], [0.18, 0.13]]) { B.cyl(m.darkMetal, 0.09, 0.02, bx, 0.875, z0 + bz); B.cyl(m.black, 0.05, 0.025, bx, 0.88, z0 + bz); }
    for (let i = 0; i < 4; i++) B.cyl(m.black, 0.02, 0.03, -0.24 + i * 0.16, 0.74, z0 + 0.33, Math.PI / 2);
    B.cyl(m.darkMetal, 0.13, 0.16, 0.18, 0.97, z0 - 0.12);                // кастрюля
    return;
  }
  if (kind === 'sink') {
    B.box(m.wood, 0.9, 0.84, 0.56, 0, 0.42, z0);
    B.box(m.ceramic, 0.92, 0.06, 0.58, 0, 0.87, z0);
    B.box(m.darkMetal, 0.5, 0.02, 0.36, 0, 0.9, z0);
    B.cyl(m.chrome, 0.015, 0.22, 0, 1.0, z0 - 0.22, 0, 0, 8);
    B.cyl(m.chrome, 0.013, 0.14, 0, 1.1, z0 - 0.15, Math.PI / 2, 0, 8);
    B.box(m.glass, 0.6, 0.8, 0.02, 0, 1.55, -C / 2 + 0.02);                // зеркало
    B.box(m.wood, 0.66, 0.86, 0.015, 0, 1.55, -C / 2 + 0.005);
    return;
  }
  if (kind === 'toilet') {
    B.lathe('toilet', [[0, 0], [0.15, 0], [0.12, 0.3], [0.2, 0.38], [0.2, 0.42], [0, 0.42]], m.ceramic, 0, 0, z0 + 0.1);
    B.rbox(m.ceramic, 0.42, 0.4, 0.18, 0, 0.62, -C / 2 + 0.12, 0.04);
    B.box(m.wood, 0.38, 0.03, 0.44, 0, 0.44, z0 + 0.12);
    return;
  }
  if (kind === 'boiler') {
    B.cyl(m.rust, 0.42, 1.8, 0, 0.95, z0 + 0.05, 0, 0, 20);
    B.sph(m.rust, 0.42, 0.18, 0.42, 0, 1.85, z0 + 0.05, 20);
    for (let i = 0; i < 3; i++) B.cyl(m.darkMetal, 0.05, 2.0, -0.5 + i * 0.5, 1.9, z0 - 0.2, 0, Math.PI / 2, 10);
    B.cyl(m.darkMetal, 0.05, 1.2, 0.35, 2.2, z0 + 0.05, 0, 0, 10);
    B.cyl(m.brass, 0.07, 0.03, 0, 1.2, z0 + 0.48, Math.PI / 2);          // манометр
    B.box(m.ember, 0.18, 0.08, 0.02, 0, 0.35, z0 + 0.47);                 // огонёк топки
    return;
  }
  if (kind === 'bench') {
    B.box(m.woodLight, 1.45, 0.07, 0.7, 0, 0.88, z0);
    for (const sx of [-0.65, 0.65]) for (const sz of [-0.28, 0.28]) B.box(m.wood, 0.07, 0.85, 0.07, sx, 0.42, z0 + sz);
    B.box(m.wood, 1.35, 0.04, 0.6, 0, 0.25, z0);
    B.box(m.darkMetal, 0.16, 0.12, 0.12, -0.5, 0.97, z0 + 0.2);          // тиски
    B.box(m.wood, 1.4, 0.9, 0.03, 0, 1.55, -C / 2 + 0.03);                // щит для инструментов
    for (let i = 0; i < 6; i++) B.box(i % 2 ? m.metal : m.rust, 0.04, 0.3 - i * 0.02, 0.02, -0.55 + i * 0.22, 1.55, -C / 2 + 0.06, 0, 0, (i - 3) * 0.1);
    B.cyl(m.rust, 0.13, 0.25, 0.45, 1.03, z0);                             // банка с гвоздями
    return;
  }
  // обычный кухонный шкаф со столешницей
  B.box(m.wood, 1.46, 0.84, 0.6, 0, 0.44, z0);
  B.box(m.black, 1.44, 0.06, 0.56, 0, 0.03, z0 + 0.02);
  B.box(m.tiles, 1.5, 0.05, 0.64, 0, 0.885, z0 + 0.01);
  for (const sx of [-0.36, 0.36]) {
    B.box(m.woodLight, 0.68, 0.62, 0.02, sx, 0.46, z0 + 0.31);
    B.box(m.wood, 0.56, 0.5, 0.02, sx, 0.46, z0 + 0.325);
    B.cyl(m.brass, 0.012, 0.1, sx + (sx < 0 ? 0.26 : -0.26), 0.62, z0 + 0.34);
  }
  B.box(m.woodLight, 1.44, 0.14, 0.02, 0, 0.83, z0 + 0.31);
  // навесной шкафчик
  if (!B.noUpper) {
    B.box(m.wood, 1.44, 0.7, 0.34, 0, 1.85, -C / 2 + 0.17);
    for (const sx of [-0.36, 0.36]) B.box(m.woodLight, 0.68, 0.64, 0.02, sx, 1.85, -C / 2 + 0.35);
  }
  // банки и посуда на столешнице
  for (let i = 0; i < 3; i++) B.cyl(i % 2 ? m.glass : m.ceramic, 0.05 + i * 0.01, 0.14 + i * 0.03, -0.5 + i * 0.12, 0.98 + i * 0.015, z0 - 0.12);
}

export function fridge(B, C, mats) {
  const m = mats, z0 = -C / 2 + 0.36;
  B.rbox(m.enamel, 0.78, 1.72, 0.68, 0, 0.9, z0, 0.12);
  B.box(m.darkMetal, 0.8, 0.006, 0.02, 0, 1.25, z0 + 0.34);
  B.rbox(m.chrome, 0.05, 0.36, 0.05, 0.3, 1.1, z0 + 0.36, 0.02);
  B.box(m.chrome, 0.5, 0.04, 0.02, 0, 1.62, z0 + 0.345);
  B.box(m.black, 0.7, 0.07, 0.6, 0, 0.04, z0);
}

export function bathtub(B, mats) {
  const m = mats;
  // ванна на львиных лапах
  const tub = G('tub', () => {
    const shape = new THREE.Shape();
    shape.absellipse(0, 0, 0.82, 0.38, 0, Math.PI * 2);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.52, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.06, bevelSegments: 3, curveSegments: 28 });
    g.rotateX(-Math.PI / 2);
    return g;
  });
  B.put(tub, m.enamel, 0, 0.12, 0);
  B.box(m.ceramic, 1.5, 0.02, 0.58, 0, 0.66, 0);
  for (const sx of [-0.6, 0.6]) for (const sz of [-0.26, 0.26]) B.lathe('claw', [[0, 0], [0.05, 0], [0.035, 0.05], [0.04, 0.14], [0, 0.14]], m.brass, sx, 0, sz);
  B.cyl(m.chrome, 0.012, 0.3, -0.8, 0.85, 0, 0, 0, 8);
  // шторка
  const curtain = G('bathcurtain', () => {
    const g = new THREE.PlaneGeometry(1.6, 1.6, 40, 4);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 22) * 0.035);
    g.computeVertexNormals();
    return g;
  });
  B.put(curtain, m.fabricWhite, 0, 1.55, 0.42);
  B.cyl(m.chrome, 0.012, 1.7, 0, 2.36, 0.42, 0, Math.PI / 2, 8);
}

export function shelves(B, C, mats, kind = 'books') {
  const m = mats, z0 = -C / 2 + 0.2;
  B.box(m.wood, 1.4, 2.1, 0.02, 0, 1.05, -C / 2 + 0.02);
  for (const sx of [-0.69, 0.69]) B.box(m.wood, 0.04, 2.1, 0.38, sx, 1.05, z0);
  const colors = kind === 'wine' ? [m.glass] : [m.fabricRed, m.fabricGreen, m.fabricBeige, m.wood, m.paper, m.black];
  for (let s = 0; s < 5; s++) {
    const y = 0.08 + s * 0.46;
    B.box(m.wood, 1.36, 0.03, 0.38, 0, y, z0);
    if (kind === 'wine') {
      for (let i = 0; i < 9; i++) if ((i * 7 + s * 3) % 5) {
        B.cyl(i % 3 ? m.fabricGreen : m.black, 0.035, 0.28, -0.6 + i * 0.15, y + 0.06, z0, Math.PI / 2, 0, 10);
      }
      continue;
    }
    let x = -0.64;
    let k = s * 13;
    while (x < 0.62) {
      k = (k * 1103515245 + 12345) & 0x7fffffff;
      const bw = 0.025 + (k % 100) / 100 * 0.04, bh = 0.24 + ((k >> 7) % 100) / 100 * 0.14;
      if ((k >> 3) % 17 === 0) { x += 0.12; continue; }
      const lean = (k >> 5) % 23 === 0 ? 0.25 : 0;
      B.box(colors[(k >> 4) % colors.length], bw, bh, 0.24 + ((k >> 9) % 5) * 0.02, x + bw / 2, y + 0.015 + bh / 2, z0 + 0.02, 0, 0, lean);
      x += bw + 0.004;
    }
  }
}

export function fireplace(B, C, mats) {
  const m = mats, z0 = -C / 2 + 0.25;
  B.box(m.brickDark, 1.4, 1.1, 0.5, 0, 0.55, z0);
  B.box(m.black, 0.8, 0.7, 0.3, 0, 0.42, z0 + 0.12);
  B.box(m.wood, 1.6, 0.08, 0.6, 0, 1.14, z0 + 0.04);
  B.box(m.brickDark, 1.0, 1.6, 0.4, 0, 1.98, z0 - 0.05);
  for (let i = 0; i < 4; i++) B.cyl(m.wood, 0.05, 0.6, -0.15 + i * 0.1, 0.16 + (i % 2) * 0.06, z0 + 0.15, 0, Math.PI / 2 + (i - 1.5) * 0.25, 8);
  B.box(m.ember, 0.5, 0.06, 0.18, 0, 0.12, z0 + 0.16);
  // на каминной полке: часики и подсвечники
  B.box(m.wood, 0.22, 0.26, 0.1, 0, 1.31, z0 + 0.02);
  B.cyl(m.paper, 0.07, 0.01, 0, 1.33, z0 + 0.075, Math.PI / 2);
  for (const sx of [-0.55, 0.55]) { B.lathe('candle', [[0, 0], [0.04, 0], [0.012, 0.03], [0.01, 0.14], [0.03, 0.16], [0, 0.16]], m.brass, sx, 1.18, z0 + 0.04); B.cyl(m.fabricWhite, 0.012, 0.12, sx, 1.4, z0 + 0.04, 0, 0, 8); }
}

export function grandfatherClock(B, C, mats) {
  const m = mats, z0 = -C / 2 + 0.2;
  B.box(m.wood, 0.5, 2.1, 0.32, 0, 1.05, z0);
  B.box(m.wood, 0.58, 0.12, 0.38, 0, 2.14, z0);
  B.box(m.glass, 0.34, 0.9, 0.01, 0, 0.95, z0 + 0.165);
  B.cyl(m.paper, 0.17, 0.02, 0, 1.75, z0 + 0.16, Math.PI / 2, 0, 24);
  B.cyl(m.brass, 0.19, 0.01, 0, 1.75, z0 + 0.155, Math.PI / 2, 0, 24);
}

export function wallBars(B, C, mats) {
  const m = mats;
  for (let i = 0; i < 9; i++) B.cyl(m.rust, 0.015, 2.2, -0.6 + i * 0.15, 1.1, 0, 0, 0, 8);
  for (const y of [0.1, 1.1, 2.15]) B.box(m.rust, 1.3, 0.04, 0.04, 0, y, 0);
}

// ---------------- машина (старый седан) ----------------
export function car(B, mats, lenZ, widthX) {
  const m = mats;
  const L = lenZ, W = widthX;
  // кузов: нижняя часть, капот, багажник, салон
  B.rbox(m.carPaint, W, 0.55, L, 0, 0.62, 0, 0.12);
  B.rbox(m.carPaint, W * 0.96, 0.18, L * 0.34, 0, 0.93, L * 0.3, 0.08);
  B.rbox(m.carPaint, W * 0.96, 0.16, L * 0.22, 0, 0.92, -L * 0.36, 0.07);
  B.rbox(m.carPaint, W * 0.9, 0.5, L * 0.42, 0, 1.13, -L * 0.03, 0.12);
  // стёкла
  B.box(m.windowGlass, W * 0.86, 0.36, 0.03, 0, 1.15, L * 0.18, -0.55);
  B.box(m.windowGlass, W * 0.86, 0.34, 0.03, 0, 1.14, -L * 0.24, 0.55);
  for (const sx of [-1, 1]) {
    B.box(m.windowGlass, 0.02, 0.32, L * 0.36, sx * W * 0.452, 1.16, -L * 0.03);
    B.box(m.chrome, 0.03, 0.03, L * 0.7, sx * W * 0.5, 0.72, 0);           // молдинг
  }
  // колёса
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    B.cyl(m.rubber, 0.33, 0.22, sx * (W / 2 - 0.08), 0.33, sz * L * 0.32, 0, Math.PI / 2, 20);
    B.cyl(m.chrome, 0.19, 0.23, sx * (W / 2 - 0.08), 0.33, sz * L * 0.32, 0, Math.PI / 2, 16);
  }
  // бамперы, решётка, фары
  for (const sz of [-1, 1]) B.rbox(m.chrome, W * 0.98, 0.1, 0.1, 0, 0.45, sz * (L / 2 + 0.02), 0.04);
  B.box(m.darkMetal, W * 0.6, 0.22, 0.03, 0, 0.66, L / 2 + 0.005);
  for (let i = 0; i < 6; i++) B.box(m.chrome, 0.015, 0.2, 0.035, -W * 0.27 + i * W * 0.108, 0.66, L / 2 + 0.01);
  for (const sx of [-1, 1]) {
    B.cyl(m.chrome, 0.1, 0.05, sx * W * 0.38, 0.7, L / 2 + 0.01, Math.PI / 2, 0, 16);
    B.cyl(m.headlight, 0.085, 0.052, sx * W * 0.38, 0.7, L / 2 + 0.02, Math.PI / 2, 0, 16);
    B.box(m.fabricRed, 0.18, 0.1, 0.03, sx * W * 0.36, 0.72, -L / 2 - 0.005);
  }
  B.box(m.paper, 0.4, 0.1, 0.01, 0, 0.5, L / 2 + 0.08);                     // номер
}

export function garageDoorPanel(mats, width) {
  const g = new THREE.Group();
  const panels = 6, h = 2.5 / panels;
  for (let i = 0; i < panels; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(width, h - 0.02, 0.05), mats.darkMetal);
    p.position.y = h * i + h / 2;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(width, 0.03, 0.07), mats.metal);
    rib.position.y = h * i + 0.02;
    g.add(p, rib);
  }
  return g;
}

export function grateMesh(mats) {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 1.0), mats.rust);
  g.add(frame);
  for (let i = 0; i < 9; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, 0.92), mats.rust); b.position.x = -0.4 + i * 0.1; b.position.y = 0.01; g.add(b); }
  for (const [x, z] of [[-0.44, -0.44], [0.44, -0.44], [-0.44, 0.44], [0.44, 0.44]]) {
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 6), mats.metal);
    bolt.position.set(x, 0.03, z); bolt.name = 'bolt'; g.add(bolt);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
