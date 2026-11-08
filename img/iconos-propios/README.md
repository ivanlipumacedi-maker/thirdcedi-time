# Íconos propios de ThirdCEDI Time

Propios, inspirados en referencias de Ivan. Set elegido: v1 ("figuritas" con escena). Se generan con
`node dev/tools/iconos-propios.js`; no se editan a mano.

## Estilo
- Lienzo de 48 x 48, relleno plano de color, sin degradés.
- Contorno azul noche `#13294B` de 2,5 (brazos, piernas y varillas: trazo de 7,5 de tinta con el color de 2,5 encima).
- Borde blanco troquelado alrededor de toda la figura (capa `halo`, trazo blanco 4 más ancho), así se leen sobre fondo claro y oscuro.
- Un brillo blanco corto arriba a la izquierda en las piezas grandes.
- Ids internos con prefijo `tct-` (clipPath), por si algún día se ponen inline.

## Paleta
Tinta `#13294B` · celeste `#00B1EF` · azul `#1F5FBF` · césped `#3DBE5A` · lima `#DDF247` · sol `#FFC83D` (oscuro `#E39B10`) ·
brasa `#FF6B2C` · rosa `#FF5D8F` · lavanda `#8C7CF0` · ámbar `#F7A928` (claro `#FFD27A`) · espuma `#FFF8EA` ·
acero `#DCE5F0` · madera `#B8743A` · billete `#4CC27A` · piel `#F2C29B`.

## Archivos
- Tipos de actividad: `futbol` (jugador con la albiceleste), `padel` (paletas rosa y celeste), `trekking` (caminante con mochila),
  `asado` (tenedor y cuchillo con llama), `after` (dos chopps), `otra` (entrada de cine con talón y línea perforada).
- `tercer-tiempo`: silbato y chopp.
- Secciones y juegos: `chat`, `cuentas`, `album`, `trivia`, `impostor`.
- Barra de abajo: `nav-actividades`, `nav-juegos`, `nav-perfil`.

## Uso en la app
`App.icono(nombre)` (app.js) devuelve un `<img class="ico ico-propio">` con estos SVG para los nombres de arriba; el resto de la
interfaz sigue con el sprite de Phosphor (fill). Son multicolor: no toman `currentColor`. Están en el SHELL de `sw.js`.
