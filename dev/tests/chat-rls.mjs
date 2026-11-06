// RLS del chat (mensajes, en_sala, editar/eliminar y bucket 'chat') contra el proyecto real, con usuarios de prueba (zz-prueba-a/b/c@cedi.com.ar).
// Las contraseñas se leen de .env (ZZ_PRUEBA_A_PASSWORD, _B_, _C_); se crean con dev/supabase/usuarios-prueba.sql.
// Escenario: A crea un pádel con tercer tiempo y se anota a la actividad; B se anota SOLO al tercer tiempo; C no se anota.
// Uso: node dev/tests/chat-rls.mjs
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
const faltan = ['A', 'B', 'C'].filter((l) => !env['ZZ_PRUEBA_' + l + '_PASSWORD']);
if (faltan.length) {
  console.log('FALTAN las contraseñas de prueba de: ' + faltan.join(', ') + '. Corré dev/supabase/usuarios-prueba.sql en el SQL Editor y copiá las líneas ZZ_PRUEBA_*_PASSWORD al .env.');
  process.exit(2);
}

async function entrar(l) {
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `zz-prueba-${l.toLowerCase()}@cedi.com.ar`, password: env['ZZ_PRUEBA_' + l + '_PASSWORD'] }),
  });
  const j = await r.json();
  assert.ok(r.ok && j.access_token, `no pudo entrar ${l}: ${r.status}`);
  const h = { apikey: KEY, Authorization: 'Bearer ' + j.access_token, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  const api = (metodo, ruta, cuerpo) => fetch(`${BASE}/rest/v1/${ruta}`, { method: metodo, headers: h, body: cuerpo ? JSON.stringify(cuerpo) : undefined })
    .then(async (x) => ({ status: x.status, data: await x.json().catch(() => null) }));
  const rpc = (fn, args) => api('POST', 'rpc/' + fn, args);
  const ruta = (p) => p.split('/').map(encodeURIComponent).join('/');
  const subir = (p) => fetch(`${BASE}/storage/v1/object/chat/${ruta(p)}`, { method: 'POST', headers: { apikey: KEY, Authorization: h.Authorization, 'Content-Type': 'image/webp' }, body: new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]) });
  const firmar = (p) => fetch(`${BASE}/storage/v1/object/sign/chat/${ruta(p)}`, { method: 'POST', headers: { apikey: KEY, Authorization: h.Authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 60 }) });
  const borrar = (p) => fetch(`${BASE}/storage/v1/object/chat/${ruta(p)}`, { method: 'DELETE', headers: { apikey: KEY, Authorization: h.Authorization } });
  return { id: j.user.id, api, rpc, subir, firmar, borrar };
}

let fallas = 0;
const paso = async (nombre, fn) => {
  try { await fn(); console.log('ok', nombre); } catch (e) { fallas++; console.log('FALLA', nombre, '-', e.message); }
};
const en = (horas) => new Date(Date.now() + horas * 3600e3).toISOString();

