// Prueba de la UI del álbum SIN red ni usuarios reales: un Supabase falso en memoria que atiende a tres páginas
// (Ana y Beto anotados, Cami no), con la regla de la base: solo ve y sube quien está anotado; borra solo el autor.
// Verifica: error inicial con "Reintentar", galería, llegada en vivo a la otra ventana, cola sin señal que sube al volver,
// cámara (dispositivo falso de Chrome), visor, borrar con confirmación en la página (solo el autor), "Ver en Drive" en vivo,
// "Mandar al chat", que quien no está anotado no ve el álbum y que con el álbum cerrado no se lee nada.
// Capturas en dev/shots/album-*.png (claro y oscuro, 390x844). No toca el proyecto real ni necesita contraseñas.
// Uso: servir la raíz con `npx --yes http-server -p 8080 -c-1` y correr `node dev/tools/prueba-album-mock.js`
// (URL_APP=http://127.0.0.1:8082 para otro puerto).
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const SAFARI = /^webkit/.test(process.env.NAVEGADOR || ''); // WebKit no tiene la cámara falsa de Chrome
const puppeteer = require('./navegador'); // puppeteer-core, o WebKit con NAVEGADOR=webkit
const URL_APP = process.env.URL_APP || 'http://127.0.0.1:8080';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
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
  actividades: [{ id: ACT, creador: UA, tipo: 'asado', tipo_otro: null, titulo: 'Asado de fin de año', fecha: new Date(ahora + 864e5).toISOString(), lugar: 'Quinta de Beto', cupo: null, descripcion: '', tiene_tercer: false, tercer_lugar: null, tercer_fecha: null, estado: 'confirmada', creado: new Date(ahora - 1e6).toISOString(), drive_url: null }],
  asistencias: [{ actividad: ACT, persona: UA, parte: 'actividad' }, { actividad: ACT, persona: UB, parte: 'actividad' }],
  fotos: [],
  mensajes: [],
  storage: new Map(), // ruta → dueño
  tipos: new Map(), // ruta → tipo del archivo subido
};
const paginas = []; // { page, uid }
const enSala = (uid, sala) => { const m = /^act:(.+)$/.exec(sala || ''); return !!m && db.asistencias.some((a) => a.actividad === m[1] && a.persona === uid); };
let fallarFotos = 0;
let fallarSubida = null; // { uid, status, veces }: las próximas subidas de ese usuario contestan ese error
const lecturas = {}; // selects a fotos por usuario

function emitir(tabla, evento, fila) {
  for (const p of paginas) {
    if (tabla === 'fotos' && evento !== 'DELETE' && !enSala(p.uid, 'act:' + fila.actividad)) continue;
    p.page.evaluate((t, e, f) => window.__emitir(t, e, f), tabla, evento, fila).catch(() => {});
  }
}
const cumple = (fila, filtros) => filtros.every(([op, col, v]) => (op === 'eq' ? fila[col] === v : op === 'in' ? v.includes(fila[col]) : true));
function consulta(uid, s) {
  if (s.rpc) {
    if (s.rpc === 'album_uso') return { data: 123 * 1048576 };
    if (s.rpc === 'en_sala') return { data: enSala(uid, s.args && s.args.sala) };
    if (s.rpc === 'en_album') return { data: enSala(uid, 'act:' + (s.args && s.args.p_album)) };
    return { error: { message: 'rpc desconocida ' + s.rpc } };
  }
  if (s.storage) {
    const carpeta = s.path.split('/')[0];
    if (s.storage === 'upload') {
      if (fallarSubida && fallarSubida.uid === uid && fallarSubida.veces > 0) { fallarSubida.veces--; return { error: { statusCode: fallarSubida.status, message: 'error ' + fallarSubida.status } }; }
      if (!enSala(uid, carpeta.startsWith('act:') ? carpeta : 'act:' + carpeta)) return { error: { statusCode: '403', message: 'RLS' } };
      db.storage.set(s.path, uid); if (s.tipo) db.tipos.set(s.path, s.tipo); return { data: { path: s.path } };
    }
    if (s.storage === 'remove') { for (const p of s.paths) if (db.storage.get(p) === uid) db.storage.delete(p); return { data: [] }; }
  }
  if (s.table === 'fotos') {
    if (s.action === 'select') {
      lecturas[uid] = (lecturas[uid] || 0) + 1;
      if (fallarFotos > 0) { fallarFotos--; return { error: { message: 'sin red' } }; }
    }
    if (s.action === 'insert') {
      const v = s.values;
      if (!enSala(uid, 'act:' + v.actividad)) return { error: { code: '42501', message: 'RLS' } };
      if (db.fotos.some((f) => f.id === v.id)) return { error: { code: '23505', message: 'ya está' } };
      const fila = { ...v, autor: uid, creado: new Date().toISOString(), drive_id: null, drive_error: null, drive_tomado: null, liberada: false };
      db.fotos.push(fila); emitir('fotos', 'INSERT', fila);
      return { data: { ...fila } };
    }
    if (s.action === 'delete') {
      const borrar = db.fotos.filter((f) => cumple(f, s.filtros) && f.autor === uid && enSala(uid, 'act:' + f.actividad));
      db.fotos = db.fotos.filter((f) => !borrar.includes(f));
      borrar.forEach((f) => emitir('fotos', 'DELETE', { id: f.id }));
      return { data: borrar.map((f) => ({ id: f.id })) };
    }
    const r = db.fotos.filter((f) => enSala(uid, 'act:' + f.actividad) && cumple(f, s.filtros));
    return { data: s.single ? (r[0] ? { ...r[0] } : null) : r.map((x) => ({ ...x })) };
  }
  if (s.table === 'mensajes') {
    if (s.action === 'insert') {
      const v = s.values;
      if (!enSala(uid, v.sala)) return { error: { code: '42501', message: 'RLS' } };
      const fila = { id: 'm' + db.mensajes.length + '-0000-4000-8000-000000000000', sala: v.sala, autor: uid, tipo: v.tipo, texto: v.texto || null, archivo: v.archivo || null, ancho: v.ancho || null, alto: v.alto || null, editado: false, creado: new Date().toISOString() };
      db.mensajes.push(fila);
      return { data: fila };
    }
    return { data: s.single ? null : db.mensajes.filter((m) => enSala(uid, m.sala) && cumple(m, s.filtros)) };
  }
  const r = (db[s.table] || []).filter((f) => cumple(f, s.filtros));
  return { data: s.single ? (r[0] ? { ...r[0] } : null) : r.map((x) => ({ ...x })) };
}

