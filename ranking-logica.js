// Lógica pura del ranking general (sin DOM). Los números son los mismos que usa la base en ranking() (la última
// versión está en dev/supabase/36-ajedrez.sql): si se cambia uno, cambiar los dos. En el navegador queda en window.RankingLogica.
(function (g) {
  const PUNTOS = {
    asistencia: 1000,     // ir a una actividad (lo confirma quien la armó): lo que más suma
    tercer: 300,          // ir al tercer tiempo
    organizar: 500,       // armar una actividad a la que fueron 3 o más
    triviaJugar: 50,      // Trivia con 2 o más jugadores
    triviaGanar: 150,     // + al que sale primero
    impostorJugar: 50,
    impostorGrupo: 100,   // + a cada uno del grupo si gana el grupo
    impostorImpostor: 250, // + al impostor si gana él
    ajedrezJugar: 50,     // partidas de 10 jugadas o más
    ajedrezGanar: 150,    // + al que gana
    ajedrezTablas: 50,    // + a cada uno si son tablas
  };
  const TOPE_PARTIDAS_DIA = 10;

  const nf = typeof Intl !== 'undefined' ? new Intl.NumberFormat('es-AR') : null;
  const numero = (n) => (nf ? nf.format(n || 0) : String(n || 0));
  const plural = (n, uno, varios) => numero(n) + ' ' + (n === 1 ? uno : varios);

  // las reglas, en el orden en que se muestran ("Cómo se suman")
  const REGLAS = [
    { clave: 'asistencia', titulo: 'Ir a una actividad', puntos: PUNTOS.asistencia, detalle: 'La confirma quien la armó. Es lo que más suma.', destacada: true },
    { clave: 'organizar', titulo: 'Armar una actividad', puntos: PUNTOS.organizar, detalle: 'Si fueron 3 o más, sin contarte.' },
    { clave: 'tercer', titulo: 'Ir al tercer tiempo', puntos: PUNTOS.tercer, detalle: 'También lo confirma quien la armó.' },
    { clave: 'ajedrez', titulo: 'Ajedrez', puntos: PUNTOS.ajedrezJugar, detalle: 'Partidas de 10 jugadas o más. +' + PUNTOS.ajedrezGanar + ' al que gana, +' + PUNTOS.ajedrezTablas + ' a cada uno si son tablas.' },
    { clave: 'impostor', titulo: 'El Impostor', puntos: PUNTOS.impostorJugar, detalle: '+' + PUNTOS.impostorGrupo + ' si gana el grupo, +' + PUNTOS.impostorImpostor + ' al impostor si gana él.' },
    { clave: 'trivia', titulo: 'Trivia', puntos: PUNTOS.triviaJugar, detalle: 'Con 2 o más jugadores. +' + PUNTOS.triviaGanar + ' al que sale primero.' },
  ];

  /** desglose de una fila de ranking(): solo lo que tiene puntos, de lo que más suma a lo que menos */
  function desglose(f) {
    const it = [
      { clave: 'asistencia', nombre: 'Actividades', puntos: f.asistencia || 0, n: f.n_asistencia || 0, cuenta: (n) => plural(n, 'actividad', 'actividades') },
      { clave: 'tercer', nombre: 'Tercer tiempo', puntos: f.tercer || 0, n: f.n_tercer || 0, cuenta: (n) => plural(n, 'vez', 'veces') },
      { clave: 'organizar', nombre: 'Organizar', puntos: f.organizar || 0, n: f.n_organizar || 0, cuenta: (n) => plural(n, 'actividad armada', 'actividades armadas') },
      { clave: 'trivia', nombre: 'Trivia', puntos: f.trivia || 0, n: f.n_trivia || 0, cuenta: (n) => plural(n, 'partida', 'partidas') },
      { clave: 'impostor', nombre: 'El Impostor', puntos: f.impostor || 0, n: f.n_impostor || 0, cuenta: (n) => plural(n, 'partida', 'partidas') },
      { clave: 'ajedrez', nombre: 'Ajedrez', puntos: f.ajedrez || 0, n: f.n_ajedrez || 0, cuenta: (n) => plural(n, 'partida', 'partidas') },
    ];
    return it.filter((x) => x.puntos > 0).sort((a, b) => b.puntos - a.puntos).map((x) => ({ clave: x.clave, nombre: x.nombre, puntos: x.puntos, detalle: x.cuenta(x.n) }));
  }

  /** puestos con empates (1, 1, 3) a partir de filas ya ordenadas por total */
  function puestos(filas) {
    let ant = null, puesto = 0;
    return (filas || []).map((f, i) => {
      if (f.total !== ant) { puesto = i + 1; ant = f.total; }
      return { ...f, puesto };
    });
  }

  const RankingLogica = { PUNTOS, TOPE_PARTIDAS_DIA, REGLAS, desglose, puestos, numero };
  if (typeof module !== 'undefined' && module.exports) module.exports = RankingLogica;
  else g.RankingLogica = RankingLogica;
})(typeof window !== 'undefined' ? window : globalThis);
