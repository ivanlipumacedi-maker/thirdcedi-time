# ThirdCEDI Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PWA para que los compañeros del Grupo CEDI organicen actividades (con tercer tiempo, chat y cuentas claras), reciban avisos push y jueguen Trivia e Impostor.

**Architecture:** Sitio estático en JavaScript plano (sin framework ni build de bundler), igual que Rumbo al Sur: `index.html` + módulos `.js` por pantalla + módulos `*-logica.js` puros (sin DOM) testeados con `node:test`. Backend Supabase (Auth OTP por mail, Postgres + RLS, Realtime, Storage, Edge Function `avisos` disparada por pg_cron). Hosting en GitHub Pages.

**Tech Stack:** HTML/CSS/JS ES2020, `@supabase/supabase-js@2` (vendorizado en `vendor/`), Web Push (VAPID) desde Edge Function Deno, `node:test`, `puppeteer-core` para pruebas en navegador.

**Spec:** `docs/superpowers/specs/2026-11-06-thirdcedi-time-design.md`

**Base a reusar (solo lectura):** `C:\Users\IvanLiPuma\granfondo-7-lagos` — `chat.js`, `chat-logica.js`, `chat-medios.js`, `sw.js`, `dev/supabase/avisos/index.ts` + `webpush.js`, `dev/tools/build.js` (patrón), `dev/tests/*-rls.mjs` (patrón). Copiar y adaptar; nunca modificar ese repo.

## Global Constraints

- Todo texto visible en español rioplatense.
- Nombre de la app: **ThirdCEDI Time**.
- Dominios permitidos: `cedi.com.ar`, `wemox.com.ar`, `piconsulting.com.ar`, `vulps.com.ar`, `korex.com.ar` — validado en el servidor.
- Colores: `--brand #002F68`, `--brand-hover #001F48`, `--accent #00B1EF`, `--accent-hover #0090C8`, `--text #001E3D`, `--muted #4A5C73`, `--bg #FFFFFF`, `--bg-alt #F4F8FA`, `--border #D1E3ED`, `--radius 6px`. Modo claro y oscuro.
- Tipografías: Space Grotesk (títulos), Montserrat (UI).
- Tipos de actividad (orden fijo): `futbol` Fútbol, `padel` Pádel, `trekking` Trekking, `asado` Asado, `after` After office, `otra` Otra (texto libre).
- Recordatorio diario: 12:00 hora Argentina (`America/Argentina/Buenos_Aires`, = 15:00 UTC).
- Moneda: pesos argentinos, enteros.
- Datos frescos siempre por Supabase Realtime, nunca polling.
- Secretos: nunca en línea de comandos ni env de usuario; Supabase solo `supabase login` / MCP OAuth; claves de Resend, VAPID privada y secreto de cron los carga Ivan a mano (Dashboard / Vault). Frenar y pedir cuando falte uno.
- Supabase: proyecto nuevo `thirdcedi-time` en org **Cedi** (`jaziqvcmqyzvdnuvejrd`), región `us-east-2`. No tocar `planificacion-semanal` (`jidldvdfhkkxinnrubuz`).
- RLS en todas las tablas; solo usuarios autenticados con perfil.
- PWA: funciona en Chrome Android y Safari iOS 16.4+ (push en iOS solo instalada en pantalla de inicio).

## Review Focus

1. Mail fuera de dominio que intenta entrar llamando a la API de Supabase directo (sin la pantalla) → rechazado por el hook del servidor. Test en Task 2.
2. Cuentas claras con montos que no dividen exacto (ej. $1.000 entre 3) → los saldos suman exactamente 0 y nadie pierde un peso. Test en Task 5.
3. Persona que se baja de la actividad después de tener gastos cargados a su nombre → sigue apareciendo en las cuentas con su deuda. Test en Task 5.
4. Recordatorio de las 12 alrededor de la medianoche y el día del evento (evento hoy a las 21 → recibe; evento ayer → no recibe; actividad cancelada o no confirmada → no recibe). Test en Task 6.
5. Jugador que abandona una partida de Impostor a la mitad (o el impostor se va) → la partida no se traba: se termina o sigue con los que quedan. Test en Task 8.

