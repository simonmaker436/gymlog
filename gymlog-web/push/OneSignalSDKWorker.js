/* Service worker de OneSignal.

   Vive en /push/ y NO en la raíz a propósito. GymLog ya tiene su propio
   service worker en /sw.js con alcance "/", que es el que guarda la app para
   que funcione sin conexión. Dos workers no pueden controlar el mismo
   alcance: si este se registrara en la raíz, uno de los dos perdería. Con el
   SDK apuntado a este archivo (serviceWorkerPath + serviceWorkerParam), las
   notificaciones viven en /push/ y el modo sin conexión sigue intacto. */
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDKWorker.js');
