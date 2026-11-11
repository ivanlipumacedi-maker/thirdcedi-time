// Prueba de la UI de Juegos y Trivia SIN red ni usuarios reales: un Supabase falso en memoria (vive en este proceso y
// atiende a dos ventanas, "A" y "B") con las mismas reglas que dev/supabase/12-juegos.sql: se escribe solo por RPC,
// la RLS de lectura (partida en juego solo para sus jugadores, respuestas solo propias), el tiempo lo mide el
// "servidor" y la correcta no sale hasta revelar. Realtime respeta la RLS y los filtros (id=eq. / partida=eq.).
// Para que corra rápido, el "servidor" usa 3 s por pregunta y 2 s de revelación (la base usa 15 s y 8 s).
// Verifica: error de la primera carga con Reintentar, partida nueva que aparece en vivo en la otra ventana, sala de
// espera en vivo, chat de la partida, arrancar, responder, revelación automática al responder todos, avance solo
// al vencer el tiempo (sin el creador), que a la ventana no le llega "ok" antes de revelar, ranking final,
// cancelar en la página (sin confirm()), resync al reconectar y que con la pantalla cerrada no se lee nada.
// Cierre (Task 10): la lista de quien no juega se entera por broadcast ('juegos-lista') cuando una partida arranca o
// se cancela (M1); el avance automático agotado se rearma en el resync (M2); no se avanza antes de la gracia de 1 s
// (M3); el foco de teclado sigue en su botón tras un repintado (M4); "en curso" vence (M6) y la lista lee solo los
// jugadores de las partidas que muestra (M7).
// Saca capturas (claro y oscuro, 390x844) en dev/shots/juegos-*.png.
// Uso: servir la raíz con `npx --yes http-server -p 8080 -c-1` y correr `node dev/tools/prueba-juegos-mock.js`
// (URL_APP=http://127.0.0.1:8081 si se sirve en otro puerto).
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const puppeteer = require('./navegador'); // puppeteer-core, o WebKit con NAVEGADOR=webkit
const T = require('../../trivia-logica.js');
const Preguntas = require('../../contenido/preguntas.js');
const URL_APP = process.env.URL_APP || 'http://127.0.0.1:8080';
const shots = path.join(__dirname, '..', 'shots');
fs.mkdirSync(shots, { recursive: true });

// ---------- "Servidor" en memoria ----------
const UA = '11111111-1111-4111-8111-111111111111', UB = '22222222-2222-4222-8222-222222222222', UC = '33333333-3333-4333-8333-333333333333';
const PREG_MS = 3000, REV_MS = 2000, GRACIA_MS = 1000;
const db = {
  perfiles: [
    { id: UA, nombre: 'Ana Pérez', foto: null, empresa: 'CEDI' },
    { id: UB, nombre: 'Beto Gómez', foto: null, empresa: 'Wemox' },
    { id: UC, nombre: 'Caro Díaz', foto: null, empresa: 'Korex' },
  ],
  partidas: [], jugadores: [], respuestas: [], mensajes: [],
};
const secretos = new Map(); // partida -> preguntas elegidas (con ok): nunca salen al cliente
const paginas = []; // { page, uid, desconectada, recibido: [] }
const cuenta = {};
const contar = (uid, k) => { const c = { [UA]: 'A', [UB]: 'B', [UC]: 'C' }[uid] + ':' + k; cuenta[c] = (cuenta[c] || 0) + 1; };
const n = (k) => cuenta[k] || 0;
let fallarPartidas = 0;
let fallarAvanzar = 0;        // cuántos avanzar_partida fallan, de cualquiera (M2)
let jugadoresSinFiltro = 0;   // lecturas de jugadores sin filtrar por partida (M7)
const momentos = [];          // { clave: 'ronda:fase', t, limiteAntes } de cada transición (M3)
let uuidN = 0;
const nuevoId = () => 'dddddddd-dddd-4ddd-8ddd-' + String(++uuidN).padStart(12, '0');
const activo = (uid, pid) => db.jugadores.some((j) => j.partida === pid && j.persona === uid && !j.se_fue);
const enEspera = (pid) => db.partidas.some((p) => p.id === pid && p.estado === 'espera');
const visible = {
  partidas: (uid, f) => f.estado === 'espera' || activo(uid, f.id),
  jugadores: (uid, f) => activo(uid, f.partida) || enEspera(f.partida),
  respuestas: (uid, f) => f.persona === uid,
  mensajes: (uid, f) => { const m = /^par:(.+)$/.exec(f.sala); return !!m && activo(uid, m[1]); },
  perfiles: () => true,
};
const transiciones = []; // 'ronda:fase' en el orden en que el servidor las hizo

