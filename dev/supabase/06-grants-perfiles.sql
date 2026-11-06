-- Mínimo privilegio en public.perfiles: authenticated solo SELECT, INSERT y UPDATE de (nombre, foto); anon nada.
-- (Se tocan solo anon/authenticated; service_role y postgres quedan como los pone Supabase.)
revoke all on public.perfiles from anon, authenticated;
grant select, insert on public.perfiles to authenticated;
grant update (nombre, foto) on public.perfiles to authenticated;
