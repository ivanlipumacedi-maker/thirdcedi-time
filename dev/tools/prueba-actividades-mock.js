// Prueba de la UI de Actividades SIN red ni usuarios reales: un Supabase falso en memoria (vive en este proceso y
// atiende a dos páginas, "ventana A" y "ventana B") con las mismas reglas que la base (07 y 10): edita solo el creador,
// una cancelada no se edita y apagar el tercer tiempo quita a sus anotados.
// Verifica: error de la primera carga con "Reintentar", resincronización al reconectar (SUBSCRIBED) con el patrón
// otraVez (una sola repetición), aviso en la página al apagar el tercer tiempo, cancelada no editable (UI y base),
// que un no-creador no ve "Organizar", que reactivar depende de la fecha de la actividad (no del tercer tiempo) y
// que con la pantalla cerrada no se lee nada.
// Uso: servir la raíz con `npx --yes http-server -p 8080 -c-1` y correr `node dev/tools/prueba-actividades-mock.js`
const assert = require('assert/strict');
const puppeteer = require('./navegador'); // puppeteer-core, o WebKit con NAVEGADOR=webkit
const URL_APP = process.env.URL_APP || 'http://127.0.0.1:8080';

// ---------- "Servidor" en memoria ----------
const UA = '11111111-1111-4111-8111-111111111111', UB = '22222222-2222-4222-8222-222222222222';
const ACT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ACT2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', ACT3 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ACT4 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ahora = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const actividad = (id, titulo, extra) => ({ id, creador: UA, tipo: 'padel', tipo_otro: null, titulo, fecha: iso(ahora + 864e5), lugar: 'Club Norte', cupo: 8, descripcion: '', tiene_tercer: false, tercer_lugar: null, tercer_fecha: null, estado: 'abierta', creado: iso(ahora - 1e6), ...extra });
const db = {
  perfiles: [
    { id: UA, nombre: 'Ana Pérez', foto: null, empresa: 'CEDI' },
    { id: UB, nombre: 'Beto Gómez', foto: null, empresa: 'Wemox' },
  ],
  actividades: [
    actividad(ACT, 'Pádel del jueves', { tiene_tercer: true, tercer_lugar: 'Parrilla', tercer_fecha: iso(ahora + 864e5 + 72e5) }),
    actividad(ACT2, 'Fútbol del viernes', { tipo: 'futbol', fecha: iso(ahora + 2 * 864e5) }),
    actividad(ACT3, 'Asado de anteayer', { tipo: 'asado', fecha: iso(ahora - 2 * 864e5), estado: 'cancelada' }),
    // la actividad ya empezó pero el tercer tiempo todavía no: sigue en "próximas", pero no se puede reactivar
    actividad(ACT4, 'Trekking de recién', { tipo: 'trekking', fecha: iso(ahora - 36e5), tiene_tercer: true, tercer_lugar: 'Bar', tercer_fecha: iso(ahora + 72e5), estado: 'cancelada' }),
  ],
  asistencias: [{ actividad: ACT, persona: UA, parte: 'actividad' }, { actividad: ACT, persona: UB, parte: 'tercer' }],
  mensajes: [],
  actividades_links: [],
};
const paginas = []; // { page, uid, desconectada }
const cuenta = {}; // lecturas/escrituras por usuario: 'A:actividades:select', etc.
const contar = (uid, k) => { const c = (uid === UA ? 'A' : 'B') + ':' + k; cuenta[c] = (cuenta[c] || 0) + 1; };
const n = (k) => cuenta[k] || 0;
let fallarActividades = 0; // cuántas lecturas de actividades fallan (error de la primera carga)
let demorarActividades = 0; // ms que tarda la próxima lectura de actividades de A (la foto del servidor se toma al pedir)
const enSala = (uid, sala) => { const m = /^act:(.+)$/.exec(sala || ''); return !!m && db.asistencias.some((a) => a.actividad === m[1] && a.persona === uid); };

function emitir(tabla, evento, fila) {
  for (const p of paginas) {
    if (p.desconectada) continue;
    p.page.evaluate((t, e, f) => window.__emitir(t, e, f), tabla, evento, fila).catch(() => {});
  }
}
const cumple = (fila, filtros) => filtros.every(([op, col, v]) => (op === 'eq' ? fila[col] === v : op === 'in' ? v.includes(fila[col]) : true));
const P0001 = (message) => ({ error: { code: 'P0001', message } });

