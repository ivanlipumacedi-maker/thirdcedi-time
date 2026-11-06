// Prueba de la pantalla de acceso: se ve el login, un mail fuera del grupo muestra el aviso y no se envía nada.
// Uso: servir la raíz con `npx --yes http-server -p 8080 -c-1` y correr `node dev/tools/prueba-login.js` (URL_APP cambia la dirección)
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
    const pedidos = [];
    p.on('pageerror', (e) => errores.push(e.message));
    p.on('request', (r) => { if (r.url().includes('/auth/v1/')) pedidos.push(r.url()); });
    await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await p.goto(URL_APP, { waitUntil: 'networkidle0' });

    assert.equal(await p.evaluate(() => document.body.classList.contains('sin-sesion')), true);
    assert.equal(await p.evaluate(() => !document.getElementById('paso-mail').hidden), true);
    assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.pestanas')).display), 'none');
    await p.screenshot({ path: path.join(shots, 'login-claro.png') });

    await p.type('#in-mail', 'prueba@gmail.com');
    await p.click('#btn-mail');
    await p.waitForFunction(() => !document.getElementById('err-mail').hidden);
    assert.equal(await p.evaluate(() => document.getElementById('err-mail').textContent), 'Usá tu mail del Grupo CEDI');
    assert.equal(await p.evaluate(() => !document.getElementById('paso-mail').hidden), true);
    assert.deepEqual(pedidos.filter((u) => u.includes('/otp')), [], 'no debe pedirse ningún código');
    await p.screenshot({ path: path.join(shots, 'login-error.png') });

    await p.click('#btn-tema');
    await p.screenshot({ path: path.join(shots, 'login-oscuro.png') });
    assert.deepEqual(errores, []);
    console.log('ok');
  } finally {
    await b.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
