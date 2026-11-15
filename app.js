// ThirdCEDI Time — esqueleto: router por hash, tema claro/oscuro, toast y cliente de Supabase.
(function (g) {
  // Proyecto Supabase "thirdcedi-time". La clave publicable es pública por diseño; los permisos los dan las RLS.
  const SUPABASE_URL = 'https://qvezbnkrfqewanlcejha.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_nHg5W-1bGZwudTST-ejzeA_w_gUNYXQ';
  // Clave de GIPHY para los stickers del chat (pública por diseño: la API de GIPHY se llama desde el navegador). Vacía = la
  // pestaña GIPHY avisa que falta configurarla.
  const GIPHY_KEY = 'QQUF5JNRUQQCBSdrG2WXHkBGBlZs20dg';
  // Site key de Cloudflare Turnstile (captcha del acceso; es pública por diseño). Vacía = sin captcha: el acceso anda
  // como siempre. Con la clave puesta, además hay que prender el captcha en Supabase (pasos en CLAUDE.md).
  const TURNSTILE_SITE_KEY = '0x4AAAAAAF8_D7NJyQ3wpHKR';

  const RUTAS = ['actividades', 'juegos', 'perfil'];
  const RUTA_INICIAL = 'actividades';
  // #/actividad/<id> (link de los avisos) muestra la pantalla Actividades; avisos.js abre el detalle
  const ALIAS = { actividad: 'actividades' };

  let sb = null;
  if (SUPABASE_URL && SUPABASE_KEY && g.supabase && g.supabase.createClient) {
    sb = g.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }

  let perfil = null; // lo completa login.js al entrar

  function setPerfil(p) {
    perfil = p || null;
    g.dispatchEvent(new CustomEvent('perfil', { detail: perfil }));
  }
  // Muestra la app (pestañas y pantallas) o la pantalla de acceso, según haya sesión con perfil.
  function modoAcceso(sinSesion) {
    document.body.classList.toggle('sin-sesion', !!sinSesion);
    document.getElementById('acceso').hidden = !sinSesion;
  }

  function rutaActual() {
    const r = (location.hash || '').replace(/^#\/?/, '').split('/')[0];
    if (ALIAS[r]) return ALIAS[r];
    return RUTAS.indexOf(r) >= 0 ? r : RUTA_INICIAL;
  }

  function mostrar() {
    const ruta = rutaActual();
    // si el hash no es una ruta válida lo normalizamos, para que la barra de direcciones no mienta
    const cruda = (location.hash || '').replace(/^#\/?/, '').split('/')[0];
    if (location.hash && RUTAS.indexOf(cruda) < 0 && !ALIAS[cruda]) history.replaceState(null, '', '#/' + ruta);
    document.querySelectorAll('.pantalla').forEach((p) => { p.hidden = p.dataset.ruta !== ruta; });
    document.querySelectorAll('.pestanas a, #btn-perfil').forEach((a) => {
      const activa = a.dataset.ruta === ruta;
      a.classList.toggle('activa', activa);
      if (activa) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  function ir(ruta) {
    const pedida = String(ruta || '').replace(/^#?\/?/, '').split('/')[0];
    const destino = '#/' + (RUTAS.indexOf(pedida) >= 0 ? pedida : RUTA_INICIAL);
    if (location.hash === destino) mostrar(); else location.hash = destino;
  }

  // Íconos propios (dibujo propio, un color; generados con dev/tools/iconos-propios.js en el sprite de index.html, ids p-*):
  // tipos de actividad, tercer tiempo, secciones del detalle, juegos y barra de abajo. Nombre en la app -> símbolo.
  const PROPIOS = {
    // fútbol: la pelota de Phosphor de la primera versión (la eligió Ivan)
    futbol: 'i:futbol', padel: 'padel', trekking: 'trekking', asado: 'asado', after: 'after', otra: 'otra',
    tercer: 'tercer-tiempo', chat: 'chat', cuentas: 'cuentas', album: 'album', trivia: 'trivia', impostor: 'impostor',
    actividades: 'nav-actividades', juegos: 'nav-juegos', perfil: 'nav-perfil',
  };

  // Ícono de la app, del sprite de index.html: los propios (#p-*) y el resto de Phosphor fill (#i-*, ver dev/tools/iconos-sprite.js).
  // Toman el color del texto. Sin etiqueta es decorativo (aria-hidden); con etiqueta lo anuncia el lector (role="img").
  const SVG = 'http://www.w3.org/2000/svg';
  function icono(nombre, etiqueta, clase) {
    const propio = PROPIOS[nombre];
    const s = document.createElementNS(SVG, 'svg');
    s.setAttribute('class', 'ico' + (propio ? ' ico-propio' : '') + (clase ? ' ' + clase : ''));
    s.setAttribute('focusable', 'false');
    if (etiqueta) { s.setAttribute('role', 'img'); s.setAttribute('aria-label', etiqueta); } else s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(SVG, 'use');
    u.setAttribute('href', propio ? (propio.startsWith('i:') ? '#i-' + propio.slice(2) : '#p-' + propio) : '#i-' + nombre);
    s.appendChild(u);
    return s;
  }

  // Navegación dentro de una pantalla (Juegos → Nueva partida → partida; Actividades → detalle → editar): cada vista
  // que no es la raíz queda en el historial (misma URL, con la vista en history.state), así el "atrás" de Android y
  // los botones "Volver" vuelven un paso dentro de la pantalla en vez de salir al inicio.
  // subnav(pantalla, { raiz, clave(v), aplicar(v) }) → { ir(v, { reemplazar }), atras(siNoHay) }
  // * ir(raiz) vuelve hasta la raíz por el historial; ir(otra) agrega un paso (o reemplaza el actual con reemplazar).
  // * atras(siNoHay): un paso atrás; si no hay pasos guardados (se entró directo), va a siNoHay.
  // * Al volver con "atrás" se aplica la vista guardada; los pasos de las capas del chat o del álbum (que también usan
  //   el historial) no cambian la vista: se compara por clave.
  // * Tocar la pestaña de abajo abre la pantalla en su raíz (entrada nueva sin vista).
  function subnav(pantalla, { raiz, clave, aplicar }) {
    const k = 'nav_' + pantalla, kn = k + '_n';
    const st = () => history.state || {};
    const url = () => location.hash || '#/' + pantalla;
    let actual = clave(raiz);
    const poner = (v) => { actual = clave(v); aplicar(v); };
    function ir(v, opc = {}) {
      const n = st()[kn] || 0;
      if (clave(v) === clave(raiz)) {
        if (n > 0 && st()[k]) { history.go(-n); return; } // el popstate aplica la raíz
        poner(v); return;
      }
      if (opc.reemplazar && n > 0) history.replaceState({ ...st(), [k]: v }, '', url());
      else history.pushState({ ...st(), [k]: v, [kn]: n + 1 }, '', url());
      poner(v);
    }
    function atras(siNoHay) {
      if ((st()[kn] || 0) > 0 && st()[k]) history.back();
      else ir(siNoHay || raiz);
    }
    g.addEventListener('popstate', () => {
      if (rutaActual() !== pantalla) return;
      const v = st()[k] || raiz;
      if (clave(v) !== actual) poner(v);
    });
    return { ir, atras };
  }

  // iPhone/iPad con la app instalada (pantalla de inicio): iOS no trae el gesto de "atrás", así que lo hace la app.
  // Deslizar desde el borde izquierdo (los primeros 24 px) hacia la derecha = history.back(), lo mismo que el botón
  // de Android: vuelve un paso dentro de la pantalla (subnav) o cierra una capa del chat o del álbum.
  (function gestoAtrasIOS() {
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const instalada = navigator.standalone === true || (g.matchMedia && g.matchMedia('(display-mode: standalone)').matches);
    if (!ios || !instalada) return;
    let x0 = null, y0 = 0, t0 = 0;
    g.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      x0 = e.touches.length === 1 && t.clientX <= 24 ? t.clientX : null; y0 = t.clientY; t0 = Date.now();
    }, { passive: true });
    g.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const t = e.changedTouches[0], dx = t.clientX - x0, dy = Math.abs(t.clientY - y0);
      x0 = null;
      if (dx > 70 && dy < 60 && Date.now() - t0 < 800 && history.length > 1) history.back();
    }, { passive: true });
  })();

  let tToast = null;
  function toast(texto) {
    const el = document.getElementById('toast');
    el.textContent = texto;
    el.hidden = false;
    clearTimeout(tToast);
    tToast = setTimeout(() => { el.hidden = true; }, 3000);
  }

  function aplicarTema(t) {
    document.documentElement.setAttribute('data-tema', t);
    // el ícono muestra a qué tema se pasa al tocarlo
    document.querySelector('#ico-tema use').setAttribute('href', t === 'oscuro' ? '#i-sol' : '#i-luna');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'oscuro' ? '#071A2E' : '#002F68');
  }

  function iniciar() {
    aplicarTema(document.documentElement.getAttribute('data-tema') || 'claro');
    document.getElementById('btn-tema').addEventListener('click', () => {
      const t = document.documentElement.getAttribute('data-tema') === 'oscuro' ? 'claro' : 'oscuro';
      try { localStorage.setItem('tema', t); } catch (e) {}
      aplicarTema(t);
    });
    g.addEventListener('hashchange', mostrar);
    if (!location.hash) history.replaceState(null, '', '#/' + RUTA_INICIAL);
    mostrar();
    if ('serviceWorker' in navigator) {
      // Actualización sola: en Android la app instalada queda en memoria y al volver no relee los archivos. Cada vez que
      // vuelve a primer plano se busca un service worker nuevo; si hay (se publicó una versión), toma el control
      // (skipWaiting + clients.claim en sw.js) y la página se recarga una vez con lo nuevo.
      const habiaControlador = !!navigator.serviceWorker.controller;
      let recargando = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!habiaControlador || recargando) return;
        recargando = true;
        location.reload();
      });
      navigator.serviceWorker.register('sw.js').then((reg) => {
        document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
      }).catch(() => {});
    }
  }

  g.App = { ir, rutaActual, subnav, sb, yo: () => perfil, setPerfil, modoAcceso, toast, icono, SUPABASE_URL, TURNSTILE_SITE_KEY, GIPHY_KEY };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})(window);
