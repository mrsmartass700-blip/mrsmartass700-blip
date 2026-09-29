// Автотесты: логика игры с «виртуальным временем» + настоящий сетевой прогон двух клиентов.
// Запуск: node test/sim.js
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Game } from '../server/game.js';
import { cellCenter, toCell, blocksPlayer, walkableForAI, moveCircle, MAX_DAYS } from '../shared/map.js';

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name, '\n', e); process.exitCode = 1; }
};

function fakeWs() {
  return { open: true, msgs: [], send(s) { this.msgs.push(JSON.parse(s)); }, close() { this.open = false; }, on() {} };
}

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
const place = (g, p, cx, cy) => { const c = cellCenter(cx, cy); p.x = c.x; p.z = c.z; p.lastCell = -1; };

console.log('Карта и поиск пути');
await test('все точки предметов достижимы для игрока (двери открыты)', () => {
  const { g } = makeGame(1);
  const m = g.map, open = m.doors.map(() => ({ open: true }));
  const seen = new Set([m.playerSpawn.y * m.w + m.playerSpawn.x]);
  const q = [[m.playerSpawn.x, m.playerSpawn.y]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = ny * m.w + nx;
      if (seen.has(k) || blocksPlayer(m, open, nx, ny)) continue;
      seen.add(k); q.push([nx, ny]);
    }
  }
  for (const s of m.itemSpawns) assert.ok(seen.has(s.y * m.w + s.x), `spawn ${s.x},${s.y}`);
  for (const h of m.hides) assert.ok(seen.has(h.exit.y * m.w + h.exit.x), `hide exit ${h.id}`);
  const o = m.grid.flatMap((r, y) => r.map((c, x) => c === 'O' ? y * m.w + x : -1)).filter(k => k >= 0);
  assert.ok(o.some(k => seen.has(k)), 'улица достижима');
});

await test('бабка находит путь в каждую комнату', () => {
  const { g } = makeGame(1);
  for (const r of g.map.rooms.filter(r => !r.outside)) {
    const [x, y] = r.floorCells[0];
    const path = g.ai.astar(g.map.grannySpawn.x, g.map.grannySpawn.y, x, y);
    assert.ok(path && path.length > 0, r.name);
    for (const c of path) assert.ok(walkableForAI(g.map, c % g.map.w, Math.floor(c / g.map.w)));
  }
});

await test('коллизия: сквозь стену не пройти', () => {
  const { g } = makeGame(1);
  const c = cellCenter(1, 3);
  const p = moveCircle(g.map, g.doors, c.x, c.z, -3, 0);
  assert.ok(p.x > 1.5 - 0.01, 'остановился у стены');
});

console.log('Предметы');
await test('раскладка: 9 предметов, ключи не заперты сами в себе', () => {
  for (let i = 0; i < 40; i++) {
    const { g } = makeGame(1);
    assert.equal(g.items.length, 9);
    const roomOf = (it) => g.map.rooms[g.map.roomOf[toCell(it.z)][toCell(it.x)]].name;
    const sk = g.items.find(it => it.type === 'storageKey'), stk = g.items.find(it => it.type === 'studyKey');
    assert.ok(!['Кладовка', 'Кабинет'].includes(roomOf(sk)), 'ключ кладовки снаружи');
    assert.notEqual(roomOf(stk), 'Кабинет');
    for (const t of ['padlockKey', 'hammer', 'pliers', 'spray']) assert.ok(g.items.some(it => it.type === t), t);
  }
});

await test('подобрать, поменять, бросить (шум), положить', () => {
  const { g, ps: [p] } = makeGame(1, 'practice');
  const [a, b] = g.items;
  p.x = a.x; p.z = a.z;
  g.handle(p, { t: 'interact', kind: 'item', id: a.id });
  assert.equal(p.held, a.id);
  p.x = b.x; p.z = b.z;
  g.handle(p, { t: 'interact', kind: 'item', id: b.id });
  assert.equal(p.held, b.id, 'обмен');
  assert.equal(a.holder, null);
  place(g, p, 15, 7); p.yaw = Math.PI / 2; // смотрим на -X по коридору
  g.handle(p, { t: 'throw' });
  assert.equal(p.held, null);
  if (b.type !== 'bottle') assert.ok(Math.hypot(b.x - p.x, b.z - p.z) > 3, 'улетел далеко');
});

