const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../../avisos-logica.js');
const A = require('../../actividades-logica.js');

// 2026-11-06 en Argentina (UTC-3): 12:00 ART = 15:00 UTC
const HOY_12 = Date.parse('2026-11-06T15:00:00Z');
const act = (id, fecha, extra) => ({ id, titulo: 'Pádel ' + id, tipo: 'padel', fecha, lugar: 'Club', estado: 'confirmada', tiene_tercer: false, tercer_fecha: null, ...extra });

// ---------- Review Focus 4: recordatorio de las 12 ----------
test('diaART: 2026-11-07T02:30Z es todavía el 6 en Argentina', () => {
  assert.equal(L.diaART(Date.parse('2026-11-07T02:30:00Z')), '2026-11-06');
  assert.equal(L.diaART(Date.parse('2026-11-07T03:00:00Z')), '2026-11-07');
  assert.equal(L.diaART(Date.parse('2026-11-06T15:00:00Z')), '2026-11-06');
});

test('confirmada con evento hoy a las 21 ART: reciben todos los anotados, ambas partes, sin repetir', () => {
  const a = act('a1', '2026-11-07T00:00:00Z', { tiene_tercer: true, tercer_fecha: '2026-11-07T02:00:00Z' }); // 21:00 ART del 6
  const asis = [
    { actividad: 'a1', persona: 'p1', parte: 'actividad' },
    { actividad: 'a1', persona: 'p1', parte: 'tercer' },
    { actividad: 'a1', persona: 'p2', parte: 'actividad' },
    { actividad: 'a1', persona: 'p3', parte: 'tercer' },
    { actividad: 'otra', persona: 'p9', parte: 'actividad' },
  ];
  const r = L.recordatoriosDiarios([a], asis, HOY_12);
  assert.deepEqual(r.map((x) => x.persona).sort(), ['p1', 'p2', 'p3']);
  assert.ok(r.every((x) => x.actividad === 'a1'));
});

test('evento ayer: nada', () => {
  const a = act('a1', '2026-11-05T23:00:00Z'); // 20:00 ART del 5
  assert.deepEqual(L.recordatoriosDiarios([a], [{ actividad: 'a1', persona: 'p1', parte: 'actividad' }], HOY_12), []);
});

test('estado abierta o cancelada: nada', () => {
  const asis = [{ actividad: 'a1', persona: 'p1', parte: 'actividad' }];
  for (const estado of ['abierta', 'cancelada']) {
    assert.deepEqual(L.recordatoriosDiarios([act('a1', '2026-11-07T00:00:00Z', { estado })], asis, HOY_12), [], estado);
  }
});

test('evento en unos días: recibe cada día hasta el día del evento inclusive', () => {
  const a = act('a1', '2026-11-10T22:00:00Z');
  const asis = [{ actividad: 'a1', persona: 'p1', parte: 'actividad' }];
  assert.equal(L.recordatoriosDiarios([a], asis, HOY_12).length, 1);
  assert.equal(L.recordatoriosDiarios([a], asis, Date.parse('2026-11-10T15:00:00Z')).length, 1, 'el mismo día');
  assert.equal(L.recordatoriosDiarios([a], asis, Date.parse('2026-11-11T15:00:00Z')).length, 0, 'al día siguiente ya no');
});

test('evento de hoy que ya pasó antes de las 12: sin tercer tiempo, nada; con tercer tiempo más tarde, solo los del tercer tiempo', () => {
  const asis = [
    { actividad: 'a1', persona: 'p1', parte: 'actividad' },
    { actividad: 'a1', persona: 'p2', parte: 'tercer' },
    { actividad: 'a1', persona: 'p3', parte: 'actividad' },
    { actividad: 'a1', persona: 'p3', parte: 'tercer' },
  ];
  assert.deepEqual(L.recordatoriosDiarios([act('a1', '2026-11-06T12:00:00Z')], asis, HOY_12), []); // 09:00 ART
  const conTercer = act('a1', '2026-11-06T12:00:00Z', { tiene_tercer: true, tercer_fecha: '2026-11-06T16:00:00Z' });
  const r = L.recordatoriosDiarios([conTercer], asis, HOY_12);
  assert.deepEqual(r.map((x) => x.persona).sort(), ['p2', 'p3'], 'quien está solo a la actividad ya no recibe');
});

