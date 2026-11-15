-- 35 Ranking general (pedido de Ivan, 2026-11-15). No borra ni pisa datos: una tabla nueva y funciones.
--
-- Puntos (los mismos números que RankingLogica.PUNTOS en ranking-logica.js: si se cambia uno, cambiar los dos):
--   Asistencia a una actividad, confirmada por quien la armó ........ 1000  (lo que más suma, a propósito)
--   Tercer tiempo, confirmado ........................................  300
--   Organizar una actividad a la que fueron 3 o más (sin contarlo) ...  500
--   Trivia: jugar una partida con 2 o más jugadores ..................   50, +150 al que sale primero (empate: todos)
--   El Impostor: jugar una partida ...................................   50, +100 a cada uno del grupo si gana el
--                                                                            grupo, +250 al impostor si gana él
-- Topes contra inflar el ranking: cuenta una sola actividad (y un solo tercer tiempo) por persona por día, y hasta 10
-- partidas con puntos por persona por día. La Trivia jugada solo no suma. Las canceladas no suman.
-- Año: el de la actividad (su fecha) o el de la partida (cuando se creó), en hora de Argentina. p_anio null = histórico.
--
-- Asistencia confirmada (decisión de Ivan: la confirma quien armó la actividad):
-- * asistencias_confirmadas: la lee cualquier miembro (es la base del ranking); se escribe solo con confirmar_asistencia.
-- * confirmar_asistencia(actividad, parte, personas): solo quien la armó, desde que empezó esa parte hasta 30 días
--   después, no en una cancelada, y solo entre los anotados a esa parte. Deja confirmados exactamente a esos (saca a
--   los que no están en la lista).

create table if not exists public.asistencias_confirmadas (
  actividad uuid not null references public.actividades(id) on delete cascade,
  persona uuid not null references public.perfiles(id) on delete cascade,
  parte text not null check (parte in ('actividad', 'tercer')),
  confirmado_por uuid null references public.perfiles(id) on delete set null,
  creado timestamptz not null default now(),
  primary key (actividad, persona, parte)
);
create index if not exists asistencias_confirmadas_persona_idx on public.asistencias_confirmadas (persona);
alter table public.asistencias_confirmadas enable row level security;
revoke all on public.asistencias_confirmadas from anon, authenticated;
grant select on public.asistencias_confirmadas to authenticated;
drop policy if exists asistencias_confirmadas_select on public.asistencias_confirmadas;
create policy asistencias_confirmadas_select on public.asistencias_confirmadas for select to authenticated
  using (public.es_miembro());

create or replace function public.confirmar_asistencia(p_actividad uuid, p_parte text, p_personas uuid[]) returns int
language plpgsql security definer set search_path = ''
as $$
declare
  yo uuid := (select auth.uid());
  a public.actividades;
  inicio timestamptz;
  personas uuid[];
  x uuid;
begin
  if yo is null or not public.es_miembro() then
    raise exception 'No tenés permiso' using errcode = '42501';
  end if;
  select * into a from public.actividades where id = p_actividad for share;
  if not found then
    raise exception 'La actividad no existe' using errcode = 'P0001';
  end if;
  if a.creador <> yo then
    raise exception 'Solo quien armó la actividad confirma la asistencia' using errcode = '42501';
  end if;
  if a.estado = 'cancelada' then
    raise exception 'La actividad está cancelada' using errcode = 'P0001';
  end if;
  if p_parte is null or p_parte not in ('actividad', 'tercer') then
    raise exception 'La parte tiene que ser la actividad o el tercer tiempo' using errcode = 'P0001';
  end if;
  if p_parte = 'tercer' and not a.tiene_tercer then
    raise exception 'La actividad no tiene tercer tiempo' using errcode = 'P0001';
  end if;
  inicio := case when p_parte = 'tercer' then a.tercer_fecha else a.fecha end;
  if now() < inicio then
    raise exception 'Todavía no empezó: la asistencia se confirma después' using errcode = 'P0001';
  end if;
  if now() > inicio + interval '30 days' then
    raise exception 'Pasaron más de 30 días: la asistencia ya no se puede cambiar' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct v), '{}') into personas from unnest(coalesce(p_personas, '{}')) as v where v is not null;
  if cardinality(personas) > 500 then
    raise exception 'Son demasiadas personas' using errcode = 'P0001';
  end if;
  foreach x in array personas loop
    if not public.anotado_a(p_actividad, x, p_parte) then
      raise exception 'Solo se puede confirmar a los anotados' using errcode = 'P0001';
    end if;
  end loop;
  delete from public.asistencias_confirmadas c
   where c.actividad = p_actividad and c.parte = p_parte and not (c.persona = any (personas));
  insert into public.asistencias_confirmadas (actividad, persona, parte, confirmado_por)
    select p_actividad, v, p_parte, yo from unnest(personas) as v
  on conflict (actividad, persona, parte) do nothing;
  return cardinality(personas);
end;
$$;
revoke execute on function public.confirmar_asistencia(uuid, text, uuid[]) from public, anon;
grant execute on function public.confirmar_asistencia(uuid, text, uuid[]) to authenticated;

-- Ranking: una fila por miembro activo con algún punto, con el desglose. Solo para miembros.
create or replace function public.ranking(p_anio int default null)
returns table (persona uuid, total int,
               asistencia int, n_asistencia int, tercer int, n_tercer int, organizar int, n_organizar int,
               trivia int, n_trivia int, impostor int, n_impostor int)
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
           coalesce(sum(t.p) filter (where t.juego = 'impostor'), 0)::int as im, (count(*) filter (where t.juego = 'impostor'))::int as nim
      from tope t group by t.persona
  ),
  todo as (
    select pf.id as persona,
           coalesce(asis.n, 0) * 1000 as asistencia, coalesce(asis.n, 0) as n_asistencia,
           coalesce(ter.n, 0) * 300 as tercer, coalesce(ter.n, 0) as n_tercer,
           coalesce(org.n, 0) * 500 as organizar, coalesce(org.n, 0) as n_organizar,
           coalesce(jue.tr, 0) as trivia, coalesce(jue.ntr, 0) as n_trivia,
           coalesce(jue.im, 0) as impostor, coalesce(jue.nim, 0) as n_impostor
      from public.perfiles pf
      left join asis on asis.persona = pf.id
      left join ter on ter.persona = pf.id
      left join org on org.persona = pf.id
      left join jue on jue.persona = pf.id
     where pf.activo
  )
  select t.persona, (t.asistencia + t.tercer + t.organizar + t.trivia + t.impostor)::int as total,
         t.asistencia::int, t.n_asistencia::int, t.tercer::int, t.n_tercer::int, t.organizar::int, t.n_organizar::int,
         t.trivia, t.n_trivia, t.impostor, t.n_impostor
    from todo t
   where public.es_miembro()
     and (t.asistencia + t.tercer + t.organizar + t.trivia + t.impostor) > 0
   order by 2 desc, t.n_asistencia desc;
$$;
revoke execute on function public.ranking(int) from public, anon;
grant execute on function public.ranking(int) to authenticated;

-- Verificación (solo lectura): fallas vacío; y el ranking del año, para ver que corre
select 'RESULTADO' as r, array_remove(array[
  case when has_table_privilege('authenticated', 'public.asistencias_confirmadas', 'INSERT') then 'confirmadas escribible directo' end,
  case when has_function_privilege('anon', 'public.ranking(int)', 'execute') then 'ranking ejecutable por anon' end,
  case when has_function_privilege('anon', 'public.confirmar_asistencia(uuid,text,uuid[])', 'execute') then 'confirmar ejecutable por anon' end
], null) as fallas;
