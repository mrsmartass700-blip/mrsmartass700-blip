// Запуск игрового сервера. Файлы клиента берутся через «assets»: с диска (обычный запуск) или изнутри .exe.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';
import { attachWebSocket } from './ws.js';
import { Game } from './game.js';
import { DIFFICULTIES } from '../shared/map.js';

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

// assets.read('public/index.html') -> Buffer | null
export function fsAssets(root) {
  return {
    read(rel) {
      const file = path.normalize(path.join(root, rel));
      if (!file.startsWith(root + path.sep)) return null;
      try { return fs.statSync(file).isFile() ? fs.readFileSync(file) : null; } catch { return null; }
    },
  };
}

export function listAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      out.push({ name, address: a.address, radmin: a.address.startsWith('26.') || /radmin/i.test(name) });
    }
  }
  out.sort((a, b) => Number(b.radmin) - Number(a.radmin));
  return out;
}

// URL -> путь внутри ассетов (только public/ и shared/, без выхода наружу)
export function resolveAsset(urlPath) {
  let url;
  try { url = decodeURIComponent(urlPath.split('?')[0]); } catch { return null; }
  if (url === '/') url = '/index.html';
  if (url.includes('\0')) return null;
  const clean = path.posix.normalize(url);
  if (clean.includes('..')) return null;
  return clean.startsWith('/shared/') ? clean.slice(1) : 'public' + clean;
}

export function startServer({ port = 7777, config = {}, assets, openBrowser = true, quiet = false } = {}) {
  const log = quiet ? () => {} : (...a) => console.log(...a);
  const server = http.createServer((req, res) => {
    const rel = resolveAsset(req.url || '/');
    const data = rel && assets.read(rel);
    if (!data) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
  const addresses = listAddresses();
  const game = new Game({ addresses, port });
  if (config.difficulty && DIFFICULTIES[config.difficulty]) game.difficulty = config.difficulty;
  attachWebSocket(server, '/ws', (ws) => game.onConnection(ws));

  return new Promise((resolve, reject) => {
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') e.userMessage = `Порт ${port} уже занят. Возможно, игра уже запущена (проверьте другие окна) или укажите другой порт.`;
      reject(e);
    });
    server.listen(port, '0.0.0.0', () => {
      const line = '='.repeat(62);
      log(`\n${line}\n  БАБКА: КООП — сервер запущен (порт ${port})\n${line}`);
      log(`  Вы (хост) открываете:   http://localhost:${port}`);
      const rad = addresses.filter(a => a.radmin);
      if (rad.length) for (const a of rad) log(`  Друг по Radmin VPN:     http://${a.address}:${port}   <-- отправьте это другу`);
      else log('  [!] Адрес Radmin VPN (26.x.x.x) не найден. Запустите Radmin VPN и войдите в сеть.');
      for (const a of addresses.filter(a => !a.radmin)) log(`  Другие сети (${a.name}): http://${a.address}:${port}`);
      log(`${line}\n  Не закрывайте это окно, пока идёт игра. Ctrl+C — остановить.\n`);
      if (openBrowser) {
        const u = `http://localhost:${port}/${config.playerName ? `?name=${encodeURIComponent(config.playerName)}` : ''}`;
        const cmd = process.platform === 'win32' ? `start "" "${u}"` : process.platform === 'darwin' ? `open "${u}"` : `xdg-open "${u}"`;
        exec(cmd, () => {});
      }
      resolve({ server, game, port, addresses, stop() { game.stop(); server.close(); } });
    });
  });
}

export function readConfig(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')); } catch { return {}; }
}
