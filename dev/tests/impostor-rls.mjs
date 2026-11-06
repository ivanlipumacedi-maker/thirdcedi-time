// RLS y RPC de El Impostor (dev/supabase/14-impostor.sql) contra el proyecto real, con los usuarios de prueba
// zz-prueba-a/b/c@cedi.com.ar (contraseñas en .env; ver dev/supabase/usuarios-prueba.sql).
// Verifica: nadie lee la palabra ajena ni quién es el impostor antes de revelar (ni por estado_juego, ni por las
// tablas privadas, ni por las internas); no se vota dos veces ni a uno mismo; los votos ajenos no se ven hasta el
// final; con el último voto se revela sola con el resultado de ImpostorLogica.resultado; y Review Focus 5: si se
// va el impostor gana el grupo, y si se va un inocente y quedan 2 con el impostor gana el impostor.
// Al terminar (finally) A, B y C salen de toda partida en la que sigan. Las filas de prueba se borran después con
// dev/supabase/limpiar-pruebas-juegos.sql (MCP supabase-thirdcedi o SQL Editor): la RLS no deja borrarlas.
// Uso: node dev/tests/impostor-rls.mjs
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const I = createRequire(import.meta.url)('../../impostor-logica.js');
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
  const rpc = (fn, args) => api('POST', 'rpc/' + fn, args || {});
  return { l, id: j.user.id, api, rpc };
}
const anon = (fn, args) => fetch(`${BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}) }).then((x) => x.status);

let fallas = 0;
const paso = async (nombre, fn) => {
  try { await fn(); console.log('ok', nombre); } catch (e) { fallas++; console.log('FALLA', nombre, '-', e.message); }
};
const rechazo = (x, re) => { assert.ok(x.status >= 400, 'esperaba error y vino ' + x.status + ' ' + JSON.stringify(x.data)); if (re) assert.match((x.data && x.data.message) || '', re); };

const A = await entrar('A');
const B = await entrar('B');
const C = await entrar('C');
const TODOS = [A, B, C];
const partida = async (u, id) => { const r = await u.api('GET', `partidas?id=eq.${id}&select=*`); assert.equal(r.status, 200); return r.data[0] || null; };
// Arma una partida de Impostor con los tres y la arranca; devuelve el id, las palabras de cada uno y el impostor
// (deducido acá con las tres palabras: el que tiene la distinta; ningún cliente solo puede saberlo).
async function armar() {
  const id = (await A.rpc('crear_partida', { p_juego: 'impostor' })).data;
  assert.ok(id);
  assert.equal((await B.rpc('unirse_partida', { p: id })).status, 204);
  assert.equal((await C.rpc('unirse_partida', { p: id })).status, 204);
  assert.equal((await A.rpc('avanzar_partida', { p: id, p_ronda: 0, p_fase: 'espera' })).status, 200);
  const palabras = {};
  for (const u of TODOS) {
    const r = await u.rpc('mi_palabra', { p: id });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(typeof r.data, 'string');
    palabras[u.l] = r.data;
  }
  const distintas = [...new Set(Object.values(palabras))];
  assert.equal(distintas.length, 2, 'esperaba dos palabras distintas: ' + JSON.stringify(palabras));
  const imp = TODOS.find((u) => Object.values(palabras).filter((w) => w === palabras[u.l]).length === 1);
  return { id, palabras, imp };
}
let par = null;
try {
  await paso('anon no puede llamar a mi_palabra ni a votar', async () => {
    for (const fn of ['mi_palabra', 'votar']) assert.ok([401, 403, 404].includes(await anon(fn, {})), fn);
  });

  await paso('el banco, los secretos y los votos no se escriben directo; banco y secretos no se leen', async () => {
    for (const t of ['impostor_palabras', 'impostor_secretos']) {
      const x = await A.api('GET', `${t}?select=*&limit=1`);
      assert.ok(x.status >= 400 || (Array.isArray(x.data) && x.data.length === 0), t + ' se pudo leer: ' + x.status);
    }
    rechazo(await A.api('POST', 'impostor_palabras', { palabra: 'zz', impostor: 'zz2' }));
    rechazo(await A.api('POST', 'impostor_votos', { partida: '00000000-0000-4000-8000-000000000000', ronda: 1, persona: A.id, voto: B.id }));
  });

  await paso('con 2 jugadores no arranca; en espera no hay palabra', async () => {
    par = (await A.rpc('crear_partida', { p_juego: 'impostor' })).data;
    assert.equal((await B.rpc('unirse_partida', { p: par })).status, 204);
    rechazo(await A.rpc('avanzar_partida', { p: par, p_ronda: 0, p_fase: 'espera' }), /al menos 3/);
    rechazo(await A.rpc('mi_palabra', { p: par }), /No hay palabra/);
    rechazo(await C.rpc('mi_palabra', { p: par }), /No estás/);
    assert.equal((await C.rpc('unirse_partida', { p: par })).status, 204);
  });

  let palabras, imp;
  await paso('con 3 arranca en la fase "palabra"; el estado no trae el impostor ni las palabras', async () => {
    assert.equal((await A.rpc('avanzar_partida', { p: par, p_ronda: 0, p_fase: 'espera' })).status, 200);
    for (const u of TODOS) {
      const p = await partida(u, par);
      assert.equal(p.estado, 'jugando');
      const e = p.estado_juego;
      assert.equal(e.fase, 'palabra'); assert.equal(e.ronda, 1);
      assert.equal(e.limite_ms - e.inicio_ms, I.PALABRA_MS);
      assert.deepEqual([...e.orden].sort(), TODOS.map((x) => x.id).sort());
      for (const k of ['impostor', 'palabra', 'palabra_impostor', 'votos']) assert.ok(!(k in e), 'estado_juego trae ' + k);
    }
  });

  await paso('mi_palabra le da a cada uno solo la suya: 2 iguales y 1 distinta', async () => {
    palabras = {};
    for (const u of TODOS) {
      const r = await u.rpc('mi_palabra', { p: par });
      assert.equal(r.status, 200); assert.equal(typeof r.data, 'string');
      palabras[u.l] = r.data;
    }
    const vals = Object.values(palabras);
    assert.equal(new Set(vals).size, 2, JSON.stringify(palabras));
    imp = TODOS.find((u) => vals.filter((w) => w === palabras[u.l]).length === 1);
    assert.ok(imp);
  });

  await paso('nadie lee la palabra ajena ni quién es el impostor: estado, tablas e internas', async () => {
    for (const u of TODOS) {
      const p = await partida(u, par);
      const txt = JSON.stringify(p);
      for (const w of Object.values(palabras)) assert.ok(!txt.includes(JSON.stringify(w)), u.l + ' ve una palabra en la partida');
      const s = await u.api('GET', `impostor_secretos?partida=eq.${par}&select=*`);
      assert.ok(s.status >= 400 || s.data.length === 0, u.l + ' lee impostor_secretos');
      for (const [fn, args] of [['impostor_terminar', { p_partida: par, p_motivo: 'votacion' }], ['impostor_arrancar', { p_partida: par }],
        ['impostor_avanzar', { p_partida: par, p_uid: u.id }], ['impostor_tras_salida', { p_partida: par }], ['impostor_votaron', { p_partida: par }]]) {
        rechazo(await u.rpc(fn, args));
      }
    }
  });

  await paso('antes de la votación no se vota; B no avanza antes de tiempo; A sí; un pedido viejo no hace nada', async () => {
    rechazo(await B.rpc('votar', { p: par, p_ronda: 1, p_persona: A.id }), /No hay una votación abierta/);
    rechazo(await B.rpc('avanzar_partida', { p: par, p_ronda: 1, p_fase: 'palabra' }), /Todavía no/);
    assert.equal((await A.rpc('avanzar_partida', { p: par, p_ronda: 1, p_fase: 'palabra' })).status, 200);
    let e = (await partida(B, par)).estado_juego;
    assert.equal(e.fase, 'pistas'); assert.equal(e.limite_ms - e.inicio_ms, I.PISTAS_MS);
    assert.equal((await A.rpc('avanzar_partida', { p: par, p_ronda: 1, p_fase: 'palabra' })).status, 200);
    assert.equal((await partida(B, par)).estado_juego.fase, 'pistas', 'el pedido viejo salteó las pistas');
    // la pista va por el chat de la partida
    assert.equal((await B.api('POST', 'mensajes', { sala: 'par:' + par, tipo: 'texto', texto: 'zz mi pista' })).status, 201);
    assert.equal((await A.rpc('avanzar_partida', { p: par, p_ronda: 1, p_fase: 'pistas' })).status, 200);
    e = (await partida(C, par)).estado_juego;
    assert.equal(e.fase, 'votacion'); assert.equal(e.limite_ms - e.inicio_ms, I.VOTACION_MS);
  });

  await paso('el creador no cierra la votación sin votos (ni antes de tiempo): se rechaza y sigue abierta', async () => {
    rechazo(await A.rpc('avanzar_partida', { p: par, p_ronda: 1, p_fase: 'votacion' }), /Todavía no/);
    const p = await partida(A, par);
    assert.equal(p.estado, 'jugando'); assert.equal(p.estado_juego.fase, 'votacion');
    assert.deepEqual(p.estado_juego.votaron, []);
  });

  const votos = new Map();
  await paso('no se vota a uno mismo, ni a alguien de afuera, ni dos veces, ni otra ronda', async () => {
    rechazo(await B.rpc('votar', { p: par, p_ronda: 1, p_persona: B.id }), /No te podés votar/);
    rechazo(await B.rpc('votar', { p: par, p_ronda: 1, p_persona: '00000000-0000-4000-8000-000000000000' }), /no está en la partida/);
    rechazo(await B.rpc('votar', { p: par, p_ronda: 2, p_persona: A.id }), /no es la votación actual/);
    // B vota al impostor (si B es el impostor, a A)
    const aQuien = imp === B ? A : imp;
    assert.equal((await B.rpc('votar', { p: par, p_ronda: 1, p_persona: aQuien.id })).status, 204);
    votos.set(B.id, aQuien.id);
    rechazo(await B.rpc('votar', { p: par, p_ronda: 1, p_persona: C.id }), /Ya votaste/);
  });

  await paso('los votos ajenos no se ven hasta el final: solo quién votó, no a quién', async () => {
    const vA = await A.api('GET', `impostor_votos?partida=eq.${par}&select=*`);
    assert.equal(vA.status, 200); assert.equal(vA.data.length, 0, 'A ve el voto de B');
    const vB = await B.api('GET', `impostor_votos?partida=eq.${par}&select=persona,voto`);
    assert.equal(vB.data.length, 1); assert.equal(vB.data[0].persona, B.id);
    const e = (await partida(A, par)).estado_juego;
    assert.deepEqual(e.votaron, [B.id]);
    assert.ok(!('votos' in e) && !('conteo' in e) && !('impostor' in e));
    rechazo(await B.rpc('avanzar_partida', { p: par, p_ronda: 1, p_fase: 'votacion' }), /Todavía no/);
    // con 1 voto de 3 tampoco la cierra el creador
    rechazo(await A.rpc('avanzar_partida', { p: par, p_ronda: 1, p_fase: 'votacion' }), /Todavía no/);
    assert.equal((await partida(A, par)).estado_juego.fase, 'votacion');
  });

  await paso('con el último voto se revela sola, con el resultado de ImpostorLogica.resultado', async () => {
    const aQuienA = imp === A ? B : imp;
    assert.equal((await A.rpc('votar', { p: par, p_ronda: 1, p_persona: aQuienA.id })).status, 204);
    votos.set(A.id, aQuienA.id);
    assert.equal((await partida(A, par)).estado_juego.fase, 'votacion');
    const aQuienC = A; // C vota a A (sea quien sea el impostor: así a veces hay mayoría y a veces empate)
    assert.equal((await C.rpc('votar', { p: par, p_ronda: 1, p_persona: aQuienC.id })).status, 204);
    votos.set(C.id, aQuienC.id);
    const p = await partida(B, par);
    assert.equal(p.estado, 'terminada');
    const e = p.estado_juego;
    assert.equal(e.fase, 'final'); assert.equal(e.motivo, 'votacion');
    assert.equal(e.impostor, imp.id);
    assert.equal(e.palabra_impostor, palabras[imp.l]);
    assert.equal(e.palabra, palabras[TODOS.find((u) => u !== imp).l]);
    assert.deepEqual(e.votos, Object.fromEntries(votos));
    assert.deepEqual(e.conteo, I.conteo(votos));
    const esp = I.resultado(votos, imp.id);
    assert.equal(e.expulsado, esp.expulsado);
    assert.equal(e.gano, esp.ganoGrupo ? 'grupo' : 'impostor');
    rechazo(await A.rpc('votar', { p: par, p_ronda: 1, p_persona: B.id }), /No hay una votación abierta/);
    rechazo(await A.rpc('mi_palabra', { p: par }), /No hay palabra/);
  });

  await paso('Review Focus 5: si se va el impostor a la mitad, gana el grupo', async () => {
    const x = await armar();
    assert.equal((await x.imp.rpc('salir_partida', { p: x.id })).status, 204);
    const otro = TODOS.find((u) => u !== x.imp);
    const p = await partida(otro, x.id);
    assert.equal(p.estado, 'terminada');
    assert.equal(p.estado_juego.fase, 'final');
    assert.equal(p.estado_juego.gano, 'grupo');
    assert.equal(p.estado_juego.motivo, 'se_fue_impostor');
    assert.equal(p.estado_juego.impostor, x.imp.id);
    assert.equal(I.sigue(TODOS.filter((u) => u !== x.imp).map((u) => u.id), x.imp.id), 'gana_grupo');
  });

  await paso('Review Focus 5: si se va un inocente y quedan 2 con el impostor, gana el impostor', async () => {
    const x = await armar();
    // a la mitad: ya en la votación, con un voto adentro
    assert.equal((await A.rpc('avanzar_partida', { p: x.id, p_ronda: 1, p_fase: 'palabra' })).status, 200);
    assert.equal((await A.rpc('avanzar_partida', { p: x.id, p_ronda: 1, p_fase: 'pistas' })).status, 200);
    const inocentes = TODOS.filter((u) => u !== x.imp);
    assert.equal((await x.imp.rpc('votar', { p: x.id, p_ronda: 1, p_persona: inocentes[0].id })).status, 204);
    assert.equal((await inocentes[1].rpc('salir_partida', { p: x.id })).status, 204);
    const p = await partida(x.imp, x.id);
    assert.equal(p.estado, 'terminada');
    assert.equal(p.estado_juego.gano, 'impostor');
    assert.equal(p.estado_juego.motivo, 'quedan_dos');
    assert.equal(I.sigue([x.imp.id, inocentes[0].id], x.imp.id), 'gana_impostor');
    // el que se fue ya no ve la partida ni su chat
    assert.equal(await partida(inocentes[1], x.id), null);
    assert.equal((await inocentes[1].api('GET', `mensajes?sala=eq.par:${x.id}&select=id`)).data.length, 0);
  });
} finally {
  for (const u of TODOS) {
    const mias = await u.api('GET', `jugadores?persona=eq.${u.id}&se_fue=eq.false&select=partida`);
    for (const x of mias.data || []) await u.rpc('salir_partida', { p: x.partida });
  }
  console.log('Para borrar las filas de prueba: correr dev/supabase/limpiar-pruebas-juegos.sql (MCP supabase-thirdcedi o SQL Editor).');
}
console.log(fallas ? fallas + ' falla(s)' : 'todo ok');
process.exit(fallas ? 1 : 0);
