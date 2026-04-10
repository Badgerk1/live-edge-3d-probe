var SM_VERSION = 'V21.0';
// ── State ─────────────────────────────────────────────────────────────────────
var _running = false;
var _stopRequested = false;
var _faceSurfRefZ = null; // surface reference Z in WORK coords captured by Surface Reference Probe button
var topResults = [];
var faceResults = [];
var s = {}; // current run settings — set by runFaceProbe
var TOP_RESULTS_KEY = 'edgeProbeTopResults';
var FACE_RESULTS_KEY = 'edgeProbeFaceResults';
var FACE_LAYERED_RESULTS_KEY = 'edgeProbeFaceLayeredResults';
var FACE_MESH_STORAGE_KEY = 'faceProbe.faceMeshData';
var FACE_PROBE_DEFAULT_MAX_DEPTH = 14.75; // default probe stylus callout length (coords) — cap for Z End
var _facePvizRotX = 20, _facePvizRotY = -25, _facePvizRotZ = 0, _faceDragActive = false, _faceDragLastX = 0, _faceDragLastY = 0;
var FACE_LOG_KEY = 'edgeProbeFaceLog';
var SAVED_LOCATION_KEY = 'edgeProbeSavedLocation';
var topLogLines = [];
var faceLogLines = [];
var layeredFaceResults = [];
var layeredFaceResultsRaw = []; // original sparse face probe points (pre-subdivision)
var MESH_STORAGE_KEY = 'edgeProbeMeshData';
var meshSubdivisionSpacing = 2; // mm between subdivided mesh points (0 = disabled)
var PROBE_DIMENSIONS_KEY = 'edgeProbeDimensions';

// ── Debug logging ─────────────────────────────────────────────────────────────
var _pluginDebugMode = false; // toggled by "Debug Log" checkbox in footer

/**
 * pluginDebug(msg) — write a [PLUGIN DEBUG] entry to the browser console
 * and append it to whichever probe log is currently visible (sm-probeLog
 * first, then face-log, then top-log).  Does nothing when debug mode is off.
 */
function pluginDebug(msg) {
  var line = '[PLUGIN DEBUG] ' + msg;
  // Always log to browser console so devtools captures every entry
  console.log(line);
  if (!_pluginDebugMode) return;
  // Append to surface probe log when available (primary during probing)
  var el = document.getElementById('sm-probeLog');
  if (!el) el = document.getElementById('face-log');
  if (!el) el = document.getElementById('top-log');
  if (el) {
    var ts = tsMs();
    var div = document.createElement('div');
    div.className = 'log-entry';
    div.style.color = 'var(--muted)';
    div.textContent = '[' + ts + '] ' + line;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
  }
}

// ── Utility helpers ───────────────────────────────────────────────────────────
function sleep(ms){ return new Promise(function(resolve){ setTimeout(resolve, ms); }); }
function tsMs(){
  var d = new Date();
  var hh = String(d.getHours()).padStart(2,'0');
  var mm = String(d.getMinutes()).padStart(2,'0');
  var ss = String(d.getSeconds()).padStart(2,'0');
  var ms = String(d.getMilliseconds()).padStart(3,'0');
  return hh + ':' + mm + ':' + ss + '.' + ms;
}
function escHtml(v){ return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function checkStop(){ if(_stopRequested) throw new Error('User stop requested'); }

// ── Visual reset on plugin restart ────────────────────────────────────────────
// Clear all canvases and Three.js scenes to prevent stale visuals on restart
function clearAllVisuals() {
  pluginDebug('clearAllVisuals: clearing all canvas and visualization state');
  // Clear all canvas elements
  var canvasIds = [
    'sm-heatmap-canvas', 'face-heatmap-canvas', 'res-heatmap-canvas',
    'res-face-heatmap-canvas', 'relief-2d-canvas'
  ];
  canvasIds.forEach(function(id) {
    var canvas = document.getElementById(id);
    if (canvas && canvas.getContext) {
      var ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  });
  // Clear Three.js scene containers
  var threeContainers = ['relief-3d-scene', 'res-3d-scene', 'res-face-3d-scene'];
  threeContainers.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) {
      // Remove all children except the canvas
      while (el.firstChild) {
        el.removeChild(el.firstChild);
      }
    }
  });
  // Reset internal visualization state flags
  try {
    if (typeof _smHeatmapRendered !== 'undefined') _smHeatmapRendered = false;
    if (typeof _faceHeatmapRendered !== 'undefined') _faceHeatmapRendered = false;
    if (typeof _relief3DInited !== 'undefined') _relief3DInited = false;
  } catch(e) {}
  pluginDebug('clearAllVisuals: done');
}

