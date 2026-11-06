// Tests de la lógica pura de Cuentas claras: reparto, saldos, transferencias, montos y validación.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../cuentas-logica.js');

const NB = ' '; // "$ 3.200" lleva un espacio que no corta línea
const suma = (m) => [...m.values()].reduce((s, x) => s + x, 0);
const g1 = [{ id: 'g1', pagador: 'A', monto: 1000 }];
const p1 = [{ gasto: 'g1', persona: 'A' }, { gasto: 'g1', persona: 'B' }, { gasto: 'g1', persona: 'C' }];

test('repartir: 1000 entre 3 da 334/333/333 y el peso que sobra va al primero por id ordenado', () => {
  assert.deepEqual(Object.fromEntries(C.repartir(1000, ['C', 'A', 'B'])), { A: 334, B: 333, C: 333 });
});

test('repartir: el resto se reparte de a un peso entre los primeros (1001 entre 3 → 334/334/333)', () => {
  assert.deepEqual(Object.fromEntries(C.repartir(1001, ['B', 'C', 'A'])), { A: 334, B: 334, C: 333 });
});

test('repartir: exacto, uno solo y personas repetidas', () => {
  assert.deepEqual(Object.fromEntries(C.repartir(900, ['A', 'B', 'C'])), { A: 300, B: 300, C: 300 });
  assert.deepEqual(Object.fromEntries(C.repartir(777, ['Z'])), { Z: 777 });
  assert.deepEqual(Object.fromEntries(C.repartir(10, ['A', 'A', 'B'])), { A: 5, B: 5 });
  assert.equal(C.repartir(10, []).size, 0);
});

test('saldos: A paga 1000 entre A, B y C → A:+666, B:-333, C:-333 (plan)', () => {
  assert.deepEqual(Object.fromEntries(C.saldos(g1, p1, [])), { A: 666, B: -333, C: -333 });
});

test('Review Focus 2: los saldos suman exactamente 0 con montos que no dividen exacto', () => {
  for (const monto of [1, 2, 999, 1000, 1001, 3200, 99999, 100000000]) {
    for (let n = 1; n <= 7; n++) {
      const personas = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].slice(0, n);
      const s = C.saldos([{ id: 'g', pagador: 'p3', monto }], personas.map((p) => ({ gasto: 'g', persona: p })), []);
      assert.equal(suma(s), 0, monto + ' entre ' + n);
      // nadie pierde un peso: lo que se reparte es exactamente el monto
      assert.equal([...C.repartir(monto, personas).values()].reduce((a, b) => a + b, 0), monto);
    }
  }
});

test('saldos: varios gastos y pagos, la suma sigue en 0', () => {
  const gastos = [{ id: 'g1', pagador: 'A', monto: 1000 }, { id: 'g2', pagador: 'B', monto: 2501 }, { id: 'g3', pagador: 'C', monto: 7 }];
  const partes = [
    ...['A', 'B', 'C'].map((p) => ({ gasto: 'g1', persona: p })),
    ...['A', 'B', 'C', 'D'].map((p) => ({ gasto: 'g2', persona: p })),
    ...['B', 'D'].map((p) => ({ gasto: 'g3', persona: p })),
  ];
  const s = C.saldos(gastos, partes, [{ de: 'D', a: 'B', monto: 300 }]);
  assert.equal(suma(s), 0);
});

test('saldos: un pago registrado B→A 333 deja a B en 0', () => {
  const s = C.saldos(g1, p1, [{ de: 'B', a: 'A', monto: 333 }]);
  assert.deepEqual(Object.fromEntries(s), { A: 333, B: 0, C: -333 });
});

test('saldos: un gasto sin personas no mueve nada (no rompe la suma)', () => {
  const s = C.saldos([{ id: 'g9', pagador: 'A', monto: 500 }], [], []);
  assert.equal(suma(s), 0);
  assert.equal(s.get('A') || 0, 0);
});

test('Review Focus 3: quien está en gasto_partes pero ya no está anotado sigue con su saldo', () => {
  // las asistencias no entran en el cálculo: C se bajó (ya no hay fila suya) y su deuda sigue
  const asistencias = [{ persona: 'A' }, { persona: 'B' }];
  assert.equal(asistencias.some((x) => x.persona === 'C'), false);
  const s = C.saldos(g1, p1, []);
  assert.equal(s.get('C'), -333);
  assert.deepEqual(C.transferencias(s).find((t) => t.de === 'C'), { de: 'C', a: 'A', monto: 333 });
});

test('transferencias: deudores mayores primero contra acreedores mayores (plan)', () => {
  assert.deepEqual(C.transferencias(new Map([['A', 666], ['B', -333], ['C', -333]])),
    [{ de: 'B', a: 'A', monto: 333 }, { de: 'C', a: 'A', monto: 333 }]);
});

