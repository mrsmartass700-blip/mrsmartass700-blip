// Клиент «Бабка: Кооп» v2: реалистичный 3D-дом на 3 этажа, скелетные персонажи, 3D-лобби.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  buildMap, CELL, FLOOR_H, moveEntity, toCell, cellCenter, ITEMS, EXITS, charAt, heightAt, lineOfSight, blocksSight,
} from '/shared/map.js';
import { createMaterials, setAnisotropy } from './materials.js';
import { buildHouse } from './house.js';
import { Character, preloadCharacters, charactersReady, makeFlashlight } from './characters.js';
import { createItem, createTrap } from './items3d.js';
import { Lobby3D } from './lobby3d.js';
import { Sound } from './audio.js';

const $ = (s) => document.querySelector(s);
const map = buildMap();
const sound = new Sound();

// ---------- настройки ----------
const settings = Object.assign({ sens: 1, vol: 0.8, mus: 0.6, fov: 75, name: '', look: 'm', quality: 'mid' }, (() => {
  try { return JSON.parse(localStorage.getItem('babka-settings') || '{}'); } catch { return {}; }
})());
const saveSettings = () => { try { localStorage.setItem('babka-settings', JSON.stringify(settings)); } catch { /* приватный режим */ } };

// ---------- рендер ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('#view').appendChild(renderer.domElement);
setAnisotropy(renderer.capabilities.getMaxAnisotropy());
const pixelRatio = () => Math.min(window.devicePixelRatio, settings.quality === 'high' ? 2 : settings.quality === 'mid' ? 1.25 : 0.85);
renderer.setPixelRatio(pixelRatio());
renderer.setSize(innerWidth, innerHeight);
const mats = createMaterials();
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.04, 150);
camera.rotation.order = 'YXZ';

let composer = null, scene = null, W = null, lobby3d = null;
function makeComposer(sc, cam) {
  const c = new EffectComposer(renderer);
  c.addPass(new RenderPass(sc, cam));
  if (settings.quality !== 'low') c.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.6, 0.85));
  c.addPass(new OutputPass());
  return c;
}
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  lobby3d?.resize(innerWidth, innerHeight);
  composer?.setSize(innerWidth, innerHeight);
});

