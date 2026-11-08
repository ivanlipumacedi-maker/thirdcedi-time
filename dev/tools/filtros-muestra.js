// Muestrario de los filtros del editor sobre fotos reales, para ajustarlos a ojo: una fila por foto y una columna por filtro
// (al 100 %), con editor-logica.js tal cual lo usa la app. Las fotos no van en el repo: pasá una carpeta con .jpg.
// Uso: node dev/tools/filtros-muestra.js <carpeta-con-fotos> [salida.png] [filtro1,filtro2,...]
// Ej.: node dev/tools/filtros-muestra.js C:\fotos dev/shots/camara-filtros-comparacion.png original,pelicula,atardecer,bn
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const [carpeta, salida = path.join(__dirname, '..', 'shots', 'camara-filtros-muestra.png'), lista] = process.argv.slice(2);
if (!carpeta) { console.log('Uso: node dev/tools/filtros-muestra.js <carpeta-con-fotos> [salida.png] [filtros]'); process.exit(1); }
const fotos = fs.readdirSync(carpeta).filter((f) => /\.jpe?g$/i.test(f)).sort()
  .map((f) => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(carpeta, f)).toString('base64'));
const logica = fs.readFileSync(path.join(__dirname, '..', '..', 'editor-logica.js'), 'utf8');

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const p = await br.newPage();
  await p.setViewport({ width: 1200, height: 800 });
  await p.setContent('<body style="margin:0;background:#111;color:#eee;font:600 15px system-ui"></body>');
  await p.addScriptTag({ content: logica });
  const ancho = await p.evaluate(async (fotos, lista) => {
    const E = window.EditorLogica, ids = lista ? lista.split(',') : E.FILTROS.map((f) => f.id), L = 420;
    const tabla = document.createElement('div');
    tabla.style.cssText = `display:grid;grid-template-columns:repeat(${ids.length},${L}px);gap:10px;padding:16px`;
    ids.forEach((id) => { const t = document.createElement('div'); t.textContent = E.filtro(id).nombre; tabla.appendChild(t); });
    for (const src of fotos) {
      const img = new Image(); img.src = src; await img.decode();
      const k = L / img.width, w = L, h = Math.round(img.height * k);
      for (const id of ids) {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0, w, h);
        const d = x.getImageData(0, 0, w, h); E.aplicar(d.data, w, h, id, 1, { escala: k, lado: Math.min(img.width, img.height) }); x.putImageData(d, 0, 0);
        tabla.appendChild(c);
      }
    }
    document.body.appendChild(tabla);
    return tabla.scrollWidth;
  }, fotos, lista);
  await p.setViewport({ width: ancho, height: 800 });
  await p.screenshot({ path: salida, fullPage: true });
  await br.close();
  console.log('ok', salida);
})();
