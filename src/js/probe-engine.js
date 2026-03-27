function _buildMeshData(){
  var sampleAxis      = (document.getElementById('sampleAxis') || {}).value || 'X';
  var topFixedCoord   = parseFloat((document.getElementById('topFixedCoord') || {}).value) || 0;
  var topSampleStart  = parseFloat((document.getElementById('topSampleStart') || {}).value) || 0;
  var topSampleEnd    = parseFloat((document.getElementById('topSampleEnd') || {}).value) || 100;
  var topSampleCount  = parseInt((document.getElementById('topSampleCount') || {}).value, 10) || 10;
  var topDirection    = (document.getElementById('topDirection') || {}).value || '+';
  return {
    pluginId: 'com.ncsender.edgeprobe.combined',
    pluginVersion: SM_VERSION,
    version: '1.7.0',
    timestamp: new Date().toISOString(),
    gridConfig: {
      sampleAxis: sampleAxis,
      topFixedCoord: topFixedCoord,
      topSampleStart: topSampleStart,
      topSampleEnd: topSampleEnd,
      topSampleCount: topSampleCount,
      topDirection: topDirection
    },
    topResults: topResults,
    faceResults: faceResults
  };
}

function saveMeshToFile(){
  try{
    var data = _buildMeshData();
    var blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'mesh_' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    var statusEl = document.getElementById('mesh-storage-status');
    if(statusEl) statusEl.textContent = 'Mesh saved to file.';
  }catch(e){
    var statusEl = document.getElementById('mesh-storage-status');
    if(statusEl) statusEl.textContent = 'Save failed: ' + e.message;
  }
}

function loadMeshFromFile(){
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = function(e){
    var file = e.target.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(ev){
      try{
        var data = JSON.parse(ev.target.result);
        if(!data.topResults) throw new Error('Missing topResults field');
        topResults = data.topResults || [];
        faceResults = data.faceResults || [];
        updateAllResultsUI();
        updateEdgeProbeStorageUI();
        var statusEl = document.getElementById('mesh-storage-status');
        if(statusEl) statusEl.textContent = 'Loaded from file: ' + topResults.length + ' top + ' + faceResults.length + ' face results.';
        pluginDebug('loadMeshFromFile: loaded top=' + topResults.length + ' face=' + faceResults.length);
      }catch(ex){
        var statusEl = document.getElementById('mesh-storage-status');
        if(statusEl) statusEl.textContent = 'Load failed: ' + ex.message;
      }
    };
    reader.readAsText(file);
  };
  document.body.appendChild(input);
  input.click();
  document.body.removeChild(input);
}

function saveMeshToStorage(){
  var statusEl = document.getElementById('mesh-storage-status');
  var data;
  try {
    data = _buildMeshData();
  } catch(e) {
    if(statusEl) statusEl.textContent = 'Save failed: ' + e.message;
    return;
  }
  var jsonStr = JSON.stringify(data, null, 2);
  var today = new Date();
  var dateStr = today.getFullYear() + '-' +
    String(today.getMonth() + 1).padStart(2, '0') + '-' +
    String(today.getDate()).padStart(2, '0');
  var suggestedName = 'edge-probe-results-' + dateStr + '.json';

  // Also save to localStorage as backup
  var localSaved = false;
  try { localStorage.setItem(MESH_STORAGE_KEY, jsonStr); localSaved = true; } catch(e) {}
  var backupNote = localSaved ? ' (also backed up to browser storage)' : '';

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
          if (statusEl) statusEl.textContent = '\u2705 Saved to file: ' + handle.name + backupNote;
        });
      });
    }).catch(function(err) {
      if (err.name !== 'AbortError') {
        if (statusEl) statusEl.textContent = 'Save failed: ' + err.message;
        console.error('Save edge probe results failed:', err);
      } else {
        if (statusEl) statusEl.textContent = localSaved ? 'Save cancelled (backed up to browser storage).' : 'Save cancelled.';
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
      if (statusEl) statusEl.textContent = '\u2705 Saved as ' + suggestedName + backupNote;
    } catch(e) {
      if (statusEl) statusEl.textContent = 'Save failed: ' + e.message;
    }
  }
}

