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
  ctx.fillText(cfg.xLabel || 'X (mm)', padL + plotW / 2, totalH - 2);
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
  ctx.fillText(cfg.yLabel || 'Y (mm)', 0, 0);
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
  ctx.fillText(cfg.valueLabel || 'Z (mm)', 0, 0);
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
  var reliefCfg = { xLabel: 'X (mm)', yLabel: 'Y (mm)', valueLabel: 'Z (mm)', gridCols: cfg.colCount, gridRows: cfg.rowCount };
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
  var reliefCfg = { xLabel: 'X (mm)', yLabel: 'Z depth (mm)', valueLabel: 'Y contact (mm)', gridCols: nCols, gridRows: nRows };
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

  // Show/hide face surface panel based on face data
  if (facePanel) facePanel.style.display = hasFace ? 'block' : 'none';

  // Show/hide Results tab relief map panels based on available data
  var reliefMapsPanel = document.getElementById('res-relief-maps-panel');
  if (reliefMapsPanel) reliefMapsPanel.style.display = (hasSurface || hasFace) ? '' : 'none';
  var resSurfRelief = document.getElementById('res-surface-relief-panel');
  if (resSurfRelief) resSurfRelief.style.display = hasSurface ? '' : 'none';
  var resFaceRelief = document.getElementById('res-face-relief-panel');
  if (resFaceRelief) resFaceRelief.style.display = hasFace ? '' : 'none';

  initResVizRotation();
  resVizResetView();
  renderResVizMesh();

  // Initialize and render face 3D view if face data available
  if (hasFace) {
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
          '<div style="color:var(--muted);font-size:10px">mm</div>' +
        '</div>' +
        '<div style="background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px 12px">' +
          '<div style="color:var(--muted);font-size:10px">Z range</div>' +
          '<div style="color:var(--good);font-size:13px;font-weight:700">' + (isFinite(zMin) ? zMin.toFixed(3) : '?') + '</div>' +
          '<div style="color:var(--muted);font-size:10px">to ' + (isFinite(zMax) ? zMax.toFixed(3) : '?') + '</div>' +
        '</div>' +
        '<div style="background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px 12px">' +
          '<div style="color:var(--muted);font-size:10px">Z delta</div>' +
          '<div style="color:var(--warn);font-size:15px;font-weight:700">' + zDelta.toFixed(3) + '</div>' +
          '<div style="color:var(--muted);font-size:10px">mm</div>' +
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
        rows.push('<tr><td>' + n + '</td><td>' + smFmtN(x) + '</td><td>' + smFmtN(y) + '</td><td>' + (zval != null ? smFmtN(zval) : '&mdash;') + '</td><td style="color:var(--accent2)">Surface</td></tr>');
      }
    }
  }

  // Face probe points
  var faceData = getFaceMeshData();
  if (faceData && faceData.length) {
    faceData.forEach(function(p) {
      var layer = p.layer != null ? p.layer : 1;
      n++;
      rows.push('<tr><td>' + n + '</td><td>' + Number(p.x).toFixed(3) + '</td><td>' + Number(p.y).toFixed(3) + '</td><td>' + Number(p.z).toFixed(3) + '</td><td style="color:var(--good)">Face L' + layer + '</td></tr>');
    });
  }

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:16px;">No probe data yet</td></tr>';
  } else {
    tbody.innerHTML = rows.join('');
  }
}


function runSurfaceProbing() {
  pluginDebug('runSurfaceProbing ENTER');
  smStopFlag = false;
  // Clear any previous mesh data so the combined-mode callback correctly detects
  // whether THIS probe run succeeded (stale smMeshData would make it look like
  // success even when the current probe fails on the first point).
  smMeshData = null;
  smGridConfig = null;
  var cfg = buildSurfaceGridConfig();
  if (!cfg) {
    // If grid config is invalid, call the completion callback with failure so combined
    // mode does not hang waiting for a callback that will never arrive.
    var _earlyCb = _smProbingCompleteCallback;
    _smProbingCompleteCallback = null;
    if (_earlyCb) { try { _earlyCb(false); } catch(_e) {} }
    return;
  }

  var probeFeed = Number(document.getElementById('sm-probeFeed').value);
  var travelFeed = Number(document.getElementById('sm-travelFeed').value);
  var clearanceZ = Number(document.getElementById('sm-clearanceZ').value) || 5;
  var maxPlunge = Number(document.getElementById('sm-maxPlunge').value);

  var totalPoints = cfg.colCount * cfg.rowCount;
  var probed = 0;
  var result = [];
  for (var ri = 0; ri < cfg.rowCount; ri++) {
    result.push([]);
    for (var ci = 0; ci < cfg.colCount; ci++) {
      result[ri].push(null);
    }
  }

  document.getElementById('sm-btn-run-probe').disabled = true;
  document.getElementById('sm-btn-stop-probe').disabled = false;
  smClearLog('sm-probeLog');
  smSetProbeStatus('Running...', 'info');
  smSetProgress(0);
  var smPvizEl = document.getElementById('sm-probeViz');
  if (smPvizEl) smPvizEl.style.display = 'block';
  smPvizInit(cfg);
  smPvizUpdate(null, { point: 0, total: totalPoints, pct: 0 });
  smLogProbe('=== 3D Live Edge Mesh Plugin ' + SM_VERSION + ' ===');
  smLogProbe('Starting probing: ' + cfg.colCount + 'x' + cfg.rowCount + ' = ' + totalPoints + ' points');
  smLogProbe('Config: clearanceZ=' + clearanceZ + ' probeFeed=' + probeFeed + ' travelFeed=' + travelFeed + ' maxPlunge=' + maxPlunge);
  pluginDebug('runSurfaceProbing: grid ' + cfg.colCount + 'x' + cfg.rowCount + '=' + totalPoints + ' pts, clearanceZ=' + clearanceZ + ' probeFeed=' + probeFeed + ' travelFeed=' + travelFeed + ' maxPlunge=' + maxPlunge);

  function probeRow(ri) {
    if (ri >= cfg.rowCount) return Promise.resolve();
    var rowY = cfg.minY + ri * cfg.rowSpacing;
    // Serpentine: even rows go left→right, odd rows go right→left
    var reversed = (ri % 2 !== 0);

    function probeStep(step) {
      if (step >= cfg.colCount) return Promise.resolve();
      var ci = reversed ? (cfg.colCount - 1 - step) : step;
      var colX = cfg.minX + ci * cfg.colSpacing;
      smLogProbe('Probing point [' + ri + ',' + ci + '] X' + smFmtN(colX) + ' Y' + smFmtN(rowY));
      smCheckStop();
      smPvizUpdate('traveling', { x: colX, y: rowY, point: probed + 1, total: totalPoints, pct: probed / totalPoints * 100 });
      // Skip lateral move for first step of a new row — row transition already positioned the machine here
      var movePromise = (step === 0 && ri > 0)
        ? Promise.resolve()
        : smSafeLateralMove(colX, rowY, travelFeed, clearanceZ);
      return movePromise
        .then(function() { return smEnsureProbeClear(clearanceZ, travelFeed); })
        .then(function() {
          smPvizUpdate('plunging', { x: colX, y: rowY, point: probed + 1, total: totalPoints, pct: probed / totalPoints * 100 });
          return smPlungeProbe(maxPlunge, probeFeed);
        })
        .then(function(pos) {
          result[ri][ci] = pos.z;
          probed++;
          smSetProgress(probed / totalPoints * 100);
          smPvizUpdate('contact', { x: colX, y: rowY, point: probed, total: totalPoints, contactZ: pos.z, pct: probed / totalPoints * 100 });
          smLogProbe('  -> Z=' + smFmtN(pos.z));
          smLogProbe('DEBUG POSITION: after probe X=' + pos.x.toFixed(3) + ' Y=' + pos.y.toFixed(3) + ' Z=' + pos.z.toFixed(3));
          smLogProbe('DEBUG: contact at Z=' + pos.z.toFixed(3) + '; smSafeLateralMove will lift ' + clearanceZ.toFixed(3) + 'mm relative before next travel');
        })
        .then(function() { return probeStep(step + 1); });
    }

    return probeStep(0).then(function() {
      if (ri + 1 < cfg.rowCount) {
        var nextY = cfg.minY + (ri + 1) * cfg.rowSpacing;
        // After LTR row (even) machine is at maxX; next row (odd, RTL) starts at maxX — Y-only move
        // After RTL row (odd) machine is at minX; next row (even, LTR) starts at minX — Y-only move
        var nextStartX = reversed ? cfg.minX : cfg.maxX;
        smLogProbe('ROW TRANSITION: row ' + ri + ' done (direction: ' + (reversed ? 'RTL' : 'LTR') + '); using smSafeLateralMove to lift Z by ' + clearanceZ + 'mm relative then move to X=' + smFmtN(nextStartX) + ' Y=' + smFmtN(nextY));
        smPvizUpdate('traveling', { x: nextStartX, y: nextY, point: probed + 1, total: totalPoints, pct: probed / totalPoints * 100, action: 'Row transition...' });
        return smSafeLateralMove(nextStartX, nextY, travelFeed, clearanceZ)
          .then(function() { return smEnsureProbeClear(clearanceZ, travelFeed); });
      }
    }).then(function() { return probeRow(ri + 1); });
  }

  probeRow(0).then(function() {
    smMeshData = result;
    smGridConfig = cfg;
    smSetProbeStatus('Probing complete! ' + totalPoints + ' points captured.', 'ok');
    smLogProbe('Done! Probing complete.');
    pluginDebug('runSurfaceProbing COMPLETE: ' + totalPoints + ' points captured, meshData rows=' + result.length);
    smSetProgress(100);
    smPvizUpdate('complete', { point: totalPoints, total: totalPoints, pct: 100 });
    smSaveMeshToStorage();
    try { updateSurfaceMeshUI(); } catch(vizErr) { console.warn('Surface probe: updateSurfaceMeshUI error (non-fatal):', vizErr); }
    try { populateSurfaceResults(); } catch(vizErr) { console.warn('Surface probe: populateSurfaceResults error (non-fatal):', vizErr); }
    return smFinishMotion(travelFeed);
  }).catch(function(err) {
    // Guard against non-Error rejections (e.g. throw null / throw 'string') so that
    // the final .then() below always runs and the combined-mode callback is not lost.
    var msg;
    if (err && err.message) { msg = err.message; }
    else if (err == null) { msg = 'Unknown error'; }
    else { msg = String(err); }
    smSetProbeStatus('Error: ' + msg, 'err');
    smLogProbe('ERROR in probing: ' + msg);
    pluginDebug('runSurfaceProbing ERROR: ' + msg);
    smPvizUpdate('error', { action: msg === 'Stopped by user' ? 'Stopped' : 'Error' });
    console.error('Surface probe error:', err);
  }).then(function() {
    var cb = _smProbingCompleteCallback;
    _smProbingCompleteCallback = null;
    try {
      if (cb) {
        cb(!!smMeshData && !smStopFlag);
      } else {
        document.getElementById('sm-btn-run-probe').disabled = false;
        document.getElementById('sm-btn-stop-probe').disabled = true;
      }
    } catch (cbErr) {
      console.error('Surface probe completion callback error:', cbErr);
    }
  });
}

