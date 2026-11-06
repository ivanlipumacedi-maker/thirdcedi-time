// RLS, función cargar_gasto y triggers de Cuentas claras (11-cuentas.sql) contra el proyecto real, con los usuarios
// de prueba zz-prueba-a/b/c@cedi.com.ar. Las contraseñas se leen de .env (ZZ_PRUEBA_A_PASSWORD, _B_, _C_).
// Las actividades de la prueba quedan canceladas con título "zz prueba cuentas"; los gastos y pagos se borran al final.
// Uso: node dev/tests/cuentas-rls.mjs
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const BASE = 'https://qvezbnkrfqewanlcejha.supabase.co';
const KEY = 'sb_publishable_nHg5W-1bGZwudTST-ejzeA_w_gUNYXQ';
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CL = createRequire(import.meta.url)(join(raiz, 'cuentas-logica.js'));

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
  return { id: j.user.id, api, gasto: (act, parte, pagador, monto, concepto, personas) => api('POST', 'rpc/cargar_gasto', { p_actividad: act, p_parte: parte, p_pagador: pagador, p_monto: monto, p_concepto: concepto, p_personas: personas }) };
}

let fallas = 0;
const paso = async (nombre, fn) => {
  try { await fn(); console.log('ok', nombre); } catch (e) { fallas++; console.log('FALLA', nombre, '-', e.message); }
};
const en = (horas) => new Date(Date.now() + horas * 3600e3).toISOString();
const falla = (r, re, msg) => { assert.ok(r.status >= 400, (msg || 'tenía que fallar') + ': ' + r.status + ' ' + JSON.stringify(r.data)); if (re) assert.match(JSON.stringify(r.data), re); };
const vacio = (r) => assert.ok(r.status >= 400 || (Array.isArray(r.data) && r.data.length === 0), 'se vio: ' + JSON.stringify(r.data));

const A = await entrar('A');
const B = await entrar('B');
const C = await entrar('C');
const creadas = [];
const gastosDe = { A: [], B: [], C: [] };
const pagosDe = { A: [], B: [], C: [] };
async function nueva(tercer = true) {
  const r = await A.api('POST', 'actividades', {
    tipo: 'asado', titulo: 'zz prueba cuentas', fecha: en(24), lugar: 'Quincho de prueba',
    tiene_tercer: tercer, tercer_lugar: tercer ? 'Bar de prueba' : null, tercer_fecha: tercer ? en(26) : null,
  });
  assert.equal(r.status, 201, 'crear: ' + JSON.stringify(r.data));
  creadas.push(r.data[0].id);
  return r.data[0];
}
const anotar = async (U, act, parte) => assert.equal((await U.api('POST', 'asistencias', { actividad: act, parte })).status, 201, 'anotar');
const cargar = async (U, letra, ...args) => {
  const r = await U.gasto(...args);
  assert.equal(r.status, 200, 'cargar_gasto: ' + JSON.stringify(r.data));
  gastosDe[letra].push(r.data.id);
  return r.data;
};
const pagar = async (U, letra, cuerpo) => {
  const r = await U.api('POST', 'pagos', cuerpo);
  assert.equal(r.status, 201, 'pago: ' + JSON.stringify(r.data));
  pagosDe[letra].push(r.data[0].id);
  return r.data[0];
};

