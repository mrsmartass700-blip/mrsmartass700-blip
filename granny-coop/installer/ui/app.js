// «Бабка Setup Wizard 98» — логика мастера установки.
import { drawGranny } from './art.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const TOKEN = new URLSearchParams(location.search).get('t') || '';
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

// ================= звук (всё синтезировано) =================
const Sfx = {
  ctx: null, on: true, musicOn: true, musicTimer: null, step: 0,
  init() {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    this.master = this.ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ctx.destination);
    this.startMusic();
  },
  tone(f, dur = 0.1, type = 'square', vol = 0.15, when = 0, slide = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur = 0.3, vol = 0.4) {
    if (!this.ctx) return;
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain(); g.gain.value = vol;
    s.buffer = b; s.connect(g).connect(this.master); s.start();
  },
  click() { this.tone(1200, 0.03, 'square', 0.05); },
  error() { this.tone(660, 0.12, 'square', 0.12); this.tone(440, 0.2, 'square', 0.12, 0.13); },
  tada() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 'square', 0.1, i * 0.1)); },
  scare() { this.noise(0.7, 0.6); this.tone(90, 0.8, 'sawtooth', 0.35, 0, 40); this.tone(700, 0.4, 'sawtooth', 0.12, 0, 200); },
  hmm() { this.tone(210, 0.35, 'sawtooth', 0.08, 0, 150); },
  // зловещая колыбельная (оригинальная мелодия, ля минор, «музыкальная шкатулка»)
  startMusic() {
    const mel = [69, 72, 76, 72, 74, 71, 67, 71, 69, 72, 76, 81, 80, 76, 71, 0, 69, 72, 76, 72, 74, 71, 67, 64, 65, 69, 72, 71, 68, 64, 69, 0];
    const bass = [45, 45, 43, 43, 41, 41, 40, 40];
    const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
    clearInterval(this.musicTimer);
    this.musicTimer = setInterval(() => {
      if (!this.musicOn || !this.ctx || document.hidden) return;
      const n = mel[this.step % mel.length];
      if (n) { this.tone(hz(n + 12), 0.5, 'triangle', 0.045); this.tone(hz(n + 24), 0.25, 'sine', 0.015); }
      if (this.step % 4 === 0) this.tone(hz(bass[(this.step / 4) % bass.length]), 1.3, 'sine', 0.05);
      this.step++;
    }, 330);
  },
};
addEventListener('pointerdown', () => { Sfx.init(); Sfx.ctx?.resume?.(); }, { capture: true });
addEventListener('keydown', () => { Sfx.init(); }, { capture: true });
$('#musicBtn').onclick = () => { Sfx.musicOn = !Sfx.musicOn; $('#musicBtn').textContent = Sfx.musicOn ? '🔊' : '🔇'; };
document.addEventListener('click', (e) => { if (e.target.closest('button, .btn, input[type=checkbox], input[type=radio]')) Sfx.click(); });

// ================= бабка-комментатор =================
const LINES = {
  welcome: ['Проходи, внучок. Разувайся.', 'Ты поел? Потом установишь.', 'Опять за компьютером сидишь…'],
  license: ['Читай внимательно. Я проверю.', 'Там мелким шрифтом самое интересное.', 'Не принимаешь? Ну-ну.'],
  check: ['Сейчас посмотрим, что у тебя за компьютер…', 'Пыльно у тебя в системном блоке.', 'Ого, сколько ядер. Мне бы столько.'],
  components: ['Меня убрать нельзя. Даже не пытайся.', 'Дед за хлебом ушёл. Давно.', 'Пирожки не снимай, обижусь.'],
  location: ['Куда меня поселишь? Только не в «Загрузки».', 'Порт 7777 — счастливый.', 'Как тебя звать-то, внучок?'],
  fear: ['Выбирай, насколько мне быть злой.', 'Кошмар выбирать не советую. Хотя…', 'На лёгкой я в тапочках.'],
  summary: ['Ну что, заселяюсь?', 'Проверь всё. Потом не жалуйся.', 'Жми «Установить», не бойся.'],
  install: ['Не мешай, я раскладываю вещи.', 'Тише! Кажется, скрипнула половица…', 'Куда я дела ключи…'],
  finish: ['Всё. Теперь я живу тут.', 'Друга позови. Вдвоём веселее. Мне.', 'Приходи в гости. Дверь не заперта. Шучу.'],
  idle: ['Где мои очки?', 'Не бегай по дому!', 'Кто трогал мой молоток?', 'Я всё слышу.', 'Бу.', 'Внучок, надень шапку.', 'Radmin VPN — это что, новая соседка?'],
};
const MOOD = { welcome: 'calm', license: 'calm', check: 'calm', components: 'angry', location: 'calm', fear: 'calm', summary: 'happy', install: 'angry', finish: 'happy' };
let bubbleTimer = 0;
function say(text, mood) {
  const b = $('#bubble');
  b.textContent = text;
  b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
  if (mood) drawGranny($('#sideGranny'), mood, 8);
  clearTimeout(bubbleTimer);
  if (mood) bubbleTimer = setTimeout(() => drawGranny($('#sideGranny'), MOOD[currentPage()] || 'calm', 8), 2500);
}
$('#sideGranny').onclick = () => { say(pick(LINES.idle), pick(['angry', 'crazy', 'happy'])); Sfx.hmm(); };

// ================= данные =================
let info = null;
const state = {
  dir: '', port: 7777, playerName: '', difficulty: 'normal', eula: false,
  comps: {}, installed: false, installResult: null,
};

