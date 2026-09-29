// Клиент «Бабка: Кооп». Локальное движение + синхронизация с сервером по WebSocket.
import * as THREE from 'three';
import { buildMap, CELL, WALL_H, moveCircle, toCell, cellCenter, ITEMS, EXIT_LOCKS, MAX_DAYS } from '/shared/map.js';
import { buildWorld } from './world.js';
import { createGranny, createPlayerModel, createItemModel, createTrap } from './models.js';
import { Sound } from './audio.js';

const $ = (s) => document.querySelector(s);
const map = buildMap();
const sound = new Sound();

// ---------- настройки ----------
const settings = Object.assign({ sens: 1, vol: 0.8, fov: 75, name: '' }, (() => {
  try { return JSON.parse(localStorage.getItem('babka-settings') || '{}'); } catch { return {}; }
})());
const saveSettings = () => { try { localStorage.setItem('babka-settings', JSON.stringify(settings)); } catch { /* приватный режим */ } };
sound.setVolume(settings.vol);

// ---------- рендер ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('#view').appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 60);
camera.rotation.order = 'YXZ';
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});

let scene = null, W = null; // W — текущий мир (после start)

// фонарик игрока
const flashlight = new THREE.SpotLight(0xfff1d6, 11, 20, 0.5, 0.55, 1.0);
flashlight.position.set(0.15, -0.1, 0);
flashlight.target.position.set(0, -0.15, -1);
camera.add(flashlight, flashlight.target);
const viewModel = new THREE.Group();
viewModel.position.set(0.32, -0.3, -0.55);
camera.add(viewModel);

// ---------- состояние ----------
const me = {
  id: 0, host: false, x: 0, z: 0, yaw: 0, pitch: 0, crouch: false, crouchK: 0, run: false, moving: false,
  stamina: 1, flash: true, hidden: null, trappedUntil: 0, state: 'alive', held: null, bob: 0, stepAcc: 0,
};
let phase = 'menu';     // menu | lobby | playing | ended
let lobby = null;
let ws = null;
let lastSend = 0;
let latency = 0;
const keys = new Set();
let chatting = false;
let showObjectives = true;
const remote = new Map(); // id -> { model, st, x, z, yaw, light, heldId, stepAcc }
let granny = null, grannyState = null;
const markers = [];

// ================= сеть =================
function connect() {
  const name = $('#nameInput').value.trim() || 'Внучок';
  settings.name = name; saveSettings();
  sound.init();
  $('#menuMsg').textContent = 'Подключение…';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => { send({ t: 'hello', name }); $('#menuMsg').textContent = ''; };
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onMessage(m); };
  ws.onclose = () => {
    const was = phase;
    ws = null;
    leaveToMenu(was === 'menu' ? 'Не удалось подключиться к серверу.' : 'Соединение с хостом потеряно.');
  };
}
const send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
setInterval(() => send({ t: 'ping', c: performance.now() }), 2000);

function onMessage(m) {
  switch (m.t) {
    case 'welcome': me.id = m.id; me.host = m.host; if (phase === 'menu') phase = 'lobby'; renderLobby(); break;
    case 'full': $('#menuMsg').textContent = 'Сервер заполнен.'; break;
    case 'lobby': lobby = m; onLobby(); break;
    case 'start': startWorld(m.world); break;
    case 'snap': onSnap(m); break;
    case 'ev': onEvent(m); break;
    case 'chat': addChat(m); break;
    case 'pong': latency = Math.round(performance.now() - m.c); $('#netInfo').textContent = `пинг ${latency} мс`; break;
  }
}

// ================= экраны =================
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('show', s.id === id);
}

function onLobby() {
  if (lobby.phase === 'lobby' && (phase === 'playing' || phase === 'ended')) {
    disposeWorld();
    phase = 'lobby';
  }
  renderLobby();
}

