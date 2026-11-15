// Tests de la lógica del truco (la misma que aplica la Edge Function juegos).
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../truco-logica.js');

// rnd fijo (para repartir siempre igual) y un armado con las cartas que queremos
function semilla(s) { let x = s; return () => { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; }; }
function armar(manos, opc = {}) {
  const n = manos.length;
  const S = T.nuevo({ jugadores: manos.map((_, i) => 'j' + i), a: opc.a || 30, flor: !!opc.flor }, semilla(1));
  S.mano = opc.mano || 0; S.turno = S.mano; S.primero = S.mano;
  S.cartas = {}; S.inicio = {};
  manos.forEach((m, i) => { S.cartas[i] = m.slice(); S.inicio[i] = m.slice(); });
  S.flor = { con: opc.flor ? manos.map((m, i) => (T.tieneFlor(m) ? i : -1)).filter((i) => i >= 0) : [], resultado: null };
  S.envido = { estado: S.flor.con.length ? 'cerrado' : 'libre', cantos: [], equipo: null, resultado: null };
  return S;
}
const r = semilla(7);
const hacer = (S, a, acc) => { const x = T.aplicar(S, a, acc, r); if (x.error) throw new Error(x.error); return x.S; };

test('mazo: 40 cartas, sin 8 ni 9; jerarquía del truco', () => {
  assert.equal(T.MAZO.length, 40);
  assert.ok(!T.MAZO.some((c) => /^[89]/.test(c)));
  const orden = ['1e', '1b', '7e', '7o', '3c', '2c', '1c', '12o', '11o', '10o', '7c', '6o', '5o', '4o'];
  for (let i = 0; i < orden.length - 1; i++) assert.ok(T.valorTruco(orden[i]) > T.valorTruco(orden[i + 1]), orden[i] + ' > ' + orden[i + 1]);
  assert.equal(T.valorTruco('1c'), T.valorTruco('1o'));
  assert.equal(T.valorTruco('7c'), T.valorTruco('7b'));
});

test('envido y flor', () => {
  assert.equal(T.envidoDe(['7e', '6e', '1b']), 33);
  assert.equal(T.envidoDe(['12o', '11o', '4c']), 20);
  assert.equal(T.envidoDe(['7o', '5c', '12b']), 7);
  assert.equal(T.envidoDe(['10o', '11c', '12b']), 0);
  assert.equal(T.tieneFlor(['1e', '7e', '3e']), true);
  assert.equal(T.florDe(['1e', '7e', '3e']), 31);
});

test('repartir: 3 cartas a cada uno, sin repetir; el mano empieza', () => {
  const S = T.nuevo({ jugadores: ['a', 'b', 'c', 'd'], a: 15 }, semilla(3));
  const todas = Object.values(S.cartas).flat();
  assert.equal(todas.length, 12);
  assert.equal(new Set(todas).size, 12);
  assert.equal(S.turno, S.mano);
  assert.deepEqual(S.config.equipo, [0, 1, 0, 1]);
  assert.throws(() => T.nuevo({ jugadores: ['a', 'b', 'c'] }, semilla(1)));
});

test('1v1: gana la mano el que gana 2 bazas; suma 1 sin truco; el mano pasa al otro', () => {
  let S = armar([['1e', '4c', '5c'], ['7e', '6o', '4o']]);
  S = hacer(S, 0, { tipo: 'jugar', carta: '1e' });
  assert.equal(T.aplicar(S, 0, { tipo: 'jugar', carta: '4c' }, r).error, 'No es tu turno');
  S = hacer(S, 1, { tipo: 'jugar', carta: '7e' }); // gana j0
  assert.equal(S.turno, 0);
  S = hacer(S, 0, { tipo: 'jugar', carta: '5c' });
  S = hacer(S, 1, { tipo: 'jugar', carta: '4o' }); // 5 > 4: gana j0 otra vez
  assert.deepEqual(S.puntos, [1, 0]);
  assert.equal(S.mano, 1);
  assert.equal(S.n_mano, 2);
});

test('parda en la primera: define la segunda', () => {
  let S = armar([['3e', '1e', '4c'], ['3o', '5c', '4o']]);
  S = hacer(S, 0, { tipo: 'jugar', carta: '3e' });
  S = hacer(S, 1, { tipo: 'jugar', carta: '3o' }); // parda
  assert.equal(S.ganadas[0], 'parda');
  assert.equal(S.turno, 0, 'la parda la vuelve a empezar quien empezó');
  S = hacer(S, 0, { tipo: 'jugar', carta: '4c' });
  S = hacer(S, 1, { tipo: 'jugar', carta: '5c' }); // gana j1 la segunda → mano para j1
  assert.deepEqual(S.puntos, [0, 1]);
});

