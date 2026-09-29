// Сборщик реалистичных персонажей из базы MakeHuman (CC0) → GLB со скелетом, одеждой, PBR-текстурами и мимикой.
//   node tools/build-humans.mjs [путь к makehuman/data]
// Источник: https://github.com/makehumancommunity/makehuman (ассеты CC0). Выход: public/models/*.glb
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MH = process.argv.slice(2).find(a => !a.startsWith('--')) || process.env.MH_DATA || '/home/user/makehumancommunity/makehuman/makehuman/data';
const OUT = path.join(ROOT, 'public', 'models');
const ONLY = process.argv.find(a => a.startsWith('--only='))?.split('=')[1];
const SKIN_TEX = Number(process.argv.find(a => a.startsWith('--skin='))?.split('=')[1]) || 2048;
fs.mkdirSync(OUT, { recursive: true });

// ======================= математика =======================
const V3 = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const mixc = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

// матрица 4x4 column-major (как в glTF)
function mat4FromBasis(x, y, z, t) { return [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, t[0], t[1], t[2], 1]; }
function mat4Mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function mat4InvRigid(m) { // R^T, -R^T t
  const r = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
  const t = [m[12], m[13], m[14]];
  r[12] = -(r[0] * t[0] + r[4] * t[1] + r[8] * t[2]);
  r[13] = -(r[1] * t[0] + r[5] * t[1] + r[9] * t[2]);
  r[14] = -(r[2] * t[0] + r[6] * t[1] + r[10] * t[2]);
  return r;
}
function quatFromMat(m) {
  const m00 = m[0], m01 = m[4], m02 = m[8], m10 = m[1], m11 = m[5], m12 = m[9], m20 = m[2], m21 = m[6], m22 = m[10];
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
  const l = Math.hypot(x, y, z, w);
  return [x / l, y / l, z / l, w / l];
}

// ======================= шум =======================
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  const x00 = mix(c(0, 0, 0), c(1, 0, 0), u), x10 = mix(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = mix(c(0, 0, 1), c(1, 0, 1), u), x11 = mix(c(0, 1, 1), c(1, 1, 1), u);
  return mix(mix(x00, x10, v), mix(x01, x11, v), w);
}
function fbm(x, y, z, oct = 4) {
  let a = 0.5, s = 0, f = 1;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, z * f); f *= 2.03; a *= 0.5; }
  return s / (1 - Math.pow(0.5, oct));
}
// ячеистый шум (для пигментных пятен): расстояние до ближайшей точки
function cell(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let d = 9;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const cx = xi + dx + hash3(xi + dx, yi + dy, zi + dz), cy = yi + dy + hash3(yi + dy, zi + dz, xi + dx), cz = zi + dz + hash3(zi + dz, xi + dx, yi + dy);
    d = Math.min(d, Math.hypot(x - cx, y - cy, z - cz));
  }
  return d;
}

// ======================= загрузка MakeHuman =======================
function parseObj(file) {
  const V = [], T = [], faces = [];
  let g = '';
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('v ')) V.push(line.slice(2).trim().split(/\s+/).map(Number));
    else if (line.startsWith('vt ')) T.push(line.slice(3).trim().split(/\s+/).map(Number));
    else if (line.startsWith('g ')) g = line.slice(2).trim();
    else if (line.startsWith('f ')) {
      const p = line.slice(2).trim().split(/\s+/).map(s => s.split('/').map(n => Number(n) - 1));
      faces.push({ g, v: p.map(q => q[0]), t: p.map(q => q[1]) });
    }
  }
  return { V, T, faces };
}

const targetCache = new Map();
function loadTarget(rel) {
  if (targetCache.has(rel)) return targetCache.get(rel);
  const file = path.join(MH, 'targets', rel + '.target');
  if (!fs.existsSync(file)) { targetCache.set(rel, null); return null; }
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line || line[0] === '#') continue;
    const p = line.trim().split(/\s+/);
    if (p.length < 4) continue;
    out.push([Number(p[0]), Number(p[1]), Number(p[2]), Number(p[3])]);
  }
  targetCache.set(rel, out);
  return out;
}

function macroTargets(p) {
  const gw = [['female', 1 - p.gender], ['male', p.gender]];
  const a = p.age;
  const aw = a < 0.1875 ? [['baby', 1 - a / 0.1875], ['child', a / 0.1875]]
    : a < 0.5 ? [['child', (0.5 - a) / 0.3125], ['young', 1 - (0.5 - a) / 0.3125]]
      : [['young', (1 - a) / 0.5], ['old', (a - 0.5) / 0.5]];
  const tri = (v, n) => v < 0.5 ? [[n[0], (0.5 - v) * 2], [n[1], 1 - (0.5 - v) * 2]] : [[n[1], 1 - (v - 0.5) * 2], [n[2], (v - 0.5) * 2]];
  const mw = tri(p.muscle, ['minmuscle', 'averagemuscle', 'maxmuscle']);
  const ww = tri(p.weight, ['minweight', 'averageweight', 'maxweight']);
  const out = [];
  const hAmt = Math.abs(p.height - 0.5) * 2, hName = p.height < 0.5 ? 'minheight' : 'maxheight';
  for (const [g, gv] of gw) for (const [ag, av] of aw) {
    if (gv * av > 0) out.push([`macrodetails/caucasian-${g}-${ag}`, gv * av]);
    for (const [m, mv] of mw) for (const [w, wv] of ww) {
      const k = gv * av * mv * wv;
      if (k <= 0) continue;
      out.push([`macrodetails/universal-${g}-${ag}-${m}-${w}`, k]);
      if (hAmt > 0) out.push([`macrodetails/height/${g}-${ag}-${m}-${w}-${hName}`, k * hAmt]);
      if (p.prop) out.push([`macrodetails/proportions/${g}-${ag}-${m}-${w}-idealproportions`, k * p.prop]);
    }
  }
  return out;
}

// ======================= персонажи =======================
const EXPRESSIONS = [
  ['blinkL', 'expression/units/caucasian/eye-left-closure'],
  ['blinkR', 'expression/units/caucasian/eye-right-closure'],
  ['browDownL', 'expression/units/caucasian/eyebrows-left-down'],
  ['browDownR', 'expression/units/caucasian/eyebrows-right-down'],
  ['browInnerUpL', 'expression/units/caucasian/eyebrows-left-inner-up'],
  ['browInnerUpR', 'expression/units/caucasian/eyebrows-right-inner-up'],
  ['mouthOpen', 'expression/units/caucasian/mouth-open'],
  ['grin', 'expression/units/caucasian/mouth-corner-puller'],
  ['frown', 'expression/units/caucasian/mouth-depression'],
  ['snarl', 'expression/units/caucasian/nose-compression'],
  ['eyesWideL', 'expression/units/caucasian/eye-left-opened-up'],
  ['eyesWideR', 'expression/units/caucasian/eye-right-opened-up'],
];