function renderLobby() {
  if (!lobby) return;
  me.host = lobby.hostId === me.id;
  if (phase === 'lobby') { show('lobby'); $('#hud').classList.remove('show'); }
  $('#playerCount').textContent = `(${lobby.players.length}/4)`;
  $('#playerList').innerHTML = lobby.players.map(p =>
    `<li><i style="background:${p.color}"></i>${esc(p.name)}${p.id === lobby.hostId ? ' 👑' : ''}${p.id === me.id ? ' <small>(ты)</small>' : ''}` +
    `<span class="tag ${p.ready || p.id === lobby.hostId ? 'ready' : ''}">${p.id === lobby.hostId ? 'хост' : p.ready ? 'готов' : 'не готов'}</span></li>`).join('');
  const mine = lobby.players.find(p => p.id === me.id);
  const rb = $('#readyBtn');
  rb.style.display = me.host ? 'none' : '';
  rb.textContent = mine?.ready ? 'Готов ✓' : 'Я готов';
  rb.classList.toggle('on', !!mine?.ready);
  const sel = $('#diffSelect');
  sel.innerHTML = Object.entries(lobby.difficulties).map(([k, v]) => `<option value="${k}" ${k === lobby.difficulty ? 'selected' : ''}>${v}</option>`).join('');
  sel.disabled = !me.host;
  $('#diffHint').textContent = me.host ? 'Ты хост — выбирай.' : 'Меняет только хост.';
  const others = lobby.players.filter(p => p.id !== lobby.hostId);
  const allReady = others.every(p => p.ready);
  const sb = $('#startBtn');
  sb.style.display = me.host ? '' : 'none';
  sb.disabled = !allReady;
  $('#startHint').textContent = me.host ? (allReady ? (others.length ? 'Все готовы!' : 'Можно играть одному, но вдвоём веселее.') : 'Ждём, пока все нажмут «Я готов».')
    : 'Хост начнёт игру, когда все будут готовы.';
  const port = lobby.port || location.port;
  const addrs = lobby.addresses || [];
  $('#addrBox').innerHTML = addrs.length ? addrs.map(a =>
    `<div class="row"><code>http://${a.address}:${port}</code>${a.radmin ? '<span class="radmin">RADMIN VPN</span>' : `<small>${esc(a.name)}</small>`}` +
    `<button data-copy="http://${a.address}:${port}">копировать</button></div>`).join('') +
    (addrs.some(a => a.radmin) ? '' : '<p class="hint">Radmin VPN не найден (адрес 26.x.x.x). Запусти Radmin и зайди в сеть — потом перезапусти сервер.</p>')
    : '<p class="hint">Сетевые адреса не найдены.</p>';
}

