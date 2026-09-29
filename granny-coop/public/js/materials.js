// Библиотека PBR-материалов: фото-подобные текстуры из public/textures (цвет + нормали + шероховатость).
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const cache = new Map();
let maxAniso = 8;
export function setAnisotropy(n) { maxAniso = Math.min(8, n || 4); }

function tex(file, srgb) {
  const key = file + (srgb ? ':s' : '');
  if (cache.has(key)) return cache.get(key);
  const t = loader.load('/textures/' + file);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

// UV в геометрии дома заданы в метрах; scale — сколько метров занимает один тайл текстуры
function pbr(name, scale = 1.6, opts = {}) {
  const make = (t) => { const c = t.clone(); c.needsUpdate = true; c.repeat.set(1 / scale, 1 / scale); return c; };
  const m = new THREE.MeshStandardMaterial({
    map: make(tex(`${name}_c.jpg`, true)),
    normalMap: make(tex(`${name}_n.jpg`)),
    roughnessMap: make(tex(`${name}_r.jpg`)),
    roughness: 1, metalness: 0,
    normalScale: new THREE.Vector2(opts.normal ?? 1, opts.normal ?? 1),
    envMapIntensity: opts.env ?? 0.35,
    ...opts.extra,
  });
  if (opts.color) m.color.set(opts.color);
  return m;
}

export function createMaterials() {
  return {
    woodfloor: pbr('woodfloor', 2.2, { normal: 0.9, env: 0.5 }),
    wallpaper: pbr('wallpaper', 1.7, { normal: 0.6 }),
    wallpaperRed: pbr('wallpaper', 1.7, { normal: 0.6, color: 0xc9a0a0 }),
    wallpaperGreen: pbr('wallpaper', 1.7, { normal: 0.6, color: 0xa9b8a0 }),
    wallpaperBlue: pbr('wallpaper', 1.7, { normal: 0.6, color: 0xa4acc0 }),
    plaster: pbr('plaster', 2.5, { normal: 0.8 }),
    plasterDark: pbr('plaster', 2.5, { normal: 0.8, color: 0x8a8378 }),
    tiles: pbr('tiles', 1.6, { normal: 1, env: 0.8 }),
    tilesWall: pbr('walltile', 1.2, { normal: 1, env: 0.8 }),
    concrete: pbr('concrete', 3, { normal: 1 }),
    brick: pbr('brick', 1.3, { normal: 1.2 }),
    brickDark: pbr('brick', 1.3, { normal: 1.2, color: 0x8a7a70 }),
    wood: pbr('wood', 1.0, { normal: 0.8, env: 0.5 }),
    woodLight: pbr('wood', 1.0, { normal: 0.8, env: 0.5, color: 0xd8b890 }),
    panel: pbr('panel', 1.2, { normal: 1 }),
    grass: pbr('grass', 3, {}),
    asphalt: pbr('asphalt', 4, {}),
    // простые материалы
    metal: new THREE.MeshStandardMaterial({ color: 0x8a8d90, metalness: 0.9, roughness: 0.35 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x2a2a2c, metalness: 0.85, roughness: 0.45 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x6a3a22, metalness: 0.5, roughness: 0.85 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: 1, roughness: 0.3 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe0e0e0, metalness: 1, roughness: 0.12 }),
    ceramic: new THREE.MeshStandardMaterial({ color: 0xece8de, metalness: 0, roughness: 0.18, envMapIntensity: 0.9 }),
    enamel: new THREE.MeshStandardMaterial({ color: 0xd8d2c0, metalness: 0.1, roughness: 0.3, envMapIntensity: 0.8 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x88a0b0, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.25, envMapIntensity: 1.5, depthWrite: false }),
    windowGlass: new THREE.MeshStandardMaterial({ color: 0x223040, emissive: 0x0a1428, metalness: 0, roughness: 0.08, envMapIntensity: 1.2 }),
    fabricRed: new THREE.MeshStandardMaterial({ color: 0x5a1c1c, roughness: 0.95 }),
    fabricGreen: new THREE.MeshStandardMaterial({ color: 0x2e3d2a, roughness: 0.95 }),
    fabricBeige: new THREE.MeshStandardMaterial({ color: 0xb8a88a, roughness: 0.95 }),
    fabricWhite: new THREE.MeshStandardMaterial({ color: 0xd6d0c4, roughness: 0.9 }),
    curtain: new THREE.MeshStandardMaterial({ color: 0x4a1418, roughness: 0.9, side: THREE.DoubleSide }),
    paper: new THREE.MeshStandardMaterial({ color: 0xcfc6b0, roughness: 0.95 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.6 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }),
    carPaint: new THREE.MeshPhysicalMaterial({ color: 0x3a4a3a, metalness: 0.6, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.15, envMapIntensity: 1 }),
    headlight: new THREE.MeshStandardMaterial({ color: 0xfff6d0, emissive: 0x000000, roughness: 0.1 }),
    bulb: new THREE.MeshBasicMaterial({ color: 0xffd8a0 }),
    ember: new THREE.MeshBasicMaterial({ color: 0xff6a20 }),
    shade: new THREE.MeshStandardMaterial({ color: 0xd8c09a, roughness: 0.8, emissive: 0x3a2410, side: THREE.DoubleSide }),
    sky: new THREE.MeshBasicMaterial({ color: 0x0a0f1c, side: THREE.BackSide }),
  };
}