---

### Task 1: Esqueleto de la app, marca y publicación

**Files:**
- Create: `index.html`, `estilos.css`, `app.js` (router de pantallas por hash `#/actividades`, `#/juegos`, `#/perfil`), `manifest.webmanifest`, `sw.js`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `badge-96.png`, `CLAUDE.md`, `.gitignore`, `dev/tools/package.json`, `dev/tools/prueba-esqueleto.js`

**Interfaces:**
- Produces: `window.App = { ir(ruta: string): void, sb: SupabaseClient, yo(): Perfil|null, toast(texto: string): void }`; CSS variables de Global Constraints en `:root` y `[data-tema="oscuro"]`.

- [ ] **Step 1:** `git init`, `.gitignore` con `.env`, `node_modules`, `dev/shots`. `CLAUDE.md` con la sección de secretos copiada de Rumbo al Sur, adaptada al ref nuevo (se completa en Task 2).
- [ ] **Step 2:** Bajar `logo-cedi.png` y `logo-cedi-light.png` de `https://www.cedi.com.ar/` a `img/`; generar los íconos con un script tipo `dev/tools/iconos.js` de Rumbo al Sur (fondo `#002F68`, logo centrado).
- [ ] **Step 3:** `index.html` con barra inferior de 3 pestañas (Actividades, Juegos, Perfil), header con logo y "ThirdCEDI Time", fuentes de Google Fonts (Space Grotesk 500/700, Montserrat 400/600), selector de tema claro/oscuro que respeta `prefers-color-scheme` por defecto. Safe areas (`env(safe-area-inset-*)`) en header y barra.
- [ ] **Step 4:** `manifest.webmanifest` (`name: "ThirdCEDI Time"`, `short_name: "ThirdCEDI"`, `display: standalone`, `theme_color: #002F68`) y `sw.js` copiado de Rumbo al Sur (cache de shell + handlers `push` y `notificationclick` que abren `data.url`).
- [ ] **Step 5:** `prueba-esqueleto.js` (puppeteer-core contra `http://localhost:8080`): abre en 390×844, navega las 3 pestañas, saca screenshot claro y oscuro a `dev/shots/`. Run: `node dev/tools/prueba-esqueleto.js` → sale 0 y los 2 PNG existen. Mirar los PNG.
- [ ] **Step 6:** Crear repo GitHub `thirdcedi-time` en la cuenta `ivanlipumacedi-maker` (confirmar con Ivan antes de crear), activar Pages desde `main`. Verificar que la URL responde 200.
- [ ] **Step 7:** Commit + push.

### Task 2: Supabase, login con código y restricción de dominios

**Files:**
- Create: `dominios.js`, `login.js`, `dev/supabase/01-perfiles.sql`, `dev/supabase/02-hook-dominio.sql`, `dev/tests/dominios.test.js`, `dev/tests/auth-rls.mjs`
- Modify: `index.html` (pantalla de login), `app.js`, `CLAUDE.md` (ref nuevo)

**Interfaces:**
- Produces: `Dominios.DOMINIOS: string[]`, `Dominios.permitido(email: string): boolean`, `Dominios.empresa(email: string): 'CEDI'|'Wemox'|'Pi Consulting'|'Vulps'|'Korex'|null`. Tabla `perfiles(id uuid pk = auth.users.id, nombre text not null, foto text null, empresa text not null, creado timestamptz)`. Función SQL `public.es_miembro() returns boolean` (hay perfil para `auth.uid()`), usada por las RLS de todas las tareas.

