// Lógica pura de actividades (sin DOM): tipos, validación, cupo, participantes y vigencia.
(function (g) {
  const TIPOS = [
    { id: 'futbol', nombre: 'Fútbol', emoji: '⚽' },
    { id: 'padel', nombre: 'Pádel', emoji: '🎾' },
    { id: 'trekking', nombre: 'Trekking', emoji: '🥾' },
    { id: 'asado', nombre: 'Asado', emoji: '🍖' },
    { id: 'after', nombre: 'After office', emoji: '🍻' },
    { id: 'otra', nombre: 'Otra', emoji: '✨' },
  ];

  const ms = (f) => (f instanceof Date ? f.getTime() : Date.parse(f));
  const vacio = (s) => !String(s == null ? '' : s).trim();

  // Devuelve el mensaje de error (en español) o null si la actividad es válida.
  function validar(a) {
    if (!a) return 'Faltan los datos de la actividad.';
    if (vacio(a.titulo)) return 'Ponele un título a la actividad.';
    if (!TIPOS.some((t) => t.id === a.tipo)) return 'Elegí qué tipo de actividad es.';
    if (a.tipo === 'otra' && vacio(a.tipo_otro)) return 'Contanos qué actividad es.';
    if (a.fecha == null || a.fecha === '' || Number.isNaN(ms(a.fecha))) return 'Elegí el día y la hora.';
    if (vacio(a.lugar)) return 'Indicá el lugar.';
    if (a.cupo != null && a.cupo !== '' && (!Number.isInteger(a.cupo) || a.cupo < 1)) return 'El cupo tiene que ser un número entero de 1 o más.';
    if (a.tiene_tercer) {
      if (vacio(a.tercer_lugar)) return 'Indicá el lugar del tercer tiempo.';
      if (a.tercer_fecha == null || a.tercer_fecha === '' || Number.isNaN(ms(a.tercer_fecha))) return 'Elegí el día y la hora del tercer tiempo.';
      if (ms(a.tercer_fecha) < ms(a.fecha)) return 'El tercer tiempo no puede ser antes que la actividad.';
    }
    return null;
  }

  const deActividad = (actId, asistencias) => (asistencias || []).filter((s) => s.actividad === actId);

  // El cupo cuenta solo a los anotados a la parte 'actividad'; sin cupo nunca se llena.
  function cupoLleno(a, asistencias) {
    if (!a || a.cupo == null) return false;
    return deActividad(a.id, asistencias).filter((s) => s.parte === 'actividad').length >= a.cupo;
  }

  // Personas anotadas: de una parte, o la unión sin repetidos si no se indica parte.
  function participantes(actId, asistencias, parte) {
    const out = [];
    deActividad(actId, asistencias).forEach((s) => {
      if ((!parte || s.parte === parte) && out.indexOf(s.persona) < 0) out.push(s.persona);
    });
    return out;
  }

  // Sigue vigente hasta que termina lo último: el tercer tiempo si es posterior a la actividad.
  function esFutura(a, ahora) {
    let fin = ms(a.fecha);
    if (a.tiene_tercer && a.tercer_fecha != null) {
      const t = ms(a.tercer_fecha);
      if (t > fin) fin = t;
    }
    return fin > ahora;
  }

  // Una actividad cancelada queda congelada: no se edita ni se confirma (la base también lo bloquea). Solo se reactiva.
  function editable(a) { return !!a && a.estado !== 'cancelada'; }
  // Una cancelada se puede reactivar (vuelve a 'abierta', con los mismos anotados y el chat): solo quien la creó
  // y solo si todavía no pasó la fecha de la actividad. A propósito NO usa esFutura: el tercer tiempo no cuenta
  // (decisión de Ivan, "solo si todavía no pasó la fecha"). La base exige lo mismo: old.fecha > now() (10).
  function reactivable(a, ahora, yo) { return !!a && a.estado === 'cancelada' && !!yo && a.creador === yo && ms(a.fecha) > ahora; }

  // Cuántas personas anotadas al tercer tiempo se quitan si la edición lo apaga (la base las borra con un trigger).
  function anotadosQueSeQuitan(antes, despues, asistencias) {
    if (!antes || !antes.tiene_tercer || !despues || despues.tiene_tercer) return 0;
    return participantes(antes.id, asistencias, 'tercer').length;
  }

  // Los campos de fecha del formulario se escriben en hora de Argentina. El desfase no es fijo: se calcula con
  // Intl para cada instante (Argentina tuvo horario de verano y podría volver a tenerlo).
  const ZONA = 'America/Argentina/Buenos_Aires';
  const formatos = new Map();
  function formato(zona) {
    if (!formatos.has(zona)) {
      formatos.set(zona, new Intl.DateTimeFormat('en-US', { timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }
    return formatos.get(zona);
  }
  // Desfase de la zona respecto de UTC en ese instante, en ms (Argentina hoy: -3 h).
  function offsetMs(instante, zona = ZONA) {
    const p = {};
    formato(zona).formatToParts(new Date(instante)).forEach((x) => { p[x.type] = +x.value; });
    const comoUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
    return comoUTC - (Math.floor(instante / 1000) * 1000);
  }
  // Hora de pared -> instante UTC. Una hora que no existe (cae en el hueco del salto de primavera) se interpreta
  // con el desfase de después del salto: en Nueva York, 02:30 del 8/3/2026 da 06:30Z, que en la pared se lee 01:30.
  // No se valida ni se avisa: Argentina hoy no tiene horario de verano. Una hora repetida (otoño) da la primera.
  function desdeInputArg(texto, zona = ZONA) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(texto || ''));
    if (!m) return null;
    const pared = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    // se prueba con el desfase de la hora "de pared" y se corrige si del otro lado del cambio de hora es otro
    let t = pared - offsetMs(pared, zona);
    const o2 = offsetMs(t, zona);
    if (pared - o2 !== t) t = pared - o2;
    return new Date(t).toISOString();
  }
  function aInputArg(iso, zona = ZONA) {
    if (iso == null || iso === '' || Number.isNaN(ms(iso))) return '';
    const t = ms(iso);
    return new Date(t + offsetMs(t, zona)).toISOString().slice(0, 16);
  }

  const ActividadesLogica = { TIPOS, ZONA, validar, cupoLleno, participantes, esFutura, editable, reactivable, anotadosQueSeQuitan, offsetMs, desdeInputArg, aInputArg };
  if (typeof module !== 'undefined' && module.exports) module.exports = ActividadesLogica;
  else g.ActividadesLogica = ActividadesLogica;
})(typeof window !== 'undefined' ? window : globalThis);
