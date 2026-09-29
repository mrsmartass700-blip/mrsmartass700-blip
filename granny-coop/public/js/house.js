// Сборка 3D-дома (3 этажа) из общей карты: пол, стены, потолки, окна, лестницы, двери, мебель, свет.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CELL, WALL_H, FLOOR_H, LEVELS, ITEMS, isFloorChar, isDoorChar, charAt, cellCenter } from '/shared/map.js';
import { Batcher, Builder, wardrobe, bed, crib, table, desk, counter, fridge, bathtub, shelves, fireplace, grandfatherClock, wallBars, car, garageDoorPanel, grateMesh } from './furniture.js';
import * as TX from './textures.js';

const DOOR_H = 2.2, JAMB = 0.22, SLAB = FLOOR_H - WALL_H;

const STYLE = {
  'Спальня': { floor: 'woodfloor', wall: 'wallpaperBlue', lower: 'panel' },
  'Детская': { floor: 'woodfloor', wall: 'wallpaperGreen', lower: 'panel' },
  'Комната бабки': { floor: 'woodfloor', wall: 'wallpaperRed', lower: 'panel' },
  'Библиотека': { floor: 'woodfloor', wall: 'wallpaperGreen', lower: 'panel' },
  'Кабинет': { floor: 'woodfloor', wall: 'wallpaperGreen', lower: 'panel' },
  'Гостиная': { floor: 'woodfloor', wall: 'wallpaperRed', lower: 'panel' },
  'Столовая': { floor: 'woodfloor', wall: 'wallpaper', lower: 'panel' },
  'Кухня': { floor: 'tiles', wall: 'plaster', lower: 'tilesWall', lowerH: 1.35 },
  'Ванная': { floor: 'tiles', wall: 'plaster', lower: 'tilesWall', lowerH: 1.35 },
  'Ванная наверху': { floor: 'tiles', wall: 'plaster', lower: 'tilesWall', lowerH: 1.35 },
  'Гараж': { floor: 'concrete', wall: 'brick', ceil: 'plasterDark' },
  'Двор': { floor: 'grass', wall: 'brick' },
  'Дорога': { floor: 'asphalt', wall: 'brick' },
};
const BASEMENT = { floor: 'concrete', wall: 'brickDark', ceil: 'plasterDark' };
const DEFAULT = { floor: 'woodfloor', wall: 'wallpaper', lower: 'panel' };

