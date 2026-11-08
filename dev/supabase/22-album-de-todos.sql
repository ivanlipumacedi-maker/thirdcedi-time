-- 22: álbum "de todos". La cámara de la barra de abajo se abre siempre, sin elegir actividad: lo que se saca así va a
-- un álbum que ven y usan todos los miembros activos (y a Drive, en la carpeta "Fotos de todos").
-- * El álbum de todos es un id fijo: 00000000-0000-4000-8000-000000000000 (public.album_todos()). No es una actividad:
--   fotos.actividad deja de ser FK y lo valida un trigger (una actividad que exista, o el álbum de todos). Al borrar
--   una actividad se borran sus fotos con otro trigger (como hacía el "on delete cascade").
-- * public.en_album(<id como texto>): el álbum de todos → es_miembro(); una actividad → en_sala('act:<id>') como siempre.
--   La usan las policies de fotos y del bucket 'album' (antes llamaban a en_sala). en_sala NO cambia: no aparece un
--   chat "de todos" ni cambia nada del chat.
-- * drive_tomar: toma también las del álbum de todos (left join); las de prueba se reconocen por el creador de la
--   actividad o, en el álbum de todos, por el autor (cuentas zz-prueba-*).
-- Prueba: dev/tests/album-todos-rls.sql (MCP supabase-thirdcedi; termina con "RESULTADO" y deshace todo).

create or replace function public.album_todos() returns uuid
language sql immutable set search_path = ''
as $$ select '00000000-0000-4000-8000-000000000000'::uuid $$;
revoke execute on function public.album_todos() from public, anon;
grant execute on function public.album_todos() to authenticated, service_role;

create or replace function public.en_album(p_album text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when p_album is null or (select auth.uid()) is null then false
    when p_album = '00000000-0000-4000-8000-000000000000' then public.es_miembro()
    else public.en_sala('act:' || p_album)
  end
$$;
revoke execute on function public.en_album(text) from public, anon;
grant execute on function public.en_album(text) to authenticated;

-- ---- fotos.actividad: una actividad que exista o el álbum de todos ----
alter table public.fotos drop constraint if exists fotos_actividad_fkey;

create or replace function public.fotos_actividad_valida() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.actividad <> public.album_todos() and not exists (select 1 from public.actividades a where a.id = new.actividad) then
    raise exception using errcode = '23503', message = 'la actividad de la foto no existe';
  end if;
  return new;
end;
$$;
revoke execute on function public.fotos_actividad_valida() from public, anon, authenticated;
drop trigger if exists fotos_actividad_valida on public.fotos;
create trigger fotos_actividad_valida before insert or update of actividad on public.fotos
  for each row execute function public.fotos_actividad_valida();

create or replace function public.actividades_borrar_fotos() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.fotos f where f.actividad = old.id;
  return old;
end;
$$;
revoke execute on function public.actividades_borrar_fotos() from public, anon, authenticated;
drop trigger if exists actividades_borrar_fotos on public.actividades;
create trigger actividades_borrar_fotos after delete on public.actividades
  for each row execute function public.actividades_borrar_fotos();

-- ---- Policies de fotos: en_album en lugar de en_sala ----
alter policy fotos_select on public.fotos using (public.es_miembro() and public.en_album(actividad::text));
alter policy fotos_insert on public.fotos with check (public.es_miembro() and autor = (select auth.uid()) and public.en_album(actividad::text));
alter policy fotos_delete on public.fotos using (public.es_miembro() and autor = (select auth.uid()) and public.en_album(actividad::text));

-- ---- Bucket album: lo mismo (la carpeta es el álbum) ----
alter policy album_select on storage.objects using (
  bucket_id = 'album' and public.es_miembro() and public.en_album((storage.foldername(name))[1]));
alter policy album_insert on storage.objects with check (
  bucket_id = 'album'
  and public.es_miembro()
  and array_length(storage.foldername(name), 1) = 1
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|t\.webp|m\.jpg|mp4|webm)$'
  and public.en_album((storage.foldername(name))[1]));
alter policy album_update on storage.objects
  using (bucket_id = 'album' and owner_id = (select auth.uid())::text and public.en_album((storage.foldername(name))[1]))
  with check (
    bucket_id = 'album' and owner_id = (select auth.uid())::text
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|t\.webp|m\.jpg|mp4|webm)$'
    and public.en_album((storage.foldername(name))[1]));
alter policy album_delete on storage.objects using (
  bucket_id = 'album' and owner_id = (select auth.uid())::text and public.en_album((storage.foldername(name))[1]));

-- ---- Drive: también las del álbum de todos ----
create or replace function public.drive_tomar(p_cuantas integer)
 returns setof public.fotos
 language sql
 security definer
 set search_path to ''
as $function$
  update public.fotos f set drive_tomado = now(), drive_intentos = f.drive_intentos + 1
   where f.id in (
     select x.id from public.fotos x left join public.actividades a on a.id = x.actividad
      where x.drive_id is null and not x.liberada
        and (a.id is not null or x.actividad = public.album_todos())
        and x.drive_intentos < 8
        and x.drive_error is distinct from 'muy grande para Drive'
        and (x.drive_tomado is null
             or x.drive_tomado < now() - interval '15 minutes' * power(2, greatest(x.drive_intentos - 1, 0)))
        and not exists (select 1 from auth.users u where u.id = coalesce(a.creador, x.autor) and u.email ilike 'zz-prueba-%@cedi.com.ar')
      order by x.creado
      limit greatest(1, least(coalesce(p_cuantas, 5), 20))
      for update of x skip locked)
  returning f.*;
$function$;
revoke execute on function public.drive_tomar(int) from public, anon, authenticated;
grant execute on function public.drive_tomar(int) to service_role;
