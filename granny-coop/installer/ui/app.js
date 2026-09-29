// Мастер установки «Бабка: Кооп»: интерфейс поверх локального API установщика (installer/core.js).
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const TOKEN = new URLSearchParams(location.search).get('t') || '';
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mb = (b) => b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} ГБ` : `${(b / 1048576).toFixed(1)} МБ`;

async function api(path, data) {
  const r = await fetch(path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'X-Token': TOKEN, 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
setInterval(() => api('/api/ping').catch(() => {}), 3000);

// ---------- тихие звуки интерфейса ----------
const Sfx = {
  ctx: null,
  init() { if (!this.ctx) try { this.ctx = new AudioContext(); } catch { /* без звука */ } },
  tone(f, dur, vol = 0.05, type = 'sine', when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.05);
  },
  click() { this.tone(1400, 0.05, 0.025, 'triangle'); },
  next() { this.tone(660, 0.12, 0.03); this.tone(990, 0.16, 0.025, 'sine', 0.05); },
  done() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.6, 0.035, 'sine', i * 0.09)); },
  error() { this.tone(180, 0.3, 0.05, 'sawtooth'); },
};
addEventListener('pointerdown', () => Sfx.init(), { once: true });

// ---------- состояние ----------
const PAGES = ['welcome', 'license', 'options', 'install', 'finish'];
const state = {
  page: 0, info: null, dir: '', port: 7777, name: '', difficulty: 'normal',
  comps: { desktop: true, startMenu: true, firewall: true, register: true },
  eulaRead: false, installing: false, installed: false, result: null,
};
const DIFF_HINT = {
  easy: 'Бабка медленная и туговата на ухо. Для первого знакомства с домом.',
  normal: 'Как задумано: слышит шаги, проверяет шкафы, ставит капканы.',
  hard: 'Быстрая, внимательная, реже отвлекается. Прятаться надо лучше.',
  nightmare: 'Бегает, слышит всё, в доме темнее. Удачи.',
};
const COMPS = [
  ['desktop', 'Ярлык на рабочем столе', 'Чтобы бабка всегда была под рукой'],
  ['startMenu', 'Ярлыки в меню «Пуск»', 'Игра, открытие порта и удаление'],
  ['firewall', 'Разрешить подключения друзей', 'Правило брандмауэра для порта игры — Windows попросит подтверждение', true],
  ['register', 'Добавить в «Приложения»', 'Чтобы игру можно было удалить через параметры Windows'],
];
const FOOT = {
  welcome: 'Бабка спит. Устанавливайте тихо.',
  license: 'Юристы бабки читали это дважды.',
  options: 'Настройки можно поменять и после установки.',
  install: 'Не закрывайте окно — бабка раскладывает вещи.',
  finish: 'Спасибо, что заглянули.',
};

// ---------- навигация ----------
function show(i) {
  state.page = i;
  const name = PAGES[i];
  $$('.page').forEach(p => p.classList.toggle('show', p.dataset.page === name));
  $$('#steps li').forEach((li, k) => { li.classList.toggle('cur', k === i); li.classList.toggle('done', k < i); });
  $('#footNote').textContent = FOOT[name];
  enter[name]?.();
  nav();
}
function nav() {
  const name = PAGES[state.page];
  const back = $('#back'), next = $('#next'), cancel = $('#cancel');
  back.hidden = name === 'welcome' || name === 'install' || name === 'finish';
  cancel.hidden = name === 'finish';
  cancel.disabled = state.installing;
  next.disabled = false;
  next.textContent = { welcome: 'Далее', license: 'Принимаю', options: 'Установить', install: 'Далее', finish: 'Готово' }[name];
  if (name === 'license') next.disabled = !$('#eulaOk').checked;
  if (name === 'options') next.disabled = !!$('#dirErr').textContent;
  if (name === 'install') next.disabled = !state.installed;
}
$('#next').onclick = () => {
  Sfx.next();
  const name = PAGES[state.page];
  if (name === 'finish') return finish();
  if (name === 'options') { saveOptions(); return show(3); }
  show(state.page + 1);
};
$('#back').onclick = () => { Sfx.click(); show(Math.max(0, state.page - 1)); };
$('#cancel').onclick = () => cancelFlow();
addEventListener('keydown', (e) => {
  const modalOpen = !$('#modalBack').hidden;
  if (e.key === 'Enter' && !modalOpen && !$('#next').disabled && document.activeElement?.tagName !== 'BUTTON') $('#next').click();
  if (e.key === 'Escape' && !modalOpen) cancelFlow();
});

const enter = {};

// ---------- 1. приветствие ----------
function renderSysinfo() {
  const i = state.info;
  if (!i) return;
  const cells = [
    ['Система', i.isWin ? (i.os || 'Windows').replace(/Windows (\d+) \S+/, 'Windows $1').slice(0, 40) : i.os, ''],
    ['Процессор', `${i.cpus} ${i.cpus % 10 === 1 && i.cpus % 100 !== 11 ? 'ядро' : i.cpus % 10 >= 2 && i.cpus % 10 <= 4 && (i.cpus % 100 < 12 || i.cpus % 100 > 14) ? 'ядра' : 'ядер'}`, i.cpus >= 4 ? 'ok' : 'warn'],
    ['Память', `${i.ramGB} ГБ`, i.ramGB >= 4 ? 'ok' : 'warn'],
    ['Radmin VPN', i.radmin.installed ? (i.radmin.ips[0] || 'установлен') : 'не найден', i.radmin.installed ? 'ok' : 'warn'],
  ];
  $('#sysinfo').innerHTML = cells.map(([k, v, c]) => `<div><small>${k}</small><b class="${c}" title="${esc(v)}">${esc(v)}</b></div>`).join('');
  const ex = i.existing;
  if (ex) {
    $('#existingBox').hidden = false;
    $('#existingBox').innerHTML = `<b>Игра уже установлена</b> (версия ${esc(ex.version || '?')}). Мастер обновит её, сохранив ваши настройки.`;
  }
  if (i.dry) $('#ver').textContent += ' · пробный режим';
}

// ---------- 2. лицензия ----------
const EULA = [
  ['1. Общие положения', 'Настоящее соглашение заключается между вами («Внук») и правообладателем игры «Бабка: Кооп» («Бабка и Внуки»). Устанавливая игру, вы подтверждаете, что прочитали и принимаете эти условия.'],
  ['2. Лицензия', 'Вам предоставляется бесплатная, неисключительная лицензия на установку игры на любое количество ваших компьютеров и совместную игру с друзьями по локальной сети или через VPN. Игру можно свободно передавать друзьям в неизменном виде.'],
  ['3. Сеть и данные', 'Игра не собирает и не отправляет никаких данных в интернет. Сервер игры работает на вашем компьютере; к нему подключаются только те, кому вы дали адрес. Ник, настройки и сохранения хранятся локально.'],
  ['4. Брандмауэр', 'Если вы разрешите, мастер добавит правило брандмауэра Windows для входящих TCP-подключений на выбранный порт. Правило удаляется вместе с игрой.'],
  ['5. Сторонние компоненты', 'Игра использует Node.js (лицензия MIT), библиотеку three.js (MIT), модели персонажей на основе MakeHuman (CC0) и образцы моделей Khronos glTF (CC0 / CC-BY 4.0, авторы указаны в models/props/CREDITS.txt).'],
  ['6. Предупреждение о содержании', 'Игра содержит резкие звуки, темноту и пожилую женщину с битой. Не рекомендуется людям, которые боятся скрипа половиц. Если вам стало страшно — это нормально, так задумано.'],
  ['7. Ограничение ответственности', 'Игра предоставляется «как есть». Правообладатель не несёт ответственности за крики, разбуженных соседей, пролитый чай и испорченную репутацию в глазах друга, которого вы бросили в подвале.'],
  ['8. Бабушки', 'Лицензия не распространяется на настоящих бабушек. Им нужно звонить. Желательно почаще.'],
  ['9. Удаление', 'Игру можно удалить через «Параметры → Приложения», ярлык «Удалить» в меню «Пуск» или файл UNINSTALL.bat в папке игры. Бабка будет против, но помешать не сможет.'],
];
$('#eula').innerHTML = EULA.map(([h, p]) => `<h4>${h}</h4><p>${p}</p>`).join('');
$('#eula').addEventListener('scroll', () => {
  const e = $('#eula');
  if (e.scrollTop + e.clientHeight >= e.scrollHeight - 8 && !state.eulaRead) {
    state.eulaRead = true;
    $('#eulaOk').disabled = false;
    $('#eulaLabel').classList.remove('disabled');
  }
});
enter.license = () => {
  const e = $('#eula');
  if (e.scrollHeight <= e.clientHeight + 8) { state.eulaRead = true; $('#eulaOk').disabled = false; }
  $('#eulaLabel').classList.toggle('disabled', !state.eulaRead);
};
$('#eulaOk').onchange = () => { Sfx.click(); nav(); };
$('#eulaLabel').onclick = (e) => {
  if (!state.eulaRead && e.target.id !== 'eulaOk') { e.preventDefault(); $('#eula').animate([{ borderColor: '#e0513f' }, { borderColor: '#2c2523' }], 700); }
};

// ---------- 3. параметры ----------
function renderToggles() {
  $('#toggles').innerHTML = COMPS.map(([k, t, d, admin]) =>
    `<div class="tg ${state.comps[k] ? 'on' : ''}" data-k="${k}"><div class="txt"><b>${t}${admin ? '<i class="shield" title="Нужны права администратора"></i>' : ''}</b><span>${d}</span></div><div class="sw"></div></div>`).join('');
  $$('.tg').forEach(el => el.onclick = () => { Sfx.click(); state.comps[el.dataset.k] = !state.comps[el.dataset.k]; el.classList.toggle('on'); });
}
function setDiff(v) {
  state.difficulty = v;
  $$('#diffSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $('#diffHint').textContent = DIFF_HINT[v];
}
$$('#diffSeg button').forEach(b => b.onclick = () => { Sfx.click(); setDiff(b.dataset.v); });

let dirTimer = 0;
async function checkDir() {
  const v = $('#dirInput').value.trim();
  let err = '';
  if (!v) err = 'Укажите папку.';
  else {
    try {
      const r = await api('/api/check-dir', { dir: v });
      if (!r.absolute) err = 'Нужен полный путь, например C:\\Games\\BabkaCoop';
      $('#freeSpace').textContent = r.free != null ? `Свободно: ${mb(r.free)}` : '';
      if (r.free != null && state.info && r.free < state.info.sizeBytes * 1.1) err = 'Недостаточно места на диске.';
    } catch (e) { err = e.message; }
  }
  $('#dirErr').textContent = err;
  nav();
}
$('#dirInput').addEventListener('input', () => { clearTimeout(dirTimer); dirTimer = setTimeout(checkDir, 250); });
$('#browseBtn').onclick = async () => {
  Sfx.click();
  const b = $('#browseBtn');
  b.disabled = true;
  try {
    const r = await api('/api/browse', { dir: $('#dirInput').value });
    if (r.dir) { $('#dirInput').value = r.dir; checkDir(); }
    else if (!state.info?.isWin || state.info?.dry) await modal('Выбор папки', 'Диалог выбора папки доступен только в Windows. Впишите путь вручную.', ['Понятно']);
  } catch (e) { await modal('Выбор папки', e.message, ['Ок']); }
  b.disabled = false;
};
function saveOptions() {
  state.dir = $('#dirInput').value.trim();
  state.port = Math.min(65535, Math.max(1024, Number($('#portInput').value) || 7777));
  state.name = $('#nameInput').value.trim().slice(0, 16);
}
enter.options = () => { if (!$('#dirInput').value) $('#dirInput').value = state.dir; checkDir(); };

// ---------- 4. установка ----------
const SLIDES = [
  ['shot-1.jpg', '<b>Три этажа.</b> Подвал, жилой этаж и второй этаж со спальнями — всё соединено лестницами.'],
  ['shot-2.jpg', '<b>Прячьтесь.</b> Под кроватью, в шкафу, в ванне и даже под столом.'],
  ['shot-3.jpg', '<b>Она слышит.</b> Бег и упавшие вещи слышно даже через перекрытия.'],
  ['shot-4.jpg', '<b>Три выхода.</b> Дверь с тремя замками, старая машина в гараже или решётка канализации.'],
  ['shot-5.jpg', '<b>Вдвоём проще.</b> Один отвлекает, второй ищет ключи. Метка Z показывает другу, куда смотреть.'],
  ['shot-6.jpg', '<b>Перцовый баллончик</b> остановит бабку на несколько секунд. Зарядов всего три.'],
];
let slideTimer = 0;
function startSlides() {
  const box = $('#slides');
  if (!box.querySelector('img')) for (const [src] of SLIDES) { const im = new Image(); im.src = 'img/' + src; im.onerror = () => im.remove(); box.appendChild(im); }
  let k = 0;
  const step = () => {
    const imgs = [...box.querySelectorAll('img')];
    if (!imgs.length) { box.hidden = true; return; }
    imgs.forEach((im, i) => im.classList.toggle('on', i === k % imgs.length));
    const idx = SLIDES.findIndex(s => imgs[k % imgs.length].src.endsWith(s[0]));
    $('#slideCap').innerHTML = SLIDES[idx]?.[1] || '';
    k++;
  };
  step();
  slideTimer = setInterval(step, 5200);
}
function logLine(text, cls = '') {
  const el = document.createElement('div');
  el.className = cls; el.textContent = text;
  $('#log').appendChild(el); $('#log').scrollTop = 1e9;
}
$('#logToggle').onclick = () => { const l = $('#log'); l.hidden = !l.hidden; $('#logToggle').textContent = l.hidden ? 'Подробнее' : 'Скрыть'; };
function setProgress(p) {
  const v = Math.max(0, Math.min(100, p));
  $('#fill').style.width = v + '%';
  $('#pct').textContent = Math.floor(v) + '%';
  document.title = v < 100 ? `${Math.floor(v)}% — установка «Бабка: Кооп»` : 'Установка «Бабка: Кооп»';
}

enter.install = async () => {
  if (state.installing || state.installed) return;
  state.installing = true;
  $('#instErr').hidden = true; $('#log').innerHTML = ''; setProgress(0);
  $('#instTitle').textContent = 'Установка…';
  nav();
  startSlides();
  const t0 = Date.now();
  const tick = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); $('#elapsed').textContent = `Прошло ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 500);
  try {
    await api('/api/install', {
      dir: state.dir, port: state.port, playerName: state.name, difficulty: state.difficulty, ...state.comps,
    });
  } catch (e) { clearInterval(tick); return failed(e.message); }
  let seen = 0, last = [], st, shown = 0;
  const TAG = { ok: 'готово', skip: 'пропущено', warn: 'внимание', fail: 'ошибка' };
  for (;;) {
    try { st = await api('/api/status'); } catch (e) { clearInterval(tick); return failed('Установщик перестал отвечать: ' + e.message); }
    st.steps.forEach((s, i) => {
      if (i >= seen) { seen = i + 1; $('#action').textContent = s.label; logLine('› ' + s.label); }
      if (s.state !== 'run' && last[i] !== s.state) logLine(`  ${TAG[s.state]}${s.msg ? ': ' + s.msg : ''}`, s.state === 'fail' ? 'error' : s.state);
      last[i] = s.state;
    });
    shown += (st.progress * 100 - shown) * 0.3;
    setProgress(st.done ? 100 : shown);
    if (st.done) break;
    await sleep(200);
  }
  clearInterval(tick);
  state.installing = false;
  if (st.error) return failed(st.error);
  state.result = st;
  state.installed = true;
  $('#instTitle').textContent = 'Установка завершена';
  $('#action').textContent = 'Все файлы на месте.';
  Sfx.done();
  nav();
  await sleep(900);
  if (PAGES[state.page] === 'install') show(4);
};
async function failed(msg) {
  state.installing = false;
  Sfx.error();
  $('#instTitle').textContent = 'Установка не удалась';
  $('#action').textContent = 'Установка прервана';
  $('#instErr').hidden = false;
  $('#instErr').innerHTML = `<b>Ошибка:</b> ${esc(msg)}<br><button class="btn ghost" id="retry" style="margin-top:10px">Изменить параметры</button>`;
  $('#retry').onclick = () => show(2);
  logLine('Ошибка: ' + msg, 'error');
  nav();
}