const CHARS = {
  granny: {
    macro: { gender: 0, age: 0.96, muscle: 0.3, weight: 0.64, height: 0.36, prop: 0.3 },
    extra: [
      ['head/head-age-incr', 1], ['nose/nose-scale-vert-incr', 0.35], ['nose/nose-hump-incr', 0.7], ['nose/nose-point-down', 0.6],
      ['nose/nose-volume-incr', 0.35], ['nose/nose-flaring-incr', 0.3], ['mouth/mouth-angles-down', 0.8], ['mouth/mouth-upperlip-volume-decr', 0.7],
      ['mouth/mouth-lowerlip-volume-decr', 0.5], ['cheek/l-cheek-volume-decr', 0.5], ['cheek/r-cheek-volume-decr', 0.5],
      ['cheek/l-cheek-bones-incr', 0.4], ['cheek/r-cheek-bones-incr', 0.4], ['eyes/l-eye-bag-incr', 0.9], ['eyes/r-eye-bag-incr', 0.9],
      ['eyes/l-eye-eyefold-down', 0.6], ['eyes/r-eye-eyefold-down', 0.6], ['eyes/l-eye-scale-decr', 0.2], ['eyes/r-eye-scale-decr', 0.2],
      ['chin/chin-prominent-incr', 0.5], ['chin/chin-jaw-drop-incr', 0.3], ['neck/neck-double-incr', 0.4],
      ['eyebrows/eyebrows-angle-down', 0.6], ['eyebrows/eyebrows-trans-down', 0.3],
    ],
    skin: { tone: [0.86, 0.72, 0.64], rough: 0.62, old: 1, female: 1, brows: [0.62, 0.6, 0.58], lips: [0.66, 0.44, 0.44], stubble: 0 },
    hair: { color: [0.72, 0.71, 0.69], style: 'bun', lift: 0.012 },
    eyes: { iris: [0.35, 0.42, 0.40], sclera: [0.90, 0.86, 0.76], veins: 0.8 },
    teeth: [0.80, 0.74, 0.58],
    outfit: {
      hide: ['torso', 'upperarm', 'lowerarm', 'upperleg', 'lowerleg', 'feet'],
      apron: { width: 0.8, length: 0.82 },
      parts: [
        { name: 'cardigan', from: 'tights', regions: ['torso', 'upperarm', 'lowerarm'], offset: 0.07, fabric: 'knit', color: [0.36, 0.13, 0.12], rough: 0.95, tile: 0.075, cuff: true, hemOver: true },
        { name: 'stockings', from: 'tights', regions: ['lowerleg'], offset: 0.012, fabric: 'nylon', color: [0.52, 0.40, 0.33], rough: 0.55, tile: 0.1 },
        { name: 'slippers', from: 'tights', regions: ['feet'], offset: 0.1, fabric: 'felt', color: [0.25, 0.20, 0.18], rough: 1, tile: 0.08, inflateFeet: true },
        { name: 'skirt', from: 'skirt', offset: 0.04, fabric: 'plaid', color: [0.20, 0.23, 0.17], rough: 0.9, tile: 0.22, lengthen: 0.45 },
      ],
    },
  },
  player_m: {
    macro: { gender: 1, age: 0.56, muscle: 0.62, weight: 0.5, height: 0.6, prop: 0.6 },
    extra: [['nose/nose-scale-vert-decr', 0.2], ['chin/chin-width-incr', 0.3], ['mouth/mouth-scale-horiz-incr', 0.1]],
    skin: { tone: [0.86, 0.66, 0.54], rough: 0.55, old: 0, female: 0, brows: [0.2, 0.14, 0.1], lips: [0.72, 0.48, 0.44], stubble: 1 },
    hair: { color: [0.16, 0.11, 0.07], style: 'short', lift: 0.03 },
    eyes: { iris: [0.30, 0.20, 0.12], sclera: [0.94, 0.93, 0.90], veins: 0.2 },
    teeth: [0.92, 0.90, 0.84],
    outfit: {
      hide: ['torso', 'upperarm', 'lowerarm', 'upperleg', 'lowerleg', 'feet'],
      waist: true,
      parts: [
        { name: 'shirt', from: 'tights', regions: ['torso', 'upperarm', 'lowerarm'], offset: 0.09, fabric: 'cotton', color: [1, 1, 1], tint: true, rough: 0.92, tile: 0.2, cuff: true, hemOver: true },
        { name: 'jeans', from: 'tights', regions: ['upperleg', 'lowerleg'], offset: 0.05, fabric: 'denim', color: [0.25, 0.32, 0.45], rough: 0.9, tile: 0.12 },
        { name: 'shoes', from: 'tights', regions: ['feet'], offset: 0.12, fabric: 'sneaker', color: [0.85, 0.85, 0.83], rough: 0.7, tile: 0.1, inflateFeet: true },
      ],
    },
  },
  player_f: {
    macro: { gender: 0, age: 0.52, muscle: 0.5, weight: 0.45, height: 0.5, prop: 0.7 },
    extra: [['nose/nose-scale-horiz-decr', 0.2], ['mouth/mouth-upperlip-volume-incr', 0.3], ['eyes/l-eye-scale-incr', 0.15], ['eyes/r-eye-scale-incr', 0.15]],
    skin: { tone: [0.93, 0.76, 0.66], rough: 0.5, old: 0, female: 1, brows: [0.28, 0.18, 0.1], lips: [0.76, 0.42, 0.44], stubble: 0 },
    hair: { color: [0.36, 0.20, 0.09], style: 'ponytail', lift: 0.03 },
    eyes: { iris: [0.22, 0.38, 0.52], sclera: [0.95, 0.94, 0.92], veins: 0.1 },
    teeth: [0.94, 0.92, 0.88],
    outfit: {
      hide: ['torso', 'upperarm', 'lowerarm', 'upperleg', 'lowerleg', 'feet'],
      waist: true,
      parts: [
        { name: 'shirt', from: 'tights', regions: ['torso', 'upperarm', 'lowerarm'], offset: 0.07, fabric: 'cotton', color: [1, 1, 1], tint: true, rough: 0.9, tile: 0.2, cuff: true, hemOver: true },
        { name: 'jeans', from: 'tights', regions: ['upperleg', 'lowerleg'], offset: 0.035, fabric: 'denim', color: [0.16, 0.18, 0.24], rough: 0.9, tile: 0.12 },
        { name: 'shoes', from: 'tights', regions: ['feet'], offset: 0.11, fabric: 'sneaker', color: [0.18, 0.18, 0.2], rough: 0.7, tile: 0.1, inflateFeet: true },
      ],
    },
  },
};

function regionOf(bone) {
  if (/^(head|jaw|eye|special|oculi|orbicularis|oris|levator|risorius|temporalis|tongue)/.test(bone)) return 'head';
  if (/^neck/.test(bone)) return 'neck';
  if (/^(wrist|finger|metacarpal)/.test(bone)) return 'hands';
  if (/^(foot|toe)/.test(bone)) return 'feet';
  if (/^lowerleg/.test(bone)) return 'lowerleg';
  if (/^(upperleg|pelvis)/.test(bone)) return 'upperleg';
  if (/^upperarm/.test(bone)) return 'upperarm';
  if (/^lowerarm/.test(bone)) return 'lowerarm';
  return 'torso';
}

// ======================= текстуры =======================
class Img {
  constructor(w, h) { this.w = w; this.h = h; this.rgb = new Float32Array(w * h * 3); this.hgt = new Float32Array(w * h); this.mask = new Uint8Array(w * h); }
  set(x, y, c, hh) { const i = y * this.w + x; this.rgb[i * 3] = c[0]; this.rgb[i * 3 + 1] = c[1]; this.rgb[i * 3 + 2] = c[2]; this.hgt[i] = hh; this.mask[i] = 1; }
  // заполняем пустые пиксели соседями (чтобы на швах UV не было чёрных полос)
  dilate(n = 6) {
    const { w, h } = this;
    for (let it = 0; it < n; it++) {
      const add = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (this.mask[i]) continue;
        let r = 0, g = 0, b = 0, hh = 0, k = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (!this.mask[j]) continue;
          r += this.rgb[j * 3]; g += this.rgb[j * 3 + 1]; b += this.rgb[j * 3 + 2]; hh += this.hgt[j]; k++;
        }
        if (k) {
          let nx = 0, ny = 0, nz = 0;
          if (this.nrm) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const j = yy * w + xx;
            if (!this.mask[j]) continue;
            nx += this.nrm[j * 3]; ny += this.nrm[j * 3 + 1]; nz += this.nrm[j * 3 + 2];
          }
          add.push([i, r / k, g / k, b / k, hh / k, nx, ny, nz]);
        }
      }
      for (const [i, r, g, b, hh, nx, ny, nz] of add) {
        this.rgb[i * 3] = r; this.rgb[i * 3 + 1] = g; this.rgb[i * 3 + 2] = b; this.hgt[i] = hh; this.mask[i] = 1;
        if (this.nrm) { const nn = V3.norm([nx, ny, nz || 1]); this.nrm[i * 3] = nn[0]; this.nrm[i * 3 + 1] = nn[1]; this.nrm[i * 3 + 2] = nn[2]; }
      }
    }
  }
  jpg(q = 88) {
    const data = Buffer.alloc(this.w * this.h * 4);
    for (let i = 0; i < this.w * this.h; i++) {
      for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(clamp(this.rgb[i * 3 + c]) * 255);
      data[i * 4 + 3] = 255;
    }
    return Buffer.from(jpeg.encode({ data, width: this.w, height: this.h }, q).data);
  }
  normalJpg(strength = 1, tiled = false, q = 90) {
    const { w, h } = this;
    const out = new Img(w, h);
    if (this.nrm) { // готовые 3D-нормали (с дилатацией по маске)
      for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) out.rgb[i * 3 + c] = this.nrm[i * 3 + c] * 0.5 + 0.5;
      const m = this.nrmMask || this.mask;
      return out.jpg(q);
    }
    const H = (x, y) => {
      if (tiled) { x = (x + w) % w; y = (y + h) % h; } else { x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1); }
      return this.hgt[y * w + x];
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const n = V3.norm([-dx, dy, 1]);
      const i = y * w + x;
      out.rgb[i * 3] = n[0] * 0.5 + 0.5; out.rgb[i * 3 + 1] = n[1] * 0.5 + 0.5; out.rgb[i * 3 + 2] = n[2] * 0.5 + 0.5;
    }
    return out.jpg(q);
  }
}

