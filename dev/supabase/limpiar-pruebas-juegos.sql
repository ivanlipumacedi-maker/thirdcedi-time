-- Limpieza de lo que dejan las pruebas en vivo de Juegos (dev/tests/juegos-rls.mjs y dev/tools/prueba-juegos.js).
-- NO es una migración. Borra SOLO las partidas creadas por las cuentas de prueba zz-prueba-*@cedi.com.ar, sus
-- mensajes 'par:' y, en cascada, sus jugadores, respuestas y preguntas elegidas, y el historial de preguntas vistas
-- (trivia_vistas, 18) de esas cuentas. No toca nada de personas reales.
-- La RLS no deja borrar partidas desde la API (todo se escribe por RPC), por eso se corre con el MCP
-- supabase-thirdcedi (o en el SQL Editor) al final de cada corrida.
with zzu as (
  select u.id from auth.users u where u.email like 'zz-prueba-%@cedi.com.ar'
), zz as (
  select x.id from public.partidas x where x.creador in (select zzu.id from zzu)
), v as (
  delete from public.trivia_vistas where persona in (select zzu.id from zzu) returning 1
), m as (
  delete from public.mensajes where sala in (select 'par:' || zz.id from zz) returning 1
), p as (
  delete from public.partidas where id in (select zz.id from zz) returning 1
)
select (select count(*) from m) as mensajes_borrados, (select count(*) from p) as partidas_borradas,
       (select count(*) from v) as vistas_borradas;
