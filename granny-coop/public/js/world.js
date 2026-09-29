// Построение 3D-дома из общей карты.
import * as THREE from 'three';
import { CELL, WALL_H, isFloorChar, isDoorChar, ITEMS } from '/shared/map.js';
import * as TX from './textures.js';
import { createExitLocks } from './models.js';

const DOOR_H = 2.2, JAMB = 0.25;
// детерминированный ГСЧ: у обоих игроков декор одинаковый
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function buildWorld(scene, map, { dark = false } = {}) {
  const root = new THREE.Group();
  scene.add(root);
  const interactables = [];
  const tex = {
    wall: TX.wallpaper(), wood: TX.woodFloor(), ceil: TX.ceiling(), tiles: TX.tiles(),
    door: TX.doorWood(), grass: TX.grass(), creaky: TX.creakyFloor(),
  };
  const mat = {
    wall: new THREE.MeshLambertMaterial({ map: tex.wall }),
    wood: new THREE.MeshLambertMaterial({ map: tex.wood }),
    tiles: new THREE.MeshLambertMaterial({ map: tex.tiles }),
    grass: new THREE.MeshLambertMaterial({ map: tex.grass }),
    creaky: new THREE.MeshLambertMaterial({ map: tex.creaky }),
    ceil: new THREE.MeshLambertMaterial({ map: tex.ceil }),
    door: new THREE.MeshLambertMaterial({ map: tex.door }),
    darkWood: new THREE.MeshLambertMaterial({ color: 0x3b2616 }),
    midWood: new THREE.MeshLambertMaterial({ color: 0x5e3d22 }),
    white: new THREE.MeshLambertMaterial({ color: 0xd8d2c4 }),
    sheet: new THREE.MeshLambertMaterial({ map: TX.fabric('#7a2e2e') }),
    sofa: new THREE.MeshLambertMaterial({ map: TX.fabric('#3e4f3a') }),
    metal: new THREE.MeshLambertMaterial({ color: 0x8b8f93 }),
    counter: new THREE.MeshLambertMaterial({ color: 0x6d5c48 }),
    books: new THREE.MeshLambertMaterial({ map: TX.books() }),
  };
  const roomName = (x, y) => map.rooms[map.roomOf[y]?.[x]]?.name;
  const rng = mulberry32(1998);

  // ---------- пол / потолок ----------
  const floorGeo = new THREE.PlaneGeometry(CELL, CELL); floorGeo.rotateX(-Math.PI / 2);
  const ceilGeo = new THREE.PlaneGeometry(CELL, CELL); ceilGeo.rotateX(Math.PI / 2);
  const floorCells = { wood: [], tiles: [], grass: [] }, ceilCells = [];
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const c = map.grid[y][x];
    if (c === '#') continue;
    const rn = roomName(x, y);
    if (c === 'O') { floorCells.grass.push([x, y]); continue; }
    (rn === 'Кухня' || rn === 'Ванная' ? floorCells.tiles : floorCells.wood).push([x, y]);
    ceilCells.push([x, y]);
  }
  const m4 = new THREE.Matrix4();
  const inst = (geo, material, cells, y, parent = root) => {
    const im = new THREE.InstancedMesh(geo, material, cells.length);
    cells.forEach(([x, cy], i) => { m4.makeTranslation((x + 0.5) * CELL, y, (cy + 0.5) * CELL); im.setMatrixAt(i, m4); });
    im.instanceMatrix.needsUpdate = true;
    parent.add(im);
    return im;
  };
  inst(floorGeo, mat.wood, floorCells.wood, 0);
  inst(floorGeo, mat.tiles, floorCells.tiles, 0);
  inst(floorGeo, mat.grass, floorCells.grass, 0);
  inst(ceilGeo, mat.ceil, ceilCells, WALL_H);
  let creakyMesh = null;
  const setCreaky = (list) => {
    if (creakyMesh) { root.remove(creakyMesh); creakyMesh.dispose(); }
    const cells = list.map(i => [i % map.w, Math.floor(i / map.w)]);
    creakyMesh = inst(floorGeo, mat.creaky, cells, 0.004);
    creakyMesh.receiveShadow = true;
  };

  // ---------- стены ----------
  const wallCells = [];
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    if (map.grid[y][x] !== '#') continue;
    let edge = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const n = map.grid[y + dy]?.[x + dx];
      if (n !== undefined && n !== '#') edge = true;
    }
    if (edge) wallCells.push([x, y]);
  }
  inst(new THREE.BoxGeometry(CELL, WALL_H, CELL), mat.wall, wallCells, WALL_H / 2);
  // плинтус снаружи дома не нужен; улица — «забор» из тьмы

  // ---------- двери ----------
  const doors = [];
  let exitLocks = null;
  for (const d of map.doors) {
    const g = new THREE.Group();
    g.position.set((d.x + 0.5) * CELL, 0, (d.y + 0.5) * CELL);
    if (d.axis === 'z') g.rotation.y = Math.PI / 2;
    root.add(g);
    // косяки и перемычка
    const jambGeo = new THREE.BoxGeometry(JAMB, WALL_H, CELL);
    const j1 = new THREE.Mesh(jambGeo, mat.wall); j1.position.set(-CELL / 2 + JAMB / 2, WALL_H / 2, 0);
    const j2 = new THREE.Mesh(jambGeo, mat.wall); j2.position.set(CELL / 2 - JAMB / 2, WALL_H / 2, 0);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(CELL, WALL_H - DOOR_H, CELL), mat.wall);
    lintel.position.y = DOOR_H + (WALL_H - DOOR_H) / 2;
    g.add(j1, j2, lintel);
    // полотно на петле
    const pivot = new THREE.Group();
    pivot.position.set(-CELL / 2 + JAMB, 0, 0);
    g.add(pivot);
    const w = CELL - 2 * JAMB;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(w, DOOR_H, 0.07), d.exit ? mat.darkWood : mat.door);
    panel.position.set(w / 2, DOOR_H / 2, 0);
    pivot.add(panel);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), mat.metal);
    knob.position.set(w - 0.12, 1.0, 0.06);
    const knob2 = knob.clone(); knob2.position.z = -0.06;
    pivot.add(knob, knob2);
    if (d.lock) {
      // цветная табличка замка — подсказка, какой ключ нужен
      const plateMat = new THREE.MeshLambertMaterial({ color: ITEMS[d.lock].color, emissive: new THREE.Color(ITEMS[d.lock].color).multiplyScalar(0.35) });
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.09), plateMat);
      plate.position.set(w - 0.12, 0.85, 0);
      pivot.add(plate);
      pivot.userData.plate = plate;
    }
    if (d.exit) {
      exitLocks = createExitLocks('x');
      exitLocks.position.set(0, 0, -0.1);
      g.add(exitLocks);
      exitLocks.traverse(o => { if (o.isMesh) o.userData.interact = { kind: 'door', id: d.id }; });
      // табличка «ВЫХОД»
    }
    panel.userData.interact = { kind: 'door', id: d.id };
    interactables.push(panel);
    if (exitLocks && d.exit) exitLocks.traverse(o => { if (o.isMesh) interactables.push(o); });
    doors.push({ g, pivot, angle: 0, target: 0 });
  }
  const setDoor = (id, open, lock) => {
    doors[id].target = open ? -Math.PI / 2 * 0.95 : 0;
    const pl = doors[id].pivot.userData.plate;
    if (pl) pl.visible = !!lock;
  };
  const updateDoors = (dt) => {
    for (const d of doors) {
      if (Math.abs(d.angle - d.target) < 0.001) continue;
      d.angle += (d.target - d.angle) * Math.min(1, dt * 7);
      d.pivot.rotation.y = d.angle;
    }
  };
  const setExitLocks = (locks) => {
    if (!exitLocks) return;
    for (const k of ['padlock', 'boards', 'chain']) exitLocks.userData[k].visible = !!locks[k];
  };

  // ---------- мебель / укрытия ----------
  const hideMeshes = {};
  const addBox = (parent, w, h, dd, material, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), material);
    m.position.set(x, y, z); parent.add(m); return m;
  };
  // направление «лицом» от стены к ближайшему свободному соседу
  const faceDir = (x, y) => {
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) if (isFloorChar(map.grid[y + dy]?.[x + dx])) return [dx, dy];
    return [0, 1];
  };
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const c = map.grid[y][x];
    const g = new THREE.Group();
    g.position.set((x + 0.5) * CELL, 0, (y + 0.5) * CELL);
    const [fx, fy] = faceDir(x, y);
    g.rotation.y = Math.atan2(fx, fy); // локальный +Z смотрит в комнату
    const rn = roomName(x, y);
    if (c === 'W') {
      const body = addBox(g, 1.3, 2.3, 0.9, mat.darkWood, 0, 1.15, -0.2);
      addBox(g, 0.62, 2.1, 0.03, mat.midWood, -0.32, 1.12, 0.26);
      addBox(g, 0.62, 2.1, 0.03, mat.midWood, 0.32, 1.12, 0.26);
      addBox(g, 0.04, 0.2, 0.05, mat.metal, -0.05, 1.2, 0.29);
      addBox(g, 0.04, 0.2, 0.05, mat.metal, 0.05, 1.2, 0.29);
      g.traverse(o => { if (o.isMesh) { o.userData.interact = { kind: 'hide', id: map.hideAt[y * map.w + x].id }; interactables.push(o); } });
      hideMeshes[map.hideAt[y * map.w + x].id] = g;
      void body;
    } else if (c === 'B') {
      // кровать вдоль оси X: соседняя B продолжает её
      g.rotation.y = 0;
      const left = map.grid[y][x - 1] === 'B', right = map.grid[y][x + 1] === 'B';
      addBox(g, CELL, 0.35, 1.25, mat.darkWood, 0, 0.3, 0);
      addBox(g, CELL - 0.02, 0.18, 1.2, mat.white, 0, 0.56, 0);
      addBox(g, CELL - 0.3, 0.08, 1.22, mat.sheet, right ? 0.15 : 0, 0.68, 0);
      if (!left) { addBox(g, 0.1, 1.1, 1.3, mat.darkWood, -CELL / 2 + 0.05, 0.55, 0); addBox(g, 0.4, 0.12, 0.8, mat.white, -CELL / 2 + 0.35, 0.7, 0); }
      if (!right) addBox(g, 0.1, 0.8, 1.3, mat.darkWood, CELL / 2 - 0.05, 0.4, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(g, 0.08, 0.15, 0.08, mat.darkWood, sx * (CELL / 2 - 0.08), 0.07, sz * 0.55);
      g.traverse(o => { if (o.isMesh) { o.userData.interact = { kind: 'hide', id: map.hideAt[y * map.w + x].id }; interactables.push(o); } });
      hideMeshes[map.hideAt[y * map.w + x].id] = g;
    } else if (c === 'T') {
      g.rotation.y = 0;
      addBox(g, CELL, 0.06, CELL, mat.midWood, 0, 0.78, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(g, 0.07, 0.76, 0.07, mat.darkWood, sx * (CELL / 2 - 0.1), 0.38, sz * (CELL / 2 - 0.1));
      if (rng() < 0.6) addBox(g, 0.12, 0.1, 0.12, mat.white, rng() * 0.6 - 0.3, 0.86, rng() * 0.6 - 0.3);
      if (rng() < 0.4) { const c2 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.25, 8), mat.white); c2.position.set(rng() * 0.8 - 0.4, 0.94, rng() * 0.8 - 0.4); g.add(c2); }
    } else if (c === 'C') {
      if (rn === 'Кабинет') {
        // книжный шкаф
        addBox(g, CELL, 2.2, 0.45, mat.darkWood, 0, 1.1, -0.5);
        for (let k = 0; k < 4; k++) {
          const shelf = new THREE.Mesh(new THREE.PlaneGeometry(CELL - 0.12, 0.42), mat.books);
          shelf.position.set(0, 0.3 + k * 0.52, -0.27);
          g.add(shelf);
        }
      } else if (rn === 'Ванная') {
        addBox(g, 0.7, 0.8, 0.5, mat.white, 0, 0.4, -0.35);
        addBox(g, 0.5, 0.05, 0.35, mat.metal, 0, 0.82, -0.33);
      } else {
        addBox(g, CELL, 0.9, 0.8, mat.counter, 0, 0.45, -0.3);
        addBox(g, CELL, 0.05, 0.85, mat.darkWood, 0, 0.92, -0.28);
        addBox(g, 0.5, 0.6, 0.02, mat.midWood, -0.35, 0.45, 0.11);
        addBox(g, 0.5, 0.6, 0.02, mat.midWood, 0.35, 0.45, 0.11);
      }
    } else if (c === 'S') {
      g.rotation.y = 0;
      addBox(g, CELL, 0.45, 0.9, mat.sofa, 0, 0.25, 0);
      addBox(g, CELL, 0.55, 0.25, mat.sofa, 0, 0.7, 0.35);
      if (map.grid[y][x - 1] !== 'S') addBox(g, 0.2, 0.65, 0.9, mat.sofa, -CELL / 2 + 0.1, 0.35, 0);
      if (map.grid[y][x + 1] !== 'S') addBox(g, 0.2, 0.65, 0.9, mat.sofa, CELL / 2 - 0.1, 0.35, 0);
    } else continue;
    root.add(g);
  }

  // ---------- декор: картины, ковры, часы ----------
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x4a3218 });
  const pics = ['granny', 'grandpa', 'cat', 'landscape'].map(k => new THREE.MeshLambertMaterial({ map: TX.portrait(k) }));
  const nearDoor = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isDoorChar(map.grid[y + dy]?.[x + dx]));
  let picCount = 0;
  for (let y = 1; y < map.h - 1; y++) for (let x = 1; x < map.w - 1; x++) {
    if (!isFloorChar(map.grid[y][x]) || nearDoor(x, y)) continue;
    const rn = roomName(x, y);
    if (!rn || rn === 'Улица') continue;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      if (map.grid[y + dy][x + dx] !== '#' || rng() > 0.11) continue;
      const g = new THREE.Group();
      g.position.set((x + 0.5) * CELL + dx * (CELL / 2 - 0.03), 1.55 + rng() * 0.15, (y + 0.5) * CELL + dy * (CELL / 2 - 0.03));
      g.rotation.y = Math.atan2(-dx, -dy);
      g.rotation.z = (rng() - 0.5) * 0.12; // висит криво
      addBox(g, 0.62, 0.76, 0.05, frameMat, 0, 0, 0);
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.64), pics[(picCount++) % pics.length]);
      pic.position.z = 0.03;
      g.add(pic);
      root.add(g);
      break;
    }
  }
  const rugMat = new THREE.MeshLambertMaterial({ map: TX.rug() });
  for (const r of map.rooms) {
    if (!['Спальня', 'Гостиная', 'Комната бабки', 'Кабинет'].includes(r.name)) continue;
    const rugMesh = new THREE.Mesh(new THREE.PlaneGeometry(r.name === 'Гостиная' ? 4.2 : 3, r.name === 'Гостиная' ? 2.8 : 2), rugMat);
    rugMesh.rotation.x = -Math.PI / 2;
    rugMesh.position.set((r.cx + 0.5) * CELL, 0.008, (r.cy + 0.5) * CELL);
    rugMesh.userData.floor = true;
    root.add(rugMesh);
  }
  // часы в коридоре (всегда без пяти двенадцать)
  {
    const g = new THREE.Group();
    g.position.set(17.5 * CELL, 0, 7 * CELL + 0.13); // у северной стены коридора
    addBox(g, 0.55, 2.0, 0.24, mat.darkWood, 0, 1.0, 0);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24), new THREE.MeshLambertMaterial({ map: TX.clockFace() }));
    face.position.set(0, 1.6, 0.125);
    g.add(face);
    const pend = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 16), new THREE.MeshLambertMaterial({ color: 0xc9a25a, emissive: 0x221800 }));
    pend.rotation.x = Math.PI / 2;
    const pivot = new THREE.Group(); pivot.position.set(0, 1.3, 0.13); pend.position.y = -0.45; pivot.add(pend);
    g.add(pivot);
    root.add(g);
    root.userData.pendulum = pivot;
  }

  // ---------- свет ----------
  const lamps = [];
  const bulbGeo = new THREE.SphereGeometry(0.08, 8, 6);
  for (const r of map.rooms) {
    if (r.outside) continue;
    if (dark && r.name !== 'Спальня') continue;
    const lx = (r.cx + 0.5) * CELL, lz = (r.cy + 0.5) * CELL;
    const color = r.name === 'Комната бабки' ? 0xff7050 : 0xffb56b;
    const light = new THREE.PointLight(color, r.name === 'Коридор' ? 5 : 3.2, r.name === 'Коридор' ? 11 : 7, 1.6);
    light.position.set(lx, WALL_H - 0.45, lz);
    const bulb = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color }));
    bulb.position.copy(light.position);
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.4, 4), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    wire.position.set(lx, WALL_H - 0.2, lz);
    root.add(light, bulb, wire);
    lamps.push({ light, bulb, base: light.intensity, flicker: r.name === 'Коридор' || r.name === 'Ванная' || Math.random() < 0.3, t: Math.random() * 10 });
  }
  let clockT = 0;
  const updateLamps = (dt) => {
    clockT += dt;
    if (root.userData.pendulum) root.userData.pendulum.rotation.z = Math.sin(clockT * 3.2) * 0.25;
    for (const l of lamps) {
      if (!l.flicker) continue;
      l.t += dt;
      const f = Math.sin(l.t * 13) * Math.sin(l.t * 3.1) > 0.93 ? 0.15 : 1;
      l.light.intensity = l.base * f;
      l.bulb.visible = f > 0.5;
    }
  };
  // луна над улицей
  const moon = new THREE.PointLight(0x7788cc, 6, 10, 1.2);
  const exitDoor = map.doors.find(d => d.exit);
  moon.position.set((exitDoor.x + 0.5) * CELL, 3, (exitDoor.y + 1.8) * CELL);
  root.add(moon);

  // ---------- тени от фонарика ----------
  root.traverse(o => {
    if (!o.isMesh) return;
    const isFloor = o.userData.floor || o.geometry?.type === 'PlaneGeometry' && o.isInstancedMesh;
    o.receiveShadow = true;
    o.castShadow = !isFloor && !(o.material?.isMeshBasicMaterial);
  });

  return { root, interactables, setDoor, updateDoors, setExitLocks, setCreaky, updateLamps, hideMeshes, lamps };
}

export { isDoorChar };
