-- 38 Truco completo (pedido de Ivan, 2026-11-15): de a 2, 4 o 6 (parejas cruzadas), a 15 o 30, con flor opcional.
-- No borra ni pisa datos. Las reglas están en truco-logica.js: las aplica la Edge Function juegos, que es la única que
-- escribe el estado del truco (ver el encabezado de ese archivo para las reglas elegidas).
-- * truco_config(p, a, flor): quien armó la partida elige a cuántos (15 o 30) y si hay flor, mientras está en espera.
-- * truco_secretos: el estado completo (con las cartas de cada uno). Solo service_role. La app ve partidas.estado_juego
--   (lo público, sin cartas) y sus propias cartas con truco_mis_cartas(p).
-- * truco_guardar: la Edge Function guarda el estado nuevo si nadie movió en el medio (v). Con v = 0 arranca la partida.
-- * Salir en juego = abandonar: gana la otra pareja. El ranking ya cuenta el truco (estado_juego.ganadores, 37).

create table if not exists public.truco_secretos (
  partida uuid primary key references public.partidas(id) on delete cascade,
  estado jsonb not null,
  v int not null default 0
);
alter table public.truco_secretos enable row level security;
revoke all on public.truco_secretos from anon, authenticated;

create or replace function public.truco_config(p uuid, p_a int, p_flor boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.partidas;
begin
  if not public.es_miembro() then raise exception 'No sos miembro' using errcode = '42501'; end if;
  select * into r from public.partidas x where x.id = p for update;
  if r.id is null or r.juego <> 'truco' then raise exception 'La partida no existe' using errcode = 'P0002'; end if;
  if r.creador <> (select auth.uid()) then raise exception 'Solo quien armó la partida elige cómo se juega' using errcode = '42501'; end if;
  if r.estado <> 'espera' then raise exception 'La partida ya empezó' using errcode = 'P0001'; end if;
  update public.partidas x set estado_juego = jsonb_build_object('a', case when p_a = 15 then 15 else 30 end, 'flor', coalesce(p_flor, false))
   where x.id = p;
end;
$$;
revoke execute on function public.truco_config(uuid, int, boolean) from public, anon;
grant execute on function public.truco_config(uuid, int, boolean) to authenticated;

create or replace function public.truco_guardar(p uuid, p_v int, p_completo jsonb, p_publico jsonb, p_terminar boolean) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare ok int;
begin
  if p_v = 0 then
    if exists (select 1 from public.truco_secretos s where s.partida = p) then return false; end if;
    update public.partidas x set estado = 'jugando', estado_juego = p_publico || jsonb_build_object('v', 1, 'ahora_ms', public.ahora_ms())
     where x.id = p and x.juego = 'truco' and x.estado = 'espera';
    get diagnostics ok = row_count;
    if ok = 0 then return false; end if;
    insert into public.truco_secretos (partida, estado, v) values (p, p_completo, 1);
    perform public.juegos_avisar_lista(p);
    return true;
  end if;
  update public.truco_secretos s set estado = p_completo, v = p_v + 1 where s.partida = p and s.v = p_v;
  get diagnostics ok = row_count;
  if ok = 0 then return false; end if;
  update public.partidas x set estado = case when p_terminar then 'terminada' else 'jugando' end,
         estado_juego = p_publico || jsonb_build_object('v', p_v + 1, 'ahora_ms', public.ahora_ms())
   where x.id = p and x.estado = 'jugando';
  get diagnostics ok = row_count;
  return ok > 0;
end;
$$;
revoke execute on function public.truco_guardar(uuid, int, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.truco_guardar(uuid, int, jsonb, jsonb, boolean) to service_role;

-- tus cartas (y solo las tuyas): { asiento, cartas, v }
create or replace function public.truco_mis_cartas(p uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare s public.truco_secretos; uid text := (select auth.uid())::text; a int;
begin
  if not public.es_miembro() then raise exception 'No sos miembro' using errcode = '42501'; end if;
  select * into s from public.truco_secretos x where x.partida = p;
  if s.partida is null then raise exception 'La partida todavía no arrancó' using errcode = 'P0001'; end if;
  select (t.i - 1)::int into a from jsonb_array_elements_text(s.estado->'config'->'jugadores') with ordinality as t(u, i) where t.u = uid;
  if a is null then raise exception 'No estás en esta partida' using errcode = '42501'; end if;
  return jsonb_build_object('asiento', a, 'cartas', coalesce(s.estado->'cartas'->(a::text), '[]'::jsonb), 'v', s.v);
end;
$$;
revoke execute on function public.truco_mis_cartas(uuid) from public, anon;
grant execute on function public.truco_mis_cartas(uuid) to authenticated;

-- ---- Funciones generales de partidas: las de la 37 + truco ----
create or replace function public.crear_partida(p_juego text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v uuid;
  uid uuid := (select auth.uid());
begin
  if not public.es_miembro() then
    raise exception 'No sos miembro' using errcode = '42501';
  end if;
  if p_juego is null or p_juego not in ('trivia', 'impostor', 'ajedrez', 'pictionary', 'truco') then
    raise exception 'Juego inválido' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('crear_partida:' || uid::text, 0));
  if (select count(*) from public.partidas x
       where x.creador = uid and x.estado = 'espera' and x.creado > now() - interval '12 hours') >= 3 then
    raise exception 'Ya tenés 3 partidas abiertas: arrancá o cancelá alguna antes de armar otra' using errcode = 'P0001';
  end if;
  insert into public.partidas (juego, creador) values (p_juego, uid) returning id into v;
  insert into public.jugadores (partida, persona) values (v, uid);
  return v;
end;
$$;
revoke execute on function public.crear_partida(text) from public, anon;
grant execute on function public.crear_partida(text) to authenticated;

create or replace function public.unirse_partida(p uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.partidas;
begin
  if not public.es_miembro() then
    raise exception 'No sos miembro' using errcode = '42501';
  end if;
  select * into r from public.partidas x where x.id = p for update;
  if r.id is null then
    raise exception 'La partida no existe' using errcode = 'P0002';
  end if;
  if r.estado <> 'espera' then
    raise exception 'La partida ya empezó' using errcode = 'P0001';
  end if;
  if r.juego = 'ajedrez' and (select count(*) from public.jugadores j where j.partida = p and not j.se_fue
                               and j.persona <> (select auth.uid())) >= 2 then
    raise exception 'La partida está llena: el ajedrez es de a dos' using errcode = 'P0001';
  end if;
  if r.juego = 'pictionary' and (select count(*) from public.jugadores j where j.partida = p and not j.se_fue
                                  and j.persona <> (select auth.uid())) >= 8 then
    raise exception 'La partida está llena: el Pictionary es de hasta 8' using errcode = 'P0001';
  end if;
  if r.juego = 'truco' and (select count(*) from public.jugadores j where j.partida = p and not j.se_fue
                             and j.persona <> (select auth.uid())) >= 6 then
    raise exception 'La partida está llena: el truco es de hasta 6' using errcode = 'P0001';
  end if;
  if (select count(*) from public.jugadores j where j.partida = p) >= 20 then
    raise exception 'La partida está llena' using errcode = 'P0001';
  end if;
  insert into public.jugadores (partida, persona) values (p, (select auth.uid()))
  on conflict (partida, persona) do update set se_fue = false;
end;
$$;
revoke execute on function public.unirse_partida(uuid) from public, anon;
grant execute on function public.unirse_partida(uuid) to authenticated;

create or replace function public.avanzar_partida(p uuid, p_ronda int default null, p_fase text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.partidas;
  e jsonb;
  uid uuid := (select auth.uid());
  activos int;
begin
  if not public.es_miembro() then
    raise exception 'No sos miembro' using errcode = '42501';
  end if;
  select * into r from public.partidas x where x.id = p for update;
  if r.id is null then
    raise exception 'La partida no existe' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.jugadores j where j.partida = p and j.persona = uid and not j.se_fue) then
    raise exception 'No estás en esta partida' using errcode = '42501';
  end if;
  e := r.estado_juego;
  if p_ronda is not null and coalesce((e->>'ronda')::int, 0) <> p_ronda then
    return e;
  end if;
  if p_fase is not null and coalesce(e->>'fase', r.estado) <> p_fase then
    return e;
  end if;
  if r.estado = 'terminada' then
    return e;
  end if;

  if r.estado = 'espera' then
    if r.creador <> uid then
      raise exception 'Solo quien armó la partida la puede arrancar' using errcode = 'P0001';
    end if;
    if r.juego = 'impostor' then
      select count(*) into activos from public.jugadores j where j.partida = p and not j.se_fue;
      if activos < 3 then
        raise exception 'El Impostor necesita al menos 3 jugadores' using errcode = 'P0001';
      end if;
      perform public.impostor_arrancar(p);
    elsif r.juego = 'trivia' then
      perform public.trivia_arrancar(p);
    elsif r.juego = 'ajedrez' then
      perform public.ajedrez_arrancar(p);
    elsif r.juego = 'pictionary' then
      perform public.pictionary_arrancar(p);
    elsif r.juego = 'truco' then
      raise exception 'Todavía no: el truco se arranca desde la app' using errcode = 'P0001';
    else
      raise exception 'Todavía no disponible' using errcode = 'P0001';
    end if;
    perform public.juegos_avisar_lista(p);
    return (select x.estado_juego from public.partidas x where x.id = p);
  end if;

  if r.juego = 'impostor' then
    perform public.impostor_avanzar(p, uid);
  elsif r.juego = 'trivia' then
    perform public.trivia_avanzar(p, uid);
  elsif r.juego = 'ajedrez' then
    return e; -- las jugadas van por la Edge Function juegos
  elsif r.juego = 'pictionary' then
    perform public.pictionary_avanzar(p, uid);
  elsif r.juego = 'truco' then
    return e; -- las jugadas van por la Edge Function juegos
  else
    raise exception 'Todavía no disponible' using errcode = 'P0001';
  end if;
  return (select x.estado_juego from public.partidas x where x.id = p);
end;
$$;
revoke execute on function public.avanzar_partida(uuid, int, text) from public, anon;
grant execute on function public.avanzar_partida(uuid, int, text) to authenticated;

create or replace function public.salir_partida(p uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.partidas;
  uid uuid := (select auth.uid());
  activos int;
  respondieron int;
  mi_asiento int;
begin
  select * into r from public.partidas x where x.id = p for update;
  if r.id is null or not exists (select 1 from public.jugadores j where j.partida = p and j.persona = uid and not j.se_fue) then
    raise exception 'No estás en esta partida' using errcode = 'P0002';
  end if;
  if r.estado = 'espera' then
    if r.creador = uid then
      update public.partidas x set estado = 'terminada', estado_juego = jsonb_build_object('fase', 'cancelada', 'ahora_ms', public.ahora_ms())
       where x.id = p;
      perform public.juegos_avisar_lista(p);
    end if;
    delete from public.jugadores j where j.partida = p and j.persona = uid;
    return;
  end if;
  update public.jugadores j set se_fue = true where j.partida = p and j.persona = uid;
  if r.estado <> 'jugando' then
    return;
  end if;
  if r.juego = 'ajedrez' then
    update public.partidas x set estado = 'terminada',
           estado_juego = x.estado_juego || jsonb_build_object('fase', 'final', 'motivo', 'abandono',
             'gano', case when x.estado_juego->>'blancas' = uid::text then 'negras' else 'blancas' end, 'ahora_ms', public.ahora_ms())
     where x.id = p;
    return;
  end if;
  if r.juego = 'truco' then
    -- abandonar: gana la otra pareja (los que siguen en ella)
    select (t.i - 1)::int into mi_asiento from public.truco_secretos s,
      jsonb_array_elements_text(s.estado->'config'->'jugadores') with ordinality as t(u, i)
     where s.partida = p and t.u = uid::text;
    update public.partidas x set estado = 'terminada',
           estado_juego = x.estado_juego || jsonb_build_object('fase', 'final', 'motivo', 'abandono', 'ahora_ms', public.ahora_ms(),
             'ganadores', coalesce((
               select jsonb_agg(t.u) from public.truco_secretos s,
                 jsonb_array_elements_text(s.estado->'config'->'jugadores') with ordinality as t(u, i)
                where s.partida = p and mi_asiento is not null
                  and (s.estado->'config'->'equipo'->>((t.i - 1)::int))::int <> (s.estado->'config'->'equipo'->>mi_asiento)::int
                  and exists (select 1 from public.jugadores j where j.partida = p and j.persona::text = t.u and not j.se_fue)), '[]'::jsonb))
     where x.id = p;
    return;
  end if;
  if r.juego = 'pictionary' then
    if (select count(*) from public.jugadores j where j.partida = p and not j.se_fue) < 2 then
      update public.partidas x set estado = 'terminada', estado_juego = x.estado_juego || jsonb_build_object('fase', 'final', 'ahora_ms', public.ahora_ms())
       where x.id = p;
    elsif r.estado_juego->>'fase' = 'dibujando' and r.estado_juego->>'dibuja' = uid::text then
      perform public.pictionary_revelar(p);
    end if;
    return;
  end if;
  if r.juego = 'impostor' then
    if exists (select 1 from public.impostor_secretos s where s.partida = p and s.impostor is distinct from uid) then
      perform public.impostor_descartar_votos_a(p, uid);
    end if;
    perform public.impostor_tras_salida(p);
    return;
  end if;
  select count(*) into activos from public.jugadores j where j.partida = p and not j.se_fue;
  if activos = 0 then
    update public.partidas x set estado = 'terminada',
           estado_juego = x.estado_juego || jsonb_build_object('fase', 'final', 'ahora_ms', public.ahora_ms())
     where x.id = p;
  elsif r.juego = 'trivia' and r.estado_juego->>'fase' = 'pregunta' then
    select count(*) into respondieron from public.respuestas s join public.jugadores j on j.partida = s.partida and j.persona = s.persona
     where s.partida = p and s.ronda = (r.estado_juego->>'ronda')::int and not j.se_fue;
    if respondieron >= activos then
      perform public.trivia_revelar(p);
    end if;
  end if;
end;
$$;
revoke execute on function public.salir_partida(uuid) from public, anon;
grant execute on function public.salir_partida(uuid) to authenticated;

-- Verificación (solo lectura): fallas vacío
select 'RESULTADO' as r, array_remove(array[
  case when has_table_privilege('authenticated', 'public.truco_secretos', 'SELECT') then 'secretos legibles' end,
  case when has_function_privilege('authenticated', 'public.truco_guardar(uuid,int,jsonb,jsonb,boolean)', 'execute') then 'truco_guardar ejecutable' end,
  case when not has_function_privilege('service_role', 'public.truco_guardar(uuid,int,jsonb,jsonb,boolean)', 'execute') then 'truco_guardar sin service_role' end,
  case when has_function_privilege('anon', 'public.truco_mis_cartas(uuid)', 'execute') then 'mis_cartas ejecutable por anon' end
], null) as fallas;