function consulta(uid, s) {
  contar(uid, s.table + ':' + s.action);
  if (s.table === 'actividades' && s.action === 'select' && fallarActividades > 0) { fallarActividades--; return { error: { message: 'sin red' } }; }
  if (s.table === 'actividades' && s.action === 'update') {
    const filas = db.actividades.filter((f) => cumple(f, s.filtros) && f.creador === uid); // RLS: solo el creador
    // trigger de la 10: una cancelada no se edita; solo se reactiva (solo estado -> 'abierta', creador y
    // old.fecha > now(): cuenta la fecha de la actividad, no el tercer tiempo)
    for (const f of filas) {
      if (f.estado !== 'cancelada') continue;
      const soloEstado = Object.keys(s.values).every((k) => k === 'estado' || s.values[k] === f[k]) && s.values.estado === 'abierta';
      if (!soloEstado) return P0001('La actividad está cancelada');
      if (!(Date.parse(f.fecha) > Date.now())) return P0001('La actividad ya pasó: no se puede reactivar');
    }
    const out = filas.map((f) => {
      const antes = { ...f };
      Object.assign(f, s.values);
      if (antes.tiene_tercer && !f.tiene_tercer) { // trigger actividades_quitar_tercer
        db.asistencias.filter((x) => x.actividad === f.id && x.parte === 'tercer').forEach((x) => emitir('asistencias', 'DELETE', x));
        db.asistencias = db.asistencias.filter((x) => !(x.actividad === f.id && x.parte === 'tercer'));
      }
      emitir('actividades', 'UPDATE', f);
      return { ...f };
    });
    if (s.single) return out.length ? { data: out[0] } : { error: { code: 'PGRST116', message: '0 filas' } };
    return { data: out };
  }
  if (s.table === 'actividades' && s.action === 'insert') {
    const f = { ...actividad('dddddddd-dddd-4ddd-8ddd-' + String(Date.now()).padStart(12, '0').slice(-12), ''), ...s.values, creador: uid, estado: 'abierta' };
    db.actividades.push(f); emitir('actividades', 'INSERT', f);
    return { data: s.single ? { ...f } : [{ ...f }] };
  }
  if (s.table === 'asistencias' && s.action === 'insert') {
    const a = db.actividades.find((x) => x.id === s.values.actividad);
    if (a.estado === 'cancelada') return P0001('La actividad está cancelada');
    if (s.values.parte === 'tercer' && !a.tiene_tercer) return P0001('La actividad no tiene tercer tiempo');
    const f = { actividad: a.id, persona: uid, parte: s.values.parte };
    db.asistencias.push(f); emitir('asistencias', 'INSERT', f);
    return { data: f };
  }
  if (s.table === 'asistencias' && s.action === 'delete') {
    const fuera = db.asistencias.filter((f) => cumple(f, s.filtros) && f.persona === uid);
    db.asistencias = db.asistencias.filter((f) => !fuera.includes(f));
    fuera.forEach((f) => emitir('asistencias', 'DELETE', f));
    return { data: fuera };
  }
  if (s.table === 'actividades_links' && s.action === 'upsert') {
    // RLS de la 25: solo el creador de una actividad no cancelada
    const a = db.actividades.find((x) => x.id === s.values.actividad);
    if (!a || a.creador !== uid || a.estado === 'cancelada') return { error: { code: '42501', message: 'new row violates row-level security policy' } };
    const f = { lugar_link: null, destino_link: null, tercer_link: null, ...s.values };
    db.actividades_links = db.actividades_links.filter((x) => x.actividad !== f.actividad).concat(f);
    emitir('actividades_links', 'UPDATE', f);
    return { data: null };
  }
  let filas = db[s.table] || [];
  if (s.table === 'mensajes') filas = filas.filter((m) => enSala(uid, m.sala));
  // RLS de la 25: los links los ven el creador y los anotados
  if (s.table === 'actividades_links') filas = filas.filter((l) => db.actividades.some((a) => a.id === l.actividad && a.creador === uid) || enSala(uid, 'act:' + l.actividad));
  let r = filas.filter((f) => cumple(f, s.filtros));
  if (s.ordenes.length) r = [...r].sort((a, b) => { for (const o of s.ordenes) { if (a[o.col] !== b[o.col]) return (a[o.col] < b[o.col] ? -1 : 1) * (o.asc ? 1 : -1); } return 0; });
  if (s.limite) r = r.slice(0, s.limite);
  return { data: s.single ? r[0] || null : r.map((x) => ({ ...x })) };
}

