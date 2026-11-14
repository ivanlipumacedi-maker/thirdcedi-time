-- 33 Reclamos en Cuentas claras y registro de altas y bajas (decisión de Ivan, 2026-11-14). No borra ni pisa datos:
-- agrega columnas en null y una tabla, y reemplaza policies, checks y funciones.
--
-- Cuentas: nadie hace desaparecer plata de otro, pero se puede reclamar.
-- * Gasto: lo borran solo quien lo cargó o quien pagó (antes también cualquiera del reparto). Quien está en el reparto
--   y no estuvo toca "No estuve" (gasto_no_estuve): se saca solo él, lo suyo se reparte entre los demás, queda anotado en
--   gasto_rechazos ("Fulano dijo que no estuvo") y se le avisa a quien pagó (y a quien lo cargó, si es otro). Quien lo
--   cargó o lo pagó lo puede volver a sumar (gasto_volver_a_sumar), y a esa persona se le avisa.
-- * Pago: lo borra solo quien lo cargó (antes también la otra parte). La otra parte puede marcarlo como no reconocido
--   (pago_objetar): no se borra, deja de contar en los saldos, lo ven los dos y se le avisa a quien lo cargó. Quien lo
--   marcó le puede sacar la marca. Un pago marcado no frena volver a cargar el mismo pago (candado de 10 minutos).
-- Actividades: siguen abiertas para cualquier miembro, pero entrar y salir deja rastro.
-- * Al anotarse o bajarse uno mismo, el chat de la actividad muestra una línea fija (mensajes.tipo = 'sistema', texto
--   'alta:actividad' | 'alta:tercer' | 'baja:actividad' | 'baja:tercer'). No se edita, no se elimina, no se fija, no se
--   reacciona ni se responde, y no manda push. Quien la creó no genera "se sumó" en la suya; lo que quita el servidor
--   (baja de un miembro, apagar el tercer tiempo) no genera líneas.
-- * A quien la creó le llega un aviso cuando alguien se baja (salvo en una cancelada).
-- Avisos nuevos en eventos_aviso: 'gasto_rechazo', 'gasto_sumado', 'pago_objetado', 'baja', con destino (una persona) y
-- detalle. Van con actividad null y sala 'act:<id>': la versión anterior de la función avisos no los toma (los descarta
-- a la hora), así que da igual qué se publique primero.

-- ---- Avisos personales ----
alter table public.eventos_aviso
  add column if not exists destino uuid null,
  add column if not exists detalle text null;
alter table public.eventos_aviso drop constraint if exists eventos_aviso_detalle_check;
alter table public.eventos_aviso add constraint eventos_aviso_detalle_check check (detalle is null or char_length(detalle) <= 200);
alter table public.eventos_aviso drop constraint if exists eventos_aviso_tipo_check;
alter table public.eventos_aviso add constraint eventos_aviso_tipo_check
  check (tipo in ('nueva','confirmada','cambio','cancelada','reabierta','mensaje','prueba','gasto_rechazo','gasto_sumado','pago_objetado','baja'));

