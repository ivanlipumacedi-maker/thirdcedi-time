// Lógica pura del chat de ThirdCEDI Time (sin DOM). En el navegador queda en window.ChatLogica.
(function (g) {
  const REACCIONES = ['❤️', '😂', '😮', '😢', '👍', '🔥'];
  const MAX_TEXTO = 2000;

  const textoValido = (s) => { const t = String(s ?? '').trim(); return t.length >= 1 && t.length <= MAX_TEXTO; };

  function resumen(m) {
    if (m.tipo === 'eliminado') return '🚫 Se eliminó este mensaje';
    if (m.tipo === 'foto') return '📷 Foto';
    if (m.tipo === 'audio') return '🎤 Audio';
    if (m.tipo === 'sticker') return 'Sticker';
    const t = String(m.texto ?? '').trim();
    return t.length > 80 ? t.slice(0, 79) + '…' : t;
  }

  // responder citando
  const textoCita = (original) => (!original || original.tipo === 'eliminado' ? 'Mensaje eliminado' : resumen(original));
  /** ids citados que no están en la lista ni se buscaron ya (citados: Map id → mensaje|null) */
  function citasFaltantes(lista, citados) {
    const hay = new Set(lista.map((m) => m.id));
    return [...new Set(lista.map((m) => m.responde_a).filter((id) => id && !hay.has(id) && !citados.has(id)))];
  }

  // tildes de mis mensajes: estado = { entregado, leido } del otro (hasta qué mensaje recibió / vio)
  function tilde(m, yo, estado) {
    if (m.autor !== yo || m.tipo === 'eliminado') return null;
    if (String(m.id).startsWith('tmp-')) return 'reloj';
    const c = Date.parse(m.creado), hasta = (t) => (t ? Date.parse(t) >= c : false);
    return hasta(estado?.leido) ? 'leido' : hasta(estado?.entregado) ? 'entregado' : 'enviado';
  }
  const EDITAR_MS = 15 * 60 * 1000;
  const puedeEditar = (m, yo, ahora = Date.now()) => m.autor === yo && m.tipo === 'texto' && !String(m.id).startsWith('tmp-') && ahora - Date.parse(m.creado) < EDITAR_MS;

  const fmtHM = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' });
  /** "últ. vez hoy a las 14:05" / "ayer a las" / "el 10/11 a las" */
  function ultimaVez(t, ahora = Date.now()) {
    if (!t) return '';
    const d = new Date(t), hoy = fmtDia.format(new Date(ahora)), ayer = fmtDia.format(new Date(ahora - 864e5)), dia = fmtDia.format(d), hm = fmtHM.format(d);
    if (dia === hoy) return 'últ. vez hoy a las ' + hm;
    if (dia === ayer) return 'últ. vez ayer a las ' + hm;
    return 'últ. vez el ' + dia.slice(8, 10) + '/' + dia.slice(5, 7) + ' a las ' + hm;
  }
  /** patrón ILIKE para buscar en el chat, con % y _ escapados (null si no hay nada que buscar) */
  function patronBusqueda(q) { const t = String(q ?? '').split('*').join('').trim(); /* PostgREST toma el asterisco como comodín */ return t ? '%' + t.replace(/[\\%_]/g, (c) => '\\' + c) + '%' : null; }

  const porFecha = (a, b) => Date.parse(a.creado) - Date.parse(b.creado);
  // un eliminado no vuelve: una respuesta o un broadcast atrasado (reacción, edición) no lo pisa
  const fusionar = (lista, m) => { const prev = lista.find((x) => x.id === m.id); if (prev?.tipo === 'eliminado' && m.tipo !== 'eliminado') return lista; return [...lista.filter((x) => x.id !== m.id), m].sort(porFecha); };
  /** mezcla un lote (recarga tras reconectar) sin duplicar ni resucitar eliminados */
  const fusionarLote = (lista, ms) => ms.reduce((acc, m) => fusionar(acc, m), lista);
  const quitar = (lista, id) => lista.filter((x) => x.id !== id);
  const noLeidos = (lista, yo, vistoHasta) => lista.filter((m) => m.autor !== yo && Date.parse(m.creado) > vistoHasta).length;

  function alternarReaccion(reacciones, yo, emoji) {
    const r = { ...(reacciones || {}) };
    if (r[yo] === emoji) delete r[yo]; else r[yo] = emoji;
    return r;
  }

  const horaCorta = (iso) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Argentina/Buenos_Aires' });

  const ultimoCreado = (lista) => lista.reduce((max, m) => Math.max(max, Date.parse(m.creado) || 0), 0);

  // recientes = la última página que devolvió el servidor (tam = tamaño de página). Lo que el servidor
  // ya no tiene en ese tramo (borrado mientras no escuchábamos) desaparece; lo más viejo cargado se conserva.
  function reconciliar(lista, recientes, tam) {
    if (recientes.length < tam) return [...recientes].sort(porFecha);
    const corte = Math.min(...recientes.map((m) => Date.parse(m.creado)));
    return [...lista.filter((m) => Date.parse(m.creado) < corte), ...recientes].sort(porFecha);
  }

  function escalar(ancho, alto, max) {
    const f = Math.min(1, max / Math.max(ancho, alto));
    return { ancho: Math.round(ancho * f), alto: Math.round(alto * f) };
  }
  const duracionTexto = (ms) => { const s = Math.round((ms || 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const CARPETAS = { foto: ['fotos', 'webp'], audio: ['audios', 'webm'], perfil: ['perfil', 'webp'], sticker: ['stickers', 'webp'] };
  const rutaArchivo = (sala, tipo, id) => `${sala}/${CARPETAS[tipo][0]}/${id}.${CARPETAS[tipo][1]}`;
  const AUDIO_MIN_MS = 700, AUDIO_MAX_MS = 120000;
  const audioValido = (ms) => ms >= AUDIO_MIN_MS && ms <= AUDIO_MAX_MS;
  const textoSticker = (s) => String(s ?? '').trim().toUpperCase().slice(0, 30);
  const externoValido = (u) => typeof u === 'string' && /^https:\/\/media[0-9]*\.giphy\.com\//.test(u);
  // texto del sticker en 1 o 2 líneas, cortando por palabras (~16 caracteres la primera)
  function lineasSticker(s, max = 16) {
    const palabras = textoSticker(s).split(/\s+/).filter(Boolean);
    if (!palabras.length) return [];
    let primera = palabras[0], i = 1;
    while (i < palabras.length && (primera + ' ' + palabras[i]).length <= max) primera += ' ' + palabras[i++];
    return i < palabras.length ? [primera, palabras.slice(i).join(' ')] : [primera];
  }

  const L = { REACCIONES, MAX_TEXTO, textoValido, resumen, textoCita, citasFaltantes, tilde, puedeEditar, EDITAR_MS, ultimaVez, patronBusqueda, fusionar, fusionarLote, quitar, noLeidos, alternarReaccion, horaCorta, ultimoCreado, reconciliar,
    escalar, duracionTexto, rutaArchivo, AUDIO_MIN_MS, AUDIO_MAX_MS, audioValido, textoSticker, externoValido, lineasSticker };
  if (typeof module !== 'undefined' && module.exports) module.exports = L; else g.ChatLogica = L;
})(this);
