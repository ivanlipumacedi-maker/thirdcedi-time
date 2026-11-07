// Prueba en vivo de El Impostor con TRES navegadores (zz-prueba-a, b y c) contra el proyecto real:
// A arma la partida, B y C se unen y A arranca. Cada uno ve su palabra (2 iguales y 1 distinta) y, hasta la
// revelación, a ningún navegador le llega la palabra de otro ni quién es el impostor: se miran todas las respuestas
// REST (incluida la de mi_palabra) y los frames del websocket de Realtime. Después: pistas en el chat de la
// partida, A pasa a la votación, cada uno vota (sin poder votarse) y los tres ven la revelación.
// Al terminar (finally) A, B y C salen de toda partida en la que sigan. Las filas de prueba se borran después con
// dev/supabase/limpiar-pruebas-juegos.sql (MCP supabase-thirdcedi o SQL Editor): la RLS no deja borrarlas.
// Las contraseñas salen de .env (ZZ_PRUEBA_A/B/C_PASSWORD), nunca de la línea de comandos.
// Uso: servir la raíz con `npx --yes http-server -p 8080 -c-1` y correr `node dev/tools/prueba-impostor.js`
// (URL_APP=http://127.0.0.1:8083 si se sirve en otro puerto).
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
if (!env.ZZ_PRUEBA_A_PASSWORD || !env.ZZ_PRUEBA_B_PASSWORD || !env.ZZ_PRUEBA_C_PASSWORD) {
  console.log('Faltan ZZ_PRUEBA_A/B/C_PASSWORD en .env (ver dev/supabase/usuarios-prueba.sql).');
  process.exit(2);
}

