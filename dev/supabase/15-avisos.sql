-- Avisos push (Task 6). Solo crea o altera: no toca filas.
-- - push_subs: una fila por teléfono/navegador suscripto. Cada uno ve y borra solo las suyas. Se registra con el RPC
--   push_registrar (si el teléfono cambió de dueño, la suscripción pasa a quien la registra ahora).
-- - eventos_aviso: cola que llenan los triggers (AFTER: no tocan NEW ni chocan con actividades_no_reabrir) y que vacía la
--   Edge Function avisos con {tipo:'cambios'} cada minuto. El cliente no la lee ni la escribe.
--     insert de actividades                        → 'nueva'      (a todos los miembros menos el creador)
--     update de estado / fecha / lugar             → 'confirmada' | 'cancelada' | 'reabierta' | 'cambio' (a los anotados menos quien cambió)
--     insert de mensajes (texto o foto)            → 'mensaje'    (a los de la sala menos el autor, agrupados con SILENCIO_MS)
-- - avisos_probar(): aviso de prueba a tus propios teléfonos (uno cada 30 s como mucho).
-- - avisos_llamar: igual que en la 13, con timeout de 60 s (la función responde 202 enseguida igual).
-- - pg_cron: 'avisos-cambios' cada minuto y 'avisos-diario' a las 15:00 UTC (12:00 en Argentina).
--   Sin el secreto 'avisos_cron_secret' en Vault, avisos_llamar no hace nada.

-- ---- push_subs ----
create table if not exists public.push_subs (
  endpoint text primary key check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  persona uuid not null references public.perfiles(id) on delete cascade,
  p256dh text not null check (char_length(p256dh) between 1 and 200),
  auth text not null check (char_length(auth) between 1 and 100),
  creado timestamptz not null default now()
);
create index if not exists push_subs_persona_idx on public.push_subs (persona);
alter table public.push_subs enable row level security;
revoke all on public.push_subs from anon, authenticated;
grant select, delete on public.push_subs to authenticated;

drop policy if exists push_subs_ver on public.push_subs;
create policy push_subs_ver on public.push_subs for select to authenticated
  using (persona = (select auth.uid()));
drop policy if exists push_subs_borrar on public.push_subs;
create policy push_subs_borrar on public.push_subs for delete to authenticated
  using (persona = (select auth.uid()));

-- Alta o renovación de la suscripción de este teléfono, a nombre de quien la llama.
create or replace function public.push_registrar(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.es_miembro() then
    raise exception 'Solo miembros' using errcode = '42501';
  end if;
  insert into public.push_subs (endpoint, persona, p256dh, auth)
  values (p_endpoint, (select auth.uid()), p_p256dh, p_auth)
  on conflict (endpoint) do update
    set persona = excluded.persona, p256dh = excluded.p256dh, auth = excluded.auth, creado = now();
end;
$$;
revoke execute on function public.push_registrar(text, text, text) from public, anon;
grant execute on function public.push_registrar(text, text, text) to authenticated;

-- ---- Cola de eventos ----
create table if not exists public.eventos_aviso (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('nueva','confirmada','cambio','cancelada','reabierta','mensaje','prueba')),
  actividad uuid null,
  sala text null,
  autor uuid null,
  mensaje uuid null,
  creado timestamptz not null default now()
);
alter table public.eventos_aviso enable row level security;
revoke all on public.eventos_aviso from anon, authenticated;
-- sin políticas: solo service_role (la Edge Function) y los triggers SECURITY DEFINER

-- Actividad nueva o cambiada. AFTER y sin tocar NEW: nunca cambia lo que se guarda. Un error acá no frena el guardado.
create or replace function public.avisos_actividad() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare t text;
begin
  begin
    if tg_op = 'INSERT' then
      t := 'nueva';
    elsif new.estado is distinct from old.estado then
      t := case
        when new.estado = 'confirmada' then 'confirmada'
        when new.estado = 'cancelada' then 'cancelada'
        when old.estado = 'cancelada' then 'reabierta'
        else 'cambio' end;
    elsif new.fecha is distinct from old.fecha or new.lugar is distinct from old.lugar then
      t := 'cambio';
    else
      return null;
    end if;
    insert into public.eventos_aviso (tipo, actividad, autor)
    values (t, new.id, coalesce((select auth.uid()), new.creador));
  exception when others then
    raise warning 'avisos_actividad: %', sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.avisos_actividad() from public, anon, authenticated;
drop trigger if exists avisos_actividad_nueva on public.actividades;
create trigger avisos_actividad_nueva after insert on public.actividades
  for each row execute function public.avisos_actividad();
drop trigger if exists avisos_actividad_cambio on public.actividades;
create trigger avisos_actividad_cambio after update of estado, fecha, lugar on public.actividades
  for each row execute function public.avisos_actividad();

-- Mensaje nuevo (texto o foto) en una sala de actividad o de partida.
create or replace function public.avisos_mensaje() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  begin
    insert into public.eventos_aviso (tipo, sala, autor, mensaje) values ('mensaje', new.sala, new.autor, new.id);
  exception when others then
    raise warning 'avisos_mensaje: %', sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.avisos_mensaje() from public, anon, authenticated;
drop trigger if exists avisos_mensaje on public.mensajes;
create trigger avisos_mensaje after insert on public.mensajes
  for each row when (new.tipo in ('texto','foto')) execute function public.avisos_mensaje();

-- ---- Llamar a la Edge Function (mismo cuerpo que la 13, con 60 s de timeout) ----
create or replace function public.avisos_llamar(p_body jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare secreto text;
begin
  select s.decrypted_secret into secreto from vault.decrypted_secrets s where s.name = 'avisos_cron_secret';
  if secreto is null or secreto = '' then
    return; -- sin secreto cargado no se llama (la función respondería 401)
  end if;
  perform net.http_post(
    url := 'https://qvezbnkrfqewanlcejha.supabase.co/functions/v1/avisos',
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secreto),
    timeout_milliseconds := 60000);
end;
$$;
revoke execute on function public.avisos_llamar(jsonb) from public, anon, authenticated;

-- Aviso de prueba a tus propios teléfonos (botón de Perfil). Uno cada 30 s como mucho.
create or replace function public.avisos_probar() returns boolean
language plpgsql security definer set search_path = ''
as $$
declare yo uuid := (select auth.uid());
begin
  if not public.es_miembro() then
    raise exception 'Solo miembros' using errcode = '42501';
  end if;
  if exists (select 1 from public.eventos_aviso e where e.tipo = 'prueba' and e.autor = yo and e.creado > now() - interval '30 seconds') then
    return false;
  end if;
  insert into public.eventos_aviso (tipo, autor) values ('prueba', yo);
  perform public.avisos_llamar(jsonb_build_object('tipo', 'cambios'));
  return true;
end;
$$;
revoke execute on function public.avisos_probar() from public, anon;
grant execute on function public.avisos_probar() to authenticated;

-- ---- pg_cron (idempotente: si ya existen, se reprograman) ----
select cron.schedule('avisos-cambios', '* * * * *', $$select public.avisos_llamar('{"tipo":"cambios"}'::jsonb)$$);
select cron.schedule('avisos-diario', '0 15 * * *', $$select public.avisos_llamar('{"tipo":"diario"}'::jsonb)$$);
-- Para apagarlos:
--   select cron.unschedule('avisos-cambios'); select cron.unschedule('avisos-diario');
