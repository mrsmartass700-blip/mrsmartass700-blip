// Общая карта дома (3 уровня), правила движения, лестницы, предметы и выходы.
// Используется и сервером (Node), и клиентом (браузер).
import { LEVEL_ROWS } from './levels.js';

export const CELL = 1.5;      // размер клетки, м
export const WALL_H = 2.8;    // высота потолка, м
export const FLOOR_H = 3.0;   // расстояние между этажами, м
export const PLAYER_R = 0.3;
export const MAX_DAYS = 5;
export const LEVELS = [-1, 0, 1];
export { LEVEL_ROWS };

// Легенда клеток:
//  #  стена   .  пол   i  точка предмета   P  спавн игроков   g  спавн бабки
//  D  дверь   K  кладовка (ключ)   Q  кабинет (ключ)   X  входная дверь   G  ворота гаража   V  решётка канализации (в полу)
//  O  двор (побег)   R  подъездная дорога (за воротами)
//  ^  ступени (на нижнем этаже)   _  проём лестницы (на верхнем)
//  W  шкаф   B  кровать   T  стол   Y  ванна   — в них можно спрятаться
//  C  тумба/плита/верстак   S  диван   A  кресло   L  полки   E  камин   F  холодильник   M  напольные часы   Z  машина
export const STAIRS = [
  { id: 0, from: 0, cells: [[14, 15], [14, 14], [14, 13]], dir: [0, -1], name: 'Лестница на второй этаж' },
  { id: 1, from: -1, cells: [[21, 6], [21, 5], [21, 4]], dir: [0, -1], name: 'Лестница в подвал' },
];

// клетки-«арки»: проходимы, но разделяют комнаты при заливке
const ROOM_BOUNDARIES = {
  '0': [[10, 10], [11, 10], [12, 10], [13, 10]],
  '1': [[10, 10], [11, 10], [12, 10], [13, 10]],
  '-1': [[17, 7], [17, 8], [17, 9]],
};

export const ROOM_SEEDS = [
  { level: 1, x: 4, y: 3, name: 'Спальня' },
  { level: 1, x: 12, y: 4, name: 'Детская' },
  { level: 1, x: 18, y: 3, name: 'Комната бабки' },
  { level: 1, x: 10, y: 8, name: 'Коридор 2 этажа' },
  { level: 1, x: 4, y: 13, name: 'Библиотека' },
  { level: 1, x: 10, y: 13, name: 'Верхний холл' },
  { level: 1, x: 19, y: 13, name: 'Ванная наверху' },
  { level: 0, x: 4, y: 3, name: 'Гостиная' },
  { level: 0, x: 11, y: 5, name: 'Столовая' },
  { level: 0, x: 19, y: 3, name: 'Кухня' },
  { level: 0, x: 24, y: 12, name: 'Гараж' },
  { level: 0, x: 10, y: 8, name: 'Коридор' },
  { level: 0, x: 3, y: 12, name: 'Кабинет', locked: true },
  { level: 0, x: 11, y: 13, name: 'Прихожая' },
  { level: 0, x: 19, y: 13, name: 'Ванная' },
  { level: 0, x: 12, y: 18, name: 'Двор', outside: true },
  { level: 0, x: 24, y: 18, name: 'Дорога', outside: true },
  { level: -1, x: 19, y: 6, name: 'Котельная', dark: true },
  { level: -1, x: 4, y: 3, name: 'Кладовка', locked: true, dark: true },
  { level: -1, x: 12, y: 3, name: 'Мастерская', dark: true },
  { level: -1, x: 8, y: 8, name: 'Подвал', dark: true },
  { level: -1, x: 4, y: 13, name: 'Канализационная', dark: true },
  { level: -1, x: 12, y: 13, name: 'Винный погреб', dark: true },
  { level: -1, x: 19, y: 13, name: 'Камера', dark: true },
];

