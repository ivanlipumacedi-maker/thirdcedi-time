// Medios del chat de ThirdCEDI Time: compresión de fotos y URLs firmadas (foto y miniatura .t.webp).
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

  window.ChatMedios = { BUCKET, aBlob, comprimirImagen, firmar, firmada, vigente, puedeFirmar, reintentarYa, rutaMini };
})();
