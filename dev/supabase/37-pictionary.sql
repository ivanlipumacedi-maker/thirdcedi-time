-- 37 Pictionary (pedido de Ivan, 2026-11-15). No borra ni pisa datos.
-- Uno dibuja y los demás adivinan. Cada jugador dibuja una vez (orden al azar, hasta 8 rondas), 80 segundos por dibujo.
-- * La palabra la ve solo quien dibuja (pictionary_mi_palabra). Los demás ven la pista: "_ _ _ _" (letras y espacios).
-- * Se adivina con pictionary_adivinar(p, ronda, texto): sin importar mayúsculas, tildes ni espacios de más. Acertar da
--   50 + los segundos que quedaban (hasta 80): cuanto antes, más. A quien dibuja, +30 por cada uno que acierta.
--   Si aciertan todos, o se acaba el tiempo, se revela la palabra (6 s) y pasa a la siguiente ronda.
-- * El dibujo viaja por un canal de Broadcast de Realtime (no se guarda): lo maneja la app (pictionary.js).
-- * Salir: si se va el que dibuja, se revela; si queda uno solo, termina.
-- * ranking(): suma Pictionary y Truco (50 por jugar con 2 o más, +150 al que gana; en el truco, a los del equipo que
--   gana, estado_juego.ganadores). Se recrea (cambian las columnas).
-- estado_juego: { fase: 'dibujando'|'revelada'|'final', ronda, total, orden: [uuid], dibuja, pista, letras, limite_ms,
--   acertaron: [uuid], palabra (solo revelada/final), puntos_ronda: {uuid: n}, ahora_ms }

create table if not exists public.pictionary_palabras (
  palabra text primary key check (char_length(btrim(palabra)) between 2 and 30)
);
alter table public.pictionary_palabras enable row level security;
revoke all on public.pictionary_palabras from anon, authenticated;
insert into public.pictionary_palabras (palabra) values
  ('mate'),
  ('asado'),
  ('empanada'),
  ('choripán'),
  ('pizza'),
  ('helado'),
  ('alfajor'),
  ('medialuna'),
  ('milanesa'),
  ('fernet'),
  ('parrilla'),
  ('sandía'),
  ('banana'),
  ('manzana'),
  ('torta'),
  ('café'),
  ('pochoclo'),
  ('hamburguesa'),
  ('huevo frito'),
  ('facturas'),
  ('paraguas'),
  ('reloj'),
  ('lámpara'),
  ('tijera'),
  ('llave'),
  ('anteojos'),
  ('zapatilla'),
  ('guitarra'),
  ('televisor'),
  ('heladera'),
  ('escalera'),
  ('ventana'),
  ('puerta'),
  ('cama'),
  ('silla'),
  ('mesa'),
  ('vela'),
  ('termo'),
  ('mochila'),
  ('billetera'),
  ('celular'),
  ('computadora'),
  ('auriculares'),
  ('cámara de fotos'),
  ('martillo'),
  ('tornillo'),
  ('escoba'),
  ('balde'),
  ('regalo'),
  ('globo'),
  ('colectivo'),
  ('subte'),
  ('bicicleta'),
  ('avión'),
  ('barco'),
  ('tren'),
  ('auto'),
  ('moto'),
  ('helicóptero'),
  ('semáforo'),
  ('faro'),
  ('puente'),
  ('castillo'),
  ('carpa'),
  ('pileta'),
  ('playa'),
  ('montaña'),
  ('volcán'),
  ('isla'),
  ('obelisco'),
  ('perro'),
  ('gato'),
  ('caballo'),
  ('vaca'),
  ('pingüino'),
  ('jirafa'),
  ('elefante'),
  ('tiburón'),
  ('pulpo'),
  ('caracol'),
  ('mariposa'),
  ('araña'),
  ('serpiente'),
  ('tortuga'),
  ('conejo'),
  ('búho'),
  ('carpincho'),
  ('cocodrilo'),
  ('murciélago'),
  ('abeja'),
  ('pelota'),
  ('arco'),
  ('raqueta'),
  ('pádel'),
  ('trofeo'),
  ('medalla'),
  ('silbato'),
  ('dados'),
  ('ajedrez'),
  ('naipes'),
  ('bowling'),
  ('surf'),
  ('esquí'),
  ('pesca'),
  ('boxeo'),
  ('golf'),
  ('básquet'),
  ('remo'),
  ('paracaídas'),
  ('patineta'),
  ('sol'),
  ('luna'),
  ('estrella'),
  ('nube'),
  ('lluvia'),
  ('rayo'),
  ('arcoíris'),
  ('árbol'),
  ('flor'),
  ('cactus'),
  ('fantasma'),
  ('robot'),
  ('pirata'),
  ('astronauta'),
  ('sirena'),
  ('dragón'),
  ('corona'),
  ('espada'),
  ('tesoro'),
  ('mapa'),
  ('cohete'),
  ('muñeco de nieve'),
  ('bombero'),
  ('médico'),
  ('cocinero'),
  ('mago'),
  ('payaso'),
  ('detective'),
  ('oficina'),
  ('reunión')
