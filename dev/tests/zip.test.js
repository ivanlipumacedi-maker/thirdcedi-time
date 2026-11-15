// Tests del armador de .zip (zip.js) que usa "Bajar todas" del álbum.
const test = require('node:test');
const assert = require('node:assert/strict');
const Z = require('../../zip.js');

test('crc32: valor conocido de "123456789"', () => {
  assert.equal(Z.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(Z.crc32(new Uint8Array(0)), 0);
});

test('nombres: únicos (sin distinguir mayúsculas), sin barras ni caracteres prohibidos', () => {
  assert.deepEqual(Z.nombresUnicos(['a.jpg', 'A.jpg', 'a.jpg', 'x/y.jpg', 'sin extensión', 'sin extensión', '']),
    ['a.jpg', 'A (2).jpg', 'a (3).jpg', 'x-y.jpg', 'sin extensión', 'sin extensión (2)', 'archivo']);
});

test('armar: el zip se puede leer (cabeceras, directorio central y contenido intactos)', async () => {
  const te = new TextEncoder();
  const archivos = [
    { nombre: 'Ña foto.jpg', datos: te.encode('hola mundo'), fecha: new Date(2026, 10, 14, 12, 30, 10) },
    { nombre: 'video.mp4', datos: new Uint8Array(1000).map((_, i) => i % 251) },
  ];
  const buf = new Uint8Array(await Z.armar(archivos).arrayBuffer());
  const v = new DataView(buf.buffer);
  const fin = buf.length - 22;
  assert.equal(v.getUint32(fin, true), 0x06054b50);
  assert.equal(v.getUint16(fin + 10, true), 2);
  let p = v.getUint32(fin + 16, true);
  const td = new TextDecoder();
  for (const a of archivos) {
    assert.equal(v.getUint32(p, true), 0x02014b50);
    const tam = v.getUint32(p + 20, true), largo = v.getUint16(p + 28, true), off = v.getUint32(p + 42, true);
    assert.equal(td.decode(buf.subarray(p + 46, p + 46 + largo)), a.nombre);
    assert.equal(v.getUint16(p + 8, true) & 0x0800, 0x0800, 'nombre en UTF-8');
    assert.equal(v.getUint32(off, true), 0x04034b50);
    const ln = v.getUint16(off + 26, true);
    const datos = buf.subarray(off + 30 + ln, off + 30 + ln + tam);
    assert.deepEqual(datos, a.datos);
    assert.equal(v.getUint32(off + 14, true), Z.crc32(a.datos));
    p += 46 + largo;
  }
  // fecha DOS del primero: 14/11/2026 12:30:10
  const off0 = v.getUint32(v.getUint32(fin + 16, true) + 42, true);
  assert.equal(v.getUint16(off0 + 12, true), ((2026 - 1980) << 9) | (11 << 5) | 14);
  assert.equal(v.getUint16(off0 + 10, true), (12 << 11) | (30 << 5) | 5);
});