$('#addrBox').addEventListener('click', (e) => {
  const v = e.target.dataset?.copy;
  if (!v) return;
  navigator.clipboard?.writeText(v).then(() => { e.target.textContent = 'скопировано!'; }).catch(() => {});
});
$('#readyBtn').onclick = () => { const mine = lobby?.players.find(p => p.id === me.id); send({ t: 'ready', v: !mine?.ready }); };
$('#diffSelect').onchange = (e) => send({ t: 'difficulty', v: e.target.value });
$('#startBtn').onclick = () => send({ t: 'start' });
$('#toLobbyBtn').onclick = () => send({ t: 'toLobby' });
$('#joinBtn').onclick = connect;
$('#nameInput').value = settings.name || new URLSearchParams(location.search).get('name') || '';
$('#nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
$('#resumeBtn').onclick = () => lockPointer();
$('#leaveBtn').onclick = () => { if (ws) ws.close(); };
for (const [id, key, fn] of [['#sensInput', 'sens'], ['#volInput', 'vol', (v) => sound.setVolume(v)], ['#fovInput', 'fov', (v) => { camera.fov = v; camera.updateProjectionMatrix(); }]]) {
  const el = $(id);
  el.value = settings[key];
  el.oninput = () => { settings[key] = +el.value; fn?.(+el.value); saveSettings(); };
}

function leaveToMenu(msg) {
  disposeWorld();
  phase = 'menu';
  lobby = null;
  $('#hud').classList.remove('show');
  show('menu');
  $('#menuMsg').textContent = msg || '';
  if (document.pointerLockElement) document.exitPointerLock();
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ================= мир =================
function disposeWorld() {
  if (!scene) return;
  scene.traverse(o => {
    o.geometry?.dispose?.();
    if (o.material) for (const m of [].concat(o.material)) { m.map?.dispose?.(); m.dispose?.(); }
  });
  scene = null; W = null; granny = null; grannyState = null;
  remote.clear();
  markers.length = 0;
  viewModel.clear();
  sound.setChase(false);
}

function startWorld(w) {
  disposeWorld();
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020202);
  scene.fog = new THREE.Fog(0x020202, 3, w.dark ? 14 : 22);
  scene.add(new THREE.AmbientLight(0x6a6a88, w.dark ? 0.12 : 0.32));
  scene.add(camera);
  const world = buildWorld(scene, map, { dark: w.dark });
  W = {
    world, doors: w.doors, exitLocks: w.exitLocks, items: new Map(), traps: new Map(),
    day: w.day, maxDays: w.maxDays, ai: w.ai, time: 0,
  };
  w.doors.forEach((d, i) => world.setDoor(i, d.open, d.lock));
  world.setExitLocks(w.exitLocks);
  world.setCreaky(w.creaky);
  for (const it of w.items) upsertItem(it);
  for (const t of w.traps) addTrap(t);
  if (w.ai) { granny = createGranny(); scene.add(granny); }

  Object.assign(me, { x: w.you.x, z: w.you.z, yaw: w.you.yaw, pitch: 0, hidden: null, state: 'alive', held: null, trappedUntil: 0, stamina: 1 });
  phase = 'playing';
  show(null);
  $('#hud').classList.add('show');
  $('#dayMax').textContent = w.maxDays;
  setDay(w.day);
  updateHeld();
  updateObjectives();
  fade(true, `ДЕНЬ ${w.day}`, 'Найдите способ выбраться. Не шумите.');
  sound.play('day');
  setTimeout(() => fade(false), 2200);
  lockPointer();
}

function upsertItem(it) {
  let rec = W.items.get(it.id);
  if (!rec) {
    const info = ITEMS[it.type];
    const model = createItemModel(info.model, info.color);
    model.traverse(o => { if (o.isMesh) o.userData.interact = { kind: 'item', id: it.id }; });
    rec = { data: it, model };
    W.items.set(it.id, rec);
  }
  rec.data = it;
  const m = rec.model;
  m.parent?.remove(m);
  if (it.holder === null) {
    m.position.set(it.x, 0.05, it.z);
    m.rotation.y = (it.id * 1.7) % 6.28;
    m.scale.setScalar(1);
    scene.add(m);
  } else if (it.holder === me.id) {
    m.position.set(0, 0, 0); m.rotation.set(0.2, -0.6, 0); m.scale.setScalar(1.1);
    viewModel.add(m);
  } else {
    const r = remote.get(it.holder);
    if (r) { m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.setScalar(1); r.model.userData.held.add(m); }
  }
  if (it.holder === me.id) me.held = it.id; else if (me.held === it.id) me.held = null;
  updateHeld();
}

function removeItem(id) {
  const rec = W?.items.get(id);
  if (!rec) return;
  rec.model.parent?.remove(rec.model);
  W.items.delete(id);
  if (me.held === id) me.held = null;
  updateHeld();
}

function addTrap(t) {
  const m = createTrap();
  m.position.set(t.x, 0, t.z);
  scene.add(m);
  W.traps.set(t.id, m);
}

function setDay(d) { W.day = d; $('#dayNum').textContent = d; }

function updateHeld() {
  const it = me.held && W?.items.get(me.held)?.data;
  $('#heldName').textContent = it ? ITEMS[it.type].name : '';
  $('#heldHint').textContent = it ? (it.type === 'spray' ? `ЛКМ — брызнуть (${it.charges}) · G — положить · Q — бросить` : 'G — положить · Q — бросить') : '';
}

function updateObjectives() {
  if (!W) return;
  const el = $('#objectives');
  el.classList.toggle('hidden', !showObjectives);
  const l = W.exitLocks;
  const row = (done, text) => `<div class="${done ? 'done' : ''}">${done ? '☑' : '☐'} ${text}</div>`;
  el.innerHTML = '<div class="t">ВХОДНАЯ ДВЕРЬ (гостиная)</div>' +
    row(!l.padlock, `Навесной замок — ${ITEMS.padlockKey.short}`) +
    row(!l.boards, `Доски — ${ITEMS.hammer.short}`) +
    row(!l.chain, `Цепь — ${ITEMS.pliers.short}`) +
    row(!l.padlock && !l.boards && !l.chain && W.doors[map.doors.find(d => d.exit).id].open, 'Открыть дверь и выбежать') +
    '<div class="t" style="margin-top:6px">Tab — скрыть</div>';
}

// ================= события =================
function feed(text, color) {
  const d = document.createElement('div');
  d.textContent = text;
  if (color) d.style.color = color;
  $('#feed').appendChild(d);
  setTimeout(() => d.remove(), 5000);
}

function addChat(m) {
  const d = document.createElement('div');
  if (m.sys) { d.className = 'sys'; d.textContent = m.text; }
  else { d.innerHTML = `<b style="color:${esc(m.color)}">${esc(m.from)}:</b> ${esc(m.text)}`; sound.play('chat'); }
  const log = $('#chatLog');
  log.appendChild(d);
  while (log.children.length > 8) log.firstChild.remove();
}

const nameOf = (id) => lobby?.players.find(p => p.id === id)?.name || 'Игрок';
const colorOf = (id) => lobby?.players.find(p => p.id === id)?.color || '#fff';
const at = (m) => (m.x !== undefined ? { x: m.x, y: 1.2, z: m.z } : null);

function onEvent(m) {
  if (!W && m.e !== 'end') return;
  switch (m.e) {
    case 'door': {
      W.doors[m.id].open = m.open; W.doors[m.id].lock = m.lock;
      W.world.setDoor(m.id, m.open, m.lock);
      sound.play(m.open ? 'door' : 'doorClose', at(m));
      if (map.doors[m.id].exit) updateObjectives();
      break;
    }
    case 'unlock': sound.play('unlock', at(cellCenter(map.doors[m.id].x, map.doors[m.id].y))); break;
    case 'locked': sound.play('locked', at(m)); break;
    case 'item': upsertItem(m.item); if (m.sound) sound.play(m.sound, at(m.item)); break;
    case 'itemGone': removeItem(m.id); break;
    case 'msg': feed(m.text); break;
    case 'creak': sound.play('creak', at(m)); break;
    case 'glass': sound.play('glass', at(m)); break;
    case 'trapSet': addTrap(m.trap); break;
    case 'trap': {
      const t = W.traps.get(m.trap);
      if (t) { scene.remove(t); W.traps.delete(m.trap); }
      sound.play('trap', at(m));
      if (m.id === me.id) {
        me.trappedUntil = performance.now() / 1000 + m.until;
        me.x = m.x; me.z = m.z;
        $('#trapOverlay').classList.add('show');
        flashRed();
      } else feed(`${nameOf(m.id)} попал(а) в капкан!`, colorOf(m.id));
      break;
    }
    case 'exitLock':
      W.exitLocks = m.exitLocks;
      W.world.setExitLocks(m.exitLocks);
      sound.play(m.lock === 'boards' ? 'boards' : m.lock === 'chain' ? 'chain' : 'unlock', at(m));
      updateObjectives();
      break;
    case 'spray':
      sound.play('spray', at(m));
      sprayCloud(m);
      if (m.id === me.id) { const rec = W.items.get(m.itemId); if (rec) { rec.data.charges = m.charges; updateHeld(); } }
      break;
    case 'stunned': sound.play('stun', at(m)); feed('Бабка ослеплена!', '#f1c40f'); break;
    case 'angry': sound.play('angry', at(m)); break;
    case 'spotted': sound.play('spotted', at(m)); if (m.id === me.id) { feed('Она тебя видит! БЕГИ!', '#e74c3c'); flashRed(); } else feed(`Бабка заметила ${nameOf(m.id)}!`, '#e74c3c'); break;
    case 'hear': sound.play('hear', at(m)); break;
    case 'swing': sound.play('swing', at(m)); break;
    case 'pull': sound.play('pull', at(cellCenter(map.hides[m.spot].x, map.hides[m.spot].y))); break;
    case 'hide': {
      if (m.id === me.id) {
        if (m.on) enterHide(m.spot);
        else { me.hidden = null; me.x = m.x; me.z = m.z; $('#hideOverlay').className = ''; }
      }
      break;
    }
    case 'caught': {
      sound.play('hit');
      if (m.id === me.id) {
        me.state = 'knocked'; me.hidden = null; $('#hideOverlay').className = '';
        flashRed();
        setTimeout(() => fade(true, m.over ? 'КОНЕЦ' : `ДЕНЬ ${m.day}`, m.over ? 'Бабка победила…' : 'Бабка поймала тебя. Ты очнулся в спальне.'), 300);
        sound.play('day');
      } else feed(`Бабка поймала ${m.name}! Наступает день ${m.day}.`, '#e74c3c');
      setDay(m.day);
      break;
    }
    case 'respawn':
      setDay(m.day);
      if (m.id === me.id) { me.state = 'alive'; me.x = m.x; me.z = m.z; me.yaw = 0; me.pitch = 0; setTimeout(() => fade(false), 400); }
      break;
    case 'correct': me.x = m.x; me.z = m.z; break;
    case 'marker': addMarker(m); break;
    case 'end': showEnd(m); break;
  }
}

function enterHide(spotId) {
  me.hidden = spotId;
  const spot = map.hides[spotId];
  $('#hideOverlay').className = spot.type;
  const s = cellCenter(spot.x, spot.y), e = cellCenter(spot.exit.x, spot.exit.y);
  me.yaw = Math.atan2(-(e.x - s.x), -(e.z - s.z));
  me.pitch = 0;
}

function fade(on, text = '', sub = '') {
  const f = $('#fade');
  if (on) { $('#fadeText').textContent = text; $('#fadeSub').textContent = sub; }
  f.classList.toggle('show', on);
}
function flashRed() {
  const v = $('#dangerVignette');
  v.style.opacity = 1;
  setTimeout(() => { v.style.opacity = ''; }, 350);
}

function showEnd(m) {
  phase = 'ended';
  if (document.pointerLockElement) document.exitPointerLock();
  fade(false);
  $('#hud').classList.remove('show');
  show('end');
  const win = m.result === 'win';
  $('#endTitle').textContent = win ? 'ВЫ СБЕЖАЛИ!' : 'БАБКА ПОБЕДИЛА';
  $('#endTitle').style.color = win ? '#2ecc71' : '';
  const mm = Math.floor(m.time / 60), ss = String(m.time % 60).padStart(2, '0');
  $('#endText').textContent = (win ? `${m.by} первым(ой) выбежал(а) на улицу. ` : 'Пять дней прошли. Дом не отпустил вас. ') +
    `Время: ${mm}:${ss} · День: ${m.day} · Сложность: ${m.difficulty}`;
  $('#endStats').innerHTML = m.stats.map(s => `<li><i style="background:${s.color}"></i>${esc(s.name)}<span class="tag">поймана раз: ${s.catches}</span></li>`).join('');
  $('#toLobbyBtn').style.display = me.host ? '' : 'none';
  $('#endHint').textContent = me.host ? '' : 'Ждём, пока хост вернёт всех в лобби…';
  sound.setChase(false);
  if (win) sound.play('escape'); else sound.play('day');
}

// ---------- эффекты ----------
const sprays = [];
function sprayCloud(m) {
  const p = m.id === me.id ? { x: me.x, z: me.z, yaw: me.yaw } : remote.get(m.id) || { x: m.x, z: m.z, yaw: 0 };
  const mat = new THREE.SpriteMaterial({ color: 0xffa060, transparent: true, opacity: 0.5, depthWrite: false });
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(mat.clone());
    const d = 0.3 + i * 0.3, spread = (Math.random() - 0.5) * 0.4;
    s.position.set(p.x - Math.sin(p.yaw + spread) * 0.3, 1.4, p.z - Math.cos(p.yaw + spread) * 0.3);
    s.userData = { vx: -Math.sin(p.yaw + spread) * (3 + d), vz: -Math.cos(p.yaw + spread) * (3 + d), life: 0.8 };
    s.scale.setScalar(0.2);
    scene.add(s); sprays.push(s);
  }
}
function updateEffects(dt) {
  for (let i = sprays.length - 1; i >= 0; i--) {
    const s = sprays[i];
    s.userData.life -= dt;
    s.position.x += s.userData.vx * dt; s.position.z += s.userData.vz * dt;
    s.userData.vx *= 0.9; s.userData.vz *= 0.9;
    s.scale.setScalar(0.2 + (0.8 - s.userData.life) * 1.5);
    s.material.opacity = Math.max(0, s.userData.life * 0.6);
    if (s.userData.life <= 0) { scene.remove(s); sprays.splice(i, 1); }
  }
  for (let i = markers.length - 1; i >= 0; i--) {
    const mk = markers[i];
    mk.life -= dt;
    mk.sprite.material.opacity = Math.min(1, mk.life);
    mk.sprite.position.y = mk.y + Math.sin(mk.life * 4) * 0.05;
    if (mk.life <= 0) { scene.remove(mk.sprite); markers.splice(i, 1); }
  }
}
function addMarker(m) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = colorOf(m.id); g.lineWidth = 6;
  g.beginPath(); g.moveTo(32, 58); g.lineTo(10, 18); g.arc(32, 22, 22, Math.PI * 0.85, Math.PI * 0.15); g.closePath(); g.stroke();
  g.fillStyle = colorOf(m.id); g.beginPath(); g.arc(32, 22, 8, 0, 7); g.fill();
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.setScalar(0.45); s.renderOrder = 11;
  s.position.set(m.x, m.y + 0.35, m.z);
  scene.add(s);
  markers.push({ sprite: s, life: 6, y: m.y + 0.35 });
  sound.play('marker', { x: m.x, y: m.y, z: m.z });
  if (m.id !== me.id) feed(`${nameOf(m.id)} поставил(а) метку`, colorOf(m.id));
}

