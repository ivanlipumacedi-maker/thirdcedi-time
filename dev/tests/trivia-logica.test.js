const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../trivia-logica.js');
const Preguntas = require('../../contenido/preguntas.js');

test('elegir: misma semilla → mismo orden, sin ids repetidos', () => {
  const a = T.elegir(Preguntas, 10, 1234);
  const b = T.elegir(Preguntas, 10, 1234);
  assert.equal(a.length, 10);
  assert.deepEqual(a.map((q) => q.id), b.map((q) => q.id));
  assert.equal(new Set(a.map((q) => q.id)).size, 10);
});

test('elegir: otra semilla da otra selección', () => {
  const a = T.elegir(Preguntas, 10, 1).map((q) => q.id).join();
  const b = T.elegir(Preguntas, 10, 2).map((q) => q.id).join();
  assert.notEqual(a, b);
});

test('elegir: mezcla dificultades (4 fáciles, 4 medias, 2 difíciles en 10)', () => {
  for (const s of [1, 7, 99, 2026]) {
    const difs = T.elegir(Preguntas, 10, s).map((q) => q.dif);
    assert.equal(difs.filter((d) => d === 1).length, 4);
    assert.equal(difs.filter((d) => d === 2).length, 4);
    assert.equal(difs.filter((d) => d === 3).length, 2);
  }
});

test('elegir: no repite aunque el banco sea chico, y completa con otras dificultades', () => {
  const banco = [
    { id: 'a', dif: 1 }, { id: 'b', dif: 1 }, { id: 'c', dif: 1 }, { id: 'd', dif: 2 }, { id: 'e', dif: 1 },
  ];
  const r = T.elegir(banco, 4, 5);
  assert.equal(r.length, 4);
  assert.equal(new Set(r.map((q) => q.id)).size, 4);
  assert.equal(T.elegir(banco, 10, 5).length, 5, 'si piden más que el banco, devuelve todo el banco una vez');
});

test('elegir: no modifica el banco', () => {
  const antes = Preguntas.map((q) => q.id).join();
  T.elegir(Preguntas, 10, 3);
  assert.equal(Preguntas.map((q) => q.id).join(), antes);
});

test('puntos: 1000 al instante, 500 al límite, 0 si es incorrecta', () => {
  assert.equal(T.puntos(true, 0, 15000), 1000);
  assert.equal(T.puntos(true, 15000, 15000), 500);
  assert.equal(T.puntos(false, 0, 15000), 0);
  assert.equal(T.puntos(false, 15000, 15000), 0);
});

test('puntos: lineal por rapidez, entero, y recortado fuera de rango', () => {
  assert.equal(T.puntos(true, 7500, 15000), 750);
  assert.equal(T.puntos(true, 1, 15000), 1000); // 999.97 → 1000
  assert.equal(T.puntos(true, 20000, 15000), 500);
  assert.equal(T.puntos(true, -50, 15000), 1000);
  assert.ok(Number.isInteger(T.puntos(true, 1234, 15000)));
});

test('ranking: empate 1000/1000/500 → puestos 1, 1, 3', () => {
  const r = T.ranking([{ persona: 'c', puntos: 500 }, { persona: 'a', puntos: 1000 }, { persona: 'b', puntos: 1000 }]);
  assert.deepEqual(r.map((x) => x.puesto), [1, 1, 3]);
  assert.deepEqual(r.map((x) => x.puntos), [1000, 1000, 500]);
  assert.deepEqual(r.map((x) => x.persona).slice(0, 2).sort(), ['a', 'b']);
  assert.equal(r[2].persona, 'c');
});

test('ranking: vacío y uno solo', () => {
  assert.deepEqual(T.ranking([]), []);
  assert.deepEqual(T.ranking([{ persona: 'x', puntos: 0 }]), [{ persona: 'x', puntos: 0, puesto: 1 }]);
});

test('restante: cuenta regresiva con el desfase del reloj del servidor, nunca negativa', () => {
  // el servidor va 2 s adelantado: el cliente ve 10.000 cuando el servidor ya está en 12.000
  assert.equal(T.restante(20000, 10000, 2000), 8000);
  assert.equal(T.restante(20000, 30000, 0), 0);
});

