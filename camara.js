// Cámara a pantalla completa del álbum: FOTO y VIDEO. Abre la lente principal por deviceId; zoom (pellizco y 0,5× / 1× / 2× / 3×), flash y linterna, cambiar de
// cámara (la frontal con 1 y 0,8 para que entre más gente), temporizador, cuadrícula, tocar para enfocar y la última foto en miniatura.
// En FOTO la vista previa es el sensor entero (en Samsung, con 1080p la cámara da un recorte del centro) y se agranda
// hasta que lo que sale en la foto llena la pantalla. En VIDEO: resolución, cuadros por
// segundo, formato y sonido (solo lo que el teléfono da), pausa si el navegador la tiene y un tope de 60 s y 100 MB. En FOTO: proporción
// (4:3, 16:9, 1:1) y resolución; brillo en los dos si la cámara lo deja. Android saca con takePhoto; iPhone, del cuadro del video.
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
#camara .opc { height: 34px; padding: 0 13px; border-radius: 999px; white-space: nowrap; flex: none; font-size: .8rem; font-weight: 700; letter-spacing: .02em; font-variant-numeric: tabular-nums; transition: transform .15s ease }
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
#camara .panel .brillo { display: flex; align-items: center; gap: 10px; margin: 0 2px 12px; min-height: 44px }
#camara .panel .brillo input { flex: 1; accent-color: #FFD24A; height: 30px }
#camara .panel .brillo output { min-width: 3.2em; text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; font-size: .85rem }
#camara .panel .brillo button { width: 44px; height: 44px; border-radius: 12px; background: rgba(255,255,255,.08); font-weight: 700; font-size: .8rem }
/* lo que queda fuera de la foto (1:1 sobre la vista 4:3) se oscurece */
#camara .marco { position: absolute; pointer-events: none; box-shadow: 0 0 0 100vmax rgba(0,0,0,.55) }
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
/* a dónde va la foto (cámara de la barra de abajo): debajo de la fila de arriba, al centro */
#camara .destino { position: absolute; left: 50%; transform: translateX(-50%); top: calc(64px + env(safe-area-inset-top, 0px)); max-width: calc(100% - 40px);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px }
#camara .destino b { color: #FFD24A; font-weight: 800 }
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

  /** Endereza, recorta (opcional), achica (4096 px o el lado pedido) y genera JPEG 0,92 + miniatura WebP 480 px + media JPEG
   *  1600 px. Acepta Blob/File/ImageBitmap/canvas. o = { recorte(ancho, alto) → { x, y, ancho, alto }, lado } */
  async function preparar(fuente, o = {}) {
    const A = g.AlbumLogica, M = g.ChatMedios;
    const propio = !(fuente instanceof Blob);
    const bm = propio ? fuente : await createImageBitmap(fuente, { imageOrientation: 'from-image' });
    try {
      const r = o.recorte ? o.recorte(bm.width, bm.height) : { x: 0, y: 0, ancho: bm.width, alto: bm.height };
      const dib = (cv, w, hh) => { const x = cv.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bm, r.x, r.y, r.ancho, r.alto, 0, 0, w, hh); };
      const { ancho, alto } = A.escala(r.ancho, r.alto, Math.min(A.MAX_LADO, o.lado || A.MAX_LADO));
      const c = document.createElement('canvas'); c.width = ancho; c.height = alto; dib(c, ancho, alto);
      const foto = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
      const m = A.escala(r.ancho, r.alto, 480), cm = document.createElement('canvas'); cm.width = m.ancho; cm.height = m.alto; dib(cm, m.ancho, m.alto);
      const mini = await M.aBlob(cm, 0.75);
      const md = A.escala(r.ancho, r.alto, 1600), cmd = document.createElement('canvas'); cmd.width = md.ancho; cmd.height = md.alto; dib(cmd, md.ancho, md.alto);
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
      h('div', { class: 'marco', hidden: true }),
      h('div', { class: 'grilla', hidden: true }),
      h('div', { class: 'anillo' }),
      h('div', { class: 'cuenta', hidden: true }),
      h('div', { class: 'destello' }),
      h('div', { class: 'zoomtxt' }),
      h('div', { class: 'arriba' },
        b('cerrar', 'Cerrar la cámara', ico('cruz'), { class: 'chip' }),
        h('span', { class: 'esp' }),
        b('opc', 'Opciones de la cámara', '', { class: 'opc', 'aria-expanded': 'false', 'aria-controls': 'camara-panel' }),
        b('flash', 'Flash: apagado', ico('flash-no'), { class: 'chip', hidden: true }),
        b('timer', 'Temporizador: apagado', [ico('temporizador'), h('span', { class: 'badge', hidden: true })], { class: 'chip', 'aria-pressed': 'false' }),
        b('grilla', 'Cuadrícula', ico('grilla'), { class: 'chip', 'aria-pressed': 'false' })),
      b('destino', 'Cambiar a dónde va la foto', '', { class: 'opc destino', hidden: true }),
      h('div', { class: 'rec', hidden: true, role: 'timer', 'aria-label': 'Tiempo grabado' }, h('i'), h('span', null, '0:00')),
      h('div', { class: 'aviso', hidden: true }),
      h('div', { class: 'panel', id: 'camara-panel', hidden: true, role: 'group', 'aria-label': 'Opciones de la cámara' }),
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
    // lentes: L = C.lentes(enumerateDevices) cuando hay etiquetas. lente: 'principal' | 'gran' | 'tele' | 'otra' (otras
    // traseras que no se reconocen; se recorren con el botón de cambiar de cámara junto con la frontal)
    let stream = null, track = null, caps = {}, L = null, lente = 'principal', idxOtra = 0, frontal = false, revisoPrincipal = false;
    let zoom = 1, digital = false, ultima = null, ocupado = false, turno = 0, nPend = 0, fotoCaps = null;
    let modo = 'foto', flash = 'no', puedeFlash = false, flashFoto = false, segs = 0; const TIMERS = [0, 3, 10];
    const hayTakePhoto = 'ImageCapture' in g && typeof g.ImageCapture?.prototype?.takePhoto === 'function';
    let soporte = { resoluciones: ['720p', '1080p'], fps: [30], formatos: [] };
    let opc = { res: '1080p', fps: 30, formato: null, audio: true };
    try { opc = { ...opc, ...JSON.parse(localStorage.getItem('camVideo') || '{}') }; } catch {}
    let opcF = C.normalizarFoto();
    try { opcF = C.normalizarFoto(JSON.parse(localStorage.getItem('camFoto2') || '{}')); } catch {}
    let brillo = 0; // compensación de exposición elegida (vuelve a 0 al abrir la cámara)
    try { if (localStorage.getItem('camGrilla') === '1') { $('.grilla').hidden = false; q('grilla').setAttribute('aria-pressed', 'true'); } } catch {}
    const guardarOpc = () => { try { localStorage.setItem('camVideo', JSON.stringify(opc)); localStorage.setItem('camFoto2', JSON.stringify(opcF)); } catch {} };
    const esSoportado = (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m);

    const soltar = () => { turno++; stream?.getTracks().forEach((t) => t.stop()); stream = null; track = null; video.srcObject = null; };
    function error(t) { const e = $('.error'); e.textContent = t; e.hidden = !t; }

    function idLente() {
      if (!L) return null;
      if (frontal) return L.frontal;
      if (lente === 'gran') return L.gran;
      if (lente === 'tele') return L.tele;
      if (lente === 'otra') return L.otras[idxOtra] || null;
      return L.principal;
    }
    async function encender() {
      if (grab) return;
      soltar(); error(''); const mio = turno;
      if (!navigator.mediaDevices?.getUserMedia) return error('Este navegador no deja usar la cámara. Probá con "Galería".');
      // con las cámaras ya listadas se abre la lente exacta por deviceId (con facingMode elige el navegador, y en
      // varios Android elige la gran angular o la de menos calidad)
      const id = idLente();
      const base = id ? { deviceId: { exact: id } } : { facingMode: frontal ? 'user' : { ideal: 'environment' } };
      const v = modo === 'video' ? C.restricciones(opc, base) : C.restriccionesFoto(opcF, base, !hayTakePhoto);
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
          if (!frontal && lente !== 'principal') { lente = 'principal'; toast('Esa lente no está disponible ahora.'); return encender(); }
          if (id && e?.name !== 'NotAllowedError') { L = null; return encender(); } // la lista quedó vieja: se vuelve a pedir
          return error(e?.name === 'NotAllowedError' ? 'El navegador no tiene permiso para usar la cámara. Tocá el candado de la barra de direcciones, habilitá la cámara y volvé a abrirla.' : 'No se pudo abrir la cámara. Cerrala y probá de nuevo.');
        }
      }
      // mientras pedía la cámara: se cerró, se pasó a segundo plano o se pidió otra lente → esta no sirve
      if (mio !== turno || raiz.hidden || document.hidden) { nuevo.getTracks().forEach((t) => t.stop()); return; }
      stream = nuevo;
      video.addEventListener('loadedmetadata', ajustarGrilla, { once: true });
      track = stream.getVideoTracks()[0]; video.srcObject = stream;
      try { video.play()?.catch(() => {}); } catch {} // Safari a veces no arranca solo aunque tenga autoplay
      if (!L) await listarCamaras();
      if (mio !== turno) return;
      // la primera vez se abre con facingMode (sin permiso no hay etiquetas): si no cayó en la principal, se cambia
      if (!revisoPrincipal && !frontal && lente === 'principal' && L?.principal) {
        revisoPrincipal = true;
        const actual = track.getSettings?.().deviceId;
        if (actual && actual !== L.principal) return encender();
      }
      caps = track.getCapabilities?.() || {};
      // enfoque, exposición y balance de blancos automáticos y continuos (como la cámara del teléfono)
      const auto = {};
      if ((caps.focusMode || []).includes('continuous')) auto.focusMode = 'continuous';
      if ((caps.exposureMode || []).includes('continuous')) auto.exposureMode = 'continuous';
      if ((caps.whiteBalanceMode || []).includes('continuous')) auto.whiteBalanceMode = 'continuous';
      if (caps.exposureCompensation && brillo) auto.exposureCompensation = brillo;
      if (Object.keys(auto).length) track.applyConstraints({ advanced: [auto] }).catch(() => {});
      if (modo === 'video') {
        soporte = { resoluciones: C.resolucionesSoportadas(caps), fps: C.fpsSoportados(caps), formatos: C.formatosSoportados(esSoportado, opc.audio) };
        opc = C.normalizar(opc, soporte);
      }
      // ¿flash de verdad para fotos? (si no, se usa la linterna un instante) y el tamaño máximo de foto del sensor
      flashFoto = false; fotoCaps = null;
      if (modo === 'foto' && hayTakePhoto) {
        try { fotoCaps = await new ImageCapture(track).getPhotoCapabilities(); flashFoto = (fotoCaps.fillLightMode || []).includes('flash'); } catch {}
        if (mio !== turno) return;
      }
      puedeFlash = !!caps.torch || flashFoto;
      if (flash === 'linterna' && caps.torch) track.applyConstraints({ advanced: [{ torch: true }] }).catch(() => {});
      montarControles();
    }

    // el área de la imagen en pantalla y, adentro, lo que va a salir en la foto. En fotos la vista previa es el sensor
    // entero (4:3) y la foto se recorta: la vista se agranda hasta que lo que sale en la foto llena el ancho o el alto de
    // la pantalla (como la cámara del teléfono en 16:9). ampliar: cuánto se agranda el video (va en su transform).
    let ampliar = 1;
    function areaFoto() {
      const r = raiz.getBoundingClientRect(), vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh || !r.width) return null;
      const rc = modo === 'foto' ? C.recorte(vw, vh, opcF.prop) : { x: 0, y: 0, ancho: vw, alto: vh };
      const k0 = Math.min(r.width / vw, r.height / vh), k = Math.min(r.width / rc.ancho, r.height / rc.alto);
      const img = { x: r.left + (r.width - vw * k) / 2, y: r.top + (r.height - vh * k) / 2, w: vw * k, h: vh * k };
      return { img, ampliar: k / k0, foto: { x: img.x + rc.x * k, y: img.y + rc.y * k, w: rc.ancho * k, h: rc.alto * k } };
    }
    // la cuadrícula y el marco van sobre lo que sale en la foto, no sobre las bandas negras de los costados
    function ajustarGrilla() {
      const a = areaFoto(), gr = $('.grilla'), mc = $('.marco');
      if (!a) return;
      if (Math.abs(a.ampliar - ampliar) > 0.001) { ampliar = a.ampliar; aplicarDigital(); }
      const pos = (el, f) => Object.assign(el.style, { inset: 'auto', left: f.x + 'px', top: f.y + 'px', width: f.w + 'px', height: f.h + 'px' });
      pos(gr, a.foto); pos(mc, a.foto);
      mc.hidden = Math.abs(a.foto.w - a.img.w) < 2 && Math.abs(a.foto.h - a.img.h) < 2;
    }
    addEventListener('resize', () => { if (!raiz.hidden) ajustarGrilla(); });
    video.addEventListener('resize', () => { if (!raiz.hidden) ajustarGrilla(); }); // el video cambia de tamaño al girar el teléfono

    async function listarCamaras() {
      try {
        const ds = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
        const l = C.lentes(ds);
        L = l.sinEtiquetas ? null : l; // sin permiso todavía o sin etiquetas: se sigue con facingMode
      } catch (e) { console.error(e); }
    }

    // ---------- Controles ----------
    // pasos de zoom: 0,5 (gran angular), 1 y 2 (la principal, con el zoom de la cámara o digital al sacar) y 3 (teleobjetivo).
    // Cada lente es una cámara aparte: tocar 0,5 o 3 la cambia.
    const FACTOR = { gran: 0.5, principal: 1, tele: 3, otra: 1 };
    // frontal con zoom de la cámara: el "1" es zoom 1,25 del sensor entero y "0,8" es el sensor entero (abre la toma
    // para que entre más gente, como el botón de grupo de la cámara del teléfono). zoom guarda el valor que se ve.
    const BASE_FRONTAL = 1.25;
    const escala = () => (frontal && !digital ? BASE_FRONTAL : 1);
    let zoomObjetivo = null, zoomFrontal = 1;
    const zoomVisible = () => (frontal ? zoom : lente === 'principal' || lente === 'otra' ? zoom : FACTOR[lente]);
    function pasosZoom() {
      const z = caps.zoom, p = [];
      const enPrincipal = frontal || lente === 'principal' || lente === 'otra';
      digital = enPrincipal && !(z && z.max > z.min) && modo === 'foto'; // sin zoom de la cámara: zoom digital (recorta al sacar), solo en fotos
      if (frontal) {
        // sin zoom de la cámara la frontal queda en 1 (no hay cómo abrir más la toma)
        if (!digital && z && z.min <= 1 && z.max >= BASE_FRONTAL) p.push({ v: 0.8 }, { v: 1 });
        return p;
      }
      if (L?.gran) p.push({ v: 0.5, lente: 'gran' });
      else if (enPrincipal && z && z.min < 0.95) p.push({ v: Math.max(z.min, 0.5) });
      p.push({ v: 1, lente: 'principal' });
      if (!enPrincipal || digital || (z && z.max >= 2)) p.push({ v: 2, lente: 'principal' });
      if (!frontal && L?.tele) p.push({ v: 3, lente: 'tele' });
      return p;
    }
    function montarControles() {
      const zs = $('.zooms'), pasos = pasosZoom();
      zoom = digital ? Math.max(1, zoom) : (track?.getSettings?.().zoom || 1) / escala();
      if (frontal && !digital && pasos.length > 1 && !zoomObjetivo) zoomObjetivo = zoomFrontal; // vuelve a como estaba
      zs.replaceChildren(...pasos.map((p) => { const bt = h('button', { type: 'button', 'aria-label': 'Zoom ' + coma(p.v) + '×' }); bt.dataset.z = p.v; if (p.lente) bt.dataset.lente = p.lente; return bt; }));
      zs.hidden = pasos.length < 2;
      marcarZoom(); aplicarDigital();
      if (zoomObjetivo && (lente === 'principal' || frontal)) { const zo = zoomObjetivo; zoomObjetivo = null; ponerZoom(zo, false); }
      zoomObjetivo = null;
      // flash: en fotos, apagado → al sacar → linterna; en video, apagado ↔ linterna
      const fl = q('flash');
      fl.hidden = !(puedeFlash || caps.torch);
      if (modo === 'video' && flash === 'si') flash = 'no';
      if (!caps.torch && flash === 'linterna') flash = 'no';
      pintarFlash();
      q('timer').hidden = modo === 'video';
      q('opc').hidden = false;
      pintarChip();
      // cambiar de cámara: traseras que no van en el zoom (si las hay) y la frontal
      q('lente').disabled = !!L && (1 + L.otras.length + (L.frontal ? 1 : 0)) < 2;
      ajustarGrilla();
      if (!$('.panel').hidden) pintarPanel();
    }
    // el tamaño de foto que da la cámara: el de takePhoto si es más grande que el video (si no, se saca del video)
    const sensor = () => {
      const fw = fotoCaps?.imageWidth?.max || 0, fh = fotoCaps?.imageHeight?.max || 0;
      return fw * fh > video.videoWidth * video.videoHeight ? { ancho: fw, alto: fh } : { ancho: video.videoWidth, alto: video.videoHeight };
    };
    const pintarChip = () => { q('opc').textContent = modo === 'video' ? C.chip(opc) : C.chipFoto(opcF, sensor()); };
    function pintarFlash() {
      const fl = q('flash'), txt = { no: 'apagado', si: 'al sacar la foto', linterna: 'linterna prendida' }[flash];
      fl.replaceChildren(ico(flash === 'no' ? 'flash-no' : flash === 'si' ? 'flash' : 'linterna'));
      fl.classList.toggle('on', flash !== 'no');
      fl.setAttribute('aria-label', 'Flash: ' + txt);
    }
    function marcarZoom() {
      const bts = [...raiz.querySelectorAll('.zooms button')], zv = zoomVisible();
      // el activo es el último paso que no supera el zoom actual, y muestra el valor exacto (1,4×)
      let act = null; for (const bt of bts) if (Number(bt.dataset.z) <= zv + 0.05) act = bt;
      for (const bt of bts) {
        const v = Number(bt.dataset.z), es = bt === act;
        bt.classList.toggle('act', es); bt.setAttribute('aria-pressed', String(es));
        bt.textContent = es ? coma(zv) + '×' : coma(v);
      }
    }
    function aplicarDigital() {
      const s = (digital ? zoom : 1) * ampliar, espejo = frontal ? ' scaleX(-1)' : '';
      video.style.transform = `scale(${s})${espejo}`;
    }
    function cambiarLente(nueva, z) {
      if (grab || nueva === lente) return;
      lente = nueva; zoom = 1; zoomObjetivo = z && z > 1 ? z : null;
      decir({ gran: 'Gran angular', tele: 'Teleobjetivo', principal: 'Cámara principal' }[nueva] || '');
      encender();
    }
    let zPend = null, zTxt = 0;
    function ponerZoom(v, mostrarTxt) {
      // pellizcando desde la gran angular o el teleobjetivo se vuelve a la principal al cruzar 1× / 2,5×
      if (!frontal && lente === 'gran' && v >= 0.75) return cambiarLente('principal');
      if (!frontal && lente === 'tele' && v < 2.5 && !caps.zoom) return cambiarLente('principal', 2);
      if (!frontal && lente !== 'principal' && lente !== 'otra') return;
      if (digital) zoom = Math.min(4, Math.max(1, v));
      else { const z = caps.zoom, e = escala(); if (!z || !track) return; zoom = Math.min(z.max / e, Math.max(z.min / e, v)); if (frontal) zoomFrontal = zoom; }
      marcarZoom();
      if (mostrarTxt) { const t = $('.zoomtxt'); t.textContent = coma(zoom) + '×'; t.classList.add('si'); clearTimeout(zTxt); zTxt = setTimeout(() => t.classList.remove('si'), 600); }
      if (digital) return aplicarDigital();
      if (zPend) return; // un cambio por cuadro
      zPend = requestAnimationFrame(() => { zPend = null; track?.applyConstraints({ advanced: [{ zoom: zoom * escala() }] }).catch(() => {}); });
    }

    // ---------- Panel de opciones (foto o video) ----------
    function pintarPanel() {
      const p = $('.panel'), R = C.RESOLUCIONES;
      const fila = (titulo, items) => [h('h3', null, titulo), h('div', { class: 'fila-o', role: 'group', 'aria-label': titulo }, items)];
      // o: el objeto de opciones (opc de video u opcF de foto); alCambiar: qué hacer después (por defecto, reabrir la cámara)
      const op1 = (o, clave, valor, contenido, etiqueta, alCambiar) => {
        const bt = h('button', { type: 'button', 'aria-pressed': String(o[clave] === valor), 'aria-label': etiqueta }, contenido);
        bt.addEventListener('click', () => {
          if (o[clave] === valor || grab) return;
          const antes = o[clave]; o[clave] = valor; guardarOpc(); pintarPanel(); pintarChip();
          (alCambiar || encender)(antes);
        });
        return bt;
      };
      const brilloFila = [];
      const ec = caps.exposureCompensation;
      if (ec && typeof ec.max === 'number' && ec.max > ec.min) {
        const txt = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + coma(Math.abs(v));
        const out = h('output', null, txt(brillo));
        const rango = h('input', { type: 'range', min: ec.min, max: ec.max, step: ec.step || 0.1, value: brillo, 'aria-label': 'Brillo' });
        let pend = null;
        const aplicar = () => { pend = null; track?.applyConstraints({ advanced: [{ exposureCompensation: brillo }] }).catch(() => {}); };
        rango.addEventListener('input', () => { brillo = Number(rango.value); out.textContent = txt(brillo); if (!pend) pend = requestAnimationFrame(aplicar); });
        const auto = h('button', { type: 'button', 'aria-label': 'Brillo automático' }, 'Auto');
        auto.addEventListener('click', () => { brillo = 0; rango.value = 0; out.textContent = txt(0); aplicar(); });
        brilloFila.push(h('h3', null, 'Brillo'), h('div', { class: 'brillo' }, rango, out, auto));
      }
      if (modo === 'foto') {
        const s = sensor();
        p.replaceChildren(
          // 16:9 necesita otra vista previa; entre 4:3 y 1:1 solo cambia el marco
          ...fila('Proporción', C.PROPORCIONES.map((x) => op1(opcF, 'prop', x.id, x.nombre, 'Proporción ' + x.nombre,
            (antes) => { if ((antes === '16:9') !== (opcF.prop === '16:9')) encender(); else ajustarGrilla(); }))),
          ...fila('Resolución', C.RES_FOTO.map((x) => op1(opcF, 'res', x.id, [x.nombre, h('small', null, String(C.megapixeles(x.id, opcF.prop, s)).replace('.', ',') + ' MP')],
            'Resolución ' + x.nombre, () => {}))),
          ...brilloFila,
          h('p', { class: 'nota' }, opcF.res === 'alta' ? 'La más nítida. Liviana sube más rápido con poca señal.' : 'Menos peso: sube más rápido con poca señal.'));
        return;
      }
      p.replaceChildren(
        ...fila('Resolución', soporte.resoluciones.map((id) => { const r = R.find((x) => x.id === id); return op1(opc, 'res', id, r.nombre, 'Resolución ' + r.nombre); })),
        ...fila('Cuadros por segundo', soporte.fps.map((f) => op1(opc, 'fps', f, String(f), f + ' cuadros por segundo'))),
        ...(soporte.formatos.length ? fila('Formato', soporte.formatos.map((f) => op1(opc, 'formato', f.id, [f.nombre, h('small', null, f.detalle)], 'Formato ' + f.nombre + ' ' + f.detalle))) : []),
        ...fila('Sonido', [op1(opc, 'audio', true, [ico('microfono'), 'Con sonido'], 'Con sonido'), op1(opc, 'audio', false, [ico('microfono-no'), 'Sin sonido'], 'Sin sonido')]),
        ...brilloFila,
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
        const z = Number(bt.dataset.z), nueva = bt.dataset.lente;
        if (nueva && !frontal && nueva !== lente) return cambiarLente(nueva, z);
        return ponerZoom(z, false);
      }
      switch (bt.dataset.c) {
        case 'cerrar': return cerrar();
        case 'opc': return panel();
        case 'destino': if (!grab) op.alTocarDestino?.(); return;
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
          // principal → otras traseras (las que no van en el zoom) → frontal → principal
          zoom = 1;
          if (frontal) { frontal = false; lente = 'principal'; idxOtra = 0; }
          else if (L && lente === 'principal' && L.otras.length) { lente = 'otra'; idxOtra = 0; }
          else if (L && lente === 'otra' && idxOtra < L.otras.length - 1) idxOtra++;
          else { frontal = true; lente = 'principal'; }
          decir(frontal ? 'Cámara frontal' : 'Cámara trasera');
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
    // Android (Chrome): takePhoto() pide la captura de foto del sensor a resolución completa (no un cuadro del video).
    // iPhone (Safari) no tiene ImageCapture: la foto es el cuadro del video, que por eso se abre a la resolución más alta.
    // Si takePhoto devuelve algo más chico que el video (pasa en algunos teléfonos), se usa el cuadro del video.
    function cuadro() {
      const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
      const gx = c.getContext('2d'); if (frontal) { gx.translate(c.width, 0); gx.scale(-1, 1); } gx.drawImage(video, 0, 0);
      return c;
    }
    async function tomarFoto(conFlash) {
      if (!hayTakePhoto) return cuadro();
      const ic = new ImageCapture(track), extra = conFlash ? { fillLightMode: 'flash' } : {};
      let blob = null;
      try { blob = await ic.takePhoto({ ...C.tamanoTakePhoto(fotoCaps), ...extra }); }
      catch (e) { console.warn('takePhoto con tamaño', e); try { blob = await ic.takePhoto(conFlash ? extra : undefined); } catch (e2) { console.warn('takePhoto', e2); } }
      if (!blob) return cuadro();
      const bm = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      if (bm.width * bm.height * 1.05 < video.videoWidth * video.videoHeight) { bm.close?.(); return cuadro(); }
      return bm;
    }
    async function disparar() {
      if (!track || ocupado) return;
      ocupado = true; panel(false);
      const alSacar = op.alSacar;
      try {
        for (let s = segs; s > 0; s--) { const c = $('.cuenta'); c.hidden = false; c.textContent = s; await new Promise((r) => setTimeout(r, 1000)); if (raiz.hidden || document.hidden || !track) return; }
        if (!track) return;
        $('.cuenta').hidden = true;
        pulso();
        let conLinterna = false;
        if (flash === 'si' && caps.torch && !flashFoto) { conLinterna = true; await track.applyConstraints({ advanced: [{ torch: true }] }).catch(() => {}); await new Promise((r) => setTimeout(r, 350)); }
        const d = $('.destello'); d.classList.remove('si'); void d.offsetWidth; d.classList.add('si');
        const prop = opcF.prop, k = digital && zoom > 1.01 ? zoom : 1, lado = (C.RES_FOTO.find((x) => x.id === opcF.res) || C.RES_FOTO[0]).lado;
        const fuente = await tomarFoto(flash === 'si' && flashFoto);
        if (conLinterna) track?.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
        // recorte: primero la proporción elegida y, adentro, el zoom digital (al centro)
        const recorte = (w, hh) => {
          const r = C.recorte(w, hh, prop), rw = Math.round(r.ancho / k), rh = Math.round(r.alto / k);
          return { x: r.x + Math.round((r.ancho - rw) / 2), y: r.y + Math.round((r.alto - rh) / 2), ancho: rw, alto: rh };
        };
        const p = await preparar(fuente, { recorte, lado }), id = crypto.randomUUID();
        ultima = { id }; ponerUltima(p.mini, false); decir('Foto guardada');
        await alSacar(p, { id, tomada: new Date().toISOString(), tipo: 'foto' });
      } catch (e) {
        console.error(e); toast('No se pudo guardar la foto. Probá de nuevo.');
      } finally { ocupado = false; $('.cuenta').hidden = true; }
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

    // 'Para: Todos' / 'Para: Asado del viernes' (solo si quien abre la cámara deja elegir)
    function ponerDestino(texto) {
      const d = q('destino'); d.hidden = !texto;
      if (texto) { d.replaceChildren('Para: ', h('b', null, texto)); d.setAttribute('aria-label', 'La foto va a ' + texto + '. Tocá para cambiar'); }
    }
    function abrir(o = {}) {
      op = o; ultima = null; brillo = 0; ponerDestino(o.destino); q('ultima').replaceChildren(); q('ultima').setAttribute('aria-label', 'Ver la última en el álbum');
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

    api = { abrir, cerrar, abierta: () => !raiz.hidden, pendientes, destino: ponerDestino, _track: () => track, _estado: () => ({ modo, zoom, digital, flash, opc, opcF, lente, frontal, L, brillo, soporte, grabando: !!grab, caps, fotoCaps, video: { w: video.videoWidth, h: video.videoHeight }, deviceId: track?.getSettings?.().deviceId }) };
  }

  g.Camara = {
    preparar,
    abrir: (o) => { montar(); api.abrir(o); },
    cerrar: () => api?.cerrar(),
    abierta: () => !!api?.abierta(),
    pendientes: (n) => api?.pendientes(n),
    destino: (t) => api?.destino(t),
    _estado: () => api?._estado(),
  };
})(window);
