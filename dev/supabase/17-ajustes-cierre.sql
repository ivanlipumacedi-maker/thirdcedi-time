-- Ajustes de cierre (Task 10): detalles de Cuentas claras (11) y del Álbum (13). Solo create or replace, alter y
-- policies: no toca filas (la columna nueva drive_intentos arranca en 0 para todas).
--
-- Cuentas claras
-- * pagos_validar_alta chequea primero los permisos (en_cuentas y que yo sea "de" o "a"): el trigger corre antes
--   del WITH CHECK de la policy, así que sin esto quien no está en las cuentas podía saber por el mensaje quién
--   figura y bloquear (FOR SHARE) la fila de una actividad ajena.
-- * Las dos personas del pago tienen que figurar en las cuentas de ESA parte (figura_en_parte), no de cualquiera.
-- * "Ya pagué" y "Me pagó" tocados a la vez por las dos personas cargaban dos pagos iguales y la deuda se daba vuelta:
--   con un candado por actividad y parte, un pago igual (mismas personas, parte y monto) a otro de los últimos
--   10 minutos se rechaza con "Ese pago ya está registrado".
-- * Apagar el tercer tiempo con cuentas: el mensaje dice a quién pedirle que las borre.
-- * Documentado (sin cambio):
--   - gastos, gasto_partes y pagos tienen FK a perfiles con on delete cascade (11). Hoy no se borran cuentas; el día
--     que exista "borrar mi cuenta", borrar un perfil se llevaría gastos y pagos que también son de otros y
--     cambiaría sus saldos. Antes de eso: pasar esas FK a restrict o anonimizar el perfil en vez de borrarlo.
--   - Realtime no filtra los DELETE: a cualquier suscripto a gastos/pagos le llega el id (solo la clave, sin datos)
--     de lo que se borra en cualquier actividad. Es una limitación de Supabase; el cliente lo ignora si no es suyo.
--
-- Álbum
-- * album_insert y album_update: el nombre del archivo tiene que ser <uuid>/<uuid>.jpg | .t.webp | .m.jpg.
-- * drive_tomar: una foto que falla siempre en Drive ya no se reintenta para siempre: cada toma suma un intento,
--   la espera crece (15 min, 30, 1 h, ... hasta 16 h) y después de 8 intentos se deja (queda con drive_error).
--   Para reintentarla a mano: update public.fotos set drive_intentos = 0, drive_tomado = null where id = '...';
-- * Las actividades de prueba se reconocen por quien las creó (una cuenta zz-prueba-*@cedi.com.ar), no por el
--   título: una actividad real que se llame "zz algo" va a Drive igual.

