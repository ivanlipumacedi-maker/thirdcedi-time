-- Ajustes del chat (fix round 1 de la Task 4). Solo reemplaza funciones: no toca tablas ni datos.
-- - editar_mensaje: guarda el texto recortado (btrim); si no cambió, devuelve la fila tal cual (sin marcar editado);
--   exige además ser miembro (es_miembro).
-- - eliminar_mensaje: exige además ser miembro (es_miembro).
-- Mismo contrato que la 08: P0002 si no se puede (no es tuyo, pasaron los 15 minutos, ya no estás en la sala o no sos miembro).

create or replace function public.editar_mensaje(p_id uuid, p_texto text) returns public.mensajes
language plpgsql security definer set search_path = ''
as $$
declare r public.mensajes; t text := btrim(p_texto);
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
  if r.texto is not distinct from t then
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
