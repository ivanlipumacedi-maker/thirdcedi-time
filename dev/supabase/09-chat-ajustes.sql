-- Ajustes del chat (fix round 1 de la Task 4). Solo reemplaza funciones: no toca tablas ni datos.
-- - editar_mensaje: guarda el texto recortado igual que String.prototype.trim() de JS (btrim no alcanza: solo saca
--   espacios, y trim() también saca tab, saltos de línea, VT, FF, NBSP, U+FEFF, los espacios Unicode Zs y U+2028/2029).
--   Si no cambió (se comparan los dos recortados, como L.textoEditado), devuelve la fila tal cual (sin marcar editado).
--   Exige además ser miembro (es_miembro).
--   La clase va con escapes \uXXXX del motor de regex, escrita en E'' con la barra doblada (así no depende de
--   standard_conforming_strings). dev/tests/chat-logica.test.js la lee de este archivo y la compara con trim().
-- - eliminar_mensaje: exige además ser miembro (es_miembro).
-- Mismo contrato que la 08: P0002 si no se puede (no es tuyo, pasaron los 15 minutos, ya no estás en la sala o no sos miembro).

create or replace function public.editar_mensaje(p_id uuid, p_texto text) returns public.mensajes
language plpgsql security definer set search_path = ''
as $$
declare
  -- blancos de trim(): TAB, LF, VT, FF, CR, SP, NBSP, U+1680, U+2000-200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF
  blancos constant text := E'[\\u0009-\\u000d\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]';
  recorte constant text := '^' || blancos || '+|' || blancos || '+$';
  r public.mensajes;
  t text := regexp_replace(p_texto, recorte, '', 'g');
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
  if regexp_replace(r.texto, recorte, '', 'g') is not distinct from t then
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