function emitir(tabla, evento, fila) {
  for (const p of paginas) {
    if (p.desconectada) continue;
    if (evento !== 'DELETE' && !visible[tabla](p.uid, fila)) continue; // Realtime respeta la RLS
    const enviada = evento === 'DELETE' && tabla === 'jugadores' ? { partida: fila.partida, persona: fila.persona } : fila;
    p.recibido.push({ tabla, evento, fila: JSON.parse(JSON.stringify(enviada)) });
    p.page.evaluate((t, e, f) => window.__emitir(t, e, f), tabla, evento, enviada).catch(() => {});
  }
}
const cumple = (fila, filtros) => filtros.every(([op, col, v]) => (op === 'eq' ? fila[col] === v : op === 'in' ? v.includes(fila[col]) : true));
const err = (message, code) => ({ error: { code: code || 'P0001', message } });
const iso = () => new Date().toISOString();

function estadoPregunta(pid, ronda) {
  const qs = secretos.get(pid);
  const q = qs[ronda - 1];
  const t = Date.now();
  return { fase: 'pregunta', ronda, total: qs.length, pregunta: { cat: q.cat, dif: q.dif, p: q.p, ops: q.ops.slice() }, inicio_ms: t, limite_ms: t + PREG_MS, ahora_ms: t, respondieron: [] };
}
function actualizarPartida(p, cambios) {
  const limiteAntes = p.estado_juego && p.estado_juego.limite_ms;
  Object.assign(p, cambios); transiciones.push(p.estado_juego.ronda + ':' + p.estado_juego.fase);
  momentos.push({ clave: p.estado_juego.ronda + ':' + p.estado_juego.fase, t: Date.now(), limiteAntes });
  emitir('partidas', 'UPDATE', p);
}
// como juegos_avisar_lista (18): broadcast privado con solo el id, a todos los miembros
function avisarLista(id) {
  for (const p of paginas) if (!p.desconectada) p.page.evaluate((x) => window.__broadcast('juegos-lista', 'cambio', { id: x }), id).catch(() => {});
}
function revelar(p) {
  const e = p.estado_juego;
  const ok = secretos.get(p.id)[e.ronda - 1].ok;
  const pr = {}; const conteo = [0, 0, 0, 0];
  db.respuestas.filter((r) => r.partida === p.id && r.ronda === e.ronda).forEach((r) => {
    const pts = T.puntos(r.opcion === ok, r.ms, 15000);
    const j = db.jugadores.find((x) => x.partida === p.id && x.persona === r.persona);
    j.puntos += pts; emitir('jugadores', 'UPDATE', j);
    pr[r.persona] = pts; conteo[r.opcion]++;
  });
  const t = Date.now();
  actualizarPartida(p, { estado_juego: { ...e, fase: 'revelada', ok, conteo, puntos_ronda: pr, limite_ms: t + REV_MS, ahora_ms: t } });
}
function siguiente(p) {
  const e = p.estado_juego;
  if (e.ronda < e.total) actualizarPartida(p, { estado_juego: estadoPregunta(p.id, e.ronda + 1) });
  else actualizarPartida(p, { estado: 'terminada', estado_juego: { fase: 'final', total: e.total, ahora_ms: Date.now() } });
}
const activos = (pid) => db.jugadores.filter((j) => j.partida === pid && !j.se_fue);
const respondieron = (pid, ronda) => db.respuestas.filter((r) => r.partida === pid && r.ronda === ronda && activo(r.persona, pid)).length;

