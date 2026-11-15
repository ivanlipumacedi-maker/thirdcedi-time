// Ajedrez en curso (36): tablero de 8×8 desde el lado de cada uno. Tocás una pieza tuya (en tu turno), se marcan a dónde
// puede ir, y tocás el destino. La jugada la valida y la guarda la Edge Function juegos; el otro la ve por Realtime
// (cambia partidas.estado_juego). Al coronar se elige la pieza. Salir de la partida = abandonar (gana el otro).
// Ajedrez.montar(el, api) → { actualizar({ partida, jugadores }), cerrar() }. api: { yo(), perfil(id), mover(n, desde,
// hasta, corona) → Promise<{ error? }>, volver() }.
(function (g) {
  const L = g.AjedrezLogica;
  const FIGURA = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }; // se pintan de blanco o negro con CSS
  const NOMBRE = { k: 'rey', q: 'dama', r: 'torre', b: 'alfil', n: 'caballo', p: 'peón' };
  const COLS = 'abcdefgh';
  const nodos = (xs) => xs.flat(Infinity).filter((c) => c != null && c !== false && c !== '');
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

  function montar(el, api) {
    let datos = null, cerrado = false;
    let sel = null, destinos = [], enviando = false, coronando = null; // coronando: { desde, hasta }
    let error = '';
    const estado = () => (datos && datos.partida.estado_juego) || {};
    const yo = () => api.yo();
    const miColor = () => L.colorDe(estado(), yo());
    const rival = () => { const e = estado(); return miColor() === 'w' ? e.negras : miColor() === 'b' ? e.blancas : null; };
    const nombre = (id) => (id ? api.perfil(id).nombre : 'Compañero');
    const jugadas = () => (Array.isArray(estado().jugadas) ? estado().jugadas : []);
    const turno = () => { const c = L.rehacer(jugadas()); return c ? c.turn() : 'w'; };
    const terminada = () => datos && (datos.partida.estado === 'terminada' || estado().fase === 'final');
    const meToca = () => !terminada() && miColor() && turno() === miColor() && !enviando;

    async function mover(desde, hasta, corona) {
      if (enviando) return;
      enviando = true; error = ''; sel = null; destinos = []; coronando = null; pintar();
      let r;
      try { r = await api.mover(jugadas().length, desde, hasta, corona); } catch (e) { r = { error: 'No se pudo mandar la jugada. Revisá la señal.' }; }
      enviando = false;
      if (cerrado) return;
      if (r && r.error) error = r.error;
      pintar();
    }

    function tocar(casilla, pieza) {
      if (!meToca()) return;
      if (sel && destinos.some((d) => d.hasta === casilla)) {
        const d = destinos.find((x) => x.hasta === casilla);
        if (d.corona) { coronando = { desde: sel, hasta: casilla }; pintar(); return; }
        mover(sel, casilla);
        return;
      }
      if (pieza && pieza.color === miColor()) {
        sel = sel === casilla ? null : casilla;
        destinos = sel ? L.destinos(jugadas(), sel) : [];
      } else { sel = null; destinos = []; }
      pintar();
    }

    function tablero() {
      const e = estado(), t = L.tablero(e.fen || L.INICIO);
      const negras = miColor() === 'b';
      const c = L.rehacer(jugadas());
      const jaque = c && c.in_check() ? c.turn() : null;
      const ult = e.ultima || {};
      const filas = [];
      for (let fi = 0; fi < 8; fi++) {
        for (let ci = 0; ci < 8; ci++) {
          const f = negras ? 7 - fi : fi, col = negras ? 7 - ci : ci;
          const casilla = COLS[col] + (8 - f);
          const pz = t[f][col];
          const clara = (f + col) % 2 === 0;
          const dest = destinos.find((d) => d.hasta === casilla);
          const cls = 'casilla ' + (clara ? 'clara' : 'oscura') + (sel === casilla ? ' sel' : '') + (dest ? (pz ? ' captura' : ' destino') : '')
            + (ult.desde === casilla || ult.hasta === casilla ? ' ultima' : '') + (pz && pz.tipo === 'k' && pz.color === jaque ? ' jaque' : '');
          const etq = casilla + (pz ? ': ' + NOMBRE[pz.tipo] + (pz.color === 'w' ? ' blanco' : ' negro') : ', vacía') + (dest ? ' (podés mover acá)' : '');
          filas.push(h('button', { type: 'button', class: cls, 'data-casilla': casilla, 'aria-label': etq, disabled: !meToca() || null,
            on: { click: () => tocar(casilla, pz) } },
            pz ? h('span', { class: 'pieza ' + (pz.color === 'w' ? 'blanca' : 'negra'), 'aria-hidden': 'true' }, FIGURA[pz.tipo] + '︎') : null,
            ci === 0 ? h('span', { class: 'coord fila', 'aria-hidden': 'true' }, String(8 - f)) : null,
            fi === 7 ? h('span', { class: 'coord col', 'aria-hidden': 'true' }, COLS[col]) : null));
        }
      }
      return h('div', { class: 'tablero' + (negras ? ' negras' : ''), id: 'tablero', role: 'grid', 'aria-label': 'Tablero' }, filas);
    }

    function estadoTexto() {
      const e = estado();
      if (terminada()) {
        const mio = miColor();
        if (e.gano === 'tablas') return { t: (L.NOMBRE_MOTIVO[e.motivo] || 'Tablas'), c: '' };
        const ganador = e.gano === 'blancas' ? e.blancas : e.negras;
        const motivo = e.motivo === 'abandono' ? 'abandonó ' + nombre(ganador === e.blancas ? e.negras : e.blancas)
          : (L.NOMBRE_MOTIVO[e.motivo] || '').toLowerCase();
        if (mio && ganador === yo()) return { t: '¡Ganaste! (' + motivo + ')', c: 'bien' };
        if (mio) return { t: 'Ganó ' + nombre(ganador) + ' (' + motivo + ')', c: 'mal' };
        return { t: 'Ganó ' + nombre(ganador) + ' (' + motivo + ')', c: '' };
      }
      if (!miColor()) return { t: 'Juegan ' + nombre(e.blancas) + ' (blancas) y ' + nombre(e.negras) + ' (negras).', c: '' };
      const c = L.rehacer(jugadas());
      const jaque = c && c.in_check();
      if (enviando) return { t: 'Mandando la jugada…', c: '' };
      if (turno() === miColor()) return { t: (jaque ? '¡Jaque! ' : '') + 'Te toca.', c: jaque ? 'mal' : 'turno' };
      return { t: 'Le toca a ' + nombre(rival()) + '.', c: '' };
    }

    function listaJugadas() {
      const js = jugadas();
      if (!js.length) return null;
      const pares = [];
      for (let i = 0; i < js.length; i += 2) pares.push(h('li', null, h('span', { class: 'aj-num' }, (i / 2 + 1) + '.'), ' ' + js[i] + (js[i + 1] ? '  ' + js[i + 1] : '')));
      return h('details', { class: 'aj-jugadas' }, h('summary', null, 'Jugadas (' + js.length + ')'), h('ol', null, pares));
    }

    function pintar() {
      if (cerrado || !datos) return;
      const e = estado(), mio = miColor(), est = estadoTexto();
      el.replaceChildren(...nodos([
        h('p', { class: 'aj-quien' }, mio ? 'Jugás con ' + (mio === 'w' ? 'blancas' : 'negras') + ' contra ' + nombre(rival()) + '.' : null),
        h('p', { class: 'aj-estado ' + est.c, id: 'aj-estado', role: 'status' }, est.t),
        error ? h('p', { class: 'error', role: 'alert', id: 'aj-error' }, error) : null,
        tablero(),
        coronando ? h('div', { class: 'aj-corona', role: 'group', 'aria-label': 'Elegí la pieza para coronar' },
          h('p', null, '¿En qué corona el peón?'),
          ['q', 'r', 'b', 'n'].map((p) => h('button', { type: 'button', class: 'btn-sec', 'data-corona': p, 'aria-label': NOMBRE[p],
            on: { click: () => mover(coronando.desde, coronando.hasta, p) } }, h('span', { class: 'pieza ' + (mio === 'w' ? 'blanca' : 'negra') }, FIGURA[p] + '︎'))),
          h('button', { type: 'button', class: 'btn-link', on: { click: () => { coronando = null; pintar(); } } }, 'Cancelar')) : null,
        terminada() ? h('p', { class: 'ayuda' }, (L.MIN_JUGADAS_RANKING > jugadas().length ? 'Con menos de ' + L.MIN_JUGADAS_RANKING + ' jugadas no suma puntos en el ranking.' : 'Ya suma en el ranking.')) : null,
        listaJugadas(),
        !terminada() && mio ? h('p', { class: 'ayuda' }, 'Tocá una pieza tuya y después a dónde va. Salir de la partida es abandonar: gana el otro.') : null,
      ]));
    }

    return {
      actualizar(d) {
        if (cerrado) return;
        const antes = datos ? jugadas().length : -1;
        datos = d;
        if (jugadas().length !== antes) { sel = null; destinos = []; coronando = null; if (!enviando) error = ''; }
        pintar();
      },
      cerrar() { cerrado = true; },
    };
  }

  g.Ajedrez = { montar };
})(window);
