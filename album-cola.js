// Cola de subida del álbum (copiada de Rumbo al Sur y adaptada): cada foto se guarda primero en el teléfono (IndexedDB)
// y se sube cuando hay señal. El id de la foto se genera al sacarla y es el id de la fila: reintentar no duplica.
// Hay una sola cola para todas las actividades: lo que quedó pendiente de otra actividad se sube igual.
// window.AlbumCola.crear({ sb, yo }) → { agregar(item), procesar(), pendientes(actividad), escuchar({ alSubir, alEstado }) }
// item = { id, actividad, autor, foto, mini, media, ancho, alto, tomada, editada_de }
//   o un video: { id, actividad, autor, tipo: 'video', video, mime, mini, duracion_ms, ancho, alto, tomada }
(function () {
  const BD = 'thirdcedi-album', ALMACEN = 'pendientes';
  let bdP = null;
  function bd() {
    if (!bdP) bdP = new Promise((res, rej) => {
      const r = indexedDB.open(BD, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(ALMACEN, { keyPath: 'id' });
      r.onsuccess = () => res(r.result); r.onerror = () => { bdP = null; rej(r.error); };
    });
    return bdP;
  }
  async function opBD(modo, fn) {
    const d = await bd();
    return new Promise((res, rej) => {
      const t = d.transaction(ALMACEN, modo), req = fn(t.objectStore(ALMACEN));
      t.oncomplete = () => res(req?.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }
  // Si el teléfono no deja guardar las fotos (Safari en modo privado no guarda archivos en IndexedDB), la cola pasa a
  // vivir en memoria: se sube igual mientras la app esté abierta, pero si se cierra antes, lo pendiente se pierde.
  let memoria = null;
  const almacenMemoria = () => ({
    getAll: () => ({ result: [...memoria.values()] }),
    put: (x) => { memoria.set(x.id, x); return { result: x.id }; },
    // lo que había quedado guardado en el teléfono antes de pasar a memoria se borra también de ahí (si no, al abrir
    // la app de nuevo se volvería a subir)
    delete: (id) => { memoria.delete(id); opBD('readwrite', (s) => s.delete(id)).catch(() => {}); return {}; },
  });
  async function op(modo, fn) {
    if (!memoria) {
      try { return await opBD(modo, fn); } catch (e) {
        console.warn('álbum: no se puede guardar en el teléfono, la cola queda en memoria', e && e.message);
        memoria = new Map();
        try { for (const x of await opBD('readonly', (s) => s.getAll())) memoria.set(x.id, x); } catch { /* sin nada guardado */ }
      }
    }
    return fn(almacenMemoria()).result;
  }
  const enMemoria = () => !!memoria;

  function crear({ sb, yo }) {
    const A = window.AlbumLogica, BUCKET = 'album';
    let items = [], corriendo = false, otraVez = false, intento = 0, timer = null, ultimo = 'listo';
    const oyentes = new Set();
    const avisar = (estado) => {
      ultimo = estado;
      for (const o of oyentes) { try { o.alEstado?.({ estado }); } catch (x) { console.error(x); } }
    };
    const leer = async () => { items = await op('readonly', (s) => s.getAll()); return items; };
    const pendientes = (actividad) => A.pendientesDe(items, actividad, yo());
    // Errores (AlbumLogica.clasificarError): los permanentes se descartan. Los dudosos (400/403/RLS) pueden ser una
    // sesión vencida: se pregunta en_album con la sesión de ahora. Si no contesta, se reintenta más tarde; si ya no
    // estás anotado, se descarta; si sí estás, se reintenta, y a los DUDOSOS_MAX intentos se descarta igual.
    const DUDOSOS_MAX = 3;
    const dudas = new Map(); // id → intentos dudosos (en memoria: al recargar se empieza de nuevo)
    async function descartar(e, it) {
      const tipo = A.clasificarError(e);
      if (tipo === 'transitorio') return false;
      if (tipo === 'dudoso') {
        const r = await sb.rpc('en_album', { p_album: it.actividad }); // la actividad (anotado) o el álbum de todos (miembro)
        if (r.error) return false;
        const n = (dudas.get(it.id) || 0) + 1;
        if (r.data === true && n < DUDOSOS_MAX) { dudas.set(it.id, n); return false; }
      }
      dudas.delete(it.id);
      return true;
    }
    const pesa = (it) => (it.video || it.foto).size + it.mini.size + (it.media?.size || 0);

    async function subirUna(it) {
      const video = it.tipo === 'video', mime = video ? (it.mime === 'video/webm' ? 'video/webm' : 'video/mp4') : 'image/jpeg';
      const ruta = A.rutaFoto(it.actividad, it.id, video ? (mime === 'video/webm' ? 'webm' : 'mp4') : 'jpg'), mini = A.rutaMini(ruta);
      let r = await sb.storage.from(BUCKET).upload(ruta, video ? it.video : it.foto, { contentType: mime, upsert: true });
      if (r.error) throw r.error;
      r = await sb.storage.from(BUCKET).upload(mini, it.mini, { contentType: it.mini.type || 'image/webp', upsert: true });
      if (r.error) throw r.error;
      const media = it.media ? A.rutaMedia(ruta) : null; // 1600 px: queda en la app aunque la original se libere a Drive
      if (media) { r = await sb.storage.from(BUCKET).upload(media, it.media, { contentType: 'image/jpeg', upsert: true }); if (r.error) throw r.error; }
      // autor sale de auth.uid() (default de la columna): el cliente no lo manda
      const fila = { id: it.id, actividad: it.actividad, ruta, mini, media, ancho: it.ancho, alto: it.alto, bytes: pesa(it), tomada: it.tomada, editada_de: it.editada_de || null };
      if (video) Object.assign(fila, { tipo: 'video', duracion_ms: Math.max(1, Math.round(it.duracion_ms || 1)), mime });
      const ins = await sb.from('fotos').insert(fila).select('*').single();
      if (ins.error && ins.error.code !== '23505') throw ins.error; // 23505: ya estaba, la subida anterior llegó
      return ins.data || { ...fila, autor: it.autor, liberada: false, drive_id: null };
    }

    async function procesar() {
      if (corriendo) { otraVez = true; return; }
      corriendo = true; clearTimeout(timer);
      try {
        do {
          otraVez = false;
          const mias = A.soloMias(await leer(), yo());
          if (!mias.length) { intento = 0; avisar('listo'); break; }
          if (navigator.onLine === false) { avisar('sin-senal'); break; }
          const uso = await sb.rpc('album_uso');
          if (uso.error) throw uso.error;
          let usado = Number(uso.data) || 0;
          mias.sort((a, b) => (a.tomada < b.tomada ? -1 : 1));
          for (const it of mias) {
            if (A.espacio(usado + pesa(it), A.LIMITE_BYTES).estado === 'lleno') { avisar('lleno'); return; }
            avisar('subiendo');
            let fila;
            try { fila = await subirUna(it); }
            catch (e) {
              if (!(await descartar(e, it).catch(() => false))) throw e;
              console.error('álbum: foto descartada', e);
              const ruta = A.rutaFoto(it.actividad, it.id, it.tipo === 'video' ? (it.mime === 'video/webm' ? 'webm' : 'mp4') : 'jpg');
              sb.storage.from(BUCKET).remove([ruta, A.rutaMini(ruta), A.rutaMedia(ruta)].filter((x, i, xs) => xs.indexOf(x) === i)).catch(() => {});
              await op('readwrite', (s) => s.delete(it.id)); await leer();
              avisar('descartada');
              // el aviso sale aunque el álbum no esté abierto (la cola sube en segundo plano)
              window.App?.toast?.(it.tipo === 'video' ? 'Un video no se pudo subir (formato no válido o ya no estás anotado) y se descartó.' : 'Una foto no se pudo subir (formato no válido o ya no estás anotado) y se descartó.');
              continue;
            }
            usado += pesa(it); dudas.delete(it.id);
            await op('readwrite', (s) => s.delete(it.id));
            await leer(); intento = 0;
            for (const o of oyentes) { try { o.alSubir?.(fila); } catch (x) { console.error(x); } }
          }
          if (!A.soloMias(items, yo()).length) avisar('listo');
        } while (otraVez);
      } catch (e) {
        console.error('álbum: subida pendiente', e);
        avisar('reintentando');
        timer = setTimeout(procesar, A.espera(intento++));
      } finally { corriendo = false; }
    }

    async function agregar(item) {
      await op('readwrite', (s) => s.put(item));
      await leer(); avisar('en-cola');
      procesar();
    }
    function escuchar(o) { oyentes.add(o); return () => oyentes.delete(o); }

    addEventListener('online', () => { intento = 0; procesar(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { intento = 0; procesar(); } });
    leer().then(() => procesar()).catch(console.error);
    return { agregar, procesar, pendientes, escuchar, estado: () => ultimo, enMemoria };
  }

  window.AlbumCola = { crear };
})();
