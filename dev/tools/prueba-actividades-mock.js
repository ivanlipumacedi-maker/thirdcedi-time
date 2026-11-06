// Prueba de la UI de Actividades SIN red ni usuarios reales: un Supabase falso en memoria (vive en este proceso y
// atiende a dos páginas, "ventana A" y "ventana B") con las mismas reglas que la base (07 y 10): edita solo el creador,
// una cancelada no se edita y apagar el tercer tiempo quita a sus anotados.
// Verifica: error de la primera carga con "Reintentar", resincronización al reconectar (SUBSCRIBED) con el patrón
// otraVez (una sola repetición), aviso en la página al apagar el tercer tiempo, cancelada no editable (UI y base),
// que un no-creador no ve "Organizar" y que con la pantalla cerrada no se lee nada.
// Uso: servir la raíz con `npx --yes http-server -p 8080 -c-1` y correr `node dev/tools/prueba-actividades-mock.js`
const assert = require('assert/strict');
const puppeteer = require('puppeteer-core');
const URL_APP = process.env.URL_APP || 'http://127.0.0.1:8080';

// ---------- "Servidor" en memoria ----------
const UA = '11111111-1111-4111-8111-111111111111', UB = '22222222-2222-4222-8222-222222222222';
const ACT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ACT2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', ACT3 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
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
  ],
  asistencias: [{ actividad: ACT, persona: UA, parte: 'actividad' }, { actividad: ACT, persona: UB, parte: 'tercer' }],
  mensajes: [],
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
    // trigger de la 10: una cancelada no se edita; solo se reactiva (solo estado -> 'abierta', creador, vigente)
    const fin = (a) => Math.max(Date.parse(a.fecha), a.tiene_tercer && a.tercer_fecha ? Date.parse(a.tercer_fecha) : -Infinity);
    for (const f of filas) {
      if (f.estado !== 'cancelada') continue;
      const soloEstado = Object.keys(s.values).every((k) => k === 'estado' || s.values[k] === f[k]) && s.values.estado === 'abierta';
      if (!soloEstado) return P0001('La actividad está cancelada');
      if (!(fin(f) > Date.now())) return P0001('La actividad ya pasó: no se puede reactivar');
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
  let filas = db[s.table] || [];
  if (s.table === 'mensajes') filas = filas.filter((m) => enSala(uid, m.sala));
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
      assert.equal(await cuantos(pa, '.tarjeta-act'), 3);
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
    });

    await paso('punto 4: una edición que no apaga el tercer tiempo no muestra el aviso', async () => {
      await pa.evaluate(() => [...document.querySelectorAll('#pantalla-actividades .btn-sec')].find((b) => b.textContent === 'Editar').click());
      await pa.waitForSelector('#f-titulo');
      await pa.$eval('#f-titulo', (e) => { e.value = 'Pádel del jueves (cambiado)'; });
      await clic(pa, '#btn-guardar-act');
      await pa.waitForSelector('#btn-voy');
      assert.equal(db.actividades.find((x) => x.id === ACT).titulo, 'Pádel del jueves (cambiado)');
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
    });

    await paso('punto 5: el creador reactiva la cancelada vigente y vuelve con los mismos anotados y el chat', async () => {
      const antes = db.asistencias.filter((x) => x.actividad === ACT).length;
      assert.ok(antes >= 1);
      await clic(pa, '#btn-reactivar');
      await pa.waitForSelector('#btn-cancelar');
      assert.equal(db.actividades.find((x) => x.id === ACT).estado, 'abierta');
      assert.equal(db.asistencias.filter((x) => x.actividad === ACT).length, antes, 'la cancelación no borró anotados');
      assert.equal(await cuantos(pa, '#btn-reactivar'), 0);
      assert.equal(await cuantos(pa, '#chat-act'), 1, 'el chat sigue');
      assert.match(await pantalla(pa), /Ana Pérez \(vos\)/);
      assert.equal(await cuantos(pa, '#btn-voy'), 1);
    });

    await paso('punto 5: una cancelada que ya pasó no muestra "Reactivar"', async () => {
      await volver(pa);
      await abrirTarjeta(pa, 'Asado de anteayer');
      await esperar(pa, () => /Esta actividad fue cancelada/.test(document.getElementById('pantalla-actividades').textContent));
      assert.equal(await cuantos(pa, '#btn-reactivar'), 0);
      assert.doesNotMatch(await pantalla(pa), /Organizar/);
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
