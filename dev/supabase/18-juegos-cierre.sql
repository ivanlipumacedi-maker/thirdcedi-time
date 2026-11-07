-- Ajustes de cierre de Juegos (Task 10, parte 2): detalles de la Trivia (12) y de El Impostor (14 y 16), más la
-- Trivia sin repetir preguntas (pedido de Ivan). Solo create table if not exists, create or replace y policies: no
-- toca filas. Las funciones reemplazadas parten de la versión viva (pg_get_functiondef), que ya incluye la 14 y la 16.
--
-- Juegos
-- * La lista se entera cuando una partida arranca o se cancela (M1). Quien no juega no recibe esos cambios por
--   postgres_changes: la RLS ya no le deja ver la fila (en juego o terminada solo la ven sus jugadores) y la tarjeta
--   le quedaba en "Abiertas". Ahora avanzar_partida (al arrancar) y salir_partida (cuando el creador cancela) mandan
--   un broadcast al canal privado 'juegos-lista' con solo el id ({ id }); la lista se suscribe y vuelve a leer.
--   La policy de realtime.messages deja escucharlo a los miembros; nadie puede mandar en ese canal (no hay insert).
-- * crear_partida: como mucho 3 partidas en espera por persona (las de las últimas 12 h, las que ofrece la lista)
--   (M8). Con un candado por persona para que dos pedidos a la vez no se salteen el tope.
-- * avanzar_partida separa la lógica por juego (nota de la review): trivia_arrancar / trivia_avanzar e
--   impostor_arrancar / impostor_avanzar. Misma firma, mismos chequeos comunes y mismo comportamiento.
-- * Documentado (sin cambio) (M10): Realtime no filtra los DELETE de jugadores: a cualquier suscripto le llega la
--   clave (partida, persona) de quien sale de una partida en espera, sea cual sea la partida. Es una limitación de
--   Supabase (los DELETE no pasan por la RLS); el cliente lo usa solo para volver a leer y no muestra nada de eso.
-- * preguntas-sql.js (M5, sin SQL acá): al actualizar el banco ya no borra las preguntas de una partida en juego.
--
-- Trivia sin repetir (pedido de Ivan)
-- * trivia_vistas: qué pregunta vio cada persona y cuándo (la última vez). Privada como trivia_secretos: RLS sin
--   policies y sin grants; solo la leen y escriben las funciones de acá. Se anota cada pregunta cuando se muestra
--   (al arrancar la 1 y en trivia_siguiente), para los jugadores activos en ese momento.
-- * trivia_elegir: al arrancar elige, dentro de cada dificultad (cuotas 4/4/2), primero las que no vio NINGÚN
--   jugador de la partida, al azar; si no alcanzan, completa con las que hace más tiempo que vio alguno (se ordena
--   por la vez más reciente que la vio cualquiera de ellos). Así dos partidas seguidas con la misma gente no
--   comparten preguntas mientras el banco alcance.
--
-- El Impostor
-- * Si se va alguien que no es el impostor en medio de la votación, los votos que tenía se descartan y sus votantes
--   salen de 'votaron': pueden volver a votar a otro (ítem 3). Si se va el impostor la partida termina igual que
--   antes (gana el grupo) y los votos quedan para mostrarlos en el final.

-- ---- Trivia: historial de preguntas vistas ----
create table if not exists public.trivia_vistas (
  persona uuid not null references public.perfiles(id) on delete cascade,
  pregunta text not null references public.trivia_preguntas(id) on delete cascade,
  visto timestamptz not null default now(),
  primary key (persona, pregunta)
);
create index if not exists trivia_vistas_pregunta_idx on public.trivia_vistas (pregunta);
alter table public.trivia_vistas enable row level security;
revoke all on public.trivia_vistas from public, anon, authenticated;

-- Anota la pregunta de la ronda como vista por los jugadores activos de la partida. Uso interno.
create or replace function public.trivia_marcar_vista(p_partida uuid, p_ronda int) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.trivia_vistas (persona, pregunta, visto)
  select j.persona, s.preguntas[p_ronda], now()
    from public.jugadores j join public.trivia_secretos s on s.partida = j.partida
   where j.partida = p_partida and not j.se_fue and s.preguntas[p_ronda] is not null
  on conflict (persona, pregunta) do update set visto = excluded.visto;
end;
$$;
revoke execute on function public.trivia_marcar_vista(uuid, int) from public, anon, authenticated;