// фонарик (тени) + вид от первого лица
const flashlight = new THREE.SpotLight(0xfff1d6, 14, 22, 0.5, 0.55, 1.2);
flashlight.position.set(0.22, -0.2, 0.05);
flashlight.target.position.set(0.05, -0.15, -1);
flashlight.castShadow = true;
flashlight.shadow.mapSize.set(1024, 1024);
flashlight.shadow.camera.near = 0.1; flashlight.shadow.camera.far = 22;
flashlight.shadow.bias = -0.0004; flashlight.shadow.normalBias = 0.02;
camera.add(flashlight, flashlight.target);
const viewModel = new THREE.Group();
camera.add(viewModel);
const vmTorch = makeFlashlight();
vmTorch.position.set(0.27, -0.25, -0.5);
vmTorch.rotation.set(-Math.PI / 2 + 0.1, 0, 0.08);
viewModel.add(vmTorch);
const noShadow = (o) => o.traverse(m => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
noShadow(vmTorch);
const vmHeld = new THREE.Group();
vmHeld.position.set(-0.2, -0.24, -0.45);
viewModel.add(vmHeld);
const vmLight = new THREE.PointLight(0xffe8c8, 0.25, 1.2, 2); // чуть подсвечиваем предметы в руках
vmLight.position.set(0, -0.1, -0.3); camera.add(vmLight);

// ---------- состояние ----------
const me = {
  id: 0, host: false, level: 0, x: 0, z: 0, y: 0, yaw: 0, pitch: 0, crouch: false, crouchK: 0, run: false, moving: false,
  stamina: 1, flash: true, hidden: null, trappedUntil: 0, state: 'alive', held: null, bob: 0, stepAcc: 0,
};
let phase = 'menu';
let lobby = null, ws = null, lastSend = 0, latency = 0;
const keys = new Set();
let chatting = false, showObjectives = true;
const remote = new Map();
let granny = null, grannyState = null, grannyPrev = null;
const markers = [], sprays = [];
let carStartUntil = 0, carStartDur = 0;

// ================= сеть =================
function connect() {
  const name = $('#nameInput').value.trim() || 'Внучок';
  settings.name = name; saveSettings();
  sound.init();
  sound.setMusic('lobby');
  $('#menuMsg').textContent = 'Подключение…';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => { send({ t: 'hello', name, look: settings.look }); $('#menuMsg').textContent = ''; };
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onMessage(m); };
  ws.onclose = () => { const was = phase; ws = null; leaveToMenu(was === 'menu' ? 'Не удалось подключиться к серверу.' : 'Соединение с хостом потеряно.'); };
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
function show(id) { for (const s of document.querySelectorAll('.screen')) s.classList.toggle('show', s.id === id); }
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function onLobby() {
  if (lobby.phase === 'lobby' && (phase === 'playing' || phase === 'ended')) { disposeWorld(); phase = 'lobby'; sound.setMusic('lobby'); }
  renderLobby();
}

function renderLobby() {
  if (!lobby) return;
  me.host = lobby.hostId === me.id;
  if (phase === 'lobby') { show('lobby'); $('#hud').classList.remove('show'); }
  lobby3d?.setPlayers(lobby.players);
  $('#playerCount').textContent = `(${lobby.players.length}/4)`;
  $('#playerList').innerHTML = lobby.players.map(p =>
    `<li><i style="background:${p.color}"></i>${esc(p.name)}${p.id === lobby.hostId ? ' 👑' : ''}${p.id === me.id ? ' <small>(ты)</small>' : ''}` +
    `<span class="tag ${p.ready || p.id === lobby.hostId ? 'ready' : ''}">${p.id === lobby.hostId ? 'хост' : p.ready ? 'готов' : 'не готов'}</span></li>`).join('');
  const mine = lobby.players.find(p => p.id === me.id);
  for (const b of document.querySelectorAll('#lookSeg2 button')) b.classList.toggle('on', b.dataset.look === (mine?.look || settings.look));
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
  $('#startHint').textContent = me.host ? (allReady ? (others.length ? 'Все готовы!' : 'Можно одному, но вдвоём веселее.') : 'Ждём, пока все нажмут «Я готов».') : 'Хост начнёт игру, когда все будут готовы.';
  const port = lobby.port || location.port;
  const addrs = lobby.addresses || [];
  $('#addrBox').innerHTML = addrs.length ? addrs.map(a =>
    `<div class="row"><code>http://${a.address}:${port}</code>${a.radmin ? '<span class="radmin">RADMIN VPN</span>' : `<small>${esc(a.name)}</small>`}` +
    `<button data-copy="http://${a.address}:${port}">копировать</button></div>`).join('') +
    (addrs.some(a => a.radmin) ? '' : '<p class="hint">Radmin VPN не найден (адрес 26.x.x.x). Запусти Radmin и зайди в сеть — потом перезапусти игру.</p>')
    : '<p class="hint">Сетевые адреса не найдены.</p>';
}
$('#addrBox').addEventListener('click', (e) => { const v = e.target.dataset?.copy; if (v) navigator.clipboard?.writeText(v).then(() => { e.target.textContent = 'скопировано!'; }).catch(() => {}); });
$('#readyBtn').onclick = () => { const mine = lobby?.players.find(p => p.id === me.id); send({ t: 'ready', v: !mine?.ready }); };
$('#diffSelect').onchange = (e) => send({ t: 'difficulty', v: e.target.value });
$('#startBtn').onclick = () => send({ t: 'start' });
$('#toLobbyBtn').onclick = () => send({ t: 'toLobby' });
$('#joinBtn').onclick = connect;
$('#nameInput').value = settings.name || new URLSearchParams(location.search).get('name') || '';
$('#nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
const setLook = (v) => { settings.look = v; saveSettings(); for (const b of document.querySelectorAll('.seg button')) b.classList.toggle('on', b.dataset.look === v); if (phase === 'lobby') send({ t: 'look', v }); else lobby3d?.setPlayers([{ id: -1, name: $('#nameInput').value || 'Внучок', color: '#e74c3c', look: v, ready: false }]); };
for (const b of document.querySelectorAll('.seg button')) b.onclick = () => setLook(b.dataset.look);
$('#resumeBtn').onclick = () => lockPointer();
$('#leaveBtn').onclick = () => { if (ws) ws.close(); };
for (const [id, key, fn] of [['#sensInput', 'sens'], ['#volInput', 'vol', (v) => sound.setVolume(v)], ['#musInput', 'mus', (v) => sound.setMusicVolume(v)],
  ['#fovInput', 'fov', (v) => { camera.fov = v; camera.updateProjectionMatrix(); }]]) {
  const el = $(id); el.value = settings[key];
  el.oninput = () => { settings[key] = +el.value; fn?.(+el.value); saveSettings(); };
}
$('#qualitySelect').value = settings.quality;
$('#qualitySelect').onchange = (e) => { settings.quality = e.target.value; saveSettings(); applyQuality(); };
function applyQuality() {
  renderer.setPixelRatio(pixelRatio());
  flashlight.shadow.mapSize.set(settings.quality === 'low' ? 512 : settings.quality === 'high' ? 2048 : 1024, settings.quality === 'low' ? 512 : settings.quality === 'high' ? 2048 : 1024);
  flashlight.shadow.map?.dispose(); flashlight.shadow.map = null;
  if (scene) composer = makeComposer(scene, camera);
}
sound.setVolume(settings.vol); sound.setMusicVolume(settings.mus);

function leaveToMenu(msg) {
  disposeWorld();
  phase = 'menu'; lobby = null;
  $('#hud').classList.remove('show');
  show('menu');
  $('#menuMsg').textContent = msg || '';
  if (document.pointerLockElement) document.exitPointerLock();
  lobby3d?.setPlayers([{ id: -1, name: settings.name || 'Внучок', color: '#e74c3c', look: settings.look, ready: false }]);
  sound.setMusic('lobby');
}

// ================= мир =================
function disposeWorld() {
  if (!scene) return;
  scene = null; W = null; granny = null; grannyState = null; composer = null;
  remote.clear(); markers.length = 0; sprays.length = 0;
  vmHeld.clear();
  sound.clearEmitters();
  sound.setChase(false);
}

const TIPS = ['Бег слышно за 9 метров. Приседай — тише всего.', 'Бабка видела, куда ты спрятался? Тогда шкаф не спасёт.', 'Бросок бутылки (Q) отвлечёт бабку.', 'Под столом можно спрятаться (E).',
  'Машина в гараже заводится долго и громко.', 'В подвале есть решётка канализации. Нужны гаечный ключ и лом.', 'Скрипучие половицы темнее остальных.', 'Метка (Z) видна другу сквозь стены.'];

async function startWorld(w) {
  disposeWorld();
  phase = 'loading';
  show('loading');
  $('#loadTip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  const setP = (p) => { $('#loadBar').style.width = `${Math.round(p * 100)}%`; };
  setP(0.05);
  await preloadCharacters();
  setP(0.2);
  const sc = new THREE.Scene();
  sc.background = new THREE.Color(0x020203);
  sc.fog = new THREE.FogExp2(0x030304, w.dark ? 0.09 : 0.055);
  sc.environment = envTex;
  sc.environmentIntensity = 0.12;
  sc.add(new THREE.HemisphereLight(0x3a4050, 0x140e0a, w.dark ? 0.05 : 0.14));
  sc.add(camera);
  const house = await buildHouse(sc, map, mats, { dark: w.dark, onProgress: (p) => setP(0.2 + p * 0.75) });
  // пул фонариков других игроков (фиксированное число — без перекомпиляции шейдеров)
  const torchPool = [];
  for (let i = 0; i < 3; i++) { const s = new THREE.SpotLight(0xfff1d6, 0, 18, 0.5, 0.6, 1.2); sc.add(s, s.target); torchPool.push(s); }
  scene = sc;
  W = {
    house, doors: w.doors, exits: w.exits, items: new Map(), traps: new Map(), day: w.day, maxDays: w.maxDays, ai: w.ai, time: 0, torchPool,
  };
  w.doors.forEach((d, i) => house.setDoor(i, d.open, d.lock));
  house.setExits(w.exits);
  house.setCreaky(w.creaky);
  for (const it of w.items) upsertItem(it);
  for (const t of w.traps) addTrap(t);
  if (w.ai) { granny = new Character('granny'); sc.add(granny.root); }
  // фоновые источники звука
  for (const L of [-1, 0, 1]) for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const c = charAt(map, L, x, y), p = cellCenter(x, y), pos = new THREE.Vector3(p.x, L * FLOOR_H + 1, p.z);
    if (c === 'M') sound.addEmitter('clock', pos);
    if (c === 'E') sound.addEmitter('fire', pos);
    if (c === 'C' && map.rooms[map.roomAt(L, x, y)]?.name === 'Котельная' && x === 17) sound.addEmitter('boiler', pos);
  }
  Object.assign(me, { level: w.you.level, x: w.you.x, z: w.you.z, y: heightAt(map, w.you.level, w.you.x, w.you.z), yaw: w.you.yaw, pitch: 0, hidden: null, state: 'alive', held: null, trappedUntil: 0, stamina: 1 });
  composer = makeComposer(sc, camera);
  setP(1);
  phase = 'playing';
  show(null);
  $('#hud').classList.add('show');
  $('#dayMax').textContent = w.maxDays;
  setDay(w.day);
  updateHeld(); updateObjectives();
  fade(true, `ДЕНЬ ${w.day}`, 'Выберитесь из дома. Не шумите.');
  sound.play('day');
  sound.setMusic('game');
  setTimeout(() => fade(false), 2400);
  lockPointer();
}

function itemY(it) { return it.lv * FLOOR_H + 0.01; }
function upsertItem(it) {
  let rec = W.items.get(it.id);
  if (!rec) {
    const info = ITEMS[it.type];
    const model = createItem(info.model, info.color);
    model.traverse(o => { if (o.isMesh) o.userData.interact = { kind: 'item', id: it.id }; });
    rec = { data: it, model };
    W.items.set(it.id, rec);
  }
  rec.data = it;
  const m = rec.model;
  m.parent?.remove(m);
  if (it.holder === null) {
    m.position.set(it.x, itemY(it), it.z);
    m.rotation.set(0, (it.id * 1.7) % 6.28, 0);
    m.scale.setScalar(1);
    m.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    scene.add(m);
  } else if (it.holder === me.id) {
    m.position.set(0, 0, 0); m.rotation.set(0.35, 0.8, 0.1);
    const big = it.type === 'fuel' ? 0.55 : it.type === 'crowbar' ? 0.8 : 1.4;
    m.scale.setScalar(big);
    noShadow(m);
    vmHeld.add(m);
  } else {
    const r = remote.get(it.holder);
    if (r?.ch.heldSlot) { m.position.set(0, 0, 0); m.rotation.set(0, 0, Math.PI / 2); m.scale.setScalar(1); r.ch.heldSlot.add(m); }
  }
  if (it.holder === me.id) me.held = it.id; else if (me.held === it.id) me.held = null;
  updateHeld();
}
function removeItem(id) { const rec = W?.items.get(id); if (!rec) return; rec.model.parent?.remove(rec.model); W.items.delete(id); if (me.held === id) me.held = null; updateHeld(); }
function addTrap(t) { const m = createTrap(); m.position.set(t.x, t.level * FLOOR_H, t.z); m.traverse(o => { if (o.isMesh) { o.castShadow = true; } }); scene.add(m); W.traps.set(t.id, m); }
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
  const ex = W.exits;
  const block = (key) => {
    const spec = EXITS[key], st = ex[key];
    const rows = Object.entries(spec.locks).map(([k, l]) => `<div class="${st[k] ? '' : 'done'}">${st[k] ? '☐' : '☑'} ${l.name} — ${ITEMS[l.item].short}</div>`).join('');
    const ready = Object.keys(spec.locks).every(k => !st[k]);
    return `<div class="ex ${ready ? 'ready' : ''}"><b>${spec.name}${ready ? ' — готово!' : ''}</b>${rows}</div>`;
  };
  el.innerHTML = '<div class="t">ПУТИ НАРУЖУ</div>' + block('front') + block('car') + block('sewer') + '<div class="t">Tab — скрыть</div>';
}

// ================= события =================
function feed(text, color) {
  const d = document.createElement('div'); d.textContent = text; if (color) d.style.color = color;
  $('#feed').appendChild(d); setTimeout(() => d.remove(), 5000);
}
function addChat(m) {
  const d = document.createElement('div');
  if (m.sys) { d.className = 'sys'; d.textContent = m.text; } else { d.innerHTML = `<b style="color:${esc(m.color)}">${esc(m.from)}:</b> ${esc(m.text)}`; sound.play('chat'); }
  const log = $('#chatLog'); log.appendChild(d); while (log.children.length > 8) log.firstChild.remove();
}
const nameOf = (id) => lobby?.players.find(p => p.id === id)?.name || 'Игрок';
const colorOf = (id) => lobby?.players.find(p => p.id === id)?.color || '#fff';
const lookOf = (id) => lobby?.players.find(p => p.id === id)?.look || 'm';
const at = (m, dy = 1.1) => (m.x !== undefined ? { x: m.x, y: (m.lv ?? me.level) * FLOOR_H + dy, z: m.z } : null);

function onEvent(m) {
  if (!W && m.e !== 'end') return;
  switch (m.e) {
    case 'door': {
      W.doors[m.id].open = m.open; W.doors[m.id].lock = m.lock;
      W.house.setDoor(m.id, m.open, m.lock);
      const d = map.doors[m.id];
      if (d.kind === 'garage') sound.play('crash', at(m));
      else if (d.kind === 'grate') sound.play('grate', at(m, 0.2));
      else sound.play(m.open ? 'door' : 'doorClose', at(m));
      break;
    }
    case 'unlock': { const d = map.doors[m.id]; sound.play('unlock', at({ ...cellCenter(d.x, d.y), lv: d.level })); break; }
    case 'locked': sound.play('locked', at(m)); break;
    case 'item': upsertItem(m.item); if (m.sound) sound.play(m.sound === 'thud' && ['wrench', 'crowbar', 'hammer', 'pliers'].includes(m.item.type) ? 'metal' : m.sound, at({ ...m.item, lv: m.item.lv }, 0.1)); break;
    case 'itemGone': removeItem(m.id); break;
    case 'msg': feed(m.text); break;
    case 'creak': sound.play('creak', at(m, 0.1)); break;
    case 'glass': sound.play('glass', at(m, 0.2)); break;
    case 'trapSet': addTrap(m.trap); break;
    case 'trap': {
      const t = W.traps.get(m.trap); if (t) { scene.remove(t); W.traps.delete(m.trap); }
      sound.play('trap', at(m, 0.1));
      if (m.id === me.id) { me.trappedUntil = performance.now() / 1000 + m.until; me.x = m.x; me.z = m.z; $('#trapOverlay').classList.add('show'); flashRed(); }
      else feed(`${nameOf(m.id)} попал(а) в капкан!`, colorOf(m.id));
      break;
    }
    case 'exitLock':
      W.exits = m.exits; W.house.setExits(m.exits);
      sound.play({ boards: 'boards', chain: 'chain', bolts: 'bolts', grate: 'grate', fuel: 'drop' }[m.lock] || 'unlock', at(m));
      updateObjectives();
      break;
    case 'carStart':
      carStartUntil = performance.now() / 1000 + m.dur; carStartDur = m.dur;
      sound.play('carCrank', at(m, 0.7), { dur: m.dur });
      $('#carOverlay').classList.add('show');
      break;
    case 'carStall': carStartUntil = 0; $('#carOverlay').classList.remove('show'); sound.play('carStall', at(m, 0.7)); break;
    case 'spray':
      sound.play('spray', at(m, 1.4)); sprayCloud(m);
      if (m.id === me.id) { const rec = W.items.get(m.itemId); if (rec) { rec.data.charges = m.charges; updateHeld(); } }
      break;
    case 'stunned': sound.play('stun', at(m, 1.5)); feed('Бабка ослеплена!', '#f1c40f'); break;
    case 'angry': sound.play('angry', at(m, 1.5)); break;
    case 'spotted': sound.play('spotted', at(m, 1.5)); if (m.id === me.id) { feed('Она тебя видит! БЕГИ!', '#e74c3c'); flashRed(); } else feed(`Бабка заметила ${nameOf(m.id)}!`, '#e74c3c'); break;
    case 'hear': sound.play('hear', at(m, 1.5)); break;
    case 'swing': sound.play('swing', at(m, 1.5)); break;
    case 'pull': { const s = map.hides[m.spot]; sound.play('pull', at({ ...cellCenter(s.x, s.y), lv: s.level })); break; }
    case 'hide':
      if (m.id === me.id) {
        if (m.on) enterHide(m.spot);
        else { me.hidden = null; me.level = m.lv; me.x = m.x; me.z = m.z; me.y = heightAt(map, me.level, me.x, me.z); $('#hideOverlay').className = ''; }
      }
      break;
    case 'caught': {
      sound.play('hit');
      if (m.id === me.id) {
        me.state = 'knocked'; me.hidden = null; $('#hideOverlay').className = ''; flashRed();
        setTimeout(() => fade(true, m.over ? 'КОНЕЦ' : `ДЕНЬ ${m.day}`, m.over ? 'Бабка победила…' : 'Бабка поймала тебя. Ты очнулся в спальне.'), 300);
        sound.play('day');
      } else feed(`Бабка поймала ${m.name}! Наступает день ${m.day}.`, '#e74c3c');
      setDay(m.day);
      break;
    }
    case 'respawn':
      setDay(m.day);
      if (m.id === me.id) { me.state = 'alive'; me.level = m.lv; me.x = m.x; me.z = m.z; me.y = heightAt(map, me.level, me.x, me.z); me.yaw = 0; me.pitch = 0; setTimeout(() => fade(false), 400); }
      break;
    case 'correct': me.x = m.x; me.z = m.z; if (Number.isInteger(m.lv)) me.level = m.lv; me.y = heightAt(map, me.level, me.x, me.z); break;
    case 'marker': addMarker(m); break;
    case 'end': showEnd(m); break;
  }
}

// точка камеры в укрытии
function hideCam(spotId) {
  const s = map.hides[spotId];
  const c = cellCenter(s.x, s.y), e = cellCenter(s.exit.x, s.exit.y);
  const y0 = s.level * FLOOR_H;
  const k = { wardrobe: 0.12, bed: 0.35, table: 0.25, bath: 0.1 }[s.type];
  const h = { wardrobe: 1.5, bed: 0.28, table: 0.5, bath: 0.62 }[s.type];
  return { x: c.x + (e.x - c.x) * k, y: y0 + h, z: c.z + (e.z - c.z) * k, yaw: Math.atan2(-(e.x - c.x), -(e.z - c.z)), type: s.type };
}
function enterHide(spotId) {
  me.hidden = spotId;
  const hc = hideCam(spotId);
  $('#hideOverlay').className = hc.type;
  me.yaw = hc.yaw; me.pitch = 0;
}

function fade(on, text = '', sub = '') { const f = $('#fade'); if (on) { $('#fadeText').textContent = text; $('#fadeSub').textContent = sub; } f.classList.toggle('show', on); }
function flashRed() { const v = $('#dangerVignette'); v.style.opacity = 1; setTimeout(() => { v.style.opacity = ''; }, 350); }

function showEnd(m) {
  phase = 'ended';
  if (document.pointerLockElement) document.exitPointerLock();
  fade(false); $('#hud').classList.remove('show'); show('end');
  $('#carOverlay').classList.remove('show');
  const win = m.result === 'win';
  $('#endTitle').textContent = win ? 'ВЫ СБЕЖАЛИ!' : 'БАБКА ПОБЕДИЛА';
  $('#endTitle').style.color = win ? '#2ecc71' : '';
  const via = { front: 'через входную дверь', car: 'на машине, вышибив ворота гаража', sewer: 'через канализацию' }[m.via] || '';
  const mm = Math.floor(m.time / 60), ss = String(m.time % 60).padStart(2, '0');
  $('#endText').textContent = (win ? `${m.by} выбрался(ась) ${via}. ` : 'Пять дней прошли. Дом не отпустил вас. ') + `Время: ${mm}:${ss} · День: ${m.day} · Сложность: ${m.difficulty}`;
  $('#endStats').innerHTML = m.stats.map(s => `<li><i style="background:${s.color}"></i>${esc(s.name)}<span class="tag">пойман(а): ${s.catches}</span></li>`).join('');
  $('#toLobbyBtn').style.display = me.host ? '' : 'none';
  $('#endHint').textContent = me.host ? '' : 'Ждём, пока хост вернёт всех в лобби…';
  sound.setChase(false); sound.setMusic('lobby');
  sound.play(win ? 'escape' : 'day');
}

// ---------- эффекты ----------
function sprayCloud(m) {
  const p = m.id === me.id ? { x: me.x, z: me.z, yaw: me.yaw, y: me.y } : remote.get(m.id) || { x: m.x, z: m.z, yaw: 0, y: (m.lv || 0) * FLOOR_H };
  const mat = new THREE.SpriteMaterial({ color: 0xffb070, transparent: true, opacity: 0.5, depthWrite: false });
  for (let i = 0; i < 18; i++) {
    const s = new THREE.Sprite(mat.clone());
    const d = 0.3 + i * 0.3, spread = (Math.random() - 0.5) * 0.4;
    s.position.set(p.x - Math.sin(p.yaw + spread) * 0.3, (p.y || 0) + 1.4, p.z - Math.cos(p.yaw + spread) * 0.3);
    s.userData = { vx: -Math.sin(p.yaw + spread) * (3 + d), vz: -Math.cos(p.yaw + spread) * (3 + d), life: 0.9 };
    s.scale.setScalar(0.2);
    scene.add(s); sprays.push(s);
  }
}
function updateEffects(dt) {
  for (let i = sprays.length - 1; i >= 0; i--) {
    const s = sprays[i]; s.userData.life -= dt;
    s.position.x += s.userData.vx * dt; s.position.z += s.userData.vz * dt; s.userData.vx *= 0.9; s.userData.vz *= 0.9;
    s.scale.setScalar(0.2 + (0.9 - s.userData.life) * 1.5); s.material.opacity = Math.max(0, s.userData.life * 0.55);
    if (s.userData.life <= 0) { scene.remove(s); sprays.splice(i, 1); }
  }
  for (let i = markers.length - 1; i >= 0; i--) {
    const mk = markers[i]; mk.life -= dt;
    mk.sprite.material.opacity = Math.min(1, mk.life); mk.sprite.position.y = mk.y + Math.sin(mk.life * 4) * 0.05;
    if (mk.life <= 0) { scene.remove(mk.sprite); markers.splice(i, 1); }
  }
}
function addMarker(m) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = colorOf(m.id); g.lineWidth = 6;
  g.beginPath(); g.moveTo(32, 58); g.lineTo(10, 18); g.arc(32, 22, 22, Math.PI * 0.85, Math.PI * 0.15); g.closePath(); g.stroke();
  g.fillStyle = colorOf(m.id); g.beginPath(); g.arc(32, 22, 8, 0, 7); g.fill();
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.setScalar(0.45); s.renderOrder = 11; s.position.set(m.x, m.y + 0.35, m.z);
  scene.add(s); markers.push({ sprite: s, life: 6, y: m.y + 0.35 });
  sound.play('marker', { x: m.x, y: m.y, z: m.z });
  if (m.id !== me.id) feed(`${nameOf(m.id)} поставил(а) метку`, colorOf(m.id));
}

