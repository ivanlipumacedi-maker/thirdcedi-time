const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../../impostor-logica.js');

const J4 = ['a1', 'b2', 'c3', 'd4'];
const PAR = { palabra: 'Mate', impostor: 'Tereré' };

test('repartir con 4 jugadores: exactamente 1 tiene la palabra del impostor', () => {
  const r = I.repartir(J4, PAR, 42);
  assert.ok(J4.includes(r.impostor));
  assert.equal(r.palabras.size, 4);
  const conImpostor = [...r.palabras.entries()].filter(([, w]) => w === 'Tereré');
  assert.equal(conImpostor.length, 1);
  assert.equal(conImpostor[0][0], r.impostor);
  assert.equal([...r.palabras.values()].filter((w) => w === 'Mate').length, 3);
});

test('repartir: misma semilla, mismo impostor; con varias semillas le toca a más de uno', () => {
  assert.equal(I.repartir(J4, PAR, 7).impostor, I.repartir(J4, PAR, 7).impostor);
  const vistos = new Set();
  for (let s = 1; s <= 40; s++) vistos.add(I.repartir(J4, PAR, s).impostor);
  assert.ok(vistos.size >= 3, 'siempre al mismo: ' + [...vistos]);
});

test('repartir no modifica la lista de jugadores', () => {
  const js = J4.slice();
  I.repartir(js, PAR, 3);
  assert.deepEqual(js, J4);
});

test('resultado: mayoría al impostor → lo expulsan y gana el grupo', () => {
  const votos = new Map([['a1', 'c3'], ['b2', 'c3'], ['c3', 'a1'], ['d4', 'c3']]);
  assert.deepEqual(I.resultado(votos, 'c3'), { expulsado: 'c3', ganoGrupo: true });
});

test('resultado: mayoría a otro → expulsan a un inocente y gana el impostor', () => {
  const votos = new Map([['a1', 'b2'], ['b2', 'a1'], ['c3', 'b2'], ['d4', 'b2']]);
  assert.deepEqual(I.resultado(votos, 'c3'), { expulsado: 'b2', ganoGrupo: false });
});

test('resultado: empate → nadie expulsado, gana el impostor', () => {
  const votos = new Map([['a1', 'c3'], ['b2', 'c3'], ['c3', 'a1'], ['d4', 'a1']]);
  assert.deepEqual(I.resultado(votos, 'c3'), { expulsado: null, ganoGrupo: false });
});

test('resultado: sin votos → nadie expulsado, gana el impostor', () => {
  assert.deepEqual(I.resultado(new Map(), 'c3'), { expulsado: null, ganoGrupo: false });
});

test('conteo: votos por persona', () => {
  const votos = new Map([['a1', 'c3'], ['b2', 'c3'], ['c3', 'a1']]);
  assert.deepEqual(I.conteo(votos), { c3: 2, a1: 1 });
});

// Review Focus 5: alguien abandona a la mitad → la partida no se traba.
test('sigue: si se va el impostor → gana el grupo', () => {
  assert.equal(I.sigue(['a1', 'b2', 'd4'], 'c3'), 'gana_grupo');
});

test('sigue: si quedan 2 activos con el impostor → gana el impostor', () => {
  assert.equal(I.sigue(['a1', 'c3'], 'c3'), 'gana_impostor');
});

test('sigue: se va un inocente y quedan 3 con el impostor → sigue', () => {
  assert.equal(I.sigue(['a1', 'b2', 'c3'], 'c3'), 'sigue');
});

test('sigue: no queda nadie → gana el grupo (el impostor tampoco está)', () => {
  assert.equal(I.sigue([], 'c3'), 'gana_grupo');
});

test('restante: nunca negativo y con el desfase del servidor', () => {
  assert.equal(I.restante(10000, 4000, 1000), 5000);
  assert.equal(I.restante(10000, 12000, 0), 0);
});
