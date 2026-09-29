// ИИ бабки. Работает целиком на сервере (авторитетно), клиенты только рисуют.
// Дом многоэтажный: путь ищется по графу (этаж, клетка) с переходами через лестницы.
import {
  CELL, FLOOR_H, cellCenter, toCell, walkableForAI, lineOfSight, isDoorChar, charAt, stairCtx, heightAt, visualLevel, LEVELS,
} from '../shared/map.js';

const FOV = (125 * Math.PI) / 180;
const SENSE_R = 2.2;
const BASE = { patrol: 1.55, investigate: 2.2, chase: 3.35 };
const rand = (a, b) => a + Math.random() * (b - a);
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

export class Granny {
  constructor(game) {
    this.game = game;
    this.map = game.map;
    const { w, h } = this.map;
    this.W = w; this.H = h;
    this.reset(true);
  }

  get cfg() { return this.game.cfg; }

  // узел графа: (этаж, клетка) -> число
  node(L, cx, cy) { return ((L + 1) * this.H + cy) * this.W + cx; }
  unnode(n) { const cx = n % this.W, r = Math.floor(n / this.W), cy = r % this.H, L = Math.floor(r / this.H) - 1; return [L, cx, cy]; }

  reset(initial = false) {
    const sp = this.map.grannySpawn;
    const c = cellCenter(sp.x, sp.y);
    this.level = sp.level; this.x = c.x; this.z = c.z; this.y = heightAt(this.map, this.level, this.x, this.z); this.yaw = Math.PI;
    this.state = 'idle'; this.anim = 'idle';
    this.goal = null;
    this.path = null; this.pathGoalKey = -1; this.repathAt = 0;
    this.targetId = null; this.lastSeen = null; this.lastSeenT = -99; this.knownHide = null;
    this.idleUntil = 0; this.lookUntil = 0; this.lookBase = 0; this.lookNext = 'patrol';
    this.searchPoints = [];
    this.doorWaitUntil = 0;
    this.relock = [];
    this.attackAt = 0;
    this.stunUntil = 0; this.stunFrom = null;
    const now = this.game.now();
    this.graceUntil = now + (initial ? this.cfg.grace + 5 : this.cfg.grace);
    this.nextTrapAt = now + (this.cfg.trapEvery || 60) * rand(0.5, 1);
    this.moving = false;
  }

  snapshot() {
    return { x: +this.x.toFixed(3), z: +this.z.toFixed(3), lv: this.level, y: +this.y.toFixed(3), yaw: +this.yaw.toFixed(3), st: this.state, an: this.anim };
  }

  pos() { return { level: this.level, x: this.x, z: this.z }; }

  // --------- восприятие ---------
  viewDist(p) {
    let d = this.cfg.view;
    if (!p.flash) d *= 0.6;
    if (p.crouch) d *= 0.75;
    return Math.max(3.5, d);
  }

  canSee(p) {
    if (p.state !== 'alive' || p.hidden !== null) return false;
    const myL = visualLevel(this.map, this.level, this.x, this.z), hisL = visualLevel(this.map, p.level, p.x, p.z);
    if (myL !== hisL) return false;
    const dx = p.x - this.x, dz = p.z - this.z;
    const d = Math.hypot(dx, dz);
    if (d > this.viewDist(p)) return false;
    if (d > SENSE_R && Math.abs(angDiff(yawTo(dx, dz), this.yaw)) > FOV / 2) return false;
    return lineOfSight(this.map, this.game.doors, this.level, this.x, this.z, p.x, p.z);
  }

  perceive(now) {
    let best = null, bestD = 1e9;
    for (const p of this.game.players.values()) {
      if (!this.canSee(p)) continue;
      const d = Math.hypot(p.x - this.x, p.z - this.z) + (p.id === this.targetId ? -2 : 0);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best) return false;
    const was = this.state === 'chase' || this.state === 'attack';
    if (!was) this.game.event({ e: 'spotted', id: best.id, x: this.x, z: this.z, lv: this.level });
    if (this.state !== 'attack') this.state = 'chase';
    this.targetId = best.id;
    this.lastSeen = { level: best.level, x: best.x, z: best.z };
    this.lastSeenT = now;
    this.knownHide = null;
    return true;
  }

