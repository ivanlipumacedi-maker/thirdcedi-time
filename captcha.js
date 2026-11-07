// Captcha del acceso con Cloudflare Turnstile. Solo se usa en la pantalla de acceso y solo si App.TURNSTILE_SITE_KEY
// tiene la site key: vacía, no carga nada y token() devuelve null (el acceso anda como siempre).
// El widget va en #captcha con apariencia "interaction-only" (no se ve salvo que Cloudflare pida tocarlo) y en el tema
// de la app. token() da el token vigente (o espera el próximo); cada token sirve una vez: después de mandarlo, usado()
// pide uno nuevo. Si el script o el widget fallan, se ve #captcha-error con "Probar de nuevo".
(function (g) {
  const URL_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  const ESPERA_MS = 30000; // cuánto se espera un token antes de dar el error
  const $ = (id) => document.getElementById(id);

  let carga = null;     // promesa del script
  let widget = null;    // id que devuelve turnstile.render
  let token = null;
  let esperan = [];     // { ok, mal } de los token() pendientes
  let prendido = false; // estamos en la pantalla de acceso
  let observador = null;
  let fallo = false;    // se está mostrando el error

  const clave = () => (g.App && g.App.TURNSTILE_SITE_KEY) || '';
  const activo = () => !!clave();
  const tema = () => (document.documentElement.getAttribute('data-tema') === 'oscuro' ? 'dark' : 'light');
  const msg = () => (g.Errores && g.Errores.MSG_CAPTCHA) || 'No pudimos comprobar que sos una persona. Revisá tu conexión y probá de nuevo.';

  function cargarScript() {
    if (g.turnstile) return Promise.resolve();
    if (carga) return carga;
    carga = new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = URL_SCRIPT;
      s.async = true;
      s.onload = () => (g.turnstile ? ok() : mal(new Error('turnstile')));
      s.onerror = () => { s.remove(); mal(new Error('turnstile')); };
      document.head.appendChild(s);
    }).catch((e) => { carga = null; throw e; });
    return carga;
  }

  function avisar(si) {
    const e = $('captcha-error');
    fallo = !!si;
    if (e) e.hidden = !si;
    if (si) {
      const pend = esperan; esperan = [];
      pend.forEach((x) => x.mal(new Error('captcha')));
    }
  }
  function alToken(t) {
    token = t; avisar(false);
    const pend = esperan; esperan = [];
    pend.forEach((x) => x.ok(t));
  }

  function pintar() {
    const cont = $('captcha');
    if (!prendido || !g.turnstile || !cont) return;
    if (widget != null) { try { g.turnstile.remove(widget); } catch (e) { /* ya no estaba */ } widget = null; }
    token = null;
    // para las pruebas (prueba-login-mock): con qué tema se pintó y cuántas veces
    cont.dataset.tema = tema();
    cont.dataset.pintadas = String(Number(cont.dataset.pintadas || 0) + 1);
    try {
      widget = g.turnstile.render(cont, {
        sitekey: clave(),
        theme: tema(),
        language: 'es',
        appearance: 'interaction-only',
        callback: alToken,
        'expired-callback': () => { token = null; },
        'timeout-callback': () => { token = null; },
        'error-callback': () => { token = null; avisar(true); return true; },
      });
    } catch (e) { widget = null; avisar(true); }
  }

  // Entrar a la pantalla de acceso: carga el script (una vez) y pone el widget.
  function preparar() {
    if (!activo()) return Promise.resolve();
    prendido = true;
    $('captcha-zona').hidden = false;
    avisar(false);
    if (!observador) {
      // si cambian el tema con el widget puesto, se vuelve a pintar con el tema nuevo
      observador = new MutationObserver(() => { if (prendido && widget != null) pintar(); });
      observador.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] });
    }
    return cargarScript().then(pintar, () => { if (prendido) avisar(true); });
  }

  // Salir de la pantalla de acceso (ya hay sesión): saca el widget.
  function quitar() {
    prendido = false;
    if (!activo()) return;
    if (widget != null && g.turnstile) { try { g.turnstile.remove(widget); } catch (e) { /* nada */ } }
    widget = null; token = null;
    const pend = esperan; esperan = [];
    pend.forEach((x) => x.mal(new Error('captcha')));
    $('captcha-zona').hidden = true;
  }

  // El token para mandar a Supabase (null si no hay captcha). Rechaza si el widget falla o tarda demasiado.
  function obtener() {
    if (!activo()) return Promise.resolve(null);
    if (token) return Promise.resolve(token);
    if (fallo) return Promise.reject(new Error('captcha')); // ya se ve el error con "Probar de nuevo"
    if (!prendido) preparar();
    return new Promise((ok, mal) => {
      const x = { ok, mal };
      const t = setTimeout(() => { esperan = esperan.filter((y) => y !== x); avisar(true); mal(new Error('captcha')); }, ESPERA_MS);
      x.ok = (v) => { clearTimeout(t); ok(v); };
      x.mal = (e) => { clearTimeout(t); mal(e); };
      esperan.push(x);
    });
  }

  // Ya se mandó: el token no sirve más; Turnstile saca otro solo.
  function usado() {
    if (!activo()) return;
    token = null;
    if (widget != null && g.turnstile) { try { g.turnstile.reset(widget); } catch (e) { pintar(); } }
  }

  function probarDeNuevo() {
    avisar(false);
    if (g.turnstile && widget != null) { try { g.turnstile.reset(widget); return; } catch (e) { /* se vuelve a pintar */ } }
    if (g.turnstile) pintar(); else preparar();
  }

  function iniciar() {
    const b = $('btn-captcha-otra');
    if (b) b.addEventListener('click', probarDeNuevo);
  }

  g.Captcha = { activo, preparar, quitar, token: obtener, usado, MENSAJE: msg };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})(window);