on conflict (palabra) do nothing;

create table if not exists public.pictionary_secretos (
  partida uuid primary key references public.partidas(id) on delete cascade,
  palabras text[] not null
);
alter table public.pictionary_secretos enable row level security;
revoke all on public.pictionary_secretos from anon, authenticated;

-- sin mayúsculas, tildes ni espacios de más (para comparar lo que escriben con la palabra)
create or replace function public.pictionary_normalizar(t text) returns text
language sql immutable set search_path = ''
as $$ select regexp_replace(translate(lower(btrim(coalesce(t, ''))), 'áéíóúüàèìòù', 'aeiouuaeiou'), '\s+', ' ', 'g'); $$;
revoke execute on function public.pictionary_normalizar(text) from public, anon, authenticated;

-- "_ _ _ _   _ _ _": un guion bajo por letra y tres espacios entre palabras
create or replace function public.pictionary_pista(t text) returns text
language sql immutable set search_path = ''
as $$ select array_to_string(array(select array_to_string(array(select '_' from generate_series(1, char_length(w))), ' ')
                                   from unnest(regexp_split_to_array(btrim(t), '\s+')) as w), '   '); $$;
revoke execute on function public.pictionary_pista(text) from public, anon, authenticated;

create or replace function public.pictionary_estado_ronda(p uuid, p_ronda int) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  e jsonb; s public.pictionary_secretos; w text; t bigint := public.ahora_ms();
begin
  select x.estado_juego into e from public.partidas x where x.id = p;
  select * into s from public.pictionary_secretos x where x.partida = p;
  w := s.palabras[p_ronda];
  return jsonb_build_object('fase', 'dibujando', 'ronda', p_ronda, 'total', e->'total', 'orden', e->'orden',
    'dibuja', (e->'orden')->>(p_ronda - 1), 'pista', public.pictionary_pista(w),
    'letras', char_length(replace(w, ' ', '')), 'limite_ms', t + 80000, 'acertaron', '[]'::jsonb, 'ahora_ms', t);
end;
$$;
revoke execute on function public.pictionary_estado_ronda(uuid, int) from public, anon, authenticated;

