-- 23: invitados. Mails puntuales de afuera del Grupo CEDI que pueden entrar (para pruebas con alguien de afuera).
-- * Tabla privada public.invitados (email en minúsculas). Sin grants para la app; la lee el hook de Auth.
-- * hook_dominio deja pasar los dominios del grupo o un mail que esté en invitados.
-- * perfiles: empresa 'Invitado' para ellos (el alta exige esa empresa si el mail es invitado).
-- * La app (dominios.js) deja pedir el código a cualquier mail con forma de mail: decide el servidor, que responde
--   "Solo cuentas del Grupo CEDI" si no es del grupo ni está invitado.
-- Sumar uno:  insert into public.invitados (email) values ('alguien@gmail.com');
-- Sacarlo:    delete from public.invitados where email = 'alguien@gmail.com';  (y darlo de baja: perfiles.activo = false)

create table if not exists public.invitados (
  email text primary key check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  creado timestamptz not null default now()
);
alter table public.invitados enable row level security;
revoke all on public.invitados from anon, authenticated;
grant select on public.invitados to supabase_auth_admin;
drop policy if exists invitados_hook on public.invitados;
create policy invitados_hook on public.invitados for select to supabase_auth_admin using (true);

create or replace function public.es_invitado(p_email text) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.invitados i where i.email = lower(btrim(coalesce(p_email, '')))) $$;
revoke execute on function public.es_invitado(text) from public, anon;
grant execute on function public.es_invitado(text) to authenticated, supabase_auth_admin;

create or replace function public.hook_dominio(event jsonb) returns jsonb
language plpgsql stable set search_path = ''
as $function$
declare
  v_email text := lower(btrim(coalesce(event->'user'->>'email', '')));
  v_dominio text := substring(v_email from '@([^@]+)$');
begin
  if v_dominio is not null and v_email ~ '^[^@]+@[^@]+$' and (v_dominio = any (array[
    'cedi.com.ar',
    'wemox.com.ar',
    'piconsulting.com.ar',
    'vulps.com.ar',
    'korex.com.ar'
  ]) or exists (select 1 from public.invitados i where i.email = v_email)) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'message', 'Solo cuentas del Grupo CEDI',
    'http_code', 403
  ));
end;
$function$;

alter table public.perfiles drop constraint if exists perfiles_empresa_check;
alter table public.perfiles add constraint perfiles_empresa_check
  check (empresa = any (array['CEDI', 'Wemox', 'Pi Consulting', 'Vulps', 'Korex', 'Invitado']));

drop policy if exists perfiles_insert on public.perfiles;
create policy perfiles_insert on public.perfiles for insert to authenticated
  with check (
    id = (select auth.uid())
    and empresa = case
      when public.es_invitado((select auth.jwt()) ->> 'email') then 'Invitado'
      else case split_part(lower(coalesce((select auth.jwt()) ->> 'email', '')), '@', 2)
        when 'cedi.com.ar' then 'CEDI'
        when 'wemox.com.ar' then 'Wemox'
        when 'piconsulting.com.ar' then 'Pi Consulting'
        when 'vulps.com.ar' then 'Vulps'
        when 'korex.com.ar' then 'Korex'
      end
    end
  );

-- Los invitados se cargan a mano con el MCP o en el SQL Editor (no van al repo, que es público).
