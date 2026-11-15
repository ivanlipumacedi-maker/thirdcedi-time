// Pictionary en curso (37): uno dibuja con el dedo y los demás adivinan escribiendo. El dibujo viaja por un canal de
// Broadcast de Realtime ('pic-<partida>'; no se guarda en la base): trazos con coordenadas de 0 a 1, para que se vean
// igual en cualquier pantalla. Quien entra tarde (o se reconecta) pide el dibujo y quien dibuja se lo manda entero.
// La palabra la ve solo quien dibuja (pictionary_mi_palabra); adivinar va por pictionary_adivinar; el tiempo lo mide
// el servidor (limite_ms) y cuando vence cualquiera le pide avanzar.
// Pictionary.montar(el, api) → { actualizar({ partida, jugadores }), cerrar() }. api: { yo(), perfil(id), desfase(),
// avanzar(ronda, fase), palabraPic(), adivinarPic(ronda, texto) }.
(function (g) {
  const COLORES = [['#111111', 'Negro'], ['#d62828', 'Rojo'], ['#1d6fd8', 'Azul'], ['#2a9d4b', 'Verde'], ['#f4a100', 'Amarillo']];
  const GROSOR = [['fino', 0.008, 'Fino'], ['grueso', 0.022, 'Grueso']];
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
  const r3 = (n) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;

  function montar(el, api) {
    let datos = null, cerrado = false;
    let palabra = null, palabraRonda = 0, pidiendo = false;
    let trazos = [], trazosRonda = 0;          // el dibujo de la ronda en curso
    let actual = null, pendiente = [];          // trazo que estoy dibujando y los puntos que faltan mandar
    let color = COLORES[0][0], grosor = GROSOR[0][1];
    let intento = '', mensaje = '', adivinando = false;
    let avanzando = '', tic = null, tEnvio = null;
    const sb = g.App.sb;
    const e = () => (datos && datos.partida.estado_juego) || {};
    const yo = () => api.yo();
    const ronda = () => Number(e().ronda) || 0;
    const dibujo = () => e().dibuja === yo();
    const nombre = (id) => api.perfil(id).nombre + (id === yo() ? ' (vos)' : '');
    const restante = () => Math.max(0, (Number(e().limite_ms) || 0) - (Date.now() + (api.desfase() || 0)));

    // ---------- Canal del dibujo ----------
    let canal = null;
    function abrirCanal(pid) {
      if (canal || !sb) return;
      canal = sb.channel('pic-' + pid, { config: { broadcast: { self: false } } })
        .on('broadcast', { event: 'pic' }, ({ payload }) => recibir(payload || {}))
        .subscribe((st) => { if (st === 'SUBSCRIBED' && !dibujo()) mandar({ t: 'pedir', r: ronda() }); });
    }
    function mandar(m) { if (canal) canal.send({ type: 'broadcast', event: 'pic', payload: m }); }
    function recibir(m) {
      if (cerrado || !datos) return;
      if (m.t === 'pedir') { if (dibujo() && m.r === ronda()) mandar({ t: 'todo', r: ronda(), trazos }); return; }
      if (m.r !== ronda() || dibujo()) return;
      prepararRonda();
      if (m.t === 'todo' && Array.isArray(m.trazos)) { trazos = m.trazos; redibujar(); return; }
      if (m.t === 'b') { trazos = []; redibujar(); return; }
      if (m.t === 's' && m.id && Array.isArray(m.p)) {
        let t = trazos.find((x) => x.id === m.id);
        if (!t) { t = { id: m.id, c: m.c, w: m.w, p: [] }; trazos.push(t); }
        const desde = t.p.length;
        t.p.push(...m.p);
        pintarTrazo(t, Math.max(0, desde - 2));
      }
    }
    function prepararRonda() { if (trazosRonda !== ronda()) { trazosRonda = ronda(); trazos = []; actual = null; pendiente = []; redibujar(); } }

    // ---------- Lienzo ----------
    const lienzo = h('canvas', { class: 'pic-lienzo', id: 'pic-lienzo', 'aria-label': 'Dibujo' });
    const ctx = lienzo.getContext('2d');
    function medir() {
      const w = lienzo.clientWidth || 300, dpr = window.devicePixelRatio || 1;
      if (lienzo.width !== Math.round(w * dpr)) { lienzo.width = Math.round(w * dpr); lienzo.height = Math.round(w * dpr); redibujar(); }
    }
    function pintarTrazo(t, desde = 0) {
      const W = lienzo.width;
      ctx.strokeStyle = t.c; ctx.fillStyle = t.c; ctx.lineWidth = Math.max(1, t.w * W); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const p = t.p;
      if (p.length === 2) { ctx.beginPath(); ctx.arc(p[0] * W, p[1] * W, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); return; }
      ctx.beginPath();
      ctx.moveTo(p[desde] * W, p[desde + 1] * W);
      for (let i = desde + 2; i < p.length; i += 2) ctx.lineTo(p[i] * W, p[i + 1] * W);
      ctx.stroke();
    }
    function redibujar() {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, lienzo.width, lienzo.height);
      trazos.forEach((t) => pintarTrazo(t));
    }
    const punto = (ev) => { const b = lienzo.getBoundingClientRect(); return [r3((ev.clientX - b.left) / b.width), r3((ev.clientY - b.top) / b.height)]; };
    function puedoDibujar() { return dibujo() && e().fase === 'dibujando' && datos.partida.estado === 'jugando'; }
    lienzo.addEventListener('pointerdown', (ev) => {
      if (!puedoDibujar()) return;
      ev.preventDefault(); lienzo.setPointerCapture(ev.pointerId);
      actual = { id: Math.random().toString(36).slice(2, 10), c: color, w: grosor, p: punto(ev) };
      trazos.push(actual); pendiente = actual.p.slice(); pintarTrazo(actual);
      programarEnvio();
    });
    lienzo.addEventListener('pointermove', (ev) => {
      if (!actual) return;
      const [x, y] = punto(ev), n = actual.p.length;
      if (Math.abs(actual.p[n - 2] - x) + Math.abs(actual.p[n - 1] - y) < 0.004) return;
      actual.p.push(x, y); pendiente.push(x, y);
      pintarTrazo(actual, n - 2);
      programarEnvio();
    });
    const soltar = () => { if (actual) { enviar(); actual = null; } };
    lienzo.addEventListener('pointerup', soltar);
    lienzo.addEventListener('pointercancel', soltar);
    function programarEnvio() { if (!tEnvio) tEnvio = setTimeout(enviar, 60); }
    function enviar() {
      clearTimeout(tEnvio); tEnvio = null;
      if (!actual || !pendiente.length) return;
      mandar({ t: 's', r: ronda(), id: actual.id, c: actual.c, w: actual.w, p: pendiente });
      // el próximo pedazo arranca en el último punto, para que la línea no se corte
      pendiente = actual.p.slice(-2);
      if (pendiente.length && pendiente.length === actual.p.length) pendiente = [];
    }
    function borrarTodo() { trazos = []; actual = null; pendiente = []; redibujar(); mandar({ t: 'b', r: ronda() }); }

    // ---------- Palabra, adivinar y tiempo ----------
    function pedirPalabra() {
      if (!dibujo() || e().fase !== 'dibujando' || pidiendo || palabraRonda === ronda()) return;
      pidiendo = true;
      Promise.resolve(api.palabraPic()).then((r) => {
        pidiendo = false;
        if (cerrado) return;
        if (r && !r.error && typeof r.data === 'string') { palabra = r.data; palabraRonda = ronda(); pintar(); }
        else setTimeout(pedirPalabra, 1500);
      }, () => { pidiendo = false; setTimeout(pedirPalabra, 1500); });
    }
    async function adivinar(ev) {
      ev.preventDefault();
      const t = intento.trim();
      if (!t || adivinando) return;
      adivinando = true; pintar();
      let r;
      try { r = await api.adivinarPic(ronda(), t); } catch (x) { r = { error: x }; }
      adivinando = false;
      if (cerrado) return;
      if (r && r.error) mensaje = (r.error.message && /^(Te toca|Escribí)/.test(r.error.message)) ? r.error.message : 'No se pudo mandar. Probá de nuevo.';
      else if (r && r.data === true) { mensaje = '¡Adivinaste!'; intento = ''; }
      else { mensaje = 'No es "' + t + '". Seguí probando.'; intento = ''; }
      pintar();
      const inp = el.querySelector('#pic-intento'); if (inp && r && r.data !== true) inp.focus();
    }
    function vigilar() {
      clearInterval(tic);
      tic = setInterval(() => {
        if (cerrado || !datos || datos.partida.estado !== 'jugando') return;
        const reloj = el.querySelector('#pic-reloj');
        if (reloj) reloj.textContent = Math.ceil(restante() / 1000) + ' s';
        const barra = el.querySelector('#pic-barra');
        if (barra) barra.style.width = Math.max(0, Math.min(100, restante() / (e().fase === 'revelada' ? 60 : 800))) + '%';
        const clave = ronda() + ':' + e().fase;
        if (restante() <= 0 && avanzando !== clave) {
          avanzando = clave;
          setTimeout(() => { if (!cerrado) Promise.resolve(api.avanzar(ronda(), e().fase)).catch(() => {}); }, 200 + Math.random() * 600);
          setTimeout(() => { if (avanzando === clave && ronda() + ':' + e().fase === clave) avanzando = ''; }, 4000);
        }
      }, 250);
    }

    // ---------- Pintar ----------
    function pintar() {
      if (cerrado || !datos) return;
      const est = e(), fase = est.fase, terminada = datos.partida.estado === 'terminada' || fase === 'final';
      const acertaron = Array.isArray(est.acertaron) ? est.acertaron : [];
      const activos = (datos.jugadores || []).filter((j) => j.partida === datos.partida.id && !j.se_fue);
      if (terminada) {
        const filas = activos.slice().sort((a, b) => (b.puntos || 0) - (a.puntos || 0));
        el.replaceChildren(h('div', { class: 'trivia-resultado bien', id: 'pic-final', role: 'status' }, h('strong', null, filas[0] ? '¡Ganó ' + nombre(filas[0].persona) + '!' : 'Terminó')),
          h('ol', { class: 'ranking final', id: 'pic-ranking' }, filas.map((j, i) => h('li', { class: 'fila-ranking' + (i === 0 ? ' primero' : '') + (j.persona === yo() ? ' yo' : '') },
            h('span', { class: 'puesto' }, (i + 1) + '°'), g.Perfiles ? g.Perfiles.avatar(api.perfil(j.persona), 28) : null,
            h('span', { class: 'rk-nombre' }, nombre(j.persona)), h('span', { class: 'rk-puntos' }, String(j.puntos || 0))))));
        return;
      }
      const yoDibujo = dibujo(), yaAcerte = acertaron.includes(yo());
      const cab = h('div', null,
        h('div', { class: 'trivia-cabecera' }, h('span', { class: 'trivia-ronda', id: 'pic-fase' }, 'Ronda ' + est.ronda + ' de ' + est.total), h('span', { class: 'reloj', id: 'pic-reloj' }, Math.ceil(restante() / 1000) + ' s')),
        h('div', { class: 'barra-tiempo' }, h('i', { id: 'pic-barra', class: 'barra-tiempo-relleno' })));
      let arriba;
      if (fase === 'revelada') arriba = h('p', { class: 'pic-palabra', id: 'pic-era' }, 'Era: ', h('strong', null, est.palabra || ''));
      else if (yoDibujo) arriba = h('p', { class: 'pic-palabra', id: 'pic-mia' }, 'Dibujá: ', h('strong', null, palabraRonda === ronda() && palabra ? palabra : '…'));
      else arriba = h('p', { class: 'pic-palabra', id: 'pic-pista' }, h('span', null, 'Dibuja ' + nombre(est.dibuja) + ': '),
        h('span', { class: 'pic-pista', 'aria-label': (est.letras || 0) + ' letras' }, est.pista || ''), h('small', null, ' (' + (est.letras || 0) + ' letras)'));
      const herramientas = yoDibujo && fase === 'dibujando' ? h('div', { class: 'pic-herr', role: 'toolbar', 'aria-label': 'Lápiz' },
        COLORES.map(([c, n]) => h('button', { type: 'button', class: 'pic-color' + (color === c ? ' activo' : ''), style: 'background:' + c, 'aria-label': n, 'aria-pressed': color === c ? 'true' : 'false', on: { click: () => { color = c; pintar(); } } })),
        h('div', { class: 'segmentos', role: 'group', 'aria-label': 'Grosor' }, GROSOR.map(([k, w, n]) => h('button', { type: 'button', class: 'chip seg' + (grosor === w ? ' activo' : ''), 'aria-pressed': grosor === w ? 'true' : 'false', on: { click: () => { grosor = w; pintar(); } } }, n))),
        h('button', { type: 'button', class: 'btn-link', id: 'pic-borrar', on: { click: borrarTodo } }, 'Borrar todo')) : null;
      const form = !yoDibujo && fase === 'dibujando' ? (yaAcerte ? h('p', { class: 'aj-estado bien', id: 'pic-acerte' }, '¡Adivinaste! Esperá a los demás.')
        : h('form', { class: 'pic-form', id: 'pic-form', on: { submit: adivinar } },
          h('input', { id: 'pic-intento', type: 'text', autocomplete: 'off', maxLength: 60, placeholder: '¿Qué es?', value: intento, 'aria-label': 'Tu respuesta', on: { input: (ev) => { intento = ev.target.value; } } }),
          h('button', { type: 'submit', class: 'btn-primario', disabled: adivinando }, 'Adivinar'))) : null;
      const quienes = h('p', { class: 'ayuda', id: 'pic-acertaron' }, acertaron.length
        ? 'Adivinaron: ' + acertaron.map((id) => api.perfil(id).nombre + ' (+' + ((est.puntos_ronda || {})[id] || '') + ')').join(', ')
        : (fase === 'dibujando' ? (yoDibujo ? 'Cuando alguien adivina, sumás 30.' : 'Cuanto antes adivines, más sumás.') : 'Nadie la adivinó.'));
      const foco = document.activeElement && document.activeElement.id === 'pic-intento';
      el.replaceChildren(...nodos([cab, arriba, herramientas, lienzo, form, mensaje && fase === 'dibujando' && !yaAcerte ? h('p', { class: 'ayuda', role: 'status' }, mensaje) : null, quienes]));
      if (foco) { const i = el.querySelector('#pic-intento'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
      lienzo.classList.toggle('dibujable', yoDibujo && fase === 'dibujando');
      requestAnimationFrame(medir);
    }

    window.addEventListener('resize', medir);
    return {
      actualizar(d) {
        if (cerrado) return;
        const antes = datos ? ronda() + ':' + e().fase : '';
        datos = d;
        abrirCanal(d.partida.id);
        prepararRonda();
        if (antes !== ronda() + ':' + e().fase) { mensaje = ''; if (!dibujo() && e().fase === 'dibujando' && canal) mandar({ t: 'pedir', r: ronda() }); }
        pedirPalabra();
        if (!tic) vigilar();
        pintar();
      },
      cerrar() {
        cerrado = true; clearInterval(tic); clearTimeout(tEnvio);
        window.removeEventListener('resize', medir);
        if (canal && sb) sb.removeChannel(canal);
      },
    };
  }

  g.Pictionary = { montar };
})(window);
