-- Juegos: partidas en vivo con su chat 'par:<uuid>' y la Trivia (El Impostor lo completa la Task 8).
-- Solo crea o reemplaza: no toca filas existentes. Completa la rama 'par:' de en_sala (la 'act:' queda igual que en la 08).
--
-- Quién ve qué:
-- - partidas: los miembros ven las que están en espera (para unirse); las que están en juego o terminadas, solo sus
--   jugadores activos (se_fue = false).
-- - jugadores: los de una partida en espera los ve cualquier miembro; los de una en juego, solo sus jugadores activos.
-- - respuestas: cada uno solo las propias.
-- - trivia_preguntas (el banco, con la respuesta correcta) y trivia_secretos (las preguntas elegidas de cada partida):
--   nadie por la API. Solo las leen las funciones SECURITY DEFINER de acá.
-- Nada se escribe directo: todo pasa por RPC (crear_partida, unirse_partida, salir_partida, avanzar_partida, responder).
--
-- La partida de Trivia (estado_juego, visible para los jugadores):
--   { fase: 'pregunta', ronda, total, pregunta: {cat, dif, p, ops}, inicio_ms, limite_ms, ahora_ms, respondieron: [uuid] }
--   { fase: 'revelada', ...lo mismo, ok, conteo: [n0..n3], puntos_ronda: {uuid: puntos}, limite_ms (de la revelación) }
--   { fase: 'final', total, ahora_ms }        { fase: 'cancelada', ahora_ms } (el creador se fue antes de arrancar)
-- La correcta (ok) aparece recién en 'revelada'. La pregunta no lleva su id (el id permitiría buscarla en el banco).
-- El tiempo lo mide el servidor con now(): 15 s para responder (+1 s de gracia por la red; los ms se recortan a 15000)
-- y 8 s con la correcta a la vista. Los puntos salen de la misma fórmula que TriviaLogica.puntos:
--   correcta: round(1000 - 500 * ms / 15000); incorrecta o sin responder: 0.
-- Avanzar: el creador cuando quiera; cualquier jugador activo cuando venció el tiempo de la fase o (en 'pregunta')
-- cuando respondieron todos los activos. responder() revela sola al llegar la última respuesta. Así la partida no se
-- traba aunque se vaya el creador. p_ronda/p_fase dicen desde qué estado se pide avanzar: si la partida ya está en
-- otro (otro cliente se adelantó), no hace nada y devuelve el estado actual.

-- ---- Tablas ----
create table if not exists public.partidas (
  id uuid primary key default gen_random_uuid(),
  juego text not null check (juego in ('trivia','impostor')),
  creador uuid not null default auth.uid() references public.perfiles(id) on delete cascade,
  estado text not null default 'espera' check (estado in ('espera','jugando','terminada')),
  estado_juego jsonb not null default '{}'::jsonb,
  creado timestamptz not null default now()
);
create index if not exists partidas_estado_creado_idx on public.partidas (estado, creado desc);
create index if not exists partidas_creador_idx on public.partidas (creador);

create table if not exists public.jugadores (
  partida uuid not null references public.partidas(id) on delete cascade,
  persona uuid not null default auth.uid() references public.perfiles(id) on delete cascade,
  puntos int not null default 0,
  se_fue boolean not null default false,
  unido timestamptz not null default now(),
  primary key (partida, persona)
);
create index if not exists jugadores_persona_idx on public.jugadores (persona);

create table if not exists public.respuestas (
  partida uuid not null,
  ronda int not null check (ronda between 1 and 50),
  persona uuid not null,
  opcion int not null check (opcion between 0 and 3),
  ms int not null check (ms between 0 and 15000),
  creado timestamptz not null default now(),
  primary key (partida, ronda, persona),
  foreign key (partida, persona) references public.jugadores(partida, persona) on delete cascade
);

create table if not exists public.trivia_preguntas (
  id text primary key check (char_length(id) between 1 and 20),
  cat text not null check (char_length(cat) between 1 and 40),
  dif int not null check (dif between 1 and 3),
  p text not null check (char_length(btrim(p)) >= 1),
  ops text[] not null check (array_length(ops, 1) = 4),
  ok int not null check (ok between 0 and 3)
);

create table if not exists public.trivia_secretos (
  partida uuid primary key references public.partidas(id) on delete cascade,
  preguntas text[] not null
);

alter table public.partidas enable row level security;
alter table public.jugadores enable row level security;
alter table public.respuestas enable row level security;
alter table public.trivia_preguntas enable row level security;
alter table public.trivia_secretos enable row level security;

-- ---- Ayudas para las policies (SECURITY DEFINER: leen sin pasar por la RLS y evitan la recursión) ----
create or replace function public.es_jugador(p uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.jugadores j where j.partida = p and j.persona = (select auth.uid()) and not j.se_fue); $$;
revoke execute on function public.es_jugador(uuid) from public, anon;
grant execute on function public.es_jugador(uuid) to authenticated;

create or replace function public.partida_en_espera(p uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.partidas x where x.id = p and x.estado = 'espera'); $$;
revoke execute on function public.partida_en_espera(uuid) from public, anon;
grant execute on function public.partida_en_espera(uuid) to authenticated;

