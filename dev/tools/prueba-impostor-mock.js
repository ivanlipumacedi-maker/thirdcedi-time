// Prueba de la UI de El Impostor SIN red ni usuarios reales: un Supabase falso en memoria (vive en este proceso y
// atiende a TRES ventanas, "A", "B" y "C") con las mismas reglas que dev/supabase/14-impostor.sql: se escribe solo
// por RPC, la palabra de cada uno la da mi_palabra (solo la propia), los votos ajenos no se leen, el tiempo lo mide
// el "servidor" y el impostor y las palabras aparecen recién en el estado final. Realtime respeta la RLS.
// Para que corra rápido, el "servidor" usa 1,5 s para la palabra, 3 s para las pistas y 4 s para votar.
// Verifica: Impostor disponible (sin "Próximamente"), que con 2 no arranca, que cada ventana ve solo su palabra
// (2 iguales y 1 distinta) y que a ninguna le llega la de otro ni quién es el impostor (se miran todos los datos que
// recibió: lecturas, RPC y Realtime), avance solo de la palabra a las pistas, pistas en el chat, votación sin
// votarse a uno mismo ni dos veces, revelación al votar todos con el resultado de ImpostorLogica.resultado, y
// Review Focus 5: si se va el impostor gana el grupo; si se va un inocente y quedan 2, gana el impostor.
// Saca capturas (claro y oscuro, 390x844) en dev/shots/impostor-*.png.
// Uso: servir la raíz con `npx --yes http-server -p 8080 -c-1` y correr `node dev/tools/prueba-impostor-mock.js`
// (URL_APP=http://127.0.0.1:8083 si se sirve en otro puerto).
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const I = require('../../impostor-logica.js');
const Palabras = require('../../contenido/palabras.js');
const URL_APP = process.env.URL_APP || 'http://127.0.0.1:8080';
const shots = path.join(__dirname, '..', 'shots');
fs.mkdirSync(shots, { recursive: true });

// ---------- "Servidor" en memoria ----------
const UA = '11111111-1111-4111-8111-111111111111', UB = '22222222-2222-4222-8222-222222222222', UC = '33333333-3333-4333-8333-333333333333';
const LETRA = { [UA]: 'A', [UB]: 'B', [UC]: 'C' };
const DUR = { palabra: 1500, pistas: 3000, votacion: 4000 };
const SIGUIENTE = { palabra: 'pistas', pistas: 'votacion' };
const db = {
  perfiles: [
    { id: UA, nombre: 'Ana Pérez', foto: null, empresa: 'CEDI' },
    { id: UB, nombre: 'Beto Gómez', foto: null, empresa: 'Wemox' },
    { id: UC, nombre: 'Caro Díaz', foto: null, empresa: 'Korex' },
  ],
  partidas: [], jugadores: [], mensajes: [],
};
const secretos = new Map(); // partida -> { impostor, palabra, palabra_impostor } (nunca sale al cliente)
const votos = new Map();    // partida -> Map votante -> votado (cada uno lee solo el suyo; aparecen en el final)
const paginas = [];         // { page, uid, desconectada, recibido: [] }
const cuenta = {};
const contar = (uid, k) => { const c = LETRA[uid] + ':' + k; cuenta[c] = (cuenta[c] || 0) + 1; };
const n = (k) => cuenta[k] || 0;
let uuidN = 0;
let semilla = 7;
const nuevoId = () => 'dddddddd-dddd-4ddd-8ddd-' + String(++uuidN).padStart(12, '0');
const activo = (uid, pid) => db.jugadores.some((j) => j.partida === pid && j.persona === uid && !j.se_fue);
const enEspera = (pid) => db.partidas.some((p) => p.id === pid && p.estado === 'espera');
const visible = {
  partidas: (uid, f) => f.estado === 'espera' || activo(uid, f.id),
  jugadores: (uid, f) => activo(uid, f.partida) || enEspera(f.partida),
  respuestas: () => false,
  mensajes: (uid, f) => { const m = /^par:(.+)$/.exec(f.sala); return !!m && activo(uid, m[1]); },
  perfiles: () => true,
};
const pagina = (uid) => paginas.find((p) => p.uid === uid);
const anotar = (uid, x) => { const p = pagina(uid); if (p) p.recibido.push(JSON.stringify(x)); };

