// Lógica pura del chat de ThirdCEDI Time (sin DOM). En el navegador queda en window.ChatLogica.
// Alcance: texto, fotos, editar y eliminar lo propio.
(function (g) {
  const MAX_TEXTO = 2000;
  const TAM_PAGINA = 50; // mensajes por página (carga inicial, resincronización y "Ver mensajes anteriores")

  const textoValido = (s) => { const t = String(s ?? '').trim(); return t.length >= 1 && t.length <= MAX_TEXTO; };
  /** texto a guardar al editar (recortado) o null si no es válido o no cambió respecto del original */
  const textoEditado = (nuevo, original) => { const t = String(nuevo ?? '').trim(); return textoValido(t) && t !== String(original ?? '').trim() ? t : null; };

  function resumen(m) {
    if (m.tipo === 'eliminado') return 'Se eliminó este mensaje';
    if (m.tipo === 'foto') return 'Foto';
    const t = String(m.texto ?? '').trim();
    return t.length > 80 ? t.slice(0, 79) + '…' : t;
  }

  const EDITAR_MS = 15 * 60 * 1000;
  const puedeEditar = (m, yo, ahora = Date.now()) => m.autor === yo && m.tipo === 'texto' && !String(m.id).startsWith('tmp-') && ahora - Date.parse(m.creado) < EDITAR_MS;

  // Orden (creado, id), el mismo que usa la consulta (order creado, id). creado se compara en microsegundos
  // (Postgres guarda µs; Date.parse solo llega a ms) y el id como texto (igual que el uuid en Postgres).
  function micros(iso) {
    const s = Date.parse(iso);
    if (Number.isNaN(s)) return 0;
    const f = /T[^.]*\.(\d+)/.exec(String(iso));
    return Math.floor(s / 1000) * 1e6 + (f ? Number(f[1].slice(0, 6).padEnd(6, '0')) : 0);
  }
  const comparar = (a, b) => micros(a.creado) - micros(b.creado) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);

  // un eliminado no vuelve: una respuesta o un evento atrasado (edición) no lo pisa
  const fusionar = (lista, m) => { const prev = lista.find((x) => x.id === m.id); if (prev?.tipo === 'eliminado' && m.tipo !== 'eliminado') return lista; return [...lista.filter((x) => x.id !== m.id), m].sort(comparar); };
  /** mezcla un lote (recarga tras reconectar) sin duplicar ni resucitar eliminados */
  const fusionarLote = (lista, ms) => ms.reduce((acc, m) => fusionar(acc, m), lista);
  const quitar = (lista, id) => lista.filter((x) => x.id !== id);

  /** evento de Realtime: un INSERT entra; un UPDATE solo toca un mensaje que ya está en la lista
   *  (si no, quedaría arriba de todo y se tomaría como cursor de "Ver mensajes anteriores"). */
  function aplicarEvento(lista, evento, m) {
    if (evento === 'UPDATE' && !lista.some((x) => x.id === m.id)) return lista;
    return fusionar(lista, m);
  }

  const horaCorta = (iso) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Argentina/Buenos_Aires' });

  // recientes = la última página que devolvió el servidor (tam = tamaño de página).
  // Lo que el servidor ya no tiene en ese tramo (borrado mientras no escuchábamos) desaparece; se conserva:
  //  - lo más viejo que el corte (si la página vino llena),
  //  - lo más nuevo que el último de la página (llegó por Realtime o por el insert propio con la consulta en vuelo),
  //  - los ids de "llegados" (eventos aplicados mientras la sincronización estaba en vuelo): su versión gana.
  // Un eliminado que tenemos no resucita por una página atrasada.
  function reconciliar(lista, recientes, tam, llegados) {
    const vino = new Set(recientes.map((m) => m.id));
    const orden = [...recientes].sort(comparar);
    const viejo = recientes.length >= tam ? orden[0] : null;
    const nuevo = orden[orden.length - 1] || null;
    const previo = new Map(lista.map((m) => [m.id, m]));
    const tengo = (id) => llegados && llegados.has(id);
    const conservar = lista.filter((m) => !vino.has(m.id) && (
      (viejo && comparar(m, viejo) < 0) || (nuevo ? comparar(m, nuevo) > 0 : false) || tengo(m.id)));
    const servidor = orden.map((m) => { const p = previo.get(m.id); return p && (p.tipo === 'eliminado' || tengo(m.id)) ? p : m; });
    return [...conservar, ...servidor].sort(comparar);
  }

  /** cursor de "Ver mensajes anteriores": (creado, id) del más viejo cargado que no sea temporal */
  function cursor(lista) {
    const m = [...lista].filter((x) => !String(x.id).startsWith('tmp-')).sort(comparar)[0];
    return m ? { creado: m.creado, id: m.id } : null;
  }
  /** filtro de PostgREST (.or) para traer lo anterior al cursor en orden (creado, id) */
  const filtroAntes = (c) => `creado.lt."${c.creado}",and(creado.eq."${c.creado}",id.lt."${c.id}")`;

  function escalar(ancho, alto, max) {
    const f = Math.min(1, max / Math.max(ancho, alto));
    return { ancho: Math.round(ancho * f), alto: Math.round(alto * f) };
  }
  const CARPETAS = { foto: ['fotos', 'webp'] };
  const rutaArchivo = (sala, tipo, id) => `${sala}/${CARPETAS[tipo][0]}/${id}.${CARPETAS[tipo][1]}`;

  const L = { MAX_TEXTO, TAM_PAGINA, textoValido, textoEditado, resumen, puedeEditar, EDITAR_MS, comparar, fusionar, fusionarLote, quitar, aplicarEvento,
    horaCorta, reconciliar, cursor, filtroAntes, escalar, rutaArchivo };
  if (typeof module !== 'undefined' && module.exports) module.exports = L; else g.ChatLogica = L;
})(this);
