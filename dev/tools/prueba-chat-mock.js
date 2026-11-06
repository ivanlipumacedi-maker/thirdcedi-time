// Prueba de la UI del chat SIN red ni usuarios reales: un Supabase falso en memoria (vive en este proceso y atiende a dos
// páginas, "ventana A" y "ventana B", con la misma regla de sala que la base: solo ve y escribe quien está anotado).
// Verifica: carga, envío, llegada en vivo entre ventanas, editar, eliminar, foto, reconexión sin duplicados,
// error inicial con "Reintentar" y que quien no está anotado no ve el chat. Capturas en dev/shots/ (claro y oscuro, 390x844).
// No toca el proyecto real ni necesita contraseñas.
// Uso: servir la raíz con `npx --yes http-server -p 8080 -c-1` y correr `node dev/tools/prueba-chat-mock.js`
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const URL_APP = process.env.URL_APP || 'http://127.0.0.1:8080';
const raiz = path.join(__dirname, '..', '..');
const shots = path.join(__dirname, '..', 'shots');
fs.mkdirSync(shots, { recursive: true });

// ---------- "Servidor" en memoria ----------
const UA = '11111111-1111-4111-8111-111111111111', UB = '22222222-2222-4222-8222-222222222222', UC = '33333333-3333-4333-8333-333333333333';
const ACT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ahora = Date.now();
const db = {
  perfiles: [
    { id: UA, nombre: 'Ana Pérez', foto: null, empresa: 'CEDI' },
    { id: UB, nombre: 'Beto Gómez', foto: null, empresa: 'Wemox' },
    { id: UC, nombre: 'Cami Ruiz', foto: null, empresa: 'Korex' },
  ],
  actividades: [{ id: ACT, creador: UA, tipo: 'padel', tipo_otro: null, titulo: 'Pádel del jueves', fecha: new Date(ahora + 864e5).toISOString(), lugar: 'Club Norte', cupo: 8, descripcion: '', tiene_tercer: true, tercer_lugar: 'Parrilla', tercer_fecha: new Date(ahora + 864e5 + 72e5).toISOString(), estado: 'abierta', creado: new Date(ahora - 1e6).toISOString() }],
  asistencias: [{ actividad: ACT, persona: UA, parte: 'actividad' }, { actividad: ACT, persona: UB, parte: 'tercer' }],
  mensajes: [],
};
let seq = 0;
const paginas = []; // { page, uid, desconectada }
const enSala = (uid, sala) => { const m = /^act:(.+)$/.exec(sala || ''); return !!m && db.asistencias.some((a) => a.actividad === m[1] && a.persona === uid); };
let fallarMensajes = 0; // cuántas lecturas de mensajes fallan (para probar el error inicial)

function emitir(evento, fila) {
  for (const p of paginas) {
    if (p.desconectada || !enSala(p.uid, fila.sala)) continue;
    p.page.evaluate((e, f) => window.__emitir(e, f), evento, fila).catch(() => {});
  }
}
function cumple(fila, filtros) {
  return filtros.every(([op, col, v]) => (op === 'eq' ? fila[col] === v : op === 'lt' ? fila[col] < v : op === 'in' ? v.includes(fila[col]) : true));
}
function consulta(uid, s) {
  if (s.rpc) {
    const m = db.mensajes.find((x) => x.id === s.args.p_id);
    if (!m || m.autor !== uid || !enSala(uid, m.sala)) return { error: { code: 'P0002', message: 'No se puede' } };
    if (s.rpc === 'editar_mensaje') { Object.assign(m, { texto: s.args.p_texto, editado: true }); emitir('UPDATE', m); return { data: m }; }
    const antes = m.archivo; Object.assign(m, { tipo: 'eliminado', texto: null, archivo: null, ancho: null, alto: null }); emitir('UPDATE', m);
    return { data: { fila: m, archivo_antes: antes } };
  }
  let filas = db[s.table];
  if (s.table === 'mensajes') {
    if (s.action === 'select' && fallarMensajes > 0) { fallarMensajes--; return { error: { message: 'sin red' } }; }
    if (s.action === 'insert') {
      const v = s.values;
      if (!enSala(uid, v.sala)) return { error: { code: '42501', message: 'RLS' } };
      const fila = { id: 'm' + (++seq) + '-0000-4000-8000-000000000000', sala: v.sala, autor: uid, tipo: v.tipo, texto: v.texto || null, archivo: v.archivo || null, ancho: v.ancho || null, alto: v.alto || null, editado: false, creado: new Date().toISOString() };
      db.mensajes.push(fila); emitir('INSERT', fila);
      return { data: fila };
    }
    filas = filas.filter((m) => enSala(uid, m.sala));
  }
  let r = filas.filter((f) => cumple(f, s.filtros));
  if (s.orden) r = [...r].sort((a, b) => (a[s.orden.col] < b[s.orden.col] ? -1 : 1) * (s.orden.asc ? 1 : -1));
  if (s.limite) r = r.slice(0, s.limite);
  return { data: s.single ? r[0] || null : r.map((x) => ({ ...x })) };
}

