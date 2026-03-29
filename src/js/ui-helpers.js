function getSettingsFromUI(){
  return {
    sampleAxis:           document.getElementById('sampleAxis').value || 'X',
    topFixedCoord:        Number(document.getElementById('topFixedCoord').value) || 0,
    topSampleStart:       Number(document.getElementById('topSampleStart').value) || 0,
    topSampleEnd:         Number(document.getElementById('topSampleEnd').value) || 100,
    topSampleCount:       Math.max(2, Number(document.getElementById('topSampleCount').value) || 10),
    useInitialClearanceLift:(document.getElementById('useInitialClearanceLift').value || 'no') === 'yes',
    topClearZ:            Number(document.getElementById('topClearZ').value) || 5,
    topFeed:              Number(document.getElementById('topFeed').value) || 200,
    topProbeDepth:        Number(document.getElementById('topProbeDepth').value) || 5,
    topRetract:           Number(document.getElementById('topRetract').value) || 2,
    travelFeedRate:       Number(document.getElementById('travelFeedRate').value) || 600,
    travelRecoveryFeedRate: Number(document.getElementById('travelRecoveryFeedRate').value) || 1500,
    travelRecoveryLiftFeedRate: Number(document.getElementById('travelRecoveryLiftFeedRate').value) || 1000,
    useTravelContactRecovery: (document.getElementById('useTravelContactRecovery').value || 'yes'),
    travelContactStep:    Number(document.getElementById('travelContactStep').value) || 5,
    travelContactBackoff: Number(document.getElementById('travelContactBackoff').value) || 5,
    travelContactLift:    Number(document.getElementById('travelContactLift').value) || 5,
    travelContactMaxRetries: Math.max(1, Math.round(Number(document.getElementById('travelContactMaxRetries').value) || 5)),
    faceFixedCoord:       Number(document.getElementById('faceFixedCoord').value) || 0,
    faceStartOffset:      Number(document.getElementById('faceStartOffset').value) || -10,
    faceFeed:             Number(document.getElementById('faceFeed').value) || 150,
    faceRetractFeed:      Number(document.getElementById('faceRetractFeed').value) || 1000,
    faceDepthBelowSurface:Number(document.getElementById('faceDepthBelowSurface').value) || 2,
    faceProbeDistance:    Number(document.getElementById('faceProbeDistance').value) || 20,
    enableLayeredFace: (function(){ var el = document.getElementById('enableLayeredFace'); return !!(el && el.checked); })(),
    faceLayerCount:       Math.max(2, Math.round(Number((document.getElementById('faceLayerCount')||{}).value) || 3)),
    faceMaxDepth:         Number((document.getElementById('faceMaxDepth')||{}).value) || 14.75,
    faceTopSurfaceMode:   (function(){ var el = document.getElementById('faceTopSurfaceMode'); return el ? el.value : 'flat'; })(),
    finishHomeZ:          Number(document.getElementById('finishHomeZ').value) || 10,
    useMachineHomeRetract:(document.getElementById('useMachineHomeRetract').value || 'yes') === 'yes',
    machineSafeTopZ:      Number(document.getElementById('machineSafeTopZ').value) || 0,
    returnToXYZero:       (document.getElementById('returnToXYZero').value || 'yes') === 'yes',
    jogStepXY:            Number(document.getElementById('jogStepXY').value) || 1,
    jogStepZ:             Number(document.getElementById('jogStepZ').value) || 2,
    jogFeedXY:            Number(document.getElementById('jogFeedXY').value) || 600,
    jogFeedZ:             Number(document.getElementById('jogFeedZ').value) || 300,
    probeShankDiameter: Number((document.getElementById('probeShankDiameter')||{}).value) || 6,
    probeBodyDiameter: Number((document.getElementById('probeBodyDiameter')||{}).value) || 33,
    probeUpperHeight: Number((document.getElementById('probeUpperHeight')||{}).value) || 20,
    probeMainBodyHeight: Number((document.getElementById('probeMainBodyHeight')||{}).value) || 21,
    probeStylusLength: Number((document.getElementById('probeStylusLength')||{}).value) || 26,
    probeStylusCalloutLength: Number((document.getElementById('probeStylusCalloutLength')||{}).value) || 14.75,
    probeBallTipDiameter: Number((document.getElementById('probeBallTipDiameter')||{}).value) || 0,
    probeTotalLength: Number((document.getElementById('probeTotalLength')||{}).value) || 67,
    meshSubdivisionSpacing: (function(){ var el = document.getElementById('meshSubdivisionSpacing'); return el ? Number(el.value) : 2; })(),
    faceOBJSubdivision: (function(){ var el = document.getElementById('faceOBJSubdivision'); return el ? Number(el.value) : 2; })(),
  };
}

function refreshFinishBehaviorPreview(){
  var zEl = document.getElementById('finishHomeZ');
  var machineZEl = document.getElementById('machineSafeTopZ');
  var machineRetractEl = document.getElementById('useMachineHomeRetract');
  var xyEl = document.getElementById('returnToXYZero');
  var prevEl = document.getElementById('finishBehaviorPreview');
  if(!prevEl) return;
  var fallbackZ = Number(zEl && zEl.value || 0).toFixed(3);
  var machineZ = Number(machineZEl && machineZEl.value || 0).toFixed(3);
  var retractText = (machineRetractEl && machineRetractEl.value === 'yes')
    ? ('Retract with G53 to machine Z' + machineZ)
    : ('Use fallback work Z' + fallbackZ);
  var xy = (xyEl && xyEl.value === 'yes') ? 'then move to X0 Y0' : 'stay at current X/Y';
  prevEl.value = retractText + ', ' + xy;
}


function refreshTravelRecoveryPreview(){
  var liftEl = document.getElementById('travelContactLift');
  var retryEl = document.getElementById('travelContactMaxRetries');
  var prevEl = document.getElementById('travelContactMaxLiftPreview');
  if(!prevEl) return;
  var lift = Number(liftEl && liftEl.value || 0);
  var retries = Math.max(1, Math.round(Number(retryEl && retryEl.value || 0) || 1));
  var maxLift = lift * retries;
  prevEl.value = maxLift.toFixed(3);
}

async function useCurrentZAsFinishHome(){
  try{
    var info = await getMachineSnapshot();
    var zEl = document.getElementById('finishHomeZ');
    if(zEl) zEl.value = Number(info.z).toFixed(3);
    refreshFinishBehaviorPreview();
    setFooterStatus('Fallback finish Z updated from current Z.', 'good');
    var el = document.getElementById('setup-status');
    if(el){ el.textContent = 'Fallback finish Z set from current work Z.'; el.className = 'status-line good'; }
  }catch(e){
    setFooterStatus('Error: ' + e.message, 'bad');
    var el = document.getElementById('setup-status');
    if(el){ el.textContent = 'Could not read current Z: ' + e.message; el.className = 'status-line bad'; }
  }
}