try {
  const act = await nueva(true);
  await anotar(A, act.id, 'actividad');
  await anotar(B, act.id, 'actividad');
  await anotar(C, act.id, 'actividad');
  let g1;

  await paso('A carga $1.000 entre A, B y C: queda el gasto con su reparto y lo cargó A', async () => {
    g1 = await cargar(A, 'A', act.id, 'actividad', A.id, 1000, '  Carne  ', [A.id, B.id, C.id, A.id]);
    assert.equal(g1.cargado_por, A.id);
    assert.equal(g1.concepto, 'Carne');
    const p = await B.api('GET', `gasto_partes?gasto=eq.${g1.id}&select=persona`);
    assert.equal(p.data.length, 3, 'reparto: ' + JSON.stringify(p.data));
  });

  await paso('Review Focus 2: con los datos de la base, los saldos suman 0 (334/333/333)', async () => {
    const gs = (await B.api('GET', `gastos?actividad=eq.${act.id}&select=id,parte,pagador,monto`)).data;
    const ps = (await B.api('GET', `gasto_partes?gasto=in.(${gs.map((x) => x.id).join(',')})&select=gasto,persona`)).data;
    const s = CL.saldos(gs, ps, []);
    assert.equal([...s.values()].reduce((a, b) => a + b, 0), 0);
    const rep = CL.repartir(1000, [A.id, B.id, C.id]);
    assert.deepEqual([...rep.values()].sort(), [333, 333, 334]);
    assert.equal(s.get(A.id), 1000 - rep.get(A.id));
    assert.equal(s.get(B.id), -rep.get(B.id));
    assert.equal(s.get(C.id), -rep.get(C.id));
  });

  await paso('no se escribe directo en gastos ni en gasto_partes (solo con cargar_gasto)', async () => {
    falla(await A.api('POST', 'gastos', { actividad: act.id, parte: 'actividad', pagador: A.id, monto: 5, concepto: 'x' }), /permission denied|42501/i);
    falla(await A.api('POST', 'gasto_partes', { gasto: g1.id, persona: B.id }), /permission denied|42501/i);
    falla(await A.api('PATCH', `gastos?id=eq.${g1.id}`, { monto: 1 }), /permission denied|42501/i);
  });

  await paso('validaciones de cargar_gasto: monto, concepto, parte, personas y pagador', async () => {
    falla(await A.gasto(act.id, 'actividad', A.id, 0, 'x', [A.id]), /monto/i);
    falla(await A.gasto(act.id, 'actividad', A.id, -5, 'x', [A.id]), /monto/i);
    falla(await A.gasto(act.id, 'actividad', A.id, 100000001, 'x', [A.id]), /monto/i);
    falla(await A.gasto(act.id, 'actividad', A.id, 10.5, 'x', [A.id]));
    falla(await A.gasto(act.id, 'actividad', A.id, 10, '   ', [A.id]), /concepto/i);
    falla(await A.gasto(act.id, 'actividad', A.id, 10, 'x'.repeat(81), [A.id]), /concepto/i);
    falla(await A.gasto(act.id, 'actividad', A.id, 10, 'x', []), /entre qui/i);
    falla(await A.gasto(act.id, 'otra', A.id, 10, 'x', [A.id]), /parte/i);
    // nadie está anotado al tercer tiempo todavía
    falla(await A.gasto(act.id, 'tercer', A.id, 10, 'x', [A.id]), /anotado/i);
  });

  const solo = await nueva(false);
  await anotar(A, solo.id, 'actividad');
  await paso('en "tercer" solo si la actividad tiene tercer tiempo', async () => {
    falla(await A.gasto(solo.id, 'tercer', A.id, 10, 'x', [A.id]), /no tiene tercer tiempo/i);
  });

  await paso('quien no está anotado no carga; pagador y reparto tienen que estar anotados a esa parte', async () => {
    falla(await B.gasto(solo.id, 'actividad', A.id, 10, 'x', [A.id]), /anotados pueden cargar/i);
    falla(await A.gasto(solo.id, 'actividad', B.id, 10, 'x', [A.id]), /Quien pagó/i);
    falla(await A.gasto(solo.id, 'actividad', A.id, 10, 'x', [A.id, B.id]), /anotados a esa parte/i);
  });

  await paso('quien no está en las cuentas (B en "solo") no las ve; anon tampoco', async () => {
    const g = await cargar(A, 'A', solo.id, 'actividad', A.id, 500, 'Leña', [A.id]);
    vacio(await B.api('GET', `gastos?actividad=eq.${solo.id}`));
    vacio(await B.api('GET', `gasto_partes?gasto=eq.${g.id}`));
    for (const t of ['gastos', 'gasto_partes', 'pagos']) {
      const x = await fetch(`${BASE}/rest/v1/${t}?select=*`, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
      assert.ok(x.status >= 400 || (await x.json()).length === 0, t + ' visible para anon');
    }
  });

  await paso('borrar un gasto: solo quien lo cargó (B no puede borrar el de A)', async () => {
    vacio(await B.api('DELETE', `gastos?id=eq.${g1.id}`));
    assert.equal((await A.api('GET', `gastos?id=eq.${g1.id}`)).data.length, 1);
  });

  let pagoB;
  await paso('pago: lo registra el deudor (B le paga a A)', async () => {
    pagoB = await pagar(B, 'B', { actividad: act.id, parte: 'actividad', de: B.id, a: A.id, monto: 333 });
    assert.equal(pagoB.cargado_por, B.id);
  });

  await paso('pago: también el acreedor ("Me pagó": A registra que C le pagó)', async () => {
    await pagar(A, 'A', { actividad: act.id, parte: 'actividad', de: C.id, a: A.id, monto: 1 });
  });

  await paso('pago: B no registra un pago entre otros dos, ni a sí mismo, ni con cargado_por ajeno', async () => {
    falla(await B.api('POST', 'pagos', { actividad: act.id, parte: 'actividad', de: C.id, a: A.id, monto: 5 }));
    falla(await B.api('POST', 'pagos', { actividad: act.id, parte: 'actividad', de: B.id, a: B.id, monto: 5 }));
    falla(await B.api('POST', 'pagos', { actividad: act.id, parte: 'actividad', de: B.id, a: A.id, monto: 5, cargado_por: A.id }), /permission denied|42501/i);
    falla(await B.api('POST', 'pagos', { actividad: act.id, parte: 'actividad', de: B.id, a: A.id, monto: 0 }));
  });

  await paso('pago: las dos personas tienen que figurar en las cuentas de la actividad', async () => {
    // en "solo" B no figura: A no puede registrar un pago con B
    falla(await A.api('POST', 'pagos', { actividad: solo.id, parte: 'actividad', de: B.id, a: A.id, monto: 5 }));
  });

  await paso('borrar un pago: solo quien lo cargó', async () => {
    vacio(await A.api('DELETE', `pagos?id=eq.${pagoB.id}`));
    assert.equal((await B.api('GET', `pagos?id=eq.${pagoB.id}`)).data.length, 1);
  });

  await paso('Review Focus 3: C se baja y sigue viendo su deuda (gastos, reparto y pagos) y puede pagarla', async () => {
    assert.equal((await C.api('DELETE', `asistencias?actividad=eq.${act.id}&persona=eq.${C.id}`)).status, 200);
    const gs = (await C.api('GET', `gastos?actividad=eq.${act.id}`)).data;
    assert.ok(gs.some((x) => x.id === g1.id), 'C ya no ve el gasto');
    assert.equal((await C.api('GET', `gasto_partes?gasto=eq.${g1.id}`)).data.length, 3);
    assert.ok((await C.api('GET', `pagos?actividad=eq.${act.id}`)).data.length >= 2);
    await pagar(C, 'C', { actividad: act.id, parte: 'actividad', de: C.id, a: A.id, monto: 332 });
    // pero ya no puede cargar gastos (no está anotado)
    falla(await C.gasto(act.id, 'actividad', C.id, 10, 'x', [C.id]), /anotados pueden cargar/i);
  });

  await paso('apagar el tercer tiempo con gastos de "tercer" se rechaza con el motivo, y no quita a nadie', async () => {
    await anotar(A, act.id, 'tercer');
    await anotar(B, act.id, 'tercer');
    const gt = await cargar(B, 'B', act.id, 'tercer', B.id, 3200, 'Cerveza', [A.id, B.id]);
    const r = await A.api('PATCH', `actividades?id=eq.${act.id}`, { tiene_tercer: false, tercer_lugar: null, tercer_fecha: null });
    falla(r, /El tercer tiempo tiene gastos cargados: borralos antes de sacarlo/);
    assert.equal((await A.api('GET', `actividades?id=eq.${act.id}`)).data[0].tiene_tercer, true);
    assert.equal((await A.api('GET', `asistencias?actividad=eq.${act.id}&parte=eq.tercer`)).data.length, 2, 'quitó anotados');
    // con un pago de 'tercer' tampoco
    const pt = await pagar(A, 'A', { actividad: act.id, parte: 'tercer', de: A.id, a: B.id, monto: 1600 });
    assert.equal((await B.api('DELETE', `gastos?id=eq.${gt.id}`)).status, 200);
    gastosDe.B = gastosDe.B.filter((x) => x !== gt.id);
    falla(await A.api('PATCH', `actividades?id=eq.${act.id}`, { tiene_tercer: false, tercer_lugar: null, tercer_fecha: null }), /pagos registrados/);
    assert.equal((await A.api('DELETE', `pagos?id=eq.${pt.id}`)).status, 200);
    pagosDe.A = pagosDe.A.filter((x) => x !== pt.id);
    // sin nada en 'tercer', se apaga (y la 10 quita a sus anotados)
    const ok = await A.api('PATCH', `actividades?id=eq.${act.id}`, { tiene_tercer: false, tercer_lugar: null, tercer_fecha: null });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal((await A.api('GET', `asistencias?actividad=eq.${act.id}&parte=eq.tercer`)).data.length, 0);
  });

  await paso('cancelada: no se cargan gastos nuevos, pero los pagos sí', async () => {
    assert.equal((await A.api('PATCH', `actividades?id=eq.${act.id}`, { estado: 'cancelada' })).status, 200);
    falla(await A.gasto(act.id, 'actividad', A.id, 10, 'x', [A.id]), /cancelada/i);
    await pagar(B, 'B', { actividad: act.id, parte: 'actividad', de: B.id, a: A.id, monto: 1 });
    assert.ok((await B.api('GET', `gastos?actividad=eq.${act.id}`)).data.length >= 1, 'las cuentas se siguen viendo');
  });

  await paso('en_cuentas: true para A y para C (se bajó pero figura); false para B en "solo"', async () => {
    assert.equal((await A.api('POST', 'rpc/en_cuentas', { p_actividad: act.id })).data, true);
    assert.equal((await C.api('POST', 'rpc/en_cuentas', { p_actividad: act.id })).data, true);
    assert.equal((await B.api('POST', 'rpc/en_cuentas', { p_actividad: solo.id })).data, false);
  });

  await paso('figura_en_cuentas y anotado_a no se exponen', async () => {
    falla(await B.api('POST', 'rpc/figura_en_cuentas', { p_actividad: act.id, p_persona: A.id }));
    falla(await B.api('POST', 'rpc/anotado_a', { p_actividad: act.id, p_persona: A.id, p_parte: 'actividad' }));
  });
} finally {
  const U = { A, B, C };
  for (const l of ['A', 'B', 'C']) {
    for (const id of pagosDe[l]) await U[l].api('DELETE', `pagos?id=eq.${id}`);
    for (const id of gastosDe[l]) await U[l].api('DELETE', `gastos?id=eq.${id}`);
  }
  for (const id of creadas) await A.api('PATCH', `actividades?id=eq.${id}`, { estado: 'cancelada' });
}

console.log('Para borrar las actividades de prueba (las RLS no dejan): correr dev/supabase/limpiar-pruebas.sql con el MCP supabase-thirdcedi o en el SQL Editor.');
console.log(fallas ? `${fallas} falla(s)` : 'todo ok');
process.exit(fallas ? 1 : 0);
