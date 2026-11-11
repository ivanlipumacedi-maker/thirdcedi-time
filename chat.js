// Chat grupal por sala ('act:<uuid>' / 'par:<uuid>'), como el de Rumbo al Sur pero en grupo: texto, fotos, videos, audios
// (mantener apretado el micrófono), stickers del grupo y de GIPHY, responder citando (deslizar a la derecha o desde el menú),
// reacciones, fijar (para todos), destacar y "eliminar para mí" (en este teléfono), buscar, editar y eliminar lo propio.
// En vivo con Realtime. Chat.abrir(contenedor, sala) devuelve la función que cierra el chat y baja la suscripción.
// Necesita ChatLogica, ChatMedios y Perfiles (y Camara para sacar fotos y videos).
(function (g) {
  const L = g.ChatLogica;
  const M = g.ChatMedios;
  const TAM = L.TAM_PAGINA;
  const CAMPOS = 'id,sala,autor,tipo,texto,archivo,ancho,alto,duracion_ms,responde_a,externo,editado,creado';
  let sonando = null; // el <audio> que está sonando (uno solo a la vez, en todos los chats)

  function h(tag, props, ...hijos) {
    const el = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'on') Object.entries(v).forEach(([ev, fn]) => el.addEventListener(ev, fn));
      else if (k in el && k !== 'list') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    hijos.flat().forEach((c) => { if (c != null && c !== false) el.append(c); });
    return el;
  }
  const vibrar = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* sin vibración */ } };
  const fmtFecha = (iso) => new Date(iso).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Argentina/Buenos_Aires' });

  function abrir(cont, sala) {
    const sb = g.App.sb;
    const yo = g.App.yo() ? g.App.yo().id : null;
    const ico = (n, etiqueta) => g.App.icono(n, etiqueta);
    const toast = (t) => g.App.toast(t);
    const tactil = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    let lista = [];
    let hayMas = false;
    let estado = 'cargando';          // 'cargando' | 'error' | 'ok'
    let editandoId = null;
    let citando = null;               // id del mensaje que se está respondiendo
    let selId = null;                 // mensaje con el menú abierto (se marca)
    let cerrado = false;
    let enVuelo = null;               // sincronización en curso
    let otraVez = false;              // la pidieron de nuevo con una en vuelo: al terminar se corre una más
    let llegados = null;              // con una sincronización en vuelo: ids que entraron a la lista mientras tanto
    let pendientes = null;            // con una sincronización en vuelo: UPDATEs de mensajes que todavía no están
    let guardando = false;            // RPC de edición en vuelo
    let cargandoMas = null;           // "Ver mensajes anteriores" en vuelo (la promesa)
    const eliminando = new Set();     // ids con la RPC de eliminar en vuelo (un segundo toque no la repite)
    let canal = null;
    // Perfiles de esta apertura (nombre y foto): se piden de nuevo cada vez que se abre un chat,
    // así un cambio de nombre o de foto se ve al volver a entrar.
    const perfiles = new Map();       // id -> { id, nombre, foto }
    const medios = new Map();         // id -> nodo de foto / video / audio / sticker reutilizado entre redibujos
    const locales = new Set();        // blob: URLs a soltar al cerrar
    const citados = new Map();        // id -> mensaje citado que no está en la lista (o null si ya no existe)
    let buscandoCitas = false, citasEsperaHasta = 0;
    const reacs = new Map();          // mensaje -> Map(persona -> clave)
    const reacVer = new Map();        // mensaje -> versión (lo que cambia en vivo no lo pisa una carga atrasada)
    const reaccionando = new Set();   // mensajes con mi reacción en vuelo
    let fijado = null, verFijado = 0; // id del mensaje fijado de la sala
    let resaltadoId = null, resaltadoHasta = 0;
    let tragarClick = false;          // el click del mismo gesto que abrió el menú (presión larga) o respondió (deslizar) no abre nada

    const leerSet = (tipo) => { try { return new Set(JSON.parse(localStorage.getItem(L.claveLocal(tipo, sala, yo)) || '[]')); } catch (e) { return new Set(); } };
    const guardarSet = (tipo, s) => { try { localStorage.setItem(L.claveLocal(tipo, sala, yo), JSON.stringify([...s])); } catch (e) { /* sin espacio */ } };
    const destacados = leerSet('destacados'), ocultos = leerSet('ocultos');

    const nombreDe = (id) => (perfiles.get(id) || {}).nombre || 'Compañero';
    const esTmp = (m) => String(m.id).startsWith('tmp-');
    const originalDe = (id) => lista.find((x) => x.id === id) || citados.get(id);

    // ---------- Estructura ----------
    const elLista = h('div', { class: 'chat-lista', role: 'log', 'aria-live': 'polite', 'aria-label': 'Mensajes' });
    const inTexto = h('textarea', { class: 'chat-texto', rows: 1, maxLength: L.MAX_TEXTO, placeholder: 'Mensaje', 'aria-label': 'Mensaje', enterKeyHint: tactil ? 'enter' : 'send' });
    // galería: una foto o un video que ya tenés
    const inArchivo = h('input', { type: 'file', accept: 'image/*,video/*', hidden: true, id: 'chat-archivo-' + Math.random().toString(36).slice(2) });
    const btnAdj = h('button', { type: 'button', class: 'chat-adj', 'aria-label': 'Mandar una foto o un video', 'aria-haspopup': 'dialog', on: { click: () => abrirAdjuntar() } }, ico('camara'));
    const btnStk = h('button', { type: 'button', class: 'chat-adj', 'aria-label': 'Stickers', 'aria-haspopup': 'dialog', on: { click: () => abrirStickers() } }, ico('sticker'));
    const btnEnviar = h('button', { type: 'submit', class: 'chat-enviar' });
    const grabandoEl = h('div', { class: 'chat-grabando', hidden: true },
      h('span', { class: 'chat-rec', 'aria-hidden': 'true' }), h('span', { class: 'chat-rec-t' }, '0:00'),
      h('span', { class: 'chat-rec-cancelar' }, ico('volver'), 'Deslizá para cancelar'));
    const barraEdicion = h('div', { class: 'chat-edicion', hidden: true },
      h('span', null, 'Editando mensaje'),
      h('button', { type: 'button', class: 'btn-link', on: { click: () => cancelarEdicion() } }, 'Cancelar'));
    const citaNombre = h('b'), citaTexto = h('span');
    const barraCita = h('div', { class: 'chat-citando', hidden: true },
      ico('responder'), h('div', { class: 'chat-citando-t' }, citaNombre, citaTexto),
      h('button', { type: 'button', class: 'chat-citando-x', 'aria-label': 'Cancelar la respuesta', on: { click: () => { quitarCita(); inTexto.focus(); } } }, ico('cruz')));
    const form = h('form', { class: 'chat-form', autocomplete: 'off' }, btnAdj, btnStk, inArchivo, inTexto, btnEnviar, grabandoEl);
    const fijadoTexto = h('span', { class: 'chat-fijado-t' });
    const elFijado = h('div', { class: 'chat-fijado', hidden: true },
      h('button', { type: 'button', class: 'chat-fijado-ir', on: { click: () => { if (fijado) irAlOriginal(fijado); } } },
        ico('fijar'), h('span', { class: 'chat-fijado-tx' }, h('b', null, 'Mensaje fijado'), fijadoTexto)),
      h('button', { type: 'button', class: 'chat-fijado-x', 'aria-label': 'Desfijar el mensaje', on: { click: () => { if (fijado) fijar(fijado); } } }, ico('cruz')));
    const cab = h('div', { class: 'chat-cab' },
      h('h2', { class: 'sub titulo-ico' }, ico('chat'), 'Chat'),
      h('div', { class: 'chat-cab-acc' },
        h('button', { type: 'button', class: 'chat-cab-b chat-b-buscar', 'aria-label': 'Buscar en el chat', on: { click: () => abrirBuscar() } }, ico('buscar')),
        h('button', { type: 'button', class: 'chat-cab-b chat-b-destacados', 'aria-label': 'Mensajes destacados', on: { click: () => abrirDestacados() } }, ico('estrella')),
        h('button', { type: 'button', class: 'chat-cab-b chat-b-menu', 'aria-label': 'Más opciones del chat', 'aria-haspopup': 'dialog', on: { click: () => abrirMenuChat() } }, ico('opciones'))));
    const raiz = h('div', { class: 'chat' }, cab, elFijado, elLista, barraCita, barraEdicion, form);
    cont.replaceChildren(raiz);

    // ---------- Capas (hojas, paneles y visor) con su lugar en "atrás" ----------
    // Cada capa abierta suma una entrada al historial con su id (state.chatCapas): atrás de Android cierra la de arriba.
    const capas = [];
    const prefijo = 'chat-' + Math.random().toString(36).slice(2) + '-';
    let nCapa = 0;
    const urlActual = () => location.hash || location.pathname + location.search;
    const enHistoria = () => (history.state && history.state.chatCapas) || [];
    function abrirCapa(el, op = {}) {
      const c = { id: prefijo + (++nCapa), el, op, foco: op.volverA || document.activeElement };
      capas.push(c);
      document.body.append(el);
      history.pushState({ ...(history.state || {}), chatCapas: [...enHistoria(), c.id] }, '', urlActual());
      if (capas.length === 1) document.addEventListener('keydown', teclaCapa, true);
      const f = op.foco || el.querySelector('button, input, [tabindex]');
      if (f) f.focus({ preventScroll: true });
      return c;
    }
    function ocultarCapa(c, devolverFoco = true) {
      const i = capas.indexOf(c);
      if (i < 0) return;
      capas.splice(i, 1);
      c.el.remove();
      if (c.op.alCerrar) c.op.alCerrar();
      if (!capas.length) document.removeEventListener('keydown', teclaCapa, true);
      let f = c.foco;
      // la burbuja se pudo redibujar mientras tanto: se busca la nueva del mismo mensaje
      if (f && !f.isConnected && f.classList && f.classList.contains('chat-burbuja')) f = elLista.querySelector(`.chat-burbuja[data-id="${CSS.escape(f.dataset.id)}"]`);
      if (devolverFoco && f && f.isConnected && typeof f.focus === 'function') f.focus({ preventScroll: true });
      if (c.listo) c.listo();
    }
    /** cierra la capa (la de arriba si no se dice): si tiene su entrada en "atrás", vuelve una; la promesa se cumple al cerrarse */
    function cerrarCapa(c = capas[capas.length - 1]) {
      if (!c || !capas.includes(c)) return Promise.resolve();
      const st = enHistoria();
      if (st[st.length - 1] !== c.id) { ocultarCapa(c); return Promise.resolve(); }
      return new Promise((res) => {
        c.listo = res;
        history.back();
        setTimeout(() => { if (capas.includes(c)) ocultarCapa(c); res(); }, 600); // por si el navegador no avisa
      });
    }
    /** cierra todas las capas de una (guardar un sticker cierra el editor y el panel), sacando sus entradas de "atrás" */
    function cerrarTodas() {
      const st = enHistoria();
      const n = capas.filter((c) => st.includes(c.id)).length;
      [...capas].reverse().forEach((c) => ocultarCapa(c, false));
      if (n) history.go(-n);
    }
    function alPopstate() {
      const abiertas = new Set(enHistoria());
      for (let i = capas.length - 1; i >= 0; i--) if (!abiertas.has(capas[i].id)) ocultarCapa(capas[i]);
    }
    g.addEventListener('popstate', alPopstate);
    function teclaCapa(e) {
      const c = capas[capas.length - 1];
      if (!c) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrarCapa(c); return; }
      if (e.key !== 'Tab') return;
      // el foco no se escapa de la capa de arriba
      const f = [...c.el.querySelectorAll('button, input, video[controls], [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && !x.closest('[hidden]'));
      if (!f.length) { e.preventDefault(); return; }
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (i < 0 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
    }
    // hoja que sube desde abajo, con fondo que cierra al tocarlo
    function hoja(titulo, hijos, clase) {
      const el = h('div', { class: 'chat-capa', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo },
        h('div', { class: 'chat-fondo', on: { click: () => cerrarCapa() } }),
        h('div', { class: 'chat-hoja' + (clase ? ' ' + clase : '') }, hijos));
      return el;
    }
    const item = (icono, texto, fn, clase) => h('button', { type: 'button', class: 'chat-item' + (clase ? ' ' + clase : ''), on: { click: fn } }, ico(icono), h('span', null, texto));
    const botonCancelar = () => h('button', { type: 'button', class: 'chat-item chat-item-cancelar', on: { click: () => cerrarCapa() } }, h('span', null, 'Cancelar'));
    /** cierra la capa de arriba y después hace fn (así lo que abra fn tiene su propia entrada en "atrás") */
    const despues = (fn) => async () => { await cerrarCapa(); if (!cerrado) fn(); };

    // ---------- Pintar ----------
    function avatarDe(id) { return g.Perfiles.avatar(perfiles.get(id) || { id, nombre: 'Compañero', foto: null }, 28); }

    // ruta que muestra cada burbuja: fotos y videos su miniatura liviana, el audio y el sticker su archivo
    const rutaDe = (m) => (!m.archivo ? null : m.tipo === 'foto' || m.tipo === 'video' ? M.rutaMini(m.archivo) : m.archivo);
    const porFirmar = new Set();
    let tFirma = 0;
    function pedirFirma(ruta) {
      if (!M.puedeFirmar(ruta)) return; // sin señal: espera (backoff); rota: no se repide
      porFirmar.add(ruta);
      if (tFirma) return;
      tFirma = setTimeout(async () => {
        tFirma = 0;
        const paths = [...porFirmar]; porFirmar.clear();
        try { await M.firmar(sb, paths); } catch (e) { /* sin red: se reintenta al volver la señal o la app */ }
        if (cerrado) return;
        for (const [id, nodo] of medios) { const m = lista.find((x) => x.id === id); if (m && paths.includes(rutaDe(m))) ponerSrc(nodo, m); }
        if (alFirmar) alFirmar(paths);
      }, 0);
    }
    let alFirmar = null; // el panel de stickers abierto pinta sus imágenes cuando llegan las firmas
    function ponerSrc(nodo, m) {
      const el = nodo.tagName === 'IMG' || nodo.tagName === 'AUDIO' ? nodo : nodo.querySelector('audio') || nodo.querySelector('img');
      if (!el) return;
      if (m.local) { if (!el.getAttribute('src')) el.src = m.local; return; }
      if (m.externo) { if (L.externoValido(m.externo) && el.getAttribute('src') !== m.externo) el.src = m.externo; return; } // también se valida lo que llega en vivo
      const ruta = rutaDe(m);
      if (!ruta) return;
      const actual = el.getAttribute('src');
      if (el.dataset.ruta === ruta && actual && !actual.startsWith('blob:') && M.vigente(ruta)) return; // ya tiene su firmada vigente
      const url = M.firmada(ruta);
      if (url && url !== actual && !(el.tagName === 'AUDIO' && !el.paused)) { el.src = url; el.dataset.ruta = ruta; }
      if (!M.vigente(ruta)) pedirFirma(ruta);
    }
    // URL vencida u objeto que falta: se re-firma una vez
    function alFallar(img) {
      img.addEventListener('error', () => {
        const mm = lista.find((x) => x.id === img.dataset.id);
        if (!mm || mm.local || mm.externo || img.dataset.reintento) return;
        img.dataset.reintento = '1'; img.removeAttribute('src'); delete img.dataset.ruta; M.reintentarYa(); pedirFirma(rutaDe(mm));
      });
      img.addEventListener('load', () => { delete img.dataset.reintento; });
    }
    const tamMedia = (m, el) => {
      if (m.ancho && m.alto) el.style.aspectRatio = m.ancho + ' / ' + m.alto;
      el.style.width = m.alto > m.ancho ? 'min(190px, 48vw)' : 'min(250px, 62vw)';
    };

    function nodoFoto(m) {
      let img = medios.get(m.id);
      if (!img) {
        img = h('img', { class: 'chat-foto', alt: 'Foto (tocá para agrandar)', decoding: 'async', loading: 'lazy', draggable: false, tabindex: '0', role: 'button' });
        img.addEventListener('click', () => { if (!tragarClick) abrirVisor(img.dataset.id); });
        img.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); abrirVisor(img.dataset.id); } });
        alFallar(img);
        medios.set(m.id, img);
      }
      img.dataset.id = m.id;
      tamMedia(m, img);
      ponerSrc(img, m);
      return img;
    }
    function nodoVideo(m) {
      let b = medios.get(m.id);
      if (!b) {
        const img = h('img', { alt: '', decoding: 'async', loading: 'lazy', draggable: false });
        alFallar(img);
        b = h('button', { type: 'button', class: 'chat-video' }, img, h('span', { class: 'chat-video-play' }, ico('play')), h('span', { class: 'chat-video-dur' }));
        b.addEventListener('click', () => { if (!tragarClick) abrirVisor(b.dataset.id); });
        medios.set(m.id, b);
      }
      b.dataset.id = m.id; b.querySelector('img').dataset.id = m.id;
      b.setAttribute('aria-label', 'Video de ' + L.duracionTexto(m.duracion_ms) + ' (tocá para verlo)');
      b.querySelector('.chat-video-dur').textContent = L.duracionTexto(m.duracion_ms);
      tamMedia(m, b);
      ponerSrc(b, m);
      return b;
    }
    function nodoSticker(m) {
      let img = medios.get(m.id);
      if (!img) {
        img = h('img', { class: 'chat-stk', alt: 'Sticker', decoding: 'async', loading: 'lazy', draggable: false });
        alFallar(img);
        medios.set(m.id, img);
      }
      img.dataset.id = m.id;
      ponerSrc(img, m);
      return img;
    }
    function nodoAudio(m) {
      let d = medios.get(m.id);
      if (!d) {
        const play = h('button', { type: 'button', class: 'chat-audio-play', 'aria-label': 'Escuchar el audio' }, ico('play'));
        const barra = h('div', { class: 'chat-audio-barra', 'aria-hidden': 'true' }, h('i'));
        const dur = h('span', { class: 'chat-audio-dur' });
        const au = h('audio', { preload: 'metadata' });
        const total = () => (au.duration && isFinite(au.duration) ? au.duration * 1000 : Number(d.dataset.ms) || 1);
        au.addEventListener('timeupdate', () => { barra.firstChild.style.width = Math.min(100, (au.currentTime * 1000 / total()) * 100) + '%'; dur.textContent = L.duracionTexto(au.currentTime * 1000); });
        au.addEventListener('play', () => { play.replaceChildren(ico('pausa')); play.setAttribute('aria-label', 'Pausar el audio'); d.classList.add('sonando'); });
        const parar = () => { play.replaceChildren(ico('play')); play.setAttribute('aria-label', 'Escuchar el audio'); d.classList.remove('sonando'); };
        au.addEventListener('pause', parar);
        au.addEventListener('ended', () => { parar(); au.currentTime = 0; barra.firstChild.style.width = '0'; dur.textContent = L.duracionTexto(Number(d.dataset.ms)); });
        au.addEventListener('error', () => { if (!au.paused) au.pause(); });
        play.addEventListener('click', () => { if (!tragarClick) tocarAudio(d); });
        d = h('div', { class: 'chat-audio' }, play, barra, dur, au);
        medios.set(m.id, d);
      }
      d.dataset.ms = m.duracion_ms || 0; d.dataset.id = m.id;
      const au = d.querySelector('audio');
      if (au.paused) d.querySelector('.chat-audio-dur').textContent = L.duracionTexto(m.duracion_ms);
      ponerSrc(d, m);
      return d;
    }
    async function tocarAudio(d) {
      const au = d.querySelector('audio');
      if (!au.paused) { au.pause(); return; }
      if (sonando && sonando !== au) sonando.pause();
      sonando = au;
      const m = lista.find((x) => x.id === d.dataset.id);
      const ir = () => au.play().catch(() => toast('No pudimos reproducir el audio. Probá de nuevo.'));
      if (!m || m.local || (au.getAttribute('src') && M.vigente(m.archivo))) { if (m && !au.getAttribute('src')) ponerSrc(d, m); ir(); return; }
      try {
        M.reintentarYa();
        await M.firmar(sb, [m.archivo]);
        const url = M.firmada(m.archivo);
        if (!url) throw new Error('sin firma');
        const t = au.currentTime; au.src = url; au.dataset.ruta = m.archivo; au.currentTime = t; ir();
      } catch (e) { toast('No pudimos cargar el audio. Revisá la conexión.'); }
    }
    function soltarMedio(id) {
      const n = medios.get(id);
      if (!n) return;
      const au = n.querySelector && n.querySelector('audio');
      if (au) au.pause();
      medios.delete(id);
    }
    // borrados o reconciliados: se corta el audio y se suelta el nodo
    function limpiarMedios() {
      for (const id of [...medios.keys()]) if (!String(id).startsWith('tmp-') && !lista.some((x) => x.id === id)) soltarMedio(id);
      for (const k of [...reuso.keys()]) { const id = k.slice(k.indexOf(':') + 1); if (!lista.some((x) => x.id === id)) reuso.delete(k); }
    }

    // la cita y las pastillas se reusan entre redibujos mientras no cambien: un toque no se pierde si llega algo en vivo
    // justo entre que se apoya y se levanta el dedo
    const reuso = new Map(); // clave -> { firma, el }
    function reusar(clave, firma, crear) {
      const r = reuso.get(clave);
      if (r && r.firma === firma) return r.el;
      const el = crear();
      reuso.set(clave, { firma, el });
      return el;
    }
    function nodoCita(id, deId) {
      const o = originalDe(id);
      const firma = JSON.stringify([id, o === undefined ? 0 : o && [o.autor, o.tipo, o.texto, o.duracion_ms], o ? nombreDe(o.autor) : '']);
      return reusar('cita:' + deId, firma, () => crearCita(id, o));
    }
    function crearCita(id, o) {
      const b = h('button', { type: 'button', class: 'chat-cita-b', 'data-cita': id, on: { click: (e) => { e.stopPropagation(); if (!tragarClick) irAlOriginal(id); } } },
        h('b', null, o ? (o.autor === yo ? 'Vos' : nombreDe(o.autor)) : ''),
        h('span', null, o === undefined ? '…' : L.textoCita(o)));
      b.setAttribute('aria-label', 'Responde a ' + (o ? (o.autor === yo ? 'vos' : nombreDe(o.autor)) + ': ' + L.textoCita(o) : 'un mensaje') + '. Tocá para ir al mensaje');
      return b;
    }

    function pastillas(m) {
      const grupos = L.agruparReacciones(reacs.get(m.id), yo);
      if (!grupos.length) return null;
      return reusar('reac:' + m.id, JSON.stringify(grupos.map((x) => [x.clave, x.quienes, x.quienes.map(nombreDe)])), () => h('div', { class: 'chat-reacs' }, grupos.map((x) => h('button', {
        type: 'button', class: 'chat-reac reac-' + x.clave + (x.mia ? ' mia' : ''), 'aria-pressed': x.mia ? 'true' : 'false',
        'aria-label': L.NOMBRE_REACCION[x.clave] + ': ' + x.n + (x.mia ? ' (con la tuya). Tocá para sacar la tuya' : '. Tocá para sumarte'),
        title: x.quienes.map((p) => (p === yo ? 'Vos' : nombreDe(p))).join(', '),
        on: { click: () => reaccionar(m.id, x.clave) },
      }, ico(x.clave), h('span', null, String(x.n))))));
    }

    function filaMensaje(m) {
      const mio = m.autor === yo;
      const eliminado = m.tipo === 'eliminado';
      if (eliminado) soltarMedio(m.id);
      const hora = h('span', { class: 'chat-hora' },
        destacados.has(m.id) && !eliminado && ico('estrella', 'Destacado'),
        (m.editado && !eliminado ? 'Editado ' : '') + (m.subiendo ? 'Enviando…' : L.horaCorta(m.creado)));
      let cuerpo;
      if (eliminado) cuerpo = h('div', { class: 'chat-txt' }, L.resumen(m));
      else if (m.tipo === 'foto') cuerpo = nodoFoto(m);
      else if (m.tipo === 'video') cuerpo = nodoVideo(m);
      else if (m.tipo === 'audio') cuerpo = nodoAudio(m);
      else if (m.tipo === 'sticker') cuerpo = nodoSticker(m);
      else cuerpo = h('div', { class: 'chat-txt' }, m.texto || '');
      const clase = 'chat-burbuja' + (eliminado ? ' eliminado' : '') + ((m.tipo === 'foto' || m.tipo === 'video') && !eliminado ? ' media' : '')
        + (m.tipo === 'sticker' && !eliminado ? ' sticker' : '') + (m.tipo === 'audio' && !eliminado ? ' con-audio' : '')
        + (m.subiendo ? ' subiendo' : '') + (selId === m.id ? ' sel' : '');
      const burbuja = h('div', { class: clase, 'data-id': m.id, tabindex: esTmp(m) ? null : '0', 'aria-haspopup': esTmp(m) ? null : 'dialog' },
        m.responde_a && !eliminado && nodoCita(m.responde_a, m.id), cuerpo, hora);
      const col = h('div', { class: 'chat-col' }, !mio && h('span', { class: 'chat-autor' }, nombreDe(m.autor)), burbuja, !eliminado && pastillas(m));
      const resaltado = m.id === resaltadoId && Date.now() < resaltadoHasta;
      return h('div', { class: 'chat-msg ' + (mio ? 'mio' : 'otro') + (resaltado ? ' resaltado' : ''), 'data-id': m.id }, !mio && avatarDe(m.autor), col);
    }

    function pintarFijado() {
      const o = fijado ? originalDe(fijado) : null;
      const ver = !!fijado && o !== null && !(o && o.tipo === 'eliminado') && !ocultos.has(fijado);
      elFijado.hidden = !ver;
      if (ver) fijadoTexto.textContent = o ? (o.autor === yo ? 'Vos' : nombreDe(o.autor).split(' ')[0]) + ': ' + L.resumen(o) : '…';
    }

    let tCitas = 0;
    function pintar() {
      if (cerrado) return;
      pintarFijado();
      const alFondo = elLista.scrollHeight - elLista.scrollTop - elLista.clientHeight < 120;
      elLista.replaceChildren();
      if (estado === 'cargando' && !lista.length) { elLista.append(h('p', { class: 'vacio' }, 'Cargando…')); return; }
      if (estado === 'error' && !lista.length) {
        elLista.append(h('div', { class: 'vacio' }, h('p', null, 'No pudimos cargar el chat.'),
          h('button', { type: 'button', id: 'chat-reintentar', class: 'btn-sec btn-chico', on: { click: () => { estado = 'cargando'; pintar(); sincronizar(); } } }, 'Reintentar')));
        return;
      }
      if (hayMas) elLista.append(h('button', { type: 'button', class: 'btn-link chat-anteriores', disabled: !!cargandoMas, on: { click: () => cargarMas() } }, cargandoMas ? 'Cargando…' : 'Ver mensajes anteriores'));
      const visibles = lista.filter((m) => !ocultos.has(m.id));
      if (!visibles.length) elLista.append(h('p', { class: 'vacio' }, 'Todavía no hay mensajes. ¡Escribí el primero!'));
      visibles.forEach((m) => elLista.append(filaMensaje(m)));
      if (alFondo) elLista.scrollTop = elLista.scrollHeight;
      // un redibujo en medio de un deslizamiento no lo corta: se pasa a la burbuja nueva del mismo mensaje
      if (desliz) {
        const nb = elLista.querySelector(`.chat-burbuja[data-id="${CSS.escape(desliz.id)}"]`);
        if (nb) { desliz.b = nb; if (desliz.dx > 10) nb.style.transform = `translateX(${Math.min(desliz.dx, 80)}px)`; } else desliz = null;
      }
      const faltaFijado = fijado && !originalDe(fijado);
      if ((faltaFijado || L.citasFaltantes(lista, citados).length) && !tCitas && Date.now() >= citasEsperaHasta) tCitas = setTimeout(() => { tCitas = 0; traerCitas(); }, 0);
    }

    // ---------- Datos ----------
    async function asegurarIds(ids) {
      const faltan = [...new Set(ids)].filter((id) => id && !perfiles.has(id));
      if (!faltan.length) return;
      const { data } = await sb.from('perfiles').select('id, nombre, foto').in('id', faltan);
      (data || []).forEach((p) => perfiles.set(p.id, p));
      await g.Perfiles.prepararAvatares(data || [], sb).catch(() => {});
    }
    const asegurarPerfiles = (ms) => asegurarIds((ms || []).map((m) => m.autor));

    // Mete un mensaje (respuesta propia o evento) en la lista. Si hay una sincronización en vuelo, lo anota
    // para que la reconciliación no lo pierda.
    function meter(m) {
      lista = L.fusionar(lista, m);
      if (llegados) llegados.add(m.id);
    }

    // Trae la última página y la reconcilia con lo que hay: sirve para la carga inicial y para ponerse al día después de
    // una reconexión (los mensajes llegados con el socket caído aparecen, sin duplicar). Si la piden con otra en vuelo
    // (p. ej. SUBSCRIBED mientras corre la carga inicial), no alcanza con esa: su consulta pudo salir antes de que se
    // commiteara un mensaje que tampoco llegó en vivo. Se marca otraVez y, al terminar, se corre una sola más.
    function sincronizar() {
      if (cerrado) return Promise.resolve(); // chat cerrado: no se lee ni se pinta nada
      if (enVuelo) { otraVez = true; return enVuelo; }
      otraVez = false;
      llegados = new Set(); pendientes = new Map();
      let ok = false, idsPagina = [];
      enVuelo = (async () => {
        try {
          const { data, error } = await sb.from('mensajes').select(CAMPOS).eq('sala', sala)
            .order('creado', { ascending: false }).order('id', { ascending: false }).limit(TAM);
          if (error) throw error;
          if (cerrado) return;
          await asegurarPerfiles(data);
          if (cerrado) return;
          const primera = estado !== 'ok';
          const tmps = lista.filter(esTmp);
          let nueva = L.fusionarLote(L.reconciliar(lista.filter((m) => !esTmp(m)), data, TAM, llegados), tmps);
          pendientes.forEach((m) => { nueva = L.aplicarEvento(nueva, 'UPDATE', m); }); // ediciones/eliminaciones que llegaron antes que la página
          lista = nueva;
          if (primera) hayMas = data.length >= TAM;
          estado = 'ok'; ok = true; idsPagina = data.map((m) => m.id);
          limpiarMedios();
          if (citando && !originalDe(citando)) quitarCita();
        } catch (e) {
          if (!cerrado && estado !== 'ok') estado = 'error';
        } finally {
          enVuelo = null; llegados = null; pendientes = null;
          const repetir = otraVez && !cerrado; otraVez = false;
          if (!cerrado) pintar();
          if (ok && !cerrado) { cargarReacciones(idsPagina); cargarFijado(); }
          if (repetir) sincronizar();
        }
      })();
      return enVuelo;
    }
    function cargarMas() {
      if (cargandoMas) return cargandoMas;
      const c = L.cursor(lista);
      if (!c) return Promise.resolve();
      cargandoMas = (async () => {
        const alto = elLista.scrollHeight;
        try {
          const { data, error } = await sb.from('mensajes').select(CAMPOS).eq('sala', sala).or(L.filtroAntes(c))
            .order('creado', { ascending: false }).order('id', { ascending: false }).limit(TAM);
          if (cerrado) return;
          if (error) { toast('No pudimos traer los mensajes anteriores. Revisá la conexión.'); return; }
          await asegurarPerfiles(data);
          if (cerrado) return;
          lista = L.fusionarLote(lista, data);
          hayMas = data.length >= TAM;
          cargarReacciones(data.map((m) => m.id));
        } catch (e) {
          if (!cerrado) toast('No pudimos traer los mensajes anteriores. Revisá la conexión.');
        } finally {
          cargandoMas = null;
          if (!cerrado) { pintar(); elLista.scrollTop = elLista.scrollHeight - alto; }
        }
      })();
      pintar();
      return cargandoMas;
    }

    async function alLlegar(payload) {
      const m = payload && payload.new;
      if (!m || m.sala !== sala || cerrado) return; // además del filtro del canal
      const evento = payload.eventType || 'INSERT';
      if (citados.has(m.id)) { citados.set(m.id, m); if (evento === 'UPDATE' && !lista.some((x) => x.id === m.id)) { pintar(); return; } }
      if (evento === 'UPDATE' && !lista.some((x) => x.id === m.id)) {
        // no lo tenemos: se ignora (si no, quedaría arriba de todo y haría de cursor). Si hay una
        // sincronización en vuelo, se guarda por si la página que llega lo trae.
        if (pendientes) pendientes.set(m.id, m);
        return;
      }
      await asegurarPerfiles([m]);
      if (cerrado) return;
      if (evento === 'UPDATE' && !lista.some((x) => x.id === m.id)) return;
      lista = L.aplicarEvento(lista, evento, m);
      if (llegados) llegados.add(m.id);
      if (m.tipo === 'eliminado') { if (citando === m.id) quitarCita(); if (editandoId === m.id) cancelarEdicion(); }
      pintar();
    }

    // citas (y el fijado) que no están en la lista: se piden juntas; sin red, se reintenta en 30 s o al volver la señal
    async function traerCitas() {
      if (cerrado || buscandoCitas || Date.now() < citasEsperaHasta) return;
      const ids = L.citasFaltantes(lista, citados);
      if (fijado && !originalDe(fijado) && !ids.includes(fijado)) ids.push(fijado);
      if (!ids.length) return;
      buscandoCitas = true;
      try {
        const { data, error } = await sb.from('mensajes').select(CAMPOS).eq('sala', sala).in('id', ids);
        if (error) throw error;
        await asegurarPerfiles(data || []);
        ids.forEach((id) => { if (!lista.some((x) => x.id === id)) citados.set(id, (data || []).find((x) => x.id === id) || null); });
      } catch (e) {
        citasEsperaHasta = Date.now() + 30000;
        return;
      } finally { buscandoCitas = false; }
      if (!cerrado) pintar();
    }

    // ---------- Reacciones ----------
    function ponerReac(id, persona, clave) {
      const mp = new Map(reacs.get(id) || []);
      if (clave) mp.set(persona, clave); else mp.delete(persona);
      if (mp.size) reacs.set(id, mp); else reacs.delete(id);
      reacVer.set(id, (reacVer.get(id) || 0) + 1);
    }
    async function cargarReacciones(ids) {
      ids = ids.filter((id) => !String(id).startsWith('tmp-'));
      if (!ids.length || cerrado) return;
      const antes = new Map(ids.map((id) => [id, reacVer.get(id) || 0]));
      try {
        const { data, error } = await sb.from('mensaje_reacciones').select('mensaje,persona,clave').eq('sala', sala).in('mensaje', ids);
        if (error || cerrado) return;
        await asegurarIds((data || []).map((r) => r.persona)).catch(() => {});
        if (cerrado) return;
        const nuevas = new Map(ids.map((id) => [id, new Map()]));
        (data || []).forEach((r) => { const mp = nuevas.get(r.mensaje); if (mp) mp.set(r.persona, r.clave); });
        nuevas.forEach((mp, id) => {
          if ((reacVer.get(id) || 0) !== antes.get(id)) return; // cambió en vivo mientras tanto: gana lo de en vivo
          if (mp.size) reacs.set(id, mp); else reacs.delete(id);
        });
        pintar();
      } catch (e) { /* sin red: se pone al día en la próxima sincronización */ }
    }
    function alReaccion(payload) {
      if (cerrado || !payload) return;
      if (payload.eventType === 'DELETE') {
        // los DELETE no se pueden filtrar por sala: llegan solo con la clave (mensaje, persona)
        const o = payload.old || {};
        if (!o.mensaje || !o.persona || !reacs.has(o.mensaje) || !reacs.get(o.mensaje).has(o.persona)) return;
        ponerReac(o.mensaje, o.persona, null);
      } else {
        const n = payload.new || {};
        if (n.sala !== sala || !n.mensaje || !n.persona) return;
        if (n.persona === yo && reaccionando.has(n.mensaje)) return; // la mía en vuelo: manda lo que tocó la persona
        ponerReac(n.mensaje, n.persona, n.clave);
        if (!perfiles.has(n.persona)) asegurarIds([n.persona]).then(() => pintar()).catch(() => {});
      }
      pintar();
    }
    async function reaccionar(id, clave) {
      const m = lista.find((x) => x.id === id);
      if (!m || m.tipo === 'eliminado' || esTmp(m) || reaccionando.has(id)) return;
      const antes = (reacs.get(id) && reacs.get(id).get(yo)) || null;
      const nueva = L.alternarReaccion(antes, clave);
      ponerReac(id, yo, nueva); pintar();
      if (nueva) vibrar(10);
      reaccionando.add(id);
      const tabla = () => sb.from('mensaje_reacciones');
      try {
        let r;
        if (!nueva) r = await tabla().delete().eq('mensaje', id).eq('persona', yo);
        else if (!antes) {
          r = await tabla().insert({ mensaje: id, clave: nueva, sala });
          if (r.error && String(r.error.code) === '23505') r = await tabla().update({ clave: nueva }).eq('mensaje', id).eq('persona', yo); // ya tenía una (desde otro teléfono)
        } else r = await tabla().update({ clave: nueva }).eq('mensaje', id).eq('persona', yo);
        if (r.error) throw r.error;
      } catch (e) {
        if (!cerrado) { ponerReac(id, yo, antes); pintar(); toast('No pudimos guardar la reacción. Probá de nuevo.'); }
      } finally { reaccionando.delete(id); }
    }

    // ---------- Fijado (uno por sala, lo ven todos) ----------
    async function cargarFijado() {
      const v = verFijado;
      try {
        const { data, error } = await sb.from('chat_fijados').select('sala,mensaje').eq('sala', sala).limit(1);
        if (error || cerrado || v !== verFijado) return;
        fijado = (data && data[0] && data[0].mensaje) || null;
        pintar();
      } catch (e) { /* sin red: queda lo que había */ }
    }
    function alFijado(payload) {
      if (cerrado || !payload) return;
      if (payload.eventType === 'DELETE') { const o = payload.old || {}; if (o.sala !== sala) return; fijado = null; }
      else { const n = payload.new || {}; if (n.sala !== sala) return; fijado = n.mensaje || null; }
      verFijado++;
      pintar();
    }
    async function fijar(id) {
      const antes = fijado, nuevo = fijado === id ? null : id;
      fijado = nuevo; verFijado++; pintar();
      try {
        const { error } = await sb.rpc('fijar_mensaje', { p_sala: sala, p_id: nuevo });
        if (error) throw error;
        if (!cerrado) toast(nuevo ? 'Fijaste el mensaje: lo ven todos arriba del chat.' : 'Desfijaste el mensaje.');
      } catch (e) {
        if (!cerrado) { fijado = antes; verFijado++; pintar(); toast(nuevo ? 'No pudimos fijar el mensaje. Probá de nuevo.' : 'No pudimos desfijar el mensaje. Probá de nuevo.'); }
      }
    }

    // ---------- Responder citando ----------
    function responder(id) {
      const o = originalDe(id);
      if (!o || o.tipo === 'eliminado' || String(id).startsWith('tmp-')) return;
      if (editandoId) cancelarEdicion(); // responder cancela la edición
      citando = id;
      citaNombre.textContent = 'Respondiendo a ' + (o.autor === yo ? 'vos' : nombreDe(o.autor));
      citaTexto.textContent = L.textoCita(o);
      barraCita.hidden = false;
      inTexto.focus({ preventScroll: true });
    }
    function quitarCita() { citando = null; barraCita.hidden = true; }
    // al mandar: se toma la cita y la barra se va enseguida (lo siguiente que escriba no hereda la cita)
    const usarCita = () => { const c = citando; quitarCita(); return c; };
    const devolverCita = (c) => { if (c && !citando && !editandoId && originalDe(c)) responder(c); };
    /** insert de un mensaje; si la cita fue rechazada (el original ya no existe), sale sin cita y avisa */
    async function insertarMensaje(fila) {
      let r = await sb.from('mensajes').insert(fila).select(CAMPOS).single();
      if (r.error && fila.responde_a && L.errorDeCita(r.error)) {
        citados.set(fila.responde_a, null);
        toast('El mensaje que respondías ya no está: lo mandamos sin la cita.');
        r = await sb.from('mensajes').insert({ ...fila, responde_a: null }).select(CAMPOS).single();
      }
      return r;
    }
    async function irAlOriginal(id) {
      if (citados.get(id) === null) { toast('Ese mensaje ya no está.'); return; }
      // si es más viejo que lo cargado, se traen páginas hasta llegar (con tope)
      for (let i = 0; i < 20 && !lista.some((x) => x.id === id) && hayMas && !cerrado; i++) await cargarMas();
      if (cerrado) return;
      if (ocultos.has(id)) { toast('Ese mensaje lo eliminaste para vos. Lo podés volver a mostrar desde el menú del chat.'); return; }
      const fila = elLista.querySelector(`.chat-msg[data-id="${CSS.escape(id)}"]`);
      if (!fila) { toast('No encontramos ese mensaje.'); return; }
      resaltadoId = id; resaltadoHasta = Date.now() + 1700;
      const quieto = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      fila.scrollIntoView({ block: 'center', behavior: quieto ? 'auto' : 'smooth' });
      fila.classList.remove('resaltado'); void fila.offsetWidth; fila.classList.add('resaltado');
      const b = fila.querySelector('.chat-burbuja');
      if (b) b.focus({ preventScroll: true });
      setTimeout(() => { if (resaltadoId === id && Date.now() >= resaltadoHasta) elLista.querySelectorAll('.chat-msg.resaltado').forEach((x) => x.classList.remove('resaltado')); }, 1750);
    }

    // ---------- Enviar texto ----------
    const modoMic = () => !inTexto.value.trim() && !editandoId;
    function actualizarBoton() {
      const mic = modoMic();
      if (btnEnviar.dataset.modo === (mic ? 'mic' : 'enviar')) return;
      btnEnviar.dataset.modo = mic ? 'mic' : 'enviar';
      btnEnviar.replaceChildren(ico(mic ? 'microfono' : 'enviar'));
      btnEnviar.setAttribute('aria-label', mic ? 'Mantené apretado para grabar un audio' : 'Enviar');
      btnEnviar.classList.toggle('mic', mic);
    }
    function crecer() { inTexto.style.height = 'auto'; inTexto.style.height = Math.min(inTexto.scrollHeight, 130) + 'px'; actualizarBoton(); }
    inTexto.addEventListener('input', crecer);
    inTexto.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !tactil) { e.preventDefault(); if (!modoMic()) form.requestSubmit(); }
    });
    function abajo() { elLista.scrollTop = elLista.scrollHeight; }

    let tocoMic = 0; // el click que sigue a mantener apretado el micrófono no es un "enviar"
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (guardando) return; // la edición anterior todavía está en vuelo
      const t = inTexto.value;
      if (modoMic()) {
        if (ev.submitter === btnEnviar && Date.now() - tocoMic > 1500) toast('Mantené apretado el micrófono para grabar un audio.');
        return;
      }
      if (!L.textoValido(t)) return;
      if (editandoId) return guardarEdicion(t);
      inTexto.value = ''; crecer();
      const cita = usarCita();
      const tmp = { id: 'tmp-' + Date.now(), sala, autor: yo, tipo: 'texto', texto: t.trim(), creado: new Date().toISOString(), subiendo: true, responde_a: cita };
      lista = L.fusionar(lista, tmp); pintar(); abajo();
      let r;
      try { r = await insertarMensaje({ sala, tipo: 'texto', texto: t.trim(), responde_a: cita }); } catch (e) { r = { error: e }; }
      lista = L.quitar(lista, tmp.id);
      if (r.error) {
        if (!cerrado) { if (!inTexto.value) { inTexto.value = t; crecer(); } devolverCita(cita); toast('No pudimos mandar el mensaje. Revisá la conexión y probá de nuevo.'); pintar(); }
        return;
      }
      meter(r.data); pintar(); abajo();
    });

    // ---------- Fotos y videos ----------
    inArchivo.addEventListener('change', () => { const f = inArchivo.files && inArchivo.files[0]; inArchivo.value = ''; elegido(f); });
    async function elegido(f) {
      if (!f) return;
      const esVideo = /^video\//.test(f.type) || (!f.type && /\.(mp4|m4v|mov|webm)$/i.test(f.name || ''));
      if (!esVideo) { enviarFoto(f); return; }
      const mime = f.type || (/\.webm$/i.test(f.name) ? 'video/webm' : 'video/mp4');
      const antes = L.problemaVideo({ bytes: f.size, ms: 1, mime });
      if (antes) { toast(antes); return; }
      toast('Preparando el video…');
      let info;
      try { info = await M.infoVideo(f); } catch (e) { if (!cerrado) toast('No pudimos leer ese video. Probá con otro.'); return; }
      if (cerrado) return;
      enviarVideo({ video: f, mime, mini: info.mini, ancho: info.ancho, alto: info.alto, duracion_ms: info.duracion_ms });
    }
    function abrirCamara() {
      if (!g.Camara) { inArchivo.click(); return; }
      // la cámara de la app saca la foto o graba el video y lo manda al chat (no espera a que suba)
      g.Camara.abrir({ destino: 'el chat', alSacar: async (p) => { g.Camara.cerrar(); if (p && p.video) enviarVideo(p); else if (p && p.foto) enviarFoto(p.foto); } });
    }
    function abrirAdjuntar() {
      if (editandoId) { toast('Terminá o cancelá la edición primero.'); return; }
      if (!g.Camara) { inArchivo.click(); return; }
      const el = hoja('Mandar una foto o un video', [
        h('p', { class: 'chat-hoja-tit' }, 'Mandar una foto o un video'),
        item('camara', 'Abrir cámara', despues(abrirCamara), 'chat-i-camara'),
        // la galería se abre en el mismo toque (si no, el navegador la bloquea) y la hoja se cierra atrás
        item('galeria', 'Elegir de la galería', () => { inArchivo.click(); cerrarCapa(); }, 'chat-i-galeria'),
        botonCancelar()], 'chat-hoja-adj');
      abrirCapa(el, { volverA: btnAdj });
    }

    async function enviarFoto(file) {
      if (!file) return;
      if (editandoId) { toast('Terminá o cancelá la edición primero.'); return; }
      const cita = usarCita();
      const tmp = { id: 'tmp-f' + Date.now(), sala, autor: yo, tipo: 'foto', creado: new Date().toISOString(), subiendo: true, local: URL.createObjectURL(file), ancho: 4, alto: 3, responde_a: cita };
      locales.add(tmp.local);
      lista = L.fusionar(lista, tmp); pintar(); abajo();
      const quitarTmp = () => { lista = L.quitar(lista, tmp.id); medios.delete(tmp.id); pintar(); };
      let c, mini;
      try { c = await M.comprimirImagen(file, 1600, 0.8); mini = await M.comprimirImagen(file, 480, 0.7); }
      catch (e) { quitarTmp(); devolverCita(cita); toast('No pudimos leer esa foto. Probá con otra.'); return; }
      tmp.ancho = c.ancho; tmp.alto = c.alto; pintar();
      const archivo = L.rutaArchivo(sala, 'foto', crypto.randomUUID()), archivoMini = M.rutaMini(archivo);
      try {
        const up = await sb.storage.from(M.BUCKET).upload(archivo, c.blob, { contentType: c.tipo });
        if (up.error) throw up.error;
        const upMini = await sb.storage.from(M.BUCKET).upload(archivoMini, mini.blob, { contentType: mini.tipo });
        if (upMini.error) { borrarArchivos([archivo]); throw upMini.error; }
        const { data, error } = await insertarMensaje({ sala, tipo: 'foto', archivo, ancho: c.ancho, alto: c.alto, responde_a: cita });
        if (error) { borrarArchivos([archivo, archivoMini]); throw error; }
        medios.delete(tmp.id);
        lista = L.quitar(lista, tmp.id); meter(data); pintar(); abajo();
      } catch (e) {
        quitarTmp(); devolverCita(cita); toast('No pudimos mandar la foto. Revisá la conexión y probá de nuevo.');
      }
    }

    /** p = { video, mime, mini, ancho, alto, duracion_ms } (lo que da la cámara, o la galería con infoVideo) */
    async function enviarVideo(p) {
      if (!p || !p.video) return;
      if (editandoId) { toast('Terminá o cancelá la edición primero.'); return; }
      const mime = p.mime || p.video.type;
      const problema = L.problemaVideo({ bytes: p.video.size, ms: p.duracion_ms, mime });
      if (problema) { toast(problema); return; }
      const fmt = L.formatoVideo(mime);
      const cita = usarCita();
      const ancho = p.ancho || 1280, alto = p.alto || 720, duracion_ms = Math.round(p.duracion_ms);
      const tmp = { id: 'tmp-v' + Date.now(), sala, autor: yo, tipo: 'video', creado: new Date().toISOString(), subiendo: true, ancho, alto, duracion_ms,
        local: p.mini ? URL.createObjectURL(p.mini) : null, localVideo: URL.createObjectURL(p.video), responde_a: cita };
      if (tmp.local) locales.add(tmp.local);
      locales.add(tmp.localVideo);
      lista = L.fusionar(lista, tmp); pintar(); abajo();
      const archivo = L.rutaArchivo(sala, 'video', crypto.randomUUID(), fmt.ext), archivoMini = M.rutaMini(archivo);
      try {
        let mini = p.mini;
        if (!mini) { const c = document.createElement('canvas'); c.width = 16; c.height = 9; mini = await M.aBlob(c, 0.75); }
        const up = await sb.storage.from(M.BUCKET).upload(archivo, p.video, { contentType: fmt.tipo });
        if (up.error) throw up.error;
        const upMini = await sb.storage.from(M.BUCKET).upload(archivoMini, mini, { contentType: mini.type || 'image/webp' });
        if (upMini.error) { borrarArchivos([archivo]); throw upMini.error; }
        const { data, error } = await insertarMensaje({ sala, tipo: 'video', archivo, ancho, alto, duracion_ms, responde_a: cita });
        if (error) { borrarArchivos([archivo, archivoMini]); throw error; }
        medios.delete(tmp.id);
        lista = L.quitar(lista, tmp.id); meter(data); pintar(); abajo();
      } catch (e) {
        lista = L.quitar(lista, tmp.id); medios.delete(tmp.id); pintar(); devolverCita(cita);
        toast('No pudimos mandar el video. Revisá la conexión y probá de nuevo.');
      }
    }

    // ---------- Audios: mantener apretado el micrófono, soltar envía, deslizar a la izquierda cancela ----------
    let rec = null, reloj = null, x0 = 0, cancelado = false, soltado = false;
    function terminarUi() {
      clearInterval(reloj); reloj = null;
      grabandoEl.hidden = true; grabandoEl.classList.remove('soltar'); btnEnviar.classList.remove('grabando');
    }
    const oyentes = { pointerup: () => alSoltar(), pointercancel: () => cancelarGrabacion(), pointermove: (e) => alMover(e) };
    const oir = (si) => Object.entries(oyentes).forEach(([ev, fn]) => (si ? g.addEventListener(ev, fn) : g.removeEventListener(ev, fn)));
    btnEnviar.addEventListener('pointerdown', async (e) => {
      if (!modoMic() || rec || (e.button && e.button > 0)) return;
      e.preventDefault();
      tocoMic = Date.now();
      x0 = e.clientX; cancelado = false; soltado = false;
      oir(true);
      const r = M.grabadora(); rec = r;
      try { await r.iniciar(); }
      catch (err) {
        if (rec === r) rec = null;
        oir(false); terminarUi();
        toast(err.message === 'sin-permiso' ? 'Para mandar audios, dale permiso al micrófono (en el candado de la barra de direcciones o en los ajustes del teléfono).'
          : err.message === 'sin-mic' ? 'No encontramos el micrófono, o lo está usando otra app (¿una llamada?).'
          : 'Este navegador no puede grabar audios. Probá con Chrome.');
        return;
      }
      if (soltado || cancelado || cerrado || rec !== r) {
        r.cancelar(); if (rec === r) rec = null;
        if (soltado && !cancelado && !cerrado) toast('Mantené apretado el micrófono mientras hablás.');
        return;
      }
      vibrar(20);
      btnEnviar.classList.add('grabando'); grabandoEl.hidden = false;
      grabandoEl.querySelector('.chat-rec-t').textContent = '0:00';
      reloj = setInterval(() => {
        grabandoEl.querySelector('.chat-rec-t').textContent = L.duracionTexto(r.ms());
        if (r.ms() >= L.AUDIO_MAX_MS) finalizar(); // tope de 2 minutos: se manda solo
      }, 200);
    });
    btnEnviar.addEventListener('contextmenu', (e) => { if (rec) e.preventDefault(); });
    function alSoltar() { soltado = true; tocoMic = Date.now(); if (rec && reloj) finalizar(); else oir(false); }
    function alMover(e) {
      if (!rec || !reloj) return;
      const lejos = e.clientX - x0 < -80;
      grabandoEl.classList.toggle('soltar', lejos);
      if (lejos && !cancelado) { cancelarGrabacion(); vibrar([10, 40, 10]); toast('Audio cancelado.'); }
    }
    async function finalizar() {
      soltado = true; oir(false);
      const r = rec;
      if (!r) return;
      rec = null; terminarUi();
      const res = await r.detener();
      if (!res || cancelado || cerrado) return;
      const ms = Math.round(Math.min(res.ms, L.AUDIO_MAX_MS));
      if (!L.audioValido(ms)) { toast('El audio fue muy corto. Mantené apretado el micrófono mientras hablás.'); return; }
      enviarAudio(res.blob, ms, res.mime);
    }
    function cancelarGrabacion() { soltado = true; cancelado = true; oir(false); if (rec) { rec.cancelar(); rec = null; } terminarUi(); }
    async function enviarAudio(blob, ms, mime) {
      const cita = usarCita();
      const tmp = { id: 'tmp-a' + Date.now(), sala, autor: yo, tipo: 'audio', creado: new Date().toISOString(), subiendo: true, duracion_ms: ms, local: URL.createObjectURL(blob), responde_a: cita };
      locales.add(tmp.local);
      lista = L.fusionar(lista, tmp); pintar(); abajo();
      const archivo = L.rutaArchivo(sala, 'audio', crypto.randomUUID(), L.extAudio(mime));
      try {
        const up = await sb.storage.from(M.BUCKET).upload(archivo, blob, { contentType: L.tipoAudio(mime) });
        if (up.error) throw up.error;
        const { data, error } = await insertarMensaje({ sala, tipo: 'audio', archivo, duracion_ms: ms, responde_a: cita });
        if (error) { borrarArchivos([archivo]); throw error; }
        soltarMedio(tmp.id);
        lista = L.quitar(lista, tmp.id); meter(data); pintar(); abajo();
      } catch (e) {
        soltarMedio(tmp.id); lista = L.quitar(lista, tmp.id); pintar(); devolverCita(cita);
        toast('No pudimos mandar el audio. Revisá la conexión y probá de nuevo.');
      }
    }

    // ---------- Stickers: del grupo (biblioteca de todos) y de GIPHY ----------
    let stickers = null; // null = sin cargar
    async function mandarSticker(fuente) {
      const cita = usarCita();
      const tmp = { id: 'tmp-s' + Date.now(), sala, autor: yo, tipo: 'sticker', creado: new Date().toISOString(), subiendo: true, responde_a: cita,
        archivo: fuente.archivo || null, externo: fuente.externo || null };
      lista = L.fusionar(lista, tmp); pintar(); abajo();
      let r;
      try { r = await insertarMensaje({ sala, tipo: 'sticker', archivo: fuente.archivo || null, externo: fuente.externo || null, responde_a: cita }); } catch (e) { r = { error: e }; }
      soltarMedio(tmp.id); lista = L.quitar(lista, tmp.id);
      if (r.error) { if (!cerrado) { pintar(); devolverCita(cita); toast('No pudimos mandar el sticker. Revisá la conexión y probá de nuevo.'); } return; }
      meter(r.data); pintar(); abajo();
    }
    function abrirStickers() {
      if (editandoId) { toast('Terminá o cancelá la edición primero.'); return; }
      let tab = 'grupo';
      try { if (localStorage.getItem('chatStkTab') === 'giphy') tab = 'giphy'; } catch (e) { /* sin almacenamiento */ }
      let quitando = false;
      const grillaGrupo = h('div', { class: 'chat-stk-grilla' });
      const inStk = h('input', { type: 'file', accept: 'image/*', hidden: true, id: 'chat-stk-in-' + Math.random().toString(36).slice(2) });
      const notaGrupo = h('p', { class: 'chat-stk-nota', hidden: true });
      const btnQuitar = h('button', { type: 'button', class: 'btn-link chat-stk-quitar-modo', hidden: true, on: { click: () => { quitando = !quitando; pintarGrupo(); } } });
      const panelGrupo = h('div', { class: 'chat-stk-cuerpo', role: 'tabpanel', id: prefijo + 'tp-grupo' }, grillaGrupo, notaGrupo, btnQuitar, inStk);
      const qG = h('input', { type: 'search', class: 'chat-giphy-q', placeholder: 'Buscá: messi, gato, festejo…', 'aria-label': 'Buscar stickers en GIPHY', enterKeyHint: 'search' });
      const grillaG = h('div', { class: 'chat-stk-grilla' });
      const panelGiphy = h('div', { class: 'chat-stk-cuerpo', role: 'tabpanel', id: prefijo + 'tp-giphy' }, qG, grillaG, h('p', { class: 'chat-giphy-marca' }, 'Powered by GIPHY'));
      const tGrupo = h('button', { type: 'button', role: 'tab', class: 'chat-tab', 'aria-controls': prefijo + 'tp-grupo', on: { click: () => mostrarTab('grupo') } }, 'Del grupo');
      const tGiphy = h('button', { type: 'button', role: 'tab', class: 'chat-tab', 'aria-controls': prefijo + 'tp-giphy', on: { click: () => mostrarTab('giphy') } }, 'GIPHY');
      const el = hoja('Stickers', [
        h('div', { class: 'chat-stk-cab' }, h('div', { class: 'chat-tabs', role: 'tablist', 'aria-label': 'Stickers' }, tGrupo, tGiphy),
          h('button', { type: 'button', class: 'chat-cab-b chat-stk-cerrar', 'aria-label': 'Cerrar los stickers', on: { click: () => cerrarCapa() } }, ico('cruz'))),
        panelGrupo, panelGiphy], 'chat-hoja-stk');
      const capa = abrirCapa(el, { volverA: btnStk, alCerrar: () => { alFirmar = null; } });
      alFirmar = () => { if (capas.includes(capa)) pintarGrupo(); };

      function mostrarTab(t) {
        tab = t;
        try { localStorage.setItem('chatStkTab', t); } catch (e) { /* sin almacenamiento */ }
        tGrupo.setAttribute('aria-selected', String(t === 'grupo')); tGiphy.setAttribute('aria-selected', String(t === 'giphy'));
        panelGrupo.hidden = t !== 'grupo'; panelGiphy.hidden = t !== 'giphy';
        if (t === 'grupo') cargarGrupo(); else if (ultimaQ === null) buscarG(qG.value.trim());
      }
      async function cargarGrupo() {
        pintarGrupo();
        try {
          const { data, error } = await sb.from('stickers').select('id,archivo,autor,creado').order('creado', { ascending: false }).limit(300);
          if (error) throw error;
          stickers = data || [];
        } catch (e) { if (stickers === null) { notaGrupo.hidden = false; notaGrupo.textContent = 'No pudimos traer los stickers. Revisá la conexión.'; } return; }
        if (!capas.includes(capa)) return;
        stickers.forEach((s) => { if (!M.vigente(s.archivo)) pedirFirma(s.archivo); });
        pintarGrupo();
      }
      function pintarGrupo() {
        const crear = h('label', { class: 'chat-stk-crear', htmlFor: inStk.id, tabindex: '0', role: 'button',
          on: { keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inStk.click(); } } } }, ico('mas'), h('span', null, 'Crear'));
        const nodos = (stickers || []).map((s) => {
          const url = M.firmada(s.archivo);
          const b = h('button', { type: 'button', class: 'chat-stk-b', 'aria-label': 'Mandar este sticker', disabled: quitando, on: { click: () => { if (!quitando) despues(() => mandarSticker({ archivo: s.archivo }))(); } } },
            h('img', { src: url || null, alt: '', loading: 'lazy', draggable: false }));
          const cel = h('div', { class: 'chat-stk-cel' }, b);
          if (quitando && s.autor === yo) {
            const x = h('button', { type: 'button', class: 'chat-stk-x', 'aria-label': 'Quitar este sticker del grupo' }, ico('cruz'));
            // doble toque, como eliminar un mensaje. El archivo no se borra: lo pueden estar usando mensajes.
            x.addEventListener('click', async () => {
              if (!x.classList.contains('armado')) { x.classList.add('armado'); x.setAttribute('aria-label', 'Tocá de nuevo para quitarlo'); setTimeout(() => { x.classList.remove('armado'); x.setAttribute('aria-label', 'Quitar este sticker del grupo'); }, 3000); return; }
              x.disabled = true;
              try {
                const { error } = await sb.from('stickers').delete().eq('id', s.id);
                if (error) throw error;
                stickers = stickers.filter((y) => y.id !== s.id); pintarGrupo();
              } catch (e) { x.disabled = false; toast('No pudimos quitar el sticker. Probá de nuevo.'); }
            });
            cel.append(x);
          }
          return cel;
        });
        grillaGrupo.replaceChildren(crear, ...nodos);
        const mios = (stickers || []).some((s) => s.autor === yo);
        btnQuitar.hidden = !mios && !quitando; btnQuitar.textContent = quitando ? 'Listo' : 'Quitar los míos';
        notaGrupo.hidden = !(stickers && !stickers.length);
        if (stickers && !stickers.length) notaGrupo.textContent = 'Todavía no hay stickers del grupo. Creá el primero con una foto.';
      }
      inStk.addEventListener('change', () => { const f = inStk.files && inStk.files[0]; inStk.value = ''; if (f) abrirEditorSticker(f); });

      // GIPHY: búsqueda con espera, sin reintentos automáticos (la cuota gratis es chica)
      let ultimaQ = null, tG = 0, turnoG = 0;
      const notaG = (t) => grillaG.replaceChildren(h('p', { class: 'chat-stk-nota' }, t));
      async function buscarG(q) {
        const clave = g.App.GIPHY_KEY;
        if (!clave) { notaG('Falta configurar GIPHY.'); return; }
        if (q === ultimaQ) return;
        ultimaQ = q;
        const turno = ++turnoG; notaG('Buscando…');
        try {
          const res = await M.buscarGiphy(clave, q);
          if (turno !== turnoG || !capas.includes(capa)) return;
          if (!res.length) { notaG('No encontramos stickers para eso. Probá con otra palabra.'); return; }
          grillaG.replaceChildren(...res.map((x) => h('div', { class: 'chat-stk-cel' },
            h('button', { type: 'button', class: 'chat-stk-b', 'aria-label': 'Mandar el sticker ' + x.titulo, on: { click: despues(() => mandarSticker({ externo: x.url })) } },
              h('img', { src: x.url, alt: '', loading: 'lazy', draggable: false })))));
        } catch (e) {
          if (turno !== turnoG) return;
          ultimaQ = null; // se puede reintentar escribiendo de nuevo
          notaG(e.message === 'cuota' ? 'GIPHY llegó a su límite por esta hora. Probá más tarde o usá los del grupo.'
            : e.message === 'clave' ? 'La clave de GIPHY no es válida.' : 'No pudimos conectar con GIPHY. Revisá la conexión.');
        }
      }
      qG.addEventListener('input', () => { clearTimeout(tG); tG = setTimeout(() => buscarG(qG.value.trim()), 400); });
      qG.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(tG); buscarG(qG.value.trim()); } });
      mostrarTab(tab);
      (tab === 'grupo' ? tGrupo : tGiphy).focus({ preventScroll: true });
    }

    // editor: recorte cuadrado + texto (sin librerías)
    async function abrirEditorSticker(file) {
      let ed;
      try { const bm = await createImageBitmap(file, { imageOrientation: 'from-image' }); ed = { bm, cx: bm.width / 2, cy: bm.height / 2, zoom: 1 }; }
      catch (e) { toast('No pudimos abrir esa imagen. Probá con otra.'); return; }
      if (cerrado) { ed.bm.close && ed.bm.close(); return; }
      const cv = h('canvas', { class: 'chat-stk-lienzo', width: 512, height: 512, 'aria-label': 'Vista previa del sticker. Arrastrá para acomodarlo' });
      const zoom = h('input', { type: 'range', min: '1', max: '4', step: '0.01', value: '1', 'aria-label': 'Acercar' });
      const texto = h('input', { type: 'text', class: 'chat-stk-texto', maxLength: 30, placeholder: 'Texto (opcional)', 'aria-label': 'Texto del sticker' });
      const guardar = h('button', { type: 'button', class: 'btn-primario chat-stk-guardar' }, 'Guardar y mandar');
      const el = h('div', { class: 'chat-capa chat-capa-editor', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Crear un sticker' },
        h('div', { class: 'chat-stk-editor' },
          h('p', null, 'Arrastrá para acomodarlo'), cv, zoom, texto,
          h('div', { class: 'chat-stk-acc' }, h('button', { type: 'button', class: 'btn-sec', on: { click: () => cerrarCapa() } }, 'Cancelar'), guardar)));
      let cuadro = 0;
      const dibujar = () => {
        if (cuadro) return;
        cuadro = requestAnimationFrame(() => {
          cuadro = 0; if (!ed) return;
          const corte = Math.min(ed.bm.width, ed.bm.height) / ed.zoom;
          ed.cx = Math.min(Math.max(corte / 2, ed.cx), ed.bm.width - corte / 2); ed.cy = Math.min(Math.max(corte / 2, ed.cy), ed.bm.height - corte / 2);
          M.pintarSticker(cv.getContext('2d'), ed.bm, { x: ed.cx, y: ed.cy, zoom: ed.zoom }, texto.value, cv.width);
        });
      };
      zoom.addEventListener('input', () => { ed.zoom = Number(zoom.value); dibujar(); });
      texto.addEventListener('input', dibujar);
      let px = 0, py = 0, arr = false;
      cv.addEventListener('pointerdown', (e) => { arr = true; px = e.clientX; py = e.clientY; try { cv.setPointerCapture(e.pointerId); } catch (x) { /* nada */ } });
      cv.addEventListener('pointermove', (e) => {
        if (!arr || !ed) return;
        const esc = (Math.min(ed.bm.width, ed.bm.height) / ed.zoom) / cv.getBoundingClientRect().width;
        ed.cx -= (e.clientX - px) * esc; ed.cy -= (e.clientY - py) * esc; px = e.clientX; py = e.clientY; dibujar();
      });
      ['pointerup', 'pointercancel'].forEach((ev) => cv.addEventListener(ev, () => { arr = false; }));
      const capa = abrirCapa(el, { foco: texto, alCerrar: () => { if (ed) { ed.bm.close && ed.bm.close(); ed = null; } } });
      dibujar();
      guardar.addEventListener('click', async () => {
        if (!ed) return;
        guardar.disabled = true;
        const miEd = ed, archivo = L.rutaSticker(crypto.randomUUID());
        try {
          const blob = await M.hacerSticker(ed.bm, { x: ed.cx, y: ed.cy, zoom: ed.zoom }, texto.value);
          const up = await sb.storage.from(M.BUCKET).upload(archivo, blob, { contentType: blob.type });
          if (up.error) throw up.error;
          if (ed !== miEd || !capas.includes(capa)) { borrarArchivos([archivo]); return; } // volvió atrás mientras subía: se cancela
          const { data, error } = await sb.from('stickers').insert({ archivo }).select('id,archivo,autor,creado').single();
          if (error) { borrarArchivos([archivo]); throw error; }
          stickers = [data, ...(stickers || [])];
          cerrarTodas();
          mandarSticker({ archivo });
        } catch (e) { toast('No pudimos guardar el sticker. Revisá la conexión y probá de nuevo.'); }
        finally { guardar.disabled = false; }
      });
    }

    // ---------- Editar y eliminar lo propio ----------
    function empezarEdicion(id) {
      const m = lista.find((x) => x.id === id);
      if (!m || !L.puedeEditar(m, yo)) return;
      quitarCita();
      editandoId = id;
      barraEdicion.hidden = false; inTexto.value = m.texto; crecer(); inTexto.focus(); pintar();
    }
    function cancelarEdicion() { editandoId = null; barraEdicion.hidden = true; inTexto.value = ''; crecer(); }
    async function guardarEdicion(t) {
      if (guardando) return;
      const id = editandoId;
      const m = lista.find((x) => x.id === id);
      const nuevo = L.textoEditado(t, m && m.texto);
      if (nuevo == null) { cancelarEdicion(); return; } // no cambió: no se manda nada ni queda "Editado"
      guardando = true; btnEnviar.disabled = true;
      try {
        const { data, error } = await sb.rpc('editar_mensaje', { p_id: id, p_texto: nuevo });
        if (cerrado) return;
        if (error) {
          // P0002: pasaron los 15 minutos, no es tuyo o ya no estás en la sala
          toast(error.code === 'P0002' ? 'Ya no se puede editar este mensaje (pasaron 15 minutos).' : 'No pudimos editar el mensaje. Probá de nuevo.');
          if (error.code === 'P0002') cancelarEdicion();
          return;
        }
        if (editandoId === id) cancelarEdicion();
        const fila = Array.isArray(data) ? data[0] : data;
        if (fila) { meter(fila); pintar(); }
      } catch (e) {
        if (!cerrado) toast('No pudimos editar el mensaje. Probá de nuevo.');
      } finally { guardando = false; btnEnviar.disabled = false; }
    }
    // Borra archivos de Storage; si falla, reintenta una vez y deja aviso en la consola.
    async function borrarArchivos(paths) {
      if (!paths.length) return;
      const intentar = async () => { const r = await sb.storage.from(M.BUCKET).remove(paths); if (r && r.error) throw r.error; };
      try { await intentar(); } catch (e1) {
        try { await intentar(); } catch (e2) { console.warn('chat: no se pudieron borrar archivos de Storage', paths, e2); }
      }
    }
    async function eliminar(id) {
      if (eliminando.has(id)) return; // segundo toque con la RPC en vuelo: daría P0002 y un error falso
      eliminando.add(id);
      pintar();
      let data, error;
      try { ({ data, error } = await sb.rpc('eliminar_mensaje', { p_id: id })); }
      catch (e) { error = e; }
      finally { eliminando.delete(id); }
      if (cerrado) return;
      if (error) { toast('No pudimos eliminar el mensaje. Probá de nuevo.'); pintar(); return; }
      if (editandoId === id) cancelarEdicion();
      if (citando === id) quitarCita();
      soltarMedio(id);
      if (destacados.delete(id)) guardarSet('destacados', destacados);
      if (fijado === id) { fijado = null; verFijado++; } // la base lo saca de fijados
      if (data && data.fila) meter(data.fila); else lista = lista.map((m) => (m.id === id ? { ...m, tipo: 'eliminado', texto: null, archivo: null, externo: null, duracion_ms: null } : m));
      pintar();
      if (data) borrarArchivos(L.archivosABorrar(data.tipo_antes, data.archivo_antes));
    }

    // ---------- Menú del mensaje (mantener apretado o clic derecho), también para los ajenos ----------
    let capaMenu = null;
    function abrirMenu(id) {
      const m = lista.find((x) => x.id === id);
      if (!m || esTmp(m) || eliminando.has(id) || (capaMenu && capas.includes(capaMenu))) return;
      const eliminado = m.tipo === 'eliminado';
      const mia = (reacs.get(id) && reacs.get(id).get(yo)) || null;
      const hijos = [];
      if (!eliminado) {
        hijos.push(h('div', { class: 'chat-reac-fila', role: 'group', 'aria-label': 'Reaccionar' }, L.REACCIONES.map((k) => h('button', {
          type: 'button', class: 'chat-reac-b reac-' + k + (mia === k ? ' mia' : ''), 'data-reac': k, 'aria-label': L.NOMBRE_REACCION[k], 'aria-pressed': mia === k ? 'true' : 'false',
          on: { click: async () => { await cerrarCapa(); reaccionar(id, k); } },
        }, ico(k)))));
        hijos.push(item('responder', 'Responder', despues(() => responder(id)), 'chat-i-responder'));
        if (m.texto) hijos.push(item('copiar', 'Copiar', despues(() => copiar(m.texto)), 'chat-i-copiar'));
      }
      if (L.puedeEditar(m, yo)) hijos.push(item('editar', 'Editar', despues(() => empezarEdicion(id)), 'chat-i-editar'));
      if (!eliminado) {
        hijos.push(item(fijado === id ? 'fijar-no' : 'fijar', fijado === id ? 'Desfijar' : 'Fijar', despues(() => fijar(id)), 'chat-i-fijar'));
        hijos.push(item('estrella', destacados.has(id) ? 'Quitar de destacados' : 'Destacar', despues(() => destacar(id)), 'chat-i-destacar'));
      }
      hijos.push(item('ocultar', 'Eliminar para mí', despues(() => ocultar(id)), 'chat-i-ocultar'));
      if (m.autor === yo && !eliminado) {
        let hecho = false;
        const b = item('basura', 'Eliminar para todos', () => {
          if (!b.classList.contains('armado')) { b.classList.add('armado'); b.querySelector('span').textContent = 'Tocá de nuevo para eliminarlo para todos'; return; }
          if (hecho) return;
          hecho = true; cerrarCapa(); eliminar(id);
        }, 'chat-i-eliminar peligro');
        hijos.push(b);
      }
      hijos.push(botonCancelar());
      const quien = m.autor === yo ? 'tu mensaje' : 'el mensaje de ' + nombreDe(m.autor);
      selId = id; pintar();
      capaMenu = abrirCapa(hoja('Opciones de ' + quien, hijos, 'chat-hoja-menu'), {
        volverA: elLista.querySelector(`.chat-burbuja[data-id="${CSS.escape(id)}"]`),
        alCerrar: () => { selId = null; capaMenu = null; pintar(); },
      });
    }
    function copiar(t) {
      const ok = () => toast('Copiamos el mensaje.');
      try { navigator.clipboard.writeText(t).then(ok, () => toast('No pudimos copiar el mensaje.')); } catch (e) { toast('No pudimos copiar el mensaje.'); }
    }
    function destacar(id) {
      const si = !destacados.has(id);
      if (si) destacados.add(id); else destacados.delete(id);
      guardarSet('destacados', destacados); pintar();
      toast(si ? 'Lo destacaste. Lo encontrás en la estrella de arriba del chat.' : 'Lo sacaste de destacados.');
    }
    function ocultar(id) {
      ocultos.add(id); guardarSet('ocultos', ocultos);
      if (citando === id) quitarCita();
      if (editandoId === id) cancelarEdicion();
      soltarMedio(id); pintar();
      toast('Lo eliminaste para vos. Lo podés volver a mostrar desde el menú del chat.');
    }

    // presión larga, clic derecho y teclado sobre una burbuja; deslizarla a la derecha = responder (como en WhatsApp)
    let presion = null, desliz = null;
    const cancelarPresion = () => { if (presion) { clearTimeout(presion.t); presion = null; } };
    elLista.addEventListener('pointerdown', (e) => {
      tragarClick = false; // gesto nuevo
      const b = e.target.closest('.chat-burbuja');
      if (!b || (e.button && e.button > 0)) return;
      const id = b.dataset.id;
      if (!id || id.startsWith('tmp-')) return;
      cancelarPresion();
      presion = { id, x: e.clientX, y: e.clientY, t: setTimeout(() => { presion = null; if (desliz) desliz.menu = true; tragarClick = true; vibrar(15); abrirMenu(id); }, 500) };
      desliz = { b, id, x: e.clientX, y: e.clientY, dx: 0 };
    });
    elLista.addEventListener('pointermove', (e) => {
      if (presion && Math.hypot(e.clientX - presion.x, e.clientY - presion.y) > 10) cancelarPresion();
      if (!desliz) return;
      const dx = e.clientX - desliz.x, dy = e.clientY - desliz.y;
      if (Math.abs(dy) > 30 && Math.abs(dy) > dx) { desliz.b.style.transform = ''; desliz = null; return; }
      if (dx > 10) { desliz.dx = dx; desliz.b.style.transform = `translateX(${Math.min(dx, 80)}px)`; }
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => elLista.addEventListener(ev, cancelarPresion));
    elLista.addEventListener('scroll', cancelarPresion, { passive: true });
    const finDesliz = (e) => {
      if (!desliz) return;
      const { b, id, dx, menu } = desliz; desliz = null;
      b.style.transition = 'transform .15s'; b.style.transform = ''; setTimeout(() => { b.style.transition = ''; }, 160);
      if (dx > 10) tragarClick = true; // deslizar una foto no la abre
      // solo un dedo que se levanta confirma (no un gesto cancelado, como el atrás de Android), y no si ya se abrió el menú
      if (e.type === 'pointerup' && dx > 60 && !menu && !capas.length) { vibrar(10); responder(id); }
    };
    g.addEventListener('pointerup', finDesliz); elLista.addEventListener('pointercancel', finDesliz); // salirse del borde no corta el gesto
    elLista.addEventListener('contextmenu', (e) => {
      const b = e.target.closest('.chat-burbuja');
      if (!b || !b.dataset.id || b.dataset.id.startsWith('tmp-')) return;
      e.preventDefault(); cancelarPresion(); abrirMenu(b.dataset.id);
    });
    elLista.addEventListener('keydown', (e) => {
      const b = e.target.closest && e.target.closest('.chat-burbuja');
      if (!b || e.target !== b) return;
      if (e.key === 'Enter' || e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); abrirMenu(b.dataset.id); }
    });

    // ---------- Cabecera: buscar, destacados y más ----------
    function panel(titulo, arriba, cuerpo, clase) {
      return hoja(titulo, [
        h('div', { class: 'chat-panel-cab' }, h('b', null, titulo),
          h('button', { type: 'button', class: 'chat-cab-b', 'aria-label': 'Cerrar', on: { click: () => cerrarCapa() } }, ico('cruz'))),
        arriba, cuerpo], 'chat-hoja-panel' + (clase ? ' ' + clase : ''));
    }
    function filaRes(m, q) {
      const txt = m.tipo === 'texto' ? m.texto : L.resumen(m);
      const [a, b, c] = L.partirCoincidencia(txt, q || '');
      return h('button', { type: 'button', class: 'chat-res-b', on: { click: despues(() => irAlOriginal(m.id)) } },
        h('small', null, (m.autor === yo ? 'Vos' : nombreDe(m.autor)) + ' · ' + fmtFecha(m.creado)),
        h('span', null, a, b && h('mark', null, b), c));
    }
    function abrirBuscar() {
      const q = h('input', { type: 'search', class: 'chat-buscar-q', placeholder: 'Buscar en el chat', 'aria-label': 'Buscar en el chat', enterKeyHint: 'search' });
      const res = h('div', { class: 'chat-res', 'aria-live': 'polite' });
      const el = panel('Buscar en el chat', q, res, 'chat-hoja-buscar');
      let t = 0, turno = 0;
      q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(buscar, 300); });
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(t); buscar(); } });
      async function buscar() {
        const texto = q.value.trim(), patron = L.patronBusqueda(texto), mi = ++turno;
        if (!patron) { res.replaceChildren(); return; }
        try {
          const { data, error } = await sb.from('mensajes').select(CAMPOS).eq('sala', sala).eq('tipo', 'texto').ilike('texto', patron)
            .order('creado', { ascending: false }).limit(50);
          if (error) throw error;
          await asegurarPerfiles(data || []);
          if (mi !== turno) return;
          const xs = (data || []).filter((m) => !ocultos.has(m.id));
          res.replaceChildren(...(xs.length ? xs.map((m) => filaRes(m, texto)) : [h('p', { class: 'chat-res-nota' }, 'No hay mensajes con eso.')]));
        } catch (e) {
          if (mi === turno) res.replaceChildren(h('p', { class: 'chat-res-nota' }, 'No pudimos buscar. Revisá la conexión y probá de nuevo.'));
        }
      }
      abrirCapa(el, { foco: q });
    }
    async function abrirDestacados() {
      const res = h('div', { class: 'chat-res', 'aria-live': 'polite' }, h('p', { class: 'chat-res-nota' }, 'Cargando…'));
      const capa = abrirCapa(panel('Mensajes destacados', null, res, 'chat-hoja-destacados'));
      const ids = [...destacados];
      if (!ids.length) { res.replaceChildren(h('p', { class: 'chat-res-nota' }, 'Todavía no destacaste mensajes. Mantené apretado uno y tocá Destacar.')); return; }
      try {
        const { data, error } = await sb.from('mensajes').select(CAMPOS).eq('sala', sala).in('id', ids).order('creado', { ascending: false });
        if (error) throw error;
        await asegurarPerfiles(data || []);
        if (!capas.includes(capa)) return;
        const xs = (data || []).filter((m) => m.tipo !== 'eliminado' && !ocultos.has(m.id));
        res.replaceChildren(...(xs.length ? xs.map((m) => filaRes(m)) : [h('p', { class: 'chat-res-nota' }, 'Los mensajes que destacaste se eliminaron.')]));
      } catch (e) {
        if (capas.includes(capa)) res.replaceChildren(h('p', { class: 'chat-res-nota' }, 'No pudimos traer los destacados. Revisá la conexión y probá de nuevo.'));
      }
    }
    function abrirMenuChat() {
      const hijos = [h('p', { class: 'chat-hoja-tit' }, 'Chat'),
        item('buscar', 'Buscar en el chat', despues(abrirBuscar), 'chat-i-buscar'),
        item('estrella', 'Mensajes destacados', despues(abrirDestacados), 'chat-i-destacados')];
      if (!elFijado.hidden && fijado) {
        const id = fijado;
        hijos.push(item('fijar', 'Ir al mensaje fijado', despues(() => irAlOriginal(id)), 'chat-i-ir-fijado'));
        hijos.push(item('fijar-no', 'Desfijar el mensaje', despues(() => fijar(id)), 'chat-i-desfijar'));
      }
      if (ocultos.size) {
        const n = ocultos.size;
        hijos.push(item('ocultar', n === 1 ? 'Volver a mostrar el mensaje que eliminaste para vos' : `Volver a mostrar los ${n} mensajes que eliminaste para vos`,
          despues(() => { ocultos.clear(); guardarSet('ocultos', ocultos); pintar(); toast('Volvimos a mostrar los mensajes.'); }), 'chat-i-mostrar'));
      }
      hijos.push(botonCancelar());
      abrirCapa(hoja('Opciones del chat', hijos, 'chat-hoja-menu'));
    }

    // ---------- Visor de fotos y videos ----------
    async function abrirVisor(id) {
      const m = lista.find((x) => x.id === id);
      if (!m || (m.tipo !== 'foto' && m.tipo !== 'video')) return;
      const video = m.tipo === 'video';
      let url = video ? m.localVideo || M.firmada(m.archivo) : m.local || M.firmada(m.archivo);
      if (!url) { try { M.reintentarYa(); await M.firmar(sb, [m.archivo]); url = M.firmada(m.archivo); } catch (e) { /* sin red */ } }
      if (!url) { toast(video ? 'No pudimos abrir el video. Revisá la conexión.' : 'No pudimos abrir la foto. Revisá la conexión.'); return; }
      if (cerrado || capas.some((c) => c.el.classList.contains('chat-visor'))) return;
      if (video && sonando) sonando.pause();
      const x = h('button', { type: 'button', class: 'chat-visor-x', 'aria-label': 'Cerrar', on: { click: (e) => { e.stopPropagation(); cerrarCapa(capa); } } }, ico('cruz'));
      const medio = video
        ? h('video', { src: url, controls: true, playsInline: true, autoplay: true, preload: 'auto', poster: m.local || M.firmada(M.rutaMini(m.archivo || '')) || null, 'aria-label': 'Video' })
        : h('img', { src: url, alt: 'Foto' });
      if (video) medio.setAttribute('playsinline', '');
      const el = h('div', { class: 'chat-visor', role: 'dialog', 'aria-modal': 'true', 'aria-label': video ? 'Video' : 'Foto',
        on: { click: (e) => { if (e.target.tagName !== 'VIDEO') cerrarCapa(capa); } } }, medio, x);
      const capa = abrirCapa(el, { foco: x, volverA: medios.get(id) || document.activeElement,
        alCerrar: () => { if (video) { medio.pause(); medio.removeAttribute('src'); medio.load(); } } });
    }

    // ---------- Realtime (nada de polling): al (re)conectar se pone al día ----------
    const alVolver = () => {
      if (document.hidden) { if (rec || reloj) cancelarGrabacion(); return; }
      M.reintentarYa(); citasEsperaHasta = 0; sincronizar();
    };
    document.addEventListener('visibilitychange', alVolver);
    g.addEventListener('online', alVolver);
    // topic único por apertura: realtime.channel() reutiliza un canal con el mismo topic mientras el anterior
    // todavía se está yendo ("leaving"), y reabrir enseguida dejaría el chat sin tiempo real.
    const filtro = 'sala=eq.' + sala; // además del filtro del cliente en alLlegar
    const cambios = (table, event, fn, conFiltro = true) => ({ table, event, fn, conFiltro });
    canal = [
      cambios('mensajes', 'INSERT', alLlegar), cambios('mensajes', 'UPDATE', alLlegar),
      cambios('mensaje_reacciones', 'INSERT', alReaccion), cambios('mensaje_reacciones', 'UPDATE', alReaccion),
      cambios('mensaje_reacciones', 'DELETE', alReaccion, false), // los DELETE no se filtran: llegan con la clave y se miran acá
      cambios('chat_fijados', 'INSERT', alFijado), cambios('chat_fijados', 'UPDATE', alFijado), cambios('chat_fijados', 'DELETE', alFijado, false),
    ].reduce((c, x) => c.on('postgres_changes', { event: x.event, schema: 'public', table: x.table, ...(x.conFiltro ? { filter: filtro } : {}) }, x.fn),
      sb.channel('chat-' + sala + '-' + crypto.randomUUID()))
      .subscribe((st) => { if (st === 'SUBSCRIBED') sincronizar(); });

    actualizarBoton();
    pintar();
    sincronizar();
    const envios = { foto: enviarFoto, video: enviarVideo };
    abiertos.set(sala, envios); // para el "Mandar al chat" del álbum

    return function cerrar() {
      if (cerrado) return;
      cerrado = true;
      if (abiertos.get(sala) === envios) abiertos.delete(sala);
      document.removeEventListener('visibilitychange', alVolver);
      g.removeEventListener('online', alVolver);
      g.removeEventListener('pointerup', finDesliz);
      if (rec || reloj) cancelarGrabacion();
      oir(false);
      cancelarPresion();
      if (canal) sb.removeChannel(canal);
      cerrarTodas(); // con sus entradas de "atrás": si no, "atrás" no haría nada
      g.removeEventListener('popstate', alPopstate);
      for (const id of [...medios.keys()]) soltarMedio(id);
      locales.forEach((u) => URL.revokeObjectURL(u));
      if (cont.contains(raiz)) cont.replaceChildren();
    };
  }

  // Chats abiertos ahora (sala → { foto, video }): el álbum manda fotos y videos al chat de la actividad que está a la vista.
  const abiertos = new Map();
  const puedeEnviar = (sala) => abiertos.has(sala);
  async function enviarFotoA(sala, file) { const f = abiertos.get(sala); if (!f) return false; await f.foto(file); return true; }
  /** p = { video, mime, mini, ancho, alto, duracion_ms } */
  async function enviarVideoA(sala, p) { const f = abiertos.get(sala); if (!f) return false; await f.video(p); return true; }

  g.Chat = { abrir, puedeEnviar, enviarFoto: enviarFotoA, enviarVideo: enviarVideoA };
})(window);
