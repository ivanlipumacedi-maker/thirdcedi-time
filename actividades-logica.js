// Lógica pura de actividades (sin DOM): tipos, validación, cupo, participantes y vigencia.
(function (g) {
  const TIPOS = [
    // icono: nombre para App.icono (ícono propio en img/iconos-propios); corto: el nombre en el filtro de la lista
    { id: 'futbol', nombre: 'Fútbol', corto: 'Fútbol', icono: 'futbol' },
    { id: 'padel', nombre: 'Pádel', corto: 'Pádel', icono: 'padel' },
    { id: 'trekking', nombre: 'Trekking', corto: 'Trekking', icono: 'trekking' },
    { id: 'asado', nombre: 'Asado', corto: 'Asado', icono: 'asado' },
    { id: 'after', nombre: 'After office', corto: 'After', icono: 'after' },
    { id: 'otra', nombre: 'Otra', corto: 'Otra', icono: 'otra' },
  ];

  // Cómo se llama el lugar según el tipo (en el formulario y en el detalle). destino: el tipo tiene además
  // "a dónde se va" (el trekking: se encuentran en un lado y caminan hasta otro).
  const LUGARES = {
    futbol: { etiqueta: 'Cancha', corto: 'Cancha', falta: 'la cancha', ejemplo: 'Ej.: Complejo El Potrero, cancha 3' },
    padel: { etiqueta: 'Club o cancha', corto: 'Cancha', falta: 'el club o la cancha', ejemplo: 'Ej.: Pádel Norte' },
    trekking: { etiqueta: 'Punto de encuentro', corto: 'Encuentro', falta: 'el punto de encuentro', ejemplo: 'Ej.: YPF de Panamericana y 197',
      destino: 'A dónde van (opcional)', destinoCorto: 'Destino', destinoFalta: 'a dónde se va', destinoEjemplo: 'Ej.: Cerro Uritorco' },
    asado: { etiqueta: 'Dónde es el asado', corto: 'Dónde', falta: 'dónde es el asado', ejemplo: 'Ej.: Quinta de Martín, Pilar' },
    after: { etiqueta: 'Bar o lugar', corto: 'Dónde', falta: 'el bar o el lugar', ejemplo: 'Ej.: Antares Palermo' },
    otra: { etiqueta: 'Lugar', corto: 'Dónde', falta: 'el lugar', ejemplo: '' },
  };
  const lugares = (tipo) => LUGARES[tipo] || LUGARES.otra;

  // ---- links de Google Maps (igual que la hoja de ruta de Rumbo al Sur) ----
  // solo dominios de Google de verdad (no cualquier "google.com.xx" que podría registrar otro)
  const TLD = new Set(['com', 'com.ar', 'cl', 'com.uy', 'com.py', 'com.bo', 'com.pe', 'com.br', 'com.mx', 'es', 'co', 'com.co', 'com.ec', 'co.ve', 'us', 'co.uk', 'fr', 'it', 'de']);
  const esGoogle = (h) => { const m = h.match(/^(?:www\.|maps\.)?google\.(.+)$/); return !!m && TLD.has(m[1]); };
  /** El link de Google Maps (normalizado) que haya en el texto, o null. Acepta el texto entero que copia Maps al
   *  compartir (nombre, dirección y el link, una cosa por renglón). */
  function linkMaps(texto) {
    const m = String(texto ?? '').match(/https?:\/\/[^\s<>"]+/i);
    if (!m) return null;
    let u; try { u = new URL(m[0]); } catch { return null; }
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    const h = u.hostname.toLowerCase();
    const ok = h === 'maps.app.goo.gl'
      || (h === 'goo.gl' && u.pathname.startsWith('/maps'))
      || (esGoogle(h) && (u.pathname.startsWith('/maps') || (h.startsWith('maps.') && u.pathname === '/')));
    return ok && u.href.length <= 600 ? u.href : null;
  }
  const buscarEnMaps = (lugar) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(String(lugar ?? '').trim());
  /** Lo que se guarda del campo del link: null si está vacío, el link limpio si es de Maps, o el texto tal cual (y
   *  validar avisa que no sirve). */
  function leerLink(texto) {
    const t = String(texto ?? '').trim();
    if (!t) return null;
    return linkMaps(t) || t;
  }
  const linkValido = (l) => l == null || l === '' || linkMaps(l) === l;
  const MSG_LINK = 'Ese link no es de Google Maps. En Maps tocá Compartir, copiá y pegalo acá.';
  /** Del texto que copia Maps al compartir, el nombre del lugar (la primera línea que no es el link), o ''. */
  function nombreCompartido(texto) {
    const t = String(texto ?? '');
    if (!linkMaps(t)) return '';
    const l = t.split(/\r?\n/).map((x) => x.trim()).find((x) => x && !/https?:\/\//i.test(x));
    return l ? l.slice(0, 120) : '';
  }
  /** Adónde lleva el botón de Maps: el link guardado si es válido; si no, una búsqueda por el nombre (o null). */
  function mapsDe(nombre, link) {
    const l = linkMaps(link);
    if (l && l === link) return { href: l, conLink: true };
    return vacio(nombre) ? null : { href: buscarEnMaps(nombre), conLink: false };
  }

  /** El link de Maps de una actividad anterior con el mismo lugar (sin importar mayúsculas ni espacios), o null.
   *  Mira el lugar y el del tercer tiempo; gana la más nueva. */
  function linkDeLugarConocido(nombre, actividades) {
    const k = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
    const n = k(nombre);
    if (!n) return null;
    let mejor = null;
    (actividades || []).forEach((a) => {
      [[a.lugar, a.lugar_link], [a.destino, a.destino_link], [a.tercer_lugar, a.tercer_link]].forEach(([l, link]) => {
        if (link && k(l) === n && linkMaps(link) === link && (!mejor || ms(a.fecha) > ms(mejor.fecha))) mejor = { fecha: a.fecha, link };
      });
    });
    return mejor ? mejor.link : null;
  }

  const ms = (f) => (f instanceof Date ? f.getTime() : Date.parse(f));
  const vacio = (s) => !String(s == null ? '' : s).trim();

  // Devuelve el mensaje de error (en español) o null si la actividad es válida.
  function validar(a) {
    if (!a) return 'Faltan los datos de la actividad.';
    if (vacio(a.titulo)) return 'Ponele un título a la actividad.';
    if (!TIPOS.some((t) => t.id === a.tipo)) return 'Elegí qué tipo de actividad es.';
    if (a.tipo === 'otra' && vacio(a.tipo_otro)) return 'Contanos qué actividad es.';
    if (a.fecha == null || a.fecha === '' || Number.isNaN(ms(a.fecha))) return 'Elegí el día y la hora.';
    if (vacio(a.lugar)) return 'Indicá ' + lugares(a.tipo).falta + '.';
    if (!linkValido(a.lugar_link) || !linkValido(a.destino_link)) return MSG_LINK;
    if (!vacio(a.destino_link) && vacio(a.destino)) return 'Poné el nombre de ' + (lugares(a.tipo).destinoFalta || 'a dónde se va') + '.';
    if (a.cupo != null && a.cupo !== '' && (!Number.isInteger(a.cupo) || a.cupo < 1)) return 'El cupo tiene que ser un número entero de 1 o más.';
    if (a.tiene_tercer) {
      if (vacio(a.tercer_lugar)) return 'Indicá el lugar del tercer tiempo.';
      if (!linkValido(a.tercer_link)) return MSG_LINK;
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

  const ActividadesLogica = { TIPOS, ZONA, lugares, linkMaps, buscarEnMaps, leerLink, nombreCompartido, mapsDe, linkDeLugarConocido, validar, cupoLleno, participantes, esFutura, editable, reactivable, anotadosQueSeQuitan, offsetMs, desdeInputArg, aInputArg };
  if (typeof module !== 'undefined' && module.exports) module.exports = ActividadesLogica;
  else g.ActividadesLogica = ActividadesLogica;
})(typeof window !== 'undefined' ? window : globalThis);