function emitir(tabla, evento, fila) {
  for (const p of paginas) {
    if (p.desconectada) continue;
    if (evento !== 'DELETE' && !visible[tabla](p.uid, fila)) continue; // Realtime respeta la RLS
    const enviada = evento === 'DELETE' && tabla === 'jugadores' ? { partida: fila.partida, persona: fila.persona } : fila;
    p.recibido.push(JSON.stringify(enviada));
    p.page.evaluate((t, e, f) => window.__emitir(t, e, f), tabla, evento, enviada).catch(() => {});
  }
}
const cumple = (fila, filtros) => filtros.every(([op, col, v]) => (op === 'eq' ? fila[col] === v : op === 'in' ? v.includes(fila[col]) : true));
const err = (message, code) => ({ error: { code: code || 'P0001', message } });
const iso = () => new Date().toISOString();
const activos = (pid) => db.jugadores.filter((j) => j.partida === pid && !j.se_fue).map((j) => j.persona);
const fasesHechas = [];

function cambiar(p, cambios) { Object.assign(p, cambios); fasesHechas.push(p.estado_juego.fase); emitir('partidas', 'UPDATE', p); }
function fase(p, f) { const t = Date.now(); cambiar(p, { estado_juego: { ...p.estado_juego, fase: f, inicio_ms: t, limite_ms: t + DUR[f], ahora_ms: t } }); }
function votaronActivos(pid) { const v = votos.get(pid) || new Map(); return activos(pid).filter((x) => v.has(x)).length; }
function terminar(p, motivo) {
  const s = secretos.get(p.id);
  const v = new Map([...(votos.get(p.id) || new Map())].filter(([k]) => activos(p.id).includes(k)));
  let expulsado = null, gano;
  if (motivo === 'votacion') { const r = I.resultado(v, s.impostor); expulsado = r.expulsado; gano = r.ganoGrupo ? 'grupo' : 'impostor'; }
  else gano = motivo === 'se_fue_impostor' ? 'grupo' : 'impostor';
  cambiar(p, { estado: 'terminada', estado_juego: { ...p.estado_juego, fase: 'final', impostor: s.impostor, palabra: s.palabra, palabra_impostor: s.palabra_impostor,
    votos: Object.fromEntries(v), conteo: I.conteo(v), expulsado, gano, motivo, ahora_ms: Date.now() } });
}

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
  const e = p.estado_juego;
  if (fn === 'salir_partida') {
    const j = db.jugadores.find((x) => x.partida === p.id && x.persona === uid);
    if (p.estado === 'espera') {
      if (p.creador === uid) cambiar(p, { estado: 'terminada', estado_juego: { fase: 'cancelada', ahora_ms: Date.now() } });
      db.jugadores = db.jugadores.filter((x) => x !== j); emitir('jugadores', 'DELETE', j);
      return { data: null };
    }
    j.se_fue = true; emitir('jugadores', 'UPDATE', j);
    if (p.estado !== 'jugando') return { data: null };
    const s = I.sigue(activos(p.id), secretos.get(p.id).impostor);
    if (s === 'gana_grupo') terminar(p, 'se_fue_impostor');
    else if (s === 'gana_impostor') terminar(p, 'quedan_dos');
    else if (e.fase === 'votacion' && votaronActivos(p.id) >= activos(p.id).length) terminar(p, 'votacion');
    return { data: null };
  }
  if (fn === 'mi_palabra') {
    if (p.juego !== 'impostor' || p.estado !== 'jugando') return err('No hay palabra para esta partida');
    const s = secretos.get(p.id);
    return { data: uid === s.impostor ? s.palabra_impostor : s.palabra };
  }
  if (fn === 'avanzar_partida') {
    if (a.p_ronda != null && (e.ronda || 0) !== a.p_ronda) return { data: e };
    if (a.p_fase != null && (e.fase || p.estado) !== a.p_fase) return { data: e };
    if (p.estado === 'terminada') return { data: e };
    if (p.estado === 'espera') {
      if (p.creador !== uid) return err('Solo quien armó la partida la puede arrancar');
      const js = activos(p.id);
      if (js.length < 3) return err('El Impostor necesita al menos 3 jugadores');
      const par = Palabras[(semilla * 31) % Palabras.length];
      const r = I.repartir(js, par, semilla++);
      secretos.set(p.id, { impostor: r.impostor, palabra: par.palabra, palabra_impostor: par.impostor });
      votos.set(p.id, new Map());
      const t = Date.now();
      cambiar(p, { estado: 'jugando', estado_juego: { fase: 'palabra', ronda: 1, orden: js.slice().reverse(), inicio_ms: t, limite_ms: t + DUR.palabra, ahora_ms: t, votaron: [] } });
      return { data: p.estado_juego };
    }
    const vencido = Date.now() >= e.limite_ms;
    // como la 16: la votación no la cierra ni el creador antes de tiempo, salvo que hayan votado todos
    if (e.fase === 'votacion') { if (!vencido && votaronActivos(p.id) < activos(p.id).length) return err('Todavía no: falta que voten todos o que se termine el tiempo'); }
    else if (p.creador !== uid && !vencido) return err('Todavía no: falta que se termine el tiempo o que avance quien armó la partida');
    if (SIGUIENTE[e.fase]) fase(p, SIGUIENTE[e.fase]); else if (e.fase === 'votacion') terminar(p, 'votacion');
    return { data: p.estado_juego };
  }
  if (fn === 'votar') {
    if (p.estado !== 'jugando' || e.fase !== 'votacion') return err('No hay una votación abierta');
    if (e.ronda !== a.p_ronda) return err('Esa no es la votación actual');
    if (Date.now() > e.limite_ms + 1000) return err('Se terminó el tiempo');
    if (a.p_persona === uid) return err('No te podés votar a vos');
    if (!activo(a.p_persona, p.id)) return err('Esa persona no está en la partida');
    const v = votos.get(p.id);
    if (v.has(uid)) return err('Ya votaste');
    v.set(uid, a.p_persona);
    cambiar(p, { estado_juego: { ...e, votaron: e.votaron.concat(uid) } });
    if (votaronActivos(p.id) >= activos(p.id).length) terminar(p, 'votacion');
    return { data: null };
  }
  return err('sin rpc ' + fn);
}

