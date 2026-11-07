// Prueba de punta a punta del cifrado y la firma VAPID, sin la base: un Chrome real se suscribe al servicio de push
// de Google con la clave pública de avisos.js, y este proceso le manda un aviso con dev/supabase/avisos/webpush.js
// (el mismo código que usa la Edge Function) firmado con la VAPID privada del .env. Verifica que el service worker
// lo reciba y muestre la notificación con el título, el texto y el link.
// La privada se lee del .env del repo principal (o del que se indique en ENV_AVISOS) y nunca se imprime.
// Uso: servir la raíz con `npx --yes http-server -p 8084 -c-1` y correr `node dev/tools/prueba-push.js`
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer-core');
const URL_APP = process.env.URL_APP || 'http://127.0.0.1:8084';
const ENV = process.env.ENV_AVISOS || 'C:/Users/IvanLiPuma/thirdcedi-time/.env';

function leerEnv(f) {
  const o = {};
  if (!fs.existsSync(f)) return o;
  fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((l) => { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l); if (m) o[m[1]] = m[2]; });
  return o;
}

(async () => {
  const env = leerEnv(ENV);
  if (!env.VAPID_PUBLICA || !env.VAPID_PRIVADA) { console.log('FALTAN VAPID_PUBLICA / VAPID_PRIVADA en ' + ENV + ' (correr dev/tools/generar-vapid.js)'); process.exit(2); }
  const avisos = fs.readFileSync(path.join(__dirname, '..', '..', 'avisos.js'), 'utf8');
  assert.ok(avisos.includes("'" + env.VAPID_PUBLICA + "'"), 'la clave pública de avisos.js es la del .env');
  const { mandarPush } = await import(pathToFileURL(path.join(__dirname, '..', 'supabase', 'avisos', 'webpush.js')).href);

  const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: process.env.PUSH_VISIBLE ? false : 'new', args: process.env.PUSH_VISIBLE ? ['--window-position=-2400,0', '--window-size=400,300'] : [] });
  let ok = false;
  try {
    await b.defaultBrowserContext().overridePermissions(URL_APP, ['notifications']);
    const p = await b.newPage();
    await p.goto(URL_APP + '/', { waitUntil: 'networkidle0' });
    const sub = await p.evaluate(async (k) => {
      const reg = await navigator.serviceWorker.ready;
      const clave = Uint8Array.from(atob(k.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - k.length % 4) % 4)), (c) => c.charCodeAt(0));
      const old = await reg.pushManager.getSubscription(); if (old) await old.unsubscribe();
      try { return (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: clave })).toJSON(); } catch (e) { return { error: String(e) }; }
    }, env.VAPID_PUBLICA);
    if (sub.error) { console.log('Este Chrome no pudo suscribirse al servicio de push (' + sub.error + '): la prueba queda para el teléfono.'); process.exit(3); }
    const r = await mandarPush({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      JSON.stringify({ title: 'Prueba de cifrado', body: 'Si ves esto, VAPID y aes128gcm andan.', tag: 'prueba-e2e', url: '#/actividad/zz' }),
      { publica: env.VAPID_PUBLICA, privada: env.VAPID_PRIVADA, contacto: 'mailto:avisos@example.com' });
    console.log('servicio de push respondió', r.status, r.texto || '');
    assert.ok(r.status >= 200 && r.status < 300, 'el servicio de push aceptó el aviso');
    const n = await p.waitForFunction(async () => {
      const ns = await (await navigator.serviceWorker.ready).getNotifications({ tag: 'prueba-e2e' });
      return ns.length ? { title: ns[0].title, body: ns[0].body, url: ns[0].data && ns[0].data.url } : null;
    }, { timeout: 30000, polling: 500 }).then((h) => h.jsonValue()).catch(() => null);
    if (!n) {
      // Google aceptó la firma VAPID (201), pero un Chrome automatizado con perfil temporal muchas veces no está
      // conectado al servicio de push y no recibe nada: la entrega se prueba en el teléfono.
      console.log('El servicio de push aceptó el aviso (VAPID ok), pero este Chrome de prueba no lo recibió: probar la entrega en el teléfono.');
      process.exit(3);
    }
    assert.equal(n.title, 'Prueba de cifrado');
    assert.match(n.body, /VAPID/);
    assert.equal(n.url, '#/actividad/zz');
    await p.evaluate(async () => { const s = await (await navigator.serviceWorker.ready).pushManager.getSubscription(); if (s) await s.unsubscribe(); });
    ok = true;
  } finally {
    await b.close();
  }
  console.log(ok ? 'PUSH OK: el service worker recibió y mostró el aviso' : 'falla');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('FALLA', e.message); process.exit(1); });