  onPlayerHide(p, spot) {
    const now = this.game.now();
    const sawRecently = this.state === 'chase' && this.targetId === p.id && now - this.lastSeenT < 1.2;
    if (sawRecently || this.canSee(p)) {
      this.state = 'chase'; this.targetId = p.id; this.knownHide = spot.id; this.lastSeenT = now;
    }
  }

  onNoise(level, x, z, radius) {
    if (!this.cfg.ai) return;
    const now = this.game.now();
    if (now < this.graceUntil || this.state === 'chase' || this.state === 'attack' || this.state === 'stunned') return;
    // через перекрытие звук глохнет
    const d = Math.hypot(x - this.x, z - this.z) + Math.abs(level - this.level) * 7;
    if (d > radius * this.cfg.hearing) return;
    const cx = toCell(x), cy = toCell(z);
    const tgt = walkableForAI(this.map, level, cx, cy) ? { level, x, z } : this.nearestWalkable(level, cx, cy);
    if (!tgt) return;
    if (this.state !== 'investigate') this.game.event({ e: 'hear', x: this.x, z: this.z, lv: this.level });
    this.state = 'investigate';
    this.goal = tgt;
  }

  onSprayed(from) {
    this.state = 'stunned'; this.anim = 'stunned';
    this.stunUntil = this.game.now() + this.cfg.stun;
    this.stunFrom = from;
    this.path = null;
  }

  // --------- обновление ---------
  update(dt, now) {
    if (!this.cfg.ai) { this.anim = 'idle'; return; }
    this.moving = false;
    this.processRelock(now);
    if (this.state === 'stunned') {
      if (now < this.stunUntil) { this.anim = 'stunned'; return; }
      this.game.event({ e: 'angry', x: this.x, z: this.z, lv: this.level });
      this.startSearch(this.stunFrom || this.pos());
    }
    if (now < this.graceUntil) { this.state = 'idle'; this.anim = 'idle'; return; }
    if (this.state === 'idle') this.state = 'patrol';
    const seen = this.perceive(now);
    switch (this.state) {
      case 'patrol': this.doPatrol(dt, now); break;
      case 'investigate': if (this.moveTo(this.goal, BASE.investigate, dt, now)) this.startLook(now, 3.2, 'patrol'); break;
      case 'look': this.doLook(dt, now); break;
      case 'search': this.doSearch(dt, now); break;
      case 'chase': this.doChase(dt, now, seen); break;
      case 'attack': this.doAttack(dt, now); break;
    }
    this.anim = this.state === 'attack' ? 'attack' : this.doorWaitUntil ? 'open' : this.moving ? (this.state === 'chase' ? 'run' : 'walk') : 'idle';
  }

  doPatrol(dt, now) {
    if (!this.goal) {
      if (!this.idleUntil) this.idleUntil = now + rand(0.8, 2.5);
      if (now < this.idleUntil) return;
      this.idleUntil = 0;
      this.goal = this.pickPatrolGoal();
      if (!this.goal) return;
    }
    if (this.moveTo(this.goal, BASE.patrol, dt, now)) { this.goal = null; this.tryPlaceTrap(now); }
  }

  startLook(now, dur, next) { this.state = 'look'; this.lookUntil = now + dur; this.lookBase = this.yaw; this.lookNext = next; this.goal = null; }

  doLook(dt, now) {
    this.yaw = this.lookBase + Math.sin((this.lookUntil - now) * 1.7) * 1.2;
    if (now >= this.lookUntil) this.state = this.lookNext === 'search' && this.searchPoints.length ? 'search' : 'patrol';
  }

  startSearch(pt) {
    this.state = 'search'; this.targetId = null; this.knownHide = null;
    const pts = [pt];
    const cx = toCell(pt.x), cy = toCell(pt.z);
    for (let i = 0; i < 2; i++) for (let t = 0; t < 20; t++) {
      const x = cx + Math.round(rand(-5, 5)), y = cy + Math.round(rand(-5, 5));
      if (charAt(this.map, pt.level, x, y) === '.') { pts.push({ level: pt.level, ...cellCenter(x, y) }); break; }
    }
    this.searchPoints = pts;
  }

