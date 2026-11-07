const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../chat-logica.js');

test('textoValido rechaza vacío/espacios y más de 2000, acepta emojis', () => {
  assert.equal(L.textoValido('  '), false);
  assert.equal(L.textoValido(''), false);
  assert.equal(L.textoValido('a'.repeat(2001)), false);
  assert.equal(L.textoValido('a'.repeat(2000)), true);
  assert.equal(L.textoValido('hola 🦙'), true);
});

test('resumen trunca a 80 con … y nombra la foto', () => {
  const r = L.resumen({ tipo: 'texto', texto: 'x'.repeat(100) });
  assert.equal(r.length, 80);
  assert.ok(r.endsWith('…'));
  assert.equal(L.resumen({ tipo: 'texto', texto: '  hola  ' }), 'hola');
  assert.equal(L.resumen({ tipo: 'foto' }), 'Foto');
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

test('escalar entra en max por el lado largo y nunca agranda', () => {
  assert.deepEqual(L.escalar(4000, 3000, 1600), { ancho: 1600, alto: 1200 });
  assert.deepEqual(L.escalar(800, 600, 1600), { ancho: 800, alto: 600 });
  assert.deepEqual(L.escalar(3000, 4000, 1600), { ancho: 1200, alto: 1600 });
  assert.deepEqual(L.escalar(1000, 333, 400), { ancho: 400, alto: 133 });
});

test('rutaArchivo de una foto', () => {
  assert.equal(L.rutaArchivo('v', 'foto', 'x'), 'v/fotos/x.webp');
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

test('eliminado: resumen', () => {
  assert.equal(L.resumen({ tipo: 'eliminado' }), 'Se eliminó este mensaje');
});

test('fusionar: un mensaje eliminado no vuelve por una respuesta o un evento atrasado', () => {
  const del = { id: 'x', tipo: 'eliminado', creado: '2026-11-19T10:00:00Z' };
  const viejo = { id: 'x', tipo: 'texto', texto: 'hola', creado: '2026-11-19T10:00:00Z' };
  assert.equal(L.fusionar([del], viejo)[0].tipo, 'eliminado');
  assert.equal(L.fusionar([viejo], del)[0].tipo, 'eliminado');
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

// ---- Fix round 1 ----
test('reconciliar: no pierde lo que llegó por Realtime (o el insert propio) durante la sincronización', () => {
  // página llena: el servidor devolvió 1 y 2; mientras tanto llegó el 3 (más nuevo que todo lo devuelto)
  const recientes = [{ id: '1', creado: '2026-11-02T10:00:00Z' }, { id: '2', creado: '2026-11-02T10:01:00Z' }];
  const nuevo = { id: '3', creado: '2026-11-02T10:02:00Z' };
  assert.deepEqual(L.reconciliar([...recientes, nuevo], recientes, 2).map((m) => m.id), ['1', '2', '3']);
  // página corta (el servidor "manda"): igual se conserva lo más nuevo que su último mensaje
  assert.deepEqual(L.reconciliar([recientes[0], nuevo], [recientes[0]], 50).map((m) => m.id), ['1', '3']);
});

test('reconciliar: conserva los ids que llegaron durante la sync aunque no sean los más nuevos, y su versión gana', () => {
  const recientes = [{ id: '1', creado: '2026-11-02T10:00:00Z', tipo: 'texto', texto: 'viejo' }, { id: '3', creado: '2026-11-02T10:02:00Z' }];
  // el 2 se confirmó con un creado anterior al último de la página pero no entró en la consulta
  const dos = { id: '2', creado: '2026-11-02T10:01:00Z' };
  const editado = { ...recientes[0], texto: 'nuevo', editado: true };
  const r = L.reconciliar([editado, dos, recientes[1]], recientes, 50, new Set(['1', '2']));
  assert.deepEqual(r.map((m) => m.id), ['1', '2', '3']);
  assert.equal(r[0].texto, 'nuevo', 'la versión que llegó en vivo no se pisa con la consulta');
  // sin el id en "llegados", lo que el servidor ya no tiene en el tramo desaparece (borrado mientras no escuchábamos)
  assert.deepEqual(L.reconciliar([recientes[0], dos, recientes[1]], recientes, 50).map((m) => m.id), ['1', '3']);
});

test('reconciliar: un eliminado no resucita por una página atrasada', () => {
  const del = { id: '1', creado: '2026-11-02T10:00:00Z', tipo: 'eliminado' };
  const r = L.reconciliar([del], [{ ...del, tipo: 'texto', texto: 'zombi' }], 50);
  assert.equal(r[0].tipo, 'eliminado');
});

test('aplicarEvento: un UPDATE de un mensaje que no está en la lista se ignora; un INSERT entra', () => {
  const lista = [{ id: '1', creado: '2026-11-02T10:00:00Z', tipo: 'texto', texto: 'a' }];
  const viejo = { id: 'z', creado: '2026-10-01T10:00:00Z', tipo: 'texto', texto: 'editado lejos' };
  assert.equal(L.aplicarEvento(lista, 'UPDATE', viejo), lista);
  assert.deepEqual(L.aplicarEvento(lista, 'UPDATE', { ...lista[0], texto: 'b' }).map((m) => m.texto), ['b']);
  assert.deepEqual(L.aplicarEvento(lista, 'INSERT', { id: '2', creado: '2026-11-02T10:01:00Z', tipo: 'texto', texto: 'c' }).map((m) => m.id), ['1', '2']);
});

test('orden por (creado, id): mismo creado se desempata por id, igual que la consulta', () => {
  const t = '2026-11-02T10:00:00Z';
  const l = L.fusionarLote([], [{ id: 'b', creado: t }, { id: 'a', creado: t }, { id: 'c', creado: '2026-11-02T09:00:00Z' }]);
  assert.deepEqual(l.map((m) => m.id), ['c', 'a', 'b']);
});

test('reconciliar: con página llena y empate en el creado del corte, conserva el que es más viejo por id', () => {
  const t = '2026-11-02T10:00:00Z';
  const recientes = [{ id: 'b', creado: t }, { id: 'c', creado: '2026-11-02T10:01:00Z' }];
  assert.deepEqual(L.reconciliar([{ id: 'a', creado: t }, ...recientes], recientes, 2).map((m) => m.id), ['a', 'b', 'c']);
});

test('cursor y filtroAntes: (creado, id) del más viejo cargado, sin temporales', () => {
  const lista = [{ id: 'tmp-1', creado: '2026-11-02T09:00:00Z' }, { id: 'x', creado: '2026-11-02T10:00:00.123+00:00' }, { id: 'y', creado: '2026-11-02T11:00:00Z' }];
  const c = L.cursor(lista);
  assert.deepEqual(c, { creado: '2026-11-02T10:00:00.123+00:00', id: 'x' });
  assert.equal(L.filtroAntes(c), 'creado.lt."2026-11-02T10:00:00.123+00:00",and(creado.eq."2026-11-02T10:00:00.123+00:00",id.lt."x")');
  assert.equal(L.cursor([{ id: 'tmp-1', creado: '2026-11-02T09:00:00Z' }]), null);
});

test('textoEditado: recorta y avisa si no cambió', () => {
  assert.equal(L.textoEditado('  hola  ', 'hola'), null);
  assert.equal(L.textoEditado('  chau ', 'hola'), 'chau');
  assert.equal(L.textoEditado('   ', 'hola'), null);
});

test('comparar usa microsegundos (Postgres) y no solo milisegundos', () => {
  const a = { id: 'z', creado: '2026-11-02T10:00:00.123400+00:00' };
  const b = { id: 'a', creado: '2026-11-02T10:00:00.123500+00:00' };
  assert.ok(L.comparar(a, b) < 0);
  assert.ok(L.comparar({ id: 'a', creado: '2026-11-02T10:00:00Z' }, { id: 'b', creado: '2026-11-02T10:00:00.000+00:00' }) < 0);
});

test('09: el recorte de editar_mensaje (regex de Postgres) saca lo mismo que trim() de JS', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', '09-chat-ajustes.sql'), 'utf8');
  // la clase está una sola vez, dentro de recortar_como_trim
  assert.equal((sql.match(/\\\\u0009/g) || []).length, 1, 'la clase de blancos tiene que estar en un solo lugar');
  const m = /select E'(\[[^']+\])'::text as blancos/.exec(sql);
  assert.ok(m, 'no encontré la clase "blancos" en la 09');
  assert.match(sql, /select regexp_replace\(t, '\^' \|\| c\.blancos \|\| '\+\|' \|\| c\.blancos \|\| '\+\$', '', 'g'\)/, 'recortar_como_trim recorta al principio y al final');
  // en E'' la barra va doblada: el motor de regex recibe \uXXXX, que JS entiende igual
  const clase = m[1].replace(/\\\\/g, '\\');
  assert.match(clase, /^\[(\\u[0-9a-f]{4}(-\\u[0-9a-f]{4})?)+\]$/, 'la clase tiene que ser solo escapes \\uXXXX');
  const recorte = new RegExp('^' + clase + '+|' + clase + '+$', 'g');
  for (let cp = 0; cp <= 0xffff; cp++) {
    const ch = String.fromCharCode(cp);
    const s = ch + ch + 'a' + ch + 'b' + ch;
    assert.equal(s.replace(recorte, ''), s.trim(), 'U+' + cp.toString(16).padStart(4, '0'));
  }
  assert.equal(' \n\t\u00a0hola\u3000\r\n'.replace(recorte, ''), 'hola');
  assert.equal(' \n\t '.replace(recorte, ''), '');
  assert.match(sql, /t text := public\.recortar_como_trim\(p_texto\);/, 'editar_mensaje recorta con recortar_como_trim');
  assert.match(sql, /if public\.recortar_como_trim\(r\.texto\) is not distinct from t then/, 'la comparación de "no cambió" también recorta');
  // el check: la misma condición de la 08 cambiando solo btrim por recortar_como_trim
  const sql08 = fs.readFileSync(path.join(__dirname, '..', 'supabase', '08-chat.sql'), 'utf8');
  const viejo = /constraint mensajes_texto_valido check (\(.*\)),\r?\n/.exec(sql08);
  assert.ok(viejo, 'no encontré mensajes_texto_valido en la 08');
  assert.match(viejo[1], /btrim\(texto\)/);
  const nuevo = /drop constraint mensajes_texto_valido,\s*add constraint mensajes_texto_valido check (\(.*\));/.exec(sql);
  assert.ok(nuevo, 'no encontré el alter de mensajes_texto_valido en la 09');
  assert.equal(nuevo[1], viejo[1].replace('btrim(texto)', 'public.recortar_como_trim(texto)'));
  assert.doesNotMatch(sql.replace(/^\s*--.*$/gm, ''), /btrim/, 'la 09 no usa btrim');
});