test('anotado solo a la actividad: recibe mientras la actividad no pasó, aunque quede el tercer tiempo', () => {
  const asis = [{ actividad: 'a1', persona: 'p1', parte: 'actividad' }];
  const a = act('a1', '2026-11-06T22:00:00Z', { tiene_tercer: true, tercer_fecha: '2026-11-07T01:00:00Z' }); // 19 y 22 ART
  assert.equal(L.recordatoriosDiarios([a], asis, HOY_12).length, 1);
  assert.equal(L.recordatoriosDiarios([a], asis, Date.parse('2026-11-06T23:00:00Z')).length, 0, 'ya empezó');
});

test('textoDiario: si la actividad ya pasó y queda el tercer tiempo, el aviso es del tercer tiempo', () => {
  const a = act('a1', '2026-11-06T12:00:00Z', { titulo: 'Pádel', tiene_tercer: true, tercer_fecha: '2026-11-06T23:30:00Z', tercer_lugar: 'Bar Roma' });
  const t = L.textoDiario(a, HOY_12);
  assert.equal(t.title, 'Hoy: 🍻 Tercer tiempo de Pádel a las 20:30');
  assert.match(t.body, /Bar Roma/);
  assert.equal(t.url, '#/actividad/a1');
  // si la actividad todavía no pasó, el título es de la actividad
  assert.match(L.textoDiario(act('a1', '2026-11-06T22:00:00Z', { titulo: 'Pádel' }), HOY_12).title, /^Hoy: 🎾 Pádel a las 19:00$/);
});

test('evento mañana a las 00:30 ART (03:30Z): recibe hoy y dice "Mañana"', () => {
  const a = act('a1', '2026-11-07T03:30:00Z');
  assert.equal(L.recordatoriosDiarios([a], [{ actividad: 'a1', persona: 'p1', parte: 'actividad' }], HOY_12).length, 1);
  assert.equal(L.etiquetaDia(Date.parse(a.fecha), HOY_12), 'Mañana');
});

test('sin anotados: nada; varias actividades: un aviso por persona y actividad', () => {
  const a1 = act('a1', '2026-11-07T00:00:00Z'), a2 = act('a2', '2026-11-08T00:00:00Z'), a3 = act('a3', '2026-11-08T00:00:00Z');
  const asis = [{ actividad: 'a1', persona: 'p1', parte: 'actividad' }, { actividad: 'a2', persona: 'p1', parte: 'actividad' }];
  const r = L.recordatoriosDiarios([a1, a2, a3], asis, HOY_12);
  assert.deepEqual(r.map((x) => x.actividad + ':' + x.persona).sort(), ['a1:p1', 'a2:p1']);
});

// ---------- Textos ----------
test('etiquetaDia: Hoy, Mañana o El <día>', () => {
  assert.equal(L.etiquetaDia(Date.parse('2026-11-07T00:00:00Z'), HOY_12), 'Hoy');      // 21 ART del 6
  assert.equal(L.etiquetaDia(Date.parse('2026-11-07T15:00:00Z'), HOY_12), 'Mañana');
  assert.equal(L.etiquetaDia(Date.parse('2026-11-10T15:00:00Z'), HOY_12), 'El martes 10/11');
});

test('textoDiario: "Hoy: ⚽ título a las 21:00"', () => {
  const t = L.textoDiario(act('a1', '2026-11-07T00:00:00Z', { tipo: 'futbol', titulo: 'Fútbol 5', lugar: 'Cancha' }), HOY_12);
  assert.equal(t.title, 'Hoy: ⚽ Fútbol 5 a las 21:00');
  assert.match(t.body, /Cancha/);
});

test('textoActividad para nueva, confirmada, cambio y cancelada', () => {
  const a = act('a1', '2026-11-07T00:00:00Z', { tipo: 'asado', titulo: 'Asado', lugar: 'Quincho' });
  assert.equal(L.textoActividad('nueva', a, 'Ana').title, 'Nueva actividad: 🍖 Asado');
  assert.match(L.textoActividad('nueva', a, 'Ana').body, /Ana/);
  assert.equal(L.textoActividad('confirmada', a, 'Ana').title, 'Se confirmó Asado');
  assert.equal(L.textoActividad('cambio', a, 'Ana').title, 'Cambió Asado');
  assert.match(L.textoActividad('cambio', a, 'Ana').body, /Quincho/);
  assert.equal(L.textoActividad('cancelada', a, 'Ana').title, 'Se canceló Asado');
  assert.equal(L.textoActividad('reabierta', a, 'Ana').title, 'Asado volvió a estar abierta');
  assert.match(L.textoActividad('reabierta', a, 'Ana').body, /Quincho/);
  assert.equal(L.textoActividad('confirmada', a, 'Ana').url, '#/actividad/a1');
});

