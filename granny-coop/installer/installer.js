// Запуск мастера установки из исходников (его вызывает SETUP.bat → setup.ps1).
// Флаги: --no-open (не открывать окно), --port=N, --dry (пробный режим: систему не трогаем)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInstaller } from './core.js';
import { fsAssets } from '../server/app.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
runInstaller({
  mode: 'tree',
  srcRoot: SRC,
  readAsset: fsAssets(SRC).read,
  version: JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8')).version,
  dry: args.includes('--dry'),
  noOpen: args.includes('--no-open'),
  port: Number((args.find(a => a.startsWith('--port=')) || '').split('=')[1]) || 0,
});