// ---------- 5. готово ----------
enter.finish = () => {
  clearInterval(slideTimer);
  const st = state.result;
  const warns = (st?.steps || []).filter(s => s.state === 'warn');
  const w = $('#finWarn');
  w.hidden = !warns.length;
  w.innerHTML = warns.map(s => `<b>${esc(s.label)}</b><br>${esc(s.msg)}`).join('<br><br>');
  const ip = state.info?.radmin?.ips?.[0];
  $('#addrHint').textContent = `http://${ip || '26.x.x.x'}:${state.port}`;
  $('#finText').textContent = `Игра установлена в ${state.dir}. ${state.comps.desktop ? 'Ярлык «Бабка Кооп» — на рабочем столе.' : 'Запускайте BabkaCoop.exe из папки игры.'}`;
};
$$('[data-open]').forEach(a => a.onclick = (e) => { e.preventDefault(); api('/api/open', { what: a.dataset.open }).catch(() => {}); });
$('#finCall').onchange = (e) => { if (e.target.checked) modal('Хорошая идея', 'Мастер установки звонить не умеет, но вы — умеете.\nОна будет рада. ❤', ['Позвоню']); };

async function finish() {
  $('#next').disabled = true;
  if ($('#finFolder').checked) api('/api/open', { what: 'folder' }).catch(() => {});
  if ($('#finLaunch').checked) {
    try { await api('/api/launch', { dir: state.dir }); } catch (e) { await modal('Запуск игры', `Не удалось запустить игру: ${e.message}`, ['Ок']); }
  }
  bye('Готово. Приятной игры — и не шумите.');
}
function bye(text) {
  api('/api/quit', {}).catch(() => {});
  $('#byeText').textContent = text;
  $('#bye').hidden = false;
  setTimeout(() => window.close(), 900);
}

