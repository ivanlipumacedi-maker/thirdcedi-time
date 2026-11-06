// Prueba en vivo de Juegos y Trivia con DOS navegadores (zz-prueba-a y zz-prueba-b) contra el proyecto real:
// A arma una Trivia; B la ve aparecer en vivo y se une; A lo ve en la sala; el chat de la partida llega en vivo;
// A arranca, los dos responden y se revela sola; mientras la pregunta está abierta, a B no le llega la correcta
// por ningún lado (se miran las respuestas REST y los frames del websocket de Realtime); A avanza hasta el final
// y los dos ven el ranking final.
// Al terminar (finally) A y B salen de toda partida en la que sigan. Las filas de prueba se borran después con
// dev/supabase/limpiar-pruebas-juegos.sql (MCP supabase-thirdcedi o SQL Editor): la RLS no deja borrarlas.
// Las contraseñas salen de .env (ZZ_PRUEBA_A_PASSWORD / ZZ_PRUEBA_B_PASSWORD), nunca de la línea de comandos.
// Uso: servir la raíz con `npx --yes http-server -p 8080 -c-1` y correr `node dev/tools/prueba-juegos.js`
// (URL_APP=http://127.0.0.1:8081 si se sirve en otro puerto).
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const URL_APP = process.env.URL_APP || 'http://127.0.0.1:8080';

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

