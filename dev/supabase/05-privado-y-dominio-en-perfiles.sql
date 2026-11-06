-- Ronda de arreglos: bucket avatares PRIVADO (lectura solo para miembros, con URLs firmadas),
-- ruta neutra <uid>/avatar (puede ser WebP o JPEG), y perfiles atado al mail del JWT.

-- 1) Bucket privado y policies con la ruta nueva.
update storage.buckets set public = false where id = 'avatares';

drop policy if exists avatares_insert on storage.objects;
create policy avatares_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatares' and name = (select auth.uid())::text || '/avatar');
drop policy if exists avatares_update on storage.objects;
create policy avatares_update on storage.objects for update to authenticated
  using (bucket_id = 'avatares' and name = (select auth.uid())::text || '/avatar')
  with check (bucket_id = 'avatares' and name = (select auth.uid())::text || '/avatar');
drop policy if exists avatares_delete on storage.objects;
create policy avatares_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatares' and name = (select auth.uid())::text || '/avatar');
-- avatares_select (es_miembro) queda como estaba.

-- 2) El alta de perfil exige que el dominio del mail del JWT sea del grupo y que la empresa coincida con ese dominio.
drop policy if exists perfiles_insert on public.perfiles;
create policy perfiles_insert on public.perfiles for insert to authenticated
  with check (
    id = (select auth.uid())
    and empresa = case split_part(lower(coalesce((select auth.jwt()) ->> 'email', '')), '@', 2)
      when 'cedi.com.ar' then 'CEDI'
      when 'wemox.com.ar' then 'Wemox'
      when 'piconsulting.com.ar' then 'Pi Consulting'
      when 'vulps.com.ar' then 'Vulps'
      when 'korex.com.ar' then 'Korex'
    end
  );
-- (si el dominio no está en la lista, el CASE da NULL y el check falla)

-- 3) UPDATE solo de nombre y foto: id, empresa y creado no se tocan.
revoke update on public.perfiles from authenticated;
grant update (nombre, foto) on public.perfiles to authenticated;
