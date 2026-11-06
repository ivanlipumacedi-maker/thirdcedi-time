const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../chat-logica.js');

test('REACCIONES son exactamente las 6 acordadas', () => {
  assert.deepEqual(L.REACCIONES, ['❤️', '😂', '😮', '😢', '👍', '🔥']);
});

test('textoValido rechaza vacío/espacios y más de 2000, acepta emojis', () => {
  assert.equal(L.textoValido('  '), false);
  assert.equal(L.textoValido(''), false);
  assert.equal(L.textoValido('a'.repeat(2001)), false);
  assert.equal(L.textoValido('a'.repeat(2000)), true);
  assert.equal(L.textoValido('hola 🦙'), true);
});

test('resumen trunca a 80 con … y nombra los otros tipos', () => {
  const r = L.resumen({ tipo: 'texto', texto: 'x'.repeat(100) });
  assert.equal(r.length, 80);
  assert.ok(r.endsWith('…'));
  assert.equal(L.resumen({ tipo: 'texto', texto: '  hola  ' }), 'hola');
  assert.equal(L.resumen({ tipo: 'foto' }), '📷 Foto');
  assert.equal(L.resumen({ tipo: 'audio' }), '🎤 Audio');
  assert.equal(L.resumen({ tipo: 'sticker' }), 'Sticker');
});

test('fusionar es idempotente por id y ordena por creado', () => {
  const a = { id: '1', creado: '2026-11-02T10:00:00Z', texto: 'v1' };
  const a2 = { ...a, texto: 'v2' };
  const b = { id: '2', creado: '2026-11-02T09:00:00Z', texto: 'antes' };
  const l1 = L.fusionar([], a);
  const l2 = L.fusionar(l1, a2);
  assert.equal(l2.length, 1);
  assert.equal(l2[0].texto, 'v2');
  const l3 = L.fusionar(l2, b);
  assert.deepEqual(l3.map((m) => m.id), ['2', '1']);
  assert.equal(l1.length, 1, 'no muta la lista de entrada');
});

test('quitar saca por id', () => {
  assert.deepEqual(L.quitar([{ id: '1' }, { id: '2' }], '1'), [{ id: '2' }]);
});

test('noLeidos cuenta solo los del otro posteriores a vistoHasta', () => {
  const visto = Date.parse('2026-11-02T10:00:00Z');
  const lista = [
    { id: '1', autor: 'B', creado: '2026-11-02T09:59:00Z' },
    { id: '2', autor: 'B', creado: '2026-11-02T10:01:00Z' },
    { id: '3', autor: 'A', creado: '2026-11-02T10:02:00Z' },
  ];
  assert.equal(L.noLeidos(lista, 'A', visto), 1);
  assert.equal(L.noLeidos(lista, 'B', visto), 1);
});

test('alternarReaccion pone, quita, reemplaza y no muta', () => {
  const vacio = {};
  const puesto = L.alternarReaccion(vacio, 'A', '🔥');
  assert.deepEqual(puesto, { A: '🔥' });
  assert.deepEqual(vacio, {});
  assert.deepEqual(L.alternarReaccion(puesto, 'A', '🔥'), {});
  assert.deepEqual(L.alternarReaccion({ A: '🔥', B: '❤️' }, 'A', '😂'), { A: '😂', B: '❤️' });
});

test('horaCorta en hora argentina', () => {
  assert.equal(L.horaCorta('2026-11-02T20:05:00Z'), '17:05');
});

test('reconciliar: con menos de 50 recientes, el servidor manda (saca borrados)', () => {
  const lista = [{ id: '1', creado: '2026-11-02T10:00:00Z' }, { id: '2', creado: '2026-11-02T10:01:00Z' }];
  const recientes = [{ id: '2', creado: '2026-11-02T10:01:00Z', texto: 'nuevo' }];
  assert.deepEqual(L.reconciliar(lista, recientes, 50), recientes);
});

test('reconciliar: con página llena conserva lo más viejo que el corte y reemplaza el resto', () => {
  const viejo = { id: 'v', creado: '2026-11-01T00:00:00Z' };
  const borrado = { id: 'b', creado: '2026-11-02T10:00:30Z' };
  const recientes = [{ id: '1', creado: '2026-11-02T10:00:00Z' }, { id: '2', creado: '2026-11-02T10:01:00Z' }];
  assert.deepEqual(L.reconciliar([viejo, recientes[0], borrado, recientes[1]], recientes, 2).map((m) => m.id), ['v', '1', '2']);
});

