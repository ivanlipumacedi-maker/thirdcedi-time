// Tests de la lógica del ajedrez (la misma que valida la Edge Function juegos).
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../vendor/chess.js');
const A = require('../../ajedrez-logica.js');

test('jugar: valida turno y legalidad; devuelve SAN, FEN y jugadas', () => {
  let r = A.jugar([], 'w', { desde: 'e2', hasta: 'e4' });
  assert.equal(r.san, 'e4'); assert.deepEqual(r.jugadas, ['e4']); assert.equal(r.fin, null);
  assert.equal(A.jugar(['e4'], 'w', { desde: 'd2', hasta: 'd4' }).error, 'No es tu turno');
  assert.equal(A.jugar([], 'b', { desde: 'e7', hasta: 'e5' }).error, 'No es tu turno');
  assert.equal(A.jugar([], 'w', { desde: 'e2', hasta: 'e5' }).error, 'Jugada inválida');
  assert.equal(A.jugar([], 'w', { desde: 'z9', hasta: 'e4' }).error, 'Jugada inválida');
  assert.equal(A.jugar([], null, { desde: 'e2', hasta: 'e4' }).error, 'No es tu turno');
  assert.equal(A.jugar(['e4', 'nada'], 'w', { desde: 'd2', hasta: 'd4' }).error, 'La partida guardada no es válida');
});

test('mate del pastor: ganan las blancas y después no se puede jugar más', () => {
  const j = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6'];
  const r = A.jugar(j, 'w', { desde: 'h5', hasta: 'f7' });
  assert.equal(r.san, 'Qxf7#');
  assert.deepEqual(r.fin, { gano: 'blancas', motivo: 'mate' });
  assert.equal(A.jugar(r.jugadas, 'b', { desde: 'a7', hasta: 'a6' }).error, 'La partida terminó');
});

test('coronar: por defecto dama; se puede elegir otra pieza', () => {
  // blancas con peón en a7 listo para coronar
  const j = ['a4', 'h5', 'a5', 'h4', 'a6', 'h3', 'axb7', 'hxg2'];
  assert.equal(A.jugar(j, 'w', { desde: 'b7', hasta: 'a8' }).san, 'bxa8=Q');
  assert.equal(A.jugar(j, 'w', { desde: 'b7', hasta: 'a8', corona: 'n' }).san, 'bxa8=N');
  assert.ok(A.destinos(j, 'b7').some((d) => d.hasta === 'a8' && d.corona));
});

test('ahogado: tablas', () => {
  // la secuencia más corta conocida de ahogado (Sam Loyd, 10 jugadas)
  const j = ['e3', 'a5', 'Qh5', 'Ra6', 'Qxa5', 'h5', 'h4', 'Rah6', 'Qxc7', 'f6', 'Qxd7+', 'Kf7', 'Qxb7', 'Qd3', 'Qxb8', 'Qh7', 'Qxc8', 'Kg6'];
  const r = A.jugar(j, 'w', { desde: 'c8', hasta: 'e6' });
  assert.deepEqual(r.fin, { gano: 'tablas', motivo: 'ahogado' });
});

test('destinos, color y tablero', () => {
  assert.deepEqual(A.destinos([], 'g1').map((d) => d.hasta).sort(), ['f3', 'h3']);
  assert.equal(A.colorDe({ blancas: 'a', negras: 'b' }, 'b'), 'b');
  assert.equal(A.colorDe({ blancas: 'a', negras: 'b' }, 'c'), null);
  const t = A.tablero(A.INICIO);
  assert.deepEqual(t[0][4], { tipo: 'k', color: 'b' }); // e8
  assert.deepEqual(t[7][4], { tipo: 'k', color: 'w' }); // e1
  assert.equal(t[4][4], null);
});

test('las copias de la Edge Function juegos son idénticas a las de la app', () => {
  const fs = require('node:fs'), path = require('node:path');
  for (const f of [['vendor/chess.js', 'chess.js'], ['ajedrez-logica.js', 'ajedrez-logica.js']]) {
    const a = fs.readFileSync(path.join(__dirname, '../..', f[0]), 'utf8');
    const b = fs.readFileSync(path.join(__dirname, '../supabase/juegos', f[1]), 'utf8');
    assert.equal(a.replace(/\r\n/g, '\n'), b.replace(/\r\n/g, '\n'), f[1] + ' distinto: copialo de nuevo');
  }
});