function nameTag(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,0.55)'; const w = Math.min(250, g.measureText(text).width + 24); g.fillRect(128 - w / 2, 12, w, 40);
  g.fillStyle = color; g.fillText(text, 128, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(0.9, 0.23, 1); s.renderOrder = 10;
  return s;
}

// ================= снапшоты =================
function onSnap(m) {
  if (!W) return;
  if (m.day !== W.day) setDay(m.day);
  const seen = new Set();
  for (const p of m.players) {
    if (p.id === me.id) { if (p.hid !== me.hidden && p.hid !== null && me.hidden === null) enterHide(p.hid); continue; }
    seen.add(p.id);
    let r = remote.get(p.id);
    if (!r || r.look !== p.look) {
      if (r) { scene.remove(r.ch.root); scene.remove(r.tag); }
      const ch = new Character(p.look === 'f' ? 'f' : 'm', colorOf(p.id));
      scene.add(ch.root);
      const tag = nameTag(nameOf(p.id), colorOf(p.id)); scene.add(tag);
      r = { ch, tag, look: p.look, x: p.x, z: p.z, y: p.y, yaw: p.yaw, st: p, speed: 0, px: p.x, pz: p.z, stepAcc: 0, light: W.torchPool[remote.size % 3] };
      remote.set(p.id, r);
      for (const rec of W.items.values()) if (rec.data.holder === p.id) upsertItem(rec.data);
    }
    r.st = p;
  }
  for (const [id, r] of remote) if (!seen.has(id)) { scene.remove(r.ch.root); scene.remove(r.tag); if (r.light) r.light.intensity = 0; remote.delete(id); }
  grannyState = m.ai;
}

