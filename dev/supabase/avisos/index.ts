// Edge Function "avisos" de ThirdCEDI Time: avisos push (Task 6) y copia del álbum a Drive (Task 5b).
// La llaman pg_cron, el trigger de fotos y avisos_probar() con public.avisos_llamar(), que manda el secreto de Vault en
// x-cron-secret. Sin ese header (o sin el secreto cargado en Vault) responde 401. Con el secreto bien responde 202 enseguida
// y hace el trabajo en EdgeRuntime.waitUntil (pg_net deja de esperar, el trabajo sigue). Con { esperar: true } espera y
// devuelve el resultado (para probar a mano).
//   { tipo: 'cambios' }  cada minuto: vacía la cola eventos_aviso (actividad nueva / confirmada / cambió / cancelada,
//                        mensajes agrupados por sala y autor con SILENCIO_MS, avisos de prueba)
//   { tipo: 'diario' }   12:00 ART: recordatorio a los anotados de cada actividad confirmada que todavía no pasó
//   { tipo: 'prueba', persona }  aviso de prueba a los teléfonos de esa persona
//   { tipo: 'drive' }    sube a Drive las fotos y videos (hasta 35 MB) del álbum que falten (trigger after insert + cron cada 5 min) y después libera
//   { tipo: 'liberar' }  pasado el 70 % del espacio, borra de la app originales que ya están en Drive y tienen versión media, hasta el 60 %
// Copiado de Rumbo al Sur y adaptado: destinatarios por persona (push_subs.persona), subcarpeta de Drive por actividad.
// Secretos de la función (los carga Ivan en Dashboard → Edge Functions → Secrets):
//   VAPID_PUBLICA, VAPID_PRIVADA, VAPID_SUJETO (mailto:…): sin alguno, los avisos no salen y se loguea "faltan claves VAPID".
//   DRIVE_FOTOS_URL y DRIVE_FOTOS_SECRETO: sin ellos, 'drive' no toma fotos (quedan en Supabase, sin "Ver en Drive").
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { mandarPush } from './webpush.js';
import './avisos-logica.js'; // copia idéntica de /avisos-logica.js: deja globalThis.AvisosLogica

// deno-lint-ignore no-explicit-any
const L = (globalThis as any).AvisosLogica;
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

// Config de Vault ('avisos_*'). Se guarda en memoria solo si trae el secreto de cron: mientras Ivan no lo cargue,
// cada pedido la vuelve a leer, y empieza a andar apenas lo carga.
let cfg: Record<string, string> | null = null;
async function config(releer = false) {
  if (cfg && !releer) return cfg;
  const { data, error } = await sb.rpc('avisos_config');
  if (error) throw error;
  const c = (data || {}) as Record<string, string>;
  cfg = c.avisos_cron_secret ? c : null;
  return c;
}
// Comparación en tiempo constante: SHA-256 de los dos y XOR byte a byte (no corta en el primer byte distinto).
const te = new TextEncoder();
async function iguales(a: string, b: string) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', te.encode(s))));
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}
// Si no coincide, se relee la config (Ivan pudo haber rotado el secreto) antes de decir que no, pero como mucho una
// vez cada 30 s: un header falso repetido no golpea Vault en cada pedido.
const RELEER_MS = 30_000;
let ultimaRelectura = 0;
async function autorizado(req: Request) {
  const dado = req.headers.get('x-cron-secret') || '';
  if (!dado) return false;
  let c = await config();
  if (c.avisos_cron_secret && await iguales(dado, c.avisos_cron_secret)) return true;
  if (cfg && Date.now() - ultimaRelectura < RELEER_MS) return false;
  ultimaRelectura = Date.now();
  c = await config(true);
  return !!c.avisos_cron_secret && await iguales(dado, c.avisos_cron_secret);
}

// ---------- Avisos push ----------
const SILENCIO_MS = 60_000;          // espera a que el autor deje de escribir para juntar sus mensajes en un aviso
const MAX_ESPERA_MS = 10 * 60_000;   // pero nunca más de 10 minutos
const VIEJO_MS = 60 * 60_000;        // un evento de hace más de una hora ya no se avisa (p. ej. la cola de antes de las claves)

type Sub = { endpoint: string; persona: string; p256dh: string; auth: string };
type Ev = { id: number; tipo: string; actividad: string | null; sala: string | null; autor: string | null; mensaje: string | null; creado: string };
type Payload = { title: string; body: string; tag?: string; url?: string };

