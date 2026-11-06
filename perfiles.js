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
  function rutaAvatar(uid) { return uid + '/avatar.webp'; }

  // URL pública de la foto (el bucket es de lectura pública; la ruta lleva el uid, que no se adivina). null si no hay foto.
  function avatarUrl(perfil, baseUrl) {
    if (!perfil || !perfil.foto) return null;
    const base = baseUrl || (g.App && g.App.SUPABASE_URL) || '';
    return base + '/storage/v1/object/public/' + BUCKET + '/' + perfil.foto;
  }

  // Recorte cuadrado centrado de una imagen ancho x alto.
  function recorteCuadrado(ancho, alto) {
    const lado = Math.min(ancho, alto);
    return { x: Math.round((ancho - lado) / 2), y: Math.round((alto - lado) / 2), lado };
  }

  // Elemento DOM: <img> redonda con la foto o círculo con iniciales en --accent.
  function avatar(perfil, px) {
    const d = (typeof document !== 'undefined') ? document : null;
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

  const Perfiles = { BUCKET, iniciales, primerNombre, rutaAvatar, avatarUrl, recorteCuadrado, avatar };
  if (typeof module !== 'undefined' && module.exports) module.exports = Perfiles;
  else g.Perfiles = Perfiles;
})(typeof window !== 'undefined' ? window : globalThis);
