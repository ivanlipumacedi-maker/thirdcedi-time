-- Ajustes de los avisos push (review de la Task 6). Solo crea o reemplaza: no toca filas.
-- - avisos_pruebas: el límite de avisos_probar (uno cada 30 s) se lleva acá. Antes se miraba la fila 'prueba' de
--   eventos_aviso, pero cambios() la consume enseguida y el límite no frenaba nada. Sin grants para el cliente.
-- - push_registrar: solo acepta servicios de push conocidos (Google, Apple, Mozilla, Microsoft) y deja como mucho
--   10 suscripciones por persona (al pasarse, se borra la más vieja de esa persona).
-- - avisos_actividad: volver a 'abierta' (desde confirmada o desde cancelada) es 'reabierta' ("… volvió a estar abierta").

-- ---- Límite de las pruebas ----
create table if not exists public.avisos_pruebas (
  persona uuid primary key references public.perfiles(id) on delete cascade,
  ultima timestamptz not null default now()
);
alter table public.avisos_pruebas enable row level security;
revoke all on public.avisos_pruebas from anon, authenticated;
-- sin políticas: solo la toca avisos_probar (SECURITY DEFINER)

create or replace function public.avisos_probar() returns boolean
language plpgsql security definer set search_path = ''
as $$
declare yo uuid := (select auth.uid());
declare paso boolean;
begin
  if not public.es_miembro() then
    raise exception 'Solo miembros' using errcode = '42501';
  end if;
  insert into public.avisos_pruebas as p (persona, ultima) values (yo, now())
  on conflict (persona) do update set ultima = now()
    where p.ultima < now() - interval '30 seconds'
  returning true into paso;
  if paso is null then
    return false;
  end if;
  insert into public.eventos_aviso (tipo, autor) values ('prueba', yo);
  perform public.avisos_llamar(jsonb_build_object('tipo', 'cambios'));
  return true;
end;
$$;
revoke execute on function public.avisos_probar() from public, anon;
grant execute on function public.avisos_probar() to authenticated;

-- ---- Alta de suscripciones ----
create or replace function public.push_registrar(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = ''
as $$
declare yo uuid := (select auth.uid());
declare host text := lower(substring(coalesce(p_endpoint, '') from '^https://([^/?#@:]+)(/|$)'));
begin
  if not public.es_miembro() then
    raise exception 'Solo miembros' using errcode = '42501';
  end if;
  if host is null or host !~ ('^(fcm\.googleapis\.com|web\.push\.apple\.com|updates\.push\.services\.mozilla\.com'
      || '|([a-z0-9-]+\.)+push\.apple\.com|([a-z0-9-]+\.)+push\.services\.mozilla\.com|([a-z0-9-]+\.)+notify\.windows\.com)$') then
    raise exception 'Servicio de push desconocido' using errcode = '22023';
  end if;
  insert into public.push_subs (endpoint, persona, p256dh, auth)
  values (p_endpoint, yo, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set persona = excluded.persona, p256dh = excluded.p256dh, auth = excluded.auth, creado = now();
  -- tope de 10 por persona: quedan las más nuevas
  delete from public.push_subs s
  where s.persona = yo
    and s.endpoint not in (select x.endpoint from public.push_subs x where x.persona = yo order by x.creado desc, x.endpoint limit 10);
end;
$$;
revoke execute on function public.push_registrar(text, text, text) from public, anon;
grant execute on function public.push_registrar(text, text, text) to authenticated;

-- ---- Trigger de actividades ----
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
        when new.estado = 'abierta' then 'reabierta'
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
