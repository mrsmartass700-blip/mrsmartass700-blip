// Точка входа при запуске из исходников: node server/index.js [порт] [--no-browser]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, fsAssets, readConfig } from './app.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// config.json (создаёт установщик): { "port": 7777, "difficulty": "normal", "playerName": "..." }
const config = readConfig(ROOT);
const argPort = process.argv.slice(2).find(a => /^\d+$/.test(a));
const port = Number(argPort || process.env.PORT || config.port || 7777);
const openBrowser = !process.argv.includes('--no-browser') && !process.env.NO_BROWSER;

startServer({ port, config, assets: fsAssets(ROOT), openBrowser })
  .then((app) => process.on('SIGINT', () => { app.stop(); process.exit(0); }))
  .catch((e) => { console.error(`\n[!] ${e.userMessage || e.message}\n`); process.exit(1); });
