// ── Face Probe Tab — sample builder from config fields ────────────────────────

function fpBuildFaceSamplesFromConfig() {
  var xStart = Number((document.getElementById('fp-xStart') || {}).value);
  var xEnd   = Number((document.getElementById('fp-xEnd') || {}).value);
  var xPts   = Math.max(2, Math.round(Number((document.getElementById('fp-xPoints') || {}).value) || 5));
  if (!isFinite(xStart) || !isFinite(xEnd)) return null;
  var range = xEnd - xStart;
  var step = range / (xPts - 1);
  var samples = [];
  for (var i = 0; i < xPts; i++) {
    var xPos = xStart + i * step;
    var topZ = 0;
    if (smMeshData && smGridConfig) {
      topZ = bilinearInterpolateZ(smMeshData, smGridConfig, xPos, smGridConfig.minY) || 0;
    }
    samples.push({ index: i + 1, sampleCoord: xPos, topZ: topZ });
  }
  return samples;
}

function calcProbeAutoTotalLength(){
  var upper = Number((document.getElementById('probeUpperHeight')||{}).value || 0);
  var main = Number((document.getElementById('probeMainBodyHeight')||{}).value || 0);
  var stylus = Number((document.getElementById('probeStylusLength')||{}).value || 0);
  var total = upper + main + stylus;
  var autoEl = document.getElementById('probeAutoTotalLength');
  if(autoEl) autoEl.value = total.toFixed(3);
  return total;
}

function updateProbeDimensionPreview(){
  var pairs = [
    ['probeShankDiameter','probeLabelShank'],
    ['probeBodyDiameter','probeLabelBody'],
    ['probeUpperHeight','probeLabelUpper'],
    ['probeMainBodyHeight','probeLabelMain'],
    ['probeStylusLength','probeLabelStylus'],
    ['probeStylusCalloutLength','probeLabelStylusCallout'],
    ['probeBallTipDiameter','probeLabelBall'],
    ['probeTotalLength','probeLabelTotal']
  ];
  pairs.forEach(function(pair){
    var input = document.getElementById(pair[0]);
    var label = document.getElementById(pair[1]);
    if(input && label){
      var raw = input.value || '0';
      var v = Number(raw);
      label.textContent = isFinite(v) ? String(v) : raw;
    }
  });
}

function applyProbeDimensionSettings(s){
  if(!s) return;
  var map = {
    probeShankDiameter:'probeShankDiameter',
    probeBodyDiameter:'probeBodyDiameter',
    probeUpperHeight:'probeUpperHeight',
    probeMainBodyHeight:'probeMainBodyHeight',
    probeStylusLength:'probeStylusLength',
    probeStylusCalloutLength:'probeStylusCalloutLength',
    probeBallTipDiameter:'probeBallTipDiameter',
    probeTotalLength:'probeTotalLength'
  };
  Object.keys(map).forEach(function(k){
    var el = document.getElementById(map[k]);
    if(el && s[k] != null && s[k] !== '') el.value = s[k];
  });
  calcProbeAutoTotalLength();
  updateProbeDimensionPreview();
}

var PROBE_DIM_IDS = ['probeShankDiameter','probeBodyDiameter','probeUpperHeight','probeMainBodyHeight','probeStylusLength','probeStylusCalloutLength','probeBallTipDiameter','probeTotalLength'];

function saveProbeDimensions(){
  try{
    var data = {};
    PROBE_DIM_IDS.forEach(function(id){
      var el = document.getElementById(id);
      if(el) data[id] = el.value;
    });
    localStorage.setItem(PROBE_DIMENSIONS_KEY, JSON.stringify(data));
    var el = document.getElementById('probe-dims-status');
    if(el){ el.textContent = 'Probe dimensions saved.'; el.className = 'status-line good'; }
    setTimeout(function(){ if(el){ el.textContent = ''; el.className = 'status-line'; } }, 2500);
  }catch(e){ console.error('saveProbeDimensions error:', e); }
}