// ---------- Cliente falso que se inyecta en lugar de vendor/supabase.js ----------
const STUB = `
(function () {
  const Q = (spec) => window.__q(JSON.stringify(spec)).then((r) => JSON.parse(r));
  const R = (r) => ({ data: r.data === undefined ? null : r.data, error: r.error || null });
  function Builder(table) {
    const s = { table, action: 'select', filtros: [], single: false, values: null };
    const b = {
      select() { return b; },
      insert(v) { s.action = 'insert'; s.values = v; return b; },
      update(v) { s.action = 'update'; s.values = v; return b; },
      delete() { s.action = 'delete'; return b; },
      eq(c, v) { s.filtros.push(['eq', c, v]); return b; },
      in(c, v) { s.filtros.push(['in', c, v]); return b; },
      or() { return b; }, order() { return b; }, limit() { return b; },
      single() { s.single = true; return b; },
      maybeSingle() { s.single = true; return b; },
      then(res, rej) { return Q(s).then(R).then(res, rej); },
    };
    return b;
  }
  const canales = new Set();
  const pasa = (filtro, fila) => { if (!filtro) return true; const m = /^([a-z_]+)=eq\\.(.*)$/.exec(filtro); if (!m) throw new Error('filtro de canal desconocido: ' + filtro); return String(fila[m[1]]) === m[2]; };
  window.__topics = [];
  window.__emitir = (tabla, evento, fila) => canales.forEach((c) => c.cbs.filter((x) => x.tabla === tabla && (x.evento === evento || x.evento === '*') && (evento === 'DELETE' || pasa(x.filtro, fila)))
    .forEach((x) => x.fn(evento === 'DELETE' ? { eventType: evento, old: fila, new: {} } : { eventType: evento, new: fila })));
  window.__estadoCanales = (st) => canales.forEach((c) => c.estado && c.estado(st));
  window.__canales = () => canales.size;
  const svg = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#00B1EF"/><circle cx="200" cy="150" r="80" fill="#002F68"/></svg>');
  window.supabase = { createClient() {
    return {
      from: Builder,
      rpc(fn, args) { return Q({ rpc: fn, args }).then(R); },
      channel(topic) {
        window.__topics.push(topic);
        const c = { cbs: [], on(_t, f, fn) { c.cbs.push({ tabla: f.table, evento: f.event, filtro: f.filter, fn }); return c; }, subscribe(cb) { c.estado = cb; canales.add(c); if (cb) setTimeout(() => cb('SUBSCRIBED'), 0); return c; } };
        return c;
      },
      removeChannel(c) { canales.delete(c); },
      storage: { from() { return {
        // lo subido queda también en la página: así un video se puede reproducir desde su "URL firmada"
        upload: (p, b) => { (window.__subidos = window.__subidos || {})[p] = b; return Q({ storage: 'upload', path: p, tipo: b && b.type }).then(R); },
        remove: (ps) => Q({ storage: 'remove', path: '', paths: ps }).then(R),
        createSignedUrls: async (paths) => ({ data: paths.map((p) => ({ path: p, error: null,
          signedUrl: /\\.(mp4|webm)$/.test(p) && window.__subidos && window.__subidos[p] ? URL.createObjectURL(window.__subidos[p]) : window.__fotoUrl || svg })), error: null }),
      }; } },
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}), getUser: async () => ({ data: { user: null } }) },
    };
  } };
})();`;

