// Genera el par de claves VAPID (P-256) para los avisos push y lo agrega al .env del repo principal:
//   VAPID_PUBLICA=...  (pública, va también en avisos.js)
//   VAPID_PRIVADA=...  (secreta: la carga Ivan a mano en Dashboard → Edge Functions → Secrets)
// No pisa nada: si el .env ya tiene VAPID_PUBLICA o VAPID_PRIVADA, no hace nada.
// Nunca muestra la privada por consola; solo la pública (es pública por diseño).
// Uso: node dev/tools/generar-vapid.js [ruta del .env]   (por defecto, el .env de la raíz del repo principal)
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ENV = process.argv[2] || 'C:/Users/IvanLiPuma/thirdcedi-time/.env';
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64u = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const actual = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8') : '';
const tiene = (k) => new RegExp('^' + k + '=.+', 'm').test(actual);
if (tiene('VAPID_PUBLICA') || tiene('VAPID_PRIVADA')) {
  const m = /^VAPID_PUBLICA=(.+)$/m.exec(actual);
  console.log('El .env ya tiene claves VAPID: no se cambia nada.' + (m ? '\nVAPID_PUBLICA=' + m[1].trim() : ''));
  process.exit(0);
}

const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = privateKey.export({ format: 'jwk' });
const publica = b64u(Buffer.concat([Buffer.from([4]), deB64u(jwk.x), deB64u(jwk.y)]));
const privada = jwk.d;
if (deB64u(publica).length !== 65 || deB64u(privada).length !== 32) throw new Error('claves con largo inesperado');

const sep = actual && !actual.endsWith('\n') ? '\n' : '';
fs.writeFileSync(ENV, actual + sep + 'VAPID_PUBLICA=' + publica + '\nVAPID_PRIVADA=' + privada + '\n', { encoding: 'utf8' });
console.log('Listo: se agregaron VAPID_PUBLICA y VAPID_PRIVADA a ' + path.resolve(ENV) + '\nVAPID_PUBLICA=' + publica);
