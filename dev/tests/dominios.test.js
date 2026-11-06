const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../dominios.js');

test('dominios permitidos del Grupo CEDI', () => {
  assert.equal(D.permitido('juan@cedi.com.ar'), true);
  assert.equal(D.permitido('Ana@KOREX.com.ar'), true);
  assert.equal(D.permitido('x@piconsulting.com.ar'), true);
  assert.equal(D.permitido('x@vulps.com.ar'), true);
  assert.equal(D.permitido('  x@wemox.com.ar  '), true);
});
test('dominios no permitidos', () => {
  assert.equal(D.permitido('x@cedi.com.ar.evil.com'), false);
  assert.equal(D.permitido('x@subcedi.com.ar'), false);
  assert.equal(D.permitido('x@sub.cedi.com.ar'), false);
  assert.equal(D.permitido('x@gmail.com'), false);
  assert.equal(D.permitido('cedi.com.ar'), false);
  assert.equal(D.permitido('a@cedi.com.ar@gmail.com'), false);
  assert.equal(D.permitido(''), false);
  assert.equal(D.permitido(null), false);
  assert.equal(D.permitido(undefined), false);
});
test('empresa según el dominio', () => {
  assert.equal(D.empresa('a@wemox.com.ar'), 'Wemox');
  assert.equal(D.empresa('a@CEDI.com.ar'), 'CEDI');
  assert.equal(D.empresa('a@piconsulting.com.ar'), 'Pi Consulting');
  assert.equal(D.empresa('a@vulps.com.ar'), 'Vulps');
  assert.equal(D.empresa('a@korex.com.ar'), 'Korex');
  assert.equal(D.empresa('a@gmail.com'), null);
  assert.equal(D.empresa(''), null);
});
test('la lista de dominios coincide con la del hook SQL', () => {
  const sql = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'supabase', '02-hook-dominio.sql'), 'utf8');
  for (const d of D.DOMINIOS) assert.ok(sql.includes("'" + d + "'"), d);
  assert.equal((sql.match(/'[a-z]+\.com\.ar'/g) || []).length, D.DOMINIOS.length);
});
