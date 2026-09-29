// ИИ бабки. Работает целиком на сервере (авторитетно), клиенты только рисуют.
import { CELL, cellCenter, toCell, walkableForAI, lineOfSight, isDoorChar } from '../shared/map.js';

const FOV = (125 * Math.PI) / 180;
const SENSE_R = 2.2;        // «чует» вплотную в любую сторону
const BASE = { patrol: 1.55, investigate: 2.2, chase: 3.35 };
const rand = (a, b) => a + Math.random() * (b - a);
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

export class Granny {
  constructor(game) {
    this.game = game;
    this.map = game.map;
    this.reset(true);
  }

  get cfg() { return this.game.cfg; }

  reset(initial = false) {
    const c = cellCenter(this.map.grannySpawn.x, this.map.grannySpawn.y);
    this.x = c.x; this.z = c.z; this.yaw = Math.PI;
    this.state = 'idle';
    this.anim = 'idle';
    this.goal = null;
    this.path = null; this.pathGoalKey = -1; this.repathAt = 0;
    this.targetId = null; this.lastSeen = null; this.lastSeenT = -99; this.knownHide = null;
    this.idleUntil = 0; this.lookUntil = 0; this.lookBase = 0;
    this.searchPoints = [];
    this.doorWaitUntil = 0;
    this.relock = [];
    this.attackAt = 0;
    this.stunUntil = 0; this.stunFrom = null;
    const now = this.game.now();
    this.graceUntil = now + (initial ? this.cfg.grace + 5 : this.cfg.grace);
    this.nextTrapAt = now + this.cfg.trapEvery * rand(0.5, 1);
    this.moving = false;
  }

  snapshot() {
    return { x: +this.x.toFixed(3), z: +this.z.toFixed(3), yaw: +this.yaw.toFixed(3), st: this.state, an: this.anim };
  }

  // --------- восприятие ---------
  viewDist(p) {
    let d = this.cfg.view;
    if (!p.flash) d *= 0.6;
    if (p.crouch) d *= 0.75;
    return Math.max(3.5, d);
  }

  canSee(p) {
    if (p.state !== 'alive' || p.hidden !== null) return false;
    const dx = p.x - this.x, dz = p.z - this.z;
    const d = Math.hypot(dx, dz);
    if (d > this.viewDist(p)) return false;
    if (d > SENSE_R && Math.abs(angDiff(yawTo(dx, dz), this.yaw)) > FOV / 2) return false;
    return lineOfSight(this.map, this.game.doors, this.x, this.z, p.x, p.z);
  }

  perceive(now) {
    let best = null, bestD = 1e9;
    for (const p of this.game.players.values()) {
      if (!this.canSee(p)) continue;
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      // предпочитаем текущую цель, чтобы не метаться
      const bias = p.id === this.targetId ? -2 : 0;
      if (d + bias < bestD) { bestD = d + bias; best = p; }
    }
    if (!best) return false;
    const was = this.state === 'chase' || this.state === 'attack';
    if (!was) this.game.event({ e: 'spotted', id: best.id, x: this.x, z: this.z });
    if (this.state !== 'attack') this.state = 'chase';
    this.targetId = best.id;
    this.lastSeen = { x: best.x, z: best.z };
    this.lastSeenT = now;
    this.knownHide = null;
    return true;
  }

  // Игрок залез в укрытие. Если она это видела — запомнит.
  onPlayerHide(p, spot) {
    const now = this.game.now();
    const sawRecently = this.state === 'chase' && this.targetId === p.id && now - this.lastSeenT < 1.2;
    if (sawRecently || this.canSee(p)) {
      this.state = 'chase';
      this.targetId = p.id;
      this.knownHide = spot.id;
      this.lastSeenT = now;
    }
  }

  onNoise(x, z, radius) {
    if (!this.cfg.ai) return;
    const now = this.game.now();
    if (now < this.graceUntil || this.state === 'chase' || this.state === 'attack' || this.state === 'stunned') return;
    const d = Math.hypot(x - this.x, z - this.z);
    if (d > radius * this.cfg.hearing) return;
    const cx = toCell(x), cy = toCell(z);
    const tgt = walkableForAI(this.map, cx, cy) ? { x, z } : this.nearestWalkablePoint(cx, cy);
    if (!tgt) return;
    if (this.state !== 'investigate') this.game.event({ e: 'hear', x: this.x, z: this.z });
    this.state = 'investigate';
    this.goal = tgt;
  }

  onSprayed(fromX, fromZ) {
    const now = this.game.now();
    this.state = 'stunned';
    this.anim = 'stunned';
    this.stunUntil = now + this.cfg.stun;
    this.stunFrom = { x: fromX, z: fromZ };
    this.path = null;
  }

