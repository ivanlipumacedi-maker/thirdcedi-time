// Genera el sprite de íconos de la app y lo escribe dentro de index.html, entre <!-- iconos:inicio --> e <!-- iconos:fin -->.
// Los íconos son de Phosphor Icons (https://phosphoricons.com), licencia MIT, Copyright (c) 2023 Phosphor Icons.
// Se usa un solo peso para toda la app: regular. La app no carga nada de node_modules ni de un CDN: el sprite queda
// versionado en index.html y se usa con <svg class="ico"><use href="#i-<nombre>"></use></svg> (App.icono en app.js).
// Uso: `npm ci` en dev/tools y después `node dev/tools/iconos-sprite.js`. Para sumar un ícono, agregalo a ICONOS.
const fs = require('fs');
const path = require('path');

const PESO = 'regular';
// nombre en la app -> nombre en Phosphor
const ICONOS = {
  // tipos de actividad
  futbol: 'soccer-ball', padel: 'racquet', trekking: 'mountains', asado: 'fire', after: 'beer-stein', otra: 'ticket', todas: 'squares-four',
  // secciones y bloques
  actividades: 'calendar-blank', juegos: 'dice-five', perfil: 'user-circle',
  tercer: 'cheers', chat: 'chat-circle', cuentas: 'receipt', album: 'images', camara: 'camera', galeria: 'image', drive: 'folder-simple',
  trivia: 'brain', impostor: 'detective', trofeo: 'trophy',
  // interfaz
  luna: 'moon', sol: 'sun', volver: 'caret-left', cerrar: 'x', mas: 'plus', opciones: 'dots-three', enviar: 'paper-plane-right',
  campana: 'bell', 'campana-off': 'bell-slash', check: 'check', lugar: 'map-pin', reloj: 'clock', personas: 'users',
  // cámara y editor
  linterna: 'flashlight', exposicion: 'sun-dim', grilla: 'grid-nine', temporizador: 'timer', 'cambiar-camara': 'camera-rotate',
  varita: 'magic-wand', ajustes: 'sliders-horizontal',
};

const raiz = path.join(__dirname, '..', '..');
const dir = path.join(__dirname, 'node_modules', '@phosphor-icons', 'core', 'assets', PESO);
const simbolos = Object.entries(ICONOS).map(([id, ph]) => {
  const svg = fs.readFileSync(path.join(dir, ph + '.svg'), 'utf8');
  const vb = /viewBox="([^"]+)"/.exec(svg)[1];
  const cuerpo = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
  return `<symbol id="i-${id}" viewBox="${vb}">${cuerpo}</symbol>`;
});
const sprite = '<!-- iconos:inicio -->\n'
  + `<!-- Íconos: Phosphor Icons ${PESO} (https://phosphoricons.com), licencia MIT, Copyright (c) 2023 Phosphor Icons. Generado con dev/tools/iconos-sprite.js: no editar a mano. -->\n`
  + '<svg xmlns="http://www.w3.org/2000/svg" class="sprite" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden">\n'
  + simbolos.join('\n') + '\n</svg>\n<!-- iconos:fin -->';

const archivo = path.join(raiz, 'index.html');
const html = fs.readFileSync(archivo, 'utf8');
const re = /<!-- iconos:inicio -->[\s\S]*?<!-- iconos:fin -->/;
if (!re.test(html)) throw new Error('index.html no tiene las marcas <!-- iconos:inicio --> / <!-- iconos:fin -->');
fs.writeFileSync(archivo, html.replace(re, sprite));
console.log(simbolos.length + ' íconos (' + PESO + ') en index.html');
