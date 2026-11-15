// Ranking general (Juegos → Ranking): del año en curso o histórico, con el desglose de cada uno (desplegable) y cómo se
// suman los puntos, con énfasis en que lo que más suma es ir a las actividades. Los puntos los calcula la base
// (ranking() de dev/supabase/35-ranking.sql); RankingLogica tiene los mismos números para explicarlos.
// Ranking.abrir(contenedor) → { cerrar() }.
(function (g) {
  const R = g.RankingLogica;
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
  const anioActual = () => Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric' }).format(new Date()));

  let elegido = 'anio'; // 'anio' | 'historico' (se recuerda mientras la app está abierta)

  function abrir(cont) {
    const sb = g.App.sb;
    const yo = () => (g.App.yo() ? g.App.yo().id : null);
    let cerrado = false, version = 0;
    const datos = new Map(); // 'anio' | 'historico' → { estado: 'cargando'|'error'|'ok', filas }
    const perfiles = new Map();
    const abiertos = new Set(); // filas desplegadas
    const perfilDe = (id) => perfiles.get(id) || { id, nombre: 'Compañero', foto: null };

    cont.classList.add('ranking-general');
    const lista = h('div', { id: 'rk-lista', 'aria-live': 'polite' });
    const tabs = h('div', { class: 'segmentos', role: 'group', 'aria-label': 'Período del ranking' });
    const reglas = h('section', { class: 'rk-reglas', id: 'rk-reglas', 'aria-labelledby': 'rk-reglas-tit' },
      h('h2', { class: 'sub', id: 'rk-reglas-tit' }, 'Cómo se suman los puntos'),
      h('p', { class: 'rk-destacado' }, h('strong', null, 'Lo que más suma es ir a las actividades: '),
        R.numero(R.PUNTOS.asistencia) + ' puntos cada vez, más que cualquier partida.'),
      h('ul', { class: 'rk-reglas-lista' }, R.REGLAS.map((r) => h('li', { class: r.destacada ? 'destacada' : null },
        h('span', { class: 'rk-regla-pts' }, '+' + R.numero(r.puntos)),
        h('span', { class: 'rk-regla-txt' }, h('b', null, r.titulo), h('small', null, r.detalle))))),
      h('p', { class: 'ayuda' }, 'Cuenta una actividad por día y hasta ' + R.TOPE_PARTIDAS_DIA + ' partidas por día. La Trivia jugada solo no suma. El ranking del año arranca de cero cada 1 de enero.'));
    cont.replaceChildren(h('h1', null, 'Ranking'), tabs, lista, reglas);

    async function cargar(cual) {
      const v = ++version;
      datos.set(cual, { estado: 'cargando', filas: (datos.get(cual) || {}).filas || null });
      pintar();
      try {
        const { data, error } = await sb.rpc('ranking', { p_anio: cual === 'anio' ? anioActual() : null });
        if (error) throw error;
        const filas = data || [];
        const faltan = [...new Set(filas.map((f) => f.persona))].filter((id) => !perfiles.has(id));
        if (faltan.length) {
          const r = await sb.from('perfiles').select('id,nombre,foto').in('id', faltan);
          if (!r.error) (r.data || []).forEach((p) => perfiles.set(p.id, p));
        }
        if (cerrado) return;
        datos.set(cual, { estado: 'ok', filas: R.puestos(filas) });
      } catch (e) {
        if (cerrado) return;
        datos.set(cual, { estado: 'error', filas: null });
      }
      if (v === version || cual === elegido) pintar();
    }

    function fila(f) {
      const p = perfilDe(f.persona), mia = f.persona === yo(), abierto = abiertos.has(f.persona);
      const det = h('details', { class: 'rk-fila' + (mia ? ' yo' : '') + (f.puesto <= 3 ? ' podio podio-' + f.puesto : ''), open: abierto || null, 'data-persona': f.persona,
        on: { toggle: (e) => { if (e.target.open) abiertos.add(f.persona); else abiertos.delete(f.persona); } } },
        h('summary', { class: 'fila-ranking' },
          h('span', { class: 'puesto podio-' + f.puesto }, f.puesto + '°'),
          g.Perfiles ? g.Perfiles.avatar(p, 32) : null,
          h('span', { class: 'rk-nombre' }, p.nombre + (mia ? ' (vos)' : '')),
          h('span', { class: 'rk-puntos' }, R.numero(f.total))),
        h('ul', { class: 'rk-desglose' }, R.desglose(f).map((d) => h('li', { class: d.clave === 'asistencia' ? 'destacada' : null },
          h('span', { class: 'rk-d-nombre' }, d.nombre, h('small', null, d.detalle)),
          h('span', { class: 'rk-d-pts' }, R.numero(d.puntos))))));
      return h('li', null, det);
    }

    function pintar() {
      if (cerrado) return;
      const anio = anioActual();
      tabs.replaceChildren(...[['anio', String(anio)], ['historico', 'Histórico']].map(([k, t]) =>
        h('button', { type: 'button', id: 'rk-' + k, class: 'chip seg' + (elegido === k ? ' activo' : ''), 'aria-pressed': elegido === k ? 'true' : 'false',
          on: { click: () => { if (elegido === k) return; elegido = k; if (!datos.has(k) || datos.get(k).estado === 'error') cargar(k); else pintar(); } } }, t)));
      const d = datos.get(elegido);
      if (!d || (d.estado === 'cargando' && !d.filas)) { lista.replaceChildren(h('p', { class: 'vacio' }, 'Cargando el ranking…')); return; }
      if (d.estado === 'error') {
        lista.replaceChildren(h('div', { class: 'vacio', role: 'alert' }, h('p', null, 'No pudimos cargar el ranking.'),
          h('button', { type: 'button', id: 'rk-reintentar', class: 'btn-sec btn-chico', on: { click: () => cargar(elegido) } }, 'Reintentar')));
        return;
      }
      if (!d.filas.length) {
        lista.replaceChildren(h('p', { class: 'vacio', id: 'rk-vacio' }, (elegido === 'anio' ? 'Todavía nadie tiene puntos en ' + anio + '.' : 'Todavía nadie tiene puntos.')
          + ' Andá a una actividad: cuando quien la armó confirme que fuiste, sumás ' + R.numero(R.PUNTOS.asistencia) + '.'));
        return;
      }
      const mia = d.filas.find((f) => f.persona === yo());
      lista.replaceChildren(
        h('p', { class: 'rk-mio', id: 'rk-mio' }, mia ? 'Estás ' + mia.puesto + '° con ' + R.numero(mia.total) + ' puntos. Tocá un nombre para ver de dónde salen.'
          : 'Todavía no sumaste puntos. Tocá un nombre para ver de dónde salen los de los demás.'),
        h('ol', { class: 'ranking rk-ranking', id: 'rk-ranking' }, d.filas.map(fila)));
    }

    cargar(elegido);
    return { cerrar() { cerrado = true; } };
  }

  g.Ranking = { abrir };
})(window);