// ================= снапшоты =================
function onSnap(m) {
  if (!W) return;
  if (m.day !== W.day) setDay(m.day);
  const seen = new Set();
  for (const p of m.players) {
    if (p.id === me.id) {
      // сервер знает лучше, если мы спрятаны/выбиты
      if (p.hid !== me.hidden && p.hid !== null && me.hidden === null) enterHide(p.hid);
      continue;
    }
    seen.add(p.id);
    let r = remote.get(p.id);
    if (!r) {
      const model = createPlayerModel(nameOf(p.id), colorOf(p.id));
      const light = new THREE.SpotLight(0xfff1d6, 8, 16, 0.5, 0.6, 1.0);
      model.add(light, light.target);
      scene.add(model);
      r = { model, light, x: p.x, z: p.z, yaw: p.yaw, st: p, stepAcc: 0 };
      remote.set(p.id, r);
      // вдруг он уже держит предмет
      for (const rec of W.items.values()) if (rec.data.holder === p.id) upsertItem(rec.data);
    }
    r.st = p;
  }
  for (const [id, r] of remote) if (!seen.has(id)) { scene.remove(r.model); remote.delete(id); }
  grannyState = m.ai;
}

// ================= ввод =================
function lockPointer() {
  const el = renderer.domElement;
  try { const p = el.requestPointerLock?.(); p?.catch?.(() => {}); } catch { /* ignore */ }
}
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (phase === 'playing') show(locked || chatting ? null : 'clickToPlay');
});
renderer.domElement.addEventListener('click', () => { if (phase === 'playing') lockPointer(); });
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement || phase !== 'playing') return;
  const k = 0.0022 * settings.sens;
  me.yaw -= e.movementX * k;
  me.pitch = Math.max(-1.45, Math.min(1.45, me.pitch - e.movementY * k));
});
document.addEventListener('mousedown', (e) => {
  if (phase !== 'playing' || document.pointerLockElement !== renderer.domElement) return;
  if (e.button === 0) send({ t: 'use' });
});

