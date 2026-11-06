// RLS y triggers de actividades/asistencias contra el proyecto real, con usuarios de prueba (zz-prueba-a/b/c@cedi.com.ar).
// Las contraseñas se leen de .env (ZZ_PRUEBA_A_PASSWORD, _B_, _C_); se crean con dev/supabase/usuarios-prueba.sql.
// Los pasos marcados "(10)" dependen de dev/supabase/10-actividades-ajustes.sql: fallan hasta que se aplique.
// Uso: node dev/tests/actividades-rls.mjs
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
  return { id: j.user.id, api };
}

let fallas = 0;
const paso = async (nombre, fn) => {
  try { await fn(); console.log('ok', nombre); } catch (e) { fallas++; console.log('FALLA', nombre, '-', e.message); }
};
const en = (horas) => new Date(Date.now() + horas * 3600e3).toISOString();

const A = await entrar('A');
const B = await entrar('B');
const C = await entrar('C');
const creadas = [];
async function nueva(cupo, tercer = true, extra = {}) {
  const r = await A.api('POST', 'actividades', {
    tipo: 'padel', titulo: 'zz prueba rls', fecha: en(24), lugar: 'Club de prueba', cupo,
    tiene_tercer: tercer, tercer_lugar: tercer ? 'Bar de prueba' : null, tercer_fecha: tercer ? en(26) : null, ...extra,
  });
  assert.equal(r.status, 201, 'crear: ' + JSON.stringify(r.data));
  creadas.push(r.data[0].id);
  return r.data[0];
}

