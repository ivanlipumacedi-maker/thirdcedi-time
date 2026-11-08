// Editor de fotos del álbum: filtros con intensidad, recorte (libre, 1:1, 4:5, 16:9) y giro de 90°. Todo en el teléfono, con canvas.
// La lógica (filtros, recorte y giro) vive en editor-logica.js. Guardar crea una foto nueva: la original no se toca.
// window.EditorFoto = { abrir(blob, { alGuardar(blobEditado) }), abierto(), cerrar() }
(function (g) {
  const CSS = `
#editorFoto { position: fixed; inset: 0; z-index: 95; background: #0b0c0e; color: #fff; display: flex; flex-direction: column; font-family: var(--fuente-ui);
  user-select: none; -webkit-user-select: none }
#editorFoto[hidden], #editorFoto [hidden] { display: none !important }
#editorFoto button { font: inherit; color: inherit; border: 0; background: none; cursor: pointer; -webkit-tap-highlight-color: transparent }
#editorFoto button:focus-visible, #editorFoto input:focus-visible { outline: 2px solid #fff; outline-offset: 2px }
#editorFoto button:disabled { opacity: .38; cursor: default }
#editorFoto .ico { width: 22px; height: 22px; fill: currentColor; flex: none; vertical-align: 0 }
/* vidrio esmerilado: desenfoque real, borde de medio pixel y sombra suave */
#editorFoto .chip { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; flex: none;
  background: rgba(30,32,36,.5); backdrop-filter: blur(18px) saturate(1.6); -webkit-backdrop-filter: blur(18px) saturate(1.6);
  box-shadow: inset 0 0 0 .5px rgba(255,255,255,.22), 0 4px 14px rgba(0,0,0,.28); transition: transform .15s ease, background-color .2s }
#editorFoto .chip:active:not(:disabled), #editorFoto .herr:active, #editorFoto .pastilla:active:not(:disabled) { transform: scale(.92) }
#editorFoto .cab { display: flex; align-items: center; gap: 8px; padding: calc(8px + env(safe-area-inset-top, 0px)) 12px 8px }
#editorFoto .cab .t { flex: 1; text-align: center; font-weight: 700; font-size: 1rem; letter-spacing: .01em }
#editorFoto .pastilla { display: inline-flex; align-items: center; gap: 7px; height: 44px; padding: 0 16px 0 13px; border-radius: 999px;
  background: #00B1EF; color: #001E3D; font-weight: 800; font-size: .92rem; box-shadow: 0 4px 14px rgba(0,177,239,.28); transition: transform .15s ease, opacity .2s }
#editorFoto .pastilla .ico { width: 18px; height: 18px }
#editorFoto .lienzo { flex: 1; min-height: 0; position: relative; display: grid; place-items: center; padding: 8px 16px; overflow: hidden; touch-action: none }
#editorFoto .lienzo canvas { grid-area: 1 / 1; max-width: 100%; max-height: 100%; display: block; border-radius: 2px; box-shadow: 0 10px 40px rgba(0,0,0,.45) }
#editorFoto .lienzo canvas.fundido { position: absolute; pointer-events: none; transition: opacity .28s ease; box-shadow: none }
/* recorte: la foto entera, lo que queda afuera en penumbra, grilla de tercios y esquinas finas */
#editorFoto .caja { position: absolute; box-shadow: 0 0 0 100vmax rgba(0,0,0,.58); outline: 1px solid rgba(255,255,255,.9); touch-action: none; cursor: move;
  background:
    linear-gradient(90deg, transparent calc(33.33% - .5px), rgba(255,255,255,.42) calc(33.33% - .5px) calc(33.33% + .5px), transparent calc(33.33% + .5px) calc(66.66% - .5px), rgba(255,255,255,.42) calc(66.66% - .5px) calc(66.66% + .5px), transparent calc(66.66% + .5px)),
    linear-gradient(transparent calc(33.33% - .5px), rgba(255,255,255,.42) calc(33.33% - .5px) calc(33.33% + .5px), transparent calc(33.33% + .5px) calc(66.66% - .5px), rgba(255,255,255,.42) calc(66.66% - .5px) calc(66.66% + .5px), transparent calc(66.66% + .5px)) }
#editorFoto .caja .m { position: absolute; width: 44px; height: 44px; padding: 0; touch-action: none }
#editorFoto .caja .m::after { content: ''; position: absolute; width: 18px; height: 18px; border: 0 solid #fff; filter: drop-shadow(0 0 2px rgba(0,0,0,.5)) }
#editorFoto .caja .m[data-m="no"] { left: -22px; top: -22px; cursor: nwse-resize } #editorFoto .caja .m[data-m="no"]::after { left: 19px; top: 19px; border-left-width: 2.5px; border-top-width: 2.5px }
#editorFoto .caja .m[data-m="ne"] { right: -22px; top: -22px; cursor: nesw-resize } #editorFoto .caja .m[data-m="ne"]::after { right: 19px; top: 19px; border-right-width: 2.5px; border-top-width: 2.5px }
#editorFoto .caja .m[data-m="so"] { left: -22px; bottom: -22px; cursor: nesw-resize } #editorFoto .caja .m[data-m="so"]::after { left: 19px; bottom: 19px; border-left-width: 2.5px; border-bottom-width: 2.5px }
#editorFoto .caja .m[data-m="se"] { right: -22px; bottom: -22px; cursor: nwse-resize } #editorFoto .caja .m[data-m="se"]::after { right: 19px; bottom: 19px; border-right-width: 2.5px; border-bottom-width: 2.5px }
#editorFoto .caja .m:focus-visible { outline-offset: -8px; border-radius: 50% }
#editorFoto .panel { padding: 4px 0 2px; min-height: 152px; display: flex; flex-direction: column; justify-content: flex-end }
#editorFoto .int { display: flex; align-items: center; gap: 12px; padding: 0 20px; height: 44px; color: #c9d0d8; font-size: .82rem; font-weight: 600; transition: opacity .2s }
#editorFoto .int.apagada { opacity: 0; pointer-events: none }
#editorFoto .int input { flex: 1; min-width: 0; height: 44px; margin: 0; background: transparent; -webkit-appearance: none; appearance: none; --v: 100% }
#editorFoto .int input::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: linear-gradient(90deg, #fff var(--v), rgba(255,255,255,.22) var(--v)) }
#editorFoto .int input::-moz-range-track { height: 4px; border-radius: 2px; background: rgba(255,255,255,.22) }
#editorFoto .int input::-moz-range-progress { height: 4px; border-radius: 2px; background: #fff }
#editorFoto .int input::-webkit-slider-thumb { -webkit-appearance: none; width: 24px; height: 24px; margin-top: -10px; border-radius: 50%; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.45) }
#editorFoto .int input::-moz-range-thumb { width: 24px; height: 24px; border: 0; border-radius: 50%; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.45) }
#editorFoto .int output { color: #fff; width: 44px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 700 }
#editorFoto .tira { display: flex; gap: 12px; padding: 8px 16px 6px; overflow-x: auto; scroll-snap-type: x mandatory; scroll-padding: 0 16px; scrollbar-width: none; overscroll-behavior-x: contain }
#editorFoto .tira::-webkit-scrollbar { display: none }
#editorFoto .fl { flex: none; min-width: 72px; scroll-snap-align: start; display: grid; justify-items: center; align-content: start; gap: 7px; white-space: nowrap; padding: 0; font-size: .74rem; font-weight: 500; color: #aab3bd; transition: color .2s }
#editorFoto .fl canvas { width: 72px; height: 72px; border-radius: 14px; display: block; background: #222; box-shadow: 0 0 0 2px #0b0c0e, 0 0 0 2px transparent; transition: box-shadow .2s ease, transform .15s ease }
#editorFoto .fl[aria-pressed="true"] { color: #fff; font-weight: 800 }
#editorFoto .fl[aria-pressed="true"] canvas { box-shadow: 0 0 0 2px #0b0c0e, 0 0 0 4px #00B1EF }
#editorFoto .fl:active canvas { transform: scale(.94) }
#editorFoto .fl:focus-visible { outline: none } #editorFoto .fl:focus-visible canvas { box-shadow: 0 0 0 2px #0b0c0e, 0 0 0 4px #fff }
#editorFoto .props { display: flex; justify-content: center; align-items: center; gap: 6px; padding: 8px 12px }
#editorFoto .props button { min-width: 56px; height: 40px; padding: 0 12px; border-radius: 12px; font-weight: 700; font-size: .85rem; color: #c9d0d8;
  background: rgba(255,255,255,.06); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.12); transition: background-color .2s, color .2s }
#editorFoto .props button[aria-pressed="true"] { background: rgba(255,255,255,.18); color: #fff }
#editorFoto .props .rest { min-width: 0; padding: 0 6px; background: none; box-shadow: none; font-weight: 600; color: #8f99a5 }
#editorFoto .barra { display: flex; justify-content: space-around; padding: 6px 16px calc(10px + env(safe-area-inset-bottom, 0px)) }
#editorFoto .herr { display: grid; justify-items: center; gap: 4px; min-width: 72px; min-height: 54px; padding: 6px 10px; border-radius: 14px; color: #9aa4b1;
  font-size: .74rem; font-weight: 700; transition: color .2s, background-color .2s, transform .15s ease }
#editorFoto .herr[aria-pressed="true"] { color: #fff; background: rgba(255,255,255,.1) }
#editorDescartar { position: absolute; left: 12px; right: 12px; top: calc(64px + env(safe-area-inset-top, 0px)); z-index: 3; background: rgba(36,38,43,.92);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); color: #fff; border-radius: 18px; padding: 16px; box-shadow: inset 0 0 0 .5px rgba(255,255,255,.18), 0 16px 40px rgba(0,0,0,.5) }
#editorDescartar p { margin: 0 0 12px; font-weight: 700 }
#editorDescartar div { display: flex; gap: 8px; justify-content: flex-end }
#editorFoto #editorDescartar button { border-radius: 999px; padding: 0 16px; height: 44px; font-weight: 700; font-size: .9rem; background: rgba(255,255,255,.12) }
#editorFoto #editorDescartar #editorDescartarSi { background: #e5484d; color: #fff }
@media (prefers-reduced-motion: reduce) { #editorFoto *, #editorFoto *::after { transition: none !important; animation: none !important } }`;

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
  const VISTA = 1400; // lado largo de la vista previa (la foto se guarda a resolución completa)
  const MAX_LADO = 4096; // como Camara.preparar
  const MINI = 144; // miniaturas de la tira (72 px en pantalla, 2x)
  const ESQUINAS = { no: 'Esquina de arriba a la izquierda del recorte', ne: 'Esquina de arriba a la derecha del recorte', so: 'Esquina de abajo a la izquierda del recorte', se: 'Esquina de abajo a la derecha del recorte' };

  let raiz = null, cerrarActual = null;
  function montar() {
    if (raiz) return;
    const E = g.EditorLogica;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const b = (props, ...hijos) => h('button', { type: 'button', ...props }, ...hijos);
    raiz = h('div', { id: 'editorFoto', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Editar foto' },
      h('div', { class: 'cab' },
        b({ class: 'chip', 'data-e': 'cancelar', 'aria-label': 'Cancelar' }, ico('cruz')),
        h('span', { class: 't', 'data-e': 'titulo' }, 'Editar'),
        b({ class: 'chip', 'data-e': 'deshacer', 'aria-label': 'Deshacer', disabled: true }, ico('deshacer')),
        b({ class: 'pastilla', id: 'editorGuardar', 'data-e': 'guardar', disabled: true }, ico('tilde'), h('span', null, 'Guardar copia'))),
      h('div', { id: 'editorDescartar', hidden: true, role: 'alertdialog', 'aria-label': 'Descartar cambios' },
        h('p', null, '¿Descartar los cambios?'), h('div', null, b({ id: 'editorDescartarNo' }, 'Seguir editando'), b({ id: 'editorDescartarSi' }, 'Descartar'))),
      h('div', { class: 'lienzo' },
        h('canvas', { class: 'vista', role: 'img', 'aria-label': 'Vista previa de la foto' }),
        h('div', { class: 'caja', hidden: true }, Object.keys(ESQUINAS).map((m) => b({ class: 'm', 'data-m': m, 'aria-label': ESQUINAS[m] })))),
      h('div', { class: 'panel', 'data-p': 'filtros' },
        h('label', { class: 'int' }, ico('intensidad'), h('span', null, 'Intensidad'),
          h('input', { type: 'range', id: 'editorIntensidad', min: '0', max: '100', step: '1', value: '100' }), h('output', { for: 'editorIntensidad' }, '100 %')),
        h('div', { class: 'tira', role: 'group', 'aria-label': 'Filtros' },
          E.FILTROS.map((f) => b({ class: 'fl', 'data-f': f.id, 'aria-pressed': 'false', title: f.desc }, h('canvas', { width: MINI, height: MINI }), h('span', null, f.nombre))))),
      h('div', { class: 'panel', 'data-p': 'recorte', hidden: true },
        h('div', { class: 'props', role: 'group', 'aria-label': 'Proporción' },
          E.PROPORCIONES.map((p) => b({ 'data-r': p.id, 'aria-pressed': 'false' }, p.nombre)), b({ class: 'rest', 'data-e': 'restablecer' }, 'Restablecer'))),
      h('div', { class: 'barra' },
        b({ class: 'herr', 'data-modo': 'filtros', 'aria-pressed': 'true' }, ico('filtros'), 'Filtros'),
        b({ class: 'herr', 'data-modo': 'recorte', 'aria-pressed': 'false' }, ico('recortar'), 'Recortar'),
        b({ class: 'herr', 'data-e': 'rotar', 'aria-label': 'Rotar 90 grados a la derecha' }, ico('rotar'), 'Rotar')));
    document.body.appendChild(raiz);
  }

  const abierto = () => !!raiz && !raiz.hidden;
  const lienzo = (w, hh) => { const c = document.createElement('canvas'); c.width = w; c.height = hh; return c; };
  /** dibuja la foto girada (0/90/180/270) en un lienzo de ancho×alto (ya girado) */
  function dibujarGirada(ctx, src, giro, ancho, alto) {
    ctx.save();
    if (giro === 90) { ctx.translate(ancho, 0); ctx.rotate(Math.PI / 2); }
    else if (giro === 180) { ctx.translate(ancho, alto); ctx.rotate(Math.PI); }
    else if (giro === 270) { ctx.translate(0, alto); ctx.rotate(-Math.PI / 2); }
    const [w, hh] = giro % 180 ? [alto, ancho] : [ancho, alto];
    ctx.drawImage(src, 0, 0, w, hh);
    ctx.restore();
  }
  const reducir = () => g.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function abrir(blob, { alGuardar }) {
    montar();
    if (abierto()) return; // ya hay una edición en curso (doble toque)
    const E = g.EditorLogica;
    const $ = (sel) => raiz.querySelector(sel), $$ = (sel) => [...raiz.querySelectorAll(sel)];
    const vista = $('canvas.vista'), caja = $('.caja'), rango = $('#editorIntensidad'), salidaInt = $('.int output');
    const ctl = new AbortController(), on = (el, ev, fn, o) => el.addEventListener(ev, fn, { signal: ctl.signal, ...(o || {}) });
    const focoAntes = document.activeElement;

    let src = null, Wf = 0, Hf = 0; // la foto original y su tamaño (ya enderezada)
    let e = { filtro: 'original', intensidad: 100, giro: 0, recorte: E.ENTERO(), prop: 'libre' };
    let pila = [], modo = 'filtros', guardando = false, saliendo = false;
    let base = null; // la foto girada a tamaño de vista previa
    let crudo = null, lleno = null, salidaDatos = null; // pixels del recorte: sin filtro, con filtro al 100 % y lo que se ve
    const copia = (x) => ({ ...x, recorte: { ...x.recorte } });
    const dims = () => E.girado(Wf, Hf, e.giro); // tamaño de la foto girada, a resolución completa
    const proporcion = () => E.PROPORCIONES.find((p) => p.id === e.prop).r;
    const recordar = () => { pila.push(copia(e)); if (pila.length > 40) pila.shift(); };

    $('#editorDescartar').hidden = true;
    $('[data-e="titulo"]').textContent = 'Editar';
    raiz.hidden = false;
    history.pushState({ ...(history.state || {}), editor: 1 }, '', location.hash || location.pathname + location.search);
    $('[data-e="cancelar"]').focus();

    createImageBitmap(blob, { imageOrientation: 'from-image' }).then((bm) => {
      if (ctl.signal.aborted) { bm.close?.(); return; }
      src = bm; Wf = bm.width; Hf = bm.height;
      // si es más grande que lo que guarda el álbum, se edita ya achicada (el álbum la achicaría igual)
      const k = Math.min(1, MAX_LADO / Math.max(Wf, Hf)); Wf = Math.round(Wf * k); Hf = Math.round(Hf * k);
      armarBase(); ponerModo('filtros'); pintarTodo();
    }).catch((x) => { console.error(x); toast('No se pudo abrir la foto.'); cerrar(true); });

    // ---------- Vista previa ----------
    function armarBase() {
      const { ancho, alto } = dims(), k = Math.min(1, VISTA / Math.max(ancho, alto));
      base = lienzo(Math.max(1, Math.round(ancho * k)), Math.max(1, Math.round(alto * k)));
      dibujarGirada(base.getContext('2d'), src, e.giro, base.width, base.height);
    }
    const escalaBase = () => base.width / dims().ancho;
    function recortarBase() {
      // en modo recorte se ve la foto entera; en filtros, solo lo recortado
      const r = modo === 'recorte' ? { x: 0, y: 0, w: base.width, h: base.height } : E.enPixeles(e.recorte, base.width, base.height);
      const c = lienzo(r.w, r.h), x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(base, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      crudo = x.getImageData(0, 0, r.w, r.h);
      lleno = null;
    }
    function filtrar() {
      lleno = new ImageData(new Uint8ClampedArray(crudo.data), crudo.width, crudo.height);
      E.aplicar(lleno.data, crudo.width, crudo.height, e.filtro, 1, { escala: escalaBase(), lado: Math.min(dims().ancho, dims().alto) });
    }
    function mostrar() {
      if (!crudo) return;
      if (!lleno) filtrar();
      if (!salidaDatos || salidaDatos.width !== crudo.width || salidaDatos.height !== crudo.height) salidaDatos = new ImageData(crudo.width, crudo.height);
      E.mezclar(crudo.data, lleno.data, e.intensidad / 100, salidaDatos.data);
      if (vista.width !== crudo.width || vista.height !== crudo.height) { vista.width = crudo.width; vista.height = crudo.height; }
      vista.getContext('2d').putImageData(salidaDatos, 0, 0);
      if (modo === 'recorte') requestAnimationFrame(pintarCaja);
    }
    /** fundido: la vista anterior queda encima y se desvanece */
    function conFundido(fn) {
      if (reducir() || !vista.width) return fn();
      const r = vista.getBoundingClientRect(), l = $('.lienzo').getBoundingClientRect();
      const viejo = lienzo(vista.width, vista.height); viejo.getContext('2d').drawImage(vista, 0, 0);
      viejo.className = 'fundido';
      Object.assign(viejo.style, { left: r.left - l.left + 'px', top: r.top - l.top + 'px', width: r.width + 'px', height: r.height + 'px' });
      $('.lienzo').appendChild(viejo);
      fn();
      requestAnimationFrame(() => requestAnimationFrame(() => { viejo.style.opacity = '0'; }));
      setTimeout(() => viejo.remove(), 400);
    }
    function pintarMinis() {
      // un cuadrado del centro de lo recortado, con cada filtro al 100 %
      const r = E.enPixeles(e.recorte, base.width, base.height), lado = Math.min(r.w, r.h);
      const c = lienzo(MINI, MINI), x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(base, r.x + (r.w - lado) / 2, r.y + (r.h - lado) / 2, lado, lado, 0, 0, MINI, MINI);
      const datos = x.getImageData(0, 0, MINI, MINI), escala = (MINI / lado) * escalaBase();
      for (const bt of $$('.fl')) {
        const d = new ImageData(new Uint8ClampedArray(datos.data), MINI, MINI);
        E.aplicar(d.data, MINI, MINI, bt.dataset.f, 1, { escala, lado: Math.min(dims().ancho, dims().alto) });
        bt.querySelector('canvas').getContext('2d').putImageData(d, 0, 0);
      }
    }
    function pintarControles() {
      $$('.fl').forEach((bt) => bt.setAttribute('aria-pressed', String(bt.dataset.f === e.filtro)));
      $$('.props [data-r]').forEach((bt) => bt.setAttribute('aria-pressed', String(bt.dataset.r === e.prop)));
      rango.value = String(e.intensidad); rango.style.setProperty('--v', e.intensidad + '%');
      salidaInt.textContent = E.textoIntensidad(e.intensidad);
      $('.int').classList.toggle('apagada', e.filtro === 'original');
      rango.disabled = e.filtro === 'original';
      rango.setAttribute('aria-valuetext', E.textoIntensidad(e.intensidad));
      $('[data-e="deshacer"]').disabled = !pila.length || guardando;
      $('[data-e="guardar"]').disabled = guardando || !E.hayCambios(e);
    }
    function pintarTodo() { if (!src) return; recortarBase(); mostrar(); pintarMinis(); pintarControles(); }

    // ---------- Filtros e intensidad ----------
    on($('.tira'), 'click', (ev) => {
      const bt = ev.target.closest('.fl'); if (!bt || !src || bt.dataset.f === e.filtro) return;
      recordar(); e.filtro = bt.dataset.f; e.intensidad = 100;
      conFundido(() => { lleno = null; mostrar(); });
      pintarControles();
      bt.scrollIntoView({ behavior: reducir() ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
    });
    let intAntes = null, cuadro = 0;
    on(rango, 'pointerdown', () => { if (intAntes == null) intAntes = copia(e); });
    on(rango, 'input', () => {
      if (intAntes == null) intAntes = copia(e);
      e.intensidad = Number(rango.value); pintarControles();
      if (!cuadro) cuadro = requestAnimationFrame(() => { cuadro = 0; mostrar(); });
    });
    on(rango, 'change', () => { if (intAntes && intAntes.intensidad !== e.intensidad) { pila.push(intAntes); pintarControles(); } intAntes = null; });

    // ---------- Modos, giro, deshacer ----------
    function ponerModo(m) {
      modo = m;
      $$('.barra [data-modo]').forEach((bt) => bt.setAttribute('aria-pressed', String(bt.dataset.modo === m)));
      $('[data-p="filtros"]').hidden = m !== 'filtros'; $('[data-p="recorte"]').hidden = m !== 'recorte';
      caja.hidden = m !== 'recorte';
      $('[data-e="titulo"]').textContent = m === 'recorte' ? 'Recortar' : 'Editar';
      if (src) { recortarBase(); mostrar(); if (m === 'filtros') pintarMinis(); }
    }
    on($('.barra'), 'click', (ev) => {
      const bt = ev.target.closest('button'); if (!bt || !src) return;
      if (bt.dataset.modo && bt.dataset.modo !== modo) conFundido(() => ponerModo(bt.dataset.modo));
      else if (bt.dataset.e === 'rotar') {
        recordar();
        e.giro = (e.giro + 90) % 360; e.recorte = E.girarRect(e.recorte);
        // un recorte cuadrado sigue igual; 4:5 o 16:9 quedarían acostados: se vuelven a encajar en la foto girada
        if (proporcion() && proporcion() !== 1) e.recorte = E.ajustarProporcion(e.recorte, proporcion(), dims().ancho, dims().alto);
        armarBase(); conFundido(pintarTodo);
      }
    });
    on($('[data-e="deshacer"]'), 'click', () => {
      if (!pila.length || guardando) return;
      const antes = e; e = pila.pop();
      if (antes.giro !== e.giro) armarBase();
      conFundido(pintarTodo);
    });

    // ---------- Recorte ----------
    function pintarCaja() {
      if (caja.hidden || !vista.width) return;
      const r = vista.getBoundingClientRect(), l = $('.lienzo').getBoundingClientRect(), rc = e.recorte;
      Object.assign(caja.style, { left: r.left - l.left + rc.x * r.width + 'px', top: r.top - l.top + rc.y * r.height + 'px', width: rc.w * r.width + 'px', height: rc.h * r.height + 'px' });
    }
    on(g, 'resize', () => { if (abierto()) pintarCaja(); });
    on($('.props'), 'click', (ev) => {
      const bt = ev.target.closest('button'); if (!bt || !src) return;
      if (bt.dataset.e === 'restablecer') { if (E.esEntero(e.recorte) && e.prop === 'libre') return; recordar(); e.recorte = E.ENTERO(); e.prop = 'libre'; }
      else { if (bt.dataset.r === e.prop) return; recordar(); e.prop = bt.dataset.r; e.recorte = E.ajustarProporcion(proporcion() ? E.ENTERO() : e.recorte, proporcion(), dims().ancho, dims().alto); }
      pintarCaja(); pintarControles();
    });
    let arrastre = null;
    on(caja, 'pointerdown', (ev) => {
      if (ev.button > 0 || arrastre) return;
      const m = ev.target.closest('.m')?.dataset.m || 'mover', r = vista.getBoundingClientRect();
      arrastre = { id: ev.pointerId, m, x: ev.clientX, y: ev.clientY, rc: { ...e.recorte }, antes: copia(e), w: r.width, h: r.height };
      caja.setPointerCapture(ev.pointerId); ev.preventDefault();
    });
    on(caja, 'pointermove', (ev) => {
      if (!arrastre || ev.pointerId !== arrastre.id) return;
      e.recorte = E.mover(arrastre.rc, arrastre.m, (ev.clientX - arrastre.x) / arrastre.w, (ev.clientY - arrastre.y) / arrastre.h, proporcion(), dims().ancho, dims().alto);
      pintarCaja();
    });
    const soltar = (ev) => {
      if (!arrastre || ev.pointerId !== arrastre.id) return;
      const a = arrastre; arrastre = null;
      const rc = e.recorte, b0 = a.antes.recorte;
      if (Math.abs(rc.x - b0.x) + Math.abs(rc.y - b0.y) + Math.abs(rc.w - b0.w) + Math.abs(rc.h - b0.h) > 1e-4) { pila.push(a.antes); pintarControles(); }
    };
    on(caja, 'pointerup', soltar); on(caja, 'pointercancel', soltar);
    function teclaManija(ev) { // flechas sobre una esquina (o el recuadro) mueven el recorte de a 1 %
      const m = ev.target.closest?.('.m')?.dataset.m; if (!m) return false;
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key]; if (!d) return false;
      ev.preventDefault(); recordar();
      e.recorte = E.mover(e.recorte, m, d[0] * 0.01, d[1] * 0.01, proporcion(), dims().ancho, dims().alto);
      pintarCaja(); pintarControles(); return true;
    }

    // ---------- Guardar ----------
    async function guardar() {
      if (guardando || !src || !E.hayCambios(e)) return;
      guardando = true; pintarControles();
      const etiqueta = $('[data-e="guardar"] span'); etiqueta.textContent = 'Guardando…';
      try {
        await new Promise((r) => setTimeout(r, 30)); // que se vea "Guardando…" antes del trabajo pesado
        const { ancho, alto } = dims(), r = E.enPixeles(e.recorte, ancho, alto);
        const c = lienzo(r.w, r.h), x = c.getContext('2d', { willReadFrequently: true });
        x.translate(-r.x, -r.y); dibujarGirada(x, src, e.giro, ancho, alto); x.setTransform(1, 0, 0, 1, 0, 0);
        if (e.filtro !== 'original' && e.intensidad > 0) {
          const d = x.getImageData(0, 0, r.w, r.h);
          E.aplicar(d.data, r.w, r.h, e.filtro, e.intensidad / 100, { escala: 1, lado: Math.min(ancho, alto) });
          x.putImageData(d, 0, 0);
        }
        const bl = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.92));
        if (!bl) throw new Error('no se pudo codificar la foto');
        await alGuardar(bl);
        toast('Guardada como foto nueva en el álbum.');
        cerrar(true);
      } catch (x) { console.error(x); toast('No se pudo guardar. Probá de nuevo.'); }
      finally { guardando = false; etiqueta.textContent = 'Guardar copia'; if (abierto()) pintarControles(); }
    }
    on($('[data-e="guardar"]'), 'click', guardar);

    // ---------- Cerrar ----------
    function ocultar() {
      ctl.abort(); raiz.hidden = true; cerrarActual = null;
      $$('.lienzo canvas.fundido').forEach((x) => x.remove());
      src?.close?.(); src = null; base = crudo = lleno = salidaDatos = null;
      if (focoAntes && focoAntes.isConnected) focoAntes.focus?.();
    }
    // sin cambios (o confirmado): cierra; con cambios: pregunta antes
    function cerrar(forzar) {
      if (raiz.hidden) return;
      if (!forzar && E.hayCambios(e) && !guardando) { $('#editorDescartar').hidden = false; $('#editorDescartarNo').focus(); return; }
      $('#editorDescartar').hidden = true; saliendo = true;
      if (history.state?.editor) history.back(); else ocultar();
    }
    cerrarActual = () => cerrar(true);
    on($('[data-e="cancelar"]'), 'click', () => cerrar(false));
    on($('#editorDescartarNo'), 'click', () => { $('#editorDescartar').hidden = true; $('[data-e="cancelar"]').focus(); });
    on($('#editorDescartarSi'), 'click', () => cerrar(true));
    on(g, 'popstate', () => {
      if (raiz.hidden || history.state?.editor) return;
      if (!saliendo && E.hayCambios(e) && $('#editorDescartar').hidden) {
        // atrás con cambios: se vuelve a poner la entrada y se pregunta
        history.pushState({ ...(history.state || {}), editor: 1 }, '', location.hash || location.pathname + location.search);
        $('#editorDescartar').hidden = false; return;
      }
      ocultar();
    });

    // Teclado: el editor es modal. Escape y las flechas no llegan a lo de abajo (el visor del álbum o la cámara).
    on(g, 'keydown', (ev) => {
      if (raiz.hidden) return;
      if (ev.key === 'Escape') {
        ev.preventDefault(); ev.stopImmediatePropagation();
        if (!$('#editorDescartar').hidden) { $('#editorDescartar').hidden = true; $('[data-e="cancelar"]').focus(); }
        else if (modo === 'recorte') conFundido(() => ponerModo('filtros'));
        else cerrar(false);
        return;
      }
      if (/^Arrow/.test(ev.key)) { ev.stopImmediatePropagation(); teclaManija(ev); return; }
      if (ev.key === 'Tab') { // el foco da la vuelta adentro del editor
        const xs = $$('button, input').filter((x) => !x.disabled && !x.closest('[hidden]') && x.offsetParent !== null);
        if (!xs.length) return;
        const i = xs.indexOf(document.activeElement);
        const sig = ev.shiftKey ? (i <= 0 ? xs[xs.length - 1] : xs[i - 1]) : (i < 0 || i === xs.length - 1 ? xs[0] : xs[i + 1]);
        ev.preventDefault(); ev.stopImmediatePropagation(); sig.focus();
      }
    }, { capture: true });
  }

  g.EditorFoto = { abrir, abierto, cerrar: () => cerrarActual?.() };
})(window);
