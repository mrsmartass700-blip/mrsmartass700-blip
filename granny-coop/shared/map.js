// Общая карта дома и справочники. Используется и сервером (Node), и клиентом (браузер).

export const CELL = 1.5;      // размер клетки, м
export const WALL_H = 2.8;    // высота потолка, м
export const PLAYER_R = 0.3;  // радиус игрока для коллизий
export const MAX_DAYS = 5;

// Легенда:
//  #  стена            .  пол             i  точка появления предмета
//  D  дверь            K  дверь кладовки (заперта)   Q  дверь кабинета (заперта)
//  X  входная дверь (выход)   O  улица (зона побега)
//  W  шкаф (спрятаться)       B  кровать (спрятаться под ней)
//  T  стол   C  тумба/шкафчик   S  диван
//  P  спавн игроков           G  спавн бабки
export const MAP_ROWS = [
  '####################################',
  '#BB..W.#CCCC..CCCC#C...C#W....BB..W#',
  '#......#.........i#.....#..........#',
  '#..P...D...TT.....#..i..D....G.....#',
  '#i.....#...TT.....#.....#.i......i.#',
  '#W.....#C........i#.....#.........W#',
  '####D########D######D########D######',
  '#..................................#',
  '#..i.............................i.#',
  '###K########D#####D######Q#####D####',
  '#i.....#..............W#......#....#',
  '#..C...#..SSS......i...#.TT..i#...W#',
  '#C....i#...............#i.....#.i..#',
  '#C.....#..TT...........#C...CC#W...#',
  '###############X####################',
  '##############OOO###################',
  '####################################',
];

// Подписи комнат: точка внутри комнаты -> название
export const ROOM_SEEDS = [
  { x: 3, y: 3, name: 'Спальня' },
  { x: 12, y: 2, name: 'Кухня' },
  { x: 21, y: 2, name: 'Ванная' },
  { x: 29, y: 4, name: 'Комната бабки' },
  { x: 10, y: 7, name: 'Коридор' },
  { x: 3, y: 11, name: 'Кладовка', locked: true },
  { x: 15, y: 11, name: 'Гостиная' },
  { x: 27, y: 12, name: 'Кабинет', locked: true },
  { x: 33, y: 12, name: 'Столовая' },
  { x: 15, y: 15, name: 'Улица', outside: true },
];

export const ITEMS = {
  padlockKey: { name: 'Ключ от навесного замка', short: 'Ключ (замок)', color: 0xd4af37, model: 'key' },
  hammer:     { name: 'Молоток', short: 'Молоток', color: 0x8a5a2b, model: 'hammer' },
  pliers:     { name: 'Кусачки', short: 'Кусачки', color: 0xc0392b, model: 'pliers' },
  storageKey: { name: 'Ключ от кладовки', short: 'Ключ (кладовка)', color: 0x3498db, model: 'key' },
  studyKey:   { name: 'Ключ от кабинета', short: 'Ключ (кабинет)', color: 0x2ecc71, model: 'key' },
  spray:      { name: 'Перцовый баллончик', short: 'Баллончик', color: 0xe67e22, model: 'spray', charges: 3 },
  bottle:     { name: 'Бутылка (отвлечь — бросить Q)', short: 'Бутылка', color: 0x3f7f3f, model: 'bottle' },
  teddy:      { name: 'Плюшевый мишка (бросить Q — шум)', short: 'Мишка', color: 0x9b6b43, model: 'teddy' },
};

// Какой предмет открывает какой замок
export const DOOR_LOCKS = { K: 'storageKey', Q: 'studyKey' };
export const EXIT_LOCKS = {
  padlock: { item: 'padlockKey', name: 'навесной замок' },
  boards:  { item: 'hammer', name: 'доски' },
  chain:   { item: 'pliers', name: 'цепь' },
};

export const DIFFICULTIES = {
  practice:  { name: 'Практика (без бабки)', ai: false },
  easy:      { name: 'Лёгкая', ai: true, speed: 0.82, hearing: 0.7, view: 12, lose: 3.5, stun: 20, traps: 1, trapEvery: 120, grace: 10 },
  normal:    { name: 'Нормальная', ai: true, speed: 1.0, hearing: 1.0, view: 16, lose: 5, stun: 15, traps: 3, trapEvery: 75, grace: 7 },
  hard:      { name: 'Сложная', ai: true, speed: 1.15, hearing: 1.3, view: 19, lose: 7, stun: 11, traps: 4, trapEvery: 55, grace: 5 },
  nightmare: { name: 'Кошмар', ai: true, speed: 1.3, hearing: 1.6, view: 22, lose: 9, stun: 8, traps: 6, trapEvery: 40, grace: 3, dark: true },
};

