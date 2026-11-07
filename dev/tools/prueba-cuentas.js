// Prueba en navegador de Cuentas claras con TRES sesiones reales (zz-prueba-a, b y c en contextos separados) contra
// el proyecto Supabase: A arma un asado con tercer tiempo y los tres se anotan; A carga $ 1.000 entre los tres y B y C
// ven en vivo que deben $ 333; B marca "Ya pagué" y A lo ve sin recargar; un gasto borrado desaparece en vivo; C se baja
// y sigue viendo su deuda y la paga; apagar el tercer tiempo con gastos se rechaza con el motivo. Capturas en dev/shots/.
// Las contraseñas salen de .env (ZZ_PRUEBA_A/B/C_PASSWORD), nunca de la línea de comandos.
// Al final se borran los gastos y pagos de la prueba y la actividad (título "zz Asado ...") queda cancelada; la
// actividad se borra después con dev/supabase/limpiar-pruebas.sql (las RLS no dejan borrar actividades).
// Uso: servir la raíz con `npx --yes http-server -p 8080 -c-1` y correr `node dev/tools/prueba-cuentas.js`
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const URL_APP = process.env.URL_APP || 'http://127.0.0.1:8080';
const shots = path.join(__dirname, '..', 'shots');
fs.mkdirSync(shots, { recursive: true });

