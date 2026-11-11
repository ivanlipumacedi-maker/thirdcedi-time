// Prueba de la UI del chat SIN red ni usuarios reales: un Supabase falso en memoria (vive en este proceso y atiende a dos
// páginas, "ventana A" y "ventana B", con la misma regla de sala que la base: solo ve y escribe quien está anotado).
// Verifica: carga, envío, llegada en vivo entre ventanas, editar, eliminar (y qué archivos se borran según tipo_antes),
// foto, reconexión sin duplicados, error inicial con "Reintentar", que quien no está anotado no ve el chat y que con el
// chat cerrado no se lee nada. Y lo de la 27 (como Rumbo al Sur): menú con presión larga / clic derecho, responder
// (menú y deslizar) con cita que salta al original y reintento sin cita, reacciones en vivo, fijado en vivo, destacar,
// eliminar para mí, buscar, audio (MediaRecorder falso: soltar manda, deslizar cancela, muy corto no manda), video de la
// galería (con miniatura y visor), stickers del grupo (editor) y de GIPHY (respuestas falsas), y atrás / Escape cierran
// las hojas. Capturas en dev/shots/ (claro y oscuro, 390x844). No toca el proyecto real ni necesita contraseñas.
// Uso: servir la raíz con `npx --yes http-server -p 8080 -c-1` y correr `node dev/tools/prueba-chat-mock.js`
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const puppeteer = require('./navegador'); // puppeteer-core, o WebKit con NAVEGADOR=webkit
const URL_APP = process.env.URL_APP || 'http://127.0.0.1:8080';
const raiz = path.join(__dirname, '..', '..');
const shots = path.join(__dirname, '..', 'shots');
fs.mkdirSync(shots, { recursive: true });
const PNG = fs.readFileSync(path.join(raiz, 'icon-192.png'));

// ---------- "Servidor" en memoria ----------
const UA = '11111111-1111-4111-8111-111111111111', UB = '22222222-2222-4222-8222-222222222222', UC = '33333333-3333-4333-8333-333333333333';
const ACT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SALA = 'act:' + ACT;
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
  mensaje_reacciones: [],
  chat_fijados: [],
  stickers: [],
};
const archivos = new Map(); // path -> { uid, tipo }
const borrados = [];        // cada remove() de Storage: lista de paths
let seq = 0;
const paginas = []; // { page, uid, desconectada }
const enSala = (uid, sala) => { const m = /^act:(.+)$/.exec(sala || ''); return !!m && db.asistencias.some((a) => a.actividad === m[1] && a.persona === uid); };
let fallarMensajes = 0; // cuántas lecturas de mensajes fallan (para probar el error inicial)
const lecturasMensajes = {}; // selects a mensajes por usuario

// como Realtime: lo de una sala llega a quien está en la sala; los DELETE llegan a todos (sin filtro) con la clave
function emitir(tabla, evento, fila, old) {
  for (const p of paginas) {
    if (p.desconectada || (evento !== 'DELETE' && !enSala(p.uid, fila.sala))) continue;
    p.page.evaluate((t, e, f, o) => window.__emitir(t, e, f, o), tabla, evento, fila || {}, old || {}).catch(() => {});
  }
}
// ILIKE de PostgREST: % y _ comodines, \% y \_ literales
const ilike = (v, patron) => new RegExp('^' + patron.replace(/\\([%_\\])|([%_])|([^%_\\]+)/g, (t, esc, com, lit) => (esc ? esc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : com ? (com === '%' ? '.*' : '.') : lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))) + '$', 'is').test(String(v ?? ''));
function cumple(fila, filtros) {
  return filtros.every(([op, col, v]) => (op === 'eq' ? fila[col] === v : op === 'lt' ? fila[col] < v : op === 'in' ? v.includes(fila[col])
    : op === 'or' ? orAntes(fila, v) : op === 'ilike' ? ilike(fila[col], v) : true));
}
// solo entiende el filtro de "Ver mensajes anteriores": creado.lt."X",and(creado.eq."X",id.lt."Y")
function orAntes(fila, expr) {
  const m = /^creado\.lt\."([^"]+)",and\(creado\.eq\."([^"]+)",id\.lt\."([^"]+)"\)$/.exec(expr);
  if (!m) throw new Error('filtro .or desconocido: ' + expr);
  return fila.creado < m[1] || (fila.creado === m[2] && fila.id < m[3]);
}
const rpcs = {}; // llamadas por RPC (editar_mensaje, eliminar_mensaje, fijar_mensaje)
let demorarMensajes = 0; // ms que tarda en volver la próxima lectura de mensajes de A (la foto del servidor se toma al pedir)
const uuid = () => 'm' + String(++seq).padStart(7, '0') + '-0000-4000-8000-000000000000';
const P0002 = (message) => ({ error: { code: 'P0002', message } });

function rpc(uid, fn, a) {
  rpcs[fn] = (rpcs[fn] || 0) + 1;
  if (fn === 'fijar_mensaje') {
    if (!enSala(uid, a.p_sala)) return P0002('No estás en este chat');
    const f = db.chat_fijados.find((x) => x.sala === a.p_sala);
    if (a.p_id == null) {
      if (f) { db.chat_fijados = db.chat_fijados.filter((x) => x !== f); emitir('chat_fijados', 'DELETE', null, { sala: a.p_sala }); }
      return { data: null };
    }
    if (!db.mensajes.some((m) => m.id === a.p_id && m.sala === a.p_sala && m.tipo !== 'eliminado')) return P0002('Ese mensaje no se puede fijar');
    if (f) { Object.assign(f, { mensaje: a.p_id, por: uid }); emitir('chat_fijados', 'UPDATE', f); }
    else { const n = { sala: a.p_sala, mensaje: a.p_id, por: uid, cuando: new Date().toISOString() }; db.chat_fijados.push(n); emitir('chat_fijados', 'INSERT', n); }
    return { data: null };
  }
  const m = db.mensajes.find((x) => x.id === a.p_id);
  if (!m || m.autor !== uid || !enSala(uid, m.sala)) return P0002('No se puede');
  if (fn === 'eliminar_mensaje' && m.tipo === 'eliminado') return P0002('No se puede eliminar'); // como la 09
  if (fn === 'editar_mensaje') {
    const t = String(a.p_texto || '').trim(); // igual que la 09: recorta y, si no cambió, no marca editado
    if (t === m.texto) return { data: { ...m } };
    Object.assign(m, { texto: t, editado: true }); emitir('mensajes', 'UPDATE', m); return { data: m };
  }
  if (fn === 'eliminar_mensaje') {
    const antes = m.archivo, tipoAntes = m.tipo;
    Object.assign(m, { tipo: 'eliminado', texto: null, archivo: null, ancho: null, alto: null, duracion_ms: null, externo: null }); emitir('mensajes', 'UPDATE', m);
    const f = db.chat_fijados.find((x) => x.mensaje === m.id);
    if (f) { db.chat_fijados = db.chat_fijados.filter((x) => x !== f); emitir('chat_fijados', 'DELETE', null, { sala: f.sala }); }
    return { data: { fila: m, archivo_antes: antes, tipo_antes: tipoAntes } };
  }
  return { error: { message: 'rpc desconocida ' + fn } };
}

