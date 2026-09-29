// Мастер установки «Бабка: Кооп» — ядро (общее для SETUP.bat и BabkaCoop-Setup.exe).
// Поднимает локальный HTTP-сервер (только 127.0.0.1, с токеном) и открывает интерфейс мастера окном Edge/Chrome.
// Реальная работа: копирование игры, config.json, иконка, ярлыки, правило брандмауэра,
// запись в «Программы и компоненты», деинсталлятор.
// Режимы: 'tree' — копируем дерево исходников + Node.js рядом; 'exe' — копируем сам BabkaCoop.exe.
// Флаги: noOpen (не открывать окно), port, dry (не трогать систему: ярлыки/реестр/брандмауэр пропускаются)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { grannyRGBA } from './ui/art.js';
import { openAppWindow, openExternal as openUrl } from '../server/launcher.js';

const IS_WIN = process.platform === 'win32';
const TOKEN = crypto.randomBytes(12).toString('hex');
const APP_NAME = 'Бабка Кооп';
const EXE_NAME = 'BabkaCoop.exe';
const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\BabkaCoop';

// что копируем в папку установки (режим 'tree')
const PAYLOAD = ['server', 'shared', 'public', 'package.json', 'start.bat', 'start.sh', 'firewall.bat', 'README.md'];
// в режиме 'exe' рядом с BabkaCoop.exe кладём ещё эти файлы
const EXE_EXTRAS = ['firewall.bat', 'README.md'];

let SRC = '', MODE = 'tree', DRY = false, NO_OPEN = false, FIXED_PORT = 0, VERSION = '1.0.0';
let readAsset = () => null;

// ================= утилиты =================
function walk(rel, out = []) {
  const abs = path.join(SRC, rel);
  if (!fs.existsSync(abs)) return out;
  const st = fs.statSync(abs);
  if (st.isDirectory()) for (const n of fs.readdirSync(abs)) walk(path.join(rel, n), out);
  else out.push({ rel, size: st.size });
  return out;
}

