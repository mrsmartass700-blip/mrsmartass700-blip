// Процедурная скелетная анимация для персонажей MakeHuman (163 кости).
// Повороты задаются в осях МОДЕЛИ в позе покоя (вперёд = -Z, вверх = +Y, правая рука персонажа = +X),
// и пересчитываются в локальные оси каждой кости: D = R⁻¹ · Q · R. Так позы одинаковы для всех персонажей.
import * as THREE from 'three';

const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const lerp = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));

export class HumanRig {
  constructor(root) {
    this.root = root;
    this.bones = {};
    this.meshes = [];
    root.traverse(o => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isSkinnedMesh) { this.meshes.push(o); o.frustumCulled = false; }
    });
    // поза покоя: локальные кватернионы и глобальные повороты относительно корня модели
    const saved = { p: root.position.clone(), q: root.quaternion.clone(), s: root.scale.clone(), parent: root.parent };
    root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.set(1, 1, 1);
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    this.rest = {};
    for (const [name, b] of Object.entries(this.bones)) {
      const m = new THREE.Matrix4().multiplyMatrices(inv, b.matrixWorld);
      const g = new THREE.Quaternion(); m.decompose(new THREE.Vector3(), g, new THREE.Vector3());
      const wp = new THREE.Vector3(); m.decompose(wp, new THREE.Quaternion(), new THREE.Vector3());
      this.rest[name] = { local: b.quaternion.clone(), global: g, globalInv: g.clone().invert(), pos: b.position.clone(), world: wp };
    }
    root.position.copy(saved.p); root.quaternion.copy(saved.q); root.scale.copy(saved.s);
    this.acc = {};
    this.morphs = {};
    this.rootOffset = new THREE.Vector3();
  }

  has(name) { return !!this.bones[name]; }

  // поворот кости вокруг оси модели (в позе покоя)
  rot(name, axis, angle) {
    if (!angle || !this.bones[name]) return;
    const r = this.rest[name];
    _q.setFromAxisAngle(AX[axis] || axis, angle);
    // D = R⁻¹ Q R
    _q2.copy(r.globalInv).multiply(_q).multiply(r.global);
    (this.acc[name] ||= new THREE.Quaternion()).premultiply(_q2);
  }

  // поворот в собственных осях кости (для пальцев: X — основная ось сгиба MakeHuman)
  rotLocal(name, x = 0, y = 0, z = 0) {
    if (!this.bones[name]) return;
    _q.setFromEuler(new THREE.Euler(x, y, z));
    (this.acc[name] ||= new THREE.Quaternion()).multiply(_q);
  }

  morph(name, v) { this.morphs[name] = clamp(v, 0, 1); }

  // применить накопленное и сбросить
  apply() {
    for (const [name, b] of Object.entries(this.bones)) {
      const r = this.rest[name];
      b.quaternion.copy(r.local);
      const a = this.acc[name];
      if (a) { b.quaternion.multiply(a); a.identity(); }
    }
    const root = this.bones.root;
    if (root) root.position.copy(this.rest.root.pos).add(this.rootOffset);
    for (const m of this.meshes) {
      if (!m.morphTargetDictionary) continue;
      for (const [k, v] of Object.entries(this.morphs)) {
        const i = m.morphTargetDictionary[k];
        if (i !== undefined) m.morphTargetInfluences[i] = v;
      }
    }
  }
}

// Имена костей MakeHuman после GLTFLoader (точки убраны)
const B = {
  root: 'root', spine: ['spine05', 'spine04', 'spine03', 'spine02', 'spine01'], neck: ['neck01', 'neck02', 'neck03'], head: 'head',
  thigh: { L: 'upperleg01L', R: 'upperleg01R' }, shin: { L: 'lowerleg01L', R: 'lowerleg01R' }, foot: { L: 'footL', R: 'footR' },
  uarm: { L: 'upperarm01L', R: 'upperarm01R' }, larm: { L: 'lowerarm01L', R: 'lowerarm01R' }, hand: { L: 'wristL', R: 'wristR' },
  clav: { L: 'clavicleL', R: 'clavicleR' }, shoulder: { L: 'shoulder01L', R: 'shoulder01R' },
};
const SIDE = { L: -1, R: 1 }; // знак: левая сторона персонажа — -X

