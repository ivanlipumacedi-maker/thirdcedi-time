# Íconos propios de ThirdCEDI Time

Dibujo propio (set v1, inspirado en referencias de Ivan; "Otra" es la entrada de cine). Desde el 2026-11-08 la app los usa
de **un color**, en el estilo de relleno de los de Phosphor: silueta sólida con los detalles calados, toman `currentColor`.

- Se generan con `node dev/tools/iconos-propios.js`, que escribe los `<symbol id="p-<nombre>">` en `index.html`
  (entre `<!-- propios:inicio -->` y `<!-- propios:fin -->`). No se editan a mano.
- Cada pieza del dibujo va en una máscara: sólida con un corte fino que la separa de lo de abajo; agujeros, brillos y líneas
  finas quedan calados. Ajustes por pieza en el generador: `mono: 'skip' | 'cut' | 'solid'`, `monoSw`, `monoSinCorte`.
- `App.icono(nombre)` (app.js) los devuelve como `<svg class="ico ico-propio"><use href="#p-..."></svg>`.
- Nombres: `futbol`, `padel`, `trekking`, `asado`, `after`, `otra`, `tercer-tiempo`, `chat`, `cuentas`, `album`, `trivia`,
  `impostor`, `nav-actividades`, `nav-juegos`, `nav-perfil`.
