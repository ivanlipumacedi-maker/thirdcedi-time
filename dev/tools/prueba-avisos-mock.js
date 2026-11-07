// Prueba de la UI de avisos (Perfil y links de los avisos) SIN red ni push real: un Supabase falso en memoria y un
// PushManager / Notification falsos (no hace falta un servicio de push).
// Verifica: "Activar avisos" pide permiso, suscribe con la clave VAPID pública y registra con push_registrar; "Mandarme
// una prueba" llama a avisos_probar (y respeta el límite); "Desactivar" borra la fila y desuscribe; con el permiso
// bloqueado explica cómo habilitarlo (Android y iPhone); en iPhone sin instalar explica cómo agregarla a inicio; al
// entrar con avisos ya activos re-registra el teléfono; al cerrar sesión borra la suscripción; los links
// #/actividad/<id> y #/juegos/<id> abren el detalle y la partida (al cargar y con el mensaje del service worker).
// Uso: servir la raíz con `npx --yes http-server -p 8084 -c-1` y correr `node dev/tools/prueba-avisos-mock.js`
// (URL_APP=http://127.0.0.1:8084 por defecto).
const assert = require('assert/strict');
const puppeteer = require('puppeteer-core');
const URL_APP = process.env.URL_APP || 'http://127.0.0.1:8084';
const VAPID_PUBLICA = 'BPJl0VBLTFJaw7kbYXsCc2SV4Ljx_9SUQnasklcWQCbAgbvChhtUqxMiDxfEJcRCNPLiMtKWUrHP9TBahw61sW8';

const UA = '11111111-1111-4111-8111-111111111111', UB = '22222222-2222-4222-8222-222222222222';
const ACT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', PAR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ahora = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const db = {
  perfiles: [{ id: UA, nombre: 'Ana Pérez', foto: null, empresa: 'CEDI' }, { id: UB, nombre: 'Beto Gómez', foto: null, empresa: 'Wemox' }],
  actividades: [{ id: ACT, creador: UB, tipo: 'asado', tipo_otro: null, titulo: 'Asado de prueba avisos', fecha: iso(ahora + 864e5), lugar: 'Quincho', cupo: null, descripcion: '', tiene_tercer: false, tercer_lugar: null, tercer_fecha: null, estado: 'confirmada', creado: iso(ahora - 1e6), drive_url: null }],
  asistencias: [{ actividad: ACT, persona: UA, parte: 'actividad' }, { actividad: ACT, persona: UB, parte: 'actividad' }],
  partidas: [{ id: PAR, juego: 'trivia', creador: UB, estado: 'espera', estado_juego: {}, creado: iso(ahora - 1e5) }],
  jugadores: [{ partida: PAR, persona: UB, puntos: 0, se_fue: false, unido: iso(ahora - 1e5) }, { partida: PAR, persona: UA, puntos: 0, se_fue: false, unido: iso(ahora - 1e5) }],
  push_subs: [],
};
const llamadas = [];
let ultimaPrueba = 0;
const cumple = (fila, filtros) => filtros.every(([op, col, v]) => (op === 'eq' ? fila[col] === v : op === 'in' ? v.includes(fila[col]) : true));