- [ ] **Step 1: Test que falla** en `dev/tests/dominios.test.js`:
```js
assert.equal(D.permitido('juan@cedi.com.ar'), true);
assert.equal(D.permitido('Ana@KOREX.com.ar'), true);
assert.equal(D.permitido('x@piconsulting.com.ar'), true);
assert.equal(D.permitido('x@cedi.com.ar.evil.com'), false);
assert.equal(D.permitido('x@subcedi.com.ar'), false);
assert.equal(D.permitido('x@gmail.com'), false);
assert.equal(D.permitido(''), false);
assert.equal(D.empresa('a@wemox.com.ar'), 'Wemox');
```
- [ ] **Step 2:** `node --test dev/tests/` → FAIL. Implementar `dominios.js` (comparación exacta del dominio después de la última `@`, en minúsculas). → PASS.
- [ ] **Step 3:** Crear el proyecto Supabase por MCP (`create_project`, org Cedi, `us-east-2`, nombre `thirdcedi-time`) — confirmar costo con Ivan antes (debería ser $0 en plan gratis). Anotar ref y publishable key en `CLAUDE.md` y en `app.js`.
- [ ] **Step 4:** `02-hook-dominio.sql`: función `public.hook_dominio(event jsonb) returns jsonb` para el Auth Hook "Before User Created" que devuelve error `{"error":{"http_code":403,"message":"Solo cuentas del Grupo CEDI"}}` si el dominio no está en la lista (misma lista que `dominios.js`). Pasarle a Ivan las sentencias en el chat y el paso del Dashboard para activar el hook.
- [ ] **Step 5:** `01-perfiles.sql`: tabla `perfiles`, `es_miembro()`, RLS: select si `es_miembro()`; insert/update solo la propia fila. Aplicar por MCP `apply_migration`.
- [ ] **Step 6:** Ivan configura SMTP de Resend en Auth (host `smtp.resend.com`, puerto 465, user `resend`, su API key, remitente de su dominio) y la plantilla del mail con el código de 6 dígitos (`{{ .Token }}`) en español. Guiarlo paso a paso; no pedir la clave.
- [ ] **Step 7:** `login.js`: pantalla mail → `signInWithOtp({ email, options: { shouldCreateUser: true } })` → pantalla código → `verifyOtp({ email, token, type: 'email' })` → si no hay perfil, pide nombre y crea fila con `empresa = Dominios.empresa(email)`. Valida `Dominios.permitido` antes de enviar ("Usá tu mail del Grupo CEDI").
- [ ] **Step 8:** `auth-rls.mjs`: (a) `signInWithOtp` con `prueba@gmail.com` → error 403 del hook; (b) anon sin sesión lee `perfiles` → `[]`. Run: `node dev/tests/auth-rls.mjs` → todo `ok`.
- [ ] **Step 9:** Prueba real: Ivan entra con su mail de CEDI y uno de otra empresa del grupo; confirmar que el código llega a la bandeja (no cuarentena). Commit.

### Task 3: Actividades y tercer tiempo

**Files:**
- Create: `actividades-logica.js`, `actividades.js`, `dev/supabase/03-actividades.sql`, `dev/tests/actividades-logica.test.js`, `dev/tests/actividades-rls.mjs`

**Interfaces:**
- Consumes: `es_miembro()`, `perfiles`, `App`.
- Produces: tablas `actividades(id uuid, creador uuid→perfiles, tipo text check in (futbol,padel,trekking,asado,after,otra), tipo_otro text null, titulo text, fecha timestamptz, lugar text, cupo int null, descripcion text, tiene_tercer bool, tercer_lugar text null, tercer_fecha timestamptz null, estado text check in (abierta,confirmada,cancelada) default abierta, creado timestamptz)` y `asistencias(actividad uuid, persona uuid, parte text check in (actividad,tercer), pk(actividad,persona,parte))`. `ActividadesLogica.TIPOS: {id,nombre,emoji}[]`, `validar(a): string|null` (mensaje de error o null), `cupoLleno(a, asistencias): boolean`, `participantes(actId, asistencias, parte?): uuid[]`, `esFutura(a, ahora: number): boolean` (usa `tercer_fecha` si es posterior a `fecha`).

