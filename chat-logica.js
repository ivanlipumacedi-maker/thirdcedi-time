// Lógica pura del chat de ThirdCEDI Time (sin DOM). En el navegador queda en window.ChatLogica.
// Alcance: texto, fotos, audios, videos, stickers (del grupo y de GIPHY), responder citando, reacciones, fijado,
// destacados y "eliminar para mí", editar y eliminar lo propio. Igual que el chat de Rumbo al Sur, pero en grupo.
(function (g) {
  const MAX_TEXTO = 2000;
  const TAM_PAGINA = 50; // mensajes por página (carga inicial, resincronización y "Ver mensajes anteriores")

  const textoValido = (s) => { const t = String(s ?? '').trim(); return t.length >= 1 && t.length <= MAX_TEXTO; };
  /** texto a guardar al editar (recortado) o null si no es válido o no cambió respecto del original */
  const textoEditado = (nuevo, original) => { const t = String(nuevo ?? '').trim(); return textoValido(t) && t !== String(original ?? '').trim() ? t : null; };

  const NOMBRE_TIPO = { foto: 'Foto', audio: 'Audio', video: 'Video', sticker: 'Sticker' };
  function resumen(m) {
    if (m.tipo === 'eliminado') return 'Se eliminó este mensaje';
    if (m.tipo === 'audio' || m.tipo === 'video') return NOMBRE_TIPO[m.tipo] + (m.duracion_ms ? ' (' + duracionTexto(m.duracion_ms) + ')' : '');
    if (NOMBRE_TIPO[m.tipo]) return NOMBRE_TIPO[m.tipo];
    const t = String(m.texto ?? '').trim();
    return t.length > 80 ? t.slice(0, 79) + '…' : t;
  }

  // ---- responder citando ----
  /** texto de la cita (en la burbuja y en la barra "Respondiendo a …") */
  const textoCita = (original) => (!original || original.tipo === 'eliminado' ? 'Mensaje eliminado' : resumen(original));
  /** ids citados que no están en la lista ni se buscaron ya (citados: Map id → mensaje|null) */
  function citasFaltantes(lista, citados) {
    const hay = new Set(lista.map((m) => m.id));
    return [...new Set(lista.map((m) => m.responde_a).filter((id) => id && !hay.has(id) && !citados.has(id)))];
  }
  /** un insert con cita que vuelve con alguno de estos códigos se reintenta sin la cita (el original ya no está) */
  const errorDeCita = (error) => !!error && ['23514', '22P02', '23503'].includes(String(error.code));

  // ---- reacciones: una por persona y mensaje, con clave (no emoji) ----
  const REACCIONES = ['corazon', 'risa', 'sorpresa', 'triste', 'pulgar', 'fuego'];
  const NOMBRE_REACCION = { corazon: 'Me encanta', risa: 'Me causa gracia', sorpresa: 'Me sorprende', triste: 'Me pone triste', pulgar: 'Me gusta', fuego: 'Fuego' };
  /** la reacción que queda al tocar una clave: la misma que tenía la saca (null), otra la cambia */
  const alternarReaccion = (actual, clave) => (actual === clave ? null : clave);
  /** porPersona: Map|objeto persona → clave. Pastillas agrupadas por clave, en el orden de REACCIONES, con conteo y si está la mía. */
  function agruparReacciones(porPersona, yo) {
    const pares = porPersona instanceof Map ? [...porPersona] : Object.entries(porPersona || {});
    return REACCIONES.map((clave) => {
      const quienes = pares.filter(([, c]) => c === clave).map(([p]) => p);
      return { clave, n: quienes.length, mia: quienes.includes(yo), quienes };
    }).filter((x) => x.n > 0);
  }

  // ---- audio ----
  const duracionTexto = (ms) => { const s = Math.max(0, Math.round((ms || 0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const AUDIO_MIN_MS = 700, AUDIO_MAX_MS = 120000;
  const audioValido = (ms) => ms >= AUDIO_MIN_MS && ms <= AUDIO_MAX_MS;
  const mimeBase = (mime) => String(mime || '').split(';')[0].trim().toLowerCase();
  /** extensión del audio según el mime real que grabó el navegador (Chrome: webm, Firefox: ogg, Safari: mp4 → m4a) */
  function extAudio(mime) {
    const m = mimeBase(mime);
    return m === 'audio/ogg' ? 'ogg' : m === 'audio/mp4' || m === 'audio/aac' || m === 'audio/x-m4a' ? 'm4a' : 'webm';
  }
  /** content-type con que se sube el audio (el bucket acepta audio/webm, audio/ogg y audio/mp4) */
  const tipoAudio = (mime) => ({ ogg: 'audio/ogg', m4a: 'audio/mp4', webm: 'audio/webm' }[extAudio(mime)]);

  // ---- video ----
  const VIDEO_MAX_BYTES = 100 * 1024 * 1024; // el límite del bucket 'chat'
  const VIDEO_MAX_MS = 600000;               // el check de duracion_ms (10 minutos)
  /** formato del video para el bucket (solo mp4 y webm). El .mov del iPhone es MP4 por dentro: va como mp4. null = no se puede. */
  function formatoVideo(mime) {
    const m = mimeBase(mime);
    if (m === 'video/webm') return { ext: 'webm', tipo: 'video/webm' };
    if (m === 'video/mp4' || m === 'video/quicktime' || m === 'video/x-m4v') return { ext: 'mp4', tipo: 'video/mp4' };
    return null;
  }
  /** por qué no se puede mandar un video (texto para el usuario) o null si se puede */
  function problemaVideo({ bytes, ms, mime }) {
    if (!formatoVideo(mime)) return 'Ese formato de video no se puede mandar. Probá con un video MP4.';
    if (bytes > VIDEO_MAX_BYTES) return 'El video pesa más de 100 MB. Recortalo o mandá uno más corto.';
    if (!(ms >= 1) || ms > VIDEO_MAX_MS) return ms > VIDEO_MAX_MS ? 'El video dura más de 10 minutos. Mandá uno más corto.' : 'No pudimos leer ese video. Probá con otro.';
    return null;
  }

  // ---- stickers ----
  const textoSticker = (s) => String(s ?? '').trim().toUpperCase().slice(0, 30);
  const externoValido = (u) => typeof u === 'string' && u.length <= 500 && /^https:\/\/media[0-9]*\.giphy\.com\/[^\s<>"]*$/.test(u);
  // texto del sticker en 1 o 2 líneas, cortando por palabras (~16 caracteres la primera)
  function lineasSticker(s, max = 16) {
    const palabras = textoSticker(s).split(/\s+/).filter(Boolean);
    if (!palabras.length) return [];
    let primera = palabras[0], i = 1;
    while (i < palabras.length && (primera + ' ' + palabras[i]).length <= max) primera += ' ' + palabras[i++];
    return i < palabras.length ? [primera, palabras.slice(i).join(' ')] : [primera];
  }

  // ---- buscar ----
  /** patrón ILIKE para buscar en el chat, con % y _ escapados (null si no hay nada que buscar) */
  function patronBusqueda(q) { const t = String(q ?? '').split('*').join('').trim(); /* PostgREST toma el asterisco como comodín */ return t ? '%' + t.replace(/[\\%_]/g, (c) => '\\' + c) + '%' : null; }
  /** parte el texto alrededor de la primera coincidencia (sin distinguir mayúsculas) para marcarla */
  function partirCoincidencia(texto, q) {
    const t = String(texto ?? ''), b = String(q ?? '').trim();
    const i = b ? t.toLowerCase().indexOf(b.toLowerCase()) : -1;
    return i < 0 ? [t, '', ''] : [t.slice(0, i), t.slice(i, i + b.length), t.slice(i + b.length)];
  }

  // ---- destacados y "eliminar para mí" (en este teléfono, por sala y por usuario) ----
  const claveLocal = (tipo, sala, yo) => `chat:${tipo}:${yo}:${sala}`;

  const EDITAR_MS = 15 * 60 * 1000;
  const puedeEditar = (m, yo, ahora = Date.now()) => m.autor === yo && m.tipo === 'texto' && !String(m.id).startsWith('tmp-') && ahora - Date.parse(m.creado) < EDITAR_MS;

  // Orden (creado, id), el mismo que usa la consulta (order creado, id). creado se compara en microsegundos
  // (Postgres guarda µs; Date.parse solo llega a ms) y el id como texto (igual que el uuid en Postgres).
  function micros(iso) {
    const s = Date.parse(iso);
    if (Number.isNaN(s)) return 0;
    const f = /T[^.]*\.(\d+)/.exec(String(iso));
    return Math.floor(s / 1000) * 1e6 + (f ? Number(f[1].slice(0, 6).padEnd(6, '0')) : 0);
  }
  const comparar = (a, b) => micros(a.creado) - micros(b.creado) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);

  // un eliminado no vuelve: una respuesta o un evento atrasado (edición) no lo pisa
  const fusionar = (lista, m) => { const prev = lista.find((x) => x.id === m.id); if (prev?.tipo === 'eliminado' && m.tipo !== 'eliminado') return lista; return [...lista.filter((x) => x.id !== m.id), m].sort(comparar); };
  /** mezcla un lote (recarga tras reconectar) sin duplicar ni resucitar eliminados */
  const fusionarLote = (lista, ms) => ms.reduce((acc, m) => fusionar(acc, m), lista);
  const quitar = (lista, id) => lista.filter((x) => x.id !== id);

  /** evento de Realtime: un INSERT entra; un UPDATE solo toca un mensaje que ya está en la lista
   *  (si no, quedaría arriba de todo y se tomaría como cursor de "Ver mensajes anteriores"). */
  function aplicarEvento(lista, evento, m) {
    if (evento === 'UPDATE' && !lista.some((x) => x.id === m.id)) return lista;
    return fusionar(lista, m);
  }

  const horaCorta = (iso) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Argentina/Buenos_Aires' });

  // recientes = la última página que devolvió el servidor (tam = tamaño de página).
  // Lo que el servidor ya no tiene en ese tramo (borrado mientras no escuchábamos) desaparece; se conserva:
  //  - lo más viejo que el corte (si la página vino llena),
  //  - lo más nuevo que el último de la página (llegó por Realtime o por el insert propio con la consulta en vuelo),
  //  - los ids de "llegados" (eventos aplicados mientras la sincronización estaba en vuelo): su versión gana.
  // Un eliminado que tenemos no resucita por una página atrasada.
  function reconciliar(lista, recientes, tam, llegados) {
    const vino = new Set(recientes.map((m) => m.id));
    const orden = [...recientes].sort(comparar);
    const viejo = recientes.length >= tam ? orden[0] : null;
    const nuevo = orden[orden.length - 1] || null;
    const previo = new Map(lista.map((m) => [m.id, m]));
    const tengo = (id) => llegados && llegados.has(id);
    const conservar = lista.filter((m) => !vino.has(m.id) && (
      (viejo && comparar(m, viejo) < 0) || (nuevo ? comparar(m, nuevo) > 0 : false) || tengo(m.id)));
    const servidor = orden.map((m) => { const p = previo.get(m.id); return p && (p.tipo === 'eliminado' || tengo(m.id)) ? p : m; });
    return [...conservar, ...servidor].sort(comparar);
  }

  /** cursor de "Ver mensajes anteriores": (creado, id) del más viejo cargado que no sea temporal */
  function cursor(lista) {
    const m = [...lista].filter((x) => !String(x.id).startsWith('tmp-')).sort(comparar)[0];
    return m ? { creado: m.creado, id: m.id } : null;
  }
  /** filtro de PostgREST (.or) para traer lo anterior al cursor en orden (creado, id) */
  const filtroAntes = (c) => `creado.lt."${c.creado}",and(creado.eq."${c.creado}",id.lt."${c.id}")`;

  function escalar(ancho, alto, max) {
    const f = Math.min(1, max / Math.max(ancho, alto));
    return { ancho: Math.round(ancho * f), alto: Math.round(alto * f) };
  }
  // Archivos: <sala>/fotos/<id>.webp (+ .t.webp), <sala>/audios/<id>.<webm|ogg|m4a>, <sala>/videos/<id>.<mp4|webm> (+ .t.webp)
  // y la biblioteca del grupo stickers/<id>.webp. ext: la del audio o el video (por defecto webm / mp4).
  const CARPETAS = { foto: ['fotos', 'webp'], audio: ['audios', 'webm'], video: ['videos', 'mp4'] };
  const rutaArchivo = (sala, tipo, id, ext) => `${sala}/${CARPETAS[tipo][0]}/${id}.${ext || CARPETAS[tipo][1]}`;
  const rutaSticker = (id) => `stickers/${id}.webp`;
  /** miniatura de una foto o un video (<id>.t.webp) */
  const rutaMini = (p) => String(p).replace(/\.(webp|mp4|webm)$/, '.t.webp');
  /** archivos a borrar de Storage al eliminar un mensaje (con lo que devuelve eliminar_mensaje): la foto y el video con su
   *  miniatura, el audio solo (no tiene miniatura) y nada de un sticker (es de la biblioteca o de GIPHY) */
  function archivosABorrar(tipoAntes, archivoAntes) {
    if (!archivoAntes || tipoAntes === 'sticker' || String(archivoAntes).startsWith('stickers/')) return [];
    if (tipoAntes === 'audio') return [archivoAntes];
    return [archivoAntes, rutaMini(archivoAntes)];
  }

  const L = { MAX_TEXTO, TAM_PAGINA, textoValido, textoEditado, resumen, puedeEditar, EDITAR_MS, comparar, fusionar, fusionarLote, quitar, aplicarEvento,
    horaCorta, reconciliar, cursor, filtroAntes, escalar, rutaArchivo, rutaSticker, rutaMini, archivosABorrar,
    textoCita, citasFaltantes, errorDeCita, REACCIONES, NOMBRE_REACCION, alternarReaccion, agruparReacciones,
    duracionTexto, AUDIO_MIN_MS, AUDIO_MAX_MS, audioValido, mimeBase, extAudio, tipoAudio,
    VIDEO_MAX_BYTES, VIDEO_MAX_MS, formatoVideo, problemaVideo,
    textoSticker, externoValido, lineasSticker, patronBusqueda, partirCoincidencia, claveLocal };
  if (typeof module !== 'undefined' && module.exports) module.exports = L; else g.ChatLogica = L;
})(this);
