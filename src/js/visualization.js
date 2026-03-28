// ── Probe Visualizer helpers ──────────────────────────────────────────────────
function smPvizInit(cfg) {
  window._smPvizCfg = cfg;
  window._smPvizContacts = [];
  // reset probe sequence recording
  smPvizProbeSequence = [];
  _smPvizSeqLastTime = Date.now();
  // Hide Three.js canvas so probe animation is visible during probing
  var smThreeWrap = document.getElementById('sm-three-canvas');
  if (smThreeWrap) smThreeWrap.classList.remove('three-active');
  // clear previous contact dots
  var surf = document.getElementById('sm-pviz-surface');
  if (surf) {
    var oldDots = surf.querySelectorAll('.sm-pviz-dot');
    for (var i = 0; i < oldDots.length; i++) oldDots[i].remove();
  }
  // set grid lines to match actual probe grid spacing
  if (surf && cfg && cfg.colCount > 1 && cfg.rowCount > 1) {
    var colPct = (100 / (cfg.colCount - 1)).toFixed(4);
    var rowPct = (100 / (cfg.rowCount - 1)).toFixed(4);
    surf.style.backgroundSize = colPct + '% ' + rowPct + '%';
  }
  // reset probe to starting corner
  var wrap = document.getElementById('sm-pviz-probe-wrap');
  if (wrap) { wrap.style.left = '0%'; wrap.style.top = '100%'; }
  var body = document.getElementById('sm-pviz-probe-body');
  if (body) { body.className = ''; }
}
function smPvizSetState(state) {
  var body = document.getElementById('sm-pviz-probe-body');
  if (!body) return;
  body.classList.remove('probe-plunging', 'probe-contact');
  void body.offsetWidth; // force reflow so CSS animations restart cleanly
  if (state === 'plunging') body.classList.add('probe-plunging');
  else if (state === 'contact') body.classList.add('probe-contact');
}
function smPvizXYtoPos(x, y) {
  var cfg = window._smPvizCfg;
  if (!cfg) return { left: 50, top: 50 };
  var spanX = (cfg.maxX - cfg.minX) || 1;
  var spanY = (cfg.maxY - cfg.minY) || 1;
  var leftPct = Math.max(0, Math.min(100, (x - cfg.minX) / spanX * 100));
  // Inverted Y: top:100% = front of 3D view (near viewer, Y=minY); top:0% = back (far, Y=maxY)
  var topPct  = Math.max(0, Math.min(100, 100 - (y - cfg.minY) / spanY * 100));
  return { left: leftPct, top: topPct };
}
// Helper: returns z-component of the unit face normal for a triangle (used for shading).
// Pass exaggerated Z values so normal variation is meaningful on nearly-flat surfaces.
function pvizFaceNormal(x0, y0, z0, x1, y1, z1, x2, y2, z2) {
  var e1x = x1-x0, e1y = y1-y0, e1z = z1-z0;
  var e2x = x2-x0, e2y = y2-y0, e2z = z2-z0;
  var nx = e1y*e2z - e1z*e2y;
  var ny = e1z*e2x - e1x*e2z;
  var nz = e1x*e2y - e1y*e2x; // z-component of cross product
  var len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
  return nz / len; // positive = upward-facing
}
function smPvizRecordEvent(state, opts) {
  if (!state) return; // skip null/initial call
  var now = Date.now();
  var delay = Math.max(0, now - _smPvizSeqLastTime);
  _smPvizSeqLastTime = now;
  var ev = { type: state, delay: delay };
  if (opts.x !== undefined) ev.x = opts.x;
  if (opts.y !== undefined) ev.y = opts.y;
  if (opts.contactZ !== undefined) ev.z = opts.contactZ;
  if (opts.point !== undefined) ev.point = opts.point;
  if (opts.total !== undefined) ev.total = opts.total;
  if (opts.pct !== undefined) ev.pct = opts.pct;
  if (opts.action !== undefined) ev.action = opts.action;
  smPvizProbeSequence.push(ev);
}

function smPvizUpdate(state, opts) {
  opts = opts || {};
  smPvizSetState(state);
  smPvizRecordEvent(state, opts);
  var stateLabels = { traveling: 'Traveling...', plunging: 'Probing...', contact: '✓ Contact!', complete: '✓ Complete — Surface mapped', error: 'Error' };
  var label = opts.action || stateLabels[state] || 'Ready';
  var statusEl = document.getElementById('sm-pviz-status');
  if (statusEl) {
    statusEl.textContent = label;
    statusEl.style.color = (state === 'contact' || state === 'complete') ? 'var(--good)' : state === 'error' ? 'var(--bad)' : 'var(--text)';
  }
  var pointEl = document.getElementById('sm-pviz-point');
  if (pointEl && opts.point !== undefined) pointEl.textContent = opts.point + ' / ' + (opts.total !== undefined ? opts.total : '?');
  var posEl = document.getElementById('sm-pviz-pos');
  if (posEl && opts.x !== undefined) posEl.textContent = 'X' + Number(opts.x).toFixed(3) + ' Y' + Number(opts.y).toFixed(3);
  var zEl = document.getElementById('sm-pviz-z');
  if (zEl && opts.contactZ !== undefined) zEl.textContent = Number(opts.contactZ).toFixed(3);
  var pct = opts.pct !== undefined ? Math.max(0, Math.min(100, opts.pct)) : undefined;
  var barEl = document.getElementById('sm-pviz-bar');
  if (barEl && pct !== undefined) barEl.style.width = pct + '%';
  var pctEl = document.getElementById('sm-pviz-pct');
  if (pctEl && pct !== undefined) pctEl.textContent = Math.round(pct) + '%';
  // move probe in 3D X/Y
  if (opts.x !== undefined && opts.y !== undefined) {
    var pos = smPvizXYtoPos(opts.x, opts.y);
    var wrap = document.getElementById('sm-pviz-probe-wrap');
    if (wrap) { wrap.style.left = pos.left + '%'; wrap.style.top = pos.top + '%'; }
  }
  // add contact dot on the surface and store for mesh
  if (state === 'contact' && opts.x !== undefined) {
    // store contact point for mesh rendering
    if (!window._smPvizContacts) window._smPvizContacts = [];
    if (opts.contactZ !== undefined) {
      window._smPvizContacts.push({ x: opts.x, y: opts.y, z: opts.contactZ });
    }
    var surf = document.getElementById('sm-pviz-surface');
    if (surf) {
      var dpos = smPvizXYtoPos(opts.x, opts.y);
      var dot = document.createElement('div');
      dot.className = 'sm-pviz-dot';
      dot.style.left = dpos.left + '%';
      dot.style.top  = dpos.top + '%';
      // color by Z depth: near 0 = green, deeper negative = orange/red
      var dotColor = '#5fd38d';
      if (opts.contactZ !== undefined) {
        // scale depth over ~10 coords range: shallow (near 0) = green, deep = orange/red
        var depth = Math.min(1, Math.max(0, Math.abs(opts.contactZ) / 10));
        var r = Math.round(depth * 255 + (1 - depth) * 95);
        var g = Math.round((1 - depth) * 211 + depth * 90);
        var b = Math.round((1 - depth) * 141 + depth * 50);
        dotColor = 'rgb(' + r + ',' + g + ',' + b + ')';
      }
      dot.style.background = dotColor;
      dot.style.boxShadow = '0 0 5px ' + dotColor;
      surf.appendChild(dot);
    }
  }
  // on complete: fade in mesh surface, then switch back to heatmap view
  if (state === 'complete') {
    setTimeout(function() {
      smPvizRenderMesh();
      setTimeout(function() {
        showProbeHeatmapView('sm');
        setTimeout(renderSurfaceReliefMap, 60);
      }, 900);
    }, 700);
  }
  // when probing starts, ensure the terrain panel is visible for the probe animation
  if (state === 'traveling' || state === 'plunging') {
    showProbeTerrainView('sm');
  }
}

// ── Unified 3D Mesh Renderer ──────────────────────────────────────────────────
// SVG polygon rendering removed — Three.js WebGL renderer handles all 3D terrain views.
// renderUnified3D is kept as a legacy stub for backward compatibility.
function renderUnified3D(prefix) {
  renderThreeUnified3D(prefix);
}

function smPvizRenderMesh() {
  renderThreeUnified3D('sm');
}

// ── Probe mode view toggle (2D Heatmap ↔ 3D Terrain) ─────────────────────────
// prefix: 'sm' (surface) | 'face' (face) — toggles between heatmap and 3D terrain panels.
function toggleProbeModeView(prefix) {
  var heatmapPanel  = document.getElementById(prefix + '-heatmap-panel');
  var terrainPanel  = document.getElementById(prefix + '-terrain-panel');
  if (!heatmapPanel || !terrainPanel) return;
  var showingHeatmap = terrainPanel.style.display === 'none';
  if (showingHeatmap) {
    // Switch to 3D terrain
    heatmapPanel.style.display  = 'none';
    terrainPanel.style.display  = '';
    // Render Three.js terrain into the now-visible scene
    setTimeout(function() {
      if (prefix === 'sm') smPvizRenderMesh();
      else renderThreeUnified3D(prefix);
    }, 60);
  } else {
    // Switch to 2D heatmap
    terrainPanel.style.display  = 'none';
    heatmapPanel.style.display  = '';
    // Re-render the canvas heatmap now that the panel is visible
    setTimeout(function() {
      if (prefix === 'sm') renderSurfaceReliefMap();
      else renderFaceReliefMap();
    }, 60);
  }
}

// Show the 3D terrain panel for a probe mode (used during probing animation).
function showProbeTerrainView(prefix) {
  var heatmapPanel = document.getElementById(prefix + '-heatmap-panel');
  var terrainPanel = document.getElementById(prefix + '-terrain-panel');
  if (heatmapPanel) heatmapPanel.style.display = 'none';
  if (terrainPanel) terrainPanel.style.display = '';
}

// Show the 2D heatmap panel for a probe mode (used after probing completes).
function showProbeHeatmapView(prefix) {
  var heatmapPanel = document.getElementById(prefix + '-heatmap-panel');
  var terrainPanel = document.getElementById(prefix + '-terrain-panel');
  if (terrainPanel) terrainPanel.style.display = 'none';
  if (heatmapPanel) heatmapPanel.style.display = '';
}

// ── Unified Visualizer: shared rotation state (kept for legacy/probe animation) ─
var _pvizRotX = 60, _pvizRotY = 0, _pvizRotZ = -35;
var _pvizDragActive = false, _pvizDragLastX = 0, _pvizDragLastY = 0;