- [ ] **Step 1: Tests que fallan:** `validar` rechaza título vacío, `tipo:'otra'` sin `tipo_otro`, `tiene_tercer` sin `tercer_lugar`, `tercer_fecha` anterior a `fecha`; `cupoLleno` con cupo 4 y 4 en parte `actividad` → true, el cupo no cuenta los de `tercer`; `participantes(..., undefined)` devuelve la unión sin repetidos.
- [ ] **Step 2:** Implementar → PASS.
- [ ] **Step 3:** SQL + RLS: leer si `es_miembro()`; crear con `creador = auth.uid()`; editar/confirmar/cancelar solo el creador; `asistencias` insert/delete solo la propia, y no se puede anotar a la parte `actividad` si está cancelada o con cupo lleno (chequeo en trigger). Publicar ambas tablas en `supabase_realtime`.
- [ ] **Step 4:** `actividades.js`: lista (próximas primero, chips por tipo con emoji, badge "Confirmada"/"Con tercer tiempo"), formulario crear/editar, detalle con botones "Voy" / "Voy al tercer tiempo" separados, lista de anotados en cada parte, botones del creador "Confirmar" y "Cancelar". Suscripción realtime a ambas tablas.
- [ ] **Step 5:** `actividades-rls.mjs` con 2 usuarios de prueba (crear con service flow por MCP SQL, no cuentas reales): B no puede editar la de A; B no puede anotar a A; anotarse a cancelada falla. → todo `ok`.
- [ ] **Step 6:** Prueba en navegador: crear pádel con tercer tiempo asado, anotarse solo al asado con otro usuario, ver la lista actualizarse en vivo en la otra ventana. Commit.

### Task 4: Chat por actividad (y por partida)

**Files:**
- Create: `chat.js`, `chat-logica.js`, `chat-medios.js` (copiados de Rumbo al Sur y adaptados), `dev/supabase/04-chat.sql`, `dev/tests/chat-logica.test.js` (copiado), `dev/tests/chat-rls.mjs`

**Interfaces:**
- Consumes: `asistencias`, `participantes()`.
- Produces: tabla `mensajes(id, sala text, autor uuid→perfiles, tipo, texto, ...columnas que ya usa Rumbo al Sur)` donde `sala` es `'act:<uuid>'` o `'par:<uuid>'`. Función SQL `public.en_sala(sala text) returns boolean` (anotado a cualquier parte de la actividad, o jugador de la partida — la tabla `jugadores` llega en Task 7; dejar la rama `par:` devolviendo false hasta entonces). `Chat.abrir(contenedor: HTMLElement, sala: string): () => void` (devuelve función para cerrar y desuscribir).

- [ ] **Step 1:** Copiar los 3 módulos y su test; reemplazar el modelo de 2 personas (`autor` 'A'/'B', header `x-viaje`) por `autor = auth.uid()` y nombre/foto desde `perfiles`. Colores de burbuja: propias `--brand` con texto blanco, ajenas `--bg-alt`; nombre del autor arriba de la burbuja ajena (es grupal).
- [ ] **Step 2:** `node --test dev/tests/` → PASS (ajustar los tests copiados a los nombres nuevos sin bajar su cobertura).
- [ ] **Step 3:** SQL + RLS con `en_sala(sala)` para select/insert; editar/borrar solo el autor. Storage bucket `chat` privado con la misma regla por carpeta `<sala>/`. Realtime.
- [ ] **Step 4:** Montar el chat en el detalle de actividad, visible solo si estás anotado.
- [ ] **Step 5:** `chat-rls.mjs`: no anotado no lee ni escribe en la sala; anotado solo al tercer tiempo sí. Prueba en 2 ventanas: mensaje llega en vivo. Commit.

### Task 5: Cuentas claras

**Files:**
- Create: `cuentas-logica.js`, `cuentas.js`, `dev/supabase/05-cuentas.sql`, `dev/tests/cuentas-logica.test.js`, `dev/tests/cuentas-rls.mjs`

