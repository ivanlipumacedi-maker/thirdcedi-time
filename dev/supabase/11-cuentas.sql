-- Cuentas claras (Task 5): gastos, entre quiénes se divide cada uno y pagos, por actividad y parte
-- ('actividad' | 'tercer'). Pesos enteros. Solo crea tablas, funciones, policies y triggers: no toca filas existentes.
--
-- Quién puede qué (decisiones del controller):
-- * Ver las cuentas de una actividad: en_cuentas(actividad) = miembro y (anotado a alguna parte, o figura en algún
--   gasto -pagó o está en el reparto- o pago de esa actividad). Así quien se bajó y debe plata sigue viendo su deuda
--   y puede marcar el pago (Review Focus 3). Nada de esto mira asistencias para el saldo: bajarse borra la fila.
-- * Cargar un gasto: solo por la función cargar_gasto (gasto + reparto en una sola transacción). Quien carga tiene
--   que estar anotado; quien pagó y las personas del reparto, anotados a esa parte al momento de cargar. No en una
--   actividad cancelada, y en 'tercer' solo si la actividad tiene tercer tiempo.
-- * Borrar un gasto: solo quien lo cargó (el reparto se va en cascada).
-- * Pago: lo registra quien pagó (de) o quien cobró (a), con en_cuentas; las dos personas tienen que figurar en las
--   cuentas de la actividad. Se puede aunque la actividad esté cancelada (para saldar lo que quedó). Borrarlo: quien
--   lo cargó.
-- * Apagar el tercer tiempo con gastos o pagos de 'tercer' se rechaza (trigger en actividades).
--
-- Decisión de implementación: pagos lleva también "parte" (cada parte tiene sus propias cuentas en la pantalla).

-- ---- Tablas ----
create table if not exists public.gastos (
  id uuid primary key default gen_random_uuid(),
  actividad uuid not null references public.actividades(id) on delete cascade,
  parte text not null check (parte in ('actividad','tercer')),
  pagador uuid not null references public.perfiles(id) on delete cascade,
  monto int not null check (monto between 1 and 100000000),
  concepto text not null check (char_length(btrim(concepto)) between 1 and 80),
  creado timestamptz not null default now(),
  cargado_por uuid not null default auth.uid() references public.perfiles(id) on delete cascade
);
create index if not exists gastos_actividad_idx on public.gastos (actividad, parte);
create index if not exists gastos_pagador_idx on public.gastos (pagador);
create index if not exists gastos_cargado_por_idx on public.gastos (cargado_por);

create table if not exists public.gasto_partes (
  gasto uuid not null references public.gastos(id) on delete cascade,
  persona uuid not null references public.perfiles(id) on delete cascade,
  primary key (gasto, persona)
);
create index if not exists gasto_partes_persona_idx on public.gasto_partes (persona);

create table if not exists public.pagos (
  id uuid primary key default gen_random_uuid(),
  actividad uuid not null references public.actividades(id) on delete cascade,
  parte text not null check (parte in ('actividad','tercer')),
  de uuid not null references public.perfiles(id) on delete cascade,
  a uuid not null references public.perfiles(id) on delete cascade,
  monto int not null check (monto between 1 and 100000000),
  creado timestamptz not null default now(),
  cargado_por uuid not null default auth.uid() references public.perfiles(id) on delete cascade,
  constraint pagos_de_distinto_de_a check (de <> a)
);
create index if not exists pagos_actividad_idx on public.pagos (actividad, parte);
create index if not exists pagos_de_idx on public.pagos (de);
create index if not exists pagos_a_idx on public.pagos (a);
create index if not exists pagos_cargado_por_idx on public.pagos (cargado_por);

alter table public.gastos enable row level security;
alter table public.gasto_partes enable row level security;
alter table public.pagos enable row level security;