function payloadFiles() {
  if (MODE === 'exe') {
    return [{ rel: EXE_NAME, from: process.execPath, size: fs.statSync(process.execPath).size },
      ...EXE_EXTRAS.map(rel => ({ rel, data: readAsset(rel) })).filter(f => f.data).map(f => ({ ...f, size: f.data.length }))];
  }
  return PAYLOAD.flatMap(p => walk(p));
}

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
async function ps(script, opts) {
  const pre = '[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ErrorActionPreference="Stop";$ProgressPreference="SilentlyContinue";\n';
  const wrapped = `${pre}try {\n${script}\n} catch { [Console]::Out.WriteLine("BABKA_ERR: " + $_.Exception.Message + " | " + ($_.InvocationInfo.PositionMessage -replace "\\s+", " ")); exit 1 }`;
  const enc = Buffer.from(wrapped, 'utf16le').toString('base64');
  try {
    return await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...(opts?.sta ? ['-STA'] : []), '-EncodedCommand', enc], opts);
  } catch (e) {
    const m = String(e.stdout || '').match(/BABKA_ERR: (.*)/);
    if (m) { e.stderr = m[1]; e.message = m[1]; }
    throw e;
  }
}
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`; // строка для PowerShell

// ICO: PNG-кадры из отрендеренной 3D-бабки (installer/ui/img/icon-N.png); если их нет — пиксельная бабка (BMP)
function makeIco(read = readAsset, sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]) {
  const pngs = sizes.map(s => read(`installer/ui/img/icon-${s}.png`));
  if (pngs.every(Boolean)) return icoFrom(sizes, pngs);
  const avail = sizes.filter((s, i) => pngs[i]);
  if (avail.length >= 3) return icoFrom(avail, pngs.filter(Boolean));
  const bmpSizes = [16, 32, 48, 64];
  return icoFrom(bmpSizes, bmpSizes.map(bmpIcon));
}

function bmpIcon(size) {
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
}

function icoFrom(sizes, images) {
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

// свободное место на диске (ближайшая существующая папка вверх по пути)
function freeBytes(dir) {
  let d = path.resolve(dir);
  for (let i = 0; i < 30 && !fs.existsSync(d); i++) d = path.dirname(d);
  try { const st = fs.statfsSync(d); return st.bavail * st.bsize; } catch { return null; }
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
    s.msg = e.userMessage || (e.stderr && String(e.stderr).trim().split('\n').slice(-6).join(' ').slice(0, 600)) || String(e.message || e).split('\n')[0];
    logLine(`${label}: ${s.msg}`, fatal ? 'error' : 'warn');
    if (fatal) throw e;
  }
}

function plural(n, one, few, many) { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many; }

function userErr(msg) { const e = new Error(msg); e.userMessage = msg; return e; }

async function install(opts) {
  Object.assign(job, { running: true, done: false, error: null, progress: 0, steps: [], log: [], opts });
  const dir = path.resolve(String(opts.dir || defaultDir()));
  job.dir = dir;
  const port = Math.min(65535, Math.max(1024, Number(opts.port) || 7777));
  const sys = IS_WIN && !DRY;
  try {
    await step('prepare', `Подготовка папки: ${dir}`, async () => {
      if (!path.isAbsolute(dir)) throw userErr('Путь должен быть полным (например, C:\\Games\\BabkaCoop)');
      if (MODE === 'tree' && (dir === SRC || dir.startsWith(SRC + path.sep))) throw userErr('Нельзя ставить бабку внутрь установщика. Выберите другую папку.');
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.babka-write-test');
      fs.writeFileSync(probe, 'пирожок'); fs.unlinkSync(probe);
    });

    const files = payloadFiles();
    const total = files.reduce((a, f) => a + f.size, 0);
    await step('copy', `Копирование файлов игры (${files.length} ${plural(files.length, 'файл', 'файла', 'файлов')}, ${(total / 1048576).toFixed(1)} МБ)`, async () => {
      let done = 0;
      for (const f of files) {
        const to = path.join(dir, f.rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        try {
          if (f.data) fs.writeFileSync(to, f.data);
          else fs.copyFileSync(f.from || path.join(SRC, f.rel), to);
        } catch (e) {
          if (e.code === 'EBUSY' || e.code === 'EPERM') throw userErr(`Файл ${f.rel} занят. Закройте игру «Бабка Кооп», если она запущена, и попробуйте снова.`);
          throw e;
        }
        done += f.size;
        job.progress = 0.05 + 0.45 * (done / total);
        if (files.length > 20 && Math.random() < 0.08) await new Promise(r => setImmediate(r));
      }
    });

    await step('runtime', 'Установка среды выполнения Node.js', async (s) => {
      if (MODE === 'exe') { s.msg = 'Node.js уже встроен в BabkaCoop.exe'; return 'skip'; }
      const src = bundledNode();
      const to = path.join(dir, 'runtime', IS_WIN ? 'node.exe' : 'node');
      if (!IS_WIN) { s.msg = 'Не Windows — используем системный Node.js'; return 'skip'; }
      if (path.resolve(src) === path.resolve(to)) return 'skip';
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(src, to);
      job.progress = 0.62;
    });

    await step('config', 'Сохранение настроек (config.json)', async () => {
      const cfg = {
        port, difficulty: opts.difficulty || 'normal', playerName: String(opts.playerName || '').slice(0, 16),
        version: VERSION, installedAt: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2));
      fs.writeFileSync(path.join(dir, 'babka.ico'), makeIco(readAsset));
      job.progress = 0.66;
    });

    await step('uninstaller', 'Создание деинсталлятора', async () => {
      const tpl = readAsset('installer/uninstall.ps1').toString('utf8').replace(/^\uFEFF/, '');
      fs.writeFileSync(path.join(dir, 'uninstall.ps1'), '\uFEFF' + tpl.replace(/__PORT__/g, String(port)));
      fs.writeFileSync(path.join(dir, 'UNINSTALL.bat'),
        '@echo off\r\nstart "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0uninstall.ps1"\r\n');
      job.progress = 0.7;
    });

    if (opts.desktop || opts.startMenu) {
      await step('shortcuts', 'Создание ярлыков', async (s) => {
        if (!sys) { s.msg = DRY ? 'Пробный режим' : 'Не Windows — ярлыки пропущены'; return 'skip'; }
        const target = path.join(dir, MODE === 'exe' ? EXE_NAME : 'start.bat'), icon = path.join(dir, 'babka.ico');
        // IShellLinkW (Unicode) — WScript.Shell ломается на кириллице в не-русской локали
        const script = `
          Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Text;
