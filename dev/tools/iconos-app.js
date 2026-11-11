// Íconos de la app (instalada) de CEDI CLUB: parte de los íconos originales del logo de CEDI (dev/tools/iconos-app/base-*.png),
// borra el "TECHCONSULTING" de abajo de "CEDI" y escribe "CLUB" en su lugar, del mismo ancho que "CEDI".
// Uso: node dev/tools/iconos-app.js   (escribe icon-192.png, icon-512.png e icon-maskable-512.png en la raíz)
// Necesita Chrome y salida a internet (fuente Montserrat de Google Fonts).
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const RAIZ = path.join(__dirname, '..', '..');
const BASE = path.join(__dirname, 'iconos-app');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SALIDAS = [['base-192.png', 'icon-192.png'], ['base-512.png', 'icon-512.png'], ['base-maskable-512.png', 'icon-maskable-512.png']];

// Corre en la página: recibe el PNG en base64 y devuelve el PNG nuevo en base64.
async function rehacer(b64) {
  await document.fonts.load('700 40px Montserrat');
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const W = img.width, H = img.height;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d');
  cx.drawImage(img, 0, 0);
  const px = cx.getImageData(0, 0, W, H).data;
  const claro = (x, y) => { const i = (y * W + x) * 4; return px[i] + px[i + 1] + px[i + 2] > 450; };
  // columnas con trazo claro; el rombo y el texto están separados por un hueco
  const cols = [];
  for (let x = 0; x < W; x++) { let n = 0; for (let y = 0; y < H; y++) if (claro(x, y)) n++; cols.push(n); }
  const tramos = [];
  for (let x = 0; x < W; x++) {
    if (!cols[x]) continue;
    const ult = tramos[tramos.length - 1];
    if (ult && x - ult[1] <= Math.round(W * 0.02)) ult[1] = x; else tramos.push([x, x]);
  }
  // el texto es el bloque ancho de la derecha (el rombo puede venir en varios tramos)
  const x0 = tramos.find((t, i) => i > 0 && t[0] - tramos[i - 1][1] > W * 0.03)[0];
  const x1 = tramos[tramos.length - 1][1];
  // filas con trazo en la columna del texto: dos bandas, "CEDI" y "TECHCONSULTING"
  const filas = [];
  for (let y = 0; y < H; y++) { let s = false; for (let x = x0; x <= x1 && !s; x++) if (claro(x, y)) s = true; filas.push(s); }
  const bandas = [];
  for (let y = 0; y < H; y++) {
    if (!filas[y]) continue;
    const ult = bandas[bandas.length - 1];
    if (ult && y - ult[1] <= 1) ult[1] = y; else bandas.push([y, y]);
  }
  if (bandas.length < 2) throw new Error('no encontré las dos líneas del logo');
  const cedi = bandas[0], sub = bandas[bandas.length - 1];
  // color del fondo, de una esquina
  const fondo = `rgb(${px[0]},${px[1]},${px[2]})`;
  cx.fillStyle = fondo;
  cx.fillRect(x0 - 2, sub[0] - 3, x1 - x0 + 5, sub[1] - sub[0] + 7);
  // "CLUB" del ancho de "CEDI", con el mismo espacio entre líneas que tenía el original
  const altoCedi = cedi[1] - cedi[0];
  const hueco = sub[0] - cedi[1];
  const ancho = x1 - x0 + 1;
  let tam = altoCedi * 0.9, sep = 0;
  cx.fillStyle = '#ffffff';
  cx.textBaseline = 'alphabetic';
  // se busca el tamaño y la separación entre letras que ocupan el ancho de "CEDI", con letras más chicas que "CEDI"
  for (tam = altoCedi * 1.4; tam > 4; tam -= 0.5) {
    cx.font = `700 ${tam}px Montserrat`;
    const m = cx.measureText('CLUB');
    sep = (ancho - m.width) / 3;
    if (sep >= tam * 0.3) break;
  }
  cx.font = `700 ${tam}px Montserrat`;
  const m = cx.measureText('C');
  const alto = m.actualBoundingBoxAscent;
  const base = cedi[1] + Math.max(hueco, Math.round(altoCedi * 0.28)) + alto;
  let x = x0;
  for (const letra of 'CLUB') {
    const mm = cx.measureText(letra);
    cx.fillText(letra, x - mm.actualBoundingBoxLeft, base);
    x += mm.actualBoundingBoxLeft + mm.actualBoundingBoxRight + sep;
  }
  return cv.toDataURL('image/png').split(',')[1];
}

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const p = await b.newPage();
  await p.setContent('<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700&display=block" rel="stylesheet"><p style="font:700 20px Montserrat">CLUB</p>', { waitUntil: 'networkidle0' });
  for (const [de, a] of SALIDAS) {
    const b64 = fs.readFileSync(path.join(BASE, de)).toString('base64');
    const nuevo = await p.evaluate(rehacer, b64);
    fs.writeFileSync(path.join(RAIZ, a), Buffer.from(nuevo, 'base64'));
    console.log('listo', a);
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
