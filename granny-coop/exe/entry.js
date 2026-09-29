// Точка входа BabkaCoop.exe (Node.js Single Executable Application).
// Все файлы клиента и установщика лежат внутри .exe (sea.getAsset).
//   BabkaCoop.exe                — сервер игры + окно игры (Edge/Chrome в режиме приложения)
//   BabkaCoop-Setup.exe          — тот же файл: если в имени есть «setup», запускается мастер установки
//   BabkaCoop.exe --setup        — то же самое явно
// Флаги: [порт] --no-browser --console --dry --no-open --port=N
// На Windows exe собран как GUI-приложение (без чёрного окна консоли): лог пишется в
// %LOCALAPPDATA%\BabkaCoop\logs, ошибки показываются диалогом.
import sea from 'node:sea';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer, readConfig } from '../server/app.js';
import { runInstaller } from '../installer/core.js';
import { openAppWindow, appDataDir } from '../server/launcher.js';

/* global __VERSION__ */
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev';
const IS_WIN = process.platform === 'win32';
const assets = {
  read(rel) {
    try { return Buffer.from(sea.getAsset(rel.replace(/\\/g, '/'))); } catch { return null; }
  },
};
const exeDir = path.dirname(process.execPath);
const args = process.argv.slice(1).filter(a => a !== process.execPath);
const setupMode = args.includes('--setup') || /setup|install|установ/i.test(path.basename(process.execPath));
const headless = args.includes('--no-browser') || args.includes('--no-open');

// ---------- лог в файл (у GUI-приложения нет консоли) ----------
let logFile = null;
try {
  const dir = path.join(appDataDir(), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  logFile = path.join(dir, setupMode ? 'setup.log' : 'game.log');
  fs.writeFileSync(logFile, `Бабка: Кооп v${VERSION} — ${new Date().toISOString()}\n`);
  for (const k of ['log', 'warn', 'error']) {
    const orig = console[k].bind(console);
    console[k] = (...a) => { orig(...a); try { fs.appendFileSync(logFile, a.map(String).join(' ') + '\n'); } catch { /* диск */ } };
  }
} catch { logFile = null; }

// ---------- ошибки: диалог Windows, а не молча исчезнувшее окно ----------
function messageBox(text, title = 'Бабка: Кооп', icon = 'Error') {
  if (!IS_WIN || headless) return;
  const ps = `Add-Type -AssemblyName PresentationFramework; [void][System.Windows.MessageBox]::Show(@'\n${text.replace(/'@/g, "' @")}\n'@, '${title}', 'OK', '${icon}')`;
  try { execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { windowsHide: true, timeout: 600000 }); } catch { /* нет PowerShell */ }
}
function fatal(msg) {
  console.error(`\n  [!] ${msg}\n`);
  messageBox(`${msg}${logFile ? `\n\nПодробности: ${logFile}` : ''}`);
  process.exit(1);
}
process.on('uncaughtException', (e) => fatal(e.userMessage || e.stack || String(e)));

if (setupMode) {
  process.title = 'Бабка: Кооп — установка';
  console.log('\n  Мастер установки «Бабка: Кооп» — сейчас откроется окно.\n');
  runInstaller({
    mode: 'exe', readAsset: assets.read, version: VERSION,
    dry: args.includes('--dry'), noOpen: args.includes('--no-open'),
    port: Number((args.find(a => a.startsWith('--port=')) || '').split('=')[1]) || 0,
  });
} else {
  process.title = 'Бабка: Кооп — сервер';
  const config = readConfig(exeDir);
  const argPort = args.find(a => /^\d+$/.test(a));
  const port = Number(argPort || process.env.PORT || config.port || 7777);
  console.log(`  Бабка: Кооп v${VERSION}`);
  const openWindow = (url, onClose) => openAppWindow(url, { profile: 'game', width: 1600, height: 900, maximized: true, onClose });

  startServer({ port, config, assets, openBrowser: false })
    .then((app) => {
      const quit = (why) => { console.log(`Выход: ${why}`); app.stop(); process.exit(0); };
      process.on('SIGINT', () => quit('Ctrl+C'));
      if (headless) return;
      const win = openWindow(app.url, () => {
        // окно закрыто: даём другу доиграть до выхода из дома, но не держим сервер вечно
        setTimeout(() => { if (app.conn.count === 0) quit('окно игры закрыто'); }, 1500);
      });
      // страховка (обычный браузер или окно не отследить): все отключились на 90 с — выходим
      setInterval(() => {
        const idle = Date.now() - app.conn.lastChange;
        if (app.conn.count === 0 && (app.conn.ever ? idle > 90000 : idle > 15 * 60000)) quit('никого нет');
      }, 5000);
      if (win && win.owned) console.log('Окно игры открыто.');
    })
    .catch((e) => {
      if (e.code !== 'EADDRINUSE' || headless) return fatal(e.userMessage || e.message);
      // порт занят: если это уже запущенная игра — просто открываем к ней окно
      fetch(`http://127.0.0.1:${port}/`).then(r => r.text()).then((html) => {
        if (!html.includes('БАБКА')) throw new Error('чужой сервер');
        console.log(`Игра уже запущена на порту ${port} — открываем окно.`);
        openWindow(`http://localhost:${port}/`);
        setTimeout(() => process.exit(0), 3000);
      }).catch(() => fatal(e.userMessage || e.message));
    });
}
