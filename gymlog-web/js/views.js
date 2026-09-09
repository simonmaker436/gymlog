/* =========================================================================
   views.js — Las pantallas. Cada vista devuelve HTML y, si hace falta, una
   función mount() que engancha los gráficos. Todo sale de los datos reales.
   Ni un emoji: los símbolos son iconos SVG de trazo recto (js/ui.js).
   ========================================================================= */
(function (GL) {
  'use strict';

  var S = GL.stats, U = GL.ui;
  var esc = U.esc, icon = U.icon, mark = U.mark, meter = U.meter;

  /* ---------------------------------------------------------- formatos */
  var NONE = '<span class="none">sin datos</span>';

  /* El tipo de entreno es opcional: sin etiqueta se dice, no se inventa. */
  /* «De noche · 21:30». La hora solo se muestra si la escribió la persona;
     si no, la etiqueta sola ya dice lo que hay que saber. */
  function lightText(w) {
    var l = GL.store.lightLabel(w.light);
    if (!l) return null;
    return w.time ? l + ' · ' + w.time : l;
  }

  /* Recibe la sesión entera, no una clave: la etiqueta puede venir de la
     selección nueva por músculos o de la etiqueta vieja de una sola opción. */
  function typeValue(w) {
    var label = GL.store.focusLabel(w);
    return label
      ? '<span class="typeval">' + esc(label) + '</span>'
      : '<span class="none">sin marcar</span>';
  }

  function fmtWeight(v, units) {
    if (v == null) return '—';
    return (Math.round(v * 10) / 10).toLocaleString('es-ES') + ' ' + units;
  }
  function fmtCm(v) {
    if (v == null) return '—';
    return (Math.round(v * 10) / 10).toLocaleString('es-ES') + ' cm';
  }
  function fmtAvg(v) { return v == null ? NONE : (Math.round(v * 10) / 10).toString().replace('.', ',') + '<small>/5</small>'; }
  function fmtPct(v) { return v == null ? NONE : v + '<small>%</small>'; }
  function dec(v) { return String(Math.round(v * 10) / 10).replace('.', ','); }

  function tile(k, v, f, cls) {
    return '<div class="tile ' + (cls || '') + '">' +
      '<span class="k">' + esc(k) + '</span>' +
      '<div class="v">' + v + '</div>' +
      (f ? '<div class="f">' + f + '</div>' : '') +
      '</div>';
  }

  /* --------------------------------------------- recordatorio del día
     Aviso dentro de la app, no notificación del sistema. Aparece solo si hoy
     toca gimnasio, todavía no registraste nada y ya pasó la hora fijada en
     Ajustes: recordarlo a las 8 de la mañana no sirve de nada. */
  function reminderBanner(ctx) {
    var s = ctx.settings;
    if (!s.reminders) return '';
    if (!S.isScheduled(ctx.today, s.gymDays)) return '';
    if (ctx.byDate[ctx.today]) return '';               // ya hay registro de hoy
    if (ctx.hour < s.reminderHour) return '';

    return '<div class="card remind">' +
      '<span class="remind-ic">' + icon('alert') + '</span>' +
      '<div class="remind-t">' +
      '<b>Hoy toca gimnasio</b>' +
      '<small>Son las ' + String(ctx.hour).padStart(2, '0') + ':00 y todavía no registraste nada.</small>' +
      '</div>' +
      '<button class="btn sm primary" data-act="log" data-date="' + ctx.today + '">Registrar</button>' +
      '</div>';
  }

  /* ------------------------------------------------- entrenador con IA
     Con pocas sesiones no hay patrón que leer, así que la tarjeta ni aparece
     (y el cliente tampoco llama a la función: no se gasta cuota en balde). */
  function coachCard(ctx) {
    var done = S.done(ctx.workouts).length;
    if (!ctx.cloud || done < ctx.coachMin) return '';

    var st = ctx.coachState || {};
    var c = ctx.coach;
    var cuerpo;

    if (st.loading) {
      cuerpo = '<p class="coach-wait">Mirando tus últimas sesiones…</p>';
    } else if (st.error) {
      cuerpo = '<p class="coach-err">' + esc(st.error) + '</p>';
    } else if (c && (c.recomendacion || c.consejo)) {
      cuerpo =
        (c.recomendacion ? '<p class="coach-main">' + esc(c.recomendacion) + '</p>' : '') +
        (c.consejo ? '<p class="coach-tip">' + esc(c.consejo) + '</p>' : '');
    } else {
      cuerpo = '<p class="coach-wait">Todavía sin recomendación de hoy.</p>';
    }

    var cuando = c && c.date === ctx.today ? 'Hoy'
      : c && c.date ? esc(S.formatShort(c.date)) : '';

    return '<div class="card coach">' +
      '<div class="coach-head">' +
      '<span class="eyebrow">Entrenador' + (cuando ? ' · ' + cuando : '') + '</span>' +
      '<span class="spacer"></span>' +
      '<button class="btn sm subtle" data-act="coach-refresh"' + (st.loading ? ' disabled' : '') + '>' +
      icon('replay') + (st.loading ? 'Pensando…' : 'Actualizar') + '</button>' +
      '</div>' + cuerpo + '</div>';
  }

  /* Barra de la meta semanal. Pasada la meta sigue creciendo hasta el borde,
     pero en verde: cumplida es cumplida, lo de más es de más. */
  function weeklyGoalBar(count, target) {
    var pct = target > 0 ? Math.min(100, Math.round((count / target) * 100)) : 0;
    var hit = count >= target;
    var left = Math.max(0, target - count);
    return '<div class="wgoal' + (hit ? ' is-hit' : '') + '">' +
      '<div class="wgoal-top">' +
      '<span class="eyebrow">Meta semanal</span>' +
      '<span class="wgoal-n"><b>' + count + '</b> / ' + target + '</span>' +
      '</div>' +
      '<span class="wgoal-track"><span class="wgoal-fill" style="width:' + pct + '%"></span></span>' +
      '<div class="wgoal-foot">' + (hit
        ? (count > target ? 'Meta cumplida, y ' + (count - target) + ' de propina.' : 'Meta cumplida.')
        : 'Te ' + (left === 1 ? 'queda 1 sesión' : 'quedan ' + left + ' sesiones') + ' esta semana.') +
      '</div></div>';
  }

  function sectionTitle(t, right) {
    return '<div class="section-title"><h2>' + esc(t) + '</h2><span class="spacer"></span>' +
      (right || '') + '</div>';
  }

  /* Días que quedan para poder rellenar una fecha pasada. */
  function daysLeft(date, ctx) {
    return Math.max(0, ctx.win - S.daysBetween(date, ctx.today) + 1);
  }

  function statusPill(status) {
    switch (status) {
      case 'done': return '<span class="pill good">' + icon('checkCircle') + 'Completado</span>';
      case 'extra': return '<span class="pill good">' + icon('checkCircle') + 'Extra</span>';
      case 'missed': return '<span class="pill miss">' + icon('crossCircle') + 'No fui</span>';
      case 'pending': return '<span class="pill warn">' + icon('dotCircle') + 'Pendiente</span>';
      case 'open': return '<span class="pill warn">' + icon('clock') + 'Sin cerrar</span>';
      default: return '<span class="pill">' + icon('minus') + 'Día normal</span>';
    }
  }

  function callout(kind, ico, title, text, action) {
    return '<div class="callout' + (kind ? ' ' + kind : '') + '">' + icon(ico) +
      '<div style="flex:1;min-width:0"><h3>' + esc(title) + '</h3><p>' + text + '</p>' +
      (action ? '<div style="margin-top:12px">' + action + '</div>' : '') +
      '</div></div>';
  }

  /* ---------------------------------------------------- ritmo de la semana */
  function weekDots(ctx, anchorDate) {
    var r = S.weekRange(anchorDate || ctx.today);
    var map = S.index(ctx.workouts);
    var out = '<div class="weekdots">';
    for (var i = 0; i < 7; i++) {
      var d = S.addDays(r.start, i);
      var st = S.dayStatus(d, map, ctx.settings.gymDays, ctx.today, ctx.eff, ctx.win);
      var cls = st === 'done' ? 'done' : st === 'extra' ? 'extra'
        : st === 'missed' ? 'missed' : st === 'open' ? 'open' : st === 'pending' ? 'pending' : '';
      var glyph = (st === 'done' || st === 'extra') ? icon('check')
        : st === 'missed' ? icon('close')
          : String(S.parse(d).getDate());
      out += '<div class="weekdot' + (d === ctx.today ? ' is-today' : '') + '">' +
        '<span class="lbl">' + S.DAY_SHORT[S.dow(d)] + '</span>' +
        '<span class="pip ' + cls + '" title="' + esc(S.formatLong(d)) + '">' + glyph + '</span>' +
        '</div>';
    }
    return out + '</div>';
  }

  /* ================================================================ INICIO */
  function home(ctx) {
    var g = ctx.settings.gymDays;
    var st = S.streaks(ctx.workouts, g, ctx.today, ctx.start, ctx.win);
    var mk = S.monthKey(ctx.today);
    var month = S.monthSummary(ctx.workouts, g, mk, ctx.today, ctx.start, ctx.win);
    var week = S.weekSummary(ctx.workouts, g, ctx.today, ctx.today, ctx.start, ctx.win);
    var prevWeek = S.weekSummary(ctx.workouts, g, S.addDays(ctx.today, -7), ctx.today, ctx.start, ctx.win);
    var weekOver = S.daysBetween(ctx.today, S.weekRange(ctx.today).end) === 0;
    var prevSoFar = weekOver ? prevWeek.count
      : S.done(S.inRange(ctx.workouts, S.addDays(S.weekStart(ctx.today), -7), S.addDays(ctx.today, -7))).length;

    var todayRec = ctx.byDate[ctx.today];
    var isGymDay = S.isScheduled(ctx.today, g);
    var next = S.nextGymDay(g, (todayRec || !isGymDay) ? S.addDays(ctx.today, 1) : ctx.today);

    var hour = new Date().getHours();
    var greet = hour < 6 ? 'Buenas noches' : hour < 13 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';

    var html = '';

    html += '<div class="hero">' +
      '<div class="greet">' + esc(greet) + ',<br>' + esc(ctx.settings.name || 'Simón') + '</div>' +
      '<div class="sub">' + esc(S.formatLong(ctx.today)) + '</div>' +
      '</div>';

    /* ---- aviso principal */
    if (todayRec && todayRec.went) {
      html += callout('is-good', 'checkCircle', 'Sesión registrada',
        S.formatDuration(todayRec.duration) + ' · energía ' + todayRec.energy +
        '/5 · sensación ' + todayRec.feeling + '/5');
    } else if (todayRec && !todayRec.went) {
      html += callout('is-flat', 'crossCircle', 'Hoy marcaste que no fuiste',
        'Puedes cambiarlo si al final acabaste yendo.');
    } else if (isGymDay && ctx.settings.reminders) {
      // racha en riesgo: si hay racha viva, el aviso sube de tono
      if (st.current >= 2) {
        html += callout('is-warn', 'alert', 'Racha en juego',
          'Llevas <b>' + st.current + '</b> ' + (st.current === 1 ? 'sesión' : 'sesiones') +
          ' seguidas. Hoy toca gimnasio y aún no lo has registrado.');
      } else {
        html += callout('', 'barbell', 'Hoy toca gimnasio',
          'Cuando termines, registra la sesión.');
      }
    } else if (next) {
      html += callout('is-flat', 'calendar', 'Siguiente sesión',
        S.capitalize(S.formatLong(next)) + (S.daysBetween(ctx.today, next) === 1 ? ' · mañana' : ''));
    }

    /* ---- acción */
    html += '<button class="btn primary block" data-act="log" data-date="' + ctx.today + '">' +
      icon(todayRec ? 'edit' : 'plus') + (todayRec ? 'Editar lo de hoy' : 'Registrar sesión') + '</button>';

    if (!todayRec && S.done(ctx.workouts).length >= 3) {
      var typ = S.typicalWorkout(ctx.workouts);
      html += '<button class="btn ghost block" data-act="quicklog">' + icon('bolt') +
        'Igual que siempre · ' + S.formatDuration(typ.duration) + '</button>';
    }

    /* ---- días sin cerrar: todavía se pueden rellenar */
    var open = S.openDays(ctx.workouts, g, ctx.today, ctx.start, ctx.win);
    if (open.length) {
      html += callout('is-warn', 'clock',
        open.length === 1 ? 'Te falta un día por registrar' : 'Te faltan ' + open.length + ' días por registrar',
        'Todavía estás a tiempo. El plazo para rellenar una sesión es de <b>' + ctx.win + ' días</b>.',
        open.slice(0, 3).map(function (d) {
          return '<button class="btn sm ghost" data-act="log" data-date="' + d + '" style="margin:0 6px 6px 0">' +
            esc(S.DAY_NAMES[S.dow(d)]) + ' ' + S.parse(d).getDate() + '</button>';
        }).join(''));
    }

    /* ---- semana */
    var diff = week.count - prevSoFar;
    var ref = weekOver ? 'que la semana pasada' : 'que a estas alturas de la semana pasada';
    var cmp = (prevWeek.count === 0 && week.count === 0)
      ? 'Sin registros la semana pasada.'
      : diff > 0 ? 'Llevas ' + diff + (diff === 1 ? ' sesión más ' : ' sesiones más ') + ref + '.'
        : diff < 0 ? 'Llevas ' + Math.abs(diff) + (Math.abs(diff) === 1 ? ' sesión menos ' : ' sesiones menos ') + ref + '.'
          : 'Mismo ritmo ' + ref + '.';

    html += '<div class="card">' +
      '<div class="card-head"><h3>Esta semana</h3><span class="spacer"></span>' +
      '<span class="muted" style="font-size:12.5px">' + esc(S.formatShort(week.start)) + ' – ' + esc(S.formatShort(week.end)) + '</span></div>' +
      weekDots(ctx, ctx.today) +
      weeklyGoalBar(week.count, GL.store.weeklyTarget(ctx.settings)) +
      '<div style="display:flex;gap:22px;margin-top:16px;flex-wrap:wrap">' +
      '<div><span class="eyebrow">Sesiones</span><div class="num" style="font-size:30px;line-height:1;margin-top:6px">' +
      week.count + '<span class="muted" style="font-size:17px"> / ' + week.scheduledTotal + '</span></div></div>' +
      '<div><span class="eyebrow">Racha</span><div class="num" style="font-size:30px;line-height:1;margin-top:6px;color:var(--accent)">' + st.current + '</div></div>' +
      '<div><span class="eyebrow">Tiempo</span><div class="num" style="font-size:30px;line-height:1;margin-top:6px">' + S.formatDuration(week.minutes) + '</div></div>' +
      '</div>' +
      '<p class="muted" style="margin:14px 0 0;font-size:13px">' + esc(cmp) + '</p>' +
      '</div>';

    /* ---- mes */
    html += sectionTitle('Este mes', '<span class="eyebrow">' + esc(S.formatMonth(mk)) + '</span>');
    html += '<div class="tiles four-up">' +
      tile('Sesiones', String(month.count), 'de ' + month.scheduledTotal + ' programadas') +
      tile('Asistencia', fmtPct(month.attendance.scheduled ? month.attendance.pct : null),
        month.attendance.scheduled
          ? month.attendance.missed + ' sin ir' + (month.attendance.open ? ' · ' + month.attendance.open + ' sin cerrar' : '')
          : (month.attendance.open ? month.attendance.open + ' sin cerrar' : 'aún sin días contados'), 'accent') +
      tile('Racha', String(st.current), st.currentStart ? 'desde el ' + esc(S.formatShort(st.currentStart)) : 'sin racha activa') +
      tile('Récord', String(st.best), 'mejor racha') +
      '</div>';

    /* Tres celdas y tres datos: con solo dos, a partir de 1180px la rejilla
       pasa a cuatro columnas y las que sobraban se veían como un rectángulo
       oscuro vacío. La clase «three» fija tres columnas en todos los anchos. */
    var doneTotal = S.done(ctx.workouts).length;
    html += '<div class="tiles three">' +
      tile('Tiempo', S.formatDuration(month.minutes), month.count ? 'media ' + S.formatDuration(month.avgDuration) : 'sin datos') +
      tile('Siguiente', next ? (next === ctx.today ? 'Hoy'
        : S.daysBetween(ctx.today, next) === 1 ? 'Mañana'
          : esc(S.DAY_NAMES[S.dow(next)])) : '—',
        next ? esc(S.formatShort(next)) : 'define tus días en ajustes') +
      tile('Totales', String(doneTotal),
        doneTotal && ctx.eff ? 'desde el ' + esc(S.formatShort(ctx.eff)) : 'aún sin registros') +
      '</div>';

    /* ---- recordatorio del día de entreno */
    html += reminderBanner(ctx);

    /* ---- entrenador con IA */
    html += coachCard(ctx);

    /* ---- motivación */
    if (st.current >= 3) {
      html += callout('', 'flame', st.current + ' sesiones seguidas',
        st.current >= st.best
          ? 'Es tu mejor racha hasta ahora. No la sueltes.'
          : 'Tu récord está en <b>' + st.best + '</b>. Te faltan ' + (st.best - st.current + 1) + '.');
    }

    /* ---- últimos */
    var recent = ctx.workouts.slice(0, 3);
    if (recent.length) {
      html += sectionTitle('Últimas sesiones',
        '<button class="btn sm subtle" data-act="go" data-view="history">Ver todo</button>');
      html += recent.map(function (w) { return entryCard(w, ctx); }).join('');
    } else {
      html += '<div class="card"><div class="empty">' + icon('barbell') +
        '<h3>Todo empieza en cero</h3>' +
        '<p>Las estadísticas cuentan desde el ' + esc(S.formatShort(ctx.eff || ctx.today)) +
        '. Los días anteriores no figuran como faltas.</p>' +
        '<button class="btn primary" data-act="log" data-date="' + ctx.today + '">' + icon('plus') + 'Registrar ahora</button>' +
        '</div></div>';
    }

    if (ctx.hasDemo) html += demoBanner();
    return { html: html };
  }

  function demoBanner() {
    return '<div class="card tight" style="display:flex;align-items:center;gap:12px">' +
      icon('layers') +
      '<div style="flex:1;min-width:0">' +
      '<b style="font-family:var(--font-cond);font-size:14px;letter-spacing:.09em;text-transform:uppercase">Datos de ejemplo</b>' +
      '<div class="muted" style="font-size:12.5px">Marcados con la etiqueta «ejemplo».</div>' +
      '</div>' +
      '<button class="btn sm ghost" data-act="clear-demo">Borrar</button>' +
      '</div>';
  }

  /* ------------------------------------------------------- tarjeta lista */
  function entryCard(w, ctx, fullNote) {
    return '<button class="entry ' + (w.went ? 'went' : 'skip') + '" data-act="detail" data-id="' + esc(w.id) + '">' +
      '<div class="top">' +
      '<span class="date">' + esc(S.formatLong(w.date)) + '</span>' +
      '<span class="spacer"></span>' +
      (w.demo ? '<span class="pill demo">ejemplo</span>' : '') +
      '</div>' +
      '<h3>' + (w.went ? 'Sesión completada' : 'No fui') + '</h3>' +
      (w.went && (GL.store.focusLabel(w) || w.light)
        ? (GL.store.focusLabel(w)
            ? '<span class="pill type">' + esc(GL.store.focusLabel(w)) + '</span>'
            : '') +
          (GL.store.focusMuscles(w).length
            ? '<span class="pill musc">' + esc(GL.store.focusMuscles(w).join(', ')) + '</span>'
            : '') +
          (w.light
            ? '<span class="pill light">' + icon(w.light === 'dia' ? 'sun' : 'moon') +
              esc(lightText(w)) + '</span>'
            : '')
        : '') +
      (w.went
        ? '<div class="metrics">' +
        '<span>' + icon('clock') + '<b>' + S.formatDuration(w.duration) + '</b></span>' +
        '<span>' + icon('bolt') + meter(w.energy) + '</span>' +
        '<span>' + icon('pulse') + meter(w.feeling) + '</span>' +
        '<span>' + icon('gauge') + meter(w.difficulty) + '</span>' +
        (w.weight != null ? '<span>' + icon('scale') + '<b>' + fmtWeight(w.weight, ctx.settings.units) + '</b></span>' : '') +
        '</div>'
        : '') +
      (w.notes ? '<div class="note"' + (fullNote ? ' style="-webkit-line-clamp:none"' : '') + '>' + esc(w.notes) + '</div>' : '') +
      '</button>';
  }

  /* =========================================================== FOTOS
     Viven en la pestaña Progreso: son un registro más de cómo va el cuerpo.
     Subir una foto dispara el análisis solo, sin botón aparte; lo que la IA
     conteste se lee en la pestaña Entrenador. */
  function photosSection(ctx) {
    var p = ctx.photos || {};
    var u = p.usage;
    var sinCupo = u && !u.remaining;
    var html = '';

    html += '<div class="card flush">' +
      '<button class="row" data-act="photo-add"' + (p.busy || p.opining ? ' disabled' : '') + '>' +
      '<div class="t"><b>' + (p.busy ? 'Subiendo…' : 'Sacar o subir una foto') + '</b>' +
      '<small>' + (sinCupo
        ? 'Se guarda en tu historial. El análisis vuelve el lunes.'
        : 'Se guarda y el entrenador la analiza al toque.') + '</small></div>' +
      icon('plus') + '</button>' +
      '</div>';

    /* Un aviso corto, no la tarjeta entera: el detalle está en Entrenador. */
    if (p.opining) {
      html += '<div class="card tight"><p class="coach-wait" style="margin:0">' +
        'El entrenador está mirando la foto…</p></div>';
    } else if (p.opinion || p.opinionError) {
      html += '<button class="card tight linkrow" data-act="go" data-view="coach">' +
        '<span>' + (p.opinionError
          ? 'El análisis no salió. Mirá el detalle en Entrenador.'
          : 'Listo: el entrenador ya opinó de tu última foto.') + '</span>' +
        icon('right') + '</button>';
    } else if (u) {
      html += '<button class="card tight linkrow" data-act="go" data-view="coach">' +
        '<span>' + (sinCupo
          ? 'Sin análisis esta semana. Vuelven el lunes ' + esc(S.formatShort(u.nextReset)) + '.'
          : u.remaining + ' de ' + u.limit + ' análisis disponibles esta semana.') + '</span>' +
        icon('right') + '</button>';
    }

    html += sectionTitle('Fotos de progreso');
    if (p.loading) {
      html += '<div class="card"><p class="muted" style="margin:0;font-size:13.5px">Cargando tus fotos…</p></div>';
    } else if (p.error) {
      html += '<div class="card"><p class="coach-err" style="margin:0">' + esc(p.error) + '</p></div>';
    } else if (!p.list || !p.list.length) {
      html += '<div class="card"><div class="empty" style="padding:26px 12px">' + icon('image') +
        '<h3>Sin fotos todavía</h3>' +
        '<p>La primera es el punto de partida. Sacala con la misma luz y el mismo ángulo que vayas a repetir.</p>' +
        '</div></div>';
    } else {
      html += '<div class="card"><div class="shots">' + p.list.map(function (f) {
        return '<button class="shot" data-act="photo-open" data-path="' + esc(f.path) + '">' +
          '<img src="' + esc(f.url) + '" alt="Foto del ' + esc(f.date) + '" loading="lazy">' +
          '<span class="shot-d">' + esc(S.formatShort(f.date)) + '</span>' +
          '</button>';
      }).join('') + '</div>' +
        '<p class="muted" style="margin:12px 0 0;font-size:12.5px">' +
        p.list.length + (p.list.length === 1 ? ' foto' : ' fotos') +
        ' · de la más nueva a la más vieja</p></div>';
    }

    html += sectionTitle('Tarjeta para compartir');
    html += '<div class="card">' +
      '<p class="muted" style="margin:0 0 14px;font-size:13.5px">' +
      'Una imagen con tu racha, tus totales y tus marcas, sobre una foto acorde ' +
      'a lo último que entrenaste.</p>' +
      '<div class="btn-row">' +
      '<button class="btn primary" data-act="share-card">' + icon('image') + 'Generar</button>' +
      '</div>' +
      credito(ctx.credit) +
      '</div>';

    return html;
  }

  /* ============================================== ENTRENADOR PERSONAL
     Pestaña propia, al mismo nivel que Inicio o Progreso. Acá vive TODO lo
     que dice la IA: el consejo del día, la charla y lo que opinó de las
     fotos. El límite semanal lo manda el servidor y llega en
     ctx.photos.usage; acá solo se muestra. */

  /* Cuántos análisis quedan esta semana. */
  function quotaCard(u) {
    if (!u) return '';
    var quedan = u.remaining;
    return '<div class="card quota' + (quedan ? '' : ' is-out') + '">' +
      '<div class="quota-top">' +
      '<span class="eyebrow">Análisis de esta semana</span>' +
      '<span class="quota-n"><b>' + quedan + '</b> / ' + u.limit + '</span>' +
      '</div>' +
      '<span class="quota-track">' +
      '<span class="quota-fill" style="width:' + Math.round((u.used / u.limit) * 100) + '%"></span>' +
      '</span>' +
      '<p class="quota-foot">' + (quedan
        ? quedan + (quedan === 1 ? ' análisis disponible' : ' análisis disponibles') +
          '. Se reponen el lunes ' + esc(S.formatShort(u.nextReset)) + '.'
        : 'Ya usaste tus ' + u.limit + ' análisis de esta semana. Vuelven el lunes ' +
          esc(S.formatShort(u.nextReset)) + '. Podés seguir guardando fotos igual.') +
      '</p></div>';
  }

  /* --------------------------------------------------------------- chat
     Bloque aparte del análisis de fotos, aunque compartan pantalla y la
     misma cadena Gemini → Groq por detrás. El historial vive en los ajustes
     de la cuenta, así que la charla sigue donde se dejó. */
  var CHAT_IDEAS = [
    '¿Cómo voy con mi constancia?',
    '¿Cuántos días de descanso necesito?',
    '¿Qué hago si me falta motivación?',
    '¿Está bien entrenar dos días seguidos?'
  ];

  function chatPanel(ctx) {
    var c = ctx.chat || {};
    var msgs = c.messages || [];

    var log = '';
    if (!msgs.length) {
      log = '<div class="chat-empty">' +
        '<p>Preguntale lo que quieras sobre entrenar: rutinas, descanso, técnica, ' +
        'o cómo venís con tu constancia.</p>' +
        '<div class="chat-ideas">' + CHAT_IDEAS.map(function (q) {
          return '<button class="chip" data-act="chat-ask" data-q="' + esc(q) + '">' + esc(q) + '</button>';
        }).join('') + '</div></div>';
    } else {
      log = msgs.map(function (m) {
        return '<div class="bubble ' + (m.role === 'user' ? 'mine' : 'his') + '">' +
          esc(m.text) + '</div>';
      }).join('');
      if (c.pending) log += '<div class="bubble his typing"><i></i><i></i><i></i></div>';
    }

    return '<div class="card chat">' +
      '<div class="chat-log" id="chat-log">' + log + '</div>' +
      (c.error ? '<p class="coach-err chat-error">' + esc(c.error) + '</p>' : '') +
      '<form class="chat-bar" id="chat-form" autocomplete="off">' +
      '<input id="chat-input" type="text" placeholder="Escribí tu pregunta…" ' +
      'maxlength="800"' + (c.pending ? ' disabled' : '') + '>' +
      '<button class="chat-send" type="submit" aria-label="Enviar"' +
      (c.pending ? ' disabled' : '') + '>' + icon('send') + '</button>' +
      '</form>' +
      (msgs.length
        ? '<div class="chat-foot"><button class="btn sm subtle" data-act="chat-clear">' +
          icon('trash') + 'Borrar la charla</button></div>'
        : '') +
      '</div>';
  }

  /* La atribución que exigen los términos de Unsplash: el fotógrafo y
     Unsplash, los dos enlazados y con los utm que ellos piden (los arma la
     Edge Function). En la tarjeta va dibujada en el canvas, donde no se
     puede pinchar; acá van los enlaces de verdad. */
  function credito(cr) {
    if (!cr || !cr.photographer) return '';
    return '<p class="credit">Foto de ' +
      '<a href="' + esc(cr.photographerUrl) + '" target="_blank" rel="noopener noreferrer">' +
      esc(cr.photographer) + '</a> en ' +
      '<a href="' + esc(cr.unsplashUrl) + '" target="_blank" rel="noopener noreferrer">Unsplash</a>' +
      '</p>';
  }

  /* Cuántos mensajes tenía el chat la última vez que se pintó. */
  var ultimoChat = -1;

  function coachScreen(ctx) {
    var p = ctx.photos || {};
    var html = '';

    /* Sin sesión no hay nada que pedirle a la IA. */
    if (!ctx.cloud) {
      return {
        html: '<div class="card"><div class="empty" style="padding:30px 12px">' + icon('spark') +
          '<h3>Entrá a tu cuenta</h3><p>El entrenador necesita tu sesión para responderte.</p>' +
          '</div></div>'
      };
    }

    var diario = coachCard(ctx);
    if (diario) html += sectionTitle('Consejo de hoy') + diario;

    html += sectionTitle('Preguntale al entrenador');
    html += chatPanel(ctx);

    html += sectionTitle('Tus fotos, según la IA');
    html += quotaCard(p.usage);

    if (p.opining || p.opinion || p.opinionError) {
      html += '<div class="card coach">' +
        '<div class="coach-head"><span class="eyebrow">Última foto</span></div>' +
        (p.opining
          ? '<p class="coach-wait">Comparando tus fotos…</p>'
          : p.opinionError
            ? '<p class="coach-err">' + esc(p.opinionError) + '</p>'
            : '<p class="coach-main">' + esc(p.opinion.recomendacion) + '</p>' +
              (p.opinion.consejo ? '<p class="coach-tip">' + esc(p.opinion.consejo) + '</p>' : '')) +
        '</div>';
    } else if (!p.history || !p.history.length) {
      html += '<button class="card tight linkrow" data-act="go" data-view="progress">' +
        '<span>' + (p.list && p.list.length
          ? 'Subí una foto nueva y la analizo al toque.'
          : 'Todavía no subiste ninguna foto. Se suben desde Progreso.') + '</span>' +
        icon('right') + '</button>';
    }

    if (p.history && p.history.length) {
      html += sectionTitle('Análisis anteriores');
      html += '<div class="card flush">' + p.history.map(function (h) {
        return '<div class="feed">' +
          '<span class="feed-d">' + esc(S.capitalize(S.formatLong(h.at))) + '</span>' +
          '<p>' + esc(h.recomendacion || '') + '</p>' +
          (h.consejo ? '<p class="feed-c">' + esc(h.consejo) + '</p>' : '') +
          '</div>';
      }).join('') + '</div>';
    }

    /* El registro se pinta entero en cada render. Bajarlo siempre sería
       arrastrar a la persona al final justo cuando está leyendo algo de más
       arriba, así que solo se salta al fondo cuando hay un mensaje nuevo (o
       uno en camino). data-pinned le dice a render() que no devuelva el
       scroll anterior: en ese caso mandamos nosotros. */
    function mount() {
      var log = document.getElementById('chat-log');
      if (!log) return;
      var n = (ctx.chat.messages || []).length + (ctx.chat.pending ? 1 : 0);
      if (n !== ultimoChat) {
        log.scrollTop = log.scrollHeight;
        log.setAttribute('data-pinned', '1');
      }
      ultimoChat = n;
    }

    return { html: html, mount: mount };
  }

  /* ============================================================ CALENDARIO */
  function calendar(ctx) {
    var g = ctx.settings.gymDays;
    var mk = ctx.state.month;
    var cells = S.calendarGrid(mk, ctx.workouts, g, ctx.today, ctx.start, ctx.win);
    var isCurrent = mk === S.monthKey(ctx.today);
    var dows = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
    var dowIndex = [1, 2, 3, 4, 5, 6, 0];

    var html = '<div class="card">' +
      '<div class="cal-head">' +
      '<button class="iconbtn" data-act="month" data-delta="-1" aria-label="Mes anterior">' + icon('left') + '</button>' +
      '<span class="title">' + esc(S.formatMonth(mk)) + '</span>' +
      (isCurrent ? '' : '<button class="btn sm subtle" data-act="month-today">Hoy</button>') +
      '<button class="iconbtn" data-act="month" data-delta="1" aria-label="Mes siguiente">' + icon('right') + '</button>' +
      '</div>' +
      '<div class="cal-dows">' + dows.map(function (d, i) {
        return '<span class="' + (g.indexOf(dowIndex[i]) >= 0 ? 'sched' : '') + '">' + d + '</span>';
      }).join('') + '</div>' +
      '<div class="cal-grid">' + cells.map(function (c) {
        if (!c) return '<div class="cal-cell"></div>';
        var cls = 'cal-day st-' + c.status +
          (c.isToday ? ' is-today' : '') +
          (c.future ? ' is-future' : '') +
          (ctx.state.selected === c.date ? ' is-selected' : '');
        return '<div class="cal-cell"><button class="' + cls + '" data-act="pick-day" data-date="' + c.date + '" ' +
          'aria-label="' + esc(S.formatLong(c.date)) + '">' + c.day +
          (c.workout && c.workout.notes ? '<span class="dot"></span>' : '') +
          '</button></div>';
      }).join('') + '</div>' +
      '<div class="legend">' +
      '<span>' + mark('done') + 'Fui</span>' +
      '<span>' + mark('missed') + 'No fui</span>' +
      '<span>' + mark('open') + 'Sin cerrar</span>' +
      '<span>' + mark('pending') + 'Pendiente</span>' +
      '<span>' + mark('rest') + 'Día normal</span>' +
      '</div>' +
      '</div>';

    var sel = ctx.state.selected;
    if (sel && S.monthKey(sel) === mk) {
      var w = ctx.byDate[sel];
      var status = S.dayStatus(sel, ctx.byDate, g, ctx.today, ctx.eff, ctx.win);
      html += '<div class="card">' +
        '<div class="card-head"><h3>' + esc(S.formatLong(sel)) + '</h3>' +
        '<span class="spacer"></span>' + statusPill(status) + '</div>' +
        (w && w.went
          ? '<div class="tiles three">' +
          tile('Duración', S.formatDuration(w.duration)) +
          tile('Energía', w.energy + '<small>/5</small>') +
          tile('Sensación', w.feeling + '<small>/5</small>') +
          '</div>' +
          '<div class="tiles three" style="margin-top:8px">' +
          tile('Dificultad', w.difficulty + '<small>/5</small>') +
          tile('Peso', w.weight != null ? fmtWeight(w.weight, ctx.settings.units) : NONE) +
          tile('Trabajado', typeValue(w)) +
          '</div>' +
          (GL.store.focusMuscles(w).length
            ? '<p class="musclist">' + esc(GL.store.focusMuscles(w).join(' · ')) + '</p>'
            : '') +
          (w.light
            ? '<p class="musclist">' + icon(w.light === 'dia' ? 'sun' : 'moon') + ' ' +
              esc(lightText(w)) + '</p>'
            : '') +
          (w.notes ? '<p style="margin:14px 0 0;font-size:14px;color:var(--text-dim);border-left:1px solid var(--border-strong);padding-left:11px">' + esc(w.notes) + '</p>' : '')
          : '<p class="muted" style="margin:0 0 14px;font-size:14px">' +
          (status === 'open' ? 'Día programado sin registrar. Te ' +
            (daysLeft(sel, ctx) === 1 ? 'queda 1 día' : 'quedan ' + daysLeft(sel, ctx) + ' días') + ' para rellenarlo.'
            : status === 'missed' && !w ? 'Era un día programado y el plazo para registrarlo ya pasó.'
              : status === 'pending' ? 'Día programado, todavía sin registrar.'
                : status === 'missed' && w ? (w.notes ? esc(w.notes) : 'Marcaste que no fuiste.')
                  : 'No es uno de tus días de gimnasio.') + '</p>') +
        (w || S.canLog(sel, ctx.today, ctx.win)
          ? '<div class="btn-row" style="margin-top:14px">' +
          '<button class="btn ' + (status === 'open' ? 'primary' : 'ghost') + ' sm" data-act="log" data-date="' + sel + '">' +
          (w ? icon('edit') + 'Editar' : icon('plus') + 'Registrar') + '</button>' +
          (w ? '<button class="btn danger sm" data-act="delete" data-id="' + esc(w.id) + '">' + icon('trash') + 'Eliminar</button>' : '') +
          '</div>'
          : '<p class="muted" style="margin:14px 0 0;font-size:12.5px;display:flex;gap:8px;align-items:center">' +
          icon('clock') + 'El plazo de ' + ctx.win + ' días para registrarlo ha caducado.</p>') +
        '</div>';
    }

    html += sectionTitle('Resumen de ' + S.formatMonth(mk).split(' ')[0]);
    html += monthCard(ctx, mk);
    html += '<button class="btn ghost block" data-act="share-month" data-month="' + mk + '">' +
      icon('image') + 'Compartir el mes</button>';
    return { html: html };
  }

  function monthCard(ctx, mk) {
    var g = ctx.settings.gymDays;
    var m = S.monthSummary(ctx.workouts, g, mk, ctx.today, ctx.start, ctx.win);
    var prevD = S.parse(mk + '-01'); prevD.setMonth(prevD.getMonth() - 1);
    var prevKey = S.iso(prevD).slice(0, 7);
    var p = S.monthSummary(ctx.workouts, g, prevKey, ctx.today, ctx.start, ctx.win);
    var comparable = p.attendance.scheduled > 0 && p.count > 0;
    var d = m.count - p.count;

    return '<div class="card">' +
      '<div class="tiles">' +
      tile('Sesiones', String(m.count)) +
      tile('Asistencia', fmtPct(m.attendance.scheduled ? m.attendance.pct : null), null, 'accent') +
      tile('Mejor racha', String(m.bestStreak)) +
      tile('Tiempo', S.formatDuration(m.minutes)) +
      '</div>' +
      '<div class="tiles three" style="margin-top:8px">' +
      tile('Energía', fmtAvg(m.energy)) +
      tile('Sensación', fmtAvg(m.feeling)) +
      tile('Dificultad', fmtAvg(m.difficulty)) +
      '</div>' +
      (comparable
        ? '<p class="muted" style="margin:13px 0 0;font-size:13px">Frente a ' + esc(S.formatMonth(prevKey).split(' ')[0]) + ': ' +
        (d > 0 ? '+' + d + (d === 1 ? ' sesión' : ' sesiones') : d < 0 ? d + (d === -1 ? ' sesión' : ' sesiones') : 'mismo número') +
        ' · asistencia ' + p.attendance.pct + '% → ' + m.attendance.pct + '%.</p>'
        : '<p class="muted" style="margin:13px 0 0;font-size:13px">Aún no hay datos suficientes del mes anterior para comparar.</p>') +
      '</div>';
  }

  /* ============================================================== HISTORIAL */
  var FILTERS = [
    { id: 'month', label: 'Mes' },
    { id: '3m', label: '3 meses' },
    { id: 'year', label: 'Año' },
    { id: 'all', label: 'Todo' }
  ];

  function history(ctx) {
    var f = ctx.state.filter, sort = ctx.state.sort, mode = ctx.state.histMode || 'all';
    var q = (ctx.state.query || '').trim().toLowerCase();
    var start;
    if (f === 'month') start = S.monthKey(ctx.today) + '-01';
    else if (f === '3m') { var d = S.parse(ctx.today); d.setMonth(d.getMonth() - 3); start = S.iso(d); }
    else if (f === 'year') start = ctx.today.slice(0, 4) + '-01-01';
    else start = '1970-01-01';

    var list = ctx.workouts.filter(function (w) { return S.daysBetween(start, w.date) >= 0; });
    if (mode === 'notes') list = list.filter(function (w) { return w.notes && w.notes.trim(); });
    if (q) {
      list = list.filter(function (w) {
        return (w.notes || '').toLowerCase().indexOf(q) >= 0 ||
          S.formatLong(w.date).toLowerCase().indexOf(q) >= 0;
      });
    }
    list.sort(function (a, b) {
      return sort === 'old' ? (a.date < b.date ? -1 : 1) : (a.date > b.date ? -1 : 1);
    });

    var doneList = list.filter(function (w) { return w.went; });
    var minutes = doneList.reduce(function (a, w) { return a + w.duration; }, 0);

    var html = '';
    html += '<div class="segmented">' +
      '<button data-act="histmode" data-mode="all"' + (mode === 'all' ? ' class="is-active"' : '') + '>Sesiones</button>' +
      '<button data-act="histmode" data-mode="notes"' + (mode === 'notes' ? ' class="is-active"' : '') + '>Notas</button>' +
      '</div>';

    html += '<div style="position:relative">' +
      '<input class="input" id="hist-q" data-live="query" placeholder="Buscar en notas y fechas" value="' + esc(ctx.state.query || '') + '" ' +
      'autocomplete="off" style="padding-left:42px">' +
      '<span style="position:absolute;left:13px;top:50%;transform:translateY(-50%);color:var(--text-muted);pointer-events:none">' + icon('search') + '</span>' +
      '</div>';

    html += '<div class="segmented">' + FILTERS.map(function (x) {
      return '<button data-act="filter" data-filter="' + x.id + '"' +
        (f === x.id ? ' class="is-active"' : '') + '>' + esc(x.label) + '</button>';
    }).join('') + '</div>';

    html += '<div style="display:flex;align-items:center;gap:10px;padding:0 2px">' +
      '<span class="eyebrow" style="flex:1">' + doneList.length +
      (doneList.length === 1 ? ' sesión' : ' sesiones') + ' · ' + S.formatDuration(minutes) + '</span>' +
      '<button class="btn sm subtle" data-act="sort">' +
      (sort === 'old' ? 'Más antiguo' : 'Más reciente') + '</button>' +
      '</div>';

    if (!list.length) {
      html += '<div class="card"><div class="empty">' + icon(mode === 'notes' ? 'note' : 'history') +
        '<h3>' + (q ? 'Sin resultados' : mode === 'notes' ? 'Sin notas' : 'Nada en este periodo') + '</h3>' +
        '<p>' + (q ? 'Prueba con otra palabra.' : 'Cambia el filtro o registra una sesión.') + '</p>' +
        (q ? '' : '<button class="btn primary" data-act="log" data-date="' + ctx.today + '">' + icon('plus') + 'Registrar</button>') +
        '</div></div>';
    } else {
      var lastMonth = null;
      list.forEach(function (w) {
        var mk = S.monthKey(w.date);
        if (mk !== lastMonth) {
          lastMonth = mk;
          html += sectionTitle(S.formatMonth(mk));
        }
        html += entryCard(w, ctx, mode === 'notes');
      });
    }
    return { html: html };
  }

  /* =============================================================== PROGRESO */
  var TABS = [
    { id: 'resumen', label: 'Resumen' },
    { id: 'analisis', label: 'Análisis' },
    { id: 'graficos', label: 'Gráficos' },
    { id: 'cuerpo', label: 'Cuerpo' },
    { id: 'fotos', label: 'Fotos' },
    { id: 'logros', label: 'Logros' }
  ];

  function progress(ctx) {
    var tab = ctx.state.progressTab || 'resumen';
    var html = '<div class="segmented">' + TABS.map(function (x) {
      return '<button data-act="ptab" data-tab="' + x.id + '"' +
        (tab === x.id ? ' class="is-active"' : '') + '>' + esc(x.label) + '</button>';
    }).join('') + '</div>';

    var mount = null;
    if (tab === 'resumen') html += progressSummary(ctx);
    else if (tab === 'analisis') { var a = analysis(ctx); html += a.html; mount = a.mount; }
    else if (tab === 'graficos') { var g = progressCharts(ctx); html += g.html; mount = g.mount; }
    else if (tab === 'cuerpo') {
      var p = weightSection(ctx), mm = measurementsSection(ctx);
      html += p.html + mm.html;
      mount = function () { if (p.mount) p.mount(); if (mm.mount) mm.mount(); };
    }
    else if (tab === 'fotos') html += photosSection(ctx);
    else html += achievementsSection(ctx);

    return { html: html, mount: mount };
  }

  function goalRing(count, goal) {
    var r = 40, c = 2 * Math.PI * r;
    var pct = goal ? Math.min(1, count / goal) : 0;
    return '<div class="ring">' +
      '<svg viewBox="0 0 100 100" aria-hidden="true">' +
      '<circle cx="50" cy="50" r="' + r + '" fill="none" stroke="var(--surface-3)" stroke-width="10"/>' +
      '<circle cx="50" cy="50" r="' + r + '" fill="none" stroke="var(--accent)" stroke-width="10" ' +
      'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + (c * (1 - pct)).toFixed(1) + '"/>' +
      '</svg>' +
      '<div class="val"><b>' + count + '</b><span>de ' + goal + '</span></div>' +
      '</div>';
  }

  function progressSummary(ctx) {
    var g = ctx.settings.gymDays;
    var o = S.overall(ctx.workouts, g, ctx.today, ctx.start, ctx.win);
    var st = S.streaks(ctx.workouts, g, ctx.today, ctx.start, ctx.win);
    var pw = S.perfectWeeks(ctx.workouts, g, ctx.today, ctx.start, ctx.win);
    var month = S.monthSummary(ctx.workouts, g, S.monthKey(ctx.today), ctx.today, ctx.start, ctx.win);
    var goal = ctx.settings.goal;
    var left = Math.max(0, goal - month.count);

    var html = '';
    html += '<div class="card"><div class="goal">' +
      goalRing(month.count, goal) +
      '<div class="txt"><b>Objetivo de ' + esc(S.formatMonth(S.monthKey(ctx.today)).split(' ')[0]) + '</b>' +
      '<p>' + (left === 0
        ? 'Objetivo cumplido. Todo lo que venga ya es de más.'
        : 'Te quedan <b>' + left + '</b> ' + (left === 1 ? 'sesión' : 'sesiones') + ' para llegar.') + '</p>' +
      '<button class="btn sm subtle" data-act="set-goal" style="margin-top:10px">Cambiar objetivo</button>' +
      '</div></div></div>';

    html += sectionTitle('Sesiones');
    html += '<div class="tiles four-up">' +
      tile('Totales', String(o.total)) +
      tile('Este año', String(o.thisYear)) +
      tile('Este mes', String(o.thisMonth)) +
      tile('Media mensual', dec(o.monthlyAverage)) +
      '</div>';

    html += sectionTitle('Asistencia');
    html += '<div class="tiles four-up">' +
      tile('Porcentaje', fmtPct(o.attendance.scheduled ? o.attendance.pct : null), null, 'accent') +
      tile('Programados', String(o.attendance.scheduled)) +
      tile('Realizados', String(o.attendance.done)) +
      tile('Faltados', String(o.attendance.missed)) +
      '</div>';

    html += sectionTitle('Constancia');
    html += '<div class="tiles three">' +
      tile('Racha actual', String(st.current), st.currentStart ? 'desde el ' + esc(S.formatShort(st.currentStart)) : 'sin racha') +
      tile('Mejor racha', String(st.best), 'días programados') +
      tile('Semanas 100%', String(pw.current), 'récord: ' + pw.best) +
      '</div>';

    html += sectionTitle('Tiempo');
    html += '<div class="tiles three">' +
      tile('Total', S.formatDuration(o.minutes)) +
      tile('Por sesión', S.formatDuration(o.avgDuration)) +
      tile('Este mes', S.formatDuration(month.minutes)) +
      '</div>';

    html += sectionTitle('Sensaciones');
    html += '<div class="tiles three">' +
      tile('Energía', fmtAvg(o.energy)) +
      tile('Sensación', fmtAvg(o.feeling)) +
      tile('Dificultad', fmtAvg(o.difficulty)) +
      '</div>';

    html += sectionTitle('Récords');
    html += recordCards(ctx);

    html += sectionTitle('Resumen del mes');
    html += monthCard(ctx, S.monthKey(ctx.today));
    return html;
  }

  /* ------------------------------------------------------------- récords
     Cada marca con la fecha en que se consiguió. Nada de pesos por
     ejercicio: acá se mide constancia y tiempo. */
  function recordCards(ctx) {
    var rec = S.records(ctx.workouts, ctx.settings.gymDays, ctx.today, ctx.start, ctx.win);

    function card(ico, label, value, when) {
      return '<div class="rcard' + (when ? '' : ' is-empty') + '">' +
        '<span class="rcard-ic">' + icon(ico) + '</span>' +
        '<span class="k">' + esc(label) + '</span>' +
        '<div class="v">' + value + '</div>' +
        '<div class="w">' + (when || 'sin datos todavía') + '</div>' +
        '</div>';
    }

    var streakWhen = null;
    if (rec.bestStreak && rec.bestStreakStart) {
      streakWhen = rec.bestStreakEnd && rec.bestStreakEnd !== rec.bestStreakStart
        ? esc(S.formatShort(rec.bestStreakStart)) + ' – ' + esc(S.formatShort(rec.bestStreakEnd))
        : 'desde el ' + esc(S.formatShort(rec.bestStreakStart));
    }

    return '<div class="rcards">' +
      card('clock', 'Sesión más larga',
        rec.longestSession ? S.formatDuration(rec.longestSession.duration) : '—',
        rec.longestSession ? esc(S.capitalize(S.formatLong(rec.longestSession.date))) : null) +
      card('bolt', 'Mejor racha',
        rec.bestStreak ? rec.bestStreak + '<small> días</small>' : '—',
        streakWhen) +
      card('calendarCheck', 'Mejor mes',
        rec.bestMonth ? rec.bestMonth.count + '<small> sesiones</small>' : '—',
        rec.bestMonth ? esc(S.capitalize(S.formatMonth(rec.bestMonth.key))) : null) +
      card('chartUp', 'Mejor semana',
        rec.bestWeek ? S.formatDuration(rec.bestWeek.minutes) : '—',
        rec.bestWeek ? 'semana del ' + esc(S.formatShort(rec.bestWeek.start)) : null) +
      '</div>';
  }

  /* --------------------------------------------------- mapa de calor anual
     Un año entero en columnas de semanas, al estilo del de GitHub. El verde
     sube de intensidad con la duración de la sesión; los días programados a
     los que faltaste quedan en rojo apagado. En pantallas estrechas el mapa
     se desplaza de lado dentro de su caja, sin encoger las casillas hasta
     volverlas ilegibles. */
  function yearHeat(ctx) {
    var years = S.yearsWithData(ctx.workouts);
    var year = ctx.state.heatYear || years[0];
    if (years.indexOf(year) < 0) year = years[0];

    var hm = S.yearHeatmap(ctx.workouts, ctx.settings.gymDays, year, ctx.today, ctx.start, ctx.win);
    var i = years.indexOf(year);
    var older = years[i + 1];          // los años vienen de mayor a menor
    var newer = years[i - 1];

    /* Etiquetas de mes: una sola por mes, ocupando tantas columnas como
       semanas tenga. Poniendo una etiqueta por columna se pisaban entre
       ellas, porque cada columna mide 11px y «ENE» necesita bastante más. */
    var cols = [];
    for (var k = 0; k < hm.cells.length; k += 7) cols.push(hm.cells.slice(k, k + 7));
    var groups = [], lastM = -1;
    cols.forEach(function (col) {
      /* el mes de media columna manda: así una semana a caballo entre dos
         meses se cuenta en el que ocupa la mayor parte */
      var m = (col[3] || col[0]).month;
      var inYear = col.some(function (c) { return c.inYear; });
      if (!inYear) { groups.push({ m: null, n: 1 }); lastM = -1; return; }
      if (m !== lastM) { groups.push({ m: m, n: 1 }); lastM = m; }
      else groups[groups.length - 1].n++;
    });

    var body = '<div class="heat-scroll"><div class="heat-inner">' +
      '<div class="heat-months year">' + groups.map(function (g2) {
        /* con menos de dos columnas no entra el nombre sin pisar al vecino */
        return '<span style="grid-column:span ' + g2.n + '">' +
          (g2.m != null && g2.n >= 2 ? esc(S.MONTHS_SHORT[g2.m]) : '') + '</span>';
      }).join('') + '</div>' +
      '<div class="heat year">' + hm.cells.map(function (c) {
        var cls;
        if (!c.inYear) cls = 'o';
        else if (c.went) cls = 'd l' + c.level;
        else if (c.status === 'missed') cls = 'm';
        else if (c.status === 'open') cls = 'k';
        else cls = '';
        var t = S.capitalize(S.formatLong(c.date)) +
          (c.went ? ' · ' + S.formatDuration(c.duration || 0)
            : c.status === 'missed' ? ' · no fuiste'
              : c.status === 'open' ? ' · sin cerrar' : '');
        return '<i class="' + cls + '" title="' + esc(t) + '"></i>';
      }).join('') + '</div>' +
      '</div></div>';

    return '<div class="card">' +
      '<div class="card-head"><h3>' + year + '</h3><span class="spacer"></span>' +
      '<div class="heat-nav">' +
      '<button class="iconbtn sm" data-act="heat-year" data-year="' + (older || '') + '"' +
      (older ? '' : ' disabled') + ' aria-label="Año anterior">' + icon('left') + '</button>' +
      '<button class="iconbtn sm" data-act="heat-year" data-year="' + (newer || '') + '"' +
      (newer ? '' : ' disabled') + ' aria-label="Año siguiente">' + icon('right') + '</button>' +
      '</div></div>' +
      '<p class="muted" style="margin:-4px 0 12px;font-size:12.5px">' +
      hm.count + (hm.count === 1 ? ' sesión' : ' sesiones') +
      (hm.minutes ? ' · ' + S.formatDuration(hm.minutes) : '') + '</p>' +
      body +
      '<div class="heat-legend">' +
      '<span class="muted">Menos</span>' +
      '<i class="hl"></i><i class="hl l1"></i><i class="hl l2"></i><i class="hl l3"></i><i class="hl l4"></i>' +
      '<span class="muted">Más</span>' +
      '<span class="spacer"></span>' +
      '<i class="hl miss"></i><span class="muted">No fui</span>' +
      '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------------- análisis */
  function analysis(ctx) {
    var g = ctx.settings.gymDays;
    var wd = S.byWeekday(ctx.workouts, g, ctx.today, ctx.start, ctx.win);
    var ins = S.insights(ctx.workouts, g, ctx.today, ctx.start, ctx.settings.units, ctx.win);

    var html = yearHeat(ctx);

    if (wd.length) {
      html += sectionTitle('Constancia por día');
      html += '<div class="card">' + wd.map(function (a) {
        return '<div style="display:flex;align-items:center;gap:12px;padding:9px 0">' +
          '<span class="eyebrow" style="width:96px;flex:none;font-size:11.5px">' + esc(a.name) + '</span>' +
          '<span style="flex:1;height:9px;background:var(--surface-3);border-radius:2px;overflow:hidden;display:block">' +
          '<span style="display:block;height:100%;width:' + a.pct + '%;background:' +
          (a.pct >= 90 ? 'var(--good)' : a.pct >= 70 ? 'var(--accent)' : 'var(--miss)') + '"></span></span>' +
          '<span class="num" style="width:52px;text-align:right;font-size:19px">' + a.pct + '%</span>' +
          '</div>' +
          '<div class="muted" style="font-size:12px;margin:-4px 0 6px 108px">' + a.done + ' de ' + a.scheduled + '</div>';
      }).join('') + '</div>';
    }

    var bl = S.byLight(ctx.workouts);
    if (bl) {
      html += sectionTitle('De día o de noche');
      html += lightCard(bl);
    }

    if (ins.length) {
      html += sectionTitle('Conclusiones');
      html += '<div class="card flush">' + ins.map(function (t, i) {
        return '<div class="insight"><span class="n">' + String(i + 1).padStart(2, '0') + '</span><p>' + t + '</p></div>';
      }).join('') + '</div>';
    }

    /* Las marcas grandes (sesión más larga, mejor racha, mejor mes, mejor
       semana) están como tarjetas en Resumen. Acá quedan las dos que no
       entraban ahí, para no repetir lo mismo en dos pestañas. */
    var rec = S.records(ctx.workouts, g, ctx.today, ctx.start, ctx.win);
    html += sectionTitle('Otras marcas');
    html += '<div class="card flush">' +
      recordRow('week', 'Semanas al 100%', rec.perfectWeeksTotal + ' en total', String(rec.perfectWeeks)) +
      recordRow('trophy', 'Tiempo total', 'desde el ' + (ctx.eff ? S.formatShort(ctx.eff) : '—'), S.formatDuration(rec.totalMinutes)) +
      '</div>';

    function mount() {
      var host = document.getElementById('ch-rolling');
      if (!host) return;
      GL.charts.draw(host, 'bar', {
        data: S.rollingWeeks(ctx.workouts, g, 12, ctx.today, ctx.start, ctx.win).map(function (w) {
          return { label: w.label.split(' ')[0], fullLabel: w.fullLabel, value: w.pct };
        }),
        format: function (v) { return v + '% de asistencia'; },
        tickFormat: function (v) { return Math.round(v) + '%'; },
        aria: 'Asistencia de las últimas 12 semanas',
        empty: 'Aún no hay semanas cerradas.'
      });
    }

    html += sectionTitle('Últimas 12 semanas');
    html += '<div class="card"><div class="chart" id="ch-rolling"></div></div>';

    return { html: html, mount: mount };
  }

  /* Compara las sesiones de día contra las de noche. Es una comparación de
     medias, no una prueba de nada: con pocas sesiones de un lado se avisa
     para que nadie saque conclusiones de dos datos. */
  function lightCard(bl) {
    var filas = [
      ['Sesiones', function (r) { return String(r.count); }],
      ['Energía', function (r) { return r.energy == null ? NONE : fmtAvg(r.energy); }],
      ['Sensación', function (r) { return r.feeling == null ? NONE : fmtAvg(r.feeling); }],
      ['Dificultad', function (r) { return r.difficulty == null ? NONE : fmtAvg(r.difficulty); }],
      ['Duración media', function (r) { return r.avgDuration == null ? NONE : S.formatDuration(r.avgDuration); }]
    ];

    var pocas = bl.dia.count < 4 || bl.noche.count < 4;

    return '<div class="card">' +
      '<div class="lightgrid">' +
      '<span class="lg-h"></span>' +
      '<span class="lg-h lg-dia">' + icon('sun') + 'Día</span>' +
      '<span class="lg-h lg-noche">' + icon('moon') + 'Noche</span>' +
      filas.map(function (f) {
        var vd = f[1](bl.dia), vn = f[1](bl.noche);
        return '<span class="lg-k">' + esc(f[0]) + '</span>' +
          '<span class="lg-v">' + vd + '</span>' +
          '<span class="lg-v">' + vn + '</span>';
      }).join('') +
      '</div>' +
      '<p class="muted" style="margin:14px 0 0;font-size:12.5px;line-height:1.55">' +
      (pocas
        ? 'Todavía hay pocas sesiones de un lado como para comparar. Se etiquetan solas al registrar el día.'
        : 'Comparación de medias sobre ' + bl.total + ' sesiones etiquetadas. La etiqueta sale del amanecer y el ocaso de tu ubicación.') +
      '</p></div>';
  }

  function recordRow(ico, title, sub, value) {
    return '<div class="record">' + icon(ico) +
      '<div class="t"><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></div>' +
      '<span class="v">' + esc(value) + '</span></div>';
  }

  /* ------------------------------------------------------------- gráficos */
  function chartCard(id, title, sub) {
    return '<div class="card">' +
      '<div class="card-head"><h3>' + esc(title) + '</h3></div>' +
      (sub ? '<p class="muted" style="margin:-8px 0 10px;font-size:12.5px">' + esc(sub) + '</p>' : '') +
      '<div class="chart" id="' + id + '"></div>' +
      '</div>';
  }

  function progressCharts(ctx) {
    var g = ctx.settings.gymDays;
    var series = S.monthlySeries(ctx.workouts, g, 6, ctx.today, ctx.start, ctx.win);
    var energy = S.energySeries(ctx.workouts, 24);
    var weights = S.weightSeries(ctx.weights);

    var html = '';
    html += chartCard('ch-count', 'Sesiones por mes', 'Últimos 6 meses');
    html += chartCard('ch-pct', 'Asistencia por mes', 'Sobre tus días programados');
    html += chartCard('ch-dur', 'Duración media por mes');
    html += chartCard('ch-energy', 'Energía en el tiempo', 'Últimas ' + Math.min(24, energy.length) + ' sesiones');
    if (weights.length) html += chartCard('ch-weight', 'Peso corporal', 'Solo con lo que tú registras');

    function mount() {
      var C = GL.charts;
      C.draw(document.getElementById('ch-count'), 'bar', {
        data: series.map(function (m) { return { label: m.label, fullLabel: m.fullLabel, value: m.count }; }),
        format: function (v) { return v + (v === 1 ? ' sesión' : ' sesiones'); },
        aria: 'Sesiones por mes',
        empty: 'Registra tu primera sesión para ver este gráfico.'
      });
      C.draw(document.getElementById('ch-pct'), 'bar', {
        data: series.map(function (m) { return { label: m.label, fullLabel: m.fullLabel, value: m.pct }; }),
        format: function (v) { return v + '% de asistencia'; },
        tickFormat: function (v) { return Math.round(v) + '%'; },
        aria: 'Porcentaje de asistencia por mes',
        empty: 'Sin días programados registrados todavía.'
      });
      C.draw(document.getElementById('ch-dur'), 'bar', {
        data: series.map(function (m) { return { label: m.label, fullLabel: m.fullLabel, value: m.avgDuration }; }),
        format: function (v) { return S.formatDuration(v) + ' de media'; },
        tickFormat: function (v) { return Math.round(v) + 'm'; },
        aria: 'Duración media por mes',
        empty: 'Aún no hay duraciones registradas.'
      });
      C.draw(document.getElementById('ch-energy'), 'line', {
        data: energy.map(function (e) { return { label: e.label, fullLabel: S.formatLong(e.date), value: e.value }; }),
        yMin: 1, yMax: 5, ticks: 4,
        tickFormat: function (v) { return Math.round(v); },
        format: function (v) { return 'Energía ' + v + '/5'; },
        aria: 'Energía a lo largo del tiempo',
        empty: 'Necesitas la energía de al menos dos sesiones.'
      });
      var wh = document.getElementById('ch-weight');
      if (wh) C.draw(wh, 'line', {
        data: weights.map(function (w) { return { label: w.label, fullLabel: S.formatLong(w.date), value: w.value }; }),
        colorVar: '--good',
        format: function (v) { return fmtWeight(v, ctx.settings.units); },
        tickFormat: function (v) { return Math.round(v * 10) / 10; },
        aria: 'Peso corporal a lo largo del tiempo',
        singleEmpty: 'Registra al menos dos mediciones para ver la evolución.'
      });
    }
    return { html: html, mount: mount };
  }

  /* --------------------------------------------------------- peso corporal */
  function weightSection(ctx) {
    var series = S.weightSeries(ctx.weights);
    var units = ctx.settings.units;
    var first = series[0], last = series[series.length - 1];
    var delta = (first && last) ? last.value - first.value : null;

    var html = '';
    html += '<div class="tiles three">' +
      tile('Actual', last ? fmtWeight(last.value, units) : NONE, last ? esc(S.formatShort(last.date)) : 'sin registros') +
      tile('Inicial', first ? fmtWeight(first.value, units) : NONE, first ? esc(S.formatShort(first.date)) : '—') +
      tile('Cambio', delta == null ? NONE : (delta > 0 ? '+' : '') + dec(delta) + ' ' + units,
        series.length + (series.length === 1 ? ' medición' : ' mediciones')) +
      '</div>';

    html += '<button class="btn primary block" data-act="weight-new">' + icon('plus') + 'Añadir medición</button>';
    html += '<div class="card"><div class="card-head"><h3>Evolución</h3></div><div class="chart" id="ch-weight-only"></div></div>';

    if (series.length) {
      html += sectionTitle('Mediciones');
      html += '<div class="card flush">' + series.slice().reverse().map(function (w) {
        return '<div class="row">' +
          '<div class="t"><b>' + fmtWeight(w.value, units) + '</b>' +
          '<small>' + esc(S.formatLong(w.date)) + (w.src === 'workout' ? ' · desde una sesión' : '') + '</small></div>' +
          '<button class="iconbtn" data-act="weight-edit" data-id="' + esc(w.id) + '" aria-label="Editar">' + icon('edit') + '</button>' +
          '<button class="iconbtn" data-act="weight-del" data-id="' + esc(w.id) + '" aria-label="Eliminar">' + icon('trash') + '</button>' +
          '</div>';
      }).join('') + '</div>';
    } else {
      html += '<div class="card"><div class="empty">' + icon('scale') +
        '<h3>Sin mediciones</h3><p>Registra tu peso cuando quieras. La app solo guarda lo que tú escribes.</p></div></div>';
    }

    function mount() {
      GL.charts.draw(document.getElementById('ch-weight-only'), 'line', {
        data: series.map(function (w) { return { label: w.label, fullLabel: S.formatLong(w.date), value: w.value }; }),
        colorVar: '--good',
        format: function (v) { return fmtWeight(v, units); },
        tickFormat: function (v) { return Math.round(v * 10) / 10; },
        aria: 'Peso corporal',
        empty: 'Todavía no has registrado tu peso.',
        singleEmpty: 'Con una sola medición no hay evolución. Añade otra.'
      });
    }
    return { html: html, mount: mount };
  }

  /* ------------------------------------------------------ medidas corporales
     El peso solo no dice si lo que crece es músculo. Bíceps, gemelos, muslo,
     pecho y cintura sí lo muestran. Un selector elige qué medida se grafica;
     el registro de cada día guarda todas las que se hayan tomado. */
  function measurementsSection(ctx) {
    var F = S.MEASURE_FIELDS;
    var rows = ctx.measurements || [];
    var selected = ctx.state.measureField || F[0].key;
    var field = S.measureField(selected);
    var series = S.measureSeries(rows, field.key);
    var first = series[0], last = series[series.length - 1];
    var delta = (first && last) ? Math.round((last.value - first.value) * 10) / 10 : null;

    var html = sectionTitle('Medidas corporales');
    html += '<div class="segmented">' + F.map(function (f) {
      return '<button data-act="mfield" data-field="' + f.key + '"' +
        (f.key === field.key ? ' class="is-active"' : '') + '>' + esc(f.label) + '</button>';
    }).join('') + '</div>';

    html += '<div class="tiles three">' +
      tile('Actual', last ? fmtCm(last.value) : NONE, last ? esc(S.formatShort(last.date)) : 'sin registros') +
      tile('Inicial', first ? fmtCm(first.value) : NONE, first ? esc(S.formatShort(first.date)) : '—') +
      tile('Cambio', delta == null ? NONE : (delta > 0 ? '+' : '') + dec(delta) + ' cm',
        series.length + (series.length === 1 ? ' registro' : ' registros')) +
      '</div>';

    html += '<button class="btn primary block" data-act="measure-new">' + icon('plus') + 'Añadir medidas</button>';
    html += '<div class="card"><div class="card-head"><h3>Evolución · ' + esc(field.label) + '</h3></div>' +
      '<div class="chart" id="ch-measure"></div></div>';

    if (rows.length) {
      html += sectionTitle('Registros');
      html += '<div class="card flush">' + rows.slice().reverse().map(function (m) {
        var parts = F.map(function (f) {
          if (f.paired) {
            var l = m[f.key + 'Izq'], r = m[f.key + 'Der'];
            if (l == null && r == null) return '';
            return f.label + ' ' + (l != null ? dec(l) : '—') + '/' + (r != null ? dec(r) : '—');
          }
          if (m[f.key] == null) return '';
          return f.label + ' ' + dec(m[f.key]);
        }).filter(Boolean).join(' · ');
        return '<div class="row">' +
          '<div class="t"><b>' + esc(S.formatLong(m.date)) + '</b><small>' + esc(parts || 'Sin medidas') + '</small></div>' +
          '<button class="iconbtn" data-act="measure-edit" data-id="' + esc(m.id) + '" aria-label="Editar">' + icon('edit') + '</button>' +
          '<button class="iconbtn" data-act="measure-del" data-id="' + esc(m.id) + '" aria-label="Eliminar">' + icon('trash') + '</button>' +
          '</div>';
      }).join('') + '</div>';
    } else {
      html += '<div class="card"><div class="empty">' + icon('ruler') +
        '<h3>Sin medidas</h3><p>El peso no distingue músculo de lo demás. Registra bíceps, gemelos, muslo, pecho o cintura para ver el progreso real.</p></div></div>';
    }

    function mount() {
      GL.charts.draw(document.getElementById('ch-measure'), 'line', {
        data: series.map(function (m) { return { label: m.label, fullLabel: S.formatLong(m.date), value: m.value }; }),
        colorVar: '--accent',
        format: fmtCm,
        tickFormat: function (v) { return Math.round(v * 10) / 10; },
        aria: 'Evolución de ' + field.label,
        empty: 'Todavía no has registrado ' + field.label.toLowerCase() + '.',
        singleEmpty: 'Con un solo registro no hay evolución. Añade otro.'
      });
    }
    return { html: html, mount: mount };
  }

  /* ---------------------------------------------------------------- logros */
  function achievementsSection(ctx) {
    var ev = GL.achievements.evaluate(ctx.workouts, ctx.settings.gymDays, ctx.unlocked, ctx.today, ctx.start,
      { weights: ctx.weights.length, measurements: (ctx.measurements || []).length, goal: ctx.settings.goal, win: ctx.win });
    var on = ev.items.filter(function (i) { return i.unlocked; }).length;

    var html = '<div class="card tight" style="display:flex;align-items:center;gap:12px">' +
      icon('medal') +
      '<div style="flex:1"><b style="font-family:var(--font-cond);font-size:15px;letter-spacing:.09em;text-transform:uppercase">' +
      on + ' de ' + ev.items.length + '</b>' +
      '<div class="muted" style="font-size:12.5px">Se desbloquean solos según tus datos.</div></div></div>';

    html += '<div class="badges">' + ev.items.map(function (a) {
      return '<div class="badge' + (a.unlocked ? ' on' : '') + '" title="' + esc(a.desc) + '">' +
        icon(a.icon) +
        '<div class="t">' + esc(a.title) + '</div>' +
        '<div class="p">' + (a.unlocked ? S.formatShort(a.date || ctx.today) : a.raw + '/' + a.goal) + '</div>' +
        '</div>';
    }).join('') + '</div>';
    return html;
  }

  /* =============================================================== AJUSTES */
  function settings(ctx) {
    var s = ctx.settings;
    var dows = [{ i: 1, l: 'L' }, { i: 2, l: 'M' }, { i: 3, l: 'X' }, { i: 4, l: 'J' },
    { i: 5, l: 'V' }, { i: 6, l: 'S' }, { i: 0, l: 'D' }];

    var html = '';

    html += sectionTitle('Perfil');
    html += '<div class="card" style="display:flex;flex-direction:column;gap:16px">' +
      '<div class="field"><label for="set-name">Nombre</label>' +
      '<input class="input" id="set-name" data-set="name" value="' + esc(s.name) + '" maxlength="24" autocomplete="off"></div>' +
      '<div class="field"><label for="set-start">Empecé a registrar el</label>' +
      '<input class="input" type="date" id="set-start" data-set="startDate" value="' +
      esc(s.startDate || ctx.today) + '" max="' + ctx.today + '">' +
      '<span class="hint">Los días de gimnasio anteriores a esta fecha no cuentan como faltas.</span></div>' +
      '<div class="field"><label for="set-window">Plazo para registrar días pasados</label>' +
      '<input class="input" type="number" id="set-window" data-set="backfillDays" min="0" max="60" value="' + s.backfillDays + '">' +
      '<span class="hint">Días que tienes para rellenar una sesión olvidada. Pasado ese plazo el día queda como falta y ya no se puede registrar.</span></div>' +
      '<div class="field"><label for="set-goal">Objetivo mensual</label>' +
      '<input class="input" type="number" id="set-goal" data-set="goal" min="1" max="31" value="' + s.goal + '">' +
      '<span class="hint">Sesiones al mes. Con tus días programados salen unas ' +
      Math.round(s.gymDays.length * 4.33) + '.</span></div>' +
      '<div class="field"><label for="set-weekly">Meta semanal</label>' +
      '<input class="input" type="number" id="set-weekly" data-set="weeklyGoal" min="1" max="14" ' +
      'placeholder="' + GL.store.weeklyTarget(s) + '" value="' + (s.weeklyGoal == null ? '' : s.weeklyGoal) + '">' +
      '<span class="hint">Sesiones por semana, la barra de Inicio. Si lo dejás vacío usa tus días ' +
      'programados (' + GL.store.weeklyTarget(s) + ').</span></div>' +
      '<div class="field"><label for="set-age">Edad</label>' +
      '<input class="input" type="number" id="set-age" data-set="age" min="10" max="100" value="' + (s.age == null ? '' : s.age) + '"></div>' +
      '<div class="field"><label for="set-height">Altura (cm)</label>' +
      '<input class="input" type="number" id="set-height" data-set="heightCm" min="100" max="250" value="' + (s.heightCm == null ? '' : s.heightCm) + '"></div>' +
      '<div class="field"><label>Objetivo físico</label><div class="optiongrid">' +
      GL.store.BODY_GOALS.map(function (g) {
        return '<button data-act="bodygoal" data-goal="' + g.key + '"' +
          (s.bodyGoal === g.key ? ' class="is-active"' : '') + '>' + esc(g.label) + '</button>';
      }).join('') + '</div></div>' +
      '</div>';

    html += sectionTitle('Días de gimnasio');
    html += '<div class="card">' +
      '<div class="daypick">' + dows.map(function (d) {
        return '<button data-act="toggle-day" data-day="' + d.i + '"' +
          (s.gymDays.indexOf(d.i) >= 0 ? ' class="on"' : '') + ' aria-label="' + S.DAY_NAMES[d.i] + '"' +
          ' aria-pressed="' + (s.gymDays.indexOf(d.i) >= 0) + '">' + d.l + '</button>';
      }).join('') + '</div>' +
      '<p class="muted" style="margin:12px 0 0;font-size:12.5px">El calendario, la asistencia y las rachas se calculan con estos días.</p>' +
      '</div>';

    html += sectionTitle('Preferencias');
    html += '<div class="card flush">' +
      '<div class="row"><div class="t"><b>Unidad de peso</b><small>Solo cambia la etiqueta; los valores no se convierten.</small></div>' +
      '<div class="segmented" style="width:auto;flex:none">' +
      '<button data-act="units" data-units="kg"' + (s.units === 'kg' ? ' class="is-active"' : '') + '>kg</button>' +
      '<button data-act="units" data-units="lb"' + (s.units === 'lb' ? ' class="is-active"' : '') + '>lb</button>' +
      '</div></div>' +
      '<div class="row" style="flex-direction:column;align-items:stretch;gap:10px">' +
      '<div class="t"><b>Tema</b><small>«Automático» sigue al sistema.</small></div>' +
      '<div class="segmented">' +
      '<button data-act="theme" data-theme="dark"' + (s.theme === 'dark' ? ' class="is-active"' : '') + '>Oscuro</button>' +
      '<button data-act="theme" data-theme="light"' + (s.theme === 'light' ? ' class="is-active"' : '') + '>Claro</button>' +
      '<button data-act="theme" data-theme="auto"' + (s.theme === 'auto' ? ' class="is-active"' : '') + '>Automático</button>' +
      '</div></div>' +
      '<button class="row" data-act="toggle-reminders"><div class="t"><b>Recordatorios</b>' +
      '<small>Aviso en Inicio los días que toca gimnasio.</small></div>' +
      '<span class="switch' + (s.reminders ? ' on' : '') + '" role="switch" aria-checked="' + !!s.reminders + '"></span></button>' +
      (s.reminders
        ? '<div class="row" style="flex-direction:column;align-items:stretch;gap:8px">' +
        '<div class="field" style="gap:6px"><label for="set-rhour">Avisar a partir de las</label>' +
        '<input class="input" type="number" id="set-rhour" data-set="reminderHour" min="0" max="23" value="' + s.reminderHour + '">' +
        '<span class="hint">Hora del día. Antes de esa hora no molesta, porque todavía hay tiempo de ir.</span>' +
        '</div></div>'
        : '') +
      '<button class="row" data-act="toggle-intro"><div class="t"><b>Intro al abrir</b>' +
      '<small>La animación LOCK IN.</small></div>' +
      '<span class="switch' + (s.intro ? ' on' : '') + '" role="switch" aria-checked="' + !!s.intro + '"></span></button>' +
      (s.intro ? '<button class="row" data-act="replay-intro"><div class="t"><b>Ver la intro</b>' +
        '<small>Reproducirla ahora.</small></div>' + icon('replay') + '</button>' : '') +
      '</div>';

    /* --------------------------------------------------------------- cuenta */
    html += sectionTitle('Cuenta');
    html += callout('is-good', 'shield', 'Sincronizado',
      'Conectado como <b>' + esc(ctx.cloud ? ctx.cloud.email : '') + '</b>. Tus datos se guardan solos en tu cuenta.' +
      '<span id="sync-age">' + (s.lastSync
        ? ' Última sincronización hace ' +
          (ctx.syncAge === 0 ? 'menos de un día' : ctx.syncAge + ' días') + '.'
        : '') + '</span>');
    html += '<div class="card flush">' +
      '<button class="row" data-act="cloud-sync"><div class="t"><b>Sincronizar ahora</b>' +
      '<small>Forzar una subida, por si acaso.</small></div>' + icon('upload') + '</button>' +
      '<button class="row danger" data-act="cloud-logout"><div class="t"><b>Cerrar sesión</b>' +
      '<small>Volvés a la pantalla de acceso.</small></div></button>' +
      '</div>';

    /* ----------------------------------------------------- respaldo manual
       La cuenta en la nube es el respaldo principal; esto es el extra para
       quien quiera llevarse el archivo. */
    html += sectionTitle('Copia manual');
    html += '<div class="card flush">' +
      '<button class="row" data-act="export"><div class="t"><b>Exportar a un archivo</b>' +
      '<small>' + (s.lastExport
        ? 'Última copia hace ' + (ctx.backupAge === 0 ? 'menos de un día' : ctx.backupAge + ' días')
        : 'Un JSON con todo: sesiones, pesos y medidas.') + '</small></div>' + icon('share') + '</button>' +
      '<button class="row" data-act="import"><div class="t"><b>Importar desde un archivo</b>' +
      '<small>Recupera un JSON exportado antes.</small></div>' + icon('upload') + '</button>' +
      '</div>';

    html += sectionTitle('Datos');
    html += '<div class="card flush">' +
      (ctx.hasDemo
        ? '<button class="row" data-act="clear-demo"><div class="t"><b>Borrar datos de ejemplo</b>' +
        '<small>Deja solo tus registros reales.</small></div>' + icon('trash') + '</button>'
        : '<button class="row" data-act="seed-demo"><div class="t"><b>Cargar datos de ejemplo</b>' +
        '<small>Tres meses ficticios para probar. Mueve la fecha de inicio.</small></div>' + icon('layers') + '</button>') +
      '<button class="row danger" data-act="wipe"><div class="t"><b>Borrar todo</b>' +
      '<small>Sesiones, pesos y logros. Se guarda una copia automática antes.</small></div>' + icon('trash') + '</button>' +
      '</div>';

    html += '<div class="card tight">' +
      '<div class="muted" style="font-size:12.5px;line-height:1.7">' +
      'GymLog · versión 2.0<br>' +
      'Almacenamiento: <b>' + (GL.store.storageMode === 'indexeddb' ? 'IndexedDB' : 'localStorage (respaldo)') + '</b><br>' +
      'Persistente: <b>' + (GL.store.persisted === true ? 'sí' : GL.store.persisted === false ? 'no concedido' : 'no disponible') + '</b><br>' +
      '<span id="storage-estimate">Calculando espacio…</span>' +
      '</div></div>';

    function mount() {
      GL.store.estimate().then(function (e) {
        var n = document.getElementById('storage-estimate');
        if (!n) return;
        n.textContent = e && e.usage != null
          ? 'Espacio usado: ' + (e.usage / 1024).toFixed(1) + ' KB'
          : 'Espacio usado: no disponible';
      })['catch'](function () { });
    }

    return { html: html, mount: mount };
  }

  GL.views = {
    home: home, calendar: calendar, history: history, progress: progress,
    coach: coachScreen, settings: settings,
    entryCard: entryCard, fmtWeight: fmtWeight, fmtCm: fmtCm, fmtAvg: fmtAvg, fmtPct: fmtPct, dec: dec,
    statusPill: statusPill, tile: tile, weekDots: weekDots, sectionTitle: sectionTitle,
    goalRing: goalRing, typeValue: typeValue, NONE: NONE
  };
})(window.GL = window.GL || {});
