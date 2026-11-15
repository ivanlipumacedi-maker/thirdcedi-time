// Asistencia confirmada (35): después de la actividad, quien la armó marca quién fue de verdad. Cada asistencia suma
// RankingLogica.PUNTOS.asistencia en el ranking (y el tercer tiempo, PUNTOS.tercer). A los anotados se les muestra si
// ya está confirmada; antes de que empiece, se les recuerda cuánto suma ir.
// Asistencia.abrir(contenedor, ctx) → { actualizar(ctx), cerrar() }. ctx = { actividad, anotados: { actividad: [ids],
// tercer: [ids] }, perfilDe(id), yo, anotado }.
(function (g) {
  const R = g.RankingLogica;
  const DIAS_30 = 30 * 864e5;
  const MOTIVO = /^(La actividad|Solo |Todavía no|Pasaron|Son demasiadas)/;
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

  function abrir(cont, ctx0) {
    const sb = g.App.sb;
    let ctx = ctx0, cerrado = false, estado = 'cargando', guardando = false;
    let confirmadas = { actividad: new Set(), tercer: new Set() };
    const marcados = { actividad: null, tercer: null }; // lo que tildó el organizador (null: lo de la base)
    const act = ctx.actividad.id;
    cont.classList.add('asistencia');

    async function cargar() {
      try {
        const { data, error } = await sb.from('asistencias_confirmadas').select('persona,parte').eq('actividad', act);
        if (error) throw error;
        if (cerrado) return;
        confirmadas = { actividad: new Set(), tercer: new Set() };
        (data || []).forEach((x) => confirmadas[x.parte] && confirmadas[x.parte].add(x.persona));
        estado = 'ok';
      } catch (e) { if (!cerrado) estado = 'error'; }
      pintar();
    }

    const pts = (n) => R.numero(n);
    const inicio = (parte) => Date.parse(parte === 'tercer' ? ctx.actividad.tercer_fecha : ctx.actividad.fecha);

    async function guardar(parte) {
      if (guardando) return;
      const ids = [...(marcados[parte] || confirmadas[parte])];
      guardando = true; pintar();
      let r;
      try { r = await sb.rpc('confirmar_asistencia', { p_actividad: act, p_parte: parte, p_personas: ids }); } catch (e) { r = { error: e }; }
      guardando = false;
      if (cerrado) return;
      if (r.error) {
        const m = (r.error && r.error.message) || '';
        g.App.toast(MOTIVO.test(m) ? m : 'No pudimos guardar la asistencia. Probá de nuevo en un momento.');
      } else {
        marcados[parte] = null;
        g.App.toast(ids.length ? 'Listo: ' + (ids.length === 1 ? '1 asistencia confirmada' : ids.length + ' asistencias confirmadas') + ' en el ranking.' : 'Listo: no quedó nadie confirmado.');
        await cargar();
        return;
      }
      pintar();
    }

    function grupo(parte) {
      const a = ctx.actividad, ahora = Date.now();
      const anotados = (ctx.anotados && ctx.anotados[parte]) || [];
      const empezo = ahora >= inicio(parte), vencio = ahora > inicio(parte) + DIAS_30;
      const valor = parte === 'tercer' ? R.PUNTOS.tercer : R.PUNTOS.asistencia;
      const nombre = (id) => (ctx.perfilDe(id) || { nombre: 'Compañero' }).nombre + (id === ctx.yo ? ' (vos)' : '');
      const soyOrg = a.creador === ctx.yo;
      const tituloParte = parte === 'tercer' ? 'tercer tiempo' : 'actividad';
      if (!soyOrg) {
        if (!anotados.includes(ctx.yo)) return null;
        if (!empezo) return parte === 'actividad' ? h('p', { class: 'ayuda as-aviso', id: 'as-aviso' }, 'Si vas, sumás ' + pts(valor) + ' puntos en el ranking. Los confirma quien la armó.') : null;
        const ok = confirmadas[parte].has(ctx.yo);
        return h('p', { class: 'as-estado' + (ok ? ' ok' : ''), id: 'as-estado-' + parte }, ok
          ? (parte === 'tercer' ? 'Tu tercer tiempo está confirmado: +' : 'Tu asistencia está confirmada: +') + pts(valor) + ' en el ranking.'
          : 'Todavía no confirmó la asistencia ' + (parte === 'tercer' ? 'al tercer tiempo ' : '') + 'quien la armó.');
      }
      // organizador
      if (!empezo) {
        return parte === 'actividad' ? h('p', { class: 'ayuda as-aviso', id: 'as-aviso' }, 'Cuando empiece, vas a confirmar acá quién fue: cada uno suma ' + pts(valor) + ' puntos en el ranking.') : null;
      }
      if (!anotados.length && !confirmadas[parte].size) return null;
      // sin nada confirmado todavía, arranca con todos los anotados tildados
      const base = confirmadas[parte].size ? confirmadas[parte] : new Set(anotados);
      const sel = marcados[parte] || base;
      const lista = [...new Set([...anotados, ...confirmadas[parte]])];
      const cambio = marcados[parte] != null || !confirmadas[parte].size;
      return h('fieldset', { class: 'as-grupo', id: 'as-' + parte, disabled: vencio || guardando || null },
        h('legend', null, parte === 'tercer' ? '¿Quiénes fueron al tercer tiempo?' : '¿Quiénes fueron?'),
        h('p', { class: 'ayuda' }, vencio ? 'Pasaron más de 30 días: ya no se puede cambiar.'
          : 'Destildá a los que no fueron. Cada uno suma ' + pts(valor) + ' puntos en el ranking' + (parte === 'actividad' ? ' (y vos ' + pts(R.PUNTOS.organizar) + ' por armarla si fueron 3 o más).' : '.')),
        lista.map((id) => h('label', { class: 'check' },
          h('input', { type: 'checkbox', value: id, checked: sel.has(id), on: { change: (e) => {
            const s = new Set(marcados[parte] || base);
            if (e.target.checked) s.add(id); else s.delete(id);
            marcados[parte] = s; pintar();
          } } }), ' ' + nombre(id))),
        !vencio && h('button', { type: 'button', id: 'as-guardar-' + parte, class: cambio ? 'btn-primario btn-ancho' : 'btn-sec btn-ancho', on: { click: () => guardar(parte) } },
          guardando ? 'Guardando…' : confirmadas[parte].size ? (cambio ? 'Guardar cambios' : 'Asistencia confirmada') : 'Confirmar asistencia del ' + tituloParte),
        confirmadas[parte].size > 0 && !cambio && h('p', { class: 'as-estado ok' }, 'Confirmaste ' + confirmadas[parte].size + (confirmadas[parte].size === 1 ? ' persona.' : ' personas.')));
    }

    function pintar() {
      if (cerrado) return;
      const a = ctx.actividad;
      if (a.estado === 'cancelada' || !R) { cont.hidden = true; cont.replaceChildren(); return; }
      if (estado === 'cargando') { cont.hidden = true; return; }
      // sin la asistencia (sin señal, o la base todavía sin la 35) la sección no aparece: no es lo principal de la pantalla
      if (estado === 'error') { cont.hidden = true; cont.replaceChildren(); return; }
      const partes = [grupo('actividad'), a.tiene_tercer ? grupo('tercer') : null].filter(Boolean);
      cont.hidden = !partes.length;
      const org = a.creador === ctx.yo && Date.now() >= inicio('actividad');
      cont.replaceChildren(...(partes.length ? [org ? h('h2', { class: 'sub titulo-ico' }, g.App.icono('trofeo'), 'Asistencia') : null, ...partes] : []));
    }

    cargar();
    return {
      actualizar(nuevo) { if (cerrado) return; ctx = nuevo; pintar(); },
      cerrar() { cerrado = true; },
    };
  }

  g.Asistencia = { abrir };
})(window);
