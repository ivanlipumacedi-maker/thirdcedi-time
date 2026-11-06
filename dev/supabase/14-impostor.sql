-- El Impostor: sobre las partidas de la 12 (partidas, jugadores, chat 'par:<uuid>').
-- Solo crea o reemplaza: no toca filas existentes. avanzar_partida y salir_partida se reemplazan con la MISMA firma;
-- su rama de la Trivia queda idéntica a la de la 12 y solo se suma la rama 'impostor'.
--
-- Lo secreto vive en tablas privadas (RLS sin policies y sin grants; solo las leen las funciones de acá):
-- - impostor_palabras: el banco de pares (se carga desde contenido/palabras.js con dev/tools/palabras-sql.js).
-- - impostor_secretos: de cada partida, quién es el impostor y las dos palabras.
-- impostor_votos: cada uno ve solo su voto; los de los demás aparecen recién en el estado final.
-- La palabra de cada jugador la da mi_palabra(p): devuelve solo la propia (nunca la de otro ni si sos el impostor).
--
-- La partida (estado_juego, visible para los jugadores activos; nunca trae el impostor ni las palabras):
--   { fase: 'palabra'|'pistas'|'votacion', ronda: 1, orden: [uuid], inicio_ms, limite_ms, ahora_ms, votaron: [uuid] }
--   { fase: 'final', ..., impostor, palabra, palabra_impostor, votos: {votante: votado}, conteo: {uuid: n},
--     expulsado: uuid|null, gano: 'grupo'|'impostor', motivo: 'votacion'|'se_fue_impostor'|'quedan_dos' }
-- Tiempos (los de ImpostorLogica): 10 s para leer la palabra, 120 s para las pistas (en el chat de la partida),
-- 60 s para votar (+1 s de gracia por la red). Avanza el creador cuando quiera; cualquier jugador activo cuando
-- venció el tiempo de la fase o (en la votación) cuando votaron todos. votar() cierra sola la votación con el
-- último voto. p_ronda/p_fase hacen idempotente el pedido de avanzar, como en la Trivia.
-- Resultado (ImpostorLogica.resultado): el más votado sale si es el único con más votos; empate o sin votos →
-- nadie y gana el impostor; gana el grupo solo si sale el impostor. Se cuentan los votos de los que siguen.
-- Si alguien se va a la mitad (Review Focus 5, ImpostorLogica.sigue): si es el impostor gana el grupo; si quedan
-- 2 con el impostor gana el impostor; si no, sigue (y si en la votación ya votaron todos los que quedan, se cierra).

-- ---- Tablas ----
create table if not exists public.impostor_palabras (
  palabra text primary key check (char_length(btrim(palabra)) between 1 and 60),
  impostor text not null check (char_length(btrim(impostor)) between 1 and 60),
  check (lower(btrim(palabra)) <> lower(btrim(impostor)))
);

create table if not exists public.impostor_secretos (
  partida uuid primary key references public.partidas(id) on delete cascade,
  impostor uuid not null,
  palabra text not null,
  palabra_impostor text not null
);

create table if not exists public.impostor_votos (
  partida uuid not null,
  ronda int not null check (ronda between 1 and 50),
  persona uuid not null,
  voto uuid not null,
  creado timestamptz not null default now(),
  primary key (partida, ronda, persona),
  check (voto <> persona),
  foreign key (partida, persona) references public.jugadores(partida, persona) on delete cascade,
  foreign key (partida, voto) references public.jugadores(partida, persona) on delete cascade
);
create index if not exists impostor_votos_voto_idx on public.impostor_votos (partida, voto);

alter table public.impostor_palabras enable row level security;
alter table public.impostor_secretos enable row level security;
alter table public.impostor_votos enable row level security;

drop policy if exists impostor_votos_select on public.impostor_votos;
create policy impostor_votos_select on public.impostor_votos for select to authenticated
  using (public.es_miembro() and persona = (select auth.uid()));

revoke all on public.impostor_palabras from anon, authenticated;
revoke all on public.impostor_secretos from anon, authenticated;
revoke all on public.impostor_votos from anon, authenticated;
grant select on public.impostor_votos to authenticated;

