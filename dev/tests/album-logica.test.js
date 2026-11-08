// Copiado de Rumbo al Sur y adaptado: carpeta por actividad (no por viaje), autor uuid y carpeta de Drive por actividad.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../../album-logica.js');

const ACT = '0f8fad5b-d9cb-469f-a165-70867728950e';
const ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

test('rutaFoto, rutaMini y rutaMedia: todo dentro de la carpeta de la actividad', () => {
  assert.equal(A.rutaFoto(ACT, ID), `${ACT}/${ID}.jpg`);
  assert.equal(A.rutaMini(`${ACT}/${ID}.jpg`), `${ACT}/${ID}.t.webp`);
  assert.equal(A.rutaMedia(`${ACT}/${ID}.jpg`), `${ACT}/${ID}.m.jpg`);
});

test('escala achica al lado mayor y nunca agranda', () => {
  assert.deepEqual(A.escala(8000, 6000, 4096), { ancho: 4096, alto: 3072 });
  assert.deepEqual(A.escala(3000, 4000, 4096), { ancho: 3000, alto: 4000 });
  assert.deepEqual(A.escala(6000, 8000, 4096), { ancho: 3072, alto: 4096 });
  assert.deepEqual(A.escala(1000, 1000), { ancho: 1000, alto: 1000 });
});

test('porDia agrupa en hora de Argentina, más nuevo primero', () => {
  const f = [
    { id: '1', tomada: '2026-11-19T10:00:00Z' },
    { id: '2', tomada: '2026-11-20T02:30:00Z' }, // 23:30 del 19 en Argentina
    { id: '3', tomada: '2026-11-20T15:00:00Z' },
  ];
  const g = A.porDia(f);
  assert.deepEqual(g.map((d) => d.dia), ['2026-11-20', '2026-11-19']);
  assert.deepEqual(g[1].fotos.map((x) => x.id), ['2', '1']);
  assert.equal(g[1].titulo, 'jueves 19 de noviembre');
});

test('espacio: ok, aviso desde 90 %, lleno desde 100 %', () => {
  assert.deepEqual(A.espacio(0, 1000), { pct: 0, estado: 'ok' });
  assert.equal(A.espacio(899, 1000).estado, 'ok');
  assert.equal(A.espacio(900, 1000).estado, 'aviso');
  assert.equal(A.espacio(1000, 1000).estado, 'lleno');
  assert.equal(A.espacio(1500, 1000).pct, 100);
});

test('fusionar no duplica y ordena por tomada desc; quitar saca por id', () => {
  let l = A.fusionar([], { id: 'a', tomada: '2026-11-19T10:00:00Z' });
  l = A.fusionar(l, { id: 'b', tomada: '2026-11-19T12:00:00Z' });
  l = A.fusionar(l, { id: 'a', tomada: '2026-11-19T10:00:00Z', ancho: 5 });
  assert.deepEqual(l.map((x) => x.id), ['b', 'a']);
  assert.equal(l[1].ancho, 5);
  assert.deepEqual(A.quitar(l, 'b').map((x) => x.id), ['a']);
});

test('espera: 2 s por 2^n con tope de 60 s', () => {
  assert.equal(A.espera(0), 2000);
  assert.equal(A.espera(1), 4000);
  assert.equal(A.espera(10), 60000);
});

test('zoomPasos: valores redondos dentro del rango, siempre con 1 si cabe', () => {
  assert.deepEqual(A.zoomPasos(1, 10), [1, 2, 5, 10]);
  assert.deepEqual(A.zoomPasos(0.6, 30), [0.6, 1, 2, 5, 10, 30]);
  assert.deepEqual(A.zoomPasos(1, 1), []);
  assert.deepEqual(A.zoomPasos(1, 4), [1, 2, 4]);
});

test('verFoto: la original si sigue en la app; si se liberó, la media; si no hay media, la miniatura', () => {
  assert.equal(A.verFoto({ ruta: 'o.jpg', media: 'o.m.jpg', mini: 'o.t.webp', liberada: false }), 'o.jpg');
  assert.equal(A.verFoto({ ruta: 'o.jpg', media: 'o.m.jpg', mini: 'o.t.webp', liberada: true }), 'o.m.jpg');
  assert.equal(A.verFoto({ ruta: 'o.jpg', media: null, mini: 'o.t.webp', liberada: true }), 'o.t.webp');
});

test('carpetaDrive: "<fecha en Argentina> <título>", sin caracteres que Drive no quiere', () => {
  // 01:00 UTC del 7 = 22:00 del 6 en Argentina
  assert.equal(A.carpetaDrive({ fecha: '2026-11-07T01:00:00Z', titulo: 'Pádel del jueves' }), '2026-11-06 Pádel del jueves');
  assert.equal(A.carpetaDrive({ fecha: '2026-11-07T15:00:00Z', titulo: '  Asado / fin de año\n' }), '2026-11-07 Asado - fin de año');
});

test('nombreDrive: fecha y hora de la foto, autor y id corto (estable para reintentos)', () => {
  const f = { id: ID, tomada: '2026-11-07T01:05:00Z', editada_de: null };
  assert.equal(A.nombreDrive(f, 'Ana Pérez'), `2026-11-06 22.05 Ana Pérez (${ID.slice(0, 8)}).jpg`);
  assert.equal(A.nombreDrive({ ...f, editada_de: 'x' }, 'Ana'), `2026-11-06 22.05 Ana editada (${ID.slice(0, 8)}).jpg`);
});

test('soloMias: la cola solo sube lo que sacó quien está con la sesión abierta', () => {
  const items = [{ id: '1', autor: 'yo' }, { id: '2', autor: 'otro' }, { id: '3', autor: 'yo' }];
  assert.deepEqual(A.soloMias(items, 'yo').map((x) => x.id), ['1', '3']);
  assert.deepEqual(A.soloMias(items, null), []);
});