// ---------- Cliente falso que se inyecta en lugar de vendor/supabase.js ----------
const STUB = `
(function () {
  const Q = (spec) => window.__q(JSON.stringify(spec)).then((r) => JSON.parse(r));
  function Builder(table) {
    const s = { table, action: 'select', filtros: [], orden: null, limite: 0, single: false, values: null };
    const b = {
      select() { return b; },
      insert(v) { s.action = 'insert'; s.values = v; return b; },
      update() { s.action = 'update'; return b; },
      eq(c, v) { s.filtros.push(['eq', c, v]); return b; },
      lt(c, v) { s.filtros.push(['lt', c, v]); return b; },
      in(c, v) { s.filtros.push(['in', c, v]); return b; },
      order(col, o) { s.orden = { col, asc: !(o && o.ascending === false) }; return b; },
      limit(n) { s.limite = n; return b; },
      single() { s.single = true; return b; },
      maybeSingle() { s.single = true; return b; },
      then(res, rej) { return Q(s).then((r) => ({ data: r.data === undefined ? null : r.data, error: r.error || null })).then(res, rej); },
    };
    return b;
  }
  const canales = new Set();
  window.__emitir = (evento, fila) => canales.forEach((c) => c.cbs.filter((x) => x.evento === evento).forEach((x) => x.fn({ eventType: evento, new: fila })));
  window.__estadoCanales = (st) => canales.forEach((c) => c.estado && c.estado(st));
  window.supabase = { createClient() {
    return {
      from: Builder,
      rpc(fn, args) { return Q({ rpc: fn, args }).then((r) => ({ data: r.data === undefined ? null : r.data, error: r.error || null })); },
      channel() {
        const c = { cbs: [], on(_t, f, fn) { c.cbs.push({ evento: f.event, fn }); return c; }, subscribe(cb) { c.estado = cb; canales.add(c); if (cb) setTimeout(() => cb('SUBSCRIBED'), 0); return c; } };
        return c;
      },
      removeChannel(c) { canales.delete(c); },
      storage: { from() { return {
        upload: async (p) => ({ data: { path: p }, error: null }),
        remove: async () => ({ data: [], error: null }),
        createSignedUrls: async (paths) => ({ data: paths.map((p) => ({ path: p, error: null, signedUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#3a9"/><text x="200" y="160" font-size="28" text-anchor="middle" fill="#fff">foto de prueba</text></svg>') })), error: null }),
      }; } },
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}), getUser: async () => ({ data: { user: null } }) },
    };
  } };
})();`;

const navegadores = [];
async function abrir(_ignorado, uid, tema) {
  // un navegador por ventana: una pestaña en segundo plano no avanza y las dos tienen que estar activas a la vez
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  navegadores.push(browser);
  const page = await browser.newPage();
  const reg = { page, uid, desconectada: false };
  paginas.push(reg);
  page.errores = [];
  page.on('pageerror', (e) => page.errores.push(e.message));
  if (process.env.DEPURAR) page.on('console', (m) => console.log('[' + uid.slice(0, 2) + ']', m.text()));
  await page.exposeFunction('__q', async (j) => JSON.stringify(consulta(uid, JSON.parse(j))));
  await page.setBypassServiceWorker(true); // el service worker serviría el supabase.js real de la caché
  await page.setRequestInterception(true);
  page.on('request', (rq) => {
    if (rq.url().endsWith('/vendor/supabase.js')) rq.respond({ status: 200, contentType: 'application/javascript', body: STUB });
    else if (/fonts\.(googleapis|gstatic)\.com/.test(rq.url())) rq.respond({ status: 200, contentType: 'text/css', body: '' });
    else rq.continue();
  });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: tema }]);
  if (process.env.DEPURAR) console.log('goto', uid.slice(0, 2));
  await page.goto(URL_APP, { waitUntil: 'networkidle0' });
  if (process.env.DEPURAR) console.log('cargada', uid.slice(0, 2));
  await page.evaluate((p) => { App.modoAcceso(false); App.setPerfil(p); }, db.perfiles.find((p) => p.id === uid));
  await page.waitForSelector('.tarjeta-act', { timeout: 8000 }).catch(async (e) => { console.log('DEBUG', page.errores, JSON.stringify(await page.evaluate(() => document.getElementById('pantalla-actividades').innerText.slice(-200)))); throw e; });
  return reg;
}
const texto = (p, sel) => p.$eval(sel, (e) => e.textContent);
const cuantos = (p, sel) => p.$$eval(sel, (e) => e.length);
const esperar = (p, fn, ...a) => p.waitForFunction(fn, { timeout: 6000 }, ...a);
const sinToast = (p) => p.waitForFunction(() => document.getElementById('toast').hidden, { timeout: 8000 });