function pvizApplyAllRotations() {
  var t = 'rotateX(' + _pvizRotX + 'deg) rotateY(' + _pvizRotY + 'deg) rotateZ(' + _pvizRotZ + 'deg)';
  ['sm-pviz-3dscene', 'res-pviz-3dscene', 'surf-pviz-3dscene'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.style.transform = t;
  });
}

function pvizResetView() {
  _pvizRotX = 60; _pvizRotY = 0; _pvizRotZ = -35;
  pvizApplyAllRotations();
  // Reset Three.js cameras for unified visualizers
  ['sm', 'res', 'surf', 'face', 'relief', 'comb'].forEach(function(p) {
    var s = _threeState[p];
    if (s && s.controls) { s.camera.position.set(120, 80, 120); s.camera.lookAt(0, 0, 0); s.controls.reset(); }
  });
}

// Legacy aliases kept for backward compat
function resVizResetView()  { pvizResetView(); }
function surfVizResetView() { pvizResetView(); }

function initPvizRotation(sceneId) {
  // OrbitControls on the Three.js canvas handles drag/rotate/zoom/pan.
  // Wire up the reset button (z-index:10 overlay) and dblclick reset once per scene.
  // Note: face-pviz-scene uses initFacePVizRotation (calls facePVizResetView instead
  // of pvizResetView) and comb-pviz-scene uses initCombVizRotation.
  var scene = document.getElementById(sceneId);
  if (!scene || scene._pvizRotInited) return;
  scene._pvizRotInited = true;
  // Map scene ID to the corresponding reset-button ID (face/comb handled separately)
  var prefixMap = { 'sm-pviz-scene': 'sm', 'res-pviz-scene': 'res', 'surf-pviz-scene': 'surf', 'resface-pviz-scene': 'resface' };
  var prefix = prefixMap[sceneId];
  scene.addEventListener('dblclick', pvizResetView);
  var resetBtnId = prefix ? (prefix + '-pviz-reset-btn') : null;
  var resetBtn = resetBtnId ? document.getElementById(resetBtnId) : null;
  if (resetBtn && !resetBtn._pvizResetInited) {
    resetBtn._pvizResetInited = true;
    resetBtn.addEventListener('click', function(e) { e.stopPropagation(); pvizResetView(); });
  }
}

// Legacy aliases
function smPvizInitRotation() { initPvizRotation('sm-pviz-scene'); }
function initResVizRotation()  { initPvizRotation('res-pviz-scene'); }

function renderResVizMesh() {
  renderThreeUnified3D('res');
}

// ── Results Tab Face 3D Visualizer ────────────────────────────────────────────
function initResFaceVizRotation() { initPvizRotation('resface-pviz-scene'); }

function resFaceVizResetView() {
  var s = _threeState['resface'];
  if (s && s.controls) { s.camera.position.set(120, 80, 120); s.camera.lookAt(0, 0, 0); s.controls.reset(); }
}

function renderResFaceVizMesh() {
  renderThreeUnified3D('resface');
}

// ── Surface Mesh Tab 3D Visualizer ────────────────────────────────────────────
function initSurfVizRotation() { initPvizRotation('surf-pviz-scene'); }

function renderSurfVizMesh() {
  renderThreeUnified3D('surf');
}

// ── Relief Map Visualization ──────────────────────────────────────────────────

function zToColorRelief(t) {
  // Multi-stop gradient: blue → cyan → green → yellow → orange → red
  var stops = [
    {t: 0.0, r: 0,   g: 0,   b: 255},
    {t: 0.2, r: 0,   g: 255, b: 255},
    {t: 0.4, r: 0,   g: 255, b: 0},
    {t: 0.6, r: 255, g: 255, b: 0},
    {t: 0.8, r: 255, g: 136, b: 0},
    {t: 1.0, r: 255, g: 0,   b: 0}
  ];
  t = Math.max(0, Math.min(1, t));
  var i = 0;
  while (i < stops.length - 1 && t > stops[i + 1].t) i++;
  var s0 = stops[i], s1 = stops[i + 1];
  var f = (t - s0.t) / (s1.t - s0.t);
  return {
    r: Math.round(s0.r + f * (s1.r - s0.r)),
    g: Math.round(s0.g + f * (s1.g - s0.g)),
    b: Math.round(s0.b + f * (s1.b - s0.b))
  };
}

