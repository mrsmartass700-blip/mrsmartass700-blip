// Серверная логика комнаты: лобби, мир (3 этажа), игроки, предметы, двери, три способа побега, дни.
import {
  buildMap, cellCenter, toCell, CELL, ITEMS, EXITS, DIFFICULTIES, MAX_DAYS, FLOOR_H,
  lineOfSight, blocksMove, stairCtx, heightAt, charAt,
} from '../shared/map.js';
import { Granny } from './ai.js';

const TICK = 1 / 20;
const MAX_PLAYERS = 4;
const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f'];
const INTERACT_R = 2.6;
const CAR_START_TIME = 4.5;
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
        player = this.addPlayer(ws, m.name, m.look);
        return;
      }
      this.handle(player, m);
    });
    ws.on('close', () => { if (player) this.removePlayer(player); });
  }

  addPlayer(ws, name, look) {
    const id = this.nextId++;
    const used = new Set([...this.players.values()].map(p => p.color));
    const p = {
      id, ws, name: clean(name, 16) || `Игрок ${id}`, color: COLORS.find(c => !used.has(c)) || '#fff',
      look: look === 'f' ? 'f' : 'm',
      ready: false, level: 0, x: 0, z: 0, y: 0, yaw: 0, pitch: 0, crouch: false, run: false, moving: false, flash: true,
      state: 'alive', hidden: null, held: null, trappedUntil: 0, noiseAt: 0, lastCell: '', catches: 0,
    };
    this.players.set(id, p);
    if (!this.hostId) this.hostId = id;
    this.send(p, { t: 'welcome', id, host: this.hostId === id });
    this.chatSys(`${p.name} подключился`);
    if (this.phase === 'playing') { this.spawnPlayer(p); this.send(p, { t: 'start', world: this.worldState(p) }); }
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
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready, look: p.look })),
      addresses: this.addresses, port: this.port,
    });
  }

  // ================= сообщения =================
  handle(p, m) {
    const isHost = p.id === this.hostId;
    const playing = this.phase === 'playing';
    switch (m.t) {
      case 'ready': if (this.phase === 'lobby') { p.ready = !!m.v; this.broadcastLobby(); } break;
      case 'name': p.name = clean(m.v, 16) || p.name; this.broadcastLobby(); break;
      case 'look': if (this.phase === 'lobby') { p.look = m.v === 'f' ? 'f' : 'm'; this.broadcastLobby(); } break;
      case 'difficulty': if (isHost && this.phase === 'lobby' && DIFFICULTIES[m.v]) { this.difficulty = m.v; this.broadcastLobby(); } break;
      case 'start': if (isHost && this.phase === 'lobby' && [...this.players.values()].every(q => q.ready || q.id === p.id)) this.startGame(); break;
      case 'toLobby': if (isHost && this.phase === 'ended') this.toLobby(); break;
      case 'chat': { const text = clean(m.text, 200); if (text) this.broadcast({ t: 'chat', from: p.name, color: p.color, text }); break; }
      case 'st': if (playing) this.onState(p, m); break;
      case 'interact': if (playing) this.onInteract(p, m); break;
      case 'unhide': if (playing) this.unhide(p); break;
      case 'drop': if (playing) this.onDrop(p, false); break;
      case 'throw': if (playing) this.onDrop(p, true); break;
      case 'use': if (playing) this.onUse(p); break;
      case 'ping_loc':
        if (playing && Number.isFinite(m.x) && Number.isFinite(m.z)) this.event({ e: 'marker', id: p.id, x: m.x, z: m.z, y: Number.isFinite(m.y) ? m.y : 1, lv: p.level });
        break;
    }
  }

  // ================= мир =================
  resetWorld() {
    this.doors = this.map.doors.map(d => ({ open: false, lock: d.lock }));
    this.exits = {
      front: { padlock: true, boards: true, chain: true },
      car: { fuel: true, key: true, starting: false },
      sewer: { bolts: true, grate: true },
    };
    this.items = [];
    this.traps = [];
    this.day = 1;
    this.pending = [];
    this.startedAt = 0;
    this.nextItemId = 1;
    this.creaky = [];
    this.creakySet = new Set();
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
    this.chatSys(`Игра началась. Сложность: ${this.cfg.name}. День 1 из ${MAX_DAYS}. Выбраться можно тремя способами.`);
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
    const sp = this.map.playerSpawn;
    const c = cellCenter(sp.x, sp.y);
    const offs = [[0, 0], [0.9, 0], [0, 0.9], [0.9, 0.9]][idx % 4];
    p.level = sp.level; p.x = c.x + offs[0]; p.z = c.z + offs[1]; p.y = heightAt(this.map, p.level, p.x, p.z); p.yaw = 0; p.pitch = 0;
    p.state = 'alive'; p.hidden = null; p.trappedUntil = 0; p.lastCell = ''; p.held = null;
  }

  placeItems() {
    const spawns = shuffle(this.map.itemSpawns.slice());
    const room = (s) => this.map.rooms[s.room] || {};
    const take = (pred) => { const i = spawns.findIndex(pred); return i < 0 ? spawns.shift() : spawns.splice(i, 1)[0]; };
    const open = (s) => !room(s).locked;
    const exitItems = shuffle(['padlockKey', 'hammer', 'pliers', 'carKey', 'fuel', 'wrench', 'crowbar']);
    const plan = [
      ['storageKey', open],
      ['studyKey', (s) => open(s) || room(s).name === 'Кладовка'],
      [exitItems[0], (s) => room(s).name === 'Кабинет'],
      [exitItems[1], (s) => room(s).name === 'Кладовка'],
      // остальное — по всему дому, но не всё в одном месте
      ...exitItems.slice(2).map(t => [t, () => true]),
      ['spray', () => true],
      ['bottle', open], ['bottle', open], ['teddy', open],
    ];
    for (const [type, pred] of plan) {
      const s = take(pred);
      if (!s) break;
      const c = cellCenter(s.x, s.y);
      this.addItem(type, s.level, c.x + (Math.random() - 0.5) * 0.5, c.z + (Math.random() - 0.5) * 0.5);
    }
  }

  placeCreaky() {
    const cand = [];
    for (const r of this.map.rooms) {
      if (r.outside || r.name === 'Спальня') continue;
      for (const [x, y] of r.floorCells) if (charAt(this.map, r.level, x, y) === '.') cand.push(`${r.level}:${y * this.map.w + x}`);
    }
    this.creaky = shuffle(cand).slice(0, 30);
    this.creakySet = new Set(this.creaky);
  }

  addItem(type, level, x, z) {
    const it = { id: this.nextItemId++, type, level, x, z, holder: null, charges: ITEMS[type].charges || 0 };
    this.items.push(it);
    return it;
  }

  itemView(it) { return { id: it.id, type: it.type, lv: it.level, x: +it.x.toFixed(2), z: +it.z.toFixed(2), holder: it.holder, charges: it.charges }; }

  worldState(p) {
    return {
      you: { id: p.id, level: p.level, x: p.x, z: p.z, yaw: p.yaw },
      doors: this.doors, exits: this.exits,
      items: this.items.map(it => this.itemView(it)),
      traps: this.traps, creaky: this.creaky, day: this.day, maxDays: MAX_DAYS,
      difficulty: this.difficulty, dark: !!this.cfg.dark, ai: this.cfg.ai,
    };
  }

  // ================= тик =================
  tick() {
    if (this.phase !== 'playing') return;
    const now = this.now();
    const due = this.pending.filter(a => a.at <= now);
    this.pending = this.pending.filter(a => a.at > now);
    for (const a of due) a.fn();
    if (this.phase !== 'playing') return;
    this.ai.update(TICK, now);
    this.broadcast({
      t: 'snap', time: +now.toFixed(2), day: this.day,
      ai: this.cfg.ai ? this.ai.snapshot() : null,
      players: [...this.players.values()].map(p => ({
        id: p.id, lv: p.level, x: +p.x.toFixed(3), z: +p.z.toFixed(3), y: +p.y.toFixed(3), yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3),
        cr: p.crouch, fl: p.flash, mv: p.moving, run: p.run, hid: p.hidden, st: p.state, held: p.held, look: p.look,
        tr: p.trappedUntil > now,
      })),
    });
  }

  later(sec, fn) { this.pending.push({ at: this.now() + sec, fn }); }
  noise(level, x, z, r) { if (r > 0) this.ai.onNoise(level, x, z, r); }

  // ================= состояние игрока =================
  onState(p, m) {
    if (p.state !== 'alive') return;
    const now = this.now();
    for (const k of ['yaw', 'pitch']) if (Number.isFinite(m[k])) p[k] = m[k];
    p.crouch = !!m.cr; p.flash = !!m.fl;
    if (p.hidden !== null || now < p.trappedUntil) { p.moving = false; return; }
    if (!Number.isFinite(m.x) || !Number.isFinite(m.z)) return;
    const lv = Number.isInteger(m.lv) ? m.lv : p.level;
    const reject = () => this.send(p, { t: 'ev', e: 'correct', x: p.x, z: p.z, lv: p.level });
    if (Math.hypot(m.x - p.x, m.z - p.z) > 3 || Math.abs(lv - p.level) > 1 || !this.map.levels[lv]) return reject();
    // смена этажа — только у лестницы
    if (lv !== p.level && !this.map.stairs.some(s => (s.from === Math.min(lv, p.level)) && Math.hypot((s.top[0] + 0.5) * CELL - m.x, (s.top[1] + 0.5) * CELL - m.z) < 3.2)) return reject();
    const cx = toCell(m.x), cy = toCell(m.z);
    // разрешаем клетки своего марша (контекст по новой позиции)
    const ctx = stairCtx(this.map, lv, m.x, m.z) || stairCtx(this.map, p.level, p.x, p.z);
    if (blocksMove(this.map, this.doors, lv, cx, cy, ctx)) return reject();
    p.level = lv; p.x = m.x; p.z = m.z; p.y = heightAt(this.map, lv, p.x, p.z);
    p.moving = !!m.mv; p.run = !!m.run && !p.crouch;
    if (p.moving && now >= p.noiseAt) { p.noiseAt = now + 0.45; this.noise(p.level, p.x, p.z, p.crouch ? 0 : p.run ? 9 : 3.2); }
    const key = `${p.level}:${cy * this.map.w + cx}`;
    if (key !== p.lastCell) {
      p.lastCell = key;
      if (this.creakySet.has(key)) { this.event({ e: 'creak', x: p.x, z: p.z, lv: p.level }); this.noise(p.level, p.x, p.z, p.crouch ? 6 : 11); }
    }
    const trap = this.traps.find(t => t.level === p.level && Math.hypot(t.x - p.x, t.z - p.z) < 0.5);
    if (trap) {
      this.traps = this.traps.filter(t => t !== trap);
      p.trappedUntil = now + 3.5; p.x = trap.x; p.z = trap.z;
      this.event({ e: 'trap', id: p.id, trap: trap.id, x: trap.x, z: trap.z, lv: p.level, until: 3.5 });
      this.noise(p.level, trap.x, trap.z, 22);
    }
    if (charAt(this.map, p.level, cx, cy) === 'O') this.endGame('win', p, 'front');
  }

  // ================= взаимодействие =================
  onInteract(p, m) {
    if (p.state !== 'alive' || p.hidden !== null || this.now() < p.trappedUntil) return;
    const id = m.id | 0;
    if (m.kind === 'door') this.interactDoor(p, id);
    else if (m.kind === 'item') this.pickup(p, id);
    else if (m.kind === 'hide') this.hide(p, id);
    else if (m.kind === 'car') this.interactCar(p);
  }

  near(p, level, x, z, r = INTERACT_R) { return p.level === level && Math.hypot(p.x - x, p.z - z) <= r; }
  msg(p, text) { this.send(p, { t: 'ev', e: 'msg', text }); }
  heldItem(p) { return p.held ? this.items.find(it => it.id === p.held) : null; }

  // общий обработчик «замков» выхода: предмет в руке снимает подходящий замок
  useOnExit(p, exitKey, pos, noiseR = 10) {
    const st = this.exits[exitKey], spec = EXITS[exitKey];
    const left = Object.keys(spec.locks).filter(k => st[k]);
    const held = this.heldItem(p);
    if (held) {
      const lk = left.find(k => spec.locks[k].item === held.type);
      if (lk) {
        st[lk] = false;
        this.consume(p, held);
        this.event({ e: 'exitLock', exit: exitKey, lock: lk, id: p.id, x: pos.x, z: pos.z, lv: pos.level, exits: this.exits });
        this.noise(pos.level, pos.x, pos.z, lk === 'boards' || lk === 'bolts' ? 18 : noiseR);
        const rest = Object.keys(spec.locks).filter(k => st[k]);
        this.chatSys(`${p.name}: ${spec.name} — ${spec.locks[lk].name} готово. ` + (rest.length ? `Осталось: ${rest.map(k => spec.locks[k].name).join(', ')}.` : 'Можно бежать!'));
        return 'used';
      }
    }
    if (left.length) {
      this.msg(p, `${spec.name}: нужно — ${left.map(k => `${spec.locks[k].name} (${ITEMS[spec.locks[k].item].short})`).join(', ')}`);
      this.event({ e: 'locked', x: pos.x, z: pos.z, lv: pos.level });
      return 'locked';
    }
    return 'free';
  }

  interactDoor(p, id) {
    const d = this.map.doors[id];
    if (!d) return;
    const c = cellCenter(d.x, d.y);
    if (!this.near(p, d.level, c.x, c.z)) return;
    const ds = this.doors[id];
    const pos = { level: d.level, ...c };
    if (d.kind === 'front') {
      if (this.useOnExit(p, 'front', pos) === 'free' && !ds.open) { this.setDoor(id, true, p.id); this.noise(d.level, c.x, c.z, 12); }
      return;
    }
    if (d.kind === 'grate') {
      const r = this.useOnExit(p, 'sewer', pos, 12);
      if (r === 'free') {
        if (!ds.open) { this.setDoor(id, true, p.id); this.noise(d.level, c.x, c.z, 14); }
        else this.endGame('win', p, 'sewer');
      }
      return;
    }
    if (d.kind === 'garage') { this.msg(p, 'Ворота гаража не открыть руками. Может, на машине?'); return; }
    const held = this.heldItem(p);
    if (ds.lock) {
      if (held && held.type === ds.lock) {
        ds.lock = null;
        this.consume(p, held);
        this.event({ e: 'unlock', id, by: p.id });
        this.setDoor(id, true, p.id);
        this.chatSys(`${p.name} отпер(ла) дверь: ${this.roomNameBehind(d)}`);
      } else {
        this.msg(p, `Заперто. Нужен: ${ITEMS[ds.lock].name}`);
        this.event({ e: 'locked', x: c.x, z: c.z, lv: d.level });
      }
      return;
    }
    if (ds.open && this.entityInCell(d.level, d.x, d.y)) { this.msg(p, 'Что-то мешает закрыть дверь'); return; }
    this.setDoor(id, !ds.open, p.id);
    this.noise(d.level, c.x, c.z, 3.5);
  }

  interactCar(p) {
    const car = this.map.car;
    if (!car || !this.near(p, car.level, car.cx, car.cz, 3.2)) return;
    const st = this.exits.car;
    if (st.starting) return;
    const r = this.useOnExit(p, 'car', { level: car.level, x: car.cx, z: car.cz }, 8);
    if (r !== 'free') return;
    // заводим: долго и громко — бабка точно прибежит
    st.starting = true;
    this.event({ e: 'carStart', id: p.id, x: car.cx, z: car.cz, lv: car.level, dur: CAR_START_TIME });
    this.chatSys(`${p.name} заводит машину! Держитесь ${CAR_START_TIME} сек!`);
    this.noise(car.level, car.cx, car.cz, 40);
    this.later(CAR_START_TIME, () => {
      if (this.phase !== 'playing') return;
      if (p.state !== 'alive' || !this.near(p, car.level, car.cx, car.cz, 3.5)) {
        st.starting = false;
        this.event({ e: 'carStall', x: car.cx, z: car.cz, lv: car.level });
        this.chatSys('Машина заглохла — водитель отошёл. Заводите снова!');
        return;
      }
      const g = this.map.doors.find(d => d.kind === 'garage');
      if (g) this.setDoor(g.id, true, p.id);
      this.endGame('win', p, 'car');
    });
  }

  roomNameBehind(d) {
    return d.rooms.map(r => this.map.rooms[r]).filter(r => r && r.locked).map(r => r.name)[0] || 'комната';
  }

  setDoor(id, open, by) {
    this.doors[id].open = open;
    const d = this.map.doors[id], c = cellCenter(d.x, d.y);
    this.event({ e: 'door', id, open, lock: this.doors[id].lock, by, x: c.x, z: c.z, lv: d.level });
  }

  entityInCell(L, cx, cy) {
    const x0 = cx * CELL, x1 = (cx + 1) * CELL, z0 = cy * CELL, z1 = (cy + 1) * CELL, m = 0.35;
    const inside = (x, z) => x > x0 - m && x < x1 + m && z > z0 - m && z < z1 + m;
    for (const p of this.players.values()) if (p.level === L && p.state === 'alive' && p.hidden === null && inside(p.x, p.z)) return true;
    if (this.cfg.ai && this.ai.level === L && inside(this.ai.x, this.ai.z)) return true;
    return false;
  }

  consume(p, it) {
    this.items = this.items.filter(i => i !== it);
    p.held = null;
    this.event({ e: 'itemGone', id: it.id });
  }

  pickup(p, id) {
    const it = this.items.find(i => i.id === id && i.holder === null);
    if (!it || !this.near(p, it.level, it.x, it.z)) return;
    if (p.held) this.dropHeld(p, it.x, it.z);
    it.holder = p.id;
    p.held = it.id;
    this.event({ e: 'item', item: this.itemView(it), sound: 'pickup' });
  }

  dropHeld(p, x, z, sound = 'drop') {
    const it = this.heldItem(p);
    p.held = null;
    if (!it) return null;
    it.holder = null; it.level = p.level; it.x = x; it.z = z;
    this.event({ e: 'item', item: this.itemView(it), sound });
    return it;
  }

  onDrop(p, isThrow) {
    if (p.state !== 'alive' || p.hidden !== null || !p.held) return;
    const it = this.heldItem(p);
    if (!it) { p.held = null; return; }
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const maxD = isThrow ? 7 : 0.7;
    const ctx = stairCtx(this.map, p.level, p.x, p.z);
    let lx = p.x, lz = p.z;
    for (let d = 0.2; d <= maxD; d += 0.2) {
      const x = p.x + fx * d, z = p.z + fz * d;
      if (blocksMove(this.map, this.doors, p.level, toCell(x), toCell(z), ctx) || charAt(this.map, p.level, toCell(x), toCell(z)) === 'O') break;
      lx = x; lz = z;
    }
    lx -= fx * 0.15; lz -= fz * 0.15;
    if (blocksMove(this.map, this.doors, p.level, toCell(lx), toCell(lz), ctx)) { lx = p.x; lz = p.z; }
    // на лестнице предмет скатывается к её началу
    if (charAt(this.map, p.level, toCell(lx), toCell(lz)) === '^' && ctx?.stair) { const a = cellCenter(...ctx.stair.approach); lx = a.x; lz = a.z; }
    if (isThrow && it.type === 'bottle') {
      this.consume(p, it);
      this.event({ e: 'glass', x: lx, z: lz, lv: p.level, from: { x: p.x, z: p.z } });
      this.noise(p.level, lx, lz, 18);
      return;
    }
    this.dropHeld(p, lx, lz, isThrow ? 'thud' : 'drop');
    if (isThrow) this.event({ e: 'throw', id: it.id, from: { x: p.x, z: p.z } });
    this.noise(p.level, lx, lz, isThrow ? 13 : 2.5);
  }

  onUse(p) {
    if (p.state !== 'alive' || p.hidden !== null || !p.held) return;
    const it = this.heldItem(p);
    if (!it || it.type !== 'spray') return;
    it.charges--;
    this.event({ e: 'spray', id: p.id, x: p.x, z: p.z, lv: p.level, charges: it.charges, itemId: it.id });
    const a = this.ai;
    if (this.cfg.ai && a.state !== 'stunned' && a.level === p.level) {
      const dx = a.x - p.x, dz = a.z - p.z, d = Math.hypot(dx, dz);
      const dot = d > 0 ? (dx * -Math.sin(p.yaw) + dz * -Math.cos(p.yaw)) / d : 1;
      if (d < 5 && dot > 0.82 && lineOfSight(this.map, this.doors, p.level, p.x, p.z, a.x, a.z)) {
        a.onSprayed({ level: p.level, x: p.x, z: p.z });
        this.event({ e: 'stunned', by: p.id, x: a.x, z: a.z, lv: a.level, dur: this.cfg.stun });
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
    if (!this.near(p, spot.level, c.x, c.z)) return;
    if ([...this.players.values()].some(q => q.hidden === id)) { this.msg(p, 'Здесь уже кто-то прячется'); return; }
    this.ai.onPlayerHide(p, spot);
    p.hidden = id; p.moving = false;
    this.event({ e: 'hide', id: p.id, spot: id, on: true });
  }

  unhide(p) {
    if (p.hidden === null) return;
    const spot = this.map.hides[p.hidden];
    p.hidden = null;
    const c = cellCenter(spot.exit.x, spot.exit.y);
    p.level = spot.level; p.x = c.x; p.z = c.z; p.y = heightAt(this.map, p.level, p.x, p.z);
    this.event({ e: 'hide', id: p.id, spot: spot.id, on: false, x: c.x, z: c.z, lv: p.level });
  }

  placeTrap(level, x, z) {
    const t = { id: this.nextItemId++, level, x, z };
    this.traps.push(t);
    this.event({ e: 'trapSet', trap: t });
  }

  // ================= поимка / дни / конец =================
  catchPlayer(p) {
    if (p.state !== 'alive') return;
    p.catches++;
    this.dropHeld(p, p.x, p.z);
    p.state = 'knocked'; p.hidden = null;
    this.day++;
    const over = this.day > MAX_DAYS;
    this.event({ e: 'caught', id: p.id, name: p.name, day: Math.min(this.day, MAX_DAYS), over, x: this.ai.x, z: this.ai.z, lv: this.ai.level });
    this.ai.state = 'idle';
    this.ai.graceUntil = this.now() + 1e6;
    if (this.exits.car.starting) this.exits.car.starting = false;
    if (over) { this.later(3.5, () => this.endGame('lose')); return; }
    this.chatSys(`${p.name} пойман(а)! Наступает день ${this.day} из ${MAX_DAYS}.`);
    this.later(4, () => {
      if (!this.players.has(p.id) || this.phase !== 'playing') return;
      this.ai.reset();
      const sp = this.map.playerSpawn, c = cellCenter(sp.x, sp.y);
      p.state = 'alive'; p.level = sp.level; p.x = c.x; p.z = c.z; p.y = heightAt(this.map, p.level, p.x, p.z); p.yaw = 0; p.lastCell = ''; p.trappedUntil = 0;
      this.event({ e: 'respawn', id: p.id, x: p.x, z: p.z, lv: p.level, day: this.day });
    });
  }

  endGame(result, by = null, via = null) {
    if (this.phase !== 'playing') return;
    this.phase = 'ended';
    this.pending = [];
    const time = Math.round(this.now() - this.startedAt);
    this.event({
      e: 'end', result, by: by ? by.name : null, via, time, day: Math.min(this.day, MAX_DAYS), difficulty: this.cfg.name,
      stats: [...this.players.values()].map(q => ({ name: q.name, color: q.color, catches: q.catches })),
    });
    for (const q of this.players.values()) q.catches = 0;
    this.broadcastLobby();
    clearTimeout(this.lobbyTimer);
    this.lobbyTimer = setTimeout(() => { if (this.phase === 'ended') this.toLobby(); }, 60000);
  }
}

export { FLOOR_H };