function claves() {
  const publica = Deno.env.get('VAPID_PUBLICA'), privada = Deno.env.get('VAPID_PRIVADA'), contacto = Deno.env.get('VAPID_SUJETO');
  if (!publica || !privada || !contacto) { console.warn('faltan claves VAPID'); return null; }
  return { publica, privada, contacto };
}

async function enviar(subs: Sub[], payload: Payload) {
  const k = claves();
  if (!k || !subs.length) return 0;
  const texto = JSON.stringify(payload);
  const res = await Promise.all(subs.map(async (s) => {
    try {
      const r = await mandarPush(s, texto, k);
      if (r.status >= 200 && r.status < 300) return 1;
      if (r.status === 404 || r.status === 410) {
        const { error } = await sb.from('push_subs').delete().eq('endpoint', s.endpoint);
        if (error) console.error('no se pudo borrar la suscripción vencida', error.message);
      } else console.error('push rechazado', r.status, r.texto);
    } catch (e) {
      console.error('push falló', String((e as Error).message).slice(0, 200));
    }
    return 0;
  }));
  return res.reduce((a, b) => a + b, 0);
}

async function subsDe(personas: (string | null)[]) {
  const ps = personas.filter((p): p is string => !!p);
  if (!ps.length) return [] as Sub[];
  const { data, error } = await sb.from('push_subs').select('endpoint,persona,p256dh,auth').in('persona', ps);
  if (error) throw error;
  return (data || []) as Sub[];
}
async function nombreDe(id: string | null) {
  if (!id) return null;
  const { data } = await sb.from('perfiles').select('nombre').eq('id', id).maybeSingle();
  return (data && data.nombre) || null;
}
async function anotados(actividad: string) {
  const { data, error } = await sb.from('asistencias').select('persona').eq('actividad', actividad);
  if (error) throw error;
  return [...new Set((data || []).map((x: { persona: string }) => x.persona))];
}
// Reclama los eventos borrándolos: si otra corrida ya los tomó, no se mandan dos veces.
async function tomar(ids: number[]) {
  if (!ids.length) return [] as Ev[];
  const { data, error } = await sb.from('eventos_aviso').delete().in('id', ids).select('*');
  if (error) throw error;
  return ((data || []) as Ev[]).sort((a, b) => a.id - b.id);
}

async function avisoActividad(evs: Ev[], ahora: number) {
  const tomados = await tomar(evs.map((e) => e.id));
  if (!tomados.length) return 0;
  const tipo = L.fusionarActividad(tomados.map((e) => e.tipo));
  const { data: a, error } = await sb.from('actividades').select('*').eq('id', tomados[0].actividad).maybeSingle();
  if (error) throw error;
  if (!a) return 0;
  if (tipo === 'nueva' && a.estado === 'cancelada') return 0; // la crearon y la cancelaron antes del aviso
  const autor = tomados[tomados.length - 1].autor;
  let subs: Sub[];
  if (tipo === 'nueva') {
    // a todos: se traen todas las suscripciones (sin un .in con cada perfil) y se saca al autor acá
    const { data: ss, error: e2 } = await sb.from('push_subs').select('endpoint,persona,p256dh,auth');
    if (e2) throw e2;
    subs = ((ss || []) as Sub[]).filter((s) => s.persona !== autor);
  } else subs = await subsDe((await anotados(a.id)).filter((p) => p !== autor));
  return enviar(subs, L.textoActividad(tipo, a, await nombreDe(autor), ahora));
}

async function avisoMensajes(g: { sala: string; autor: string; ids: number[] }) {
  const tomados = await tomar(g.ids);
  if (!tomados.length) return 0;
  const { data: ms, error } = await sb.from('mensajes').select('id,tipo,texto,creado').in('id', tomados.map((e) => e.mensaje!)).order('creado');
  if (error) throw error;
  const vivos = (ms || []).filter((m: { tipo: string }) => m.tipo !== 'eliminado');
  if (!vivos.length) return 0;
  const [clase, id] = g.sala.split(':');
  let titulo = 'ThirdCEDI Time', personas: string[] = [];
  if (clase === 'act') {
    const { data: a } = await sb.from('actividades').select('titulo').eq('id', id).maybeSingle();
    if (a) titulo = a.titulo;
    personas = await anotados(id);
  } else if (clase === 'par') {
    const { data: p } = await sb.from('partidas').select('juego,creador').eq('id', id).maybeSingle();
    if (p) titulo = L.tituloPartida(p.juego, await nombreDe(p.creador));
    const { data: js, error: e2 } = await sb.from('jugadores').select('persona').eq('partida', id).eq('se_fue', false);
    if (e2) throw e2;
    personas = (js || []).map((j: { persona: string }) => j.persona);
  }
  personas = personas.filter((p) => p !== g.autor);
  const t = L.textoMensajes(titulo, await nombreDe(g.autor), vivos);
  return enviar(await subsDe(personas), { ...t, tag: 'chat-' + g.sala, url: L.urlSala(g.sala) });
}

