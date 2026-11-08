// ThirdCEDI Time: copia de las fotos y videos del álbum en Google Drive.
// Lo publica Ivan como Web App en su cuenta (Ejecutar como: yo; Quién tiene acceso: cualquier persona).
// Lo llama solo la Edge Function "avisos" con un secreto compartido.
//
// Configuración (una sola vez), en el editor de Apps Script:
//   Configuración del proyecto → Propiedades de la secuencia de comandos → agregar SECRETO = <el mismo valor que
//   DRIVE_FOTOS_SECRETO en los secretos de la Edge Function>. El secreto no va escrito en este archivo.
//
// Recibe (POST, cuerpo JSON): { secreto, carpeta, carpetaId?, nombre, base64, mime }
//   carpeta:   nombre de la subcarpeta de la actividad ("<fecha> <título>")
//   carpetaId: si ya se creó antes, su id (así un cambio de título no crea otra carpeta)
//   mime:      image/jpeg, video/mp4 o video/webm (los videos llegan solo hasta 35 MB: más grandes no entran en un POST)
// Devuelve: { id, carpetaId, carpetaUrl, ya? }  o  { error }
// Todo queda dentro de la carpeta raíz "ThirdCEDI Time" de Mi unidad (se crea si no existe).
// Si ya hay un archivo con ese nombre en la subcarpeta, devuelve ese (un reintento no duplica).

var RAIZ = 'ThirdCEDI Time';
var MIMES = { 'image/jpeg': true, 'video/mp4': true, 'video/webm': true };

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function carpetaRaiz() {
  var it = DriveApp.getRootFolder().getFoldersByName(RAIZ);
  return it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(RAIZ);
}

function subcarpeta(nombre, id) {
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* la borraron: se busca o se crea por nombre */ }
  }
  var raiz = carpetaRaiz();
  var it = raiz.getFoldersByName(nombre);
  var c = it.hasNext() ? it.next() : raiz.createFolder(nombre);
  compartir(c);
  return c;
}

// Decisión de Ivan (2026-11-06): cada subcarpeta de actividad se comparte como "cualquier persona con el link puede
// ver", porque los compañeros entran con cuentas de Microsoft y no tienen Google. La raíz NO se comparte: el link
// abre solo la carpeta de esa actividad. Si el dominio de Google no permite compartir así, la foto igual se copia.
function compartir(carpeta) {
  try {
    if (carpeta.getSharingAccess() !== DriveApp.Access.ANYONE_WITH_LINK) {
      carpeta.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    }
  } catch (e) { /* política del dominio: se sigue sin compartir */ }
}

function doPost(e) {
  var candado = LockService.getScriptLock();
  try {
    var esperado = PropertiesService.getScriptProperties().getProperty('SECRETO');
    var d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!esperado || d.secreto !== esperado) return responder({ error: 'secreto incorrecto' });
    if (!d.carpeta || !d.nombre || !d.base64) return responder({ error: 'faltan datos' });
    // dos llamadas a la vez no tienen que crear dos carpetas con el mismo nombre
    candado.waitLock(30000);
    var carpeta = subcarpeta(String(d.carpeta).slice(0, 200), d.carpetaId);
    var base = { carpetaId: carpeta.getId(), carpetaUrl: carpeta.getUrl() };
    var ya = carpeta.getFilesByName(d.nombre);
    if (ya.hasNext()) { var f0 = ya.next(); return responder({ id: f0.getId(), carpetaId: base.carpetaId, carpetaUrl: base.carpetaUrl, ya: true }); }
    var mime = MIMES[d.mime] ? d.mime : 'image/jpeg';
    var blob = Utilities.newBlob(Utilities.base64Decode(d.base64), mime, d.nombre);
    var f = carpeta.createFile(blob);
    return responder({ id: f.getId(), carpetaId: base.carpetaId, carpetaUrl: base.carpetaUrl });
  } catch (err) {
    return responder({ error: String(err && err.message || err).slice(0, 300) });
  } finally {
    try { candado.releaseLock(); } catch (e2) {}
  }
}

// Para probar a mano desde el editor (Ejecutar → probar): crea la carpeta raíz.
function probar() {
  Logger.log(carpetaRaiz().getUrl());
}
