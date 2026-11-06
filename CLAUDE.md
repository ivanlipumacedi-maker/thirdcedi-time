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
- Migraciones SQL en `dev/supabase/` (01 perfiles, 02 hook de dominio, 03 avatares, 04 endurecer). Ya aplicadas en el proyecto.
- Tests: `node --test "dev/tests/*.test.js"` (unitarios) y `node dev/tests/auth-rls.mjs` (contra el proyecto real; no pide códigos). Las pruebas del hook piden un OTP real: solo con `--hook-activo --mail-externo=<mail de Ivan fuera del grupo>`, y recién con el hook activado.