// ================= ввод =================
function lockPointer() { try { const p = renderer.domElement.requestPointerLock?.(); p?.catch?.(() => {}); } catch { /* ignore */ } }
document.addEventListener('pointerlockchange', () => { const locked = document.pointerLockElement === renderer.domElement; if (phase === 'playing') show(locked || chatting ? null : 'clickToPlay'); });
renderer.domElement.addEventListener('click', () => { if (phase === 'playing') lockPointer(); });
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement || phase !== 'playing') return;
  const k = 0.0022 * settings.sens;
  me.yaw -= e.movementX * k;
  me.pitch = Math.max(-1.45, Math.min(1.45, me.pitch - e.movementY * k));
});
document.addEventListener('mousedown', (e) => { if (phase === 'playing' && document.pointerLockElement === renderer.domElement && e.button === 0) send({ t: 'use' }); });
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
function openChat() { chatting = true; $('#hud').classList.add('chatting'); keys.clear(); setTimeout(() => $('#chatInput').focus(), 0); }
function closeChat() { chatting = false; $('#chatInput').value = ''; $('#chatInput').blur(); $('#hud').classList.remove('chatting'); if (document.pointerLockElement !== renderer.domElement) show('clickToPlay'); }

// ---------- взаимодействие ----------
const ray = new THREE.Raycaster();
const center = new THREE.Vector2(0, 0);
let target = null;
function visibleOnGrid(x, z) { return lineOfSight(map, W.doors, me.level, me.x, me.z, x, z); }
function findTarget() {
  if (!W || me.hidden !== null || me.state !== 'alive') return null;
  ray.setFromCamera(center, camera);
  ray.far = 2.6;
  const objs = W.house.interactables.filter(o => { const p = o.getWorldPosition(_v); return Math.abs(p.y - camera.position.y) < 3 && p.distanceToSquared(camera.position) < 16; });
  for (const rec of W.items.values()) if (rec.data.holder === null && rec.data.lv === me.level) objs.push(rec.model);
  const hits = ray.intersectObjects(objs, true);
  for (const h of hits) {
    let o = h.object; while (o && !o.userData.interact) o = o.parent;
    if (!o) continue;
    // не сквозь стены (проверяем по сетке)
    if (!visibleOnGrid(h.point.x - Math.sign(h.point.x - me.x) * 0.3, h.point.z - Math.sign(h.point.z - me.z) * 0.3) && o.userData.interact.kind !== 'door') continue;
    return { ...o.userData.interact, dist: h.distance };
  }
  // предметы на полу — ближайший в конусе взгляда
  let best = null, bestScore = 0.95;
  const f = new THREE.Vector3(); camera.getWorldDirection(f);
  for (const rec of W.items.values()) {
    if (rec.data.holder !== null || rec.data.lv !== me.level) continue;
    const v = new THREE.Vector3(rec.data.x - camera.position.x, itemY(rec.data) - camera.position.y, rec.data.z - camera.position.z);
    const d = v.length(); if (d > 2.4) continue;
    const score = v.normalize().dot(f);
    if (score > bestScore && visibleOnGrid(rec.data.x, rec.data.z)) { bestScore = score; best = { kind: 'item', id: rec.data.id, dist: d }; }
  }
  // машина — если рядом
  if (!best && map.car && me.level === map.car.level && Math.hypot(me.x - map.car.cx, me.z - map.car.cz) < 3.2) {
    const v = new THREE.Vector3(map.car.cx - camera.position.x, 0, map.car.cz - camera.position.z).normalize();
    if (v.dot(new THREE.Vector3(f.x, 0, f.z).normalize()) > 0.6) best = { kind: 'car', id: 0 };
  }
  return best;
}
const _v = new THREE.Vector3();

