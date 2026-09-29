// Персонажи: загрузка GLB (MakeHuman), экземпляры со своим скелетом, аниматор, вещи в руках.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { HumanRig, Animator } from './rig.js';

const loader = new GLTFLoader();
const cache = {};   // имя → загруженный glTF
const pending = {}; // имя → Promise
export function preloadCharacters() {
  return Promise.all(['granny', 'player_m', 'player_f'].map(n => (pending[n] ||= loader.loadAsync(`/models/${n}.glb`).then(g => (cache[n] = g)))));
}
export const charactersReady = () => !!(cache.granny && cache.player_m && cache.player_f);

function shadowsOn(o) { o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); }

// бита: точёная деревянная, с потёртостями и гвоздём
function makeBat() {
  const pts = [[0.0, 0], [0.018, 0], [0.02, 0.02], [0.016, 0.03], [0.015, 0.25], [0.024, 0.45], [0.036, 0.7], [0.04, 0.8], [0.038, 0.83], [0, 0.84]].map(([r, y]) => new THREE.Vector2(r, y));
  const bat = new THREE.Mesh(new THREE.LatheGeometry(pts, 16), new THREE.MeshStandardMaterial({ color: 0x6a4424, roughness: 0.65, metalness: 0 }));
  const tape = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.16, 12), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }));
  tape.position.y = 0.11; bat.add(tape);
  for (let i = 0; i < 3; i++) { const n = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.06, 5), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 1, roughness: 0.4 })); n.position.set(0.035, 0.62 + i * 0.07, 0); n.rotation.z = Math.PI / 2 + (i - 1) * 0.3; bat.add(n); }
  shadowsOn(bat);
  return bat;
}

export function makeFlashlight() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.17, 14), new THREE.MeshStandardMaterial({ color: 0x1e1e20, metalness: 0.7, roughness: 0.4 }));
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.024, 0.05, 16), new THREE.MeshStandardMaterial({ color: 0x2a2a2c, metalness: 0.8, roughness: 0.3 }));
  head.position.y = 0.105;
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.028, 16), new THREE.MeshBasicMaterial({ color: 0xfff2d0 }));
  lens.rotation.x = -Math.PI / 2; lens.position.y = 0.131;
  const btn = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.02, 0.008), new THREE.MeshStandardMaterial({ color: 0x8a1010 }));
  btn.position.set(0, 0.02, 0.021);
  g.add(body, head, lens, btn);
  g.userData.lens = lens;
  shadowsOn(g);
  return g;
}

export class Character {
  // kind: 'granny' | 'm' | 'f'
  constructor(kind, color = '#ffffff') {
    const name = kind === 'granny' ? 'granny' : kind === 'f' ? 'player_f' : 'player_m';
    this.kind = kind;
    this.root = SkeletonUtils.clone(cache[name].scene);
    shadowsOn(this.root);
    // материалы — свои у экземпляра (цвет рубашки)
    this.root.traverse(o => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      if (o.material.name === 'shirt') o.material.color.set(color);
      if (o.material.name === 'skin') o.material.envMapIntensity = 0.25;
    });
    this.rig = new HumanRig(this.root);
    this.anim = new Animator(this.rig, kind === 'granny' ? 'granny' : 'player');
    const hand = (side) => this.rig.bones[`wrist${side}`];
    this.handR = hand('R'); this.handL = hand('L');
    if (kind === 'granny') {
      this.bat = makeBat();
      this.bat.position.set(0, 0.07, 0.01);
      this.bat.rotation.set(0.3, 0, Math.PI);
      this.handR?.add(this.bat);
    } else {
      this.torch = makeFlashlight();
      this.torch.position.set(0, 0.075, 0.02);
      this.torch.rotation.set(0, 0, Math.PI);
      this.handR?.add(this.torch);
      this.heldSlot = new THREE.Group();
      this.heldSlot.position.set(0, 0.08, 0.03);
      this.handL?.add(this.heldSlot);
    }
  }

  setColor(color) { this.root.traverse(o => { if (o.isMesh && o.material.name === 'shirt') o.material.color.set(color); }); }

  update(dt, st) { this.anim.update(dt, st); }
}
