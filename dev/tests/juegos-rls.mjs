// RLS y RPC de Juegos (partidas, jugadores, respuestas, Trivia y chat 'par:') contra el proyecto real, con los
// usuarios de prueba zz-prueba-a/b/c@cedi.com.ar (contraseñas en .env; ver dev/supabase/usuarios-prueba.sql).
// Escenario: A arma una Trivia, B se une, C mira de afuera.
// Al terminar, en el finally, A y B salen de la partida (así no queda abierta en la lista de nadie). Las filas
// quedan "terminadas"; la RLS no deja borrarlas desde la API: se borran con dev/supabase/limpiar-pruebas-juegos.sql
// (MCP supabase-thirdcedi o SQL Editor).
// Tarda unos 30 s: espera a que venza el tiempo de una pregunta (15 s + 1 s de gracia).
// Uso: node dev/tests/juegos-rls.mjs
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const T = createRequire(import.meta.url)('../../trivia-logica.js'); // la misma fórmula de puntos que el servidor
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
  return { id: j.user.id, api, rpc, token: j.access_token };
}
// Escucha el canal privado 'juegos-lista' por el websocket de Realtime (protocolo Phoenix, sin supabase-js) y junta
// los broadcasts que llegan. Devuelve { recibidos, cerrar }.
async function escucharLista(u) {
  const ws = new WebSocket(`${BASE.replace('https', 'wss')}/realtime/v1/websocket?apikey=${KEY}&vsn=1.0.0`);
  const recibidos = [];
  let unido;
  const listo = new Promise((res, rej) => { unido = { res, rej }; setTimeout(() => rej(new Error('no se unió al canal')), 10000); });
  ws.onmessage = (m) => {
    const x = JSON.parse(m.data);
    if (x.event === 'phx_reply' && x.ref === '1') { if (x.payload.status === 'ok') unido.res(); else unido.rej(new Error(JSON.stringify(x.payload))); }
    if (x.event === 'broadcast') recibidos.push(x.payload);
  };
  await new Promise((res) => { ws.onopen = res; });
  ws.send(JSON.stringify({ topic: 'realtime:juegos-lista', event: 'phx_join', ref: '1', join_ref: '1',
    payload: { config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: [], private: true }, access_token: u.token } }));
  await listo;
  const latido = setInterval(() => ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: 'h' })), 20000);
  return { recibidos, cerrar: () => { clearInterval(latido); ws.close(); } };
}
const anon = (fn, args) => fetch(`${BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}) }).then((x) => x.status);

let fallas = 0;
const paso = async (nombre, fn) => {
  try { await fn(); console.log('ok', nombre); } catch (e) { fallas++; console.log('FALLA', nombre, '-', e.message); }
};
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const rechazo = (x, re) => { assert.ok(x.status >= 400, 'esperaba error y vino ' + x.status + ' ' + JSON.stringify(x.data)); if (re) assert.match((x.data && x.data.message) || '', re); };

const A = await entrar('A');
const B = await entrar('B');
const C = await entrar('C');
let par = null;
const partida = async (u) => { const r = await u.api('GET', `partidas?id=eq.${par}&select=*`); assert.equal(r.status, 200); return r.data[0] || null; };
try {
  await paso('anon no puede llamar a las RPC de juegos', async () => {
    for (const fn of ['crear_partida', 'unirse_partida', 'salir_partida', 'avanzar_partida', 'responder', 'ahora_ms']) {
      assert.ok([401, 403, 404].includes(await anon(fn, {})), fn);
    }
  });

  await paso('nadie escribe directo en las tablas (todo por RPC)', async () => {
    rechazo(await A.api('POST', 'partidas', { juego: 'trivia' }));
    rechazo(await A.api('POST', 'trivia_preguntas', { id: 'zz-1', cat: 'x', dif: 1, p: 'x', ops: ['a', 'b', 'c', 'd'], ok: 0 }));
  });

  await paso('A crea una Trivia y queda como jugador', async () => {
    const r = await A.rpc('crear_partida', { p_juego: 'trivia' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    par = r.data;
    const p = await partida(A);
    assert.equal(p.estado, 'espera'); assert.equal(p.creador, A.id);
    const j = await A.api('GET', `jugadores?partida=eq.${par}&select=persona`);
    assert.deepEqual(j.data.map((x) => x.persona), [A.id]);
  });

  await paso('juego inválido → error', async () => { rechazo(await A.rpc('crear_partida', { p_juego: 'truco' })); });

  await paso('C (miembro) ve la partida en espera y sus jugadores, pero no su chat', async () => {
    assert.ok(await partida(C));
    assert.equal((await C.api('GET', `jugadores?partida=eq.${par}&select=persona`)).data.length, 1);
    assert.equal((await C.api('GET', `mensajes?sala=eq.par:${par}&select=id`)).data.length, 0);
    rechazo(await C.api('POST', 'mensajes', { sala: 'par:' + par, tipo: 'texto', texto: 'zz no jugador' }));
  });

  await paso('B se une y puede escribir y leer en el chat de la partida', async () => {
    assert.equal((await B.rpc('unirse_partida', { p: par })).status, 204);
    const m = await B.api('POST', 'mensajes', { sala: 'par:' + par, tipo: 'texto', texto: 'zz hola partida' });
    assert.equal(m.status, 201, JSON.stringify(m.data));
    assert.equal((await A.api('GET', `mensajes?sala=eq.par:${par}&select=id`)).data.length, 1);
  });

  await paso('solo el creador arranca la partida', async () => {
    rechazo(await B.rpc('avanzar_partida', { p: par, p_ronda: 0, p_fase: 'espera' }), /Solo quien armó/);
    assert.equal((await partida(A)).estado, 'espera');
  });

  let e1;
  await paso('A arranca: pregunta 1 sin la respuesta correcta ni el id de la pregunta', async () => {
    const r = await A.rpc('avanzar_partida', { p: par, p_ronda: 0, p_fase: 'espera' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const p = await partida(B);
    assert.equal(p.estado, 'jugando');
    e1 = p.estado_juego;
    assert.equal(e1.fase, 'pregunta'); assert.equal(e1.ronda, 1); assert.equal(e1.total, 10);
    assert.equal(e1.pregunta.ops.length, 4);
    assert.ok(!('ok' in e1), 'estado_juego trae ok antes de revelar');
    assert.ok(!('id' in e1.pregunta) && !('ok' in e1.pregunta), 'la pregunta trae id u ok');
    assert.ok(!/"ok"/.test(JSON.stringify(e1)));
    assert.equal(e1.limite_ms - e1.inicio_ms, T.PREGUNTA_MS);
  });

  await paso('la respuesta correcta no se puede leer: banco, preguntas elegidas e internas cerradas', async () => {
    for (const t of ['trivia_preguntas', 'trivia_secretos', 'trivia_vistas']) {
      const x = await B.api('GET', `${t}?select=*&limit=1`);
      assert.ok(x.status >= 400 || (Array.isArray(x.data) && x.data.length === 0), t + ' se pudo leer: ' + x.status);
    }
    for (const [fn, args] of [['trivia_revelar', { p: par }], ['trivia_siguiente', { p: par }], ['trivia_estado_pregunta', { p: par, ronda: 1, total: 10 }],
      ['trivia_elegir', { p_partida: par }], ['trivia_marcar_vista', { p_partida: par, p_ronda: 1 }], ['trivia_arrancar', { p: par }],
      ['trivia_avanzar', { p: par, p_uid: B.id }], ['juegos_avisar_lista', { p: par }]]) {
      rechazo(await B.rpc(fn, args));
    }
  });

  await paso('C ya no ve la partida en curso, ni sus jugadores, ni su chat', async () => {
    assert.equal(await partida(C), null);
    assert.equal((await C.api('GET', `jugadores?partida=eq.${par}&select=persona`)).data.length, 0);
    assert.equal((await C.api('GET', `mensajes?sala=eq.par:${par}&select=id`)).data.length, 0);
    rechazo(await C.api('POST', 'mensajes', { sala: 'par:' + par, tipo: 'texto', texto: 'zz no jugador' }));
    rechazo(await C.rpc('unirse_partida', { p: par }), /ya empezó/);
    rechazo(await C.rpc('responder', { p: par, p_ronda: 1, p_opcion: 0 }), /No estás/);
    rechazo(await C.rpc('avanzar_partida', { p: par }), /No estás/);
  });

  await paso('B (no creador) no puede avanzar a mano antes de tiempo', async () => {
    rechazo(await B.rpc('avanzar_partida', { p: par, p_ronda: 1, p_fase: 'pregunta' }), /Todavía no/);
  });

  await paso('B responde la 1; no puede responder dos veces ni otra ronda; ve solo su respuesta', async () => {
    assert.equal((await B.rpc('responder', { p: par, p_ronda: 1, p_opcion: 2 })).status, 204);
    rechazo(await B.rpc('responder', { p: par, p_ronda: 1, p_opcion: 1 }), /Ya respondiste/);
    rechazo(await B.rpc('responder', { p: par, p_ronda: 2, p_opcion: 1 }), /no es la pregunta actual/);
    rechazo(await B.rpc('responder', { p: par, p_ronda: 1, p_opcion: 7 }));
    const mias = await B.api('GET', `respuestas?partida=eq.${par}&select=persona,ronda,opcion,ms`);
    assert.equal(mias.data.length, 1); assert.equal(mias.data[0].persona, B.id);
    assert.equal((await A.api('GET', `respuestas?partida=eq.${par}&select=persona`)).data.length, 0, 'A ve la respuesta de B');
    const p = await partida(A);
    assert.equal(p.estado_juego.fase, 'pregunta', 'falta A: todavía no se revela');
    assert.deepEqual(p.estado_juego.respondieron, [B.id]);
    assert.ok(!('ok' in p.estado_juego));
  });

  await paso('cuando responde el último se revela solo, con los puntos de la fórmula', async () => {
    assert.equal((await A.rpc('responder', { p: par, p_ronda: 1, p_opcion: 0 })).status, 204);
    const p = await partida(A);
    const e = p.estado_juego;
    assert.equal(e.fase, 'revelada');
    assert.ok(Number.isInteger(e.ok) && e.ok >= 0 && e.ok <= 3);
    assert.equal(e.conteo.reduce((a, b) => a + b, 0), 2);
    assert.equal(e.limite_ms - e.ahora_ms, T.REVELADA_MS);
    for (const u of [A, B]) {
      const r = (await u.api('GET', `respuestas?partida=eq.${par}&ronda=eq.1&select=opcion,ms`)).data[0];
      const esperado = T.puntos(r.opcion === e.ok, r.ms, T.PREGUNTA_MS);
      assert.equal(e.puntos_ronda[u.id], esperado);
      const j = (await A.api('GET', `jugadores?partida=eq.${par}&persona=eq.${u.id}&select=puntos`)).data[0];
      assert.equal(j.puntos, esperado);
    }
    rechazo(await B.rpc('responder', { p: par, p_ronda: 1, p_opcion: 0 }), /No hay una pregunta abierta/);
  });

  await paso('B no pasa a la siguiente antes de tiempo; el creador sí; un pedido viejo no hace nada', async () => {
    rechazo(await B.rpc('avanzar_partida', { p: par, p_ronda: 1, p_fase: 'revelada' }), /Todavía no/);
    assert.equal((await A.rpc('avanzar_partida', { p: par, p_ronda: 1, p_fase: 'revelada' })).status, 200);
    let e = (await partida(B)).estado_juego;
    assert.equal(e.ronda, 2); assert.equal(e.fase, 'pregunta');
    // el mismo pedido otra vez (otro cliente atrasado) no salta la pregunta 2
    assert.equal((await A.rpc('avanzar_partida', { p: par, p_ronda: 1, p_fase: 'revelada' })).status, 200);
    e = (await partida(B)).estado_juego;
    assert.equal(e.ronda, 2); assert.equal(e.fase, 'pregunta');
  });

  await paso('fuera de tiempo no se puede responder, y vencido el tiempo cualquier jugador avanza', async () => {
    const e = (await partida(B)).estado_juego;
    const ahora = (await B.rpc('ahora_ms')).data;
    await dormir(Math.max(0, e.limite_ms + 1000 - ahora) + 600);
    rechazo(await B.rpc('responder', { p: par, p_ronda: 2, p_opcion: 0 }), /Se terminó el tiempo/);
    assert.equal((await B.rpc('avanzar_partida', { p: par, p_ronda: 2, p_fase: 'pregunta' })).status, 200);
    const e2 = (await partida(B)).estado_juego;
    assert.equal(e2.fase, 'revelada'); assert.equal(e2.ronda, 2);
    assert.deepEqual(e2.puntos_ronda, {}, 'nadie respondió: nadie suma');
  });

  await paso('B sale: queda "se fue", pierde la partida y el chat; A sigue', async () => {
    assert.equal((await B.rpc('salir_partida', { p: par })).status, 204);
    assert.equal(await partida(B), null);
    assert.equal((await B.api('GET', `mensajes?sala=eq.par:${par}&select=id`)).data.length, 0);
    rechazo(await B.api('POST', 'mensajes', { sala: 'par:' + par, tipo: 'texto', texto: 'zz ya me fui' }));
    rechazo(await B.rpc('responder', { p: par, p_ronda: 2, p_opcion: 0 }));
    const j = (await A.api('GET', `jugadores?partida=eq.${par}&select=persona,se_fue`)).data;
    assert.equal(j.find((x) => x.persona === B.id).se_fue, true);
    assert.equal((await partida(A)).estado, 'jugando');
  });

  await paso('si se va el último jugador, la partida termina', async () => {
    assert.equal((await A.rpc('salir_partida', { p: par })).status, 204);
    assert.equal(await partida(A), null);
  });

  await paso('no se pueden tener más de 3 partidas abiertas a la vez', async () => {
    const ids = [];
    try {
      for (let i = 0; i < 3; i++) { const r = await A.rpc('crear_partida', { p_juego: 'trivia' }); assert.equal(r.status, 200, JSON.stringify(r.data)); ids.push(r.data); }
      rechazo(await A.rpc('crear_partida', { p_juego: 'impostor' }), /Ya tenés 3 partidas abiertas/);
      assert.equal((await A.rpc('salir_partida', { p: ids.pop() })).status, 204);
      const r = await A.rpc('crear_partida', { p_juego: 'trivia' });
      assert.equal(r.status, 200, 'cancelando una se puede armar otra: ' + JSON.stringify(r.data));
      ids.push(r.data);
    } finally { for (const id of ids) await A.rpc('salir_partida', { p: id }); }
  });

  await paso('la lista se entera por broadcast (solo el id) cuando una partida arranca o se cancela', async () => {
    const oido = await escucharLista(C);
    try {
      const uno = (await A.rpc('crear_partida', { p_juego: 'trivia' })).data;
      assert.equal((await A.rpc('avanzar_partida', { p: uno, p_ronda: 0, p_fase: 'espera' })).status, 200);
      const dos = (await A.rpc('crear_partida', { p_juego: 'trivia' })).data;
      assert.equal((await A.rpc('salir_partida', { p: dos })).status, 204);
      for (let i = 0; i < 40 && oido.recibidos.length < 2; i++) await dormir(250);
      assert.equal((await A.rpc('salir_partida', { p: uno })).status, 204);
      const ids = oido.recibidos.filter((x) => x.event === 'cambio').map((x) => x.payload.id);
      assert.ok(ids.includes(uno), 'no llegó el aviso del arranque: ' + JSON.stringify(oido.recibidos));
      assert.ok(ids.includes(dos), 'no llegó el aviso de la cancelación: ' + JSON.stringify(oido.recibidos));
      oido.recibidos.forEach((x) => assert.deepEqual(Object.keys(x.payload), ['id'], 'el aviso trae algo más que el id'));
    } finally { oido.cerrar(); }
  });

  await paso('dos partidas seguidas con los mismos jugadores no comparten ninguna pregunta (y respetan 4/4/2)', async () => {
    // A arma, B se une, y A (el creador) revela y avanza a mano las 10 preguntas
    async function jugar() {
      const id = (await A.rpc('crear_partida', { p_juego: 'trivia' })).data;
      assert.equal((await B.rpc('unirse_partida', { p: id })).status, 204);
      assert.equal((await A.rpc('avanzar_partida', { p: id, p_ronda: 0, p_fase: 'espera' })).status, 200);
      const vistas = [];
      for (let i = 0; i < 25; i++) {
        const p = (await A.api('GET', `partidas?id=eq.${id}&select=estado,estado_juego`)).data[0];
        const e = p.estado_juego;
        if (p.estado === 'terminada') break;
        if (e.fase === 'pregunta') {
          vistas.push({ clave: e.pregunta.p + '|' + e.pregunta.ops.join('|'), dif: e.pregunta.dif });
          assert.equal((await A.rpc('avanzar_partida', { p: id, p_ronda: e.ronda, p_fase: 'pregunta' })).status, 200);
        } else {
          assert.equal((await A.rpc('avanzar_partida', { p: id, p_ronda: e.ronda, p_fase: 'revelada' })).status, 200);
        }
      }
      for (const u of [A, B]) await u.rpc('salir_partida', { p: id });
      assert.equal(vistas.length, 10);
      const cuenta = (d) => vistas.filter((v) => v.dif === d).length;
      assert.deepEqual([cuenta(1), cuenta(2), cuenta(3)], [T.cuotas(10)[1], T.cuotas(10)[2], T.cuotas(10)[3]]);
      return vistas.map((v) => v.clave);
    }
    const uno = await jugar();
    const dos = await jugar();
    assert.equal(new Set(uno).size, 10);
    const repetidas = dos.filter((x) => uno.includes(x));
    assert.deepEqual(repetidas, [], 'se repitieron preguntas');
  });

  await paso('el creador que se va de una partida en espera la cancela', async () => {
    const r = await A.rpc('crear_partida', { p_juego: 'impostor' });
    const otra = r.data;
    assert.equal((await B.rpc('unirse_partida', { p: otra })).status, 204);
    rechazo(await A.rpc('avanzar_partida', { p: otra, p_ronda: 0, p_fase: 'espera' }), /al menos 3/);
    assert.equal((await A.rpc('salir_partida', { p: otra })).status, 204);
    const vistaB = (await B.api('GET', `partidas?id=eq.${otra}&select=estado,estado_juego`)).data[0];
    assert.equal(vistaB.estado, 'terminada'); assert.equal(vistaB.estado_juego.fase, 'cancelada');
    assert.equal((await B.rpc('salir_partida', { p: otra })).status, 204);
  });
} finally {
  // que no quede ninguna partida de prueba abierta en la lista de nadie
  for (const u of [A, B]) {
    const mias = await u.api('GET', `jugadores?persona=eq.${u.id}&se_fue=eq.false&select=partida`);
    for (const x of mias.data || []) await u.rpc('salir_partida', { p: x.partida });
  }
  console.log('Para borrar las filas de prueba: correr dev/supabase/limpiar-pruebas-juegos.sql (MCP supabase-thirdcedi o SQL Editor).');
}
console.log(fallas ? fallas + ' falla(s)' : 'todo ok');
process.exit(fallas ? 1 : 0);