console.log('Двери');
await test('обычная дверь открывается и закрывается', () => {
  const { g, ps: [p] } = makeGame(1, 'practice');
  const d = g.map.doors.find(d => !d.lock && !d.exit);
  place(g, p, d.x, d.y + (d.axis === 'x' ? 1 : 0));
  if (d.axis === 'z') place(g, p, d.x + 1, d.y);
  g.handle(p, { t: 'interact', kind: 'door', id: d.id });
  assert.equal(g.doors[d.id].open, true);
  g.handle(p, { t: 'interact', kind: 'door', id: d.id });
  assert.equal(g.doors[d.id].open, false);
});

await test('запертая дверь: без ключа нельзя, с ключом — да (ключ тратится)', () => {
  const { g, ps: [p] } = makeGame(1, 'practice');
  const d = g.map.doors.find(d => d.lock === 'storageKey');
  place(g, p, d.x, d.y - 1);
  g.handle(p, { t: 'interact', kind: 'door', id: d.id });
  assert.equal(g.doors[d.id].open, false);
  assert.ok(events(p, 'msg').some(m => /Заперто/.test(m.text)));
  const key = g.items.find(it => it.type === 'storageKey');
  key.holder = p.id; p.held = key.id;
  g.handle(p, { t: 'interact', kind: 'door', id: d.id });
  assert.equal(g.doors[d.id].open, true);
  assert.equal(g.doors[d.id].lock, null);
  assert.ok(!g.items.includes(key));
});

console.log('Побег');
await test('снять 3 замка, открыть дверь, выбежать — победа', () => {
  const { g, ps: [p, q] } = makeGame(2, 'practice');
  const d = g.map.doors.find(d => d.exit);
  place(g, p, d.x, d.y - 1);
  g.handle(p, { t: 'interact', kind: 'door', id: d.id });
  assert.equal(g.doors[d.id].open, false, 'заперто');
  for (const type of ['hammer', 'pliers', 'padlockKey']) {
    const it = g.items.find(i => i.type === type);
    it.holder = p.id; p.held = it.id;
    g.handle(p, { t: 'interact', kind: 'door', id: d.id });
  }
  assert.deepEqual(g.exitLocks, { padlock: false, boards: false, chain: false });
  g.handle(p, { t: 'interact', kind: 'door', id: d.id });
  assert.equal(g.doors[d.id].open, true);
  const out = cellCenter(d.x, d.y + 1);
  g.handle(p, { t: 'st', x: p.x, z: p.z + 1.4, yaw: 0, pitch: 0, mv: true });
  g.handle(p, { t: 'st', x: out.x, z: out.z, yaw: 0, pitch: 0, mv: true });
  assert.equal(g.phase, 'ended');
  assert.ok(events(q, 'end').some(m => m.result === 'win'), 'второй игрок тоже видит победу');
});

console.log('ИИ бабки');
await test('видит игрока, догоняет, ловит — наступает день 2 и респавн', () => {
  const { g, ps: [p] } = makeGame(1, 'normal');
  g.advance(0.1);
  g.ai.graceUntil = 0;
  // игрок стоит в коридоре, бабка — в том же коридоре, смотрит на него
  place(g, p, 20, 7);
  g.ai.x = cellCenter(30, 7).x; g.ai.z = cellCenter(30, 7).z; g.ai.yaw = Math.PI / 2; g.ai.state = 'patrol';
  g.advance(0.2);
  assert.equal(g.ai.state, 'chase');
  g.advance(8);
  assert.equal(p.state, 'knocked');
  assert.equal(g.day, 2);
  g.advance(4.5);
  assert.equal(p.state, 'alive');
  assert.ok(events(p, 'respawn').length === 1);
});

await test('бабка открывает закрытые двери, чтобы пройти', () => {
  const { g, ps: [p] } = makeGame(1, 'normal');
  g.ai.graceUntil = 0;
  place(g, p, 3, 3); p.state = 'knocked'; // игрок не мешает
  g.ai.state = 'investigate';
  g.ai.goal = cellCenter(3, 3); // в спальню через закрытую дверь
  let reached = false, openedAny = false;
  for (let i = 0; i < 40 * 4 && !reached; i++) {
    g.advance(0.25);
    openedAny ||= g.doors.some(d => d.open);
    reached = Math.hypot(g.ai.x - cellCenter(3, 3).x, g.ai.z - cellCenter(3, 3).z) < 1;
  }
  assert.ok(openedAny, 'хоть одна дверь открыта');
  assert.ok(reached, 'дошла до спальни');
});

await test('слышит шум (бутылка) и идёт проверить', () => {
  const { g, ps: [p] } = makeGame(1, 'normal');
  g.ai.graceUntil = 0; g.ai.state = 'patrol';
  p.state = 'knocked';
  g.ai.onNoise(cellCenter(26, 7).x, cellCenter(26, 7).z, 18);
  assert.equal(g.ai.state, 'investigate');
});

