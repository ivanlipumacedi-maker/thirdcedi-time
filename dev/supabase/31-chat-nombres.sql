-- 31: el bucket 'chat' solo acepta los nombres que arma la app (como ya pasa en 'album'):
--   <sala>/fotos/<uuid>.webp (+ .t.webp), <sala>/audios/<uuid>.<webm|ogg|m4a>, <sala>/videos/<uuid>.<mp4|webm> (+ .t.webp)
--   con <sala> = act:<uuid> o par:<uuid>, y la biblioteca stickers/<uuid>.webp (hasta 1 MB si viene el tamaño).
-- Antes, dentro de una sala propia se podía subir cualquier nombre en fotos/audios/videos.
drop policy if exists chat_insert on storage.objects;
create policy chat_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'chat' and public.es_miembro() and (
    (name ~ '^(act|par):[0-9a-f-]{36}/(fotos/[0-9a-f-]{36}\.(t\.)?webp|audios/[0-9a-f-]{36}\.(webm|ogg|m4a)|videos/[0-9a-f-]{36}\.(mp4|webm|t\.webp))$'
      and public.en_sala((storage.foldername(name))[1]))
    or (name ~ '^stickers/[0-9a-f-]{36}\.webp$' and coalesce((metadata->>'size')::bigint, 0) <= 1048576)));
