-- 36 Ajedrez online (pedido de Ivan, 2026-11-15): de a dos, cada uno en su teléfono. No borra ni pisa datos.
-- * partidas.juego acepta también 'ajedrez' (y deja lugar para 'pictionary' y 'truco', que vienen después).
-- * Sala: exactamente 2 jugadores. Al arrancar, los colores se sortean.
-- * Las jugadas NO se escriben por RPC: las valida la Edge Function juegos (chess.js) y las guarda con ajedrez_guardar
--   (solo service_role), con control de concurrencia por cantidad de jugadas.
-- * Salir de una partida en juego = abandonar: gana el otro (motivo 'abandono').
-- * ranking(): suma el ajedrez (50 por jugar, +150 al que gana, +50 a cada uno si son tablas), solo partidas de 10
--   jugadas o más (RankingLogica.PUNTOS y AjedrezLogica.MIN_JUGADAS_RANKING: mismos números).

alter table public.partidas drop constraint if exists partidas_juego_check;
alter table public.partidas add constraint partidas_juego_check check (juego in ('trivia', 'impostor', 'ajedrez', 'pictionary', 'truco'));

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
  if p_juego is null or p_juego not in ('trivia', 'impostor', 'ajedrez') then
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
  if (select count(*) from public.jugadores j where j.partida = p) >= 20 then
    raise exception 'La partida está llena' using errcode = 'P0001';
  end if;
  insert into public.jugadores (partida, persona) values (p, (select auth.uid()))
  on conflict (partida, persona) do update set se_fue = false;
end;
$$;
revoke execute on function public.unirse_partida(uuid) from public, anon;
grant execute on function public.unirse_partida(uuid) to authenticated;