const navegadores = [];
async function abrir(letra) {
  // un navegador por jugador: una pestaña en segundo plano frena los timers
  const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  navegadores.push(b);
  const p = await b.newPage();
  p.letra = letra;
  p.errores = [];
  p.recibido = []; // cuerpos REST y frames de websocket que llegaron a esta ventana
  p.pidioContenido = false;
  p.on('pageerror', (e) => p.errores.push(e.message));
  p.on('request', (r) => { if (/\/contenido\//.test(r.url())) p.pidioContenido = true; });
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
  p.yo = await p.evaluate(() => App.yo().id);
  return p;
}
const texto = (p, sel) => p.$eval(sel, (e) => e.textContent);
const clic = (p, sel) => p.$eval(sel, (e) => e.click());
const esperar = (p, fn, ...a) => p.waitForFunction(fn, { timeout: 20000 }, ...a);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let fallas = 0;
  const paso = async (nombre, fn) => { try { await fn(); console.log('ok', nombre); } catch (e) { fallas++; console.log('FALLA', nombre, '-', e.message); } };
  let A, B, C;
  try {
    A = await abrir('A'); B = await abrir('B'); C = await abrir('C');
    const TODOS = [A, B, C];
    let par;

    await paso('A arma un Impostor; B y C lo ven en vivo y se unen; A arranca recién con 3', async () => {
      await clic(A, '#btn-nueva-partida');
      await A.waitForSelector('#nueva-impostor');
      assert.doesNotMatch(await texto(A, '#nueva-impostor'), /Próximamente/);
      await clic(A, '#nueva-impostor');
      await A.waitForSelector('#btn-arrancar', { timeout: 15000 });
      // la partida de A por id (no la primera tarjeta: puede haber partidas reales abiertas)
      par = await A.evaluate(async () => {
        const yo = (await App.sb.auth.getUser()).data.user.id;
        const { data } = await App.sb.from('partidas').select('id').eq('creador', yo).eq('estado', 'espera').order('creado', { ascending: false }).limit(1);
        return data && data[0] ? data[0].id : null;
      });
      assert.ok(par);
      for (const p of [B, C]) {
        await esperar(p, (x) => !!document.querySelector('#lista-abiertas .tarjeta-partida[data-id="' + x + '"]'), par);
        await p.$eval('.tarjeta-partida[data-id="' + par + '"]', (e) => e.click());
        await p.waitForSelector('#btn-unirme', { timeout: 15000 });
        if (p === B) assert.equal(await A.$eval('#btn-arrancar', (b) => b.disabled), true, 'con 1 jugador no debería poder arrancar');
        await clic(p, '#btn-unirme');
        await p.waitForSelector('#esperando-creador', { timeout: 15000 });
      }
      await esperar(A, () => /ZZ Prueba C/.test(document.getElementById('sala-jugadores').textContent) && !document.getElementById('btn-arrancar').disabled);
    });

    const palabras = {};
    await paso('al arrancar cada uno ve su palabra (2 iguales y 1 distinta)', async () => {
      TODOS.forEach((p) => { p.recibido.length = 0; });
      await clic(A, '#btn-arrancar');
      for (const p of TODOS) {
        await esperar(p, () => { const x = document.getElementById('impostor-palabra'); return x && !/Cargando/.test(x.textContent); });
        palabras[p.letra] = (await texto(p, '#impostor-palabra')).trim();
      }
      assert.equal(new Set(Object.values(palabras)).size, 2, JSON.stringify(Object.keys(palabras)));
    });

    const revisar = () => {
      const distintas = [...new Set(Object.values(palabras))];
      for (const p of TODOS) {
        const ajena = distintas.find((w) => w !== palabras[p.letra]);
        const todo = p.recibido.join('\n');
        assert.ok(todo.includes(JSON.stringify(palabras[p.letra])), p.letra + ': no se capturó ni su propia palabra (la prueba no estaría mirando nada)');
        assert.ok(/"estado_juego"/.test(todo), p.letra + ': no se capturó ningún estado_juego');
        assert.ok(!todo.includes(JSON.stringify(ajena)), p.letra + ' recibió la palabra ajena');
        assert.ok(!/"(impostor|palabra_impostor|votos)"\s*:/.test(todo), p.letra + ' recibió quién es el impostor o los votos');
        assert.ok(!p.pidioContenido, p.letra + ' cargó contenido/');
      }
    };
    await paso('a ningún navegador le llega la palabra ajena ni quién es el impostor (REST y websocket)', async () => { await dormir(800); revisar(); });

    await paso('pistas en el chat de la partida; A pasa a la votación', async () => {
      await esperar(A, () => !!document.getElementById('btn-imp-avanzar'));
      await clic(A, '#btn-imp-avanzar'); // palabra → pistas
      for (const p of TODOS) await esperar(p, () => /Pistas/.test((document.getElementById('impostor-fase') || {}).textContent || ''));
      for (const p of TODOS) {
        await p.type('#chat-par textarea', 'zz pista de ' + p.letra);
        await p.$eval('#chat-par form', (f) => f.requestSubmit());
      }
      await esperar(A, () => /zz pista de B/.test(document.getElementById('chat-par').textContent) && /zz pista de C/.test(document.getElementById('chat-par').textContent));
      await esperar(A, () => { const b = document.getElementById('btn-imp-avanzar'); return b && !b.disabled; });
      await clic(A, '#btn-imp-avanzar'); // pistas → votación
      for (const p of TODOS) {
        await esperar(p, () => document.querySelectorAll('.voto-imp').length === 2);
        const ids = await p.$$eval('.voto-imp', (xs) => xs.map((x) => x.dataset.persona));
        assert.ok(!ids.includes(p.yo), p.letra + ' se puede votar a sí mismo');
      }
    });

    await paso('B vota; los demás no ven a quién; tampoco llegó nada secreto', async () => {
      await clic(B, '.voto-imp[data-persona="' + C.yo + '"]');
      await esperar(B, () => /Votaste a/.test(document.getElementById('impostor-estado').textContent));
      await esperar(A, () => /1 de 3 ya votaron/.test(document.getElementById('impostor-estado').textContent));
      await dormir(500);
      revisar();
    });

    await paso('votan A y C, y los tres ven la revelación con las dos palabras', async () => {
      await clic(A, '.voto-imp[data-persona="' + C.yo + '"]');
      await clic(C, '.voto-imp[data-persona="' + A.yo + '"]');
      for (const p of TODOS) await p.waitForSelector('#impostor-resultado', { timeout: 20000 });
      const distintas = [...new Set(Object.values(palabras))];
      for (const p of TODOS) {
        const t = await texto(p, '#impostor-palabras');
        distintas.forEach((w) => assert.ok(t.includes(w), p.letra + ' no ve ' + w));
      }
      const imp = TODOS.find((p) => Object.values(palabras).filter((w) => w === palabras[p.letra]).length === 1);
      assert.match(await texto(imp, '#impostor-era'), /Eras vos/);
      // C tiene 2 votos: si C es el impostor gana el grupo; si no, gana el impostor
      assert.match(await texto(A, '#impostor-resultado'), imp === C ? /Ganó el grupo/ : /Ganó el impostor/);
    });

    for (const p of TODOS) if (p && p.errores.length) { fallas++; console.log('FALLA errores de página (' + p.letra + '):', p.errores); }
  } finally {
    for (const p of [A, B, C]) {
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
