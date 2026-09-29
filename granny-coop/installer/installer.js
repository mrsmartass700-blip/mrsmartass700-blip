// «Бабка Setup Wizard» — бэкенд установщика.
// Поднимает локальный HTTP-сервер (только 127.0.0.1, с токеном) и открывает интерфейс мастера окном Edge/Chrome.
// Реальная работа: копирование игры, встроенный Node.js, config.json, иконка, ярлыки, правило брандмауэра,
// запись в «Программы и компоненты», деинсталлятор.
// Флаги: --no-open (не открывать окно), --port=N, --dry (не трогать систему: ярлыки/реестр/брандмауэр пропускаются)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { grannyRGBA } from './ui/art.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');
const UI = path.join(HERE, 'ui');
const IS_WIN = process.platform === 'win32';
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const NO_OPEN = args.includes('--no-open');
const FIXED_PORT = Number((args.find(a => a.startsWith('--port=')) || '').split('=')[1]) || 0;
const TOKEN = crypto.randomBytes(12).toString('hex');
const APP_NAME = 'Бабка Кооп';
const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\BabkaCoop';
const VERSION = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8')).version;

// что копируем в папку установки
const PAYLOAD = ['server', 'shared', 'public', 'package.json', 'start.bat', 'start.sh', 'firewall.bat', 'README.md'];

// ================= утилиты =================
function walk(rel, out = []) {
  const abs = path.join(SRC, rel);
  if (!fs.existsSync(abs)) return out;
  const st = fs.statSync(abs);
  if (st.isDirectory()) for (const n of fs.readdirSync(abs)) walk(path.join(rel, n), out);
  else out.push({ rel, size: st.size });
  return out;
}

function payloadFiles() { return PAYLOAD.flatMap(p => walk(p)); }

function bundledNode() {
  const p = path.join(SRC, 'runtime', IS_WIN ? 'node.exe' : 'node');
  if (fs.existsSync(p)) return p;
  return process.execPath;
}

function run(cmd, argv, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, argv, { windowsHide: true, timeout: opts.timeout || 120000, encoding: 'utf8', maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      if (err) { err.stdout = stdout; err.stderr = stderr; reject(err); } else resolve(stdout);
    });
  });
}

