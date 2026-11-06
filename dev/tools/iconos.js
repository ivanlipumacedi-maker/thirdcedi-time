// Genera icon-192.png, icon-512.png, icon-maskable-512.png y badge-96.png desde img/logo-cedi-light.png
// Uso: node dev/tools/iconos.js (CHROME_PATH cambia la ruta de Chrome)
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const raiz = path.join(__dirname, '..', '..');
const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(raiz, 'img', 'logo-cedi-light.png')).toString('base64');
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const p = await b.newPage();
  // ancho: fracción del lado que ocupa el logo (el maskable queda dentro de la zona segura)
  const shot = async (size, ancho, bg, file) => {
    await p.setViewport({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:${bg}"><div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center"><img src="${logo}" style="width:${Math.round(size * ancho)}px;height:auto"></div></body></html>`);
    await p.screenshot({ path: path.join(raiz, file), omitBackground: bg === 'transparent' });
  };
  await shot(192, 0.78, '#002F68', 'icon-192.png');
  await shot(512, 0.78, '#002F68', 'icon-512.png');
  await shot(512, 0.58, '#002F68', 'icon-maskable-512.png');
  await shot(96, 0.9, 'transparent', 'badge-96.png');
  await b.close();
  console.log('ok');
})();