-- ---- ¿Figura esta persona en las cuentas de la actividad? ----
-- SECURITY DEFINER: lee gastos, gasto_partes y pagos sin pasar por sus RLS (las policies de esas tablas la usan:
-- sin esto habría recursión). Uso interno: no se le da execute a nadie.
create or replace function public.figura_en_cuentas(p_actividad uuid, p_persona uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_actividad is not null and p_persona is not null and (
    exists (select 1 from public.gastos g where g.actividad = p_actividad and g.pagador = p_persona)
    or exists (select 1 from public.gasto_partes gp join public.gastos g on g.id = gp.gasto
               where g.actividad = p_actividad and gp.persona = p_persona)
    or exists (select 1 from public.pagos p where p.actividad = p_actividad and (p.de = p_persona or p.a = p_persona))
  );
$$;
revoke execute on function public.figura_en_cuentas(uuid, uuid) from public, anon, authenticated;

-- ---- ¿Puedo ver las cuentas de esta actividad? ----
create or replace function public.en_cuentas(p_actividad uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_actividad is not null and (select auth.uid()) is not null and public.es_miembro() and (
    public.en_sala('act:' || p_actividad::text)
    or public.figura_en_cuentas(p_actividad, (select auth.uid()))
  );
$$;
revoke execute on function public.en_cuentas(uuid) from public, anon;
grant execute on function public.en_cuentas(uuid) to authenticated;

-- ¿Está esta persona anotada a esta parte de la actividad? (uso interno de cargar_gasto)
create or replace function public.anotado_a(p_actividad uuid, p_persona uuid, p_parte text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.asistencias s where s.actividad = p_actividad and s.persona = p_persona and s.parte = p_parte);
$$;
revoke execute on function public.anotado_a(uuid, uuid, text) from public, anon, authenticated;

-- ---- Policies ----
drop policy if exists gastos_select on public.gastos;
create policy gastos_select on public.gastos for select to authenticated
  using (public.en_cuentas(actividad));
drop policy if exists gastos_delete on public.gastos;
create policy gastos_delete on public.gastos for delete to authenticated
  using (public.es_miembro() and cargado_por = (select auth.uid()));
-- Sin policy de insert ni update: se carga con cargar_gasto y no se edita (se borra y se carga de nuevo).

drop policy if exists gasto_partes_select on public.gasto_partes;
create policy gasto_partes_select on public.gasto_partes for select to authenticated
  using (exists (select 1 from public.gastos g where g.id = gasto and public.en_cuentas(g.actividad)));
-- Sin insert/update/delete: lo escribe cargar_gasto y se borra en cascada con el gasto.

drop policy if exists pagos_select on public.pagos;
create policy pagos_select on public.pagos for select to authenticated
  using (public.en_cuentas(actividad));
drop policy if exists pagos_insert on public.pagos;
create policy pagos_insert on public.pagos for insert to authenticated
  with check (
    public.en_cuentas(actividad)
    and cargado_por = (select auth.uid())
    and (de = (select auth.uid()) or a = (select auth.uid()))
  );
-- Que las dos personas figuren en las cuentas lo chequea el trigger pagos_validar_alta (figura_en_cuentas no se
-- expone: diría quién figura en cuentas ajenas).
drop policy if exists pagos_delete on public.pagos;
create policy pagos_delete on public.pagos for delete to authenticated
  using (public.es_miembro() and cargado_por = (select auth.uid()));
-- Sin update: un pago mal cargado se borra.

-- ---- Grants mínimos ----
revoke all on public.gastos from anon, authenticated;
revoke all on public.gasto_partes from anon, authenticated;
revoke all on public.pagos from anon, authenticated;
grant select, delete on public.gastos to authenticated;
grant select on public.gasto_partes to authenticated;
grant select, delete on public.pagos to authenticated;
-- cargado_por sale de auth.uid() (default) y creado de now(): el cliente no los manda.
grant insert (actividad, parte, de, a, monto) on public.pagos to authenticated;

-- ---- Pago: la actividad tiene que existir y, en 'tercer', tener tercer tiempo; las dos personas, figurar ----
-- SECURITY DEFINER para leer la actividad y bloquear su fila (FOR SHARE) aunque las RLS cambien: con el bloqueo, un
-- pago al tercer tiempo y apagar el tercer tiempo no se cruzan.
create or replace function public.pagos_validar_alta() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare a public.actividades%rowtype;
begin
  select * into a from public.actividades where id = new.actividad for share;
  if not found then
    raise exception 'La actividad no existe' using errcode = 'P0001';
  end if;
  if new.parte = 'tercer' and not a.tiene_tercer then
    raise exception 'La actividad no tiene tercer tiempo' using errcode = 'P0001';
  end if;
  if not public.figura_en_cuentas(new.actividad, new.de) or not public.figura_en_cuentas(new.actividad, new.a) then
    raise exception 'Esa persona no figura en las cuentas de la actividad' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.pagos_validar_alta() from public, anon, authenticated;
drop trigger if exists pagos_validar_alta on public.pagos;
create trigger pagos_validar_alta before insert on public.pagos
  for each row execute function public.pagos_validar_alta();

-- ---- Cargar un gasto (gasto + reparto, todo o nada) ----
-- SECURITY DEFINER porque escribe en gastos y gasto_partes, que no tienen grants de insert: así no puede quedar un
-- gasto sin reparto ni un reparto inventado. Valida todo acá; los mensajes salen en español para la pantalla.
-- Bloquea la fila de la actividad (FOR SHARE): no se cruza con apagar el tercer tiempo ni con cancelar.
create or replace function public.cargar_gasto(p_actividad uuid, p_parte text, p_pagador uuid, p_monto int, p_concepto text, p_personas uuid[])
returns public.gastos
language plpgsql security definer set search_path = ''
as $$
declare
  yo uuid := (select auth.uid());
  a public.actividades%rowtype;
  personas uuid[];
  p uuid;
  r public.gastos;
begin
  if yo is null or not public.es_miembro() then
    raise exception 'No tenés permiso' using errcode = '42501';
  end if;
  select * into a from public.actividades where id = p_actividad for share;
  if not found then
    raise exception 'La actividad no existe' using errcode = 'P0001';
  end if;
  if not public.en_sala('act:' || p_actividad::text) then
    raise exception 'Solo los anotados pueden cargar gastos' using errcode = '42501';
  end if;
  if a.estado = 'cancelada' then
    raise exception 'La actividad está cancelada: no se cargan gastos nuevos' using errcode = 'P0001';
  end if;
  if p_parte is null or p_parte not in ('actividad','tercer') then
    raise exception 'La parte tiene que ser la actividad o el tercer tiempo' using errcode = 'P0001';
  end if;
  if p_parte = 'tercer' and not a.tiene_tercer then
    raise exception 'La actividad no tiene tercer tiempo' using errcode = 'P0001';
  end if;
  if p_monto is null or p_monto < 1 or p_monto > 100000000 then
    raise exception 'El monto tiene que ser en pesos enteros, de 1 a 100.000.000' using errcode = 'P0001';
  end if;
  if p_concepto is null or char_length(btrim(p_concepto)) not between 1 and 80 then
    raise exception 'El concepto tiene que tener entre 1 y 80 letras' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct x), '{}') into personas from unnest(p_personas) as x where x is not null;
  if cardinality(personas) = 0 then
    raise exception 'Elegí entre quiénes se divide' using errcode = 'P0001';
  end if;
  if cardinality(personas) > 200 then
    raise exception 'Son demasiadas personas' using errcode = 'P0001';
  end if;
  if p_pagador is null or not public.anotado_a(p_actividad, p_pagador, p_parte) then
    raise exception 'Quien pagó tiene que estar anotado a esa parte' using errcode = 'P0001';
  end if;
  foreach p in array personas loop
    if not public.anotado_a(p_actividad, p, p_parte) then
      raise exception 'Solo se puede dividir entre los anotados a esa parte' using errcode = 'P0001';
    end if;
  end loop;
  insert into public.gastos (actividad, parte, pagador, monto, concepto, cargado_por)
    values (p_actividad, p_parte, p_pagador, p_monto, btrim(p_concepto), yo)
    returning * into r;
  insert into public.gasto_partes (gasto, persona) select r.id, x from unnest(personas) as x;
  return r;
