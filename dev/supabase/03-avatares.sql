-- Fotos 512x512 en WebP; si el navegador no sabe codificar WebP (Safari), el cliente sube JPEG a la misma ruta.
-- Bucket de fotos de perfil. Lectura pública por URL (las <img> no mandan token; la ruta lleva el uid, que no se adivina).
-- Escritura solo en la carpeta propia (<uid>/avatar.webp), solo miembros con sesión.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatares', 'avatares', true, 1048576, array['image/webp','image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/webp','image/jpeg'];

drop policy if exists avatares_insert on storage.objects;
create policy avatares_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatares' and name = (select auth.uid())::text || '/avatar.webp');
drop policy if exists avatares_update on storage.objects;
create policy avatares_update on storage.objects for update to authenticated
  using (bucket_id = 'avatares' and name = (select auth.uid())::text || '/avatar.webp')
  with check (bucket_id = 'avatares' and name = (select auth.uid())::text || '/avatar.webp');
drop policy if exists avatares_delete on storage.objects;
create policy avatares_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatares' and name = (select auth.uid())::text || '/avatar.webp');
drop policy if exists avatares_select on storage.objects;
create policy avatares_select on storage.objects for select to authenticated
  using (bucket_id = 'avatares' and public.es_miembro());