await test('спрятался незаметно — не ловит; спрятался на глазах — вытаскивает', () => {
  {
    const { g, ps: [p] } = makeGame(1, 'normal');
    g.ai.graceUntil = 0;
    const spot = g.map.hides.find(h => h.type === 'wardrobe' && g.map.rooms[h.room].name === 'Спальня');
    place(g, p, spot.exit.x, spot.exit.y);
    g.ai.x = cellCenter(30, 12).x; g.ai.z = cellCenter(30, 12).z; // далеко
    g.handle(p, { t: 'interact', kind: 'hide', id: spot.id });
    assert.equal(p.hidden, spot.id);
    g.advance(20);
    assert.equal(p.state, 'alive');
  }
  {
    const { g, ps: [p] } = makeGame(1, 'normal');
    g.ai.graceUntil = 0;
    const spot = g.map.hides.find(h => h.x === 1 && h.y === 5); // шкаф в спальне, выход на (1,4)
    place(g, p, spot.exit.x, spot.exit.y);
    const c = cellCenter(4, 4);
    g.ai.x = c.x; g.ai.z = c.z; g.ai.face(p);
    g.advance(0.1);
    assert.equal(g.ai.state, 'chase');
    g.handle(p, { t: 'interact', kind: 'hide', id: spot.id });
    assert.equal(g.ai.knownHide, spot.id, 'запомнила шкаф');
    g.advance(3);
    assert.equal(p.state, 'knocked', 'вытащила из шкафа');
    assert.ok(events(p, 'pull').length >= 1);
  }
});

await test('перцовый баллончик оглушает бабку', () => {
  const { g, ps: [p] } = makeGame(1, 'normal');
  g.ai.graceUntil = 0;
  place(g, p, 20, 7); p.yaw = -Math.PI / 2; // смотрим на +X
  g.ai.x = p.x + 3; g.ai.z = p.z;
  const spray = g.items.find(i => i.type === 'spray');
  spray.holder = p.id; p.held = spray.id;
  g.handle(p, { t: 'use' });
  assert.equal(g.ai.state, 'stunned');
  assert.equal(spray.charges, 2);
  g.advance(3);
  assert.equal(p.state, 'alive', 'оглушённая не ловит');
});

await test('капкан держит игрока и шумит', () => {
  const { g, ps: [p] } = makeGame(1, 'practice');
  place(g, p, 10, 7);
  g.placeTrap(cellCenter(11, 7).x, cellCenter(11, 7).z);
  g.handle(p, { t: 'st', x: cellCenter(11, 7).x, z: cellCenter(11, 7).z, yaw: 0, pitch: 0, mv: true });
  assert.ok(p.trappedUntil > g.now());
  assert.equal(g.traps.length, 0);
  const before = { x: p.x, z: p.z };
  g.handle(p, { t: 'st', x: p.x + 0.5, z: p.z, yaw: 0, pitch: 0, mv: true });
  assert.deepEqual({ x: p.x, z: p.z }, before, 'не двигается');
});

await test(`${MAX_DAYS} поимок — поражение`, () => {
  const { g, ps: [p, q] } = makeGame(2, 'normal');
  for (let i = 0; i < MAX_DAYS; i++) {
    (i % 2 ? q : p).state = 'alive';
    g.catchPlayer(i % 2 ? q : p);
    g.advance(4.5);
  }
  assert.equal(g.phase, 'ended');
  assert.ok(events(p, 'end').some(m => m.result === 'lose'));
});

await test('сервер отклоняет телепорт и проход сквозь закрытую дверь', () => {
  const { g, ps: [p] } = makeGame(1, 'practice');
  place(g, p, 3, 3);
  const was = { x: p.x, z: p.z };
  g.handle(p, { t: 'st', x: p.x + 20, z: p.z, yaw: 0, pitch: 0 });
  assert.deepEqual({ x: p.x, z: p.z }, was);
  const d = g.map.doors[0]; // закрытая дверь спальня-кухня
  const c = cellCenter(d.x, d.y);
  g.handle(p, { t: 'st', x: c.x - 1.4, z: c.z, yaw: 0, pitch: 0 });
  g.handle(p, { t: 'st', x: c.x, z: c.z, yaw: 0, pitch: 0 });
  assert.notEqual(toCell(p.x), d.x);
});