async function raiseFaceTravelSafeZ(label, currentPos, cachedSafeZ){
  s = getSettingsFromUI();
  var retractClearance = Number(s.topRetract) || 2;

  var localSafeZ;
  var safeZSource;
  if(isFinite(cachedSafeZ)){
    // Use the caller-supplied pre-computed safe Z — skip the topResults scan.
    localSafeZ = cachedSafeZ;
    safeZSource = 'cached safe Z';
  } else {
    // Calculate local safe Z from top profile data
    var topPts = topResults.filter(function(r){ return r.status === 'TOP'; });
    var highestTopZ = -Infinity;
    topPts.forEach(function(tp){
      var z = Number(tp.z);
      if(z > highestTopZ) highestTopZ = z;
    });
    if(isFinite(highestTopZ)){
      localSafeZ = highestTopZ + retractClearance;
      safeZSource = 'highest top Z';
    } else {
      safeZSource = 'current Z (no top profile)';
      // localSafeZ resolved below after we know currentZ
    }
  }

  // Get current Z — use provided position to skip the getMachineSnapshot() HTTP call.
  var currentZ;
  if(currentPos && isFinite(Number(currentPos.z))){
    currentZ = Number(currentPos.z);
  } else {
    var snap = await getMachineSnapshot();
    currentZ = Number(snap && snap.z);
  }

  // Resolve localSafeZ fallback (no cachedSafeZ and no top profile data)
  if(localSafeZ === undefined){
    localSafeZ = (isFinite(currentZ) ? currentZ : 0) + retractClearance;
  }

  // Only raise if we're below the safe Z
  if(isFinite(currentZ) && currentZ >= localSafeZ){
    logLine('face', label + ': current Z ' + currentZ.toFixed(3) + ' already above local safe Z ' + localSafeZ.toFixed(3));
    return currentPos || await getWorkPosition();
  }

  logLine('face', label + ': raising to local safe Z ' + localSafeZ.toFixed(3) + ' (' + safeZSource + ')');
  await moveAbs(null, null, localSafeZ, s.travelRecoveryLiftFeedRate || s.travelFeedRate || 600);
  return await getWorkPosition();
}

async function clearFaceProbeAndReturnToStartThenRaise(axis, pos, startCoord, lineCoord, contextLabel, settings){
  var sLocal = settings || getSettingsFromUI();
  axis = String(axis || 'X').toUpperCase();
  pos = pos || await getWorkPosition();
  startCoord = Number(startCoord);
  lineCoord = Number(lineCoord);

  var finishZ = Number(sLocal.finishHomeZ);
  var currentZ = Number(pos && pos.z);
  var fallbackSafeZ = isFinite(currentZ) ? Math.max(currentZ, finishZ) : finishZ;
  if(!isFinite(fallbackSafeZ)) fallbackSafeZ = currentZ;

  logLine('face', contextLabel + ': safe trigger retract — diagonal retract to ' + axis + '=' + startCoord.toFixed(3) + ' Z=' + Number(fallbackSafeZ).toFixed(3) + ' before next sample.');

  // Diagonal move: retract face axis to start AND raise Z simultaneously.
  // GRBL handles simultaneous multi-axis moves natively — eliminates one waitForIdle cycle vs 2-step sequential moves.
  var moveFeed = sLocal.travelRecoveryLiftFeedRate || sLocal.travelRecoveryFeedRate || sLocal.travelFeedRate || 600;
  if(axis === 'X'){
    await moveAbs(startCoord, lineCoord, fallbackSafeZ, moveFeed);
  } else {
    await moveAbs(lineCoord, startCoord, fallbackSafeZ, moveFeed);
  }

  return await getWorkPosition();
}

async function finishRunMotion(logKind){
  s = getSettingsFromUI();
  var finishZ = Number(s.finishHomeZ);
  var useMachineHomeRetract = !!s.useMachineHomeRetract;
  var machineSafeTopZ = Number(s.machineSafeTopZ);
  var returnXYZero = s.returnToXYZero;
  if(!isFinite(finishZ)) throw new Error('Finish Lift Z is not valid');
  if(useMachineHomeRetract && !isFinite(machineSafeTopZ)) throw new Error('Machine Safe Top Z is not valid');

  var snap = await getMachineSnapshot();
  var currentZ = Number(snap && snap.z);
  var safeTravelZ = isFinite(currentZ) ? Math.max(currentZ, finishZ) : finishZ;

  if(useMachineHomeRetract){
    if(snap && snap.homed === true){
      logLine(logKind, 'Finish move: machine is homed; retracting with G53 to machine Z ' + machineSafeTopZ.toFixed(3) + ' before X/Y travel');
      try {
        await moveMachineZAbs(machineSafeTopZ, s.travelFeedRate || 600);
      } catch(retractErr) {
        logLine(logKind, 'Finish move: G53 retract error (' + retractErr.message + '); continuing with return');
      }
    } else {
      logLine(logKind, 'Finish move warning: machine-home retract enabled but homed state is not available; falling back to work Z ' + safeTravelZ.toFixed(3));
      if(isFinite(currentZ) && finishZ <= currentZ){
        logLine(logKind, 'Finish move: current work Z ' + currentZ.toFixed(3) + ' is already above fallback target ' + finishZ.toFixed(3) + '; keeping current Z for safe X/Y return');
      } else {
        logLine(logKind, 'Finish move: lifting work Z to fallback ' + safeTravelZ.toFixed(3));
        await moveAbs(null, null, safeTravelZ, s.travelFeedRate || 600);
      }
    }
  } else {
    if(isFinite(currentZ) && finishZ <= currentZ){
      logLine(logKind, 'Finish move: current work Z ' + currentZ.toFixed(3) + ' is already above target ' + finishZ.toFixed(3) + '; keeping current Z for safe X/Y return');
    } else {
      logLine(logKind, 'Finish move: lifting work Z to ' + safeTravelZ.toFixed(3));
      await moveAbs(null, null, safeTravelZ, s.travelFeedRate || 600);
    }
  }

  if(returnXYZero){
    logLine(logKind, 'Finish move: returning to work X0.000 Y0.000');
    await moveAbs(0, 0, null, s.travelFeedRate || 600);
    logLine(logKind, 'Finish move: at work X0.000 Y0.000 (Z held at safe retract height)');
  } else {
    logLine(logKind, 'Finish move: X/Y return disabled (check Return to XYZ Zero setting in Setup)');
  }
}

function _normalizeSettingsForStorage(cfg){
  var out = Object.assign({}, cfg || {});
  out.useMachineHomeRetract = out.useMachineHomeRetract ? 'yes' : 'no';
  out.returnToXYZero = out.returnToXYZero ? 'yes' : 'no';
  out.useInitialClearanceLift = out.useInitialClearanceLift ? 'yes' : 'no';
  out.enableLayeredFace = !!out.enableLayeredFace;
  return out;
}

function _normalizeSettingsForUI(cfg){
  var out = Object.assign({}, cfg || {});
  if(typeof out.useMachineHomeRetract === 'boolean') out.useMachineHomeRetract = out.useMachineHomeRetract ? 'yes' : 'no';
  if(typeof out.returnToXYZero === 'boolean') out.returnToXYZero = out.returnToXYZero ? 'yes' : 'no';
  if(typeof out.useInitialClearanceLift === 'boolean') out.useInitialClearanceLift = out.useInitialClearanceLift ? 'yes' : 'no';
  out.enableLayeredFace = !!out.enableLayeredFace;
  return out;
}