function exitPrompt(key) {
  const spec = EXITS[key], st = W.exits[key];
  const held = me.held && W.items.get(me.held)?.data;
  const left = Object.keys(spec.locks).filter(k => st[k]);
  if (!left.length) return null;
  const use = held && left.find(k => spec.locks[k].item === held.type);
  if (use) return `E — ${spec.locks[use].name}: использовать «${ITEMS[held.type].short}»`;
  return `${spec.name}. Нужно: ` + left.map(k => ITEMS[spec.locks[k].item].short).join(', ');
}
function promptFor(t) {
  if (me.hidden !== null) return 'E — вылезти';
  if (!t) return '';
  const held = me.held && W.items.get(me.held)?.data;
  if (t.kind === 'item') { const it = W.items.get(t.id)?.data; return it ? `E — ${held ? 'поменять на' : 'взять'}: ${ITEMS[it.type].name}` : ''; }
  if (t.kind === 'hide') return { bed: 'E — залезть под кровать', table: 'E — спрятаться под стол', bath: 'E — спрятаться в ванне за шторкой', wardrobe: 'E — спрятаться в шкаф' }[map.hides[t.id].type];
  if (t.kind === 'car') { if (W.exits.car.starting) return 'Машина заводится!'; return exitPrompt('car') || 'E — ЗАВЕСТИ МАШИНУ (громко!)'; }
  if (t.kind === 'door') {
    const d = map.doors[t.id], ds = W.doors[t.id];
    if (d.kind === 'front') return exitPrompt('front') || (ds.open ? 'Беги во двор!' : 'E — открыть входную дверь');
    if (d.kind === 'grate') return exitPrompt('sewer') || (ds.open ? 'E — спуститься в канализацию' : 'E — поднять решётку');
    if (d.kind === 'garage') return 'Ворота гаража. Их откроет только машина';
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
  ray.setFromCamera(center, camera); ray.far = 30;
  const objs = W.house.root.children.filter(o => o.isMesh && o.geometry.attributes.position.count < 60000);
  const p = ray.intersectObjects(objs, false)[0]?.point;
  if (p) send({ t: 'ping_loc', x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) });
}

