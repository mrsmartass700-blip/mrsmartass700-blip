// Серверная логика комнаты: лобби, мир, игроки, предметы, двери, дни.
import {
  buildMap, cellCenter, toCell, CELL, ITEMS, EXIT_LOCKS, DIFFICULTIES, MAX_DAYS,
  lineOfSight, blocksPlayer,
} from '../shared/map.js';
import { Granny } from './ai.js';

const TICK = 1 / 20;
const MAX_PLAYERS = 4;
const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f'];
const INTERACT_R = 2.6;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

export class Game {
  constructor({ addresses = [], port = 0 } = {}) {
    this.map = buildMap();
    this.addresses = addresses;
    this.port = port;
    this.players = new Map();
    this.nextId = 1;
    this.phase = 'lobby';
    this.difficulty = 'normal';
    this.hostId = null;
    this.t0 = Date.now();
    this.resetWorld();
    this.timer = setInterval(() => this.tick(), TICK * 1000);
  }

  now() { return (Date.now() - this.t0) / 1000; }
  get cfg() { return DIFFICULTIES[this.difficulty]; }

  stop() { clearInterval(this.timer); clearTimeout(this.lobbyTimer); }

  // ================= соединения =================
  onConnection(ws) {
    let player = null;
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m.t !== 'string') return;
      if (m.t === 'ping') { ws.send(JSON.stringify({ t: 'pong', c: m.c })); return; }
      if (!player) {
        if (m.t !== 'hello') return;
        if (this.players.size >= MAX_PLAYERS) { ws.send(JSON.stringify({ t: 'full' })); ws.close(); return; }
        player = this.addPlayer(ws, m.name);
        return;
      }
      this.handle(player, m);
    });
    ws.on('close', () => { if (player) this.removePlayer(player); });
  }

  addPlayer(ws, name) {
    const id = this.nextId++;
    const used = new Set([...this.players.values()].map(p => p.color));
    const p = {
      id, ws, name: clean(name, 16) || `Игрок ${id}`, color: COLORS.find(c => !used.has(c)) || '#fff',
      ready: false, x: 0, z: 0, yaw: 0, pitch: 0, crouch: false, run: false, moving: false, flash: true,
      state: 'alive', hidden: null, held: null, trappedUntil: 0, noiseAt: 0, lastCell: -1,
      catches: 0,
    };
    this.players.set(id, p);
    if (!this.hostId) this.hostId = id;
    this.send(p, { t: 'welcome', id, host: this.hostId === id });
    this.chatSys(`${p.name} подключился`);
    if (this.phase === 'playing') {
      this.spawnPlayer(p);
      this.send(p, { t: 'start', world: this.worldState(p) });
    }
    this.broadcastLobby();
    return p;
  }

  removePlayer(p) {
    if (!this.players.has(p.id)) return;
    if (this.phase === 'playing') this.dropHeld(p, p.x, p.z);
    this.players.delete(p.id);
    if (this.hostId === p.id) this.hostId = this.players.size ? this.players.keys().next().value : null;
    this.chatSys(`${p.name} отключился`);
    if (this.players.size === 0) { this.phase = 'lobby'; this.resetWorld(); }
    else if (this.hostId) this.send(this.players.get(this.hostId), { t: 'welcome', id: this.hostId, host: true });
    this.broadcastLobby();
  }

  send(p, msg) { if (p.ws.open) p.ws.send(JSON.stringify(msg)); }
  broadcast(msg) { const s = JSON.stringify(msg); for (const p of this.players.values()) if (p.ws.open) p.ws.send(s); }
  event(ev) { this.broadcast({ t: 'ev', ...ev }); }
  chatSys(text) { this.broadcast({ t: 'chat', sys: true, text }); }

  broadcastLobby() {
    this.broadcast({
      t: 'lobby', phase: this.phase, hostId: this.hostId, difficulty: this.difficulty,
      difficulties: Object.fromEntries(Object.entries(DIFFICULTIES).map(([k, v]) => [k, v.name])),
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready })),
      addresses: this.addresses, port: this.port,
    });
  }

  // ================= сообщения =================
  handle(p, m) {
    const isHost = p.id === this.hostId;
    switch (m.t) {
      case 'ready': if (this.phase === 'lobby') { p.ready = !!m.v; this.broadcastLobby(); } break;
      case 'name': p.name = clean(m.v, 16) || p.name; this.broadcastLobby(); break;
      case 'difficulty':
        if (isHost && this.phase === 'lobby' && DIFFICULTIES[m.v]) { this.difficulty = m.v; this.broadcastLobby(); }
        break;
      case 'start':
        if (isHost && this.phase === 'lobby' && [...this.players.values()].every(q => q.ready || q.id === p.id)) this.startGame();
        break;
      case 'toLobby': if (isHost && this.phase === 'ended') this.toLobby(); break;
      case 'chat': {
        const text = clean(m.text, 200);
        if (text) this.broadcast({ t: 'chat', from: p.name, color: p.color, text });
        break;
      }
      case 'st': if (this.phase === 'playing') this.onState(p, m); break;
      case 'interact': if (this.phase === 'playing') this.onInteract(p, m); break;
      case 'unhide': if (this.phase === 'playing') this.unhide(p); break;
      case 'drop': if (this.phase === 'playing') this.onDrop(p, false); break;
      case 'throw': if (this.phase === 'playing') this.onDrop(p, true); break;
      case 'use': if (this.phase === 'playing') this.onUse(p); break;
      case 'ping_loc':
        if (this.phase === 'playing' && Number.isFinite(m.x) && Number.isFinite(m.z))
          this.event({ e: 'marker', id: p.id, x: m.x, z: m.z, y: Number.isFinite(m.y) ? m.y : 1 });
        break;
    }
  }

  // ================= мир =================
  resetWorld() {
    this.doors = this.map.doors.map(d => ({ open: false, lock: d.lock }));
    this.exitLocks = { padlock: true, boards: true, chain: true };
    this.items = [];
    this.traps = [];
    this.day = 1;
    this.pending = [];
    this.startedAt = 0;
    this.nextItemId = 1;
    this.creaky = [];
    this.ai = new Granny(this);
  }

  startGame() {
    this.resetWorld();
    this.phase = 'playing';
    this.startedAt = this.now();
    this.placeItems();
    this.placeCreaky();
    this.ai.reset(true);
    for (const p of this.players.values()) this.spawnPlayer(p);
    for (const p of this.players.values()) this.send(p, { t: 'start', world: this.worldState(p) });
    this.broadcastLobby();
    this.chatSys(`Игра началась. Сложность: ${this.cfg.name}. День 1 из ${MAX_DAYS}.`);
  }

  toLobby() {
    clearTimeout(this.lobbyTimer);
    this.phase = 'lobby';
    for (const p of this.players.values()) { p.ready = false; p.held = null; }
    this.resetWorld();
    this.broadcastLobby();
  }

  spawnPlayer(p) {
    const idx = [...this.players.keys()].indexOf(p.id);
    const c = cellCenter(this.map.playerSpawn.x, this.map.playerSpawn.y);
    const offs = [[0, 0], [0.9, 0], [0, 0.9], [0.9, 0.9]][idx % 4];
    p.x = c.x + offs[0]; p.z = c.z + offs[1]; p.yaw = 0; p.pitch = 0;
    p.state = 'alive'; p.hidden = null; p.trappedUntil = 0; p.lastCell = -1; p.held = null;
  }

  placeItems() {
    const spawns = shuffle(this.map.itemSpawns.slice());
    const roomName = (s) => this.map.rooms[s.room].name;
    const take = (pred) => {
      const i = spawns.findIndex(pred);
      return i < 0 ? spawns.shift() : spawns.splice(i, 1)[0];
    };
    const openRoom = (s) => !this.map.rooms[s.room].locked;
    const exitItems = shuffle(['padlockKey', 'hammer', 'pliers']);
    const plan = [
      ['storageKey', openRoom],
      ['studyKey', (s) => openRoom(s) || roomName(s) === 'Кладовка'],
      [exitItems[0], (s) => roomName(s) === 'Кабинет'],
      [exitItems[1], (s) => roomName(s) === 'Кладовка'],
      [exitItems[2], () => true],
      ['spray', () => true],
      ['bottle', openRoom],
      ['bottle', openRoom],
      ['teddy', () => true],
    ];
    for (const [type, pred] of plan) {
      const s = take(pred);
      const c = cellCenter(s.x, s.y);
      this.addItem(type, c.x + (Math.random() - 0.5) * 0.5, c.z + (Math.random() - 0.5) * 0.5);
    }
  }

  placeCreaky() {
    const cand = [];
    for (let y = 0; y < this.map.h; y++) for (let x = 0; x < this.map.w; x++) {
      if (this.map.grid[y][x] !== '.') continue;
      const room = this.map.rooms[this.map.roomOf[y][x]];
      if (!room || room.name === 'Спальня' || room.outside) continue;
      cand.push(y * this.map.w + x);
    }
    this.creaky = shuffle(cand).slice(0, 18);
    this.creakySet = new Set(this.creaky);
  }

  addItem(type, x, z) {
    const it = { id: this.nextItemId++, type, x, z, holder: null, charges: ITEMS[type].charges || 0 };
    this.items.push(it);
    return it;
  }

  itemView(it) { return { id: it.id, type: it.type, x: +it.x.toFixed(2), z: +it.z.toFixed(2), holder: it.holder, charges: it.charges }; }

  worldState(p) {
    return {
      you: { id: p.id, x: p.x, z: p.z, yaw: p.yaw },
      doors: this.doors, exitLocks: this.exitLocks,
      items: this.items.map(it => this.itemView(it)),
      traps: this.traps, creaky: this.creaky, day: this.day, maxDays: MAX_DAYS,
      difficulty: this.difficulty, dark: !!this.cfg.dark, ai: this.cfg.ai,
    };
  }

  // ================= тик =================
  tick() {
    if (this.phase !== 'playing') return;
    const now = this.now();
    // отложенные действия (респавн и т.п.)
    const due = this.pending.filter(a => a.at <= now);
    this.pending = this.pending.filter(a => a.at > now);
    for (const a of due) a.fn();
    if (this.phase !== 'playing') return;

    this.ai.update(TICK, now);

    this.broadcast({
      t: 'snap', time: +now.toFixed(2), day: this.day,
      ai: this.cfg.ai ? this.ai.snapshot() : null,
      players: [...this.players.values()].map(p => ({
        id: p.id, x: +p.x.toFixed(3), z: +p.z.toFixed(3), yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3),
        cr: p.crouch, fl: p.flash, mv: p.moving, run: p.run, hid: p.hidden, st: p.state, held: p.held,
        tr: p.trappedUntil > now,
      })),
    });
  }

  later(sec, fn) { this.pending.push({ at: this.now() + sec, fn }); }

  // ================= состояние игрока =================
  onState(p, m) {
    if (p.state !== 'alive') return;
    const now = this.now();
    for (const k of ['yaw', 'pitch']) if (Number.isFinite(m[k])) p[k] = m[k];
    p.crouch = !!m.cr; p.flash = !!m.fl;
    if (p.hidden !== null) { p.moving = false; return; }
    if (now < p.trappedUntil) { p.moving = false; return; }
    if (!Number.isFinite(m.x) || !Number.isFinite(m.z)) return;
    // грубая защита от телепортов/рассинхрона: не больше 3 м за пакет
    if (Math.hypot(m.x - p.x, m.z - p.z) > 3) { this.send(p, { t: 'ev', e: 'correct', x: p.x, z: p.z }); return; }
    const cx = toCell(m.x), cy = toCell(m.z);
    if (blocksPlayer(this.map, this.doors, cx, cy)) { this.send(p, { t: 'ev', e: 'correct', x: p.x, z: p.z }); return; }
    p.x = m.x; p.z = m.z;
    p.moving = !!m.mv; p.run = !!m.run && !p.crouch;

    // шум шагов
    if (p.moving && now >= p.noiseAt) {
      p.noiseAt = now + 0.45;
      const r = p.crouch ? 0 : p.run ? 9 : 3.2;
      if (r) this.ai.onNoise(p.x, p.z, r);
    }
    // скрипучие половицы
    const ci = cy * this.map.w + cx;
    if (ci !== p.lastCell) {
      p.lastCell = ci;
      if (this.creakySet?.has(ci)) {
        this.event({ e: 'creak', x: p.x, z: p.z });
        this.ai.onNoise(p.x, p.z, p.crouch ? 6 : 11);
      }
    }
    // капканы
    const trap = this.traps.find(t => Math.hypot(t.x - p.x, t.z - p.z) < 0.5);
    if (trap) {
      this.traps = this.traps.filter(t => t !== trap);
      p.trappedUntil = now + 3.5;
      p.x = trap.x; p.z = trap.z;
      this.event({ e: 'trap', id: p.id, trap: trap.id, x: trap.x, z: trap.z, until: 3.5 });
      this.ai.onNoise(trap.x, trap.z, 22);
    }
    // побег
    if (this.map.grid[cy]?.[cx] === 'O') this.endGame('win', p);
  }

  // ================= взаимодействие =================
  onInteract(p, m) {
    if (p.state !== 'alive' || p.hidden !== null || this.now() < p.trappedUntil) return;
    const id = m.id | 0;
    if (m.kind === 'door') this.interactDoor(p, id);
    else if (m.kind === 'item') this.pickup(p, id);
    else if (m.kind === 'hide') this.hide(p, id);
  }

  distTo(p, x, z) { return Math.hypot(p.x - x, p.z - z); }

  msg(p, text) { this.send(p, { t: 'ev', e: 'msg', text }); }

  interactDoor(p, id) {
    const d = this.map.doors[id];
    if (!d) return;
    const c = cellCenter(d.x, d.y);
    if (this.distTo(p, c.x, c.z) > INTERACT_R) return;
    const ds = this.doors[id];
    const held = p.held ? this.items.find(it => it.id === p.held) : null;

    if (d.exit) {
      const left = Object.keys(this.exitLocks).filter(k => this.exitLocks[k]);
      if (held) {
        const lk = left.find(k => EXIT_LOCKS[k].item === held.type);
        if (lk) {
          this.exitLocks[lk] = false;
          this.consume(p, held);
          this.event({ e: 'exitLock', lock: lk, id: p.id, x: c.x, z: c.z, exitLocks: this.exitLocks });
          this.ai.onNoise(c.x, c.z, lk === 'boards' ? 20 : 10);
          const rest = Object.keys(this.exitLocks).filter(k => this.exitLocks[k]);
          this.chatSys(`${p.name} снял(а) ${EXIT_LOCKS[lk].name} с входной двери. ` +
            (rest.length ? `Осталось: ${rest.map(k => EXIT_LOCKS[k].name).join(', ')}.` : 'Дверь можно открыть!'));
          return;
        }
      }
      if (left.length) {
        this.msg(p, `Входная дверь закрыта: ${left.map(k => `${EXIT_LOCKS[k].name} (${ITEMS[EXIT_LOCKS[k].item].short})`).join(', ')}`);
        this.event({ e: 'locked', x: c.x, z: c.z });
        return;
      }
      if (!ds.open) { this.setDoor(id, true, p.id); this.ai.onNoise(c.x, c.z, 12); }
      return;
    }

    if (ds.lock) {
      if (held && held.type === ds.lock) {
        ds.lock = null;
        this.consume(p, held);
        this.event({ e: 'unlock', id, by: p.id });
        this.setDoor(id, true, p.id);
        this.chatSys(`${p.name} отпер(ла) дверь: ${this.roomNameBehind(d)}`);
      } else {
        this.msg(p, `Заперто. Нужен: ${ITEMS[ds.lock].name}`);
        this.event({ e: 'locked', x: c.x, z: c.z });
      }
      return;
    }
    if (ds.open && this.entityInCell(d.x, d.y)) { this.msg(p, 'Что-то мешает закрыть дверь'); return; }
    this.setDoor(id, !ds.open, p.id);
    this.ai.onNoise(c.x, c.z, 3.5);
  }

  roomNameBehind(d) {
    const names = d.rooms.map(r => this.map.rooms[r]).filter(r => r && r.locked).map(r => r.name);
    return names[0] || 'комната';
  }

  setDoor(id, open, by) {
    this.doors[id].open = open;
    const d = this.map.doors[id], c = cellCenter(d.x, d.y);
    this.event({ e: 'door', id, open, lock: this.doors[id].lock, by, x: c.x, z: c.z });
  }

  entityInCell(cx, cy) {
    const x0 = cx * CELL, x1 = (cx + 1) * CELL, z0 = cy * CELL, z1 = (cy + 1) * CELL, m = 0.35;
    const inside = (x, z) => x > x0 - m && x < x1 + m && z > z0 - m && z < z1 + m;
    for (const p of this.players.values()) if (p.state === 'alive' && p.hidden === null && inside(p.x, p.z)) return true;
    if (this.cfg.ai && inside(this.ai.x, this.ai.z)) return true;
    return false;
  }

  consume(p, it) {
    this.items = this.items.filter(i => i !== it);
    p.held = null;
    this.event({ e: 'itemGone', id: it.id });
  }

  pickup(p, id) {
    const it = this.items.find(i => i.id === id && i.holder === null);
    if (!it || this.distTo(p, it.x, it.z) > INTERACT_R) return;
    if (p.held) this.dropHeld(p, it.x, it.z);
    it.holder = p.id;
    p.held = it.id;
    this.event({ e: 'item', item: this.itemView(it), sound: 'pickup' });
  }

  dropHeld(p, x, z, sound = 'drop') {
    const it = p.held ? this.items.find(i => i.id === p.held) : null;
    p.held = null;
    if (!it) return null;
    it.holder = null; it.x = x; it.z = z;
    this.event({ e: 'item', item: this.itemView(it), sound });
    return it;
  }

  // G — положить, Q — бросить (шум в месте падения отвлекает бабку)
  onDrop(p, isThrow) {
    if (p.state !== 'alive' || p.hidden !== null || !p.held) return;
    const it = this.items.find(i => i.id === p.held);
    if (!it) { p.held = null; return; }
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const maxD = isThrow ? 7 : 0.7;
    let lx = p.x, lz = p.z;
    for (let d = 0.2; d <= maxD; d += 0.2) {
      const x = p.x + fx * d, z = p.z + fz * d;
      const c = this.map.grid[toCell(z)]?.[toCell(x)];
      if (blocksPlayer(this.map, this.doors, toCell(x), toCell(z)) || c === 'O') break;
      lx = x; lz = z;
    }
    // отступ от стены, чтобы предмет можно было подобрать
    lx -= fx * 0.15; lz -= fz * 0.15;
    if (blocksPlayer(this.map, this.doors, toCell(lx), toCell(lz))) { lx = p.x; lz = p.z; }
    if (isThrow && it.type === 'bottle') {
      this.consume(p, it);
      this.event({ e: 'glass', x: lx, z: lz, from: { x: p.x, z: p.z } });
      this.ai.onNoise(lx, lz, 18);
      return;
    }
    this.dropHeld(p, lx, lz, isThrow ? 'thud' : 'drop');
    if (isThrow) this.event({ e: 'throw', id: it.id, from: { x: p.x, z: p.z } });
    this.ai.onNoise(lx, lz, isThrow ? 13 : 2.5);
  }

  onUse(p) {
    if (p.state !== 'alive' || p.hidden !== null || !p.held) return;
    const it = this.items.find(i => i.id === p.held);
    if (!it || it.type !== 'spray') return;
    it.charges--;
    this.event({ e: 'spray', id: p.id, x: p.x, z: p.z, charges: it.charges, itemId: it.id });
    if (this.cfg.ai && this.ai.state !== 'stunned') {
      const dx = this.ai.x - p.x, dz = this.ai.z - p.z, d = Math.hypot(dx, dz);
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      const dot = d > 0 ? (dx * fx + dz * fz) / d : 1;
      if (d < 5 && dot > 0.82 && lineOfSight(this.map, this.doors, p.x, p.z, this.ai.x, this.ai.z)) {
        this.ai.onSprayed(p.x, p.z);
        this.event({ e: 'stunned', by: p.id, x: this.ai.x, z: this.ai.z, dur: this.cfg.stun });
        this.chatSys(`${p.name} ослепил(а) бабку! У вас ${this.cfg.stun} сек.`);
      }
    }
    if (it.charges <= 0) { this.consume(p, it); this.msg(p, 'Баллончик пуст'); }
    else this.event({ e: 'item', item: this.itemView(it) });
  }

  hide(p, id) {
    const spot = this.map.hides[id];
    if (!spot) return;
    const c = cellCenter(spot.x, spot.y);
    if (this.distTo(p, c.x, c.z) > INTERACT_R) return;
    if ([...this.players.values()].some(q => q.hidden === id)) { this.msg(p, 'Здесь уже кто-то прячется'); return; }
    this.ai.onPlayerHide(p, spot);
    p.hidden = id;
    p.moving = false;
    this.event({ e: 'hide', id: p.id, spot: id, on: true });
  }

  unhide(p) {
    if (p.hidden === null) return;
    const spot = this.map.hides[p.hidden];
    p.hidden = null;
    const c = cellCenter(spot.exit.x, spot.exit.y);
    p.x = c.x; p.z = c.z;
    this.event({ e: 'hide', id: p.id, spot: spot.id, on: false, x: c.x, z: c.z });
  }

  placeTrap(x, z) {
    const t = { id: this.nextItemId++, x, z };
    this.traps.push(t);
    this.event({ e: 'trapSet', trap: t });
  }

  // ================= поимка / дни / конец =================
  catchPlayer(p) {
    if (p.state !== 'alive') return;
    p.catches++;
    this.dropHeld(p, p.x, p.z);
    p.state = 'knocked';
    p.hidden = null;
    this.day++;
    const over = this.day > MAX_DAYS;
    this.event({ e: 'caught', id: p.id, name: p.name, day: Math.min(this.day, MAX_DAYS), over, x: this.ai.x, z: this.ai.z });
    this.ai.state = 'idle';
    this.ai.graceUntil = this.now() + 1e6; // «уносит» игрока
    if (over) { this.later(3.5, () => this.endGame('lose')); return; }
    this.chatSys(`${p.name} пойман(а)! Наступает день ${this.day} из ${MAX_DAYS}.`);
    this.later(4, () => {
      if (!this.players.has(p.id) || this.phase !== 'playing') return;
      this.ai.reset();
      const c = cellCenter(this.map.playerSpawn.x, this.map.playerSpawn.y);
      p.state = 'alive'; p.x = c.x; p.z = c.z; p.yaw = 0; p.lastCell = -1; p.trappedUntil = 0;
      this.event({ e: 'respawn', id: p.id, x: p.x, z: p.z, day: this.day });
    });
  }

  endGame(result, by = null) {
    if (this.phase !== 'playing') return;
    this.phase = 'ended';
    this.pending = [];
    const time = Math.round(this.now() - this.startedAt);
    this.event({
      e: 'end', result, by: by ? by.name : null, time, day: Math.min(this.day, MAX_DAYS), difficulty: this.cfg.name,
      stats: [...this.players.values()].map(q => ({ name: q.name, color: q.color, catches: q.catches })),
    });
    for (const q of this.players.values()) q.catches = 0;
    this.broadcastLobby();
    clearTimeout(this.lobbyTimer);
    this.lobbyTimer = setTimeout(() => { if (this.phase === 'ended') this.toLobby(); }, 60000);
  }
}