// ---------- Cliente falso que se inyecta en lugar de vendor/supabase.js ----------
const STUB = `
(function () {
  const Q = (spec) => window.__q(JSON.stringify(spec)).then((r) => JSON.parse(r));
  function Builder(table) {
    const s = { table, action: 'select', filtros: [], ordenes: [], limite: 0, single: false, values: null };
    const b = {
      select() { return b; },
      insert(v) { s.action = 'insert'; s.values = v; return b; },
      upsert(v) { s.action = 'upsert'; s.values = v; return b; },
      update(v) { s.action = 'update'; s.values = v; return b; },
      delete() { s.action = 'delete'; return b; },
      eq(c, v) { s.filtros.push(['eq', c, v]); return b; },
      in(c, v) { s.filtros.push(['in', c, v]); return b; },
      lt() { return b; }, or() { return b; },
      order(col, o) { s.ordenes.push({ col, asc: !(o && o.ascending === false) }); return b; },
      limit(n) { s.limite = n; return b; },
      single() { s.single = true; return b; },
      maybeSingle() { s.single = true; return b; },
      then(res, rej) { return Q(s).then((r) => ({ data: r.data === undefined ? null : r.data, error: r.error || null })).then(res, rej); },
    };
    return b;
  }
  const canales = new Set();
  const todos = []; // también los ya quitados: para simular un SUBSCRIBED que llega tarde
  window.__emitir = (tabla, evento, fila) => canales.forEach((c) => c.cbs.filter((x) => x.tabla === tabla && (x.evento === '*' || x.evento === evento)).forEach((x) => x.fn({ eventType: evento, new: fila, old: fila })));
  window.__estadoCanales = (st) => canales.forEach((c) => c.estado && c.estado(st));
  window.__estadoTodos = (st) => todos.forEach((c) => c.estado && c.estado(st));
  window.supabase = { createClient() {
    return {
      from: Builder,
      rpc() { return Promise.resolve({ data: null, error: { message: 'sin rpc' } }); },
      channel() {
        const c = { cbs: [], on(_t, f, fn) { c.cbs.push({ tabla: f.table, evento: f.event, fn }); return c; }, subscribe(cb) { c.estado = cb; canales.add(c); todos.push(c); if (cb) setTimeout(() => cb('SUBSCRIBED'), 0); return c; } };
        return c;
      },
      removeChannel(c) { canales.delete(c); },
      storage: { from() { return { upload: async (p) => ({ data: { path: p }, error: null }), remove: async () => ({ data: [], error: null }), createSignedUrls: async () => ({ data: [], error: null }) }; } },
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}), getUser: async () => ({ data: { user: null } }) },
    };
  } };
})();`;

const navegadores = [];
async function abrir(uid, esperarSel = '.tarjeta-act') {
  // un navegador por ventana: una pestaña en segundo plano no avanza y las dos tienen que estar activas a la vez
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  navegadores.push(browser);
  const page = await browser.newPage();
  const reg = { page, uid, desconectada: false };
  paginas.push(reg);
  page.errores = [];
  page.on('pageerror', (e) => page.errores.push(e.message));
  if (process.env.DEPURAR) page.on('console', (m) => console.log('[' + uid.slice(0, 2) + ']', m.text()));
  await page.exposeFunction('__q', async (j) => {
    const s = JSON.parse(j);
    const r = consulta(uid, s); // la "foto" del servidor se toma acá, antes de la demora
    if (s.table === 'actividades' && s.action === 'select' && demorarActividades && uid === UA) { const ms = demorarActividades; demorarActividades = 0; await new Promise((ok) => setTimeout(ok, ms)); }
    return JSON.stringify(r);
  });
  await page.setBypassServiceWorker(true); // el service worker serviría el supabase.js real de la caché
  await page.setRequestInterception(true);
  page.on('request', (rq) => {
    if (rq.url().endsWith('/vendor/supabase.js')) rq.respond({ status: 200, contentType: 'application/javascript', body: STUB });
    else if (/fonts\.(googleapis|gstatic)\.com/.test(rq.url())) rq.respond({ status: 200, contentType: 'text/css', body: '' });
    else rq.continue();
  });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto(URL_APP, { waitUntil: 'networkidle0' });
  await page.evaluate((p) => { App.modoAcceso(false); App.setPerfil(p); }, db.perfiles.find((p) => p.id === uid));
  await page.waitForSelector(esperarSel, { timeout: 8000 });
  return reg;
}
const texto = (p, sel) => p.$eval(sel, (e) => e.textContent);
const clic = (p, sel) => p.$eval(sel, (e) => e.click()); // por DOM: el toast puede tapar el botón
const cuantos = (p, sel) => p.$$eval(sel, (e) => e.length);
const esperar = (p, fn, ...a) => p.waitForFunction(fn, { timeout: 6000 }, ...a);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const pantalla = (p) => texto(p, '#pantalla-actividades');
const abrirTarjeta = (p, titulo) => p.evaluate((t) => [...document.querySelectorAll('.tarjeta-act')].find((e) => e.textContent.includes(t)).click(), titulo);
const volver = (p) => p.evaluate(() => document.querySelector('#pantalla-actividades .btn-link').click());