// ── Stop ──────────────────────────────────────────────────────────────────────
function stopAll(){
  _stopRequested = true;
  setFooterStatus('Stop requested — halting after current move…', 'warn');
}

// ── ncSender API bridge (fetch-based) ─────────────────────────────────────────
async function sendCommand(gcode, timeoutMs){
  pluginDebug('sendCommand ENTER: cmd="' + gcode + '" timeout=' + ((timeoutMs !== null && timeoutMs !== undefined) ? timeoutMs : 15000) + 'ms');
  console.log('[' + tsMs() + '] SEND: ' + gcode);
  var controller = new AbortController();
  var ms = (timeoutMs !== null && timeoutMs !== undefined) ? timeoutMs : 15000;
  var timer = setTimeout(function(){ controller.abort(); }, ms);
  try {
    var r = await fetch('/api/send-command', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({command: gcode, meta: {sourceId: 'plugin', plugin: 'com.ncsender.edgeprobe.combined'}}),
      signal: controller.signal
    });
    var js = await r.json();
    pluginDebug('sendCommand RESPONSE: cmd="' + gcode + '" response=' + JSON.stringify(js));
    if(js.error || js.success === false){
      var errMsg = (js.error && (js.error.message || js.error)) || 'Command failed';
      pluginDebug('sendCommand ERROR: cmd="' + gcode + '" error="' + errMsg + '"');
      throw new Error(errMsg);
    }
    console.log('[' + tsMs() + '] DONE: ' + gcode);
    pluginDebug('sendCommand OK: cmd="' + gcode + '"');
    return js;
  } catch(e) {
    if(e.name === 'AbortError'){
      pluginDebug('sendCommand TIMEOUT: cmd="' + gcode + '" after ' + ms + 'ms');
      throw new Error('sendCommand timed out after ' + ms + 'ms for: ' + gcode);
    }
    pluginDebug('sendCommand EXCEPTION: cmd="' + gcode + '" error="' + e.message + '"');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function _getState(){
  var r = await fetch('/api/server-state');
  var state = await r.json();
  pluginDebug('_getState raw: status=' + ((state.machineState || (state.cnc && state.cnc.machineState) || {}).status || 'n/a'));
  return state;
}

function _machineStateFrom(state){
  return state.machineState || (state.cnc && state.cnc.machineState) || {};
}

function _detectHomed(ms, state){
  var candidates = [
    ms.isHomed, ms.homed, ms.hasHomed, ms.homingComplete,
    state && state.isHomed, state && state.homed
  ];
  for(var i = 0; i < candidates.length; i++){
    if(typeof candidates[i] === 'boolean') return candidates[i];
  }
  if(typeof ms.homing === 'boolean') return !ms.homing;
  return null;
}

async function getMachineSnapshot(){
  pluginDebug('getMachineSnapshot ENTER');
  var state = await _getState();
  var ms = _machineStateFrom(state);
  var pos = await getWorkPosition();
  var m = _parsePos(ms.MPos);
  var wco = _parsePos(ms.WCO);
  var machine = m ? {x:m.x, y:m.y, z:m.z} : (wco ? {x:pos.x + wco.x, y:pos.y + wco.y, z:pos.z + wco.z} : null);
  var snap = {
    x: pos.x,
    y: pos.y,
    z: pos.z,
    machineX: machine ? machine.x : null,
    machineY: machine ? machine.y : null,
    machineZ: machine ? machine.z : null,
    status: pos.status || ms.status || 'Unknown',
    probeTriggered: !!pos.probeTriggered,
    homed: _detectHomed(ms, state),
    raw: ms
  };
  pluginDebug('getMachineSnapshot EXIT: status=' + snap.status + ' pos=X' + snap.x + ' Y' + snap.y + ' Z' + snap.z + ' homed=' + snap.homed + ' probe=' + snap.probeTriggered);
  return snap;
}

function _isAlarmStatus(status){
  return String(status || '').toLowerCase() === 'alarm';
}

async function requireStartupHomingPreflight(runLabel){
  pluginDebug('requireStartupHomingPreflight ENTER: label="' + (runLabel || 'probe run') + '"');
  var info = await getMachineSnapshot();
  updateMachineHelperUI(info);
  var label = runLabel || 'probe run';
  if(_isAlarmStatus(info.status)){
    pluginDebug('requireStartupHomingPreflight ABORT: controller in ALARM');
    throw new Error('Controller is in ALARM. Reset/unlock and home the machine before ' + label + '.');
  }
  if(info.probeTriggered){
    pluginDebug('requireStartupHomingPreflight ABORT: probe already triggered');
    throw new Error('Probe input is already triggered. Clear the probe before ' + label + '.');
  }
  if(info.homed !== true){
    pluginDebug('requireStartupHomingPreflight ABORT: machine not homed (homed=' + info.homed + ')');
    throw new Error('Machine must be homed after startup before ' + label + '.');
  }
  pluginDebug('requireStartupHomingPreflight OK: status=' + info.status + ' homed=true probe=open');
  logLine('top', 'Preflight OK: machine homed, status=' + (info.status || 'Unknown') + ', probe=open');
  logLine('face', 'Preflight OK: machine homed, status=' + (info.status || 'Unknown') + ', probe=open');
  return info;
}
function updateMachineHelperUI(info){
  if(!info) return;
  var homedEl = document.getElementById('homedState');
  var machineEl = document.getElementById('machineStatus');
  var probeEl = document.getElementById('probeState');
  if(homedEl) homedEl.value = info.homed == null ? 'Unknown' : (info.homed ? 'Yes' : 'No');
  if(machineEl) machineEl.value = info.status || 'Unknown';
  if(probeEl) probeEl.value = info.probeTriggered ? 'Triggered' : 'Open';
  updateCurrentPositionUI(info);
}

function updateCurrentPositionUI(pos){
  if(!pos) return;
  var xEl = document.getElementById('currentPosX');
  var yEl = document.getElementById('currentPosY');
  var zEl = document.getElementById('currentPosZ');
  if(xEl && isFinite(Number(pos.x))) xEl.value = Number(pos.x).toFixed(3);
  if(yEl && isFinite(Number(pos.y))) yEl.value = Number(pos.y).toFixed(3);
  if(zEl && isFinite(Number(pos.z))) zEl.value = Number(pos.z).toFixed(3);
}

async function refreshCurrentPosition(){
  try{
    var info = await getMachineSnapshot();
    updateMachineHelperUI(info);
    setFooterStatus('Current position refreshed.', 'good');
    var el = document.getElementById('setup-status');
    if(el){ el.textContent = 'Current position refreshed.'; el.className = 'status-line good'; }
    return info;
  }catch(e){
    setFooterStatus('Error: ' + e.message, 'bad');
    var el = document.getElementById('setup-status');
    if(el){ el.textContent = 'Refresh position failed: ' + e.message; el.className = 'status-line bad'; }
    throw e;
  }
}

function setJogStepPreset(val){
  var n = Number(val);
  if(!isFinite(n) || n <= 0) return;
  var xy = document.getElementById('jogStepXY');
  if(xy) xy.value = String(n);
  Array.prototype.forEach.call(document.querySelectorAll('.jog-pill[data-step]'), function(btn){
    var active = Number(btn.getAttribute('data-step')) === n;
    btn.classList.toggle('active', active);
  });
}

async function jogHoldMotion(){
  try{
    await sendCommand('!');
    setFooterStatus('Feed hold sent.', 'warn');
    var el = document.getElementById('setup-status');
    if(el){ el.textContent = 'Feed hold sent.'; el.className = 'status-line warn'; }
  }catch(e){
    setFooterStatus('Jog hold failed: ' + e.message, 'bad');
    throw e;
  }
}

async function jogResumeMotion(){
  try{
    await sendCommand('~');
    setFooterStatus('Resume sent.', 'ok');
    var el = document.getElementById('setup-status');
    if(el){ el.textContent = 'Resume sent.'; el.className = 'status-line ok'; }
    try{
      var after = await getMachineSnapshot();
      updateMachineHelperUI(after);
    }catch(_e){}
  }catch(e){
    setFooterStatus('Jog resume failed: ' + e.message, 'bad');
    throw e;
  }
}

function getJogSettingsFromUI(){
  return {
    stepXY: Number(document.getElementById('jogStepXY').value) || 0,
    stepZ: Number(document.getElementById('jogStepZ').value) || 0,
    feedXY: Number(document.getElementById('jogFeedXY').value) || 600,
    feedZ: Number(document.getElementById('jogFeedZ').value) || 300
  };
}

async function jogBy(dx, dy, dz){
  var jog = getJogSettingsFromUI();
  var feed = (dz != null && dx == null && dy == null) ? jog.feedZ : jog.feedXY;
  if (!isFinite(feed) || feed <= 0) feed = (dz != null) ? 300 : 600;
  // Build $J= jog command (GRBL standard): $J=G91 X... Y... Z... F...
  var cmd = '$J=G91';
  if (dx != null) cmd += ' X' + Number(dx).toFixed(3);
  if (dy != null) cmd += ' Y' + Number(dy).toFixed(3);
  if (dz != null) cmd += ' Z' + Number(dz).toFixed(3);
  cmd += ' F' + Number(feed).toFixed(0);
  try {
    await sendCommand(cmd);
    var moved = [];
    if (dx != null) moved.push('X ' + (dx > 0 ? '+' : '') + Number(dx).toFixed(3));
    if (dy != null) moved.push('Y ' + (dy > 0 ? '+' : '') + Number(dy).toFixed(3));
    if (dz != null) moved.push('Z ' + (dz > 0 ? '+' : '') + Number(dz).toFixed(3));
    setFooterStatus('Jog complete: ' + moved.join('  '), 'good');
    try {
      var after = await getMachineSnapshot();
      updateMachineHelperUI(after);
    } catch(_e) {}
  } catch(e) {
    setFooterStatus('Jog failed: ' + e.message, 'bad');
    var el = document.getElementById('setup-status');
    if (el) { el.textContent = 'Jog error: ' + e.message; el.className = 'status-line warn'; }
    throw e;
  }
}

// ── Button flash animation helper ─────────────────────────────────────────────
function flashButton(btn) {
  if (!btn) return;
  btn.classList.remove('btn-flash');
  // Force reflow to restart animation
  void btn.offsetWidth;
  btn.classList.add('btn-flash');
  setTimeout(function() { btn.classList.remove('btn-flash'); }, 400);
}

// ── Animated save-confirm helper ──────────────────────────────────────────────
function flashSaveButton(btn) {
  if (!btn) return;
  var origHTML = btn.innerHTML;
  btn.classList.remove('btn-save-confirm');
  void btn.offsetWidth;
  btn.innerHTML = '\u2713 Saved!';
  btn.classList.add('btn-save-confirm');
  setTimeout(function() {
    btn.classList.remove('btn-save-confirm');
    setTimeout(function() { btn.innerHTML = origHTML; }, 300);
  }, 1800);
}

async function jogToWorkZero(){
  var jog = getJogSettingsFromUI();
  await moveAbs(0, 0, null, jog.feedXY || 600);
  var after = await getMachineSnapshot();
  updateMachineHelperUI(after);
  setFooterStatus('Moved to work X0 Y0.', 'good');
}

async function jogRaiseToMachineSafeTop(){
  var snap = await getMachineSnapshot();
  var cfg = getSettingsFromUI();
  if(_isAlarmStatus(snap.status)) throw new Error('Controller is in ALARM. Clear/reset before moving to machine safe top.');
  if(!cfg.useMachineHomeRetract) throw new Error('Use Machine-Home Z Retract is disabled in Setup.');
  if(snap.homed !== true) throw new Error('Machine must be homed before moving to machine safe top Z.');
  await moveMachineZAbs(cfg.machineSafeTopZ, cfg.travelFeedRate || 600);
  var after = await getMachineSnapshot();
  updateMachineHelperUI(after);
  setFooterStatus('Moved to machine safe top Z.', 'good');
}

function loadSavedLocation(){
  try{
    var raw = localStorage.getItem(SAVED_LOCATION_KEY);
    if(!raw) return null;
    var pos = JSON.parse(raw);
    updateSavedLocationUI(pos);
    return pos;
  }catch(e){
    console.error('Failed to load saved location', e);
    return null;
  }
}

function saveSavedLocation(pos){
  try{
    localStorage.setItem(SAVED_LOCATION_KEY, JSON.stringify(pos));
    updateSavedLocationUI(pos);
  }catch(e){
    console.error('Failed to save location', e);
  }
}

async function saveCurrentLocation(){
  try{
    var info = await getMachineSnapshot();
    saveSavedLocation({x: info.x, y: info.y, z: info.z});
    updateMachineHelperUI(info);
    setFooterStatus('Current location saved.', 'good');
    var el = document.getElementById('setup-status');
    if(el){ el.textContent = 'Saved current work position.'; el.className = 'status-line good'; }
  }catch(e){
    setFooterStatus('Error: ' + e.message, 'bad');
    var el = document.getElementById('setup-status');
    if(el){ el.textContent = 'Save location failed: ' + e.message; el.className = 'status-line bad'; }
  }
}

async function goToSavedLocation(){
  try{
    var pos = loadSavedLocation();
    if(!pos) throw new Error('No saved location found');
    var cfg = getSettingsFromUI();
    await moveAbs(Number(pos.x), Number(pos.y), Number(pos.z), cfg.travelFeedRate || 600);
    setFooterStatus('Moved to saved location.', 'good');
    var info = await getMachineSnapshot();
    updateMachineHelperUI(info);
  }catch(e){
    setFooterStatus('Error: ' + e.message, 'bad');
    var el = document.getElementById('setup-status');
    if(el){ el.textContent = 'Go to saved location failed: ' + e.message; el.className = 'status-line bad'; }
  }
}

async function checkHomedStatus(){
  try{
    var info = await getMachineSnapshot();
    updateMachineHelperUI(info);
    var homedText = info.homed == null ? 'unknown' : (info.homed ? 'yes' : 'no');
    var msg = 'Machine=' + (info.status || 'Unknown') + '  Homed=' + homedText + '  Probe=' + (info.probeTriggered ? 'Triggered' : 'Open');
    var cls = String(info.status || '').toLowerCase() === 'alarm' ? 'bad' : (info.homed === false ? 'warn' : 'good');
    setFooterStatus(msg, cls);
    var el = document.getElementById('setup-status');
    if(el){ el.textContent = 'Homed check: ' + msg; el.className = 'status-line ' + cls; }
  }catch(e){
    setFooterStatus('Error: ' + e.message, 'bad');
    var el = document.getElementById('setup-status');
    if(el){ el.textContent = 'Homed check failed: ' + e.message; el.className = 'status-line bad'; }
  }
}

function _parsePos(str){
  if(!str || typeof str !== 'string') return null;
  var p = str.split(',').map(function(v){ return parseFloat(v.trim()); });
  return p.length >= 3 && p.every(function(v){ return !isNaN(v); }) ? {x:p[0], y:p[1], z:p[2]} : null;
}

async function getWorkPosition(){
  var state = await _getState();
  var ms = _machineStateFrom(state);
  var status = ms.status || 'Unknown';
  var probeTriggered = (ms.Pn || '').indexOf('P') >= 0;
  var w = _parsePos(ms.WPos);
  if(w) return {x:w.x, y:w.y, z:w.z, status: status, probeTriggered: probeTriggered};
  var m = _parsePos(ms.MPos), wco = _parsePos(ms.WCO);
  if(m && wco) return {x:m.x-wco.x, y:m.y-wco.y, z:m.z-wco.z, status: status, probeTriggered: probeTriggered};
  if(m) return {x:m.x, y:m.y, z:m.z, status: status, probeTriggered: probeTriggered};
  throw new Error('Could not read current position from ncSender');
}

async function waitForIdle(){
  pluginDebug('waitForIdle ENTER');
  var _wiStart = _smTimingEnabled ? Date.now() : 0;
  var lastStatus = '';
  var pollInterval = 15; // Start with fast polling (was 30ms)
  var pollCount = 0;
  var maxPolls = 12000; // Maintain same total timeout (~180s)
  for(var i = 0; i < maxPolls; i++){
    await sleep(pollInterval);
    pollCount++;
    // Adaptive polling: start fast, slow down after initial period to reduce CPU load
    if(pollCount === 20) pollInterval = 25;
    else if(pollCount === 100) pollInterval = 35;
    checkStop();
    var state = await _getState();
    var ms = _machineStateFrom(state);
    var status = String(ms.status || '').toLowerCase();
    if(status !== lastStatus){
      pluginDebug('waitForIdle: status changed to "' + status + '" (poll #' + i + ')');
      lastStatus = status;
    }
    if(status === 'idle'){
      pluginDebug('waitForIdle EXIT: idle confirmed after ' + pollCount + ' polls');
      if(_smTimingEnabled && smTimingStats){ smTimingStats.waitIdle.totalMs += Date.now() - _wiStart; smTimingStats.waitIdle.calls++; }
      var w = _parsePos(ms.WPos);
      if(w) return {x:w.x, y:w.y, z:w.z, status: status, probeTriggered: !!(ms.Pn && ms.Pn.indexOf('P') !== -1)};
      var m = _parsePos(ms.MPos), wco = _parsePos(ms.WCO);
      if(m && wco) return {x:m.x-wco.x, y:m.y-wco.y, z:m.z-wco.z, status: status, probeTriggered: !!(ms.Pn && ms.Pn.indexOf('P') !== -1)};
      if(m) return {x:m.x, y:m.y, z:m.z, status: status, probeTriggered: !!(ms.Pn && ms.Pn.indexOf('P') !== -1)};
      return null;
    }
    if(status === 'alarm'){ pluginDebug('waitForIdle ERROR: machine in alarm state'); throw new Error('Machine in alarm state'); }
  }
  pluginDebug('waitForIdle TIMEOUT: machine never reached idle');
  throw new Error('Timeout waiting for Idle');
}

async function waitForIdleWithTimeout(timeoutMs){
  var ms = (timeoutMs !== null && timeoutMs !== undefined) ? timeoutMs : 30000;
  return Promise.race([
    waitForIdle(),
    new Promise(function(_, reject){
      setTimeout(function(){ reject(new Error('waitForIdle timed out after ' + ms + 'ms')); }, ms);
    })
  ]);
}

// ── Movement helpers ──────────────────────────────────────────────────────────
async function moveAbs(x, y, z, feed){
  var cmd = 'G90 G1';
  if(x != null) cmd += ' X' + Number(x).toFixed(3);
  if(y != null) cmd += ' Y' + Number(y).toFixed(3);
  if(z != null) cmd += ' Z' + Number(z).toFixed(3);
  cmd += ' F' + Number(feed).toFixed(0);
  pluginDebug('moveAbs: ' + cmd);
  await sendCommand(cmd);
  // Brief delay to ensure the controller has started processing the command.
  // Without this, waitForIdleWithTimeout may return immediately if polled before
  // the machine transitions from idle to running state.
  await sleep(50);
  var pos = await waitForIdleWithTimeout();
  pluginDebug('moveAbs DONE: ' + cmd);
  return pos;
}

async function probeSafeMove(x, y, z, feed){
  if(x == null && y == null && z == null){ pluginDebug('probeSafeMove: no coordinates specified — skipping'); return await getWorkPosition(); }
  var cmd = 'G90 G38.3';
  if(x != null) cmd += ' X' + Number(x).toFixed(3);
  if(y != null) cmd += ' Y' + Number(y).toFixed(3);
  if(z != null) cmd += ' Z' + Number(z).toFixed(3);
  cmd += ' F' + Number(feed).toFixed(0);
  pluginDebug('probeSafeMove: ' + cmd);
  await sendCommand(cmd);
  // Brief delay to ensure the controller has started processing the command.
  await sleep(50);
  var pos = await waitForIdleWithTimeout();
  if(!pos) pos = await getWorkPosition();
  pluginDebug('probeSafeMove DONE: ' + cmd + ' probeTriggered=' + pos.probeTriggered);
  return pos;
}

async function moveMachineZAbs(z, feed){
  var cmd = 'G53 G1';
  if(z != null) cmd += ' Z' + Number(z).toFixed(3);
  if(feed != null && isFinite(Number(feed))) cmd += ' F' + Number(feed).toFixed(0);
  pluginDebug('moveMachineZAbs: ' + cmd);
  await sendCommand(cmd);
  // Brief delay to ensure the controller has started processing the command.
  await sleep(50);
  await waitForIdleWithTimeout();
  pluginDebug('moveMachineZAbs DONE: ' + cmd);
}

// ── Settings helpers ──────────────────────────────────────────────────────────
function _panelStorageKey(panelId) {
    return 'edgeProbePanel.' + panelId;
}

function _shouldPersistControl(el) {
    return el.dataset.noPersist !== '1';
}

function _getControlPersistValue(el) {
    return localStorage.getItem(_panelStorageKey(el.id));
}

function _setControlPersistValue(el, val) {
    localStorage.setItem(_panelStorageKey(el.id), val);
}

function savePanelSettings(panelElOrId) {
    const panelEl = typeof panelElOrId === 'string' ? document.getElementById(panelElOrId) : panelElOrId;
    const controls = panelEl.querySelectorAll('[data-persist]');
    controls.forEach(el => {
        if (_shouldPersistControl(el)) {
            _setControlPersistValue(el, el.value);
        }
    });
}

function loadPanelSettings(panelElOrId) {
    const panelEl = typeof panelElOrId === 'string' ? document.getElementById(panelElOrId) : panelElOrId;
    const controls = panelEl.querySelectorAll('[data-persist]');
    controls.forEach(el => {
        if (_shouldPersistControl(el)) {
            const value = _getControlPersistValue(el);
            if (value !== null) {
                el.value = value;
            }
        }
    });
}

function clearPanelSettings(panelElOrId) {
    const panelEl = typeof panelElOrId === 'string' ? document.getElementById(panelElOrId) : panelElOrId;
    const controls = panelEl.querySelectorAll('[data-persist]');
    controls.forEach(el => {
        if (_shouldPersistControl(el)) {
            localStorage.removeItem(_panelStorageKey(el.id));
        }
    });
}function _buildMeshData(){
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
var smMeshDataRaw = null;    // original sparse surface grid (pre-subdivision)
var smGridConfigRaw = null;  // original grid config (pre-subdivision)
var smOriginalGcode = null;
var smCompensatedGcode = null;
var smStopFlag = false;
var SM_MESH_KEY = '3dmesh.combined.mesh';
var SM_SETTINGS_KEY = '3dmesh.combined.settings';
// ── Combined Mode State ───────────────────────────────────────────────────────
var combinedMeshPoints = null; // unified array: [{x,y,z,source:'surface'|'face'}]
var _smProbingCompleteCallback = null; // set by combined mode to chain face probe after surface probe
var _smSkipFinishMotion = false; // set by combined mode to skip smFinishMotion home detour between phases
// ── Probe Sequence Recording ──────────────────────────────────────────────────
var smPvizProbeSequence = [];
var _smPvizSeqLastTime = 0;
// ── Surface Probe Timing Instrumentation ──────────────────────────────────────
// Accumulates timing/count data during a surface probing run.
// Reset by runSurfaceProbing(); read at the end to emit a [TIMING] summary.
var smTimingStats = null;
var _smTimingEnabled = false; // true only during an active surface probing run

var SM_SURFACE_GRID_SETTINGS_KEY = 'smSurfaceGridSettings';


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

var PROBE_DIM_IDS = ['probeShankDiameter','probeBodyDiameter','probeUpperHeight','probeUpperLength','probeMainBodyHeight','probeLowerLength','probeStylusLength','probeStylusCalloutLength','probeBallTipDiameter','probeTipBallDiameter','probeTotalLength'];

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
      flashButton(this);
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
    document.getElementById('sm-btn-save-mesh').addEventListener('click', function(){ flashSaveButton(this); pluginDebug('sm-btn-save-mesh clicked'); saveSurfaceMesh(); });
    document.getElementById('sm-btn-load-mesh').addEventListener('click', function(){ flashButton(this); pluginDebug('sm-btn-load-mesh clicked'); loadSurfaceMesh(); });
    document.getElementById('sm-btn-export-mesh').addEventListener('click', function(){ flashButton(this); pluginDebug('sm-btn-export-mesh clicked'); exportSurfaceMesh(); });
    document.getElementById('sm-btn-export-mesh-csv').addEventListener('click', function(){ flashButton(this); pluginDebug('sm-btn-export-mesh-csv clicked'); exportSurfaceMeshCSV(); });
    document.getElementById('sm-btn-import-mesh').addEventListener('click', function(){ flashButton(this); pluginDebug('sm-btn-import-mesh clicked'); importSurfaceMesh(); });
    document.getElementById('sm-btn-clear-mesh').addEventListener('click', function(){ flashButton(this); pluginDebug('sm-btn-clear-mesh clicked'); clearSurfaceMesh(); });
    document.getElementById('sm-btn-save-replay-html').addEventListener('click', function(){ flashSaveButton(this); pluginDebug('sm-btn-save-replay-html clicked'); smSaveReplayHtml(); });
  } catch(e){}

  // Combined mesh buttons
  try {
    document.getElementById('comb-btn-save-mesh').addEventListener('click', function(){ flashSaveButton(this); pluginDebug('comb-btn-save-mesh clicked'); saveCombinedMesh(); });
    document.getElementById('comb-btn-export-csv').addEventListener('click', function(){ flashButton(this); pluginDebug('comb-btn-export-csv clicked'); exportCombinedMeshCSV(); });
    document.getElementById('comb-btn-export-json').addEventListener('click', function(){ flashButton(this); pluginDebug('comb-btn-export-json clicked'); exportCombinedMeshJSON(); });
    document.getElementById('comb-btn-clear-mesh').addEventListener('click', function(){ flashButton(this); pluginDebug('comb-btn-clear-mesh clicked'); clearCombinedMesh(); });
    var combDataClearBtn = document.getElementById('comb-data-btn-clear');
    if (combDataClearBtn) combDataClearBtn.addEventListener('click', function(){ flashButton(this); pluginDebug('comb-data-btn-clear clicked'); clearCombinedMesh(); smLogProbe('Combined results cleared.'); });
  } catch(e){}

  // Results tab Save 3D View button
  try {
    document.getElementById('res-btn-save-3d').addEventListener('click', function(){ flashSaveButton(this); save3DViewPNG(); });
  } catch(e){}

  // Results tab Face 3D View — save and reset buttons
  try {
    var resfaceSaveBtn = document.getElementById('resface-btn-save-3d');
    if (resfaceSaveBtn) resfaceSaveBtn.addEventListener('click', function() {
      flashSaveButton(this);
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
  // Stop keyboard event propagation so the host application (ncSender/Electron)
  // cannot intercept keystrokes that belong to the focused input field.
  Array.prototype.forEach.call(document.querySelectorAll('input[type="number"]:not([readonly])'), function(el) {
    el.step = 'any';
    el.removeAttribute('min');
    el.removeAttribute('max');
    el.addEventListener('keydown',  function(e) { e.stopPropagation(); });
    el.addEventListener('keypress', function(e) { e.stopPropagation(); });
    el.addEventListener('keyup',    function(e) { e.stopPropagation(); });
  });

}

// ── Clear all probe and mesh data on plugin close/exit ────────────────────────
function pluginCleanupOnClose() {
  try {
    // Clear in-memory logs
    topLogLines = [];
    faceLogLines = [];
    // Clear in-memory probe results
    topResults = [];
    faceResults = [];
    layeredFaceResults = [];
    // Clear in-memory mesh data
    smMeshData = null;
    smGridConfig = null;
    combinedMeshPoints = null;
    // Clear persisted logs from localStorage
    localStorage.removeItem(FACE_LOG_KEY);
    // Clear persisted probe results from localStorage
    clearPersistedProbeResults();
    // Clear persisted surface mesh data from localStorage
    localStorage.removeItem(SM_MESH_KEY);
    localStorage.removeItem(MESH_STORAGE_KEY);
    // Clear persisted face mesh data from localStorage
    localStorage.removeItem(FACE_MESH_STORAGE_KEY);
    // Reset Results tab DOM to empty state
    var ut = document.getElementById('res-unified-tbody');
    if (ut) ut.innerHTML = '<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:16px;">No probe data yet</td></tr>';
    var rsp = document.getElementById('res-surface-panel');
    if (rsp) rsp.style.display = 'none';
    var rfp = document.getElementById('res-face-panel');
    if (rfp) rfp.style.display = 'none';
    var rrelief = document.getElementById('res-relief-maps-panel');
    if (rrelief) rrelief.style.display = 'none';
    // Reset Mesh Data tab — surface mesh table
    var smTbody = document.getElementById('sm-meshTableBody');
    if (smTbody) smTbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:16px;">No data yet</td></tr>';
    var smVizStatus = document.getElementById('sm-meshVizStatus');
    if (smVizStatus) smVizStatus.textContent = 'No mesh data — run a surface probe or load a mesh';
    // Reset Mesh Data tab — face mesh table
    var faceTbody = document.getElementById('face-meshTableBody');
    if (faceTbody) faceTbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:16px;">No data yet</td></tr>';
    var faceVizStatus = document.getElementById('face-meshVizStatus');
    if (faceVizStatus) faceVizStatus.textContent = 'No face mesh data — run a face probe or load face mesh';
    // Reset combined mesh panel
    var combTbody = document.getElementById('comb-mesh-tbody');
    if (combTbody) combTbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:16px;">No combined data yet</td></tr>';
  } catch(e) {}
  // Dispose Three.js resources to prevent memory leaks
  try {
    Object.keys(_threeState).forEach(function(prefix) { _threeDispose(prefix); });
  } catch(e) {}
}

window.addEventListener('beforeunload', pluginCleanupOnClose);