function rpc(uid, fn, a) {
  contar(uid, 'rpc:' + fn);
  if (fn === 'ahora_ms') return { data: Date.now() };
  const p = db.partidas.find((x) => x.id === a.p);
  if (fn === 'crear_partida') {
    const id = nuevoId();
    const f = { id, juego: a.p_juego, creador: uid, estado: 'espera', estado_juego: {}, creado: iso() };
    db.partidas.push(f); emitir('partidas', 'INSERT', f);
    const j = { partida: id, persona: uid, puntos: 0, se_fue: false };
    db.jugadores.push(j); emitir('jugadores', 'INSERT', j);
    return { data: id };
  }
  if (!p) return err('La partida no existe', 'P0002');
  if (fn === 'unirse_partida') {
    if (p.estado !== 'espera') return err('La partida ya empezó');
    const j = { partida: p.id, persona: uid, puntos: 0, se_fue: false };
    db.jugadores.push(j); emitir('jugadores', 'INSERT', j);
    return { data: null };
  }
  if (!activo(uid, p.id)) return err('No estás en esta partida', '42501');
  if (fn === 'salir_partida') {
    if (p.estado === 'espera') {
      if (p.creador === uid) { actualizarPartida(p, { estado: 'terminada', estado_juego: { fase: 'cancelada', ahora_ms: Date.now() } }); avisarLista(p.id); }
      const j = db.jugadores.find((x) => x.partida === p.id && x.persona === uid);
      db.jugadores = db.jugadores.filter((x) => x !== j); emitir('jugadores', 'DELETE', j);
      return { data: null };
    }
    const j = db.jugadores.find((x) => x.partida === p.id && x.persona === uid);
    j.se_fue = true; emitir('jugadores', 'UPDATE', j);
    if (p.estado === 'jugando' && !activos(p.id).length) actualizarPartida(p, { estado: 'terminada', estado_juego: { ...p.estado_juego, fase: 'final' } });
    return { data: null };
  }
  const e = p.estado_juego;
  if (fn === 'avanzar_partida') {
    if (fallarAvanzar > 0) { fallarAvanzar--; return err('sin red', 'XX000'); }
    if (a.p_ronda != null && (e.ronda || 0) !== a.p_ronda) return { data: e };
    if (a.p_fase != null && (e.fase || p.estado) !== a.p_fase) return { data: e };
    if (p.estado === 'terminada') return { data: e };
    if (p.estado === 'espera') {
      if (p.creador !== uid) return err('Solo quien armó la partida la puede arrancar');
      secretos.set(p.id, T.elegir(Preguntas, T.PREGUNTAS_POR_PARTIDA, Date.now() % 100000));
      actualizarPartida(p, { estado: 'jugando', estado_juego: estadoPregunta(p.id, 1) });
      avisarLista(p.id);
      return { data: p.estado_juego };
    }
    const vencido = Date.now() >= e.limite_ms;
    if (e.fase === 'pregunta') {
      if (p.creador !== uid && !vencido && respondieron(p.id, e.ronda) < activos(p.id).length) return err('Todavía no: falta que respondan todos o que se termine el tiempo');
      revelar(p);
    } else if (e.fase === 'revelada') {
      if (p.creador !== uid && !vencido) return err('Todavía no: la que avanza es quien armó la partida');
      siguiente(p);
    }
    return { data: p.estado_juego };
  }
  if (fn === 'responder') {
    if (p.estado !== 'jugando' || e.fase !== 'pregunta') return err('No hay una pregunta abierta');
    if (e.ronda !== a.p_ronda) return err('Esa no es la pregunta actual');
    const t = Date.now();
    if (t > e.limite_ms + GRACIA_MS) return err('Se terminó el tiempo');
    if (db.respuestas.some((r) => r.partida === p.id && r.ronda === a.p_ronda && r.persona === uid)) return err('Ya respondiste');
    const r = { partida: p.id, ronda: a.p_ronda, persona: uid, opcion: a.p_opcion, ms: Math.min(Math.max(t - e.inicio_ms, 0), 15000) };
    db.respuestas.push(r); emitir('respuestas', 'INSERT', r);
    p.estado_juego = { ...e, respondieron: e.respondieron.concat(uid) }; emitir('partidas', 'UPDATE', p);
    if (respondieron(p.id, e.ronda) >= activos(p.id).length) revelar(p);
    return { data: null };
  }
  return err('sin rpc ' + fn);
}

