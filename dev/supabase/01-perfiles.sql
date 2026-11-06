-- Perfiles de ThirdCEDI Time + es_miembro() (la usan las RLS de todas las tareas).
create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null check (char_length(btrim(nombre)) between 1 and 60),
  foto text null,
  empresa text not null check (empresa in ('CEDI','Wemox','Pi Consulting','Vulps','Korex')),
  creado timestamptz not null default now()
);

alter table public.perfiles enable row level security;

-- Hay perfil para el usuario actual. SECURITY DEFINER para no recursar en la RLS de perfiles.
create or replace function public.es_miembro() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.perfiles where id = (select auth.uid())); $$;

revoke execute on function public.es_miembro() from public, anon;
grant execute on function public.es_miembro() to authenticated;

drop policy if exists perfiles_select on public.perfiles;
create policy perfiles_select on public.perfiles for select to authenticated
  using (public.es_miembro() or id = (select auth.uid()));
drop policy if exists perfiles_insert on public.perfiles;
create policy perfiles_insert on public.perfiles for insert to authenticated
  with check (id = (select auth.uid()));
drop policy if exists perfiles_update on public.perfiles;
create policy perfiles_update on public.perfiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- Sin policy de delete: el perfil se borra solo en cascada si se borra la cuenta.

grant select, insert, update on public.perfiles to authenticated;
revoke all on public.perfiles from anon;
