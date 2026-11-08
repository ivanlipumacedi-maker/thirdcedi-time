-- Borra las actividades de prueba (título que empieza con "zz", creadas por los usuarios zz-prueba-*@cedi.com.ar)
-- y todo lo que cuelga de ellas: asistencias, gastos, reparto y pagos (en cascada) y los mensajes de su chat.
-- No es migración: se corre a mano (SQL Editor o MCP supabase-thirdcedi) después de las pruebas en vivo, porque las
-- RLS no dejan borrar actividades desde la app. Solo toca filas de prueba. Devuelve cuántas actividades borró.
with zz as (
  select a.id from public.actividades a
  where a.titulo ilike 'zz%'
    and a.creador in (select u.id from auth.users u where u.email like 'zz-prueba-%@cedi.com.ar')
), msj as (
  delete from public.mensajes m where m.sala in (select 'act:' || zz.id::text from zz)
), act as (
  delete from public.actividades a where a.id in (select zz.id from zz) returning a.id
), ev as (
  -- avisos en cola que dejaron las pruebas (15): los de las actividades zz y los que generaron los usuarios zz
  delete from public.eventos_aviso e
  where e.actividad in (select zz.id from zz) or e.sala in (select 'act:' || zz.id::text from zz)
     or e.autor in (select u.id from auth.users u where u.email like 'zz-prueba-%@cedi.com.ar')
), subs as (
  -- suscripciones de prueba: las viejas de zz-prueba.invalid y las de los usuarios zz (endpoints con zz-prueba, 19)
  delete from public.push_subs s
  where s.endpoint like 'https://zz-prueba.invalid/%'
     or s.persona in (select u.id from auth.users u where u.email like 'zz-prueba-%@cedi.com.ar')
), todos as (
  -- fotos de prueba en el álbum de todos (22): las de los usuarios zz (los archivos del bucket los borran los tests)
  delete from public.fotos f
  where f.actividad = '00000000-0000-4000-8000-000000000000'
    and f.autor in (select u.id from auth.users u where u.email like 'zz-prueba-%@cedi.com.ar')
), pruebas as (
  delete from public.avisos_pruebas p where p.persona in (select u.id from auth.users u where u.email like 'zz-prueba-%@cedi.com.ar')
)
select count(*) as actividades_borradas from act;