// накопитель геометрии по материалам (UV в метрах)
class Acc {
  constructor() { this.m = new Map(); }
  get(k) { if (!this.m.has(k)) this.m.set(k, { p: [], n: [], u: [], i: [] }); return this.m.get(k); }
  quad(k, a, b, c, d, n, ua, ub, uc, ud) {
    const g = this.get(k), base = g.p.length / 3;
    for (const v of [a, b, c, d]) g.p.push(v[0], v[1], v[2]);
    for (let j = 0; j < 4; j++) g.n.push(n[0], n[1], n[2]);
    for (const t of [ua, ub, uc, ud]) g.u.push(t[0], t[1]);
    g.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build(parent, mats) {
    for (const [k, g] of this.m) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.n, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.u, 2));
      geo.setIndex(g.i);
      const mesh = new THREE.Mesh(geo, mats[k] || mats.plaster);
      mesh.receiveShadow = true; mesh.castShadow = true;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
    }
  }
}

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export async function buildHouse(scene, map, mats, { dark = false, onProgress } = {}) {
  const root = new THREE.Group();
  scene.add(root);
  const rng = mulberry32(1998);
  const interactables = [];
  const acc = new Acc();
  const batch = new Batcher();
  const B = new Builder(batch, mats);
  const lamps = [];
  const W = map.w, H = map.h;
  const roomOf = (L, x, y) => map.rooms[map.roomAt(L, x, y)];
  const style = (L, x, y) => { const r = roomOf(L, x, y); if (!r) return L < 0 ? BASEMENT : DEFAULT; return STYLE[r.name] || (L < 0 ? BASEMENT : DEFAULT); };
  const ch = (L, x, y) => charAt(map, L, x, y);
  const isWall = (c) => c === '#' || c === undefined;
  const isOutside = (c) => c === 'O' || c === 'R';

  // ---------- полы и потолки ----------
  for (const L of LEVELS) {
    const y0 = L * FLOOR_H;
    for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
      const c = ch(L, cx, cy);
      if (isWall(c) || c === '_') continue;
      const st = style(L, cx, cy);
      const x0 = cx * CELL, x1 = x0 + CELL, z0 = cy * CELL, z1 = z0 + CELL;
      const fk = isDoorChar(c) ? 'woodfloor' : st.floor;
      acc.quad(fk, [x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0], [0, 1, 0], [x0, z1], [x1, z1], [x1, z0], [x0, z0]);
      if (isOutside(c)) continue;
      const above = ch(L + 1, cx, cy);
      if (L + 1 <= 1 && above === '_') continue; // проём лестницы
      const yc = y0 + WALL_H;
      acc.quad(st.ceil || 'plaster', [x0, yc, z0], [x1, yc, z0], [x1, yc, z1], [x0, yc, z1], [0, -1, 0], [x0, z0], [x1, z0], [x1, z1], [x0, z1]);
    }
  }

  // ---------- стены (грани клеток-стен, обращённые в комнаты) ----------
  const DIRS = [[0, -1, [0, 0, 1]], [0, 1, [0, 0, -1]], [-1, 0, [1, 0, 0]], [1, 0, [-1, 0, 0]]];
  const windows = [];
  for (const L of LEVELS) {
    const y0 = L * FLOOR_H;
    for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
      const c = ch(L, cx, cy);
      if (isWall(c)) continue;
      const st = style(L, cx, cy);
      const outside = isOutside(c);
      for (const [dx, dy, n] of DIRS) {
        const nc = ch(L, cx + dx, cy + dy);
        if (!isWall(nc)) continue;
        // координаты грани
        let a, b; // концы грани по горизонтали
        if (dx === 0) { const z = dy < 0 ? cy * CELL : (cy + 1) * CELL; a = [cx * CELL, z]; b = [(cx + 1) * CELL, z]; if (dy > 0) [a, b] = [b, a]; }
        else { const x = dx < 0 ? cx * CELL : (cx + 1) * CELL; a = [x, (cy + 1) * CELL]; b = [x, cy * CELL]; if (dx > 0) [a, b] = [b, a]; }
        const along = (p) => (dx === 0 ? p[0] : p[1]);
        const bottom = c === '_' ? y0 - SLAB : y0;
        const top = outside ? y0 + FLOOR_H * 2 - 0.2 : y0 + WALL_H;
        const face = (k, ya, yb, from = 0, to = 1, inset = 0) => {
          const pa = [a[0] + (b[0] - a[0]) * from + n[0] * inset, a[1] + (b[1] - a[1]) * from + n[2] * inset];
          const pb = [a[0] + (b[0] - a[0]) * to + n[0] * inset, a[1] + (b[1] - a[1]) * to + n[2] * inset];
          acc.quad(k, [pa[0], ya, pa[1]], [pb[0], ya, pb[1]], [pb[0], yb, pb[1]], [pa[0], yb, pa[1]], n,
            [along(pa), ya], [along(pb), ya], [along(pb), yb], [along(pa), yb]);
        };
        // окно: внешняя стена дома на 1-2 этажах, в жилой комнате
        const exterior = cx + dx <= 0 || cy + dy <= 0 || cx + dx >= W - 1 || cy + dy >= H - 1 || (L === 1 && (cx + dx >= 22));
        const room = roomOf(L, cx, cy);
        const wantWindow = !outside && L >= 0 && exterior && room && !room.outside && room.name !== 'Гараж' && isFloorChar(c) && ((cx * 7 + cy * 3 + L) % 3 === 0);
        const upper = outside ? 'brick' : st.wall;
        if (wantWindow) {
          const s0 = 0.22, s1 = 0.78, sill = y0 + 0.9, lint = y0 + 2.15;
          const k = st.lower ? st.lower : upper;
          face(st.lower || upper, bottom, sill);
          face(upper, lint, top);
          face(upper, sill, lint, 0, s0);
          face(upper, sill, lint, s1, 1);
          windows.push({ L, a, b, n, s0, s1, sill, lint, room });
          void k;
          continue;
        }
        if (st.lower && !outside) {
          const lh = y0 + (st.lowerH || 0.95);
          face(st.lower, bottom, lh);
          face(upper, lh, top);
        } else face(upper, bottom, top);
        // плинтус и карниз
        if (!outside && L >= 0 && c !== '_') {
          face('wood', y0, y0 + 0.12, 0, 1, 0.015);
          face('wood', y0 + WALL_H - 0.1, y0 + WALL_H, 0, 1, 0.02);
        }
      }
    }
  }

  // ---------- окна ----------
  for (const w of windows) {
    const { a, b, n, s0, s1, sill, lint } = w;
    const p = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const [ax, az] = p(s0), [bx, bz] = p(s1);
    const cx = (ax + bx) / 2, cz = (az + bz) / 2, wdt = Math.hypot(bx - ax, bz - az), hgt = lint - sill;
    const ry = Math.atan2(n[0], n[2]);
    const g = new THREE.Group();
    g.position.set(cx - n[0] * 0.06, 0, cz - n[2] * 0.06);
    g.rotation.y = ry;
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(wdt, hgt), mats.windowGlass);
    glass.position.set(0, (sill + lint) / 2, -0.02);
    g.add(glass);
    const frameParts = [[wdt + 0.1, 0.08, 0, lint + 0.02], [wdt + 0.1, 0.08, 0, sill - 0.02], [0.08, hgt, -wdt / 2 - 0.02, (sill + lint) / 2], [0.08, hgt, wdt / 2 + 0.02, (sill + lint) / 2],
      [0.04, hgt, 0, (sill + lint) / 2], [wdt, 0.04, 0, sill + hgt * 0.62]];
    for (const [fw, fh, fx, fy] of frameParts) { const m = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.08), mats.woodLight); m.position.set(fx, fy, 0); g.add(m); }
    const sillM = new THREE.Mesh(new THREE.BoxGeometry(wdt + 0.24, 0.05, 0.26), mats.woodLight); sillM.position.set(0, sill - 0.04, 0.1); g.add(sillM);
    // шторы
    for (const side of [-1, 1]) {
      const cg = new THREE.PlaneGeometry(0.5, hgt + 0.5, 12, 2);
      const pp = cg.attributes.position;
      for (let i = 0; i < pp.count; i++) pp.setZ(i, Math.sin(pp.getX(i) * 28) * 0.03);
      cg.computeVertexNormals();
      const cm = new THREE.Mesh(cg, mats.curtain);
      cm.position.set(side * (wdt / 2 + 0.12), (sill + lint) / 2 + 0.1, 0.14);
      g.add(cm);
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = o.material !== mats.windowGlass; o.receiveShadow = true; } });
    root.add(g);
    // лунный свет из окна — в общий пул ламп
    lamps.push({ level: w.L, pos: new THREE.Vector3(cx + n[0] * 0.8, (sill + lint) / 2, cz + n[2] * 0.8), color: 0x7088c0, intensity: 1.4, dist: 5, flicker: false, moon: true });
  }

  acc.build(root, mats);
  onProgress?.(0.35);

  // ---------- лестницы ----------
  for (const s of map.stairs) {
    const [dx, dy] = s.dir;
    const b0 = s.cells[0], n = s.cells.length, len = n * CELL, steps = 18;
    const y0 = s.from * FLOOR_H;
    const startX = (b0[0] + 0.5 - dx * 0.5) * CELL, startZ = (b0[1] + 0.5 - dy * 0.5) * CELL;
    const ry = Math.atan2(dx, dy);
    B.at(startX, y0, startZ, ry);
    // локально: +Z — направление подъёма
    for (let i = 0; i < steps; i++) {
      const d = len / steps, h = FLOOR_H / steps;
      B.box(mats.wood, CELL - 0.12, h * (i + 1), d, 0, (h * (i + 1)) / 2, d * i + d / 2);
      B.box(mats.woodLight, CELL - 0.1, 0.03, d + 0.02, 0, h * (i + 1) + 0.015, d * i + d / 2);
    }
    // перила с открытых сторон
    for (const side of [-1, 1]) {
      const sx = side * (CELL / 2 - 0.06);
      const nx = s.cells[0][0] + (dx === 0 ? side * (dy < 0 ? -1 : 1) : 0), ny = s.cells[0][1] + (dy === 0 ? side * (dx > 0 ? -1 : 1) : 0);
      const open = !isWall(ch(s.from, nx, ny));
      if (!open) continue;
      for (let i = 0; i <= 12; i++) {
        const t = i / 12, z = t * len, y = y0 * 0 + t * FLOOR_H;
        B.cyl(mats.wood, 0.018, 0.9, sx, y + 0.45 + 0.05, z, 0, 0, 8);
      }
      const railLen = Math.hypot(len, FLOOR_H);
      B.put(new THREE.CylinderGeometry(0.03, 0.03, 1, 10), mats.wood, sx, FLOOR_H / 2 + 0.95, len / 2, 1, railLen, 1, Math.atan2(len, FLOOR_H), 0, 0);
    }
    // ограждение проёма наверху
    const L1 = s.to, yU = L1 * FLOOR_H;
    for (const [cx, cy] of s.cells) {
      for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + ddx, ny = cy + ddy;
        if (nx === s.landing[0] && ny === s.landing[1]) continue;
        const nc = ch(L1, nx, ny);
        if (isWall(nc) || nc === '_') continue;
        const mx = (cx + 0.5 + ddx * 0.5) * CELL, mz = (cy + 0.5 + ddy * 0.5) * CELL;
        B.at(mx, yU, mz, ddx !== 0 ? Math.PI / 2 : 0);
        for (let i = 0; i < 6; i++) B.cyl(mats.wood, 0.018, 0.9, -CELL / 2 + 0.12 + i * 0.25, 0.45, 0, 0, 0, 8);
        B.box(mats.wood, CELL, 0.06, 0.08, 0, 0.93, 0);
        B.box(mats.wood, CELL, 0.2, 0.06, 0, -0.1, 0);
      }
    }
  }

  // ---------- мебель ----------
  const faceDir = (L, x, y) => {
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) if (isFloorChar(ch(L, x + dx, y + dy))) return [dx, dy];
    return [0, 1];
  };
  const hideBox = (spot, w, h, d, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
    m.position.set(x, y, z); m.rotation.y = ry;
    m.userData.interact = { kind: 'hide', id: spot.id };
    root.add(m); interactables.push(m);
  };
  const used = new Set();
  const key = (L, x, y) => `${L}:${x}:${y}`;
  const propSlots = []; // места для GLTF-реквизита
  for (const L of LEVELS) {
    const y0 = L * FLOOR_H;
    for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
      const c = ch(L, cx, cy);
      if (used.has(key(L, cx, cy))) continue;
      const { x: px, z: pz } = cellCenter(cx, cy);
      const room = roomOf(L, cx, cy);
      const rn = room?.name || '';
      const [fx, fy] = faceDir(L, cx, cy);
      const ry = Math.atan2(fx, fy);
      const spot = map.levels[L].hideAt[cy * W + cx];
      if (c === 'W') {
        B.at(px, y0, pz, ry); wardrobe(B, CELL);
        hideBox(spot, 1.3, 2.3, 0.7, px - fx * 0.35, y0 + 1.15, pz - fy * 0.35, ry);
      } else if (c === 'B') {
        const run = [[cx, cy]];
        while (ch(L, cx + run.length, cy) === 'B') run.push([cx + run.length, cy]);
        for (const [x, y] of run) used.add(key(L, x, y));
        const mid = (cx + run.length / 2) * CELL;
        if (run.length === 1) { B.at(px, y0, pz, 0); if (rn === 'Детская') crib(B, mats); else bed(B, 1.4, mats, { width: 0.9, blanket: mats.fabricBeige }); }
        else { B.at(mid, y0, pz, 0); bed(B, CELL * run.length - 0.2, mats, { blanket: rn === 'Комната бабки' ? mats.fabricRed : mats.fabricGreen }); }
        for (const [x, y] of run) { const sp = map.levels[L].hideAt[y * W + x]; const cc = cellCenter(x, y); hideBox(sp, CELL, 0.8, 1.2, cc.x, y0 + 0.4, cc.z); }
      } else if (c === 'T') {
        // объединяем соседние столы в прямоугольник
        let w = 1, d = 1;
        while (ch(L, cx + w, cy) === 'T') w++;
        while (ch(L, cx, cy + d) === 'T') d++;
        for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) used.add(key(L, cx + i, cy + j));
        const tx = (cx + w / 2) * CELL, tz = (cy + d / 2) * CELL;
        if (rn === 'Кабинет' || rn === 'Библиотека') { B.at(tx, y0, tz, 0); desk(B, CELL, mats); }
        else if (w * d >= 4) {
          B.at(tx, y0, tz, 0); table(B, w * CELL - 0.35, d * CELL - 0.5, mats, { cloth: true });
          for (let i = 0; i < w; i++) for (const side of [-1, 1]) propSlots.push({ id: 'chair', L, x: (cx + i + 0.5) * CELL, z: tz + side * (d * CELL / 2 + 0.05), ry: side > 0 ? Math.PI : 0, s: 1 });
          propSlots.push({ id: 'vase', L, x: tx, z: tz, y: 0.79, ry: 0, s: 1 });
        } else { B.at(tx, y0, tz, 0); table(B, w * CELL - 0.1, d * CELL - 0.1, mats, { cloth: rn === 'Кухня' }); if (rn === 'Кухня') propSlots.push({ id: 'chair', L, x: tx, z: tz + 0.95, ry: Math.PI, s: 1 }); }
        for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) { const sp = map.levels[L].hideAt[(cy + j) * W + cx + i]; const cc = cellCenter(cx + i, cy + j); hideBox(sp, CELL * 0.95, 0.8, CELL * 0.95, cc.x, y0 + 0.4, cc.z); }
      } else if (c === 'Y') {
        const run = [[cx, cy]]; while (ch(L, cx + run.length, cy) === 'Y') run.push([cx + run.length, cy]);
        for (const [x, y] of run) used.add(key(L, x, y));
        B.at((cx + run.length / 2) * CELL, y0, pz, 0); bathtub(B, mats);
        for (const [x, y] of run) { const sp = map.levels[L].hideAt[y * W + x]; const cc = cellCenter(x, y); hideBox(sp, CELL, 0.8, 1.0, cc.x, y0 + 0.4, cc.z); }
      } else if (c === 'C') {
        B.at(px, y0, pz, ry);
        let kind = 'cabinet';
        if (rn === 'Кухня') kind = cx === 18 ? 'stove' : cx === 20 ? 'sink' : 'cabinet';
        else if (rn.startsWith('Ванная')) kind = cx === 17 ? 'sink' : 'toilet';
        else if (rn === 'Гараж' || rn === 'Мастерская') kind = 'bench';
        else if (rn === 'Котельная') kind = cx === 17 ? 'boiler' : 'skip';
        if (kind !== 'skip') { B.noUpper = rn !== 'Кухня'; counter(B, CELL, mats, kind); B.noUpper = false; }
        if (kind === 'boiler') lamps.push({ level: L, pos: new THREE.Vector3(px + fx * 0.6, y0 + 0.4, pz + fy * 0.6), color: 0xff5a1a, intensity: 2.2, dist: 4, flicker: true, fire: true });
      } else if (c === 'L') {
        B.at(px, y0, pz, ry); shelves(B, CELL, mats, rn === 'Винный погреб' ? 'wine' : 'books');
      } else if (c === 'E') {
        B.at(px, y0, pz, ry); fireplace(B, CELL, mats);
        lamps.push({ level: L, pos: new THREE.Vector3(px + fx * 0.5, y0 + 0.4, pz + fy * 0.5), color: 0xff7a2a, intensity: 5, dist: 6, flicker: true, fire: true });
      } else if (c === 'F') { B.at(px, y0, pz, ry); fridge(B, CELL, mats); }
      else if (c === 'M') { B.at(px, y0, pz, ry); grandfatherClock(B, CELL, mats); }
      else if (c === 'S') {
        let w = 1; while (ch(L, cx + w, cy) === 'S') w++;
        for (let i = 0; i < w; i++) used.add(key(L, cx + i, cy));
        propSlots.push({ id: 'sofa', L, x: (cx + w / 2) * CELL, z: pz, ry: Math.PI, s: 1.45, fit: w * CELL });
      } else if (c === 'A') propSlots.push({ id: 'armchair', L, x: px, z: pz, ry, s: 1 });
      else if (c === 'Z' && !used.has('car')) {
        used.add('car');
        const xs = map.car.cells.map(q => q[0]), ys = map.car.cells.map(q => q[1]);
        const lenZ = (Math.max(...ys) - Math.min(...ys) + 1) * CELL - 0.2, widthX = (Math.max(...xs) - Math.min(...xs) + 1) * CELL - 0.9;
        B.at(map.car.cx, y0, map.car.cz, 0); car(B, mats, lenZ, widthX);
        const hit = new THREE.Mesh(new THREE.BoxGeometry(widthX + 0.2, 1.5, lenZ), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.set(map.car.cx, y0 + 0.75, map.car.cz);
        hit.userData.interact = { kind: 'car', id: 0 };
        root.add(hit); interactables.push(hit);
        propSlots.push({ id: 'lantern', L, x: map.car.cx + 1.4, z: map.car.cz - 3, ry: 0, s: 1, y: 0 });
      }
    }
  }
  // решётки «камеры»
  for (const d of map.doors) {
    if (d.kind !== 'door') continue;
    const r = d.rooms.map(i => map.rooms[i]).find(r => r?.name === 'Камера');
    if (r) { const c = cellCenter(d.x, d.y); B.at(c.x, d.level * FLOOR_H, c.z + 0.5, 0); wallBars(B, CELL, mats); }
  }
  // трубы под потолком подвала
  for (let i = 0; i < 3; i++) { B.at(0, -FLOOR_H, 0, 0); B.cyl(i % 2 ? mats.rust : mats.darkMetal, 0.05 + i * 0.015, 21 * CELL, 11 * CELL, WALL_H - 0.18 - i * 0.12, 8.3 * CELL + i * 0.25, 0, Math.PI / 2, 10); }
  // коробки и хлам в гараже, кладовке, подвале
  for (const r of map.rooms.filter(r => ['Гараж', 'Кладовка', 'Подвал', 'Котельная', 'Мастерская'].includes(r.name))) {
    for (let k = 0; k < 6; k++) {
      const [x, y] = r.floorCells[Math.floor(rng() * r.floorCells.length)];
      if (ch(r.level, x, y) !== '.') continue;
      const c = cellCenter(x, y);
      // только у стены
      const wallN = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => isWall(ch(r.level, x + dx, y + dy)));
      if (!wallN) continue;
      const bx = c.x + wallN[0] * 0.45, bz = c.z + wallN[1] * 0.45, s = 0.35 + rng() * 0.25;
      B.at(bx, r.level * FLOOR_H, bz, rng() * 0.6);
      if (rng() < 0.6) { B.box(mats.paper, s, s * 0.8, s * 0.9, 0, s * 0.4, 0); if (rng() < 0.5) B.box(mats.paper, s * 0.8, s * 0.6, s * 0.7, 0, s * 0.8 + s * 0.3, 0, 0, 0.3); }
      else B.cyl(rng() < 0.5 ? mats.rust : mats.wood, 0.28, 0.85, 0, 0.425, 0, 0, 0, 16);
    }
  }
  onProgress?.(0.55);

  // ---------- ковры и картины ----------
  const rugMat = new THREE.MeshStandardMaterial({ map: TX.rug(), roughness: 1 });
  for (const r of map.rooms) {
    if (!['Спальня', 'Гостиная', 'Комната бабки', 'Библиотека', 'Детская', 'Прихожая'].includes(r.name)) continue;
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(r.name === 'Гостиная' ? 4.2 : 2.8, r.name === 'Гостиная' ? 2.8 : 1.9), rugMat);
    rug.rotation.x = -Math.PI / 2;
    rug.position.set((r.cx + 0.5) * CELL, r.level * FLOOR_H + 0.006, (r.cy + 0.5) * CELL);
    rug.receiveShadow = true;
    root.add(rug);
  }
  const pics = ['granny', 'grandpa', 'cat', 'landscape'].map(k => new THREE.MeshStandardMaterial({ map: TX.portrait(k), roughness: 0.6 }));
  let pc = 0;
  for (const L of [0, 1]) for (let cy = 1; cy < H - 1; cy++) for (let cx = 1; cx < W - 1; cx++) {
    if (!isFloorChar(ch(L, cx, cy))) continue;
    const room = roomOf(L, cx, cy);
    if (!room || room.outside || ['Гараж', 'Кухня', 'Ванная', 'Ванная наверху'].includes(room.name)) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isDoorChar(ch(L, cx + dx, cy + dy)))) continue;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      if (!isWall(ch(L, cx + dx, cy + dy)) || rng() > 0.1) continue;
      const g = new THREE.Group();
      g.position.set((cx + 0.5) * CELL + dx * (CELL / 2 - 0.03), L * FLOOR_H + 1.6 + rng() * 0.15, (cy + 0.5) * CELL + dy * (CELL / 2 - 0.03));
      g.rotation.y = Math.atan2(-dx, -dy); g.rotation.z = (rng() - 0.5) * 0.1;
      const fr = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.76, 0.05), mats.wood); g.add(fr);
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.64), pics[pc++ % pics.length]); pic.position.z = 0.03; g.add(pic);
      g.traverse(o => { if (o.isMesh) o.castShadow = true; });
      root.add(g);
      break;
    }
  }

  // ---------- двери ----------
  const doors = [];
  const doorPanelGeo = new THREE.BoxGeometry(CELL - 2 * JAMB, DOOR_H, 0.06);
  for (const d of map.doors) {
    const y0 = d.level * FLOOR_H;
    const c = cellCenter(d.x, d.y);
    const g = new THREE.Group();
    g.position.set(c.x, y0, c.z);
    if (d.axis === 'z') g.rotation.y = Math.PI / 2;
    root.add(g);
    const rec = { d, g, pivot: null, angle: 0, target: 0, kind: d.kind };
    if (d.kind === 'garage') {
      const width = d.cells.length * CELL;
      g.position.x = (d.cells[0][0] + d.cells.length / 2) * CELL;
      const panel = garageDoorPanel(mats, width);
      panel.position.z = -0.2;
      g.add(panel);
      panel.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      rec.pivot = panel; rec.slide = true;
    } else if (d.kind === 'grate') {
      const gr = grateMesh(mats);
      gr.position.set(0, 0.021, 0);
      const pivot = new THREE.Group(); pivot.position.set(-0.5, 0, 0); gr.position.x = 0.5;
      pivot.add(gr); g.add(pivot);
      gr.traverse(o => { if (o.isMesh) { o.userData.interact = { kind: 'door', id: d.id }; interactables.push(o); } });
      rec.pivot = pivot; rec.hatch = true; rec.bolts = gr.children.filter(o => o.name === 'bolt');
      // чёрная дыра под решёткой
      const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), mats.black); hole.rotation.x = -Math.PI / 2; hole.position.y = 0.005; g.add(hole);
    } else {
      const jamb = new THREE.BoxGeometry(JAMB, WALL_H, CELL);
      for (const sx of [-1, 1]) { const j = new THREE.Mesh(jamb, mats[d.level < 0 ? 'brickDark' : 'plaster']); j.position.set(sx * (CELL / 2 - JAMB / 2), WALL_H / 2, 0); g.add(j); }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(CELL, WALL_H - DOOR_H, CELL), mats[d.level < 0 ? 'brickDark' : 'plaster']);
      lintel.position.y = DOOR_H + (WALL_H - DOOR_H) / 2; g.add(lintel);
      // наличники
      for (const side of [-1, 1]) for (const sx of [-1, 1]) {
        const tr = new THREE.Mesh(new THREE.BoxGeometry(0.08, DOOR_H + 0.08, 0.03), mats.woodLight);
        tr.position.set(sx * (CELL / 2 - JAMB - 0.02), DOOR_H / 2, side * (CELL / 2 + 0.015)); g.add(tr);
      }
      const pivot = new THREE.Group(); pivot.position.set(-CELL / 2 + JAMB, 0, 0); g.add(pivot);
      const w = CELL - 2 * JAMB;
      const cell = d.rooms.map(i => map.rooms[i]).find(r => r?.name === 'Камера');
      if (cell) {
        for (let i = 0; i < 7; i++) { const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, DOOR_H, 6), mats.rust); bar.position.set(0.06 + i * (w - 0.12) / 6, DOOR_H / 2, 0); pivot.add(bar); }
        for (const y of [0.1, DOOR_H / 2, DOOR_H - 0.1]) { const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, 0.04), mats.rust); bar.position.set(w / 2, y, 0); pivot.add(bar); }
        const hitbox = new THREE.Mesh(doorPanelGeo, new THREE.MeshBasicMaterial({ visible: false })); hitbox.position.set(w / 2, DOOR_H / 2, 0); pivot.add(hitbox);
      } else {
        const panel = new THREE.Mesh(doorPanelGeo, d.kind === 'front' ? mats.wood : mats.woodLight);
        panel.position.set(w / 2, DOOR_H / 2, 0); pivot.add(panel);
        // филёнки
        for (const [fy, fh] of [[0.45, 0.6], [1.2, 0.6], [1.85, 0.45]]) for (const zz of [-0.035, 0.035]) {
          const f = new THREE.Mesh(new THREE.BoxGeometry(w - 0.26, fh, 0.02), mats.wood); f.position.set(w / 2, fy, zz); pivot.add(f);
        }
        for (const zz of [-0.06, 0.06]) { const k = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), mats.brass); k.position.set(w - 0.1, 1.0, zz); pivot.add(k); }
        if (d.lock) {
          const plate = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.18, 0.1), new THREE.MeshStandardMaterial({ color: ITEMS[d.lock].color, metalness: 0.6, roughness: 0.3, emissive: new THREE.Color(ITEMS[d.lock].color).multiplyScalar(0.25) }));
          plate.position.set(w - 0.1, 0.85, 0); pivot.add(plate); rec.plate = plate;
        }
        if (d.kind === 'front') rec.locks = frontLocks(g, mats);
      }
      rec.pivot = pivot;
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (!o.userData.interact && d.kind !== 'grate') { o.userData.interact = { kind: 'door', id: d.id }; } } });
    for (const o of rec.pivot.children) if (o.isMesh) interactables.push(o);
    if (rec.locks) rec.locks.traverse(o => { if (o.isMesh) interactables.push(o); });
    doors.push(rec);
  }

  // ---------- лампы под потолком ----------
  for (const r of map.rooms) {
    if (r.outside) continue;
    const lx = (r.cx + 0.5) * CELL, lz = (r.cy + 0.5) * CELL, y = r.level * FLOOR_H + WALL_H;
    const warm = r.name === 'Комната бабки' ? 0xff8060 : r.level < 0 ? 0xffc890 : 0xffb870;
    const off = dark && r.name !== 'Спальня';
    B.at(lx, y, lz, 0);
    B.cyl(mats.black, 0.006, 0.45, 0, -0.22, 0, 0, 0, 4);
    B.lathe('shade', [[0.03, 0], [0.2, -0.18], [0.21, -0.2], [0.02, -0.02]], mats.shade, 0, -0.45, 0, 1, 20);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), off ? mats.black : mats.bulb);
    bulb.position.set(lx, y - 0.6, lz);
    root.add(bulb);
    if (!off) lamps.push({ level: r.level, pos: new THREE.Vector3(lx, y - 0.65, lz), color: warm, intensity: r.level < 0 ? 5 : 7, dist: 9, flicker: r.level < 0 || rng() < 0.3, bulb });
  }

  batch.build(root);
  onProgress?.(0.7);

  // ---------- улица: земля, небо, деревья ----------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mats.grass);
  ground.material.map.repeat.set(30, 30); ground.material.normalMap.repeat.set(30, 30); ground.material.roughnessMap.repeat.set(30, 30);
  ground.rotation.x = -Math.PI / 2; ground.position.set(W * CELL / 2, -0.02, H * CELL / 2); ground.receiveShadow = true;
  root.add(ground);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(80, 24, 12), mats.sky); sky.position.set(W * CELL / 2, 0, H * CELL / 2); root.add(sky);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(2.5, 16, 12), new THREE.MeshBasicMaterial({ color: 0xdfe6ff })); moon.position.set(W * CELL / 2 + 30, 35, H * CELL + 40); root.add(moon);
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x0b0f0b, roughness: 1 });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2, rr = 30 + rng() * 20;
    const t = new THREE.Mesh(new THREE.ConeGeometry(2 + rng() * 2, 8 + rng() * 6, 7), treeMat);
    t.position.set(W * CELL / 2 + Math.cos(a) * rr, 4, H * CELL / 2 + Math.sin(a) * rr);
    root.add(t);
  }

  // ---------- пул света: фиксированное число ламп, перемещаются к ближайшим источникам ----------
  const POOL = 8;
  const pool = [];
  for (let i = 0; i < POOL; i++) {
    const l = new THREE.PointLight(0xffb870, 0, 9, 1.6);
    root.add(l); pool.push({ l, src: null, cur: 0 });
  }
  let poolT = 0, t = 0;
  const update = (dt, camPos, camLevel) => {
    t += dt; poolT -= dt;
    if (poolT <= 0) {
      poolT = 0.25;
      const ranked = lamps.map(s => ({ s, d: s.pos.distanceTo(camPos) + Math.abs(s.level - camLevel) * 12 - (s.fire ? 2 : 0) }))
        .sort((a, b) => a.d - b.d).slice(0, POOL).map(o => o.s);
      for (const p of pool) if (p.src && !ranked.includes(p.src)) p.src = null;
      for (const s of ranked) if (!pool.some(p => p.src === s)) { const free = pool.find(p => !p.src); if (free) { free.src = s; free.cur = 0; free.l.position.copy(s.pos); free.l.color.set(s.color); free.l.distance = s.dist; } }
    }
    for (const p of pool) {
      const s = p.src;
      let target = 0;
      if (s) {
        target = s.intensity;
        if (s.fire) target *= 0.75 + 0.25 * Math.sin(t * 13 + s.pos.x) * Math.sin(t * 7.3 + s.pos.z);
        else if (s.flicker) { const f = Math.sin(t * 13 + s.pos.x * 3) * Math.sin(t * 3.1 + s.pos.z); target *= f > 0.94 ? 0.12 : 1; if (s.bulb) s.bulb.visible = f <= 0.94; }
      }
      p.cur += (target - p.cur) * Math.min(1, dt * 8);
      p.l.intensity = p.cur;
    }
    for (const r of doors) {
      if (Math.abs(r.angle - r.target) < 0.001) continue;
      r.angle += (r.target - r.angle) * Math.min(1, dt * (r.slide ? 2 : 7));
      if (r.slide) r.pivot.position.y = r.angle * 2.4;
      else if (r.hatch) r.pivot.rotation.z = r.angle * 1.9;
      else r.pivot.rotation.y = -r.angle * Math.PI / 2 * 0.95;
    }
  };

  const setDoor = (id, open, lock) => {
    const r = doors[id]; if (!r) return;
    r.target = open ? 1 : 0;
    if (r.plate) r.plate.visible = !!lock;
  };
  const setExits = (ex) => {
    const fr = doors.find(r => r.kind === 'front');
    if (fr?.locks) for (const k of ['padlock', 'boards', 'chain']) fr.locks.userData[k].visible = !!ex.front[k];
    const gr = doors.find(r => r.kind === 'grate');
    if (gr?.bolts) for (const b of gr.bolts) b.visible = !!ex.sewer.bolts;
  };

  // скрипучие половицы — чуть темнее и потёртее
  let creakMesh = null;
  const setCreaky = (list) => {
    if (creakMesh) root.remove(creakMesh);
    const geo = new THREE.PlaneGeometry(CELL * 0.9, 0.22); geo.rotateX(-Math.PI / 2);
    creakMesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x1c120a, roughness: 0.9, transparent: true, opacity: 0.55, depthWrite: false }), list.length);
    const m4 = new THREE.Matrix4();
    list.forEach((k, i) => { const [L, idx] = k.split(':').map(Number); const x = idx % W, y = Math.floor(idx / W); m4.makeTranslation((x + 0.5) * CELL, L * FLOOR_H + 0.004, (y + 0.5) * CELL); creakMesh.setMatrixAt(i, m4); });
    creakMesh.instanceMatrix.needsUpdate = true;
    root.add(creakMesh);
  };

  // ---------- GLTF-реквизит ----------
  const loader = new GLTFLoader();
  const propCache = {};
  const loadProp = (id) => (propCache[id] ||= loader.loadAsync(`/models/props/${id}.glb`).then(g => g.scene).catch(() => null));
  await Promise.all([...new Set(propSlots.map(p => p.id).concat(['barnlamp', 'brokenwindow']))].map(loadProp));
  for (const ps of propSlots) {
    const src = await loadProp(ps.id);
    if (!src) continue;
    const o = src.clone(true);
    const box = new THREE.Box3().setFromObject(o);
    const size = box.getSize(new THREE.Vector3());
    // подгоняем под размер: диван — по ширине, кресло/стул — по высоте
    const targetH = { sofa: 0.85, armchair: 1.0, chair: 0.95, vase: 0.45, lantern: 0.45 }[ps.id] || 1;
    let k = targetH / (size.y || 1);
    if (ps.fit) k = Math.min(k * 1.2, ps.fit / Math.max(size.x, size.z));
    o.scale.setScalar(k);
    const b2 = new THREE.Box3().setFromObject(o);
    o.position.set(ps.x, ps.L * FLOOR_H + (ps.y || 0) - b2.min.y, ps.z);
    o.rotation.y = ps.ry || 0;
    o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    root.add(o);
  }
  onProgress?.(1);

  return { root, interactables, setDoor, setExits, setCreaky, update, doors, lamps };
}

