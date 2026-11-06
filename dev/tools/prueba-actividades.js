// Prueba en navegador de Actividades con DOS sesiones (zz-prueba-a y zz-prueba-b en contextos separados):
// A crea un pádel con tercer tiempo (asado); B ve la actividad aparecer en vivo, se anota solo al tercer tiempo
// y A ve la lista de anotados actualizarse sin recargar. Capturas en dev/shots/.
// Las contraseñas salen de .env (ZZ_PRUEBA_A_PASSWORD / ZZ_PRUEBA_B_PASSWORD), nunca de la línea de comandos.
// Uso: servir la raíz con `npx --yes http-server -p 8080 -c-1` y correr `node dev/tools/prueba-actividades.js`
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const URL_APP = process.env.URL_APP || 'http://127.0.0.1:8080';
const shots = path.join(__dirname, '..', 'shots');
fs.mkdirSync(shots, { recursive: true });

function leerEnv() {
  const f = path.join(__dirname, '..', '..', '.env');
  const o = {};
  if (!fs.existsSync(f)) return o;
  fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((l) => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
  return o;
}
const env = leerEnv();
if (!env.ZZ_PRUEBA_A_PASSWORD || !env.ZZ_PRUEBA_B_PASSWORD) {
  console.log('Faltan ZZ_PRUEBA_A_PASSWORD / ZZ_PRUEBA_B_PASSWORD en .env (ver dev/supabase/usuarios-prueba.sql).');
  process.exit(2);
}

async function abrir(browser, letra) {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  p.errores = [];
  p.on('pageerror', (e) => p.errores.push(e.message));
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await p.goto(URL_APP, { waitUntil: 'networkidle0' });
  const email = `zz-prueba-${letra.toLowerCase()}@cedi.com.ar`;
  const clave = env[`ZZ_PRUEBA_${letra}_PASSWORD`];
  const r = await p.evaluate(async (e, c) => { const { error } = await App.sb.auth.signInWithPassword({ email: e, password: c }); return error ? error.message : null; }, email, clave);
  assert.equal(r, null, 'login ' + letra + ': ' + r);
  await p.reload({ waitUntil: 'networkidle0' }); // login.js toma la sesión guardada y entra
  await p.waitForSelector('#btn-nueva-act');
  return p;
}
const sinToast = (p) => p.waitForFunction(() => document.getElementById('toast').hidden, { timeout: 8000 }); // el aviso tapa botones de abajo
const texto = (p, sel) => p.$eval(sel, (e) => e.textContent);

(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const A = await abrir(b, 'A');
    const B = await abrir(b, 'B');
    const titulo = 'zz Pádel ' + Date.now();

    // A crea el pádel con tercer tiempo
    await A.click('#btn-nueva-act');
    await A.waitForSelector('#f-titulo');
    await A.select('#f-tipo', 'padel');
    await A.type('#f-titulo', titulo);
    const manana = new Date(Date.now() + 36 * 3600e3 - 3 * 3600e3).toISOString().slice(0, 16); // mañana, en hora argentina
    await A.$eval('#f-fecha', (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, manana);
    await A.type('#f-lugar', 'Club de prueba');
    await A.type('#f-cupo', '4');
    await A.click('#f-tercer');
    await A.type('#f-ter-lugar', 'Parrilla de prueba');
    const manana2 = new Date(Date.now() + 38 * 3600e3 - 3 * 3600e3).toISOString().slice(0, 16);
    await A.$eval('#f-ter-fecha', (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, manana2);
    await A.screenshot({ path: path.join(shots, 'actividades-form-claro.png') });
    await A.click('#btn-guardar-act');
    await A.waitForSelector('#btn-voy');
    assert.match(await A.evaluate(() => [...document.querySelectorAll('h1')].find((e) => e.offsetParent !== null)?.textContent || ''), /zz Pádel/); // el primer h1 visible (los de login están ocultos)
    await A.screenshot({ path: path.join(shots, 'actividades-detalle-claro.png') });

    // B ve aparecer la actividad en vivo, sin recargar
    await B.waitForFunction((t) => [...document.querySelectorAll('.tarjeta-titulo')].some((e) => e.textContent === t), { timeout: 15000 }, titulo);
    await B.screenshot({ path: path.join(shots, 'actividades-lista-b-claro.png') });
    const tarj = await B.evaluate((t) => { const e = [...document.querySelectorAll('.tarjeta-act')].find((x) => x.querySelector('.tarjeta-titulo').textContent === t); return e.textContent; }, titulo);
    assert.match(tarj, /Con tercer tiempo/);

    // B entra y se anota SOLO al tercer tiempo
    await B.evaluate((t) => { [...document.querySelectorAll('.tarjeta-act')].find((x) => x.querySelector('.tarjeta-titulo').textContent === t).click(); }, titulo);
    await B.waitForSelector('#btn-voy-tercer');
    await sinToast(B);
    await B.click('#btn-voy-tercer');
    await B.waitForFunction(() => document.getElementById('btn-voy-tercer').textContent === 'Ya no voy al tercer tiempo', { timeout: 10000 });
    assert.equal(await texto(B, '#btn-voy'), 'Voy', 'B no debe figurar en la actividad');

    // A, que está viendo el detalle, ve a B en el tercer tiempo sin recargar
    await A.waitForFunction(() => /Tercer tiempo \(1\)/.test(document.body.innerText), { timeout: 15000 });
    // Cada parte es un h2 seguido de su lista (o de "Todavía no se anotó nadie."): se lee el texto entre los h2.
    const anotadosA = await A.evaluate(() => {
      const [hAct, hTer] = [...document.querySelectorAll('#pantalla-actividades h2.sub')].filter((e) => /^La actividad|Tercer tiempo/.test(e.textContent));
      const hasta = (desde, fin) => { let t = ''; for (let n = desde.nextElementSibling; n && n !== fin && n.tagName !== 'H2'; n = n.nextElementSibling) t += n.innerText + '\n'; return t; };
      return [hasta(hAct, hTer), hasta(hTer, null)];
    });
    assert.ok(/ZZ Prueba B/.test(anotadosA[1]), 'A debe ver a B en el tercer tiempo: ' + JSON.stringify(anotadosA));
    assert.ok(!/ZZ Prueba B/.test(anotadosA[0]), 'B no debe estar en la actividad: ' + JSON.stringify(anotadosA));
    // A no está anotado a nada (no hay chat): el lugar del chat no queda como el texto "null"
    assert.doesNotMatch(await texto(A, '#pantalla-actividades'), /null|undefined/, 'el detalle de A muestra "null"');
    await A.screenshot({ path: path.join(shots, 'actividades-anotados-a-claro.png') });
    await B.screenshot({ path: path.join(shots, 'actividades-detalle-b-claro.png') });

    // A confirma y B lo ve en vivo
    await sinToast(A);
    await A.click('#btn-confirmar');
    await B.waitForFunction(() => /Confirmada/.test(document.body.innerText), { timeout: 15000 });

    // Oscuro
    await A.click('#btn-tema');
    await A.screenshot({ path: path.join(shots, 'actividades-detalle-oscuro.png') });
    await A.evaluate(() => { document.querySelector('#pantalla-actividades .btn-link').click(); });
    await A.screenshot({ path: path.join(shots, 'actividades-lista-oscuro.png') });

    // Limpieza: A cancela la actividad de la prueba
    await A.evaluate((t) => { [...document.querySelectorAll('.tarjeta-act')].find((x) => x.querySelector('.tarjeta-titulo').textContent === t).click(); }, titulo);
    await A.waitForSelector('#btn-cancelar');
    await sinToast(A);
    await A.click('#btn-cancelar');
    await A.click('#btn-cancelar');
    await B.waitForFunction(() => /Cancelada/.test(document.body.innerText), { timeout: 15000 });

    assert.deepEqual(A.errores.concat(B.errores), []);
    console.log('ok');
  } finally {
    await b.close();
    console.log('Para borrar las actividades de prueba (las RLS no dejan): correr dev/supabase/limpiar-pruebas.sql con el MCP supabase-thirdcedi o en el SQL Editor.');
  }
})().catch((e) => { console.error(e); process.exit(1); });