// ================= цикл =================
const clock = new THREE.Clock();
function surfaceAt(L, x, z) {
  const r = map.rooms[map.roomAt(L, toCell(x), toCell(z))];
  if (!r) return L < 0 ? 'concrete' : 'wood';
  if (r.name === 'Двор') return 'grass';
  if (r.level < 0 || r.name === 'Гараж' || r.name === 'Дорога') return 'concrete';
  if (['Кухня', 'Ванная', 'Ванная наверху'].includes(r.name)) return 'tile';
  return 'wood';
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  if (phase !== 'playing' && phase !== 'loading' || !scene || !W) {
    // меню / лобби / конец — 3D-двор
    if (!lobby3d && charactersReady()) { lobby3d = new Lobby3D(mats); lobby3d.resize(innerWidth, innerHeight); lobby3d.setPlayers([{ id: -1, name: settings.name || 'Внучок', color: '#e74c3c', look: settings.look, ready: false }]); }
    if (lobby3d) { lobby3d.update(dt); renderer.render(lobby3d.scene, lobby3d.camera); }
    return;
  }
  const now = performance.now() / 1000;
  W.time += dt;
  updateMe(dt, now);
  updateRemotes(dt);
  updateGranny(dt);
  W.house.update(dt, camera.position, me.level);
  updateEffects(dt);
  for (const rec of W.items.values()) if (rec.data.holder === null) rec.model.position.y = itemY(rec.data) + Math.max(0, Math.sin(W.time * 2 + rec.data.id)) * 0.004;
  target = findTarget();
  $('#prompt').textContent = me.state === 'alive' ? promptFor(target) : '';
  $('#crosshair').classList.toggle('active', !!target);
  sound.setListener(camera);
  sound.setSpace(me.level < 0 ? 'basement' : map.rooms[map.roomAt(me.level, toCell(me.x), toCell(me.z))]?.outside ? 'outside' : 'house');
  $('#floorName').textContent = { '-1': 'Подвал', '0': '1 этаж', '1': '2 этаж' }[me.level] + ' · ' + (map.rooms[map.roomAt(me.level, toCell(me.x), toCell(me.z))]?.name || '');
  if (carStartUntil) {
    const k = 1 - Math.max(0, carStartUntil - now) / carStartDur;
    $('#carBar').style.width = `${Math.min(100, k * 100)}%`;
    if (k >= 1) { carStartUntil = 0; $('#carOverlay').classList.remove('show'); }
  }
  if (now - lastSend > 0.05 && me.state === 'alive') {
    lastSend = now;
    send({ t: 'st', lv: me.level, x: +me.x.toFixed(3), z: +me.z.toFixed(3), yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3), cr: !!me.crouchSent, run: me.run, mv: me.moving, fl: me.flash });
  }
  composer.render();
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
  const moving = (fx || fz) !== 0;
  me.run = moving && (keys.has('ShiftLeft') || keys.has('ShiftRight')) && !crouch && me.stamina > 0.02 && !me.exhausted;
  if (me.run) me.stamina = Math.max(0, me.stamina - dt / 5.5); else me.stamina = Math.min(1, me.stamina + dt / (moving ? 9 : 5));
  if (me.stamina <= 0.02) me.exhausted = true;
  if (me.exhausted && me.stamina > 0.35) me.exhausted = false;
  const speed = crouch ? 1.35 : me.run ? 4.4 : 2.6;
  me.moving = moving; me.crouchSent = crouch;
  if (moving) {
    const len = Math.hypot(fx, fz); fx /= len; fz /= len;
    const s = Math.sin(me.yaw), c = Math.cos(me.yaw);
    const n = moveEntity(map, W.doors, me, (fx * c + fz * s) * speed * dt, (-fx * s + fz * c) * speed * dt);
    const moved = Math.hypot(n.x - me.x, n.z - me.z);
    me.level = n.level; me.x = n.x; me.z = n.z; me.y = n.y;
    me.bob += moved * (me.run ? 2.2 : 2.8);
    me.stepAcc += moved;
    if (me.stepAcc > (me.run ? 1.1 : 0.75) && !crouch) { me.stepAcc = 0; sound.step({ x: me.x, y: me.y + 0.05, z: me.z }, surfaceAt(me.level, me.x, me.z), { run: me.run }); }
  } else me.y = heightAt(map, me.level, me.x, me.z);
  me.crouchK += ((crouch ? 1 : 0) - me.crouchK) * Math.min(1, dt * 10);
  const bar = $('#staminaBar');
  bar.classList.toggle('show', me.stamina < 0.99); bar.classList.toggle('low', !!me.exhausted);
  bar.firstElementChild.style.width = `${me.stamina * 100}%`;
  if (me.hidden !== null) { const hc = hideCam(me.hidden); camera.position.set(hc.x, hc.y, hc.z); }
  else {
    const eye = 1.62 - me.crouchK * 0.72;
    const bobY = moving && canMove ? Math.sin(me.bob * 2) * 0.035 : Math.sin(now * 1.6) * 0.004;
    camera.position.set(me.x, me.y + eye + bobY, me.z);
  }
  if (me.state === 'knocked') camera.position.y = me.y + 0.35;
  const sway = moving && canMove ? Math.sin(me.bob) * 0.006 : 0;
  camera.rotation.set(me.pitch, me.yaw, trapped ? Math.sin(now * 40) * 0.012 : sway);
  flashlight.intensity = me.flash ? 14 : 0;
  vmTorch.userData.lens.material.color.set(me.flash ? 0xfff2d0 : 0x333333);
  viewModel.position.set(moving ? Math.sin(me.bob) * 0.008 : 0, (moving ? Math.abs(Math.sin(me.bob)) * -0.012 : 0) - me.crouchK * 0.02, 0);
  viewModel.visible = me.hidden === null && me.state === 'alive';
}

