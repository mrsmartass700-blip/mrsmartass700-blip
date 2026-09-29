// Smoke-тест установщика: пробная установка во временную папку + запуск установленной игры.
// Запуск: node test/installer-smoke.js
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 17795;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'babka-inst-'));
const target = path.join(dir, 'BabkaCoop');
const inst = spawn(process.execPath, ['installer/installer.js', '--dry', '--no-open', `--port=${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
inst.stdout.on('data', d => { out += d; });
const kill = [];
try {
  for (let i = 0; i < 50 && !/t=[a-f0-9]+/.test(out); i++) await new Promise(r => setTimeout(r, 100));
  const token = out.match(/t=([a-f0-9]+)/)[1];
  const api = async (p, body) => {
    const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: body ? 'POST' : 'GET', headers: { 'X-Token': token, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, json: await r.json() };
  };
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/api/info`)).status, 403, 'без токена — нельзя');
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/`)).status, 200);
  const info = (await api('/api/info')).json;
  assert.ok(info.sizeBytes > 500000 && info.fileCount > 10);
  assert.equal((await api('/api/install', { dir: 'relative/path' })).status, 200);
  let st;
  do { await new Promise(r => setTimeout(r, 100)); st = (await api('/api/status')).json; } while (!st.done);
  assert.ok(st.error, 'относительный путь отклонён');
  await api('/api/install', { dir: target, port: 7788, difficulty: 'hard', playerName: 'Тест', desktop: true, startMenu: true, firewall: true, register: true });
  do { await new Promise(r => setTimeout(r, 100)); st = (await api('/api/status')).json; } while (!st.done);
  assert.equal(st.error, null, JSON.stringify(st.steps));
  for (const f of ['server/index.js', 'public/vendor/three.module.min.js', 'shared/map.js', 'start.bat', 'UNINSTALL.bat', 'uninstall.ps1', 'babka.ico', 'config.json'])
    assert.ok(fs.existsSync(path.join(target, f)), f);
  const cfg = JSON.parse(fs.readFileSync(path.join(target, 'config.json'), 'utf8'));
  assert.deepEqual([cfg.port, cfg.difficulty, cfg.playerName], [7788, 'hard', 'Тест']);
  assert.ok(fs.readFileSync(path.join(target, 'uninstall.ps1'), 'utf8').includes("$port = '7788'"));
  assert.ok(!fs.existsSync(path.join(target, 'test')), 'тесты не копируются');
  // установленная игра запускается и читает config.json (порт 7788)
  const game = spawn(process.execPath, ['server/index.js', '--no-browser'], { cwd: target, stdio: ['ignore', 'pipe', 'pipe'] });
  kill.push(game);
  let gout = '';
  game.stdout.on('data', d => { gout += d; });
  for (let i = 0; i < 50 && !gout.includes('сервер запущен'); i++) await new Promise(r => setTimeout(r, 100));
  assert.ok(gout.includes('порт 7788'), gout);
  assert.equal((await fetch('http://127.0.0.1:7788/')).status, 200);
  console.log('  ✓ установщик: пробная установка, конфиг, запуск установленной игры');
} finally {
  // на Windows файлы освобождаются только после фактического выхода процесса
  const exited = (p) => p.exitCode !== null || p.signalCode !== null ? Promise.resolve() : new Promise(r => p.once('exit', r));
  inst.kill();
  for (const k of kill) k.kill();
  await Promise.race([Promise.all([inst, ...kill].map(exited)), new Promise(r => setTimeout(r, 5000))]);
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (e) { console.warn('  (не удалось удалить временную папку:', e.code + ')'); }
}
