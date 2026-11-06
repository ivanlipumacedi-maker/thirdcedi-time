// Lógica pura del álbum (sin DOM), copiada de Rumbo al Sur y adaptada a actividades. En el navegador queda en window.AlbumLogica.
(function (g) {
  const LIMITE_BYTES = 1024 * 1024 * 1024; // plan gratis de Supabase: 1 GB de Storage por proyecto
  const MAX_LADO = 4096;
  const ZONA = 'America/Argentina/Buenos_Aires';

  // bucket 'album': <actividad>/<id>.jpg (original), .t.webp (miniatura) y .m.jpg (1600 px, queda siempre en la app)
  const rutaFoto = (actividad, id) => `${actividad}/${id}.jpg`;
  const rutaMini = (ruta) => ruta.replace(/\.jpg$/, '.t.webp');
  const rutaMedia = (ruta) => ruta.replace(/\.jpg$/, '.m.jpg');
  /** qué mostrar en grande: la original si sigue en la app; si se liberó (está en Drive), la media; si no hay, la miniatura */
  const verFoto = (f) => (!f.liberada ? f.ruta : f.media || f.mini);

  function escala(w, h, max = MAX_LADO) {
    const f = Math.min(1, max / Math.max(w, h));
    return { ancho: Math.round(w * f), alto: Math.round(h * f) };
  }

  const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' });
  const fmtTitulo = new Intl.DateTimeFormat('es-AR', { timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long' });
  const fmtHora = new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const porTomada = (a, b) => Date.parse(b.tomada) - Date.parse(a.tomada);

  function porDia(fotos) {
    const grupos = new Map();
    for (const f of [...fotos].sort(porTomada)) {
      const d = new Date(f.tomada), dia = fmtDia.format(d);
      if (!grupos.has(dia)) grupos.set(dia, { dia, titulo: fmtTitulo.format(d).replace(',', ''), fotos: [] });
      grupos.get(dia).fotos.push(f);
    }
    return [...grupos.values()];
  }

  function espacio(uso, limite = LIMITE_BYTES) {
    const r = uso / limite;
    return { pct: Math.min(100, Math.round(r * 100)), estado: r >= 1 ? 'lleno' : r >= 0.9 ? 'aviso' : 'ok' };
  }

  const fusionar = (lista, f) => [...lista.filter((x) => x.id !== f.id), f].sort(porTomada);
  const quitar = (lista, id) => lista.filter((x) => x.id !== id);
  const espera = (intento) => Math.min(60000, 2000 * 2 ** intento);

  // Drive: una subcarpeta por actividad ("<fecha> <título>") dentro de "ThirdCEDI Time".
  // La Edge Function avisos tiene una copia de estas dos (Deno no carga este archivo): si cambian, cambiar las dos.
  const limpio = (s) => String(s || '').replace(/[\\/]/g, '-').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  const carpetaDrive = (a) => `${fmtDia.format(new Date(a.fecha))} ${limpio(a.titulo)}`;
  const nombreDrive = (f, autor) => {
    const d = new Date(f.tomada);
    return `${fmtDia.format(d)} ${fmtHora.format(d).replace(':', '.')} ${limpio(autor)}${f.editada_de ? ' editada' : ''} (${String(f.id).slice(0, 8)}).jpg`;
  };

  // La cola es del teléfono: si entra otra persona, lo que sacó la anterior no se sube con la sesión nueva.
  const soloMias = (items, yo) => (yo ? items.filter((x) => x.autor === yo) : []);
  const pendientesDe = (items, actividad, yo) => soloMias(items, yo).filter((x) => x.actividad === actividad).length;

  function zoomPasos(min, max) {
    if (!(max > min)) return [];
    const p = [1, 2, 5, 10].filter((v) => v >= min && v <= max);
    if (min < 1) p.unshift(Math.round(min * 10) / 10);
    if (max > p[p.length - 1]) p.push(Math.round(max * 10) / 10);
    return p;
  }

  // Traseras: la que abre por defecto es la principal. Si hay exactamente una más, es la gran angular
  // (así lo expone Chrome en Samsung). Con más de una extra no se puede saber cuál es: no se adivina.
  function lentesTraseras(dispositivos, actualId) {
    const traseras = dispositivos.filter((d) => /back|rear|trasera|environment/i.test(d.label || ''));
    const hayFrontal = dispositivos.some((d) => /front|user|frontal/i.test(d.label || ''));
    const otras = traseras.filter((d) => d.deviceId !== actualId);
    const gran = traseras.some((d) => d.deviceId === actualId) && otras.length === 1 ? otras[0].deviceId : null;
    return { principal: actualId, gran, hayFrontal };
  }

  const A = { LIMITE_BYTES, MAX_LADO, rutaFoto, rutaMini, rutaMedia, verFoto, escala, porDia, espacio, fusionar, quitar, espera,
    carpetaDrive, nombreDrive, soloMias, pendientesDe, zoomPasos, lentesTraseras };
  if (typeof module !== 'undefined' && module.exports) module.exports = A; else g.AlbumLogica = A;
})(typeof window !== 'undefined' ? window : globalThis);