export const ITEMS = {
  padlockKey: { name: 'Ключ от навесного замка', short: 'Ключ (замок)', color: 0xd4af37, model: 'key' },
  hammer:     { name: 'Молоток', short: 'Молоток', color: 0x8a5a2b, model: 'hammer' },
  pliers:     { name: 'Кусачки', short: 'Кусачки', color: 0xc0392b, model: 'pliers' },
  carKey:     { name: 'Ключ от машины', short: 'Ключ (машина)', color: 0x222222, model: 'carkey' },
  fuel:       { name: 'Канистра с бензином', short: 'Канистра', color: 0xb03020, model: 'fuel' },
  wrench:     { name: 'Гаечный ключ', short: 'Гаечный ключ', color: 0x9aa0a6, model: 'wrench' },
  crowbar:    { name: 'Лом', short: 'Лом', color: 0x8a1c1c, model: 'crowbar' },
  storageKey: { name: 'Ключ от кладовки (подвал)', short: 'Ключ (кладовка)', color: 0x3498db, model: 'key' },
  studyKey:   { name: 'Ключ от кабинета', short: 'Ключ (кабинет)', color: 0x2ecc71, model: 'key' },
  spray:      { name: 'Перцовый баллончик', short: 'Баллончик', color: 0xe67e22, model: 'spray', charges: 3 },
  bottle:     { name: 'Бутылка (бросить Q — громко разобьётся)', short: 'Бутылка', color: 0x3f7f3f, model: 'bottle' },
  teddy:      { name: 'Плюшевый мишка (бросить Q — отвлечь)', short: 'Мишка', color: 0x9b6b43, model: 'teddy' },
};

export const DOOR_LOCKS = { K: 'storageKey', Q: 'studyKey' };

// Три способа побега
export const EXITS = {
  front: { name: 'Входная дверь', locks: { padlock: { item: 'padlockKey', name: 'навесной замок' }, boards: { item: 'hammer', name: 'доски' }, chain: { item: 'pliers', name: 'цепь' } } },
  car:   { name: 'Машина в гараже', locks: { fuel: { item: 'fuel', name: 'бензин' }, key: { item: 'carKey', name: 'ключ зажигания' } } },
  sewer: { name: 'Канализация в подвале', locks: { bolts: { item: 'wrench', name: 'болты' }, grate: { item: 'crowbar', name: 'решётка' } } },
};

export const DIFFICULTIES = {
  practice:  { name: 'Практика (без бабки)', ai: false },
  easy:      { name: 'Лёгкая', ai: true, speed: 0.82, hearing: 0.7, view: 12, lose: 3.5, stun: 20, traps: 2, trapEvery: 120, grace: 10 },
  normal:    { name: 'Нормальная', ai: true, speed: 1.0, hearing: 1.0, view: 16, lose: 5, stun: 15, traps: 4, trapEvery: 75, grace: 7 },
  hard:      { name: 'Сложная', ai: true, speed: 1.15, hearing: 1.3, view: 19, lose: 7, stun: 11, traps: 5, trapEvery: 55, grace: 5 },
  nightmare: { name: 'Кошмар', ai: true, speed: 1.3, hearing: 1.6, view: 22, lose: 9, stun: 8, traps: 7, trapEvery: 40, grace: 3, dark: true },
};

// ---------------- классификация клеток ----------------
export const isWallChar = (c) => c === '#' || c === undefined;
export const isDoorChar = (c) => c === 'D' || c === 'K' || c === 'Q' || c === 'X' || c === 'G';
export const isFloorChar = (c) => c === '.' || c === 'i' || c === 'P' || c === 'g' || c === 'V';
export const HIDE_CHARS = { W: 'wardrobe', B: 'bed', T: 'table', Y: 'bath' };
export const isFurnitureChar = (c) => 'WBTYCSALEFMZ'.includes(c) && c !== undefined && c !== '';
export const isOpaqueChar = (c) => c === '#' || c === 'W' || c === 'L' || c === 'F' || c === 'M' || c === undefined;

