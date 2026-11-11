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

test('miniatura de un video (.mp4 y .webm)', () => {
  const M = cargarMedios();
  assert.equal(M.rutaMini('v/videos/x.mp4'), 'v/videos/x.t.webp');
  assert.equal(M.rutaMini('v/videos/x.webm'), 'v/videos/x.t.webp');
});

test('buscarGiphy: tendencias sin texto, solo URLs de media*.giphy.com y errores con nombre', async () => {
  const M = cargarMedios();
  const real = global.fetch;
  let pedida = '';
  try {
    global.fetch = async (u) => { pedida = u; return { ok: true, status: 200, json: async () => ({ data: [
      { id: '1', title: 'Messi', images: { fixed_height: { webp: 'https://media1.giphy.com/media/1/200.webp' } } },
      { id: '2', title: 'Malo', images: { fixed_height: { url: 'https://otro.com/x.gif' } } },
    ] }) }; };
    const r = await M.buscarGiphy('k', '');
    assert.match(pedida, /\/v1\/stickers\/trending\?/);
    assert.deepEqual(r, [{ id: '1', url: 'https://media1.giphy.com/media/1/200.webp', titulo: 'Messi' }]);
    await M.buscarGiphy('k', 'gol');
    assert.match(pedida, /\/v1\/stickers\/search\?.*q=gol/);
    global.fetch = async () => ({ ok: false, status: 429 });
    await assert.rejects(M.buscarGiphy('k', 'x'), /cuota/);
    global.fetch = async () => ({ ok: false, status: 403 });
    await assert.rejects(M.buscarGiphy('k', 'x'), /clave/);
    global.fetch = async () => { throw new Error('offline'); };
    await assert.rejects(M.buscarGiphy('k', 'x'), /red/);
  } finally { global.fetch = real; }
});
