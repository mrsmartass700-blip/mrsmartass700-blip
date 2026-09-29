// Автотесты: логика игры с «виртуальным временем» + настоящий сетевой прогон двух клиентов.
// Запуск: node test/sim.js
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Game } from '../server/game.js';
import { cellCenter, toCell, walkableForAI, moveEntity, MAX_DAYS, charAt, heightAt, FLOOR_H } from '../shared/map.js';

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name, '\n', e); process.exitCode = 1; }
};

function fakeWs() { return { open: true, msgs: [], send(s) { this.msgs.push(JSON.parse(s)); }, close() { this.open = false; }, on() {} }; }

function makeGame(n = 2, difficulty = 'normal') {
  const g = new Game();
  g.stop();
  let t = 100;
  g.now = () => t;
  g.advance = (sec) => { const steps = Math.round(sec * 20); for (let i = 0; i < steps; i++) { t += 0.05; g.tick(); } };
  const ps = [];
  for (let i = 0; i < n; i++) ps.push(g.addPlayer(fakeWs(), 'bot' + i));
  g.difficulty = difficulty;
  for (const p of ps) g.handle(p, { t: 'ready', v: true });
  g.handle(ps[0], { t: 'start' });
  return { g, ps };
}
const events = (p, e) => p.ws.msgs.filter(m => m.t === 'ev' && (!e || m.e === e));
const place = (g, p, L, cx, cy) => { const c = cellCenter(cx, cy); p.level = L; p.x = c.x; p.z = c.z; p.y = heightAt(g.map, L, c.x, c.z); p.lastCell = ''; };
const give = (g, p, type) => { const it = g.items.find(i => i.type === type); it.holder = p.id; p.held = it.id; return it; };
const roomCell = (g, name) => { const r = g.map.rooms.find(r => r.name === name); return { L: r.level, x: r.floorCells[0][0], y: r.floorCells[0][1], r }; };

console.log('Карта: этажи, лестницы, связность');
await test('все точки предметов и укрытий достижимы из спальни (двери открыты)', () => {
  const { g } = makeGame(1, 'practice');
  g.doors.forEach(d => { d.open = true; });
  const sp = g.map.playerSpawn;
  const start = g.ai.node(sp.level, sp.x, sp.y);
  const seen = new Set([start]), q = [start];
  while (q.length) for (const [nb] of g.ai.neighbors(q.shift())) if (!seen.has(nb)) { seen.add(nb); q.push(nb); }
  for (const s of g.map.itemSpawns) assert.ok(seen.has(g.ai.node(s.level, s.x, s.y)), `предмет ${s.level}:${s.x},${s.y}`);
  for (const h of g.map.hides) assert.ok(seen.has(g.ai.node(h.level, h.exit.x, h.exit.y)), `укрытие ${h.id} (${h.type})`);
  for (const L of [-1, 0, 1]) assert.ok([...seen].some(n => g.ai.unnode(n)[0] === L), `этаж ${L}`);
});

await test('по лестницам можно пройти вверх и вниз (высота меняется плавно)', () => {
  const { g } = makeGame(1, 'practice');
  for (const s of g.map.stairs) {
    let e = { level: s.from, ...cellCenter(...s.approach) };
    let prevY = heightAt(g.map, e.level, e.x, e.z), maxJump = 0;
    for (let i = 0; i < 80; i++) { const n = moveEntity(g.map, g.doors, e, s.dir[0] * 0.1, s.dir[1] * 0.1); maxJump = Math.max(maxJump, Math.abs(n.y - prevY)); prevY = n.y; e = n; }
    assert.equal(e.level, s.to, `поднялись по лестнице ${s.id}`);
    assert.ok(maxJump < 0.25, `без скачков по высоте (${maxJump})`);
    for (let i = 0; i < 80; i++) e = moveEntity(g.map, g.doors, e, -s.dir[0] * 0.1, -s.dir[1] * 0.1);
    assert.equal(e.level, s.from, 'спустились обратно');
  }
});

await test('на ступень нельзя зайти сбоку, с лестницы нельзя шагнуть вбок', () => {
  const { g } = makeGame(1, 'practice');
  const s = g.map.stairs[0];
  const [sx, sy] = s.cells[1];
  let e = { level: s.from, ...cellCenter(sx - 1, sy) };
  for (let i = 0; i < 20; i++) e = moveEntity(g.map, g.doors, e, 0.1, 0);
  assert.ok(toCell(e.x) === sx - 1, 'сбоку не зашли');
  e = { level: s.from, ...cellCenter(sx, sy) };
  for (let i = 0; i < 20; i++) e = moveEntity(g.map, g.doors, e, -0.1, 0);
  assert.equal(toCell(e.x), sx, 'со ступени вбок не сошли');
});

