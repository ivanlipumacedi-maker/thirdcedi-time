const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../perfiles.js');

test('iniciales', () => {
  assert.equal(P.iniciales('Ivan Li Puma'), 'IL');
  assert.equal(P.iniciales('  ana  '), 'A');
  assert.equal(P.iniciales('juan pérez'), 'JP');
  assert.equal(P.iniciales(''), '?');
  assert.equal(P.iniciales(null), '?');
});
test('primerNombre', () => {
  assert.equal(P.primerNombre('Ana María Gómez'), 'Ana');
  assert.equal(P.primerNombre(''), '');
});
test('rutaAvatar', () => {
  assert.equal(P.rutaAvatar('abc'), 'abc/avatar.webp');
});
test('avatarUrl: con foto devuelve URL firmada/pública armada, sin foto null', () => {
  assert.equal(P.avatarUrl({ nombre: 'Ana', foto: null }, 'https://x.supabase.co'), null);
  assert.equal(P.avatarUrl({ nombre: 'Ana', foto: 'u1/avatar.webp?v=5' }, 'https://x.supabase.co'),
    'https://x.supabase.co/storage/v1/object/public/avatares/u1/avatar.webp?v=5');
  assert.equal(P.avatarUrl(null, 'https://x.supabase.co'), null);
});
test('colores de avatar: tamaño del recorte cuadrado centrado', () => {
  assert.deepEqual(P.recorteCuadrado(4000, 3000), { x: 500, y: 0, lado: 3000 });
  assert.deepEqual(P.recorteCuadrado(300, 500), { x: 0, y: 100, lado: 300 });
  assert.deepEqual(P.recorteCuadrado(100, 100), { x: 0, y: 0, lado: 100 });
});