(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  let fallas = 0;
  const paso = async (n, fn) => { try { await fn(); console.log('ok', n); } catch (e) { fallas++; console.log('FALLA', n, '-', e.message); } };
  try {
    // Ventana A (Ana, anotada a la actividad). Primero se prueba el error inicial: la 1ª lectura de mensajes falla.
    fallarMensajes = 1;
    const A = await abrir(b, UA, 'light');
    const pa = A.page;
    await pa.click('.tarjeta-act');
    await pa.waitForSelector('#chat-act');

    await paso('error inicial: no queda en "Cargando…", ofrece Reintentar y recupera', async () => {
      await pa.waitForSelector('#chat-reintentar', { timeout: 6000 });
      assert.match(await texto(pa, '#chat-act .chat-lista'), /No pudimos cargar el chat/);
      await pa.evaluate(() => document.querySelector('#chat-act').scrollIntoView({ block: 'center' }));
      await pa.screenshot({ path: path.join(shots, 'chat-error-claro.png') });
      await pa.click('#chat-reintentar');
      await esperar(pa, () => /Todavía no hay mensajes/.test(document.querySelector('#chat-act .chat-lista').textContent));
    });

    const B = await abrir(b, UB, 'light');
    const pb = B.page;
    await pb.click('.tarjeta-act');
    await pb.waitForSelector('#chat-act');

    await paso('A manda un mensaje y B (solo tercer tiempo) lo ve en vivo, con el nombre de A', async () => {
      await pa.type('#chat-act .chat-texto', 'Llevo las pelotas 🎾');
      await pa.click('#chat-act .chat-enviar');
      await esperar(pb, () => /Llevo las pelotas/.test(document.querySelector('#chat-act .chat-lista').textContent));
      assert.match(await texto(pb, '#chat-act .chat-autor'), /Ana Pérez/);
      assert.equal(await cuantos(pa, '#chat-act .chat-msg.mio'), 1);
      assert.equal(await cuantos(pb, '#chat-act .chat-msg.otro'), 1);
    });

    await paso('B responde y A lo ve; sin duplicados', async () => {
      await pb.type('#chat-act .chat-texto', 'Yo llevo la bebida');
      await pb.click('#chat-act .chat-enviar');
      await esperar(pa, () => /Yo llevo la bebida/.test(document.querySelector('#chat-act .chat-lista').textContent));
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(await cuantos(pa, '#chat-act .chat-msg'), 2);
      assert.equal(await cuantos(pb, '#chat-act .chat-msg'), 2);
    });

    await paso('B manda una foto y A la ve en vivo', async () => {
      const inp = await pb.$('#chat-act input[type=file]');
      await inp.uploadFile(path.join(raiz, 'icon-192.png'));
      await esperar(pa, () => document.querySelectorAll('#chat-act img.chat-foto').length === 1);
      await esperar(pa, () => (document.querySelector('#chat-act img.chat-foto').getAttribute('src') || '').startsWith('data:image/svg'));
      await esperar(pb, () => document.querySelectorAll('#chat-act .chat-msg.mio img.chat-foto').length === 1 && !document.querySelector('#chat-act .subiendo'));
    });

    await paso('A edita su mensaje y B ve "Editado" en vivo', async () => {
      await pa.click('#chat-act .chat-msg.mio .chat-mas-acc');
      await pa.click('#chat-act .chat-menu .btn-sec');
      assert.equal(await pa.$eval('#chat-act .chat-texto', (e) => e.value), 'Llevo las pelotas 🎾');
      await pa.$eval('#chat-act .chat-texto', (e) => { e.value = 'Llevo las pelotas y redes'; });
      await pa.click('#chat-act .chat-enviar');
      await esperar(pb, () => /Llevo las pelotas y redes/.test(document.querySelector('#chat-act .chat-lista').textContent) && /Editado/.test(document.querySelector('#chat-act .chat-lista').textContent));
      assert.equal(await pa.$eval('#chat-act .chat-edicion', (e) => e.hidden), true);
    });

    await paso('A elimina su mensaje (segundo toque) y B ve la marca', async () => {
      await pa.click('#chat-act .chat-msg.mio .chat-mas-acc');
      await pa.click('#chat-act .chat-menu .btn-peligro');
      assert.match(await texto(pa, '#chat-act .chat-menu .btn-peligro'), /Tocá de nuevo/);
      await pa.click('#chat-act .chat-menu .btn-peligro');
      await esperar(pb, () => /Se eliminó este mensaje/.test(document.querySelector('#chat-act .chat-lista').textContent));
      assert.doesNotMatch(await texto(pb, '#chat-act .chat-lista'), /pelotas/);
    });

    await paso('reconexión: lo mandado mientras A estaba desconectada aparece al volver, sin duplicar', async () => {
      A.desconectada = true; // el socket de A está caído: no recibe nada en vivo
      await pb.type('#chat-act .chat-texto', 'Mensaje mientras no estabas');
      await pb.click('#chat-act .chat-enviar');
      await esperar(pb, () => /mientras no estabas/.test(document.querySelector('#chat-act .chat-lista').textContent));
      await new Promise((r) => setTimeout(r, 300));
      assert.doesNotMatch(await texto(pa, '#chat-act .chat-lista'), /mientras no estabas/);
      A.desconectada = false;
      await pa.evaluate(() => window.__estadoCanales('SUBSCRIBED')); // Realtime reconectó
      await esperar(pa, () => /mientras no estabas/.test(document.querySelector('#chat-act .chat-lista').textContent));
      const n = await cuantos(pa, '#chat-act .chat-msg');
      assert.equal(n, db.mensajes.length);
      await pa.evaluate(() => window.__estadoCanales('SUBSCRIBED'));
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(await cuantos(pa, '#chat-act .chat-msg'), n, 'otra reconexión no duplica');
    });

    await paso('quien no está anotado no ve el chat', async () => {
      const C = await abrir(b, UC, 'light');
      await C.page.click('.tarjeta-act');
      await C.page.waitForSelector('#btn-voy');
      assert.equal(await cuantos(C.page, '#chat-act'), 0);
      assert.equal(await cuantos(C.page, '.chat'), 0);
      await C.page.close();
    });

    await paso('al volver a la lista el chat se cierra', async () => {
      await pb.evaluate(() => document.querySelector('#pantalla-actividades > .btn-link').click());
      await pb.waitForSelector('.tarjeta-act');
      assert.equal(await cuantos(pb, '#chat-act'), 0);
    });

    // capturas: claro y oscuro con la conversación
    await pa.type('#chat-act .chat-texto', 'Listo, nos vemos a las 19 hs en la cancha, avisen si llegan tarde 👍');
    await pa.click('#chat-act .chat-enviar');
    await esperar(pa, () => /nos vemos a las 19/.test(document.querySelector('#chat-act .chat-lista').textContent) && !document.querySelector('#chat-act .subiendo'));
    await sinToast(pa);
    await pa.evaluate(() => { const l = document.querySelector('#chat-act'); l.scrollIntoView({ block: 'start' }); });
    await pa.screenshot({ path: path.join(shots, 'chat-claro.png') });
    await pa.click('#btn-tema');
    await pa.evaluate(() => { document.querySelector('#chat-act').scrollIntoView({ block: 'start' }); });
    await pa.screenshot({ path: path.join(shots, 'chat-oscuro.png') });
    await pa.evaluate(() => { document.querySelector('#chat-act .chat-msg.mio .chat-mas-acc') && document.querySelector('#chat-act .chat-msg.mio .chat-mas-acc').click(); });
    await pa.screenshot({ path: path.join(shots, 'chat-menu-oscuro.png') });

    for (const r of paginas) if (r.page.errores.length) { fallas++; console.log('FALLA errores de página:', r.page.errores); }
  } finally { await b.close(); for (const n of navegadores) await n.close().catch(() => {}); }
  console.log(fallas ? fallas + ' falla(s)' : 'todo ok');
  process.exit(fallas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