function updateRemotes(dt) {
  let li = 0;
  for (const r of remote.values()) {
    const st = r.st, k = Math.min(1, dt * 12);
    const px = r.x, pz = r.z;
    if (Math.hypot(st.x - r.x, st.z - r.z) > 3) { r.x = st.x; r.z = st.z; }
    r.x += (st.x - r.x) * k; r.z += (st.z - r.z) * k; r.y = r.y + ((st.y ?? 0) - (r.y ?? 0)) * k;
    let dy = st.yaw - r.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    r.yaw += dy * k;
    const moved = Math.hypot(r.x - px, r.z - pz);
    r.speed += ((moved / Math.max(dt, 1e-3)) - r.speed) * Math.min(1, dt * 6);
    r.ch.root.position.set(r.x, r.y, r.z);
    r.ch.root.rotation.y = r.yaw;
    const vis = st.hid === null && st.st === 'alive';
    r.ch.root.visible = vis;
    r.ch.update(dt, { speed: r.speed, run: st.run, crouch: st.cr, holdLight: true, holdItem: !!st.held, lookPitch: st.pitch, action: st.tr ? 'trapped' : null });
    r.tag.position.set(r.x, r.y + (st.cr ? 1.35 : 2.05), r.z); r.tag.visible = vis;
    const L = W.torchPool[li++];
    if (L) {
      L.intensity = st.fl && vis ? 9 : 0;
      r.ch.torch?.getWorldPosition(L.position);
      L.target.position.set(r.x - Math.sin(r.yaw) * 4 * Math.cos(st.pitch), r.y + 1.4 + Math.sin(st.pitch) * 4, r.z - Math.cos(r.yaw) * 4 * Math.cos(st.pitch));
    }
    r.stepAcc += moved;
    if (r.stepAcc > (st.run ? 1.1 : 0.75)) { r.stepAcc = 0; if (!st.cr && vis) sound.step({ x: r.x, y: r.y + 0.05, z: r.z }, surfaceAt(st.lv, r.x, r.z), { run: st.run }); }
  }
  for (; li < W.torchPool.length; li++) W.torchPool[li].intensity = 0;
}