function stopSurfaceProbing() {
  smStopFlag = true;
  smLogProbe('Stop requested by user.');
}

function smSaveMeshToStorage() {
  if (!smMeshData || !smGridConfig) return;
  var statusEl = document.getElementById('sm-meshStorageStatus');
  try {
    localStorage.setItem(SM_MESH_KEY, JSON.stringify({ gridConfig: smGridConfig, meshData: smMeshData, timestamp: Date.now() }));
  } catch(e) {
    if (statusEl) statusEl.textContent = 'Failed to save to storage: ' + e.message;
  }
}

function saveSurfaceMesh() {
  var statusEl = document.getElementById('sm-meshStorageStatus');
  if (!smMeshData || !smGridConfig) {
    if (statusEl) statusEl.textContent = 'No mesh data to save.';
    return;
  }
  var today = new Date();
  var dateStr = today.getFullYear() + '-' +
    String(today.getMonth() + 1).padStart(2, '0') + '-' +
    String(today.getDate()).padStart(2, '0');
  var suggestedName = 'mesh-data-' + dateStr + '.json';
  var data = { pluginVersion: SM_VERSION, gridConfig: smGridConfig, meshData: smMeshData, timestamp: Date.now() };
  var jsonStr = JSON.stringify(data, null, 2);

  // Also save to localStorage as backup
  smSaveMeshToStorage();

  if (window.showSaveFilePicker) {
    // Preferred: native OS file save dialog (Chromium-based browsers)
    window.showSaveFilePicker({
      suggestedName: suggestedName,
      types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }]
    }).then(function(handle) {
      return handle.createWritable().then(function(writable) {
        return writable.write(jsonStr).then(function() {
          return writable.close();
        }).then(function() {
          if (statusEl) statusEl.textContent = '\u2705 Saved to file: ' + handle.name + ' (also backed up to browser storage)';
        });
      });
    }).catch(function(err) {
      if (err.name !== 'AbortError') {
        if (statusEl) statusEl.textContent = 'Save failed: ' + err.message;
        console.error('Save mesh failed:', err);
      } else {
        if (statusEl) statusEl.textContent = 'Save cancelled (backed up to browser storage).';
      }
    });
  } else {
    // Fallback: trigger download to default Downloads folder
    try {
      var blob = new Blob([jsonStr], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = suggestedName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (statusEl) statusEl.textContent = '\u2705 Saved as ' + suggestedName + ' (also backed up to browser storage)';
    } catch(e) {
      if (statusEl) statusEl.textContent = 'Save failed: ' + e.message;
    }
  }
}

function loadSurfaceMesh() {
  try {
    var raw = localStorage.getItem(SM_MESH_KEY);
    var statusEl = document.getElementById('sm-meshStorageStatus');
    if (!raw) {
      if (statusEl) statusEl.textContent = 'No mesh in storage.';
      return;
    }
    var data = JSON.parse(raw);
    smMeshData = data.meshData;
    smGridConfig = data.gridConfig;
    updateSurfaceMeshUI();
    if (statusEl) statusEl.textContent = 'Mesh loaded from storage.';
  } catch(e) {
    var errEl = document.getElementById('sm-meshStorageStatus');
    if (errEl) errEl.textContent = 'Failed to load: ' + e.message;
  }
}

function exportSurfaceMesh() {
  if (!smMeshData) { alert('No mesh data to export.'); return; }
  var data = { pluginVersion: SM_VERSION, gridConfig: smGridConfig, meshData: smMeshData };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'surface_mesh_' + Date.now() + '.json';
  a.click();
}

