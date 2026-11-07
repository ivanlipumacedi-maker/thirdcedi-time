// Acceso con código por mail (OTP de Supabase), alta de perfil (nombre + foto) y panel de perfil propio.
(function (g) {
  const $ = (id) => document.getElementById(id);
  let mail = '';
  let fotoPendiente = null; // Blob listo para subir en el alta
  let tReenvio = null;
  let editorAlta = null;
  let editorPerfil = null;

  function sb() { return g.App.sb; }

  function pasos(cual) {
    ['paso-mail', 'paso-codigo', 'paso-alta'].forEach((id) => { $(id).hidden = id !== cual; });
    const foco = { 'paso-mail': 'in-mail', 'paso-codigo': 'in-codigo', 'paso-alta': 'in-nombre' }[cual];
    setTimeout(() => { const el = $(foco); if (el && !el.closest('[hidden]')) el.focus(); }, 0);
  }
  function error(id, texto) {
    const el = $(id);
    el.textContent = texto || '';
    el.hidden = !texto;
  }
  function ocupado(idBtn, si, textoEn) {
    const b = $(idBtn);
    if (si) { b.dataset.texto = b.textContent; b.textContent = textoEn; } else if (b.dataset.texto) b.textContent = b.dataset.texto;
    b.disabled = si;
  }
  const traducir = (e, paso) => g.Errores.traducir(e, paso);

  // ---------- Foto: recorte cuadrado centrado, 512x512, WebP (JPEG si el navegador no codifica WebP); ruta <uid>/avatar ----------
  async function procesarFoto(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const r = g.Perfiles.recorteCuadrado(bmp.width, bmp.height);
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    c.getContext('2d').drawImage(bmp, r.x, r.y, r.lado, r.lado, 0, 0, 512, 512);
    if (bmp.close) bmp.close();
    const aBlob = (tipo, q) => new Promise((ok) => c.toBlob(ok, tipo, q));
    let b = await aBlob('image/webp', 0.85);
    if (!b || b.type !== 'image/webp') b = await aBlob('image/jpeg', 0.85);
    if (!b) throw new Error('foto');
    return b;
  }
  async function subirFoto(uid, blob) {
    const ruta = g.Perfiles.rutaAvatar(uid);
    const { error: e } = await sb().storage.from(g.Perfiles.BUCKET).upload(ruta, blob, { upsert: true, contentType: blob.type, cacheControl: '3600' });
    if (e) throw e;
    return ruta + '?v=' + Date.now(); // el ?v= evita que se vea la foto vieja en caché
  }

  // Editor de foto reutilizable (alta y Perfil): vista previa + Sacar foto / Elegir / Quitar.
  function editorFoto(cont, { onElegida, onQuitar }) {
    cont.textContent = '';
    const vista = document.createElement('div');
    vista.className = 'foto-vista';
    cont.appendChild(vista);
    const botones = document.createElement('div');
    botones.className = 'foto-botones';
    cont.appendChild(botones);
    const mk = (texto, capture) => {
      const lab = document.createElement('label');
      lab.className = 'btn-sec';
      lab.append(texto);
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.hidden = true;
      if (capture) inp.setAttribute('capture', 'user');
      inp.addEventListener('change', async () => {
        const f = inp.files && inp.files[0];
        inp.value = '';
        if (!f) return;
        try { await onElegida(await procesarFoto(f)); } catch (e) { g.App.toast('No pudimos usar esa foto. Probá con otra.'); }
      });
      lab.appendChild(inp);
      return lab;
    };
    botones.appendChild(mk('Sacar foto', true));
    botones.appendChild(mk('Elegir de la galería', false));
    const quitar = document.createElement('button');
    quitar.type = 'button'; quitar.className = 'btn-link'; quitar.textContent = 'Quitar foto';
    quitar.addEventListener('click', onQuitar);
    botones.appendChild(quitar);
    return {
      pintar(p, blobLocal) {
        vista.textContent = '';
        const a = g.Perfiles.avatar(blobLocal ? { nombre: p && p.nombre, foto: null } : p, 96);
        if (blobLocal) {
          const img = document.createElement('img');
          img.alt = ''; img.src = URL.createObjectURL(blobLocal);
          a.textContent = ''; a.appendChild(img);
        }
        vista.appendChild(a);
        quitar.hidden = !(blobLocal || (p && p.foto));
      },
    };
  }

  // ---------- Pasos del acceso ----------
  async function enviarCodigo(email) {
    const { error: e } = await sb().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (e) throw e;
  }
  function cooldownReenvio() {
    const b = $('btn-reenviar');
    let n = 60; // mínimo entre envíos que pone Supabase por defecto
    b.disabled = true;
    clearInterval(tReenvio);
    const pintar = () => { b.textContent = n > 0 ? 'Reenviar código (' + n + ' s)' : 'Reenviar código'; };
    pintar();
    tReenvio = setInterval(() => { n--; pintar(); if (n <= 0) { clearInterval(tReenvio); b.disabled = false; } }, 1000);
  }

  async function onMail(ev) {
    ev.preventDefault();
    const email = $('in-mail').value.trim().toLowerCase();
    error('err-mail', '');
    if (!g.Dominios.permitido(email)) { error('err-mail', g.Errores.MSG_DOMINIO); return; }
    ocupado('btn-mail', true, 'Enviando…');
    try {
      await enviarCodigo(email);
      mail = email;
      $('txt-mail').textContent = email;
      $('in-codigo').value = '';
      error('err-codigo', '');
      pasos('paso-codigo');
      cooldownReenvio();
    } catch (e) { error('err-mail', traducir(e, 'mail')); }
    ocupado('btn-mail', false);
  }
  async function onReenviar() {
    error('err-codigo', '');
    try { await enviarCodigo(mail); g.App.toast('Te mandamos un código nuevo'); cooldownReenvio(); } catch (e) { error('err-codigo', traducir(e, 'mail')); }
  }
  async function onCodigo(ev) {
    ev.preventDefault();
    const token = $('in-codigo').value.replace(/\D/g, '');
    error('err-codigo', '');
    if (token.length !== 6) { error('err-codigo', 'El código tiene 6 números.'); return; }
    ocupado('btn-codigo', true, 'Verificando…');
    try {
      const { data, error: e } = await sb().auth.verifyOtp({ email: mail, token, type: 'email' });
      if (e) throw e;
      await despuesDeEntrar(data.user || (data.session && data.session.user));
    } catch (e) { error('err-codigo', traducir(e, 'codigo')); }
    ocupado('btn-codigo', false);
  }

  async function cargarPerfil(uid) {
    const { data, error: e } = await sb().from('perfiles').select('*').eq('id', uid).maybeSingle();
    if (e) throw e;
    return data;
  }
  async function despuesDeEntrar(user) {
    if (!user) throw new Error('Sesión incompleta');
    const p = await cargarPerfil(user.id);
    if (p) { await entrar(p); return; }
    mail = user.email || mail;
    fotoPendiente = null;
    $('in-nombre').value = '';
    error('err-alta', '');
    editorAlta.pintar({ nombre: '', foto: null }, null);
    g.App.modoAcceso(true);
    pasos('paso-alta');
  }
  async function onAlta(ev) {
    ev.preventDefault();
    const nombre = $('in-nombre').value.trim().replace(/\s+/g, ' ');
    error('err-alta', '');
    if (!nombre) { error('err-alta', 'Escribí tu nombre.'); return; }
    ocupado('btn-alta', true, 'Guardando…');
    try {
      const { data: { user } } = await sb().auth.getUser();
      const empresa = g.Dominios.empresa(user.email);
      if (!empresa) throw new Error('Dominio no permitido');
      const { error: e } = await sb().from('perfiles').insert({ id: user.id, nombre, empresa });
      if (e) throw e;
      let p = await cargarPerfil(user.id);
      if (fotoPendiente) {
        try {
          const foto = await subirFoto(user.id, fotoPendiente);
          const { data: act, error: e2 } = await sb().from('perfiles').update({ foto }).eq('id', user.id).select().single();
          if (!e2) p = act;
        } catch (e3) { g.App.toast('Tu perfil quedó creado, pero la foto no se pudo subir. Probá de nuevo desde Perfil.'); }
      }
      await entrar(p);
    } catch (e) { error('err-alta', traducir(e, 'otro')); }
    ocupado('btn-alta', false);
  }

  async function entrar(p) {
    g.App.setPerfil(p);
    g.App.modoAcceso(false);
    await g.Perfiles.prepararAvatares([p], sb()).catch(() => {});
    pintarPerfil();
    g.App.ir(g.App.rutaActual());
  }

  // ---------- Pestaña Perfil ----------
  function pintarPerfil() {
    const p = g.App.yo();
    const cont = $('perfil-contenido');
    cont.textContent = '';
    if (!p) return;
    const zonaFoto = document.createElement('div'); zonaFoto.className = 'foto-editor';
    const fila = document.createElement('div'); fila.className = 'perfil-datos';
    const nom = document.createElement('p'); nom.className = 'perfil-nombre'; nom.textContent = p.nombre;
    const emp = document.createElement('p'); emp.className = 'ayuda'; emp.textContent = p.empresa;
    fila.append(nom, emp);
    const form = document.createElement('form'); form.className = 'paso'; form.noValidate = true;
    const lab = document.createElement('label'); lab.htmlFor = 'in-nombre-perfil'; lab.textContent = 'Tu nombre';
    const inp = document.createElement('input'); inp.id = 'in-nombre-perfil'; inp.type = 'text'; inp.maxLength = 60; inp.value = p.nombre; inp.autocomplete = 'name';
    const err = document.createElement('p'); err.className = 'error'; err.setAttribute('role', 'alert'); err.hidden = true;
    const guardar = document.createElement('button'); guardar.type = 'submit'; guardar.className = 'btn-primario'; guardar.textContent = 'Guardar nombre';
    form.append(lab, inp, err, guardar);
    const salir = document.createElement('button'); salir.type = 'button'; salir.className = 'btn-link'; salir.textContent = 'Cerrar sesión';
    cont.append(zonaFoto, fila, form, salir);

    editorPerfil = editorFoto(zonaFoto, {
      onElegida: async (blob) => {
        const foto = await subirFoto(p.id, blob);
        const { data, error: e } = await sb().from('perfiles').update({ foto }).eq('id', p.id).select().single();
        if (e) throw e;
        await g.Perfiles.prepararAvatares([data], sb()).catch(() => {});
        g.App.setPerfil(data); editorPerfil.pintar(data); g.App.toast('Foto actualizada');
      },
      onQuitar: async () => {
        // primero la base (es lo que ven los demás); borrar el archivo es de mejor esfuerzo
        const { data, error: e } = await sb().from('perfiles').update({ foto: null }).eq('id', p.id).select().single();
        if (e) { g.App.toast('No pudimos quitar la foto. Probá de nuevo.'); return; }
        g.App.setPerfil(data); editorPerfil.pintar(data); g.App.toast('Quitamos tu foto');
        sb().storage.from(g.Perfiles.BUCKET).remove([g.Perfiles.rutaAvatar(p.id)]).catch(() => {});
      },
    });
    editorPerfil.pintar(p);

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const nombre = inp.value.trim().replace(/\s+/g, ' ');
      err.hidden = true;
      if (!nombre) { err.textContent = 'Escribí tu nombre.'; err.hidden = false; return; }
      const { data, error: e } = await sb().from('perfiles').update({ nombre }).eq('id', p.id).select().single();
      if (e) { err.textContent = traducir(e, 'otro'); err.hidden = false; return; }
      g.App.setPerfil(data); nom.textContent = data.nombre; editorPerfil.pintar(data); g.App.toast('Nombre guardado');
    });
    // antes de salir, este teléfono deja de recibir los avisos de esta cuenta (con sesión, que las RLS lo piden)
    salir.addEventListener('click', async () => {
      salir.disabled = true;
      // como mucho 3 s: sin conexión (o con el service worker trabado) igual se sale
      if (g.Avisos && g.Avisos.alSalir) {
        await Promise.race([g.Avisos.alSalir().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
      }
      sb().auth.signOut();
    });
  }

  function aPantallaDeMail() {
    mail = '';
    $('in-mail').value = '';
    error('err-mail', '');
    pasos('paso-mail');
  }

  async function iniciar() {
    $('paso-mail').addEventListener('submit', onMail);
    $('paso-codigo').addEventListener('submit', onCodigo);
    $('paso-alta').addEventListener('submit', onAlta);
    $('btn-reenviar').addEventListener('click', onReenviar);
    $('btn-cambiar-mail').addEventListener('click', aPantallaDeMail);
    $('in-codigo').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });
    editorAlta = editorFoto($('alta-foto'), {
      onElegida: async (blob) => { fotoPendiente = blob; editorAlta.pintar({ nombre: $('in-nombre').value, foto: null }, blob); },
      onQuitar: () => { fotoPendiente = null; editorAlta.pintar({ nombre: $('in-nombre').value, foto: null }, null); },
    });
    editorAlta.pintar({ nombre: '', foto: null }, null);
    $('in-nombre').addEventListener('input', () => { if (!fotoPendiente) editorAlta.pintar({ nombre: $('in-nombre').value, foto: null }, null); });

    g.App.modoAcceso(true); // hasta saber si hay sesión, no mostramos la app
    aPantallaDeMail();
    if (!sb()) { error('err-mail', 'La app no está configurada. Avisale a Ivan.'); return; }

    sb().auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_OUT') { g.App.setPerfil(null); g.Perfiles.limpiarCache(); aPantallaDeMail(); g.App.modoAcceso(true); pintarPerfil(); }
    });
    try {
      const { data: { session } } = await sb().auth.getSession();
      if (session && session.user) await despuesDeEntrar(session.user);
    } catch (e) {
      g.App.toast('No pudimos verificar tu sesión. Revisá tu conexión.');
    }
  }

  g.Login = { iniciar, procesarFoto };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})(window);
