/* =========================================================================
   store.js — Capa de persistencia local (IndexedDB con respaldo localStorage)
   =========================================================================
   No hay servidor ni API. Todo vive en el dispositivo.
   Estructura:
     workouts     : { id, date, went, duration, energy, feeling, difficulty,
                      weight, notes, demo, createdAt, updatedAt }
     weights      : { id, date, value, src('manual'|'workout'), demo }
     measurements : { id, date, bicepsIzq, bicepsDer, gemeloIzq, gemeloDer,
                       musloIzq, musloDer, pecho, cintura, demo }  (todo en cm)
     kv           : { k, v }   -> ajustes y logros desbloqueados
   ========================================================================= */
(function (GL) {
  'use strict';

  var DB_NAME = 'gymlog-db';
  var DB_VERSION = 3;
  var STORES = ['workouts', 'weights', 'measurements', 'kv', 'backups'];
  var LS_PREFIX = 'gymlog:';

  var db = null;
  var useFallback = false;

  /* ---------------------------------------------------------------- utils */
  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 8);
  }

  /* ------------------------------------------------ respaldo localStorage */
  var LS = {
    read: function (name) {
      try {
        var raw = localStorage.getItem(LS_PREFIX + name);
        return raw ? JSON.parse(raw) : [];
      } catch (e) { return []; }
    },
    write: function (name, rows) {
      try {
        localStorage.setItem(LS_PREFIX + name, JSON.stringify(rows));
        return true;
      } catch (e) { return false; }
    }
  };

  /* ------------------------------------------------------------ IndexedDB */
  function openDB() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined' || indexedDB === null) {
        return reject(new Error('IndexedDB no disponible'));
      }
      var req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { return reject(e); }

      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains('workouts')) {
          var ws = d.createObjectStore('workouts', { keyPath: 'id' });
          ws.createIndex('date', 'date', { unique: false });
        }
        if (!d.objectStoreNames.contains('weights')) {
          var bs = d.createObjectStore('weights', { keyPath: 'id' });
          bs.createIndex('date', 'date', { unique: false });
        }
        if (!d.objectStoreNames.contains('measurements')) {
          var ms = d.createObjectStore('measurements', { keyPath: 'id' });
          ms.createIndex('date', 'date', { unique: false });
        }
        if (!d.objectStoreNames.contains('kv')) {
          d.createObjectStore('kv', { keyPath: 'k' });
        }
        if (!d.objectStoreNames.contains('backups')) {
          d.createObjectStore('backups', { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Error al abrir IndexedDB')); };
      req.onblocked = function () { reject(new Error('IndexedDB bloqueada')); };
      // Safari en modo privado a veces se queda colgado sin disparar eventos.
      setTimeout(function () {
        if (!db && req.readyState !== 'done') reject(new Error('Tiempo de espera agotado'));
      }, 3000);
    });
  }

  function tx(name, mode) {
    return db.transaction(name, mode).objectStore(name);
  }

  function idbAll(name) {
    return new Promise(function (resolve, reject) {
      var req = tx(name, 'readonly').getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbPut(name, value) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(name, 'readwrite');
      t.objectStore(name).put(value);
      t.oncomplete = function () { resolve(value); };
      t.onerror = function () { reject(t.error); };
    });
  }

  function idbDelete(name, key) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(name, 'readwrite');
      t.objectStore(name)['delete'](key);
      t.oncomplete = function () { resolve(true); };
      t.onerror = function () { reject(t.error); };
    });
  }

  function idbClear(name) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(name, 'readwrite');
      t.objectStore(name).clear();
      t.oncomplete = function () { resolve(true); };
      t.onerror = function () { reject(t.error); };
    });
  }

  /* ------------------------------------------------------- API unificada */
  function all(name) {
    if (useFallback) return Promise.resolve(LS.read(name));
    return idbAll(name)['catch'](function () { return LS.read(name); });
  }

  function put(name, value) {
    if (useFallback) {
      var rows = LS.read(name);
      var key = name === 'kv' ? 'k' : 'id';
      var i = rows.findIndex(function (r) { return r[key] === value[key]; });
      if (i >= 0) rows[i] = value; else rows.push(value);
      LS.write(name, rows);
      return Promise.resolve(value);
    }
    return idbPut(name, value);
  }

  function remove(name, key) {
    if (useFallback) {
      var rows = LS.read(name);
      var kf = name === 'kv' ? 'k' : 'id';
      LS.write(name, rows.filter(function (r) { return r[kf] !== key; }));
      return Promise.resolve(true);
    }
    return idbDelete(name, key);
  }

  function clear(name) {
    if (useFallback) { LS.write(name, []); return Promise.resolve(true); }
    return idbClear(name);
  }

  /* ------------------------------------------------------------- ajustes */
  var DEFAULT_SETTINGS = {
    name: 'Simón',
    gymDays: [2, 3, 5],       // 0=domingo … 2=martes, 3=miércoles, 5=viernes
    startDate: null,          // desde cuándo cuentan las estadísticas
    goal: 12,                 // objetivo de entrenamientos al mes
    weeklyGoal: null,         // meta semanal; null = tantos como días programados
    backfillDays: 7,          // cuántos días atrás se puede rellenar una sesión
    intro: true,              // la animación "LOCK IN" al abrir
    lastExport: null,         // fecha de la última copia que te llevaste
    units: 'kg',
    theme: 'dark',       // es un cuaderno de gimnasio: oscuro de fábrica
    reminders: true,
    reminderHour: 17,         // desde qué hora avisar si hoy toca y no registraste
    demoSeeded: false,
    onboarded: false,         // ya completó la encuesta inicial de perfil
    age: null,
    heightCm: null,
    startWeight: null,        // peso indicado en la encuesta inicial (solo referencia)
    bodyGoal: null,           // 'ganar-musculo' | 'perder-grasa' | 'mantenerme' | 'rendimiento'
    lastSync: null,           // fecha de la última sincronización con la nube
    /* Última recomendación de la IA. Se guarda con el día en que se pidió
       para no gastar cuota más de una vez al día. Va en settings a propósito:
       así viaja a la cuenta y el mismo consejo aparece en todos los
       dispositivos sin volver a llamar a la API.
       { date: 'YYYY-MM-DD', recomendacion, consejo } */
    coach: null,

    /* La conversación con el entrenador. Vive en settings a propósito: así
       viaja a la cuenta con el resto del respaldo (tabla `backups`, con RLS
       por auth.uid()) y la charla sigue en el otro dispositivo, sin montar
       ningún almacén compartido donde pudiera cruzarse con la de nadie.
       [{ role: 'user' | 'assistant', text, at }] */
    chat: null
  };

  /* Cuántos mensajes se guardan. El respaldo entero viaja en cada
     sincronización: una charla infinita lo engordaría sin sentido. */
  var CHAT_MAX = 40;
  var CHAT_MAX_CHARS = 2000;

  /* Una sola etiqueta por sesión. Nada de listas de ejercicios ni series:
     esto es un cuaderno de constancia, no de rutinas. */
  var WORKOUT_TYPES = [
    { key: 'pierna', label: 'Pierna' },
    { key: 'empuje', label: 'Empuje' },
    { key: 'tiron', label: 'Tirón' },
    { key: 'fullbody', label: 'Full body' },
    { key: 'cardio', label: 'Cardio' },
    { key: 'otro', label: 'Otro' }
  ];

  function workoutTypeLabel(key) {
    var t = WORKOUT_TYPES.find(function (x) { return x.key === key; });
    return t ? t.label : null;
  }

  /* Opcional a propósito: null es un valor válido y significa «sin etiqueta».
     Cualquier cosa que no esté en la lista se descarta. */
  function normalizeType(v) {
    if (v === '' || v === null || v === undefined) return null;
    return WORKOUT_TYPES.some(function (t) { return t.key === v; }) ? v : null;
  }

  var BODY_GOALS = [
    { key: 'ganar-musculo', label: 'Ganar músculo' },
    { key: 'perder-grasa', label: 'Perder grasa' },
    { key: 'mantenerme', label: 'Mantenerme' },
    { key: 'rendimiento', label: 'Rendimiento' }
  ];

  /* La intro tiene que decidirse antes de que arranque IndexedDB, así que el
     ajuste se copia también a localStorage, que sí se lee de forma inmediata. */
  function mirrorIntro() {
    try { localStorage.setItem(LS_PREFIX + 'intro', cache.settings.intro ? '1' : '0'); }
    catch (e) { }
  }

  function todayISO() {
    var d = new Date(), m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  function normalizeSettings(s) {
    var out = {};
    Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
      out[k] = (s && s[k] !== undefined && s[k] !== null) ? s[k] : DEFAULT_SETTINGS[k];
    });
    if (!Array.isArray(out.gymDays)) out.gymDays = DEFAULT_SETTINGS.gymDays.slice();
    out.gymDays = out.gymDays
      .map(Number)
      .filter(function (n) { return n >= 0 && n <= 6; })
      .sort(function (a, b) { return a - b; });
    if (['kg', 'lb'].indexOf(out.units) < 0) out.units = 'kg';
    if (['auto', 'light', 'dark'].indexOf(out.theme) < 0) out.theme = 'auto';
    if (out.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(out.startDate)) out.startDate = null;
    out.goal = Math.max(1, Math.min(31, Math.round(Number(out.goal) || 12)));
    out.backfillDays = Math.max(0, Math.min(60, Math.round(Number(out.backfillDays) == null ? 7 : Number(out.backfillDays))));
    if (isNaN(out.backfillDays)) out.backfillDays = 7;

    out.onboarded = !!out.onboarded;
    if (out.age != null) {
      var ageN = Math.round(Number(out.age));
      out.age = (isNaN(ageN) || ageN < 10 || ageN > 100) ? null : ageN;
    }
    if (out.heightCm != null) {
      var hN = Math.round(Number(out.heightCm));
      out.heightCm = (isNaN(hN) || hN < 100 || hN > 250) ? null : hN;
    }
    if (out.startWeight != null) {
      var wN = Number(out.startWeight);
      out.startWeight = (isNaN(wN) || wN <= 0) ? null : Math.round(wN * 10) / 10;
    }
    if (!BODY_GOALS.some(function (g) { return g.key === out.bodyGoal; })) out.bodyGoal = null;
    if (out.lastSync && isNaN(Date.parse(out.lastSync))) out.lastSync = null;

    var rh = Math.round(Number(out.reminderHour));
    out.reminderHour = (isNaN(rh) || rh < 0 || rh > 23) ? 17 : rh;

    /* Solo se acepta un consejo con la forma esperada; cualquier otra cosa
       se descarta y se vuelve a pedir. */
    if (out.coach) {
      var co = out.coach;
      var ok = co && typeof co === 'object' &&
        /^\d{4}-\d{2}-\d{2}$/.test(co.date || '') &&
        (typeof co.recomendacion === 'string' || typeof co.consejo === 'string');
      out.coach = ok ? {
        date: co.date,
        recomendacion: (co.recomendacion || '').toString().slice(0, 600),
        consejo: (co.consejo || '').toString().slice(0, 600)
      } : null;
    }

    /* La charla llega del respaldo, que puede venir de una versión vieja o
       de un archivo importado a mano: se acepta solo lo que tiene forma de
       mensaje. */
    if (out.chat != null) {
      out.chat = Array.isArray(out.chat)
        ? out.chat.filter(function (m) {
          return m && typeof m === 'object' &&
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.text === 'string' && m.text.trim();
        }).map(function (m) {
          return {
            role: m.role,
            text: m.text.toString().slice(0, CHAT_MAX_CHARS),
            at: typeof m.at === 'string' ? m.at : null
          };
        }).slice(-CHAT_MAX)
        : null;
      if (out.chat && !out.chat.length) out.chat = null;
    }

    /* null a propósito: significa «los que tenga programados», así la meta
       sigue sola a los días de gimnasio hasta que se fije un número. */
    if (out.weeklyGoal != null) {
      var wg = Math.round(Number(out.weeklyGoal));
      out.weeklyGoal = (isNaN(wg) || wg < 1 || wg > 14) ? null : wg;
    }

    return out;
  }

  /* Meta semanal efectiva: la fijada, o los días programados. */
  function weeklyTarget(s) {
    if (s.weeklyGoal != null) return s.weeklyGoal;
    return Math.max(1, s.gymDays.length || 3);
  }

  /* ------------------------------------------------------- estado en RAM */
  var cache = { workouts: [], weights: [], measurements: [], settings: null, achievements: {} };

  function sortWorkouts() {
    cache.workouts.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  }
  function sortWeights() {
    cache.weights.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }
  function sortMeasurements() {
    cache.measurements.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  /* Migración v1 → v2: la app dejó de cargar datos de ejemplo por su cuenta.
     Si el dispositivo todavía guarda los de la versión anterior, se borran, y
     se fija la fecha de inicio en el día de hoy: se empieza de cero, sin
     arrastrar faltas de días anteriores. */
  function migrate(from) {
    if (from >= 2) {
      if (!cache.settings.startDate) return api.saveSettings({ startDate: todayISO() });
      return Promise.resolve();
    }
    var demoW = cache.workouts.filter(function (w) { return w.demo; });
    var demoB = cache.weights.filter(function (w) { return w.demo; });
    cache.workouts = cache.workouts.filter(function (w) { return !w.demo; });
    cache.weights = cache.weights.filter(function (w) { return !w.demo; });

    return Promise.all(
      demoW.map(function (w) { return remove('workouts', w.id); })
        .concat(demoB.map(function (w) { return remove('weights', w.id); }))
    ).then(function () {
      var first = cache.workouts.length
        ? cache.workouts.map(function (w) { return w.date; }).sort()[0]
        : null;
      return api.saveSettings({
        startDate: cache.settings.startDate || first || todayISO(),
        demoSeeded: false
      });
    }).then(function () {
      return put('kv', { k: 'schemaVersion', v: 2 });
    });
  }

  var api = {
    ready: false,
    storageMode: 'indexeddb',
    persisted: null,          // true = el navegador se compromete a no borrarlo
    todayISO: todayISO,

    /* Safari borra el almacenamiento de los sitios que no visitas. Pedir
       almacenamiento persistente reduce mucho ese riesgo; WebKit lo concede
       sobre todo si la app está añadida a la pantalla de inicio. */
    requestPersistence: function () {
      if (!navigator.storage || !navigator.storage.persist) {
        api.persisted = null;
        return Promise.resolve(null);
      }
      return navigator.storage.persisted()
        .then(function (already) { return already ? true : navigator.storage.persist(); })
        .then(function (ok) { api.persisted = !!ok; return api.persisted; })
        ['catch'](function () { api.persisted = null; return null; });
    },

    /* ---------------------------------------------- copias automáticas
       Cinco fotos del estado guardadas aparte. No te salvan de que el
       navegador borre TODO, pero sí de un borrado accidental o una
       importación equivocada. */
    listBackups: function () {
      return all('backups').then(function (rows) {
        return rows.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
      })['catch'](function () { return []; });
    },

    makeBackup: function (reason) {
      if (!cache.workouts.length && !cache.weights.length) return Promise.resolve(null);
      var rec = {
        id: 'bk-' + Date.now().toString(36),
        at: new Date().toISOString(),
        reason: reason || 'auto',
        workouts: cache.workouts.length,
        payload: api.exportData()
      };
      return put('backups', rec)
        .then(function () { return api.listBackups(); })
        .then(function (rows) {
          return Promise.all(rows.slice(5).map(function (r) { return remove('backups', r.id); }));
        })
        .then(function () { return rec; })
        ['catch'](function () { return null; });
    },

    restoreBackup: function (id) {
      return all('backups').then(function (rows) {
        var b = rows.find(function (r) { return r.id === id; });
        if (!b) throw new Error('Esa copia ya no está.');
        return api.importData(b.payload, 'replace');
      });
    },

    /* copia diaria: como mucho una cada 20 horas */
    autoBackup: function () {
      return api.listBackups().then(function (rows) {
        var last = rows.find(function (r) { return r.reason === 'auto'; });
        if (last && (Date.now() - new Date(last.at).getTime()) < 20 * 3600 * 1000) return null;
        return api.makeBackup('auto');
      })['catch'](function () { return null; });
    },

    init: function () {
      return openDB()
        .then(function (d) { db = d; useFallback = false; api.storageMode = 'indexeddb'; })
        ['catch'](function () { useFallback = true; api.storageMode = 'localstorage'; })
        .then(function () {
          return Promise.all([all('workouts'), all('weights'), all('measurements'), all('kv')]);
        })
        .then(function (res) {
          cache.workouts = res[0] || [];
          cache.weights = res[1] || [];
          cache.measurements = res[2] || [];
          var kv = {};
          (res[3] || []).forEach(function (r) { kv[r.k] = r.v; });
          cache.settings = normalizeSettings(kv.settings);
          cache.achievements = kv.achievements || {};
          sortWorkouts(); sortWeights(); sortMeasurements();
          mirrorIntro();
          api.ready = true;
          api.requestPersistence();
          return migrate(kv.schemaVersion || 1);
        });
    },

    /* ------------------------------------------------------- lectura */
    workouts: function () { return cache.workouts.slice(); },
    weights: function () { return cache.weights.slice(); },
    measurements: function () { return cache.measurements.slice(); },
    settings: function () { return cache.settings; },
    achievements: function () { return cache.achievements; },

    workoutByDate: function (date) {
      return cache.workouts.find(function (w) { return w.date === date; }) || null;
    },

    /* --------------------------------------------- escritura workouts */
    saveWorkout: function (data) {
      var existing = data.id
        ? cache.workouts.find(function (w) { return w.id === data.id; })
        : api.workoutByDate(data.date);

      /* Última línea de defensa: la ventana de registro también se respeta
         aquí, no solo en el formulario. Editar algo que ya existe siempre
         está permitido; lo que caduca es crear un registro nuevo del pasado. */
      if (!existing && !GL.stats.canLog(data.date, undefined, cache.settings.backfillDays)) {
        return Promise.reject(new Error('Ese día ya no se puede registrar.'));
      }

      var now = new Date().toISOString();
      var rec = {
        id: existing ? existing.id : uid('w'),
        date: data.date,
        went: !!data.went,
        duration: data.went ? Math.max(0, Math.round(Number(data.duration) || 0)) : 0,
        energy: data.went ? clamp15(data.energy) : null,
        feeling: data.went ? clamp15(data.feeling) : null,
        difficulty: data.went ? clamp15(data.difficulty) : null,
        // sin ir al gimnasio no hay tipo de entreno que valga
        type: data.went ? normalizeType(data.type) : null,
        weight: (data.weight === '' || data.weight === null || data.weight === undefined || isNaN(Number(data.weight)))
          ? null : Number(data.weight),
        notes: (data.notes || '').trim(),
        demo: existing ? !!existing.demo && !!data.keepDemoFlag : !!data.demo,
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now
      };
      if (existing && data.id) rec.demo = false;   // editar un demo lo vuelve real

      var i = cache.workouts.findIndex(function (w) { return w.id === rec.id; });
      if (i >= 0) cache.workouts[i] = rec; else cache.workouts.push(rec);
      // solo un registro por fecha
      cache.workouts = cache.workouts.filter(function (w) {
        return w.id === rec.id || w.date !== rec.date;
      });
      sortWorkouts();

      return put('workouts', rec)
        .then(function () { return api._syncWorkoutWeight(rec); })
        .then(function () { return api._pruneDuplicateDates(rec); })
        .then(function () { return rec; });
    },

    _pruneDuplicateDates: function (rec) {
      // elimina de la base cualquier registro huérfano con la misma fecha
      return all('workouts').then(function (rows) {
        var dupes = rows.filter(function (w) { return w.date === rec.date && w.id !== rec.id; });
        return Promise.all(dupes.map(function (d) { return remove('workouts', d.id); }));
      })['catch'](function () { });
    },

    _syncWorkoutWeight: function (rec) {
      var id = 'wk-' + rec.date;
      var i = cache.weights.findIndex(function (x) { return x.id === id; });
      if (rec.weight === null || rec.weight === undefined) {
        if (i >= 0) { cache.weights.splice(i, 1); return remove('weights', id); }
        return Promise.resolve();
      }
      var entry = { id: id, date: rec.date, value: rec.weight, src: 'workout', demo: !!rec.demo };
      if (i >= 0) cache.weights[i] = entry; else cache.weights.push(entry);
      sortWeights();
      return put('weights', entry);
    },

    deleteWorkout: function (id) {
      var rec = cache.workouts.find(function (w) { return w.id === id; });
      cache.workouts = cache.workouts.filter(function (w) { return w.id !== id; });
      var chain = remove('workouts', id);
      if (rec) {
        var wid = 'wk-' + rec.date;
        cache.weights = cache.weights.filter(function (x) { return x.id !== wid; });
        chain = chain.then(function () { return remove('weights', wid); });
      }
      return chain;
    },

    /* ---------------------------------------------- escritura weights */
    saveWeight: function (data) {
      var rec = {
        id: data.id || uid('m'),
        date: data.date,
        value: Number(data.value),
        src: 'manual',
        demo: false
      };
      var i = cache.weights.findIndex(function (x) { return x.id === rec.id; });
      if (i >= 0) cache.weights[i] = rec; else cache.weights.push(rec);
      sortWeights();
      return put('weights', rec).then(function () { return rec; });
    },

    deleteWeight: function (id) {
      var rec = cache.weights.find(function (x) { return x.id === id; });
      cache.weights = cache.weights.filter(function (x) { return x.id !== id; });
      var chain = remove('weights', id);
      // si venía de un entrenamiento, también limpiamos el campo del entrenamiento
      if (rec && rec.src === 'workout') {
        var w = api.workoutByDate(rec.date);
        if (w) { w.weight = null; w.updatedAt = new Date().toISOString(); chain = chain.then(function () { return put('workouts', w); }); }
      }
      return chain;
    },

    /* ---------------------------------------------- escritura medidas
       Una fila por fecha, como una "sesión" de medición: guardar de nuevo
       el mismo día reemplaza esa fila en vez de duplicarla. Todo opcional. */
    saveMeasurement: function (data) {
      var existing = data.id
        ? cache.measurements.find(function (x) { return x.id === data.id; })
        : cache.measurements.find(function (x) { return x.date === data.date; });
      var rec = { id: existing ? existing.id : uid('me'), date: data.date, demo: false };
      GL.stats.MEASURE_FIELDS.forEach(function (f) {
        if (f.paired) {
          rec[f.key + 'Izq'] = numOrNull(data[f.key + 'Izq']);
          rec[f.key + 'Der'] = numOrNull(data[f.key + 'Der']);
        } else {
          rec[f.key] = numOrNull(data[f.key]);
        }
      });
      var i = cache.measurements.findIndex(function (x) { return x.id === rec.id; });
      if (i >= 0) cache.measurements[i] = rec; else cache.measurements.push(rec);
      // solo un registro por fecha
      cache.measurements = cache.measurements.filter(function (x) { return x.id === rec.id || x.date !== rec.date; });
      sortMeasurements();
      return put('measurements', rec).then(function () { return rec; });
    },

    deleteMeasurement: function (id) {
      cache.measurements = cache.measurements.filter(function (x) { return x.id !== id; });
      return remove('measurements', id);
    },

    /* --------------------------------------------------------- ajustes */
    saveSettings: function (patch) {
      cache.settings = normalizeSettings(Object.assign({}, cache.settings, patch));
      mirrorIntro();
      return put('kv', { k: 'settings', v: cache.settings }).then(function () { return cache.settings; });
    },

    saveAchievements: function (map) {
      cache.achievements = map;
      return put('kv', { k: 'achievements', v: map });
    },

    /* ------------------------------------------------- demo / borrado */
    hasDemo: function () {
      return cache.workouts.some(function (w) { return w.demo; });
    },

    seedDemo: function (rows, weightRows) {
      var prevStart = cache.settings.startDate;
      cache.workouts = cache.workouts.concat(rows);
      sortWorkouts();
      cache.weights = cache.weights.concat(weightRows || []);
      sortWeights();
      return Promise.all(
        rows.map(function (r) { return put('workouts', r); })
          .concat((weightRows || []).map(function (r) { return put('weights', r); }))
      ).then(function () {
        var first = rows.length ? rows.map(function (r) { return r.date; }).sort()[0] : prevStart;
        return api.saveSettings({ demoSeeded: true, startDate: first });
      });
    },

    clearDemo: function () {
      var demoW = cache.workouts.filter(function (w) { return w.demo; });
      var demoB = cache.weights.filter(function (w) { return w.demo; });
      cache.workouts = cache.workouts.filter(function (w) { return !w.demo; });
      cache.weights = cache.weights.filter(function (w) { return !w.demo; });
      return Promise.all(
        demoW.map(function (w) { return remove('workouts', w.id); })
          .concat(demoB.map(function (w) { return remove('weights', w.id); }))
      ).then(function () {
        var first = cache.workouts.length
          ? cache.workouts.map(function (w) { return w.date; }).sort()[0]
          : todayISO();
        return api.saveSettings({ demoSeeded: false, startDate: first });
      });
    },

    clearAll: function (skipBackup) {
      var pre = skipBackup ? Promise.resolve() : api.makeBackup('antes-de-borrar');
      return pre.then(function () {
        cache.workouts = [];
        cache.weights = [];
        cache.measurements = [];
        cache.achievements = {};
        return Promise.all([clear('workouts'), clear('weights'), clear('measurements')]);
      })
        .then(function () { return put('kv', { k: 'achievements', v: {} }); })
        // volver a empezar es volver a empezar: el contador arranca hoy
        .then(function () { return api.saveSettings({ demoSeeded: false, startDate: todayISO() }); });
    },

    /* --------------------------------------------- exportar / importar */
    markExported: function () {
      return api.saveSettings({ lastExport: new Date().toISOString() });
    },

    exportData: function () {
      return {
        app: 'gymlog',
        version: 3,
        exportedAt: new Date().toISOString(),
        settings: cache.settings,
        achievements: cache.achievements,
        workouts: cache.workouts,
        weights: cache.weights.filter(function (w) { return w.src === 'manual'; }),
        measurements: cache.measurements
      };
    },

    importData: function (payload, mode) {
      if (!payload || payload.app !== 'gymlog' || !Array.isArray(payload.workouts)) {
        return Promise.reject(new Error('El archivo no tiene el formato de una copia de GymLog.'));
      }
      var start = api.makeBackup('antes-de-importar')
        .then(function () { return mode === 'merge' ? null : api.clearAll(true); });
      return start.then(function () {
        var byDate = {};
        cache.workouts.forEach(function (w) { byDate[w.date] = w; });

        var incoming = payload.workouts.filter(function (w) { return w && w.date; }).map(function (w) {
          var prev = byDate[w.date];
          return {
            id: prev ? prev.id : (w.id || uid('w')),
            date: w.date,
            went: !!w.went,
            duration: Math.max(0, Math.round(Number(w.duration) || 0)),
            energy: w.energy == null ? null : clamp15(w.energy),
            feeling: w.feeling == null ? null : clamp15(w.feeling),
            difficulty: w.difficulty == null ? null : clamp15(w.difficulty),
            /* Las copias hechas antes de que existiera el tipo no lo traen:
               quedan en null, que es un valor válido. */
            type: normalizeType(w.type),
            weight: (w.weight == null || isNaN(Number(w.weight))) ? null : Number(w.weight),
            notes: (w.notes || '').toString(),
            demo: !!w.demo,
            createdAt: w.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
        });

        incoming.forEach(function (w) {
          var i = cache.workouts.findIndex(function (x) { return x.date === w.date; });
          if (i >= 0) cache.workouts[i] = w; else cache.workouts.push(w);
        });
        sortWorkouts();

        var manual = (payload.weights || []).filter(function (w) { return w && w.date && w.value != null; })
          .map(function (w) {
            return { id: w.id || uid('m'), date: w.date, value: Number(w.value), src: 'manual', demo: false };
          });
        manual.forEach(function (w) {
          var i = cache.weights.findIndex(function (x) { return x.id === w.id; });
          if (i >= 0) cache.weights[i] = w; else cache.weights.push(w);
        });

        var incomingM = (payload.measurements || []).filter(function (m) { return m && m.date; }).map(function (m) {
          var rec = { id: m.id || uid('me'), date: m.date, demo: false };
          GL.stats.MEASURE_FIELDS.forEach(function (f) {
            if (f.paired) {
              rec[f.key + 'Izq'] = numOrNull(m[f.key + 'Izq']);
              rec[f.key + 'Der'] = numOrNull(m[f.key + 'Der']);
            } else {
              rec[f.key] = numOrNull(m[f.key]);
            }
          });
          return rec;
        });
        incomingM.forEach(function (m) {
          var i = cache.measurements.findIndex(function (x) { return x.id === m.id; });
          if (i >= 0) cache.measurements[i] = m; else cache.measurements.push(m);
        });
        sortMeasurements();

        var ops = incoming.map(function (w) { return put('workouts', w); })
          .concat(manual.map(function (w) { return put('weights', w); }))
          .concat(incomingM.map(function (m) { return put('measurements', m); }));

        return Promise.all(ops)
          .then(function () {
            return Promise.all(incoming.map(function (w) { return api._syncWorkoutWeight(w); }));
          })
          .then(function () {
            if (payload.settings) return api.saveSettings(payload.settings);
          })
          .then(function () {
            if (payload.achievements) return api.saveAchievements(payload.achievements);
          })
          .then(function () { return { workouts: incoming.length, weights: manual.length, measurements: incomingM.length }; });
      });
    },

    /* estimación de espacio ocupado */
    estimate: function () {
      if (navigator.storage && navigator.storage.estimate) return navigator.storage.estimate();
      return Promise.resolve(null);
    },

    uid: uid,
    weeklyTarget: weeklyTarget,
    CHAT_MAX: CHAT_MAX,
    workoutTypeLabel: workoutTypeLabel,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    WORKOUT_TYPES: WORKOUT_TYPES,
    BODY_GOALS: BODY_GOALS
  };

  function clamp15(n) {
    n = Math.round(Number(n) || 0);
    return Math.min(5, Math.max(1, n));
  }

  function numOrNull(v) {
    if (v === '' || v === null || v === undefined) return null;
    var n = Number(v);
    return isNaN(n) ? null : Math.round(n * 10) / 10;
  }

  GL.store = api;
})(window.GL = window.GL || {});
