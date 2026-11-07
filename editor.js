// Editor de fotos del álbum (copiado de Rumbo al Sur): "Borrar con IA" (pincel + MI-GAN en el teléfono) y "Ajustar y filtros" (Filerobot Image Editor, MIT).
// window.EditorFoto.abrir(blob, { alGuardar(blobEditado) }). Guardar crea una foto nueva: la original no se toca.
(function () {
  const CSS = `
#editorFoto { position: fixed; inset: 0; z-index: 95; background: #111; color: #fff; display: flex; flex-direction: column }
#editorFoto[hidden], #editorFoto [hidden] { display: none !important }
#editorFoto .cab { display: flex; align-items: center; gap: 8px; padding: calc(10px + env(safe-area-inset-top, 0px)) 10px 8px }
#editorFoto .cab b { flex: 1; font-weight: 700 }
/* solo nuestros botones: los del editor de filtros (Filerobot) quedan con sus propios colores */
#editorFoto > .cab button, #editorFoto > .modos button, #editorFoto .herr button { font: inherit; color: #fff; background: rgba(255,255,255,.12); border: 0; border-radius: 999px; padding: 10px 14px; font-weight: 700; font-size: .9rem }
#editorFoto > .cab button:disabled, #editorFoto > .modos button:disabled, #editorFoto .herr button:disabled { opacity: .45 }
/* el guardar y el cerrar de Filerobot sobran: están "Guardar copia" y la X de arriba */
#editorFoto .fr .FIE_topbar-save-button, #editorFoto .fr .FIE_topbar-close-button { display: none !important }
#editorFoto #editorGuardar { background: #00B1EF; color: #001E3D }
#editorFoto .modos { display: flex; gap: 6px; padding: 0 10px 8px }
#editorFoto .modos button { flex: 1 }
#editorFoto .modos button[aria-pressed="true"] { background: #fff; color: #111 }
#editorFoto .lienzo { flex: 1; position: relative; display: grid; place-items: center; overflow: hidden; touch-action: none; min-height: 0 }
#editorFoto .lienzo canvas { grid-area: 1 / 1; max-width: 100%; max-height: 100%; object-fit: contain }
#editorFoto .lienzo canvas.mascara { opacity: .55; cursor: crosshair }
#editorFoto .fr { flex: 1; min-height: 0; background: #fff; color: #222 }
#editorFoto .herr { display: flex; align-items: center; gap: 8px; padding: 10px 10px calc(12px + env(safe-area-inset-bottom, 0px)); flex-wrap: wrap }
#editorFoto .herr label { display: flex; align-items: center; gap: 6px; font-size: .85rem; flex: 1; min-width: 140px }
#editorFoto .herr input[type=range] { flex: 1; accent-color: #fff }
#editorFoto .nota { width: 100%; font-size: .85rem; opacity: .8; min-height: 1.2em }`;

  // Textos del editor de Filerobot, en castellano
  const TRAD = {
    save: 'Guardar', saveAs: 'Guardar como', back: 'Volver', loading: 'Cargando…', cancel: 'Cancelar', apply: 'Aplicar', confirm: 'Confirmar',
    warning: 'Atención', discardChanges: 'Descartar cambios', resetOperations: 'Deshacer todo', undoTitle: 'Deshacer', redoTitle: 'Rehacer',
    showImageTitle: 'Ver la original', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar', toggleZoomMenuTitle: 'Zoom',
    changesLoseWarningHint: 'Si tocás "Deshacer todo" se pierden los cambios. ¿Seguimos?', discardChangesWarningHint: 'Si cerrás, se pierde el último cambio.',
    adjustTab: 'Recortar y girar', finetuneTab: 'Ajustes', filtersTab: 'Filtros', watermarkTab: 'Marca', annotateTabLabel: 'Dibujar', resize: 'Tamaño', resizeTab: 'Tamaño',
    cropTool: 'Recortar', original: 'Original', custom: 'Libre', square: 'Cuadrado', landscape: 'Horizontal', portrait: 'Vertical', ellipse: 'Elipse',
    rotateTool: 'Girar', flipX: 'Espejar ↔', unFlipX: 'Espejar ↔', flipY: 'Espejar ↕', unFlipY: 'Espejar ↕',
    brightnessTool: 'Brillo', contrastTool: 'Contraste', hsvTool: 'Color', hue: 'Tono', brightness: 'Brillo', saturation: 'Saturación', value: 'Luz',
    blurTool: 'Desenfoque', warmthTool: 'Calidez', blur: 'Desenfoque', textTool: 'Texto', penTool: 'Lápiz', lineTool: 'Línea', arrowTool: 'Flecha',
    rectangleTool: 'Rectángulo', ellipseTool: 'Elipse', polygonTool: 'Polígono', imageTool: 'Imagen', size: 'Tamaño', opacity: 'Opacidad', stroke: 'Borde',
    shadow: 'Sombra', position: 'Posición', fontFamily: 'Letra', width: 'Ancho', height: 'Alto', resetSize: 'Volver al tamaño original',
    Invert: 'Invertir', 'Black & White': 'Blanco y negro', resizeWidthTitle: 'Ancho en píxeles', resizeHeightTitle: 'Alto en píxeles', toggleRatioLockTitle: 'Mantener proporción', tabsMenu: 'Menú', download: 'Bajar',
  };

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
  const toast = (t) => window.App?.toast(t);

  let fiePromesa = null;
  const cargarFilerobot = () => fiePromesa || (fiePromesa = new Promise((res, rej) => {
    if (window.FilerobotImageEditor) return res(window.FilerobotImageEditor);
    const s = document.createElement('script'); s.src = 'vendor/filerobot-4.8.1.min.js';
    s.onload = () => res(window.FilerobotImageEditor); s.onerror = () => { fiePromesa = null; rej(new Error('No se pudo cargar el editor. Revisá la señal.')); };
    document.head.appendChild(s);
  }));

  // La IA corre en un worker que se reusa entre ediciones (la sesión del modelo tarda en armarse).
  let worker = null;
  const ia = () => worker || (worker = new Worker('ia-worker.js'));
  const reiniciarIA = () => { if (worker) worker.terminate(); worker = null; };

  let raiz = null, cerrarActual = null;
  function montar() {
    if (raiz) return;
    const st = document.createElement('style'); st.textContent = CSS + `
#editorDescartar { position: absolute; left: 10px; right: 10px; top: calc(60px + env(safe-area-inset-top, 0px)); z-index: 2; background: #fff; color: #111; border-radius: 14px; padding: 14px; box-shadow: 0 12px 30px rgba(0,0,0,.4) }
#editorDescartar[hidden] { display: none }
#editorDescartar p { margin: 0 0 10px; font-weight: 700 }
#editorDescartar div { display: flex; gap: 8px; justify-content: flex-end }
#editorFoto #editorDescartar button { font: inherit; border: 0; border-radius: 999px; padding: 10px 14px; font-weight: 700; font-size: .9rem; background: #eee; color: #111 }
#editorFoto #editorDescartar #editorDescartarSi { background: #c0392b; color: #fff }`;
    document.head.appendChild(st);
    const b = (id, txt, extra) => h('button', { type: 'button', id, ...(extra || {}) }, txt);
    raiz = h('div', { id: 'editorFoto', hidden: true, role: 'dialog', 'aria-label': 'Editar foto' },
      h('div', { class: 'cab' }, b('editorCancelar', g.App.icono('cerrar'), { 'aria-label': 'Cancelar' }), h('b', null, 'Editar foto'), b('editorGuardar', 'Guardar copia', { disabled: true })),
      h('div', { id: 'editorDescartar', hidden: true, role: 'alertdialog', 'aria-label': 'Descartar cambios' },
        h('p', null, '¿Descartar los cambios?'), h('div', null, b('editorDescartarNo', 'Seguir editando'), b('editorDescartarSi', 'Descartar'))),
      h('div', { class: 'modos' }, b('editorModoIA', [g.App.icono('varita'), 'Borrar con IA'], { 'aria-pressed': 'false' }), b('editorModoAjustes', [g.App.icono('ajustes'), 'Ajustar y filtros'], { 'aria-pressed': 'false' })),
      h('div', { class: 'lienzo' }, h('canvas', { class: 'foto' }), h('canvas', { class: 'mascara', hidden: true })),
      h('div', { class: 'fr', hidden: true }),
      h('div', { class: 'herr', 'data-h': 'ia', hidden: true },
        h('label', null, 'Pincel ', h('input', { type: 'range', id: 'editorPincel', min: '10', max: '120', value: '40' })),
        b('editorDeshacer', 'Deshacer trazo'),
        b('editorBorrarIA', 'Borrar lo pintado'),
        h('div', { class: 'nota', id: 'editorNota' }, 'Pintá con el dedo lo que querés borrar.')));
    document.body.appendChild(raiz);
  }

  const abierto = () => !!raiz && !raiz.hidden;

  function abrir(blob, { alGuardar }) {
    montar();
    if (abierto()) return; // ya hay una edición en curso (doble toque)
    const $ = (id) => document.getElementById(id);
    const foto = raiz.querySelector('canvas.foto'), masc = raiz.querySelector('canvas.mascara'), fr = raiz.querySelector('.fr'), herr = raiz.querySelector('[data-h="ia"]');
    let trazos = [], trazo = null, fie = null, refDatos = {}, modo = null, iaOcupada = false, guardando = false, cambios = false, saliendo = false;
    const ctl = new AbortController(), on = (el, ev, fn) => el.addEventListener(ev, fn, { signal: ctl.signal });
    raiz.dataset.ia = ''; $('editorDescartar').hidden = true;
    $('editorNota').textContent = 'Pintá con el dedo lo que querés borrar.';
    const hayCambios = () => cambios || trazos.length > 0 || !!fie;
    const marcarCambio = () => { cambios = true; actualizarBotones(); };
    function actualizarBotones() {
      $('editorGuardar').disabled = guardando || iaOcupada || !(cambios || fie);
      $('editorBorrarIA').disabled = iaOcupada; $('editorModoAjustes').disabled = iaOcupada; $('editorModoIA').disabled = iaOcupada;
    }

    createImageBitmap(blob, { imageOrientation: 'from-image' }).then((bm) => {
      foto.width = masc.width = bm.width; foto.height = masc.height = bm.height;
      foto.getContext('2d').drawImage(bm, 0, 0); bm.close?.();
    }).catch(() => { toast('No se pudo abrir la foto.'); cerrar(true); });

    raiz.hidden = false; history.pushState({ ...(history.state || {}), editor: 1 }, '', location.hash || location.pathname + location.search);

    function pintarMascara() {
      const g = masc.getContext('2d'); g.clearRect(0, 0, masc.width, masc.height);
      g.strokeStyle = '#ff2d55'; g.lineCap = g.lineJoin = 'round';
      for (const t of trazos) { g.lineWidth = t.w; g.beginPath(); t.p.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); if (t.p.length === 1) g.lineTo(t.p[0][0] + 0.1, t.p[0][1]); g.stroke(); }
    }
    const punto = (e) => { const r = masc.getBoundingClientRect(); return [(e.clientX - r.left) * masc.width / r.width, (e.clientY - r.top) * masc.height / r.height]; };
    on(masc, 'pointerdown', (e) => { if (iaOcupada) return; masc.setPointerCapture(e.pointerId); const r = masc.getBoundingClientRect(); trazo = { w: Number($('editorPincel').value) * masc.width / r.width, p: [punto(e)] }; trazos.push(trazo); pintarMascara(); });
    on(masc, 'pointermove', (e) => { if (!trazo) return; trazo.p.push(punto(e)); pintarMascara(); });
    const fin = () => { trazo = null; };
    on(masc, 'pointerup', fin); on(masc, 'pointercancel', fin);
    on($('editorDeshacer'), 'click', () => { trazos.pop(); pintarMascara(); });

    function ponerModo(m) {
      if (iaOcupada) return;
      modo = m;
      $('editorModoIA').setAttribute('aria-pressed', String(m === 'ia')); $('editorModoAjustes').setAttribute('aria-pressed', String(m === 'ajustes'));
      herr.hidden = m !== 'ia'; masc.hidden = m !== 'ia';
      raiz.querySelector('.lienzo').hidden = m === 'ajustes'; fr.hidden = m !== 'ajustes';
      if (m === 'ajustes') abrirAjustes(); else cerrarAjustes(true);
      actualizarBotones();
    }
    on($('editorModoIA'), 'click', () => ponerModo('ia'));
    on($('editorModoAjustes'), 'click', () => ponerModo('ajustes'));

    function terminoIA(msgError) {
      iaOcupada = false; actualizarBotones();
      if (msgError) { console.error(msgError); raiz.dataset.ia = 'error'; reiniciarIA(); $('editorNota').textContent = 'No se pudo borrar. Revisá la señal (la primera vez hay que bajar la IA) y probá de nuevo.'; }
    }
    on($('editorBorrarIA'), 'click', () => {
      if (iaOcupada || !trazos.length) return;
      iaOcupada = true; actualizarBotones(); raiz.dataset.ia = 'trabajando';
      const W = foto.width, H = foto.height;
      // máscara: lo pintado (agrandado 6 px para que no queden bordes) = 0, el resto = 255
      const mc = document.createElement('canvas'); mc.width = W; mc.height = H; const mg = mc.getContext('2d');
      mg.strokeStyle = '#fff'; mg.lineCap = mg.lineJoin = 'round';
      for (const t of trazos) { mg.lineWidth = t.w + 12; mg.beginPath(); t.p.forEach(([x, y], i) => (i ? mg.lineTo(x, y) : mg.moveTo(x, y))); if (t.p.length === 1) mg.lineTo(t.p[0][0] + 0.1, t.p[0][1]); mg.stroke(); }
      const md = mg.getImageData(0, 0, W, H).data, px = foto.getContext('2d').getImageData(0, 0, W, H).data, N = W * H;
      const img = new Uint8Array(3 * N), mask = new Uint8Array(N);
      for (let i = 0; i < N; i++) { img[i] = px[i * 4]; img[N + i] = px[i * 4 + 1]; img[2 * N + i] = px[i * 4 + 2]; mask[i] = md[i * 4 + 3] > 0 ? 0 : 255; }
      let w;
      try { w = ia(); } catch (e) { return terminoIA(e); }
      $('editorNota').textContent = 'Borrando…';
      // si el worker no llega a cargar (sin señal, archivo que falta) no hay mensaje: se avisa por onerror
      w.onerror = (e) => { e.preventDefault?.(); terminoIA(e.message || 'el worker de la IA no cargó'); };
      w.onmessageerror = () => terminoIA('mensaje ilegible de la IA');
      w.onmessage = ({ data: d }) => {
        if (d.tipo === 'progreso') { $('editorNota').textContent = d.preparando ? 'Preparando la IA…' : `Bajando la IA (solo la primera vez): ${Math.round(d.bajado / 1048576)} de ${Math.round(d.total / 1048576)} MB`; return; }
        if (d.tipo === 'error') return terminoIA(d.msg);
        const out = foto.getContext('2d').createImageData(W, H), o = out.data, r = d.res;
        for (let i = 0; i < N; i++) { o[i * 4] = r[i]; o[i * 4 + 1] = r[N + i]; o[i * 4 + 2] = r[2 * N + i]; o[i * 4 + 3] = 255; }
        foto.getContext('2d').putImageData(out, 0, 0);
        trazos = []; pintarMascara(); raiz.dataset.ia = 'listo'; terminoIA(); marcarCambio();
        $('editorNota').textContent = 'Listo. Podés pintar otra cosa o guardar.';
      };
      w.postMessage({ img, mask, W, H }, [img.buffer, mask.buffer]);
    });

    async function abrirAjustes() {
      if (fie) return;
      try {
        const FIE = await cargarFilerobot(); if (modo !== 'ajustes' || ctl.signal.aborted) return;
        const fuente = await new Promise((r) => foto.toBlob(r, 'image/jpeg', 0.95)), url = URL.createObjectURL(fuente);
        const { TABS } = FIE; refDatos = {};
        fie = new FIE(fr, {
          source: url, useBackendTranslations: false, translations: TRAD, language: 'en',
          tabsIds: [TABS.ADJUST, TABS.FINETUNE, TABS.FILTERS, TABS.ANNOTATE, TABS.RESIZE], defaultTabId: TABS.FILTERS,
          defaultSavedImageType: 'jpeg', defaultSavedImageQuality: 0.92, savingPixelRatio: 1, previewPixelRatio: window.devicePixelRatio || 1,
          getCurrentImgDataFnRef: refDatos, closeAfterSave: false, onBeforeSave: () => false,
          onSave: (o) => { if (o?.imageCanvas) terminar(o.imageCanvas); },
          theme: { typography: { fontFamily: 'system-ui, sans-serif' } },
        });
        fie.render({ onClose: () => {} });
        fie._url = url; actualizarBotones();
      } catch (e) { console.error(e); toast(e.message || 'No se pudo abrir el editor.'); ponerModo('ia'); }
    }
    // al salir de "Ajustar", lo editado pasa al lienzo para seguir (o guardar)
    function cerrarAjustes(aplicar) {
      if (!fie) return;
      if (aplicar) {
        try {
          const d = refDatos.current?.({}); const c = d?.imageData?.imageCanvas;
          if (c) { foto.width = masc.width = c.width; foto.height = masc.height = c.height; foto.getContext('2d').drawImage(c, 0, 0); trazos = []; pintarMascara(); cambios = true; }
        } catch (e) { console.error(e); }
      }
      try { fie.terminate(); } catch {}
      URL.revokeObjectURL(fie._url); fie = null; fr.replaceChildren();
    }

    async function terminar(canvas) {
      if (guardando) return; guardando = true; actualizarBotones();
      try {
        const b = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
        await alGuardar(b);
        toast('Guardada como foto nueva en el álbum.');
        cerrar(true);
      } catch (e) { console.error(e); toast('No se pudo guardar. Probá de nuevo.'); }
      finally { guardando = false; if (abierto()) actualizarBotones(); }
    }
    on($('editorGuardar'), 'click', () => {
      if (modo === 'ajustes' && fie) { const d = refDatos.current?.({}); const c = d?.imageData?.imageCanvas; if (c) return terminar(c); }
      terminar(foto);
    });

    function ocultar() {
      cerrarAjustes(false); ctl.abort(); raiz.hidden = true; trazos = [];
      if (iaOcupada) reiniciarIA(); // si quedó trabajando, se corta; si no, el worker queda listo para la próxima
      iaOcupada = false; cerrarActual = null;
    }
    // sin cambios (o confirmado): cierra; con cambios: pregunta antes
    function cerrar(forzar) {
      if (raiz.hidden) return;
      if (!forzar && hayCambios()) { $('editorDescartar').hidden = false; return; }
      $('editorDescartar').hidden = true; saliendo = true;
      if (history.state?.editor) history.back(); else ocultar();
    }
    cerrarActual = () => cerrar(true);
    on($('editorCancelar'), 'click', () => cerrar(false));
    on($('editorDescartarNo'), 'click', () => { $('editorDescartar').hidden = true; });
    on($('editorDescartarSi'), 'click', () => cerrar(true));
    on(window, 'popstate', () => {
      if (raiz.hidden || history.state?.editor) return;
      if (!saliendo && hayCambios() && $('editorDescartar').hidden) {
        // atrás con cambios: se vuelve a poner la entrada y se pregunta
        history.pushState({ ...(history.state || {}), editor: 1 }, '', location.hash || location.pathname + location.search);
        $('editorDescartar').hidden = false; return;
      }
      ocultar();
    });
    ponerModo('ia');
  }

  window.EditorFoto = { abrir, abierto, cerrar: () => cerrarActual?.(), _reiniciarIA: reiniciarIA };
})();