let humT = 8;
function updateGranny(dt) {
  if (!granny || !grannyState) { sound.update(dt, 0, camera.position); return; }
  const g = grannyState;
  const root = granny.root;
  const px = root.position.x, pz = root.position.z;
  if (!grannyPrev || Math.hypot(g.x - px, g.z - pz) > 4) root.position.set(g.x, g.y, g.z);
  grannyPrev = g;
  const k = Math.min(1, dt * 10);
  root.position.x += (g.x - root.position.x) * k; root.position.z += (g.z - root.position.z) * k; root.position.y += (g.y - root.position.y) * k;
  let dy = g.yaw - root.rotation.y; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
  root.rotation.y += dy * k;
  const moved = Math.hypot(root.position.x - px, root.position.z - pz);
  granny.speed = (granny.speed || 0) + ((moved / Math.max(dt, 1e-3)) - (granny.speed || 0)) * Math.min(1, dt * 6);
  const chase = g.st === 'chase' || g.st === 'attack';
  // взгляд на ближайшего видимого игрока
  let lookYaw = 0;
  if (chase) { const dx = me.x - g.x, dz = me.z - g.z; lookYaw = Math.atan2(-dx, -dz) - root.rotation.y; while (lookYaw > Math.PI) lookYaw -= 2 * Math.PI; while (lookYaw < -Math.PI) lookYaw += 2 * Math.PI; }
  granny.update(dt, {
    speed: granny.speed, run: g.an === 'run', angry: chase, stunned: g.st === 'stunned',
    action: g.an === 'attack' ? 'attack' : g.an === 'open' ? 'open' : null, lookYaw: Math.max(-1, Math.min(1, lookYaw)), lookPitch: 0,
  });
  granny.stepAcc = (granny.stepAcc || 0) + moved;
  if (granny.stepAcc > 0.7 && moved < 1) { granny.stepAcc = 0; sound.step({ x: root.position.x, y: root.position.y + 0.05, z: root.position.z }, surfaceAt(g.lv, g.x, g.z), { heavy: true }); }
  sound.setChase(chase);
  const d = Math.hypot(g.x - me.x, g.z - me.z) + Math.abs(g.lv - me.level) * 6;
  humT -= dt;
  if (humT <= 0) { humT = 14 + Math.random() * 10; if ((g.st === 'patrol' || g.st === 'look') && d < 16) sound.hum({ x: g.x, y: g.y + 1.5, z: g.z }); }
  const inten = me.state !== 'alive' ? 0 : Math.max(0, 1 - d / 11) * (chase ? 1 : 0.6) + (chase && d < 18 ? 0.3 : 0);
  sound.update(dt, Math.min(1, inten), camera.position);
  $('#dangerVignette').style.opacity = chase && d < 8 ? String((1 - d / 8) * 0.8) : '';
}

// плёночное зерно
{
  const c = $('#grain'), g = c.getContext('2d');
  c.width = 240; c.height = 135;
  const img = g.createImageData(c.width, c.height);
  setInterval(() => {
    if (phase !== 'playing') return;
    for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0);
  }, 90);
}

preloadCharacters().then(() => { if (lobby3d) return; }).catch(e => console.error(e));
requestAnimationFrame(frame);
show('menu');
for (const b of document.querySelectorAll('#lookSeg button')) b.classList.toggle('on', b.dataset.look === settings.look);
window.__babka = { me, renderer, get W() { return W; }, get phase() { return phase; }, get ai() { return grannyState; }, send, camera, get scene() { return scene; } };
void blocksSight;
