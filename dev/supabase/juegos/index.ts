// Edge Function "juegos" (36): las jugadas que no se pueden validar en SQL. Por ahora, el ajedrez: cada jugada se
// rehace con chess.js desde las guardadas y, si es legal y es tu turno, se guarda con ajedrez_guardar (service_role).
// verify_jwt PRENDIDO: Supabase rechaza el pedido sin una sesión válida; además se lee el usuario del token.
// Archivos: index.ts, chess.js (copia de /vendor/chess.js) y ajedrez-logica.js (copia de /ajedrez-logica.js). Las
// copias tienen que ser idénticas (lo controla dev/tests/ajedrez-logica.test.js).
//
// POST { accion: 'ajedrez_mover', partida, n, desde, hasta, corona? } → 200 { ok: true, estado } | 4xx { error }
//   n: cuántas jugadas había en la partida cuando se eligió la jugada (si alguien jugó en el medio, 409).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import './chess.js';
import './ajedrez-logica.js';

const A = (globalThis as any).AjedrezLogica;
const URL_SB = Deno.env.get('SUPABASE_URL')!;
const SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const sb = createClient(URL_SB, SERVICIO, { auth: { persistSession: false, autoRefreshToken: false } });

const ORIGENES = ['https://cediclub.univylabs.com', 'http://localhost:8080'];
function cors(req: Request) {
  const o = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGENES.includes(o) ? o : ORIGENES[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
const responder = (req: Request, status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });

async function ajedrezMover(uid: string, d: Record<string, unknown>) {
  const partida = String(d.partida || '');
  if (!/^[0-9a-f-]{36}$/.test(partida)) return [400, { error: 'Partida inválida' }] as const;
  const { data: p, error } = await sb.from('partidas').select('id,juego,estado,estado_juego').eq('id', partida).maybeSingle();
  if (error) throw error;
  if (!p || p.juego !== 'ajedrez') return [404, { error: 'La partida no existe' }] as const;
  if (p.estado !== 'jugando') return [409, { error: 'La partida terminó' }] as const;
  const { data: j } = await sb.from('jugadores').select('persona').eq('partida', partida).eq('persona', uid).eq('se_fue', false).maybeSingle();
  if (!j) return [403, { error: 'No estás en esta partida' }] as const;
  const e = p.estado_juego || {};
  const jugadas: string[] = Array.isArray(e.jugadas) ? e.jugadas : [];
  if (Number(d.n) !== jugadas.length) return [409, { error: 'La partida cambió: se actualiza' }] as const;
  const r = A.jugar(jugadas, A.colorDe(e, uid), { desde: d.desde, hasta: d.hasta, corona: d.corona });
  if (r.error) return [400, { error: r.error }] as const;
  const nuevo = {
    ...e, fen: r.fen, jugadas: r.jugadas, n: r.jugadas.length, ultima: { desde: d.desde, hasta: d.hasta },
    ...(r.fin ? { fase: 'final', gano: r.fin.gano, motivo: r.fin.motivo } : {}),
  };
  const { data: ok, error: e2 } = await sb.rpc('ajedrez_guardar', { p: partida, p_n: jugadas.length, p_estado: nuevo, p_terminar: !!r.fin });
  if (e2) throw e2;
  if (!ok) return [409, { error: 'La partida cambió: se actualiza' }] as const;
  return [200, { ok: true, estado: nuevo }] as const;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return responder(req, 405, { error: 'Método no permitido' });
  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u, error: eu } = await sb.auth.getUser(token);
    if (eu || !u || !u.user) return responder(req, 401, { error: 'Iniciá sesión de nuevo' });
    const uid = u.user.id;
    const { data: perfil } = await sb.from('perfiles').select('activo').eq('id', uid).maybeSingle();
    if (!perfil || !perfil.activo) return responder(req, 403, { error: 'No sos miembro' });
    const d = await req.json().catch(() => ({}));
    if (d && d.accion === 'ajedrez_mover') {
      const [status, cuerpo] = await ajedrezMover(uid, d);
      return responder(req, status, cuerpo);
    }
    return responder(req, 400, { error: 'Acción inválida' });
  } catch (e) {
    console.error('juegos:', (e as Error).message);
    return responder(req, 500, { error: 'No se pudo guardar la jugada. Probá de nuevo.' });
  }
});