export const cellCenter = (x, y) => ({ x: (x + 0.5) * CELL, z: (y + 0.5) * CELL });
export const toCell = (v) => Math.floor(v / CELL);

// ---------------- разбор ----------------
export function buildMap() {
  const h = LEVEL_ROWS['0'].length, w = LEVEL_ROWS['0'][0].length;
  const levels = {};
  const doors = [], hides = [], itemSpawns = [];
  let playerSpawn = null, grannySpawn = null, car = null;
  for (const L of LEVELS) {
    const rows = LEVEL_ROWS[String(L)];
    if (rows.length !== h || rows.some(r => r.length !== w)) throw new Error('Level size mismatch ' + L);
    const grid = rows.map(r => r.split(''));
    levels[L] = { grid, roomOf: grid.map(r => r.map(() => -1)), doorAt: {}, hideAt: {} };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = grid[y][x];
      if (isDoorChar(c)) {
        if (c === 'G' && grid[y][x - 1] === 'G') { levels[L].doorAt[y * w + x] = doors[doors.length - 1]; continue; }
        const wallLR = isWallChar(grid[y][x - 1]) || grid[y][x - 1] === 'G' || isWallChar(grid[y][x + 1]) || grid[y][x + 1] === 'G';
        const d = { id: doors.length, level: L, x, y, axis: wallLR && !(isWallChar(grid[y - 1]?.[x]) && isWallChar(grid[y + 1]?.[x])) ? 'x' : 'z',
          lock: DOOR_LOCKS[c] || null, kind: c === 'X' ? 'front' : c === 'G' ? 'garage' : 'door', cells: [[x, y]] };
        if (c === 'G') { d.axis = 'x'; if (grid[y][x + 1] === 'G') d.cells.push([x + 1, y]); }
        doors.push(d);
        levels[L].doorAt[y * w + x] = d;
      } else if (c === 'V') {
        const d = { id: doors.length, level: L, x, y, axis: 'x', lock: null, kind: 'grate', cells: [[x, y]] };
        doors.push(d); levels[L].doorAt[y * w + x] = d;
      } else if (HIDE_CHARS[c]) {
        const hd = { id: hides.length, level: L, x, y, type: HIDE_CHARS[c] };
        hides.push(hd); levels[L].hideAt[y * w + x] = hd;
      } else if (c === 'i') itemSpawns.push({ level: L, x, y });
      else if (c === 'P') playerSpawn = { level: L, x, y };
      else if (c === 'g') grannySpawn = { level: L, x, y };
      else if (c === 'Z') {
        car ||= { level: L, cells: [] };
        car.cells.push([x, y]);
      }
    }
  }
  if (car) {
    const xs = car.cells.map(c => c[0]), ys = car.cells.map(c => c[1]);
    car.cx = (Math.min(...xs) + Math.max(...xs) + 1) / 2 * CELL;
    car.cz = (Math.min(...ys) + Math.max(...ys) + 1) / 2 * CELL;
  }

  // лестницы: производные клетки
  const stairs = STAIRS.map(s => {
    const [dx, dy] = s.dir;
    const first = s.cells[0], top = s.cells[s.cells.length - 1];
    return { ...s, approach: [first[0] - dx, first[1] - dy], top, landing: [top[0] + dx, top[1] + dy], to: s.from + 1 };
  });

  // комнаты: заливка по уровням
  const rooms = [];
  for (const seed of ROOM_SEEDS) {
    const lv = levels[seed.level];
    const id = rooms.length, cells = [];
    const stack = [[seed.x, seed.y]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= w || y >= h || lv.roomOf[y][x] !== -1) continue;
      const c = lv.grid[y][x];
      if (c === '#' || isDoorChar(c) || c === '_') continue;
      if ((ROOM_BOUNDARIES[String(seed.level)] || []).some(b => b[0] === x && b[1] === y)) continue;
      lv.roomOf[y][x] = id;
      cells.push([x, y]);
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    let sx = 0, sy = 0;
    for (const [x, y] of cells) { sx += x; sy += y; }
    rooms.push({ id, level: seed.level, name: seed.name, locked: !!seed.locked, outside: !!seed.outside, dark: !!seed.dark,
      cells, floorCells: cells.filter(([x, y]) => isFloorChar(lv.grid[y][x]) && lv.grid[y][x] !== 'V'),
      cx: sx / Math.max(1, cells.length), cy: sy / Math.max(1, cells.length) });
  }
  // арки относим к соседней комнате
  for (const [Ls, list] of Object.entries(ROOM_BOUNDARIES)) for (const [x, y] of list) {
    const lv = levels[Number(Ls)];
    const n = [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]].map(([a, b]) => lv.roomOf[b]?.[a]).find(r => r >= 0);
    if (n !== undefined) { lv.roomOf[y][x] = n; rooms[n].cells.push([x, y]); }
  }
  const roomAt = (L, x, y) => levels[L]?.roomOf[y]?.[x] ?? -1;
  for (const s of itemSpawns) s.room = roomAt(s.level, s.x, s.y);
  for (const hd of hides) hd.room = roomAt(hd.level, hd.x, hd.y);
  for (const d of doors) {
    const n = d.axis === 'x' ? [[d.x, d.y - 1], [d.x, d.y + 1]] : [[d.x - 1, d.y], [d.x + 1, d.y]];
    d.rooms = n.map(([x, y]) => roomAt(d.level, x, y));
  }
  // где стоит игрок, когда вылезает из укрытия
  for (const hd of hides) {
    const g = levels[hd.level].grid;
    const opts = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([dx, dy]) => [hd.x + dx, hd.y + dy])
      .filter(([x, y]) => isFloorChar(g[y]?.[x]));
    const [ex, ey] = opts[0] || [hd.x, hd.y + 1];
    hd.exit = { x: ex, y: ey };
  }
  const grate = doors.find(d => d.kind === 'grate');
  return { w, h, levels, doors, hides, itemSpawns, rooms, stairs, playerSpawn, grannySpawn, car, grate, roomAt };
}

