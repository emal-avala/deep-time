/* Deep Time — interactive timeline of everything.
 *
 * Time is held internally as `bp` (years before present, present = 2026).
 * Both scales map the SAME bp window onto the plot width, so switching
 * between them redistributes the interior without moving the endpoints —
 * which is the whole point of the page. `state.m` blends between them:
 * 0 = linear, 1 = logarithmic.
 */
(function () {
  'use strict';

  // The present is read from the clock, not hardcoded, so the axis does not
  // start lying every January. Floored at the dataset's epoch so it can only
  // ever move forward from the year the data was compiled against.
  var DATA_EPOCH = 2026;
  var NOW = Math.max(DATA_EPOCH, new Date().getFullYear());

  var BP_CEIL = 13.9e9;   // a little older than the Big Bang
  // Log space cannot reach zero, so the axis is pinned one year short of the
  // present. That is a rendering limit, not a claim about the date: at every
  // zoom level the last year is sub-pixel, and the right edge is labelled as
  // the present rather than as the year before it.
  var BP_FLOOR = 1;

  // Lane order runs from substrate to superstructure: the physical universe,
  // life, humans, what humans made and believed, and finally how they organised
  // into states.
  //
  // Reordering lanes changes which colours end up adjacent, and adjacency is
  // what the palette was validated on — so re-run the validator before changing
  // this. `v` stays bound to the category, never to its position: colour
  // follows the entity, so a lane keeps its hue wherever it moves. Putting
  // Human Origins (magenta) next to Science & Tech (orange) fails the
  // normal-vision floor at dE 12.9, which is why Culture sits between them.
  var CATEGORIES = [
    { key: 'Cosmos & Earth',       label: 'Cosmos & Earth',   v: '--c1' },
    { key: 'Life & Extinctions',   label: 'Life',             v: '--c2' },
    { key: 'Human Origins',        label: 'Human Origins',    v: '--c3' },
    { key: 'Culture & Art',        label: 'Culture & Art',    v: '--c7' },
    { key: 'Science & Technology', label: 'Science & Tech',   v: '--c6' },
    { key: 'Religion & Thought',   label: 'Religion & Ideas', v: '--c5' },
    { key: 'Empires & Politics',   label: 'Empires',          v: '--c4' }
  ];
  var AGE_KEY = 'Age / Era';

  var LADDER = [
    { label: 'All time',   max: 13.8e9, min: BP_FLOOR },
    { label: 'Earth',      max: 4.6e9,  min: BP_FLOOR },
    { label: 'Life',       max: 3.9e9,  min: BP_FLOOR },
    { label: 'Animals',    max: 640e6,  min: BP_FLOOR },
    { label: 'Dinosaurs',  max: 265e6,  min: 50e6 },
    { label: 'Mammals',    max: 70e6,   min: BP_FLOOR },
    { label: 'Humans',     max: 3.5e6,  min: BP_FLOOR },
    { label: 'Sapiens',    max: 320e3,  min: BP_FLOOR },
    { label: 'Farming',    max: 13e3,   min: BP_FLOOR },
    { label: 'Writing',    max: 6e3,    min: BP_FLOOR },
    { label: 'Common era', max: 2100,   min: BP_FLOOR },
    { label: 'Modern',     max: 550,    min: BP_FLOOR },
    { label: 'Century',    max: 130,    min: BP_FLOOR }
  ];

  // ── Layout constants (CSS px) ──────────────────────────────────────────
  var GUTTER = 150, PAD_R = 22, PAD_T = 12;
  var STRATA_ROWS = 3, STRATA_ROW_H = 17, STRATA_HEAD = 15;
  var AXIS_H = 38, DENSITY_H = 34, PAD_B = 6;
  var SUBROWS = 3;
  var MIN_TICK_GAP = 62;

  // ── Data ───────────────────────────────────────────────────────────────
  var RAW = (window.HISTORY_DATA && window.HISTORY_DATA.events) || [];
  var ALL = [], AGES = [];

  RAW.forEach(function (e, i) {
    var start = Number(e.start);
    if (!isFinite(start)) return;
    var end = (e.end === null || e.end === undefined || !isFinite(Number(e.end)))
      ? null : Number(e.end);
    if (end !== null && end < start) { var t = end; end = start; start = t; }
    var ev = {
      id: i,
      name: String(e.name || 'Untitled'),
      cat: e.category,
      start: start,
      end: end,
      kind: e.kind || (end === null ? 'moment' : 'period'),
      desc: e.description || '',
      sig: e.significance || '',
      region: e.region || '',
      conf: e.confidence || 'approximate',
      // Only https links are carried through: the dataset is generated, and a
      // URL from a data file ends up in an href, so the scheme is checked here
      // rather than trusted.
      url: /^https:\/\//.test(e.wikipedia_url || '') ? e.wikipedia_url : '',
      method: e.dating_method || '',
      note: e.note || '',
      bpStart: NOW - start,
      bpEnd: NOW - (end === null ? start : end)
    };
    if (ev.cat === AGE_KEY || ev.kind === 'age') AGES.push(ev); else ALL.push(ev);
  });

  ALL.sort(function (a, b) { return a.bpStart - b.bpStart; });
  AGES.sort(function (a, b) { return (b.bpStart - b.bpEnd) - (a.bpStart - a.bpEnd); });

  var byCat = {};
  CATEGORIES.forEach(function (c) { byCat[c.key] = []; });
  ALL.forEach(function (e) { if (byCat[e.cat]) byCat[e.cat].push(e); });
  // Anything with an unrecognised category still deserves a home.
  ALL.forEach(function (e) { if (!byCat[e.cat]) { e.cat = 'Culture & Art'; byCat[e.cat].push(e); } });
  CATEGORIES.forEach(function (c) {
    byCat[c.key].sort(function (a, b) { return b.bpStart - a.bpStart; });
  });

  // ── State ──────────────────────────────────────────────────────────────
  var state = {
    bpMax: 13.8e9,
    bpMin: BP_FLOOR,
    m: 1,                 // 0 linear · 1 log
    mode: 'log',
    hidden: {},
    query: '',
    hover: null,
    selected: null,
    ladderIdx: 0
  };

  var els = {
    stage: document.getElementById('stage'),
    plotWrap: document.getElementById('plot-wrap'),
    canvas: document.getElementById('plot'),
    tip: document.getElementById('tip'),
    readout: document.getElementById('readout'),
    ladder: document.getElementById('ladder'),
    legend: document.getElementById('legend'),
    search: document.getElementById('search'),
    panel: document.getElementById('panel'),
    panelBody: document.getElementById('panel-body'),
    panelClose: document.getElementById('panel-close'),
    tableWrap: document.getElementById('table-wrap'),
    tableBody: document.getElementById('table-body'),
    viewTimeline: document.getElementById('view-timeline'),
    viewTable: document.getElementById('view-table'),
    btnTheme: document.getElementById('btn-theme'),
    segLinear: document.getElementById('seg-linear'),
    segLog: document.getElementById('seg-log'),
    blend: document.getElementById('blend'),
    statCount: document.getElementById('stat-count'),
    emptyNote: document.getElementById('empty-note')
  };

  var ctx = els.canvas.getContext('2d');
  var W = 0, H = 0, dpr = 1;
  var theme = {};
  var hits = [];
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Theme tokens ───────────────────────────────────────────────────────
  function refreshTheme() {
    var cs = getComputedStyle(document.documentElement);
    var names = ['--surface', '--surface-2', '--surface-3', '--ink', '--ink-2',
      '--ink-3', '--ink-4', '--rule', '--rule-strong',
      '--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7'];
    names.forEach(function (n) { theme[n] = cs.getPropertyValue(n).trim(); });
    theme.dark = isDark();
  }
  function isDark() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function catColor(key) {
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].key === key) return theme[CATEGORIES[i].v];
    }
    return theme['--ink-3'];
  }
  // Text drawn on top of a filled mark has to earn its contrast against that
  // fill, which varies by category and theme. Compare both candidates rather
  // than guessing at a lightness threshold — on the mid-tone hues (pink,
  // yellow, aqua) a threshold picks white, which measures barely 2.7:1.
  function onColor(hex) {
    var h = (hex || '#888888').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    function lin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    var L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    var onWhite = 1.05 / (L + 0.05);
    var onBlack = (L + 0.05) / 0.05;
    return onBlack >= onWhite ? '#0d0f0c' : '#ffffff';
  }

  function alpha(hex, a) {
    var h = (hex || '#888').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  // ── Scale ──────────────────────────────────────────────────────────────
  function plotLeft() { return GUTTER; }
  function plotWidth() { return Math.max(60, W - GUTTER - PAD_R); }

  function xOf(bp) {
    var pw = plotWidth(), x0 = plotLeft();
    var lin = (state.bpMax - bp) / (state.bpMax - state.bpMin);
    var lgHi = Math.log10(Math.max(state.bpMax, BP_FLOOR));
    var lgLo = Math.log10(Math.max(state.bpMin, BP_FLOOR));
    var lg = (lgHi - Math.log10(Math.max(bp, BP_FLOOR))) / (lgHi - lgLo);
    var f = lin * (1 - state.m) + lg * state.m;
    return x0 + f * pw;
  }

  // Inverse uses the settled mode (interaction is disabled mid-morph anyway).
  function bpAt(x) {
    var f = (x - plotLeft()) / plotWidth();
    if (state.mode === 'linear') return state.bpMax - f * (state.bpMax - state.bpMin);
    var lgHi = Math.log10(Math.max(state.bpMax, BP_FLOOR));
    var lgLo = Math.log10(Math.max(state.bpMin, BP_FLOOR));
    return Math.pow(10, lgHi - f * (lgHi - lgLo));
  }

  function sOf(bp) { return state.mode === 'linear' ? bp : Math.log10(Math.max(bp, BP_FLOOR)); }
  function sInv(s) { return state.mode === 'linear' ? s : Math.pow(10, s); }

  function minSpanS() { return state.mode === 'linear' ? 20 : 0.14; }
  function maxSpanS() { return sOf(BP_CEIL) - sOf(BP_FLOOR); }

  function clampDomain() {
    if (state.bpMin < BP_FLOOR) {
      var d = BP_FLOOR - state.bpMin;
      state.bpMin += d; state.bpMax += d;
    }
    if (state.bpMax > BP_CEIL) {
      var d2 = state.bpMax - BP_CEIL;
      state.bpMax -= d2;
      state.bpMin = Math.max(BP_FLOOR, state.bpMin - d2);
    }
    if (state.bpMax - state.bpMin < 1) state.bpMax = state.bpMin + 1;
  }

  function zoomBy(k, anchorX) {
    var sHi = sOf(state.bpMax), sLo = sOf(state.bpMin);
    var span = sHi - sLo;
    var f = Math.min(1, Math.max(0, (anchorX - plotLeft()) / plotWidth()));
    var sAnchor = sHi - f * span;
    var next = Math.min(maxSpanS(), Math.max(minSpanS(), span * k));
    var nHi = sAnchor + f * next;
    var nLo = nHi - next;
    state.bpMax = sInv(nHi);
    state.bpMin = sInv(nLo);
    clampDomain();
    state.ladderIdx = -1;
    draw();
  }

  function panBy(dxPx) {
    var sHi = sOf(state.bpMax), sLo = sOf(state.bpMin);
    var span = sHi - sLo;
    var d = (dxPx / plotWidth()) * span;
    state.bpMax = sInv(sHi + d);
    state.bpMin = sInv(sLo + d);
    clampDomain();
    state.ladderIdx = -1;
    draw();
  }

  // ── Formatting ─────────────────────────────────────────────────────────
  function trim(v, dec) {
    var s = v.toFixed(dec);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }
  function fmtAgo(bp, long) {
    if (bp >= 1e9) return trim(bp / 1e9, 2) + (long ? ' billion years ago' : ' Ga');
    if (bp >= 1e6) return trim(bp / 1e6, 2) + (long ? ' million years ago' : ' Ma');
    if (bp >= 1e4) return trim(bp / 1e3, 1) + (long ? ' thousand years ago' : ' ka');
    var y = Math.round(NOW - bp);
    if (y > 0) return y + ' CE';
    return (1 - y) + ' BCE';
  }
  function fmtWhen(ev, long) {
    if (ev.end === null) return fmtAgo(ev.bpStart, long);
    return fmtAgo(ev.bpStart, false) + ' – ' + fmtAgo(ev.bpEnd, false);
  }
  function fmtDuration(ev) {
    if (ev.end === null) return '';
    var d = ev.bpStart - ev.bpEnd;
    if (d <= 0) return '';
    if (d >= 1e9) return trim(d / 1e9, 2) + ' billion years';
    if (d >= 1e6) return trim(d / 1e6, 2) + ' million years';
    if (d >= 1e4) return trim(d / 1e3, 1) + ' thousand years';
    return Math.round(d) + ' years';
  }

  // ── Ticks ──────────────────────────────────────────────────────────────
  function logTicks() {
    var lo = Math.max(state.bpMin, BP_FLOOR), hi = Math.max(state.bpMax, BP_FLOOR * 10);
    var sets = [[1, 2, 5], [1, 5], [1]];
    var stride = 1;
    for (var attempt = 0; attempt < 24; attempt++) {
      var set = sets[Math.min(attempt, sets.length - 1)];
      if (attempt >= sets.length) stride = attempt - sets.length + 2;
      var out = [];
      var dLo = Math.floor(Math.log10(lo)), dHi = Math.ceil(Math.log10(hi));
      for (var d = dLo; d <= dHi; d++) {
        if (stride > 1 && ((d % stride) + stride) % stride !== 0) continue;
        for (var i = 0; i < set.length; i++) {
          var v = set[i] * Math.pow(10, d);
          if (v >= lo && v <= hi) out.push(v);
        }
      }
      out.sort(function (a, b) { return b - a; });
      if (out.length <= 1) return out;
      var ok = true;
      for (var j = 1; j < out.length; j++) {
        if (Math.abs(xOf(out[j]) - xOf(out[j - 1])) < MIN_TICK_GAP) { ok = false; break; }
      }
      if (ok) return out;
    }
    return [];
  }

  function linearTicks() {
    var span = state.bpMax - state.bpMin;
    var target = Math.max(2, Math.floor(plotWidth() / 118));
    var raw = span / target;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
    var out = [];
    var start = Math.ceil(state.bpMin / step) * step;
    for (var v = start; v <= state.bpMax; v += step) out.push(v);
    return out.reverse();
  }

  function ticks() {
    // Mid-morph, follow whichever scale is dominant so labels stay honest.
    return (state.m >= 0.5 ? logTicks() : linearTicks());
  }

  // ── Filtering ──────────────────────────────────────────────────────────
  function visible(e) {
    if (state.hidden[e.cat]) return false;
    return true;
  }
  function matches(e) {
    if (!state.query) return true;
    var q = state.query;
    return e.name.toLowerCase().indexOf(q) >= 0 ||
           e.desc.toLowerCase().indexOf(q) >= 0 ||
           (e.region || '').toLowerCase().indexOf(q) >= 0;
  }

  // ── Layout / packing ───────────────────────────────────────────────────
  var labelCache = {};
  function labelWidth(name) {
    if (labelCache[name] === undefined) {
      ctx.font = '500 11px ' + uiFont();
      labelCache[name] = ctx.measureText(name).width;
    }
    return labelCache[name];
  }
  function uiFont() {
    return 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  }
  function dataFont() {
    return 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
  }

  function geometry() {
    var strataTop = PAD_T + STRATA_HEAD;
    var strataH = STRATA_ROWS * STRATA_ROW_H;
    var lanesTop = strataTop + strataH + 12;
    var densityTop = H - PAD_B - DENSITY_H;
    var axisTop = densityTop - AXIS_H;
    var lanesH = Math.max(120, axisTop - lanesTop - 6);
    var laneH = lanesH / CATEGORIES.length;
    var rowH = Math.min(24, Math.max(11, (laneH - 13) / SUBROWS));
    return {
      strataTop: strataTop, strataH: strataH,
      lanesTop: lanesTop, lanesH: lanesH, laneH: laneH, rowH: rowH,
      axisTop: axisTop, densityTop: densityTop
    };
  }

  // ── Rendering ──────────────────────────────────────────────────────────
  function resize() {
    // Measure the plot wrapper, not the stage: the stage now also contains the
    // detail panel, so its width is no longer the width available to the plot.
    var r = els.plotWrap.getBoundingClientRect();
    dpr = Math.min(2.5, window.devicePixelRatio || 1);
    W = Math.max(360, Math.floor(r.width));
    H = Math.max(320, Math.floor(r.height));
    els.canvas.width = Math.floor(W * dpr);
    els.canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    labelCache = {};
  }

  var dirty = false;
  function draw() {
    if (dirty) return;
    dirty = true;
    requestAnimationFrame(function () { dirty = false; paint(); });
  }

  function paint() {
    var g = geometry();
    hits = [];

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = theme['--surface'];
    ctx.fillRect(0, 0, W, H);

    var tk = ticks();
    drawGrid(g, tk);
    drawStrata(g);
    drawLanes(g);
    drawEvents(g);
    drawAxis(g, tk);
    drawDensity(g);
    drawNow(g);
    drawGutterMask(g);
    updateReadout();
  }

  function drawGrid(g, tk) {
    ctx.save();
    ctx.strokeStyle = theme['--rule'];
    ctx.lineWidth = 1;
    tk.forEach(function (v) {
      var x = Math.round(xOf(v)) + 0.5;
      if (x < plotLeft() - 1 || x > W - PAD_R + 1) return;
      ctx.beginPath();
      ctx.moveTo(x, g.strataTop - 4);
      ctx.lineTo(x, g.axisTop);
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawStrata(g) {
    var x0 = plotLeft(), x1 = W - PAD_R;

    ctx.save();
    ctx.font = '500 9.5px ' + dataFont();
    ctx.fillStyle = theme['--ink-3'];
    ctx.textBaseline = 'alphabetic';
    ctx.letterSpacing = '0.12em';
    ctx.fillText('AGES & ERAS', 12, PAD_T + 10);
    ctx.letterSpacing = '0px';
    ctx.restore();

    var rows = [];
    for (var i = 0; i < STRATA_ROWS; i++) rows.push(-1e9);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, g.strataTop - 2, x1 - x0, g.strataH + 4);
    ctx.clip();

    AGES.forEach(function (a) {
      var ax = xOf(a.bpStart), bx = xOf(a.bpEnd);
      if (bx < x0 - 400 || ax > x1 + 400) return;
      var L = Math.max(ax, x0 - 200), R = Math.min(bx, x1 + 200);
      // An era too narrow to carry any text reads as an empty box; leave it out
      // rather than littering the band with unlabelled stubs.
      if (R - L < 7) return;
      var row = -1;
      for (var r = 0; r < STRATA_ROWS; r++) { if (rows[r] <= L - 3) { row = r; break; } }
      if (row < 0) return;
      rows[row] = R;

      var y = g.strataTop + row * STRATA_ROW_H;
      var h = STRATA_ROW_H - 4;
      var tint = theme.dark ? 0.10 - row * 0.02 : 0.065 - row * 0.014;

      ctx.fillStyle = alpha(theme['--ink'], Math.max(0.03, tint));
      roundRect(L, y, R - L, h, 3);
      ctx.fill();
      ctx.strokeStyle = alpha(theme['--ink'], theme.dark ? 0.16 : 0.11);
      ctx.lineWidth = 1;
      roundRect(L + 0.5, y + 0.5, R - L - 1, h - 1, 3);
      ctx.stroke();

      var lw = labelWidth(a.name);
      var visL = Math.max(L, x0), visR = Math.min(R, x1);
      if (visR - visL > lw + 14) {
        ctx.font = '500 10.5px ' + uiFont();
        ctx.fillStyle = theme['--ink-2'];
        ctx.textBaseline = 'middle';
        var cx = visL + 7;
        if (visR - cx < lw + 8) cx = visR - lw - 7;
        ctx.fillText(a.name, cx, y + h / 2 + 0.5);
      }
      hits.push({ x0: L, x1: R, y: y + h / 2, r: h / 2 + 2, ev: a, band: true });
    });
    ctx.restore();
  }

  function drawLanes(g) {
    ctx.save();
    for (var i = 0; i < CATEGORIES.length; i++) {
      var c = CATEGORIES[i];
      var top = g.lanesTop + i * g.laneH;

      if (i % 2 === 1) {
        ctx.fillStyle = alpha(theme['--ink'], theme.dark ? 0.022 : 0.016);
        ctx.fillRect(plotLeft(), top, W - PAD_R - plotLeft(), g.laneH);
      }

      ctx.strokeStyle = theme['--rule'];
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plotLeft(), Math.round(top) + 0.5);
      ctx.lineTo(W - PAD_R, Math.round(top) + 0.5);
      ctx.stroke();

      var off = state.hidden[c.key];
      ctx.globalAlpha = off ? 0.32 : 1;

      ctx.fillStyle = catColor(c.key);
      roundRect(12, top + g.laneH / 2 - 5, 3, 10, 1.5);
      ctx.fill();

      ctx.font = '560 11.5px ' + uiFont();
      ctx.fillStyle = off ? theme['--ink-4'] : theme['--ink-2'];
      ctx.textBaseline = 'middle';
      ctx.fillText(c.label, 22, top + g.laneH / 2);

      var n = byCat[c.key].length;
      ctx.font = '400 9.5px ' + dataFont();
      ctx.fillStyle = theme['--ink-4'];
      ctx.fillText(String(n), 22, top + g.laneH / 2 + 13);

      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawEvents(g) {
    var x0 = plotLeft(), x1 = W - PAD_R;
    var searching = !!state.query;
    var shown = 0;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, g.lanesTop - 2, x1 - x0, g.lanesH + 4);
    ctx.clip();

    for (var i = 0; i < CATEGORIES.length; i++) {
      var c = CATEGORIES[i];
      if (state.hidden[c.key]) continue;
      var col = catColor(c.key);
      var top = g.lanesTop + i * g.laneH;
      var rows = [];
      for (var r = 0; r < SUBROWS; r++) rows.push(-1e9);
      var overflowY = top + g.laneH - 5;

      // A span running off both edges of the window is ongoing context rather
      // than a datable event. Left in the packing, three multi-million-year
      // geological processes claim every row at century zooms and bury the
      // Little Ice Age beneath them — so give them their own slim band.
      var list = byCat[c.key];
      var packable = [], context = [];
      for (var k = 0; k < list.length; k++) {
        var le = list[k];
        var lax = xOf(le.bpStart);
        var lbx = le.end === null ? lax : xOf(le.bpEnd);
        if (lbx < x0 - 300 || lax > x1 + 300) continue;
        shown++;
        var rec = { e: le, ax: lax, bx: lbx };
        if (le.end !== null && lax <= x0 + 2 && lbx >= x1 - 2) context.push(rec);
        else packable.push(rec);
      }

      var ctxShown = Math.min(context.length, 4);
      for (var ci = 0; ci < ctxShown; ci++) {
        var cy = top + 4 + ci * 5;
        ctx.fillStyle = alpha(col, matches(context[ci].e) || !searching ? 0.5 : 0.14);
        ctx.fillRect(x0, cy, x1 - x0, 3);
        hits.push({ x0: x0, x1: x1, y: cy + 1.5, r: 3, ev: context[ci].e });
      }
      var ctxH = ctxShown ? ctxShown * 5 + 4 : 0;
      var padTop = ctxH + Math.max(2, (g.laneH - ctxH - SUBROWS * g.rowH - 8) / 2);

      for (var p = 0; p < packable.length; p++) {
        var e = packable[p].e;
        var ax = packable[p].ax;
        var bx = packable[p].bx;

        var isMatch = matches(e);
        var dim = searching && !isMatch;
        var markL = ax;
        var markR = Math.max(bx, ax + 8);
        var lw = labelWidth(e.name);
        var isPeriod = e.end !== null && (bx - ax) > 14;
        var insideLabel = isPeriod && (markR - markL) > lw + 16;

        // Near the right edge a trailing label would be clipped by the plot
        // boundary, so flip it to the left of the mark instead.
        // A label is only worth placing if it lands wholly inside the plot.
        // Checking both ends matters: a mark can sit just beyond the right
        // edge, where flipping the label leftwards still leaves it off-screen.
        var canRight = markR + 6 >= x0 + 2 && markR + 6 + lw <= x1 - 2;
        var canLeft = markL - 6 - lw >= x0 + 2 && markL - 6 <= x1 - 2;
        var placeLeft = !insideLabel && !canRight && canLeft;
        var canLabel = insideLabel || canRight || canLeft;

        var extL = placeLeft ? markL - 6 - lw : markL;
        var extR = (insideLabel || placeLeft) ? markR : markR + 6 + lw;

        var row = -1, labelled = canLabel;
        if (!dim && canLabel) {
          for (var q = 0; q < SUBROWS; q++) {
            if (rows[q] <= extL - 5) { row = q; break; }
          }
        }
        if (row < 0) {
          labelled = false;
          for (var q2 = 0; q2 < SUBROWS; q2++) {
            if (rows[q2] <= markL - 4) { row = q2; break; }
          }
        }

        if (row < 0) {
          // No room at all — keep the mark as a density tick so the shape of
          // history stays honest even where labels can't fit.
          ctx.fillStyle = alpha(col, dim ? 0.14 : 0.5);
          ctx.fillRect(Math.round(markL), overflowY, Math.max(1, Math.min(3, markR - markL)), 4);
          hits.push({ x0: markL - 2, x1: markR + 2, y: overflowY + 2, r: 5, ev: e });
          continue;
        }

        rows[row] = labelled ? extR : markR + 3;
        var y = top + padTop + row * g.rowH + g.rowH / 2;
        var a = dim ? 0.16 : 1;

        ctx.globalAlpha = a;
        ctx.strokeStyle = theme['--surface'];
        ctx.lineWidth = 2;

        if (e.end !== null && (bx - ax) > 9) {
          var bw = Math.max(9, bx - ax);
          roundRect(ax, y - 4, bw, 8, 4);
          ctx.fillStyle = col;
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(ax, y, 4, 0, Math.PI * 2);
          ctx.fillStyle = col;
          ctx.fill();
          ctx.stroke();
        }

        if (labelled && !dim) {
          ctx.font = '500 11px ' + uiFont();
          ctx.textBaseline = 'middle';
          if (insideLabel) {
            // A long bar often starts off-screen; hold its label inside the
            // visible run of the bar rather than letting the edge shear it.
            ctx.globalAlpha = 1;
            var tx = Math.max(ax + 8, x0 + 8);
            var barR = Math.min(markR, x1);
            if (tx + lw <= barR - 8) {
              ctx.fillStyle = onColor(col);
              ctx.fillText(e.name, tx, y + 0.5);
            }
          } else if (placeLeft) {
            ctx.fillStyle = theme['--ink-2'];
            ctx.textAlign = 'right';
            ctx.fillText(e.name, markL - 6, y + 0.5);
            ctx.textAlign = 'left';
          } else if (canRight) {
            ctx.fillStyle = theme['--ink-2'];
            ctx.fillText(e.name, markR + 6, y + 0.5);
          }
        }
        ctx.globalAlpha = 1;

        hits.push({ x0: markL - 3, x1: markR + 3, y: y, r: g.rowH / 2 + 1, ev: e });
      }
    }
    ctx.restore();

    els.emptyNote.setAttribute('data-show', shown === 0 ? '1' : '0');

    if (state.hover) drawHoverRing(state.hover);
  }

  function drawHoverRing(h) {
    ctx.save();
    ctx.strokeStyle = theme['--ink'];
    ctx.lineWidth = 1.5;
    var pad = 4;
    roundRect(h.x0 - pad, h.y - (h.r + 1), (h.x1 - h.x0) + pad * 2, (h.r + 1) * 2, 6);
    ctx.stroke();
    ctx.restore();
  }

  function drawAxis(g, tk) {
    var x0 = plotLeft(), x1 = W - PAD_R;
    ctx.save();
    ctx.strokeStyle = theme['--rule-strong'];
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, Math.round(g.axisTop) + 0.5);
    ctx.lineTo(x1, Math.round(g.axisTop) + 0.5);
    ctx.stroke();

    ctx.font = '400 10.5px ' + dataFont();
    ctx.fillStyle = theme['--ink-2'];
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';

    tk.forEach(function (v) {
      var x = xOf(v);
      if (x < x0 - 2 || x > x1 + 2) return;
      ctx.strokeStyle = theme['--rule-strong'];
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, g.axisTop);
      ctx.lineTo(Math.round(x) + 0.5, g.axisTop + 5);
      ctx.stroke();
      // Nudge end labels inward by their own measured width, so neither the
      // year nor the wider "yrs ago" line gets sheared by the gutter.
      function tickLabel(text, cy) {
        var w = ctx.measureText(text).width;
        var lx = x;
        if (lx - w / 2 < x0 + 2) lx = x0 + 2 + w / 2;
        if (lx + w / 2 > x1 - 2) lx = x1 - 2 - w / 2;
        ctx.fillText(text, lx, cy);
      }

      // The floor tick is the axis's stand-in for the present. Formatting it
      // like any other value printed the year *before* now underneath the word
      // "now" — so name it as the present in both lines.
      var atNow = v <= BP_FLOOR;

      ctx.fillStyle = theme['--ink-2'];
      tickLabel(atNow ? NOW + ' CE' : fmtAgo(v, false), g.axisTop + 9);
      // Below ~10 ka the primary label is already a calendar year, so the
      // useful second line is the elapsed time rather than the year again.
      if (v < 1e4) {
        var ago = Math.round(v);
        ctx.fillStyle = theme['--ink-4'];
        ctx.font = '400 9.5px ' + dataFont();
        tickLabel(atNow ? 'now' : ago.toLocaleString() + ' yrs ago', g.axisTop + 22);
        ctx.font = '400 10.5px ' + dataFont();
      }
    });

    ctx.textAlign = 'left';
    ctx.font = '500 9.5px ' + dataFont();
    ctx.fillStyle = theme['--ink-3'];
    ctx.letterSpacing = '0.12em';
    ctx.fillText(state.m >= 0.5 ? 'LOGARITHMIC' : 'LINEAR', 12, g.axisTop + 9);
    ctx.letterSpacing = '0px';
    ctx.restore();
  }

  function drawDensity(g) {
    var x0 = plotLeft(), x1 = W - PAD_R, pw = x1 - x0;
    var nb = Math.max(20, Math.floor(pw / 4));
    var bins = new Array(nb);
    for (var i = 0; i < nb; i++) bins[i] = 0;
    var max = 0;

    ALL.forEach(function (e) {
      if (!visible(e) || !matches(e)) return;
      var x = xOf(e.bpStart);
      if (x < x0 || x > x1) return;
      var b = Math.min(nb - 1, Math.floor(((x - x0) / pw) * nb));
      bins[b]++;
      if (bins[b] > max) max = bins[b];
    });

    var base = g.densityTop + DENSITY_H - 12;
    var maxH = DENSITY_H - 20;

    ctx.save();
    ctx.font = '500 9.5px ' + dataFont();
    ctx.fillStyle = theme['--ink-3'];
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '0.12em';
    ctx.fillText('DENSITY', 12, base - maxH / 2);
    ctx.letterSpacing = '0px';

    if (max > 0) {
      var bw = pw / nb;
      ctx.fillStyle = alpha(theme['--ink'], theme.dark ? 0.5 : 0.42);
      for (var j = 0; j < nb; j++) {
        if (!bins[j]) continue;
        var h = Math.max(1.5, Math.sqrt(bins[j] / max) * maxH);
        ctx.fillRect(x0 + j * bw, base - h, Math.max(1, bw - 0.8), h);
      }
    }

    ctx.strokeStyle = theme['--rule'];
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, Math.round(base) + 0.5);
    ctx.lineTo(x1, Math.round(base) + 0.5);
    ctx.stroke();

    ctx.font = '400 9.5px ' + uiFont();
    ctx.fillStyle = theme['--ink-4'];
    ctx.textBaseline = 'top';
    ctx.fillText('events beginning per interval — reflects what this dataset records, not all of history', x0, base + 5);
    ctx.restore();
  }

  function drawNow(g) {
    var x = xOf(BP_FLOOR);
    if (x < plotLeft() || x > W - PAD_R + 2) return;
    ctx.save();
    ctx.strokeStyle = theme['--ink'];
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, g.strataTop - 6);
    ctx.lineTo(Math.round(x) + 0.5, g.axisTop);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '500 9.5px ' + dataFont();
    ctx.fillStyle = theme['--ink'];
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('NOW', x - 3, g.strataTop - 7);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  function drawGutterMask(g) {
    ctx.save();
    ctx.fillStyle = theme['--surface'];
    ctx.fillRect(0, 0, plotLeft() - 1, H);
    ctx.fillRect(W - PAD_R + 1, 0, PAD_R, H);
    ctx.strokeStyle = theme['--rule'];
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotLeft() - 0.5, PAD_T);
    ctx.lineTo(plotLeft() - 0.5, g.densityTop + DENSITY_H - 12);
    ctx.stroke();
    ctx.restore();
    // Lane labels sit in the gutter and must survive the mask.
    drawLanes(g);
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function updateReadout() {
    var span = state.bpMax - state.bpMin;
    var spanTxt = span >= 1e9 ? trim(span / 1e9, 2) + ' Gyr'
      : span >= 1e6 ? trim(span / 1e6, 2) + ' Myr'
      : span >= 1e4 ? trim(span / 1e3, 1) + ' kyr'
      : Math.round(span) + ' yr';
    els.readout.innerHTML =
      '<span>' + esc(fmtAgo(state.bpMax, false)) + ' → ' +
      (state.bpMin <= 2 ? 'now' : esc(fmtAgo(state.bpMin, false))) + '</span>' +
      '<span style="color:var(--ink-4)">·</span>' +
      '<b>' + esc(spanTxt) + '</b>' +
      '<span style="color:var(--ink-4)">·</span>' +
      '<span>' + (state.m >= 0.5 ? 'log' : 'linear') + '</span>';
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── Animation ──────────────────────────────────────────────────────────
  var anim = null;
  function animate(dur, step, done) {
    if (anim) anim.cancelled = true;
    var a = { cancelled: false };
    anim = a;
    var t0 = null;
    function frame(t) {
      if (a.cancelled) return;
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / dur);
      var e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      step(e);
      paint();
      if (p < 1) requestAnimationFrame(frame);
      else { anim = null; if (done) done(); }
    }
    requestAnimationFrame(frame);
  }

  function setMode(mode, animated) {
    state.mode = mode;
    var target = mode === 'log' ? 1 : 0;
    els.segLog.setAttribute('aria-pressed', String(mode === 'log'));
    els.segLinear.setAttribute('aria-pressed', String(mode === 'linear'));
    if (!animated || reduceMotion) {
      state.m = target;
      els.blend.value = String(target);
      draw();
      return;
    }
    var from = state.m;
    animate(820, function (e) {
      state.m = from + (target - from) * e;
      els.blend.value = String(state.m);
    });
  }

  function gotoWindow(max, min, animated) {
    var fromHi = state.bpMax, fromLo = state.bpMin;
    if (!animated || reduceMotion) {
      state.bpMax = max; state.bpMin = min; clampDomain(); draw(); return;
    }
    // Interpolate in log space so the sweep feels even across huge ranges.
    var lh0 = Math.log10(Math.max(fromHi, BP_FLOOR)), lh1 = Math.log10(Math.max(max, BP_FLOOR));
    var ll0 = Math.log10(Math.max(fromLo, BP_FLOOR)), ll1 = Math.log10(Math.max(min, BP_FLOOR));
    animate(680, function (e) {
      state.bpMax = Math.pow(10, lh0 + (lh1 - lh0) * e);
      state.bpMin = Math.pow(10, ll0 + (ll1 - ll0) * e);
      clampDomain();
    });
  }

  // ── Interaction ────────────────────────────────────────────────────────
  function hitTest(mx, my) {
    var best = null, bestD = Infinity;
    for (var i = hits.length - 1; i >= 0; i--) {
      var h = hits[i];
      if (my < h.y - h.r || my > h.y + h.r) continue;
      if (mx < h.x0 - 4 || mx > h.x1 + 4) continue;
      var d = mx < h.x0 ? h.x0 - mx : mx > h.x1 ? mx - h.x1 : 0;
      if (d < bestD) { bestD = d; best = h; }
    }
    return best;
  }

  var drag = null;
  els.canvas.addEventListener('pointerdown', function (ev) {
    els.canvas.setPointerCapture(ev.pointerId);
    drag = { x: ev.offsetX, moved: 0 };
    els.canvas.classList.add('dragging');
  });
  els.canvas.addEventListener('pointermove', function (ev) {
    if (drag) {
      var dx = ev.offsetX - drag.x;
      drag.x = ev.offsetX;
      drag.moved += Math.abs(dx);
      if (dx) panBy(dx);
      hideTip();
      return;
    }
    var h = hitTest(ev.offsetX, ev.offsetY);
    if (h !== state.hover) { state.hover = h; draw(); }
    if (h) showTip(h.ev, ev.offsetX, ev.offsetY); else hideTip();
  });
  function endDrag(ev) {
    if (!drag) return;
    var wasClick = drag.moved < 4;
    drag = null;
    els.canvas.classList.remove('dragging');
    if (wasClick) {
      var h = hitTest(ev.offsetX, ev.offsetY);
      if (h) openPanel(h.ev); else closePanel();
    }
  }
  els.canvas.addEventListener('pointerup', endDrag);
  els.canvas.addEventListener('pointercancel', function () {
    drag = null; els.canvas.classList.remove('dragging');
  });
  els.canvas.addEventListener('pointerleave', function () {
    state.hover = null; hideTip(); draw();
  });

  els.canvas.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) * 1.5) { panBy(-ev.deltaX); return; }
    var k = Math.exp(ev.deltaY * 0.0022);
    zoomBy(k, ev.offsetX);
    updateLadderPressed();
  }, { passive: false });

  els.canvas.addEventListener('dblclick', function (ev) {
    zoomBy(0.45, ev.offsetX);
    updateLadderPressed();
  });

  function showTip(e, x, y) {
    var col = e.cat === AGE_KEY || e.kind === 'age' ? theme['--ink-3'] : catColor(e.cat);
    var dur = fmtDuration(e);
    els.tip.style.setProperty('--sw', col);
    els.tip.innerHTML =
      '<div class="tip-cat"><i></i>' + esc(e.cat === AGE_KEY ? 'Age / Era' : e.cat) + '</div>' +
      '<h3>' + esc(e.name) + '</h3>' +
      '<div class="tip-when">' + esc(fmtWhen(e, true)) + (dur ? '  <span style="color:var(--ink-3)">· ' + esc(dur) + '</span>' : '') + '</div>' +
      (e.desc ? '<p>' + esc(e.desc) + '</p>' : '') +
      (e.sig ? '<p class="tip-sig">' + esc(e.sig) + '</p>' : '');
    els.tip.setAttribute('data-show', '1');
    var tw = els.tip.offsetWidth, th = els.tip.offsetHeight;
    var left = x + 16, top = y + 16;
    if (left + tw > W - 8) left = x - tw - 16;
    if (top + th > H - 8) top = Math.max(8, y - th - 12);
    els.tip.style.left = Math.max(8, left) + 'px';
    els.tip.style.top = top + 'px';
  }
  function hideTip() { els.tip.setAttribute('data-show', '0'); }

  // ── Detail panel ───────────────────────────────────────────────────────
  function openPanel(e) {
    state.selected = e;
    var col = (e.cat === AGE_KEY || e.kind === 'age') ? theme['--ink-3'] : catColor(e.cat);
    var pool = ALL.concat(AGES).filter(function (o) { return o !== e; });
    pool.sort(function (a, b) {
      return Math.abs(a.bpStart - e.bpStart) - Math.abs(b.bpStart - e.bpStart);
    });
    var near = pool.slice(0, 7);
    var dur = fmtDuration(e);

    els.panelBody.innerHTML =
      '<div class="tip-cat" style="--sw:' + col + '"><i style="background:' + col + ';display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px"></i>' +
      esc(e.cat === AGE_KEY ? 'Age / Era' : e.cat) + '</div>' +
      '<h2>' + esc(e.name) + '</h2>' +
      '<div class="when">' + esc(fmtWhen(e, true)) + '</div>' +
      '<div class="meta">' +
        (dur ? '<span>lasted ' + esc(dur) + '</span>' : '') +
        (e.region ? '<span>' + esc(e.region) + '</span>' : '') +
        '<span>' + esc(e.conf) + ' date</span>' +
        (e.method ? '<span>' + esc(e.method) + '</span>' : '') +
      '</div>' +
      (e.desc ? '<p>' + esc(e.desc) + '</p>' : '') +
      (e.note ? '<p class="caveat">' + esc(e.note) + '</p>' : '') +
      (e.sig ? '<h4>Why it matters</h4><p>' + esc(e.sig) + '</p>' : '') +
      (e.url
        ? '<a class="source" href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">' +
          'Read on Wikipedia<span aria-hidden="true"> &#8599;</span>' +
          '<span class="sr-only"> (opens in a new tab)</span></a>'
        : '') +
      '<h4>Nearest in time</h4>' +
      '<ul class="neighbours">' + near.map(function (n) {
        return '<li><button data-id="' + n.id + '" data-age="' + (AGES.indexOf(n) >= 0 ? 1 : 0) + '">' +
          '<span>' + esc(n.name) + '</span>' +
          '<span class="n-when">' + esc(fmtAgo(n.bpStart, false)) + '</span></button></li>';
      }).join('') + '</ul>';

    Array.prototype.forEach.call(els.panelBody.querySelectorAll('.neighbours button'), function (b) {
      b.addEventListener('click', function () {
        var id = Number(b.getAttribute('data-id'));
        var isAge = b.getAttribute('data-age') === '1';
        var target = (isAge ? AGES : ALL).filter(function (o) { return o.id === id; })[0];
        if (target) { focusEvent(target); openPanel(target); }
      });
    });

    els.panel.setAttribute('data-open', '1');
  }
  function closePanel() {
    state.selected = null;
    els.panel.setAttribute('data-open', '0');
  }
  els.panelClose.addEventListener('click', closePanel);

  function focusEvent(e) {
    var mid = e.end === null ? e.bpStart : Math.sqrt(Math.max(1, e.bpStart) * Math.max(1, e.bpEnd));
    var span = e.end === null ? Math.max(mid * 0.9, 40) : Math.max((e.bpStart - e.bpEnd) * 6, mid * 0.5, 40);
    var hi = Math.min(BP_CEIL, mid + span);
    var lo = Math.max(BP_FLOOR, mid - span * 0.6);
    if (state.mode === 'log') { hi = Math.min(BP_CEIL, mid * 6); lo = Math.max(BP_FLOOR, mid / 6); }
    state.ladderIdx = -1;
    updateLadderPressed();
    gotoWindow(hi, lo, true);
  }

  // ── Chrome wiring ──────────────────────────────────────────────────────
  function buildLadder() {
    els.ladder.innerHTML = '';
    LADDER.forEach(function (p, i) {
      var b = document.createElement('button');
      b.textContent = p.label;
      b.setAttribute('aria-pressed', String(i === state.ladderIdx));
      b.addEventListener('click', function () {
        state.ladderIdx = i;
        updateLadderPressed();
        gotoWindow(p.max, p.min, true);
      });
      els.ladder.appendChild(b);
    });
  }
  function updateLadderPressed() {
    Array.prototype.forEach.call(els.ladder.children, function (b, i) {
      b.setAttribute('aria-pressed', String(i === state.ladderIdx));
    });
  }

  function buildLegend() {
    els.legend.innerHTML = '';
    CATEGORIES.forEach(function (c) {
      var b = document.createElement('button');
      b.setAttribute('aria-pressed', String(!state.hidden[c.key]));
      b.innerHTML = '<span class="swatch"></span>' + esc(c.label) +
        ' <span class="count">' + byCat[c.key].length + '</span>';
      b.style.setProperty('--sw', 'var(' + c.v + ')');
      b.addEventListener('click', function () {
        state.hidden[c.key] = !state.hidden[c.key];
        b.setAttribute('aria-pressed', String(!state.hidden[c.key]));
        draw();
      });
      els.legend.appendChild(b);
    });
  }

  function buildTable() {
    var rows = ALL.concat(AGES).slice().sort(function (a, b) { return b.bpStart - a.bpStart; });
    els.tableBody.innerHTML = rows.map(function (e) {
      var col = (e.cat === AGE_KEY || e.kind === 'age') ? 'var(--ink-3)' : 'var(' + catVar(e.cat) + ')';
      // The table is the accessible path to the data, so the links belong here
      // too — not only in the panel, which needs a click on a canvas to reach.
      var name = e.url
        ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">' +
          esc(e.name) + '</a>'
        : esc(e.name);
      return '<tr><td class="t-name">' + name + '</td>' +
        '<td class="t-when">' + esc(fmtWhen(e, false)) + '</td>' +
        '<td class="t-cat" style="--sw:' + col + '"><i></i>' + esc(e.cat) + '</td>' +
        '<td>' + esc(e.desc) + '</td></tr>';
    }).join('');
  }
  function catVar(key) {
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].key === key) return CATEGORIES[i].v;
    return '--ink-3';
  }

  els.segLinear.addEventListener('click', function () { setMode('linear', true); });
  els.segLog.addEventListener('click', function () { setMode('log', true); });

  els.blend.addEventListener('input', function () {
    if (anim) { anim.cancelled = true; anim = null; }
    state.m = Number(els.blend.value);
    state.mode = state.m >= 0.5 ? 'log' : 'linear';
    els.segLog.setAttribute('aria-pressed', String(state.mode === 'log'));
    els.segLinear.setAttribute('aria-pressed', String(state.mode === 'linear'));
    draw();
  });

  var searchTimer = null;
  els.search.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.query = els.search.value.trim().toLowerCase();
      draw();
    }, 110);
  });
  els.search.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter') return;
    var q = els.search.value.trim().toLowerCase();
    if (!q) return;
    var hit = ALL.concat(AGES).filter(function (e) {
      return e.name.toLowerCase().indexOf(q) >= 0;
    })[0];
    if (hit) { focusEvent(hit); openPanel(hit); }
  });

  // Two labelled states rather than one button that keeps saying "Table" while
  // the table is already open, leaving no visible way back to the timeline.
  function setView(view) {
    var isTable = view === 'table';
    els.tableWrap.setAttribute('data-open', isTable ? '1' : '0');
    els.viewTable.setAttribute('aria-pressed', String(isTable));
    els.viewTimeline.setAttribute('aria-pressed', String(!isTable));
  }

  els.viewTable.addEventListener('click', function () { setView('table'); });
  els.viewTimeline.addEventListener('click', function () { setView('timeline'); });

  els.btnTheme.addEventListener('click', function () {
    var next = isDark() ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    refreshTheme();
    buildLegend();
    draw();
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.target === els.search) {
      if (ev.key === 'Escape') { els.search.value = ''; state.query = ''; els.search.blur(); draw(); }
      return;
    }
    if (ev.key === 'Escape') { closePanel(); setView('timeline'); return; }
    if (ev.key === 'l' || ev.key === 'L') { setMode(state.mode === 'log' ? 'linear' : 'log', true); return; }
    if (ev.key === '0') { state.ladderIdx = 0; updateLadderPressed(); gotoWindow(13.8e9, BP_FLOOR, true); return; }
    if (ev.key === 'ArrowLeft') { panBy(60); return; }
    if (ev.key === 'ArrowRight') { panBy(-60); return; }
    if (ev.key === '+' || ev.key === '=') { zoomBy(0.7, plotLeft() + plotWidth() / 2); return; }
    if (ev.key === '-' || ev.key === '_') { zoomBy(1.4, plotLeft() + plotWidth() / 2); return; }
  });

  window.addEventListener('resize', function () { resize(); draw(); });

  // Opening the panel changes the plot's width over 280ms of CSS transition,
  // which fires no resize event. Observing the wrapper redraws on every frame
  // of that animation, so the timeline reflows with the panel rather than
  // snapping once it has finished.
  if (window.ResizeObserver) {
    new ResizeObserver(function () { resize(); paint(); }).observe(els.plotWrap);
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    if (!document.documentElement.getAttribute('data-theme')) {
      refreshTheme(); buildLegend(); draw();
    }
  });

  // ── Deep links ─────────────────────────────────────────────────────────
  // ?scale=linear|log · ?window=<preset> · ?from=<yr>&to=<yr> · ?q=… ·
  // ?event=<name> · ?theme=…
  // Any of these skips the opening animation and restores a specific view.
  var pendingOpen = null;

  function applyUrlState() {
    var p;
    try { p = new URLSearchParams(location.search); } catch (err) { return false; }
    var used = false;

    var th = p.get('theme');
    if (th === 'light' || th === 'dark') {
      document.documentElement.setAttribute('data-theme', th);
      refreshTheme();
      used = true;
    }

    var win = (p.get('window') || '').toLowerCase();
    if (win) {
      for (var i = 0; i < LADDER.length; i++) {
        if (LADDER[i].label.toLowerCase().replace(/\s+/g, '') === win.replace(/\s+/g, '')) {
          state.bpMax = LADDER[i].max; state.bpMin = LADDER[i].min;
          state.ladderIdx = i; used = true; break;
        }
      }
    }

    var from = Number(p.get('from')), to = Number(p.get('to'));
    if (isFinite(from) && isFinite(to) && p.get('from') !== null && p.get('to') !== null) {
      // `from`/`to` are calendar years, oldest first.
      state.bpMax = Math.max(BP_FLOOR, NOW - Math.min(from, to));
      state.bpMin = Math.max(BP_FLOOR, NOW - Math.max(from, to));
      state.ladderIdx = -1;
      used = true;
    }

    var q = p.get('q');
    if (q) { els.search.value = q; state.query = q.trim().toLowerCase(); used = true; }

    // ?event=<name fragment> opens that event's panel on load, so a specific
    // event can be linked to directly rather than hunted for.
    var wanted = (p.get('event') || '').trim().toLowerCase();
    if (wanted) {
      var hit = ALL.concat(AGES).filter(function (e) {
        return e.name.toLowerCase().indexOf(wanted) >= 0;
      })[0];
      if (hit) { pendingOpen = hit; used = true; }
    }

    var sc = p.get('scale');
    if (sc === 'linear' || sc === 'log') {
      state.mode = sc;
      state.m = sc === 'log' ? 1 : 0;
      els.blend.value = String(state.m);
      els.segLog.setAttribute('aria-pressed', String(sc === 'log'));
      els.segLinear.setAttribute('aria-pressed', String(sc === 'linear'));
      used = true;
    }

    clampDomain();
    return used;
  }

  // ── Boot ───────────────────────────────────────────────────────────────
  function init() {
    refreshTheme();
    resize();
    buildLadder();
    buildLegend();
    buildTable();
    els.statCount.textContent = (ALL.length + AGES.length) + ' events · ' + AGES.length + ' ages';

    if (!RAW.length) {
      els.emptyNote.textContent = 'No data loaded — check data/events.js';
      els.emptyNote.setAttribute('data-show', '1');
    }

    var deepLinked = applyUrlState();
    updateLadderPressed();

    // Opening sequence: the page performs its own thesis. Start linear —
    // where all of human history is a sub-pixel sliver at the right edge —
    // then unfold into log time. A deep link means the reader asked for a
    // specific view, so show it immediately instead.
    if (deepLinked || reduceMotion) {
      if (!deepLinked) { state.m = 1; els.blend.value = '1'; }
      paint();
    } else {
      state.m = 0; els.blend.value = '0'; paint();
      setTimeout(function () { setMode('log', true); }, 520);
    }

    if (pendingOpen) { focusEvent(pendingOpen); openPanel(pendingOpen); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