function smSaveReplayHtml() {
  if ((!smPvizProbeSequence || smPvizProbeSequence.length === 0) && !smMeshData) {
    alert('No mesh data available.\n\nRun a surface probe or load mesh data in the Mesh Data tab first, then click Save Replay HTML.');
    return;
  }

  // Safely JSON-encode and escape <\/script> tags to avoid premature closing of the script block
  function safeJson(v) {
    return JSON.stringify(v).replace(/<\/script>/gi, '<\\/script>');
  }

  var seqJson  = safeJson(smPvizProbeSequence);
  var cfgJson  = safeJson(smGridConfig);
  var meshJson = safeJson(smMeshData);

  // ── Probe SVG (same as live) ──────────────────────────────────────────────
  var probeSvg = '<svg viewBox="0 0 20 56" width="20" height="56" xmlns="http://www.w3.org/2000/svg" style="display:block">'
    + '<rect x="7" y="0" width="6" height="14" rx="2" fill="#687890" opacity="0.9"/>'
    + '<rect x="5" y="13" width="10" height="17" rx="4" fill="#95a8c8" stroke="#c8d8f0" stroke-width="0.8"/>'
    + '<rect x="7" y="14" width="3" height="14" rx="2" fill="rgba(255,255,255,0.2)"/>'
    + '<rect x="9.2" y="30" width="1.6" height="16" rx="0.8" fill="#c8d8f0"/>'
    + '<circle cx="10" cy="50" r="4.5" fill="#d0e8ff" stroke="#b8ccec" stroke-width="0.8"/>'
    + '<ellipse cx="8.5" cy="48.5" rx="1.5" ry="1" fill="rgba(255,255,255,0.55)"/>'
    + '</svg>';

  var html = '<!DOCTYPE html>\n'
    + '<html lang="en">\n'
    + '<head>\n'
    + '<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
    + '<title>3D Live Edge Mesh \u2014 Probe Replay</title>\n'
    + '<style>\n'
    + ':root{--bg:#0b0f18;--panel:#111723;--panel2:#141b27;--line:#1e2d47;--text:#d8e6ff;--muted:#4a6280;--good:#5fd38d;--warn:#e4bd53;--bad:#e06060;--accent:#3d7bd6;--accent2:#73d85f}\n'
    + '*{box-sizing:border-box;margin:0;padding:0}\n'
    + 'body{background:var(--bg);color:var(--text);font:13px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;min-height:100vh;padding:12px}\n'
    + '.app{max-width:720px;margin:0 auto}\n'
    + '.header{display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--panel);border:1px solid var(--line);border-radius:12px;margin-bottom:10px}\n'
    + '.title{font-size:16px;font-weight:700;color:var(--text)}\n'
    + '.subtitle{font-size:11px;color:var(--muted);margin-top:2px}\n'
    + '.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px}\n'
    + '.box-title{font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px}\n'
    + '.btn-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}\n'
    + '.btn{height:34px;padding:0 14px;border-radius:8px;border:1px solid var(--accent);background:linear-gradient(180deg,#1f3d6a,#162d50);color:var(--text);cursor:pointer;font:inherit;font-size:12px;font-weight:600;transition:opacity .15s}\n'
    + '.btn:hover{opacity:.85}\n'
    + '.btn.ghost{background:transparent;border-color:var(--line)}\n'
    + '.btn.ghost:hover{border-color:var(--accent);background:rgba(61,123,214,.08)}\n'
    + '.btn.warn{background:linear-gradient(180deg,#5a2020,#3d1818);border-color:#9e4040}\n'
    + 'select{height:34px;padding:0 8px;border-radius:8px;border:1px solid var(--line);background:var(--panel2);color:var(--text);font:inherit;font-size:12px;cursor:pointer}\n'
    + '.progress-track{height:6px;background:var(--panel2);border-radius:999px;overflow:hidden;border:1px solid var(--line)}\n'
    + '.progress-fill{height:100%;background:linear-gradient(90deg,#3d7bd6,#73d85f);border-radius:999px;width:0%;transition:width .3s}\n'
    + '#replay-controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:10px}\n'
    + '#replay-timeline{flex:1 1 200px}\n'
    + '#replay-pct{font-size:10px;color:var(--muted);width:36px;text-align:right}\n'
    // 3D scene
    + '#sm-pviz-scene{position:relative;height:250px;background:radial-gradient(ellipse at 50% 0%,#0f1f38 0%,#060a10 70%);border:1px solid var(--line);border-radius:10px;overflow:hidden;perspective:700px;perspective-origin:50% 10%;cursor:grab;user-select:none}\n'
    + '#sm-pviz-scene.pviz-dragging{cursor:grabbing}\n'
    + '#sm-pviz-3dscene{position:absolute;width:78%;height:58%;left:11%;top:18%;transform-style:preserve-3d;transform:rotateX(60deg) rotateY(0deg) rotateZ(-35deg)}\n'
    + '#sm-pviz-reset-btn{position:absolute;top:7px;right:9px;z-index:10;padding:3px 9px;border-radius:8px;border:1px solid rgba(58,85,128,.55);background:rgba(8,17,30,.72);color:var(--muted);font:10px/1.5 system-ui,-apple-system,sans-serif;cursor:pointer;transition:color .2s,border-color .2s}\n'
    + '#sm-pviz-reset-btn:hover{color:var(--text);border-color:var(--accent2)}\n'
    + '#sm-pviz-surface{position:absolute;inset:0;background-image:repeating-linear-gradient(90deg,rgba(58,85,128,.45) 0 1px,transparent 1px 100%),repeating-linear-gradient(0deg,rgba(58,85,128,.45) 0 1px,transparent 1px 100%);background-size:25% 33.33%;background-color:#08111e;border:1px solid rgba(58,85,128,.65);transform-style:preserve-3d}\n'
    + '.sm-pviz-dot{position:absolute;width:9px;height:9px;border-radius:50%;margin:-4.5px 0 0 -4.5px;transform:translateZ(1px);pointer-events:none;transition:opacity .3s}\n'
    + '#sm-pviz-probe-wrap{position:absolute;transform-style:preserve-3d;width:0;height:0;left:50%;top:50%;transition:left .7s cubic-bezier(.4,0,.2,1),top .7s cubic-bezier(.4,0,.2,1)}\n'
    + '#sm-pviz-probe-shadow{position:absolute;width:18px;height:18px;border-radius:50%;margin:-9px 0 0 -9px;background:rgba(149,168,200,.18);transform:translateZ(0)}\n'
    + '#sm-pviz-probe-body{position:absolute;margin:-48px 0 0 -10px;transform:translateZ(52px);transition:transform .9s cubic-bezier(.5,0,.1,1);transform-style:preserve-3d;pointer-events:none}\n'
    + '#sm-pviz-probe-body.probe-plunging{transform:translateZ(5px)}\n'
    + '#sm-pviz-probe-body.probe-contact{transform:translateZ(2px);animation:smPvizBodyGlow .55s ease-in-out 3}\n'
    + '@keyframes smPvizBodyGlow{0%,100%{filter:drop-shadow(0 0 3px rgba(95,211,141,.15))}50%{filter:drop-shadow(0 0 8px rgba(95,211,141,.95)) drop-shadow(0 0 18px rgba(95,211,141,.5))}}\n'
    + '#sm-pviz-mesh{position:absolute;inset:0;width:100%;height:100%;opacity:0;transition:opacity 1.2s ease;pointer-events:none;transform:translateZ(3px);overflow:visible}\n'
    + '#sm-pviz-mesh.mesh-visible{opacity:1}\n'
    // info grid
    + '#pviz-info{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:11px;margin-top:6px;padding:0 2px}\n'
    + '#pviz-info .lbl{color:var(--muted)}\n'
    + '#pviz-info .val{color:var(--text);font-weight:600}\n'
    + '#pviz-info .val.green{color:var(--good)}\n'
    + '#pviz-info .val.amber{color:var(--warn)}\n'
    + '.hint{font-size:10px;color:var(--muted);margin-top:6px;text-align:center}\n'
    + '</style>\n'
    + '</head>\n'
    + '<body>\n'
    + '<div class="app">\n'
    + '<div class="header">'
    +   '<div>'
    +     '<div class="title">3D Live Edge Mesh \u2014 Probe Replay</div>'
    +     '<div class="subtitle">V18.2 \u00b7 Recorded probe sequence playback \u00b7 Drag to rotate</div>'
    +   '</div>'
    + '</div>\n'
    + '<div class="panel">\n'
    +   '<div class="box-title">Playback Controls</div>\n'
    +   '<div id="replay-controls">\n'
    +     '<button class="btn" id="btn-play-pause">\u25b6\ufe0f Play</button>\n'
    +     '<button class="btn ghost" id="btn-skip-end">\u23ed\ufe0f Skip to End</button>\n'
    +     '<button class="btn ghost" id="btn-replay">\ud83d\udd04 Replay</button>\n'
    +     '<select id="replay-speed"><option value="1">1\u00d7</option><option value="2" selected>2\u00d7</option><option value="5">5\u00d7</option><option value="10">10\u00d7</option></select>\n'
    +     '<div id="replay-timeline" class="progress-track"><div id="replay-progress-fill" class="progress-fill"></div></div>\n'
    +     '<span id="replay-pct">0%</span>\n'
    +   '</div>\n'
    +   '<div id="sm-pviz-scene">\n'
    +     '<button id="sm-pviz-reset-btn" title="Reset view \u00b7 double-click also works">\u21bb Reset View</button>\n'
    +     '<div id="sm-pviz-3dscene">\n'
    +       '<div id="sm-pviz-surface">\n'
    +         '<svg id="sm-pviz-mesh" viewBox="0 0 100 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"></svg>\n'
    +       '</div>\n'
    +       '<div id="sm-pviz-probe-wrap">\n'
    +         '<div id="sm-pviz-probe-shadow"></div>\n'
    +         '<div id="sm-pviz-probe-body">' + probeSvg + '</div>\n'
    +       '</div>\n'
    +     '</div>\n'
    +   '</div>\n'
    +   '<div id="pviz-info">\n'
    +     '<div class="lbl">Status: <span id="sm-pviz-status" class="val">\u2014</span></div>\n'
    +     '<div class="lbl">Point: <span id="sm-pviz-point" class="val amber">\u2014 / \u2014</span></div>\n'
    +     '<div class="lbl">Position: <span id="sm-pviz-pos" class="val">\u2014</span></div>\n'
    +     '<div class="lbl">Contact Z: <span id="sm-pviz-z" class="val green">\u2014</span></div>\n'
    +   '</div>\n'
    +   '<div style="margin-top:6px;padding:0 2px">'
    +     '<div class="progress-track"><div id="sm-pviz-bar" class="progress-fill"></div></div>'
    +     '<div style="text-align:right;font-size:10px;color:var(--muted);margin-top:2px"><span id="sm-pviz-pct">0%</span></div>'
    +   '</div>\n'
    +   '<div style="text-align:center;margin-top:6px;font-size:11px;color:var(--muted)">Z Exaggeration: <input type="range" id="replay-z-exag" aria-label="Z Exaggeration" min="1" max="20" value="5" style="vertical-align:middle;width:90px" oninput="document.getElementById(\'replay-z-exag-val\').textContent=this.value+\'\u00d7\';renderMesh()"> <span id="replay-z-exag-val">5\u00d7</span></div>\n'
    +   '<div class="hint">Drag / touch to rotate \u00b7 Double-click to reset view</div>\n'
    + '</div>\n'
    + '</div>\n'
    + '<script>\n'
    + '// ── Embedded probe sequence data ─────────────────────────────────────────\n'
    + 'var probeSequence = ' + seqJson + ';\n'
    + 'var gridConfig    = ' + cfgJson + ';\n'
    + 'var meshData      = ' + meshJson + ';\n'
    + '\n'
    + '// ── Rotation state ────────────────────────────────────────────────────────\n'
    + 'var _rotX = 60, _rotY = 0, _rotZ = -35;\n'
    + 'var _dragActive = false, _dragLastX = 0, _dragLastY = 0;\n'
    + '\n'
    + 'function applyRotation() {\n'
    + '  var el = document.getElementById("sm-pviz-3dscene");\n'
    + '  if (el) el.style.transform = "rotateX(" + _rotX + "deg) rotateY(" + _rotY + "deg) rotateZ(" + _rotZ + "deg)";\n'
    + '}\n'
    + 'function resetView() { _rotX = 60; _rotY = 0; _rotZ = -35; applyRotation(); }\n'
    + '\n'
    + 'function initRotation() {\n'
    + '  var scene = document.getElementById("sm-pviz-scene");\n'
    + '  if (!scene || scene._rb) return;\n'
    + '  scene._rb = true;\n'
    + '  function startDrag(cx, cy) { _dragActive = true; _dragLastX = cx; _dragLastY = cy; scene.classList.add("pviz-dragging"); }\n'
    + '  function moveDrag(cx, cy) {\n'
    + '    if (!_dragActive) return;\n'
    + '    var dx = cx - _dragLastX, dy = cy - _dragLastY;\n'
    + '    _dragLastX = cx; _dragLastY = cy;\n'
    + '    _rotY += dx * 0.4;\n'
    + '    _rotX = Math.max(10, Math.min(80, _rotX - dy * 0.4));\n'
    + '    applyRotation();\n'
    + '  }\n'
    + '  function endDrag() { _dragActive = false; scene.classList.remove("pviz-dragging"); }\n'
    + '  scene.addEventListener("mousedown", function(e) { startDrag(e.clientX, e.clientY); e.preventDefault(); });\n'
    + '  document.addEventListener("mousemove", function(e) { moveDrag(e.clientX, e.clientY); });\n'
    + '  document.addEventListener("mouseup", endDrag);\n'
    + '  scene.addEventListener("touchstart", function(e) { if (e.touches.length===1) startDrag(e.touches[0].clientX, e.touches[0].clientY); }, {passive:true});\n'
    + '  scene.addEventListener("touchmove", function(e) { if (e.touches.length===1) { moveDrag(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); } }, {passive:false});\n'
    + '  scene.addEventListener("touchend", endDrag);\n'
    + '  scene.addEventListener("dblclick", resetView);\n'
    + '  var rb = document.getElementById("sm-pviz-reset-btn");\n'
    + '  if (rb) rb.addEventListener("click", function(e) { e.stopPropagation(); resetView(); });\n'
    + '}\n'
    + '\n'
    + '// ── Coordinate mapping ────────────────────────────────────────────────────\n'
    + 'function pvizXYtoPos(x, y) {\n'
    + '  var cfg = gridConfig;\n'
    + '  if (!cfg) return { left: 50, top: 50 };\n'
    + '  var spanX = (cfg.maxX - cfg.minX) || 1;\n'
    + '  var spanY = (cfg.maxY - cfg.minY) || 1;\n'
    + '  var left = Math.max(0, Math.min(100, (x - cfg.minX) / spanX * 100));\n'
    + '  var top  = Math.max(0, Math.min(100, 100 - (y - cfg.minY) / spanY * 100));\n'
    + '  return { left: left, top: top };\n'
    + '}\n'
    + '\n'
    + '// ── Color helpers ─────────────────────────────────────────────────────────\n'
    + 'function depthColor(z) {\n'
    + '  var depth = Math.min(1, Math.max(0, Math.abs(z) / 10));\n'
    + '  var r = Math.round(depth * 255 + (1 - depth) * 95);\n'
    + '  var g = Math.round((1 - depth) * 211 + depth * 90);\n'
    + '  var b = Math.round((1 - depth) * 141 + depth * 50);\n'
    + '  return "rgb(" + r + "," + g + "," + b + ")";\n'
    + '}\n'
    + 'function rangeColor(z, zMin, zSpan) {\n'
    + '  var t = (z - zMin) / zSpan;\n'
    + '  var rv, gv, bv, q;\n'
    + '  if (t < 0.5) { q = t * 2; rv = Math.round(200 - q*50); gv = Math.round(30 + q*40); bv = Math.round(50 + q*160); }\n'
    + '  else { q = (t - 0.5) * 2; rv = Math.round(150 - q*120); gv = Math.round(70 + q*160); bv = Math.round(210 - q*160); }\n'
    + '  return "rgba(" + rv + "," + gv + "," + bv + ",0.68)";\n'
    + '}\n'
    + '\n'
    + '// ── Face normal helper ────────────────────────────────────────────────────\n'
    + 'function pvizFaceNormal(x0,y0,z0,x1,y1,z1,x2,y2,z2) {\n'
    + '  var e1x=x1-x0,e1y=y1-y0,e1z=z1-z0,e2x=x2-x0,e2y=y2-y0,e2z=z2-z0;\n'
    + '  var nx=e1y*e2z-e1z*e2y,ny=e1z*e2x-e1x*e2z,nz=e1x*e2y-e1y*e2x;\n'
    + '  var len=Math.sqrt(nx*nx+ny*ny+nz*nz)||1;\n'
    + '  return nz/len;\n'
    + '}\n'
    + '\n'
    + '// ── Mesh renderer ─────────────────────────────────────────────────────────\n'
    + 'function renderMesh() {\n'
    + '  var grid = meshData, cfg = gridConfig;\n'
    + '  if (!grid || !cfg || cfg.rowCount < 2 || cfg.colCount < 2) return;\n'
    + '  var meshEl = document.getElementById("sm-pviz-mesh");\n'
    + '  if (!meshEl) return;\n'
    + '  while (meshEl.firstChild) meshEl.removeChild(meshEl.firstChild);\n'
    + '  var zMin = Infinity, zMax = -Infinity;\n'
    + '  for (var r = 0; r < cfg.rowCount; r++) for (var c = 0; c < cfg.colCount; c++) {\n'
    + '    var zv = grid[r] && grid[r][c];\n'
    + '    if (zv !== null && zv !== undefined && isFinite(zv)) { if (zv < zMin) zMin = zv; if (zv > zMax) zMax = zv; }\n'
    + '  }\n'
    + '  if (!isFinite(zMin)) return;\n'
    + '  var zSpan = (zMax - zMin) || 1;\n'
    + '  var zExagEl = document.getElementById("replay-z-exag");\n'
    + '  var zExag = Number(zExagEl && zExagEl.value) || 5;\n'
    + '  var zMid = (zMin + zMax) / 2;\n'
    + '  var spanY = (cfg.maxY - cfg.minY) || 1;\n'
    + '  var zSvgScale = zExag * 100 / spanY;\n'
    + '  var ns = "http://www.w3.org/2000/svg";\n'
    + '  var frag = document.createDocumentFragment();\n'
    + '  for (var row = 0; row < cfg.rowCount - 1; row++) {\n'
    + '    for (var col = 0; col < cfg.colCount - 1; col++) {\n'
    + '      var z00 = grid[row][col], z01 = grid[row][col+1], z10 = grid[row+1][col], z11 = grid[row+1][col+1];\n'
    + '      if (z00===null||z01===null||z10===null||z11===null) continue;\n'
    + '      if (!isFinite(z00)||!isFinite(z01)||!isFinite(z10)||!isFinite(z11)) continue;\n'
    + '      var x00=cfg.minX+col*cfg.colSpacing, y00=cfg.minY+row*cfg.rowSpacing;\n'
    + '      var x01=cfg.minX+(col+1)*cfg.colSpacing, y01=y00;\n'
    + '      var x10=x00, y10=cfg.minY+(row+1)*cfg.rowSpacing;\n'
    + '      var x11=x01, y11=y10;\n'
    + '      var p00=pvizXYtoPos(x00,y00), p01=pvizXYtoPos(x01,y01);\n'
    + '      var p10=pvizXYtoPos(x10,y10), p11=pvizXYtoPos(x11,y11);\n'
    + '      var t00=p00.top-(z00-zMid)*zSvgScale, t01=p01.top-(z01-zMid)*zSvgScale;\n'
    + '      var t10=p10.top-(z10-zMid)*zSvgScale, t11=p11.top-(z11-zMid)*zSvgScale;\n'
    + '      var ez=zExag;\n'
    + '      var b1=0.45+0.55*Math.abs(pvizFaceNormal(x00,y00,z00*ez,x01,y01,z01*ez,x10,y10,z10*ez));\n'
    + '      var b2=0.45+0.55*Math.abs(pvizFaceNormal(x01,y01,z01*ez,x11,y11,z11*ez,x10,y10,z10*ez));\n'
    + '      function litColor(z, b) {\n'
    + '        var t=(z-zMin)/zSpan, rv,gv,bv,q;\n'
    + '        if(t<0.5){q=t*2;rv=200-q*50;gv=30+q*40;bv=50+q*160;}\n'
    + '        else{q=(t-0.5)*2;rv=150-q*120;gv=70+q*160;bv=210-q*160;}\n'
    + '        return"rgba("+Math.round(rv*b)+","+Math.round(gv*b)+","+Math.round(bv*b)+",0.88)";\n'
    + '      }\n'
    + '      var poly1 = document.createElementNS(ns,"polygon");\n'
    + '      poly1.setAttribute("points", p00.left+","+t00+" "+p01.left+","+t01+" "+p10.left+","+t10);\n'
    + '      poly1.setAttribute("fill", litColor((z00+z01+z10)/3, b1));\n'
    + '      poly1.setAttribute("stroke", "rgba(80,160,220,0.45)"); poly1.setAttribute("stroke-width","0.8");\n'
    + '      frag.appendChild(poly1);\n'
    + '      var poly2 = document.createElementNS(ns,"polygon");\n'
    + '      poly2.setAttribute("points", p01.left+","+t01+" "+p11.left+","+t11+" "+p10.left+","+t10);\n'
    + '      poly2.setAttribute("fill", litColor((z01+z11+z10)/3, b2));\n'
    + '      poly2.setAttribute("stroke", "rgba(80,160,220,0.45)"); poly2.setAttribute("stroke-width","0.8");\n'
    + '      frag.appendChild(poly2);\n'
    + '    }\n'
    + '  }\n'
    + '  meshEl.appendChild(frag);\n'
    + '  setTimeout(function() { meshEl.classList.add("mesh-visible"); }, 60);\n'
    + '}\n'
    + '\n'
    + '// ── Playback engine ───────────────────────────────────────────────────────\n'
    + 'var _seqIdx = 0;\n'
    + 'var _seqTimer = null;\n'
    + 'var _isPlaying = false;\n'
    + '\n'
    + 'function getSpeed() { return Number(document.getElementById("replay-speed").value) || 2; }\n'
    + '\n'
    + 'function updatePlayBtn() {\n'
    + '  var btn = document.getElementById("btn-play-pause");\n'
    + '  if (btn) btn.textContent = _isPlaying ? "\u23f8\ufe0f Pause" : "\u25b6\ufe0f Play";\n'
    + '}\n'
    + '\n'
    + 'function updateReplayProgress(idx) {\n'
    + '  var pct = probeSequence.length ? Math.round(idx / probeSequence.length * 100) : 0;\n'
    + '  var fill = document.getElementById("replay-progress-fill");\n'
    + '  if (fill) fill.style.width = pct + "%";\n'
    + '  var pctEl = document.getElementById("replay-pct");\n'
    + '  if (pctEl) pctEl.textContent = pct + "%";\n'
    + '}\n'
    + '\n'
    + 'function processEvent(ev) {\n'
    + '  var type = ev.type;\n'
    + '  // Move probe position\n'
    + '  if (ev.x !== undefined && ev.y !== undefined) {\n'
    + '    var pos = pvizXYtoPos(ev.x, ev.y);\n'
    + '    var wrap = document.getElementById("sm-pviz-probe-wrap");\n'
    + '    if (wrap) { wrap.style.left = pos.left + "%"; wrap.style.top = pos.top + "%"; }\n'
    + '  }\n'
    + '  // Probe state animation class\n'
    + '  var body = document.getElementById("sm-pviz-probe-body");\n'
    + '  if (body) {\n'
    + '    body.classList.remove("probe-plunging", "probe-contact");\n'
    + '    void body.offsetWidth;\n'
    + '    if (type === "plunging") body.classList.add("probe-plunging");\n'
    + '    else if (type === "contact") body.classList.add("probe-contact");\n'
    + '  }\n'
    + '  // Status label\n'
    + '  var labels = { traveling:"Traveling...", plunging:"Probing...", contact:"\u2713 Contact!", complete:"\u2713 Complete \u2014 Surface mapped", error:"Error" };\n'
    + '  var label = ev.action || labels[type] || type;\n'
    + '  var statusEl = document.getElementById("sm-pviz-status");\n'
    + '  if (statusEl) {\n'
    + '    statusEl.textContent = label;\n'
    + '    statusEl.className = "val" + ((type==="contact"||type==="complete")?" green":type==="error"?" bad":"");\n'
    + '  }\n'
    + '  // Point counter\n'
    + '  var ptEl = document.getElementById("sm-pviz-point");\n'
    + '  if (ptEl && ev.point !== undefined) ptEl.textContent = ev.point + " / " + (ev.total || "?");\n'
    + '  // Position\n'
    + '  var posEl = document.getElementById("sm-pviz-pos");\n'
    + '  if (posEl && ev.x !== undefined) posEl.textContent = "X" + Number(ev.x).toFixed(3) + " Y" + Number(ev.y).toFixed(3);\n'
    + '  // Contact Z\n'
    + '  var zEl = document.getElementById("sm-pviz-z");\n'
    + '  if (zEl && ev.z !== undefined) zEl.textContent = Number(ev.z).toFixed(3);\n'
    + '  // Progress bar\n'
    + '  var pct = ev.pct !== undefined ? Math.max(0, Math.min(100, ev.pct)) : undefined;\n'
    + '  var barEl = document.getElementById("sm-pviz-bar");\n'
    + '  if (barEl && pct !== undefined) barEl.style.width = pct + "%";\n'
    + '  var pctEl2 = document.getElementById("sm-pviz-pct");\n'
    + '  if (pctEl2 && pct !== undefined) pctEl2.textContent = Math.round(pct) + "%";\n'
    + '  // Add contact dot\n'
    + '  if (type === "contact" && ev.x !== undefined && ev.z !== undefined) {\n'
    + '    var surf = document.getElementById("sm-pviz-surface");\n'
    + '    if (surf) {\n'
    + '      var dpos = pvizXYtoPos(ev.x, ev.y);\n'
    + '      var dot = document.createElement("div");\n'
    + '      dot.className = "sm-pviz-dot";\n'
    + '      dot.style.left = dpos.left + "%";\n'
    + '      dot.style.top  = dpos.top + "%";\n'
    + '      var col = depthColor(ev.z);\n'
    + '      dot.style.background = col;\n'
    + '      dot.style.boxShadow = "0 0 5px " + col;\n'
    + '      surf.appendChild(dot);\n'
    + '    }\n'
    + '  }\n'
    + '  // On complete: render mesh\n'
    + '  if (type === "complete") {\n'
    + '    setTimeout(function() { renderMesh(); }, 700);\n'
    + '  }\n'
    + '}\n'
    + '\n'
    + 'function playFromIndex(idx) {\n'
    + '  if (!_isPlaying) return;\n'
    + '  if (idx >= probeSequence.length) {\n'
    + '    _isPlaying = false;\n'
    + '    updatePlayBtn();\n'
    + '    updateReplayProgress(probeSequence.length);\n'
    + '    return;\n'
    + '  }\n'
    + '  _seqIdx = idx;\n'
    + '  updateReplayProgress(idx);\n'
    + '  var ev = probeSequence[idx];\n'
    + '  // Clamp raw delay to at most 3000 ms at 1x, then scale by speed\n'
    + '  var rawDelay = Math.min(ev.delay || 0, 3000);\n'
    + '  var delay = Math.max(40, rawDelay / getSpeed());\n'
    + '  _seqTimer = setTimeout(function() {\n'
    + '    processEvent(ev);\n'
    + '    playFromIndex(idx + 1);\n'
    + '  }, delay);\n'
    + '}\n'
    + '\n'
    + 'function startPlay() {\n'
    + '  if (_seqIdx >= probeSequence.length) { resetToStart(); }\n'
    + '  _isPlaying = true;\n'
    + '  updatePlayBtn();\n'
    + '  playFromIndex(_seqIdx);\n'
    + '}\n'
    + '\n'
    + 'function pausePlay() {\n'
    + '  _isPlaying = false;\n'
    + '  if (_seqTimer) { clearTimeout(_seqTimer); _seqTimer = null; }\n'
    + '  updatePlayBtn();\n'
    + '}\n'
    + '\n'
    + 'function togglePlay() {\n'
    + '  if (_isPlaying) pausePlay(); else startPlay();\n'
    + '}\n'
    + '\n'
    + 'function skipToEnd() {\n'
    + '  pausePlay();\n'
    + '  // Process all remaining events instantly\n'
    + '  for (var i = _seqIdx; i < probeSequence.length; i++) {\n'
    + '    processEvent(probeSequence[i]);\n'
    + '  }\n'
    + '  _seqIdx = probeSequence.length;\n'
    + '  updateReplayProgress(_seqIdx);\n'
    + '  updatePlayBtn();\n'
    + '}\n'
    + '\n'
    + 'function resetToStart() {\n'
    + '  pausePlay();\n'
    + '  _seqIdx = 0;\n'
    + '  // Clear dots\n'
    + '  var surf = document.getElementById("sm-pviz-surface");\n'
    + '  if (surf) { var dots = surf.querySelectorAll(".sm-pviz-dot"); for (var i=0;i<dots.length;i++) dots[i].remove(); }\n'
    + '  // Clear mesh\n'
    + '  var meshEl = document.getElementById("sm-pviz-mesh");\n'
    + '  if (meshEl) { while (meshEl.firstChild) meshEl.removeChild(meshEl.firstChild); meshEl.classList.remove("mesh-visible"); }\n'
    + '  // Reset probe position to start\n'
    + '  var wrap = document.getElementById("sm-pviz-probe-wrap");\n'
    + '  if (wrap) { wrap.style.left = "0%"; wrap.style.top = "100%"; }\n'
    + '  var body = document.getElementById("sm-pviz-probe-body");\n'
    + '  if (body) { body.className = ""; }\n'
    + '  // Reset info panel\n'
    + '  var statusEl = document.getElementById("sm-pviz-status"); if (statusEl) { statusEl.textContent = "\u2014"; statusEl.className = "val"; }\n'
    + '  var ptEl = document.getElementById("sm-pviz-point"); if (ptEl) ptEl.textContent = "\u2014 / \u2014";\n'
    + '  var posEl = document.getElementById("sm-pviz-pos"); if (posEl) posEl.textContent = "\u2014";\n'
    + '  var zEl = document.getElementById("sm-pviz-z"); if (zEl) zEl.textContent = "\u2014";\n'
    + '  var barEl = document.getElementById("sm-pviz-bar"); if (barEl) barEl.style.width = "0%";\n'
    + '  var pctEl = document.getElementById("sm-pviz-pct"); if (pctEl) pctEl.textContent = "0%";\n'
    + '  updateReplayProgress(0);\n'
    + '  updatePlayBtn();\n'
    + '  // Apply grid lines\n'
    + '  if (gridConfig && gridConfig.colCount > 1 && gridConfig.rowCount > 1 && surf) {\n'
    + '    var colPct = (100 / (gridConfig.colCount - 1)).toFixed(4);\n'
    + '    var rowPct = (100 / (gridConfig.rowCount - 1)).toFixed(4);\n'
    + '    surf.style.backgroundSize = colPct + "% " + rowPct + "%";\n'
    + '  }\n'
    + '}\n'
    + '\n'
    + '// ── Init ──────────────────────────────────────────────────────────────────\n'
    + 'document.addEventListener("DOMContentLoaded", function() {\n'
    + '  initRotation();\n'
    + '  resetToStart();\n'
    + '  document.getElementById("btn-play-pause").addEventListener("click", togglePlay);\n'
    + '  document.getElementById("btn-skip-end").addEventListener("click", skipToEnd);\n'
    + '  document.getElementById("btn-replay").addEventListener("click", function() { resetToStart(); startPlay(); });\n'
    + '  // Auto-play at 2x after a short delay so user sees the scene first\n'
    + '  setTimeout(function() { startPlay(); }, 800);\n'
    + '});\n'
    + '<\/script>\n'
    + '</body>\n'
    + '</html>';

  var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'probe_replay_' + Date.now() + '.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function importSurfaceMesh() {
  var inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json';
  inp.onchange = function(ev) {
    var file = ev.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var data = JSON.parse(e.target.result);
        smMeshData = data.meshData;
        smGridConfig = data.gridConfig;
        updateSurfaceMeshUI();
        var importEl = document.getElementById('sm-meshStorageStatus');
        if (importEl) importEl.textContent = 'Mesh imported from file.';
      } catch(err) { alert('Failed to parse mesh file: ' + err.message); }
    };
    reader.readAsText(file);
  };
  inp.click();
}