const PRUEBA: Payload = { title: 'ThirdCEDI Time', body: 'Prueba: los avisos andan en este teléfono.', tag: 'prueba', url: '#/perfil' };

async function cambios() {
  const ahora = Date.now();
  // lo de hace más de una hora se descarta de una, todo junto
  const { data: viejos, error: e0 } = await sb.from('eventos_aviso').delete().lt('creado', new Date(ahora - VIEJO_MS).toISOString()).select('id');
  if (e0) throw e0;
  const descartados = (viejos || []).length;
  const { data, error } = await sb.from('eventos_aviso').select('*').order('id').limit(1000);
  if (error) throw error;
  const vivos = ((data || []) as Ev[]).filter((e) => ahora - Date.parse(e.creado) <= VIEJO_MS);
  // sin claves VAPID no se toca la cola (salvo lo viejo): cuando Ivan las cargue, sale lo de la última hora
  if (!claves()) return { enviados: 0, descartados, pendientes: vivos.length, motivo: 'faltan claves VAPID' };
  let enviados = 0;
  const errores: string[] = [];
  const intento = async (fn: () => Promise<number>) => {
    try { enviados += await fn(); } catch (e) { errores.push(String((e as Error).message).slice(0, 200)); }
  };
  const porAct = new Map<string, Ev[]>();
  for (const e of vivos) {
    if (e.tipo === 'mensaje' || e.tipo === 'prueba' || !e.actividad) continue;
    if (!porAct.has(e.actividad)) porAct.set(e.actividad, []);
    porAct.get(e.actividad)!.push(e);
  }
  for (const g of porAct.values()) await intento(() => avisoActividad(g, ahora));
  for (const e of vivos.filter((x) => x.tipo === 'prueba')) {
    await intento(async () => ((await tomar([e.id])).length ? enviar(await subsDe([e.autor]), PRUEBA) : 0));
  }
  for (const g of L.mensajesListos(vivos, ahora, { silencio: SILENCIO_MS, maxEspera: MAX_ESPERA_MS })) await intento(() => avisoMensajes(g));
  return { enviados, descartados, errores };
}

async function diario() {
  if (!claves()) return { enviados: 0, motivo: 'faltan claves VAPID' };
  const ahora = Date.now();
  // las confirmadas recientes o futuras (la lógica descarta las que ya terminaron, tercer tiempo incluido)
  const { data: acts, error } = await sb.from('actividades').select('*').eq('estado', 'confirmada').gt('fecha', new Date(ahora - 2 * 864e5).toISOString());
  if (error) throw error;
  if (!acts?.length) return { enviados: 0, recordatorios: 0 };
  const { data: asis, error: e2 } = await sb.from('asistencias').select('actividad,persona,parte').in('actividad', acts.map((a: { id: string }) => a.id));
  if (e2) throw e2;
  const recs = L.recordatoriosDiarios(acts, asis || [], ahora) as { persona: string; actividad: string }[];
  const subs = await subsDe([...new Set(recs.map((r) => r.persona))]);
  let enviados = 0;
  for (const r of recs) {
    const mias = subs.filter((s) => s.persona === r.persona);
    if (mias.length) enviados += await enviar(mias, L.textoDiario(acts.find((a: { id: string }) => a.id === r.actividad), ahora));
  }
  return { enviados, recordatorios: recs.length };
}

// ---------- Nombres en Drive (copia de AlbumLogica.carpetaDrive / nombreDrive, testeadas en album-logica.test.js) ----------
const ZONA = 'America/Argentina/Buenos_Aires';
const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtHora = new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const limpio = (s: unknown) => String(s || '').replace(/[\\/]/g, '-').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
const carpetaDrive = (a: { fecha: string; titulo: string }) => `${fmtDia.format(new Date(a.fecha))} ${limpio(a.titulo)}`;
const nombreDrive = (f: { id: string; tomada: string; editada_de: string | null; ruta?: string }, autor: string) => {
  const d = new Date(f.tomada), ext = /\.(mp4|webm)$/.exec(f.ruta || '')?.[1] || 'jpg';
  return `${fmtDia.format(d)} ${fmtHora.format(d).replace(':', '.')} ${limpio(autor)}${f.editada_de ? ' editada' : ''} (${String(f.id).slice(0, 8)}).${ext}`;
};
const idDeCarpeta = (url: string | null) => (url && /\/folders\/([A-Za-z0-9_-]+)/.exec(url)?.[1]) || null;

