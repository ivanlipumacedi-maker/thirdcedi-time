// RLS de los avisos push contra el proyecto real, con usuarios de prueba (zz-prueba-a/b@cedi.com.ar).
// Las contraseñas se leen de .env (ZZ_PRUEBA_A_PASSWORD, _B_); se crean con dev/supabase/usuarios-prueba.sql.
// Verifica: push_subs solo la propia (ver, borrar; alta solo con el RPC push_registrar), eventos_aviso cerrada para el
// cliente, avisos_probar con límite, y que la Edge Function avisos sin el secreto de cron responde 401.
// Las suscripciones de prueba usan endpoints https://zz-prueba.invalid/… y se borran al terminar. avisos_probar deja
// una fila 'prueba' en eventos_aviso de zz-prueba-a: se limpia con dev/supabase/limpiar-pruebas.sql.
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
const epA = 'https://zz-prueba.invalid/push/' + crypto.randomUUID();
const epB = 'https://zz-prueba.invalid/push/' + crypto.randomUUID();
const sub = (ep) => ({ p_endpoint: ep, p_p256dh: 'BPzzPruebaClavePublicaFalsa', p_auth: 'zzAuthFalso' });
const mias = async (c) => (await c.api('GET', 'push_subs?select=endpoint,persona&endpoint=like.https://zz-prueba.invalid/*')).data;

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

  await paso('anónimo: no ve suscripciones ni registra', async () => {
    const r = await anon.api('GET', 'push_subs?select=endpoint');
    assert.ok(r.status >= 400 || (Array.isArray(r.data) && !r.data.length), 'select anon ' + r.status);
    negado(await anon.rpc('push_registrar', sub('https://zz-prueba.invalid/push/anon')), 'rpc anon');
    negado(await anon.rpc('avisos_probar'), 'avisos_probar anon');
  });

  await paso('eventos_aviso: el cliente no la lee ni la escribe', async () => {
    negado(await A.api('GET', 'eventos_aviso?select=id&limit=1'), 'select');
    negado(await A.api('POST', 'eventos_aviso', { tipo: 'prueba', autor: A.id }), 'insert');
    negado(await A.api('DELETE', 'eventos_aviso?id=gt.0'), 'delete');
    negado(await anon.api('GET', 'eventos_aviso?select=id&limit=1'), 'select anon');
  });

  await paso('avisos_llamar y avisos_config no son para el cliente', async () => {
    negado(await A.rpc('avisos_llamar', { p_body: { tipo: 'diario' } }), 'avisos_llamar');
    negado(await A.rpc('avisos_config'), 'avisos_config');
  });

  await paso('avisos_probar: uno cada 30 s', async () => {
    const r1 = await A.rpc('avisos_probar');
    ok2xx(r1, 'primera');
    const r2 = await A.rpc('avisos_probar');
    ok2xx(r2, 'segunda');
    assert.equal(r2.data, false, 'la segunda enseguida no encola');
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
  for (const [c, ep] of [[A, epA], [B, epA], [B, epB]]) await c.api('DELETE', `push_subs?endpoint=eq.${encodeURIComponent(ep)}`);
}
await paso('limpieza: no quedan suscripciones de prueba', async () => {
  assert.deepEqual(await mias(A), []);
  assert.deepEqual(await mias(B), []);
});

console.log('Para borrar la fila "prueba" que dejó avisos_probar: correr dev/supabase/limpiar-pruebas.sql con el MCP supabase-thirdcedi o en el SQL Editor.');
console.log(fallas ? `${fallas} falla(s)` : 'todo ok');
process.exit(fallas ? 1 : 0);