// renderReliefMap: renders a canvas-based topographic heatmap.
// points: array of {px, py, val} where px/py are data coordinates and val is
//         the value mapped to color (e.g. Z for surface, Y-contact for face).
// cfg: { xLabel, yLabel, valueLabel, contourInterval, gridCols, gridRows }
//      gridCols/gridRows: number of unique x/y positions (used for bilinear interp)
// The points array must be on a regular grid sorted by py ascending then px ascending.
function renderReliefMap(canvasId, tooltipId, points, cfg) {
  var canvas = document.getElementById(canvasId);
  if (!canvas) return;

  // Collect unique sorted px and py values — cache toFixed(6) keys to avoid
  // redundant floating-point formatting across the three phases below.
  var pxSet = {}, pySet = {};
  var pxKeys = new Array(points.length), pyKeys = new Array(points.length);
  points.forEach(function(p, i) {
    var kx = p.px.toFixed(6), ky = p.py.toFixed(6);
    pxSet[kx] = p.px; pySet[ky] = p.py;
    pxKeys[i] = kx; pyKeys[i] = ky;
  });
  var xs = Object.values(pxSet).sort(function(a, b) { return a - b; });
  var ys = Object.values(pySet).sort(function(a, b) { return a - b; });
  var nCols = xs.length, nRows = ys.length;
  if (nCols < 2 || nRows < 2) return;

  // Build lookup grid[col][row] = val — reuse cached keys
  var xIdx = {}, yIdx = {};
  xs.forEach(function(v, i) { xIdx[v.toFixed(6)] = i; });
  ys.forEach(function(v, i) { yIdx[v.toFixed(6)] = i; });
  var grid = [];
  for (var c = 0; c < nCols; c++) { grid.push(new Array(nRows).fill(null)); }
  points.forEach(function(p, i) {
    var ci = xIdx[pxKeys[i]], ri = yIdx[pyKeys[i]];
    if (ci != null && ri != null) grid[ci][ri] = p.val;
  });

  // Value range
  var valMin = Infinity, valMax = -Infinity;
  points.forEach(function(p) { if (p.val < valMin) valMin = p.val; if (p.val > valMax) valMax = p.val; });
  var valSpan = (valMax - valMin) || 1;

  // Canvas sizing
  var padL = 54, padR = 70, padT = 22, padB = 36;
  var aspectRatio = (ys[nRows-1] - ys[0]) / (xs[nCols-1] - xs[0]);
  if (!isFinite(aspectRatio) || aspectRatio <= 0) aspectRatio = 0.5;
  var containerW = canvas.offsetWidth || 600;
  var plotW = containerW - padL - padR;
  var plotH = Math.max(180, Math.min(plotW * aspectRatio, 500));
  var totalH = plotH + padT + padB;
  canvas.width = containerW;
  canvas.height = totalH;
  canvas.style.height = totalH + 'px';

  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, containerW, totalH);

  var xDataMin = xs[0], xDataMax = xs[nCols-1], xDataSpan = xDataMax - xDataMin || 1;
  var yDataMin = ys[0], yDataMax = ys[nRows-1], yDataSpan = yDataMax - yDataMin || 1;

  function dataToCanvas(px, py) {
    return {
      cx: padL + (px - xDataMin) / xDataSpan * plotW,
      cy: padT + (1 - (py - yDataMin) / yDataSpan) * plotH
    };
  }

  // Bilinear interpolation
  function bilinearVal(px, py) {
    var fx = (px - xDataMin) / xDataSpan * (nCols - 1);
    var fy = (py - yDataMin) / yDataSpan * (nRows - 1);
    var c0 = Math.floor(fx), c1 = Math.min(c0 + 1, nCols - 1);
    var r0 = Math.floor(fy), r1 = Math.min(r0 + 1, nRows - 1);
    var tx = fx - c0, ty = fy - r0;
    var v00 = grid[c0][r0], v10 = grid[c1][r0], v01 = grid[c0][r1], v11 = grid[c1][r1];
    if (v00 == null || v10 == null || v01 == null || v11 == null) return null;
    return v00 * (1-tx) * (1-ty) + v10 * tx * (1-ty) + v01 * (1-tx) * ty + v11 * tx * ty;
  }

  // Render pixel-by-pixel using ImageData for performance
  var imgData = ctx.createImageData(plotW, plotH);
  var d = imgData.data;
  for (var py2 = 0; py2 < plotH; py2++) {
    var yFrac = 1 - py2 / (plotH - 1);
    var dataY = yDataMin + yFrac * yDataSpan;
    for (var px2 = 0; px2 < plotW; px2++) {
      var xFrac = px2 / (plotW - 1);
      var dataX = xDataMin + xFrac * xDataSpan;
      var val = bilinearVal(dataX, dataY);
      var idx = (py2 * plotW + px2) * 4;
      if (val == null) { d[idx]=13; d[idx+1]=17; d[idx+2]=26; d[idx+3]=255; continue; }
      var t = (val - valMin) / valSpan;
      var col = zToColorRelief(t);
      d[idx] = col.r; d[idx+1] = col.g; d[idx+2] = col.b; d[idx+3] = 255;
    }
  }
  ctx.putImageData(imgData, padL, padT);

  // Contour lines
  var interval = cfg.contourInterval || (valSpan / 6);
  if (interval > 0) {
    var firstContour = Math.ceil(valMin / interval) * interval;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    // Pre-compute per-row Y data values to avoid repeated division in the hot loop
    var plotHm1 = plotH - 1, plotWm1 = plotW - 1;
    var rowDataYa = new Float64Array(plotH);
    var rowDataYb = new Float64Array(plotH);
    for (var ry = 0; ry < plotH; ry++) {
      rowDataYa[ry] = yDataMin + (1 - ry / plotHm1) * yDataSpan;
      rowDataYb[ry] = yDataMin + (1 - (ry + 1) / plotHm1) * yDataSpan;
    }
    for (var cv = firstContour; cv <= valMax + 1e-9; cv += interval) {
      ctx.beginPath();
      for (var px3 = 0; px3 < plotWm1; px3++) {
        var dataX3a = xDataMin + (px3 / plotWm1) * xDataSpan;
        var dataX3b = xDataMin + ((px3 + 1) / plotWm1) * xDataSpan;
        for (var py3 = 0; py3 < plotHm1; py3++) {
          var v0 = bilinearVal(dataX3a, rowDataYa[py3]);
          var v1 = bilinearVal(dataX3b, rowDataYa[py3]);
          var v2 = bilinearVal(dataX3a, rowDataYb[py3]);
          var v3 = bilinearVal(dataX3b, rowDataYb[py3]);
          var a0 = v0 != null && v0 >= cv;
          var a1 = v1 != null && v1 >= cv;
          var a2 = v2 != null && v2 >= cv;
          var a3 = v3 != null && v3 >= cv;
          // Cell crosses contour threshold (some vertices above, some below)
          if ((a0 || a1 || a2 || a3) && (!a0 || !a1 || !a2 || !a3)) {
            ctx.moveTo(padL + px3 + 0.5, padT + py3 + 0.5);
            ctx.lineTo(padL + px3 + 1, padT + py3 + 0.5);
          }
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // Probe point markers — batch style state outside loop
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.2;
  points.forEach(function(p) {
    var cp = dataToCanvas(p.px, p.py);
    ctx.beginPath();
    ctx.arc(cp.cx, cp.cy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();

  // Axis labels and ticks
  ctx.save();
  ctx.fillStyle = 'var(--muted, #888)';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  // X axis ticks and labels
  xs.forEach(function(xv) {
    var cx = padL + (xv - xDataMin) / xDataSpan * plotW;
    ctx.fillStyle = 'rgba(150,160,180,0.8)';
    ctx.fillRect(cx - 0.5, padT + plotH, 1, 4);
    ctx.fillStyle = 'var(--muted, #888)';
    ctx.fillText(xv.toFixed(1), cx, padT + plotH + 13);
  });
  ctx.textAlign = 'center';
  ctx.fillText(cfg.xLabel || 'X (coords)', padL + plotW / 2, totalH - 2);
  // Y axis ticks and labels — skip labels that would overlap (min 12px spacing)
  ctx.textAlign = 'right';
  var lastLabelY = -Infinity;
  ys.forEach(function(yv) {
    var cp = dataToCanvas(xs[0], yv);
    ctx.fillStyle = 'rgba(150,160,180,0.8)';
    ctx.fillRect(padL - 4, cp.cy - 0.5, 4, 1);
    if (cp.cy - lastLabelY >= 12) {
      ctx.fillStyle = 'var(--muted, #888)';
      ctx.fillText(yv.toFixed(1), padL - 6, cp.cy + 3);
      lastLabelY = cp.cy;
    }
  });
  ctx.save();
  ctx.translate(11, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText(cfg.yLabel || 'Y (coords)', 0, 0);
  ctx.restore();
  ctx.restore();

  // Color legend bar
  var legendX = padL + plotW + 8, legendW = 14;
  var legendGrad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
  var gradStops = [
    [0.0, '#FF0000'], [0.2, '#FF8800'], [0.4, '#FFFF00'],
    [0.6, '#00FF00'], [0.8, '#00FFFF'], [1.0, '#0000FF']
  ];
  gradStops.forEach(function(s) { legendGrad.addColorStop(s[0], s[1]); });
  ctx.fillStyle = legendGrad;
  ctx.fillRect(legendX, padT, legendW, plotH);
  ctx.strokeStyle = 'rgba(150,160,180,0.5)';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(legendX, padT, legendW, plotH);
  // Legend ticks and labels
  ctx.fillStyle = 'var(--muted, #888)';
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  var nTicks = 5;
  for (var ti = 0; ti <= nTicks; ti++) {
    var tf = ti / nTicks;
    var legVal = valMax - tf * valSpan; // top = max, bottom = min
    var legY = padT + tf * plotH;
    ctx.fillStyle = 'rgba(150,160,180,0.8)';
    ctx.fillRect(legendX + legendW, legY - 0.5, 3, 1);
    ctx.fillStyle = 'var(--muted, #888)';
    ctx.fillText(legVal.toFixed(2), legendX + legendW + 5, legY + 3);
  }
  ctx.fillStyle = 'var(--muted, #888)';
  ctx.font = '9px monospace';
  ctx.save();
  ctx.translate(legendX + legendW + 42, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText(cfg.valueLabel || 'Z (coords)', 0, 0);
  ctx.restore();

  // Hover tooltip
  var tooltipEl = document.getElementById(tooltipId);
  canvas.onmousemove = function(e) {
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width / rect.width;
    var scaleY = canvas.height / rect.height;
    var mx = (e.clientX - rect.left) * scaleX;
    var my = (e.clientY - rect.top) * scaleY;
    if (mx < padL || mx > padL + plotW || my < padT || my > padT + plotH) {
      if (tooltipEl) tooltipEl.textContent = 'Hover over map for values';
      return;
    }
    var fx = (mx - padL) / plotW;
    var fy = 1 - (my - padT) / plotH;
    var dataX = xDataMin + fx * xDataSpan;
    var dataY = yDataMin + fy * yDataSpan;
    var val = bilinearVal(dataX, dataY);
    if (tooltipEl && val != null) {
      tooltipEl.textContent = (cfg.xLabel || 'X') + ': ' + dataX.toFixed(3) + '  ' +
        (cfg.yLabel || 'Y') + ': ' + dataY.toFixed(3) + '  ' +
        (cfg.valueLabel || 'Z') + ': ' + val.toFixed(3);
    }
  };
  canvas.onmouseleave = function() {
    if (tooltipEl) tooltipEl.textContent = 'Hover over map for values';
  };
}

function renderSurfaceReliefMap() {
  var grid = smMeshData, cfg = smGridConfig;
  if (!grid || !cfg || cfg.rowCount < 2 || cfg.colCount < 2) return;
  var points = [];
  var zMin = Infinity, zMax = -Infinity;
  for (var ri = 0; ri < cfg.rowCount; ri++) {
    for (var ci = 0; ci < cfg.colCount; ci++) {
      var z = grid[ri] && grid[ri][ci];
      if (z == null || !isFinite(z)) continue;
      points.push({
        px: cfg.minX + ci * cfg.colSpacing,
        py: cfg.minY + ri * cfg.rowSpacing,
        val: z
      });
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
    }
  }
  if (points.length < 4) return;
  pluginDebug('renderSurfaceReliefMap: mode=surface projection=XY points=' + points.length + ' Z=' + zMin.toFixed(3) + ' to ' + zMax.toFixed(3));
  var reliefCfg = { xLabel: 'X (coords)', yLabel: 'Y (coords)', valueLabel: 'Z (coords)', gridCols: cfg.colCount, gridRows: cfg.rowCount };
  // Render to all surface relief canvas instances (Mesh Data tab, Probe tab, Results tab).
  // Skip any canvas whose element is not in the DOM (e.g. if a tab has not yet been rendered).
  ['surface-relief-canvas', 'sm-surface-relief-canvas', 'res-surface-relief-canvas'].forEach(function(canvasId) {
    if (!document.getElementById(canvasId)) return;
    var tooltipId = canvasId.replace('-canvas', '-tooltip');
    renderReliefMap(canvasId, tooltipId, points, reliefCfg);
  });
}

function renderFaceReliefMap() {
  var data = getFaceMeshData();
  if (!data || data.length < 4) return;

  // Face probe Z depths (layerZ) are computed per-sample from sampleTopZ, so they
  // differ slightly between X positions for the same layer number.  Using actual Z
  // values as the grid row key produces a sparse grid where bilinear interpolation
  // returns null for most pixels.  Instead we use the average Z per layer as the
  // canonical row coordinate — this is the same value for every X column in the
  // same layer, giving a fully-populated rectangular grid.
  var DEFAULT_LAYER = 1;
  var xKeyToVal = {}, layerZSum = {}, layerZCnt = {};
  data.forEach(function(r) {
    var xv = Number(r.x), yv = Number(r.y), zv = Number(r.z);
    var lv = r.layer != null ? Number(r.layer) : DEFAULT_LAYER;
    if (!isFinite(xv) || !isFinite(yv) || !isFinite(zv)) return;
    var xKey = xv.toFixed(6);
    if (!(xKey in xKeyToVal)) xKeyToVal[xKey] = xv;
    if (!(lv in layerZSum)) { layerZSum[lv] = 0; layerZCnt[lv] = 0; }
    layerZSum[lv] += zv; layerZCnt[lv]++;
  });

  var xs = Object.values(xKeyToVal).sort(function(a, b) { return a - b; });
  var layers = Object.keys(layerZSum).map(Number).sort(function(a, b) { return a - b; });
  var nCols = xs.length, nRows = layers.length;
  if (nCols < 2 || nRows < 2) return;

  // Average Z depth per layer — used as the shared py coordinate for all X columns
  var layerToAvgZ = {};
  layers.forEach(function(l) { layerToAvgZ[l] = layerZSum[l] / layerZCnt[l]; });

  // Build per-(x, layer) average Y contact value to handle any duplicates
  var cellSumY = {}, cellCntY = {};
  data.forEach(function(r) {
    var xv = Number(r.x), yv = Number(r.y);
    var lv = r.layer != null ? Number(r.layer) : DEFAULT_LAYER;
    if (!isFinite(xv) || !isFinite(yv)) return;
    var key = xv.toFixed(6) + '|' + lv;
    if (!(key in cellSumY)) { cellSumY[key] = 0; cellCntY[key] = 0; }
    cellSumY[key] += yv; cellCntY[key]++;
  });

  var points = [];
  var valMin = Infinity, valMax = -Infinity;
  Object.keys(cellSumY).forEach(function(key) {
    var parts = key.split('|');
    var xv = parseFloat(parts[0]);
    var lv = parseInt(parts[1], 10);
    var yv = cellSumY[key] / cellCntY[key];
    var zv = layerToAvgZ[lv];
    if (!isFinite(xv) || !isFinite(yv) || !isFinite(zv)) return;
    points.push({ px: xv, py: zv, val: yv });
    if (yv < valMin) valMin = yv;
    if (yv > valMax) valMax = yv;
  });

  if (points.length < 4) return;
  pluginDebug('renderFaceReliefMap: mode=face projection=XZ points=' + points.length + ' Y-contact=' + valMin.toFixed(3) + ' to ' + valMax.toFixed(3));
  var reliefCfg = { xLabel: 'X (coords)', yLabel: 'Z depth (coords)', valueLabel: 'Y contact (coords)', gridCols: nCols, gridRows: nRows };
  // Render to all face relief canvas instances (Probe tab, Results tab, Mesh Data tab).
  // Show the Mesh Data tab face panel when face data is available.
  // Skip any canvas whose element is not in the DOM (e.g. if a tab has not yet been rendered).
  var surfFacePanel = document.getElementById('surf-face-relief-panel');
  if (surfFacePanel) surfFacePanel.style.display = '';
  ['face-relief-canvas', 'res-face-relief-canvas', 'surf-face-relief-canvas'].forEach(function(canvasId) {
    if (!document.getElementById(canvasId)) return;
    var tooltipId = canvasId.replace('-canvas', '-tooltip');
    renderReliefMap(canvasId, tooltipId, points, reliefCfg);
  });
}

// ── 3D Terrain Relief Visualization ─────────────────────────────────────────

var _reliefRotX = 60;
var _reliefRotY = 0;
var _reliefRotZ = -35;

function reliefApplyRotation() {
  var el = document.getElementById('relief-3d-3dscene');
  if (el) el.style.transform = 'rotateX(' + _reliefRotX + 'deg) rotateY(' + _reliefRotY + 'deg) rotateZ(' + _reliefRotZ + 'deg)';
}

function reliefResetView() {
  _reliefRotX = 60; _reliefRotY = 0; _reliefRotZ = -35;
  reliefApplyRotation();
  // Also reset Three.js camera for relief scene
  var s = _threeState['relief'];
  if (s && s.controls) { s.camera.position.set(120, 80, 120); s.camera.lookAt(0, 0, 0); s.controls.reset(); }
}

function renderRelief3D() {
  // Delegate to Three.js unified renderer (face-only mode for relief-3d-scene)
  renderThreeUnified3D('relief');
}

// ═══════════════════════════════════════════════════════════════════════════════
// THREE.JS WEBGL MESH VISUALIZER — Smooth GPU-accelerated surface + face mesh
// Replaces SVG-based polygon rendering with proper WebGL Phong-shaded geometry.
// Prefixes: 'sm' | 'res' | 'resface' | 'surf' | 'relief' | 'face' | 'comb'
// ═══════════════════════════════════════════════════════════════════════════════

var _threeState = {}; // prefix → {scene, camera, renderer, controls, animId, meshGroup, contourGroup, resizeObs}

function _threeGetOrInit(prefix) {
  if (_threeState[prefix] && _threeState[prefix].renderer) return _threeState[prefix];
  var containerId = (prefix === 'relief') ? 'relief-three-canvas' : prefix + '-three-canvas';
  var container = document.getElementById(containerId);
  if (!container) return null;
  // Dispose any stale state first
  _threeDispose(prefix);
  container.innerHTML = '';
  var w = Math.max(container.clientWidth || container.offsetWidth || 400, 100);
  // Use the scene container's defined height (sm/res/surf=250px, relief=260px)
  var h = (prefix === 'relief') ? 260 : 250;
  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060a10);
  var camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 5000);
  camera.position.set(120, 80, 120);
  camera.lookAt(0, 0, 0);
  var renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);
  var controls;
  if (typeof THREE.OrbitControls === 'function') {
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  } else {
    // Fallback built-in orbit/zoom controls when OrbitControls CDN fails to load
    // Initial values matched to camera.position.set(120, 80, 120) / lookAt(0,0,0)
    var _fbDist = 188, _fbPhi = 1.13, _fbTheta = 0.785;
    var _fbPanX = 0, _fbPanY = 0;
    var _fbDrag = false, _fbBtn = 0, _fbPX = 0, _fbPY = 0;
    var _fbCamUpdate = function() {
      var sinP = Math.sin(_fbPhi), cosP = Math.cos(_fbPhi);
      var sinT = Math.sin(_fbTheta), cosT = Math.cos(_fbTheta);
      camera.position.set(
        _fbPanX + _fbDist * sinP * sinT,
        _fbPanY + _fbDist * cosP,
        _fbDist * sinP * cosT
      );
      camera.lookAt(_fbPanX, _fbPanY, 0);
    }
    _fbCamUpdate();
    var _fbEl = renderer.domElement;
    _fbEl.addEventListener('mousedown', function(e) {
      e.preventDefault(); _fbDrag = true; _fbBtn = e.button; _fbPX = e.clientX; _fbPY = e.clientY;
    });
    _fbEl.addEventListener('mousemove', function(e) {
      if (!_fbDrag) return;
      var dx = e.clientX - _fbPX, dy = e.clientY - _fbPY;
      _fbPX = e.clientX; _fbPY = e.clientY;
      if (_fbBtn === 0) { // left: rotate
        _fbTheta -= dx * 0.01;
        _fbPhi = Math.max(0.05, Math.min(Math.PI - 0.05, _fbPhi + dy * 0.01));
      } else if (_fbBtn === 2) { // right: pan
        var scale = _fbDist / 200;
        _fbPanX -= dx * scale * 0.3;
        _fbPanY += dy * scale * 0.3;
      }
      _fbCamUpdate();
    });
    _fbEl.addEventListener('mouseup', function() { _fbDrag = false; });
    _fbEl.addEventListener('mouseleave', function() { _fbDrag = false; });
    _fbEl.addEventListener('wheel', function(e) {
      e.preventDefault();
      _fbDist = Math.max(20, Math.min(800, _fbDist + e.deltaY * 0.3));
      _fbCamUpdate();
    }, { passive: false });
    _fbEl.addEventListener('contextmenu', function(e) { e.preventDefault(); });
    controls = {
      update: function() {},
      reset: function() { _fbDist = 188; _fbPhi = 1.13; _fbTheta = 0.785; _fbPanX = 0; _fbPanY = 0; _fbCamUpdate(); },
      enableDamping: false, mouseButtons: {}
    };
    console.warn('THREE.OrbitControls not available — using built-in fallback controls');
  }
  // Lighting: ambient + two directional lights for Phong shading
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  var dl1 = new THREE.DirectionalLight(0xffffff, 0.8); dl1.position.set(1, 2, 1); scene.add(dl1);
  var dl2 = new THREE.DirectionalLight(0x6688cc, 0.3); dl2.position.set(-1, 0.5, -1); scene.add(dl2);
  var state = { scene: scene, camera: camera, renderer: renderer, controls: controls,
                animId: null, meshGroup: null, contourGroup: null, resizeObs: null };
  _threeState[prefix] = state;
  // Skip rendering while the tab is hidden to save CPU/GPU across all 3D scenes
  (function animate() { state.animId = requestAnimationFrame(animate); if (!document.hidden) { controls.update(); renderer.render(scene, camera); } })();
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function() {
      var nw = container.clientWidth;
      if (nw > 10) { renderer.setSize(nw, h); camera.aspect = nw / h; camera.updateProjectionMatrix(); }
    });
    ro.observe(container);
    state.resizeObs = ro;
  }
  return state;
}

function _threeDispose(prefix) {
  var s = _threeState[prefix]; if (!s) return;
  if (s.animId) cancelAnimationFrame(s.animId);
  if (s.resizeObs) s.resizeObs.disconnect();
  if (s.renderer) { s.renderer.dispose(); var dom = s.renderer.domElement; if (dom && dom.parentNode) dom.parentNode.removeChild(dom); }
  delete _threeState[prefix];
}

// Color gradient: t=0 (low/deep) → blue/purple, t=1 (high/shallow) → red/orange
function _threeZCol(z, zMin, zMax) {
  var t = (zMax > zMin) ? Math.max(0, Math.min(1, (z - zMin) / (zMax - zMin))) : 0.5;
  var r, g, b, f;
  if (t < 0.25)      { f = t / 0.25;          r = 0;             g = Math.round(f * 128);       b = Math.round(180 + f * 75); }
  else if (t < 0.5)  { f = (t - 0.25) / 0.25; r = 0;             g = Math.round(128 + f * 127); b = Math.round(255 - f * 255); }
  else if (t < 0.75) { f = (t - 0.5) / 0.25;  r = Math.round(f * 255); g = 255; b = 0; }
  else               { f = (t - 0.75) / 0.25;  r = 255;           g = Math.round(255 - f * 180); b = 0; }
  return [r / 255, g / 255, b / 255];
}

// ── Mesh Subdivision Utilities ────────────────────────────────────────────────

/**
 * subdivideSurfaceMesh(grid, cfg, spacing)
 * Densifies a surface probe grid using bilinear interpolation.
 * Returns { grid, config } with updated colCount/rowCount/colSpacing/rowSpacing.
 * spacing = target point spacing in mm (e.g. 2). 0 / falsy = no subdivision.
 */
function subdivideSurfaceMesh(grid, cfg, spacing) {
  if (!grid || !cfg || !spacing || spacing <= 0) return { grid: grid, config: cfg };
  var nRows = cfg.rowCount, nCols = cfg.colCount;
  if (nRows < 2 || nCols < 2) return { grid: grid, config: cfg };

  var colSub = Math.max(1, Math.round(cfg.colSpacing / spacing));
  var rowSub = Math.max(1, Math.round(cfg.rowSpacing / spacing));
  if (colSub === 1 && rowSub === 1) return { grid: grid, config: cfg };

  var newCols = (nCols - 1) * colSub + 1;
  var newRows = (nRows - 1) * rowSub + 1;

  var newGrid = [];
  for (var gy = 0; gy < newRows; gy++) {
    var row = [];
    var cy = Math.min(Math.floor(gy / rowSub), nRows - 2);
    var ty = (gy - cy * rowSub) / rowSub;
    for (var gx = 0; gx < newCols; gx++) {
      var cx = Math.min(Math.floor(gx / colSub), nCols - 2);
      var tx = (gx - cx * colSub) / colSub;
      var z00 = grid[cy][cx], z10 = grid[cy][cx + 1];
      var z01 = grid[cy + 1][cx], z11 = grid[cy + 1][cx + 1];
      if (z00 == null || z10 == null || z01 == null || z11 == null ||
          !isFinite(z00) || !isFinite(z10) || !isFinite(z01) || !isFinite(z11)) {
        row.push(null);
      } else {
        row.push(z00 * (1 - tx) * (1 - ty) + z10 * tx * (1 - ty) +
                 z01 * (1 - tx) * ty + z11 * tx * ty);
      }
    }
    newGrid.push(row);
  }

  var newConfig = {};
  for (var k in cfg) { if (cfg.hasOwnProperty(k)) newConfig[k] = cfg[k]; }
  newConfig.colCount = newCols;
  newConfig.rowCount = newRows;
  newConfig.colSpacing = cfg.colSpacing / colSub;
  newConfig.rowSpacing = cfg.rowSpacing / rowSub;
  newConfig.maxX = cfg.minX + (newCols - 1) * newConfig.colSpacing;
  newConfig.maxY = cfg.minY + (newRows - 1) * newConfig.rowSpacing;

  return { grid: newGrid, config: newConfig };
}

/**
 * subdivideFaceMesh(pts, spacing)
 * Densifies a face probe point array using bilinear interpolation on the
 * X-sample × layer grid.  Returns a new flat array of interpolated points.
 * Each interpolated point inherits layer, sampleTopZ, and machineZ from
 * the nearest grid node.  spacing = target point spacing in mm. 0 = no-op.
 */
function subdivideFaceMesh(pts, spacing) {
  if (!pts || pts.length < 4 || !spacing || spacing <= 0) return pts;

  // Collect unique X positions and unique layer numbers
  var xKeyMap = {}, layerNums = {};
  pts.forEach(function(p) {
    var xv = Number(p.x), lv = p.layer != null ? Number(p.layer) : 1;
    if (!isFinite(xv) || !isFinite(Number(p.y)) || !isFinite(Number(p.z))) return;
    xKeyMap[xv.toFixed(6)] = xv;
    layerNums[lv] = true;
  });

  var xs = Object.values(xKeyMap).sort(function(a, b) { return a - b; });
  var layers = Object.keys(layerNums).map(Number).sort(function(a, b) { return a - b; });
  var nCols = xs.length, nRows = layers.length;
  if (nCols < 2 || nRows < 2) return pts;

  // Build average-Z per layer (same approach as renderFaceReliefMap)
  var layerZSum = {}, layerZCnt = {};
  pts.forEach(function(p) {
    var lv = p.layer != null ? Number(p.layer) : 1;
    var zv = Number(p.z);
    if (!isFinite(zv)) return;
    if (!(lv in layerZSum)) { layerZSum[lv] = 0; layerZCnt[lv] = 0; }
    layerZSum[lv] += zv; layerZCnt[lv]++;
  });
  var layerAvgZ = {};
  layers.forEach(function(l) { layerAvgZ[l] = layerZSum[l] / layerZCnt[l]; });

  // Build 2D grid [colIdx][rowIdx] → { y, machineZ, sampleTopZ }
  var grid = [];
  for (var ci = 0; ci < nCols; ci++) { grid.push(new Array(nRows).fill(null)); }
  var xiMap = {}, liMap = {};
  xs.forEach(function(x, i) { xiMap[x.toFixed(6)] = i; });
  layers.forEach(function(l, i) { liMap[l] = i; });

  // Average Y (and machineZ, sampleTopZ) per cell to handle duplicates
  var cellSumY = {}, cellSumMZ = {}, cellSumST = {}, cellCnt = {};
  pts.forEach(function(p) {
    var xv = Number(p.x), yv = Number(p.y), zv = Number(p.z);
    var lv = p.layer != null ? Number(p.layer) : 1;
    if (!isFinite(xv) || !isFinite(yv) || !isFinite(zv)) return;
    var key = xv.toFixed(6) + '|' + lv;
    if (!(key in cellCnt)) { cellSumY[key] = 0; cellSumMZ[key] = 0; cellSumST[key] = 0; cellCnt[key] = 0; }
    cellSumY[key] += yv;
    cellSumMZ[key] += (p.machineZ != null ? Number(p.machineZ) : 0);
    cellSumST[key] += (p.sampleTopZ != null ? Number(p.sampleTopZ) : 0);
    cellCnt[key]++;
  });
  Object.keys(cellCnt).forEach(function(key) {
    var parts = key.split('|');
    var xv = parseFloat(parts[0]), lv = parseInt(parts[1], 10);
    var xi = xiMap[xv.toFixed(6)], li = liMap[lv];
    if (xi == null || li == null) return;
    var cnt = cellCnt[key];
    grid[xi][li] = {
      y: cellSumY[key] / cnt,
      machineZ: cellSumMZ[key] / cnt,
      sampleTopZ: cellSumST[key] / cnt
    };
  });

  // Determine subdivisions per cell
  var xSpacings = [];
  for (var i = 0; i < nCols - 1; i++) xSpacings.push(xs[i + 1] - xs[i]);
  var avgXSpacing = xSpacings.reduce(function(a, b) { return a + b; }, 0) / xSpacings.length;
  var zSpacings = [];
  for (var j = 0; j < nRows - 1; j++) zSpacings.push(Math.abs(layerAvgZ[layers[j + 1]] - layerAvgZ[layers[j]]));
  var avgZSpacing = zSpacings.reduce(function(a, b) { return a + b; }, 0) / zSpacings.length;

  var xSub = Math.max(1, Math.round(avgXSpacing / spacing));
  var zSub = Math.max(1, Math.round(avgZSpacing / spacing));
  if (xSub === 1 && zSub === 1) return pts;

  var newPts = [];
  var newCols = (nCols - 1) * xSub + 1;
  var newRows = (nRows - 1) * zSub + 1;

  for (var gy = 0; gy < newRows; gy++) {
    var li0 = Math.min(Math.floor(gy / zSub), nRows - 2);
    var ty = (gy - li0 * zSub) / zSub;
    var newZ = layerAvgZ[layers[li0]] * (1 - ty) + layerAvgZ[layers[li0 + 1]] * ty;
    var nearLi = ty < 0.5 ? li0 : li0 + 1;
    var nearLayer = layers[nearLi];

    for (var gx = 0; gx < newCols; gx++) {
      var xi0 = Math.min(Math.floor(gx / xSub), nCols - 2);
      var tx = (gx - xi0 * xSub) / xSub;
      var newX = xs[xi0] * (1 - tx) + xs[xi0 + 1] * tx;

      var c00 = grid[xi0][li0], c10 = grid[xi0 + 1][li0];
      var c01 = grid[xi0][li0 + 1], c11 = grid[xi0 + 1][li0 + 1];
      if (!c00 || !c10 || !c01 || !c11) continue;

      var newY = c00.y * (1 - tx) * (1 - ty) + c10.y * tx * (1 - ty) +
                 c01.y * (1 - tx) * ty + c11.y * tx * ty;
      var newMZ = c00.machineZ * (1 - tx) * (1 - ty) + c10.machineZ * tx * (1 - ty) +
                  c01.machineZ * (1 - tx) * ty + c11.machineZ * tx * ty;
      var newST = c00.sampleTopZ * (1 - tx) * (1 - ty) + c10.sampleTopZ * tx * (1 - ty) +
                  c01.sampleTopZ * (1 - tx) * ty + c11.sampleTopZ * tx * ty;

      newPts.push({
        x: newX, y: newY, z: newZ,
        machineZ: newMZ, sampleTopZ: newST,
        layer: nearLayer
      });
    }
  }

  return newPts.length >= pts.length ? newPts : pts;
}

// Smooth subdivided surface mesh with bilinear interpolation between probe points
function _buildThreeSurface(grid, cfg, zMin, zMax, zExag) {
  var SUB = 8;
  var spanX = (cfg.maxX - cfg.minX) || 1, spanY = (cfg.maxY - cfg.minY) || 1;
  var maxSpan = Math.max(spanX, spanY);
  var xCenter = (cfg.minX + cfg.maxX) / 2, yCenter = (cfg.minY + cfg.maxY) / 2;
  var zMid = (zMin + zMax) / 2, zScale = 30 / maxSpan;
  var nCX = cfg.colCount - 1, nCY = cfg.rowCount - 1;
  // Unified vertex grid: shared vertices at cell boundaries allow
  // computeVertexNormals() to average normals across the entire mesh.
  var totalCols = nCX * SUB + 1, totalRows = nCY * SUB + 1;
  var totalVerts = totalCols * totalRows;
  var pos = new Array(totalVerts * 3);
  var col = new Array(totalVerts * 3);
  var idx = [];
  function biZ(cy, cx, tx, ty) {
    var z00=grid[cy][cx],z10=grid[cy][cx+1],z01=grid[cy+1][cx],z11=grid[cy+1][cx+1];
    if (z00==null||z10==null||z01==null||z11==null) return null;
    if (!isFinite(z00)||!isFinite(z10)||!isFinite(z01)||!isFinite(z11)) return null;
    return z00*(1-tx)*(1-ty)+z10*tx*(1-ty)+z01*(1-tx)*ty+z11*tx*ty;
  }
  // gy ranges [0, nCY*SUB] so cy clamps to nCY-1 and ty stays in [0,1].
  for (var gy=0; gy<totalRows; gy++) {
    var cy=Math.min(Math.floor(gy/SUB), nCY-1), ty=(gy-cy*SUB)/SUB;
    var rowOff = gy * totalCols;
    for (var gx=0; gx<totalCols; gx++) {
      var cx=Math.min(Math.floor(gx/SUB), nCX-1), tx=(gx-cx*SUB)/SUB;
      var vIdx=rowOff+gx;
      var z=biZ(cy,cx,tx,ty); if (z===null) z=zMid;
      pos[vIdx*3]  =(cfg.minX+(cx+tx)*cfg.colSpacing-xCenter)/maxSpan*100;
      pos[vIdx*3+1]=(z-zMid)*zExag*zScale;
      pos[vIdx*3+2]=-((cfg.minY+(cy+ty)*cfg.rowSpacing)-yCenter)/maxSpan*100;
      var c=_threeZCol(z,zMin,zMax);
      col[vIdx*3]=c[0]; col[vIdx*3+1]=c[1]; col[vIdx*3+2]=c[2];
    }
  }
  for (var gy2=0; gy2<totalRows-1; gy2++) {
    var rowOff2 = gy2 * totalCols;
    var nextRowOff = (gy2 + 1) * totalCols;
    for (var gx2=0; gx2<totalCols-1; gx2++) {
      var i00=rowOff2+gx2, i10=i00+1, i01=nextRowOff+gx2, i11=i01+1;
      idx.push(i00,i10,i01, i10,i11,i01);
    }
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  return { geo: geo, xCenter: xCenter, yCenter: yCenter, maxSpan: maxSpan, zMid: zMid, zScale: zScale };
}

// Face wall geometry — placed at the front edge of the surface, vertical.
// World-space mapping:
//   X = sample X position (no lateral shift)
//   Y = layer Z height (vertical position of each probe layer)
//   Z = frontZ + contact-Y deviation + layerFrac*FACE_LATERAL_SLANT (top leans outward, bottom is flush)
// Color: mapped to contact Y (r.y) so variations in face flatness appear as rainbow terrain.
var FACE_LATERAL_SLANT = 10; // scene units; top layer (layerFrac=1) leans this far toward viewer
function _buildThreeFaceWall(faceWall, cfg, zMin, zMax, zExag, si) {
  if (!faceWall) return null;
  var faceXSpan = (faceWall.xMax - faceWall.xMin) || 1;
  var faceZSpan = (faceWall.zMax - faceWall.zMin) || 1;
  var maxSpan = si ? si.maxSpan : Math.max(faceXSpan, faceZSpan);
  var xCenter = si ? si.xCenter : (faceWall.xMin + faceWall.xMax) / 2;
  var yCenter = si ? si.yCenter : 0;
  var zMid    = si ? si.zMid   : (zMin + zMax) / 2;
  var zScale  = si ? si.zScale : 30 / maxSpan;
  var frontZ  = (si && cfg) ? -((cfg.minY - yCenter) / maxSpan * 100) : 0;
  // Contact Y (r.y) range — represents the actual face-shape dimension
  var cMin = isFinite(faceWall.yMin) ? faceWall.yMin : 0;
  var cMax = isFinite(faceWall.yMax) ? faceWall.yMax : 1;
  var cMid = (cMin + cMax) / 2;
  // Outward slant: shallower (top) layers lean toward viewer; layerFrac=1=top gets full slant
  var lateralSlant = FACE_LATERAL_SLANT;
  var SUB = 8; // subdivision for smooth shading (matches surface mesh)
  var nCX = faceWall.nCols - 1, nCY = faceWall.nRows - 1;
  if (nCX < 1 || nCY < 1) return null;
  // Unified vertex grid: shared vertices at cell boundaries allow
  // computeVertexNormals() to average normals across all cells — eliminates
  // the sharp crease / wrong-angle artifacts caused by per-cell duplicate vertices.
  var totalCols = nCX * SUB + 1, totalRows = nCY * SUB + 1;
  var totalVerts = totalCols * totalRows;
  var posArr = new Array(totalVerts * 3);
  var colArr = new Array(totalVerts * 3);
  // 1 byte per vertex: 0=unfilled, 1=filled (avoids recomputing shared boundary verts)
  var filled = new Uint8Array(totalVerts);
  // Pre-check cell validity (all 4 corners present with finite Z)
  var validCell = [];
  for (var xi=0; xi<nCX; xi++) { validCell[xi] = [];
    for (var li=0; li<nCY; li++) {
      var r00=faceWall.grid[xi]&&faceWall.grid[xi][li], r10=faceWall.grid[xi+1]&&faceWall.grid[xi+1][li];
      var r01=faceWall.grid[xi]&&faceWall.grid[xi][li+1], r11=faceWall.grid[xi+1]&&faceWall.grid[xi+1][li+1];
      if (!r00||!r10||!r01||!r11) { validCell[xi][li]=false; continue; }
      validCell[xi][li]=isFinite(Number(r00.z))&&isFinite(Number(r10.z))&&isFinite(Number(r01.z))&&isFinite(Number(r11.z));
    }
  }
  // Fill vertices from valid cells into the unified grid
  var nRowsM1 = Math.max(faceWall.nRows - 1, 1);
  for (var xi=0; xi<nCX; xi++) {
    var baseGx = xi * SUB;
    for (var li=0; li<nCY; li++) {
      if (!validCell[xi][li]) continue;
      var r00=faceWall.grid[xi][li], r10=faceWall.grid[xi+1][li];
      var r01=faceWall.grid[xi][li+1], r11=faceWall.grid[xi+1][li+1];
      var z00=Number(r00.z),z10=Number(r10.z),z01=Number(r01.z),z11=Number(r11.z);
      var cy00=Number(r00.y),cy10=Number(r10.y),cy01=Number(r01.y),cy11=Number(r11.y);
      var x00=Number(r00.x), x10=Number(r10.x);
      var baseGy = li * SUB;
      for (var sy=0; sy<=SUB; sy++) {
        var gy = baseGy + sy;
        var rowOff = gy * totalCols;
        for (var sx=0; sx<=SUB; sx++) {
          var vIdx = rowOff + baseGx + sx;
          if (filled[vIdx]) continue; // skip if already filled by a previously processed cell
          var tx=sx/SUB, ty=sy/SUB;
          var mx=x00+tx*(x10-x00);
          var mz=z00*(1-tx)*(1-ty)+z10*tx*(1-ty)+z01*(1-tx)*ty+z11*tx*ty;
          var mc=cy00*(1-tx)*(1-ty)+cy10*tx*(1-ty)+cy01*(1-tx)*ty+cy11*tx*ty;
          var layerFrac = (li + ty) / nRowsM1;
          var worldX = (mx-xCenter)/maxSpan*100;
          var worldY = (mz-zMid)*zExag*zScale;
          var worldZ = frontZ + (mc - cMid) * zExag * zScale + layerFrac * lateralSlant;
          posArr[vIdx*3]=worldX; posArr[vIdx*3+1]=worldY; posArr[vIdx*3+2]=worldZ;
          var c=_threeZCol(mc, cMin, cMax);
          colArr[vIdx*3]=c[0]; colArr[vIdx*3+1]=c[1]; colArr[vIdx*3+2]=c[2];
          filled[vIdx] = 1;
        }
      }
    }
  }
  // Build triangle indices for sub-quads within valid cells only
  var idx = [];
  for (var xi=0; xi<nCX; xi++) {
    var bGx = xi * SUB;
    for (var li=0; li<nCY; li++) {
      if (!validCell[xi][li]) continue;
      var bGy = li * SUB;
      for (var sy=0; sy<SUB; sy++) {
        var rowOff2 = (bGy + sy) * totalCols;
        var nextRowOff2 = rowOff2 + totalCols;
        for (var sx=0; sx<SUB; sx++) {
          var i00=rowOff2+bGx+sx, i10=i00+1, i01=nextRowOff2+bGx+sx, i11=i01+1;
          idx.push(i00,i10,i01, i10,i11,i01);
        }
      }
    }
  }
  if (idx.length === 0) return null;
  // Zero-fill any unfilled vertices (unreferenced by triangles — no visual effect)
  for (var i=0; i<totalVerts; i++) {
    if (!filled[i]) { posArr[i*3]=0; posArr[i*3+1]=0; posArr[i*3+2]=0;
                      colArr[i*3]=0; colArr[i*3+1]=0; colArr[i*3+2]=0; }
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(colArr, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  return { geo: geo, frontZ: frontZ };
}

// Bridge geometry: fills the height gap between surface front row and face wall top edge
function _buildThreeBridge(grid, cfg, faceWall, zMin, zMax, zExag, si) {
  if (!grid||!cfg||!faceWall||!si) return null;
  var maxSpan=si.maxSpan, xCenter=si.xCenter, yCenter=si.yCenter, zMid=si.zMid, zScale=si.zScale;
  var frontZ = -((cfg.minY - yCenter) / maxSpan * 100);
  var topLi  = faceWall.nRows - 1;
  // Contact Y range (must match _buildThreeFaceWall so bridge Z aligns with face top edge)
  var cMin = isFinite(faceWall.yMin) ? faceWall.yMin : 0;
  var cMax = isFinite(faceWall.yMax) ? faceWall.yMax : 1;
  var cMid = (cMin + cMax) / 2;
  function faceTopZ(machX) {
    var xi = 0;
    while (xi < faceWall.nCols - 1 && faceWall.xs[xi + 1] <= machX) xi++;
    var r0 = faceWall.grid[xi] && faceWall.grid[xi][topLi]; if (!r0) return null;
    if (xi >= faceWall.nCols - 1) return Number(r0.z);
    var r1 = faceWall.grid[xi + 1] && faceWall.grid[xi + 1][topLi]; if (!r1) return Number(r0.z);
    var x0=faceWall.xs[xi], x1=faceWall.xs[xi+1], t=x1>x0?(machX-x0)/(x1-x0):0;
    return Number(r0.z)*(1-t)+Number(r1.z)*t;
  }
  function faceTopContactY(machX) {
    var xi = 0;
    while (xi < faceWall.nCols - 1 && faceWall.xs[xi + 1] <= machX) xi++;
    var r0 = faceWall.grid[xi] && faceWall.grid[xi][topLi]; if (!r0) return cMid;
    if (xi >= faceWall.nCols - 1) return Number(r0.y);
    var r1 = faceWall.grid[xi + 1] && faceWall.grid[xi + 1][topLi]; if (!r1) return Number(r0.y);
    var x0=faceWall.xs[xi], x1=faceWall.xs[xi+1], t=x1>x0?(machX-x0)/(x1-x0):0;
    return Number(r0.y)*(1-t)+Number(r1.y)*t;
  }
  var lateralSlant = FACE_LATERAL_SLANT; // must match _buildThreeFaceWall
  var pos=[], col=[], idx=[], vtx=0;
  for (var ci=0; ci<cfg.colCount-1; ci++) {
    var sx0=cfg.minX+ci*cfg.colSpacing, sx1=cfg.minX+(ci+1)*cfg.colSpacing;
    var sz0=grid[0][ci], sz1=grid[0][ci+1];
    if (sz0==null||sz1==null||!isFinite(sz0)||!isFinite(sz1)) continue;
    var fz0=faceTopZ(sx0), fz1=faceTopZ(sx1);
    if (fz0===null||fz1===null) continue;
    var fc0=faceTopContactY(sx0), fc1=faceTopContactY(sx1);
    var wx0=(sx0-xCenter)/maxSpan*100, wx1=(sx1-xCenter)/maxSpan*100;
    var wy_s0=(sz0-zMid)*zExag*zScale, wy_s1=(sz1-zMid)*zExag*zScale;
    var wy_f0=(fz0-zMid)*zExag*zScale, wy_f1=(fz1-zMid)*zExag*zScale;
    var wz_f0=frontZ+(fc0-cMid)*zExag*zScale+lateralSlant, wz_f1=frontZ+(fc1-cMid)*zExag*zScale+lateralSlant; // matches face wall top (layerFrac=1, full slant at top)
    var base=vtx;
    // Quad: surface front edge (at frontZ) → face top edge (at frontZ + contact-Y displacement + full slant at top)
    pos.push(wx0,wy_s0,frontZ, wx1,wy_s1,frontZ, wx1,wy_f1,wz_f1, wx0,wy_f0,wz_f0);
    var c0=_threeZCol(sz0,zMin,zMax),c1=_threeZCol(sz1,zMin,zMax),c2=_threeZCol(fz1,zMin,zMax),c3=_threeZCol(fz0,zMin,zMax);
    col.push(c0[0],c0[1],c0[2], c1[0],c1[1],c1[2], c2[0],c2[1],c2[2], c3[0],c3[1],c3[2]);
    idx.push(base,base+1,base+2, base,base+2,base+3);
    vtx += 4;
  }
  if (vtx === 0) return null;
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  return geo;
}

// Contour lines: march through surface grid triangles and find Z-level crossings
function _buildThreeContours(grid, cfg, zMin, zMax, zExag, si) {
  if (!si || !grid || !cfg) return null;
  var interval = (zMax - zMin) / 10;
  if (interval <= 0) return null;
  var maxSpan=si.maxSpan, xCenter=si.xCenter, yCenter=si.yCenter, zMid=si.zMid, zScale=si.zScale;
  var pts = [];
  for (var z = Math.ceil(zMin / interval) * interval; z <= zMax + 1e-9; z += interval) {
    for (var cy=0; cy<cfg.rowCount-1; cy++) {
      for (var cx=0; cx<cfg.colCount-1; cx++) {
        var z00=grid[cy][cx],z10=grid[cy][cx+1],z01=grid[cy+1][cx],z11=grid[cy+1][cx+1];
        if (z00==null||z10==null||z01==null||z11==null) continue;
        if (!isFinite(z00)||!isFinite(z10)||!isFinite(z01)||!isFinite(z11)) continue;
        var x0=cfg.minX+cx*cfg.colSpacing, x1=cfg.minX+(cx+1)*cfg.colSpacing;
        var y0=cfg.minY+cy*cfg.rowSpacing, y1=cfg.minY+(cy+1)*cfg.rowSpacing;
        // March each triangle (T1: 00,10,01 and T2: 10,11,01) for this Z level
        var tris = [[x0,y0,z00, x1,y0,z10, x0,y1,z01],[x1,y0,z10, x1,y1,z11, x0,y1,z01]];
        for (var ti=0; ti<2; ti++) {
          var tr=tris[ti], crossPts=[];
          for (var ei=0; ei<3; ei++) {
            var ai=ei*3, bi=(ei<2?ei+1:0)*3;
            var ax=tr[ai],ay=tr[ai+1],az=tr[ai+2], bx=tr[bi],by=tr[bi+1],bz=tr[bi+2];
            if ((az<=z&&bz>z)||(bz<=z&&az>z)) {
              var t=(z-az)/(bz-az);
              crossPts.push(new THREE.Vector3((ax+t*(bx-ax)-xCenter)/maxSpan*100, (z-zMid)*zExag*zScale, -((ay+t*(by-ay))-yCenter)/maxSpan*100));
            }
          }
          if (crossPts.length >= 2) { pts.push(crossPts[0], crossPts[1]); }
        }
      }
    }
  }
  if (pts.length === 0) return null;
  var group = new THREE.Group();
  var lGeo = new THREE.BufferGeometry().setFromPoints(pts);
  var lMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 });
  group.add(new THREE.LineSegments(lGeo, lMat));
  return group;
}

// Contour lines for the face wall: march through face-wall triangles and find
// crossings of the *contact-Y* (r.y) coordinate — the same dimension used to
// colour and displace the face wall in _buildThreeFaceWall.  This produces
// curved iso-contours that follow the actual face shape, matching the terrain
// look of the surface mesh contours.
function _buildThreeFaceContours(faceWall, cfg, zMin, zMax, zExag, si) {
  if (!faceWall) return null;
  // Contour interval based on contact-Y range (face shape), not layer-Z range
  var cMin = isFinite(faceWall.yMin) ? faceWall.yMin : zMin;
  var cMax = isFinite(faceWall.yMax) ? faceWall.yMax : zMax;
  var interval = (cMax - cMin) / 10;
  if (interval <= 0) return null; // flat face: no visible contours
  var faceXSpan = (faceWall.xMax - faceWall.xMin) || 1;
  var faceZSpan = (faceWall.zMax - faceWall.zMin) || 1;
  var maxSpan = si ? si.maxSpan : Math.max(faceXSpan, faceZSpan);
  var xCenter = si ? si.xCenter : (faceWall.xMin + faceWall.xMax) / 2;
  var yCenter = si ? si.yCenter : 0;
  var zMid    = si ? si.zMid   : (zMin + zMax) / 2;
  var zScale  = si ? si.zScale : 30 / maxSpan;
  var frontZ  = (si && cfg) ? -((cfg.minY - yCenter) / maxSpan * 100) : 0;
  var cMid    = (cMin + cMax) / 2;
  var lateralSlant = FACE_LATERAL_SLANT; // must match _buildThreeFaceWall
  var nRowsM1 = Math.max(faceWall.nRows - 1, 1);
  var pts = [];
  // March through each cLevel (contact-Y iso-value)
  for (var cLevel = Math.ceil(cMin / interval) * interval; cLevel <= cMax + 1e-9; cLevel += interval) {
    for (var xi = 0; xi < faceWall.nCols - 1; xi++) {
      for (var li = 0; li < faceWall.nRows - 1; li++) {
        var r00=faceWall.grid[xi]  &&faceWall.grid[xi][li];
        var r10=faceWall.grid[xi+1]&&faceWall.grid[xi+1][li];
        var r01=faceWall.grid[xi]  &&faceWall.grid[xi][li+1];
        var r11=faceWall.grid[xi+1]&&faceWall.grid[xi+1][li+1];
        if (!r00||!r10||!r01||!r11) continue;
        var z00=Number(r00.z),z10=Number(r10.z),z01=Number(r01.z),z11=Number(r11.z);
        if (!isFinite(z00)||!isFinite(z10)||!isFinite(z01)||!isFinite(z11)) continue;
        // Contact Y at each corner — used for crossing detection
        var cy00=Number(r00.y),cy10=Number(r10.y),cy01=Number(r01.y),cy11=Number(r11.y);
        var x00=faceWall.xs[xi], x10=faceWall.xs[xi+1];
        var lf00=li/nRowsM1, lf01=(li+1)/nRowsM1;
        // 3-D positions matching _buildThreeFaceWall (outward slant + contact displacement)
        var px00=(x00-xCenter)/maxSpan*100, px10=(x10-xCenter)/maxSpan*100;
        var px01=(x00-xCenter)/maxSpan*100, px11=(x10-xCenter)/maxSpan*100;
        var py00=(z00-zMid)*zExag*zScale, py10=(z10-zMid)*zExag*zScale;
        var py01=(z01-zMid)*zExag*zScale, py11=(z11-zMid)*zExag*zScale;
        var pz00=frontZ+(cy00-cMid)*zExag*zScale+lf00*lateralSlant, pz10=frontZ+(cy10-cMid)*zExag*zScale+lf00*lateralSlant;
        var pz01=frontZ+(cy01-cMid)*zExag*zScale+lf01*lateralSlant, pz11=frontZ+(cy11-cMid)*zExag*zScale+lf01*lateralSlant;
        // Triangle pair marching: each entry = [px,py,pz, contactY] × 3 vertices
        var tris = [
          [px00,py00,pz00,cy00, px10,py10,pz10,cy10, px00,py01,pz01,cy01],
          [px10,py10,pz10,cy10, px10,py11,pz11,cy11, px00,py01,pz01,cy01]
        ];
        for (var ti=0; ti<2; ti++) {
          var tr=tris[ti], crossPts=[];
          for (var ei=0; ei<3; ei++) {
            var ai=ei*4, bi=(ei<2?ei+1:0)*4;
            var ax=tr[ai],ay=tr[ai+1],az=tr[ai+2],av=tr[ai+3];
            var bx=tr[bi],by=tr[bi+1],bz=tr[bi+2],bv=tr[bi+3];
            if ((av<=cLevel&&bv>cLevel)||(bv<=cLevel&&av>cLevel)) {
              var t=(cLevel-av)/(bv-av);
              crossPts.push(new THREE.Vector3(ax+t*(bx-ax), ay+t*(by-ay), az+t*(bz-az)));
            }
          }
          if (crossPts.length >= 2) { pts.push(crossPts[0], crossPts[1]); }
        }
      }
    }
  }
  if (pts.length === 0) return null;
  var group = new THREE.Group();
  var lGeo = new THREE.BufferGeometry().setFromPoints(pts);
  var lMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 });
  group.add(new THREE.LineSegments(lGeo, lMat));
  return group;
}

// ── Main unified Three.js renderer ───────────────────────────────────────────
function renderThreeUnified3D(prefix) {
  if (typeof THREE === 'undefined') { return; } // Three.js not loaded yet
  var grid = smMeshData, cfg = smGridConfig;
  var hasSurface = grid && cfg && cfg.rowCount >= 2 && cfg.colCount >= 2;
  var faceWall   = buildFaceWallGrid();
  var hasFace    = faceWall !== null;

  // Filter by visualization mode: face view shows face-only, surface views show surface-only.
  // 'res' shows surface only, 'resface' shows face only, 'relief' shows face only (3D terrain).
  if (prefix === 'face' || prefix === 'resface' || prefix === 'relief') hasSurface = false;
  if (prefix === 'sm' || prefix === 'surf' || prefix === 'res') hasFace = false;

  var wrapId     = (prefix === 'relief') ? 'relief-three-canvas' : prefix + '-three-canvas';
  var canvasWrap = document.getElementById(wrapId);

  if (!hasSurface && !hasFace) {
    if (canvasWrap) canvasWrap.classList.remove('three-active');
    var statusEl = (prefix === 'surf') ? document.getElementById('sm-meshVizStatus') :
                   (prefix === 'face') ? document.getElementById('face-meshVizStatus') :
                   (prefix === 'resface') ? document.getElementById('resface-meshVizStatus') : null;
    if (statusEl) statusEl.textContent = (prefix === 'face' || prefix === 'resface')
      ? 'No face mesh data \u2014 run a face probe or load face mesh'
      : 'No mesh data \u2014 run a surface probe or load a mesh';
    pluginDebug('renderThreeUnified3D(' + prefix + '): no data — skipping render');
    return;
  }
  if (canvasWrap) canvasWrap.classList.add('three-active');

  var s = _threeGetOrInit(prefix);
  if (!s) return;

  var exagId = (prefix === 'relief') ? 'relief-3d-z-exag' : prefix + '-z-exag';
  var zExag  = Number((document.getElementById(exagId) || {}).value) || 5;

  // Compute global Z range
  var zMin = Infinity, zMax = -Infinity;
  if (hasSurface) {
    for (var r=0; r<cfg.rowCount; r++) {
      for (var c=0; c<cfg.colCount; c++) {
        var zv = grid[r][c];
        if (zv != null && isFinite(zv)) { zMin = Math.min(zMin, zv); zMax = Math.max(zMax, zv); }
      }
    }
  }
  if (hasFace) { zMin = Math.min(zMin, faceWall.zMin); zMax = Math.max(zMax, faceWall.zMax); }
  if (!isFinite(zMin)) return;
  if (zMin === zMax) { zMin -= 0.5; zMax += 0.5; }

  // Dispose old geometry groups
  if (s.meshGroup)    { s.scene.remove(s.meshGroup);    s.meshGroup    = null; }
  if (s.contourGroup) { s.scene.remove(s.contourGroup); s.contourGroup = null; }

  var group = new THREE.Group();
  s.meshGroup = group;
  var mat = new THREE.MeshPhongMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: false, shininess: 40 });

  var si = null;
  if (hasSurface) {
    var sr = _buildThreeSurface(grid, cfg, zMin, zMax, zExag);
    si = sr;
    group.add(new THREE.Mesh(sr.geo, mat.clone()));
  }

  if (hasFace) {
    var fwr = _buildThreeFaceWall(faceWall, cfg, zMin, zMax, zExag, si);
    if (fwr) group.add(new THREE.Mesh(fwr.geo, mat.clone()));
    if (hasSurface && si) {
      var bg = _buildThreeBridge(grid, cfg, faceWall, zMin, zMax, zExag, si);
      if (bg) group.add(new THREE.Mesh(bg, mat.clone()));
    }
  }

  s.scene.add(group);

  // Optional contour lines
  var toggleEl = document.getElementById(prefix + '-contour-toggle');
  if (toggleEl && toggleEl.checked) {
    var contourGroup = new THREE.Group();
    var anyContour = false;
    if (si) {
      var cg = _buildThreeContours(grid, cfg, zMin, zMax, zExag, si);
      if (cg) { contourGroup.add(cg); anyContour = true; }
    }
    if (hasFace) {
      var fcg = _buildThreeFaceContours(faceWall, cfg, zMin, zMax, zExag, si);
      if (fcg) { contourGroup.add(fcg); anyContour = true; }
    }
    if (anyContour) { s.contourGroup = contourGroup; s.scene.add(contourGroup); }
  }

  // Update status text
  var statusEl = (prefix === 'surf') ? document.getElementById('sm-meshVizStatus') :
                 (prefix === 'face') ? document.getElementById('face-meshVizStatus') :
                 (prefix === 'resface') ? document.getElementById('resface-meshVizStatus') : null;
  if (statusEl) {
    if (hasSurface && hasFace) statusEl.textContent = (cfg.colCount*cfg.rowCount) + ' surface + ' + (faceWall.nCols*faceWall.nRows) + ' face = ' + (cfg.colCount*cfg.rowCount + faceWall.nCols*faceWall.nRows) + ' combined \u2014 Z: ' + zMin.toFixed(3) + ' to ' + zMax.toFixed(3);
    else if (hasSurface)        statusEl.textContent = (cfg.colCount*cfg.rowCount) + ' points, grid ' + cfg.colCount + '\u00d7' + cfg.rowCount + ' \u2014 Z: ' + zMin.toFixed(3) + ' to ' + zMax.toFixed(3);
    else                        statusEl.textContent = (faceWall.nCols*faceWall.nRows) + ' face points \u2014 Z: ' + zMin.toFixed(3) + ' to ' + zMax.toFixed(3);
  }
  var mode = hasSurface && hasFace ? 'combined' : hasSurface ? 'surface' : 'face';
  var ptCount = (hasSurface ? cfg.colCount*cfg.rowCount : 0) + (hasFace ? faceWall.nCols*faceWall.nRows : 0);
  pluginDebug('renderThreeUnified3D(' + prefix + '): mode=' + mode + ' points=' + ptCount + ' Z=' + zMin.toFixed(3) + ' to ' + zMax.toFixed(3) + ' zExag=' + zExag);
}

