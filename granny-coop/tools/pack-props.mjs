// Упаковка реквизита из Khronos glTF-Sample-Assets: текстуры -> макс. 1024px JPEG (PNG, если нужна прозрачность),
// дорогие расширения (преломление/объём) заменяются обычной прозрачностью. Выход: public/models/props/*.glb + CREDITS.
//   node tools/pack-props.mjs [путь к glTF-Sample-Assets]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv.slice(2).find(a => !a.startsWith('--')) || '/home/user/khronosgroup/gltf-sample-assets';
const OUT = path.join(ROOT, 'public', 'models', 'props');
fs.mkdirSync(OUT, { recursive: true });

const PROPS = [
  { id: 'armchair', src: 'ChairDamaskPurplegold', max: 1024 },
  { id: 'sofa', src: 'GlamVelvetSofa', max: 1024 },
  { id: 'chair', src: 'SheenChair', max: 1024 },
  { id: 'vase', src: 'GlassVaseFlowers', max: 512 },
  { id: 'barnlamp', src: 'AnisotropyBarnLamp', max: 512 },
  { id: 'brokenwindow', src: 'GlassBrokenWindow', max: 512 },
  { id: 'lantern', src: 'Lantern', max: 512 },
];
const STRIP = ['KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_diffuse_transmission', 'KHR_materials_anisotropy', 'KHR_materials_variants', 'KHR_lights_punctual'];

function readGlb(file) {
  const b = fs.readFileSync(file);
  const jl = b.readUInt32LE(12);
  const json = JSON.parse(b.slice(20, 20 + jl).toString('utf8'));
  const bo = 20 + jl;
  const bl = b.readUInt32LE(bo);
  return { json, bin: b.slice(bo + 8, bo + 8 + bl) };
}

function decode(buf, mime) {
  if (mime === 'image/png' || buf[0] === 0x89) { const p = PNG.sync.read(buf); return { w: p.width, h: p.height, data: p.data }; }
  const j = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
  return { w: j.width, h: j.height, data: j.data };
}

function resize(img, max) {
  const s = Math.max(img.w, img.h) / max;
  if (s <= 1) return img;
  const w = Math.max(1, Math.round(img.w / s)), h = Math.max(1, Math.round(img.h / s));
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.floor(x * s), x1 = Math.max(x0 + 1, Math.floor((x + 1) * s)), y0 = Math.floor(y * s), y1 = Math.max(y0 + 1, Math.floor((y + 1) * s));
    const acc = [0, 0, 0, 0]; let n = 0;
    for (let yy = y0; yy < y1 && yy < img.h; yy++) for (let xx = x0; xx < x1 && xx < img.w; xx++) {
      const i = (yy * img.w + xx) * 4; for (let c = 0; c < 4; c++) acc[c] += img.data[i + c]; n++;
    }
    for (let c = 0; c < 4; c++) out[(y * w + x) * 4 + c] = Math.round(acc[c] / n);
  }
  return { w, h, data: out };
}

function hasAlpha(img) { for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 250) return true; return false; }

const credits = [];
for (const p of PROPS) {
  const dir = path.join(SRC, 'Models', p.src);
  const file = fs.readdirSync(path.join(dir, 'glTF-Binary')).find(f => f.endsWith('.glb'));
  const { json, bin } = readGlb(path.join(dir, 'glTF-Binary', file));
  const imageViews = new Map();
  // материалы, которым нужна альфа
  const alphaTex = new Set();
  for (const m of json.materials || []) {
    if (m.extensions) {
      const tr = m.extensions.KHR_materials_transmission;
      if (tr) { m.alphaMode = 'BLEND'; m.pbrMetallicRoughness ||= {}; const f = m.pbrMetallicRoughness.baseColorFactor || [1, 1, 1, 1]; f[3] = Math.min(f[3], 1 - 0.75 * (tr.transmissionFactor ?? 1)); m.pbrMetallicRoughness.baseColorFactor = f; }
      for (const e of STRIP) delete m.extensions[e];
    }
    if (m.alphaMode && m.alphaMode !== 'OPAQUE' && m.pbrMetallicRoughness?.baseColorTexture) alphaTex.add(json.textures[m.pbrMetallicRoughness.baseColorTexture.index].source);
  }
  json.extensionsUsed = (json.extensionsUsed || []).filter(e => !STRIP.includes(e));
  if (json.extensionsRequired) json.extensionsRequired = json.extensionsRequired.filter(e => !STRIP.includes(e));
  if (json.extensions) for (const e of STRIP) delete json.extensions[e];
  for (const n of json.nodes || []) if (n.extensions) for (const e of STRIP) delete n.extensions[e];
  for (const mesh of json.meshes || []) for (const pr of mesh.primitives) if (pr.extensions) for (const e of STRIP) delete pr.extensions[e];
  let saved = 0;
  (json.images || []).forEach((im, idx) => {
    const bv = json.bufferViews[im.bufferView];
    const raw = bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    let img = resize(decode(raw, im.mimeType), p.max);
    let out, mime;
    if (alphaTex.has(idx) && hasAlpha(img)) { const png = new PNG({ width: img.w, height: img.h }); img.data.copy(png.data); out = PNG.sync.write(png); mime = 'image/png'; }
    else { out = Buffer.from(jpeg.encode({ data: img.data, width: img.w, height: img.h }, 85).data); mime = 'image/jpeg'; }
    saved += raw.length - out.length;
    imageViews.set(im.bufferView, out);
    im.mimeType = mime;
  });
  // пересобираем бинарный буфер
  const chunks = []; let off = 0;
  json.bufferViews.forEach((bv, i) => {
    const data = imageViews.get(i) || bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; }
    bv.byteOffset = off; bv.byteLength = data.length; bv.buffer = 0;
    chunks.push(data); off += data.length;
  });
  let binOut = Buffer.concat(chunks); binOut = Buffer.concat([binOut, Buffer.alloc((4 - (binOut.length % 4)) % 4)]);
  json.buffers = [{ byteLength: binOut.length }];
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + binOut.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binOut.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  const glb = Buffer.concat([head, jh, js, bh, binOut]);
  fs.writeFileSync(path.join(OUT, p.id + '.glb'), glb);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8'));
  const legal = (meta.legal || []).map(l => `${l.artist || l.owner || ''} (${l.license})${l.what ? ' — ' + l.what : ''}`).join('; ');
  credits.push(`${p.id}.glb — «${meta.name || p.src}» из KhronosGroup/glTF-Sample-Assets: ${legal}`);
  console.log(`✔ ${p.id.padEnd(13)} ${(glb.length / 1024).toFixed(0).padStart(6)} КБ (сжато на ${(saved / 1048576).toFixed(1)} МБ)`);
}
fs.writeFileSync(path.join(OUT, 'CREDITS.txt'), 'Реквизит (упакован tools/pack-props.mjs, текстуры уменьшены):\n\n' + credits.join('\n') + '\n\nЛицензии: CC0 1.0 и CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Источник: https://github.com/KhronosGroup/glTF-Sample-Assets\n');
console.log('\n' + credits.join('\n'));