create or replace function public.pictionary_arrancar(p uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare js uuid[]; ws text[]; n int;
begin
  select array_agg(j.persona order by random()) into js from public.jugadores j where j.partida = p and not j.se_fue;
  n := least(coalesce(cardinality(js), 0), 8);
  if n < 2 then
    raise exception 'El Pictionary necesita al menos 2 jugadores' using errcode = 'P0001';
  end if;
  js := js[1:n];
  select array_agg(w.palabra) into ws from (select x.palabra from public.pictionary_palabras x order by random() limit n) w;
  if coalesce(cardinality(ws), 0) < n then
    raise exception 'No hay palabras cargadas' using errcode = 'P0001';
  end if;
  insert into public.pictionary_secretos (partida, palabras) values (p, ws)
  on conflict (partida) do update set palabras = excluded.palabras;
  update public.partidas x set estado = 'jugando', estado_juego = jsonb_build_object('total', n, 'orden', to_jsonb(js)) where x.id = p;
  update public.partidas x set estado_juego = public.pictionary_estado_ronda(p, 1) where x.id = p;
end;
$$;
revoke execute on function public.pictionary_arrancar(uuid) from public, anon, authenticated;

-- revela la palabra de la ronda en curso (6 s) o, si era la última, termina
create or replace function public.pictionary_revelar(p uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare e jsonb; s public.pictionary_secretos; t bigint := public.ahora_ms();
begin
  select x.estado_juego into e from public.partidas x where x.id = p;
  select * into s from public.pictionary_secretos x where x.partida = p;
  update public.partidas x set estado_juego = e || jsonb_build_object('fase', 'revelada', 'palabra', s.palabras[(e->>'ronda')::int],
      'limite_ms', t + 6000, 'ahora_ms', t)
   where x.id = p;
end;
$$;
revoke execute on function public.pictionary_revelar(uuid) from public, anon, authenticated;

create or replace function public.pictionary_siguiente(p uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare e jsonb; v int; tot int;
begin
  select x.estado_juego into e from public.partidas x where x.id = p;
  v := (e->>'ronda')::int; tot := (e->>'total')::int;
  -- se saltean las rondas de los que se fueron
  loop
    v := v + 1;
    exit when v > tot;
    exit when exists (select 1 from public.jugadores j where j.partida = p and not j.se_fue and j.persona::text = (e->'orden')->>(v - 1));
  end loop;
  if v > tot or (select count(*) from public.jugadores j where j.partida = p and not j.se_fue) < 2 then
    update public.partidas x set estado = 'terminada', estado_juego = x.estado_juego || jsonb_build_object('fase', 'final', 'ahora_ms', public.ahora_ms())
     where x.id = p;
  else
    update public.partidas x set estado_juego = public.pictionary_estado_ronda(p, v) where x.id = p;
  end if;
end;
$$;
revoke execute on function public.pictionary_siguiente(uuid) from public, anon, authenticated;

-- avanzar (lo llama avanzar_partida): en 'dibujando', cuando se acaba el tiempo o lo pide quien armó la partida;
-- en 'revelada', cuando pasan los 6 s o lo pide quien armó la partida
create or replace function public.pictionary_avanzar(p uuid, p_uid uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.partidas; e jsonb; vencido boolean;
begin
  select x.* into r from public.partidas x where x.id = p;
  e := r.estado_juego;
  vencido := public.ahora_ms() >= coalesce((e->>'limite_ms')::bigint, 0);
  if r.creador <> p_uid and e->>'dibuja' <> p_uid::text and not vencido then
    raise exception 'Todavía no: falta que se termine el tiempo' using errcode = 'P0001';
  end if;
  if e->>'fase' = 'dibujando' then
    perform public.pictionary_revelar(p);
  elsif e->>'fase' = 'revelada' then
    perform public.pictionary_siguiente(p);
  end if;
end;
$$;
revoke execute on function public.pictionary_avanzar(uuid, uuid) from public, anon, authenticated;

-- la palabra de la ronda, solo para quien dibuja
create or replace function public.pictionary_mi_palabra(p uuid) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare r public.partidas; s public.pictionary_secretos; uid uuid := (select auth.uid());
begin
  if not public.es_miembro() then raise exception 'No sos miembro' using errcode = '42501'; end if;
  select x.* into r from public.partidas x where x.id = p;
  if r.id is null or r.juego <> 'pictionary' or r.estado <> 'jugando' or r.estado_juego->>'fase' <> 'dibujando'
     or r.estado_juego->>'dibuja' <> uid::text then
    raise exception 'No te toca dibujar' using errcode = 'P0001';
  end if;
  select * into s from public.pictionary_secretos x where x.partida = p;
  return s.palabras[(r.estado_juego->>'ronda')::int];
end;
$$;
revoke execute on function public.pictionary_mi_palabra(uuid) from public, anon;
grant execute on function public.pictionary_mi_palabra(uuid) to authenticated;

-- adivinar: true si acertó (y suma), false si no. Quien dibuja y quien ya acertó no adivinan.
create or replace function public.pictionary_adivinar(p uuid, p_ronda int, p_texto text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  r public.partidas; e jsonb; s public.pictionary_secretos; uid uuid := (select auth.uid());
  t bigint := public.ahora_ms(); pts int; faltan int;
begin
  if not public.es_miembro() then raise exception 'No sos miembro' using errcode = '42501'; end if;
  if p_texto is null or char_length(p_texto) > 60 then raise exception 'Escribí una palabra' using errcode = 'P0001'; end if;
  select x.* into r from public.partidas x where x.id = p for update;
  if r.id is null or r.juego <> 'pictionary' or not exists (select 1 from public.jugadores j where j.partida = p and j.persona = uid and not j.se_fue) then
    raise exception 'No estás en esta partida' using errcode = '42501';
  end if;
  e := r.estado_juego;
  if r.estado <> 'jugando' or e->>'fase' <> 'dibujando' or (e->>'ronda')::int <> p_ronda or t >= (e->>'limite_ms')::bigint then
    return false;
  end if;
  if e->>'dibuja' = uid::text then raise exception 'Te toca dibujar: no podés adivinar' using errcode = 'P0001'; end if;
  if (e->'acertaron') ? uid::text then return true; end if;
  select * into s from public.pictionary_secretos x where x.partida = p;
  if public.pictionary_normalizar(p_texto) <> public.pictionary_normalizar(s.palabras[p_ronda]) then
    return false;
  end if;
  pts := 50 + least(80, greatest(0, (((e->>'limite_ms')::bigint - t) / 1000)::int));
  update public.jugadores j set puntos = j.puntos + pts where j.partida = p and j.persona = uid;
  update public.jugadores j set puntos = j.puntos + 30 where j.partida = p and j.persona::text = e->>'dibuja';
  e := e || jsonb_build_object('acertaron', (e->'acertaron') || to_jsonb(uid::text),
         'puntos_ronda', coalesce(e->'puntos_ronda', '{}'::jsonb) || jsonb_build_object(uid::text, pts), 'ahora_ms', t);
  update public.partidas x set estado_juego = e where x.id = p;
  select count(*) into faltan from public.jugadores j
   where j.partida = p and not j.se_fue and j.persona::text <> e->>'dibuja' and not ((e->'acertaron') ? j.persona::text);
  if faltan = 0 then perform public.pictionary_revelar(p); end if;
  return true;
end;
$$;
revoke execute on function public.pictionary_adivinar(uuid, int, text) from public, anon;
grant execute on function public.pictionary_adivinar(uuid, int, text) to authenticated;

-- ---- Funciones generales de partidas: las de la 36 + pictionary ----
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
  if p_juego is null or p_juego not in ('trivia', 'impostor', 'ajedrez', 'pictionary') then
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

create or replace function public.unirse_partida(p uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.partidas;
begin
  if not public.es_miembro() then
    raise exception 'No sos miembro' using errcode = '42501';
  end if;
  select * into r from public.partidas x where x.id = p for update;
  if r.id is null then
    raise exception 'La partida no existe' using errcode = 'P0002';
  end if;
  if r.estado <> 'espera' then
    raise exception 'La partida ya empezó' using errcode = 'P0001';
  end if;
  if r.juego = 'ajedrez' and (select count(*) from public.jugadores j where j.partida = p and not j.se_fue
                               and j.persona <> (select auth.uid())) >= 2 then
    raise exception 'La partida está llena: el ajedrez es de a dos' using errcode = 'P0001';
  end if;
  if r.juego = 'pictionary' and (select count(*) from public.jugadores j where j.partida = p and not j.se_fue
                                  and j.persona <> (select auth.uid())) >= 8 then
    raise exception 'La partida está llena: el Pictionary es de hasta 8' using errcode = 'P0001';
  end if;
  if (select count(*) from public.jugadores j where j.partida = p) >= 20 then
    raise exception 'La partida está llena' using errcode = 'P0001';
  end if;
  insert into public.jugadores (partida, persona) values (p, (select auth.uid()))
  on conflict (partida, persona) do update set se_fue = false;
end;
$$;
revoke execute on function public.unirse_partida(uuid) from public, anon;
grant execute on function public.unirse_partida(uuid) to authenticated;

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
    elsif r.juego = 'ajedrez' then
      perform public.ajedrez_arrancar(p);
    elsif r.juego = 'pictionary' then
      perform public.pictionary_arrancar(p);
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
  elsif r.juego = 'ajedrez' then
    return e; -- las jugadas van por la Edge Function juegos
  elsif r.juego = 'pictionary' then
    perform public.pictionary_avanzar(p, uid);
  else
    raise exception 'Todavía no disponible' using errcode = 'P0001';
  end if;
  return (select x.estado_juego from public.partidas x where x.id = p);
end;
$$;
revoke execute on function public.avanzar_partida(uuid, int, text) from public, anon;
grant execute on function public.avanzar_partida(uuid, int, text) to authenticated;

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
  if r.juego = 'ajedrez' then
    update public.partidas x set estado = 'terminada',
           estado_juego = x.estado_juego || jsonb_build_object('fase', 'final', 'motivo', 'abandono',
             'gano', case when x.estado_juego->>'blancas' = uid::text then 'negras' else 'blancas' end, 'ahora_ms', public.ahora_ms())
     where x.id = p;
    return;
  end if;
  if r.juego = 'pictionary' then
    if (select count(*) from public.jugadores j where j.partida = p and not j.se_fue) < 2 then
      update public.partidas x set estado = 'terminada', estado_juego = x.estado_juego || jsonb_build_object('fase', 'final', 'ahora_ms', public.ahora_ms())
       where x.id = p;
    elsif r.estado_juego->>'fase' = 'dibujando' and r.estado_juego->>'dibuja' = uid::text then
      perform public.pictionary_revelar(p);
    end if;
    return;
  end if;
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

-- ranking(): la de la 36 + pictionary y truco
drop function if exists public.ranking(int);
create or replace function public.ranking(p_anio int default null)
returns table (persona uuid, total int,
               asistencia int, n_asistencia int, tercer int, n_tercer int, organizar int, n_organizar int,
               trivia int, n_trivia int, impostor int, n_impostor int, ajedrez int, n_ajedrez int,
               pictionary int, n_pictionary int, truco int, n_truco int)
language sql stable security definer set search_path = ''
as $$
  with conf as (
    select c.persona, c.actividad, c.parte, a.creador,
           ((case when c.parte = 'tercer' then a.tercer_fecha else a.fecha end) at time zone 'America/Argentina/Buenos_Aires') as cuando
      from public.asistencias_confirmadas c
      join public.actividades a on a.id = c.actividad
     where a.estado <> 'cancelada'
       and (p_anio is null or extract(year from (a.fecha at time zone 'America/Argentina/Buenos_Aires')) = p_anio)
  ),
  asis as (
    select d.persona, count(*)::int as n from (select distinct c.persona, c.cuando::date from conf c where c.parte = 'actividad') d group by d.persona
  ),
  ter as (
    select d.persona, count(*)::int as n from (select distinct c.persona, c.cuando::date from conf c where c.parte = 'tercer') d group by d.persona
  ),
  org as (
    select o.creador as persona, count(*)::int as n from (
      select c.actividad, c.creador from conf c
       where c.parte = 'actividad' and c.persona <> c.creador
       group by c.actividad, c.creador having count(*) >= 3
    ) o group by o.creador
  ),
  par as (
    select p.id, p.juego, p.creado, p.estado_juego as e
      from public.partidas p
     where p.estado = 'terminada' and p.estado_juego ->> 'fase' = 'final'
       and (p_anio is null or extract(year from (p.creado at time zone 'America/Argentina/Buenos_Aires')) = p_anio)
  ),
  jug as (
    select j.persona, par.id, par.juego, par.creado, par.e, j.puntos,
           count(*) over (partition by par.id) as n_act,
           max(j.puntos) over (partition by par.id) as max_pts
      from par join public.jugadores j on j.partida = par.id and not j.se_fue
  ),
  pts as (
    select jug.persona, jug.juego, jug.creado,
           case jug.juego
             when 'pictionary' then case when jug.n_act < 2 then 0
                                     else 50 + case when jug.puntos = jug.max_pts and jug.puntos > 0 then 150 else 0 end end
             when 'truco' then case when jug.n_act < 2 then 0
                                    else 50 + case when coalesce(jug.e -> 'ganadores', '[]'::jsonb) ? jug.persona::text then 150 else 0 end end
             when 'trivia' then case when jug.n_act < 2 then 0
                                     else 50 + case when jug.puntos = jug.max_pts and jug.puntos > 0 then 150 else 0 end end
             when 'impostor' then 50 + case
                 when jug.e ->> 'gano' = 'grupo' and jug.persona::text <> coalesce(jug.e ->> 'impostor', '') then 100
                 when jug.e ->> 'gano' = 'impostor' and jug.persona::text = coalesce(jug.e ->> 'impostor', '') then 250
                 else 0 end
             when 'ajedrez' then case when coalesce(jsonb_array_length(jug.e -> 'jugadas'), 0) < 10 then 0
                 else 50 + case
                   when jug.e ->> 'gano' = 'tablas' then 50
                   when (jug.e ->> 'gano' = 'blancas' and jug.persona::text = jug.e ->> 'blancas')
                     or (jug.e ->> 'gano' = 'negras' and jug.persona::text = jug.e ->> 'negras') then 150
                   else 0 end end
             else 0 end as p
      from jug
  ),
  tope as (
    select t.persona, t.juego, t.p from (
      select pts.*, row_number() over (partition by pts.persona, (pts.creado at time zone 'America/Argentina/Buenos_Aires')::date order by pts.creado) as rn
        from pts where pts.p > 0
    ) t where t.rn <= 10
  ),
  jue as (
    select t.persona,
           coalesce(sum(t.p) filter (where t.juego = 'trivia'), 0)::int as tr, (count(*) filter (where t.juego = 'trivia'))::int as ntr,
           coalesce(sum(t.p) filter (where t.juego = 'impostor'), 0)::int as im, (count(*) filter (where t.juego = 'impostor'))::int as nim,
           coalesce(sum(t.p) filter (where t.juego = 'ajedrez'), 0)::int as aj, (count(*) filter (where t.juego = 'ajedrez'))::int as naj,
           coalesce(sum(t.p) filter (where t.juego = 'pictionary'), 0)::int as pi, (count(*) filter (where t.juego = 'pictionary'))::int as npi,
           coalesce(sum(t.p) filter (where t.juego = 'truco'), 0)::int as tc, (count(*) filter (where t.juego = 'truco'))::int as ntc
      from tope t group by t.persona
  ),
  todo as (
    select pf.id as persona,
           coalesce(asis.n, 0) * 1000 as asistencia, coalesce(asis.n, 0) as n_asistencia,
           coalesce(ter.n, 0) * 300 as tercer, coalesce(ter.n, 0) as n_tercer,
           coalesce(org.n, 0) * 500 as organizar, coalesce(org.n, 0) as n_organizar,
           coalesce(jue.tr, 0) as trivia, coalesce(jue.ntr, 0) as n_trivia,
           coalesce(jue.im, 0) as impostor, coalesce(jue.nim, 0) as n_impostor,
           coalesce(jue.aj, 0) as ajedrez, coalesce(jue.naj, 0) as n_ajedrez,
           coalesce(jue.pi, 0) as pictionary, coalesce(jue.npi, 0) as n_pictionary,
           coalesce(jue.tc, 0) as truco, coalesce(jue.ntc, 0) as n_truco
      from public.perfiles pf
      left join asis on asis.persona = pf.id
      left join ter on ter.persona = pf.id
      left join org on org.persona = pf.id
      left join jue on jue.persona = pf.id
     where pf.activo
  )
  select t.persona, (t.asistencia + t.tercer + t.organizar + t.trivia + t.impostor + t.ajedrez + t.pictionary + t.truco)::int as total,
         t.asistencia::int, t.n_asistencia::int, t.tercer::int, t.n_tercer::int, t.organizar::int, t.n_organizar::int,
         t.trivia, t.n_trivia, t.impostor, t.n_impostor, t.ajedrez, t.n_ajedrez, t.pictionary, t.n_pictionary, t.truco, t.n_truco
    from todo t
   where public.es_miembro()
     and (t.asistencia + t.tercer + t.organizar + t.trivia + t.impostor + t.ajedrez + t.pictionary + t.truco) > 0
   order by 2 desc, t.n_asistencia desc;
$$;
revoke execute on function public.ranking(int) from public, anon;
grant execute on function public.ranking(int) to authenticated;

-- Verificación (solo lectura): fallas vacío
select 'RESULTADO' as r, array_remove(array[
  case when (select count(*) from public.pictionary_palabras) < 100 then 'faltan palabras' end,
  case when has_function_privilege('authenticated', 'public.pictionary_arrancar(uuid)', 'execute') then 'pictionary_arrancar ejecutable' end,
  case when not has_function_privilege('authenticated', 'public.pictionary_adivinar(uuid,int,text)', 'execute') then 'adivinar no ejecutable' end,
  case when has_function_privilege('anon', 'public.pictionary_mi_palabra(uuid)', 'execute') then 'mi_palabra ejecutable por anon' end,
  case when has_table_privilege('authenticated', 'public.pictionary_secretos', 'SELECT') then 'secretos legibles' end,
  case when public.pictionary_pista('huevo frito') <> '_ _ _ _ _   _ _ _ _ _' then 'pista mal: ' || public.pictionary_pista('huevo frito') end,
  case when public.pictionary_normalizar('  Pingüino ') <> 'pinguino' then 'normalizar mal' end
], null) as fallas;
