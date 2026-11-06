-- Chat por actividad (sala 'act:<uuid>') y, más adelante, por partida (sala 'par:<uuid>').
-- Lee y escribe quien está en la sala (en_sala). Editar y eliminar solo el autor, por RPC (sin UPDATE/DELETE directo).

-- ---- ¿Estoy en esta sala? ----
-- 'act:<uuid>': anotado a cualquier parte de la actividad. 'par:<uuid>': false hasta que exista la tabla de jugadores (Task 7).
-- Cualquier otra cosa (null, uuid mal formado, mayúsculas) da false, nunca error.
-- SECURITY DEFINER: lee asistencias sin pasar por su RLS (evita recursión) y sirve en policies de tabla y de storage.
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
  return false;
end;
$$;
revoke execute on function public.en_sala(text) from public, anon;
grant execute on function public.en_sala(text) to authenticated;

-- ---- Mensajes ----
create table if not exists public.mensajes (
  id uuid primary key default gen_random_uuid(),
  sala text not null check (sala ~ '^(act|par):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  autor uuid not null default auth.uid() references public.perfiles(id) on delete cascade,
  tipo text not null default 'texto' check (tipo in ('texto','foto','eliminado')),
  texto text null check (texto is null or char_length(texto) <= 2000),
  archivo text null check (archivo is null or char_length(archivo) <= 200),
  ancho int null check (ancho is null or ancho between 1 and 4000),
  alto int null check (alto is null or alto between 1 and 4000),
  editado boolean not null default false,
  creado timestamptz not null default now(),
  constraint mensajes_texto_valido check (tipo <> 'texto' or (texto is not null and char_length(btrim(texto)) >= 1 and archivo is null)),
  constraint mensajes_foto_valida check (tipo <> 'foto' or (archivo is not null and starts_with(archivo, sala || '/fotos/') and ancho is not null and alto is not null)),
  constraint mensajes_eliminado_vacio check (tipo <> 'eliminado' or (texto is null and archivo is null))
);
create index if not exists mensajes_sala_creado_idx on public.mensajes (sala, creado desc);
create index if not exists mensajes_autor_idx on public.mensajes (autor);

alter table public.mensajes enable row level security;

drop policy if exists mensajes_select on public.mensajes;
create policy mensajes_select on public.mensajes for select to authenticated
  using (public.es_miembro() and public.en_sala(sala));
drop policy if exists mensajes_insert on public.mensajes;
create policy mensajes_insert on public.mensajes for insert to authenticated
  with check (public.es_miembro() and autor = (select auth.uid()) and tipo in ('texto','foto') and public.en_sala(sala));
-- Sin policy de update ni delete: se edita y se elimina con las funciones de abajo.

-- Grants mínimos. El SELECT de la tabla es lo que deja a Realtime entregar los UPDATE (editar/eliminar en vivo).
revoke all on public.mensajes from anon, authenticated;
grant select on public.mensajes to authenticated;
grant insert (sala, tipo, texto, archivo, ancho, alto) on public.mensajes to authenticated;

-- ---- Editar mi mensaje de texto (15 minutos) ----
create or replace function public.editar_mensaje(p_id uuid, p_texto text) returns public.mensajes
language plpgsql security definer set search_path = ''
as $$
declare r public.mensajes;
begin
  if p_texto is null or char_length(btrim(p_texto)) < 1 or char_length(p_texto) > 2000 then
    raise exception 'Texto inválido' using errcode = '22023';
  end if;
  update public.mensajes m
     set texto = p_texto, editado = true
   where m.id = p_id and m.autor = (select auth.uid()) and m.tipo = 'texto'
     and m.creado > now() - interval '15 minutes' and public.en_sala(m.sala)
  returning m.* into r;
  if r.id is null then
    raise exception 'No se puede editar' using errcode = 'P0002';
  end if;
  return r;
end;
$$;
revoke execute on function public.editar_mensaje(uuid, text) from public, anon;
grant execute on function public.editar_mensaje(uuid, text) to authenticated;

-- ---- Eliminar mi mensaje para todos (queda la marca "se eliminó este mensaje") ----
-- Devuelve la fila nueva y el archivo que tenía, para que el cliente lo borre de Storage.
create or replace function public.eliminar_mensaje(p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare vieja public.mensajes; nueva public.mensajes;
begin
  select * into vieja from public.mensajes m
   where m.id = p_id and m.autor = (select auth.uid()) and m.tipo <> 'eliminado' and public.en_sala(m.sala)
   for update;
  if vieja.id is null then
    raise exception 'No se puede eliminar' using errcode = 'P0002';
  end if;
  update public.mensajes set tipo = 'eliminado', texto = null, archivo = null, ancho = null, alto = null
   where id = p_id returning * into nueva;
  return jsonb_build_object('fila', to_jsonb(nueva), 'archivo_antes', vieja.archivo);
end;
$$;
revoke execute on function public.eliminar_mensaje(uuid) from public, anon;
grant execute on function public.eliminar_mensaje(uuid) to authenticated;

-- ---- Realtime ----
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mensajes') then
    alter publication supabase_realtime add table public.mensajes;
  end if;
end $$;

-- ---- Storage: bucket privado 'chat', carpeta <sala>/fotos/... ----
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat', 'chat', false, 8388608, array['image/webp','image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 8388608, allowed_mime_types = array['image/webp','image/jpeg'];

drop policy if exists chat_select on storage.objects;
create policy chat_select on storage.objects for select to authenticated
  using (bucket_id = 'chat' and public.es_miembro() and public.en_sala((storage.foldername(name))[1]));
drop policy if exists chat_insert on storage.objects;
create policy chat_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'chat' and public.es_miembro() and (storage.foldername(name))[2] = 'fotos' and public.en_sala((storage.foldername(name))[1]));
drop policy if exists chat_delete on storage.objects;
create policy chat_delete on storage.objects for delete to authenticated
  using (bucket_id = 'chat' and owner_id = (select auth.uid())::text and public.en_sala((storage.foldername(name))[1]));
