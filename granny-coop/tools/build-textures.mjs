// Генератор бесшовных PBR-текстур дома: <name>_c.jpg (цвет), <name>_n.jpg (нормали), <name>_r.jpg (шероховатость).
//   node tools/build-textures.mjs [--size=1024] [--only=имя]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'textures');
const SIZE = Number(process.argv.find(a => a.startsWith('--size='))?.split('=')[1]) || 1024;
const ONLY = process.argv.find(a => a.startsWith('--only='))?.split('=')[1];
fs.mkdirSync(OUT, { recursive: true });

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const mix = (a, b, t) => a + (b - a) * t;
const mixc = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
function hash2(x, y, s = 0) { let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
// бесшовный шум с периодом P клеток
function pnoise(x, y, P, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (a) => ((a % P) + P) % P;
  const c = (dx, dy) => hash2(w(xi + dx), w(yi + dy), s);
  return mix(mix(c(0, 0), c(1, 0), u), mix(c(0, 1), c(1, 1), u), v);
}
function fbm(u, v, base, oct = 5, s = 0) { let a = 0.5, sum = 0, f = base; for (let i = 0; i < oct; i++) { sum += a * pnoise(u * f, v * f, f, s + i * 17); f *= 2; a *= 0.5; } return sum / (1 - Math.pow(0.5, oct)); }
// ячеистый (Вороной) бесшовный: [F1, id, F2-F1]
function voronoi(u, v, P, s = 0) {
  const x = u * P, y = v * P, xi = Math.floor(x), yi = Math.floor(y);
  let d1 = 9, d2 = 9, id = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = xi + dx, cy = yi + dy, wx = ((cx % P) + P) % P, wy = ((cy % P) + P) % P;
    const px = cx + hash2(wx, wy, s), py = cy + hash2(wx, wy, s + 9);
    const d = Math.hypot(x - px, y - py);
    if (d < d1) { d2 = d1; d1 = d; id = hash2(wx, wy, s + 3); } else if (d < d2) d2 = d;
  }
  return [d1, id, d2 - d1];
}
// тонкие ветвистые трещины: края ячеек Вороного с искажением, видны только местами
function cracks(u, v, P, s, width = 0.02, density = 0.5) {
  const wu = u + (fbm(u, v, 6, 3, s + 1) - 0.5) * 0.06, wv = v + (fbm(u, v, 6, 3, s + 2) - 0.5) * 0.06;
  const e = voronoi(wu, wv, P, s)[2];
  const fine = voronoi(wu, wv, P * 3, s + 5)[2];
  const main = smooth(width, 0, e) * smooth(1 - density, 1 - density + 0.15, fbm(u, v, 3, 3, s + 7));
  const branch = smooth(width * 0.6, 0, fine) * smooth(1 - density * 0.6, 1 - density * 0.6 + 0.1, fbm(u, v, 5, 3, s + 11));
  return Math.min(1, main + branch * 0.6);
}

class Tex {
  constructor(n) { this.n = n; this.c = new Float32Array(n * n * 3); this.h = new Float32Array(n * n); this.r = new Float32Array(n * n); }
  set(x, y, col, h, r) { const i = y * this.n + x; this.c[i * 3] = col[0]; this.c[i * 3 + 1] = col[1]; this.c[i * 3 + 2] = col[2]; this.h[i] = h; this.r[i] = r; }
  save(name, normalStrength) {
    const n = this.n, enc = (arr, ch) => {
      const d = Buffer.alloc(n * n * 4);
      for (let i = 0; i < n * n; i++) { for (let c = 0; c < 3; c++) d[i * 4 + c] = Math.round(clamp(ch === 3 ? arr[i * 3 + c] : arr[i]) * 255); d[i * 4 + 3] = 255; }
      return Buffer.from(jpeg.encode({ data: d, width: n, height: n }, 88).data);
    };
    fs.writeFileSync(path.join(OUT, `${name}_c.jpg`), enc(this.c, 3));
    fs.writeFileSync(path.join(OUT, `${name}_r.jpg`), enc(this.r, 1));
    const nm = new Float32Array(n * n * 3);
    const H = (x, y) => this.h[((y + n) % n) * n + ((x + n) % n)];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * normalStrength * (n / 1024), dy = (H(x, y + 1) - H(x, y - 1)) * normalStrength * (n / 1024);
      const l = Math.hypot(dx, dy, 1), i = (y * n + x) * 3;
      nm[i] = (-dx / l) * 0.5 + 0.5; nm[i + 1] = (dy / l) * 0.5 + 0.5; nm[i + 2] = (1 / l) * 0.5 + 0.5;
    }
    fs.writeFileSync(path.join(OUT, `${name}_n.jpg`), enc(nm, 3));
  }
}

