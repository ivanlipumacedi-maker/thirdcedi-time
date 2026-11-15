// Lógica del ajedrez (sin DOM), sobre chess.js (vendor/chess.js, globalThis.Chess). La usan la app (ajedrez.js) y la
// Edge Function juegos (copia idéntica en dev/supabase/juegos/), que valida cada jugada antes de guardarla.
// estado_juego de una partida de ajedrez: { fase: 'jugando'|'final', fen, jugadas: [SAN...], blancas: uuid, negras: uuid,
//   ultima: { desde, hasta } | null, n: cantidad de jugadas, gano?: 'blancas'|'negras'|'tablas', motivo?, ahora_ms }
(function (g) {
  const Ch = () => g.Chess;
  const INICIO = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const MIN_JUGADAS_RANKING = 10; // una partida más corta no suma puntos (la base usa el mismo número)

  /** la partida rehecha desde las jugadas guardadas (así se detectan las repeticiones) */
  function rehacer(jugadas) {
    const c = new (Ch())();
    for (const san of jugadas || []) if (!c.move(san)) return null;
    return c;
  }

  /** cómo terminó (o null si sigue), mirando la posición después de la última jugada */
  function fin(c) {
    if (c.in_checkmate()) return { gano: c.turn() === 'w' ? 'negras' : 'blancas', motivo: 'mate' };
    if (c.in_stalemate()) return { gano: 'tablas', motivo: 'ahogado' };
    if (c.in_threefold_repetition()) return { gano: 'tablas', motivo: 'repeticion' };
    if (c.insufficient_material()) return { gano: 'tablas', motivo: 'material' };
    if (c.in_draw()) return { gano: 'tablas', motivo: 'cincuenta' };
    return null;
  }

  const colorDe = (e, uid) => (e && uid ? (e.blancas === uid ? 'w' : e.negras === uid ? 'b' : null) : null);

  /** aplica una jugada { desde, hasta, corona? } de quien juega con `color` sobre las jugadas guardadas.
   *  → { error } o { san, fen, jugadas, fin } */
  function jugar(jugadas, color, mov) {
    const c = rehacer(jugadas);
    if (!c) return { error: 'La partida guardada no es válida' };
    if (fin(c)) return { error: 'La partida terminó' };
    if (!color || c.turn() !== color) return { error: 'No es tu turno' };
    const desde = String((mov && mov.desde) || ''), hasta = String((mov && mov.hasta) || '');
    if (!/^[a-h][1-8]$/.test(desde) || !/^[a-h][1-8]$/.test(hasta)) return { error: 'Jugada inválida' };
    const corona = mov && mov.corona && /^[qrbn]$/.test(mov.corona) ? mov.corona : 'q';
    const r = c.move({ from: desde, to: hasta, promotion: corona });
    if (!r) return { error: 'Jugada inválida' };
    return { san: r.san, fen: c.fen(), jugadas: c.history(), fin: fin(c) };
  }

  /** las casillas a las que puede ir la pieza de `desde` (para marcarlas en el tablero) */
  function destinos(jugadas, desde) {
    const c = rehacer(jugadas);
    if (!c) return [];
    return c.moves({ square: desde, verbose: true }).map((m) => ({ hasta: m.to, corona: !!m.promotion }));
  }

  /** el tablero como matriz 8×8 desde la fila 8 (arriba) a la 1: null o { tipo: 'p'|'n'|'b'|'r'|'q'|'k', color: 'w'|'b' } */
  function tablero(fen) {
    const c = new (Ch())(fen || INICIO);
    return c.board().map((fila) => fila.map((x) => (x ? { tipo: x.type, color: x.color } : null)));
  }

  const NOMBRE_MOTIVO = { mate: 'Jaque mate', ahogado: 'Rey ahogado: tablas', repeticion: 'Tres veces la misma posición: tablas',
    material: 'No queda material para dar mate: tablas', cincuenta: '50 jugadas sin capturas ni peones: tablas', abandono: 'Abandonó' };

  const AjedrezLogica = { INICIO, MIN_JUGADAS_RANKING, rehacer, fin, colorDe, jugar, destinos, tablero, NOMBRE_MOTIVO };
  if (typeof module !== 'undefined' && module.exports) module.exports = AjedrezLogica;
  else g.AjedrezLogica = AjedrezLogica;
})(typeof window !== 'undefined' ? window : globalThis);