// ---------- отмена ----------
async function cancelFlow() {
  if (state.installing) return;
  if (PAGES[state.page] === 'finish') return finish();
  const r = await modal('Прервать установку?', 'Игра не будет установлена. Мастер можно запустить снова в любой момент.', ['Прервать', 'Продолжить установку']);
  if (r === 0) bye('Установка отменена.');
}

// ---------- диалог ----------
function modal(title, text, buttons = ['Ок']) {
  return new Promise((resolve) => {
    $('#mTitle').textContent = title;
    $('#mText').textContent = text;
    const box = $('#mBtns'); box.innerHTML = '';
    buttons.forEach((b, i) => {
      const el = document.createElement('button');
      el.className = 'btn' + (i > 0 ? ' ghost' : '');
      el.textContent = b;
      el.onclick = () => { $('#modalBack').hidden = true; resolve(i); };
      box.appendChild(el);
    });
    $('#modalBack').hidden = false;
    box.firstChild.focus();
  });
}

// ---------- старт ----------
(async () => {
  renderToggles();
  setDiff('normal');
  show(0);
  try {
    const i = state.info = await api('/api/info');
    $('#ver').textContent = `Версия ${i.version} · ${mb(i.sizeBytes)}`;
    state.dir = i.defaultDir;
    $('#dirInput').value = i.defaultDir;
    $('#needSpace').textContent = `Требуется: ${mb(i.sizeBytes)}`;
    if (i.existing) {
      $('#portInput').value = i.existing.port || 7777;
      $('#nameInput').value = i.existing.playerName || '';
      if (DIFF_HINT[i.existing.difficulty]) setDiff(i.existing.difficulty);
    }
    if (!i.isWin) { state.comps.firewall = false; renderToggles(); }
    renderSysinfo();
  } catch (e) {
    await modal('Ошибка', 'Не удалось связаться с установщиком: ' + e.message, ['Закрыть']);
  }
})();
