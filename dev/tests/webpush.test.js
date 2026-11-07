// webpush.js (el de la Edge Function): se descifra lo cifrado del lado del teléfono (RFC 8291) y se verifica la firma VAPID.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { subtle } = globalThis.crypto;

const cargar = () => import(pathToFileURL(path.join(__dirname, '..', 'supabase', 'avisos', 'webpush.js')).href);
const b64u = (b) => Buffer.from(b).toString('base64url');
const deB64u = (s) => new Uint8Array(Buffer.from(s, 'base64url'));
async function hkdf(salt, ikm, info, len) {
  const k = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
const cat = (...xs) => Buffer.concat(xs.map((x) => Buffer.from(x)));

test('cifrar: el teléfono descifra el mismo texto (aes128gcm)', async () => {
  const { cifrar } = await cargar();
  const ua = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPub = new Uint8Array(await subtle.exportKey('raw', ua.publicKey));
  const auth = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const texto = JSON.stringify({ title: 'Nueva actividad: ⚽ Fútbol', body: 'Hoy a las 21:00 · Cancha', url: '#/actividad/x' });
  const cuerpo = await cifrar(b64u(uaPub), b64u(auth), texto);

  const salt = cuerpo.slice(0, 16), idlen = cuerpo[20], asPub = cuerpo.slice(21, 21 + idlen), ct = cuerpo.slice(21 + idlen);
  assert.equal(new DataView(cuerpo.buffer, cuerpo.byteOffset + 16, 4).getUint32(0), 4096);
  const asKey = await subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, cat(Buffer.from('WebPush: info\0'), uaPub, asPub), 32);
  const cek = await hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const k = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plano = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, k, ct));
  assert.equal(plano[plano.length - 1], 2, 'delimitador del último registro');
  assert.equal(Buffer.from(plano.slice(0, -1)).toString('utf8'), texto);
});

test('vapid: JWT ES256 firmado con la privada, verificable con la pública, aud = origen del endpoint', async () => {
  const { vapid } = await cargar();
  const par = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await subtle.exportKey('jwk', par.privateKey);
  const publica = b64u(cat([4], deB64u(jwk.x), deB64u(jwk.y)));
  const h = await vapid('https://fcm.googleapis.com/fcm/send/abc', publica, jwk.d, 'mailto:avisos@example.com');
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h);
  assert.ok(m, h);
  assert.equal(m[4], publica);
  const datos = JSON.parse(Buffer.from(m[2], 'base64url').toString());
  assert.equal(datos.aud, 'https://fcm.googleapis.com');
  assert.equal(datos.sub, 'mailto:avisos@example.com');
  assert.ok(datos.exp > Date.now() / 1000 && datos.exp <= Date.now() / 1000 + 24 * 3600);
  const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, par.publicKey, deB64u(m[3]), Buffer.from(m[1] + '.' + m[2]));
  assert.ok(ok, 'firma válida');
});
