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
  /* supabase-js devuelve estos errores en inglés y bastante crípticos; en la
     tarjeta tienen que leerse como una frase normal. */
  function coachError(err) {
    var msg = (err && err.message) || '';
    if (err && err.name === 'FunctionsFetchError' || /failed to send a request/i.test(msg)) {
      return 'No se pudo contactar al entrenador. Puede que la función todavía no esté desplegada, o que no haya conexión.';
    }
    if (err && err.name === 'FunctionsRelayError') {
      return 'El entrenador no respondió a tiempo. Probá de nuevo.';
    }
    return friendlyError(err);
  }

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
                throw new Error((body && body.error) || coachError(r.error));
              })
              ['catch'](function (e) {
                throw (e instanceof Error ? e : new Error(coachError(r.error)));
              });
          }
          throw new Error(coachError(r.error));
        }
        if (!r.data || (!r.data.recomendacion && !r.data.consejo)) {
          throw new Error(r.data && r.data.error ? r.data.error : 'La IA no devolvió nada.');
        }
        return r.data;
      });
  }

  /* ------------------------------------------------------------- chat
     Igual que el coach: la clave de la IA vive en la función, no acá, y
     supabase-js adjunta solo el token de la sesión. El historial lo manda el
     cliente desde sus propios ajustes; el servidor no guarda la charla de
     nadie, así que no hay forma de leer la de otra cuenta. */
  function chat(messages, profile) {
    var c = sb();
    if (!c) return Promise.reject(new Error('No hay conexión con la nube ahora mismo.'));
    return c.functions.invoke('chat', { body: { messages: messages, profile: profile || null } })
      .then(function (r) {
        if (r.error) {
          var ctxRes = r.error.context;
          if (ctxRes && typeof ctxRes.json === 'function') {
            return ctxRes.json()
              .then(function (b) { throw new Error((b && b.error) || coachError(r.error)); })
              ['catch'](function (e) {
                throw (e instanceof Error ? e : new Error(coachError(r.error)));
              });
          }
          throw new Error(coachError(r.error));
        }
        if (!r.data || !r.data.reply) {
          throw new Error((r.data && r.data.error) || 'La IA no devolvió respuesta.');
        }
        return r.data;
      });
  }

  /* ------------------------------------------------ suscripción push
     La tabla push_subscriptions tiene RLS por auth.uid(): el cliente escribe
     con su propia sesión y no hay forma de tocar la fila de otra cuenta,
     aunque se mande otro user_id. Lo pone el servidor a partir del token. */
  function savePushSubscription(subscriptionId) {
    var c = sb();
    if (!c) return Promise.reject(new Error('No hay conexión con la nube ahora mismo.'));
    return session().then(function (s) {
      if (!s) throw new Error('Iniciá sesión primero.');
      return c.from('push_subscriptions').upsert({
        user_id: s.user.id,
        subscription_id: subscriptionId,
        user_agent: (navigator.userAgent || '').slice(0, 200),
        updated_at: new Date().toISOString()
      });
    }).then(function (r) {
      if (r.error) throw new Error(friendlyError(r.error));
      return true;
    });
  }

  function deletePushSubscription() {
    var c = sb();
    if (!c) return Promise.resolve();
    return session().then(function (s) {
      if (!s) return null;
      return c.from('push_subscriptions')['delete']().eq('user_id', s.user.id);
    }).then(function (r) {
      if (r && r.error) throw new Error(friendlyError(r.error));
      return true;
    });
  }

  /* --------------------------------------------------------- unsplash
     La clave vive en la función. Un fallo acá NO es grave: la tarjeta para
     compartir sale igual con su fondo de siempre, así que el error se
     devuelve tal cual y quien llama decide. */
  function unsplash(category) {
    var c = sb();
    if (!c) return Promise.reject(new Error('No hay conexión con la nube ahora mismo.'));
    return c.functions.invoke('unsplash', { body: { category: category || null } })
      .then(function (r) {
        if (r.error) {
          var ctxRes = r.error.context;
          if (ctxRes && typeof ctxRes.json === 'function') {
            return ctxRes.json()
              .then(function (b) { throw new Error((b && b.error) || coachError(r.error)); })
              ['catch'](function (e) {
                throw (e instanceof Error ? e : new Error(coachError(r.error)));
              });
          }
          throw new Error(coachError(r.error));
        }
        if (!r.data || !r.data.imageUrl) {
          throw new Error((r.data && r.data.error) || 'Unsplash no devolvió ninguna foto.');
        }
        return r.data;
      });
  }

  /* ------------------------------------------------------------- fotos
     Todo pasa por la Edge Function «photos»: el navegador nunca toca el
     bucket directamente ni conoce su nombre. El id de usuario lo saca la
     función del token, así que desde acá no hay forma de pedir las fotos de
     otra cuenta. */
  function photosCall(action, extra) {
    var c = sb();
    if (!c) return Promise.reject(new Error('No hay conexión con la nube ahora mismo.'));
    var body = Object.assign({ action: action }, extra || {});
    return c.functions.invoke('photos', { body: body }).then(function (r) {
      if (r.error) {
        var ctxRes = r.error.context;
        if (ctxRes && typeof ctxRes.json === 'function') {
          return ctxRes.json()
            .then(function (b) {
              var e = new Error((b && b.error) || coachError(r.error));
              /* El cuerpo del error trae el uso al día (por ejemplo cuando se
                 agotó el límite semanal); vale la pena no perderlo. */
              if (b && b.usage) e.usage = b.usage;
              if (b && b.limited) e.limited = true;
              throw e;
            })
            ['catch'](function (e) {
              throw (e instanceof Error ? e : new Error(coachError(r.error)));
            });
        }
        throw new Error(coachError(r.error));
      }
      if (r.data && r.data.error) throw new Error(r.data.error);
      return r.data;
    });
  }

  /* Devuelve el objeto entero: fotos, uso semanal e historial vienen juntos
     en una sola llamada. */
  function listPhotos() {
    return photosCall('list').then(function (d) {
      return {
        photos: (d && d.photos) || [],
        usage: (d && d.usage) || null,
        history: (d && d.history) || []
      };
    });
  }

  /* Se pide una URL firmada de subida y se sube el archivo directo ahí: así
     la foto no viaja en base64 por el cuerpo de la función. */
  function uploadPhoto(file, date) {
    return photosCall('upload-url', { date: date, name: file.name || 'foto.jpg' })
      .then(function (d) {
        if (!d || !d.uploadUrl) throw new Error('No se pudo preparar la subida.');
        return fetch(d.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'image/jpeg' },
          body: file
        }).then(function (res) {
          if (!res.ok) throw new Error('No se pudo subir la foto.');
          return d.path;
        });
      });
  }

  function deletePhoto(path) { return photosCall('delete', { path: path }); }
  function opinePhotos() { return photosCall('opine'); }

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
    coach: coach,
    chat: chat,
    unsplash: unsplash,
    savePushSubscription: savePushSubscription,
    deletePushSubscription: deletePushSubscription,
    listPhotos: listPhotos,
    uploadPhoto: uploadPhoto,
    deletePhoto: deletePhoto,
    opinePhotos: opinePhotos
  };
})(window.GL = window.GL || {});