function loadMeshFromStorage(){
  try{
    var raw = localStorage.getItem(MESH_STORAGE_KEY);
    if(!raw) throw new Error('No mesh found in storage');
    var data = JSON.parse(raw);
    if(!data.topResults) throw new Error('Missing topResults field');
    topResults = data.topResults || [];
    faceResults = data.faceResults || [];
    updateAllResultsUI();
    updateEdgeProbeStorageUI();
    var statusEl = document.getElementById('mesh-storage-status');
    if(statusEl) statusEl.textContent = 'Loaded from storage: ' + topResults.length + ' top + ' + faceResults.length + ' face results.';
    pluginDebug('loadMeshFromStorage: loaded top=' + topResults.length + ' face=' + faceResults.length);
  }catch(e){
    var statusEl = document.getElementById('mesh-storage-status');
    if(statusEl) statusEl.textContent = 'Load failed: ' + e.message;
  }
}

function clearMeshStorage(){
  localStorage.removeItem(MESH_STORAGE_KEY);
  var statusEl = document.getElementById('mesh-storage-status');
  if(statusEl) statusEl.textContent = 'Stored mesh cleared.';
  updateEdgeProbeStorageUI();
  pluginDebug('clearMeshStorage: edge probe localStorage cleared');
}

// ── Initialise ────────────────────────────────────────────────────────────────
// ── Surface Mesh State ────────────────────────────────────────────────────────
var smMeshData = null;
var smGridConfig = null;
var smOriginalGcode = null;
var smCompensatedGcode = null;
var smStopFlag = false;
var SM_MESH_KEY = '3dmesh.combined.mesh';
var SM_SETTINGS_KEY = '3dmesh.combined.settings';
// ── Combined Mode State ───────────────────────────────────────────────────────
var combinedMeshPoints = null; // unified array: [{x,y,z,source:'surface'|'face'}]
var _smProbingCompleteCallback = null; // set by combined mode to chain face probe after surface probe
// ── Probe Sequence Recording ──────────────────────────────────────────────────
var smPvizProbeSequence = [];
var _smPvizSeqLastTime = 0;

function buildSurfaceGridConfig() {
  var minX = Number(document.getElementById('sm-minX').value);
  var maxX = Number(document.getElementById('sm-maxX').value);
  var spacingX = Number(document.getElementById('sm-spacingX').value);
  var minY = Number(document.getElementById('sm-minY').value);
  var maxY = Number(document.getElementById('sm-maxY').value);
  var spacingY = Number(document.getElementById('sm-spacingY').value);
  if (minX >= maxX || minY >= maxY || spacingX <= 0 || spacingY <= 0) {
    alert('Invalid grid settings: Min must be less than Max, spacing must be > 0');
    return null;
  }
  var colCount = Math.floor((maxX - minX) / spacingX) + 1;
  var rowCount = Math.floor((maxY - minY) / spacingY) + 1;
  return { minX: minX, maxX: maxX, colSpacing: spacingX, minY: minY, maxY: maxY, rowSpacing: spacingY, colCount: colCount, rowCount: rowCount };
}

