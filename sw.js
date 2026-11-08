// Service worker de ThirdCEDI Time: caché del shell (red primero, caché si no hay señal) y notificaciones push.
const CACHE = 'thirdcedi-shell-v41';
const SHELL = ['./', 'index.html', 'estilos.css', 'app.js', 'dominios.js', 'errores.js', 'perfiles.js', 'actividades-logica.js', 'chat-logica.js', 'chat-medios.js', 'chat.js', 'cuentas-logica.js', 'cuentas.js', 'album-logica.js', 'album-cola.js', 'camara-logica.js', 'camara.js', 'editor-logica.js', 'editor.js', 'album.js', 'actividades.js', 'trivia-logica.js', 'trivia.js', 'impostor-logica.js', 'impostor.js', 'juegos.js', 'avisos.js', 'captcha.js', 'login.js', 'vendor/supabase.js', 'manifest.webmanifest', 'icon-192.png', 'badge-96.png', 'img/logo-cedi.png', 'img/logo-cedi-light.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const claves = await caches.keys();
    // borra también la caché vieja de la IA del editor ('thirdcedi-ia-v1', ~43 MB), que ya no existe
    await Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return; // Supabase, fuentes, Turnstile (challenges.cloudflare.com), etc. van directo a la red, sin caché
  e.respondWith((async () => {
    try {
      // 'no-cache': revalida contra el servidor (ETag) en vez de usar la caché HTTP del navegador. GitHub Pages manda
      // max-age=600 y, sin esto, después de publicar el teléfono podía mezclar archivos viejos y nuevos y romperse.
      const r = e.request.mode === 'navigate'
        ? await fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
        : await fetch(e.request, { cache: 'no-cache' });
      if (r.ok) { const c = await caches.open(CACHE); e.waitUntil(c.put(e.request, r.clone())); }
      return r;
    } catch (err) {
      const guardada = await caches.match(e.request, { ignoreSearch: true });
      if (guardada) return guardada;
      throw err;
    }
  })());
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'ThirdCEDI Time', {
    body: d.body || '',
    tag: d.tag,
    renotify: !!d.tag,
    data: { url: d.url || './' },
    icon: 'icon-192.png',
    badge: 'badge-96.png',
    lang: 'es-AR',
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destino = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const abierta = ventanas.find((v) => v.url.startsWith(self.registration.scope));
    if (abierta) {
      // la app ya abierta abre la actividad o la partida sin recargar (avisos.js escucha este mensaje)
      abierta.postMessage({ tipo: 'abrir', url: destino });
      return abierta.focus();
    }
    return self.clients.openWindow(destino);
  })());
});