function loadProbeDimensions(){
  try{
    var raw = localStorage.getItem(PROBE_DIMENSIONS_KEY);
    if(!raw) return;
    var data = JSON.parse(raw);
    PROBE_DIM_IDS.forEach(function(id){
      var el = document.getElementById(id);
      if(el && data[id] != null && data[id] !== '') el.value = data[id];
    });
    calcProbeAutoTotalLength();
    updateProbeDimensionPreview();
  }catch(e){ console.error('loadProbeDimensions error:', e); }
}

function bindProbeDimensionUI(){
  PROBE_DIM_IDS.forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.addEventListener('input', function(){
      calcProbeAutoTotalLength();
      updateProbeDimensionPreview();
    });
    if(el) el.addEventListener('change', function(){
      calcProbeAutoTotalLength();
      updateProbeDimensionPreview();
    });
  });
  var btn = document.getElementById('calcProbeTotalBtn');
  if(btn){
    btn.addEventListener('click', function(){
      var total = calcProbeAutoTotalLength();
      var totalEl = document.getElementById('probeTotalLength');
      if(totalEl) totalEl.value = total.toFixed(3);
      updateProbeDimensionPreview();
    });
  }
  calcProbeAutoTotalLength();
  updateProbeDimensionPreview();

  // Surface mesh buttons
  try {
    document.getElementById('sm-btn-save-mesh').addEventListener('click', function(){ pluginDebug('sm-btn-save-mesh clicked'); saveSurfaceMesh(); });
    document.getElementById('sm-btn-load-mesh').addEventListener('click', function(){ pluginDebug('sm-btn-load-mesh clicked'); loadSurfaceMesh(); });
    document.getElementById('sm-btn-export-mesh').addEventListener('click', function(){ pluginDebug('sm-btn-export-mesh clicked'); exportSurfaceMesh(); });
    document.getElementById('sm-btn-export-mesh-csv').addEventListener('click', function(){ pluginDebug('sm-btn-export-mesh-csv clicked'); exportSurfaceMeshCSV(); });
    document.getElementById('sm-btn-import-mesh').addEventListener('click', function(){ pluginDebug('sm-btn-import-mesh clicked'); importSurfaceMesh(); });
    document.getElementById('sm-btn-clear-mesh').addEventListener('click', function(){ pluginDebug('sm-btn-clear-mesh clicked'); clearSurfaceMesh(); });
    document.getElementById('sm-btn-save-replay-html').addEventListener('click', function(){ pluginDebug('sm-btn-save-replay-html clicked'); smSaveReplayHtml(); });
  } catch(e){}

  // Combined mesh buttons
  try {
    document.getElementById('comb-btn-save-mesh').addEventListener('click', function(){ pluginDebug('comb-btn-save-mesh clicked'); saveCombinedMesh(); });
    document.getElementById('comb-btn-export-csv').addEventListener('click', function(){ pluginDebug('comb-btn-export-csv clicked'); exportCombinedMeshCSV(); });
    document.getElementById('comb-btn-export-json').addEventListener('click', function(){ pluginDebug('comb-btn-export-json clicked'); exportCombinedMeshJSON(); });
    document.getElementById('comb-btn-clear-mesh').addEventListener('click', function(){ pluginDebug('comb-btn-clear-mesh clicked'); clearCombinedMesh(); });
  } catch(e){}

  // Results tab Save 3D View button
  try {
    document.getElementById('res-btn-save-3d').addEventListener('click', save3DViewPNG);
  } catch(e){}

  // Results tab Face 3D View — save and reset buttons
  try {
    var resfaceSaveBtn = document.getElementById('resface-btn-save-3d');
    if (resfaceSaveBtn) resfaceSaveBtn.addEventListener('click', function() {
      var s = _threeState['resface'];
      if (s && s.renderer) {
        s.renderer.render(s.scene, s.camera);
        var dataURL = s.renderer.domElement.toDataURL('image/png');
        var link = document.createElement('a');
        link.download = 'face-3d-view.png';
        link.href = dataURL;
        link.click();
      }
    });
    var resfaceResetBtn = document.getElementById('resface-pviz-reset-btn');
    if (resfaceResetBtn) resfaceResetBtn.addEventListener('click', function() { resFaceVizResetView(); });
  } catch(e){}

  // Grid size display updates
  try {
    ['sm-minX','sm-maxX','sm-spacingX','sm-minY','sm-maxY','sm-spacingY'].forEach(function(id) {
      document.getElementById(id).addEventListener('input', updateSurfaceGridSizeDisplay);
    });
    updateSurfaceGridSizeDisplay();
  } catch(e){}

  // Load saved mesh on startup
  try { loadSurfaceMesh(); } catch(e){}

  // G-code file reader (legacy sm-gcodeFile — no longer in DOM after Apply tab redesign, kept for safety)
  try {
    var legacyGcodeFile = document.getElementById('sm-gcodeFile');
    if (legacyGcodeFile) legacyGcodeFile.addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(ev) {
        smOriginalGcode = ev.target.result;
        var span = document.getElementById('sm-gcode-file-status');
        if (span) span.textContent = 'Loaded: ' + file.name + ' (' + smOriginalGcode.split('\n').length + ' lines)';
      };
      reader.readAsText(file);
    });
  } catch(e){}

  // Apply tab: G-code file input
  try {
    var applyGcodeFileInput = document.getElementById('apply-gcode-file-input');
    if (applyGcodeFileInput) applyGcodeFileInput.addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(ev) {
        applyOriginalGcode = ev.target.result;
        var statusEl = document.getElementById('apply-gcode-status');
        if (statusEl) {
          statusEl.textContent = 'Loaded: ' + file.name + ' (' + applyOriginalGcode.split('\n').length + ' lines)';
          statusEl.className = 'status-line good';
        }
        applyUpdateButtons();
      };
      reader.readAsText(file);
    });
  } catch(e){}

  // Apply tab: initialize button states
  try { applyUpdateButtons(); } catch(e) {}

  // Allow free manual keyboard entry in all non-readonly number inputs.
  // Remove min/max permanently (not restored on blur) so that clearing a field
  // does not cause Chromium/Electron to snap the value back to the min value.
  Array.prototype.forEach.call(document.querySelectorAll('input[type="number"]:not([readonly])'), function(el) {
    el.step = 'any';
    el.removeAttribute('min');
    el.removeAttribute('max');
  });

}

