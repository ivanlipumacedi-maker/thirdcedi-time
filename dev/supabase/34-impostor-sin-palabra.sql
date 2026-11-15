-- 34 El Impostor sin palabra (pedido de Ivan, 2026-11-15, después de jugarlo): con una palabra parecida era muy difícil.
-- Ahora el grupo tiene la palabra y el impostor no tiene ninguna: la app le dice "Sos el impostor".
-- * mi_rol(p): { impostor: true, palabra: null } o { impostor: false, palabra: '...' }. Mismos permisos que mi_palabra:
--   solo la propia, mientras la partida está en juego y vos seguís adentro.
-- * mi_palabra(p) queda para las apps que todavía tienen la versión anterior en caché: al impostor le devuelve
--   "Sos el impostor" (antes, la palabra parecida).
-- impostor_arrancar no cambia (sigue guardando el par; la palabra parecida ya no se muestra en ningún lado).

create or replace function public.mi_rol(p uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  r public.partidas;
  s public.impostor_secretos;
  uid uuid := (select auth.uid());
begin
  if not public.es_miembro() then
    raise exception 'No sos miembro' using errcode = '42501';
  end if;
  select x.* into r from public.partidas x where x.id = p;
  if r.id is null or not exists (select 1 from public.jugadores j where j.partida = p and j.persona = uid and not j.se_fue) then
    raise exception 'No estás en esta partida' using errcode = '42501';
  end if;
  if r.juego <> 'impostor' or r.estado <> 'jugando' then
    raise exception 'No hay palabra para esta partida' using errcode = 'P0001';
  end if;
  select x.* into s from public.impostor_secretos x where x.partida = p;
  if s.partida is null then
    raise exception 'No hay palabra para esta partida' using errcode = 'P0001';
  end if;
  if uid = s.impostor then
    return jsonb_build_object('impostor', true, 'palabra', null);
  end if;
  return jsonb_build_object('impostor', false, 'palabra', s.palabra);
end;
$$;
revoke execute on function public.mi_rol(uuid) from public, anon;
grant execute on function public.mi_rol(uuid) to authenticated;

create or replace function public.mi_palabra(p uuid) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  r public.partidas;
  s public.impostor_secretos;
  uid uuid := (select auth.uid());
begin
  if not public.es_miembro() then
    raise exception 'No sos miembro' using errcode = '42501';
  end if;
  select x.* into r from public.partidas x where x.id = p;
  if r.id is null or not exists (select 1 from public.jugadores j where j.partida = p and j.persona = uid and not j.se_fue) then
    raise exception 'No estás en esta partida' using errcode = '42501';
  end if;
  if r.juego <> 'impostor' or r.estado <> 'jugando' then
    raise exception 'No hay palabra para esta partida' using errcode = 'P0001';
  end if;
  select x.* into s from public.impostor_secretos x where x.partida = p;
  if s.partida is null then
    raise exception 'No hay palabra para esta partida' using errcode = 'P0001';
  end if;
  return case when uid = s.impostor then 'Sos el impostor' else s.palabra end;
end;
$$;
revoke execute on function public.mi_palabra(uuid) from public, anon;
grant execute on function public.mi_palabra(uuid) to authenticated;

-- Verificación (solo lectura): tiene que dar fallas vacío
select 'RESULTADO' as r, array_remove(array[
  case when not exists (select 1 from pg_proc where proname = 'mi_rol' and pronamespace = 'public'::regnamespace) then 'falta mi_rol' end,
  case when has_function_privilege('anon', 'public.mi_rol(uuid)', 'execute') then 'mi_rol ejecutable por anon' end,
  case when not has_function_privilege('authenticated', 'public.mi_rol(uuid)', 'execute') then 'mi_rol no ejecutable por authenticated' end,
  case when pg_get_functiondef('public.mi_palabra(uuid)'::regprocedure) not like '%Sos el impostor%' then 'mi_palabra vieja' end
], null) as fallas;