await test('бабка находит путь в каждую комнату на всех этажах', () => {
  const { g } = makeGame(1);
  const sp = g.map.grannySpawn;
  for (const r of g.map.rooms.filter(r => !r.outside)) {
    const [x, y] = r.floorCells[0];
    const path = g.ai.astar(g.ai.node(sp.level, sp.x, sp.y), { level: r.level, ...cellCenter(x, y) });
    assert.ok(path && path.length > 0, r.name);
    for (const n of path) { const [L, cx, cy] = g.ai.unnode(n); assert.ok(walkableForAI(g.map, L, cx, cy), `${r.name}: ${L}:${cx},${cy}`); }
  }
});

console.log('Предметы');
await test('раскладка: 13 предметов, ключи от запертых комнат не заперты сами в себе', () => {
  for (let i = 0; i < 40; i++) {
    const { g } = makeGame(1);
    assert.equal(g.items.length, 13);
    const roomOf = (it) => g.map.rooms[g.map.roomAt(it.level, toCell(it.x), toCell(it.z))]?.name;
    const sk = g.items.find(it => it.type === 'storageKey'), stk = g.items.find(it => it.type === 'studyKey');
    assert.ok(!['Кладовка', 'Кабинет'].includes(roomOf(sk)));
    assert.notEqual(roomOf(stk), 'Кабинет');
    for (const t of ['padlockKey', 'hammer', 'pliers', 'carKey', 'fuel', 'wrench', 'crowbar', 'spray']) assert.ok(g.items.some(it => it.type === t), t);
  }
});

await test('подобрать, поменять, бросить (шум), положить', () => {
  const { g, ps: [p] } = makeGame(1, 'practice');
  const [a, b] = g.items;
  p.level = a.level; p.x = a.x; p.z = a.z;
  g.handle(p, { t: 'interact', kind: 'item', id: a.id });
  assert.equal(p.held, a.id);
  p.level = b.level; p.x = b.x; p.z = b.z;
  g.handle(p, { t: 'interact', kind: 'item', id: b.id });
  assert.equal(p.held, b.id);
  assert.equal(a.holder, null);
  place(g, p, 0, 15, 8); p.yaw = Math.PI / 2;
  g.handle(p, { t: 'throw' });
  assert.equal(p.held, null);
});

console.log('Двери');
await test('обычная дверь открывается/закрывается, запертая — только ключом', () => {
  const { g, ps: [p] } = makeGame(1, 'practice');
  const d = g.map.doors.find(d => d.kind === 'door' && !d.lock && d.level === 1);
  place(g, p, d.level, d.x, d.y + 1);
  g.handle(p, { t: 'interact', kind: 'door', id: d.id });
  assert.equal(g.doors[d.id].open, true);
  g.handle(p, { t: 'interact', kind: 'door', id: d.id });
  assert.equal(g.doors[d.id].open, false);
  const lk = g.map.doors.find(d => d.lock === 'studyKey');
  place(g, p, lk.level, lk.x, lk.y - 1);
  g.handle(p, { t: 'interact', kind: 'door', id: lk.id });
  assert.equal(g.doors[lk.id].open, false);
  give(g, p, 'studyKey');
  g.handle(p, { t: 'interact', kind: 'door', id: lk.id });
  assert.equal(g.doors[lk.id].open, true);
});

console.log('Три способа побега');
await test('входная дверь: 3 замка, открыть, выбежать во двор', () => {
  const { g, ps: [p, q] } = makeGame(2, 'practice');
  const d = g.map.doors.find(d => d.kind === 'front');
  place(g, p, 0, d.x, d.y - 1);
  for (const type of ['hammer', 'pliers', 'padlockKey']) { give(g, p, type); g.handle(p, { t: 'interact', kind: 'door', id: d.id }); }
  assert.deepEqual(g.exits.front, { padlock: false, boards: false, chain: false });
  g.handle(p, { t: 'interact', kind: 'door', id: d.id });
  assert.equal(g.doors[d.id].open, true);
  const out = cellCenter(d.x, d.y + 1);
  g.handle(p, { t: 'st', lv: 0, x: p.x, z: p.z + 1.4, yaw: 0, pitch: 0, mv: true });
  g.handle(p, { t: 'st', lv: 0, x: out.x, z: out.z, yaw: 0, pitch: 0, mv: true });
  assert.equal(g.phase, 'ended');
  assert.ok(events(q, 'end').some(m => m.result === 'win' && m.via === 'front'));
});