function updateSurfaceGridSizeDisplay() {
  var el = document.getElementById('sm-gridSizeDisplay');
  if (!el) return;
  var vMinX = document.getElementById('sm-minX').value;
  var vMaxX = document.getElementById('sm-maxX').value;
  var vSpacingX = document.getElementById('sm-spacingX').value;
  var vMinY = document.getElementById('sm-minY').value;
  var vMaxY = document.getElementById('sm-maxY').value;
  var vSpacingY = document.getElementById('sm-spacingY').value;
  if (vMinX === '' || vMaxX === '' || vSpacingX === '' || vMinY === '' || vMaxY === '' || vSpacingY === '') {
    el.innerHTML = '&mdash;';
    return;
  }
  var minX = Number(vMinX), maxX = Number(vMaxX), spacingX = Number(vSpacingX);
  var minY = Number(vMinY), maxY = Number(vMaxY), spacingY = Number(vSpacingY);
  if (isNaN(minX) || isNaN(maxX) || isNaN(spacingX) || isNaN(minY) || isNaN(maxY) || isNaN(spacingY) ||
      minX >= maxX || minY >= maxY || spacingX <= 0 || spacingY <= 0) {
    el.innerHTML = '&mdash;';
    return;
  }
  var colCount = Math.floor((maxX - minX) / spacingX) + 1;
  var rowCount = Math.floor((maxY - minY) / spacingY) + 1;
  el.innerHTML = colCount + ' &times; ' + rowCount + ' = ' + (colCount * rowCount) + ' points';
}

function smLogProbe(msg) { smAppendLog('sm-probeLog', msg); }
function smLogApply(msg) { smAppendLog('sm-applyLog', msg); }
function smAppendLog(id, msg) {
  var el = document.getElementById(id);
  if (!el) return;
  var ts = new Date().toTimeString().slice(0, 8);
  var text = '[' + ts + '] ' + msg;
  var line = document.createElement('div');
  line.textContent = text;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}
