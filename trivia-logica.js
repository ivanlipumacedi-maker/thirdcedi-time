// Lógica pura de la Trivia (sin DOM): elegir preguntas, puntaje por rapidez, ranking con empates y cuenta regresiva.
// La partida real la maneja la base (dev/supabase/12-juegos.sql): elige las preguntas, valida el tiempo con now()
// y calcula los puntos con la MISMA fórmula que puntos() de acá. elegir() la usa el mock de la UI y sirve de
// referencia para las cuotas por dificultad que usa el servidor (4 fáciles, 4 medias y 2 difíciles en 10).
(function (g) {
  const PREGUNTAS_POR_PARTIDA = 10;
  const PREGUNTA_MS = 15000;   // tiempo para responder
  const REVELADA_MS = 8000;    // cuánto queda la respuesta correcta a la vista antes de pasar sola a la siguiente
  const GRACIA_MS = 1000;      // el servidor acepta respuestas hasta 1 s después del límite (por la red)

  // PRNG chico y determinístico (mulberry32): misma semilla, misma secuencia.
  function azar(semilla) {
    let a = (semilla >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function mezclar(xs, r) {
    const a = xs.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  // Cuántas de cada dificultad: 40 % fáciles, 20 % difíciles, el resto medias.
  function cuotas(n) {
    const d1 = Math.round(n * 0.4), d3 = Math.round(n * 0.2);
    return { 1: d1, 2: n - d1 - d3, 3: d3 };
  }

  // n preguntas sin repetir, mezclando dificultades según cuotas(); si una dificultad no alcanza se completa con
  // las otras. No modifica el banco.
  function elegir(banco, n, semilla) {
    const r = azar(semilla);
    const q = cuotas(n);
    const elegidas = [];
    const sobrantes = [];
    [1, 2, 3].forEach((d) => {
      const de = mezclar(banco.filter((p) => p.dif === d), r);
      elegidas.push(...de.slice(0, q[d]));
      sobrantes.push(...de.slice(q[d]));
    });
    const otras = banco.filter((p) => [1, 2, 3].indexOf(p.dif) < 0);
    const resto = mezclar(sobrantes.concat(otras), r);
    while (elegidas.length < n && resto.length) elegidas.push(resto.shift());
    return mezclar(elegidas, r);
  }

  // Como trivia_elegir de la base (dev/supabase/18-juegos-cierre.sql): por dificultad (cuotas), primero las que no
  // vio ningún jugador, al azar, y si no alcanzan, las vistas hace más tiempo. vistas: { id: cuándo la vio alguno
  // de los jugadores por última vez (ms) }. Si una dificultad no alcanza se completa con las otras, como elegir().
  function elegirSinRepetir(banco, n, vistas, semilla) {
    const r = azar(semilla);
    const q = cuotas(n);
    const v = vistas || {};
    const cuando = (p) => (Object.prototype.hasOwnProperty.call(v, p.id) ? v[p.id] : -Infinity);
    const ordenar = (xs) => mezclar(xs, r).sort((a, b) => cuando(a) - cuando(b)); // sort es estable: el azar desempata
    const elegidas = [];
    const sobrantes = [];
    [1, 2, 3].forEach((d) => {
      const de = ordenar(banco.filter((p) => p.dif === d));
      elegidas.push(...de.slice(0, q[d]));
      sobrantes.push(...de.slice(q[d]));
    });
    const resto = ordenar(sobrantes.concat(banco.filter((p) => [1, 2, 3].indexOf(p.dif) < 0)));
    while (elegidas.length < n && resto.length) elegidas.push(resto.shift());
    return mezclar(elegidas, r);
  }

  // Qué avisar cuando la base rechaza una respuesta: fuera de tiempo (o ya revelada por otro dentro de la gracia)
  // no suma; "Ya respondiste" (otra pestaña) no se avisa: devuelve null.
  function textoErrorRespuesta(mensaje) {
    const m = mensaje || '';
    if (/Ya respondiste/.test(m)) return null;
    if (/Se terminó el tiempo|No hay una pregunta abierta/.test(m)) return 'Se terminó el tiempo: esta no suma.';
    return 'No pudimos mandar tu respuesta. Probá de nuevo.';
  }

  // La línea de arriba del ranking final para `yo` (filas de ranking()). null si no jugué.
  function textoPuesto(filas, yo) {
    const mio = filas.find((f) => f.persona === yo);
    if (!mio) return null;
    if (filas.length === 1) return 'Hiciste ' + mio.puntos.toLocaleString('es-AR') + ' puntos.';
    if (mio.puesto === 1) return filas.filter((f) => f.puesto === 1).length > 1 ? '¡Empataste el primer puesto!' : '¡Ganaste!';
    return 'Terminaste ' + mio.puesto + '°.';
  }

  // 0 si es incorrecta; si es correcta, de 1000 (al instante) a 500 (al límite), lineal y redondeado.
  // El servidor usa: round(1000 - 500 * least(greatest(ms, 0), limite) / limite).
  function puntos(correcta, ms, limiteMs) {
    if (!correcta) return 0;
    const t = Math.min(Math.max(Number(ms) || 0, 0), limiteMs);
    return Math.round(1000 - (500 * t) / limiteMs);
  }

  // De mayor a menor; los empatados comparten puesto (1, 1, 3). Entre empatados se respeta el orden de entrada.
  function ranking(jugadores) {
    const orden = jugadores.map((j, i) => ({ j, i })).sort((a, b) => (b.j.puntos - a.j.puntos) || (a.i - b.i));
    return orden.map(({ j }) => ({ persona: j.persona, puntos: j.puntos, puesto: 1 + jugadores.filter((x) => x.puntos > j.puntos).length }));
  }

  // Milisegundos que faltan para `limiteMs` (hora del servidor), sabiendo que el servidor va `desfase` ms
  // adelante del reloj de este teléfono. Nunca negativo.
  function restante(limiteMs, ahoraCliente, desfase) {
    return Math.max(0, limiteMs - (ahoraCliente + desfase));
  }

  const TriviaLogica = { PREGUNTAS_POR_PARTIDA, PREGUNTA_MS, REVELADA_MS, GRACIA_MS, elegir, elegirSinRepetir, puntos, ranking, restante, cuotas, textoErrorRespuesta, textoPuesto };
  if (typeof module !== 'undefined' && module.exports) module.exports = TriviaLogica;
  else g.TriviaLogica = TriviaLogica;
})(typeof window !== 'undefined' ? window : globalThis);
