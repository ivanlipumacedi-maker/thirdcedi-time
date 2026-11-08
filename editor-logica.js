// Lógica pura del editor de fotos del álbum (sin DOM): filtros, intensidad, recorte y giro. En el navegador queda en window.EditorLogica.
// Los filtros son las mismas operaciones que ctx.filter de CSS (brightness, contrast, saturate, sepia, hue-rotate), pero
// calculadas acá como una matriz de color: Safari de iPhone no implementa ctx.filter en canvas y así la foto sale igual en
// todos los teléfonos (y se puede probar con node). Encima van pasadas propias: curva (negros levantados, contraste suave),
// tono partido (sombras y luces de distinto color), viñeta y grano.
(function (g) {
  // ---------- Filtros ----------
  // css: la parte que es ctx.filter; wb: ganancia por canal (balance de blancos); bn: blanco y negro con estos pesos por canal;
  // curva: { negro, blanco, s } (negro levantado, blanco que no llega a 1, cuánto de curva en S); partido: corrimiento de color
  // en sombras y luces (en unidades de 0 a 1); vineta: cuánto oscurece las esquinas (0 a 1); grano: amplitud (0 a 1).
  const FILTROS = [
    { id: 'original', nombre: 'Original', desc: 'La foto como salió.' },
    { id: 'vivo', nombre: 'Vivo', desc: 'Más color y contraste, sin pasarse: el pasto de la cancha y las camisetas.',
      css: 'saturate(1.22) contrast(1.06) brightness(1.02)', curva: { negro: 0, blanco: 1, s: 0.35 }, vineta: 0.12 },
    { id: 'calido', nombre: 'Cálido', desc: 'Luz de fogón: tonos dorados y piel con buen color.',
      css: 'saturate(1.08) brightness(1.04)', wb: [1.07, 1.01, 0.9], curva: { negro: 0.015, blanco: 1, s: 0.2 },
      partido: { sombras: [0.015, 0.005, -0.01], luces: [0.03, 0.015, -0.01] }, vineta: 0.12 },
    { id: 'fresco', nombre: 'Fresco', desc: 'Mañana de pádel: aire limpio y azules frescos.',
      css: 'saturate(1.04) brightness(1.04)', wb: [0.95, 1.0, 1.06], curva: { negro: 0.02, blanco: 1, s: 0.18 },
      partido: { sombras: [-0.02, 0.01, 0.025], luces: [0, 0.008, 0.012] } },
    { id: 'atardecer', nombre: 'Atardecer', desc: 'Hora dorada: luces naranjas y sombras azuladas, como de cine.',
      css: 'saturate(1.12) contrast(1.04)', wb: [1.05, 0.99, 0.93], curva: { negro: 0.025, blanco: 0.99, s: 0.3 },
      partido: { sombras: [-0.035, 0.01, 0.045], luces: [0.06, 0.02, -0.045] }, vineta: 0.25 },
    { id: 'pelicula', nombre: 'Película', desc: 'Rollo de 35 mm: negros levantados, color suave y grano fino.',
      css: 'saturate(0.86) contrast(0.96) sepia(0.06)', curva: { negro: [0.075, 0.07, 0.06], blanco: 0.96, s: 0.3 },
      partido: { sombras: [-0.015, 0.012, 0.01], luces: [0.025, 0.012, -0.015] }, vineta: 0.18, grano: 0.07 },
    { id: 'bn', nombre: 'Blanco y negro', desc: 'Blanco y negro con contraste, para el after y los retratos.',
      bn: [0.4, 0.45, 0.15], css: 'contrast(1.12)', curva: { negro: 0.015, blanco: 1, s: 0.45 }, vineta: 0.22, grano: 0.035 },
    { id: 'mate', nombre: 'Mate', desc: 'Contraste bajo y negros grises: tranquilo y prolijo.',
      css: 'saturate(0.8) brightness(1.05)', wb: [1.02, 1.0, 0.98], curva: { negro: 0.13, blanco: 0.94, s: -0.12 },
      partido: { sombras: [0, 0.006, 0.012], luces: [0.01, 0.006, 0] } },
  ];
  const filtro = (id) => FILTROS.find((f) => f.id === id) || FILTROS[0];

  // matrices 3x4 (filas r, g, b; la cuarta columna es el corrimiento, en unidades de 0 a 1)
  const ID = () => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];
  function mult(a, b) { // a ∘ b: primero b, después a
    return a.map((f) => [0, 1, 2, 3].map((j) => f[0] * b[0][j] + f[1] * b[1][j] + f[2] * b[2][j] + (j === 3 ? f[3] : 0)));
  }
  // las fórmulas de la especificación de Filter Effects (las mismas que usa ctx.filter)
  function matrizCSS(nombre, v) {
    switch (nombre) {
      case 'brightness': return [[v, 0, 0, 0], [0, v, 0, 0], [0, 0, v, 0]];
      case 'contrast': { const o = (1 - v) / 2; return [[v, 0, 0, o], [0, v, 0, o], [0, 0, v, o]]; }
      case 'saturate': return [
        [0.213 + 0.787 * v, 0.715 - 0.715 * v, 0.072 - 0.072 * v, 0],
        [0.213 - 0.213 * v, 0.715 + 0.285 * v, 0.072 - 0.072 * v, 0],
        [0.213 - 0.213 * v, 0.715 - 0.715 * v, 0.072 + 0.928 * v, 0]];
      case 'sepia': { const a = Math.min(1, v), b = 1 - a; return [
        [0.393 + 0.607 * b, 0.769 - 0.769 * b, 0.189 - 0.189 * b, 0],
        [0.349 - 0.349 * b, 0.686 + 0.314 * b, 0.168 - 0.168 * b, 0],
        [0.272 - 0.272 * b, 0.534 - 0.534 * b, 0.131 + 0.869 * b, 0]]; }
      case 'grayscale': return matrizCSS('saturate', 1 - Math.min(1, v));
      case 'hue-rotate': { const r = (v * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return [
        [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0],
        [0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283, 0],
        [0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072, 0]]; }
      default: throw new Error('filtro CSS desconocido: ' + nombre);
    }
  }
  /** 'saturate(1.2) contrast(1.1)' → [['saturate', 1.2], ['contrast', 1.1]] */
  function leerCSS(css) {
    const r = [];
    for (const m of String(css || '').matchAll(/([a-z-]+)\(\s*(-?[\d.]+)(deg|%)?\s*\)/g)) r.push([m[1], m[3] === '%' ? Number(m[2]) / 100 : Number(m[2])]);
    return r;
  }
  /** la matriz de color de un filtro: blanco y negro, balance de blancos y después la cadena CSS en orden */
  function matriz(f) {
    let m = ID();
    if (f.bn) { const [a, b, c] = f.bn; m = [[a, b, c, 0], [a, b, c, 0], [a, b, c, 0]]; }
    if (f.wb) m = mult([[f.wb[0], 0, 0, 0], [0, f.wb[1], 0, 0], [0, 0, f.wb[2], 0]], m);
    for (const [n, v] of leerCSS(f.css)) m = mult(matrizCSS(n, v), m);
    return m;
  }

  const suave = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  /** curva por canal (tabla de 256): S suave y después negro y blanco */
  function curva(c, canal) {
    const t = new Float32Array(256);
    const negro = c ? (Array.isArray(c.negro) ? c.negro[canal] : c.negro || 0) : 0, blanco = c && c.blanco != null ? c.blanco : 1, s = (c && c.s) || 0;
    for (let i = 0; i < 256; i++) {
      const v = i / 255, sv = v + s * (v * v * (3 - 2 * v) - v);
      t[i] = negro + sv * (blanco - negro);
    }
    return t;
  }

  // ruido con valor en una grilla (bilineal) para que el grano sea suave y del mismo tamaño en la vista previa y en la foto final
  function hash(x, y, semilla) {
    let h = (x * 374761393 + y * 668265263 + semilla * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }

  /**
   * Aplica el filtro sobre los pixels (RGBA, se modifican en el lugar). k: intensidad de 0 a 1 (mezcla con la original).
   * ancho y alto son los del lienzo. Para que el grano tenga el mismo tamaño en la vista previa y en la foto guardada:
   * escala = pixels del lienzo por pixel de la foto final (0,3 en una vista previa achicada; 1 al guardar) y
   * lado = lado corto de la foto final entera.
   */
  function aplicar(datos, ancho, alto, id, k = 1, { semilla = 7, escala = 1, lado } = {}) {
    const f = filtro(id);
    k = Math.min(1, Math.max(0, k));
    if (f.id === 'original' || k === 0) return datos;
    const m = matriz(f), lut = [curva(f.curva, 0), curva(f.curva, 1), curva(f.curva, 2)];
    const sp = f.partido && f.partido.sombras, lp = f.partido && f.partido.luces;
    const vin = f.vineta || 0;
    const cx = ancho / 2, cy = alto / 2;
    // el grano: un punto cada 1/1100 del lado corto de la foto final (o un pixel, si es chica), llevado a este lienzo. Si en
    // la vista previa ese punto queda más chico que un pixel, se dibuja de un pixel y más suave (como se vería la foto achicada).
    const fin = lado || Math.min(ancho, alto) / escala;
    const pasoReal = Math.max(1, fin / 1100) * escala, pasoG = Math.max(1, pasoReal);
    const gra = (f.grano || 0) * Math.min(1, pasoReal);
    for (let y = 0, i = 0; y < alto; y++) {
      const dy = (y + 0.5 - cy) / cy;
      for (let x = 0; x < ancho; x++, i += 4) {
        const r0 = datos[i] / 255, g0 = datos[i + 1] / 255, b0 = datos[i + 2] / 255;
        let r = m[0][0] * r0 + m[0][1] * g0 + m[0][2] * b0 + m[0][3];
        let gg = m[1][0] * r0 + m[1][1] * g0 + m[1][2] * b0 + m[1][3];
        let b = m[2][0] * r0 + m[2][1] * g0 + m[2][2] * b0 + m[2][3];
        r = lut[0][Math.round(Math.min(1, Math.max(0, r)) * 255)];
        gg = lut[1][Math.round(Math.min(1, Math.max(0, gg)) * 255)];
        b = lut[2][Math.round(Math.min(1, Math.max(0, b)) * 255)];
        if (sp || lp || gra) {
          const L = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
          if (sp) { const w = (1 - L) * (1 - L); r += sp[0] * w; gg += sp[1] * w; b += sp[2] * w; }
          if (lp) { const w = L * L; r += lp[0] * w; gg += lp[1] * w; b += lp[2] * w; }
          if (gra) {
            const gx = x / pasoG, gy = y / pasoG, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
            const a = hash(x0, y0, semilla), c = hash(x0 + 1, y0, semilla), d = hash(x0, y0 + 1, semilla), e = hash(x0 + 1, y0 + 1, semilla);
            const n = (a + (c - a) * fx) + ((d + (e - d) * fx) - (a + (c - a) * fx)) * fy - 0.5;
            const peso = 0.35 + 2.6 * L * (1 - L); // más grano en los medios tonos, como en la película
            const ruido = n * 2 * gra * peso;
            r += ruido; gg += ruido; b += ruido;
          }
        }
        if (vin) {
          const dx = (x + 0.5 - cx) / cx, d = Math.sqrt((dx * dx + dy * dy) / 2);
          const v = 1 - vin * suave(0.45, 1.05, d);
          r *= v; gg *= v; b *= v;
        }
        datos[i] = r0 * 255 + (r * 255 - r0 * 255) * k;
        datos[i + 1] = g0 * 255 + (gg * 255 - g0 * 255) * k;
        datos[i + 2] = b0 * 255 + (b * 255 - b0 * 255) * k;
      }
    }
    return datos;
  }

  /** la intensidad sin volver a calcular el filtro: destino = original + (filtrada - original) × k (lo mismo que aplicar con k) */
  function mezclar(orig, filtrada, k, destino) {
    k = Math.min(1, Math.max(0, k));
    for (let i = 0; i < orig.length; i += 4) {
      destino[i] = orig[i] + (filtrada[i] - orig[i]) * k;
      destino[i + 1] = orig[i + 1] + (filtrada[i + 1] - orig[i + 1]) * k;
      destino[i + 2] = orig[i + 2] + (filtrada[i + 2] - orig[i + 2]) * k;
      destino[i + 3] = orig[i + 3];
    }
    return destino;
  }

  // ---------- Recorte y giro ----------
  // El recorte es un rectángulo normalizado (0 a 1) sobre la foto ya girada: { x, y, w, h }.
  const PROPORCIONES = [
    { id: 'libre', nombre: 'Libre', r: null },
    { id: '1:1', nombre: '1:1', r: 1 },
    { id: '4:5', nombre: '4:5', r: 4 / 5 },
    { id: '16:9', nombre: '16:9', r: 16 / 9 },
  ];
  const ENTERO = () => ({ x: 0, y: 0, w: 1, h: 1 });
  const MIN = 0.08; // lado mínimo del recorte (fracción de la foto)
  const lim = (v, a, b) => Math.min(b, Math.max(a, v));

  /** el recorte más grande con esa proporción (ancho/alto en pixels), centrado en el centro del recorte actual */
  function ajustarProporcion(rect, r, W, H) {
    if (!r) return { ...rect };
    let w = 1, h = (W / r) / H; // ancho completo
    if (h > 1) { h = 1; w = (H * r) / W; }
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    return { x: lim(cx - w / 2, 0, 1 - w), y: lim(cy - h / 2, 0, 1 - h), w, h };
  }

  /**
   * Arrastrar una manija ('no', 'ne', 'so', 'se') o el recorte entero ('mover'). dx y dy en fracción de la foto.
   * Con proporción, la esquina opuesta queda fija y el tamaño sigue al dedo sin salirse de la foto.
   */
  function mover(rect, manija, dx, dy, r, W, H) {
    if (manija === 'mover') return { ...rect, x: lim(rect.x + dx, 0, 1 - rect.w), y: lim(rect.y + dy, 0, 1 - rect.h) };
    const este = manija.includes('e'), sur = manija.includes('s');
    const ax = este ? rect.x : rect.x + rect.w, ay = sur ? rect.y : rect.y + rect.h; // esquina fija
    let px = (este ? rect.x + rect.w : rect.x) + dx, py = (sur ? rect.y + rect.h : rect.y) + dy; // esquina que se mueve
    const maxW = este ? 1 - ax : ax, maxH = sur ? 1 - ay : ay;
    let w = lim(este ? px - ax : ax - px, MIN, maxW), h = lim(sur ? py - ay : ay - py, MIN, maxH);
    if (r) {
      const k = (W / H) / r; // h = w * k en fracciones
      w = (w + h / k) / 2; // lo que pide el dedo, repartido entre los dos ejes
      w = lim(w, Math.max(MIN, MIN / k), Math.min(maxW, maxH / k));
      h = w * k;
    }
    return { x: este ? ax : ax - w, y: sur ? ay : ay - h, w, h };
  }

  /** girar 90° a la derecha: el recorte sigue sobre la misma parte de la foto */
  const girarRect = (rc) => ({ x: 1 - (rc.y + rc.h), y: rc.x, w: rc.h, h: rc.w });
  /** tamaño de la foto después de girar (giro en grados: 0, 90, 180 o 270) */
  const girado = (w, h, giro) => (giro % 180 ? { ancho: h, alto: w } : { ancho: w, alto: h });
  /** el recorte en pixels (enteros, dentro de la foto) */
  function enPixeles(rc, W, H) {
    const x = Math.round(rc.x * W), y = Math.round(rc.y * H);
    return { x, y, w: Math.max(1, Math.min(W - x, Math.round(rc.w * W))), h: Math.max(1, Math.min(H - y, Math.round(rc.h * H))) };
  }
  const esEntero = (rc) => rc.x < 0.001 && rc.y < 0.001 && rc.w > 0.999 && rc.h > 0.999;
  /** ¿hay algo para guardar? */
  const hayCambios = (e) => (e.filtro !== 'original' && e.intensidad > 0) || e.giro % 360 !== 0 || !esEntero(e.recorte);
  const textoIntensidad = (v) => Math.round(v) + ' %';

  const E = { FILTROS, PROPORCIONES, ENTERO, MIN, filtro, matriz, matrizCSS, leerCSS, curva, aplicar, mezclar, ajustarProporcion, mover, girarRect, girado, enPixeles,
    esEntero, hayCambios, textoIntensidad };
  if (typeof module !== 'undefined' && module.exports) module.exports = E; else g.EditorLogica = E;
})(typeof window !== 'undefined' ? window : globalThis);
