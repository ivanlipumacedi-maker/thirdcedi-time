// Prueba del acceso con captcha (Cloudflare Turnstile) y de la cuenta dada de baja, con un Supabase falso (no hace
// falta ninguna contraseña ni mandar mails).
// Verifica:
// - sin site key (TURNSTILE_SITE_KEY vacía, como hoy): no se pide nada a challenges.cloudflare.com, no hay widget y
//   signInWithOtp va sin captchaToken (igual que antes);
// - con la site key de prueba de Cloudflare que siempre pasa (1x00000000000000000000AA, se mete reescribiendo app.js):
//   se carga el script de Turnstile, el widget se pinta con el tema de la app (y se vuelve a pintar al cambiarlo) y el
//   token llega a signInWithOtp en options.captchaToken; el segundo envío lleva un token nuevo;
// - si el script de Turnstile no carga: mensaje claro con "Probar de nuevo", no se manda nada, y al volver la red
//   "Probar de nuevo" lo arregla;
// - perfil con activo = false (20): "Tu cuenta está dada de baja…", sin pestañas ni lecturas de datos, y "Cerrar sesión".
// Este necesita salida a internet (challenges.cloudflare.com) para el caso con la clave de prueba.
// Uso: servir la raíz con `npx --yes http-server -p 8080 -c-1` y correr `node dev/tools/prueba-login-mock.js`
const assert = require('assert/strict');
const path = require('path');
const puppeteer = require('puppeteer-core');
const URL_APP = process.env.URL_APP || 'http://127.0.0.1:8080';
const CLAVE_PRUEBA = '1x00000000000000000000AA';
const TOKEN_PRUEBA = 'XXXX.DUMMY.TOKEN.XXXX';
const UA = '11111111-1111-4111-8111-111111111111';
const SHOTS = path.join(__dirname, '..', 'shots');

// Cliente falso: la sesión y el perfil salen de window.__sesion / window.__perfil (los pone cada caso).
const STUB = `
(function () {
  window.__otp = []; window.__lecturas = []; window.__salidas = 0;
  let alCambio = null;
  function Builder(table) {
    const s = { table, single: false };
    const b = {
      select() { return b; }, insert() { return b; }, update() { return b; }, delete() { return b; },
      eq() { return b; }, in() { return b; }, lt() { return b; }, or() { return b; }, order() { return b; }, limit() { return b; },
      single() { s.single = true; return b; }, maybeSingle() { s.single = true; return b; },
      then(res, rej) {
        window.__lecturas.push(table);
        const data = table === 'perfiles' ? (window.__perfil || null) : (s.single ? null : []);
        return Promise.resolve({ data, error: null }).then(res, rej);
      },
    };
    return b;
  }
  window.supabase = { createClient() {
    return {
      from: Builder,
      rpc: async () => ({ data: null, error: null }),
      channel() { const c = { on() { return c; }, subscribe() { return c; } }; return c; },
      removeChannel() {},
      storage: { from() { return { upload: async () => ({ data: null, error: null }), remove: async () => ({ data: [], error: null }), createSignedUrls: async () => ({ data: [], error: null }) }; } },
      auth: {
        getSession: async () => ({ data: { session: window.__sesion || null } }),
        onAuthStateChange: (cb) => { alCambio = cb; return { data: { subscription: { unsubscribe() {} } } }; },
        signInWithOtp: async (args) => { window.__otp.push(JSON.parse(JSON.stringify(args))); return { data: {}, error: null }; },
        verifyOtp: async () => ({ data: {}, error: { code: 'otp_expired', status: 403, message: 'expired' } }),
        signOut: async () => { window.__salidas++; window.__sesion = null; if (alCambio) alCambio('SIGNED_OUT', null); return {}; },
        getUser: async () => ({ data: { user: window.__sesion ? window.__sesion.user : null } }),
      },
    };
  } };
})();`;

