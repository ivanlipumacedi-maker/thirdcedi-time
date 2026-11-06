// Lógica pura de actividades (sin DOM): tipos, validación, cupo, participantes y vigencia.
(function (g) {
  const TIPOS = [
    { id: 'futbol', nombre: 'Fútbol', emoji: '⚽' },
    { id: 'padel', nombre: 'Pádel', emoji: '🎾' },
    { id: 'trekking', nombre: 'Trekking', emoji: '🥾' },
    { id: 'asado', nombre: 'Asado', emoji: '🍖' },
    { id: 'after', nombre: 'After', emoji: '🍻' },
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

  // Argentina no usa horario de verano: es siempre UTC-3. Los campos de fecha del formulario se escriben en esa hora.
  const OFFSET_ARG_MS = -3 * 3600 * 1000;
  function desdeInputArg(texto) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(texto || ''));
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - OFFSET_ARG_MS).toISOString();
  }
  function aInputArg(iso) {
    if (iso == null || iso === '' || Number.isNaN(ms(iso))) return '';
    return new Date(ms(iso) + OFFSET_ARG_MS).toISOString().slice(0, 16);
  }

  const ActividadesLogica = { TIPOS, validar, cupoLleno, participantes, esFutura, desdeInputArg, aInputArg };
  if (typeof module !== 'undefined' && module.exports) module.exports = ActividadesLogica;
  else g.ActividadesLogica = ActividadesLogica;
})(typeof window !== 'undefined' ? window : globalThis);