-- ---- Internas (sin execute para nadie: solo las llaman las RPC; la partida ya viene bloqueada) ----
-- Arranca: elige el par y el impostor al azar entre los activos, y el orden sugerido para las pistas.
create or replace function public.impostor_arrancar(p_partida uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_par public.impostor_palabras;
  v_imp uuid;
  v_orden jsonb;
  t bigint := public.ahora_ms();
begin
  select w.* into v_par from public.impostor_palabras w order by random() limit 1;
  if v_par.palabra is null then
    raise exception 'No hay palabras cargadas' using errcode = 'P0001';
  end if;
  select j.persona into v_imp from public.jugadores j where j.partida = p_partida and not j.se_fue order by random() limit 1;
  select jsonb_agg(j.persona order by random()) into v_orden from public.jugadores j where j.partida = p_partida and not j.se_fue;
  insert into public.impostor_secretos (partida, impostor, palabra, palabra_impostor)
  values (p_partida, v_imp, v_par.palabra, v_par.impostor)
  on conflict (partida) do update set impostor = excluded.impostor, palabra = excluded.palabra, palabra_impostor = excluded.palabra_impostor;
  update public.partidas x set estado = 'jugando',
         estado_juego = jsonb_build_object('fase', 'palabra', 'ronda', 1, 'orden', v_orden, 'inicio_ms', t,
                                           'limite_ms', t + 10000, 'ahora_ms', t, 'votaron', '[]'::jsonb)
   where x.id = p_partida;
end;
$$;
revoke execute on function public.impostor_arrancar(uuid) from public, anon, authenticated;

-- Pasa a la fase siguiente con su tiempo.
create or replace function public.impostor_fase(p_partida uuid, p_fase text, p_dur int) returns void
language plpgsql security definer set search_path = ''
as $$
declare t bigint := public.ahora_ms();
begin
  update public.partidas x
     set estado_juego = x.estado_juego || jsonb_build_object('fase', p_fase, 'inicio_ms', t, 'limite_ms', t + p_dur, 'ahora_ms', t)
   where x.id = p_partida;
end;
$$;
revoke execute on function public.impostor_fase(uuid, text, int) from public, anon, authenticated;

-- Termina y revela todo. p_motivo: 'votacion' (cuenta los votos de los que siguen), 'se_fue_impostor' o 'quedan_dos'.
create or replace function public.impostor_terminar(p_partida uuid, p_motivo text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s public.impostor_secretos;
  v_votos jsonb;
  v_conteo jsonb;
  v_exp uuid;
  v_n int;
  v_gano text;
begin
  select x.* into s from public.impostor_secretos x where x.partida = p_partida;
  select coalesce(jsonb_object_agg(v.persona::text, v.voto::text), '{}'::jsonb) into v_votos
    from public.impostor_votos v join public.jugadores j on j.partida = v.partida and j.persona = v.persona
   where v.partida = p_partida and v.ronda = 1 and not j.se_fue;
  select coalesce(jsonb_object_agg(c.voto::text, c.n), '{}'::jsonb) into v_conteo from (
    select v.voto, count(*)::int n
      from public.impostor_votos v join public.jugadores j on j.partida = v.partida and j.persona = v.persona
     where v.partida = p_partida and v.ronda = 1 and not j.se_fue
     group by v.voto) c;
  if p_motivo = 'votacion' then
    -- el más votado, si es el único con más votos (ImpostorLogica.resultado)
    with c as (
      select v.voto, count(*) n
        from public.impostor_votos v join public.jugadores j on j.partida = v.partida and j.persona = v.persona
       where v.partida = p_partida and v.ronda = 1 and not j.se_fue
       group by v.voto)
    select (array_agg(c.voto))[1], count(*) into v_exp, v_n from c where c.n = (select max(c2.n) from c c2);
    if coalesce(v_n, 0) <> 1 then
      v_exp := null;
    end if;
    v_gano := case when v_exp is not null and v_exp = s.impostor then 'grupo' else 'impostor' end;
  elsif p_motivo = 'se_fue_impostor' then
    v_gano := 'grupo';
  else
    v_gano := 'impostor';
  end if;
  update public.partidas x set estado = 'terminada',
         estado_juego = x.estado_juego || jsonb_build_object('fase', 'final', 'impostor', s.impostor, 'palabra', s.palabra,
           'palabra_impostor', s.palabra_impostor, 'votos', v_votos, 'conteo', v_conteo, 'expulsado', v_exp,
           'gano', v_gano, 'motivo', p_motivo, 'ahora_ms', public.ahora_ms())
   where x.id = p_partida;
end;
$$;
revoke execute on function public.impostor_terminar(uuid, text) from public, anon, authenticated;

-- Cuántos de los activos ya votaron en la ronda.
create or replace function public.impostor_votaron(p_partida uuid) returns int
language sql stable security definer set search_path = ''
as $$
  select count(*)::int from public.impostor_votos v join public.jugadores j on j.partida = v.partida and j.persona = v.persona
   where v.partida = p_partida and v.ronda = 1 and not j.se_fue;
$$;
revoke execute on function public.impostor_votaron(uuid) from public, anon, authenticated;

-- Alguien se fue de una partida en juego (ya quedó se_fue = true): ImpostorLogica.sigue.
create or replace function public.impostor_tras_salida(p_partida uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s public.impostor_secretos;
  v_activos int;
  v_esta boolean;
begin
  select x.* into s from public.impostor_secretos x where x.partida = p_partida;
  select count(*), coalesce(bool_or(j.persona = s.impostor), false) into v_activos, v_esta
    from public.jugadores j where j.partida = p_partida and not j.se_fue;
  if not v_esta then
    perform public.impostor_terminar(p_partida, 'se_fue_impostor');
  elsif v_activos <= 2 then
    perform public.impostor_terminar(p_partida, 'quedan_dos');
  elsif (select x.estado_juego->>'fase' from public.partidas x where x.id = p_partida) = 'votacion'
        and public.impostor_votaron(p_partida) >= v_activos then
    perform public.impostor_terminar(p_partida, 'votacion');
  end if;
end;
$$;
revoke execute on function public.impostor_tras_salida(uuid) from public, anon, authenticated;

-- Avanzar una partida de Impostor en juego (lo llama avanzar_partida, ya validado el jugador y p_ronda/p_fase).
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
  if r.creador <> p_uid and not vencido
     and not (e->>'fase' = 'votacion' and public.impostor_votaron(p_partida) >= v_activos) then
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

-- ---- RPC ----
-- Tu palabra (y solo la tuya), mientras la partida está en juego y vos seguís adentro.
create or replace function public.mi_palabra(p uuid) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  r public.partidas;
  s public.impostor_secretos;
  uid uuid := (select auth.uid());
begin
  if not public.es_miembro() then
    raise exception 'No sos miembro' using errcode = '42501';
  end if;
  select x.* into r from public.partidas x where x.id = p;
  if r.id is null or not exists (select 1 from public.jugadores j where j.partida = p and j.persona = uid and not j.se_fue) then
    raise exception 'No estás en esta partida' using errcode = '42501';
  end if;
  if r.juego <> 'impostor' or r.estado <> 'jugando' then
    raise exception 'No hay palabra para esta partida' using errcode = 'P0001';
  end if;
  select x.* into s from public.impostor_secretos x where x.partida = p;
  if s.partida is null then
    raise exception 'No hay palabra para esta partida' using errcode = 'P0001';
  end if;
  return case when uid = s.impostor then s.palabra_impostor else s.palabra end;
end;
$$;
revoke execute on function public.mi_palabra(uuid) from public, anon;
grant execute on function public.mi_palabra(uuid) to authenticated;

-- Votar a quién creés que es el impostor: uno por jugador activo, no a uno mismo, solo en la votación.
create or replace function public.votar(p uuid, p_ronda int, p_persona uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.partidas;
  e jsonb;
  uid uuid := (select auth.uid());
  t bigint := public.ahora_ms();
  v_activos int;
begin
  if not public.es_miembro() then
    raise exception 'No sos miembro' using errcode = '42501';
  end if;
  select x.* into r from public.partidas x where x.id = p for update;
  if r.id is null then
    raise exception 'La partida no existe' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.jugadores j where j.partida = p and j.persona = uid and not j.se_fue) then
    raise exception 'No estás en esta partida' using errcode = '42501';
  end if;
  e := r.estado_juego;
  if r.juego <> 'impostor' or r.estado <> 'jugando' or e->>'fase' is distinct from 'votacion' then
    raise exception 'No hay una votación abierta' using errcode = 'P0001';
  end if;
  if p_ronda is null or coalesce((e->>'ronda')::int, 0) <> p_ronda then
    raise exception 'Esa no es la votación actual' using errcode = 'P0001';
  end if;
  if t > (e->>'limite_ms')::bigint + 1000 then
    raise exception 'Se terminó el tiempo' using errcode = 'P0001';
  end if;
  if p_persona is null or p_persona = uid then
    raise exception 'No te podés votar a vos' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.jugadores j where j.partida = p and j.persona = p_persona and not j.se_fue) then
    raise exception 'Esa persona no está en la partida' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.impostor_votos v where v.partida = p and v.ronda = p_ronda and v.persona = uid) then
    raise exception 'Ya votaste' using errcode = 'P0001';
  end if;
  insert into public.impostor_votos (partida, ronda, persona, voto) values (p, p_ronda, uid, p_persona);
  update public.partidas x
     set estado_juego = jsonb_set(x.estado_juego, '{votaron}', coalesce(x.estado_juego->'votaron', '[]'::jsonb) || to_jsonb(uid::text))
   where x.id = p;
  select count(*) into v_activos from public.jugadores j where j.partida = p and not j.se_fue;
  if public.impostor_votaron(p) >= v_activos then
    perform public.impostor_terminar(p, 'votacion');
  end if;
end;
$$;
revoke execute on function public.votar(uuid, int, uuid) from public, anon;
grant execute on function public.votar(uuid, int, uuid) to authenticated;

-- ---- salir_partida (la de la 12 + la rama 'impostor') ----
create or replace function public.salir_partida(p uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.partidas;
  uid uuid := (select auth.uid());
  activos int;
  respondieron int;
begin
  select * into r from public.partidas x where x.id = p for update;
  if r.id is null or not exists (select 1 from public.jugadores j where j.partida = p and j.persona = uid and not j.se_fue) then
    raise exception 'No estás en esta partida' using errcode = 'P0002';
  end if;
  if r.estado = 'espera' then
    if r.creador = uid then
      update public.partidas x set estado = 'terminada', estado_juego = jsonb_build_object('fase', 'cancelada', 'ahora_ms', public.ahora_ms())
       where x.id = p;
    end if;
    delete from public.jugadores j where j.partida = p and j.persona = uid;
    return;
  end if;
  update public.jugadores j set se_fue = true where j.partida = p and j.persona = uid;
  if r.estado <> 'jugando' then
    return;
  end if;
  -- El Impostor: se fue el impostor → gana el grupo; quedan 2 con el impostor → gana el impostor; si no, sigue.
  if r.juego = 'impostor' then
    perform public.impostor_tras_salida(p);
    return;
  end if;
  select count(*) into activos from public.jugadores j where j.partida = p and not j.se_fue;
  if activos = 0 then
    update public.partidas x set estado = 'terminada',
           estado_juego = x.estado_juego || jsonb_build_object('fase', 'final', 'ahora_ms', public.ahora_ms())
     where x.id = p;
  elsif r.juego = 'trivia' and r.estado_juego->>'fase' = 'pregunta' then
    select count(*) into respondieron from public.respuestas s join public.jugadores j on j.partida = s.partida and j.persona = s.persona
     where s.partida = p and s.ronda = (r.estado_juego->>'ronda')::int and not j.se_fue;
    if respondieron >= activos then
      perform public.trivia_revelar(p);
    end if;
  end if;
end;
$$;
revoke execute on function public.salir_partida(uuid) from public, anon;
grant execute on function public.salir_partida(uuid) to authenticated;

-- ---- avanzar_partida (la de la 12 + la rama 'impostor'; la de la Trivia queda igual) ----
create or replace function public.avanzar_partida(p uuid, p_ronda int default null, p_fase text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.partidas;
  e jsonb;
  uid uuid := (select auth.uid());
  activos int;
  respondieron int;
  vencido boolean;
  ids text[];
begin
  if not public.es_miembro() then
    raise exception 'No sos miembro' using errcode = '42501';
  end if;
  select * into r from public.partidas x where x.id = p for update;
  if r.id is null then
    raise exception 'La partida no existe' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.jugadores j where j.partida = p and j.persona = uid and not j.se_fue) then
    raise exception 'No estás en esta partida' using errcode = '42501';
  end if;
  e := r.estado_juego;
  -- pedido desde un estado que ya pasó (otro jugador se adelantó): no se hace nada
  if p_ronda is not null and coalesce((e->>'ronda')::int, 0) <> p_ronda then
    return e;
  end if;
  if p_fase is not null and coalesce(e->>'fase', r.estado) <> p_fase then
    return e;
  end if;
  if r.estado = 'terminada' then
    return e;
  end if;
  select count(*) into activos from public.jugadores j where j.partida = p and not j.se_fue;

  if r.estado = 'espera' then
    if r.creador <> uid then
      raise exception 'Solo quien armó la partida la puede arrancar' using errcode = 'P0001';
    end if;
    if r.juego = 'impostor' then
      if activos < 3 then
        raise exception 'El Impostor necesita al menos 3 jugadores' using errcode = 'P0001';
      end if;
      perform public.impostor_arrancar(p);
      return (select x.estado_juego from public.partidas x where x.id = p);
    end if;
    -- Trivia: 10 preguntas sin repetir, 4 fáciles, 4 medias y 2 difíciles (las cuotas de TriviaLogica.cuotas), mezcladas
    select array_agg(q.id order by random()) into ids from (
      (select tp.id from public.trivia_preguntas tp where tp.dif = 1 order by random() limit 4)
      union all (select tp.id from public.trivia_preguntas tp where tp.dif = 2 order by random() limit 4)
      union all (select tp.id from public.trivia_preguntas tp where tp.dif = 3 order by random() limit 2)
    ) q;
    if coalesce(array_length(ids, 1), 0) = 0 then
      raise exception 'No hay preguntas cargadas' using errcode = 'P0001';
    end if;
    insert into public.trivia_secretos (partida, preguntas) values (p, ids)
    on conflict (partida) do update set preguntas = excluded.preguntas;
    update public.partidas x set estado = 'jugando', estado_juego = public.trivia_estado_pregunta(p, 1, array_length(ids, 1))
     where x.id = p;
    return (select x.estado_juego from public.partidas x where x.id = p);
  end if;

  if r.juego = 'impostor' then
    perform public.impostor_avanzar(p, uid);
    return (select x.estado_juego from public.partidas x where x.id = p);
  end if;
  if r.juego <> 'trivia' then
    raise exception 'Todavía no disponible' using errcode = 'P0001';
  end if;
  vencido := public.ahora_ms() >= coalesce((e->>'limite_ms')::bigint, 0);
  if e->>'fase' = 'pregunta' then
    select count(*) into respondieron from public.respuestas s join public.jugadores j on j.partida = s.partida and j.persona = s.persona
     where s.partida = p and s.ronda = (e->>'ronda')::int and not j.se_fue;
    if r.creador <> uid and not vencido and respondieron < activos then
      raise exception 'Todavía no: falta que respondan todos o que se termine el tiempo' using errcode = 'P0001';
    end if;
    perform public.trivia_revelar(p);
  elsif e->>'fase' = 'revelada' then
    if r.creador <> uid and not vencido then
      raise exception 'Todavía no: la que avanza es quien armó la partida' using errcode = 'P0001';
    end if;
    perform public.trivia_siguiente(p);
  end if;
  return (select x.estado_juego from public.partidas x where x.id = p);
end;
$$;
revoke execute on function public.avanzar_partida(uuid, int, text) from public, anon;
grant execute on function public.avanzar_partida(uuid, int, text) to authenticated;
