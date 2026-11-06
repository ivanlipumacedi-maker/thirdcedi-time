// Pruebas contra el proyecto real (solo con la clave publicable): el hook de dominio y las RLS sin sesión.
// (a) el rechazo del hook solo anda cuando Ivan lo activa en Dashboard > Authentication > Hooks.
// Uso: node dev/tests/auth-rls.mjs
import assert from 'node:assert/strict';

const BASE = 'https://qvezbnkrfqewanlcejha.supabase.co';
const KEY = 'sb_publishable_nHg5W-1bGZwudTST-ejzeA_w_gUNYXQ';
const h = (extra = {}) => ({ apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', ...extra });
let fallas = 0;
const paso = async (nombre, fn) => {
  try { await fn(); console.log('ok', nombre); } catch (e) { fallas++; console.log('FALLA', nombre, '-', e.message); }
};

await paso('(a) mail fuera del grupo: el hook rechaza con 403', async () => {
  const r = await fetch(`${BASE}/auth/v1/otp`, { method: 'POST', headers: h(), body: JSON.stringify({ email: 'prueba@gmail.com', create_user: true }) });
  const t = await r.text();
  assert.equal(r.status, 403, `esperaba 403 y vino ${r.status}: ${t} (¿el hook "Before User Created" está activado?)`);
  assert.match(t, /Grupo CEDI/);
});

await paso('(b) anon sin sesión lee perfiles -> []', async () => {
  const r = await fetch(`${BASE}/rest/v1/perfiles?select=*`, { headers: h() });
  assert.ok(r.status === 200 || r.status === 401 || r.status === 403, 'estado ' + r.status);
  if (r.status === 200) assert.deepEqual(await r.json(), []);
});

await paso('anon no puede insertar un perfil', async () => {
  const r = await fetch(`${BASE}/rest/v1/perfiles`, { method: 'POST', headers: h(), body: JSON.stringify({ id: '00000000-0000-0000-0000-000000000001', nombre: 'X', empresa: 'CEDI' }) });
  assert.ok(r.status >= 400, 'insert anon debe fallar: ' + r.status);
});

await paso('anon no puede subir al bucket avatares', async () => {
  const r = await fetch(`${BASE}/storage/v1/object/avatares/00000000-0000-0000-0000-000000000001/avatar.webp`, { method: 'POST', headers: h({ 'Content-Type': 'image/webp' }), body: new Uint8Array([1, 2, 3]) });
  assert.ok(r.status >= 400, 'subida anon debe fallar: ' + r.status);
});

await paso('anon no puede llamar es_miembro() ni hook_dominio()', async () => {
  for (const fn of ['es_miembro', 'hook_dominio']) {
    const r = await fetch(`${BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: h(), body: fn === 'hook_dominio' ? '{"event":{}}' : '{}' });
    assert.ok(r.status >= 400, fn + ' debe estar vedada: ' + r.status);
  }
});

console.log(fallas ? `${fallas} falla(s)` : 'todo ok');
process.exit(fallas ? 1 : 0);
