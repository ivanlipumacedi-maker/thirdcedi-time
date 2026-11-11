// Navegador de las pruebas *-mock.js. Por defecto es puppeteer-core con Chrome. Con NAVEGADOR=webkit corre las mismas
// pruebas en WebKit (el motor de Safari, con Playwright) haciéndose pasar por un iPhone 13: pantalla, toque y user agent.
// Es un adaptador chico de la parte de puppeteer que usan las pruebas; lo que no está traducido falla con un mensaje
// claro. Sin cámara ni micrófono falsos (eso es de Chrome): las pruebas que los necesitan fallan en WebKit.
// Con NAVEGADOR=webkit-privado usa una sesión privada: Safari no guarda archivos en IndexedDB y el álbum sube desde memoria.
// Instalar WebKit una vez: npx playwright-core install webkit
// Con DESBORDE=1 (en cualquier navegador): si algo queda más ancho que la pantalla, la página tira un error que la prueba
// cuenta como falla ("errores de página"), con el elemento que se sale. Para probar anchos chicos: ANCHO=343.
const DESBORDE = process.env.DESBORDE === '1' ? `(function () {
  let avisado = false;
  setInterval(() => {
    if (avisado || !document.body) return;
    const w = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= w + 1) return;
    const malo = [...document.body.querySelectorAll('*')].find((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > w + 1 || r.left < -1) && getComputedStyle(e).position !== 'fixed'; });
    avisado = true;
    const d = malo ? malo.tagName.toLowerCase() + (malo.id ? '#' + malo.id : '') + (malo.className && typeof malo.className === 'string' ? '.' + malo.className.trim().split(/\\s+/).join('.') : '') : '?';
    setTimeout(() => { throw new Error('DESBORDE: la página es más ancha que la pantalla (' + document.documentElement.scrollWidth + ' > ' + w + '): ' + d); });
  }, 400);
})();` : null;

if (!/^webkit/.test(process.env.NAVEGADOR || '')) {
  const puppeteer = require('puppeteer-core');
  if (!DESBORDE) { module.exports = puppeteer; return; }
  module.exports = {
    async launch(o) {
      const b = await puppeteer.launch(o);
      const nueva = b.newPage.bind(b);
      b.newPage = async () => { const p = await nueva(); await p.evaluateOnNewDocument(DESBORDE); return p; };
      return b;
    },
  };
  return;
}

const { webkit, devices } = require('playwright-core');
const IPHONE = devices['iPhone 13'];
const PRIVADO = process.env.NAVEGADOR === 'webkit-privado';
const os = require('os'), fs = require('fs'), path = require('path');

const fuente = (fn, args) => (typeof fn === 'string' ? fn : `(${fn})(...${JSON.stringify(args)})`);

function envolverElemento(h) {
  if (!h) return null;
  return {
    uploadFile: (...rutas) => h.setInputFiles(rutas),
    evaluate: (fn, ...args) => h.evaluate((el, a) => (0, eval)('(' + a.src + ')')(el, ...a.args), { src: fn.toString(), args }),
    click: () => h.click(),
    _h: h,
  };
}

function envolverPagina(ctx, page) {
  let interceptar = false;
  const p = {
    _pw: page,
    keyboard: page.keyboard,
    mouse: page.mouse,
    on(ev, fn) {
      if (ev === 'request' && interceptar) {
        page.route('**/*', (route) => {
          const r = route.request();
          fn({
            url: () => r.url(), method: () => r.method(), postData: () => r.postData(), headers: () => r.headers(), resourceType: () => r.resourceType(),
            respond: (o) => route.fulfill({ status: o.status, contentType: o.contentType, headers: o.headers, body: o.body }).catch(() => {}),
            continue: () => route.continue().catch(() => {}),
            abort: () => route.abort().catch(() => {}),
          });
        });
      } else page.on(ev, fn);
      return p;
    },
    setRequestInterception: async (v) => { interceptar = v; },
    setBypassServiceWorker: async () => {}, // el contexto ya bloquea el service worker
    exposeFunction: (n, fn) => page.exposeFunction(n, fn),
    evaluateOnNewDocument: (fn, ...args) => page.addInitScript({ content: fuente(fn, args) }),
    setViewport: (v) => page.setViewportSize({ width: v.width, height: v.height }),
    emulateMediaFeatures: (fs) => {
      const o = {};
      for (const f of fs) { if (f.name === 'prefers-color-scheme') o.colorScheme = f.value; if (f.name === 'prefers-reduced-motion') o.reducedMotion = f.value; }
      return page.emulateMedia(o);
    },
    setOfflineMode: (v) => ctx.setOffline(v),
    goto: (u, o = {}) => page.goto(u, { waitUntil: /networkidle/.test(o.waitUntil || '') ? 'networkidle' : 'load', timeout: o.timeout }),
    evaluate: (fn, ...args) => page.evaluate(fuente(fn, args)),
    waitForFunction: (fn, o = {}, ...args) => page.waitForFunction(fuente(fn, args), undefined, { timeout: o.timeout ?? 30000, polling: o.polling === 'mutation' ? 'raf' : o.polling }),
    waitForSelector: async (sel, o = {}) => envolverElemento(await page.waitForSelector(sel, { state: o.hidden ? 'hidden' : o.visible ? 'visible' : 'attached', timeout: o.timeout ?? 30000 })),
    click: async (sel, o = {}) => {
      // puppeteer toca el centro del elemento sin esperar a que esté "quieto"; Playwright espera y, si otra cosa tapa, falla
      try { await page.click(sel, { timeout: 5000, clickCount: o.clickCount, delay: o.delay }); }
      catch (e) { if (/Timeout/.test(e.message)) await page.click(sel, { force: true, timeout: 5000 }); else throw e; }
    },
    type: (sel, t, o = {}) => page.locator(sel).first().pressSequentially(t, { delay: o.delay }),
    focus: (sel) => page.focus(sel),
    select: (sel, ...v) => page.selectOption(sel, v),
    $: async (sel) => envolverElemento(await page.$(sel)),
    $$: async (sel) => (await page.$$(sel)).map(envolverElemento),
    $eval: (sel, fn, ...args) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no está ' + ${JSON.stringify(sel)}); return (${fn})(e, ...${JSON.stringify(args)}); })()`),
    $$eval: (sel, fn, ...args) => page.evaluate(`(${fn})([...document.querySelectorAll(${JSON.stringify(sel)})], ...${JSON.stringify(args)})`),
    screenshot: (o = {}) => page.screenshot({ path: o.path, fullPage: o.fullPage }),
    close: () => page.close(),
  };
  return new Proxy(p, {
    get(t, k) {
      if (k in t || typeof k === 'symbol' || k === 'then') return t[k];
      return (..._) => { throw new Error('navegador.js (webkit): falta traducir page.' + String(k)); };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

module.exports = {
  async launch() {
    // perfil normal (como la app instalada) en una carpeta temporal nueva, o sesión privada
    const op = { ...IPHONE, serviceWorkers: 'block', bypassCSP: true };
    let browser = null, ctx, dir = null;
    if (PRIVADO) { browser = await webkit.launch({ headless: true }); ctx = await browser.newContext(op); }
    else { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webkit-')); ctx = await webkit.launchPersistentContext(dir, { headless: true, ...op }); }
    return {
      newPage: async () => { const pg = await ctx.newPage(); if (DESBORDE) await pg.addInitScript({ content: DESBORDE }); return envolverPagina(ctx, pg); },
      defaultBrowserContext: () => ({ overridePermissions: async () => {} }), // WebKit no tiene cámara falsa
      close: async () => { await (browser || ctx).close(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); },
    };
  },
};