export const charAt = (map, L, cx, cy) => map.levels[L]?.grid[cy]?.[cx];

// ---------------- лестницы ----------------
const same = (a, x, y) => a[0] === x && a[1] === y;
const runIndex = (s, x, y) => s.cells.findIndex(c => same(c, x, y));

// контекст положения сущности относительно лестниц
export function stairCtx(map, L, x, z) {
  const cx = toCell(x), cy = toCell(z);
  for (const s of map.stairs) {
    if (L === s.from) {
      const i = runIndex(s, cx, cy);
      if (i >= 0) return { stair: s, onRun: true, atTop: i === s.cells.length - 1, index: i };
      if (same(s.approach, cx, cy)) return { stair: s, atApproach: true };
    } else if (L === s.to && same(s.landing, cx, cy)) return { stair: s, atLanding: true };
  }
  return null;
}

// высота пола под точкой
export function heightAt(map, L, x, z) {
  const base = L * FLOOR_H;
  const cx = toCell(x), cy = toCell(z);
  for (const s of map.stairs) {
    if (L !== s.from || runIndex(s, cx, cy) < 0) continue;
    const [dx, dy] = s.dir;
    const b = s.cells[0], n = s.cells.length;
    // расстояние вдоль марша от нижнего края первой ступени
    const startX = (b[0] + 0.5 - dx * 0.5) * CELL, startZ = (b[1] + 0.5 - dy * 0.5) * CELL;
    const along = (x - startX) * dx + (z - startZ) * dy;
    return base + Math.max(0, Math.min(1, along / (n * CELL))) * FLOOR_H;
  }
  return base;
}