// ── Probe Type Dropdown ───────────────────────────────────────────────────────

function onProbeTypeChange() {
  var type = (document.getElementById('probe-type-select') || {}).value || '2d-surface';

  // Face axis row
  var axisRow = document.getElementById('probe-axis-row');
  if (axisRow) axisRow.style.display = (type === 'face' || type === 'combined') ? 'flex' : 'none';

  // Surface config section (grid + probe settings)
  var showSurface = (type === '2d-surface' || type === 'combined');
  var surfCfg = document.getElementById('surface-config-section');
  if (surfCfg) surfCfg.style.display = showSurface ? '' : 'none';

  // Face config section
  var showFace = (type === 'face' || type === 'combined');
  var faceCfg = document.getElementById('face-config-section');
  if (faceCfg) faceCfg.style.display = showFace ? '' : 'none';

  // Surface mesh section (visualizer)
  var surfMesh = document.getElementById('surface-mesh-section');
  if (surfMesh) surfMesh.style.display = showSurface ? '' : 'none';

  // Face mesh section (face visualizer, relief map, data mgmt)
  var faceMesh = document.getElementById('face-mesh-section');
  if (faceMesh) faceMesh.style.display = showFace ? '' : 'none';

  // Unified log sections
  var surfLogWrap = document.getElementById('unified-log-surface-wrap');
  if (surfLogWrap) surfLogWrap.style.display = showSurface ? '' : 'none';
  var faceLogWrap = document.getElementById('unified-log-face-wrap');
  if (faceLogWrap) faceLogWrap.style.display = showFace ? '' : 'none';

  // Run button label
  var runBtn = document.getElementById('sm-btn-run-probe');
  if (runBtn) {
    if (type === '2d-surface') runBtn.textContent = '\u25b6 Run Surface Probe';
    else if (type === 'face') runBtn.textContent = '\u25b6 Run Face Probe';
    else runBtn.textContent = '\u25b6\u25b6 Run Combined Probe';
  }
}

