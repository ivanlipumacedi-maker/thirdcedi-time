// RLS del álbum (tabla fotos, bucket 'album' y RPC de Drive) contra el proyecto real, con usuarios de prueba (zz-prueba-a/b/c@cedi.com.ar).
// Las contraseñas se leen de .env (ZZ_PRUEBA_A_PASSWORD, _B_, _C_); se crean con dev/supabase/usuarios-prueba.sql.
// Escenario: A crea un asado "zz prueba album" y se anota; B se anota; C no se anota.
// Al terminar borra sus fotos y archivos; la actividad queda cancelada y se borra con dev/supabase/limpiar-pruebas.sql.
// Uso: node dev/tests/album-rls.mjs
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const AL = createRequire(import.meta.url)('../../album-logica.js'); // las mismas rutas que el cliente
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
const faltan = ['A', 'B', 'C'].filter((l) => !env['ZZ_PRUEBA_' + l + '_PASSWORD']);
if (faltan.length) {
  console.log('FALTAN las contraseñas de prueba de: ' + faltan.join(', ') + '. Corré dev/supabase/usuarios-prueba.sql en el SQL Editor y copiá las líneas ZZ_PRUEBA_*_PASSWORD al .env.');
  process.exit(2);
}

const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0xff, 0xd9]);
const ruta = (p) => p.split('/').map(encodeURIComponent).join('/');
function cliente(token) {
  const auth = token ? 'Bearer ' + token : 'Bearer ' + KEY;
  const h = { apikey: KEY, Authorization: auth, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  const api = (metodo, r, cuerpo) => fetch(`${BASE}/rest/v1/${r}`, { method: metodo, headers: h, body: cuerpo ? JSON.stringify(cuerpo) : undefined })
    .then(async (x) => ({ status: x.status, data: await x.json().catch(() => null) }));
  const rpc = (fn, args) => api('POST', 'rpc/' + fn, args || {});
  const subir = (p, tipo = 'image/jpeg', cuerpo = JPG, upsert = false) => fetch(`${BASE}/storage/v1/object/album/${ruta(p)}`, { method: 'POST', headers: { apikey: KEY, Authorization: auth, 'Content-Type': tipo, ...(upsert ? { 'x-upsert': 'true' } : {}) }, body: cuerpo });
  const firmar = (p) => fetch(`${BASE}/storage/v1/object/sign/album/${ruta(p)}`, { method: 'POST', headers: { apikey: KEY, Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 60 }) });
  const borrar = (ps) => fetch(`${BASE}/storage/v1/object/album`, { method: 'DELETE', headers: { apikey: KEY, Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: ps }) })
    .then(async (x) => ({ status: x.status, data: await x.json().catch(() => null) }));
  return { api, rpc, subir, firmar, borrar };
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
const en = (horas) => new Date(Date.now() + horas * 3600e3).toISOString();