await test('лобби: хост меняет сложность, гость — нет; игрок заходит посреди игры', () => {
  const g = new Game(); g.stop();
  const a = g.addPlayer(fakeWs(), 'host'), b = g.addPlayer(fakeWs(), 'guest');
  g.handle(b, { t: 'difficulty', v: 'hard' });
  assert.equal(g.difficulty, 'normal');
  g.handle(a, { t: 'difficulty', v: 'hard' });
  assert.equal(g.difficulty, 'hard');
  g.handle(a, { t: 'start' });
  assert.equal(g.phase, 'lobby', 'гость не готов');
  g.handle(b, { t: 'ready', v: true });
  g.handle(a, { t: 'start' });
  assert.equal(g.phase, 'playing');
  const c = g.addPlayer(fakeWs(), 'late');
  assert.ok(c.ws.msgs.some(m => m.t === 'start'));
  g.removePlayer(a);
  assert.equal(g.hostId, b.id, 'хост передан');
});

await test('долгий прогон: 3 минуты ИИ с двумя игроками без исключений', () => {
  const { g, ps } = makeGame(2, 'nightmare');
  for (let s = 0; s < 180 * 20; s++) {
    // боты бродят случайно
    for (const p of ps) {
      if (p.state !== 'alive' || p.hidden !== null) continue;
      p.yaw += (Math.random() - 0.5) * 0.4;
      const n = moveCircle(g.map, g.doors, p.x, p.z, -Math.sin(p.yaw) * 0.15, -Math.cos(p.yaw) * 0.15);
      g.handle(p, { t: 'st', x: n.x, z: n.z, yaw: p.yaw, pitch: 0, mv: true, run: Math.random() < 0.3, fl: true });
      if (Math.random() < 0.01) {
        const d = g.map.doors.find(d => Math.hypot(cellCenter(d.x, d.y).x - p.x, cellCenter(d.x, d.y).z - p.z) < 2.5);
        if (d) g.handle(p, { t: 'interact', kind: 'door', id: d.id });
      }
    }
    g.advance(0.05);
    if (g.phase !== 'playing') break;
  }
  assert.ok(Number.isFinite(g.ai.x) && Number.isFinite(g.ai.z));
  assert.ok(walkableForAI(g.map, toCell(g.ai.x), toCell(g.ai.z)), 'бабка не в стене');
});

// ---------------- настоящий сервер + 2 WebSocket-клиента ----------------
console.log('Сеть (реальный сервер, 2 клиента)');
await test('два клиента подключаются, стартуют и получают снапшоты', async () => {
  const PORT = 17777;
  const srv = spawn(process.execPath, ['server/index.js', String(PORT), '--no-browser'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  srv.stdout.on('data', d => { out += d; });
  srv.stderr.on('data', d => { out += d; });
  try {
    for (let i = 0; i < 50 && !out.includes('сервер запущен'); i++) await new Promise(r => setTimeout(r, 100));
    assert.ok(out.includes('сервер запущен'), out);
    const html = await (await fetch(`http://127.0.0.1:${PORT}/`)).text();
    assert.ok(html.includes('Бабка'));
    assert.equal((await fetch(`http://127.0.0.1:${PORT}/shared/map.js`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${PORT}/vendor/three.module.min.js`)).status, 200);
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
    await wait(B, m => m.t === 'welcome' && !m.host);
    B.ws.send(JSON.stringify({ t: 'ready', v: true }));
    await wait(A, m => m.t === 'lobby' && m.players.length === 2 && m.players.some(p => p.ready));
    A.ws.send(JSON.stringify({ t: 'start' }));
    const sa = await wait(A, m => m.t === 'start'), sb = await wait(B, m => m.t === 'start');
    assert.equal(sa.world.items.length, 9);
    assert.deepEqual(sa.world.items.map(i => i.id), sb.world.items.map(i => i.id));
    await wait(B, m => m.t === 'snap' && m.players.length === 2);
    // движение хоста видно гостю
    const you = sa.world.you;
    A.ws.send(JSON.stringify({ t: 'st', x: you.x + 0.5, z: you.z, yaw: 1, pitch: 0, mv: true }));
    await wait(B, m => m.t === 'snap' && m.players.some(p => p.id === you.id && Math.abs(p.x - (you.x + 0.5)) < 1e-3));
    // чат
    B.ws.send(JSON.stringify({ t: 'chat', text: 'бабка за тобой!' }));
    await wait(A, m => m.t === 'chat' && m.text === 'бабка за тобой!');
    // длинное сообщение (>125 байт, 16-битная длина кадра)
    A.ws.send(JSON.stringify({ t: 'chat', text: 'я'.repeat(150) }));
    await wait(B, m => m.t === 'chat' && m.from === 'Хост' && m.text.length === 150);
    A.ws.close(); B.ws.close();
  } finally { srv.kill(); }
});

console.log(`\nГотово: ${passed} тестов пройдено${process.exitCode ? ', ЕСТЬ ОШИБКИ' : ''}.`);
process.exit(process.exitCode || 0);
