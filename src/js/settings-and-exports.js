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
// Compute per-vertex averaged normals for an OBJ mesh.
// vertices: [[x,y,z], ...] (0-based), faces: [[i0,i1,...], ...] (0-based, quads or tris)
// Returns [[nx,ny,nz], ...] normalized per-vertex normals.
function _computeOBJNormals(vertices, faces) {
  var normals = vertices.map(function() { return [0, 0, 0]; });
  faces.forEach(function(face) {
    var tris = face.length === 4
      ? [[face[0], face[1], face[2]], [face[0], face[2], face[3]]]
      : [face];
    tris.forEach(function(tri) {
      var a = vertices[tri[0]], b = vertices[tri[1]], c = vertices[tri[2]];
      var e1 = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
      var e2 = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
      var n = [
        e1[1]*e2[2] - e1[2]*e2[1],
        e1[2]*e2[0] - e1[0]*e2[2],
        e1[0]*e2[1] - e1[1]*e2[0]
      ];
      tri.forEach(function(vi) { normals[vi][0] += n[0]; normals[vi][1] += n[1]; normals[vi][2] += n[2]; });
    });
  });
  return normals.map(function(n) {
    var len = Math.sqrt(n[0]*n[0] + n[1]*n[1] + n[2]*n[2]);
    if (len < 1e-10) return [0, 0, 1];
    return [n[0]/len, n[1]/len, n[2]/len];
  });
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
  var vIdx = 1;
  var verts = [], vertLines = [], vMap = [];
  // Build vertices
  for (var ri = 0; ri < cfg.rowCount; ri++) {
    vMap.push([]);
    for (var ci = 0; ci < cfg.colCount; ci++) {
      var z = grid[ri][ci];
      if (z != null) {
        var vx = cfg.minX + ci * cfg.colSpacing, vy = cfg.minY + ri * cfg.rowSpacing;
        verts.push([vx, vy, z]);
        vertLines.push('v ' + vx.toFixed(4) + ' ' + vy.toFixed(4) + ' ' + z.toFixed(4));
        vMap[ri].push(vIdx++);
      } else {
        vMap[ri].push(null);
      }
    }
  }
  // Build quad face index arrays (0-based for normal computation, 1-based for OBJ)
  var facesZero = [], faceOBJ = [];
  for (var fr = 0; fr < cfg.rowCount - 1; fr++) {
    for (var fc = 0; fc < cfg.colCount - 1; fc++) {
      var a = vMap[fr][fc], b = vMap[fr][fc + 1], c = vMap[fr + 1][fc + 1], d = vMap[fr + 1][fc];
      if (a && b && c && d) {
        facesZero.push([a-1, b-1, c-1, d-1]);
        faceOBJ.push([a, b, c, d]);
      }
    }
  }
  // Compute vertex normals
  var vnList = _computeOBJNormals(verts, facesZero);
  lines = lines.concat(vertLines);
  lines.push('');
  vnList.forEach(function(n) { lines.push('vn ' + n[0].toFixed(4) + ' ' + n[1].toFixed(4) + ' ' + n[2].toFixed(4)); });
  lines.push('');
  faceOBJ.forEach(function(f, fi) {
    var n0 = f[0], n1 = f[1], n2 = f[2], n3 = f[3];
    lines.push('f ' + n0 + '//' + n0 + ' ' + n1 + '//' + n1 + ' ' + n2 + '//' + n2 + ' ' + n3 + '//' + n3);
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
  var vIdx = 1;
  var verts = [], vertLines = [];
  var byLayer = {};
  data.forEach(function(p) { var l = p.layer != null ? p.layer : 1; if (!byLayer[l]) byLayer[l] = []; byLayer[l].push(p); });
  var layerKeys = Object.keys(byLayer).map(Number).sort(function(a,b){return a-b;});
  var layerVerts = {};
  layerKeys.forEach(function(l) {
    var pts = byLayer[l].slice().sort(function(a,b){ return Number(a.x)-Number(b.x); });
    layerVerts[l] = [];
    pts.forEach(function(p) {
      verts.push([Number(p.x), Number(p.y), Number(p.z)]);
      vertLines.push('v ' + Number(p.x).toFixed(4) + ' ' + Number(p.y).toFixed(4) + ' ' + Number(p.z).toFixed(4));
      layerVerts[l].push(vIdx++);
    });
  });
  // Build quad face index arrays (0-based for normals, 1-based for OBJ)
  var facesZero = [], faceOBJ = [];
  for (var li = 0; li < layerKeys.length - 1; li++) {
    var l0 = layerKeys[li], l1 = layerKeys[li + 1];
    var v0 = layerVerts[l0], v1 = layerVerts[l1];
    var len = Math.min(v0.length, v1.length);
    for (var pi = 0; pi < len - 1; pi++) {
      facesZero.push([v0[pi]-1, v0[pi+1]-1, v1[pi+1]-1, v1[pi]-1]);
      faceOBJ.push([v0[pi], v0[pi+1], v1[pi+1], v1[pi]]);
    }
  }
  // Compute vertex normals
  var vnList = _computeOBJNormals(verts, facesZero);
  lines = lines.concat(vertLines);
  lines.push('');
  vnList.forEach(function(n) { lines.push('vn ' + n[0].toFixed(4) + ' ' + n[1].toFixed(4) + ' ' + n[2].toFixed(4)); });
  lines.push('');
  faceOBJ.forEach(function(f) {
    lines.push('f ' + f[0] + '//' + f[0] + ' ' + f[1] + '//' + f[1] + ' ' + f[2] + '//' + f[2] + ' ' + f[3] + '//' + f[3]);
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
  var vIdx = 1;
  var verts = [], vertLines = [], facesZero = [], faceOBJ = [];
  // Surface vertices (grid)
  var surfV = [];
  for (var ri = 0; ri < cfg.rowCount; ri++) {
    surfV.push([]);
    for (var ci = 0; ci < cfg.colCount; ci++) {
      var z = grid[ri][ci];
      var vz = (z != null) ? z : 0;
      var vx = cfg.minX + ci * cfg.colSpacing, vy = cfg.minY + ri * cfg.rowSpacing;
      verts.push([vx, vy, vz]);
      vertLines.push('v ' + vx.toFixed(4) + ' ' + vy.toFixed(4) + ' ' + vz.toFixed(4));
      surfV[ri].push(vIdx++);
    }
  }
  // Surface quads
  for (var fr = 0; fr < cfg.rowCount - 1; fr++) {
    for (var fc = 0; fc < cfg.colCount - 1; fc++) {
      var a = surfV[fr][fc], b = surfV[fr][fc+1], c = surfV[fr+1][fc+1], d = surfV[fr+1][fc];
      facesZero.push([a-1, b-1, c-1, d-1]);
      faceOBJ.push([a, b, c, d]);
    }
  }
  // Face mesh vertices (layered, sorted by layer then x)
  var byLayer = {};
  faceData.forEach(function(p){ var l = p.layer != null ? p.layer : 1; if (!byLayer[l]) byLayer[l] = []; byLayer[l].push(p); });
  var layerKeys = Object.keys(byLayer).map(Number).sort(function(a,b){return a-b;});
  var layerVerts = {};
  layerKeys.forEach(function(l) {
    var pts = byLayer[l].slice().sort(function(a,b){ return Number(a.x)-Number(b.x); });
    layerVerts[l] = [];
    pts.forEach(function(p) {
      verts.push([Number(p.x), Number(p.y), Number(p.z)]);
      vertLines.push('v ' + Number(p.x).toFixed(4) + ' ' + Number(p.y).toFixed(4) + ' ' + Number(p.z).toFixed(4));
      layerVerts[l].push(vIdx++);
    });
  });
  // Face quads between adjacent layers
  for (var li = 0; li < layerKeys.length - 1; li++) {
    var l0 = layerKeys[li], l1 = layerKeys[li+1];
    var v0 = layerVerts[l0], v1 = layerVerts[l1];
    var flen = Math.min(v0.length, v1.length);
    for (var pi = 0; pi < flen - 1; pi++) {
      facesZero.push([v0[pi]-1, v0[pi+1]-1, v1[pi+1]-1, v1[pi]-1]);
      faceOBJ.push([v0[pi], v0[pi+1], v1[pi+1], v1[pi]]);
    }
  }
  // Bottom cap vertices at combinedBottomZ
  var bottomColCount = cfg.colCount;
  var bottomVStart = vIdx;
  for (var bc = 0; bc < bottomColCount; bc++) {
    var bx = cfg.minX + bc * cfg.colSpacing;
    verts.push([bx, cfg.minY, bottomZ]);
    vertLines.push('v ' + bx.toFixed(4) + ' ' + cfg.minY.toFixed(4) + ' ' + bottomZ.toFixed(4));
    vIdx++;
  }
  // Bottom cap quads (close bottom edge of surface front row to bottomZ)
  var frontRow = surfV[0]; // minY row
  for (var bc2 = 0; bc2 < bottomColCount - 1; bc2++) {
    var fa = frontRow[bc2], fb = frontRow[bc2+1], fc2 = bottomVStart+bc2+1, fd = bottomVStart+bc2;
    facesZero.push([fa-1, fb-1, fc2-1, fd-1]);
    faceOBJ.push([fa, fb, fc2, fd]);
  }
  // Compute vertex normals
  var vnList = _computeOBJNormals(verts, facesZero);
  lines = lines.concat(vertLines);
  lines.push('');
  vnList.forEach(function(n) { lines.push('vn ' + n[0].toFixed(4) + ' ' + n[1].toFixed(4) + ' ' + n[2].toFixed(4)); });
  lines.push('');
  faceOBJ.forEach(function(f) {
    lines.push('f ' + f[0] + '//' + f[0] + ' ' + f[1] + '//' + f[1] + ' ' + f[2] + '//' + f[2] + ' ' + f[3] + '//' + f[3]);
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
