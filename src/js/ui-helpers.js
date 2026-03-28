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


async function raiseFaceTravelSafeZ(label){
  s = getSettingsFromUI();
  var retractClearance = Number(s.topRetract) || 2;

  // Calculate local safe Z from top profile data
  var topPts = topResults.filter(function(r){ return r.status === 'TOP'; });
  var highestTopZ = -Infinity;
  topPts.forEach(function(tp){
    var z = Number(tp.z);
    if(z > highestTopZ) highestTopZ = z;
  });

  var snap = await getMachineSnapshot();
  var currentZ = Number(snap && snap.z);

  // If we have top profile data, use highest top Z + clearance
  // Otherwise use current Z + clearance as fallback
  var localSafeZ;
  if(isFinite(highestTopZ)){
    localSafeZ = highestTopZ + retractClearance;
  } else {
    localSafeZ = (isFinite(currentZ) ? currentZ : 0) + retractClearance;
  }

  var safeZSource = isFinite(highestTopZ) ? 'highest top Z' : 'current Z (no top profile)';

  // Only raise if we're below the safe Z
  if(isFinite(currentZ) && currentZ >= localSafeZ){
    logLine('face', label + ': current Z ' + currentZ.toFixed(3) + ' already above local safe Z ' + localSafeZ.toFixed(3));
    return await getWorkPosition();
  }

  logLine('face', label + ': raising to local safe Z ' + localSafeZ.toFixed(3) + ' (' + safeZSource + ' + ' + retractClearance.toFixed(1) + ' coords clearance)');
  await moveAbs(null, null, localSafeZ, s.travelRecoveryLiftFeedRate || s.travelFeedRate || 600);
  return await getWorkPosition();
}

async function clearFaceProbeAndReturnToStartThenRaise(axis, pos, startCoord, lineCoord, contextLabel){
  s = getSettingsFromUI();
  axis = String(axis || 'X').toUpperCase();
  pos = pos || await getWorkPosition();
  startCoord = Number(startCoord);
  lineCoord = Number(lineCoord);

  var finishZ = Number(s.finishHomeZ);
  var useMachineHomeRetract = !!s.useMachineHomeRetract;
  var machineSafeTopZ = Number(s.machineSafeTopZ);
  var snap = await getMachineSnapshot();
  var currentZ = Number(pos && pos.z);
  var fallbackSafeZ = isFinite(currentZ) ? Math.max(currentZ, finishZ) : finishZ;
  if(!isFinite(fallbackSafeZ)) fallbackSafeZ = currentZ;

  if(useMachineHomeRetract && snap && snap.homed === true && isFinite(machineSafeTopZ)){
    logLine('face', contextLabel + ': safe trigger retract — retracting ' + axis + ' to start ' + startCoord.toFixed(3) + ', then raising to machine-safe work Z ' + Number(fallbackSafeZ).toFixed(3) + ' before next sample.');
  } else {
    logLine('face', contextLabel + ': safe trigger retract — retracting ' + axis + ' to start ' + startCoord.toFixed(3) + ', then raising Z to ' + Number(fallbackSafeZ).toFixed(3) + ' before next sample.');
  }

  // Step 1: Retract along the face axis back to start position at current Z.
  // This clears the probe tip from the face before any Z raise, preventing the
  // probe from dragging against the workpiece during the lift.
  var moveFeed = s.travelRecoveryLiftFeedRate || s.travelRecoveryFeedRate || s.travelFeedRate || 600;
  if(axis === 'X'){
    await moveAbs(startCoord, lineCoord, null, moveFeed);
  } else {
    await moveAbs(lineCoord, startCoord, null, moveFeed);
  }

  // Step 2: Now raise Z to the safe travel height.
  await moveAbs(null, null, fallbackSafeZ, moveFeed);

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
    travelFeedRate:600, travelRecoveryFeedRate:1500, travelRecoveryLiftFeedRate:1000, useTravelContactRecovery:'yes', travelContactStep:5, travelContactBackoff:5, travelContactLift:5, travelContactMaxRetries:5, faceFixedCoord:0, faceStartOffset:-10, faceFeed:150,
    faceDepthBelowSurface:2, faceProbeDistance:20, enableLayeredFace:false, faceLayerCount:3, faceMaxDepth:14.75, faceTopSurfaceMode:'flat', finishHomeZ:10,
    useMachineHomeRetract:'yes', machineSafeTopZ:0, returnToXYZero:'yes',
    jogStepXY:1, jogStepZ:2, jogFeedXY:600, jogFeedZ:300
  });
}

