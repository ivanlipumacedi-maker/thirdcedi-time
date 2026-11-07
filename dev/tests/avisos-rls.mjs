// RLS de los avisos push contra el proyecto real, con usuarios de prueba (zz-prueba-a/b@cedi.com.ar).
// Las contraseñas se leen de .env (ZZ_PRUEBA_A_PASSWORD, _B_); se crean con dev/supabase/usuarios-prueba.sql.
// Verifica: push_subs solo la propia (ver, borrar; alta solo con el RPC push_registrar, solo servicios de push conocidos
// y como mucho 10 por persona), eventos_aviso y avisos_pruebas cerradas para el cliente, avisos_probar con límite (que
// vale aunque la Edge Function ya haya consumido la cola), y que la función avisos sin el secreto de cron responde 401.
// Las suscripciones de prueba usan endpoints https://fcm.googleapis.com/fcm/send/zz-prueba-… (nunca se les manda nada:
// la prueba de avisos_probar corre después de borrarlas) y se borran al terminar. avisos_probar puede dejar una fila
// 'prueba' en eventos_aviso y deja la de zz-prueba-a en avisos_pruebas: se limpian con dev/supabase/limpiar-pruebas.sql.
// Uso: node dev/tests/avisos-rls.mjs
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = 'https://qvezbnkrfqewanlcejha.supabase.co';
const KEY = 'sb_publishable_nHg5W-1bGZwudTST-ejzeA_w_gUNYXQ';
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function leerEnv() {
  const f = join(raiz, '.env');
  if (!existsSync(f)) return {};
  const o = {};
  readFileSync(f, 'utf8').split(/\r?\n/).forEach((l) => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
  return o;
}
const env = leerEnv();
const faltan = ['A', 'B'].filter((l) => !env['ZZ_PRUEBA_' + l + '_PASSWORD']);
if (faltan.length) {
  console.log('FALTAN las contraseñas de prueba de: ' + faltan.join(', ') + '. Corré dev/supabase/usuarios-prueba.sql en el SQL Editor y copiá las líneas ZZ_PRUEBA_*_PASSWORD al .env.');
  process.exit(2);
}

function cliente(token) {
  const h = { apikey: KEY, Authorization: 'Bearer ' + (token || KEY), 'Content-Type': 'application/json', Prefer: 'return=representation' };
  const api = (metodo, r, cuerpo) => fetch(`${BASE}/rest/v1/${r}`, { method: metodo, headers: h, body: cuerpo ? JSON.stringify(cuerpo) : undefined })
    .then(async (x) => ({ status: x.status, data: await x.json().catch(() => null) }));
  const rpc = (fn, args) => api('POST', 'rpc/' + fn, args || {});
  return { api, rpc };
}
async function entrar(l) {
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `zz-prueba-${l.toLowerCase()}@cedi.com.ar`, password: env['ZZ_PRUEBA_' + l + '_PASSWORD'] }),
  });
  const j = await r.json();
  assert.ok(r.ok && j.access_token, `no pudo entrar ${l}: ${r.status}`);
  return { id: j.user.id, ...cliente(j.access_token) };
}

let fallas = 0;
const paso = async (nombre, fn) => {
  try { await fn(); console.log('ok', nombre); } catch (e) { fallas++; console.log('FALLA', nombre, '-', e.message); }
};
const ok2xx = (r, msg) => assert.ok(r.status >= 200 && r.status < 300, msg + ': ' + r.status + ' ' + JSON.stringify(r.data));
const negado = (r, msg) => assert.ok(r.status >= 400, msg + ': debió fallar y dio ' + r.status + ' ' + JSON.stringify(r.data));

