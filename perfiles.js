// Ayudas de perfil: iniciales, URL de la foto y avatar (foto o círculo con iniciales). Usado por chat, anotados y juegos.
(function (g) {
  const BUCKET = 'avatares';

  function iniciales(nombre) {
    const p = String(nombre || '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return '?';
    return p.slice(0, 2).map((s) => Array.from(s)[0].toUpperCase()).join('');
  }
  function primerNombre(nombre) {
    return String(nombre || '').trim().split(/\s+/)[0] || '';
  }
  // Ruta en Storage (sin extensión: puede ser WebP o JPEG según el navegador).
  function rutaAvatar(uid) { return uid + '/avatar'; }
  // Lo guardado en perfiles.foto lleva '?v=<marca>' para distinguir subidas; la ruta real va antes del '?'.
  function rutaDe(foto) { return String(foto || '').split('?')[0]; }

  // ---- URLs firmadas del bucket privado, con caché en memoria y vencimiento ----
  const DURACION_S = 3600;        // validez de cada URL firmada
  const MARGEN_MS = 120 * 1000;   // se renueva 2 min antes de que venza
  const cache = new Map();        // foto -> { url, vence (ms) }

  function urlVigente(foto, ahora) {
    const c = cache.get(foto);
    return c && c.vence - MARGEN_MS > (ahora == null ? Date.now() : ahora) ? c.url : null;
  }
  function limpiarCache() { cache.clear(); }

  // Pide en una sola llamada las URLs firmadas que faltan o están por vencer. `sb` es el cliente de Supabase.
  async function prepararAvatares(perfiles, sb, ahora) {
    const t = ahora == null ? Date.now() : ahora;
    const faltan = [];
    (perfiles || []).forEach((p) => {
      if (p && p.foto && !urlVigente(p.foto, t) && faltan.indexOf(p.foto) < 0) faltan.push(p.foto);
    });
    if (!faltan.length || !sb) return 0;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(faltan.map(rutaDe), DURACION_S);
    if (error || !Array.isArray(data)) return 0;
    let n = 0;
    data.forEach((d, i) => {
      if (d && d.signedUrl && !d.error) { cache.set(faltan[i], { url: d.signedUrl, vence: t + DURACION_S * 1000 }); n++; }
    });
    return n;
  }

  // Síncrona: la URL firmada en caché, o null (se muestra el círculo con iniciales).
  function avatarUrl(perfil, ahora) {
    if (!perfil || !perfil.foto) return null;
    return urlVigente(perfil.foto, ahora);
  }

  // Recorte cuadrado centrado de una imagen ancho x alto.
  function recorteCuadrado(ancho, alto) {
    const lado = Math.min(ancho, alto);
    return { x: Math.round((ancho - lado) / 2), y: Math.round((alto - lado) / 2), lado };
  }

  // Elemento DOM: <img> redonda con la foto o círculo con iniciales en --accent.
  function avatar(perfil, px) {
    const d = document;
    const el = d.createElement('span');
    el.className = 'avatar';
    el.style.setProperty('--tam', (px || 40) + 'px');
    const url = avatarUrl(perfil);
    if (url) {
      const img = d.createElement('img');
      img.src = url; img.alt = ''; img.loading = 'lazy';
      img.addEventListener('error', () => { img.remove(); el.textContent = iniciales(perfil.nombre); });
      el.appendChild(img);
    } else {
      el.textContent = iniciales(perfil && perfil.nombre);
    }
    return el;
  }

  const Perfiles = { BUCKET, iniciales, primerNombre, rutaAvatar, rutaDe, prepararAvatares, avatarUrl, limpiarCache, recorteCuadrado, avatar };
  if (typeof module !== 'undefined' && module.exports) module.exports = Perfiles;
  else g.Perfiles = Perfiles;
})(typeof window !== 'undefined' ? window : globalThis);
