-- Prueba de la baja de miembros (20-objetar-y-baja.sql) con zz-prueba-c, contra el proyecto real. No es migración:
-- se corre con el MCP supabase-thirdcedi (execute_sql) o en el SQL Editor. Todo pasa dentro de un bloque DO que
-- termina SIEMPRE con un error "RESULTADO: {...}": así se deshace todo (C vuelve a quedar activo, sin partidas ni
-- suscripciones nuevas). Mirar en el JSON del mensaje: "fallas" tiene que venir vacío.
-- Verifica: activo como C ve actividades y perfiles; al darlo de baja el trigger borra sus push_subs, cancela la
-- partida en espera que creó y lo saca de la que se unió; inactivo, es_miembro() da false, no ve actividades ni
-- perfiles ajenos (sí el propio), no cambia su nombre, no toca activo ni crea partidas; al reactivarlo vuelve todo.
do $$
declare
  ua uuid; ub uuid; uc uuid;
  act uuid; p1 uuid; p2 uuid;
  n_act0 int; n_perf0 int; n int; b boolean;
  fallas text[] := '{}';
  como text;
begin
  select id into ua from auth.users where email = 'zz-prueba-a@cedi.com.ar';
  select id into ub from auth.users where email = 'zz-prueba-b@cedi.com.ar';
  select id into uc from auth.users where email = 'zz-prueba-c@cedi.com.ar';
  if ua is null or ub is null or uc is null then raise exception 'faltan los usuarios zz-prueba'; end if;

  -- ---- Preparación (como cada uno, con sus RLS) ----
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.actividades (tipo, titulo, fecha, lugar) values ('asado', 'zz prueba baja', now() + interval '1 day', 'Quincho de prueba') returning id into act;
  p2 := public.crear_partida('trivia');
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n_act0 from public.actividades;
  select count(*) into n_perf0 from public.perfiles;
  if n_act0 < 1 then fallas := fallas || 'activo: C no ve actividades'; end if;
  if n_perf0 < 3 then fallas := fallas || ('activo: C ve ' || n_perf0 || ' perfiles'); end if;
  p1 := public.crear_partida('trivia');
  perform public.unirse_partida(p2);
  execute 'reset role';

  insert into public.push_subs (endpoint, persona, p256dh, auth) values ('https://fcm.googleapis.com/fcm/send/zz-prueba-baja', uc, 'x', 'x');

  -- ---- Baja ----
  update public.perfiles set activo = false where id = uc;
  select count(*) into n from public.push_subs where persona = uc;
  if n <> 0 then fallas := fallas || 'trigger: quedaron push_subs'; end if;
  select count(*) into n from public.partidas where id = p1 and estado = 'terminada' and estado_juego->>'fase' = 'cancelada';
  if n <> 1 then fallas := fallas || 'trigger: la partida que creó C no se canceló'; end if;
  select count(*) into n from public.jugadores where partida = p2 and persona = uc;
  if n <> 0 then fallas := fallas || 'trigger: C sigue en la partida de A'; end if;
  select count(*) into n from public.jugadores where partida = p2 and persona = ua;
  if n <> 1 then fallas := fallas || 'trigger: sacó a A de su partida'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if public.es_miembro() then fallas := fallas || 'inactivo: es_miembro() da true'; end if;
  select count(*) into n from public.actividades;
  if n <> 0 then fallas := fallas || ('inactivo: ve ' || n || ' actividades'); end if;
  select count(*) into n from public.perfiles where id <> uc;
  if n <> 0 then fallas := fallas || ('inactivo: ve ' || n || ' perfiles ajenos'); end if;
  select count(*) into n from public.perfiles where id = uc;
  if n <> 1 then fallas := fallas || 'inactivo: no ve su propio perfil (la app no podría avisarle)'; end if;
  select count(*) into n from public.partidas;
  if n <> 0 then fallas := fallas || ('inactivo: ve ' || n || ' partidas'); end if;
  update public.perfiles set nombre = 'zz cambiado' where id = uc;
  get diagnostics n = row_count;
  if n <> 0 then fallas := fallas || 'inactivo: cambió su nombre'; end if;
  update public.actividades set titulo = 'zz cambiado' where id = act;
  get diagnostics n = row_count;
  if n <> 0 then fallas := fallas || 'inactivo: editó una actividad'; end if;
  begin
    update public.perfiles set activo = true where id = uc;
    fallas := fallas || 'inactivo: se reactivó solo';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.crear_partida('trivia');
    fallas := fallas || 'inactivo: creó una partida';
  exception when others then null;
  end;
  execute 'reset role';

  -- el cliente activo tampoco toca activo (ni de otro ni propio)
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    update public.perfiles set activo = false where id = ub;
    fallas := fallas || 'B pudo cambiar su activo';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';

  -- ---- Reactivación ----
  update public.perfiles set activo = true where id = uc;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if not public.es_miembro() then fallas := fallas || 'reactivado: es_miembro() da false'; end if;
  select count(*) into n from public.actividades;
  if n <> n_act0 then fallas := fallas || ('reactivado: ve ' || n || ' actividades, antes ' || n_act0); end if;
  select count(*) into n from public.perfiles;
  if n <> n_perf0 then fallas := fallas || ('reactivado: ve ' || n || ' perfiles, antes ' || n_perf0); end if;
  execute 'reset role';

  raise exception 'RESULTADO: %', json_build_object('fallas', fallas, 'actividades_vistas', n_act0, 'perfiles_vistos', n_perf0);
end;
$$;