  doSearch(dt, now) {
    const pt = this.searchPoints[0];
    if (!pt) { this.state = 'patrol'; return; }
    if (this.moveTo(pt, BASE.investigate, dt, now)) { this.searchPoints.shift(); this.startLook(now, 1.8, 'search'); }
  }

  doChase(dt, now, seen) {
    const p = this.game.players.get(this.targetId);
    if (!p || p.state !== 'alive') { this.startSearch(this.lastSeen || this.pos()); return; }
    if (this.knownHide !== null) {
      if (p.hidden !== this.knownHide) this.knownHide = null;
      else {
        const spot = this.map.hides[this.knownHide];
        const ep = { level: spot.level, ...cellCenter(spot.exit.x, spot.exit.y) };
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
      if (d < 1.25 && p.level === this.level) {
        this.state = 'attack';
        this.attackAt = now + 0.55;
        this.game.event({ e: 'swing', x: this.x, z: this.z, lv: this.level });
        return;
      }
      this.moveTo({ level: p.level, x: p.x, z: p.z }, BASE.chase, dt, now);
    } else {
      if (now - this.lastSeenT > this.cfg.lose) { this.startSearch(this.lastSeen); return; }
      if (this.moveTo(this.lastSeen, BASE.chase, dt, now)) {
        // короткое «чутьё» — знает, куда ты побежал
        if (now - this.lastSeenT < this.cfg.lose * 0.5 && p.hidden === null) this.lastSeen = { level: p.level, x: p.x, z: p.z };
        else this.startSearch(this.lastSeen);
      }
    }
  }

  doAttack(dt, now) {
    const p = this.game.players.get(this.targetId);
    if (p) this.face(p);
    if (now < this.attackAt) return;
    if (p && p.state === 'alive' && p.hidden === null && p.level === this.level && Math.hypot(p.x - this.x, p.z - this.z) < 1.75 &&
        lineOfSight(this.map, this.game.doors, this.level, this.x, this.z, p.x, p.z)) this.game.catchPlayer(p);
    else this.state = 'chase';
  }

  face(pt) { this.yaw = yawTo(pt.x - this.x, pt.z - this.z); }

  // --------- цели ---------
  pickPatrolGoal() {
    const rooms = this.map.rooms.filter(r => !r.outside && r.floorCells.length);
    let room = null;
    const alive = [...this.game.players.values()].filter(p => p.state === 'alive');
    if (alive.length && Math.random() < 0.45) {
      const p = alive[Math.floor(Math.random() * alive.length)];
      const rid = this.map.roomAt(p.level, toCell(p.x), toCell(p.z));
      room = rooms.find(r => r.id === rid) || null;
    }
    // чаще остаётся на своём этаже
    if (!room) {
      const local = rooms.filter(r => r.level === this.level);
      const pool = Math.random() < 0.6 && local.length ? local : rooms;
      room = pool[Math.floor(Math.random() * pool.length)];
    }
    const [x, y] = room.floorCells[Math.floor(Math.random() * room.floorCells.length)];
    return { level: room.level, ...cellCenter(x, y) };
  }

  tryPlaceTrap(now) {
    if (now < this.nextTrapAt) return;
    this.nextTrapAt = now + this.cfg.trapEvery * rand(0.7, 1.3);
    if (this.game.traps.length >= this.cfg.traps) return;
    const cx = toCell(this.x), cy = toCell(this.z), L = this.level;
    if (charAt(this.map, L, cx, cy) !== '.') return;
    const room = this.map.rooms[this.map.roomAt(L, cx, cy)];
    if (!room || room.name === 'Спальня') return;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const c = charAt(this.map, L, cx + dx, cy + dy); if (isDoorChar(c) || c === '^' || c === '_') return; }
    if (this.game.traps.some(t => t.level === L && Math.hypot(t.x - this.x, t.z - this.z) < 3)) return;
    const c = cellCenter(cx, cy);
    this.game.placeTrap(L, c.x, c.z);
  }

  nearestWalkable(L, cx, cy) {
    for (let r = 1; r < 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (walkableForAI(this.map, L, cx + dx, cy + dy) && charAt(this.map, L, cx + dx, cy + dy) !== '^') return { level: L, ...cellCenter(cx + dx, cy + dy) };
    }
    return null;
  }

