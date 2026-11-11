-- 28: la carpeta stickers/ del bucket 'chat' solo acepta stickers (stickers/<uuid>.webp, el mismo nombre que exige la
-- tabla stickers) y de hasta 1 MB. Antes aceptaba cualquier tipo del bucket de hasta 100 MB.
drop policy if exists chat_insert on storage.objects;
create policy chat_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'chat' and public.es_miembro() and (
    ((storage.foldername(name))[2] in ('fotos','audios','videos') and public.en_sala((storage.foldername(name))[1]))
    or (name ~ '^stickers/[0-9a-f-]{36}\.webp$' and coalesce((metadata->>'size')::bigint, 0) <= 1048576)));
