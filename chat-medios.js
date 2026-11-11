// Medios del chat de ThirdCEDI Time: compresión de fotos, URLs firmadas (con miniatura .t.webp), grabadora de audio,
// miniatura y medidas de un video, stickers (editor y GIPHY). Queda en window.ChatMedios. Necesita window.ChatLogica.
(function () {
  const L = window.ChatLogica;
  const BUCKET = 'chat', VIDA_S = 3600, MARGEN_MS = 5 * 60 * 1000;

  function aBlob(canvas, calidad) {
    return new Promise((res) => canvas.toBlob((b) => {
      if (b && b.type === 'image/webp') return res(b);
      canvas.toBlob((j) => res(j), 'image/jpeg', calidad); // si el navegador no codifica WebP
    }, 'image/webp', calidad));
  }

  /** Achica la foto (lado largo ≤ max), la endereza según EXIF y la pasa a WebP. */
  async function comprimirImagen(file, max = 1600, calidad = 0.8) {
    const bm = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { ancho, alto } = L.escalar(bm.width, bm.height, max);
    const c = document.createElement('canvas'); c.width = ancho; c.height = alto;
    c.getContext('2d').drawImage(bm, 0, 0, ancho, alto);
    bm.close?.();
    const blob = await aBlob(c, calidad);
    return { blob, ancho, alto, tipo: blob.type };
  }

  /** URLs firmadas con caché; se renuevan cuando faltan menos de 5 minutos.
   *  Sin red: backoff global (no se reintenta hasta reintentarYa() o 30 s). Ruta inexistente: no se repide. */
  const cache = new Map(), rotas = new Set();
  const esperas = new Map(); // bucket → no reintentar antes de
  const BACKOFF_MS = 30 * 1000;
  const vigente = (p) => (cache.get(p)?.vence ?? 0) - Date.now() > MARGEN_MS;
  const puedeFirmar = (p, bucket = BUCKET) => !!p && !rotas.has(p) && Date.now() >= (esperas.get(bucket) || 0);
  const reintentarYa = () => { esperas.clear(); };
  async function firmar(sb, paths, bucket = BUCKET) {
    const faltan = [...new Set(paths)].filter((p) => p && !vigente(p) && !rotas.has(p));
    if (faltan.length) {
      if (Date.now() < (esperas.get(bucket) || 0)) throw new Error('esperando para reintentar firmas');
      let res;
      try { res = await sb.storage.from(bucket).createSignedUrls(faltan, VIDA_S); }
      catch (e) { esperas.set(bucket, Date.now() + BACKOFF_MS); throw e; }
      if (res.error) { esperas.set(bucket, Date.now() + BACKOFF_MS); throw res.error; }
      const ahora = Date.now();
      for (const d of res.data || []) {
        if (d.signedUrl && !d.error) cache.set(d.path, { url: d.signedUrl, vence: ahora + VIDA_S * 1000 });
        else if (d.path) rotas.add(d.path);
      }
    }
    return new Map(paths.filter((p) => firmada(p)).map((p) => [p, firmada(p)]));
  }
  const firmada = (p) => { const c = cache.get(p); return c && c.vence > Date.now() ? c.url : null; };
  const rutaMini = (p) => L.rutaMini(p);

  /** Grabadora de audio. iniciar() rechaza con Error('sin-permiso' | 'sin-mic' | 'sin-soporte').
   *  detener() da { blob, ms, mime } (mime: el que grabó de verdad el navegador) o null. */
  function grabadora() {
    let rec = null, stream = null, partes = [], t0 = 0;
    const MR = window.MediaRecorder;
    const tipo = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MR && MR.isTypeSupported && MR.isTypeSupported(t)) || '';
    const soltar = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };
    return {
      async iniciar() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) throw new Error('sin-soporte');
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
        catch (e) { throw new Error(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'sin-permiso' : 'sin-mic'); }
        partes = [];
        try { rec = new window.MediaRecorder(stream, tipo ? { mimeType: tipo, audioBitsPerSecond: 32000 } : undefined); }
        catch (e) { soltar(); throw new Error('sin-soporte'); }
        rec.ondataavailable = (e) => { if (e.data && e.data.size) partes.push(e.data); };
        rec.start(250); t0 = performance.now();
      },
      ms: () => (rec && rec.state === 'recording' ? performance.now() - t0 : 0),
      detener() {
        return new Promise((res) => {
          if (!rec || rec.state === 'inactive') { soltar(); return res(null); }
          const ms = performance.now() - t0;
          rec.onstop = () => { soltar(); const mime = L.mimeBase(rec.mimeType || tipo) || 'audio/webm'; res({ blob: new Blob(partes, { type: mime }), ms, mime }); };
          rec.stop();
        });
      },
      cancelar() { if (rec && rec.state !== 'inactive') { rec.onstop = null; try { rec.stop(); } catch (e) { /* ya parado */ } } soltar(); partes = []; },
    };
  }

  /** Miniatura (WebP, lado largo 480), medidas y duración de un video, con un <video> y un canvas.
   *  Rechaza si el navegador no lo puede abrir (o tarda más de 15 s). */
  function infoVideo(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      let listo = false, midiendo = false;
      const fin = (err, val) => { if (listo) return; listo = true; clearTimeout(t); v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); if (err) rej(err); else res(val); };
      const t = setTimeout(() => fin(new Error('video-tarda')), 15000);
      // un cuadro un poco adentro (el primero suele ser negro)
      const irAlCuadro = () => { const d = isFinite(v.duration) ? v.duration : 0; try { v.currentTime = Math.min(0.5, d / 3 || 0); } catch (e) { fin(new Error('video-ilegible')); } };
      v.addEventListener('error', () => fin(new Error('video-ilegible')));
      v.addEventListener('loadedmetadata', () => {
        if (!v.videoWidth || !v.videoHeight) { fin(new Error('video-ilegible')); return; }
        // los WebM que graba un navegador no traen la duración: se va al final para que la calcule
        if (!isFinite(v.duration)) { midiendo = true; try { v.currentTime = 1e101; } catch (e) { midiendo = false; irAlCuadro(); } return; }
        irAlCuadro();
      });
      v.addEventListener('seeked', async function alBuscar() {
        if (midiendo) { midiendo = false; irAlCuadro(); return; }
        v.removeEventListener('seeked', alBuscar);
        try {
          const ancho = v.videoWidth, alto = v.videoHeight;
          const m = L.escalar(ancho, alto, 480), c = document.createElement('canvas'); c.width = m.ancho; c.height = m.alto;
          c.getContext('2d').drawImage(v, 0, 0, m.ancho, m.alto);
          const mini = await aBlob(c, 0.75);
          const duracion_ms = Math.max(1, Math.round((isFinite(v.duration) ? v.duration : 0) * 1000));
          fin(null, { mini, ancho, alto, duracion_ms });
        } catch (e) { fin(e); }
      });
      v.src = url;
    });
  }

  /** Dibuja el sticker en un canvas (sincrónico: lo usa la vista previa en cada movimiento, sin codificar).
   *  Recorte cuadrado con esquinas redondeadas (fondo transparente) y texto opcional abajo, blanco con borde negro. */
  function pintarSticker(c2, bm, { x, y, zoom }, texto, lado) {
    const corte = Math.min(bm.width, bm.height) / Math.max(1, zoom);
    const sx = Math.min(Math.max(0, x - corte / 2), bm.width - corte), sy = Math.min(Math.max(0, y - corte / 2), bm.height - corte);
    const r = lado * 48 / 512;
    c2.clearRect(0, 0, lado, lado);
    c2.save(); c2.beginPath();
    if (c2.roundRect) c2.roundRect(0, 0, lado, lado, r); else c2.rect(0, 0, lado, lado);
    c2.clip();
    c2.drawImage(bm, sx, sy, corte, corte, 0, 0, lado, lado); c2.restore();
    const lineas = L.lineasSticker(texto);
    if (!lineas.length) return;
    const ancho = lado - lado * 40 / 512, larga = lineas.reduce((a, b) => (b.length > a.length ? b : a));
    let tam = lado * 72 / 512; c2.font = `900 ${tam}px system-ui, sans-serif`;
    while (c2.measureText(larga).width > ancho && tam > lado * 16 / 512) { tam -= 2; c2.font = `900 ${tam}px system-ui, sans-serif`; }
    c2.textAlign = 'center'; c2.textBaseline = 'alphabetic'; c2.lineJoin = 'round';
    c2.lineWidth = Math.max(4, tam / 7); c2.strokeStyle = '#000'; c2.fillStyle = '#fff';
    const base = lado - lado * 34 / 512, alto = tam * 1.05;
    lineas.forEach((t, i) => { const yy = base - (lineas.length - 1 - i) * alto; c2.strokeText(t, lado / 2, yy); c2.fillText(t, lado / 2, yy); });
  }
  /** Sticker 512×512 (WebP con transparencia; JPEG si el navegador no codifica WebP). */
  async function hacerSticker(bm, pos, texto, lado = 512) {
    const c = document.createElement('canvas'); c.width = lado; c.height = lado;
    pintarSticker(c.getContext('2d'), bm, pos, texto, lado);
    return aBlob(c, 0.85);
  }

  /** Busca stickers en GIPHY (vacío = tendencias). Solo devuelve URLs de media*.giphy.com.
   *  Error('cuota') con 429, Error('clave') con 401/403, Error('red') si falla. */
  async function buscarGiphy(clave, q) {
    const p = new URLSearchParams({ api_key: clave, limit: '24', rating: 'pg-13', lang: 'es' });
    const t = String(q ?? '').trim();
    if (t) p.set('q', t);
    let r;
    try { r = await fetch(`https://api.giphy.com/v1/stickers/${t ? 'search' : 'trending'}?${p}`); }
    catch (e) { throw new Error('red'); }
    if (r.status === 429) throw new Error('cuota');
    if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'clave' : 'red');
    const { data } = await r.json();
    return (data || []).map((x) => { const im = (x.images && x.images.fixed_height) || {}; return { id: x.id, url: im.webp || im.url, titulo: x.title || 'Sticker' }; })
      .filter((x) => L.externoValido(x.url));
  }

  window.ChatMedios = { BUCKET, aBlob, comprimirImagen, firmar, firmada, vigente, puedeFirmar, reintentarYa, rutaMini,
    grabadora, infoVideo, pintarSticker, hacerSticker, buscarGiphy };
})();
