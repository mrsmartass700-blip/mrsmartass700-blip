// Точка входа BabkaCoop.exe (Node.js Single Executable Application).
// Все файлы клиента и установщика лежат внутри .exe (sea.getAsset).
//   BabkaCoop.exe                — запускает сервер игры и открывает браузер
//   BabkaCoop-Setup.exe          — тот же файл: если в имени есть «setup», запускается мастер установки
//   BabkaCoop.exe --setup        — то же самое явно
// Флаги: [порт] --no-browser --dry --no-open --port=N
import sea from 'node:sea';
import path from 'node:path';
import { startServer, readConfig } from '../server/app.js';
import { runInstaller } from '../installer/core.js';

/* global __VERSION__ */
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev';
const assets = {
  read(rel) {
    try { return Buffer.from(sea.getAsset(rel.replace(/\\/g, '/'))); } catch { return null; }
  },
};
const exeDir = path.dirname(process.execPath);
const args = process.argv.slice(1).filter(a => a !== process.execPath);
const setupMode = args.includes('--setup') || /setup|install|установ/i.test(path.basename(process.execPath));

// окно консоли не должно исчезать молча при ошибке
function fatal(msg) {
  console.error(`\n  [!] ${msg}\n`);
  console.error('  Нажмите Enter, чтобы закрыть окно.');
  process.stdin.resume();
  process.stdin.once('data', () => process.exit(1));
}
process.on('uncaughtException', (e) => fatal(e.userMessage || e.stack || String(e)));

if (setupMode) {
  process.title = 'Бабка Setup Wizard';
  console.log('\n  Бабка Setup Wizard 98 — сейчас откроется окно мастера установки.');
  console.log('  Это окно не закрывайте до конца установки (оно закроется само).\n');
  runInstaller({
    mode: 'exe', readAsset: assets.read, version: VERSION,
    dry: args.includes('--dry'), noOpen: args.includes('--no-open'),
    port: Number((args.find(a => a.startsWith('--port=')) || '').split('=')[1]) || 0,
  });
} else {
  process.title = 'Бабка: Кооп — сервер (не закрывайте, пока играете)';
  const config = readConfig(exeDir);
  const argPort = args.find(a => /^\d+$/.test(a));
  const port = Number(argPort || process.env.PORT || config.port || 7777);
  console.log(`  Бабка: Кооп v${VERSION}`);
  startServer({ port, config, assets, openBrowser: !args.includes('--no-browser') })
    .then((app) => process.on('SIGINT', () => { app.stop(); process.exit(0); }))
    .catch((e) => fatal(e.userMessage || e.message));
}