const navegadores = [];
async function abrir(letra) {
  // un navegador por jugador: una pestaña en segundo plano frena los timers y los dos tienen que estar activos
  const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  navegadores.push(b);
  const p = await b.newPage();
  p.errores = [];
  p.recibido = []; // cuerpos REST y frames de websocket que llegaron a esta ventana
  p.on('pageerror', (e) => p.errores.push(e.message));
  p.on('response', async (r) => { if (/\/rest\/v1\//.test(r.url())) { try { p.recibido.push(await r.text()); } catch (e) { /* sin cuerpo */ } } });
  const cdp = await p.createCDPSession();
  await cdp.send('Network.enable');
  cdp.on('Network.webSocketFrameReceived', (ev) => p.recibido.push(ev.response.payloadData));
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.goto(URL_APP, { waitUntil: 'networkidle0' });
  const r = await p.evaluate(async (e, c) => { const { error } = await App.sb.auth.signInWithPassword({ email: e, password: c }); return error ? error.message : null; },
    `zz-prueba-${letra.toLowerCase()}@cedi.com.ar`, env[`ZZ_PRUEBA_${letra}_PASSWORD`]);
  assert.equal(r, null, 'login ' + letra + ': ' + r);
  await p.goto(URL_APP + '/#/juegos', { waitUntil: 'networkidle0' });
  await p.reload({ waitUntil: 'networkidle0' });
  await p.waitForSelector('#btn-nueva-partida', { timeout: 15000 });
  return p;
}
const texto = (p, sel) => p.$eval(sel, (e) => e.textContent);
const clic = (p, sel) => p.$eval(sel, (e) => e.click());
const esperar = (p, fn, ...a) => p.waitForFunction(fn, { timeout: 15000 }, ...a);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let fallas = 0;
  const paso = async (nombre, fn) => { try { await fn(); console.log('ok', nombre); } catch (e) { fallas++; console.log('FALLA', nombre, '-', e.message); } };
  let A, B;
  try {
    A = await abrir('A');
    B = await abrir('B');
    let par;

    await paso('A arma una Trivia y B la ve aparecer en vivo', async () => {
      await clic(A, '#btn-nueva-partida');
      await A.waitForSelector('#nueva-trivia');
      await clic(A, '#nueva-trivia');
      await A.waitForSelector('#btn-arrancar', { timeout: 15000 });
      await esperar(B, () => !!document.querySelector('#lista-abiertas .tarjeta-partida'));
      par = await B.$eval('#lista-abiertas .tarjeta-partida', (e) => e.dataset.id);
      assert.ok(par);
    });

    await paso('B se une y A lo ve en la sala en vivo', async () => {
      await B.$eval('.tarjeta-partida[data-id="' + par + '"]', (e) => e.click());
      await B.waitForSelector('#btn-unirme', { timeout: 15000 });
      await clic(B, '#btn-unirme');
      await B.waitForSelector('#esperando-creador', { timeout: 15000 });
      await esperar(A, () => /ZZ Prueba B/.test(document.getElementById('sala-jugadores').textContent));
    });

    await paso('el chat de la partida llega en vivo', async () => {
      await B.waitForSelector('#chat-par textarea');
      await B.type('#chat-par textarea', 'zz hola partida');
      await B.$eval('#chat-par form', (f) => f.requestSubmit());
      await esperar(A, () => /zz hola partida/.test(document.getElementById('chat-par').textContent));
    });

    await paso('A arranca; los dos ven la misma pregunta y a B no le llegó la correcta', async () => {
      B.recibido.length = 0;
      await clic(A, '#btn-arrancar');
      await A.waitForSelector('#trivia-pregunta', { timeout: 15000 });
      await B.waitForSelector('#trivia-pregunta', { timeout: 15000 });
      assert.equal(await texto(A, '#trivia-pregunta'), await texto(B, '#trivia-pregunta'));
      await dormir(500);
      const conOk = B.recibido.filter((t) => /"estado_juego"/.test(t) && /"ok"\s*:/.test(t));
      assert.equal(conOk.length, 0, 'llegó la correcta antes de revelar: ' + (conOk[0] || '').slice(0, 200));
      assert.ok(B.recibido.some((t) => /"estado_juego"/.test(t)), 'no se capturó ningún estado_juego (la prueba no estaría mirando nada)');
    });

    await paso('B responde, A responde y se revela sola en las dos ventanas', async () => {
      await clic(B, '.op-trivia[data-op="0"]');
      await esperar(B, () => /Respondiste/.test(document.getElementById('trivia-estado').textContent));
      await esperar(A, () => /1 de 2 ya respondieron/.test(document.getElementById('trivia-estado').textContent));
      const conOk = B.recibido.filter((t) => /"estado_juego"/.test(t) && /"ok"\s*:/.test(t));
      assert.equal(conOk.length, 0, 'llegó la correcta antes de revelar');
      await clic(A, '.op-trivia[data-op="1"]');
      await A.waitForSelector('.op-trivia.correcta', { timeout: 15000 });
      await B.waitForSelector('.op-trivia.correcta', { timeout: 15000 });
      assert.equal(await A.$eval('.op-trivia.correcta', (e) => e.dataset.op), await B.$eval('.op-trivia.correcta', (e) => e.dataset.op));
      assert.match(await texto(B, '#ranking-parcial'), /ZZ Prueba A/);
    });

    await paso('A avanza hasta el final y los dos ven el ranking final', async () => {
      for (let i = 0; i < 80; i++) {
        if (await A.$('#ranking-final')) break;
        // buscar y tocar en el mismo paso: entre uno y otro la pantalla se repinta con cada cambio en vivo
        await A.evaluate(() => { const b = document.querySelector('#btn-siguiente:not([disabled]), #btn-revelar:not([disabled])'); if (b) b.click(); });
        await dormir(400);
      }
      await A.waitForSelector('#ranking-final', { timeout: 15000 });
      await B.waitForSelector('#ranking-final', { timeout: 15000 });
      const filas = await B.$$eval('#ranking-final .fila-ranking', (xs) => xs.length);
      assert.equal(filas, 2);
    });

    for (const p of [A, B]) if (p && p.errores.length) { fallas++; console.log('FALLA errores de página:', p.errores); }
  } finally {
    // que no quede ninguna partida de prueba abierta en la lista de nadie
    for (const p of [A, B]) {
      if (!p) continue;
      await p.evaluate(async () => {
        const yo = (await App.sb.auth.getUser()).data.user.id;
        const { data } = await App.sb.from('jugadores').select('partida').eq('persona', yo).eq('se_fue', false);
        for (const x of data || []) await App.sb.rpc('salir_partida', { p: x.partida });
      }).catch(() => {});
    }
    for (const b of navegadores) await b.close().catch(() => {});
    console.log('Para borrar las filas de prueba: correr dev/supabase/limpiar-pruebas-juegos.sql (MCP supabase-thirdcedi o SQL Editor).');
  }
  console.log(fallas ? fallas + ' falla(s)' : 'todo ok');
  process.exit(fallas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