const COMPONENTS = [
  { id: 'granny', label: 'Бабка', sz: '0.9 МБ', locked: true, on: true, desc: 'Обязательный компонент. Без бабки никак. Попытка снять галочку будет записана в её тетрадку.' },
  { id: 'house', label: 'Дом (9 комнат, 12 дверей)', sz: '0.3 МБ', locked: true, on: true, desc: 'Бабке нужно где-то жить. Включает кухню, кладовку, кабинет и одну очень подозрительную ванную.' },
  { id: 'coop', label: 'Кооп-мультиплеер (LAN / Radmin VPN)', sz: '12 КБ', locked: true, on: true, desc: 'Вы и друг против бабки. Один запускает сервер, второй просто открывает ссылку в браузере.' },
  { id: 'creaky', label: 'Скрипучие половицы (18 шт.)', sz: '18 скрипов', fake: 'stubborn', on: true, desc: 'Половицы скрипят, бабка слышит. Галочку снять можно, но половицы всё равно будут скрипеть.' },
  { id: 'traps', label: 'Капканы', sz: '3 шт.', fake: 'stubborn', on: true, desc: 'Бабка расставляет их сама. Отключить нельзя: она их прячет.' },
  { id: 'desktop', label: 'Ярлык на рабочем столе', sz: '1 КБ', real: true, on: true, desc: 'Ярлык «Бабка Кооп» с пиксельной бабкой на иконке. Смотрит на вас с рабочего стола. Всегда.' },
  { id: 'startMenu', label: 'Папка в меню «Пуск»', sz: '3 КБ', real: true, on: true, desc: 'Запуск игры, открытие порта и удаление бабки — всё в одном месте.' },
  { id: 'firewall', label: 'Открыть порт для друга (брандмауэр)', sz: '0 КБ', real: true, on: true, desc: 'Добавит правило входящих подключений в брандмауэр Windows, чтобы друг по Radmin VPN смог зайти. Windows спросит права администратора.' },
  { id: 'register', label: 'Добавить в «Программы и компоненты»', sz: '1 КБ', real: true, on: true, desc: 'Чтобы бабку можно было найти в «Параметры → Приложения». И удалить. Но зачем?' },
  { id: 'pies', label: 'Пирожки с капустой', sz: '4 шт.', fake: 'free', on: true, desc: 'Только для хоста. Гостю передаются по Radmin VPN (задержка ~2 мс, пирожки не остывают).' },
  { id: 'slipper', label: 'Тапок бабки в 4K', sz: '+2 ТБ', fake: 'slipper', on: false, desc: 'Ультрареалистичный тапок в разрешении 3840×2160. Каждая ворсинка. Каждая дырочка.' },
  { id: 'grandpa', label: 'Дедушка', sz: '—', disabled: true, on: false, desc: 'Не входит в поставку. Ушёл за хлебом в 2003 году. Ждём.' },
  { id: 'sanity', label: 'Здравый смысл', sz: '—', disabled: true, on: false, desc: 'Недоступно в вашем регионе.' },
];
for (const c of COMPONENTS) state.comps[c.id] = c.on;

const FEAR = [
  { key: 'practice', name: 'Бабка спит (практика)', mood: 'sleep', desc: 'Бабки нет дома. Можно спокойно изучить дом, найти все предметы и понять, где что. Для трусишек и разведчиков.' },
  { key: 'easy', name: 'Бабка в тапочках', mood: 'happy', desc: 'Медленная, глуховатая, быстро теряет вас из виду. Ставит 1 капкан. Подходит, чтобы научить друга.' },
  { key: 'normal', name: 'Бабка с битой', mood: 'calm', desc: 'Классика. Слышит бег и скрип половиц, открывает двери, ищет в последнем месте, где видела. 5 дней на побег.' },
  { key: 'hard', name: 'Бабка без очков, но слышит всё', mood: 'angry', desc: 'Быстрее, дальше видит, дольше помнит. Капканов больше. Баллончик действует меньше.' },
  { key: 'nightmare', name: 'Бабка, которая не спала 5 дней', mood: 'crazy', desc: 'Свет в доме не горит. Она почти так же быстра, как вы бегом. Слышит, как вы думаете. Удачи.' },
];

// ================= страницы =================
const PAGES = ['welcome', 'license', 'check', 'components', 'location', 'fear', 'summary', 'install', 'finish'];
const TITLES = ['Приветствие', 'Соглашение', 'Проверка', 'Компоненты', 'Папка', 'Уровень страха', 'Готово к установке', 'Установка', 'Завершение'];
let pageIdx = 0;
const currentPage = () => PAGES[pageIdx];

$('#stepList').innerHTML = TITLES.map(t => `<li>${t}</li>`).join('');

function showPage(i) {
  pageIdx = i;
  const name = PAGES[i];
  if (name !== 'fear') $('#win').classList.remove('shake');
  $$('.page').forEach(p => p.classList.toggle('show', p.dataset.page === name));
  $$('#stepList li').forEach((li, k) => { li.className = k < i ? 'done' : k === i ? 'cur' : ''; });
  say(pick(LINES[name]));
  drawGranny($('#sideGranny'), MOOD[name], 8);
  enter[name]?.();
  updateNav();
}

function updateNav() {
  const name = currentPage();
  const back = $('#back'), next = $('#next'), cancel = $('#cancel');
  back.disabled = pageIdx === 0 || name === 'install' || name === 'finish';
  next.textContent = name === 'summary' ? 'Установить' : name === 'finish' ? 'Готово' : 'Далее >';
  next.disabled = (name === 'license' && !state.eula) || name === 'install' || (name === 'check' && !checksDone);
  cancel.disabled = name === 'finish';
}

$('#back').onclick = () => { if (pageIdx > 0) showPage(pageIdx - 1); };
$('#next').onclick = async () => {
  const name = currentPage();
  if (leave[name] && !(await leave[name]())) return;
  if (name === 'finish') return finish();
  showPage(pageIdx + 1);
};
$('#cancel').onclick = () => cancelFlow();
$('#bClose').onclick = () => cancelFlow();
$('#bMin').onclick = () => { $('#win').classList.add('min'); $('#taskBtn').classList.remove('active'); };
$('#taskBtn').onclick = () => { $('#win').classList.toggle('min'); $('#taskBtn').classList.toggle('active', !$('#win').classList.contains('min')); };
$('#bMax').onclick = () => $('#win').classList.toggle('max');
$('#titlebar').ondblclick = () => $('#win').classList.toggle('max');

