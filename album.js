// Álbum compartido de una actividad (copiado de Rumbo al Sur y adaptado): grilla por día en vivo, visor, guardar,
// mandar al chat, editar y borrar (solo el autor). Cámara y galería pasan por la cola offline (IndexedDB).
// Album.abrir(contenedor, actividadId) devuelve la función que cierra el álbum y baja la suscripción.
// Necesita AlbumLogica, AlbumCola, Camara, EditorFoto, ChatMedios y Perfiles. Lo ven y lo usan los anotados (en_sala).
(function (g) {
  const CSS = `
.album { margin-top: 1.25rem; padding-top: .25rem; border-top: 1px solid var(--border) }
.album [hidden] { display: none !important }
.album .album-acciones { display: flex; gap: 8px; flex-wrap: wrap; align-items: center }
.album .album-acciones .btn-sec, .album .album-acciones .btn-primario { flex: 1; margin-top: 0; text-align: center; cursor: pointer }
.album .album-drive { display: inline-block; margin-top: .6rem; color: var(--accent-hover); font-weight: 600; text-decoration: none }
[data-tema="oscuro"] .album .album-drive { color: var(--accent) }
.album .album-drive:hover { text-decoration: underline }
.album .album-estado { font-size: .88rem; color: var(--muted); margin: .6rem 0 0 }
.album .album-estado .barra { height: 5px; border-radius: 3px; background: var(--border); margin-top: 5px; overflow: hidden }
.album .album-estado .barra i { display: block; height: 100%; background: var(--accent) }
.album .album-estado.lleno .barra i { background: #B3261E }
.album h3 { margin: 14px 0 6px; font-size: .95rem; color: var(--muted); font-weight: 600; font-family: var(--fuente-ui) }
.album h3::first-letter { text-transform: uppercase }
.album .album-dia { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px }
.album .album-cel { position: relative; aspect-ratio: 1; background: var(--bg-alt); border-radius: 4px; overflow: hidden; padding: 0; border: 0; cursor: pointer }
.album .album-cel img { width: 100%; height: 100%; object-fit: cover; display: block }
.album .album-cel .avatar { position: absolute; left: 4px; bottom: 4px; box-shadow: 0 0 0 1.5px #fff; font-size: .6rem }
.album .vacio { color: var(--muted) }
.album-visor { position: fixed; inset: 0; z-index: 85; background: #000; color: #fff; display: flex; flex-direction: column; touch-action: none; font-family: var(--fuente-ui) }
.album-visor [hidden] { display: none !important }
.album-visor .marco { flex: 1; overflow: hidden; display: grid; place-items: center; position: relative; min-height: 0 }
.album-visor .marco img { max-width: 100%; max-height: 100%; object-fit: contain; transform-origin: center; will-change: transform; user-select: none; -webkit-user-drag: none }
.album-visor .cab { display: flex; align-items: center; gap: 10px; padding: calc(10px + env(safe-area-inset-top, 0px)) 12px 8px }
.album-visor .cab b { flex: 1; font-size: .95rem; font-weight: 600 }
.album-visor .cab small { display: block; opacity: .7; font-weight: 400 }
.album-visor button, .album-visor a { font: inherit; color: #fff; background: rgba(255,255,255,.12); border: 0; border-radius: 999px; padding: 10px 14px; font-weight: 600; font-size: .9rem; text-decoration: none; white-space: nowrap; cursor: pointer }
.album-visor .pie { display: flex; gap: 6px; justify-content: space-between; padding: 10px 10px calc(12px + env(safe-area-inset-bottom, 0px)); flex-wrap: wrap }
/* confirmación de borrado: tarjeta en el centro, sobre la foto */
.album-visor .album-confirmar { position: absolute; left: 16px; right: 16px; top: 50%; transform: translateY(-50%); background: #0C2440; border-radius: 12px; padding: 16px; box-shadow: 0 10px 40px rgba(0,0,0,.6) }
.album-visor .album-confirmar p { margin: 0 0 14px; line-height: 1.4; font-size: .95rem; color: rgba(255,255,255,.8) }
.album-visor .album-confirmar p b { display: block; font-size: 1.1rem; color: #fff; margin-bottom: 4px }
.album-visor .album-confirmar .fila { display: flex; gap: 8px }
.album-visor .album-confirmar .fila button { flex: 1; padding: 12px 14px }
.album-visor .album-borrar-si { background: #B3261E }`;

  function h(tag, props, ...hijos) {
    const el = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'on') Object.entries(v).forEach(([ev, fn]) => el.addEventListener(ev, fn));
      else if (k in el && k !== 'list') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    el.append(...nodos(hijos));
    return el;
  }
  const nodos = (xs) => xs.flat(Infinity).filter((c) => c != null && c !== false && c !== '');

  let estilo = false;
  let cola = null; // una sola cola para toda la app (sube también lo pendiente de otras actividades)
  function laCola() {
    if (!cola) cola = g.AlbumCola.crear({ sb: g.App.sb, yo: () => (g.App.yo() ? g.App.yo().id : null) });
    return cola;
  }
  // al entrar (perfil cargado) se crea la cola: lo que quedó pendiente se sube sin tener que abrir el álbum
  g.addEventListener('perfil', (e) => { if (e.detail && g.App && g.App.sb && g.AlbumCola) laCola(); });
  const fmtHora = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

  function abrir(cont, act) {
    const A = g.AlbumLogica, M = g.ChatMedios, sb = g.App.sb;
    const toast = (t) => g.App.toast(t);
    const yo = () => (g.App.yo() ? g.App.yo().id : null);
    const sala = 'act:' + act;
    if (!estilo) { estilo = true; document.head.appendChild(h('style', null, CSS)); }
    const q = laCola();

    let fotos = [], uso = 0, driveUrl = null, truncado = false;
    let estado = 'cargando';      // 'cargando' | 'error' | 'ok'
    let cerrado = false;
    let enVuelo = null;           // la sincronización en curso (una sola a la vez)
    let otraVez = false;          // la pidieron de nuevo con una en vuelo: al terminar se corre una más
    let actual = null, borrando = false, abriendoEditor = false;
    const perfiles = new Map();

    const perfilDe = (id) => perfiles.get(id) || { id, nombre: 'Compañero', foto: null };

    // ---------- Estructura ----------
    const inGaleria = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, id: 'album-galeria-' + act.slice(0, 8) });
    const linkDrive = h('a', { class: 'album-drive', id: 'album-drive', target: '_blank', rel: 'noopener', hidden: true }, g.App.icono('drive'), 'Ver en Drive');
    const elEstadoTxt = h('div', { class: 'album-estado-txt', 'aria-live': 'polite' });
    const elBarra = h('div', { class: 'barra', hidden: true }, h('i'));
    const elEstado = h('div', { class: 'album-estado' }, elEstadoTxt, elBarra);
    const elGrilla = h('div', { class: 'album-grilla' });
    cont.classList.add('album');
    cont.replaceChildren(
      h('h2', { class: 'sub titulo-ico' }, g.App.icono('album'), 'Álbum'),
      h('div', { class: 'album-acciones' },
        h('button', { type: 'button', id: 'album-camara', class: 'btn-primario btn-chico btn-con-ico', on: { click: abrirCamara } }, g.App.icono('camara'), 'Cámara'),
        h('button', { type: 'button', id: 'album-galeria', class: 'btn-sec btn-chico btn-con-ico', on: { click: () => inGaleria.click() } }, g.App.icono('galeria'), 'Galería'),
        inGaleria),
      linkDrive, elEstado, elGrilla);

    // ---------- Pintar ----------
    function pintarEstado() {
      const e = A.espacio(uso, A.LIMITE_BYTES), pend = q.pendientes(act), est = q.estado();
      elEstado.className = 'album-estado ' + e.estado;
      const t = A.textoEstado({ n: fotos.length, pend, est, espacio: e, truncado });
      // el lector de pantalla lo anuncia solo si cambió (no en cada repintado)
      if (elEstadoTxt.textContent !== t) elEstadoTxt.textContent = t;
      elBarra.hidden = e.estado === 'ok';
      elBarra.firstChild.style.width = e.pct + '%';
      g.Camara.pendientes(pend);
      linkDrive.hidden = !driveUrl;
      if (driveUrl) linkDrive.href = driveUrl;
    }

    async function firmarYPoner(imgs) {
      const rutas = imgs.map((i) => i.dataset.ruta).filter(Boolean);
      if (!rutas.length) return;
      try { await M.firmar(sb, rutas, 'album'); } catch (e) { console.warn('álbum: firmas en espera', e.message); }
      if (cerrado) return;
      for (const i of imgs) { const u = M.firmada(i.dataset.ruta); if (u && i.getAttribute('src') !== u) i.src = u; }
    }

    function pintar() {
      if (cerrado) return;
      pintarEstado();
      if (estado === 'error' && !fotos.length) {
        elGrilla.replaceChildren(h('div', { class: 'vacio', role: 'alert' }, h('p', null, 'No pudimos cargar el álbum.'),
          h('button', { type: 'button', id: 'album-reintentar', class: 'btn-sec btn-chico', on: { click: () => { estado = 'cargando'; pintar(); sincronizar(); } } }, 'Reintentar')));
        return;
      }
      if (estado === 'cargando' && !fotos.length) { elGrilla.replaceChildren(h('p', { class: 'vacio' }, 'Cargando…')); return; }
      if (!fotos.length) { elGrilla.replaceChildren(h('p', { class: 'vacio' }, 'Todavía no hay fotos. Sacá la primera con la cámara o subí las que tenés en la galería.')); return; }
      elGrilla.replaceChildren(...A.porDia(fotos).map((d) => h('section', null,
        h('h3', null, d.titulo),
        h('div', { class: 'album-dia' }, d.fotos.map((f) => {
          const img = h('img', { alt: '', loading: 'lazy' });
          img.dataset.ruta = f.mini;
          const u = M.firmada(f.mini); if (u) img.src = u;
          return h('button', { type: 'button', class: 'album-cel', 'data-id': f.id, 'aria-label': 'Foto de ' + perfilDe(f.autor).nombre, on: { click: () => abrirVisor(f.id) } },
            img, g.Perfiles.avatar(perfilDe(f.autor), 20));
        })))));
      firmarYPoner([...elGrilla.querySelectorAll('img')].filter((i) => !M.vigente(i.dataset.ruta)));
    }

    // ---------- Datos ----------
    async function asegurarPerfiles(fs) {
      const faltan = [...new Set(fs.map((f) => f.autor))].filter((id) => id && !perfiles.has(id));
      if (!faltan.length) return;
      const { data } = await sb.from('perfiles').select('id, nombre, foto').in('id', faltan);
      (data || []).forEach((p) => perfiles.set(p.id, p));
      await g.Perfiles.prepararAvatares(data || [], sb).catch(() => {});
    }
    // Trae todo de nuevo (carga inicial y al reconectar: lo que cambió con el socket caído no llegó en vivo).
    // Si la piden con otra en vuelo, esa no alcanza: se marca otraVez y al terminar se corre una sola más.
    function sincronizar() {
      if (cerrado) return Promise.resolve();
      if (enVuelo) { otraVez = true; return enVuelo; }
      otraVez = false;
      enVuelo = (async () => {
        try {
          const [r, a, u] = await Promise.all([
            sb.from('fotos').select('*').eq('actividad', act).order('tomada', { ascending: false }).limit(A.LIMITE_FOTOS),
            sb.from('actividades').select('drive_url').eq('id', act).maybeSingle(),
            sb.rpc('album_uso'),
          ]);
          if (r.error) throw r.error;
          if (cerrado) return;
          await asegurarPerfiles(r.data || []);
          if (cerrado) return;
          fotos = r.data || [];
          truncado = fotos.length >= A.LIMITE_FOTOS;
          if (!a.error) driveUrl = (a.data && a.data.drive_url) || null;
          if (!u.error) uso = Number(u.data) || 0;
          estado = 'ok';
          if (actual && !fotos.some((x) => x.id === actual.id)) cerrarVisor();
        } catch (e) {
          console.error('álbum', e);
          if (!cerrado && estado !== 'ok') estado = 'error';
        } finally {
          enVuelo = null;
          const repetir = otraVez && !cerrado; otraVez = false;
          if (!cerrado) pintar();
          if (repetir) sincronizar();
        }
      })();
      return enVuelo;
    }
    async function refrescarUso() { const u = await sb.rpc('album_uso'); if (!u.error && !cerrado) { uso = Number(u.data) || 0; pintarEstado(); } }
    async function meter(f) {
      if (!f || f.actividad !== act || cerrado) return;
      await asegurarPerfiles([f]);
      if (cerrado) return;
      fotos = A.fusionar(fotos, f); pintar();
      if (actual && actual.id === f.id) actual = f;
    }
    function sacar(id) {
      if (!fotos.some((x) => x.id === id)) return;
      fotos = A.quitar(fotos, id); pintar();
      if (actual && actual.id === id) cerrarVisor();
      refrescarUso();
    }

    const dejarDeOir = q.escuchar({
      alSubir: (fila) => { meter(fila); refrescarUso(); },
      alEstado: () => { if (!cerrado) pintarEstado(); }, // el aviso de "descartada" lo da la cola (aunque el álbum esté cerrado)
    });

    // ---------- Realtime (topic único y filtro del servidor; nada de polling) ----------
    // Los DELETE no se pueden filtrar en el servidor: llega solo el id y se saca si estaba en esta actividad.
    const canal = sb.channel('album-' + act + '-' + crypto.randomUUID())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'fotos', filter: 'actividad=eq.' + act }, (p) => { meter(p.new); refrescarUso(); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'fotos', filter: 'actividad=eq.' + act }, (p) => { if (p.new && fotos.some((x) => x.id === p.new.id)) meter(p.new); })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'fotos' }, (p) => { if (p.old && p.old.id) sacar(p.old.id); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'actividades', filter: 'id=eq.' + act }, (p) => {
        if (cerrado || !p.new) return;
        driveUrl = p.new.drive_url || null; pintarEstado();
      })
      .subscribe((st) => { if (st === 'SUBSCRIBED') sincronizar(); });

    const alVolver = () => { if (!document.hidden) { M.reintentarYa(); sincronizar(); } };
    document.addEventListener('visibilitychange', alVolver);
    g.addEventListener('online', alVolver);

    // ---------- Sumar fotos ----------
    const agregar = (p, extra) => q.agregar({ id: extra.id || crypto.randomUUID(), actividad: act, autor: yo(), foto: p.foto, mini: p.mini, media: p.media, ancho: p.ancho, alto: p.alto, tomada: extra.tomada, editada_de: extra.editada_de || null });
    function abrirCamara() {
      g.Camara.abrir({
        alSacar: (p, extra) => agregar(p, extra),
        alTocarUltima: () => { g.Camara.cerrar(); cont.scrollIntoView({ block: 'start' }); },
      });
      g.Camara.pendientes(q.pendientes(act));
    }
    inGaleria.addEventListener('change', async (e) => {
      const files = [...(e.target.files || [])]; e.target.value = '';
      let malas = 0;
      for (const f of files) {
        try {
          const p = await g.Camara.preparar(f);
          await agregar(p, { tomada: new Date(f.lastModified || Date.now()).toISOString() });
        } catch (x) { console.error(x); malas++; }
      }
      if (malas) toast(malas === 1 ? 'Una foto no se pudo leer.' : `${malas} fotos no se pudieron leer.`);
    });

    // ---------- Visor ----------
    let visor = null, img = null, z = { s: 1, x: 0, y: 0 }, focoAntes = null, confAbierta = 0;
    const aplicarZ = () => { if (img) img.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.s})`; };
    const el = {};
    function armarVisor() {
      el.titulo = h('b');
      el.cerrar = h('button', { type: 'button', class: 'album-visor-cerrar', 'aria-label': 'Volver', on: { click: salirVisor } }, g.App.icono('volver'));
      img = h('img', { alt: 'Foto del álbum' });
      el.marco = h('div', { class: 'marco' }, img);
      el.guardar = h('a', { href: '#', class: 'album-guardar', download: '', on: { click: guardar } }, 'Guardar');
      el.chat = h('button', { type: 'button', class: 'album-al-chat', on: { click: alChat } }, 'Mandar al chat');
      el.editar = h('button', { type: 'button', class: 'album-editar', on: { click: editar } }, 'Editar');
      el.borrar = h('button', { type: 'button', class: 'album-borrar', on: { click: abrirConf } }, 'Borrar');
      el.confD = h('span', { id: 'album-confirmar-d' });
      el.no = h('button', { type: 'button', class: 'album-borrar-no', on: { click: () => { if (history.state && history.state.albumConf) history.back(); else ocultarConf(); } } }, 'Cancelar');
      el.si = h('button', { type: 'button', class: 'album-borrar-si', on: { click: borrar } }, 'Borrar foto');
      el.conf = h('div', { class: 'album-confirmar', hidden: true, role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'album-confirmar-t', 'aria-describedby': 'album-confirmar-d' },
        h('p', null, h('b', { id: 'album-confirmar-t' }, '¿Borrar esta foto?'), el.confD), h('div', { class: 'fila' }, el.no, el.si));
      el.cab = h('div', { class: 'cab' }, el.cerrar, el.titulo);
      el.pie = h('div', { class: 'pie' }, el.guardar, el.chat, el.editar, el.borrar);
      visor = h('div', { class: 'album-visor', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Foto del álbum' }, el.cab, el.marco, el.pie, el.conf);
      gestos(el.marco);
    }
    function mostrar(f) {
      actual = f; z = { s: 1, x: 0, y: 0 }; aplicarZ();
      const p = perfilDe(f.autor);
      el.titulo.replaceChildren(p.nombre + (f.autor === yo() ? ' (vos)' : ''), h('small', null, fmtHora.format(new Date(f.tomada))));
      img.src = M.firmada(f.mini) || '';
      el.borrar.hidden = f.autor !== yo(); ocultarConf();
      el.chat.hidden = !(g.Chat && g.Chat.puedeEnviar && g.Chat.puedeEnviar(sala));
      el.guardar.href = '#';
      const opciones = [A.verFoto(f), f.media, f.mini].filter((x, i, xs) => x && xs.indexOf(x) === i);
      (async () => {
        for (const ruta of opciones) {
          try { await M.firmar(sb, [ruta], 'album'); } catch {}
          const u = M.firmada(ruta); if (!u || !actual || actual.id !== f.id) continue;
          const ok = await new Promise((res) => { const pr = new Image(); pr.onload = () => res(true); pr.onerror = () => res(false); pr.src = u; });
          if (!actual || actual.id !== f.id) return;
          if (ok) { img.src = u; return; } // si la original ya no está (liberada a Drive), sigue con la media
        }
      })();
    }
    function teclaVisor(e) {
      if (!visor || !visor.isConnected) return;
      if (g.EditorFoto && g.EditorFoto.abierto()) return; // el editor está encima: las teclas son suyas
      if (e.key === 'Escape') { e.preventDefault(); if (!el.conf.hidden) el.no.click(); else salirVisor(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') pasar(e.key === 'ArrowRight' ? 1 : -1);
      else if (e.key === 'Tab') atraparFoco(e);
    }
    // el foco no se va del visor (es modal): Tab y Shift+Tab dan la vuelta entre sus botones visibles
    function atraparFoco(e) {
      const xs = [...visor.querySelectorAll('button, a[href]')].filter((x) => !x.closest('[hidden]') && !x.closest('[inert]') && x.offsetParent !== null);
      if (!xs.length) return;
      const i = xs.indexOf(document.activeElement);
      const sig = e.shiftKey ? (i <= 0 ? xs[xs.length - 1] : xs[i - 1]) : (i < 0 || i === xs.length - 1 ? xs[0] : xs[i + 1]);
      e.preventDefault(); sig.focus();
    }
    function abrirVisor(id) {
      const f = fotos.find((x) => x.id === id); if (!f) return;
      if (!visor) armarVisor();
      if (visor.isConnected) return mostrar(f);
      focoAntes = document.activeElement;
      document.body.append(visor);
      document.addEventListener('keydown', teclaVisor, true);
      history.pushState({ ...(history.state || {}), albumFoto: 1 }, '', location.hash || location.pathname + location.search);
      mostrar(f);
      el.cerrar.focus();
    }
    function cerrarVisor() {
      if (!visor || !visor.isConnected) return;
      ocultarConf(); visor.remove(); actual = null; img.removeAttribute('src');
      document.removeEventListener('keydown', teclaVisor, true);
      const f = focoAntes; focoAntes = null;
      if (f && f.isConnected && typeof f.focus === 'function') f.focus({ preventScroll: true });
    }
    // salir del visor sacando también las entradas de "atrás" que puso (foto y confirmación)
    function salirVisor() {
      const n = (history.state && history.state.albumConf ? 1 : 0) + (history.state && history.state.albumFoto ? 1 : 0);
      if (n) history.go(-n); else cerrarVisor();
    }
    function alPopstate() {
      if (!visor || !visor.isConnected) return;
      if (!el.conf.hidden && !(history.state && history.state.albumConf)) ocultarConf();
      if (!(history.state && history.state.albumFoto)) cerrarVisor();
      else if (g.EditorFoto && !g.EditorFoto.abierto() && actual && !fotos.some((x) => x.id === actual.id)) salirVisor();
    }
    g.addEventListener('popstate', alPopstate);
    function pasar(d) { if (!actual) return; const i = fotos.findIndex((f) => f.id === actual.id), sig = fotos[i + d]; if (sig) mostrar(sig); }

    // pellizcar, arrastrar con zoom, deslizar para pasar de foto, doble toque para acercar
    function gestos(marco) {
      const dedos = new Map(); let ini = null, ultimoToque = 0;
      marco.addEventListener('pointerdown', (e) => {
        dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const ps = [...dedos.values()];
        ini = ps.length === 2 ? { d: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y), s: z.s, x: z.x, y: z.y } : { px: e.clientX, py: e.clientY, x: z.x, y: z.y, s: z.s, t: Date.now() };
      });
      marco.addEventListener('pointermove', (e) => {
        if (!dedos.has(e.pointerId) || !ini) return; dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const ps = [...dedos.values()];
        if (ps.length === 2 && ini.d) { z.s = Math.min(6, Math.max(1, ini.s * Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) / ini.d)); if (z.s === 1) { z.x = 0; z.y = 0; } aplicarZ(); }
        else if (ps.length === 1 && ini.px != null && z.s > 1) { z.x = ini.x + e.clientX - ini.px; z.y = ini.y + e.clientY - ini.py; aplicarZ(); }
      });
      const soltar = (e) => {
        if (!dedos.has(e.pointerId)) return;
        const eraUno = dedos.size === 1 && ini && ini.px != null; dedos.delete(e.pointerId);
        if (eraUno && e.type === 'pointerup' && z.s === 1 && actual) {
          const dx = e.clientX - ini.px, dy = e.clientY - ini.py;
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) pasar(dx < 0 ? 1 : -1);
          else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) { if (Date.now() - ultimoToque < 300) { z = { s: 2.5, x: 0, y: 0 }; aplicarZ(); } ultimoToque = Date.now(); }
        } else if (eraUno && e.type === 'pointerup' && z.s > 1 && Math.abs(e.clientX - ini.px) < 10 && Date.now() - ultimoToque < 300) { z = { s: 1, x: 0, y: 0 }; aplicarZ(); }
        else if (eraUno) ultimoToque = Date.now();
        if (!dedos.size) ini = null;
      };
      marco.addEventListener('pointerup', soltar); marco.addEventListener('pointercancel', soltar);
    }

    // la mejor versión que haya en la app: la original, o la media si la original ya se liberó (está en Drive)
    async function blobDe(f) {
      for (const ruta of [A.verFoto(f), f.media].filter((x, i, xs) => x && xs.indexOf(x) === i)) {
        try { await M.firmar(sb, [ruta], 'album'); } catch {}
        const u = M.firmada(ruta); if (!u) continue;
        const r = await fetch(u); if (r.ok) return r.blob();
      }
      throw new Error('sin la foto');
    }
    async function guardar(e) {
      e.preventDefault(); if (!actual) return;
      try {
        const b = await blobDe(actual), u = URL.createObjectURL(b);
        const a = h('a', { href: u, download: `thirdcedi-${actual.tomada.slice(0, 10)}-${actual.id.slice(0, 6)}.jpg` });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(u), 10000);
      } catch (x) { console.error(x); toast('No se pudo bajar la foto. Revisá la señal.'); }
    }
    async function alChat() {
      if (!actual) return;
      try {
        const b = await blobDe(actual);
        toast('Mandando al chat…'); // si falla, el chat avisa con su propio mensaje
        if (!(await g.Chat.enviarFoto(sala, new File([b], 'foto.jpg', { type: 'image/jpeg' })))) toast('El chat de la actividad no está abierto.');
      } catch (x) { console.error(x); toast('No se pudo mandar al chat. Revisá la señal.'); }
    }
    async function editar() {
      if (!actual || !g.EditorFoto || abriendoEditor || g.EditorFoto.abierto()) return;
      const f = actual; abriendoEditor = true;
      try {
        const b = await blobDe(f);
        g.EditorFoto.abrir(b, {
          alGuardar: async (editada) => {
            const p = await g.Camara.preparar(editada);
            await agregar(p, { tomada: new Date().toISOString(), editada_de: f.id });
          },
        });
      } catch (x) { console.error(x); toast('No se pudo abrir la foto para editar. Revisá la señal.'); }
      finally { abriendoEditor = false; }
    }

    // Borrar abre una confirmación en la página; "Borrar foto" no responde en el primer medio segundo (un doble toque no alcanza).
    const capas = () => [el.cab, el.marco, el.pie];
    function ocultarConf() {
      if (!el.conf || el.conf.hidden) return;
      el.conf.hidden = true; capas().forEach((x) => (x.inert = false));
      if (visor && visor.isConnected && !el.borrar.hidden) el.borrar.focus();
    }
    async function abrirConf() {
      if (!actual || actual.autor !== yo() || !el.conf.hidden) return;
      const f = actual;
      el.confD.textContent = 'Se borra del álbum para todos.';
      el.conf.hidden = false; confAbierta = Date.now(); capas().forEach((x) => (x.inert = true));
      history.pushState({ ...(history.state || {}), albumConf: 1 }, '', location.hash || location.pathname + location.search);
      el.no.focus();
      // ¿ya está la copia en Drive? (la sube el servidor un rato después: se pregunta en el momento)
      let drive = null;
      try { const r = await sb.from('fotos').select('drive_id').eq('id', f.id).maybeSingle(); if (!r.error) drive = !!(r.data && r.data.drive_id); } catch {}
      if (!actual || actual.id !== f.id || el.conf.hidden) return;
      el.confD.textContent = 'Se borra del álbum para todos. ' + (drive ? 'La copia en Google Drive queda guardada.' : 'Todavía no está en Google Drive: se pierde para siempre.');
    }
    async function borrar() {
      if (!actual || actual.autor !== yo() || borrando || Date.now() - confAbierta < 500) return;
      const f = actual; borrando = true;
      try {
        const r = await sb.from('fotos').delete().eq('id', f.id).select('id');
        if (r.error || !r.data || !r.data.length) { console.error(r.error); toast('No se pudo borrar. Probá de nuevo.'); return; }
        const rutas = [f.ruta, f.mini, f.media].filter(Boolean);
        let rm = await sb.storage.from('album').remove(rutas);
        if (rm.error) rm = await sb.storage.from('album').remove(rutas); // un reintento: si no, el archivo ocupa lugar
        if (rm.error) console.error('álbum: no se pudo borrar el archivo', rm.error);
        toast('Foto borrada');
        fotos = A.quitar(fotos, f.id); pintar(); refrescarUso().then(() => q.procesar());
        salirVisor();
      } finally { borrando = false; }
    }

    pintar();
    sincronizar();

    return function cerrar() {
      if (cerrado) return;
      cerrado = true;
      dejarDeOir();
      sb.removeChannel(canal);
      document.removeEventListener('visibilitychange', alVolver);
      g.removeEventListener('online', alVolver);
      g.removeEventListener('popstate', alPopstate);
      // con el visor abierto, sus entradas de "atrás" (foto y confirmación) se van con él: si no, "atrás" no haría nada
      const n = visor && visor.isConnected ? (history.state && history.state.albumConf ? 1 : 0) + (history.state && history.state.albumFoto ? 1 : 0) : 0;
      cerrarVisor();
      if (n) history.go(-n);
      if (g.Camara.abierta()) g.Camara.cerrar();
      cont.replaceChildren();
    };
  }

  g.Album = { abrir };
})(window);
