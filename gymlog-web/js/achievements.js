/* =========================================================================
   achievements.js — Logros. Se evalúan siempre contra los datos reales;
   nada se "regala". El registro guarda la fecha del desbloqueo.
   ========================================================================= */
(function (root, factory) {
  var mod = factory(typeof require === 'function' ? require('./stats.js') : (root.GL && root.GL.stats));
  if (typeof module === 'object' && module.exports) module.exports = mod;
  root.GL = root.GL || {};
  root.GL.achievements = mod;
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';

  function completedMonths(workouts, gymDays, ref, startDate, win) {
    var keys = {};
    workouts.forEach(function (w) { if (w.went) keys[S.monthKey(w.date)] = true; });
    return Object.keys(keys).sort().map(function (k) {
      return S.monthSummary(workouts, gymDays, k, ref, startDate, win);
    });
  }

  function consecutivePerfectWeeks(workouts, gymDays, ref, startDate, win) {
    ref = ref || S.today();
    var first = S.effectiveStart(startDate, workouts);
    if (!first) return 0;
    var cur = S.weekStart(first), best = 0, run = 0;
    var guard = 0;
    while (S.daysBetween(cur, ref) >= 0 && guard++ < 600) {
      var ws = S.weekSummary(workouts, gymDays, cur, ref, startDate, win);
      var perfect = ws.attendance.scheduled > 0 && ws.attendance.pct === 100 &&
        !ws.attendance.open && ws.attendance.scheduled === ws.scheduledTotal;
      if (perfect) { run++; if (run > best) best = run; } else { run = 0; }
      cur = S.addDays(cur, 7);
    }
    return best;
  }

  var LIST = [
    { id: 'first', icon: 'barbell', title: 'Primera sesión', desc: 'Registraste tu primer entrenamiento.', goal: 1, metric: 'total' },
    { id: 't5', icon: 'flame', title: '5 sesiones', desc: 'Cinco entrenamientos registrados.', goal: 5, metric: 'total' },
    { id: 't10', icon: 'flame', title: '10 sesiones', desc: 'Diez entrenamientos registrados.', goal: 10, metric: 'total' },
    { id: 't25', icon: 'flame', title: '25 sesiones', desc: 'Veinticinco entrenamientos registrados.', goal: 25, metric: 'total' },
    { id: 't50', icon: 'medal', title: '50 sesiones', desc: 'Cincuenta entrenamientos registrados.', goal: 50, metric: 'total' },
    { id: 't100', icon: 'trophy', title: '100 sesiones', desc: 'Cien entrenamientos registrados.', goal: 100, metric: 'total' },
    { id: 't250', icon: 'crown', title: '250 sesiones', desc: 'Doscientas cincuenta. Esto ya es un hábito.', goal: 250, metric: 'total' },

    { id: 'streak10', icon: 'bolt', title: 'Racha de 10', desc: 'Diez días programados seguidos sin fallar.', goal: 10, metric: 'bestStreak' },
    { id: 'streak25', icon: 'bolt', title: 'Racha de 25', desc: 'Veinticinco días programados seguidos.', goal: 25, metric: 'bestStreak' },

    { id: 'week4', icon: 'week', title: '4 semanas', desc: 'Cuatro semanas seguidas sin faltar a nada.', goal: 4, metric: 'perfectWeeks' },
    { id: 'week12', icon: 'week', title: '12 semanas', desc: 'Doce semanas seguidas al 100%.', goal: 12, metric: 'perfectWeeks' },
    { id: 'perfectMonth', icon: 'calendarCheck', title: 'Mes perfecto', desc: 'Un mes entero sin faltar ni un día programado.', goal: 1, metric: 'perfectMonths' },
    { id: 'record', icon: 'chartUp', title: 'Récord mensual', desc: 'Superaste tu mejor mes de asistencia.', goal: 1, metric: 'records' },

    { id: 'hours10', icon: 'clock', title: '10 horas', desc: 'Diez horas acumuladas bajo la barra.', goal: 10, metric: 'hours' },
    { id: 'hours25', icon: 'clock', title: '25 horas', desc: 'Veinticinco horas acumuladas.', goal: 25, metric: 'hours' },
    { id: 'hours50', icon: 'clock', title: '50 horas', desc: 'Cincuenta horas acumuladas.', goal: 50, metric: 'hours' },
    { id: 'hours100', icon: 'clock', title: '100 horas', desc: 'Cien horas acumuladas.', goal: 100, metric: 'hours' },

    { id: 'notes10', icon: 'pen', title: '10 notas', desc: 'Diez entrenamientos con notas escritas.', goal: 10, metric: 'notes' },
    { id: 'weight10', icon: 'scale', title: '10 pesajes', desc: 'Diez mediciones de peso corporal.', goal: 10, metric: 'weights' },
    { id: 'measure1', icon: 'ruler', title: 'Primeras medidas', desc: 'Registraste tus primeras medidas corporales.', goal: 1, metric: 'measurements' },
    { id: 'measure10', icon: 'ruler', title: '10 medidas', desc: 'Diez registros de medidas corporales.', goal: 10, metric: 'measurements' },
    { id: 'goalHit', icon: 'target', title: 'Objetivo cumplido', desc: 'Alcanzaste tu objetivo mensual.', goal: 1, metric: 'goalsHit' }
  ];

  function metrics(workouts, gymDays, ref, startDate, extra) {
    extra = extra || {};
    ref = ref || S.today();
    var d = S.done(workouts);
    var months = completedMonths(workouts, gymDays, ref, startDate, extra.win);
    var perfect = months.filter(function (m) {
      return m.attendance.scheduled > 0 && m.attendance.pct === 100 &&
        m.attendance.scheduled === m.scheduledTotal;
    });
    // récord: existe un mes cerrado cuya asistencia superó a todos los anteriores
    var records = 0, high = -1;
    months.forEach(function (m, i) {
      if (m.attendance.scheduled === 0) return;
      if (i > 0 && m.attendance.pct > high) records++;
      if (m.attendance.pct > high) high = m.attendance.pct;
    });
    return {
      total: d.length,
      perfectMonths: perfect.length,
      perfectWeeks: consecutivePerfectWeeks(workouts, gymDays, ref, startDate, extra.win),
      records: records,
      bestStreak: S.streaks(workouts, gymDays, ref, startDate, extra.win).best,
      hours: Math.floor(d.reduce(function (a, w) { return a + (w.duration || 0); }, 0) / 60),
      notes: d.filter(function (w) { return w.notes && w.notes.trim(); }).length,
      weights: extra.weights || 0,
      measurements: extra.measurements || 0,
      goalsHit: extra.goal
        ? months.filter(function (m) { return m.count >= extra.goal; }).length
        : 0
    };
  }

  /* Devuelve la lista con progreso y cuáles se acaban de desbloquear. */
  function evaluate(workouts, gymDays, unlockedMap, ref, startDate, extra) {
    ref = ref || S.today();
    var m = metrics(workouts, gymDays, ref, startDate, extra);
    var unlocked = Object.assign({}, unlockedMap || {});
    var fresh = [];
    var items = LIST.map(function (a) {
      var value = m[a.metric] || 0;
      var has = value >= a.goal;
      if (has && !unlocked[a.id]) { unlocked[a.id] = ref; fresh.push(a); }
      return {
        id: a.id, icon: a.icon, title: a.title, desc: a.desc,
        goal: a.goal, value: Math.min(value, a.goal), raw: value,
        unlocked: has, date: unlocked[a.id] || null,
        progress: Math.min(1, a.goal ? value / a.goal : 0)
      };
    });
    // si los datos desaparecen (borrado), el logro se retira
    Object.keys(unlocked).forEach(function (id) {
      var it = items.find(function (x) { return x.id === id; });
      if (!it || !it.unlocked) delete unlocked[id];
    });
    return { items: items, unlocked: unlocked, fresh: fresh, metrics: m };
  }

  return { LIST: LIST, evaluate: evaluate, metrics: metrics, consecutivePerfectWeeks: consecutivePerfectWeeks };
});
