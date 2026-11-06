-- rls_auto_enable() es un event trigger que trae Supabase; no tiene por qué ser invocable por /rest/v1/rpc.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