await test('машина: бензин + ключ, завести и продержаться — ворота гаража вышибаются', () => {
  const { g, ps: [p] } = makeGame(1, 'practice');
  const car = g.map.car;
  p.level = car.level; p.x = car.cx - 1.8; p.z = car.cz;
  g.handle(p, { t: 'interact', kind: 'car' });
  assert.equal(g.exits.car.starting, false, 'без бензина и ключа не заводится');
  give(g, p, 'fuel'); g.handle(p, { t: 'interact', kind: 'car' });
  give(g, p, 'carKey'); g.handle(p, { t: 'interact', kind: 'car' });
  g.handle(p, { t: 'interact', kind: 'car' });
  assert.equal(g.exits.car.starting, true);
  g.advance(5);
  assert.equal(g.phase, 'ended');
  assert.ok(events(p, 'end').some(m => m.via === 'car'));
});

await test('канализация: гаечный ключ + лом, открыть решётку и спуститься', () => {
  const { g, ps: [p] } = makeGame(1, 'practice');
  const gr = g.map.grate;
  place(g, p, gr.level, gr.x + 1, gr.y);
  give(g, p, 'wrench'); g.handle(p, { t: 'interact', kind: 'door', id: gr.id });
  give(g, p, 'crowbar'); g.handle(p, { t: 'interact', kind: 'door', id: gr.id });
  g.handle(p, { t: 'interact', kind: 'door', id: gr.id });
  assert.equal(g.doors[gr.id].open, true);
  g.handle(p, { t: 'interact', kind: 'door', id: gr.id });
  assert.equal(g.phase, 'ended');
  assert.ok(events(p, 'end').some(m => m.via === 'sewer'));
});

console.log('ИИ бабки');
await test('видит, догоняет, ловит — день 2 и респавн в спальне', () => {
  const { g, ps: [p] } = makeGame(1, 'normal');
  g.advance(0.1); g.ai.graceUntil = 0;
  place(g, p, 0, 6, 8);
  g.ai.level = 0; g.ai.x = cellCenter(16, 8).x; g.ai.z = cellCenter(16, 8).z; g.ai.y = 0; g.ai.yaw = Math.PI / 2; g.ai.state = 'patrol';
  g.advance(0.2);
  assert.equal(g.ai.state, 'chase');
  g.advance(8);
  assert.equal(p.state, 'knocked');
  assert.equal(g.day, 2);
  g.advance(4.5);
  assert.equal(p.state, 'alive');
  assert.equal(p.level, g.map.playerSpawn.level);
});

await test('бабка ходит по этажам: из своей комнаты в подвал', () => {
  const { g, ps: [p] } = makeGame(1, 'normal');
  g.ai.graceUntil = 0; p.state = 'knocked';
  const t = roomCell(g, 'Винный погреб');
  const goal = { level: t.L, ...cellCenter(t.x, t.y) };
  g.ai.state = 'investigate'; g.ai.goal = goal;
  let ok = false; const levels = new Set();
  for (let i = 0; i < 90 * 4 && !ok; i++) {
    g.advance(0.25); levels.add(g.ai.level);
    if (g.ai.state !== 'investigate') { g.ai.state = 'investigate'; g.ai.goal = goal; }
    ok = g.ai.level === t.L && Math.hypot(g.ai.x - goal.x, g.ai.z - goal.z) < 1;
  }
  assert.ok(ok, `дошла до подвала (сейчас ${g.ai.level}:${toCell(g.ai.x)},${toCell(g.ai.z)})`);
  assert.deepEqual([...levels].sort(), [-1, 0, 1]);
  assert.ok(Math.abs(g.ai.y - (-FLOOR_H)) < 0.01);
});

await test('слышит шум на своём этаже, через два перекрытия — нет', () => {
  const { g, ps: [p] } = makeGame(1, 'normal');
  g.ai.graceUntil = 0; g.ai.state = 'patrol'; p.state = 'knocked';
  g.ai.onNoise(-1, g.ai.x, g.ai.z, 13);
  assert.equal(g.ai.state, 'patrol', 'через два этажа не слышно');
  g.ai.onNoise(g.ai.level, g.ai.x + 3, g.ai.z, 13);
  assert.equal(g.ai.state, 'investigate');
});