-- ---- Cuentas: ¿figura esta persona en las cuentas de esta parte? ----
-- Como figura_en_cuentas (11) pero por parte. Uso interno: no se le da execute a nadie.
create or replace function public.figura_en_parte(p_actividad uuid, p_parte text, p_persona uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_actividad is not null and p_persona is not null and p_parte is not null and (
    exists (select 1 from public.gastos g where g.actividad = p_actividad and g.parte = p_parte and g.pagador = p_persona)
    or exists (select 1 from public.gasto_partes gp join public.gastos g on g.id = gp.gasto
               where g.actividad = p_actividad and g.parte = p_parte and gp.persona = p_persona)
    or exists (select 1 from public.pagos p where p.actividad = p_actividad and p.parte = p_parte
               and (p.de = p_persona or p.a = p_persona))
  );
$$;
revoke execute on function public.figura_en_parte(uuid, text, uuid) from public, anon, authenticated;

-- ---- Cuentas: alta de pago ----
-- Mismo cuerpo que la 11 más: permisos al principio, figura_en_parte y el candado contra el pago repetido.
-- Con auth.uid() nulo (service_role, SQL Editor) no se piden permisos de persona, como antes.
create or replace function public.pagos_validar_alta() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  a public.actividades%rowtype;
  yo uuid := (select auth.uid());
begin
  if yo is not null and (not public.en_cuentas(new.actividad) or yo not in (new.de, new.a)) then
    raise exception 'No tenés permiso' using errcode = '42501';
  end if;
  select * into a from public.actividades where id = new.actividad for share;
  if not found then
    raise exception 'La actividad no existe' using errcode = 'P0001';
  end if;
  if new.parte = 'tercer' and not a.tiene_tercer then
    raise exception 'La actividad no tiene tercer tiempo' using errcode = 'P0001';
  end if;
  if not public.figura_en_parte(new.actividad, new.parte, new.de) or not public.figura_en_parte(new.actividad, new.parte, new.a) then
    raise exception 'Esa persona no figura en las cuentas de esa parte' using errcode = 'P0001';
  end if;
  -- un pago a la vez por actividad y parte (se suelta al terminar la transacción): el segundo de dos toques
  -- simultáneos espera, ve el primero ya guardado y se rechaza
  perform pg_advisory_xact_lock(hashtextextended('pagos:' || new.actividad::text || ':' || new.parte, 0));
  if exists (select 1 from public.pagos p
              where p.actividad = new.actividad and p.parte = new.parte and p.de = new.de and p.a = new.a
                and p.monto = new.monto and p.creado > now() - interval '10 minutes') then
    raise exception 'Ese pago ya está registrado' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.pagos_validar_alta() from public, anon, authenticated;

-- ---- Cuentas: apagar el tercer tiempo con cuentas (mismo cuerpo que la 11, otro mensaje) ----
create or replace function public.actividades_tercer_con_cuentas() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.tiene_tercer and not new.tiene_tercer then
    if exists (select 1 from public.gastos g where g.actividad = new.id and g.parte = 'tercer') then
      raise exception 'El tercer tiempo tiene gastos cargados: pedile a quien los cargó que los borre antes de sacarlo' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.pagos p where p.actividad = new.id and p.parte = 'tercer') then
      raise exception 'El tercer tiempo tiene pagos registrados: pedile a quien los registró que los borre antes de sacarlo' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.actividades_tercer_con_cuentas() from public, anon, authenticated;

-- ---- Álbum: nombres de archivo ----
drop policy if exists album_insert on storage.objects;
create policy album_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'album' and public.es_miembro() and array_length(storage.foldername(name), 1) = 1
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|t\.webp|m\.jpg)$'
    and public.en_sala('act:' || (storage.foldername(name))[1]));
drop policy if exists album_update on storage.objects;
create policy album_update on storage.objects for update to authenticated
  using (bucket_id = 'album' and owner_id = (select auth.uid())::text and public.en_sala('act:' || (storage.foldername(name))[1]))
  with check (bucket_id = 'album' and owner_id = (select auth.uid())::text
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|t\.webp|m\.jpg)$'
    and public.en_sala('act:' || (storage.foldername(name))[1]));

-- ---- Álbum: Drive con intentos y espera creciente ----
alter table public.fotos add column if not exists drive_intentos int not null default 0;
-- La escribe solo el servidor: no entra en el grant de insert por columnas de la 13.

-- Mismo cuerpo que la 13 con: drive_intentos (suma uno por toma, espera 15 min * 2^(intentos-1), hasta 8) y las
-- de prueba por creador en vez de por título.
create or replace function public.drive_tomar(p_cuantas int) returns setof public.fotos
language sql security definer set search_path = ''
as $$
  update public.fotos f set drive_tomado = now(), drive_intentos = f.drive_intentos + 1
   where f.id in (
     select x.id from public.fotos x join public.actividades a on a.id = x.actividad
      where x.drive_id is null and not x.liberada
        and x.drive_intentos < 8
        and (x.drive_tomado is null
             or x.drive_tomado < now() - interval '15 minutes' * power(2, greatest(x.drive_intentos - 1, 0)))
        and not exists (select 1 from auth.users u where u.id = a.creador and u.email ilike 'zz-prueba-%@cedi.com.ar')
      order by x.creado
      limit greatest(1, least(coalesce(p_cuantas, 5), 20))
      for update of x skip locked)
  returning f.*;
$$;
revoke execute on function public.drive_tomar(int) from public, anon, authenticated;
grant execute on function public.drive_tomar(int) to service_role;
