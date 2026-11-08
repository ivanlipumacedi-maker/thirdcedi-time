-- Prueba de la migración 21 (videos en el álbum) contra el proyecto real, sin cuentas de prueba. No es migración: se
-- corre con el MCP supabase-thirdcedi (execute_sql) o en el SQL Editor. Todo pasa dentro de un bloque DO que termina
-- SIEMPRE con el error "RESULTADO: {...}": así se deshace todo (la actividad, la asistencia, las filas y los objetos de
-- prueba no quedan). Toma como "yo" al primer miembro activo, con sus RLS (role authenticated y su sub en el JWT).
-- Mirar en el JSON del mensaje: "fallas" tiene que venir vacío.
-- Verifica: fotos acepta un video .mp4/.webm con duración y mime; rechaza rutas, mimes y tamaños que no corresponden;
-- una foto sigue igual; el bucket album acepta <uuid>/<uuid>.mp4 y .webm y no .mov; el bucket tiene 100 MB y los mimes
-- de video; liberables no devuelve videos y drive_tomar no toma los 'muy grande para Drive'.
do $$
declare
  yo uuid; act uuid; v1 uuid := gen_random_uuid(); v2 uuid := gen_random_uuid(); f1 uuid := gen_random_uuid();
  n int; fallas text[] := '{}';
  ok boolean;
