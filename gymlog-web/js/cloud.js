/* =========================================================================
   cloud.js — Sincronización con la nube (Supabase).
   =========================================================================
   Acceso con email y contraseña. Los datos siguen viviendo en IndexedDB: la
   nube es el puente entre dispositivos, no el almacén principal.
   ========================================================================= */
(function (GL) {
  'use strict';

  var PROJECT_URL = 'https://dfvidkbcnvngnskswirs.supabase.co';
  var PUBLIC_KEY = 'sb_publishable_Ag2VbW9BZuG6uKiHTAuQcw_BKAQCLVv';

  var client = null;
  function sb() {
    if (client) return client;
    if (!window.supabase || !window.supabase.createClient) return null;
    client = window.supabase.createClient(PROJECT_URL, PUBLIC_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    return client;
  }

  /* Los mensajes de Supabase vienen en inglés y algunos son crípticos. */
  function friendlyError(err) {
    var msg = (err && err.message) || 'Ocurrió un error con la nube.';
    if (/invalid login credentials/i.test(msg)) return 'Email o contraseña incorrectos.';
    if (/already registered|already exists|user already/i.test(msg)) return 'Ese email ya tiene cuenta. Iniciá sesión.';
    if (/password should be at least/i.test(msg)) return 'La contraseña necesita al menos 6 caracteres.';
    if (/email address.*invalid|invalid email/i.test(msg)) return 'Ese email no parece válido.';
    if (/rate limit|too many/i.test(msg)) return 'Demasiados intentos. Esperá un minuto y probá de nuevo.';
    if (/email not confirmed/i.test(msg)) return 'La cuenta existe pero falta confirmar el email.';
    return msg;
  }

  function session() {
    var c = sb();
    if (!c) return Promise.resolve(null);
    return c.auth.getSession().then(function (r) { return (r.data && r.data.session) || null; });
  }

  function signIn(email, password) {
    var c = sb();
    if (!c) return Promise.reject(new Error('No hay conexión con la nube ahora mismo.'));
    return c.auth.signInWithPassword({ email: email, password: password })
      .then(function (r) {
        if (r.error) throw new Error(friendlyError(r.error));
        return r.data.session;
      });
  }

  /* Con «Confirm email» desactivado en Supabase, signUp devuelve la sesión ya
     iniciada y no manda ningún correo. Si alguien vuelve a activar esa opción,
     signUp responde sin sesión: ahí sí hay que ir al email, y lo decimos. */
  function signUp(email, password) {
    var c = sb();
    if (!c) return Promise.reject(new Error('No hay conexión con la nube ahora mismo.'));
    return c.auth.signUp({ email: email, password: password })
      .then(function (r) {
        if (r.error) throw new Error(friendlyError(r.error));
        if (!r.data.session) {
          throw new Error('Falta confirmar el email antes de entrar. Revisá tu correo.');
        }
        return r.data.session;
      });
  }

  function signOut() {
    var c = sb();
    if (!c) return Promise.resolve();
    return c.auth.signOut();
  }

  /* Sube el respaldo completo. Una sola fila por usuario: cada sincronización
     reemplaza a la anterior, no se acumulan copias en el servidor. */
  function push(payload) {
    var c = sb();
    if (!c) return Promise.reject(new Error('No hay conexión con la nube ahora mismo.'));
    return session().then(function (s) {
      if (!s) throw new Error('Iniciá sesión primero.');
      return c.from('backups').upsert({
        user_id: s.user.id, payload: payload, updated_at: new Date().toISOString()
      });
    }).then(function (r) { if (r.error) throw new Error(friendlyError(r.error)); return true; });
  }

  function pull() {
    var c = sb();
    if (!c) return Promise.reject(new Error('No hay conexión con la nube ahora mismo.'));
    return session().then(function (s) {
      if (!s) throw new Error('Iniciá sesión primero.');
      return c.from('backups').select('payload,updated_at').eq('user_id', s.user.id).maybeSingle();
    }).then(function (r) { if (r.error) throw new Error(friendlyError(r.error)); return r.data || null; });
  }

  var LAST_USER_KEY = 'gymlog:lastCloudUser';
  function lastUserId() {
    try { return localStorage.getItem(LAST_USER_KEY); } catch (e) { return null; }
  }
  function setLastUserId(id) {
    try { localStorage.setItem(LAST_USER_KEY, id); } catch (e) { }
  }

  GL.cloud = {
    ready: function () { return !!sb(); },
    lastUserId: lastUserId,
    setLastUserId: setLastUserId,
    session: session,
    signIn: signIn,
    signUp: signUp,
    signOut: signOut,
    push: push,
    pull: pull
  };
})(window.GL = window.GL || {});
