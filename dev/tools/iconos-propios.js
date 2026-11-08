// Generador de los íconos propios de ThirdCEDI Time. Los dibujos se describen como piezas con relleno y contorno (el set v1 de
// "figuritas"), pero la app los usa de un color: cada uno sale como <symbol id="p-<nombre>"> con máscara (ver renderMono) y se
// escribe en index.html; App.icono los pinta con currentColor, igual que los de Phosphor.
// Uso: node dev/tools/iconos-propios.js
// Los ids internos (clipPath) llevan el prefijo tct- para no chocar con nada si algún día se ponen inline.
const fs = require('fs');
const path = require('path');
const INDEX = path.join(__dirname, '..', '..', 'index.html');

const INK = '#13294B';
const K = {
  celeste: '#00B1EF', celesteClaro: '#8FDDF8', azul: '#1F5FBF', cesped: '#3DBE5A', cespedOsc: '#2A9A48',
  lima: '#DDF247', sol: '#FFC83D', solOsc: '#E39B10', brasa: '#FF6B2C', carne: '#D9463B', carneOsc: '#8E2A20',
  grasa: '#FDE6D3', chorizo: '#B4402C', rosa: '#FF5D8F', rosaClaro: '#FFB3C8', lavanda: '#8C7CF0', ambar: '#F7A928',
  ambarClaro: '#FFD27A', espuma: '#FFF8EA', metal: '#5E6E8C', metalClaro: '#A9B8CC', acero: '#DCE5F0',
  madera: '#B8743A', maderaClara: '#E7B57E', billete: '#4CC27A', billeteClaro: '#9BE6B4', montana: '#2FA36B',
  montanaOsc: '#23845A', blanco: '#FFFFFF',
};

// Elementos: {t: tag, a: atributos, sw, st (color de trazo), halo, ns (sin trazo), g (hijos), dash}
const attrs = (o) => Object.entries(o).map(([k, v]) => `${k}="${v}"`).join(' ');
const P = (d, fill, o = {}) => ({ t: 'path', a: { d, fill }, ...o });
const C = (cx, cy, r, fill, o = {}) => ({ t: 'circle', a: { cx, cy, r, fill }, ...o });
const R = (x, y, w, h, rx, fill, o = {}) => ({ t: 'rect', a: { x, y, width: w, height: h, rx, fill }, ...o });
const L = (d, st = INK, sw = 2.5, o = {}) => ({ t: 'path', a: { d, fill: 'none' }, st, sw, ...o });
const G = (transform, g) => ({ t: 'g', a: { transform }, g });
const N = (e) => ({ ...e, ns: true }); // relleno sin trazo

function render(e, pass) {
  if (e.t === 'g') {
    const inner = e.g.map((c) => render(c, pass)).join('');
    return inner ? `<g ${attrs(e.a)}>${inner}</g>` : '';
  }
  const sw = e.sw ?? 2.5;
  const st = e.st ?? INK;
  const halo = e.halo ?? (st === INK);
  const a = { ...e.a };
  if (pass === 'halo') {
    if (e.ns || !halo) return '';
    if (a.fill !== 'none') a.fill = '#fff';
    a.stroke = '#fff'; a['stroke-width'] = sw + 4;
    delete a['stroke-dasharray'];
  } else {
    if (e.ns) a.stroke = 'none';
    else { a.stroke = st; a['stroke-width'] = sw; if (e.dash) a['stroke-dasharray'] = e.dash; }
  }
  return `<${e.t} ${attrs(a)}/>`;
}

