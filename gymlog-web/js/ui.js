/* =========================================================================
   ui.js — Piezas compartidas de interfaz: iconos, avisos, hojas y diálogos.
   ========================================================================= */
(function (GL) {
  'use strict';

  /* --------------------------------------------------------------- util */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Iconos propios. Trazo recto, remates cuadrados, uniones en ángulo:
     nada de emojis ni de formas blandas. Rejilla de 24. */
  var ICONS = {
    /* navegación */
    home: '<path d="M3 11 12 3l9 8"/><path d="M6 9.6V21h12V9.6"/>',
    calendar: '<path d="M3 5h18v16H3z"/><path d="M3 10h18M8 2.5v5M16 2.5v5"/>',
    progress: '<path d="M4 21V11M10 21V4M16 21V14M22 21V8"/>',
    history: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    settings: '<path d="M3 7h9M17 7h4M3 17h5M13 17h8M15 4v6M9 14v6"/>',

    /* acciones */
    plus: '<path d="M12 4v16M4 12h16"/>',
    minus: '<path d="M4 12h16"/>',
    left: '<path d="M15 4 7 12l8 8"/>',
    right: '<path d="M9 4l8 8-8 8"/>',
    close: '<path d="M5 5l14 14M19 5 5 19"/>',
    edit: '<path d="M4 20h4L20 8l-4-4L4 16z"/><path d="M14.5 5.5 18.5 9.5"/>',
    trash: '<path d="M4 6h16"/><path d="M9.5 6V3h5v3"/><path d="M6.5 6 7.6 21h8.8L17.5 6"/>',
    download: '<path d="M12 3v13"/><path d="M6 10.5 12 16.5l6-6"/><path d="M4 21h16"/>',
    upload: '<path d="M12 16.5V3"/><path d="M6 9 12 3l6 6"/><path d="M4 21h16"/>',
    share: '<path d="M12 16V3"/><path d="M7.5 7.5 12 3l4.5 4.5"/><path d="M5 12v9h14v-9"/>',
    check: '<path d="M4 12.5 9.5 18 20 6"/>',
    undo: '<path d="M4 10h9.5a5.5 5.5 0 0 1 0 11H8"/><path d="M4 10l4.5-4.5M4 10l4.5 4.5"/>',
    search: '<path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z"/><path d="M16.2 16.2 21 21"/>',
    replay: '<path d="M20.5 12A8.5 8.5 0 1 1 18 6"/><path d="M20.5 2.5v5h-5"/>',
    image: '<path d="M3 5h18v14H3z"/><path d="M3 15.5 8.5 10l4 4 3-3 5.5 5.5"/>',
    /* el entrenador: una chispa, para no repetir la pesa del logo */
    spark: '<path d="M12 2.5 14.2 9 20.5 11 14.2 13 12 19.5 9.8 13 3.5 11 9.8 9z"/><path d="M18.5 3v3.4M17 4.7h3"/>',
    send: '<path d="M4 12 20.5 4 13 20.5 11.4 13.6z"/><path d="M11.4 13.6 4 12"/>',
    sun: '<path d="M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z"/><path d="M12 2v2.6M12 19.4V22M2 12h2.6M19.4 12H22M4.9 4.9l1.9 1.9M17.2 17.2l1.9 1.9M19.1 4.9l-1.9 1.9M6.8 17.2l-1.9 1.9"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7.5 7.5 0 1 0 10.5 10.5z"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5z"/>',

    /* significado */
    flame: '<path d="M12 2.5 6.9 10c-1.7 2.4-1.4 5.4.6 7.4a6.4 6.4 0 0 0 9 0c2-2 2.3-5 .6-7.4L12 2.5z"/><path d="M12 13.5 10.2 17a2.1 2.1 0 0 0 3.6 0L12 13.5z"/>',
    trophy: '<path d="M7 3h10v6a5 5 0 0 1-10 0V3z"/><path d="M7 5H3.5v1.5A3.5 3.5 0 0 0 7 10M17 5h3.5v1.5A3.5 3.5 0 0 1 17 10"/><path d="M12 14v4M8 21h8"/>',
    clock: '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"/><path d="M12 6.5V12.5l4 2.2"/>',
    bolt: '<path d="M13.5 2 4.5 14H10l-1 8 9-12h-5.5l1.5-8z"/>',
    pulse: '<path d="M2 12h3.6l2.6-7.5 4 15 2.6-7.5H22"/>',
    gauge: '<path d="M3.5 20.5h5v-6h-5zM9.5 20.5h5v-11h-5zM15.5 20.5h5v-16h-5z"/>',
    scale: '<path d="M12 3.5v3.5M5 7h14M9 20h6M12 7v13"/><path d="M8 7 4 15.5h8L8 7zM16 7l-4 8.5h8L16 7z"/>',
    ruler: '<path d="M3.5 15.5 15.5 3.5l5 5-12 12z"/><path d="M8 15 10.2 12.8M11.2 12 13.4 9.8M14.4 9 16.6 6.8"/>',
    target: '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"/><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/><path d="M12 11.6v.8"/>',
    shield: '<path d="M12 2.5 4 5.5v6.2C4 17 7.4 20.6 12 21.5c4.6-.9 8-4.5 8-9.8V5.5l-8-3z"/>',
    medal: '<path d="M8.5 2.5 5 2.5l3 6M15.5 2.5 19 2.5l-3 6"/><path d="M12 22a6 6 0 1 0 0-12 6 6 0 0 0 0 12z"/>',
    calendarCheck: '<path d="M3 5h18v16H3z"/><path d="M3 10h18M8 2.5v5M16 2.5v5"/><path d="M8.5 15.5 11 18l4.5-4.5"/>',
    chartUp: '<path d="M3.5 19 10 12l4 3.5 6.5-8.5"/><path d="M20.5 7h-5M20.5 7v5"/>',
    pen: '<path d="M4 20h4L20 8l-4-4L4 16z"/><path d="M14.5 5.5 18.5 9.5M4 16l4 4"/>',
    layers: '<path d="M12 2.5 3 7.5l9 5 9-5-9-5z"/><path d="M3 13.5l9 5 9-5"/>',
    alert: '<path d="M12 3 2.5 20.5h19L12 3z"/><path d="M12 10v4.5M12 17.5v.6"/>',
    info: '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"/><path d="M12 11v6M12 7.4v.6"/>',
    barbell: '<path d="M4 9v6M7.5 6v12M16.5 6v12M20 9v6M7.5 12h9"/>',
    note: '<path d="M5 3h9l5 5v13H5V3z"/><path d="M14 3v5h5"/><path d="M8.5 13h7M8.5 17h4.5"/>',
    grid: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
    crown: '<path d="M3 7.5 7.5 12 12 3.5 16.5 12 21 7.5 19 20.5H5L3 7.5z"/>',
    week: '<path d="M3 5h18v16H3z"/><path d="M3 10h18M8 2.5v5M16 2.5v5"/><path d="M7 14h10"/>',

    /* estados */
    checkCircle: '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"/><path d="M8 12.2 10.8 15 16 9.6"/>',
    crossCircle: '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"/><path d="M9 9l6 6M15 9l-6 6"/>',
    dotCircle: '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"/><path d="M12 11.4v1.2"/>'
  };

  function icon(name, size) {
    return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"' +
      (size ? ' style="width:' + size + 'px;height:' + size + 'px"' : '') + '>' +
      (ICONS[name] || '') + '</svg>';
  }

  /* Marca de estado: un bloque de color, no un emoji. */
  function mark(status) {
    return '<span class="mark mark--' + status + '" aria-hidden="true"></span>';
  }

  /* Medidor de 1 a 5 en bloques. Mucho más de gimnasio que unas estrellas. */
  function meter(value, max) {
    max = max || 5;
    var out = '<span class="meter" aria-hidden="true">';
    for (var i = 1; i <= max; i++) out += '<i' + (i <= value ? ' class="on"' : '') + '></i>';
    return out + '</span>';
  }

  /* ------------------------------------------------------------- avisos */
  function toast(message, kind, undo) {
    var wrap = document.getElementById('toasts');
    if (!wrap) return;
    var t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = (kind === 'ok' ? icon('check') : kind === 'error' ? icon('alert') : '') +
      '<span>' + esc(message) + '</span>' +
      (undo ? '<button class="undo" type="button">' + esc(undo.label || 'Deshacer') + '</button>' : '');
    wrap.appendChild(t);

    var timer = setTimeout(close, kind === 'error' ? 4200 : undo ? 6000 : 2600);
    function close() {
      clearTimeout(timer);
      t.classList.add('leaving');
      setTimeout(function () { t.remove(); }, 220);
    }
    if (undo) {
      t.querySelector('.undo').addEventListener('click', function () {
        close();
        undo.action();
      });
    }
  }

  /* ------------------------------------------------------- hoja modal */
  var sheetState = null;

  function openSheet(opts) {
    closeSheet(true);

    var scrim = document.createElement('div');
    scrim.className = 'scrim';

    var sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', opts.title || 'Detalle');
    sheet.innerHTML =
      '<div class="sheet-grip"></div>' +
      '<div class="sheet-head">' +
      '<h2>' + esc(opts.title || '') + '</h2>' +
      '<button class="iconbtn" data-sheet-close aria-label="Cerrar">' + icon('close') + '</button>' +
      '</div>' +
      '<div class="sheet-body">' + (opts.body || '') + '</div>' +
      (opts.footer ? '<div class="sheet-foot">' + opts.footer + '</div>' : '');

    document.body.appendChild(scrim);
    document.body.appendChild(sheet);
    document.body.style.overflow = 'hidden';

    requestAnimationFrame(function () {
      scrim.classList.add('is-open');
      sheet.classList.add('is-open');
    });

    scrim.addEventListener('click', function () { closeSheet(); });
    sheet.addEventListener('click', function (e) {
      if (e.target.closest('[data-sheet-close]')) closeSheet();
    });

    sheetState = { scrim: scrim, sheet: sheet, onClose: opts.onClose };
    if (opts.onMount) opts.onMount(sheet);
    return sheet;
  }

  function closeSheet(immediate) {
    if (!sheetState) return;
    var s = sheetState;
    sheetState = null;
    document.body.style.overflow = '';
    if (immediate) { s.scrim.remove(); s.sheet.remove(); }
    else {
      s.scrim.classList.remove('is-open');
      s.sheet.classList.remove('is-open');
      setTimeout(function () { s.scrim.remove(); s.sheet.remove(); }, 300);
    }
    if (s.onClose) s.onClose();
  }

  function isSheetOpen() { return !!sheetState; }

  /* ---------------------------------------------------------- confirmar */
  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      var done = false;
      var finish = function (v) { if (!done) { done = true; resolve(v); } };
      openSheet({
        title: opts.title || '¿Seguro?',
        body: '<p style="margin:0;color:var(--text-dim);font-size:14.5px;line-height:1.55">' +
          (opts.html || esc(opts.message || '')) + '</p>',
        footer:
          '<div class="btn-row">' +
          '<button class="btn ghost" data-confirm="0">' + esc(opts.cancelLabel || 'Cancelar') + '</button>' +
          '<button class="btn ' + (opts.danger ? 'danger' : 'primary') + '" data-confirm="1">' +
          esc(opts.confirmLabel || 'Confirmar') + '</button>' +
          '</div>',
        onClose: function () { finish(false); },
        onMount: function (sheet) {
          sheet.addEventListener('click', function (e) {
            var b = e.target.closest('[data-confirm]');
            if (!b) return;
            finish(b.getAttribute('data-confirm') === '1');
            closeSheet();
          });
        }
      });
    });
  }

  GL.ui = {
    esc: esc, icon: icon, mark: mark, meter: meter, toast: toast,
    openSheet: openSheet, closeSheet: closeSheet, isSheetOpen: isSheetOpen,
    confirmDialog: confirmDialog
  };
})(window.GL = window.GL || {});
