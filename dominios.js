// Dominios de mail permitidos del Grupo CEDI. La misma lista está en dev/supabase/02-hook-dominio.sql (el servidor es quien manda).
(function (g) {
  const EMPRESAS = {
    'cedi.com.ar': 'CEDI',
    'wemox.com.ar': 'Wemox',
    'piconsulting.com.ar': 'Pi Consulting',
    'vulps.com.ar': 'Vulps',
    'korex.com.ar': 'Korex',
  };
  const DOMINIOS = Object.keys(EMPRESAS);

  // Dominio después de la última @, en minúsculas; null si el mail no tiene forma de mail.
  function dominioDe(email) {
    if (typeof email !== 'string') return null;
    const e = email.trim().toLowerCase();
    const i = e.lastIndexOf('@');
    if (i < 1 || e.indexOf('@') !== i) return null; // una sola @ y algo antes
    return e.slice(i + 1);
  }
  function permitido(email) {
    const d = dominioDe(email);
    return d !== null && DOMINIOS.indexOf(d) >= 0;
  }
  function empresa(email) {
    const d = dominioDe(email);
    return d !== null && DOMINIOS.indexOf(d) >= 0 ? EMPRESAS[d] : null;
  }

  // un mail con forma de mail (sea o no del grupo): los invitados de afuera (23-invitados.sql) los decide el servidor
  const tieneForma = (email) => dominioDe(email) !== null && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email).trim());

  const Dominios = { DOMINIOS, permitido, empresa, tieneForma };
  if (typeof module !== 'undefined' && module.exports) module.exports = Dominios;
  else g.Dominios = Dominios;
})(typeof window !== 'undefined' ? window : globalThis);