function base64(bytes: Uint8Array) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function aDrive(url: string, secreto: string, datos: Record<string, unknown>) {
  // Apps Script responde el POST con un 302 a script.googleusercontent.com: fetch lo sigue
  const r = await fetch(url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ secreto, ...datos }) });
  const texto = await r.text();
  let j: { id?: string; carpetaId?: string; carpetaUrl?: string; error?: string };
  try { j = JSON.parse(texto); } catch { throw new Error('Drive respondió algo que no es JSON (' + r.status + '): ' + texto.slice(0, 200)); }
  if (j.error || !j.id) throw new Error('Drive: ' + (j.error || 'sin id'));
  return j;
}

type Foto = { id: string; actividad: string; autor: string; ruta: string; tomada: string; editada_de: string | null; tipo?: string; mime?: string | null; bytes?: number };
// El Apps Script recibe el archivo entero en base64 dentro de un JSON y tiene un límite de tamaño: los videos de más de
// 35 MB no se mandan, quedan solo en la app (nunca se liberan) y se marcan para que drive_tomar no los vuelva a tomar.
const MAX_DRIVE = 35 * 1024 * 1024;
const MUY_GRANDE = 'muy grande para Drive';
// Álbum de todos (22-album-de-todos.sql): no es una actividad; va a la carpeta fija "Fotos de todos" (el Apps Script la
// busca por nombre adentro de "ThirdCEDI Time" y la crea si no está).
const TODOS = '00000000-0000-4000-8000-000000000000';
const CARPETA_TODOS = 'Fotos de todos';
async function drive() {
  const url = Deno.env.get('DRIVE_FOTOS_URL'), secreto = Deno.env.get('DRIVE_FOTOS_SECRETO');
  if (!url || !secreto) return { subidas: 0, motivo: 'falta configurar DRIVE_FOTOS_URL / DRIVE_FOTOS_SECRETO', ...(await liberar()) };
  // hasta 5 fotos pendientes con candado: el trigger y el cron no suben la misma a la vez
  const { data, error } = await sb.rpc('drive_tomar', { p_cuantas: 5 });
  if (error) throw error;
  const fotos = (data || []) as Foto[];
  const acts = new Map<string, { id: string; titulo: string; fecha: string; drive_url: string | null }>();
  const nombres = new Map<string, string>();
  if (fotos.length) {
    const ra = await sb.from('actividades').select('id,titulo,fecha,drive_url').in('id', [...new Set(fotos.map((f) => f.actividad))]);
    if (ra.error) throw ra.error;
    for (const a of ra.data || []) acts.set(a.id, a);
    if (fotos.some((f) => f.actividad === TODOS)) acts.set(TODOS, { id: TODOS, titulo: CARPETA_TODOS, fecha: '', drive_url: null });
    const rp = await sb.from('perfiles').select('id,nombre').in('id', [...new Set(fotos.map((f) => f.autor))]);
    for (const p of rp.data || []) nombres.set(p.id, p.nombre);
  }
  let subidas = 0; const errores: string[] = [];
  for (const f of fotos) {
    try {
      const a = acts.get(f.actividad);
      if (!a) throw new Error('la actividad no existe');
      const video = f.tipo === 'video';
      if (video && (f.bytes || 0) > MAX_DRIVE) {
        const u = await sb.from('fotos').update({ drive_error: MUY_GRANDE }).eq('id', f.id);
        if (u.error) { errores.push('no se pudo marcar el video: ' + u.error.message); break; }
        continue;
      }
      const { data: blob, error: e1 } = await sb.storage.from('album').download(f.ruta);
      if (e1 || !blob) throw new Error('no se pudo leer ' + (video ? 'el video' : 'la foto') + ': ' + (e1?.message || 'vacía'));
      if (video && blob.size > MAX_DRIVE) {
        const u = await sb.from('fotos').update({ drive_error: MUY_GRANDE }).eq('id', f.id);
        if (u.error) { errores.push('no se pudo marcar el video: ' + u.error.message); break; }
        continue;
      }
      const r = await aDrive(url, secreto, {
        carpeta: a.id === TODOS ? CARPETA_TODOS : carpetaDrive(a), carpetaId: idDeCarpeta(a.drive_url),
        nombre: nombreDrive(f, nombres.get(f.autor) || 'Compañero'), base64: base64(new Uint8Array(await blob.arrayBuffer())),
        mime: video ? (f.mime === 'video/webm' ? 'video/webm' : 'video/mp4') : 'image/jpeg',
      });
      const ok = await sb.from('fotos').update({ drive_id: r.id, drive_error: null }).eq('id', f.id);
      // si la base no responde se corta: seguir subiría fotos que después no quedan marcadas
      if (ok.error) { errores.push('no se pudo marcar la foto como subida: ' + ok.error.message); break; }
      if (a.id !== TODOS && r.carpetaUrl && r.carpetaUrl !== a.drive_url && /^https:\/\/drive\.google\.com\//.test(r.carpetaUrl)) {
        const u = await sb.from('actividades').update({ drive_url: r.carpetaUrl }).eq('id', a.id);
        if (u.error) console.error('drive_url', u.error.message); else a.drive_url = r.carpetaUrl;
      }
      subidas++;
    } catch (e) {
      const msg = String((e as Error).message).slice(0, 300);
      errores.push(msg);
      const u = await sb.from('fotos').update({ drive_error: msg }).eq('id', f.id);
      if (u.error) { errores.push('no se pudo guardar el error de la foto: ' + u.error.message); break; }
    }
  }
  return { subidas, tomadas: fotos.length, errores, ...(await liberar()) };
}

