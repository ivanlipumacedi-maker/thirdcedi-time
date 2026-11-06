# ThirdCEDI Time

PWA en JavaScript vainilla (sin framework ni bundler) para que los compañeros del Grupo CEDI organicen actividades. Todo texto visible en español rioplatense.

## Secretos (obligatorio)
- Nunca escribir tokens, API keys, contraseñas ni service_role keys en una línea de comandos (setx, $env:, export, set, argumentos de CLI). La máquina tiene Defender XDR y registra las líneas de comandos.
- Nunca persistir secretos con setx ni en variables de entorno de usuario o sistema.
- Supabase CLI: autenticación solo con `supabase login` (interactivo). MCP de Supabase: solo el servidor remoto con OAuth, con project_ref y scope de proyecto.
- Los secretos de la app van solo en .env, que tiene que estar en .gitignore.
- Si hace falta un secreto que no está disponible, frenar y pedírmelo para que lo cargue yo a mano. Nunca pedir que lo pegue en el chat.
- Este proyecto Supabase está en una cuenta nueva de Ivan (no la de ivan.lipuma.cedi), proyecto `thirdcedi-time`. Ref: `qvezbnkrfqewanlcejha`. No tocar `planificacion-semanal` (`jidldvdfhkkxinnrubuz`) ni los de "El sur".
- Las claves de Resend, la VAPID privada y el secreto de cron los carga Ivan a mano (Dashboard / Vault).

## Supabase: servidor MCP y SQL destructivo (obligatorio)
- Para este proyecto usar SOLO el servidor MCP `supabase-thirdcedi` (scope local, project_ref `qvezbnkrfqewanlcejha`, con `skip_elicitations`). No usar el servidor `supabase` de `.mcp.json` (pide confirmar cada DROP en pantalla y la confirmación vence) ni el conector `claude.ai Supabase`. Antes de escribir, verificar con `get_project_url` que apunta a `qvezbnkrfqewanlcejha`. Si figura "Needs authentication", avisarle a Ivan.
- Ese servidor corre `execute_sql` y `apply_migration` sin pedir confirmación. Por eso: antes de cualquier SQL que borre o pise datos de usuarios reales (DELETE, UPDATE, TRUNCATE, DROP, migraciones que recreen tablas con datos, etc.), mostrarle la sentencia a Ivan y esperar su OK, aunque la herramienta no lo pida. Vale también para subagentes. Las filas de prueba (`zz-prueba-*`, actividades `zz ...`) no cuentan como datos reales.

## Supabase (datos públicos)
- URL: `https://qvezbnkrfqewanlcejha.supabase.co`
- Clave publicable (pública por diseño, va en `app.js`): `sb_publishable_nHg5W-1bGZwudTST-ejzeA_w_gUNYXQ`
- Migraciones SQL en `dev/supabase/` (01 perfiles, 02 hook de dominio, 03 avatares, 04 endurecer, 05 privado y dominio en perfiles, 06 grants de perfiles, 07 actividades y asistencias, 08 chat por sala con en_sala y bucket `chat`, 09 ajustes del chat: recortar_como_trim, editar con trim y es_miembro en las RPC, check de texto). 10 ajustes de actividades: saca los grants de insert de creador/persona, cancelada no editable salvo reactivarla, apagar el tercer tiempo quita a sus anotados). Todas aplicadas en el proyecto.
- Tests: `node --test "dev/tests/*.test.js"` (unitarios) y `node dev/tests/auth-rls.mjs` (contra el proyecto real; no pide códigos). Las pruebas del hook (a)/(a2) piden un OTP a `prueba@example.com` (no entrega mail): solo con `--hook-activo`, y recién con el hook activado; (a) exige 403 "Solo cuentas del Grupo CEDI".
- Usuarios de prueba (RLS y navegador): `zz-prueba-a/b/c@cedi.com.ar`, cuentas ficticias con perfil (empresa CEDI) y contraseña al azar. Se crean con `dev/supabase/usuarios-prueba.sql` (no es migración; es idempotente, rota las contraseñas y las devuelve una sola vez). Lo puede correr Claude con `supabase-thirdcedi` y escribir directo las líneas `ZZ_PRUEBA_A_PASSWORD=...` (y B, C) en `.env` (Ivan lo autorizó), que van solo ahí; los tests las leen de ahí. Nunca en el chat, en comandos ni en commits.
- Tests con esos usuarios: `node dev/tests/actividades-rls.mjs` (RLS y triggers de actividades; los pasos "(10)" fallan hasta aplicar la 10) y `node dev/tools/prueba-actividades.js` (dos navegadores en vivo; servir la raíz con `npx --yes http-server -p 8080 -c-1`). Las actividades de prueba quedan canceladas con título `zz ...`; se limpian con SQL.
- Actividades sin red: `node dev/tools/prueba-actividades-mock.js` (UI con un Supabase falso en memoria y dos ventanas; no necesita contraseñas).
- Chat: `node dev/tests/chat-rls.mjs` (RLS de mensajes y bucket `chat`, con los usuarios zz-prueba) y `node dev/tools/prueba-chat-mock.js` (UI con un Supabase falso en memoria y dos ventanas; no necesita contraseñas).
