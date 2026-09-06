/* =========================================================================
   stats.js — Motor de cálculo. Funciones puras: entran datos, salen números.
   Todo lo que muestra la app se calcula aquí a partir de los registros reales.
   ========================================================================= */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  root.GL = root.GL || {};
  root.GL.stats = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY_MS = 86400000;
  var DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  var DAY_SHORT = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
    'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  /* ------------------------------------------------- fechas como 'AAAA-MM-DD'
     Se trabaja siempre con cadenas locales para evitar saltos por zona horaria. */
  function iso(d) {
    var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  function parse(s) {
    var p = String(s).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  function today() { return iso(new Date()); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function dow(s) { return parse(s).getDay(); }
  function monthKey(s) { return String(s).slice(0, 7); }
  function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / DAY_MS); }

  function formatLong(s) {
    var d = parse(s);
    return DAY_NAMES[d.getDay()] + ', ' + d.getDate() + ' de ' + MONTHS[d.getMonth()];
  }
  function formatShort(s) {
    var d = parse(s);
    return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()].toLowerCase();
  }
  function formatMonth(key) {
    var p = key.split('-');
    return MONTHS[Number(p[1]) - 1] + ' ' + p[0];
  }
  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* «los martes», no «los martess»: en español solo sábado y domingo hacen plural. */
  function pluralDay(name) {
    var n = String(name).toLowerCase();
    return /s$/.test(n) ? n : n + 's';
  }

  function formatDuration(min) {
    min = Math.max(0, Math.round(min || 0));
    var h = Math.floor(min / 60), m = min % 60;
    if (h && m) return h + 'h ' + m + 'min';
    if (h) return h + 'h';
    return m + 'min';
  }

  /* ------------------------------------------------------------ semanas
     Semana de lunes a domingo. */
  function weekStart(s) {
    var d = parse(s), delta = (d.getDay() + 6) % 7;
    return addDays(s, -delta);
  }
  function weekRange(s) {
    var a = weekStart(s);
    return { start: a, end: addDays(a, 6) };
  }
  function monthRange(key) {
    var p = key.split('-'), y = Number(p[0]), m = Number(p[1]);
    var last = new Date(y, m, 0).getDate();
    return { start: key + '-01', end: key + '-' + (last < 10 ? '0' : '') + last, days: last };
  }

  /* --------------------------------------------------- días programados */
  function isScheduled(date, gymDays) {
    return gymDays.indexOf(dow(date)) >= 0;
  }
  function scheduledBetween(start, end, gymDays) {
    var out = [], cur = start;
    if (daysBetween(start, end) < 0) return out;
    while (daysBetween(cur, end) >= 0) {
      if (isScheduled(cur, gymDays)) out.push(cur);
      cur = addDays(cur, 1);
    }
    return out;
  }

  /* ---------------------------------------------------------- índices */
  function index(workouts) {
    var map = {};
    workouts.forEach(function (w) { map[w.date] = w; });
    return map;
  }
  function done(workouts) {
    return workouts.filter(function (w) { return w.went; });
  }

  /* ------------------------------------------------------------ estado
     de un día concreto: 'done' | 'missed' | 'pending' | 'rest' | 'extra' */
  /* Cuántos días atrás se puede registrar una sesión olvidada. */
  var DEFAULT_WINDOW = 7;
  function win(w) { return (w == null ? DEFAULT_WINDOW : Math.max(0, Math.round(w))); }

  /* Estados de un día:
       done / extra   hay registro y fuiste
       missed         hay registro de que no fuiste, o el día caducó sin registro
       open           día programado ya pasado, sin registro, pero todavía dentro
                      de la ventana: se puede rellenar y aún no cuenta como falta
       pending        hoy o un día futuro
       rest           día normal, o anterior a la fecha de inicio          */
  function dayStatus(date, map, gymDays, ref, start, windowDays) {
    ref = ref || today();
    var w = map[date];
    var sched = isScheduled(date, gymDays);
    if (w && w.went) return sched ? 'done' : 'extra';
    if (w && !w.went) return 'missed';
    // antes de empezar a registrar no hay nada que reprochar
    if (start && daysBetween(date, start) > 0) return 'rest';
    if (!sched) return 'rest';
    var diff = daysBetween(date, ref);      // >0 = pasado, 0 = hoy, <0 = futuro
    if (diff > 0) return diff <= win(windowDays) ? 'open' : 'missed';
    return 'pending';                        // hoy o futuro
  }

  /* ¿Se puede crear o cambiar el registro de este día? */
  function canLog(date, ref, windowDays) {
    ref = ref || today();
    var diff = daysBetween(date, ref);
    if (diff < -1) return false;             // más allá de mañana, no
    return diff <= win(windowDays);
  }

  /* Días programados que siguen abiertos: pasaron, no hay registro y aún
     estás a tiempo de rellenarlos. */
  function openDays(workouts, gymDays, ref, startDate, windowDays) {
    ref = ref || today();
    var eff = effectiveStart(startDate, workouts);
    if (!eff) return [];
    var map = index(workouts);
    var from = addDays(ref, -win(windowDays));
    if (daysBetween(from, eff) > 0) from = eff;
    return scheduledBetween(from, addDays(ref, -1), gymDays)
      .filter(function (d) { return dayStatus(d, map, gymDays, ref, eff, windowDays) === 'open'; });
  }

  /* ------------------------------------------------------------ rachas
     Se cuentan SOLO los días programados. Un lunes sin gimnasio no rompe nada.
     El día de hoy, si todavía no está registrado, no rompe la racha. */
  function firstDate(workouts) {
    if (!workouts.length) return null;
    return workouts.map(function (w) { return w.date; }).sort()[0];
  }

  /* Fecha desde la que la app empieza a contar.
     Es la que el usuario fija en Ajustes, o el primer registro si hay alguno
     anterior (si registras algo del día 5, es que ya llevabas la cuenta).
     Todo lo anterior a esta fecha simplemente no existe para las estadísticas:
     ni suma, ni resta, ni rompe rachas. */
  function effectiveStart(startDate, workouts) {
    var f = firstDate(workouts);
    if (!startDate) return f;
    if (!f) return startDate;
    return f < startDate ? f : startDate;
  }

  function streaks(workouts, gymDays, ref, startDate, windowDays) {
    ref = ref || today();
    var res = { current: 0, best: 0, currentStart: null };
    var first = effectiveStart(startDate, workouts);
    if (!first || !gymDays.length) return res;

    var map = index(workouts);
    var days = scheduledBetween(first, ref, gymDays);

    /* Un día «sin resolver» (hoy sin registrar, o un día reciente todavía
       dentro de la ventana) no suma ni rompe: se salta. */
    var unresolved = function (d) {
      if (map[d]) return false;
      var st = dayStatus(d, map, gymDays, ref, first, windowDays);
      return st === 'pending' || st === 'open';
    };

    var run = 0, runStart = null;
    for (var i = days.length - 1; i >= 0; i--) {
      var d = days[i];
      if (unresolved(d)) continue;
      var w = map[d];
      if (w && w.went) { run++; runStart = d; } else break;
    }
    res.current = run;
    res.currentStart = runStart;

    var best = 0, acc = 0;
    for (var j = 0; j < days.length; j++) {
      var dd = days[j], rec = map[dd];
      if (rec && rec.went) { acc++; if (acc > best) best = acc; }
      else if (unresolved(dd)) { /* sin resolver: no rompe */ }
      else acc = 0;
    }
    res.best = Math.max(best, res.current);
    return res;
  }

  /* -------------------------------------------------------- asistencia
     % = días programados completados / días programados ya transcurridos. */
  function attendance(workouts, gymDays, start, end, ref, startDate, windowDays) {
    ref = ref || today();
    var map = index(workouts);
    var eff = effectiveStart(startDate, workouts);
    var zero = { scheduled: 0, done: 0, missed: 0, open: 0, pct: 0 };
    if (!eff) return zero;
    if (daysBetween(start, eff) > 0) start = eff;        // nada anterior al inicio
    var limit = daysBetween(end, ref) >= 0 ? end : ref;   // no contamos el futuro
    if (daysBetween(start, limit) < 0) return zero;
    var all = scheduledBetween(start, limit, gymDays);

    /* Los días sin resolver —hoy, y los recientes que aún se pueden
       rellenar— salen del denominador: ni suman ni penalizan todavía. */
    var open = 0;
    var sched = all.filter(function (d) {
      if (map[d]) return true;
      var st = dayStatus(d, map, gymDays, ref, eff, windowDays);
      if (st === 'open') { open++; return false; }
      if (st === 'pending') return false;
      return true;
    });

    var doneDays = sched.filter(function (d) { return map[d] && map[d].went; });
    return {
      scheduled: sched.length,
      done: doneDays.length,
      missed: sched.length - doneDays.length,
      open: open,
      pct: sched.length ? Math.round((doneDays.length / sched.length) * 100) : 0
    };
  }

  /* ------------------------------------------------------- agregaciones */
  function summarize(list) {
    var d = done(list);
    var sum = function (key) {
      var vals = d.map(function (w) { return w[key]; }).filter(function (v) { return v != null; });
      return vals.reduce(function (a, b) { return a + b; }, 0);
    };
    var avg = function (key) {
      var vals = d.map(function (w) { return w[key]; }).filter(function (v) { return v != null; });
      return vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null;
    };
    return {
      count: d.length,
      minutes: sum('duration'),
      avgDuration: d.length ? Math.round(sum('duration') / d.length) : 0,
      energy: avg('energy'),
      feeling: avg('feeling'),
      difficulty: avg('difficulty')
    };
  }

  function inRange(workouts, start, end) {
    return workouts.filter(function (w) {
      return daysBetween(start, w.date) >= 0 && daysBetween(w.date, end) >= 0;
    });
  }

  /* Días programados de un tramo, contando solo desde que se empezó a registrar:
     si empiezas un miércoles, el martes de esa semana no entra en el total. */
  function countScheduled(start, end, gymDays, workouts, startDate) {
    var eff = effectiveStart(startDate, workouts);
    if (!eff) return 0;
    var from = daysBetween(start, eff) > 0 ? eff : start;
    if (daysBetween(from, end) < 0) return 0;
    return scheduledBetween(from, end, gymDays).length;
  }

  /* ---------------------------------------------------- resumen semanal */
  function weekSummary(workouts, gymDays, anyDate, ref, startDate, windowDays) {
    var r = weekRange(anyDate || today());
    var list = inRange(workouts, r.start, r.end);
    var att = attendance(workouts, gymDays, r.start, r.end, ref, startDate, windowDays);
    var s = summarize(list);
    return {
      start: r.start, end: r.end,
      scheduledTotal: countScheduled(r.start, r.end, gymDays, workouts, startDate),
      attendance: att,
      count: s.count, minutes: s.minutes,
      energy: s.energy, feeling: s.feeling, difficulty: s.difficulty,
      avgDuration: s.avgDuration
    };
  }

  /* ---------------------------------------------------- resumen mensual */
  function monthSummary(workouts, gymDays, key, ref, startDate, windowDays) {
    var r = monthRange(key);
    var list = inRange(workouts, r.start, r.end);
    var att = attendance(workouts, gymDays, r.start, r.end, ref, startDate, windowDays);
    var s = summarize(list);
    var st = bestStreakInRange(workouts, gymDays, r.start, r.end, ref, startDate, windowDays);
    return {
      key: key, label: capitalize(formatMonth(key)),
      start: r.start, end: r.end,
      scheduledTotal: countScheduled(r.start, r.end, gymDays, workouts, startDate),
      attendance: att,
      count: s.count, minutes: s.minutes, avgDuration: s.avgDuration,
      energy: s.energy, feeling: s.feeling, difficulty: s.difficulty,
      bestStreak: st
    };
  }

  function bestStreakInRange(workouts, gymDays, start, end, ref, startDate, windowDays) {
    ref = ref || today();
    var map = index(workouts);
    var eff = effectiveStart(startDate, workouts);
    if (!eff) return 0;
    if (daysBetween(start, eff) > 0) start = eff;
    var limit = daysBetween(end, ref) >= 0 ? end : ref;
    if (daysBetween(start, limit) < 0) return 0;
    var days = scheduledBetween(start, limit, gymDays);
    var best = 0, acc = 0;
    days.forEach(function (d) {
      var rec = map[d];
      if (rec && rec.went) { acc++; if (acc > best) best = acc; }
      else if (!rec) {
        var st = dayStatus(d, map, gymDays, ref, eff, windowDays);
        if (st !== 'pending' && st !== 'open') acc = 0;
      }
      else acc = 0;
    });
    return best;
  }

  /* ------------------------------------------------- series para gráficos */
  function monthKeysCovering(workouts, count, ref) {
    ref = ref || today();
    var keys = [];
    var d = parse(ref); d.setDate(1);
    for (var i = count - 1; i >= 0; i--) {
      var c = new Date(d.getFullYear(), d.getMonth() - i, 1);
      keys.push(iso(c).slice(0, 7));
    }
    return keys;
  }

  function monthlySeries(workouts, gymDays, months, ref, startDate, windowDays) {
    var first = effectiveStart(startDate, workouts);
    return monthKeysCovering(workouts, months || 6, ref).map(function (k) {
      var r = monthRange(k);
      // un mes anterior al inicio no es un 0%, es "sin datos"
      var before = !first || daysBetween(r.end, first) > 0;
      var m = monthSummary(workouts, gymDays, k, ref, startDate, windowDays);
      return {
        key: k,
        label: MONTHS_SHORT[Number(k.split('-')[1]) - 1],
        fullLabel: capitalize(formatMonth(k)),
        count: before ? null : m.count,
        pct: (before || !m.attendance.scheduled) ? null : m.attendance.pct,
        avgDuration: m.count ? m.avgDuration : null,
        energy: m.energy,
        minutes: before ? null : m.minutes,
        empty: before
      };
    });
  }

  function energySeries(workouts, limit) {
    return done(workouts)
      .filter(function (w) { return w.energy != null; })
      .slice()
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; })
      .slice(-(limit || 30))
      .map(function (w) { return { date: w.date, value: w.energy, label: formatShort(w.date) }; });
  }

  function weightSeries(weights) {
    var byDate = {};
    weights.forEach(function (w) {
      if (w.value == null || isNaN(Number(w.value))) return;
      // una medición manual tiene prioridad sobre la del entrenamiento
      if (!byDate[w.date] || w.src === 'manual') byDate[w.date] = w;
    });
    return Object.keys(byDate).sort().map(function (d) {
      return { date: d, value: Number(byDate[d].value), label: formatShort(d), src: byDate[d].src, id: byDate[d].id };
    });
  }

  /* -------------------------------------------------- medidas corporales
     Bíceps, gemelos y muslo tienen lado izquierdo/derecho por separado
     (para notar asimetrías); pecho y cintura son un solo valor. Todo en cm,
     todo opcional: un registro puede traer solo una medida y dejar el resto
     en blanco. */
  var MEASURE_FIELDS = [
    { key: 'biceps', label: 'Bíceps', paired: true },
    { key: 'gemelo', label: 'Gemelos', paired: true },
    { key: 'muslo', label: 'Muslo', paired: true },
    { key: 'pecho', label: 'Pecho', paired: false },
    { key: 'cintura', label: 'Cintura', paired: false }
  ];

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  /* Valor representativo de una medida en un registro: el promedio de
     izquierdo/derecho si es una medida con lado, o el valor único si no.
     Sirve para dibujar UNA línea de evolución aunque el dato tenga dos lados. */
  function measureValue(m, field) {
    if (!field) return null;
    if (!field.paired) return num(m[field.key]);
    var l = num(m[field.key + 'Izq']), r = num(m[field.key + 'Der']);
    if (l == null && r == null) return null;
    if (l == null) return r;
    if (r == null) return l;
    return Math.round((l + r) / 2 * 10) / 10;
  }

  function measureField(key) {
    for (var i = 0; i < MEASURE_FIELDS.length; i++) if (MEASURE_FIELDS[i].key === key) return MEASURE_FIELDS[i];
    return MEASURE_FIELDS[0];
  }

  function measureSeries(measurements, fieldKey) {
    var field = measureField(fieldKey);
    var rows = (measurements || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var out = [];
    rows.forEach(function (m) {
      var v = measureValue(m, field);
      if (v == null) return;
      out.push({ date: m.date, value: v, label: formatShort(m.date), id: m.id });
    });
    return out;
  }

  /* --------------------------------------------------------- globales */
  function overall(workouts, gymDays, ref, startDate, windowDays) {
    ref = ref || today();
    var d = done(workouts);
    var first = effectiveStart(startDate, workouts);
    var s = summarize(workouts);
    var att = first ? attendance(workouts, gymDays, first, ref, ref, startDate, windowDays)
      : { scheduled: 0, done: 0, missed: 0, open: 0, pct: 0 };
    var months = {};
    d.forEach(function (w) { months[monthKey(w.date)] = (months[monthKey(w.date)] || 0) + 1; });
    var monthCount = Object.keys(months).length;
    return {
      total: d.length,
      firstDate: first,
      minutes: s.minutes,
      avgDuration: s.avgDuration,
      energy: s.energy, feeling: s.feeling, difficulty: s.difficulty,
      attendance: att,
      monthlyAverage: monthCount ? Math.round((d.length / monthCount) * 10) / 10 : 0,
      thisYear: d.filter(function (w) { return w.date.slice(0, 4) === ref.slice(0, 4); }).length,
      thisMonth: d.filter(function (w) { return monthKey(w.date) === monthKey(ref); }).length
    };
  }


  /* ==================================================================
     ANÁLISIS — lo que hace que los datos digan algo
     ================================================================== */

  /* Semanas perfectas: semanas en las que no faltaste a ningún día
     programado. Para quien entrena 3 días fijos, esto mide la constancia
     mucho mejor que una racha de días sueltos. */
  function perfectWeeks(workouts, gymDays, ref, startDate, windowDays) {
    ref = ref || today();
    var first = effectiveStart(startDate, workouts);
    var res = { current: 0, best: 0, total: 0 };
    if (!first || !gymDays.length) return res;

    var cur = weekStart(first);
    var thisWeek = weekStart(ref);
    var run = 0, guard = 0;
    while (daysBetween(cur, thisWeek) >= 0 && guard++ < 800) {
      var ws = weekSummary(workouts, gymDays, cur, ref, startDate, windowDays);
      var complete = ws.attendance.scheduled > 0 && !ws.attendance.open &&
        ws.attendance.scheduled === ws.scheduledTotal;    // la semana ya terminó
      var perfect = complete && ws.attendance.pct === 100;
      if (perfect) {
        run++; res.total++;
        if (run > res.best) res.best = run;
      } else if (cur === thisWeek && ws.attendance.missed === 0) {
        /* la semana en curso todavía no se ha estropeado: no rompe nada */
      } else {
        run = 0;
      }
      cur = addDays(cur, 7);
    }
    res.current = run;
    return res;
  }

  /* Asistencia repartida por día de la semana: dónde fallas de verdad. */
  function byWeekday(workouts, gymDays, ref, startDate, windowDays) {
    ref = ref || today();
    var first = effectiveStart(startDate, workouts);
    if (!first) return [];
    var map = index(workouts);
    var acc = {};
    gymDays.forEach(function (d) { acc[d] = { dow: d, name: DAY_NAMES[d], scheduled: 0, done: 0 }; });

    scheduledBetween(first, ref, gymDays).forEach(function (date) {
      var w = map[date];
      if (!w) {
        var st = dayStatus(date, map, gymDays, ref, first, windowDays);
        if (st === 'pending' || st === 'open') return;  // sin resolver: no cuenta
      }
      var a = acc[dow(date)];
      if (!a) return;
      a.scheduled++;
      if (w && w.went) a.done++;
    });

    return Object.keys(acc).map(function (k) { return acc[k]; })
      .filter(function (a) { return a.scheduled > 0; })
      .map(function (a) {
        a.pct = Math.round((a.done / a.scheduled) * 100);
        a.missed = a.scheduled - a.done;
        return a;
      });
  }

  /* Asistencia de las últimas N semanas cerradas: más honesto que el mes
     natural, que empieza y acaba donde le da la gana. */
  function rollingWeeks(workouts, gymDays, weeks, ref, startDate, windowDays) {
    ref = ref || today();
    var out = [];
    for (var i = weeks - 1; i >= 0; i--) {
      var anchor = addDays(weekStart(ref), -7 * i);
      var ws = weekSummary(workouts, gymDays, anchor, ref, startDate, windowDays);
      out.push({
        start: ws.start,
        label: String(parse(ws.start).getDate()) + ' ' + MONTHS_SHORT[parse(ws.start).getMonth()].toLowerCase(),
        fullLabel: 'Semana del ' + formatShort(ws.start),
        count: ws.count,
        pct: ws.attendance.scheduled ? ws.attendance.pct : null,
        minutes: ws.minutes
      });
    }
    return out;
  }

  /* Cuadrícula del año: un cuadrito por día, en columnas de lunes a domingo. */
  function heatmap(workouts, gymDays, weeks, ref, startDate, windowDays) {
    ref = ref || today();
    var eff = effectiveStart(startDate, workouts);
    var map = index(workouts);
    var end = addDays(weekStart(ref), 6);
    var start = addDays(weekStart(ref), -7 * (weeks - 1));
    var cells = [], cur = start;
    while (daysBetween(cur, end) >= 0) {
      var future = daysBetween(ref, cur) > 0;
      cells.push({
        date: cur,
        status: future && !map[cur] ? 'future' : dayStatus(cur, map, gymDays, ref, eff, windowDays),
        month: Number(cur.slice(5, 7)) - 1,
        outside: !!(eff && daysBetween(cur, eff) > 0)
      });
      cur = addDays(cur, 1);
    }
    return cells;
  }

  /* Marcas personales. Nada de pesos: constancia. */
  function records(workouts, gymDays, ref, startDate, windowDays) {
    ref = ref || today();
    var d = done(workouts);
    var st = streaks(workouts, gymDays, ref, startDate, windowDays);
    var pw = perfectWeeks(workouts, gymDays, ref, startDate, windowDays);

    var longest = null;
    d.forEach(function (w) { if (!longest || w.duration > longest.duration) longest = w; });

    var months = {};
    d.forEach(function (w) {
      var k = monthKey(w.date);
      months[k] = (months[k] || 0) + 1;
    });
    var bestMonth = null;
    Object.keys(months).forEach(function (k) {
      if (!bestMonth || months[k] > bestMonth.count) bestMonth = { key: k, count: months[k] };
    });

    var weeksAcc = {};
    d.forEach(function (w) {
      var k = weekStart(w.date);
      weeksAcc[k] = (weeksAcc[k] || 0) + (w.duration || 0);
    });
    var bestWeek = null;
    Object.keys(weeksAcc).forEach(function (k) {
      if (!bestWeek || weeksAcc[k] > bestWeek.minutes) bestWeek = { start: k, minutes: weeksAcc[k] };
    });

    return {
      bestStreak: st.best,
      currentStreak: st.current,
      perfectWeeks: pw.best,
      perfectWeeksTotal: pw.total,
      bestMonth: bestMonth,
      longestSession: longest,
      bestWeek: bestWeek,
      totalMinutes: d.reduce(function (a, w) { return a + (w.duration || 0); }, 0)
    };
  }

  /* Conclusiones automáticas. Sin IA: son medias y comparaciones. */
  function insights(workouts, gymDays, ref, startDate, units, windowDays) {
    ref = ref || today();
    units = units || 'kg';
    var d = done(workouts);
    var out = [];
    if (d.length < 4) return out;

    /* 1. el día flojo */
    var wd = byWeekday(workouts, gymDays, ref, startDate, windowDays)
      .filter(function (a) { return a.scheduled >= 3; });
    if (wd.length >= 2) {
      var worst = wd.slice().sort(function (a, b) { return a.pct - b.pct; })[0];
      var best = wd.slice().sort(function (a, b) { return b.pct - a.pct; })[0];
      if (worst.pct < best.pct) {
        out.push('Tu día flojo es el <b>' + worst.name.toLowerCase() + '</b>: vas el <b>' +
          worst.pct + '%</b> de las veces, frente al <b>' + best.pct + '%</b> de los ' +
          pluralDay(best.name) + '.');
      } else if (best.pct === 100) {
        out.push('No has fallado ni un solo día programado. Los <b>' +
          wd.map(function (a) { return pluralDay(a.name); }).join(', ') + '</b> van al <b>100%</b>.');
      }
    }

    /* 2. duración contra sensación */
    var withBoth = d.filter(function (w) { return w.duration > 0 && w.feeling != null; });
    if (withBoth.length >= 8) {
      var durs = withBoth.map(function (w) { return w.duration; }).sort(function (a, b) { return a - b; });
      var median = durs[Math.floor(durs.length / 2)];
      var longSet = withBoth.filter(function (w) { return w.duration > median; });
      var shortSet = withBoth.filter(function (w) { return w.duration <= median; });
      if (longSet.length >= 3 && shortSet.length >= 3) {
        var avg = function (list, k) {
          return list.reduce(function (a, w) { return a + w[k]; }, 0) / list.length;
        };
        var fl = avg(longSet, 'feeling'), fs = avg(shortSet, 'feeling');
        if (Math.abs(fl - fs) >= 0.4) {
          var better = fl > fs ? 'largas' : 'cortas';
          out.push('Sales mejor de las sesiones <b>' + better + '</b>: por encima de ' +
            formatDuration(median) + ' tu sensación media es <b>' + (Math.round(fl * 10) / 10).toString().replace('.', ',') +
            '</b>, por debajo <b>' + (Math.round(fs * 10) / 10).toString().replace('.', ',') + '</b>.');
        }
      }
    }

    /* 3. energía subiendo o bajando */
    var eList = d.filter(function (w) { return w.energy != null; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (eList.length >= 10) {
      var half = Math.floor(eList.length / 2);
      var mean = function (list) {
        return list.reduce(function (a, w) { return a + w.energy; }, 0) / list.length;
      };
      var older = mean(eList.slice(0, half)), recent = mean(eList.slice(half));
      var delta = recent - older;
      if (Math.abs(delta) >= 0.35) {
        out.push('Tu energía va <b>' + (delta > 0 ? 'a más' : 'a menos') + '</b>: de ' +
          (Math.round(older * 10) / 10).toString().replace('.', ',') + ' en la primera mitad de tus registros a <b>' +
          (Math.round(recent * 10) / 10).toString().replace('.', ',') + '</b> en la última.');
      }
    }

    /* 4. constancia por semanas */
    var pw = perfectWeeks(workouts, gymDays, ref, startDate, windowDays);
    if (pw.total >= 1) {
      out.push('Llevas <b>' + pw.total + '</b> ' + (pw.total === 1 ? 'semana completa' : 'semanas completas') +
        ', y tu mejor racha son <b>' + pw.best + '</b> seguidas.');
    }

    /* 5. duración típica */
    if (d.length >= 6) {
      var ds = d.map(function (w) { return w.duration; }).filter(Boolean).sort(function (a, b) { return a - b; });
      if (ds.length >= 6) {
        out.push('Tu sesión típica dura <b>' + formatDuration(ds[Math.floor(ds.length / 2)]) +
          '</b>; la más larga fue de <b>' + formatDuration(ds[ds.length - 1]) + '</b>.');
      }
    }

    return out;
  }

  /* Duración típica, para rellenar el formulario sin que tengas que pensar. */
  function typicalWorkout(workouts) {
    var d = done(workouts).slice().sort(function (a, b) { return a.date > b.date ? -1 : 1; }).slice(0, 12);
    if (!d.length) return { duration: 60, energy: 4, feeling: 4, difficulty: 3 };
    var med = function (key, fallback) {
      var v = d.map(function (w) { return w[key]; }).filter(function (x) { return x != null; })
        .sort(function (a, b) { return a - b; });
      return v.length ? v[Math.floor(v.length / 2)] : fallback;
    };
    return {
      duration: Math.max(5, Math.round(med('duration', 60) / 5) * 5),
      energy: med('energy', 4),
      feeling: med('feeling', 4),
      difficulty: med('difficulty', 3)
    };
  }

  /* ------------------------------------------------- próximo entrenamiento */
  function nextGymDay(gymDays, ref) {
    ref = ref || today();
    if (!gymDays.length) return null;
    for (var i = 0; i <= 14; i++) {
      var d = addDays(ref, i);
      if (isScheduled(d, gymDays)) return d;
    }
    return null;
  }

  /* --------------------------------------------------------- calendario */
  function calendarGrid(monthKeyStr, workouts, gymDays, ref, startDate, windowDays) {
    ref = ref || today();
    var map = index(workouts);
    var eff = effectiveStart(startDate, workouts);
    var r = monthRange(monthKeyStr);
    var firstDow = (dow(r.start) + 6) % 7;   // 0 = lunes
    var cells = [];
    for (var i = 0; i < firstDow; i++) cells.push(null);
    for (var day = 1; day <= r.days; day++) {
      var date = monthKeyStr + '-' + (day < 10 ? '0' : '') + day;
      cells.push({
        date: date,
        day: day,
        status: dayStatus(date, map, gymDays, ref, eff, windowDays),
        canLog: canLog(date, ref, windowDays),
        scheduled: isScheduled(date, gymDays),
        beforeStart: !!(eff && daysBetween(date, eff) > 0),
        isToday: date === ref,
        future: daysBetween(ref, date) > 0,
        workout: map[date] || null
      });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }

  return {
    DAY_NAMES: DAY_NAMES, DAY_SHORT: DAY_SHORT, MONTHS: MONTHS, MONTHS_SHORT: MONTHS_SHORT,
    iso: iso, parse: parse, today: today, addDays: addDays, dow: dow,
    monthKey: monthKey, daysBetween: daysBetween,
    formatLong: formatLong, formatShort: formatShort, formatMonth: formatMonth,
    formatDuration: formatDuration, capitalize: capitalize, pluralDay: pluralDay,
    weekStart: weekStart, weekRange: weekRange, monthRange: monthRange,
    isScheduled: isScheduled, scheduledBetween: scheduledBetween, countScheduled: countScheduled,
    index: index, done: done, dayStatus: dayStatus, effectiveStart: effectiveStart,
    canLog: canLog, openDays: openDays, DEFAULT_WINDOW: DEFAULT_WINDOW,
    streaks: streaks, attendance: attendance, summarize: summarize, inRange: inRange,
    weekSummary: weekSummary, monthSummary: monthSummary, bestStreakInRange: bestStreakInRange,
    monthKeysCovering: monthKeysCovering, monthlySeries: monthlySeries,
    energySeries: energySeries, weightSeries: weightSeries,
    MEASURE_FIELDS: MEASURE_FIELDS, measureValue: measureValue, measureField: measureField, measureSeries: measureSeries,
    overall: overall, nextGymDay: nextGymDay, calendarGrid: calendarGrid,
    firstDate: firstDate,
    perfectWeeks: perfectWeeks, byWeekday: byWeekday, rollingWeeks: rollingWeeks,
    heatmap: heatmap, records: records, insights: insights, typicalWorkout: typicalWorkout
  };
});
