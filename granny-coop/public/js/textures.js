// Процедурные текстуры (рисуются на canvas, никаких внешних файлов).
import * as THREE from 'three';

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const rnd = (a, b) => a + Math.random() * (b - a);

function grime(g, w, h, n, alpha) {
  for (let i = 0; i < n; i++) {
    const r = rnd(4, 40);
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, r);
    grd.addColorStop(0, `rgba(20,14,8,${alpha})`);
    grd.addColorStop(1, 'rgba(20,14,8,0)');
    g.save(); g.translate(rnd(0, w), rnd(0, h)); g.fillStyle = grd; g.fillRect(-r, -r, 2 * r, 2 * r); g.restore();
  }
}

export function wallpaper() {
  return canvas(256, 256, (g, w, h) => {
    g.fillStyle = '#6b5a45'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) {
      g.fillStyle = 'rgba(60,40,30,0.35)'; g.fillRect(x, 0, 10, h);
      g.fillStyle = 'rgba(255,230,190,0.06)'; g.fillRect(x + 14, 0, 4, h);
    }
    // цветочки
    g.fillStyle = 'rgba(120,40,40,0.35)';
    for (let y = 16; y < h; y += 48) for (let x = 22; x < w; x += 32) {
      for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(x + Math.cos(k * 1.26) * 4, y + Math.sin(k * 1.26) * 4, 3, 0, 7); g.fill(); }
    }
    grime(g, w, h, 30, 0.25);
    // панель снизу
    g.fillStyle = '#3b2a1c'; g.fillRect(0, h - 60, w, 60);
    g.fillStyle = '#2a1d12'; g.fillRect(0, h - 62, w, 4);
    for (let x = 0; x < w; x += 64) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, h - 58, 2, 58); }
  });
}

export function woodFloor() {
  return canvas(256, 256, (g, w, h) => {
    const plank = 32;
    for (let y = 0; y < h; y += plank) {
      const off = (y / plank) % 2 ? 90 : 0;
      for (let x = -off; x < w; x += 180) {
        const l = rnd(28, 40);
        g.fillStyle = `hsl(28, 35%, ${l}%)`;
        g.fillRect(x, y, 180, plank);
        for (let k = 0; k < 14; k++) {
          g.strokeStyle = `rgba(40,20,10,${rnd(0.05, 0.2)})`;
          g.beginPath(); const yy = y + rnd(2, plank - 2); g.moveTo(x, yy); g.bezierCurveTo(x + 60, yy + rnd(-3, 3), x + 120, yy + rnd(-3, 3), x + 180, yy); g.stroke();
        }
        g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x, y, 2, plank);
      }
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, y, w, 2);
    }
    grime(g, w, h, 25, 0.3);
  });
}

export function creakyFloor() {
  return canvas(64, 64, (g, w, h) => {
    g.fillStyle = 'hsl(25, 25%, 20%)'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 2;
    for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(rnd(0, w), 0); g.lineTo(rnd(0, w), h); g.stroke(); }
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3);
  });
}

export function ceiling() {
  return canvas(128, 128, (g, w, h) => {
    g.fillStyle = '#8c8578'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(0,0,0,${rnd(0, 0.08)})`; g.fillRect(rnd(0, w), rnd(0, h), 2, 2); }
    grime(g, w, h, 10, 0.3);
  });
}

export function tiles() {
  return canvas(128, 128, (g, w, h) => {
    for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) {
      g.fillStyle = ((x + y) / 32) % 2 ? '#bdb7a6' : '#57544c'; g.fillRect(x, y, 32, 32);
    }
    g.strokeStyle = 'rgba(0,0,0,0.4)';
    for (let i = 0; i <= w; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
    grime(g, w, h, 20, 0.35);
  });
}

export function doorWood() {
  return canvas(128, 256, (g, w, h) => {
    g.fillStyle = '#4a2f1b'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(20,10,5,${rnd(0.1, 0.3)})`; g.beginPath(); const x = rnd(0, w); g.moveTo(x, 0); g.lineTo(x + rnd(-6, 6), h); g.stroke(); }
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 4;
    g.strokeRect(16, 20, w - 32, 90); g.strokeRect(16, 130, w - 32, 106);
    grime(g, w, h, 8, 0.3);
  });
}

export function grass() {
  return canvas(128, 128, (g, w, h) => {
    g.fillStyle = '#1b2a17'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { g.fillStyle = `hsl(${rnd(80, 120)}, 40%, ${rnd(8, 22)}%)`; g.fillRect(rnd(0, w), rnd(0, h), 1, rnd(2, 5)); }
  });
}

export function fabric(color) {
  return canvas(64, 64, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, y, w, 1); }
    for (let x = 0; x < w; x += 4) { g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x, 0, 1, h); }
  });
}
