// Avisos push en Perfil: "Activar avisos" (permiso + suscripción + push_registrar), prueba y desactivar.
// En iPhone sin instalar explica cómo agregarla a la pantalla de inicio; con el permiso bloqueado, cómo habilitarlo.
// También abre los links de los avisos: #/actividad/<id> y #/juegos/<id> (al tocar la notificación).
(function (g) {
  // Clave VAPID pública (pública por diseño; la privada la tiene solo la Edge Function). Generada con dev/tools/generar-vapid.js.
  const VAPID_PUBLICA = 'BPJl0VBLTFJaw7kbYXsCc2SV4Ljx_9SUQnasklcWQCbAgbvChhtUqxMiDxfEJcRCNPLiMtKWUrHP9TBahw61sW8';

  const sb = () => g.App.sb;
  const $ = (id) => document.getElementById(id);
  let ocupado = false;
  let aviso = '';      // texto de error o de resultado debajo del botón

  function h(tag, props, ...hijos) {
    const el = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'on') Object.entries(v).forEach(([ev, fn]) => el.addEventListener(ev, fn));
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    el.append(...hijos.flat(Infinity).filter((c) => c != null && c !== false && c !== ''));
    return el;
  }

  const clave = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
  const esIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const instalada = () => navigator.standalone === true || (g.matchMedia && g.matchMedia('(display-mode: standalone)').matches);
  const soportado = () => 'serviceWorker' in navigator && 'PushManager' in g && 'Notification' in g;

  // El service worker listo (lo registra app.js). Si no aparece en unos segundos, se toma como sin soporte.
  async function registro() {
    if (!soportado()) return null;
    return Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 5000))]);
  }
  // La suscripción actual si es de nuestra clave; si quedó una con otra clave (se rotó la VAPID), se descarta.
  async function suscripcion(reg) {
    const s = await reg.pushManager.getSubscription();
    if (!s) return null;
    const k = s.options && s.options.applicationServerKey;
    if (k) {
      const a = new Uint8Array(k), b = clave(VAPID_PUBLICA);
      if (a.length !== b.length || a.some((x, i) => x !== b[i])) { await s.unsubscribe().catch(() => {}); return null; }
    }
    return s;
  }
  async function guardar(s) {
    const j = s.toJSON();
    const { error } = await sb().rpc('push_registrar', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    if (error) throw error;
  }

  async function activar() {
    const reg = await registro();
    if (!reg) throw new Error('sin service worker');
    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') { aviso = ''; return; }
    const s = (await suscripcion(reg)) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: clave(VAPID_PUBLICA) });
    await guardar(s);
    aviso = 'Listo: te vamos a avisar en este teléfono.';
  }
  async function desactivar() {
    const reg = await registro();
    const s = reg && await reg.pushManager.getSubscription();
    if (s) {
      const { error } = await sb().from('push_subs').delete().eq('endpoint', s.endpoint);
      if (error) throw error;
      await s.unsubscribe().catch(() => {});
    }
    aviso = 'Listo: este teléfono ya no recibe avisos.';
  }
  async function probar() {
    const { data, error } = await sb().rpc('avisos_probar');
    if (error) throw error;
    aviso = data === false ? 'Esperá unos segundos antes de pedir otra prueba.' : 'Te mandamos un aviso de prueba: tendría que llegar en menos de un minuto.';
  }
  // Al cerrar sesión: que este teléfono no siga recibiendo los avisos de esta cuenta.
  async function alSalir() {
    if (!soportado() || !sb()) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const s = reg && await reg.pushManager.getSubscription();
    if (!s) return;
    await sb().from('push_subs').delete().eq('endpoint', s.endpoint);
    await s.unsubscribe().catch(() => {});
  }

  const ERROR_CAMBIAR = 'No pudimos cambiar los avisos. Revisá la conexión y probá de nuevo.';
  const ERROR_PRUEBA = 'No pudimos mandarte la prueba. Revisá la conexión y probá de nuevo en un rato.';
  function boton(id, texto, clase, fn, errorTexto) {
    return h('button', { type: 'button', id, class: clase, disabled: ocupado, on: { click: async () => {
      if (ocupado) return;
      ocupado = true; aviso = ''; pintar();
      try { await fn(); } catch (e) { console.error(e); aviso = errorTexto || ERROR_CAMBIAR; }
      ocupado = false; pintar();
    } } }, texto);
  }

  async function estado() {
    if (!soportado()) return esIOS() && !instalada() ? 'ios' : 'sin-soporte';
    if (Notification.permission === 'denied') return 'bloqueado';
    const reg = await registro();
    if (!reg) return 'sin-soporte';
    const s = await suscripcion(reg);
    return s && Notification.permission === 'granted' ? 'activos' : 'apagados';
  }

  let pintando = 0;
  async function pintar() {
    const cont = $('perfil-avisos');
    if (!cont) return;
    const mio = ++pintando;
    if (!g.App.yo()) { cont.textContent = ''; return; }
    const e = await estado().catch(() => 'sin-soporte');
    if (mio !== pintando) return;
    const out = [h('h2', { class: 'sub' }, 'Avisos')];
    if (e === 'ios') {
      out.push(h('p', { class: 'ayuda', id: 'avisos-ios' }, 'En iPhone los avisos llegan solo con la app instalada. Para instalarla:'),
        h('ol', { class: 'ayuda pasos-avisos' },
          h('li', null, 'Abrí esta página en Safari.'),
          h('li', null, 'Tocá Compartir (el cuadrado con la flecha para arriba).'),
          h('li', null, 'Elegí "Agregar a inicio" y confirmá.'),
          h('li', null, 'Abrí ThirdCEDI Time desde el ícono nuevo y volvé a Perfil para activar los avisos.')));
    } else if (e === 'sin-soporte') {
      out.push(h('p', { class: 'ayuda', id: 'avisos-sin-soporte' }, 'Este navegador no permite avisos. Probá con Chrome en Android o con la app instalada en iPhone.'));
    } else if (e === 'bloqueado') {
      out.push(h('p', { class: 'ayuda estado-avisos', id: 'avisos-bloqueados' }, g.App.icono('campana-off'), 'Los avisos están bloqueados para ThirdCEDI Time. Para habilitarlos:'),
        esIOS()
          ? h('p', { class: 'ayuda' }, 'Andá a Ajustes ▸ Notificaciones ▸ ThirdCEDI Time y activá "Permitir notificaciones". Después volvé a abrir la app.')
          : h('p', { class: 'ayuda' }, 'Tocá el candado (o los tres puntos ▸ Información del sitio) al lado de la dirección ▸ Permisos ▸ Notificaciones ▸ Permitir. Después recargá la página.'));
    } else if (e === 'activos') {
      out.push(h('p', { class: 'ayuda estado-avisos activos', id: 'avisos-activos' }, g.App.icono('campana'), 'Avisos activados en este teléfono.'),
        h('div', { class: 'fila-links' },
          boton('btn-avisos-probar', 'Mandarme una prueba', 'btn-sec btn-chico', probar, ERROR_PRUEBA),
          boton('btn-avisos-off', 'Desactivar', 'btn-link', desactivar)));
    } else {
      out.push(boton('btn-avisos-on', [g.App.icono('campana'), 'Activar avisos'], 'btn-primario btn-con-ico', activar),
        h('p', { class: 'ayuda' }, 'Te avisamos de actividades nuevas, cambios en las tuyas, mensajes del chat y un recordatorio a las 12 los días que tenés algo confirmado.'));
    }
    if (aviso) out.push(h('p', { class: 'ayuda', id: 'avisos-msg', role: 'status' }, aviso));
    cont.textContent = '';
    cont.append(...out);
  }

  // Con sesión y avisos ya activos: se vuelve a registrar el teléfono a nombre de esta cuenta (pudo cambiar de dueño).
  async function resincronizar() {
    try {
      if (!g.App.yo() || !soportado() || Notification.permission !== 'granted') return;
      const reg = await registro();
      const s = reg && await suscripcion(reg);
      if (s) await guardar(s);
    } catch (e) { console.error(e); }
  }

  // ---------- Links de los avisos ----------
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function abrirDestino() {
    if (!g.App.yo()) return; // sin sesión queda el hash: al entrar se abre
    const [ruta, id] = (location.hash || '').replace(/^#\/?/, '').split('/');
    if (!id || !UUID.test(id)) return; // solo ids de verdad: un link armado a mano no llega a las consultas
    if (ruta === 'actividad' && g.Actividades && g.Actividades.abrir) {
      history.replaceState(null, '', '#/actividades');
      g.Actividades.abrir(id);
    } else if (ruta === 'juegos' && g.Juegos && g.Juegos.abrir) {
      history.replaceState(null, '', '#/juegos');
      g.Juegos.abrir(id);
    }
  }

  g.addEventListener('perfil', () => { aviso = ''; abrirDestino(); pintar(); resincronizar(); });
  g.addEventListener('hashchange', abrirDestino);
  if ('serviceWorker' in navigator) {
    // la notificación tocada con la app ya abierta: el service worker manda a dónde ir
    navigator.serviceWorker.addEventListener('message', (ev) => {
      const d = ev.data || {};
      if (d.tipo !== 'abrir' || !d.url) return;
      const hash = new URL(d.url, location.href).hash;
      if (hash && hash !== location.hash) location.hash = hash; else abrirDestino();
    });
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pintar(); });

  g.Avisos = { pintar, alSalir, VAPID_PUBLICA };
})(window);