function validateSettings(){
  var warnings = [];
  var cfg = getSettingsFromUI();
  if(cfg.topSampleStart === cfg.topSampleEnd) warnings.push('Sample Start equals Sample End — scan range is zero.');
  if(cfg.topSampleCount < 2) warnings.push('Sample Count must be at least 2.');
  if(cfg.topFeed <= 0) warnings.push('Top Probe Feed must be greater than 0.');
  if(cfg.travelFeedRate <= 0) warnings.push('Travel Feed Rate must be greater than 0.');
  if(cfg.faceFeed <= 0) warnings.push('Face Probe Feed must be greater than 0.');
  if(cfg.topProbeDepth <= 0) warnings.push('Probe Depth must be greater than 0.');
  if(cfg.topRetract <= 0) warnings.push('Retract distance must be greater than 0.');
  if(cfg.faceProbeDistance <= 0) warnings.push('Face Probe Distance must be greater than 0.');
  if(warnings.length){
    var el = document.getElementById('setup-status');
    if(el){
      el.textContent = 'Validation warnings:\n' + warnings.join('\n');
      el.className = 'status-line warn';
    }
    setFooterStatus('Settings have validation warnings.', 'warn');
    return false;
  }
  return true;
}

function saveSettings(){
  validateSettings();
  try{
    localStorage.setItem('edgeProbeSettings', JSON.stringify(_normalizeSettingsForStorage(getSettingsFromUI())));
    var el = document.getElementById('setup-status');
    el.textContent = 'Settings saved.'; el.className = 'status-line good';
    setTimeout(function(){ el.textContent = ''; el.className = 'status-line'; }, 2500);
  }catch(e){ console.error(e); }
}

function loadSettings(){
  try{
    var raw = localStorage.getItem('edgeProbeSettings');
    if(!raw){
      var el = document.getElementById('setup-status');
      el.textContent = 'No saved settings found.'; el.className = 'status-line warn';
      return;
    }
    _applySettingsToUI(_normalizeSettingsForUI(JSON.parse(raw)));
    var el = document.getElementById('setup-status');
    el.textContent = 'Settings loaded.'; el.className = 'status-line good';
    setTimeout(function(){ el.textContent = ''; el.className = 'status-line'; }, 2500);
  }catch(e){ console.error(e); }
}

function resetSettings(){
  _applySettingsToUI({
    sampleAxis:'X', topFixedCoord:0, topSampleStart:0, topSampleEnd:100,
    topSampleCount:10, useInitialClearanceLift:'no', topClearZ:5, topFeed:200, topProbeDepth:5, topRetract:2,
    travelFeedRate:600, travelRecoveryFeedRate:1500, travelRecoveryLiftFeedRate:1000, useTravelContactRecovery:'yes', travelContactStep:5, travelContactBackoff:5, travelContactLift:5, travelContactMaxRetries:5, faceFixedCoord:0, faceStartOffset:-10, faceFeed:150, faceRetractFeed:1000,
    faceDepthBelowSurface:2, faceProbeDistance:20, enableLayeredFace:false, faceLayerCount:3, faceMaxDepth:14.75, faceTopSurfaceMode:'flat', finishHomeZ:10,
    useMachineHomeRetract:'yes', machineSafeTopZ:0, returnToXYZero:'yes',
    jogStepXY:1, jogStepZ:2, jogFeedXY:600, jogFeedZ:300,
    meshSubdivisionSpacing: 2,
    faceOBJSubdivision: 2
  });
}

function _applySettingsToUI(cfg){
  var ids = ['sampleAxis','topFixedCoord','topSampleStart','topSampleEnd','topSampleCount',
             'useInitialClearanceLift','topClearZ','topFeed','topProbeDepth','topRetract','travelFeedRate','travelRecoveryFeedRate','travelRecoveryLiftFeedRate',
             'useTravelContactRecovery','travelContactStep','travelContactBackoff','travelContactLift','travelContactMaxRetries',
             'faceFixedCoord','faceStartOffset','faceFeed','faceRetractFeed','faceDepthBelowSurface','faceProbeDistance',
             'faceLayerCount','faceMaxDepth',
             'finishHomeZ','useMachineHomeRetract','machineSafeTopZ','returnToXYZero',
             'jogStepXY','jogStepZ','jogFeedXY','jogFeedZ',
             'meshSubdivisionSpacing',
             'faceOBJSubdivision'];
  ids.forEach(function(id){
    var el = document.getElementById(id);
    if(el && cfg[id] != null) el.value = cfg[id];
  });
  var layeredEl = document.getElementById('enableLayeredFace');
  if(layeredEl && cfg.enableLayeredFace != null) layeredEl.checked = !!cfg.enableLayeredFace;
  var topSurfaceEl = document.getElementById('faceTopSurfaceMode');
  if(topSurfaceEl && cfg.faceTopSurfaceMode != null) topSurfaceEl.value = cfg.faceTopSurfaceMode;
  var jogStepEl = document.getElementById('jogStepXY');
  if(jogStepEl) setJogStepPreset(jogStepEl.value || '1');
  if(cfg.meshSubdivisionSpacing != null) meshSubdivisionSpacing = Number(cfg.meshSubdivisionSpacing);
  refreshFinishBehaviorPreview();
  refreshTravelRecoveryPreview();
}


function saveProbeResults(){
  try{
    localStorage.setItem(TOP_RESULTS_KEY, JSON.stringify(topResults));
    localStorage.setItem(FACE_RESULTS_KEY, JSON.stringify(faceResults));
    localStorage.setItem(FACE_LAYERED_RESULTS_KEY, JSON.stringify(layeredFaceResults));
  }catch(e){
    console.error('Failed to persist probe results', e);
  }
}

var _lastThrottledSaveTime = 0;
var THROTTLED_SAVE_INTERVAL_MS = 5000;
function saveProbeResultsThrottled(){
  var now = Date.now();
  if(now - _lastThrottledSaveTime >= THROTTLED_SAVE_INTERVAL_MS){
    saveProbeResults();
    _lastThrottledSaveTime = now;
  }
}

function loadProbeResults(){
  try{
    var rawTop = localStorage.getItem(TOP_RESULTS_KEY);
    var rawFace = localStorage.getItem(FACE_RESULTS_KEY);
    var rawLayered = localStorage.getItem(FACE_LAYERED_RESULTS_KEY);
    topResults = rawTop ? JSON.parse(rawTop) : [];
    faceResults = rawFace ? JSON.parse(rawFace) : [];
    layeredFaceResults = rawLayered ? JSON.parse(rawLayered) : [];
  }catch(e){
    console.error('Failed to load persisted probe results', e);
    topResults = [];
    faceResults = [];
    layeredFaceResults = [];
  }
}

function clearPersistedProbeResults(){
  try{
    localStorage.removeItem(TOP_RESULTS_KEY);
    localStorage.removeItem(FACE_RESULTS_KEY);
    localStorage.removeItem(FACE_LAYERED_RESULTS_KEY);
  }catch(e){
    console.error('Failed to clear persisted probe results', e);
  }
}

