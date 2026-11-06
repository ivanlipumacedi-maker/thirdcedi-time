-- Usuarios de prueba para los tests de RLS y del navegador (zz-prueba-a/b/c@cedi.com.ar). NO es una migración.
-- Se corre a mano en el SQL Editor del proyecto thirdcedi-time (qvezbnkrfqewanlcejha). Es idempotente: borra y recrea.
-- Las contraseñas se generan acá, al azar, y se devuelven UNA sola vez en el resultado del último SELECT.
-- Copiá esas tres líneas (ZZ_PRUEBA_A_PASSWORD=..., etc.) al archivo .env de la raíz del repo (está en .gitignore).
-- Nunca las pegues en el chat, en un comando ni en un commit. Las cuentas existen solo para pruebas: no son de personas reales.

delete from auth.users where email in ('zz-prueba-a@cedi.com.ar', 'zz-prueba-b@cedi.com.ar', 'zz-prueba-c@cedi.com.ar');

with pw as (
  select l, 'zz-prueba-' || l || '@cedi.com.ar' as email, 'ZZ Prueba ' || upper(l) as nombre,
         replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') as clave, gen_random_uuid() as id
  from (values ('a'), ('b'), ('c')) v(l)
),
u as (
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new)
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
         extensions.crypt(clave, extensions.gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
  from pw returning id
),
i as (
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select id::text, id, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), 'email', now(), now(), now()
  from pw returning 1
),
p as (
  insert into public.perfiles (id, nombre, empresa) select id, nombre, 'CEDI' from pw returning 1
)
select 'ZZ_PRUEBA_' || upper(l) || '_PASSWORD=' || clave as linea_para_env
from pw, (select count(*) from u) a, (select count(*) from i) b, (select count(*) from p) c
order by l;
