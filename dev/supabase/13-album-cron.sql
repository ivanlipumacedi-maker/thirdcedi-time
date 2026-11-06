-- Cron del álbum (no es migración: lo corre Ivan a mano en el SQL Editor, después de cargar el secreto
-- 'avisos_cron_secret' en Vault y los secretos DRIVE_FOTOS_URL / DRIVE_FOTOS_SECRETO de la Edge Function).
-- Cada 5 minutos: sube a Drive las fotos que falten y, pasado el 70 % del espacio, libera originales que ya están en Drive.
-- Es idempotente: si ya existe, lo reprograma.
select cron.schedule('album-drive', '*/5 * * * *', $$select public.avisos_llamar('{"tipo":"drive"}'::jsonb)$$);

-- Para apagarlo:
--   select cron.unschedule('album-drive');
