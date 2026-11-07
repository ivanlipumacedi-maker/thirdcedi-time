// Prueba de la UI de Cuentas claras SIN red ni usuarios reales: un Supabase falso en memoria (vive en este proceso y
// atiende a dos páginas, "ventana A" y "ventana B") con las mismas reglas que la base (07, 10 y 11): cargar_gasto valida
// anotados, cancelada y tercer tiempo; ver las cuentas = en_cuentas (anotado o figura); pagos los registra el deudor o
// el acreedor; borrar solo lo propio; apagar el tercer tiempo con gastos de 'tercer' se rechaza.
// Verifica: error de la primera carga con "Reintentar", carga de un gasto con reparto (1000 entre 3), transferencias,
// "Ya pagué" / "Me pagó" con confirmación en la página (sin confirm()), en vivo entre ventanas, bloqueo de apagar el
// tercer tiempo, que quien se bajó sigue viendo su deuda y la puede pagar, cancelada (sin gastos nuevos, con pagos),
// resincronización al reconectar y que con la sección cerrada no se lee nada.
// Uso: servir la raíz con `npx --yes http-server -p 8080 -c-1` y correr `node dev/tools/prueba-cuentas-mock.js`
const assert = require('assert/strict');
const puppeteer = require('puppeteer-core');
const URL_APP = process.env.URL_APP || 'http://127.0.0.1:8080';

// ---------- "Servidor" en memoria ----------
const UA = '11111111-1111-4111-8111-111111111111', UB = '22222222-2222-4222-8222-222222222222', UC = '33333333-3333-4333-8333-333333333333';
const ACT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', OTRA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ahora = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const actividad = (id, titulo, extra) => ({ id, creador: UA, tipo: 'asado', tipo_otro: null, titulo, fecha: iso(ahora + 864e5), lugar: 'Quincho', cupo: null, descripcion: '', tiene_tercer: false, tercer_lugar: null, tercer_fecha: null, estado: 'abierta', creado: iso(ahora - 1e6), ...extra });
const db = {
  perfiles: [
    { id: UA, nombre: 'Ana Pérez', foto: null, empresa: 'CEDI' },
    { id: UB, nombre: 'Beto Gómez', foto: null, empresa: 'Wemox' },
    { id: UC, nombre: 'Carla Ruiz', foto: null, empresa: 'Korex' },
  ],
  actividades: [
    actividad(ACT, 'Asado del viernes', { tiene_tercer: true, tercer_lugar: 'Bar', tercer_fecha: iso(ahora + 864e5 + 72e5) }),
    actividad(OTRA, 'Fútbol sin cuentas', { tipo: 'futbol' }),
  ],
  // B solo a la actividad; A y C a las dos partes
  asistencias: [
    { actividad: ACT, persona: UA, parte: 'actividad' }, { actividad: ACT, persona: UB, parte: 'actividad' }, { actividad: ACT, persona: UC, parte: 'actividad' },
    { actividad: ACT, persona: UA, parte: 'tercer' }, { actividad: ACT, persona: UC, parte: 'tercer' },
  ],
  mensajes: [], gastos: [], gasto_partes: [], pagos: [],
};
const paginas = []; // { page, uid, desconectada }
const cuenta = {};
const letra = (uid) => (uid === UA ? 'A' : uid === UB ? 'B' : 'C');
const contar = (uid, k) => { const c = letra(uid) + ':' + k; cuenta[c] = (cuenta[c] || 0) + 1; };
const n = (k) => cuenta[k] || 0;
let fallarGastosA = 0; // cuántas lecturas de gastos de A fallan (error de la primera carga)
let fallarGastosB = 0; // ídem para B
let nid = 0;
const nuevoId = () => 'f0000000-0000-4000-8000-' + String(++nid).padStart(12, '0');

const enSala = (uid, sala) => { const m = /^act:(.+)$/.exec(sala || ''); return !!m && db.asistencias.some((a) => a.actividad === m[1] && a.persona === uid); };
const anotadoA = (act, uid, parte) => db.asistencias.some((a) => a.actividad === act && a.persona === uid && a.parte === parte);
const figura = (act, uid) => db.gastos.some((g) => g.actividad === act && (g.pagador === uid || db.gasto_partes.some((p) => p.gasto === g.id && p.persona === uid)))
  || db.pagos.some((p) => p.actividad === act && (p.de === uid || p.a === uid));
const figuraEnParte = (act, parte, uid) => db.gastos.some((g) => g.actividad === act && g.parte === parte && (g.pagador === uid || db.gasto_partes.some((p) => p.gasto === g.id && p.persona === uid)))
  || db.pagos.some((p) => p.actividad === act && p.parte === parte && (p.de === uid || p.a === uid));
const enCuentas = (uid, act) => enSala(uid, 'act:' + act) || figura(act, uid);

function emitir(tabla, evento, fila) {
  for (const p of paginas) {
    if (p.desconectada) continue;
    p.page.evaluate((t, e, f) => window.__emitir(t, e, f), tabla, evento, fila).catch(() => {});
  }
}
const cumple = (fila, filtros) => filtros.every(([op, col, v]) => (op === 'eq' ? fila[col] === v : op === 'in' ? v.includes(fila[col]) : true));
const P0001 = (message) => ({ error: { code: 'P0001', message } });

