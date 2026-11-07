// Traduce errores de Supabase Auth a mensajes en español, según el paso del acceso ('mail' | 'codigo' | 'otro').
(function (g) {
  const MSG_DOMINIO = 'Usá tu mail del Grupo CEDI';
  const MSG_CAPTCHA = 'No pudimos comprobar que sos una persona. Revisá tu conexión y probá de nuevo.';

  function traducir(e, paso) {
    const code = String((e && (e.code || e.error_code)) || '').toLowerCase();
    const msg = String((e && e.message) || '').toLowerCase();
    const st = e && e.status;
    if (code.indexOf('rate_limit') >= 0 || st === 429 || msg.indexOf('rate limit') >= 0 || msg.indexOf('security purposes') >= 0) {
      return 'Pediste muchos códigos seguidos. Esperá un ratito y probá de nuevo.';
    }
    if (msg.indexOf('failed to fetch') >= 0 || msg.indexOf('networkerror') >= 0 || msg.indexOf('network request') >= 0) {
      return 'No hay conexión. Revisá tu señal y probá de nuevo.';
    }
    // con el captcha activo (Turnstile), Supabase rechaza el pedido sin token válido: code captcha_failed
    if (code.indexOf('captcha') >= 0 || msg.indexOf('captcha') >= 0) return MSG_CAPTCHA;
    if (paso === 'codigo') {
      if (code === 'otp_expired' || code === 'otp_disabled' || code === 'validation_failed' || st === 403 || st === 400 || msg.indexOf('expired') >= 0 || msg.indexOf('invalid') >= 0) {
        return 'El código no es válido o venció. Pedí uno nuevo.';
      }
    }
    if (paso === 'mail') {
      if (code === 'email_address_invalid' || msg.indexOf('email address') >= 0 && msg.indexOf('invalid') >= 0) return 'Ese mail no parece válido. Revisalo.';
      // el hook "Before User Created" rechaza con 403 y este mensaje
      if (st === 403 || code.indexOf('hook') >= 0 || msg.indexOf('grupo cedi') >= 0) return MSG_DOMINIO;
    }
    return 'No pudimos hacerlo. Probá de nuevo en un momento.';
  }

  const Errores = { MSG_DOMINIO, MSG_CAPTCHA, traducir };
  if (typeof module !== 'undefined' && module.exports) module.exports = Errores;
  else g.Errores = Errores;
})(typeof window !== 'undefined' ? window : globalThis);