// ---------- разбор карты ----------
export function parseMap() {
  const h = MAP_ROWS.length, w = MAP_ROWS[0].length;
  const grid = MAP_ROWS.map(r => r.split(''));
  for (const r of MAP_ROWS) if (r.length !== w) throw new Error('Map row length mismatch: ' + r);
  const doors = [], hides = [], itemSpawns = [];
  let playerSpawn = null, grannySpawn = null;

  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = grid[y][x];
    if (c === 'D' || c === 'K' || c === 'Q' || c === 'X') {
      // ориентация: стены слева и справа -> полотно вдоль X (проход по Z)
      const wallLR = isWallChar(grid[y][x - 1]) && isWallChar(grid[y][x + 1]);
      doors.push({ id: doors.length, x, y, axis: wallLR ? 'x' : 'z', lock: DOOR_LOCKS[c] || null, exit: c === 'X' });
    } else if (c === 'W' || c === 'B') {
      hides.push({ id: hides.length, x, y, type: c === 'W' ? 'wardrobe' : 'bed' });
    } else if (c === 'i') itemSpawns.push({ x, y });
    else if (c === 'P') playerSpawn = { x, y };
    else if (c === 'G') grannySpawn = { x, y };
  }

  // комнаты: заливка по клеткам, не являющимся стеной/дверью
  const roomOf = grid.map(r => r.map(() => -1));
  const rooms = [];
  for (const seed of ROOM_SEEDS) {
    const id = rooms.length;
    const cells = [];
    const stack = [[seed.x, seed.y]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= w || y >= h || roomOf[y][x] !== -1) continue;
      const c = grid[y][x];
      if (c === '#' || isDoorChar(c)) continue;
      roomOf[y][x] = id;
      cells.push([x, y]);
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    let sx = 0, sy = 0;
    for (const [x, y] of cells) { sx += x; sy += y; }
    const floorCells = cells.filter(([x, y]) => isFloorChar(grid[y][x]));
    rooms.push({ id, name: seed.name, locked: !!seed.locked, outside: !!seed.outside, cells, floorCells,
      cx: sx / cells.length, cy: sy / cells.length });
  }
  for (const s of itemSpawns) s.room = roomOf[s.y][s.x];
  for (const hd of hides) hd.room = roomOf[hd.y][hd.x];
  // к какой комнате ведёт дверь (соседи)
  for (const d of doors) {
    const n = d.axis === 'x' ? [[d.x, d.y - 1], [d.x, d.y + 1]] : [[d.x - 1, d.y], [d.x + 1, d.y]];
    d.rooms = n.map(([x, y]) => (roomOf[y] && roomOf[y][x] !== undefined) ? roomOf[y][x] : -1);
  }
  // точка, где стоит игрок, когда лезет в укрытие (ближайшая свободная клетка)
  for (const hd of hides) {
    const opts = [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dx, dy]) => [hd.x + dx, hd.y + dy])
      .filter(([x, y]) => isFloorChar(grid[y]?.[x]));
    const [ex, ey] = opts[0] || [hd.x, hd.y + 1];
    hd.exit = { x: ex, y: ey };
  }
  return { w, h, grid, doors, hides, itemSpawns, playerSpawn, grannySpawn, rooms, roomOf };
}

export function isWallChar(c) { return c === '#' || c === undefined; }
export function isDoorChar(c) { return c === 'D' || c === 'K' || c === 'Q' || c === 'X'; }
export function isFloorChar(c) { return c === '.' || c === 'i' || c === 'P' || c === 'G'; }
export function isFurnitureChar(c) { return c === 'W' || c === 'B' || c === 'T' || c === 'C' || c === 'S'; }
export function isOpaqueChar(c) { return c === '#' || c === 'W' || c === undefined; }

export const cellCenter = (x, y) => ({ x: (x + 0.5) * CELL, z: (y + 0.5) * CELL });
export const toCell = (v) => Math.floor(v / CELL);

// Состояние дверей: массив {open, lock}; exitLocks: {padlock:bool,...}
// Блокирует ли клетка движение игрока
export function blocksPlayer(map, doorState, cx, cy) {
  const c = map.grid[cy]?.[cx];
  if (c === undefined || c === '#') return true;
  if (isFurnitureChar(c)) return true;
  if (isDoorChar(c)) {
    const d = map.doorAt[cy * map.w + cx];
    return !doorState[d.id].open;
  }
  return false;
}

// Для ИИ: мебель и улица непроходимы, двери проходимы (она их открывает), выход — нет
export function walkableForAI(map, cx, cy) {
  const c = map.grid[cy]?.[cx];
  if (c === undefined) return false;
  if (c === 'X' || c === 'O') return false;
  return isFloorChar(c) || isDoorChar(c);
}

export function blocksSight(map, doorState, cx, cy) {
  const c = map.grid[cy]?.[cx];
  if (isOpaqueChar(c)) return true;
  if (isDoorChar(c)) return !doorState[map.doorAt[cy * map.w + cx].id].open;
  return false;
}

export function buildMap() {
  const m = parseMap();
  m.doorAt = {};
  for (const d of m.doors) m.doorAt[d.y * m.w + d.x] = d;
  m.hideAt = {};
  for (const hd of m.hides) m.hideAt[hd.y * m.w + hd.x] = hd;
  return m;
}

// Движение круга с коллизиями по клеткам (по осям). Возвращает новую позицию.
export function moveCircle(map, doorState, x, z, dx, dz, r = PLAYER_R) {
  const collides = (px, pz) => {
    const x0 = toCell(px - r), x1 = toCell(px + r), y0 = toCell(pz - r), y1 = toCell(pz + r);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (!blocksPlayer(map, doorState, cx, cy)) continue;
      // точная проверка круг-прямоугольник
      const nx = Math.max(cx * CELL, Math.min(px, (cx + 1) * CELL));
      const nz = Math.max(cy * CELL, Math.min(pz, (cy + 1) * CELL));
      if ((nx - px) ** 2 + (nz - pz) ** 2 < r * r) return true;
    }
    return false;
  };
  let nx = x + dx, nz = z;
  if (collides(nx, nz)) nx = x;
  let nz2 = nz + dz;
  if (collides(nx, nz2)) nz2 = nz;
  return { x: nx, z: nz2, stuck: collides(nx, nz2) };
}

// Прямая видимость между точками (по клеткам)
export function lineOfSight(map, doorState, ax, az, bx, bz) {
  const dist = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(dist / 0.2);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const cx = toCell(ax + (bx - ax) * t), cy = toCell(az + (bz - az) * t);
    if (blocksSight(map, doorState, cx, cy)) return false;
  }
  return true;
}
