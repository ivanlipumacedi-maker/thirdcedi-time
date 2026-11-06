// Medios del chat de ThirdCEDI Time: compresión de fotos, URLs firmadas, grabación de audio y recorte de perfil.
// Queda en window.ChatMedios. Necesita window.ChatLogica.
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
  const rutaMini = (p) => p.replace(/\.webp$/, '.t.webp');

  /** Recorta un cuadrado de lado×lado. x, y = centro del recorte en px de la imagen; zoom ≥ 1 sobre el lado corto. */
  async function recortarCuadrado(bm, { x, y, zoom }, lado = 400, calidad = 0.85) {
    const corte = Math.min(bm.width, bm.height) / Math.max(1, zoom);
    const sx = Math.min(Math.max(0, x - corte / 2), bm.width - corte), sy = Math.min(Math.max(0, y - corte / 2), bm.height - corte);
    const c = document.createElement('canvas'); c.width = lado; c.height = lado;
    c.getContext('2d').drawImage(bm, sx, sy, corte, corte, 0, 0, lado, lado);
    return aBlob(c, calidad);
  }

  /** Sticker 512×512: recorte cuadrado con esquinas redondeadas (fondo transparente) y texto opcional abajo. */
  /** Dibuja el sticker en un canvas (sincrónico: lo usa la vista previa en cada movimiento, sin codificar). */
  function pintarSticker(g, bm, { x, y, zoom }, texto, lado) {
    const corte = Math.min(bm.width, bm.height) / Math.max(1, zoom);
    const sx = Math.min(Math.max(0, x - corte / 2), bm.width - corte), sy = Math.min(Math.max(0, y - corte / 2), bm.height - corte);
    const r = lado * 48 / 512;
    g.clearRect(0, 0, lado, lado);
    g.save(); g.beginPath(); g.roundRect(0, 0, lado, lado, r); g.clip();
    g.drawImage(bm, sx, sy, corte, corte, 0, 0, lado, lado); g.restore();
    const lineas = L.lineasSticker(texto);
    if (!lineas.length) return;
    const ancho = lado - lado * 40 / 512, larga = lineas.reduce((a, b) => (b.length > a.length ? b : a));
    let tam = lado * 72 / 512; g.font = `900 ${tam}px system-ui, sans-serif`;
    while (g.measureText(larga).width > ancho && tam > lado * 16 / 512) { tam -= 2; g.font = `900 ${tam}px system-ui, sans-serif`; }
    g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
    g.lineWidth = Math.max(4, tam / 7); g.strokeStyle = '#000'; g.fillStyle = '#fff';
    const base = lado - lado * 34 / 512, alto = tam * 1.05;
    lineas.forEach((t, i) => { const yy = base - (lineas.length - 1 - i) * alto; g.strokeText(t, lado / 2, yy); g.fillText(t, lado / 2, yy); });
  }
  /** Sticker 512×512 (WebP con transparencia; JPEG si el navegador no codifica WebP). */
  async function hacerSticker(bm, pos, texto, lado = 512) {
    const c = document.createElement('canvas'); c.width = lado; c.height = lado;
    pintarSticker(c.getContext('2d'), bm, pos, texto, lado);
    return aBlob(c, 0.85);
  }

  /** Busca stickers en GIPHY (vacío = tendencias). Solo devuelve URLs de media*.giphy.com. Error('cuota') con 429, Error('red') si falla. */
  const GIPHY_OK = /^https:\/\/media[0-9]*\.giphy\.com\//;
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
    return (data || []).map((g) => { const im = g.images?.fixed_height || {}; return { id: g.id, url: im.webp || im.url, ancho: Number(im.width) || 200, alto: Number(im.height) || 200, titulo: g.title || 'Sticker' }; })
      .filter((g) => g.url && GIPHY_OK.test(g.url));
  }

  /** Grabadora de audio (webm/opus). iniciar() rechaza con Error('sin-permiso') si no hay micrófono. */
  function grabadora() {
    let rec = null, stream = null, partes = [], t0 = 0;
    const tipo = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
    const soltar = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; };
    return {
      async iniciar() {
        if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('sin-soporte');
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
        catch (e) { throw new Error(e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'sin-permiso' : 'sin-mic'); }
        partes = [];
        try { rec = new MediaRecorder(stream, tipo ? { mimeType: tipo, audioBitsPerSecond: 32000 } : undefined); }
        catch (e) { soltar(); throw new Error('sin-soporte'); }
        rec.ondataavailable = (e) => { if (e.data.size) partes.push(e.data); };
        rec.start(250); t0 = performance.now();
      },
      ms: () => (rec && rec.state === 'recording' ? performance.now() - t0 : 0),
      detener() {
        return new Promise((res) => {
          if (!rec || rec.state === 'inactive') { soltar(); return res(null); }
          const ms = performance.now() - t0;
          rec.onstop = () => { soltar(); res({ blob: new Blob(partes, { type: (rec.mimeType || 'audio/webm').split(';')[0] }), ms }); };
          rec.stop();
        });
      },
      cancelar() { if (rec && rec.state !== 'inactive') { rec.onstop = null; rec.stop(); } soltar(); partes = []; },
    };
  }

  window.ChatMedios = { BUCKET, aBlob, comprimirImagen, firmar, firmada, vigente, puedeFirmar, reintentarYa, rutaMini, recortarCuadrado, hacerSticker, pintarSticker, buscarGiphy, grabadora };
})();