// PowerShell через -EncodedCommand — никаких проблем с кириллицей и кавычками в путях
function ps(script, opts) {
  const pre = '[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ErrorActionPreference="Stop";';
  const enc = Buffer.from(pre + script, 'utf16le').toString('base64');
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...(opts?.sta ? ['-STA'] : []), '-EncodedCommand', enc], opts);
}
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`; // строка для PowerShell

function makeIco(sizes = [16, 32, 48, 64]) {
  const images = sizes.map(size => {
    const rgba = grannyRGBA(size);
    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0); header.writeInt32LE(size, 4); header.writeInt32LE(size * 2, 8);
    header.writeUInt16LE(1, 12); header.writeUInt16LE(32, 14);
    const maskRow = Math.ceil(size / 32) * 4;
    header.writeUInt32LE(size * size * 4 + maskRow * size, 20);
    const pix = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const s = ((size - 1 - y) * size + x) * 4, d = (y * size + x) * 4; // BMP снизу вверх, BGRA
      pix[d] = rgba[s + 2]; pix[d + 1] = rgba[s + 1]; pix[d + 2] = rgba[s]; pix[d + 3] = rgba[s + 3];
    }
    return Buffer.concat([header, pix, Buffer.alloc(maskRow * size)]);
  });
  const dir = Buffer.alloc(6 + 16 * images.length);
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(images.length, 4);
  let offset = dir.length;
  images.forEach((img, i) => {
    const e = 6 + i * 16, size = sizes[i];
    dir[e] = size >= 256 ? 0 : size; dir[e + 1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(img.length, e + 8); dir.writeUInt32LE(offset, e + 12);
    offset += img.length;
  });
  return Buffer.concat([dir, ...images]);
}

function radminInfo() {
  const ips = [];
  let adapter = false;
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal && (a.address.startsWith('26.') || /radmin/i.test(name))) ips.push(a.address);
      if (/radmin/i.test(name)) adapter = true;
    }
  }
  const paths = IS_WIN ? [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Radmin VPN', 'RvRvpnGui.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Radmin VPN', 'RvRvpnGui.exe'),
  ] : [];
  const installed = paths.some(p => fs.existsSync(p)) || adapter || ips.length > 0;
  return { installed, ips, adapter };
}

function defaultDir() {
  if (IS_WIN) return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'BabkaCoop');
  return path.join(os.homedir(), 'BabkaCoop');
}

function existingInstall(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')); } catch { return null; }
}

// ================= установка =================
const job = { running: false, done: false, error: null, progress: 0, steps: [], log: [], dir: null, opts: null };

function logLine(text, kind = 'info') { job.log.push({ t: Date.now(), text, kind }); console.log(`[${kind}] ${text}`); }

async function step(id, label, fn, { fatal = true } = {}) {
  const s = { id, label, state: 'run', msg: '' };
  job.steps.push(s);
  logLine(label);
  try {
    const r = await fn(s);
    s.state = r === 'skip' ? 'skip' : 'ok';
  } catch (e) {
    s.state = fatal ? 'fail' : 'warn';
    s.msg = e.userMessage || String(e.message || e).split('\n')[0];
    logLine(`${label}: ${s.msg}`, fatal ? 'error' : 'warn');
    if (fatal) throw e;
  }
}

function userErr(msg) { const e = new Error(msg); e.userMessage = msg; return e; }

async function install(opts) {
  Object.assign(job, { running: true, done: false, error: null, progress: 0, steps: [], log: [], opts });
  const dir = path.resolve(String(opts.dir || defaultDir()));
  job.dir = dir;
  const port = Math.min(65535, Math.max(1024, Number(opts.port) || 7777));
  const sys = IS_WIN && !DRY;
  try {
    await step('prepare', `Готовим жилплощадь: ${dir}`, async () => {
      if (!path.isAbsolute(dir)) throw userErr('Путь должен быть полным (например, C:\\Games\\BabkaCoop)');
      if (dir === SRC || dir.startsWith(SRC + path.sep)) throw userErr('Нельзя ставить бабку внутрь установщика. Выберите другую папку.');
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.babka-write-test');
      fs.writeFileSync(probe, 'пирожок'); fs.unlinkSync(probe);
    });

    const files = payloadFiles();
    const total = files.reduce((a, f) => a + f.size, 0);
    await step('copy', `Переносим бабку (${files.length} файлов, ${(total / 1048576).toFixed(1)} МБ)`, async () => {
      let done = 0;
      for (const f of files) {
        const to = path.join(dir, f.rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(path.join(SRC, f.rel), to);
        done += f.size;
        job.progress = 0.05 + 0.45 * (done / total);
        if (files.length > 20 && Math.random() < 0.08) await new Promise(r => setImmediate(r));
      }
    });

    await step('runtime', 'Вселяем Node.js, чтобы бабка могла бегать', async (s) => {
      const src = bundledNode();
      const to = path.join(dir, 'runtime', IS_WIN ? 'node.exe' : 'node');
      if (!IS_WIN) { s.msg = 'Не Windows — используем системный Node.js'; return 'skip'; }
      if (path.resolve(src) === path.resolve(to)) return 'skip';
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(src, to);
      job.progress = 0.62;
    });

    await step('config', 'Записываем бабкины привычки (config.json)', async () => {
      const cfg = {
        port, difficulty: opts.difficulty || 'normal', playerName: String(opts.playerName || '').slice(0, 16),
        version: VERSION, installedAt: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2));
      fs.writeFileSync(path.join(dir, 'babka.ico'), makeIco());
      job.progress = 0.66;
    });

    await step('uninstaller', 'Кладём деинсталлятор (на всякий случай. бабка против.)', async () => {
      const tpl = fs.readFileSync(path.join(HERE, 'uninstall.ps1'), 'utf8').replace(/^\uFEFF/, '');
      fs.writeFileSync(path.join(dir, 'uninstall.ps1'), '\uFEFF' + tpl.replace(/__PORT__/g, String(port)));
      fs.writeFileSync(path.join(dir, 'UNINSTALL.bat'),
        '@echo off\r\nchcp 65001 >nul\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"\r\n');
      job.progress = 0.7;
    });

    if (opts.desktop || opts.startMenu) {
      await step('shortcuts', 'Рисуем ярлыки (бабка позирует для иконки)', async (s) => {
        if (!sys) { s.msg = DRY ? 'Пробный режим' : 'Не Windows — ярлыки пропущены'; return 'skip'; }
        const target = path.join(dir, 'start.bat'), icon = path.join(dir, 'babka.ico');
        const script = `
          $w = New-Object -ComObject WScript.Shell
          function L($p, $t, $a, $d) { $l = $w.CreateShortcut($p); $l.TargetPath = $t; $l.Arguments = $a; $l.WorkingDirectory = ${psq(dir)}; $l.IconLocation = ${psq(icon)}; $l.Description = $d; $l.Save() }
          ${opts.desktop ? `L (Join-Path ([Environment]::GetFolderPath('Desktop')) ${psq(APP_NAME + '.lnk')}) ${psq(target)} '' 'Кооператив против бабки'` : ''}
          ${opts.startMenu ? `
          $sm = Join-Path ([Environment]::GetFolderPath('Programs')) ${psq(APP_NAME)}
          New-Item -ItemType Directory -Force -Path $sm | Out-Null
          L (Join-Path $sm ${psq(APP_NAME + '.lnk')}) ${psq(target)} '' 'Кооператив против бабки'
          L (Join-Path $sm 'Открыть порт в брандмауэре.lnk') ${psq(path.join(dir, 'firewall.bat'))} '${port}' 'Если друг не может подключиться'
          L (Join-Path $sm 'Удалить бабку.lnk') ${psq(path.join(dir, 'UNINSTALL.bat'))} '' 'Она обидится'` : ''}
        `;
        await ps(script);
        job.progress = 0.78;
      }, { fatal: false });
    }

    if (opts.firewall) {
      await step('firewall', `Договариваемся с брандмауэром о порте ${port} (Windows спросит разрешение — жмите «Да»)`, async (s) => {
        if (!sys) { s.msg = DRY ? 'Пробный режим' : 'Не Windows — брандмауэр пропущен'; return 'skip'; }
        const rule = `Babka Coop (TCP ${port})`;
        const cmdline = `/c netsh advfirewall firewall delete rule name="${rule}" >nul 2>&1 & netsh advfirewall firewall add rule name="${rule}" dir=in action=allow protocol=TCP localport=${port} profile=any`;
        try {
          await ps(`$p = Start-Process -FilePath 'cmd.exe' -ArgumentList ${psq(cmdline)} -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`, { timeout: 180000 });
        } catch (e) {
          throw userErr('Нет прав администратора (или вы нажали «Нет»). Потом можно запустить firewall.bat из папки игры.');
        }
        job.progress = 0.88;
      }, { fatal: false });
    }

    if (opts.register) {
      await step('register', 'Прописываем бабку в «Программы и компоненты»', async (s) => {
        if (!sys) { s.msg = DRY ? 'Пробный режим' : 'Не Windows — реестр пропущен'; return 'skip'; }
        const sizeKB = Math.round((total + (fs.existsSync(path.join(dir, 'runtime', 'node.exe')) ? fs.statSync(path.join(dir, 'runtime', 'node.exe')).size : 0)) / 1024);
        const vals = [
          ['DisplayName', 'REG_SZ', 'Бабка: Кооп'], ['DisplayVersion', 'REG_SZ', VERSION], ['Publisher', 'REG_SZ', 'Бабка и Внуки Inc.'],
          ['DisplayIcon', 'REG_SZ', path.join(dir, 'babka.ico')], ['InstallLocation', 'REG_SZ', dir],
          ['UninstallString', 'REG_SZ', `"${path.join(dir, 'UNINSTALL.bat')}"`], ['Comments', 'REG_SZ', 'Не удаляйте бабку. Она всё помнит.'],
          ['URLInfoAbout', 'REG_SZ', 'https://www.radmin-vpn.com/ru/'],
          ['NoModify', 'REG_DWORD', '1'], ['NoRepair', 'REG_DWORD', '1'], ['EstimatedSize', 'REG_DWORD', String(sizeKB)],
        ];
        for (const [name, type, data] of vals) await run('reg.exe', ['add', REG_KEY, '/v', name, '/t', type, '/d', data, '/f']);
        job.progress = 0.95;
      }, { fatal: false });
    }

    job.progress = 1;
    job.done = true;
    logLine('Установка завершена. Бабка заселилась.', 'ok');
  } catch (e) {
    job.error = e.userMessage || String(e.message || e);
    job.done = true;
  } finally {
    job.running = false;
  }
}

// ================= действия после установки =================
function openExternal(target) {
  if (DRY) { logLine(`(пробный режим) открыть: ${target}`); return; }
  if (IS_WIN) spawn('cmd.exe', ['/c', `start "" "${target}"`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [target], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

function launchGame(dir) {
  const cfg = existingInstall(dir);
  if (!cfg) throw userErr('Игра не найдена в папке установки');
  if (DRY) { logLine('(пробный режим) запуск игры'); return; }
  if (IS_WIN) {
    spawn('cmd.exe', ['/c', `start "Бабка: Кооп" "${path.join(dir, 'start.bat')}"`], { cwd: dir, detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  } else {
    spawn(process.execPath, [path.join(dir, 'server', 'index.js')], { cwd: dir, detached: true, stdio: 'ignore' }).unref();
  }
}

async function browseFolder(current) {
  if (!IS_WIN || DRY) return null;
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    $o = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }
    $f = New-Object System.Windows.Forms.FolderBrowserDialog
    $f.Description = 'Куда поселить бабку? (внутри будет создана папка BabkaCoop, если выберете обычную папку)'
    $f.SelectedPath = ${psq(current || '')}
    if ($f.ShowDialog($o) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }`;
  const out = (await ps(script, { sta: true, timeout: 600000 })).trim();
  if (!out) return null;
  return /babka/i.test(path.basename(out)) ? out : path.join(out, 'BabkaCoop');
}

