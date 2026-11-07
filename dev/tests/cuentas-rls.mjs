// RLS, función cargar_gasto y triggers de Cuentas claras (11-cuentas.sql, 17 y 20: objetar) contra el proyecto real, con los usuarios
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

  // ---- Ajustes de cierre (17) ----
  const act2 = await nueva(true);
  await anotar(A, act2.id, 'actividad');
  await anotar(B, act2.id, 'actividad');
  const cancha = await cargar(A, 'A', act2.id, 'actividad', A.id, 1000, 'Cancha', [A.id, B.id]);

  await paso('17: quien no está en las cuentas recibe "No tenés permiso" (el trigger no dice quién figura)', async () => {
    // B no figura en "solo"; C no figura en act2. Antes el trigger contestaba "Esa persona no figura..."
    const r1 = await B.api('POST', 'pagos', { actividad: solo.id, parte: 'actividad', de: B.id, a: A.id, monto: 5 });
    falla(r1, /42501|permiso|row-level security/i);
    assert.doesNotMatch(JSON.stringify(r1.data), /figura/);
    const r2 = await C.api('POST', 'pagos', { actividad: act2.id, parte: 'actividad', de: C.id, a: A.id, monto: 5 });
    falla(r2, /42501|permiso|row-level security/i);
    assert.doesNotMatch(JSON.stringify(r2.data), /figura/);
  });

  await paso('17: el pago tiene que ser entre personas que figuran en ESA parte (B no figura en el tercer tiempo)', async () => {
    const r = await A.api('POST', 'pagos', { actividad: act2.id, parte: 'tercer', de: B.id, a: A.id, monto: 500 });
    if (r.status === 201) pagosDe.A.push(r.data[0].id);
    falla(r, /no figura/);
  });

  await paso('17: "Ya pagué" y "Me pagó" a la vez: se guarda uno solo y el otro dice "Ese pago ya está registrado"', async () => {
    const cuerpo = { actividad: act2.id, parte: 'actividad', de: B.id, a: A.id, monto: 500 };
    const [rb, ra] = await Promise.all([B.api('POST', 'pagos', cuerpo), A.api('POST', 'pagos', cuerpo)]);
    if (rb.status === 201) pagosDe.B.push(rb.data[0].id);
    if (ra.status === 201) pagosDe.A.push(ra.data[0].id);
    const oks = [rb, ra].filter((x) => x.status === 201);
    assert.equal(oks.length, 1, 'se guardaron ' + oks.length + ': ' + JSON.stringify([rb.data, ra.data]));
    falla([rb, ra].find((x) => x.status !== 201), /Ese pago ya está registrado/);
    const ps = (await A.api('GET', `pagos?actividad=eq.${act2.id}&select=id`)).data;
    assert.equal(ps.length, 1);
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

  await paso('20: C, que no tiene nada que ver con el gasto (anotado, pero no pagó ni está en el reparto), no lo borra', async () => {
    const g = await cargar(A, 'A', act.id, 'actividad', A.id, 40, 'Hielo', [A.id, B.id]);
    vacio(await C.api('DELETE', `gastos?id=eq.${g.id}`));
    assert.equal((await A.api('GET', `gastos?id=eq.${g.id}`)).data.length, 1, 'C lo borró');
    // en act2 ("Cancha", entre A y B) C ni siquiera está en las cuentas
    vacio(await C.api('DELETE', `gastos?id=eq.${cancha.id}`));
    assert.equal((await A.api('GET', `gastos?id=eq.${cancha.id}`)).data.length, 1, 'C borró la cancha');
  });

  await paso('20: B, que está en el reparto, borra un gasto que cargó A ("No lo reconozco")', async () => {
    const g = await cargar(A, 'A', act.id, 'actividad', A.id, 60, 'Carbón', [A.id, B.id]);
    const r = await B.api('DELETE', `gastos?id=eq.${g.id}`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.length, 1, 'no borró nada');
    assert.equal((await A.api('GET', `gastos?id=eq.${g.id}`)).data.length, 0);
    assert.equal((await A.api('GET', `gasto_partes?gasto=eq.${g.id}`)).data.length, 0, 'quedó el reparto');
    gastosDe.A = gastosDe.A.filter((x) => x !== g.id);
  });

  await paso('20: quien pagó (sin estar en el reparto) también borra el gasto que cargó otro', async () => {
    const g = await cargar(A, 'A', act.id, 'actividad', B.id, 70, 'Pan', [A.id]);
    const r = await B.api('DELETE', `gastos?id=eq.${g.id}`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.length, 1, 'no borró nada');
    gastosDe.A = gastosDe.A.filter((x) => x !== g.id);
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

  await paso('20: un pago lo borra quien lo cargó o la otra parte; un tercero no', async () => {
    vacio(await C.api('DELETE', `pagos?id=eq.${pagoB.id}`));
    assert.equal((await B.api('GET', `pagos?id=eq.${pagoB.id}`)).data.length, 1, 'C borró un pago entre B y A');
    // B le paga 7 a A; A (la otra parte, no lo cargó) dice "No lo reconozco" y lo borra
    const p = await pagar(B, 'B', { actividad: act.id, parte: 'actividad', de: B.id, a: A.id, monto: 7 });
    const r = await A.api('DELETE', `pagos?id=eq.${p.id}`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.length, 1, 'A no lo pudo borrar');
    pagosDe.B = pagosDe.B.filter((x) => x !== p.id);
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
    falla(r, /El tercer tiempo tiene gastos cargados: pedile a quien los cargó que los borre antes de sacarlo/);
    assert.equal((await A.api('GET', `actividades?id=eq.${act.id}`)).data[0].tiene_tercer, true);
    assert.equal((await A.api('GET', `asistencias?actividad=eq.${act.id}&parte=eq.tercer`)).data.length, 2, 'quitó anotados');
    // con un pago de 'tercer' tampoco
    const pt = await pagar(A, 'A', { actividad: act.id, parte: 'tercer', de: A.id, a: B.id, monto: 1600 });
    assert.equal((await B.api('DELETE', `gastos?id=eq.${gt.id}`)).status, 200);
    gastosDe.B = gastosDe.B.filter((x) => x !== gt.id);
    falla(await A.api('PATCH', `actividades?id=eq.${act.id}`, { tiene_tercer: false, tercer_lugar: null, tercer_fecha: null }), /pagos registrados: pedile a quien los registró que los borre/);
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