function consulta(uid, s) {
  llamadas.push({ uid, t: s.table, a: s.action, v: s.values, f: s.filtros });
  if (s.action === 'rpc') {
    if (s.table === 'push_registrar') {
      const v = s.values;
      if (!/^https:\/\//.test(v.p_endpoint) || !v.p_p256dh || !v.p_auth) return { error: { message: 'datos inválidos' } };
      db.push_subs = db.push_subs.filter((x) => x.endpoint !== v.p_endpoint);
      db.push_subs.push({ endpoint: v.p_endpoint, persona: uid, p256dh: v.p_p256dh, auth: v.p_auth });
      return { data: null };
    }
    if (s.table === 'avisos_probar') {
      if (Date.now() - ultimaPrueba < 30000) return { data: false };
      ultimaPrueba = Date.now();
      return { data: true };
    }
    if (s.table === 'ahora_ms') return { data: Date.now() };
    return { error: { message: 'sin rpc ' + s.table } };
  }
  if (s.table === 'push_subs' && s.action === 'delete') {
    const antes = db.push_subs.length;
    db.push_subs = db.push_subs.filter((f) => !(cumple(f, s.filtros) && f.persona === uid));
    return { data: null, borradas: antes - db.push_subs.length };
  }
  if (s.action !== 'select') return { data: null };
  let r = (db[s.table] || []).filter((f) => cumple(f, s.filtros));
  if (s.table === 'push_subs') r = r.filter((f) => f.persona === uid);
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
      select() { return b; }, insert(v) { s.action = 'insert'; s.values = v; return b; }, upsert(v) { s.action = 'upsert'; s.values = v; return b; },
      update(v) { s.action = 'update'; s.values = v; return b; }, delete() { s.action = 'delete'; return b; },
      eq(c, v) { s.filtros.push(['eq', c, v]); return b; }, in(c, v) { s.filtros.push(['in', c, v]); return b; },
      lt() { return b; }, gt() { return b; }, gte() { return b; }, lte() { return b; }, neq() { return b; }, is() { return b; }, or() { return b; }, not() { return b; }, range() { return b; },
      order() { return b; }, limit(n) { s.limite = n; return b; }, single() { s.single = true; return b; }, maybeSingle() { s.single = true; return b; },
      then(res, rej) { return Q(s).then(forma).then(res, rej); },
    };
    return b;
  }
  window.supabase = { createClient() {
    return {
      from: Builder,
      rpc(nombre, args) { return Q({ table: nombre, action: 'rpc', values: args, filtros: [], ordenes: [] }).then(forma); },
      channel(topic) { const c = { topic, on() { return c; }, subscribe(cb) { if (cb) setTimeout(() => cb('SUBSCRIBED'), 0); return c; } }; return c; },
      removeChannel() {},
      storage: { from() { return { upload: async (p) => ({ data: { path: p }, error: null }), remove: async () => ({ data: [], error: null }), createSignedUrls: async () => ({ data: [], error: null }), createSignedUrl: async () => ({ data: null, error: { message: 'no' } }) }; } },
      auth: { getSession: async () => ({ data: { session: window.__sesionUid ? { user: { id: window.__sesionUid } } : null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => { window.__salio = true; return {}; }, getUser: async () => ({ data: { user: null } }) },
    };
  } };
})();`;

// Push y permisos falsos. opc: { permiso, ios, instalada, subPrevia }
function preparar(opc) {
  window.__permiso = opc.permiso || 'default';
  window.__sesionUid = opc.sesion || null;
  window.__pedidos = 0;
  if (opc.ios) {
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
    Object.defineProperty(navigator, 'standalone', { get: () => !!opc.instalada });
    if (!opc.instalada) { delete window.PushManager; delete window.Notification; return; }
  }
  const N = function () {};
  Object.defineProperty(N, 'permission', { get: () => window.__permiso });
  N.requestPermission = async () => { window.__pedidos++; if (window.__permiso === 'default') window.__permiso = 'granted'; return window.__permiso; };
  window.Notification = N;
  let sub = null;
  const crear = (key, ep) => ({
    endpoint: ep || 'https://fcm.googleapis.com/fcm/send/zz-' + Math.random().toString(36).slice(2),
    options: { applicationServerKey: key },
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'BPzzP256dhFalsa', auth: 'zzAuth' } }; },
    unsubscribe: async () => { sub = null; window.__desuscripto = (window.__desuscripto || 0) + 1; return true; },
  });
  if (opc.subPrevia) {
    const b = atob(opc.subPrevia.clave.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - opc.subPrevia.clave.length % 4) % 4));
    sub = crear(Uint8Array.from(b, (c) => c.charCodeAt(0)).buffer, opc.subPrevia.endpoint);
  }
  window.__clave = null;
  PushManager.prototype.getSubscription = async function () { return sub; };
  PushManager.prototype.subscribe = async function (o) {
    window.__clave = btoa(String.fromCharCode(...new Uint8Array(o.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    sub = crear(new Uint8Array(o.applicationServerKey).buffer);
    return sub;
  };
}

const navegadores = [];
async function abrir(uid, opc = {}, hash = '') {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  navegadores.push(browser);
  const page = await browser.newPage();
  page.errores = [];
  page.on('pageerror', (e) => page.errores.push(e.message));
  if (process.env.DEPURAR) page.on('console', (m) => console.log('[pag]', m.text()));
  await page.exposeFunction('__q', async (j) => JSON.stringify(consulta(uid, JSON.parse(j))));
  await page.evaluateOnNewDocument(preparar, opc);
  await page.setRequestInterception(true);
  page.on('request', (rq) => {
    if (rq.url().endsWith('/vendor/supabase.js')) rq.respond({ status: 200, contentType: 'application/javascript', body: STUB });
    else if (/fonts\.(googleapis|gstatic)\.com/.test(rq.url())) rq.respond({ status: 200, contentType: 'text/css', body: '' });
    else rq.continue();
  });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto(URL_APP + '/' + hash, { waitUntil: 'networkidle0' });
  // con opc.sesion entra por login.js (pinta el Perfil completo, con "Cerrar sesión"); si no, se fija el perfil a mano
  if (opc.sesion) await page.waitForFunction(() => !!App.yo(), { timeout: 8000 });
  else await page.evaluate((p) => { App.modoAcceso(false); App.setPerfil(p); }, db.perfiles.find((p) => p.id === uid));
  return page;
}
const esperar = (p, fn, ...a) => p.waitForFunction(fn, { timeout: 8000 }, ...a);
const avisosTxt = (p) => p.$eval('#perfil-avisos', (e) => e.textContent);
const irPerfil = async (p) => { await p.evaluate(() => { location.hash = '#/perfil'; }); await p.waitForSelector('#perfil-avisos h2', { timeout: 8000 }); };
const cerrar = async () => { while (navegadores.length) await navegadores.pop().close().catch(() => {}); };

(async () => {
  let fallas = 0;
  const paso = async (nombre, fn) => { try { await fn(); console.log('ok', nombre); } catch (e) { fallas++; console.log('FALLA', nombre, '-', e.message); } };
  try {
    let p = await abrir(UA, { sesion: UA });
    await paso('Perfil muestra "Activar avisos" con permiso sin pedir', async () => {
      await irPerfil(p);
      await p.waitForSelector('#btn-avisos-on', { timeout: 8000 });
      assert.match(await avisosTxt(p), /Activar avisos/);
      assert.equal(await p.evaluate(() => window.__pedidos), 0, 'no pide permiso solo');
    });
    await paso('Activar: pide permiso, suscribe con la clave pública y registra con push_registrar', async () => {
      await p.click('#btn-avisos-on');
      await p.waitForSelector('#avisos-activos', { timeout: 8000 });
      assert.equal(await p.evaluate(() => window.__pedidos), 1);
      assert.equal(await p.evaluate(() => window.__clave), VAPID_PUBLICA);
      assert.equal(db.push_subs.length, 1);
      assert.equal(db.push_subs[0].persona, UA);
      assert.match(db.push_subs[0].endpoint, /^https:\/\/fcm/);
      assert.match(await avisosTxt(p), /te vamos a avisar/);
    });
    await paso('Mandarme una prueba llama a avisos_probar y respeta el límite', async () => {
      await p.click('#btn-avisos-probar');
      await esperar(p, () => /aviso de prueba/.test(document.getElementById('perfil-avisos').textContent));
      await p.click('#btn-avisos-probar');
      await esperar(p, () => /Esperá unos segundos/.test(document.getElementById('perfil-avisos').textContent));
      assert.equal(llamadas.filter((l) => l.t === 'avisos_probar').length, 2);
    });
    await paso('Desactivar: borra la fila y desuscribe', async () => {
      await p.click('#btn-avisos-off');
      await p.waitForSelector('#btn-avisos-on', { timeout: 8000 });
      assert.equal(db.push_subs.length, 0);
      assert.equal(await p.evaluate(() => window.__desuscripto), 1);
      assert.match(await avisosTxt(p), /ya no recibe avisos/);
    });
    await paso('Cerrar sesión con avisos activos: borra la suscripción antes de salir', async () => {
      await p.click('#btn-avisos-on');
      await p.waitForSelector('#avisos-activos', { timeout: 8000 });
      assert.equal(db.push_subs.length, 1);
      await p.evaluate(() => [...document.querySelectorAll('#perfil-contenido .btn-link')].find((b) => /Cerrar sesión/.test(b.textContent)).click());
      await esperar(p, () => window.__salio === true);
      assert.equal(db.push_subs.length, 0, 'se borró la fila');
      assert.equal(await p.evaluate(() => window.__desuscripto), 2);
    });
    assert.deepEqual(p.errores, [], 'errores de página: ' + p.errores.join(' | '));
    await cerrar();

    await paso('al entrar con avisos ya activos (otro dueño del teléfono): se re-registra a nombre propio', async () => {
      const ep = 'https://fcm.googleapis.com/fcm/send/zz-previa';
      db.push_subs = [{ endpoint: ep, persona: UB, p256dh: 'x', auth: 'y' }];
      p = await abrir(UA, { permiso: 'granted', subPrevia: { clave: VAPID_PUBLICA, endpoint: ep } });
      await esperar(p, () => true);
      for (let i = 0; i < 40 && !(db.push_subs[0] && db.push_subs[0].persona === UA); i++) await new Promise((r) => setTimeout(r, 100));
      assert.deepEqual(db.push_subs.map((x) => x.persona), [UA]);
      await irPerfil(p);
      await p.waitForSelector('#avisos-activos', { timeout: 8000 });
      await cerrar();
      db.push_subs = [];
    });

    await paso('suscripción vieja con otra clave VAPID: se descarta y se vuelve a ofrecer activar', async () => {
      p = await abrir(UA, { permiso: 'granted', subPrevia: { clave: 'BOtraClaveQueNoEsLaNuestraXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', endpoint: 'https://fcm.googleapis.com/fcm/send/zz-vieja' } });
      await irPerfil(p);
      await p.waitForSelector('#btn-avisos-on', { timeout: 8000 });
      assert.ok(await p.evaluate(() => window.__desuscripto >= 1), 'desuscribió la vieja');
      await cerrar();
    });

    await paso('permiso bloqueado en Android: explica cómo habilitarlo', async () => {
      p = await abrir(UA, { permiso: 'denied' });
      await irPerfil(p);
      await p.waitForSelector('#avisos-bloqueados', { timeout: 8000 });
      const t = await avisosTxt(p);
      assert.match(t, /bloqueados/);
      assert.match(t, /candado/);
      assert.match(t, /Notificaciones ▸ Permitir/);
      assert.equal(await p.$('#btn-avisos-on'), null, 'sin botón de activar');
      await cerrar();
    });

    await paso('iPhone sin instalar: explica cómo agregarla a la pantalla de inicio', async () => {
      p = await abrir(UA, { ios: true, instalada: false });
      await irPerfil(p);
      await p.waitForSelector('#avisos-ios', { timeout: 8000 });
      const t = await avisosTxt(p);
      assert.match(t, /Agregar a inicio/);
      assert.match(t, /Compartir/);
      assert.equal(await p.$('#btn-avisos-on'), null);
      assert.deepEqual(p.errores, [], 'errores de página: ' + p.errores.join(' | '));
      await cerrar();
    });

    await paso('iPhone instalada con permiso bloqueado: explica Ajustes ▸ Notificaciones', async () => {
      p = await abrir(UA, { ios: true, instalada: true, permiso: 'denied' });
      await irPerfil(p);
      await p.waitForSelector('#avisos-bloqueados', { timeout: 8000 });
      assert.match(await avisosTxt(p), /Ajustes ▸ Notificaciones ▸ ThirdCEDI Time/);
      await cerrar();
    });

    await paso('link #/actividad/<id> al abrir la app: muestra el detalle de la actividad', async () => {
      p = await abrir(UA, {}, '#/actividad/' + ACT);
      await esperar(p, () => !document.getElementById('pantalla-actividades').hidden && /Asado de prueba avisos/.test(document.getElementById('pantalla-actividades').textContent) && !document.querySelector('#pantalla-actividades .tarjeta-act'));
      assert.equal(await p.evaluate(() => location.hash), '#/actividades');
      assert.deepEqual(p.errores, [], 'errores de página: ' + p.errores.join(' | '));
    });

    await paso('notificación tocada con la app abierta (mensaje del SW): abre la partida', async () => {
      await p.evaluate((id) => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { tipo: 'abrir', url: location.origin + '/#/juegos/' + id } })), PAR);
      await esperar(p, () => !document.getElementById('pantalla-juegos').hidden && /Trivia/.test(document.getElementById('pantalla-juegos').textContent) && /Volver/.test(document.getElementById('pantalla-juegos').textContent));
      assert.equal(await p.evaluate(() => location.hash), '#/juegos');
      assert.ok(llamadas.some((l) => l.t === 'partidas' && l.f.some(([op, c, v]) => op === 'eq' && c === 'id' && v === PAR)), 'leyó la partida');
    });

    await paso('y con el mensaje del SW a una actividad: vuelve al detalle', async () => {
      await p.evaluate((id) => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { tipo: 'abrir', url: location.origin + '/#/actividad/' + id } })), ACT);
      await esperar(p, () => !document.getElementById('pantalla-actividades').hidden && /Asado de prueba avisos/.test(document.getElementById('pantalla-actividades').textContent) && !document.querySelector('#pantalla-actividades .tarjeta-act'));
      assert.deepEqual(p.errores, [], 'errores de página: ' + p.errores.join(' | '));
      await cerrar();
    });

    await paso('link a una actividad que ya no existe: queda la lista', async () => {
      p = await abrir(UA, {}, '#/actividad/dddddddd-dddd-4ddd-8ddd-dddddddddddd');
      await p.waitForSelector('#pantalla-actividades .tarjeta-act', { timeout: 8000 });
      await cerrar();
    });
  } catch (e) {
    fallas++; console.log('FALLA general -', e.message);
  } finally {
    await cerrar();
  }
  console.log(fallas ? `${fallas} falla(s)` : 'todo ok');
  process.exit(fallas ? 1 : 0);
})();