// ================= HTTP =================
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ico': 'image/x-icon' };
let lastPing = Date.now();

function body(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', d => { s += d; if (s.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
  });
}

function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    if (req.headers['x-token'] !== TOKEN) return json(res, 403, { error: 'bad token' });
    lastPing = Date.now();
    try {
      switch (url.pathname) {
        case '/api/ping': return json(res, 200, { ok: true });
        case '/api/info': {
          const dir = defaultDir();
          const files = payloadFiles();
          const nodeSize = IS_WIN ? fs.statSync(bundledNode()).size : 0;
          return json(res, 200, {
            platform: process.platform, isWin: IS_WIN, dry: DRY,
            os: (os.version?.() || os.type()) + ' ' + os.release(), arch: os.arch(),
            user: os.userInfo().username, host: os.hostname(),
            ramGB: Math.round(os.totalmem() / 1073741824), cpus: os.cpus().length, cpuModel: (os.cpus()[0]?.model || '').trim(),
            node: process.version, version: VERSION,
            defaultDir: dir, existing: existingInstall(dir),
            radmin: radminInfo(),
            sizeBytes: files.reduce((a, f) => a + f.size, 0) + nodeSize, fileCount: files.length,
          });
        }
        case '/api/check-dir': {
          const b = await body(req);
          const dir = path.resolve(String(b.dir || ''));
          return json(res, 200, { dir, exists: fs.existsSync(dir), existing: existingInstall(dir), absolute: path.isAbsolute(String(b.dir || '')) });
        }
        case '/api/browse': { const b = await body(req); return json(res, 200, { dir: await browseFolder(b.dir) }); }
        case '/api/install': {
          if (job.running) return json(res, 409, { error: 'already running' });
          const b = await body(req);
          install(b);
          return json(res, 200, { ok: true });
        }
        case '/api/status': return json(res, 200, { ...job, opts: undefined });
        case '/api/launch': { const b = await body(req); launchGame(b.dir || job.dir); return json(res, 200, { ok: true }); }
        case '/api/open': {
          const b = await body(req);
          const map = { radmin: 'https://www.radmin-vpn.com/ru/', node: 'https://nodejs.org/', folder: job.dir, readme: job.dir && path.join(job.dir, 'README.md') };
          if (map[b.what]) openExternal(map[b.what]);
          return json(res, 200, { ok: true });
        }
        case '/api/quit': json(res, 200, { ok: true }); setTimeout(() => process.exit(0), 300); return;
      }
    } catch (e) {
      return json(res, 500, { error: e.userMessage || String(e.message || e) });
    }
    return json(res, 404, { error: 'not found' });
  }
  let rel = url.pathname === '/' ? '/index.html' : url.pathname;
  if (rel === '/favicon.ico') { res.writeHead(200, { 'Content-Type': 'image/x-icon' }); res.end(makeIco([16, 32])); return; }
  const file = path.normalize(path.join(UI, rel));
  if (!file.startsWith(UI + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

function findBrowserApp() {
  if (!IS_WIN) return null;
  const pf = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const cands = [];
  for (const base of pf) {
    cands.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    cands.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  return cands.find(p => fs.existsSync(p)) || null;
}

server.listen(FIXED_PORT, '127.0.0.1', () => {
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/?t=${TOKEN}`;
  console.log(`\n  Бабка Setup Wizard запущен: ${url}\n  (это окно можно свернуть; закроется само после установки)\n`);
  if (!NO_OPEN) {
    const app = findBrowserApp();
    if (app) {
      const profile = path.join(os.tmpdir(), 'babka-setup-profile');
      spawn(app, [`--app=${url}`, '--window-size=900,700', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check'],
        { detached: true, stdio: 'ignore' }).unref();
    } else openExternal(url);
  }
  // если окно мастера закрыли — выходим (интерфейс пингует каждые 3 сек)
  setInterval(() => { if (!job.running && Date.now() - lastPing > 45000) { console.log('Окно установщика закрыто. Выход.'); process.exit(0); } }, 5000);
});