-- Encola un aviso para una persona. Nunca corta la acción que lo generó.
create or replace function public.aviso_personal(p_tipo text, p_sala text, p_autor uuid, p_destino uuid, p_detalle text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_destino is null or p_destino = p_autor then return; end if;
  begin
    insert into public.eventos_aviso (tipo, sala, autor, destino, detalle) values (p_tipo, p_sala, p_autor, p_destino, left(p_detalle, 200));
  exception when others then
    raise warning 'aviso_personal: %', sqlerrm;
  end;
end;
$$;
revoke execute on function public.aviso_personal(text, text, uuid, uuid, text) from public, anon, authenticated;

-- ---- Gastos ----
create table if not exists public.gasto_rechazos (
  gasto uuid not null references public.gastos(id) on delete cascade,
  actividad uuid not null references public.actividades(id) on delete cascade,
  persona uuid not null references public.perfiles(id) on delete cascade,
  creado timestamptz not null default now(),
  primary key (gasto, persona)
);
create index if not exists gasto_rechazos_actividad_idx on public.gasto_rechazos (actividad);
alter table public.gasto_rechazos enable row level security;
revoke all on public.gasto_rechazos from anon, authenticated;
grant select on public.gasto_rechazos to authenticated;
drop policy if exists gasto_rechazos_select on public.gasto_rechazos;
create policy gasto_rechazos_select on public.gasto_rechazos for select to authenticated
  using (public.es_miembro() and public.en_cuentas(actividad));

drop policy if exists gastos_delete on public.gastos;
create policy gastos_delete on public.gastos for delete to authenticated
  using (public.es_miembro() and (cargado_por = (select auth.uid()) or pagador = (select auth.uid())));

create or replace function public.gasto_no_estuve(p_gasto uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  yo uuid := (select auth.uid());
  x public.gastos;
begin
  if yo is null or not public.es_miembro() then
    raise exception 'No tenés permiso' using errcode = '42501';
  end if;
  select * into x from public.gastos g where g.id = p_gasto for update;
  if not found or not exists (select 1 from public.gasto_partes gp where gp.gasto = p_gasto and gp.persona = yo) then
    raise exception 'No figurás en ese gasto' using errcode = 'P0001';
  end if;
  if x.pagador = yo or x.cargado_por = yo then
    raise exception 'Lo cargaste o lo pagaste vos: si no va, borralo' using errcode = 'P0001';
  end if;
  delete from public.gasto_partes gp where gp.gasto = p_gasto and gp.persona = yo;
  insert into public.gasto_rechazos (gasto, actividad, persona) values (p_gasto, x.actividad, yo)
    on conflict (gasto, persona) do update set creado = now();
  perform public.aviso_personal('gasto_rechazo', 'act:' || x.actividad::text, yo, x.pagador, x.concepto);
  if x.cargado_por <> x.pagador then
    perform public.aviso_personal('gasto_rechazo', 'act:' || x.actividad::text, yo, x.cargado_por, x.concepto);
  end if;
end;
$$;
revoke execute on function public.gasto_no_estuve(uuid) from public, anon;
grant execute on function public.gasto_no_estuve(uuid) to authenticated;

create or replace function public.gasto_volver_a_sumar(p_gasto uuid, p_persona uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  yo uuid := (select auth.uid());
  x public.gastos;
begin
  if yo is null or not public.es_miembro() then
    raise exception 'No tenés permiso' using errcode = '42501';
  end if;
  select * into x from public.gastos g where g.id = p_gasto for update;
  if not found then
    raise exception 'Ese gasto ya no está' using errcode = 'P0001';
  end if;
  if yo not in (x.pagador, x.cargado_por) then
    raise exception 'Solo quien lo cargó o lo pagó puede volver a sumar a alguien' using errcode = '42501';
  end if;
  if not exists (select 1 from public.gasto_rechazos r where r.gasto = p_gasto and r.persona = p_persona) then
    raise exception 'Esa persona ya está en el gasto' using errcode = 'P0001';
  end if;
  insert into public.gasto_partes (gasto, persona) values (p_gasto, p_persona) on conflict do nothing;
  delete from public.gasto_rechazos r where r.gasto = p_gasto and r.persona = p_persona;
  perform public.aviso_personal('gasto_sumado', 'act:' || x.actividad::text, yo, p_persona, x.concepto);
end;
$$;
revoke execute on function public.gasto_volver_a_sumar(uuid, uuid) from public, anon;
grant execute on function public.gasto_volver_a_sumar(uuid, uuid) to authenticated;

-- ---- Pagos ----
alter table public.pagos
  add column if not exists objetado timestamptz null,
  add column if not exists objetado_por uuid null references public.perfiles(id) on delete set null;

drop policy if exists pagos_delete on public.pagos;
create policy pagos_delete on public.pagos for delete to authenticated
  using (public.es_miembro() and cargado_por = (select auth.uid()));

create or replace function public.pago_objetar(p_pago uuid, p_objetar boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  yo uuid := (select auth.uid());
  p public.pagos;
begin
  if yo is null or not public.es_miembro() then
    raise exception 'No tenés permiso' using errcode = '42501';
  end if;
  select * into p from public.pagos x where x.id = p_pago for update;
  if not found then
    raise exception 'Ese pago ya no está' using errcode = 'P0001';
  end if;
  if yo not in (p.de, p.a) or yo = p.cargado_por then
    raise exception 'Ese pago no lo podés marcar' using errcode = '42501';
  end if;
  if coalesce(p_objetar, false) then
    if p.objetado is null then
      update public.pagos x set objetado = now(), objetado_por = yo where x.id = p_pago;
      perform public.aviso_personal('pago_objetado', 'act:' || p.actividad::text, yo, p.cargado_por,
        (case when yo = p.a then 'no_recibio:' else 'no_pago:' end) || p.monto::text);
    end if;
  elsif p.objetado is not null then
    update public.pagos x set objetado = null, objetado_por = null where x.id = p_pago;
  end if;
end;
$$;
revoke execute on function public.pago_objetar(uuid, boolean) from public, anon;
grant execute on function public.pago_objetar(uuid, boolean) to authenticated;

-- Igual que la 17, con un solo cambio: un pago marcado como no reconocido no cuenta para el candado del pago repetido.
create or replace function public.pagos_validar_alta() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  a public.actividades%rowtype;
  yo uuid := (select auth.uid());
begin
  if yo is not null and (not public.en_cuentas(new.actividad) or yo not in (new.de, new.a)) then
    raise exception 'No tenés permiso' using errcode = '42501';
  end if;
  select * into a from public.actividades where id = new.actividad for share;
  if not found then
    raise exception 'La actividad no existe' using errcode = 'P0001';
  end if;
  if new.parte = 'tercer' and not a.tiene_tercer then
    raise exception 'La actividad no tiene tercer tiempo' using errcode = 'P0001';
  end if;
  if not public.figura_en_parte(new.actividad, new.parte, new.de) or not public.figura_en_parte(new.actividad, new.parte, new.a) then
    raise exception 'Esa persona no figura en las cuentas de esa parte' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pagos:' || new.actividad::text || ':' || new.parte, 0));
  if exists (select 1 from public.pagos p
              where p.actividad = new.actividad and p.parte = new.parte and p.de = new.de and p.a = new.a
                and p.monto = new.monto and p.objetado is null and p.creado > now() - interval '10 minutes') then
    raise exception 'Ese pago ya está registrado' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.pagos_validar_alta() from public, anon, authenticated;

-- ---- Mensajes de sistema ----
alter table public.mensajes drop constraint if exists mensajes_tipo_check;
alter table public.mensajes add constraint mensajes_tipo_check check (tipo in ('texto','foto','audio','video','sticker','eliminado','sistema'));
alter table public.mensajes drop constraint if exists mensajes_sistema_valido;
alter table public.mensajes add constraint mensajes_sistema_valido check (tipo <> 'sistema' or (
  texto in ('alta:actividad','alta:tercer','baja:actividad','baja:tercer')
  and archivo is null and externo is null and duracion_ms is null and responde_a is null and sala like 'act:%'));
-- (la policy mensajes_insert de la 27 ya deja insertar solo texto, foto, audio, video y sticker: 'sistema' lo pone solo el servidor)

-- eliminar_mensaje: igual que la 27, pero una línea de sistema no se elimina
create or replace function public.eliminar_mensaje(p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare vieja public.mensajes; nueva public.mensajes;
begin
  select * into vieja from public.mensajes m
   where m.id = p_id and m.autor = (select auth.uid()) and m.tipo not in ('eliminado', 'sistema')
     and public.es_miembro() and public.en_sala(m.sala)
   for update;
  if vieja.id is null then
    raise exception 'No se puede eliminar' using errcode = 'P0002';
  end if;
  update public.mensajes m set tipo = 'eliminado', texto = null, archivo = null, ancho = null, alto = null, duracion_ms = null, externo = null
   where m.id = p_id returning m.* into nueva;
  delete from public.chat_fijados f where f.mensaje = p_id;
  return jsonb_build_object('fila', to_jsonb(nueva), 'archivo_antes', vieja.archivo, 'tipo_antes', vieja.tipo);
end;
$$;

-- fijar_mensaje: igual que la 27, pero una línea de sistema no se fija
create or replace function public.fijar_mensaje(p_sala text, p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not (public.es_miembro() and public.en_sala(p_sala)) then
    raise exception 'No estás en este chat' using errcode = 'P0002';
  end if;
  if p_id is null then
    delete from public.chat_fijados f where f.sala = p_sala;
    return;
  end if;
  if not exists (select 1 from public.mensajes m where m.id = p_id and m.sala = p_sala and m.tipo not in ('eliminado', 'sistema')) then
    raise exception 'Ese mensaje no se puede fijar' using errcode = 'P0002';
  end if;
  insert into public.chat_fijados (sala, mensaje, por) values (p_sala, p_id, (select auth.uid()))
  on conflict (sala) do update set mensaje = excluded.mensaje, por = excluded.por, cuando = now();
end;
$$;
revoke execute on function public.fijar_mensaje(text, uuid) from public, anon;
grant execute on function public.fijar_mensaje(text, uuid) to authenticated;

-- reacciones_sala: igual que la 32, y tampoco a una línea de sistema
create or replace function public.reacciones_sala() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare s text; t text;
begin
  select m.sala, m.tipo into s, t from public.mensajes m where m.id = new.mensaje;
  if s is null or t in ('eliminado', 'sistema') or not public.en_sala(s) then
    raise exception 'No se puede reaccionar a este mensaje' using errcode = 'P0002';
  end if;
  new.sala := s;
  return new;
end;
$$;
revoke execute on function public.reacciones_sala() from public, anon, authenticated;

-- la cita tiene que ser de la misma sala y no a una línea de sistema
create or replace function public.mensajes_cita_valida() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.responde_a is not null and not exists (select 1 from public.mensajes m where m.id = new.responde_a and m.sala = new.sala and m.tipo <> 'sistema') then
    raise exception 'La respuesta tiene que ser a un mensaje del mismo chat' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.mensajes_cita_valida() from public, anon, authenticated;

-- ---- Registro de altas y bajas ----
-- AFTER: no toca la fila. Solo lo que hace la persona misma (auth.uid() = persona). Nunca corta el anotarse o bajarse.
create or replace function public.asistencias_registro() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  yo uuid := (select auth.uid());
  v_act uuid; v_persona uuid; v_parte text;
  a public.actividades%rowtype;
begin
  if tg_op = 'INSERT' then v_act := new.actividad; v_persona := new.persona; v_parte := new.parte;
  else v_act := old.actividad; v_persona := old.persona; v_parte := old.parte; end if;
  if yo is null or yo <> v_persona then return null; end if;
  begin
    select * into a from public.actividades x where x.id = v_act;
    if not found then return null; end if;                                    -- se está borrando la actividad
    if tg_op = 'INSERT' and v_persona = a.creador then return null; end if;   -- quien la armó se anota en la suya
    if tg_op = 'DELETE' and v_parte = 'tercer' and not a.tiene_tercer then return null; end if;
    insert into public.mensajes (sala, autor, tipo, texto)
      values ('act:' || v_act::text, v_persona, 'sistema', (case when tg_op = 'INSERT' then 'alta:' else 'baja:' end) || v_parte);
    if tg_op = 'DELETE' and a.estado <> 'cancelada' then
      perform public.aviso_personal('baja', 'act:' || v_act::text, v_persona, a.creador, v_parte);
    end if;
  exception when others then
    raise warning 'asistencias_registro: %', sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.asistencias_registro() from public, anon, authenticated;
drop trigger if exists asistencias_registro on public.asistencias;
create trigger asistencias_registro after insert or delete on public.asistencias
  for each row execute function public.asistencias_registro();

-- ---- Realtime ----
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gasto_rechazos') then
    alter publication supabase_realtime add table public.gasto_rechazos;
  end if;
end $$;

-- ---- Verificación (solo lectura) ----
select 'RESULTADO' as r, array_remove(array[
  case when (select count(*) from pg_constraint where conrelid = 'public.eventos_aviso'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%tipo%') <> 1 then 'eventos_aviso: no hay un solo check de tipo' end,
  case when not exists (select 1 from pg_constraint where conrelid = 'public.mensajes'::regclass and conname = 'mensajes_tipo_check' and pg_get_constraintdef(oid) like '%sistema%') then 'mensajes_tipo_check sin sistema' end,
  case when has_function_privilege('anon', 'public.gasto_no_estuve(uuid)', 'execute') then 'gasto_no_estuve ejecutable por anon' end,
  case when has_function_privilege('authenticated', 'public.aviso_personal(text,text,uuid,uuid,text)', 'execute') then 'aviso_personal ejecutable por authenticated' end,
  case when has_function_privilege('authenticated', 'public.asistencias_registro()', 'execute') then 'asistencias_registro ejecutable por authenticated' end,
  case when has_column_privilege('authenticated', 'public.pagos', 'objetado', 'UPDATE') or has_column_privilege('authenticated', 'public.pagos', 'objetado', 'INSERT') then 'pagos.objetado escribible' end,
  case when has_table_privilege('authenticated', 'public.gasto_rechazos', 'INSERT') or has_table_privilege('authenticated', 'public.gasto_rechazos', 'DELETE') then 'gasto_rechazos escribible' end,
  case when not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'pagos') then 'pagos fuera de Realtime' end,
  case when not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'gasto_rechazos') then 'gasto_rechazos fuera de Realtime' end,
  case when not exists (select 1 from pg_policies where tablename = 'gastos' and policyname = 'gastos_delete' and qual like '%pagador%' and qual not like '%figura_en_gasto%') then 'gastos_delete viejo' end,
  case when not exists (select 1 from pg_policies where tablename = 'pagos' and policyname = 'pagos_delete' and qual not like '%de =%') then 'pagos_delete viejo' end,
  case when not exists (select 1 from pg_trigger where tgname = 'asistencias_registro' and not tgisinternal) then 'falta el trigger asistencias_registro' end
], null) as fallas;
