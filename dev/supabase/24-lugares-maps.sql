-- 24: lugares con link de Google Maps (como la hoja de ruta de Rumbo al Sur). No borra ni pisa filas: solo agrega columnas
-- que quedan en null y sus grants.
-- * lugar_link: link de Maps del lugar (la cancha, el punto de encuentro, dónde es el asado...).
-- * destino / destino_link: a dónde se va (lo usa el trekking). El nombre es obligatorio si hay link.
-- * tercer_link: link de Maps del lugar del tercer tiempo (solo si hay tercer tiempo).
-- El cliente guarda el link ya normalizado (acepta el texto entero que copia Maps al compartir). Acá solo se exige https
-- a un dominio de Google Maps; el cliente además lo vuelve a validar antes de mostrarlo como link.

alter table public.actividades
  add column if not exists lugar_link text null,
  add column if not exists destino text null,
  add column if not exists destino_link text null,
  add column if not exists tercer_link text null;

do $$
declare
  -- los mismos dominios que acepta el cliente (linkMaps): en google.* solo /maps... (o la raíz de maps.google.*), así
  -- no entran los redirectores de Google (/url?q=...) ni un google.com.xx que podría registrar otro
  t constant text := '(com|com\.ar|cl|com\.uy|com\.py|com\.bo|com\.pe|com\.br|com\.mx|es|co|com\.co|com\.ec|co\.ve|us|co\.uk|fr|it|de)';
  re constant text := '^https://(maps\.app\.goo\.gl/|goo\.gl/maps|(www\.|maps\.)?google\.' || t || '/maps|maps\.google\.' || t || '/([?#]|$))[^[:space:]<>"]*$';
begin
  alter table public.actividades drop constraint if exists actividades_links_maps;
  execute format($f$alter table public.actividades add constraint actividades_links_maps check (
    (lugar_link is null or (char_length(lugar_link) <= 600 and lugar_link ~ %1$L))
    and (destino_link is null or (char_length(destino_link) <= 600 and destino_link ~ %1$L))
    and (tercer_link is null or (char_length(tercer_link) <= 600 and tercer_link ~ %1$L))
  )$f$, re);
end $$;

alter table public.actividades drop constraint if exists actividades_destino;
alter table public.actividades add constraint actividades_destino check (
  (destino is null or char_length(btrim(destino)) between 1 and 120)
  and (destino_link is null or destino is not null)
);

alter table public.actividades drop constraint if exists actividades_tercer_link;
alter table public.actividades add constraint actividades_tercer_link check (tiene_tercer or tercer_link is null);

grant insert (lugar_link, destino, destino_link, tercer_link) on public.actividades to authenticated;
grant update (lugar_link, destino, destino_link, tercer_link) on public.actividades to authenticated;