**Interfaces:**
- Consumes: `asistencias`, `participantes()`, `en_sala()`.
- Produces: tablas `gastos(id, actividad uuid, parte text check in (actividad,tercer), pagador uuid, monto int check >0, concepto text, creado)`, `gasto_partes(gasto uuid, persona uuid, pk(gasto,persona))`, `pagos(id, actividad uuid, de uuid, a uuid, monto int, creado)`. `CuentasLogica.saldos(gastos, partes, pagos): Map<uuid, int>` (positivo = le deben), `CuentasLogica.transferencias(saldos): {de, a, monto}[]`.

- [ ] **Step 1: Tests que fallan:**
```js
// A paga 1000 entre A,B,C → reparto 334/333/333, el peso sobrante al primero por id ordenado
assert.deepEqual(Object.fromEntries(C.saldos(g1, p1, [])), { A: 666, B: -333, C: -333 });
// suma de saldos siempre 0
// transferencias mínimas: deudores mayores primero contra acreedores mayores
assert.deepEqual(C.transferencias(new Map([['A',666],['B',-333],['C',-333]])), [{de:'B',a:'A',monto:333},{de:'C',a:'A',monto:333}]);
// pago registrado B→A 333 deja B en 0
// Review Focus 3: persona en gasto_partes que ya no está en asistencias sigue con su saldo
```
- [ ] **Step 2:** Implementar → PASS. Algoritmo de transferencias: greedy ordenando acreedores y deudores por monto descendente.
- [ ] **Step 3:** SQL + RLS: leer/escribir si `en_sala('act:'||actividad)`; borrar gasto solo quien lo cargó; pago lo registra el deudor o el acreedor. Realtime.
- [ ] **Step 4:** `cuentas.js`: pestaña "Cuentas claras" en el detalle, con selector Actividad / Tercer tiempo si `tiene_tercer`; cargar gasto (por defecto divide entre los anotados a esa parte, checkboxes para cambiar); resumen "Te deben / Debés"; lista de transferencias con botón "Ya pagué" / "Me pagó".
- [ ] **Step 5:** RLS test + prueba en navegador con 3 usuarios. Commit.

### Task 6: Avisos push y recordatorio de las 12

**Files:**
- Create: `avisos.js`, `avisos-logica.js`, `dev/supabase/06-avisos.sql`, `dev/supabase/avisos/index.ts`, `dev/supabase/avisos/webpush.js` (copiado), `dev/tests/avisos-logica.test.js`, `dev/tools/prueba-avisos.js`

**Interfaces:**
- Consumes: `actividades`, `asistencias`, `mensajes`, `participantes()`, `esFutura()`.
- Produces: tabla `push_subs(endpoint pk, persona uuid, p256dh, auth, creado)` con RLS solo propia. `AvisosLogica.diaART(ms: number): string` ('YYYY-MM-DD' en Argentina), `AvisosLogica.recordatoriosDiarios(actividades, asistencias, ahora: number): {persona, actividad}[]`. Edge Function `avisos` con `{tipo:'cambios'}` (cada minuto) y `{tipo:'diario'}` (pg_cron `0 15 * * *`), autenticada con `x-cron-secret` desde Vault como Rumbo al Sur.

