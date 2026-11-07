// Cámara a pantalla completa del álbum (copiada de Rumbo al Sur): zoom, lentes, linterna, tocar para enfocar, exposición,
// cuadrícula y temporizador. Una sola cámara para toda la app; cada álbum la abre con sus propios callbacks.
// window.Camara = { preparar(fuente), abrir({ alSacar(p, { id, tomada }), alTocarUltima(id) }), cerrar(), abierta(), pendientes(n) }
(function (g) {
  const CSS = `
#camara { position: fixed; inset: 0; z-index: 90; background: #000; color: #fff; touch-action: none; user-select: none; -webkit-user-select: none; font-family: var(--fuente-ui) }
#camara[hidden] { display: none }
/* la vista previa muestra la foto entera (3:4 con bandas negras): lo que ves es lo que sale */
#camara video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain }
#camara video.espejo { transform: scaleX(-1) }
#camara .grilla { position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(90deg, transparent calc(33.33% - .5px), rgba(255,255,255,.45) calc(33.33% - .5px) calc(33.33% + .5px), transparent calc(33.33% + .5px) calc(66.66% - .5px), rgba(255,255,255,.45) calc(66.66% - .5px) calc(66.66% + .5px), transparent calc(66.66% + .5px)),
              linear-gradient(transparent calc(33.33% - .5px), rgba(255,255,255,.45) calc(33.33% - .5px) calc(33.33% + .5px), transparent calc(33.33% + .5px) calc(66.66% - .5px), rgba(255,255,255,.45) calc(66.66% - .5px) calc(66.66% + .5px), transparent calc(66.66% + .5px)) }
#camara [hidden] { display: none !important }
#camara .arriba { position: absolute; top: 0; left: 0; right: 0; display: flex; gap: 6px; align-items: center; padding: calc(10px + env(safe-area-inset-top, 0px)) 10px 10px;
  background: linear-gradient(rgba(0,0,0,.55), transparent) }
#camara .arriba .esp { flex: 1 }
#camara button { font: inherit; color: #fff; background: rgba(0,0,0,.35); border: 0; border-radius: 999px; min-width: 44px; height: 44px; padding: 0 12px; font-size: 1.05rem; font-weight: 700; cursor: pointer }
#camara button[aria-pressed="true"] { background: #fff; color: #000 }
#camara .abajo { position: absolute; left: 0; right: 0; bottom: 0; padding: 10px 16px calc(18px + env(safe-area-inset-bottom, 0px)); background: linear-gradient(transparent, rgba(0,0,0,.6)) }
#camara .zooms { display: flex; justify-content: center; gap: 6px; margin-bottom: 8px }
#camara .zooms button { min-width: 40px; height: 34px; font-size: .85rem; padding: 0 8px }
#camara .zooms button.act { background: #fff; color: #000 }
#camara input[type=range] { display: block; width: min(320px, 80%); margin: 0 auto 12px; accent-color: #fff }
#camara .fila { display: flex; align-items: center; justify-content: space-between }
#camara .disparo { width: 76px; height: 76px; border-radius: 50%; background: #fff; border: 5px solid rgba(255,255,255,.45); background-clip: padding-box; padding: 0 }
#camara .disparo:active { transform: scale(.94) }
#camara .ultima { width: 54px; height: 54px; border-radius: 12px; overflow: hidden; padding: 0; position: relative; background: rgba(255,255,255,.15) }
#camara .ultima img { width: 100%; height: 100%; object-fit: cover; display: block }
#camara .ultima span { position: absolute; right: 2px; bottom: 2px; background: #000; border-radius: 8px; font-size: .7rem; padding: 0 5px }
#camara .anillo { position: absolute; width: 70px; height: 70px; margin: -35px 0 0 -35px; border: 2px solid #00B1EF; border-radius: 50%; pointer-events: none; opacity: 0; transition: opacity .6s }
#camara .anillo.si { opacity: 1; transition: none }
#camara .cuenta { position: absolute; inset: 0; display: grid; place-items: center; font-size: 7rem; font-weight: 900; text-shadow: 0 2px 20px rgba(0,0,0,.6); pointer-events: none }
#camara .destello { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none }
#camara .destello.si { animation: destello .25s ease-out }
@keyframes destello { from { opacity: .85 } to { opacity: 0 } }
#camara .error { position: absolute; inset: 0; display: grid; place-items: center; padding: 30px; text-align: center; line-height: 1.5 }
@media (prefers-reduced-motion: reduce) { #camara .destello.si { animation: none } }`;

  function h(tag, props, ...hijos) {
    const el = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k in el && k !== 'list') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    el.append(...hijos.flat(Infinity).filter((c) => c != null && c !== false && c !== ''));
    return el;
  }
  const toast = (t) => g.App?.toast(t);

  /** Endereza, achica a 4096 px y genera JPEG 0,9 + miniatura WebP 480 px + media JPEG 1600 px. Acepta Blob/File. */
  async function preparar(fuente) {
    const A = g.AlbumLogica, M = g.ChatMedios;
    const bm = await createImageBitmap(fuente, { imageOrientation: 'from-image' });
    try {
      const { ancho, alto } = A.escala(bm.width, bm.height, A.MAX_LADO);
      const c = document.createElement('canvas'); c.width = ancho; c.height = alto;
      c.getContext('2d').drawImage(bm, 0, 0, ancho, alto);
      const foto = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
      const m = A.escala(bm.width, bm.height, 480), cm = document.createElement('canvas'); cm.width = m.ancho; cm.height = m.alto;
      cm.getContext('2d').drawImage(bm, 0, 0, m.ancho, m.alto);
      const mini = await M.aBlob(cm, 0.75);
      const md = A.escala(bm.width, bm.height, 1600), cmd = document.createElement('canvas'); cmd.width = md.ancho; cmd.height = md.alto;
      cmd.getContext('2d').drawImage(bm, 0, 0, md.ancho, md.alto);
      const media = await new Promise((res) => cmd.toBlob(res, 'image/jpeg', 0.82));
      if (!foto || !mini || !media) throw new Error('no se pudo codificar la foto');
      return { foto, mini, media, ancho, alto };
    } finally { bm.close?.(); }
  }

  let raiz = null, video = null, api = null;
  let op = {}; // callbacks del álbum que la abrió

  function montar() {
    if (raiz) return;
    const A = g.AlbumLogica;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const b = (c, etiqueta, txt, extra) => h('button', { type: 'button', 'data-c': c, 'aria-label': etiqueta, ...(extra || {}) }, txt);
    video = h('video', { playsInline: true, muted: true, autoplay: true });
    video.setAttribute('playsinline', '');
    raiz = h('div', { id: 'camara', hidden: true, role: 'dialog', 'aria-label': 'Cámara' },
      video,
      h('div', { class: 'grilla', hidden: true }),
      h('div', { class: 'anillo' }),
      h('div', { class: 'cuenta', hidden: true }),
      h('div', { class: 'destello' }),
      h('div', { class: 'arriba' },
        b('cerrar', 'Cerrar la cámara', '✕'),
        h('span', { class: 'esp' }),
        b('luz', 'Linterna', '🔦', { 'aria-pressed': 'false', hidden: true }),
        b('exp', 'Exposición', '☀', { 'aria-pressed': 'false', hidden: true }),
        b('grilla', 'Cuadrícula', '#', { 'aria-pressed': 'false' }),
        b('timer', 'Temporizador', '⏱ 0')),
      h('div', { class: 'abajo' },
        h('input', { type: 'range', 'data-c': 'expRango', 'aria-label': 'Exposición', hidden: true }),
        h('div', { class: 'zooms' }),
        h('input', { type: 'range', 'data-c': 'zoomRango', 'aria-label': 'Zoom', hidden: true }),
        h('div', { class: 'fila' },
          h('button', { type: 'button', class: 'ultima', 'data-c': 'ultima', 'aria-label': 'Ver en el álbum' }),
          h('button', { type: 'button', class: 'disparo', 'data-c': 'disparo', 'aria-label': 'Sacar foto' }),
          b('lente', 'Cambiar de cámara', '🔄'))),
      h('div', { class: 'error', hidden: true }));
    document.body.appendChild(raiz);

    const q = (c) => raiz.querySelector(`[data-c="${c}"]`);
    let stream = null, track = null, caps = {}, camaras = [], hayFrontal = true, idxCam = 0, gran = null, enGran = false, frontal = false, zoom = 1, ultima = null, ocupado = false, turno = 0, nPend = 0;
    let segs = 0; const TIMERS = [0, 3, 10];
    try { if (localStorage.getItem('camGrilla') === '1') { raiz.querySelector('.grilla').hidden = false; q('grilla').setAttribute('aria-pressed', 'true'); } } catch {}

    const soltar = () => { turno++; stream?.getTracks().forEach((t) => t.stop()); stream = null; track = null; video.srcObject = null; };
    function error(t) { const e = raiz.querySelector('.error'); e.textContent = t; e.hidden = !t; }

    async function encender() {
      soltar(); error(''); const mio = turno;
      if (!navigator.mediaDevices?.getUserMedia) return error('Este navegador no deja usar la cámara. Probá con "Galería".');
      const fino = { width: { ideal: 4096 }, height: { ideal: 3072 } };
      const video0 = frontal ? { facingMode: 'user', ...fino } : enGran && gran ? { deviceId: { exact: gran }, ...fino } : camaras[idxCam] ? { deviceId: { exact: camaras[idxCam] }, ...fino } : { facingMode: { ideal: 'environment' }, ...fino };
      let nuevo;
      try { nuevo = await navigator.mediaDevices.getUserMedia({ video: video0, audio: false }); }
      catch (e) {
        if (mio !== turno) return;
        console.error(e);
        // si la gran angular no abre, se vuelve a la principal en vez de quedar en negro
        if (enGran) { enGran = false; toast('La gran angular no está disponible ahora.'); return encender(); }
        return error(e?.name === 'NotAllowedError' ? 'El navegador no tiene permiso para usar la cámara. Tocá el candado de la barra de direcciones, habilitá la cámara y volvé a abrirla.' : 'No se pudo abrir la cámara. Cerrala y probá de nuevo.');
      }
      // mientras pedía la cámara: se cerró, se pasó a segundo plano o se pidió otra lente → esta no sirve
      if (mio !== turno || raiz.hidden || document.hidden) { nuevo.getTracks().forEach((t) => t.stop()); return; }
      stream = nuevo;
      video.addEventListener('loadedmetadata', ajustarGrilla, { once: true });
      track = stream.getVideoTracks()[0]; video.srcObject = stream; video.classList.toggle('espejo', frontal);
      if (!camaras.length && !frontal) await listarCamaras();
      if (mio !== turno) return;
      caps = track.getCapabilities?.() || {};
      montarControles();
    }

    // la cuadrícula va sobre la foto, no sobre las bandas negras de los costados
    function ajustarGrilla() {
      const gr = raiz.querySelector('.grilla'), r = video.getBoundingClientRect(), vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh || !r.width) return;
      const k = Math.min(r.width / vw, r.height / vh), w = vw * k, hh = vh * k;
      Object.assign(gr.style, { inset: 'auto', left: r.left + (r.width - w) / 2 + 'px', top: r.top + (r.height - hh) / 2 + 'px', width: w + 'px', height: hh + 'px' });
    }
    addEventListener('resize', () => { if (!raiz.hidden) ajustarGrilla(); });

    async function listarCamaras() {
      try {
        const ds = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
        // las traseras primero; Chrome en Android las etiqueta "facing back"
        const traseras = ds.filter((d) => /back|rear|trasera|environment/i.test(d.label));
        camaras = (traseras.length ? traseras : ds).map((d) => d.deviceId);
        hayFrontal = !traseras.length || ds.some((d) => /front|user|frontal/i.test(d.label));
        const actual = track?.getSettings?.().deviceId; idxCam = Math.max(0, camaras.indexOf(actual));
        // si hay una sola trasera extra es la gran angular: va como botón .6× y 🔄 queda para frontal/trasera
        gran = A.lentesTraseras(ds, actual).gran;
        if (gran) { camaras = [actual]; idxCam = 0; }
      } catch (e) { console.error(e); }
    }

    function montarControles() {
      const z = caps.zoom, zs = raiz.querySelector('.zooms'), zr = q('zoomRango');
      zoom = track.getSettings?.().zoom || 1;
      zs.replaceChildren();
      const boton = (txt, ds) => { const bt = h('button', { type: 'button' }, txt); Object.assign(bt.dataset, ds); zs.appendChild(bt); return bt; };
      if (!frontal && gran) boton('.6×', { lente: 'gran' }).classList.toggle('act', enGran);
      if (!frontal && gran && enGran) { boton('1×', { lente: 'principal' }); zr.hidden = true; }
      else if (z && z.max > z.min) {
        for (const v of A.zoomPasos(z.min, z.max)) boton((v < 1 ? v.toFixed(1).replace('0.', '.') : v) + '×', { z: v });
        Object.assign(zr, { min: z.min, max: z.max, step: z.step || 0.1, value: zoom }); zr.hidden = false;
      } else zr.hidden = true;
      marcarZoom();
      q('luz').hidden = !caps.torch; q('luz').setAttribute('aria-pressed', 'false');
      const ex = caps.exposureCompensation, er = q('expRango');
      q('exp').hidden = !(ex && ex.max > ex.min); q('exp').setAttribute('aria-pressed', 'false'); er.hidden = true;
      if (ex) Object.assign(er, { min: ex.min, max: ex.max, step: ex.step || 0.1, value: track.getSettings?.().exposureCompensation ?? 0 });
      q('lente').hidden = camaras.length + (hayFrontal ? 1 : 0) < 2;
    }

    let zPend = null;
    function ponerZoom(v) {
      const z = caps.zoom; if (!z || !track) return;
      zoom = Math.min(z.max, Math.max(z.min, v)); q('zoomRango').value = zoom; marcarZoom();
      if (zPend) return; // un cambio por cuadro
      zPend = requestAnimationFrame(() => { zPend = null; track?.applyConstraints({ advanced: [{ zoom }] }).catch(() => {}); });
    }
    function marcarZoom() { raiz.querySelectorAll('.zooms button[data-z]').forEach((bt) => bt.classList.toggle('act', Math.abs(Number(bt.dataset.z) - zoom) < 0.05)); }

    // pellizcar para zoom, tocar para enfocar
    const dedos = new Map(); let pellizco = null, movio = false;
    video.addEventListener('pointerdown', (e) => { dedos.set(e.pointerId, e); movio = false; if (dedos.size === 2) { const [a, c] = [...dedos.values()]; pellizco = { d: Math.hypot(a.clientX - c.clientX, a.clientY - c.clientY), z: zoom }; } });
    video.addEventListener('pointermove', (e) => {
      if (!dedos.has(e.pointerId)) return; dedos.set(e.pointerId, e); movio = true;
      if (pellizco && dedos.size === 2) { const [a, c] = [...dedos.values()]; ponerZoom(pellizco.z * Math.hypot(a.clientX - c.clientX, a.clientY - c.clientY) / pellizco.d); }
    });
    const soltarDedo = (e) => { const eraUno = dedos.size === 1 && !pellizco; dedos.delete(e.pointerId); if (dedos.size < 2) pellizco = null; if (eraUno && !movio && e.type === 'pointerup') enfocar(e); };
    video.addEventListener('pointerup', soltarDedo); video.addEventListener('pointercancel', soltarDedo);

    function enfocar(e) {
      const r = video.getBoundingClientRect(), k = Math.min(r.width / (video.videoWidth || r.width), r.height / (video.videoHeight || r.height));
      const w = (video.videoWidth || r.width) * k, hh = (video.videoHeight || r.height) * k;
      const x = Math.min(1, Math.max(0, (e.clientX - r.left - (r.width - w) / 2) / w)), y = Math.min(1, Math.max(0, (e.clientY - r.top - (r.height - hh) / 2) / hh));
      const an = raiz.querySelector('.anillo'); an.style.left = e.clientX + 'px'; an.style.top = e.clientY + 'px';
      an.classList.add('si'); setTimeout(() => an.classList.remove('si'), 700);
      if (!track || !caps.pointsOfInterest) return;
      const modo = (caps.focusMode || []).includes('single-shot') ? 'single-shot' : (caps.focusMode || []).includes('continuous') ? 'continuous' : undefined;
      track.applyConstraints({ advanced: [{ pointsOfInterest: [{ x: frontal ? 1 - x : x, y }], ...(modo ? { focusMode: modo } : {}) }] }).catch(() => {});
    }

    raiz.addEventListener('click', async (e) => {
      const bt = e.target.closest('button'); if (!bt) return;
      if (bt.dataset.lente) { const gg = bt.dataset.lente === 'gran'; if (gg === enGran) return; enGran = gg; zoom = 1; return encender(); }
      if (bt.dataset.z) return ponerZoom(Number(bt.dataset.z));
      switch (bt.dataset.c) {
        case 'cerrar': return cerrar();
        case 'luz': { const on = bt.getAttribute('aria-pressed') !== 'true'; try { await track.applyConstraints({ advanced: [{ torch: on }] }); bt.setAttribute('aria-pressed', String(on)); } catch {} return; }
        case 'exp': { const on = bt.getAttribute('aria-pressed') !== 'true'; bt.setAttribute('aria-pressed', String(on)); q('expRango').hidden = !on; return; }
        case 'grilla': { const gr = raiz.querySelector('.grilla'); gr.hidden = !gr.hidden; bt.setAttribute('aria-pressed', String(!gr.hidden)); try { localStorage.setItem('camGrilla', gr.hidden ? '0' : '1'); } catch {} return; }
        case 'timer': segs = TIMERS[(TIMERS.indexOf(segs) + 1) % TIMERS.length]; bt.textContent = '⏱ ' + segs; return;
        case 'lente':
          enGran = false;
          if (!frontal && idxCam < camaras.length - 1) idxCam++;
          else if (!frontal) frontal = true;
          else { frontal = false; idxCam = 0; }
          return encender();
        case 'disparo': return disparar();
        case 'ultima': if (ultima) op.alTocarUltima?.(ultima.id); return;
      }
    });
    q('zoomRango').addEventListener('input', (e) => ponerZoom(Number(e.target.value)));
    q('expRango').addEventListener('input', (e) => track?.applyConstraints({ advanced: [{ exposureCompensation: Number(e.target.value) }] }).catch(() => {}));

    async function disparar() {
      if (!track || ocupado) return;
      ocupado = true;
      const alSacar = op.alSacar;
      try {
        for (let s = segs; s > 0; s--) { const c = raiz.querySelector('.cuenta'); c.hidden = false; c.textContent = s; await new Promise((r) => setTimeout(r, 1000)); if (raiz.hidden || document.hidden || !track) return; }
        if (!track) return;
        raiz.querySelector('.cuenta').hidden = true;
        const d = raiz.querySelector('.destello'); d.classList.remove('si'); void d.offsetWidth; d.classList.add('si');
        let crudo = null;
        try { if ('ImageCapture' in g) crudo = await new ImageCapture(track).takePhoto(); } catch (e) { console.warn('takePhoto', e); }
        if (!crudo) {
          const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
          const gx = c.getContext('2d'); if (frontal) { gx.translate(c.width, 0); gx.scale(-1, 1); } gx.drawImage(video, 0, 0);
          crudo = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
        }
        const p = await preparar(crudo), id = crypto.randomUUID();
        ultima = { id };
        const url = URL.createObjectURL(p.mini);
        const img = h('img', { alt: 'Última foto', src: url }); img.onload = () => URL.revokeObjectURL(url);
        q('ultima').replaceChildren(img, h('span', { hidden: true }));
        pendientes(nPend);
        await alSacar(p, { id, tomada: new Date().toISOString() });
      } catch (e) {
        console.error(e); toast('No se pudo guardar la foto. Probá de nuevo.');
      } finally { ocupado = false; raiz.querySelector('.cuenta').hidden = true; }
    }

    function pendientes(n) { nPend = n; const s = q('ultima').querySelector('span'); if (s) { s.hidden = !n; s.textContent = n ? '↑' + n : ''; } }

    function abrir(o = {}) {
      op = o; ultima = null; q('ultima').replaceChildren();
      raiz.hidden = false;
      history.pushState({ ...(history.state || {}), cam: 1 }, '', location.hash || location.pathname + location.search);
      encender();
    }
    function ocultar() { raiz.hidden = true; soltar(); raiz.querySelector('.cuenta').hidden = true; }
    function cerrar() { if (raiz.hidden) return; if (history.state?.cam) history.back(); else ocultar(); }
    addEventListener('popstate', () => { if (!raiz.hidden && !history.state?.cam) ocultar(); });
    // Escape cierra la cámara (como el botón ✕)
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !raiz.hidden) { e.preventDefault(); cerrar(); } });
    document.addEventListener('visibilitychange', () => { if (raiz.hidden) return; if (document.hidden) soltar(); else encender(); });

    api = { abrir, cerrar, abierta: () => !raiz.hidden, pendientes, _track: () => track };
  }

  g.Camara = {
    preparar,
    abrir: (o) => { montar(); api.abrir(o); },
    cerrar: () => api?.cerrar(),
    abierta: () => !!api?.abierta(),
    pendientes: (n) => api?.pendientes(n),
  };
})(window);