// Аниматор: походка, бег, присед, действия, мимика
export class Animator {
  constructor(rig, kind) {
    this.rig = rig;
    this.kind = kind; // 'granny' | 'player'
    this.phase = 0;
    this.speed = 0;        // сглаженная скорость, м/с
    this.crouch = 0;
    this.runK = 0;
    this.t = Math.random() * 10;
    this.blinkT = 2 + Math.random() * 3;
    this.blink = 0;
    this.action = null; this.actionT = 0;
    this.lookYaw = 0; this.lookPitch = 0;
    this.anger = 0; this.stun = 0; this.hold = 0;
    this.lean = 0;
    const rw = (n) => rig.rest[n]?.world || new THREE.Vector3();
    this.thighLen = rw('upperleg01L').distanceTo(rw('lowerleg01L')) || 0.42;
    this.shinLen = rw('lowerleg01L').distanceTo(rw('footL')) || 0.4;
    this.grip = { L: 0, R: 0 };
    // угол руки в A-позе (от вертикали) — чтобы опускать руки ровно вдоль тела
    this.armDown = {};
    for (const side of ['L', 'R']) {
      const rr = rig.rest[B.uarm[side]];
      if (!rr) { this.armDown[side] = 0.8; continue; }
      const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(rr.global);
      this.armDown[side] = Math.atan2(Math.abs(dir.x), -dir.y);
    }
  }

  play(action) { if (this.action !== action) { this.action = action; this.actionT = 0; } }

