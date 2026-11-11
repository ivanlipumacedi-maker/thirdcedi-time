-- 30: el bucket 'chat' acepta también image/png. Safari (iPhone) no codifica WebP en el canvas: los stickers del grupo
-- salen en PNG para no perder la transparencia (con JPEG las esquinas quedaban negras). El nombre sigue siendo
-- stickers/<uuid>.webp (lo exigen la policy chat_insert y el check de la tabla stickers); el navegador lo muestra igual.
update storage.buckets
   set allowed_mime_types = array['image/webp','image/jpeg','image/png','audio/webm','audio/ogg','audio/mp4','video/mp4','video/webm']
 where id = 'chat';
