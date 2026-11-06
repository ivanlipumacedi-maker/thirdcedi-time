const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../../actividades-logica.js');

const base = () => ({
  tipo: 'padel', titulo: 'Pádel del jueves', fecha: '2026-12-10T22:00:00Z', lugar: 'Club Norte',
  cupo: 4, tiene_tercer: false,
});

test('TIPOS tiene los seis tipos con emoji', () => {
  assert.deepEqual(A.TIPOS.map((t) => t.id), ['futbol', 'padel', 'trekking', 'asado', 'after', 'otra']);
  A.TIPOS.forEach((t) => { assert.ok(t.nombre && t.emoji); });
});

test('validar acepta una actividad correcta', () => {
  assert.equal(A.validar(base()), null);
});

test('validar rechaza título vacío', () => {
  assert.match(A.validar({ ...base(), titulo: '   ' }), /título/i);
});

test('validar rechaza tipo otra sin tipo_otro', () => {
  assert.match(A.validar({ ...base(), tipo: 'otra', tipo_otro: ' ' }), /actividad/i);
  assert.equal(A.validar({ ...base(), tipo: 'otra', tipo_otro: 'Karaoke' }), null);
});

test('validar rechaza tipo inexistente, fecha inválida y lugar vacío', () => {
  assert.ok(A.validar({ ...base(), tipo: 'ajedrez' }));
  assert.ok(A.validar({ ...base(), fecha: 'mañana' }));
  assert.ok(A.validar({ ...base(), lugar: '' }));
});

test('validar rechaza tiene_tercer sin tercer_lugar', () => {
  assert.match(A.validar({ ...base(), tiene_tercer: true, tercer_fecha: '2026-12-10T23:30:00Z' }), /tercer tiempo/i);
});

test('validar rechaza tercer_fecha anterior a fecha', () => {
  const a = { ...base(), tiene_tercer: true, tercer_lugar: 'Bar de la esquina', tercer_fecha: '2026-12-10T21:00:00Z' };
  assert.match(A.validar(a), /tercer tiempo/i);
  assert.equal(A.validar({ ...a, tercer_fecha: '2026-12-10T23:30:00Z' }), null);
});

test('validar rechaza cupo no entero o menor a 1; cupo vacío es sin límite', () => {
  assert.ok(A.validar({ ...base(), cupo: 0 }));
  assert.ok(A.validar({ ...base(), cupo: 2.5 }));
  assert.equal(A.validar({ ...base(), cupo: null }), null);
});

test('cupoLleno cuenta solo la parte actividad', () => {
  const a = { id: 'x', cupo: 4 };
  const mk = (n, parte) => Array.from({ length: n }, (_, i) => ({ actividad: 'x', persona: parte + i, parte }));
  
  assert.equal(A.cupoLleno(a, mk(4, 'actividad')), true);
  assert.equal(A.cupoLleno(a, mk(3, 'actividad').concat(mk(5, 'tercer'))), false);
  assert.equal(A.cupoLleno({ id: 'x', cupo: null }, mk(50, 'actividad')), false);
  assert.equal(A.cupoLleno(a, mk(4, 'actividad').map((s) => ({ ...s, actividad: 'otra' }))), false);
});

test('participantes devuelve la unión sin repetidos cuando no se pide parte', () => {
  const s = [
    { actividad: 'x', persona: 'p1', parte: 'actividad' },
    { actividad: 'x', persona: 'p1', parte: 'tercer' },
    { actividad: 'x', persona: 'p2', parte: 'tercer' },
    { actividad: 'y', persona: 'p3', parte: 'actividad' },
  ];
  assert.deepEqual(A.participantes('x', s, undefined).sort(), ['p1', 'p2']);
  assert.deepEqual(A.participantes('x', s, 'actividad'), ['p1']);
  assert.deepEqual(A.participantes('x', s, 'tercer').sort(), ['p1', 'p2']);
});

test('esFutura usa tercer_fecha si es posterior a fecha', () => {
  const ahora = Date.parse('2026-12-10T23:00:00Z');
  const a = { fecha: '2026-12-10T22:00:00Z', tiene_tercer: false };
  assert.equal(A.esFutura(a, ahora), false);
  assert.equal(A.esFutura({ ...a, tiene_tercer: true, tercer_fecha: '2026-12-11T01:00:00Z' }, ahora), true);
  assert.equal(A.esFutura({ ...a, tiene_tercer: true, tercer_fecha: '2026-12-10T21:00:00Z' }, ahora), false);
  assert.equal(A.esFutura({ fecha: '2026-12-11T00:00:00Z' }, ahora), true);
});

test('fechas: lo que se escribe en el formulario es hora de Argentina (UTC-3)', () => {
  assert.equal(A.desdeInputArg('2026-12-10T19:30'), '2026-12-10T22:30:00.000Z');
  assert.equal(A.aInputArg('2026-12-10T22:30:00Z'), '2026-12-10T19:30');
  assert.equal(A.aInputArg('2026-12-11T01:15:00Z'), '2026-12-10T22:15');
  assert.equal(A.desdeInputArg(''), null);
  assert.equal(A.aInputArg(null), '');
});