const navegadores = [];
async function abrir(uid, tema, antes) {
  // un navegador por ventana (una pestaña en segundo plano no avanza); cámara falsa de Chrome para probar el disparo
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  navegadores.push(browser);
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(URL_APP, ['camera', 'microphone']);
  const page = await browser.newPage();
  const reg = { page, uid };
  paginas.push(reg);
  page.errores = [];
  page.on('pageerror', (e) => page.errores.push(e.message));
  if (process.env.DEPURAR) page.on('console', (m) => console.log('[' + uid.slice(0, 2) + ']', m.text()));
  await page.exposeFunction('__q', async (j) => JSON.stringify(consulta(uid, JSON.parse(j))));
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  page.on('request', (rq) => {
    if (rq.url().endsWith('/vendor/supabase.js')) rq.respond({ status: 200, contentType: 'application/javascript', body: STUB });
    else if (/fonts\.(googleapis|gstatic)\.com/.test(rq.url())) rq.respond({ status: 200, contentType: 'text/css', body: '' });
    else rq.continue();
  });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: tema }]);
  await page.goto(URL_APP, { waitUntil: 'networkidle0' });
  // la cola es del teléfono (IndexedDB): cada corrida arranca limpia
  await page.evaluate(() => new Promise((ok) => { const r = indexedDB.deleteDatabase('thirdcedi-album'); r.onsuccess = r.onerror = r.onblocked = () => ok(); }));
  if (antes) await antes(page);
  await page.evaluate((p) => { App.modoAcceso(false); App.setPerfil(p); }, db.perfiles.find((p) => p.id === uid));
  await page.waitForSelector('.tarjeta-act', { timeout: 8000 });
  return reg;
}
const texto = (p, sel) => p.$eval(sel, (e) => e.textContent);
const cuantos = (p, sel) => p.$$eval(sel, (e) => e.length);
const esperar = (p, fn, ...a) => p.waitForFunction(fn, { timeout: 8000 }, ...a);
const celdas = (p) => cuantos(p, '#album-act .album-cel');

