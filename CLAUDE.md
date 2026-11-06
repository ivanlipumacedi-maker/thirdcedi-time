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

## Supabase (datos públicos)
- URL: `https://qvezbnkrfqewanlcejha.supabase.co`
- Clave publicable (pública por diseño, va en `app.js`): `sb_publishable_nHg5W-1bGZwudTST-ejzeA_w_gUNYXQ`
- Migraciones SQL en `dev/supabase/` (01 perfiles, 02 hook de dominio, 03 avatares, 04 endurecer, 05 privado y dominio en perfiles, 06 grants de perfiles, 07 actividades y asistencias). Ya aplicadas en el proyecto.
- Tests: `node --test "dev/tests/*.test.js"` (unitarios) y `node dev/tests/auth-rls.mjs` (contra el proyecto real; no pide códigos). Las pruebas del hook (a)/(a2) piden un OTP a `prueba@example.com` (no entrega mail): solo con `--hook-activo`, y recién con el hook activado; (a) exige 403 "Solo cuentas del Grupo CEDI".
- Usuarios de prueba (RLS y navegador): `zz-prueba-a/b/c@cedi.com.ar`, cuentas ficticias con perfil (empresa CEDI) y contraseña al azar. Se crean con `dev/supabase/usuarios-prueba.sql` (no es migración; se corre a mano en el SQL Editor, es idempotente y devuelve las contraseñas una sola vez). Las líneas `ZZ_PRUEBA_A_PASSWORD=...` (y B, C) van solo en `.env`; los tests las leen de ahí. Nunca en el chat, en comandos ni en commits.
- Tests con esos usuarios: `node dev/tests/actividades-rls.mjs` (RLS y triggers de actividades) y `node dev/tools/prueba-actividades.js` (dos navegadores en vivo; servir la raíz con `npx --yes http-server -p 8080 -c-1`). Las actividades de prueba quedan canceladas con título `zz ...`; se limpian con SQL.
