-- Actividades y asistencias (con "tercer tiempo"). Leen los miembros; escribe solo el creador / cada persona por sí misma.

create table if not exists public.actividades (
  id uuid primary key default gen_random_uuid(),
  creador uuid not null default auth.uid() references public.perfiles(id) on delete cascade,
  tipo text not null check (tipo in ('futbol','padel','trekking','asado','after','otra')),
  tipo_otro text null check (tipo_otro is null or char_length(btrim(tipo_otro)) between 1 and 60),
  titulo text not null check (char_length(btrim(titulo)) between 1 and 80),
  fecha timestamptz not null,
  lugar text not null check (char_length(btrim(lugar)) between 1 and 120),
  cupo int null check (cupo is null or cupo >= 1),
  descripcion text not null default '' check (char_length(descripcion) <= 500),
  tiene_tercer boolean not null default false,
  tercer_lugar text null check (tercer_lugar is null or char_length(btrim(tercer_lugar)) between 1 and 120),
  tercer_fecha timestamptz null,
  estado text not null default 'abierta' check (estado in ('abierta','confirmada','cancelada')),
  creado timestamptz not null default now(),
  constraint actividades_otra_requiere_detalle check (tipo <> 'otra' or tipo_otro is not null),
  constraint actividades_tercer_completo check (
    (not tiene_tercer and tercer_lugar is null and tercer_fecha is null)
    or (tiene_tercer and tercer_lugar is not null and tercer_fecha is not null and tercer_fecha >= fecha)
  )
);
create index if not exists actividades_creador_idx on public.actividades (creador);
create index if not exists actividades_fecha_idx on public.actividades (fecha);

create table if not exists public.asistencias (
  actividad uuid not null references public.actividades(id) on delete cascade,
  persona uuid not null default auth.uid() references public.perfiles(id) on delete cascade,
  parte text not null check (parte in ('actividad','tercer')),
  primary key (actividad, persona, parte)
);
create index if not exists asistencias_persona_idx on public.asistencias (persona);

alter table public.actividades enable row level security;
alter table public.asistencias enable row level security;

-- ---- Políticas ----
drop policy if exists actividades_select on public.actividades;
create policy actividades_select on public.actividades for select to authenticated
  using (public.es_miembro());
drop policy if exists actividades_insert on public.actividades;
create policy actividades_insert on public.actividades for insert to authenticated
  with check (public.es_miembro() and creador = (select auth.uid()) and estado = 'abierta');
drop policy if exists actividades_update on public.actividades;
create policy actividades_update on public.actividades for update to authenticated
  using (creador = (select auth.uid())) with check (creador = (select auth.uid()));
-- Sin policy de delete: una actividad no se borra, se cancela.

drop policy if exists asistencias_select on public.asistencias;
create policy asistencias_select on public.asistencias for select to authenticated
  using (public.es_miembro());
drop policy if exists asistencias_insert on public.asistencias;
create policy asistencias_insert on public.asistencias for insert to authenticated
  with check (public.es_miembro() and persona = (select auth.uid()));
drop policy if exists asistencias_delete on public.asistencias;
create policy asistencias_delete on public.asistencias for delete to authenticated
  using (persona = (select auth.uid()));
-- Sin policy de update: anotarse o bajarse son insert y delete.

-- ---- Grants mínimos ----
revoke all on public.actividades from anon, authenticated;
revoke all on public.asistencias from anon, authenticated;
grant select on public.actividades to authenticated;
grant insert (tipo, tipo_otro, titulo, fecha, lugar, cupo, descripcion, tiene_tercer, tercer_lugar, tercer_fecha) on public.actividades to authenticated;
grant update (tipo, tipo_otro, titulo, fecha, lugar, cupo, descripcion, tiene_tercer, tercer_lugar, tercer_fecha, estado) on public.actividades to authenticated;
grant select, delete on public.asistencias to authenticated;
grant insert (actividad, parte) on public.asistencias to authenticated;
-- creador y persona salen de auth.uid() (default de la columna): no hace falta que el cliente los mande ni que pueda cambiarlos.
grant insert (creador) on public.actividades to authenticated;
grant insert (persona) on public.asistencias to authenticated;

-- ---- Una actividad cancelada no se reabre ----
create or replace function public.actividades_no_reabrir() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.estado = 'cancelada' and new.estado <> 'cancelada' then
    raise exception 'La actividad está cancelada' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.actividades_no_reabrir() from public, anon, authenticated;
drop trigger if exists actividades_no_reabrir on public.actividades;
create trigger actividades_no_reabrir before update on public.actividades
  for each row execute function public.actividades_no_reabrir();

-- ---- Anotarse: no a canceladas, no al tercer tiempo si no hay, y no a la actividad con el cupo lleno ----
-- SECURITY DEFINER para poder bloquear la fila de la actividad (FOR UPDATE) aunque quien se anota no sea el creador.
-- El bloqueo serializa las altas de una misma actividad: dos personas no pueden ocupar el último lugar a la vez.
create or replace function public.asistencias_validar_alta() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  a public.actividades%rowtype;
  anotados int;
begin
  select * into a from public.actividades where id = new.actividad for update;
  if not found then
    raise exception 'La actividad no existe' using errcode = 'P0001';
  end if;
  if a.estado = 'cancelada' then
    raise exception 'La actividad está cancelada' using errcode = 'P0001';
  end if;
  if new.parte = 'tercer' and not a.tiene_tercer then
    raise exception 'La actividad no tiene tercer tiempo' using errcode = 'P0001';
  end if;
  if new.parte = 'actividad' and a.cupo is not null then
    select count(*) into anotados from public.asistencias where actividad = new.actividad and parte = 'actividad';
    if anotados >= a.cupo then
      raise exception 'El cupo está completo' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.asistencias_validar_alta() from public, anon, authenticated;
drop trigger if exists asistencias_validar_alta on public.asistencias;
create trigger asistencias_validar_alta before insert on public.asistencias
  for each row execute function public.asistencias_validar_alta();

-- ---- Realtime (respeta el SELECT de la tabla) ----
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'actividades') then
    alter publication supabase_realtime add table public.actividades;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'asistencias') then
    alter publication supabase_realtime add table public.asistencias;
  end if;
end $$;
