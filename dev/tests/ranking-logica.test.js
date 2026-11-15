// Tests del ranking general: desglose, puestos y que los puntos de la app sean los mismos que los de la base (35).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../../ranking-logica.js');

test('la asistencia a una actividad es lo que más suma', () => {
  const otros = Object.entries(R.PUNTOS).filter(([k]) => k !== 'asistencia').map(([, v]) => v);
  assert.ok(otros.every((v) => v < R.PUNTOS.asistencia));
  // ni la mejor partida posible llega a una asistencia
  assert.ok(R.PUNTOS.impostorJugar + R.PUNTOS.impostorImpostor < R.PUNTOS.asistencia);
  assert.ok(R.PUNTOS.triviaJugar + R.PUNTOS.triviaGanar < R.PUNTOS.asistencia);
  assert.equal(R.REGLAS[0].clave, 'asistencia');
  assert.equal(R.REGLAS[0].destacada, true);
});

test('los puntos de la app son los de la base (la última ranking(): dev/supabase/37-pictionary.sql)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/37-pictionary.sql'), 'utf8');
  const P = R.PUNTOS;
  assert.ok(sql.includes('coalesce(asis.n, 0) * ' + P.asistencia + ' as asistencia'));
  assert.ok(sql.includes('coalesce(ter.n, 0) * ' + P.tercer + ' as tercer'));
  assert.ok(sql.includes('coalesce(org.n, 0) * ' + P.organizar + ' as organizar'));
  assert.ok(sql.includes('else ' + P.triviaJugar + ' + case when jug.puntos = jug.max_pts and jug.puntos > 0 then ' + P.triviaGanar));
  assert.ok(sql.includes("when 'impostor' then " + P.impostorJugar + ' + case'));
  assert.ok(new RegExp("'grupo' and .* then " + P.impostorGrupo).test(sql));
  assert.ok(new RegExp("'impostor' and .* then " + P.impostorImpostor).test(sql));
  assert.ok(sql.includes('t.rn <= ' + R.TOPE_PARTIDAS_DIA));
  assert.ok(sql.includes("coalesce(jsonb_array_length(jug.e -> 'jugadas'), 0) < " + require('../../ajedrez-logica.js').MIN_JUGADAS_RANKING));
  assert.ok(sql.includes('else ' + P.ajedrezJugar + ' + case'));
  assert.ok(sql.includes("'tablas' then " + P.ajedrezTablas));
  assert.ok(sql.includes("jug.e ->> 'negras') then " + P.ajedrezGanar));
  assert.ok(sql.replace(/\r\n/g, '\n').includes("when 'pictionary' then case when jug.n_act < 2 then 0\n                                     else " + P.pictionaryJugar + ' + case when jug.puntos = jug.max_pts and jug.puntos > 0 then ' + P.pictionaryGanar));
  assert.ok(sql.includes('else ' + P.trucoJugar + " + case when coalesce(jug.e -> 'ganadores', '[]'::jsonb) ? jug.persona::text then " + P.trucoGanar));
});

test('desglose: solo lo que tiene puntos, de mayor a menor, con la cuenta en palabras', () => {
  const d = R.desglose({ asistencia: 3000, n_asistencia: 3, tercer: 300, n_tercer: 1, organizar: 0, n_organizar: 0, trivia: 400, n_trivia: 4, impostor: 2000, n_impostor: 9 });
  assert.deepEqual(d.map((x) => x.clave), ['asistencia', 'impostor', 'trivia', 'tercer']);
  assert.equal(d[0].detalle, '3 actividades');
  assert.equal(d[3].detalle, '1 vez');
  assert.deepEqual(R.desglose({}), []);
});

test('puestos: los empatados comparten puesto', () => {
  const p = R.puestos([{ total: 3000 }, { total: 2000 }, { total: 2000 }, { total: 50 }]).map((x) => x.puesto);
  assert.deepEqual(p, [1, 2, 2, 4]);
  assert.deepEqual(R.puestos([]), []);
});