// ── Result record helpers ─────────────────────────────────────────────────────





function makeFaceContactRecord(index, pos, axis, status, targetCoord, sampleCoordOverride){
  axis = String(axis || 'X').toUpperCase();
  var sampleCoord = sampleCoordOverride != null ? Number(sampleCoordOverride) : (axis === 'X' ? Number(pos.x) : Number(pos.y));
  return {
    type: 'face',
    index: index,
    sampleCoord: Number(sampleCoord),
    targetSamplePos: targetCoord,
    x: Number(pos.x),
    y: Number(pos.y),
    z: Number(pos.z),
    machineZ: pos.machineZ != null ? Number(pos.machineZ) : null,
    status: status || ('FACE ' + axis)
  };
}


function updateEdgeProbeStorageUI(){
  var el = document.getElementById('edge-probe-results-summary');
  if (!el) return;
  var topCount = topResults ? topResults.length : 0;
  var faceCount = faceResults ? faceResults.length : 0;
  var layeredCount = layeredFaceResults ? layeredFaceResults.length : 0;
  var total = topCount + faceCount;
  if (total === 0 && layeredCount === 0) {
    el.innerHTML = '<div class="mini" style="color:var(--muted);padding:8px 4px">No probe results yet. Run a probe to see data here.</div>';
    pluginDebug('updateEdgeProbeStorageUI: no results to display');
    return;
  }
  var now = new Date();
  var timeStr = now.toLocaleTimeString();
  var html = '<div class="mini" style="margin-bottom:5px"><strong>Last Updated:</strong> ' + timeStr + '</div>';
  html += '<div class="mini" style="margin-bottom:6px">';
  html += '<span style="margin-right:12px">&#9632; <strong>Top results:</strong> ' + topCount + '</span>';
  html += '<span style="margin-right:12px">&#9632; <strong>Face results:</strong> ' + faceCount + '</span>';
  if (layeredCount) html += '<span>&#9632; <strong>Layered contacts:</strong> ' + layeredCount + '</span>';
  html += '</div>';
  var allRows = [];
  (topResults || []).forEach(function(r){ allRows.push({type:'Top', x:r.x, y:r.y, z:r.z, machineZ:r.machineZ, status:r.status}); });
  (faceResults || []).forEach(function(r){ allRows.push({type:'Face', x:r.x, y:r.y, z:r.z, machineZ:r.machineZ, status:r.status}); });
  if (allRows.length) {
    html += '<div style="max-height:180px;overflow-y:auto;border:1px solid var(--line);border-radius:6px">';
    html += '<table style="font-size:11px"><thead><tr><th>#</th><th>Type</th><th>X</th><th>Y</th><th>Z</th><th>Mach Z</th><th>Status</th></tr></thead><tbody>';
    var showMax = Math.min(allRows.length, 50);
    for (var i = 0; i < showMax; i++) {
      var r = allRows[i];
      html += '<tr><td>' + (i+1) + '</td><td>' + (r.type||'') + '</td>';
      html += '<td>' + (r.x != null ? Number(r.x).toFixed(3) : '') + '</td>';
      html += '<td>' + (r.y != null ? Number(r.y).toFixed(3) : '') + '</td>';
      html += '<td>' + (r.z != null ? Number(r.z).toFixed(3) : '') + '</td>';
      html += '<td>' + (r.machineZ != null ? Number(r.machineZ).toFixed(3) : '&mdash;') + '</td>';
      html += '<td>' + (r.status||'') + '</td></tr>';
    }
    if (allRows.length > showMax) {
      html += '<tr><td colspan="7" style="color:var(--muted);text-align:center;padding:4px">... and ' + (allRows.length - showMax) + ' more</td></tr>';
    }
    html += '</tbody></table></div>';
  }
  el.innerHTML = html;
  pluginDebug('updateEdgeProbeStorageUI: displayed ' + (topCount + faceCount) + ' records (top=' + topCount + ', face=' + faceCount + ', layered=' + layeredCount + ')');
}

function updateAllResultsUI(){
  saveProbeResults();
  updateEdgeProbeStorageUI();
}

function clearAllResults(){
  topResults = []; faceResults = []; layeredFaceResults = [];
  clearPersistedProbeResults();
  var ut = document.getElementById('res-unified-tbody');
  if(ut) ut.innerHTML = '<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:16px;">No probe data yet</td></tr>';
  var rsp = document.getElementById('res-surface-panel');
  if(rsp) rsp.style.display = 'none';
  var rfp = document.getElementById('res-face-panel');
  if(rfp) rfp.style.display = 'none';
  clearLog('top'); clearLog('face');
  updateEdgeProbeStorageUI();
  pluginDebug('clearAllResults: probe results cleared, UI reset');
}