addEventListener('keydown', (e) => {
  if (phase !== 'playing') return;
  if (chatting) {
    if (e.key === 'Enter') { const v = $('#chatInput').value.trim(); if (v) send({ t: 'chat', text: v }); closeChat(); }
    else if (e.key === 'Escape') closeChat();
    return;
  }
  if (e.code === 'Tab') { e.preventDefault(); showObjectives = !showObjectives; updateObjectives(); return; }
  if (e.code === 'KeyT' || e.code === 'Enter') { e.preventDefault(); openChat(); return; }
  keys.add(e.code);
  if (e.repeat) return;
  switch (e.code) {
    case 'KeyE': interact(); break;
    case 'KeyG': send({ t: 'drop' }); break;
    case 'KeyQ': send({ t: 'throw' }); break;
    case 'KeyF': me.flash = !me.flash; sound.play('switch'); break;
    case 'KeyC': me.crouch = !me.crouch; break;
    case 'KeyZ': placeMarker(); break;
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

function openChat() {
  chatting = true;
  $('#hud').classList.add('chatting');
  keys.clear();
  setTimeout(() => $('#chatInput').focus(), 0);
}
function closeChat() {
  chatting = false;
  $('#chatInput').value = '';
  $('#chatInput').blur();
  $('#hud').classList.remove('chatting');
  if (document.pointerLockElement !== renderer.domElement) show('clickToPlay');
}

// ---------- взаимодействие ----------
const ray = new THREE.Raycaster();
const center = new THREE.Vector2(0, 0);
let target = null;

function findTarget() {
  if (!W || me.hidden !== null || me.state !== 'alive') return null;
  ray.setFromCamera(center, camera);
  ray.far = 2.5;
  // луч по всему дому: стены тоже учитываются, чтобы не «открывать» двери сквозь стену
  const objs = [W.world.root];
  for (const rec of W.items.values()) if (rec.data.holder === null) objs.push(rec.model);
  const hit = ray.intersectObjects(objs, true)[0];
  if (hit) {
    let o = hit.object;
    while (o && !o.userData.interact) o = o.parent;
    if (o) return { ...o.userData.interact, dist: hit.distance };
  }
  // предметы на полу трудно навести — ищем ближайший в конусе взгляда
  let best = null, bestScore = 0.96;
  const f = new THREE.Vector3(); camera.getWorldDirection(f);
  for (const rec of W.items.values()) {
    if (rec.data.holder !== null) continue;
    const v = new THREE.Vector3(rec.data.x - camera.position.x, 0.05 - camera.position.y, rec.data.z - camera.position.z);
    const d = v.length();
    if (d > 2.4) continue;
    const score = v.normalize().dot(f);
    if (score > bestScore) { bestScore = score; best = { kind: 'item', id: rec.data.id, dist: d }; }
  }
  return best;
}

function promptFor(t) {
  if (me.hidden !== null) return 'E — вылезти';
  if (!t) return '';
  const held = me.held && W.items.get(me.held)?.data;
  if (t.kind === 'item') {
    const it = W.items.get(t.id)?.data;
    return it ? `E — ${held ? 'поменять на' : 'взять'}: ${ITEMS[it.type].name}` : '';
  }
  if (t.kind === 'hide') return map.hides[t.id].type === 'bed' ? 'E — залезть под кровать' : 'E — спрятаться в шкаф';
  if (t.kind === 'door') {
    const d = map.doors[t.id], ds = W.doors[t.id];
    if (d.exit) {
      const left = Object.keys(W.exitLocks).filter(k => W.exitLocks[k]);
      if (!left.length) return ds.open ? 'Беги на улицу!' : 'E — открыть входную дверь';
      const use = held && left.find(k => EXIT_LOCKS[k].item === held.type);
      if (use) return `E — снять ${EXIT_LOCKS[use].name} (${ITEMS[held.type].short})`;
      return 'Входная дверь. Нужно: ' + left.map(k => ITEMS[EXIT_LOCKS[k].item].short).join(', ');
    }
    if (ds.lock) return held && held.type === ds.lock ? `E — отпереть (${ITEMS[ds.lock].short})` : `Заперто — нужен ${ITEMS[ds.lock].name.toLowerCase()}`;
    return ds.open ? 'E — закрыть дверь' : 'E — открыть дверь';
  }
  return '';
}

function interact() {
  if (me.state !== 'alive') return;
  if (me.hidden !== null) { send({ t: 'unhide' }); return; }
  if (target) send({ t: 'interact', kind: target.kind, id: target.id });
}

function placeMarker() {
  if (!W) return;
  ray.setFromCamera(center, camera);
  ray.far = 30;
  const hits = ray.intersectObjects(W.world.root.children, true);
  const p = hits[0]?.point;
  if (p) send({ t: 'ping_loc', x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) });
}

// ================= цикл =================
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  if (!scene || !W) return;
  const now = performance.now() / 1000;
  W.time += dt;
  updateMe(dt, now);
  updateRemotes(dt);
  updateGranny(dt);
  W.world.updateDoors(dt);
  W.world.updateLamps(dt);
  updateEffects(dt);
  for (const rec of W.items.values()) if (rec.data.holder === null) rec.model.position.y = 0.05 + Math.sin(W.time * 2 + rec.data.id) * 0.015;

  target = findTarget();
  $('#prompt').textContent = me.state === 'alive' ? promptFor(target) : '';
  $('#crosshair').classList.toggle('active', !!target);
  sound.setListener(camera);

  if (now - lastSend > 0.05 && me.state === 'alive') {
    lastSend = now;
    send({ t: 'st', x: +me.x.toFixed(3), z: +me.z.toFixed(3), yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3),
      cr: !!me.crouchSent, run: me.run, mv: me.moving, fl: me.flash });
  }
  renderer.render(scene, camera);
}