function _applySettingsToUI(cfg){
  var ids = ['sampleAxis','topFixedCoord','topSampleStart','topSampleEnd','topSampleCount',
             'useInitialClearanceLift','topClearZ','topFeed','topProbeDepth','topRetract','travelFeedRate','travelRecoveryFeedRate','travelRecoveryLiftFeedRate',
             'useTravelContactRecovery','travelContactStep','travelContactBackoff','travelContactLift','travelContactMaxRetries',
             'faceFixedCoord','faceStartOffset','faceFeed','faceDepthBelowSurface','faceProbeDistance',
             'faceLayerCount','faceMaxDepth',
             'finishHomeZ','useMachineHomeRetract','machineSafeTopZ','returnToXYZero',
             'jogStepXY','jogStepZ','jogFeedXY','jogFeedZ'];
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
  var csv = '# Plugin Version: ' + SM_VERSION + '\n';
  csv += 'X,Y,Z,Layer\n';
  results.forEach(function(p){
    csv += p.x.toFixed(3) + ',' + p.y.toFixed(3) + ',' + p.z.toFixed(3) + ',' + p.layer + '\n';
  });
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

  var layerGroups = {};
  results.forEach(function(p){
    if(!layerGroups[p.layer]) layerGroups[p.layer] = [];
    layerGroups[p.layer].push(p);
  });

  var dxf = '0\nSECTION\n2\nENTITIES\n';
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

  var layerGroups = {};
  results.forEach(function(p){
    if(!layerGroups[p.layer]) layerGroups[p.layer] = [];
    layerGroups[p.layer].push(p);
  });
  var layerKeys = Object.keys(layerGroups).sort(function(a, b){ return Number(a) - Number(b); });
  layerKeys.forEach(function(k){
    layerGroups[k].sort(function(a, b){ return a.x - b.x; });
  });

  var nL = layerKeys.length;
  var nX = nL > 0 ? layerGroups[layerKeys[0]].length : 0;
  var canSubdivide = nL >= 2 && nX >= 2 && layerKeys.every(function(k){ return layerGroups[k].length === nX; });

  // Read subdivision resolution (default 2mm)
  var resEl = document.getElementById('faceOBJSubdivision');
  var resolution = resEl ? Math.max(0.1, parseFloat(resEl.value) || 2) : 2;

  if(!canSubdivide){
    // Fall back: export raw probed vertices without subdivision
    var obj = '# 3D Live Edge Mesh - Face Profile\n';
    obj += '# Plugin Version: ' + SM_VERSION + '\n';
    obj += '# Generated ' + new Date().toISOString() + '\n';
    layerKeys.forEach(function(k){
      layerGroups[k].forEach(function(p){
        obj += 'v ' + p.x.toFixed(3) + ' ' + p.y.toFixed(3) + ' ' + p.z.toFixed(3) + '\n';
      });
    });
    var samplesPerLayer = nX;
    var canTriangulate = samplesPerLayer > 0 && nL >= 2;
    if(canTriangulate){
      for(var i = 0; i < nL - 1; i++){
        var baseIdx = i * samplesPerLayer + 1;
        var nextIdx = (i + 1) * samplesPerLayer + 1;
        for(var j = 0; j < samplesPerLayer - 1; j++){
          var va = baseIdx + j;
          var vb = baseIdx + j + 1;
          var vc = nextIdx + j + 1;
          var vd = nextIdx + j;
          obj += 'f ' + va + ' ' + vb + ' ' + vc + '\n';
          obj += 'f ' + va + ' ' + vc + ' ' + vd + '\n';
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
    setFooterStatus('OBJ exported.', 'good');
    return;
  }

  // Build 2D grid of probed points: pts[xi][li] = {x, y, z}
  // xi = X column index (0..nX-1), li = layer index (0..nL-1, ascending by layer number)
  var pts = [];
  for(var xi = 0; xi < nX; xi++){
    pts.push([]);
    for(var li = 0; li < nL; li++){
      var p = layerGroups[layerKeys[li]][xi];
      pts[xi].push({ x: p.x, y: p.y, z: p.z });
    }
  }

  // Compute X range and Z range for subdivision resolution using actual min/max across all points
  var xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  for(var xi = 0; xi < nX; xi++){
    for(var li = 0; li < nL; li++){
      var px = pts[xi][li].x, pz = pts[xi][li].z;
      if(px < xMin) xMin = px;
      if(px > xMax) xMax = px;
      if(pz < zMin) zMin = pz;
      if(pz > zMax) zMax = pz;
    }
  }
  var xRange = xMax - xMin;
  var zRange = zMax - zMin;

  var numCols = Math.max(2, Math.round(xRange / resolution) + 1);
  var numRows = Math.max(2, Math.round(zRange / resolution) + 1);

  // Interpolation helpers
  function lerp(a, b, t){ return a + (b - a) * t; }
  function bilerp(v00, v10, v01, v11, tx, tv){
    return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), tv);
  }

  function interpolatePoint(u, v){
    // u in [0,1] along X axis, v in [0,1] along layer axis
    var fu = u * (nX - 1);
    var xi0 = Math.min(nX - 2, Math.max(0, Math.floor(fu)));
    var xi1 = xi0 + 1;
    var tx = fu - xi0;

    var fv = v * (nL - 1);
    var li0 = Math.min(nL - 2, Math.max(0, Math.floor(fv)));
    var li1 = li0 + 1;
    var tv = fv - li0;

    var p00 = pts[xi0][li0], p10 = pts[xi1][li0];
    var p01 = pts[xi0][li1], p11 = pts[xi1][li1];

    return {
      x: bilerp(p00.x, p10.x, p01.x, p11.x, tx, tv),
      y: bilerp(p00.y, p10.y, p01.y, p11.y, tx, tv),
      z: bilerp(p00.z, p10.z, p01.z, p11.z, tx, tv)
    };
  }

  var origCount = nX * nL;
  var totalVerts = numCols * numRows;
  var totalFaces = (numCols - 1) * (numRows - 1) * 2;

  var obj = '# 3D Live Edge Mesh - Face Profile (Subdivided)\n';
  obj += '# Plugin Version: ' + SM_VERSION + '\n';
  obj += '# Subdivision: ' + resolution.toFixed(2) + 'mm resolution\n';
  obj += '# Original: ' + origCount + ' probed points -> ' + totalVerts + ' interpolated vertices\n';
  obj += '# Generated ' + new Date().toISOString() + '\n';

  // Vertices: row r (layer axis), col c (X axis)
  for(var r = 0; r < numRows; r++){
    var v = numRows > 1 ? r / (numRows - 1) : 0;
    for(var c = 0; c < numCols; c++){
      var u = numCols > 1 ? c / (numCols - 1) : 0;
      var pt = interpolatePoint(u, v);
      obj += 'v ' + pt.x.toFixed(3) + ' ' + pt.y.toFixed(3) + ' ' + pt.z.toFixed(3) + '\n';
    }
  }

  // Faces (two triangles per quad, 1-indexed)
  for(var r = 0; r < numRows - 1; r++){
    for(var c = 0; c < numCols - 1; c++){
      var va = r * numCols + c + 1;
      var vb = r * numCols + c + 2;
      var vc = (r + 1) * numCols + c + 2;
      var vd = (r + 1) * numCols + c + 1;
      obj += 'f ' + va + ' ' + vb + ' ' + vc + '\n';
      obj += 'f ' + va + ' ' + vc + ' ' + vd + '\n';
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
  setFooterStatus('OBJ exported (' + totalVerts + ' vertices, ' + totalFaces + ' triangles).', 'good');
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
