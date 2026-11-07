// Web Push con WebCrypto puro (RFC 8291 cifrado aes128gcm + RFC 8292 VAPID).
// Sin dependencias: anda igual en Deno (Edge Functions) y en Node (para probarlo).
const te = new TextEncoder();
const b64u = {
  dec: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0)),
  enc: (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
};
const concat = (...xs) => { const out = new Uint8Array(xs.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of xs) { out.set(x, o); o += x.length; } return out; };

async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}

/** Cifra el texto para una suscripción (keys.p256dh / keys.auth en base64url). Devuelve el cuerpo listo para mandar. */
export async function cifrar(p256dh, auth, texto) {
  const uaPublic = b64u.dec(p256dh), authSecret = b64u.dec(auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const clave = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, clave, concat(te.encode(texto), new Uint8Array([2]))));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

/** Header Authorization VAPID para el endpoint dado. */
export async function vapid(endpoint, publica, privada, sub) {
  const pub = b64u.dec(publica);
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: privada, x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33, 65)), ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const parte = (o) => b64u.enc(te.encode(JSON.stringify(o)));
  const datos = parte({ typ: 'JWT', alg: 'ES256' }) + '.' + parte({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub });
  const firma = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(datos));
  return `vapid t=${datos}.${b64u.enc(firma)}, k=${publica}`;
}

/** Manda un push. payload = string o null (push vacío). Devuelve el status HTTP del servicio de push. */
export async function mandarPush(sub, payload, { publica, privada, contacto, ttl = 43200, urgencia = 'high' }) {
  const headers = { TTL: String(ttl), Urgency: urgencia, Authorization: await vapid(sub.endpoint, publica, privada, contacto) };
  let body = null;
  if (payload != null) { body = await cifrar(sub.p256dh, sub.auth, payload); headers['Content-Encoding'] = 'aes128gcm'; headers['Content-Type'] = 'application/octet-stream'; }
  const r = await fetch(sub.endpoint, { method: 'POST', headers, body });
  const texto = r.ok ? '' : (await r.text()).slice(0, 200);
  return { status: r.status, texto };
}