test('ganó la primera y después parda: gana el de la primera', () => {
  const S = armar([['1e', '1e', '1e'], ['1e', '1e', '1e']]);
  S.ganadas = [1, 'parda']; assert.equal(T.ganadorMano(S), 1);
  S.ganadas = [0, 1, 'parda']; assert.equal(T.ganadorMano(S), 0);
  S.ganadas = ['parda', 'parda', 'parda']; assert.equal(T.ganadorMano(S), 0, 'todo parda: el mano (j0)');
  S.ganadas = [0, 1]; assert.equal(T.ganadorMano(S), null);
});

test('truco: quiero → la mano vale 2; retruco lo canta solo el que aceptó; no quiero → lo anterior', () => {
  let S = armar([['1e', '1b', '7e'], ['4c', '5c', '6c']]);
  S = hacer(S, 0, { tipo: 'cantar', canto: 'truco' });
  assert.equal(T.aplicar(S, 0, { tipo: 'jugar', carta: '1e' }, r).error, 'No podés jugar esa carta ahora');
  assert.equal(T.aplicar(S, 0, { tipo: 'quiero' }, r).error, 'No hay nada para contestar');
  S = hacer(S, 1, { tipo: 'quiero' });
  assert.equal(S.truco.querido, 1);
  assert.ok(!T.opciones(S, 0).cantos.includes('retruco'), 'el que cantó no puede subir');
  S = hacer(S, 0, { tipo: 'jugar', carta: '1e' });
  assert.ok(T.opciones(S, 1).cantos.includes('retruco'), 'el que aceptó puede subir en su turno');
  S = hacer(S, 1, { tipo: 'cantar', canto: 'retruco' });
  S = hacer(S, 0, { tipo: 'no_quiero' });
  assert.deepEqual(S.puntos, [0, 2], 'no quiero el retruco: 2 para el que lo cantó');
});

test('quiero retruco de una (contestando el truco) y la mano vale 3', () => {
  let S = armar([['4c', '5c', '6c'], ['1e', '1b', '7e']]);
  S = hacer(S, 0, { tipo: 'cantar', canto: 'truco' });
  S = hacer(S, 1, { tipo: 'cantar', canto: 'retruco' });
  S = hacer(S, 0, { tipo: 'quiero' });
  for (const [a, c] of [[0, '4c'], [1, '1e'], [1, '1b'], [0, '5c']]) S = hacer(S, a, { tipo: 'jugar', carta: c });
  assert.deepEqual(S.puntos, [0, 3]);
});

test('envido: quiero → gana el mejor tanto (empate: el mano); no quiero → 1', () => {
  let S = armar([['7e', '6e', '4c'], ['7o', '6o', '4b']]); // 33 vs 33: gana el mano (j0)
  S = hacer(S, 0, { tipo: 'cantar', canto: 'envido' });
  assert.equal(T.aplicar(S, 0, { tipo: 'jugar', carta: '4c' }, r).error, 'No podés jugar esa carta ahora');
  S = hacer(S, 1, { tipo: 'quiero' });
  assert.deepEqual(S.puntos, [2, 0]);
  assert.equal(S.envido.resultado.equipo, 0);
  assert.ok(!T.opciones(S, 0).cantos.includes('envido'), 'el envido ya se jugó');
  let S2 = armar([['7e', '6e', '4c'], ['1o', '2b', '4b']]);
  S2 = hacer(S2, 0, { tipo: 'cantar', canto: 'envido' });
  S2 = hacer(S2, 1, { tipo: 'no_quiero' });
  assert.deepEqual(S2.puntos, [1, 0]);
});

test('envido envido real envido: querido 7; no querido 4', () => {
  let S = armar([['7e', '6e', '4c'], ['1o', '2b', '4b']]);
  S = hacer(S, 0, { tipo: 'cantar', canto: 'envido' });
  S = hacer(S, 1, { tipo: 'cantar', canto: 'envido' });
  S = hacer(S, 0, { tipo: 'cantar', canto: 'real' });
  assert.deepEqual(T.valoresEnvido(S), { quiero: 7, noQuiero: 4 });
  const S1 = hacer(JSON.parse(JSON.stringify(S)), 1, { tipo: 'no_quiero' });
  assert.deepEqual(S1.puntos, [4, 0]);
  const S2 = hacer(S, 1, { tipo: 'quiero' });
  assert.deepEqual(S2.puntos, [7, 0]);
});

test('falta envido: lo que le falta al que va adelante para ganar', () => {
  let S = armar([['7e', '6e', '4c'], ['1o', '2b', '4b']], { a: 15 });
  S.puntos = [3, 10];
  S = hacer(S, 0, { tipo: 'cantar', canto: 'falta' });
  S = hacer(S, 1, { tipo: 'quiero' });
  assert.deepEqual(S.puntos, [8, 10]);
});

