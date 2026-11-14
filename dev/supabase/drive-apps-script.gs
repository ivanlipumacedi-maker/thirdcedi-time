// CEDI CLUB (antes ThirdCEDI Time): copia de respaldo de las fotos y videos del álbum en Google Drive.
// Lo publica Ivan como Web App en la cuenta de Google exclusiva de CEDI CLUB (desde 2026-11-14) (Ejecutar como: yo; Quién tiene acceso: cualquier persona).
// Lo llama solo la Edge Function "avisos" con un secreto compartido.
//
// Configuración (una sola vez), en el editor de Apps Script:
//   Configuración del proyecto → Propiedades de la secuencia de comandos → SECRETO = <el mismo valor que
//   DRIVE_FOTOS_SECRETO en los secretos de la Edge Function, 32 caracteres o más>. El secreto no va escrito en este archivo.
//   Al cambiar el código: Implementar → Gestionar implementaciones → editar (lápiz) → Versión: Nueva versión. Así la
//   URL /exec sigue siendo la misma (una "Nueva implementación" da otra URL).
//
// Un pedido (POST, cuerpo JSON, con { secreto }):
//   Subir: { carpeta, carpetaId?, nombre, base64, mime } → { id, carpetaId, carpetaUrl, ya? } o { error }
//     carpeta:   nombre de la subcarpeta de la actividad ("<fecha> <título>")
//     carpetaId: si ya se creó antes, su id (así un cambio de título no crea otra carpeta). Solo se usa si cuelga de la raíz.
//     mime:      image/jpeg, video/mp4 o video/webm (los videos llegan solo hasta 35 MB: más grandes no entran en un POST)
// Decisión de Ivan (2026-11-14): Drive es un RESPALDO PRIVADO de esta cuenta. No se comparte con nadie (los mails del
// grupo son de Microsoft 365, sin cuenta de Google) y la app no muestra el link: las fotos se ven y se bajan desde la app.
// Cada subida deja su carpeta en privado (si alguien la pasó a "cualquiera con el link", vuelve a privada).
// Todo queda dentro de la carpeta raíz "CEDI CLUB" de Mi unidad (se crea si no existe; nunca se comparte).
// Si ya hay un archivo con ese nombre en la subcarpeta, devuelve ese (un reintento no duplica).

var RAIZ = 'CEDI CLUB';
var MIMES = { 'image/jpeg': true, 'video/mp4': true, 'video/webm': true };
var MAX_BASE64 = 48 * 1024 * 1024;   // ~35 MB de archivo

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function carpetaRaiz() {
  var it = DriveApp.getRootFolder().getFoldersByName(RAIZ);
  return it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(RAIZ);
}

// Endurecimiento: solo se usa una carpeta que cuelga directo de la raíz. Un id que llegue de afuera (aunque sea de
// otra carpeta de esta cuenta) nunca recibe archivos ni se toca.
function deLaRaiz(carpeta, raizId) {
  var it = carpeta.getParents();
  while (it.hasNext()) if (it.next().getId() === raizId) return true;
  return false;
}
function carpetaPorId(id, raiz) {
  if (!id || !/^[A-Za-z0-9_-]{10,100}$/.test(String(id))) return null;
  var c;
  try { c = DriveApp.getFolderById(String(id)); } catch (e) { return null; /* la borraron o es de otra cuenta */ }
  return deLaRaiz(c, raiz.getId()) ? c : null;
}

function subcarpeta(nombre, id) {
  var raiz = carpetaRaiz();
  var porId = carpetaPorId(id, raiz);
  if (porId) return porId;
  var it = raiz.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : raiz.createFolder(nombre); // nace privada
}

function privada(carpeta) {
  if (carpeta.getSharingAccess() !== DriveApp.Access.PRIVATE) carpeta.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
}

function subir(d) {
  if (!d.carpeta || !d.nombre || !d.base64) return { error: 'faltan datos' };
  if (typeof d.base64 !== 'string' || d.base64.length > MAX_BASE64) return { error: 'archivo muy grande' };
  if (typeof d.nombre !== 'string' || d.nombre.length > 200 || /[\/\\]/.test(d.nombre)) return { error: 'nombre inválido' };
  var carpeta = subcarpeta(String(d.carpeta).replace(/[\/\\]/g, '-').slice(0, 200), d.carpetaId);
  privada(carpeta);
  var base = { carpetaId: carpeta.getId(), carpetaUrl: carpeta.getUrl() };
  var ya = carpeta.getFilesByName(d.nombre);
  if (ya.hasNext()) return { id: ya.next().getId(), carpetaId: base.carpetaId, carpetaUrl: base.carpetaUrl, ya: true };
  var mime = MIMES[d.mime] ? d.mime : 'image/jpeg';
  var f = carpeta.createFile(Utilities.newBlob(Utilities.base64Decode(d.base64), mime, d.nombre));
  return { id: f.getId(), carpetaId: base.carpetaId, carpetaUrl: base.carpetaUrl };
}

function huella(txt) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, txt));
}

function doPost(e) {
  var candado = LockService.getScriptLock();
  try {
    var esperado = PropertiesService.getScriptProperties().getProperty('SECRETO');
    var d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    // comparación por huella (no corta en el primer carácter distinto); un SECRETO corto se rechaza
    if (!esperado || esperado.length < 32 || typeof d.secreto !== 'string' || huella(d.secreto) !== huella(esperado)) {
      return responder({ error: 'secreto incorrecto' });
    }
    // dos llamadas a la vez no tienen que crear dos carpetas con el mismo nombre
    candado.waitLock(30000);
    return responder(subir(d));
  } catch (err) {
    return responder({ error: String(err && err.message || err).slice(0, 300) });
  } finally {
    try { candado.releaseLock(); } catch (e2) {}
  }
}

// A mano desde el editor (Ejecutar → probar): crea la carpeta raíz si falta, deja privadas la raíz y todas sus
// subcarpetas, y saca a cualquiera que se haya agregado como lector o editor.
function probar() {
  var raiz = carpetaRaiz(), n = 0;
  privada(raiz);
  var it = raiz.getFolders();
  while (it.hasNext()) {
    var c = it.next();
    privada(c);
    c.getViewers().forEach(function (u) { c.removeViewer(u.getEmail()); });
    c.getEditors().forEach(function (u) { c.removeEditor(u.getEmail()); });
    n++;
  }
  Logger.log(raiz.getUrl());
  Logger.log('Carpetas privadas: ' + n);
}