  // --------- обновление ---------
  update(dt, now) {
    if (!this.cfg.ai) { this.anim = 'idle'; return; }
    this.moving = false;
    this.processRelock(now);

    if (this.state === 'stunned') {
      if (now < this.stunUntil) { this.anim = 'stunned'; return; }
      this.game.event({ e: 'angry', x: this.x, z: this.z });
      this.startSearch(this.stunFrom || { x: this.x, z: this.z });
    }
    if (now < this.graceUntil) { this.state = 'idle'; this.anim = 'idle'; return; }
    if (this.state === 'idle') this.state = 'patrol';

    const seen = this.perceive(now);

    switch (this.state) {
      case 'patrol': this.doPatrol(dt, now); break;
      case 'investigate':
        if (this.moveTo(this.goal, BASE.investigate, dt, now)) this.startLook(now, 3.2, 'patrol');
        break;
      case 'look': this.doLook(dt, now); break;
      case 'search': this.doSearch(dt, now); break;
      case 'chase': this.doChase(dt, now, seen); break;
      case 'attack': this.doAttack(dt, now); break;
    }
    this.anim = this.state === 'attack' ? 'attack' : this.doorWaitUntil ? 'open'
      : this.moving ? (this.state === 'chase' ? 'run' : 'walk') : 'idle';
  }

  doPatrol(dt, now) {
    if (!this.goal) {
      if (!this.idleUntil) this.idleUntil = now + rand(0.8, 2.5);
      if (now < this.idleUntil) return;
      this.idleUntil = 0;
      this.goal = this.pickPatrolGoal();
      if (!this.goal) return;
    }
    if (this.moveTo(this.goal, BASE.patrol, dt, now)) {
      this.goal = null;
      this.tryPlaceTrap(now);
    }
  }

  startLook(now, dur, next) {
    this.state = 'look';
    this.lookUntil = now + dur;
    this.lookBase = this.yaw;
    this.lookNext = next;
    this.goal = null;
  }

  doLook(dt, now) {
    const t = this.lookUntil - now;
    this.yaw = this.lookBase + Math.sin(t * 1.7) * 1.2;
    if (now >= this.lookUntil) {
      if (this.lookNext === 'search' && this.searchPoints.length) this.state = 'search';
      else this.state = 'patrol';
    }
  }

  startSearch(pt) {
    this.state = 'search';
    this.targetId = null;
    this.knownHide = null;
    const pts = [pt];
    const cx = toCell(pt.x), cy = toCell(pt.z);
    for (let i = 0; i < 2; i++) {
      for (let tries = 0; tries < 20; tries++) {
        const x = cx + Math.round(rand(-5, 5)), y = cy + Math.round(rand(-5, 5));
        if (this.map.grid[y]?.[x] === '.' ) { pts.push(cellCenter(x, y)); break; }
      }
    }
    this.searchPoints = pts;
  }

  doSearch(dt, now) {
    const pt = this.searchPoints[0];
    if (!pt) { this.state = 'patrol'; return; }
    if (this.moveTo(pt, BASE.investigate, dt, now)) {
      this.searchPoints.shift();
      this.startLook(now, 1.8, 'search');
    }
  }

  doChase(dt, now, seen) {
    const p = this.game.players.get(this.targetId);
    if (!p || p.state !== 'alive') { this.startSearch(this.lastSeen || { x: this.x, z: this.z }); return; }

    if (this.knownHide !== null) {
      // она видела, куда ты спрятался
      if (p.hidden !== this.knownHide) { this.knownHide = null; }
      else {
        const spot = this.map.hides[this.knownHide];
        const ep = cellCenter(spot.exit.x, spot.exit.y);
        if (this.moveTo(ep, BASE.chase, dt, now)) {
          this.face(cellCenter(spot.x, spot.y));
          this.game.event({ e: 'pull', id: p.id, spot: spot.id });
          this.game.catchPlayer(p);
        }
        return;
      }
    }

    if (seen) {
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      if (d < 1.25) {
        this.state = 'attack';
        this.attackAt = now + 0.55;
        this.game.event({ e: 'swing', x: this.x, z: this.z });
        return;
      }
      this.moveTo({ x: p.x, z: p.z }, BASE.chase, dt, now);
    } else {
      if (now - this.lastSeenT > this.cfg.lose) { this.startSearch(this.lastSeen); return; }
      // идёт туда, где видела последний раз, с небольшим «чутьём» (цель чуть впереди)
      const arrived = this.moveTo(this.lastSeen, BASE.chase, dt, now);
      if (arrived) {
        // короткое «чутьё»: знает направление ещё секунду-две
        if (now - this.lastSeenT < this.cfg.lose * 0.5 && p.hidden === null) this.lastSeen = { x: p.x, z: p.z };
        else this.startSearch(this.lastSeen);
      }
    }
  }