-- Arranca: colores al azar entre los 2 activos. Uso interno (la llama avanzar_partida con la partida bloqueada).
create or replace function public.ajedrez_arrancar(p uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare js uuid[];
begin
  select array_agg(j.persona order by random()) into js from public.jugadores j where j.partida = p and not j.se_fue;
  if coalesce(cardinality(js), 0) <> 2 then
    raise exception 'El ajedrez es de a dos: tiene que haber exactamente 2 jugadores' using errcode = 'P0001';
  end if;
  update public.partidas x set estado = 'jugando', estado_juego = jsonb_build_object(
      'fase', 'jugando', 'fen', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'jugadas', '[]'::jsonb, 'n', 0,
      'blancas', js[1], 'negras', js[2], 'ultima', null, 'ahora_ms', public.ahora_ms())
   where x.id = p;
end;
$$;
revoke execute on function public.ajedrez_arrancar(uuid) from public, anon, authenticated;

-- Guarda la jugada que validó la Edge Function: solo si la partida sigue en juego y nadie jugó en el medio (p_n = cuántas
-- jugadas había cuando se validó). Devuelve true si la guardó.
create or replace function public.ajedrez_guardar(p uuid, p_n int, p_estado jsonb, p_terminar boolean) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare ok boolean;
begin
  update public.partidas x
     set estado_juego = p_estado || jsonb_build_object('ahora_ms', public.ahora_ms()),
         estado = case when p_terminar then 'terminada' else 'jugando' end
   where x.id = p and x.juego = 'ajedrez' and x.estado = 'jugando' and coalesce((x.estado_juego->>'n')::int, 0) = p_n;
  get diagnostics ok = row_count;
  return ok;
end;
$$;
revoke execute on function public.ajedrez_guardar(uuid, int, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.ajedrez_guardar(uuid, int, jsonb, boolean) to service_role;

-- avanzar_partida: igual que la 18 + ajedrez (arranca con ajedrez_arrancar; en juego no hay nada que avanzar)
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
  else
    raise exception 'Todavía no disponible' using errcode = 'P0001';
  end if;
  return (select x.estado_juego from public.partidas x where x.id = p);
end;
$$;
revoke execute on function public.avanzar_partida(uuid, int, text) from public, anon;
grant execute on function public.avanzar_partida(uuid, int, text) to authenticated;

-- salir_partida: igual que la 18 + ajedrez (salir en juego es abandonar: gana el otro)
create or replace function public.salir_partida(p uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.partidas;
  uid uuid := (select auth.uid());
  activos int;
  respondieron int;
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

-- ranking(): la de la 35 + ajedrez (cambian las columnas: hay que borrarla y crearla de nuevo)
drop function if exists public.ranking(int);
create or replace function public.ranking(p_anio int default null)
returns table (persona uuid, total int,
               asistencia int, n_asistencia int, tercer int, n_tercer int, organizar int, n_organizar int,
               trivia int, n_trivia int, impostor int, n_impostor int, ajedrez int, n_ajedrez int)
language sql stable security definer set search_path = ''
as $$
  with conf as (
    select c.persona, c.actividad, c.parte, a.creador,
           ((case when c.parte = 'tercer' then a.tercer_fecha else a.fecha end) at time zone 'America/Argentina/Buenos_Aires') as cuando
      from public.asistencias_confirmadas c
      join public.actividades a on a.id = c.actividad
     where a.estado <> 'cancelada'
       and (p_anio is null or extract(year from (a.fecha at time zone 'America/Argentina/Buenos_Aires')) = p_anio)
  ),
  asis as (
    select d.persona, count(*)::int as n from (select distinct c.persona, c.cuando::date from conf c where c.parte = 'actividad') d group by d.persona
  ),
  ter as (
    select d.persona, count(*)::int as n from (select distinct c.persona, c.cuando::date from conf c where c.parte = 'tercer') d group by d.persona
  ),
  org as (
    select o.creador as persona, count(*)::int as n from (
      select c.actividad, c.creador from conf c
       where c.parte = 'actividad' and c.persona <> c.creador
       group by c.actividad, c.creador having count(*) >= 3
    ) o group by o.creador
  ),
  par as (
    select p.id, p.juego, p.creado, p.estado_juego as e
      from public.partidas p
     where p.estado = 'terminada' and p.estado_juego ->> 'fase' = 'final'
       and (p_anio is null or extract(year from (p.creado at time zone 'America/Argentina/Buenos_Aires')) = p_anio)
  ),
  jug as (
    select j.persona, par.id, par.juego, par.creado, par.e, j.puntos,
           count(*) over (partition by par.id) as n_act,
           max(j.puntos) over (partition by par.id) as max_pts
      from par join public.jugadores j on j.partida = par.id and not j.se_fue
  ),
  pts as (
    select jug.persona, jug.juego, jug.creado,
           case jug.juego
             when 'trivia' then case when jug.n_act < 2 then 0
                                     else 50 + case when jug.puntos = jug.max_pts and jug.puntos > 0 then 150 else 0 end end
             when 'impostor' then 50 + case
                 when jug.e ->> 'gano' = 'grupo' and jug.persona::text <> coalesce(jug.e ->> 'impostor', '') then 100
                 when jug.e ->> 'gano' = 'impostor' and jug.persona::text = coalesce(jug.e ->> 'impostor', '') then 250
                 else 0 end
             when 'ajedrez' then case when coalesce(jsonb_array_length(jug.e -> 'jugadas'), 0) < 10 then 0
                 else 50 + case
                   when jug.e ->> 'gano' = 'tablas' then 50
                   when (jug.e ->> 'gano' = 'blancas' and jug.persona::text = jug.e ->> 'blancas')
                     or (jug.e ->> 'gano' = 'negras' and jug.persona::text = jug.e ->> 'negras') then 150
                   else 0 end end
             else 0 end as p
      from jug
  ),
  tope as (
    select t.persona, t.juego, t.p from (
      select pts.*, row_number() over (partition by pts.persona, (pts.creado at time zone 'America/Argentina/Buenos_Aires')::date order by pts.creado) as rn
        from pts where pts.p > 0
    ) t where t.rn <= 10
  ),
  jue as (
    select t.persona,
           coalesce(sum(t.p) filter (where t.juego = 'trivia'), 0)::int as tr, (count(*) filter (where t.juego = 'trivia'))::int as ntr,
           coalesce(sum(t.p) filter (where t.juego = 'impostor'), 0)::int as im, (count(*) filter (where t.juego = 'impostor'))::int as nim,
           coalesce(sum(t.p) filter (where t.juego = 'ajedrez'), 0)::int as aj, (count(*) filter (where t.juego = 'ajedrez'))::int as naj
      from tope t group by t.persona
  ),
  todo as (
    select pf.id as persona,
           coalesce(asis.n, 0) * 1000 as asistencia, coalesce(asis.n, 0) as n_asistencia,
           coalesce(ter.n, 0) * 300 as tercer, coalesce(ter.n, 0) as n_tercer,
           coalesce(org.n, 0) * 500 as organizar, coalesce(org.n, 0) as n_organizar,
           coalesce(jue.tr, 0) as trivia, coalesce(jue.ntr, 0) as n_trivia,
           coalesce(jue.im, 0) as impostor, coalesce(jue.nim, 0) as n_impostor,
           coalesce(jue.aj, 0) as ajedrez, coalesce(jue.naj, 0) as n_ajedrez
      from public.perfiles pf
      left join asis on asis.persona = pf.id
      left join ter on ter.persona = pf.id
      left join org on org.persona = pf.id
      left join jue on jue.persona = pf.id
     where pf.activo
  )
  select t.persona, (t.asistencia + t.tercer + t.organizar + t.trivia + t.impostor + t.ajedrez)::int as total,
         t.asistencia::int, t.n_asistencia::int, t.tercer::int, t.n_tercer::int, t.organizar::int, t.n_organizar::int,
         t.trivia, t.n_trivia, t.impostor, t.n_impostor, t.ajedrez, t.n_ajedrez
    from todo t
   where public.es_miembro()
     and (t.asistencia + t.tercer + t.organizar + t.trivia + t.impostor + t.ajedrez) > 0
   order by 2 desc, t.n_asistencia desc;
$$;
revoke execute on function public.ranking(int) from public, anon;
grant execute on function public.ranking(int) to authenticated;

-- Verificación (solo lectura): fallas vacío
select 'RESULTADO' as r, array_remove(array[
  case when has_function_privilege('authenticated', 'public.ajedrez_guardar(uuid,int,jsonb,boolean)', 'execute') then 'ajedrez_guardar ejecutable por authenticated' end,
  case when has_function_privilege('authenticated', 'public.ajedrez_arrancar(uuid)', 'execute') then 'ajedrez_arrancar ejecutable por authenticated' end,
  case when not has_function_privilege('service_role', 'public.ajedrez_guardar(uuid,int,jsonb,boolean)', 'execute') then 'ajedrez_guardar sin service_role' end,
  case when has_function_privilege('anon', 'public.ranking(int)', 'execute') then 'ranking ejecutable por anon' end,
  case when pg_get_constraintdef((select oid from pg_constraint where conname = 'partidas_juego_check')) not like '%ajedrez%' then 'partidas sin ajedrez' end
], null) as fallas;
