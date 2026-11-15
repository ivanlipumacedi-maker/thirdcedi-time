// Truco en curso (38): anotador con palitos (Nosotros / Ellos), la mesa (lo que jugó cada uno en cada baza), tus cartas
// y los cantos que podés hacer. Todo lo decide la Edge Function juegos con truco-logica.js; acá se usa la misma lógica
// solo para saber qué botones mostrar. Tus cartas llegan con truco_mis_cartas (nadie más las ve).
// Truco.montar(el, api) → { actualizar({ partida, jugadores }), cerrar() }. api: { yo(), perfil(id), misCartas(),
// trucoAccion(v, jugada) → Promise<{ error? }> }.
(function (g) {
  const T = g.TrucoLogica;
  const PALO = { e: 'espada', b: 'basto', o: 'oro', c: 'copa' };
  const CANTO = { truco: '¡Truco!', retruco: '¡Quiero retruco!', vale4: '¡Quiero vale cuatro!', envido: 'Envido', real: 'Real envido', falta: 'Falta envido' };
  const BOTON = { truco: 'Truco', retruco: 'Retruco', vale4: 'Vale cuatro', envido: 'Envido', real: 'Real envido', falta: 'Falta envido' };
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
  const SVG = 'http://www.w3.org/2000/svg';
  // palitos de a 5 (cuatro paraditos y uno cruzado), como en el anotador
  function palitos(n) {
    const caja = h('span', { class: 'palitos', 'aria-hidden': 'true' });
    for (let k = 0; k < Math.ceil(n / 5); k++) {
      const s = document.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 30 30'); s.setAttribute('class', 'palito-grupo');
      const cuantos = Math.min(5, n - k * 5);
      const linea = (x1, y1, x2, y2) => { const l = document.createElementNS(SVG, 'line'); l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2); s.appendChild(l); };
      [[4, 4, 4, 26], [4, 4, 26, 4], [26, 4, 26, 26], [4, 26, 26, 26]].slice(0, Math.min(4, cuantos)).forEach((c) => linea(...c));
      if (cuantos === 5) linea(4, 26, 26, 4);
      caja.appendChild(s);
    }
    return caja;
  }
  function carta(c, props = {}) {
    const n = parseInt(c, 10), p = c.slice(-1);
    return h(props.boton ? 'button' : 'span', { type: props.boton ? 'button' : null, class: 'naipe palo-' + p + (props.clase ? ' ' + props.clase : ''),
      'data-carta': c, 'aria-label': T.nombreCarta(c), disabled: props.disabled || null, on: props.on || null },
      h('span', { class: 'naipe-num' }, String(n)), h('span', { class: 'naipe-palo' }, PALO[p]));
  }

  function montar(el, api) {
    let datos = null, cerrado = false, enviando = false, error = '';
    let mias = { v: -1, asiento: -1, cartas: [] }, pidiendo = false;
    let inicioMano = { n: 0, cartas: [] }; // mis 3 cartas al empezar la mano (para el envido y la flor)
    let confirmandoMazo = false;
    const e = () => (datos && datos.partida.estado_juego) || {};
    const yo = () => api.yo();
    const miAsiento = () => (e().config ? e().config.jugadores.indexOf(yo()) : -1);
    const miEq = () => (miAsiento() >= 0 ? e().config.equipo[miAsiento()] : 0);
    const uidDe = (a) => (e().config ? e().config.jugadores[a] : null);
    const nombre = (a) => { const u = uidDe(a); return u ? api.perfil(u).nombre + (u === yo() ? ' (vos)' : '') : '?'; };
    const nomEq = (q) => (miAsiento() < 0 ? 'Pareja ' + (q + 1) : q === miEq() ? 'Nosotros' : 'Ellos');

    function pedirCartas() {
      const v = e().v;
      if (pidiendo || miAsiento() < 0 || mias.v === v || e().fase === 'final') return;
      pidiendo = true;
      Promise.resolve(api.misCartas()).then((r) => {
        pidiendo = false;
        if (cerrado) return;
        if (r && !r.error && r.data) {
          mias = { v: r.data.v, asiento: r.data.asiento, cartas: r.data.cartas || [] };
          if (inicioMano.n !== e().n_mano && mias.cartas.length === 3) inicioMano = { n: e().n_mano, cartas: mias.cartas.slice() };
          pintar();
          if (mias.v !== e().v) setTimeout(pedirCartas, 300);
        } else setTimeout(pedirCartas, 1500);
      }, () => { pidiendo = false; setTimeout(pedirCartas, 1500); });
    }

    async function hacer(jugada) {
      if (enviando) return;
      enviando = true; error = ''; confirmandoMazo = false; pintar();
      let r;
      try { r = await api.trucoAccion(e().v, jugada); } catch (x) { r = { error: 'No se pudo mandar. Revisá la señal.' }; }
      enviando = false;
      if (cerrado) return;
      if (r && r.error) error = r.error;
      pintar();
    }

    function anotador() {
      const est = e(), a = (est.config && est.config.a) || 30;
      const fila = (q) => {
        const p = (est.puntos || [0, 0])[q];
        const buenas = a === 30 ? (p >= 15 ? ' · buenas' : ' · malas') : '';
        return h('div', { class: 'anot-fila' + (q === miEq() && miAsiento() >= 0 ? ' mia' : ''), id: 'anot-' + q },
          h('span', { class: 'anot-eq' }, nomEq(q)), palitos(p), h('span', { class: 'anot-pts' }, p + buenas));
      };
      return h('div', { class: 'anotador', 'aria-label': 'Puntos' }, fila(0), fila(1),
        h('p', { class: 'anot-meta' }, 'A ' + a + (est.config && est.config.flor ? ', con flor' : ', sin flor')));
    }

    function mesa() {
      const est = e(), n = est.config ? est.config.jugadores.length : 2;
      const bazas = est.mesa || [[]];
      return h('div', { class: 'truco-mesa', id: 'truco-mesa' }, bazas.map((b, i) => {
        const gano = (est.ganadas || [])[i];
        return h('div', { class: 'baza' },
          h('p', { class: 'baza-tit' }, (i + 1) + 'ª' + (gano === undefined ? '' : gano === 'parda' ? ' · parda' : ' · ' + nomEq(gano))),
          h('div', { class: 'baza-cartas' }, b.map((j) => h('span', { class: 'baza-j' }, carta(j.carta, { clase: 'chico' }), h('small', null, nombre(j.asiento))))),
          b.length < n && i === bazas.length - 1 ? h('p', { class: 'baza-falta' }, 'Juega ' + nombre(est.turno)) : null);
      }));
    }

    function ultimaMano() {
      const u = e().ultima_mano;
      if (!u || e().n_mano < 2) return null;
      const partes = [];
      if (u.flor) partes.push((u.flor.contraflor ? 'Contraflor' : 'Flor') + ': +' + u.flor.puntos + ' ' + nomEq(u.flor.equipo).toLowerCase());
      if (u.envido) partes.push('Envido ' + (u.envido.querido ? 'querido' : 'no querido') + ': +' + u.envido.puntos + ' ' + nomEq(u.envido.equipo).toLowerCase());
      partes.push((u.motivo === 'mazo' ? 'Se fueron al mazo' : u.motivo === 'no_quiero' ? 'No quisieron el truco' : 'Mano') + ': +' + u.puntos + ' ' + nomEq(u.equipo).toLowerCase());
      return h('p', { class: 'ayuda', id: 'truco-ultima' }, 'Mano anterior. ' + partes.join(' · '));
    }

    function estadoLinea(op) {
      const est = e(), t = est.truco || {}, en = est.envido || {};
      if (enviando) return 'Mandando…';
      if (en.estado === 'cantando') {
        const quien = (est.log || []).slice().reverse().find((x) => x.t === 'canto');
        const txt = (quien ? nombre(quien.asiento) + ': ' : '') + CANTO[en.cantos[en.cantos.length - 1]];
        return op.responder ? txt + '. ¿Querés?' : txt + '. Esperando la respuesta.';
      }
      if (t.pendiente) {
        const quien = (est.log || []).slice().reverse().find((x) => x.t === 'canto');
        const txt = (quien ? nombre(quien.asiento) + ': ' : '') + CANTO[t.pendiente.canto];
        return op.responder ? txt + ' ¿Querés?' : txt + ' Esperando la respuesta.';
      }
      if (est.turno === miAsiento()) return 'Te toca.';
      return 'Le toca a ' + nombre(est.turno) + '.';
    }

    function pintar() {
      if (cerrado || !datos) return;
      const est = e();
      if (!est.config) { el.replaceChildren(h('p', { class: 'vacio' }, 'Repartiendo…')); return; }
      if (est.fase === 'final' || datos.partida.estado === 'terminada') {
        const gan = est.ganadores || [];
        const gane = gan.includes(yo());
        el.replaceChildren(...nodos([anotador(),
          h('div', { class: 'trivia-resultado ' + (gane ? 'bien' : miAsiento() >= 0 ? 'mal' : ''), id: 'truco-final', role: 'status' },
            h('strong', null, est.motivo === 'abandono' ? 'Terminó: alguien abandonó' : gane ? '¡Ganaron!' : 'Ganaron ' + gan.map((u) => api.perfil(u).nombre).join(' y ')),
            est.motivo === 'abandono' && gan.length ? h('br') : null, est.motivo === 'abandono' && gan.length ? 'Ganan ' + gan.map((u) => api.perfil(u).nombre).join(' y ') : null),
          ultimaMano()]));
        return;
      }
      const a = miAsiento();
      const S = Object.assign({}, est, { cartas: { [a]: mias.v === est.v ? mias.cartas : [] } });
      if (S.flor) S.flor = { con: [], resultado: est.flor.resultado };
      const op = a >= 0 && mias.v === est.v ? T.opciones(S, a) : { jugar: [], cantos: [], responder: false, mazo: false };
      const misCartas = mias.v === est.v ? mias.cartas : [];
      const tengo = inicioMano.n === est.n_mano ? inicioMano.cartas : [];
      const info = [];
      if (tengo.length === 3) {
        if (est.config.flor && T.tieneFlor(tengo)) info.push('¡Tenés flor! (' + T.florDe(tengo) + ') Se canta sola.');
        else info.push('Tenés ' + T.envidoDe(tengo) + ' de envido.');
      }
      const cantos = op.cantos.map((k) => h('button', { type: 'button', class: 'btn-sec btn-chico', 'data-canto': k, disabled: enviando, on: { click: () => hacer({ tipo: 'cantar', canto: k }) } }, BOTON[k]));
      el.replaceChildren(...nodos([
        anotador(),
        h('p', { class: 'aj-estado' + (op.responder || est.turno === a ? ' turno' : ''), id: 'truco-estado', role: 'status' }, estadoLinea(op)),
        error ? h('p', { class: 'error', role: 'alert', id: 'truco-error' }, error) : null,
        op.responder ? h('div', { class: 'fila-botones truco-resp' },
          h('button', { type: 'button', class: 'btn-primario', id: 'truco-quiero', disabled: enviando, on: { click: () => hacer({ tipo: 'quiero' }) } }, 'Quiero'),
          h('button', { type: 'button', class: 'btn-sec', id: 'truco-no-quiero', disabled: enviando, on: { click: () => hacer({ tipo: 'no_quiero' }) } }, 'No quiero')) : null,
        mesa(),
        a >= 0 ? h('div', { class: 'truco-mano', id: 'truco-mano', 'aria-label': 'Tus cartas' },
          misCartas.length ? misCartas.map((c) => carta(c, { boton: true, disabled: enviando || !op.jugar.includes(c), clase: op.jugar.includes(c) ? 'jugable' : '',
            on: { click: () => hacer({ tipo: 'jugar', carta: c }) } })) : h('p', { class: 'ayuda' }, mias.v === est.v ? 'Ya jugaste tus cartas.' : 'Cargando tus cartas…')) : null,
        info.length ? h('p', { class: 'ayuda', id: 'truco-info' }, info.join(' ')) : null,
        cantos.length ? h('div', { class: 'fila-botones truco-cantos', id: 'truco-cantos' }, cantos) : null,
        a >= 0 && op.mazo ? h('button', { type: 'button', class: confirmandoMazo ? 'btn-peligro' : 'btn-link', id: 'truco-mazo', disabled: enviando,
          on: { click: () => { if (confirmandoMazo) hacer({ tipo: 'mazo' }); else { confirmandoMazo = true; pintar(); } } } }, confirmandoMazo ? 'Tocá de nuevo para irte al mazo' : 'Irse al mazo') : null,
        ultimaMano(),
        a < 0 ? h('p', { class: 'ayuda' }, 'Estás mirando: no jugás en esta partida.') : null,
      ]));
    }

    return {
      actualizar(d) {
        if (cerrado) return;
        const antes = datos ? e().v : null;
        datos = d;
        if (e().v !== antes) { confirmandoMazo = false; if (!enviando) error = ''; }
        pedirCartas();
        pintar();
      },
      cerrar() { cerrado = true; },
    };
  }

  g.Truco = { montar };
})(window);