// Versión de un color (la que usa la app): el mismo dibujo, pero en una máscara. Cada pieza va en blanco (se ve, toma currentColor)
// precedida por un trazo negro más ancho que la separa de lo que tiene abajo; los detalles (agujeros, brillos, líneas finas,
// rellenos sin trazo) van en negro y quedan calados. Así queda como los íconos de relleno de Phosphor: silueta sólida con cortes.
// Ajustes por pieza: mono: 'skip' (no va), 'cut' (calada), 'solid' (pieza sólida aunque no tenga trazo); monoSw: ancho del corte.
const GAP = 2;
function renderMono(e, prev) {
  if (e.t === 'g') {
    let p = null;
    const inner = e.g.map((c) => { const r = renderMono(c, p); p = c; return r; }).join('');
    return inner ? `<g ${attrs(e.a)}>${inner}</g>` : '';
  }
  if (e.mono === 'skip') return '';
  const sw = e.sw ?? 2.5;
  const st = e.st ?? INK;
  const a = { ...e.a };
  delete a['stroke-dasharray'];
  const lineaSola = a.fill === 'none';
  const halo = e.halo ?? (st === INK);
  // el color de relleno de una varilla (línea fina encima de una de tinta con el mismo trazo) no va: la varilla queda sólida
  if (lineaSola && !halo && prev && prev.t === e.t && prev.a && prev.a.d === a.d && e.mono !== 'cut') return '';
  const corte = e.mono === 'cut' || (e.mono !== 'solid' && (e.ns || (lineaSola && !halo)));
  if (corte) {
    if (lineaSola) { a.stroke = '#000'; a['stroke-width'] = e.monoSw ?? sw; if (e.dash) a['stroke-dasharray'] = e.dash; }
    else { a.fill = '#000'; a.stroke = e.ns ? 'none' : '#000'; if (!e.ns) a['stroke-width'] = e.monoSw ?? sw; }
    return `<${e.t} ${attrs(a)}/>`;
  }
  // pieza sólida: primero el corte que la separa de lo de abajo, después la pieza en blanco
  const g = { ...a, stroke: '#000', 'stroke-width': sw + GAP * 2 };
  if (g.fill !== 'none') g.fill = '#000';
  const w = { ...a, stroke: '#fff', 'stroke-width': e.ns ? 0 : sw };
  if (w.fill !== 'none') w.fill = '#fff';
  if (e.ns) w.stroke = 'none';
  const gap = e.monoSinCorte ? '' : `<${e.t} ${attrs(g)}/>`;
  return gap + `<${e.t} ${attrs(w)}/>`;
}

