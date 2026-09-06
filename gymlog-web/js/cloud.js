/* =========================================================================
   cloud.js — Sincronización opcional con la nube (Supabase).
   =========================================================================
   Nada de esto es obligatorio: es un respaldo aparte, no un reemplazo de
   IndexedDB. Login por código de un solo uso (OTP) enviado por email, nunca
   por enlace mágico — un enlace abriría el navegador en vez de la app
   instalada y ahí se perdería la sesión.
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

  function friendlyError(err) {
    var msg = (err && err.message) || 'Ocurrió un error con la nube.';
    if (/rate limit/i.test(msg)) return 'Demasiados intentos. Esperá un minuto y probá de nuevo.';
    if (/invalid|expired|otp/i.test(msg) && /token|otp|code/i.test(msg)) return 'Código incorrecto o vencido.';
    return msg;
  }

  /* Cuando se pide un código con shouldCreateUser:false y la cuenta no existe,
     Supabase responde con «Signups not allowed for otp» (código otp_disabled).
     Eso no es un fallo: es la forma de preguntar «¿este email ya tiene cuenta?»
     sin mandar ningún correo. */
  function isNoAccount(err) {
    return (err && err.code) === 'otp_disabled' ||
      /signups? not allowed/i.test((err && err.message) || '');
  }

  /* Pide un código. `create` decide si se permite dar de alta la cuenta:
     iniciar sesión nunca crea nada, crear cuenta sí. */
  function requestCode(email, create) {
    var c = sb();
    if (!c) return Promise.reject(new Error('No hay conexión con la nube ahora mismo.'));
    return c.auth.signInWithOtp({ email: email, options: { shouldCreateUser: !!create } })
      .then(function (r) { if (r.error) throw r.error; return true; });
  }

  function session() {
    var c = sb();
    if (!c) return Promise.resolve(null);
    return c.auth.getSession().then(function (r) { return (r.data && r.data.session) || null; });
  }

  /* Iniciar sesión: si el email no tiene cuenta, no se crea nada a escondidas.
     Se avisa y se ofrece el otro camino. */
  function sendSignInCode(email) {
    return requestCode(email, false)['catch'](function (err) {
      if (isNoAccount(err)) {
        var e = new Error('No hay ninguna cuenta con ese email. Probá crear una.');
        e.noAccount = true;
        throw e;
      }
      throw new Error(friendlyError(err));
    });
  }

  /* Crear cuenta: primero se pregunta sin crear nada. Si la cuenta ya existía,
     se avisa y el mismo código sirve para entrar; si no existía, recién ahí se
     manda el alta. En los dos casos sale un solo email. */
  function sendSignUpCode(email) {
    return requestCode(email, false)
      .then(function () { return { existed: true }; })
      ['catch'](function (err) {
        if (!isNoAccount(err)) throw new Error(friendlyError(err));
        return requestCode(email, true)
          .then(function () { return { existed: false }; })
          ['catch'](function (err2) { throw new Error(friendlyError(err2)); });
      });
  }

  /* Reenviar sobre un email que a esta altura ya tiene cuenta. */
  function resendCode(email) {
    return requestCode(email, false)['catch'](function (err) {
      throw new Error(friendlyError(err));
    });
  }

  function verifyCode(email, code) {
    var c = sb();
    if (!c) return Promise.reject(new Error('No hay conexión con la nube ahora mismo.'));
    return c.auth.verifyOtp({ email: email, token: code, type: 'email' })
      .then(function (r) { if (r.error) throw new Error(friendlyError(r.error)); return r.data.session; });
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
    sendSignInCode: sendSignInCode,
    sendSignUpCode: sendSignUpCode,
    resendCode: resendCode,
    verifyCode: verifyCode,
    signOut: signOut,
    push: push,
    pull: pull
  };
})(window.GL = window.GL || {});