function consulta(uid, s) {
  contar(uid, s.table + ':' + s.action);
  if (s.table === 'partidas' && s.action === 'select' && fallarPartidas > 0) { fallarPartidas--; return { error: { message: 'sin red' } }; }
  if (s.table === 'mensajes' && s.action === 'insert') {
    if (!visible.mensajes(uid, s.values)) return err('RLS', '42501');
    const f = { id: 'mmmmmmmm-mmmm-4mmm-8mmm-' + String(++uuidN).padStart(12, '0'), autor: uid, tipo: 'texto', texto: null, archivo: null, ancho: null, alto: null, editado: false, creado: iso(), ...s.values };
    db.mensajes.push(f); emitir('mensajes', 'INSERT', f);
    return { data: s.single ? f : [f] };
  }
  if (s.action !== 'select') return err('solo por RPC', '42501'); // como la base: nada se escribe directo
  if (s.table === 'jugadores' && !s.filtros.some((x) => x[1] === 'partida')) jugadoresSinFiltro++;
  let r = (db[s.table] || []).filter((f) => visible[s.table](uid, f) && cumple(f, s.filtros));
  if (s.ordenes.length) r = [...r].sort((a, b) => { for (const o of s.ordenes) { if (a[o.col] !== b[o.col]) return (a[o.col] < b[o.col] ? -1 : 1) * (o.asc ? 1 : -1); } return 0; });
  if (s.limite) r = r.slice(0, s.limite);
  r = JSON.parse(JSON.stringify(r));
  return { data: s.single ? r[0] || null : r };
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
  const todos = [];
  const pasa = (filtro, fila) => { if (!filtro) return true; const m = /^(\\w+)=eq\\.(.+)$/.exec(filtro); return !!m && String(fila[m[1]]) === m[2]; };
  window.__emitir = (tabla, evento, fila) => canales.forEach((c) => c.cbs.filter((x) => x.tabla === tabla && (x.evento === '*' || x.evento === evento) && (evento === 'DELETE' ? !x.filtro : pasa(x.filtro, fila))).forEach((x) => x.fn({ eventType: evento, new: evento === 'DELETE' ? {} : fila, old: evento === 'DELETE' ? fila : {} })));
  window.__broadcast = (topic, evento, payload) => canales.forEach((c) => c.topic === topic && c.cbs.filter((x) => x.broadcast === evento).forEach((x) => x.fn({ event: evento, payload })));
  window.__estadoCanales = (st) => canales.forEach((c) => c.estado && c.estado(st));
  window.__estadoTodos = (st) => todos.forEach((c) => c.estado && c.estado(st));
  window.__canales = () => [...canales].map((c) => c.topic);
  window.supabase = { createClient() {
    return {
      from: Builder,
      // como supabase-js: rpc() devuelve un thenable (PostgrestBuilder) sin .catch ni .finally
      rpc(fn, args) { const pr = window.__rpc(fn, JSON.stringify(args || {})).then((r) => { const x = JSON.parse(r); return { data: x.data === undefined ? null : x.data, error: x.error || null }; }); return { then: (a, b) => pr.then(a, b) }; },
      channel(topic) {
        const c = { topic, cbs: [], on(t, f, fn) { c.cbs.push(t === 'broadcast' ? { broadcast: f.event, fn } : { tabla: f.table, evento: f.event, filtro: f.filter, fn }); return c; }, subscribe(cb) { c.estado = cb; canales.add(c); todos.push(c); if (cb) setTimeout(() => cb('SUBSCRIBED'), 0); return c; } };
        return c;
      },
      removeChannel(c) { canales.delete(c); },
      storage: { from() { return { upload: async (p) => ({ data: { path: p }, error: null }), remove: async () => ({ data: [], error: null }), createSignedUrls: async () => ({ data: [], error: null }) }; } },
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}), getUser: async () => ({ data: { user: null } }) },
    };
  } };
})();`;

const navegadores = [];
async function abrir(uid, esperarSel) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  navegadores.push(browser);
  const page = await browser.newPage();
  const reg = { page, uid, desconectada: false, recibido: [] };
  paginas.push(reg);
  page.errores = [];
  page.on('pageerror', (e) => page.errores.push(e.message));
  if (process.env.DEPURAR) page.on('console', (m) => console.log('[' + uid.slice(0, 2) + ']', m.text()));
  await page.exposeFunction('__q', async (j) => JSON.stringify(consulta(uid, JSON.parse(j))));
  await page.exposeFunction('__rpc', async (fn, j) => JSON.stringify(rpc(uid, fn, JSON.parse(j))));
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  page.on('request', (rq) => {
    if (rq.url().endsWith('/vendor/supabase.js')) rq.respond({ status: 200, contentType: 'application/javascript', body: STUB });
    else if (/fonts\.(googleapis|gstatic)\.com/.test(rq.url())) rq.respond({ status: 200, contentType: 'text/css', body: '' });
    else rq.continue();
  });
  await page.setViewport({ width: Number(process.env.ANCHO) || 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.goto(URL_APP + '/#/juegos', { waitUntil: 'networkidle0' });
  await page.evaluate((p) => { App.modoAcceso(false); App.setPerfil(p); }, db.perfiles.find((p) => p.id === uid));
  await page.waitForSelector(esperarSel, { timeout: 8000 });
  return reg;
}
const texto = (p, sel) => p.$eval(sel, (e) => e.textContent);
const clic = (p, sel) => p.$eval(sel, (e) => e.click());
const cuantos = (p, sel) => p.$$eval(sel, (e) => e.length);
const esperar = (p, fn, ...a) => p.waitForFunction(fn, { timeout: 8000 }, ...a);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const pantalla = (p) => texto(p, '#pantalla-juegos');
async function capturas(p, nombre) {
  await p.evaluate(() => { const t = document.getElementById('toast'); t.hidden = true; });
  await p.screenshot({ path: path.join(shots, 'juegos-' + nombre + '-claro.png') });
  await p.evaluate(() => document.getElementById('btn-tema').click());
  await p.screenshot({ path: path.join(shots, 'juegos-' + nombre + '-oscuro.png') });
  await p.evaluate(() => document.getElementById('btn-tema').click());
}

(async () => {
  let fallas = 0;
  const paso = async (nombre, fn) => { try { await fn(); console.log('ok', nombre); } catch (e) { fallas++; console.log('FALLA', nombre, '-', e.message); } };
  try {
    fallarPartidas = 5; // la carga inicial y la repetición por SUBSCRIBED fallan
    const A = await abrir(UA, '#pantalla-juegos .vacio');
    const pa = A.page;
    const B = await abrir(UB, '#pantalla-juegos .vacio');
    const pb = B.page;

    await paso('si falla la primera carga se ve el error con Reintentar, y recupera', async () => {
      await pa.waitForSelector('#jue-reintentar', { timeout: 6000 });
      assert.match(await pantalla(pa), /No pudimos cargar las partidas/);
      fallarPartidas = 0;
      await clic(pa, '#jue-reintentar');
      await esperar(pa, () => /Abiertas para unirse/.test(document.getElementById('pantalla-juegos').textContent));
      if (await cuantos(pb, '#jue-reintentar')) await clic(pb, '#jue-reintentar');
      await esperar(pb, () => /No hay partidas abiertas/.test(document.getElementById('pantalla-juegos').textContent));
    });

    let par;
    await paso('A arma una Trivia (el Impostor ya está disponible) y queda en la sala de espera', async () => {
      await clic(pa, '#btn-nueva-partida');
      await pa.waitForSelector('#nueva-trivia');
      assert.equal(await pa.$eval('#nueva-impostor', (b) => b.disabled), false, 'El Impostor (Task 8) debería estar disponible');
      assert.doesNotMatch(await texto(pa, '#nueva-impostor'), /Próximamente/);
      await clic(pa, '#nueva-trivia');
      await pa.waitForSelector('#btn-arrancar');
      par = db.partidas[0].id;
      assert.match(await texto(pa, '#btn-arrancar'), /jugás solo/);
      assert.equal(await cuantos(pa, '#chat-par'), 1, 'el jugador ve el chat de la partida');
    });

    await paso('B ve la partida nueva aparecer en vivo en "Abiertas"', async () => {
      await esperar(pb, () => !!document.querySelector('#lista-abiertas .tarjeta-partida'));
      assert.match(await texto(pb, '#lista-abiertas'), /Trivia de Ana Pérez/);
      await capturas(pb, 'lista');
    });

    await paso('B entra a la sala sin unirse: ve jugadores pero no el chat; se une y A lo ve en vivo', async () => {
      await clic(pb, '#lista-abiertas .tarjeta-partida');
      await pb.waitForSelector('#btn-unirme');
      assert.equal(await cuantos(pb, '#chat-par'), 0, 'el chat es solo para jugadores');
      assert.match(await texto(pb, '#sala-jugadores'), /Ana Pérez/);
      await pa.focus('#btn-arrancar');
      await clic(pb, '#btn-unirme');
      await pb.waitForSelector('#esperando-creador');
      assert.equal(await cuantos(pb, '#chat-par'), 1);
      await esperar(pa, () => /Beto Gómez/.test(document.getElementById('sala-jugadores').textContent));
      assert.equal(await texto(pa, '#btn-arrancar'), 'Arrancar');
      assert.equal(await pa.evaluate(() => document.activeElement && document.activeElement.id), 'btn-arrancar', 'M4: el repintado le sacó el foco a "Arrancar"');
    });

    await paso('el chat de la partida llega en vivo a la otra ventana', async () => {
      await pb.type('#chat-par textarea', 'zz ¿listos?');
      await pb.$eval('#chat-par form', (f) => f.requestSubmit());
      await esperar(pa, () => /zz ¿listos\?/.test(document.getElementById('chat-par').textContent));
      await capturas(pa, 'sala');
    });

    await paso('A arranca: los dos ven la pregunta 1 y a ninguna ventana le llegó la correcta', async () => {
      await clic(pa, '#btn-arrancar');
      await pa.waitForSelector('#trivia-pregunta');
      await pb.waitForSelector('#trivia-pregunta');
      assert.equal(await texto(pa, '#trivia-pregunta'), await texto(pb, '#trivia-pregunta'));
      assert.match(await texto(pb, '#trivia-ronda'), /Pregunta 1 de 10/);
      assert.equal(await cuantos(pb, '.op-trivia'), 4);
      assert.equal(await cuantos(pb, '.op-trivia.correcta'), 0);
      for (const r of [A, B]) {
        const viejos = r.recibido.filter((x) => x.tabla === 'partidas' && x.fila.estado_juego && x.fila.estado_juego.fase === 'pregunta');
        assert.ok(viejos.length > 0);
        viejos.forEach((x) => { assert.ok(!('ok' in x.fila.estado_juego), 'llegó ok antes de revelar'); assert.ok(!('id' in x.fila.estado_juego.pregunta)); });
      }
      await capturas(pb, 'pregunta');
    });

    await paso('B responde: se marca su opción y espera a A; al responder A se revela sola en las dos', async () => {
      await pa.focus('.op-trivia[data-op="3"]');
      await clic(pb, '.op-trivia[data-op="1"]');
      await esperar(pb, () => /Respondiste/.test(document.getElementById('trivia-estado').textContent));
      assert.equal(await cuantos(pb, '.op-trivia.elegida'), 1);
      await esperar(pa, () => /1 de 2 ya respondieron/.test(document.getElementById('trivia-estado').textContent));
      assert.equal(await pa.evaluate(() => document.activeElement && document.activeElement.dataset.op), '3', 'M4: el repintado le sacó el foco a la opción');
      const ok = secretos.get(par)[0].ok;
      await clic(pa, '.op-trivia[data-op="' + ok + '"]');
      for (const p of [pa, pb]) await p.waitForSelector('.op-trivia.correcta');
      assert.equal(await pa.$eval('.op-trivia.correcta', (e) => e.dataset.op), String(ok));
      assert.match(await texto(pa, '#trivia-resultado'), /¡Bien! \+\d+ puntos/);
      assert.match(await texto(pb, '#ranking-parcial'), /Ana Pérez/);
      assert.equal(await cuantos(pb, '#btn-siguiente'), 0, 'solo el creador ve "Siguiente"');
      assert.equal(await cuantos(pa, '#btn-siguiente'), 1);
      await capturas(pa, 'revelada');
    });

    await paso('A pasa a la siguiente; sin respuestas, al vencer el tiempo avanza solo (revela y sigue) sin el creador', async () => {
      await clic(pa, '#btn-siguiente');
      await esperar(pb, () => /Pregunta 2 de 10/.test(document.getElementById('trivia-ronda').textContent));
      A.desconectada = true; // el creador "se cuelga": avanzan los timers de B
      const desde = transiciones.length;
      await pb.waitForFunction(() => /Pregunta 3 de 10/.test((document.getElementById('trivia-ronda') || {}).textContent || ''), { timeout: PREG_MS + REV_MS + 6000 });
      const hechas = transiciones.slice(desde);
      assert.deepEqual(hechas.slice(0, 2), ['2:revelada', '3:pregunta'], 'una sola transición por fase: ' + hechas.join(', '));
      const rev = momentos.find((m) => m.clave === '2:revelada');
      assert.ok(rev.t >= rev.limiteAntes + GRACIA_MS, 'M3: se reveló ' + (rev.t - rev.limiteAntes) + ' ms después del límite, antes de la gracia');
      A.desconectada = false;
      await pa.evaluate(() => window.__estadoCanales('SUBSCRIBED')); // A reconecta y se pone al día
      await esperar(pa, () => /Pregunta 3 de 10/.test(document.getElementById('trivia-ronda').textContent));
    });

    await paso('B no puede responder dos veces; el creador puede mostrar la respuesta antes de tiempo', async () => {
      await clic(pb, '.op-trivia[data-op="0"]');
      await esperar(pb, () => /Respondiste/.test(document.getElementById('trivia-estado').textContent));
      assert.equal(await pb.$eval('.op-trivia[data-op="2"]', (b) => b.disabled), true);
      const antes = n('B:rpc:responder');
      await pb.evaluate(() => document.querySelector('.op-trivia[data-op="2"]').click());
      await dormir(200);
      assert.equal(n('B:rpc:responder'), antes);
      await clic(pa, '#btn-revelar');
      await pb.waitForSelector('.op-trivia.correcta');
    });

    await paso('M2: si el avance automático se agota (6 reintentos), el resync lo vuelve a pedir', async () => {
      A.desconectada = true;
      fallarAvanzar = 100;
      const antes = n('B:rpc:avanzar_partida');
      for (let i = 0; i < 80 && n('B:rpc:avanzar_partida') - antes < 7; i++) await dormir(200);
      assert.equal(n('B:rpc:avanzar_partida') - antes, 7, 'esperaba 1 pedido + 6 reintentos');
      await dormir(1600);
      assert.equal(n('B:rpc:avanzar_partida') - antes, 7, 'siguió pidiendo después de agotarse');
      fallarAvanzar = 0;
      await pb.evaluate(() => window.__estadoCanales('SUBSCRIBED'));
      await esperar(pb, () => /Pregunta 4 de 10/.test((document.getElementById('trivia-ronda') || {}).textContent || ''));
      A.desconectada = false;
      await pa.evaluate(() => window.__estadoCanales('SUBSCRIBED'));
      await esperar(pa, () => /Pregunta 4 de 10/.test(document.getElementById('trivia-ronda').textContent));
    });

    await paso('el creador avanza hasta el final y los dos ven el ranking final', async () => {
      for (let i = 0; i < 30; i++) {
        const fin = await cuantos(pa, '#ranking-final');
        if (fin) break;
        if (await cuantos(pa, '#btn-siguiente')) await clic(pa, '#btn-siguiente');
        else if (await cuantos(pa, '#btn-revelar')) await clic(pa, '#btn-revelar');
        await dormir(150);
      }
      await pa.waitForSelector('#ranking-final');
      await pb.waitForSelector('#ranking-final');
      assert.equal(db.partidas.find((p) => p.id === par).estado, 'terminada');
      const filas = await pb.$$eval('#ranking-final .fila-ranking', (xs) => xs.map((x) => x.textContent));
      assert.equal(filas.length, 2);
      const pts = db.jugadores.filter((j) => j.partida === par).map((j) => j.puntos).sort((a, b) => b - a);
      assert.match(filas[0], new RegExp(pts[0].toLocaleString('es-AR').replace('.', '\\.') + '$'));
      assert.equal(await cuantos(pb, '.salir-partida'), 0, 'terminada: ya no hay "Salir"');
      await capturas(pb, 'ranking');
    });

    await paso('"Volver a Juegos" lleva a la lista y la partida figura en Terminadas', async () => {
      await clic(pb, '#btn-volver-juegos');
      await esperar(pb, () => /Terminadas/.test(document.getElementById('pantalla-juegos').textContent));
      await clic(pa, '#btn-volver-juegos');
      await esperar(pa, () => /Abiertas para unirse/.test(document.getElementById('pantalla-juegos').textContent));
    });

    await paso('M6: "Tus partidas en curso" no muestra una partida trabada de hace horas', async () => {
      const t = Date.now();
      const vieja = { id: nuevoId(), juego: 'trivia', creador: UB, estado: 'jugando', creado: new Date(t - 5 * 3600e3).toISOString(),
        estado_juego: { fase: 'pregunta', ronda: 1, total: 10, pregunta: { cat: 'general', dif: 1, p: 'zz', ops: ['a', 'b', 'c', 'd'] }, inicio_ms: t - 3 * 3600e3, limite_ms: t - 3 * 3600e3 + 3000, ahora_ms: t - 3 * 3600e3, respondieron: [] } };
      const nueva = { ...vieja, id: nuevoId(), creado: iso(), estado_juego: { ...vieja.estado_juego, inicio_ms: t, limite_ms: t + 600000, ahora_ms: t } };
      for (const p of [vieja, nueva]) { db.partidas.push(p); db.jugadores.push({ partida: p.id, persona: UB, puntos: 0, se_fue: false }); }
      emitir('partidas', 'INSERT', nueva);
      await esperar(pb, (id) => !!document.querySelector('#lista-en-curso .tarjeta-partida[data-id="' + id + '"]'), nueva.id);
      assert.equal(await cuantos(pb, '.tarjeta-partida[data-id="' + vieja.id + '"]'), 0, 'se ve la partida trabada');
      for (const p of [vieja, nueva]) { p.estado = 'terminada'; p.estado_juego = { fase: 'cancelada', ahora_ms: t }; }
      emitir('partidas', 'UPDATE', nueva);
      await esperar(pb, (id) => !document.querySelector('.tarjeta-partida[data-id="' + id + '"]'), nueva.id);
    });

    await paso('cancelar se confirma en la página: "No" no hace nada y "Sí" la cancela para todos', async () => {
      await clic(pa, '#btn-nueva-partida');
      await pa.waitForSelector('#nueva-trivia');
      await clic(pa, '#nueva-trivia');
      await pa.waitForSelector('#btn-arrancar');
      const id2 = db.partidas[db.partidas.length - 1].id;
      await esperar(pb, (id) => !!document.querySelector('.tarjeta-partida[data-id="' + id + '"]'), id2);
      await pb.$eval('.tarjeta-partida[data-id="' + id2 + '"]', (b) => b.click());
      await pb.waitForSelector('#btn-unirme');
      await clic(pb, '#btn-unirme');
      await pb.waitForSelector('#esperando-creador');
      await clic(pa, '#btn-salir');
      await pa.waitForSelector('#aviso-salir');
      assert.match(await texto(pa, '#aviso-salir-txt'), /se cancela para todos/);
      assert.equal(await pa.evaluate(() => document.activeElement && document.activeElement.id), 'btn-salir-no');
      const antes = n('A:rpc:salir_partida');
      await clic(pa, '#btn-salir-no');
      assert.equal(n('A:rpc:salir_partida'), antes);
      await clic(pa, '#btn-salir');
      await clic(pa, '#btn-salir-si');
      await esperar(pa, () => /Abiertas para unirse/.test(document.getElementById('pantalla-juegos').textContent));
      await pb.waitForSelector('#par-cancelada');
    });

    await paso('al reconectar (SUBSCRIBED) la lista se pone al día con lo que pasó con el socket caído', async () => {
      await pb.evaluate(() => document.querySelector('#pantalla-juegos .btn-link').click());
      await esperar(pb, () => /Abiertas para unirse/.test(document.getElementById('pantalla-juegos').textContent));
      B.desconectada = true;
      rpc(UC, 'crear_partida', { p_juego: 'trivia' });
      await dormir(300);
      assert.doesNotMatch(await pantalla(pb), /Trivia de Caro Díaz/);
      B.desconectada = false;
      await pb.evaluate(() => window.__estadoCanales('SUBSCRIBED'));
      await esperar(pb, () => /Trivia de Caro Díaz/.test(document.getElementById('pantalla-juegos').textContent));
    });

    await paso('B sale de una partida en espera con la confirmación de la página', async () => {
      const id3 = db.partidas[db.partidas.length - 1].id;
      await pb.$eval('.tarjeta-partida[data-id="' + id3 + '"]', (b) => b.click());
      await pb.waitForSelector('#btn-unirme');
      await clic(pb, '#btn-unirme');
      await pb.waitForSelector('#btn-salir');
      await clic(pb, '#btn-salir');
      assert.match(await texto(pb, '#aviso-salir-txt'), /¿Salís de la partida\?/);
      await clic(pb, '#btn-salir-si');
      await esperar(pb, () => /Abiertas para unirse/.test(document.getElementById('pantalla-juegos').textContent));
      assert.equal(db.jugadores.some((j) => j.partida === id3 && j.persona === UB), false);
    });

    await paso('M1: quien no juega ve salir de "Abiertas" la partida que arrancó o se canceló (broadcast)', async () => {
      await esperar(pb, () => /Abiertas para unirse/.test(document.getElementById('pantalla-juegos').textContent));
      for (const accion of ['arrancar', 'cancelar']) {
        const id = rpc(UC, 'crear_partida', { p_juego: 'trivia' }).data;
        await esperar(pb, (x) => !!document.querySelector('#lista-abiertas .tarjeta-partida[data-id="' + x + '"]'), id);
        if (accion === 'arrancar') rpc(UC, 'avanzar_partida', { p: id, p_ronda: 0, p_fase: 'espera' });
        else rpc(UC, 'salir_partida', { p: id });
        await esperar(pb, (x) => !document.querySelector('.tarjeta-partida[data-id="' + x + '"]'), id);
        if (accion === 'arrancar') rpc(UC, 'salir_partida', { p: id });
      }
    });

    await paso('M7: la lista lee solo los jugadores de las partidas que muestra', async () => {
      assert.equal(jugadoresSinFiltro, 0, jugadoresSinFiltro + ' lecturas de jugadores sin filtrar por partida');
    });

    await paso('con la pantalla cerrada (sin sesión) ni un SUBSCRIBED tardío lee partidas', async () => {
      await pa.evaluate(() => App.setPerfil(null));
      await dormir(300);
      const antes = n('A:partidas:select') + n('A:jugadores:select') + n('A:rpc:avanzar_partida');
      await pa.evaluate(() => { window.__estadoTodos('SUBSCRIBED'); window.dispatchEvent(new Event('online')); });
      await dormir(500);
      assert.equal(n('A:partidas:select') + n('A:jugadores:select') + n('A:rpc:avanzar_partida'), antes, 'se leyó con la pantalla cerrada');
      assert.equal((await pa.evaluate(() => window.__canales())).filter((t) => /^juegos-/.test(t)).length, 0, 'quedó un canal de juegos abierto');
    });

    for (const r of paginas) if (r.page.errores.length) { fallas++; console.log('FALLA errores de página:', r.page.errores); }
  } finally { for (const b of navegadores) await b.close().catch(() => {}); }
  console.log(fallas ? fallas + ' falla(s)' : 'todo ok');
  process.exit(fallas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