test('el envido está primero: con el truco cantado, el otro puede cantar envido antes de contestar', () => {
  let S = armar([['7e', '6e', '4c'], ['1o', '2b', '4b']]);
  S = hacer(S, 0, { tipo: 'cantar', canto: 'truco' });
  S = hacer(S, 1, { tipo: 'cantar', canto: 'envido' });
  S = hacer(S, 0, { tipo: 'quiero' }); // envido: gana j0 (33)
  assert.deepEqual(S.puntos, [2, 0]);
  assert.ok(T.opciones(S, 1).responder, 'sigue pendiente el truco para j1');
  S = hacer(S, 1, { tipo: 'no_quiero' });
  assert.deepEqual(S.puntos, [3, 0]);
});

test('flor: se anota sola y no hay envido; con flor de los dos lados, contraflor de 6', () => {
  let S = armar([['1e', '7e', '3e'], ['4c', '5o', '6b']], { flor: true });
  assert.ok(!T.opciones(S, 0).cantos.includes('envido'));
  S = hacer(S, 0, { tipo: 'jugar', carta: '1e' });
  S = hacer(S, 1, { tipo: 'jugar', carta: '4c' });
  assert.deepEqual(S.puntos, [3, 0]);
  let S2 = armar([['1e', '7e', '3e'], ['1o', '7o', '6o']], { flor: true }); // 31 contra 34
  S2 = hacer(S2, 0, { tipo: 'jugar', carta: '1e' });
  S2 = hacer(S2, 1, { tipo: 'jugar', carta: '1o' });
  assert.deepEqual(S2.puntos, [0, 6]);
});

test('mazo: la otra pareja se lleva lo que valía', () => {
  let S = armar([['4c', '5c', '6c'], ['1e', '1b', '7e']]);
  S = hacer(S, 0, { tipo: 'mazo' });
  assert.deepEqual(S.puntos, [0, 1]);
  let S2 = armar([['4c', '5c', '6c'], ['1e', '1b', '7e']]);
  S2 = hacer(S2, 0, { tipo: 'cantar', canto: 'truco' });
  S2 = hacer(S2, 1, { tipo: 'quiero' });
  S2 = hacer(S2, 0, { tipo: 'mazo' });
  assert.deepEqual(S2.puntos, [0, 2]);
});

test('2v2: parejas cruzadas, la baza la gana la pareja de la carta más alta', () => {
  let S = armar([['4c', '5c', '6c'], ['4o', '5o', '6o'], ['1e', '5b', '6b'], ['4b', '7c', '12c']]);
  assert.deepEqual(S.config.equipo, [0, 1, 0, 1]);
  for (const [a, c] of [[0, '4c'], [1, '4o'], [2, '1e'], [3, '4b']]) S = hacer(S, a, { tipo: 'jugar', carta: c });
  assert.equal(S.ganadas[0], 0);
  assert.equal(S.turno, 2, 'empieza la siguiente el que ganó');
});

test('a 15: el que llega gana la partida y quedan los ganadores', () => {
  let S = armar([['1e', '1b', '7e'], ['4c', '5c', '6c']], { a: 15 });
  S.puntos = [14, 3];
  S = hacer(S, 0, { tipo: 'jugar', carta: '1e' });
  S = hacer(S, 1, { tipo: 'jugar', carta: '4c' });
  S = hacer(S, 0, { tipo: 'jugar', carta: '1b' });
  S = hacer(S, 1, { tipo: 'jugar', carta: '5c' });
  assert.equal(S.fase, 'final');
  assert.deepEqual(S.ganadores, ['j0']);
  assert.equal(T.aplicar(S, 1, { tipo: 'mazo' }, r).error, 'La partida terminó');
});

test('lo público no tiene las cartas de nadie', () => {
  const S = T.nuevo({ jugadores: ['a', 'b'], a: 30 }, semilla(9));
  const P = T.publico(S);
  assert.equal(P.cartas, undefined);
  assert.equal(P.inicio, undefined);
  assert.deepEqual(P.n_cartas, { 0: 3, 1: 3 });
  const txt = JSON.stringify(P);
  for (const c of Object.values(S.cartas).flat()) assert.ok(!txt.includes('"' + c + '"'), 'se ve la carta ' + c);
});

test('la copia de la Edge Function juegos es idéntica', () => {
  const fs = require('node:fs'), path = require('node:path');
  const a = fs.readFileSync(path.join(__dirname, '../../truco-logica.js'), 'utf8').replace(/\r\n/g, '\n');
  const b = fs.readFileSync(path.join(__dirname, '../supabase/juegos/truco-logica.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(a, b, 'truco-logica.js distinto: copialo de nuevo a dev/supabase/juegos/');
});
