-- Ajustes del chat (fix rounds 1 a 3 de la Task 4). Reemplaza funciones y el check mensajes_texto_valido: no toca datos.
-- - recortar_como_trim(t): recorta igual que String.prototype.trim() de JS (btrim no alcanza: solo saca espacios,
--   y trim() también saca tab, saltos de línea, VT, FF, NBSP, U+FEFF, los espacios Unicode Zs y U+2028/2029).
--   La clase de blancos está solo acá; la usan editar_mensaje y el check mensajes_texto_valido.
--   Va con escapes \uXXXX del motor de regex, escrita en E'' con la barra doblada (así no depende de
--   standard_conforming_strings). dev/tests/chat-logica.test.js la lee de este archivo y la compara con trim().
-- - editar_mensaje: guarda el texto recortado con recortar_como_trim. Si no cambió (se comparan los dos recortados,
--   como L.textoEditado), devuelve la fila tal cual (sin marcar editado). Exige además ser miembro (es_miembro).
-- - eliminar_mensaje: exige además ser miembro (es_miembro).
-- - mensajes_texto_valido: la misma condición de la 08, pero recortando con recortar_como_trim en vez de btrim
--   (así un INSERT directo con solo "\n" ya no pasa). Al agregarlo, Postgres valida las filas que ya están: si alguna
--   no cumple, el alter falla y no cambia nada. Para mirarlo antes de aplicar (solo lectura):
--   select id from public.mensajes where tipo = 'texto' and char_length(public.recortar_como_trim(texto)) < 1;
-- Mismo contrato que la 08: P0002 si no se puede (no es tuyo, pasaron los 15 minutos, ya no estás en la sala o no sos miembro).

create or replace function public.recortar_como_trim(t text) returns text
language sql immutable parallel safe set search_path = ''
as $$
  -- blancos de trim(): TAB, LF, VT, FF, CR, SP, NBSP, U+1680, U+2000-200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF
  select regexp_replace(t, '^' || c.blancos || '+|' || c.blancos || '+$', '', 'g')
    from (select E'[\\u0009-\\u000d\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]'::text as blancos) as c
$$;

create or replace function public.editar_mensaje(p_id uuid, p_texto text) returns public.mensajes
language plpgsql security definer set search_path = ''
as $$
declare
  r public.mensajes;
  t text := public.recortar_como_trim(p_texto);
begin
  if t is null or char_length(t) < 1 or char_length(t) > 2000 then
    raise exception 'Texto inválido' using errcode = '22023';
  end if;
  select * into r from public.mensajes m
   where m.id = p_id and m.autor = (select auth.uid()) and m.tipo = 'texto'
     and m.creado > now() - interval '15 minutes'
     and public.es_miembro() and public.en_sala(m.sala)
   for update;
  if r.id is null then
    raise exception 'No se puede editar' using errcode = 'P0002';
  end if;
  if public.recortar_como_trim(r.texto) is not distinct from t then
    return r; -- no cambió: no se toca la fila ni queda "editado"
  end if;
  update public.mensajes m set texto = t, editado = true where m.id = r.id returning m.* into r;
  return r;
end;
$$;
revoke execute on function public.editar_mensaje(uuid, text) from public, anon;
grant execute on function public.editar_mensaje(uuid, text) to authenticated;

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
  update public.mensajes m set tipo = 'eliminado', texto = null, archivo = null, ancho = null, alto = null
   where m.id = p_id returning m.* into nueva;
  return jsonb_build_object('fila', to_jsonb(nueva), 'archivo_antes', vieja.archivo);
end;
$$;
revoke execute on function public.eliminar_mensaje(uuid) from public, anon;
grant execute on function public.eliminar_mensaje(uuid) to authenticated;

alter table public.mensajes
  drop constraint mensajes_texto_valido,
  add constraint mensajes_texto_valido check (tipo <> 'texto' or (texto is not null and char_length(public.recortar_como_trim(texto)) >= 1 and archivo is null));
