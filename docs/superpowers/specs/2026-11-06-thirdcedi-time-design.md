# ThirdCEDI Time — Diseño

Fecha: 2026-11-06 · Autor del pedido: Ivan Li Puma

## Por qué

Armar algo entre compañeros del Grupo CEDI por WhatsApp es un bardo: los mensajes se pierden, nadie sabe quién va, y después de la actividad (el asado post pádel) las cuentas quedan en el aire. ThirdCEDI Time saca esa organización de WhatsApp: cada actividad tiene su lugar, su gente, su chat y sus cuentas.

Pedido explícito de Ivan: **"no te la compliques mucho"**. Es una app rápida, hecha "como Rumbo al Sur".

## Base: Rumbo al Sur

Se construye tomando como base `C:\Users\IvanLiPuma\granfondo-7-lagos` (Rumbo al Sur): PWA en JavaScript plano (sin framework ni build), `index.html` + módulos `.js` + `sw.js` + `manifest.webmanifest`, con Supabase. Se reusan y adaptan:
- el chat (`chat.js`, `chat-logica.js`, `chat-medios.js`) → chat por actividad y chat de partida de juego;
- las cartas (`preguntas*.js`) → base del motor de la trivia;
- los avisos push y el service worker;
- el patrón de instalación como app desde el navegador.

Ojo, lo que NO se reusa (verificado en la revisión): Rumbo al Sur no usa Supabase Auth (entra como `anon` con un código de viaje en el header `x-viaje`, para 2 personas fijas) y sus cartas son preguntas de conversación por turnos entre 2. Por eso el login, las RLS por usuario, los push para N personas y la trivia multijugador en vivo se hacen nuevos; de Rumbo al Sur se toma el estilo, el chat y la estructura de PWA.

Es un repo **nuevo** (`C:\Users\IvanLiPuma\thirdcedi-time`) y un proyecto Supabase **nuevo**; no se toca Rumbo al Sur.

## Plataforma

PWA instalable que corre en Chrome (Android) y Safari (iPhone, iOS 16.4+ para push, requiere "Agregar a pantalla de inicio"). Sin tiendas.

## Usuarios y login

- Cantidad: sin límite artificial; el techo es el de Supabase (plan gratis: 50.000 usuarios activos/mes, ~200 conexiones en vivo simultáneas; se pasa a Pro sin cambiar la app si hiciera falta).
- Login: **código por mail (OTP de Supabase)**, aceptando solo estos dominios: `cedi.com.ar`, `wemox.com.ar`, `piconsulting.com.ar`, `vulps.com.ar`, `korex.com.ar`. La restricción de dominio se aplica **en el servidor** (hook/trigger de Supabase que rechaza el alta), no solo en la pantalla.
- Envío de los mails del código: SMTP propio con la **cuenta de Resend de Ivan** (y su dominio remitente ya verificado ahí), configurado en Supabase Auth. La clave de Resend la carga Ivan a mano en el Dashboard de Supabase; nunca pasa por el chat ni por la línea de comandos. Probar entrega en al menos un mail de cada una de las 5 empresas (cuarentena de Microsoft 365).
- Proyecto Supabase: **nuevo y separado**, en la organización **"Cedi"** (id `jaziqvcmqyzvdnuvejrd`), la misma que tiene el proyecto `planificacion-semanal` (ref `jidldvdfhkkxinnrubuz`), que **no se toca**. El MCP de Supabase conectado ya ve esa organización, así que Claude puede crearlo por MCP OAuth. Región `us-east-2` como el existente. El ref nuevo se anota en el `CLAUDE.md` del repo nuevo, con las mismas reglas de secretos.
- Decisión de Claude: no se usa login con Microsoft/Entra porque exige que sistemas registre la app en el Azure de la empresa; queda como mejora posible.
- Perfil mínimo: nombre, foto opcional, empresa del grupo (se deduce del dominio).

## Actividades

Tipos: **Fútbol, Pádel, Trekking, Asado, After office, Otra (texto libre)**.

Cualquiera puede crear una actividad con: tipo, título, fecha y hora, lugar, cupo opcional, descripción.

**Tercer tiempo (opcional):** al crear o editar, se marca si la actividad tiene tercer tiempo (ej. pádel → asado). Lleva su propio lugar/hora. Es parte de la misma actividad: mismo chat, misma pantalla.
- Asistencia separada: cada persona marca "Voy a la actividad" y/o "Voy al tercer tiempo". Alguien puede ir solo al tercer tiempo.
- Una actividad de tipo Asado o After office no necesita tercer tiempo (ya es el plan), pero puede tener cuentas claras igual.

