const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../perfiles.js');

// Cliente de Supabase falso: registra las llamadas a createSignedUrls.
function falso(devolver) {
  const llamadas = [];
  return {
    llamadas,
    storage: { from: (b) => ({ createSignedUrls: async (rutas, seg) => { llamadas.push({ b, rutas, seg }); return devolver(rutas); } }) },
  };
}
const ok = (rutas) => ({ data: rutas.map((r) => ({ path: r, signedUrl: 'https://s/' + r + '?token=t', error: null })), error: null });

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
test('rutaAvatar y rutaDe: la ruta de Storage es <uid>/avatar y se le saca el ?v=', () => {
  assert.equal(P.rutaAvatar('abc'), 'abc/avatar');
  assert.equal(P.rutaDe('abc/avatar?v=123'), 'abc/avatar');
  assert.equal(P.rutaDe(null), '');
});
test('recorteCuadrado: lado menor, centrado', () => {
  assert.deepEqual(P.recorteCuadrado(4000, 3000), { x: 500, y: 0, lado: 3000 });
  assert.deepEqual(P.recorteCuadrado(300, 500), { x: 0, y: 100, lado: 300 });
  assert.deepEqual(P.recorteCuadrado(100, 100), { x: 0, y: 0, lado: 100 });
});
test('avatarUrl sin caché o sin foto devuelve null', () => {
  P.limpiarCache();
  assert.equal(P.avatarUrl(null), null);
  assert.equal(P.avatarUrl({ nombre: 'Ana', foto: null }), null);
  assert.equal(P.avatarUrl({ nombre: 'Ana', foto: 'u1/avatar?v=1' }), null);
});
test('prepararAvatares pide todas las URLs en una llamada y avatarUrl las devuelve', async () => {
  P.limpiarCache();
  const sb = falso(ok);
  const perfiles = [{ foto: 'u1/avatar?v=1' }, { foto: 'u2/avatar?v=2' }, { foto: null }, { foto: 'u1/avatar?v=1' }];
  assert.equal(await P.prepararAvatares(perfiles, sb, 1000), 2);
  assert.equal(sb.llamadas.length, 1);
  assert.deepEqual(sb.llamadas[0], { b: 'avatares', rutas: ['u1/avatar', 'u2/avatar'], seg: 3600 });
  assert.equal(P.avatarUrl({ foto: 'u1/avatar?v=1' }, 2000), 'https://s/u1/avatar?token=t');
});
test('la caché se reutiliza hasta 2 minutos antes de vencer y después se renueva', async () => {
  P.limpiarCache();
  const sb = falso(ok);
  const p = [{ foto: 'u1/avatar?v=1' }];
  await P.prepararAvatares(p, sb, 0);
  await P.prepararAvatares(p, sb, 3000 * 1000); // sigue vigente: no vuelve a pedir
  assert.equal(sb.llamadas.length, 1);
  assert.notEqual(P.avatarUrl(p[0], 3400 * 1000), null);
  assert.equal(P.avatarUrl(p[0], 3500 * 1000), null); // vence a 3600 s, margen de 120 s
  await P.prepararAvatares(p, sb, 3500 * 1000);
  assert.equal(sb.llamadas.length, 2);
  assert.notEqual(P.avatarUrl(p[0], 3500 * 1000), null);
});
test('una foto nueva (otro ?v=) se pide de nuevo aunque la ruta sea la misma', async () => {
  P.limpiarCache();
  const sb = falso(ok);
  await P.prepararAvatares([{ foto: 'u1/avatar?v=1' }], sb, 0);
  await P.prepararAvatares([{ foto: 'u1/avatar?v=2' }], sb, 10);
  assert.equal(sb.llamadas.length, 2);
});
test('si falla la firma o una ruta, esa foto queda sin URL (iniciales) y no rompe', async () => {
  P.limpiarCache();
  const mala = falso(() => ({ data: null, error: { message: 'x' } }));
  assert.equal(await P.prepararAvatares([{ foto: 'u1/avatar?v=1' }], mala, 0), 0);
  assert.equal(P.avatarUrl({ foto: 'u1/avatar?v=1' }, 1), null);
  const parcial = falso((r) => ({ data: [{ path: r[0], signedUrl: null, error: 'Object not found' }], error: null }));
  assert.equal(await P.prepararAvatares([{ foto: 'u9/avatar?v=1' }], parcial, 0), 0);
  assert.equal(await P.prepararAvatares([{ foto: null }], mala, 0), 0);
});