- [ ] **Step 1: Tests que fallan** (Review Focus 4): confirmada con evento hoy 21:00 ART y `ahora` = hoy 12:00 ART → incluye a todos los anotados (ambas partes, sin repetir persona); evento ayer → nada; `estado:'abierta'` o `'cancelada'` → nada; `diaART` de `2026-11-07T02:30:00Z` → `'2026-11-06'`.
- [ ] **Step 2:** Implementar → PASS (copiar `avisos-logica.js` a la Edge Function como módulo).
- [ ] **Step 3:** `06-avisos.sql`: `push_subs`, tabla cola `eventos_aviso(id, tipo, actividad, sala, autor, creado)` llenada por triggers en: insert de `actividades` (a todos los miembros), update de `estado`/`fecha`/`lugar` (a los anotados), insert de `mensajes` (a los de la sala menos el autor, agrupados como Rumbo al Sur con `SILENCIO_MS`). pg_cron de los dos tipos. El secreto de cron y la VAPID privada los carga Ivan en Vault/secrets de la función; generar el par VAPID con un script que escribe la privada en `.env` local, nunca por consola.
- [ ] **Step 4:** `index.ts`: adaptar de Rumbo al Sur; textos: "Nueva actividad: {emoji} {titulo}", "{nombre}: {mensaje}" con título de la actividad, "Se confirmó {titulo}", "Cambió {titulo}", "Se canceló {titulo}", diario "Hoy/Mañana/El {día}: {titulo} a las {hora}". `url` del aviso = `#/actividad/<id>`. Borrar subs con 404/410.
- [ ] **Step 5:** `avisos.js`: botón "Activar avisos" en Perfil; en iOS no instalada, mostrar cómo agregar a inicio. Upsert en `push_subs` con `persona = auth.uid()`.
- [ ] **Step 6:** Prueba real en Android (Chrome) e iPhone (Safari instalada): aviso de prueba, mensaje de chat, y `{tipo:'diario'}` invocado a mano. Commit.

### Task 7: Juegos — partidas en vivo y Trivia

**Files:**
- Create: `juegos.js`, `trivia.js`, `trivia-logica.js`, `dev/supabase/07-juegos.sql`, `dev/tests/trivia-logica.test.js`, `dev/tests/juegos-rls.mjs`
- Modify: `dev/supabase/04-chat.sql` (rama `par:` de `en_sala`)

**Interfaces:**
- Consumes: `Chat.abrir`, `Preguntas` (Task 9; usar 20 preguntas de muestra hasta entonces).
- Produces: tablas `partidas(id, juego text check in (trivia,impostor), creador, estado text check in (espera,jugando,terminada), estado_juego jsonb, creado)`, `jugadores(partida, persona, puntos int default 0, se_fue bool default false, pk(partida,persona))`, `respuestas(partida, ronda int, persona, opcion int, ms int, pk(partida,ronda,persona))`. RPC `avanzar_partida(p uuid)` SECURITY DEFINER que solo el creador puede llamar. `TriviaLogica.elegir(banco, n: number, semilla: number): Pregunta[]` (sin repetir, mezcla dificultades), `TriviaLogica.puntos(correcta: boolean, ms: number, limiteMs: number): number` (0 si incorrecta; 500–1000 lineal por rapidez), `TriviaLogica.ranking(jugadores): {persona, puntos, puesto}[]` (empates comparten puesto).
- `Pregunta = { id: string, cat: string, dif: 1|2|3, p: string, ops: [string,string,string,string], ok: 0|1|2|3 }`.

- [ ] **Step 1: Tests que fallan:** `elegir` con misma semilla → mismo orden, sin ids repetidos; `puntos(true, 0, 15000)` = 1000, `puntos(true, 15000, 15000)` = 500, `puntos(false, …)` = 0; ranking con empate 1000/1000/500 → puestos 1,1,3.
- [ ] **Step 2:** Implementar → PASS.
- [ ] **Step 3:** SQL + RLS: ver partidas en espera si `es_miembro()`; ver/jugar solo si sos jugador; respuestas solo propias y solo para la ronda actual (validar en RPC `responder`). Realtime en las 3 tablas. Completar `en_sala('par:…')`.
- [ ] **Step 4:** `juegos.js`: lista de partidas abiertas + "Nueva partida" (Trivia / Impostor); sala de espera con jugadores en vivo; se puede arrancar con 1 jugador (Trivia) o 3+ (Impostor). Chat de la partida con `Chat.abrir(el, 'par:'+id)`.
- [ ] **Step 5:** `trivia.js`: 10 preguntas, 15 s cada una, el creador avanza (o avanza solo al responder todos / vencer el tiempo), muestra correcta y ranking parcial; ranking final.
- [ ] **Step 6:** RLS test + prueba con 2 ventanas. Commit.

### Task 8: El Impostor

**Files:**
- Create: `impostor.js`, `impostor-logica.js`, `dev/tests/impostor-logica.test.js`

