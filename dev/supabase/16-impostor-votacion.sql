-- El Impostor: arreglos de la review de la Task 8. Solo reemplaza dos funciones internas de la 14 (misma firma,
-- SECURITY DEFINER, search_path = '' y sin execute para nadie). No toca filas.
--
-- 1) impostor_avanzar: el creador ya no puede cerrar la votación cuando quiere. Antes, con r.creador = p_uid se
--    salteaban el tiempo y el "votaron todos", así que podía cerrarla con 0 o 1 voto (o justo en un empate) y
--    hacer ganar al impostor. Ahora su privilegio vale solo para palabra → pistas y pistas → votación; para
--    votación → final necesita, como cualquiera, que haya vencido el tiempo o que hayan votado todos los activos.
-- 2) impostor_arrancar: la mitad de las veces se invierte el par del banco (el grupo recibe la columna impostor y el
--    impostor la palabra). Así buscar la propia palabra en el banco (contenido/palabras.js) no revela el rol.

create or replace function public.impostor_arrancar(p_partida uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_par public.impostor_palabras;
  v_palabra text;
  v_otra text;
  v_imp uuid;
  v_orden jsonb;
  t bigint := public.ahora_ms();
begin
  select w.* into v_par from public.impostor_palabras w order by random() limit 1;
  if v_par.palabra is null then
    raise exception 'No hay palabras cargadas' using errcode = 'P0001';
  end if;
  -- el par al derecho o al revés, al azar
  if random() < 0.5 then
    v_palabra := v_par.palabra; v_otra := v_par.impostor;
  else
    v_palabra := v_par.impostor; v_otra := v_par.palabra;
  end if;
  select j.persona into v_imp from public.jugadores j where j.partida = p_partida and not j.se_fue order by random() limit 1;
  select jsonb_agg(j.persona order by random()) into v_orden from public.jugadores j where j.partida = p_partida and not j.se_fue;
  insert into public.impostor_secretos (partida, impostor, palabra, palabra_impostor)
  values (p_partida, v_imp, v_palabra, v_otra)
  on conflict (partida) do update set impostor = excluded.impostor, palabra = excluded.palabra, palabra_impostor = excluded.palabra_impostor;
  update public.partidas x set estado = 'jugando',
         estado_juego = jsonb_build_object('fase', 'palabra', 'ronda', 1, 'orden', v_orden, 'inicio_ms', t,
                                           'limite_ms', t + 10000, 'ahora_ms', t, 'votaron', '[]'::jsonb)
   where x.id = p_partida;
end;
$$;
revoke execute on function public.impostor_arrancar(uuid) from public, anon, authenticated;

create or replace function public.impostor_avanzar(p_partida uuid, p_uid uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.partidas;
  e jsonb;
  v_activos int;
  vencido boolean;
begin
  select x.* into r from public.partidas x where x.id = p_partida;
  e := r.estado_juego;
  vencido := public.ahora_ms() >= coalesce((e->>'limite_ms')::bigint, 0);
  select count(*) into v_activos from public.jugadores j where j.partida = p_partida and not j.se_fue;
  if e->>'fase' = 'votacion' then
    -- cerrar la votación: para todos (el creador incluido) hace falta el tiempo vencido o que hayan votado todos
    if not vencido and public.impostor_votaron(p_partida) < v_activos then
      raise exception 'Todavía no: falta que voten todos o que se termine el tiempo' using errcode = 'P0001';
    end if;
  elsif r.creador <> p_uid and not vencido then
    raise exception 'Todavía no: falta que se termine el tiempo o que avance quien armó la partida' using errcode = 'P0001';
  end if;
  if e->>'fase' = 'palabra' then
    perform public.impostor_fase(p_partida, 'pistas', 120000);
  elsif e->>'fase' = 'pistas' then
    perform public.impostor_fase(p_partida, 'votacion', 60000);
  elsif e->>'fase' = 'votacion' then
    perform public.impostor_terminar(p_partida, 'votacion');
  end if;
end;
$$;
revoke execute on function public.impostor_avanzar(uuid, uuid) from public, anon, authenticated;