  // --------- движение ---------
  isStairCell(L, cx, cy) { return charAt(this.map, L, cx, cy) === '^'; }

  cellFree(L, cx, cy) {
    if (!walkableForAI(this.map, L, cx, cy) || this.isStairCell(L, cx, cy)) return false;
    const d = this.map.levels[L].doorAt[cy * this.W + cx];
    return !d || this.game.doors[d.id].open;
  }

  // прямая на одном этаже, без лестниц
  straight(L, ax, az, bx, bz) {
    const r = 0.32, dist = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(dist / 0.25));
    for (let i = 1; i <= n; i++) {
      const t = i / n, px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      for (const [ox, oz] of [[-r, -r], [r, -r], [-r, r], [r, r]]) if (!this.cellFree(L, toCell(px + ox), toCell(pz + oz))) return false;
    }
    return true;
  }

  moveTo(goal, baseSpeed, dt, now) {
    if (!goal) return true;
    const speed = baseSpeed * this.cfg.speed;
    if (goal.level === this.level && Math.hypot(goal.x - this.x, goal.z - this.z) < 0.35) { this.doorWaitUntil = 0; return true; }
    const gkey = this.node(goal.level, toCell(goal.x), toCell(goal.z));
    if (!this.path || gkey !== this.pathGoalKey || now > this.repathAt) {
      this.path = this.astar(this.node(this.level, toCell(this.x), toCell(this.z)), goal);
      this.pathGoalKey = gkey;
      this.repathAt = now + 0.45;
      if (!this.path) { this.goal = null; if (this.state !== 'chase') this.state = 'patrol'; return true; }
    }
    const path = this.path;
    const here = this.node(this.level, toCell(this.x), toCell(this.z));
    const idx = path.indexOf(here);
    if (idx > 0) path.splice(0, idx);
    // срезаем углы (только на одном этаже и не на лестнице)
    while (path.length > 2) {
      const [L2, x2, y2] = this.unnode(path[2]), [L1, x1, y1] = this.unnode(path[1]);
      if (L2 !== this.level || L1 !== this.level || this.isStairCell(L1, x1, y1) || this.isStairCell(L2, x2, y2) || this.isStairCell(this.level, toCell(this.x), toCell(this.z))) break;
      const c = cellCenter(x2, y2);
      if (!this.straight(this.level, this.x, this.z, c.x, c.z)) break;
      path.splice(1, 1);
    }
    let tx, tz, nextNode = null;
    if (path.length >= 2) {
      nextNode = path[1];
      const [, nx, ny] = this.unnode(nextNode);
      const c = cellCenter(nx, ny); tx = c.x; tz = c.z;
      if (path.length === 2 && goal.level === this.level && this.straight(this.level, this.x, this.z, goal.x, goal.z)) { tx = goal.x; tz = goal.z; }
    } else { tx = goal.x; tz = goal.z; }

    if (nextNode !== null) {
      const [nL, nx, ny] = this.unnode(nextNode);
      const d = this.map.levels[nL].doorAt[ny * this.W + nx];
      if (d && d.kind === 'door' && !this.game.doors[d.id].open && Math.hypot(tx - this.x, tz - this.z) < 1.45) {
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
    const prevCtx = stairCtx(this.map, this.level, this.x, this.z);
    const dx = tx - this.x, dz = tz - this.z, dd = Math.hypot(dx, dz);
    if (dd > 1e-4) {
      const step = Math.min(dd, speed * dt);
      this.x += (dx / dd) * step; this.z += (dz / dd) * step;
      this.yaw += angDiff(yawTo(dx, dz), this.yaw) * Math.min(1, dt * 10);
      this.moving = true;
    }
    // переход между этажами через «портал» лестницы — только если шли по лестнице
    const cx = toCell(this.x), cy = toCell(this.z);
    const st = prevCtx?.stair;
    if (st) {
      if (this.level === st.from && prevCtx.onRun && cx === st.landing[0] && cy === st.landing[1]) this.level = st.to;
      else if (this.level === st.to && prevCtx.atLanding && cx === st.top[0] && cy === st.top[1]) this.level = st.from;
    }
    this.y = heightAt(this.map, this.level, this.x, this.z);
    return false;
  }

  processRelock(now) {
    this.relock = this.relock.filter(r => {
      const ds = this.game.doors[r.id];
      if (!ds.lock || !ds.open) return false;
      const d = this.map.doors[r.id], c = cellCenter(d.x, d.y);
      if (now - r.t < 1 || (this.level === d.level && Math.hypot(c.x - this.x, c.z - this.z) < 2.3)) return true;
      if (this.game.entityInCell(d.level, d.x, d.y)) return true;
      this.game.setDoor(r.id, false, 'ai');
      return false;
    });
  }

  // соседи узла с учётом лестниц
  neighbors(n) {
    const [L, cx, cy] = this.unnode(n);
    const out = [];
    const onStair = this.isStairCell(L, cx, cy);
    for (const [dx, dy, cost] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]]) {
      const nx = cx + dx, ny = cy + dy;
      if (!walkableForAI(this.map, L, nx, ny)) continue;
      const toStair = this.isStairCell(L, nx, ny);
      if (dx && dy) {
        if (onStair || toStair) continue;
        if (!walkableForAI(this.map, L, cx + dx, cy) || !walkableForAI(this.map, L, cx, cy + dy)) continue;
        if ([charAt(this.map, L, nx, ny), charAt(this.map, L, cx, cy), charAt(this.map, L, cx + dx, cy), charAt(this.map, L, cx, cy + dy)].some(c => isDoorChar(c) || c === '^')) continue;
      }
      // на ступени — только вдоль марша / с нижней площадки
      if (toStair || onStair) {
        const s = this.map.stairs.find(st => st.from === L && (st.cells.some(c => c[0] === nx && c[1] === ny) || st.cells.some(c => c[0] === cx && c[1] === cy)));
        if (!s) continue;
        const inRun = (x, y) => s.cells.some(c => c[0] === x && c[1] === y);
        const ok = (inRun(cx, cy) || (s.approach[0] === cx && s.approach[1] === cy)) && (inRun(nx, ny) || (s.approach[0] === nx && s.approach[1] === ny));
        if (!ok) continue;
      }
      const d = this.map.levels[L].doorAt[ny * this.W + nx];
      out.push([this.node(L, nx, ny), cost + (d && !this.game.doors[d.id].open ? 1.5 : 0)]);
    }
    // порталы
    for (const s of this.map.stairs) {
      if (L === s.from && cx === s.top[0] && cy === s.top[1]) out.push([this.node(s.to, s.landing[0], s.landing[1]), 1]);
      if (L === s.to && cx === s.landing[0] && cy === s.landing[1]) out.push([this.node(s.from, s.top[0], s.top[1]), 1]);
    }
    return out;
  }

  astar(start, goal) {
    let [sL, sx, sy] = this.unnode(start);
    if (!walkableForAI(this.map, sL, sx, sy)) { const p = this.nearestWalkable(sL, sx, sy); if (!p) return null; start = this.node(sL, toCell(p.x), toCell(p.z)); }
    let gL = goal.level, gx = toCell(goal.x), gy = toCell(goal.z);
    if (!walkableForAI(this.map, gL, gx, gy)) { const p = this.nearestWalkable(gL, gx, gy); if (!p) return null; gx = toCell(p.x); gy = toCell(p.z); }
    const target = this.node(gL, gx, gy);
    const N = this.W * this.H * LEVELS.length;
    const g = new Float32Array(N).fill(Infinity), f = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const hfn = (n) => { const [L, x, y] = this.unnode(n); return Math.hypot(x - gx, y - gy) + Math.abs(L - gL) * 4; };
    const open = [start]; g[start] = 0; f[start] = hfn(start);
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open[bi]; open[bi] = open[open.length - 1]; open.pop();
      if (cur === target) { const out = [cur]; let c = cur; while (came[c] !== -1) { c = came[c]; out.push(c); } return out.reverse(); }
      closed[cur] = 1;
      for (const [nb, cost] of this.neighbors(cur)) {
        if (closed[nb]) continue;
        const ng = g[cur] + cost;
        if (ng < g[nb]) { if (g[nb] === Infinity) open.push(nb); g[nb] = ng; f[nb] = ng + hfn(nb); came[nb] = cur; }
      }
    }
    return null;
  }
}

export { CELL, FLOOR_H };
