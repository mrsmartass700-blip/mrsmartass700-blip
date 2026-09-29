// Точка входа: HTTP-сервер (раздаёт клиент) + WebSocket (/ws) + игровая комната.
// Запуск: node server/index.js [порт]
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { attachWebSocket } from './ws.js';
import { Game } from './game.js';
import { DIFFICULTIES } from '../shared/map.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// config.json (создаёт установщик): { "port": 7777, "difficulty": "normal" }
let config = {};
try { config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')); } catch { /* нет файла — по умолчанию */ }
const argPort = process.argv.slice(2).find(a => /^\d+$/.test(a));
const PORT = Number(argPort || process.env.PORT || config.port || 7777);
const OPEN_BROWSER = !process.argv.includes('--no-browser') && !process.env.NO_BROWSER;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

function listAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      const radmin = a.address.startsWith('26.') || /radmin/i.test(name);
      out.push({ name, address: a.address, radmin });
    }
  }
  out.sort((a, b) => Number(b.radmin) - Number(a.radmin));
  return out;
}

function serveFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent((req.url || '/').split('?')[0]); } catch { url = '/'; }
  if (url === '/') url = '/index.html';
  const shared = url.startsWith('/shared/');
  const base = path.join(ROOT, shared ? 'shared' : 'public');
  const file = path.normalize(path.join(base, shared ? url.slice('/shared'.length) : url));
  if (!file.startsWith(base + path.sep)) { res.writeHead(403); res.end(); return; }
  serveFile(res, file);
});

const addresses = listAddresses();
const game = new Game({ addresses, port: PORT });
if (config.difficulty) game.difficulty = config.difficulty in DIFFICULTIES ? config.difficulty : game.difficulty;
attachWebSocket(server, '/ws', (ws) => game.onConnection(ws));

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n[!] Порт ${PORT} уже занят. Возможно, сервер уже запущен. Или укажите другой: node server/index.js 7778\n`);
  else console.error(e);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const line = '='.repeat(60);
  console.log(`\n${line}\n  БАБКА: КООП — сервер запущен (порт ${PORT})\n${line}`);
  console.log(`  Вы (хост) открываете:   http://localhost:${PORT}`);
  const rad = addresses.filter(a => a.radmin);
  if (rad.length) for (const a of rad) console.log(`  Друг по Radmin VPN:     http://${a.address}:${PORT}   <-- отправьте это другу`);
  else console.log('  [!] Адрес Radmin VPN (26.x.x.x) не найден. Запустите Radmin VPN и войдите в сеть.');
  for (const a of addresses.filter(a => !a.radmin)) console.log(`  Другие сети (${a.name}): http://${a.address}:${PORT}`);
  console.log(`${line}\n  Не закрывайте это окно, пока идёт игра. Ctrl+C — остановить.\n`);
  if (OPEN_BROWSER) {
    const u = `http://localhost:${PORT}/${config.playerName ? `?name=${encodeURIComponent(config.playerName)}` : ''}`;
    const cmd = process.platform === 'win32' ? `start "" "${u}"` : process.platform === 'darwin' ? `open "${u}"` : `xdg-open "${u}"`;
    exec(cmd, () => {});
  }
});

process.on('SIGINT', () => { game.stop(); server.close(); process.exit(0); });
