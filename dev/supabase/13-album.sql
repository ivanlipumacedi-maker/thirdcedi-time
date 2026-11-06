-- Álbum por actividad (cámara de Rumbo al Sur) con copia en Google Drive. Solo crea o altera: no toca filas.
-- - Tabla fotos: lee y sube quien está en la sala de la actividad (en_sala('act:<id>')); borra solo el autor.
--   El cliente inserta solo sus columnas: drive_* y liberada las escribe el servidor (Edge Function avisos).
-- - Bucket privado 'album', carpeta <actividad>/ con la misma regla.
-- - actividades.drive_url: link a la subcarpeta de Drive de la actividad (lo pone la Edge Function).
-- - RPC drive_tomar, liberables y espacio_proyecto: solo service_role. album_uso: el espacio usado, para la app.
-- - avisos_config / avisos_llamar: secreto de cron en Vault ('avisos_cron_secret', lo carga Ivan) y llamada a la
--   Edge Function con x-cron-secret. Trigger after insert en fotos → {tipo:'drive'}. El cron cada 5 minutos está
--   aparte, en 13-album-cron.sql (lo activa Ivan). Sin el secreto en Vault, avisos_llamar no hace nada.

-- pg_net en el esquema extensions (en public lo marca el advisor); sus funciones quedan en el esquema net igual.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ---- actividades.drive_url ----
alter table public.actividades add column if not exists drive_url text null
  check (drive_url is null or (drive_url ~ '^https://drive\.google\.com/' and char_length(drive_url) <= 300));
-- Sin grant de update para authenticated (07 da update por columnas): solo el servidor la escribe.

-- Una cancelada queda congelada (10), pero el servidor tiene que poder ponerle el link de Drive: se deja pasar el
-- UPDATE cuyo único cambio es drive_url. La reactivación compara la fila sin estado ni drive_url.
-- Mismo cuerpo que la 10 con esas dos diferencias.
create or replace function public.actividades_no_reabrir() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.estado <> 'cancelada' then
    return new;
  end if;
  if new.drive_url is distinct from old.drive_url
     and (to_jsonb(new) - 'drive_url') = (to_jsonb(old) - 'drive_url') then
    return new;
  end if;
  if new.estado = 'abierta'
     and (to_jsonb(new) - 'estado' - 'drive_url') = (to_jsonb(old) - 'estado' - 'drive_url')
     and old.creador = (select auth.uid()) then
    -- solo la fecha de la actividad: el tercer tiempo no cuenta para reactivar
    if old.fecha > now() then
      return new;
    end if;
    raise exception 'La actividad ya pasó: no se puede reactivar' using errcode = 'P0001';
  end if;
  raise exception 'La actividad está cancelada' using errcode = 'P0001';
end;
$$;
revoke execute on function public.actividades_no_reabrir() from public, anon, authenticated;

-- ---- Fotos ----
-- El id lo genera el teléfono al sacar la foto: reintentar una subida no duplica (23505).
create table if not exists public.fotos (
  id uuid primary key,
  actividad uuid not null references public.actividades(id) on delete cascade,
  autor uuid not null default auth.uid() references public.perfiles(id) on delete cascade,
  ruta text not null,
  mini text not null,
  media text null,
  ancho int null check (ancho is null or ancho between 1 and 20000),
  alto int null check (alto is null or alto between 1 and 20000),
  bytes bigint not null default 0 check (bytes between 0 and 50000000),
  tomada timestamptz not null default now(),
  creado timestamptz not null default now(),
  editada_de uuid null,
  drive_id text null,
  drive_error text null,
  drive_tomado timestamptz null,
  liberada boolean not null default false,
  constraint fotos_rutas check (
    ruta = actividad::text || '/' || id::text || '.jpg'
    and mini = actividad::text || '/' || id::text || '.t.webp'
    and (media is null or media = actividad::text || '/' || id::text || '.m.jpg'))
);
create index if not exists fotos_actividad_tomada_idx on public.fotos (actividad, tomada desc);
create index if not exists fotos_autor_idx on public.fotos (autor);
create index if not exists fotos_sin_drive_idx on public.fotos (creado) where drive_id is null;

alter table public.fotos enable row level security;

drop policy if exists fotos_select on public.fotos;
create policy fotos_select on public.fotos for select to authenticated
  using (public.es_miembro() and public.en_sala('act:' || actividad::text));
drop policy if exists fotos_insert on public.fotos;
create policy fotos_insert on public.fotos for insert to authenticated
  with check (public.es_miembro() and autor = (select auth.uid()) and public.en_sala('act:' || actividad::text));
drop policy if exists fotos_delete on public.fotos;
create policy fotos_delete on public.fotos for delete to authenticated
  using (public.es_miembro() and autor = (select auth.uid()) and public.en_sala('act:' || actividad::text));
-- Sin policy de update: el cliente no cambia una foto (editar crea una nueva).

revoke all on public.fotos from anon, authenticated;
grant select, delete on public.fotos to authenticated;
grant insert (id, actividad, ruta, mini, media, ancho, alto, bytes, tomada, editada_de) on public.fotos to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fotos') then
    alter publication supabase_realtime add table public.fotos;
  end if;
end $$;

