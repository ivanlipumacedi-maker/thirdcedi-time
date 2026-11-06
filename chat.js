// Chat grupal por sala ('act:<uuid>' / 'par:<uuid>'): texto y fotos, editar y eliminar lo propio, en vivo con Realtime.
// Chat.abrir(contenedor, sala) devuelve la función que cierra el chat y baja la suscripción. Necesita ChatLogica, ChatMedios y Perfiles.
(function (g) {
  const L = g.ChatLogica;
  const M = g.ChatMedios;
  const TAM = 50;
  const CAMPOS = 'id,sala,autor,tipo,texto,archivo,ancho,alto,editado,creado';
  const perfiles = new Map(); // id -> { id, nombre, foto }, compartido entre chats abiertos

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
    let canal = null;
    let visor = null;
    const medios = new Map();         // id -> <img> reutilizada entre redibujos
    const locales = new Set();        // blob: URLs a soltar al cerrar

    const nombreDe = (id) => (perfiles.get(id) || {}).nombre || 'Compañero';
    const esTmp = (m) => String(m.id).startsWith('tmp-');

    // ---------- Estructura ----------
    const elLista = h('div', { class: 'chat-lista', role: 'log', 'aria-live': 'polite', 'aria-label': 'Mensajes' });
    const inTexto = h('textarea', { class: 'chat-texto', rows: 1, maxLength: L.MAX_TEXTO, placeholder: 'Escribí un mensaje', 'aria-label': 'Mensaje', enterKeyHint: tactil ? 'enter' : 'send' });
    const inFoto = h('input', { type: 'file', accept: 'image/*', hidden: true, id: 'chat-foto-' + Math.random().toString(36).slice(2) });
    const btnFoto = h('label', { class: 'chat-adj', for: inFoto.id, 'aria-label': 'Mandar una foto', role: 'button', tabindex: '0' }, '📷');
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
        img = h('img', { class: 'chat-foto', alt: 'Foto', decoding: 'async', loading: 'lazy', draggable: false });
        img.addEventListener('click', () => abrirVisor(m.id));
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
      if (hayMas) elLista.append(h('button', { type: 'button', class: 'btn-link chat-anteriores', on: { click: cargarMas } }, 'Ver mensajes anteriores'));
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
    function sincronizar() {
      if (enVuelo) return enVuelo;
      enVuelo = (async () => {
        try {
          const { data, error } = await sb.from('mensajes').select(CAMPOS).eq('sala', sala).order('creado', { ascending: false }).limit(TAM);
          if (error) throw error;
          if (cerrado) return;
          await asegurarPerfiles(data);
          const primera = estado !== 'ok';
          const tmps = lista.filter(esTmp);
          lista = L.fusionarLote(L.reconciliar(lista.filter((m) => !esTmp(m)), data, TAM), tmps);
          if (primera) hayMas = data.length >= TAM;
          estado = 'ok';
        } catch (e) {
          if (!cerrado && estado !== 'ok') estado = 'error';
        } finally { enVuelo = null; if (!cerrado) pintar(); }
      })();
      return enVuelo;
    }
    async function cargarMas() {
      const antes = lista.find((m) => !esTmp(m));
      if (!antes) return;
      const alto = elLista.scrollHeight;
      const { data, error } = await sb.from('mensajes').select(CAMPOS).eq('sala', sala).lt('creado', antes.creado).order('creado', { ascending: false }).limit(TAM);
      if (error || cerrado) { if (!cerrado) g.App.toast('No pudimos traer los mensajes anteriores.'); return; }
      await asegurarPerfiles(data);
      lista = L.fusionarLote(lista, data);
      hayMas = data.length >= TAM;
      pintar();
      elLista.scrollTop = elLista.scrollHeight - alto;
    }

    async function alLlegar(payload) {
      const m = payload && payload.new;
      if (!m || m.sala !== sala || cerrado) return;
      await asegurarPerfiles([m]);
      if (cerrado) return;
      lista = L.fusionar(lista, m);
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
      lista = L.fusionar(lista, data); pintar(); abajo();
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
        if (upMini.error) { sb.storage.from(M.BUCKET).remove([archivo]); throw upMini.error; }
        const { data, error } = await sb.from('mensajes').insert({ sala, tipo: 'foto', archivo, ancho: c.ancho, alto: c.alto }).select(CAMPOS).single();
        if (error) { sb.storage.from(M.BUCKET).remove([archivo, archivoMini]); throw error; }
        medios.delete(tmp.id);
        lista = L.fusionar(L.quitar(lista, tmp.id), data); pintar(); abajo();
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
      const id = editandoId;
      const { data, error } = await sb.rpc('editar_mensaje', { p_id: id, p_texto: t });
      if (error) {
        g.App.toast(error.code === 'P0002' ? 'Ya no se puede editar: pasaron los 15 minutos.' : 'No pudimos editar el mensaje. Probá de nuevo.');
        if (error.code === 'P0002') cancelarEdicion();
        return;
      }
      cancelarEdicion();
      const fila = Array.isArray(data) ? data[0] : data;
      if (fila) { lista = L.fusionar(lista, fila); pintar(); }
    }
    async function eliminar(id) {
      confirmandoId = null; menuId = null;
      const { data, error } = await sb.rpc('eliminar_mensaje', { p_id: id });
      if (error) { g.App.toast('No pudimos eliminar el mensaje. Probá de nuevo.'); pintar(); return; }
      if (editandoId === id) cancelarEdicion();
      medios.delete(id);
      if (data && data.fila) lista = L.fusionar(lista, data.fila); else lista = lista.map((m) => (m.id === id ? { ...m, tipo: 'eliminado', texto: null, archivo: null } : m));
      pintar();
      if (data && data.archivo_antes) sb.storage.from(M.BUCKET).remove([data.archivo_antes, M.rutaMini(data.archivo_antes)]);
    }

    // ---------- Visor de fotos ----------
    async function abrirVisor(id) {
      const m = lista.find((x) => x.id === id);
      if (!m || m.tipo !== 'foto') return;
      let url = m.local || M.firmada(m.archivo);
      if (!url) { try { await M.firmar(sb, [m.archivo]); url = M.firmada(m.archivo); } catch (e) { /* sin red */ } }
      if (!url) { g.App.toast('No pudimos abrir la foto. Revisá la conexión.'); return; }
      cerrarVisor();
      visor = h('div', { class: 'chat-visor', role: 'dialog', 'aria-label': 'Foto', on: { click: cerrarVisor } }, h('img', { src: url, alt: '' }),
        h('button', { type: 'button', class: 'chat-visor-x', 'aria-label': 'Cerrar', on: { click: cerrarVisor } }, '✕'));
      document.body.append(visor);
    }
    function cerrarVisor() { if (visor) { visor.remove(); visor = null; } }

    // ---------- Realtime (nada de polling): al (re)conectar se pone al día ----------
    const alVolver = () => { if (!document.hidden) { M.reintentarYa(); sincronizar(); } };
    document.addEventListener('visibilitychange', alVolver);
    g.addEventListener('online', alVolver);
    canal = sb.channel('chat-' + sala)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensajes' }, alLlegar)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'mensajes' }, alLlegar)
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
