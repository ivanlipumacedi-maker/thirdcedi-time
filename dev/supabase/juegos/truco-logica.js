// Lógica del truco (sin DOM): la usan la app (truco.js) y la Edge Function juegos (copia idéntica en
// dev/supabase/juegos/), que es la que manda: guarda el estado completo (con las cartas de cada uno) y aplica cada acción.
// Truco argentino de a 2, 4 o 6 (1v1, 2v2, 3v3), a 15 o 30, con flor opcional. Reglas que se eligieron para la app:
// * Flor (si está activada): se canta sola. Si alguien tiene flor, en esa mano no hay envido. Si una sola pareja tiene
//   flor, 3 puntos por cada flor; si las dos, gana 6 la flor más alta (contraflor; empate: la del lado del mano).
// * Envido: solo en la primera baza, antes de jugar tu carta y mientras el truco no esté querido (si cantaron truco y
//   todavía no contestaron, "el envido está primero"). Envido 2, real envido 3, falta envido lo que le falta para ganar
//   al que va adelante. No quiero: lo ya querido (o 1).
// * Truco 2, retruco 3, vale cuatro 4. Sube solo la pareja que aceptó el canto anterior. No quiero: el valor anterior.
// * Parda: se define en la baza siguiente; si la primera la ganó alguien y después hay parda, gana esa; todo parda, el mano.
// * Irse al mazo: la otra pareja se lleva lo que valía el truco en ese momento (1 si no se cantó).
//
// Estado completo S (el público es S sin `cartas`; ver publico()):
// { config: { a: 15|30, flor: bool, jugadores: [uid por asiento], equipo: [0|1 por asiento] }, puntos: [n, n], mano,
//   n_mano, cartas: { asiento: ['1e', ...] }, mesa: [[{ asiento, carta }], ...] (bazas), ganadas: [0|1|'parda'],
//   turno, truco: { nivel, querido, pendiente: { canto, equipo } | null, sube }, envido: { estado, cantos: [], equipo,
//   resultado }, flor: { con: [asiento], resultado }, log: [...], fase: 'jugando'|'final', ganadores: [uid], v }
(function (g) {
  const PALOS = { e: 'espada', b: 'basto', o: 'oro', c: 'copa' };
  const NUMEROS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];
  const MAZO = (() => { const m = []; for (const p of 'eboc') for (const n of NUMEROS) m.push(n + p); return m; })();
  const num = (c) => parseInt(c, 10);
  const palo = (c) => c.slice(-1);

  // jerarquía del truco: más alto = mejor
  function valorTruco(c) {
    const n = num(c), p = palo(c);
    if (n === 1 && p === 'e') return 14;
    if (n === 1 && p === 'b') return 13;
    if (n === 7 && p === 'e') return 12;
    if (n === 7 && p === 'o') return 11;
    return { 3: 10, 2: 9, 1: 8, 12: 7, 11: 6, 10: 5, 7: 4, 6: 3, 5: 2, 4: 1 }[n];
  }
  const valorEnvido = (c) => (num(c) >= 10 ? 0 : num(c));
  function envidoDe(cartas) {
    let mejor = 0;
    for (let i = 0; i < cartas.length; i++) {
      mejor = Math.max(mejor, valorEnvido(cartas[i]));
      for (let j = i + 1; j < cartas.length; j++) if (palo(cartas[i]) === palo(cartas[j])) mejor = Math.max(mejor, 20 + valorEnvido(cartas[i]) + valorEnvido(cartas[j]));
    }
    return mejor;
  }
  const tieneFlor = (cartas) => cartas.length === 3 && palo(cartas[0]) === palo(cartas[1]) && palo(cartas[1]) === palo(cartas[2]);
  const florDe = (cartas) => 20 + cartas.reduce((s, c) => s + valorEnvido(c), 0);
  const nombreCarta = (c) => num(c) + ' de ' + PALOS[palo(c)];

  // ---------- Armar y repartir ----------
  // rnd(): número en [0, 1). Asientos alternados: 0, 2, 4 son una pareja y 1, 3, 5 la otra.
  function nuevo({ jugadores, a, flor }, rnd) {
    const n = jugadores.length;
    if (![2, 4, 6].includes(n)) throw new Error('El truco es de a 2, 4 o 6');
    const S = {
      config: { a: a === 15 ? 15 : 30, flor: !!flor, jugadores: jugadores.slice(), equipo: jugadores.map((_, i) => i % 2) },
      puntos: [0, 0], mano: Math.floor(rnd() * n), n_mano: 0, log: [], fase: 'jugando', ganadores: [], v: 0,
    };
    repartir(S, rnd, true);
    return S;
  }
  function repartir(S, rnd, primera) {
    const n = S.config.jugadores.length;
    if (!primera) S.mano = (S.mano + 1) % n;
    S.n_mano += 1;
    const m = MAZO.slice();
    for (let i = m.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [m[i], m[j]] = [m[j], m[i]]; }
    S.cartas = {};
    for (let a = 0; a < n; a++) S.cartas[a] = [];
    for (let k = 0; k < 3; k++) for (let i = 0; i < n; i++) S.cartas[(S.mano + i) % n].push(m.pop());
    S.inicio = {}; for (let a = 0; a < n; a++) S.inicio[a] = S.cartas[a].slice();
    S.mesa = [[]]; S.ganadas = []; S.turno = S.mano; S.primero = S.mano;
    S.truco = { nivel: 0, querido: 0, pendiente: null, sube: null };
    S.envido = { estado: 'libre', cantos: [], equipo: null, resultado: null };
    const conFlor = S.config.flor ? Object.keys(S.cartas).map(Number).filter((a) => tieneFlor(S.cartas[a])) : [];
    S.flor = { con: conFlor, resultado: null };
    if (conFlor.length) S.envido.estado = 'cerrado';
    S.log.push({ t: 'mano', n: S.n_mano, mano: S.mano });
    if (S.log.length > 60) S.log = S.log.slice(-60);
  }

  // ---------- Ayudas ----------
  const nJug = (S) => S.config.jugadores.length;
  const eq = (S, a) => S.config.equipo[a];
  const otro = (e) => 1 - e;
  const asientoDe = (S, uid) => S.config.jugadores.indexOf(uid);
  const VALOR_TRUCO = [1, 2, 3, 4];
  const CANTO_TRUCO = ['truco', 'retruco', 'vale4'];
  const puntosParaGanar = (S) => S.config.a - Math.max(S.puntos[0], S.puntos[1]);
  const yaJugo = (S, a) => S.mesa[S.mesa.length - 1].some((x) => x.asiento === a);
  const baza = (S) => S.mesa.length - 1;
  // el asiento más cerca del mano (para desempatar): distancia en el orden de juego
  const distMano = (S, a) => (a - S.mano + nJug(S)) % nJug(S);

  function sumar(S, e, n, motivo) {
    if (S.fase !== 'jugando' || n <= 0) return;
    S.puntos[e] = Math.min(S.config.a, S.puntos[e] + n);
    S.log.push({ t: 'puntos', equipo: e, n, motivo });
    if (S.puntos[e] >= S.config.a) {
      S.fase = 'final';
      S.ganadores = S.config.jugadores.filter((_, a) => eq(S, a) === e);
      S.gano = e;
    }
  }

  // ---------- Flor y envido ----------
  function resolverFlor(S) {
    if (!S.flor.con.length || S.flor.resultado) return;
    const porEq = [0, 1].map((e) => S.flor.con.filter((a) => eq(S, a) === e));
    if (porEq[0].length && porEq[1].length) {
      const mejor = (e) => porEq[e].map((a) => ({ a, v: florDe(S.inicio[a]) })).sort((x, y) => y.v - x.v || distMano(S, x.a) - distMano(S, y.a))[0];
      const m0 = mejor(0), m1 = mejor(1);
      const gana = m0.v > m1.v ? 0 : m1.v > m0.v ? 1 : (distMano(S, m0.a) < distMano(S, m1.a) ? 0 : 1);
      S.flor.resultado = { contraflor: true, equipo: gana, valores: { [m0.a]: m0.v, [m1.a]: m1.v }, puntos: 6 };
      sumar(S, gana, 6, 'contraflor');
    } else {
      const e = porEq[0].length ? 0 : 1;
      S.flor.resultado = { contraflor: false, equipo: e, puntos: 3 * porEq[e].length };
      sumar(S, e, 3 * porEq[e].length, 'flor');
    }
  }
  const VALOR_ENVIDO = { envido: 2, real: 3 };
  function valoresEnvido(S) {
    const c = S.envido.cantos;
    const sumaHasta = (k) => c.slice(0, k).reduce((s, x) => s + (x === 'falta' ? 0 : VALOR_ENVIDO[x]), 0);
    const ultimo = c[c.length - 1];
    return { quiero: ultimo === 'falta' ? puntosParaGanar(S) : sumaHasta(c.length), noQuiero: c.length > 1 ? Math.max(1, sumaHasta(c.length - 1)) : 1 };
  }
  function resolverEnvido(S) {
    const n = nJug(S), tantos = {};
    let mejor = null;
    for (let a = 0; a < n; a++) {
      tantos[a] = envidoDe(S.inicio[a]);
      if (!mejor || tantos[a] > tantos[mejor.a] || (tantos[a] === tantos[mejor.a] && distMano(S, a) < distMano(S, mejor.a))) mejor = { a };
    }
    const gana = eq(S, mejor.a);
    // se muestra el tanto del mejor de cada pareja (el resto "son buenas")
    const mejores = [0, 1].map((e) => Object.keys(tantos).map(Number).filter((a) => eq(S, a) === e).sort((x, y) => tantos[y] - tantos[x] || distMano(S, x) - distMano(S, y))[0]);
    const pts = valoresEnvido(S).quiero;
    S.envido.resultado = { querido: true, equipo: gana, puntos: pts, tantos: { [mejores[0]]: tantos[mejores[0]], [mejores[1]]: tantos[mejores[1]] }, ganador: mejor.a };
    S.envido.estado = 'cerrado';
    sumar(S, gana, pts, 'envido');
  }

  // ---------- Bazas y fin de mano ----------
  function ganadorBaza(S, jugadas) {
    let top = -1, equipos = new Set(), mejor = null;
    for (const j of jugadas) {
      const v = valorTruco(j.carta);
      if (v > top) { top = v; equipos = new Set([eq(S, j.asiento)]); mejor = j.asiento; }
      else if (v === top) equipos.add(eq(S, j.asiento));
    }
    return equipos.size > 1 ? { equipo: 'parda', asiento: null } : { equipo: [...equipos][0], asiento: mejor };
  }
  // ¿quién ganó la mano con estas bazas? null si todavía no se sabe
  function ganadorMano(S) {
    const g = S.ganadas, manoEq = eq(S, S.mano);
    const cuenta = (e) => g.filter((x) => x === e).length;
    if (cuenta(0) >= 2) return 0;
    if (cuenta(1) >= 2) return 1;
    if (g.length >= 2) {
      if (g[0] === 'parda' && g[1] !== 'parda') return g[1];
      if (g[0] !== 'parda' && g[1] === 'parda') return g[0];
    }
    if (g.length === 3) {
      // la tercera define; si es parda, gana el que ganó la primera; si fue todo parda, el mano
      if (g[2] !== 'parda') return g[2];
      return g[0] !== 'parda' ? g[0] : manoEq;
    }
    return null;
  }
  function terminarMano(S, e, motivo, rnd) {
    const pts = S.truco.querido ? VALOR_TRUCO[S.truco.querido] : 1;
    resolverFlor(S);
    S.log.push({ t: 'fin_mano', equipo: e, motivo });
    sumar(S, e, pts, motivo === 'mazo' ? 'mazo' : 'truco');
    S.ultima_mano = { mesa: S.mesa, inicio: S.inicio, envido: S.envido.resultado, flor: S.flor.resultado, equipo: e, motivo, puntos: pts };
    if (S.fase === 'jugando') repartir(S, rnd, false);
  }

  // ---------- Qué puede hacer cada uno ----------
  // → { jugar: [cartas], cantos: ['truco'|'retruco'|'vale4'|'envido'|'real'|'falta'], responder: bool, mazo: bool }
  function opciones(S, a) {
    const vacio = { jugar: [], cantos: [], responder: false, mazo: false, envidoResponde: false };
    if (S.fase !== 'jugando' || a < 0) return vacio;
    const miEq = eq(S, a), t = S.truco, en = S.envido;
    const r = { jugar: [], cantos: [], responder: false, mazo: true, envidoResponde: false };
    // envido pendiente de respuesta: contesta la otra pareja (puede subir)
    if (en.estado === 'cantando') {
      if (en.equipo !== miEq) {
        r.responder = true; r.envidoResponde = true;
        const u = en.cantos[en.cantos.length - 1];
        if (u === 'envido' && en.cantos.filter((x) => x === 'envido').length < 2) r.cantos.push('envido');
        if (u === 'envido') r.cantos.push('real');
        if (u !== 'falta') r.cantos.push('falta');
      }
      return r;
    }
    // envido disponible: primera baza, sin haber jugado tu carta, truco no querido
    const envidoLibre = en.estado === 'libre' && baza(S) === 0 && !yaJugo(S, a) && t.querido === 0;
    if (t.pendiente) {
      if (t.pendiente.equipo !== miEq) {
        r.responder = true;
        if (t.nivel < 3) r.cantos.push(CANTO_TRUCO[t.nivel]); // quiero y subo
        if (envidoLibre && t.nivel === 1) r.cantos.push('envido', 'real', 'falta'); // el envido está primero
      }
      return r;
    }
    if (S.turno !== a) return r;
    r.jugar = S.cartas[a].slice();
    if (t.nivel === 0) r.cantos.push('truco');
    else if (t.nivel < 3 && t.sube === miEq) r.cantos.push(CANTO_TRUCO[t.nivel]);
    if (envidoLibre) r.cantos.push('envido', 'real', 'falta');
    return r;
  }

  // ---------- Aplicar una acción ----------
  // accion: { tipo: 'jugar', carta } | { tipo: 'cantar', canto } | { tipo: 'quiero' } | { tipo: 'no_quiero' } | { tipo: 'mazo' }
  // → { error } o { S } (S modificado; el que llama guarda una copia antes si la necesita)
  function aplicar(S, a, accion, rnd) {
    if (S.fase !== 'jugando') return { error: 'La partida terminó' };
    if (a < 0) return { error: 'No estás en esta partida' };
    const op = opciones(S, a), miEq = eq(S, a), t = S.truco, en = S.envido;
    const tipo = accion && accion.tipo;
    const quien = S.config.jugadores[a];
    if (tipo === 'jugar') {
      const c = accion.carta;
      if (!op.jugar.includes(c)) return { error: S.turno !== a ? 'No es tu turno' : 'No podés jugar esa carta ahora' };
      S.cartas[a] = S.cartas[a].filter((x) => x !== c);
      const mesa = S.mesa[S.mesa.length - 1];
      mesa.push({ asiento: a, carta: c });
      // la flor se canta sola cuando el que la tiene juega su primera carta (o al terminar la primera baza)
      if (mesa.length === nJug(S)) {
        const gb = ganadorBaza(S, mesa);
        S.ganadas.push(gb.equipo);
        if (baza(S) === 0) { resolverFlor(S); if (en.estado === 'libre') en.estado = 'cerrado'; }
        if (S.fase !== 'jugando') return { S };
        const gm = ganadorMano(S);
        if (gm !== null) { terminarMano(S, gm, 'bazas', rnd); return { S }; }
        const empieza = gb.equipo === 'parda' ? S.primero : gb.asiento;
        S.mesa.push([]); S.primero = empieza; S.turno = empieza;
      } else S.turno = (a + 1) % nJug(S);
      return { S };
    }
    if (tipo === 'cantar') {
      const k = accion.canto;
      if (!op.cantos.includes(k)) return { error: 'No podés cantar eso ahora' };
      S.log.push({ t: 'canto', asiento: a, canto: k });
      if (CANTO_TRUCO.includes(k)) {
        if (t.pendiente) t.querido = t.nivel; // "quiero retruco": acepta el anterior y sube
        t.nivel += 1; t.pendiente = { canto: k, equipo: miEq };
        return { S };
      }
      // envido, real o falta
      if (en.estado === 'cantando') { en.cantos.push(k); en.equipo = miEq; return { S }; }
      en.estado = 'cantando'; en.cantos = [k]; en.equipo = miEq;
      return { S };
    }
    if (tipo === 'quiero' || tipo === 'no_quiero') {
      if (!op.responder) return { error: 'No hay nada para contestar' };
      const q = tipo === 'quiero';
      S.log.push({ t: q ? 'quiero' : 'no_quiero', asiento: a });
      if (op.envidoResponde) {
        if (q) resolverEnvido(S);
        else { const pts = valoresEnvido(S).noQuiero; en.estado = 'cerrado'; en.resultado = { querido: false, equipo: en.equipo, puntos: pts }; sumar(S, en.equipo, pts, 'envido'); }
        return { S };
      }
      // truco pendiente
      const p = t.pendiente;
      if (q) { t.querido = t.nivel; t.sube = miEq; t.pendiente = null; return { S }; }
      t.pendiente = null;
      const pts = VALOR_TRUCO[t.nivel - 1];
      t.querido = t.nivel - 1; // lo que valía antes del canto
      resolverFlor(S);
      S.log.push({ t: 'fin_mano', equipo: p.equipo, motivo: 'no_quiero' });
      sumar(S, p.equipo, pts, 'truco');
      S.ultima_mano = { mesa: S.mesa, inicio: S.inicio, envido: en.resultado, flor: S.flor.resultado, equipo: p.equipo, motivo: 'no_quiero', puntos: pts };
      if (S.fase === 'jugando') repartir(S, rnd, false);
      return { S };
    }
    if (tipo === 'mazo') {
      if (!op.mazo) return { error: 'No podés irte al mazo ahora' };
      S.log.push({ t: 'mazo', asiento: a });
      if (t.pendiente) { t.querido = Math.max(t.querido, t.nivel - 1); t.pendiente = null; }
      terminarMano(S, otro(miEq), 'mazo', rnd);
      return { S };
    }
    return { error: 'Acción inválida' };
  }

  // lo que ve todo el mundo: sin las cartas en la mano (solo cuántas tiene cada uno) ni las iniciales de la mano en curso
  function publico(S) {
    const n = nJug(S);
    const P = JSON.parse(JSON.stringify(S));
    delete P.cartas; delete P.inicio;
    P.n_cartas = {}; for (let a = 0; a < n; a++) P.n_cartas[a] = (S.cartas[a] || []).length;
    P.flor = { cantaron: S.flor.con.filter((a) => yaJugo(S, a) || baza(S) > 0 || S.flor.resultado), resultado: S.flor.resultado };
    return P;
  }

  const TrucoLogica = { MAZO, PALOS, valorTruco, envidoDe, tieneFlor, florDe, nombreCarta, nuevo, repartir, opciones, aplicar, publico,
    ganadorBaza, ganadorMano, valoresEnvido, asientoDe, VALOR_TRUCO };
  if (typeof module !== 'undefined' && module.exports) module.exports = TrucoLogica;
  else g.TrucoLogica = TrucoLogica;
})(typeof window !== 'undefined' ? window : globalThis);
