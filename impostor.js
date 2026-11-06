// El Impostor en curso: palabra (cada uno ve solo la suya, con mi_palabra) → pistas (una por jugador, en el chat
// de la partida) → votación (botones con los jugadores) → revelación. La monta juegos.js:
// Impostor.montar(contenedor, api) → { actualizar({partida, jugadores, mias}), cerrar() }.
// La base manda (dev/supabase/14-impostor.sql): elige el par y el impostor, mide el tiempo, cuenta los votos y
// decide quién gana. El cliente nunca recibe quién es el impostor ni la palabra de otro hasta la revelación.
// Cuando vence el tiempo de una fase se le pide avanzar (cualquier jugador; si otro ya avanzó, no hace nada).
(function (g) {
  const L = g.ImpostorLogica;
  const DURACION = { palabra: L.PALABRA_MS, pistas: L.PISTAS_MS, votacion: L.VOTACION_MS };
  // La votación no la cierra nadie a mano (ni el creador): se cierra con el último voto o cuando vence el tiempo.
  const SIGUE = { palabra: 'Pasar a las pistas', pistas: 'Pasar a la votación' };

  function h(tag, props, ...hijos) {
    const el = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'on') Object.entries(v).forEach(([ev, fn]) => el.addEventListener(ev, fn));
      else if (k in el && k !== 'list') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    el.append(...hijos.flat(Infinity).filter((c) => c != null && c !== false && c !== ''));
    return el;
  }

  function montar(cont, api) {
    let datos = null;
    let cerrado = false;
    let tic = null, tAvance = null, claveAvance = null, intentos = 0;
    let avanzando = false;
    let palabra = null;             // la mía (solo la mía)
    let pidiendo = false, tPalabra = null, intentosPalabra = 0;
    let miVoto = null;              // a quién voté desde acá
    let votando = false;
    let elReloj = null, elBarra = null;

    const yo = () => api.yo();
    const estado = () => (datos && datos.partida.estado_juego) || {};
    const esCreador = () => datos && datos.partida.creador === yo();
    const activos = () => datos.jugadores.filter((j) => !j.se_fue);
    const soyActivo = () => !!datos && activos().some((j) => j.persona === yo());
    const enJuego = () => datos && datos.partida.estado === 'jugando' && DURACION[estado().fase] != null;
    const restante = () => L.restante(Number(estado().limite_ms) || 0, Date.now(), api.desfase());
    const nombre = (id) => api.perfil(id).nombre + (id === yo() ? ' (vos)' : '');
    const yaVote = () => miVoto != null || (estado().votaron || []).includes(yo());

    // ---------- Mi palabra ----------
    function pedirPalabra() {
      if (cerrado || palabra != null || pidiendo || !enJuego() || !soyActivo()) return;
      pidiendo = true;
      api.miPalabra().then((r) => {
        pidiendo = false;
        if (cerrado) return;
        if (r && !r.error && typeof r.data === 'string') { palabra = r.data; pintar(); return; }
        if (intentosPalabra++ < 5) tPalabra = setTimeout(pedirPalabra, 1500);
        else pintar();
      }, () => { pidiendo = false; if (!cerrado && intentosPalabra++ < 5) tPalabra = setTimeout(pedirPalabra, 1500); });
    }

    // ---------- Tiempo ----------
    function actualizarReloj() {
      if (!elReloj) return;
      const ms = restante();
      const total = DURACION[estado().fase] || 1;
      const s = Math.ceil(ms / 1000);
      elReloj.textContent = ms > 0 ? (s >= 60 ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : s + ' s') : 'Pasando…';
      if (elBarra) elBarra.style.width = Math.max(0, Math.min(100, (ms / total) * 100)) + '%';
    }
    function pedirAvance(clave, fase) {
      if (cerrado || claveAvance !== clave) return;
      api.avanzar(1, fase).then((r) => {
        if (cerrado || claveAvance !== clave) return;
        if (r && r.error && intentos++ < 6) tAvance = setTimeout(() => pedirAvance(clave, fase), 1000);
      }, () => { if (!cerrado && claveAvance === clave && intentos++ < 6) tAvance = setTimeout(() => pedirAvance(clave, fase), 1500); });
    }
    function programar() {
      const e = estado();
      const clave = enJuego() && soyActivo() ? (e.ronda || 1) + ':' + e.fase : null;
      if (clave === claveAvance) return;
      clearTimeout(tAvance); claveAvance = clave; intentos = 0;
      if (!clave) return;
      tAvance = setTimeout(() => pedirAvance(clave, e.fase), restante() + 250 + Math.floor(Math.random() * 500));
    }

    // ---------- Acciones ----------
    async function avanzarYa() {
      if (avanzando) return;
      avanzando = true; pintar();
      const { error } = await api.avanzar(1, estado().fase).catch((x) => ({ error: x }));
      avanzando = false;
      if (cerrado) return;
      if (error) g.App.toast('No pudimos avanzar. Probá de nuevo.');
      pintar();
    }
    async function votar(persona) {
      if (yaVote() || votando || restante() <= 0) return;
      votando = true; miVoto = persona; pintar();
      const { error } = await api.votar(1, persona).catch((x) => ({ error: x }));
      votando = false;
      if (cerrado) return;
      if (error && !/Ya votaste/.test(error.message || '')) {
        miVoto = null;
        g.App.toast(/Se terminó el tiempo/.test(error.message || '') ? 'Se terminó el tiempo para votar.' : 'No pudimos mandar tu voto. Probá de nuevo.');
      }
      pintar();
    }

    // ---------- Vistas ----------
    function cabecera(titulo) {
      elReloj = h('span', { class: 'reloj', id: 'impostor-reloj', 'aria-hidden': 'true' });
      elBarra = h('span', { class: 'barra-tiempo-relleno' });
      return [
        h('div', { class: 'trivia-cabecera' }, h('span', { class: 'trivia-ronda', id: 'impostor-fase' }, titulo), elReloj),
        h('div', { class: 'barra-tiempo' }, elBarra),
      ];
    }
    function cartaPalabra(chica) {
      return h('div', { class: 'carta-trivia carta-impostor' + (chica ? ' chica' : ''), id: 'carta-impostor' },
        h('div', { class: 'carta-meta' }, h('span', null, 'Tu palabra')),
        h('p', { class: 'carta-pregunta palabra-impostor', id: 'impostor-palabra' },
          palabra != null ? palabra : (intentosPalabra > 5 ? 'No pudimos traerla' : 'Cargando…')));
    }
    function botonAvanzar() {
      return esCreador() && soyActivo() && SIGUE[estado().fase]
        ? h('button', { type: 'button', id: 'btn-imp-avanzar', class: 'btn-sec btn-ancho', disabled: avanzando, on: { click: avanzarYa } }, SIGUE[estado().fase])
        : null;
    }

    function vistaPalabra() {
      return [
        ...cabecera('Tu palabra'),
        cartaPalabra(false),
        h('p', { class: 'ayuda', id: 'impostor-estado' },
          'Todos tienen la misma palabra menos uno, el impostor, que tiene otra parecida. Nadie sabe si es el impostor: ni vos. Las pistas arrancan solas.'),
        botonAvanzar(),
      ];
    }

    function vistaPistas() {
      const orden = (estado().orden || []).filter((id) => datos.jugadores.some((j) => j.persona === id));
      const fueron = new Set(datos.jugadores.filter((j) => j.se_fue).map((j) => j.persona));
      return [
        ...cabecera('Pistas'),
        cartaPalabra(true),
        h('p', { class: 'ayuda', id: 'impostor-estado' }, 'Escribí en el chat de abajo una sola pista sobre tu palabra, sin decirla. Si te parece que la tuya es distinta, disimulá.'),
        h('h2', { class: 'sub' }, 'Orden para las pistas'),
        h('ol', { class: 'ranking orden-pistas', id: 'impostor-orden' }, orden.map((id, i) =>
          h('li', { class: 'fila-ranking' + (id === yo() ? ' yo' : '') + (fueron.has(id) ? ' apagada' : '') },
            h('span', { class: 'puesto' }, (i + 1) + '°'),
            g.Perfiles.avatar(api.perfil(id), 28),
            h('span', { class: 'rk-nombre' }, nombre(id) + (fueron.has(id) ? ' · se fue' : ''))))),
        botonAvanzar(),
      ];
    }

    function vistaVotacion() {
      const e = estado();
      const act = activos();
      const votaron = (e.votaron || []).filter((id) => act.some((j) => j.persona === id)).length;
      const vencido = restante() <= 0;
      const ya = yaVote();
      const opciones = act.filter((j) => j.persona !== yo()).map((j) =>
        h('button', { type: 'button', class: 'op-trivia voto-imp' + (miVoto === j.persona ? ' elegida' : ''), 'data-persona': j.persona,
          disabled: ya || votando || vencido || !soyActivo(), 'aria-pressed': miVoto === j.persona ? 'true' : 'false', on: { click: () => votar(j.persona) } },
          g.Perfiles.avatar(api.perfil(j.persona), 32),
          h('span', { class: 'op-texto' }, api.perfil(j.persona).nombre)));
      return [
        ...cabecera('Votación'),
        h('p', { class: 'carta-pregunta pregunta-voto' }, '¿Quién es el impostor?'),
        h('div', { class: 'ops-trivia', role: 'group', 'aria-label': 'Jugadores' }, opciones),
        h('p', { class: 'ayuda trivia-estado', id: 'impostor-estado', role: 'status' },
          ya ? (miVoto ? 'Votaste a ' + api.perfil(miVoto).nombre + '. ' : 'Ya votaste. ') + 'Esperando a los demás (' + votaron + '/' + act.length + ').'
            : (vencido ? 'Se terminó el tiempo.' : votaron + ' de ' + act.length + ' ya votaron. Los votos se ven al final.')),
        botonAvanzar(),
      ];
    }

    function vistaFinal() {
      const e = estado();
      const imp = e.impostor;
      const grupo = e.gano === 'grupo';
      const motivo = {
        se_fue_impostor: 'El impostor se fue de la partida.',
        quedan_dos: 'Quedaron solo dos jugadores: ya no se lo podía descubrir.',
      }[e.motivo] || (e.expulsado == null ? 'Hubo empate o nadie votó: el impostor zafó.'
        : (e.expulsado === imp ? 'Lo descubrieron con la mayoría de los votos.' : 'Echaron a ' + nombre(e.expulsado) + ', pero no era el impostor.'));
      const conteo = e.conteo || {};
      const votos = e.votos || {};
      const filas = datos.jugadores.slice().sort((a, b) => (conteo[b.persona] || 0) - (conteo[a.persona] || 0));
      return [
        h('div', { class: 'trivia-resultado resultado-impostor ' + (grupo ? 'bien' : 'mal'), id: 'impostor-resultado', role: 'status' },
          h('strong', null, grupo ? '¡Ganó el grupo!' : '¡Ganó el impostor!'), h('br'), motivo),
        imp ? h('div', { class: 'carta-trivia carta-impostor', id: 'impostor-era' },
          h('div', { class: 'carta-meta' }, h('span', null, 'El impostor era')),
          h('div', { class: 'impostor-quien' }, g.Perfiles.avatar(api.perfil(imp), 40), h('span', { class: 'carta-pregunta' }, nombre(imp))),
          imp === yo() ? h('p', { class: 'impostor-vos' }, '¡Eras vos!') : null) : null,
        h('dl', { class: 'palabras-final', id: 'impostor-palabras' },
          h('dt', null, 'Palabra del grupo'), h('dd', null, e.palabra || ''),
          h('dt', null, 'Palabra del impostor'), h('dd', null, e.palabra_impostor || '')),
        h('h2', { class: 'sub' }, 'Votos'),
        h('ol', { class: 'ranking', id: 'impostor-votos' }, filas.map((j) => {
          const n = conteo[j.persona] || 0;
          return h('li', { class: 'fila-ranking' + (j.persona === yo() ? ' yo' : '') + (j.persona === imp ? ' es-impostor' : '') },
            g.Perfiles.avatar(api.perfil(j.persona), 28),
            h('span', { class: 'rk-nombre' }, nombre(j.persona) + (j.se_fue ? ' · se fue' : '') + (votos[j.persona] ? ' → votó a ' + api.perfil(votos[j.persona]).nombre : '')),
            h('span', { class: 'rk-puntos' }, n + (n === 1 ? ' voto' : ' votos')));
        })),
        h('button', { type: 'button', id: 'btn-volver-juegos', class: 'btn-primario btn-ancho', on: { click: api.volver } }, 'Volver a Juegos'),
      ];
    }

    function pintar() {
      if (cerrado || !datos) return;
      const e = estado();
      const foco = document.activeElement && cont.contains(document.activeElement) ? document.activeElement.id || null : null;
      elReloj = null; elBarra = null;
      let hijos;
      if (e.fase === 'final' || datos.partida.estado === 'terminada') hijos = vistaFinal();
      else if (e.fase === 'palabra') hijos = vistaPalabra();
      else if (e.fase === 'pistas') hijos = vistaPistas();
      else if (e.fase === 'votacion') hijos = vistaVotacion();
      else hijos = [h('p', { class: 'vacio' }, 'Arrancando…')];
      cont.replaceChildren(...hijos.filter(Boolean));
      actualizarReloj();
      if (foco) { const el = document.getElementById(foco); if (el && !el.disabled) el.focus({ preventScroll: true }); }
    }

    function actualizar(d) {
      if (cerrado) return;
      datos = d;
      pedirPalabra();
      pintar();
      programar();
      if (!tic) tic = setInterval(actualizarReloj, 250);
    }
    function cerrar() {
      cerrado = true;
      clearInterval(tic); clearTimeout(tAvance); clearTimeout(tPalabra);
      tic = null; tAvance = null; claveAvance = null;
    }
    return { actualizar, cerrar };
  }

  g.Impostor = { montar };
})(window);