[ComImport, Guid("00021401-0000-0000-C000-000000000046")] class CShellLink {}
[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
interface IShellLinkW {
  void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder f, int c, IntPtr fd, int fl); void GetIDList(out IntPtr p); void SetIDList(IntPtr p);
  void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder s, int c); void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string s);
  void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder s, int c); void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string s);
  void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder s, int c); void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string s);
  void GetHotkey(out short h); void SetHotkey(short h); void GetShowCmd(out int i); void SetShowCmd(int i);
  void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder s, int c, out int i); void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string s, int i);
  void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string s, int r); void Resolve(IntPtr h, int f); void SetPath([MarshalAs(UnmanagedType.LPWStr)] string s);
}
[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("0000010b-0000-0000-C000-000000000046")]
interface IPersistFile {
  void GetClassID(out Guid g); [PreserveSig] int IsDirty(); void Load([MarshalAs(UnmanagedType.LPWStr)] string f, int m);
  void Save([MarshalAs(UnmanagedType.LPWStr)] string f, bool r); void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string f); void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string f);
}
public static class BabkaLink {
  public static void Make(string lnk, string target, string args, string dir, string icon, string desc) {
    var l = (IShellLinkW)new CShellLink();
    l.SetPath(target); l.SetArguments(args); l.SetWorkingDirectory(dir); l.SetIconLocation(icon, 0); l.SetDescription(desc);
    ((IPersistFile)l).Save(lnk, true);
  }
}
'@
          function L($p, $t, $a, $d) { [BabkaLink]::Make($p, $t, $a, ${psq(dir)}, ${psq(icon)}, $d) }
          ${opts.desktop ? `L (Join-Path ([Environment]::GetFolderPath('Desktop')) ${psq(APP_NAME + '.lnk')}) ${psq(target)} '' 'Кооператив против бабки'` : ''}
          ${opts.startMenu ? `
          $sm = Join-Path ([Environment]::GetFolderPath('Programs')) ${psq(APP_NAME)}
          New-Item -ItemType Directory -Force -Path $sm | Out-Null
          L (Join-Path $sm ${psq(APP_NAME + '.lnk')}) ${psq(target)} '' 'Кооператив против бабки'
          L (Join-Path $sm 'Открыть порт в брандмауэре.lnk') ${psq(path.join(dir, 'firewall.bat'))} '${port}' 'Если друг не может подключиться'
          L (Join-Path $sm 'Удалить «Бабка Кооп».lnk') (Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe') ${psq(`-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${path.join(dir, 'uninstall.ps1')}"`)} 'Удаление игры'` : ''}
        `;
        await ps(script);
        job.progress = 0.78;
      }, { fatal: false });
    }

    if (opts.firewall) {
      await step('firewall', `Правило брандмауэра для порта ${port} (подтвердите запрос Windows)`, async (s) => {
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
      await step('register', 'Регистрация в «Приложениях» Windows', async (s) => {
        if (!sys) { s.msg = DRY ? 'Пробный режим' : 'Не Windows — реестр пропущен'; return 'skip'; }
        const sizeKB = Math.round((total + (fs.existsSync(path.join(dir, 'runtime', 'node.exe')) ? fs.statSync(path.join(dir, 'runtime', 'node.exe')).size : 0)) / 1024);
        const vals = [
          ['DisplayName', 'REG_SZ', 'Бабка: Кооп'], ['DisplayVersion', 'REG_SZ', VERSION], ['Publisher', 'REG_SZ', 'Бабка и Внуки'],
          ['DisplayIcon', 'REG_SZ', path.join(dir, 'babka.ico')], ['InstallLocation', 'REG_SZ', dir],
          ['UninstallString', 'REG_SZ', `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${path.join(dir, 'uninstall.ps1')}"`], ['Comments', 'REG_SZ', 'Кооперативный хоррор для LAN и Radmin VPN'],
          ['URLInfoAbout', 'REG_SZ', 'https://www.radmin-vpn.com/ru/'],
          ['NoModify', 'REG_DWORD', '1'], ['NoRepair', 'REG_DWORD', '1'], ['EstimatedSize', 'REG_DWORD', String(sizeKB)],
        ];
        for (const [name, type, data] of vals) await run('reg.exe', ['add', REG_KEY, '/v', name, '/t', type, '/d', data, '/f']);
        job.progress = 0.95;
      }, { fatal: false });
    }

    job.progress = 1;
    job.done = true;
    logLine('Установка завершена.', 'ok');
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
  openUrl(target);
}

