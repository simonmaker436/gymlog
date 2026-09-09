/* =========================================================================
   push.js — notificaciones que llegan con la app cerrada (OneSignal)
   =========================================================================
   El App ID no es secreto: identifica la app, no autoriza nada. La clave
   REST, que sí manda notificaciones, vive solo en el entorno de la Edge
   Function send-reminders.

   NO se pide permiso al abrir la app: un diálogo de notificaciones en el
   primer segundo se rechaza casi siempre, y un «no» del navegador es difícil
   de revertir. El permiso se pide desde el interruptor de Ajustes, cuando la
   persona ya sabe para qué es.

   Este módulo no toca el almacén ni la nube: solo habla con el SDK y
   devuelve el id de suscripción. Guardarlo es cosa de app.js.
   ========================================================================= */
(function (GL) {
  'use strict';

  var APP_ID = '6f77941f-f54d-4483-bc7d-60603cfe06a5';

  /* El worker de OneSignal va en /push/ para no pelearse con el de GymLog,
     que ocupa la raíz. Ver el comentario de push/OneSignalSDKWorker.js. */
  var SW_PATH = 'push/OneSignalSDKWorker.js';
  var SW_SCOPE = '/push/';

  var iniciado = null;   // Promise, para no inicializar dos veces

  /* isSecureContext y no `protocol === 'https:'`: http://localhost también
     es contexto seguro para el navegador, y con la comprobación estricta no
     había forma de probar esto en local. */
  function disponible() {
    return typeof window !== 'undefined' &&
      'Notification' in window &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      window.isSecureContext === true;
  }

  /* El SDK expone una cola: se le encolan funciones y las corre cuando
     terminó de cargar. Así no hace falta esperar al <script>. */
  function conSDK() {
    return new Promise(function (resolve, reject) {
      if (!disponible()) { reject(new Error('Este navegador no admite notificaciones.')); return; }
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      var listo = false;
      window.OneSignalDeferred.push(function (OneSignal) {
        listo = true;
        resolve(OneSignal);
      });
      /* Si el CDN está bloqueado, la cola nunca se vacía. */
      setTimeout(function () {
        if (!listo) reject(new Error('No se pudo cargar el servicio de notificaciones.'));
      }, 12000);
    });
  }

  /* OneSignal ata cada app a UN origen, el que se configuró en su panel. En
     cualquier otro el SDK se niega a arrancar con un mensaje en inglés que no
     dice qué hacer. Se traduce nombrando el origen permitido, que es la
     información que hace falta para arreglarlo. */
  function traducirError(e) {
    var m = (e && e.message) || String(e || '');
    var permitido = m.match(/Can only be used on:\s*(\S+)/i);
    if (permitido) {
      return new Error('Las notificaciones solo están habilitadas en ' + permitido[1] +
        '. Abrí GymLog desde esa dirección, o agregá esta en el panel de OneSignal.');
    }
    if (/denied|permission/i.test(m)) {
      return new Error('El navegador tiene las notificaciones bloqueadas para este sitio.');
    }
    return new Error(m || 'No se pudo iniciar el servicio de notificaciones.');
  }

  function init() {
    if (iniciado) return iniciado;
    iniciado = conSDK().then(function (OneSignal) {
      return OneSignal.init({
        appId: APP_ID,
        serviceWorkerPath: SW_PATH,
        serviceWorkerParam: { scope: SW_SCOPE },
        allowLocalhostAsSecureOrigin: true,
        /* Sin ningún prompt automático: el permiso se pide desde Ajustes. */
        autoRegister: false,
        autoResubscribe: true
      }).then(function () { return OneSignal; });
    })['catch'](function (e) {
      /* Se vuelve a poner en null para que un reintento (por ejemplo tras
         arreglar el dominio) no quede atrapado en el fallo de la primera. */
      iniciado = null;
      throw traducirError(e);
    });
    return iniciado;
  }

  /* Estado actual, sin pedir nada. */
  function estado() {
    if (!disponible()) return Promise.resolve({ soportado: false, permiso: 'unsupported', id: null });
    return init().then(function (OneSignal) {
      return {
        soportado: true,
        permiso: (typeof Notification !== 'undefined') ? Notification.permission : 'default',
        id: (OneSignal.User && OneSignal.User.PushSubscription)
          ? (OneSignal.User.PushSubscription.id || null)
          : null
      };
    })['catch'](function (e) {
      /* El motivo importa: «no soportado» a secas no le dice a nadie qué
         hacer, y acá casi siempre es el dominio. */
      return { soportado: false, permiso: 'error', id: null, motivo: e.message };
    });
  }

  /* Pide el permiso y devuelve el id de suscripción.

     El id no aparece en el mismo instante en que se concede el permiso: el
     navegador todavía tiene que registrar la suscripción contra el servicio
     de push. Por eso se sondea un rato en vez de leerlo una sola vez. */
  function activar() {
    return init().then(function (OneSignal) {
      return OneSignal.Notifications.requestPermission().then(function () {
        if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
          throw new Error('permiso-denegado');
        }
        return OneSignal.User.PushSubscription.optIn();
      }).then(function () {
        return new Promise(function (resolve, reject) {
          var intentos = 0;
          (function mirar() {
            var id = OneSignal.User.PushSubscription.id;
            if (id) { resolve(id); return; }
            if (++intentos > 30) { reject(new Error('sin-id')); return; }
            setTimeout(mirar, 400);
          })();
        });
      });
    });
  }

  function desactivar() {
    return init().then(function (OneSignal) {
      return OneSignal.User.PushSubscription.optOut();
    })['catch'](function () { /* si el SDK no cargó, tampoco hay nada que apagar */ });
  }

  GL.push = {
    APP_ID: APP_ID,
    disponible: disponible,
    init: init,
    estado: estado,
    activar: activar,
    desactivar: desactivar
  };
})(window.GL = window.GL || {});