-- ---- Políticas (solo SELECT: no hay policies de insert/update/delete, se escribe por RPC) ----
drop policy if exists partidas_select on public.partidas;
create policy partidas_select on public.partidas for select to authenticated
  using (public.es_miembro() and (estado = 'espera' or public.es_jugador(id)));
drop policy if exists jugadores_select on public.jugadores;
create policy jugadores_select on public.jugadores for select to authenticated
  using (public.es_miembro() and (public.es_jugador(partida) or public.partida_en_espera(partida)));
drop policy if exists respuestas_select on public.respuestas;
create policy respuestas_select on public.respuestas for select to authenticated
  using (public.es_miembro() and persona = (select auth.uid()));
-- trivia_preguntas y trivia_secretos: RLS sin policies y sin grants.

revoke all on public.partidas from anon, authenticated;
revoke all on public.jugadores from anon, authenticated;
revoke all on public.respuestas from anon, authenticated;
revoke all on public.trivia_preguntas from anon, authenticated;
revoke all on public.trivia_secretos from anon, authenticated;
grant select on public.partidas to authenticated;
grant select on public.jugadores to authenticated;
grant select on public.respuestas to authenticated;

-- ---- Chat de la partida: en_sala completa la rama 'par:' ----
-- 'act:<uuid>': anotado a cualquier parte de la actividad (igual que en la 08).
-- 'par:<uuid>': jugador de la partida que no se fue (se_fue = false).
create or replace function public.en_sala(sala text) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
  if sala is null or (select auth.uid()) is null then
    return false;
  end if;
  if sala ~ '^act:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return exists (
      select 1 from public.asistencias a
      where a.actividad = substr(sala, 5)::uuid and a.persona = (select auth.uid())
    );
  end if;
  if sala ~ '^par:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return exists (
      select 1 from public.jugadores j
      where j.partida = substr(sala, 5)::uuid and j.persona = (select auth.uid()) and not j.se_fue
    );
  end if;
  return false;
end;
$$;
revoke execute on function public.en_sala(text) from public, anon;
grant execute on function public.en_sala(text) to authenticated;

-- ---- Reloj del servidor en milisegundos (el cliente calcula su desfase para la cuenta regresiva) ----
create or replace function public.ahora_ms() returns bigint
language sql stable set search_path = ''
as $$ select floor(extract(epoch from now()) * 1000)::bigint; $$;
revoke execute on function public.ahora_ms() from public, anon;
grant execute on function public.ahora_ms() to authenticated;

-- ---- Internas de la Trivia (sin execute para nadie: solo las llaman las RPC de abajo) ----
-- Estado de la pregunta número `ronda` (sin la correcta).
create or replace function public.trivia_estado_pregunta(p_partida uuid, ronda int, total int) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  q public.trivia_preguntas;
  t bigint := public.ahora_ms();
begin
  select tp.* into q from public.trivia_secretos s join public.trivia_preguntas tp on tp.id = s.preguntas[ronda]
   where s.partida = p_partida;
  if q.id is null then
    raise exception 'Falta la pregunta %', ronda using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'fase', 'pregunta', 'ronda', ronda, 'total', total,
    'pregunta', jsonb_build_object('cat', q.cat, 'dif', q.dif, 'p', q.p, 'ops', to_jsonb(q.ops)),
    'inicio_ms', t, 'limite_ms', t + 15000, 'ahora_ms', t, 'respondieron', '[]'::jsonb);
end;
$$;
revoke execute on function public.trivia_estado_pregunta(uuid, int, int) from public, anon, authenticated;