function clearSurfaceMesh() {
  if (!confirm('Clear all surface mesh data?')) return;
  smMeshData = null;
  smGridConfig = null;
  updateSurfaceMeshUI();
  var clearEl = document.getElementById('sm-meshStorageStatus');
  if (clearEl) clearEl.textContent = 'Mesh cleared.';
}

function updateSurfaceMeshUI() {
  // Ensure smPvizXYtoPos() has the correct config for rendering
  if (smGridConfig) window._smPvizCfg = smGridConfig;
  updateMeshTable_sm();
  initSurfVizRotation();
  surfVizResetView();
  smPvizRenderMesh();    // Keep Probe tab 3D visualizer in sync
  renderSurfVizMesh();   // Mesh Data tab 3D visualizer
  populateSurfaceResults();
  // Render relief maps then switch probe-tab surface section to heatmap view
  setTimeout(function() {
    renderSurfaceReliefMap();
    setTimeout(renderRelief3D, 60);
    setTimeout(function() { showProbeHeatmapView('sm'); }, 120);
  }, 60);
}

function updateMeshTable_sm() {
  var tbody = document.getElementById('sm-meshTableBody');
  if (!tbody) return;
  if (!smMeshData || !smGridConfig) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:16px;">No data yet</td></tr>';
    return;
  }
  var cfg = smGridConfig;
  var refZ = Number((document.getElementById('sm-referenceZ') || {value: 0}).value);
  var rows = [];
  var n = 0;
  for (var ri = 0; ri < cfg.rowCount; ri++) {
    for (var ci = 0; ci < cfg.colCount; ci++) {
      var x = cfg.minX + ci * cfg.colSpacing;
      var y = cfg.minY + ri * cfg.rowSpacing;
      var z = smMeshData[ri][ci];
      var offset = z != null ? (z - refZ).toFixed(3) : '-';
      rows.push('<tr><td>' + n + '</td><td>' + smFmtN(x) + '</td><td>' + smFmtN(y) + '</td><td>' + (z != null ? smFmtN(z) : '-') + '</td><td>' + offset + '</td></tr>');
      n++;
    }
  }
  tbody.innerHTML = rows.join('');
}