test('ultimoCreado devuelve el creado más nuevo en ms (0 si vacía)', () => {
  assert.equal(L.ultimoCreado([]), 0);
  assert.equal(L.ultimoCreado([{ creado: '2026-11-02T10:00:00Z' }, { creado: '2026-11-02T09:00:00Z' }]), Date.parse('2026-11-02T10:00:00Z'));
});

test('noLeidos con vistoHasta = último creado visto (reloj del servidor)', () => {
  const lista = [{ id: '1', autor: 'B', creado: '2026-11-02T10:00:00Z' }];
  assert.equal(L.noLeidos(lista, 'A', L.ultimoCreado(lista)), 0);
});

test('escalar entra en max por el lado largo y nunca agranda', () => {
  assert.deepEqual(L.escalar(4000, 3000, 1600), { ancho: 1600, alto: 1200 });
  assert.deepEqual(L.escalar(800, 600, 1600), { ancho: 800, alto: 600 });
  assert.deepEqual(L.escalar(3000, 4000, 1600), { ancho: 1200, alto: 1600 });
  assert.deepEqual(L.escalar(1000, 333, 400), { ancho: 400, alto: 133 });
});

test('duracionTexto en m:ss', () => {
  assert.equal(L.duracionTexto(0), '0:00');
  assert.equal(L.duracionTexto(65400), '1:05');
  assert.equal(L.duracionTexto(120000), '2:00');
});

test('rutaArchivo por tipo', () => {
  assert.equal(L.rutaArchivo('v', 'foto', 'x'), 'v/fotos/x.webp');
  assert.equal(L.rutaArchivo('v', 'audio', 'x'), 'v/audios/x.webm');
  assert.equal(L.rutaArchivo('v', 'perfil', 'A-1'), 'v/perfil/A-1.webp');
});

test('audioValido entre 700 ms y 2 minutos', () => {
  assert.equal(L.audioValido(699), false);
  assert.equal(L.audioValido(700), true);
  assert.equal(L.audioValido(120000), true);
  assert.equal(L.audioValido(120001), false);
});

test('textoSticker: recorta, mayúsculas y 30 como máximo', () => {
  assert.equal(L.textoSticker('  jaja  '), 'JAJA');
  assert.equal(L.textoSticker(''), '');
  assert.equal(L.textoSticker('a'.repeat(40)).length, 30);
});

test('rutaArchivo de sticker', () => {
  assert.equal(L.rutaArchivo('v', 'sticker', 'x'), 'v/stickers/x.webp');
});

test('externoValido solo acepta media*.giphy.com', () => {
  assert.equal(L.externoValido('https://media1.giphy.com/media/a/200.webp'), true);
  assert.equal(L.externoValido('https://media.giphy.com/media/a/200.gif'), true);
  assert.equal(L.externoValido('https://media.giphy.com.evil.com/x'), false);
  assert.equal(L.externoValido('https://evil.com/x.png'), false);
  assert.equal(L.externoValido(null), false);
});

test('lineasSticker parte el texto largo en 2 líneas por palabras', () => {
  assert.deepEqual(L.lineasSticker('JAJA'), ['JAJA']);
  assert.deepEqual(L.lineasSticker('NOS VAMOS AL SUR EN CAMIONETA'), ['NOS VAMOS AL SUR', 'EN CAMIONETA']);
  assert.ok(L.lineasSticker('A'.repeat(30)).length <= 2);
  assert.deepEqual(L.lineasSticker(''), []);
});

test('textoCita: resumen del original o "Mensaje borrado"', () => {
  assert.equal(L.textoCita({ tipo: 'texto', texto: 'hola' }), 'hola');
  assert.equal(L.textoCita({ tipo: 'foto' }), '📷 Foto');
  assert.equal(L.textoCita(null), 'Mensaje eliminado');
});

test('citasFaltantes: ids citados que no están ni en la lista ni ya buscados', () => {
  const lista = [{ id: 'a' }, { id: 'b', responde_a: 'a' }, { id: 'c', responde_a: 'x' }, { id: 'd', responde_a: 'y' }, { id: 'e', responde_a: 'x' }];
  assert.deepEqual(L.citasFaltantes(lista, new Map([['y', null]])), ['x']);
});