const SIMBOLOS = [];
function svg(name, els, extraDefs = '') {
  let p = null;
  const mono = els.map((e) => { const r = renderMono(e, p); p = e; return r; }).join('');
  const defs = extraDefs.replace(/id="tct-/g, 'id="tct-m-');
  const cuerpo = mono.replace(/url\(#tct-/g, 'url(#tct-m-');
  SIMBOLOS.push(`<symbol id="p-${name}" viewBox="0 0 48 48">` +
    `<mask id="tct-mk-${name}" maskUnits="userSpaceOnUse" x="-4" y="-4" width="56" height="56" stroke-linejoin="round" stroke-linecap="round">` +
    (defs ? `<defs>${defs}</defs>` : '') + cuerpo + `</mask>` +
    `<rect x="-4" y="-4" width="56" height="56" fill="currentColor" mask="url(#tct-mk-${name})"/></symbol>`);
}

const pts = (arr) => 'M' + arr.map((p) => p.map((n) => +n.toFixed(2)).join(' ')).join(' L') + ' Z';
const poly = (cx, cy, r, n, rot) => Array.from({ length: n }, (_, i) => {
  const a = (rot + (360 / n) * i) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
});
const star = (cx, cy, R1, r1, rot = -90) => pts(Array.from({ length: 10 }, (_, i) => {
  const a = (rot + 36 * i) * Math.PI / 180, rr = i % 2 ? r1 : R1; return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
}));

// ---------- Pádel: dos paletas cruzadas (una celeste, otra rosa) y la pelota flúor arriba
function paleta(cara, grip, transform) {
  // origen en el cruce, sobre el mango; la cabeza queda hacia arriba
  const agujeros = [];
  for (const [y, xs] of [[-27, [-4.5, 0, 4.5]], [-22.5, [-6.5, -2.2, 2.2, 6.5]], [-18, [-4.5, 0, 4.5]], [-13.5, [-2.2, 2.2]]]) {
    for (const x of xs) agujeros.push(N(C(x, y, 1.15, INK)));
  }
  return G(transform, [
    R(-2.6, -4, 5.2, 12, 2.2, grip),
    L('M-2.6 -1 L2.6 -2.6 M-2.6 2.4 L2.6 0.8 M-2.6 5.8 L2.6 4.2', '#fff', 1.2, { halo: false }),
    P('M-4.4 -9 L-2.6 -4 L2.6 -4 L4.4 -9 Z', cara),
    P('M0 -33 C8 -33 11 -27 11 -21 C11 -13 6 -8 0 -8 C-6 -8 -11 -13 -11 -21 C-11 -27 -8 -33 0 -33 Z', cara),
    ...agujeros,
    L('M-8 -23.5 C-8 -27.5 -5.5 -30.5 -2.5 -31', '#fff', 1.5, { halo: false }),
  ]);
}
svg('padel', [
  paleta(K.rosa, K.azul, 'translate(24 37) rotate(-34) scale(.88)'),
  paleta(K.celeste, K.lavanda, 'translate(24 37) rotate(34) scale(.88)'),
  C(24, 7.5, 5, K.lima),
  L('M20 5.2 C22.5 6.3 22.8 9.2 21 11.2 M28 9.8 C25.5 8.7 25.2 5.8 27 3.8', '#fff', 1.4, { halo: false }),
]);

// ---------- Asado (principal): tenedor de asador y cuchillo cruzados, llama de brasa arriba
function cubierto(tipo, transform) {
  const mango = [
    R(-3.2, 8, 6.4, 15, 3.2, K.madera),
    N(C(0, 12.5, 1, K.maderaClara)), N(C(0, 18.5, 1, K.maderaClara)),
    R(-3.9, 5.2, 7.8, 3.2, 1.2, K.metalClaro, { sw: 2 }),
  ];
  const punta = tipo === 'cuchillo'
    ? [P('M-2.8 5.2 V-17 Q-2.8 -21.8 1.6 -24.5 Q4.4 -16 4.4 -4 V5.2 Z', K.acero),
       L('M1.4 2.5 V-4 Q1.4 -13 0.4 -19', '#fff', 1.5, { halo: false })]
    : [R(-1.4, -7, 2.8, 12.5, 1, K.acero, { sw: 2 }),
       L('M-5 -21 V-11 Q-5 -6.5 0 -6.5 Q5 -6.5 5 -11 V-21', INK, 5.2),
       L('M-5 -21 V-11 Q-5 -6.5 0 -6.5 Q5 -6.5 5 -11 V-21', K.acero, 1.9, { halo: false })];
  return G(transform, [...punta, ...mango]);
}
const llama = [
  P('M24 2.5 C26.4 6.8 31.5 9.4 31.5 15.6 C31.5 19.8 28.2 22.5 24 22.5 C19.8 22.5 16.5 19.8 16.5 15.6 C16.5 12.6 18.1 10.5 19.6 9.4 C19.9 11.4 20.7 12.6 22 13 C21.4 9.3 22.2 5.4 24 2.5 Z', K.brasa),
  N(P('M24.6 11 C26.2 13.1 28.3 14.6 28.3 17.3 C28.3 19.7 26.4 21 24 21 C21.6 21 19.7 19.7 19.7 17.5 C19.7 16 20.5 15 21.4 14.3 C21.8 15.6 22.5 16.2 23.3 16.4 C23 14.3 23.5 12.4 24.6 11 Z', K.sol)),
];
svg('asado', [
  G('translate(24 12.5) scale(1.05) translate(-24 -12.5)', llama),
  cubierto('tenedor', 'translate(24 31.5) rotate(-45) scale(.82)'),
  cubierto('cuchillo', 'translate(24 31.5) rotate(45) scale(.82)'),
]);

// ---------- After office: dos chopps con manija que chocan, con salpicadura (el chopp se reusa en el tercer tiempo)
function chopp(transform) {
  return G(transform, [
    P('M6 -16 H9 A4 4 0 0 1 13 -12 V-8.5 A4 4 0 0 1 9 -4.5 H6 Z M6 -13 H8.6 A1.5 1.5 0 0 1 10.1 -11.5 V-9 A1.5 1.5 0 0 1 8.6 -7.5 H6 Z', K.ambarClaro, { 'fill-rule': 'evenodd', a: { 'fill-rule': 'evenodd', d: 'M6 -16 H9 A4 4 0 0 1 13 -12 V-8.5 A4 4 0 0 1 9 -4.5 H6 Z M6 -13 H8.6 A1.5 1.5 0 0 1 10.1 -11.5 V-9 A1.5 1.5 0 0 1 8.6 -7.5 H6 Z', fill: K.ambarClaro } }),
    P('M-6.5 -19 L6.5 -19 L6 -2 C5.9 -0.8 5 0 3.8 0 L-3.8 0 C-5 0 -5.9 -0.8 -6 -2 Z', K.ambar),
    L('M-2.2 -15.5 V-3.5 M2.2 -15.5 V-3.5', K.ambarClaro, 1.6, { halo: false }),
    P('M-8 -18 C-9.5 -21 -6.5 -24 -3.8 -22.5 C-2.5 -25.5 2.5 -25.5 3.8 -22.5 C6.5 -24 9.5 -21 8 -18 C7.5 -16.8 6.5 -16.5 5.5 -16.5 L-5.5 -16.5 C-6.8 -16.5 -7.6 -17 -8 -18 Z', K.espuma),
  ]);
}
svg('after', [
  L('M24 14 V7.5 M18.4 15.2 L15 11 M29.6 15.2 L33 11', INK, 2.3),
  chopp('translate(14 45) rotate(16) scale(-1 1)'),
  chopp('translate(34 45) rotate(-16)'),
]);

// ---------- Otra: entrada de cine con las muescas a los costados, el talón rosa separado por la línea perforada,
// una estrella en el talón y dos renglones sin texto ("admite uno") en el cuerpo
{
  const TICKET = 'M-17 -13.5 H17 A3 3 0 0 1 20 -10.5 V-3.8 A3.8 3.8 0 0 0 20 3.8 V10.5 A3 3 0 0 1 17 13.5 H-17 A3 3 0 0 1 -20 10.5 V3.8 A3.8 3.8 0 0 0 -20 -3.8 V-10.5 A3 3 0 0 1 -17 -13.5 Z';
  svg('otra', [
    G('translate(24 24.5) rotate(-12) scale(.92)', [
      P(TICKET, K.sol),
      { t: 'g', a: { 'clip-path': 'url(#tct-otra-t)' }, g: [N(R(-21, -15, 13, 30, 0, K.rosa))], mono: 'skip' },
      { ...P(TICKET, 'none'), monoSinCorte: true },
      L('M-8 -11 V11', INK, 1.6, { halo: false, dash: '1.8 2.4' }),
      N(P(star(-12.6, 0.3, 3.7, 1.6, -90), '#fff')),
      L('M-2.5 -2.5 H12 M-2.5 3 H7.5', K.solOsc, 2.4, { halo: false }),
      L('M-2.5 -9.4 H3.5', '#fff', 1.6, { halo: false }),
      N(C(12.6, 6.6, 1.3, K.solOsc)),
    ]),
  ], `<clipPath id="tct-otra-t"><path d="${TICKET}"/></clipPath>`);
}

// ---------- Chat: dos globos superpuestos, el de adelante "escribiendo"
svg('chat', [
  P('M10 6 H25 A6 6 0 0 1 31 12 V19 A6 6 0 0 1 25 25 H14 L8 30 V24.6 A6 6 0 0 1 4 19 V12 A6 6 0 0 1 10 6 Z', K.sol),
  P('M22 17 H38 A6 6 0 0 1 44 23 V30 A6 6 0 0 1 40 35.6 V41 L34 36 H22 A6 6 0 0 1 16 30 V23 A6 6 0 0 1 22 17 Z', K.celeste),
  N(C(23.5, 26.5, 2.1, INK)), N(C(30, 26.5, 2.1, INK)), N(C(36.5, 26.5, 2.1, INK)),
  L('M10 11 H14', '#fff', 1.8, { halo: false }),
]);

// ---------- Cuentas claras: billetera con billetes asomando y una moneda
svg('cuentas', [
  G('rotate(-9 20 13)', [R(8, 6, 24, 15, 2, K.billeteClaro, { sw: 2 }), N(C(20, 11, 2.6, K.billete))]),
  G('rotate(7 27 12)', [R(15, 4.5, 24, 15, 2, K.billete, { sw: 2 }), N(C(27, 10, 2.8, K.billeteClaro))]),
  R(4, 16, 40, 26, 6, K.azul),
  L('M9 21 H27', '#7FB0F5', 1.4, { halo: false, dash: '2 2.4' }),
  P('M30.5 24 H44 V35 H30.5 A5.5 5.5 0 0 1 30.5 24 Z', K.celeste),
  C(32, 29.5, 2, K.sol, { sw: 1.8 }),
  C(12, 37, 7, K.sol),
  { ...N(C(12, 37, 4.6, '#FFDA75')), mono: 'skip' },
  L('M14 34.6 C13.3 33.6 9.9 33.6 9.9 35.6 C9.9 37.6 14.1 36.6 14.1 38.7 C14.1 40.6 10.6 40.5 9.8 39.6 M12 32.8 V41.2', INK, 1.5, { halo: false }),
]);

// ---------- Álbum: cámara amarilla con lente celeste
svg('album', [
  R(8.5, 10.5, 7, 4, 1.5, K.rosa, { sw: 2 }),
  P('M16 15 L19 9.5 H29 L32 15 Z', K.sol),
  R(4, 14, 40, 27, 7, K.sol),
  N(R(4.5, 19, 39, 2.6, 0, K.solOsc)),
  R(35, 17.5, 5.5, 3.6, 1.2, '#fff', { sw: 2 }),
  C(24, 28, 10.5, '#fff'),
  C(24, 28, 7, K.celeste),
  N(C(24, 28, 3.4, K.azul)),
  N(C(21.4, 25.4, 1.9, '#fff')),
]);

// ---------- Trivia: carta lavanda con signo de pregunta
svg('trivia', [
  G('rotate(-7 24 24)', [
    R(8, 4.5, 32, 39, 7, K.lavanda),
    L('M17.5 17.5 C17.5 11.5 30.5 10.5 30.5 17.5 C30.5 22 24 22.5 24 28', INK, 8.4, { halo: false, monoSw: 4.6 }),
    L('M17.5 17.5 C17.5 11.5 30.5 10.5 30.5 17.5 C30.5 22 24 22.5 24 28', K.sol, 4, { halo: false }),
    C(24, 35, 3.2, K.sol, { sw: 2.2, mono: 'cut', monoSw: 1 }),
  ]),
]);

// ---------- Impostor: antifaz rosa con varilla y un destello
svg('impostor', [
  L('M11 30 L6.5 44', INK, 5.4),
  L('M11 30 L6.5 44', K.sol, 2, { halo: false }),
  P('M4 21 C4 16 9 14 15 15.5 C19 16.5 21 18 24 18 C27 18 29 16.5 33 15.5 C39 14 44 16 44 21 C44 28 39.5 33 33.5 33 C28.5 33 27 29 24 29 C21 29 19.5 33 14.5 33 C8.5 33 4 28 4 21 Z', K.rosa),
  P('M9 22.5 C11 19.5 16.5 19.5 19 22.5 C16.5 25.5 11 25.5 9 22.5 Z', INK, { sw: 1.5, mono: 'cut', monoSw: .5 }),
  P('M29 22.5 C31.5 19.5 37 19.5 39 22.5 C37 25.5 31.5 25.5 29 22.5 Z', INK, { sw: 1.5, mono: 'cut', monoSw: .5 }),
  L('M8 18.5 C9.5 17 11.5 16.6 13.5 16.9', '#fff', 1.6, { halo: false }),
  P('M38 2.5 L39.4 7.1 L44 8.5 L39.4 9.9 L38 14.5 L36.6 9.9 L32 8.5 L36.6 7.1 Z', K.sol, { sw: 1.8 }),
]);

// ---------- Barra: actividades (calendario), juegos (dado), perfil
svg('nav-actividades', [
  R(6, 9, 36, 33, 6, '#fff'),
  { ...N(P('M12 9 H36 A6 6 0 0 1 42 15 V19 H6 V15 A6 6 0 0 1 12 9 Z', K.celeste)), mono: 'skip' },
  L('M6 19 H42', INK, 2),
  R(6, 9, 36, 33, 6, 'none'),
  R(13, 5, 4.4, 8, 2.2, K.azul, { sw: 2 }), R(30.6, 5, 4.4, 8, 2.2, K.azul, { sw: 2 }),
  ...[[13, 26], [19.5, 26], [26, 26], [13, 33.5], [19.5, 33.5], [26, 33.5]].map(([x, y]) => N(C(x + 0.5, y, 1.7, '#B9C9DD'))),
  C(33, 33, 4.3, K.rosa, { sw: 2 }),
]);
svg('nav-juegos', [
  G('rotate(-10 24 24)', [
    R(7, 7, 34, 34, 9, K.lavanda),
    ...[[15.5, 15.5], [32.5, 15.5], [24, 24], [15.5, 32.5], [32.5, 32.5]].map(([x, y]) => N(C(x, y, 3, '#fff'))),
  ]),
]);
svg('nav-perfil', [
  C(24, 24, 19, K.celeste),
  { t: 'g', a: { 'clip-path': 'url(#tct-perfil-c)' }, g: [P('M10 41 C11.5 32 17 28.5 24 28.5 C31 28.5 36.5 32 38 41 C34 44.5 29.5 46 24 46 C18.5 46 14 44.5 10 41 Z', '#fff', { sw: 2.2 })] },
  C(24, 18.5, 6.8, '#fff', { sw: 2.2 }),
  C(24, 24, 19, 'none'),
], `<clipPath id="tct-perfil-c"><circle cx="24" cy="24" r="19"/></clipPath>`);

// ---------- Figuras humanas (fútbol y trekking): pictograma tipo deportes olímpicos. Cabeza redonda suelta y cuerpo de trazos
// gruesos con punta redonda; cada uno con un elemento que lo identifica de lejos (la pelota grande / la mochila, el bastón y la montaña).
const T = 5.6; // grosor de tronco y miembros
const M = (d, sw = T) => L(d, INK, sw);

// Trekking: montaña nevada atrás, ladera adelante y el caminante subiendo con mochila grande, gorro y bastón
svg('trekking', [
  P('M23 33 L36 7 L48 30 V33 Z', K.montana, { sw: 2 }),
  L('M31.2 15.6 L33.6 18 L36 15.4 L38.4 18 L40.8 15.8', INK, 2.2, { mono: 'cut' }),
  P('M1 46 L1 40 L47 27 L47 46 Z', K.cesped, { sw: 2 }),
  G('translate(-3 1.5)', [
  G('rotate(-14 14 20)', [R(7.5, 11.5, 11, 16, 4.5, K.sol, { sw: 2 }), L('M10 17.5 H16', '#fff', 1.6, { halo: false })]),
    M('M20.5 15.5 L18.5 27'),
    M('M18.5 27 L14.5 33.5 L11 39.5'),
    M('M18.5 27 L24.5 31 L25 35.8'),
    M('M21 17.5 L26.5 22 L30.5 19'),
    L('M30.5 11 L33.5 31.5', INK, 2.6),
    C(23.2, 8.6, 4.4, '#F2C29B'),
    P('M18.6 7.6 C18.6 4.2 21 2.6 23.4 2.6 C26 2.6 28.2 4.2 28.2 7 L30.4 7.4 L18.6 7.6 Z', K.brasa, { sw: 1.6 }),
  ]),
]);

// Fútbol: la pelota clásica de gajos. Contorno, pentágono negro al centro, cinco costuras que salen de sus puntas y cinco
// pentágonos cortados por el borde; en la versión de un color los pentágonos van llenos y el cuero blanco queda calado.
{
  const CX = 24, CY = 24, RB = 20.5;
  const centro = poly(CX, CY, 6.6, 5, -90);
  const bordes = [], costuras = [];
  for (let i = 0; i < 5; i++) {
    const ang = -90 + 72 * i, rad = ang * Math.PI / 180;
    const px = CX + 20.5 * Math.cos(rad), py = CY + 20.5 * Math.sin(rad);
    bordes.push(pts(poly(px, py, 7.4, 5, ang + 180)));
    const [x1, y1] = centro[i];
    const x2 = CX + 13.4 * Math.cos(rad), y2 = CY + 13.4 * Math.sin(rad);
    costuras.push(`M${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)}`);
    // costuras entre dos gajos del borde: de un vértice lateral de este pentágono al del siguiente, pasando por un nudo
    // que sale hacia el borde de la pelota
    const pa = poly(px, py, 7.4, 5, ang + 180)[1];
    const r3 = (ang + 72) * Math.PI / 180;
    const pb = poly(CX + 20.5 * Math.cos(r3), CY + 20.5 * Math.sin(r3), 7.4, 5, ang + 72 + 180)[4];
    const rad2 = (ang + 36) * Math.PI / 180;
    const jx = CX + 16.4 * Math.cos(rad2), jy = CY + 16.4 * Math.sin(rad2);
    const x4 = CX + 21 * Math.cos(rad2), y4 = CY + 21 * Math.sin(rad2);
    const f = (n) => n.toFixed(2);
    costuras.push(`M${f(pa[0])} ${f(pa[1])} L${f(jx)} ${f(jy)} L${f(pb[0])} ${f(pb[1])} M${f(jx)} ${f(jy)} L${f(x4)} ${f(y4)}`);
  }
  svg('futbol', [
    { ...C(CX, CY, RB, '#fff', { sw: 0.01 }), mono: 'skip' },
    { t: 'g', a: { 'clip-path': 'url(#tct-pelota)' }, g: bordes.map((d) => ({ ...P(d, INK, { sw: 0.01 }), monoSinCorte: true })) },
    { ...P(pts(centro), INK, { sw: 1.4 }), monoSinCorte: true },
    { ...L(costuras.join(' '), INK, 2.3), monoSinCorte: true },
    { ...C(CX, CY, RB, 'none', { sw: 3.2 }), monoSinCorte: true },
  ], `<clipPath id="tct-pelota"><circle cx="${CX}" cy="${CY}" r="${RB}"/></clipPath>`);
}

// ---------- Tercer tiempo A (principal): el silbato del final y un chopp
svg('tercer-tiempo', [
  chopp('translate(30 44.5) scale(1.3)'),
  G('translate(-2.5 13) scale(.86)', [P('M15.5 27 H30 Q32 27 32 29 V30 Q32 32 30 32 H22.2 A7 7 0 1 1 15.5 27 Z', K.acero),
  N(C(15.5, 34, 3.2, K.metalClaro)),
  N(R(25, 28.6, 4.5, 1.6, .8, INK)),
  L('M10.5 31 C11.2 29.6 12.2 28.7 13.5 28.2', '#fff', 1.5, { halo: false }),
  C(9.6, 29.5, 1.9, K.acero, { sw: 1.8 })]),
]);


// Escribe los símbolos en index.html, entre <!-- propios:inicio --> y <!-- propios:fin -->
{
  const html = fs.readFileSync(INDEX, 'utf8');
  const ini = '<!-- propios:inicio -->', fin = '<!-- propios:fin -->';
  const NL = '\n';
  const bloque = ini + NL + '<!-- Íconos propios de un color (dibujo propio). Generado con dev/tools/iconos-propios.js: no editar a mano. -->' + NL +
    '<svg xmlns="http://www.w3.org/2000/svg" class="sprite" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden">' + NL +
    SIMBOLOS.join(NL) + NL + '</svg>' + NL + fin;
  const i = html.indexOf(ini), j = html.indexOf(fin);
  if (i < 0 || j < 0) throw new Error('faltan las marcas propios:inicio / propios:fin en index.html');
  fs.writeFileSync(INDEX, html.slice(0, i) + bloque + html.slice(j + fin.length));
  console.log(SIMBOLOS.length + ' íconos propios escritos en index.html');
}