// блокирует ли клетка движение (с учётом лестниц и контекста сущности)
export function blocksMove(map, doorState, L, cx, cy, ctx = null) {
  // на верхней ступени: площадка берётся с верхнего этажа
  if (ctx?.onRun && ctx.atTop && same(ctx.stair.landing, cx, cy)) return blocksMove(map, doorState, ctx.stair.to, cx, cy, null);
  const c = charAt(map, L, cx, cy);
  if (c === undefined || c === '#') return true;
  if (c === '^') {
    // на ступени — только вдоль своего марша или с нижней площадки
    for (const s of map.stairs) if (s.from === L && runIndex(s, cx, cy) >= 0) return !(ctx && ctx.stair === s && (ctx.onRun || ctx.atApproach));
    return true;
  }
  if (ctx?.onRun) {
    // с лестницы нельзя шагнуть вбок: только ступени, нижняя площадка, верх
    const s = ctx.stair;
    if (!same(s.approach, cx, cy) && runIndex(s, cx, cy) < 0) return true;
  }
  if (c === '_') return !(ctx?.atLanding && same(ctx.stair.top, cx, cy));
  if (isFurnitureChar(c)) return true;
  if (c === 'O' || c === 'R') return c === 'R';
  if (isDoorChar(c)) {
    const d = map.levels[L].doorAt[cy * map.w + cx];
    return !doorState[d.id].open || d.kind === 'garage';
  }
  return false;
}

// Движение круга с коллизиями по клеткам и переходами между этажами.
// ent: { level, x, z } -> { level, x, z, y }
export function moveEntity(map, doorState, ent, dx, dz, r = PLAYER_R) {
  const L = ent.level;
  const ctx = stairCtx(map, L, ent.x, ent.z);
  const collides = (px, pz) => {
    const x0 = toCell(px - r), x1 = toCell(px + r), y0 = toCell(pz - r), y1 = toCell(pz + r);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (!blocksMove(map, doorState, L, cx, cy, ctx)) continue;
      const nx = Math.max(cx * CELL, Math.min(px, (cx + 1) * CELL));
      const nz = Math.max(cy * CELL, Math.min(pz, (cy + 1) * CELL));
      if ((nx - px) ** 2 + (nz - pz) ** 2 < r * r) return true;
    }
    return false;
  };
  let x = ent.x, z = ent.z;
  if (!collides(x + dx, z)) x += dx;
  if (!collides(x, z + dz)) z += dz;
  let level = L;
  const cx = toCell(x), cy = toCell(z);
  if (ctx?.stair) {
    const s = ctx.stair;
    if (L === s.from && same(s.landing, cx, cy)) level = s.to;
    else if (L === s.to && same(s.top, cx, cy)) level = s.from;
  }
  return { level, x, z, y: heightAt(map, level, x, z) };
}

// Для ИИ: проходимость клетки (двери она открывает сама; выходы и мебель — нет)
export function walkableForAI(map, L, cx, cy) {
  const c = charAt(map, L, cx, cy);
  if (c === undefined) return false;
  if (c === 'X' || c === 'G' || c === 'O' || c === 'R' || c === '_') return false;
  return isFloorChar(c) || c === 'D' || c === 'K' || c === 'Q' || c === '^';
}

export function blocksSight(map, doorState, L, cx, cy) {
  const c = charAt(map, L, cx, cy);
  if (isOpaqueChar(c)) return true;
  if (isDoorChar(c)) { const d = map.levels[L].doorAt[cy * map.w + cx]; return d.kind === 'garage' || !doorState[d.id].open; }
  return false;
}

// Прямая видимость на одном этаже
export function lineOfSight(map, doorState, L, ax, az, bx, bz) {
  const dist = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(dist / 0.2);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (blocksSight(map, doorState, L, toCell(ax + (bx - ax) * t), toCell(az + (bz - az) * t))) return false;
  }
  return true;
}

// «этаж для глаз»: на лестнице выше середины — уже верхний этаж
export function visualLevel(map, L, x, z) {
  const y = heightAt(map, L, x, z);
  return Math.round(y / FLOOR_H);
}
