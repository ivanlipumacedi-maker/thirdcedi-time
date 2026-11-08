-- Prueba de la migración 22 (álbum de todos) contra el proyecto real, sin cuentas de prueba. No es migración: se corre
-- con el MCP supabase-thirdcedi (execute_sql) o en el SQL Editor. Todo pasa dentro de un bloque DO que termina SIEMPRE
-- con el error "RESULTADO: {...}": así se deshace todo. Toma como "yo" al primer miembro activo, con sus RLS.
-- Mirar en el JSON del mensaje: "fallas" tiene que venir vacío.
-- Verifica: un miembro activo sube y ve fotos del álbum de todos (tabla y bucket) sin estar en ninguna actividad;
-- una actividad ajena sigue cerrada; una actividad que no existe se rechaza; un miembro dado de baja no ve el álbum de
-- todos; borrar una actividad borra sus fotos; drive_tomar toma la del álbum de todos; en_sala no cambió.
do $$
declare
  yo uuid; G uuid := '00000000-0000-4000-8000-000000000000'; f1 uuid := gen_random_uuid(); f2 uuid := gen_random_uuid();
  act uuid; n int; fallas text[] := '{}'; ok boolean;
begin
  select p.id into yo from public.perfiles p join auth.users u on u.id = p.id where p.activo order by u.created_at limit 1;
  if yo is null then raise exception 'no hay miembros activos'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', yo, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  if not public.en_album(G::text) then fallas := fallas || 'en_album(todos) da falso para un miembro activo'; end if;
  if public.en_sala('act:' || G) then fallas := fallas || 'en_sala cambió: da verdadero para el álbum de todos'; end if;

  -- subir una foto al álbum de todos (fila y archivos)
  begin
    insert into public.fotos (id, actividad, ruta, mini, media, ancho, alto, bytes)
      values (f1, G, G || '/' || f1 || '.jpg', G || '/' || f1 || '.t.webp', G || '/' || f1 || '.m.jpg', 4080, 2295, 1800000);
  exception when others then fallas := fallas || ('foto en el álbum de todos rechazada: ' || sqlerrm); end;
  begin
    insert into storage.objects (bucket_id, name, owner_id) values ('album', G || '/' || f1 || '.jpg', yo::text);
  exception when others then fallas := fallas || ('storage del álbum de todos rechazado: ' || sqlerrm); end;
  select count(*) into n from public.fotos where id = f1;
  if n <> 1 then fallas := fallas || 'no veo mi foto del álbum de todos'; end if;
  select count(*) into n from storage.objects where bucket_id = 'album' and name = G || '/' || f1 || '.jpg';
  if n <> 1 then fallas := fallas || 'no veo el archivo del álbum de todos'; end if;

  -- una actividad que no existe: rechazada (antes lo hacía la FK)
  ok := false;
  declare x uuid := gen_random_uuid(); begin
    insert into public.fotos (id, actividad, ruta, mini) values (f2, x, x || '/' || f2 || '.jpg', x || '/' || f2 || '.t.webp');
  exception when others then ok := true; end;
  if not ok then fallas := fallas || 'entró una foto de una actividad que no existe'; end if;

  -- una actividad en la que no estoy: sigue cerrada (tabla y bucket)
  insert into public.actividades (tipo, titulo, fecha, lugar) values ('asado', 'zz prueba album todos', now() + interval '1 day', 'Quincho') returning id into act;
  ok := false;
  begin
    insert into public.fotos (id, actividad, ruta, mini) values (f2, act, act || '/' || f2 || '.jpg', act || '/' || f2 || '.t.webp');
  exception when others then ok := true; end;
  if not ok then fallas := fallas || 'entró una foto en una actividad en la que no estoy'; end if;
  ok := false;
  begin
    insert into storage.objects (bucket_id, name, owner_id) values ('album', act || '/' || f2 || '.jpg', yo::text);
  exception when others then ok := true; end;
  if not ok then fallas := fallas || 'storage: entró un archivo en una actividad en la que no estoy'; end if;

  -- anotado, sí; y al borrar la actividad se van sus fotos
  insert into public.asistencias (actividad, parte) values (act, 'actividad');
  begin
    insert into public.fotos (id, actividad, ruta, mini) values (f2, act, act || '/' || f2 || '.jpg', act || '/' || f2 || '.t.webp');
  exception when others then fallas := fallas || ('foto en mi actividad rechazada: ' || sqlerrm); end;
  execute 'reset role';
  delete from public.actividades where id = act;
  select count(*) into n from public.fotos where id = f2;
  if n <> 0 then fallas := fallas || 'borrar la actividad no borró su foto'; end if;

  -- drive_tomar (service_role) toma la del álbum de todos
  select count(*) into n from public.drive_tomar(20) t where t.id = f1;
  if n <> 1 then fallas := fallas || 'drive_tomar no tomó la foto del álbum de todos'; end if;

  -- dado de baja: no ve el álbum de todos
  update public.perfiles set activo = false where id = yo;
  perform set_config('request.jwt.claims', json_build_object('sub', yo, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.fotos where id = f1;
  if n <> 0 then fallas := fallas || 'dado de baja: todavía ve el álbum de todos'; end if;
  if public.en_album(G::text) then fallas := fallas || 'dado de baja: en_album(todos) da verdadero'; end if;
  execute 'reset role';

  raise exception 'RESULTADO: %', json_build_object('fallas', fallas);
end $$;