-- Las preguntas de una partida nueva: 4 fáciles, 4 medias y 2 difíciles (TriviaLogica.cuotas), primero las que no vio
-- ningún jugador activo y después las vistas hace más tiempo; mezcladas. Uso interno.
create or replace function public.trivia_elegir(p_partida uuid) returns text[]
language sql volatile security definer set search_path = ''
as $$
  with ult as (
    select v.pregunta, max(v.visto) as visto
      from public.trivia_vistas v
     where v.persona in (select j.persona from public.jugadores j where j.partida = p_partida and not j.se_fue)
     group by v.pregunta
  ), orden as (
    select tp.id, tp.dif, row_number() over (partition by tp.dif order by u.visto asc nulls first, random()) as n
      from public.trivia_preguntas tp left join ult u on u.pregunta = tp.id
  )
  select array_agg(o.id order by random()) from orden o
   where (o.dif = 1 and o.n <= 4) or (o.dif = 2 and o.n <= 4) or (o.dif = 3 and o.n <= 2);
$$;
revoke execute on function public.trivia_elegir(uuid) from public, anon, authenticated;

-- ---- Juegos: aviso a la lista ----
-- Broadcast privado al canal 'juegos-lista' con solo el id. Si Realtime falla, la partida sigue igual. Uso interno.
create or replace function public.juegos_avisar_lista(p uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform realtime.send(jsonb_build_object('id', p), 'cambio', 'juegos-lista', true);
exception when others then
  raise warning 'juegos_avisar_lista: %', sqlerrm;
end;
$$;
revoke execute on function public.juegos_avisar_lista(uuid) from public, anon, authenticated;

drop policy if exists juegos_lista_escuchar on realtime.messages;
create policy juegos_lista_escuchar on realtime.messages for select to authenticated
  using ((select realtime.topic()) = 'juegos-lista' and realtime.messages.extension = 'broadcast' and (select public.es_miembro()));

-- ---- Trivia: arrancar y avanzar (lo que estaba adentro de avanzar_partida) ----
create or replace function public.trivia_arrancar(p uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare ids text[];
begin
  ids := public.trivia_elegir(p);
  if coalesce(array_length(ids, 1), 0) = 0 then
    raise exception 'No hay preguntas cargadas' using errcode = 'P0001';
  end if;
  insert into public.trivia_secretos (partida, preguntas) values (p, ids)
  on conflict (partida) do update set preguntas = excluded.preguntas;
  update public.partidas x set estado = 'jugando', estado_juego = public.trivia_estado_pregunta(p, 1, array_length(ids, 1))
   where x.id = p;
  perform public.trivia_marcar_vista(p, 1);
end;
$$;
revoke execute on function public.trivia_arrancar(uuid) from public, anon, authenticated;

create or replace function public.trivia_avanzar(p uuid, p_uid uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.partidas;
  e jsonb;
  activos int;
  respondieron int;
  vencido boolean;
begin
  select x.* into r from public.partidas x where x.id = p;
  e := r.estado_juego;
  select count(*) into activos from public.jugadores j where j.partida = p and not j.se_fue;
  vencido := public.ahora_ms() >= coalesce((e->>'limite_ms')::bigint, 0);
  if e->>'fase' = 'pregunta' then
    select count(*) into respondieron from public.respuestas s join public.jugadores j on j.partida = s.partida and j.persona = s.persona
     where s.partida = p and s.ronda = (e->>'ronda')::int and not j.se_fue;
    if r.creador <> p_uid and not vencido and respondieron < activos then
      raise exception 'Todavía no: falta que respondan todos o que se termine el tiempo' using errcode = 'P0001';
    end if;
    perform public.trivia_revelar(p);
  elsif e->>'fase' = 'revelada' then
    if r.creador <> p_uid and not vencido then
      raise exception 'Todavía no: la que avanza es quien armó la partida' using errcode = 'P0001';
    end if;
    perform public.trivia_siguiente(p);
  end if;
end;
$$;
revoke execute on function public.trivia_avanzar(uuid, uuid) from public, anon, authenticated;

-- Igual que en la 12, y además anota la pregunta nueva como vista.
create or replace function public.trivia_siguiente(p uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  e jsonb;
  v_ronda int;
  v_total int;
begin
  select x.estado_juego into e from public.partidas x where x.id = p;
  v_ronda := (e->>'ronda')::int;
  v_total := (e->>'total')::int;
  if v_ronda < v_total then
    update public.partidas x set estado_juego = public.trivia_estado_pregunta(p, v_ronda + 1, v_total) where x.id = p;
    perform public.trivia_marcar_vista(p, v_ronda + 1);
  else
    update public.partidas x
       set estado = 'terminada', estado_juego = jsonb_build_object('fase', 'final', 'total', v_total, 'ahora_ms', public.ahora_ms())
     where x.id = p;
  end if;
end;
$$;
revoke execute on function public.trivia_siguiente(uuid) from public, anon, authenticated;

-- ---- avanzar_partida: chequeos comunes y después cada juego lo suyo ----
create or replace function public.avanzar_partida(p uuid, p_ronda int default null, p_fase text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.partidas;
  e jsonb;
  uid uuid := (select auth.uid());
  activos int;
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

  if r.estado = 'espera' then
    if r.creador <> uid then
      raise exception 'Solo quien armó la partida la puede arrancar' using errcode = 'P0001';
    end if;
    if r.juego = 'impostor' then
      select count(*) into activos from public.jugadores j where j.partida = p and not j.se_fue;
      if activos < 3 then
        raise exception 'El Impostor necesita al menos 3 jugadores' using errcode = 'P0001';
      end if;
      perform public.impostor_arrancar(p);
    elsif r.juego = 'trivia' then
      perform public.trivia_arrancar(p);
    else
      raise exception 'Todavía no disponible' using errcode = 'P0001';
    end if;
    perform public.juegos_avisar_lista(p);
    return (select x.estado_juego from public.partidas x where x.id = p);
  end if;

  if r.juego = 'impostor' then
    perform public.impostor_avanzar(p, uid);
  elsif r.juego = 'trivia' then
    perform public.trivia_avanzar(p, uid);
  else
    raise exception 'Todavía no disponible' using errcode = 'P0001';
  end if;
  return (select x.estado_juego from public.partidas x where x.id = p);
end;
$$;
revoke execute on function public.avanzar_partida(uuid, int, text) from public, anon;
grant execute on function public.avanzar_partida(uuid, int, text) to authenticated;

-- ---- crear_partida: tope de partidas abiertas ----
create or replace function public.crear_partida(p_juego text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v uuid;
  uid uuid := (select auth.uid());
begin
  if not public.es_miembro() then
    raise exception 'No sos miembro' using errcode = '42501';
  end if;
  if p_juego is null or p_juego not in ('trivia', 'impostor') then
    raise exception 'Juego inválido' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('crear_partida:' || uid::text, 0));
  if (select count(*) from public.partidas x
       where x.creador = uid and x.estado = 'espera' and x.creado > now() - interval '12 hours') >= 3 then
    raise exception 'Ya tenés 3 partidas abiertas: arrancá o cancelá alguna antes de armar otra' using errcode = 'P0001';
  end if;
  insert into public.partidas (juego, creador) values (p_juego, uid) returning id into v;
  insert into public.jugadores (partida, persona) values (v, uid);
  return v;
end;
$$;
revoke execute on function public.crear_partida(text) from public, anon;
grant execute on function public.crear_partida(text) to authenticated;

-- ---- El Impostor: descartar los votos a quien se fue ----
-- Borra los votos que apuntaban a p_persona y saca a sus votantes de 'votaron' (pueden votar de nuevo). Uso interno.
create or replace function public.impostor_descartar_votos_a(p_partida uuid, p_persona uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_votantes text[];
begin
  with d as (
    delete from public.impostor_votos v where v.partida = p_partida and v.voto = p_persona returning v.persona
  )
  select array_agg(d.persona::text) into v_votantes from d;
  if v_votantes is null then
    return;
  end if;
  update public.partidas x
     set estado_juego = jsonb_set(x.estado_juego, '{votaron}', coalesce(
           (select jsonb_agg(t.v) from jsonb_array_elements_text(coalesce(x.estado_juego->'votaron', '[]'::jsonb)) as t(v)
             where t.v <> all (v_votantes)), '[]'::jsonb))
   where x.id = p_partida;
end;
$$;
revoke execute on function public.impostor_descartar_votos_a(uuid, uuid) from public, anon, authenticated;

-- ---- salir_partida: aviso a la lista al cancelar y votos descartados en El Impostor ----
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
      perform public.juegos_avisar_lista(p);
    end if;
    delete from public.jugadores j where j.partida = p and j.persona = uid;
    return;
  end if;
  update public.jugadores j set se_fue = true where j.partida = p and j.persona = uid;
  if r.estado <> 'jugando' then
    return;
  end if;
  -- El Impostor: se fue el impostor → gana el grupo; quedan 2 con el impostor → gana el impostor; si no, sigue
  -- (y si se fue un inocente, los votos que tenía se descartan para que sus votantes elijan a otro).
  if r.juego = 'impostor' then
    if exists (select 1 from public.impostor_secretos s where s.partida = p and s.impostor is distinct from uid) then
      perform public.impostor_descartar_votos_a(p, uid);
    end if;
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
