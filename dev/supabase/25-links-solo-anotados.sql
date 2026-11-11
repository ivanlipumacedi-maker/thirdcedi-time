-- 25: los links de Google Maps los ven solo quien organiza y los anotados (decisión de Ivan: un asado en una casa es el
-- pin exacto). El nombre del lugar y el destino siguen en actividades (los ve todo el grupo).
-- * Tabla public.actividades_links (una fila por actividad): lugar_link, destino_link, tercer_link, con el mismo CHECK
--   de dominios que tenía la 24. Se borra con la actividad.
-- * Leer: el creador de la actividad o quien está anotado a cualquier parte (en_sala 'act:<id>'), siendo miembro activo.
-- * Escribir (insert/update/delete): solo el creador, miembro activo y con la actividad no cancelada (como actividades).
-- * Saca de actividades las columnas lugar_link, destino_link y tercer_link de la 24 (estaban vacías: se verificó antes
--   de aplicar que no había ningún link cargado) y su CHECK. destino queda en actividades.
-- * Realtime: la tabla entra en supabase_realtime (respeta la RLS) para que el detalle se actualice en vivo.

create table if not exists public.actividades_links (
  actividad uuid primary key references public.actividades(id) on delete cascade,
  lugar_link text null,
  destino_link text null,
  tercer_link text null,
  actualizado timestamptz not null default now()
);

do $$
declare
  t constant text := '(com|com\.ar|cl|com\.uy|com\.py|com\.bo|com\.pe|com\.br|com\.mx|es|co|com\.co|com\.ec|co\.ve|us|co\.uk|fr|it|de)';
  re constant text := '^https://(maps\.app\.goo\.gl/|goo\.gl/maps|(www\.|maps\.)?google\.' || t || '/maps|maps\.google\.' || t || '/([?#]|$))[^[:space:]<>"]*$';
begin
  alter table public.actividades_links drop constraint if exists actividades_links_maps;
  execute format($f$alter table public.actividades_links add constraint actividades_links_maps check (
    (lugar_link is null or (char_length(lugar_link) <= 600 and lugar_link ~ %1$L))
    and (destino_link is null or (char_length(destino_link) <= 600 and destino_link ~ %1$L))
    and (tercer_link is null or (char_length(tercer_link) <= 600 and tercer_link ~ %1$L))
  )$f$, re);
end $$;

alter table public.actividades_links enable row level security;
revoke all on public.actividades_links from anon, authenticated;
grant select, delete on public.actividades_links to authenticated;
grant insert (actividad, lugar_link, destino_link, tercer_link) on public.actividades_links to authenticated;
grant update (actividad, lugar_link, destino_link, tercer_link) on public.actividades_links to authenticated;

-- creador de una actividad no cancelada (para escribir)
create or replace function public.organiza_activa(p_actividad uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.actividades a
                 where a.id = p_actividad and a.creador = (select auth.uid()) and a.estado <> 'cancelada')
$$;
revoke execute on function public.organiza_activa(uuid) from public, anon;
grant execute on function public.organiza_activa(uuid) to authenticated;

drop policy if exists actividades_links_select on public.actividades_links;
create policy actividades_links_select on public.actividades_links for select to authenticated using (
  public.es_miembro() and (
    exists (select 1 from public.actividades a where a.id = actividad and a.creador = (select auth.uid()))
    or public.en_sala('act:' || actividad::text)
  )
);
drop policy if exists actividades_links_insert on public.actividades_links;
create policy actividades_links_insert on public.actividades_links for insert to authenticated
  with check (public.es_miembro() and public.organiza_activa(actividad));
drop policy if exists actividades_links_update on public.actividades_links;
create policy actividades_links_update on public.actividades_links for update to authenticated
  using (public.es_miembro() and public.organiza_activa(actividad))
  with check (public.es_miembro() and public.organiza_activa(actividad));
drop policy if exists actividades_links_delete on public.actividades_links;
create policy actividades_links_delete on public.actividades_links for delete to authenticated
  using (public.es_miembro() and public.organiza_activa(actividad));

create or replace function public.actividades_links_tocar() returns trigger
language plpgsql set search_path = ''
as $$ begin new.actualizado := now(); return new; end; $$;
revoke execute on function public.actividades_links_tocar() from public, anon, authenticated;
drop trigger if exists actividades_links_tocar on public.actividades_links;
create trigger actividades_links_tocar before update on public.actividades_links
  for each row execute function public.actividades_links_tocar();

-- las columnas de la 24 (vacías) se van de actividades
alter table public.actividades drop constraint if exists actividades_links_maps;
alter table public.actividades drop constraint if exists actividades_tercer_link;
alter table public.actividades drop constraint if exists actividades_destino;
revoke insert (lugar_link, destino_link, tercer_link) on public.actividades from authenticated;
revoke update (lugar_link, destino_link, tercer_link) on public.actividades from authenticated;
alter table public.actividades drop column if exists lugar_link, drop column if exists destino_link, drop column if exists tercer_link;
alter table public.actividades add constraint actividades_destino check (destino is null or char_length(btrim(destino)) between 1 and 120);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'actividades_links') then
    alter publication supabase_realtime add table public.actividades_links;
  end if;
end $$;
