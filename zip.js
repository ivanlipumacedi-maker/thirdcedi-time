// Armador de .zip mínimo (sin compresión: las fotos JPEG y los videos MP4/WebM ya vienen comprimidos y comprimirlos de
// nuevo solo gasta batería). Formato ZIP clásico con nombres en UTF-8 (flag 0x0800); hasta 65.535 archivos y 4 GB.
// Zip.armar([{ nombre, datos: Uint8Array, fecha?: Date }]) → Blob (application/zip). En el navegador queda en window.Zip.
(function (g) {
  let tabla = null;
  function crc32(datos) {
    if (!tabla) {
      tabla = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        tabla[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < datos.length; i++) c = tabla[(c ^ datos[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // fecha y hora en formato DOS (precisión de 2 s; antes de 1980 no existe)
  function dos(fecha) {
    const d = fecha instanceof Date && !isNaN(fecha) && fecha.getFullYear() >= 1980 ? fecha : new Date(1980, 0, 1);
    return {
      hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      dia: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }

  // nombres únicos y sin barras (una barra en el nombre crearía carpetas al descomprimir)
  function nombresUnicos(nombres) {
    const vistos = new Map();
    return nombres.map((n) => {
      let base = String(n || 'archivo').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim() || 'archivo';
      const k = base.toLowerCase();
      const veces = vistos.get(k) || 0;
      vistos.set(k, veces + 1);
      if (veces) { const p = base.lastIndexOf('.'); base = p > 0 ? base.slice(0, p) + ' (' + (veces + 1) + ')' + base.slice(p) : base + ' (' + (veces + 1) + ')'; }
      return base;
    });
  }

  function armar(archivos) {
    const te = new TextEncoder();
    const nombres = nombresUnicos(archivos.map((a) => a.nombre));
    const partes = [], central = [];
    let offset = 0;
    archivos.forEach((a, i) => {
      const datos = a.datos instanceof Uint8Array ? a.datos : new Uint8Array(a.datos);
      const nombre = te.encode(nombres[i]);
      const crc = crc32(datos), t = dos(a.fecha);
      const loc = new DataView(new ArrayBuffer(30));
      loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true); loc.setUint16(8, 0, true);
      loc.setUint16(10, t.hora, true); loc.setUint16(12, t.dia, true); loc.setUint32(14, crc, true);
      loc.setUint32(18, datos.length, true); loc.setUint32(22, datos.length, true); loc.setUint16(26, nombre.length, true); loc.setUint16(28, 0, true);
      partes.push(loc, nombre, datos);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true);
      cen.setUint16(12, t.hora, true); cen.setUint16(14, t.dia, true); cen.setUint32(16, crc, true);
      cen.setUint32(20, datos.length, true); cen.setUint32(24, datos.length, true); cen.setUint16(28, nombre.length, true);
      cen.setUint16(30, 0, true); cen.setUint16(32, 0, true); cen.setUint16(34, 0, true); cen.setUint16(36, 0, true); cen.setUint32(38, 0, true);
      cen.setUint32(42, offset, true);
      central.push(cen, nombre);
      offset += 30 + nombre.length + datos.length;
    });
    const tamCentral = central.reduce((s, x) => s + x.byteLength, 0);
    const fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true); fin.setUint16(4, 0, true); fin.setUint16(6, 0, true);
    fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
    fin.setUint32(12, tamCentral, true); fin.setUint32(16, offset, true); fin.setUint16(20, 0, true);
    const todo = [...partes, ...central, fin];
    return typeof Blob !== 'undefined' ? new Blob(todo, { type: 'application/zip' }) : todo;
  }

  const Zip = { crc32, armar, nombresUnicos };
  if (typeof module !== 'undefined' && module.exports) module.exports = Zip;
  else g.Zip = Zip;
})(typeof window !== 'undefined' ? window : globalThis);
