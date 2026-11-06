// Prueba en navegador del álbum con DOS sesiones reales (zz-prueba-a y b, en navegadores separados) contra el proyecto
// Supabase: A arma una actividad y los dos se anotan; A sube una foto de la galería y B la ve en vivo; A saca una foto
// con la cámara (dispositivo falso de Chrome) y B la ve; A sube sin señal y la foto sube sola al volver; B sube una y A
// la ve; B no puede borrar la de A; A borra la suya y desaparece en las dos ventanas.
// Las contraseñas salen de .env (ZZ_PRUEBA_A/B_PASSWORD), nunca de la línea de comandos.
// Al final borra las fotos y los archivos del bucket que subió; la actividad (título "zz Álbum ...") queda cancelada y
// se borra con dev/supabase/limpiar-pruebas.sql (las RLS no dejan borrar actividades).
// Uso: servir la raíz con `npx --yes http-server -p 8080 -c-1` y correr `node dev/tools/prueba-album.js`
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');
const URL_APP = process.env.URL_APP || 'http://127.0.0.1:8080';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
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
  console.log('Faltan ZZ_PRUEBA_A/B_PASSWORD en .env (ver dev/supabase/usuarios-prueba.sql).');
  process.exit(2);
}

const navegadores = [];
async function abrir(letra) {
  // un navegador por sesión: las dos ventanas tienen que estar activas a la vez
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  navegadores.push(browser);
  await browser.defaultBrowserContext().overridePermissions(URL_APP, ['camera']);
  const p = await browser.newPage();
  p.errores = [];
  p.on('pageerror', (e) => p.errores.push(e.message));
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: letra === 'A' ? 'light' : 'dark' }]);
  await p.goto(URL_APP, { waitUntil: 'networkidle0' });
  await p.evaluate(() => new Promise((ok) => { const r = indexedDB.deleteDatabase('thirdcedi-album'); r.onsuccess = r.onerror = r.onblocked = () => ok(); }));
  const email = `zz-prueba-${letra.toLowerCase()}@cedi.com.ar`;
  const clave = env[`ZZ_PRUEBA_${letra}_PASSWORD`];
  const r = await p.evaluate(async (e, c) => { const { error } = await App.sb.auth.signInWithPassword({ email: e, password: c }); return error ? error.message : null; }, email, clave);
  assert.equal(r, null, 'login ' + letra + ': ' + r);
  await p.reload({ waitUntil: 'networkidle0' });
  await p.waitForSelector('#btn-nueva-act');
  p.id = await p.evaluate(() => App.yo().id);
  return p;
}
const T = 25000;
const esperar = (p, fn, ...a) => p.waitForFunction(fn, { timeout: T }, ...a);
const celdas = (p, n) => esperar(p, (k) => document.querySelectorAll('#album-act .album-cel').length === k, n);
const abrirTarjeta = (p, t) => p.waitForFunction((x) => { const e = [...document.querySelectorAll('.tarjeta-act')].find((y) => y.querySelector('.tarjeta-titulo').textContent === x); if (e) e.click(); return !!e; }, { timeout: T }, t);

// Borra con la sesión de cada uno sus fotos (fila y archivos) de la actividad de prueba.
const limpiarMias = (p, act) => p.evaluate(async (a) => {
  const { data } = await App.sb.from('fotos').select('id,ruta,mini,media,autor').eq('actividad', a);
  const mias = (data || []).filter((f) => f.autor === App.yo().id);
  for (const f of mias) await App.sb.from('fotos').delete().eq('id', f.id);
  const rutas = mias.flatMap((f) => [f.ruta, f.mini, f.media]).filter(Boolean);
  // también lo que quedó subido sin fila (una subida a medias)
  const { data: objs } = await App.sb.storage.from('album').list(a, { limit: 1000 });
  for (const o of objs || []) rutas.push(a + '/' + o.name);
  const unicas = [...new Set(rutas)];
  if (unicas.length) await App.sb.storage.from('album').remove(unicas);
  return unicas.length;
}, act);