// растеризация треугольника в UV с интерполяцией атрибутов.
// shade(p, n) -> [цвет, высота]; если передан heightFn, нормаль считается в 3D вдоль касательных (dP/du, dP/dv)
function rasterTri(img, uv, attrs, shade, heightFn = null) {
  const { w, h } = img;
  const P = uv.map(([u, v]) => [u * w - 0.5, v * h - 0.5]);
  const minX = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0]) - 1)), maxX = Math.min(w - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0]) + 1));
  const minY = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1]) - 1)), maxY = Math.min(h - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1]) + 1));
  const area = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
  if (Math.abs(area) < 1e-9) return;
  const eps = 0.9 / Math.sqrt(Math.abs(area) + 1); // небольшой «запас» по краям
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const w0 = ((P[1][0] - x) * (P[2][1] - y) - (P[2][0] - x) * (P[1][1] - y)) / area;
    const w1 = ((P[2][0] - x) * (P[0][1] - y) - (P[0][0] - x) * (P[2][1] - y)) / area;
    const w2 = 1 - w0 - w1;
    if (w0 < -eps || w1 < -eps || w2 < -eps) continue;
    if (img.mask[y * w + x]) continue;
    const a = attrs.map(A => [A[0][0] * w0 + A[1][0] * w1 + A[2][0] * w2, A[0][1] * w0 + A[1][1] * w1 + A[2][1] * w2, A[0][2] * w0 + A[1][2] * w1 + A[2][2] * w2]);
    const n = V3.norm(a[1]);
    const [c, hh] = shade(a[0], n);
    img.set(x, y, c, hh);
    if (heightFn) {
      if (!img.nrm) img.nrm = new Float32Array(w * h * 3);
      const d = tan.step;
      const hu = (heightFn(V3.add(a[0], V3.mul(tan.u, d)), n) - heightFn(V3.sub(a[0], V3.mul(tan.u, d)), n)) / (2 * d);
      const hv = (heightFn(V3.add(a[0], V3.mul(tan.v, d)), n) - heightFn(V3.sub(a[0], V3.mul(tan.v, d)), n)) / (2 * d);
      const k = tan.strength;
      const nn = V3.norm([-hu * k, hv * k, 1]);
      const i = y * w + x;
      img.nrm[i * 3] = nn[0]; img.nrm[i * 3 + 1] = nn[1]; img.nrm[i * 3 + 2] = nn[2];
    }
  }
}
const tan = { u: [1, 0, 0], v: [0, 1, 0], step: 0.0006, strength: 0.004 };
// касательные треугольника: единичные направления в 3D, соответствующие +u и +v
function triTangents(P, UV) {
  const e1 = V3.sub(P[1], P[0]), e2 = V3.sub(P[2], P[0]);
  const du1 = UV[1][0] - UV[0][0], dv1 = UV[1][1] - UV[0][1], du2 = UV[2][0] - UV[0][0], dv2 = UV[2][1] - UV[0][1];
  const r = 1 / ((du1 * dv2 - du2 * dv1) || 1e-9);
  const T = V3.mul(V3.sub(V3.mul(e1, dv2), V3.mul(e2, dv1)), r);
  const B = V3.mul(V3.sub(V3.mul(e2, du1), V3.mul(e1, du2)), r);
  return [V3.norm(T), V3.norm(B)];
}

// ---------- тайловые ткани (бесшовные: шум по тору) ----------
function tileNoise(u, v, f, z = 0) { // бесшовный шум на квадрате
  const a = u * Math.PI * 2, b = v * Math.PI * 2, R = f / (Math.PI * 2);
  return fbm(Math.cos(a) * R + 7, Math.sin(a) * R + 3, Math.cos(b) * R + Math.sin(b) * R * 0.7 + z, 4);
}
function fabricTile(kind, color, size = 512) {
  const img = new Img(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    let c = color.slice(), hh = 0;
    const n = tileNoise(u, v, 24), n2 = tileNoise(u, v, 90, 5);
    if (kind === 'knit') {
      // вязка «резинкой»: вертикальные рубчики из петель-«ёлочек»
      const cols = 28, rows = 36;
      const cu = u * cols, cv = v * rows;
      const fu = cu - Math.floor(cu), fv = cv - Math.floor(cv);
      const rib = Math.floor(cu) % 2 === 0 ? 1 : 0.55;
      const loop = Math.sin(Math.PI * fu) * (0.75 + 0.25 * Math.sin(Math.PI * 2 * (fv + Math.abs(fu - 0.5) * 0.8)));
      hh = loop * rib + n2 * 0.25;
      c = c.map(ch => ch * (0.7 + 0.32 * hh + (n - 0.5) * 0.14));
    } else if (kind === 'plaid') {
      const band = (t, f, wdt) => smooth(wdt, wdt * 0.6, Math.abs(((t * f) % 1) - 0.5));
      const a = band(u, 6, 0.08), b = band(v, 6, 0.08), a2 = band(u + 0.25, 6, 0.03), b2 = band(v + 0.25, 6, 0.03);
      c = mixc(c, [0.10, 0.10, 0.12], Math.max(a, b) * 0.7);
      c = mixc(c, [0.45, 0.12, 0.10], Math.max(a2, b2) * 0.8);
      const twill = Math.sin((u + v) * size * 0.9) * 0.5 + 0.5;
      hh = twill * 0.5 + n2 * 0.4;
      c = c.map(ch => ch * (0.8 + 0.25 * twill) * (0.9 + (n - 0.5) * 0.3));
    } else if (kind === 'denim') {
      const twill = Math.sin((u * 2 + v) * size * 0.55) * 0.5 + 0.5;
      const fade = tileNoise(u, v, 6, 9);
      hh = twill * 0.6 + n2 * 0.4;
      c = mixc(c, [0.55, 0.62, 0.72], smooth(0.5, 0.95, fade) * 0.18);
      c = c.map(ch => ch * (0.72 + 0.4 * twill) * (0.9 + (n2 - 0.5) * 0.3));
    } else if (kind === 'cotton') {
      const weave = (Math.sin(u * size * 1.4) * Math.sin(v * size * 1.4)) * 0.5 + 0.5;
      hh = weave * 0.35 + n2 * 0.5;
      c = c.map(ch => ch * (0.86 + 0.1 * weave + (n - 0.5) * 0.1));
    } else if (kind === 'nylon') {
      hh = n2 * 0.2;
      c = c.map(ch => ch * (0.9 + (n - 0.5) * 0.12));
    } else if (kind === 'felt') {
      hh = n2 * 0.7 + n * 0.3;
      c = c.map(ch => ch * (0.8 + 0.3 * n2));
    } else if (kind === 'sneaker') {
      const stitch = smooth(0.46, 0.5, Math.abs(((v * 8) % 1) - 0.5)) * 0.4;
      hh = n2 * 0.4 + stitch;
      c = c.map(ch => ch * (0.85 + 0.15 * n2 - stitch * 0.3));
    } else if (kind === 'apron') {
      const weave = (Math.sin(u * size * 1.2) * Math.sin(v * size * 1.2)) * 0.5 + 0.5;
      const stain = smooth(0.62, 0.72, tileNoise(u, v, 5, 2));
      hh = weave * 0.3 + n2 * 0.3;
      c = mixc(c, [0.45, 0.33, 0.22], stain * 0.55);
      c = mixc(c, [0.42, 0.08, 0.06], smooth(0.74, 0.8, tileNoise(u, v, 3, 11)) * 0.5); // «варенье». наверное.
      c = c.map(ch => ch * (0.85 + 0.15 * weave));
    } else if (kind === 'hair') {
      const strands = tileNoise(u * 1, v * 0.02, 140, 3);
      const clump = tileNoise(u, 0.3, 18, 8);
      hh = strands * 0.8 + clump * 0.4;
      c = c.map(ch => ch * (0.55 + 0.7 * strands * (0.7 + 0.3 * clump)));
    } else if (kind === 'lash') {
      c = [0.05, 0.04, 0.035]; hh = 0;
    }
    img.set(x, y, c, hh);
  }
  return img;
}

function eyeTexture(cfg, size = 512) {
  const img = new Img(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    // v=0 — передний полюс (зрачок), v=1 — задний
    const r = v; // угловое расстояние от полюса (0..1)
    let c = cfg.sclera.slice(), hh = 0;
    const ang = u * Math.PI * 2;
    const vein = Math.pow(1 - Math.abs(tileNoise(u * 3, v * 0.2, 40, 4) - 0.5) * 2, 18) * smooth(0.12, 0.3, r) * cfg.veins;
    c = mixc(c, [0.75, 0.2, 0.18], vein * 0.8);
    const iris = 0.115, pupil = 0.045;
    if (r < iris) {
      const fib = 0.7 + 0.3 * Math.sin(ang * 60 + tileNoise(u, 0, 30) * 6);
      const t = r / iris;
      c = cfg.iris.map(ch => ch * fib * (0.6 + 0.6 * t));
      c = mixc(c, [0.05, 0.04, 0.03], smooth(0.85, 1, t) * 0.8); // лимбальное кольцо
      hh = 0.2;
    }
    if (r < pupil) { c = [0.015, 0.012, 0.01]; }
    c = c.map(ch => ch * (0.85 + 0.15 * smooth(0.5, 0, r)));
    img.set(x, y, c, hh);
  }
  return img;
}

