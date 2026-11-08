-- Videos en el álbum (la cámara ahora filma). Solo alter, create or replace y la configuración del bucket: no toca filas
-- (las columnas nuevas arrancan con su default: todas las filas que hay quedan como tipo 'foto').
--
-- * fotos.tipo ('foto' | 'video'), fotos.duracion_ms y fotos.mime (el del archivo de video, p. ej. video/mp4).
--   El cliente las puede mandar al insertar (grant de columnas, como el resto).
-- * fotos_rutas: una foto sigue siendo <actividad>/<id>.jpg con .t.webp y .m.jpg; un video es <actividad>/<id>.mp4 o
--   .webm, con miniatura .t.webp (el primer cuadro) y sin media.
-- * fotos_bytes_check: hasta 110 MB (un video pesa como mucho 100 MB, más la miniatura). Antes 50 MB.
-- * Bucket album: acepta video/mp4 y video/webm y archivos de hasta 100 MB (antes 15 MB, solo imágenes).
--   album_insert y album_update: el nombre también puede terminar en .mp4 o .webm.
-- * album_uso no cambia: ya suma todo lo que hay en Storage (espacio_proyecto), videos incluidos.
-- * Drive: drive_tomar no vuelve a tomar los videos que la función marcó 'muy grande para Drive' (más de 35 MB: el
--   Apps Script recibe el archivo en base64 y tiene un límite). liberables sigue pidiendo media (los videos no tienen),
--   así que un video nunca se libera: queda en la app aunque tenga copia en Drive. Se deja explícito con tipo = 'foto'.

alter table public.fotos add column if not exists tipo text not null default 'foto';
alter table public.fotos add column if not exists duracion_ms integer;
alter table public.fotos add column if not exists mime text;

alter table public.fotos drop constraint if exists fotos_tipo_check;
alter table public.fotos add constraint fotos_tipo_check check (
  (tipo = 'foto' and duracion_ms is null and mime is null)
  or (tipo = 'video' and duracion_ms is not null and duracion_ms between 1 and 70000 and mime is not null and mime in ('video/mp4', 'video/webm')));

alter table public.fotos drop constraint if exists fotos_rutas;
alter table public.fotos add constraint fotos_rutas check (
  mini = actividad::text || '/' || id::text || '.t.webp'
  and (
    (tipo = 'foto' and ruta = actividad::text || '/' || id::text || '.jpg'
      and (media is null or media = actividad::text || '/' || id::text || '.m.jpg'))
    or (tipo = 'video' and media is null
      and ruta = actividad::text || '/' || id::text || case mime when 'video/mp4' then '.mp4' else '.webm' end)));

alter table public.fotos drop constraint if exists fotos_bytes_check;
alter table public.fotos add constraint fotos_bytes_check check (bytes >= 0 and bytes <= 110000000);

grant insert (tipo, duracion_ms, mime) on public.fotos to authenticated;

update storage.buckets
   set file_size_limit = 104857600,
       allowed_mime_types = array['image/jpeg', 'image/webp', 'video/mp4', 'video/webm']
 where id = 'album';

alter policy album_insert on storage.objects with check (
  bucket_id = 'album'
  and public.es_miembro()
  and array_length(storage.foldername(name), 1) = 1
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|t\.webp|m\.jpg|mp4|webm)$'
  and public.en_sala('act:' || (storage.foldername(name))[1]));

alter policy album_update on storage.objects with check (
  bucket_id = 'album'
  and owner_id = (select auth.uid())::text
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|t\.webp|m\.jpg|mp4|webm)$'
  and public.en_sala('act:' || (storage.foldername(name))[1]));

create or replace function public.drive_tomar(p_cuantas integer)
 returns setof public.fotos
 language sql
 security definer
 set search_path to ''
as $function$
  update public.fotos f set drive_tomado = now(), drive_intentos = f.drive_intentos + 1
   where f.id in (
     select x.id from public.fotos x join public.actividades a on a.id = x.actividad
      where x.drive_id is null and not x.liberada
        and x.drive_intentos < 8
        and x.drive_error is distinct from 'muy grande para Drive'
        and (x.drive_tomado is null
             or x.drive_tomado < now() - interval '15 minutes' * power(2, greatest(x.drive_intentos - 1, 0)))
        and not exists (select 1 from auth.users u where u.id = a.creador and u.email ilike 'zz-prueba-%@cedi.com.ar')
      order by x.creado
      limit greatest(1, least(coalesce(p_cuantas, 5), 20))
      for update of x skip locked)
  returning f.*;
$function$;

create or replace function public.liberables(p_cuantas integer)
 returns setof public.fotos
 language sql
 stable security definer
 set search_path to ''
as $function$
  select * from public.fotos
   where tipo = 'foto' and drive_id is not null and not liberada and media is not null
   order by creado
   limit greatest(1, least(coalesce(p_cuantas, 20), 100));
$function$;