(async () => {
  let fallas = 0, actId = null;
  const paso = async (n, fn) => { try { await fn(); console.log('ok', n); } catch (e) { fallas++; console.log('FALLA', n, '-', e.message); } };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'album-vivo-'));
  const fixture = path.join(tmp, 'foto.png');
  let A, B;
  try {
    A = await abrir('A'); B = await abrir('B');
    const png = await A.evaluate(() => { const c = document.createElement('canvas'); c.width = 1600; c.height = 1200; const g = c.getContext('2d'); g.fillStyle = '#002F68'; g.fillRect(0, 0, 1600, 1200); g.fillStyle = '#00B1EF'; g.beginPath(); g.arc(800, 600, 380, 0, 7); g.fill(); return c.toDataURL('image/png'); });
    fs.writeFileSync(fixture, Buffer.from(png.split(',')[1], 'base64'));
    const titulo = 'zz Álbum ' + Date.now();
    actId = await A.evaluate(async (t) => {
      const { data, error } = await App.sb.from('actividades').insert({ tipo: 'asado', titulo: t, fecha: new Date(Date.now() + 864e5).toISOString(), lugar: 'Quinta de prueba' }).select().single();
      if (error) throw new Error(error.message);
      const r = await App.sb.from('asistencias').insert({ actividad: data.id, parte: 'actividad' });
      if (r.error) throw new Error(r.error.message);
      return data.id;
    }, titulo);
    await B.evaluate(async (a) => { const r = await App.sb.from('asistencias').insert({ actividad: a, parte: 'actividad' }); if (r.error) throw new Error(r.error.message); }, actId);
    for (const p of [A, B]) {
      await abrirTarjeta(p, titulo);
      await esperar(p, () => /Todavía no hay fotos/.test((document.getElementById('album-act') || {}).textContent || ''));
    }

    await paso('A sube de la galería y B la ve en vivo', async () => {
      await (await A.$('#album-act input[type=file]')).uploadFile(fixture);
      await celdas(A, 1);
      await celdas(B, 1);
    });

    await paso('A saca una foto con la cámara y B la ve en vivo', async () => {
      await A.click('#album-camara');
      await esperar(A, () => { const v = document.querySelector('#camara video'); return v && v.videoWidth > 0; });
      await A.click('#camara [data-c="disparo"]');
      await celdas(A, 2);
      await A.click('#camara [data-c="cerrar"]');
      await celdas(B, 2);
    });

    await paso('A sin señal: queda en el teléfono y sube sola al volver', async () => {
      await A.setOfflineMode(true);
      await (await A.$('#album-act input[type=file]')).uploadFile(fixture);
      await esperar(A, () => /esperando señal/.test(document.querySelector('#album-act .album-estado').textContent));
      await A.setOfflineMode(false);
      await A.evaluate(() => dispatchEvent(new Event('online')));
      await celdas(A, 3);
      await celdas(B, 3);
    });

    await paso('B sube una y A la ve en vivo', async () => {
      await (await B.$('#album-act input[type=file]')).uploadFile(fixture);
      await celdas(B, 4);
      await celdas(A, 4);
    });

    await paso('B no puede borrar una foto de A (sin botón y la base tampoco lo deja)', async () => {
      const deA = await A.evaluate(async (a) => { const { data } = await App.sb.from('fotos').select('id').eq('actividad', a).eq('autor', App.yo().id).limit(1); return data[0].id; }, actId);
      await B.click(`#album-act .album-cel[data-id="${deA}"]`);
      await B.waitForSelector('.album-visor');
      assert.equal(await B.$eval('.album-borrar', (e) => e.hidden), true);
      const n = await B.evaluate(async (id) => (await App.sb.from('fotos').delete().eq('id', id).select('id')).data.length, deA);
      assert.equal(n, 0);
      await B.keyboard.press('Escape');
    });

    await paso('A borra una suya y desaparece en las dos ventanas', async () => {
      await A.evaluate(() => document.querySelector('#album-act').scrollIntoView({ block: 'start' }));
      await A.screenshot({ path: path.join(shots, 'album-vivo-claro.png') });
      await B.evaluate(() => document.querySelector('#album-act').scrollIntoView({ block: 'start' }));
      await B.screenshot({ path: path.join(shots, 'album-vivo-oscuro.png') });
      const id = await A.evaluate(async (a) => { const { data } = await App.sb.from('fotos').select('id').eq('actividad', a).eq('autor', App.yo().id).limit(1); return data[0].id; }, actId);
      await A.click(`#album-act .album-cel[data-id="${id}"]`);
      await A.waitForSelector('.album-visor');
      await A.click('.album-borrar');
      await A.waitForSelector('.album-confirmar:not([hidden])');
      await new Promise((r) => setTimeout(r, 600));
      await A.click('.album-borrar-si');
      await celdas(A, 3);
      await celdas(B, 3);
      const queda = await A.evaluate(async (i) => (await App.sb.from('fotos').select('id').eq('id', i)).data.length, id);
      assert.equal(queda, 0);
    });

    await paso('sin errores de JavaScript', async () => {
      assert.deepEqual(A.errores, []); assert.deepEqual(B.errores, []);
    });
  } catch (e) {
    fallas++; console.log('FALLA', e.message);
  } finally {
    if (actId) {
      try {
        const n = (await limpiarMias(A, actId)) + (await limpiarMias(B, actId));
        console.log('limpieza: ' + n + ' archivo(s) del bucket borrados');
        await A.evaluate((a) => App.sb.from('actividades').update({ estado: 'cancelada' }).eq('id', a), actId);
      } catch (e) { console.log('limpieza incompleta:', e.message); }
    }
    await Promise.all(navegadores.map((b) => b.close().catch(() => {})));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('Para borrar la actividad de prueba: correr dev/supabase/limpiar-pruebas.sql con el MCP supabase-thirdcedi o en el SQL Editor.');
  console.log(fallas ? `${fallas} falla(s)` : 'todo ok');
  process.exit(fallas ? 1 : 0);
})();
