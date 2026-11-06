// Edge Function "avisos" de ThirdCEDI Time (versión mínima de la Task 5b; la Task 6 suma los avisos push).
// La llaman pg_cron y el trigger de fotos con public.avisos_llamar(), que manda el secreto de Vault en x-cron-secret.
// Sin ese header (o sin el secreto cargado en Vault) responde 401.
//   { tipo: 'drive' }    sube a Drive las fotos del álbum que falten (trigger after insert + cron cada 5 min) y después libera
//   { tipo: 'liberar' }  pasado el 70 % del espacio, borra de la app originales que ya están en Drive y tienen versión media, hasta el 60 %
// Copiado de Rumbo al Sur y adaptado: subcarpeta por actividad, autor = perfiles.nombre.
// Secretos de la función (los carga Ivan en Dashboard → Edge Functions → Secrets): DRIVE_FOTOS_URL y DRIVE_FOTOS_SECRETO.
// Si faltan, 'drive' no toma ninguna foto: quedan en Supabase y el link "Ver en Drive" no aparece.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

let cfg: Record<string, string> | null = null;
async function config() {
  if (!cfg) {
    const { data, error } = await sb.rpc('avisos_config');
    if (error) throw error;
    cfg = (data || {}) as Record<string, string>;
  }
  return cfg;
}

// ---------- Nombres en Drive (copia de AlbumLogica.carpetaDrive / nombreDrive, testeadas en album-logica.test.js) ----------
const ZONA = 'America/Argentina/Buenos_Aires';
const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtHora = new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const limpio = (s: unknown) => String(s || '').replace(/[\\/]/g, '-').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
const carpetaDrive = (a: { fecha: string; titulo: string }) => `${fmtDia.format(new Date(a.fecha))} ${limpio(a.titulo)}`;
const nombreDrive = (f: { id: string; tomada: string; editada_de: string | null }, autor: string) => {
  const d = new Date(f.tomada);
  return `${fmtDia.format(d)} ${fmtHora.format(d).replace(':', '.')} ${limpio(autor)}${f.editada_de ? ' editada' : ''} (${String(f.id).slice(0, 8)}).jpg`;
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

type Foto = { id: string; actividad: string; autor: string; ruta: string; tomada: string; editada_de: string | null };
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
    const rp = await sb.from('perfiles').select('id,nombre').in('id', [...new Set(fotos.map((f) => f.autor))]);
    for (const p of rp.data || []) nombres.set(p.id, p.nombre);
  }
  let subidas = 0; const errores: string[] = [];
  for (const f of fotos) {
    try {
      const a = acts.get(f.actividad);
      if (!a) throw new Error('la actividad no existe');
      const { data: blob, error: e1 } = await sb.storage.from('album').download(f.ruta);
      if (e1 || !blob) throw new Error('no se pudo leer la foto: ' + (e1?.message || 'vacía'));
      const r = await aDrive(url, secreto, {
        carpeta: carpetaDrive(a), carpetaId: idDeCarpeta(a.drive_url),
        nombre: nombreDrive(f, nombres.get(f.autor) || 'Compañero'), base64: base64(new Uint8Array(await blob.arrayBuffer())), mime: 'image/jpeg',
      });
      await sb.from('fotos').update({ drive_id: r.id, drive_error: null }).eq('id', f.id);
      if (r.carpetaUrl && r.carpetaUrl !== a.drive_url && /^https:\/\/drive\.google\.com\//.test(r.carpetaUrl)) {
        const u = await sb.from('actividades').update({ drive_url: r.carpetaUrl }).eq('id', a.id);
        if (u.error) console.error('drive_url', u.error.message); else a.drive_url = r.carpetaUrl;
      }
      subidas++;
    } catch (e) {
      const msg = String((e as Error).message).slice(0, 300);
      errores.push(msg);
      await sb.from('fotos').update({ drive_error: msg }).eq('id', f.id);
    }
  }
  return { subidas, tomadas: fotos.length, errores, ...(await liberar()) };
}

// Espacio de la app (plan gratis: 1 GB por proyecto). Pasado el 70 %, se borran de la app las originales
// más viejas que ya están en Drive y tienen versión de 1600 px, hasta bajar al 60 %. La media y la miniatura quedan.
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
    await sb.from('fotos').update({ liberada: true }).in('id', fs.map((f: { id: string }) => f.id));
    liberadas += fs.length;
    uso = await usado();
  }
  return { liberadas, usoMB: Math.round(uso / 1048576) };
}

Deno.serve(async (req) => {
  try {
    const c = await config();
    const secreto = c.avisos_cron_secret;
    if (!secreto || req.headers.get('x-cron-secret') !== secreto) return new Response('no', { status: 401 });
    const body = await req.json().catch(() => ({}));
    let r: unknown;
    if (body.tipo === 'drive') r = await drive();
    else if (body.tipo === 'liberar') r = await liberar();
    else return new Response('tipo?', { status: 400 });
    return Response.json(r);
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e).slice(0, 300) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