test('pendientesDe: cuenta las fotos en cola de una actividad', () => {
  const items = [{ actividad: 'a', autor: 'yo' }, { actividad: 'b', autor: 'yo' }, { actividad: 'a', autor: 'yo' }, { actividad: 'a', autor: 'otro' }];
  assert.equal(A.pendientesDe(items, 'a', 'yo'), 2);
  assert.equal(A.pendientesDe(items, 'c', 'yo'), 0);
});

// Cámaras como las ve Chrome en un Samsung S24 (2026-11-03): principal = la que abre por defecto, la otra trasera = gran angular.
const S24 = [
  { deviceId: 'f1', label: 'camera 1, facing front' }, { deviceId: 'f3', label: 'camera 3, facing front' },
  { deviceId: 'b2', label: 'camera 2, facing back' }, { deviceId: 'b0', label: 'camera 0, facing back' },
];
test('lentesTraseras: con dos traseras, la que no abre por defecto es la gran angular', () => {
  assert.deepEqual(A.lentesTraseras(S24, 'b0'), { principal: 'b0', gran: 'b2', hayFrontal: true });
});
test('lentesTraseras: con una sola trasera no hay gran angular', () => {
  assert.deepEqual(A.lentesTraseras([S24[0], S24[3]], 'b0'), { principal: 'b0', gran: null, hayFrontal: true });
});
test('lentesTraseras: con tres o más traseras no se adivina cuál es la gran angular', () => {
  const tres = [...S24, { deviceId: 'b4', label: 'camera 4, facing back' }];
  assert.deepEqual(A.lentesTraseras(tres, 'b0'), { principal: 'b0', gran: null, hayFrontal: true });
});
test('lentesTraseras: sin etiquetas (computadora) usa la actual y no inventa gran angular', () => {
  assert.deepEqual(A.lentesTraseras([{ deviceId: 'w', label: 'HD Webcam' }], 'w'), { principal: 'w', gran: null, hayFrontal: false });
});

// ---- Ajustes de cierre (Task 10) ----
test('textoEstado: cantidad, pendientes, poco espacio y lleno (como antes)', () => {
  const ok = { estado: 'ok', pct: 10 };
  assert.equal(A.textoEstado({ n: 1, pend: 0, est: 'listo', espacio: ok }), '1 foto');
  assert.equal(A.textoEstado({ n: 3, pend: 2, est: 'subiendo', espacio: ok }), '3 fotos · subiendo 2');
  assert.equal(A.textoEstado({ n: 3, pend: 2, est: 'sin-senal', espacio: ok }), '3 fotos · 2 esperando señal');
  assert.equal(A.textoEstado({ n: 3, pend: 0, est: 'listo', espacio: { estado: 'aviso', pct: 92 } }), '3 fotos · queda poco espacio en la app');
  assert.match(A.textoEstado({ n: 3, pend: 1, est: 'lleno', espacio: { estado: 'ok', pct: 99 } }), /^Se llenó el espacio de la app \(99 %\).*Hay 1 esperando\.$/);
});

test('textoEstado: si la lista llegó al tope (LIMITE_FOTOS) lo dice', () => {
  assert.equal(A.LIMITE_FOTOS, 1000);
  assert.equal(A.textoEstado({ n: 1000, pend: 0, est: 'listo', espacio: { estado: 'ok', pct: 1 }, truncado: true }), '1000 fotos · se ven las 1000 más recientes');
});

test('clasificarError: formato o tamaño es permanente; 400/403/RLS es dudoso (puede ser la sesión); lo demás, transitorio', () => {
  for (const e of [{ statusCode: '413' }, { statusCode: 415 }, { status: 422 }, { code: '23514' }, { code: '22P02' }, { code: '23502' }, { code: '23503' }]) assert.equal(A.clasificarError(e), 'permanente', JSON.stringify(e));
  for (const e of [{ statusCode: '400' }, { statusCode: '403' }, { status: 403 }, { code: '42501' }]) assert.equal(A.clasificarError(e), 'dudoso', JSON.stringify(e));
  for (const e of [{ statusCode: '500' }, { message: 'Failed to fetch' }, null, undefined]) assert.equal(A.clasificarError(e), 'transitorio', JSON.stringify(e));
});

test('videos: ruta .mp4/.webm con miniatura .t.webp, nombre en Drive con su extensión y duración', () => {
  assert.equal(A.rutaFoto(ACT, ID, 'mp4'), `${ACT}/${ID}.mp4`);
  assert.equal(A.rutaMini(`${ACT}/${ID}.mp4`), `${ACT}/${ID}.t.webp`);
  assert.equal(A.rutaMini(`${ACT}/${ID}.webm`), `${ACT}/${ID}.t.webp`);
  assert.equal(A.rutaFoto(ACT, ID), `${ACT}/${ID}.jpg`, 'una foto sigue igual');
  const f = { id: ID, tomada: '2026-11-20T23:05:00Z', editada_de: null, ruta: `${ACT}/${ID}.webm` };
  assert.match(A.nombreDrive(f, 'Ana'), /\(7c9e6679\)\.webm$/);
  assert.match(A.nombreDrive({ ...f, ruta: undefined }, 'Ana'), /\.jpg$/);
  assert.equal(A.esVideo({ tipo: 'video' }), true); assert.equal(A.esVideo({ tipo: 'foto' }), false); assert.equal(A.esVideo(null), false);
  assert.equal(A.duracion(7400), '0:07'); assert.equal(A.duracion(60000), '1:00'); assert.equal(A.duracion(null), '0:00');
});