// Save WebGL canvas as PNG (falls back to replay HTML if Three.js not active)
function save3DViewPNG() {
  var s = _threeState['res'];
  if (s && s.renderer) {
    s.renderer.render(s.scene, s.camera);
    var dataURL = s.renderer.domElement.toDataURL('image/png');
    var link = document.createElement('a');
    link.download = 'mesh-3d-view.png';
    link.href = dataURL;
    link.click();
  } else {
    smSaveReplayHtml();
  }
}

function populateSurfaceResults() {
  var panel = document.getElementById('res-surface-panel');
  var facePanel = document.getElementById('res-face-panel');
  if (!panel) return;

  var hasSurface = smMeshData && smGridConfig;
  var faceData = getFaceMeshData();
  var hasFace = faceData && faceData.length > 0;

  if (!hasSurface && !hasFace) {
    panel.style.display = 'none';
    if (facePanel) facePanel.style.display = 'none';
    var reliefMapsPanel = document.getElementById('res-relief-maps-panel');
    if (reliefMapsPanel) reliefMapsPanel.style.display = 'none';
    populateUnifiedProbeTable();
    return;
  }

  // Show/hide top surface panel based on surface data
  panel.style.display = hasSurface ? 'block' : 'none';

  // Show face panel whenever any data is present so both 3D views appear together
  var hasAnyProbeData = hasSurface || hasFace;
  if (facePanel) facePanel.style.display = hasAnyProbeData ? 'block' : 'none';

  // Show/hide Results tab relief map panels based on available data
  var reliefMapsPanel = document.getElementById('res-relief-maps-panel');
  if (reliefMapsPanel) reliefMapsPanel.style.display = hasAnyProbeData ? '' : 'none';
  var resSurfRelief = document.getElementById('res-surface-relief-panel');
  if (resSurfRelief) resSurfRelief.style.display = hasSurface ? '' : 'none';
  var resFaceRelief = document.getElementById('res-face-relief-panel');
  if (resFaceRelief) resFaceRelief.style.display = hasFace ? '' : 'none';

  initResVizRotation();
  resVizResetView();
  renderResVizMesh();

  // Always initialize and render face 3D view when the panel is shown
  if (hasAnyProbeData) {
    initResFaceVizRotation();
    resFaceVizResetView();
    renderResFaceVizMesh();
  }

  // Populate summary stats (surface grid summary)
  if (hasSurface) {
    var cfg = smGridConfig, grid = smMeshData;
    var zMin = Infinity, zMax = -Infinity, ptCount = 0;
    for (var r = 0; r < cfg.rowCount; r++) {
      for (var c = 0; c < cfg.colCount; c++) {
        var z = grid[r] && grid[r][c];
        if (z !== null && z !== undefined && isFinite(z)) { if (z < zMin) zMin = z; if (z > zMax) zMax = z; ptCount++; }
      }
    }
    var zDelta = isFinite(zMin) ? (zMax - zMin) : 0;
    var areaX = cfg.maxX - cfg.minX, areaY = cfg.maxY - cfg.minY;
    var sumEl = document.getElementById('res-probe-summary');
    if (sumEl) {
      sumEl.innerHTML =
        '<div style="background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px 12px">' +
          '<div style="color:var(--muted);font-size:10px">Grid</div>' +
          '<div style="color:var(--accent2);font-size:15px;font-weight:700">' + cfg.colCount + '&times;' + cfg.rowCount + '</div>' +
          '<div style="color:var(--muted);font-size:10px">' + ptCount + ' points</div>' +
        '</div>' +
        '<div style="background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px 12px">' +
          '<div style="color:var(--muted);font-size:10px">Area</div>' +
          '<div style="color:var(--text);font-size:14px;font-weight:700">' + areaX + '&times;' + areaY + '</div>' +
          '<div style="color:var(--muted);font-size:10px">coords</div>' +
        '</div>' +
        '<div style="background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px 12px">' +
          '<div style="color:var(--muted);font-size:10px">Z range</div>' +
          '<div style="color:var(--good);font-size:13px;font-weight:700">' + (isFinite(zMin) ? zMin.toFixed(3) : '?') + '</div>' +
          '<div style="color:var(--muted);font-size:10px">to ' + (isFinite(zMax) ? zMax.toFixed(3) : '?') + '</div>' +
        '</div>' +
        '<div style="background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px 12px">' +
          '<div style="color:var(--muted);font-size:10px">Z delta</div>' +
          '<div style="color:var(--warn);font-size:15px;font-weight:700">' + zDelta.toFixed(3) + '</div>' +
          '<div style="color:var(--muted);font-size:10px">coords</div>' +
        '</div>';
    }
  } else {
    var sumEl = document.getElementById('res-probe-summary');
    if (sumEl) sumEl.innerHTML = '';
  }

  populateUnifiedProbeTable();
}