test('transferencias: greedy con varios acreedores, sin ceros, y salda todo', () => {
  const s = new Map([['A', 500], ['B', 200], ['C', -400], ['D', -300], ['E', 0]]);
  const t = C.transferencias(s);
  assert.deepEqual(t, [{ de: 'C', a: 'A', monto: 400 }, { de: 'D', a: 'A', monto: 100 }, { de: 'D', a: 'B', monto: 200 }]);
  const resto = new Map(s);
  t.forEach(({ de, a, monto }) => { resto.set(de, resto.get(de) + monto); resto.set(a, resto.get(a) - monto); });
  assert.ok([...resto.values()].every((x) => x === 0));
  assert.deepEqual(C.transferencias(new Map([['A', 0]])), []);
  assert.deepEqual(C.transferencias(new Map()), []);
});

test('transferencias: con montos iguales desempata por id (siempre el mismo orden)', () => {
  const a = C.transferencias(new Map([['Y', 100], ['X', 100], ['Q', -100], ['P', -100]]));
  assert.deepEqual(a, [{ de: 'P', a: 'X', monto: 100 }, { de: 'Q', a: 'Y', monto: 100 }]);
});

test('pesos: formato argentino con separador de miles', () => {
  assert.equal(C.pesos(3200), '$' + NB + '3.200');
  assert.equal(C.pesos(0), '$' + NB + '0');
  assert.equal(C.pesos(1234567), '$' + NB + '1.234.567');
  assert.equal(C.pesos(-500), '$' + NB + '500'); // el signo lo dice el texto ("Debés")
});

test('leerMonto: acepta enteros con o sin $ y puntos de miles; rechaza decimales, cero y basura', () => {
  assert.equal(C.leerMonto('3200'), 3200);
  assert.equal(C.leerMonto(' $ 3.200 '), 3200);
  assert.equal(C.leerMonto('1.000.000'), 1000000);
  for (const malo of ['', '  ', '0', '-5', '12,50', '12.5', '1.00', 'abc', '3e3', '1.2.3', null, undefined, '100000001']) {
    assert.equal(C.leerMonto(malo), null, JSON.stringify(malo));
  }
  assert.equal(C.leerMonto('100.000.000'), 100000000);
});

test('validarGasto: devuelve el motivo en español o null', () => {
  const ok = { monto: 1000, concepto: 'Cancha', pagador: 'A', personas: ['A', 'B'] };
  assert.equal(C.validarGasto(ok), null);
  assert.match(C.validarGasto({ ...ok, monto: null }), /monto/i);
  assert.match(C.validarGasto({ ...ok, monto: 0 }), /monto/i);
  assert.match(C.validarGasto({ ...ok, monto: 10.5 }), /monto/i);
  assert.match(C.validarGasto({ ...ok, concepto: '   ' }), /qué fue/i);
  assert.match(C.validarGasto({ ...ok, concepto: 'x'.repeat(81) }), /80/);
  assert.match(C.validarGasto({ ...ok, pagador: '' }), /quién pagó/i);
  assert.match(C.validarGasto({ ...ok, personas: [] }), /entre quiénes/i);
});

test('resumen: te deben / debés / al día', () => {
  const s = new Map([['A', 666], ['B', -333], ['C', 0]]);
  assert.deepEqual(C.resumen(s, 'A'), { tipo: 'te-deben', monto: 666, texto: 'Te deben $' + NB + '666' });
  assert.deepEqual(C.resumen(s, 'B'), { tipo: 'debes', monto: 333, texto: 'Debés $' + NB + '333' });
  assert.deepEqual(C.resumen(s, 'C'), { tipo: 'al-dia', monto: 0, texto: 'Estás al día' });
  assert.deepEqual(C.resumen(s, 'Z'), { tipo: 'al-dia', monto: 0, texto: 'Estás al día' });
});

test('dePart: filtra gastos, partes y pagos de una parte', () => {
  const gastos = [{ id: 'g1', parte: 'actividad', pagador: 'A', monto: 100 }, { id: 'g2', parte: 'tercer', pagador: 'B', monto: 50 }];
  const partes = [{ gasto: 'g1', persona: 'A' }, { gasto: 'g2', persona: 'B' }, { gasto: 'g2', persona: 'A' }];
  const pagos = [{ parte: 'tercer', de: 'A', a: 'B', monto: 25 }, { parte: 'actividad', de: 'B', a: 'A', monto: 1 }];
  const t = C.deParte('tercer', gastos, partes, pagos);
  assert.deepEqual(t.gastos.map((x) => x.id), ['g2']);
  assert.equal(t.partes.length, 2);
  assert.equal(t.pagos.length, 1);
  assert.deepEqual(Object.fromEntries(C.saldos(t.gastos, t.partes, t.pagos)), { A: 0, B: 0 });
});