function cargarGasto(uid, v) {
  const a = db.actividades.find((x) => x.id === v.p_actividad);
  if (!a) return P0001('La actividad no existe');
  if (!enSala(uid, 'act:' + a.id)) return { error: { code: '42501', message: 'Solo los anotados pueden cargar gastos' } };
  if (a.estado === 'cancelada') return P0001('La actividad está cancelada: no se cargan gastos nuevos');
  if (v.p_parte === 'tercer' && !a.tiene_tercer) return P0001('La actividad no tiene tercer tiempo');
  if (!Number.isInteger(v.p_monto) || v.p_monto < 1 || v.p_monto > 1e8) return P0001('El monto tiene que ser en pesos enteros, de 1 a 100.000.000');
  if (!String(v.p_concepto || '').trim()) return P0001('El concepto tiene que tener entre 1 y 80 letras');
  const personas = [...new Set(v.p_personas || [])];
  if (!personas.length) return P0001('Elegí entre quiénes se divide');
  if (!anotadoA(a.id, v.p_pagador, v.p_parte)) return P0001('Quien pagó tiene que estar anotado a esa parte');
  if (personas.some((p) => !anotadoA(a.id, p, v.p_parte))) return P0001('Solo se puede dividir entre los anotados a esa parte');
  const g = { id: nuevoId(), actividad: a.id, parte: v.p_parte, pagador: v.p_pagador, monto: v.p_monto, concepto: v.p_concepto.trim(), creado: new Date().toISOString(), cargado_por: uid };
  db.gastos.push(g);
  personas.forEach((p) => db.gasto_partes.push({ gasto: g.id, persona: p }));
  emitir('gastos', 'INSERT', g);
  return { data: { ...g } };
}

function consulta(uid, s) {
  contar(uid, s.table + ':' + s.action);
  if (s.action === 'rpc') {
    if (s.table === 'cargar_gasto') return cargarGasto(uid, s.values);
    return { error: { message: 'sin rpc' } };
  }
  if (s.table === 'gastos' && s.action === 'select' && uid === UA && fallarGastosA > 0) { fallarGastosA--; return { error: { message: 'sin red' } }; }
  if (s.table === 'gastos' && s.action === 'select' && uid === UB && fallarGastosB > 0) { fallarGastosB--; return { error: { message: 'sin red' } }; }
  if (s.table === 'actividades' && s.action === 'update') {
    const filas = db.actividades.filter((f) => cumple(f, s.filtros) && f.creador === uid);
    for (const f of filas) {
      if (f.estado === 'cancelada') return P0001('La actividad está cancelada');
      // trigger actividades_tercer_con_cuentas (11)
      if (f.tiene_tercer && s.values.tiene_tercer === false) {
        if (db.gastos.some((g) => g.actividad === f.id && g.parte === 'tercer')) return P0001('El tercer tiempo tiene gastos cargados: pedile a quien los cargó que los borre antes de sacarlo');
        if (db.pagos.some((p) => p.actividad === f.id && p.parte === 'tercer')) return P0001('El tercer tiempo tiene pagos registrados: pedile a quien los registró que los borre antes de sacarlo');
      }
    }
    const out = filas.map((f) => {
      const antes = { ...f };
      Object.assign(f, s.values);
      if (antes.tiene_tercer && !f.tiene_tercer) {
        db.asistencias.filter((x) => x.actividad === f.id && x.parte === 'tercer').forEach((x) => emitir('asistencias', 'DELETE', x));
        db.asistencias = db.asistencias.filter((x) => !(x.actividad === f.id && x.parte === 'tercer'));
      }
      emitir('actividades', 'UPDATE', f);
      return { ...f };
    });
    if (s.single) return out.length ? { data: out[0] } : { error: { code: 'PGRST116', message: '0 filas' } };
    return { data: out };
  }
  if (s.table === 'asistencias' && s.action === 'insert') {
    const f = { actividad: s.values.actividad, persona: uid, parte: s.values.parte };
    db.asistencias.push(f); emitir('asistencias', 'INSERT', f);
    return { data: f };
  }
  if (s.table === 'asistencias' && s.action === 'delete') {
    const fuera = db.asistencias.filter((f) => cumple(f, s.filtros) && f.persona === uid);
    db.asistencias = db.asistencias.filter((f) => !fuera.includes(f));
    fuera.forEach((f) => emitir('asistencias', 'DELETE', f));
    return { data: fuera };
  }
  if (s.table === 'pagos' && s.action === 'insert') {
    const v = s.values;
    if (!enCuentas(uid, v.actividad) || !(v.de === uid || v.a === uid) || v.de === v.a || !(v.monto >= 1)) return { error: { code: '42501', message: 'new row violates row-level security policy' } };
    if (!figuraEnParte(v.actividad, v.parte, v.de) || !figuraEnParte(v.actividad, v.parte, v.a)) return P0001('Esa persona no figura en las cuentas de esa parte');
    if (db.pagos.some((p) => p.actividad === v.actividad && p.parte === v.parte && p.de === v.de && p.a === v.a && p.monto === v.monto && Date.now() - Date.parse(p.creado) < 6e5)) return P0001('Ese pago ya está registrado');
    const p = { id: nuevoId(), ...v, creado: new Date().toISOString(), cargado_por: uid };
    db.pagos.push(p); emitir('pagos', 'INSERT', p);
    return { data: null };
  }
  if ((s.table === 'gastos' || s.table === 'pagos') && s.action === 'delete') {
    // 20: un gasto lo borra quien lo cargó, quien pagó o quien está en el reparto; un pago, quien lo cargó o la otra parte
    const puede = (f) => f.cargado_por === uid || (s.table === 'gastos'
      ? f.pagador === uid || db.gasto_partes.some((p) => p.gasto === f.id && p.persona === uid)
      : f.de === uid || f.a === uid);
    const fuera = db[s.table].filter((f) => cumple(f, s.filtros) && puede(f));
    db[s.table] = db[s.table].filter((f) => !fuera.includes(f));
    if (s.table === 'gastos') db.gasto_partes = db.gasto_partes.filter((p) => !fuera.some((g) => g.id === p.gasto));
    fuera.forEach((f) => emitir(s.table, 'DELETE', { id: f.id })); // Realtime: los DELETE solo traen la clave
    return { data: null };
  }
  let filas = db[s.table] || [];
  if (s.table === 'mensajes') filas = filas.filter((m) => enSala(uid, m.sala));
  if (s.table === 'gastos' || s.table === 'pagos') filas = filas.filter((f) => enCuentas(uid, f.actividad));
  if (s.table === 'gasto_partes') filas = filas.filter((p) => { const g = db.gastos.find((x) => x.id === p.gasto); return g && enCuentas(uid, g.actividad); });
  let r = filas.filter((f) => cumple(f, s.filtros));
  if (s.ordenes.length) r = [...r].sort((a, b) => { for (const o of s.ordenes) { if (a[o.col] !== b[o.col]) return (a[o.col] < b[o.col] ? -1 : 1) * (o.asc ? 1 : -1); } return 0; });
  if (s.limite) r = r.slice(0, s.limite);
  return { data: s.single ? r[0] || null : r.map((x) => ({ ...x })) };
}