// ======================= GLB =======================
class GLB {
  constructor() {
    this.json = { asset: { version: '2.0', generator: 'babka build-humans (MakeHuman CC0)' }, scene: 0, scenes: [{ nodes: [] }],
      nodes: [], meshes: [], skins: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }], materials: [], textures: [], images: [], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }] };
    this.chunks = []; this.offset = 0;
  }
  view(buf, target) {
    const pad = (4 - (this.offset % 4)) % 4;
    if (pad) { this.chunks.push(Buffer.alloc(pad)); this.offset += pad; }
    const bv = { buffer: 0, byteOffset: this.offset, byteLength: buf.length };
    if (target) bv.target = target;
    this.chunks.push(buf); this.offset += buf.length;
    this.json.bufferViews.push(bv);
    return this.json.bufferViews.length - 1;
  }
  accessor(arr, type, compType, target, { minmax = false, normalized = false } = {}) {
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const acc = { bufferView: this.view(buf, target), componentType: compType, count: arr.length / n, type };
    if (normalized) acc.normalized = true;
    if (minmax) {
      const mn = new Array(n).fill(Infinity), mx = new Array(n).fill(-Infinity);
      for (let i = 0; i < arr.length; i++) { const k = i % n; mn[k] = Math.min(mn[k], arr[i]); mx[k] = Math.max(mx[k], arr[i]); }
      acc.min = mn; acc.max = mx;
    }
    this.json.accessors.push(acc);
    return this.json.accessors.length - 1;
  }
  sparseVec3(count, idx, vals) {
    const mn = [0, 0, 0], mx = [0, 0, 0];
    for (let i = 0; i < vals.length; i++) { const k = i % 3; mn[k] = Math.min(mn[k], vals[i]); mx[k] = Math.max(mx[k], vals[i]); }
    const acc = { componentType: 5126, count, type: 'VEC3', min: mn, max: mx,
      sparse: { count: idx.length, indices: { bufferView: this.view(Buffer.from(idx.buffer)), componentType: 5125 }, values: { bufferView: this.view(Buffer.from(vals.buffer)) } } };
    this.json.accessors.push(acc);
    return this.json.accessors.length - 1;
  }
  image(buf, mime = 'image/jpeg') {
    this.json.images.push({ bufferView: this.view(buf), mimeType: mime });
    this.json.textures.push({ sampler: 0, source: this.json.images.length - 1 });
    return this.json.textures.length - 1;
  }
  toBuffer() {
    const bin = Buffer.concat(this.chunks);
    const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
    this.json.buffers[0].byteLength = binPad.length;
    let js = Buffer.from(JSON.stringify(this.json), 'utf8');
    js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
    const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + binPad.length, 8);
    const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
    const bh = Buffer.alloc(8); bh.writeUInt32LE(binPad.length, 0); bh.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([head, jh, js, bh, binPad]);
  }
}

// ======================= сборка =======================
const base = parseObj(path.join(MH, '3dobjs', 'base.obj'));
const skel = JSON.parse(fs.readFileSync(path.join(MH, 'rigs', 'default.mhskel'), 'utf8'));
const weightsRaw = JSON.parse(fs.readFileSync(path.join(MH, 'rigs', 'default_weights.mhw'), 'utf8')).weights;
const boneNames = Object.keys(skel.bones);
// родитель раньше потомка
boneNames.sort((a, b) => depth(a) - depth(b));
function depth(n) { let d = 0, p = skel.bones[n].parent; while (p) { d++; p = skel.bones[p].parent; } return d; }
const boneIndex = Object.fromEntries(boneNames.map((n, i) => [n, i]));

// веса: по 4 самых сильных кости на вершину
const NV = base.V.length;
const vw = Array.from({ length: NV }, () => []);
for (const [b, list] of Object.entries(weightsRaw)) {
  if (!(b in boneIndex)) continue;
  for (const [i, w] of list) vw[i].push([boneIndex[b], w]);
}
const skinJ = new Uint16Array(NV * 4), skinW = new Float32Array(NV * 4), domRegion = new Array(NV);
for (let i = 0; i < NV; i++) {
  const l = vw[i].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const s = l.reduce((a, x) => a + x[1], 0) || 1;
  l.forEach(([j, w], k) => { skinJ[i * 4 + k] = j; skinW[i * 4 + k] = w / s; });
  if (!l.length) { skinJ[i * 4] = boneIndex.root; skinW[i * 4] = 1; }
  domRegion[i] = regionOf(boneNames[l[0]?.[0] ?? boneIndex.root]);
}

const groupFaces = {};
for (const f of base.faces) {
  const g = f.g.startsWith('helper-l-eyelashes') || f.g.startsWith('helper-r-eyelashes') ? 'lashes' : f.g;
  (groupFaces[g] ||= []).push(f);
}
const groupVerts = (g) => { const s = new Set(); for (const f of groupFaces[g] || []) for (const v of f.v) s.add(v); return [...s]; };
const centroid = (P, idx) => { const c = [0, 0, 0]; for (const i of idx) { c[0] += P[i][0]; c[1] += P[i][1]; c[2] += P[i][2]; } return V3.mul(c, 1 / idx.length); };

function computeNormals(P, faces) {
  const N = new Map();
  for (const f of faces) {
    const [a, b, c, d] = f.v.map(i => P[i]);
    const n = V3.cross(V3.sub(c, a), V3.sub(d ?? c, b));
    for (const i of f.v) { const o = N.get(i) || [0, 0, 0]; N.set(i, V3.add(o, n)); }
  }
  for (const [k, v] of N) N.set(k, V3.norm(v));
  return N;
}

// граничные вершины набора граней и «кольца» соседей
function boundaryInfo(faces) {
  const edges = new Map();
  for (const f of faces) for (let k = 0; k < f.v.length; k++) {
    const a = f.v[k], b = f.v[(k + 1) % f.v.length];
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    edges.set(key, (edges.get(key) || 0) + 1);
  }
  const border = new Set();
  const adj = new Map();
  for (const [key, n] of edges) {
    const [a, b] = key.split('_').map(Number);
    if (!adj.has(a)) adj.set(a, new Set()); if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b); adj.get(b).add(a);
    if (n === 1) { border.add(a); border.add(b); }
  }
  const ring1 = new Set();
  for (const v of border) for (const u of adj.get(v)) if (!border.has(u)) ring1.add(u);
  return { border, ring1, adj, edges };
}
// граничные петли одежды выравниваем «кольцом» в сторону открытой кожи (горловина, манжеты)
function flattenBorders(faces, P) {
  const { border, adj, edges } = boundaryInfo(faces);
  const bAdj = new Map();
  for (const [key, n] of edges) if (n === 1) {
    const [a, b] = key.split('_').map(Number);
    if (!bAdj.has(a)) bAdj.set(a, []); if (!bAdj.has(b)) bAdj.set(b, []);
    bAdj.get(a).push(b); bAdj.get(b).push(a);
  }
  const all = [...new Set(faces.flatMap(f => f.v))];
  const cen = centroid(P, all);
  const seen = new Set(), out = P.map(p => p);
  for (const v0 of border) {
    if (seen.has(v0)) continue;
    const loop = [], st = [v0];
    while (st.length) { const v = st.pop(); if (seen.has(v)) continue; seen.add(v); loop.push(v); for (const u of bAdj.get(v) || []) st.push(u); }
    if (loop.length < 6) continue;
    const lc = centroid(P, loop);
    const axis = V3.norm(V3.sub(lc, cen));
    let mx = 0;
    for (const v of loop) mx += V3.dot(P[v], axis);
    mx /= loop.length;
    for (const v of loop) {
      const d = mx - V3.dot(P[v], axis);
      out[v] = V3.add(P[v], V3.mul(axis, d));
      // соседи внутрь — наполовину, чтобы не было «ступеньки»
      for (const u of adj.get(v)) if (!border.has(u) && out[u] === P[u]) out[u] = V3.add(P[u], V3.mul(axis, d * 0.5));
    }
  }
  return out;
}