function leerEnv() {
  const f = path.join(__dirname, '..', '..', '.env');
  const o = {};
  if (!fs.existsSync(f)) return o;
  fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((l) => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
  return o;
}
const env = leerEnv();
if (!env.ZZ_PRUEBA_A_PASSWORD || !env.ZZ_PRUEBA_B_PASSWORD || !env.ZZ_PRUEBA_C_PASSWORD) {
  console.log('Faltan ZZ_PRUEBA_A/B/C_PASSWORD en .env (ver dev/supabase/usuarios-prueba.sql).');
  process.exit(2);
}

async function abrir(browser, letra) {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  p.errores = [];
  p.on('pageerror', (e) => p.errores.push(e.message));
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await p.goto(URL_APP, { waitUntil: 'networkidle0' });
  const email = `zz-prueba-${letra.toLowerCase()}@cedi.com.ar`;
  const clave = env[`ZZ_PRUEBA_${letra}_PASSWORD`];
  const r = await p.evaluate(async (e, c) => { const { error } = await App.sb.auth.signInWithPassword({ email: e, password: c }); return error ? error.message : null; }, email, clave);
  assert.equal(r, null, 'login ' + letra + ': ' + r);
  await p.reload({ waitUntil: 'networkidle0' });
  await p.waitForSelector('#btn-nueva-act');
  p.id = await p.evaluate(() => App.yo().id);
  return p;
}
const NB = '\u00a0';
const pes = (s) => s.replace(/\$ /g, '$' + NB);
const T = 20000;
const texto = (p, sel) => p.$eval(sel, (e) => e.textContent);
const clic = (p, sel) => p.$eval(sel, (e) => e.click()); // por DOM: el toast puede tapar el botón
const enCuentas = (p, re) => p.waitForFunction((r) => { const e = document.getElementById('cuentas-act'); return !!e && !e.hidden && new RegExp(r).test(e.textContent); }, { timeout: T }, re.source);
const sinEnCuentas = (p, re) => p.waitForFunction((r) => { const e = document.getElementById('cuentas-act'); return !!e && !new RegExp(r).test(e.textContent); }, { timeout: T }, re.source);
const abrirTarjeta = (p, t) => p.waitForFunction((x) => { const e = [...document.querySelectorAll('.tarjeta-act')].find((y) => y.querySelector('.tarjeta-titulo').textContent === x); if (e) e.click(); return !!e; }, { timeout: T }, t);
// para las capturas: la sección arriba de todo y sin el aviso flotante tapando
const verCuentas = async (p) => {
  await p.waitForFunction(() => document.getElementById('toast').hidden, { timeout: T });
  await p.evaluate(() => document.getElementById('cuentas-act').scrollIntoView({ block: 'start' }));
};
const api = (p, fn, ...a) => p.evaluate(fn, ...a);
async function cargarGasto(p, monto, concepto, sacar = []) {
  await clic(p, '#cu-nuevo');
  await p.waitForSelector('#cu-form');
  await p.$eval('#cu-monto', (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, monto);
  await p.$eval('#cu-concepto', (e, v) => { e.value = v; }, concepto);
  for (const id of sacar) await p.$eval('#cu-p-' + id, (e) => e.click());
  await clic(p, '#cu-guardar');
}
async function pagarPrimera(p) {
  await clic(p, '#cu-transferencias .cu-pagar');
  await p.waitForSelector('#cu-confirmar-si');
  await clic(p, '#cu-confirmar-si');
}

(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  let actId = null;
  const ps = [];
  try {
    const A = await abrir(b, 'A'); const B = await abrir(b, 'B'); const C = await abrir(b, 'C');
    ps.push(A, B, C);
    const titulo = 'zz Asado ' + Date.now();

    // A arma el asado con tercer tiempo; A y B van a las dos partes, C solo a la actividad
    actId = await api(A, async (t) => {
      const en = (h) => new Date(Date.now() + h * 3600e3).toISOString();
      const { data, error } = await App.sb.from('actividades').insert({ tipo: 'asado', titulo: t, fecha: en(30), lugar: 'Quincho de prueba', tiene_tercer: true, tercer_lugar: 'Bar de prueba', tercer_fecha: en(33) }).select().single();
      if (error) throw new Error(error.message);
      return data.id;
    }, titulo);
    const anotar = (p, parte) => api(p, async (a, x) => { const { error } = await App.sb.from('asistencias').insert({ actividad: a, parte: x }); if (error) throw new Error(error.message); }, actId, parte);
    await anotar(A, 'actividad'); await anotar(A, 'tercer');
    await anotar(B, 'actividad'); await anotar(B, 'tercer');
    await anotar(C, 'actividad');
    for (const p of [A, B, C]) { await abrirTarjeta(p, titulo); await enCuentas(p, /Todavía no hay gastos cargados/); }

    // A carga $ 1.000 entre los tres: B y C lo ven en vivo
    await cargarGasto(A, '1.000', 'Carne');
    await enCuentas(A, new RegExp(pes('Te deben \\$ 666')));
    await enCuentas(B, new RegExp(pes('Debés \\$ 333')));
    await enCuentas(C, new RegExp(pes('Debés \\$ 333')));
    const trans = await A.$$eval('#cu-transferencias li .cu-txt', (ls) => ls.map((l) => l.textContent));
    assert.equal(trans.length, 2, JSON.stringify(trans));
    assert.ok(trans.every((t) => t.includes(pes('te debe $ 333'))), JSON.stringify(trans));
    await verCuentas(A);
    await A.screenshot({ path: path.join(shots, 'cuentas-claro.png') });
    await verCuentas(B);
    await B.screenshot({ path: path.join(shots, 'cuentas-b-claro.png') });

    // B: "Ya pagué" (confirmación en la página) y A lo ve sin recargar
    await clic(B, '#cu-transferencias .cu-pagar');
    await B.waitForSelector('#cu-confirmar-si');
    await B.screenshot({ path: path.join(shots, 'cuentas-confirmar-claro.png') });
    await clic(B, '#cu-confirmar-si');
    await enCuentas(B, /Estás al día/);
    await enCuentas(A, new RegExp(pes('Te deben \\$ 333')));
    await enCuentas(A, /te pagó/);

    // un gasto borrado desaparece en vivo (Realtime manda los DELETE sin filtro: se recarga si es de esta actividad)
    await cargarGasto(A, '300', 'Hielo', [C.id]);
    await enCuentas(B, new RegExp(pes('Debés \\$ 150')));
    await A.waitForSelector('#cu-gastos .cu-borrar');
    await A.evaluate(() => [...document.querySelectorAll('#cu-gastos li')].find((l) => /Hielo/.test(l.textContent)).querySelector('.cu-borrar').click());
    await A.waitForSelector('#cu-confirmar-si');
    await clic(A, '#cu-confirmar-si');
    await sinEnCuentas(B, /Hielo/);
    await enCuentas(B, /Estás al día/);

    // C se baja y sigue viendo su deuda; la paga
    await C.waitForSelector('#btn-voy');
    await clic(C, '#btn-voy');
    await C.waitForFunction(() => document.getElementById('btn-voy') && document.getElementById('btn-voy').textContent === 'Voy', { timeout: T });
    await enCuentas(C, new RegExp(pes('Debés \\$ 333')));
    await C.waitForSelector('#cu-no-anotado');
    assert.equal(await C.$('#chat-act'), null, 'C sin chat');
    assert.doesNotMatch(await texto(C, '#pantalla-actividades'), /null|undefined/);
    await pagarPrimera(C);
    await enCuentas(C, /Estás al día/);
    await enCuentas(A, /Estás al día/);

    // tercer tiempo: A carga $ 3.200 entre A y B; B lo ve en su pestaña del tercer tiempo
    await clic(A, '#cu-parte-tercer');
    await enCuentas(A, /Todavía no hay gastos del tercer tiempo/);
    await cargarGasto(A, '3200', 'Cerveza');
    await enCuentas(A, new RegExp(pes('Te deben \\$ 1.600')));
    await clic(B, '#cu-parte-tercer');
    await enCuentas(B, new RegExp(pes('Debés \\$ 1.600')));

    // apagar el tercer tiempo con gastos: la base lo rechaza y el formulario lo dice
    await A.evaluate(() => [...document.querySelectorAll('#pantalla-actividades .btn-sec')].find((x) => x.textContent === 'Editar').click());
    await A.waitForSelector('#f-tercer');
    await clic(A, '#f-tercer');
    await clic(A, '#btn-guardar-act');
    await A.waitForSelector('#aviso-tercer:not([hidden])');
    await clic(A, '#btn-confirmar-tercer');
    await A.waitForFunction(() => /El tercer tiempo tiene gastos cargados: pedile a quien los cargó que los borre antes de sacarlo/.test(document.querySelector('form.form-act .error').textContent), { timeout: T });
    assert.equal(await A.$eval('#f-tercer', (e) => e.checked), true);
    assert.equal(await api(A, async (a) => (await App.sb.from('actividades').select('tiene_tercer').eq('id', a).single()).data.tiene_tercer, actId), true);
    await A.evaluate(() => document.querySelector('#pantalla-actividades .btn-link').click());
    await A.waitForSelector('#cuentas-act');
    await enCuentas(A, /Cerveza/);
    await verCuentas(A);

    // Oscuro
    await A.click('#btn-tema');
    await verCuentas(A);
    await A.screenshot({ path: path.join(shots, 'cuentas-oscuro.png') });
    await clic(A, '#cu-parte-actividad');
    await enCuentas(A, /Carne/);
    await verCuentas(A);
    await A.screenshot({ path: path.join(shots, 'cuentas-actividad-oscuro.png') });

    const errores = A.errores.concat(B.errores, C.errores);
    assert.deepEqual(errores, []);
    console.log('ok');
  } finally {
    // Limpieza: cada uno borra sus pagos y gastos de la prueba; A cancela la actividad
    if (actId) {
      for (const p of ps) {
        await api(p, async (a) => {
          const yo = App.yo().id;
          await App.sb.from('pagos').delete().eq('actividad', a).eq('cargado_por', yo);
          await App.sb.from('gastos').delete().eq('actividad', a).eq('cargado_por', yo);
        }, actId).catch(() => {});
      }
      if (ps[0]) await api(ps[0], async (a) => { await App.sb.from('actividades').update({ estado: 'cancelada' }).eq('id', a); }, actId).catch(() => {});
    }
    await b.close();
    console.log('Para borrar las actividades de prueba (las RLS no dejan): correr dev/supabase/limpiar-pruebas.sql con el MCP supabase-thirdcedi o en el SQL Editor.');
  }
})().catch((e) => { console.error(e); process.exit(1); });