const A = await entrar('A');
const B = await entrar('B');
const C = await entrar('C');
let actId = null;
const mios = { A: [], B: [] };
try {
  const r = await A.api('POST', 'actividades', { tipo: 'padel', titulo: 'zz prueba chat', fecha: en(24), lugar: 'Club de prueba', tiene_tercer: true, tercer_lugar: 'Bar de prueba', tercer_fecha: en(26) });
  assert.equal(r.status, 201, 'crear actividad: ' + JSON.stringify(r.data));
  actId = r.data[0].id;
  assert.equal((await A.api('POST', 'asistencias', { actividad: actId, parte: 'actividad' })).status, 201);
  assert.equal((await B.api('POST', 'asistencias', { actividad: actId, parte: 'tercer' })).status, 201);
  const sala = 'act:' + actId;
  const salaQ = encodeURIComponent(sala);
  const otra = 'act:' + crypto.randomUUID();
  const txt = (s, t) => ({ sala: s, tipo: 'texto', texto: t });

  let mA;
  await paso('A (anotado a la actividad) escribe y lee', async () => {
    const x = await A.api('POST', 'mensajes', txt(sala, 'hola desde A'));
    assert.equal(x.status, 201, JSON.stringify(x.data));
    mA = x.data[0]; mios.A.push(mA.id);
    assert.equal(mA.autor, A.id);
    assert.equal((await A.api('GET', `mensajes?sala=eq.${salaQ}`)).data.length, 1);
  });

  await paso('B (anotado solo al tercer tiempo) lee y escribe', async () => {
    assert.equal((await B.api('GET', `mensajes?sala=eq.${salaQ}`)).data.length, 1);
    const x = await B.api('POST', 'mensajes', txt(sala, 'hola desde B'));
    assert.equal(x.status, 201, JSON.stringify(x.data));
    mios.B.push(x.data[0].id);
  });

  await paso('C (no anotado) no lee ni escribe en la sala', async () => {
    const l = await C.api('GET', `mensajes?sala=eq.${salaQ}`);
    assert.equal(l.status, 200);
    assert.equal(l.data.length, 0, 'C leyó mensajes');
    const e = await C.api('POST', 'mensajes', txt(sala, 'intruso'));
    assert.ok(e.status >= 400, 'C escribió: ' + e.status);
  });

  await paso('nadie escribe en una sala donde no está, ni con un uuid mal formado, ni en una partida (Task 7)', async () => {
    assert.ok((await A.api('POST', 'mensajes', txt(otra, 'x'))).status >= 400);
    assert.ok((await A.api('POST', 'mensajes', txt('act:no-es-uuid', 'x'))).status >= 400);
    assert.ok((await A.api('POST', 'mensajes', txt('par:' + crypto.randomUUID(), 'x'))).status >= 400, 'las salas de partida siguen cerradas hasta la Task 7');
  });

  await paso('no se escribe como otra persona, ni "eliminado", ni texto vacío', async () => {
    assert.ok((await A.api('POST', 'mensajes', { ...txt(sala, 'suplanto'), autor: B.id })).status >= 400);
    assert.ok((await A.api('POST', 'mensajes', { sala, tipo: 'eliminado' })).status >= 400);
    assert.ok((await A.api('POST', 'mensajes', txt(sala, '   '))).status >= 400, 'texto vacío');
  });

  await paso('UPDATE y DELETE directos están denegados (incluso al autor)', async () => {
    const u = await A.api('PATCH', `mensajes?id=eq.${mA.id}`, { texto: 'hack' });
    assert.ok(u.status >= 400 || (Array.isArray(u.data) && u.data.length === 0), 'UPDATE directo: ' + u.status);
    const d = await A.api('DELETE', `mensajes?id=eq.${mA.id}`);
    assert.ok(d.status >= 400 || (Array.isArray(d.data) && d.data.length === 0), 'DELETE directo: ' + d.status);
    assert.equal((await A.api('GET', `mensajes?id=eq.${mA.id}`)).data[0].texto, 'hola desde A');
  });

  await paso('anon no lee mensajes', async () => {
    const x = await fetch(`${BASE}/rest/v1/mensajes?select=*`, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
    assert.ok(x.status >= 400 || (await x.json()).length === 0);
  });

  await paso('B no edita ni elimina el mensaje de A; A sí edita el suyo (editado = true)', async () => {
    assert.ok((await B.rpc('editar_mensaje', { p_id: mA.id, p_texto: 'hack' })).status >= 400);
    assert.ok((await B.rpc('eliminar_mensaje', { p_id: mA.id })).status >= 400);
    const e = await A.rpc('editar_mensaje', { p_id: mA.id, p_texto: 'hola desde A (editado)' });
    assert.equal(e.status, 200, JSON.stringify(e.data));
    assert.equal(e.data.editado, true);
    assert.equal((await B.api('GET', `mensajes?id=eq.${mA.id}`)).data[0].texto, 'hola desde A (editado)');
  });

  let foto;
  await paso('B sube una foto a la carpeta de la sala y la manda; C no puede subir ni firmar', async () => {
    foto = `${sala}/fotos/${crypto.randomUUID()}.webp`;
    const up = await B.subir(foto);
    assert.equal(up.status, 200, await up.text());
    const m = await B.api('POST', 'mensajes', { sala, tipo: 'foto', archivo: foto, ancho: 800, alto: 600 });
    assert.equal(m.status, 201, JSON.stringify(m.data));
    mios.B.push(m.data[0].id);
    assert.equal((await B.firmar(foto)).status, 200, 'B firma su foto');
    assert.equal((await A.firmar(foto)).status, 200, 'A (en la sala) ve la foto');
    assert.ok((await C.firmar(foto)).status >= 400, 'C firmó una foto de una sala ajena');
    assert.ok((await C.subir(`${sala}/fotos/c.webp`)).status >= 400, 'C subió a la sala');
    assert.ok((await B.subir(`${otra}/fotos/b.webp`)).status >= 400, 'B subió a una sala donde no está');
    assert.ok((await B.api('POST', 'mensajes', { sala, tipo: 'foto', archivo: `${otra}/fotos/x.webp`, ancho: 1, alto: 1 })).status >= 400, 'foto que apunta a otra sala');
  });

  await paso('A no borra la foto de B del bucket; B sí, al eliminar su mensaje', async () => {
    await A.borrar(foto);
    assert.equal((await B.firmar(foto)).status, 200, 'la foto de B tendría que seguir ahí');
    const idFoto = mios.B[mios.B.length - 1];
    const el = await B.rpc('eliminar_mensaje', { p_id: idFoto });
    assert.equal(el.status, 200, JSON.stringify(el.data));
    assert.equal(el.data.fila.tipo, 'eliminado');
    assert.equal(el.data.archivo_antes, foto);
    assert.equal(el.data.fila.archivo, null);
    await B.borrar(foto);
    assert.ok((await B.firmar(foto)).status >= 400, 'la foto debería haberse borrado');
  });

  await paso('salir de la actividad cierra el chat: B se baja y ya no lee ni escribe', async () => {
    for (const id of mios.B) await B.rpc('eliminar_mensaje', { p_id: id }); // limpieza antes de bajarse (después ya no podría)
    assert.equal((await B.api('DELETE', `asistencias?actividad=eq.${actId}&persona=eq.${B.id}&parte=eq.tercer`)).status, 200);
    assert.equal((await B.api('GET', `mensajes?sala=eq.${salaQ}`)).data.length, 0);
    assert.ok((await B.api('POST', 'mensajes', txt(sala, 'ya no estoy'))).status >= 400);
  });
} finally {
  // Los mensajes y las actividades no se borran: los mensajes quedan marcados como eliminados por su autor
  // y la actividad queda cancelada con título "zz ..." (se limpia a mano con SQL: delete from public.actividades where titulo like 'zz %').
  for (const id of mios.A) await A.rpc('eliminar_mensaje', { p_id: id });
  for (const id of mios.B) await B.rpc('eliminar_mensaje', { p_id: id });
  if (actId) await A.api('PATCH', `actividades?id=eq.${actId}`, { estado: 'cancelada' });
}

console.log(fallas ? `${fallas} falla(s)` : 'todo ok');
process.exit(fallas ? 1 : 0);
