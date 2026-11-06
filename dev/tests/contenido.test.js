// Tests del banco de contenido: preguntas de Trivia y pares de palabras de El Impostor.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const Preguntas = require(path.join(__dirname, '..', '..', 'contenido', 'preguntas.js'));
const Palabras = require(path.join(__dirname, '..', '..', 'contenido', 'palabras.js'));

const CATEGORIAS = ['general', 'deportes', 'argentina', 'tecnologia', 'cine-musica', 'comida', 'geografia', 'historia'];

// Palabras que no pueden aparecer en ningún texto (picante, insultos, política partidaria, religión).
// Se comparan sin tildes y en minúscula, como palabra entera (o prefijo cuando termina en *).
const EXCLUIDAS = [
  'puta', 'puto', 'putos', 'mierda', 'boludo', 'boluda', 'pelotudo', 'pelotuda', 'forro', 'garcha',
  'pija', 'orto', 'culo', 'coger', 'cojer', 'garchar', 'concha', 'sexo', 'sexual*', 'porno*', 'erotic*',
  'tetas', 'pete', 'trolo', 'puteada', 'idiota', 'imbecil', 'tarado', 'mogolico', 'droga*', 'cocaina', 'porro',
  'peronis*', 'kirchner*', 'macri*', 'milei', 'radicales', 'kuka', 'facho*', 'zurdo*',
  'dios', 'iglesia', 'religi*', 'biblia', 'jesus', 'cristo', 'virgen', 'papa francisco', 'vaticano', 'navidad', 'pascua',
];

function normalizar(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const REGEX_EXCLUIDAS = EXCLUIDAS.map(function (w) {
  const base = w.replace(/\*$/, '');
  const fin = w.endsWith('*') ? '' : '(?![a-z])';
  return { w: w, re: new RegExp('(?<![a-z])' + base + fin) };
});

function palabrasProhibidas(texto) {
  const t = normalizar(texto);
  return REGEX_EXCLUIDAS.filter(function (x) { return x.re.test(t); }).map(function (x) { return x.w; });
}

test('hay al menos 500 preguntas', function () {
  assert.ok(Array.isArray(Preguntas));
  assert.ok(Preguntas.length >= 500, 'hay ' + Preguntas.length);
});

test('cada pregunta respeta la forma Pregunta', function () {
  for (const q of Preguntas) {
    assert.equal(typeof q.id, 'string', JSON.stringify(q));
    assert.ok(CATEGORIAS.includes(q.cat), q.id + ' categoría ' + q.cat);
    assert.ok([1, 2, 3].includes(q.dif), q.id + ' dif ' + q.dif);
    assert.equal(typeof q.p, 'string');
    assert.ok(q.p.trim().length > 5, q.id + ' texto vacío');
    assert.ok(q.p.trim().endsWith('?'), q.id + ' no termina en "?": ' + q.p);
    assert.ok(Array.isArray(q.ops) && q.ops.length === 4, q.id + ' no tiene 4 opciones');
    for (const o of q.ops) assert.ok(typeof o === 'string' && o.trim().length > 0, q.id + ' opción vacía');
    const distintas = new Set(q.ops.map(function (o) { return normalizar(o.trim()); }));
    assert.equal(distintas.size, 4, q.id + ' opciones repetidas: ' + q.ops.join(' | '));
    assert.ok([0, 1, 2, 3].includes(q.ok), q.id + ' ok ' + q.ok);
  }
});

test('ids únicos y con formato prefijo-NNN', function () {
  const ids = new Set();
  for (const q of Preguntas) {
    assert.match(q.id, /^[a-z]{3}-\d{3}$/, q.id);
    assert.ok(!ids.has(q.id), 'id repetido ' + q.id);
    ids.add(q.id);
  }
});

test('no hay dos preguntas con el mismo texto', function () {
  const vistos = new Map();
  for (const q of Preguntas) {
    const k = normalizar(q.p.trim());
    assert.ok(!vistos.has(k), 'texto repetido en ' + q.id + ' y ' + vistos.get(k));
    vistos.set(k, q.id);
  }
});

test('cada categoría tiene al menos 40 preguntas y las tres dificultades', function () {
  for (const cat of CATEGORIAS) {
    const deCat = Preguntas.filter(function (q) { return q.cat === cat; });
    assert.ok(deCat.length >= 40, cat + ' tiene ' + deCat.length);
    for (const d of [1, 2, 3]) {
      assert.ok(deCat.some(function (q) { return q.dif === d; }), cat + ' sin dificultad ' + d);
    }
  }
});

test('la respuesta correcta está repartida entre las 4 posiciones', function () {
  const cuenta = [0, 0, 0, 0];
  for (const q of Preguntas) cuenta[q.ok]++;
  for (let i = 0; i < 4; i++) {
    const prop = cuenta[i] / Preguntas.length;
    assert.ok(prop >= 0.2 && prop <= 0.3, 'posición ' + i + ' tiene ' + cuenta[i]);
  }
});

test('ninguna pregunta ni opción usa palabras excluidas', function () {
  for (const q of Preguntas) {
    const malas = palabrasProhibidas([q.p].concat(q.ops).join(' \n '));
    assert.deepEqual(malas, [], q.id + ' usa: ' + malas.join(', '));
  }
});

test('el filtro de exclusión detecta lo que tiene que detectar', function () {
  assert.deepEqual(palabrasProhibidas('Qué boludo'), ['boludo']);
  assert.deepEqual(palabrasProhibidas('La ortografía y el vehículo'), []);
  assert.deepEqual(palabrasProhibidas('Contenido SEXUAL'), ['sexual*']);
});

test('hay al menos 150 pares de palabras, bien formados y sin repetir', function () {
  assert.ok(Array.isArray(Palabras));
  assert.ok(Palabras.length >= 150, 'hay ' + Palabras.length);
  const vistas = new Set();
  for (const par of Palabras) {
    assert.equal(typeof par.palabra, 'string');
    assert.equal(typeof par.impostor, 'string');
    assert.ok(par.palabra.trim().length > 0 && par.impostor.trim().length > 0, JSON.stringify(par));
    assert.notEqual(normalizar(par.palabra.trim()), normalizar(par.impostor.trim()), 'par igual: ' + par.palabra);
    const k = normalizar(par.palabra.trim());
    assert.ok(!vistas.has(k), 'palabra repetida: ' + par.palabra);
    vistas.add(k);
    const malas = palabrasProhibidas(par.palabra + ' ' + par.impostor);
    assert.deepEqual(malas, [], par.palabra + ' usa: ' + malas.join(', '));
  }
});
