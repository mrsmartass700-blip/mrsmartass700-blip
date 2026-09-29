// Сборка BabkaCoop.exe — Node.js Single Executable Application (SEA).
//   npm install && npm run build:exe                  -> dist/BabkaCoop.exe + dist/BabkaCoop-Setup.exe (Windows x64)
//   node tools/build-exe.mjs --target=linux-x64       -> dist/babka-coop (для проверки на Linux)
// Собрать Windows-exe можно на любой ОС: скачивается официальный node.exe той же версии, что и текущий Node.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { inject } from 'postject';
import * as ResEdit from 'resedit';
import { makeIco } from '../installer/core.js';
import { fsAssets } from '../server/app.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'build'), DIST = path.join(ROOT, 'dist'), CACHE = path.join(BUILD, 'cache');
const target = (process.argv.find(a => a.startsWith('--target=')) || '--target=win-x64').split('=')[1];
const isWin = target.startsWith('win');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const NODE_VERSION = process.version;
const step = (t) => console.log(`\n▶ ${t}`);
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });

// 1. один CommonJS-файл со всем серверным кодом
step('Бандл серверного кода (esbuild)');
const bundle = path.join(BUILD, 'bundle.cjs');
await esbuild.build({
  entryPoints: [path.join(ROOT, 'exe', 'entry.js')], bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  outfile: bundle, define: { __VERSION__: JSON.stringify(pkg.version) }, logLevel: 'warning',
});
console.log(`  ${(fs.statSync(bundle).size / 1024).toFixed(0)} КБ`);

// 2. ассеты: клиент игры, общий код, интерфейс установщика
step('Сбор ассетов');
const assets = {};
const addDir = (rel) => {
  for (const n of fs.readdirSync(path.join(ROOT, rel))) {
    const r = path.posix.join(rel, n), abs = path.join(ROOT, r);
    if (fs.statSync(abs).isDirectory()) addDir(r); else assets[r] = abs;
  }
};
addDir('public'); addDir('shared'); addDir('installer/ui');
for (const f of ['installer/uninstall.ps1', 'firewall.bat', 'README.md']) assets[f] = path.join(ROOT, f);
console.log(`  ${Object.keys(assets).length} файлов`);

// 3. SEA-блоб (без code cache/snapshot — так блоб подходит для другой ОС)
step('Подготовка SEA-блоба');
const blob = path.join(BUILD, 'sea-prep.blob');
const seaConfig = path.join(BUILD, 'sea-config.json');
fs.writeFileSync(seaConfig, JSON.stringify({
  main: bundle, output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, assets,
}, null, 2));
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

// 4. исходный бинарник Node той же версии
step(`Базовый бинарник Node ${NODE_VERSION} (${target})`);
let base;
if (isWin) {
  base = path.join(CACHE, `node-${NODE_VERSION}-${target}.exe`);
  if (!fs.existsSync(base)) {
    const url = `https://nodejs.org/dist/${NODE_VERSION}/${target}/node.exe`;
    console.log(`  скачиваю ${url}`);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Не удалось скачать ${url}: HTTP ${r.status}`);
    fs.writeFileSync(base, Buffer.from(await r.arrayBuffer()));
  }
} else {
  base = process.execPath;
}
const baseExe = fs.readFileSync(base);
const CONSOLE = process.argv.includes('--console');

// 5. иконка и сведения о файле (только Windows) — отдельно для игры и для установщика
function withResources(desc, original) {
  if (!isWin) return baseExe;
  const nt = ResEdit.NtExecutable.from(baseExe, { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(nt);
  const ico = ResEdit.Data.IconFile.from(makeIco(fsAssets(ROOT).read));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const targets = groups.length ? groups.map(g => [g.id, g.lang]) : [[1, 1033]];
  for (const [id, lang] of targets) ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, lang, ico.icons.map(i => i.data));
  const vis = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const vi = vis[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const [a, b, c] = pkg.version.split('.').map(Number);
  const langs = vi.getAllLanguagesForStringValues();
  const lang = langs[0] || { lang: 1033, codepage: 1200 };
  vi.setFileVersion(a, b, c, 0, lang.lang);
  vi.setProductVersion(a, b, c, 0, lang.lang);
  vi.setStringValues(lang, {
    ProductName: 'Бабка: Кооп', FileDescription: desc,
    CompanyName: 'Бабка и Внуки', LegalCopyright: '© Бабка и Внуки. Все тапки защищены.',
    OriginalFilename: original, InternalName: original.replace('.exe', ''), ProductVersion: pkg.version, FileVersion: pkg.version,
    Comments: `Собрано на Node.js ${NODE_VERSION}`,
  });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(nt);
  return Buffer.from(nt.generate());
}

// PE: подсистема Windows GUI (2) — без чёрного окна консоли. Node сам подставит «пустые» stdout/stderr.
function setGuiSubsystem(file) {
  const buf = fs.readFileSync(file);
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('не PE-файл');
  const opt = pe + 24;
  const magic = buf.readUInt16LE(opt);
  if (magic !== 0x20b && magic !== 0x10b) throw new Error('неизвестный Optional Header');
  buf.writeUInt16LE(2, opt + 68);
  fs.writeFileSync(file, buf);
}

// 6. внедряем блоб
async function build(file, desc) {
  const out = path.join(DIST, file);
  fs.writeFileSync(out, withResources(desc, file.replace(/^babka-coop(-setup)?$/, 'BabkaCoop$1.exe')));
  await inject(out, 'NODE_SEA_BLOB', fs.readFileSync(blob), { sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2' });
  if (isWin && !CONSOLE) setGuiSubsystem(out);
  if (!isWin) fs.chmodSync(out, 0o755);
  return out;
}
// установщик копирует сам себя как BabkaCoop.exe, поэтому оба файла — один и тот же бинарник
step('Внедрение блоба (postject) и подсистема GUI');
const out = await build(isWin ? 'BabkaCoop.exe' : 'babka-coop', 'Бабка: Кооп — кооперативный хоррор (LAN / Radmin VPN)');
const setup = path.join(DIST, isWin ? 'BabkaCoop-Setup.exe' : 'babka-coop-setup');
fs.copyFileSync(out, setup);
console.log(`\n✔ Готово:\n  ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} МБ) — игра\n  ${setup} — тот же файл, запускает мастер установки`);