  // st: { speed, run, crouch, action, lookYaw, lookPitch, holdLight, holdItem, angry, stunned, dead }
  update(dt, st) {
    const r = this.rig, g = this.kind === 'granny';
    this.t += dt;
    this.speed = damp(this.speed, st.speed || 0, 8, dt);
    this.runK = damp(this.runK, st.run ? 1 : 0, 6, dt);
    this.crouch = damp(this.crouch, st.crouch ? 1 : 0, 8, dt);
    this.anger = damp(this.anger, st.angry ? 1 : 0, 4, dt);
    this.stun = damp(this.stun, st.stunned ? 1 : 0, 6, dt);
    this.lookYaw = damp(this.lookYaw, st.lookYaw || 0, 6, dt);
    this.lookPitch = damp(this.lookPitch, st.lookPitch || 0, 8, dt);
    if (st.action) this.play(st.action); else if (this.action && this.actionT > 0.9) this.action = null;
    this.actionT += dt;

    const sp = this.speed;
    const moving = clamp(sp / 0.6, 0, 1);
    const stride = g ? 0.95 + 0.35 * this.runK : 1.25 + 0.55 * this.runK - 0.35 * this.crouch;
    this.phase += (sp / stride) * Math.PI * 2 * dt;
    const ph = this.phase;
    const s = Math.sin(ph), c = Math.cos(ph);
    const amp = moving * (0.42 + 0.28 * this.runK) * (1 - 0.3 * this.crouch);

    // ---------- корпус ----------
    const hunch = g ? 0.16 : 0;
    const breathe = Math.sin(this.t * (g ? 1.6 : 1.9)) * 0.018;
    const leanFwd = (g ? 0.12 : 0.05) * this.runK * moving + 0.35 * this.crouch;
    for (let i = 0; i < 5; i++) r.rot(B.spine[i], 'x', -(hunch * (i < 2 ? 0.4 : 1) + leanFwd * 0.35 + breathe * 0.5));
    // скручивание корпуса против шага
    r.rot('spine03', 'y', s * amp * 0.18);
    r.rot('spine05', 'y', -s * amp * 0.12);
    // покачивание таза
    r.rot('spine05', 'z', c * amp * 0.08);
    // вертикальное подпрыгивание и присед
    const bob = moving * Math.abs(Math.cos(ph)) * (0.018 + 0.03 * this.runK);
    // опускание таза из геометрии ноги: стопы остаются на полу
    const cT = this.crouch * 0.95, cK = this.crouch * 1.75;
    const legH = (a, b) => this.thighLen * Math.cos(a) + this.shinLen * Math.cos(a - b);
    const baseT = g ? 0.12 : 0, baseK = g ? 0.22 : 0.04;
    const drop = legH(0, 0) - legH(baseT + cT, baseK + cK);
    r.rootOffset.set(0, -bob - drop, 0);

    // ---------- ноги ----------
    for (const side of ['L', 'R']) {
      const k = side === 'L' ? 1 : -1;
      const ls = s * k; // фаза ноги
      const swing = ls * amp;
      // сгиб колена: сильнее в фазе переноса (нога идёт вперёд)
      const lift = Math.max(0, Math.cos(ph + (k > 0 ? 0 : Math.PI))) * amp * (1.3 + this.runK * 0.9);
      const crouchThigh = cT, crouchKnee = cK;
      r.rot(B.thigh[side], 'x', swing + crouchThigh + lift * 0.25 + (g ? 0.12 : 0));
      r.rot(B.shin[side], 'x', -(lift + crouchKnee + (g ? 0.22 : 0.04) + moving * 0.1));
      // стопа параллельно полу: компенсируем бедро и колено
      r.rot(B.foot[side], 'x', -swing * 0.35 + lift * 0.25 - (crouchThigh - crouchKnee) - (g ? 0.1 : 0.0));
      // ноги чуть в стороны на приседе
      r.rot(B.thigh[side], 'z', SIDE[side] * -(0.04 + this.crouch * 0.18));
    }

    // ---------- руки ----------
    for (const side of ['L', 'R']) {
      const k = side === 'L' ? 1 : -1;
      const sg = SIDE[side];
      // из A-позы — вдоль тела
      r.rot(B.uarm[side], 'z', -sg * (this.armDown[side] - (g ? 0.2 : 0.13) - this.crouch * 0.1));
      // рука с фонариком/битой свободно не машет
      const busy = side === 'R' && (g || st.holdLight);
      const sw = busy ? 0.25 : 1;
      r.rot(B.uarm[side], 'x', (-s * k * amp * (0.75 + this.runK * 0.5)) * sw + 0.05 + (busy ? 0 : this.crouch * 0.15));
      r.rot(B.larm[side], 'x', busy ? 0 : 0.12 + moving * 0.12 + this.runK * 1.15 * moving + this.crouch * 0.25);
    }

    // ---------- кисти: кулак на бегу / хват предмета ----------
    this.grip.R = damp(this.grip.R, (g || st.holdLight) ? 1 : 0.25 + 0.55 * this.runK * moving, 10, dt);
    this.grip.L = damp(this.grip.L, st.holdItem ? 0.9 : 0.25 + 0.55 * this.runK * moving + this.stun * 0.3, 10, dt);
    for (const side of ['L', 'R']) {
      const k = this.grip[side];
      for (let f = 2; f <= 5; f++) for (let j = 1; j <= 3; j++) r.rotLocal(`finger${f}-${j}${side}`, k * (j === 1 ? 1.1 : 1.25), 0, 0);
      r.rotLocal(`finger1-2${side}`, k * 0.5, 0, 0); r.rotLocal(`finger1-3${side}`, k * 0.6, 0, 0);
    }

    // ---------- что в руках ----------
    if (!g && st.holdLight) {
      // фонарик в правой руке — вперёд, по направлению взгляда
      r.rot(B.uarm.R, 'x', 1.05 + this.lookPitch * 0.8 + this.crouch * 0.2);
      r.rot(B.larm.R, 'x', 0.35 + this.runK * moving * 0.3);
      r.rot(B.uarm.R, 'z', 0.1);
    }
    if (!g && st.holdItem) { r.rot(B.uarm.L, 'x', 0.35); r.rot(B.larm.L, 'x', 0.9); }
    if (g) {
      // бита в правой руке, чуть впереди
      r.rot(B.uarm.R, 'x', 0.35 + this.runK * 0.4);
      r.rot(B.larm.R, 'x', 0.6 + this.runK * 0.5);
      r.rot(B.hand.R, 'x', -0.2);
    }

    // ---------- действия ----------
    const at = this.actionT;
    if (this.action === 'attack') {
      // замах над головой и удар
      const k = clamp(at / 0.55, 0, 1);
      const wind = k < 0.62 ? k / 0.62 : 1 - (k - 0.62) / 0.38;
      const strike = k < 0.62 ? 0 : (k - 0.62) / 0.38;
      r.rot(B.uarm.R, 'x', wind * 2.6 + strike * 0.6);
      r.rot(B.uarm.R, 'z', -wind * 0.4);
      r.rot(B.larm.R, 'x', wind * 0.9);
      for (const sp2 of B.spine.slice(2)) r.rot(sp2, 'x', wind * 0.12 - strike * 0.18);
      r.rot('spine03', 'y', -wind * 0.35 + strike * 0.4);
    } else if (this.action === 'open') {
      const k = Math.sin(clamp(at / 0.8, 0, 1) * Math.PI);
      r.rot(B.uarm.L, 'x', k * 1.3); r.rot(B.larm.L, 'x', k * 0.3);
    } else if (this.action === 'trapped') {
      const w = Math.sin(this.t * 18) * 0.25;
      r.rot(B.thigh.L, 'x', 0.3); r.rot(B.shin.L, 'x', -0.9);
      r.rot(B.uarm.L, 'x', 0.8 + w); r.rot(B.uarm.R, 'x', 0.8 - w);
      for (const sp2 of B.spine) r.rot(sp2, 'x', -0.12);
    }
    if (this.stun > 0.01) {
      // закрывает лицо руками, шатается
      const k = this.stun, w = Math.sin(this.t * 7);
      for (const side of ['L', 'R']) {
        r.rot(B.uarm[side], 'x', 1.9 * k);
        r.rot(B.uarm[side], 'z', SIDE[side] * 0.35 * k);
        r.rot(B.larm[side], 'x', 1.7 * k);
      }
      r.rot('spine03', 'z', w * 0.1 * k);
      r.rot(B.head, 'x', -0.35 * k);
      r.rot(B.head, 'y', Math.sin(this.t * 3.1) * 0.4 * k);
    }

    // ---------- голова и взгляд ----------
    const yaw = clamp(this.lookYaw, -1.1, 1.1), pitch = clamp(this.lookPitch, -0.8, 0.7);
    const idleLook = g ? Math.sin(this.t * 0.7) * 0.25 * (1 - moving) : 0;
    r.rot(B.neck[0], 'y', (yaw + idleLook) * 0.4); r.rot(B.head, 'y', (yaw + idleLook) * 0.6);
    r.rot(B.neck[0], 'x', -pitch * 0.35 + (g ? hunch * 1.4 : 0)); r.rot(B.head, 'x', -pitch * 0.55 + (g ? 0.1 : 0));

    // ---------- мимика ----------
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blink = 1; this.blinkT = 2.5 + Math.random() * 4; }
    this.blink = Math.max(0, this.blink - dt * 7);
    const bl = Math.sin(clamp(this.blink, 0, 1) * Math.PI);
    const closed = this.stun * 0.85;
    r.morph('blinkL', Math.max(bl, closed)); r.morph('blinkR', Math.max(bl, closed));
    r.morph('browDownL', this.anger * 0.9); r.morph('browDownR', this.anger * 0.9);
    r.morph('snarl', this.anger * 0.5);
    r.morph('frown', g ? 0.35 + this.anger * 0.4 : 0);
    const shout = this.action === 'attack' ? Math.sin(clamp(at / 0.55, 0, 1) * Math.PI) : 0;
    r.morph('mouthOpen', Math.max(shout * 0.9, this.stun * 0.5, this.runK * moving * (g ? 0.25 : 0.15)));
    r.morph('browInnerUpL', this.stun * 0.8); r.morph('browInnerUpR', this.stun * 0.8);
    r.morph('eyesWideL', g ? this.anger * 0.3 : 0); r.morph('eyesWideR', g ? this.anger * 0.3 : 0);

    r.apply();
  }
}