test('preguntas-sql: una fila por pregunta, comillas escapadas y huella estable', () => {
  const G = require('../tools/preguntas-sql.js');
  const s = G.sql([{ id: 'x-001', cat: 'general', dif: 1, p: "¿Qué es 'esto'?", ops: ["l'a", 'b', 'c', 'd'], ok: 2 }]);
  assert.match(s, /\('x-001', 'general', 1, '¿Qué es ''esto''\?', array\['l''a', 'b', 'c', 'd'\], 2\)/);
  assert.match(s, /on conflict \(id\) do update/);
  const todo = G.sql(Preguntas);
  assert.equal((todo.match(/^ {2}\('/gm) || []).length, Preguntas.length);
  assert.equal(G.huella(Preguntas), G.huella(Preguntas.slice().reverse()));
});

test('constantes del juego', () => {
  assert.equal(T.PREGUNTAS_POR_PARTIDA, 10);
  assert.equal(T.PREGUNTA_MS, 15000);
});

test('preguntas-sql: al sacar preguntas del banco no borra las de una partida en juego (M5)', () => {
  const G = require('../tools/preguntas-sql.js');
  const s = G.sql([{ id: 'x-001', cat: 'general', dif: 1, p: 'x', ops: ['a', 'b', 'c', 'd'], ok: 0 }]);
  const borrar = s.split('\n').find((l) => /^delete from public\.trivia_preguntas/.test(l));
  assert.ok(borrar, 'falta el delete');
  assert.match(borrar, /trivia_secretos/);
  assert.match(borrar, /estado = 'jugando'/);
});

test('elegirSinRepetir: primero las que nadie vio, después las vistas hace más tiempo, con las cuotas 4/4/2', () => {
  const banco = [];
  for (const [d, n] of [[1, 6], [2, 6], [3, 3]]) for (let i = 0; i < n; i++) banco.push({ id: d + '-' + i, dif: d });
  // vistas: todas las de dificultad 1 menos dos; de la 3, todas (la 3-2 es la más vieja)
  const vistas = { '1-0': 50, '1-1': 10, '1-2': 40, '1-3': 30, '3-0': 90, '3-1': 80, '3-2': 5 };
  for (const s of [1, 2, 3, 99]) {
    const r = T.elegirSinRepetir(banco, 10, vistas, s);
    const ids = r.map((q) => q.id);
    assert.equal(r.length, 10);
    assert.equal(new Set(ids).size, 10);
    const de = (d) => ids.filter((x) => x.startsWith(d + '-'));
    assert.equal(de(1).length, 4); assert.equal(de(2).length, 4); assert.equal(de(3).length, 2);
    // dificultad 1: las dos sin ver (1-4, 1-5) y las dos vistas hace más tiempo (1-1 a los 10, 1-3 a los 30)
    assert.deepEqual(de(1).sort(), ['1-1', '1-3', '1-4', '1-5']);
    // dificultad 3: todas vistas → las dos más viejas (3-2 y 3-1)
    assert.deepEqual(de(3).sort(), ['3-1', '3-2']);
  }
});

test('elegirSinRepetir: sin historial es como elegir (sin repetir y con cuotas); no modifica el banco', () => {
  const antes = Preguntas.map((q) => q.id).join();
  const r = T.elegirSinRepetir(Preguntas, 10, {}, 7);
  assert.equal(new Set(r.map((q) => q.id)).size, 10);
  assert.equal(Preguntas.map((q) => q.id).join(), antes);
});

test('textoErrorRespuesta: fuera de tiempo o ya revelada → "esta no suma"; "Ya respondiste" no avisa nada (M3)', () => {
  assert.equal(T.GRACIA_MS, 1000);
  assert.equal(T.textoErrorRespuesta('Se terminó el tiempo'), 'Se terminó el tiempo: esta no suma.');
  assert.equal(T.textoErrorRespuesta('No hay una pregunta abierta'), 'Se terminó el tiempo: esta no suma.');
  assert.equal(T.textoErrorRespuesta('Ya respondiste'), null);
  assert.equal(T.textoErrorRespuesta('Failed to fetch'), 'No pudimos mandar tu respuesta. Probá de nuevo.');
  assert.equal(T.textoErrorRespuesta(''), 'No pudimos mandar tu respuesta. Probá de nuevo.');
});

test('textoPuesto: "¡Ganaste!" solo si ganaste solo; empatado en el primero lo dice (M9)', () => {
  const r = T.ranking([{ persona: 'a', puntos: 900 }, { persona: 'b', puntos: 900 }, { persona: 'c', puntos: 100 }]);
  assert.equal(T.textoPuesto(r, 'a'), '¡Empataste el primer puesto!');
  assert.equal(T.textoPuesto(r, 'c'), 'Terminaste 3°.');
  const r2 = T.ranking([{ persona: 'a', puntos: 900 }, { persona: 'b', puntos: 800 }]);
  assert.equal(T.textoPuesto(r2, 'a'), '¡Ganaste!');
  assert.equal(T.textoPuesto(r2, 'b'), 'Terminaste 2°.');
  assert.equal(T.textoPuesto([{ persona: 'a', puntos: 1234, puesto: 1 }], 'a'), 'Hiciste 1.234 puntos.');
  assert.equal(T.textoPuesto(r2, 'z'), null);
});