test('el emoji sale de los tipos de actividades', () => {
  A.TIPOS.forEach((t) => assert.equal(L.EMOJI[t.id], t.emoji, t.id));
});

test('fusionarActividad: nueva gana; si no, el último cambio de estado; si no, cambio de fecha o lugar', () => {
  assert.equal(L.fusionarActividad(['nueva', 'cambio', 'confirmada']), 'nueva');
  assert.equal(L.fusionarActividad(['confirmada', 'cambio']), 'confirmada');
  assert.equal(L.fusionarActividad(['confirmada', 'cancelada']), 'cancelada');
  assert.equal(L.fusionarActividad(['confirmada', 'cambio', 'cambio']), 'confirmada');
  assert.equal(L.fusionarActividad(['cancelada', 'reabierta']), 'reabierta');
  assert.equal(L.fusionarActividad(['cambio', 'cambio']), 'cambio');
});

test('resumenMensaje: texto recortado o foto', () => {
  assert.equal(L.resumenMensaje({ tipo: 'foto', texto: null }), '📷 Foto');
  assert.equal(L.resumenMensaje({ tipo: 'texto', texto: '  hola  ' }), 'hola');
  const largo = L.resumenMensaje({ tipo: 'texto', texto: 'x'.repeat(200) });
  assert.equal(Array.from(largo).length, 80);
  assert.ok(largo.endsWith('…'));
});

test('textoMensajes: uno o varios, con el título de la sala', () => {
  const uno = L.textoMensajes('Asado', 'Ana', [{ tipo: 'texto', texto: 'llevo carbón' }]);
  assert.deepEqual([uno.title, uno.body], ['Asado', 'Ana: llevo carbón']);
  const varios = L.textoMensajes('Asado', 'Ana', [1, 2, 3, 4, 5].map((i) => ({ tipo: 'texto', texto: 'm' + i })));
  assert.equal(varios.title, 'Asado');
  assert.match(varios.body, /^Ana mandó 5 mensajes/);
  assert.match(varios.body, /m5/);
  assert.doesNotMatch(varios.body, /m1\b/);
});

test('tituloPartida y urlSala', () => {
  assert.equal(L.tituloPartida('trivia', 'Ana Pérez'), 'Trivia de Ana');
  assert.equal(L.tituloPartida('impostor', 'Ana Pérez'), 'El Impostor de Ana');
  assert.equal(L.urlSala('act:abc'), '#/actividad/abc');
  assert.equal(L.urlSala('par:xyz'), '#/juegos/xyz');
});

test('mensajesListos: espera SILENCIO_MS desde el último del autor en la sala, pero no más de MAX_ESPERA_MS', () => {
  const t0 = Date.parse('2026-11-06T15:00:00Z');
  const ev = (id, sala, autor, ms) => ({ id, tipo: 'mensaje', sala, autor, mensaje: 'm' + id, creado: new Date(t0 + ms).toISOString() });
  const evs = [ev(1, 'act:1', 'A', 0), ev(2, 'act:1', 'A', 50_000), ev(3, 'act:1', 'B', 0), ev(4, 'par:2', 'A', 0)];
  // a los 70 s: el grupo de A en act:1 tuvo un mensaje hace 20 s → espera; los otros dos ya están en silencio
  const r = L.mensajesListos(evs, t0 + 70_000, { silencio: 60_000, maxEspera: 600_000 });
  assert.deepEqual(r.map((g) => g.sala + '|' + g.autor).sort(), ['act:1|B', 'par:2|A']);
  assert.deepEqual(r.find((g) => g.autor === 'B').ids, [3]);
  // si el autor no para nunca, igual sale a los 10 minutos del primero
  const seguido = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => ev(10 + i, 'act:1', 'A', i * 59_000));
  assert.equal(L.mensajesListos(seguido, t0 + 601_000, { silencio: 60_000, maxEspera: 600_000 }).length, 1);
  // los que no son mensajes no cuentan
  assert.deepEqual(L.mensajesListos([{ id: 9, tipo: 'nueva', actividad: 'x', autor: 'A', creado: new Date(t0).toISOString() }], t0 + 1e6), []);
});

test('la copia de la Edge Function es idéntica a avisos-logica.js', () => {
  const raiz = path.join(__dirname, '..', '..');
  assert.equal(fs.readFileSync(path.join(raiz, 'dev/supabase/avisos/avisos-logica.js'), 'utf8'), fs.readFileSync(path.join(raiz, 'avisos-logica.js'), 'utf8'));
});
