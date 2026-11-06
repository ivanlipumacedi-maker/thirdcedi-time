// Prueba del esqueleto: abre la app en 390x844, recorre las 3 pestañas y saca capturas clara y oscura.
// Uso: servir la raíz con `npx --yes http-server -p 8080 -c-1` y correr `node dev/tools/prueba-esqueleto.js` (URL_APP cambia la dirección)
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const URL_APP = process.env.URL_APP || 'http://127.0.0.1:8080';
const shots = path.join(__dirname, '..', 'shots');
fs.mkdirSync(shots, { recursive: true });

(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const p = await b.newPage();
    const errores = [];
    p.on('pageerror', (e) => errores.push(e.message));
    await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await p.goto(URL_APP, { waitUntil: 'networkidle0' });

    assert.equal(await p.evaluate(() => document.documentElement.dataset.tema), 'claro');
    assert.equal(await p.evaluate(() => typeof App.ir + typeof App.toast + typeof App.yo), 'functionfunctionfunction');
    assert.equal(await p.evaluate(() => App.yo()), null);
    await p.evaluate(() => App.modoAcceso(false)); // sin sesión se ve el login; acá probamos el esqueleto de la app

    for (const ruta of ['actividades', 'juegos', 'perfil']) {
      await p.click(`.pestanas a[data-ruta="${ruta}"]`);
      await p.waitForFunction((r) => document.querySelector('.pestanas a.activa').dataset.ruta === r, {}, ruta);
      const vista = await p.evaluate(() => [...document.querySelectorAll('.pantalla:not([hidden])')].map((s) => s.dataset.ruta));
      assert.deepEqual(vista, [ruta]);
      assert.equal(await p.evaluate(() => location.hash), '#/' + ruta);
      assert.equal(await p.evaluate(() => document.querySelector('.pestanas a.activa').dataset.ruta), ruta);
    }
    await p.evaluate(() => App.ir('actividades'));
    await p.waitForFunction(() => document.querySelector('.pantalla:not([hidden])').dataset.ruta === 'actividades');
    assert.equal(await p.evaluate(() => document.querySelector('.pantalla:not([hidden])').dataset.ruta), 'actividades');
    await p.evaluate(() => App.ir('no-existe'));
    assert.equal(await p.evaluate(() => location.hash), '#/actividades');
    await p.evaluate(() => App.toast('Hola desde la prueba'));
    await p.screenshot({ path: path.join(shots, 'esqueleto-claro.png') });

    await p.click('#btn-tema');
    assert.equal(await p.evaluate(() => document.documentElement.dataset.tema), 'oscuro');
    await p.screenshot({ path: path.join(shots, 'esqueleto-oscuro.png') });

    // sin elección guardada, respeta el tema del sistema
    await p.evaluate(() => localStorage.clear());
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await p.reload({ waitUntil: 'networkidle0' });
    assert.equal(await p.evaluate(() => document.documentElement.dataset.tema), 'oscuro');

    assert.deepEqual(errores, []);
    for (const f of ['esqueleto-claro.png', 'esqueleto-oscuro.png']) assert.ok(fs.existsSync(path.join(shots, f)), f);
    console.log('ok');
  } finally {
    await b.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
