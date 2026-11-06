// Genera el SQL que carga los pares de El Impostor (contenido/palabras.js) en la tabla privada
// public.impostor_palabras. contenido/palabras.js sigue siendo el archivo para editar; la base es la que elige el
// par y el impostor, y a cada jugador le da solo su palabra (mi_palabra), así no viaja la de los demás.
// El cliente NO carga contenido/palabras.js.
// Uso: node dev/tools/palabras-sql.js  → escribe dev/supabase/impostor-palabras-datos.sql (en .gitignore).
// Después se corre con el MCP supabase-thirdcedi o en el SQL Editor. Es idempotente: agrega, actualiza y saca los
// pares que ya no están en el archivo (no son datos de usuarios: es el banco).
const fs = require('fs');
const path = require('path');

const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function sql(pares) {
  const filas = pares.map((x) => '  (' + lit(x.palabra) + ', ' + lit(x.impostor) + ')');
  return [
    '-- Generado por dev/tools/palabras-sql.js desde contenido/palabras.js (' + pares.length + ' pares). No editar a mano.',
    'begin;',
    'insert into public.impostor_palabras (palabra, impostor) values',
    filas.join(',\n'),
    'on conflict (palabra) do update set impostor = excluded.impostor;',
    'delete from public.impostor_palabras where palabra not in (' + pares.map((x) => lit(x.palabra)).join(', ') + ');',
    'commit;',
    '',
  ].join('\n');
}

// Huella del banco, igual a la que calcula la base con:
// select md5(string_agg(palabra||'|'||impostor, E'\n' order by palabra collate "C")) from public.impostor_palabras;
function huella(pares) {
  const txt = pares.slice().sort((a, b) => (Buffer.compare(Buffer.from(a.palabra), Buffer.from(b.palabra))))
    .map((x) => x.palabra + '|' + x.impostor).join('\n');
  return require('crypto').createHash('md5').update(txt, 'utf8').digest('hex');
}

module.exports = { sql, huella };

if (require.main === module) {
  const Palabras = require(path.join(__dirname, '..', '..', 'contenido', 'palabras.js'));
  const destino = path.join(__dirname, '..', 'supabase', 'impostor-palabras-datos.sql');
  fs.writeFileSync(destino, sql(Palabras), 'utf8');
  console.log('Escrito ' + destino + ' (' + Palabras.length + ' pares). Huella: ' + huella(Palabras));
}