const enter = {}, leave = {};

// ---------- приветствие ----------
enter.welcome = () => {
  const ex = info?.existing;
  const box = $('#existingBox');
  box.hidden = !ex;
  if (ex) box.innerHTML = `🏠 Бабка уже живёт у вас (версия ${esc(ex.version || '?')}, заселилась ${esc(new Date(ex.installedAt).toLocaleDateString('ru-RU'))}). Установка обновит её, а настройки можно поменять.`;
};

// ---------- лицензия ----------
function eulaText() {
  const u = info?.user || 'внучок', c = info?.cpus || '?';
  return `ЛИЦЕНЗИОННОЕ СОГЛАШЕНИЕ С БАБКОЙ
(ЕУЛА — «Единое Ультимативное Лицензионное соглашение с бАбкой»)

Настоящее соглашение заключается между Бабкой (далее — «Бабка»)
и вами, ${u} (далее — «Внучок»).

1. ПРЕДМЕТ СОГЛАШЕНИЯ
1.1. Бабка предоставляет Внучку неисключительное право бегать по её
     дому, прятаться в её шкафах и трогать её вещи. Последнее — зря.
1.2. Внучок вправе привести друга. Бабка вправе поймать обоих.

2. ПРАВИЛА ДОМА
2.1. Не шуметь после 22:00. И до 22:00 тоже.
2.2. Бегать по дому запрещено. Бабка слышит бег за 9 метров.
2.3. Скрипучие половицы скрипят. Это не баг, это половицы.
2.4. Прятаться под кроватью разрешено. Бабка всё равно знает,
     если видела, как вы туда лезли.

3. ИМУЩЕСТВО
3.1. Все ключи, молотки и кусачки являются собственностью Бабки.
     Внучок берёт их на время и возвращает в виде открытой двери.
3.2. Бутылки, брошенные для отвлечения внимания, Бабка запишет
     в тетрадку. Тетрадка большая.

4. МУЛЬТИПЛЕЕР
4.1. Играя вдвоём, Внучки соглашаются делить Бабку поровну.
4.2. Кто первым пойман — тот и виноват. Это правило не обсуждается.
4.3. Radmin VPN: Бабка тоже в вашей локальной сети. Всегда была.
4.4. Крики «ОНА ЗА ТОБОЙ!!!» в три часа ночи соседям не компенсируются.

5. ЗАПРЕЩАЕТСЯ
5.1. Декомпилировать Бабку, реверсить пирожки, подменять тапки.
5.2. Использовать перцовый баллончик на Бабке без крайней нужды.
     (Крайняя нужда наступает примерно каждые 40 секунд.)

6. ПЕРСОНАЛЬНЫЕ ДАННЫЕ
6.1. Установщик узнал ваше имя пользователя (${u}) и количество
     ядер процессора (${c}). Бабка будет этим гордиться перед
     соседками.
6.2. Никакие данные никуда не отправляются. Бабка не умеет
     пользоваться интернетом. Она его боится.

7. ГАРАНТИИ
7.1. Игра предоставляется «КАК ЕСТЬ», как и бабкин борщ.
7.2. Отказ от борща не принимается.

8. СРОК ДЕЙСТВИЯ
8.1. Бессрочно. Или 5 игровых дней. Смотря как играть.

9. ЗАКЛЮЧИТЕЛЬНЫЕ ПОЛОЖЕНИЯ
9.1. Прокрутив соглашение до конца, вы подтверждаете,
     что умеете прокручивать.
9.2. Поздравляем, вы умеете прокручивать.

               Подпись: ________ Бабка   (отпечаток тапка: 👣)
`;
}
enter.license = () => {
  const e = $('#eula');
  if (!e.textContent) e.textContent = eulaText();
};
$('#eula').addEventListener('scroll', (ev) => {
  const e = ev.target;
  if (e.scrollTop + e.clientHeight >= e.scrollHeight - 8 && $('#eulaYes').disabled) {
    $('#eulaYes').disabled = false;
    $('#eulaHint').textContent = '(молодец, дочитал)';
    say('Дочитал? Я впечатлена.', 'happy');
  }
});
$('#eulaYes').onchange = () => { state.eula = true; updateNav(); };
// «Не принимаю» убегает от курсора
let runCount = 0;
const runaway = $('#eulaNoWrap');
runaway.addEventListener('mouseenter', () => {
  runCount++;
  const box = $('#eulaRadios').getBoundingClientRect();
  const maxX = Math.max(0, box.width - runaway.offsetWidth - 10);
  runaway.style.left = `${Math.random() * maxX}px`;
  runaway.style.top = `${(Math.random() - 0.5) * 30}px`;
  if (runCount === 3) say('Не получится. Я держу эту кнопку.', 'angry');
  if (runCount === 8) say('Ты упорный. Весь в деда.', 'crazy');
});
$('#eulaNo').onchange = () => {
  $('#eulaNo').checked = false;
  modal('Бабка', 'Вы не приняли соглашение.\nБабка приняла его за вас.\n\nСпасибо за понимание.', ['Ладно'], '👵');
  if (!$('#eulaYes').disabled) { $('#eulaYes').checked = true; state.eula = true; updateNav(); }
};