const navegadores = [];
// opciones: clave (site key a meter en app.js), bloquearTurnstile (función que dice si se corta el script), sesion, perfil
async function abrir(op = {}) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  navegadores.push(browser);
  const page = await browser.newPage();
  page.errores = [];
  page.pedidosCF = [];
  page.on('pageerror', (e) => page.errores.push(e.message));
  if (process.env.DEPURAR) page.on('console', (m) => console.log('[pág]', m.text()));
  await page.evaluateOnNewDocument((sesion, perfil) => {
    window.__sesion = sesion; window.__perfil = perfil;
  }, op.sesion || null, op.perfil || null);
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  page.on('request', async (rq) => {
    const u = rq.url();
    if (/challenges\.cloudflare\.com/.test(u)) {
      page.pedidosCF.push(u);
      if (op.bloquearTurnstile && op.bloquearTurnstile()) return rq.abort('internetdisconnected');
      return rq.continue();
    }
    if (u.endsWith('/vendor/supabase.js')) return rq.respond({ status: 200, contentType: 'application/javascript', body: STUB });
    if (/fonts\.(googleapis|gstatic)\.com/.test(u)) return rq.respond({ status: 200, contentType: 'text/css', body: '' });
    if (op.clave && /\/app\.js(\?|$)/.test(u)) {
      const r = await fetch(u);
      const js = await r.text();
      assert.ok(js.includes("const TURNSTILE_SITE_KEY = '';"), 'app.js no tiene la constante vacía');
      return rq.respond({ status: 200, contentType: 'application/javascript', body: js.replace("const TURNSTILE_SITE_KEY = '';", "const TURNSTILE_SITE_KEY = '" + op.clave + "';") });
    }
    return rq.continue();
  });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto(URL_APP, { waitUntil: 'networkidle2' });
  return page;
}
const visible = (p, sel) => p.$eval(sel, (e) => !e.hidden && !e.closest('[hidden]') && e.getClientRects().length > 0).catch(() => false);
const esperar = (p, fn, ms, ...a) => p.waitForFunction(fn, { timeout: ms || 8000 }, ...a);
const mandarMail = async (p, mail) => {
  await p.$eval('#in-mail', (e, v) => { e.value = v; }, mail);
  await p.$eval('#btn-mail', (e) => e.click());
};

