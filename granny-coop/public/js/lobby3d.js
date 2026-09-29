// 3D-лобби: ночной двор перед домом бабки, игроки на лужайке, бабка смотрит из дверей.
import * as THREE from 'three';
import { Character } from './characters.js';

function nameTag(text, color, ready) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.font = 'bold 54px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(500, g.measureText(text).width + 60);
  g.fillStyle = 'rgba(8,6,6,0.72)'; g.beginPath(); g.roundRect(256 - w / 2, 14, w, 72, 16); g.fill();
  g.strokeStyle = color; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#f2e8dc'; g.fillText(text, 256, 52);
  g.font = 'bold 28px sans-serif'; g.fillStyle = ready ? '#6be07a' : '#c9a890';
  g.fillText(ready ? '✔ ГОТОВ' : 'ждёт…', 256, 108);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(1.3, 0.325, 1);
  return s;
}

export class Lobby3D {
  constructor(mats) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070d);
    this.scene.fog = new THREE.FogExp2(0x070a12, 0.055);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
    this.t = 0;
    this.players = new Map();
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0x5060a0, 0x101008, 0.35));
    const moon = new THREE.DirectionalLight(0x9fb2ff, 1.4);
    moon.position.set(-12, 18, 10); moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048); Object.assign(moon.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 60 });
    moon.shadow.bias = -0.0005;
    s.add(moon);
    // земля
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), mats.grass);
    for (const k of ['map', 'normalMap', 'roughnessMap']) ground.material[k].repeat.set(24, 24);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; s.add(ground);
    // дорожка
    const path = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 9), mats.concrete); path.rotation.x = -Math.PI / 2; path.position.set(0, 0.01, 2.5); path.receiveShadow = true; s.add(path);
    // фасад дома
    const house = new THREE.Group(); house.position.set(0, 0, -3); s.add(house);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(16, 6.4, 8), mats.brickDark); wall.position.set(0, 3.2, -4); wall.castShadow = wall.receiveShadow = true; house.add(wall);
    const roofShape = new THREE.Shape(); roofShape.moveTo(-8.6, 0); roofShape.lineTo(0, 3.6); roofShape.lineTo(8.6, 0); roofShape.lineTo(-8.6, 0);
    const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(roofShape, { depth: 8.8, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: 0x2a1c18, roughness: 0.9 }));
    roof.position.set(0, 6.4, -8.4); roof.castShadow = true; house.add(roof);
    // окна: часть светится
    const winLit = new THREE.MeshStandardMaterial({ color: 0x2a1a0a, emissive: 0xffa040, emissiveIntensity: 1.6 });
    const winDark = mats.windowGlass;
    const frameM = mats.woodLight;
    for (const [x, y, lit] of [[-5.5, 1.9, true], [-2.8, 1.9, false], [2.8, 1.9, false], [5.5, 1.9, true], [-5.5, 4.7, false], [-2.8, 4.7, true], [2.8, 4.7, false], [5.5, 4.7, false]]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.3), lit ? winLit : winDark); w.position.set(x, y, 0.01); house.add(w);
      for (const [fw, fh, fx, fy] of [[1.25, 0.08, 0, 0.68], [1.25, 0.08, 0, -0.68], [0.08, 1.4, -0.6, 0], [0.08, 1.4, 0.6, 0], [0.05, 1.3, 0, 0]]) { const f = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.08), frameM); f.position.set(x + fx, y + fy, 0.03); house.add(f); }
      if (lit) { const l = new THREE.PointLight(0xff9a40, 3, 7, 1.8); l.position.set(x, y, 1.2); house.add(l); }
    }
    // дверь и крыльцо
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.3, 0.1), mats.wood); door.position.set(0, 1.15 + 0.35, 0.05); door.castShadow = true; house.add(door);
    const doorway = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.3), new THREE.MeshBasicMaterial({ color: 0x0a0604 })); doorway.position.set(0, 1.5, 0.02); house.add(doorway);
    door.rotation.y = -1.2; door.position.x = -0.55; door.position.z = 0.55;
    for (let i = 0; i < 3; i++) { const st = new THREE.Mesh(new THREE.BoxGeometry(3 - i * 0.3, 0.12, 1.2 - i * 0.3), mats.concrete); st.position.set(0, 0.06 + i * 0.12, 0.6 - i * 0.15); st.receiveShadow = st.castShadow = true; house.add(st); }
    const porchLight = new THREE.PointLight(0xffb060, 6, 9, 1.6); porchLight.position.set(0, 3.1, 0.8); porchLight.castShadow = true; porchLight.shadow.mapSize.set(512, 512); house.add(porchLight);
    this.porchLight = porchLight;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd090 })); bulb.position.copy(porchLight.position); house.add(bulb);
    // забор
    for (let i = -14; i <= 14; i++) {
      if (Math.abs(i) < 2) continue;
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.05), mats.wood); p.position.set(i * 0.5, 0.6, 8.5); p.rotation.z = Math.sin(i * 1.7) * 0.05; p.castShadow = true; s.add(p);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(14, 0.08, 0.06), mats.wood); rail.position.set(0, 0.9, 8.48); s.add(rail);
    // деревья
    const bark = new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 1 });
    const leaves = new THREE.MeshStandardMaterial({ color: 0x0c140b, roughness: 1 });
    for (const [x, z, h] of [[-9, 2, 7], [9.5, 3, 8], [-11, -6, 9], [11, -5, 7.5], [-6, 9, 6], [7, 10, 7]]) {
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, h * 0.55, 8), bark); tr.position.set(x, h * 0.27, z); tr.castShadow = true; s.add(tr);
      for (let k = 0; k < 3; k++) { const c = new THREE.Mesh(new THREE.ConeGeometry(1.8 - k * 0.4, h * 0.45, 9), leaves); c.position.set(x, h * 0.45 + k * h * 0.17, z); c.castShadow = true; s.add(c); }
    }
    // бабка в дверях
    this.granny = new Character('granny');
    this.granny.root.position.set(0.1, 0.36, -2.75);
    s.add(this.granny.root);
    // светлячки / пыль
    const pg = new THREE.BufferGeometry(); const pp = new Float32Array(300 * 3);
    for (let i = 0; i < 300; i++) { pp[i * 3] = (Math.random() - 0.5) * 24; pp[i * 3 + 1] = Math.random() * 5; pp[i * 3 + 2] = (Math.random() - 0.5) * 18; }
    pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    this.dust = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xc8d0ff, size: 0.03, transparent: true, opacity: 0.6 }));
    s.add(this.dust);
  }

  setPlayers(list) {
    const ids = new Set(list.map(p => p.id));
    for (const [id, rec] of this.players) if (!ids.has(id)) { this.scene.remove(rec.ch.root); this.scene.remove(rec.tag); this.players.delete(id); }
    list.forEach((p, i) => {
      let rec = this.players.get(p.id);
      if (!rec || rec.look !== p.look) {
        if (rec) { this.scene.remove(rec.ch.root); this.scene.remove(rec.tag); }
        const ch = new Character(p.look === 'f' ? 'f' : 'm', p.color);
        this.scene.add(ch.root);
        rec = { ch, look: p.look, tag: null, key: '' };
        this.players.set(p.id, rec);
      }
      rec.ch.setColor(p.color);
      const x = (i - (list.length - 1) / 2) * 1.25;
      rec.ch.root.position.set(x, 0, 3.2 + Math.abs(x) * 0.15);
      rec.ch.root.rotation.y = Math.PI + (x * -0.08);
      rec.ready = p.ready;
      const key = `${p.name}|${p.color}|${p.ready}`;
      if (rec.key !== key) {
        if (rec.tag) this.scene.remove(rec.tag);
        rec.tag = nameTag(p.name, p.color, p.ready);
        this.scene.add(rec.tag);
        rec.key = key;
      }
      rec.tag.position.set(x, 2.25, 3.2 + Math.abs(x) * 0.15);
    });
  }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  update(dt) {
    this.t += dt;
    // медленный облёт; кадр смещён влево, справа — панель меню
    const a = Math.sin(this.t * 0.08) * 0.3 - 0.12;
    this.camera.position.set(1.8 + Math.sin(a) * 5.6, 1.75 + Math.sin(this.t * 0.2) * 0.08, 3.2 + Math.cos(a) * 5.6);
    this.camera.lookAt(1.9, 1.35, 0.8);
    for (const rec of this.players.values()) rec.ch.update(dt, { speed: 0, holdLight: false, lookPitch: 0.05, lookYaw: Math.sin(this.t * 0.5 + rec.ch.root.position.x) * 0.3, holdItem: false });
    this.granny.update(dt, { speed: 0, lookYaw: Math.sin(this.t * 0.3) * 0.25, lookPitch: -0.1, angry: Math.sin(this.t * 0.2) > 0.7 });
    this.porchLight.intensity = 6 * (Math.sin(this.t * 11) * Math.sin(this.t * 2.3) > 0.9 ? 0.2 : 1);
    this.dust.rotation.y += dt * 0.01;
    const p = this.dust.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, (p.getY(i) + dt * 0.08 * (1 + (i % 5) * 0.2)) % 5);
    p.needsUpdate = true;
  }
}
