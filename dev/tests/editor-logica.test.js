// Tests de la lógica del editor de fotos: filtros (matrices de CSS, intensidad, curva, viñeta, grano) y recorte/giro.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../editor-logica.js');

const cerca = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${a} no está cerca de ${b}`);
const pixel = (r, g, b) => new Uint8ClampedArray([r, g, b, 255]);
/** una foto de prueba: degradé horizontal de color (de rojo oscuro a celeste claro) */
function foto(w = 64, h = 48) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, t = x / (w - 1);
    d[i] = 120 + 60 * Math.sin(t * 3); d[i + 1] = 40 + 170 * t; d[i + 2] = 60 + 160 * t * t; d[i + 3] = 255;
  }
  return d;
}

test('hay entre 6 y 8 filtros, con Original primero, nombres en castellano y descripciones', () => {
  assert.ok(E.FILTROS.length >= 6 && E.FILTROS.length <= 8);
  assert.equal(E.FILTROS[0].id, 'original');
  assert.deepEqual(E.FILTROS.map((f) => f.nombre), ['Original', 'Vivo', 'Cálido', 'Fresco', 'Atardecer', 'Película', 'Blanco y negro', 'Mate']);
  assert.equal(new Set(E.FILTROS.map((f) => f.id)).size, E.FILTROS.length, 'ids repetidos');
  for (const f of E.FILTROS) assert.ok(f.desc && f.desc.length > 10, 'sin descripción: ' + f.id);
  assert.equal(E.filtro('no-existe').id, 'original');
});

test('leerCSS entiende la sintaxis de ctx.filter', () => {
  assert.deepEqual(E.leerCSS('saturate(1.2) contrast(110%) hue-rotate(-4deg)'), [['saturate', 1.2], ['contrast', 1.1], ['hue-rotate', -4]]);
  assert.deepEqual(E.leerCSS(''), []);
});

test('mezclar es lo mismo que aplicar con esa intensidad', () => {
  const o = foto(), full = foto(), con = foto(), dest = new Uint8ClampedArray(o.length);
  E.aplicar(full, 64, 48, 'pelicula', 1); E.aplicar(con, 64, 48, 'pelicula', 0.3);
  E.mezclar(o, full, 0.3, dest);
  for (let i = 0; i < o.length; i++) assert.ok(Math.abs(dest[i] - con[i]) <= 1, 'byte ' + i);
});

test('las matrices de CSS: identidad en el valor neutro y los casos conocidos', () => {
  const id = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];
  for (const [n, v] of [['brightness', 1], ['contrast', 1], ['saturate', 1], ['sepia', 0], ['hue-rotate', 0]]) {
    E.matrizCSS(n, v).forEach((f, i) => f.forEach((x, j) => cerca(x, id[i][j])));
  }
  // contrast(0) deja todo en gris medio; saturate(0) da la luminancia (las tres filas iguales y suman 1)
  E.matrizCSS('contrast', 0).forEach((f) => { cerca(f[3], 0.5); cerca(f[0] + f[1] + f[2], 0); });
  const s0 = E.matrizCSS('saturate', 0);
  s0.forEach((f) => { assert.deepEqual(f, s0[0]); cerca(f[0] + f[1] + f[2], 1); });
  // hue-rotate conserva el gris (cada fila suma 1)
  E.matrizCSS('hue-rotate', 77).forEach((f) => cerca(f[0] + f[1] + f[2], 1));
  assert.throws(() => E.matrizCSS('blur', 2));
});

test('Original y la intensidad 0 no tocan la foto', () => {
  const a = foto(), b = foto();
  E.aplicar(b, 64, 48, 'original', 1);
  assert.deepEqual(b, a);
  for (const f of E.FILTROS) { const c = foto(); E.aplicar(c, 64, 48, f.id, 0); assert.deepEqual(c, a, f.id); }
});

test('la intensidad mezcla en línea recta entre la original y el filtro al 100 %', () => {
  for (const id of ['vivo', 'atardecer', 'mate']) {
    const o = foto(), full = foto(), mitad = foto();
    E.aplicar(full, 64, 48, id, 1); E.aplicar(mitad, 64, 48, id, 0.5);
    for (let i = 0; i < o.length; i += 4) for (let c = 0; c < 3; c++) {
      assert.ok(Math.abs(mitad[i + c] - (o[i + c] + full[i + c]) / 2) <= 1, `${id} pixel ${i / 4} canal ${c}`);
    }
  }
});

test('cada filtro cambia la foto de forma visible y distinta de los otros', () => {
  const res = E.FILTROS.slice(1).map((f) => { const d = foto(); E.aplicar(d, 64, 48, f.id, 1); return [f.id, d]; });
  const o = foto();
  const dif = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return s / (a.length / 4) / 3; };
  for (const [id, d] of res) assert.ok(dif(d, o) > 3, `${id} casi no cambia (${dif(d, o).toFixed(2)})`);
  for (let i = 0; i < res.length; i++) for (let j = i + 1; j < res.length; j++) {
    assert.ok(dif(res[i][1], res[j][1]) > 1.5, `${res[i][0]} y ${res[j][0]} se ven iguales`);
  }
});

test('Blanco y negro deja los tres canales iguales', () => {
  const d = foto(); E.aplicar(d, 64, 48, 'bn', 1);
  for (let i = 0; i < d.length; i += 4) { assert.ok(Math.abs(d[i] - d[i + 1]) <= 1 && Math.abs(d[i + 1] - d[i + 2]) <= 1, 'pixel ' + i / 4); }
});

test('Película y Mate levantan los negros; Cálido calienta y Fresco enfría', () => {
  for (const id of ['pelicula', 'mate']) { const p = pixel(0, 0, 0); E.aplicar(p, 1, 1, id, 1); assert.ok(p[0] > 12 && p[1] > 12 && p[2] > 10, id + ': ' + [...p]); }
  const gris = () => pixel(128, 128, 128);
  const c = gris(); E.aplicar(c, 1, 1, 'calido', 1); assert.ok(c[0] > c[2] + 15, 'cálido: ' + [...c]);
  const f = gris(); E.aplicar(f, 1, 1, 'fresco', 1); assert.ok(f[2] > f[0] + 10, 'fresco: ' + [...f]);
  // Vivo satura: un color medio se aleja del gris
  const v = pixel(160, 110, 90); E.aplicar(v, 1, 1, 'vivo', 1); assert.ok(v[0] - v[2] > 160 - 90, 'vivo: ' + [...v]);
});

test('la viñeta oscurece las esquinas y no el centro', () => {
  const w = 101, h = 101, d = new Uint8ClampedArray(w * h * 4).fill(150);
  E.aplicar(d, w, h, 'atardecer', 1);
  const lum = (x, y) => { const i = (y * w + x) * 4; return d[i] + d[i + 1] + d[i + 2]; };
  assert.ok(lum(0, 0) < lum(50, 50) - 40, `esquina ${lum(0, 0)} centro ${lum(50, 50)}`);
});

test('el grano es determinístico y suave (sin pixels sueltos extremos)', () => {
  const w = 120, h = 90, a = new Uint8ClampedArray(w * h * 4).fill(128), b = new Uint8ClampedArray(w * h * 4).fill(128);
  E.aplicar(a, w, h, 'pelicula', 1, { semilla: 3 }); E.aplicar(b, w, h, 'pelicula', 1, { semilla: 3 });
  assert.deepEqual(a, b);
  // en el centro (sin viñeta) varía, pero poco
  const vals = []; for (let x = 40; x < 80; x++) vals.push(a[(45 * w + x) * 4]);
  const min = Math.min(...vals), max = Math.max(...vals);
  assert.ok(max - min >= 3, 'no hay grano'); assert.ok(max - min <= 50, 'grano demasiado fuerte: ' + (max - min));
});

test('el grano tiene el mismo tamaño en la vista previa que en la foto final (escala y lado)', () => {
  // foto final de 3000 px de lado corto vista en un lienzo de 300: el grano se ve más suave, no más grueso
  const w = 400, h = 300, chica = new Uint8ClampedArray(w * h * 4).fill(128), grande = new Uint8ClampedArray(w * h * 4).fill(128);
  E.aplicar(chica, w, h, 'pelicula', 1, { escala: 0.1, lado: 3000 }); E.aplicar(grande, w, h, 'pelicula', 1);
  const rango = (d) => { const v = []; for (let x = 150; x < 250; x++) v.push(d[(150 * w + x) * 4]); return Math.max(...v) - Math.min(...v); };
  assert.ok(rango(chica) < rango(grande), `${rango(chica)} vs ${rango(grande)}`);
});

test('curva: negro levantado, blanco y S', () => {
  const t = E.curva({ negro: 0.1, blanco: 0.9, s: 0 }, 0);
  cerca(t[0], 0.1); cerca(t[255], 0.9); cerca(t[128], 0.1 + 0.8 * 128 / 255);
  const s = E.curva({ s: 0.5 }, 0);
  assert.ok(s[64] < 64 / 255 && s[192] > 192 / 255, 'la S oscurece sombras y aclara luces');
  const canal = E.curva({ negro: [0.1, 0.05, 0] }, 1); cerca(canal[0], 0.05);
});

// ---------- Recorte y giro ----------
test('proporciones: Libre, 1:1, 4:5 y 16:9', () => {
  assert.deepEqual(E.PROPORCIONES.map((p) => p.nombre), ['Libre', '1:1', '4:5', '16:9']);
});

test('ajustarProporcion: el más grande que entra, con la proporción en pixels', () => {
  const W = 4000, H = 3000;
  const sq = E.ajustarProporcion(E.ENTERO(), 1, W, H);
  cerca(sq.w * W, sq.h * H); cerca(sq.h, 1); cerca(sq.x, (1 - sq.w) / 2);
  const p = E.ajustarProporcion(E.ENTERO(), 16 / 9, W, H);
  cerca((p.w * W) / (p.h * H), 16 / 9); cerca(p.w, 1);
  const v = E.ajustarProporcion(E.ENTERO(), 4 / 5, 3000, 4000);
  cerca((v.w * 3000) / (v.h * 4000), 4 / 5); assert.ok(v.x >= 0 && v.y >= 0 && v.x + v.w <= 1 + 1e-9 && v.y + v.h <= 1 + 1e-9);
  assert.deepEqual(E.ajustarProporcion({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, null, W, H), { x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
});

test('mover: arrastrar el recorte no lo saca de la foto', () => {
  const r = E.mover({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, 'mover', 0.6, -0.9, null, 100, 100);
  assert.deepEqual(r, { x: 0.5, y: 0, w: 0.5, h: 0.5 });
});

test('manijas libres: la esquina opuesta queda fija, con tamaño mínimo y sin salirse', () => {
  const r0 = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
  const se = E.mover(r0, 'se', 0.1, 0.05, null, 100, 100);
  cerca(se.x, 0.2); cerca(se.y, 0.2); cerca(se.w, 0.6); cerca(se.h, 0.55);
  const no = E.mover(r0, 'no', -0.5, -0.5, null, 100, 100);
  cerca(no.x, 0); cerca(no.y, 0); cerca(no.x + no.w, 0.7); cerca(no.y + no.h, 0.7);
  const chico = E.mover(r0, 'ne', -0.9, 0.9, null, 100, 100);
  cerca(chico.w, E.MIN); cerca(chico.h, E.MIN); cerca(chico.x, 0.2); cerca(chico.y + chico.h, 0.7);
});

test('manijas con proporción: mantiene la proporción en pixels y no se sale', () => {
  const W = 4000, H = 3000;
  let r = E.ajustarProporcion(E.ENTERO(), 1, W, H);
  r = E.mover(r, 'so', 0.2, -0.1, 1, W, H); // achicar desde abajo a la izquierda
  cerca((r.w * W) / (r.h * H), 1);
  assert.ok(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= 1 + 1e-9 && r.y + r.h <= 1 + 1e-9);
  const g = E.mover(r, 'ne', 1, -1, 1, W, H); // agrandar todo lo posible
  cerca((g.w * W) / (g.h * H), 1); assert.ok(g.x + g.w <= 1 + 1e-9 && g.y >= -1e-9);
});

test('girar 90°: el recorte sigue sobre la misma parte y cuatro giros vuelven al inicio', () => {
  const r = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
  const g1 = E.girarRect(r), esp = { x: 0.4, y: 0.1, w: 0.4, h: 0.3 };
  for (const k of ['x', 'y', 'w', 'h']) cerca(g1[k], esp[k]);
  let q = r; for (let i = 0; i < 4; i++) q = E.girarRect(q);
  for (const k of ['x', 'y', 'w', 'h']) cerca(q[k], r[k]);
  assert.deepEqual(E.girado(4000, 3000, 90), { ancho: 3000, alto: 4000 });
  assert.deepEqual(E.girado(4000, 3000, 180), { ancho: 4000, alto: 3000 });
});

test('enPixeles redondea dentro de la foto', () => {
  assert.deepEqual(E.enPixeles({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, 101, 99), { x: 51, y: 50, w: 50, h: 49 });
  assert.deepEqual(E.enPixeles(E.ENTERO(), 640, 480), { x: 0, y: 0, w: 640, h: 480 });
});

test('hayCambios: filtro con intensidad, giro o recorte', () => {
  const base = { filtro: 'original', intensidad: 100, giro: 0, recorte: E.ENTERO() };
  assert.equal(E.hayCambios(base), false);
  assert.equal(E.hayCambios({ ...base, filtro: 'vivo' }), true);
  assert.equal(E.hayCambios({ ...base, filtro: 'vivo', intensidad: 0 }), false);
  assert.equal(E.hayCambios({ ...base, giro: 90 }), true);
  assert.equal(E.hayCambios({ ...base, giro: 360 }), false);
  assert.equal(E.hayCambios({ ...base, recorte: { x: 0, y: 0, w: 0.5, h: 1 } }), true);
  assert.equal(E.textoIntensidad(69.6), '70 %');
});
