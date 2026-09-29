// Рендер иконки (PNG 16…512) и обложки установщика из 3D-модели бабки.
// Нужен Playwright + Chromium (dev-инструмент): node tools/render-art.mjs [--chrome=путь]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { fsAssets, resolveAsset, MIME } from '../server/app.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromePath = process.argv.find(a => a.startsWith('--chrome='))?.split('=')[1] || process.env.CHROME;
let chromium;
// playwright ищем в проекте или в папке из PW_DIR (dev-зависимость, в игру не входит)
try { ({ chromium } = createRequire(path.join(process.env.PW_DIR || ROOT, 'noop.js'))('playwright')); } catch { console.error('Нужен пакет playwright (npm i -D playwright) или PW_DIR=папка с node_modules'); process.exit(1); }
const assets = fsAssets(ROOT);
const srv = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  const file = u.startsWith('/tools/art/') ? path.join(ROOT, u) : null;
  const data = file ? fs.readFileSync(file) : assets.read(resolveAsset(u) || '');
  if (!data) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); res.end(data);
}).listen(0, '127.0.0.1');
await new Promise(r => srv.once('listening', r));
const base = `http://127.0.0.1:${srv.address().port}/tools/art/render.html`;
const browser = await chromium.launch({ executablePath: chromePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', e => console.error('page:', e.message));
const b64 = (d) => Buffer.from(d.split(',')[1], 'base64');
const IMG = path.join(ROOT, 'installer', 'ui', 'img');
fs.mkdirSync(IMG, { recursive: true });

await page.goto(`${base}?kind=icon&w=512&h=512`);
await page.waitForFunction(() => window.__done, null, { timeout: 180000 });
const icons = await page.evaluate(() => window.__icons);
for (const [size, d] of Object.entries(icons)) if (size !== '512') fs.writeFileSync(path.join(IMG, `icon-${size}.png`), b64(d));
fs.copyFileSync(path.join(IMG, 'icon-256.png'), path.join(ROOT, 'public', 'icon.png'));
console.log('✔ иконки', Object.keys(icons).join(', '));

const [w, h] = [720, 960];
await page.goto(`${base}?kind=hero&w=${w}&h=${h}`);
await page.waitForFunction(() => window.__done, null, { timeout: 180000 });
// обложка — JPEG через canvas страницы (PNG такого размера весит в 10 раз больше)
fs.writeFileSync(path.join(IMG, 'hero.jpg'), b64(await page.evaluate(() => { const c = document.createElement('canvas'); const s = document.querySelector('canvas'); c.width = s.width; c.height = s.height; c.getContext('2d').drawImage(s, 0, 0); return c.toDataURL('image/jpeg', 0.88); })));
console.log('✔ обложка');
await browser.close(); srv.close();
