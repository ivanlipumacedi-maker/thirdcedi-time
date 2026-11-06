// Pantalla Juegos: lista de partidas (en curso, abiertas, terminadas), "Nueva partida", sala de espera con los
// jugadores en vivo, chat de la partida ('par:<uuid>') y el juego (Trivia en trivia.js; El Impostor en la Task 8).
// Todo se escribe por RPC (dev/supabase/12-juegos.sql); lo que se ve llega por Realtime con resync en SUBSCRIBED.
(function (g) {
  const JUEGOS = {
    trivia: { emoji: '🧠', nombre: 'Trivia', desc: '10 preguntas, 15 segundos cada una. Se puede jugar solo.', minimo: 1 },
    impostor: { emoji: '🕵️', nombre: 'El Impostor', desc: 'De 3 jugadores en adelante. Uno tiene otra palabra: descubrilo.', minimo: 3 },
  };
  const VIGENCIA_ESPERA = 12 * 3600e3;   // una partida abierta más vieja que esto ya no se ofrece para unirse
  const VIGENCIA_TERMINADA = 24 * 3600e3;

  let vista = { tipo: 'lista' };  // { tipo:'lista' } | { tipo:'nueva' } | { tipo:'partida', id }
  let partidas = [];              // lista
  let jugadores = [];             // lista: los de las partidas visibles; partida: los de esa partida
  let actual = null;              // partida abierta
  let mias = [];                  // mis respuestas de la partida abierta
  let perfiles = new Map();
  let desfase = 0;                // ms que el servidor va adelante de este reloj
  let canal = null;
  let canalVista = null;          // a qué vista pertenece el canal
  let tRefresco = null;
  let cargado = false;
  let estadoCarga = 'cargando';
  let enVuelo = null;
  let otraVez = false;
  let sesion = 0;                 // sube al cerrar o al cambiar de vista: lo que vuelva de antes se descarta
  let confirmando = null;         // 'salir' mientras se espera el segundo toque
  let ocupado = false;            // RPC de crear/unirse/arrancar/salir en vuelo
  let chatEl = null, chatSala = null, chatCerrar = null;
  let juegoEl = null, juegoId = null, juegoCtl = null;
  let ultimoMomento = '';         // partida:estado:ronda:fase de lo último pintado (para decidir el scroll)

  const raiz = () => document.getElementById('pantalla-juegos');
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
  const nodos = (xs) => xs.flat(Infinity).filter((c) => c != null && c !== false && c !== '');
  const perfilDe = (id) => perfiles.get(id) || { id, nombre: 'Compañero', foto: null };
  const badge = (texto, clase) => h('span', { class: 'badge ' + (clase || '') }, texto);
  const activosDe = (pid, js) => js.filter((j) => j.partida === pid && !j.se_fue);
  const soyActivo = (pid, js) => activosDe(pid, js).some((j) => j.persona === yoId());
  function hace(iso) {
    const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    if (min < 1) return 'recién';
    if (min < 60) return 'hace ' + min + ' min';
    const hs = Math.round(min / 60);
    return 'hace ' + hs + (hs === 1 ? ' hora' : ' horas');
  }

  // ---------- Datos ----------
  async function asegurarPerfiles(ids, mia) {
    const faltan = [...new Set(ids)].filter((id) => id && !perfiles.has(id));
    if (!faltan.length) return;
    const { data, error } = await sb().from('perfiles').select('id, nombre, foto').in('id', faltan);
    if (error) throw error;
    if (mia !== sesion) return;
    data.forEach((p) => perfiles.set(p.id, p));
    await g.Perfiles.prepararAvatares(data, sb()).catch(() => {});
  }
  async function cargarLista(mia) {
    const [p, j] = await Promise.all([
      sb().from('partidas').select('id, juego, creador, estado, estado_juego, creado').order('creado', { ascending: false }).limit(60),
      sb().from('jugadores').select('partida, persona, puntos, se_fue'),
    ]);
    if (p.error || j.error) throw (p.error || j.error);
    if (mia !== sesion) return;
    await asegurarPerfiles(p.data.map((x) => x.creador).concat(j.data.map((x) => x.persona)), mia);
    if (mia !== sesion) return;
    partidas = p.data; jugadores = j.data;
    cargado = true; estadoCarga = 'ok';
  }
  async function medirDesfase(mia) {
    const t0 = Date.now();
    const { data, error } = await sb().rpc('ahora_ms');
    const t1 = Date.now();
    if (!error && mia === sesion && typeof data === 'number') desfase = data - (t0 + t1) / 2;
  }
  async function cargarPartida(mia, id) {
    const [p, j, r] = await Promise.all([
      sb().from('partidas').select('id, juego, creador, estado, estado_juego, creado').eq('id', id).maybeSingle(),
      sb().from('jugadores').select('partida, persona, puntos, se_fue').eq('partida', id),
      sb().from('respuestas').select('ronda, opcion').eq('partida', id),
    ]);
    if (p.error || j.error || r.error) throw (p.error || j.error || r.error);
    if (mia !== sesion) return;
    if (!p.data) { actual = null; cargado = true; estadoCarga = 'ok'; return; }
    await asegurarPerfiles([p.data.creador].concat(j.data.map((x) => x.persona)), mia);
    if (mia !== sesion) return;
    actual = p.data; jugadores = j.data; mias = r.data;
    cargado = true; estadoCarga = 'ok';
  }
  const abierta = () => !!canal && !!g.App.yo();
  // Mismo patrón que Actividades: una recarga a la vez; si la piden con otra en vuelo, al terminar se corre una más.
  function refrescar() {
    if (!abierta()) return Promise.resolve();
    if (enVuelo) { otraVez = true; return enVuelo; }
    const mia = sesion;
    enVuelo = (async () => {
      try {
        do {
          otraVez = false;
          try {
            if (vista.tipo === 'partida') await cargarPartida(mia, vista.id); else await cargarLista(mia);
          } catch (e) { if (mia === sesion && !cargado) estadoCarga = 'error'; }
        } while (otraVez && mia === sesion && abierta());
      } finally {
        if (mia === sesion) { enVuelo = null; otraVez = false; if (abierta()) pintar(); }
      }
    })();
    return enVuelo;
  }
  function programarRefresco() {
    clearTimeout(tRefresco);
    tRefresco = setTimeout(refrescar, 80);
  }
  function claveVista() { return vista.tipo === 'partida' ? 'par:' + vista.id : 'lista'; }
  function suscribir() {
    if (!sb()) return;
    const clave = claveVista();
    if (canal && canalVista === clave) return;
    if (canal) sb().removeChannel(canal);
    // topic único por suscripción (channel() reutiliza un canal con el mismo topic mientras el anterior se va)
    let c = sb().channel('juegos-' + clave + '-' + crypto.randomUUID());
    if (vista.tipo === 'partida') {
      const id = vista.id;
      c = c.on('postgres_changes', { event: '*', schema: 'public', table: 'partidas', filter: 'id=eq.' + id }, programarRefresco)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'jugadores', filter: 'partida=eq.' + id }, programarRefresco)
        // los DELETE no se filtran en el servidor: llegan todos (solo con la clave) y se miran acá
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'jugadores' }, (ev) => { if (!ev.old || !ev.old.partida || ev.old.partida === id) programarRefresco(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'respuestas', filter: 'partida=eq.' + id }, programarRefresco);
    } else {
      c = c.on('postgres_changes', { event: '*', schema: 'public', table: 'partidas' }, programarRefresco)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'jugadores' }, programarRefresco);
    }
    canal = c; canalVista = clave;
    c.subscribe((st) => { if (st === 'SUBSCRIBED' && canal === c) refrescar(); });
  }
  function desuscribir() {
    if (canal && sb()) sb().removeChannel(canal);
    cerrarChat(); cerrarJuego();
    canal = null; canalVista = null; cargado = false; partidas = []; jugadores = []; actual = null; mias = [];
    vista = { tipo: 'lista' };
    sesion++; enVuelo = null; otraVez = false; estadoCarga = 'cargando'; ocupado = false; confirmando = null;
    clearTimeout(tRefresco);
  }
  // Cambiar de vista cambia qué se lee y a qué se suscribe: lo que vuelva de la vista anterior se descarta.
  function irA(v) {
    const cambia = (v.tipo === 'partida' ? 'par:' + v.id : 'lista') !== claveVista(); // 'nueva' usa los datos de la lista
    vista = v; confirmando = null;
    if (cambia) {
      sesion++; enVuelo = null; otraVez = false; cargado = false; estadoCarga = 'cargando'; clearTimeout(tRefresco);
      if (v.tipo === 'partida') { actual = null; mias = []; jugadores = []; desfase = 0; medirDesfase(sesion).catch(() => {}); }
      pintar();
      if (g.App.yo()) suscribir(); // al quedar SUBSCRIBED carga
      return;
    }
    pintar();
  }

  // ---------- Acciones ----------
  const MSG = /^(La partida|Solo quien|El Impostor|Todavía no|No estás|No hay preguntas)/;
  async function rpc(fn, args) {
    let res;
    try { res = await sb().rpc(fn, args); } catch (e) { res = { data: null, error: e }; }
    if (res.error) {
      const m = res.error.message || '';
      g.App.toast(MSG.test(m) ? m : 'No pudimos hacerlo. Probá de nuevo en un momento.');
    }
    return res;
  }
  async function crear(juego) {
    if (ocupado) return;
    ocupado = true; pintar();
    const { data, error } = await rpc('crear_partida', { p_juego: juego });
    ocupado = false;
    if (error) { pintar(); return; }
    irA({ tipo: 'partida', id: data });
  }
  async function accion(fn, args, okMsg) {
    if (ocupado) return null;
    ocupado = true; confirmando = null; pintar();
    const r = await rpc(fn, args);
    ocupado = false;
    if (!r.error && okMsg) g.App.toast(okMsg);
    await refrescar();
    return r;
  }
  async function salir(p) {
    const r = await accion('salir_partida', { p: p.id }, p.estado === 'espera' && p.creador === yoId() ? 'Partida cancelada' : 'Saliste de la partida');
    if (r && !r.error) irA({ tipo: 'lista' });
  }

  // ---------- Vistas ----------
  function cerrarChat() { if (chatCerrar) chatCerrar(); chatCerrar = null; chatEl = null; chatSala = null; }
  function cerrarJuego() { if (juegoCtl) juegoCtl.cerrar(); juegoCtl = null; juegoEl = null; juegoId = null; }
  function chatDe(p, activo) {
    const sala = 'par:' + p.id;
    if (!activo || !g.Chat) { cerrarChat(); return null; }
    if (chatSala !== sala) {
      cerrarChat();
      chatEl = h('div', { class: 'chat-cont', id: 'chat-par' });
      chatSala = sala;
      chatCerrar = g.Chat.abrir(chatEl, sala);
    }
    return chatEl;
  }
  // El juego en curso (Trivia) se monta una vez por partida y se actualiza con cada cambio: así conserva sus timers.
  function juegoDe(p) {
    const mod = p.juego === 'trivia' ? g.Trivia : g.Impostor;
    if (!mod) { cerrarJuego(); return h('p', { class: 'vacio' }, 'Este juego llega pronto.'); }
    if (juegoId !== p.id) {
      cerrarJuego();
      juegoEl = h('div', { class: 'juego-cont', id: 'juego-' + p.juego });
      juegoId = p.id;
      juegoCtl = mod.montar(juegoEl, {
        yo: yoId,
        perfil: perfilDe,
        desfase: () => desfase,
        responder: (ronda, opcion) => sb().rpc('responder', { p: p.id, p_ronda: ronda, p_opcion: opcion }),
        avanzar: (ronda, fase) => sb().rpc('avanzar_partida', { p: p.id, p_ronda: ronda, p_fase: fase }),
        volver: () => irA({ tipo: 'lista' }),
      });
    }
    juegoCtl.actualizar({ partida: p, jugadores, mias });
    return juegoEl;
  }

  function pintar() {
    const r = raiz();
    if (!r) return;
    const lch = chatEl && chatEl.querySelector('.chat-lista');
    const antes = { scroll: lch ? lch.scrollTop : 0, foco: !!(chatEl && chatEl.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA'), scrollPant: r.parentElement ? r.parentElement.scrollTop : 0 };
    r.textContent = '';
    if (!g.App.yo()) { cerrarChat(); cerrarJuego(); return; }
    if (vista.tipo === 'partida') {
      r.append(...nodos(vistaPartida()));
      const nl = chatEl && chatEl.querySelector('.chat-lista');
      if (nl && chatEl.isConnected) { nl.scrollTop = antes.scroll; if (antes.foco) chatEl.querySelector('textarea').focus({ preventScroll: true }); }
      // misma pantalla (llegó otra respuesta, un mensaje): se queda donde estaba; pregunta o fase nueva: arriba
      const e = (actual && actual.estado_juego) || {};
      const momento = actual ? actual.id + ':' + actual.estado + ':' + (e.ronda || 0) + ':' + (e.fase || '') : '';
      if (r.parentElement) r.parentElement.scrollTop = momento === ultimoMomento ? antes.scrollPant : 0;
      ultimoMomento = momento;
      return;
    }
    cerrarChat(); cerrarJuego();
    r.append(...nodos(vista.tipo === 'nueva' ? vistaNueva() : vistaLista()));
  }

  function tarjeta(p) {
    const j = JUEGOS[p.juego];
    const n = activosDe(p.id, jugadores).length;
    const fin = p.estado === 'terminada';
    return h('button', { type: 'button', class: 'tarjeta-act tarjeta-partida', 'data-id': p.id, on: { click: () => irA({ tipo: 'partida', id: p.id }) } },
      h('span', { class: 'tarjeta-emoji', 'aria-hidden': 'true' }, j.emoji),
      h('span', { class: 'tarjeta-cuerpo' },
        h('span', { class: 'tarjeta-titulo' }, j.nombre + ' de ' + perfilDe(p.creador).nombre),
        h('span', { class: 'tarjeta-meta' }, n + (n === 1 ? ' jugador' : ' jugadores') + ' · ' + hace(p.creado)),
        h('span', { class: 'tarjeta-badges' },
          p.estado === 'espera' && badge('En espera', 'acento'),
          p.estado === 'jugando' && badge('Jugando', 'ok'),
          fin && badge('Terminada'),
          soyActivo(p.id, jugadores) && p.estado !== 'terminada' && badge('Estás adentro'))));
  }

  function vistaLista() {
    const ahora = Date.now();
    const out = [h('div', { class: 'fila-titulo' }, h('h1', null, 'Juegos'),
      h('button', { type: 'button', id: 'btn-nueva-partida', class: 'btn-primario btn-chico', on: { click: () => irA({ tipo: 'nueva' }) } }, '+ Nueva partida'))];
    if (!cargado && estadoCarga === 'error') {
      out.push(h('div', { class: 'vacio', role: 'alert' }, h('p', null, 'No pudimos cargar las partidas.'),
        h('button', { type: 'button', id: 'jue-reintentar', class: 'btn-sec btn-chico', on: { click: () => { estadoCarga = 'cargando'; pintar(); refrescar(); } } }, 'Reintentar')));
      return out;
    }
    if (!cargado) { out.push(h('p', { class: 'vacio' }, 'Cargando…')); return out; }
    const enCurso = partidas.filter((p) => p.estado === 'jugando' && soyActivo(p.id, jugadores));
    const abiertas = partidas.filter((p) => p.estado === 'espera' && ahora - Date.parse(p.creado) < VIGENCIA_ESPERA);
    const terminadas = partidas.filter((p) => p.estado === 'terminada' && p.estado_juego && p.estado_juego.fase === 'final'
      && soyActivo(p.id, jugadores) && ahora - Date.parse(p.creado) < VIGENCIA_TERMINADA).slice(0, 5);
    if (enCurso.length) out.push(h('h2', { class: 'sub' }, 'Tus partidas en curso'), h('div', { class: 'lista-act', id: 'lista-en-curso' }, enCurso.map(tarjeta)));
    out.push(h('h2', { class: 'sub' }, 'Abiertas para unirse'));
    out.push(abiertas.length ? h('div', { class: 'lista-act', id: 'lista-abiertas' }, abiertas.map(tarjeta))
      : h('p', { class: 'vacio' }, 'No hay partidas abiertas. ¡Armá una y avisale a los demás!'));
    if (terminadas.length) out.push(h('h2', { class: 'sub' }, 'Terminadas'), h('div', { class: 'lista-act pasadas' }, terminadas.map(tarjeta)));
    return out;
  }

  function vistaNueva() {
    const opcion = (id) => {
      const j = JUEGOS[id];
      const listo = id === 'trivia' ? !!g.Trivia : !!g.Impostor;
      return h('button', { type: 'button', id: 'nueva-' + id, class: 'tarjeta-act tarjeta-juego', disabled: !listo || ocupado, on: { click: () => crear(id) } },
        h('span', { class: 'tarjeta-emoji', 'aria-hidden': 'true' }, j.emoji),
        h('span', { class: 'tarjeta-cuerpo' },
          h('span', { class: 'tarjeta-titulo' }, j.nombre),
          h('span', { class: 'tarjeta-meta' }, j.desc),
          !listo && h('span', { class: 'tarjeta-badges' }, badge('Próximamente'))));
    };
    return [
      h('button', { type: 'button', class: 'btn-link', on: { click: () => irA({ tipo: 'lista' }) } }, '← Volver'),
      h('h1', null, 'Nueva partida'),
      h('p', { class: 'ayuda' }, '¿A qué juegan? La partida queda abierta para que se sumen los demás.'),
      h('div', { class: 'lista-act' }, opcion('trivia'), opcion('impostor')),
    ];
  }

  function listaJugadores(p) {
    const js = jugadores.filter((j) => j.partida === p.id && !j.se_fue);
    return h('ul', { class: 'anotados', id: 'sala-jugadores' }, js.map((j) => {
      const pf = perfilDe(j.persona);
      return h('li', null, g.Perfiles.avatar(pf, 32), h('span', null, pf.nombre + (j.persona === yoId() ? ' (vos)' : '') + (j.persona === p.creador ? ' · armó la partida' : '')));
    }));
  }

  function botonSalir(p) {
    const cancela = p.estado === 'espera' && p.creador === yoId();
    if (confirmando === 'salir') {
      return h('div', { class: 'aviso-confirmar', id: 'aviso-salir' },
        h('p', { id: 'aviso-salir-txt' }, cancela ? 'Si te vas, la partida se cancela para todos. ¿La cancelamos?' : (p.estado === 'jugando' ? 'Si te vas, no podés volver a esta partida. ¿Salís igual?' : '¿Salís de la partida?')),
        h('div', { class: 'fila-botones' },
          h('button', { type: 'button', id: 'btn-salir-si', class: 'btn-peligro', disabled: ocupado, on: { click: () => salir(p) } }, cancela ? 'Sí, cancelarla' : 'Sí, salir'),
          h('button', { type: 'button', id: 'btn-salir-no', class: 'btn-sec', 'aria-describedby': 'aviso-salir-txt', on: { click: () => { confirmando = null; pintar(); } } }, 'No, me quedo')));
    }
    return h('button', { type: 'button', id: 'btn-salir', class: 'btn-peligro', on: { click: () => { confirmando = 'salir'; pintar(); const b = document.getElementById('btn-salir-no'); if (b) b.focus(); } } }, cancela ? 'Cancelar partida' : 'Salir de la partida');
  }

  function vistaPartida() {
    const volver = h('button', { type: 'button', class: 'btn-link', on: { click: () => irA({ tipo: 'lista' }) } }, '← Volver');
    if (!cargado && estadoCarga === 'error') {
      cerrarChat(); cerrarJuego();
      return [volver, h('div', { class: 'vacio', role: 'alert' }, h('p', null, 'No pudimos cargar la partida.'),
        h('button', { type: 'button', id: 'par-reintentar', class: 'btn-sec btn-chico', on: { click: () => { estadoCarga = 'cargando'; pintar(); refrescar(); } } }, 'Reintentar'))];
    }
    if (!cargado) return [volver, h('p', { class: 'vacio' }, 'Cargando…')];
    const p = actual;
    if (!p) {
      cerrarChat(); cerrarJuego();
      return [volver, h('p', { class: 'vacio', id: 'par-no-disponible' }, 'Esta partida ya no está disponible: empezó sin vos o saliste.')];
    }
    const j = JUEGOS[p.juego];
    const activo = soyActivo(p.id, jugadores);
    const yo = yoId();
    const out = [volver, h('h1', null, j.emoji + ' ' + j.nombre)];
    if (p.estado === 'espera') {
      cerrarJuego();
      const n = activosDe(p.id, jugadores).length;
      const faltan = Math.max(0, j.minimo - n);
      out.push(h('p', { class: 'tarjeta-badges' }, badge('Sala de espera', 'acento')),
        h('h2', { class: 'sub' }, 'Jugadores (' + n + ')'), listaJugadores(p));
      if (!activo) {
        out.push(h('button', { type: 'button', id: 'btn-unirme', class: 'btn-primario btn-ancho', disabled: ocupado, on: { click: () => accion('unirse_partida', { p: p.id }, '¡Adentro!') } }, 'Unirme'));
      } else if (p.creador === yo) {
        out.push(faltan ? h('p', { class: 'ayuda', id: 'faltan-jugadores' }, 'Faltan ' + faltan + (faltan === 1 ? ' jugador' : ' jugadores') + ' para arrancar.') : null,
          h('button', { type: 'button', id: 'btn-arrancar', class: 'btn-primario btn-ancho', disabled: ocupado || faltan > 0, on: { click: () => accion('avanzar_partida', { p: p.id, p_ronda: 0, p_fase: 'espera' }) } }, n === 1 ? 'Arrancar (jugás solo)' : 'Arrancar'));
      } else {
        out.push(h('p', { class: 'ayuda', id: 'esperando-creador' }, 'Esperando que ' + perfilDe(p.creador).nombre + ' arranque la partida.'));
      }
    } else if (p.estado_juego && p.estado_juego.fase === 'cancelada') {
      cerrarJuego();
      out.push(h('p', { class: 'vacio', id: 'par-cancelada' }, 'La partida se canceló: quien la armó se fue antes de arrancar.'));
    } else {
      out.push(juegoDe(p));
    }
    out.push(chatDe(p, activo));
    if (activo && !(p.estado === 'terminada')) out.push(h('div', { class: 'fila-botones salir-partida' }, botonSalir(p)));
    return out;
  }

  // ---------- Arranque ----------
  async function alCambiarPerfil(ev) {
    if (!ev.detail) { desuscribir(); pintar(); return; }
    pintar(); // "Cargando…"
    suscribir();
    await refrescar();
  }
  g.addEventListener('perfil', alCambiarPerfil);

  g.Juegos = { refrescar, JUEGOS };
})(window);