function saveUnifiedProbeLog() {
  var surfLog = (document.getElementById('sm-probeLog') || {}).textContent || '';
  var faceLog = (document.getElementById('face-log') || {}).textContent || '';
  var type = (document.getElementById('probe-type-select') || {}).value || '2d-surface';
  var combined = '';
  if (type === '2d-surface' || type === 'combined') combined += '=== Surface Probe Log ===\n' + surfLog + '\n';
  if (type === 'face' || type === 'combined') combined += '=== Face Probe Log ===\n' + faceLog + '\n';
  var blob = new Blob([combined], { type: 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'probe-log-' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt';
  a.click();
}

function clearUnifiedProbeLog() {
  var surfLog = document.getElementById('sm-probeLog');
  if (surfLog) surfLog.textContent = '';
  var faceLog = document.getElementById('face-log');
  if (faceLog) faceLog.textContent = '';
}

function startProbeByType() {
  var type = (document.getElementById('probe-type-select') || {}).value || '2d-surface';
  var axis = (document.getElementById('probe-face-axis-select') || {}).value || 'Y';
  if (type === '2d-surface') {
    runSurfaceProbing();
  } else if (type === 'face') {
    runFaceProbe(axis);
  } else if (type === 'combined') {
    runCombinedProbeMode(axis);
  }
}

// ── Combined Probe Mode ───────────────────────────────────────────────────────

async function runCombinedProbeMode(axis) {
  if (_running) { smLogProbe('COMBINED: cannot start — another probe operation is already running (_running=true).'); pluginDebug('runCombinedProbeMode SKIP: _running=true'); setFooterStatus('Already running', 'warn'); return; }
  axis = String(axis || 'Y').toUpperCase();
  // Reset stop flags so a previously-stopped run does not block this one.
  smStopFlag = false;
  _stopRequested = false;
  smLogProbe('=== 3D Live Edge Mesh Plugin ' + SM_VERSION + ' ===');
  smLogProbe('COMBINED: Starting combined probe (surface + face axis=' + axis + ')...');
  pluginDebug('runCombinedProbeMode ENTER: axis=' + axis);
  setFooterStatus('Combined probe: running surface phase\u2026', 'warn');

  // Disable all probe controls
  var runBtn = document.getElementById('sm-btn-run-probe');
  var stopBtn = document.getElementById('sm-btn-stop-probe');
  if (runBtn) runBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = false;
  document.getElementById('btn-face-x').disabled = true;
  document.getElementById('btn-face-y').disabled = true;

  try {
    // Phase 1: Run surface probe and await its completion via Promise wrapper.
    // _smProbingCompleteCallback is called by runSurfaceProbing when done;
    // wrapping it in a Promise lets us properly await the result here.
    smLogProbe('COMBINED: Phase 1 — running surface probe...');
    pluginDebug('runCombinedProbeMode: Phase 1 starting surface probe, setting _smProbingCompleteCallback');
    var surfaceSuccess = await new Promise(function(resolve) {
      _smProbingCompleteCallback = function(success) {
        pluginDebug('runCombinedProbeMode: _smProbingCompleteCallback called success=' + success + ' smMeshData=' + !!smMeshData + ' smStopFlag=' + smStopFlag);
        resolve(!!success);
      };
      runSurfaceProbing();
    });
    pluginDebug('runCombinedProbeMode: surface probe promise resolved, surfaceSuccess=' + surfaceSuccess);

    if (!surfaceSuccess) {
      smLogProbe('COMBINED: Phase 1 FAILED — surface probe failed or was stopped. Face probe skipped.');
      pluginDebug('runCombinedProbeMode: Phase 1 FAILED. smMeshData=' + !!smMeshData + ' smStopFlag=' + smStopFlag);
      setFooterStatus('Combined probe: surface phase failed/stopped.', 'bad');
      return;
    }
    smLogProbe('COMBINED: Phase 1 complete — surface probe done. smMeshData rows=' + (smMeshData ? smMeshData.length : 'null'));

    smLogProbe('COMBINED: Phase 2 — populating face probe references from surface mesh row 0...');
    setFooterStatus('Combined probe: running face probe phase (' + axis + ')\u2026', 'warn');

    // Populate topResults from row 0 of the 2D surface mesh so that the face probe
    // has correct per-sample-X top-Z references (row 0 = top edge of the live edge).
    topResults = [];
    if (smMeshData && smGridConfig) {
      var _cfg = smGridConfig;
      var _row0 = smMeshData[0];
      if (_row0) {
        for (var _ci = 0; _ci < _cfg.colCount; _ci++) {
          var _zVal = _row0[_ci];
          if (_zVal != null && isFinite(_zVal)) {
            var _xCoord = _cfg.minX + _ci * _cfg.colSpacing;
            topResults.push({
              type: 'top', index: _ci + 1,
              sampleCoord: _xCoord, targetSamplePos: _xCoord,
              x: _xCoord, y: _cfg.minY, z: Number(_zVal), status: 'TOP'
            });
          }
        }
        smLogProbe('COMBINED: populated ' + topResults.length + ' top-profile reference points from surface mesh row 0.');
        console.log('COMBINED: topResults =', JSON.stringify(topResults.slice(0, 3)));
      }
    } else {
      smLogProbe('COMBINED: WARNING — smMeshData or smGridConfig is null after surface probe; topResults will be empty.');
      pluginDebug('runCombinedProbeMode WARNING: smMeshData=' + smMeshData + ' smGridConfig=' + smGridConfig);
    }

    // Phase 2: Run face probe.
    // Reset _running in case surface probing left it in a non-false state —
    // runFaceProbe() guards on _running and returns early (no-op) if it is true.
    if (_running) {
      smLogProbe('COMBINED: WARNING — _running flag was true before face probe; resetting to allow face probe to execute.');
      pluginDebug('runCombinedProbeMode WARNING: _running was true before face probe — resetting');
      _running = false;
    }
    // Also reset _stopRequested so face probe does not abort immediately
    _stopRequested = false;

    // Retract probe and wait for it to clear before starting the face probe.
    // After the surface probe's last point the pin may still be in contact with the
    // surface (triggered state). runFaceProbe calls requireStartupHomingPreflight
    // which aborts immediately if the probe is triggered, so we must lift Z first.
    smLogProbe('COMBINED: Retracting probe before face phase...');
    var combinedClearZ = Number(document.getElementById('sm-clearanceZ').value) || 5;
    var combinedTravelFeed = Number(document.getElementById('sm-travelFeed').value) || 600;
    var probeCleared = false;
    try {
      await smEnsureProbeClear(combinedClearZ, combinedTravelFeed);
      probeCleared = true;
      smLogProbe('COMBINED: Probe cleared. Starting face probe phase...');
    } catch (clearErr) {
      smLogProbe('ERROR: Could not clear probe after surface phase. Aborting face probe. ' + (clearErr && clearErr.message ? clearErr.message : String(clearErr)));
      console.error('COMBINED: probe clear failed:', clearErr);
    }
    if (!probeCleared) {
      setFooterStatus('Combined probe: could not clear probe before face phase.', 'bad');
      return;
    }

    smLogProbe('COMBINED: Phase 2 — calling runFaceProbe(axis=' + axis + ')...');
    pluginDebug('runCombinedProbeMode: Phase 2 calling runFaceProbe axis=' + axis + ' _running=' + _running + ' _stopRequested=' + _stopRequested);
    logLine('face', 'COMBINED MODE: starting face probe phase (axis=' + axis + ')...');
    try {
      await runFaceProbe(axis, true);
      smLogProbe('COMBINED: Phase 2 complete — face probe done.');
      pluginDebug('runCombinedProbeMode: Phase 2 face probe completed successfully');
    } catch (faceErr) {
      smLogProbe('COMBINED: Phase 2 FAILED — face probe error: ' + (faceErr && faceErr.message ? faceErr.message : String(faceErr)));
      pluginDebug('runCombinedProbeMode ERROR (face): ' + (faceErr && faceErr.message ? faceErr.message : String(faceErr)));
      console.error('COMBINED: face probe threw:', faceErr);
      logLine('face', 'ERROR: face probe failed in combined mode: ' + (faceErr && faceErr.message ? faceErr.message : String(faceErr)));
    }

    // Merge combined data and update all visualizers
    mergeCombinedProbeData();
    updateCombinedMeshUI();
    try {
      smPvizRenderMesh();
      renderSurfVizMesh();
      renderResVizMesh();
      populateSurfaceResults();
      renderRelief3D();
      // Render 2D relief maps for both surface and face datasets
      // then auto-switch probe-tab sections to heatmap views
      setTimeout(function() {
        renderSurfaceReliefMap();
        renderFaceReliefMap();
        setTimeout(function() {
          showProbeHeatmapView('sm');
          showProbeHeatmapView('face');
        }, 120);
      }, 60);
    } catch (vizErr) {
      smLogProbe('WARNING: 3D visualization failed: ' + (vizErr && vizErr.message ? vizErr.message : String(vizErr)));
      console.warn('COMBINED: visualization error (non-fatal):', vizErr);
    }
    setFooterStatus('Combined probe complete: surface + face ' + axis + ' merged.', 'good');
    smLogProbe('COMBINED: All phases complete. ' + (combinedMeshPoints ? combinedMeshPoints.length : 0) + ' total points in combined dataset.');
    pluginDebug('runCombinedProbeMode COMPLETE: axis=' + axis + ' total=' + (combinedMeshPoints ? combinedMeshPoints.length : 0) + ' points');
    saveProbeResults();
    updateEdgeProbeStorageUI();
    pluginDebug('runCombinedProbeMode complete: topResults=' + topResults.length + ' faceResults=' + faceResults.length + ' layeredFaceResults=' + layeredFaceResults.length);

  } catch (err) {
    smLogProbe('COMBINED: unexpected error: ' + (err && err.message ? err.message : String(err)));
    pluginDebug('runCombinedProbeMode UNEXPECTED ERROR: ' + (err && err.message ? err.message : String(err)));
    console.error('COMBINED: unexpected error:', err);
    setFooterStatus('Combined probe error: ' + (err && err.message ? err.message : String(err)), 'bad');
    // Still attempt to merge any partial data
    try { mergeCombinedProbeData(); updateCombinedMeshUI(); } catch(e2) { /* ignore */ }
  } finally {
    if (runBtn) runBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
    document.getElementById('btn-face-x').disabled = false;
    document.getElementById('btn-face-y').disabled = false;
    _running = false;
    pluginDebug('runCombinedProbeMode EXIT (finally): _running reset to false');
  }
}

// ── Merge combined data ───────────────────────────────────────────────────────

function mergeCombinedProbeData() {
  var points = [];

  // Add surface mesh points
  if (smMeshData && smGridConfig) {
    var cfg = smGridConfig;
    for (var ri = 0; ri < cfg.rowCount; ri++) {
      for (var ci = 0; ci < cfg.colCount; ci++) {
        var z = smMeshData[ri] && smMeshData[ri][ci];
        if (z !== null && z !== undefined && isFinite(z)) {
          points.push({
            x: cfg.minX + ci * cfg.colSpacing,
            y: cfg.minY + ri * cfg.rowSpacing,
            z: z,
            source: 'surface'
          });
        }
      }
    }
  }

  // Add face probe contact points
  if (layeredFaceResults && layeredFaceResults.length > 0) {
    layeredFaceResults.forEach(function(r) {
      var x = Number(r.x), y = Number(r.y), z = Number(r.z);
      if (isFinite(x) && isFinite(y) && isFinite(z)) {
        points.push({ x: x, y: y, z: z, source: 'face' });
      }
    });
  } else if (faceResults && faceResults.length > 0) {
    faceResults.forEach(function(r) {
      if (r.status && (r.status.indexOf('FACE') !== -1) && r.status.indexOf('MISS') === -1) {
        var x = Number(r.x), y = Number(r.y), z = Number(r.z);
        if (isFinite(x) && isFinite(y) && isFinite(z)) {
          points.push({ x: x, y: y, z: z, source: 'face' });
        }
      }
    });
  }

  combinedMeshPoints = points.length > 0 ? points : null;
  return combinedMeshPoints;
}

// ── Combined Mesh UI ──────────────────────────────────────────────────────────

function updateCombinedMeshUI() {
  var hasData = combinedMeshPoints && combinedMeshPoints.length > 0;
  ['combined-mesh-panel', 'combined-mesh-data-panel', 'combined-mesh-mgmt-panel'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = hasData ? 'block' : 'none';
  });

  if (!hasData) return;

  // Update data table
  var tbody = document.getElementById('comb-mesh-tbody');
  if (tbody) {
    var rows = [];
    combinedMeshPoints.forEach(function(pt, i) {
      var srcColor = pt.source === 'surface' ? 'var(--accent2)' : '#e4a050';
      var srcLabel = pt.source === 'surface' ? 'Surface' : 'Face';
      rows.push('<tr><td>' + (i + 1) + '</td><td style="color:' + srcColor + ';font-weight:600">' + srcLabel +
        '</td><td>' + pt.x.toFixed(3) + '</td><td>' + pt.y.toFixed(3) + '</td><td>' + pt.z.toFixed(3) + '</td></tr>');
    });
    tbody.innerHTML = rows.join('');
  }

  // Update status (count in single pass)
  var statusEl = document.getElementById('comb-meshVizStatus');
  var surfPts = 0, facePts = 0;
  combinedMeshPoints.forEach(function(p) { if (p.source === 'surface') surfPts++; else facePts++; });
  if (statusEl) statusEl.textContent = combinedMeshPoints.length + ' total points (' + surfPts + ' surface, ' + facePts + ' face)';

  // Render combined 3D visualizer
  renderCombinedViz();
  initCombVizRotation();
}

// ── Combined 3D Visualizer ────────────────────────────────────────────────────

var _combRotX = 38, _combRotY = -20, _combRotZ = -4;
var _combDragActive = false, _combDragLastX = 0, _combDragLastY = 0;

function combVizApplyRotation() {
  var el = document.getElementById('comb-pviz-3dscene');
  if (el) el.style.transform = 'rotateX(' + _combRotX + 'deg) rotateY(' + _combRotY + 'deg) rotateZ(' + _combRotZ + 'deg)';
}

function combVizResetView() {
  _combRotX = 38; _combRotY = -20; _combRotZ = -4;
  combVizApplyRotation();
  // Reset Three.js camera for comb scene
  var s = _threeState['comb'];
  if (s && s.controls) { s.camera.position.set(120, 80, 120); s.camera.lookAt(0, 0, 0); s.controls.reset(); }
}

function initCombVizRotation() {
  // No-op for CSS drag: OrbitControls on the Three.js canvas handles rotation.
  // Wire up the reset button and double-click reset once.
  var scene = document.getElementById('comb-pviz-scene');
  if (scene && !scene._combRb) {
    scene._combRb = true;
    scene.addEventListener('dblclick', combVizResetView);
  }
  var resetBtn = document.getElementById('comb-pviz-reset-btn');
  if (resetBtn && !resetBtn._pvizResetInited) {
    resetBtn._pvizResetInited = true;
    resetBtn.addEventListener('click', function(e) { e.stopPropagation(); combVizResetView(); });
  }
}

function renderCombinedViz() {
  // SVG polygon rendering removed — delegate to Three.js unified renderer.
  // The 'comb' prefix renders to comb-three-canvas inside comb-pviz-scene.
  renderThreeUnified3D('comb');
  // Update combined status text
  var pts = combinedMeshPoints;
  var statusEl = document.getElementById('comb-meshVizStatus');
  if (statusEl) {
    if (pts && pts.length > 0) {
      statusEl.textContent = pts.length + ' combined points';
    } else {
      statusEl.textContent = 'No combined data yet';
    }
  }
}

// ── Combined Save / Export ────────────────────────────────────────────────────

function saveCombinedMesh() {
  var statusEl = document.getElementById('comb-meshStorageStatus');
  if (!combinedMeshPoints || combinedMeshPoints.length === 0) {
    if (statusEl) statusEl.textContent = 'No combined data to save.';
    return;
  }
  var today = new Date();
  var dateStr = today.getFullYear() + '-' +
    String(today.getMonth() + 1).padStart(2, '0') + '-' +
    String(today.getDate()).padStart(2, '0');
  var suggestedName = 'combined-mesh-' + dateStr + '.json';
  var data = { type: 'combined', pluginVersion: SM_VERSION, timestamp: Date.now(), points: combinedMeshPoints, gridConfig: smGridConfig };
  var jsonStr = JSON.stringify(data, null, 2);

  if (window.showSaveFilePicker) {
    window.showSaveFilePicker({
      suggestedName: suggestedName,
      types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }]
    }).then(function(handle) {
      return handle.createWritable().then(function(writable) {
        return writable.write(jsonStr).then(function() { return writable.close(); }).then(function() {
          if (statusEl) statusEl.textContent = '\u2705 Saved: ' + handle.name;
        });
      });
    }).catch(function(err) {
      if (err.name !== 'AbortError') {
        if (statusEl) statusEl.textContent = 'Save failed: ' + err.message;
      } else {
        if (statusEl) statusEl.textContent = 'Save cancelled.';
      }
    });
  } else {
    try {
      var blob = new Blob([jsonStr], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = suggestedName;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
      if (statusEl) statusEl.textContent = '\u2705 Saved as ' + suggestedName;
    } catch(e) {
      if (statusEl) statusEl.textContent = 'Save failed: ' + e.message;
    }
  }
}