// ---------- проверка системы ----------
let checksDone = false, checksRunning = false;
enter.check = async () => {
  if (checksDone || checksRunning || !info) return;
  checksRunning = true;
  const r = info.radmin;
  const list = [
    ['💻', 'Операционная система', info.isWin ? `${info.os} — бабка довольна` : `${info.os} (${info.platform}) — бабка в замешательстве, но попробует`, info.isWin ? 'ok' : 'warn'],
    ['🧠', 'Оперативная память', `${info.ramGB} ГБ — ${info.ramGB >= 8 ? 'бабке хватит, ещё и на пирожки останется' : 'тесновато, но бабка компактная'}`, 'ok'],
    ['⚙️', 'Процессор', `${info.cpus} ядер${info.cpuModel ? ` (${info.cpuModel})` : ''} — бабка будет бегать на всех`, 'ok'],
    ['🟩', 'Node.js', `${info.node} — двигатель бабки на месте`, 'ok'],
    ['🔌', 'Radmin VPN', r.installed ? (r.ips.length ? `найден, ваш адрес ${r.ips.join(', ')} — друг сможет зайти` : 'установлен, но сеть не подключена — зайдите в сеть перед игрой') : 'не найден — для игры с другом через интернет его нужно поставить (см. ниже)', r.installed ? (r.ips.length ? 'ok' : 'warn') : 'warn'],
    ['👤', 'Пользователь', `${info.user} — бабка запомнила`, 'ok'],
    ['🛏️', 'Наличие подкроватного пространства', 'обнаружено (2 кровати)', 'ok'],
    ['🪵', 'Скрипучесть половиц', '100% — отлично', 'ok'],
    ['🦵', 'Смелость пользователя', 'не обнаружена — установка продолжится на ваш страх и риск', 'warn'],
    ['🥧', 'Пирожки', 'в духовке, будут через 5 минут', 'ok'],
  ];
  const ul = $('#checks');
  ul.innerHTML = '';
  for (const [ic, k, v, st] of list) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="ic"><span class="spin">◌</span></span><span class="k">${ic} ${esc(k)}</span><span class="v">проверяем…</span>`;
    ul.appendChild(li);
    await sleep(260 + Math.random() * 420);
    li.querySelector('.ic').textContent = st === 'ok' ? '✅' : '⚠️';
    li.querySelector('.v').textContent = v;
    if (currentPage() !== 'check') { /* продолжаем в фоне */ }
  }
  const rb = $('#radminBox');
  if (!r.installed || !r.ips.length) {
    rb.hidden = false;
    rb.className = 'box warn';
    rb.innerHTML = `<b>Про Radmin VPN.</b> Чтобы играть с другом через интернет, вам обоим нужен Radmin VPN (бесплатный): один создаёт сеть, второй в неё входит.
      Играть в одной домашней сети можно и без него. <br><button class="btn" id="getRadmin" style="margin-top:6px">Скачать Radmin VPN</button>`;
    $('#getRadmin').onclick = () => api('/api/open', { what: 'radmin' });
  }
  checksDone = true; checksRunning = false;
  say(r.installed ? 'Годится. Заселяюсь.' : 'Radmin поставь, а то друга не позовёшь.', 'happy');
  updateNav();
};

// ---------- компоненты ----------
function sizeText() {
  let mb = (info?.sizeBytes || 0) / 1048576;
  const parts = [`${mb.toFixed(1)} МБ`];
  if (state.comps.slipper) parts.push(state.slipperCompressed ? '16 байт тапка' : '2 ТБ тапка');
  if (state.comps.pies) parts.push('4 пирожка');
  return parts.join(' + ');
}
function renderComps() {
  const ul = $('#compList');
  ul.innerHTML = COMPONENTS.map(c => `<li data-id="${c.id}" class="${c.disabled ? 'dis' : ''}">
    <input type="checkbox" ${state.comps[c.id] ? 'checked' : ''} ${c.disabled ? 'disabled' : ''} />
    <span>${esc(c.id === 'slipper' && state.slipperCompressed ? 'Тапок бабки (сжат до 16×16)' : c.label)}${c.locked ? ' 🔒' : ''}</span><span class="sz">${esc(c.sz)}</span></li>`).join('');
  $('#spaceNeed').textContent = sizeText();
}
$('#compList').addEventListener('mouseover', (e) => {
  const li = e.target.closest('li'); if (!li) return;
  const c = COMPONENTS.find(x => x.id === li.dataset.id);
  $('#compDesc').textContent = c.desc;
});
$('#compList').addEventListener('click', async (e) => {
  const li = e.target.closest('li'); if (!li) return;
  const c = COMPONENTS.find(x => x.id === li.dataset.id);
  e.preventDefault();
  if (c.disabled) { say(c.id === 'grandpa' ? 'Дед вернётся. Когда-нибудь.' : 'Не положено.', 'calm'); return; }
  if (c.locked) {
    li.classList.remove('shake'); void li.offsetWidth; li.classList.add('shake');
    const nope = $('#sideGranny'); nope.classList.remove('nope'); void nope.offsetWidth; nope.classList.add('nope');
    say(pick(['Нельзя!', 'Я сказала — нельзя.', 'Руки убрал от галочки.', 'Записала в тетрадку.']), 'angry');
    Sfx.error();
    return;
  }
  state.comps[c.id] = !state.comps[c.id];
  renderComps();
  if (c.fake === 'stubborn' && !state.comps[c.id]) {
    say(c.id === 'creaky' ? 'Скрип-скрип. Всё равно скрипят.' : 'Капканы я сама поставлю.', 'crazy');
    await sleep(900);
    state.comps[c.id] = true; renderComps();
  }
  if (c.fake === 'slipper' && state.comps.slipper && !state.slipperCompressed) {
    Sfx.error();
    await modal('Недостаточно места', `Для установки тапка в 4K требуется 2 ТБ.\nНа вашем диске столько нет (бабка проверила).\n\nТапок будет сжат до 16×16 пикселей.`, ['Сжать тапок'], '🥿');
    state.slipperCompressed = true; renderComps();
    say('Хороший тапок. Маленький, но злой.', 'happy');
  }
  if (c.id === 'pies' && !state.comps.pies) say('Не хочешь пирожков?! Ну и ладно. Сама съем.', 'angry');
  if (c.id === 'firewall' && !state.comps.firewall) say('Тогда друг не зайдёт. Или запусти потом firewall.bat.', 'calm');
});
enter.components = () => renderComps();

// ---------- папка ----------
enter.location = () => {
  if (!state.dir) state.dir = info?.defaultDir || '';
  if (!state.playerName) state.playerName = (info?.user || 'Внучок').slice(0, 16);
  $('#dirInput').value = state.dir;
  $('#portInput').value = state.port;
  $('#nameInput').value = state.playerName;
  checkDir();
  updateAddr();
};
function updateAddr() {
  const ip = info?.radmin?.ips?.[0] || '26.x.x.x';
  $('#addrPreview').textContent = `http://${ip}:${$('#portInput').value || 7777}`;
}
let dirTimer = 0;
async function checkDir() {
  const v = $('#dirInput').value.trim();
  state.dir = v;
  const note = $('#dirNote');
  note.className = 'note';
  if (!v) { note.textContent = 'Укажите папку.'; note.className = 'note bad'; return false; }
  if (/downloads|загрузки/i.test(v)) say('Ну я же просила не в «Загрузки»! Ладно…', 'angry');
  if (/desktop|рабочий стол/i.test(v)) say('На рабочий стол? Там и так бардак.', 'angry');
  try {
    const r = await api('/api/check-dir', { dir: v });
    if (!r.absolute) { note.textContent = 'Нужен полный путь, например C:\\Games\\BabkaCoop'; note.className = 'note bad'; return false; }
    note.textContent = r.existing ? `Здесь уже живёт бабка v${r.existing.version} — она будет обновлена.` : r.exists ? 'Папка существует — файлы игры будут добавлены в неё.' : 'Папка будет создана.';
    return true;
  } catch { return true; }
}
$('#dirInput').addEventListener('input', () => { clearTimeout(dirTimer); dirTimer = setTimeout(checkDir, 300); });
$('#portInput').addEventListener('input', updateAddr);
$('#browseBtn').onclick = async () => {
  if (!info?.isWin || info?.dry) { modal('Обзор', 'Окно выбора папки работает только в Windows.\nВпишите путь вручную — бабка подождёт.', ['Хорошо'], '📁'); return; }
  $('#browseBtn').disabled = true;
  say('Выбирай. Только не в «Загрузки».', 'calm');
  try {
    const r = await api('/api/browse', { dir: $('#dirInput').value });
    if (r.dir) { $('#dirInput').value = r.dir; checkDir(); }
  } catch (e) { modal('Ошибка', e.message, ['Ок'], '❌'); }
  $('#browseBtn').disabled = false;
};
leave.location = async () => {
  const ok = await checkDir();
  const port = Number($('#portInput').value);
  if (!ok) { Sfx.error(); say('Путь неправильный. Проверь.', 'angry'); return false; }
  if (!(port >= 1024 && port <= 65535)) { Sfx.error(); modal('Порт', 'Порт должен быть числом от 1024 до 65535.\nЕсли не знаете, что это — оставьте 7777.', ['Понятно'], '🔢'); return false; }
  state.port = port;
  state.playerName = $('#nameInput').value.trim().slice(0, 16) || 'Внучок';
  return true;
};