// ── CSV export ────────────────────────────────────────────────────────────────
function exportCSV(){
  var rows = [];
  if(smMeshData && smGridConfig){
    var cfg = smGridConfig, grid = smMeshData;
    for(var ri = 0; ri < cfg.rowCount; ri++){
      for(var ci = 0; ci < cfg.colCount; ci++){
        var x = cfg.minX + ci * cfg.colSpacing;
        var y = cfg.minY + ri * cfg.rowSpacing;
        var zval = grid[ri][ci];
        rows.push({x: x, y: y, z: zval, type: 'Surface'});
      }
    }
  }
  var faceData = getFaceMeshData();
  if(faceData && faceData.length){
    faceData.forEach(function(p){
      var layer = p.layer != null ? p.layer : 1;
      rows.push({x: p.x, y: p.y, z: p.z, type: 'Face L' + layer});
    });
  }
  if(!rows.length){ alert('No probe data to export.'); return; }
  var csv = '# Plugin Version: ' + SM_VERSION + '\n';
  csv += 'Index,X,Y,Z,Type\n';
  rows.forEach(function(r, i){
    csv += (i + 1) + ',' + Number(r.x).toFixed(3) + ',' + Number(r.y).toFixed(3) + ',' +
           (r.z != null ? Number(r.z).toFixed(3) : '') + ',' + (r.type || '') + '\n';
  });
  var blob = new Blob([csv], {type:'text/csv'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'probe_results_' + Date.now() + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


// ── Face mesh export helpers ──────────────────────────────────────────────────

/**
 * _buildNaturalCubicSpline(zs, ys)
 * Builds a natural cubic spline through the given (zs[i], ys[i]) data points.
 * Returns an evaluator function eval(z) that returns the interpolated y value.
 * Uses natural boundary conditions (second derivative = 0 at both ends).
 */
function _buildNaturalCubicSpline(zs, ys) {
  var n = zs.length;
  if (n < 2) return function() { return ys[0] || 0; };
  if (n === 2) {
    return function(z) {
      var t = (zs[1] === zs[0]) ? 0 : (z - zs[0]) / (zs[1] - zs[0]);
      t = Math.max(0, Math.min(1, t));
      return ys[0] + t * (ys[1] - ys[0]);
    };
  }
  // Compute interval widths and divided differences
  var h = [], d = [];
  for (var i = 0; i < n - 1; i++) {
    h[i] = zs[i + 1] - zs[i];
    d[i] = (ys[i + 1] - ys[i]) / h[i];
  }
  // Solve tridiagonal system for second derivatives M[i] (natural: M[0]=M[n-1]=0)
  var M = new Array(n);
  for (var i = 0; i < n; i++) M[i] = 0;
  var u = new Array(n), v = new Array(n);
  u[1] = 2 * (h[0] + h[1]);
  v[1] = 6 * (d[1] - d[0]);
  for (var i = 2; i < n - 1; i++) {
    u[i] = 2 * (h[i - 1] + h[i]) - (h[i - 1] * h[i - 1]) / u[i - 1];
    v[i] = 6 * (d[i] - d[i - 1]) - h[i - 1] * v[i - 1] / u[i - 1];
  }
  M[n - 2] = v[n - 2] / u[n - 2];
  for (var i = n - 3; i >= 1; i--) {
    M[i] = (v[i] - h[i] * M[i + 1]) / u[i];
  }
  return function(z) {
    if (z <= zs[0]) return ys[0];
    if (z >= zs[n - 1]) return ys[n - 1];
    // Binary search for bracketing interval
    var lo = 0, hi = n - 2;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (zs[mid + 1] < z) lo = mid + 1; else hi = mid; }
    var i = lo;
    var dz = h[i];
    var a = (zs[i + 1] - z) / dz;
    var b = (z - zs[i]) / dz;
    return a * ys[i] + b * ys[i + 1] +
      ((a * a * a - a) * M[i] + (b * b * b - b) * M[i + 1]) * dz * dz / 6;
  };
}

/**
 * _buildNotAKnotCubicSpline(xs, ys)
 * Builds a cubic spline through the given (xs[i], ys[i]) data points using
 * not-a-knot boundary conditions: the third derivative is forced to be
 * continuous at the first and last interior knots. This eliminates the
 * artificial flattening at the edges that natural splines produce with sparse
 * data (e.g. 5 X probe columns), giving smooth blending rather than humps.
 * Falls back to natural cubic for n < 4.
 */
function _buildNotAKnotCubicSpline(xs, ys) {
  var n = xs.length;
  if (n < 2) return function() { return ys[0] || 0; };
  if (n === 2) {
    return function(z) {
      var t = (xs[1] === xs[0]) ? 0 : (z - xs[0]) / (xs[1] - xs[0]);
      t = Math.max(0, Math.min(1, t));
      return ys[0] + t * (ys[1] - ys[0]);
    };
  }
  if (n < 4) return _buildNaturalCubicSpline(xs, ys);

  var h = [], d = [];
  for (var i = 0; i < n - 1; i++) {
    h[i] = xs[i + 1] - xs[i];
    d[i] = (ys[i + 1] - ys[i]) / h[i];
  }

  // Build augmented n×n matrix for Gaussian elimination.
  // Row 0    (not-a-knot at x[1]):   h[1]*M[0] - (h[0]+h[1])*M[1] + h[0]*M[2] = 0
  // Rows 1..n-2 (interior):          h[i-1]*M[i-1] + 2*(h[i-1]+h[i])*M[i] + h[i]*M[i+1] = 6*(d[i]-d[i-1])
  // Row n-1  (not-a-knot at x[n-2]): h[n-2]*M[n-3] - (h[n-3]+h[n-2])*M[n-2] + h[n-3]*M[n-1] = 0
  var A = [];
  for (var i = 0; i < n; i++) {
    A.push(new Array(n + 1).fill(0));
  }
  A[0][0] = h[1];
  A[0][1] = -(h[0] + h[1]);
  A[0][2] = h[0];
  for (var i = 1; i <= n - 2; i++) {
    A[i][i - 1] = h[i - 1];
    A[i][i]     = 2 * (h[i - 1] + h[i]);
    A[i][i + 1] = h[i];
    A[i][n]     = 6 * (d[i] - d[i - 1]);
  }
  A[n - 1][n - 3] = h[n - 2];
  A[n - 1][n - 2] = -(h[n - 3] + h[n - 2]);
  A[n - 1][n - 1] = h[n - 3];

  // Gaussian elimination with partial pivoting
  for (var col = 0; col < n; col++) {
    var pivotRow = col;
    for (var row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[pivotRow][col])) pivotRow = row;
    }
    var tmp = A[col]; A[col] = A[pivotRow]; A[pivotRow] = tmp;
    if (Math.abs(A[col][col]) < 1e-14) continue;
    for (var row = col + 1; row < n; row++) {
      var factor = A[row][col] / A[col][col];
      for (var j = col; j <= n; j++) A[row][j] -= factor * A[col][j];
    }
  }
  // Back substitution
  var M = new Array(n).fill(0);
  for (var i = n - 1; i >= 0; i--) {
    if (Math.abs(A[i][i]) < 1e-14) { M[i] = 0; continue; }
    var sum = A[i][n];
    for (var j = i + 1; j < n; j++) sum -= A[i][j] * M[j];
    M[i] = sum / A[i][i];
  }

  return function(z) {
    if (z <= xs[0]) return ys[0];
    if (z >= xs[n - 1]) return ys[n - 1];
    var lo = 0, hi = n - 2;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (xs[mid + 1] < z) lo = mid + 1; else hi = mid; }
    var i = lo;
    var dz = h[i];
    var a = (xs[i + 1] - z) / dz;
    var b = (z - xs[i]) / dz;
    return a * ys[i] + b * ys[i + 1] +
      ((a * a * a - a) * M[i] + (b * b * b - b) * M[i + 1]) * dz * dz / 6;
  };
}

/**
 * _buildCatmullRomSpline(xs, ys)
 * Builds a centripetal Catmull-Rom spline through the given (xs[i], ys[i]) data points.
 * Returns an evaluator function eval(x) that returns the interpolated y value.
 *
 * Unlike global cubic splines, Catmull-Rom splines are LOCAL — each segment only
 * depends on 4 neighbouring control points, so no curvature ripple propagates from
 * distant knots.  The centripetal parameterisation (alpha = 0.5) additionally
 * prevents overshoot and cusps, giving a smooth blend between sparse probe columns.
 */