function exportSurfaceMeshCSV() {
  if (!smMeshData || !smGridConfig) { alert('No mesh data to export. Run a surface probe or load a mesh first.'); return; }
  var cfg = smGridConfig;
  var rows = ['# Plugin Version: ' + SM_VERSION, 'Index,X,Y,Z'];
  var n = 0;
  for (var ri = 0; ri < cfg.rowCount; ri++) {
    for (var ci = 0; ci < cfg.colCount; ci++) {
      var x = cfg.minX + ci * cfg.colSpacing;
      var y = cfg.minY + ri * cfg.rowSpacing;
      var z = smMeshData[ri][ci];
      rows.push(n + ',' + x.toFixed(3) + ',' + y.toFixed(3) + ',' + (z != null ? z.toFixed(3) : ''));
      n++;
    }
  }
  var blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'surface_mesh_' + Date.now() + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}


function bilinearInterpolateZ(data, cfg, queryX, queryY) {
  // Single column (Nx1): linear interpolation in Y only
  if (cfg.colCount === 1) {
    if (cfg.rowCount === 1) return data[0][0] || 0;
    var rowF = cfg.rowSpacing > 0 ? (queryY - cfg.minY) / cfg.rowSpacing : 0;
    var r0 = Math.max(0, Math.min(cfg.rowCount - 2, Math.floor(rowF)));
    var tz = Math.max(0, Math.min(1, rowF - r0));
    var za = data[r0][0] || 0;
    var zb = (data[r0 + 1] ? data[r0 + 1][0] : null) || za;
    return za * (1 - tz) + zb * tz;
  }
  // Single row (1xN): linear interpolation in X only
  if (cfg.rowCount === 1) {
    var colF = cfg.colSpacing > 0 ? (queryX - cfg.minX) / cfg.colSpacing : 0;
    var c0 = Math.max(0, Math.min(cfg.colCount - 2, Math.floor(colF)));
    var tx = Math.max(0, Math.min(1, colF - c0));
    var z0a = data[0][c0] || 0;
    var z0b = data[0][c0 + 1] || z0a;
    return z0a * (1 - tx) + z0b * tx;
  }
  // Standard bilinear interpolation for 2D grid
  var col = (queryX - cfg.minX) / cfg.colSpacing;
  var row = (queryY - cfg.minY) / cfg.rowSpacing;
  var col0 = Math.max(0, Math.min(cfg.colCount - 2, Math.floor(col)));
  var row0 = Math.max(0, Math.min(cfg.rowCount - 2, Math.floor(row)));
  var col1 = col0 + 1;
  var row1 = row0 + 1;
  var fx = Math.max(0, Math.min(1, col - col0));
  var fy = Math.max(0, Math.min(1, row - row0));
  var z00 = data[row0][col0];
  var z10 = data[row0][col1];
  var z01 = data[row1][col0];
  var z11 = data[row1][col1];
  var z0 = z00 * (1 - fx) + z10 * fx;
  var z1 = z01 * (1 - fx) + z11 * fx;
  return z0 * (1 - fy) + z1 * fy;
}

