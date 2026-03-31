// ── Settings: collect, save, load, reset ──────────────────────────────────────
function getSettingsFromUI() {
  function n(id) { var el = document.getElementById(id); return el ? Number(el.value) : 0; }
  function s(id) { var el = document.getElementById(id); return el ? String(el.value) : ''; }
  function b(id) { var el = document.getElementById(id); return el ? el.value === 'yes' : false; }
  function chk(id) { var el = document.getElementById(id); return el ? !!el.checked : false; }
  return {
    // Travel / Recovery
    travelFeedRate:              n('travelFeedRate'),
    travelRecoveryFeedRate:      n('travelRecoveryFeedRate'),
    travelRecoveryLiftFeedRate:  n('travelRecoveryLiftFeedRate'),
    useTravelContactRecovery:    b('useTravelContactRecovery'),
    travelContactStep:           n('travelContactStep'),
    travelContactBackoff:        n('travelContactBackoff'),
    travelContactLift:           n('travelContactLift'),
    travelContactMaxRetries:     n('travelContactMaxRetries'),
    probeFeed:                   n('probeFeed'),
    retractDist:                 n('retractDist'),
    // Finish motion
    finishHomeZ:                 n('finishHomeZ'),
    useMachineHomeRetract:       b('useMachineHomeRetract'),
    machineSafeTopZ:             n('machineSafeTopZ'),
    returnToXYZero:              b('returnToXYZero'),
    // Mesh subdivision
    meshSubdivisionSpacing:      n('meshSubdivisionSpacing'),
    // Top / surface probe
    sampleAxis:                  s('sampleAxis'),
    topFixedCoord:               n('topFixedCoord'),
    topSampleStart:              n('topSampleStart'),
    topSampleEnd:                n('topSampleEnd'),
    topSampleCount:              n('topSampleCount'),
    topClearZ:                   n('topClearZ'),
    topFeed:                     n('topFeed'),
    topProbeDepth:               n('topProbeDepth'),
    topRetract:                  n('topRetract'),
    // Face probe
    faceFixedCoord:              n('faceFixedCoord'),
    enableLayeredFace:           chk('enableLayeredFace'),
    faceStartOffset:             n('faceStartOffset'),
    faceMaxDepth:                n('faceMaxDepth'),
    faceFeed:                    n('faceFeed'),
    faceRetractFeed:             n('faceRetractFeed'),
    faceDepthBelowSurface:       n('faceDepthBelowSurface'),
    faceProbeDistance:           n('faceProbeDistance'),
    faceLayerCount:              n('faceLayerCount'),
    fpZStepCount:                n('fp-zStepCount'),
    fpZStepSize:                 n('fp-zStepSize'),
    // Combined mode
    combinedPhasePause:          n('combined-phase-pause'),
    // Probe dimensions
    probeShankDiameter:          n('probeShankDiameter'),
    probeBodyDiameter:           n('probeBodyDiameter'),
    probeUpperHeight:            n('probeUpperHeight'),
    probeUpperLength:            n('probeUpperLength'),
    probeMainBodyHeight:         n('probeMainBodyHeight'),
    probeLowerLength:            n('probeLowerLength'),
    probeStylusLength:           n('probeStylusLength'),
    probeStylusCalloutLength:    n('probeStylusCalloutLength'),
    probeBallTipDiameter:        n('probeBallTipDiameter'),
    probeTipBallDiameter:        n('probeTipBallDiameter'),
    probeTotalLength:            n('probeTotalLength')
  };
}
function saveSettings() {
  try {
    var data = getSettingsFromUI();
    localStorage.setItem(SM_SETTINGS_KEY, JSON.stringify(data));
    setFooterStatus('Settings saved.', 'good');
    var el = document.getElementById('setup-status');
    if (el) {
      el.textContent = 'Settings saved.';
      el.className = 'status-line good';
      setTimeout(function() { el.textContent = ''; el.className = 'status-line'; }, 2500);
    }
  } catch(e) {
    console.error('saveSettings error:', e);
    setFooterStatus('Failed to save settings: ' + e.message, 'bad');
    var el = document.getElementById('setup-status');
    if (el) { el.textContent = 'Save failed: ' + e.message; el.className = 'status-line bad'; }
  }
}
function loadSettings() {
  var raw;
  try { raw = localStorage.getItem(SM_SETTINGS_KEY); } catch(e) { return; }
  if (!raw) return;
  var data;
  try { data = JSON.parse(raw); } catch(e) { return; }
  function sv(id, val) { var el = document.getElementById(id); if (el && val != null) el.value = val; }
  function sc(id, val) { var el = document.getElementById(id); if (el) el.checked = !!val; }
  function sb(id, val) { var el = document.getElementById(id); if (el) el.value = (val ? 'yes' : 'no'); }
  // Travel / Recovery
  sv('travelFeedRate',             data.travelFeedRate);
  sv('travelRecoveryFeedRate',     data.travelRecoveryFeedRate);
  sv('travelRecoveryLiftFeedRate', data.travelRecoveryLiftFeedRate);
  sb('useTravelContactRecovery',   data.useTravelContactRecovery);
  sv('travelContactStep',          data.travelContactStep);
  sv('travelContactBackoff',       data.travelContactBackoff);
  sv('travelContactLift',          data.travelContactLift);
  sv('travelContactMaxRetries',    data.travelContactMaxRetries);
  sv('probeFeed',                  data.probeFeed);
  sv('retractDist',                data.retractDist);
  // Finish motion
  sv('finishHomeZ',                data.finishHomeZ);
  sb('useMachineHomeRetract',      data.useMachineHomeRetract);
  sv('machineSafeTopZ',            data.machineSafeTopZ);
  sb('returnToXYZero',             data.returnToXYZero);
  // Mesh subdivision
  sv('meshSubdivisionSpacing',     data.meshSubdivisionSpacing);
  // Top / surface probe
  sv('sampleAxis',                 data.sampleAxis);
  sv('topFixedCoord',              data.topFixedCoord);
  sv('topSampleStart',             data.topSampleStart);
  sv('topSampleEnd',               data.topSampleEnd);
  sv('topSampleCount',             data.topSampleCount);
  sv('topClearZ',                  data.topClearZ);
  sv('topFeed',                    data.topFeed);
  sv('topProbeDepth',              data.topProbeDepth);
  sv('topRetract',                 data.topRetract);
  // Face probe
  sv('faceFixedCoord',             data.faceFixedCoord);
  sc('enableLayeredFace',          data.enableLayeredFace);
  sv('faceStartOffset',            data.faceStartOffset);
  sv('faceMaxDepth',               data.faceMaxDepth);
  sv('faceFeed',                   data.faceFeed);
  sv('faceRetractFeed',            data.faceRetractFeed);
  sv('faceDepthBelowSurface',      data.faceDepthBelowSurface);
  sv('faceProbeDistance',          data.faceProbeDistance);
  sv('faceLayerCount',             data.faceLayerCount);
  sv('fp-zStepCount',              data.fpZStepCount);
  sv('fp-zStepSize',               data.fpZStepSize);
  // Combined mode
  sv('combined-phase-pause',       data.combinedPhasePause);
  // Probe dimensions
  sv('probeShankDiameter',         data.probeShankDiameter);
  sv('probeBodyDiameter',          data.probeBodyDiameter);
  sv('probeUpperHeight',           data.probeUpperHeight);
  sv('probeUpperLength',           data.probeUpperLength);
  sv('probeMainBodyHeight',        data.probeMainBodyHeight);
  sv('probeLowerLength',           data.probeLowerLength);
  sv('probeStylusLength',          data.probeStylusLength);
  sv('probeStylusCalloutLength',   data.probeStylusCalloutLength);
  sv('probeBallTipDiameter',       data.probeBallTipDiameter);
  sv('probeTipBallDiameter',       data.probeTipBallDiameter);
  sv('probeTotalLength',           data.probeTotalLength);
  // Trigger dependent previews
  try { refreshFinishBehaviorPreview(); } catch(e) {}
  try { refreshTravelRecoveryPreview(); } catch(e) {}
  try { calcProbeAutoTotalLength(); } catch(e) {}
}
function resetSettings() {
  var defaults = {
    travelFeedRate: 600, travelRecoveryFeedRate: 1500, travelRecoveryLiftFeedRate: 1000,
    useTravelContactRecovery: true, travelContactStep: 5, travelContactBackoff: 5,
    travelContactLift: 5, travelContactMaxRetries: 5,
    probeFeed: 100, retractDist: 2,
    finishHomeZ: 10, useMachineHomeRetract: true, machineSafeTopZ: 0, returnToXYZero: true,
    meshSubdivisionSpacing: 2,
    sampleAxis: 'X', topFixedCoord: 0, topSampleStart: 0, topSampleEnd: 100, topSampleCount: 10,
    topClearZ: 5, topFeed: 200, topProbeDepth: 5, topRetract: 2,
    faceFixedCoord: 0, enableLayeredFace: false, faceStartOffset: -10, faceMaxDepth: 14.75,
    faceFeed: 150, faceRetractFeed: 1000, faceDepthBelowSurface: 2, faceProbeDistance: 20, faceLayerCount: 3,
    fpZStepCount: 3, fpZStepSize: 1,
    combinedPhasePause: 2000,
    probeShankDiameter: 6, probeBodyDiameter: 33, probeUpperHeight: 20, probeUpperLength: 20,
    probeMainBodyHeight: 21, probeLowerLength: 21,
    probeStylusLength: 26, probeStylusCalloutLength: 14.75, probeBallTipDiameter: 0, probeTipBallDiameter: 0, probeTotalLength: 67
  };
  function sv(id, val) { var el = document.getElementById(id); if (el) el.value = val; }
  function sc(id, val) { var el = document.getElementById(id); if (el) el.checked = !!val; }
  function sb(id, val) { var el = document.getElementById(id); if (el) el.value = (val ? 'yes' : 'no'); }
  sv('travelFeedRate',             defaults.travelFeedRate);
  sv('travelRecoveryFeedRate',     defaults.travelRecoveryFeedRate);
  sv('travelRecoveryLiftFeedRate', defaults.travelRecoveryLiftFeedRate);
  sb('useTravelContactRecovery',   defaults.useTravelContactRecovery);
  sv('travelContactStep',          defaults.travelContactStep);
  sv('travelContactBackoff',       defaults.travelContactBackoff);
  sv('travelContactLift',          defaults.travelContactLift);
  sv('travelContactMaxRetries',    defaults.travelContactMaxRetries);
  sv('probeFeed',                  defaults.probeFeed);
  sv('retractDist',                defaults.retractDist);
  sv('finishHomeZ',                defaults.finishHomeZ);
  sb('useMachineHomeRetract',      defaults.useMachineHomeRetract);
  sv('machineSafeTopZ',            defaults.machineSafeTopZ);
  sb('returnToXYZero',             defaults.returnToXYZero);
  sv('meshSubdivisionSpacing',     defaults.meshSubdivisionSpacing);
  sv('sampleAxis',                 defaults.sampleAxis);
  sv('topFixedCoord',              defaults.topFixedCoord);
  sv('topSampleStart',             defaults.topSampleStart);
  sv('topSampleEnd',               defaults.topSampleEnd);
  sv('topSampleCount',             defaults.topSampleCount);
  sv('topClearZ',                  defaults.topClearZ);
  sv('topFeed',                    defaults.topFeed);
  sv('topProbeDepth',              defaults.topProbeDepth);
  sv('topRetract',                 defaults.topRetract);
  sv('faceFixedCoord',             defaults.faceFixedCoord);
  sc('enableLayeredFace',          defaults.enableLayeredFace);
  sv('faceStartOffset',            defaults.faceStartOffset);
  sv('faceMaxDepth',               defaults.faceMaxDepth);
  sv('faceFeed',                   defaults.faceFeed);
  sv('faceRetractFeed',            defaults.faceRetractFeed);
  sv('faceDepthBelowSurface',      defaults.faceDepthBelowSurface);
  sv('faceProbeDistance',          defaults.faceProbeDistance);
  sv('faceLayerCount',             defaults.faceLayerCount);
  sv('fp-zStepCount',              defaults.fpZStepCount);
  sv('fp-zStepSize',               defaults.fpZStepSize);
  sv('combined-phase-pause',       defaults.combinedPhasePause);
  sv('probeShankDiameter',         defaults.probeShankDiameter);
  sv('probeBodyDiameter',          defaults.probeBodyDiameter);
  sv('probeUpperHeight',           defaults.probeUpperHeight);
  sv('probeUpperLength',           defaults.probeUpperLength);
  sv('probeMainBodyHeight',        defaults.probeMainBodyHeight);
  sv('probeLowerLength',           defaults.probeLowerLength);
  sv('probeStylusLength',          defaults.probeStylusLength);
  sv('probeStylusCalloutLength',   defaults.probeStylusCalloutLength);
  sv('probeBallTipDiameter',       defaults.probeBallTipDiameter);
  sv('probeTipBallDiameter',       defaults.probeTipBallDiameter);
  sv('probeTotalLength',           defaults.probeTotalLength);
  try { refreshFinishBehaviorPreview(); } catch(e) {}
  try { refreshTravelRecoveryPreview(); } catch(e) {}
  try { calcProbeAutoTotalLength(); } catch(e) {}
  var el = document.getElementById('setup-status');
  if (el) {
    el.textContent = 'Settings reset to defaults.';
    el.className = 'status-line good';
    setTimeout(function() { el.textContent = ''; el.className = 'status-line'; }, 2500);
  }
}
// ── Live preview helpers ───────────────────────────────────────────────────────
function refreshFinishBehaviorPreview() {
  var el = document.getElementById('finishBehaviorPreview');
  if (!el) return;
  var useMachineHome = (document.getElementById('useMachineHomeRetract') || {}).value === 'yes';
  var returnXY = (document.getElementById('returnToXYZero') || {}).value === 'yes';
  var finishZ = Number((document.getElementById('finishHomeZ') || {}).value);
  var safeTopZ = Number((document.getElementById('machineSafeTopZ') || {}).value);
  var parts = [];
  if (useMachineHome) {
    parts.push('Retract to machine safe Z ' + (isFinite(safeTopZ) ? safeTopZ.toFixed(2) : '?'));
  } else {
    parts.push('Retract work Z to ' + (isFinite(finishZ) ? finishZ.toFixed(2) : '?'));
  }
  if (returnXY) parts.push('return to X0 Y0');
  el.value = parts.join(', then ');
}
function refreshTravelRecoveryPreview() {
  var el = document.getElementById('travelContactMaxLiftPreview');
  if (!el) return;
  var lift = Math.max(0, Number((document.getElementById('travelContactLift') || {}).value) || 5);
  var maxRetries = Math.max(1, Number((document.getElementById('travelContactMaxRetries') || {}).value) || 5);
  el.value = (lift * maxRetries).toFixed(3);
  var preview = document.getElementById('travelRecoveryPreview');
  if (preview) {
    var useRecovery = (document.getElementById('useTravelContactRecovery') || {}).value === 'yes';
    if (!useRecovery) {
      preview.value = 'Travel contact recovery disabled';
    } else {
      preview.value = 'Recovery: lift ' + lift.toFixed(2) + ' coords, max ' + maxRetries + ' retries (max lift ' + (lift * maxRetries).toFixed(2) + ' coords)';
    }
  }
}
// ── Machine Z shortcut ────────────────────────────────────────────────────────
async function useCurrentZAsFinishHome() {
  try {
    var snap = await getMachineSnapshot();
    var workPos = await getWorkPosition();
    var zEl = document.getElementById('finishHomeZ');
    if (zEl && workPos && isFinite(workPos.z)) {
      zEl.value = Number(workPos.z).toFixed(3);
      refreshFinishBehaviorPreview();
      setFooterStatus('Fallback Z set to current work Z: ' + Number(workPos.z).toFixed(3), 'good');
      updateMachineHelperUI(snap);
    }
  } catch(e) {
    setFooterStatus('Failed to get current Z: ' + e.message, 'bad');
    var el = document.getElementById('setup-status');
    if (el) { el.textContent = 'Error: ' + e.message; el.className = 'status-line bad'; }
  }
}
// ── Settings validation ────────────────────────────────────────────────────────
function validateSettings() {
  var faceStartOffset   = Number((document.getElementById('faceStartOffset')   || {}).value);
  var faceProbeDistance = Number((document.getElementById('faceProbeDistance') || {}).value);
  var faceFeed          = Number((document.getElementById('faceFeed')          || {}).value);
  var travelFeedRate    = Number((document.getElementById('travelFeedRate')    || {}).value);
  if (!isFinite(faceStartOffset)) {
    logLine('face', 'Settings error: invalid Face Start Offset.'); return false;
  }
  if (!isFinite(faceProbeDistance) || faceProbeDistance <= 0) {
    logLine('face', 'Settings error: Face Probe Distance must be > 0.'); return false;
  }
  if (!isFinite(faceFeed) || faceFeed <= 0) {
    logLine('face', 'Settings error: Face Feed must be > 0.'); return false;
  }
  if (!isFinite(travelFeedRate) || travelFeedRate <= 0) {
    logLine('face', 'Settings error: Travel Feed Rate must be > 0.'); return false;
  }
  return true;
}
// ── Probe results persistence ─────────────────────────────────────────────────
var PROBE_RESULTS_KEY = '3dmesh.combined.probe_results';
var _saveProbeResultsTimer = null;
function saveProbeResults() {
  try {
    var data = {
      topResults: topResults,
      faceResults: faceResults,
      layeredFaceResults: layeredFaceResults,
      timestamp: Date.now()
    };
    localStorage.setItem(PROBE_RESULTS_KEY, JSON.stringify(data));
  } catch(e) { console.warn('saveProbeResults error:', e); }
}
function saveProbeResultsThrottled() {
  if (_saveProbeResultsTimer) clearTimeout(_saveProbeResultsTimer);
  _saveProbeResultsTimer = setTimeout(saveProbeResults, 1000);
}
function loadProbeResults() {
  try {
    var raw = localStorage.getItem(PROBE_RESULTS_KEY);
    if (!raw) return;
    var data = JSON.parse(raw);
    if (Array.isArray(data.topResults))        topResults        = data.topResults;
    if (Array.isArray(data.faceResults))       faceResults       = data.faceResults;
    if (Array.isArray(data.layeredFaceResults)) layeredFaceResults = data.layeredFaceResults;
    updateAllResultsUI();
  } catch(e) { console.warn('loadProbeResults error:', e); }
}
function clearPersistedProbeResults() {
  if (_saveProbeResultsTimer) { clearTimeout(_saveProbeResultsTimer); _saveProbeResultsTimer = null; }
  try { localStorage.removeItem(PROBE_RESULTS_KEY); } catch(e) {}
}
// ── Results UI helpers ────────────────────────────────────────────────────────
function updateAllResultsUI() {
  try { populateSurfaceResults(); }    catch(e) {}
  try { populateUnifiedProbeTable(); } catch(e) {}
  try { updateFaceMeshDataUI(); }      catch(e) {}
  try { updateEdgeProbeStorageUI(); }  catch(e) {}
}
function updateEdgeProbeStorageUI() {
  var el = document.getElementById('edge-probe-results-summary');
  if (!el) return;
  var topCount     = topResults     ? topResults.length     : 0;
  var faceCount    = faceResults    ? faceResults.length    : 0;
  var layeredCount = layeredFaceResults ? layeredFaceResults.length : 0;
  if (topCount === 0 && faceCount === 0 && layeredCount === 0) { el.innerHTML = ''; return; }
  var parts = [];
  if (topCount)     parts.push(topCount     + ' top point'          + (topCount     !== 1 ? 's' : ''));
  if (layeredCount) parts.push(layeredCount + ' layered face point' + (layeredCount !== 1 ? 's' : ''));
  else if (faceCount) parts.push(faceCount  + ' face point'        + (faceCount    !== 1 ? 's' : ''));
  el.innerHTML = '<span style="color:var(--muted);font-size:11px">In memory: ' + parts.join(', ') + '</span>';
}
// ── Clear all results ─────────────────────────────────────────────────────────
function clearAllResults() {
  if (!confirm('Clear all probe results and mesh data? This cannot be undone.')) return;
  topResults        = [];
  faceResults       = [];
  layeredFaceResults = [];
  // Also clear surface mesh data so the Probe Data table and relief maps blank out
  smMeshData   = null;
  smGridConfig = null;
  clearPersistedProbeResults();
  updateAllResultsUI();
  // Re-render relief maps (now with no data they will blank the canvases)
  try { renderSurfaceReliefMap(); } catch(e) {}
  try { renderFaceReliefMap(); }    catch(e) {}
  try { updateSurfaceMeshUI(); }    catch(e) {}
  setFooterStatus('All probe results cleared.', 'good');
}
// ── Export results as unified CSV ─────────────────────────────────────────────
function exportCSV() {
  var allData = [];
  if (smMeshData && smGridConfig) {
    var cfg = smGridConfig;
    for (var ri = 0; ri < cfg.rowCount; ri++) {
      for (var ci = 0; ci < cfg.colCount; ci++) {
        var z = smMeshData[ri][ci];
        if (z != null) {
          allData.push({
            x: cfg.minX + ci * cfg.colSpacing,
            y: cfg.minY + ri * cfg.rowSpacing,
            z: z, machineZ: null, type: 'Surface'
          });
        }
      }
    }
  }
  var faceData = getFaceMeshData();
  if (faceData) {
    faceData.forEach(function(p) {
      allData.push({ x: p.x, y: p.y, z: p.z, machineZ: p.machineZ, type: 'Face' });
    });
  }
  if (!allData.length) { alert('No probe data to export. Run a probe first.'); return; }
  var rows = ['# Plugin Version: ' + SM_VERSION, 'Index,X,Y,Z,Machine Z,Type'];
  allData.forEach(function(p, i) {
    rows.push((i + 1) + ',' + Number(p.x).toFixed(3) + ',' + Number(p.y).toFixed(3) + ',' +
      Number(p.z).toFixed(3) + ',' + (p.machineZ != null ? Number(p.machineZ).toFixed(3) : '') + ',' + p.type);
  });
  var blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'probe_results_' + Date.now() + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
// Alias: face CSV export uses existing implementation
function exportFaceCSV() { exportFaceMeshCSVNew(); }
// ── DXF helpers ───────────────────────────────────────────────────────────────
function _dxfHeader() {
  return '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n';
}
function _dxfFooter() { return '0\nENDSEC\n0\nEOF\n'; }
function _dxf3DPolyline(pts) {
  var s = '0\nPOLYLINE\n66\n1\n70\n8\n';
  pts.forEach(function(p) {
    s += '0\nVERTEX\n10\n' + Number(p.x).toFixed(4) + '\n20\n' + Number(p.y).toFixed(4) + '\n30\n' + Number(p.z).toFixed(4) + '\n70\n32\n';
  });
  s += '0\nSEQEND\n';
  return s;
}
function _dxfDownload(content, filename) {
  var blob = new Blob([content], { type: 'application/dxf' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  a.click(); URL.revokeObjectURL(a.href);
}
// ── OBJ helpers ───────────────────────────────────────────────────────────────
function _objDownload(content, filename) {
  var blob = new Blob([content], { type: 'model/obj' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  a.click(); URL.revokeObjectURL(a.href);
}
// ── Bowyer-Watson Delaunay triangulation ─────────────────────────────────────
// pts2d: [{x,y}, ...] — returns [[i0,i1,i2], ...] CCW triangles (indices into pts2d)
function _delaunayTriangulate(pts2d) {
  var n = pts2d.length;
  if (n < 3) return [];
  var minX = pts2d[0].x, maxX = pts2d[0].x, minY = pts2d[0].y, maxY = pts2d[0].y;
  for (var i = 1; i < n; i++) {
    if (pts2d[i].x < minX) minX = pts2d[i].x;
    if (pts2d[i].x > maxX) maxX = pts2d[i].x;
    if (pts2d[i].y < minY) minY = pts2d[i].y;
    if (pts2d[i].y > maxY) maxY = pts2d[i].y;
  }
  var sz = Math.max(maxX - minX, maxY - minY, 1) * 20;
  var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  var coords = pts2d.slice();
  coords.push({x: cx,      y: cy + sz});   // super-triangle vertex n
  coords.push({x: cx - sz, y: cy - sz});   // super-triangle vertex n+1
  coords.push({x: cx + sz, y: cy - sz});   // super-triangle vertex n+2
  var tris = [[n, n + 1, n + 2]];
  for (var pi = 0; pi < n; pi++) {
    var px = coords[pi].x, py = coords[pi].y;
    var bad = [];
    for (var ti = 0; ti < tris.length; ti++) {
      var t = tris[ti];
      var a = coords[t[0]], b = coords[t[1]], c = coords[t[2]];
      var adx=a.x-px, ady=a.y-py, bdx=b.x-px, bdy=b.y-py, cdx=c.x-px, cdy=c.y-py;
      if ((adx*adx+ady*ady)*(bdx*cdy-bdy*cdx)
        - (bdx*bdx+bdy*bdy)*(adx*cdy-ady*cdx)
        + (cdx*cdx+cdy*cdy)*(adx*bdy-ady*bdx) > 0) bad.push(ti);
    }
    var boundary = [];
    for (var bi = 0; bi < bad.length; bi++) {
      var T = tris[bad[bi]];
      var edges = [[T[0],T[1]],[T[1],T[2]],[T[2],T[0]]];
      for (var ei = 0; ei < 3; ei++) {
        var e = edges[ei];
        var shared = false;
        for (var bj = 0; bj < bad.length && !shared; bj++) {
          if (bj === bi) continue;
          var T2 = tris[bad[bj]];
          if ((T2[0]===e[0]||T2[1]===e[0]||T2[2]===e[0]) &&
              (T2[0]===e[1]||T2[1]===e[1]||T2[2]===e[1])) shared = true;
        }
        if (!shared) boundary.push(e);
      }
    }
    bad.sort(function(a,b){return b-a;});
    for (var di = 0; di < bad.length; di++) tris.splice(bad[di], 1);
    for (var fi = 0; fi < boundary.length; fi++) tris.push([boundary[fi][0], boundary[fi][1], pi]);
  }
  return tris.filter(function(t) { return t[0] < n && t[1] < n && t[2] < n; });
}
// ── Smooth per-vertex normals ─────────────────────────────────────────────────
// verts: [{x,y,z}, ...], tris: [[i0,i1,i2], ...] — returns [{x,y,z}, ...] normalised
function _computeVertexNormals(verts, tris) {
  var norms = verts.map(function() { return {x:0, y:0, z:0}; });
  for (var ti = 0; ti < tris.length; ti++) {
    var t = tris[ti];
    var v0=verts[t[0]], v1=verts[t[1]], v2=verts[t[2]];
    var e1x=v1.x-v0.x, e1y=v1.y-v0.y, e1z=v1.z-v0.z;
    var e2x=v2.x-v0.x, e2y=v2.y-v0.y, e2z=v2.z-v0.z;
    var nx=e1y*e2z-e1z*e2y, ny=e1z*e2x-e1x*e2z, nz=e1x*e2y-e1y*e2x;
    for (var vi = 0; vi < 3; vi++) { norms[t[vi]].x+=nx; norms[t[vi]].y+=ny; norms[t[vi]].z+=nz; }
  }
  for (var i = 0; i < norms.length; i++) {
    var n=norms[i], len=Math.sqrt(n.x*n.x+n.y*n.y+n.z*n.z);
    if (len > 1e-10) { n.x/=len; n.y/=len; n.z/=len; } else { n.x=0; n.y=0; n.z=1; }
  }
  return norms;
}
// ── Surface DXF export ────────────────────────────────────────────────────────
function exportSurfaceDXF() {
  if (!smMeshData || !smGridConfig) { alert('No surface mesh data. Run a surface probe first.'); return; }
  var cfg = smGridConfig, grid = smMeshData;
  var dxf = _dxfHeader();
  // Export each row as a 3D polyline
  for (var ri = 0; ri < cfg.rowCount; ri++) {
    var pts = [];
    for (var ci = 0; ci < cfg.colCount; ci++) {
      var z = grid[ri][ci];
      if (z != null) pts.push({ x: cfg.minX + ci * cfg.colSpacing, y: cfg.minY + ri * cfg.rowSpacing, z: z });
    }
    if (pts.length >= 2) dxf += _dxf3DPolyline(pts);
  }
  // Export each column as a 3D polyline
  for (var ci2 = 0; ci2 < cfg.colCount; ci2++) {
    var cpts = [];
    for (var ri2 = 0; ri2 < cfg.rowCount; ri2++) {
      var z2 = grid[ri2][ci2];
      if (z2 != null) cpts.push({ x: cfg.minX + ci2 * cfg.colSpacing, y: cfg.minY + ri2 * cfg.rowSpacing, z: z2 });
    }
    if (cpts.length >= 2) dxf += _dxf3DPolyline(cpts);
  }
  dxf += _dxfFooter();
  _dxfDownload(dxf, 'surface_mesh_' + Date.now() + '.dxf');
}
// ── Surface OBJ export ────────────────────────────────────────────────────────
function exportSurfaceOBJ() {
  if (!smMeshData || !smGridConfig) { alert('No surface mesh data. Run a surface probe first.'); return; }
  var cfg = smGridConfig, grid = smMeshData;
  var lines = ['# 3D Live Edge Mesh — Surface OBJ', '# Plugin Version: ' + SM_VERSION, '# Exported: ' + new Date().toISOString(), ''];
  var allVerts = [];
  var allTris = [];
  // Map grid positions to vertex indices (0-based)
  var vMap = [];
  for (var ri = 0; ri < cfg.rowCount; ri++) {
    vMap.push([]);
    for (var ci = 0; ci < cfg.colCount; ci++) {
      var z = grid[ri][ci];
      if (z != null) {
        vMap[ri].push(allVerts.length);
        allVerts.push({x: cfg.minX + ci*cfg.colSpacing, y: cfg.minY + ri*cfg.rowSpacing, z: z});
      } else {
        vMap[ri].push(null);
      }
    }
  }
  // Split each valid grid quad into two CCW triangles (normal points up +Z)
  for (var fr = 0; fr < cfg.rowCount - 1; fr++) {
    for (var fc = 0; fc < cfg.colCount - 1; fc++) {
      var a=vMap[fr][fc], b=vMap[fr][fc+1], c=vMap[fr+1][fc+1], d=vMap[fr+1][fc];
      if (a!=null && b!=null && c!=null && d!=null) {
        allTris.push([a, b, c]);
        allTris.push([a, c, d]);
      } else if (a!=null && b!=null && c!=null) { allTris.push([a, b, c]);
      } else if (a!=null && c!=null && d!=null) { allTris.push([a, c, d]);
      } else if (b!=null && c!=null && d!=null) { allTris.push([b, c, d]);
      } else if (a!=null && b!=null && d!=null) { allTris.push([a, b, d]); }
    }
  }
  var norms = _computeVertexNormals(allVerts, allTris);
  allVerts.forEach(function(v) { lines.push('v ' + v.x.toFixed(4) + ' ' + v.y.toFixed(4) + ' ' + v.z.toFixed(4)); });
  lines.push('');
  norms.forEach(function(n) { lines.push('vn ' + n.x.toFixed(4) + ' ' + n.y.toFixed(4) + ' ' + n.z.toFixed(4)); });
  lines.push('');
  allTris.forEach(function(t) {
    var i0=t[0]+1, i1=t[1]+1, i2=t[2]+1;
    lines.push('f ' + i0 + '//' + i0 + ' ' + i1 + '//' + i1 + ' ' + i2 + '//' + i2);
  });
  _objDownload(lines.join('\n'), 'surface_mesh_' + Date.now() + '.obj');
}
// ── Face DXF export ───────────────────────────────────────────────────────────
function exportFaceDXF() {
  var data = getFaceMeshData();
  if (!data || !data.length) { alert('No face mesh data. Run a face probe first.'); return; }
  var dxf = _dxfHeader();
  // Group by layer and X sample coordinate (sampleCoord), emit each as a polyline
  var byLayer = {};
  data.forEach(function(p) {
    var layer = p.layer != null ? p.layer : 1;
    if (!byLayer[layer]) byLayer[layer] = [];
    byLayer[layer].push(p);
  });
  Object.keys(byLayer).sort(function(a, b){ return Number(a) - Number(b); }).forEach(function(layer) {
    var pts = byLayer[layer].slice().sort(function(a, b){ return Number(a.x) - Number(b.x); });
    if (pts.length >= 2) dxf += _dxf3DPolyline(pts.map(function(p){ return { x: p.x, y: p.y, z: p.z }; }));
  });
  dxf += _dxfFooter();
  _dxfDownload(dxf, 'face_mesh_' + Date.now() + '.dxf');
}
// ── Face OBJ export ───────────────────────────────────────────────────────────
function exportFaceOBJ() {
  var data = getFaceMeshData();
  if (!data || !data.length) { alert('No face mesh data. Run a face probe first.'); return; }
  var lines = ['# 3D Live Edge Mesh — Face OBJ', '# Plugin Version: ' + SM_VERSION, '# Exported: ' + new Date().toISOString(), ''];
  // Build 3D vertex list from all probe contacts
  var allVerts = data.map(function(p) { return {x: Number(p.x), y: Number(p.y), z: Number(p.z)}; });
  // Project to 2D (X, Z plane) for Delaunay — face points scatter across X and depth-Z
  var pts2d = allVerts.map(function(v) { return {x: v.x, y: v.z}; });
  var allTris = _delaunayTriangulate(pts2d);
  if (!allTris.length) { alert('Triangulation failed — need at least 3 face probe points.'); return; }
  // Ensure face normals point in -Y direction (outward from workpiece toward probe approach)
  var sumNy = 0;
  allTris.forEach(function(t) {
    var v0=allVerts[t[0]], v1=allVerts[t[1]], v2=allVerts[t[2]];
    var e1x=v1.x-v0.x, e1z=v1.z-v0.z, e2x=v2.x-v0.x, e2z=v2.z-v0.z;
    sumNy += e1z*e2x - e1x*e2z;
  });
  if (sumNy > 0) allTris = allTris.map(function(t) { return [t[0], t[2], t[1]]; });
  var norms = _computeVertexNormals(allVerts, allTris);
  allVerts.forEach(function(v) { lines.push('v ' + v.x.toFixed(4) + ' ' + v.y.toFixed(4) + ' ' + v.z.toFixed(4)); });
  lines.push('');
  norms.forEach(function(n) { lines.push('vn ' + n.x.toFixed(4) + ' ' + n.y.toFixed(4) + ' ' + n.z.toFixed(4)); });
  lines.push('');
  allTris.forEach(function(t) {
    var i0=t[0]+1, i1=t[1]+1, i2=t[2]+1;
    lines.push('f ' + i0 + '//' + i0 + ' ' + i1 + '//' + i1 + ' ' + i2 + '//' + i2);
  });
  _objDownload(lines.join('\n'), 'face_mesh_' + Date.now() + '.obj');
}
// ── Combined DXF export ───────────────────────────────────────────────────────
function exportCombinedDXF() {
  if (!smMeshData && !getFaceMeshData()) { alert('No mesh data to export.'); return; }
  var dxf = _dxfHeader();
  // Surface rows
  if (smMeshData && smGridConfig) {
    var cfg = smGridConfig, grid = smMeshData;
    for (var ri = 0; ri < cfg.rowCount; ri++) {
      var pts = [];
      for (var ci = 0; ci < cfg.colCount; ci++) {
        var z = grid[ri][ci];
        if (z != null) pts.push({ x: cfg.minX + ci * cfg.colSpacing, y: cfg.minY + ri * cfg.rowSpacing, z: z });
      }
      if (pts.length >= 2) dxf += _dxf3DPolyline(pts);
    }
  }
  // Face layers
  var faceData = getFaceMeshData();
  if (faceData && faceData.length) {
    var byLayer = {};
    faceData.forEach(function(p){ var l = p.layer != null ? p.layer : 1; if (!byLayer[l]) byLayer[l] = []; byLayer[l].push(p); });
    Object.keys(byLayer).sort(function(a,b){return Number(a)-Number(b);}).forEach(function(l) {
      var pts = byLayer[l].sort(function(a,b){return Number(a.x)-Number(b.x);});
      if (pts.length >= 2) dxf += _dxf3DPolyline(pts.map(function(p){return{x:p.x,y:p.y,z:p.z};}));
    });
  }
  dxf += _dxfFooter();
  _dxfDownload(dxf, 'combined_mesh_' + Date.now() + '.dxf');
}
// ── Combined OBJ watertight export ────────────────────────────────────────────
function exportCombinedOBJWatertight() {
  var faceData = getFaceMeshData();
  if (!smMeshData || !smGridConfig || !faceData || !faceData.length) {
    alert('Both surface mesh and face mesh data are required for a watertight combined export.'); return;
  }
  var bottomZ = Number((document.getElementById('combinedBottomZ') || {}).value);
  if (!isFinite(bottomZ)) bottomZ = -20;
  var cfg = smGridConfig, grid = smMeshData;
  var lines = ['# 3D Live Edge Mesh — Combined Watertight OBJ', '# Plugin Version: ' + SM_VERSION, ''];
  var allVerts = [];
  var allTris = [];
  // ── Surface mesh (grid triangulation, CCW for +Z normal) ───────────────────
  var surfV = [];
  for (var ri = 0; ri < cfg.rowCount; ri++) {
    surfV.push([]);
    for (var ci = 0; ci < cfg.colCount; ci++) {
      var z = grid[ri][ci];
      surfV[ri].push(allVerts.length);
      allVerts.push({x: cfg.minX + ci*cfg.colSpacing, y: cfg.minY + ri*cfg.rowSpacing, z: (z != null ? z : 0)});
    }
  }
  for (var fr = 0; fr < cfg.rowCount - 1; fr++) {
    for (var fc = 0; fc < cfg.colCount - 1; fc++) {
      var a=surfV[fr][fc], b=surfV[fr][fc+1], c=surfV[fr+1][fc+1], d=surfV[fr+1][fc];
      allTris.push([a, b, c]);
      allTris.push([a, c, d]);
    }
  }
  // ── Face mesh (Delaunay on X-Z projection, CCW for -Y normal) ─────────────
  var faceVStart = allVerts.length;
  var faceVerts3d = faceData.map(function(p) { return {x: Number(p.x), y: Number(p.y), z: Number(p.z)}; });
  faceVerts3d.forEach(function(v) { allVerts.push(v); });
  var faceTris = _delaunayTriangulate(faceVerts3d.map(function(v) { return {x: v.x, y: v.z}; }));
  faceTris = faceTris.map(function(t) { return [t[0]+faceVStart, t[1]+faceVStart, t[2]+faceVStart]; });
  // Ensure face normals point in -Y direction
  var sumNy = 0;
  faceTris.forEach(function(t) {
    var v0=allVerts[t[0]], v1=allVerts[t[1]], v2=allVerts[t[2]];
    var e1x=v1.x-v0.x, e1z=v1.z-v0.z, e2x=v2.x-v0.x, e2z=v2.z-v0.z;
    sumNy += e1z*e2x - e1x*e2z;
  });
  if (sumNy > 0) faceTris = faceTris.map(function(t) { return [t[0], t[2], t[1]]; });
  allTris = allTris.concat(faceTris);
  // ── Bottom cap (front edge of surface to bottomZ, -Y normal) ───────────────
  var bottomVStart = allVerts.length;
  for (var bc = 0; bc < cfg.colCount; bc++) {
    allVerts.push({x: cfg.minX + bc*cfg.colSpacing, y: cfg.minY, z: bottomZ});
  }
  var frontRow = surfV[0];
  for (var bc2 = 0; bc2 < cfg.colCount - 1; bc2++) {
    var f0=frontRow[bc2], f1=frontRow[bc2+1], b0=bottomVStart+bc2, b1=bottomVStart+bc2+1;
    allTris.push([f0, b0, b1]);
    allTris.push([f0, b1, f1]);
  }
  // ── Compute vertex normals and write OBJ ───────────────────────────────────
  var norms = _computeVertexNormals(allVerts, allTris);
  allVerts.forEach(function(v) { lines.push('v ' + v.x.toFixed(4) + ' ' + v.y.toFixed(4) + ' ' + v.z.toFixed(4)); });
  lines.push('');
  norms.forEach(function(n) { lines.push('vn ' + n.x.toFixed(4) + ' ' + n.y.toFixed(4) + ' ' + n.z.toFixed(4)); });
  lines.push('');
  allTris.forEach(function(t) {
    var i0=t[0]+1, i1=t[1]+1, i2=t[2]+1;
    lines.push('f ' + i0 + '//' + i0 + ' ' + i1 + '//' + i1 + ' ' + i2 + '//' + i2);
  });
  _objDownload(lines.join('\n'), 'combined_watertight_' + Date.now() + '.obj');
}
// ── Workflow stubs (UI buttons not yet present in HTML) ────────────────────────
var _WORKFLOW_STORAGE_KEY = '3dmesh.combined.workflows';
function renderWorkflowList() {
  var el = document.getElementById('workflow-list');
  if (!el) return;
  var wfs = _loadAllWorkflows();
  var names = Object.keys(wfs);
  if (!names.length) { el.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:8px">No saved workflows</div>'; return; }
  el.innerHTML = names.map(function(n) {
    return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0">' +
      '<span style="flex:1;font-size:12px">' + n + '</span>' +
      '<button class="btn ghost wf-load" data-wf-name="' + n + '" style="padding:2px 10px;font-size:11px">Load</button>' +
      '<button class="btn warn wf-delete" data-wf-name="' + n + '" style="padding:2px 10px;font-size:11px">&#10005;</button>' +
      '</div>';
  }).join('');
}
function _loadAllWorkflows() {
  try { var r = localStorage.getItem(_WORKFLOW_STORAGE_KEY); return r ? JSON.parse(r) : {}; } catch(e) { return {}; }
}
function _saveAllWorkflows(wfs) {
  try { localStorage.setItem(_WORKFLOW_STORAGE_KEY, JSON.stringify(wfs)); } catch(e) {}
}
function saveWorkflow() {
  var nameEl = document.getElementById('workflow-name');
  var name = nameEl ? nameEl.value.trim() : ('Workflow ' + new Date().toLocaleTimeString());
  if (!name) { alert('Enter a workflow name.'); return; }
  var wfs = _loadAllWorkflows();
  wfs[name] = getSettingsFromUI();
  _saveAllWorkflows(wfs);
  renderWorkflowList();
  setFooterStatus('Workflow "' + name + '" saved.', 'good');
}
function loadWorkflow() {
  var nameEl = document.getElementById('workflow-name');
  var name = nameEl ? nameEl.value.trim() : '';
  if (!name) { alert('Enter the workflow name to load.'); return; }
  _loadWorkflowByName(name);
}
function _loadWorkflowByName(name) {
  var wfs = _loadAllWorkflows();
  if (!wfs[name]) { alert('Workflow "' + name + '" not found.'); return; }
  var data = wfs[name];
  // Apply as settings
  try { localStorage.setItem(SM_SETTINGS_KEY, JSON.stringify(data)); loadSettings(); } catch(e) {}
  setFooterStatus('Workflow "' + name + '" loaded.', 'good');
}
function deleteWorkflow(name) {
  var wfs = _loadAllWorkflows();
  if (!wfs[name]) return;
  delete wfs[name];
  _saveAllWorkflows(wfs);
  renderWorkflowList();
  setFooterStatus('Workflow "' + name + '" deleted.', 'good');
}
function exportWorkflows() {
  var wfs = _loadAllWorkflows();
  if (!Object.keys(wfs).length) { alert('No saved workflows to export.'); return; }
  var blob = new Blob([JSON.stringify(wfs, null, 2)], { type: 'application/json' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'workflows_' + Date.now() + '.json';
  a.click(); URL.revokeObjectURL(a.href);
}
function importWorkflows() {
  var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json';
  inp.onchange = function(ev) {
    var file = ev.target.files[0]; if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var data = JSON.parse(e.target.result);
        if (typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected a workflow object');
        var existing = _loadAllWorkflows();
        Object.assign(existing, data);
        _saveAllWorkflows(existing);
        renderWorkflowList();
        setFooterStatus('Imported ' + Object.keys(data).length + ' workflow(s).', 'good');
      } catch(err) { alert('Failed to import workflows: ' + err.message); }
    };
    reader.readAsText(file);
  };
  inp.click();
}