function consulta(uid, s) {
  contar(uid, s.table + ':' + s.action);
  if (s.table === 'mensajes' && s.action === 'insert') {
    if (!visible.mensajes(uid, s.values)) return err('RLS', '42501');
    const f = { id: 'mmmmmmmm-mmmm-4mmm-8mmm-' + String(++uuidN).padStart(12, '0'), autor: uid, tipo: 'texto', texto: null, archivo: null, ancho: null, alto: null, editado: false, creado: iso(), ...s.values };
    db.mensajes.push(f); emitir('mensajes', 'INSERT', f);
    return { data: s.single ? f : [f] };
  }
  if (s.action !== 'select') return err('solo por RPC', '42501');
  let r = (db[s.table] || []).filter((f) => visible[s.table](uid, f) && cumple(f, s.filtros));
  if (s.ordenes.length) r = [...r].sort((a, b) => { for (const o of s.ordenes) { if (a[o.col] !== b[o.col]) return (a[o.col] < b[o.col] ? -1 : 1) * (o.asc ? 1 : -1); } return 0; });
  if (s.limite) r = r.slice(0, s.limite);
  r = JSON.parse(JSON.stringify(r));
  return { data: s.single ? r[0] || null : r };
}

// ---------- Cliente falso que se inyecta en lugar de vendor/supabase.js (el mismo de prueba-juegos-mock.js) ----------
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
  const pasa = (filtro, fila) => { if (!filtro) return true; const m = /^(\\w+)=eq\\.(.+)$/.exec(filtro); return !!m && String(fila[m[1]]) === m[2]; };
  window.__emitir = (tabla, evento, fila) => canales.forEach((c) => c.cbs.filter((x) => x.tabla === tabla && (x.evento === '*' || x.evento === evento) && (evento === 'DELETE' ? !x.filtro : pasa(x.filtro, fila))).forEach((x) => x.fn({ eventType: evento, new: evento === 'DELETE' ? {} : fila, old: evento === 'DELETE' ? fila : {} })));
  window.__estadoCanales = (st) => canales.forEach((c) => c.estado && c.estado(st));
  window.supabase = { createClient() {
    return {
      from: Builder,
      rpc(fn, args) { const pr = window.__rpc(fn, JSON.stringify(args || {})).then((r) => { const x = JSON.parse(r); return { data: x.data === undefined ? null : x.data, error: x.error || null }; }); return { then: (a, b) => pr.then(a, b) }; },
      channel(topic) {
        const c = { topic, cbs: [], on(_t, f, fn) { c.cbs.push({ tabla: f.table, evento: f.event, filtro: f.filter, fn }); return c; }, subscribe(cb) { c.estado = cb; canales.add(c); if (cb) setTimeout(() => cb('SUBSCRIBED'), 0); return c; } };
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
  // un navegador por jugador: una pestaña en segundo plano frena los timers
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  navegadores.push(browser);
  const page = await browser.newPage();
  const reg = { page, uid, desconectada: false, recibido: [] };
  paginas.push(reg);
  page.errores = [];
  page.on('pageerror', (e) => page.errores.push(e.message));
  if (process.env.DEPURAR) page.on('console', (m) => console.log('[' + LETRA[uid] + ']', m.text()));
  await page.exposeFunction('__q', async (j) => { const r = consulta(uid, JSON.parse(j)); anotar(uid, r); return JSON.stringify(r); });
  await page.exposeFunction('__rpc', async (fn, j) => { const r = rpc(uid, fn, JSON.parse(j)); anotar(uid, r); return JSON.stringify(r); });
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  page.on('request', (rq) => {
    if (rq.url().endsWith('/vendor/supabase.js')) rq.respond({ status: 200, contentType: 'application/javascript', body: STUB });
    else if (/fonts\.(googleapis|gstatic)\.com/.test(rq.url())) rq.respond({ status: 200, contentType: 'text/css', body: '' });
    else if (/\/contenido\//.test(rq.url())) { reg.pidioContenido = true; rq.continue(); }
    else rq.continue();
  });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.goto(URL_APP + '/#/juegos', { waitUntil: 'networkidle0' });
  await page.evaluate((p) => { App.modoAcceso(false); App.setPerfil(p); }, db.perfiles.find((p) => p.id === uid));
  await page.waitForSelector('#btn-nueva-partida', { timeout: 8000 });
  return reg;
}
const texto = (p, sel) => p.$eval(sel, (e) => e.textContent);
const clic = (p, sel) => p.$eval(sel, (e) => e.click());
const cuantos = (p, sel) => p.$$eval(sel, (e) => e.length);
const esperar = (p, fn, ...a) => p.waitForFunction(fn, { timeout: 10000 }, ...a);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
async function capturas(p, nombre) {
  await p.evaluate(() => { const t = document.getElementById('toast'); t.hidden = true; document.getElementById('pantallas').scrollTop = 0; });
  await p.screenshot({ path: path.join(shots, 'impostor-' + nombre + '-claro.png') });
  await p.evaluate(() => document.getElementById('btn-tema').click());
  await p.screenshot({ path: path.join(shots, 'impostor-' + nombre + '-oscuro.png') });
  await p.evaluate(() => document.getElementById('btn-tema').click());
}

(async () => {
  let fallas = 0;
  const paso = async (nombre, fn) => { try { await fn(); console.log('ok', nombre); } catch (e) { fallas++; console.log('FALLA', nombre, '-', e.message); } };
  try {
    const A = await abrir(UA), B = await abrir(UB), C = await abrir(UC);
    const [pa, pb, pc] = [A.page, B.page, C.page];
    const TODAS = [A, B, C];
    const de = (uid) => TODAS.find((r) => r.uid === uid);
    await Promise.all(TODAS.map((r) => esperar(r.page, () => /Abiertas para unirse/.test(document.getElementById('pantalla-juegos').textContent))));

    // Arma una partida de Impostor: A la crea, B y C se unen. Devuelve el id.
    async function armar(conPasos) {
      await clic(pa, '#btn-nueva-partida');
      await pa.waitForSelector('#nueva-impostor');
      if (conPasos) {
        assert.equal(await pa.$eval('#nueva-impostor', (b) => b.disabled), false, 'el Impostor sigue deshabilitado');
        assert.doesNotMatch(await texto(pa, '#nueva-impostor'), /Próximamente/);
      }
      await clic(pa, '#nueva-impostor');
      await pa.waitForSelector('#btn-arrancar');
      const id = db.partidas[db.partidas.length - 1].id;
      for (const r of [B, C]) {
        await esperar(r.page, (x) => !!document.querySelector('.tarjeta-partida[data-id="' + x + '"]'), id);
        await r.page.$eval('.tarjeta-partida[data-id="' + id + '"]', (b) => b.click());
        await r.page.waitForSelector('#btn-unirme');
        await clic(r.page, '#btn-unirme');
        await r.page.waitForSelector('#esperando-creador');
        if (conPasos && r === B) {
          await esperar(pa, () => /Beto Gómez/.test(document.getElementById('sala-jugadores').textContent));
          assert.equal(await pa.$eval('#btn-arrancar', (b) => b.disabled), true, 'con 2 no debería poder arrancar');
          assert.match(await texto(pa, '#faltan-jugadores'), /Falta 1 jugador/);
        }
      }
      await esperar(pa, () => !document.getElementById('btn-arrancar').disabled);
      return id;
    }

    let par;
    await paso('Impostor disponible; con 2 no arranca; con 3 sí', async () => {
      par = await armar(true);
      assert.equal(activos(par).length, 3);
    });

    let palabras = {};
    await paso('al arrancar cada ventana ve solo su palabra: 2 iguales y 1 distinta', async () => {
      TODAS.forEach((r) => { r.recibido.length = 0; });
      await clic(pa, '#btn-arrancar');
      for (const r of TODAS) {
        await esperar(r.page, () => { const x = document.getElementById('impostor-palabra'); return x && !/Cargando/.test(x.textContent); });
        palabras[LETRA[r.uid]] = (await texto(r.page, '#impostor-palabra')).trim();
      }
      const s = secretos.get(par);
      assert.equal(palabras[LETRA[s.impostor]], s.palabra_impostor);
      TODAS.filter((r) => r.uid !== s.impostor).forEach((r) => assert.equal(palabras[LETRA[r.uid]], s.palabra));
      assert.match(await texto(pa, '#impostor-fase'), /Tu palabra/);
      assert.equal(await cuantos(pb, '#btn-imp-avanzar'), 0, 'solo el creador ve el botón para avanzar');
      await capturas(de(s.impostor === UA ? UB : UA).page, 'palabra');
    });

    const sinFiltrar = (r) => {
      const s = secretos.get(par);
      const mia = r.uid === s.impostor ? s.palabra_impostor : s.palabra;
      const ajena = r.uid === s.impostor ? s.palabra : s.palabra_impostor;
      const todo = r.recibido.join('\n');
      assert.ok(todo.includes(JSON.stringify(mia)), LETRA[r.uid] + ': no se capturó ni su propia palabra (la prueba no estaría mirando nada)');
      assert.ok(!todo.includes(JSON.stringify(ajena)), LETRA[r.uid] + ' recibió la palabra ajena');
      assert.ok(!/"impostor"\s*:/.test(todo), LETRA[r.uid] + ' recibió quién es el impostor');
      assert.ok(!/"votos"\s*:/.test(todo), LETRA[r.uid] + ' recibió los votos');
    };
    await paso('a ninguna ventana le llega la palabra ajena ni quién es el impostor', async () => {
      TODAS.forEach(sinFiltrar);
      TODAS.forEach((r) => assert.ok(!r.pidioContenido, 'el cliente cargó contenido/'));
    });

    await paso('vencido el tiempo pasa solo a las pistas (sin el creador); las pistas van por el chat', async () => {
      A.desconectada = true; // el creador "se cuelga": avanzan los timers de B y C
      await esperar(pb, () => /Pistas/.test((document.getElementById('impostor-fase') || {}).textContent || ''));
      A.desconectada = false;
      await pa.evaluate(() => window.__estadoCanales('SUBSCRIBED')); // A reconecta y se pone al día
      await esperar(pa, () => /Pistas/.test((document.getElementById('impostor-fase') || {}).textContent || ''));
      assert.equal(fasesHechas.filter((f) => f === 'pistas').length, 1, 'se avanzó más de una vez');
      assert.equal(await cuantos(pb, '#impostor-orden li'), 3);
      assert.match(await texto(pb, '#impostor-palabra'), new RegExp(palabras.B));
      for (const [r, pista] of [[B, 'zz se toma caliente'], [C, 'zz es de acá']]) {
        await r.page.type('#chat-par textarea', pista);
        await r.page.$eval('#chat-par form', (f) => f.requestSubmit());
      }
      await esperar(pa, () => /zz se toma caliente/.test(document.getElementById('chat-par').textContent) && /zz es de acá/.test(document.getElementById('chat-par').textContent));
      await capturas(pb, 'pistas');
    });

    await paso('el creador pasa a la votación; nadie se puede votar a sí mismo', async () => {
      await clic(pa, '#btn-imp-avanzar');
      for (const r of TODAS) {
        await esperar(r.page, () => document.querySelectorAll('.voto-imp').length === 2);
        const ids = await r.page.$$eval('.voto-imp', (xs) => xs.map((x) => x.dataset.persona));
        assert.ok(!ids.includes(r.uid), LETRA[r.uid] + ' se puede votar a sí mismo');
      }
      assert.match(await texto(pb, '#impostor-estado'), /0 de 3 ya votaron/);
      for (const r of TODAS) assert.equal(await cuantos(r.page, '#btn-imp-avanzar'), 0, LETRA[r.uid] + ' ve un botón para cerrar la votación');
      await capturas(pb, 'votacion');
    });

    await paso('B vota: se marca su voto, no puede votar dos veces y A no ve a quién votó', async () => {
      const s = secretos.get(par);
      const aQuien = s.impostor === UB ? UA : s.impostor;
      await clic(pb, '.voto-imp[data-persona="' + aQuien + '"]');
      await esperar(pb, () => /Votaste a/.test(document.getElementById('impostor-estado').textContent));
      assert.equal(await cuantos(pb, '.voto-imp.elegida'), 1);
      assert.equal(await pb.$$eval('.voto-imp', (xs) => xs.every((x) => x.disabled)), true);
      const antes = n('B:rpc:votar');
      await pb.evaluate(() => document.querySelectorAll('.voto-imp')[0].click());
      await dormir(200);
      assert.equal(n('B:rpc:votar'), antes);
      await esperar(pa, () => /1 de 3 ya votaron/.test(document.getElementById('impostor-estado').textContent));
      assert.equal(await cuantos(pa, '#btn-imp-avanzar'), 0, 'el creador ve un botón para cerrar la votación');
      TODAS.forEach(sinFiltrar);
    });

    await paso('al votar todos se revela en las tres ventanas, con el resultado de ImpostorLogica.resultado', async () => {
      const s = secretos.get(par);
      // A y C votan a B (si B es el impostor, gana el grupo; si no, lo echan y gana el impostor)
      await clic(pa, '.voto-imp[data-persona="' + UB + '"]');
      await clic(pc, '.voto-imp[data-persona="' + UB + '"]');
      for (const r of TODAS) await r.page.waitForSelector('#impostor-resultado');
      const e = db.partidas.find((p) => p.id === par).estado_juego;
      const esp = I.resultado(votos.get(par), s.impostor);
      assert.equal(e.gano, esp.ganoGrupo ? 'grupo' : 'impostor');
      for (const r of TODAS) {
        assert.match(await texto(r.page, '#impostor-resultado'), esp.ganoGrupo ? /Ganó el grupo/ : /Ganó el impostor/);
        assert.match(await texto(r.page, '#impostor-era'), new RegExp(db.perfiles.find((x) => x.id === s.impostor).nombre));
        assert.match(await texto(r.page, '#impostor-palabras'), new RegExp(s.palabra + '.*' + s.palabra_impostor));
      }
      assert.match(await texto(de(s.impostor).page, '#impostor-era'), /Eras vos/);
      assert.match(await texto(pa, '#impostor-votos'), /2 votos/);
      assert.equal(await cuantos(pa, '.salir-partida'), 0, 'terminada: ya no hay "Salir"');
      await capturas(pb, 'revelacion');
    });

    await paso('"Volver a Juegos" lleva a la lista y la partida figura en Terminadas', async () => {
      for (const r of TODAS) await clic(r.page, '#btn-volver-juegos');
      for (const r of TODAS) await esperar(r.page, () => /Terminadas/.test(document.getElementById('pantalla-juegos').textContent));
    });

    await paso('Review Focus 5: si el impostor se va a la mitad, gana el grupo en las otras ventanas', async () => {
      par = await armar(false);
      await clic(pa, '#btn-arrancar');
      for (const r of TODAS) await esperar(r.page, () => !!document.getElementById('impostor-palabra'));
      const imp = de(secretos.get(par).impostor);
      await clic(imp.page, '#btn-salir');
      await imp.page.waitForSelector('#aviso-salir');
      assert.match(await texto(imp.page, '#aviso-salir-txt'), /no podés volver/);
      await clic(imp.page, '#btn-salir-si');
      await esperar(imp.page, () => /Abiertas para unirse/.test(document.getElementById('pantalla-juegos').textContent));
      for (const r of TODAS.filter((x) => x !== imp)) {
        await r.page.waitForSelector('#impostor-resultado');
        assert.match(await texto(r.page, '#impostor-resultado'), /Ganó el grupo.*se fue/s);
      }
      await capturas(TODAS.find((x) => x !== imp).page, 'se-fue');
      for (const r of TODAS.filter((x) => x !== imp)) await clic(r.page, '#btn-volver-juegos');
    });

    await paso('Review Focus 5: si se va un inocente en la votación y quedan 2, gana el impostor', async () => {
      for (const r of TODAS) await esperar(r.page, () => /Abiertas para unirse/.test(document.getElementById('pantalla-juegos').textContent));
      par = await armar(false);
      await clic(pa, '#btn-arrancar');
      await esperar(pa, () => !!document.getElementById('btn-imp-avanzar'));
      await clic(pa, '#btn-imp-avanzar');
      await esperar(pa, () => /Pistas/.test((document.getElementById('impostor-fase') || {}).textContent || '') && !document.getElementById('btn-imp-avanzar').disabled);
      await clic(pa, '#btn-imp-avanzar');
      for (const r of TODAS) await esperar(r.page, () => document.querySelectorAll('.voto-imp').length === 2);
      const s = secretos.get(par);
      const inocente = TODAS.find((r) => r.uid !== s.impostor && r.uid !== UA) || TODAS.find((r) => r.uid !== s.impostor);
      await clic(inocente.page, '#btn-salir');
      await clic(inocente.page, '#btn-salir-si');
      for (const r of TODAS.filter((x) => x !== inocente)) {
        await r.page.waitForSelector('#impostor-resultado');
        assert.match(await texto(r.page, '#impostor-resultado'), /Ganó el impostor.*dos jugadores/s);
      }
    });

    for (const r of paginas) if (r.page.errores.length) { fallas++; console.log('FALLA errores de página:', r.page.errores); }
  } finally { for (const b of navegadores) await b.close().catch(() => {}); }
  console.log(fallas ? fallas + ' falla(s)' : 'todo ok');
  process.exit(fallas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
