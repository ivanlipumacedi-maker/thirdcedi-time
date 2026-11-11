// Íconos de la app (instalada) de CEDI CLUB: el rombo del logo original de CEDI (dev/tools/iconos-app/base-512.png) arriba y
// abajo "CEDI" y "CLUB" con la misma letra (Montserrat 700), el mismo tamaño y la misma separación, centradas, sobre el mismo azul.
// Va apilado porque Android recorta el ícono (círculo o cuadrado redondeado) y lo usa también en la pantalla de arranque.
// Todo entra en la zona segura (el círculo del 80 % del centro); el maskable va un poco más chico.
// Uso: NODE_PATH=dev/tools/node_modules node dev/tools/iconos-app.js
//      (escribe icon-192.png, icon-512.png e icon-maskable-512.png en la raíz). Necesita Chrome e internet (Montserrat).
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const RAIZ = path.join(__dirname, '..', '..');
const BASE = path.join(__dirname, 'iconos-app', 'base-512.png');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// [archivo, lado, ancho de "CEDI" como fracción del lado]
const SALIDAS = [['icon-192.png', 192, 0.5], ['icon-512.png', 512, 0.5], ['icon-maskable-512.png', 512, 0.4]];

// Corre en la página: recibe el logo base en base64 y devuelve el ícono nuevo en base64.
async function armar(b64, lado, fraccion) {
  await document.fonts.load('700 40px Montserrat');
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const W = img.width, H = img.height;
  const src = document.createElement('canvas'); src.width = W; src.height = H;
  const sx = src.getContext('2d');
  sx.drawImage(img, 0, 0);
  const px = sx.getImageData(0, 0, W, H).data;
  const claro = (x, y) => { const i = (y * W + x) * 4; return px[i] + px[i + 1] + px[i + 2] > 450; };
  const fondo = `rgb(${px[0]},${px[1]},${px[2]})`;
  // tramos de columnas con trazo claro: el rombo (a la izquierda) y el texto, separados por un hueco
  const cols = [];
  for (let x = 0; x < W; x++) { let n = 0; for (let y = 0; y < H; y++) if (claro(x, y)) n++; cols.push(n); }
  const tramos = [];
  for (let x = 0; x < W; x++) {
    if (!cols[x]) continue;
    const ult = tramos[tramos.length - 1];
    if (ult && x - ult[1] <= Math.round(W * 0.02)) ult[1] = x; else tramos.push([x, x]);
  }
  const iTexto = tramos.findIndex((t, i) => i > 0 && t[0] - tramos[i - 1][1] > W * 0.03);
  const r0 = tramos[0][0], r1 = tramos[iTexto - 1][1], x0 = tramos[iTexto][0], x1 = tramos[tramos.length - 1][1];
  const filasCon = (a, b) => { const f = []; for (let y = 0; y < H; y++) { let s = false; for (let x = a; x <= b && !s; x++) if (claro(x, y)) s = true; f.push(s); } return f; };
  const bandasDe = (f) => { const out = []; for (let y = 0; y < H; y++) { if (!f[y]) continue; const u = out[out.length - 1]; if (u && y - u[1] <= 1) u[1] = y; else out.push([y, y]); } return out; };
  const fr = filasCon(r0, r1); const rb = bandasDe(fr);
  const rombo = [rb[0][0], rb[rb.length - 1][1]];
  const cedi = bandasDe(filasCon(x0, x1))[0];

  const cv = document.createElement('canvas'); cv.width = lado; cv.height = lado;
  const cx = cv.getContext('2d');
  cx.fillStyle = fondo; cx.fillRect(0, 0, lado, lado);
  cx.imageSmoothingQuality = 'high';
  // "CEDI" y "CLUB" con la misma letra (Montserrat 700), el mismo tamaño y la misma separación, centradas:
  // la palabra más ancha ocupa `fraccion` del lado
  const SEP = 0.12; // separación entre letras, en em
  const ancho = (t, tam) => { cx.font = `700 ${tam}px Montserrat`; let w = 0; for (const l of t) { const m = cx.measureText(l); w += m.actualBoundingBoxLeft + m.actualBoundingBoxRight; } return w + SEP * tam * (t.length - 1); };
  const tam = (lado * fraccion) / Math.max(ancho('CEDI', 100), ancho('CLUB', 100)) * 100;
  cx.font = `700 ${tam}px Montserrat`;
  const alto = cx.measureText('E').actualBoundingBoxAscent;
  const altoRombo = alto * 1.7;
  const sr = altoRombo / (rombo[1] - rombo[0] + 1);
  const anchoRombo = (r1 - r0 + 1) * sr;
  const g1 = alto * 0.55, g2 = alto * 0.42;
  const total = altoRombo + g1 + alto + g2 + alto;
  let y = (lado - total) / 2;
  cx.drawImage(src, r0, rombo[0], r1 - r0 + 1, rombo[1] - rombo[0] + 1, (lado - anchoRombo) / 2, y, anchoRombo, altoRombo);
  y += altoRombo + g1 + alto;
  cx.fillStyle = '#ffffff';
  const escribir = (t, base) => {
    let x = (lado - ancho(t, tam)) / 2;
    cx.font = `700 ${tam}px Montserrat`;
    for (const l of t) { const m = cx.measureText(l); cx.fillText(l, x + m.actualBoundingBoxLeft, base); x += m.actualBoundingBoxLeft + m.actualBoundingBoxRight + SEP * tam; }
  };
  escribir('CEDI', y);
  escribir('CLUB', y + g2 + alto);
  return cv.toDataURL('image/png').split(',')[1];
}

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const p = await b.newPage();
  await p.setContent('<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700&display=block" rel="stylesheet"><p style="font:700 20px Montserrat">CLUB</p>', { waitUntil: 'networkidle0' });
  const b64 = fs.readFileSync(BASE).toString('base64');
  for (const [a, lado, fraccion] of SALIDAS) {
    const nuevo = await p.evaluate(armar, b64, lado, fraccion);
    fs.writeFileSync(path.join(RAIZ, a), Buffer.from(nuevo, 'base64'));
    console.log('listo', a);
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