const A = await entrar('A');
const B = await entrar('B');
const C = await entrar('C');
const anon = cliente(null);
let actId = null;
const archivosA = [];
const filasA = [];
try {
  const r = await A.api('POST', 'actividades', { tipo: 'asado', titulo: 'zz prueba album', fecha: en(24), lugar: 'Quinta de prueba' });
  assert.equal(r.status, 201, 'crear actividad: ' + JSON.stringify(r.data));
  actId = r.data[0].id;
  assert.equal((await A.api('POST', 'asistencias', { actividad: actId, parte: 'actividad' })).status, 201);
  assert.equal((await B.api('POST', 'asistencias', { actividad: actId, parte: 'actividad' })).status, 201);
  const id = crypto.randomUUID();
  const original = AL.rutaFoto(actId, id), mini = AL.rutaMini(original), media = AL.rutaMedia(original);
  const fila = { id, actividad: actId, ruta: original, mini, media, ancho: 4000, alto: 3000, bytes: 3000000, tomada: new Date().toISOString() };

  await paso('Storage: A (anotado) sube original, miniatura y media en la carpeta de la actividad', async () => {
    for (const [p, t] of [[original, 'image/jpeg'], [mini, 'image/webp'], [media, 'image/jpeg']]) {
      const x = await A.subir(p, t);
      assert.equal(x.status, 200, p + ': ' + (await x.text()));
      archivosA.push(p);
    }
  });

  await paso('Storage: C (no anotado) no sube ni firma; nadie sube en subcarpetas, sin carpeta válida o con otro MIME', async () => {
    assert.ok((await C.subir(`${actId}/${crypto.randomUUID()}.jpg`)).status >= 400, 'C subió');
    assert.ok((await C.firmar(original)).status >= 400, 'C firmó');
    assert.ok((await A.subir(`${actId}/sub/${crypto.randomUUID()}.jpg`)).status >= 400, 'subcarpeta');
    assert.ok((await A.subir(`no-es-uuid/${crypto.randomUUID()}.jpg`)).status >= 400, 'carpeta inválida');
    assert.ok((await A.subir(`${crypto.randomUUID()}/${crypto.randomUUID()}.jpg`)).status >= 400, 'carpeta de otra actividad');
    assert.ok((await A.subir(`${actId}/malo.html`, 'text/html', new TextEncoder().encode('<script>'))).status >= 400, 'MIME');
    assert.ok((await anon.subir(`${actId}/${crypto.randomUUID()}.jpg`)).status >= 400, 'anon subió');
  });

  await paso('fotos: A inserta solo sus columnas y el autor sale de auth.uid()', async () => {
    const x = await A.api('POST', 'fotos', fila);
    assert.equal(x.status, 201, JSON.stringify(x.data));
    filasA.push(id);
    assert.equal(x.data[0].autor, A.id);
    assert.equal(x.data[0].liberada, false);
    assert.equal(x.data[0].drive_id, null);
  });

  await paso('fotos: el cliente no puede mandar autor, drive_* ni liberada', async () => {
    for (const extra of [{ autor: B.id }, { drive_id: 'x' }, { drive_error: 'x' }, { drive_tomado: new Date().toISOString() }, { liberada: true }]) {
      const otro = crypto.randomUUID(), o = AL.rutaFoto(actId, otro);
      const x = await A.api('POST', 'fotos', { id: otro, actividad: actId, ruta: o, mini: AL.rutaMini(o), ...extra });
      assert.ok(x.status >= 400, 'aceptó ' + Object.keys(extra)[0]);
    }
  });

  await paso('fotos: rutas de otra actividad o de otro id no pasan; el mismo id no se duplica (409)', async () => {
    const otro = crypto.randomUUID(), ajena = AL.rutaFoto(crypto.randomUUID(), otro);
    assert.ok((await A.api('POST', 'fotos', { id: otro, actividad: actId, ruta: ajena, mini: AL.rutaMini(ajena) })).status >= 400, 'ruta ajena');
    assert.ok((await A.api('POST', 'fotos', { id: otro, actividad: actId, ruta: original, mini })).status >= 400, 'ruta de otro id');
    assert.equal((await A.api('POST', 'fotos', fila)).status, 409);
  });

  await paso('no anotado no ve ni sube: C no inserta ni lee; anon tampoco', async () => {
    const otro = crypto.randomUUID(), o = AL.rutaFoto(actId, otro);
    assert.ok((await C.api('POST', 'fotos', { id: otro, actividad: actId, ruta: o, mini: AL.rutaMini(o) })).status >= 400, 'C insertó');
    assert.deepEqual((await C.api('GET', `fotos?actividad=eq.${actId}`)).data, []);
    const an = await anon.api('GET', `fotos?actividad=eq.${actId}`);
    assert.ok(an.status >= 400 || (Array.isArray(an.data) && an.data.length === 0), 'anon vio fotos');
  });

  await paso('B (anotado) ve la foto y firma los archivos', async () => {
    const x = await B.api('GET', `fotos?actividad=eq.${actId}`);
    assert.equal(x.data.length, 1);
    assert.equal((await B.firmar(original)).status, 200);
    assert.equal((await B.firmar(mini)).status, 200);
  });

  await paso('borrar solo el autor: B no borra la fila ni los archivos de A, ni los pisa con upsert', async () => {
    assert.deepEqual((await B.api('DELETE', `fotos?id=eq.${id}`)).data, []);
    await B.borrar([original]);
    assert.equal((await A.firmar(original)).status, 200, 'el archivo de A sigue');
    assert.ok((await B.subir(original, 'image/jpeg', JPG, true)).status >= 400, 'B pisó el archivo de A');
    assert.equal((await A.subir(original, 'image/jpeg', JPG, true)).status, 200, 'A sí puede volver a subir lo suyo (cola)');
  });

  await paso('RPC de Drive solo para service_role; album_uso sí para miembros', async () => {
    for (const [fn, args] of [['drive_tomar', { p_cuantas: 5 }], ['liberables', { p_cuantas: 5 }], ['espacio_proyecto', {}], ['avisos_config', {}], ['avisos_llamar', { p_body: { tipo: 'drive' } }]]) {
      assert.ok((await A.rpc(fn, args)).status >= 400, fn + ' para authenticated');
      assert.ok((await anon.rpc(fn, args)).status >= 400, fn + ' para anon');
    }
    const u = await A.rpc('album_uso');
    assert.equal(u.status, 200);
    assert.ok(Number(u.data) > 0, 'album_uso mide el espacio del proyecto');
    assert.ok((await anon.rpc('album_uso')).status >= 400, 'album_uso para anon');
  });

  await paso('drive_url: ni el creador la puede escribir', async () => {
    const x = await A.api('PATCH', `actividades?id=eq.${actId}`, { drive_url: 'https://drive.google.com/drive/folders/x' });
    assert.ok(x.status >= 400, 'el creador escribió drive_url');
  });

  await paso('salir de la actividad cierra el álbum: B se baja y ya no ve ni firma', async () => {
    assert.equal((await B.api('DELETE', `asistencias?actividad=eq.${actId}&persona=eq.${B.id}&parte=eq.actividad`)).status, 200);
    assert.deepEqual((await B.api('GET', `fotos?actividad=eq.${actId}`)).data, []);
    assert.ok((await B.firmar(original)).status >= 400);
  });

  await paso('A borra su foto y sus archivos', async () => {
    const x = await A.api('DELETE', `fotos?id=eq.${id}`);
    assert.equal(x.data.length, 1);
    filasA.splice(filasA.indexOf(id), 1);
    const b = await A.borrar([original, mini, media]);
    assert.equal(b.status, 200);
    assert.equal(b.data.length, 3, 'borró los 3 archivos');
    archivosA.length = 0;
  });
} finally {
  for (const f of filasA) await A.api('DELETE', `fotos?id=eq.${f}`);
  if (archivosA.length) await A.borrar(archivosA);
  if (actId) await A.api('PATCH', `actividades?id=eq.${actId}`, { estado: 'cancelada' });
}

console.log('Para borrar la actividad de prueba (las RLS no dejan): correr dev/supabase/limpiar-pruebas.sql con el MCP supabase-thirdcedi o en el SQL Editor.');
console.log(fallas ? `${fallas} falla(s)` : 'todo ok');
process.exit(fallas ? 1 : 0);