test('tilde de mis mensajes: reloj, enviado, entregado, leído', () => {
  const m = { id: 'x', autor: 'A', tipo: 'texto', creado: '2026-11-19T10:00:00Z' };
  assert.equal(L.tilde({ ...m, id: 'tmp-1' }, 'A', {}), 'reloj');
  assert.equal(L.tilde(m, 'A', {}), 'enviado');
  assert.equal(L.tilde(m, 'A', { entregado: '2026-11-19T10:00:00Z' }), 'entregado');
  assert.equal(L.tilde(m, 'A', { entregado: '2026-11-19T11:00:00Z', leido: '2026-11-19T10:00:00+00:00' }), 'leido');
  assert.equal(L.tilde(m, 'A', { entregado: '2026-11-19T09:00:00Z' }), 'enviado');
  assert.equal(L.tilde(m, 'B', { leido: '2026-11-19T11:00:00Z' }), null, 'en los del otro no hay tilde');
  assert.equal(L.tilde({ ...m, tipo: 'eliminado' }, 'A', {}), null);
});

test('puedeEditar: solo mis textos, hasta 15 minutos', () => {
  const ahora = Date.parse('2026-11-19T10:14:00Z');
  const m = { id: 'x', autor: 'A', tipo: 'texto', creado: '2026-11-19T10:00:00Z' };
  assert.equal(L.puedeEditar(m, 'A', ahora), true);
  assert.equal(L.puedeEditar(m, 'A', ahora + 2 * 60000), false);
  assert.equal(L.puedeEditar(m, 'B', ahora), false);
  assert.equal(L.puedeEditar({ ...m, tipo: 'foto' }, 'A', ahora), false);
  assert.equal(L.puedeEditar({ ...m, id: 'tmp-1' }, 'A', ahora), false);
});

test('eliminado: resumen y cita', () => {
  assert.equal(L.resumen({ tipo: 'eliminado' }), '🚫 Se eliminó este mensaje');
  assert.equal(L.textoCita({ tipo: 'eliminado' }), 'Mensaje eliminado');
  assert.equal(L.textoCita(null), 'Mensaje eliminado');
});

test('ultimaVez: hoy, ayer o fecha', () => {
  const ahora = Date.parse('2026-11-19T18:00:00-03:00');
  assert.equal(L.ultimaVez('2026-11-19T14:05:00-03:00', ahora), 'últ. vez hoy a las 14:05');
  assert.equal(L.ultimaVez('2026-11-18T23:10:00-03:00', ahora), 'últ. vez ayer a las 23:10');
  assert.equal(L.ultimaVez('2026-11-10T09:00:00-03:00', ahora), 'últ. vez el 10/11 a las 09:00');
  assert.equal(L.ultimaVez(null, ahora), '');
});

test('patronBusqueda escapa los comodines de LIKE', () => {
  assert.equal(L.patronBusqueda('  50% off_x '), '%50\\% off\\_x%');
  assert.equal(L.patronBusqueda(' '), null);
});

test('fusionar: un mensaje eliminado no vuelve por una respuesta o broadcast atrasado', () => {
  const del = { id: 'x', tipo: 'eliminado', creado: '2026-11-19T10:00:00Z', reacciones: {} };
  const viejo = { id: 'x', tipo: 'texto', texto: 'hola', creado: '2026-11-19T10:00:00Z', reacciones: { B: '❤️' } };
  assert.equal(L.fusionar([del], viejo)[0].tipo, 'eliminado');
  assert.equal(L.fusionar([viejo], del)[0].tipo, 'eliminado');
});

test('patronBusqueda: el * no hace de comodín', () => {
  assert.equal(L.patronBusqueda('*'), null);
  assert.equal(L.patronBusqueda('a*b'), '%ab%');
});

test('fusionarLote: una recarga tras reconectar no duplica ni pisa eliminados', () => {
  const a = { id: '1', creado: '2026-11-19T10:00:00Z', tipo: 'texto', texto: 'a' };
  const b = { id: '2', creado: '2026-11-19T10:01:00Z', tipo: 'eliminado' };
  const lista = [a, b];
  const lote = [{ ...a }, { id: '2', creado: b.creado, tipo: 'texto', texto: 'zombi' }, { id: '3', creado: '2026-11-19T10:02:00Z', tipo: 'texto', texto: 'nuevo' }];
  const r = L.fusionarLote(lista, lote);
  assert.deepEqual(r.map((m) => m.id), ['1', '2', '3']);
  assert.equal(r[1].tipo, 'eliminado');
  assert.deepEqual(L.fusionarLote(r, lote).map((m) => m.id), ['1', '2', '3'], 'idempotente');
  assert.equal(lista.length, 2, 'no muta');
});
