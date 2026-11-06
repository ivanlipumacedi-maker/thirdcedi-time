// Cuentas claras de una actividad: gastos por parte (actividad / tercer tiempo), saldos, transferencias y pagos.
// Cuentas.abrir(contenedor, ctx) devuelve { cerrar(), actualizar(ctx) }. ctx = { actividad, anotados: { actividad: [ids],
// tercer: [ids] }, perfilDe(id), yo, anotado }. La sección se ve si estás anotado o si figurás en las cuentas (quien se
// bajó y debe plata la sigue viendo: la base la deja leer con en_cuentas). Necesita CuentasLogica.
(function (g) {
  const L = g.CuentasLogica;
  const CAMPOS_G = 'id,actividad,parte,pagador,monto,concepto,creado,cargado_por';
  const CAMPOS_P = 'id,actividad,parte,de,a,monto,creado,cargado_por';
  // los motivos que devuelve la base ya están en español: se muestran tal cual
  const MOTIVO = /^(La actividad|Quien pagó|Solo |Elegí|El monto|El concepto|Son demasiadas|Esa persona)/;

  const nodos = (xs) => xs.flat(Infinity).filter((c) => c != null && c !== false && c !== '');
  function h(tag, props, ...hijos) {
    const el = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'on') Object.entries(v).forEach(([ev, fn]) => el.addEventListener(ev, fn));
      else if (k in el && k !== 'list') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    el.append(...nodos(hijos));
    return el;
  }

  // La parte que eligió la persona en cada actividad: al volver del formulario de edición (que cierra la sección) o de
  // la lista, sigue en la misma. Solo ids, en memoria; se olvida al recargar.
  const recordada = new Map();

  function abrir(cont, ctx0) {
    const sb = g.App.sb;
    let ctx = ctx0;
    const act = ctx.actividad.id;
    let gastos = [], partes = [], pagos = [];
    let estado = 'cargando';      // 'cargando' | 'error' | 'ok'
    let cerrado = false;
    let enVuelo = null;           // la recarga en curso (una sola a la vez)
    let otraVez = false;          // la pidieron de nuevo con una en vuelo: al terminar se corre una más
    let tRef = null;
    let parte = recordada.get(act) || 'actividad';
    let elegida = recordada.has(act); // la persona eligió la parte: ya no se cambia sola
    let formAbierto = false;
    let confirmando = null;       // { clave, texto, si, accion } esperando el "Sí"
    let ocupado = false;          // una escritura en vuelo
    let tocado = false;           // la persona cambió los checkboxes del reparto
    let focoTras = null;          // selector a enfocar después del próximo repintado

    const yo = () => ctx.yo;
    const nombre = (id) => (ctx.perfilDe(id) || { nombre: 'Compañero' }).nombre;
    const anotadosParte = () => (ctx.anotados && ctx.anotados[parte]) || [];

    // ---------- Estructura (el formulario no se rehace: no se pierde lo que se está escribiendo) ----------
    const titulo = h('h2', { class: 'sub', id: 'cu-titulo' }, '💸 Cuentas claras');
    const selector = h('div', { class: 'chips cu-partes', role: 'group', 'aria-label': 'Cuentas de' });
    const arriba = h('div', { class: 'cu-arriba' });
    const zonaForm = h('div', { class: 'cu-zona-form' });
    const abajo = h('div', { class: 'cu-abajo' });
    cont.classList.add('cuentas');
    cont.setAttribute('aria-labelledby', 'cu-titulo');
    cont.append(titulo, selector, arriba, zonaForm, abajo);

    const selPagador = h('select', { id: 'cu-pagador' });
    const inMonto = h('input', { id: 'cu-monto', type: 'text', inputMode: 'numeric', autocomplete: 'off', placeholder: 'Ej.: 3.200', maxLength: 14 });
    const inConcepto = h('input', { id: 'cu-concepto', type: 'text', maxLength: L.MAX_CONCEPTO, autocomplete: 'off', placeholder: 'Ej.: cancha, carne, bebidas' });
    const listaEntre = h('div', { class: 'cu-entre-lista' });
    const reparto = h('p', { id: 'cu-reparto', class: 'ayuda', 'aria-live': 'polite' });
    const err = h('p', { id: 'cu-error', class: 'error', role: 'alert', hidden: true });
    const btnGuardar = h('button', { type: 'submit', id: 'cu-guardar', class: 'btn-primario' }, 'Cargar gasto');
    const campo = (id, etiqueta, ctrl) => h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), ctrl);
    const form = h('form', { id: 'cu-form', class: 'cu-form', noValidate: true },
      campo('cu-pagador', 'Quién pagó', selPagador),
      campo('cu-monto', 'Monto (pesos, sin centavos)', h('div', { class: 'cu-monto' }, h('span', { 'aria-hidden': 'true' }, '$'), inMonto)),
      campo('cu-concepto', 'Qué fue', inConcepto),
      h('fieldset', { id: 'cu-entre', class: 'cu-entre' }, h('legend', null, 'Entre quiénes se divide'), listaEntre),
      reparto, err,
      h('div', { class: 'fila-botones' }, btnGuardar,
        h('button', { type: 'button', id: 'cu-cerrar', class: 'btn-sec', on: { click: () => cerrarForm(true) } }, 'Cancelar')));
    const btnNuevo = h('button', { type: 'button', id: 'cu-nuevo', class: 'btn-sec btn-ancho', 'aria-expanded': 'false', 'aria-controls': 'cu-form', on: { click: abrirForm } }, '+ Cargar un gasto');
    form.addEventListener('submit', (ev) => { ev.preventDefault(); guardarGasto(); });
    inMonto.addEventListener('input', verReparto);
    listaEntre.addEventListener('change', () => { tocado = true; verReparto(); });

    cont.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (confirmando) { e.preventDefault(); const c = confirmando; confirmando = null; focoTras = c.volver; pintar(); }
      else if (formAbierto && form.contains(e.target)) { e.preventDefault(); cerrarForm(true); }
    });

    // ---------- Datos ----------
    async function cargar() {
      const [gs, ps] = await Promise.all([
        sb.from('gastos').select(CAMPOS_G).eq('actividad', act).order('creado', { ascending: false }),
        sb.from('pagos').select(CAMPOS_P).eq('actividad', act).order('creado', { ascending: false }),
      ]);
      if (gs.error || ps.error) throw (gs.error || ps.error);
      let pts = [];
      if (gs.data.length) {
        const r = await sb.from('gasto_partes').select('gasto,persona').in('gasto', gs.data.map((x) => x.id));
        if (r.error) throw r.error;
        pts = r.data;
      }
      if (cerrado) return;
      gastos = gs.data; pagos = ps.data; partes = pts;
      estado = 'ok';
    }
    // Igual que en actividades: si la piden con otra en vuelo, al terminar se corre una sola más (otraVez).
    function refrescar() {
      if (cerrado) return Promise.resolve();
      if (enVuelo) { otraVez = true; return enVuelo; }
      enVuelo = (async () => {
        try {
          do {
            otraVez = false;
            try { await cargar(); } catch (e) { if (!cerrado && estado !== 'ok') estado = 'error'; }
          } while (otraVez && !cerrado);
        } finally {
          enVuelo = null; otraVez = false;
          if (!cerrado) pintar();
        }
      })();
      return enVuelo;
    }
    function programar() { if (cerrado) return; clearTimeout(tRef); tRef = setTimeout(refrescar, 120); }
    // Altas: filtro de servidor por actividad. Bajas: Realtime no filtra los DELETE (y solo manda la clave),
    // así que se escuchan todas y se recarga solo si el gasto o pago borrado es de esta actividad.
    const alAlta = (p) => { if (p && p.new && p.new.actividad === act) programar(); };
    const alBaja = (lista) => (p) => { const id = p && p.old && p.old.id; if (id && lista().some((x) => x.id === id)) programar(); };
    // topic único por suscripción: channel() reutiliza un canal con el mismo topic mientras el anterior se está yendo
    const canal = sb.channel('cuentas-' + act + '-' + crypto.randomUUID())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'gastos', filter: 'actividad=eq.' + act }, alAlta)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pagos', filter: 'actividad=eq.' + act }, alAlta)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'gastos' }, alBaja(() => gastos))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'pagos' }, alBaja(() => pagos));
    // al (re)conectar se pone al día: lo que cambió con el socket caído no llegó en vivo
    canal.subscribe((st) => { if (st === 'SUBSCRIBED' && !cerrado) refrescar(); });

    // ---------- Acciones ----------
    async function escribir(fn, okMsg, errMsg) {
      if (ocupado) return false;
      ocupado = true;
      let ok = false;
      try {
        const { error } = await fn();
        if (error) throw error;
        ok = true;
        if (!cerrado && okMsg) g.App.toast(okMsg);
      } catch (e) {
        if (!cerrado) g.App.toast(e && e.message && MOTIVO.test(e.message) ? e.message : errMsg);
      } finally { ocupado = false; }
      await refrescar();
      return ok;
    }
    function pedirConfirmacion(c) { confirmando = c; focoTras = '#cu-confirmar-no'; pintar(); }
    function confirmar() {
      const c = confirmando;
      if (!c) return;
      confirmando = null;
      focoTras = c.volverOk || null;
      c.accion();
      pintar();
    }

    function abrirForm() {
      formAbierto = true; err.hidden = true;
      if (!tocado) marcarTodos();
      focoTras = '#cu-monto';
      pintar();
    }
    function cerrarForm(volver) {
      formAbierto = false; err.hidden = true;
      if (volver) focoTras = '#cu-nuevo';
      pintar();
    }
    function marcarTodos() { listaEntre.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = true; }); }
    const elegidos = () => [...listaEntre.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);

    function verReparto() {
      const monto = L.leerMonto(inMonto.value);
      const ps = elegidos();
      if (!monto || !ps.length) { reparto.textContent = ''; return; }
      const r = [...L.repartir(monto, ps).values()];
      const min = Math.min(...r), max = Math.max(...r);
      reparto.textContent = ps.length === 1 ? 'Lo paga una sola persona.'
        : min === max ? 'Le toca ' + L.pesos(min) + ' a cada uno.'
          : 'Le toca ' + L.pesos(min) + ' a cada uno (a algunos ' + L.pesos(max) + ', para que no sobre ni falte un peso).';
    }

    async function guardarGasto() {
      if (ocupado) return;
      const datos = { monto: L.leerMonto(inMonto.value), concepto: inConcepto.value.trim(), pagador: selPagador.value, personas: elegidos() };
      const msg = L.validarGasto(datos);
      err.textContent = msg || ''; err.hidden = !msg;
      if (msg) return;
      ocupado = true; btnGuardar.disabled = true;
      let res;
      try {
        res = await sb.rpc('cargar_gasto', { p_actividad: act, p_parte: parte, p_pagador: datos.pagador, p_monto: datos.monto, p_concepto: datos.concepto, p_personas: datos.personas });
      } catch (e) { res = { error: e }; }
      ocupado = false; btnGuardar.disabled = false;
      if (cerrado) return;
      if (res.error) {
        const m = res.error.message || '';
        err.textContent = MOTIVO.test(m) ? m : 'No pudimos cargar el gasto. Probá de nuevo en un momento.';
        err.hidden = false;
        return;
      }
      g.App.toast('Gasto cargado');
      inMonto.value = ''; inConcepto.value = ''; tocado = false; marcarTodos(); reparto.textContent = '';
      formAbierto = false; focoTras = '#cu-nuevo';
      await refrescar();
    }

    // ---------- Pintar ----------
    // Rehace el selector de quién pagó y los checkboxes solo si cambió la lista de anotados (conserva lo elegido).
    let idsForm = '';
    function sincronizarForm() {
      const ids = anotadosParte();
      const clave = parte + ':' + ids.join(',');
      if (clave === idsForm) return;
      const cambioParte = !idsForm.startsWith(parte + ':');
      idsForm = clave;
      const antesPag = selPagador.value;
      const antes = new Map([...listaEntre.querySelectorAll('input[type=checkbox]')].map((c) => [c.value, c.checked]));
      selPagador.textContent = '';
      ids.forEach((id) => selPagador.append(h('option', { value: id }, id === yo() ? nombre(id) + ' (vos)' : nombre(id))));
      selPagador.value = !cambioParte && ids.includes(antesPag) ? antesPag : (ids.includes(yo()) ? yo() : ids[0] || '');
      listaEntre.textContent = '';
      ids.forEach((id) => {
        const chk = h('input', { type: 'checkbox', name: 'cu-persona', value: id, id: 'cu-p-' + id });
        chk.checked = cambioParte || !tocado ? true : (antes.has(id) ? antes.get(id) : false);
        listaEntre.append(h('label', { class: 'check', for: 'cu-p-' + id }, chk, ' ' + (id === yo() ? nombre(id) + ' (vos)' : nombre(id))));
      });
      if (cambioParte) tocado = false;
      verReparto();
    }

    function botonConfirmar(c) {
      return h('div', { class: 'aviso-confirmar cu-confirmar' + (c.peligro ? '' : ' neutro') },
        h('p', { id: 'cu-confirmar-txt' }, c.texto),
        h('div', { class: 'fila-botones' },
          h('button', { type: 'button', id: 'cu-confirmar-si', class: c.peligro ? 'btn-peligro' : 'btn-primario', on: { click: confirmar } }, c.si),
          h('button', { type: 'button', id: 'cu-confirmar-no', class: 'btn-sec', 'aria-describedby': 'cu-confirmar-txt', on: { click: () => { const v = confirmando && confirmando.volver; confirmando = null; focoTras = v; pintar(); } } }, 'No')));
    }

    function pintar() {
      if (cerrado) return;
      activo = cont.contains(document.activeElement) ? document.activeElement : null;
      const a = ctx.actividad;
      const cancelada = a.estado === 'cancelada';
      if (!a.tiene_tercer && parte === 'tercer') { parte = 'actividad'; confirmando = null; }
      const hayDatos = gastos.length > 0 || pagos.length > 0;
      // Elegir sola la parte mientras la persona no elija: la que tiene cuentas mías; si no, donde estoy anotado.
      if (!elegida && a.tiene_tercer && estado === 'ok') {
        const mia = (p) => { const d = L.deParte(p, gastos, partes, pagos); return L.saldos(d.gastos, d.partes, d.pagos).has(yo()); };
        const antes = parte;
        if (mia('actividad')) parte = 'actividad';
        else if (mia('tercer')) parte = 'tercer';
        else parte = !ctx.anotados.actividad.includes(yo()) && ctx.anotados.tercer.includes(yo()) ? 'tercer' : 'actividad';
        if (parte !== antes) { formAbierto = false; confirmando = null; }
      }
      cont.hidden = !(ctx.anotado || hayDatos);

      // selector de parte
      selector.textContent = '';
      selector.hidden = !a.tiene_tercer;
      if (a.tiene_tercer) {
        const chip = (p, texto) => h('button', { type: 'button', id: 'cu-parte-' + p, class: 'chip' + (parte === p ? ' activo' : ''), 'aria-pressed': parte === p ? 'true' : 'false',
          on: { click: () => { if (parte === p) return; parte = p; elegida = true; recordada.set(act, p); confirmando = null; formAbierto = false; err.hidden = true; focoTras = '#cu-parte-' + p; pintar(); } } }, texto);
        selector.append(chip('actividad', 'La actividad'), chip('tercer', '🍻 Tercer tiempo'));
      }

      arriba.textContent = ''; abajo.textContent = '';
      if (estado !== 'ok') zonaForm.textContent = '';
      if (estado === 'cargando') { arriba.append(h('p', { class: 'vacio' }, 'Cargando las cuentas…')); return enfocar(); }
      if (estado === 'error') {
        arriba.append(h('div', { class: 'vacio', role: 'alert' }, h('p', null, 'No pudimos cargar las cuentas.'),
          h('button', { type: 'button', id: 'cu-reintentar', class: 'btn-sec btn-chico', on: { click: () => { estado = 'cargando'; pintar(); refrescar(); } } }, 'Reintentar')));
        return enfocar();
      }

      const d = L.deParte(parte, gastos, partes, pagos);
      const saldos = L.saldos(d.gastos, d.partes, d.pagos);
      const trans = L.transferencias(saldos);

      // resumen
      if (!d.gastos.length && !d.pagos.length) {
        arriba.append(h('p', { id: 'cu-resumen', class: 'vacio' }, parte === 'tercer' ? 'Todavía no hay gastos del tercer tiempo.' : 'Todavía no hay gastos cargados.'));
      } else {
        const r = L.resumen(saldos, yo());
        arriba.append(h('p', { id: 'cu-resumen', class: 'cu-resumen ' + r.tipo }, r.texto));
      }

      // transferencias
      if (trans.length) {
        arriba.append(h('h3', { class: 'cu-h3' }, 'Para quedar a mano'), h('ul', { class: 'cu-lista', id: 'cu-transferencias' }, trans.map((t) => {
          const clave = 't:' + t.de + ':' + t.a;
          const txt = t.de === yo() ? 'Le debés ' + L.pesos(t.monto) + ' a ' + nombre(t.a)
            : t.a === yo() ? nombre(t.de) + ' te debe ' + L.pesos(t.monto)
              : nombre(t.de) + ' le debe ' + L.pesos(t.monto) + ' a ' + nombre(t.a);
          const registrar = () => escribir(() => sb.from('pagos').insert({ actividad: act, parte, de: t.de, a: t.a, monto: t.monto }), 'Pago registrado', 'No pudimos registrar el pago. Probá de nuevo en un momento.');
          let accion = null;
          if (t.de === yo() || t.a === yo()) {
            const soyDeudor = t.de === yo();
            const etiqueta = soyDeudor ? 'Ya pagué' : 'Me pagó';
            if (confirmando && confirmando.clave === clave) accion = botonConfirmar(confirmando);
            else accion = h('button', { type: 'button', class: 'btn-sec btn-chico cu-pagar', 'data-clave': clave, disabled: ocupado,
              on: { click: () => pedirConfirmacion({ clave, volver: '[data-clave="' + clave + '"]', volverOk: '#cu-resumen',
                texto: soyDeudor ? '¿Ya le pagaste ' + L.pesos(t.monto) + ' a ' + nombre(t.a) + '?' : '¿' + nombre(t.de) + ' te pagó ' + L.pesos(t.monto) + '?',
                si: soyDeudor ? 'Sí, ya le pagué' : 'Sí, me pagó', accion: registrar }) } }, etiqueta);
          }
          return h('li', { class: 'cu-trans', 'data-de': t.de, 'data-a': t.a }, h('span', { class: 'cu-txt' }, txt), accion);
        })));
      } else if (d.gastos.length) {
        arriba.append(h('p', { class: 'ayuda', id: 'cu-a-mano' }, 'Están todos a mano. 🙌'));
      }

      // cargar un gasto
      const enParte = anotadosParte();
      // el formulario (o el botón) no se saca y se vuelve a poner si ya está: no pierde el foco ni el cursor
      const poner = (el) => { if (zonaForm.childNodes.length !== 1 || zonaForm.firstChild !== el) zonaForm.replaceChildren(el); };
      if (cancelada) {
        poner(h('p', { id: 'cu-cancelada', class: 'ayuda' }, 'La actividad está cancelada: no se cargan gastos nuevos. Los pagos se pueden seguir marcando.'));
        formAbierto = false;
      } else if (!ctx.anotado) {
        poner(h('p', { id: 'cu-no-anotado', class: 'ayuda' }, 'Ya no estás anotado: podés ver tus cuentas y marcar pagos, pero no cargar gastos nuevos.'));
        formAbierto = false;
      } else if (!enParte.length) {
        poner(h('p', { class: 'ayuda' }, 'Todavía no hay nadie anotado a ' + (parte === 'tercer' ? 'el tercer tiempo' : 'la actividad') + ': cuando se anoten, se pueden cargar gastos.'));
        formAbierto = false;
      } else {
        sincronizarForm();
        btnNuevo.setAttribute('aria-expanded', formAbierto ? 'true' : 'false');
        poner(formAbierto ? form : btnNuevo);
      }

      // gastos
      if (d.gastos.length) {
        const cuantos = new Map();
        d.partes.forEach((p) => cuantos.set(p.gasto, (cuantos.get(p.gasto) || 0) + 1));
        abajo.append(h('h3', { class: 'cu-h3' }, 'Gastos'), h('ul', { class: 'cu-lista', id: 'cu-gastos' }, d.gastos.map((x) => {
          const clave = 'g:' + x.id;
          const n = cuantos.get(x.id) || 0;
          const quien = x.pagador === yo() ? 'Pagaste vos' : 'Pagó ' + nombre(x.pagador);
          let accion = null;
          if (x.cargado_por === yo()) {
            if (confirmando && confirmando.clave === clave) accion = botonConfirmar(confirmando);
            else accion = h('button', { type: 'button', class: 'btn-link cu-borrar', 'data-clave': clave, 'aria-label': 'Borrar el gasto ' + x.concepto, disabled: ocupado,
              on: { click: () => pedirConfirmacion({ clave, volver: '[data-clave="' + clave + '"]', volverOk: '#cu-resumen', peligro: true,
                texto: '¿Borramos el gasto "' + x.concepto + '" de ' + L.pesos(x.monto) + '? Las cuentas se recalculan.', si: 'Sí, borrarlo',
                accion: () => escribir(() => sb.from('gastos').delete().eq('id', x.id), 'Gasto borrado', 'No pudimos borrar el gasto. Probá de nuevo en un momento.') }) } }, 'Borrar');
          }
          return h('li', { class: 'cu-gasto', 'data-id': x.id },
            h('span', { class: 'cu-txt' }, h('strong', null, x.concepto + ' · ' + L.pesos(x.monto)),
              h('span', { class: 'cu-meta' }, quien + ' · entre ' + n + (n === 1 ? ' persona' : ' personas'))),
            accion);
        })));
      }

      // pagos
      if (d.pagos.length) {
        abajo.append(h('h3', { class: 'cu-h3' }, 'Pagos registrados'), h('ul', { class: 'cu-lista', id: 'cu-pagos' }, d.pagos.map((p) => {
          const clave = 'p:' + p.id;
          const txt = p.de === yo() ? 'Le pagaste ' + L.pesos(p.monto) + ' a ' + nombre(p.a)
            : p.a === yo() ? nombre(p.de) + ' te pagó ' + L.pesos(p.monto)
              : nombre(p.de) + ' le pagó ' + L.pesos(p.monto) + ' a ' + nombre(p.a);
          let accion = null;
          if (p.cargado_por === yo()) {
            if (confirmando && confirmando.clave === clave) accion = botonConfirmar(confirmando);
            else accion = h('button', { type: 'button', class: 'btn-link cu-borrar-pago', 'data-clave': clave, 'aria-label': 'Borrar el pago: ' + txt, disabled: ocupado,
              on: { click: () => pedirConfirmacion({ clave, volver: '[data-clave="' + clave + '"]', volverOk: '#cu-resumen', peligro: true,
                texto: '¿Borramos este pago? La deuda vuelve a aparecer.', si: 'Sí, borrarlo',
                accion: () => escribir(() => sb.from('pagos').delete().eq('id', p.id), 'Pago borrado', 'No pudimos borrar el pago. Probá de nuevo en un momento.') }) } }, 'Borrar');
          }
          return h('li', { class: 'cu-pago', 'data-id': p.id }, h('span', { class: 'cu-txt' }, txt), accion);
        })));
      }
      if (confirmando && !cont.querySelector('#cu-confirmar-si')) confirmando = null; // lo que se confirmaba ya no está
      enfocar();
    }
    let activo = null;
    function enfocar() {
      if (!focoTras) {
        // un repintado en vivo no le saca el foco a quien está usando la sección con el teclado
        if (activo && activo.isConnected && document.activeElement !== activo) activo.focus({ preventScroll: true });
        return;
      }
      const sel = focoTras; focoTras = null;
      if (!cont.isConnected || cont.hidden) return;
      const el = cont.querySelector(sel);
      if (el) { if (sel === '#cu-resumen') el.tabIndex = -1; el.focus({ preventScroll: false }); }
    }

    pintar();
    return {
      actualizar(nuevo) { if (cerrado) return; ctx = nuevo; pintar(); },
      cerrar() {
        if (cerrado) return;
        cerrado = true; clearTimeout(tRef);
        sb.removeChannel(canal);
      },
    };
  }

  g.Cuentas = { abrir };
})(window);
