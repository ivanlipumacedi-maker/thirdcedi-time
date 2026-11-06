// Lógica pura de Cuentas claras (sin DOM): reparto en pesos enteros, saldos, transferencias mínimas y montos.
// Saldo positivo = le deben; negativo = debe. Las asistencias NO entran en el cálculo: quien se bajó de la
// actividad sigue con lo que figura en los gastos y pagos (Review Focus 3).
(function (g) {
  const MAX_MONTO = 100000000; // $ 100.000.000: lo mismo que la base (11-cuentas.sql)
  const MAX_CONCEPTO = 80;
  const PARTES = ['actividad', 'tercer'];

  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

  // Divide un monto entero entre personas (sin repetir): a cada una el cociente y el resto, de a un peso,
  // a las primeras por id ordenado. 1000 entre 3 → 334/333/333. La suma siempre es el monto.
  function repartir(monto, personas) {
    const ids = [...new Set(personas || [])].sort(cmp);
    const out = new Map();
    if (!ids.length) return out;
    const base = Math.floor(monto / ids.length);
    const resto = monto - base * ids.length;
    ids.forEach((id, i) => out.set(id, base + (i < resto ? 1 : 0)));
    return out;
  }

  // gastos: [{id, pagador, monto}], partes: [{gasto, persona}], pagos: [{de, a, monto}].
  // Un gasto sin personas no mueve nada. Cada pago le suma a quien pagó y le resta a quien cobró.
  function saldos(gastos, partes, pagos) {
    const s = new Map();
    const sumar = (id, v) => s.set(id, (s.get(id) || 0) + v);
    const porGasto = new Map();
    (partes || []).forEach((p) => {
      if (!porGasto.has(p.gasto)) porGasto.set(p.gasto, []);
      porGasto.get(p.gasto).push(p.persona);
    });
    (gastos || []).forEach((x) => {
      const personas = porGasto.get(x.id);
      if (!personas || !personas.length) return;
      sumar(x.pagador, x.monto);
      repartir(x.monto, personas).forEach((v, id) => sumar(id, -v));
    });
    (pagos || []).forEach((p) => { sumar(p.de, p.monto); sumar(p.a, -p.monto); });
    return s;
  }

  // Lista corta de transferencias para saldar todo: greedy con acreedores y deudores ordenados por monto
  // descendente (a igual monto, por id, para que el orden no cambie entre repintados).
  function transferencias(saldosMap) {
    const orden = (a, b) => b.v - a.v || cmp(a.id, b.id);
    const acreedores = [];
    const deudores = [];
    (saldosMap || new Map()).forEach((v, id) => {
      if (v > 0) acreedores.push({ id, v });
      else if (v < 0) deudores.push({ id, v: -v });
    });
    acreedores.sort(orden); deudores.sort(orden);
    const out = [];
    let i = 0, j = 0;
    while (i < deudores.length && j < acreedores.length) {
      const d = deudores[i], a = acreedores[j];
      const monto = Math.min(d.v, a.v);
      out.push({ de: d.id, a: a.id, monto });
      d.v -= monto; a.v -= monto;
      if (!d.v) i++;
      if (!a.v) j++;
    }
    return out;
  }

  // Lo de una parte ('actividad' | 'tercer'): cada parte tiene sus propias cuentas.
  function deParte(parte, gastos, partes, pagos) {
    const gs = (gastos || []).filter((x) => x.parte === parte);
    const ids = new Set(gs.map((x) => x.id));
    return { gastos: gs, partes: (partes || []).filter((p) => ids.has(p.gasto)), pagos: (pagos || []).filter((p) => p.parte === parte) };
  }

  let nf = null;
  // "$ 3.200" (espacio que no corta línea). Sin signo: lo dice el texto ("Te deben", "Debés").
  function pesos(n) {
    if (!nf) nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
    return '$ ' + nf.format(Math.abs(Math.round(n || 0)));
  }

  // Lee lo que escribió la persona: "3200", "3.200" o "$ 3.200". Solo pesos enteros de 1 a MAX_MONTO; si no, null.
  function leerMonto(txt) {
    if (txt == null) return null;
    const t = String(txt).trim().replace(/^\$\s*/, '');
    if (!/^(\d{1,3}(\.\d{3})+|\d+)$/.test(t)) return null;
    const n = Number(t.replace(/\./g, ''));
    return Number.isSafeInteger(n) && n >= 1 && n <= MAX_MONTO ? n : null;
  }

  function validarGasto(x) {
    if (!x) return 'Faltan los datos del gasto.';
    if (!Number.isInteger(x.monto) || x.monto < 1 || x.monto > MAX_MONTO) return 'Poné el monto en pesos, sin centavos (por ejemplo 3200).';
    const c = String(x.concepto == null ? '' : x.concepto).trim();
    if (!c) return 'Contanos qué fue (por ejemplo: cancha, carne, bebidas).';
    if (c.length > MAX_CONCEPTO) return 'El concepto puede tener hasta ' + MAX_CONCEPTO + ' letras.';
    if (!x.pagador) return 'Elegí quién pagó.';
    if (!x.personas || !x.personas.length) return 'Elegí entre quiénes se divide.';
    return null;
  }

  function resumen(saldosMap, yo) {
    const v = (saldosMap && saldosMap.get(yo)) || 0;
    if (v > 0) return { tipo: 'te-deben', monto: v, texto: 'Te deben ' + pesos(v) };
    if (v < 0) return { tipo: 'debes', monto: -v, texto: 'Debés ' + pesos(-v) };
    return { tipo: 'al-dia', monto: 0, texto: 'Estás al día' };
  }

  const CuentasLogica = { MAX_MONTO, MAX_CONCEPTO, PARTES, repartir, saldos, transferencias, deParte, pesos, leerMonto, validarGasto, resumen };
  if (typeof module !== 'undefined' && module.exports) module.exports = CuentasLogica;
  else g.CuentasLogica = CuentasLogica;
})(typeof window !== 'undefined' ? window : globalThis);