function populateUnifiedProbeTable() {
  var tbody = document.getElementById('res-unified-tbody');
  if (!tbody) return;
  var rows = [];
  var n = 0;

  // Surface probe points
  if (smMeshData && smGridConfig) {
    var cfg = smGridConfig, grid = smMeshData;
    for (var ri = 0; ri < cfg.rowCount; ri++) {
      for (var ci = 0; ci < cfg.colCount; ci++) {
        var x = cfg.minX + ci * cfg.colSpacing;
        var y = cfg.minY + ri * cfg.rowSpacing;
        var zval = grid[ri][ci];
        n++;
        rows.push('<tr><td>' + n + '</td><td>' + smFmtN(x) + '</td><td>' + smFmtN(y) + '</td><td>' + (zval != null ? smFmtN(zval) : '&mdash;') + '</td><td>&mdash;</td><td style="color:var(--accent2)">Surface</td></tr>');
      }
    }
  }

  // Face probe points
  var faceData = getFaceMeshData();
  if (faceData && faceData.length) {
    faceData.forEach(function(p) {
      var layer = p.layer != null ? p.layer : 1;
      n++;
      rows.push('<tr><td>' + n + '</td><td>' + Number(p.x).toFixed(3) + '</td><td>' + Number(p.y).toFixed(3) + '</td><td>' + Number(p.z).toFixed(3) + '</td><td>' + (p.machineZ != null ? Number(p.machineZ).toFixed(3) : '&mdash;') + '</td><td style="color:var(--good)">Face L' + layer + '</td></tr>');
    });
  }

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:16px;">No probe data yet</td></tr>';
  } else {
    tbody.innerHTML = rows.join('');
  }
}