  doAttack(dt, now) {
    const p = this.game.players.get(this.targetId);
    if (p) this.face(p);
    if (now < this.attackAt) return;
    if (p && p.state === 'alive' && p.hidden === null && Math.hypot(p.x - this.x, p.z - this.z) < 1.75 &&
        lineOfSight(this.map, this.game.doors, this.x, this.z, p.x, p.z)) {
      this.game.catchPlayer(p);
    } else {
      this.state = 'chase';
    }
  }

  face(pt) {
    this.yaw = yawTo(pt.x - this.x, pt.z - this.z);
  }

  // --------- выбор целей ---------
  pickPatrolGoal() {
    const rooms = this.map.rooms.filter(r => !r.outside && r.floorCells.length);
    let room = null;
    const alive = [...this.game.players.values()].filter(p => p.state === 'alive');
    if (alive.length && Math.random() < 0.45) {
      // «интуиция»: иногда идёт в комнату, где кто-то есть
      const p = alive[Math.floor(Math.random() * alive.length)];
      const rid = this.map.roomOf[toCell(p.z)]?.[toCell(p.x)];
      room = rooms.find(r => r.id === rid) || null;
    }
    if (!room) room = rooms[Math.floor(Math.random() * rooms.length)];
    const cells = room.floorCells;
    const [x, y] = cells[Math.floor(Math.random() * cells.length)];
    return cellCenter(x, y);
  }

