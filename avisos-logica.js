// Lógica pura de los avisos push (sin DOM ni red): recordatorio de las 12, textos y agrupado de mensajes.
// La usa la Edge Function "avisos" (copia idéntica en dev/supabase/avisos/avisos-logica.js; un test lo verifica).
(function (g) {
  const ZONA = 'America/Argentina/Buenos_Aires';
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  const ms = (f) => (typeof f === 'number' ? f : f instanceof Date ? f.getTime() : Date.parse(f));
  const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' });
  const fmtHora = new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

  // 'YYYY-MM-DD' del instante en hora de Argentina.
  function diaART(t) { return fmtDia.format(new Date(ms(t))); }
  function horaART(t) { return fmtHora.format(new Date(ms(t))); }
  // Días de calendario (en Argentina) entre dos instantes.
  function diasEntre(desde, hasta) {
    const d = (s) => { const [y, m, dd] = s.split('-').map(Number); return Date.UTC(y, m - 1, dd); };
    return Math.round((d(diaART(hasta)) - d(diaART(desde))) / 864e5);
  }

  // Sigue vigente hasta que termina lo último (igual que ActividadesLogica.esFutura).
  function fin(a) {
    let f = ms(a.fecha);
    if (a.tiene_tercer && a.tercer_fecha != null) { const t = ms(a.tercer_fecha); if (t > f) f = t; }
    return f;
  }

  const actividadPendiente = (a, ahora) => ms(a.fecha) > ahora;
  const tercerPendiente = (a, ahora) => !!(a.tiene_tercer && a.tercer_fecha != null && ms(a.tercer_fecha) > ahora);

  // Review Focus 4. Una confirmada que todavía no terminó: un aviso por día (hasta el día del evento inclusive) a cada
  // anotado, sin repetir. Quien está anotado solo a la actividad lo recibe mientras la actividad no empezó; quien está
  // en el tercer tiempo, mientras quede algo por delante. Abierta, cancelada o ya pasada: nada.
  function recordatoriosDiarios(actividades, asistencias, ahora) {
    const out = [];
    const vistos = new Set();
    (actividades || []).forEach((a) => {
      if (!a || a.estado !== 'confirmada' || !(fin(a) > ahora)) return;
      const act = actividadPendiente(a, ahora), ter = act || tercerPendiente(a, ahora);
      (asistencias || []).forEach((s) => {
        if (s.actividad !== a.id) return;
        if (!(s.parte === 'tercer' ? ter : act)) return;
        const k = a.id + '|' + s.persona;
        if (vistos.has(k)) return;
        vistos.add(k);
        out.push({ persona: s.persona, actividad: a.id });
      });
    });
    return out;
  }

  function etiquetaDia(t, ahora) {
    const n = diasEntre(ahora, t);
    if (n <= 0) return 'Hoy';
    if (n === 1) return 'Mañana';
    const [y, mm, dd] = diaART(t).split('-').map(Number);
    const semana = DIAS[new Date(Date.UTC(y, mm - 1, dd)).getUTCDay()];
    return 'El ' + semana + ' ' + dd + '/' + mm;
  }

  const urlActividad = (id) => '#/actividad/' + id;
  function urlSala(sala) {
    const [tipo, id] = String(sala || '').split(':');
    return tipo === 'par' ? '#/juegos/' + id : urlActividad(id);
  }
  const titulo = (a) => String((a && a.titulo) || 'una actividad');
  const cuando = (a, ahora) => etiquetaDia(ms(a.fecha), ahora) + ' a las ' + horaART(a.fecha);

  function textoDiario(a, ahora) {
    const base = { tag: 'diario-' + a.id, url: urlActividad(a.id) };
    // la actividad ya pasó y queda el tercer tiempo: el aviso es del tercer tiempo
    if (!actividadPendiente(a, ahora) && tercerPendiente(a, ahora)) {
      return {
        title: etiquetaDia(ms(a.tercer_fecha), ahora) + ': Tercer tiempo de ' + titulo(a) + ' a las ' + horaART(a.tercer_fecha),
        body: 'En ' + (a.tercer_lugar || a.lugar || ''),
        ...base,
      };
    }
    return {
      title: etiquetaDia(ms(a.fecha), ahora) + ': ' + titulo(a) + ' a las ' + horaART(a.fecha),
      body: 'En ' + (a.lugar || '') + (a.tiene_tercer && a.tercer_lugar ? '\nTercer tiempo: ' + a.tercer_lugar + ' a las ' + horaART(a.tercer_fecha) : ''),
      ...base,
    };
  }

  // tipo: 'nueva' | 'confirmada' | 'cambio' | 'cancelada' | 'reabierta' (vuelve a abierta, desde confirmada o cancelada). nombre: quien hizo el cambio.
  function textoActividad(tipo, a, nombre, ahora) {
    const t = ahora == null ? Date.now() : ahora;
    const datos = cuando(a, t) + ' · ' + (a.lugar || '');
    let title, body;
    if (tipo === 'nueva') { title = 'Nueva actividad: ' + titulo(a); body = datos + '\nLa armó ' + (nombre || 'un compañero') + '.'; }
    else if (tipo === 'confirmada') { title = 'Se confirmó ' + titulo(a); body = datos; }
    else if (tipo === 'cancelada') { title = 'Se canceló ' + titulo(a); body = (nombre || 'Quien la armó') + ' la canceló.'; }
    else if (tipo === 'reabierta') { title = titulo(a) + ' volvió a estar abierta'; body = datos; }
    else { title = 'Cambió ' + titulo(a); body = 'Ahora: ' + datos; }
    return { title, body, tag: 'act-' + a.id, url: urlActividad(a.id) };
  }

  // Varios eventos de la misma actividad en la misma tanda → un solo aviso.
  function fusionarActividad(tipos) {
    if (tipos.indexOf('nueva') >= 0) return 'nueva';
    // manda el último cambio de estado; si no hubo, es un cambio de fecha o lugar
    for (let i = tipos.length - 1; i >= 0; i--) {
      if (tipos[i] === 'confirmada' || tipos[i] === 'cancelada' || tipos[i] === 'reabierta') return tipos[i];
    }
    return 'cambio';
  }

  function resumenMensaje(m) {
    if (!m) return '';
    if (m.tipo === 'foto') return 'Foto';
    if (m.tipo === 'audio') return 'Audio';
    if (m.tipo === 'video') return 'Video';
    if (m.tipo === 'sticker') return 'Sticker';
    const t = Array.from(String(m.texto || '').trim().replace(/\s+/g, ' '));
    return t.length > 80 ? t.slice(0, 79).join('') + '…' : t.join('');
  }

  const primerNombre = (n) => String(n || '').trim().split(/\s+/)[0] || 'Alguien';
  function textoMensajes(tituloSala, nombre, mensajes) {
    const n = (mensajes || []).length;
    const quien = primerNombre(nombre);
    if (n <= 1) return { title: tituloSala, body: quien + ': ' + resumenMensaje(mensajes && mensajes[0]) };
    const ult = mensajes.slice(-3).map((m) => '• ' + resumenMensaje(m));
    return { title: tituloSala, body: quien + ' mandó ' + n + ' mensajes:\n' + ult.join('\n') };
  }

  function tituloPartida(juego, nombreCreador) {
    return (juego === 'impostor' ? 'El Impostor' : 'Trivia') + ' de ' + primerNombre(nombreCreador);
  }

  // Grupos (sala, autor) de eventos de mensaje listos para avisar: el autor dejó de escribir hace `silencio` ms,
  // o el primero espera hace más de `maxEspera` (alguien que no para igual avisa).
  function mensajesListos(eventos, ahora, opc) {
    const silencio = (opc && opc.silencio) || 60000, maxEspera = (opc && opc.maxEspera) || 600000;
    const grupos = new Map();
    (eventos || []).forEach((e) => {
      if (e.tipo !== 'mensaje' || !e.sala) return;
      const k = e.sala + '|' + e.autor;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(e);
    });
    const out = [];
    grupos.forEach((g) => {
      const tiempos = g.map((e) => ms(e.creado));
      const ultimo = Math.max(...tiempos), primero = Math.min(...tiempos);
      if (ahora - ultimo < silencio && ahora - primero < maxEspera) return;
      out.push({ sala: g[0].sala, autor: g[0].autor, ids: g.map((e) => e.id), mensajes: g.map((e) => e.mensaje) });
    });
    return out;
  }

  // ---- Avisos para una sola persona (33): reclamos en Cuentas claras y bajas de una actividad ----
  const PERSONALES = ['gasto_rechazo', 'gasto_sumado', 'pago_objetado', 'baja'];
  /** Junta los eventos personales por tipo, destino, autor y sala: una tanda de varios gastos es un solo aviso. */
  function agruparPersonales(eventos) {
    const g = new Map();
    (eventos || []).forEach((e) => {
      if (PERSONALES.indexOf(e.tipo) < 0 || !e.destino || !e.sala || !/^act:/.test(e.sala)) return;
      const k = [e.tipo, e.destino, e.autor, e.sala].join('|');
      if (!g.has(k)) g.set(k, { tipo: e.tipo, destino: e.destino, autor: e.autor, sala: e.sala, ids: [], detalles: [] });
      const x = g.get(k);
      x.ids.push(e.id);
      if (e.detalle && x.detalles.indexOf(e.detalle) < 0) x.detalles.push(e.detalle);
    });
    return [...g.values()];
  }
  let nfP = null;
  const pesosP = (n) => { if (!nfP) nfP = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }); return '$ ' + nfP.format(Number(n) || 0); };
  const comillas = (xs) => xs.map((c) => '"' + c + '"').join(', ');
  /** grupo: de agruparPersonales; tituloAct: el título de la actividad; nombre: quien hizo la acción */
  function textoPersonal(grupo, tituloAct, nombre) {
    const quien = nombre || 'Un compañero';
    const act = String(tituloAct || 'una actividad');
    const id = String(grupo.sala).split(':')[1];
    const base = { tag: grupo.tipo + '-' + id, url: urlActividad(id) };
    const ds = grupo.detalles || [];
    if (grupo.tipo === 'gasto_rechazo') {
      return { title: 'Cuentas de ' + act, body: quien + ' dice que no estuvo en ' + (ds.length ? comillas(ds) : 'un gasto') + '. Ya no figura en ' + (ds.length > 1 ? 'esos gastos.' : 'ese gasto.'), ...base };
    }
    if (grupo.tipo === 'gasto_sumado') {
      return { title: 'Cuentas de ' + act, body: quien + ' te volvió a sumar a ' + (ds.length ? comillas(ds) : 'un gasto') + '.', ...base };
    }
    if (grupo.tipo === 'pago_objetado') {
      const partes = ds.map((d) => { const [k, m] = String(d).split(':'); return (k === 'no_recibio' ? 'no recibió ' : 'no hizo el pago de ') + pesosP(m); });
      return { title: 'Cuentas de ' + act, body: quien + ' dice que ' + (partes.length ? partes.join(' y ') : 'no reconoce un pago') + '. Ese pago no cuenta hasta que lo arreglen.', ...base };
    }
    // baja
    const soloTercer = ds.length > 0 && ds.indexOf('actividad') < 0;
    return { title: act, body: quien + (soloTercer ? ' se bajó del tercer tiempo.' : ' se bajó.'), ...base };
  }

  const AvisosLogica = { ZONA, diaART, horaART, recordatoriosDiarios, etiquetaDia, textoDiario, textoActividad, fusionarActividad, resumenMensaje, textoMensajes, tituloPartida, urlSala, urlActividad, mensajesListos, PERSONALES, agruparPersonales, textoPersonal };
  if (typeof module !== 'undefined' && module.exports) module.exports = AvisosLogica;
  else g.AvisosLogica = AvisosLogica;
})(typeof window !== 'undefined' ? window : globalThis);