const A = await entrar('A');
const B = await entrar('B');
const anon = cliente(null);
const ep = () => 'https://fcm.googleapis.com/fcm/send/zz-prueba-' + crypto.randomUUID();
const epA = ep();
const epB = ep();
const extras = [];
const sub = (e) => ({ p_endpoint: e, p_p256dh: 'BPzzPruebaClavePublicaFalsa', p_auth: 'zzAuthFalso' });
const mias = async (c) => (await c.api('GET', 'push_subs?select=endpoint,persona&endpoint=like.*zz-prueba-*&order=creado')).data;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await paso('push_registrar: cada uno registra su teléfono', async () => {
    ok2xx(await A.rpc('push_registrar', sub(epA)), 'A registra');
    ok2xx(await B.rpc('push_registrar', sub(epB)), 'B registra');
    ok2xx(await A.rpc('push_registrar', sub(epA)), 'A renueva la misma (upsert)');
  });

  await paso('push_subs: cada uno ve solo la suya', async () => {
    const a = await mias(A), b = await mias(B);
    assert.deepEqual(a.map((x) => x.endpoint), [epA]);
    assert.equal(a[0].persona, A.id);
    assert.deepEqual(b.map((x) => x.endpoint), [epB]);
  });

  await paso('push_subs: A no puede borrar ni cambiar la de B', async () => {
    const d = await A.api('DELETE', `push_subs?endpoint=eq.${encodeURIComponent(epB)}`);
    assert.ok(d.status === 200 || d.status === 204, 'delete ' + d.status);
    assert.deepEqual(d.data || [], [], 'no borró nada');
    negado(await A.api('PATCH', `push_subs?endpoint=eq.${encodeURIComponent(epB)}`, { persona: A.id }), 'update');
    assert.deepEqual((await mias(B)).map((x) => x.endpoint), [epB], 'la de B sigue');
  });

  await paso('push_subs: no se inserta directo (solo con el RPC, a nombre propio)', async () => {
    negado(await A.api('POST', 'push_subs', { endpoint: 'https://zz-prueba.invalid/push/directo', persona: B.id, p256dh: 'x', auth: 'y' }), 'insert directo a nombre de B');
    negado(await A.api('POST', 'push_subs', { endpoint: 'https://zz-prueba.invalid/push/directo2', persona: A.id, p256dh: 'x', auth: 'y' }), 'insert directo propio');
  });

  await paso('push_registrar: solo servicios de push conocidos', async () => {
    const malos = ['https://zz-prueba.invalid/push/x', 'https://fcm.googleapis.com.zz-prueba.invalid/x', 'https://zz-prueba@fcm.googleapis.com/x',
      'https://zz-prueba.invalid/fcm.googleapis.com/x', 'http://fcm.googleapis.com/fcm/send/zz-prueba-http',
      'https://fcm.googleapis.com:8443/zz-prueba-puerto', 'https://push.apple.com/zz-prueba-sin-sub'];
    for (const malo of malos) negado(await A.rpc('push_registrar', sub(malo)), malo);
    // los conocidos pasan (Apple, Mozilla, Windows): se registran y se borran enseguida
    const buenos = ['https://web.push.apple.com/zz-prueba-' + crypto.randomUUID(), 'https://api.push.apple.com/zz-prueba-' + crypto.randomUUID(),
      'https://updates.push.services.mozilla.com/wpush/v2/zz-prueba-' + crypto.randomUUID(),
      'https://wns2-par02p.notify.windows.com/w/?token=zz-prueba-' + crypto.randomUUID()];
    for (const bueno of buenos) {
      ok2xx(await A.rpc('push_registrar', sub(bueno)), bueno);
      ok2xx(await A.api('DELETE', `push_subs?endpoint=eq.${encodeURIComponent(bueno)}`), 'borrar ' + bueno);
    }
    assert.deepEqual((await mias(A)).map((x) => x.endpoint), [epA], 'quedó solo la de A');
  });

  await paso('push_registrar: como mucho 10 por persona, se va la más vieja', async () => {
    for (let i = 0; i < 10; i++) { const e = ep(); extras.push(e); ok2xx(await A.rpc('push_registrar', sub(e)), 'extra ' + i); }
    const a = (await mias(A)).map((x) => x.endpoint);
    assert.equal(a.length, 10, 'quedan 10');
    assert.ok(!a.includes(epA), 'se fue la más vieja (epA)');
    assert.deepEqual(a.sort(), [...extras].sort());
    assert.deepEqual((await mias(B)).map((x) => x.endpoint), [epB], 'a B no lo toca');
    // renovar una la vuelve la más nueva: al pasarse otra vez se va la siguiente más vieja
    ok2xx(await A.rpc('push_registrar', sub(extras[0])), 'renueva la primera extra');
    const otra = ep(); extras.push(otra);
    ok2xx(await A.rpc('push_registrar', sub(otra)), 'una más');
    const b = (await mias(A)).map((x) => x.endpoint);
    assert.equal(b.length, 10);
    assert.ok(b.includes(extras[0]) && !b.includes(extras[1]), 'quedó la renovada y se fue la segunda');
    // vuelve epA para los pasos que siguen
    for (const e of extras) await A.api('DELETE', `push_subs?endpoint=eq.${encodeURIComponent(e)}`);
    ok2xx(await A.rpc('push_registrar', sub(epA)), 'A vuelve a registrar epA');
  });

  await paso('anónimo: no ve suscripciones ni registra', async () => {
    const r = await anon.api('GET', 'push_subs?select=endpoint');
    assert.ok(r.status >= 400 || (Array.isArray(r.data) && !r.data.length), 'select anon ' + r.status);
    negado(await anon.rpc('push_registrar', sub(ep())), 'rpc anon');
    negado(await anon.rpc('avisos_probar'), 'avisos_probar anon');
  });

  await paso('eventos_aviso: el cliente no la lee ni la escribe', async () => {
    negado(await A.api('GET', 'eventos_aviso?select=id&limit=1'), 'select');
    negado(await A.api('POST', 'eventos_aviso', { tipo: 'prueba', autor: A.id }), 'insert');
    negado(await A.api('DELETE', 'eventos_aviso?id=gt.0'), 'delete');
    negado(await anon.api('GET', 'eventos_aviso?select=id&limit=1'), 'select anon');
    negado(await A.api('GET', 'avisos_pruebas?select=persona&limit=1'), 'avisos_pruebas select');
    negado(await A.api('POST', 'avisos_pruebas', { persona: A.id, ultima: '2000-01-01T00:00:00Z' }), 'avisos_pruebas insert');
    negado(await A.api('DELETE', `avisos_pruebas?persona=eq.${A.id}`), 'avisos_pruebas delete');
  });

  await paso('avisos_llamar y avisos_config no son para el cliente', async () => {
    negado(await A.rpc('avisos_llamar', { p_body: { tipo: 'diario' } }), 'avisos_llamar');
    negado(await A.rpc('avisos_config'), 'avisos_config');
  });

  await paso('Edge Function avisos: sin secreto o con uno falso → 401', async () => {
    const llamar = (h) => fetch(`${BASE}/functions/v1/avisos`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: '{"tipo":"cambios"}' });
    assert.equal((await llamar({})).status, 401, 'sin header');
    assert.equal((await llamar({ 'x-cron-secret': 'zz-falso-' + crypto.randomUUID() })).status, 401, 'secreto falso');
    assert.equal((await llamar({ apikey: KEY, Authorization: 'Bearer ' + KEY })).status, 401, 'con la clave publicable');
  });

  await paso('push_registrar: el mismo teléfono que cambia de dueño pasa a quien lo registra', async () => {
    ok2xx(await B.rpc('push_registrar', sub(epA)), 'B registra el endpoint de A (mismo navegador, otra cuenta)');
    assert.deepEqual((await mias(A)), [], 'A ya no lo tiene');
    assert.deepEqual((await mias(B)).map((x) => x.endpoint).sort(), [epA, epB].sort());
  });
} finally {
  for (const [c, e] of [[A, epA], [B, epA], [B, epB], ...extras.map((x) => [A, x])]) await c.api('DELETE', `push_subs?endpoint=eq.${encodeURIComponent(e)}`);
}
await paso('limpieza: no quedan suscripciones de prueba', async () => {
  assert.deepEqual(await mias(A), []);
  assert.deepEqual(await mias(B), []);
});

// Ya sin suscripciones de A (el aviso de prueba no sale a ningún lado). La Edge Function consume la fila 'prueba' de la
// cola apenas la recibe: el límite vive en avisos_pruebas y tiene que seguir frenando después de eso.
await paso('avisos_probar: uno cada 30 s, aunque la cola ya se haya consumido', async () => {
  let r1 = await A.rpc('avisos_probar');
  ok2xx(r1, 'primera');
  if (r1.data === false) { // hubo una corrida hace menos de 30 s
    await espera(31_000);
    r1 = await A.rpc('avisos_probar');
    ok2xx(r1, 'primera, después de esperar');
  }
  assert.equal(r1.data, true, 'la primera encola');
  await espera(8_000); // para entonces la función ya tomó la fila 'prueba'
  const r2 = await A.rpc('avisos_probar');
  ok2xx(r2, 'segunda');
  assert.equal(r2.data, false, 'la segunda antes de los 30 s no encola');
});

console.log('Para borrar la fila "prueba" que dejó avisos_probar: correr dev/supabase/limpiar-pruebas.sql con el MCP supabase-thirdcedi o en el SQL Editor.');
console.log(fallas ? `${fallas} falla(s)` : 'todo ok');
process.exit(fallas ? 1 : 0);