-- ---- Storage: bucket privado 'album', carpeta <actividad>/ ----
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('album', 'album', false, 15728640, array['image/jpeg','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 15728640, allowed_mime_types = array['image/jpeg','image/webp'];

drop policy if exists album_select on storage.objects;
create policy album_select on storage.objects for select to authenticated
  using (bucket_id = 'album' and public.es_miembro() and public.en_sala('act:' || (storage.foldername(name))[1]));
drop policy if exists album_insert on storage.objects;
create policy album_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'album' and public.es_miembro() and array_length(storage.foldername(name), 1) = 1
    and public.en_sala('act:' || (storage.foldername(name))[1]));
-- update: la cola sube con upsert (si una subida quedó a medias, se pisa lo propio; lo ajeno no)
drop policy if exists album_update on storage.objects;
create policy album_update on storage.objects for update to authenticated
  using (bucket_id = 'album' and owner_id = (select auth.uid())::text and public.en_sala('act:' || (storage.foldername(name))[1]))
  with check (bucket_id = 'album' and owner_id = (select auth.uid())::text and public.en_sala('act:' || (storage.foldername(name))[1]));
drop policy if exists album_delete on storage.objects;
create policy album_delete on storage.objects for delete to authenticated
  using (bucket_id = 'album' and owner_id = (select auth.uid())::text and public.en_sala('act:' || (storage.foldername(name))[1]));

-- ---- Espacio ----
-- Lo que ocupa Storage en todo el proyecto (el límite de 1 GB es por proyecto e incluye chat y avatares).
create or replace function public.espacio_proyecto() returns bigint
language sql stable security definer set search_path = ''
as $$ select coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint from storage.objects o $$;
revoke execute on function public.espacio_proyecto() from public, anon, authenticated;
grant execute on function public.espacio_proyecto() to service_role;

-- Para la barra de espacio y para que la cola no suba con el espacio lleno. Solo un número; 0 si no sos miembro.
create or replace function public.album_uso() returns bigint
language sql stable security definer set search_path = ''
as $$ select case when public.es_miembro() then public.espacio_proyecto() else 0::bigint end $$;
revoke execute on function public.album_uso() from public, anon;
grant execute on function public.album_uso() to authenticated;

-- ---- Drive ----
-- Toma hasta p_cuantas fotos que todavía no están en Drive, con candado: el trigger y el cron no suben la misma a la vez.
-- Una tomada hace menos de 15 minutos (subiendo, o con error reciente) no se vuelve a tomar.
-- Las actividades de prueba ('zz ...', las que crean los tests) nunca van a Drive.
create or replace function public.drive_tomar(p_cuantas int) returns setof public.fotos
language sql security definer set search_path = ''
as $$
  update public.fotos f set drive_tomado = now()
   where f.id in (
     select x.id from public.fotos x join public.actividades a on a.id = x.actividad
      where x.drive_id is null and not x.liberada
        and (x.drive_tomado is null or x.drive_tomado < now() - interval '15 minutes')
        and a.titulo not ilike 'zz %'
      order by x.creado
      limit greatest(1, least(coalesce(p_cuantas, 5), 20))
      for update of x skip locked)
  returning f.*;
$$;
revoke execute on function public.drive_tomar(int) from public, anon, authenticated;
grant execute on function public.drive_tomar(int) to service_role;

-- Originales que se pueden borrar de la app: ya están en Drive y tienen la versión de 1600 px. Las más viejas primero.
create or replace function public.liberables(p_cuantas int) returns setof public.fotos
language sql stable security definer set search_path = ''
as $$
  select * from public.fotos
   where drive_id is not null and not liberada and media is not null
   order by creado
   limit greatest(1, least(coalesce(p_cuantas, 20), 100));
$$;
revoke execute on function public.liberables(int) from public, anon, authenticated;
grant execute on function public.liberables(int) to service_role;

-- ---- Llamar a la Edge Function avisos (la usan el trigger y el cron; la Task 6 la reusa) ----
-- Secretos en Vault con nombre 'avisos_*' (el de cron: 'avisos_cron_secret'). Solo para service_role.
create or replace function public.avisos_config() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_object_agg(s.name, s.decrypted_secret), '{}'::jsonb)
    from vault.decrypted_secrets s where s.name like 'avisos\_%';
$$;
revoke execute on function public.avisos_config() from public, anon, authenticated;
grant execute on function public.avisos_config() to service_role;

create or replace function public.avisos_llamar(p_body jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare secreto text;
begin
  select s.decrypted_secret into secreto from vault.decrypted_secrets s where s.name = 'avisos_cron_secret';
  if secreto is null or secreto = '' then
    return; -- sin secreto cargado no se llama (la función respondería 401)
  end if;
  perform net.http_post(
    url := 'https://qvezbnkrfqewanlcejha.supabase.co/functions/v1/avisos',
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secreto),
    timeout_milliseconds := 5000);
end;
$$;
revoke execute on function public.avisos_llamar(jsonb) from public, anon, authenticated;

-- Foto nueva → que la Edge Function la suba a Drive ya. Nunca bloquea el insert.
create or replace function public.fotos_a_drive() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  begin
    perform public.avisos_llamar(jsonb_build_object('tipo', 'drive'));
  exception when others then
    raise warning 'fotos_a_drive: %', sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.fotos_a_drive() from public, anon, authenticated;
drop trigger if exists fotos_a_drive on public.fotos;
create trigger fotos_a_drive after insert on public.fotos
  for each statement execute function public.fotos_a_drive();