await test('спрятался под стол незаметно — не ловит; в шкаф на глазах — вытаскивает', () => {
  {
    const { g, ps: [p] } = makeGame(1, 'normal');
    g.ai.graceUntil = 0;
    const spot = g.map.hides.find(h => h.type === 'table' && h.level === 0);
    place(g, p, spot.level, spot.exit.x, spot.exit.y);
    g.handle(p, { t: 'interact', kind: 'hide', id: spot.id });
    assert.equal(p.hidden, spot.id);
    g.advance(20);
    assert.equal(p.state, 'alive');
  }
  {
    const { g, ps: [p] } = makeGame(1, 'normal');
    g.ai.graceUntil = 0;
    const spot = g.map.hides.find(h => h.type === 'wardrobe' && h.level === 1 && h.x === 8 && h.y === 1);
    place(g, p, spot.level, spot.exit.x, spot.exit.y);
    const c = cellCenter(spot.exit.x - 3, spot.exit.y + 2);
    g.ai.level = 1; g.ai.x = c.x; g.ai.z = c.z; g.ai.face(p);
    g.advance(0.1);
    assert.equal(g.ai.state, 'chase');
    g.handle(p, { t: 'interact', kind: 'hide', id: spot.id });
    assert.equal(g.ai.knownHide, spot.id);
    g.advance(3);
    assert.equal(p.state, 'knocked');
  }
});

await test('перцовый баллончик оглушает бабку', () => {
  const { g, ps: [p] } = makeGame(1, 'normal');
  g.ai.graceUntil = 0;
  place(g, p, 0, 8, 8); p.yaw = -Math.PI / 2;
  g.ai.level = 0; g.ai.x = p.x + 3; g.ai.z = p.z;
  const spray = give(g, p, 'spray');
  g.handle(p, { t: 'use' });
  assert.equal(g.ai.state, 'stunned');
  assert.equal(spray.charges, 2);
  g.advance(3);
  assert.equal(p.state, 'alive');
});

await test('капкан держит игрока', () => {
  const { g, ps: [p] } = makeGame(1, 'practice');
  place(g, p, 0, 10, 8);
  const c = cellCenter(11, 8);
  g.placeTrap(0, c.x, c.z);
  g.handle(p, { t: 'st', lv: 0, x: c.x, z: c.z, yaw: 0, pitch: 0, mv: true });
  assert.ok(p.trappedUntil > g.now());
  const before = { x: p.x, z: p.z };
  g.handle(p, { t: 'st', lv: 0, x: p.x + 0.5, z: p.z, yaw: 0, pitch: 0, mv: true });
  assert.deepEqual({ x: p.x, z: p.z }, before);
});

await test(`${MAX_DAYS} поимок — поражение`, () => {
  const { g, ps: [p, q] } = makeGame(2, 'normal');
  for (let i = 0; i < MAX_DAYS; i++) { const who = i % 2 ? q : p; who.state = 'alive'; g.catchPlayer(who); g.advance(4.5); }
  assert.equal(g.phase, 'ended');
  assert.ok(events(p, 'end').some(m => m.result === 'lose'));
});

await test('сервер отклоняет телепорт, прыжок между этажами и проход сквозь дверь', () => {
  const { g, ps: [p] } = makeGame(1, 'practice');
  place(g, p, 1, 3, 3);
  const was = { x: p.x, z: p.z, level: p.level };
  g.handle(p, { t: 'st', lv: 1, x: p.x + 20, z: p.z, yaw: 0, pitch: 0 });
  assert.deepEqual({ x: p.x, z: p.z, level: p.level }, was);
  g.handle(p, { t: 'st', lv: 0, x: p.x, z: p.z, yaw: 0, pitch: 0 });
  assert.equal(p.level, 1, 'этаж не сменился посреди комнаты');
  const d = g.map.doors.find(d => d.level === 1 && d.x === 5 && d.y === 7);
  place(g, p, 1, 5, 6);
  const c = cellCenter(d.x, d.y);
  g.handle(p, { t: 'st', lv: 1, x: c.x, z: c.z, yaw: 0, pitch: 0 });
  assert.notEqual(toCell(p.z), d.y);
});

await test('лобби: хост меняет сложность, игрок заходит посреди игры, хост передаётся', () => {
  const g = new Game(); g.stop();
  const a = g.addPlayer(fakeWs(), 'host'), b = g.addPlayer(fakeWs(), 'guest');
  g.handle(b, { t: 'difficulty', v: 'hard' }); assert.equal(g.difficulty, 'normal');
  g.handle(a, { t: 'difficulty', v: 'hard' }); assert.equal(g.difficulty, 'hard');
  g.handle(a, { t: 'start' }); assert.equal(g.phase, 'lobby');
  g.handle(b, { t: 'ready', v: true }); g.handle(a, { t: 'start' }); assert.equal(g.phase, 'playing');
  const c = g.addPlayer(fakeWs(), 'late');
  assert.ok(c.ws.msgs.some(m => m.t === 'start'));
  g.removePlayer(a); assert.equal(g.hostId, b.id);
});