-- Revela la pregunta en curso: suma los puntos de la ronda y publica la correcta. La partida ya viene bloqueada.
create or replace function public.trivia_revelar(p_partida uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  e jsonb;
  v_ronda int;
  v_ok int;
  v_puntos jsonb;
  v_conteo jsonb;
  fila record;
  pts int;
  t bigint := public.ahora_ms();
begin
  select x.estado_juego into e from public.partidas x where x.id = p_partida;
  v_ronda := (e->>'ronda')::int;
  select tp.ok into v_ok from public.trivia_secretos s join public.trivia_preguntas tp on tp.id = s.preguntas[v_ronda]
   where s.partida = p_partida;
  -- puntos de la ronda: la misma fórmula que TriviaLogica.puntos (ms ya viene recortado a 0..15000)
  v_puntos := '{}'::jsonb;
  v_conteo := '[0,0,0,0]'::jsonb;
  for fila in select x.persona, x.opcion, x.ms from public.respuestas x where x.partida = p_partida and x.ronda = v_ronda loop
    pts := case when fila.opcion = v_ok then round(1000 - 500 * fila.ms::numeric / 15000)::int else 0 end;
    update public.jugadores j set puntos = j.puntos + pts where j.partida = p_partida and j.persona = fila.persona;
    v_puntos := v_puntos || jsonb_build_object(fila.persona::text, pts);
    v_conteo := jsonb_set(v_conteo, array[fila.opcion::text], to_jsonb((v_conteo->>fila.opcion)::int + 1));
  end loop;
  update public.partidas x
     set estado_juego = e || jsonb_build_object('fase', 'revelada', 'ok', v_ok, 'conteo', v_conteo,
                                                'puntos_ronda', v_puntos, 'limite_ms', t + 8000, 'ahora_ms', t)
   where x.id = p_partida;
end;
$$;
revoke execute on function public.trivia_revelar(uuid) from public, anon, authenticated;

-- Pasa a la pregunta siguiente o termina la partida.
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
  else
    update public.partidas x
       set estado = 'terminada', estado_juego = jsonb_build_object('fase', 'final', 'total', v_total, 'ahora_ms', public.ahora_ms())
     where x.id = p;
  end if;
end;
$$;
revoke execute on function public.trivia_siguiente(uuid) from public, anon, authenticated;

-- ---- RPC ----
create or replace function public.crear_partida(p_juego text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v uuid;
begin
  if not public.es_miembro() then
    raise exception 'No sos miembro' using errcode = '42501';
  end if;
  if p_juego is null or p_juego not in ('trivia', 'impostor') then
    raise exception 'Juego inválido' using errcode = '22023';
  end if;
  insert into public.partidas (juego, creador) values (p_juego, (select auth.uid())) returning id into v;
  insert into public.jugadores (partida, persona) values (v, (select auth.uid()));
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
  if (select count(*) from public.jugadores j where j.partida = p) >= 20 then
    raise exception 'La partida está llena' using errcode = 'P0001';
  end if;
  insert into public.jugadores (partida, persona) values (p, (select auth.uid()))
  on conflict (partida, persona) do update set se_fue = false;
end;
$$;
revoke execute on function public.unirse_partida(uuid) from public, anon;
grant execute on function public.unirse_partida(uuid) to authenticated;

-- Salir: en espera, te borra de la partida (si sos el creador, la partida se cancela); en juego, quedás como
-- "se fue" (sigue con los que quedan; si no queda nadie, termina; si faltabas solo vos por responder, se revela).
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
      -- El desarrollo del Impostor lo agrega la Task 8 (reemplaza esta función).
      update public.partidas x set estado = 'jugando', estado_juego = jsonb_build_object('fase', 'inicio', 'ahora_ms', public.ahora_ms())
       where x.id = p;
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

create or replace function public.responder(p uuid, p_ronda int, p_opcion int) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.partidas;
  e jsonb;
  uid uuid := (select auth.uid());
  t bigint := public.ahora_ms();
  activos int;
  respondieron int;
begin
  if not public.es_miembro() then
    raise exception 'No sos miembro' using errcode = '42501';
  end if;
  if p_opcion is null or p_opcion not between 0 and 3 then
    raise exception 'Opción inválida' using errcode = '22023';
  end if;
  select * into r from public.partidas x where x.id = p for update;
  if r.id is null then
    raise exception 'La partida no existe' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.jugadores j where j.partida = p and j.persona = uid and not j.se_fue) then
    raise exception 'No estás en esta partida' using errcode = '42501';
  end if;
  e := r.estado_juego;
  if r.juego <> 'trivia' or r.estado <> 'jugando' or e->>'fase' is distinct from 'pregunta' then
    raise exception 'No hay una pregunta abierta' using errcode = 'P0001';
  end if;
  if p_ronda is null or (e->>'ronda')::int <> p_ronda then
    raise exception 'Esa no es la pregunta actual' using errcode = 'P0001';
  end if;
  if t > (e->>'limite_ms')::bigint + 1000 then
    raise exception 'Se terminó el tiempo' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.respuestas s where s.partida = p and s.ronda = p_ronda and s.persona = uid) then
    raise exception 'Ya respondiste' using errcode = 'P0001';
  end if;
  insert into public.respuestas (partida, ronda, persona, opcion, ms)
  values (p, p_ronda, uid, p_opcion, least(greatest(t - (e->>'inicio_ms')::bigint, 0), 15000)::int);
  update public.partidas x
     set estado_juego = jsonb_set(x.estado_juego, '{respondieron}', coalesce(x.estado_juego->'respondieron', '[]'::jsonb) || to_jsonb(uid::text))
   where x.id = p;
  select count(*) into activos from public.jugadores j where j.partida = p and not j.se_fue;
  select count(*) into respondieron from public.respuestas s join public.jugadores j on j.partida = s.partida and j.persona = s.persona
   where s.partida = p and s.ronda = p_ronda and not j.se_fue;
  if respondieron >= activos then
    perform public.trivia_revelar(p);
  end if;
end;
$$;
revoke execute on function public.responder(uuid, int, int) from public, anon;
grant execute on function public.responder(uuid, int, int) to authenticated;

-- ---- Realtime (respeta el SELECT de cada tabla) ----
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'partidas') then
    alter publication supabase_realtime add table public.partidas;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'jugadores') then
    alter publication supabase_realtime add table public.jugadores;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'respuestas') then
    alter publication supabase_realtime add table public.respuestas;
  end if;
end $$;