function consulta(uid, s) {
  if (s.rpc) return rpc(uid, s.rpc, s.args || {});
  if (s.storage === 'upload') {
    const carpeta = s.path.split('/')[0];
    if (carpeta !== 'stickers' && !enSala(uid, carpeta)) return { error: { statusCode: '403', message: 'RLS' } };
    archivos.set(s.path, { uid, tipo: s.tipo }); return { data: { path: s.path } };
  }
  if (s.storage === 'remove') { borrados.push(s.paths); s.paths.forEach((p) => archivos.delete(p)); return { data: [] }; }
  const t = s.table;
  if (t === 'mensajes') {
    if (s.action === 'select') lecturasMensajes[uid] = (lecturasMensajes[uid] || 0) + 1;
    if (s.action === 'select' && fallarMensajes > 0) { fallarMensajes--; return { error: { message: 'sin red' } }; }
    if (s.action === 'insert') {
      const v = s.values;
      if (!enSala(uid, v.sala)) return { error: { code: '42501', message: 'RLS' } };
      // trigger mensajes_cita_valida de la 27
      if (v.responde_a && !db.mensajes.some((m) => m.id === v.responde_a && m.sala === v.sala)) return { error: { code: '23514', message: 'La respuesta tiene que ser a un mensaje del mismo chat' } };
      if (v.externo && !/^https:\/\/media[0-9]*\.giphy\.com\//.test(v.externo)) return { error: { code: '23514', message: 'externo' } };
      const fila = { id: uuid(), sala: v.sala, autor: uid, tipo: v.tipo, texto: v.texto || null, archivo: v.archivo || null, ancho: v.ancho || null, alto: v.alto || null,
        duracion_ms: v.duracion_ms || null, responde_a: v.responde_a || null, externo: v.externo || null, editado: false, creado: new Date().toISOString() };
      db.mensajes.push(fila); emitir('mensajes', 'INSERT', fila);
      return { data: fila };
    }
  }
  if (t === 'mensaje_reacciones') {
    const v = s.values || {};
    if (s.action === 'insert') {
      const m = db.mensajes.find((x) => x.id === v.mensaje);
      if (!m || m.tipo === 'eliminado') return P0002('No se puede reaccionar a este mensaje');
      if (!enSala(uid, m.sala)) return { error: { code: '42501', message: 'RLS' } };
      if (db.mensaje_reacciones.some((r) => r.mensaje === v.mensaje && r.persona === uid)) return { error: { code: '23505', message: 'duplicada' } };
      const r = { mensaje: v.mensaje, persona: uid, clave: v.clave, sala: m.sala, creado: new Date().toISOString() };
      db.mensaje_reacciones.push(r); emitir('mensaje_reacciones', 'INSERT', r);
      return { data: null };
    }
    const mias = db.mensaje_reacciones.filter((r) => r.persona === uid && cumple(r, s.filtros));
    if (s.action === 'update') { mias.forEach((r) => { r.clave = v.clave; emitir('mensaje_reacciones', 'UPDATE', r); }); return { data: null }; }
    if (s.action === 'delete') {
      db.mensaje_reacciones = db.mensaje_reacciones.filter((r) => !mias.includes(r));
      mias.forEach((r) => emitir('mensaje_reacciones', 'DELETE', null, { mensaje: r.mensaje, persona: r.persona }));
      return { data: null };
    }
  }
  if (t === 'stickers') {
    if (s.action === 'insert') {
      if (!/^stickers\/[0-9a-f-]{36}\.webp$/.test(s.values.archivo)) return { error: { code: '23514', message: 'archivo' } };
      const st = { id: uuid(), archivo: s.values.archivo, autor: uid, creado: new Date().toISOString() };
      db.stickers.push(st); return { data: st };
    }
    if (s.action === 'delete') { db.stickers = db.stickers.filter((x) => !(x.autor === uid && cumple(x, s.filtros))); return { data: null }; }
  }
  let filas = db[t] || [];
  if (t === 'mensajes' || t === 'mensaje_reacciones' || t === 'chat_fijados') filas = filas.filter((m) => enSala(uid, m.sala));
  let r = filas.filter((f) => cumple(f, s.filtros));
  if (s.ordenes.length) r = [...r].sort((a, b) => { for (const o of s.ordenes) { if (a[o.col] !== b[o.col]) return (a[o.col] < b[o.col] ? -1 : 1) * (o.asc ? 1 : -1); } return 0; });
  if (s.limite) r = r.slice(0, s.limite);
  return { data: s.single ? (r[0] ? { ...r[0] } : null) : r.map((x) => ({ ...x })) };
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
      lt(c, v) { s.filtros.push(['lt', c, v]); return b; },
      in(c, v) { s.filtros.push(['in', c, v]); return b; },
      ilike(c, v) { s.filtros.push(['ilike', c, v]); return b; },
      or(expr) { s.filtros.push(['or', null, expr]); return b; },
      order(col, o) { s.ordenes.push({ col, asc: !(o && o.ascending === false) }); return b; },
      limit(n) { s.limite = n; return b; },
      single() { s.single = true; return b; },
      maybeSingle() { s.single = true; return b; },
      then(res, rej) { return Q(s).then((r) => ({ data: r.data === undefined ? null : r.data, error: r.error || null })).then(res, rej); },
    };
    return b;
  }
  const canales = new Set();
  const todos = []; // también los ya quitados: para simular un SUBSCRIBED que llega tarde a un canal cerrado
  // respeta el filtro del canal (solo 'col=eq.valor'), como Realtime
  const pasa = (filtro, fila) => { if (!filtro) return true; const m = /^([a-z_]+)=eq\\.(.*)$/.exec(filtro); if (!m) throw new Error('filtro de canal desconocido: ' + filtro); return String(fila[m[1]]) === m[2]; };
  window.__topics = [];
  window.__canales = [];
  // como Realtime: los DELETE no se filtran (solo los toma una suscripción sin filtro) y traen la clave en old
  window.__emitir = (tabla, evento, fila, old) => canales.forEach((c) => c.cbs
    .filter((x) => x.tabla === tabla && x.evento === evento && (evento === 'DELETE' ? !x.filtro : pasa(x.filtro, fila)))
    .forEach((x) => x.fn({ eventType: evento, new: evento === 'DELETE' ? {} : fila, old: evento === 'DELETE' ? old : {} })));
  window.__estadoCanales = (st) => canales.forEach((c) => c.estado && c.estado(st));
  window.__estadoTodos = (st) => todos.forEach((c) => c.estado && c.estado(st));
  window.__subidos = {};
  const svg = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#3a9"/><text x="200" y="160" font-size="28" text-anchor="middle" fill="#fff">foto de prueba</text></svg>');
  window.supabase = { createClient() {
    return {
      from: Builder,
      rpc(fn, args) { return Q({ rpc: fn, args }).then((r) => ({ data: r.data === undefined ? null : r.data, error: r.error || null })); },
      channel(topic) {
        window.__topics.push(topic);
        const c = { topic, cbs: [], on(_t, f, fn) { c.cbs.push({ tabla: f.table, evento: f.event, filtro: f.filter, fn }); return c; }, subscribe(cb) { c.estado = cb; canales.add(c); todos.push(c); window.__canales.push(c); if (cb) setTimeout(() => cb('SUBSCRIBED'), 0); return c; } };
        return c;
      },
      removeChannel(c) { canales.delete(c); },
      storage: { from() { return {
        upload: (p, b, o) => { window.__subidos[p] = b; return Q({ storage: 'upload', path: p, tipo: (o && o.contentType) || (b && b.type) }).then((r) => ({ data: r.data || null, error: r.error || null })); },
        remove: (paths) => Q({ storage: 'remove', paths }).then((r) => ({ data: r.data || [], error: r.error || null })),
        // audio y video: el archivo que subió esta ventana; el resto, una imagen de prueba
        createSignedUrls: async (paths) => ({ data: paths.map((p) => ({ path: p, error: null, signedUrl: /\\.(webm|mp4|ogg|m4a)$/.test(p) && window.__subidos[p] ? URL.createObjectURL(window.__subidos[p]) : svg })), error: null }),
      }; } },
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}), getUser: async () => ({ data: { user: null } }) },
    };
  } };
})();`;

// Micrófono y grabadora de audio falsos (el de video sigue siendo el real: lo usa la prueba para armar un video de galería)
// Con NAVEGADOR=webkit (motor de Safari) el micrófono falso se porta como el del iPhone: MediaRecorder solo graba audio/mp4.
const SAFARI = /^webkit/.test(process.env.NAVEGADOR || '');
const MIME_AUDIO = SAFARI ? 'audio/mp4' : 'audio/webm';
const EXT_AUDIO = SAFARI ? 'm4a' : 'webm';
const MIC_FALSO = `
(function () {
  const Real = window.MediaRecorder;
  window.__microfono = 0;
  if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
  const md = navigator.mediaDevices;
  const gum = md.getUserMedia ? md.getUserMedia.bind(md) : null;
  md.getUserMedia = async (c) => {
    if (c && c.audio && !c.video) { window.__microfono++; return { __falso: true, getTracks: () => [{ stop() {} }] }; }
    if (!gum) throw new DOMException('sin cámara', 'NotFoundError');
    return gum(c);
  };
  function Falso(stream, op) {
    if (!stream || !stream.__falso) return new Real(stream, op);
    const r = { state: 'inactive', mimeType: '${SAFARI ? 'audio/mp4' : 'audio/webm;codecs=opus'}', ondataavailable: null, onstop: null,
      start() { r.state = 'recording'; },
      stop() { r.state = 'inactive'; setTimeout(() => { if (r.ondataavailable) r.ondataavailable({ data: new Blob(['audio de prueba'], { type: '${MIME_AUDIO}' }) }); if (r.onstop) r.onstop(); }, 20); } };
    return r;
  }
  Falso.isTypeSupported = ${SAFARI ? "(t) => t === 'audio/mp4'" : '(t) => /^audio\\/webm/.test(t) || (Real ? Real.isTypeSupported(t) : false)'};
  window.MediaRecorder = Falso;
})();`;

const GIPHY = { data: [
  { id: 'g1', title: 'Gol', images: { fixed_height: { webp: 'https://media1.giphy.com/media/zzgol/200.webp' } } },
  { id: 'g2', title: 'Festejo', images: { fixed_height: { webp: 'https://media2.giphy.com/media/zzfesta/200.webp' } } },
] };
const giphyPedidos = [];

const navegadores = [];
async function abrir(_ignorado, uid, tema) {
  // un navegador por ventana: una pestaña en segundo plano no avanza y las dos tienen que estar activas a la vez
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
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
    if (s.table === 'mensajes' && s.action === 'select' && !s.single && demorarMensajes && uid === UA) { const ms = demorarMensajes; demorarMensajes = 0; await new Promise((ok) => setTimeout(ok, ms)); }
    return JSON.stringify(r);
  });
  await page.evaluateOnNewDocument(MIC_FALSO);
  await page.setBypassServiceWorker(true); // el service worker serviría el supabase.js real de la caché
  await page.setRequestInterception(true);
  page.on('request', (rq) => {
    const u = rq.url();
    if (u.endsWith('/vendor/supabase.js')) rq.respond({ status: 200, contentType: 'application/javascript', body: STUB });
    else if (/fonts\.(googleapis|gstatic)\.com/.test(u)) rq.respond({ status: 200, contentType: 'text/css', body: '' });
    else if (/^https:\/\/api\.giphy\.com\/v1\/stickers\//.test(u)) { giphyPedidos.push(u); rq.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(GIPHY) }); }
    else if (/^https:\/\/media[0-9]*\.giphy\.com\//.test(u)) rq.respond({ status: 200, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: PNG });
    else if (!u.startsWith(URL_APP) && !u.startsWith('data:') && !u.startsWith('blob:')) rq.abort(); // nada sale a internet
    else rq.continue();
  });
  await page.setViewport({ width: Number(process.env.ANCHO) || 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  // sin animaciones: la hoja que sube movería los botones mientras se calcula dónde tocar
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: tema }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(URL_APP, { waitUntil: 'networkidle0' });
  await page.evaluate((p) => { App.modoAcceso(false); App.setPerfil(p); }, db.perfiles.find((p) => p.id === uid));
  await page.waitForSelector('.tarjeta-act', { timeout: 8000 }).catch(async (e) => { console.log('DEBUG', page.errores, JSON.stringify(await page.evaluate(() => document.getElementById('pantalla-actividades').innerText.slice(-200)))); throw e; });
  return reg;
}
const texto = (p, sel) => p.$eval(sel, (e) => e.textContent);
const cuantos = (p, sel) => p.$$eval(sel, (e) => e.length);
const esperar = (p, fn, ...a) => p.waitForFunction(fn, { timeout: 6000 }, ...a);
const sinToast = (p) => p.waitForFunction(() => document.getElementById('toast').hidden, { timeout: 8000 });
const toastDe = (p) => p.evaluate(() => { const t = document.getElementById('toast'); return t.hidden ? '' : t.textContent; });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const ultimo = () => db.mensajes[db.mensajes.length - 1];
const lista = (p) => texto(p, '#chat-act .chat-lista');
const chatTexto = (p) => p.evaluate(() => document.querySelector('#chat-act .chat-lista').textContent);
// menú del mensaje: clic derecho sobre la burbuja (en el teléfono es la presión larga, que también se prueba)
async function menu(p, id) {
  await p.evaluate((i) => { const b = document.querySelector(`#chat-act .chat-burbuja[data-id="${i}"]`); b.scrollIntoView({ block: 'center' }); b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); }, id);
  await p.waitForSelector('.chat-hoja-menu');
}
const sinCapas = (p) => esperar(p, () => !document.querySelector('.chat-capa, .chat-visor'));
async function escribir(p, t) {
  await p.type('#chat-act .chat-texto', t);
  await p.click('#chat-act .chat-enviar');
  await esperar(p, (x) => [...document.querySelectorAll('#chat-act .chat-msg.mio')].some((e) => e.textContent.includes(x)) && !document.querySelector('#chat-act .subiendo'), t);
}
const idDe = (t) => { const m = db.mensajes.find((x) => x.texto === t); if (!m) throw new Error('no está el mensaje ' + t); return m.id; };
const centro = (p, sel) => p.$eval(sel, (e) => { e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });

