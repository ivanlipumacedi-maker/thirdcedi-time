// Service worker de ThirdCEDI Time: caché del shell (red primero, caché si no hay señal) y notificaciones push.
const CACHE = 'thirdcedi-shell-v17';
const SHELL = ['./', 'index.html', 'estilos.css', 'app.js', 'dominios.js', 'errores.js', 'perfiles.js', 'actividades-logica.js', 'chat-logica.js', 'chat-medios.js', 'chat.js', 'cuentas-logica.js', 'cuentas.js', 'album-logica.js', 'album-cola.js', 'camara.js', 'editor.js', 'album.js', 'actividades.js', 'trivia-logica.js', 'trivia.js', 'impostor-logica.js', 'impostor.js', 'juegos.js', 'login.js', 'vendor/supabase.js', 'manifest.webmanifest', 'icon-192.png', 'badge-96.png', 'img/logo-cedi.png', 'img/logo-cedi-light.png'];

// La IA del editor (worker, onnxruntime y modelo de 28 MB) y el editor de filtros no van en el shell: se guardan la primera
// vez que se usan, en una caché aparte que no se borra al cambiar de versión, y después se sirven desde el teléfono.
const CACHE_IA = 'thirdcedi-ia-v1';
const esIA = (u) => u.origin === self.location.origin && /\/(ia-worker\.js|vendor\/ort\/[^/]+|vendor\/filerobot-[^/]+\.js|modelos\/[^/]+\.onnx)$/.test(u.pathname);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const claves = await caches.keys();
    await Promise.all(claves.filter((k) => k !== CACHE && k !== CACHE_IA).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return; // Supabase, fuentes, etc. van directo a la red
  if (esIA(u)) {
    const clave = u.origin + u.pathname; // sin ?v=
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_IA);
      const guardada = await cache.match(clave);
      if (guardada) return guardada;
      const r = await fetch(e.request);
      if (r.ok) e.waitUntil(cache.put(clave, r.clone()));
      return r;
    })());
    return;
  }
  e.respondWith((async () => {
    try {
      const r = await fetch(e.request);
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
      if ('navigate' in abierta) await abierta.navigate(destino).catch(() => {});
      return abierta.focus();
    }
    return self.clients.openWindow(destino);
  })());
});