// ---------- страх ----------
function renderFear() {
  const v = Number($('#fearRange').value);
  const f = FEAR[v];
  state.difficulty = f.key;
  drawGranny($('#fearGranny'), f.mood, 10);
  $('#fearName').textContent = f.name;
  $('#fearDesc').textContent = f.desc;
  $('#fearGranny').style.transform = `scale(${1 + v * 0.05}) rotate(${v === 4 ? -4 : 0}deg)`;
  $('#win').classList.toggle('shake', v === 4);
  if (v === 4) { say('Ты сам этого захотел.', 'crazy'); Sfx.hmm(); }
}
$('#fearRange').addEventListener('input', renderFear);
enter.fear = () => { $('#fearRange').value = FEAR.findIndex(f => f.key === state.difficulty); renderFear(); };
leave.fear = async () => { $('#win').classList.remove('shake'); return true; };

// ---------- итог ----------
enter.summary = () => {
  const c = state.comps;
  const fear = FEAR.find(f => f.key === state.difficulty);
  const lines = [
    'Папка установки:',
    `    ${state.dir}`,
    '',
    `Порт сервера:       ${state.port}`,
    `Ник:                ${state.playerName}`,
    `Сложность:          ${fear.name}`,
    '',
    'Компоненты:',
    ...COMPONENTS.filter(x => c[x.id]).map(x => `    ✔ ${x.id === 'slipper' && state.slipperCompressed ? 'Тапок бабки (16×16)' : x.label}`),
    '',
    'Будет сделано:',
    '    • скопированы файлы игры и встроенный Node.js',
    '    • создан config.json и иконка с бабкой',
    '    • положен деинсталлятор (UNINSTALL.bat)',
    c.desktop ? '    • ярлык на рабочем столе' : null,
    c.startMenu ? '    • папка в меню «Пуск»' : null,
    c.firewall ? `    • правило брандмауэра для порта ${state.port} (Windows спросит права)` : null,
    c.register ? '    • запись в «Программы и компоненты»' : null,
    '',
    `Требуется места:    ${sizeText()}`,
  ].filter(l => l !== null);
  $('#summary').textContent = lines.join('\n');
};

