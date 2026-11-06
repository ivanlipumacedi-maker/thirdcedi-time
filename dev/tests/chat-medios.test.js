// Pruebas de las URLs firmadas de chat-medios.js con un sb falso (sin red).
const test = require('node:test');
const assert = require('node:assert/strict');

function cargarMedios() {
  delete require.cache[require.resolve('../../chat-medios.js')];
  global.window = { ChatLogica: require('../../chat-logica.js') };
  require('../../chat-medios.js');
  return global.window.ChatMedios;
}
function sbFalso(respuesta) {
  const sb = { llamadas: 0, storage: { from: () => ({ createSignedUrls: async (paths) => { sb.llamadas++; return respuesta(paths); } }) } };
  return sb;
}

test('si firmar falla por red, no vuelve a pedir enseguida (backoff)', async () => {
  const M = cargarMedios();
  const sb = sbFalso(() => { throw new Error('sin red'); });
  await assert.rejects(M.firmar(sb, ['v/fotos/a.webp']));
  await M.firmar(sb, ['v/fotos/a.webp']).catch(() => {});
  await M.firmar(sb, ['v/fotos/a.webp']).catch(() => {});
  assert.equal(sb.llamadas, 1, 'durante el backoff no se llama a la API');
  assert.equal(M.puedeFirmar('v/fotos/a.webp'), false);
  M.reintentarYa();
  assert.equal(M.puedeFirmar('v/fotos/a.webp'), true, 'reintentarYa (online/visible) habilita');
});

test('una ruta que vuelve con error queda marcada y no se repide', async () => {
  const M = cargarMedios();
  const sb = sbFalso((paths) => ({ data: paths.map((p) => (p.includes('roto') ? { path: p, error: 'Object not found', signedUrl: null } : { path: p, signedUrl: 'https://x/' + p })), error: null }));
  const r = await M.firmar(sb, ['v/fotos/ok.webp', 'v/fotos/roto.webp']);
  assert.equal(r.get('v/fotos/ok.webp'), 'https://x/v/fotos/ok.webp');
  assert.equal(M.puedeFirmar('v/fotos/roto.webp'), false);
  await M.firmar(sb, ['v/fotos/roto.webp']);
  assert.equal(sb.llamadas, 1, 'la rota no se vuelve a pedir');
});

test('firmada no devuelve URLs vencidas y vigente avisa antes del margen', async () => {
  const M = cargarMedios();
  const sb = sbFalso((paths) => ({ data: paths.map((p) => ({ path: p, signedUrl: 'https://x/' + p })), error: null }));
  const real = Date.now;
  try {
    let t = 1_000_000; Date.now = () => t;
    await M.firmar(sb, ['v/a.webp']);
    assert.equal(M.vigente('v/a.webp'), true);
    t += 3600 * 1000 - 4 * 60 * 1000; // faltan 4 min
    assert.equal(M.vigente('v/a.webp'), false, 'a menos de 5 min ya no es vigente');
    assert.ok(M.firmada('v/a.webp'), 'todavía sirve');
    t += 5 * 60 * 1000; // vencida
    assert.equal(M.firmada('v/a.webp'), null);
  } finally { Date.now = real; }
});

test('miniatura: ruta derivada de la foto', () => {
  const M = cargarMedios();
  assert.equal(M.rutaMini('v/fotos/x.webp'), 'v/fotos/x.t.webp');
});
