// CEDI CLUB (antes ThirdCEDI Time): copia de las fotos y videos del álbum en Google Drive.
// Lo publica Ivan como Web App en la cuenta de Google exclusiva de CEDI CLUB (desde 2026-11-14) (Ejecutar como: yo; Quién tiene acceso: cualquier persona).
// Lo llama solo la Edge Function "avisos" con un secreto compartido.
//
// Configuración (una sola vez), en el editor de Apps Script:
//   1. Configuración del proyecto → Propiedades de la secuencia de comandos → agregar SECRETO = <el mismo valor que
//      DRIVE_FOTOS_SECRETO en los secretos de la Edge Function>. El secreto no va escrito en este archivo.
//   2. Servicios (+) → "Drive API" (v3, identificador Drive): hace falta para compartir sin mandar mail.
//   Al cambiar el código: Implementar → Gestionar implementaciones → editar (lápiz) → Versión: Nueva versión. Así la
//   URL /exec sigue siendo la misma (una "Nueva implementación" da otra URL).
//
// Dos pedidos (POST, cuerpo JSON, siempre con { secreto }):
//   Subir:    { carpeta, carpetaId?, nombre, base64, mime } → { id, carpetaId, carpetaUrl, ya? } o { error }
//     carpeta:   nombre de la subcarpeta de la actividad ("<fecha> <título>")
//     carpetaId: si ya se creó antes, su id (así un cambio de título no crea otra carpeta)
//     mime:      image/jpeg, video/mp4 o video/webm (los videos llegan solo hasta 35 MB: más grandes no entran en un POST)
//   Lectores: { accion: 'lectores', carpetas: [{ carpetaId? | nombre?, mails: [...] }] } → { hechas, sinCambios, errores }
//     Decisión de Ivan (2026-11-14): cada carpeta la ven solo esos mails (los anotados de la actividad; "Fotos de todos",
//     los miembros activos), compartida sin mail de aviso. Se saca "cualquiera con el link", se agrega a quien falta y
//     se saca a quien ya no está. Un mail sin cuenta de Google no se puede agregar sin mandarle un mail: se saltea y se
//     reintenta cada 6 horas (cuando la persona crea su cuenta de Google con ese mail, entra sola).
// Todo queda dentro de la carpeta raíz "CEDI CLUB" de Mi unidad (se crea si no existe; nunca se comparte).
// Si ya hay un archivo con ese nombre en la subcarpeta, devuelve ese (un reintento no duplica).

var RAIZ = 'CEDI CLUB';
var MIMES = { 'image/jpeg': true, 'video/mp4': true, 'video/webm': true };
var REINTENTO_SIN_CUENTA_MS = 6 * 3600 * 1000;

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function carpetaRaiz() {
  var it = DriveApp.getRootFolder().getFoldersByName(RAIZ);
  return it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(RAIZ);
}

function subcarpeta(nombre, id) {
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* la borraron o es de otra cuenta: se busca o se crea por nombre */ }
  }
  var raiz = carpetaRaiz();
  var it = raiz.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : raiz.createFolder(nombre); // nace privada: los lectores los pone 'lectores'
}

function subir(d) {
  if (!d.carpeta || !d.nombre || !d.base64) return { error: 'faltan datos' };
  var carpeta = subcarpeta(String(d.carpeta).slice(0, 200), d.carpetaId);
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

// Deja la carpeta compartida solo con `mails`. Devuelve 'igual' si no había nada que cambiar desde la última vez.
function sincronizar(carpeta, mails, props, yo, errores) {
  var id = carpeta.getId();
  var quiero = {};
  mails.forEach(function (m) { m = String(m || '').trim().toLowerCase(); if (m && m !== yo) quiero[m] = true; });
  var lista = Object.keys(quiero).sort();
  var clave = 'lec:' + id, h = huella(lista.join(','));
  if (props.getProperty(clave) === h) return 'igual';
  if (carpeta.getSharingAccess() !== DriveApp.Access.PRIVATE) carpeta.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  var tiene = {};
  carpeta.getViewers().forEach(function (u) { var m = String(u.getEmail() || '').toLowerCase(); if (m) tiene[m] = true; });
  Object.keys(tiene).forEach(function (m) { if (!quiero[m]) carpeta.removeViewer(m); });
  var pendientes = 0, ahora = Date.now();
  lista.forEach(function (m) {
    if (tiene[m]) return;
    var nog = 'nog:' + m, antes = Number(props.getProperty(nog) || 0);
    if (antes && ahora - antes < REINTENTO_SIN_CUENTA_MS) { pendientes++; return; }
    try {
      Drive.Permissions.create({ role: 'reader', type: 'user', emailAddress: m }, id, { sendNotificationEmail: false });
      props.deleteProperty(nog);
    } catch (e) {
      // casi siempre: ese mail no tiene cuenta de Google (Google exige mandarle un mail para invitarlo)
      props.setProperty(nog, String(ahora));
      pendientes++;
      errores.push(m.replace(/^(.).*@/, '$1…@') + ': ' + String(e && e.message || e).slice(0, 120));
    }
  });
  // con alguien pendiente no se guarda la huella: la próxima pasada lo vuelve a mirar (respetando las 6 horas)
  if (pendientes) props.deleteProperty(clave); else props.setProperty(clave, h);
  return 'hecha';
}

function lectores(d) {
  if (typeof Drive === 'undefined') return { error: 'falta agregar el servicio Drive API en el editor de Apps Script' };
  var props = PropertiesService.getScriptProperties();
  var yo = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  var res = { hechas: 0, sinCambios: 0, errores: [] };
  (d.carpetas || []).slice(0, 500).forEach(function (c) {
    try {
      var carpeta = null;
      if (c.carpetaId) {
        try { carpeta = DriveApp.getFolderById(c.carpetaId); } catch (e) { return; /* de otra cuenta o borrada */ }
      } else if (c.nombre) {
        var it = carpetaRaiz().getFoldersByName(String(c.nombre).slice(0, 200));
        if (!it.hasNext()) return;
        carpeta = it.next();
      }
      if (!carpeta) return;
      if (sincronizar(carpeta, Array.isArray(c.mails) ? c.mails : [], props, yo, res.errores) === 'igual') res.sinCambios++;
      else res.hechas++;
    } catch (e) {
      res.errores.push(String(e && e.message || e).slice(0, 200));
    }
  });
  res.errores = res.errores.slice(0, 20);
  return res;
}

function doPost(e) {
  var candado = LockService.getScriptLock();
  try {
    var esperado = PropertiesService.getScriptProperties().getProperty('SECRETO');
    var d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!esperado || d.secreto !== esperado) return responder({ error: 'secreto incorrecto' });
    // dos llamadas a la vez no tienen que crear dos carpetas con el mismo nombre ni pisarse los permisos
    candado.waitLock(30000);
    return responder(d.accion === 'lectores' ? lectores(d) : subir(d));
  } catch (err) {
    return responder({ error: String(err && err.message || err).slice(0, 300) });
  } finally {
    try { candado.releaseLock(); } catch (e2) {}
  }
}

// Para probar a mano desde el editor (Ejecutar → probar): crea la carpeta raíz y confirma que está el servicio Drive.
function probar() {
  Logger.log(carpetaRaiz().getUrl());
  Logger.log(typeof Drive === 'undefined' ? 'FALTA el servicio Drive API' : 'Servicio Drive API: ok');
}
