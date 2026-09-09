/* =========================================================================
   sun.js — ¿esta sesión fue de día o de noche?
   =========================================================================
   Habla directo con api.sunrise-sunset.org: es pública, no lleva clave y
   responde con CORS abierto, así que no tiene sentido hacerla pasar por una
   Edge Function.

   Este módulo NO toca el almacén ni los ajustes a propósito: recibe unas
   coordenadas y devuelve una etiqueta. Quién pide el permiso al navegador y
   dónde se guarda lo decide app.js.
   ========================================================================= */
(function (GL) {
  'use strict';

  /* Respaldo cuando no hay permiso de ubicación o el navegador no la da.
     Bogotá: la diferencia de horario de amanecer entre ciudades cercanas es
     de minutos, así que para saber «de día o de noche» sobra. */
  var FALLBACK = { lat: 4.7110, lng: -74.0721, label: 'Bogotá', source: 'fallback' };

  var API = 'https://api.sunrise-sunset.org/json';
  var CACHE_KEY = 'gymlog:sun';
  var CACHE_MAX = 60;
  var GEO_TIMEOUT = 8000;

  /* --------------------------------------------------------------- caché
     El amanecer de un día que ya pasó no va a cambiar nunca, así que una vez
     preguntado se guarda para siempre. Se acota el tamaño para no dejar
     crecer localStorage sin fin. */
  function leerCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function guardarCache(cache) {
    try {
      var claves = Object.keys(cache);
      if (claves.length > CACHE_MAX) {
        /* se van las más viejas por fecha, que es lo que lleva la clave */
        claves.sort();
        claves.slice(0, claves.length - CACHE_MAX).forEach(function (k) { delete cache[k]; });
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) { /* modo privado o sin espacio: se sigue sin caché */ }
  }

  /* Redondear a tres decimales (~100 m) hace que el caché sirva aunque el
     GPS devuelva una posición ligeramente distinta cada vez. */
  function claveDe(lat, lng, date) {
    return lat.toFixed(3) + ',' + lng.toFixed(3) + '|' + date;
  }

  /* ---------------------------------------------------------- ubicación
     Se pregunta una sola vez; el resultado lo guarda quien llama. Un rechazo
     no es un error: es una respuesta, y la respuesta es «usá Bogotá». */
  function locate() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) { resolve(Object.assign({}, FALLBACK)); return; }

      var resuelto = false;
      var fin = function (v) { if (!resuelto) { resuelto = true; resolve(v); } };

      /* Algunos navegadores no llaman a ningún callback si el usuario ignora
         el diálogo: sin este plazo, la promesa se quedaría colgada. */
      setTimeout(function () { fin(Object.assign({}, FALLBACK)); }, GEO_TIMEOUT + 500);

      navigator.geolocation.getCurrentPosition(
        function (pos) {
          fin({
            lat: Math.round(pos.coords.latitude * 1000) / 1000,
            lng: Math.round(pos.coords.longitude * 1000) / 1000,
            label: null,
            source: 'device'
          });
        },
        function () { fin(Object.assign({}, FALLBACK)); },
        { timeout: GEO_TIMEOUT, maximumAge: 86400000, enableHighAccuracy: false }
      );
    });
  }

  /* ------------------------------------------------- amanecer y ocaso
     Devuelve las dos horas como Date, o null si no se pudo averiguar. */
  function times(lat, lng, date) {
    if (typeof lat !== 'number' || typeof lng !== 'number' || !date) {
      return Promise.resolve(null);
    }

    var clave = claveDe(lat, lng, date);
    var cache = leerCache();
    if (cache[clave]) {
      return Promise.resolve({
        sunrise: new Date(cache[clave].sunrise),
        sunset: new Date(cache[clave].sunset)
      });
    }

    /* formatted=0 devuelve ISO con zona, que es lo único con lo que se puede
       comparar sin adivinar husos horarios. */
    var url = API + '?lat=' + lat + '&lng=' + lng + '&date=' + date + '&formatted=0';

    return fetch(url)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || d.status !== 'OK' || !d.results) return null;
        var sunrise = new Date(d.results.sunrise);
        var sunset = new Date(d.results.sunset);
        if (isNaN(sunrise) || isNaN(sunset)) return null;

        cache[clave] = { sunrise: sunrise.toISOString(), sunset: sunset.toISOString() };
        guardarCache(cache);
        return { sunrise: sunrise, sunset: sunset };
      })
      ['catch'](function () { return null; });
  }

  /* --------------------------------------------------------- etiqueta
     `when` es el instante del entrenamiento (Date o ISO). Devuelve 'dia',
     'noche' o null si no se pudo saber; null es un valor válido y la app
     tiene que seguir funcionando igual. */
  function classify(when, lat, lng) {
    var t = (when instanceof Date) ? when : new Date(when);
    if (isNaN(t)) return Promise.resolve(null);

    /* La fecha que se le pide a la API es la del día LOCAL del usuario, que
       es la misma con la que se guarda el entrenamiento. */
    var y = t.getFullYear(), m = t.getMonth() + 1, d = t.getDate();
    var fecha = y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;

    return times(lat, lng, fecha).then(function (s) {
      if (!s) return null;
      return (t >= s.sunrise && t < s.sunset) ? 'dia' : 'noche';
    });
  }

  function label(key) {
    return key === 'dia' ? 'De día' : key === 'noche' ? 'De noche' : null;
  }

  GL.sun = {
    FALLBACK: FALLBACK,
    locate: locate,
    times: times,
    classify: classify,
    label: label
  };
})(window.GL = window.GL || {});
