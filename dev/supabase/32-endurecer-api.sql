-- 32 Endurecer la API (auditoría 2026-11-14): lo que un miembro logueado podía hacer pegándole directo a la API con su
-- JWT y la clave publishable, sin pasar por la app. Nada de esto cambia lo que la app hace normalmente.
--
-- 1. Cuota de Storage por persona: antes un miembro podía llenar el 1 GB del proyecto subiendo en loop (archivos de
--    hasta 100 MB en chat y álbum, sin tope de cantidad) y cortarle las subidas a todos.
--    chat: 300 MB y 2000 archivos por persona; álbum: 350 MB y 4000 archivos por persona (la foto son 3 archivos).
-- 2. Límite de velocidad por persona (trigger BEFORE INSERT): mensajes 40 por minuto, actividades 10 por hora (cada
--    una avisa a todos), fotos 200 cada 10 min (la cola offline sube en ráfaga), stickers 30 por día, partidas 15 por hora.
-- 3. perfiles.foto: solo el avatar propio (<id>/avatar?v=<número>); antes aceptaba cualquier texto, incluso el avatar
--    de otro. NOT VALID: no revisa las filas viejas (la consulta de abajo las muestra).
-- 4. reacciones_sala: reaccionar a un mensaje de una sala en la que no estás da el mismo error que si no existiera
--    (antes la diferencia confirmaba que el mensaje existía).
-- Al final, una consulta que tiene que dar "RESULTADO" con fallas vacío.

-- ---- 1. Cuota de Storage ----
create or replace function public.cuota_ok(p_bucket text, p_max_bytes bigint, p_max_objs int) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0) < p_max_bytes and count(*) < p_max_objs
    from storage.objects o
   where o.bucket_id = p_bucket and o.owner_id = (select auth.uid())::text
$$;
revoke execute on function public.cuota_ok(text, bigint, int) from public, anon;
grant execute on function public.cuota_ok(text, bigint, int) to authenticated;

drop policy if exists chat_insert on storage.objects;
create policy chat_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'chat' and public.es_miembro()
    and public.cuota_ok('chat', 300 * 1048576, 2000)
    and (
      (name ~ '^(act|par):[0-9a-f-]{36}/(fotos/[0-9a-f-]{36}\.(t\.)?webp|audios/[0-9a-f-]{36}\.(webm|ogg|m4a)|videos/[0-9a-f-]{36}\.(mp4|webm|t\.webp))$'
        and public.en_sala((storage.foldername(name))[1]))
      or (name ~ '^stickers/[0-9a-f-]{36}\.webp$' and coalesce((metadata->>'size')::bigint, 0) <= 1048576)));

alter policy album_insert on storage.objects with check (
  bucket_id = 'album'
  and public.es_miembro()
  and public.cuota_ok('album', 350 * 1048576, 4000)
  and array_length(storage.foldername(name), 1) = 1
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|t\.webp|m\.jpg|mp4|webm)$'
  and public.en_album((storage.foldername(name))[1]));

-- ---- 2. Límite de velocidad ----
-- tg_argv: columna de la persona ('autor' | 'creador'), máximo, ventana en segundos. Las cuentas de servidor
-- (service_role, sin auth.uid()) no tienen límite.
create or replace function public.limite_filas() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_col text := tg_argv[0];
  v_max int := tg_argv[1]::int;
  v_seg int := tg_argv[2]::int;
  v_uid uuid;
  n int;
begin
  if (select auth.uid()) is null then return new; end if;
  if v_col not in ('autor', 'creador') then raise exception 'limite_filas: columna inválida'; end if;
  v_uid := (to_jsonb(new) ->> v_col)::uuid;
  execute format('select count(*) from %I.%I where %I = $1 and creado > now() - make_interval(secs => $2)',
                 tg_table_schema, tg_table_name, v_col)
     into n using v_uid, v_seg;
  if n >= v_max then
    raise exception 'Vas muy rápido: probá de nuevo en un rato' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.limite_filas() from public, anon, authenticated;

create index if not exists mensajes_autor_creado_idx on public.mensajes (autor, creado desc);
create index if not exists actividades_creador_creado_idx on public.actividades (creador, creado desc);
create index if not exists fotos_autor_creado_idx on public.fotos (autor, creado desc);
create index if not exists stickers_autor_creado_idx on public.stickers (autor, creado desc);

drop trigger if exists limite_mensajes on public.mensajes;
create trigger limite_mensajes before insert on public.mensajes for each row execute function public.limite_filas('autor', 40, 60);
drop trigger if exists limite_actividades on public.actividades;
create trigger limite_actividades before insert on public.actividades for each row execute function public.limite_filas('creador', 10, 3600);
drop trigger if exists limite_fotos on public.fotos;
create trigger limite_fotos before insert on public.fotos for each row execute function public.limite_filas('autor', 200, 600);
drop trigger if exists limite_stickers on public.stickers;
create trigger limite_stickers before insert on public.stickers for each row execute function public.limite_filas('autor', 30, 86400);
drop trigger if exists limite_partidas on public.partidas;
create trigger limite_partidas before insert on public.partidas for each row execute function public.limite_filas('creador', 15, 3600);

-- ---- 3. perfiles.foto ----
alter table public.perfiles drop constraint if exists perfiles_foto_propia;
alter table public.perfiles add constraint perfiles_foto_propia
  check (foto is null or foto ~ ('^' || id::text || '/avatar(\?v=[0-9]{1,16})?$')) not valid;

-- ---- 4. reacciones_sala sin oráculo ----
create or replace function public.reacciones_sala() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare s text; t text;
begin
  select m.sala, m.tipo into s, t from public.mensajes m where m.id = new.mensaje;
  if s is null or t = 'eliminado' or not public.en_sala(s) then
    raise exception 'No se puede reaccionar a este mensaje' using errcode = 'P0002';
  end if;
  new.sala := s;
  return new;
end;
$$;
revoke execute on function public.reacciones_sala() from public, anon, authenticated;

-- ---- Verificación (solo lectura) ----
select 'RESULTADO' as r, array_remove(array[
  case when has_function_privilege('anon', 'public.cuota_ok(text,bigint,int)', 'execute') then 'cuota_ok ejecutable por anon' end,
  case when has_function_privilege('authenticated', 'public.limite_filas()', 'execute') then 'limite_filas ejecutable por authenticated' end,
  case when (select count(*) from pg_trigger where tgname like 'limite\_%' and not tgisinternal) <> 5 then 'faltan triggers de límite' end,
  case when not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'chat_insert' and with_check like '%cuota_ok%') then 'chat_insert sin cuota' end,
  case when not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'album_insert' and with_check like '%cuota_ok%') then 'album_insert sin cuota' end,
  case when not exists (select 1 from pg_constraint where conname = 'perfiles_foto_propia') then 'falta perfiles_foto_propia' end
], null) as fallas,
(select count(*) from public.perfiles where foto is not null and foto !~ ('^' || id::text || '/avatar(\?v=[0-9]{1,16})?$')) as fotos_viejas_fuera_de_formato;
