// Prueba E2E de ThirdCEDI Time en DOS emuladores Android (Task 10, Step 4), contra la app publicada.
// Cada emulador corre Chrome con la app; este script se conecta por CDP (adb forward a chrome_devtools_remote)
// con puppeteer-core y saca las capturas de la pantalla real con `adb exec-out screencap`.
//   A = zz-prueba-a en el emulador 1 (hailo_chico), B = zz-prueba-b en el emulador 2 (hailo_grande).
//   C = zz-prueba-c, solo para El Impostor: otro contexto de navegador en el Chrome del emulador 1 (o, si Chrome
//   de Android no lo permite, un Chrome de escritorio sin ventana; queda anotado en la salida).
// Las contraseñas salen de .env (ZZ_PRUEBA_A/B/C_PASSWORD) y nunca se imprimen ni pasan por la línea de comandos.
//
// Antes: levantar los dos AVD, abrir Chrome en la app y (una vez) sacar el primer arranque de Chrome:
//   adb -s <serial> shell am set-debug-app --persistent com.android.chrome
//   adb -s <serial> shell 'echo "_ --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line'
//   adb -s <serial> shell pm grant com.android.chrome android.permission.POST_NOTIFICATIONS
// Uso: node dev/tools/e2e-android.js [pasos]   (pasos: lista como 1,2,3 o "todos"; por defecto todos)
//   Variables opcionales: SERIAL_A, SERIAL_B (emulator-5554 / emulator-5556), URL_APP.
// Capturas en dev/shots/e2e-android-*.png. Estado entre corridas en dev/shots/e2e-android-estado.json.
// Al final: correr dev/supabase/limpiar-pruebas.sql y limpiar-pruebas-juegos.sql con el MCP supabase-thirdcedi.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const URL_APP = process.env.URL_APP || 'https://ivanlipumacedi-maker.github.io/thirdcedi-time/';
const ADB = path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe');
const DISP = {
  A: { serial: process.env.SERIAL_A || 'emulator-5554', puerto: 9301 },
  B: { serial: process.env.SERIAL_B || 'emulator-5556', puerto: 9302 },
};
const SHOTS = path.join(__dirname, '..', 'shots');
const ESTADO = path.join(SHOTS, 'e2e-android-estado.json');
const FOTO_DISP = '/data/local/tmp/e2e-foto.png'; // foto de prueba, subida con adb push
fs.mkdirSync(SHOTS, { recursive: true });
const T = 30000;

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
for (const L of ['A', 'B']) if (!env[`ZZ_PRUEBA_${L}_PASSWORD`]) { console.log(`Falta ZZ_PRUEBA_${L}_PASSWORD en .env`); process.exit(2); }

const estado = fs.existsSync(ESTADO) ? JSON.parse(fs.readFileSync(ESTADO, 'utf8')) : {};
const guardarEstado = () => fs.writeFileSync(ESTADO, JSON.stringify(estado, null, 1));
const adb = (serial, ...a) => execFileSync(ADB, ['-s', serial, ...a], { maxBuffer: 64 << 20 });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Captura de la pantalla real del emulador (incluye la barra de Chrome y las notificaciones).
function captura(L, nombre) {
  const f = path.join(SHOTS, `e2e-android-${nombre}-${L.toLowerCase()}.png`);
  fs.writeFileSync(f, adb(DISP[L].serial, 'exec-out', 'screencap', '-p'));
  return f;
}
const capturas = (nombre) => { captura('A', nombre); captura('B', nombre); };

