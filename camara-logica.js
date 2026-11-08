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
  // en orden de preferencia: MP4 (H.264) primero, porque se ve en todos los teléfonos; WebM si no hay otra. El codec va sin perfil
  // (avc1, no avc1.640028): con perfil High el codificador de algunos Android dice que sí y después falla al grabar.
  const FORMATOS = [
    { id: 'mp4', nombre: 'MP4', detalle: 'H.264', mimes: ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4'] },
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

  // ---------- Fotos ----------
  // Proporción: la foto sale del sensor (4:3) y se recorta al centro. La vista previa usa un stream moderado (no 4K):
  // en Android un stream enorme baja los cuadros por segundo y empeora el enfoque y la exposición; la resolución
  // de la foto la da takePhoto(), que dispara la captura de foto del sensor y no un cuadro del video.
  const PROPORCIONES = [
    { id: '4:3', nombre: '4:3', r: 4 / 3 },
    { id: '16:9', nombre: '16:9', r: 16 / 9 },
    { id: '1:1', nombre: '1:1', r: 1 },
  ];
  // Resolución: el lado mayor de la foto que se guarda (la de la app tiene tope en 4096, MAX_LADO del álbum)
  const RES_FOTO = [
    { id: 'alta', nombre: 'Alta', lado: 4096 },
    { id: 'media', nombre: 'Media', lado: 2560 },
    { id: 'liviana', nombre: 'Liviana', lado: 1600 },
  ];
  /** megapíxeles de una foto de esa resolución y proporción ("12 MP", "6,6 MP") con el sensor que hay (ancho/alto máximos) */
  function megapixeles(resId, propId, sensor) {
    const r = RES_FOTO.find((x) => x.id === resId) || RES_FOTO[0], p = PROPORCIONES.find((x) => x.id === propId) || PROPORCIONES[0];
    let largo = r.lado;
    if (sensor && sensor.ancho && sensor.alto) {
      const sl = Math.max(sensor.ancho, sensor.alto), sc = Math.min(sensor.ancho, sensor.alto);
      // lo que entra del sensor con esa proporción
      const recLargo = Math.min(sl, sc * p.r);
      largo = Math.min(largo, recLargo);
    }
    const mp = (largo * (largo / p.r)) / 1e6;
    return mp >= 10 ? Math.round(mp) : Math.round(mp * 10) / 10;
  }
  /** recorte centrado de una imagen ancho×alto a la proporción (que se aplica al lado largo: vale en vertical y horizontal) */
  function recorte(ancho, alto, propId) {
    const p = PROPORCIONES.find((x) => x.id === propId) || PROPORCIONES[0];
    const horizontal = ancho >= alto, L = horizontal ? ancho : alto, Cc = horizontal ? alto : ancho;
    let l = L, c = Cc;
    if (L / Cc > p.r) l = Math.round(Cc * p.r); else c = Math.round(L / p.r);
    const w = horizontal ? l : c, h = horizontal ? c : l;
    return { x: Math.round((ancho - w) / 2), y: Math.round((alto - h) / 2), ancho: w, alto: h };
  }
  /** restricciones de la vista previa para fotos: 16:9 pide un stream 16:9; 4:3 y 1:1 uno 4:3 (el 1:1 se marca encima).
   *  sinTakePhoto (iPhone/Safari, que no tiene ImageCapture): la foto sale de un cuadro del video, así que se pide el
   *  stream más grande que dé la cámara (4032×3024 en 4:3, 3840×2160 en 16:9). */
  function restriccionesFoto(o, base, sinTakePhoto) {
    const ancho = sinTakePhoto ? (o && o.prop === '16:9' ? 3840 : 4032) : 1920;
    const alto = o && o.prop === '16:9' ? Math.round(ancho * 9 / 16) : Math.round(ancho * 3 / 4);
    return { ...(base || {}), width: { ideal: ancho }, height: { ideal: alto }, aspectRatio: { ideal: ancho / alto }, frameRate: { ideal: 30 } };
  }
  /** opciones de foto guardadas → válidas (4:3 y alta por defecto, como la cámara del teléfono) */
  function normalizarFoto(g) {
    const o = g || {};
    return {
      prop: PROPORCIONES.some((x) => x.id === o.prop) ? o.prop : '4:3',
      res: RES_FOTO.some((x) => x.id === o.res) ? o.res : 'alta',
    };
  }
  /** el chip de arriba en modo foto: "4:3 · 12 MP" */
  const chipFoto = (o, sensor) => `${o.prop} · ${String(megapixeles(o.res, o.prop, sensor)).replace('.', ',')} MP`;
  /** el tamaño a pedirle a takePhoto: el más grande que da el sensor (después se achica: así sale más nítida) */
  function tamanoTakePhoto(pc) {
    const w = pc && pc.imageWidth && pc.imageWidth.max, h = pc && pc.imageHeight && pc.imageHeight.max;
    return w && h ? { imageWidth: w, imageHeight: h } : {};
  }

  // ---------- Lentes ----------
  // Android (Chrome): "camera 0, facing back" / "camera2 0, facing back". El número es el id de Camera2: la trasera
  // de número más bajo es la principal; Chrome no siempre la lista primero (en el S24 viene "camera 2" antes que
  // "camera 0"), así que no alcanza con facingMode: se abre la principal por su deviceId. Con dos traseras, la otra es
  // la gran angular (S24: 0 principal, 2 gran angular); con más, no se adivina.
  // iPhone (Safari): "Back Camera", "Back Ultra Wide Camera", "Back Telephoto Camera" y las virtuales "Back Dual
  // Wide Camera" / "Back Triple Camera" (en español "Cámara trasera", "Cámara ultra gran angular trasera"...). La
  // principal es la gran angular común (no la virtual: esa cambia de lente sola y no deja elegir).
  const numCam = (label) => { const m = /camera2?\s*(\d+)/i.exec(label || ''); return m ? Number(m[1]) : null; };
  const esTrasera = (d) => /back|rear|trasera|environment/i.test(d.label || '');
  const esFrontal = (d) => /front|user|frontal|delantera/i.test(d.label || '');
  const esUltra = (d) => /ultra/i.test(d.label || '');
  const esTele = (d) => /tele/i.test(d.label || '');
  const esVirtual = (d) => /dual|triple/i.test(d.label || '');
  /** de enumerateDevices(): principal, gran angular y teleobjetivo traseros (si se reconocen), frontal y el resto */
  function lentes(dispositivos) {
    const cams = (dispositivos || []).filter((d) => !d.kind || d.kind === 'videoinput');
    const orden = (a, b) => (numCam(a.label) ?? 99) - (numCam(b.label) ?? 99);
    const traseras = cams.filter(esTrasera).slice().sort(orden);
    const frontales = cams.filter(esFrontal).slice().sort(orden);
    const id = (d) => (d ? d.deviceId : null);
    const conNombre = traseras.some((d) => esUltra(d) || esTele(d) || esVirtual(d));
    let principal, gran = null, tele = null;
    if (conNombre) { // iPhone
      principal = traseras.find((d) => !esUltra(d) && !esTele(d) && !esVirtual(d)) || traseras.find((d) => !esUltra(d) && !esTele(d)) || traseras[0];
      gran = traseras.find(esUltra) || null; tele = traseras.find(esTele) || null;
    } else {
      principal = traseras[0];
      if (traseras.length === 2) gran = traseras[1];
    }
    const usadas = [principal, gran, tele].filter(Boolean);
    return {
      principal: id(principal), gran: id(gran), tele: id(tele),
      otras: traseras.filter((d) => !usadas.includes(d) && !esVirtual(d)).map(id),
      frontal: id(frontales[0]),
      sinEtiquetas: !cams.some((d) => d.label),
    };
  }

  const extension = (mime) => (/^video\/mp4/.test(mime || '') ? 'mp4' : 'webm');
  const mimeBase = (mime) => String(mime || '').split(';')[0];

  const C = { DURACION_MAX_MS, AVISO_MS, LIMITE_BYTES, RESOLUCIONES, FPS, FORMATOS, resolucionesSoportadas, fpsSoportados, formatosSoportados,
    bitrate, normalizar, chip, restricciones, tiempo, limite, extension, mimeBase,
    PROPORCIONES, RES_FOTO, megapixeles, recorte, restriccionesFoto, normalizarFoto, chipFoto, tamanoTakePhoto, numCam, lentes };
  if (typeof module !== 'undefined' && module.exports) module.exports = C; else g.CamaraLogica = C;
})(typeof window !== 'undefined' ? window : globalThis);