function exportCombinedMeshCSV() {
  if (!combinedMeshPoints || combinedMeshPoints.length === 0) { alert('No combined data to export.'); return; }
  var lines = ['# Plugin Version: ' + SM_VERSION, '#,Source,X,Y,Z'];
  combinedMeshPoints.forEach(function(pt, i) {
    lines.push((i + 1) + ',' + pt.source + ',' + pt.x.toFixed(4) + ',' + pt.y.toFixed(4) + ',' + pt.z.toFixed(4));
  });
  var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'combined_mesh_' + Date.now() + '.csv';
  a.click();
}

function exportCombinedMeshJSON() {
  if (!combinedMeshPoints || combinedMeshPoints.length === 0) { alert('No combined data to export.'); return; }
  var data = { type: 'combined', pluginVersion: SM_VERSION, timestamp: Date.now(), points: combinedMeshPoints, gridConfig: smGridConfig };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'combined_mesh_' + Date.now() + '.json';
  a.click();
}

function clearCombinedMesh() {
  combinedMeshPoints = null;
  updateCombinedMeshUI();
  var statusEl = document.getElementById('comb-meshStorageStatus');
  if (statusEl) statusEl.textContent = 'Combined data cleared.';
}

// ── Clear logs on plugin close/exit ───────────────────────────────────────────
window.addEventListener('beforeunload', function() {
  try {
    // Clear in-memory logs
    topLogLines = [];
    faceLogLines = [];
    // Clear persisted logs from localStorage
    localStorage.removeItem(FACE_LOG_KEY);
  } catch(e) {}
  // Dispose Three.js resources to prevent memory leaks
  try {
    Object.keys(_threeState).forEach(function(prefix) { _threeDispose(prefix); });
  } catch(e) {}
});