// ---------- установка ----------
const FUN = [
  'Распаковываем бабку…', 'Проверяем, выключен ли утюг…', 'Считаем половицы… 1… 2… скрип…', 'Прячем ключи в самые неудобные места…',
  'Учим бабку открывать двери…', 'Смазываем двери… то есть наоборот, делаем скрипучими…', 'Настраиваем слух бабки на частоту шагов…',
  'Заряжаем перцовый баллончик…', 'Раскладываем бутылки для отвлечения внимания…', 'Кладём мишку на видное место…', 'Взбиваем подушки под кроватями…',
  'Протираем очки бабки… (где они?)', 'Выкручиваем лампочки в коридоре на 30%…', 'Заколачиваем входную дверь досками…', 'Вешаем цепь и навесной замок…',
  'Подключаем бабку к Radmin VPN… она требует свой IP…', 'Объясняем бабке, что такое мультиплеер…', 'Бабка спрашивает, будет ли второй внучок…',
  'Разогреваем пирожки до 72°C…', 'Устанавливаем драйвер тапка…', 'Калибруем замах битой…', 'Оптимизируем скорость бега бабки (не сильно)…',
];
let shown = 0, logEl = null;
const setProgress = (p) => {
  shown = Math.max(0, Math.min(100, p));
  $('#fill').style.width = `${shown}%`;
  $('#walker').style.left = `${shown}%`;
  $('#pct').textContent = Math.floor(shown);
};
function log(text, cls = '') {
  const d = document.createElement('div');
  d.className = cls; d.textContent = `${new Date().toLocaleTimeString('ru-RU')}  ${text}`;
  logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight;
}
async function animateTo(p, ms = 600) {
  const from = shown, t0 = performance.now();
  while (performance.now() - t0 < ms) { setProgress(from + (p - from) * ((performance.now() - t0) / ms)); await sleep(30); }
  setProgress(p);
}
function action(t) { $('#action').textContent = t; }

let walkFrame = 0;
setInterval(() => {
  if (currentPage() !== 'install') return;
  walkFrame++;
  const c = $('#walker');
  drawGranny(c, walkFrame % 2 ? 'angry' : 'calm', 2);
  c.style.transform = `translateY(${walkFrame % 2 ? -2 : 0}px)`;
}, 250);

// событие «не двигай мышь»
function mouseEvent() {
  return new Promise((resolve) => {
    const ev = $('#event');
    ev.hidden = false;
    say('Тихо! Я что-то слышала…', 'angry');
    Sfx.hmm();
    let n = 3, armed = false, finished = false, sx = null, sy = null;
    $('#evCount').textContent = n;
    const done = (ok, how) => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      removeEventListener('mousemove', onMove);
      removeEventListener('keydown', onKey);
      ev.hidden = true;
      resolve({ ok, how });
    };
    const onMove = (e) => {
      if (!armed) return;
      if (sx === null) { sx = e.clientX; sy = e.clientY; return; }
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > 8) done(false, 'mouse');
    };
    const onKey = (e) => { if (e.code === 'Space') { e.preventDefault(); done(true, 'bed'); } };
    setTimeout(() => { armed = true; }, 450);
    addEventListener('mousemove', onMove);
    addEventListener('keydown', onKey);
    const timer = setInterval(() => { n--; $('#evCount').textContent = n; if (n <= 0) done(true, 'still'); }, 1000);
  });
}
async function scare() {
  const s = $('#scare');
  drawGranny($('#scareGranny'), 'crazy', 32);
  s.hidden = false;
  Sfx.scare();
  await sleep(1300);
  s.hidden = true;
}

enter.install = async () => {
  if (state.installed) return;
  state.installed = true;
  logEl = $('#log');
  logEl.innerHTML = '';
  setProgress(0);
  updateNav();
  const fun = [...FUN].sort(() => Math.random() - 0.5);
  let fi = 0;
  const funLine = () => { const l = fun[fi++ % fun.length]; action(l); log(l, 'fun'); };

  for (let i = 0; i < 3; i++) { funLine(); await animateTo(shown + 4, 650); }
  try {
    await api('/api/install', {
      dir: state.dir, port: state.port, playerName: state.playerName, difficulty: state.difficulty,
      desktop: state.comps.desktop, startMenu: state.comps.startMenu, firewall: state.comps.firewall, register: state.comps.register,
    });
  } catch (e) { return installFailed(e.message); }

  let seen = 0, lastStates = [], st = null, funAt = performance.now(), eventDone = false;
  for (;;) {
    try { st = await api('/api/status'); } catch (e) { return installFailed('Установщик перестал отвечать: ' + e.message); }
    st.steps.forEach((s, i) => {
      if (i >= seen) { log(`▶ ${s.label}`); action(s.label); seen = i + 1; }
      if (s.state !== 'run' && lastStates[i] !== s.state) {
        const tag = { ok: 'готово', skip: 'пропущено', warn: 'внимание', fail: 'ОШИБКА' }[s.state];
        log(`   ${tag}${s.msg ? ': ' + s.msg : ''}`, s.state === 'fail' ? 'error' : s.state);
        if (s.id === 'firewall' && s.state === 'warn') say('Брандмауэр упёрся. Потом запусти firewall.bat.', 'angry');
      }
      lastStates[i] = s.state;
    });
    const target = 12 + st.progress * 70;
    if (target > shown) setProgress(shown + (target - shown) * 0.35);
    if (performance.now() - funAt > 1400) { funAt = performance.now(); funLine(); }
    if (!eventDone && shown > 45) { eventDone = true; await runMouseEvent(); }
    if (st.done) break;
    await sleep(250);
  }
  if (st.error) return installFailed(st.error);
  state.installResult = st;
  if (!eventDone) await runMouseEvent();

  for (let i = 0; i < 4; i++) { funLine(); await animateTo(Math.min(98, shown + (98 - shown) / 2.2), 700); }
  await animateTo(99, 500);
  action('Бабка ищет очки…'); log('Бабка ищет очки…', 'fun');
  say('Где мои очки?!', 'angry');
  await sleep(2600);
  action('Нашла. Они были на ней.'); log('Нашла. Они были на ней.', 'ok');
  await animateTo(100, 400);
  Sfx.tada();
  say('Готово! Заселилась.', 'happy');
  await sleep(1100);
  showPage(PAGES.indexOf('finish'));
};

