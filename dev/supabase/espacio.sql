-- Espacio usado contra el plan gratis (500 MB de base, 1 GB de archivos). SOLO LECTURA: no cambia nada.
-- Se corre en el SQL Editor; devuelve una sola tabla.
with buckets as (
  select bucket_id as cosa,
         count(*) as cantidad,
         coalesce(sum((metadata->>'size')::bigint), 0) as bytes
    from storage.objects group by bucket_id
),
album as (
  select case when name ~ '\.t\.webp$' then 'album: miniaturas'
              when name ~ '\.m\.jpg$' then 'album: medias 1600 px'
              when name ~ '\.(mp4|webm)$' then 'album: videos'
              else 'album: fotos originales' end as cosa,
         count(*) as cantidad, coalesce(sum((metadata->>'size')::bigint), 0) as bytes
    from storage.objects where bucket_id = 'album' group by 1
),
chat as (
  select 'chat: ' || coalesce(nullif(split_part(split_part(name, '/', 2), '/', 1), ''), split_part(name, '/', 1)) as cosa,
         count(*) as cantidad, coalesce(sum((metadata->>'size')::bigint), 0) as bytes
    from storage.objects where bucket_id = 'chat' group by 1
)
select 'BASE (límite 500 MB)' as cosa, null::bigint as cantidad, pg_database_size(current_database()) as bytes,
       pg_size_pretty(pg_database_size(current_database())) as tam
union all
select 'ARCHIVOS en total (límite 1 GB)', sum(cantidad), sum(bytes), pg_size_pretty(sum(bytes)) from buckets
union all select 'bucket ' || cosa, cantidad, bytes, pg_size_pretty(bytes) from buckets
union all select cosa, cantidad, bytes, pg_size_pretty(bytes) from album
union all select cosa, cantidad, bytes, pg_size_pretty(bytes) from chat
union all select 'miembros activos', (select count(*) from public.perfiles where activo), null, null
union all select 'actividades', (select count(*) from public.actividades), null, null
union all select 'mensajes', (select count(*) from public.mensajes), null, null
union all select 'fotos y videos del álbum', (select count(*) from public.fotos), null, null
union all select 'fotos liberadas (original solo en Drive)', (select count(*) from public.fotos where liberada), null, null
union all select 'suscripciones de avisos', (select count(*) from public.push_subs), null, null
union all
select 'tabla ' || relname, null, pg_total_relation_size(c.oid), pg_size_pretty(pg_total_relation_size(c.oid))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
   and pg_total_relation_size(c.oid) > 1024 * 1024;
