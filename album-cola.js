// Cola de subida del álbum (copiada de Rumbo al Sur y adaptada): cada foto se guarda primero en el teléfono (IndexedDB)
// y se sube cuando hay señal. El id de la foto se genera al sacarla y es el id de la fila: reintentar no duplica.
// Hay una sola cola para todas las actividades: lo que quedó pendiente de otra actividad se sube igual.
// window.AlbumCola.crear({ sb, yo }) → { agregar(item), procesar(), pendientes(actividad), escuchar({ alSubir, alEstado }) }
// item = { id, actividad, autor, foto, mini, media, ancho, alto, tomada, editada_de }
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
  async function op(modo, fn) {
    const d = await bd();
    return new Promise((res, rej) => {
      const t = d.transaction(ALMACEN, modo), req = fn(t.objectStore(ALMACEN));
      t.oncomplete = () => res(req?.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }

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
    // errores que no se arreglan reintentando (formato o tamaño rechazado, dato inválido, ya no estás anotado): se descarta
    const PERMANENTES = new Set(['400', '403', '413', '415', '422', '23514', '22P02', '23502', '23503', '42501']);
    const esPermanente = (e) => PERMANENTES.has(String(e?.statusCode ?? e?.status ?? '')) || PERMANENTES.has(String(e?.code ?? ''));
    const pesa = (it) => it.foto.size + it.mini.size + (it.media?.size || 0);

    async function subirUna(it) {
      const ruta = A.rutaFoto(it.actividad, it.id), mini = A.rutaMini(ruta);
      let r = await sb.storage.from(BUCKET).upload(ruta, it.foto, { contentType: 'image/jpeg', upsert: true });
      if (r.error) throw r.error;
      r = await sb.storage.from(BUCKET).upload(mini, it.mini, { contentType: it.mini.type || 'image/webp', upsert: true });
      if (r.error) throw r.error;
      const media = it.media ? A.rutaMedia(ruta) : null; // 1600 px: queda en la app aunque la original se libere a Drive
      if (media) { r = await sb.storage.from(BUCKET).upload(media, it.media, { contentType: 'image/jpeg', upsert: true }); if (r.error) throw r.error; }
      // autor sale de auth.uid() (default de la columna): el cliente no lo manda
      const fila = { id: it.id, actividad: it.actividad, ruta, mini, media, ancho: it.ancho, alto: it.alto, bytes: pesa(it), tomada: it.tomada, editada_de: it.editada_de || null };
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
              if (!esPermanente(e)) throw e;
              console.error('álbum: foto descartada', e);
              const ruta = A.rutaFoto(it.actividad, it.id);
              sb.storage.from(BUCKET).remove([ruta, A.rutaMini(ruta), A.rutaMedia(ruta)]).catch(() => {});
              await op('readwrite', (s) => s.delete(it.id)); await leer();
              avisar('descartada');
              continue;
            }
            usado += pesa(it);
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
    return { agregar, procesar, pendientes, escuchar, estado: () => ultimo };
  }

  window.AlbumCola = { crear };
})();
