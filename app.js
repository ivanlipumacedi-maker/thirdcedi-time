// ThirdCEDI Time — esqueleto: router por hash, tema claro/oscuro, toast y cliente de Supabase.
(function (g) {
  // Proyecto Supabase "thirdcedi-time". La clave publicable es pública por diseño; los permisos los dan las RLS.
  const SUPABASE_URL = 'https://qvezbnkrfqewanlcejha.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_nHg5W-1bGZwudTST-ejzeA_w_gUNYXQ';

  const RUTAS = ['actividades', 'juegos', 'perfil'];
  const RUTA_INICIAL = 'actividades';

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
    return RUTAS.indexOf(r) >= 0 ? r : RUTA_INICIAL;
  }

  function mostrar() {
    const ruta = rutaActual();
    // si el hash no es una ruta válida lo normalizamos, para que la barra de direcciones no mienta
    const cruda = (location.hash || '').replace(/^#\/?/, '').split('/')[0];
    if (location.hash && RUTAS.indexOf(cruda) < 0) history.replaceState(null, '', '#/' + ruta);
    document.querySelectorAll('.pantalla').forEach((p) => { p.hidden = p.dataset.ruta !== ruta; });
    document.querySelectorAll('.pestanas a').forEach((a) => {
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
    document.getElementById('ico-tema').textContent = t === 'oscuro' ? '☀' : '☾';
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
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  g.App = { ir, sb, yo: () => perfil, setPerfil, modoAcceso, toast, SUPABASE_URL };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})(window);
