-- 27: chat completo, como el de Rumbo al Sur pero en grupo. No borra ni pisa datos: agrega columnas en null, tablas
-- nuevas, y reemplaza checks, policies y funciones.
-- * mensajes: tipos 'audio', 'video' y 'sticker'; columnas duracion_ms (audio y video), responde_a (cita, de la misma
--   sala) y externo (sticker de GIPHY, solo https://media*.giphy.com/).
--   Archivos: <sala>/audios/<id>.<webm|ogg|m4a>, <sala>/videos/<id>.<mp4|webm> (con miniatura <id>.t.webp, igual que
--   las fotos) y stickers/<id>.webp (biblioteca de stickers de todo el grupo, tabla stickers).
-- * bucket 'chat': audio y video, hasta 100 MB (los videos); la carpeta stickers/ la ve y la usa cualquier miembro.
-- * mensaje_reacciones: una reacción por persona y mensaje, con clave (no emoji): corazon, risa, sorpresa, triste,
--   pulgar, fuego. Las ve y las pone quien está en la sala.
-- * chat_fijados: un mensaje fijado por sala; lo fija o lo saca cualquiera de la sala (fijar_mensaje).
-- * eliminar_mensaje: limpia también duracion_ms y externo, lo saca de fijados y devuelve tipo_antes (el cliente no
--   borra archivos de un sticker de la biblioteca ni pide la miniatura de un audio).
-- * avisos: el trigger de mensajes también encola audio, video y sticker.

-- ---- mensajes ----
alter table public.mensajes
  add column if not exists duracion_ms int null,
  add column if not exists responde_a uuid null references public.mensajes(id) on delete set null,
  add column if not exists externo text null;

alter table public.mensajes drop constraint if exists mensajes_duracion_check;
alter table public.mensajes add constraint mensajes_duracion_check check (duracion_ms is null or duracion_ms between 1 and 600000);
alter table public.mensajes drop constraint if exists mensajes_externo_check;
alter table public.mensajes add constraint mensajes_externo_check check (externo is null or (char_length(externo) <= 500 and externo ~ '^https://media[0-9]*\.giphy\.com/[^[:space:]<>"]*$'));
alter table public.mensajes drop constraint if exists mensajes_tipo_check;
alter table public.mensajes add constraint mensajes_tipo_check check (tipo in ('texto','foto','audio','video','sticker','eliminado'));
alter table public.mensajes drop constraint if exists mensajes_audio_valido;
alter table public.mensajes add constraint mensajes_audio_valido check (tipo <> 'audio' or (
  archivo is not null and starts_with(archivo, sala || '/audios/') and duracion_ms between 700 and 120000 and texto is null and externo is null));
alter table public.mensajes drop constraint if exists mensajes_video_valido;
alter table public.mensajes add constraint mensajes_video_valido check (tipo <> 'video' or (
  archivo is not null and starts_with(archivo, sala || '/videos/') and ancho is not null and alto is not null and duracion_ms is not null and texto is null and externo is null));
alter table public.mensajes drop constraint if exists mensajes_sticker_valido;
alter table public.mensajes add constraint mensajes_sticker_valido check (tipo <> 'sticker' or (
  texto is null and ((archivo is not null and starts_with(archivo, 'stickers/') and externo is null) or (archivo is null and externo is not null))));
alter table public.mensajes drop constraint if exists mensajes_eliminado_vacio;
alter table public.mensajes add constraint mensajes_eliminado_vacio check (tipo <> 'eliminado' or (texto is null and archivo is null and externo is null and duracion_ms is null));
-- el externo solo en stickers
alter table public.mensajes drop constraint if exists mensajes_externo_solo_sticker;
alter table public.mensajes add constraint mensajes_externo_solo_sticker check (externo is null or tipo = 'sticker');

-- la cita tiene que ser de la misma sala
create or replace function public.mensajes_cita_valida() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.responde_a is not null and not exists (select 1 from public.mensajes m where m.id = new.responde_a and m.sala = new.sala) then
    raise exception 'La respuesta tiene que ser a un mensaje del mismo chat' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.mensajes_cita_valida() from public, anon, authenticated;
drop trigger if exists mensajes_cita_valida on public.mensajes;
create trigger mensajes_cita_valida before insert on public.mensajes for each row execute function public.mensajes_cita_valida();

drop policy if exists mensajes_insert on public.mensajes;
create policy mensajes_insert on public.mensajes for insert to authenticated
  with check (public.es_miembro() and autor = (select auth.uid()) and tipo in ('texto','foto','audio','video','sticker') and public.en_sala(sala));
grant insert (sala, tipo, texto, archivo, ancho, alto, duracion_ms, responde_a, externo) on public.mensajes to authenticated;

-- ---- eliminar ----
create or replace function public.eliminar_mensaje(p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare vieja public.mensajes; nueva public.mensajes;
begin
  select * into vieja from public.mensajes m
   where m.id = p_id and m.autor = (select auth.uid()) and m.tipo <> 'eliminado'
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

-- ---- biblioteca de stickers (de todo el grupo) ----
create table if not exists public.stickers (
  id uuid primary key default gen_random_uuid(),
  archivo text not null unique check (archivo ~ '^stickers/[0-9a-f-]{36}\.webp$'),
  autor uuid not null default auth.uid() references public.perfiles(id) on delete cascade,
  creado timestamptz not null default now()
);
alter table public.stickers enable row level security;
revoke all on public.stickers from anon, authenticated;
grant select, delete on public.stickers to authenticated;
grant insert (archivo) on public.stickers to authenticated;
drop policy if exists stickers_select on public.stickers;
create policy stickers_select on public.stickers for select to authenticated using (public.es_miembro());
drop policy if exists stickers_insert on public.stickers;
create policy stickers_insert on public.stickers for insert to authenticated with check (public.es_miembro() and autor = (select auth.uid()));
drop policy if exists stickers_delete on public.stickers;
create policy stickers_delete on public.stickers for delete to authenticated using (public.es_miembro() and autor = (select auth.uid()));

-- ---- reacciones ----
create table if not exists public.mensaje_reacciones (
  mensaje uuid not null references public.mensajes(id) on delete cascade,
  persona uuid not null default auth.uid() references public.perfiles(id) on delete cascade,
  clave text not null check (clave in ('corazon','risa','sorpresa','triste','pulgar','fuego')),
  sala text not null,
  creado timestamptz not null default now(),
  primary key (mensaje, persona)
);
create index if not exists mensaje_reacciones_sala on public.mensaje_reacciones (sala);
alter table public.mensaje_reacciones enable row level security;
revoke all on public.mensaje_reacciones from anon, authenticated;
grant select, delete on public.mensaje_reacciones to authenticated;
grant insert (mensaje, clave, sala) on public.mensaje_reacciones to authenticated;
grant update (clave) on public.mensaje_reacciones to authenticated;
-- la sala se copia del mensaje (y se valida): así la RLS y Realtime filtran sin join
create or replace function public.reacciones_sala() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare s text; t text;
begin
  select m.sala, m.tipo into s, t from public.mensajes m where m.id = new.mensaje;
  if s is null or t = 'eliminado' then
    raise exception 'No se puede reaccionar a este mensaje' using errcode = 'P0002';
  end if;
  new.sala := s;
  return new;
end;
$$;
revoke execute on function public.reacciones_sala() from public, anon, authenticated;
drop trigger if exists reacciones_sala on public.mensaje_reacciones;
create trigger reacciones_sala before insert or update on public.mensaje_reacciones for each row execute function public.reacciones_sala();
drop policy if exists reacciones_select on public.mensaje_reacciones;
create policy reacciones_select on public.mensaje_reacciones for select to authenticated using (public.es_miembro() and public.en_sala(sala));
drop policy if exists reacciones_insert on public.mensaje_reacciones;
create policy reacciones_insert on public.mensaje_reacciones for insert to authenticated
  with check (public.es_miembro() and persona = (select auth.uid()) and public.en_sala(sala));
drop policy if exists reacciones_update on public.mensaje_reacciones;
create policy reacciones_update on public.mensaje_reacciones for update to authenticated
  using (public.es_miembro() and persona = (select auth.uid()) and public.en_sala(sala))
  with check (public.es_miembro() and persona = (select auth.uid()) and public.en_sala(sala));
drop policy if exists reacciones_delete on public.mensaje_reacciones;
create policy reacciones_delete on public.mensaje_reacciones for delete to authenticated
  using (persona = (select auth.uid()));

-- ---- fijado (uno por sala) ----
create table if not exists public.chat_fijados (
  sala text primary key,
  mensaje uuid not null references public.mensajes(id) on delete cascade,
  por uuid not null references public.perfiles(id) on delete cascade,
  cuando timestamptz not null default now()
);
alter table public.chat_fijados enable row level security;
revoke all on public.chat_fijados from anon, authenticated;
grant select on public.chat_fijados to authenticated;
drop policy if exists fijados_select on public.chat_fijados;
create policy fijados_select on public.chat_fijados for select to authenticated using (public.es_miembro() and public.en_sala(sala));
-- p_id null: saca el fijado de la sala
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
  if not exists (select 1 from public.mensajes m where m.id = p_id and m.sala = p_sala and m.tipo <> 'eliminado') then
    raise exception 'Ese mensaje no se puede fijar' using errcode = 'P0002';
  end if;
  insert into public.chat_fijados (sala, mensaje, por) values (p_sala, p_id, (select auth.uid()))
  on conflict (sala) do update set mensaje = excluded.mensaje, por = excluded.por, cuando = now();
end;
$$;
revoke execute on function public.fijar_mensaje(text, uuid) from public, anon;
grant execute on function public.fijar_mensaje(text, uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mensaje_reacciones') then
    alter publication supabase_realtime add table public.mensaje_reacciones;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_fijados') then
    alter publication supabase_realtime add table public.chat_fijados;
  end if;
end $$;
-- los DELETE de Realtime traen la fila vieja completa (para saber de qué sala era)
alter table public.mensaje_reacciones replica identity full;
alter table public.chat_fijados replica identity full;

-- ---- bucket 'chat' ----
update storage.buckets set file_size_limit = 104857600,
  allowed_mime_types = array['image/webp','image/jpeg','audio/webm','audio/ogg','audio/mp4','video/mp4','video/webm']
 where id = 'chat';
drop policy if exists chat_select on storage.objects;
create policy chat_select on storage.objects for select to authenticated
  using (bucket_id = 'chat' and public.es_miembro() and (
    public.en_sala((storage.foldername(name))[1]) or (storage.foldername(name))[1] = 'stickers'));
drop policy if exists chat_insert on storage.objects;
create policy chat_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'chat' and public.es_miembro() and (
    ((storage.foldername(name))[2] in ('fotos','audios','videos') and public.en_sala((storage.foldername(name))[1]))
    or (storage.foldername(name))[1] = 'stickers'));
drop policy if exists chat_delete on storage.objects;
create policy chat_delete on storage.objects for delete to authenticated
  using (bucket_id = 'chat' and owner_id = (select auth.uid())::text and (
    public.en_sala((storage.foldername(name))[1]) or (storage.foldername(name))[1] = 'stickers'));

-- ---- avisos: también audio, video y sticker ----
drop trigger if exists avisos_mensaje on public.mensajes;
create trigger avisos_mensaje after insert on public.mensajes
  for each row when (new.tipo in ('texto','foto','audio','video','sticker')) execute function public.avisos_mensaje();