**Confirmada:** una actividad está confirmada cuando su creador la confirma (botón "Confirmar"). Decisión de Claude: confirmación manual del creador, sin mínimos automáticos.

## Chat por actividad

Igual al de Rumbo al Sur: un chat por actividad, para todos los que se anotaron (actividad o tercer tiempo). En vivo con Supabase Realtime (nunca polling). Mensajes de texto y fotos como en Rumbo al Sur.

## Cuentas claras

Por actividad (y/o su tercer tiempo):
- Cualquier participante carga un gasto: quién pagó, cuánto, concepto, entre quiénes se divide (por defecto: todos los anotados a esa parte).
- La app calcula el saldo de cada uno y la lista mínima de transferencias ("Juan le debe $3.200 a Ana").
- Cada deuda se puede marcar como pagada.
- Pesos argentinos.
- Decisión de Claude (v1): solo participan usuarios con cuenta; no hay invitados sin cuenta (+1). Mantiene simple el modelo de saldos.

## Álbum y cámara (pedido de Ivan, igual a Rumbo al Sur)

Cada actividad tiene su álbum compartido con la cámara completa de Rumbo al Sur (cola offline, editor, mandar al chat). Las fotos se copian a Drive vía un Apps Script de Ivan, en una subcarpeta por actividad dentro de "ThirdCEDI Time", y el álbum muestra el link "Ver en Drive". Decisión de Claude: subcarpeta por actividad. Cuando el storage de Supabase pasa el 70 %, se liberan originales que ya están en Drive.

## Avisos push

- Nueva actividad creada (a todos).
- Mensaje nuevo en un chat donde estás.
- La actividad en la que estás se confirmó, cambió o se canceló.
- **Recordatorio diario a las 12:00 (hora Argentina)**: mientras una actividad esté confirmada y no haya pasado, todos los anotados reciben un aviso cada día a las 12 hasta el día del evento inclusive. Se dispara desde el servidor (cron de Supabase), no desde el teléfono.

## Juegos

Sección "Juegos" con partidas en vivo, cada una con su chat propio (entre los jugadores de esa partida). Una partida puede ser de 1 persona (solo) o varias; cualquiera crea una partida y los demás se unen.

### Trivia
- Estilo cartas de Rumbo al Sur, **sin preguntas picantes**.
- Decisión de Claude: las preguntas y palabras las genera Claude, con una pasada de verificación de hechos y descarte de las dudosas; quedan en un archivo fácil de editar por si Ivan quiere corregir alguna.
- Banco grande (objetivo: 500+ preguntas) de todo tipo: cultura general, deportes (fútbol, pádel, montaña), Argentina, tecnología, cine/series/música, comida y asado, geografía, historia. Con dificultad.
- Multiple choice, tiempo por pregunta, puntaje, ranking al final de la partida.

### El Impostor
- 3+ jugadores. Todos reciben la misma palabra menos uno (el impostor), que recibe una distinta/parecida.
- Cada uno escribe una pista en el chat de la partida; después votan quién es el impostor; se revela.
- Banco de palabras apto para el trabajo.

## Identidad visual (de cedi.com.ar)

- Marca: azul marino `#002F68` (hover `#001F48`); acento cian `#00B1EF` (hover `#0090C8`); texto `#001E3D`; texto secundario `#4A5C73`; fondo `#FFFFFF` / alterno `#F4F8FA`; bordes `#D1E3ED`; radio 6px.
- Tipografías: **Space Grotesk** (títulos) y **Montserrat** (UI/texto).
- Logo: `https://www.cedi.com.ar/logo-cedi.png` y `logo-cedi-light.png` (para fondo oscuro). Íconos de la app derivados del logo.
- Modo claro y oscuro, como el sitio.
- Nombre: **ThirdCEDI Time**.

## Objetivos / no objetivos / anti-objetivos

- Objetivo: que organizar algo sea más fácil que en WhatsApp y que las cuentas cierren.
- No objetivos (v1): pagos dentro de la app, tiendas de apps, login con Microsoft, panel de administración, moderación avanzada.
- Anti-objetivos: que haya que pelearse con el login o la instalación; contenido picante o incómodo en un entorno laboral; chat que no llega en vivo.

## Restricciones

- Reglas de secretos del `CLAUDE.md` de Rumbo al Sur aplican igual (nada de secretos en línea de comandos; Supabase solo con `supabase login` + MCP remoto OAuth).
- Seguridad: RLS en todas las tablas; solo usuarios logueados del grupo ven algo.
- Todo texto en español rioplatense.

## Queda a criterio del constructor

Esquema de tablas, estructura de archivos, hosting estático (el mismo que use Rumbo al Sur), formato del banco de preguntas, diseño de pantallas dentro de la identidad visual.