// ---------- Cliente falso que se inyecta en lugar de vendor/supabase.js ----------
const STUB = `
(function () {
  const Q = (spec) => window.__q(JSON.stringify(spec)).then((r) => JSON.parse(r));
  const forma = (r) => ({ data: r.data === undefined ? null : r.data, error: r.error || null });
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
      then(res, rej) { return Q(s).then(forma).then(res, rej); },
    };
    return b;
  }
  const canales = new Set();
  const todos = [];
  window.__canales = () => [...canales].map((c) => c.topic);
  window.__emitir = (tabla, evento, fila) => canales.forEach((c) => c.cbs.filter((x) => x.tabla === tabla && (x.evento === '*' || x.evento === evento)).forEach((x) => x.fn({ eventType: evento, new: evento === 'DELETE' ? {} : fila, old: fila })));
  window.__estadoCanales = (st) => canales.forEach((c) => c.estado && c.estado(st));
  window.__estadoTodos = (st) => todos.forEach((c) => c.estado && c.estado(st));
  window.supabase = { createClient() {
    return {
      from: Builder,
      rpc(nombre, args) { return Q({ table: nombre, action: 'rpc', values: args, filtros: [], ordenes: [] }).then(forma); },
      channel(topic) {
        const c = { topic, cbs: [], on(_t, f, fn) { c.cbs.push({ tabla: f.table, evento: f.event, filtro: f.filter, fn }); return c; }, subscribe(cb) { c.estado = cb; canales.add(c); todos.push(c); if (cb) setTimeout(() => cb('SUBSCRIBED'), 0); return c; } };
        return c;
      },
      removeChannel(c) { canales.delete(c); },
      storage: { from() { return { upload: async (p) => ({ data: { path: p }, error: null }), remove: async () => ({ data: [], error: null }), createSignedUrls: async () => ({ data: [], error: null }) }; } },
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}), getUser: async () => ({ data: { user: null } }) },
    };
  } };
})();`;

const navegadores = [];
async function abrir(uid) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  navegadores.push(browser);
  const page = await browser.newPage();
  const reg = { page, uid, desconectada: false };
  paginas.push(reg);
  page.errores = [];
  page.on('pageerror', (e) => page.errores.push(e.message));
  if (process.env.DEPURAR) page.on('console', (m) => console.log('[' + letra(uid) + ']', m.text()));
  await page.exposeFunction('__q', async (j) => JSON.stringify(consulta(uid, JSON.parse(j))));
  // confirm() del navegador está prohibido: si alguien lo llama, queda marcado
  await page.evaluateOnNewDocument(() => { window.__confirmUsado = 0; window.confirm = () => { window.__confirmUsado++; return true; }; });
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  page.on('request', (rq) => {
    if (rq.url().endsWith('/vendor/supabase.js')) rq.respond({ status: 200, contentType: 'application/javascript', body: STUB });
    else if (/fonts\.(googleapis|gstatic)\.com/.test(rq.url())) rq.respond({ status: 200, contentType: 'text/css', body: '' });
    else rq.continue();
  });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto(URL_APP, { waitUntil: 'networkidle0' });
  await page.evaluate((p) => { App.modoAcceso(false); App.setPerfil(p); }, db.perfiles.find((p) => p.id === uid));
  await page.waitForSelector('.tarjeta-act', { timeout: 8000 });
  return reg;
}
const texto = (p, sel) => p.$eval(sel, (e) => e.textContent);
const clic = (p, sel) => p.$eval(sel, (e) => e.click());
const cuantos = (p, sel) => p.$$eval(sel, (e) => e.length);
const esperar = (p, fn, ...a) => p.waitForFunction(fn, { timeout: 6000 }, ...a);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const cuentasTxt = (p) => p.$eval('#cuentas-act', (e) => (e.hidden ? '[oculta]' : e.textContent)).catch(() => '[sin sección]');
const pantalla = (p) => texto(p, '#pantalla-actividades');
const abrirTarjeta = (p, titulo) => p.evaluate((t) => [...document.querySelectorAll('.tarjeta-act')].find((e) => e.textContent.includes(t)).click(), titulo);
const volver = (p) => p.evaluate(() => document.querySelector('#pantalla-actividades .btn-link').click());
const enCuentasHay = (p, re) => esperar(p, (r) => { const e = document.getElementById('cuentas-act'); return !!e && !e.hidden && new RegExp(r).test(e.textContent); }, re.source);
const NB = '\u00a0';
const pes = (s) => s.replace(/\$ /g, '$' + NB); // en el texto "$ 3.200" lleva un espacio que no corta

