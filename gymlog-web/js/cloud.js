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

  /* Supabase intenta mandar el correo de confirmación y, si el SMTP falla o se
     pasa del límite, devuelve «Error sending confirmation email». Ojo: para
     entonces el usuario a veces YA quedó creado. */
  function isEmailSendFailure(err) {
    return /error sending (?:confirmation|signup) (?:email|mail)/i.test((err && err.message) || '') ||
      /smtp|send.*email|email.*send/i.test((err && err.message) || '');
  }

  var CONFIRM_EMAIL_HINT =
    'Supabase está intentando mandar un correo de confirmación y no puede. ' +
    'Hay que desactivar «Confirm email» en el panel de Supabase ' +
    '(Authentication → Sign In / Providers → Email).';

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
     iniciada y no manda ningún correo: ese es el camino feliz.

     Si esa opción sigue activada, hay dos finales malos y los dos se salvan
     igual: probando iniciar sesión con lo que se acaba de registrar. Si la
     cuenta quedó creada (pasa incluso cuando el envío del correo falla), el
     login entra y la persona sigue adelante sin enterarse de nada. Solo si
     tampoco eso funciona se muestra el error, ya explicado. */
  function signUp(email, password) {
    var c = sb();
    if (!c) return Promise.reject(new Error('No hay conexión con la nube ahora mismo.'));

    function rescue(originalMsg) {
      return signIn(email, password)['catch'](function () {
        throw new Error(originalMsg);
      });
    }

    return c.auth.signUp({ email: email, password: password })
      .then(function (r) {
        if (r.error) {
          if (isEmailSendFailure(r.error)) return rescue(CONFIRM_EMAIL_HINT);
          throw new Error(friendlyError(r.error));
        }
        // sin sesión = «Confirm email» activado, pero el usuario ya existe
        if (!r.data.session) return rescue(CONFIRM_EMAIL_HINT);
        return r.data.session;
      })
      ['catch'](function (err) {
        // algunos fallos de SMTP llegan como excepción, no como r.error
        if (isEmailSendFailure(err)) return rescue(CONFIRM_EMAIL_HINT);
        throw err;
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

  /* Llama a la Edge Function que habla con Gemini. La clave de la IA vive
     allá, no acá: desde el navegador solo se manda el resumen de sesiones y
     el token del usuario, que supabase-js adjunta solo. */
  function coach(workouts, today) {
    var c = sb();
    if (!c) return Promise.reject(new Error('No hay conexión con la nube ahora mismo.'));
    return c.functions.invoke('coach', { body: { workouts: workouts, today: today } })
      .then(function (r) {
        /* Cuando la función responde con un código de error, supabase-js trae
           el detalle dentro de r.error.context; ahí está nuestro mensaje. */
        if (r.error) {
          var ctxRes = r.error.context;
          if (ctxRes && typeof ctxRes.json === 'function') {
            return ctxRes.json()
              .then(function (body) {
                throw new Error((body && body.error) || friendlyError(r.error));
              })
              ['catch'](function (e) {
                throw (e instanceof Error ? e : new Error(friendlyError(r.error)));
              });
          }
          throw new Error(friendlyError(r.error));
        }
        if (!r.data || (!r.data.recomendacion && !r.data.consejo)) {
          throw new Error(r.data && r.data.error ? r.data.error : 'La IA no devolvió nada.');
        }
        return r.data;
      });
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
    pull: pull,
    coach: coach
  };
})(window.GL = window.GL || {});
