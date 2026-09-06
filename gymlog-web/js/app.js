/* =========================================================================
   app.js — Arranque, navegación, formularios y acciones.
   ========================================================================= */
(function (GL) {
  'use strict';

  var S = GL.stats, U = GL.ui, store = GL.store;
  var esc = U.esc, icon = U.icon;

  var VIEWS = [
    { id: 'home', label: 'Inicio', icon: 'home', title: 'Inicio' },
    { id: 'calendar', label: 'Calendario', icon: 'calendar', title: 'Calendario' },
    { id: 'progress', label: 'Progreso', icon: 'progress', title: 'Progreso' },
    { id: 'history', label: 'Historial', icon: 'history', title: 'Historial' }
  ];

  var state = {
    view: 'home',
    month: S.monthKey(S.today()),
    selected: null,
    filter: '3m',
    sort: 'new',
    progressTab: 'resumen',
    heatYear: null,          // null = el año con datos más reciente
    histMode: 'all',
    query: '',
    measureField: null
  };

  var bootTheme = null;
  var cloudUser = null; // { email, id } o null si no hay sesión
  var authEmail = '';
  var authMode = 'signin';        // signin | signup — nunca se crea una cuenta sin pedirlo
  var dayTickTimer = null;

  /* ------------------------------------------------------------ contexto */
  function ctx() {
    var workouts = store.workouts();
    var settings = store.settings();
    return {
      state: state,
      settings: settings,
      workouts: workouts,
      weights: store.weights(),
      measurements: store.measurements(),
      byDate: S.index(workouts),
      unlocked: store.achievements(),
      today: S.today(),
      start: settings.startDate,
      win: settings.backfillDays,
      eff: S.effectiveStart(settings.startDate, workouts),
      hasDemo: store.hasDemo(),
      cloud: cloudUser,
      coach: settings.coach,
      coachState: coachState,
      coachMin: COACH_MIN_WORKOUTS,
      syncAge: settings.lastSync
        ? Math.max(0, Math.floor((Date.now() - new Date(settings.lastSync).getTime()) / 86400000))
        : null,
      backupAge: settings.lastExport
        ? Math.max(0, Math.floor((Date.now() - new Date(settings.lastExport).getTime()) / 86400000))
        : null
    };
  }

  /* --------------------------------------------------------------- tema */
  function applyTheme(theme) {
    var root = document.documentElement;
    if (theme === 'auto') {
      if (bootTheme) root.setAttribute('data-theme', bootTheme);
      else root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
    setTimeout(function () {
      var meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) return;
      var bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      if (bg) meta.setAttribute('content', bg);
    }, 0);
  }

  /* ---------------------------------------------------------- navegación */
  function go(view) {
    if (state.view === view) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    state.view = view;
    render();
    window.scrollTo({ top: 0 });
  }

  function render(keepFocus) {
    /* Estando en la pantalla de acceso no hay shell que pintar. Una subida en
       segundo plano puede terminar justo después de cerrar sesión y llamar
       aquí: sin esta guarda, revienta. */
    var main = document.getElementById('main');
    if (!main) return;

    var c = ctx();
    var def = VIEWS.find(function (v) { return v.id === state.view; });
    var out = state.view === 'settings' ? GL.views.settings(c) : GL.views[state.view](c);

    main.innerHTML = '<div class="screen">' + out.html + '</div>';

    document.getElementById('topbar-title').textContent =
      state.view === 'settings' ? 'Ajustes' : (def ? def.title : '');
    document.getElementById('topbar-back').classList.toggle('hidden', state.view !== 'settings');
    document.getElementById('topbar-settings').classList.toggle('hidden', state.view === 'settings');

    Array.prototype.forEach.call(document.querySelectorAll('[data-tab-id]'), function (el) {
      el.classList.toggle('is-active', el.getAttribute('data-tab-id') === state.view);
    });

    document.getElementById('fab').classList.toggle('hidden', state.view === 'home' || state.view === 'settings');

    if (out.mount) out.mount();

    if (keepFocus) {
      var el = document.getElementById(keepFocus);
      if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) { } }
    }
    syncAchievements(false);
  }

  /* ------------------------------------------------------------- logros */
  function achievementExtras(c) {
    return { weights: c.weights.length, measurements: c.measurements.length, goal: c.settings.goal, win: c.settings.backfillDays };
  }

  function syncAchievements(announce) {
    var c = ctx();
    var ev = GL.achievements.evaluate(c.workouts, c.settings.gymDays, c.unlocked, c.today, c.start, achievementExtras(c));
    if (JSON.stringify(ev.unlocked) !== JSON.stringify(c.unlocked)) store.saveAchievements(ev.unlocked);
    if (announce && ev.fresh.length) {
      ev.fresh.forEach(function (a, i) {
        setTimeout(function () { U.toast('Logro: ' + a.title, 'ok'); }, 500 + i * 800);
      });
    }
  }

  /* ================================================== FORMULARIO REGISTRO */
  function ratingRow(name, value) {
    var out = '<div class="rating" data-rating="' + name + '">';
    for (var i = 1; i <= 5; i++) {
      out += '<button type="button" data-val="' + i + '"' + (i <= value ? ' class="on"' : '') +
        ' aria-label="' + i + ' de 5">' + i + '</button>';
    }
    return out + '</div>';
  }

  var QUICK = [45, 60, 75, 90];

  function blank(c) {
    var t = S.typicalWorkout(c.workouts);
    return {
      id: null, date: c.today, went: true, duration: t.duration,
      energy: t.energy, feeling: t.feeling, difficulty: t.difficulty,
      type: null, weight: null, notes: ''
    };
  }

  function openForm(date, id) {
    var c = ctx();
    var existing = id ? c.workouts.find(function (w) { return w.id === id; }) : c.byDate[date];
    var f = existing ? {
      id: existing.id, date: existing.date, went: existing.went,
      duration: existing.duration || 60,
      energy: existing.energy || 4, feeling: existing.feeling || 4, difficulty: existing.difficulty || 3,
      type: existing.type || null,
      weight: existing.weight, notes: existing.notes || ''
    } : Object.assign(blank(c), { date: date || c.today });

    /* La ventana solo limita crear registros nuevos del pasado; si ya existe
       uno más antiguo, se sigue pudiendo editar. */
    var minDate = S.addDays(c.today, -c.win);
    if (existing && S.daysBetween(existing.date, minDate) > 0) minDate = existing.date;

    function body() {
      var hours = Math.floor(f.duration / 60), mins = f.duration % 60;
      var days = c.win;
      return '' +
        '<div class="field"><label for="f-date">Fecha</label>' +
        '<input class="input" type="date" id="f-date" value="' + f.date + '" min="' + minDate +
        '" max="' + S.addDays(c.today, 1) + '">' +
        (days > 0
          ? '<span class="hint">Puedes registrar hasta ' + days + ' días atrás' +
          (f.date !== c.today ? ' · ' + esc(S.formatLong(f.date)) : '') + '.</span>'
          : '<span class="hint">Solo se puede registrar el día de hoy.</span>') +
        '</div>' +

        '<div id="f-exists"></div>' +

        '<div class="field"><label>¿Fui al gimnasio?</label>' +
        '<div class="toggle2">' +
        '<button type="button" data-went="1"' + (f.went ? ' class="on-yes"' : '') + '>' + icon('check') + 'Sí</button>' +
        '<button type="button" data-went="0"' + (!f.went ? ' class="on-no"' : '') + '>' + icon('close') + 'No</button>' +
        '</div></div>' +

        '<div id="f-went"' + (f.went ? '' : ' class="hidden"') + ' style="display:flex;flex-direction:column;gap:16px">' +

        '<div class="field"><label for="f-h">Duración</label>' +
        '<div class="duration-row">' +
        '<span class="unit"><input class="input" type="number" inputmode="numeric" id="f-h" min="0" max="9" value="' + hours + '"><span>h</span></span>' +
        '<span class="unit"><input class="input" type="number" inputmode="numeric" id="f-m" min="0" max="59" value="' + mins + '"><span>min</span></span>' +
        '</div>' +
        '<div class="quick">' + QUICK.map(function (q) {
          var h = Math.floor(q / 60), m = q % 60;
          var short = h ? (m ? h + 'h' + m : h + 'h') : m + 'm';
          return '<button type="button" data-quick="' + q + '"' + (f.duration === q ? ' class="is-active"' : '') + '>' +
            short + '</button>';
        }).join('') + '</div></div>' +

        '<div class="field"><label>Energía <span class="rating-out">' + f.energy + '/5</span></label>' + ratingRow('energy', f.energy) + '</div>' +
        '<div class="field"><label>¿Cómo me sentí? <span class="rating-out">' + f.feeling + '/5</span></label>' + ratingRow('feeling', f.feeling) + '</div>' +
        '<div class="field"><label>Dificultad <span class="rating-out">' + f.difficulty + '/5</span></label>' + ratingRow('difficulty', f.difficulty) + '</div>' +

        '<div class="field"><label>Tipo de entreno <span class="hint">opcional</span></label>' +
        '<div class="optiongrid" id="f-type">' +
        GL.store.WORKOUT_TYPES.map(function (t) {
          return '<button type="button" data-type="' + t.key + '"' +
            (f.type === t.key ? ' class="is-active"' : '') + '>' + esc(t.label) + '</button>';
        }).join('') + '</div></div>' +

        '<div class="field"><label for="f-w">Peso corporal <span class="hint">opcional</span></label>' +
        '<span style="position:relative;display:block">' +
        '<input class="input" type="number" inputmode="decimal" step="0.1" id="f-w" placeholder="—" value="' +
        (f.weight != null ? f.weight : '') + '">' +
        '<span style="position:absolute;right:13px;top:50%;transform:translateY(-50%);font-family:var(--font-cond);font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text-muted);pointer-events:none">' +
        esc(c.settings.units) + '</span></span></div>' +

        '</div>' +

        '<div class="field"><label for="f-n">Notas <span class="hint">opcional</span></label>' +
        '<textarea class="input" id="f-n" placeholder="Cómo fue, qué tal te sentiste…">' + esc(f.notes) + '</textarea></div>';
    }

    U.openSheet({
      title: existing ? 'Editar sesión' : 'Registrar sesión',
      body: body(),
      footer: '<button class="btn primary block" id="f-save">' + icon('check') + 'Guardar</button>',
      onMount: function (sheet) {
        var $ = function (sel) { return sheet.querySelector(sel); };

        function refreshExists() {
          var other = ctx().byDate[f.date];
          var box = $('#f-exists');
          box.innerHTML = (other && other.id !== f.id)
            ? '<div class="callout is-flat" style="padding:11px 13px">' + icon('info') +
            '<div><h3 style="font-size:13.5px">Ya hay un registro este día</h3>' +
            '<p style="font-size:12.5px">Al guardar se sustituirá.</p></div></div>'
            : '';
        }
        refreshExists();

        function loadFor(date) {
          var w = ctx().byDate[date];
          if (w) {
            f = {
              id: w.id, date: date, went: w.went, duration: w.duration || 60,
              energy: w.energy || 4, feeling: w.feeling || 4, difficulty: w.difficulty || 3,
              type: w.type || null,
              weight: w.weight, notes: w.notes || ''
            };
          } else { f.id = null; f.date = date; }
          $('.sheet-body').innerHTML = body();
          bind(); refreshExists();
        }

        function setRating(name, val) {
          f[name] = val;
          var row = sheet.querySelector('[data-rating="' + name + '"]');
          Array.prototype.forEach.call(row.children, function (b, i) { b.classList.toggle('on', i < val); });
          row.previousElementSibling.querySelector('.rating-out').textContent = val + '/5';
        }

        function readDuration() {
          var h = Math.max(0, Math.min(9, parseInt($('#f-h').value, 10) || 0));
          var m = Math.max(0, Math.min(59, parseInt($('#f-m').value, 10) || 0));
          f.duration = h * 60 + m;
          Array.prototype.forEach.call(sheet.querySelectorAll('[data-quick]'), function (b) {
            b.classList.toggle('is-active', Number(b.getAttribute('data-quick')) === f.duration);
          });
        }

        function bind() {
          $('#f-date').addEventListener('change', function () { if (this.value) loadFor(this.value); });

          Array.prototype.forEach.call(sheet.querySelectorAll('[data-went]'), function (b) {
            b.addEventListener('click', function () {
              f.went = b.getAttribute('data-went') === '1';
              sheet.querySelector('[data-went="1"]').className = f.went ? 'on-yes' : '';
              sheet.querySelector('[data-went="0"]').className = !f.went ? 'on-no' : '';
              $('#f-went').classList.toggle('hidden', !f.went);
            });
          });

          Array.prototype.forEach.call(sheet.querySelectorAll('[data-rating]'), function (row) {
            row.addEventListener('click', function (e) {
              var b = e.target.closest('[data-val]');
              if (b) setRating(row.getAttribute('data-rating'), Number(b.getAttribute('data-val')));
            });
          });

          Array.prototype.forEach.call(sheet.querySelectorAll('[data-quick]'), function (b) {
            b.addEventListener('click', function () {
              f.duration = Number(b.getAttribute('data-quick'));
              $('#f-h').value = Math.floor(f.duration / 60);
              $('#f-m').value = f.duration % 60;
              readDuration();
            });
          });

          /* Tipo de entreno: es opcional, así que volver a tocar el que ya
             está elegido lo quita. */
          $('#f-type').addEventListener('click', function (e) {
            var b = e.target.closest('[data-type]');
            if (!b) return;
            var key = b.getAttribute('data-type');
            f.type = (f.type === key) ? null : key;
            Array.prototype.forEach.call(this.children, function (x) {
              x.classList.toggle('is-active', x.getAttribute('data-type') === f.type);
            });
          });

          ['#f-h', '#f-m'].forEach(function (sel) { $(sel).addEventListener('input', readDuration); });
        }
        bind();

        $('#f-save').addEventListener('click', function () {
          readDuration();
          var chosen = $('#f-date').value || f.date;
          if (!f.id && !S.canLog(chosen, c.today, c.win)) {
            U.toast('Ese día ya está fuera de plazo', 'error');
            return;
          }
          save({
            id: f.id, date: $('#f-date').value || f.date, went: f.went,
            duration: f.duration, energy: f.energy, feeling: f.feeling, difficulty: f.difficulty,
            type: f.type,
            weight: f.went && $('#f-w') ? $('#f-w').value : null,
            notes: $('#f-n').value
          });
        });
      }
    });
  }

  /* guarda y avisa si hay récord nuevo */
  function save(payload) {
    if (!payload.date) { U.toast('Elige una fecha', 'error'); return; }
    var c = ctx();
    var beforeStreak = S.streaks(c.workouts, c.settings.gymDays, c.today, c.start, c.win).best;

    store.saveWorkout(payload).then(function (rec) {
      U.closeSheet();
      state.selected = rec.date;
      state.month = S.monthKey(rec.date);
      render();

      var after = ctx();
      var st = S.streaks(after.workouts, after.settings.gymDays, after.today, after.start, after.win);
      if (payload.went && st.current > beforeStreak && st.current >= 3) {
        U.toast('Récord: ' + st.current + ' seguidas', 'ok');
      } else {
        U.toast(payload.went ? 'Sesión guardada' : 'Marcado como «no fui»', 'ok');
      }
      syncAchievements(true);
    })['catch'](function (err) { U.toast('No se pudo guardar: ' + err.message, 'error'); });
  }

  function quickLog() {
    var c = ctx();
    var t = S.typicalWorkout(c.workouts);
    save({
      id: null, date: c.today, went: true, duration: t.duration,
      energy: t.energy, feeling: t.feeling, difficulty: t.difficulty, weight: null, notes: ''
    });
  }

  /* ------------------------------------------------------ detalle / borrar */
  function openDetail(id) {
    var c = ctx();
    var w = c.workouts.find(function (x) { return x.id === id; });
    if (!w) return;
    var V = GL.views;

    U.openSheet({
      title: S.formatLong(w.date),
      body:
        '<div style="display:flex;align-items:center;gap:8px">' +
        V.statusPill(w.went ? 'done' : 'missed') +
        (w.demo ? '<span class="pill demo">ejemplo</span>' : '') + '</div>' +
        (w.went
          ? '<div class="tiles three">' +
          V.tile('Duración', S.formatDuration(w.duration)) +
          V.tile('Energía', w.energy + '<small>/5</small>') +
          V.tile('Sensación', w.feeling + '<small>/5</small>') +
          '</div>' +
          '<div class="tiles three">' +
          V.tile('Dificultad', w.difficulty + '<small>/5</small>') +
          V.tile('Peso', w.weight != null ? V.fmtWeight(w.weight, c.settings.units) : V.NONE) +
          V.tile('Tipo', V.typeValue(w.type)) +
          '</div>'
          : '') +
        (w.notes
          ? '<div><span class="eyebrow">Notas</span>' +
          '<p style="margin:8px 0 0;font-size:15px;line-height:1.6;color:var(--text-dim)">' + esc(w.notes) + '</p></div>'
          : '<p class="muted" style="margin:0;font-size:13.5px">Sin notas para este día.</p>'),
      footer:
        '<div class="btn-row">' +
        '<button class="btn danger" data-act="delete" data-id="' + esc(w.id) + '">' + icon('trash') + 'Eliminar</button>' +
        '<button class="btn primary" data-act="log" data-date="' + w.date + '" data-id="' + esc(w.id) + '">' + icon('edit') + 'Editar</button>' +
        '</div>'
    });
  }

  /* eliminar con deshacer: nada de diálogos para algo reversible */
  function deleteWorkout(id) {
    var w = store.workouts().find(function (x) { return x.id === id; });
    if (!w) return;
    var copy = Object.assign({}, w);
    store.deleteWorkout(id).then(function () {
      render();
      U.toast('Sesión eliminada', null, {
        label: 'Deshacer',
        action: function () {
          store.saveWorkout({
            id: null, date: copy.date, went: copy.went, duration: copy.duration,
            energy: copy.energy, feeling: copy.feeling, difficulty: copy.difficulty,
            type: copy.type, weight: copy.weight, notes: copy.notes, demo: copy.demo
          }).then(function () { render(); U.toast('Recuperada', 'ok'); });
        }
      });
    });
  }

  /* --------------------------------------------------------------- peso */
  function openWeightForm(id) {
    var c = ctx();
    var series = S.weightSeries(c.weights);
    var current = id ? series.find(function (x) { return x.id === id; }) : null;
    var fromWorkout = current && current.src === 'workout';

    U.openSheet({
      title: current ? 'Editar medición' : 'Nueva medición',
      body:
        (fromWorkout ? '<div class="callout is-flat" style="padding:11px 13px">' + icon('info') +
          '<div><h3 style="font-size:13.5px">Viene de una sesión</h3>' +
          '<p style="font-size:12.5px">Al guardar aquí se crea una medición independiente.</p></div></div>' : '') +
        '<div class="field"><label for="w-date">Fecha</label>' +
        '<input class="input" type="date" id="w-date" value="' + (current ? current.date : c.today) + '"></div>' +
        '<div class="field"><label for="w-val">Peso (' + esc(c.settings.units) + ')</label>' +
        '<input class="input" type="number" inputmode="decimal" step="0.1" id="w-val" placeholder="74.5" value="' +
        (current ? current.value : '') + '"></div>',
      footer: '<button class="btn primary block" id="w-save">' + icon('check') + 'Guardar</button>',
      onMount: function (sheet) {
        setTimeout(function () { var i = sheet.querySelector('#w-val'); if (i && !current) i.focus(); }, 320);
        sheet.querySelector('#w-save').addEventListener('click', function () {
          var date = sheet.querySelector('#w-date').value;
          var val = parseFloat(sheet.querySelector('#w-val').value);
          if (!date) { U.toast('Elige una fecha', 'error'); return; }
          if (!(val > 0)) { U.toast('Escribe un peso válido', 'error'); return; }
          store.saveWeight({
            id: (current && current.src === 'manual') ? current.id : null, date: date, value: val
          }).then(function () { U.closeSheet(); render(); U.toast('Medición guardada', 'ok'); });
        });
      }
    });
  }

  function deleteWeight(id) {
    var rec = S.weightSeries(store.weights()).find(function (x) { return x.id === id; });
    store.deleteWeight(id).then(function () {
      render();
      U.toast('Medición eliminada', null, rec && rec.src === 'manual' ? {
        label: 'Deshacer',
        action: function () {
          store.saveWeight({ id: null, date: rec.date, value: rec.value })
            .then(function () { render(); U.toast('Recuperada', 'ok'); });
        }
      } : null);
    });
  }

  /* ------------------------------------------------------------- medidas
     Bíceps, gemelos y muslo llevan lado izquierdo/derecho; pecho y cintura,
     un solo valor. Todo opcional: se puede guardar con una sola medida
     escrita. Un registro por fecha, igual que un entrenamiento. */
  function openMeasureForm(id) {
    var c = ctx();
    var current = id ? c.measurements.find(function (x) { return x.id === id; }) : null;
    var F = S.MEASURE_FIELDS;

    var fieldsHtml = F.map(function (f) {
      if (f.paired) {
        var lz = (current && current[f.key + 'Izq'] != null) ? current[f.key + 'Izq'] : '';
        var dr = (current && current[f.key + 'Der'] != null) ? current[f.key + 'Der'] : '';
        return '<div class="field"><label>' + esc(f.label) + ' (cm) <span class="hint">opcional</span></label>' +
          '<div class="pair">' +
          '<input class="input" type="number" inputmode="decimal" step="0.1" id="m-' + f.key + '-izq" placeholder="Izq." value="' + lz + '">' +
          '<input class="input" type="number" inputmode="decimal" step="0.1" id="m-' + f.key + '-der" placeholder="Der." value="' + dr + '">' +
          '</div></div>';
      }
      var v = (current && current[f.key] != null) ? current[f.key] : '';
      return '<div class="field"><label for="m-' + f.key + '">' + esc(f.label) + ' (cm) <span class="hint">opcional</span></label>' +
        '<input class="input" type="number" inputmode="decimal" step="0.1" id="m-' + f.key + '" placeholder="0.0" value="' + v + '"></div>';
    }).join('');

    U.openSheet({
      title: current ? 'Editar medidas' : 'Nuevas medidas',
      body:
        '<div class="field"><label for="m-date">Fecha</label>' +
        '<input class="input" type="date" id="m-date" value="' + (current ? current.date : c.today) + '"></div>' +
        fieldsHtml,
      footer: '<button class="btn primary block" id="m-save">' + icon('check') + 'Guardar</button>',
      onMount: function (sheet) {
        sheet.querySelector('#m-save').addEventListener('click', function () {
          var date = sheet.querySelector('#m-date').value;
          if (!date) { U.toast('Elige una fecha', 'error'); return; }
          var data = { id: current ? current.id : null, date: date };
          var any = false;
          F.forEach(function (f) {
            if (f.paired) {
              var lz = sheet.querySelector('#m-' + f.key + '-izq').value;
              var dr = sheet.querySelector('#m-' + f.key + '-der').value;
              data[f.key + 'Izq'] = lz; data[f.key + 'Der'] = dr;
              if (lz !== '' || dr !== '') any = true;
            } else {
              var v = sheet.querySelector('#m-' + f.key).value;
              data[f.key] = v;
              if (v !== '') any = true;
            }
          });
          if (!any) { U.toast('Escribe al menos una medida', 'error'); return; }
          store.saveMeasurement(data).then(function () {
            U.closeSheet(); render(); syncAchievements(true); U.toast('Medidas guardadas', 'ok');
          });
        });
      }
    });
  }

  function deleteMeasurement(id) {
    var rec = store.measurements().find(function (x) { return x.id === id; });
    store.deleteMeasurement(id).then(function () {
      render();
      U.toast('Medidas eliminadas', null, rec ? {
        label: 'Deshacer',
        action: function () {
          store.saveMeasurement(rec).then(function () { render(); U.toast('Recuperadas', 'ok'); });
        }
      } : null);
    });
  }

  /* ------------------------------------------------------------ objetivo */
  function openGoal() {
    var c = ctx();
    var suggested = Math.round(c.settings.gymDays.length * 4.33);
    U.openSheet({
      title: 'Objetivo mensual',
      body: '<p style="margin:0;font-size:14px;color:var(--text-dim)">Cuántas sesiones quieres hacer al mes. ' +
        'Con ' + c.settings.gymDays.length + ' días programados salen unas <b>' + suggested + '</b>.</p>' +
        '<div class="field"><label for="g-val">Sesiones al mes</label>' +
        '<input class="input" type="number" id="g-val" min="1" max="31" value="' + c.settings.goal + '"></div>',
      footer: '<button class="btn primary block" id="g-save">' + icon('check') + 'Guardar</button>',
      onMount: function (sheet) {
        sheet.querySelector('#g-save').addEventListener('click', function () {
          var v = parseInt(sheet.querySelector('#g-val').value, 10);
          if (!(v >= 1 && v <= 31)) { U.toast('Escribe un número entre 1 y 31', 'error'); return; }
          store.saveSettings({ goal: v }).then(function () {
            U.closeSheet(); render(); U.toast('Objetivo actualizado', 'ok');
          });
        });
      }
    });
  }

  /* ------------------------------------------------- guardado de archivos */
  var saver = null;
  function probeSaver() {
    try {
      if (window.claude && typeof window.claude.use === 'function') {
        window.claude.use('downloads').then(function (d) { saver = d || null; })['catch'](function () { saver = null; });
      }
    } catch (e) { saver = null; }
  }

  function blobDownload(name, blob) {
    try {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      U.toast('Archivo generado', 'ok');
      return true;
    } catch (e) {
      U.toast('El navegador bloqueó la descarga', 'error');
      return false;
    }
  }

  /* En el iPhone la hoja de compartir es mucho más útil que una descarga. */
  function canShareFiles(file) {
    return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
  }

  function deliverFile(name, blob, type) {
    var file = null;
    try { file = new File([blob], name, { type: type }); } catch (e) { }
    if (file && canShareFiles(file)) {
      return navigator.share({ files: [file] })
        .then(function () { return 'shared'; })
        ['catch'](function (err) {
          if (err && err.name === 'AbortError') return 'cancel';
          return saveFallback(name, blob);
        });
    }
    return Promise.resolve(saveFallback(name, blob));
  }

  function saveFallback(name, blob) {
    if (saver) {
      return blob.arrayBuffer().then(function (buf) {
        return saver.save({ filename: name, data: buf });
      }).then(function () { U.toast('Guardado', 'ok'); return 'saved'; })
        ['catch'](function (err) {
          if (err && (err.code === 'declined' || err.code === 'rate_limited')) return 'cancel';
          blobDownload(name, blob); return 'download';
        });
    }
    blobDownload(name, blob);
    return 'download';
  }

  /* ------------------------------------------------- exportar / importar
     La cuenta en la nube ya guarda todo sola. Esto es el respaldo manual,
     para quien quiera tener el archivo en su poder. */
  function openExport() {
    var json = JSON.stringify(store.exportData(), null, 2);
    var c = ctx();
    var name = 'gymlog-' + S.today() + '.json';

    U.openSheet({
      title: 'Exportar',
      body:
        '<p style="margin:0;font-size:14px;color:var(--text-dim)">' + c.workouts.length +
        (c.workouts.length === 1 ? ' registro' : ' registros') + ' y ' + c.weights.length +
        ' mediciones. Guardalo en Archivos, iCloud o donde prefieras.</p>' +
        '<div class="btn-row">' +
        '<button class="btn primary" id="x-share">' + icon('share') + 'Guardar</button>' +
        '<button class="btn ghost" id="x-copy">Copiar</button>' +
        '</div>' +
        '<div class="field"><label for="x-text">Copia en texto</label>' +
        '<textarea class="input" id="x-text" readonly style="min-height:140px;font-size:11.5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">' +
        esc(json) + '</textarea>' +
        '<span class="hint">Si el guardado no funciona en tu navegador, copiá este texto y pegalo en una nota.</span></div>',
      onMount: function (sheet) {
        sheet.querySelector('#x-share').addEventListener('click', function () {
          deliverFile(name, new Blob([json], { type: 'application/json' }), 'application/json')
            .then(function (r) { if (r !== 'cancel') store.markExported().then(function () { render(); }); });
        });
        sheet.querySelector('#x-copy').addEventListener('click', function () {
          var ta = sheet.querySelector('#x-text');
          var done = function () { U.toast('Copiado', 'ok'); store.markExported(); };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(json).then(done)['catch'](function () {
              ta.select(); document.execCommand('copy'); done();
            });
          } else { ta.select(); document.execCommand('copy'); done(); }
        });
      }
    });
  }

  function openImport() {
    U.openSheet({
      title: 'Importar',
      body:
        '<div class="callout is-flat" style="padding:12px 14px">' + icon('info') +
        '<div><h3 style="font-size:13.5px">Elegí el modo</h3>' +
        '<p style="font-size:12.5px">«Reemplazar» borra lo actual (se guarda una copia antes). «Combinar» añade.</p>' +
        '</div></div>' +
        '<div class="field"><label>Modo</label><div class="segmented" id="i-mode">' +
        '<button type="button" data-mode="replace" class="is-active">Reemplazar</button>' +
        '<button type="button" data-mode="merge">Combinar</button>' +
        '</div></div>' +
        '<div class="field"><label>Desde un archivo</label>' +
        '<input class="input" type="file" id="i-file" accept="application/json,.json"></div>' +
        '<div class="field"><label for="i-text">O pegá el texto</label>' +
        '<textarea class="input" id="i-text" placeholder=\'{"app":"gymlog", …}\' style="min-height:110px;font-size:11.5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace"></textarea></div>',
      footer: '<button class="btn primary block" id="i-go">' + icon('upload') + 'Importar</button>',
      onMount: function (sheet) {
        var mode = 'replace';
        sheet.querySelector('#i-mode').addEventListener('click', function (e) {
          var b = e.target.closest('[data-mode]');
          if (!b) return;
          mode = b.getAttribute('data-mode');
          Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('is-active', x === b); });
        });

        function run(text) {
          var payload;
          try { payload = JSON.parse(text); }
          catch (e) { U.toast('El texto no es un JSON válido', 'error'); return; }
          /* importData está envuelto por el auto-sync, así que lo importado
             sube solo a la cuenta. */
          store.importData(payload, mode).then(function (r) {
            U.closeSheet();
            state.month = S.monthKey(S.today());
            applyTheme(store.settings().theme);
            render();
            U.toast('Importados ' + r.workouts + ' registros', 'ok');
            syncAchievements(false);
          })['catch'](function (err) { U.toast(err.message, 'error'); });
        }

        sheet.querySelector('#i-go').addEventListener('click', function () {
          var file = sheet.querySelector('#i-file').files[0];
          var text = sheet.querySelector('#i-text').value.trim();
          if (file) {
            var fr = new FileReader();
            fr.onload = function () { run(String(fr.result)); };
            fr.onerror = function () { U.toast('No se pudo leer el archivo', 'error'); };
            fr.readAsText(file);
          } else if (text) run(text);
          else U.toast('Elegí un archivo o pegá el texto', 'error');
        });
      }
    });
  }

  /* ------------------------------------------------- exportar / importar */
  /* ------------------------------------------------------- nube (Supabase)
     El login es obligatorio: sin sesión no hay app, solo la pantalla de
     acceso. Los datos viven en la cuenta, no en "este dispositivo": cada
     cambio se sube solo, en segundo plano. */
  function refreshCloudSession() {
    if (!GL.cloud || !GL.cloud.ready()) { cloudUser = null; return Promise.resolve(null); }
    return GL.cloud.session().then(function (sess) {
      cloudUser = sess ? { email: sess.user.email, id: sess.user.id } : null;
      return cloudUser;
    })['catch'](function () { cloudUser = null; return null; });
  }

  function pushSilently() {
    if (!cloudUser) return Promise.resolve();
    return GL.cloud.push(store.exportData()).then(function () {
      /* rawStore, NO store: anotar la hora de la última subida es contabilidad
         interna, no un cambio hecho por la persona. Pasando por la versión
         envuelta programaría otra subida, que volvería a anotar la hora, que
         programaría otra subida… un ciclo infinito cada 1,5 s. */
      return rawStore.saveSettings({ lastSync: new Date().toISOString() });
    })['catch'](function () { /* sin conexión: se reintenta en el próximo cambio */ });
  }

  var syncTimer = null;
  function scheduleSync() {
    if (!cloudUser) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      pushSilently().then(function () {
        /* Una subida en segundo plano no cambia nada de lo que se ve, salvo la
           hora de «última sincronización» de Ajustes. Repintar la pantalla
           entera en cada ciclo reproducía la animación de entrada y parecía
           que la app se recargaba sola. */
        if (state.view === 'settings') render();
      });
    }, 1500);
  }

  /* Envuelve los métodos que cambian datos para subirlos solos a la nube,
     sin tocar cada punto donde se llaman. rawStore guarda los originales para
     los cambios internos, que no deben disparar una subida. */
  var rawStore = {};
  var AUTOSYNC_METHODS = ['saveWorkout', 'deleteWorkout', 'saveWeight', 'deleteWeight',
    'saveMeasurement', 'deleteMeasurement', 'saveSettings', 'saveAchievements',
    'clearAll', 'importData', 'seedDemo', 'clearDemo'];
  function wrapStoreForAutoSync() {
    AUTOSYNC_METHODS.forEach(function (name) {
      var orig = store[name];
      rawStore[name] = function () { return orig.apply(store, arguments); };
      store[name] = function () {
        var r = orig.apply(store, arguments);
        if (r && typeof r.then === 'function') r.then(scheduleSync, function () { }); else scheduleSync();
        return r;
      };
    });
  }

  /* --------------------------------------------------- entrenador con IA
     Una consulta por día como mucho: el plan gratis de Gemini tiene cuota, y
     el consejo no cambia tanto como para pedirlo en cada apertura. El
     resultado se guarda en settings, así que además viaja a la cuenta y los
     otros dispositivos lo leen sin volver a llamar. */
  var COACH_MIN_WORKOUTS = 3;
  var coachState = { loading: false, error: null };

  function coachEligible() {
    return !!cloudUser && S.done(store.workouts()).length >= COACH_MIN_WORKOUTS;
  }

  function coachNeedsRefresh() {
    var c = store.settings().coach;
    return !c || c.date !== S.today();
  }

  /* Solo lo que la función necesita: ni pesos corporales ni ids. */
  function coachPayload() {
    return S.done(store.workouts()).slice(0, 30).map(function (w) {
      return {
        date: w.date, type: w.type || null,
        energy: w.energy, feeling: w.feeling, difficulty: w.difficulty,
        duration: w.duration, notes: w.notes || ''
      };
    });
  }

  function fetchCoach(force) {
    if (coachState.loading) return Promise.resolve();
    if (!coachEligible()) return Promise.resolve();
    if (!force && !coachNeedsRefresh()) return Promise.resolve();

    coachState.loading = true;
    coachState.error = null;
    render();

    return GL.cloud.coach(coachPayload(), S.today())
      .then(function (data) {
        coachState.loading = false;
        return store.saveSettings({
          coach: {
            date: S.today(),
            recomendacion: data.recomendacion || '',
            consejo: data.consejo || ''
          }
        });
      })
      .then(function () { render(); })
      ['catch'](function (err) {
        coachState.loading = false;
        coachState.error = err && err.message ? err.message : 'No se pudo consultar la IA.';
        render();
      });
  }

  function cloudSync() {
    if (!cloudUser) return;
    U.toast('Sincronizando…');
    pushSilently().then(function () { render(); U.toast('Copia subida a la nube', 'ok'); });
  }

  /* Trae lo que haya en la nube y lo combina con lo local. Si la cuenta que
     inicia sesión es distinta a la última usada en este dispositivo, se
     limpia todo antes: así una cuenta nunca ve los datos de otra. */
  function resolveAccountData() {
    var lastId = GL.cloud.lastUserId();
    var switched = lastId && lastId !== cloudUser.id;
    var wipe = switched ? store.clearAll(true) : Promise.resolve();
    return wipe.then(function () { return GL.cloud.pull(); })
      .then(function (row) {
        if (row && row.payload) return store.importData(row.payload, 'merge');
      })
      .then(function () { GL.cloud.setLastUserId(cloudUser.id); return pushSilently(); })
      ['catch'](function () { GL.cloud.setLastUserId(cloudUser.id); });
  }

  /* --------------------------------------------------- pantalla de acceso
     Lo mínimo: email, contraseña, un botón. Un enlace abajo cambia entre crear
     cuenta y entrar a una que ya existe. */
  function renderAuth(mode, email) {
    if (email !== undefined) authEmail = email;
    if (mode) authMode = mode === 'signup' ? 'signup' : 'signin';
    var signup = authMode === 'signup';

    var app = document.getElementById('app');
    /* .app es flex (columna en móvil, fila en escritorio). En fila, un hijo sin
       ancho se encoge al contenido y la tarjeta queda pegada a la izquierda.
       Con esta clase, #app pasa a ser un bloque normal y el centrado depende
       solo de .authpage. */
    app.className = 'app is-auth';

    app.innerHTML =
      '<div class="authpage"><div class="authcard">' +
      '<div class="brand">' + icon('barbell') + '<b>GymLog</b></div>' +

      '<div class="field"><label for="au-email">Email</label>' +
      '<input class="input" type="email" id="au-email" autocomplete="email" ' +
      'placeholder="vos@email.com" value="' + esc(authEmail) + '"></div>' +

      '<div class="field"><label for="au-pass">Contraseña</label>' +
      '<input class="input" type="password" id="au-pass" ' +
      'autocomplete="' + (signup ? 'new-password' : 'current-password') + '" ' +
      'placeholder="' + (signup ? 'Mínimo 6 caracteres' : '••••••••') + '"></div>' +

      '<p class="autherror" id="au-error" role="alert" hidden></p>' +

      '<button class="btn primary block" data-act="auth-submit">' +
      (signup ? 'Crear cuenta' : 'Entrar') + '</button>' +

      '<p class="authswap">' + (signup ? '¿Ya tenés cuenta? ' : '¿No tenés cuenta? ') +
      '<button type="button" data-act="auth-mode" data-mode="' + (signup ? 'signin' : 'signup') + '">' +
      (signup ? 'Iniciar sesión' : 'Crear una') + '</button></p>' +

      '</div></div>' +
      /* U.toast() escribe en #toasts, que lo crea buildShell(). Acá todavía no
         existe, así que los errores van en línea dentro de la tarjeta. */
      '<div class="toast-wrap" id="toasts"></div>';

    setTimeout(function () {
      var first = document.getElementById(authEmail ? 'au-pass' : 'au-email');
      if (first) first.focus();
    }, 60);

    /* al escribir de nuevo, el error deja de tener sentido */
    Array.prototype.forEach.call(document.querySelectorAll('.authcard .input'), function (el) {
      el.addEventListener('input', function () { authError(''); });
    });

    /* Enter en cualquier campo envía el formulario. */
    Array.prototype.forEach.call(document.querySelectorAll('.authcard .input'), function (el) {
      el.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var go = document.querySelector('[data-act="auth-submit"]');
        if (go) go.click();
      });
    });
  }

  /* Mensaje de error dentro de la tarjeta de acceso. Cadena vacía = ocultar. */
  function authError(msg) {
    var el = document.getElementById('au-error');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  /* ------------------------------------------------------- encuesta inicial */
  function maybeOpenOnboarding(force) {
    if (!force && store.settings().onboarded) return;
    var s = store.settings();
    var dows = [{ i: 1, l: 'L' }, { i: 2, l: 'M' }, { i: 3, l: 'X' }, { i: 4, l: 'J' },
    { i: 5, l: 'V' }, { i: 6, l: 'S' }, { i: 0, l: 'D' }];
    var days = s.gymDays.slice();
    var goal = s.bodyGoal || 'ganar-musculo';
    var units = s.units || 'kg';

    U.openSheet({
      title: 'Antes de arrancar',
      body:
        '<p class="muted" style="margin:0 0 4px;font-size:13px">Unos datos rápidos de perfil. Se pueden cambiar después en Ajustes.</p>' +
        '<div class="field"><label for="ob-name">Nombre</label>' +
        '<input class="input" id="ob-name" maxlength="24" autocomplete="off" value="' + esc(s.name || '') + '"></div>' +
        '<div class="field"><label for="ob-age">Edad</label>' +
        '<input class="input" type="number" id="ob-age" min="10" max="100" inputmode="numeric"></div>' +
        '<div class="field"><label for="ob-weight">Peso en <span id="ob-weight-unit">' + esc(units) + '</span></label>' +
        '<input class="input" type="number" id="ob-weight" min="1" step="0.1" inputmode="decimal"></div>' +
        '<div class="field"><label for="ob-height">Altura en cm</label>' +
        '<input class="input" type="number" id="ob-height" min="100" max="250" inputmode="numeric"></div>' +
        '<div class="field"><label>Objetivo</label><div class="optiongrid" id="ob-goal">' +
        GL.store.BODY_GOALS.map(function (g) {
          return '<button type="button" data-goal="' + g.key + '"' + (goal === g.key ? ' class="is-active"' : '') + '>' + esc(g.label) + '</button>';
        }).join('') + '</div></div>' +
        '<div class="field"><label>Días de entreno</label>' +
        '<div class="daypick" id="ob-days">' + dows.map(function (d) {
          return '<button type="button" data-day="' + d.i + '"' + (days.indexOf(d.i) >= 0 ? ' class="on"' : '') +
            ' aria-label="' + S.DAY_NAMES[d.i] + '" aria-pressed="' + (days.indexOf(d.i) >= 0) + '">' + d.l + '</button>';
        }).join('') + '</div></div>' +
        '<div class="field"><label>Unidades</label><div class="segmented" id="ob-units">' +
        '<button type="button" data-units="kg"' + (units === 'kg' ? ' class="is-active"' : '') + '>kg</button>' +
        '<button type="button" data-units="lb"' + (units === 'lb' ? ' class="is-active"' : '') + '>lb</button>' +
        '</div></div>',
      footer: '<button class="btn primary block" id="ob-save">' + icon('check') + 'Guardar y empezar</button>',
      onClose: function () {
        // si lo cierra sin guardar, se vuelve a preguntar la próxima vez
      },
      onMount: function (sheet) {
        sheet.querySelector('#ob-goal').addEventListener('click', function (e) {
          var b = e.target.closest('[data-goal]');
          if (!b) return;
          goal = b.getAttribute('data-goal');
          Array.prototype.forEach.call(sheet.querySelectorAll('#ob-goal button'), function (x) { x.classList.toggle('is-active', x === b); });
        });
        sheet.querySelector('#ob-units').addEventListener('click', function (e) {
          var b = e.target.closest('[data-units]');
          if (!b) return;
          units = b.getAttribute('data-units');
          Array.prototype.forEach.call(sheet.querySelectorAll('#ob-units button'), function (x) { x.classList.toggle('is-active', x === b); });
          sheet.querySelector('#ob-weight-unit').textContent = units;
        });
        sheet.querySelector('#ob-days').addEventListener('click', function (e) {
          var b = e.target.closest('[data-day]');
          if (!b) return;
          var n = Number(b.getAttribute('data-day'));
          var i = days.indexOf(n);
          if (i >= 0) days.splice(i, 1); else days.push(n);
          b.classList.toggle('on');
          b.setAttribute('aria-pressed', days.indexOf(n) >= 0);
        });
        sheet.querySelector('#ob-save').addEventListener('click', function () {
          var name = sheet.querySelector('#ob-name').value.trim() || 'Simón';
          var ageVal = sheet.querySelector('#ob-age').value.trim();
          var weightVal = sheet.querySelector('#ob-weight').value.trim();
          var heightVal = sheet.querySelector('#ob-height').value.trim();

          var patch = {
            name: name,
            age: ageVal === '' ? null : parseInt(ageVal, 10),
            startWeight: weightVal === '' ? null : Number(weightVal),
            heightCm: heightVal === '' ? null : parseInt(heightVal, 10),
            bodyGoal: goal,
            gymDays: days,
            units: units,
            onboarded: true
          };

          store.saveSettings(patch).then(function (saved) {
            if (saved.startWeight != null) {
              return store.saveWeight({ date: S.today(), value: saved.startWeight });
            }
          }).then(function () {
            U.closeSheet();
            render();
            U.toast('Perfil guardado', 'ok');
          });
        });
      }
    });
  }

  /* ------------------------------------------- tarjeta del mes como imagen */
  function shareMonth(mk) {
    var c = ctx();
    var g = c.settings.gymDays;
    var m = S.monthSummary(c.workouts, g, mk, c.today, c.start);
    var W = 1080, H = 1350;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var x = cv.getContext('2d');
    var css = getComputedStyle(document.documentElement);
    var col = function (n, fb) { return (css.getPropertyValue(n) || '').trim() || fb; };

    var bg = col('--bg', '#0A0C10'), fg = col('--text', '#F5F7FB');
    var accent = col('--accent', '#FF5A2B'), muted = col('--text-muted', '#626B7C');
    var line = col('--border', '#1F242E');

    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    x.strokeStyle = line; x.lineWidth = 2;
    for (var i = -H; i < W; i += 46) {
      x.beginPath(); x.moveTo(i, H); x.lineTo(i + H * 0.45, 0); x.stroke();
    }

    var F = function (size, weight) {
      return weight + ' ' + size + 'px "Barlow Condensed", -apple-system, "Arial Narrow", sans-serif';
    };

    x.fillStyle = accent;
    x.fillRect(80, 150, 120, 10);

    x.fillStyle = fg;
    x.font = F(112, 800);
    x.fillText(S.formatMonth(mk).toUpperCase(), 80, 280);

    var rows = [
      ['Sesiones', String(m.count)],
      ['Asistencia', (m.attendance.scheduled ? m.attendance.pct : 0) + '%'],
      ['Tiempo', S.formatDuration(m.minutes)],
      ['Mejor racha', String(m.bestStreak)]
    ];
    var y = 420;
    rows.forEach(function (r) {
      x.fillStyle = muted; x.font = F(38, 700);
      x.fillText(r[0].toUpperCase(), 80, y);
      x.fillStyle = fg; x.font = F(150, 800);
      x.fillText(r[1], 80, y + 140);
      x.strokeStyle = line; x.lineWidth = 2;
      x.beginPath(); x.moveTo(80, y + 190); x.lineTo(W - 80, y + 190); x.stroke();
      y += 230;
    });

    if (m.energy != null) {
      x.fillStyle = muted; x.font = F(38, 700);
      x.fillText('ENERGÍA ' + GL.views.dec(m.energy) + '   ·   SENSACIÓN ' + GL.views.dec(m.feeling), 80, y + 20);
    }

    x.fillStyle = accent; x.font = F(44, 800);
    x.fillText('GYMLOG', 80, H - 90);
    x.fillStyle = muted; x.font = F(34, 600);
    x.fillText(esc(c.settings.name || '').toUpperCase(), W - 80 - x.measureText(esc(c.settings.name || '').toUpperCase()).width, H - 90);

    cv.toBlob(function (blob) {
      if (!blob) { U.toast('No se pudo generar la imagen', 'error'); return; }
      deliverFile('gymlog-' + mk + '.png', blob, 'image/png');
    }, 'image/png');
  }

  /* --------------------------------------------------------- demo / wipe */
  function seedDemo() {
    var s = store.settings();
    var d = GL.demo.generate(s.gymDays, 3, S.today());
    return store.seedDemo(d.workouts, d.weights);
  }

  /* --------------------------------------------------------- delegación */
  function onClick(e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');
    var arg = function (n) { return t.getAttribute('data-' + n); };

    switch (act) {
      case 'go': go(arg('view')); break;
      case 'log': U.closeSheet(); setTimeout(function () { openForm(arg('date'), arg('id')); }, 0); break;
      case 'quicklog': quickLog(); break;
      case 'detail': openDetail(arg('id')); break;
      case 'delete': U.closeSheet(); deleteWorkout(arg('id')); break;

      case 'month': {
        var d = S.parse(state.month + '-01');
        d.setMonth(d.getMonth() + Number(arg('delta')));
        state.month = S.iso(d).slice(0, 7);
        render();
        break;
      }
      case 'month-today':
        state.month = S.monthKey(S.today());
        state.selected = S.today();
        render();
        break;
      case 'pick-day':
        state.selected = (state.selected === arg('date')) ? null : arg('date');
        render();
        break;

      case 'filter': state.filter = arg('filter'); render(); break;
      case 'sort': state.sort = state.sort === 'new' ? 'old' : 'new'; render(); break;
      case 'ptab': state.progressTab = arg('tab'); render(); break;
      case 'heat-year': {
        var y = parseInt(arg('year'), 10);
        if (y) { state.heatYear = y; render(); }
        break;
      }
      case 'histmode': state.histMode = arg('mode'); render(); break;

      case 'toggle-day': {
        var days = store.settings().gymDays.slice();
        var n = Number(arg('day'));
        var i = days.indexOf(n);
        if (i >= 0) days.splice(i, 1); else days.push(n);
        store.saveSettings({ gymDays: days }).then(function () { render(); });
        break;
      }
      case 'units': store.saveSettings({ units: arg('units') }).then(function () { render(); }); break;
      case 'bodygoal': store.saveSettings({ bodyGoal: arg('goal') }).then(function () { render(); }); break;
      case 'cloud-logout':
        clearInterval(dayTickTimer);
        GL.cloud.signOut().then(function () {
          cloudUser = null;
          renderAuth('signin', '');
        });
        break;
      case 'cloud-sync': cloudSync(); break;
      case 'coach-refresh': fetchCoach(true); break;

      case 'auth-mode': {
        // conserva lo ya escrito al cambiar entre crear cuenta e iniciar sesión
        var keepPass = (document.getElementById('au-pass') || {}).value || '';
        renderAuth(arg('mode'), (document.getElementById('au-email') || {}).value || '');
        var passEl = document.getElementById('au-pass');
        if (passEl) passEl.value = keepPass;
        break;
      }

      case 'auth-submit': {
        var signup = authMode === 'signup';
        var emailVal = document.getElementById('au-email').value.trim();
        var passVal = document.getElementById('au-pass').value;

        authError('');
        if (!/^\S+@\S+\.\S+$/.test(emailVal)) { authError('Escribí un email válido.'); break; }
        if (passVal.length < 6) { authError('La contraseña necesita al menos 6 caracteres.'); break; }

        authEmail = emailVal;
        var label = t.textContent;
        t.disabled = true;
        t.textContent = signup ? 'Creando…' : 'Entrando…';

        (signup ? GL.cloud.signUp(emailVal, passVal) : GL.cloud.signIn(emailVal, passVal))
          .then(function () { return refreshCloudSession(); })
          /* Cuenta recién creada: la encuesta de perfil. Cuenta existente: a la
             app, que la encuesta ya la contestó en su momento. */
          .then(function () { return enterApp(signup); })
          ['catch'](function (err) {
            t.disabled = false; t.textContent = label;
            authError(err.message || 'No se pudo entrar. Probá de nuevo.');
          });
        break;
      }
      case 'theme':
        store.saveSettings({ theme: arg('theme') }).then(function (s) { applyTheme(s.theme); render(); });
        break;
      case 'toggle-reminders':
        store.saveSettings({ reminders: !store.settings().reminders }).then(function () { render(); });
        break;
      case 'toggle-intro':
        store.saveSettings({ intro: !store.settings().intro }).then(function (s) {
          document.documentElement.classList.toggle('no-intro', !s.intro);
          render();
          U.toast(s.intro ? 'Intro activada' : 'Intro desactivada', 'ok');
        });
        break;
      case 'replay-intro': replayIntro(); break;

      case 'set-goal': openGoal(); break;
      case 'share-month': shareMonth(arg('month')); break;

      case 'export': U.closeSheet(); setTimeout(openExport, 0); break;
      case 'import': openImport(); break;

      case 'seed-demo':
        seedDemo().then(function () { render(); U.toast('Datos de ejemplo cargados', 'ok'); });
        break;

      case 'clear-demo':
        U.confirmDialog({
          title: 'Borrar los datos de ejemplo',
          message: 'Se borran solo los registros marcados como «ejemplo». Los tuyos se mantienen.',
          confirmLabel: 'Borrar', danger: true
        }).then(function (ok) {
          if (!ok) return;
          store.clearDemo().then(function () { render(); U.toast('Ejemplo borrado', 'ok'); });
        });
        break;

      case 'wipe':
        U.confirmDialog({
          title: 'Borrar todo',
          html: 'Se eliminan <b>todas</b> tus sesiones, mediciones y logros de este dispositivo.<br><br>' +
            'Antes se guarda una copia automática, que podrás restaurar desde Ajustes. Aun así, si no has exportado nunca, cancela y hazlo primero.',
          confirmLabel: 'Borrar todo', danger: true
        }).then(function (ok) {
          if (!ok) return;
          store.clearAll().then(function () {
            state.selected = null;
            refreshBackups().then(function () { render(); });
            U.toast('Todo borrado', 'ok');
          });
        });
        break;

      case 'weight-new': openWeightForm(null); break;
      case 'weight-edit': openWeightForm(arg('id')); break;
      case 'weight-del': deleteWeight(arg('id')); break;

      case 'mfield': state.measureField = arg('field'); render(); break;
      case 'measure-new': openMeasureForm(null); break;
      case 'measure-edit': openMeasureForm(arg('id')); break;
      case 'measure-del': deleteMeasurement(arg('id')); break;
    }
  }

  /* --------------------------------------------------------------- intro */
  var INTRO_MS = 3300;
  var introDone = false;
  var introTemplate = null;

  function hideIntro() {
    if (introDone) return;
    introDone = true;
    var boot = document.getElementById('boot');
    if (!boot) return;
    boot.classList.add('gone');
    setTimeout(function () { if (boot.parentNode) boot.remove(); }, 420);
  }

  function scheduleIntroExit() {
    var boot = document.getElementById('boot');
    if (!boot) return;
    var off = document.documentElement.classList.contains('no-intro');
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var total = (off || reduced) ? 650 : INTRO_MS;
    var elapsed = (window.performance && performance.now) ? performance.now() : total;
    setTimeout(hideIntro, Math.max(0, total - elapsed));
    boot.addEventListener('click', hideIntro);
    boot.addEventListener('touchstart', hideIntro, { passive: true });
  }

  function replayIntro() {
    if (!introTemplate) return;
    var old = document.getElementById('boot');
    if (old) old.remove();
    var wrap = document.createElement('div');
    wrap.innerHTML = introTemplate;
    var boot = wrap.firstElementChild;
    document.body.appendChild(boot);
    introDone = false;
    void boot.offsetWidth;
    setTimeout(hideIntro, INTRO_MS);
    boot.addEventListener('click', hideIntro);
    boot.addEventListener('touchstart', hideIntro, { passive: true });
  }

  /* ------------------------------------------------------------ arranque */
  function buildShell() {
    var tabs = VIEWS.map(function (v) {
      return '<button class="tab" data-tab-id="' + v.id + '" data-act="go" data-view="' + v.id + '">' +
        icon(v.icon) + '<span>' + v.label + '</span></button>';
    }).join('');

    var app = document.getElementById('app');
    app.className = 'app';   // quita is-auth que deja la pantalla de acceso
    app.innerHTML =
      '<nav class="sidenav">' +
      '<div class="brand"><span class="mark-logo">' + icon('barbell') + '</span><b>GymLog</b></div>' + tabs +
      '<span class="grow"></span>' +
      '<button class="tab" data-tab-id="settings" data-act="go" data-view="settings">' + icon('settings') + '<span>Ajustes</span></button>' +
      '</nav>' +
      '<div class="col">' +
      '<header class="topbar" id="topbar">' +
      '<button class="iconbtn hidden" id="topbar-back" data-act="go" data-view="home" aria-label="Volver">' + icon('left') + '</button>' +
      '<h1 id="topbar-title">Inicio</h1>' +
      '<span class="spacer"></span>' +
      '<button class="iconbtn" id="topbar-settings" data-act="go" data-view="settings" aria-label="Ajustes">' + icon('settings') + '</button>' +
      '</header>' +
      '<main id="main"></main>' +
      '</div>' +
      '<nav class="tabbar">' + tabs + '</nav>' +
      '<button class="fab hidden" id="fab" data-act="log">' + icon('plus') + 'Registrar</button>' +
      '<div class="toast-wrap" id="toasts"></div>';
  }

  /* eventos globales por delegación: valen tanto para la pantalla de acceso
     como para la app, así que se enganchan una sola vez, antes de saber si
     hay sesión. */
  function wireGlobalEvents() {
    document.addEventListener('click', onClick);

    /* buscador del historial: se escribe y se vuelve a pintar sin perder el foco */
    var qTimer = null;
    document.addEventListener('input', function (e) {
      var el = e.target.closest && e.target.closest('[data-live="query"]');
      if (!el) return;
      state.query = el.value;
      clearTimeout(qTimer);
      qTimer = setTimeout(function () { render('hist-q'); }, 260);
    });

    /* campos de ajustes: se guardan al salir del campo */
    document.addEventListener('change', function (e) {
      var el = e.target.closest && e.target.closest('[data-set]');
      if (!el) return;
      var key = el.getAttribute('data-set');
      var value = el.value;
      if (key === 'startDate') {
        if (!value) { el.value = store.settings().startDate || S.today(); return; }
        if (S.daysBetween(value, S.today()) < 0) {
          U.toast('La fecha no puede estar en el futuro', 'error');
          el.value = store.settings().startDate || S.today();
          return;
        }
      }
      if (key === 'goal') {
        var n = parseInt(value, 10);
        if (!(n >= 1 && n <= 31)) { U.toast('Entre 1 y 31', 'error'); el.value = store.settings().goal; return; }
        value = n;
      }
      if (key === 'weeklyGoal') {
        /* vacío es válido y significa «los días que tenga programados» */
        if (value === '') value = null;
        else {
          var wk = parseInt(value, 10);
          if (!(wk >= 1 && wk <= 14)) {
            U.toast('Entre 1 y 14, o vacío', 'error');
            var cur = store.settings().weeklyGoal;
            el.value = cur == null ? '' : cur;
            return;
          }
          value = wk;
        }
      }
      if (key === 'backfillDays') {
        var b = parseInt(value, 10);
        if (!(b >= 0 && b <= 60)) { U.toast('Entre 0 y 60 días', 'error'); el.value = store.settings().backfillDays; return; }
        value = b;
      }
      if (key === 'name') value = value.trim() || 'Simón';
      if (key === 'age') {
        if (value === '') value = null;
        else {
          var ageN = parseInt(value, 10);
          if (!(ageN >= 10 && ageN <= 100)) { U.toast('Entre 10 y 100 años', 'error'); el.value = store.settings().age == null ? '' : store.settings().age; return; }
          value = ageN;
        }
      }
      if (key === 'heightCm') {
        if (value === '') value = null;
        else {
          var hN = parseInt(value, 10);
          if (!(hN >= 100 && hN <= 250)) { U.toast('Entre 100 y 250 cm', 'error'); el.value = store.settings().heightCm == null ? '' : store.settings().heightCm; return; }
          value = hN;
        }
      }
      var patch = {}; patch[key] = value;
      store.saveSettings(patch).then(function () { render(); U.toast('Guardado', 'ok'); });
    });

    window.addEventListener('scroll', function () {
      var tb = document.getElementById('topbar');
      if (tb) tb.classList.toggle('is-scrolled', window.scrollY > 4);
    }, { passive: true });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && U.isSheetOpen()) U.closeSheet();
    });
  }

  /* se llama una vez confirmada la sesión: trae los datos de la cuenta y
     recién ahí pinta la app de verdad. `isNewAccount` es true solo cuando se
     acaba de crear la cuenta: ahí siempre toca la encuesta de perfil. */
  function enterApp(isNewAccount) {
    return resolveAccountData().then(function () {
      buildShell();
      state.selected = S.today();
      render();
      document.getElementById('fab').addEventListener('click', function () { openForm(S.today(), null); });

      var introStillPlaying = !!document.getElementById('boot');
      setTimeout(function () { maybeOpenOnboarding(isNewAccount); },
        introStillPlaying ? INTRO_MS + 400 : 500);

      /* En segundo plano y sin bloquear la pantalla: si ya hay consejo de hoy
         no se llama a nada. */
      setTimeout(function () { fetchCoach(false); }, 1200);

      var lastDay = S.today();
      clearInterval(dayTickTimer);
      dayTickTimer = setInterval(function () {
        if (S.today() !== lastDay) { lastDay = S.today(); render(); }
      }, 60000);

      syncAchievements(false);
    });
  }

  function start() {
    bootTheme = document.documentElement.getAttribute('data-theme');
    var bootEl = document.getElementById('boot');
    if (bootEl) introTemplate = bootEl.outerHTML;
    probeSaver();
    wrapStoreForAutoSync();

    store.init().then(function () {
      applyTheme(store.settings().theme);
      return refreshCloudSession();
    }).then(function () {
      wireGlobalEvents();
      scheduleIntroExit();
      if (!cloudUser) { renderAuth('signin', ''); return; }
      return enterApp();
    })['catch'](function (err) {
      var boot = document.getElementById('boot');
      if (boot) {
        boot.innerHTML = '<div style="padding:24px;text-align:center;max-width:320px;color:var(--text)">' +
          '<h2 style="margin:12px 0 6px;font-size:18px;letter-spacing:.08em;text-transform:uppercase">No se pudo iniciar</h2>' +
          '<p style="color:var(--text-muted);font-size:13.5px">' + esc(err && err.message || 'Error desconocido') + '</p></div>';
      }
      if (window.console) console.error(err);
    });
  }

  GL.app = { start: start, render: render, go: go, openForm: openForm, state: state };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window.GL = window.GL || {});