begin
  select p.id into yo from public.perfiles p join auth.users u on u.id = p.id where p.activo order by u.created_at limit 1;
  if yo is null then raise exception 'no hay miembros activos'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', yo, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.actividades (tipo, titulo, fecha, lugar) values ('asado', 'zz prueba videos', now() + interval '1 day', 'Quincho de prueba') returning id into act;
  insert into public.asistencias (actividad, parte) values (act, 'actividad');
  if not public.en_sala('act:' || act) then fallas := fallas || 'preparación: no quedé en la sala'; end if;

  -- un video bien formado (mp4) y otro webm
  begin
    insert into public.fotos (id, actividad, ruta, mini, ancho, alto, bytes, tipo, duracion_ms, mime)
      values (v1, act, act || '/' || v1 || '.mp4', act || '/' || v1 || '.t.webp', 1920, 1080, 90000000, 'video', 12345, 'video/mp4');
  exception when others then fallas := fallas || ('video mp4 rechazado: ' || sqlerrm); end;
  begin
    insert into public.fotos (id, actividad, ruta, mini, ancho, alto, bytes, tipo, duracion_ms, mime)
      values (v2, act, act || '/' || v2 || '.webm', act || '/' || v2 || '.t.webp', 1280, 720, 1000, 'video', 60000, 'video/webm');
  exception when others then fallas := fallas || ('video webm rechazado: ' || sqlerrm); end;
  -- una foto como siempre
  begin
    insert into public.fotos (id, actividad, ruta, mini, media, ancho, alto, bytes)
      values (f1, act, act || '/' || f1 || '.jpg', act || '/' || f1 || '.t.webp', act || '/' || f1 || '.m.jpg', 4000, 3000, 3000000);
  exception when others then fallas := fallas || ('foto rechazada: ' || sqlerrm); end;

  -- lo que no tiene que entrar
  declare x uuid; malos text[] := array[
      'video con ruta .jpg', 'video sin duración', 'video con mime raro', 'foto con mime', 'video mp4 con ruta .webm',
      'video con media', 'más de 110 MB', 'video de 2 minutos'];
    i int;
  begin
    for i in 1 .. array_length(malos, 1) loop
      x := gen_random_uuid(); ok := false;
      begin
        case i
          when 1 then insert into public.fotos (id, actividad, ruta, mini, tipo, duracion_ms, mime) values (x, act, act || '/' || x || '.jpg', act || '/' || x || '.t.webp', 'video', 1000, 'video/mp4');
          when 2 then insert into public.fotos (id, actividad, ruta, mini, tipo, mime) values (x, act, act || '/' || x || '.mp4', act || '/' || x || '.t.webp', 'video', 'video/mp4');
          when 3 then insert into public.fotos (id, actividad, ruta, mini, tipo, duracion_ms, mime) values (x, act, act || '/' || x || '.mp4', act || '/' || x || '.t.webp', 'video', 1000, 'video/quicktime');
          when 4 then insert into public.fotos (id, actividad, ruta, mini, mime) values (x, act, act || '/' || x || '.jpg', act || '/' || x || '.t.webp', 'video/mp4');
          when 5 then insert into public.fotos (id, actividad, ruta, mini, tipo, duracion_ms, mime) values (x, act, act || '/' || x || '.webm', act || '/' || x || '.t.webp', 'video', 1000, 'video/mp4');
          when 6 then insert into public.fotos (id, actividad, ruta, mini, media, tipo, duracion_ms, mime) values (x, act, act || '/' || x || '.mp4', act || '/' || x || '.t.webp', act || '/' || x || '.m.jpg', 'video', 1000, 'video/mp4');
          when 7 then insert into public.fotos (id, actividad, ruta, mini, bytes, tipo, duracion_ms, mime) values (x, act, act || '/' || x || '.mp4', act || '/' || x || '.t.webp', 120000000, 'video', 1000, 'video/mp4');
          when 8 then insert into public.fotos (id, actividad, ruta, mini, tipo, duracion_ms, mime) values (x, act, act || '/' || x || '.mp4', act || '/' || x || '.t.webp', 'video', 120000, 'video/mp4');
        end case;
      exception when others then ok := true; end;
      if not ok then fallas := fallas || ('entró: ' || malos[i]); end if;
    end loop;
  end;

  -- Storage: la policy del bucket (nombre del archivo)
  begin
    insert into storage.objects (bucket_id, name, owner_id) values ('album', act || '/' || v1 || '.mp4', yo::text);
  exception when others then fallas := fallas || ('storage .mp4 rechazado: ' || sqlerrm); end;
  begin
    insert into storage.objects (bucket_id, name, owner_id) values ('album', act || '/' || v2 || '.webm', yo::text);
  exception when others then fallas := fallas || ('storage .webm rechazado: ' || sqlerrm); end;
  ok := false;
  begin
    insert into storage.objects (bucket_id, name, owner_id) values ('album', act || '/' || gen_random_uuid() || '.mov', yo::text);
  exception when others then ok := true; end;
  if not ok then fallas := fallas || 'storage: entró un .mov'; end if;
  ok := false;
  begin
    insert into storage.objects (bucket_id, name, owner_id) values ('album', gen_random_uuid() || '/' || gen_random_uuid() || '.mp4', yo::text);
  exception when others then ok := true; end;
  if not ok then fallas := fallas || 'storage: entró un video en una actividad ajena'; end if;
  execute 'reset role';

  -- bucket
  select count(*) into n from storage.buckets where id = 'album' and file_size_limit = 104857600
    and allowed_mime_types @> array['image/jpeg', 'image/webp', 'video/mp4', 'video/webm'];
  if n <> 1 then fallas := fallas || 'bucket album: límite o mimes'; end if;

  -- Drive: un video con copia no se libera; uno muy grande no se vuelve a tomar
  update public.fotos set drive_id = 'zz' where id in (v2, f1);
  update public.fotos set drive_error = 'muy grande para Drive' where id = v1;
  if exists (select 1 from public.liberables(100) l where l.id = v2) then fallas := fallas || 'liberables devuelve un video'; end if;
  if not exists (select 1 from public.liberables(100) l where l.id = f1) then fallas := fallas || 'liberables no devuelve la foto con copia'; end if;
  if exists (select 1 from public.drive_tomar(20) d where d.id = v1) then fallas := fallas || 'drive_tomar tomó un video muy grande'; end if;

  raise exception 'RESULTADO: %', json_build_object('fallas', fallas, 'como', yo);
end $$;
