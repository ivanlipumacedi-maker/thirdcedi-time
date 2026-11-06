// Lógica pura de El Impostor (sin DOM): repartir las palabras, contar los votos, decidir quién gana y si la
// partida sigue cuando alguien se va. La partida real la maneja la base (dev/supabase/14-impostor.sql) con las
// MISMAS reglas: elige el par y el impostor, guarda el secreto en una tabla privada y le da a cada uno solo su
// palabra (mi_palabra). repartir() la usa el mock de la UI; resultado() y sigue() son la referencia del servidor.
(function (g) {
  const PALABRA_MS = 10000;    // para leer la palabra antes de las pistas
  const PISTAS_MS = 120000;    // para escribir la pista en el chat
  const VOTACION_MS = 60000;   // para votar

  // PRNG chico y determinístico (mulberry32), el mismo de TriviaLogica: misma semilla, misma secuencia.
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

  // A uno al azar le toca par.impostor; al resto, par.palabra. Nadie sabe si es el impostor: solo ve su palabra.
  function repartir(jugadores, par, semilla) {
    const r = azar(semilla);
    const impostor = jugadores[Math.floor(r() * jugadores.length)];
    const palabras = new Map(jugadores.map((j) => [j, j === impostor ? par.impostor : par.palabra]));
    return { impostor, palabras };
  }

  // votos: Map votante -> votado. Devuelve { persona: cantidad }.
  function conteo(votos) {
    const c = {};
    votos.forEach((a) => { c[a] = (c[a] || 0) + 1; });
    return c;
  }

  // El más votado queda expulsado si es el único con más votos; empate o sin votos → nadie (y gana el impostor).
  // Gana el grupo solo si el expulsado es el impostor.
  function resultado(votos, impostor) {
    const c = conteo(votos);
    const max = Math.max(0, ...Object.values(c));
    const top = Object.keys(c).filter((k) => c[k] === max);
    const expulsado = max > 0 && top.length === 1 ? top[0] : null;
    return { expulsado, ganoGrupo: expulsado !== null && expulsado === impostor };
  }

  // Después de que alguien se va (se_fue): si el impostor ya no está, gana el grupo; si quedan 2 o menos con el
  // impostor adentro, ya no se puede votar con sentido y gana el impostor; si no, sigue con los que quedan.
  function sigue(jugadoresActivos, impostor) {
    if (!jugadoresActivos.includes(impostor)) return 'gana_grupo';
    if (jugadoresActivos.length <= 2) return 'gana_impostor';
    return 'sigue';
  }

  // Milisegundos que faltan para `limiteMs` (hora del servidor); el servidor va `desfase` ms adelante. Nunca negativo.
  function restante(limiteMs, ahoraCliente, desfase) {
    return Math.max(0, limiteMs - (ahoraCliente + desfase));
  }

  const ImpostorLogica = { PALABRA_MS, PISTAS_MS, VOTACION_MS, repartir, conteo, resultado, sigue, restante };
  if (typeof module !== 'undefined' && module.exports) module.exports = ImpostorLogica;
  else g.ImpostorLogica = ImpostorLogica;
})(typeof window !== 'undefined' ? window : globalThis);
