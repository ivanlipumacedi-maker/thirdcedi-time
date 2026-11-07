const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../../actividades-logica.js');

const base = () => ({
  tipo: 'padel', titulo: 'Pádel del jueves', fecha: '2026-12-10T22:00:00Z', lugar: 'Club Norte',
  cupo: 4, tiene_tercer: false,
});

test('TIPOS tiene los seis tipos con ícono y nombre corto, sin emojis', () => {
  assert.deepEqual(A.TIPOS.map((t) => t.id), ['futbol', 'padel', 'trekking', 'asado', 'after', 'otra']);
  A.TIPOS.forEach((t) => {
    assert.ok(t.nombre && t.corto && t.icono);
    assert.doesNotMatch(t.nombre + t.corto, /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
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

test('fechas: lo que se escribe en el formulario es hora de Argentina (hoy UTC-3)', () => {
  assert.equal(A.desdeInputArg('2026-12-10T19:30'), '2026-12-10T22:30:00.000Z');
  assert.equal(A.aInputArg('2026-12-10T22:30:00Z'), '2026-12-10T19:30');
  assert.equal(A.aInputArg('2026-12-11T01:15:00Z'), '2026-12-10T22:15');
  assert.equal(A.desdeInputArg(''), null);
  assert.equal(A.aInputArg(null), '');
});

test('TIPOS: nombres visibles como dice el spec', () => {
  assert.deepEqual(A.TIPOS.map((t) => t.nombre), ['Fútbol', 'Pádel', 'Trekking', 'Asado', 'After office', 'Otra']);
});

test('offsetMs calcula el desfase con Intl para la zona (no un UTC-3 fijo)', () => {
  const h = 3600e3;
  assert.equal(A.ZONA, 'America/Argentina/Buenos_Aires');
  assert.equal(A.offsetMs(Date.parse('2026-12-10T22:30:00Z')), -3 * h);
  // Argentina tuvo horario de verano en 2008-2009 (UTC-2): con un offset fijo esto daría mal
  assert.equal(A.offsetMs(Date.parse('2009-01-15T12:00:00Z')), -2 * h);
  // otra zona con horario de verano: Nueva York es UTC-5 en invierno y UTC-4 en verano
  assert.equal(A.offsetMs(Date.parse('2026-01-15T12:00:00Z'), 'America/New_York'), -5 * h);
  assert.equal(A.offsetMs(Date.parse('2026-07-15T12:00:00Z'), 'America/New_York'), -4 * h);
});

test('fechas: ida y vuelta con el offset de la fecha (horario de verano incluido)', () => {
  assert.equal(A.desdeInputArg('2009-01-15T12:00'), '2009-01-15T14:00:00.000Z');
  assert.equal(A.aInputArg('2009-01-15T14:00:00Z'), '2009-01-15T12:00');
  assert.equal(A.desdeInputArg('2026-07-15T08:00', 'America/New_York'), '2026-07-15T12:00:00.000Z');
  assert.equal(A.desdeInputArg('2026-01-15T08:00', 'America/New_York'), '2026-01-15T13:00:00.000Z');
  assert.equal(A.aInputArg('2026-07-15T12:00:00Z', 'America/New_York'), '2026-07-15T08:00');
  // justo después del cambio de hora (Nueva York, 8 de marzo de 2026 a las 2:00 pasa a 3:00)
  assert.equal(A.desdeInputArg('2026-03-08T03:30', 'America/New_York'), '2026-03-08T07:30:00.000Z');
  assert.equal(A.desdeInputArg('2026-03-08T01:30', 'America/New_York'), '2026-03-08T06:30:00.000Z');
});

test('fechas: una hora que no existe (hueco del cambio de horario) se toma con el desfase de después del salto', () => {
  // Nueva York, 8 de marzo de 2026: de 1:59:59 EST pasa a 3:00 EDT, así que 02:30 no existe.
  // Se interpreta 02:30 con el desfase de verano (UTC-4): 06:30Z, que en la pared se lee 01:30 (EST).
  // Argentina hoy no tiene horario de verano: esto solo importaría si volviera a tenerlo.
  assert.equal(A.desdeInputArg('2026-03-08T02:30', 'America/New_York'), '2026-03-08T06:30:00.000Z');
  assert.equal(A.aInputArg('2026-03-08T06:30:00.000Z', 'America/New_York'), '2026-03-08T01:30');
});

test('anotadosQueSeQuitan: cuántos del tercer tiempo se pierden al apagarlo', () => {
  const s = [
    { actividad: 'x', persona: 'p1', parte: 'actividad' },
    { actividad: 'x', persona: 'p1', parte: 'tercer' },
    { actividad: 'x', persona: 'p2', parte: 'tercer' },
    { actividad: 'y', persona: 'p3', parte: 'tercer' },
  ];
  const a = { id: 'x', tiene_tercer: true };
  assert.equal(A.anotadosQueSeQuitan(a, { tiene_tercer: false }, s), 2);
  assert.equal(A.anotadosQueSeQuitan(a, { tiene_tercer: true }, s), 0);
  assert.equal(A.anotadosQueSeQuitan({ id: 'x', tiene_tercer: false }, { tiene_tercer: false }, s), 0);
  assert.equal(A.anotadosQueSeQuitan(null, { tiene_tercer: false }, s), 0, 'una actividad nueva no quita a nadie');
  assert.equal(A.anotadosQueSeQuitan({ id: 'z', tiene_tercer: true }, { tiene_tercer: false }, s), 0);
});

test('editable: una actividad cancelada no se edita', () => {
  assert.equal(A.editable({ estado: 'abierta' }), true);
  assert.equal(A.editable({ estado: 'confirmada' }), true);
  assert.equal(A.editable({ estado: 'cancelada' }), false);
  assert.equal(A.editable(null), false);
});

test('reactivable: solo el creador, solo cancelada y solo si todavía no pasó la fecha de la actividad', () => {
  const ahora = Date.parse('2026-12-10T23:00:00Z');
  const c = { creador: 'yo', estado: 'cancelada', fecha: '2026-12-11T22:00:00Z', tiene_tercer: false };
  assert.equal(A.reactivable(c, ahora, 'yo'), true);
  assert.equal(A.reactivable(c, ahora, 'otro'), false, 'un no creador no reactiva');
  assert.equal(A.reactivable({ ...c, estado: 'abierta' }, ahora, 'yo'), false);
  assert.equal(A.reactivable({ ...c, estado: 'confirmada' }, ahora, 'yo'), false);
  assert.equal(A.reactivable({ ...c, fecha: '2026-12-10T22:00:00Z' }, ahora, 'yo'), false, 'ya pasó');
  // cuenta la fecha de la actividad, no el tercer tiempo: si la actividad ya pasó, no se reactiva aunque el tercer tiempo no
  assert.equal(A.reactivable({ ...c, fecha: '2026-12-10T22:00:00Z', tiene_tercer: true, tercer_fecha: '2026-12-11T01:00:00Z' }, ahora, 'yo'), false);
  assert.equal(A.reactivable({ ...c, tiene_tercer: true, tercer_fecha: '2026-12-11T23:00:00Z' }, ahora, 'yo'), true);
  assert.equal(A.reactivable(null, ahora, 'yo'), false);
});