function _buildCatmullRomSpline(xs, ys) {
  var n = xs.length;
  if (n < 2) return function() { return ys[0] || 0; };
  if (n === 2) {
    return function(x) {
      var t = (xs[1] === xs[0]) ? 0 : (x - xs[0]) / (xs[1] - xs[0]);
      t = Math.max(0, Math.min(1, t));
      return ys[0] + t * (ys[1] - ys[0]);
    };
  }

  var alpha = 0.5; // centripetal parameterisation

  return function(x) {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];

    // Find segment index i such that xs[i] <= x < xs[i+1]
    var i = 0;
    for (var k = 0; k < n - 1; k++) {
      if (x >= xs[k] && x < xs[k + 1]) { i = k; break; }
    }

    // Four control points, reflected at boundaries so every segment has a full stencil
    var x0 = xs[Math.max(0, i - 1)], y0 = ys[Math.max(0, i - 1)];
    var x1 = xs[i],                   y1 = ys[i];
    var x2 = xs[Math.min(n - 1, i + 1)], y2 = ys[Math.min(n - 1, i + 1)];
    var x3 = xs[Math.min(n - 1, i + 2)], y3 = ys[Math.min(n - 1, i + 2)];

    if (i === 0)      { x0 = 2 * x1 - x2; y0 = 2 * y1 - y2; }
    if (i >= n - 2)   { x3 = 2 * x2 - x1; y3 = 2 * y2 - y1; }

    function dist(xa, ya, xb, yb) {
      var dx = xb - xa, dy = yb - ya;
      return Math.sqrt(dx * dx + dy * dy);
    }
    var d01 = Math.pow(dist(x0, y0, x1, y1), alpha) || 1e-6;
    var d12 = Math.pow(dist(x1, y1, x2, y2), alpha) || 1e-6;
    var d23 = Math.pow(dist(x2, y2, x3, y3), alpha) || 1e-6;

    // Barry-Goldman tangent formulation (centripetal CR)
    var seg = x2 - x1;
    var t  = (seg === 0) ? 0 : (x - x1) / seg; // parameter in [0, 1] across segment
    var m1 = (y2 - y1) + d12 * ((y1 - y0) / d01 - (y2 - y0) / (d01 + d12));
    var m2 = (y2 - y1) + d12 * ((y3 - y2) / d23 - (y3 - y1) / (d12 + d23));

    // Cubic Hermite basis
    var t2 = t * t, t3 = t2 * t;
    return (2*t3 - 3*t2 + 1) * y1 + (t3 - 2*t2 + t) * m1 +
           (-2*t3 + 3*t2)    * y2 + (t3 - t2)        * m2;
  };
}

/**
 * _buildSubdividedFaceGrid(results, resolution)
 * Generates a dense mesh from the raw face probe points using hybrid interpolation:
 *   - Natural cubic spline along the Z (layer) axis for smooth curved transitions
 *   - Centripetal Catmull-Rom spline along the X axis for smooth column transitions
 *     (local stencil avoids the curvature ripple that global splines produce at
 *     each of the 5 sparse X probe columns)
 * Builds a pts[xi][li] 2D grid (X columns × layer rows), then generates
 * numCols × numRows output vertices at the requested mm resolution.
 * Returns { rows, numCols, numRows, origVerts } or null when data is degenerate.
 */
function _buildSubdividedFaceGrid(results, resolution) {
  // Collect unique X positions and layer numbers
  var xKeyToVal = {}, layerSet = {};
  results.forEach(function(p) {
    var xv = Number(p.x), lv = p.layer != null ? p.layer : 1;
    if (!isFinite(xv) || !isFinite(Number(p.y)) || !isFinite(Number(p.z))) return;
    var key = xv.toFixed(3);
    if (!(key in xKeyToVal)) xKeyToVal[key] = xv;
    layerSet[lv] = true;
  });
  var xs = Object.keys(xKeyToVal).map(function(k) { return xKeyToVal[k]; })
    .sort(function(a, b) { return a - b; });
  var layers = Object.keys(layerSet).map(Number).sort(function(a, b) { return a - b; });
  if (xs.length < 2 || layers.length < 2) return null;

  // Build index maps
  var xiMap = {};
  xs.forEach(function(v, i) { xiMap[v.toFixed(3)] = i; });
  var liMap = {};
  layers.forEach(function(l, i) { liMap[l] = i; });

  // Build pts[xi][li] grid
  var pts = [];
  for (var xi = 0; xi < xs.length; xi++) {
    pts.push([]);
    for (var li = 0; li < layers.length; li++) pts[xi].push(null);
  }
  results.forEach(function(p) {
    var xi = xiMap[Number(p.x).toFixed(3)];
    var li = liMap[p.layer != null ? p.layer : 1];
    if (xi != null && li != null && !pts[xi][li]) pts[xi][li] = p;
  });

  // Compute X and Z ranges for resolution-based grid sizing
  var xRange = xs[xs.length - 1] - xs[0];
  var zVals = results.map(function(p) { return Number(p.z); }).filter(isFinite);
  var zMin = Math.min.apply(null, zVals);
  var zMax = Math.max.apply(null, zVals);
  var zRange = Math.abs(zMax - zMin);

  var numCols = Math.max(2, Math.round(xRange / resolution) + 1);
  var numRows = Math.max(2, Math.round(zRange / resolution) + 1);

  function lerp(a, b, t) { return a + (b - a) * t; }

  // Build per-X-column cubic splines for Y(z) — smooth layer transitions at each column
  var ySplines = [];
  for (var xi = 0; xi < xs.length; xi++) {
    var colZs = [], colYs = [];
    for (var li = 0; li < layers.length; li++) {
      var p = pts[xi][li];
      if (p) { colZs.push(Number(p.z)); colYs.push(Number(p.y)); }
    }
    // Sort by z ascending so spline is well-formed
    var pairs = colZs.map(function(z, i) { return { z: z, y: colYs[i] }; });
    pairs.sort(function(a, b) { return a.z - b.z; });
    var sortedZs = pairs.map(function(p) { return p.z; });
    var sortedYs = pairs.map(function(p) { return p.y; });
    ySplines[xi] = (sortedZs.length >= 2) ? _buildNaturalCubicSpline(sortedZs, sortedYs) : null;
  }

  // Generate subdivided grid as row-major array: rows[ri][ci] = {x, y, z, layer}
  var rows = [];
  for (var ri = 0; ri < numRows; ri++) {
    var rowPts = [];
    var zOut = lerp(zMin, zMax, ri / (numRows - 1));

    // Assign to nearest original layer (for layer metadata only)
    var nearLayer = layers[0];
    var minDist = Infinity;
    for (var li = 0; li < layers.length; li++) {
      var lp = pts[0][li];
      if (lp) { var dz = Math.abs(Number(lp.z) - zOut); if (dz < minDist) { minDist = dz; nearLayer = layers[li]; } }
    }

    // Evaluate Z-axis cubic spline at each original X column to get Y values for this row
    var rowYatCols = [];
    var allColsValid = true;
    for (var xi = 0; xi < xs.length; xi++) {
      if (!ySplines[xi]) { allColsValid = false; break; }
      rowYatCols.push(ySplines[xi](zOut));
    }

    if (!allColsValid) {
      // Fallback: push nulls for this row
      for (var ci = 0; ci < numCols; ci++) rowPts.push(null);
      rows.push(rowPts);
      continue;
    }

    // Centripetal Catmull-Rom spline along X: local stencil avoids curvature
    // ripple at each of the 5 sparse probe columns that global cubic splines produce.
    var xSplineY = _buildCatmullRomSpline(xs, rowYatCols);

    // X spline is built per-row because rowYatCols changes for every zOut value
    var safeDenom = Math.max(1, numCols - 1);
    for (var ci = 0; ci < numCols; ci++) {
      var xOut = lerp(xs[0], xs[xs.length - 1], ci / safeDenom);
      rowPts.push({
        x: xOut,
        y: xSplineY(xOut),
        z: zOut,
        layer: nearLayer
      });
    }
    rows.push(rowPts);
  }

  return { rows: rows, numCols: numCols, numRows: numRows, origVerts: results.length };
}

