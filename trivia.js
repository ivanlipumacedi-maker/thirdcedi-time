// La Trivia en curso: pregunta con cuenta regresiva, respuesta, revelación con ranking parcial y ranking final.
// Trivia.montar(contenedor, api) → { actualizar({partida, jugadores, mias}), cerrar() }. La monta juegos.js.
// La base manda: elige las preguntas, mide el tiempo y suma los puntos (dev/supabase/12-juegos.sql). Acá solo se
// muestra y, cuando vence el tiempo de una fase, se le pide avanzar (lo pide cualquier jugador; la base verifica
// que corresponda y, si otro ya avanzó, no hace nada).
(function (g) {
  const T = g.TriviaLogica;
  const LETRAS = ['A', 'B', 'C', 'D'];
  const CATS = { general: 'Cultura general', deportes: 'Deportes', argentina: 'Argentina', tecnologia: 'Tecnología', 'cine-musica': 'Cine, series y música', comida: 'Comida y asado', geografia: 'Geografía', historia: 'Historia' };
  const DIFS = { 1: 'Fácil', 2: 'Media', 3: 'Difícil' };

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
    let tic = null;                 // intervalo de la cuenta regresiva
    let tAvance = null;             // pedido automático de avanzar al vencer el tiempo
    let claveAvance = null;         // 'ronda:fase' para la que está programado
    let intentos = 0;
    let avanzando = false;          // pedido manual del creador en vuelo
    const elegidas = new Map();     // ronda -> opción tocada acá (antes de que llegue la confirmación)
    let elReloj = null, elBarra = null;

    const yo = () => api.yo();
    const estado = () => (datos && datos.partida.estado_juego) || {};
    const esCreador = () => datos && datos.partida.creador === yo();
    const soyActivo = () => datos && datos.jugadores.some((j) => j.persona === yo() && !j.se_fue);
    const restante = () => T.restante(Number(estado().limite_ms) || 0, Date.now(), api.desfase());
    const miOpcion = (ronda) => {
      const r = datos.mias.find((m) => m.ronda === ronda);
      return r ? r.opcion : (elegidas.has(ronda) ? elegidas.get(ronda) : null);
    };

    // ---------- Tiempo ----------
    function actualizarReloj() {
      const e = estado();
      if (!elReloj) return;
      const ms = restante();
      const total = e.fase === 'pregunta' ? T.PREGUNTA_MS : T.REVELADA_MS;
      elReloj.textContent = e.fase === 'pregunta' ? Math.ceil(ms / 1000) + ' s' : (ms > 0 ? 'Sigue en ' + Math.ceil(ms / 1000) + ' s' : 'Pasando…');
      if (elBarra) elBarra.style.width = Math.max(0, Math.min(100, (ms / total) * 100)) + '%';
      if (e.fase === 'pregunta' && ms <= 0) cont.querySelectorAll('.op-trivia').forEach((b) => { b.disabled = true; });
    }
    function pedirAvance(clave, ronda, fase) {
      if (cerrado || claveAvance !== clave) return;
      api.avanzar(ronda, fase).then((r) => {
        if (cerrado || claveAvance !== clave) return;
        // "Todavía no": este reloj iba adelantado o no llegó el último cambio. Se reintenta un par de veces.
        if (r && r.error && intentos++ < 6) tAvance = setTimeout(() => pedirAvance(clave, ronda, fase), 1000);
      }, () => { if (!cerrado && claveAvance === clave && intentos++ < 6) tAvance = setTimeout(() => pedirAvance(clave, ronda, fase), 1500); });
    }
    function programar() {
      const e = estado();
      const vivo = datos.partida.estado === 'jugando' && (e.fase === 'pregunta' || e.fase === 'revelada') && soyActivo();
      const clave = vivo ? e.ronda + ':' + e.fase : null;
      if (clave === claveAvance) return;
      clearTimeout(tAvance); claveAvance = clave; intentos = 0;
      if (!clave) return;
      // un poco después del límite y no todos a la vez (la base se queda con el primero; el resto no hace nada)
      tAvance = setTimeout(() => pedirAvance(clave, e.ronda, e.fase), restante() + 250 + Math.floor(Math.random() * 500));
    }

    // ---------- Acciones ----------
    async function responder(ronda, op) {
      if (miOpcion(ronda) != null || restante() <= 0) return;
      elegidas.set(ronda, op);
      pintar();
      const { error } = await api.responder(ronda, op).catch((e) => ({ error: e }));
      if (cerrado) return;
      if (error && !/Ya respondiste/.test(error.message || '')) {
        elegidas.delete(ronda);
        g.App.toast(/Se terminó el tiempo/.test(error.message || '') ? 'Se terminó el tiempo: esta no suma.' : 'No pudimos mandar tu respuesta. Probá de nuevo.');
        pintar();
      }
    }
    async function avanzarYa() {
      const e = estado();
      if (avanzando) return;
      avanzando = true; pintar();
      const { error } = await api.avanzar(e.ronda, e.fase).catch((x) => ({ error: x }));
      avanzando = false;
      if (cerrado) return;
      if (error) g.App.toast('No pudimos avanzar. Probá de nuevo.');
      pintar();
    }

    // ---------- Vistas ----------
    function rankingLista(final) {
      const filas = T.ranking(datos.jugadores.map((j) => ({ persona: j.persona, puntos: j.puntos })));
      const fueron = new Set(datos.jugadores.filter((j) => j.se_fue).map((j) => j.persona));
      const pr = estado().puntos_ronda || {};
      return h('ol', { class: 'ranking' + (final ? ' final' : ''), id: final ? 'ranking-final' : 'ranking-parcial' }, filas.map((f) => {
        const p = api.perfil(f.persona);
        return h('li', { class: 'fila-ranking' + (f.persona === yo() ? ' yo' : '') + (final && f.puesto === 1 ? ' primero' : '') },
          h('span', { class: 'puesto' }, final && f.puesto <= 3 ? ['🥇', '🥈', '🥉'][f.puesto - 1] : f.puesto + '°'),
          g.Perfiles.avatar(p, 28),
          h('span', { class: 'rk-nombre' }, p.nombre + (f.persona === yo() ? ' (vos)' : '') + (fueron.has(f.persona) ? ' · se fue' : '')),
          !final && pr[f.persona] ? h('span', { class: 'rk-suma' }, '+' + pr[f.persona]) : null,
          h('span', { class: 'rk-puntos' }, f.puntos.toLocaleString('es-AR')));
      }));
    }

    function vistaPregunta(e) {
      const q = e.pregunta || { ops: [] };
      const mia = miOpcion(e.ronda);
      const revelada = e.fase === 'revelada';
      const vencido = !revelada && restante() <= 0;
      const activos = datos.jugadores.filter((j) => !j.se_fue).length;
      const resp = (e.respondieron || []).length;
      elReloj = h('span', { class: 'reloj', id: 'trivia-reloj', 'aria-hidden': 'true' });
      elBarra = h('span', { class: 'barra-tiempo-relleno' });
      const ops = q.ops.map((txt, i) => {
        let clase = 'op-trivia';
        if (revelada) clase += i === e.ok ? ' correcta' : (i === mia ? ' incorrecta' : ' apagada');
        else if (i === mia) clase += ' elegida';
        return h('button', { type: 'button', class: clase, 'data-op': String(i), disabled: revelada || mia != null || vencido || !soyActivo(),
          'aria-pressed': i === mia ? 'true' : 'false', on: { click: () => responder(e.ronda, i) } },
          h('span', { class: 'op-letra', 'aria-hidden': 'true' }, LETRAS[i]),
          h('span', { class: 'op-texto' }, txt),
          revelada && e.conteo ? h('span', { class: 'op-conteo', 'aria-label': e.conteo[i] + ' eligieron esta' }, String(e.conteo[i])) : null,
          revelada && i === e.ok ? h('span', { class: 'op-marca', 'aria-hidden': 'true' }, '✓') : null);
      });
      const out = [
        h('div', { class: 'trivia-cabecera' },
          h('span', { class: 'trivia-ronda', id: 'trivia-ronda' }, 'Pregunta ' + e.ronda + ' de ' + e.total),
          elReloj),
        h('div', { class: 'barra-tiempo' + (revelada ? ' revelada' : '') }, elBarra),
        h('div', { class: 'carta-trivia', id: 'carta-trivia' },
          h('div', { class: 'carta-meta' }, h('span', null, CATS[q.cat] || q.cat), h('span', null, DIFS[q.dif] || '')),
          h('p', { class: 'carta-pregunta', id: 'trivia-pregunta' }, q.p)),
        h('div', { class: 'ops-trivia', role: 'group', 'aria-label': 'Opciones' }, ops),
      ];
      if (!revelada) {
        out.push(h('p', { class: 'ayuda trivia-estado', id: 'trivia-estado', role: 'status' },
          mia != null ? 'Respondiste. Esperando a los demás (' + resp + '/' + activos + ').'
            : (vencido ? 'Se terminó el tiempo.' : (activos > 1 ? resp + ' de ' + activos + ' ya respondieron.' : 'Elegí una opción.'))));
        if (esCreador() && soyActivo() && activos > 1) out.push(h('button', { type: 'button', id: 'btn-revelar', class: 'btn-sec btn-ancho', disabled: avanzando, on: { click: avanzarYa } }, 'Mostrar la respuesta ya'));
      } else {
        const pts = (e.puntos_ronda || {})[yo()];
        out.push(h('p', { class: 'trivia-resultado ' + (mia === e.ok ? 'bien' : 'mal'), id: 'trivia-resultado', role: 'status' },
          mia == null ? 'No respondiste: esta no suma.' : (mia === e.ok ? '¡Bien! +' + pts + ' puntos' : 'Esta vez no. La correcta era la ' + LETRAS[e.ok] + '.')));
        out.push(h('h2', { class: 'sub' }, 'Cómo van'), rankingLista(false));
        if (esCreador() && soyActivo()) out.push(h('button', { type: 'button', id: 'btn-siguiente', class: 'btn-primario btn-ancho', disabled: avanzando, on: { click: avanzarYa } }, e.ronda < e.total ? 'Siguiente pregunta' : 'Ver el ranking final'));
      }
      return out;
    }

    function vistaFinal() {
      const filas = T.ranking(datos.jugadores.map((j) => ({ persona: j.persona, puntos: j.puntos })));
      const mio = filas.find((f) => f.persona === yo());
      return [
        h('h2', { class: 'sub titulo-final' }, '🏆 Ranking final'),
        mio && filas.length > 1 ? h('p', { class: 'ayuda', id: 'mi-puesto' }, mio.puesto === 1 ? '¡Ganaste!' : 'Terminaste ' + mio.puesto + '°.') : null,
        mio && filas.length === 1 ? h('p', { class: 'ayuda', id: 'mi-puesto' }, 'Hiciste ' + mio.puntos.toLocaleString('es-AR') + ' puntos.') : null,
        rankingLista(true),
        h('button', { type: 'button', id: 'btn-volver-juegos', class: 'btn-primario btn-ancho', on: { click: api.volver } }, 'Volver a Juegos'),
      ];
    }

    function pintar() {
      if (cerrado || !datos) return;
      const e = estado();
      const foco = document.activeElement && cont.contains(document.activeElement) ? (document.activeElement.id || (document.activeElement.dataset && document.activeElement.dataset.op != null ? 'op:' + document.activeElement.dataset.op : null)) : null;
      elReloj = null; elBarra = null;
      let hijos;
      if (e.fase === 'final' || datos.partida.estado === 'terminada') hijos = vistaFinal();
      else if (e.fase === 'pregunta' || e.fase === 'revelada') hijos = vistaPregunta(e);
      else hijos = [h('p', { class: 'vacio' }, 'Arrancando…')];
      cont.replaceChildren(...hijos.filter(Boolean));
      actualizarReloj();
      if (foco) {
        const el = foco.startsWith('op:') ? cont.querySelector('[data-op="' + foco.slice(3) + '"]') : document.getElementById(foco);
        if (el && !el.disabled) el.focus({ preventScroll: true });
      }
    }

    function actualizar(d) {
      if (cerrado) return;
      datos = d;
      pintar();
      programar();
      if (!tic) tic = setInterval(actualizarReloj, 250);
    }
    function cerrar() {
      cerrado = true;
      clearInterval(tic); clearTimeout(tAvance);
      tic = null; tAvance = null; claveAvance = null;
    }
    return { actualizar, cerrar };
  }

  g.Trivia = { montar };
})(window);