async function runMouseEvent() {
  const r = await mouseEvent();
  if (r.ok) {
    log(r.how === 'bed' ? 'Вы спрятались под кровать. Бабка прошла мимо.' : 'Фух… Бабка постояла и ушла.', 'ok');
    say(r.how === 'bed' ? 'Хм. Показалось.' : 'Показалось…', 'calm');
  } else {
    await scare();
    log('Бабка вас заметила и отобрала 5% прогресса. (Шутка. Всё на месте.)', 'warn');
    say('Попался! Ладно, ставь дальше.', 'crazy');
    setProgress(shown - 5);
  }
}

async function installFailed(msg) {
  Sfx.error();
  action('Установка прервана.');
  log(`Ошибка: ${msg}`, 'error');
  say('Что-то пошло не так. Бабка не виновата.', 'angry');
  state.installed = false;
  await modal('Ошибка установки', `${msg}\n\nМожно вернуться и выбрать другую папку.`, ['Назад к выбору папки'], '❌');
  showPage(PAGES.indexOf('location'));
}

// ---------- конец ----------
enter.finish = () => {
  const st = state.installResult;
  const warns = (st?.steps || []).filter(s => s.state === 'warn');
  const box = $('#finWarn');
  box.hidden = !warns.length && info?.radmin?.installed;
  box.className = 'box warn';
  box.innerHTML = [
    ...warns.map(w => `⚠️ ${esc(w.label)}: ${esc(w.msg)}`),
    info?.radmin?.installed ? '' : '🔌 Radmin VPN не найден. Для игры через интернет поставьте его (и другу тоже): <a href="#" id="finRadmin">скачать</a>.',
  ].filter(Boolean).join('<br>');
  $('#finRadmin')?.addEventListener('click', (e) => { e.preventDefault(); api('/api/open', { what: 'radmin' }); });
  $('#finText').textContent = `Бабка заселилась в «${state.dir}». Ярлык «Бабка Кооп» ждёт на рабочем столе${state.comps.desktop ? '' : ' (а, нет, вы его отключили)'}.`;
};
$('#finCall').addEventListener('change', (e) => {
  if (e.target.checked) modal('Позвонить бабушке', 'Серьёзно, позвоните ей.\nОна скучает и будет очень рада. ❤️\n\n(Мастер установки звонить не умеет.)', ['Позвоню!'], '📞');
});

async function finish() {
  $('#next').disabled = true;
  if ($('#finGuide').checked) {
    const ip = info?.radmin?.ips?.[0];
    await modal('Как играть с другом по Radmin VPN',
      `1. Оба ставите Radmin VPN и входите в одну сеть:\n    один нажимает «Создать сеть», второй — «Присоединиться».\n` +
      `2. Хост запускает ярлык «Бабка Кооп» — откроется игра.\n` +
      `3. В лобби будет адрес ${ip ? `http://${ip}:${state.port}` : `вида http://26.x.x.x:${state.port}`}.\n    Отправьте его другу.\n` +
      `4. Друг открывает адрес в браузере (Chrome / Edge / Firefox).\n    Ему ничего устанавливать не нужно!\n` +
      `5. Друг нажимает «Я готов», хост — «Начать игру».\n\n` +
      `Не подключается? Меню «Пуск» → «Бабка Кооп» → «Открыть порт в брандмауэре».`,
      ['Понятно'], '📖');
  }
  if ($('#finLaunch').checked) {
    try { await api('/api/launch', { dir: state.dir }); } catch (e) { await modal('Запуск', `Не удалось запустить игру: ${e.message}`, ['Ок'], '❌'); }
  }
  await goodbye();
}

async function goodbye() {
  say('Пока, внучок! Заходи ещё.', 'happy');
  await sleep(700);
  document.body.style.transition = 'opacity 0.6s';
  document.body.style.opacity = '0';
  await sleep(650);
  api('/api/quit', {}).catch(() => {});
  window.close();
  document.body.innerHTML = '<p style="color:#fff;font:14px Tahoma;text-align:center;margin-top:40vh">Можно закрыть это окно. Бабка уже в пути.</p>';
  document.body.style.opacity = '1';
}

// ---------- отмена ----------
let cancelTries = 0;
async function cancelFlow() {
  if (currentPage() === 'install') {
    Sfx.error();
    say('Не мешай! Я вещи раскладываю!', 'angry');
    return modal('Бабка', 'Нельзя прерывать бабку, когда она раскладывает вещи.\nПодождите пару секунд.', ['Жду'], '🧳');
  }
  if (currentPage() === 'finish') return;
  const labels = ['Да, выйти', 'Точно?', 'Прям точно-точно?', 'Ну всё, выхожу'];
  for (;;) {
    const r = await modal('Выход из установки', cancelTries === 0 ? 'Вы уверены, что хотите прервать установку?\nБабка расстроится.' :
      cancelTries === 1 ? 'Бабка уже напекла пирожков…' : 'Она смотрит на вас. Молча.',
      [labels[Math.min(cancelTries, 3)], 'Нет, остаться'], '😢');
    if (r !== 0) { cancelTries = 0; say('Вот и правильно.', 'happy'); return; }
    cancelTries++;
    if (cancelTries >= 3) break;
  }
  say('Ну и иди.', 'angry');
  await sleep(500);
  api('/api/quit', {}).catch(() => {});
  window.close();
  document.body.innerHTML = '<p style="color:#fff;font:14px Tahoma;text-align:center;margin-top:40vh">Установка отменена. Бабка обиделась.</p>';
}

