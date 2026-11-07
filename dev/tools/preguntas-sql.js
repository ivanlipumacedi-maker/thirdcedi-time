// Genera el SQL que carga el banco de la Trivia (contenido/preguntas.js) en la tabla privada public.trivia_preguntas.
// contenido/preguntas.js sigue siendo el archivo para editar; la base es la que elige las preguntas y guarda la
// respuesta correcta, así no viaja al teléfono antes de revelarla.
// Uso: node dev/tools/preguntas-sql.js  → escribe dev/supabase/trivia-preguntas-datos.sql (en .gitignore).
// Después se pega en el SQL Editor del proyecto thirdcedi-time. Es idempotente: agrega, actualiza y saca las
// preguntas que ya no están en el archivo (no son datos de usuarios: es el banco), salvo las de una partida en juego.
const fs = require('fs');
const path = require('path');

const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function sql(preguntas) {
  const filas = preguntas.map((q) => '  (' + [lit(q.id), lit(q.cat), q.dif, lit(q.p), 'array[' + q.ops.map(lit).join(', ') + ']', q.ok].join(', ') + ')');
  return [
    '-- Generado por dev/tools/preguntas-sql.js desde contenido/preguntas.js (' + preguntas.length + ' preguntas). No editar a mano.',
    'begin;',
    'insert into public.trivia_preguntas (id, cat, dif, p, ops, ok) values',
    filas.join(',\n'),
    'on conflict (id) do update set cat = excluded.cat, dif = excluded.dif, p = excluded.p, ops = excluded.ops, ok = excluded.ok;',
    // las de una partida en juego se dejan (se borrarían a la mitad); salen en la próxima carga
    'delete from public.trivia_preguntas where id not in (' + preguntas.map((q) => lit(q.id)).join(', ') + ')'
      + " and id not in (select unnest(s.preguntas) from public.trivia_secretos s join public.partidas x on x.id = s.partida where x.estado = 'jugando');",
    'commit;',
    '',
  ].join('\n');
}

// Huella del banco, igual a la que calcula la base con:
// select md5(string_agg(id||'|'||cat||'|'||dif||'|'||p||'|'||array_to_string(ops,'|')||'|'||ok, E'\n' order by id collate "C"))
// from public.trivia_preguntas;
function huella(preguntas) {
  const txt = preguntas.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((q) => [q.id, q.cat, q.dif, q.p, q.ops.join('|'), q.ok].join('|')).join('\n');
  return require('crypto').createHash('md5').update(txt, 'utf8').digest('hex');
}

module.exports = { sql, huella };

if (require.main === module) {
  const Preguntas = require(path.join(__dirname, '..', '..', 'contenido', 'preguntas.js'));
  const destino = path.join(__dirname, '..', 'supabase', 'trivia-preguntas-datos.sql');
  fs.writeFileSync(destino, sql(Preguntas), 'utf8');
  console.log('Escrito ' + destino + ' (' + Preguntas.length + ' preguntas). Huella: ' + huella(Preguntas));
}