function applySurfaceCompensation() {
  if (!smOriginalGcode) { alert('No G-code loaded.'); return; }
  if (!smMeshData || !smGridConfig) { alert('No mesh data. Run probing or load a mesh first.'); return; }
  var refZEl = document.getElementById('sm-compRefZ');
  var refZ = refZEl ? Number(refZEl.value) : 0;
  smLogApply('Applying compensation with Reference Z=' + refZ + '...');
  try {
    var result = smApplyCompensationCore(smOriginalGcode, smMeshData, smGridConfig, refZ);
    smCompensatedGcode = result.gcode;
    var statusEl = document.getElementById('sm-applyStatus');
    if (statusEl) statusEl.textContent = 'Done. ' + result.modified + ' Z values modified.';
    smLogApply('Compensation applied. ' + result.modified + ' lines modified.');
    var preview = smCompensatedGcode.split('\n').slice(0, 30).join('\n');
    var previewEl = document.getElementById('sm-apply-preview');
    if (previewEl) previewEl.textContent = preview;
    var ncBtn2d = document.getElementById('sm-btn-send-ncsender');
    if(ncBtn2d) ncBtn2d.disabled = false;
  } catch(e) {
    var errEl = document.getElementById('sm-applyStatus');
    if (errEl) errEl.textContent = 'Error: ' + e.message;
    smLogApply('ERROR: ' + e.message);
  }
}