(async () => {
  let fallas = 0;
  const paso = async (n, fn) => { try { await fn(); console.log('ok', n); } catch (e) { fallas++; console.log('FALLA', n, '-', e.message, (e.stack || '').split('\n').filter((l) => l.includes('prueba-album-mock')).map((l) => l.replace(/.*:(\d+):\d+\)?$/, 'línea $1')).join(' < ')); } };
  // una foto de prueba (PNG generado con un canvas) para la galería
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'album-mock-'));
  const fixture = path.join(tmp, 'foto-prueba.png');
  try {
    // Ventana A (Ana). Primero el error inicial: la carga inicial y la de SUBSCRIBED fallan las dos.
    fallarFotos = 2;
    const A = await abrir(UA, 'light');
    const pa = A.page;
    const dataUrl = await pa.evaluate(() => { const c = document.createElement('canvas'); c.width = 1200; c.height = 900; const g = c.getContext('2d'); g.fillStyle = '#002F68'; g.fillRect(0, 0, 1200, 900); g.fillStyle = '#00B1EF'; g.beginPath(); g.arc(600, 450, 300, 0, 7); g.fill(); return c.toDataURL('image/png'); });
    fs.writeFileSync(fixture, Buffer.from(dataUrl.split(',')[1], 'base64'));
    // las URLs firmadas falsas devuelven una imagen de verdad (para guardar, editar y mandar al chat)
    const chica = await pa.evaluate(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; const g = c.getContext('2d'); g.fillStyle = '#00B1EF'; g.fillRect(0, 0, 400, 300); g.fillStyle = '#002F68'; g.beginPath(); g.arc(200, 150, 90, 0, 7); g.fill(); return c.toDataURL('image/jpeg', 0.8); });
    const ponerFoto = (p) => p.evaluate((u) => { window.__fotoUrl = u; }, chica);
    await ponerFoto(pa);
    await pa.click('.tarjeta-act');
    await pa.waitForSelector('#album-act');

    await paso('error inicial: ofrece Reintentar y recupera', async () => {
      await pa.waitForSelector('#album-reintentar', { timeout: 8000 });
      assert.match(await texto(pa, '#album-act'), /No pudimos cargar el álbum/);
      await pa.click('#album-reintentar');
      await esperar(pa, () => /Todavía no hay fotos/.test(document.querySelector('#album-act').textContent));
      assert.equal(await cuantos(pa, '#album-drive:not([hidden])'), 0, 'sin drive_url no hay link a Drive');
    });

    const B = await abrir(UB, 'dark');
    const pb = B.page;
    await ponerFoto(pb);
    await pb.click('.tarjeta-act');
    await pb.waitForSelector('#album-act');
    await esperar(pb, () => /Todavía no hay fotos/.test(document.querySelector('#album-act').textContent));

    await paso('quien no está anotado no ve el álbum', async () => {
      const C = await abrir(UC, 'light');
      await C.page.click('.tarjeta-act');
      await C.page.waitForSelector('#btn-voy');
      assert.equal(await cuantos(C.page, '#album-act'), 0);
    });

    await paso('galería: sube, aparece en A y en vivo en B', async () => {
      const input = await pa.$('#album-act input[type=file]');
      await input.uploadFile(fixture);
      await esperar(pa, () => document.querySelectorAll('#album-act .album-cel').length === 1);
      await esperar(pb, () => document.querySelectorAll('#album-act .album-cel').length === 1);
      assert.equal(db.fotos.length, 1);
      const f = db.fotos[0];
      assert.equal(f.ruta, `${ACT}/${f.id}.jpg`); assert.equal(f.mini, `${ACT}/${f.id}.t.webp`); assert.equal(f.media, `${ACT}/${f.id}.m.jpg`);
      assert.ok(!('autor' in JSON.parse(JSON.stringify(f)) && f.autor !== UA), 'autor lo pone el servidor');
      assert.ok(db.storage.has(f.ruta) && db.storage.has(f.mini) && db.storage.has(f.media), 'subió original, miniatura y media');
      assert.match(await texto(pb, '#album-act .album-estado'), /1 foto/);
    });

    await paso('sin señal: queda en la cola y sube al volver', async () => {
      await pa.setOfflineMode(true);
      await pa.evaluate(() => dispatchEvent(new Event('offline')));
      const input = await pa.$('#album-act input[type=file]');
      await input.uploadFile(fixture);
      await esperar(pa, () => /esperando señal/.test(document.querySelector('#album-act .album-estado').textContent));
      assert.equal(db.fotos.length, 1, 'sin señal no se sube');
      await pa.screenshot({ path: path.join(shots, 'album-sin-senal-claro.png') });
      await pa.setOfflineMode(false);
      await pa.evaluate(() => dispatchEvent(new Event('online')));
      await esperar(pa, () => document.querySelectorAll('#album-act .album-cel').length === 2);
      await esperar(pb, () => document.querySelectorAll('#album-act .album-cel').length === 2);
      assert.equal(db.fotos.length, 2);
    });

    // WebKit no tiene la cámara falsa de Chrome: en Safari la cámara se prueba en el teléfono
    if (SAFARI) await paso('(WebKit) en lugar de la cámara, otra foto de la galería', async () => {
      await (await pa.$('#album-act input[type=file]')).uploadFile(fixture);
      await esperar(pa, () => document.querySelectorAll('#album-act .album-cel').length === 3);
      await esperar(pb, () => document.querySelectorAll('#album-act .album-cel').length === 3);
    });
    else await paso('cámara: abre, saca una foto y sube', async () => {
      await pa.click('#album-camara');
      await pa.waitForSelector('#camara:not([hidden]) video');
      await esperar(pa, () => { const v = document.querySelector('#camara video'); return v.videoWidth > 0; });
      await pa.screenshot({ path: path.join(shots, 'album-camara-claro.png') });
      await pa.click('#camara [data-c="disparo"]');
      await esperar(pa, () => document.querySelectorAll('#album-act .album-cel').length === 3);
      await esperar(pb, () => document.querySelectorAll('#album-act .album-cel').length === 3);
      await pa.click('#camara [data-c="cerrar"]');
      await esperar(pa, () => document.getElementById('camara').hidden);
    });

    await paso('"Ver en Drive" aparece en vivo cuando el servidor pone drive_url', async () => {
      db.actividades[0].drive_url = 'https://drive.google.com/drive/folders/abc123';
      emitir('actividades', 'UPDATE', db.actividades[0]);
      await esperar(pb, () => { const a = document.getElementById('album-drive'); return a && !a.hidden && a.href === 'https://drive.google.com/drive/folders/abc123'; });
      await esperar(pa, () => !document.getElementById('album-drive').hidden);
    });

    await paso('capturas del álbum (claro y oscuro)', async () => {
      await pa.evaluate(() => document.querySelector('#album-act').scrollIntoView({ block: 'start' }));
      await pb.evaluate(() => document.querySelector('#album-act').scrollIntoView({ block: 'start' }));
      await new Promise((r) => setTimeout(r, 300));
      for (const p of [pa, pb]) assert.doesNotMatch(await texto(p, '#album-act'), /false|null|undefined/);
      await pa.screenshot({ path: path.join(shots, 'album-claro.png') });
      await pb.screenshot({ path: path.join(shots, 'album-oscuro.png') });
    });

    const deAna = db.fotos[0].id;
    await paso('visor de B con una foto de Ana: sin "Borrar"', async () => {
      await pb.click(`#album-act .album-cel[data-id="${deAna}"]`);
      await pb.waitForSelector('.album-visor');
      assert.equal(await pb.$eval('.album-borrar', (e) => e.hidden), true);
      assert.match(await texto(pb, '.album-visor .cab'), /Ana Pérez/);
      await pb.screenshot({ path: path.join(shots, 'album-visor-oscuro.png') });
      await pb.keyboard.press('Escape');
      await esperar(pb, () => !document.querySelector('.album-visor'));
    });

    await paso('"Mandar al chat" manda la foto al chat de la actividad', async () => {
      await pa.click(`#album-act .album-cel[data-id="${deAna}"]`);
      await pa.waitForSelector('.album-visor');
      assert.equal(await pa.$eval('.album-al-chat', (e) => e.hidden), false);
      await pa.click('.album-al-chat');
      for (let i = 0; i < 40 && !db.mensajes.length; i++) await new Promise((r) => setTimeout(r, 200));
      assert.equal(db.mensajes.length, 1, 'toast: ' + await texto(pa, '#toast'));
      assert.equal(db.mensajes.filter((m) => m.tipo === 'foto' && m.sala === 'act:' + ACT).length, 1);
    });

    await paso('borrar: confirmación en la página, un toque rápido no alcanza, borra en las dos ventanas', async () => {
      await pa.click('.album-borrar');
      await pa.waitForSelector('.album-confirmar:not([hidden])');
      await pa.click('.album-borrar-si'); // antes del medio segundo: no borra
      assert.equal(db.fotos.length, 3);
      await pa.screenshot({ path: path.join(shots, 'album-borrar-claro.png') });
      await new Promise((r) => setTimeout(r, 600));
      await pa.click('.album-borrar-si');
      await esperar(pa, () => !document.querySelector('.album-visor'));
      await esperar(pa, () => document.querySelectorAll('#album-act .album-cel').length === 2);
      await esperar(pb, () => document.querySelectorAll('#album-act .album-cel').length === 2);
      assert.ok(!db.fotos.some((f) => f.id === deAna));
      assert.ok(![...db.storage.keys()].some((k) => k.includes(deAna)), 'se borraron los archivos');
    });

    await paso('reconexión: SUBSCRIBED de nuevo se pone al día sin duplicar', async () => {
      const id = 'bbbbbbbb-0000-4000-8000-000000000001';
      db.fotos.push({ id, actividad: ACT, autor: UB, ruta: `${ACT}/${id}.jpg`, mini: `${ACT}/${id}.t.webp`, media: null, ancho: 10, alto: 10, bytes: 1, tomada: new Date().toISOString(), creado: new Date().toISOString(), editada_de: null, drive_id: null, liberada: false });
      await pb.evaluate(() => window.__estadoCanales('SUBSCRIBED'));
      await esperar(pb, () => document.querySelectorAll('#album-act .album-cel').length === 3);
      await pb.evaluate(() => window.__estadoCanales('SUBSCRIBED'));
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(await celdas(pb), 3);
    });

    await paso('con el álbum cerrado no se lee nada ni hay canal', async () => {
      await pb.evaluate(() => [...document.querySelectorAll('#pantalla-actividades .btn-link')].find((b) => /Volver/.test(b.textContent)).click());
      await pb.waitForSelector('.tarjeta-act');
      const antes = lecturas[UB];
      assert.equal(await pb.evaluate(() => window.__canales()), 3, 'quedan solo los canales de sesión: actividades, lista de juegos y broadcast juegos-lista');
      const id = 'bbbbbbbb-0000-4000-8000-000000000002';
      const fila = { id, actividad: ACT, autor: UA, ruta: `${ACT}/${id}.jpg`, mini: `${ACT}/${id}.t.webp`, media: null, ancho: 10, alto: 10, bytes: 1, tomada: new Date().toISOString() };
      db.fotos.push(fila); emitir('fotos', 'INSERT', fila);
      await pb.evaluate(() => { dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); });
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(lecturas[UB], antes);
    });

    // ---- Ajustes de cierre (Task 10) ----
    await paso('la línea de estado no se vuelve a anunciar si no cambió (aria-live solo con el texto)', async () => {
      await pa.waitForSelector('#album-act .album-estado [aria-live]');
      // primero se pone al día (puede haber cambios de verdad pendientes); después, sin cambios, no se anuncia nada
      await pa.evaluate(() => window.__estadoCanales('SUBSCRIBED'));
      await new Promise((r) => setTimeout(r, 400));
      await pa.evaluate(() => {
        window.__mutEstado = 0;
        const viva = document.querySelector('#album-act [aria-live]');
        new MutationObserver((ms) => { window.__mutEstado += ms.length; }).observe(viva, { childList: true, characterData: true, subtree: true });
      });
      await pa.evaluate(() => window.__estadoCanales('SUBSCRIBED'));
      await new Promise((r) => setTimeout(r, 400));
      await pa.evaluate(() => window.__estadoCanales('SUBSCRIBED'));
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(await pa.evaluate(() => window.__mutEstado), 0);
      assert.equal(await pa.evaluate(() => !!document.querySelector('#album-act [aria-live] .barra')), false, 'la barra no va dentro del aria-live');
    });

    await paso('un 403 con en_album = sí (sesión que se renovó) no descarta la foto: se reintenta y sube', async () => {
      const antes = db.fotos.length;
      fallarSubida = { uid: UA, status: '403', veces: 1 };
      const input = await pa.$('#album-act input[type=file]');
      await input.uploadFile(fixture);
      for (let i = 0; i < 60 && db.fotos.length === antes; i++) await new Promise((r) => setTimeout(r, 200));
      assert.equal(db.fotos.length, antes + 1, 'se descartó: ' + await texto(pa, '#toast'));
      assert.equal(fallarSubida.veces, 0);
      fallarSubida = null;
    });

    await paso('editor: filtro, intensidad, recorte 1:1, giro y "Guardar copia" suma una foto nueva al álbum', async () => {
      const antes = db.fotos.length, id = await pa.$eval('#album-act .album-cel', (e) => e.dataset.id);
      await pa.click(`#album-act .album-cel[data-id="${id}"]`);
      await pa.waitForSelector('.album-visor');
      const titulo = await texto(pa, '.album-visor .cab');
      await pa.click('.album-editar');
      await pa.waitForSelector('#editorFoto:not([hidden]) .fl[data-f="pelicula"]');
      await esperar(pa, () => document.querySelector('#editorFoto canvas.vista').width > 0);
      assert.equal(await pa.$eval('#editorGuardar', (b) => b.disabled), true, 'sin cambios no se guarda');
      assert.equal(await pa.$$eval('#editorFoto .fl', (xs) => xs.length), 8);
      await pa.click('#editorFoto .fl[data-f="pelicula"]');
      assert.equal(await pa.$eval('#editorFoto .fl[data-f="pelicula"]', (b) => b.getAttribute('aria-pressed')), 'true');
      await pa.$eval('#editorIntensidad', (r) => { r.value = '60'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
      assert.equal(await texto(pa, '#editorFoto .int output'), '60 %');
      await pa.screenshot({ path: path.join(shots, 'album-editor-filtros-claro.png') });
      await pa.click('#editorFoto [data-modo="recorte"]');
      await pa.waitForSelector('#editorFoto .caja:not([hidden])');
      await pa.click('#editorFoto [data-r="1:1"]');
      // arrastrar la esquina de abajo a la derecha hacia adentro (con la proporción fija)
      const m = await pa.$eval('#editorFoto .m[data-m="se"]', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await pa.mouse.move(m.x, m.y); await pa.mouse.down(); await pa.mouse.move(m.x - 30, m.y - 30, { steps: 4 }); await pa.mouse.up();
      await pa.screenshot({ path: path.join(shots, 'album-editor-recorte-claro.png') });
      await pa.click('#editorFoto [data-e="rotar"]');
      // con el editor abierto, las flechas y el Escape no llegan al visor: Escape pide confirmar y un segundo Escape vuelve
      await pa.keyboard.press('ArrowRight'); await pa.keyboard.press('ArrowLeft');
      await pa.click('#editorFoto [data-modo="filtros"]');
      await pa.keyboard.press('Escape');
      await pa.waitForSelector('#editorDescartar:not([hidden])');
      await pa.keyboard.press('Escape');
      await esperar(pa, () => document.getElementById('editorDescartar').hidden);
      assert.ok(await pa.$('.album-visor'), 'el visor se cerró con el editor abierto');
      assert.equal(await texto(pa, '.album-visor .cab'), titulo, 'las flechas pasaron de foto debajo del editor');
      // deshacer el giro y volver a girar
      await pa.click('#editorFoto [data-e="deshacer"]');
      await pa.click('#editorFoto [data-e="rotar"]');
      await pa.click('#editorGuardar');
      await esperar(pa, () => document.getElementById('editorFoto').hidden);
      for (let i = 0; i < 40 && db.fotos.length === antes; i++) await new Promise((r) => setTimeout(r, 200));
      assert.equal(db.fotos.length, antes + 1, 'no se subió la copia');
      const nueva = db.fotos[db.fotos.length - 1];
      assert.equal(nueva.editada_de, id);
      assert.equal(nueva.ancho, nueva.alto, `el recorte 1:1 no quedó cuadrado: ${nueva.ancho}x${nueva.alto}`);
      assert.ok(nueva.ancho < 300 && nueva.ancho > 200, 'el arrastre de la esquina no achicó el recorte: ' + nueva.ancho);
      assert.ok(db.fotos.some((f) => f.id === id), 'la original sigue');
      await esperar(pa, (n) => document.querySelectorAll('#album-act .album-cel').length === n, db.fotos.filter((f) => f.actividad === ACT).length);
      await pa.keyboard.press('Escape');
      await esperar(pa, () => !document.querySelector('.album-visor'));
    });

    await paso('visor: Tab no se escapa del visor; con el editor abierto, Escape y las flechas no lo tocan', async () => {
      const id = await pa.$eval('#album-act .album-cel', (e) => e.dataset.id);
      await pa.click(`#album-act .album-cel[data-id="${id}"]`);
      await pa.waitForSelector('.album-visor');
      for (let i = 0; i < 8; i++) {
        await pa.keyboard.press('Tab');
        assert.equal(await pa.evaluate(() => !!document.activeElement.closest('.album-visor')), true, 'el foco salió del visor en el Tab ' + (i + 1));
      }
      await pa.keyboard.down('Shift'); await pa.keyboard.press('Tab'); await pa.keyboard.up('Shift');
      assert.equal(await pa.evaluate(() => !!document.activeElement.closest('.album-visor')), true, 'Shift+Tab');
      const titulo = await texto(pa, '.album-visor .cab');
      await pa.evaluate(() => { window.__abiertoReal = EditorFoto.abierto; EditorFoto.abierto = () => true; });
      await pa.keyboard.press('ArrowRight');
      await pa.keyboard.press('ArrowLeft');
      await pa.keyboard.press('ArrowLeft');
      await pa.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 200));
      assert.ok(await pa.$('.album-visor'), 'Escape cerró el visor que estaba debajo del editor');
      assert.equal(await texto(pa, '.album-visor .cab'), titulo, 'las flechas pasaron de foto');
      await pa.evaluate(() => { EditorFoto.abierto = window.__abiertoReal; });
      await pa.keyboard.press('Escape');
      await esperar(pa, () => !document.querySelector('.album-visor'));
    });

    await paso('cámara: Escape la cierra', async () => {
      await pa.click('#album-camara');
      await pa.waitForSelector('#camara:not([hidden])');
      await pa.keyboard.press('Escape');
      await esperar(pa, () => document.getElementById('camara').hidden);
      assert.equal(await pa.evaluate(() => !!(history.state && history.state.cam)), false, 'quedó la entrada de la cámara');
    });

    if (SAFARI) console.log('(se saltea el video con la cámara: necesita la cámara falsa de Chrome)');
    else await paso('video: graba con la cámara, aparece en la grilla con play y duración, se reproduce, se manda al chat (sube el video) y se borra', async () => {
      const antes = db.fotos.length, msjs = db.mensajes.length;
      await pa.click('#album-camara');
      await pa.waitForSelector('#camara:not([hidden]) video');
      await esperar(pa, () => document.querySelector('#camara video').videoWidth > 0);
      await pa.click('#camara [data-c="m-video"]');
      await esperar(pa, () => document.querySelector('#camara.modo-video') && document.querySelector('#camara video').videoWidth > 0 && !document.querySelector('#camara [data-c="opc"]').hidden);
      assert.match(await texto(pa, '#camara [data-c="opc"]'), /^(720p|1080p|4K) · \d+$/);
      await pa.click('#camara [data-c="opc"]');
      await pa.waitForSelector('#camara .panel:not([hidden])');
      assert.match(await texto(pa, '#camara .panel'), /Resolución.*Cuadros por segundo.*Formato.*Sonido/s);
      await pa.screenshot({ path: path.join(shots, 'album-camara-video-opciones-claro.png') });
      await pa.keyboard.press('Escape');
      await esperar(pa, () => document.querySelector('#camara .panel').hidden && !document.getElementById('camara').hidden);
      await pa.click('#camara [data-c="disparo"]');
      await esperar(pa, () => document.querySelector('#camara.grabando'));
      assert.equal(await pa.$eval('#camara [data-c="lente"]', (b) => b.disabled), true, 'se puede cambiar de cámara grabando');
      await new Promise((r) => setTimeout(r, 1800));
      assert.match(await texto(pa, '#camara .rec'), /0:0[12]/);
      await pa.click('#camara [data-c="disparo"]');
      for (let i = 0; i < 50 && db.fotos.length === antes; i++) await new Promise((r) => setTimeout(r, 200));
      assert.equal(db.fotos.length, antes + 1, 'no se subió el video');
      const v = db.fotos[db.fotos.length - 1];
      assert.equal(v.tipo, 'video'); assert.ok(v.duracion_ms >= 1000 && v.duracion_ms < 4000, 'duración ' + v.duracion_ms);
      assert.match(v.ruta, new RegExp(`^${ACT}/${v.id}\\.(mp4|webm)$`)); assert.equal(v.media, null);
      assert.equal(v.mime, v.ruta.endsWith('.mp4') ? 'video/mp4' : 'video/webm');
      assert.equal(db.tipos.get(v.ruta), v.mime, 'el archivo subió con el tipo del video');
      assert.ok(db.storage.has(v.mini), 'subió la miniatura');
      await pa.click('#camara [data-c="cerrar"]');
      await esperar(pa, () => document.getElementById('camara').hidden);
      // en la grilla: play y duración
      await esperar(pa, (id) => !!document.querySelector(`#album-act .album-cel.es-video[data-id="${id}"] .dur`), v.id);
      assert.match(await pa.$eval(`#album-act .album-cel[data-id="${v.id}"] .dur`, (e) => e.textContent), /^0:0[1-3]$/);
      assert.match(await pa.$eval(`#album-act .album-cel[data-id="${v.id}"]`, (e) => e.getAttribute('aria-label')), /^Video de 0:0\d de Ana/);
      await pa.evaluate((id) => document.querySelector(`#album-act .album-cel[data-id="${id}"]`).scrollIntoView({ block: 'center' }), v.id);
      await pa.screenshot({ path: path.join(shots, 'album-video-grilla-claro.png') });
      // visor: se reproduce, sin "Editar"
      await pa.click(`#album-act .album-cel[data-id="${v.id}"]`);
      await pa.waitForSelector('.album-visor video:not([hidden])');
      assert.equal(await pa.$eval('.album-editar', (e) => e.hidden), true, 'Editar en un video');
      await esperar(pa, () => { const x = document.querySelector('.album-visor video'); return x.src && x.readyState >= 2; });
      await pa.evaluate(() => { const x = document.querySelector('.album-visor video'); x.muted = true; return x.play(); });
      await esperar(pa, () => document.querySelector('.album-visor video').currentTime > 0.3);
      await pa.screenshot({ path: path.join(shots, 'album-video-visor-claro.png') });
      // al chat va el video (se sube al chat con su miniatura), no un link
      if (!(await pa.$eval('.album-al-chat', (e) => e.hidden))) {
        await pa.click('.album-al-chat');
        for (let i = 0; i < 80 && db.mensajes.length === msjs; i++) await new Promise((r) => setTimeout(r, 100));
        const m = db.mensajes[db.mensajes.length - 1];
        assert.equal(m.tipo, 'video', 'toast: ' + await texto(pa, '#toast'));
        assert.match(m.archivo, new RegExp(`^act:${ACT}/videos/[0-9a-f-]{36}\\.(mp4|webm)$`));
        assert.ok(db.storage.has(m.archivo.replace(/\.(mp4|webm)$/, '.t.webp')), 'falta la miniatura del video en el chat');
      }
      // borrar
      await pa.click('.album-borrar');
      await pa.waitForSelector('.album-confirmar:not([hidden])');
      assert.match(await texto(pa, '.album-confirmar'), /¿Borrar este video\?/);
      await new Promise((r) => setTimeout(r, 600));
      await pa.click('.album-borrar-si');
      await esperar(pa, () => !document.querySelector('.album-visor'));
      assert.ok(!db.fotos.some((f) => f.id === v.id), 'quedó la fila');
      assert.ok(![...db.storage.keys()].some((k) => k.includes(v.id)), 'quedaron archivos del video');
    });

    await paso('si el álbum se cierra con el visor abierto (me sacaron de la actividad), no quedan entradas de "atrás"', async () => {
      const id = await pa.$eval('#album-act .album-cel', (e) => e.dataset.id);
      await pa.click(`#album-act .album-cel[data-id="${id}"]`);
      await pa.waitForSelector('.album-visor');
      assert.equal(await pa.evaluate(() => !!(history.state && history.state.albumFoto)), true);
      const fila = db.asistencias.find((x) => x.persona === UA);
      db.asistencias = db.asistencias.filter((x) => x !== fila);
      emitir('asistencias', 'DELETE', fila);
      await esperar(pa, () => !document.querySelector('#album-act') && !document.querySelector('.album-visor'));
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(await pa.evaluate(() => !!(history.state && (history.state.albumFoto || history.state.albumConf))), false, 'quedó la entrada del visor');
      db.asistencias.push(fila);
      emitir('asistencias', 'INSERT', fila);
      await pa.waitForSelector('#album-act');
    });

    await paso('"se descartó" avisa aunque el álbum esté cerrado (la cola sube en segundo plano)', async () => {
      await pa.setOfflineMode(true);
      await pa.evaluate(() => dispatchEvent(new Event('offline')));
      const input = await pa.$('#album-act input[type=file]');
      await input.uploadFile(fixture);
      await esperar(pa, () => /esperando señal/.test(document.querySelector('#album-act .album-estado').textContent));
      await pa.evaluate(() => [...document.querySelectorAll('#pantalla-actividades .btn-link')].find((b) => /Volver/.test(b.textContent)).click());
      await pa.waitForSelector('.tarjeta-act');
      fallarSubida = { uid: UA, status: '415', veces: 1 };
      await pa.setOfflineMode(false);
      await pa.evaluate(() => dispatchEvent(new Event('online')));
      await esperar(pa, () => /se descartó/.test(document.getElementById('toast').textContent) && !document.getElementById('toast').hidden);
      fallarSubida = null;
    });

    if (process.env.NAVEGADOR === 'webkit-privado') console.log('(se saltea "la cola arranca al entrar": en privado no se guarda nada en el teléfono)');
    else await paso('la cola arranca al entrar: lo pendiente de antes sube sin abrir el álbum', async () => {
      const id = 'dddddddd-0000-4000-8000-000000000001';
      const B2 = await abrir(UB, 'light', (page) => page.evaluate((id, act, autor) => new Promise((ok, mal) => {
        const c = document.createElement('canvas'); c.width = 8; c.height = 8;
        c.toBlob((foto) => {
          const r = indexedDB.open('thirdcedi-album', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('pendientes', { keyPath: 'id' });
          r.onerror = () => mal(r.error);
          r.onsuccess = () => {
            const t = r.result.transaction('pendientes', 'readwrite');
            t.objectStore('pendientes').put({ id, actividad: act, autor, foto, mini: foto, media: null, ancho: 8, alto: 8, tomada: new Date().toISOString(), editada_de: null });
            t.oncomplete = () => { r.result.close(); ok(); }; t.onerror = () => mal(t.error);
          };
        }, 'image/jpeg');
      }), id, ACT, UB));
      for (let i = 0; i < 40 && !db.fotos.some((f) => f.id === id); i++) await new Promise((r) => setTimeout(r, 200));
      assert.ok(db.fotos.some((f) => f.id === id), 'no se subió sin abrir el álbum');
      assert.equal(await cuantos(B2.page, '#album-act'), 0, 'el álbum no estaba abierto');
    });

    await paso('sin errores de JavaScript', async () => {
      for (const p of paginas) assert.deepEqual(p.page.errores, [], 'errores en ' + p.uid.slice(0, 2));
    });
  } finally {
    await Promise.all(navegadores.map((b) => b.close().catch(() => {})));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(fallas ? `ÁLBUM MOCK: ${fallas} falla(s)` : 'ÁLBUM MOCK OK');
  process.exit(fallas ? 1 : 0);
})();
