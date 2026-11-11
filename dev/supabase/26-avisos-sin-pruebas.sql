-- 26: las actividades de prueba no avisan a todos. El aviso de "Nueva actividad" le llega a todos los que tienen los
-- avisos prendidos; las pruebas en vivo (actividades-rls, prueba-actividades, e2e) crean actividades con las cuentas
-- zz-prueba-*@cedi.com.ar y no le tienen que llegar a la gente real. Se reconocen como en drive_tomar (17): por el mail
-- de quien la creó. Los demás avisos (confirmada, cancelada, cambio, reabierta) van solo a los anotados, que en las
-- pruebas son las cuentas zz, así que siguen encolándose igual. Misma función que la 19, con ese único agregado.
create or replace function public.avisos_actividad() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare t text;
begin
  begin
    if tg_op = 'INSERT' then
      if exists (select 1 from auth.users u where u.id = new.creador and u.email ilike 'zz-prueba-%@cedi.com.ar') then
        return null;
      end if;
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