async function conectar(L) {
  const { serial, puerto } = DISP[L];
  adb(serial, 'forward', `tcp:${puerto}`, 'localabstract:chrome_devtools_remote');
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${puerto}`, defaultViewport: null, protocolTimeout: 120000,
    // Chrome de Android lista, por cada pestaña, un target fantasma con id numérico ('0', '1'…, sin contexto) que
    // nunca se adjunta: sin este filtro puppeteer.connect se queda esperándolo para siempre.
    targetFilter: (t) => !/^\d+$/.test(t._targetId) });
  // la pestaña visible de la app; las otras pestañas de la app se cierran (comparten sesión y escuchan en vivo)
  const deApp = (await browser.pages()).filter((x) => x.url().startsWith(URL_APP));
  let p = null;
  for (const x of deApp) if (!p && await x.evaluate(() => document.visibilityState === 'visible').catch(() => false)) p = x;
  p = p || deApp[0];
  for (const x of deApp) if (x !== p) await x.close().catch(() => {});
  if (!p) { p = await browser.newPage(); await p.goto(URL_APP, { waitUntil: 'networkidle2' }); }
  p.L = L; p.browser = browser; p.errores = [];
  p.on('pageerror', (e) => p.errores.push(e.message));
  // Sin caché HTTP: GitHub Pages manda max-age=600 y los scripts no llevan ?v=, así que después de publicar el
  // teléfono puede cargar una mezcla de archivos viejos y nuevos (pasó en esta prueba: trivia.js nuevo con
  // trivia-logica.js viejo → "T.textoPuesto is not a function"). Se limpia para probar lo publicado.
  if (!process.env.CON_CACHE) {
    const cdp = await p.createCDPSession();
    await cdp.send('Network.clearBrowserCache');
    await cdp.detach();
    await p.reload({ waitUntil: 'networkidle2' });
  }
  return p;
}

// Entra con signInWithPassword (sin OTP por mail) y recarga, como las otras pruebas en vivo.
async function login(p, L) {
  const email = `zz-prueba-${L.toLowerCase()}@cedi.com.ar`;
  await p.waitForFunction(() => window.App && App.sb, { timeout: T });
  const actual = await p.evaluate(async () => (await App.sb.auth.getUser()).data.user?.email || null);
  if (actual !== email) {
    if (actual) await p.evaluate(() => App.sb.auth.signOut());
    const r = await p.evaluate(async (e, c) => { const { error } = await App.sb.auth.signInWithPassword({ email: e, password: c }); return error ? error.message : null; }, email, env[`ZZ_PRUEBA_${L}_PASSWORD`]);
    assert.equal(r, null, 'login ' + L + ': ' + r);
  }
  await p.goto(URL_APP + '#/actividades', { waitUntil: 'networkidle2' });
  await p.reload({ waitUntil: 'networkidle2' });
  await p.waitForSelector('#btn-nueva-act', { timeout: T });
  p.yo = await p.evaluate(() => App.yo().id);
}

const clic = (p, sel) => p.$eval(sel, (e) => e.click());
const esperar = (p, fn, ...a) => p.waitForFunction(fn, { timeout: T, polling: 300 }, ...a);
const ir = async (p, ruta) => { await p.evaluate((r) => { location.hash = r; }, ruta); await dormir(600); };
const sinToast = (p) => p.waitForFunction(() => document.getElementById('toast').hidden, { timeout: 8000 }).catch(() => {});
const abrirTarjeta = (p, t) => esperar(p, (x) => { const e = [...document.querySelectorAll('.tarjeta-act')].find((y) => y.querySelector('.tarjeta-titulo').textContent === x); if (e) e.click(); return !!e; }, t);
const alVer = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (e) e.scrollIntoView({ block: 'start' }); }, sel);
async function volverAlDetalle(p) {
  await ir(p, '#/actividades');
  const enDetalle = await p.$('#btn-voy');
  if (!enDetalle) { await p.evaluate(() => { const b = document.querySelector('#pantalla-actividades .btn-link'); if (b && /Volver|Actividades/.test(b.textContent)) b.click(); }); await abrirTarjeta(p, estado.titulo); }
  await p.waitForSelector('#btn-voy', { timeout: T });
}

// Sube un archivo del EMULADOR a un input file (DOM.setFileInputFiles con una ruta del dispositivo).
async function subirArchivo(p, sel) {
  const cdp = await p.createCDPSession();
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
  assert.ok(nodeId, 'no está el input ' + sel);
  await cdp.send('DOM.setFileInputFiles', { nodeId, files: [FOTO_DISP] });
  await cdp.detach();
}
// Arma una foto de prueba en la página, la baja al disco y la sube al emulador con adb push.
async function prepararFoto(p, L) {
  const png = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 1200; c.height = 900; const g = c.getContext('2d'); g.fillStyle = '#002F68'; g.fillRect(0, 0, 1200, 900); g.fillStyle = '#00B1EF'; g.beginPath(); g.arc(600, 450, 300, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 90px sans-serif'; g.fillText('zz e2e', 440, 480); return c.toDataURL('image/png'); });
  const local = path.join(SHOTS, 'e2e-android-fixture.png');
  fs.writeFileSync(local, Buffer.from(png.split(',')[1], 'base64'));
  adb(DISP[L].serial, 'push', local, FOTO_DISP);
  adb(DISP[L].serial, 'shell', 'chmod', '644', FOTO_DISP);
}

const resultados = [];
async function paso(n, nombre, fn) {
  if (!PASOS.includes(n)) return;
  const t0 = Date.now();
  try { const extra = await fn(); resultados.push(['ok', n, nombre, extra || '']); console.log(`ok    ${n}. ${nombre}${extra ? ' — ' + extra : ''} (${((Date.now() - t0) / 1000).toFixed(0)} s)`); }
  catch (e) { resultados.push(['FALLA', n, nombre, e.message]); console.log(`FALLA ${n}. ${nombre} — ${e.message.split('\n')[0]}`); try { capturas(`falla-${n}`); } catch (x) { /* sin captura */ } }
}
const arg = process.argv[2] || 'todos';
const PASOS = arg === 'todos' ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : arg.split(',').map(Number);

(async () => {
  const A = await conectar('A');
  const B = await conectar('B');
  const extras = [];

  await paso(1, 'login en los dos', async () => {
    await login(A, 'A'); await login(B, 'B');
    capturas('1-login');
  });
  if (!A.yo) { A.yo = await A.evaluate(() => App.yo() && App.yo().id); B.yo = await B.evaluate(() => App.yo() && App.yo().id); }

  await paso(2, 'A crea una actividad zz con tercer tiempo y B la ve sin recargar', async () => {
    await ir(B, '#/actividades');
    await ir(A, '#/actividades');
    estado.titulo = 'zz E2E Android ' + new Date().toISOString().slice(5, 16).replace('T', ' ');
    await clic(A, '#btn-nueva-act');
    await A.waitForSelector('#f-titulo');
    await A.select('#f-tipo', 'padel');
    await A.type('#f-titulo', estado.titulo);
    const en = (h) => new Date(Date.now() + h * 3600e3 - 3 * 3600e3).toISOString().slice(0, 16); // hora argentina
    await A.$eval('#f-fecha', (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, en(30));
    await A.type('#f-lugar', 'Club de prueba');
    await A.type('#f-cupo', '4');
    await clic(A, '#f-tercer');
    await A.waitForSelector('#f-ter-lugar');
    await A.type('#f-ter-lugar', 'Parrilla de prueba');
    await A.$eval('#f-ter-fecha', (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, en(32));
    captura('A', '2-form');
    await clic(A, '#btn-guardar-act');
    await A.waitForSelector('#btn-voy', { timeout: T });
    estado.actId = await A.evaluate(async (t) => (await App.sb.from('actividades').select('id').eq('titulo', t).single()).data.id, estado.titulo);
    guardarEstado();
    await esperar(B, (t) => [...document.querySelectorAll('.tarjeta-titulo')].some((e) => e.textContent === t), estado.titulo);
    await B.evaluate((t) => [...document.querySelectorAll('.tarjeta-act')].find((x) => x.querySelector('.tarjeta-titulo').textContent === t).scrollIntoView({ block: 'center' }), estado.titulo);
    const tarj = await B.evaluate((t) => [...document.querySelectorAll('.tarjeta-act')].find((x) => x.querySelector('.tarjeta-titulo').textContent === t).textContent, estado.titulo);
    assert.match(tarj, /tercer tiempo/i);
    capturas('2-actividad-nueva');
  });

  await paso(3, 'B se anota a la actividad y al tercer tiempo; A lo ve en vivo', async () => {
    await volverAlDetalle(A);
    // A también se anota (el chat y las cuentas son de los anotados)
    if ((await A.$eval('#btn-voy', (e) => e.textContent)) === 'Voy') { await sinToast(A); await clic(A, '#btn-voy'); await esperar(A, () => document.getElementById('btn-voy').textContent === 'Ya no voy'); }
    await ir(B, '#/actividades');
    if (!(await B.$('#btn-voy'))) await abrirTarjeta(B, estado.titulo);
    await B.waitForSelector('#btn-voy-tercer', { timeout: T });
    await sinToast(B);
    await clic(B, '#btn-voy');
    await esperar(B, () => document.getElementById('btn-voy').textContent === 'Ya no voy');
    await sinToast(B);
    await clic(B, '#btn-voy-tercer');
    await esperar(B, () => document.getElementById('btn-voy-tercer').textContent === 'Ya no voy al tercer tiempo');
    await esperar(A, () => /Tercer tiempo \(1\)/.test(document.body.innerText) && /ZZ Prueba B/.test(document.body.innerText));
    await alVer(A, '#pantalla-actividades h2.sub');
    capturas('3-anotados');
  });

  await paso(4, 'chat: A escribe, B lo ve en vivo y responde con una foto de la galería', async () => {
    await volverAlDetalle(A); await volverAlDetalle(B);
    for (const p of [A, B]) await p.waitForSelector('#chat-act textarea', { timeout: T });
    const txt = 'zz hola desde el emulador A ' + Date.now().toString().slice(-5);
    await A.focus('#chat-act textarea');
    await A.type('#chat-act textarea', txt);
    await A.$eval('#chat-act form', (f) => f.requestSubmit());
    await esperar(B, (t) => [...document.querySelectorAll('#chat-act .chat-txt')].some((e) => e.textContent === t), txt);
    await alVer(B, '#chat-act'); await alVer(A, '#chat-act');
    capturas('4-chat-texto');
    await prepararFoto(B, 'B');
    const antes = await A.$$eval('#chat-act .chat-foto', (xs) => xs.length);
    await subirArchivo(B, '#chat-act input[type=file]');
    await esperar(A, (n) => [...document.querySelectorAll('#chat-act .chat-foto')].filter((i) => i.complete && i.naturalWidth > 0).length > n, antes);
    await esperar(B, () => !document.querySelector('#chat-act .chat-burbuja.subiendo'));
    await A.evaluate(() => { const f = [...document.querySelectorAll('#chat-act .chat-foto')].pop(); f.scrollIntoView({ block: 'center' }); });
    await B.evaluate(() => { const f = [...document.querySelectorAll('#chat-act .chat-foto')].pop(); f.scrollIntoView({ block: 'center' }); });
    capturas('4-chat-foto');
  });

  await paso(5, 'cuentas: A carga un gasto entre los dos; B ve "Debés", paga y A ve "Estás al día"', async () => {
    await volverAlDetalle(A); await volverAlDetalle(B);
    const en = (p, re) => esperar(p, (r) => { const e = document.getElementById('cuentas-act'); return !!e && !e.hidden && new RegExp(r).test(e.textContent); }, re.source);
    await en(A, /Todavía no hay gastos|Agregar|gasto/i);
    await clic(A, '#cu-nuevo');
    await A.waitForSelector('#cu-form');
    await A.$eval('#cu-monto', (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, '1.000');
    await A.$eval('#cu-concepto', (e, v) => { e.value = v; }, 'zz Cancha');
    await alVer(A, '#cuentas-act');
    captura('A', '5-gasto-form');
    await clic(A, '#cu-guardar');
    await en(A, /Te deben \$\s500/);
    await en(B, /Debés \$\s500/);
    await sinToast(A); await sinToast(B);
    await alVer(A, '#cuentas-act'); await alVer(B, '#cuentas-act');
    capturas('5-debes');
    await clic(B, '#cu-transferencias .cu-pagar');
    await B.waitForSelector('#cu-confirmar-si');
    captura('B', '5-confirmar');
    await clic(B, '#cu-confirmar-si');
    await en(B, /Estás al día/);
    await en(A, /Estás al día/);
    await sinToast(A); await sinToast(B);
    await alVer(A, '#cuentas-act'); await alVer(B, '#cuentas-act');
    capturas('5-al-dia');
  });

  await paso(6, 'álbum: B sube una foto y A la ve', async () => {
    await volverAlDetalle(A); await volverAlDetalle(B);
    await B.waitForSelector('#album-act input[type=file]', { timeout: T });
    const antes = await A.$$eval('#album-act .album-cel', (xs) => xs.length);
    await prepararFoto(B, 'B');
    await subirArchivo(B, '#album-act input[type=file]');
    await esperar(B, (n) => document.querySelectorAll('#album-act .album-cel').length > n, antes);
    await esperar(A, (n) => document.querySelectorAll('#album-act .album-cel').length > n, antes);
    await esperar(A, () => [...document.querySelectorAll('#album-act .album-cel img')].every((i) => i.complete && i.naturalWidth > 0));
    await alVer(A, '#album-act'); await alVer(B, '#album-act');
    await dormir(800);
    capturas('6-album');
  });

  await paso(7, 'juegos: Trivia entre A y B (algunas preguntas y ranking) e Impostor con C', async () => {
    if (process.env.SOLO_IMPOSTOR) { for (const p of [A, B]) await p.evaluate(async () => { const { data } = await App.sb.from('jugadores').select('partida').eq('persona', App.yo().id).eq('se_fue', false); for (const x of data || []) await App.sb.rpc('salir_partida', { p: x.partida }); }); } else {
    // Trivia (antes, A y B salen de lo que haya quedado abierto de una corrida anterior)
    for (const p of [A, B]) await p.evaluate(async () => { const { data } = await App.sb.from('jugadores').select('partida').eq('persona', App.yo().id).eq('se_fue', false); for (const x of data || []) await App.sb.rpc('salir_partida', { p: x.partida }); });
    await ir(A, '#/juegos'); await ir(B, '#/juegos');
    await A.evaluate(() => { const b = [...document.querySelectorAll('#pantalla-juegos button, #pantalla-juegos a')].find((x) => /Volver/.test(x.textContent)); if (b) b.click(); });
    await B.evaluate(() => { const b = [...document.querySelectorAll('#pantalla-juegos button, #pantalla-juegos a')].find((x) => /Volver/.test(x.textContent)); if (b) b.click(); });
    await A.waitForSelector('#btn-nueva-partida', { timeout: T }); await B.waitForSelector('#btn-nueva-partida', { timeout: T });
    await clic(A, '#btn-nueva-partida');
    await A.waitForSelector('#nueva-trivia');
    await clic(A, '#nueva-trivia');
    await A.waitForSelector('#btn-arrancar', { timeout: T });
    const par = await A.evaluate(async () => { const { data } = await App.sb.from('jugadores').select('partida').eq('persona', App.yo().id).eq('se_fue', false); return data.map((x) => x.partida); });
    // en la lista puede haber partidas de otros (reales): se espera la de A
    await esperar(B, (ids) => { const t = [...document.querySelectorAll('#lista-abiertas .tarjeta-partida')].find((e) => ids.includes(e.dataset.id)); if (t) t.click(); return !!t; }, par);
    await B.waitForSelector('#btn-unirme', { timeout: T });
    await clic(B, '#btn-unirme');
    await esperar(A, () => /ZZ Prueba B/.test(document.getElementById('sala-jugadores').textContent));
    capturas('7-trivia-sala');
    await clic(A, '#btn-arrancar');
    for (let i = 0; i < 3; i++) {
      await A.waitForSelector('.op-trivia:not([disabled])', { timeout: T }); await B.waitForSelector('#trivia-pregunta', { timeout: T });
      await esperar(A, () => !document.querySelector('.op-trivia.correcta'));
      await esperar(B, () => !document.querySelector('.op-trivia.correcta') && !!document.querySelector('.op-trivia'));
      const qa = await A.$eval('#trivia-pregunta', (e) => e.textContent), qb = await B.$eval('#trivia-pregunta', (e) => e.textContent);
      assert.equal(qa, qb, 'ven la misma pregunta');
      await clic(B, '.op-trivia[data-op="0"]');
      await clic(A, '.op-trivia[data-op="1"]');
      await A.waitForSelector('.op-trivia.correcta', { timeout: T }); await B.waitForSelector('.op-trivia.correcta', { timeout: T });
      if (i === 0) capturas('7-trivia-revelada');
      if (i < 2) { await esperar(A, () => !!document.querySelector('#btn-siguiente:not([disabled])')); await clic(A, '#btn-siguiente'); await dormir(800); }
    }
    // tres preguntas jugadas: el ranking parcial ya está; el creador termina la partida pasando lo que falta
    await B.waitForSelector('#ranking-parcial', { timeout: T });
    capturas('7-trivia-ranking-parcial');
    for (let i = 0; i < 120; i++) {
      if (await A.$('#ranking-final')) break;
      await A.evaluate(() => { const b = document.querySelector('#btn-siguiente:not([disabled]), #btn-revelar:not([disabled])'); if (b) b.click(); });
      await dormir(500);
    }
    await A.waitForSelector('#ranking-final', { timeout: T }); await B.waitForSelector('#ranking-final', { timeout: T });
    assert.equal(await B.$$eval('#ranking-final .fila-ranking', (xs) => xs.length), 2);
    capturas('7-trivia-ranking-final');
    for (const p of [A, B]) await p.evaluate(async () => { const { data } = await App.sb.from('jugadores').select('partida').eq('persona', App.yo().id).eq('se_fue', false); for (const x of data || []) await App.sb.rpc('salir_partida', { p: x.partida }); });

    }
    // Impostor: C en otro contexto del Chrome del emulador A (si se puede)
    if (!env.ZZ_PRUEBA_C_PASSWORD) throw new Error('Trivia ok; Impostor sin probar: falta ZZ_PRUEBA_C_PASSWORD');
    let C, cDonde, cBrowser;
    try {
      const ctx = await A.browser.createBrowserContext();
      C = await ctx.newPage(); cDonde = 'otro contexto del Chrome del emulador A';
    } catch (e) {
      cDonde = 'Chrome de escritorio sin ventana (Chrome de Android no permite otro contexto por CDP: ' + e.message.split('\n')[0] + ')';
      cBrowser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
      C = await cBrowser.newPage();
      await C.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    }
    extras.push('C (Impostor): ' + cDonde);
    try {
      C.L = 'C'; C.errores = []; C.on('pageerror', (e) => C.errores.push(e.message));
      await C.goto(URL_APP, { waitUntil: 'networkidle2' });
      await login(C, 'C');
      if (!cBrowser) await A.bringToFront();
      const TODOS = [A, B, C];
      for (const p of TODOS) { await ir(p, '#/juegos'); await p.evaluate(() => { const b = [...document.querySelectorAll('#pantalla-juegos button, #pantalla-juegos a')].find((x) => /Volver/.test(x.textContent)); if (b) b.click(); }); await p.waitForSelector('#btn-nueva-partida', { timeout: T }); }
      await clic(A, '#btn-nueva-partida');
      await A.waitForSelector('#nueva-impostor');
      await clic(A, '#nueva-impostor');
      await A.waitForSelector('#btn-arrancar', { timeout: T });
      const ids = await A.evaluate(async () => { const { data } = await App.sb.from('jugadores').select('partida').eq('persona', App.yo().id).eq('se_fue', false); return data.map((x) => x.partida); });
      for (const p of [B, C]) {
        await esperar(p, (i) => [...document.querySelectorAll('#lista-abiertas .tarjeta-partida')].some((e) => i.includes(e.dataset.id)), ids);
        await p.evaluate((i) => [...document.querySelectorAll('#lista-abiertas .tarjeta-partida')].find((e) => i.includes(e.dataset.id)).click(), ids);
        await p.waitForSelector('#btn-unirme', { timeout: T });
        await clic(p, '#btn-unirme');
        await p.waitForSelector('#esperando-creador', { timeout: T });
      }
      await esperar(A, () => /ZZ Prueba C/.test(document.getElementById('sala-jugadores').textContent) && !document.getElementById('btn-arrancar').disabled);
      capturas('7-impostor-sala');
      await clic(A, '#btn-arrancar');
      const pal = {};
      for (const p of TODOS) { await esperar(p, () => { const x = document.getElementById('impostor-palabra'); return x && !/Cargando/.test(x.textContent); }); pal[p.L] = (await p.$eval('#impostor-palabra', (e) => e.textContent)).trim(); }
      assert.equal(new Set(Object.values(pal)).size, 2, 'dos palabras distintas entre los tres');
      for (const p of [A, B]) await p.evaluate(() => { document.activeElement && document.activeElement.blur(); const e = document.querySelector('#impostor-palabra'); if (e) e.scrollIntoView({ block: 'start' }); }); await dormir(700);
      capturas('7-impostor-palabra');
      await esperar(A, () => !!document.getElementById('btn-imp-avanzar'));
      await clic(A, '#btn-imp-avanzar');
      for (const p of TODOS) await esperar(p, () => /Pistas/.test((document.getElementById('impostor-fase') || {}).textContent || ''));
      for (const p of TODOS) { await p.type('#chat-par textarea', 'zz pista de ' + p.L); await p.$eval('#chat-par form', (f) => f.requestSubmit()); }
      await esperar(A, () => /zz pista de B/.test(document.getElementById('chat-par').textContent) && /zz pista de C/.test(document.getElementById('chat-par').textContent));
      await esperar(A, () => { const b = document.getElementById('btn-imp-avanzar'); return b && !b.disabled; });
      await clic(A, '#btn-imp-avanzar');
      for (const p of TODOS) await esperar(p, () => document.querySelectorAll('.voto-imp').length === 2);
      for (const p of [A, B]) await p.evaluate(() => { document.activeElement && document.activeElement.blur(); const e = document.querySelector('.voto-imp'); if (e) e.scrollIntoView({ block: 'start' }); }); await dormir(700);
      capturas('7-impostor-votacion');
      await clic(A, '.voto-imp[data-persona="' + C.yo + '"]');
      await clic(B, '.voto-imp[data-persona="' + C.yo + '"]');
      await clic(C, '.voto-imp[data-persona="' + A.yo + '"]');
      for (const p of TODOS) await p.waitForSelector('#impostor-resultado', { timeout: T });
      await dormir(800);
      for (const p of [A, B]) await p.evaluate(() => { document.activeElement && document.activeElement.blur(); const e = document.querySelector('#impostor-resultado'); if (e) e.scrollIntoView({ block: 'start' }); }); await dormir(700);
      capturas('7-impostor-resultado');
      for (const p of TODOS) await p.evaluate(async () => { const { data } = await App.sb.from('jugadores').select('partida').eq('persona', App.yo().id).eq('se_fue', false); for (const x of data || []) await App.sb.rpc('salir_partida', { p: x.partida }); }).catch(() => {});
      if (C.errores.length) extras.push('errores de página en C: ' + C.errores.join(' | '));
    } finally {
      if (cBrowser) await cBrowser.close().catch(() => {});
      else { await C.evaluate(() => App.sb.auth.signOut()).catch(() => {}); await C.browserContext().close().catch(() => {}); await A.bringToFront().catch(() => {}); }
    }
    return cDonde;
  });

  await paso(8, 'avisos: B activa los avisos, pide una prueba y le llega; un mensaje de A le avisa a B', async () => {
    await B.bringToFront();
    await ir(B, '#/perfil');
    await B.waitForSelector('#perfil-avisos button, #perfil-avisos p', { timeout: T });
    const est = await B.$eval('#perfil-avisos', (e) => e.innerText);
    if (await B.$('#btn-avisos-on')) {
      await B.click('#btn-avisos-on'); // clic real (gesto): el permiso de notificaciones lo pide Chrome
      // aceptar el diálogo del permiso de Chrome si aparece
      for (let i = 0; i < 12 && !(await B.$('#btn-avisos-probar')); i++) {
        const xml = (() => { try { adb(DISP.B.serial, 'shell', 'uiautomator', 'dump', '/data/local/tmp/ui.xml'); return adb(DISP.B.serial, 'shell', 'cat', '/data/local/tmp/ui.xml').toString(); } catch (e) { return ''; } })();
        const m = /text="(Allow|Permitir)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(xml);
        if (m) { captura('B', '8-permiso'); adb(DISP.B.serial, 'shell', 'input', 'tap', String((+m[2] + +m[4]) >> 1), String((+m[3] + +m[5]) >> 1)); }
        await dormir(1500);
      }
    }
    await B.waitForSelector('#btn-avisos-probar', { timeout: T }).catch(async () => { throw new Error('no quedaron activos: ' + (await B.$eval('#perfil-avisos', (e) => e.innerText)) + ' (antes: ' + est + ')'); });
    const sub = await B.evaluate(async () => { const r = await navigator.serviceWorker.ready; const s = await r.pushManager.getSubscription(); return s && s.endpoint.slice(0, 60); });
    captura('B', '8-avisos-activos');
    const t0 = Date.now();
    await B.click('#btn-avisos-probar');
    await B.waitForSelector('#avisos-msg', { timeout: T });
    const msg = await B.$eval('#avisos-msg', (e) => e.textContent);
    // B se va a la pantalla de inicio: el aviso tiene que aparecer en la barra de Android
    const esperarNotif = async (re, seg) => {
      for (let i = 0; i < seg; i += 2) {
        const d = adb(DISP.B.serial, 'shell', 'dumpsys', 'notification', '--noredact').toString();
        const chrome = d.split(/NotificationRecord\(/).filter((x) => /pkg=com\.android\.chrome/.test(x));
        const hit = chrome.find((x) => re.test(x));
        if (hit) return hit;
        await dormir(2000);
      }
      return null;
    };
    const n1 = await esperarNotif(/android\.title=String \(.*\)|tickerText/, 60);
    const dump = adb(DISP.B.serial, 'shell', 'dumpsys', 'notification', '--noredact').toString();
    fs.writeFileSync(path.join(SHOTS, 'e2e-android-8-dumpsys-notification.txt'), dump);
    adb(DISP.B.serial, 'shell', 'cmd', 'statusbar', 'expand-notifications');
    await dormir(1500);
    captura('B', '8-notificacion-prueba');
    adb(DISP.B.serial, 'shell', 'cmd', 'statusbar', 'collapse');
    if (!n1) throw new Error(`no llegó la notificación de prueba en 60 s (suscripción ${sub}; mensaje: "${msg}"; ver e2e-android-8-dumpsys-notification.txt)`);
    const titulo1 = (/android\.title=String \(([^)]*)\)/.exec(n1) || [])[1];
    extras.push(`aviso de prueba en ${((Date.now() - t0) / 1000).toFixed(0)} s: "${titulo1}"`);

    // mensaje de chat de A → aviso a B (B en la pantalla de inicio)
    adb(DISP.B.serial, 'shell', 'input', 'keyevent', 'KEYCODE_HOME');
    await dormir(1500);
    await volverAlDetalle(A);
    const txt = 'zz aviso para B ' + Date.now().toString().slice(-5);
    await A.type('#chat-act textarea', txt);
    await A.$eval('#chat-act form', (f) => f.requestSubmit());
    const n2 = await esperarNotif(new RegExp(txt.slice(0, 12)), 90) || await esperarNotif(/ZZ Prueba A|mensaje/i, 4);
    adb(DISP.B.serial, 'shell', 'cmd', 'statusbar', 'expand-notifications');
    await dormir(1500);
    captura('B', '8-notificacion-chat');
    captura('A', '8-chat-a');
    adb(DISP.B.serial, 'shell', 'cmd', 'statusbar', 'collapse');
    fs.writeFileSync(path.join(SHOTS, 'e2e-android-8-dumpsys-notification-chat.txt'), adb(DISP.B.serial, 'shell', 'dumpsys', 'notification', '--noredact').toString());
    adb(DISP.B.serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', URL_APP, 'com.android.chrome');
    if (!n2) throw new Error('llegó la prueba pero no el aviso del mensaje de chat en 90 s');
    return extras.slice(-1)[0] + '; aviso de chat: "' + ((/android\.title=String \(([^)]*)\)/.exec(n2) || [])[1]) + '"';
  });

  await paso(9, 'rotación y modo oscuro', async () => {
    await volverAlDetalle(A); await volverAlDetalle(B);
    await ir(A, '#/actividades'); await ir(B, '#/actividades');
    for (const L of ['A', 'B']) { adb(DISP[L].serial, 'shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0'); adb(DISP[L].serial, 'shell', 'settings', 'put', 'system', 'user_rotation', '1'); }
    await dormir(2500);
    const anchos = { A: await A.evaluate(() => [innerWidth, innerHeight, document.documentElement.scrollWidth]), B: await B.evaluate(() => [innerWidth, innerHeight, document.documentElement.scrollWidth]) };
    capturas('9-horizontal');
    for (const L of ['A', 'B']) adb(DISP[L].serial, 'shell', 'settings', 'put', 'system', 'user_rotation', '0');
    await dormir(2000);
    for (const p of [A, B]) { if ((await p.evaluate(() => document.documentElement.getAttribute('data-tema'))) !== 'oscuro') await clic(p, '#btn-tema'); }
    await dormir(600);
    capturas('9-oscuro');
    await volverAlDetalle(A); await alVer(A, '#cuentas-act'); await volverAlDetalle(B); await alVer(B, '#chat-act');
    await dormir(600);
    capturas('9-oscuro-detalle');
    for (const p of [A, B]) await clic(p, '#btn-tema');
    await dormir(600);
    capturas('9-claro'); // el emulador viene en oscuro por sistema: esta es la del tema claro
    for (const p of [A, B]) await p.evaluate(() => localStorage.removeItem('tema')); // vuelve a seguir al sistema
    for (const [L, [w, h, sw]] of Object.entries(anchos)) assert.ok(sw <= w + 1, `${L} en horizontal se desborda a lo ancho (${sw} > ${w})`);
    return 'horizontal: ' + JSON.stringify(anchos);
  });

  // 10: limpieza de Storage con la sesión de cada usuario zz (la base se limpia después con los .sql por el MCP):
  // fotos del álbum (filas y archivos) y fotos del chat de todas las actividades "zz E2E Android".
  await paso(10, 'limpieza de Storage (álbum y chat) como los usuarios zz', async () => {
    let n = 0;
    for (const p of [A, B]) {
      n += await p.evaluate(async () => {
        const yo = App.yo().id;
        const { data: acts } = await App.sb.from('actividades').select('id').ilike('titulo', 'zz E2E Android%');
        let k = 0;
        for (const { id } of acts || []) {
          const { data: fotos } = await App.sb.from('fotos').select('id,ruta,mini,media,autor').eq('actividad', id).eq('autor', yo);
          for (const f of fotos || []) await App.sb.from('fotos').delete().eq('id', f.id);
          const rutas = (fotos || []).flatMap((f) => [f.ruta, f.mini, f.media]).filter(Boolean);
          const { data: objs } = await App.sb.storage.from('album').list(id, { limit: 1000 });
          for (const o of objs || []) rutas.push(id + '/' + o.name);
          const unicas = [...new Set(rutas)];
          if (unicas.length) { const r = await App.sb.storage.from('album').remove(unicas); k += (r.data || []).length; }
          const sala = 'act:' + id;
          const { data: cf } = await App.sb.storage.from('chat').list(sala + '/fotos', { limit: 1000 });
          const rc = (cf || []).map((o) => sala + '/fotos/' + o.name);
          if (rc.length) { const r = await App.sb.storage.from('chat').remove(rc); k += (r.data || []).length; }
        }
        return k;
      });
    }
    return n + ' archivo(s) borrados';
  });

  const errores = [...A.errores.map((e) => 'A: ' + e), ...B.errores.map((e) => 'B: ' + e)];
  console.log('\n=== resumen');
  resultados.forEach(([r, n, nom, x]) => console.log(`${r.padEnd(5)} ${n}. ${nom}${x ? '\n        ' + x : ''}`));
  extras.forEach((x) => console.log('nota: ' + x));
  console.log(errores.length ? 'errores de página:\n  ' + errores.join('\n  ') : 'sin errores de página');
  await A.browser.disconnect(); await B.browser.disconnect();
  process.exit(resultados.some((r) => r[0] === 'FALLA') ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
