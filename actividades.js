// Pantalla Actividades: lista con chips por tipo, detalle con "Voy" / "Voy al tercer tiempo", formulario y realtime.
(function (g) {
  const L = g.ActividadesLogica;
  const ZONA = 'America/Argentina/Buenos_Aires';
  let actividades = [];
  let asistencias = [];
  let perfiles = new Map();
  let filtro = 'todas';
  let vista = { tipo: 'lista' };  // { tipo:'lista' } | { tipo:'detalle', id } | { tipo:'form', id|null }
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
    hijos.flat().forEach((c) => { if (c != null && c !== false) el.append(c); });
    return el;
  }

  const tipoDe = (id) => L.TIPOS.find((t) => t.id === id) || L.TIPOS[5];
  function nombreTipo(a) { return a.tipo === 'otra' && a.tipo_otro ? a.tipo_otro : tipoDe(a.tipo).nombre; }
  function fmt(iso) {
    return new Date(iso).toLocaleString('es-AR', { timeZone: ZONA, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  }
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
    cerrarChat();
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
    const antes = { scroll: lch ? lch.scrollTop : 0, foco: !!(chatEl && chatEl.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') };
    r.textContent = '';
    if (!g.App.yo()) { cerrarChat(); return; }
    if (vista.tipo === 'detalle') {
      const a = actividades.find((x) => x.id === vista.id);
      if (a) {
        r.append(...detalle(a));
        // el chat sigue vivo entre repintados: se recupera dónde estaba el scroll y el foco del teclado
        const nl = chatEl && chatEl.querySelector('.chat-lista');
        if (nl && chatEl.isConnected) { nl.scrollTop = antes.scroll; if (antes.foco) chatEl.querySelector('textarea').focus({ preventScroll: true }); }
        return;
      }
      vista = { tipo: 'lista' };
    }
    cerrarChat();
    if (vista.tipo === 'form') { vista.nuevoRender = false; r.append(formulario(vista.id ? actividades.find((x) => x.id === vista.id) : null)); return; }
    r.append(...lista());
  }
  function cerrarChat() {
    if (chatCerrar) chatCerrar();
    chatCerrar = null; chatEl = null; chatSala = null;
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

  function tarjeta(a) {
    const t = tipoDe(a.tipo);
    const anotados = L.participantes(a.id, asistencias, 'actividad').length;
    const cupoTxt = a.cupo != null ? anotados + '/' + a.cupo + ' anotados' : anotados + (anotados === 1 ? ' anotado' : ' anotados');
    return h('button', { type: 'button', class: 'tarjeta-act' + (a.estado === 'cancelada' ? ' cancelada' : ''), on: { click: () => irA({ tipo: 'detalle', id: a.id }) } },
      h('span', { class: 'tarjeta-emoji', 'aria-hidden': 'true' }, t.emoji),
      h('span', { class: 'tarjeta-cuerpo' },
        h('span', { class: 'tarjeta-titulo' }, a.titulo),
        h('span', { class: 'tarjeta-meta' }, fmt(a.fecha) + ' · ' + a.lugar),
        h('span', { class: 'tarjeta-badges' },
          badge(nombreTipo(a)),
          a.estado === 'confirmada' && badge('Confirmada', 'ok'),
          a.estado === 'cancelada' && badge('Cancelada', 'mal'),
          a.tiene_tercer && badge('Con tercer tiempo', 'acento'),
          badge(cupoTxt))));
  }

  function lista() {
    const ahora = Date.now();
    const visibles = actividades.filter((a) => filtro === 'todas' || a.tipo === filtro);
    const proximas = visibles.filter((a) => L.esFutura(a, ahora)).sort((x, y) => Date.parse(x.fecha) - Date.parse(y.fecha));
    const pasadas = visibles.filter((a) => !L.esFutura(a, ahora)).sort((x, y) => Date.parse(y.fecha) - Date.parse(x.fecha));
    const chip = (id, texto) => h('button', { type: 'button', class: 'chip' + (filtro === id ? ' activo' : ''), 'aria-pressed': filtro === id ? 'true' : 'false', on: { click: () => { filtro = id; pintar(); } } }, texto);
    const out = [
      h('div', { class: 'fila-titulo' }, h('h1', null, 'Actividades'),
        h('button', { type: 'button', id: 'btn-nueva-act', class: 'btn-primario btn-chico', on: { click: () => irA({ tipo: 'form', id: null }) } }, '+ Nueva')),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtrar por tipo' }, chip('todas', 'Todas'), L.TIPOS.map((t) => chip(t.id, t.emoji + ' ' + t.nombre))),
    ];
    if (!cargado && estadoCarga === 'error') {
      out.push(h('div', { class: 'vacio', role: 'alert' }, h('p', null, 'No pudimos cargar las actividades.'),
        h('button', { type: 'button', id: 'act-reintentar', class: 'btn-sec btn-chico', on: { click: () => { estadoCarga = 'cargando'; pintar(); refrescar(); } } }, 'Reintentar')));
      return out;
    }
    if (!cargado) { out.push(h('p', { class: 'vacio' }, 'Cargando…')); return out; }
    if (!proximas.length) out.push(h('p', { class: 'vacio' }, filtro === 'todas' ? 'Todavía no hay actividades próximas. ¡Armá la primera!' : 'No hay actividades próximas de este tipo.'));
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

    const out = [
      h('button', { type: 'button', class: 'btn-link', on: { click: () => irA({ tipo: 'lista' }) } }, '← Volver'),
      h('h1', null, t.emoji + ' ' + a.titulo),
      h('p', { class: 'tarjeta-badges' }, badge(nombreTipo(a)), a.estado === 'confirmada' && badge('Confirmada', 'ok'), cancelada && badge('Cancelada', 'mal'), a.tiene_tercer && badge('Con tercer tiempo', 'acento')),
      h('p', { class: 'dato' }, h('strong', null, 'Cuándo: '), fmt(a.fecha)),
      h('p', { class: 'dato' }, h('strong', null, 'Dónde: '), a.lugar),
      h('p', { class: 'dato' }, h('strong', null, 'Organiza: '), perfilDe(a.creador).nombre),
      a.descripcion && h('p', { class: 'dato desc' }, a.descripcion),
      h('h2', { class: 'sub' }, 'La actividad (' + enAct.length + (a.cupo != null ? '/' + a.cupo : '') + ')'),
      cancelada ? h('p', { class: 'ayuda' }, 'Esta actividad fue cancelada.')
        : h('button', { type: 'button', id: 'btn-voy', class: voy ? 'btn-sec btn-ancho' : 'btn-primario btn-ancho', disabled: !voy && lleno, on: { click: alternar('actividad', voy) } }, voy ? 'Ya no voy' : (lleno ? 'Cupo completo' : 'Voy')),
      anotadosLista(enAct),
    ];
    if (a.tiene_tercer) {
      out.push(
        h('h2', { class: 'sub' }, '🍻 Tercer tiempo (' + enTer.length + ')'),
        h('p', { class: 'dato' }, fmt(a.tercer_fecha) + ' · ' + a.tercer_lugar),
        cancelada ? null : h('button', { type: 'button', id: 'btn-voy-tercer', class: voyTer ? 'btn-sec btn-ancho' : 'btn-primario btn-ancho', on: { click: alternar('tercer', voyTer) } }, voyTer ? 'Ya no voy al tercer tiempo' : 'Voy al tercer tiempo'),
        anotadosLista(enTer));
    }
    out.push(chatDe(a, voy || voyTer));
    if (a.creador === yo && L.editable(a)) {
      out.push(h('h2', { class: 'sub' }, 'Organizar'), h('div', { class: 'fila-botones' },
        h('button', { type: 'button', class: 'btn-sec', on: { click: () => irA({ tipo: 'form', id: a.id }) } }, 'Editar'),
        a.estado === 'abierta' && h('button', { type: 'button', id: 'btn-confirmar', class: 'btn-sec', on: { click: cambiarEstado('confirmada', 'Actividad confirmada') } }, 'Confirmar'),
        confirmando === 'cancelar'
          ? h('button', { type: 'button', id: 'btn-cancelar', class: 'btn-peligro', on: { click: cambiarEstado('cancelada', 'Actividad cancelada') } }, 'Tocá de nuevo para cancelar')
          : h('button', { type: 'button', id: 'btn-cancelar', class: 'btn-peligro', on: { click: () => { confirmando = 'cancelar'; pintar(); } } }, 'Cancelar actividad')));
    } else if (L.reactivable(a, Date.now(), yo)) {
      // vuelve a 'abierta' con los mismos anotados y el chat (la cancelación no borra nada); la base exige lo mismo
      out.push(h('h2', { class: 'sub' }, 'Organizar'), h('div', { class: 'fila-botones' },
        h('button', { type: 'button', id: 'btn-reactivar', class: 'btn-sec', on: { click: cambiarEstado('abierta', 'Actividad reactivada') } }, 'Reactivar')));
    }
    return out;
  }

  const MSG_CANCELADA = 'Esta actividad está cancelada: no se puede editar mientras no se reactive.';
  function formulario(a) {
    const editando = !!a;
    if (editando && !L.editable(a)) {
      return h('div', { class: 'form-act paso' },
        h('button', { type: 'button', class: 'btn-link', on: { click: () => irA({ tipo: 'detalle', id: a.id }) } }, '← Volver'),
        h('h1', null, 'Editar actividad'),
        h('p', { id: 'act-no-editable', class: 'ayuda', role: 'alert' }, MSG_CANCELADA));
    }
    const v = a || { tipo: 'futbol', tiene_tercer: false };
    const campo = (id, etiqueta, ctrl) => h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), ctrl);
    const selTipo = h('select', { id: 'f-tipo' }, L.TIPOS.map((t) => h('option', { value: t.id, selected: t.id === v.tipo }, t.emoji + ' ' + t.nombre)));
    const inOtro = h('input', { id: 'f-otro', type: 'text', maxLength: 60, value: v.tipo_otro || '', placeholder: '¿Qué actividad es?' });
    const inTitulo = h('input', { id: 'f-titulo', type: 'text', maxLength: 80, value: v.titulo || '', placeholder: 'Ej.: Pádel del jueves' });
    const inFecha = h('input', { id: 'f-fecha', type: 'datetime-local', value: L.aInputArg(v.fecha) });
    const inLugar = h('input', { id: 'f-lugar', type: 'text', maxLength: 120, value: v.lugar || '' });
    const inCupo = h('input', { id: 'f-cupo', type: 'number', min: '1', step: '1', inputMode: 'numeric', value: v.cupo != null ? String(v.cupo) : '', placeholder: 'Sin límite' });
    const inDesc = h('textarea', { id: 'f-desc', maxLength: 500, rows: 3, value: v.descripcion || '' });
    const chkTer = h('input', { id: 'f-tercer', type: 'checkbox', checked: !!v.tiene_tercer });
    const inTerLugar = h('input', { id: 'f-ter-lugar', type: 'text', maxLength: 120, value: v.tercer_lugar || '', placeholder: 'Ej.: Parrilla de la esquina' });
    const inTerFecha = h('input', { id: 'f-ter-fecha', type: 'datetime-local', value: L.aInputArg(v.tercer_fecha) });
    const bloqueTer = h('div', { class: 'bloque-tercer' }, campo('f-ter-lugar', 'Lugar del tercer tiempo', inTerLugar), campo('f-ter-fecha', 'Cuándo es el tercer tiempo', inTerFecha));
    const bloqueOtro = campo('f-otro', 'Qué actividad es', inOtro);
    const err = h('p', { class: 'error', role: 'alert', hidden: true });
    // Apagar el tercer tiempo quita a sus anotados (lo hace la base): se avisa en la página cuántos antes de guardar.
    let confirmado = false;
    let guardando = false;
    const avisoTxt = h('p', { id: 'aviso-tercer-txt' });
    const aviso = h('div', { id: 'aviso-tercer', class: 'aviso-confirmar', role: 'alert', hidden: true }, avisoTxt,
      h('div', { class: 'fila-botones' },
        h('button', { type: 'button', id: 'btn-confirmar-tercer', class: 'btn-peligro', on: { click: () => { confirmado = true; guardar(); } } }, 'Sí, sacarlo y guardar'),
        h('button', { type: 'button', id: 'btn-dejar-tercer', class: 'btn-sec', on: { click: () => { chkTer.checked = true; sync(); chkTer.focus(); } } }, 'No, dejar el tercer tiempo')));
    const sync = () => { bloqueOtro.hidden = selTipo.value !== 'otra'; bloqueTer.hidden = !chkTer.checked; aviso.hidden = true; confirmado = false; };
    selTipo.addEventListener('change', sync); chkTer.addEventListener('change', sync);
    sync();

    const form = h('form', { class: 'form-act paso', noValidate: true },
      h('button', { type: 'button', class: 'btn-link', on: { click: () => irA(a ? { tipo: 'detalle', id: a.id } : { tipo: 'lista' }) } }, '← Volver'),
      h('h1', null, editando ? 'Editar actividad' : 'Nueva actividad'),
      campo('f-tipo', 'Tipo', selTipo), bloqueOtro,
      campo('f-titulo', 'Título', inTitulo),
      campo('f-fecha', 'Día y hora (hora de Argentina)', inFecha),
      campo('f-lugar', 'Lugar', inLugar),
      campo('f-cupo', 'Cupo (opcional)', inCupo),
      campo('f-desc', 'Descripción (opcional)', inDesc),
      h('label', { class: 'check', for: 'f-tercer' }, chkTer, ' Hay tercer tiempo 🍻'),
      bloqueTer, err, aviso,
      h('button', { type: 'submit', id: 'btn-guardar-act', class: 'btn-primario' }, editando ? 'Guardar cambios' : 'Crear actividad'));

    async function guardar() {
      if (guardando) return;
      const actual = editando ? actividades.find((x) => x.id === a.id) || a : null;
      if (editando && !L.editable(actual)) { err.textContent = MSG_CANCELADA; err.hidden = false; aviso.hidden = true; return; }
      const tercer = chkTer.checked;
      const datos = {
        tipo: selTipo.value,
        tipo_otro: selTipo.value === 'otra' ? inOtro.value.trim() : null,
        titulo: inTitulo.value.trim(),
        fecha: L.desdeInputArg(inFecha.value),
        lugar: inLugar.value.trim(),
        cupo: inCupo.value.trim() === '' ? null : Number(inCupo.value),
        descripcion: inDesc.value.trim(),
        tiene_tercer: tercer,
        tercer_lugar: tercer ? inTerLugar.value.trim() : null,
        tercer_fecha: tercer ? L.desdeInputArg(inTerFecha.value) : null,
      };
      const msg = L.validar(datos);
      err.hidden = !msg; err.textContent = msg || '';
      if (msg) { aviso.hidden = true; return; }
      const quitan = editando ? L.anotadosQueSeQuitan(actual, datos, asistencias) : 0;
      if (quitan && !confirmado) {
        avisoTxt.textContent = 'Si sacás el tercer tiempo, se ' + (quitan === 1 ? 'va a quitar 1 anotado' : 'van a quitar ' + quitan + ' anotados') + ' al tercer tiempo. ¿Lo sacamos igual?';
        aviso.hidden = false;
        aviso.querySelector('#btn-confirmar-tercer').focus();
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
        err.textContent = /cancelada/.test((error && error.message) || '') ? MSG_CANCELADA : 'No pudimos guardar la actividad. Revisá los datos y probá de nuevo.';
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

  g.Actividades = { refrescar };
})(window);