// Espacio de la app (plan gratis: 1 GB por proyecto). Pasado el 70 %, se borran de la app las originales
// más viejas que ya están en Drive y tienen versión de 1600 px, hasta bajar al 60 %. La media y la miniatura quedan.
// Los videos no se liberan nunca (no tienen media; liberables pide tipo = 'foto').
const LIMITE = 1024 * 1024 * 1024;
async function liberar(alto = 0.7, bajo = 0.6, maximo = 500) {
  const usado = async () => { const { data, error } = await sb.rpc('espacio_proyecto'); if (error) throw error; return Number(data) || 0; };
  let uso = await usado();
  if (uso < alto * LIMITE) return { liberadas: 0, usoMB: Math.round(uso / 1048576) };
  let liberadas = 0;
  while (uso > bajo * LIMITE && liberadas < maximo) {
    const { data: fs, error } = await sb.rpc('liberables', { p_cuantas: Math.min(20, maximo - liberadas) });
    if (error) throw error;
    if (!fs?.length) break;
    const { error: e2 } = await sb.storage.from('album').remove(fs.map((f: { ruta: string }) => f.ruta));
    if (e2) throw e2;
    const u = await sb.from('fotos').update({ liberada: true }).in('id', fs.map((f: { id: string }) => f.id));
    // sin marcar, liberables las devolvería otra vez: se corta para no girar en falso
    if (u.error) { console.error('liberar: no se pudieron marcar como liberadas', u.error.message); break; }
    liberadas += fs.length;
    uso = await usado();
  }
  return { liberadas, usoMB: Math.round(uso / 1048576) };
}

Deno.serve(async (req) => {
  let ok = false;
  try {
    if (!(await autorizado(req))) return new Response('no', { status: 401 });
    ok = true;
    const body = await req.json().catch(() => ({}));
    const tipo = String(body.tipo || '');
    let trabajo: (() => Promise<unknown>) | null = null;
    if (tipo === 'cambios') trabajo = cambios;
    else if (tipo === 'diario') trabajo = diario;
    else if (tipo === 'prueba' && typeof body.persona === 'string') trabajo = async () => ({ enviados: await enviar(await subsDe([body.persona]), PRUEBA) });
    else if (tipo === 'drive') trabajo = drive;
    else if (tipo === 'liberar') trabajo = () => liberar();
    if (!trabajo) return new Response('tipo?', { status: 400 });
    if (body.esperar === true) return Response.json(await trabajo());
    // pg_net deja de esperar a los 60 s: se responde ya y el trabajo sigue (subidas largas a Drive, muchos push)
    EdgeRuntime.waitUntil(trabajo().then((r) => console.log(tipo, JSON.stringify(r))).catch((e) => console.error(tipo, e)));
    return Response.json({ aceptado: tipo }, { status: 202 });
  } catch (e) {
    console.error(e);
    // a quien no pasó el secreto no se le cuenta qué falló
    if (!ok) return new Response('error', { status: 500 });
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e).slice(0, 300) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