end;
$$;
revoke execute on function public.cargar_gasto(uuid, text, uuid, int, text, uuid[]) from public, anon;
grant execute on function public.cargar_gasto(uuid, text, uuid, int, text, uuid[]) to authenticated;

-- ---- Apagar el tercer tiempo con cuentas cargadas: se rechaza ----
-- BEFORE UPDATE que NO toca NEW (solo puede cortar con un error): no rompe la comparación de fila entera de
-- actividades_no_reabrir (ver ¡OJO! en 10). Por orden alfabético corre después de actividades_no_reabrir, que de todos
-- modos solo corre con canceladas (y una cancelada no se edita). Corre antes del AFTER actividades_quitar_tercer, así
-- que si rechaza no se quita a nadie del tercer tiempo.
-- SECURITY DEFINER: el creador puede no estar en las cuentas y las RLS le esconderían los gastos.
create or replace function public.actividades_tercer_con_cuentas() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.tiene_tercer and not new.tiene_tercer then
    if exists (select 1 from public.gastos g where g.actividad = new.id and g.parte = 'tercer') then
      raise exception 'El tercer tiempo tiene gastos cargados: borralos antes de sacarlo' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.pagos p where p.actividad = new.id and p.parte = 'tercer') then
      raise exception 'El tercer tiempo tiene pagos registrados: borralos antes de sacarlo' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.actividades_tercer_con_cuentas() from public, anon, authenticated;
drop trigger if exists actividades_tercer_con_cuentas on public.actividades;
create trigger actividades_tercer_con_cuentas before update of tiene_tercer on public.actividades
  for each row when (old.tiene_tercer and not new.tiene_tercer) execute function public.actividades_tercer_con_cuentas();

-- ---- Realtime (respeta el SELECT de la tabla) ----
-- gasto_partes no va: se escribe en la misma transacción que su gasto y se borra en cascada con él, así que el evento
-- del gasto alcanza para volver a leer.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gastos') then
    alter publication supabase_realtime add table public.gastos;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pagos') then
    alter publication supabase_realtime add table public.pagos;
  end if;
end $$;