function smApplyCompensationCore(gcodeText, data, cfg, referenceZ) {
  var lines = gcodeText.split('\n');
  var output = [];
  var currentX = 0, currentY = 0;
  var linesModified = 0;
  var zLinesFound = 0;
  var zLinesOutOfBounds = 0;
  var firstModification = null;
  var sampleModifications = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) { output.push(lines[i]); continue; }
    var isMove = /^G[01]\b/i.test(line) || /\b[XYZ][-\d.]/i.test(line);
    if (!isMove) { output.push(lines[i]); continue; }
    var xMatch = line.match(/X(-?[\d.]+)/i);
    var yMatch = line.match(/Y(-?[\d.]+)/i);
    var zMatch = line.match(/Z(-?[\d.]+)/i);
    if (xMatch) currentX = parseFloat(xMatch[1]);
    if (yMatch) currentY = parseFloat(yMatch[1]);

    if (zMatch) {
      zLinesFound++;
      var originalZ = parseFloat(zMatch[1]);

      // Check if within bounds
      if (currentX >= cfg.minX && currentX <= cfg.maxX &&
          currentY >= cfg.minY && currentY <= cfg.maxY) {
        var meshZ = bilinearInterpolateZ(data, cfg, currentX, currentY);
        var offset = meshZ - referenceZ;
        var newZ = originalZ + offset;
        line = line.replace(/Z(-?[\d.]+)/i, 'Z' + newZ.toFixed(3));
        linesModified++;

        // Store first modification for logging
        if (!firstModification) {
          firstModification = {
            lineNum: i + 1,
            x: currentX.toFixed(3),
            y: currentY.toFixed(3),
            origZ: originalZ.toFixed(3),
            meshZ: meshZ.toFixed(3),
            offset: offset.toFixed(3),
            newZ: newZ.toFixed(3)
          };
        }

        // Store a few sample modifications for logging
        if (linesModified <= 3) {
          sampleModifications.push({
            lineNum: i + 1,
            x: currentX.toFixed(3),
            y: currentY.toFixed(3),
            origZ: originalZ.toFixed(3),
            meshZ: meshZ.toFixed(3),
            offset: offset.toFixed(3),
            newZ: newZ.toFixed(3)
          });
        }
      } else {
        zLinesOutOfBounds++;
      }
    }
    output.push(line);
  }

  return {
    gcode: output.join('\n'),
    modified: linesModified,
    zLinesFound: zLinesFound,
    zLinesOutOfBounds: zLinesOutOfBounds,
    firstModification: firstModification,
    sampleModifications: sampleModifications
  };
}

