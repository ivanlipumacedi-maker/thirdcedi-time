-- Test de la 25 (links de Maps solo para el organizador y los anotados). Se corre con el MCP supabase-thirdcedi.
-- Crea una actividad zz dentro de la transacción y termina SIEMPRE con el error "RESULTADO: {...}", que deshace todo.
-- Esperado: organizador_ve 1, check_redirector rechazado, no_anotado_ve 0, no_anotado_escribe rechazado,
-- anotado_ve 1, anotado_edita 0, cancelada_edita 0. Necesita 3 perfiles activos.
do $$
declare act uuid; org uuid; otro uuid; anot uuid; r jsonb := '{}'; n int;
begin
  select id into org from public.perfiles where activo order by id limit 1;
  select id into otro from public.perfiles where activo and id <> org order by id limit 1;
  select id into anot from public.perfiles where activo and id not in (org, otro) order by id limit 1;
  insert into public.actividades (creador, tipo, titulo, fecha, lugar) values (org, 'asado', 'zz prueba links', now() + interval '2 days', 'Casa de prueba') returning id into act;
  insert into public.asistencias (actividad, persona, parte) values (act, anot, 'actividad');

  perform set_config('request.jwt.claims', json_build_object('sub', org, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.actividades_links (actividad, lugar_link) values (act, 'https://maps.app.goo.gl/zzPrueba')
    on conflict (actividad) do update set lugar_link = excluded.lugar_link;
  select count(*) into n from public.actividades_links where actividad = act; r := r || jsonb_build_object('organizador_ve', n);
  begin
    update public.actividades_links set lugar_link = 'https://www.google.com/url?q=https://evil.com' where actividad = act;
    r := r || '{"check_redirector":"PASO (mal)"}';
  exception when check_violation then r := r || '{"check_redirector":"rechazado"}'; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', otro, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.actividades_links where actividad = act; r := r || jsonb_build_object('no_anotado_ve', n);
  begin
    insert into public.actividades_links (actividad, lugar_link) values (act, 'https://maps.app.goo.gl/otro')
      on conflict (actividad) do update set lugar_link = excluded.lugar_link;
    r := r || '{"no_anotado_escribe":"PASO (mal)"}';
  exception when insufficient_privilege then r := r || '{"no_anotado_escribe":"rechazado"}'; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', anot, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.actividades_links where actividad = act; r := r || jsonb_build_object('anotado_ve', n);
  update public.actividades_links set lugar_link = null where actividad = act;
  get diagnostics n = row_count; r := r || jsonb_build_object('anotado_edita', n);
  execute 'reset role';

  update public.actividades set estado = 'cancelada' where id = act;
  perform set_config('request.jwt.claims', json_build_object('sub', org, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.actividades_links set lugar_link = null where actividad = act;
  get diagnostics n = row_count; r := r || jsonb_build_object('cancelada_edita', n);
  execute 'reset role';
  raise exception 'RESULTADO: %', r;
end $$;