function buildCharacter(name, cfg) {
  const t0 = Date.now();
  // --- морфинг ---
  const P = base.V.map(v => v.slice());
  const apply = (rel, w, into = P) => {
    const t = loadTarget(rel);
    if (!t) { if (w > 0.001) console.warn(`  нет таргета ${rel}`); return; }
    for (const [i, x, y, z] of t) { into[i][0] += x * w; into[i][1] += y * w; into[i][2] += z * w; }
  };
  for (const [rel, w] of macroTargets(cfg.macro)) apply(rel, w);
  for (const [rel, w] of cfg.extra) apply(rel, w);

  // --- в метры, земля в 0, лицом к -Z (MakeHuman смотрит в +Z) ---
  const bodyIdx = groupVerts('body');
  let minY = Infinity;
  for (const i of bodyIdx) minY = Math.min(minY, P[i][1]);
  const X = (p) => [-p[0] * 0.1, (p[1] - minY) * 0.1, -p[2] * 0.1];
  const W = P.map(X); // мировые позиции (м)
  // «локальная» система для шейдеров (метры, лицом к +z, как в MH)
  const S = P.map(p => [p[0] * 0.1, (p[1] - minY) * 0.1, p[2] * 0.1]);

  // --- скелет ---
  const J = (name) => centroid(W, skel.joints[name]);
  const bones = boneNames.map((bn) => {
    const b = skel.bones[bn];
    const head = J(b.head), tail = J(b.tail);
    let normal = [1, 0, 0];
    const pl = skel.planes[b.rotation_plane];
    if (pl) {
      const [p1, p2, p3] = pl.map(J);
      normal = V3.norm(V3.cross(V3.norm(V3.sub(p3, p2)), V3.norm(V3.sub(p2, p1))));
    }
    const y = V3.norm(V3.sub(tail, head));
    const z = V3.norm(V3.cross(normal, y));
    const x = V3.norm(V3.cross(y, z));
    return { name: bn, parent: b.parent, head, tail, global: mat4FromBasis(x, y, z, head) };
  });

  // --- ориентиры лица (система S) ---
  const Sc = (g) => centroid(S, groupVerts(g));
  const eyeL = Sc('helper-l-eye'), eyeR = Sc('helper-r-eye');
  const mouth = Sc('joint-mouth');
  const headTop = bodyIdx.reduce((m, i) => Math.max(m, S[i][1]), 0);
  const eyeMid = V3.mul(V3.add(eyeL, eyeR), 0.5);
  let noseTip = eyeMid;
  for (const i of bodyIdx) { const p = S[i]; if (p[1] < eyeMid[1] - 0.01 && p[1] > mouth[1] && Math.abs(p[0]) < 0.012 && p[2] > noseTip[2]) noseTip = p; }
  const eyeSep = Math.abs(eyeL[0] - eyeR[0]);
  const neckY = Sc('joint-neck')[1], jawY = Sc('joint-jaw')[1];
  // центр черепа (в S: лицом к +z)
  const headVerts = bodyIdx.filter(i => domRegion[i] === 'head');
  const skull = [eyeMid[0], eyeMid[1] + 0.02, eyeMid[2] - 0.075];
  const isScalp = (p) => {
    const rel = V3.sub(p, skull);
    const back = smooth(0.02, -0.07, rel[2]);          // 0 — лоб, 1 — затылок
    const side = smooth(0.03, 0.075, Math.abs(rel[0]));
    let thr = mix(0.031, 0.0, side);                      // лоб выше, виски ниже
    thr = mix(thr, cfg.hair.nape ?? -0.075, back);        // затылок до шеи
    if (Math.abs(rel[0]) > 0.062 && rel[1] < 0.03 && rel[2] > -0.05) return false; // уши
    return rel[1] > thr && V3.len(rel) < 0.16;
  };

  const glb = new GLB();
  const prims = [];
  const mat = (m) => { glb.json.materials.push(m); return glb.json.materials.length - 1; };

  // ---------- кожа (запекание в UV) ----------
  const sk = cfg.skin;
  const hideSet = new Set(cfg.outfit.hide);
  // прячем кожу под одеждой, но оставляем полосу 2.5 см у открытых участков — чтобы край одежды не открыл дыру
  const visibleV = bodyIdx.filter(i => !hideSet.has(domRegion[i]));
  const grid = new Map(), GS = 0.03;
  const gk = (p) => `${Math.floor(p[0] / GS)},${Math.floor(p[1] / GS)},${Math.floor(p[2] / GS)}`;
  for (const i of visibleV) { const k = gk(W[i]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
  const nearVisible = (i) => {
    const p = W[i], [x, y, z] = [Math.floor(p[0] / GS), Math.floor(p[1] / GS), Math.floor(p[2] / GS)];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
      for (const j of grid.get(`${x + dx},${y + dy},${z + dz}`) || []) if (V3.len(V3.sub(W[j], p)) < 0.025) return true;
    return false;
  };
  const keepCache = new Map();
  const deep = (i) => { if (!keepCache.has(i)) keepCache.set(i, hideSet.has(domRegion[i]) && !nearVisible(i)); return keepCache.get(i); };
  const bodyFaces = groupFaces.body.filter(f => !f.v.every(deep));
  const sN = computeNormals(S, groupFaces.body);
  const skinImg = new Img(SKIN_TEX, SKIN_TEX);
  const isScalpRef = isScalp;
  const segDist = (p, a, b) => { const ab = V3.sub(b, a), t = clamp(V3.dot(V3.sub(p, a), ab) / V3.dot(ab, ab)); return V3.len(V3.sub(p, V3.add(a, V3.mul(ab, t)))); };
  const shadeSkin = (p, n) => {
    let c = sk.tone.slice();
    const mott = fbm(p[0] * 55, p[1] * 55, p[2] * 55, 4);
    const pores = fbm(p[0] * 1100, p[1] * 1100, p[2] * 1100, 2);
    const fine = fbm(p[0] * 320, p[1] * 320, p[2] * 320, 3);
    c = c.map(ch => ch * (0.94 + 0.09 * mott));
    let hh = (pores - 0.5) * 0.12 + (fine - 0.5) * 0.2;
    const faceW = smooth(neckY - 0.01, neckY + 0.02, p[1]) * smooth(eyeMid[2] - 0.08, eyeMid[2] - 0.04, p[2]);
    const front = smooth(-0.05, 0.35, n[2]);
    // подповерхностное «тепло»: чуть краснее в складках и на тонкой коже
    c = mixc(c, [c[0] * 1.03, c[1] * 0.86, c[2] * 0.84], (1 - mott) * 0.25);
    // румянец и нос
    const cheekL = V3.add(eyeL, [0.014, -0.032, 0.004]), cheekR = V3.add(eyeR, [-0.014, -0.032, 0.004]);
    const blush = Math.max(smooth(0.036, 0, V3.len(V3.sub(p, cheekL))), smooth(0.036, 0, V3.len(V3.sub(p, cheekR))));
    c = mixc(c, [c[0] * 1.02, c[1] * 0.82, c[2] * 0.8], blush * (sk.female ? 0.38 : 0.22));
    c = mixc(c, [c[0] * 1.0, c[1] * 0.8, c[2] * 0.78], smooth(0.014, 0, V3.len(V3.sub(p, noseTip))) * (sk.old ? 0.45 : 0.2));
    // уши краснее
    c = mixc(c, [c[0], c[1] * 0.84, c[2] * 0.82], faceW * smooth(eyeSep * 0.85, eyeSep * 1.05, Math.abs(p[0])) * 0.4);
    // губы
    const lipH = sk.old ? 0.0056 : 0.0086;
    const dx = p[0] - mouth[0], dy = p[1] - (mouth[1] - 0.001);
    const lipShape = (dx / 0.025) ** 2 + (dy / (lipH * Math.max(0.2, 1 - 0.35 * (dx / 0.025) ** 2))) ** 2;
    const lipFront = front * smooth(mouth[2] - 0.02, mouth[2] - 0.008, p[2]);
    const lip = smooth(1.15, 0.7, lipShape) * lipFront;
    c = mixc(c, sk.lips, lip * 0.85);
    hh += lip * 0.12 * Math.pow(Math.abs(Math.sin(dx * (sk.old ? 1300 : 650))), 3);
    if (sk.old) hh -= smooth(2.2, 1.15, lipShape) * (1 - lip) * lipFront * Math.pow(Math.abs(Math.sin(dx * 850 + fine * 2)), 8) * 0.9; // «кисет»
    // брови, веки, мешки
    for (const [e, side] of [[eyeL, 1], [eyeR, -1]]) {
      const ex = (p[0] - e[0]) * side;
      const by = p[1] - e[1];
      const eyeFront = front * smooth(e[2] - 0.03, e[2] - 0.012, p[2]);
      const curve = 0.021 + 0.0045 * Math.cos((ex + 0.002) * 60) - Math.max(0, ex - 0.012) * 0.3;
      const th = sk.old ? 0.0032 : 0.0043;
      const brow = smooth(th, th * 0.25, Math.abs(by - curve)) * smooth(0.029, 0.019, Math.abs(ex + 0.002)) * eyeFront;
      const strand = 0.5 + 0.5 * Math.sin(ex * 1600 + by * 500 + vnoise(p[0] * 3000, p[1] * 3000, p[2] * 3000) * 4);
      c = mixc(c, sk.brows, brow * (sk.old ? 0.6 : 0.88) * (0.45 + 0.55 * strand));
      hh += brow * strand * 0.25;
      const under = smooth(0.017, 0.004, Math.hypot(ex * 0.8, (by + 0.013) * 1.6)) * eyeFront;
      c = mixc(c, [c[0] * 0.8, c[1] * 0.7, c[2] * 0.78], under * (sk.old ? 0.55 : 0.22));
      const lid = smooth(0.012, 0.005, Math.hypot(ex * 0.7, by - 0.004)) * eyeFront;
      c = mixc(c, [c[0] * 0.9, c[1] * 0.76, c[2] * 0.8], lid * 0.35);
      if (sk.old) {
        const rx = (p[0] - (e[0] + side * 0.021)) * side, ry = p[1] - (e[1] + 0.001), rr = Math.hypot(rx, ry);
        const fan = smooth(-0.004, 0.003, rx) * smooth(0.024, 0.006, rr) * Math.pow(Math.abs(Math.sin(Math.atan2(ry, rx) * 7 + fine)), 10);
        hh -= fan * 1.1 * front;
        const bag = smooth(0.0035, 0, Math.abs(by + 0.017 - Math.abs(ex) * 0.2)) * smooth(0.021, 0.011, Math.abs(ex)) * eyeFront;
        hh -= bag * 1.0;
        c = mixc(c, [c[0] * 0.82, c[1] * 0.72, c[2] * 0.74], bag * 0.3);
      }
    }
    if (sk.old) {
      // морщины на лбу
      const fh = p[1] - (eyeMid[1] + 0.03);
      const foreMask = smooth(0, 0.006, fh) * smooth(headTop - 0.03, headTop - 0.045, p[1]) * smooth(0.055, 0.03, Math.abs(p[0])) * front;
      hh -= Math.pow(Math.abs(Math.sin(fh * 480 + vnoise(p[0] * 55, p[1] * 5, 1) * 2.5)), 9) * 0.9 * foreMask;
      // межбровные складки
      hh -= smooth(0.0025, 0, Math.abs(Math.abs(p[0]) - 0.006)) * smooth(0.02, 0.005, Math.abs(p[1] - eyeMid[1] - 0.018)) * front * 0.8;
      // носогубные складки
      for (const side of [1, -1]) {
        const a = [noseTip[0] + side * 0.017, noseTip[1] - 0.008, noseTip[2] - 0.014], b = [mouth[0] + side * 0.031, mouth[1] - 0.014, mouth[2] - 0.006];
        const d = segDist(p, a, b);
        hh -= smooth(0.0045, 0, d) * 1.6 * front;
        c = mixc(c, [c[0] * 0.86, c[1] * 0.76, c[2] * 0.76], smooth(0.006, 0, d) * 0.22 * front);
        // «брыли»
        const j = segDist(p, [mouth[0] + side * 0.033, mouth[1] - 0.012, mouth[2] - 0.01], [mouth[0] + side * 0.04, jawY + 0.005, mouth[2] - 0.025]);
        hh -= smooth(0.004, 0, j) * 0.9 * front;
      }
      // шея
      const neckMask = smooth(neckY - 0.03, neckY, p[1]) * smooth(jawY - 0.005, jawY - 0.02, p[1]) * front;
      hh -= Math.pow(Math.abs(Math.sin(p[1] * 260 + vnoise(p[0] * 40, 0, 3) * 2)), 12) * 0.45 * neckMask;
      // пигментные пятна и венки
      const spot = smooth(0.24, 0.1, cell(p[0] * 65, p[1] * 65, p[2] * 65)) * smooth(0.52, 0.62, fbm(p[0] * 11, p[1] * 11, p[2] * 11, 3));
      c = mixc(c, [c[0] * 0.74, c[1] * 0.6, c[2] * 0.47], spot * 0.65);
      const vein = Math.pow(1 - Math.abs(fbm(p[0] * 85, p[1] * 85, p[2] * 85, 3) - 0.5) * 2, 16);
      const handMask = smooth(0.13, 0.19, Math.abs(p[0])) * smooth(1.0, 0.92, p[1]);
      c = mixc(c, [0.55, 0.57, 0.68], vein * handMask * 0.4);
      hh += vein * handMask * 0.5;
      // капилляры на щеках
      const cap = Math.pow(1 - Math.abs(fbm(p[0] * 260, p[1] * 260, p[2] * 260, 2) - 0.5) * 2, 22);
      c = mixc(c, [0.72, 0.36, 0.36], cap * blush * 0.5);
    }
    if (sk.stubble) {
      const beard = faceW * front * smooth(0.0, 0.015, (noseTip[1] - 0.012) - p[1]) * smooth(0.078, 0.052, Math.abs(p[0])) * (1 - smooth(1.25, 0.8, lipShape));
      const dots = smooth(0.52, 0.75, vnoise(p[0] * 2600, p[1] * 2600, p[2] * 2600));
      c = mixc(c, [0.12, 0.09, 0.07], beard * (0.22 + 0.4 * dots));
    }
    // кожа под волосами — цвет волос, край причёски не читается как «шлем»
    if (isScalpRef(p)) c = mixc(c, cfg.hair.color.map(x => x * 0.65), 0.85);
    return [c, hh];
  };
  const heightSkin = (p, n) => shadeSkin(p, n)[1];
  tan.step = 0.0005; tan.strength = sk.old ? 0.0011 : 0.0008;
  for (const f of groupFaces.body) {
    const tris = f.v.length === 4 ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 2]];
    for (const tr of tris) {
      const uv = tr.map(k => { const t = base.T[f.t[k]]; return [t[0], 1 - t[1]]; });
      const P3 = tr.map(k => S[f.v[k]]);
      [tan.u, tan.v] = triTangents(P3, uv);
      rasterTri(skinImg, uv, [P3, tr.map(k => sN.get(f.v[k]))], shadeSkin, heightSkin);
    }
  }
  skinImg.dilate(8);
  const skinMat = mat({
    name: 'skin', pbrMetallicRoughness: { baseColorTexture: { index: glb.image(skinImg.jpg(90)) }, metallicFactor: 0, roughnessFactor: sk.rough },
    normalTexture: { index: glb.image(skinImg.normalJpg(sk.old ? 2.2 : 1.4)), scale: 1 },
  });

  // ---------- примитивы ----------
  // faces: [{v:[..], t:[..]}]; uvFn(vertexIndex, face, k) -> [u,v]; offset (см) вдоль нормали
  const addPrim = (label, faces, material, { uvFn, offset = 0, morph = false, weightsOverride = null, posOverride = null, weightsFrom = null, offsetFn = null, customW = null } = {}) => {
    if (!faces.length) return;
    const N = computeNormals(posOverride || W, faces);
    const map = new Map();
    const pos = [], nrm = [], uvs = [], jj = [], ww = [], src = [], idx = [];
    for (const f of faces) {
      const ids = f.v.map((v, k) => {
        const uv = uvFn(v, f, k);
        const key = `${v}|${uv[0].toFixed(5)}|${uv[1].toFixed(5)}`;
        if (map.has(key)) return map.get(key);
        const n = N.get(v) || [0, 1, 0];
        const p = (posOverride || W)[v];
        const off = offset * 0.01 * (offsetFn ? offsetFn(v) : 1);
        pos.push(p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off);
        nrm.push(...n); uvs.push(uv[0], uv[1]);
        const sv = weightsFrom ? weightsFrom.get(v) : v;
        const cw = customW && customW.get(sv);
        if (cw) { const l = cw.filter(q => q[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 4); const sum = l.reduce((a, q) => a + q[1], 0); for (let q = 0; q < 4; q++) { jj.push(l[q]?.[0] ?? 0); ww.push((l[q]?.[1] ?? 0) / sum); } }
        else if (weightsOverride !== null) { jj.push(weightsOverride, 0, 0, 0); ww.push(1, 0, 0, 0); }
        else { for (let q = 0; q < 4; q++) { jj.push(skinJ[sv * 4 + q]); ww.push(skinW[sv * 4 + q]); } }
        src.push(v);
        map.set(key, src.length - 1);
        return src.length - 1;
      });
      if (ids.length === 4) idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]); else idx.push(ids[0], ids[1], ids[2]);
    }
    const prim = {
      attributes: {
        POSITION: glb.accessor(new Float32Array(pos), 'VEC3', 5126, 34962, { minmax: true }),
        NORMAL: glb.accessor(new Float32Array(nrm), 'VEC3', 5126, 34962),
        TEXCOORD_0: glb.accessor(new Float32Array(uvs), 'VEC2', 5126, 34962),
        JOINTS_0: glb.accessor(new Uint16Array(jj), 'VEC4', 5123, 34962),
        WEIGHTS_0: glb.accessor(new Float32Array(ww), 'VEC4', 5126, 34962),
      },
      indices: glb.accessor(pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 'SCALAR', pos.length / 3 > 65535 ? 5125 : 5123, 34963),
      material,
    };
    if (morph) {
      prim.targets = EXPRESSIONS.map(([, rel]) => {
        const t = loadTarget(rel) || [];
        const tmap = new Map(t.map(([i, x, y, z]) => [i, [-x * 0.1, y * 0.1, -z * 0.1]]));
        const ids = [], vals = [];
        src.forEach((v, k) => { const d = tmap.get(v); if (d) { ids.push(k); vals.push(...d); } });
        return { POSITION: glb.sparseVec3(src.length, new Uint32Array(ids), new Float32Array(vals)) };
      });
    }
    prims.push(prim);
    console.log(`  ${label.padEnd(10)} ${String(src.length).padStart(6)} вершин, ${String(idx.length / 3).padStart(6)} треугольников`);
  };

  const baseUV = (v, f, k) => { const t = base.T[f.t[k]]; return [t[0], 1 - t[1]]; };
  addPrim('body', bodyFaces, skinMat, { uvFn: baseUV, morph: true });

  // ---------- одежда ----------
  // цилиндрическая развёртка вокруг главной кости вершины
  const jW = (name) => centroid(W, skel.joints[name]);
  const limb = {
    armL: [jW('upperarm01.L____head'), jW('wrist.L____head')], armR: [jW('upperarm01.R____head'), jW('wrist.R____head')],
    legL: [jW('upperleg01.L____head'), jW('foot.L____head')], legR: [jW('upperleg01.R____head'), jW('foot.R____head')],
    footL: [jW('foot.L____head'), jW('toe3-1.L____head')], footR: [jW('foot.R____head'), jW('toe3-1.R____head')],
  };
  const pelvisC = jW('spine05____head') || [0, 1, 0];
  const zoneAxis = (v) => {
    const r = domRegion[v], side = W[v][0] < 0 ? 'L' : 'R';
    // в W левая сторона персонажа — отрицательный x (разворот на 180°)
    const sideKey = W[v][0] < 0 ? 'L' : 'R';
    if (r === 'upperarm' || r === 'lowerarm' || r === 'hands') return limb['arm' + sideKey];
    if (r === 'upperleg' || r === 'lowerleg') return limb['leg' + sideKey];
    if (r === 'feet') return limb['foot' + sideKey];
    void side;
    return [[pelvisC[0], 0, pelvisC[2]], [pelvisC[0], 2, pelvisC[2]]];
  };
  const cylUV = (tile) => (v) => {
    const [h, t] = zoneAxis(v);
    const axis = V3.norm(V3.sub(t, h));
    const p = W[v];
    const rel = V3.sub(p, h);
    const along = V3.dot(rel, axis);
    const radial = V3.sub(rel, V3.mul(axis, along));
    const ref = Math.abs(axis[1]) > 0.8 ? [0, 0, 1] : [0, 1, 0];
    const bx = V3.norm(V3.cross(axis, ref)), by = V3.cross(axis, bx);
    const ang = Math.atan2(V3.dot(radial, by), V3.dot(radial, bx));
    const r = Math.max(0.03, V3.len(radial));
    return [(ang * r) / tile, -along / tile];
  };
  let skirtShape = null;
  const waistY = mix(jW('spine05____head')[1], jW('spine04____head')[1], 0.55);
  const skirtW = new Map(); // вершина -> [[кость, вес], ...]
  const pelvisB = boneIndex['spine05'] ?? boneIndex.root, thL = boneIndex['upperleg01.L'], thR = boneIndex['upperleg01.R'];
  const shL = boneIndex['lowerleg01.L'], shR = boneIndex['lowerleg01.R'];
  for (const part of cfg.outfit.parts) {
    let faces = part.from === 'tights' ? groupFaces['helper-tights'] : groupFaces['helper-skirt'];
    if (part.regions) faces = faces.filter(f => {
      const c = {}; f.v.forEach(v => { c[domRegion[v]] = (c[domRegion[v]] || 0) + 1; });
      let top = Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
      // по линии талии: торс ниже талии — это «штаны», бёдра выше — «рубашка»
      if (cfg.outfit.waist && (top === 'torso' || top === 'upperleg')) {
        const cy = f.v.reduce((a, v) => a + W[v][1], 0) / f.v.length;
        const armish = f.v.some(v => domRegion[v] === 'upperarm' || domRegion[v] === 'lowerarm');
        if (!armish) top = cy > waistY ? 'torso' : 'upperleg';
      }
      return part.regions.includes(top);
    });
    let posOverride = null;
    if (part.from === 'skirt') {
      // удлиняем юбку ниже колен, фартук — только передняя часть
      const vs = new Set(faces.flatMap(f => f.v));
      let top = -Infinity, bot = Infinity;
      for (const v of vs) { top = Math.max(top, W[v][1]); bot = Math.min(bot, W[v][1]); }
      posOverride = W.map(p => p);
      let cx = 0, cz = 0; for (const v of vs) { cx += W[v][0]; cz += W[v][2]; } cx /= vs.size; cz /= vs.size;
      for (const v of vs) {
        const p = W[v].slice();
        const t = (top - p[1]) / (top - bot);
        p[1] = top - t * (top - bot) * (1 + part.lengthen);
        const flare = 1 + Math.pow(t, 1.5) * 0.32;
        p[0] = cx + (p[0] - cx) * flare; p[2] = cz + (p[2] - cz) * flare;
        posOverride[v] = p;
      }
      skirtShape = { vs: [...vs], P: posOverride, cx, cz, top, bot: top - (top - bot) * (1 + part.lengthen) };
      const hemY = skirtShape.bot;
      for (const v of vs) {
        const t = clamp((top - posOverride[v][1]) / (top - hemY));
        const leg = 0.36 * t, shin = 0.12 * Math.max(0, t - 0.6) / 0.4;
        skirtW.set(v, [[pelvisB, 1 - 2 * leg - 2 * shin], [thL, leg], [thR, leg], [shL, shin], [shR, shin]]);
      }
    }
    if (part.from === 'tights') posOverride = flattenBorders(faces, posOverride || W);
    let offsetFn = null;
    if (part.hemOver) {
      // низ кофты ложится поверх пояса юбки
      let hem = Infinity; for (const f of faces) for (const v of f.v) if (domRegion[v] === 'torso') hem = Math.min(hem, W[v][1]);
      part._hem = hem;
      offsetFn = (v) => domRegion[v] === 'torso' ? (part.offset + 1.7 * smooth(hem + 0.12, hem, W[v][1])) / part.offset : 1;
    }
    if (part.from === 'skirt') {
      const cardigan = cfg.outfit.parts.find(q => q.hemOver);
      if (cardigan?._hem) faces = faces.filter(f => !f.v.every(v => (posOverride || W)[v][1] > cardigan._hem + 0.05));
    }
    if (part.inflateFeet) {
      posOverride = posOverride || W.map(p => p);
      const vs = new Set(faces.flatMap(f => f.v));
      for (const v of vs) { const p = posOverride[v].slice(); if (p[1] < 0.02) p[1] = Math.max(p[1], -0.005); posOverride[v] = p; }
    }
    const tex = fabricTile(part.fabric, part.color);
    const m = mat({
      name: part.name,
      pbrMetallicRoughness: { baseColorTexture: { index: glb.image(tex.jpg(88)) }, metallicFactor: 0, roughnessFactor: part.rough },
      normalTexture: { index: glb.image(tex.normalJpg(part.fabric === 'knit' ? 1.6 : 1.2, true)), scale: 1 },
      doubleSided: part.from === 'skirt',
      extras: { tint: !!part.tint },
    });
    addPrim(part.name, faces, m, { uvFn: cylUV(part.tile), offset: part.offset, posOverride, offsetFn, customW: part.from === 'skirt' ? skirtW : null });
  }

  // ---------- фартук: чистая панель поверх юбки ----------
  if (cfg.outfit.apron && skirtShape) {
    const { vs, P, cx, cz, top, bot } = skirtShape;
    const cols = 18, rows = 16, gen = [], faces = [], wts = [];
    const ang0 = cfg.outfit.apron.width;
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
      const a = (c / cols - 0.5) * 2 * ang0; // 0 — перед (-Z)
      const y = top - 0.02 - (r / rows) * (top - bot) * cfg.outfit.apron.length;
      // ближайшая вершина юбки по (угол, высота)
      let best = null, bd = Infinity;
      for (const v of vs) {
        const q = P[v];
        const qa = Math.atan2(q[0] - cx, -(q[2] - cz));
        const d = Math.abs(qa - a) * 0.25 + Math.abs(q[1] - y);
        if (d < bd) { bd = d; best = v; }
      }
      const q = P[best];
      const rad = Math.hypot(q[0] - cx, q[2] - cz) + 0.008 + 0.004 * (r / rows);
      gen.push({ p: [cx + Math.sin(a) * rad, y, cz - Math.cos(a) * rad], uv: [c / cols * 1.4, r / rows * 1.6], src: best });
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const a = r * (cols + 1) + c; faces.push([a, a + 1, a + cols + 2, a + cols + 1]); }
    const off = W.length;
    const P2 = W.concat(gen.map(g => g.p));
    const uvMap = new Map(gen.map((g, i) => [off + i, g.uv]));
    const srcMap = new Map(gen.map((g, i) => [off + i, g.src]));
    const tex = fabricTile('apron', [0.74, 0.70, 0.62]);
    const m = mat({ name: 'apron', pbrMetallicRoughness: { baseColorTexture: { index: glb.image(tex.jpg(88)) }, metallicFactor: 0, roughnessFactor: 0.85 },
      normalTexture: { index: glb.image(tex.normalJpg(2.5, true)) }, doubleSided: true });
    addPrim('apron', faces.map(q => ({ v: q.map(i => i + off) })), m, { uvFn: (v) => uvMap.get(v), posOverride: P2, weightsFrom: srcMap, customW: skirtW });
  }

  // ---------- волосы: растут из кожи головы по линии роста ----------
  const hairTex = fabricTile('hair', cfg.hair.color);
  const hairMat = mat({ name: 'hair', pbrMetallicRoughness: { baseColorTexture: { index: glb.image(hairTex.jpg(88)) }, metallicFactor: 0, roughnessFactor: 0.62 },
    normalTexture: { index: glb.image(hairTex.normalJpg(3, true)) }, doubleSided: true });
  const headBone = boneIndex.head;
  const scalpFaces = groupFaces.body.filter(f => f.v.every(v => domRegion[v] === 'head' || domRegion[v] === 'neck') && f.v.filter(v => isScalp(S[v])).length >= 3);
  const hairUV = (v) => { const p = S[v] || S[0]; const rel = V3.sub(p, skull); return [Math.atan2(rel[0], -rel[2]) / (Math.PI * 2) * 4, -rel[1] * 9 + Math.hypot(rel[0], rel[2]) * 2]; };
  // слои: основной «шлем» и второй, чуть выше и реже — даёт объём
  const hb = boundaryInfo(scalpFaces);
  addPrim('hair', scalpFaces, hairMat, { uvFn: hairUV, offset: cfg.hair.lift * 10, offsetFn: (v) => hb.border.has(v) ? 0.08 : hb.ring1.has(v) ? 0.55 : 1 });
  {
    let backTop = skull;
    for (const i of headVerts) { const q = S[i]; if (isScalp(q) && (-q[2] + q[1] * 0.8) > (-backTop[2] + backTop[1] * 0.8)) backTop = q; }
    const topY = headVerts.reduce((m, i) => Math.max(m, S[i][1]), 0);
    const toW = (q) => [-q[0], q[1], -q[2]]; // S -> W (разворот лицом к -Z)
    const gen = [];
    const addBlob = (cS, rx, ry, rz, seg = 20, twist = 0) => {
      const c = toW(cS);
      const start = gen.length;
      for (let i = 0; i <= seg; i++) for (let j = 0; j <= seg; j++) {
        const th = (i / seg) * Math.PI, ph = (j / seg) * Math.PI * 2;
        const wob = 1 + 0.07 * Math.sin(ph * 7 + th * 3 + twist) + 0.03 * Math.sin(ph * 23);
        gen.push({ p: [c[0] + Math.sin(th) * Math.cos(ph) * rx * wob, c[1] + Math.cos(th) * ry * wob, c[2] + Math.sin(th) * Math.sin(ph) * rz * wob], uv: [j / seg * 3, i / seg * 2] });
      }
      const faces = [];
      for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) { const a = start + i * (seg + 1) + j; faces.push([a, a + seg + 1, a + seg + 2, a + 1]); }
      return faces;
    };
    let faces = [];
    if (cfg.hair.style === 'bun') {
      // тугой пучок на затылке + лёгкий объём
      faces = faces.concat(addBlob([0, topY - 0.058, backTop[2] - 0.012], 0.04, 0.036, 0.032, 22, 1));
      faces = faces.concat(addBlob([0, topY - 0.082, backTop[2] + 0.004], 0.028, 0.02, 0.02, 14, 2));
    } else if (cfg.hair.style === 'ponytail') {
      faces = faces.concat(addBlob([0, topY - 0.06, backTop[2] - 0.02], 0.028, 0.026, 0.026, 14, 1));
      for (let k = 0; k < 6; k++) faces = faces.concat(addBlob([0, topY - 0.09 - k * 0.04, backTop[2] - 0.035 - Math.sin(k * 0.5) * 0.012], 0.026 - k * 0.0025, 0.03, 0.022 - k * 0.002, 12, k));
    }
    if (faces.length) {
      const offsetIdx = W.length;
      const P2 = W.concat(gen.map(g => g.p));
      const uvMap = new Map(gen.map((g, i) => [offsetIdx + i, g.uv]));
      addPrim('hairvol', faces.map(q => ({ v: q.map(i => i + offsetIdx) })), hairMat, { uvFn: (v) => uvMap.get(v), posOverride: P2, weightsOverride: headBone });
    }
  }

  // ---------- глаза (шары с радужкой, на костях eye.L/eye.R) ----------
  const eyeImg = eyeTexture(cfg.eyes);
  const eyeMat = mat({ name: 'eye', pbrMetallicRoughness: { baseColorTexture: { index: glb.image(eyeImg.jpg(92)) }, metallicFactor: 0, roughnessFactor: 0.08 } });
  for (const [g, bn] of [['helper-l-eye', 'eye.L'], ['helper-r-eye', 'eye.R']]) {
    const vs = groupVerts(g);
    const c = centroid(W, vs);
    let r = 0; for (const v of vs) r = Math.max(r, V3.len(V3.sub(W[v], c)));
    r *= 0.97;
    const seg = 24, gen = [], faces = [];
    for (let i = 0; i <= seg; i++) for (let j = 0; j <= seg; j++) {
      const th = (i / seg) * Math.PI, ph = (j / seg) * Math.PI * 2;
      // полюс th=0 смотрит вперёд (-Z)
      gen.push({ p: [c[0] + Math.sin(th) * Math.cos(ph) * r, c[1] + Math.sin(th) * Math.sin(ph) * r, c[2] - Math.cos(th) * r], uv: [j / seg, i / seg] });
    }
    for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) { const a = i * (seg + 1) + j; faces.push([a, a + 1, a + seg + 2, a + seg + 1]); }
    const off = W.length;
    const P2 = W.concat(gen.map(q => q.p));
    const uvMap = new Map(gen.map((q, i) => [off + i, q.uv]));
    addPrim(bn, faces.map(q => ({ v: q.map(i => i + off) })), eyeMat, { uvFn: (v) => uvMap.get(v), posOverride: P2, weightsOverride: boneIndex[bn] });
  }

  // ---------- зубы, язык, ресницы ----------
  const plain = (name, color, rough) => mat({ name, pbrMetallicRoughness: { baseColorFactor: [...color, 1], metallicFactor: 0, roughnessFactor: rough } });
  const flatUV = () => [0, 0];
  addPrim('teeth', [...groupFaces['helper-upper-teeth'], ...groupFaces['helper-lower-teeth']], plain('teeth', cfg.teeth, 0.3), { uvFn: flatUV });
  addPrim('tongue', groupFaces['helper-tongue'], plain('tongue', [0.62, 0.3, 0.3], 0.4), { uvFn: flatUV });
  addPrim('lashes', groupFaces.lashes, { ...{} } && mat({ name: 'lashes', pbrMetallicRoughness: { baseColorFactor: [0.05, 0.04, 0.035, 1], metallicFactor: 0, roughnessFactor: 0.8 }, doubleSided: true }), { uvFn: flatUV, morph: true });

  // ---------- узлы, скин ----------
  const nodes = glb.json.nodes;
  const boneNode = {};
  bones.forEach((b, i) => {
    const parent = b.parent ? bones[boneIndex[b.parent]] : null;
    const local = parent ? mat4Mul(mat4InvRigid(parent.global), b.global) : b.global;
    nodes.push({ name: b.name, translation: [local[12], local[13], local[14]], rotation: quatFromMat(local) });
    boneNode[b.name] = i;
  });
  bones.forEach((b, i) => {
    const kids = bones.filter(c => c.parent === b.name).map(c => boneNode[c.name]);
    if (kids.length) nodes[i].children = kids;
  });
  const ibm = new Float32Array(bones.length * 16);
  bones.forEach((b, i) => ibm.set(mat4InvRigid(b.global), i * 16));
  glb.json.skins.push({ joints: bones.map((b, i) => i), inverseBindMatrices: glb.accessor(ibm, 'MAT4', 5126), skeleton: boneNode.root });
  glb.json.meshes.push({ name: name, primitives: prims, extras: { targetNames: EXPRESSIONS.map(e => e[0]) } });
  // three.js берёт имена морфов из mesh.extras.targetNames — но они должны быть у каждого примитива с targets
  nodes.push({ name: name + '_mesh', mesh: 0, skin: 0 });
  const meshNode = nodes.length - 1;
  nodes.push({ name, children: [boneNode.root, meshNode] });
  glb.json.scenes[0].nodes = [nodes.length - 1];
  // морфы есть только у тела и ресниц — остальным примитивам нужны пустые таргеты той же длины
  for (const p of prims) if (!p.targets) {
    const cnt = glb.json.accessors[p.attributes.POSITION].count;
    p.targets = EXPRESSIONS.map(() => ({ POSITION: glb.sparseVec3(cnt, new Uint32Array(0), new Float32Array(0)) }));
  }
  const heightM = headTop - 0;
  glb.json.extras = { heightM, eyeY: eyeMid[1], source: 'MakeHuman CC0 base mesh, targets and rig' };
  const buf = glb.toBuffer();
  fs.writeFileSync(path.join(OUT, `${name}.glb`), buf);
  console.log(`✔ ${name}.glb — ${(buf.length / 1048576).toFixed(2)} МБ, рост ${heightM.toFixed(2)} м, ${bones.length} костей (${((Date.now() - t0) / 1000).toFixed(1)} с)\n`);
}

for (const [name, cfg] of Object.entries(CHARS)) {
  if (ONLY && ONLY !== name) continue;
  console.log(`▶ ${name}`);
  buildCharacter(name, cfg);
}
