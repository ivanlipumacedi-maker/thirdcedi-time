// Cámara a pantalla completa del álbum: FOTO y VIDEO. Zoom (pellizco y 0,5× / 1× / 2×), flash y linterna, cambiar de
// cámara, temporizador, cuadrícula, tocar para enfocar y la última foto en miniatura. En VIDEO: resolución, cuadros por
// segundo, formato y sonido (solo lo que el teléfono da), pausa si el navegador la tiene y un tope de 60 s y 100 MB.
// La lógica (qué ofrecer, bitrate, límites) vive en camara-logica.js. Una sola cámara para toda la app.
// window.Camara = { preparar(fuente), abrir({ alSacar(p, { id, tomada, tipo }), alTocarUltima(id) }), cerrar(), abierta(), pendientes(n) }
//   foto:  p = { foto, mini, media, ancho, alto }
//   video: p = { video, mime, mini, ancho, alto, duracion_ms }
(function (g) {
  const CSS = `
#camara { position: fixed; inset: 0; z-index: 90; background: #000; color: #fff; touch-action: none; user-select: none; -webkit-user-select: none;
  font-family: var(--fuente-ui); overflow: hidden }
#camara[hidden], #camara [hidden] { display: none !important }
#camara video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; transform-origin: center; transition: transform .12s ease-out }
#camara .grilla { position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(90deg, transparent calc(33.33% - .5px), rgba(255,255,255,.4) calc(33.33% - .5px) calc(33.33% + .5px), transparent calc(33.33% + .5px) calc(66.66% - .5px), rgba(255,255,255,.4) calc(66.66% - .5px) calc(66.66% + .5px), transparent calc(66.66% + .5px)),
              linear-gradient(transparent calc(33.33% - .5px), rgba(255,255,255,.4) calc(33.33% - .5px) calc(33.33% + .5px), transparent calc(33.33% + .5px) calc(66.66% - .5px), rgba(255,255,255,.4) calc(66.66% - .5px) calc(66.66% + .5px), transparent calc(66.66% + .5px)) }
#camara button { font: inherit; color: #fff; border: 0; background: none; padding: 0; cursor: pointer; -webkit-tap-highlight-color: transparent }
#camara button:focus-visible { outline: 2px solid #fff; outline-offset: 3px }
#camara button:disabled { opacity: .35; cursor: default }
#camara .ico { width: 22px; height: 22px; fill: currentColor; flex: none; vertical-align: 0 }
/* vidrio esmerilado: desenfoque real, borde de medio pixel y sombra suave */
#camara .chip, #camara .zooms, #camara .rec, #camara .panel, #camara .opc, #camara .aviso {
  background: rgba(22,24,28,.5); backdrop-filter: blur(18px) saturate(1.7); -webkit-backdrop-filter: blur(18px) saturate(1.7);
  box-shadow: inset 0 0 0 .5px rgba(255,255,255,.24), 0 6px 18px rgba(0,0,0,.25) }
#camara .chip { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; position: relative; flex: none; transition: transform .15s ease, color .2s, background-color .2s }
#camara .chip:active:not(:disabled) { transform: scale(.9) }
#camara .chip[aria-pressed="true"], #camara .chip.on { color: #FFD24A }
#camara .chip .badge { position: absolute; right: -3px; top: -3px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; background: #FFD24A; color: #111;
  font-size: 11px; font-weight: 800; display: grid; place-items: center; font-variant-numeric: tabular-nums }
#camara .arriba { position: absolute; top: 0; left: 0; right: 0; display: flex; gap: 10px; align-items: center; padding: calc(12px + env(safe-area-inset-top, 0px)) 14px 10px }
#camara .arriba .esp { flex: 1 }
#camara .opc { height: 34px; padding: 0 13px; border-radius: 999px; font-size: .8rem; font-weight: 700; letter-spacing: .02em; font-variant-numeric: tabular-nums; transition: transform .15s ease }
#camara .opc[aria-expanded="true"] { color: #FFD24A }
#camara .rec { position: absolute; left: 50%; top: calc(16px + env(safe-area-inset-top, 0px)); transform: translateX(-50%); display: flex; align-items: center; gap: 8px; height: 34px;
  padding: 0 14px; border-radius: 999px; font-weight: 700; font-variant-numeric: tabular-nums; font-size: .95rem }
#camara .rec i { width: 9px; height: 9px; border-radius: 50%; background: #FF3B30; animation: titila 1s steps(1) infinite }
#camara .rec.pausa i { animation: none; opacity: .5 }
#camara .rec.final { background: rgba(255,59,48,.8) }
@keyframes titila { 50% { opacity: .25 } }
/* panel de opciones de video */
#camara .panel { background: rgba(18,20,24,.66); position: absolute; left: 12px; right: 12px; top: calc(68px + env(safe-area-inset-top, 0px)); border-radius: 22px; padding: 14px 14px 12px; z-index: 2;
  transform-origin: top right; animation: abre .18s ease-out }
@keyframes abre { from { opacity: 0; transform: scale(.96) translateY(-6px) } }
#camara .panel h3 { margin: 0 0 6px 2px; font-size: .72rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: rgba(255,255,255,.62) }
#camara .panel .fila-o { display: flex; gap: 6px; margin-bottom: 12px }
#camara .panel .fila-o:last-of-type { margin-bottom: 4px }
#camara .panel .fila-o button { flex: 1; min-height: 44px; border-radius: 12px; font-weight: 700; font-size: .88rem; background: rgba(255,255,255,.08); display: inline-flex;
  align-items: center; justify-content: center; gap: 6px; transition: background-color .2s, color .2s }
#camara .panel .fila-o button small { font-weight: 500; opacity: .7; font-size: .75rem }
#camara .panel .fila-o button[aria-pressed="true"] { background: rgba(255,210,74,.18); color: #FFD24A; box-shadow: inset 0 0 0 1px rgba(255,210,74,.45) }
#camara .panel .nota { margin: 6px 2px 0; font-size: .75rem; color: rgba(255,255,255,.6) }
/* abajo: zoom, modo y la fila del obturador */
#camara .abajo { position: absolute; left: 0; right: 0; bottom: 0; padding: 0 0 calc(22px + env(safe-area-inset-bottom, 0px));
  background: linear-gradient(transparent, rgba(0,0,0,.55) 38%) }
#camara .zfila { display: flex; justify-content: center; height: 52px; margin-bottom: 10px }
#camara .zooms { display: flex; gap: 2px; padding: 4px; border-radius: 999px; align-items: center }
#camara .zooms button { width: 44px; height: 44px; border-radius: 50%; font-size: .74rem; font-weight: 700; font-variant-numeric: tabular-nums; background: rgba(0,0,0,.22);
  transition: transform .2s ease, color .2s ease, background-color .2s ease }
#camara .zooms button.act { color: #FFD24A; font-size: .82rem; background: rgba(0,0,0,.5); transform: scale(1.06) }
#camara .modos { position: relative; height: 34px; overflow: hidden; margin-bottom: 14px }
#camara .modos .pista { position: absolute; left: 50%; top: 0; display: flex; gap: 22px; transition: transform .3s cubic-bezier(.2,.8,.2,1) }
#camara .modos button { height: 34px; padding: 0 6px; font-size: .78rem; font-weight: 800; letter-spacing: .12em; color: rgba(255,255,255,.75); transition: color .2s }
#camara .modos button[aria-pressed="true"] { color: #FFD24A }
#camara .fila { display: flex; align-items: center; justify-content: space-between; padding: 0 30px }
#camara .ultima, #camara .pausar { width: 52px; height: 52px; border-radius: 14px; overflow: hidden; position: relative; background: rgba(255,255,255,.12); box-shadow: 0 0 0 1.5px rgba(255,255,255,.75); flex: none }
#camara .pausar { border-radius: 50%; display: grid; place-items: center; box-shadow: inset 0 0 0 .5px rgba(255,255,255,.24) }
#camara .ultima img { width: 100%; height: 100%; object-fit: cover; display: block }
#camara .ultima .ico { position: absolute; left: 50%; top: 50%; width: 16px; height: 16px; margin: -8px; filter: drop-shadow(0 1px 2px rgba(0,0,0,.6)) }
#camara .ultima span { position: absolute; right: 2px; bottom: 2px; background: rgba(0,0,0,.75); border-radius: 8px; font-size: .68rem; font-weight: 700; padding: 0 5px }
#camara .lente { width: 52px; height: 52px }
#camara .lente .ico { width: 26px; height: 26px }
/* obturador: aro blanco; adentro, blanco (foto), rojo (video) o un cuadrado rojo (grabando) */
#camara .disparo { width: 78px; height: 78px; border-radius: 50%; box-shadow: inset 0 0 0 4px #fff; display: grid; place-items: center; flex: none }
#camara .disparo i { width: 64px; height: 64px; border-radius: 50%; background: #fff; display: block; transition: all .25s cubic-bezier(.2,.8,.2,1) }
#camara.modo-video .disparo i { background: #FF3B30 }
#camara.grabando .disparo i { width: 30px; height: 30px; border-radius: 8px }
#camara .disparo:active i { transform: scale(.9) }
#camara .disparo.pulso i { animation: pulso .3s ease-out }
@keyframes pulso { 40% { transform: scale(.82) } }
#camara .anillo { position: absolute; width: 74px; height: 74px; margin: -37px 0 0 -37px; border: 1.5px solid #FFD24A; border-radius: 14px; pointer-events: none; opacity: 0;
  transform: scale(1.25); transition: opacity .6s, transform .25s ease-out }
#camara .anillo.si { opacity: 1; transform: none; transition: transform .25s ease-out }
#camara .cuenta { position: absolute; inset: 0; display: grid; place-items: center; font-size: 7rem; font-weight: 800; text-shadow: 0 2px 20px rgba(0,0,0,.5); pointer-events: none; font-variant-numeric: tabular-nums }
#camara .destello { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none }
#camara .destello.si { animation: destello .22s ease-out }
@keyframes destello { from { opacity: .8 } to { opacity: 0 } }
#camara .zoomtxt { position: absolute; left: 50%; top: 42%; transform: translateX(-50%); padding: 6px 12px; border-radius: 999px; background: rgba(0,0,0,.45); font-weight: 800;
  font-variant-numeric: tabular-nums; pointer-events: none; opacity: 0; transition: opacity .3s }
#camara .zoomtxt.si { opacity: 1; transition: none }
#camara .aviso { position: absolute; left: 50%; top: calc(62px + env(safe-area-inset-top, 0px)); transform: translateX(-50%); padding: 8px 14px; border-radius: 999px; font-size: .85rem; font-weight: 700; white-space: nowrap }
#camara .error { position: absolute; inset: 0; display: grid; place-items: center; padding: 30px; text-align: center; line-height: 1.5 }
#camara .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap }
@media (prefers-reduced-motion: reduce) {
  #camara *, #camara *::before, #camara *::after { animation: none !important; transition: none !important }
  #camara .rec i { opacity: 1 }
}`;

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
  const ico = (n) => g.App.icono(n);
  const coma = (v) => String(Math.round(v * 10) / 10).replace('.', ',');

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
    const A = g.AlbumLogica, C = g.CamaraLogica;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const b = (c, etiqueta, hijos, extra) => h('button', { type: 'button', 'data-c': c, 'aria-label': etiqueta, ...(extra || {}) }, hijos);
    video = h('video', { playsInline: true, muted: true, autoplay: true });
    video.setAttribute('playsinline', '');
    raiz = h('div', { id: 'camara', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Cámara', class: 'modo-foto' },
      video,
      h('div', { class: 'grilla', hidden: true }),
      h('div', { class: 'anillo' }),
      h('div', { class: 'cuenta', hidden: true }),
      h('div', { class: 'destello' }),
      h('div', { class: 'zoomtxt' }),
      h('div', { class: 'arriba' },
        b('cerrar', 'Cerrar la cámara', ico('cruz'), { class: 'chip' }),
        h('span', { class: 'esp' }),
        b('opc', 'Opciones de video', '', { class: 'opc', 'aria-expanded': 'false', 'aria-controls': 'camara-panel', hidden: true }),
        b('flash', 'Flash: apagado', ico('flash-no'), { class: 'chip', hidden: true }),
        b('timer', 'Temporizador: apagado', [ico('temporizador'), h('span', { class: 'badge', hidden: true })], { class: 'chip', 'aria-pressed': 'false' }),
        b('grilla', 'Cuadrícula', ico('grilla'), { class: 'chip', 'aria-pressed': 'false' })),
      h('div', { class: 'rec', hidden: true, role: 'timer', 'aria-label': 'Tiempo grabado' }, h('i'), h('span', null, '0:00')),
      h('div', { class: 'aviso', hidden: true }),
      h('div', { class: 'panel', id: 'camara-panel', hidden: true, role: 'group', 'aria-label': 'Opciones de video' }),
      h('div', { class: 'abajo' },
        h('div', { class: 'zfila' }, h('div', { class: 'zooms', role: 'group', 'aria-label': 'Zoom', hidden: true })),
        h('div', { class: 'modos', role: 'group', 'aria-label': 'Modo' },
          h('div', { class: 'pista' }, b('m-foto', 'Modo foto', 'FOTO', { 'aria-pressed': 'true' }), b('m-video', 'Modo video', 'VIDEO', { 'aria-pressed': 'false' }))),
        h('div', { class: 'fila' },
          h('button', { type: 'button', class: 'ultima', 'data-c': 'ultima', 'aria-label': 'Ver la última en el álbum' }),
          b('pausar', 'Pausar', ico('pausa'), { class: 'pausar', hidden: true }),
          h('button', { type: 'button', class: 'disparo', 'data-c': 'disparo', 'aria-label': 'Sacar foto' }, h('i')),
          b('lente', 'Cambiar de cámara', ico('cambiar-camara'), { class: 'chip lente' }))),
      h('div', { class: 'error', hidden: true }),
      h('div', { class: 'sr', 'aria-live': 'polite' }));
    document.body.appendChild(raiz);

    const q = (c) => raiz.querySelector(`[data-c="${c}"]`), $ = (s) => raiz.querySelector(s);
    const decir = (t) => { $('.sr').textContent = t; };
    let stream = null, track = null, caps = {}, camaras = [], hayFrontal = true, idxCam = 0, gran = null, enGran = false, frontal = false;
    let zoom = 1, digital = false, ultima = null, ocupado = false, turno = 0, nPend = 0;
    let modo = 'foto', flash = 'no', puedeFlash = false, flashFoto = false, segs = 0; const TIMERS = [0, 3, 10];
    let soporte = { resoluciones: ['720p', '1080p'], fps: [30], formatos: [] };
    let opc = { res: '1080p', fps: 30, formato: null, audio: true };
    try { opc = { ...opc, ...JSON.parse(localStorage.getItem('camVideo') || '{}') }; } catch {}
    try { if (localStorage.getItem('camGrilla') === '1') { $('.grilla').hidden = false; q('grilla').setAttribute('aria-pressed', 'true'); } } catch {}
    const guardarOpc = () => { try { localStorage.setItem('camVideo', JSON.stringify(opc)); } catch {} };
    const esSoportado = (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m);

    const soltar = () => { turno++; stream?.getTracks().forEach((t) => t.stop()); stream = null; track = null; video.srcObject = null; };
    function error(t) { const e = $('.error'); e.textContent = t; e.hidden = !t; }

    async function encender() {
      if (grab) return;
      soltar(); error(''); const mio = turno;
      if (!navigator.mediaDevices?.getUserMedia) return error('Este navegador no deja usar la cámara. Probá con "Galería".');
      const base = frontal ? { facingMode: 'user' } : enGran && gran ? { deviceId: { exact: gran } } : camaras[idxCam] ? { deviceId: { exact: camaras[idxCam] } } : { facingMode: { ideal: 'environment' } };
      const v = modo === 'video' ? C.restricciones(opc, base) : { ...base, width: { ideal: 4096 }, height: { ideal: 3072 } };
      const conAudio = modo === 'video' && opc.audio;
      let nuevo;
      try { nuevo = await navigator.mediaDevices.getUserMedia({ video: v, audio: conAudio }); }
      catch (e) {
        if (mio !== turno) return;
        // sin permiso de micrófono: se graba sin sonido en vez de no abrir la cámara
        if (conAudio && e?.name === 'NotAllowedError') {
          try { nuevo = await navigator.mediaDevices.getUserMedia({ video: v, audio: false }); opc.audio = false; avisar('Sin permiso para el micrófono: el video va sin sonido.'); }
          catch (e2) { e = e2; }
        }
        if (!nuevo) {
          console.error(e);
          if (enGran) { enGran = false; toast('La gran angular no está disponible ahora.'); return encender(); }
          return error(e?.name === 'NotAllowedError' ? 'El navegador no tiene permiso para usar la cámara. Tocá el candado de la barra de direcciones, habilitá la cámara y volvé a abrirla.' : 'No se pudo abrir la cámara. Cerrala y probá de nuevo.');
        }
      }
      // mientras pedía la cámara: se cerró, se pasó a segundo plano o se pidió otra lente → esta no sirve
      if (mio !== turno || raiz.hidden || document.hidden) { nuevo.getTracks().forEach((t) => t.stop()); return; }
      stream = nuevo;
      video.addEventListener('loadedmetadata', ajustarGrilla, { once: true });
      track = stream.getVideoTracks()[0]; video.srcObject = stream;
      if (!camaras.length && !frontal) await listarCamaras();
      if (mio !== turno) return;
      caps = track.getCapabilities?.() || {};
      if (modo === 'video') {
        soporte = { resoluciones: C.resolucionesSoportadas(caps), fps: C.fpsSoportados(caps), formatos: C.formatosSoportados(esSoportado, opc.audio) };
        opc = C.normalizar(opc, soporte);
      }
      // ¿flash de verdad para fotos? (si no, se usa la linterna un instante)
      flashFoto = false;
      if (modo === 'foto' && 'ImageCapture' in g) {
        try { const pc = await new ImageCapture(track).getPhotoCapabilities(); flashFoto = (pc.fillLightMode || []).includes('flash'); } catch {}
        if (mio !== turno) return;
      }
      puedeFlash = !!caps.torch || flashFoto;
      if (flash === 'linterna' && caps.torch) track.applyConstraints({ advanced: [{ torch: true }] }).catch(() => {});
      montarControles();
    }

    // la cuadrícula va sobre la imagen, no sobre las bandas negras de los costados
    function ajustarGrilla() {
      const gr = $('.grilla'), r = video.getBoundingClientRect(), vw = video.videoWidth, vh = video.videoHeight;
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
        // si hay una sola trasera extra es la gran angular: va como 0,5× y el de cambiar de cámara queda para frontal/trasera
        gran = A.lentesTraseras(ds, actual).gran;
        if (gran) { camaras = [actual]; idxCam = 0; }
      } catch (e) { console.error(e); }
    }

    // ---------- Controles ----------
    function pasosZoom() {
      const z = caps.zoom, p = [];
      if (z && z.max > z.min) {
        digital = false;
        if (!frontal && gran) p.push({ v: 0.5, lente: 'gran' });
        else if (z.min < 0.95) p.push({ v: Math.max(z.min, 0.5) });
        p.push({ v: 1 });
        if (z.max >= 2) p.push({ v: 2 });
      } else if (modo === 'foto') { // sin zoom de la cámara: zoom digital (recorta al sacar), solo en fotos
        digital = true;
        if (!frontal && gran) p.push({ v: 0.5, lente: 'gran' });
        p.push({ v: 1 }, { v: 2 });
      } else { digital = false; if (!frontal && gran) p.push({ v: 0.5, lente: 'gran' }, { v: 1 }); }
      return p;
    }
    function montarControles() {
      const zs = $('.zooms'), pasos = pasosZoom();
      zoom = enGran ? 0.5 : digital ? Math.max(1, zoom) : track?.getSettings?.().zoom || 1;
      zs.replaceChildren(...pasos.map((p) => { const bt = h('button', { type: 'button', 'aria-label': 'Zoom ' + coma(p.v) + '×' }); bt.dataset.z = p.v; if (p.lente) bt.dataset.lente = p.lente; return bt; }));
      zs.hidden = pasos.length < 2;
      marcarZoom(); aplicarDigital();
      // flash: en fotos, apagado → al sacar → linterna; en video, apagado ↔ linterna
      const fl = q('flash');
      fl.hidden = !(puedeFlash || caps.torch);
      if (modo === 'video' && flash === 'si') flash = 'no';
      if (!caps.torch && flash === 'linterna') flash = 'no';
      pintarFlash();
      q('timer').hidden = modo === 'video';
      q('opc').hidden = modo !== 'video';
      q('opc').textContent = C.chip(opc);
      q('lente').disabled = camaras.length + (hayFrontal ? 1 : 0) < 2;
      if (!$('.panel').hidden) pintarPanel();
    }
    function pintarFlash() {
      const fl = q('flash'), txt = { no: 'apagado', si: 'al sacar la foto', linterna: 'linterna prendida' }[flash];
      fl.replaceChildren(ico(flash === 'no' ? 'flash-no' : flash === 'si' ? 'flash' : 'linterna'));
      fl.classList.toggle('on', flash !== 'no');
      fl.setAttribute('aria-label', 'Flash: ' + txt);
    }
    function marcarZoom() {
      const bts = [...raiz.querySelectorAll('.zooms button')];
      // el activo es el último paso que no supera el zoom actual, y muestra el valor exacto (1,4×)
      let act = null; for (const bt of bts) if (Number(bt.dataset.z) <= zoom + 0.05) act = bt;
      for (const bt of bts) {
        const v = Number(bt.dataset.z), es = bt === act;
        bt.classList.toggle('act', es); bt.setAttribute('aria-pressed', String(es));
        bt.textContent = es ? coma(enGran ? 0.5 : zoom) + '×' : coma(v);
      }
    }
    function aplicarDigital() {
      const s = digital && !enGran ? zoom : 1, espejo = frontal ? ' scaleX(-1)' : '';
      video.style.transform = `scale(${s})${espejo}`;
    }
    let zPend = null, zTxt = 0;
    function ponerZoom(v, mostrarTxt) {
      if (enGran && v >= 0.75) { enGran = false; zoom = 1; encender(); return; }
      if (digital) zoom = Math.min(4, Math.max(1, v));
      else { const z = caps.zoom; if (!z || !track) return; zoom = Math.min(z.max, Math.max(z.min, v)); }
      marcarZoom();
      if (mostrarTxt) { const t = $('.zoomtxt'); t.textContent = coma(zoom) + '×'; t.classList.add('si'); clearTimeout(zTxt); zTxt = setTimeout(() => t.classList.remove('si'), 600); }
      if (digital) return aplicarDigital();
      if (zPend) return; // un cambio por cuadro
      zPend = requestAnimationFrame(() => { zPend = null; track?.applyConstraints({ advanced: [{ zoom }] }).catch(() => {}); });
    }

    // ---------- Panel de opciones de video ----------
    function pintarPanel() {
      const p = $('.panel'), R = C.RESOLUCIONES;
      const fila = (titulo, items) => [h('h3', null, titulo), h('div', { class: 'fila-o', role: 'group', 'aria-label': titulo }, items)];
      const op1 = (clave, valor, contenido, etiqueta) => {
        const bt = h('button', { type: 'button', 'aria-pressed': String(opc[clave] === valor), 'aria-label': etiqueta }, contenido);
        bt.addEventListener('click', () => { if (opc[clave] === valor || grab) return; opc[clave] = valor; guardarOpc(); pintarPanel(); q('opc').textContent = C.chip(opc); encender(); });
        return bt;
      };
      p.replaceChildren(
        ...fila('Resolución', soporte.resoluciones.map((id) => { const r = R.find((x) => x.id === id); return op1('res', id, r.nombre, 'Resolución ' + r.nombre); })),
        ...fila('Cuadros por segundo', soporte.fps.map((f) => op1('fps', f, String(f), f + ' cuadros por segundo'))),
        ...(soporte.formatos.length ? fila('Formato', soporte.formatos.map((f) => op1('formato', f.id, [f.nombre, h('small', null, f.detalle)], 'Formato ' + f.nombre + ' ' + f.detalle))) : []),
        ...fila('Sonido', [op1('audio', true, [ico('microfono'), 'Con sonido'], 'Con sonido'), op1('audio', false, [ico('microfono-no'), 'Sin sonido'], 'Sin sonido')]),
        h('p', { class: 'nota' }, soporte.formatos.length ? 'Hasta 1 minuto por video.' : 'Este navegador no puede grabar video.'));
    }
    function panel(abrir) {
      const p = $('.panel');
      if (abrir == null) abrir = p.hidden;
      if (abrir) pintarPanel();
      p.hidden = !abrir; q('opc').setAttribute('aria-expanded', String(abrir));
      if (abrir) p.querySelector('button[aria-pressed="true"]')?.focus();
    }

    // ---------- Modo ----------
    function ponerModo(m) {
      if (m === modo || grab || ocupado) return;
      modo = m; panel(false);
      raiz.classList.toggle('modo-video', m === 'video'); raiz.classList.toggle('modo-foto', m === 'foto');
      q('m-foto').setAttribute('aria-pressed', String(m === 'foto')); q('m-video').setAttribute('aria-pressed', String(m === 'video'));
      q('disparo').setAttribute('aria-label', m === 'video' ? 'Empezar a grabar' : 'Sacar foto');
      pintarPista();
      if (digital) zoom = 1;
      decir(m === 'video' ? 'Modo video' : 'Modo foto');
      encender();
    }
    function pintarPista() {
      // la palabra del modo elegido queda centrada (como en iPhone o Pixel)
      const pista = $('.modos .pista'), bt = q(modo === 'video' ? 'm-video' : 'm-foto');
      pista.style.transform = `translateX(${-(bt.offsetLeft + bt.offsetWidth / 2)}px)`;
    }

    // ---------- Gestos: pellizcar para zoom, tocar para enfocar, deslizar para cambiar de modo ----------
    const dedos = new Map(); let pellizco = null, ini = null, movio = false;
    video.addEventListener('pointerdown', (e) => {
      dedos.set(e.pointerId, e); movio = false;
      if (dedos.size === 1) ini = { x: e.clientX, y: e.clientY };
      if (dedos.size === 2) { const [a, c] = [...dedos.values()]; pellizco = { d: Math.hypot(a.clientX - c.clientX, a.clientY - c.clientY), z: zoom }; }
    });
    video.addEventListener('pointermove', (e) => {
      if (!dedos.has(e.pointerId)) return; dedos.set(e.pointerId, e);
      if (ini && Math.hypot(e.clientX - ini.x, e.clientY - ini.y) > 8) movio = true;
      if (pellizco && dedos.size === 2) { const [a, c] = [...dedos.values()]; ponerZoom(pellizco.z * Math.hypot(a.clientX - c.clientX, a.clientY - c.clientY) / pellizco.d, true); }
    });
    const soltarDedo = (e) => {
      const eraUno = dedos.size === 1 && !pellizco; dedos.delete(e.pointerId);
      if (dedos.size < 2) pellizco = null;
      if (eraUno && e.type === 'pointerup' && ini) {
        const dx = e.clientX - ini.x, dy = e.clientY - ini.y;
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) ponerModo(dx < 0 ? 'video' : 'foto');
        else if (!movio) { if (!$('.panel').hidden) panel(false); else enfocar(e); }
      }
      if (!dedos.size) ini = null;
    };
    video.addEventListener('pointerup', soltarDedo); video.addEventListener('pointercancel', soltarDedo);

    function enfocar(e) {
      const r = video.getBoundingClientRect(), k = Math.min(r.width / (video.videoWidth || r.width), r.height / (video.videoHeight || r.height));
      const w = (video.videoWidth || r.width) * k, hh = (video.videoHeight || r.height) * k;
      const x = Math.min(1, Math.max(0, (e.clientX - r.left - (r.width - w) / 2) / w)), y = Math.min(1, Math.max(0, (e.clientY - r.top - (r.height - hh) / 2) / hh));
      const an = $('.anillo'); an.style.left = e.clientX + 'px'; an.style.top = e.clientY + 'px';
      an.classList.add('si'); clearTimeout(an._t); an._t = setTimeout(() => an.classList.remove('si'), 800);
      if (!track || !caps.pointsOfInterest) return;
      const modoF = (caps.focusMode || []).includes('single-shot') ? 'single-shot' : (caps.focusMode || []).includes('continuous') ? 'continuous' : undefined;
      track.applyConstraints({ advanced: [{ pointsOfInterest: [{ x: frontal ? 1 - x : x, y }], ...(modoF ? { focusMode: modoF } : {}) }] }).catch(() => {});
    }

    raiz.addEventListener('click', async (e) => {
      const bt = e.target.closest('button'); if (!bt || !raiz.contains(bt) || bt.closest('.panel')) return;
      if (bt.closest('.zooms')) {
        if (bt.dataset.lente === 'gran') { if (enGran || grab) return; enGran = true; zoom = 0.5; return encender(); }
        if (enGran) { if (grab) return; enGran = false; zoom = Number(bt.dataset.z); return encender(); }
        return ponerZoom(Number(bt.dataset.z), false);
      }
      switch (bt.dataset.c) {
        case 'cerrar': return cerrar();
        case 'opc': return panel();
        case 'flash': {
          const ciclo = modo === 'video' ? ['no', 'linterna'] : caps.torch ? ['no', 'si', 'linterna'] : ['no', 'si'];
          const antes = flash; flash = ciclo[(ciclo.indexOf(flash) + 1) % ciclo.length];
          if (caps.torch && (antes === 'linterna') !== (flash === 'linterna')) track?.applyConstraints({ advanced: [{ torch: flash === 'linterna' }] }).catch(() => {});
          pintarFlash(); decir(bt.getAttribute('aria-label')); return;
        }
        case 'grilla': { const gr = $('.grilla'); gr.hidden = !gr.hidden; bt.setAttribute('aria-pressed', String(!gr.hidden)); try { localStorage.setItem('camGrilla', gr.hidden ? '0' : '1'); } catch {} return; }
        case 'timer': {
          segs = TIMERS[(TIMERS.indexOf(segs) + 1) % TIMERS.length];
          const bd = bt.querySelector('.badge'); bd.hidden = !segs; bd.textContent = String(segs);
          bt.setAttribute('aria-pressed', String(!!segs)); bt.setAttribute('aria-label', 'Temporizador: ' + (segs ? segs + ' segundos' : 'apagado'));
          return;
        }
        case 'lente':
          if (grab) return;
          enGran = false; zoom = 1;
          if (!frontal && idxCam < camaras.length - 1) idxCam++;
          else if (!frontal) frontal = true;
          else { frontal = false; idxCam = 0; }
          return encender();
        case 'm-foto': return ponerModo('foto');
        case 'm-video': return ponerModo('video');
        case 'disparo': return modo === 'video' ? (grab ? detener() : grabar()) : disparar();
        case 'pausar': return pausar();
        case 'ultima': if (ultima) op.alTocarUltima?.(ultima.id); return;
      }
    });

    const pulso = () => { const d = q('disparo'); d.classList.remove('pulso'); void d.offsetWidth; d.classList.add('pulso'); };
    function ponerUltima(mini, esVideo) {
      const url = URL.createObjectURL(mini);
      const im = h('img', { alt: '', src: url }); im.onload = () => URL.revokeObjectURL(url);
      q('ultima').replaceChildren(im, esVideo ? ico('play') : null, h('span', { hidden: true }));
      q('ultima').setAttribute('aria-label', esVideo ? 'Ver el último video en el álbum' : 'Ver la última foto en el álbum');
      pendientes(nPend);
    }

    // ---------- Foto ----------
    async function disparar() {
      if (!track || ocupado) return;
      ocupado = true; panel(false);
      const alSacar = op.alSacar;
      try {
        for (let s = segs; s > 0; s--) { const c = $('.cuenta'); c.hidden = false; c.textContent = s; await new Promise((r) => setTimeout(r, 1000)); if (raiz.hidden || document.hidden || !track) return; }
        if (!track) return;
        $('.cuenta').hidden = true;
        pulso();
        let crudo = null, conLinterna = false;
        if (flash === 'si' && caps.torch && !puedeFlashFoto()) { conLinterna = true; await track.applyConstraints({ advanced: [{ torch: true }] }).catch(() => {}); await new Promise((r) => setTimeout(r, 350)); }
        const d = $('.destello'); d.classList.remove('si'); void d.offsetWidth; d.classList.add('si');
        try { if ('ImageCapture' in g) crudo = await new ImageCapture(track).takePhoto(flash === 'si' && puedeFlashFoto() ? { fillLightMode: 'flash' } : undefined); } catch (e) { console.warn('takePhoto', e); }
        if (!crudo) {
          const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
          const gx = c.getContext('2d'); if (frontal) { gx.translate(c.width, 0); gx.scale(-1, 1); } gx.drawImage(video, 0, 0);
          crudo = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
        }
        if (conLinterna) track?.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
        if (digital && zoom > 1.01) crudo = await recortarCentro(crudo, zoom);
        const p = await preparar(crudo), id = crypto.randomUUID();
        ultima = { id }; ponerUltima(p.mini, false); decir('Foto guardada');
        await alSacar(p, { id, tomada: new Date().toISOString(), tipo: 'foto' });
      } catch (e) {
        console.error(e); toast('No se pudo guardar la foto. Probá de nuevo.');
      } finally { ocupado = false; $('.cuenta').hidden = true; }
    }
    const puedeFlashFoto = () => flashFoto === true;
    async function recortarCentro(blob, k) {
      const bm = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      try {
        const w = Math.round(bm.width / k), hh = Math.round(bm.height / k), c = document.createElement('canvas'); c.width = w; c.height = hh;
        c.getContext('2d').drawImage(bm, (bm.width - w) / 2, (bm.height - hh) / 2, w, hh, 0, 0, w, hh);
        return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
      } finally { bm.close?.(); }
    }

    // ---------- Video ----------
    let grab = null; // { rec, partes, bytes, t0, acumulado, pausado, mini, mime, ancho, alto, avisado, intervalo }
    async function grabar() {
      if (!track || grab || ocupado) return;
      const formato = soporte.formatos.find((f) => f.id === opc.formato) || soporte.formatos[0];
      if (!formato) { toast('Este navegador no puede grabar video.'); return; }
      panel(false);
      // la miniatura sale del primer cuadro de la vista previa
      const vw = video.videoWidth, vh = video.videoHeight, m = g.AlbumLogica.escala(vw || 640, vh || 480, 480);
      const cm = document.createElement('canvas'); cm.width = m.ancho; cm.height = m.alto;
      const cx = cm.getContext('2d'); if (frontal) { cx.translate(cm.width, 0); cx.scale(-1, 1); } cx.drawImage(video, 0, 0, cm.width, cm.height);
      let rec;
      try {
        rec = new MediaRecorder(stream, { mimeType: formato.mime, videoBitsPerSecond: C.bitrate(opc.res, opc.fps, opc.audio), audioBitsPerSecond: opc.audio ? 128000 : undefined });
      } catch (e) { console.error(e); toast('No se pudo empezar a grabar. Probá con otro formato.'); return; }
      const mini = await g.ChatMedios.aBlob(cm, 0.75).catch(() => null);
      grab = { rec, partes: [], bytes: 0, t0: performance.now(), acumulado: 0, pausado: false, mini, mime: C.mimeBase(rec.mimeType || formato.mime), ancho: vw, alto: vh, avisado: false };
      const est = grab; // los últimos datos llegan después de parar, cuando grab ya es null
      rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) { est.partes.push(ev.data); est.bytes += ev.data.size; } };
      // si el codificador no anda con ese formato (pasa en algunos Android aunque isTypeSupported diga que sí), se corta
      // y se pasa al formato siguiente para el próximo intento
      rec.onerror = (ev) => { console.error('MediaRecorder', ev.error || ev); est.fallo = formato.id; if (grab === est) detener(); };
      rec.start(1000);
      raiz.classList.add('grabando'); pulso();
      q('disparo').setAttribute('aria-label', 'Terminar el video');
      q('ultima').hidden = true; q('pausar').hidden = typeof rec.pause !== 'function'; q('pausar').setAttribute('aria-label', 'Pausar');
      q('pausar').replaceChildren(ico('pausa'));
      q('lente').disabled = true; q('opc').hidden = true; q('grilla').hidden = true;
      raiz.querySelectorAll('.modos button').forEach((x) => (x.disabled = true));
      $('.rec').hidden = false; $('.rec').classList.remove('pausa', 'final');
      decir('Grabando');
      grab.intervalo = setInterval(tic, 200); tic();
    }
    const transcurrido = () => (grab ? grab.acumulado + (grab.pausado ? 0 : performance.now() - grab.t0) : 0);
    function tic() {
      if (!grab) return;
      const ms = transcurrido(), lim = C.limite(ms, grab.bytes);
      $('.rec span').textContent = C.tiempo(ms);
      if (lim === 'aviso' && !grab.avisado) { grab.avisado = true; $('.rec').classList.add('final'); avisar('Quedan 10 segundos'); decir('Quedan 10 segundos'); }
      if (lim === 'tiempo' || lim === 'tamano') { if (lim === 'tamano') avisar('Llegaste al tamaño máximo del video.'); detener(); }
    }
    function pausar() {
      if (!grab || typeof grab.rec.pause !== 'function') return;
      if (grab.pausado) { grab.rec.resume(); grab.pausado = false; grab.t0 = performance.now(); q('pausar').replaceChildren(ico('pausa')); q('pausar').setAttribute('aria-label', 'Pausar'); decir('Grabando'); }
      else { grab.rec.pause(); grab.acumulado += performance.now() - grab.t0; grab.pausado = true; q('pausar').replaceChildren(ico('play')); q('pausar').setAttribute('aria-label', 'Seguir grabando'); decir('En pausa'); }
      $('.rec').classList.toggle('pausa', grab.pausado);
    }
    function detener() {
      if (!grab || grab.parando) return Promise.resolve();
      const gr = grab; gr.parando = true;
      const dur = Math.max(1, Math.min(C.DURACION_MAX_MS + 2000, Math.round(transcurrido())));
      clearInterval(gr.intervalo);
      const alSacar = op.alSacar;
      // la pantalla vuelve enseguida; el archivo se arma cuando el grabador termina de entregar los datos
      grab = null;
      raiz.classList.remove('grabando');
      q('disparo').setAttribute('aria-label', 'Empezar a grabar');
      q('ultima').hidden = false; q('pausar').hidden = true; $('.rec').hidden = true;
      raiz.querySelectorAll('.modos button').forEach((x) => (x.disabled = false));
      q('grilla').hidden = false; if (track) montarControles();
      return new Promise((listo) => {
        let hecho = false, espera = 0;
        const terminar = async () => {
          if (hecho) return; hecho = true; clearTimeout(espera);
          try {
            const blob = new Blob(gr.partes, { type: gr.mime });
            if (!blob.size && gr.fallo) {
              const otro = soporte.formatos.find((f) => f.id !== gr.fallo);
              soporte.formatos = soporte.formatos.filter((f) => f.id !== gr.fallo);
              if (otro) { opc.formato = otro.id; guardarOpc(); if (track) montarControles(); }
              toast(otro ? `Este teléfono no pudo grabar en ${gr.fallo === 'mp4' ? 'MP4' : 'ese formato'}. Pasamos a ${otro.nombre}: probá de nuevo.` : 'Este teléfono no pudo grabar el video.');
              listo(); return;
            }
            if (!blob.size) throw new Error('video vacío');
            const mini = gr.mini || await g.ChatMedios.aBlob(document.createElement('canvas'), 0.75);
            const id = crypto.randomUUID();
            ultima = { id }; ponerUltima(mini, true); decir('Video guardado');
            await alSacar({ video: blob, mime: gr.mime, mini, ancho: gr.ancho || 1280, alto: gr.alto || 720, duracion_ms: dur }, { id, tomada: new Date().toISOString(), tipo: 'video' });
          } catch (e) { console.error(e); toast('No se pudo guardar el video. Probá de nuevo.'); }
          listo();
        };
        gr.rec.onstop = terminar;
        // algunos teléfonos no avisan el fin (o tardan mucho): a los 4 s se arma con lo que llegó
        espera = setTimeout(() => { console.warn('MediaRecorder no avisó el fin: se usa lo grabado'); terminar(); }, 4000);
        try { if (gr.rec.state !== 'inactive') gr.rec.stop(); else terminar(); } catch (e) { console.error(e); terminar(); }
      });
    }

    let avisoT = 0;
    function avisar(t) { const a = $('.aviso'); a.textContent = t; a.hidden = false; clearTimeout(avisoT); avisoT = setTimeout(() => (a.hidden = true), 2600); }
    function pendientes(n) { nPend = n; const s = q('ultima').querySelector('span'); if (s) { s.hidden = !n; s.textContent = n ? '↑' + n : ''; } }

    function abrir(o = {}) {
      op = o; ultima = null; q('ultima').replaceChildren(); q('ultima').setAttribute('aria-label', 'Ver la última en el álbum');
      raiz.hidden = false; panel(false);
      history.pushState({ ...(history.state || {}), cam: 1 }, '', location.hash || location.pathname + location.search);
      requestAnimationFrame(pintarPista);
      encender();
      q('cerrar').focus();
    }
    async function ocultar() {
      if (grab) await detener(); // cerrar en medio de un video lo guarda
      raiz.hidden = true; soltar(); $('.cuenta').hidden = true; panel(false);
    }
    function cerrar() { if (raiz.hidden) return; if (history.state?.cam) history.back(); else ocultar(); }
    addEventListener('popstate', () => { if (!raiz.hidden && !history.state?.cam) ocultar(); });
    // Escape cierra el panel de opciones o, si no está abierto, la cámara
    document.addEventListener('keydown', (e) => {
      if (raiz.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); if (!$('.panel').hidden) { panel(false); q('opc').focus(); } else cerrar(); }
    });
    document.addEventListener('visibilitychange', () => {
      if (raiz.hidden) return;
      if (document.hidden) { if (grab) detener().then(soltar); else soltar(); } else encender();
    });

    api = { abrir, cerrar, abierta: () => !raiz.hidden, pendientes, _track: () => track, _estado: () => ({ modo, zoom, digital, flash, opc, soporte, grabando: !!grab, caps }) };
  }

  g.Camara = {
    preparar,
    abrir: (o) => { montar(); api.abrir(o); },
    cerrar: () => api?.cerrar(),
    abierta: () => !!api?.abierta(),
    pendientes: (n) => api?.pendientes(n),
    _estado: () => api?._estado(),
  };
})(window);