  tryPlaceTrap(now) {
    if (now < this.nextTrapAt) return;
    this.nextTrapAt = now + this.cfg.trapEvery * rand(0.7, 1.3);
    if (this.game.traps.length >= this.cfg.traps) return;
    const cx = toCell(this.x), cy = toCell(this.z);
    if (this.map.grid[cy][cx] !== '.') return;
    const room = this.map.rooms[this.map.roomOf[cy][cx]];
    if (!room || room.name === 'Спальня') return;
    // не у дверей
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isDoorChar(this.map.grid[cy + dy][cx + dx])) return;
    if (this.game.traps.some(t => Math.hypot(t.x - this.x, t.z - this.z) < 3)) return;
    const c = cellCenter(cx, cy);
    this.game.placeTrap(c.x, c.z);
  }

  nearestWalkablePoint(cx, cy) {
    for (let r = 1; r < 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (walkableForAI(this.map, cx + dx, cy + dy)) return cellCenter(cx + dx, cy + dy);
    }
    return null;
  }

  // --------- движение ---------
  cellFree(cx, cy) {
    if (!walkableForAI(this.map, cx, cy)) return false;
    const d = this.map.doorAt[cy * this.map.w + cx];
    return !d || this.game.doors[d.id].open;
  }

  // можно ли пройти по прямой (с учётом ширины тела)
  straight(ax, az, bx, bz) {
    const r = 0.32;
    const dist = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(dist / 0.25));
    for (let i = 1; i <= n; i++) {
      const t = i / n, px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      for (const [ox, oz] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
        if (!this.cellFree(toCell(px + ox), toCell(pz + oz))) return false;
      }
    }
    return true;
  }

  moveTo(goal, baseSpeed, dt, now) {
    if (!goal) return true;
    const speed = baseSpeed * this.cfg.speed;
    const dGoal = Math.hypot(goal.x - this.x, goal.z - this.z);
    if (dGoal < 0.35) { this.doorWaitUntil = 0; return true; }

    const gcx = toCell(goal.x), gcy = toCell(goal.z);
    const gkey = gcy * this.map.w + gcx;
    if (!this.path || gkey !== this.pathGoalKey || now > this.repathAt) {
      this.path = this.astar(toCell(this.x), toCell(this.z), gcx, gcy);
      this.pathGoalKey = gkey;
      this.repathAt = now + 0.45;
      if (!this.path) { this.goal = null; if (this.state !== 'chase') this.state = 'patrol'; return true; }
    }
    const path = this.path;
    // выкидываем пройденные клетки
    const here = toCell(this.z) * this.map.w + toCell(this.x);
    const idx = path.indexOf(here);
    if (idx > 0) path.splice(0, idx);
    // «натягивание нити» — срезаем углы, где можно
    while (path.length > 2) {
      const n = path[2], c = cellCenter(n % this.map.w, Math.floor(n / this.map.w));
      if (!this.straight(this.x, this.z, c.x, c.z)) break;
      path.splice(1, 1);
    }

    let tx, tz, nextCell = null;
    if (path.length >= 2) {
      nextCell = path[1];
      const c = cellCenter(nextCell % this.map.w, Math.floor(nextCell / this.map.w));
      tx = c.x; tz = c.z;
      if (path.length === 2 && this.straight(this.x, this.z, goal.x, goal.z)) { tx = goal.x; tz = goal.z; }
    } else { tx = goal.x; tz = goal.z; }

    // закрытая дверь на пути — открыть
    if (nextCell !== null) {
      const d = this.map.doorAt[nextCell];
      if (d && !this.game.doors[d.id].open && Math.hypot(tx - this.x, tz - this.z) < 1.45) {
        this.face({ x: tx, z: tz });
        if (!this.doorWaitUntil) this.doorWaitUntil = now + (this.state === 'chase' ? 0.35 : 0.8);
        if (now >= this.doorWaitUntil) {
          this.doorWaitUntil = 0;
          const wasLocked = !!this.game.doors[d.id].lock;
          this.game.setDoor(d.id, true, 'ai');
          if (wasLocked) this.relock.push({ id: d.id, t: now });
        }
        return false;
      }
    }
    this.doorWaitUntil = 0;

    const dx = tx - this.x, dz = tz - this.z;
    const dd = Math.hypot(dx, dz);
    if (dd > 1e-4) {
      const step = Math.min(dd, speed * dt);
      this.x += (dx / dd) * step;
      this.z += (dz / dd) * step;
      const want = yawTo(dx, dz);
      this.yaw += angDiff(want, this.yaw) * Math.min(1, dt * 10);
      this.moving = true;
    }
    return false;
  }

  // Бабка закрывает за собой запертые двери (у неё есть ключи)
  processRelock(now) {
    this.relock = this.relock.filter(r => {
      const ds = this.game.doors[r.id];
      if (!ds.lock || !ds.open) return false;
      const d = this.map.doors[r.id], c = cellCenter(d.x, d.y);
      if (now - r.t < 1 || Math.hypot(c.x - this.x, c.z - this.z) < 2.3) return true;
      if (this.game.entityInCell(d.x, d.y)) return true;
      this.game.setDoor(r.id, false, 'ai');
      return false;
    });
  }

  astar(sx, sy, gx, gy) {
    const { w, h } = this.map;
    if (!walkableForAI(this.map, gx, gy)) {
      const p = this.nearestWalkablePoint(gx, gy);
      if (!p) return null;
      gx = toCell(p.x); gy = toCell(p.z);
    }
    if (!walkableForAI(this.map, sx, sy)) {
      const p = this.nearestWalkablePoint(sx, sy);
      if (!p) return null;
      sx = toCell(p.x); sy = toCell(p.z);
    }
    const N = w * h, start = sy * w + sx, goal = gy * w + gx;
    const g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const open = [start];
    const hfn = (i) => Math.hypot((i % w) - gx, Math.floor(i / w) - gy);
    const f = new Float32Array(N).fill(Infinity);
    g[start] = 0; f[start] = hfn(start);
    const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open[bi];
      open[bi] = open[open.length - 1]; open.pop();
      if (cur === goal) {
        const out = [cur];
        let c = cur;
        while (came[c] !== -1) { c = came[c]; out.push(c); }
        return out.reverse();
      }
      closed[cur] = 1;
      const cx = cur % w, cy = Math.floor(cur / w);
      for (const [dx, dy, cost] of dirs) {
        const nx = cx + dx, ny = cy + dy;
        if (!walkableForAI(this.map, nx, ny)) continue;
        if (dx && dy) {
          // без срезания углов и без диагоналей через двери
          if (!walkableForAI(this.map, cx + dx, cy) || !walkableForAI(this.map, cx, cy + dy)) continue;
          if (isDoorChar(this.map.grid[ny][nx]) || isDoorChar(this.map.grid[cy][cx])) continue;
          if (isDoorChar(this.map.grid[cy][cx + dx]) || isDoorChar(this.map.grid[cy + dy][cx])) continue;
        }
        const ni = ny * w + nx;
        if (closed[ni]) continue;
        const ng = g[cur] + cost + (this.map.doorAt[ni] && !this.game.doors[this.map.doorAt[ni].id].open ? 1.5 : 0);
        if (ng < g[ni]) {
          if (g[ni] === Infinity) open.push(ni);
          g[ni] = ng; f[ni] = ng + hfn(ni); came[ni] = cur;
        }
      }
    }
    return null;
  }
}

export { CELL };