function smDownloadCompensatedGcode() {
  if (!smCompensatedGcode) { alert('No compensated G-code. Apply compensation first.'); return; }
  var blob = new Blob([smCompensatedGcode], { type: 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'compensated_surface_' + Date.now() + '.nc';
  a.click();
}

async function sendCompToNcSender(gcodeText, label) {
  if (!gcodeText) { alert('No compensated G-code available. Apply compensation first.'); return; }
  var filename = (label || 'compensated') + '_' + Date.now() + '.nc';
  var loaded = false;

  // Try loading temp content directly — ncSender /api/gcode-files/load-temp
  // This loads G-code from string content into the workspace without saving a file
  try {
    var r = await fetch('/api/gcode-files/load-temp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: gcodeText, filename: filename })
    });
    if (r.ok) {
      var js = await r.json().catch(function() { return {}; });
      if (!js.error && js.success !== false) { loaded = true; }
    }
  } catch(e) { /* fall through to file upload attempt */ }

  // Fallback: upload as a file — ncSender /api/gcode-files (uploads and immediately loads)
  if (!loaded) {
    try {
      var blob = new Blob([gcodeText], { type: 'text/plain' });
      var formData = new FormData();
      formData.append('file', blob, filename);
      var r2 = await fetch('/api/gcode-files', { method: 'POST', body: formData });
      if (r2.ok) {
        var js2 = await r2.json().catch(function() { return {}; });
        if (!js2.error && js2.success !== false) { loaded = true; }
      }
    } catch(e2) { /* fall through */ }
  }

  if (loaded) {
    alert((label || 'Compensated G-code') + ' loaded into ncSender successfully.\n\nThe file "' + filename + '" is now active and ready to run.');
  } else {
    // Neither API endpoint worked — download the file and instruct the user
    try {
      var dlBlob = new Blob([gcodeText], { type: 'text/plain' });
      var dlUrl = URL.createObjectURL(dlBlob);
      var a = document.createElement('a');
      a.href = dlUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(dlUrl);
    } catch(dlErr) { /* ignore download errors */ }
    alert('Could not load directly into ncSender.\n\n' +
      'The file "' + filename + '" has been downloaded.\n\n' +
      'To load it in ncSender:\n' +
      '1. Open the G-code file list in ncSender\n' +
      '2. Upload or select "' + filename + '"\n' +
      '3. Press Run to execute');
  }
}