(async () => {
  const b = null;
  let fallas = 0;
  const paso = async (n, fn) => {
    try { await fn(); console.log('ok', n); } catch (e) {
      fallas++; console.log('FALLA', n, '-', e.message);
      if (process.env.DEPURAR) for (const r of paginas) console.log('   ', r.uid.slice(0, 2), JSON.stringify(await r.page.evaluate(() => ({ toast: document.getElementById('toast').textContent, capas: document.querySelectorAll('.chat-capa, .chat-visor').length, estado: history.state, sel: !!document.querySelector('.chat-burbuja.sel'), citando: !(document.querySelector('#chat-act .chat-citando') || {}).hidden, citas: document.querySelectorAll('#chat-act .chat-cita-b').length, resaltado: document.querySelectorAll('#chat-act .resaltado').length, foco: document.activeElement && document.activeElement.className })).catch((x) => x.message)));
    }
  };
  try {
    // Ventana A (Ana, anotada a la actividad). Primero se prueba el error inicial: al abrir el chat hay dos lecturas
    // de mensajes (la carga inicial y la de SUBSCRIBED, que corre de nuevo aunque la otra siga en vuelo) y fallan las dos.
    fallarMensajes = 2;
    const A = await abrir(b, UA, 'light');
    const pa = A.page;
    await pa.click('.tarjeta-act');
    await pa.waitForSelector('#chat-act');

    await paso('error inicial: no queda en "Cargando…", ofrece Reintentar y recupera', async () => {
      await pa.waitForSelector('#chat-reintentar', { timeout: 6000 });
      assert.match(await lista(pa), /No pudimos cargar el chat/);
      await pa.evaluate(() => document.querySelector('#chat-act').scrollIntoView({ block: 'center' }));
      await pa.screenshot({ path: path.join(shots, 'chat-error-claro.png') });
      await pa.click('#chat-reintentar');
      await esperar(pa, () => /Todavía no hay mensajes/.test(document.querySelector('#chat-act .chat-lista').textContent));
    });

    const B = await abrir(b, UB, 'light');
    const pb = B.page;
    await pb.click('.tarjeta-act');
    await pb.waitForSelector('#chat-act');

    await paso('cabecera con buscar, destacados y menú; sin el botón de opciones en la burbuja; la cámara abre una hoja', async () => {
      for (const s of ['.chat-b-buscar', '.chat-b-destacados', '.chat-b-menu']) assert.equal(await cuantos(pa, '#chat-act ' + s), 1, s);
      assert.equal(await cuantos(pa, '#chat-act .chat-adj'), 2, 'cámara y stickers');
      assert.equal(await pa.$eval('#chat-act .chat-enviar', (e) => e.getAttribute('aria-label')), 'Mantené apretado para grabar un audio');
      await pa.click('#chat-act .chat-adj');
      await pa.waitForSelector('.chat-hoja-adj');
      assert.match(await texto(pa, '.chat-hoja-adj'), /Abrir cámara.*Elegir de la galería.*Cancelar/s);
      assert.equal(await cuantos(pa, '.chat-hoja-adj svg use'), 2, 'los íconos son del sprite');
      await pa.keyboard.press('Escape');
      await sinCapas(pa);
      assert.equal(await pa.evaluate(() => document.activeElement && document.activeElement.classList.contains('chat-adj')), true, 'el foco vuelve al botón');
    });

    await paso('A manda un mensaje y B (solo tercer tiempo) lo ve en vivo, con el nombre de A', async () => {
      await pa.type('#chat-act .chat-texto', 'Llevo las pelotas 🎾');
      assert.equal(await pa.$eval('#chat-act .chat-enviar', (e) => e.getAttribute('aria-label')), 'Enviar', 'con texto el botón es enviar');
      await pa.click('#chat-act .chat-enviar');
      await esperar(pb, () => /Llevo las pelotas/.test(document.querySelector('#chat-act .chat-lista').textContent));
      assert.match(await texto(pb, '#chat-act .chat-autor'), /Ana Pérez/);
      assert.equal(await cuantos(pa, '#chat-act .chat-msg.mio'), 1);
      assert.equal(await cuantos(pa, '#chat-act .chat-msg.mio .chat-autor'), 0, 'lo propio va sin nombre');
      assert.equal(await cuantos(pb, '#chat-act .chat-msg.otro'), 1);
      assert.equal(await cuantos(pa, '#chat-act .chat-mas-acc'), 0);
    });

    await paso('B responde y A lo ve; sin duplicados', async () => {
      await pb.type('#chat-act .chat-texto', 'Yo llevo la bebida');
      await pb.click('#chat-act .chat-enviar');
      await esperar(pa, () => /Yo llevo la bebida/.test(document.querySelector('#chat-act .chat-lista').textContent));
      await dormir(300);
      assert.equal(await cuantos(pa, '#chat-act .chat-msg'), 2);
      assert.equal(await cuantos(pb, '#chat-act .chat-msg'), 2);
    });

    await paso('B manda una foto de la galería (desde la hoja) y A la ve en vivo', async () => {
      const inp = await pb.$('#chat-act input[type=file]');
      assert.match(await inp.evaluate((e) => e.accept), /image\/\*.*video\/\*/);
      await inp.uploadFile(path.join(raiz, 'icon-192.png'));
      await esperar(pa, () => document.querySelectorAll('#chat-act img.chat-foto').length === 1);
      await esperar(pa, () => (document.querySelector('#chat-act img.chat-foto').getAttribute('src') || '').startsWith('data:image/svg'));
      await esperar(pb, () => document.querySelectorAll('#chat-act .chat-msg.mio img.chat-foto').length === 1 && !document.querySelector('#chat-act .subiendo'));
      const f = ultimo();
      assert.match(f.archivo, new RegExp(`^${SALA}/fotos/[0-9a-f-]{36}\\.webp$`));
      assert.ok(archivos.has(f.archivo.replace(/\.webp$/, '.t.webp')), 'subió la miniatura');
    });

    await paso('A edita su mensaje (menú con clic derecho) y B ve "Editado" en vivo', async () => {
      await menu(pa, idDe('Llevo las pelotas 🎾'));
      assert.match(await texto(pa, '.chat-hoja-menu'), /Responder.*Copiar.*Editar.*Fijar.*Destacar.*Eliminar para mí.*Eliminar para todos.*Cancelar/s);
      assert.equal(await cuantos(pa, '.chat-hoja-menu .chat-reac-b'), 6, 'las seis reacciones');
      assert.equal(await cuantos(pa, '.chat-hoja-menu .chat-reac-b svg use'), 6, 'íconos del sprite, sin emojis');
      await pa.click('.chat-hoja-menu .chat-i-editar');
      await sinCapas(pa);
      assert.equal(await pa.$eval('#chat-act .chat-texto', (e) => e.value), 'Llevo las pelotas 🎾');
      await pa.$eval('#chat-act .chat-texto', (e) => { e.value = 'Llevo las pelotas y redes'; e.dispatchEvent(new Event('input')); });
      await pa.click('#chat-act .chat-enviar');
      await esperar(pb, () => /Llevo las pelotas y redes/.test(document.querySelector('#chat-act .chat-lista').textContent) && /Editado/.test(document.querySelector('#chat-act .chat-lista').textContent));
      assert.equal(await pa.$eval('#chat-act .chat-edicion', (e) => e.hidden), true);
    });

    await paso('menú de un mensaje ajeno: sin Editar ni "Eliminar para todos"; atrás lo cierra sin cerrar el chat', async () => {
      await menu(pa, idDe('Yo llevo la bebida'));
      const t = await texto(pa, '.chat-hoja-menu');
      assert.match(t, /Responder.*Copiar.*Fijar.*Destacar.*Eliminar para mí/s);
      assert.doesNotMatch(t, /Editar|Eliminar para todos/);
      assert.equal(await pa.evaluate(() => !!document.querySelector('#chat-act .chat-burbuja.sel')), true, 'la burbuja queda marcada');
      await pa.evaluate(() => history.back());
      await sinCapas(pa);
      assert.equal(await cuantos(pa, '#chat-act'), 1, 'el chat sigue abierto');
      assert.equal(await cuantos(pa, '#chat-act .chat-burbuja.sel'), 0);
    });

    await paso('presión larga abre el menú (y no responde)', async () => {
      const c = await centro(pa, `#chat-act .chat-burbuja[data-id="${idDe('Yo llevo la bebida')}"]`);
      await pa.mouse.move(c.x, c.y); await pa.mouse.down(); await dormir(700); await pa.mouse.up();
      await pa.waitForSelector('.chat-hoja-menu');
      assert.equal(await pa.$eval('#chat-act .chat-citando', (e) => e.hidden), true);
      await pa.keyboard.press('Escape');
      await sinCapas(pa);
    });

    await paso('responder desde el menú: barra "Respondiendo a", cita en la burbuja en vivo y al tocarla salta y resalta el original', async () => {
      const original = idDe('Llevo las pelotas y redes');
      await menu(pb, original);
      await pb.click('.chat-hoja-menu .chat-i-responder');
      await sinCapas(pb);
      await esperar(pb, () => !document.querySelector('#chat-act .chat-citando').hidden);
      assert.match(await texto(pb, '#chat-act .chat-citando'), /Respondiendo a Ana Pérez.*Llevo las pelotas y redes/s);
      await pb.type('#chat-act .chat-texto', 'Genial, yo llevo hielo');
      await pb.click('#chat-act .chat-enviar');
      await esperar(pb, () => document.querySelector('#chat-act .chat-citando').hidden);
      await esperar(pa, () => [...document.querySelectorAll('#chat-act .chat-cita-b')].some((c) => /Llevo las pelotas y redes/.test(c.textContent)));
      assert.equal(ultimo().responde_a, original);
      assert.match(await texto(pa, '#chat-act .chat-cita-b'), /^Vos/, 'para A la cita dice Vos');
      await pa.click('#chat-act .chat-cita-b');
      await esperar(pa, (id) => !!document.querySelector(`#chat-act .chat-msg.resaltado[data-id="${id}"]`), original);
    });

    await paso('deslizar una burbuja a la derecha responde', async () => {
      await dormir(400); // que termine de moverse la lista
      const c = await centro(pa, `#chat-act .chat-burbuja[data-id="${idDe('Genial, yo llevo hielo')}"]`);
      await pa.mouse.move(c.x - 40, c.y); await pa.mouse.down(); await pa.mouse.move(c.x + 60, c.y, { steps: 8 }); await pa.mouse.up();
      await esperar(pa, () => !document.querySelector('#chat-act .chat-citando').hidden);
      assert.match(await texto(pa, '#chat-act .chat-citando'), /Respondiendo a Beto Gómez/);
      assert.equal(await cuantos(pa, '.chat-capa'), 0, 'no abrió el menú');
      await pa.click('#chat-act .chat-citando-x');
      assert.equal(await pa.$eval('#chat-act .chat-citando', (e) => e.hidden), true);
    });

    await paso('cita a un mensaje que ya no está: se manda sin la cita y avisa', async () => {
      await escribir(pb, 'Este se va a borrar');
      const id = idDe('Este se va a borrar');
      await menu(pa, id);
      await pa.click('.chat-hoja-menu .chat-i-responder');
      await sinCapas(pa);
      db.mensajes = db.mensajes.filter((m) => m.id !== id); // borrado en la base (no por eliminar_mensaje)
      await pa.type('#chat-act .chat-texto', 'Respuesta huérfana');
      await pa.click('#chat-act .chat-enviar');
      await esperar(pa, () => /lo mandamos sin la cita/.test(document.getElementById('toast').textContent));
      await esperar(pa, () => /Respuesta huérfana/.test(document.querySelector('#chat-act .chat-lista').textContent) && !document.querySelector('#chat-act .subiendo'));
      const m = db.mensajes.find((x) => x.texto === 'Respuesta huérfana');
      assert.equal(m.responde_a, null);
      await pa.evaluate(() => window.__estadoCanales('SUBSCRIBED')); // se pone al día (el borrado desaparece)
      await esperar(pa, () => !/Este se va a borrar/.test(document.querySelector('#chat-act .chat-lista').textContent));
      await pb.evaluate(() => window.__estadoCanales('SUBSCRIBED'));
      await esperar(pb, () => !/Este se va a borrar/.test(document.querySelector('#chat-act .chat-lista').textContent));
    });

    await paso('reacciones: B reacciona y A lo ve en vivo; agrupadas con conteo; tocar la misma la saca', async () => {
      const id = idDe('Llevo las pelotas y redes');
      await menu(pb, id);
      await pb.click('.chat-hoja-menu [data-reac="corazon"]');
      await sinCapas(pb);
      await esperar(pa, (i) => { const r = document.querySelector(`#chat-act .chat-msg[data-id="${i}"] .chat-reac.reac-corazon`); return r && r.textContent === '1'; }, id);
      assert.deepEqual(db.mensaje_reacciones.map((r) => [r.persona, r.clave, r.sala]), [[UB, 'corazon', SALA]]);
      // A suma la suya con la pastilla
      await pa.click(`#chat-act .chat-msg[data-id="${id}"] .chat-reac.reac-corazon`);
      await esperar(pb, (i) => { const r = document.querySelector(`#chat-act .chat-msg[data-id="${i}"] .chat-reac.reac-corazon`); return r && r.textContent === '2'; }, id);
      assert.equal(await pa.$eval(`#chat-act .chat-msg[data-id="${id}"] .chat-reac.reac-corazon`, (e) => e.classList.contains('mia')), true);
      await pb.evaluate(() => { const l = document.querySelector('#chat-act'); l.scrollIntoView({ block: 'start' }); l.querySelector('.chat-lista').scrollTop = 1e6; });
      await pb.screenshot({ path: path.join(shots, 'chat-cita-reacciones-claro.png') });
      // B la cambia por fuego: quedan dos pastillas
      await menu(pb, id);
      assert.equal(await pb.$eval('.chat-hoja-menu [data-reac="corazon"]', (e) => e.getAttribute('aria-pressed')), 'true');
      await pb.click('.chat-hoja-menu [data-reac="fuego"]');
      await sinCapas(pb);
      await esperar(pa, (i) => document.querySelectorAll(`#chat-act .chat-msg[data-id="${i}"] .chat-reac`).length === 2, id);
      // B toca su fuego: se va
      await pb.click(`#chat-act .chat-msg[data-id="${id}"] .chat-reac.reac-fuego`);
      await esperar(pa, (i) => !document.querySelector(`#chat-act .chat-msg[data-id="${i}"] .chat-reac.reac-fuego`), id);
      assert.deepEqual(db.mensaje_reacciones.map((r) => [r.persona, r.clave]), [[UA, 'corazon']]);
      assert.equal(await pb.$eval(`#chat-act .chat-msg[data-id="${id}"] .chat-reac.reac-corazon`, (e) => e.textContent), '1');
      assert.equal(await pb.evaluate(() => { const r = document.querySelector('#chat-act .chat-reac.reac-corazon .ico'); return getComputedStyle(r).fill; }), 'rgb(224, 50, 62)', 'el corazón va en rojo');
    });

    await paso('fijar: A fija, B ve la franja en vivo y la toca para ir; B desfija y A deja de verla', async () => {
      const id = idDe('Yo llevo la bebida');
      await menu(pa, id);
      await pa.click('.chat-hoja-menu .chat-i-fijar');
      await sinCapas(pa);
      await esperar(pb, () => !document.querySelector('#chat-act .chat-fijado').hidden);
      assert.match(await texto(pb, '#chat-act .chat-fijado'), /Mensaje fijado.*Vos: Yo llevo la bebida/s);
      assert.match(await texto(pa, '#chat-act .chat-fijado'), /Beto: Yo llevo la bebida/);
      assert.equal(rpcs.fijar_mensaje, 1);
      await pb.click('#chat-act .chat-fijado-ir');
      await esperar(pb, (i) => !!document.querySelector(`#chat-act .chat-msg.resaltado[data-id="${i}"]`), id);
      await menu(pb, id);
      assert.match(await texto(pb, '.chat-hoja-menu'), /Desfijar/);
      await pb.keyboard.press('Escape'); await sinCapas(pb);
      await pb.click('#chat-act .chat-fijado-x');
      await esperar(pa, () => document.querySelector('#chat-act .chat-fijado').hidden);
      assert.equal(db.chat_fijados.length, 0);
    });

    await paso('A elimina su mensaje (segundo toque) y B ve la marca', async () => {
      await escribir(pa, 'Lo borro enseguida');
      await menu(pa, idDe('Lo borro enseguida'));
      await pa.click('.chat-hoja-menu .chat-i-eliminar');
      assert.match(await texto(pa, '.chat-hoja-menu .chat-i-eliminar'), /Tocá de nuevo/);
      await pa.click('.chat-hoja-menu .chat-i-eliminar');
      await sinCapas(pa);
      await esperar(pb, () => /Se eliminó este mensaje/.test(document.querySelector('#chat-act .chat-lista').textContent));
      assert.doesNotMatch(await lista(pb), /Lo borro enseguida/);
    });

    await paso('reconexión: lo mandado mientras A estaba desconectada aparece al volver, sin duplicar', async () => {
      A.desconectada = true; // el socket de A está caído: no recibe nada en vivo
      await pb.type('#chat-act .chat-texto', 'Mensaje mientras no estabas');
      await pb.click('#chat-act .chat-enviar');
      await esperar(pb, () => /mientras no estabas/.test(document.querySelector('#chat-act .chat-lista').textContent));
      await dormir(300);
      assert.doesNotMatch(await lista(pa), /mientras no estabas/);
      A.desconectada = false;
      await pa.evaluate(() => window.__estadoCanales('SUBSCRIBED')); // Realtime reconectó
      await esperar(pa, () => /mientras no estabas/.test(document.querySelector('#chat-act .chat-lista').textContent));
      const n = await cuantos(pa, '#chat-act .chat-msg');
      assert.equal(n, db.mensajes.length);
      await pa.evaluate(() => window.__estadoCanales('SUBSCRIBED'));
      await dormir(300);
      assert.equal(await cuantos(pa, '#chat-act .chat-msg'), n, 'otra reconexión no duplica');
    });

    await paso('fix 1: lo que llega en vivo mientras la sincronización está en vuelo no se pierde', async () => {
      demorarMensajes = 1500; // la próxima lectura de A tarda; la página ya no trae lo que manda B
      await pa.evaluate(() => window.__estadoCanales('SUBSCRIBED')); // reconexión: arranca la sync de A
      await dormir(200);
      await pb.type('#chat-act .chat-texto', 'Llegó durante la sync');
      await pb.click('#chat-act .chat-enviar');
      await esperar(pa, () => /Llegó durante la sync/.test(document.querySelector('#chat-act .chat-lista').textContent));
      await dormir(1800); // termina la sync demorada
      assert.match(await lista(pa), /Llegó durante la sync/, 'la reconciliación lo borró');
      assert.equal(await cuantos(pa, '#chat-act .chat-msg'), db.mensajes.length);
    });

    await paso('fix 2: un UPDATE de un mensaje que no está cargado se ignora', async () => {
      const n = await cuantos(pa, '#chat-act .chat-msg');
      await pa.evaluate((sala) => window.__emitir('mensajes', 'UPDATE', { id: 'viejo-0000-4000-8000-000000000000', sala, autor: 'x', tipo: 'texto', texto: 'mensaje viejo editado', editado: true, creado: '2026-01-01T00:00:00.000Z' }), SALA);
      await dormir(300);
      assert.equal(await cuantos(pa, '#chat-act .chat-msg'), n);
      assert.doesNotMatch(await lista(pa), /mensaje viejo editado/);
    });

    await paso('fix 12: el filtro del canal deja afuera los eventos de otra sala', async () => {
      const n = await cuantos(pa, '#chat-act .chat-msg');
      await pa.evaluate(() => window.__emitir('mensajes', 'INSERT', { id: 'otra-0000-4000-8000-000000000000', sala: 'act:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', autor: 'x', tipo: 'texto', texto: 'de otra sala', editado: false, creado: new Date().toISOString() }));
      await pa.evaluate(() => window.__emitir('mensaje_reacciones', 'INSERT', { mensaje: 'otra-0000-4000-8000-000000000000', persona: 'x', clave: 'risa', sala: 'act:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }));
      await dormir(300);
      assert.equal(await cuantos(pa, '#chat-act .chat-msg'), n);
    });

    await paso('fix 3: cada apertura usa un topic único; el canal escucha mensajes, reacciones y fijados (los DELETE sin filtro)', async () => {
      const topics = await pa.evaluate(() => window.__topics);
      const chat = topics.filter((t) => t.startsWith('chat-'));
      assert.ok(chat.length >= 1);
      assert.equal(new Set(topics).size, topics.length, 'topics repetidos: ' + topics.join(' '));
      assert.ok(chat.every((t) => /^chat-act:[0-9a-f-]{36}-[0-9a-f-]{36}$/.test(t)), 'topic sin sufijo único: ' + chat[0]);
      assert.ok(topics.some((t) => /^actividades-vivo-[0-9a-f-]{36}$/.test(t)), 'actividades sin sufijo único');
      const subs = await pa.evaluate(() => window.__canales.filter((c) => c.topic.startsWith('chat-')).pop().cbs.map((x) => [x.tabla, x.evento, x.filtro || '']));
      const esperado = [['mensajes', 'INSERT', 1], ['mensajes', 'UPDATE', 1], ['mensaje_reacciones', 'INSERT', 1], ['mensaje_reacciones', 'UPDATE', 1], ['mensaje_reacciones', 'DELETE', 0],
        ['chat_fijados', 'INSERT', 1], ['chat_fijados', 'UPDATE', 1], ['chat_fijados', 'DELETE', 0]];
      assert.deepEqual(subs.map(([t, e, f]) => [t, e, f ? 1 : 0]), esperado);
      assert.ok(subs.filter((x) => x[2]).every((x) => x[2] === 'sala=eq.' + 'act:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
    });

    await paso('fix 6: editar con el mismo texto (con espacios) no marca "Editado"', async () => {
      await escribir(pb, 'Texto fijo');
      await menu(pb, idDe('Texto fijo'));
      await pb.click('.chat-hoja-menu .chat-i-editar');
      await sinCapas(pb);
      await pb.$eval('#chat-act .chat-texto', (e) => { e.value = '  Texto fijo  '; e.dispatchEvent(new Event('input')); });
      await pb.click('#chat-act .chat-enviar');
      await dormir(300);
      assert.equal(await pb.$eval('#chat-act .chat-edicion', (e) => e.hidden), true, 'la edición se cierra');
      assert.equal(db.mensajes.find((x) => x.texto === 'Texto fijo').editado, false);
    });

    await paso('fix2 punto 1: doble toque en "Tocá de nuevo" elimina una sola vez y sin error falso', async () => {
      await escribir(pa, 'Para borrar con doble toque');
      await sinToast(pa);
      await menu(pa, idDe('Para borrar con doble toque'));
      await pa.click('.chat-hoja-menu .chat-i-eliminar');
      assert.match(await texto(pa, '.chat-hoja-menu .chat-i-eliminar'), /Tocá de nuevo/);
      const antes = rpcs.eliminar_mensaje || 0;
      // dos toques seguidos sobre el mismo botón, antes de que vuelva la RPC
      await pa.evaluate(() => { const x = document.querySelector('.chat-hoja-menu .chat-i-eliminar'); x.click(); x.click(); });
      await esperar(pa, () => [...document.querySelectorAll('#chat-act .chat-burbuja.eliminado')].length >= 2);
      await dormir(400);
      assert.equal((rpcs.eliminar_mensaje || 0) - antes, 1, 'eliminar_mensaje se llamó más de una vez');
      assert.doesNotMatch(await toastDe(pa), /No pudimos eliminar/);
    });

    await paso('fix2 punto 3: una sync pedida con otra en vuelo (SUBSCRIBED) corre de nuevo y no pierde lo commiteado', async () => {
      A.desconectada = true; // sin eventos en vivo: el mensaje solo puede llegar por una sincronización
      demorarMensajes = 1500; // la sync que arranca ahora toma la foto del servidor ya y tarda en volver
      await pa.evaluate(() => window.dispatchEvent(new Event('online')));
      await dormir(200);
      await pb.type('#chat-act .chat-texto', 'Commiteado antes de SUBSCRIBED');
      await pb.click('#chat-act .chat-enviar');
      await esperar(pb, () => /Commiteado antes de SUBSCRIBED/.test(document.querySelector('#chat-act .chat-lista').textContent) && !document.querySelector('#chat-act .subiendo'));
      A.desconectada = false;
      await pa.evaluate(() => window.__estadoCanales('SUBSCRIBED')); // reconecta con la primera sync todavía en vuelo
      await esperar(pa, () => /Commiteado antes de SUBSCRIBED/.test(document.querySelector('#chat-act .chat-lista').textContent));
      assert.equal(await cuantos(pa, '#chat-act .chat-msg'), db.mensajes.length);
    });

    await paso('fix 9 y 10: botón de foto real; el visor cierra con Escape y devuelve el foco', async () => {
      assert.equal(await pa.$eval('#chat-act .chat-adj', (e) => e.tagName), 'BUTTON');
      await pa.focus('#chat-act img.chat-foto');
      await pa.keyboard.press('Enter');
      await pa.waitForSelector('.chat-visor');
      assert.equal(await pa.evaluate(() => document.activeElement && document.activeElement.className), 'chat-visor-x');
      await pa.keyboard.press('Escape');
      await esperar(pa, () => !document.querySelector('.chat-visor'));
      assert.equal(await pa.evaluate(() => !!document.activeElement && document.activeElement.classList.contains('chat-foto')), true, 'el foco no volvió a la foto');
    });

    // ---------- audio ----------
    await paso('audio: mantener apretado graba (punto rojo y contador), soltar lo manda; B lo ve con play y duración', async () => {
      await sinToast(pa);
      const c = await centro(pa, '#chat-act .chat-enviar');
      await pa.mouse.move(c.x, c.y); await pa.mouse.down();
      await esperar(pa, () => !document.querySelector('#chat-act .chat-grabando').hidden && document.querySelector('#chat-act .chat-enviar.grabando'));
      await dormir(1300);
      assert.match(await texto(pa, '#chat-act .chat-rec-t'), /^0:01$/);
      assert.match(await texto(pa, '#chat-act .chat-grabando'), /Deslizá para cancelar/);
      await pa.mouse.up();
      await esperar(pb, () => !!document.querySelector('#chat-act .chat-msg.otro .chat-audio'));
      const m = ultimo();
      assert.equal(m.tipo, 'audio');
      assert.match(m.archivo, new RegExp(`^${SALA}/audios/[0-9a-f-]{36}\\.${EXT_AUDIO}$`));
      assert.ok(m.duracion_ms >= 1000 && m.duracion_ms < 3000, 'duración ' + m.duracion_ms);
      assert.equal(archivos.get(m.archivo).tipo, MIME_AUDIO);
      assert.match(await pb.$eval(`#chat-act .chat-msg[data-id="${m.id}"] .chat-audio-dur`, (e) => e.textContent), /^0:0[12]$/);
      assert.equal(await pb.$eval(`#chat-act .chat-msg[data-id="${m.id}"] .chat-audio-play`, (e) => e.getAttribute('aria-label')), 'Escuchar el audio');
      assert.equal(await pa.$eval('#chat-act .chat-grabando', (e) => e.hidden), true);
      await pb.evaluate(() => { const l = document.querySelector('#chat-act'); l.scrollIntoView({ block: 'start' }); l.querySelector('.chat-lista').scrollTop = 1e6; });
      await pb.screenshot({ path: path.join(shots, 'chat-audio-claro.png') });
      assert.doesNotMatch(await toastDe(pa), /Mantené apretado/, 'el click al soltar no avisa nada');
    });

    await paso('audio: deslizar a la izquierda cancela; uno muy corto no se manda', async () => {
      const n = db.mensajes.length;
      const c = await centro(pa, '#chat-act .chat-enviar');
      await pa.mouse.move(c.x, c.y); await pa.mouse.down();
      await esperar(pa, () => !document.querySelector('#chat-act .chat-grabando').hidden);
      await dormir(900);
      await pa.mouse.move(c.x - 120, c.y, { steps: 6 });
      await esperar(pa, () => document.querySelector('#chat-act .chat-grabando').hidden);
      await pa.mouse.up();
      assert.match(await toastDe(pa), /Audio cancelado/);
      await pa.mouse.move(c.x, c.y); await pa.mouse.down(); await dormir(250); await pa.mouse.up();
      await esperar(pa, () => /muy corto/.test(document.getElementById('toast').textContent));
      await dormir(300);
      assert.equal(db.mensajes.length, n, 'se mandó un audio');
    });

    await paso('audio: al eliminarlo se borra solo el archivo (sin pedir miniatura)', async () => {
      const m = db.mensajes.filter((x) => x.tipo === 'audio').pop();
      const archivo = m.archivo; // eliminar_mensaje lo deja en null
      await menu(pa, m.id);
      assert.doesNotMatch(await texto(pa, '.chat-hoja-menu'), /Copiar|Editar/);
      await pa.click('.chat-hoja-menu .chat-i-eliminar'); await pa.click('.chat-hoja-menu .chat-i-eliminar');
      await sinCapas(pa);
      for (let i = 0; i < 30 && !borrados.some((x) => x.includes(archivo)); i++) await dormir(100);
      assert.deepEqual(borrados.find((x) => x.includes(archivo)), [archivo]);
    });

    // ---------- video ----------
    // WebKit no tiene la cámara falsa de Chrome que graba el video de prueba: en Safari el video se prueba en el teléfono
    if (SAFARI) console.log('(se saltean los 2 pasos de video: necesitan la cámara falsa de Chrome)');
    if (!SAFARI) await paso('video de la galería: sube el video y su miniatura, B ve la miniatura con play; tocar abre el visor con <video>', async () => {
      await sinToast(pa);
      // un video de verdad (WebM de ~2,5 s de la cámara falsa de Chrome, sin duración en la cabecera, como los que graba
      // un navegador), elegido en el input de la galería
      await pa.evaluate(async () => {
        const st = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 180 } });
        let partes = [];
        // el codificador a veces arranca tarde y entrega un archivo vacío: se graba de nuevo (hasta 3 veces)
        for (let i = 0; i < 3 && partes.reduce((n, p) => n + p.size, 0) < 5000; i++) {
          partes = [];
          const r = new MediaRecorder(st, { mimeType: 'video/webm' });
          r.ondataavailable = (e) => partes.push(e.data);
          await new Promise((ok) => { r.onstop = ok; r.start(250); setTimeout(() => r.stop(), 2500); });
        }
        st.getTracks().forEach((t) => t.stop());
        const dt = new DataTransfer(); dt.items.add(new File(partes, 'video.webm', { type: 'video/webm' }));
        const inp = document.querySelector('#chat-act input[type=file]'); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
      });
      await pb.waitForFunction(() => !!document.querySelector('#chat-act .chat-msg.otro .chat-video'), { timeout: 15000 });
      const m = ultimo();
      assert.equal(m.tipo, 'video');
      assert.match(m.archivo, new RegExp(`^${SALA}/videos/[0-9a-f-]{36}\\.webm$`));
      assert.equal(archivos.get(m.archivo).tipo, 'video/webm');
      assert.ok(archivos.has(m.archivo.replace(/\.webm$/, '.t.webp')), 'falta la miniatura');
      assert.deepEqual([m.ancho, m.alto], [320, 180]);
      assert.ok(m.duracion_ms >= 200 && m.duracion_ms <= 3500, 'duración ' + m.duracion_ms); // el codificador de la cámara falsa a veces arranca tarde
      assert.match(await pb.$eval(`#chat-act .chat-msg[data-id="${m.id}"] .chat-video`, (e) => e.getAttribute('aria-label')), /^Video de 0:0\d/);
      await esperar(pb, (i) => (document.querySelector(`#chat-act .chat-msg[data-id="${i}"] .chat-video img`).getAttribute('src') || '').startsWith('data:image/svg'), m.id);
      await esperar(pa, () => !document.querySelector('#chat-act .subiendo'));
      await pa.click(`#chat-act .chat-msg[data-id="${m.id}"] .chat-video`);
      await pa.waitForSelector('.chat-visor video');
      await esperar(pa, () => { const v = document.querySelector('.chat-visor video'); return v.src.startsWith('blob:') && v.controls; });
      await pa.screenshot({ path: path.join(shots, 'chat-video-visor.png') });
      await pa.evaluate(() => history.back());
      await sinCapas(pa);
    });

    if (!SAFARI) await paso('video: al eliminarlo se borran el video y su miniatura', async () => {
      const m = db.mensajes.filter((x) => x.tipo === 'video').pop();
      const archivo = m.archivo;
      await menu(pa, m.id);
      await pa.click('.chat-hoja-menu .chat-i-eliminar'); await pa.click('.chat-hoja-menu .chat-i-eliminar');
      await sinCapas(pa);
      for (let i = 0; i < 30 && !borrados.some((x) => x.includes(archivo)); i++) await dormir(100);
      assert.deepEqual(borrados.find((x) => x.includes(archivo)), [archivo, archivo.replace(/\.webm$/, '.t.webp')]);
    });

    // ---------- stickers ----------
    await paso('sticker del grupo: crear desde una foto (editor), se guarda en la biblioteca, se manda y B lo ve', async () => {
      await pa.click('#chat-act .chat-adj[aria-label="Stickers"]');
      await pa.waitForSelector('.chat-hoja-stk');
      assert.match(await texto(pa, '.chat-hoja-stk'), /Del grupo.*GIPHY/s);
      await esperar(pa, () => /Todavía no hay stickers del grupo/.test(document.querySelector('.chat-hoja-stk').textContent));
      const inp = await pa.$('.chat-hoja-stk input[type=file]');
      await inp.uploadFile(path.join(raiz, 'icon-192.png'));
      await pa.waitForSelector('.chat-capa-editor canvas');
      await pa.type('.chat-stk-texto', 'vamos');
      await pa.screenshot({ path: path.join(shots, 'chat-sticker-editor.png') });
      await pa.click('.chat-stk-guardar');
      await sinCapas(pa);
      await esperar(pb, () => !!document.querySelector('#chat-act .chat-msg.otro .chat-burbuja.sticker img.chat-stk'));
      const m = ultimo();
      assert.equal(m.tipo, 'sticker'); assert.equal(m.externo, null);
      assert.match(m.archivo, /^stickers\/[0-9a-f-]{36}\.webp$/);
      assert.equal(db.stickers.length, 1); assert.equal(db.stickers[0].archivo, m.archivo); assert.equal(db.stickers[0].autor, UA);
      assert.ok(archivos.has(m.archivo));
      // B lo ve en "Del grupo" (sin "Quitar los míos": no es suyo)
      await pb.click('#chat-act .chat-adj[aria-label="Stickers"]');
      await pb.waitForSelector('.chat-hoja-stk');
      await pb.click('.chat-hoja-stk .chat-tab');
      await esperar(pb, () => document.querySelectorAll('.chat-hoja-stk .chat-stk-cel').length === 1);
      assert.equal(await pb.$eval('.chat-stk-quitar-modo', (e) => e.hidden), true);
      await pb.keyboard.press('Escape'); await sinCapas(pb);
    });

    await paso('sticker de GIPHY: busca (respuesta falsa), manda el externo y B lo ve; al eliminarlo no se borra ningún archivo', async () => {
      await pa.click('#chat-act .chat-adj[aria-label="Stickers"]');
      await pa.waitForSelector('.chat-hoja-stk');
      const tabs = await pa.$$('.chat-hoja-stk .chat-tab');
      await tabs[1].click();
      await esperar(pa, () => document.querySelectorAll('[id$="tp-giphy"] .chat-stk-b').length === 2);
      assert.ok(giphyPedidos.some((u) => /\/trending\?/.test(u)), 'sin texto pide tendencias');
      assert.match(await texto(pa, '.chat-hoja-stk'), /Powered by GIPHY/);
      await pa.type('.chat-giphy-q', 'gol');
      await esperar(pa, () => true);
      for (let i = 0; i < 20 && !giphyPedidos.some((u) => /search\?.*q=gol/.test(u)); i++) await dormir(100);
      assert.ok(giphyPedidos.some((u) => /search\?.*q=gol/.test(u)), 'no buscó');
      await esperar(pa, () => document.querySelectorAll('[id$="tp-giphy"] .chat-stk-b').length === 2);
      await pa.click('[id$="tp-giphy"] .chat-stk-b');
      await sinCapas(pa);
      await esperar(pb, () => [...document.querySelectorAll('#chat-act img.chat-stk')].some((i) => i.src === 'https://media1.giphy.com/media/zzgol/200.webp'));
      const m = ultimo();
      assert.equal(m.tipo, 'sticker'); assert.equal(m.archivo, null); assert.equal(m.externo, 'https://media1.giphy.com/media/zzgol/200.webp');
      const nb = borrados.length;
      await menu(pa, m.id);
      await pa.click('.chat-hoja-menu .chat-i-eliminar'); await pa.click('.chat-hoja-menu .chat-i-eliminar');
      await sinCapas(pa);
      await esperar(pb, (i) => document.querySelector(`#chat-act .chat-msg[data-id="${i}"] .chat-burbuja.eliminado`), m.id);
      await dormir(300);
      assert.equal(borrados.length, nb, 'borró archivos de un sticker');
    });

    await paso('sticker del grupo: quitar los propios con doble toque (el archivo queda)', async () => {
      await pa.click('#chat-act .chat-adj[aria-label="Stickers"]');
      await pa.waitForSelector('.chat-hoja-stk');
      await pa.click('.chat-hoja-stk .chat-tab');
      await esperar(pa, () => !document.querySelector('.chat-stk-quitar-modo').hidden);
      await pa.click('.chat-stk-quitar-modo');
      await pa.click('.chat-stk-x'); await pa.click('.chat-stk-x');
      await esperar(pa, () => /Todavía no hay stickers del grupo/.test(document.querySelector('.chat-hoja-stk').textContent));
      assert.equal(db.stickers.length, 0);
      assert.ok([...archivos.keys()].some((k) => k.startsWith('stickers/')), 'el archivo del sticker se tiene que quedar');
      await pa.keyboard.press('Escape'); await sinCapas(pa);
    });

    // ---------- destacar, eliminar para mí, buscar ----------
    await paso('destacar: estrella en la hora y lista de destacados que lleva al mensaje', async () => {
      const id = idDe('Yo llevo la bebida');
      await menu(pa, id);
      await pa.click('.chat-hoja-menu .chat-i-destacar');
      await sinCapas(pa);
      await esperar(pa, (i) => !!document.querySelector(`#chat-act .chat-msg[data-id="${i}"] .chat-hora svg`), id);
      await pa.click('#chat-act .chat-b-destacados');
      await esperar(pa, () => document.querySelectorAll('.chat-hoja-destacados .chat-res-b').length === 1);
      assert.match(await texto(pa, '.chat-hoja-destacados'), /Beto Gómez.*Yo llevo la bebida/s);
      await pa.click('.chat-hoja-destacados .chat-res-b');
      await sinCapas(pa);
      await esperar(pa, (i) => !!document.querySelector(`#chat-act .chat-msg.resaltado[data-id="${i}"]`), id);
      assert.equal(await cuantos(pb, `#chat-act .chat-msg[data-id="${id}"] .chat-hora svg`), 0, 'destacar es solo de este teléfono');
    });

    await paso('eliminar para mí: desaparece solo para A; el menú del chat lo vuelve a mostrar', async () => {
      const id = idDe('Mensaje mientras no estabas');
      await menu(pa, id);
      await pa.click('.chat-hoja-menu .chat-i-ocultar');
      await sinCapas(pa);
      await esperar(pa, (i) => !document.querySelector(`#chat-act .chat-msg[data-id="${i}"]`), id);
      assert.equal(await cuantos(pb, `#chat-act .chat-msg[data-id="${id}"]`), 1);
      assert.match(await pa.evaluate(() => Object.keys(localStorage).join(' ')), /chat:ocultos:11111111-1111-4111-8111-111111111111:act:aaaaaaaa/);
      await pa.click('#chat-act .chat-b-menu');
      await pa.waitForSelector('.chat-hoja-menu .chat-i-mostrar');
      await pa.click('.chat-hoja-menu .chat-i-mostrar');
      await sinCapas(pa);
      await esperar(pa, (i) => !!document.querySelector(`#chat-act .chat-msg[data-id="${i}"]`), id);
    });

    await paso('buscar en el chat: solo de esta sala, marca lo encontrado y lleva al mensaje', async () => {
      db.mensajes.push({ id: 'zzotra00-0000-4000-8000-000000000000', sala: 'act:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', autor: UA, tipo: 'texto', texto: 'bebida de otra sala', creado: new Date(0).toISOString() });
      db.asistencias.push({ actividad: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', persona: UA, parte: 'actividad' });
      await pa.click('#chat-act .chat-b-buscar');
      await pa.waitForSelector('.chat-hoja-buscar .chat-buscar-q');
      assert.equal(await pa.evaluate(() => document.activeElement.classList.contains('chat-buscar-q')), true, 'el foco va al buscador');
      await pa.type('.chat-hoja-buscar .chat-buscar-q', 'BEBIDA');
      await esperar(pa, () => document.querySelectorAll('.chat-hoja-buscar .chat-res-b').length >= 1);
      await dormir(200);
      assert.equal(await cuantos(pa, '.chat-hoja-buscar .chat-res-b'), 1, 'trajo de otra sala');
      assert.equal(await texto(pa, '.chat-hoja-buscar mark'), 'bebida');
      await pa.screenshot({ path: path.join(shots, 'chat-buscar-claro.png') });
      await pa.click('.chat-hoja-buscar .chat-res-b');
      await sinCapas(pa);
      await esperar(pa, (i) => !!document.querySelector(`#chat-act .chat-msg.resaltado[data-id="${i}"]`), idDe('Yo llevo la bebida'));
      db.mensajes = db.mensajes.filter((m) => m.sala === SALA);
      db.asistencias = db.asistencias.filter((a) => a.actividad === ACT);
    });

    await paso('quien no está anotado no ve el chat', async () => {
      const C = await abrir(b, UC, 'light');
      await C.page.click('.tarjeta-act');
      await C.page.waitForSelector('#btn-voy');
      assert.equal(await cuantos(C.page, '#chat-act'), 0);
      assert.equal(await cuantos(C.page, '.chat'), 0);
      await C.page.close();
    });

    // capturas: claro y oscuro con la conversación (antes de cerrar el chat de B)
    await pb.evaluate(() => { const l = document.querySelector('#chat-act'); l.scrollIntoView({ block: 'start' }); l.querySelector('.chat-lista').scrollTop = 1e6; });
    await pb.screenshot({ path: path.join(shots, 'chat-completo-claro.png') });

    await paso('al volver a la lista el chat se cierra', async () => {
      await pb.evaluate(() => document.querySelector('#pantalla-actividades > .btn-link').click());
      await pb.waitForSelector('.tarjeta-act');
      assert.equal(await cuantos(pb, '#chat-act'), 0);
    });

    await paso('carry Task 4: con el chat cerrado, ni volver a la app (visibilitychange / online) ni un SUBSCRIBED tardío leen mensajes', async () => {
      await dormir(300);
      const antes = lecturasMensajes[UB] || 0;
      assert.ok(antes > 0, 'B tendría que haber leído mensajes con el chat abierto');
      await pb.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online')); window.__estadoTodos('SUBSCRIBED'); });
      await dormir(600);
      assert.equal(lecturasMensajes[UB] || 0, antes, 'se leyeron mensajes con el chat cerrado');
    });

    await escribir(pa, 'Listo, nos vemos a las 19 hs en la cancha, avisen si llegan tarde 👍');
    await sinToast(pa);
    await pa.evaluate(() => { const l = document.querySelector('#chat-act'); l.scrollIntoView({ block: 'start' }); l.querySelector('.chat-lista').scrollTop = 1e6; });
    await pa.screenshot({ path: path.join(shots, 'chat-claro.png') });
    await pa.click('#btn-tema');
    await pa.evaluate(() => { const l = document.querySelector('#chat-act'); l.scrollIntoView({ block: 'start' }); l.querySelector('.chat-lista').scrollTop = 1e6; });
    await pa.screenshot({ path: path.join(shots, 'chat-oscuro.png') });
    await menu(pa, idDe('Llevo las pelotas y redes'));
    await pa.screenshot({ path: path.join(shots, 'chat-menu-oscuro.png') });
    await pa.keyboard.press('Escape');

    await paso('textos largos (2000 caracteres, palabra o link sin espacios, muchos renglones) no se salen del cuadro', async () => {
      await pa.keyboard.press('Escape').catch(() => {});
      await sinCapas(pa);
      await pb.click('.tarjeta-act');
      await pb.waitForSelector('#chat-act .chat-texto');
      const LARGO = 'Palabrasinespacios'.repeat(25) + ' https://maps.app.goo.gl/' + 'x'.repeat(150) + '\n' + 'renglón\n'.repeat(20) + 'jaja'.repeat(400);
      const fuera = (p, quien) => p.evaluate((q) => {
        const caja = (s) => document.querySelector(s).getBoundingClientRect();
        const chat = caja('#chat-act'), lista = document.querySelector('#chat-act .chat-lista');
        const malas = [];
        const dentro = (r, c, n) => { if (r.left < c.left - 1 || r.right > c.right + 1) malas.push(n + ' ' + Math.round(r.left) + '-' + Math.round(r.right) + ' fuera de ' + Math.round(c.left) + '-' + Math.round(c.right)); };
        const t = document.querySelector('#chat-act .chat-texto');
        dentro(t.getBoundingClientRect(), chat, 'campo');
        if (t.getBoundingClientRect().height > 140) malas.push('el campo creció a ' + t.getBoundingClientRect().height);
        dentro(caja('#chat-act .chat-enviar'), chat, 'botón enviar');
        for (const b of document.querySelectorAll('#chat-act .chat-burbuja')) dentro(b.getBoundingClientRect(), lista.getBoundingClientRect(), 'burbuja');
        for (const s of document.querySelectorAll('#chat-act .chat-txt')) if (s.scrollWidth > s.clientWidth + 1) malas.push('el texto desborda su burbuja');
        if (lista.scrollWidth > lista.clientWidth + 1) malas.push('la lista tiene scroll horizontal');
        if (document.documentElement.scrollWidth > innerWidth + 1) malas.push('la página tiene scroll horizontal');
        return malas.map((m) => q + ': ' + m);
      }, quien);
      // escrito (pegado) en el campo, antes de mandar
      await pa.$eval('#chat-act .chat-texto', (e, v) => { e.focus(); e.value = v.slice(0, e.maxLength); e.dispatchEvent(new Event('input')); }, LARGO);
      assert.equal(await pa.$eval('#chat-act .chat-texto', (e) => e.value.length), 2000, 'tope de 2000');
      assert.deepEqual(await fuera(pa, 'A escribiendo'), []);
      await pa.screenshot({ path: path.join(shots, 'chat-largo-campo.png') });
      await pa.click('#chat-act .chat-enviar');
      await esperar(pb, () => [...document.querySelectorAll('#chat-act .chat-txt')].some((e) => e.textContent.startsWith('Palabrasinespacios')));
      await esperar(pa, () => !document.querySelector('#chat-act .subiendo'));
      assert.equal(await pa.$eval('#chat-act .chat-texto', (e) => e.getBoundingClientRect().height < 60), true, 'el campo vuelve a su alto');
      await dormir(300);
      assert.deepEqual(await fuera(pa, 'A (mío)'), []);
      assert.deepEqual(await fuera(pb, 'B (de otro)'), []);
      // citarlo: la cita en el campo y en la burbuja tampoco se sale
      const id = db.mensajes.find((m) => (m.texto || '').startsWith('Palabrasinespacios')).id;
      await menu(pb, id);
      await pb.click('.chat-hoja-menu .chat-i-responder');
      await sinCapas(pb);
      const citando = await pb.$eval('#chat-act .chat-citando', (e) => { const r = e.getBoundingClientRect(), c = document.querySelector('#chat-act').getBoundingClientRect(); return r.right <= c.right + 1 && r.height < 90; });
      assert.equal(citando, true, 'la cita en el campo entra');
      await escribir(pb, 'Qué largo');
      await dormir(300);
      assert.deepEqual(await fuera(pb, 'B con cita'), []);
      assert.deepEqual(await fuera(pa, 'A con cita'), []);
      await pb.evaluate(() => { const l = document.querySelector('#chat-act'); l.scrollIntoView({ block: 'start' }); l.querySelector('.chat-lista').scrollTop = 1e6; });
      await pb.screenshot({ path: path.join(shots, 'chat-largo.png') });
    });

    for (const r of paginas) if (r.page.errores.length) { fallas++; console.log('FALLA errores de página:', r.page.errores); }
  } finally { for (const n of navegadores) await n.close().catch(() => {}); }
  console.log(fallas ? fallas + ' falla(s)' : 'todo ok');
  process.exit(fallas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