await test('долгий прогон: 3 минуты «Кошмара» с двумя ботами по всему дому', () => {
  const { g, ps } = makeGame(2, 'nightmare');
  for (let s = 0; s < 180 * 20; s++) {
    for (const p of ps) {
      if (p.state !== 'alive' || p.hidden !== null) continue;
      p.yaw += (Math.random() - 0.5) * 0.4;
      const n = moveEntity(g.map, g.doors, p, -Math.sin(p.yaw) * 0.15, -Math.cos(p.yaw) * 0.15);
      g.handle(p, { t: 'st', lv: n.level, x: n.x, z: n.z, yaw: p.yaw, pitch: 0, mv: true, run: Math.random() < 0.3, fl: true });
      if (Math.random() < 0.01) {
        const d = g.map.doors.find(d => d.level === p.level && Math.hypot(cellCenter(d.x, d.y).x - p.x, cellCenter(d.x, d.y).z - p.z) < 2.5);
        if (d) g.handle(p, { t: 'interact', kind: 'door', id: d.id });
      }
    }
    g.advance(0.05);
    if (g.phase !== 'playing') break;
  }
  assert.ok(Number.isFinite(g.ai.x) && Number.isFinite(g.ai.z) && Number.isFinite(g.ai.y));
  assert.ok(walkableForAI(g.map, g.ai.level, toCell(g.ai.x), toCell(g.ai.z)), `бабка не в стене (${g.ai.level}:${toCell(g.ai.x)},${toCell(g.ai.z)} '${charAt(g.map, g.ai.level, toCell(g.ai.x), toCell(g.ai.z))}')`);
});

// ---------------- настоящий сервер + 2 WebSocket-клиента ----------------
console.log('Сеть (реальный сервер, 2 клиента)');
await test('два клиента подключаются, стартуют и получают снапшоты', async () => {
  const PORT = 17777;
  const srv = spawn(process.execPath, ['server/index.js', String(PORT), '--no-browser'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  srv.stdout.on('data', d => { out += d; }); srv.stderr.on('data', d => { out += d; });
  try {
    for (let i = 0; i < 50 && !out.includes('сервер запущен'); i++) await new Promise(r => setTimeout(r, 100));
    assert.ok(out.includes('сервер запущен'), out);
    for (const u of ['/', '/shared/map.js', '/shared/levels.js', '/vendor/three.module.min.js', '/models/granny.glb'])
      assert.equal((await fetch(`http://127.0.0.1:${PORT}${u}`)).status, 200, u);
    assert.equal((await fetch(`http://127.0.0.1:${PORT}/shared/../server/game.js`)).status, 404);
    const mk = (name) => new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
      const c = { ws, msgs: [], name };
      ws.onmessage = (e) => c.msgs.push(JSON.parse(e.data));
      ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello', name })); resolve(c); };
      ws.onerror = reject;
    });
    const A = await mk('Хост'), B = await mk('Друг');
    const wait = async (c, pred, ms = 3000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { const m = c.msgs.find(pred); if (m) return m; await new Promise(r => setTimeout(r, 20)); }
      throw new Error(`${c.name}: не дождались сообщения`);
    };
    await wait(A, m => m.t === 'welcome' && m.host);
    B.ws.send(JSON.stringify({ t: 'ready', v: true }));
    await wait(A, m => m.t === 'lobby' && m.players.some(p => p.ready));
    A.ws.send(JSON.stringify({ t: 'start' }));
    const sa = await wait(A, m => m.t === 'start');
    await wait(B, m => m.t === 'start');
    assert.equal(sa.world.items.length, 13);
    const you = sa.world.you;
    A.ws.send(JSON.stringify({ t: 'st', lv: you.level, x: you.x + 0.5, z: you.z, yaw: 1, pitch: 0, mv: true }));
    await wait(B, m => m.t === 'snap' && m.players.some(p => p.id === you.id && Math.abs(p.x - (you.x + 0.5)) < 1e-3));
    B.ws.send(JSON.stringify({ t: 'chat', text: 'я'.repeat(150) }));
    await wait(A, m => m.t === 'chat' && m.text.length === 150);
    A.ws.close(); B.ws.close();
  } finally { srv.kill(); }
});

console.log(`\nГотово: ${passed} тестов пройдено${process.exitCode ? ', ЕСТЬ ОШИБКИ' : ''}.`);
process.exit(process.exitCode || 0);
