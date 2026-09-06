/* =========================================================================
   demo.js — Genera datos de demostración de los últimos ~3 meses.
   Todos los registros llevan demo:true y se pueden borrar de una sola vez.
   ========================================================================= */
(function (root, factory) {
  var mod = factory(typeof require === 'function' ? require('./stats.js') : (root.GL && root.GL.stats));
  if (typeof module === 'object' && module.exports) module.exports = mod;
  root.GL = root.GL || {};
  root.GL.demo = mod;
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';

  // generador pseudoaleatorio con semilla: los datos de ejemplo son estables
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  var NOTES = [
    'Buena sesión, subí algo de peso en el press.',
    'Me costó arrancar pero terminé con energía.',
    'Dormí poco, entrené más corto de lo normal.',
    'Muy buena sensación hoy, todo fluido.',
    'Gimnasio lleno, tuve que cambiar el orden.',
    'Piernas destrozadas, pero salió completo.',
    'Sesión tranquila, enfocado en técnica.',
    'El entrenador cambió la rutina, me gustó.',
    'Con agujetas del día anterior.',
    'Terminé con cardio 15 min.',
    ''
  ];

  function generate(gymDays, monthsBack, ref) {
    ref = ref || S.today();
    gymDays = (gymDays && gymDays.length) ? gymDays : [2, 3, 5];
    monthsBack = monthsBack || 3;

    var end = S.addDays(ref, -1);                 // nunca inventamos el día de hoy
    var startD = S.parse(ref);
    startD.setMonth(startD.getMonth() - monthsBack);
    startD.setDate(1);
    var start = S.iso(startD);

    var days = S.scheduledBetween(start, end, gymDays);
    var rand = rng(20260826);
    var workouts = [];
    var weight = 74.8;

    days.forEach(function (date, i) {
      // los últimos días siempre cuentan: así la demo enseña una racha viva
      var went = (i >= days.length - 8) ? true : rand() > 0.13;   // ~87% de asistencia
      var rec = {
        id: 'demo-' + date,
        date: date,
        went: went,
        duration: 0, energy: null, feeling: null, difficulty: null,
        weight: null, notes: '', demo: true,
        createdAt: date + 'T20:00:00.000Z',
        updatedAt: date + 'T20:00:00.000Z'
      };
      if (went) {
        rec.duration = 55 + Math.round(rand() * 40);
        rec.energy = 3 + Math.round(rand() * 2);
        rec.feeling = 3 + Math.round(rand() * 2);
        rec.difficulty = 2 + Math.round(rand() * 3);
        rec.notes = rand() > 0.55 ? NOTES[Math.floor(rand() * NOTES.length)] : '';
        weight += (rand() - 0.42) * 0.35;         // tendencia muy suave
        if (i % 3 === 0) rec.weight = Math.round(weight * 10) / 10;
      } else {
        rec.notes = rand() > 0.6 ? 'No pude ir, día complicado.' : '';
      }
      workouts.push(rec);
    });

    var weights = workouts.filter(function (w) { return w.weight != null; })
      .map(function (w) {
        return { id: 'wk-' + w.date, date: w.date, value: w.weight, src: 'workout', demo: true };
      });

    return { workouts: workouts, weights: weights };
  }

  return { generate: generate };
});
