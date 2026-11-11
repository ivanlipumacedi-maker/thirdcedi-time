// Pantalla Actividades: lista con chips por tipo, detalle con "Voy" / "Voy al tercer tiempo", formulario y realtime.
(function (g) {
  const L = g.ActividadesLogica;
  let actividades = [];
  let asistencias = [];
  let perfiles = new Map();
  let filtro = null;              // tipo elegido en el filtro; null = todas
  let vista = { tipo: 'lista' };  // { tipo:'lista' } | { tipo:'detalle', id } | { tipo:'form', id|null } | { tipo:'todos' } (fotos de todos)
  let canal = null;
  let tRefresco = null;
  let cargado = false;
  let estadoCarga = 'cargando';   // 'cargando' | 'ok' | 'error' (solo importa mientras no hubo una carga buena)
  let enVuelo = null;             // la recarga en curso (una sola a la vez)
  let otraVez = false;            // la pidieron de nuevo con una en vuelo: al terminar se corre una más
  let sesion = 0;                 // sube al cerrar la pantalla: lo que vuelva de una sesión vieja se descarta
  let confirmando = null;         // 'cancelar' mientras se espera el segundo toque
  let chatEl = null;              // contenedor del chat de la actividad abierta (se conserva entre repintados)
  let chatSala = null;
  let chatCerrar = null;
  let cuentasEl = null;           // sección de Cuentas claras de la actividad abierta (se conserva entre repintados)
  let cuentasAct = null;
  let cuentasApi = null;
  let albumEl = null;             // álbum de la actividad abierta (se conserva entre repintados)
  let albumAct = null;
  let albumCerrar = null;

  const raiz = () => document.getElementById('pantalla-actividades');
  const sb = () => g.App.sb;
  const yoId = () => (g.App.yo() ? g.App.yo().id : null);

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
  // Lo que se puede agregar al DOM: sin null, undefined, false ni '' (un "cond && h(...)" o un "cancelada ? null : ..."
  // no tienen que terminar como el texto "null"). Aplana listas anidadas.
  const nodos = (xs) => xs.flat(Infinity).filter((c) => c != null && c !== false && c !== '');

  const tipoDe = (id) => L.TIPOS.find((t) => t.id === id) || L.TIPOS[5];
  function nombreTipo(a) { return a.tipo === 'otra' && a.tipo_otro ? a.tipo_otro : tipoDe(a.tipo).nombre; }
  const ico = (nombre, etiqueta, clase) => g.App.icono(nombre, etiqueta, clase);
  function fmt(iso) {
    return new Date(iso).toLocaleString('es-AR', { timeZone: L.ZONA, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  // Partes de la fecha en hora de Argentina: { dia: 'sáb', num: '7', mes: 'nov', hora: '21:00' }
  function partes(iso) {
    const d = new Date(iso);
    const p = (o) => d.toLocaleString('es-AR', { timeZone: L.ZONA, ...o }).replace('.', '');
    return { dia: p({ weekday: 'short' }), num: p({ day: 'numeric' }), mes: p({ month: 'short' }), hora: p({ hour: '2-digit', minute: '2-digit', hour12: false }) };
  }
  const fechaLarga = (iso) => { const f = partes(iso); return f.dia + ' ' + f.num + ' de ' + f.mes; };
  const volverBtn = (fn) => h('button', { type: 'button', class: 'btn-link btn-volver', on: { click: fn } }, ico('volver'), 'Volver');
  const perfilDe = (id) => perfiles.get(id) || { id, nombre: 'Compañero', foto: null };

  // ---------- Datos ----------
  async function cargar(mia) {
    const [a, s, p] = await Promise.all([
      sb().from('actividades').select('*').order('fecha', { ascending: true }),
      sb().from('asistencias').select('actividad, persona, parte'),
      sb().from('perfiles').select('id, nombre, foto, empresa'),
    ]);
    if (a.error || s.error || p.error) throw (a.error || s.error || p.error);
    if (mia !== sesion) return; // la pantalla se cerró mientras tanto
    actividades = a.data; asistencias = s.data;
    perfiles = new Map(p.data.map((x) => [x.id, x]));
    await g.Perfiles.prepararAvatares(p.data, sb()).catch(() => {});
    if (mia !== sesion) return;
    cargado = true; estadoCarga = 'ok';
  }
  const abierta = () => !!canal && !!g.App.yo();
  // Recarga todo y repinta. Si la piden con otra en vuelo (p. ej. SUBSCRIBED mientras corre la carga inicial),
  // esa no alcanza: su consulta pudo salir antes de un cambio que tampoco llegó en vivo. Se marca otraVez y, al
  // terminar, se corre una sola más (varias llamadas durante el vuelo se juntan en esa). Con la pantalla cerrada
  // no se lee nada. Quien espera la promesa la ve resolverse con todo ya al día (repetición incluida).
  // Si falla: con datos ya cargados queda lo último; si nunca cargó, se muestra el error con "Reintentar".
  function refrescar() {
    if (!abierta()) return Promise.resolve();
    if (enVuelo) { otraVez = true; return enVuelo; }
    const mia = sesion;
    enVuelo = (async () => {
      try {
        do {
          otraVez = false;
          try { await cargar(mia); } catch (e) { if (mia === sesion && !cargado) estadoCarga = 'error'; }
        } while (otraVez && mia === sesion && abierta());
      } finally {
        if (mia === sesion) { enVuelo = null; otraVez = false; if (abierta()) pintar(); }
      }
    })();
    return enVuelo;
  }
  // Los eventos de Realtime llegan en ráfaga (anotarse toca asistencias; confirmar toca actividades): se agrupan.
  function programarRefresco() {
    clearTimeout(tRefresco);
    tRefresco = setTimeout(refrescar, 120);
  }
  function suscribir() {
    if (canal || !sb()) return;
    // topic único por suscripción: channel() reutiliza un canal con el mismo topic mientras el anterior se está yendo
    const c = sb().channel('actividades-vivo-' + crypto.randomUUID())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'actividades' }, programarRefresco)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'asistencias' }, programarRefresco);
    canal = c;
    // al (re)conectar se pone al día: lo que cambió con el socket caído no llegó en vivo
    c.subscribe((st) => { if (st === 'SUBSCRIBED' && canal === c) refrescar(); });
  }
  function desuscribir() {
    if (canal && sb()) sb().removeChannel(canal);
    cerrarAnexos();
    canal = null; cargado = false; actividades = []; asistencias = []; vista = { tipo: 'lista' };
    sesion++; enVuelo = null; otraVez = false; estadoCarga = 'cargando';
    clearTimeout(tRefresco);
  }

  // ---------- Vistas ----------
  function pintar() {
    const r = raiz();
    if (!r) return;
    // el formulario no se repinta por eventos en vivo: se perdería lo que la persona está escribiendo
    // (salvo que la actividad que se edita se haya cancelado: ahí se cambia por el aviso de que ya no se puede)
    const editada = vista.tipo === 'form' && vista.id ? actividades.find((x) => x.id === vista.id) : null;
    if (vista.tipo === 'form' && r.querySelector('form.form-act') && !vista.nuevoRender && !(editada && !L.editable(editada))) return;
    const lch = chatEl && chatEl.querySelector('.chat-lista');
    const antes = { scroll: lch ? lch.scrollTop : 0, foco: !!(chatEl && chatEl.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA'),
      focoCu: cuentasEl && cuentasEl.contains(document.activeElement) ? document.activeElement : null };
    r.textContent = '';
    if (!g.App.yo()) { cerrarAnexos(); return; }
    if (vista.tipo === 'detalle') {
      const a = actividades.find((x) => x.id === vista.id);
      if (a) {
        r.append(...nodos(detalle(a)));
        // el chat sigue vivo entre repintados: se recupera dónde estaba el scroll y el foco del teclado
        const nl = chatEl && chatEl.querySelector('.chat-lista');
        if (nl && chatEl.isConnected) { nl.scrollTop = antes.scroll; if (antes.foco) chatEl.querySelector('textarea').focus({ preventScroll: true }); }
        if (antes.focoCu && antes.focoCu.isConnected) antes.focoCu.focus({ preventScroll: true });
        return;
      }
      // abierta desde un aviso antes de la primera carga: se espera (la lista muestra "Cargando…") en vez de soltarla
      if (cargado) vista = { tipo: 'lista' };
    }
    if (vista.tipo === 'todos' && g.Album) { cerrarChat(); cerrarCuentas(); r.append(...nodos(pantallaTodos())); return; }
    cerrarAnexos();
    if (vista.tipo === 'form') { vista.nuevoRender = false; r.append(formulario(vista.id ? actividades.find((x) => x.id === vista.id) : null)); return; }
    r.append(...nodos(lista()));
  }
  function cerrarChat() {
    if (chatCerrar) chatCerrar();
    chatCerrar = null; chatEl = null; chatSala = null;
  }
  function cerrarCuentas() {
    if (cuentasApi) cuentasApi.cerrar();
    cuentasApi = null; cuentasEl = null; cuentasAct = null;
  }
  function cerrarAlbum() {
    if (albumCerrar) albumCerrar();
    albumCerrar = null; albumEl = null; albumAct = null;
  }
  function cerrarAnexos() { cerrarChat(); cerrarCuentas(); cerrarAlbum(); }
  // Álbum de fotos: como el chat, solo para quien está anotado a alguna de las partes. Se abre una vez y se reusa.
  function albumDe(a, anotado) {
    if (!anotado || !g.Album) { cerrarAlbum(); return null; }
    if (albumAct !== a.id) {
      cerrarAlbum();
      albumEl = h('section', { class: 'album', id: 'album-act' });
      albumAct = a.id;
      albumCerrar = g.Album.abrir(albumEl, a.id);
    }
    return albumEl;
  }
  // Cuentas claras: se abre para cualquiera que mire el detalle. La sección se muestra si estás anotado o si figurás
  // en las cuentas (quien se bajó y debe plata la sigue viendo); si no, queda oculta. Se abre una vez y se reusa.
  function cuentasDe(a, enAct, enTer, anotado) {
    if (!g.Cuentas) return null;
    const ctx = { actividad: a, anotados: { actividad: enAct, tercer: enTer }, perfilDe, yo: yoId(), anotado };
    if (cuentasAct !== a.id) {
      cerrarCuentas();
      cuentasEl = h('section', { class: 'cuentas', id: 'cuentas-act' });
      cuentasAct = a.id;
      cuentasApi = g.Cuentas.abrir(cuentasEl, ctx);
    } else cuentasApi.actualizar(ctx);
    return cuentasEl;
  }
  // El chat de la actividad: solo para quien está anotado a alguna de las partes. Se abre una vez y se reusa.
  function chatDe(a, anotado) {
    const sala = 'act:' + a.id;
    if (!anotado || !g.Chat) { cerrarChat(); return null; }
    if (chatSala !== sala) {
      cerrarChat();
      chatEl = h('div', { class: 'chat-cont', id: 'chat-act' });
      chatSala = sala;
      chatCerrar = g.Chat.abrir(chatEl, sala);
    }
    return chatEl;
  }
  function irA(v) { vista = v; if (v.tipo === 'form') vista.nuevoRender = true; confirmando = null; pintar(); }

  function badge(texto, clase) { return h('span', { class: 'badge ' + (clase || '') }, texto); }

  // Tarjeta de la lista: fecha a la izquierda como en un fixture y, si hay tercer tiempo, un talón abajo (perforado).
  function tarjeta(a) {
    const t = tipoDe(a.tipo);
    const anotados = L.participantes(a.id, asistencias, 'actividad').length;
    const cupoTxt = a.cupo != null ? anotados + '/' + a.cupo + ' anotados' : anotados + (anotados === 1 ? ' anotado' : ' anotados');
    const f = partes(a.fecha);
    return h('button', { type: 'button', class: 'tarjeta-act' + (a.estado === 'cancelada' ? ' cancelada' : '') + (a.tiene_tercer ? ' con-talon' : ''), on: { click: () => irA({ tipo: 'detalle', id: a.id }) } },
      h('span', { class: 'tarjeta-principal' },
        h('span', { class: 'tarjeta-fecha' }, h('span', { class: 'tf-dia' }, f.dia), h('span', { class: 'tf-num' }, f.num), h('span', { class: 'tf-mes' }, f.mes)),
        h('span', { class: 'tarjeta-cuerpo' },
          h('span', { class: 'tarjeta-tipo' }, ico(t.icono), nombreTipo(a)),
          h('span', { class: 'tarjeta-titulo' }, a.titulo),
          h('span', { class: 'tarjeta-meta' }, h('span', { class: 'hora' }, f.hora), h('span', { class: 'tm-lugar' }, a.lugar)),
          h('span', { class: 'tarjeta-badges' },
            a.estado === 'confirmada' && badge('Confirmada', 'ok'),
            a.estado === 'cancelada' && badge('Cancelada', 'mal'),
            h('span', { class: 'cupo' }, cupoTxt)))),
      a.tiene_tercer && h('span', { class: 'talon-mini' },
        ico('tercer'), h('span', { class: 'tm-titulo' }, 'Tercer tiempo'),
        h('span', { class: 'hora' }, partes(a.tercer_fecha).hora), h('span', { class: 'tm-lugar' }, a.tercer_lugar)));
  }

  // Filtro por tipo: un control segmentado de una sola fila que funciona como toggle. Sin nada elegido se ven todas;
  // tocar un tipo filtra y tocarlo de nuevo lo desmarca. En el teléfono los tipos no elegidos muestran solo el
  // pictograma (con su nombre para el lector y como title) y el elegido se estira con el nombre; con lugar, todos.
  function elegirFiltro(id) {
    filtro = filtro === id ? null : id;
    pintar();
    const b = raiz().querySelector('.seg[data-tipo="' + id + '"]');
    if (b) b.focus({ preventScroll: true });
  }
  function filtroTipos() {
    const seg = (t) => h('button', { type: 'button', class: 'chip seg' + (filtro === t.id ? ' activo' : ''), 'data-tipo': t.id, 'aria-pressed': filtro === t.id ? 'true' : 'false',
      'aria-label': t.nombre, title: filtro === t.id ? t.nombre + ' (tocá de nuevo para ver todas)' : t.nombre, on: { click: () => elegirFiltro(t.id) } },
    ico(t.icono), h('span', { class: 'seg-txt', 'aria-hidden': 'true' }, t.corto));
    return h('div', { class: 'filtro-tipos' + (filtro ? ' con-filtro' : ''), role: 'group', 'aria-label': 'Filtrar por tipo' },
      h('div', { class: 'segmentos' }, L.TIPOS.map(seg)));
  }
  // "No hay pádel en agenda", "No hay after office en agenda", "No hay otras actividades en agenda"
  const sinTipo = (t) => 'No hay ' + (t.id === 'otra' ? 'otras actividades' : t.nombre.toLowerCase()) + ' en agenda.';

  function lista() {
    const ahora = Date.now();
    const visibles = actividades.filter((a) => !filtro || a.tipo === filtro);
    const proximas = visibles.filter((a) => L.esFutura(a, ahora)).sort((x, y) => Date.parse(x.fecha) - Date.parse(y.fecha));
    const pasadas = visibles.filter((a) => !L.esFutura(a, ahora)).sort((x, y) => Date.parse(y.fecha) - Date.parse(x.fecha));
    const out = [
      h('div', { class: 'fila-titulo' }, h('h1', null, 'Actividades'),
        h('button', { type: 'button', id: 'btn-nueva-act', class: 'btn-primario btn-chico btn-con-ico', on: { click: () => irA({ tipo: 'form', id: null }) } }, ico('mas'), 'Nueva')),
      filtroTipos(),
      g.Album ? h('button', { type: 'button', id: 'btn-fotos-todos', class: 'acceso-todos', on: { click: () => irA({ tipo: 'todos' }) } },
        ico('album'), h('span', null, h('strong', null, 'Fotos de todos'), h('small', null, 'Lo que comparten con la cámara de abajo'))) : null,
    ];
    if (!cargado && estadoCarga === 'error') {
      out.push(h('div', { class: 'vacio', role: 'alert' }, h('p', null, 'No pudimos cargar las actividades.'),
        h('button', { type: 'button', id: 'act-reintentar', class: 'btn-sec btn-chico', on: { click: () => { estadoCarga = 'cargando'; pintar(); refrescar(); } } }, 'Reintentar')));
      return out;
    }
    if (!cargado) { out.push(h('p', { class: 'vacio' }, 'Cargando…')); return out; }
    if (!proximas.length) {
      const t = filtro ? tipoDe(filtro) : null;
      const armar = h('button', { type: 'button', class: t ? 'btn-link' : 'btn-sec btn-chico', on: { click: () => irA({ tipo: 'form', id: null, tipoInicial: t ? t.id : null }) } },
        t ? 'Armar ' + (t.id === 'otra' ? 'otra actividad' : t.nombre.toLowerCase()) : 'Armar una actividad');
      out.push(h('div', { class: 'vacio vacio-act', id: 'act-vacio' }, ico(t ? t.icono : 'actividades', null, 'vacio-ico'),
        h('p', null, t ? sinTipo(t) : 'Todavía no hay actividades próximas. ¡Armá la primera!'),
        t ? h('div', { class: 'vacio-acciones' },
          h('button', { type: 'button', id: 'act-ver-todas', class: 'btn-sec btn-chico', on: { click: () => { filtro = null; pintar(); } } }, 'Ver todas'), armar)
          : armar));
    }
    else out.push(h('div', { class: 'lista-act' }, proximas.map(tarjeta)));
    if (pasadas.length) out.push(h('h2', { class: 'sub' }, 'Anteriores'), h('div', { class: 'lista-act pasadas' }, pasadas.map(tarjeta)));
    return out;
  }

  function anotadosLista(personas) {
    if (!personas.length) return h('p', { class: 'ayuda' }, 'Todavía no se anotó nadie.');
    return h('ul', { class: 'anotados' }, personas.map((id) => {
      const p = perfilDe(id);
      return h('li', null, g.Perfiles.avatar(p, 32), h('span', null, p.nombre + (id === yoId() ? ' (vos)' : '')));
    }));
  }

  async function accion(fn, okMsg) {
    try {
      const { error } = await fn();
      if (error) throw error;
      if (okMsg) g.App.toast(okMsg);
    } catch (e) {
      // los triggers de la base devuelven el motivo en español ("El cupo está completo", "La actividad está cancelada")
      const m = e && e.message && /^(El cupo|La actividad)/.test(e.message) ? e.message : 'No pudimos hacerlo. Probá de nuevo en un momento.';
      g.App.toast(m);
    }
    await refrescar();
  }

  // Compartir la actividad (como en RodaApp): el menú del teléfono; sin él, se copia el texto para pegarlo en WhatsApp
  // el link compartido apunta siempre a la app publicada (aunque se comparta desde una copia de prueba)
  const URL_APP = 'https://ivanlipumacedi-maker.github.io/thirdcedi-time/';
  async function compartir(a, anotados) {
    const t = tipoDe(a.tipo), f = partes(a.fecha);
    const texto = L.textoCompartir(a, {
      tipo: a.tipo === 'otra' ? null : t.nombre,
      cuando: fechaLarga(a.fecha) + ', ' + f.hora,
      cuandoTercer: a.tiene_tercer && a.tercer_fecha ? partes(a.tercer_fecha).hora : null,
      anotados,
      url: URL_APP + '#/actividad/' + a.id,
    });
    if (navigator.share) {
      try { await navigator.share({ text: texto }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(texto); g.App.toast('Copiado: pegalo en WhatsApp'); return; } catch (e) { /* sin portapapeles */ }
    g.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank', 'noopener');
  }

  function botonMaps(nombre, link, id) {
    const m = L.mapsDe(nombre, link);
    // sin link es una búsqueda por nombre (puede no ser exacta): más discreta que "Cómo llegar"
    return m && h('a', { class: 'btn-maps' + (m.conLink ? '' : ' btn-maps-buscar'), id, href: m.href, target: '_blank', rel: 'noopener noreferrer' }, ico('lugar'), m.conLink ? 'Cómo llegar' : 'Ver en Maps');
  }

  function detalle(a) {
    const yo = yoId();
    const cancelada = a.estado === 'cancelada';
    const enAct = L.participantes(a.id, asistencias, 'actividad');
    const enTer = L.participantes(a.id, asistencias, 'tercer');
    const voy = enAct.indexOf(yo) >= 0;
    const voyTer = enTer.indexOf(yo) >= 0;
    const lleno = L.cupoLleno(a, asistencias);
    const t = tipoDe(a.tipo);
    const alternar = (parte, estoy) => () => accion(
      () => (estoy
        ? sb().from('asistencias').delete().eq('actividad', a.id).eq('persona', yo).eq('parte', parte)
        : sb().from('asistencias').insert({ actividad: a.id, parte })),
      estoy ? 'Listo, te bajaste' : '¡Anotado!');
    const cambiarEstado = (estado, msg) => () => { confirmando = null; accion(() => sb().from('actividades').update({ estado }).eq('id', a.id), msg); };

    const f = partes(a.fecha);
    const dato = (icono, etiqueta, valor) => h('div', { class: 'dato-fila' }, ico(icono), h('dt', { class: 'sr' }, etiqueta), h('dd', null, valor));
    // el lugar con su botón a Google Maps: "Cómo llegar" si cargaron el link; si no, "Buscar en Maps" por el nombre
    const lg = L.lugares(a.tipo);
    const lugarCon = (nombre, link, id, etq) => h('span', { class: 'dato-lugar' },
      h('span', null, etq && h('span', { class: 'dato-etq' }, etq + ': '), nombre), botonMaps(nombre, link, id));
    const out = [
      volverBtn(() => irA({ tipo: 'lista' })),
      h('div', { class: 'det-cab' + (cancelada ? ' cancelada' : '') },
        h('p', { class: 'tarjeta-tipo det-tipo' }, ico(t.icono), nombreTipo(a)),
        h('h1', null, a.titulo),
        (a.estado === 'confirmada' || cancelada) && h('p', { class: 'tarjeta-badges' }, a.estado === 'confirmada' && badge('Confirmada', 'ok'), cancelada && badge('Cancelada', 'mal'))),
      h('dl', { class: 'datos' },
        dato('reloj', 'Cuándo', h('span', null, fechaLarga(a.fecha) + ', ', h('span', { class: 'hora' }, f.hora))),
        dato('lugar', lg.corto, lugarCon(a.lugar, a.lugar_link, 'maps-lugar', a.destino ? lg.corto : null)),
        a.destino && dato('lugar', lg.destinoCorto || 'Destino', lugarCon(a.destino, a.destino_link, 'maps-destino', lg.destinoCorto || 'Destino')),
        dato('perfil', 'Organiza', perfilDe(a.creador).nombre)),
      a.descripcion && h('p', { class: 'dato desc' }, a.descripcion),
      !cancelada && h('button', { type: 'button', id: 'btn-compartir', class: 'btn-sec btn-compartir', on: { click: () => compartir(a, enAct.length) } }, ico('enviar'), 'Compartir'),
      h('section', { class: 'parte-act', 'aria-labelledby': 'h-parte-act' },
        h('h2', { class: 'sub', id: 'h-parte-act' }, 'La actividad ', h('span', { class: 'cuenta' }, '(' + enAct.length + (a.cupo != null ? '/' + a.cupo : '') + ')')),
        cancelada ? h('p', { class: 'ayuda' }, 'Esta actividad fue cancelada.')
          : h('button', { type: 'button', id: 'btn-voy', class: voy ? 'btn-sec btn-ancho' : 'btn-primario btn-ancho', disabled: !voy && lleno, on: { click: alternar('actividad', voy) } }, voy ? 'Ya no voy' : (lleno ? 'Cupo completo' : 'Voy')),
        anotadosLista(enAct)),
    ];
    if (a.tiene_tercer) {
      // El tercer tiempo es el talón de la entrada: se anota aparte y tiene su propia hora y lugar.
      const ft = partes(a.tercer_fecha);
      out.push(h('section', { class: 'talon' + (cancelada ? ' cancelada' : ''), id: 'talon-tercer', 'aria-labelledby': 'h-tercer' },
        h('h2', { class: 'sub talon-titulo', id: 'h-tercer' }, ico('tercer', null, 'talon-ico'), 'Tercer tiempo ', h('span', { class: 'cuenta' }, '(' + enTer.length + ')')),
        h('p', { class: 'talon-cuando' }, h('span', { class: 'talon-hora' }, ft.hora),
          h('span', { class: 'talon-donde' }, h('span', { class: 'talon-lugar' }, a.tercer_lugar), h('span', { class: 'talon-dia' }, fechaLarga(a.tercer_fecha)))),
        botonMaps(a.tercer_lugar, a.tercer_link, 'maps-tercer'),
        cancelada ? null : h('button', { type: 'button', id: 'btn-voy-tercer', class: voyTer ? 'btn-sec btn-ancho' : 'btn-primario btn-ancho', on: { click: alternar('tercer', voyTer) } }, voyTer ? 'Ya no voy al tercer tiempo' : 'Voy al tercer tiempo'),
        anotadosLista(enTer)));
    }
    out.push(cuentasDe(a, enAct, enTer, voy || voyTer));
    out.push(albumDe(a, voy || voyTer));
    out.push(chatDe(a, voy || voyTer));
    if (a.creador === yo && L.editable(a)) {
      out.push(h('h2', { class: 'sub' }, 'Organizar'), h('div', { class: 'fila-botones' },
        h('button', { type: 'button', class: 'btn-sec', on: { click: () => irA({ tipo: 'form', id: a.id }) } }, 'Editar'),
        a.estado === 'abierta' && h('button', { type: 'button', id: 'btn-confirmar', class: 'btn-sec', on: { click: cambiarEstado('confirmada', 'Actividad confirmada') } }, 'Confirmar'),
        confirmando === 'cancelar'
          ? h('button', { type: 'button', id: 'btn-cancelar', class: 'btn-peligro', on: { click: cambiarEstado('cancelada', 'Actividad cancelada') } }, 'Tocá de nuevo para cancelar')
          : h('button', { type: 'button', id: 'btn-cancelar', class: 'btn-peligro', on: { click: () => { confirmando = 'cancelar'; pintar(); } } }, 'Cancelar actividad')));
    } else if (L.reactivable(a, Date.now(), yo)) {
      // vuelve a 'abierta' con los mismos anotados y el chat (la cancelación no borra nada); la base exige lo mismo.
      // Si estaba confirmada, no vuelve confirmada: el toast lo recuerda.
      out.push(h('h2', { class: 'sub' }, 'Organizar'), h('div', { class: 'fila-botones' },
        h('button', { type: 'button', id: 'btn-reactivar', class: 'btn-sec', on: { click: cambiarEstado('abierta', 'Actividad reactivada. Si ya está todo listo, confirmala de nuevo.') } }, 'Reactivar')));
    } else if (cancelada && a.creador === yo) {
      // cancelada y ya pasó la fecha de la actividad (aunque el tercer tiempo no): se le explica al creador
      out.push(h('p', { id: 'act-no-reactivable', class: 'ayuda' }, 'La actividad ya empezó: no se puede reactivar.'));
    }
    return out;
  }

  const MSG_CANCELADA = 'Esta actividad está cancelada: no se puede editar mientras no se reactive.';
  function formulario(a) {
    const editando = !!a;
    if (editando && !L.editable(a)) {
      return h('div', { class: 'form-act paso' },
        volverBtn(() => irA({ tipo: 'detalle', id: a.id })),
        h('h1', null, 'Editar actividad'),
        h('p', { id: 'act-no-editable', class: 'ayuda', role: 'alert' }, MSG_CANCELADA));
    }
    const v = a || { tipo: vista.tipoInicial || 'futbol', tiene_tercer: false };
    const campo = (id, etiqueta, ctrl) => h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), ctrl);
    const selTipo = h('select', { id: 'f-tipo' }, L.TIPOS.map((t) => h('option', { value: t.id, selected: t.id === v.tipo }, t.nombre)));
    // el pictograma del tipo elegido, al lado del selector
    const icoTipo = h('span', { class: 'f-tipo-ico' }, ico(tipoDe(v.tipo).icono));
    selTipo.addEventListener('change', () => icoTipo.replaceChildren(ico(tipoDe(selTipo.value).icono)));
    const inOtro = h('input', { id: 'f-otro', type: 'text', maxLength: 60, value: v.tipo_otro || '', placeholder: '¿Qué actividad es?' });
    const inTitulo = h('input', { id: 'f-titulo', type: 'text', maxLength: 80, value: v.titulo || '', placeholder: 'Ej.: Pádel del jueves' });
    const inFecha = h('input', { id: 'f-fecha', type: 'datetime-local', value: L.aInputArg(v.fecha) });
    const inLugar = h('input', { id: 'f-lugar', type: 'text', maxLength: 120, value: v.lugar || '' });
    // el link de Maps de un lugar: se puede pegar el texto entero que copia Maps al compartir (si el nombre está
    // vacío, se completa con el de Maps) y al salir del campo queda solo el link
    const inLink = (id, valor, inNombre, etiqueta) => {
      const el = h('input', { id, type: 'text', inputMode: 'url', autocomplete: 'off', spellcheck: false, maxLength: 2000, value: valor || '',
        placeholder: 'Pegá el link de Maps (opcional)', 'aria-label': etiqueta });
      // el mismo lugar de otra actividad que ya tenía link: se completa solo (la cancha de siempre)
      inNombre.addEventListener('change', () => {
        if (el.value.trim()) return;
        const l = L.linkDeLugarConocido(inNombre.value, actividades);
        if (l) el.value = l;
      });
      // al pegar se lee el portapapeles: un campo de una línea saca los saltos y se perdería qué renglón es el nombre
      el.addEventListener('paste', (e) => {
        const crudo = e.clipboardData && e.clipboardData.getData('text');
        const l = crudo && L.linkMaps(crudo);
        if (!l) return;
        e.preventDefault();
        el.value = l;
        const n = L.nombreCompartido(crudo);
        if (n && !inNombre.value.trim()) inNombre.value = n;
      });
      el.addEventListener('change', () => { const l = L.linkMaps(el.value); if (l) el.value = l; });
      return el;
    };
    const lblLugar = h('label', { for: 'f-lugar' });
    const inLugarLink = inLink('f-lugar-link', v.lugar_link, inLugar, 'Link de Google Maps del lugar');
    const ayudaLink = h('p', { class: 'ayuda ayuda-link' }, 'En Maps tocá Compartir y Copiar, y pegalo acá: así llegan con un toque.');
    const inDestino = h('input', { id: 'f-destino', type: 'text', maxLength: 120, value: v.destino || '' });
    const lblDestino = h('label', { for: 'f-destino' });
    const inDestinoLink = inLink('f-destino-link', v.destino_link, inDestino, 'Link de Google Maps del destino');
    const bloqueDestino = h('div', { class: 'campo' }, lblDestino, inDestino, inDestinoLink);
    const inCupo = h('input', { id: 'f-cupo', type: 'number', min: '1', step: '1', inputMode: 'numeric', value: v.cupo != null ? String(v.cupo) : '', placeholder: 'Sin límite' });
    const inDesc = h('textarea', { id: 'f-desc', maxLength: 500, rows: 3, value: v.descripcion || '' });
    const chkTer = h('input', { id: 'f-tercer', type: 'checkbox', checked: !!v.tiene_tercer });
    const inTerLugar = h('input', { id: 'f-ter-lugar', type: 'text', maxLength: 120, value: v.tercer_lugar || '', placeholder: 'Ej.: Parrilla de la esquina' });
    const inTerFecha = h('input', { id: 'f-ter-fecha', type: 'datetime-local', value: L.aInputArg(v.tercer_fecha) });
    const inTerLink = inLink('f-ter-link', v.tercer_link, inTerLugar, 'Link de Google Maps del tercer tiempo');
    const bloqueTer = h('div', { class: 'bloque-tercer' }, campo('f-ter-lugar', 'Lugar del tercer tiempo', [inTerLugar, inTerLink]), campo('f-ter-fecha', 'Cuándo es el tercer tiempo', inTerFecha));
    const bloqueOtro = campo('f-otro', 'Qué actividad es', inOtro);
    const err = h('p', { class: 'error', role: 'alert', hidden: true });
    // Apagar el tercer tiempo quita a sus anotados (lo hace la base): se avisa en la página cuántos antes de guardar.
    let confirmado = false;
    let guardando = false;
    const avisoTxt = h('p', { id: 'aviso-tercer-txt' });
    // Accesibilidad: al aparecer, el foco va a "No, dejar el tercer tiempo" (la opción que no borra nada: un Enter de
    // más no quita a nadie) y ese botón tiene aria-describedby al texto, así que el lector lee el aviso junto con el
    // foco. Por eso el aviso NO lleva role="alert": con los dos se anunciaría dos veces. Se elige mover el foco porque
    // hace falta igual (el aviso aparece debajo del botón Guardar y quien usa teclado tiene que llegar a la decisión).
    const aviso = h('div', { id: 'aviso-tercer', class: 'aviso-confirmar', hidden: true }, avisoTxt,
      h('div', { class: 'fila-botones' },
        h('button', { type: 'button', id: 'btn-confirmar-tercer', class: 'btn-peligro', on: { click: () => { confirmado = true; guardar(); } } }, 'Sí, sacarlo y guardar'),
        h('button', { type: 'button', id: 'btn-dejar-tercer', class: 'btn-sec', 'aria-describedby': 'aviso-tercer-txt', on: { click: () => { chkTer.checked = true; sync(); chkTer.focus(); } } }, 'No, dejar el tercer tiempo')));
    const sync = () => {
      const lg = L.lugares(selTipo.value);
      lblLugar.textContent = lg.etiqueta; inLugar.placeholder = lg.ejemplo;
      bloqueDestino.hidden = !lg.destino; lblDestino.textContent = lg.destino || ''; inDestino.placeholder = lg.destinoEjemplo || '';
      bloqueOtro.hidden = selTipo.value !== 'otra'; bloqueTer.hidden = !chkTer.checked; aviso.hidden = true; confirmado = false; };
    selTipo.addEventListener('change', sync); chkTer.addEventListener('change', sync);
    sync();

    const form = h('form', { class: 'form-act paso', noValidate: true },
      volverBtn(() => irA(a ? { tipo: 'detalle', id: a.id } : { tipo: 'lista' })),
      h('h1', null, editando ? 'Editar actividad' : 'Nueva actividad'),
      campo('f-tipo', 'Tipo', h('div', { class: 'f-tipo' }, icoTipo, selTipo)), bloqueOtro,
      campo('f-titulo', 'Título', inTitulo),
      campo('f-fecha', 'Día y hora (hora de Argentina)', inFecha),
      h('div', { class: 'campo' }, lblLugar, inLugar, inLugarLink, ayudaLink),
      bloqueDestino,
      campo('f-cupo', 'Cupo (opcional)', inCupo),
      campo('f-desc', 'Descripción (opcional)', inDesc),
      h('div', { class: 'talon talon-form' },
        h('label', { class: 'check', for: 'f-tercer' }, chkTer, ico('tercer'), 'Hay tercer tiempo'),
        bloqueTer),
      err, aviso,
      h('button', { type: 'submit', id: 'btn-guardar-act', class: 'btn-primario' }, editando ? 'Guardar cambios' : 'Crear actividad'));

    async function guardar() {
      if (guardando) return;
      const actual = editando ? actividades.find((x) => x.id === a.id) || a : null;
      if (editando && !L.editable(actual)) { err.textContent = MSG_CANCELADA; err.hidden = false; aviso.hidden = true; return; }
      const tercer = chkTer.checked;
      const conDestino = !!L.lugares(selTipo.value).destino && !!(inDestino.value.trim() || inDestinoLink.value.trim());
      const datos = {
        tipo: selTipo.value,
        tipo_otro: selTipo.value === 'otra' ? inOtro.value.trim() : null,
        titulo: inTitulo.value.trim(),
        fecha: L.desdeInputArg(inFecha.value),
        lugar: inLugar.value.trim(),
        lugar_link: L.leerLink(inLugarLink.value),
        destino: conDestino ? inDestino.value.trim() || null : null,
        destino_link: conDestino ? L.leerLink(inDestinoLink.value) : null,
        cupo: inCupo.value.trim() === '' ? null : Number(inCupo.value),
        descripcion: inDesc.value.trim(),
        tiene_tercer: tercer,
        tercer_lugar: tercer ? inTerLugar.value.trim() : null,
        tercer_fecha: tercer ? L.desdeInputArg(inTerFecha.value) : null,
        tercer_link: tercer ? L.leerLink(inTerLink.value) : null,
      };
      const msg = L.validar(datos);
      err.hidden = !msg; err.textContent = msg || '';
      if (msg) { aviso.hidden = true; return; }
      const quitan = editando ? L.anotadosQueSeQuitan(actual, datos, asistencias) : 0;
      if (quitan && !confirmado) {
        avisoTxt.textContent = 'Si sacás el tercer tiempo, se ' + (quitan === 1 ? 'va a quitar 1 anotado' : 'van a quitar ' + quitan + ' anotados') + ' al tercer tiempo. ¿Lo sacamos igual?';
        aviso.hidden = false;
        aviso.querySelector('#btn-dejar-tercer').focus();
        return;
      }
      aviso.hidden = true;
      guardando = true;
      const q = editando ? sb().from('actividades').update(datos).eq('id', a.id).select().single() : sb().from('actividades').insert(datos).select().single();
      let res;
      try { res = await q; } catch (e) { res = { data: null, error: e }; }
      const { data, error } = res;
      guardando = false; confirmado = false;
      if (error) {
        const m = (error && error.message) || '';
        if (/^El tercer tiempo tiene (gastos|pagos)/.test(m)) {
          // la base no deja sacar el tercer tiempo con cuentas cargadas: se vuelve a prender y se explica por qué
          chkTer.checked = true; sync();
          err.textContent = m + '.'; err.hidden = false;
          return;
        }
        err.textContent = /cancelada/.test(m) ? MSG_CANCELADA : 'No pudimos guardar la actividad. Revisá los datos y probá de nuevo.';
        err.hidden = false; return;
      }
      g.App.toast(editando ? 'Cambios guardados' : 'Actividad creada');
      await refrescar();
      irA({ tipo: 'detalle', id: data.id });
    }
    form.addEventListener('submit', (ev) => { ev.preventDefault(); guardar(); });
    return form;
  }

  // ---------- Arranque ----------
  async function alCambiarPerfil(ev) {
    if (!ev.detail) { desuscribir(); pintar(); return; }
    pintar(); // "Cargando…"
    suscribir();
    await refrescar();
  }
  g.addEventListener('perfil', alCambiarPerfil);

  // ---------- Cámara de la barra de abajo ----------
  // Se abre al toque. La foto va al álbum de la actividad en curso si estás anotado en una sola (de 12 h antes a 4 h
  // después de su hora); si no, al álbum de todos (lo ven todos los miembros y va a Drive en "Fotos de todos").
  // Arriba, "Para: …" deja cambiar el destino: todos o una de tus actividades (las más cercanas a hoy primero).
  const HORA = 3600e3;
  const TODOS = () => (g.Album ? g.Album.TODOS : null);
  function misActividades() {
    const yo = g.App.yo()?.id; if (!yo) return [];
    const ahora = Date.now();
    return actividades
      .filter((a) => a.estado !== 'cancelada' && asistencias.some((s) => s.actividad === a.id && s.persona === yo))
      .filter((a) => Math.abs(new Date(a.fecha).getTime() - ahora) < 30 * 24 * HORA)
      .sort((x, y) => Math.abs(new Date(x.fecha).getTime() - ahora) - Math.abs(new Date(y.fecha).getTime() - ahora));
  }
  let destinoCam = null; // { id, nombre }
  function destinoInicial() {
    const ahora = Date.now();
    const enCurso = misActividades().filter((a) => { const d = new Date(a.fecha).getTime() - ahora; return d > -12 * HORA && d < 4 * HORA; });
    return enCurso.length === 1 ? { id: enCurso[0].id, nombre: enCurso[0].titulo } : { id: TODOS(), nombre: 'Todos' };
  }
  function ponerDestino(d) {
    destinoCam = d;
    g.Camara.destino(d.nombre);
    g.Camara.pendientes(g.Album.pendientes(d.id));
  }
  // el álbum: el de todos o el de la actividad (con su detalle)
  function verAlbum(id) {
    if (location.hash.replace(/^#\/?/, '').split('/')[0] !== 'actividades') history.replaceState(null, '', '#/actividades');
    g.App.ir('actividades');
    irA(id === TODOS() ? { tipo: 'todos' } : { tipo: 'detalle', id });
    requestAnimationFrame(() => document.getElementById(id === TODOS() ? 'album-todos' : 'album-act')?.scrollIntoView({ block: 'start' }));
  }
  let hoja = null;
  function cerrarHoja() { if (!hoja) return; const hj = hoja; hoja = null; hj.close(); hj.remove(); }
  function elegirDestino() {
    cerrarHoja();
    const opcion = (d, icono, detalle) => h('li', null, h('button', { type: 'button', class: 'hoja-act' + (destinoCam && destinoCam.id === d.id ? ' elegida' : ''),
      'aria-current': destinoCam && destinoCam.id === d.id ? 'true' : null, on: { click: () => { cerrarHoja(); ponerDestino(d); } } },
      h('span', { class: 'hoja-ico' }, ico(icono)),
      h('span', { class: 'hoja-txt' }, h('strong', null, d.id === TODOS() ? 'Fotos de todos' : d.nombre), h('span', null, detalle))));
    const fila = (a) => { const f = partes(a.fecha); return opcion({ id: a.id, nombre: a.titulo }, tipoDe(a.tipo).icono, f.dia + ' ' + f.num + ' ' + f.mes + ', ' + f.hora); };
    hoja = h('dialog', { class: 'hoja', 'aria-labelledby': 'hoja-camara-t' },
      h('h2', { id: 'hoja-camara-t' }, '¿A dónde va la foto?'),
      h('ul', null, opcion({ id: TODOS(), nombre: 'Todos' }, 'album', 'La ven todos y va al Drive'), misActividades().slice(0, 8).map(fila)),
      h('button', { type: 'button', class: 'btn-link hoja-cancelar', on: { click: cerrarHoja } }, 'Cancelar'));
    hoja.addEventListener('cancel', (e) => { e.preventDefault(); cerrarHoja(); });
    hoja.addEventListener('click', (e) => { if (e.target === hoja) cerrarHoja(); }); // tocar afuera la cierra
    document.body.appendChild(hoja);
    hoja.showModal();
  }
  async function camaraRapida() {
    if (!g.App.yo() || !g.Album || !g.Camara) return;
    if (!cargado) await refrescar(); // sin actividades cargadas, igual se abre: va al álbum de todos
    destinoCam = cargado ? destinoInicial() : { id: TODOS(), nombre: 'Todos' };
    g.Camara.abrir({
      destino: destinoCam.nombre,
      alSacar: (p, extra) => g.Album.agregarA(destinoCam.id, p, extra),
      alTocarDestino: elegirDestino,
      alTocarUltima: () => { const id = destinoCam.id; g.Camara.cerrar(); setTimeout(() => verAlbum(id), 50); },
    });
    g.Camara.pendientes(g.Album.pendientes(destinoCam.id));
  }

  // ---------- Fotos de todos ----------
  function pantallaTodos() {
    const id = TODOS();
    if (albumAct !== id) {
      cerrarAlbum();
      albumEl = h('section', { class: 'album', id: 'album-todos' });
      albumAct = id;
      albumCerrar = g.Album.abrir(albumEl, id);
    }
    return [volverBtn(() => irA({ tipo: 'lista' })),
      h('h1', { class: 'titulo-ico' }, ico('album'), 'Fotos de todos'),
      h('p', { class: 'ayuda' }, 'Lo que cualquiera comparte con la cámara de abajo. Lo ven todos y se guarda en el Drive.'),
      albumEl];
  }
  // Abre el detalle de una actividad (lo usan los avisos: #/actividad/<id>).
  function abrir(id) { if (id) irA({ tipo: 'detalle', id }); }

  document.querySelector('.pestana-camara')?.addEventListener('click', camaraRapida);

  g.Actividades = { refrescar, abrir, camaraRapida };
})(window);