**Interfaces:**
- Consumes: `partidas`, `jugadores`, `avanzar_partida`, `Chat.abrir`, `Palabras` (Task 9).
- Produces: `ImpostorLogica.repartir(jugadores: uuid[], par: {palabra, impostor}, semilla): {impostor: uuid, palabras: Map<uuid,string>}`, `ImpostorLogica.resultado(votos: Map<uuid,uuid>, impostor): {expulsado: uuid|null, ganoGrupo: boolean}` (empate → nadie expulsado, gana el impostor), `ImpostorLogica.sigue(jugadoresActivos: uuid[], impostor): 'sigue'|'gana_grupo'|'gana_impostor'`.
- La palabra de cada jugador la entrega la RPC `mi_palabra(partida)` SECURITY DEFINER — nunca viaja la del resto al cliente.

- [ ] **Step 1: Tests que fallan:** `repartir` con 4 jugadores → exactamente 1 con la palabra del impostor; `resultado` mayoría al impostor → `ganoGrupo:true`; empate → `expulsado:null, ganoGrupo:false`; Review Focus 5: `sigue` si se va el impostor → `'gana_grupo'`; si quedan 2 activos con el impostor → `'gana_impostor'`.
- [ ] **Step 2:** Implementar → PASS.
- [ ] **Step 3:** `impostor.js`: fases Palabra (cada uno ve la suya con `mi_palabra`) → Pistas (una por jugador, en el chat de la partida) → Votación (botones con los jugadores) → Revelación. Si un jugador marca "Salir", `se_fue = true` y se evalúa `sigue`.
- [ ] **Step 4:** Prueba con 3 ventanas: ningún cliente puede leer la palabra ajena (inspeccionar respuestas de red). Commit.

### Task 9: Banco de preguntas y palabras

**Files:**
- Create: `contenido/preguntas.js` (expone `Preguntas: Pregunta[]`), `contenido/palabras.js` (expone `Palabras: {palabra, impostor}[]`), `dev/tests/contenido.test.js`

**Interfaces:**
- Produces: `Preguntas` con el tipo `Pregunta` de Task 7; `Palabras` ≥ 150 pares.

- [ ] **Step 1: Test que falla:** ≥ 500 preguntas; ids únicos; 4 opciones distintas no vacías; `ok` en 0..3; cada categoría (`general`, `deportes`, `argentina`, `tecnologia`, `cine-musica`, `comida`, `geografia`, `historia`) con ≥ 40; las tres dificultades presentes en cada categoría; ningún texto con palabras de una lista de exclusión (picante/insultos). Palabras: ≥ 150 pares, sin pares iguales.
- [ ] **Step 2:** Generar el contenido por lotes de 50 por categoría. Para cada lote, una segunda pasada de verificación de hechos que descarta lo dudoso o lo que depende de la fecha (resultados "actuales", récords que cambian). Nada sexual, político partidario, religioso ni de burla a personas.
- [ ] **Step 3:** `node --test dev/tests/` → PASS. Reemplazar las preguntas de muestra de Task 7. Commit.

### Task 10: Cierre — revisión, seguridad y prueba en teléfonos

**Files:**
- Modify: lo que surja.

- [ ] **Step 1:** Correr `get_advisors` (security y performance) del proyecto Supabase; corregir todo lo real.
- [ ] **Step 2:** Revisión de seguridad (seguridad-specialist) sobre RLS, hook de dominio, RPCs SECURITY DEFINER y Edge Function; corregir todo hallazgo real en este mismo lote.
- [ ] **Step 3:** Revisor final de todo el branch contra el spec; corregir.
- [ ] **Step 4:** Prueba E2E en 2 teléfonos (Android Chrome + iPhone Safari instalada), bidireccional: login, crear actividad con tercer tiempo, anotarse, chat en vivo, gasto y transferencias, aviso push, partida de Trivia y de Impostor. Screenshots como evidencia.
- [ ] **Step 5:** Push final y link de la app para Ivan.
