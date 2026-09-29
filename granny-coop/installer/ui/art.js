// Пиксель-арт бабки 16×16. Общий для интерфейса установщика и генератора иконки .ico.
export const PALETTE = {
  h: '#cfcfcf', H: '#8f8f8f', s: '#f0c8a0', S: '#c89a74', k: '#1a1a1a', w: '#ffffff', r: '#e01010',
  g: '#2b2b2b', d: '#5a3d6e', D: '#3d2850', a: '#d8d0c0', b: '#7a4a1e', R: '#ff5a3c',
};

const BASE = [
  '......hhhh......',
  '.....hhhhhh.....',
  '....hhhhhhhh....',
  '...hhHHHHHHhh...',
  '...hHssssssHh...',
  '...sgggssgggs...',
  '...sgEgssgEgs...',
  '...sgggssgggs...',
  '...SsssSSsssS...',
  '....SsMMMMsS....',
  '.....SSSSSS.....',
  '....ddddddd....b',
  '...dddaaaddd..b.',
  '..ddddaaadddsb..',
  '..ddddaaaddd....',
  '.dddddaaaddddd..',
];

// mood: calm | angry | sleep | crazy | happy
export function grannyPixels(mood = 'calm') {
  const eye = { calm: 'w', angry: 'r', sleep: 'g', crazy: 'R', happy: 'k' }[mood] || 'w';
  const mouth = { calm: 'SkkS', angry: 'kkkk', sleep: 'SSSS', crazy: 'kwwk', happy: 'kSSk' }[mood] || 'SkkS';
  return BASE.map(row => {
    let r = row.replace(/E/g, eye);
    if (r.includes('MMMM')) r = r.replace('MMMM', mouth);
    return r;
  });
}

// Нарисовать на canvas (браузер)
export function drawGranny(canvas, mood = 'calm', scale = 8) {
  const px = grannyPixels(mood);
  canvas.width = 16 * scale; canvas.height = 16 * scale;
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, canvas.width, canvas.height);
  px.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '.') return;
    g.fillStyle = PALETTE[c] || '#f0f';
    g.fillRect(x * scale, y * scale, scale, scale);
  }));
}

// RGBA-пиксели заданного размера (для .ico)
export function grannyRGBA(size, mood = 'angry') {
  const px = grannyPixels(mood);
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = px[Math.floor((y * 16) / size)][Math.floor((x * 16) / size)];
    if (c === '.') continue;
    const hex = PALETTE[c];
    const i = (y * size + x) * 4;
    out[i] = parseInt(hex.slice(1, 3), 16); out[i + 1] = parseInt(hex.slice(3, 5), 16); out[i + 2] = parseInt(hex.slice(5, 7), 16); out[i + 3] = 255;
  }
  return out;
}
