// Smoke-тест собранного бинарника (BabkaCoop.exe или Linux-сборки).
//   node test/exe-smoke.js dist/BabkaCoop.exe [--full]
// --full: настоящая установка (ярлыки, реестр, брандмауэр) — только для одноразовой Windows-машины (CI).
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const exe = path.resolve(process.argv[2] || (process.platform === 'win32' ? 'dist/BabkaCoop.exe' : 'dist/babka-coop'));
const FULL = process.argv.includes('--full');
const IS_WIN = process.platform === 'win32';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const procs = [];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'babka-exe-'));

function run(file, args, cwd) {
  const p = spawn(file, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  p.out = '';
  p.stdout.on('data', d => { p.out += d; });
  p.stderr.on('data', d => { p.out += d; });
  procs.push(p);
  return p;
}
async function waitFor(p, re, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const m = p.out.match(re); if (m) return m; await sleep(100); }
  throw new Error(`не дождались ${re}\n--- вывод ---\n${p.out}`);
}
const ok = (t) => console.log('  ✓', t);

try {
  console.log(`Бинарник: ${exe} (${(fs.statSync(exe).size / 1048576).toFixed(1)} МБ)`);

  // ---------- режим игры ----------
  const game = run(exe, ['17777', '--no-browser'], tmp);
  await waitFor(game, /сервер запущен/);
  for (const u of ['/', '/js/main.js', '/vendor/three.module.min.js', '/shared/map.js'])
    assert.equal((await fetch(`http://127.0.0.1:17777${u}`)).status, 200, u);
  assert.equal((await fetch('http://127.0.0.1:17777/shared/../server/game.js')).status, 404);
  const client = (name) => new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:17777/ws');
    const c = { ws, msgs: [] };
    ws.onmessage = (e) => c.msgs.push(JSON.parse(e.data));
    ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello', name })); resolve(c); };
    ws.onerror = reject;
  });
  const until = async (c, pred) => { for (let i = 0; i < 100; i++) { if (c.msgs.some(pred)) return; await sleep(30); } throw new Error('нет сообщения'); };
  const A = await client('Хост'), B = await client('Друг');
  await until(B, m => m.t === 'welcome');
  B.ws.send(JSON.stringify({ t: 'ready', v: true }));
  await until(A, m => m.t === 'lobby' && m.players.some(p => p.ready));
  A.ws.send(JSON.stringify({ t: 'start' }));
  await until(B, m => m.t === 'start');
  await until(B, m => m.t === 'snap' && m.players.length === 2);
  A.ws.close(); B.ws.close();
  game.kill();
  ok('игра: сервер, клиентские файлы из .exe, 2 игрока стартуют');

  // ---------- режим установщика (копия с именем *-Setup) ----------
  const setupExe = path.join(tmp, IS_WIN ? 'BabkaCoop-Setup.exe' : 'babka-coop-setup');
  fs.copyFileSync(exe, setupExe);
  if (!IS_WIN) fs.chmodSync(setupExe, 0o755);
  const inst = run(setupExe, ['--no-open', '--port=17790', ...(FULL ? [] : ['--dry'])], tmp);
  const token = (await waitFor(inst, /t=([a-f0-9]+)/))[1];
  const api = async (p, body) => (await fetch(`http://127.0.0.1:17790${p}`, {
    method: body ? 'POST' : 'GET', headers: { 'X-Token': token, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
  })).json();
  assert.equal((await fetch(`http://127.0.0.1:17790/?t=${token}`)).status, 200);
  const info = await api('/api/info');
  assert.equal(info.mode, 'exe');
  const dir = path.join(tmp, 'Установлено', 'BabkaCoop'); // кириллица в пути — специально
  await api('/api/install', { dir, port: 17888, difficulty: 'hard', playerName: 'Тест', desktop: true, startMenu: true, firewall: true, register: true });
  let st;
  do { await sleep(200); st = await api('/api/status'); } while (!st.done);
  console.log(st.steps.map(s => `     ${s.state.padEnd(4)} ${s.label}${s.msg ? ' — ' + s.msg : ''}`).join('\n'));
  assert.equal(st.error, null);
  const exeName = 'BabkaCoop.exe';
  for (const f of [exeName, 'config.json', 'babka.ico', 'uninstall.ps1', 'UNINSTALL.bat', 'firewall.bat', 'README.md'])
    assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.equal(fs.statSync(path.join(dir, exeName)).size, fs.statSync(exe).size);
  if (FULL && IS_WIN) {
    for (const s of st.steps) assert.equal(s.state, s.id === 'runtime' ? 'skip' : 'ok', `${s.id}: ${s.msg}`);
    const desk = execFileSync('powershell.exe', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"], { encoding: 'utf8' }).trim();
    assert.ok(fs.existsSync(path.join(desk, 'Бабка Кооп.lnk')), 'ярлык на рабочем столе');
    const reg = execFileSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\BabkaCoop', '/v', 'DisplayName'], { encoding: 'utf8' });
    assert.ok(/REG_SZ/.test(reg), 'запись в «Программы и компоненты»');
    const fw = execFileSync('netsh', ['advfirewall', 'firewall', 'show', 'rule', 'name=Babka Coop (TCP 17888)'], { encoding: 'utf8' });
    assert.ok(/17888/.test(fw), 'правило брандмауэра');
    ok('установщик (полный): ярлыки, реестр, брандмауэр');
  }
  inst.kill();
  ok('установщик: .exe копирует себя, пишет config/иконку/деинсталлятор');

  // ---------- установленная игра читает config.json ----------
  const installed = run(path.join(dir, IS_WIN ? exeName : exeName), ['--no-browser'], dir);
  if (!IS_WIN) fs.chmodSync(path.join(dir, exeName), 0o755);
  await waitFor(installed, /порт 17888/);
  assert.equal((await fetch('http://127.0.0.1:17888/')).status, 200);
  installed.kill();
  ok('установленная игра запускается на порту из config.json');
} finally {
  for (const p of procs) try { p.kill(); } catch { /* уже завершён */ }
  const exited = (p) => p.exitCode !== null || p.signalCode !== null ? Promise.resolve() : new Promise(r => p.once('exit', r));
  await Promise.race([Promise.all(procs.map(exited)), sleep(5000)]);
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* файлы ещё заняты — не страшно */ }
}
