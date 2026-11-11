-- 29: endurecimiento del cierre.
-- es_invitado(mail) respondía por cualquier mail: un miembro podía averiguar si una dirección está en la lista de
-- invitados. Ahora solo responde por el mail de la sesión (es lo único que usan la app y la policy perfiles_insert);
-- para otro mail da false. hook_dominio no la usa (lee la tabla directo).
create or replace function public.es_invitado(p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select lower(btrim(coalesce(p_email, ''))) = lower(btrim(coalesce((select auth.jwt()) ->> 'email', '')))
     and exists (select 1 from public.invitados i where i.email = lower(btrim(coalesce(p_email, ''))))
$$;
revoke execute on function public.es_invitado(text) from public, anon;
grant execute on function public.es_invitado(text) to authenticated;

-- Índices de las claves foráneas del chat (advisor de Supabase): borrar un mensaje, un perfil o un sticker no recorre
-- la tabla entera.
create index if not exists mensajes_responde_a_idx on public.mensajes (responde_a) where responde_a is not null;
create index if not exists mensaje_reacciones_persona_idx on public.mensaje_reacciones (persona);
create index if not exists chat_fijados_mensaje_idx on public.chat_fijados (mensaje);
create index if not exists chat_fijados_por_idx on public.chat_fijados (por);
create index if not exists stickers_autor_idx on public.stickers (autor);