const GEN = {
  // дощатый пол: длинные доски разной длины, разбежка стыков, волокна, потёртости
  woodfloor(u, v) {
    const ROWS = 7;
    const row = Math.floor(v * ROWS), fv = v * ROWS - row;
    // стыки досок в ряду: 2–3 доски на тайл, периодично
    const cuts = [hash2(row, 1, 7), hash2(row, 2, 7), hash2(row, 3, 7)].sort((a, b) => a - b);
    const nCuts = 2 + (hash2(row, 9, 7) > 0.5 ? 1 : 0);
    let seg = 0, a = 0, b = 1;
    const cs = cuts.slice(0, nCuts);
    for (let i = 0; i < cs.length; i++) if (u >= cs[i]) seg = i + 1;
    a = seg === 0 ? cs[cs.length - 1] - 1 : cs[seg - 1];
    b = seg === cs.length ? cs[0] + 1 : cs[seg];
    const fu = (u - a) / (b - a);
    const id = hash2(row, seg === cs.length ? 0 : seg, 11);
    // волокна вдоль доски
    const g1 = fbm(u * 1, fv * 0.15 + id * 7, 6, 3, 21);
    const fibers = fbm(u * 0.5, fv * 1.2 + id * 3 + g1 * 0.4, 48, 3, 23);
    const streak = Math.pow(Math.abs(Math.sin((fv * 9 + g1 * 5 + id * 13) * Math.PI)), 6);
    let c = mixc([0.26, 0.15, 0.08], [0.46, 0.29, 0.15], id * 0.6 + g1 * 0.4);
    c = mixc(c, [0.16, 0.09, 0.05], streak * 0.35);
    c = c.map(x => x * (0.86 + 0.24 * fibers));
    const edgeV = smooth(0.03, 0.0, Math.min(fv, 1 - fv)), edgeU = smooth(0.006, 0.0, Math.min(fu, 1 - fu));
    const gap = Math.max(edgeV, edgeU);
    const wear = smooth(0.52, 0.8, fbm(u, v, 3, 4, 9));
    c = mixc(c, [0.55, 0.45, 0.33], wear * 0.22);
    c = mixc(c, [0.04, 0.025, 0.015], gap * 0.92);
    // гвоздики у стыков
    const nail = smooth(0.0032, 0.0015, Math.hypot(Math.min(fu, 1 - fu) * (b - a) - 0.012, Math.min(Math.abs(fv - 0.28), Math.abs(fv - 0.72)) / ROWS));
    c = mixc(c, [0.08, 0.08, 0.08], nail);
    c = c.map(x => x * (0.88 + 0.18 * fbm(u, v, 5, 4, 13)));
    const h = 0.6 + fibers * 0.12 + streak * 0.04 - gap * 0.7 + (id - 0.5) * 0.06 - nail * 0.2;
    return [c, h, clamp(0.5 + wear * 0.25 - streak * 0.1 + gap * 0.35)];
  },
  // обои: мелкий дамаск «тон в тон» с тонким золотистым контуром, выцветание, подтёки, плесень
  wallpaper(u, v) {
    const tu = u * 6, tv = v * 4;
    const cx = Math.floor(tu), cy = Math.floor(tv);
    const off = (cy % 2) * 0.5;
    const fu = tu + off - Math.floor(tu + off), fv = tv - cy;
    const x = Math.abs((fu - 0.5) * 2), y = (fv - 0.5) * 2; // симметрия по вертикали
    // «букет»: лепестки и завитки через расстояния
    const petal = Math.hypot(x * 1.6, (y + 0.1) * 1.0) - 0.42 - 0.12 * Math.cos(Math.atan2(y + 0.1, x) * 5);
    const curl = Math.abs(Math.hypot(x - 0.55, y - 0.35) - 0.22);
    const curl2 = Math.abs(Math.hypot(x - 0.55, y + 0.5) - 0.18);
    const stem = Math.abs(x - 0.05 * Math.sin(y * 6)) + (Math.abs(y) > 0.9 ? 1 : 0);
    const fill = smooth(0.02, -0.02, petal);
    const outline = Math.max(smooth(0.03, 0.0, Math.abs(petal)), smooth(0.022, 0.0, curl), smooth(0.02, 0.0, curl2), smooth(0.02, 0.0, stem) * 0.7);
    let c = [0.46, 0.37, 0.25];
    c = mixc(c, [0.38, 0.27, 0.18], fill * 0.8);
    c = mixc(c, [0.62, 0.5, 0.3], outline * 0.55);
    const stripe = Math.sin(u * 180 * Math.PI) * 0.5 + 0.5;
    c = c.map(k => k * (0.96 + 0.05 * stripe));
    const age = fbm(u, v, 3, 5, 21);
    c = c.map(k => k * (0.78 + 0.3 * age));
    const drip = smooth(0.62, 0.8, fbm(u * 6, v * 0.6, 6, 3, 31)) * smooth(0.55, 0.0, v);
    c = mixc(c, [0.3, 0.24, 0.15], drip * 0.55);
    const mold = smooth(0.7, 0.8, fbm(u, v, 8, 5, 41));
    c = mixc(c, [0.2, 0.21, 0.13], mold * 0.5);
    const seam = smooth(0.003, 0, Math.abs(((u * 2) % 1) - 0.5)) * 0.6;
    c = mixc(c, [0.25, 0.2, 0.14], seam);
    const h = 0.5 + outline * 0.06 + fill * 0.03 + fbm(u, v, 64, 3, 3) * 0.08 - drip * 0.05 - seam * 0.2;
    return [c, h, clamp(0.72 - outline * 0.15 + mold * 0.2)];
  },
  // штукатурка потолка с трещинами
  plaster(u, v) {
    const n = fbm(u, v, 12, 5, 51);
    const id = voronoi(u, v, 6, 7)[1];
    const crack = cracks(u, v, 3, 7, 0.018, 0.35);
    let c = [0.66, 0.63, 0.57].map(k => k * (0.9 + 0.12 * n));
    c = mixc(c, [0.5, 0.43, 0.32], smooth(0.62, 0.9, fbm(u, v, 3, 4, 77)) * 0.45); // жёлтые пятна от протечек
    c = mixc(c, [0.25, 0.22, 0.18], crack * 0.55);
    const stip = fbm(u, v, 200, 2, 55);
    c = c.map(k => k * (0.93 + 0.12 * stip));
    return [c, 0.5 + n * 0.2 + stip * 0.12 - crack * 0.4, clamp(0.85 + id * 0.05)];
  },
  // кафель «шахматкой» со сколами и грязными швами
  tiles(u, v) {
    const N = 8, tu = u * N, tv = v * N;
    const tx = Math.floor(tu), ty = Math.floor(tv), fu = tu - tx, fv = tv - ty;
    const grout = Math.max(smooth(0.035, 0.015, Math.min(fu, 1 - fu)), smooth(0.035, 0.015, Math.min(fv, 1 - fv)));
    const id = hash2(tx % N, ty % N, 61);
    const dark = (tx + ty) % 2 === 0;
    let c = dark ? [0.36, 0.17, 0.12] : [0.66, 0.62, 0.54]; // терракота и беж, как в старых кухнях
    c = c.map(k => k * (0.92 + id * 0.1));
    const chip = smooth(0.08, 0.02, Math.min(fu, fv, 1 - fu, 1 - fv) + fbm(u, v, 40, 2, 5) * 0.08) * (id > 0.7 ? 1 : 0);
    const grime = fbm(u, v, 5, 5, 67);
    c = mixc(c, [0.35, 0.3, 0.22], grout * 0.85 + chip * 0.4);
    c = c.map(k => k * (0.8 + 0.3 * grime));
    const h = 0.7 - grout * 0.5 - chip * 0.3 + (id - 0.5) * 0.02;
    return [c, h, clamp(0.18 + grout * 0.7 + chip * 0.5 + (1 - grime) * 0.2)];
  },
  // настенная плитка 15×15 белая, со старыми швами
  walltile(u, v) {
    const N = 8, tu = u * N, tv = v * N;
    const tx = Math.floor(tu), ty = Math.floor(tv), fu = tu - tx, fv = tv - ty;
    const grout = Math.max(smooth(0.04, 0.02, Math.min(fu, 1 - fu)), smooth(0.04, 0.02, Math.min(fv, 1 - fv)));
    const id = hash2(tx % N, ty % N, 71);
    let c = id > 0.93 ? [0.46, 0.58, 0.55] : [0.8, 0.8, 0.76];
    c = c.map(k => k * (0.94 + id * 0.08));
    const grime = fbm(u, v, 4, 5, 73);
    c = mixc(c, [0.45, 0.4, 0.3], grout * 0.8);
    c = c.map(k => k * (0.85 + 0.2 * grime));
    const bulge = Math.sin(fu * Math.PI) * Math.sin(fv * Math.PI);
    return [c, 0.6 + bulge * 0.08 - grout * 0.45, clamp(0.12 + grout * 0.75 + (1 - grime) * 0.15)];
  },
  // бетон пола гаража/подвала: пятна масла, трещины
  concrete(u, v) {
    const n = fbm(u, v, 8, 6, 81), n2 = fbm(u, v, 60, 3, 83);
    let c = [0.42, 0.41, 0.39].map(k => k * (0.8 + 0.3 * n + 0.08 * n2));
    const oil = smooth(0.66, 0.8, fbm(u, v, 3, 4, 85));
    c = mixc(c, [0.12, 0.11, 0.1], oil * 0.7);
    const crack = cracks(u, v, 3, 87, 0.014, 0.4);
    c = mixc(c, [0.1, 0.1, 0.1], crack * 0.7);
    // зерно заполнителя и поры
    const grain = fbm(u, v, 256, 2, 91);
    const [pd] = voronoi(u, v, 180, 92);
    const pore = smooth(0.18, 0.05, pd) * (hash2(Math.floor(u * 180), Math.floor(v * 180), 93) > 0.8 ? 1 : 0);
    const pebble = smooth(0.35, 0.2, voronoi(u, v, 90, 94)[0]) * (hash2(Math.floor(u * 90), Math.floor(v * 90), 95) > 0.7 ? 1 : 0);
    c = c.map(k => k * (0.86 + 0.24 * grain) * (1 - pore * 0.45) * (1 + pebble * 0.12));
    return [c, 0.5 + n2 * 0.3 + grain * 0.15 - crack * 0.6 - pore * 0.3 + pebble * 0.1, clamp(0.85 - oil * 0.5 + pore * 0.1)];
  },
  // старый кирпич с раствором и копотью
  brick(u, v) {
    const RU = 4, RV = 12;
    const row = Math.floor(v * RV), off = (row % 2) * 0.5;
    const bu = u * RU + off, col = Math.floor(bu);
    const fu = bu - col, fv = v * RV - row;
    const mortar = Math.max(smooth(0.06, 0.03, Math.min(fu, 1 - fu) * 2), smooth(0.09, 0.05, Math.min(fv, 1 - fv)));
    const id = hash2(((col % RU) + RU) % RU, row % RV, 91);
    let c = mixc([0.42, 0.18, 0.12], [0.6, 0.3, 0.2], id);
    const n = fbm(u, v, 20, 4, 93);
    c = c.map(k => k * (0.75 + 0.4 * n));
    c = mixc(c, [0.55, 0.52, 0.46], mortar * 0.9);
    const soot = smooth(0.5, 0.85, fbm(u, v, 3, 4, 95));
    c = mixc(c, [0.06, 0.05, 0.05], soot * 0.5);
    return [c, 0.7 + n * 0.2 - mortar * 0.55, clamp(0.8 + mortar * 0.15)];
  },
  // тёмное дерево мебели/дверей
  wood(u, v) {
    const g = fbm(u * 0.5, v * 6, 8, 5, 101);
    const rings = Math.sin((u * 30 + g * 8) * Math.PI) * 0.5 + 0.5;
    let c = mixc([0.18, 0.1, 0.05], [0.33, 0.2, 0.11], rings * 0.6 + g * 0.4);
    const scratch = smooth(0.985, 1, Math.abs(Math.sin((u * 3 + v * 40 + g) * 20)));
    c = mixc(c, [0.45, 0.33, 0.22], scratch * 0.3);
    return [c, 0.5 + rings * 0.12 + g * 0.1 - scratch * 0.1, clamp(0.45 + (1 - rings) * 0.2)];
  },
  // деревянная панель низа стен
  panel(u, v) {
    const pu = u * 3, fu = pu - Math.floor(pu);
    const frame = Math.max(smooth(0.12, 0.08, Math.min(fu, 1 - fu)), smooth(0.14, 0.1, Math.min(v, 1 - v)));
    const bevel = smooth(0.16, 0.12, Math.min(fu, 1 - fu, v, 1 - v));
    const [c0, h0, r0] = GEN.wood(u, v);
    return [c0.map(k => k * (0.85 + frame * 0.2)), h0 + frame * 0.3 - bevel * 0.2, r0];
  },
  // трава/земля двора
  grass(u, v) {
    const n = fbm(u, v, 30, 5, 111), n2 = fbm(u, v, 5, 4, 113);
    let c = mixc([0.08, 0.12, 0.05], [0.18, 0.24, 0.1], n);
    c = mixc(c, [0.2, 0.15, 0.1], smooth(0.55, 0.75, n2) * 0.7);
    return [c, n * 0.6, 0.95];
  },
  // асфальт дороги
  asphalt(u, v) {
    const n = fbm(u, v, 80, 3, 121), n2 = fbm(u, v, 6, 4, 123);
    const c = [0.1, 0.1, 0.11].map(k => k * (0.7 + 0.6 * n + 0.3 * n2));
    return [c, n * 0.4, clamp(0.8 - n2 * 0.2)];
  },
};

const NORMAL = { woodfloor: 4, wallpaper: 2, plaster: 3, tiles: 5, walltile: 4, concrete: 3, brick: 6, wood: 3, panel: 5, grass: 4, asphalt: 3 };

for (const [name, fn] of Object.entries(GEN)) {
  if (ONLY && ONLY !== name) continue;
  const t0 = Date.now();
  const t = new Tex(SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) { const [c, h, r] = fn(x / SIZE, y / SIZE); t.set(x, y, c, h, r); }
  t.save(name, NORMAL[name] || 3);
  console.log(`✔ ${name.padEnd(10)} ${((Date.now() - t0) / 1000).toFixed(1)} с`);
}
