-- Ajustes de actividades (fix round 1 de la Task 3). No borra ni pisa filas existentes: solo grants, funciones y triggers.
-- 1. Grants: se sacan los INSERT de creador (actividades) y persona (asistencias) que habían quedado de más.
--    Las dos columnas tienen "default auth.uid()" (07): el insert sin mandarlas sigue andando y ya no se pueden mandar.
-- 2. Una actividad cancelada queda congelada: se rechaza cualquier UPDATE si old.estado = 'cancelada', salvo
--    reactivarla (solo estado -> 'abierta', solo el creador, solo si todavía no pasó la fecha de la actividad).
--    Antes no se podía reabrir.
--    Reemplaza el cuerpo de actividades_no_reabrir (07) y rehace su trigger.
-- 3. Si el creador apaga el tercer tiempo, un trigger borra a los anotados a la parte 'tercer' de esa actividad
--    (en tiempo de ejecución, es comportamiento de la app). La UI avisa antes cuántos se van a quitar.
--    Quien estaba solo en el tercer tiempo deja de estar en la sala del chat (en_sala mira asistencias): es lo esperado.

-- ---- 1. Grants sobrantes ----
revoke insert (creador) on public.actividades from authenticated;
revoke insert (persona) on public.asistencias from authenticated;

-- ---- 2. Cancelada: no se edita nada; solo se reactiva ----
-- Con old.estado = 'cancelada' se rechaza cualquier UPDATE, salvo la reactivación: que lo único que cambie sea
-- estado, de 'cancelada' a 'abierta' (el estado activo con el que se crea), que lo haga el creador y que todavía
-- no haya pasado la fecha de la actividad: old.fecha > now(). El tercer tiempo NO cuenta (decisión de Ivan: "solo
-- si todavía no pasó la fecha"); es el mismo criterio que ActividadesLogica.reactivable, no el de esFutura.
-- Si estaba confirmada vuelve a 'abierta': la UI le pide al creador que la confirme de nuevo.
-- La cancelación no borra asistencias ni mensajes: al reactivar vuelve con todo.
-- Sin SECURITY DEFINER: solo mira OLD/NEW y auth.uid().
--
-- ¡OJO! COMPARACIÓN DE FILA ENTERA: "(to_jsonb(new) - 'estado') = (to_jsonb(old) - 'estado')" compara TODAS las
-- columnas menos estado. Si se agrega a public.actividades una columna que se actualiza sola (p. ej. un
-- "actualizado" con default now() que pisa un trigger), o un trigger BEFORE UPDATE que corra antes que este (los
-- BEFORE corren por orden alfabético de nombre) y cambie NEW, hay que restar esa columna en los dos lados de la
-- comparación (- 'estado' - 'actualizado'). Si no, NEW siempre difiere de OLD y la reactivación se rompe: da
-- "La actividad está cancelada" aunque solo se cambie el estado.
--
-- ¡OJO! TAMBIÉN CONGELA A service_role / postgres: el trigger no mira el rol (auth.uid() es null fuera de la API,
-- así que tampoco pueden reactivar). Es a propósito: una cancelada queda igual para todos. Para corregir datos de
-- una cancelada desde el SQL Editor, deshabilitar el trigger dentro de una transacción:
--   begin;
--   alter table public.actividades disable trigger actividades_no_reabrir;
--   update public.actividades set ... where id = '...';
--   alter table public.actividades enable trigger actividades_no_reabrir;
--   commit;
-- (el ALTER TABLE toma un lock exclusivo sobre actividades hasta el commit: hacerlo rápido).
create or replace function public.actividades_no_reabrir() returns trigger
language plpgsql set search_path = ''
as $$
begin
  -- el trigger solo corre con old.estado = 'cancelada' (ver WHEN), pero se chequea igual por si se usa en otro lado
  if old.estado <> 'cancelada' then
    return new;
  end if;
  if new.estado = 'abierta'
     and (to_jsonb(new) - 'estado') = (to_jsonb(old) - 'estado')
     and old.creador = (select auth.uid()) then
    -- solo la fecha de la actividad: el tercer tiempo no cuenta para reactivar
    if old.fecha > now() then
      return new;
    end if;
    raise exception 'La actividad ya pasó: no se puede reactivar' using errcode = 'P0001';
  end if;
  raise exception 'La actividad está cancelada' using errcode = 'P0001';
end;
$$;
revoke execute on function public.actividades_no_reabrir() from public, anon, authenticated;
drop trigger if exists actividades_no_reabrir on public.actividades;
create trigger actividades_no_reabrir before update on public.actividades
  for each row when (old.estado = 'cancelada') execute function public.actividades_no_reabrir();

-- ---- 3. Apagar el tercer tiempo quita a sus anotados ----
-- SECURITY DEFINER porque las RLS de asistencias solo dejan borrar la fila propia y acá el creador quita las de otros.
-- Solo se dispara cuando tiene_tercer pasa de true a false, y la policy de UPDATE ya garantiza que es el creador.
-- Una alta al tercer tiempo en paralelo no se cuela: asistencias_validar_alta bloquea la fila de la actividad
-- (FOR UPDATE) y, cuando este UPDATE termina, ve tiene_tercer = false y la rechaza.
create or replace function public.actividades_quitar_tercer() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.tiene_tercer and not new.tiene_tercer then
    delete from public.asistencias s where s.actividad = new.id and s.parte = 'tercer';
  end if;
  return null;
end;
$$;
revoke execute on function public.actividades_quitar_tercer() from public, anon, authenticated;
drop trigger if exists actividades_quitar_tercer on public.actividades;
create trigger actividades_quitar_tercer after update of tiene_tercer on public.actividades
  for each row when (old.tiene_tercer and not new.tiene_tercer) execute function public.actividades_quitar_tercer();
