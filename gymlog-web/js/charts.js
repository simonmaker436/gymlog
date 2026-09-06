/* =========================================================================
   charts.js — Gráficos SVG escritos a mano. Sin librerías, sin red.
   Dos formas: barras (magnitud por mes) y línea/área (evolución en el tiempo).
   Los colores salen de variables CSS, así que siguen el tema claro/oscuro.
   ========================================================================= */
(function (GL) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var registry = [];      // para redibujar al cambiar de tamaño

  function el(name, attrs) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    return n;
  }

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    var mag = Math.pow(10, Math.floor(Math.log10(v)));
    var n = v / mag;
    var step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return step * mag;
  }

  /* barra con esquinas superiores redondeadas y base anclada al eje */
  function barPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, Math.max(0, h));
    if (h <= 0.5) return '';
    return 'M' + x + ',' + (y + h) +
      'L' + x + ',' + (y + r) +
      'A' + r + ',' + r + ' 0 0 1 ' + (x + r) + ',' + y +
      'L' + (x + w - r) + ',' + y +
      'A' + r + ',' + r + ' 0 0 1 ' + (x + w) + ',' + (y + r) +
      'L' + (x + w) + ',' + (y + h) + 'Z';
  }

  /* el eje Y necesita tanto sitio como pida su etiqueta más larga */
  function axisWidth(max, ticks, fmt, min) {
    min = min || 0;
    var longest = 1;
    for (var t = 0; t <= ticks; t++) {
      var v = min + ((max - min) / ticks) * t;
      var s = fmt ? String(fmt(v)) : String(Math.round(v));
      if (s.length > longest) longest = s.length;
    }
    return Math.min(56, Math.max(24, longest * 6.6 + 10));
  }

  function makeTooltip(host) {
    var tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.setAttribute('role', 'status');
    host.appendChild(tip);
    return {
      show: function (x, y, html) {
        tip.innerHTML = html;
        tip.classList.add('is-on');
        var w = host.clientWidth;
        var tw = tip.offsetWidth;
        var left = Math.min(Math.max(x - tw / 2, 4), Math.max(4, w - tw - 4));
        tip.style.left = left + 'px';
        tip.style.top = Math.max(0, y - tip.offsetHeight - 10) + 'px';
      },
      hide: function () { tip.classList.remove('is-on'); }
    };
  }

  function emptyState(host, message) {
    host.innerHTML = '<div class="chart-empty">' + message + '</div>';
  }

  /* ------------------------------------------------------------ barras */
  function bar(host, opts) {
    var data = (opts.data || []);
    var height = opts.height || 168;
    var W = host.clientWidth || 320;
    if (W < 40) W = 320;

    host.innerHTML = '';
    var real = data.filter(function (d) { return d.value != null; });
    if (!real.length || real.every(function (d) { return d.value === 0; })) {
      return emptyState(host, opts.empty || 'Aún no hay datos suficientes.');
    }

    var color = cssVar(opts.colorVar || '--accent', '#FF6A45');
    var grid = cssVar('--grid', 'rgba(255,255,255,.08)');
    var muted = cssVar('--text-muted', '#7d8598');

    var max = niceMax(Math.max.apply(null, real.map(function (d) { return d.value; })));
    var padL = opts.padL || axisWidth(max, 3, opts.tickFormat);
    var padR = 8, padT = 12, padB = 22;
    var innerW = W - padL - padR, innerH = height - padT - padB;
    var slot = innerW / data.length;
    var bw = Math.max(6, Math.min(opts.maxBar || 34, slot - 8));

    var svg = el('svg', { width: W, height: height, viewBox: '0 0 ' + W + ' ' + height, role: 'img' });
    svg.setAttribute('aria-label', opts.aria || 'Gráfico de barras');

    // rejilla
    var ticks = 3;
    for (var t = 0; t <= ticks; t++) {
      var val = (max / ticks) * t;
      var y = padT + innerH - (val / max) * innerH;
      svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: y, y2: y, stroke: grid, 'stroke-width': 1 }));
      var lbl = el('text', { x: padL - 6, y: y + 3.5, 'text-anchor': 'end', fill: muted, 'font-size': 10 });
      lbl.setAttribute('class', 'chart-axis');
      lbl.textContent = opts.tickFormat ? opts.tickFormat(val) : String(Math.round(val));
      svg.appendChild(lbl);
    }

    var tip = makeTooltip(host);

    data.forEach(function (d, i) {
      var x = padL + slot * i + (slot - bw) / 2;
      if (d.value != null) {
        var h = (d.value / max) * innerH;
        var y = padT + innerH - h;
        var p = el('path', { d: barPath(x, y, bw, h, 4), fill: color });
        p.setAttribute('class', 'chart-bar');
        if (d.dim) p.setAttribute('opacity', '0.4');
        svg.appendChild(p);
      }
      var lab = el('text', {
        x: x + bw / 2, y: height - 6, 'text-anchor': 'middle',
        fill: muted, 'font-size': 10
      });
      lab.setAttribute('class', 'chart-axis');
      lab.textContent = d.label;
      svg.appendChild(lab);

      // zona sensible generosa para el toque en móvil
      var hit = el('rect', { x: padL + slot * i, y: padT, width: slot, height: innerH, fill: 'transparent' });
      hit.style.cursor = 'default';
      var body = d.value == null
        ? (opts.emptyPoint || 'Sin datos')
        : (opts.format ? opts.format(d.value) : String(d.value));
      var html = '<strong>' + (d.fullLabel || d.label) + '</strong><span>' + body + '</span>';
      var cx = padL + slot * i + slot / 2, cy = d.value != null ? padT + innerH - (d.value / max) * innerH : padT + innerH;
      hit.addEventListener('pointerenter', function () { tip.show(cx, cy, html); });
      hit.addEventListener('pointermove', function () { tip.show(cx, cy, html); });
      hit.addEventListener('pointerleave', tip.hide);
      hit.addEventListener('pointerdown', function () { tip.show(cx, cy, html); });
      svg.appendChild(hit);
    });

    host.appendChild(svg);
  }

  /* ------------------------------------------------------- línea / área */
  function line(host, opts) {
    var data = (opts.data || []).filter(function (d) { return d.value != null; });
    var height = opts.height || 168;
    var W = host.clientWidth || 320;
    if (W < 40) W = 320;

    host.innerHTML = '';
    if (data.length === 0) return emptyState(host, opts.empty || 'Aún no hay datos suficientes.');
    if (data.length === 1) {
      return emptyState(host, (opts.singleEmpty || 'Necesitas al menos dos registros para ver la evolución.'));
    }

    var color = cssVar(opts.colorVar || '--accent', '#FF6A45');
    var grid = cssVar('--grid', 'rgba(255,255,255,.08)');
    var muted = cssVar('--text-muted', '#7d8598');
    var surface = cssVar('--surface', '#181b22');

    var vals = data.map(function (d) { return d.value; });
    var fixed = opts.yMin != null && opts.yMax != null;
    var lo = opts.yMin != null ? opts.yMin : Math.min.apply(null, vals);
    var hi = opts.yMax != null ? opts.yMax : Math.max.apply(null, vals);
    if (hi === lo) { hi = lo + 1; lo = lo - 1; }
    else if (!fixed) { var pad = (hi - lo) * 0.15; hi += pad; lo -= pad; }
    if (opts.yFloor != null && lo < opts.yFloor) lo = opts.yFloor;

    var lticks = opts.ticks || 3;
    var padL = opts.padL || axisWidth(hi, lticks, opts.tickFormat, lo);
    var padR = 12, padT = 14, padB = 22;
    var innerW = W - padL - padR, innerH = height - padT - padB;

    var X = function (i) { return padL + (innerW * i) / (data.length - 1); };
    var Y = function (v) { return padT + innerH - ((v - lo) / (hi - lo)) * innerH; };

    var svg = el('svg', { width: W, height: height, viewBox: '0 0 ' + W + ' ' + height, role: 'img' });
    svg.setAttribute('aria-label', opts.aria || 'Gráfico de líneas');

    var ticks = lticks;
    for (var t = 0; t <= ticks; t++) {
      var val = lo + ((hi - lo) / ticks) * t;
      var y = Y(val);
      svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: y, y2: y, stroke: grid, 'stroke-width': 1 }));
      var lbl = el('text', { x: padL - 6, y: y + 3.5, 'text-anchor': 'end', fill: muted, 'font-size': 10 });
      lbl.setAttribute('class', 'chart-axis');
      lbl.textContent = opts.tickFormat ? opts.tickFormat(val) : (Math.round(val * 10) / 10);
      svg.appendChild(lbl);
    }

    var dPath = data.map(function (d, i) { return (i ? 'L' : 'M') + X(i) + ',' + Y(d.value); }).join(' ');
    var gid = 'g' + Math.random().toString(36).slice(2, 8);
    var defs = el('defs');
    var lg = el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
    lg.appendChild(el('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': .28 }));
    lg.appendChild(el('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0 }));
    defs.appendChild(lg);
    svg.appendChild(defs);

    svg.appendChild(el('path', {
      d: dPath + ' L' + X(data.length - 1) + ',' + (padT + innerH) + ' L' + X(0) + ',' + (padT + innerH) + ' Z',
      fill: 'url(#' + gid + ')'
    }));
    var stroke = el('path', {
      d: dPath, fill: 'none', stroke: color, 'stroke-width': 2,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    });
    stroke.setAttribute('class', 'chart-line');
    svg.appendChild(stroke);

    // punto final destacado
    var lastI = data.length - 1;
    svg.appendChild(el('circle', { cx: X(lastI), cy: Y(data[lastI].value), r: 5, fill: color, stroke: surface, 'stroke-width': 2 }));

    // etiquetas del eje X: primera, media y última
    [0, Math.floor(lastI / 2), lastI].filter(function (v, i, a) { return a.indexOf(v) === i; })
      .forEach(function (i) {
        var lab = el('text', {
          x: Math.min(Math.max(X(i), 14), W - 14), y: height - 6,
          'text-anchor': i === 0 ? 'start' : i === lastI ? 'end' : 'middle',
          fill: muted, 'font-size': 10
        });
        lab.setAttribute('class', 'chart-axis');
        lab.textContent = data[i].label;
        svg.appendChild(lab);
      });

    // capa interactiva: cruz + tooltip
    var tip = makeTooltip(host);
    var cross = el('line', { x1: 0, x2: 0, y1: padT, y2: padT + innerH, stroke: color, 'stroke-width': 1, opacity: 0 });
    var dot = el('circle', { r: 5, fill: color, stroke: surface, 'stroke-width': 2, opacity: 0 });
    svg.appendChild(cross); svg.appendChild(dot);

    var overlay = el('rect', { x: 0, y: 0, width: W, height: height, fill: 'transparent' });
    function at(e) {
      var box = svg.getBoundingClientRect();
      var px = e.clientX - box.left;
      var i = Math.round(((px - padL) / innerW) * (data.length - 1));
      i = Math.min(data.length - 1, Math.max(0, i));
      var d = data[i];
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('opacity', .35);
      dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(d.value)); dot.setAttribute('opacity', 1);
      tip.show(X(i), Y(d.value), '<strong>' + (d.fullLabel || d.label) + '</strong><span>' +
        (opts.format ? opts.format(d.value) : d.value) + '</span>');
    }
    function off() { cross.setAttribute('opacity', 0); dot.setAttribute('opacity', 0); tip.hide(); }
    overlay.addEventListener('pointermove', at);
    overlay.addEventListener('pointerdown', at);
    overlay.addEventListener('pointerleave', off);
    svg.appendChild(overlay);

    host.appendChild(svg);
  }

  /* ---------------------------------------------- redibujado responsive */
  function draw(host, kind, opts) {
    if (!host) return;
    registry = registry.filter(function (r) { return document.body.contains(r.host); });
    registry.push({ host: host, kind: kind, opts: opts });
    (kind === 'line' ? line : bar)(host, opts);
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      registry = registry.filter(function (r) { return document.body.contains(r.host); });
      registry.forEach(function (r) { (r.kind === 'line' ? line : bar)(r.host, r.opts); });
    }, 160);
  });

  GL.charts = { draw: draw, bar: bar, line: line, reset: function () { registry = []; } };
})(window.GL = window.GL || {});