try {
  const act = await nueva(2);

  await paso('A crea; creador queda en A aunque mande otro', async () => {
    assert.equal(act.creador, A.id);
    const r = await A.api('POST', 'actividades', { creador: B.id, tipo: 'asado', titulo: 'zz suplantado', fecha: en(5), lugar: 'x' });
    assert.ok(r.status >= 400, 'insertar con creador ajeno debe fallar: ' + r.status);
  });

  await paso('(10) sin grant de insert en creador/persona: mandarlos da permiso denegado, no solo la RLS', async () => {
    const r = await A.api('POST', 'actividades', { creador: A.id, tipo: 'asado', titulo: 'zz con creador', fecha: en(5), lugar: 'x' });
    assert.ok(r.status >= 400, 'insertó mandando creador: ' + r.status);
    assert.match(JSON.stringify(r.data), /permission denied/i);
    const s2 = await A.api('POST', 'asistencias', { actividad: act.id, persona: A.id, parte: 'tercer' });
    assert.ok(s2.status >= 400, 'insertó mandando persona: ' + s2.status);
    assert.match(JSON.stringify(s2.data), /permission denied/i);
  });

  await paso('B lee la actividad de A (miembros leen)', async () => {
    const r = await B.api('GET', `actividades?id=eq.${act.id}`);
    assert.equal(r.data.length, 1);
  });

  await paso('anon no lee actividades ni asistencias', async () => {
    for (const t of ['actividades', 'asistencias']) {
      const x = await fetch(`${BASE}/rest/v1/${t}?select=*`, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
      assert.ok(x.status >= 400 || (await x.json()).length === 0, t + ' visible para anon');
    }
  });

  await paso('B no puede editar la actividad de A', async () => {
    const r = await B.api('PATCH', `actividades?id=eq.${act.id}`, { titulo: 'hack' });
    assert.ok(r.status >= 400 || (Array.isArray(r.data) && r.data.length === 0), 'B editó: ' + JSON.stringify(r.data));
    const v = await A.api('GET', `actividades?id=eq.${act.id}`);
    assert.equal(v.data[0].titulo, 'zz prueba rls');
  });

  await paso('B no puede confirmar ni cancelar la actividad de A', async () => {
    for (const estado of ['confirmada', 'cancelada']) {
      const r = await B.api('PATCH', `actividades?id=eq.${act.id}`, { estado });
      assert.ok(r.status >= 400 || r.data.length === 0, 'B cambió el estado a ' + estado);
    }
    assert.equal((await A.api('GET', `actividades?id=eq.${act.id}`)).data[0].estado, 'abierta');
  });

  await paso('nadie borra actividades (ni A)', async () => {
    const r = await A.api('DELETE', `actividades?id=eq.${act.id}`);
    assert.ok(r.status >= 400 || r.data.length === 0, 'se pudo borrar');
  });

  await paso('el creador no se puede cambiar', async () => {
    const r = await A.api('PATCH', `actividades?id=eq.${act.id}`, { creador: B.id });
    assert.ok(r.status >= 400, 'cambió el creador: ' + r.status);
  });

  await paso('A se anota a sí mismo; B no puede anotar a A ni bajarlo', async () => {
    const ok = await A.api('POST', 'asistencias', { actividad: act.id, parte: 'actividad' });
    assert.equal(ok.status, 201);
    const mal = await B.api('POST', 'asistencias', { actividad: act.id, persona: A.id, parte: 'tercer' });
    assert.ok(mal.status >= 400, 'B anotó a A: ' + mal.status);
    const baja = await B.api('DELETE', `asistencias?actividad=eq.${act.id}&persona=eq.${A.id}&parte=eq.actividad`);
    assert.ok(baja.status >= 400 || baja.data.length === 0, 'B bajó a A');
    assert.equal((await A.api('GET', `asistencias?actividad=eq.${act.id}&parte=eq.actividad`)).data.length, 1);
  });

  await paso('B se anota solo al tercer tiempo y el cupo de la actividad no lo cuenta', async () => {
    const r = await B.api('POST', 'asistencias', { actividad: act.id, parte: 'tercer' });
    assert.equal(r.status, 201);
    assert.equal((await A.api('GET', `asistencias?actividad=eq.${act.id}&parte=eq.actividad`)).data.length, 1);
  });

  await paso('cupo lleno: con cupo 2 entra B y C queda afuera; una baja libera el lugar', async () => {
    assert.equal((await B.api('POST', 'asistencias', { actividad: act.id, parte: 'actividad' })).status, 201);
    const c = await C.api('POST', 'asistencias', { actividad: act.id, parte: 'actividad' });
    assert.ok(c.status >= 400, 'C entró con cupo lleno: ' + c.status);
    assert.match(JSON.stringify(c.data), /cupo/i);
    assert.equal((await C.api('POST', 'asistencias', { actividad: act.id, parte: 'tercer' })).status, 201, 'el tercer tiempo no tiene cupo');
    await B.api('DELETE', `asistencias?actividad=eq.${act.id}&persona=eq.${B.id}&parte=eq.actividad`);
    assert.equal((await C.api('POST', 'asistencias', { actividad: act.id, parte: 'actividad' })).status, 201, 'tras la baja C debería entrar');
  });

  await paso('carrera: con 1 lugar libre, dos altas simultáneas dejan entrar solo una', async () => {
    const a1 = await nueva(1);
    const r = await Promise.all([B.api('POST', 'asistencias', { actividad: a1.id, parte: 'actividad' }), C.api('POST', 'asistencias', { actividad: a1.id, parte: 'actividad' })]);
    const oks = r.filter((x) => x.status === 201).length;
    assert.equal(oks, 1, 'entraron ' + oks);
    assert.equal((await A.api('GET', `asistencias?actividad=eq.${a1.id}&parte=eq.actividad`)).data.length, 1);
  });

  await paso('no hay tercer tiempo si la actividad no lo tiene', async () => {
    const a2 = await nueva(null, false);
    const r = await B.api('POST', 'asistencias', { actividad: a2.id, parte: 'tercer' });
    assert.ok(r.status >= 400, 'se anotó a un tercer tiempo inexistente');
  });

  await paso('anotarse a una actividad cancelada falla (ambas partes)', async () => {
    const a3 = await nueva(5);
    assert.equal((await A.api('PATCH', `actividades?id=eq.${a3.id}`, { estado: 'cancelada' })).status, 200);
    for (const parte of ['actividad', 'tercer']) {
      const r = await B.api('POST', 'asistencias', { actividad: a3.id, parte });
      assert.ok(r.status >= 400, 'B se anotó a cancelada (' + parte + ')');
      assert.match(JSON.stringify(r.data), /cancelada/i);
    }
  });

  const tercerDe = async (id) => (await A.api('GET', `asistencias?actividad=eq.${id}&parte=eq.tercer`)).data.length;
  const actDe = async (id) => (await A.api('GET', `asistencias?actividad=eq.${id}&parte=eq.actividad`)).data.length;
  const sinTercer = { tiene_tercer: false, tercer_lugar: null, tercer_fecha: null };

  await paso('(10) un no creador no puede apagar el tercer tiempo ni editar: los anotados quedan', async () => {
    const a4 = await nueva(5);
    assert.equal((await B.api('POST', 'asistencias', { actividad: a4.id, parte: 'tercer' })).status, 201);
    assert.equal((await C.api('POST', 'asistencias', { actividad: a4.id, parte: 'tercer' })).status, 201);
    const r = await B.api('PATCH', `actividades?id=eq.${a4.id}`, sinTercer);
    assert.ok(r.status >= 400 || r.data.length === 0, 'B apagó el tercer tiempo de A');
    const r2 = await C.api('PATCH', `actividades?id=eq.${a4.id}`, { lugar: 'otro', descripcion: 'hack' });
    assert.ok(r2.status >= 400 || r2.data.length === 0, 'C editó la actividad de A');
    const v = (await A.api('GET', `actividades?id=eq.${a4.id}`)).data[0];
    assert.equal(v.tiene_tercer, true); assert.equal(v.lugar, 'Club de prueba');
    assert.equal(await tercerDe(a4.id), 2);
  });

  await paso('(10) el creador apaga el tercer tiempo: se borran los anotados al tercero y quedan los de la actividad', async () => {
    const a5 = await nueva(5);
    assert.equal((await B.api('POST', 'asistencias', { actividad: a5.id, parte: 'tercer' })).status, 201);
    assert.equal((await C.api('POST', 'asistencias', { actividad: a5.id, parte: 'tercer' })).status, 201);
    assert.equal((await C.api('POST', 'asistencias', { actividad: a5.id, parte: 'actividad' })).status, 201);
    const r = await A.api('PATCH', `actividades?id=eq.${a5.id}`, sinTercer);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(await tercerDe(a5.id), 0, 'quedaron anotados huérfanos al tercer tiempo');
    assert.equal(await actDe(a5.id), 1);
    // y ya no se puede anotar al tercer tiempo
    assert.ok((await B.api('POST', 'asistencias', { actividad: a5.id, parte: 'tercer' })).status >= 400);
  });

  await paso('(10) una cancelada no se edita: ni otro campo, ni confirmarla, ni reactivar cambiando algo más', async () => {
    const a6 = await nueva(5);
    assert.equal((await A.api('PATCH', `actividades?id=eq.${a6.id}`, { estado: 'cancelada' })).status, 200);
    for (const cambio of [{ titulo: 'zz editada cancelada' }, sinTercer, { estado: 'confirmada' }, { estado: 'abierta', titulo: 'zz reactivada y editada' }]) {
      const r = await A.api('PATCH', `actividades?id=eq.${a6.id}`, cambio);
      assert.ok(r.status >= 400, 'aceptó ' + JSON.stringify(cambio) + ' en una cancelada');
      assert.match(JSON.stringify(r.data), /cancelada/i);
    }
    const v = (await A.api('GET', `actividades?id=eq.${a6.id}`)).data[0];
    assert.equal(v.estado, 'cancelada'); assert.equal(v.titulo, 'zz prueba rls'); assert.equal(v.tiene_tercer, true);
  });

  await paso('(10) reactivar: un no creador no puede; el creador sí, y vuelve con los mismos anotados', async () => {
    const a7 = await nueva(5);
    assert.equal((await B.api('POST', 'asistencias', { actividad: a7.id, parte: 'actividad' })).status, 201);
    assert.equal((await C.api('POST', 'asistencias', { actividad: a7.id, parte: 'tercer' })).status, 201);
    assert.equal((await A.api('PATCH', `actividades?id=eq.${a7.id}`, { estado: 'cancelada' })).status, 200);
    assert.equal(await actDe(a7.id), 1, 'cancelar borró anotados'); assert.equal(await tercerDe(a7.id), 1, 'cancelar borró anotados');
    const b = await B.api('PATCH', `actividades?id=eq.${a7.id}`, { estado: 'abierta' });
    assert.ok(b.status >= 400 || b.data.length === 0, 'B reactivó la actividad de A');
    assert.equal((await A.api('GET', `actividades?id=eq.${a7.id}`)).data[0].estado, 'cancelada');
    const r = await A.api('PATCH', `actividades?id=eq.${a7.id}`, { estado: 'abierta' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data[0].estado, 'abierta');
    assert.equal(await actDe(a7.id), 1); assert.equal(await tercerDe(a7.id), 1);
    // reactivada, se puede editar y anotarse de nuevo
    assert.equal((await A.api('PATCH', `actividades?id=eq.${a7.id}`, { descripcion: 'reactivada' })).status, 200);
    assert.equal((await C.api('POST', 'asistencias', { actividad: a7.id, parte: 'actividad' })).status, 201);
  });

  await paso('(10) reactivar no se puede si ya pasó (sin tercer tiempo, o con el tercer tiempo también pasado)', async () => {
    const vieja = await nueva(null, false, { fecha: en(-48) });
    const vieja2 = await nueva(null, true, { fecha: en(-50), tercer_fecha: en(-48) });
    for (const x of [vieja, vieja2]) {
      assert.equal((await A.api('PATCH', `actividades?id=eq.${x.id}`, { estado: 'cancelada' })).status, 200);
      const r = await A.api('PATCH', `actividades?id=eq.${x.id}`, { estado: 'abierta' });
      assert.ok(r.status >= 400, 'reactivó una que ya pasó');
      assert.match(JSON.stringify(r.data), /ya pasó/i);
    }
  });

  await paso('(10) reactivar NO se puede si la actividad pasó aunque el tercer tiempo todavía no (cuenta old.fecha)', async () => {
    const x = await nueva(null, true, { fecha: en(-1), tercer_fecha: en(2) });
    assert.equal((await A.api('PATCH', `actividades?id=eq.${x.id}`, { estado: 'cancelada' })).status, 200);
    const r = await A.api('PATCH', `actividades?id=eq.${x.id}`, { estado: 'abierta' });
    assert.ok(r.status >= 400, 'reactivó una cuya actividad ya pasó (el tercer tiempo no cuenta)');
    assert.match(JSON.stringify(r.data), /ya pasó/i);
    assert.equal((await A.api('GET', `actividades?id=eq.${x.id}`)).data[0].estado, 'cancelada');
  });

  await paso('restricciones de datos: otra sin detalle, tercer incompleto y tercer antes de la actividad', async () => {
    const malas = [
      { tipo: 'otra', titulo: 'x', fecha: en(5), lugar: 'x' },
      { tipo: 'padel', titulo: 'x', fecha: en(5), lugar: 'x', tiene_tercer: true },
      { tipo: 'padel', titulo: 'x', fecha: en(5), lugar: 'x', tiene_tercer: true, tercer_lugar: 'y', tercer_fecha: en(4) },
      { tipo: 'padel', titulo: '  ', fecha: en(5), lugar: 'x' },
      { tipo: 'padel', titulo: 'x', fecha: en(5), lugar: 'x', cupo: 0 },
    ];
    for (const m of malas) assert.ok((await A.api('POST', 'actividades', m)).status >= 400, 'aceptó ' + JSON.stringify(m));
  });
} finally {
  // Las RLS no permiten borrar actividades: las de la prueba quedan canceladas con el título "zz prueba rls"
  // (las que ya estaban canceladas rechazan este PATCH: da igual, ya están como tienen que quedar)
  // (se pueden limpiar a mano con SQL: delete from public.actividades where titulo like 'zz %').
  for (const id of creadas) await A.api('PATCH', `actividades?id=eq.${id}`, { estado: 'cancelada' });
}

console.log(fallas ? `${fallas} falla(s)` : 'todo ok');
process.exit(fallas ? 1 : 0);