function updateMe(dt, now) {
  const trapped = now < me.trappedUntil;
  if (!trapped) $('#trapOverlay').classList.remove('show');
  let fx = 0, fz = 0;
  const canMove = me.state === 'alive' && me.hidden === null && !trapped && !chatting;
  if (canMove) {
    if (keys.has('KeyW') || keys.has('ArrowUp')) fz -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) fz += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) fx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) fx += 1;
  }
  const crouch = me.crouch || keys.has('ControlLeft') || keys.has('ControlRight');
  const wantRun = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const moving = (fx || fz) !== 0;
  me.run = moving && wantRun && !crouch && me.stamina > 0.02;
  if (me.run) me.stamina = Math.max(0, me.stamina - dt / 5.5);
  else me.stamina = Math.min(1, me.stamina + dt / (moving ? 9 : 5));
  if (me.stamina <= 0.02) me.exhausted = true;
  if (me.exhausted) { me.run = false; if (me.stamina > 0.35) me.exhausted = false; }
  const speed = crouch ? 1.35 : me.run ? 4.4 : 2.6;
  me.moving = moving;
  me.crouchSent = crouch;
  if (moving) {
    const len = Math.hypot(fx, fz);
    fx /= len; fz /= len;
    const s = Math.sin(me.yaw), c = Math.cos(me.yaw);
    const dx = (fx * c + fz * s) * speed * dt;
    const dz = (-fx * s + fz * c) * speed * dt;
    const p = moveCircle(map, W.doors, me.x, me.z, dx, dz);
    const moved = Math.hypot(p.x - me.x, p.z - me.z);
    me.x = p.x; me.z = p.z;
    me.bob += moved * (me.run ? 2.2 : 2.8);
    me.stepAcc += moved;
    const stepLen = me.run ? 1.1 : 0.8;
    if (me.stepAcc > stepLen && !crouch) { me.stepAcc = 0; sound.play(me.run ? 'stepRun' : 'step', { x: me.x, y: 0.1, z: me.z }); }
  }
  me.crouchK += ((crouch ? 1 : 0) - me.crouchK) * Math.min(1, dt * 10);

  const bar = $('#staminaBar');
  bar.classList.toggle('show', me.stamina < 0.99);
  bar.classList.toggle('low', !!me.exhausted);
  bar.firstElementChild.style.width = `${me.stamina * 100}%`;

  // камера
  if (me.hidden !== null) {
    const spot = map.hides[me.hidden];
    const s = cellCenter(spot.x, spot.y), e = cellCenter(spot.exit.x, spot.exit.y);
    const k = spot.type === 'bed' ? 0.45 : 0.1;
    camera.position.set(s.x + (e.x - s.x) * k, spot.type === 'bed' ? 0.28 : 1.5, s.z + (e.z - s.z) * k);
  } else {
    const eye = 1.62 - me.crouchK * 0.7;
    const bobY = moving && canMove ? Math.sin(me.bob * 2) * 0.04 : 0;
    camera.position.set(me.x, eye + bobY, me.z);
  }
  if (me.state === 'knocked') camera.position.y = 0.4;
  camera.rotation.set(me.pitch, me.yaw, trapped ? Math.sin(now * 40) * 0.01 : 0);
  flashlight.visible = me.flash;
  flashlight.intensity = me.flash ? 11 : 0;

  // предмет в руке покачивается
  viewModel.position.y = -0.3 + (moving ? Math.sin(me.bob * 2) * 0.012 : 0);
  viewModel.visible = me.hidden === null;
}

