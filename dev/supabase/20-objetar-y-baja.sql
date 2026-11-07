-- Cuentas claras: poder objetar, y dar de baja a un miembro sin borrar nada. Solo crea, reemplaza o agrega: no toca
-- filas (la columna nueva entra con su default en las filas que ya están).
-- - gastos_delete: además de quien lo cargó, lo puede borrar quien pagó y cualquiera que esté en el reparto
--   (figura_en_gasto). pagos_delete: además de quien lo cargó, la otra parte (de o a). Siempre con es_miembro().
-- - perfiles.activo (default true). es_miembro() exige activo: una persona dada de baja no lee ni escribe nada de
--   nadie (todas las RLS y RPC pasan por es_miembro, o por en_cuentas, que también lo exige). Sigue leyendo su propio
--   perfil (perfiles_select: id = auth.uid()) para que la app le diga que está dada de baja.
-- - Lo que antes no pasaba por es_miembro y es una escritura: actividades_update (editar o cancelar las propias),
--   perfiles_update (nombre y foto) y avatares_insert/update (subir foto) ahora lo exigen. Irse (asistencias_delete,
--   salir_partida), borrar lo propio de los buckets y push_subs_borrar quedan igual: solo sacan cosas propias.
-- - El cliente no toca activo: el update sigue siendo solo de (nombre, foto) y el insert pasa a ser por columnas
--   (id, nombre, empresa, foto). Lo cambia Ivan con SQL (ver CLAUDE.md).
-- - Trigger perfiles_baja: cuando activo pasa a false, borra sus push_subs y lo saca de las partidas en espera
--   (si era el creador de una, la partida se cancela como en salir_partida).

-- ---- Baja de miembros ----
alter table public.perfiles add column if not exists activo boolean not null default true;

create or replace function public.es_miembro() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.perfiles where id = (select auth.uid()) and activo); $$;
revoke execute on function public.es_miembro() from public, anon;
grant execute on function public.es_miembro() to authenticated;

revoke insert on public.perfiles from authenticated;
grant insert (id, nombre, empresa, foto) on public.perfiles to authenticated;
revoke update on public.perfiles from authenticated;
grant update (nombre, foto) on public.perfiles to authenticated;

drop policy if exists perfiles_update on public.perfiles;
create policy perfiles_update on public.perfiles for update to authenticated
  using (public.es_miembro() and id = (select auth.uid()))
  with check (public.es_miembro() and id = (select auth.uid()));

drop policy if exists actividades_update on public.actividades;
create policy actividades_update on public.actividades for update to authenticated
  using (public.es_miembro() and creador = (select auth.uid()))
  with check (public.es_miembro() and creador = (select auth.uid()));

drop policy if exists avatares_insert on storage.objects;
create policy avatares_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatares' and public.es_miembro() and name = (select auth.uid())::text || '/avatar');
drop policy if exists avatares_update on storage.objects;
create policy avatares_update on storage.objects for update to authenticated
  using (bucket_id = 'avatares' and public.es_miembro() and name = (select auth.uid())::text || '/avatar')
  with check (bucket_id = 'avatares' and public.es_miembro() and name = (select auth.uid())::text || '/avatar');

create or replace function public.perfiles_baja() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare p uuid;
begin
  delete from public.push_subs s where s.persona = new.id;
  -- las partidas en espera que creó se cancelan (igual que si saliera con salir_partida)
  for p in select x.id from public.partidas x where x.creador = new.id and x.estado = 'espera' loop
    update public.partidas x set estado = 'terminada', estado_juego = jsonb_build_object('fase', 'cancelada', 'ahora_ms', public.ahora_ms())
     where x.id = p;
    perform public.juegos_avisar_lista(p);
  end loop;
  delete from public.jugadores j
   using public.partidas x
   where x.id = j.partida and x.estado = 'espera' and j.persona = new.id;
  return null;
end;
$$;
revoke execute on function public.perfiles_baja() from public, anon, authenticated;

drop trigger if exists perfiles_baja on public.perfiles;
create trigger perfiles_baja after update of activo on public.perfiles
  for each row when (old.activo and not new.activo)
  execute function public.perfiles_baja();

-- ---- Objetar en Cuentas claras ----
-- ¿Figuro en este gasto (lo pagué o estoy en el reparto)? SECURITY DEFINER para no depender de las RLS de
-- gasto_partes adentro de la policy. Solo responde por uno mismo.
create or replace function public.figura_en_gasto(p_gasto uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_gasto is not null and (select auth.uid()) is not null and exists (
    select 1 from public.gastos g
     where g.id = p_gasto
       and (g.pagador = (select auth.uid())
            or exists (select 1 from public.gasto_partes gp where gp.gasto = g.id and gp.persona = (select auth.uid())))
  );
$$;
revoke execute on function public.figura_en_gasto(uuid) from public, anon;
grant execute on function public.figura_en_gasto(uuid) to authenticated;

drop policy if exists gastos_delete on public.gastos;
create policy gastos_delete on public.gastos for delete to authenticated
  using (public.es_miembro() and (cargado_por = (select auth.uid()) or public.figura_en_gasto(id)));

drop policy if exists pagos_delete on public.pagos;
create policy pagos_delete on public.pagos for delete to authenticated
  using (public.es_miembro() and (cargado_por = (select auth.uid()) or de = (select auth.uid()) or a = (select auth.uid())));