function _getFaceMeshData(){
  // Use layered results if available; otherwise fall back to faceResults as layer 1
  if(layeredFaceResults && layeredFaceResults.length){
    return layeredFaceResults;
  }
  var fallback = [];
  faceResults.forEach(function(r){
    if(r.type === 'face'){
      fallback.push({ x: Number(r.x), y: Number(r.y), z: Number(r.z), layer: 1, sampleTopZ: Number(r.z) });
    }
  });
  return fallback;
}

function _applyTopSurfaceMode(results, mode){
  // Determine total number of layers
  var maxLayer = 0;
  results.forEach(function(p){ if(p.layer > maxLayer) maxLayer = p.layer; });
  if(maxLayer < 2 || mode !== 'flat') return results;

  // Find the shallowest (closest to zero / highest) top Z among top-layer points
  var topLayerPts = results.filter(function(p){ return p.layer === maxLayer; });
  if(!topLayerPts.length) return results;
  var shallowestTopZ = topLayerPts[0].z;
  for(var i = 1; i < topLayerPts.length; i++){
    if(topLayerPts[i].z > shallowestTopZ) shallowestTopZ = topLayerPts[i].z;
  }

  // Return a copy with top-layer Z replaced by shallowestTopZ
  return results.map(function(p){
    if(p.layer === maxLayer){
      return { x: p.x, y: p.y, z: shallowestTopZ, layer: p.layer, sampleTopZ: p.sampleTopZ };
    }
    return p;
  });
}