(async () => {
  let fallas = 0;
  const paso = async (nombre, fn) => { try { await fn(); console.log('ok', nombre); } catch (e) { fallas++; console.log('FALLA', nombre, '-', e.message); } };
  const paginas = [];
  try {
    await paso('sin site key: no se carga Turnstile, no hay widget y signInWithOtp va igual que antes', async () => {
      const p = await abrir(); paginas.push(p);
      await esperar(p, () => !document.getElementById('paso-mail').hidden && !document.getElementById('acceso').hidden);
      assert.equal(await visible(p, '#captcha-zona'), false, 'se ve la zona del captcha');
      await mandarMail(p, 'ana.perez@cedi.com.ar');
      await esperar(p, () => !document.getElementById('paso-codigo').hidden);
      const otp = await p.evaluate(() => window.__otp);
      assert.deepEqual(otp, [{ email: 'ana.perez@cedi.com.ar', options: { shouldCreateUser: true } }]);
      assert.equal(p.pedidosCF.length, 0, 'pidió a Cloudflare: ' + p.pedidosCF.join(', '));
      assert.equal(await p.evaluate(() => typeof window.turnstile), 'undefined');
    });

    await paso('con la site key de prueba: el widget se pinta (tema de la app) y el token llega a signInWithOtp', async () => {
      const p = await abrir({ clave: CLAVE_PRUEBA }); paginas.push(p);
      await esperar(p, (t) => { const i = document.querySelector('#captcha [name="cf-turnstile-response"]'); return i && i.value === t; }, 20000, TOKEN_PRUEBA);
      assert.equal(await visible(p, '#captcha-zona'), true);
      const tema = await p.evaluate(() => document.documentElement.getAttribute('data-tema'));
      assert.equal(await p.$eval('#captcha', (e) => e.dataset.tema), tema === 'oscuro' ? 'dark' : 'light');
      assert.ok(p.pedidosCF.some((u) => u.includes('/turnstile/v0/api.js?render=explicit')), 'no cargó el script');
      // el script viene de Cloudflare y el service worker no lo cachea (solo guarda lo del mismo origen)
      await p.screenshot({ path: path.join(SHOTS, 'login-captcha-' + tema + '.png') });
      await mandarMail(p, 'ana.perez@cedi.com.ar');
      await esperar(p, () => !document.getElementById('paso-codigo').hidden, 30000);
      const otp = await p.evaluate(() => window.__otp);
      assert.equal(otp.length, 1);
      assert.equal(otp[0].options.captchaToken, TOKEN_PRUEBA);
      assert.equal(otp[0].options.shouldCreateUser, true);
      // cambiar el tema vuelve a pintar el widget con el tema nuevo
      await p.$eval('#btn-tema', (e) => e.click());
      await esperar(p, () => document.getElementById('captcha').dataset.pintadas === '2');
      assert.equal(await p.$eval('#captcha', (e) => e.dataset.tema), tema === 'oscuro' ? 'light' : 'dark');
      await p.screenshot({ path: path.join(SHOTS, 'login-captcha-codigo-' + (tema === 'oscuro' ? 'claro' : 'oscuro') + '.png') });
      // otro envío (cambiar de mail): lleva un token nuevo (el primero ya se gastó)
      await p.$eval('#btn-cambiar-mail', (e) => e.click());
      await mandarMail(p, 'beto.gomez@cedi.com.ar');
      await esperar(p, () => window.__otp.length === 2 && !document.getElementById('paso-codigo').hidden, 30000);
      const otp2 = await p.evaluate(() => window.__otp);
      assert.equal(otp2[1].options.captchaToken, TOKEN_PRUEBA);
      assert.equal(await visible(p, '#captcha-error'), false);
    });

    await paso('si Turnstile no carga: mensaje claro con "Probar de nuevo", no se manda nada; con red vuelve a andar', async () => {
      let cortado = true;
      const p = await abrir({ clave: CLAVE_PRUEBA, bloquearTurnstile: () => cortado }); paginas.push(p);
      await esperar(p, () => { const e = document.getElementById('captcha-error'); return e && !e.hidden; });
      assert.match(await p.$eval('#captcha-error', (e) => e.textContent), /No pudimos comprobar que sos una persona\. Revisá tu conexión y probá de nuevo\./);
      assert.equal(await visible(p, '#btn-captcha-otra'), true);
      await p.screenshot({ path: path.join(SHOTS, 'login-captcha-error.png') });
      await mandarMail(p, 'ana.perez@cedi.com.ar');
      await new Promise((r) => setTimeout(r, 400));
      assert.equal((await p.evaluate(() => window.__otp)).length, 0, 'mandó el código sin captcha');
      assert.equal(await visible(p, '#paso-mail'), true);
      assert.equal(await p.$eval('#err-mail', (e) => e.hidden), true, 'el error sale dos veces');
      assert.equal(await p.$eval('#btn-mail', (e) => e.disabled), false, 'el botón quedó trabado');
      cortado = false;
      await p.$eval('#btn-captcha-otra', (e) => e.click());
      await esperar(p, () => !!document.querySelector('#captcha [name="cf-turnstile-response"]'), 20000);
      assert.equal(await visible(p, '#captcha-error'), false);
      await mandarMail(p, 'ana.perez@cedi.com.ar');
      await esperar(p, () => !document.getElementById('paso-codigo').hidden, 30000);
      assert.equal((await p.evaluate(() => window.__otp))[0].options.captchaToken, TOKEN_PRUEBA);
    });

    await paso('cuenta dada de baja (activo = false): lo dice, no muestra la app ni lee datos, y deja cerrar sesión', async () => {
      const sesion = { user: { id: UA, email: 'ana.perez@cedi.com.ar' }, access_token: 'x' };
      const perfil = { id: UA, nombre: 'Ana Pérez', foto: null, empresa: 'CEDI', activo: false };
      const p = await abrir({ sesion, perfil }); paginas.push(p);
      await esperar(p, () => !document.getElementById('paso-baja').hidden);
      assert.equal((await p.$eval('#txt-baja', (e) => e.textContent)).trim(), 'Tu cuenta está dada de baja. Si es un error, hablá con el organizador.');
      assert.equal(await visible(p, '#pantallas'), false, 'se ven las pantallas');
      assert.equal(await visible(p, '.pestanas'), false, 'se ven las pestañas');
      assert.equal(await visible(p, '#paso-mail'), false);
      await new Promise((r) => setTimeout(r, 500));
      assert.deepEqual([...new Set(await p.evaluate(() => window.__lecturas))], ['perfiles'], 'leyó otras tablas');
      assert.equal(await p.evaluate(() => App.yo()), null);
      await p.screenshot({ path: path.join(SHOTS, 'login-baja.png') });
      await p.$eval('#btn-baja-salir', (e) => e.click());
      await esperar(p, () => !document.getElementById('paso-mail').hidden);
      assert.equal(await p.evaluate(() => window.__salidas), 1);
    });

    await paso('con perfil activo entra a la app como siempre', async () => {
      const sesion = { user: { id: UA, email: 'ana.perez@cedi.com.ar' }, access_token: 'x' };
      const p = await abrir({ sesion, perfil: { id: UA, nombre: 'Ana Pérez', foto: null, empresa: 'CEDI', activo: true } }); paginas.push(p);
      await esperar(p, () => document.getElementById('acceso').hidden && !document.body.classList.contains('sin-sesion'));
      assert.equal(await p.evaluate(() => App.yo() && App.yo().nombre), 'Ana Pérez');
    });

    for (const p of paginas) if (p.errores.length) { fallas++; console.log('FALLA errores de página:', p.errores); }
  } finally { for (const b of navegadores) await b.close().catch(() => {}); }
  console.log(fallas ? fallas + ' falla(s)' : 'todo ok');
  process.exit(fallas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