(async () => {
  let fallas = 0;
  const paso = async (nombre, fn) => { try { await fn(); console.log('ok', nombre); } catch (e) { fallas++; console.log('FALLA', nombre, '-', e.message); } };
  try {
    // Ventana A (Ana, creadora). La primera carga falla (la inicial y la repetición por SUBSCRIBED).
    fallarActividades = 5;
    const A = await abrir(UA, '#pantalla-actividades .vacio');
    const pa = A.page;

    await paso('punto 2: si falla la primera carga no queda en "Cargando…": error con Reintentar, y recupera', async () => {
      await pa.waitForSelector('#act-reintentar', { timeout: 6000 });
      assert.match(await pantalla(pa), /No pudimos cargar las actividades/);
      fallarActividades = 0;
      await clic(pa, '#act-reintentar');
      await pa.waitForSelector('.tarjeta-act');
      assert.equal(await cuantos(pa, '.tarjeta-act'), 4);
    });

    await paso('punto 2: al reconectar (SUBSCRIBED) se pone al día con lo que cambió con el socket caído', async () => {
      A.desconectada = true;
      db.actividades.push(actividad('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Trekking mientras no estabas', { tipo: 'trekking' }));
      await dormir(300);
      assert.doesNotMatch(await pantalla(pa), /mientras no estabas/);
      A.desconectada = false;
      await pa.evaluate(() => window.__estadoCanales('SUBSCRIBED'));
      await esperar(pa, () => /mientras no estabas/.test(document.getElementById('pantalla-actividades').textContent));
    });

    await paso('punto 2: SUBSCRIBED con una carga en vuelo corre una sola repetición y no pierde lo commiteado', async () => {
      A.desconectada = true; // lo nuevo solo puede llegar por una recarga
      const antes = n('A:actividades:select');
      demorarActividades = 1500; // la recarga que arranca ahora toma la foto del servidor ya y tarda en volver
      await pa.evaluate(() => window.__estadoCanales('SUBSCRIBED'));
      await dormir(200);
      db.actividades.push(actividad('ffffffff-ffff-4fff-8fff-ffffffffffff', 'Asado commiteado durante la carga', { tipo: 'asado' }));
      await pa.evaluate(() => { window.__estadoCanales('SUBSCRIBED'); window.__estadoCanales('SUBSCRIBED'); window.__estadoCanales('SUBSCRIBED'); });
      A.desconectada = false;
      await esperar(pa, () => /Asado commiteado durante la carga/.test(document.getElementById('pantalla-actividades').textContent));
      await dormir(400);
      assert.equal(n('A:actividades:select') - antes, 2, 'tres pedidos durante el vuelo se juntan en una sola repetición');
    });

    await paso('filtro por tipo como toggle: sin "Todas"; tocar el activo lo desmarca; vacío con "Ver todas"', async () => {
      const seg = (t) => '#pantalla-actividades .seg[data-tipo="' + t + '"]';
      const activos = () => pa.$$eval('#pantalla-actividades .seg[aria-pressed="true"]', (xs) => xs.map((x) => x.dataset.tipo));
      assert.equal(await cuantos(pa, '#pantalla-actividades .seg'), 6, 'un segmento por tipo, sin "Todas"');
      assert.deepEqual(await activos(), []);
      const todas = await cuantos(pa, '.tarjeta-act');
      await clic(pa, seg('futbol'));
      assert.deepEqual(await activos(), ['futbol']);
      const tipos = await pa.$$eval('.tarjeta-act .tarjeta-tipo', (xs) => xs.map((x) => x.textContent));
      assert.ok(tipos.length && tipos.every((t) => t === 'Fútbol'), 'solo fútbol: ' + JSON.stringify(tipos));
      await clic(pa, seg('futbol'));
      assert.deepEqual(await activos(), [], 'tocar el activo lo desmarca');
      assert.equal(await cuantos(pa, '.tarjeta-act'), todas);
      await clic(pa, seg('after'));
      assert.match(await texto(pa, '#act-vacio'), /No hay after office en agenda/);
      await clic(pa, '#act-ver-todas');
      assert.deepEqual(await activos(), []);
      assert.equal(await cuantos(pa, '.tarjeta-act'), todas);
    });

    const B = await abrir(UB);
    const pb = B.page;

    await paso('un no-creador no ve "Organizar" ni "Editar"', async () => {
      await abrirTarjeta(pb, 'Pádel del jueves');
      await pb.waitForSelector('#btn-voy-tercer');
      assert.doesNotMatch(await pantalla(pb), /Organizar/);
      assert.equal(await cuantos(pb, '#btn-cancelar'), 0);
      assert.equal(await cuantos(pb, '#chat-act'), 1, 'B (solo tercer tiempo) ve el chat');
    });

    await paso('punto 4: apagar el tercer tiempo pide confirmación en la página con la cantidad, y "No" no guarda', async () => {
      await abrirTarjeta(pa, 'Pádel del jueves');
      await pa.waitForSelector('#btn-cancelar');
      await pa.evaluate(() => [...document.querySelectorAll('#pantalla-actividades .btn-sec')].find((b) => b.textContent === 'Editar').click());
      await pa.waitForSelector('#f-tercer');
      const upd = n('A:actividades:update');
      await clic(pa, '#f-tercer'); // lo destilda
      await clic(pa, '#btn-guardar-act');
      await pa.waitForSelector('#aviso-tercer:not([hidden])');
      assert.match(await texto(pa, '#aviso-tercer-txt'), /se va a quitar 1 anotado al tercer tiempo/);
      assert.equal(n('A:actividades:update'), upd, 'no se guardó antes de confirmar');
      // el foco va a la opción que no borra nada, y el aviso se anuncia una sola vez (por el foco, no con role=alert)
      assert.equal(await pa.evaluate(() => document.activeElement && document.activeElement.id), 'btn-dejar-tercer');
      assert.equal(await pa.$eval('#aviso-tercer', (e) => e.getAttribute('role')), null, 'role=alert además del foco: doble anuncio');
      assert.equal(await pa.$eval('#btn-dejar-tercer', (e) => e.getAttribute('aria-describedby')), 'aviso-tercer-txt');
      await clic(pa, '#btn-dejar-tercer');
      assert.equal(await pa.$eval('#f-tercer', (e) => e.checked), true);
      assert.equal(await pa.$eval('#aviso-tercer', (e) => e.hidden), true);
      assert.equal(n('A:actividades:update'), upd);
    });

    await paso('punto 4: al confirmar se guarda, la base quita a los del tercer tiempo y B pierde el chat en vivo', async () => {
      await clic(pa, '#f-tercer');
      await clic(pa, '#btn-guardar-act');
      await pa.waitForSelector('#aviso-tercer:not([hidden])');
      await clic(pa, '#btn-confirmar-tercer');
      await pa.waitForSelector('#btn-voy');
      assert.equal(db.actividades.find((x) => x.id === ACT).tiene_tercer, false);
      assert.equal(db.asistencias.filter((x) => x.actividad === ACT && x.parte === 'tercer').length, 0);
      assert.equal(await cuantos(pa, '#btn-voy-tercer'), 0);
      await esperar(pb, () => !document.getElementById('btn-voy-tercer') && !document.getElementById('chat-act'));
      // B ya no está anotado a nada: no hay chat, y el lugar del chat no queda como el texto "null"
      assert.doesNotMatch(await pantalla(pb), /null|undefined/, 'el detalle muestra "null"');
    });

    await paso('punto 4: una edición que no apaga el tercer tiempo no muestra el aviso', async () => {
      await pa.evaluate(() => [...document.querySelectorAll('#pantalla-actividades .btn-sec')].find((b) => b.textContent === 'Editar').click());
      await pa.waitForSelector('#f-titulo');
      await pa.$eval('#f-titulo', (e) => { e.value = 'Pádel del jueves (cambiado)'; });
      await clic(pa, '#btn-guardar-act');
      await pa.waitForSelector('#btn-voy');
      assert.equal(db.actividades.find((x) => x.id === ACT).titulo, 'Pádel del jueves (cambiado)');
    });

    await paso('lugares con Google Maps: etiqueta por tipo, destino del trekking, pegar lo que copia Maps y el botón del detalle', async () => {
      // sin link: el detalle ofrece buscar el lugar por nombre
      assert.equal(await pa.$eval('#maps-lugar', (e) => e.textContent), 'Ver en Maps');
      assert.match(await pa.$eval('#maps-lugar', (e) => e.href), /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
      await pa.evaluate(() => [...document.querySelectorAll('#pantalla-actividades .btn-sec')].find((b) => b.textContent === 'Editar').click());
      await pa.waitForSelector('#f-lugar');
      assert.equal(await cuantos(pa, '#f-lugar-link:not([hidden])'), 0, 'sin link no aparece "Link de Maps cargado"');
      assert.equal(await texto(pa, 'label[for="f-lugar"]'), 'Club o cancha');
      assert.equal(await pa.$eval('#f-destino', (e) => e.closest('.campo').hidden), true, 'el pádel no tiene destino');
      await pa.select('#f-tipo', 'trekking');
      assert.equal(await texto(pa, 'label[for="f-lugar"]'), 'Punto de encuentro');
      assert.equal(await pa.$eval('#f-destino', (e) => e.closest('.campo').hidden), false, 'el trekking tiene destino');
      await pa.select('#f-tipo', 'padel');
      // pegar algo que no es de Maps queda como texto (no es un link de Maps)
      await pa.$eval('#f-lugar', (e) => { e.value = 'https://evil.com/maps'; e.dispatchEvent(new Event('input')); });
      assert.equal(await cuantos(pa, '#f-lugar-link:not([hidden])'), 0);
      // con el campo vacío, pegar lo que copia Maps deja el nombre en el campo y el link aparte
      await pa.$eval('#f-lugar', (e) => { e.value = ''; });
      await pa.$eval('#f-lugar', (e) => {
        const dt = new DataTransfer(); dt.setData('text/plain', 'Club Norte Pádel\nAv. Libertador 1234\nhttps://maps.app.goo.gl/zzPrueba1');
        e.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      });
      assert.equal(await pa.$eval('#f-lugar', (e) => e.value), 'Club Norte Pádel');
      assert.match(await texto(pa, '#f-lugar-link'), /Link de Maps cargado/);
      // "Quitar" lo saca y un link escrito a mano en el campo se separa del nombre
      await clic(pa, '#f-lugar-quitar');
      assert.equal(await cuantos(pa, '#f-lugar-link:not([hidden])'), 0);
      await pa.$eval('#f-lugar', (e) => { e.value = 'Club Norte Pádel https://maps.app.goo.gl/zzPrueba1'; e.dispatchEvent(new Event('input')); });
      assert.equal(await pa.$eval('#f-lugar', (e) => e.value), 'Club Norte Pádel');
      assert.match(await texto(pa, '#f-lugar-link'), /Link de Maps cargado/);
      await clic(pa, '#btn-guardar-act');
      await pa.waitForSelector('#maps-lugar');
      const act = db.actividades.find((x) => x.id === ACT);
      assert.equal(act.lugar, 'Club Norte Pádel');
      assert.equal(act.lugar_link, undefined, 'el link no va en actividades');
      assert.equal(db.actividades_links.find((x) => x.actividad === ACT).lugar_link, 'https://maps.app.goo.gl/zzPrueba1');
      assert.equal(act.destino, null);
      assert.equal(await pa.$eval('#maps-lugar', (e) => e.textContent), 'Cómo llegar');
      assert.equal(await pa.$eval('#maps-lugar', (e) => e.href), 'https://maps.app.goo.gl/zzPrueba1');
      assert.equal(await pa.$eval('#maps-lugar', (e) => e.target + ' ' + e.rel), '_blank noopener noreferrer');
      // Compartir: abre el menú del teléfono con el texto y el link directo a la actividad
      await pa.evaluate(() => { window.__compartido = null; navigator.share = async (d) => { window.__compartido = d; }; });
      await clic(pa, '#btn-compartir');
      await esperar(pa, () => !!window.__compartido);
      const comp = await pa.evaluate(() => window.__compartido.text);
      assert.match(comp, /^Pádel del jueves \(cambiado\)\n/);
      assert.match(comp, /\nCancha: Club Norte Pádel\nhttps:\/\/maps\.app\.goo\.gl\/zzPrueba1\n/);
      assert.match(comp, /Para anotarte, entrá acá \(así llevamos la cuenta\):\nhttps:\/\/ivanlipumacedi-maker\.github\.io\/thirdcedi-time\/#\/actividad\//);
      assert.doesNotMatch(comp, /null|undefined/);
      // B no está anotado a la actividad: no ve el link (busca por nombre); al anotarse, aparece "Cómo llegar"
      await pb.waitForSelector('#maps-lugar');
      assert.equal(await pb.$eval('#maps-lugar', (e) => e.textContent), 'Ver en Maps');
      await clic(pb, '#btn-voy');
      await esperar(pb, () => document.getElementById('maps-lugar') && document.getElementById('maps-lugar').textContent === 'Cómo llegar');
      await clic(pb, '#btn-voy'); // se baja: deja todo como estaba
      await esperar(pb, () => document.getElementById('maps-lugar') && document.getElementById('maps-lugar').textContent === 'Ver en Maps');
      await pa.$eval('#maps-lugar', (e) => e.scrollIntoView({ block: 'center' }));
      await pa.screenshot({ path: 'dev/shots/actividades-maps.png' });
      await pa.evaluate(() => [...document.querySelectorAll('#pantalla-actividades .btn-sec')].find((b) => b.textContent === 'Editar').click());
      await pa.waitForSelector('#f-lugar');
      await pa.select('#f-tipo', 'trekking');
      await pa.$eval('#f-lugar', (e) => e.scrollIntoView({ block: 'start' }));
      await pa.screenshot({ path: 'dev/shots/actividades-maps-form.png' });
      await pa.select('#f-tipo', 'padel');
      await pa.evaluate(() => document.querySelector('.form-act .volver, .form-act button').click());
      await pa.waitForSelector('#btn-voy');
    });

    await paso('punto 5: cancelada no muestra Editar ni Confirmar', async () => {
      await clic(pa, '#btn-cancelar');
      await clic(pa, '#btn-cancelar'); // segundo toque
      await esperar(pa, () => /Esta actividad fue cancelada/.test(document.getElementById('pantalla-actividades').textContent));
      assert.equal(db.actividades.find((x) => x.id === ACT).estado, 'cancelada');
      assert.equal(await pa.$$eval('#pantalla-actividades button', (bs) => bs.filter((b) => b.textContent === 'Editar').length), 0, 'muestra Editar');
      assert.equal(await cuantos(pa, '#btn-cancelar'), 0);
      assert.equal(await cuantos(pa, '#btn-reactivar'), 1, 'el creador ve Reactivar (vigente)');
      assert.equal(await cuantos(pa, '#btn-confirmar'), 0);
    });

    await paso('punto 5: B (no creador) no ve "Reactivar" en la cancelada', async () => {
      await esperar(pb, () => /Esta actividad fue cancelada/.test(document.getElementById('pantalla-actividades').textContent));
      assert.equal(await cuantos(pb, '#btn-reactivar'), 0);
      assert.doesNotMatch(await pantalla(pb), /Organizar/);
      assert.doesNotMatch(await pantalla(pb), /null|undefined/, 'la cancelada muestra "null"');
    });

    await paso('punto 5: el creador reactiva la cancelada vigente y vuelve con los mismos anotados y el chat', async () => {
      const antes = db.asistencias.filter((x) => x.actividad === ACT).length;
      assert.ok(antes >= 1);
      await clic(pa, '#btn-reactivar');
      await pa.waitForSelector('#btn-cancelar');
      await esperar(pa, () => /Actividad reactivada\. Si ya está todo listo, confirmala de nuevo\./.test(document.getElementById('toast').textContent));
      assert.equal(db.actividades.find((x) => x.id === ACT).estado, 'abierta');
      assert.equal(db.asistencias.filter((x) => x.actividad === ACT).length, antes, 'la cancelación no borró anotados');
      assert.equal(await cuantos(pa, '#btn-reactivar'), 0);
      assert.equal(await cuantos(pa, '#chat-act'), 1, 'el chat sigue');
      assert.match(await pantalla(pa), /Ana Pérez \(vos\)/);
      assert.equal(await cuantos(pa, '#btn-voy'), 1);
    });

    await paso('punto 5: una cancelada que ya pasó no muestra "Reactivar" y al creador le dice por qué', async () => {
      await volver(pa);
      await abrirTarjeta(pa, 'Asado de anteayer');
      await esperar(pa, () => /Esta actividad fue cancelada/.test(document.getElementById('pantalla-actividades').textContent));
      assert.equal(await cuantos(pa, '#btn-reactivar'), 0);
      assert.doesNotMatch(await pantalla(pa), /Organizar/);
      assert.equal(await texto(pa, '#act-no-reactivable'), 'La actividad ya empezó: no se puede reactivar.');
    });

    await paso('punto 5: si la actividad ya pasó pero el tercer tiempo no, tampoco se reactiva (cuenta la fecha de la actividad)', async () => {
      await volver(pa);
      await abrirTarjeta(pa, 'Trekking de recién');
      await esperar(pa, () => /Esta actividad fue cancelada/.test(document.getElementById('pantalla-actividades').textContent));
      assert.equal(await cuantos(pa, '#btn-reactivar'), 0);
      assert.equal(await texto(pa, '#act-no-reactivable'), 'La actividad ya empezó: no se puede reactivar.');
      // B (no creador) no ve la línea
      await volver(pb);
      await abrirTarjeta(pb, 'Trekking de recién');
      await esperar(pb, () => /Esta actividad fue cancelada/.test(document.getElementById('pantalla-actividades').textContent));
      assert.equal(await cuantos(pb, '#act-no-reactivable'), 0);
    });

    await paso('punto 5: si se cancela con el formulario abierto, el formulario pasa al aviso', async () => {
      await volver(pa);
      await abrirTarjeta(pa, 'Fútbol del viernes');
      await pa.waitForSelector('#btn-cancelar');
      await pa.evaluate(() => [...document.querySelectorAll('#pantalla-actividades .btn-sec')].find((b) => b.textContent === 'Editar').click());
      await pa.waitForSelector('#f-titulo');
      const f = db.actividades.find((x) => x.id === ACT2);
      f.estado = 'cancelada'; emitir('actividades', 'UPDATE', f); // la canceló el creador desde otro dispositivo
      await pa.waitForSelector('#act-no-editable');
      assert.equal(await cuantos(pa, 'form.form-act'), 0);
    });

    await paso('punto 5: si se cancela sin enterarse (socket caído), la base rechaza el guardado y se avisa', async () => {
      const g = db.actividades.find((x) => x.id === ACT2);
      g.estado = 'abierta'; emitir('actividades', 'UPDATE', g); // la reactivó (solo para armar el caso)
      await esperar(pa, () => !document.getElementById('act-no-editable'));
      await volver(pa); // del formulario vuelve al detalle
      await pa.waitForSelector('#btn-cancelar');
      await pa.evaluate(() => [...document.querySelectorAll('#pantalla-actividades .btn-sec')].find((b) => b.textContent === 'Editar').click());
      await pa.waitForSelector('#f-titulo');
      A.desconectada = true;
      g.estado = 'cancelada';
      await pa.$eval('#f-titulo', (e) => { e.value = 'zz no debería guardarse'; });
      await clic(pa, '#btn-guardar-act');
      await esperar(pa, () => /no se puede editar/.test(document.querySelector('form.form-act .error').textContent));
      assert.equal(g.titulo, 'Fútbol del viernes');
      A.desconectada = false;
    });

    await paso('cámara de la barra de abajo: se abre al toque y, sin actividad en curso, la foto va a "Todos"', async () => {
      // los pasos de arriba dejan la de Ana cancelada: vuelve a estar abierta (es de mañana: no está en curso)
      db.actividades.find((a) => a.id === ACT).estado = 'abierta';
      await pa.evaluate(() => Actividades.refrescar());
      await pa.evaluate(() => { location.hash = '#/juegos'; });
      await dormir(200);
      await clic(pa, '.pestana-camara');
      await esperar(pa, () => window.Camara.abierta() && /Para: Todos/.test(document.querySelector('#camara [data-c=destino]').textContent));
      assert.equal(await pa.evaluate(() => location.hash), '#/juegos', 'no tiene que salir de donde estaba');
    });

    await paso('cámara de la barra de abajo: "Para:" deja elegir una actividad anotada y vuelve a "Todos"', async () => {
      await clic(pa, '#camara [data-c=destino]');
      await pa.waitForSelector('dialog.hoja[open]', { timeout: 3000 });
      const opciones = await pa.$$eval('dialog.hoja .hoja-act strong', (xs) => xs.map((x) => x.textContent));
      assert.equal(opciones[0], 'Fotos de todos');
      const titulo = db.actividades.find((a) => a.id === ACT).titulo;
      assert.ok(opciones.includes(titulo), 'falta la actividad anotada: ' + opciones.join(' / '));
      await pa.evaluate((t) => [...document.querySelectorAll('dialog.hoja .hoja-act')].find((b) => b.textContent.includes(t)).click(), titulo);
      await esperar(pa, (t) => !document.querySelector('dialog.hoja') && document.querySelector('#camara [data-c=destino]').textContent === 'Para: ' + t, titulo);
      await clic(pa, '#camara [data-c=destino]');
      await pa.waitForSelector('dialog.hoja[open]', { timeout: 3000 });
      await pa.evaluate(() => document.querySelectorAll('dialog.hoja .hoja-act')[0].click());
      await esperar(pa, () => document.querySelector('#camara [data-c=destino]').textContent === 'Para: Todos');
      await pa.evaluate(() => window.Camara.cerrar());
      await esperar(pa, () => !window.Camara.abierta());
    });

    await paso('"Fotos de todos": se entra desde la lista y abre el álbum de todos', async () => {
      await pa.evaluate(() => { location.hash = '#/actividades'; });
      // los pasos de arriba pueden dejar abierto un detalle o el formulario: "Volver" hasta la lista
      for (let i = 0; i < 3 && !(await pa.$('#btn-fotos-todos')); i++) { await pa.evaluate(() => document.querySelector('#pantalla-actividades .btn-volver')?.click()); await dormir(200); }
      await pa.waitForSelector('#btn-fotos-todos', { timeout: 5000 });
      await clic(pa, '#btn-fotos-todos');
      await pa.waitForSelector('#album-todos');
      assert.match(await pantalla(pa), /Fotos de todos/);
      await volver(pa);
      await pa.waitForSelector('#btn-fotos-todos');
    });

    await paso('punto 2: con la pantalla cerrada (sin sesión) ni un SUBSCRIBED tardío ni volver a la app leen actividades', async () => {
      await pa.evaluate(() => App.setPerfil(null));
      await dormir(300);
      const antes = n('A:actividades:select');
      await pa.evaluate(() => { window.__estadoTodos('SUBSCRIBED'); window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); });
      await dormir(500);
      assert.equal(n('A:actividades:select'), antes, 'se leyó con la pantalla cerrada');
    });

    for (const r of paginas) if (r.page.errores.length) { fallas++; console.log('FALLA errores de página:', r.page.errores); }
  } finally { for (const b of navegadores) await b.close().catch(() => {}); }
  console.log(fallas ? fallas + ' falla(s)' : 'todo ok');
  process.exit(fallas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