function updateRemotes(dt) {
  for (const r of remote.values()) {
    const st = r.st;
    const k = Math.min(1, dt * 12);
    const px = r.x, pz = r.z;
    r.x += (st.x - r.x) * k; r.z += (st.z - r.z) * k;
    let dy = st.yaw - r.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    r.yaw += dy * k;
    r.model.position.set(r.x, 0, r.z);
    r.model.rotation.y = r.yaw;
    r.model.visible = st.hid === null && st.st === 'alive';
    r.model.userData.update(dt, st);
    r.light.visible = st.fl && r.model.visible;
    r.light.position.set(0.2, st.cr ? 1.0 : 1.45, -0.3);
    r.light.target.position.set(0, (st.cr ? 1.0 : 1.45) + Math.sin(st.pitch) * 3, -3 * Math.cos(st.pitch));
    const moved = Math.hypot(r.x - px, r.z - pz);
    r.stepAcc += moved;
    if (r.stepAcc > (st.run ? 1.1 : 0.8)) { r.stepAcc = 0; if (!st.cr) sound.play(st.run ? 'stepRun' : 'step', { x: r.x, y: 0.1, z: r.z }); }
  }
}

function updateGranny(dt) {
  if (!granny || !grannyState) { sound.update(dt, 0); return; }
  const g = grannyState;
  const px = granny.position.x, pz = granny.position.z;
  const k = Math.min(1, dt * 10);
  if (granny.userData.init) {
    // телепорт (после поимки) — не тащим модель через стены
    if (Math.hypot(g.x - px, g.z - pz) > 4) granny.position.set(g.x, 0, g.z);
    granny.position.x += (g.x - granny.position.x) * k;
    granny.position.z += (g.z - granny.position.z) * k;
  } else { granny.position.set(g.x, 0, g.z); granny.userData.init = true; }
  let dy = g.yaw - granny.rotation.y; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
  granny.rotation.y += dy * k;
  granny.userData.update(dt, g.an, g.st);
  const moved = Math.hypot(granny.position.x - px, granny.position.z - pz);
  granny.userData.stepAcc = (granny.userData.stepAcc || 0) + moved;
  if (granny.userData.stepAcc > 0.85 && moved < 1) {
    granny.userData.stepAcc = 0;
    sound.play('grannyStep', { x: granny.position.x, y: 0.1, z: granny.position.z });
  }
  const chase = g.st === 'chase' || g.st === 'attack';
  sound.setChase(chase);
  const d = Math.hypot(g.x - me.x, g.z - me.z);
  const inten = me.state !== 'alive' ? 0 : Math.max(0, 1 - d / 11) * (chase ? 1 : 0.6) + (chase && d < 18 ? 0.3 : 0);
  sound.update(dt, Math.min(1, inten));
  $('#dangerVignette').style.opacity = chase && d < 8 ? String((1 - d / 8) * 0.8) : '';
}

requestAnimationFrame(frame);
show('menu');
// подсказка по адресу, если открыто не с localhost
if (!/^(localhost|127\.)/.test(location.hostname)) $('#menuMsg').textContent = '';
window.__babka = { me, get W() { return W; }, get phase() { return phase; }, get ai() { return grannyState; }, send };
void WALL_H; void toCell; void MAX_DAYS; void CELL;
