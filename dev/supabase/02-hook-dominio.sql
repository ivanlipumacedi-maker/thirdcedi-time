-- Auth Hook "Before User Created": rechaza altas de mails fuera del Grupo CEDI.
-- Misma lista que dominios.js. Se activa a mano en Dashboard > Authentication > Hooks.
create or replace function public.hook_dominio(event jsonb) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  email text := lower(btrim(coalesce(event->'user'->>'email', '')));
  dominio text := substring(email from '@([^@]+)$');
begin
  if dominio is not null and email ~ '^[^@]+@[^@]+$' and dominio = any (array[
    'cedi.com.ar',
    'wemox.com.ar',
    'piconsulting.com.ar',
    'vulps.com.ar',
    'korex.com.ar'
  ]) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'message', 'Solo cuentas del Grupo CEDI',
    'http_code', 403
  ));
end;
$$;

grant execute on function public.hook_dominio(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_dominio(jsonb) from authenticated, anon, public;