function smClearLog(id) {
  var el = document.getElementById(id);
  if (el) el.innerHTML = '';
  if (id === 'sm-probeLog') {
    var bar = document.getElementById('sm-probeProgressBar');
    if (bar) bar.style.width = '0%';
    var track = document.getElementById('sm-probeProgressTrack');
    if (track) track.style.display = 'none';
    smSetProbeStatus('Ready', '');
  }
}
function smSetProbeStatus(msg, type) {
  var el = document.getElementById('sm-probeStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'mini' + (type ? ' status-' + type : '');
}
function smSetProgress(pct) {
  var track = document.getElementById('sm-probeProgressTrack');
  if (track) track.style.display = 'block';
  var el = document.getElementById('sm-probeProgressBar');
  if (el) el.style.width = Math.max(0, Math.min(100, pct)) + '%';
}
function smFmtN(n) { return Number(n).toFixed(3); }

function smCheckStop() {
  if (smStopFlag) throw new Error('Stopped by user');
}
function smSleep(ms) { return new Promise(function(resolve) { setTimeout(resolve, ms); }); }


function smGetProbeTriggered() {
  return _getState().then(function(state) {
    var ms = _machineStateFrom(state);
    return (ms.Pn || '').indexOf('P') >= 0;
  });
}

// Verify probe input is open before issuing a plunge. If triggered, raises Z above
// clearanceZ + 2 coords and waits 200ms, then re-checks. Up to maxAttempts retries.
async function smEnsureProbeClear(clearanceZ, travelFeed) {
  pluginDebug('smEnsureProbeClear ENTER: clearanceZ=' + clearanceZ + ' travelFeed=' + travelFeed);
  var maxAttempts = 3;
  for (var attempt = 0; attempt <= maxAttempts; attempt++) {
    var triggered = await smGetProbeTriggered();
    if (!triggered){ pluginDebug('smEnsureProbeClear OK: probe is clear (attempt ' + attempt + ')'); return; }
    if (attempt >= maxAttempts) {
      pluginDebug('smEnsureProbeClear ERROR: probe stuck triggered after ' + maxAttempts + ' attempts');
      throw new Error('Probe input stuck triggered after ' + maxAttempts + ' clearing attempts; aborting');
    }
    smLogProbe('Probe triggered before plunge (attempt ' + (attempt + 1) + '/' + maxAttempts + '); raising Z to clear...');
    pluginDebug('smEnsureProbeClear: probe triggered attempt=' + (attempt + 1) + '/' + maxAttempts + ', raising Z');
    var pos = await getWorkPosition();
    var targetZ = Math.max(pos.z, clearanceZ) + 2; // 2 coords above clearance to ensure probe clears
    var clearCmd = 'G90 G1 Z' + targetZ.toFixed(3) + ' F' + travelFeed;
    smLogProbe('[PLUGIN DEBUG] smEnsureProbeClear: sending command: ' + clearCmd);
    pluginDebug('smEnsureProbeClear: sending: ' + clearCmd);
    await sendCommand(clearCmd);
    await waitForIdleWithTimeout();
    await smSleep(200); // 200ms settle time for probe input to clear
  }
}

async function smSafeLateralMove(targetX, targetY, travelFeed, clearanceZ) {
  pluginDebug('smSafeLateralMove ENTER: targetX=' + targetX + ' targetY=' + targetY + ' travelFeed=' + travelFeed + ' clearanceZ=' + clearanceZ);
  var backoff = Math.max(0.1, Number(document.getElementById('travelContactBackoff').value) || 5);
  var lift = Math.max(0.1, Number(document.getElementById('travelContactLift').value) || 5);
  var maxRetries = Math.max(1, Math.round(Number(document.getElementById('travelContactMaxRetries').value) || 5));

  smLogProbe('TRAVEL: lifting Z by ' + clearanceZ.toFixed(3) + ' coords (relative), then moving to X' + targetX.toFixed(3) + ' Y' + targetY.toFixed(3));

  // Move a single axis to target using one full-distance G38.3 command.
  // If the probe triggers mid-move (stopped short), back off opposite to travel direction,
  // lift Z, and retry up to maxRetries times.
  async function moveAxis(axis, target) {
    var retries = 0;
    async function attempt() {
      smCheckStop();
      var pos = await getWorkPosition();
      var current = (axis === 'X') ? pos.x : pos.y;
      if (Math.abs(current - target) < 0.1) return;
      var travelDir = (target > current) ? 1 : -1;
      await sendCommand('G90 G38.3 ' + axis + target.toFixed(3) + ' F' + travelFeed);
      await waitForIdleWithTimeout();
      var newPos = await getWorkPosition();
      var arrived = (axis === 'X') ? newPos.x : newPos.y;
      if (Math.abs(arrived - target) <= 0.1) return;
      // Stopped short — probe triggered during lateral travel
      smLogProbe('TRAVEL CONTACT (' + axis + '): stopped at ' + arrived.toFixed(3) + ', target ' + target.toFixed(3) + '.');
      if (retries >= maxRetries) {
        throw new Error('Travel path blocked after ' + maxRetries + ' contact recoveries on ' + axis + ' axis.');
      }
      retries++;
      var bounceVal = arrived - travelDir * backoff;
      var liftZ = newPos.z + lift;
      smLogProbe('TRAVEL CONTACT: recovery ' + retries + '/' + maxRetries + ': ' + axis + ' to ' + bounceVal.toFixed(3) + ', lift Z to ' + liftZ.toFixed(3) + '.');
      await sendCommand('G90 G1 ' + axis + bounceVal.toFixed(3) + ' F' + travelFeed);
      await waitForIdleWithTimeout();
      await sendCommand('G90 G1 Z' + liftZ.toFixed(3) + ' F' + travelFeed);
      await waitForIdleWithTimeout();
      await smSleep(120);
      await attempt();
    }
    await attempt();
  }

  // Lift Z by clearanceZ coords relative from current position (contact point), then travel X/Y.
  // This ensures clearance is always clearanceZ above wherever the probe last touched,
  // regardless of absolute work Z.
  var liftCmd = 'G91 G1 Z' + clearanceZ.toFixed(3) + ' F' + travelFeed;
  smLogProbe('[PLUGIN DEBUG] smSafeLateralMove: sending command: ' + liftCmd);
  pluginDebug('smSafeLateralMove: Z-lift cmd: ' + liftCmd);
  await sendCommand(liftCmd);
  smLogProbe('[PLUGIN DEBUG] smSafeLateralMove: waiting for idle after Z lift...');
  await waitForIdleWithTimeout();
  smLogProbe('[PLUGIN DEBUG] smSafeLateralMove: idle confirmed after Z lift');
  await sendCommand('G90');
  await waitForIdleWithTimeout();
  await moveAxis('X', targetX);
  await moveAxis('Y', targetY);
  var pos = await getWorkPosition();
  smLogProbe('[PLUGIN DEBUG] smSafeLateralMove: position after travel X=' + pos.x.toFixed(3) + ' Y=' + pos.y.toFixed(3) + ' Z=' + pos.z.toFixed(3));
  pluginDebug('smSafeLateralMove EXIT: X=' + pos.x.toFixed(3) + ' Y=' + pos.y.toFixed(3) + ' Z=' + pos.z.toFixed(3));
}

async function smPlungeProbe(maxPlunge, probeFeed) {
  pluginDebug('smPlungeProbe ENTER: maxPlunge=' + maxPlunge + ' probeFeed=' + probeFeed);
  var clearanceZ = Number((document.getElementById('sm-clearanceZ') || {}).value) || 5;
  var liftFeed = Number((document.getElementById('travelRecoveryLiftFeedRate') || {}).value) ||
                 Number((document.getElementById('sm-travelFeed') || {}).value) || 600;

  // Verify probe input is open before plunging; lift and recheck if triggered (up to 3 attempts)
  await smEnsureProbeClear(clearanceZ, liftFeed);
  // Record starting Z to detect contact via position change (reliable fallback when Pn clears on idle)
  var startPos = await getWorkPosition();
  var startZ = startPos.z;
  // Issue the probe move and require contact within maxPlunge
  var probeCmd = 'G91 G38.2 Z-' + maxPlunge.toFixed(3) + ' F' + probeFeed;
  smLogProbe('[PLUGIN DEBUG] smPlungeProbe: sending command: ' + probeCmd);
  pluginDebug('smPlungeProbe: sending: ' + probeCmd);
  await sendCommand(probeCmd);
  smLogProbe('[PLUGIN DEBUG] smPlungeProbe: waiting for idle after probe move...');
  await waitForIdleWithTimeout();
  smLogProbe('[PLUGIN DEBUG] smPlungeProbe: idle confirmed after probe move');
  var endPos = await getWorkPosition();
  var distanceTraveled = startZ - endPos.z;
  smLogProbe('[PLUGIN DEBUG] smPlungeProbe: startZ=' + startZ.toFixed(3) + ' endZ=' + endPos.z.toFixed(3) + ' traveled=' + distanceTraveled.toFixed(3) + ' coords');
  pluginDebug('smPlungeProbe: travel startZ=' + startZ.toFixed(3) + ' endZ=' + endPos.z.toFixed(3) + ' traveled=' + distanceTraveled.toFixed(3) + ' coords');
  // Contact detected if machine stopped short of maxPlunge (position-based, robust when
  // probe pin clears before idle query) or if Pn still shows 'P' (pin-based)
  var probeContactTolerance = 0.5; // coords; machine must stop at least this far short of maxPlunge
  var stoppedShort = distanceTraveled < (maxPlunge - probeContactTolerance);
  var triggered = await smGetProbeTriggered();
  if (!triggered && !stoppedShort) {
    smLogProbe('[PLUGIN DEBUG] smPlungeProbe ERROR: No contact within max plunge ' + maxPlunge.toFixed(3) + ' coords');
    pluginDebug('smPlungeProbe ERROR: no contact within maxPlunge=' + maxPlunge.toFixed(3));
    throw new Error('No contact within max plunge');
  }
  if (!triggered && stoppedShort) {
    smLogProbe('[PLUGIN DEBUG] smPlungeProbe NOTE: probe pin not active after idle but machine stopped at Z=' + endPos.z.toFixed(3) + ' (' + distanceTraveled.toFixed(3) + ' coords/' + maxPlunge.toFixed(3) + ' coords) — contact detected by position');
    pluginDebug('smPlungeProbe: contact by position (pin cleared), Z=' + endPos.z.toFixed(3));
  }
  pluginDebug('smPlungeProbe EXIT: contact Z=' + endPos.z.toFixed(3));
  var snap = await getMachineSnapshot();
  endPos.machineX = snap.machineX;
  endPos.machineY = snap.machineY;
  endPos.machineZ = snap.machineZ;
  smLogProbe('[PLUGIN DEBUG] smPlungeProbe: machineZ=' + snap.machineZ.toFixed(3));
  return endPos;
}

async function smRetractUp(clearanceZ, travelFeed) {
  var pos = await getWorkPosition();
  if (pos.z >= clearanceZ - 0.001){ pluginDebug('smRetractUp SKIP: Z=' + pos.z.toFixed(3) + ' already >= clearanceZ=' + clearanceZ); return; }
  var cmd = 'G90 G1 Z' + clearanceZ.toFixed(3) + ' F' + travelFeed;
  smLogProbe('[PLUGIN DEBUG] smRetractUp: sending command: ' + cmd);
  smLogProbe('[PLUGIN DEBUG] smRetractUp: position BEFORE: Z=' + pos.z.toFixed(3));
  pluginDebug('smRetractUp: ' + cmd);
  await sendCommand(cmd);
  smLogProbe('[PLUGIN DEBUG] smRetractUp: waiting for idle...');
  await waitForIdleWithTimeout();
  smLogProbe('[PLUGIN DEBUG] smRetractUp: idle confirmed');
  var newPos = await getWorkPosition();
  smLogProbe('[PLUGIN DEBUG] smRetractUp: position AFTER: Z=' + newPos.z.toFixed(3));
  pluginDebug('smRetractUp EXIT: Z=' + newPos.z.toFixed(3));
}

async function smRetractSmall(contactZ, retractMm, travelFeed) {
  var targetZ = contactZ + retractMm;
  var cmd = 'G90 G1 Z' + targetZ.toFixed(3) + ' F' + travelFeed;
  smLogProbe('[PLUGIN DEBUG] smRetractSmall: sending command: ' + cmd + ' (contact=' + contactZ.toFixed(3) + ' retract=' + retractMm + ' coords)');
  pluginDebug('smRetractSmall: contact=' + contactZ.toFixed(3) + ' retract=' + retractMm + ' coords cmd: ' + cmd);
  await sendCommand(cmd);
  smLogProbe('[PLUGIN DEBUG] smRetractSmall: waiting for idle...');
  await waitForIdleWithTimeout();
  smLogProbe('[PLUGIN DEBUG] smRetractSmall: idle confirmed; expected Z=' + targetZ.toFixed(3));
  pluginDebug('smRetractSmall EXIT: expected Z=' + targetZ.toFixed(3));
}

async function smRetractToZ(targetZ, travelFeed) {
  var pos = await getWorkPosition();
  var delta = targetZ - pos.z;
  if (delta <= 0.001){ pluginDebug('smRetractToZ SKIP: already at/above targetZ=' + targetZ.toFixed(3)); return; }
  var cmd = 'G90 G1 Z' + targetZ.toFixed(3) + ' F' + travelFeed;
  smLogProbe('[PLUGIN DEBUG] smRetractToZ: sending command: ' + cmd + ' (delta=' + delta.toFixed(3) + ' coords)');
  pluginDebug('smRetractToZ: current Z=' + pos.z.toFixed(3) + ' target=' + targetZ.toFixed(3) + ' delta=' + delta.toFixed(3));
  await sendCommand(cmd);
  smLogProbe('[PLUGIN DEBUG] smRetractToZ: waiting for idle...');
  await waitForIdleWithTimeout();
  smLogProbe('[PLUGIN DEBUG] smRetractToZ: idle confirmed; expected Z=' + targetZ.toFixed(3));
  pluginDebug('smRetractToZ EXIT: expected Z=' + targetZ.toFixed(3));
}

async function smFinishMotion(travelFeed) {
  pluginDebug('smFinishMotion ENTER: travelFeed=' + travelFeed);
  var s = getSettingsFromUI();
  var finishZ = Number(s.finishHomeZ);
  var useMachineHomeRetract = !!s.useMachineHomeRetract;
  var machineSafeTopZ = Number(s.machineSafeTopZ);
  var returnXYZero = !!s.returnToXYZero;
  var feed = travelFeed || s.travelFeedRate || 600; // 600 mm/min safe fallback

  var pos = await getWorkPosition();
  var currentZ = Number(pos.z);
  var safeTravelZ = isFinite(currentZ) ? Math.max(currentZ, finishZ) : finishZ;

  var state = await _getState();
  var ms = _machineStateFrom(state);
  var homed = _detectHomed(ms, state);

  if (useMachineHomeRetract) {
    if (homed === true) {
      // Use machine position snapshot to skip G53 retract if already above target
      var mPos = _parsePos(ms.MPos);
      var wco = _parsePos(ms.WCO);
      var currentMachineZ = null;
      if (mPos) {
        currentMachineZ = mPos.z;
      } else if (wco && isFinite(currentZ)) {
        currentMachineZ = currentZ + wco.z;
      }
      if (currentMachineZ !== null && machineSafeTopZ <= currentMachineZ) {
        smLogProbe('Finish move: current machine Z ' + currentMachineZ.toFixed(3) + ' is already at or above target ' + machineSafeTopZ.toFixed(3) + '; skipping G53 retract');
      } else {
        smLogProbe('Finish move: machine is homed; retracting with G53 to machine Z ' + machineSafeTopZ.toFixed(3) + ' before X/Y travel');
        try {
          await moveMachineZAbs(machineSafeTopZ, feed);
        } catch(retractErr) {
          smLogProbe('Finish move: G53 retract error (' + retractErr.message + '); continuing with return');
        }
        var retractPos = await getWorkPosition();
        smLogProbe('DEBUG POSITION: after finish retract X=' + retractPos.x.toFixed(3) + ' Y=' + retractPos.y.toFixed(3) + ' Z=' + retractPos.z.toFixed(3));
      }
    } else {
      smLogProbe('Finish move warning: machine-home retract enabled but homed state is not available; falling back to work Z ' + safeTravelZ.toFixed(3));
      if (isFinite(currentZ) && finishZ <= currentZ) {
        smLogProbe('Finish move: current work Z ' + currentZ.toFixed(3) + ' is already above fallback target ' + finishZ.toFixed(3) + '; keeping current Z for safe X/Y return');
      } else {
        smLogProbe('Finish move: lifting work Z to fallback ' + safeTravelZ.toFixed(3));
        await moveAbs(null, null, safeTravelZ, feed);
        var retractPos = await getWorkPosition();
        smLogProbe('DEBUG POSITION: after finish retract X=' + retractPos.x.toFixed(3) + ' Y=' + retractPos.y.toFixed(3) + ' Z=' + retractPos.z.toFixed(3));
      }
    }
  } else {
    if (isFinite(currentZ) && finishZ <= currentZ) {
      smLogProbe('Finish move: current work Z ' + currentZ.toFixed(3) + ' is already above target ' + finishZ.toFixed(3) + '; keeping current Z for safe X/Y return');
    } else {
      smLogProbe('Finish move: lifting work Z to ' + safeTravelZ.toFixed(3));
      await moveAbs(null, null, safeTravelZ, feed);
      var retractPos = await getWorkPosition();
      smLogProbe('DEBUG POSITION: after finish retract X=' + retractPos.x.toFixed(3) + ' Y=' + retractPos.y.toFixed(3) + ' Z=' + retractPos.z.toFixed(3));
    }
  }

  if (returnXYZero) {
    smLogProbe('Finish move: returning to work X0.000 Y0.000');
    await moveAbs(0, 0, null, feed);
    var returnPos = await getWorkPosition();
    smLogProbe('DEBUG POSITION: after finish return X=' + returnPos.x.toFixed(3) + ' Y=' + returnPos.y.toFixed(3) + ' Z=' + returnPos.z.toFixed(3));
  } else {
    smLogProbe('Finish move: X/Y return disabled');
  }
}

