// Capturas de las pantallas principales con datos de ejemplo, SIN red ni usuarios reales: un Supabase falso de solo
// lectura (alcanza para pintar), a 390x844, en claro y oscuro. Sirve para comparar el diseño antes y después.
// Uso: servir la raíz (`npx --yes http-server -p 8080 -c-1`) y correr
//   node dev/tools/capturas-rediseno.js [prefijo]     (por defecto "rediseno"; deja dev/shots/<prefijo>-<pantalla>-<tema>.png)
// Con ANCHO=360 (o ANCHO=740 ALTO=360, teléfono en horizontal) cambia el tamaño de la ventana.
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const URL_APP = process.env.URL_APP || 'http://127.0.0.1:8080';
const PREFIJO = process.argv[2] || 'rediseno';
const ANCHO = Number(process.env.ANCHO) || 390;
const ALTO = Number(process.env.ALTO) || 844;
const shots = path.join(__dirname, '..', 'shots');
fs.mkdirSync(shots, { recursive: true });

const UA = '11111111-1111-4111-8111-111111111111', UB = '22222222-2222-4222-8222-222222222222', UC = '33333333-3333-4333-8333-333333333333', UD = '44444444-4444-4444-8444-444444444444';
const ahora = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const DIA = 864e5;
let n = 0;
const id = () => 'a0000000-0000-4000-8000-' + String(++n).padStart(12, '0');
const act = (titulo, tipo, dias, extra) => ({ id: id(), creador: UA, tipo, tipo_otro: null, titulo, fecha: iso(ahora + dias * DIA), lugar: 'Club Social', cupo: null, descripcion: '', tiene_tercer: false, tercer_lugar: null, tercer_fecha: null, estado: 'abierta', creado: iso(ahora - 1e6), drive_url: null, ...extra });
const ASADO = act('Asado de fin de mes', 'asado', 2.2, { lugar: 'Quincho de Wemox', tiene_tercer: true, tercer_lugar: 'Bar La Esquina', tercer_fecha: iso(ahora + 2.2 * DIA + 3 * 36e5), descripcion: 'Cada uno trae su bebida. La carne la compramos entre todos.', estado: 'confirmada' });
const db = {
  perfiles: [
    { id: UA, nombre: 'Ana Pérez', foto: null, empresa: 'CEDI' },
    { id: UB, nombre: 'Beto Gómez', foto: null, empresa: 'Wemox' },
    { id: UC, nombre: 'Carla Ruiz', foto: null, empresa: 'Korex' },
    { id: UD, nombre: 'Diego Sosa', foto: null, empresa: 'Vulps' },
  ],
  actividades: [
    act('Fútbol 5 del martes', 'futbol', 0.9, { lugar: 'Cancha de Palermo', cupo: 10, estado: 'confirmada' }),
    ASADO,
    act('Pádel después del laburo', 'padel', 3.1, { lugar: 'Club Belgrano', cupo: 4, tiene_tercer: true, tercer_lugar: 'Cervecería Antares', tercer_fecha: iso(ahora + 3.1 * DIA + 2 * 36e5) }),
    act('After de fin de sprint', 'after', 5, { lugar: 'Terraza de PiConsulting', estado: 'cancelada' }),
    act('Torneo de truco', 'otra', -20, { tipo_otro: 'Truco', lugar: 'Oficina CEDI' }),
    act('Trekking al cerro', 'trekking', 9, { lugar: 'Cerro Uritorco', cupo: 12 }),
    act('Fútbol del jueves pasado', 'futbol', -6, { lugar: 'Cancha de Palermo' }),
    act('Asado de bienvenida', 'asado', -12, { lugar: 'Terraza CEDI', tiene_tercer: true, tercer_lugar: 'Bar Roma', tercer_fecha: iso(ahora - 12 * DIA + 3 * 36e5) }),
  ],
  asistencias: [],
  mensajes: [],
  gastos: [], gasto_partes: [], pagos: [], fotos: [],
  partidas: [], jugadores: [], respuestas: [], push_subs: [],
};
for (const a of db.actividades) {
  const k = a.cupo ? Math.min(a.cupo - 1, 3) : 3;
  [UA, UB, UC, UD].slice(0, k).forEach((p) => db.asistencias.push({ actividad: a.id, persona: p, parte: 'actividad' }));
  if (a.tiene_tercer) [UA, UC].forEach((p) => db.asistencias.push({ actividad: a.id, persona: p, parte: 'tercer' }));
}
const sala = 'act:' + ASADO.id;
const msg = (autor, texto, min) => ({ id: id(), sala, autor, tipo: 'texto', texto, archivo: null, ancho: null, alto: null, editado: false, creado: iso(ahora - min * 6e4) });
db.mensajes.push(msg(UB, '¿Quién se encarga del carbón?', 50), msg(UA, 'Yo llevo carbón y la sal gruesa', 44), msg(UC, 'Genial. Yo paso por la carnicería a la mañana', 30), msg(UA, 'Nos vemos a las 13 en el quincho', 5));
const G1 = id(), G2 = id();
db.gastos.push({ id: G1, actividad: ASADO.id, parte: 'actividad', pagador: UC, monto: 24000, concepto: 'Carne', creado: iso(ahora - 3e6), cargado_por: UC },
  { id: G2, actividad: ASADO.id, parte: 'actividad', pagador: UA, monto: 4500, concepto: 'Carbón', creado: iso(ahora - 2e6), cargado_por: UA });
