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

// ---------- декор: картины, ковёр, часы, книги ----------
export function portrait(kind) {
  return canvas(128, 160, (g, w, h) => {
    g.fillStyle = '#2a2018'; g.fillRect(0, 0, w, h);
    const grd = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, 110);
    grd.addColorStop(0, '#6b5a40'); grd.addColorStop(1, '#1c140d');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    if (kind === 'granny' || kind === 'grandpa') {
      g.fillStyle = '#3d2850'; g.beginPath(); g.ellipse(64, 170, 58, 60, 0, 0, 7); g.fill();
      g.fillStyle = '#d8b894'; g.beginPath(); g.ellipse(64, 72, 30, 38, 0, 0, 7); g.fill();
      if (kind === 'granny') {
        g.fillStyle = '#bdbdbd'; g.beginPath(); g.ellipse(64, 50, 34, 24, 0, Math.PI, 0); g.fill();
        g.beginPath(); g.arc(64, 26, 13, 0, 7); g.fill();
        g.strokeStyle = '#111'; g.lineWidth = 2;
        g.beginPath(); g.arc(52, 70, 8, 0, 7); g.moveTo(84, 70); g.arc(76, 70, 8, 0, 7); g.stroke();
        g.fillStyle = '#fff'; g.fillRect(50, 68, 4, 4); g.fillRect(74, 68, 4, 4);
      } else {
        g.fillStyle = '#5a4a3a'; g.fillRect(44, 88, 40, 6); // усы
        g.fillStyle = '#111'; g.fillRect(49, 67, 6, 5); g.fillRect(73, 67, 6, 5);
        g.fillStyle = '#c9b27a'; g.fillRect(20, 134, 88, 18);
        g.fillStyle = '#2a1d12'; g.font = 'bold 11px serif'; g.textAlign = 'center'; g.fillText('УШЁЛ ЗА ХЛЕБОМ', 64, 147);
      }
      g.fillStyle = '#6b2020'; g.fillRect(56, 92, 16, 3);
    } else if (kind === 'cat') {
      g.fillStyle = '#111';
      g.beginPath(); g.ellipse(64, 110, 36, 40, 0, 0, 7); g.fill();
      g.beginPath(); g.arc(64, 64, 26, 0, 7); g.fill();
      g.beginPath(); g.moveTo(42, 50); g.lineTo(46, 26); g.lineTo(58, 42); g.moveTo(86, 50); g.lineTo(82, 26); g.lineTo(70, 42); g.fill();
      g.fillStyle = '#e8d24a'; g.beginPath(); g.ellipse(54, 62, 5, 7, 0, 0, 7); g.ellipse(74, 62, 5, 7, 0, 0, 7); g.fill();
    } else {
      g.fillStyle = '#10182a'; g.fillRect(0, 0, w, 100);
      g.fillStyle = '#e8e2c0'; g.beginPath(); g.arc(90, 36, 14, 0, 7); g.fill();
      g.fillStyle = '#1b2414'; g.beginPath(); g.moveTo(0, 100); g.quadraticCurveTo(50, 70, 128, 96); g.lineTo(128, 160); g.lineTo(0, 160); g.fill();
      g.fillStyle = '#0a0a0a'; g.fillRect(30, 72, 22, 20); g.beginPath(); g.moveTo(26, 74); g.lineTo(41, 60); g.lineTo(56, 74); g.fill();
      g.fillStyle = '#d4a020'; g.fillRect(38, 80, 5, 5);
    }
    // трещинки лака
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1;
    for (let i = 0; i < 12; i++) { g.beginPath(); const x = rnd(0, w), y = rnd(0, h); g.moveTo(x, y); g.lineTo(x + rnd(-15, 15), y + rnd(-15, 15)); g.stroke(); }
  });
}

export function rug() {
  return canvas(256, 160, (g, w, h) => {
    g.fillStyle = '#5c1a1a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c9a25a'; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20);
    g.strokeStyle = '#1f3a4a'; g.lineWidth = 4; g.strokeRect(22, 22, w - 44, h - 44);
    for (let x = 40; x < w - 30; x += 36) for (let y = 40; y < h - 30; y += 36) {
      g.fillStyle = (x + y) % 72 ? '#c9a25a' : '#1f3a4a';
      g.beginPath(); g.moveTo(x, y - 10); g.lineTo(x + 10, y); g.lineTo(x, y + 10); g.lineTo(x - 10, y); g.fill();
    }
    grime(g, w, h, 18, 0.35);
  });
}

export function clockFace() {
  return canvas(128, 128, (g) => {
    g.fillStyle = '#e8dfc8'; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill();
    g.strokeStyle = '#2a1d12'; g.lineWidth = 4; g.stroke();
    g.fillStyle = '#2a1d12'; g.font = 'bold 14px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    ['XII', 'III', 'VI', 'IX'].forEach((t, i) => { const a = i * Math.PI / 2 - Math.PI / 2; g.fillText(t, 64 + Math.cos(a) * 45, 64 + Math.sin(a) * 45); });
    g.lineWidth = 4; g.beginPath(); g.moveTo(64, 64); g.lineTo(64, 28); g.stroke(); // без пяти двенадцать… всегда
    g.lineWidth = 3; g.beginPath(); g.moveTo(64, 64); g.lineTo(54, 30); g.stroke();
  });
}

export function books() {
  return canvas(128, 64, (g, w, h) => {
    g.fillStyle = '#1a1008'; g.fillRect(0, 0, w, h);
    let x = 2;
    while (x < w - 4) {
      const bw = rnd(5, 11), bh = rnd(40, 60);
      g.fillStyle = `hsl(${rnd(0, 360)}, ${rnd(20, 50)}%, ${rnd(15, 35)}%)`;
      g.fillRect(x, h - bh, bw, bh);
      g.fillStyle = 'rgba(255,220,150,0.3)'; g.fillRect(x + 1, h - bh + 6, bw - 2, 2);
      x += bw + 1;
    }
  });
}