// ================= диалоги =================
function modal(title, text, buttons = ['OK'], icon = '⚠️') {
  return new Promise((resolve) => {
    $('#mTitle').textContent = title;
    $('#mText').textContent = text;
    $('#mIcon').textContent = icon;
    const box = $('#mBtns');
    box.innerHTML = '';
    buttons.forEach((b, i) => {
      const el = document.createElement('button');
      el.className = 'btn' + (i === 0 ? ' primary' : '');
      el.textContent = b;
      el.onclick = () => { $('#modalBack').hidden = true; resolve(i); };
      box.appendChild(el);
    });
    $('#mClose').onclick = () => { $('#modalBack').hidden = true; resolve(-1); };
    $('#modalBack').hidden = false;
    box.firstChild?.focus();
  });
}

// ================= рабочий стол / пасхалки =================
const JOKES = {
  computer: ['Мой компьютер', 'Это ваш компьютер. Теперь в нём живёт бабка.', '🖥️'],
  trash: ['Корзина', 'В корзине: 1 дедушкин носок, 3 фантика, прошлый установщик.\nОчистить? Бабка не разрешает.', '🗑️'],
  pies: ['Пирожки.txt — Блокнот', 'Рецепт пирожков бабки:\n1. Мука\n2. Капуста\n3. Секретный ингредиент (ваш страх)\n\nВыпекать 5 игровых дней.', '🥧'],
  programs: ['Программы', 'Установлено программ: 1 (бабка).\nОстальные бабка выгнала.', '📁'],
  docs: ['Документы бабки', 'Тетрадка «Кто шумел» (47 страниц)\nСписок ключей (зашифрован)\nРецепт борща (засекречен)', '📄'],
  settings: ['Настройка тапок', 'Размер: 38\nЦвет: «бабушкин»\nСкорость броска: максимальная', '🥿'],
  find: ['Найти ключи', 'Поиск ключей…\n\nНайдено: 0.\nБабка их хорошо спрятала. В игре поищете.', '🔍'],
  run: ['Выполнить', 'Бабка выполнила команду «бегом».\nВы слышите её шаги.', '▶️'],
  shutdown: ['Завершение работы', 'Бабку нельзя завершить.\nЕё можно только перехитрить.', '⏻'],
};
$$('.dicon').forEach(d => { d.ondblclick = () => { const j = JOKES[d.dataset.joke]; modal(j[0], j[1], ['OK'], j[2]); }; });
$('#startBtn').onclick = (e) => { e.stopPropagation(); $('#startMenu').hidden = !$('#startMenu').hidden; };
document.addEventListener('click', (e) => { if (!e.target.closest('#startMenu')) $('#startMenu').hidden = true; });
$$('#startMenu li[data-joke]').forEach(li => { li.onclick = () => { $('#startMenu').hidden = true; const j = JOKES[li.dataset.joke]; modal(j[0], j[1], ['OK'], j[2]); }; });
$$('.menubar span').forEach(m => {
  m.onclick = () => {
    const t = { file: ['Файл', 'Файл → Сохранить бабку… (она сама сохраняется)', '💾'],
      granny: ['Бабка', 'Бабка → Свойства:\nВозраст: не спрашивай\nСкорость: 3.35 м/с\nСлух: отличный\nЗрение: так себе (очки)', '👵'],
      help: ['О программе', 'Бабка Setup Wizard 98, версия 98.7\n\nМастер установки кооперативного хоррора «Бабка: Кооп».\nДелает настоящую установку: файлы, Node.js, ярлыки, брандмауэр, деинсталлятор.\n\n© Бабка и Внуки Inc.', 'ℹ️'] }[m.dataset.menu];
    modal(...t.slice(0, 2), ['OK'], t[2]);
  };
});
let iconClicks = 0;
$('#ticon').onclick = () => { if (++iconClicks === 5) { modal('Режим разработчика', 'Вы нашли режим разработчика бабки!\nНикаких бонусов. Бабка просто рада, что вы кликаете.', ['Ура'], '🛠️'); iconClicks = 0; } };
// код Konami — бабка танцует
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];
let kpos = 0;
addEventListener('keydown', (e) => {
  kpos = e.code === KONAMI[kpos] ? kpos + 1 : e.code === KONAMI[0] ? 1 : 0;
  if (kpos === KONAMI.length) { kpos = 0; $('#side').classList.toggle('dance'); say('Бабка танцует! 💃', 'happy'); Sfx.tada(); }
});
const tick = () => { $('#clock').textContent = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); };
tick(); setInterval(tick, 10000);

// ================= старт =================
async function boot() {
  drawGranny($('#ticon'), 'angry', 1);
  drawGranny($('#splashGranny'), 'calm', 10);
  const msgs = ['Загрузка бабки…', 'Бабка надевает тапки…', 'Бабка ищет очки…', 'Бабка нашла очки…', 'Бабка готова.'];
  const infoP = api('/api/info').then(r => { info = r; }).catch(e => { info = null; $('#smsg').textContent = 'Ошибка: ' + e.message; });
  let skip = false;
  $('#splash').onclick = () => { skip = true; };
  for (let i = 0; i < msgs.length && !skip; i++) {
    $('#smsg').textContent = msgs[i];
    $('#sfill').style.width = `${((i + 1) / msgs.length) * 100}%`;
    if (i === 2) drawGranny($('#splashGranny'), 'angry', 10);
    if (i === 3) drawGranny($('#splashGranny'), 'happy', 10);
    await sleep(520);
  }
  await infoP;
  if (!info) { $('#smsg').textContent = 'Не удалось связаться с установщиком. Запустите SETUP.bat заново.'; return; }
  $('#splash').classList.add('gone');
  showPage(0);
}
boot();
window.__setup = { state, get info() { return info; }, showPage, PAGES };
