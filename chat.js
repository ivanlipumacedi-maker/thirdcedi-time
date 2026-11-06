// Chat grupal por sala ('act:<uuid>' / 'par:<uuid>'): texto y fotos, editar y eliminar lo propio, en vivo con Realtime.
// Chat.abrir(contenedor, sala) devuelve la función que cierra el chat y baja la suscripción. Necesita ChatLogica, ChatMedios y Perfiles.
(function (g) {
  const L = g.ChatLogica;
  const M = g.ChatMedios;
  const TAM = 50;
  const CAMPOS = 'id,sala,autor,tipo,texto,archivo,ancho,alto,editado,creado';

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

  function abrir(cont, sala) {
    const sb = g.App.sb;
    const yo = g.App.yo() ? g.App.yo().id : null;
    const tactil = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    let lista = [];
    let hayMas = false;
    let estado = 'cargando';          // 'cargando' | 'error' | 'ok'
    let menuId = null;                // mensaje propio con el menú abierto
    let confirmandoId = null;         // mensaje propio esperando el segundo toque para eliminarse
    let editandoId = null;
    let cerrado = false;
    let enVuelo = null;               // sincronización en curso (se comparte entre llamadas)
    let llegados = null;              // con una sincronización en vuelo: ids que entraron a la lista mientras tanto
    let pendientes = null;            // con una sincronización en vuelo: UPDATEs de mensajes que todavía no están
    let guardando = false;            // RPC de edición en vuelo
    let cargandoMas = false;          // "Ver mensajes anteriores" en vuelo
    let canal = null;
    let visor = null;
    let focoAntes = null;             // a dónde vuelve el foco al cerrar el visor
    // Perfiles de esta apertura (nombre y foto): se piden de nuevo cada vez que se abre un chat,
    // así un cambio de nombre o de foto se ve al volver a entrar.
    const perfiles = new Map();       // id -> { id, nombre, foto }
    const medios = new Map();         // id -> <img> reutilizada entre redibujos
    const locales = new Set();        // blob: URLs a soltar al cerrar

    const nombreDe = (id) => (perfiles.get(id) || {}).nombre || 'Compañero';
    const esTmp = (m) => String(m.id).startsWith('tmp-');

    // ---------- Estructura ----------
    const elLista = h('div', { class: 'chat-lista', role: 'log', 'aria-live': 'polite', 'aria-label': 'Mensajes' });
    const inTexto = h('textarea', { class: 'chat-texto', rows: 1, maxLength: L.MAX_TEXTO, placeholder: 'Escribí un mensaje', 'aria-label': 'Mensaje', enterKeyHint: tactil ? 'enter' : 'send' });
    const inFoto = h('input', { type: 'file', accept: 'image/*', hidden: true, id: 'chat-foto-' + Math.random().toString(36).slice(2) });
    const btnFoto = h('button', { type: 'button', class: 'chat-adj', 'aria-label': 'Mandar una foto', on: { click: () => inFoto.click() } }, '📷');
    const btnEnviar = h('button', { type: 'submit', class: 'chat-enviar', 'aria-label': 'Enviar' }, '➤');
    const barraEdicion = h('div', { class: 'chat-edicion', hidden: true },
      h('span', null, 'Editando mensaje'),
      h('button', { type: 'button', class: 'btn-link', on: { click: () => cancelarEdicion() } }, 'Cancelar'));
    const form = h('form', { class: 'chat-form', autocomplete: 'off' }, btnFoto, inFoto, inTexto, btnEnviar);
    const raiz = h('div', { class: 'chat' }, h('h2', { class: 'sub' }, '💬 Chat'), elLista, barraEdicion, form);
    cont.replaceChildren(raiz);

    // ---------- Pintar ----------
    function avatarDe(id) { return g.Perfiles.avatar(perfiles.get(id) || { id, nombre: 'Compañero', foto: null }, 28); }

    function nodoFoto(m) {
      let img = medios.get(m.id);
      if (!img) {
        img = h('img', { class: 'chat-foto', alt: 'Foto (tocá para agrandar)', decoding: 'async', loading: 'lazy', draggable: false, tabindex: '0', role: 'button' });
        img.addEventListener('click', () => abrirVisor(m.id));
        img.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirVisor(m.id); } });
        img.addEventListener('error', () => {
          const mm = lista.find((x) => x.id === m.id);
          if (!mm || mm.local || img.dataset.reintento) return;
          img.dataset.reintento = '1'; img.removeAttribute('src'); M.reintentarYa(); firmarYPoner(mm, img);
        });
        img.addEventListener('load', () => { delete img.dataset.reintento; });
        medios.set(m.id, img);
      }
      if (m.ancho && m.alto) img.style.aspectRatio = m.ancho + ' / ' + m.alto;
      img.style.width = m.alto > m.ancho ? 'min(190px, 48vw)' : 'min(250px, 62vw)';
      if (m.local) { if (!img.getAttribute('src')) img.src = m.local; }
      else if (!img.getAttribute('src') || !M.vigente(M.rutaMini(m.archivo))) firmarYPoner(m, img);
      return img;
    }
    async function firmarYPoner(m, img) {
      const ruta = M.rutaMini(m.archivo);
      try {
        await M.firmar(sb, [ruta]);
        const url = M.firmada(ruta);
        if (url && !cerrado && url !== img.getAttribute('src')) img.src = url;
      } catch (e) { /* sin red: se reintenta al volver la señal o la app */ }
    }

    function menuMensaje(m) {
      const items = [];
      if (L.puedeEditar(m, yo)) items.push(h('button', { type: 'button', class: 'btn-sec btn-chico', on: { click: () => empezarEdicion(m.id) } }, 'Editar'));
      items.push(confirmandoId === m.id
        ? h('button', { type: 'button', class: 'btn-peligro btn-chico', on: { click: () => eliminar(m.id) } }, 'Tocá de nuevo para eliminar')
        : h('button', { type: 'button', class: 'btn-peligro btn-chico', on: { click: () => { confirmandoId = m.id; pintar(); } } }, 'Eliminar'));
      return h('div', { class: 'chat-menu' }, items);
    }

    function filaMensaje(m) {
      const mio = m.autor === yo;
      const eliminado = m.tipo === 'eliminado';
      const hora = h('span', { class: 'chat-hora' }, (m.editado && !eliminado ? 'Editado · ' : '') + (m.subiendo ? 'Enviando…' : L.horaCorta(m.creado)));
      let cuerpo;
      if (eliminado) cuerpo = h('div', { class: 'chat-txt' }, L.resumen(m));
      else if (m.tipo === 'foto') cuerpo = nodoFoto(m);
      else cuerpo = h('div', { class: 'chat-txt' }, m.texto || '');
      const burbuja = h('div', { class: 'chat-burbuja' + (eliminado ? ' eliminado' : '') + (m.tipo === 'foto' && !eliminado ? ' media' : '') + (m.subiendo ? ' subiendo' : '') }, cuerpo, hora);
      if (mio && !eliminado && !esTmp(m)) {
        burbuja.append(h('button', { type: 'button', class: 'chat-mas-acc', 'aria-label': 'Opciones del mensaje', 'aria-expanded': menuId === m.id ? 'true' : 'false',
          on: { click: () => { menuId = menuId === m.id ? null : m.id; confirmandoId = null; pintar(); } } }, '⋯'));
      }
      const col = h('div', { class: 'chat-col' }, !mio && h('span', { class: 'chat-autor' }, nombreDe(m.autor)), burbuja, mio && menuId === m.id && menuMensaje(m));
      return h('div', { class: 'chat-msg ' + (mio ? 'mio' : 'otro'), 'data-id': m.id }, !mio && avatarDe(m.autor), col);
    }

    function pintar() {
      if (cerrado) return;
      const alFondo = elLista.scrollHeight - elLista.scrollTop - elLista.clientHeight < 120;
      elLista.replaceChildren();
      if (estado === 'cargando' && !lista.length) { elLista.append(h('p', { class: 'vacio' }, 'Cargando…')); return; }
      if (estado === 'error' && !lista.length) {
        elLista.append(h('div', { class: 'vacio' }, h('p', null, 'No pudimos cargar el chat.'),
          h('button', { type: 'button', id: 'chat-reintentar', class: 'btn-sec btn-chico', on: { click: () => { estado = 'cargando'; pintar(); sincronizar(); } } }, 'Reintentar')));
        return;
      }
      if (hayMas) elLista.append(h('button', { type: 'button', class: 'btn-link chat-anteriores', disabled: cargandoMas, on: { click: cargarMas } }, cargandoMas ? 'Cargando…' : 'Ver mensajes anteriores'));
      if (!lista.length) elLista.append(h('p', { class: 'vacio' }, 'Todavía no hay mensajes. ¡Escribí el primero!'));
      lista.forEach((m) => elLista.append(filaMensaje(m)));
      if (alFondo) elLista.scrollTop = elLista.scrollHeight;
    }

    // ---------- Datos ----------
    async function asegurarPerfiles(ms) {
      const faltan = [...new Set(ms.map((m) => m.autor))].filter((id) => id && !perfiles.has(id));
      if (!faltan.length) return;
      const { data } = await sb.from('perfiles').select('id, nombre, foto').in('id', faltan);
      (data || []).forEach((p) => perfiles.set(p.id, p));
      await g.Perfiles.prepararAvatares(data || [], sb).catch(() => {});
    }

    // Trae la última página y la reconcilia con lo que hay: sirve para la carga inicial y para
    // ponerse al día después de una reconexión (los mensajes llegados con el socket caído aparecen, sin duplicar).
    // Mete un mensaje (respuesta propia o evento) en la lista. Si hay una sincronización en vuelo, lo anota
    // para que la reconciliación no lo pierda.
    function meter(m) {
      lista = L.fusionar(lista, m);
      if (llegados) llegados.add(m.id);
    }

    function sincronizar() {
      if (enVuelo) return enVuelo;
      llegados = new Set(); pendientes = new Map();
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
          estado = 'ok';
        } catch (e) {
          if (!cerrado && estado !== 'ok') estado = 'error';
        } finally { enVuelo = null; llegados = null; pendientes = null; if (!cerrado) pintar(); }
      })();
      return enVuelo;
    }
    async function cargarMas() {
      if (cargandoMas) return;
      const c = L.cursor(lista);
      if (!c) return;
      cargandoMas = true; pintar();
      const alto = elLista.scrollHeight;
      try {
        const { data, error } = await sb.from('mensajes').select(CAMPOS).eq('sala', sala).or(L.filtroAntes(c))
          .order('creado', { ascending: false }).order('id', { ascending: false }).limit(TAM);
        if (cerrado) return;
        if (error) { g.App.toast('No pudimos traer los mensajes anteriores.'); return; }
        await asegurarPerfiles(data);
        if (cerrado) return;
        lista = L.fusionarLote(lista, data);
        hayMas = data.length >= TAM;
      } catch (e) {
        if (!cerrado) g.App.toast('No pudimos traer los mensajes anteriores.');
      } finally {
        cargandoMas = false;
        if (!cerrado) { pintar(); elLista.scrollTop = elLista.scrollHeight - alto; }
      }
    }

    async function alLlegar(payload) {
      const m = payload && payload.new;
      if (!m || m.sala !== sala || cerrado) return; // además del filtro del canal
      const evento = payload.eventType || 'INSERT';
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
      pintar();
    }

    // ---------- Enviar ----------
    function crecer() { inTexto.style.height = 'auto'; inTexto.style.height = Math.min(inTexto.scrollHeight, 130) + 'px'; }
    inTexto.addEventListener('input', crecer);
    inTexto.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !tactil) { e.preventDefault(); form.requestSubmit(); }
    });
    function abajo() { elLista.scrollTop = elLista.scrollHeight; }

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (guardando) return; // la edición anterior todavía está en vuelo
      const t = inTexto.value;
      if (!L.textoValido(t)) return;
      if (editandoId) return guardarEdicion(t);
      inTexto.value = ''; crecer();
      const tmp = { id: 'tmp-' + Date.now(), sala, autor: yo, tipo: 'texto', texto: t.trim(), creado: new Date().toISOString(), subiendo: true };
      lista = L.fusionar(lista, tmp); pintar(); abajo();
      const { data, error } = await sb.from('mensajes').insert({ sala, tipo: 'texto', texto: t.trim() }).select(CAMPOS).single();
      lista = L.quitar(lista, tmp.id);
      if (error) {
        if (!cerrado) { if (!inTexto.value) { inTexto.value = t; crecer(); } g.App.toast('No pudimos mandar el mensaje. Probá de nuevo.'); pintar(); }
        return;
      }
      meter(data); pintar(); abajo();
    });

    inFoto.addEventListener('change', () => { const f = inFoto.files && inFoto.files[0]; inFoto.value = ''; enviarFoto(f); });
    async function enviarFoto(file) {
      if (!file) return;
      if (editandoId) { g.App.toast('Terminá o cancelá la edición primero.'); return; }
      const tmp = { id: 'tmp-f' + Date.now(), sala, autor: yo, tipo: 'foto', creado: new Date().toISOString(), subiendo: true, local: URL.createObjectURL(file), ancho: 4, alto: 3 };
      locales.add(tmp.local);
      lista = L.fusionar(lista, tmp); pintar(); abajo();
      const quitarTmp = () => { lista = L.quitar(lista, tmp.id); medios.delete(tmp.id); pintar(); };
      let c, mini;
      try { c = await M.comprimirImagen(file, 1600, 0.8); mini = await M.comprimirImagen(file, 480, 0.7); }
      catch (e) { quitarTmp(); g.App.toast('No pudimos leer esa foto. Probá con otra.'); return; }
      tmp.ancho = c.ancho; tmp.alto = c.alto; pintar();
      const archivo = L.rutaArchivo(sala, 'foto', crypto.randomUUID()), archivoMini = M.rutaMini(archivo);
      try {
        const up = await sb.storage.from(M.BUCKET).upload(archivo, c.blob, { contentType: c.tipo });
        if (up.error) throw up.error;
        const upMini = await sb.storage.from(M.BUCKET).upload(archivoMini, mini.blob, { contentType: mini.tipo });
        if (upMini.error) { borrarArchivos([archivo]); throw upMini.error; }
        const { data, error } = await sb.from('mensajes').insert({ sala, tipo: 'foto', archivo, ancho: c.ancho, alto: c.alto }).select(CAMPOS).single();
        if (error) { borrarArchivos([archivo, archivoMini]); throw error; }
        medios.delete(tmp.id);
        lista = L.quitar(lista, tmp.id); meter(data); pintar(); abajo();
      } catch (e) {
        quitarTmp(); g.App.toast('No pudimos mandar la foto. Revisá la conexión y probá de nuevo.');
      }
    }

    // ---------- Editar y eliminar lo propio ----------
    function empezarEdicion(id) {
      const m = lista.find((x) => x.id === id);
      if (!m || !L.puedeEditar(m, yo)) return;
      editandoId = id; menuId = null; confirmandoId = null;
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
          g.App.toast(error.code === 'P0002' ? 'Ya no se puede editar este mensaje.' : 'No pudimos editar el mensaje. Probá de nuevo.');
          if (error.code === 'P0002') cancelarEdicion();
          return;
        }
        if (editandoId === id) cancelarEdicion();
        const fila = Array.isArray(data) ? data[0] : data;
        if (fila) { meter(fila); pintar(); }
      } catch (e) {
        if (!cerrado) g.App.toast('No pudimos editar el mensaje. Probá de nuevo.');
      } finally { guardando = false; btnEnviar.disabled = false; }
    }
    // Borra de Storage la foto y su miniatura; si falla, reintenta una vez y deja aviso en la consola.
    async function borrarArchivos(paths) {
      const intentar = async () => { const r = await sb.storage.from(M.BUCKET).remove(paths); if (r && r.error) throw r.error; };
      try { await intentar(); } catch (e1) {
        try { await intentar(); } catch (e2) { console.warn('chat: no se pudieron borrar archivos de Storage', paths, e2); }
      }
    }
    async function eliminar(id) {
      confirmandoId = null; menuId = null;
      const { data, error } = await sb.rpc('eliminar_mensaje', { p_id: id });
      if (error) { g.App.toast('No pudimos eliminar el mensaje. Probá de nuevo.'); pintar(); return; }
      if (editandoId === id) cancelarEdicion();
      medios.delete(id);
      if (data && data.fila) meter(data.fila); else lista = lista.map((m) => (m.id === id ? { ...m, tipo: 'eliminado', texto: null, archivo: null } : m));
      pintar();
      if (data && data.archivo_antes) borrarArchivos([data.archivo_antes, M.rutaMini(data.archivo_antes)]);
    }

    // ---------- Visor de fotos ----------
    async function abrirVisor(id) {
      const m = lista.find((x) => x.id === id);
      if (!m || m.tipo !== 'foto') return;
      let url = m.local || M.firmada(m.archivo);
      if (!url) { try { await M.firmar(sb, [m.archivo]); url = M.firmada(m.archivo); } catch (e) { /* sin red */ } }
      if (!url) { g.App.toast('No pudimos abrir la foto. Revisá la conexión.'); return; }
      if (cerrado) return;
      cerrarVisor(false);
      focoAntes = medios.get(id) || document.activeElement;
      const x = h('button', { type: 'button', class: 'chat-visor-x', 'aria-label': 'Cerrar', on: { click: (e) => { e.stopPropagation(); cerrarVisor(); } } }, '✕');
      visor = h('div', { class: 'chat-visor', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Foto', on: { click: () => cerrarVisor() } }, h('img', { src: url, alt: 'Foto' }), x);
      document.body.append(visor);
      document.addEventListener('keydown', teclaVisor, true);
      x.focus();
    }
    function teclaVisor(e) {
      if (!visor) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrarVisor(); }
      else if (e.key === 'Tab') { e.preventDefault(); visor.querySelector('.chat-visor-x').focus(); } // el ✕ es lo único enfocable
    }
    function cerrarVisor(devolverFoco = true) {
      if (!visor) return;
      visor.remove(); visor = null;
      document.removeEventListener('keydown', teclaVisor, true);
      const f = focoAntes; focoAntes = null;
      if (devolverFoco && f && f.isConnected && typeof f.focus === 'function') f.focus();
    }

    // ---------- Realtime (nada de polling): al (re)conectar se pone al día ----------
    const alVolver = () => { if (!document.hidden) { M.reintentarYa(); sincronizar(); } };
    document.addEventListener('visibilitychange', alVolver);
    g.addEventListener('online', alVolver);
    // topic único por apertura: realtime.channel() reutiliza un canal con el mismo topic mientras el anterior
    // todavía se está yendo ("leaving"), y reabrir enseguida dejaría el chat sin tiempo real.
    const filtro = 'sala=eq.' + sala; // además del filtro del cliente en alLlegar
    canal = sb.channel('chat-' + sala + '-' + crypto.randomUUID())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensajes', filter: filtro }, alLlegar)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'mensajes', filter: filtro }, alLlegar)
      .subscribe((st) => { if (st === 'SUBSCRIBED') sincronizar(); });

    pintar();
    sincronizar();

    return function cerrar() {
      if (cerrado) return;
      cerrado = true;
      document.removeEventListener('visibilitychange', alVolver);
      g.removeEventListener('online', alVolver);
      if (canal) sb.removeChannel(canal);
      cerrarVisor();
      locales.forEach((u) => URL.revokeObjectURL(u));
      if (cont.contains(raiz)) cont.replaceChildren();
    };
  }

  g.Chat = { abrir };
})(window);
