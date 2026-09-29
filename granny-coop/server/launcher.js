// Окна приложения: игра и мастер установки открываются отдельным окном Edge/Chrome (режим --app),
// без вкладок и адресной строки. Нет Edge/Chrome — открываем браузер по умолчанию.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const IS_WIN = process.platform === 'win32';

export function findAppBrowser() {
  const cands = [];
  if (IS_WIN) {
    const bases = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
    for (const b of bases) cands.push(path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    for (const b of bases) cands.push(path.join(b, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    for (const b of bases) cands.push(path.join(b, 'Yandex', 'YandexBrowser', 'Application', 'browser.exe'));
  } else if (process.platform === 'darwin') {
    cands.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  } else {
    cands.push('/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  }
  return cands.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

export function openExternal(target) {
  if (IS_WIN) spawn('cmd.exe', ['/c', `start "" "${target}"`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).on('error', () => {}).unref();
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [target], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

export function appDataDir() {
  const base = IS_WIN ? (process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')) : path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'BabkaCoop');
}

// Открывает окно-приложение. Возвращает { proc, owned } — owned=true, если это наш процесс браузера
// (у отдельного профиля свой процесс, он живёт, пока открыто окно). null — открыли обычный браузер.
export function openAppWindow(url, { profile = 'window', width = 1280, height = 800, maximized = false, onClose } = {}) {
  const exe = findAppBrowser();
  if (!exe) { openExternal(url); return null; }
  const dataDir = path.join(appDataDir(), 'browser-' + profile);
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch { /* не критично */ }
  const args = [
    `--app=${url}`, `--user-data-dir=${dataDir}`, `--window-size=${width},${height}`,
    '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-features=Translate,msEdgeSidebarV2,msHubApps',
    '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  ];
  if (maximized) args.push('--start-maximized');
  const started = Date.now();
  const proc = spawn(exe, args, { detached: true, stdio: 'ignore' });
  const res = { proc, owned: true };
  proc.on('error', () => { res.owned = false; openExternal(url); });
  proc.on('exit', () => {
    // если процесс сразу вышел — окно передано уже запущенному браузеру с этим профилем, закрытие не отследить
    if (Date.now() - started < 4000) { res.owned = false; return; }
    onClose?.();
  });
  proc.unref();
  return res;
}