[UA, UB, UC].forEach((p) => db.gasto_partes.push({ gasto: G1, persona: p }, { gasto: G2, persona: p }));
const COLORES = ['#2E6A8E', '#8E5B2E', '#3E7A4C', '#6B4C8E', '#8E2E4A', '#4C6B8E'];
COLORES.forEach((c, i) => { const f = id(); db.fotos.push({ id: f, actividad: ASADO.id, autor: [UA, UB, UC][i % 3], ruta: ASADO.id + '/' + f + '.jpg', mini: ASADO.id + '/' + f + '.t.webp', media: null, ancho: 800, alto: 800, bytes: 1, tomada: iso(ahora - i * 6e5), creado: iso(ahora - i * 6e5), editada_de: null, drive_id: null, liberada: false }); });
const colorDe = (ruta) => COLORES[db.fotos.findIndex((f) => f.mini === ruta || f.ruta === ruta) % COLORES.length] || '#556';
const svgFoto = (c) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="${c}"/><circle cx="150" cy="55" r="22" fill="#fff" opacity=".55"/><path d="M0 200 L70 110 L120 160 L150 130 L200 180 V200Z" fill="#000" opacity=".25"/></svg>`);
const partida = (juego, estado, min, gente) => { const p = { id: id(), juego, creador: UB, estado, estado_juego: estado === 'terminada' ? { fase: 'final' } : {}, creado: iso(ahora - min * 6e4) }; db.partidas.push(p); (gente || [UB, UC]).forEach((x) => db.jugadores.push({ partida: p.id, persona: x, puntos: estado === 'terminada' ? 4200 : 0, se_fue: false })); };
partida('trivia', 'espera', 3); partida('impostor', 'espera', 8, [UB, UC, UD]); partida('trivia', 'terminada', 90, [UA, UB]);

const cumple = (fila, filtros) => filtros.every(([op, col, v]) => (op === 'eq' ? fila[col] === v : op === 'in' ? v.includes(fila[col]) : true));
let vacia = false;
function consulta(uid, s) {
  if (s.action === 'rpc') {
    if (s.table === 'album_uso') return { data: 120 * 1024 * 1024 };
    if (s.table === 'ahora_ms') return { data: Date.now() };
    return { data: null };
  }
  if (s.action === 'storage') return { data: s.values.map((p) => ({ path: p, signedUrl: s.bucket === 'album' || s.bucket === 'chat' ? svgFoto(colorDe(p)) : null, error: null })) };
  if (s.action !== 'select') return { data: null };
  let filas = db[s.table] || [];
  if (vacia && s.table === 'actividades') filas = [];
  let r = filas.filter((f) => cumple(f, s.filtros));
  if (s.ordenes.length) r = [...r].sort((a, b) => { for (const o of s.ordenes) { if (a[o.col] !== b[o.col]) return (a[o.col] < b[o.col] ? -1 : 1) * (o.asc ? 1 : -1); } return 0; });
  if (s.limite) r = r.slice(0, s.limite);
  return { data: s.single ? r[0] || null : r.map((x) => ({ ...x })) };
}

const STUB = `
(function () {
  const Q = (spec) => window.__q(JSON.stringify(spec)).then((r) => JSON.parse(r));
  const forma = (r) => ({ data: r.data === undefined ? null : r.data, error: r.error || null });
  function Builder(table) {
    const s = { table, action: 'select', filtros: [], ordenes: [], limite: 0, single: false, values: null };
    const b = {
      select() { return b; }, insert(v) { s.action = 'insert'; s.values = v; return b; }, update(v) { s.action = 'update'; s.values = v; return b; },
      delete() { s.action = 'delete'; return b; }, upsert() { s.action = 'upsert'; return b; },
      eq(c, v) { s.filtros.push(['eq', c, v]); return b; }, in(c, v) { s.filtros.push(['in', c, v]); return b; },
      lt() { return b; }, gt() { return b; }, gte() { return b; }, or() { return b; }, neq() { return b; },
      order(col, o) { s.ordenes.push({ col, asc: !(o && o.ascending === false) }); return b; },
      limit(n) { s.limite = n; return b; }, single() { s.single = true; return b; }, maybeSingle() { s.single = true; return b; },
      then(res, rej) { return Q(s).then(forma).then(res, rej); },
    };
    return b;
  }
  window.supabase = { createClient() {
    return {
      from: Builder,
      rpc(nombre, args) { return Q({ table: nombre, action: 'rpc', values: args, filtros: [], ordenes: [] }).then(forma); },
      channel(topic) { const c = { topic, on() { return c; }, subscribe(cb) { if (cb) setTimeout(() => cb('SUBSCRIBED'), 0); return c; }, send: async () => 'ok' }; return c; },
      removeChannel() {},
      storage: { from(bucket) { return { upload: async (p) => ({ data: { path: p }, error: null }), remove: async () => ({ data: [], error: null }),
        createSignedUrls: (paths) => Q({ action: 'storage', bucket, values: paths, filtros: [], ordenes: [] }).then(forma) }; } },
      functions: { invoke: async () => ({ data: null, error: null }) },
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}), getUser: async () => ({ data: { user: null } }) },
    };
  } };
})();`;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// En un teléfono o emulador Android: CDP_URL=http://127.0.0.1:<puerto> (adb forward tcp:<puerto>
// localabstract:chrome_devtools_remote) y SERIAL=<serial de adb>. Se maneja la pestaña de Chrome que tenga la app y
// las capturas son de la pantalla real (adb exec-out screencap). Ahí solo se sacan las vistas sin agrandar la ventana.
const CDP = process.env.CDP_URL;
const SERIAL = process.env.SERIAL;
const ADB = path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe');

(async () => {
  const browser = CDP ? await puppeteer.connect({ browserURL: CDP, defaultViewport: null })
    : await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const errores = [];
  const preparadas = new WeakSet();
  async function pagina(tema, conSesion) {
    let page;
    if (CDP) page = (await browser.pages()).find((p) => p.url().startsWith(URL_APP)) || await browser.newPage();
    else page = await browser.newPage();
    if (!preparadas.has(page)) {
      preparadas.add(page);
      page.on('pageerror', (e) => errores.push(e.message));
      await page.exposeFunction('__q', async (j) => JSON.stringify(consulta(UA, JSON.parse(j))));
      await page.setBypassServiceWorker(true);
      await page.setRequestInterception(true);
      page.on('request', (rq) => {
        if (rq.url().endsWith('/vendor/supabase.js')) rq.respond({ status: 200, contentType: 'application/javascript', body: STUB });
        else rq.continue();
      });
    }
    await page.evaluateOnNewDocument((t) => { try { localStorage.setItem('tema', t); } catch (e) {} }, tema);
    if (!CDP) await page.setViewport({ width: ANCHO, height: ALTO, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(URL_APP + '#/actividades', { waitUntil: 'networkidle0' });
    if (CDP) await page.reload({ waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    if (conSesion) {
      await page.evaluate((p) => { App.modoAcceso(false); App.setPerfil(p); }, db.perfiles[0]);
      await page.waitForSelector('.tarjeta-act, #pantalla-actividades .vacio', { timeout: 8000 });
      await dormir(300);
    } else {
      await page.evaluate(() => { App.modoAcceso(true); });
    }
    return page;
  }
  const foto = async (page, nombre, tema, completa) => {
    await dormir(CDP ? 900 : 250);
    const destino = path.join(shots, `${PREFIJO}-${nombre}-${tema}.png`);
    if (SERIAL) fs.writeFileSync(destino, require('child_process').execFileSync(ADB, ['-s', SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 64e6 }));
    else await page.screenshot({ path: destino, fullPage: !!completa });
  };
  const scrollArriba = (page) => page.evaluate(() => { document.getElementById('pantallas').scrollTop = 0; });
  // fullPage no sirve con el scroll dentro de #pantallas: se agranda la ventana al alto del contenido
  async function completa(page, nombre, tema) {
    if (CDP) return;
    const alto = await page.evaluate(() => { const p = document.getElementById('pantallas'); return p.scrollHeight + (window.innerHeight - p.clientHeight); });
    await page.setViewport({ width: ANCHO, height: Math.min(alto, 4000), deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await foto(page, nombre, tema);
    await page.setViewport({ width: ANCHO, height: ALTO, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  }

  for (const tema of ['claro', 'oscuro']) {
    const login = await pagina(tema, false);
    await foto(login, 'login', tema);
    if (!CDP) await login.close();

    const p = await pagina(tema, true);
    await foto(p, 'lista', tema);
    await completa(p, 'lista-completa', tema);
    // el filtro es un toggle: Pádel filtra; Otra no tiene próximas (su única actividad ya pasó); tocarla de nuevo
    // vuelve a mostrar todas
    const tocar = (tipo) => p.evaluate((t) => document.querySelector('#pantalla-actividades .seg[data-tipo="' + t + '"]').click(), tipo);
    await tocar('padel');
    await foto(p, 'lista-padel', tema);
    await tocar('otra');
    await foto(p, 'lista-filtro', tema);
    await tocar('otra');
    if (await p.$('#pantalla-actividades .seg.activo')) throw new Error('tocar el tipo activo no desmarcó el filtro');
    // detalle del asado
    await p.evaluate((t) => [...document.querySelectorAll('.tarjeta-act')].find((e) => e.textContent.includes(t)).click(), ASADO.titulo);
    await p.waitForSelector('#chat-act');
    await dormir(800);
    await scrollArriba(p);
    await foto(p, 'detalle', tema);
    await completa(p, 'detalle-completo', tema);
    await p.evaluate(() => document.getElementById('talon-tercer').scrollIntoView({ block: 'center' }));
    await foto(p, 'detalle-talon', tema);
    // formulario
    await p.evaluate(() => [...document.querySelectorAll('#pantalla-actividades .btn-link')].find((b) => /Volver/.test(b.textContent)).click());
    await p.evaluate(() => document.getElementById('btn-nueva-act').click());
    await p.evaluate(() => { const c = document.getElementById('f-tercer'); c.click(); });
    await scrollArriba(p);
    await completa(p, 'form', tema);
    // juegos y perfil
    await p.evaluate(() => { location.hash = '#/juegos'; });
    await dormir(700);
    await foto(p, 'juegos', tema);
    await p.evaluate(() => { location.hash = '#/perfil'; });
    await dormir(500);
    await completa(p, 'perfil', tema);
    if (!CDP) await p.close();

    vacia = true;
    const v = await pagina(tema, true);
    await foto(v, 'lista-vacia', tema);
    if (!CDP) await v.close();
    vacia = false;
  }
  if (CDP) await browser.disconnect(); else await browser.close();
  if (errores.length) { console.log('Errores en la página:\n' + errores.join('\n')); process.exitCode = 1; }
  else console.log('Capturas en', shots);
})().catch((e) => { console.error(e); process.exit(1); });