function exportFaceCSV(){
  var rawResults = _getFaceMeshData();
  if(!rawResults.length){ setFooterStatus('No face data to export.', 'warn'); return; }
  var modeEl = document.getElementById('faceTopSurfaceMode');
  var mode = modeEl ? modeEl.value : 'flat';
  var results = _applyTopSurfaceMode(rawResults, mode);

  var resEl = document.getElementById('faceOBJSubdivision');
  var resolution = resEl ? parseFloat(resEl.value) : 2;
  if(isNaN(resolution) || resolution <= 0) resolution = 2;

  var subGrid = _buildSubdividedFaceGrid(results, resolution);

  var csv = '# Plugin Version: ' + SM_VERSION + '\n';
  if(subGrid){
    csv += '# Subdivided: ' + subGrid.origVerts + ' -> ' + (subGrid.numRows * subGrid.numCols) + ' vertices at ' + resolution + 'mm resolution\n';
    csv += 'X,Y,Z,Layer\n';
    subGrid.rows.forEach(function(row){
      row.forEach(function(p){
        if(!p) return;
        csv += p.x.toFixed(3) + ',' + p.y.toFixed(3) + ',' + p.z.toFixed(3) + ',' + p.layer + '\n';
      });
    });
  } else {
    csv += 'X,Y,Z,Layer\n';
    results.forEach(function(p){
      csv += p.x.toFixed(3) + ',' + p.y.toFixed(3) + ',' + p.z.toFixed(3) + ',' + p.layer + '\n';
    });
  }
  var blob = new Blob([csv], {type:'text/csv'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'face_mesh_' + tsForFilename() + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  setFooterStatus('CSV exported.', 'good');
}

function exportFaceDXF(){
  var rawResults = _getFaceMeshData();
  if(!rawResults.length){ setFooterStatus('No face data to export.', 'warn'); return; }
  var modeEl = document.getElementById('faceTopSurfaceMode');
  var mode = modeEl ? modeEl.value : 'flat';
  var results = _applyTopSurfaceMode(rawResults, mode);

  var resEl = document.getElementById('faceOBJSubdivision');
  var resolution = resEl ? parseFloat(resEl.value) : 2;
  if(isNaN(resolution) || resolution <= 0) resolution = 2;

  var subGrid = _buildSubdividedFaceGrid(results, resolution);

  // Proper DXF structure with HEADER section required by Aspire
  var dxf = '0\nSECTION\n2\nHEADER\n';
  dxf += '9\n$ACADVER\n1\nAC1009\n';
  dxf += '9\n$INSUNITS\n70\n4\n';
  dxf += '0\nENDSEC\n';
  dxf += '0\nSECTION\n2\nTABLES\n';
  dxf += '0\nENDSEC\n';
  dxf += '0\nSECTION\n2\nENTITIES\n';

  if(subGrid){
    subGrid.rows.forEach(function(row, ri){
      var validPts = row.filter(function(p){ return p != null; });
      if(!validPts.length) return;
      dxf += '0\nPOLYLINE\n8\nRow_' + (ri + 1) + '\n66\n1\n70\n8\n';
      validPts.forEach(function(p){
        dxf += '0\nVERTEX\n8\nRow_' + (ri + 1) + '\n';
        dxf += '10\n' + p.x.toFixed(3) + '\n';
        dxf += '20\n' + p.y.toFixed(3) + '\n';
        dxf += '30\n' + p.z.toFixed(3) + '\n';
      });
      dxf += '0\nSEQEND\n';
    });
  } else {
    var layerGroups = {};
    results.forEach(function(p){
      if(!layerGroups[p.layer]) layerGroups[p.layer] = [];
      layerGroups[p.layer].push(p);
    });
    Object.keys(layerGroups).forEach(function(layerNum){
      var pts = layerGroups[layerNum].slice();
      pts.sort(function(a, b){ return a.x - b.x; });
      dxf += '0\nPOLYLINE\n8\nLayer_' + layerNum + '\n66\n1\n70\n8\n';
      pts.forEach(function(p){
        dxf += '0\nVERTEX\n8\nLayer_' + layerNum + '\n';
        dxf += '10\n' + p.x.toFixed(3) + '\n';
        dxf += '20\n' + p.y.toFixed(3) + '\n';
        dxf += '30\n' + p.z.toFixed(3) + '\n';
      });
      dxf += '0\nSEQEND\n';
    });
  }
  dxf += '0\nENDSEC\n0\nEOF\n';

  var blob = new Blob([dxf], {type:'application/dxf'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'face_mesh_' + tsForFilename() + '.dxf';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  setFooterStatus('DXF exported.', 'good');
}

function exportFaceOBJ(){
  var rawResults = _getFaceMeshData();
  if(!rawResults.length){ setFooterStatus('No face data to export.', 'warn'); return; }
  var modeEl = document.getElementById('faceTopSurfaceMode');
  var mode = modeEl ? modeEl.value : 'flat';
  var results = _applyTopSurfaceMode(rawResults, mode);

  var resEl = document.getElementById('faceOBJSubdivision');
  var resolution = resEl ? parseFloat(resEl.value) : 2;
  if(isNaN(resolution) || resolution <= 0) resolution = 2;

  var subGrid = _buildSubdividedFaceGrid(results, resolution);

  var obj = '# 3D Live Edge Mesh - Face Profile\n';
  obj += '# Plugin Version: ' + SM_VERSION + '\n';
  obj += '# Generated ' + new Date().toISOString() + '\n';

  var totalVerts = 0, triCount = 0;

  if(subGrid){
    obj += '# Subdivided: ' + subGrid.origVerts + ' -> ' + (subGrid.numRows * subGrid.numCols) + ' vertices at ' + resolution + 'mm resolution\n';
    obj += 'o FaceMesh\n';
    obj += 'g FaceMesh\n';

    // Emit vertices row by row; track per-cell indices for triangulation
    var indexGrid = [];
    var vIdx = 1;
    for(var ri = 0; ri < subGrid.numRows; ri++){
      indexGrid.push([]);
      for(var ci = 0; ci < subGrid.numCols; ci++){
        var p = subGrid.rows[ri][ci];
        if(p){
          obj += 'v ' + p.x.toFixed(3) + ' ' + p.y.toFixed(3) + ' ' + p.z.toFixed(3) + '\n';
          indexGrid[ri].push(vIdx++);
          totalVerts++;
        } else {
          indexGrid[ri].push(0);
        }
      }
    }

    // Triangulate subdivided grid
    for(var ri = 0; ri < subGrid.numRows - 1; ri++){
      for(var ci = 0; ci < subGrid.numCols - 1; ci++){
        var va = indexGrid[ri][ci], vb = indexGrid[ri][ci + 1];
        var vc = indexGrid[ri + 1][ci + 1], vd = indexGrid[ri + 1][ci];
        if(va && vb && vc){ obj += 'f ' + va + ' ' + vb + ' ' + vc + '\n'; triCount++; }
        if(va && vc && vd){ obj += 'f ' + va + ' ' + vc + ' ' + vd + '\n'; triCount++; }
      }
    }
  } else {
    // Fallback: raw export when grid is degenerate (<2 layers or <2 X columns)
    obj += 'o FaceMesh\n';
    obj += 'g FaceMesh\n';

    var layerGroups = {};
    results.forEach(function(p){
      if(!layerGroups[p.layer]) layerGroups[p.layer] = [];
      layerGroups[p.layer].push(p);
    });
    var layerKeys = Object.keys(layerGroups).sort(function(a, b){ return Number(a) - Number(b); });
    layerKeys.forEach(function(k){
      layerGroups[k].sort(function(a, b){ return a.x - b.x; });
    });

    layerKeys.forEach(function(k){
      layerGroups[k].forEach(function(p){
        obj += 'v ' + p.x.toFixed(3) + ' ' + p.y.toFixed(3) + ' ' + p.z.toFixed(3) + '\n';
        totalVerts++;
      });
    });

    var samplesPerLayer = (layerKeys.length > 0 && layerGroups[layerKeys[0]]) ? layerGroups[layerKeys[0]].length : 0;
    var canTriangulate = samplesPerLayer > 0 && layerKeys.every(function(k){ return layerGroups[k].length === samplesPerLayer; });
    var totalVertsRaw = layerKeys.length * samplesPerLayer;
    var validTri = function(v1, v2, v3){ return v1 !== v2 && v2 !== v3 && v1 !== v3 && v1 >= 1 && v2 >= 1 && v3 >= 1 && v1 <= totalVertsRaw && v2 <= totalVertsRaw && v3 <= totalVertsRaw; };
    if(canTriangulate){
      for(var i = 0; i < layerKeys.length - 1; i++){
        var baseIdx = i * samplesPerLayer + 1;
        var nextIdx = (i + 1) * samplesPerLayer + 1;
        for(var j = 0; j < samplesPerLayer - 1; j++){
          var va = baseIdx + j;
          var vb = baseIdx + j + 1;
          var vc = nextIdx + j + 1;
          var vd = nextIdx + j;
          if(validTri(va, vb, vc)){ obj += 'f ' + va + ' ' + vb + ' ' + vc + '\n'; triCount++; }
          if(validTri(va, vc, vd)){ obj += 'f ' + va + ' ' + vc + ' ' + vd + '\n'; triCount++; }
        }
      }
    }
  }

  var blob = new Blob([obj], {type:'model/obj'});
  var url = URL.createObjectURL(blob);
  var anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'face_mesh_' + tsForFilename() + '.obj';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  setFooterStatus('OBJ exported: ' + totalVerts + ' vertices, ' + triCount + ' triangles.', 'good');
}

// ── Workflow manager ──────────────────────────────────────────────────────────
function _getWorkflows(){ return JSON.parse(localStorage.getItem('edgeProbeWorkflows') || '{}'); }
function _setWorkflows(wf){ localStorage.setItem('edgeProbeWorkflows', JSON.stringify(wf)); }

function saveWorkflow(){
  var name = (document.getElementById('workflow-name').value || '').trim();
  if(!name){ alert('Enter a workflow name.'); return; }
  var wf = _getWorkflows(); wf[name] = getSettingsFromUI(); _setWorkflows(wf);
  renderWorkflowList();
}

function loadWorkflow(){
  var name = (document.getElementById('workflow-name').value || '').trim();
  if(!name){ alert('Enter the workflow name to load.'); return; }
  var wf = _getWorkflows();
  if(!wf[name]){ alert('Workflow "' + name + '" not found.'); return; }
  _applySettingsToUI(wf[name]);
  switchTab('setup');
}

function _loadWorkflowByName(name){
  document.getElementById('workflow-name').value = name;
  loadWorkflow();
}

function deleteWorkflow(name){
  if(!confirm('Delete workflow "' + name + '"?')) return;
  var wf = _getWorkflows(); delete wf[name]; _setWorkflows(wf);
  renderWorkflowList();
}

function exportWorkflows(){
  var blob = new Blob([JSON.stringify(_getWorkflows(), null, 2)], {type:'application/json'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'edge_probe_workflows.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importWorkflows(){
  var inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json';
  inp.onchange = function(ev){
    var file = ev.target.files[0]; if(!file) return;
    var reader = new FileReader();
    reader.onload = function(e){
      try{
        var data = JSON.parse(e.target.result);
        _setWorkflows(data); renderWorkflowList();
      }catch(err){ alert('Invalid JSON file.'); }
    };
    reader.readAsText(file);
  };
  document.body.appendChild(inp); inp.click(); document.body.removeChild(inp);
}

function renderWorkflowList(){
  var el = document.getElementById('workflow-list'); if(!el) return;
  var wf = _getWorkflows(); var names = Object.keys(wf);
  if(!names.length){ el.innerHTML = '<div class="mini">No saved workflows.</div>'; return; }
  el.innerHTML = '<div class="mini" style="margin-bottom:8px">Saved workflows (' + names.length + '):</div>' +
    names.map(function(n){
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
        '<span class="mini" style="flex:1">' + escHtml(n) + '</span>' +
        '<button class="btn ghost wf-load" style="padding:4px 10px;font-size:11px" ' +
          'data-wf-name="' + escHtml(n) + '" aria-label="Load workflow ' + escHtml(n) + '">Load</button>' +
        '<button class="btn warn wf-delete" style="padding:4px 10px;font-size:11px" ' +
          'data-wf-name="' + escHtml(n) + '" aria-label="Delete workflow ' + escHtml(n) + '">Delete</button>' +
        '</div>';
    }).join('');
}

// ── THE 5 MODIFIED PROBE FUNCTIONS ────────────────────────────────────────────

// Face probing helpers
