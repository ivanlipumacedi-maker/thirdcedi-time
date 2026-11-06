const test = require('node:test');
const assert = require('node:assert/strict');
const { traducir, MSG_DOMINIO } = require('../../errores.js');

test('paso mail: el 403 del hook muestra el aviso de dominio', () => {
  assert.equal(traducir({ status: 403, message: 'Solo cuentas del Grupo CEDI' }, 'mail'), MSG_DOMINIO);
  assert.equal(traducir({ message: 'Solo cuentas del Grupo CEDI' }, 'mail'), MSG_DOMINIO);
});
test('paso mail: email_address_invalid no se confunde con código inválido ni con dominio', () => {
  const t = traducir({ status: 400, code: 'email_address_invalid', message: 'Email address "x" is invalid' }, 'mail');
  assert.equal(t, 'Ese mail no parece válido. Revisalo.');
});
test('paso código: 403 otp_expired y código inválido dicen que venció, no hablan del dominio', () => {
  const venc = 'El código no es válido o venció. Pedí uno nuevo.';
  assert.equal(traducir({ status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' }, 'codigo'), venc);
  assert.equal(traducir({ status: 400, code: 'validation_failed', message: 'Token has expired or is invalid' }, 'codigo'), venc);
  assert.notEqual(traducir({ status: 403, code: 'otp_expired' }, 'codigo'), MSG_DOMINIO);
});
test('límites de envío y falta de conexión en cualquier paso', () => {
  const lim = 'Pediste muchos códigos seguidos. Esperá un ratito y probá de nuevo.';
  assert.equal(traducir({ status: 429, code: 'over_email_send_rate_limit' }, 'mail'), lim);
  assert.equal(traducir({ code: 'over_request_rate_limit' }, 'codigo'), lim);
  assert.equal(traducir({ message: 'For security purposes, you can only request this after 52 seconds.' }, 'mail'), lim);
  assert.equal(traducir({ message: 'Failed to fetch' }, 'mail'), 'No hay conexión. Revisá tu señal y probá de nuevo.');
});
test('error desconocido o paso otro: mensaje genérico', () => {
  const gen = 'No pudimos hacerlo. Probá de nuevo en un momento.';
  assert.equal(traducir(new Error('boom'), 'otro'), gen);
  assert.equal(traducir({ status: 403 }, 'otro'), gen);
  assert.equal(traducir(null, 'mail'), gen);
});