function launchGame(dir) {
  const cfg = existingInstall(dir);
  if (!cfg) throw userErr('Игра не найдена в папке установки');
  if (DRY) { logLine('(пробный режим) запуск игры'); return; }
  if (IS_WIN) {
    if (fs.existsSync(path.join(dir, EXE_NAME))) spawn(path.join(dir, EXE_NAME), [], { cwd: dir, detached: true, stdio: 'ignore' }).unref();
    else spawn('cmd.exe', ['/c', 'start "Бабка: Кооп" "start.bat"'], { cwd: dir, detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  } else if (fs.existsSync(path.join(dir, EXE_NAME.replace('.exe', '')))) {
    spawn(path.join(dir, EXE_NAME.replace('.exe', '')), [], { cwd: dir, detached: true, stdio: 'ignore' }).unref();
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
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
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
          const nodeSize = IS_WIN && MODE === 'tree' ? fs.statSync(bundledNode()).size : 0;
          return json(res, 200, {
            platform: process.platform, isWin: IS_WIN, dry: DRY, mode: MODE,
            os: (os.version?.() || os.type()) + ' ' + os.release(), arch: os.arch(),
            user: os.userInfo().username, host: os.hostname(),
            ramGB: Math.round(os.totalmem() / 1073741824), cpus: os.cpus().length, cpuModel: (os.cpus()[0]?.model || '').trim(),
            node: process.version, version: VERSION,
            defaultDir: dir, existing: existingInstall(dir), free: freeBytes(dir), dryHint: DRY,
            radmin: radminInfo(),
            sizeBytes: files.reduce((a, f) => a + f.size, 0) + nodeSize, fileCount: files.length,
          });
        }
        case '/api/check-dir': {
          const b = await body(req);
          const dir = path.resolve(String(b.dir || ''));
          return json(res, 200, { dir, exists: fs.existsSync(dir), existing: existingInstall(dir), absolute: path.isAbsolute(String(b.dir || '')), free: path.isAbsolute(String(b.dir || '')) ? freeBytes(dir) : null });
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
  if (rel === '/favicon.ico') { res.writeHead(200, { 'Content-Type': 'image/x-icon' }); res.end(makeIco(readAsset, [16, 32, 48])); return; }
  const clean = path.posix.normalize(rel);
  const data = !clean.includes('..') && readAsset('installer/ui' + clean);
  if (!data) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(clean)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(data);
});

// opts: { mode, srcRoot, readAsset, version, dry, noOpen, port }
export function runInstaller(opts) {
  MODE = opts.mode || 'tree';
  SRC = opts.srcRoot || '';
  readAsset = opts.readAsset;
  VERSION = opts.version || VERSION;
  DRY = !!opts.dry; NO_OPEN = !!opts.noOpen; FIXED_PORT = opts.port || 0;
  server.listen(FIXED_PORT, '127.0.0.1', onListen);
}

function onListen() {
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/?t=${TOKEN}`;
  console.log(`\n  Мастер установки запущен: ${url}\n  (это окно можно свернуть; закроется само после установки)\n`);
  if (!NO_OPEN) {
    // окно мастера закрыли крестиком — выходим (если не идёт установка)
    openAppWindow(url, { profile: 'setup', width: 1060, height: 720, onClose: () => { if (!job.running) process.exit(0); } });
  }
  // если окно мастера закрыли — выходим (интерфейс пингует каждые 3 сек)
  setInterval(() => { if (!job.running && Date.now() - lastPing > 45000) { console.log('Окно установщика закрыто. Выход.'); process.exit(0); } }, 5000);
}

export { makeIco };