async function cargarGastoUI(p, { monto, concepto, pagador, sacar = [] }) {
  await clic(p, '#cu-nuevo');
  await p.waitForSelector('#cu-form');
  if (pagador) await p.select('#cu-pagador', pagador);
  await p.$eval('#cu-monto', (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, monto);
  await p.$eval('#cu-concepto', (e, v) => { e.value = v; }, concepto);
  for (const id of sacar) await p.$eval('#cu-p-' + id, (e) => { e.click(); });
  await clic(p, '#cu-guardar');
}

(async () => {
  let fallas = 0;
  const paso = async (nombre, fn) => { try { await fn(); console.log('ok', nombre); } catch (e) { fallas++; console.log('FALLA', nombre, '-', e.message); } };
  try {
    const A = await abrir(UA); const pa = A.page;
    const B = await abrir(UB); const pb = B.page;

    await paso('si falla la primera carga de las cuentas: error con Reintentar, y recupera', async () => {
      fallarGastosA = 5; // la inicial y la repetición por SUBSCRIBED
      await abrirTarjeta(pa, 'Asado del viernes');
      await pa.waitForSelector('#cu-reintentar', { timeout: 6000 });
      assert.match(await cuentasTxt(pa), /No pudimos cargar las cuentas/);
      fallarGastosA = 0;
      await clic(pa, '#cu-reintentar');
      await enCuentasHay(pa, /Todavía no hay gastos cargados/);
      assert.equal(await cuantos(pa, '#cu-parte-tercer'), 1, 'con tercer tiempo hay selector');
    });

    await paso('el formulario: por defecto pagó vos y se divide entre todos los anotados a esa parte', async () => {
      await clic(pa, '#cu-nuevo');
      await pa.waitForSelector('#cu-form');
      assert.equal(await pa.evaluate(() => document.activeElement && document.activeElement.id), 'cu-monto', 'el foco va al monto');
      assert.equal(await pa.$eval('#cu-pagador', (e) => e.value), UA);
      assert.deepEqual(await pa.$$eval('#cu-entre input:checked', (es) => es.map((e) => e.value).sort()), [UA, UB, UC]);
      // validación: con centavos no se manda nada
      const antes = n('A:cargar_gasto:rpc');
      await pa.$eval('#cu-monto', (e) => { e.value = '12,50'; e.dispatchEvent(new Event('input', { bubbles: true })); });
      await pa.$eval('#cu-concepto', (e) => { e.value = 'Carne'; });
      await clic(pa, '#cu-guardar');
      assert.match(await texto(pa, '#cu-error'), /sin centavos/);
      assert.equal(n('A:cargar_gasto:rpc'), antes);
      await clic(pa, '#cu-cerrar');
      assert.equal(await pa.evaluate(() => document.activeElement && document.activeElement.id), 'cu-nuevo');
    });

    await paso('Review Focus 2: A carga $ 1.000 entre 3 → te deben $ 666; B ve en vivo que debe $ 333', async () => {
      await abrirTarjeta(pb, 'Asado del viernes');
      await enCuentasHay(pb, /Todavía no hay gastos cargados/);
      await clic(pa, '#cu-nuevo');
      await pa.waitForSelector('#cu-form');
      await pa.$eval('#cu-monto', (e) => { e.value = '$ 1.000'; e.dispatchEvent(new Event('input', { bubbles: true })); });
      assert.match(await texto(pa, '#cu-reparto'), new RegExp(pes('Le toca \\$ 333 a cada uno \\(a algunos \\$ 334')));
      await pa.$eval('#cu-concepto', (e) => { e.value = 'Carne'; });
      await clic(pa, '#cu-guardar');
      await enCuentasHay(pa, new RegExp(pes('Te deben \\$ 666')));
      assert.equal(db.gastos.length, 1);
      assert.equal(db.gastos[0].monto, 1000);
      assert.equal(db.gasto_partes.length, 3);
      const trans = await pa.$$eval('#cu-transferencias li', (ls) => ls.map((l) => l.querySelector('.cu-txt').textContent));
      assert.deepEqual(trans, [pes('Beto Gómez te debe $ 333'), pes('Carla Ruiz te debe $ 333')]);
      assert.equal(await cuantos(pa, '#cu-transferencias .cu-pagar'), 2, 'A ve "Me pagó" en las dos');
      assert.equal(await pa.$eval('#cu-transferencias .cu-pagar', (e) => e.textContent), 'Me pagó');
      await enCuentasHay(pb, new RegExp(pes('Debés \\$ 333')));
      const tb = await pb.$$eval('#cu-transferencias li', (ls) => ls.map((l) => [l.querySelector('.cu-txt').textContent, l.querySelectorAll('.cu-pagar').length]));
      assert.deepEqual(tb, [[pes('Le debés $ 333 a Ana Pérez'), 1], [pes('Carla Ruiz le debe $ 333 a Ana Pérez'), 0]]);
      assert.match(await cuentasTxt(pb), /Carne/);
      assert.match(await cuentasTxt(pb), /Pagó Ana Pérez, entre 3 personas/);
      // B está en el reparto: puede objetarlo (20), con otro texto que el de quien lo cargó
      assert.equal(await pb.$eval('#cu-gastos .cu-borrar', (e) => e.textContent), 'No lo reconozco');
      assert.equal(await pa.$eval('#cu-gastos .cu-borrar', (e) => e.textContent), 'Borrar');
    });

    await paso('"Ya pagué" y "Me pagó" dicen a quién y cuánto (aria-label)', async () => {
      assert.equal(await pb.$eval('#cu-transferencias .cu-pagar', (e) => e.getAttribute('aria-label')), pes('Ya le pagué $ 333 a Ana Pérez'));
      assert.deepEqual(await pa.$$eval('#cu-transferencias .cu-pagar', (es) => es.map((e) => e.getAttribute('aria-label'))), [pes('Beto Gómez me pagó $ 333'), pes('Carla Ruiz me pagó $ 333')]);
    });

    await paso('un repintado en vivo no le saca el foco a un botón (se rehace, pero el foco vuelve)', async () => {
      await pb.focus('#cu-transferencias .cu-pagar');
      const antes = n('B:gastos:select');
      emitir('gastos', 'INSERT', { id: nuevoId(), actividad: ACT }); // fuerza una relectura (no cambia nada)
      for (let i = 0; i < 30 && n('B:gastos:select') === antes; i++) await dormir(50);
      await dormir(300);
      assert.ok(n('B:gastos:select') > antes, 'no releyó');
      assert.equal(await pb.evaluate(() => !!document.activeElement && document.activeElement.classList.contains('cu-pagar')), true,
        'el foco quedó en ' + await pb.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName)));
      // también en el selector de parte
      await pa.focus('#cu-parte-actividad');
      emitir('gastos', 'INSERT', { id: nuevoId(), actividad: ACT });
      await dormir(500);
      assert.equal(await pa.evaluate(() => document.activeElement && document.activeElement.id), 'cu-parte-actividad');
    });

    await paso('si el monto cambia en vivo con la confirmación abierta, la confirmación vieja se cierra', async () => {
      await clic(pb, '#cu-transferencias .cu-pagar');
      await pb.waitForSelector('#cu-confirmar-si');
      assert.match(await texto(pb, '#cu-confirmar-txt'), new RegExp(pes('\\$ 333')));
      const g = { id: nuevoId(), actividad: ACT, parte: 'actividad', pagador: UA, monto: 300, concepto: 'Pan', creado: new Date().toISOString(), cargado_por: UA };
      db.gastos.push(g); [UA, UB].forEach((p) => db.gasto_partes.push({ gasto: g.id, persona: p }));
      emitir('gastos', 'INSERT', g);
      await enCuentasHay(pb, new RegExp(pes('Le debés \\$ 483 a Ana Pérez')));
      assert.equal(await cuantos(pb, '#cu-confirmar-si'), 0, 'quedó abierta la confirmación de $ 333');
      db.gastos = db.gastos.filter((x) => x !== g); db.gasto_partes = db.gasto_partes.filter((p) => p.gasto !== g.id);
      emitir('gastos', 'DELETE', { id: g.id });
      await enCuentasHay(pb, new RegExp(pes('Le debés \\$ 333 a Ana Pérez')));
    });

    await paso('"Ya pagué" pide confirmación en la página (foco en "No"); "No" no registra; "Sí" registra y A lo ve en vivo', async () => {
      await clic(pb, '#cu-transferencias .cu-pagar');
      await pb.waitForSelector('#cu-confirmar-no');
      assert.match(await texto(pb, '#cu-confirmar-txt'), new RegExp(pes('¿Ya le pagaste \\$ 333 a Ana Pérez\\?')));
      assert.equal(await pb.evaluate(() => document.activeElement && document.activeElement.id), 'cu-confirmar-no');
      await clic(pb, '#cu-confirmar-no');
      assert.equal(db.pagos.length, 0);
      assert.equal(await cuantos(pb, '#cu-confirmar-si'), 0);
      assert.equal(await pb.evaluate(() => document.activeElement && document.activeElement.classList.contains('cu-pagar')), true, 'el foco vuelve al botón');
      await clic(pb, '#cu-transferencias .cu-pagar');
      await pb.waitForSelector('#cu-confirmar-si');
      await clic(pb, '#cu-confirmar-si');
      await enCuentasHay(pb, /Estás al día/);
      assert.deepEqual(db.pagos.map((p) => [p.de, p.a, p.monto, p.parte]), [[UB, UA, 333, 'actividad']]);
      await enCuentasHay(pa, new RegExp(pes('Te deben \\$ 333')));
      assert.deepEqual(await pa.$$eval('#cu-transferencias li .cu-txt', (ls) => ls.map((l) => l.textContent)), [pes('Carla Ruiz te debe $ 333')]);
      assert.match(await cuentasTxt(pa), new RegExp(pes('Beto Gómez te pagó \\$ 333')));
      assert.equal(await pb.evaluate(() => window.__confirmUsado), 0, 'se usó confirm()');
    });

    await paso('"Me pagó": el acreedor registra el pago de quien no tiene ventana abierta', async () => {
      await clic(pa, '#cu-transferencias .cu-pagar');
      await pa.waitForSelector('#cu-confirmar-si');
      assert.match(await texto(pa, '#cu-confirmar-txt'), new RegExp(pes('¿Carla Ruiz te pagó \\$ 333\\?')));
      await clic(pa, '#cu-confirmar-si');
      await enCuentasHay(pa, /Estás al día/);
      await enCuentasHay(pa, /Están todos a mano/);
      assert.equal(db.pagos.length, 2);
    });

    await paso('borrar un gasto cuando ya hay pagos: la confirmación avisa que hay que revisarlos', async () => {
      await clic(pa, '#cu-gastos .cu-borrar');
      await pa.waitForSelector('#cu-confirmar-txt');
      assert.match(await texto(pa, '#cu-confirmar-txt'), /Ya hay pagos registrados: revisalos después\./);
      await clic(pa, '#cu-confirmar-no');
      assert.equal(db.gastos.length, 1);
    });

    await paso('pagar dos veces lo mismo (los dos a la vez): la base lo rechaza con el motivo', async () => {
      const r = consulta(UB, { table: 'pagos', action: 'insert', values: { actividad: ACT, parte: 'actividad', de: UB, a: UA, monto: 333 }, filtros: [], ordenes: [] });
      assert.match(r.error.message, /Ese pago ya está registrado/);
    });

    await paso('20: "No lo reconozco" en pagos: la otra parte lo ve y la confirmación dice quién lo registró; un tercero no', async () => {
      const botones = (p) => p.$$eval('#cu-pagos li', (ls) => ls.map((l) => [l.querySelector('.cu-txt').textContent, (l.querySelector('button') || {}).textContent || null]));
      assert.deepEqual(await botones(pa), [[pes('Carla Ruiz te pagó $ 333'), 'Borrar'], [pes('Beto Gómez te pagó $ 333'), 'No lo reconozco']]);
      // B: el suyo lo borra; en uno entre otros dos (si lo ve) no tiene botón
      const deB = await botones(pb);
      assert.deepEqual(deB.find((x) => x[0] === pes('Le pagaste $ 333 a Ana Pérez')), [pes('Le pagaste $ 333 a Ana Pérez'), 'Borrar']);
      assert.ok(deB.filter((x) => x[0] !== pes('Le pagaste $ 333 a Ana Pérez')).every((x) => x[1] === null), JSON.stringify(deB));
      await pa.evaluate(() => [...document.querySelectorAll('#cu-pagos li')].find((l) => l.textContent.includes('Beto')).querySelector('button').click());
      await pa.waitForSelector('#cu-confirmar-txt');
      assert.equal(await texto(pa, '#cu-confirmar-txt'), '¿Borrar este pago? Lo registró Beto Gómez. La deuda vuelve a aparecer.');
      await clic(pa, '#cu-confirmar-no');
      assert.equal(db.pagos.length, 2);
    });

    await paso('20: B borra un gasto que cargó A y en el que está ("Lo cargó Ana Pérez"); en uno ajeno no tiene el botón', async () => {
      await cargarGastoUI(pa, { monto: '90', concepto: 'Agua', sacar: [UB] }); // entre A y C
      await enCuentasHay(pa, /Agua/);
      await pa.waitForSelector('#cu-nuevo');
      await cargarGastoUI(pa, { monto: '80', concepto: 'Soda', sacar: [UC] }); // entre A y B
      await enCuentasHay(pb, /Soda/);
      await enCuentasHay(pb, /Agua/);
      const boton = (p, c) => p.evaluate((c) => { const l = [...document.querySelectorAll('#cu-gastos li')].find((x) => x.textContent.includes(c)); const b = l && l.querySelector('button'); return b ? b.textContent : null; }, c);
      assert.equal(await boton(pb, 'Agua'), null, 'B no está en el gasto "Agua" y tiene el botón');
      assert.equal(await boton(pb, 'Soda'), 'No lo reconozco');
      // la base tampoco lo deja (aunque mande el pedido igual)
      consulta(UB, { table: 'gastos', action: 'delete', filtros: [['eq', 'id', db.gastos.find((g) => g.concepto === 'Agua').id]], ordenes: [] });
      assert.ok(db.gastos.some((g) => g.concepto === 'Agua'), 'B borró un gasto en el que no está');
      await pb.evaluate(() => [...document.querySelectorAll('#cu-gastos li')].find((x) => x.textContent.includes('Soda')).querySelector('button').click());
      await pb.waitForSelector('#cu-confirmar-txt');
      assert.match(await texto(pb, '#cu-confirmar-txt'), new RegExp('^' + pes('¿Borrar el gasto "Soda" de \\$ 80\\? Lo cargó Ana Pérez\\. Las cuentas se recalculan\\.')));
      await clic(pb, '#cu-confirmar-si');
      await esperar(pb, () => !/Soda/.test(document.getElementById('cu-gastos').textContent));
      assert.equal(db.gastos.some((g) => g.concepto === 'Soda'), false);
      await esperar(pa, () => !/Soda/.test(document.getElementById('cu-gastos').textContent));
      // A borra el suyo ("Agua") y queda todo como antes
      await pa.evaluate(() => [...document.querySelectorAll('#cu-gastos li')].find((x) => x.textContent.includes('Agua')).querySelector('button').click());
      await pa.waitForSelector('#cu-confirmar-si');
      await clic(pa, '#cu-confirmar-si');
      await esperar(pa, () => !/Agua/.test(document.getElementById('cu-gastos').textContent));
      await enCuentasHay(pa, /Estás al día/);
    });

    await paso('tercer tiempo: sus propias cuentas, entre los anotados al tercer tiempo (B no está)', async () => {
      await clic(pa, '#cu-parte-tercer');
      assert.equal(await pa.$eval('#cu-parte-tercer', (e) => e.getAttribute('aria-pressed')), 'true');
      await enCuentasHay(pa, /Todavía no hay gastos del tercer tiempo/);
      await clic(pa, '#cu-nuevo');
      await pa.waitForSelector('#cu-form');
      assert.deepEqual(await pa.$$eval('#cu-entre input', (es) => es.map((e) => e.value).sort()), [UA, UC]);
      await pa.$eval('#cu-monto', (e) => { e.value = '3200'; e.dispatchEvent(new Event('input', { bubbles: true })); });
      await pa.$eval('#cu-concepto', (e) => { e.value = 'Cerveza'; });
      await clic(pa, '#cu-guardar');
      await enCuentasHay(pa, new RegExp(pes('Te deben \\$ 1.600')));
      assert.equal(db.gastos.find((g) => g.concepto === 'Cerveza').parte, 'tercer');
      await clic(pa, '#cu-parte-actividad');
      await enCuentasHay(pa, /Estás al día/);
    });

    await paso('apagar el tercer tiempo con gastos cargados: la base lo rechaza y el formulario lo explica (no se apaga en silencio)', async () => {
      await pa.evaluate(() => [...document.querySelectorAll('#pantalla-actividades .btn-sec')].find((b) => b.textContent === 'Editar').click());
      await pa.waitForSelector('#f-tercer');
      await clic(pa, '#f-tercer');
      await clic(pa, '#btn-guardar-act');
      await pa.waitForSelector('#aviso-tercer:not([hidden])');
      await clic(pa, '#btn-confirmar-tercer');
      await esperar(pa, () => /El tercer tiempo tiene gastos cargados: pedile a quien los cargó que los borre antes de sacarlo/.test((document.querySelector('form.form-act .error') || {}).textContent || ''));
      assert.equal(await pa.$eval('form.form-act .error', (e) => e.hidden), false);
      assert.equal(await pa.$eval('#f-tercer', (e) => e.checked), true, 'el switch vuelve a prendido');
      const a = db.actividades.find((x) => x.id === ACT);
      assert.equal(a.tiene_tercer, true);
      assert.equal(db.asistencias.filter((x) => x.actividad === ACT && x.parte === 'tercer').length, 2, 'no se quitó a nadie');
      await volver(pa);
      await pa.waitForSelector('#cuentas-act');
    });

    await paso('borrar un gasto propio con confirmación en la página', async () => {
      await clic(pa, '#cu-parte-tercer');
      await pa.waitForSelector('#cu-gastos .cu-borrar');
      await clic(pa, '#cu-gastos .cu-borrar');
      await pa.waitForSelector('#cu-confirmar-si');
      assert.match(await texto(pa, '#cu-confirmar-txt'), /Cerveza/);
      await clic(pa, '#cu-confirmar-si');
      await enCuentasHay(pa, /Todavía no hay gastos del tercer tiempo/);
      assert.equal(db.gastos.some((g) => g.concepto === 'Cerveza'), false);
      await clic(pa, '#cu-parte-actividad');
    });

    await paso('Review Focus 3: B se baja y sigue viendo su deuda (sin cargar gastos) y la puede pagar', async () => {
      await cargarGastoUI(pa, { monto: '200', concepto: 'Hielo', sacar: [UC] }); // entre A y B
      await enCuentasHay(pb, new RegExp(pes('Debés \\$ 100')));
      await clic(pb, '#btn-voy'); // "Ya no voy"
      await esperar(pb, () => document.getElementById('btn-voy') && document.getElementById('btn-voy').textContent === 'Voy');
      assert.equal(db.asistencias.some((x) => x.persona === UB), false);
      await enCuentasHay(pb, new RegExp(pes('Debés \\$ 100')));
      assert.equal(await cuantos(pb, '#cu-no-anotado'), 1);
      assert.equal(await cuantos(pb, '#cu-nuevo'), 0, 'quien se bajó no carga gastos');
      assert.equal(await cuantos(pb, '#chat-act'), 0, 'sin chat');
      assert.doesNotMatch(await pantalla(pb), /null|undefined/);
      await clic(pb, '#cu-transferencias .cu-pagar');
      await pb.waitForSelector('#cu-confirmar-si');
      await clic(pb, '#cu-confirmar-si');
      await enCuentasHay(pb, /Estás al día/);
      assert.equal(db.pagos.filter((p) => p.de === UB).length, 2);
    });

    await paso('quien no está anotado ni figura no ve la sección', async () => {
      await volver(pb);
      await abrirTarjeta(pb, 'Fútbol sin cuentas');
      await pb.waitForSelector('#btn-voy');
      await dormir(300);
      assert.equal(await cuentasTxt(pb), '[oculta]');
      assert.doesNotMatch(await pantalla(pb), /null|undefined/);
      await volver(pb);
      fallarGastosB = 5; // B se bajó: si su primera carga falla, igual ve el error con "Reintentar"
      await abrirTarjeta(pb, 'Asado del viernes');
      await pb.waitForSelector('#cuentas-act:not([hidden]) #cu-reintentar', { timeout: 6000 });
      fallarGastosB = 0;
      await clic(pb, '#cu-reintentar');
      await enCuentasHay(pb, /Estás al día/);
    });

    await paso('quien se anota a una actividad con gastos ya cargados los ve sin recargar', async () => {
      const PIZZA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const act = actividad(PIZZA, 'Pizza del martes', { tipo: 'after' });
      db.actividades.push(act);
      db.asistencias.push({ actividad: PIZZA, persona: UA, parte: 'actividad' }, { actividad: PIZZA, persona: UC, parte: 'actividad' });
      const g = { id: nuevoId(), actividad: PIZZA, parte: 'actividad', pagador: UA, monto: 900, concepto: 'Pizzas', creado: iso(Date.now()), cargado_por: UA };
      db.gastos.push(g);
      db.gasto_partes.push({ gasto: g.id, persona: UA }, { gasto: g.id, persona: UC });
      await volver(pb);
      emitir('actividades', 'INSERT', act);
      await esperar(pb, () => [...document.querySelectorAll('.tarjeta-act')].some((e) => e.textContent.includes('Pizza del martes')));
      await abrirTarjeta(pb, 'Pizza del martes');
      await pb.waitForSelector('#btn-voy');
      await dormir(300);
      assert.equal(await cuentasTxt(pb), '[oculta]', 'antes de anotarse no ve las cuentas');
      await clic(pb, '#btn-voy');
      await enCuentasHay(pb, /Pizzas/);
      assert.doesNotMatch(await pantalla(pb), /Todavía no hay gastos/);
      await volver(pb);
      await abrirTarjeta(pb, 'Asado del viernes');
      await enCuentasHay(pb, /Estás al día/);
    });

    await paso('al reconectar (SUBSCRIBED) se pone al día con lo que cambió con el socket caído', async () => {
      A.desconectada = true;
      const g = { id: nuevoId(), actividad: ACT, parte: 'actividad', pagador: UC, monto: 900, concepto: 'Carbón', creado: new Date().toISOString(), cargado_por: UC };
      db.gastos.push(g); [UA, UC].forEach((p) => db.gasto_partes.push({ gasto: g.id, persona: p }));
      await dormir(300);
      assert.doesNotMatch(await cuentasTxt(pa), /Carbón/);
      A.desconectada = false;
      await pa.evaluate(() => window.__estadoCanales('SUBSCRIBED'));
      await enCuentasHay(pa, /Carbón/);
      await enCuentasHay(pa, new RegExp(pes('Le debés \\$ 450 a Carla Ruiz')));
    });

    await paso('un cambio en vivo con el formulario abierto no borra lo escrito ni saca el foco', async () => {
      await clic(pa, '#cu-nuevo');
      await pa.waitForSelector('#cu-form');
      await pa.focus('#cu-concepto');
      await pa.keyboard.type('Pan');
      const antes = n('A:gastos:select');
      const g = { id: nuevoId(), actividad: ACT, parte: 'actividad', pagador: UC, monto: 10, concepto: 'Sal', creado: new Date().toISOString(), cargado_por: UC };
      db.gastos.push(g); db.gasto_partes.push({ gasto: g.id, persona: UC });
      emitir('gastos', 'INSERT', g);
      await enCuentasHay(pa, /Sal\$/);
      assert.ok(n('A:gastos:select') > antes);
      assert.equal(await pa.evaluate(() => document.activeElement && document.activeElement.id), 'cu-concepto');
      await pa.keyboard.type('chos');
      assert.equal(await pa.$eval('#cu-concepto', (e) => e.value), 'Panchos');
      // también si se repinta todo el detalle (cambio de asistencias)
      emitir('asistencias', 'INSERT', { actividad: OTRA, persona: UC, parte: 'actividad' });
      await dormir(400);
      assert.equal(await pa.evaluate(() => document.activeElement && document.activeElement.id), 'cu-concepto');
      await clic(pa, '#cu-cerrar');
    });

    await paso('cancelada: las cuentas se ven, no se cargan gastos nuevos, los pagos sí', async () => {
      await clic(pa, '#btn-cancelar');
      await clic(pa, '#btn-cancelar');
      await esperar(pa, () => /Esta actividad fue cancelada/.test(document.getElementById('pantalla-actividades').textContent));
      await pa.waitForSelector('#cu-cancelada');
      assert.equal(await cuantos(pa, '#cu-nuevo'), 0);
      await clic(pa, '#cu-transferencias .cu-pagar');
      await pa.waitForSelector('#cu-confirmar-si');
      await clic(pa, '#cu-confirmar-si');
      await enCuentasHay(pa, /Estás al día/);
      assert.ok(db.pagos.some((p) => p.de === UA && p.a === UC && p.monto === 450));
      // la base rechaza un gasto nuevo en la cancelada
      const r = consulta(UA, { table: 'cargar_gasto', action: 'rpc', values: { p_actividad: ACT, p_parte: 'actividad', p_pagador: UA, p_monto: 5, p_concepto: 'x', p_personas: [UA] } });
      assert.match(r.error.message, /cancelada/);
    });

    await paso('con la sección cerrada (volver a la lista) no se lee nada y el canal se baja', async () => {
      assert.ok((await pa.evaluate(() => window.__canales())).some((t) => /^cuentas-/.test(t)));
      await volver(pa);
      await pa.waitForSelector('.tarjeta-act');
      assert.equal((await pa.evaluate(() => window.__canales())).some((t) => /^cuentas-/.test(t)), false, 'quedó el canal de cuentas');
      const antes = n('A:gastos:select');
      await pa.evaluate(() => { window.__estadoTodos('SUBSCRIBED'); });
      emitir('gastos', 'INSERT', { id: nuevoId(), actividad: ACT });
      await dormir(500);
      assert.equal(n('A:gastos:select'), antes, 'se leyeron gastos con la sección cerrada');
    });

    await paso('el topic del canal es único por apertura', async () => {
      await abrirTarjeta(pa, 'Asado del viernes');
      await pa.waitForSelector('#cuentas-act');
      const t1 = (await pa.evaluate(() => window.__canales())).find((t) => /^cuentas-/.test(t));
      await volver(pa); await abrirTarjeta(pa, 'Asado del viernes'); await pa.waitForSelector('#cuentas-act');
      const t2 = (await pa.evaluate(() => window.__canales())).find((t) => /^cuentas-/.test(t));
      assert.ok(t1 && t2 && t1 !== t2 && t1.startsWith('cuentas-' + ACT + '-'), t1 + ' / ' + t2);
    });

    for (const r of paginas) if (r.page.errores.length) { fallas++; console.log('FALLA errores de página:', r.page.errores); }
  } finally { for (const b of navegadores) await b.close().catch(() => {}); }
  console.log(fallas ? fallas + ' falla(s)' : 'todo ok');
  process.exit(fallas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
