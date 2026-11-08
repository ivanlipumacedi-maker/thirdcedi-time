// Lógica pura de la cámara (sin DOM): qué opciones de video ofrecer según el teléfono, el formato, el bitrate y los límites.
// En el navegador queda en window.CamaraLogica.
(function (g) {
  const DURACION_MAX_MS = 60 * 1000; // un video dura como mucho 60 s
  const AVISO_MS = 10 * 1000; // a los 50 s avisa que faltan 10
  const LIMITE_BYTES = 100 * 1024 * 1024; // y pesa como mucho 100 MB (lo que acepta el bucket)
  const AUDIO_BPS = 128000;

  // bitrate de referencia por resolución (a 30 cuadros); el real tiene un tope para que 60 s entren en 100 MB
  const RESOLUCIONES = [
    { id: '720p', nombre: '720p', ancho: 1280, alto: 720, bps: 5e6 },
    { id: '1080p', nombre: '1080p', ancho: 1920, alto: 1080, bps: 10e6 },
    { id: '4k', nombre: '4K', ancho: 3840, alto: 2160, bps: 35e6 },
  ];
  const FPS = [24, 30, 60];
  // en orden de preferencia: MP4 (H.264) primero, porque se ve en todos los teléfonos; WebM si no hay otra
  const FORMATOS = [
    { id: 'mp4', nombre: 'MP4', detalle: 'H.264', mimes: ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4'] },
    { id: 'webm-vp9', nombre: 'WebM', detalle: 'VP9', mimes: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9'] },
    { id: 'webm-vp8', nombre: 'WebM', detalle: 'VP8', mimes: ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm'] },
  ];

  const max = (c) => (c && typeof c.max === 'number' ? c.max : null);
  /** las resoluciones que da la cámara, según getCapabilities() del track (width/height). Sin datos: 720p y 1080p (se piden como ideal). */
  function resolucionesSoportadas(caps) {
    const w = max(caps && caps.width), h = max(caps && caps.height);
    if (!w || !h) return ['720p', '1080p'];
    const largo = Math.max(w, h), corto = Math.min(w, h); // el track puede venir en vertical
    const r = RESOLUCIONES.filter((x) => largo >= x.ancho && corto >= x.alto).map((x) => x.id);
    return r.length ? r : ['720p'];
  }
  /** los cuadros por segundo que da la cámara (frameRate de getCapabilities). Sin datos: 30. */
  function fpsSoportados(caps) {
    const fr = caps && caps.frameRate, M = max(fr);
    if (!M) return [30];
    const m = typeof fr.min === 'number' ? fr.min : 0;
    const r = FPS.filter((f) => f <= M + 0.5 && f >= m - 0.5);
    return r.length ? r : [Math.round(M)];
  }
  /** los formatos que puede grabar este navegador, con el mime que se va a usar (con audio o sin) */
  function formatosSoportados(esSoportado, audio = true) {
    const r = [];
    for (const f of FORMATOS) {
      const mimes = audio ? f.mimes : f.mimes.filter((m) => !/mp4a|opus/.test(m));
      const mime = mimes.find((m) => { try { return !!esSoportado(m); } catch { return false; } });
      if (mime) r.push({ id: f.id, nombre: f.nombre, detalle: f.detalle, mime });
    }
    // dos WebM: queda el mejor (VP9)
    return r.filter((f, i) => !(f.id === 'webm-vp8' && r.some((x, j) => j < i && x.id === 'webm-vp9')));
  }
  /** bitrate de video: el de referencia (×1,5 a 60 cuadros, ×0,85 a 24), con tope para que el máximo de duración entre en el límite */
  function bitrate(resId, fps, audio = true) {
    const r = RESOLUCIONES.find((x) => x.id === resId) || RESOLUCIONES[0];
    const ref = r.bps * (fps >= 50 ? 1.5 : fps <= 25 ? 0.85 : 1);
    const tope = (LIMITE_BYTES * 8 * 0.9) / (DURACION_MAX_MS / 1000) - (audio ? AUDIO_BPS : 0); // 10 % de margen (el codificador no es exacto)
    return Math.round(Math.min(ref, tope));
  }
  /** opciones guardadas + lo que da el teléfono → opciones válidas (MP4, 1080p y 30 por defecto si están) */
  function normalizar(guardadas, { resoluciones, fps, formatos }) {
    const o = guardadas || {};
    const elegir = (v, lista, pref) => (lista.includes(v) ? v : lista.includes(pref) ? pref : lista[lista.length - 1]);
    const ids = formatos.map((f) => f.id);
    return {
      res: elegir(o.res, resoluciones, '1080p'),
      fps: elegir(o.fps, fps, 30),
      formato: ids.includes(o.formato) ? o.formato : ids[0] || null,
      audio: o.audio !== false,
    };
  }
  /** el chip de arriba: "1080p · 30" */
  const chip = (o) => `${(RESOLUCIONES.find((x) => x.id === o.res) || RESOLUCIONES[0]).nombre} · ${o.fps}`;
  /** restricciones de getUserMedia para esas opciones (horizontal; el teléfono la gira si está en vertical) */
  function restricciones(o, base) {
    const r = RESOLUCIONES.find((x) => x.id === o.res) || RESOLUCIONES[1];
    return { ...(base || {}), width: { ideal: r.ancho }, height: { ideal: r.alto }, frameRate: { ideal: o.fps } };
  }
  /** "0:07", "1:00" */
  function tiempo(ms) {
    const s = Math.max(0, Math.floor((ms || 0) / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  /** estado de una grabación: cuándo avisar y cuándo cortar (por tiempo o por tamaño) */
  function limite(ms, bytes) {
    if (ms >= DURACION_MAX_MS) return 'tiempo';
    if (bytes >= LIMITE_BYTES * 0.97) return 'tamano';
    if (ms >= DURACION_MAX_MS - AVISO_MS) return 'aviso';
    return null;
  }
  const extension = (mime) => (/^video\/mp4/.test(mime || '') ? 'mp4' : 'webm');
  const mimeBase = (mime) => String(mime || '').split(';')[0];

  const C = { DURACION_MAX_MS, AVISO_MS, LIMITE_BYTES, RESOLUCIONES, FPS, FORMATOS, resolucionesSoportadas, fpsSoportados, formatosSoportados,
    bitrate, normalizar, chip, restricciones, tiempo, limite, extension, mimeBase };
  if (typeof module !== 'undefined' && module.exports) module.exports = C; else g.CamaraLogica = C;
})(typeof window !== 'undefined' ? window : globalThis);
