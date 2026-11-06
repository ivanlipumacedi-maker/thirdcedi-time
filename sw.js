// Service worker de ThirdCEDI Time: caché del shell (red primero, caché si no hay señal) y notificaciones push.
const CACHE = 'thirdcedi-shell-v9';
const SHELL = ['./', 'index.html', 'estilos.css', 'app.js', 'dominios.js', 'errores.js', 'perfiles.js', 'actividades-logica.js', 'chat-logica.js', 'chat-medios.js', 'chat.js', 'actividades.js', 'login.js', 'vendor/supabase.js', 'manifest.webmanifest', 'icon-192.png', 'badge-96.png', 'img/logo-cedi.png', 'img/logo-cedi-light.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const claves = await caches.keys();
    await Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return; // Supabase, fuentes, etc. van directo a la red
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