// замки на входной двери: доски, цепь, навесной замок
function frontLocks(g, mats) {
  const grp = new THREE.Group();
  const boards = new THREE.Group(), chain = new THREE.Group(), padlock = new THREE.Group();
  for (const [y, r] of [[0.7, 0.25], [1.5, -0.2], [2.0, 0.12]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.16, 0.05), mats.woodLight); b.position.y = y; b.rotation.z = r; boards.add(b); for (const sx of [-0.6, 0.6]) { const nl = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6), mats.metal); nl.rotation.x = Math.PI / 2; nl.position.set(sx, y + sx * Math.tan(r) * 0.95, 0.03); boards.add(nl); } }
  for (let i = 0; i < 11; i++) { const l = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.011, 6, 12), mats.metal); l.position.set(-0.5 + i * 0.1, 1.15 - Math.sin(i / 10 * Math.PI) * 0.08, 0); l.rotation.y = i % 2 ? Math.PI / 2 : 0; chain.add(l); }
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.11, 0.05), mats.brass); body.position.set(0, 1.0, 0); padlock.add(body);
  const sh = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.011, 6, 12, Math.PI), mats.chrome); sh.position.set(0, 1.055, 0); padlock.add(sh);
  grp.add(boards, chain, padlock);
  grp.userData = { boards, chain, padlock };
  grp.position.z = -0.09;
  g.add(grp);
  grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return grp;
}
