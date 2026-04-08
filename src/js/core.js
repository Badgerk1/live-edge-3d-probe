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
    var ts = new Date().toLocaleTimeString('en', { hour12: false });
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

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(id){
  pluginDebug('switchTab: switching to tab "' + id + '"');
  document.querySelectorAll('.tab-panel').forEach(function(p){ p.classList.remove('active'); });
  document.querySelectorAll('.tab').forEach(function(t){ t.classList.remove('active'); });
  var panel = document.getElementById('pane-' + id);
  if(panel) panel.classList.add('active');
  // Activate matching tab button using data-tab attribute
  document.querySelectorAll('.tab').forEach(function(t){
    if(t.getAttribute('data-tab') === id) t.classList.add('active');
  });
  // Re-render relief maps when switching to their tabs (canvas needs visible width)
  if(id === 'meshdata') { setTimeout(renderSurfaceReliefMap, 60); setTimeout(renderRelief3D, 120); setTimeout(renderFaceReliefMap, 90); }
  if(id === 'results')  { setTimeout(populateSurfaceResults, 30); setTimeout(renderSurfaceReliefMap, 60); setTimeout(renderFaceReliefMap, 90); setTimeout(renderResVizMesh, 100); setTimeout(renderResFaceVizMesh, 120); }
  // Re-render probe-tab heatmap canvases when switching to probe tab
  if(id === 'top')      { setTimeout(renderSurfaceReliefMap, 60); setTimeout(renderFaceReliefMap, 90); }
  // Refresh Apply tab button states when switching to it so mesh availability is reflected
  if(id === 'apply')    { try { applyUpdateButtons(); } catch(e) {} }
  pluginDebug('switchTab: tab "' + id + '" active');
}

// ── Logging ───────────────────────────────────────────────────────────────────
function persistLogs(){
  try{
    localStorage.setItem(FACE_LOG_KEY, JSON.stringify(faceLogLines));
  }catch(e){
    console.error('Failed to persist logs', e);
  }
}

function loadPersistedLogs(){
  try{
    var savedFace = localStorage.getItem(FACE_LOG_KEY);
    faceLogLines = savedFace ? JSON.parse(savedFace) : [];
  }catch(e){
    console.error('Failed to load persisted logs', e);
    faceLogLines = [];
  }
}

function renderLog(tab){
  var el = document.getElementById(tab + '-log');
  if(!el) return;
  var lines = tab === 'face' ? faceLogLines : topLogLines;
  el.innerHTML = '';
  lines.forEach(function(line){
    var div = document.createElement('div');
    div.className = 'log-entry';
    div.textContent = line;
    el.appendChild(div);
  });
  el.scrollTop = el.scrollHeight;
}

function logLine(tab, msg){
  var el = document.getElementById(tab + '-log');
  if(!el) return;
  var ts = new Date().toLocaleTimeString('en',{hour12:false});
  var line = '[' + ts + '] ' + msg;
  var lines = tab === 'face' ? faceLogLines : topLogLines;
  lines.push(line);
  if(lines.length > 5000) lines.splice(0, lines.length - 5000);
  persistLogs();
  var div = document.createElement('div');
  div.className = 'log-entry';
  div.textContent = line;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function clearLog(tab){
  if(tab === 'face') faceLogLines = [];
  else topLogLines = [];
  persistLogs();
  renderLog(tab);
}

function saveTextFile(filename, content){
  var blob = new Blob([content], {type:'text/plain;charset=utf-8'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
}

function tsForFilename(){
  var d = new Date();
  function pad(n){ return String(n).padStart(2, '0'); }
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' + pad(d.getHours()) + '-' + pad(d.getMinutes()) + '-' + pad(d.getSeconds());
}

function getLogText(tab){
  var lines = tab === 'face' ? faceLogLines : topLogLines;
  return lines.join('\n') + (lines.length ? '\n' : '');
}

function saveLog(tab){
  var name = 'live-edge-probe_' + tab + '_log_' + tsForFilename() + '.txt';
  var body = '3D Live Edge Mesh ' + tab.toUpperCase() + ' log\n\n' + getLogText(tab);
  saveTextFile(name, body);
  setFooterStatus((tab === 'face' ? 'Face' : 'Top') + ' log saved.', 'good');
}

function buildFullLogBundle(){
  var settings = getSettingsFromUI();
  var payload = [];
  payload.push('3D Live Edge Mesh full log bundle');
  payload.push('Generated: ' + new Date().toISOString());
  payload.push('');
  payload.push('=== SETTINGS ===');
  payload.push(JSON.stringify(settings, null, 2));
  payload.push('');
  payload.push('=== TOP LOG ===');
  payload.push(getLogText('top') || '(empty)');
  payload.push('=== FACE LOG ===');
  payload.push(getLogText('face') || '(empty)');
  payload.push('=== TOP RESULTS ===');
  payload.push(JSON.stringify(topResults, null, 2));
  payload.push('');
  payload.push('=== FACE RESULTS ===');
  payload.push(JSON.stringify(faceResults, null, 2));
  payload.push('');
  payload.push('=== LAYERED FACE RESULTS ===');
  payload.push(JSON.stringify(layeredFaceResults, null, 2));
  payload.push('');
  return payload.join('\n');
}

function saveAllLogs(){
  saveTextFile('live-edge-probe_full_log_bundle_' + tsForFilename() + '.txt', buildFullLogBundle());
  setFooterStatus('Full log bundle saved.', 'good');
}

function setFooterStatus(msg, cls){
  var el = document.getElementById('footer-status');
  el.textContent = msg;
  el.className = 'status-line' + (cls ? ' ' + cls : '');
}

// ── Stop ──────────────────────────────────────────────────────────────────────
function stopAll(){
  _stopRequested = true;
  setFooterStatus('Stop requested — halting after current move…', 'warn');
}

// ── ncSender API bridge (fetch-based) ─────────────────────────────────────────
async function sendCommand(gcode, timeoutMs){
  pluginDebug('sendCommand ENTER: cmd="' + gcode + '" timeout=' + ((timeoutMs !== null && timeoutMs !== undefined) ? timeoutMs : 15000) + 'ms');
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

function updateSavedLocationUI(pos){
  if(!pos) return;
  var xEl = document.getElementById('savedLocX');
  var yEl = document.getElementById('savedLocY');
  var zEl = document.getElementById('savedLocZ');
  if(xEl) xEl.value = Number(pos.x || 0).toFixed(3);
  if(yEl) yEl.value = Number(pos.y || 0).toFixed(3);
  if(zEl) zEl.value = Number(pos.z || 0).toFixed(3);
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

  // Lift Z by at least 5mm relative from current position (contact point), then travel X/Y.
  // Using Math.max(5, clearanceZ) ensures the probe pin reliably clears even if the user
  // configured a small clearanceZ, so smEnsureProbeClear() passes through as a no-op.
  var effectiveLift = Math.max(5, clearanceZ);
  var liftCmd = 'G91 G1 Z' + effectiveLift.toFixed(3) + ' F' + travelFeed;
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

// Raise Z to a safe face-probe travel clearance height before moving between samples.
// label  — descriptive string logged to the face probe log.
// feed   — travel feed rate in mm/min; null/undefined uses travelFeedRate from settings.
// safeZ  — absolute work Z to raise to; null/undefined computes from topResults (highest
//          measured top-Z + topRetract clearance) or falls back to a relative lift of topClearZ
//          when no top results are available.
async function raiseFaceTravelSafeZ(label, feed, safeZ) {
  var s = getSettingsFromUI();
  var liftFeed = (feed != null) ? Number(feed) : (Number(s.travelFeedRate) || 600);
  var targetZ = (safeZ != null) ? safeZ : null;
  if (targetZ === null) {
    // Compute from topResults: highest measured top Z + retract clearance
    var topPts = topResults.filter(function(r){ return r.status === 'TOP'; });
    var highestZ = -Infinity;
    topPts.forEach(function(tp){ var tz = Number(tp.z); if (tz > highestZ) highestZ = tz; });
    var retractClearance = Number(s.topRetract) || 2;
    if (isFinite(highestZ)) {
      targetZ = highestZ + retractClearance;
    } else {
      // No top results available — lift relative to current position
      var curPosForLift = await getWorkPosition();
      var clearZ = Number(s.topClearZ) || 5;
      targetZ = Number(curPosForLift.z) + clearZ;
    }
  }
  logLine('face', label + ': raising Z to safe travel height ' + targetZ.toFixed(3));
  pluginDebug('raiseFaceTravelSafeZ: label=' + label + ' targetZ=' + targetZ.toFixed(3) + ' feed=' + liftFeed);
  var curPos = await getWorkPosition();
  if (Number(curPos.z) < targetZ - 0.001) {
    await moveAbs(null, null, targetZ, liftFeed);
  } else {
    pluginDebug('raiseFaceTravelSafeZ SKIP: already at/above targetZ=' + targetZ.toFixed(3));
  }
}

async function smFinishMotion(travelFeed) {
  pluginDebug('smFinishMotion ENTER: travelFeed=' + travelFeed);
  var s = getSettingsFromUI();
  var clearanceOffset = Number(s.finishHomeZ);
  var returnXYZero = !!s.returnToXYZero;
  var feed = travelFeed || s.travelFeedRate || 600; // 600 mm/min safe fallback

  // Guard: clearance offset must be a positive number.
  if (!isFinite(clearanceOffset) || clearanceOffset <= 0) {
    smLogProbe('Finish move: WARNING — finishHomeZ clearance is ' + clearanceOffset + ' (invalid or non-positive); using safe fallback of 10.0mm clearance.');
    clearanceOffset = 10.0;
  }

  // Ensure absolute positioning mode (G90) is active.
  // The preceding probe commands use G91 (relative), and some controllers
  // may not apply G90 on the same line as the movement command; sending
  // G90 separately guarantees the mode switch is complete before moveAbs.
  await sendCommand('G90');
  await waitForIdleWithTimeout();

  var pos = await getWorkPosition();
  var currentZ = Number(pos.z);

  // Compute retract Z: highest measured surface + clearance offset.
  // Fall back to currentZ + offset if no probe data is available.
  var maxSurfaceZ = (typeof getMaxMeasuredSurfaceZ === 'function') ? getMaxMeasuredSurfaceZ() : null;
  var finishZ;
  if (maxSurfaceZ !== null) {
    finishZ = maxSurfaceZ + clearanceOffset;
    smLogProbe('Finish move: highest measured surface Z=' + maxSurfaceZ.toFixed(3) + 'mm, clearance offset=' + clearanceOffset.toFixed(1) + 'mm → retracting to work Z ' + finishZ.toFixed(3));
  } else {
    finishZ = currentZ + clearanceOffset;
    smLogProbe('Finish move: no surface data available — retracting ' + clearanceOffset.toFixed(1) + 'mm above current Z=' + currentZ.toFixed(3) + ' → work Z ' + finishZ.toFixed(3));
  }

  // Z retract — always use work coordinates (G0 Z{finishZ}), never G53 machine coords.
  // Only move if finishZ is actually higher than the current position.
  var zRetractOk = false;
  if (isFinite(currentZ) && finishZ <= currentZ) {
    smLogProbe('Finish move: current work Z ' + currentZ.toFixed(3) + ' is already at or above target work Z ' + finishZ.toFixed(3) + '; no Z retract needed');
    zRetractOk = true;
  } else {
    smLogProbe('Finish move: retracting to work Z ' + finishZ.toFixed(3));
    smLogProbe('Finish move: sending G90 G1 Z' + finishZ.toFixed(3) + ' F' + feed);
    await moveAbs(null, null, finishZ, feed);
    var retractPos = await getWorkPosition();
    smLogProbe('Finish move: after retract X=' + retractPos.x.toFixed(3) + ' Y=' + retractPos.y.toFixed(3) + ' Z=' + retractPos.z.toFixed(3));
    if (Number(retractPos.z) >= finishZ - 0.5) {
      zRetractOk = true;
    } else {
      smLogProbe('Finish move: ERROR — Z retract did not reach target (got Z=' + Number(retractPos.z).toFixed(3) + ', expected >= ' + (finishZ - 0.5).toFixed(3) + '); aborting XY return to prevent collision');
    }
  }

  if (returnXYZero) {
    if (!zRetractOk) {
      smLogProbe('Finish move: skipping X/Y return — Z retract did not succeed');
    } else {
      smLogProbe('Finish move: returning to work X0.000 Y0.000');
      await moveAbs(0, 0, null, feed);
      var returnPos = await getWorkPosition();
      smLogProbe('Finish move: after return X=' + returnPos.x.toFixed(3) + ' Y=' + returnPos.y.toFixed(3) + ' Z=' + returnPos.z.toFixed(3));
    }
  } else {
    smLogProbe('Finish move: X/Y return disabled');
  }
}

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
  if (!grid || !cfg || cfg.rowCount < 2 || cfg.colCount < 2) {
    // No data — blank all surface relief canvases
    ['surface-relief-canvas', 'sm-surface-relief-canvas', 'res-surface-relief-canvas'].forEach(function(id) {
      var c = document.getElementById(id);
      if (c) { c.width = c.width; }
      var t = document.getElementById(id.replace('-canvas', '-tooltip'));
      if (t) t.textContent = 'Hover over map for values';
    });
    return;
  }
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
  if (!data || data.length < 4) {
    // No data — blank all face relief canvases
    ['face-relief-canvas', 'res-face-relief-canvas', 'surf-face-relief-canvas'].forEach(function(id) {
      var c = document.getElementById(id);
      if (c) { c.width = c.width; }
      var t = document.getElementById(id.replace('-canvas', '-tooltip'));
      if (t) t.textContent = 'Hover over map for values';
    });
    return;
  }

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
var MIN_SUBDIVISION_SPACING = 0.5;  // mm — values below this are clamped to prevent millions of points
var MAX_SUBDIVISION_POINTS  = 500000; // abort subdivision if output would exceed this many points

/**
 * subdivideSurfaceMesh(grid, cfg, spacing)
 * Densifies a surface probe grid using bilinear interpolation.
 * Returns { grid, config } with updated colCount/rowCount/colSpacing/rowSpacing.
 * spacing = target point spacing in mm (e.g. 2). 0 / falsy = no subdivision.
 */
function subdivideSurfaceMesh(grid, cfg, spacing) {
  if (!grid || !cfg || !spacing || spacing <= 0) return { grid: grid, config: cfg };
  // Safety clamp: prevent dangerously small spacing that generates millions of points
  if (spacing < MIN_SUBDIVISION_SPACING) {
    console.warn('subdivideSurfaceMesh: spacing ' + spacing + 'mm is below minimum ' + MIN_SUBDIVISION_SPACING + 'mm — clamping to ' + MIN_SUBDIVISION_SPACING + 'mm to prevent browser lockup.');
    spacing = MIN_SUBDIVISION_SPACING;
  }
  var nRows = cfg.rowCount, nCols = cfg.colCount;
  if (nRows < 2 || nCols < 2) return { grid: grid, config: cfg };

  var colSub = Math.max(1, Math.round(cfg.colSpacing / spacing));
  var rowSub = Math.max(1, Math.round(cfg.rowSpacing / spacing));
  if (colSub === 1 && rowSub === 1) return { grid: grid, config: cfg };

  var newCols = (nCols - 1) * colSub + 1;
  var newRows = (nRows - 1) * rowSub + 1;
  // Safety: abort subdivision if output would exceed MAX_SUBDIVISION_POINTS
  if (newCols * newRows > MAX_SUBDIVISION_POINTS) {
    console.warn('subdivideSurfaceMesh: would generate ' + (newCols * newRows) + ' points (>' + MAX_SUBDIVISION_POINTS + ') — skipping subdivision to prevent browser lockup.');
    return { grid: grid, config: cfg };
  }

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
  // Safety clamp: prevent dangerously small spacing that generates millions of points
  if (spacing < MIN_SUBDIVISION_SPACING) {
    console.warn('subdivideFaceMesh: spacing ' + spacing + 'mm is below minimum ' + MIN_SUBDIVISION_SPACING + 'mm — clamping to ' + MIN_SUBDIVISION_SPACING + 'mm to prevent browser lockup.');
    spacing = MIN_SUBDIVISION_SPACING;
  }

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
  // Safety: abort subdivision if output would exceed MAX_SUBDIVISION_POINTS
  if (newCols * newRows > MAX_SUBDIVISION_POINTS) {
    console.warn('subdivideFaceMesh: would generate ' + (newCols * newRows) + ' points (>' + MAX_SUBDIVISION_POINTS + ') — skipping subdivision to prevent browser lockup.');
    return pts;
  }

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
      var r00=faceWall.grid[li]&&faceWall.grid[li][xi], r10=faceWall.grid[li]&&faceWall.grid[li][xi+1];
      var r01=faceWall.grid[li+1]&&faceWall.grid[li+1][xi], r11=faceWall.grid[li+1]&&faceWall.grid[li+1][xi+1];
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
      var r00=faceWall.grid[li][xi], r10=faceWall.grid[li][xi+1];
      var r01=faceWall.grid[li+1][xi], r11=faceWall.grid[li+1][xi+1];
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
    var r0 = faceWall.grid[topLi] && faceWall.grid[topLi][xi]; if (!r0) return null;
    if (xi >= faceWall.nCols - 1) return Number(r0.z);
    var r1 = faceWall.grid[topLi] && faceWall.grid[topLi][xi + 1]; if (!r1) return Number(r0.z);
    var x0=faceWall.xs[xi], x1=faceWall.xs[xi+1], t=x1>x0?(machX-x0)/(x1-x0):0;
    return Number(r0.z)*(1-t)+Number(r1.z)*t;
  }
  function faceTopContactY(machX) {
    var xi = 0;
    while (xi < faceWall.nCols - 1 && faceWall.xs[xi + 1] <= machX) xi++;
    var r0 = faceWall.grid[topLi] && faceWall.grid[topLi][xi]; if (!r0) return cMid;
    if (xi >= faceWall.nCols - 1) return Number(r0.y);
    var r1 = faceWall.grid[topLi] && faceWall.grid[topLi][xi + 1]; if (!r1) return Number(r0.y);
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
        var r00=faceWall.grid[li]  &&faceWall.grid[li][xi];
        var r10=faceWall.grid[li]  &&faceWall.grid[li][xi+1];
        var r01=faceWall.grid[li+1]&&faceWall.grid[li+1][xi];
        var r11=faceWall.grid[li+1]&&faceWall.grid[li+1][xi+1];
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


function runSurfaceProbing() {
  pluginDebug('runSurfaceProbing ENTER');
  smStopFlag = false;
  meshSubdivisionSpacing = (function(){ var el = document.getElementById('meshSubdivisionSpacing'); return el ? Number(el.value) : meshSubdivisionSpacing; })();
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
          smLogProbe('DEBUG: contact at Z=' + pos.z.toFixed(3) + '; smSafeLateralMove will lift ' + clearanceZ.toFixed(3) + ' coords relative before next travel');
        })
        .then(function() { return probeStep(step + 1); });
    }

    return probeStep(0).then(function() {
      if (ri + 1 < cfg.rowCount) {
        var nextY = cfg.minY + (ri + 1) * cfg.rowSpacing;
        // After LTR row (even) machine is at maxX; next row (odd, RTL) starts at maxX — Y-only move
        // After RTL row (odd) machine is at minX; next row (even, LTR) starts at minX — Y-only move
        var nextStartX = reversed ? cfg.minX : cfg.maxX;
        smLogProbe('ROW TRANSITION: row ' + ri + ' done (direction: ' + (reversed ? 'RTL' : 'LTR') + '); using smSafeLateralMove to lift Z by ' + clearanceZ + ' coords relative then move to X=' + smFmtN(nextStartX) + ' Y=' + smFmtN(nextY));
        smPvizUpdate('traveling', { x: nextStartX, y: nextY, point: probed + 1, total: totalPoints, pct: probed / totalPoints * 100, action: 'Row transition...' });
        return smSafeLateralMove(nextStartX, nextY, travelFeed, clearanceZ)
          .then(function() { return smEnsureProbeClear(clearanceZ, travelFeed); });
      }
    }).then(function() { return probeRow(ri + 1); });
  }

  probeRow(0).then(function() {
    smMeshDataRaw = result;
    smGridConfigRaw = cfg;
    var subdivided = subdivideSurfaceMesh(result, cfg, meshSubdivisionSpacing);
    smMeshData = subdivided.grid;
    smGridConfig = subdivided.config;
    smSetProbeStatus('Probing complete! ' + totalPoints + ' points captured.', 'ok');
    smLogProbe('Done! Probing complete.');
    pluginDebug('runSurfaceProbing COMPLETE: ' + totalPoints + ' points captured, meshData rows=' + result.length);
    smSetProgress(100);
    // Call finish motion FIRST to minimize lag before Z retract/XY return
    var skipFinish = _smSkipFinishMotion;
    _smSkipFinishMotion = false;
    var finishPromise;
    if (!skipFinish) {
      finishPromise = smFinishMotion(travelFeed);
    } else {
      smLogProbe('COMBINED: Skipping smFinishMotion (going directly to face probe phase).');
      finishPromise = Promise.resolve();
    }
    // Defer UI updates until after finish motion completes (non-blocking)
    finishPromise.then(function() {
      smPvizUpdate('complete', { point: totalPoints, total: totalPoints, pct: 100 });
      smSaveMeshToStorage();
      try { updateSurfaceMeshUI(); } catch(vizErr) { console.warn('Surface probe: updateSurfaceMeshUI error (non-fatal):', vizErr); }
      try { populateSurfaceResults(); } catch(vizErr) { console.warn('Surface probe: populateSurfaceResults error (non-fatal):', vizErr); }
    });
    return finishPromise;
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
    smMeshDataRaw = data.meshData;
    smGridConfigRaw = data.gridConfig;
    var subdivided = subdivideSurfaceMesh(data.meshData, data.gridConfig, meshSubdivisionSpacing);
    smMeshData = subdivided.grid;
    smGridConfig = subdivided.config;
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

  // ── Probe spindle graphic (inline SVG; no external file dependency) ─────────
  // In-house design inspired by ncSender probe visual style.
  // ncSender © 2024 siganberg, GPL-3.0/Commercial dual license.
  // This asset is independently designed and not copied from ncSender source.
  var probeImg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 46 138" class="sm-probe-img" aria-label="Probe spindle">'
    + '<defs>'
    + '<linearGradient id="probeBodyGrad" x1="0%" y1="0%" x2="100%" y2="0%">'
    + '<stop offset="0%" style="stop-color:#1a3a5c"/>'
    + '<stop offset="30%" style="stop-color:#2a5a8c"/>'
    + '<stop offset="70%" style="stop-color:#2a5a8c"/>'
    + '<stop offset="100%" style="stop-color:#1a3a5c"/>'
    + '</linearGradient>'
    + '<linearGradient id="probeCollarGrad" x1="0%" y1="0%" x2="100%" y2="0%">'
    + '<stop offset="0%" style="stop-color:#3d5a7a"/>'
    + '<stop offset="50%" style="stop-color:#5a8ab8"/>'
    + '<stop offset="100%" style="stop-color:#3d5a7a"/>'
    + '</linearGradient>'
    + '<linearGradient id="probeStylusGrad" x1="0%" y1="0%" x2="100%" y2="0%">'
    + '<stop offset="0%" style="stop-color:#c0c0c0"/>'
    + '<stop offset="50%" style="stop-color:#f0f0f0"/>'
    + '<stop offset="100%" style="stop-color:#c0c0c0"/>'
    + '</linearGradient>'
    + '</defs>'
    + '<rect x="16" y="1" width="14" height="24" rx="2" fill="url(#probeCollarGrad)" stroke="#5a8ab8" stroke-width="1.5"/>'
    + '<rect x="18" y="3" width="3" height="20" rx="1" fill="rgba(120,180,220,0.25)"/>'
    + '<path d="M16 25 L8 36 L38 36 L30 25 Z" fill="url(#probeBodyGrad)" stroke="#4a7aa8" stroke-width="1.5" stroke-linejoin="round"/>'
    + '<rect x="8" y="36" width="30" height="26" rx="3" fill="url(#probeBodyGrad)" stroke="#4a7aa8" stroke-width="1.5"/>'
    + '<line x1="9" y1="46" x2="37" y2="46" stroke="#5a8ab8" stroke-width="0.8" opacity="0.5"/>'
    + '<line x1="9" y1="55" x2="37" y2="55" stroke="#5a8ab8" stroke-width="0.8" opacity="0.5"/>'
    + '<path d="M8 62 L15 72 L31 72 L38 62 Z" fill="url(#probeBodyGrad)" stroke="#4a7aa8" stroke-width="1.5" stroke-linejoin="round"/>'
    + '<rect x="15" y="72" width="16" height="30" rx="2" fill="url(#probeCollarGrad)" stroke="#5a8ab8" stroke-width="1.5"/>'
    + '<path d="M15 102 L20 110 L26 110 L31 102 Z" fill="url(#probeCollarGrad)" stroke="#5a8ab8" stroke-width="1.5" stroke-linejoin="round"/>'
    + '<rect x="21" y="110" width="4" height="20" rx="1" fill="url(#probeStylusGrad)" stroke="#a0a0a0" stroke-width="0.5"/>'
    + '<circle cx="23" cy="134" r="4" fill="#e04040" stroke="#ff6060" stroke-width="1.5"/>'
    + '<circle cx="22" cy="132.5" r="1.2" fill="rgba(255,255,255,0.5)"/>'
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
    + '#sm-pviz-probe-wrap{position:absolute;transform-style:preserve-3d;width:0;height:0;left:50%;top:50%;transition:left 25ms linear,top 25ms linear}\n'
    + '#sm-pviz-probe-shadow{position:absolute;width:18px;height:18px;border-radius:50%;margin:-9px 0 0 -9px;background:rgba(149,168,200,.18);transform:translateZ(0)}\n'
    + '#sm-pviz-probe-body{position:absolute;margin:-120px 0 0 -23px;transform:translateZ(52px);transition:transform 25ms linear;transform-style:preserve-3d;pointer-events:none}\n'
    + '#sm-pviz-probe-orient{transform-style:preserve-3d;transform:rotateZ(35deg) rotateX(-60deg)}\n'
    + '.sm-probe-img{width:46px;height:auto;display:block;transform-origin:50% 90%;filter:drop-shadow(0 6px 10px rgba(0,0,0,.45));animation:smProbeWobble 2.4s ease-in-out infinite}\n'
    + '#sm-pviz-probe-body.probe-plunging .sm-probe-img,#sm-pviz-probe-body.probe-contact .sm-probe-img{animation:none}\n'
    + '@keyframes smProbeWobble{0%,100%{transform:translateY(0) rotateZ(0deg)}30%{transform:translateY(-3px) rotateZ(1.5deg)}70%{transform:translateY(-1.5px) rotateZ(-1deg)}}\n'
    + '#sm-pviz-probe-body.probe-plunging{transform:translateY(18px) translateZ(5px)}\n'
    + '#sm-pviz-probe-body.probe-contact{transform:translateY(22px) translateZ(5px);animation:smPvizBodyGlow .55s ease-in-out 3}\n'
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
    +     '<div class="subtitle">' + SM_VERSION + ' \u00b7 Recorded probe sequence playback \u00b7 Drag to rotate</div>'
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
    +         '<div id="sm-pviz-probe-body"><div id="sm-pviz-probe-orient">' + probeImg + '</div></div>\n'
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
        smMeshDataRaw = data.meshData;
        smGridConfigRaw = data.gridConfig;
        var subdivided = subdivideSurfaceMesh(data.meshData, data.gridConfig, meshSubdivisionSpacing);
        smMeshData = subdivided.grid;
        smGridConfig = subdivided.config;
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

// ── Clear relief-map canvases visual display ──────────────────────────────────
// canvasIds: array of canvas element IDs to blank.
// clearRelief3D: when true also disposes the Three.js 3D terrain scene.
function clearReliefCanvasPanel(canvasIds, clearRelief3D) {
  (canvasIds || []).forEach(function(id) {
    var c = document.getElementById(id);
    if (c) { c.width = c.width; } // resets canvas content to blank
    var tid = id.replace('-canvas', '-tooltip');
    var t = document.getElementById(tid);
    if (t) t.textContent = 'Hover over map for values';
  });
  if (clearRelief3D) {
    try { _threeDispose('relief'); } catch(e) {}
    var surface = document.getElementById('relief-3d-surface');
    if (surface) surface.innerHTML = '';
  }
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
    var isMove = /^(?:N\d+\s+)?G[01]\b/i.test(line) || /\b[XYZ][-\d.]/i.test(line);
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

// ── Apply Tab — G-code loading, compensation, download ────────────────────────

var applyOriginalGcode = null;       // loaded G-code text for Apply tab
var applySurfaceCompGcode = null;    // compensated surface G-code
var applyFaceCompGcode = null;       // compensated face G-code
var PLUGIN_ID = 'com.ncsender.edgeprobe.combined';

function applyLogSurface(msg) {
  var el = document.getElementById('apply-surface-log');
  if (!el) return;
  el.style.display = 'block';
  var ts = new Date().toTimeString().slice(0, 8);
  var line = document.createElement('div');
  line.textContent = '[' + ts + '] ' + msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function applyLogFace(msg) {
  var el = document.getElementById('apply-face-log');
  if (!el) return;
  el.style.display = 'block';
  var ts = new Date().toTimeString().slice(0, 8);
  var line = document.createElement('div');
  line.textContent = '[' + ts + '] ' + msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function applyUpdateButtons() {
  var hasGcode = !!applyOriginalGcode;
  var hasSurfaceMesh = !!smMeshData && !!smGridConfig;
  var hasFaceMesh = (typeof getFaceMeshData === 'function') && !!getFaceMeshData();

  var surfaceBtn = document.getElementById('apply-btn-surface-comp');
  if (surfaceBtn) surfaceBtn.disabled = !(hasGcode && hasSurfaceMesh);

  var faceBtn = document.getElementById('apply-btn-face-comp');
  if (faceBtn) faceBtn.disabled = !(hasGcode && hasFaceMesh);

  var dlSurface = document.getElementById('apply-btn-download-surface');
  if (dlSurface) dlSurface.disabled = !applySurfaceCompGcode;

  var sendSurface = document.getElementById('apply-btn-send-ncsender-surface');
  if (sendSurface) sendSurface.disabled = !applySurfaceCompGcode;

  var dlFace = document.getElementById('apply-btn-download-face');
  if (dlFace) dlFace.disabled = !applyFaceCompGcode;

  var sendFace = document.getElementById('apply-btn-send-ncsender-face');
  if (sendFace) sendFace.disabled = !applyFaceCompGcode;
}

async function applyLoadGcodeFromNcSender() {
  var statusEl = document.getElementById('apply-gcode-status');
  try {
    // Try /api/gcode-files/current to get loaded G-code content
    var r = await fetch('/api/gcode-files/current');
    if (r.ok) {
      var data = await r.json();
      if (data && data.content) {
        applyOriginalGcode = data.content;
        var lines = applyOriginalGcode.split('\n').length;
        if (statusEl) statusEl.textContent = 'Loaded from ncSender: ' + lines + ' lines' + (data.filename ? ' (' + data.filename + ')' : '');
        statusEl.className = 'status-line good';
        applyUpdateButtons();
        return;
      }
    }
    // Fallback: try fetching from cache file path
    var r2 = await fetch('/api/server-state');
    if (r2.ok) {
      var state = await r2.json();
      var filename = state?.jobLoaded?.filename;
      if (filename) {
        // Try to get the file content via gcode-files endpoint
        var r3 = await fetch('/api/gcode-files/' + encodeURIComponent(filename) + '/content');
        if (r3.ok) {
          applyOriginalGcode = await r3.text();
          var lines = applyOriginalGcode.split('\n').length;
          if (statusEl) statusEl.textContent = 'Loaded: ' + filename + ' (' + lines + ' lines)';
          statusEl.className = 'status-line good';
          applyUpdateButtons();
          return;
        }
      }
    }
    if (statusEl) { statusEl.textContent = 'No G-code loaded in ncSender. Load a file first.'; statusEl.className = 'status-line warn'; }
  } catch(e) {
    if (statusEl) { statusEl.textContent = 'Error loading from ncSender: ' + e.message; statusEl.className = 'status-line bad'; }
  }
}

async function applyAnalyzeGcodeBounds() {
  if (!applyOriginalGcode) { alert('Load G-code first.'); return; }
  var boundsEl = document.getElementById('apply-gcode-bounds-info');
  // Client-side bounds analysis (same algorithm as server)
  var bounds = { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };
  var currentX = 0, currentY = 0, currentZ = 0;
  var isAbsolute = true;
  var lines = applyOriginalGcode.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var trimmed = lines[i].trim().toUpperCase();
    if (trimmed.startsWith('(') || trimmed.startsWith(';') || trimmed.startsWith('%')) continue;
    if (trimmed.indexOf('G90') >= 0 && trimmed.indexOf('G90.1') < 0) isAbsolute = true;
    if (trimmed.indexOf('G91') >= 0 && trimmed.indexOf('G91.1') < 0) isAbsolute = false;
    if (trimmed.indexOf('G53') >= 0) continue;
    var xM = trimmed.match(/X([+-]?\d*\.?\d+)/);
    var yM = trimmed.match(/Y([+-]?\d*\.?\d+)/);
    var zM = trimmed.match(/Z([+-]?\d*\.?\d+)/);
    if (xM) { var v = parseFloat(xM[1]); currentX = isAbsolute ? v : currentX + v; }
    if (yM) { var v2 = parseFloat(yM[1]); currentY = isAbsolute ? v2 : currentY + v2; }
    if (zM) { var v3 = parseFloat(zM[1]); currentZ = isAbsolute ? v3 : currentZ + v3; }
    if (xM || yM || zM) {
      bounds.min.x = Math.min(bounds.min.x, currentX);
      bounds.min.y = Math.min(bounds.min.y, currentY);
      bounds.min.z = Math.min(bounds.min.z, currentZ);
      bounds.max.x = Math.max(bounds.max.x, currentX);
      bounds.max.y = Math.max(bounds.max.y, currentY);
      bounds.max.z = Math.max(bounds.max.z, currentZ);
    }
  }
  if (bounds.min.x === Infinity) bounds.min.x = 0;
  if (bounds.min.y === Infinity) bounds.min.y = 0;
  if (bounds.min.z === Infinity) bounds.min.z = 0;
  if (bounds.max.x === -Infinity) bounds.max.x = 0;
  if (bounds.max.y === -Infinity) bounds.max.y = 0;
  if (bounds.max.z === -Infinity) bounds.max.z = 0;

  if (boundsEl) {
    boundsEl.style.display = 'block';
    boundsEl.innerHTML = '<strong>G-code Bounds:</strong> ' +
      'X: ' + bounds.min.x.toFixed(2) + ' to ' + bounds.max.x.toFixed(2) +
      ' &nbsp;|&nbsp; Y: ' + bounds.min.y.toFixed(2) + ' to ' + bounds.max.y.toFixed(2) +
      ' &nbsp;|&nbsp; Z: ' + bounds.min.z.toFixed(2) + ' to ' + bounds.max.z.toFixed(2) +
      ' &nbsp;|&nbsp; Size: ' + (bounds.max.x - bounds.min.x).toFixed(2) + ' &times; ' + (bounds.max.y - bounds.min.y).toFixed(2) + ' coords';
  }
}

// Apply surface compensation — uses move subdivision for smooth surface following
function applyServerSurfaceCompensation() {
  if (!applyOriginalGcode) { alert('Load G-code first.'); return; }
  if (!smMeshData || !smGridConfig) { alert('No surface mesh data. Run probing or load a mesh first.'); return; }

  var refZ = Number(document.getElementById('apply-refZ').value) || 0;
  var subdivide = document.getElementById('apply-subdivide').checked;
  var statusEl = document.getElementById('apply-surface-status');
  var surfLogEl = document.getElementById('apply-surface-log');
  if (surfLogEl) surfLogEl.innerHTML = '';

  applyLogSurface('Applying surface Z compensation (Reference Z=' + refZ + ', Subdivide=' + subdivide + ')...');

  if (subdivide) {
    // Use subdivision compensation — same algorithm as server-side applyZCompensation
    try {
      var result = applySubdividedCompensation(applyOriginalGcode, smMeshData, smGridConfig, refZ);
      applySurfaceCompGcode = result.gcode;
      applyLogSurface('Done! ' + result.modified + ' moves processed, ' + result.segments + ' segments generated.');
      if (statusEl) { statusEl.textContent = 'Compensation applied: ' + result.modified + ' moves, ' + result.segments + ' segments (subdivided).'; statusEl.className = 'status-line good'; }
      applyUpdatePreview(applySurfaceCompGcode);
      applyUpdateButtons();
    } catch(e) {
      applyLogSurface('ERROR: ' + e.message);
      if (statusEl) { statusEl.textContent = 'Error: ' + e.message; statusEl.className = 'status-line bad'; }
    }
  } else {
    // Use simple compensation (existing smApplyCompensationCore)
    try {
      var result = smApplyCompensationCore(applyOriginalGcode, smMeshData, smGridConfig, refZ);
      applySurfaceCompGcode = result.gcode;
      applyLogSurface('Done! ' + result.modified + ' Z values modified.');
      if (statusEl) { statusEl.textContent = 'Compensation applied: ' + result.modified + ' Z values modified.'; statusEl.className = 'status-line good'; }
      applyUpdatePreview(applySurfaceCompGcode);
      applyUpdateButtons();
    } catch(e) {
      applyLogSurface('ERROR: ' + e.message);
      if (statusEl) { statusEl.textContent = 'Error: ' + e.message; statusEl.className = 'status-line bad'; }
    }
  }
}

// Client-side subdivided Z compensation (mirrors server-side applyZCompensation)
function applySubdividedCompensation(gcodeText, meshData, gridCfg, referenceZ) {
  var lines = gcodeText.split('\n');
  var output = [];
  var currentX = 0, currentY = 0, currentZ = 0;
  var isAbsolute = true;
  var currentFeedRate = null;
  var currentGMode = 'G1';
  var movesProcessed = 0;
  var totalSegments = 0;

  // When grid has only 1 column or 1 row, spacing is zero (all points at same position)
  var spacingX = gridCfg.colSpacing || (gridCfg.colCount > 1 ? (gridCfg.maxX - gridCfg.minX) / (gridCfg.colCount - 1) : 0);
  var spacingY = gridCfg.rowSpacing || (gridCfg.rowCount > 1 ? (gridCfg.maxY - gridCfg.minY) / (gridCfg.rowCount - 1) : 0);
  var segmentLength = Math.min(spacingX || 10, spacingY || 10, 2);

  output.push('(Z-Compensated G-code - 3D Live Edge Mesh Combined Plugin)');
  output.push('(Grid: ' + gridCfg.colCount + ' x ' + gridCfg.rowCount + ' points)');
  output.push('(Reference Z: ' + referenceZ.toFixed(3) + ')');
  output.push('(Segment length: ' + segmentLength.toFixed(2) + ' coords)');
  output.push('');

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.trim().toUpperCase();

    if (!trimmed || trimmed.startsWith('(') || trimmed.startsWith(';') || trimmed.startsWith('%')) {
      output.push(line);
      continue;
    }

    if (trimmed.indexOf('G90') >= 0 && trimmed.indexOf('G90.1') < 0) isAbsolute = true;
    if (trimmed.indexOf('G91') >= 0 && trimmed.indexOf('G91.1') < 0) isAbsolute = false;

    if (trimmed.indexOf('G53') >= 0) { output.push(line); continue; }

    if (/^G0\b/.test(trimmed) || trimmed.indexOf(' G0 ') >= 0 || / G0$/.test(trimmed)) currentGMode = 'G0';
    if (/^G1\b/.test(trimmed) || trimmed.indexOf(' G1 ') >= 0 || / G1$/.test(trimmed)) currentGMode = 'G1';
    if (/^G2\b/.test(trimmed) || trimmed.indexOf(' G2 ') >= 0) currentGMode = 'G2';
    if (/^G3\b/.test(trimmed) || trimmed.indexOf(' G3 ') >= 0) currentGMode = 'G3';

    var xMatch = line.match(/X([+-]?\d*\.?\d+)/i);
    var yMatch = line.match(/Y([+-]?\d*\.?\d+)/i);
    var zMatch = line.match(/Z([+-]?\d*\.?\d+)/i);
    var fMatch = line.match(/F([+-]?\d*\.?\d+)/i);

    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    var targetX = currentX, targetY = currentY, targetZ = currentZ;
    if (xMatch) targetX = isAbsolute ? parseFloat(xMatch[1]) : currentX + parseFloat(xMatch[1]);
    if (yMatch) targetY = isAbsolute ? parseFloat(yMatch[1]) : currentY + parseFloat(yMatch[1]);
    if (zMatch) targetZ = isAbsolute ? parseFloat(zMatch[1]) : currentZ + parseFloat(zMatch[1]);

    var isLinearMove = (currentGMode === 'G1');
    var isRapidMove = (currentGMode === 'G0');
    var hasXY = !!(xMatch || yMatch);
    var hasZ = zMatch !== null;

    if (isLinearMove && hasXY && isAbsolute) {
      var dx = targetX - currentX;
      var dy = targetY - currentY;
      var distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > segmentLength) {
        var segments = Math.ceil(distance / segmentLength);
        var dz = targetZ - currentZ;

        for (var s = 1; s <= segments; s++) {
          var t = s / segments;
          var segX = currentX + dx * t;
          var segY = currentY + dy * t;
          var segZ = currentZ + dz * t;

          var meshZ = bilinearInterpolateZ(meshData, gridCfg, segX, segY);
          var zOffset = meshZ - referenceZ;
          var compensatedZ = segZ + zOffset;

          var segCmd = 'G1 X' + segX.toFixed(3) + ' Y' + segY.toFixed(3) + ' Z' + compensatedZ.toFixed(3);
          if (s === 1 && currentFeedRate) segCmd += ' F' + currentFeedRate.toFixed(0);
          output.push(segCmd);
          totalSegments++;
        }
        movesProcessed++;
      } else {
        var meshZ2 = bilinearInterpolateZ(meshData, gridCfg, targetX, targetY);
        var zOffset2 = meshZ2 - referenceZ;
        var compensatedZ2 = targetZ + zOffset2;

        if (hasZ) {
          output.push(line.replace(/Z([+-]?\d*\.?\d+)/i, 'Z' + compensatedZ2.toFixed(3)));
        } else {
          var newLine = line.trim();
          if (currentFeedRate && /F[\d.]+/i.test(newLine)) {
            newLine = newLine.replace(/(F[\d.]+)/i, 'Z' + compensatedZ2.toFixed(3) + ' $1');
          } else {
            newLine += ' Z' + compensatedZ2.toFixed(3);
          }
          output.push(newLine);
        }
        movesProcessed++;
        totalSegments++;
      }
    } else if (isRapidMove && hasXY && isAbsolute) {
      var meshZ3 = bilinearInterpolateZ(meshData, gridCfg, targetX, targetY);
      var zOffset3 = meshZ3 - referenceZ;
      var compensatedZ3 = targetZ + zOffset3;

      if (hasZ) {
        output.push(line.replace(/Z([+-]?\d*\.?\d+)/i, 'Z' + compensatedZ3.toFixed(3)));
      } else {
        // Only add Z to rapid moves at working height (below safe retract threshold of 10 coords)
        if (currentZ < 10) {
          output.push(line.trim() + ' Z' + compensatedZ3.toFixed(3));
        } else {
          output.push(line);
        }
      }
      movesProcessed++;
    } else if (hasZ && isAbsolute) {
      var meshZ4 = bilinearInterpolateZ(meshData, gridCfg, targetX, targetY);
      var zOffset4 = meshZ4 - referenceZ;
      var compensatedZ4 = targetZ + zOffset4;
      output.push(line.replace(/Z([+-]?\d*\.?\d+)/i, 'Z' + compensatedZ4.toFixed(3)));
      movesProcessed++;
    } else {
      output.push(line);
    }

    currentX = targetX;
    currentY = targetY;
    currentZ = targetZ;
  }

  return { gcode: output.join('\n'), modified: movesProcessed, segments: totalSegments };
}

function autoCalcFaceRefPos() {
  var faceData = (typeof getFaceMeshData === 'function') ? getFaceMeshData() : null;
  if (!faceData || !faceData.length) {
    alert('No face mesh data available. Run a face probe or import face mesh data first.');
    return;
  }
  var axis = (document.getElementById('apply-face-axis').value || 'Y').toUpperCase();
  var values = [];
  for (var i = 0; i < faceData.length; i++) {
    var val = axis === 'X' ? Number(faceData[i].x) : Number(faceData[i].y);
    if (!isNaN(val)) values.push(val);
  }
  if (!values.length) {
    alert('No valid contact values found in face mesh data.');
    return;
  }
  var sum = 0;
  var mn = values[0], mx = values[0];
  for (var j = 0; j < values.length; j++) {
    sum += values[j];
    if (values[j] < mn) mn = values[j];
    if (values[j] > mx) mx = values[j];
  }
  var mean = sum / values.length;
  var rounded = Math.round(mean * 1000) / 1000;

  var refEl = document.getElementById('apply-face-refPos');
  if (refEl) refEl.value = rounded;

  var statsEl = document.getElementById('apply-face-refPos-stats');
  if (statsEl) {
    statsEl.textContent = 'Mean: ' + rounded.toFixed(3) + ' | Min: ' + mn.toFixed(3) +
      ' | Max: ' + mx.toFixed(3) + ' | ' + values.length + ' points';
  }

  var statusEl = document.getElementById('apply-face-status');
  if (statusEl) {
    statusEl.textContent = 'Auto-calculated reference: ' + rounded.toFixed(3) +
      ' (' + axis + '-axis mean across ' + values.length + ' face contacts)';
    statusEl.className = 'status-line good';
  }
}

function applyFaceCompensationFromTab() {
  if (!applyOriginalGcode) { alert('Load G-code first.'); return; }
  var faceData = (typeof getFaceMeshData === 'function') ? getFaceMeshData() : null;
  if (!faceData) { alert('No face mesh data. Run face probing first.'); return; }

  var refPos = Number(document.getElementById('apply-face-refPos').value) || 0;
  var axis = (document.getElementById('apply-face-axis').value || 'Y').toUpperCase();
  var uniformChk = document.getElementById('apply-face-uniform');
  var uniformOffset = uniformChk ? uniformChk.checked : true;
  var statusEl = document.getElementById('apply-face-status');
  var faceLogEl = document.getElementById('apply-face-log');
  if (faceLogEl) faceLogEl.innerHTML = '';

  // Validation: warn if refPos is far from mean contact value
  var contactValues = [];
  for (var ci = 0; ci < faceData.length; ci++) {
    var cv = axis === 'X' ? Number(faceData[ci].x) : Number(faceData[ci].y);
    if (!isNaN(cv)) contactValues.push(cv);
  }
  if (contactValues.length) {
    var contactSum = 0;
    for (var cj = 0; cj < contactValues.length; cj++) contactSum += contactValues[cj];
    var contactMean = contactSum / contactValues.length;
    if (Math.abs(contactMean - refPos) > 5) {
      var warnMsg = 'Warning: Reference Face Position (' + refPos + ') is far from the average face contact position (' +
        contactMean.toFixed(3) + ').\n\nThis will cause large bulk shifts in your G-code. ' +
        'Use \u21BB Auto from mesh to set the recommended value, or verify your reference is correct.\n\nProceed anyway?';
      if (!confirm(warnMsg)) return;
    }
  }

  applyLogFace('Applying face compensation (axis=' + axis + ', refPos=' + refPos + ', uniform=' + uniformOffset + ')...');

  try {
    if (typeof faceApplyCompensationCore !== 'function') {
      throw new Error('Face compensation core function not available');
    }
    var result = faceApplyCompensationCore(applyOriginalGcode, faceData, refPos, axis, uniformOffset);
    applyFaceCompGcode = result.gcode;
    applyLogFace('Done! ' + result.modified + ' ' + axis + ' values adjusted, ' + (result.segments || 0) + ' segments generated.');
    if (statusEl) { statusEl.textContent = 'Face compensation applied: ' + result.modified + ' values adjusted, ' + (result.segments || 0) + ' segments.'; statusEl.className = 'status-line good'; }
    applyUpdatePreview(applyFaceCompGcode);
    applyUpdateButtons();
  } catch(e) {
    applyLogFace('ERROR: ' + e.message);
    if (statusEl) { statusEl.textContent = 'Error: ' + e.message; statusEl.className = 'status-line bad'; }
  }
}

function applyUpdatePreview(gcodeText) {
  var el = document.getElementById('apply-preview');
  if (!el || !gcodeText) return;
  el.textContent = gcodeText.split('\n').slice(0, 40).join('\n');
  if (gcodeText.split('\n').length > 40) {
    el.textContent += '\n... (' + gcodeText.split('\n').length + ' total lines)';
  }
}

function applyDownloadCompensatedGcode(type) {
  var gcode = (type === 'face') ? applyFaceCompGcode : applySurfaceCompGcode;
  if (!gcode) { alert('No compensated G-code. Apply compensation first.'); return; }
  var blob = new Blob([gcode], { type: 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'compensated_' + type + '_' + Date.now() + '.nc';
  a.click();
}

async function applySendToNcSender(type) {
  var gcode = (type === 'face') ? applyFaceCompGcode : applySurfaceCompGcode;
  if (!gcode) { alert('No compensated G-code. Apply compensation first.'); return; }
  await sendCompToNcSender(gcode, 'compensated_' + type);
}

var SM_SURFACE_GRID_SETTINGS_KEY = 'smSurfaceGridSettings';

async function probeAbsAxis(axis, target, feed, skipClearCheck){
    axis = String(axis || '').toUpperCase();
    if(axis !== 'X' && axis !== 'Y') throw new Error('Unsupported face probe axis');
    // Verify probe pin is clear before issuing G38.2; GRBL requires probe to be open to start a probe cycle.
    // Skip this check when the caller knows the probe is already clear (e.g. after a retract move).
    if(!skipClearCheck){
      var maxClearAttempts = 3;
      for (var clearAttempt = 0; clearAttempt <= maxClearAttempts; clearAttempt++) {
        var triggered = await smGetProbeTriggered();
        if (!triggered) break;
        if (clearAttempt >= maxClearAttempts) {
          throw new Error('Probe input stuck triggered after ' + maxClearAttempts + ' clearing attempts before face probe ' + axis + '; aborting');
        }
        logLine('face', 'Face probe: probe pin still triggered before G38.2 on ' + axis + ' (attempt ' + (clearAttempt + 1) + '/' + maxClearAttempts + '); backing off 2mm to clear...');
        var pos = await getWorkPosition();
        var curAxisPos = axis === 'X' ? Number(pos.x) : Number(pos.y);
        var probeDir = Number(target) >= curAxisPos ? 1 : -1;
        var backoffPos = curAxisPos - probeDir * 2;
        await sendCommand('G90 G1 ' + axis + backoffPos.toFixed(3) + ' F' + Number(s && (s.faceRetractFeed || s.travelFeedRate) || 1000).toFixed(0));
        await waitForIdleWithTimeout();
        await smSleep(80);
      }
    }
    await sendCommand('G90 G38.2 ' + axis + Number(target).toFixed(3) + ' F' + Number(feed).toFixed(0));
    var probePos = await waitForIdleWithTimeout();
    return probePos || await getWorkPosition();
  }

async function _clearTriggeredProbeByBackingOffGeneric(tab, currentPos, unitX, unitY, s, state){
    var backoff = Math.max(0.1, Number(s.travelContactBackoff) || 5);
    var lift = Math.max(0.1, Number(s.travelContactLift) || Number(s.topRetract) || 5);
    var maxRetries = Math.max(1, Math.round(Number(s.travelContactMaxRetries) || 5));
    if(state.recoveries >= maxRetries){
      throw new Error('Travel path blocked after ' + maxRetries + ' contact recoveries (max added lift ' + (maxRetries * lift).toFixed(3) + ' coords). Raise starting Z or reposition the work.');
    }
    state.recoveries += 1;
    state.totalLift += lift;
    var pos = currentPos;
    var backX = pos.x - unitX * backoff;
    var backY = pos.y - unitY * backoff;
    var liftZ = pos.z + lift;
    logLine(tab, 'TRAVEL CONTACT: recovery ' + state.recoveries + '/' + maxRetries + ' backoff to X=' + Number(backX).toFixed(3) + ' Y=' + Number(backY).toFixed(3) + ' at F' + Number(s.travelRecoveryFeedRate || s.travelFeedRate).toFixed(0) + ', then lift Z to ' + Number(liftZ).toFixed(3) + ' at F' + Number(s.travelRecoveryLiftFeedRate || s.travelRecoveryFeedRate || s.travelFeedRate).toFixed(0) + ' (cumulative added lift ' + Number(state.totalLift).toFixed(3) + ' coords).');
    await moveAbs(backX, backY, null, s.travelRecoveryFeedRate || s.travelFeedRate);
    await moveAbs(null, null, liftZ, s.travelRecoveryLiftFeedRate || s.travelRecoveryFeedRate || s.travelFeedRate);
    await sleep(50);
    pos = await getWorkPosition();
    if(pos.probeTriggered){
      logLine(tab, 'TRAVEL CONTACT WARNING: probe is still triggered after recovery ' + state.recoveries + '/' + maxRetries + '.');
    }
    return pos;
  }

// Build a standardised face-probe contact record for storage in faceResults.
// n              — sequential record number (1-based)
// pos            — position object returned by probeAbsAxis / moveAbs / getWorkPosition
//                  ({x, y, z, machineZ, probeTriggered})
// axis           — probe axis ('X' or 'Y')
// status         — status tag, e.g. 'FACE Y', 'FACE Y MISS', 'EARLY_CONTACT_...'
// targetCoord    — intended target coordinate on the probe axis
// sampleLineCoord — coordinate on the perpendicular (sampled) axis for this line
function makeFaceContactRecord(n, pos, axis, status, targetCoord, sampleLineCoord) {
  return {
    type: 'face',
    n: n,
    axis: axis,
    status: status,
    x: Number(pos.x),
    y: Number(pos.y),
    z: Number(pos.z),
    machineZ: (pos.machineZ != null) ? Number(pos.machineZ) : null,
    targetCoord: Number(targetCoord),
    sampleCoord: Number(sampleLineCoord)
  };
}

async function segmentedFaceMoveWithRecovery(axis, targetCoord, fixedCoord, probeZ, s, mode, sampleLineCoord, skipClearCheck){
  axis = String(axis || 'X').toUpperCase();
  mode = String(mode || 'to_start').toLowerCase();
  var stepLen = Math.max(0.2, Number(s.travelContactStep) || 5);
  if(mode !== 'to_start'){
    stepLen = Math.min(stepLen, 5);
  }
  var extras = [];
  var pos = await getWorkPosition();
  var recoveryState = {recoveries: 0, totalLift: 0};
  var maxRetries = Math.max(1, Math.round(Number(s.travelContactMaxRetries) || 5));
  var fixedX = axis === 'X' ? null : Number(fixedCoord);
  var fixedY = axis === 'X' ? Number(fixedCoord) : null;
  var label = mode === 'to_start' ? 'FACE REPOSITION' : 'FACE PROBE';

  if(mode === 'to_start'){
    if(pos.probeTriggered){
      logLine('face', 'FACE REPOSITION: probe already triggered before smooth move to start. Switching directly to recovery mode.');
    } else {
      logLine('face', 'FACE REPOSITION: smooth move toward ' + axis + ' ' + Number(targetCoord).toFixed(3) + ' before probing.');
      var smoothX = axis === 'X' ? Number(targetCoord) : fixedX;
      var smoothY = axis === 'X' ? fixedY : Number(targetCoord);
      pos = await moveAbs(smoothX, smoothY, null, s.travelFeedRate) || await getWorkPosition();
      if(!pos.probeTriggered){
        return {position: pos, extras: extras, contact: null, reachedTarget: true};
      }
      logLine('face', 'FACE REPOSITION: probe was triggered at end of smooth move. Entering segmented recovery to clear path to start.');
    }
  }

  var moveFeed = mode === 'to_start' ? Number(s.travelFeedRate) : Number(s.faceFeed || s.topFeed || s.travelFeedRate);

  if(mode !== 'to_start'){
    logLine('face', 'FACE PROBE: smooth probe move toward ' + axis + ' ' + Number(targetCoord).toFixed(3) + ' at feed ' + moveFeed.toFixed(0) + ' mm/min.');
    var probePos = await probeAbsAxis(axis, Number(targetCoord), moveFeed, skipClearCheck);
    if(probePos.probeTriggered){
      var hit = makeFaceContactRecord(faceResults.length + extras.length + 1, probePos, axis, 'FACE ' + axis, targetCoord, sampleLineCoord);
      extras.push(hit);
      logLine('face', 'FACE CONTACT: first forward contact at ' + axis + '=' + Number(axis === 'X' ? probePos.x : probePos.y).toFixed(3) + ' on sample line ' + Number(sampleLineCoord).toFixed(3) + '. Stopping this face sample.');
      return {position: probePos, extras: extras, contact: probePos, reachedTarget: false};
    }
    logLine('face', 'FACE PROBE: reached target ' + axis + ' ' + Number(targetCoord).toFixed(3) + ' without contact.');
    return {position: probePos, extras: extras, contact: null, reachedTarget: true};
  }

  logLine('face', label + ': segmented move toward ' + axis + ' ' + Number(targetCoord).toFixed(3) + ' (step ' + stepLen.toFixed(3) + ' coords, feed ' + moveFeed.toFixed(0) + ' mm/min).');

  for(var guard = 0; guard < 4000; guard++){
    checkStop();
    var axisPos = axis === 'X' ? Number(pos.x) : Number(pos.y);
    var remaining = Number(targetCoord) - axisPos;
    if(Math.abs(remaining) <= 0.02){
      return {position: pos, extras: extras, contact: null, reachedTarget: true};
    }

    var dir = remaining >= 0 ? 1 : -1;
    var moveLen = Math.min(stepLen, Math.abs(remaining));
    var nextCoord = axisPos + dir * moveLen;
    var nextX = axis === 'X' ? nextCoord : fixedX;
    var nextY = axis === 'X' ? fixedY : nextCoord;

    pos = await moveAbs(nextX, nextY, null, (typeof moveFeed !== 'undefined' ? moveFeed : Number(s.travelFeedRate || 600))) || await getWorkPosition();

    if(pos.probeTriggered){
      var status = mode === 'to_start' ? 'EARLY_CONTACT_FACE_REPOSITION_' + axis : 'FACE ' + axis;
      var extra = makeFaceContactRecord(faceResults.length + extras.length + 1, pos, axis, status, targetCoord, sampleLineCoord);
      extras.push(extra);

      if(mode !== 'to_start'){
        logLine('face', 'FACE CONTACT: first forward contact at ' + axis + '=' + Number(axis === 'X' ? pos.x : pos.y).toFixed(3) + ' on sample line ' + Number(sampleLineCoord).toFixed(3) + '. Stopping this face sample.');
        return {position: pos, extras: extras, contact: pos, reachedTarget: false};
      }

      logLine('face', 'FACE REPOSITION CONTACT: recorded extra point at ' + axis + '=' + Number(axis === 'X' ? pos.x : pos.y).toFixed(3) + ' Z=' + Number(pos.z).toFixed(3) + '. Backing off and lifting before continuing to start.');
      var unitX = axis === 'X' ? dir : 0;
      var unitY = axis === 'Y' ? dir : 0;
      pos = await _clearTriggeredProbeByBackingOffGeneric('face', pos, unitX, unitY, s, recoveryState);
      await smSleep(80);
      if(pos.probeTriggered && recoveryState.recoveries >= maxRetries){
        throw new Error('Face reposition path blocked after ' + maxRetries + ' contact recoveries (max added lift ' + Number(recoveryState.totalLift).toFixed(3) + ' coords). Raise starting Z or reposition the work.');
      }
      if(Number(pos.z) > Number(probeZ) + 0.001){
        logLine('face', 'FACE REPOSITION RECOVERY: lowering back to face probe Z ' + Number(probeZ).toFixed(3) + ' at F' + Number(s.travelRecoveryLiftFeedRate || s.travelRecoveryFeedRate || s.travelFeedRate).toFixed(0));
        await moveAbs(null, null, Number(probeZ), s.travelRecoveryLiftFeedRate || s.travelRecoveryFeedRate || s.travelFeedRate);
        pos = await getWorkPosition();
        if(pos.probeTriggered){
          var downExtra = makeFaceContactRecord(faceResults.length + extras.length + 1, pos, axis, 'EARLY_CONTACT_FACE_Z_RESET_' + axis, targetCoord, sampleLineCoord);
          extras.push(downExtra);
          logLine('face', 'FACE REPOSITION CONTACT: probe re-triggered while returning to face probe Z. Backing off and lifting again.');
          pos = await _clearTriggeredProbeByBackingOffGeneric('face', pos, unitX, unitY, s, recoveryState);
          await smSleep(80);
        }
      }
    }
  }
  throw new Error('Segmented face move exceeded safety iteration limit while moving on axis ' + axis + '.');
}


// ── runFaceProbe ──────────────────────────────────────────────────────────────
async function runFaceProbe(axis, _calledFromCombined){
  pluginDebug('runFaceProbe ENTER: axis=' + axis);
  if(_running){ logLine('face','Face probe skipped: another operation is still running.'); pluginDebug('runFaceProbe SKIP: _running=true'); setFooterStatus('Already running', 'warn'); return; }
  if(!validateSettings()){ logLine('face','Face probe skipped: settings validation failed — check Setup tab for warnings.'); pluginDebug('runFaceProbe SKIP: settings validation failed'); return; }
  _running = true; _stopRequested = false;
  axis = String(axis || 'X').toUpperCase();
  document.getElementById('btn-stop-face').disabled = false;
  document.getElementById('btn-face-x').disabled = true;
  document.getElementById('btn-face-y').disabled = true;
  setFooterStatus('Running face probe ' + axis + '…', 'warn');
  logLine('face', '=== 3D Live Edge Mesh Plugin ' + SM_VERSION + ' ===');
  logLine('face', 'Starting face probe on axis ' + axis);

  try{
    await requireStartupHomingPreflight('face probe ' + axis);
    s = getSettingsFromUI();
    meshSubdivisionSpacing = s.meshSubdivisionSpacing != null ? Number(s.meshSubdivisionSpacing) : meshSubdivisionSpacing;
    var startCoord = Number(s.faceStartOffset);
    var depthBelow = Number(s.faceDepthBelowSurface);
    var probeDist = Number(s.faceProbeDistance);
    var targetCoord = startCoord + probeDist;
    var sampledAxis = String(s.sampleAxis || 'X').toUpperCase();
    var fixedCoord = Number(s.faceFixedCoord);
    logLine('face', 'Probe axis ' + axis + ': start=' + startCoord.toFixed(3) + ' target=' + targetCoord.toFixed(3));
    pluginDebug('runFaceProbe: axis=' + axis + ' start=' + startCoord + ' target=' + targetCoord + ' depthBelow=' + depthBelow + ' fixedCoord=' + fixedCoord);

    // ── Phase 0: Auto Top-Z ───────────────────────────────────────────────────
    // When running Face Probe directly (not from combined mode), automatically
    // probe the surface Z at the face probe's configured X positions so that
    // topResults contains real measured data at the exact coordinates the face
    // probe will use, rather than relying on stale or interpolated values.
    var _p0Ran = false;
    if (!_calledFromCombined) {
      var _p0xStart = Number((document.getElementById('fp-xStart') || {}).value);
      var _p0xEnd   = Number((document.getElementById('fp-xEnd')   || {}).value);
      var _p0xPts   = Math.max(2, Math.round(Number((document.getElementById('fp-xPoints') || {}).value) || 5));
      if (isFinite(_p0xStart) && isFinite(_p0xEnd) && _p0xStart !== _p0xEnd) {
        var _p0ClearZ  = Number(s.topClearZ)      || 5;
        var _p0Feed    = Number(s.topFeed)         || 200;
        var _p0Travel  = Number(s.travelFeedRate)  || 600;
        var _p0Depth   = Number(s.topProbeDepth)   || 5;
        var _p0Retract = Number(s.topRetract)      || 2;
        var _p0FaceY   = Number(s.topFixedCoord);
        var _p0Range   = _p0xEnd - _p0xStart;
        var _p0Step    = _p0Range / (_p0xPts - 1);
        logLine('face', 'AUTO TOP-Z: Phase 0 — probing surface Z at face X positions before face probe...');
        logLine('face', 'AUTO TOP-Z: ' + _p0xPts + ' points from X=' + _p0xStart.toFixed(3) + ' to X=' + _p0xEnd.toFixed(3) + ' at Y=' + _p0FaceY.toFixed(3));
        topResults = [];
        for (var _p0i = 0; _p0i < _p0xPts; _p0i++) {
          smCheckStop();
          var _p0xPos = _p0xStart + _p0i * _p0Step;
          logLine('face', 'AUTO TOP-Z: Probing point ' + (_p0i + 1) + '/' + _p0xPts + ' at X=' + Number(_p0xPos).toFixed(3) + ' Y=' + Number(_p0FaceY).toFixed(3));
          smSetProgress(_p0i / _p0xPts * 30);
          await smSafeLateralMove(_p0xPos, _p0FaceY, _p0Travel, _p0ClearZ);
          await smEnsureProbeClear(_p0ClearZ, _p0Travel);
          var _p0Contact = await smPlungeProbe(_p0Depth, _p0Feed);
          if (!_p0Contact || !isFinite(_p0Contact.z)) {
            throw new Error('AUTO TOP-Z probe returned invalid contact at X=' + Number(_p0xPos).toFixed(3));
          }
          topResults.push({
            type: 'top',
            index: _p0i + 1,
            sampleCoord: _p0xPos,
            targetSamplePos: _p0xPos,
            x: Number(_p0Contact.x),
            y: Number(_p0Contact.y),
            z: Number(_p0Contact.z),
            machineZ: _p0Contact.machineZ != null ? Number(_p0Contact.machineZ) : null,
            status: 'TOP'
          });
          logLine('face', 'AUTO TOP-Z:   -> Z=' + Number(_p0Contact.z).toFixed(3));
          await smRetractSmall(_p0Contact.z, _p0Retract, _p0Travel);
        }
        smSetProgress(30);
        _p0Ran = true;
        logLine('face', 'AUTO TOP-Z: Phase 0 complete — ' + topResults.length + ' top-Z reference points measured at Y=' + Number(_p0FaceY).toFixed(3));
        pluginDebug('runFaceProbe Phase 0 complete: ' + topResults.length + ' top-Z points at faceY=' + _p0FaceY);
      } else {
        logLine('face', 'AUTO TOP-Z: Phase 0 skipped — fp-xStart/fp-xEnd not configured (will use existing topResults if available).');
      }
    }

    var topPts = topResults.filter(function(r){ return r.status === 'TOP'; }).sort(function(a, b){
      return Number(a.sampleCoord) - Number(b.sampleCoord);
    });

    var faceSamples = [];
    if(topPts.length && sampledAxis !== axis){
      // When Phase 0 (standalone) or Phase 1.5 (combined) has already measured real
      // top-Z values at the exact face X positions, use those directly.
      // Only fall back to fpBuildFaceSamplesFromConfig() (mesh interpolation) when
      // no auto top-Z pass was made AND we are not in combined mode (combined mode
      // always provides real Phase 1.5 measured values via topResults).
      var configSamples = (!_p0Ran && !_calledFromCombined && smMeshData && smGridConfig) ? fpBuildFaceSamplesFromConfig() : null;
      if(configSamples && configSamples.length >= 2){
        faceSamples = configSamples;
        logLine('face', 'Face probe: user requested ' + faceSamples.length + ' X samples (fp-xPoints).');
        logLine('face', 'Face probe: X positions = [' + faceSamples.map(function(s){ return s.sampleCoord.toFixed(1); }).join(', ') + ']');
        logLine('face', 'Face probe: interpolated topZ = [' + faceSamples.map(function(s){ return s.topZ.toFixed(3); }).join(', ') + ']');
      } else {
        // Use topPts directly — real measured values from Phase 0 (standalone) or
        // Phase 1.5 (combined mode), or the best available data when neither ran.
        faceSamples = topPts.map(function(tp, idx){
          return { index: idx + 1, sampleCoord: Number(tp.sampleCoord), topZ: Number(tp.z) };
        });
        if(_p0Ran){
          logLine('face', 'Face probe: using ' + faceSamples.length + ' measured top-Z reference points from Phase 0 auto top-Z pass.');
        } else if(_calledFromCombined){
          logLine('face', 'Face probe: using ' + faceSamples.length + ' measured top-Z reference points from Phase 1.5 (combined mode).');
        } else {
          logLine('face', 'Using ' + faceSamples.length + ' indexed face sample(s) from top profile along ' + sampledAxis + ' (no mesh data for interpolation).');
        }
      }
    } else {
      var curPos = await getWorkPosition();
      var fallbackTopZ = topPts.length ? Number(topPts[0].z) : (_faceSurfRefZ !== null ? _faceSurfRefZ : Number(curPos.z));
      if(topPts.length && sampledAxis === axis){
        logLine('face', 'Sample axis matches face probe axis (' + axis + '), so indexed face stepping is unavailable. Falling back to single face line at fixed coordinate ' + fixedCoord.toFixed(3) + '.');
      } else {
        logLine('face', 'No usable top profile samples for indexed face stepping. Falling back to single face line at fixed coordinate ' + fixedCoord.toFixed(3) + '.');
      }
      if(_faceSurfRefZ !== null && !topPts.length){
        logLine('face', 'Using surface reference Z = ' + _faceSurfRefZ.toFixed(3) + ' coords (captured by Surface Reference Probe).');
      }
      faceSamples = [{ index: 1, sampleCoord: fixedCoord, topZ: fallbackTopZ }];
    }

    // ── Layered face probe mode ───────────────────────────────────────────────
    if(s.enableLayeredFace){
      var maxDepth = Number(s.faceMaxDepth) || 14.75;
      var layerCount = Math.max(2, Math.round(Number(s.faceLayerCount) || 3));
      var totalLayers = layerCount;

      logLine('face', 'Layered face probe: ' + totalLayers + ' layers, max depth ' + maxDepth.toFixed(3) + ' coords');
      layeredFaceResults = [];

      // Pre-calculate inter-sample retract Z for each layer.
      // For each non-last layer: find the shallowest (closest to zero / highest) next-layer Z
      // across all X samples, then add 2 coords clearance buffer.
      // For the last layer: null (signals "use full safe Z").
      // Uses effectiveTopZ = sampleTopZ - 0.05 so the shallowest layer probes 0.05 coords below surface.
      var layerRetractZ = [];
      for(var layerIdx = 0; layerIdx < totalLayers; layerIdx++){
        if(layerIdx === totalLayers - 1){
          layerRetractZ.push(null);
        } else {
          var retractShallowest = null;
          for(var sampleIdx = 0; sampleIdx < faceSamples.length; sampleIdx++){
            var nextTopZ = Number(faceSamples[sampleIdx].topZ);
            var nextDeepestZ = nextTopZ - maxDepth;
            var nextSpacing = (nextTopZ - 0.05 - nextDeepestZ) / (totalLayers - 1);
            var nextLayerZ = parseFloat((nextDeepestZ + ((layerIdx + 1) * nextSpacing)).toFixed(6));
            if(retractShallowest === null || nextLayerZ > retractShallowest){
              retractShallowest = nextLayerZ;
            }
          }
          layerRetractZ.push(retractShallowest + 2);
        }
      }

      // Pre-compute safe travel Z for the entire run — avoids re-scanning topResults on every retract call.
      var preScanRetractClearance = Number(s.topRetract) || 2;
      var preScanTopPts = topResults.filter(function(r){ return r.status === 'TOP'; });
      var preScanHighestZ = -Infinity;
      preScanTopPts.forEach(function(tp){ var tz = Number(tp.z); if(tz > preScanHighestZ) preScanHighestZ = tz; });
      var localSafeZ = isFinite(preScanHighestZ) ? (preScanHighestZ + preScanRetractClearance) : null;

      var didOptimizedRetract = false;
      for(var li = 0; li < totalLayers; li++){
        checkStop();
        var layerNum = li + 1;
        var isBottomLayer = (li === 0);
        // Serpentine X ordering: even layers go left→right, odd layers go right→left.
        var forward = (li % 2 === 0);
        var sampleOrder = [];
        for(var oi = 0; oi < faceSamples.length; oi++) sampleOrder.push(oi);
        if(!forward) sampleOrder.reverse();
        if(isBottomLayer){
          logLine('face', 'Layer ' + layerNum + '/' + totalLayers + ': probing face at per-sample depth (stylusLen=' + maxDepth.toFixed(3) + ' coords below topZ) across ' + faceSamples.length + ' X samples');
        } else {
          logLine('face', 'Layer ' + layerNum + '/' + totalLayers + ': probing face across ' + faceSamples.length + ' X samples (per-sample Z, ' + (forward ? 'left\u2192right' : 'right\u2192left') + ' serpentine)');
        }
        var layerContacts = 0;

        for(var si = 0; si < sampleOrder.length; si++){
          checkStop();
          var i = sampleOrder[si];
          var sample = faceSamples[i];
          var lineCoord = Number(sample.sampleCoord);
          var sampleNum = si + 1;

          // Per-sample layer Z calculation:
          // Layer 1 (bottom) is at sampleTopZ - maxDepth (stylus length below top surface)
          // Shallowest layer probes at sampleTopZ - 0.05 (0.05 coords below surface to ensure contact)
          // Middle layers are evenly spaced between bottom and sampleTopZ - 0.05
          var sampleTopZ = Number(sample.topZ);
          var deepestZ = sampleTopZ - maxDepth;
          var layerZ;
          if(totalLayers === 1){
            layerZ = deepestZ;
          } else {
            var effectiveTopZ = sampleTopZ - 0.05;
            var layerSpacing = (effectiveTopZ - deepestZ) / (totalLayers - 1);
            layerZ = parseFloat((deepestZ + (li * layerSpacing)).toFixed(6));
          }

          logLine('face', 'Layer ' + layerNum + ' sample ' + sampleNum + '/' + faceSamples.length + ': ' + sampledAxis + '=' + lineCoord.toFixed(3) + ' probing at Z=' + layerZ.toFixed(3) + ' from ' + axis + '=' + startCoord.toFixed(3) + ' toward ' + axis + '=' + targetCoord.toFixed(3));

          if(!didOptimizedRetract){
            await raiseFaceTravelSafeZ('Layer ' + layerNum + ' sample ' + sampleNum + ': safe retract', null, localSafeZ);

            if(axis === 'X'){
              await moveAbs(null, lineCoord, null, s.faceRetractFeed || s.travelFeedRate);
            } else {
              await moveAbs(lineCoord, null, null, s.faceRetractFeed || s.travelFeedRate);
            }

            if(axis === 'X'){
              await moveAbs(startCoord, null, null, s.faceRetractFeed || s.travelFeedRate);
            } else {
              await moveAbs(null, startCoord, null, s.faceRetractFeed || s.travelFeedRate);
            }
          }
          didOptimizedRetract = false;

          await moveAbs(null, null, layerZ, s.travelRecoveryLiftFeedRate || s.travelFeedRate);

          var _layerFeedLog = Number(s.faceFeed || s.topFeed || s.travelFeedRate || 0);
          logLine('face', 'Layer ' + layerNum + ' sample ' + sampleNum + ': probing toward ' + axis + ' ' + targetCoord.toFixed(3) + ' at feed ' + _layerFeedLog.toFixed(0) + ' mm/min.');
          var faceAdv = await segmentedFaceMoveWithRecovery(axis, targetCoord, lineCoord, layerZ, s, 'probe', lineCoord, true);
          faceAdv.extras.forEach(function(ep){
            ep.sampleCoord = lineCoord;
            faceResults.push(ep);
          });
          if(faceAdv.extras.length) saveProbeResultsThrottled();

          var contact = faceAdv.contact || faceAdv.position;
          var contactFaceCoord = axis === 'X' ? Number(contact.x) : Number(contact.y);
          if(faceAdv.contact){
            logLine('face', 'FACE CONTACT: ' + axis + '=' + contactFaceCoord.toFixed(3) + ' at ' + sampledAxis + '=' + lineCoord.toFixed(3) + ' Z=' + layerZ.toFixed(3) + ' (layer ' + layerNum + ')');
            layerContacts++;
            var lRec = makeFaceContactRecord(faceResults.length + 1, contact, axis, 'FACE ' + axis, targetCoord, lineCoord);
            faceResults.push(lRec);
            layeredFaceResults.push({
              x: axis === 'Y' ? lineCoord : contactFaceCoord,
              y: axis === 'X' ? lineCoord : contactFaceCoord,
              z: layerZ,
              machineZ: contact.machineZ != null ? Number(contact.machineZ) : null,
              layer: layerNum,
              sampleTopZ: sampleTopZ
            });
          } else {
            logLine('face', 'Layer ' + layerNum + ' sample ' + sampleNum + ': reached target ' + axis + '=' + targetCoord.toFixed(3) + ' without contact.');
            var lMiss = makeFaceContactRecord(faceResults.length + 1, contact, axis, 'FACE ' + axis + ' MISS', targetCoord, lineCoord);
            faceResults.push(lMiss);
          }
          saveProbeResultsThrottled();

          var isLastSampleInLayer = (si === sampleOrder.length - 1);
          var isLastLayer = (li === totalLayers - 1);
          if(!isLastSampleInLayer){
            var nextSampleCoord = Number(faceSamples[sampleOrder[si + 1]].sampleCoord);
            logLine('face', 'Inter-sample return (layer ' + layerNum + '): G1 retract ' + axis + '=' + startCoord.toFixed(3) + ' at F' + Number(s.faceRetractFeed || s.travelFeedRate).toFixed(0) + ', then G1 travel to ' + sampledAxis + '=' + nextSampleCoord.toFixed(3) + ' at F' + Number(s.faceRetractFeed || s.travelFeedRate).toFixed(0) + '.');
            // Step 1: G1 retract on face axis back to startCoord (fully clears workpiece)
            if(axis === 'X'){
              await moveAbs(startCoord, null, null, s.faceRetractFeed || s.travelFeedRate);
            } else {
              await moveAbs(null, startCoord, null, s.faceRetractFeed || s.travelFeedRate);
            }
            // Step 2: G1 travel on sample axis to next sample position; use returned position to avoid extra HTTP call
            var _isrPos;
            if(axis === 'X'){
              _isrPos = await moveAbs(null, nextSampleCoord, null, s.faceRetractFeed || s.travelFeedRate) || await getWorkPosition();
            } else {
              _isrPos = await moveAbs(nextSampleCoord, null, null, s.faceRetractFeed || s.travelFeedRate) || await getWorkPosition();
            }
            // Safety net: check if probe was inadvertently triggered during G1 moves
            if(_isrPos.probeTriggered){
              logLine('face', 'INTER-SAMPLE TRAVEL CONTACT: probe triggered during inter-sample retract at X=' + Number(_isrPos.x).toFixed(3) + ' Y=' + Number(_isrPos.y).toFixed(3) + ' Z=' + Number(_isrPos.z).toFixed(3));
              var _isrRec = makeFaceContactRecord(faceResults.length + 1, _isrPos, axis, 'EARLY_CONTACT_INTER_SAMPLE_RETRACT_' + axis, targetCoord, lineCoord);
              faceResults.push(_isrRec);
              layeredFaceResults.push({
                x: Number(_isrPos.x),
                y: Number(_isrPos.y),
                z: layerZ,
                machineZ: _isrPos.machineZ != null ? Number(_isrPos.machineZ) : null,
                layer: layerNum,
                sampleTopZ: sampleTopZ
              });
              saveProbeResultsThrottled();
              var _isrRecovery = {recoveries: 0, totalLift: 0};
              var _isrUnitX = axis === 'X' ? Math.sign(startCoord - targetCoord) : 0;
              var _isrUnitY = axis === 'X' ? 0 : Math.sign(startCoord - targetCoord);
              await _clearTriggeredProbeByBackingOffGeneric('face', _isrPos, _isrUnitX, _isrUnitY, s, _isrRecovery);
              didOptimizedRetract = false;
            } else {
              didOptimizedRetract = true;
            }
          } else if(!isLastLayer){
            var layerTransitionZ = layerRetractZ[li];
            logLine('face', 'Layer ' + layerNum + ' \u2192 ' + (layerNum + 1) + ': G1 retract ' + axis + '=' + startCoord.toFixed(3) + ' at F' + Number(s.faceRetractFeed || s.travelFeedRate).toFixed(0) + ', then G1 raise Z=' + layerTransitionZ.toFixed(3) + ' at F' + Number(s.faceRetractFeed || s.travelFeedRate).toFixed(0) + ' (serpentine \u2014 next layer starts at ' + sampledAxis + '=' + lineCoord.toFixed(3) + ').');
            // Step 1: G1 retract on face axis back to startCoord (fully clears workpiece)
            if(axis === 'X'){
              await moveAbs(startCoord, null, null, s.faceRetractFeed || s.travelFeedRate);
            } else {
              await moveAbs(null, startCoord, null, s.faceRetractFeed || s.travelFeedRate);
            }
            // Step 2: G1 raise Z to next-layer clearance height; use returned position to avoid extra HTTP call
            var _ltrPos = await moveAbs(null, null, layerTransitionZ, s.faceRetractFeed || s.travelFeedRate) || await getWorkPosition();
            // Safety net: check if probe was inadvertently triggered during G1 moves
            if(_ltrPos.probeTriggered){
              logLine('face', 'INTER-SAMPLE TRAVEL CONTACT: probe triggered during layer-transition retract at X=' + Number(_ltrPos.x).toFixed(3) + ' Y=' + Number(_ltrPos.y).toFixed(3) + ' Z=' + Number(_ltrPos.z).toFixed(3));
              var _ltrRec = makeFaceContactRecord(faceResults.length + 1, _ltrPos, axis, 'EARLY_CONTACT_INTER_SAMPLE_RETRACT_' + axis, targetCoord, lineCoord);
              faceResults.push(_ltrRec);
              layeredFaceResults.push({
                x: Number(_ltrPos.x),
                y: Number(_ltrPos.y),
                z: Number(_ltrPos.z),
                machineZ: _ltrPos.machineZ != null ? Number(_ltrPos.machineZ) : null,
                layer: layerNum,
                sampleTopZ: sampleTopZ
              });
              saveProbeResultsThrottled();
              var _ltrRecovery = {recoveries: 0, totalLift: 0};
              var _ltrUnitX = axis === 'X' ? Math.sign(startCoord - targetCoord) : 0;
              var _ltrUnitY = axis === 'X' ? 0 : Math.sign(startCoord - targetCoord);
              await _clearTriggeredProbeByBackingOffGeneric('face', _ltrPos, _ltrUnitX, _ltrUnitY, s, _ltrRecovery);
              didOptimizedRetract = false;
            } else {
              didOptimizedRetract = true;
            }
          }
        }
        logLine('face', 'Layer ' + layerNum + '/' + totalLayers + ' complete — UI updated, ' + layeredFaceResults.length + ' total contacts recorded.');
        updateAllResultsUI();
      }

      saveProbeResults();
      logLine('face', 'Layered face probe complete: ' + totalLayers + ' layers x ' + faceSamples.length + ' samples = ' + layeredFaceResults.length + ' total contacts');
      pluginDebug('runFaceProbe layered: faceResults=' + faceResults.length + ' layeredFaceResults=' + layeredFaceResults.length);
      logLine('face', 'Waiting for controller idle before finish motion...');
      await waitForIdle();
      await sleep(50); // Reduced from 200ms - just enough for controller stability
      await finishRunMotion('face');
      if (!_calledFromCombined) switchTab('results');
      setFooterStatus('Layered face probe ' + axis + ' complete: ' + totalLayers + ' layers x ' + faceSamples.length + ' samples = ' + layeredFaceResults.length + ' contacts', 'good');
      layeredFaceResultsRaw = layeredFaceResults.slice();
      layeredFaceResults = subdivideFaceMesh(layeredFaceResults, meshSubdivisionSpacing);
      updateFaceMeshDataUI();
      // Re-render surface mesh visualizers to include face wall (even when no surface mesh is present)
      smPvizRenderMesh();
      renderSurfVizMesh();
      renderResVizMesh();
      populateUnifiedProbeTable();
      updateEdgeProbeStorageUI();
      return;
    }

    // ── Single-pass face probe mode ───────────────────────────────────────────
    var spDidOptimizedRetract = false;
    for(var i = 0; i < faceSamples.length; i++){
      checkStop();
      var sample = faceSamples[i];
      var lineCoord = Number(sample.sampleCoord);
      var zForProbe = Number(sample.topZ) - depthBelow;
      logLine('face', 'Face sample ' + sample.index + '/' + faceSamples.length + ': line ' + sampledAxis + '=' + lineCoord.toFixed(3) + ' using top Z=' + Number(sample.topZ).toFixed(3) + ' depth below=' + depthBelow.toFixed(3) + ' probe Z=' + zForProbe.toFixed(3));

      if(!spDidOptimizedRetract){
        await raiseFaceTravelSafeZ('Face sample ' + sample.index + ': safe retract before indexed move');

        if(axis === 'X'){
          logLine('face', 'Face sample ' + sample.index + ': moving to sample line Y=' + lineCoord.toFixed(3) + ' at safe travel Z.');
          await moveAbs(null, lineCoord, null, s.faceRetractFeed || s.travelFeedRate);
        } else {
          logLine('face', 'Face sample ' + sample.index + ': moving to sample line X=' + lineCoord.toFixed(3) + ' at safe travel Z.');
          await moveAbs(lineCoord, null, null, s.faceRetractFeed || s.travelFeedRate);
        }

        logLine('face', 'At face sample line. Moving to face start ' + axis + '=' + startCoord.toFixed(3) + ' at safe travel Z before lowering.');
        if(axis === 'X'){
          await moveAbs(startCoord, null, null, s.faceRetractFeed || s.travelFeedRate);
        } else {
          await moveAbs(null, startCoord, null, s.faceRetractFeed || s.travelFeedRate);
        }
      }
      // Consume the flag — set to true at end of previous iteration after a diagonal retract.
      // The check above already used it; reset so the default (full positioning) applies next time.
      spDidOptimizedRetract = false;

      logLine('face', 'At face start. Lowering to face probe Z ' + zForProbe.toFixed(3));
      await moveAbs(null, null, zForProbe, s.travelRecoveryLiftFeedRate || s.travelFeedRate);

      var _faceFeedLog = Number(s.faceFeed || s.topFeed || s.travelFeedRate || 0); logLine('face', 'At face start. Probing toward ' + axis + ' ' + targetCoord.toFixed(3) + ' at feed ' + _faceFeedLog.toFixed(0) + ' mm/min.');
      var faceAdvance = await segmentedFaceMoveWithRecovery(axis, targetCoord, lineCoord, zForProbe, s, 'probe', lineCoord, true);
      faceAdvance.extras.forEach(function(ep){
        ep.sampleCoord = lineCoord;
        faceResults.push(ep);
      });
      if(faceAdvance.extras.length) saveProbeResultsThrottled();

      var contact = faceAdvance.contact || faceAdvance.position;
      var contactCoord = axis === 'X' ? Number(contact.x) : Number(contact.y);
      if(faceAdvance.contact){
        logLine('face', 'Face ' + axis + ' final contact at ' + axis + '=' + contactCoord.toFixed(3) + ' on sample ' + sampledAxis + '=' + lineCoord.toFixed(3) + ' Z=' + Number(contact.z).toFixed(3));
        var rec = makeFaceContactRecord(faceResults.length + 1, contact, axis, 'FACE ' + axis, targetCoord, lineCoord);
        faceResults.push(rec);
      } else {
        logLine('face', 'Face ' + axis + ' reached target ' + axis + '=' + targetCoord.toFixed(3) + ' on sample ' + sampledAxis + '=' + lineCoord.toFixed(3) + ' without contact.');
        var miss = makeFaceContactRecord(faceResults.length + 1, contact, axis, 'FACE ' + axis + ' MISS', targetCoord, lineCoord);
        faceResults.push(miss);
      }
      saveProbeResultsThrottled();

      if(i < faceSamples.length - 1){
        var nextLineCoord = Number(faceSamples[i + 1].sampleCoord);
        logLine('face', 'Inter-sample return: G1 retract ' + axis + '=' + startCoord.toFixed(3) + ' at F' + Number(s.faceRetractFeed || s.travelFeedRate).toFixed(0) + ', then G1 travel to ' + sampledAxis + '=' + nextLineCoord.toFixed(3) + ' at F' + Number(s.faceRetractFeed || s.travelFeedRate).toFixed(0) + '.');
        // Step 1: G1 retract on face axis back to startCoord (fully clears workpiece)
        if(axis === 'X'){
          await moveAbs(startCoord, null, null, s.faceRetractFeed || s.travelFeedRate);
        } else {
          await moveAbs(null, startCoord, null, s.faceRetractFeed || s.travelFeedRate);
        }
        // Step 2: G1 travel on sample axis to next sample position; use returned position to avoid extra HTTP call
        var _spIsrPos;
        if(axis === 'X'){
          _spIsrPos = await moveAbs(null, nextLineCoord, null, s.faceRetractFeed || s.travelFeedRate) || await getWorkPosition();
        } else {
          _spIsrPos = await moveAbs(nextLineCoord, null, null, s.faceRetractFeed || s.travelFeedRate) || await getWorkPosition();
        }
        // Safety net: check if probe was inadvertently triggered during G1 moves
        if(_spIsrPos.probeTriggered){
          logLine('face', 'INTER-SAMPLE TRAVEL CONTACT: probe triggered during inter-sample retract at X=' + Number(_spIsrPos.x).toFixed(3) + ' Y=' + Number(_spIsrPos.y).toFixed(3) + ' Z=' + Number(_spIsrPos.z).toFixed(3));
          var _spIsrRec = makeFaceContactRecord(faceResults.length + 1, _spIsrPos, axis, 'EARLY_CONTACT_INTER_SAMPLE_RETRACT_' + axis, targetCoord, lineCoord);
          faceResults.push(_spIsrRec);
          saveProbeResultsThrottled();
          var _spIsrRecovery = {recoveries: 0, totalLift: 0};
          var _spIsrUnitX = axis === 'X' ? Math.sign(startCoord - targetCoord) : 0;
          var _spIsrUnitY = axis === 'X' ? 0 : Math.sign(startCoord - targetCoord);
          await _clearTriggeredProbeByBackingOffGeneric('face', _spIsrPos, _spIsrUnitX, _spIsrUnitY, s, _spIsrRecovery);
          spDidOptimizedRetract = false;
        } else {
          spDidOptimizedRetract = true;
        }
      }
    }

    logLine('face', 'Waiting for controller idle before finish motion...');
    await waitForIdle();
    await sleep(50); // Reduced from 200ms - just enough for controller stability
    await finishRunMotion('face');
    if (!_calledFromCombined) switchTab('results');
    pluginDebug('runFaceProbe COMPLETE: axis=' + axis + ' samples=' + faceSamples.length);
    setFooterStatus('Face probe ' + axis + ' complete: ' + faceSamples.length + ' sample(s)', 'good');
    layeredFaceResultsRaw = layeredFaceResults.slice();
    layeredFaceResults = subdivideFaceMesh(layeredFaceResults, meshSubdivisionSpacing);
    updateFaceMeshDataUI();
    populateUnifiedProbeTable();
    saveProbeResults();
    updateEdgeProbeStorageUI();
    pluginDebug('runFaceProbe single-pass complete: faceResults=' + faceResults.length);

  } catch(e){
    logLine('face', 'ERROR: ' + e.message);
    pluginDebug('runFaceProbe ERROR: axis=' + axis + ' error="' + e.message + '"');
    setFooterStatus('Error: ' + e.message, 'bad');
    saveProbeResults();
  } finally{
    _running = false;
    _stopRequested = false;
    pluginDebug('runFaceProbe EXIT (finally): _running reset to false');
    document.getElementById('btn-stop-face').disabled = true;
    document.getElementById('btn-face-x').disabled = false;
    document.getElementById('btn-face-y').disabled = false;
  }
}

// ── Mesh Data Management ──────────────────────────────────────────────────────
function smSaveSettings() {
  pluginDebug('smSaveSettings ENTER');
  var ids = ['sm-minX','sm-maxX','sm-spacingX','sm-minY','sm-maxY','sm-spacingY',
             'sm-probeFeed','sm-travelFeed','sm-clearanceZ','sm-maxPlunge','sm-referenceZ'];
  var data = {};
  ids.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) data[id] = el.value;
  });
  try {
    localStorage.setItem(SM_SURFACE_GRID_SETTINGS_KEY, JSON.stringify(data));
    pluginDebug('smSaveSettings: saved ' + Object.keys(data).length + ' settings');
    setFooterStatus('Surface grid settings saved.', 'good');
  } catch(e) {
    pluginDebug('smSaveSettings ERROR: ' + e.message);
    setFooterStatus('Failed to save settings: ' + e.message, 'bad');
    return;
  }
}

function fpSmSaveSettings() {
  pluginDebug('fpSmSaveSettings ENTER');
  var ids = ['sm-minX','sm-maxX','sm-spacingX','sm-minY','sm-maxY','sm-spacingY',
             'sm-probeFeed','sm-travelFeed','sm-clearanceZ','sm-maxPlunge','sm-referenceZ'];
  ids.forEach(function(id) {
    var fpEl = document.getElementById('fp-' + id);
    var smEl = document.getElementById(id);
    if (fpEl && smEl) smEl.value = fpEl.value;
  });
  smSaveSettings();
  try { updateSurfaceGridSizeDisplay(); } catch(e) {}
}

function smLoadSettings() {
  var raw;
  try { raw = localStorage.getItem(SM_SURFACE_GRID_SETTINGS_KEY); } catch(e) { return; }
  if (!raw) return;
  var data;
  try { data = JSON.parse(raw); } catch(e) { return; }
  console.log('[smLoadSettings] Restoring 2D surface grid settings:', data);
  Object.keys(data).forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = data[id];
    var fpEl = document.getElementById('fp-' + id);
    if (fpEl) fpEl.value = data[id];
  });
  try { updateSurfaceGridSizeDisplay(); } catch(e) { console.warn('[smLoadSettings] updateSurfaceGridSizeDisplay error:', e); }
}

(function init(){
  pluginDebug('init: plugin initializing');
  // Clear any stale visuals from a previous session/reload
  try{ clearAllVisuals(); }catch(e){ pluginDebug('init: clearAllVisuals error: ' + e.message); }
  try{ var vTag=document.getElementById('sm-version-tag'); if(vTag) vTag.textContent=SM_VERSION; }catch(e){}
  setTimeout(function(){ try{ bindProbeDimensionUI(); applyProbeDimensionSettings(getSettingsFromUI()); loadProbeDimensions(); }catch(e){} }, 0);
  try{ loadPersistedLogs(); }catch(e){}
  try{ loadSettings(); }catch(e){}
  try{ loadProbeResults(); }catch(e){}
  try{ updateEdgeProbeStorageUI(); }catch(e){}
  try{ renderWorkflowList(); }catch(e){}
  try{ populateSurfaceResults(); }catch(e){}
  try{ loadSavedLocation(); }catch(e){}
  try{ refreshFinishBehaviorPreview(); }catch(e){}
  try{ refreshTravelRecoveryPreview(); }catch(e){}
  try{ smPvizInitRotation(); }catch(e){}
  try{ initSurfVizRotation(); }catch(e){}
  // Wire relief reset button and dblclick for Three.js camera reset
  try {
    var reliefResetBtnEl = document.getElementById('relief-3d-reset-btn');
    if (reliefResetBtnEl) reliefResetBtnEl.addEventListener('click', function(e) { e.stopPropagation(); reliefResetView(); });
    var reliefSceneEl = document.getElementById('relief-3d-scene');
    if (reliefSceneEl && !reliefSceneEl._reliefDblInited) {
      reliefSceneEl._reliefDblInited = true;
      reliefSceneEl.addEventListener('dblclick', reliefResetView);
    }
  } catch(e) {}
  try{ checkHomedStatus(); }catch(e){}
  refreshCurrentPosition().catch(function(e){
    console.warn('Could not refresh position on init (controller may not be connected):', e.message);
    var el = document.getElementById('setup-status');
    if(el){ el.textContent = 'Controller not connected'; el.className = 'status-line'; }
    setFooterStatus('Ready', '');
  });
  try{ renderLog('top'); }catch(e){}
  try{ renderLog('face'); }catch(e){}
  try{ smLoadSettings(); }catch(e){}
  try{ onProbeTypeChange(); }catch(e){}

  // Tab buttons
  document.querySelectorAll('.tab').forEach(function(t){
    t.addEventListener('click', function(){
      var tabId = t.getAttribute('data-tab');
      pluginDebug('Tab button clicked: ' + tabId);
      if(tabId) switchTab(tabId);
    });
  });

  // Setup buttons
  var btnSave = document.getElementById('btn-save-settings');
  if(btnSave) btnSave.addEventListener('click', function(){ flashSaveButton(this); pluginDebug('btn-save-settings clicked'); saveSettings(); });
  var btnLoad = document.getElementById('btn-load-settings');
  if(btnLoad) btnLoad.addEventListener('click', function(){ flashButton(this); pluginDebug('btn-load-settings clicked'); loadSettings(); });
  var btnReset = document.getElementById('btn-reset-settings');
  if(btnReset) btnReset.addEventListener('click', function(){ flashButton(this); pluginDebug('btn-reset-settings clicked'); resetSettings(); });
  var btnSaveProbeDims = document.getElementById('btn-save-probe-dims');
  if(btnSaveProbeDims) btnSaveProbeDims.addEventListener('click', function(){ flashSaveButton(this); pluginDebug('btn-save-probe-dims clicked'); saveProbeDimensions(); });
  var btnSaveLocation = document.getElementById('btn-save-location');
  if(btnSaveLocation) btnSaveLocation.addEventListener('click', function(){ flashSaveButton(this); pluginDebug('btn-save-location clicked'); saveCurrentLocation(); });
  var btnGoLocation = document.getElementById('btn-go-location');
  if(btnGoLocation) btnGoLocation.addEventListener('click', function(){ flashButton(this); pluginDebug('btn-go-location clicked'); goToSavedLocation(); });
  var btnCheckHomed = document.getElementById('btn-check-homed');
  if(btnCheckHomed) btnCheckHomed.addEventListener('click', function(){ flashButton(this); pluginDebug('btn-check-homed clicked'); checkHomedStatus(); });
  var btnUseCurrentZHome = document.getElementById('btn-use-current-z-home');
  if(btnUseCurrentZHome) btnUseCurrentZHome.addEventListener('click', function(){ flashButton(this); pluginDebug('btn-use-current-z-home clicked'); useCurrentZAsFinishHome(); });
  var btnRefreshPosition = document.getElementById('btn-refresh-position');
  if(btnRefreshPosition) btnRefreshPosition.addEventListener('click', function(){ flashButton(this); pluginDebug('btn-refresh-position clicked'); refreshCurrentPosition(); });
  Array.prototype.forEach.call(document.querySelectorAll('.jog-pill[data-step]'), function(btn){
    btn.addEventListener('click', function(){ var step = btn.getAttribute('data-step'); pluginDebug('Jog step pill clicked: ' + step); setJogStepPreset(step); });
  });
  setJogStepPreset((document.getElementById('jogStepXY') && document.getElementById('jogStepXY').value) || '1');
  var btnJogXMinus = document.getElementById('btn-jog-x-minus');
  if(btnJogXMinus) btnJogXMinus.addEventListener('click', function(){ flashButton(this); pluginDebug('Jog X- clicked'); var j = getJogSettingsFromUI(); jogBy(-Math.abs(j.stepXY), null, null).catch(function(e){ setFooterStatus('Jog X- failed: ' + e.message, 'bad'); }); });
  var btnJogXPlus = document.getElementById('btn-jog-x-plus');
  if(btnJogXPlus) btnJogXPlus.addEventListener('click', function(){ flashButton(this); pluginDebug('Jog X+ clicked'); var j = getJogSettingsFromUI(); jogBy(Math.abs(j.stepXY), null, null).catch(function(e){ setFooterStatus('Jog X+ failed: ' + e.message, 'bad'); }); });
  var btnJogYMinus = document.getElementById('btn-jog-y-minus');
  if(btnJogYMinus) btnJogYMinus.addEventListener('click', function(){ flashButton(this); pluginDebug('Jog Y- clicked'); var j = getJogSettingsFromUI(); jogBy(null, -Math.abs(j.stepXY), null).catch(function(e){ setFooterStatus('Jog Y- failed: ' + e.message, 'bad'); }); });
  var btnJogYPlus = document.getElementById('btn-jog-y-plus');
  if(btnJogYPlus) btnJogYPlus.addEventListener('click', function(){ flashButton(this); pluginDebug('Jog Y+ clicked'); var j = getJogSettingsFromUI(); jogBy(null, Math.abs(j.stepXY), null).catch(function(e){ setFooterStatus('Jog Y+ failed: ' + e.message, 'bad'); }); });
  var btnJogDiagUL = document.getElementById('btn-jog-xy-up-left');
  if(btnJogDiagUL) btnJogDiagUL.addEventListener('click', function(){ flashButton(this); pluginDebug('Jog XY↖ clicked'); var j = getJogSettingsFromUI(); var s=Math.abs(j.stepXY); jogBy(-s, s, null).catch(function(e){ setFooterStatus('Jog failed: ' + e.message, 'bad'); }); });
  var btnJogDiagUR = document.getElementById('btn-jog-xy-up-right');
  if(btnJogDiagUR) btnJogDiagUR.addEventListener('click', function(){ flashButton(this); pluginDebug('Jog XY↗ clicked'); var j = getJogSettingsFromUI(); var s=Math.abs(j.stepXY); jogBy(s, s, null).catch(function(e){ setFooterStatus('Jog failed: ' + e.message, 'bad'); }); });
  var btnJogDiagDL = document.getElementById('btn-jog-xy-down-left');
  if(btnJogDiagDL) btnJogDiagDL.addEventListener('click', function(){ flashButton(this); pluginDebug('Jog XY↙ clicked'); var j = getJogSettingsFromUI(); var s=Math.abs(j.stepXY); jogBy(-s, -s, null).catch(function(e){ setFooterStatus('Jog failed: ' + e.message, 'bad'); }); });
  var btnJogDiagDR = document.getElementById('btn-jog-xy-down-right');
  if(btnJogDiagDR) btnJogDiagDR.addEventListener('click', function(){ flashButton(this); pluginDebug('Jog XY↘ clicked'); var j = getJogSettingsFromUI(); var s=Math.abs(j.stepXY); jogBy(s, -s, null).catch(function(e){ setFooterStatus('Jog failed: ' + e.message, 'bad'); }); });
  var btnJogHold = document.getElementById('btn-jog-hold');
  if(btnJogHold) btnJogHold.addEventListener('click', function(){ flashButton(this); pluginDebug('Jog Hold clicked'); jogHoldMotion(); });
  var btnJogResume = document.getElementById('btn-jog-resume');
  if(btnJogResume) btnJogResume.addEventListener('click', function(){ flashButton(this); pluginDebug('Jog Resume clicked'); jogResumeMotion(); });
  var btnJogZMinus = document.getElementById('btn-jog-z-minus');
  if(btnJogZMinus) btnJogZMinus.addEventListener('click', function(){ flashButton(this); pluginDebug('Jog Z- clicked'); var j = getJogSettingsFromUI(); jogBy(null, null, -Math.abs(j.stepZ)).catch(function(e){ setFooterStatus('Jog Z- failed: ' + e.message, 'bad'); }); });
  var btnJogZPlus = document.getElementById('btn-jog-z-plus');
  if(btnJogZPlus) btnJogZPlus.addEventListener('click', function(){ flashButton(this); pluginDebug('Jog Z+ clicked'); var j = getJogSettingsFromUI(); jogBy(null, null, Math.abs(j.stepZ)).catch(function(e){ setFooterStatus('Jog Z+ failed: ' + e.message, 'bad'); }); });
  var btnJogWorkZero = document.getElementById('btn-jog-work-zero');
  if(btnJogWorkZero) btnJogWorkZero.addEventListener('click', function(){ flashButton(this); pluginDebug('Jog Work Zero clicked'); jogToWorkZero(); });
  var btnJogSafeTop = document.getElementById('btn-jog-safe-top');
  if(btnJogSafeTop) btnJogSafeTop.addEventListener('click', function(){ flashButton(this); pluginDebug('Jog Safe Top clicked'); jogRaiseToMachineSafeTop(); });
  var finishHomeZEl = document.getElementById('finishHomeZ');
  if(finishHomeZEl) finishHomeZEl.addEventListener('input', refreshFinishBehaviorPreview);
  var useMachineHomeRetractEl = document.getElementById('useMachineHomeRetract');
  if(useMachineHomeRetractEl) useMachineHomeRetractEl.addEventListener('change', refreshFinishBehaviorPreview);
  var machineSafeTopZEl = document.getElementById('machineSafeTopZ');
  if(machineSafeTopZEl) machineSafeTopZEl.addEventListener('input', refreshFinishBehaviorPreview);
  var returnToXYZeroEl = document.getElementById('returnToXYZero');
  if(returnToXYZeroEl) returnToXYZeroEl.addEventListener('change', refreshFinishBehaviorPreview);
  var travelContactLiftEl = document.getElementById('travelContactLift');
  if(travelContactLiftEl) travelContactLiftEl.addEventListener('input', refreshTravelRecoveryPreview);
  var travelContactMaxRetriesEl = document.getElementById('travelContactMaxRetries');
  if(travelContactMaxRetriesEl) travelContactMaxRetriesEl.addEventListener('input', refreshTravelRecoveryPreview);

  // Face probe buttons
  var btnFaceX = document.getElementById('btn-face-x');
  if(btnFaceX) btnFaceX.addEventListener('click', function(){ flashButton(this); pluginDebug('btn-face-x clicked'); runFaceProbe('X'); });
  var btnFaceY = document.getElementById('btn-face-y');
  if(btnFaceY) btnFaceY.addEventListener('click', function(){ flashButton(this); pluginDebug('btn-face-y clicked'); runFaceProbe('Y'); });
  var btnStopFace = document.getElementById('btn-stop-face');
  if(btnStopFace) btnStopFace.addEventListener('click', function(){ flashButton(this); pluginDebug('btn-stop-face clicked'); stopAll(); });
  var btnSaveFaceLog = document.getElementById('btn-save-face-log');
  if(btnSaveFaceLog) btnSaveFaceLog.addEventListener('click', function(){ flashButton(this); pluginDebug('btn-save-face-log clicked'); saveLog('face'); });
  var btnClearFaceLog = document.getElementById('btn-clear-face-log');
  if(btnClearFaceLog) btnClearFaceLog.addEventListener('click', function(){ flashButton(this); pluginDebug('btn-clear-face-log clicked'); clearLog('face'); });
  var btnExportFaceCsv = document.getElementById('btn-export-face-csv');
  if(btnExportFaceCsv) btnExportFaceCsv.addEventListener('click', function(){ flashButton(this); pluginDebug('btn-export-face-csv clicked'); exportFaceCSV(); });
  var btnExportFaceDxf = document.getElementById('btn-export-face-dxf');
  if(btnExportFaceDxf) btnExportFaceDxf.addEventListener('click', function(){ flashButton(this); pluginDebug('btn-export-face-dxf clicked'); exportFaceDXF(); });
  var btnExportFaceObj = document.getElementById('btn-export-face-obj');
  if(btnExportFaceObj) btnExportFaceObj.addEventListener('click', function(){ flashButton(this); pluginDebug('btn-export-face-obj clicked'); exportFaceOBJ(); });

  // Surface mesh export buttons
  try {
    document.getElementById('btn-export-surf-csv').addEventListener('click', function(){ flashButton(this); pluginDebug('btn-export-surf-csv clicked'); exportSurfaceMeshCSV(); });
    document.getElementById('btn-export-surf-dxf').addEventListener('click', function(){ flashButton(this); pluginDebug('btn-export-surf-dxf clicked'); exportSurfaceDXF(); });
    document.getElementById('btn-export-surf-obj').addEventListener('click', function(){ flashButton(this); pluginDebug('btn-export-surf-obj clicked'); exportSurfaceOBJ(); });
  } catch(e){}

  // Combined mesh export buttons
  try {
    document.getElementById('btn-export-combined-obj').addEventListener('click', function(){ flashButton(this); pluginDebug('btn-export-combined-obj clicked'); exportCombinedOBJWatertight(); });
    document.getElementById('btn-export-combined-dxf').addEventListener('click', function(){ flashButton(this); pluginDebug('btn-export-combined-dxf clicked'); exportCombinedDXF(); });
    // Clear auto-fill flag when user manually edits the Bottom Z field
    var combinedBottomZEl = document.getElementById('combinedBottomZ');
    if (combinedBottomZEl) combinedBottomZEl.addEventListener('input', function() {
      this.setAttribute('data-is-default', '0');
      var hint = document.getElementById('combinedBottomZ-hint');
      if (hint) hint.style.display = 'none';
    });
  } catch(e){}

  // Results buttons
  var btnExportCsv = document.getElementById('btn-export-csv');
  if(btnExportCsv) btnExportCsv.addEventListener('click', function(){ flashButton(this); pluginDebug('btn-export-csv clicked'); exportCSV(); });
  var btnClearAll = document.getElementById('btn-clear-all-results');
  if(btnClearAll) btnClearAll.addEventListener('click', function(){ flashButton(this); pluginDebug('btn-clear-all-results clicked'); clearAllResults(); });
  var btnCopyResults = document.getElementById('btn-copy-results');
  if(btnCopyResults) btnCopyResults.addEventListener('click', function() {
    flashButton(this);
    pluginDebug('btn-copy-results clicked');
    var tbody = document.getElementById('res-unified-tbody');
    if (!tbody) return;
    var rows = Array.from(tbody.querySelectorAll('tr')).filter(function(tr) {
      return tr.querySelectorAll('td').length >= 5;
    }).map(function(tr) {
      return Array.from(tr.querySelectorAll('td')).map(function(td) { return td.textContent; }).join('\t');
    });
    var text = '#\tX\tY\tZ\tType\n' + rows.join('\n');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function() { setFooterStatus('Results copied to clipboard.', 'good'); }).catch(function() { setFooterStatus('Copy failed.', 'warn'); });
    } else {
      var ta = document.createElement('textarea'); ta.value = text;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy');
      document.body.removeChild(ta); setFooterStatus('Results copied to clipboard.', 'good');
    }
  });

  // Actions / workflow buttons
  var btnSaveWf = document.getElementById('btn-save-workflow');
  if(btnSaveWf) btnSaveWf.addEventListener('click', function(){ flashSaveButton(this); pluginDebug('btn-save-workflow clicked'); saveWorkflow(); });
  var btnLoadWf = document.getElementById('btn-load-workflow');
  if(btnLoadWf) btnLoadWf.addEventListener('click', function(){ flashButton(this); pluginDebug('btn-load-workflow clicked'); loadWorkflow(); });
  var btnExportWf = document.getElementById('btn-export-workflows');
  if(btnExportWf) btnExportWf.addEventListener('click', function(){ flashButton(this); pluginDebug('btn-export-workflows clicked'); exportWorkflows(); });
  var btnImportWf = document.getElementById('btn-import-workflows');
  if(btnImportWf) btnImportWf.addEventListener('click', function(){ flashButton(this); pluginDebug('btn-import-workflows clicked'); importWorkflows(); });
  var btnSaveAllLogs = document.getElementById('btn-save-all-logs');
  if(btnSaveAllLogs) btnSaveAllLogs.addEventListener('click', function(){ flashSaveButton(this); pluginDebug('btn-save-all-logs clicked'); saveAllLogs(); });
  var btnClearAll2 = document.getElementById('btn-clear-all-results-2');
  if(btnClearAll2) btnClearAll2.addEventListener('click', function(){ flashButton(this); pluginDebug('btn-clear-all-results-2 clicked'); clearAllResults(); });

  // Workflow list — event delegation for dynamically generated Load/Delete buttons
  var wfList = document.getElementById('workflow-list');
  if(wfList){
    wfList.addEventListener('click', function(e){
      var btn = e.target.closest('button');
      if(!btn) return;
      var name = btn.getAttribute('data-wf-name');
      if(!name) return;
      pluginDebug('Workflow list click: name="' + name + '" action=' + (btn.classList.contains('wf-load') ? 'load' : 'delete'));
      if(btn.classList.contains('wf-load')) _loadWorkflowByName(name);
      else if(btn.classList.contains('wf-delete')) deleteWorkflow(name);
    });
  }

  // Mesh Data Management buttons
  var btnSaveMeshFile = document.getElementById('btn-save-mesh-file');
  if(btnSaveMeshFile) btnSaveMeshFile.addEventListener('click', function(){ flashSaveButton(this); pluginDebug('btn-save-mesh-file clicked'); saveMeshToFile(); });
  var btnLoadMeshFile = document.getElementById('btn-load-mesh-file');
  if(btnLoadMeshFile) btnLoadMeshFile.addEventListener('click', function(){ flashButton(this); pluginDebug('btn-load-mesh-file clicked'); loadMeshFromFile(); });
  var btnSaveMeshStorage = document.getElementById('btn-save-mesh-storage');
  if(btnSaveMeshStorage) btnSaveMeshStorage.addEventListener('click', function(){ flashSaveButton(this); pluginDebug('btn-save-mesh-storage clicked'); saveMeshToStorage(); });
  var btnLoadMeshStorage = document.getElementById('btn-load-mesh-storage');
  if(btnLoadMeshStorage) btnLoadMeshStorage.addEventListener('click', function(){ flashButton(this); pluginDebug('btn-load-mesh-storage clicked'); loadMeshFromStorage(); });
  var btnClearMeshStorage = document.getElementById('btn-clear-mesh-storage');
  if(btnClearMeshStorage) btnClearMeshStorage.addEventListener('click', function(){ flashButton(this); pluginDebug('btn-clear-mesh-storage clicked'); clearMeshStorage(); });

  // 2D Surface Compensation buttons (legacy — kept for backward compatibility)
  var btnApply2d = document.getElementById('sm-btn-apply-comp');
  if(btnApply2d) btnApply2d.addEventListener('click', function(){ flashButton(this); pluginDebug('sm-btn-apply-comp clicked'); applySurfaceCompensation(); });
  var btnDownload2d = document.getElementById('sm-btn-download-comp');
  if(btnDownload2d) btnDownload2d.addEventListener('click', function(){ flashButton(this); pluginDebug('sm-btn-download-comp clicked'); smDownloadCompensatedGcode(); });
  var btnSendNcSender2d = document.getElementById('sm-btn-send-ncsender');
  if(btnSendNcSender2d) btnSendNcSender2d.addEventListener('click', function(){ flashButton(this); pluginDebug('sm-btn-send-ncsender clicked'); sendCompToNcSender(smCompensatedGcode, 'compensated_surface'); });

  // Face Probe Tab — Mesh Data Management buttons
  var faceBtnSaveMesh = document.getElementById('face-btn-save-mesh');
  if (faceBtnSaveMesh) faceBtnSaveMesh.addEventListener('click', function(){ flashSaveButton(this); pluginDebug('face-btn-save-mesh clicked'); saveFaceMeshData(); });
  var faceBtnLoadMesh = document.getElementById('face-btn-load-mesh');
  if (faceBtnLoadMesh) faceBtnLoadMesh.addEventListener('click', function(){ flashButton(this); pluginDebug('face-btn-load-mesh clicked'); loadFaceMeshData(); });
  var faceBtnClearMesh = document.getElementById('face-btn-clear-mesh');
  if (faceBtnClearMesh) faceBtnClearMesh.addEventListener('click', function(){ flashButton(this); pluginDebug('face-btn-clear-mesh clicked'); clearFaceMeshData(); });
  var faceBtnExportJson = document.getElementById('face-btn-export-json');
  if (faceBtnExportJson) faceBtnExportJson.addEventListener('click', function(){ flashButton(this); pluginDebug('face-btn-export-json clicked'); exportFaceMeshJSON(); });
  var faceBtnExportCsvNew = document.getElementById('face-btn-export-csv-new');
  if (faceBtnExportCsvNew) faceBtnExportCsvNew.addEventListener('click', function(){ flashButton(this); pluginDebug('face-btn-export-csv-new clicked'); exportFaceMeshCSVNew(); });
  var faceBtnImportMesh = document.getElementById('face-btn-import-mesh');
  if (faceBtnImportMesh) faceBtnImportMesh.addEventListener('click', function(){ flashButton(this); pluginDebug('face-btn-import-mesh clicked'); importFaceMeshData(); });

  // Face probe stylus cap sync on Setup tab change
  var probeStylusEl = document.getElementById('probeStylusCalloutLength');
  if (probeStylusEl) probeStylusEl.addEventListener('input', fpUpdateStylusCapInfo);

  // Initialize face probe tab on page load
  fpUpdateStylusCapInfo();
  updateFaceMeshDataUI();
  initFacePVizRotation();
})();


// ── Face Probe Data Helper ────────────────────────────────────────────────────

function getFaceMeshData() {
  // Returns the best available face probe data: layered results first, then filtered single-pass
  if (layeredFaceResults && layeredFaceResults.length) return layeredFaceResults;
  if (faceResults && faceResults.length) {
    var filtered = faceResults.filter(function(r) { return r.type === 'face' && r.status && r.status.indexOf('MISS') === -1; });
    return filtered.length ? filtered : null;
  }
  return null;
}

// ── Face Wall Grid Builder ─────────────────────────────────────────────────────
// Converts layered face results into a 2D [colIndex][rowIndex] grid suitable
// for rendering as a perpendicular wall below the front edge of the top surface.
// Rows are sorted ascending by layer (layer 1 = deepest = bottom, layer N = top).
// Returns null when data is insufficient for triangulated rendering (<2 cols or rows).
function buildFaceWallGrid() {
  var data = getFaceMeshData();
  if (!data || !data.length) return null;

  // Collect unique X positions (rounded to 3 dp to merge near-identical floats)
  // and layer numbers. Build an index map for O(1) lookup during grid fill.
  var xKeyToVal = {}, layerSet = {};
  data.forEach(function(r) {
    var key = Number(r.x).toFixed(3);
    // Use the first seen exact value for this rounded key to avoid drift
    if (!(key in xKeyToVal)) xKeyToVal[key] = Number(r.x);
    layerSet[r.layer != null ? r.layer : 1] = true;
  });

  var xs = Object.keys(xKeyToVal)
    .map(function(k) { return xKeyToVal[k]; })
    .sort(function(a, b) { return a - b; });
  var layers = Object.keys(layerSet).map(Number).sort(function(a, b) { return a - b; });
  // layers[0] = deepest (bottom of wall), layers[N-1] = shallowest (top, shared edge)

  if (xs.length < 2 || layers.length < 2) return null;

  // Pre-build lookup maps for O(1) index resolution during grid fill
  var xIndexMap = {}; // rounded x key → column index
  xs.forEach(function(v, i) { xIndexMap[v.toFixed(3)] = i; });
  var layerIndexMap = {}; // layer number → row index
  layers.forEach(function(l, i) { layerIndexMap[l] = i; });

  // Build grid: grid[li][xi] = {x, y, z, layer, sampleTopZ}
  var grid = [];
  for (var li = 0; li < layers.length; li++) { grid.push({}); }

  data.forEach(function(r) {
    var xi = xIndexMap[Number(r.x).toFixed(3)];
    if (xi == null) return;
    var l = r.layer != null ? r.layer : 1;
    var li = layerIndexMap[l];
    if (li == null) return;
    if (!grid[li][xi]) grid[li][xi] = r;
  });

  // Compute Z range (layer heights) and Y range (contact coordinate) across all face data
  var zMin = Infinity, zMax = -Infinity;
  var yMin = Infinity, yMax = -Infinity;
  data.forEach(function(r) {
    var z = Number(r.z);
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
    var y = Number(r.y);
    if (isFinite(y)) { if (y < yMin) yMin = y; if (y > yMax) yMax = y; }
  });
  if (!isFinite(yMin)) { yMin = 0; yMax = 1; }

  return {
    grid: grid,
    xs: xs,
    layers: layers,
    nCols: xs.length,
    nRows: layers.length,
    xMin: xs[0],
    xMax: xs[xs.length - 1],
    zMin: zMin,
    zMax: zMax,
    yMin: yMin,
    yMax: yMax
  };
}

// ── Face Wall SVG Renderer ─────────────────────────────────────────────────────



function fpReadRow1ZStart() {
  if (!smMeshData || !smGridConfig) {
    alert('No surface mesh data available.\n\nRun a Surface Probe first, or enter Z Start manually.');
    return;
  }
  var row0 = smMeshData[0];
  if (!row0 || !row0.length) {
    alert('Row 1 of surface mesh is empty. Run a surface probe first.');
    return;
  }
  var validZ = row0.filter(function(z) { return z != null && isFinite(z); });
  if (!validZ.length) { alert('Row 1 has no valid Z values.'); return; }
  var avgZ = validZ.reduce(function(a, b) { return a + b; }, 0) / validZ.length;
  var el = document.getElementById('fp-zStart');
  if (el) el.value = avgZ.toFixed(3);
  fpUpdateStylusCapInfo();
  var statusEl = document.getElementById('face-meshStorageStatus');
  if (statusEl) statusEl.textContent = 'Z Start loaded from Row 1 average: ' + avgZ.toFixed(3) + ' coords (' + validZ.length + ' points).';
}

function fpUpdateStylusCapInfo() {
  var stylusLen = Number((document.getElementById('probeStylusCalloutLength') || {}).value) || FACE_PROBE_DEFAULT_MAX_DEPTH;
  var infoEl = document.getElementById('fp-stylus-cap-info');
  if (infoEl) infoEl.textContent = 'Max = ' + stylusLen.toFixed(3) + ' coords (probe stylus callout length from Setup)';
  fpValidateZEnd();
}

function fpValidateZEnd() {
  var stylusLen = Number((document.getElementById('probeStylusCalloutLength') || {}).value) || FACE_PROBE_DEFAULT_MAX_DEPTH;
  var zEndEl = document.getElementById('faceMaxDepth');
  var warningEl = document.getElementById('fp-stylus-warning');
  if (!zEndEl || !warningEl) return;
  var zEnd = Number(zEndEl.value);
  if (isFinite(zEnd) && zEnd > stylusLen) {
    warningEl.style.display = '';
    zEndEl.style.borderColor = 'var(--bad)';
  } else {
    warningEl.style.display = 'none';
    zEndEl.style.borderColor = '';
  }
}


// ── Face Mesh Data Management ─────────────────────────────────────────────────

function updateFaceMeshDataUI() {
  updateFaceMeshTable();
  initFacePVizRotation();
  facePVizResetView();
  renderFacePVizMesh();
  updateFaceCompGridInfo();
  // Update Results tab 3D viz and data table so face-only probing stays in sync
  renderResVizMesh();
  populateSurfaceResults();
  // Render face relief map to all instances (Probe tab + Results tab)
  // then auto-switch probe-tab face section to heatmap view
  setTimeout(function() {
    renderFaceReliefMap();
    setTimeout(function() { showProbeHeatmapView('face'); }, 120);
  }, 60);
  // Auto-populate Apply tab reference position if still at default (0)
  var refEl = document.getElementById('apply-face-refPos');
  if (refEl && (!refEl.value || Number(refEl.value) === 0)) {
    var data = getFaceMeshData();
    if (data && data.length) {
      var axisEl = document.getElementById('apply-face-axis');
      var ax = axisEl ? (axisEl.value || 'Y').toUpperCase() : 'Y';
      var vals = [], sum = 0;
      for (var i = 0; i < data.length; i++) {
        var v = ax === 'X' ? Number(data[i].x) : Number(data[i].y);
        if (!isNaN(v)) vals.push(v);
      }
      if (vals.length) {
        for (var j = 0; j < vals.length; j++) sum += vals[j];
        var mean = Math.round((sum / vals.length) * 1000) / 1000;
        refEl.value = mean;
        var statsEl = document.getElementById('apply-face-refPos-stats');
        if (statsEl) {
          var mn = vals[0], mx = vals[0];
          for (var k = 0; k < vals.length; k++) {
            if (vals[k] < mn) mn = vals[k];
            if (vals[k] > mx) mx = vals[k];
          }
          statsEl.textContent = 'Auto: Mean ' + mean.toFixed(3) + ' | Min: ' + mn.toFixed(3) +
            ' | Max: ' + mx.toFixed(3) + ' | ' + vals.length + ' points';
        }
      }
    }
  }
}

function updateFaceMeshTable() {
  var tbody = document.getElementById('face-meshTableBody');
  if (!tbody) return;
  var data = getFaceMeshData();
  if (!data || !data.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:16px;">No data yet</td></tr>';
    var vizStatus = document.getElementById('face-meshVizStatus');
    if (vizStatus) vizStatus.textContent = 'No face mesh data — run a face probe or load face mesh';
    return;
  }
  var rows = [];
  data.forEach(function(p, i) {
    var layer = p.layer != null ? p.layer : (p.type === 'face' ? 1 : '-');
    rows.push('<tr><td>' + (i + 1) + '</td><td>' + Number(p.x).toFixed(3) + '</td><td>' +
      Number(p.y).toFixed(3) + '</td><td>' + Number(p.z).toFixed(3) + '</td><td>' + layer + '</td></tr>');
  });
  tbody.innerHTML = rows.join('');
  var vizStatus = document.getElementById('face-meshVizStatus');
  if (vizStatus) vizStatus.textContent = data.length + ' contact points across ' +
    (layeredFaceResults && layeredFaceResults.length ? new Set(layeredFaceResults.map(function(p){ return p.layer; })).size : 1) + ' layer(s)';
}

function saveFaceMeshData() {
  var data = getFaceMeshData();
  if (!data || !data.length) { alert('No face mesh data to save. Run a face probe first.'); return; }
  var payload = { faceMeshData: data, timestamp: Date.now() };
  var json = JSON.stringify(payload, null, 2);
  try { localStorage.setItem(FACE_MESH_STORAGE_KEY, json); } catch(e) {}
  if (window.showSaveFilePicker) {
    window.showSaveFilePicker({
      suggestedName: 'face_mesh_' + Date.now() + '.json',
      types: [{ description: 'Face Mesh JSON', accept: { 'application/json': ['.json'] } }]
    }).then(function(handle) {
      return handle.createWritable().then(function(writable) {
        return writable.write(json).then(function() { return writable.close(); });
      });
    }).then(function() {
      var el = document.getElementById('face-meshStorageStatus');
      if (el) el.textContent = 'Face mesh saved to file and browser storage.';
    }).catch(function(e) {
      if (e && e.name !== 'AbortError') {
        var el = document.getElementById('face-meshStorageStatus');
        if (el) el.textContent = 'Saved to browser storage only. File save cancelled or unavailable.';
      }
    });
  } else {
    var blob = new Blob([json], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'face_mesh_' + Date.now() + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    var el = document.getElementById('face-meshStorageStatus');
    if (el) el.textContent = 'Face mesh saved to file and browser storage.';
  }
}

function loadFaceMeshData() {
  var raw = localStorage.getItem(FACE_MESH_STORAGE_KEY);
  if (!raw) { alert('No face mesh data in browser storage. Run a face probe first or import a file.'); return; }
  try {
    var data = JSON.parse(raw);
    if (data.faceMeshData && data.faceMeshData.length) {
      layeredFaceResultsRaw = data.faceMeshData;
      layeredFaceResults = subdivideFaceMesh(data.faceMeshData, meshSubdivisionSpacing);
      updateFaceMeshDataUI();
      var el = document.getElementById('face-meshStorageStatus');
      if (el) el.textContent = 'Face mesh loaded from browser storage (' + layeredFaceResults.length + ' points).';
    } else { alert('Face mesh storage data is empty or corrupt.'); }
  } catch(e) { alert('Failed to parse face mesh data: ' + e.message); }
}

function clearFaceMeshData() {
  if (!confirm('Clear all face mesh data?')) return;
  layeredFaceResults = [];
  faceResults = [];
  try { localStorage.removeItem(FACE_MESH_STORAGE_KEY); } catch(e) {}
  updateFaceMeshDataUI();
  var el = document.getElementById('face-meshStorageStatus');
  if (el) el.textContent = 'Face mesh cleared.';
}

function exportFaceMeshJSON() {
  var data = getFaceMeshData();
  if (!data || !data.length) { alert('No face mesh data to export. Run a face probe first.'); return; }
  var json = JSON.stringify({ faceMeshData: data, timestamp: Date.now() }, null, 2);
  var blob = new Blob([json], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'face_mesh_export_' + Date.now() + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function exportFaceMeshCSVNew() {
  var data = getFaceMeshData();
  if (!data || !data.length) { alert('No face mesh data to export. Run a face probe first.'); return; }
  var rows = ['# Plugin Version: ' + SM_VERSION, 'Index,X,Y,Z,Layer'];
  data.forEach(function(p, i) {
    rows.push((i + 1) + ',' + Number(p.x).toFixed(3) + ',' + Number(p.y).toFixed(3) + ',' +
      Number(p.z).toFixed(3) + ',' + (p.layer != null ? p.layer : 1));
  });
  var blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'face_mesh_' + Date.now() + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function importFaceMeshData() {
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
        var pts = data.faceMeshData || data;
        if (!Array.isArray(pts)) throw new Error('Expected an array of face mesh points');
        layeredFaceResultsRaw = pts;
        layeredFaceResults = subdivideFaceMesh(pts, meshSubdivisionSpacing);
        updateFaceMeshDataUI();
        var statusEl = document.getElementById('face-meshStorageStatus');
        if (statusEl) statusEl.textContent = 'Face mesh imported: ' + pts.length + ' points.';
      } catch(err) { alert('Failed to parse face mesh file: ' + err.message); }
    };
    reader.readAsText(file);
  };
  inp.click();
}

// ── Face Probe 3D Visualizer ──────────────────────────────────────────────────

function facePVizApplyRotation() {
  var el = document.getElementById('face-pviz-3dscene');
  if (el) el.style.transform = 'rotateX(' + _facePvizRotX + 'deg) rotateY(' + _facePvizRotY + 'deg) rotateZ(' + _facePvizRotZ + 'deg)';
}

function facePVizResetView() {
  _facePvizRotX = 20; _facePvizRotY = -25; _facePvizRotZ = 0;
  facePVizApplyRotation();
  var s = _threeState['face'];
  if (s && s.controls) { s.camera.position.set(120, 80, 120); s.camera.lookAt(0, 0, 0); s.controls.reset(); }
}

function initFacePVizRotation() {
  // No-op for CSS drag: OrbitControls on the Three.js canvas handles rotation.
  // Wire up the reset button and double-click reset once.
  var scene = document.getElementById('face-pviz-scene');
  if (scene && !scene._facePvizInited) {
    scene._facePvizInited = true;
    scene.addEventListener('dblclick', facePVizResetView);
  }
  var resetBtn = document.getElementById('face-pviz-reset-btn');
  if (resetBtn && !resetBtn._pvizResetInited) {
    resetBtn._pvizResetInited = true;
    resetBtn.addEventListener('click', function(e) { e.stopPropagation(); facePVizResetView(); });
  }
}

function renderFacePVizMesh() {
  // SVG polygon rendering removed — Three.js WebGL renderer handles the 3D terrain view.
  // Clear old CSS dots from face-pviz-surface (kept for backward compat).
  var surf = document.getElementById('face-pviz-surface');
  var oldDots = surf ? surf.querySelectorAll('.face-pviz-dot') : [];
  Array.prototype.forEach.call(oldDots, function(d) { d.parentNode.removeChild(d); });

  var vizStatus = document.getElementById('face-meshVizStatus');
  var data = getFaceMeshData();
  if (!data || !data.length) {
    if (vizStatus) vizStatus.textContent = 'No face mesh data \u2014 run a face probe or load face mesh';
    renderThreeUnified3D('face');
    return;
  }

  var faceWall = buildFaceWallGrid();
  if (vizStatus) {
    if (faceWall) {
      vizStatus.textContent = (faceWall.nCols * faceWall.nRows) + ' contact points across ' + faceWall.nRows + ' layer(s)';
    } else {
      vizStatus.textContent = data.length + ' contact point(s)';
    }
  }
  renderThreeUnified3D('face');
}

// ── Face Probe Compensation ───────────────────────────────────────────────────

function updateFaceCompGridInfo() {
  var el = document.getElementById('face-comp-grid-info');
  if (el) {
    var data = getFaceMeshData();
    if (!data || !data.length) {
      el.textContent = 'No face mesh loaded \u2014 run a face probe or load face mesh in the Probe tab.';
      el.style.color = 'var(--muted)';
    } else {
      var layerSet = {};
      data.forEach(function(p){ layerSet[p.layer] = true; });
      var layerCount = Object.keys(layerSet).length;
      var xs = data.map(function(p){ return Number(p.x); });
      var zs = data.map(function(p){ return Number(p.z); });
      el.textContent = data.length + ' face contact points across ' + layerCount + ' layer(s) \u2014 X: ' +
        Math.min.apply(null, xs).toFixed(2) + ' to ' + Math.max.apply(null, xs).toFixed(2) +
        ', Z: ' + Math.min.apply(null, zs).toFixed(2) + ' to ' + Math.max.apply(null, zs).toFixed(2);
      el.style.color = 'var(--good)';
    }
  }
}

// ── Face Compensation — 2D bilinear interpolation ────────────────────────────
// Adjusts the lateral axis (Y for Y-face probe, X for X-face probe) in G-code
// by interpolating the face mesh at each (sampleCoord, Z) position.
// This corrects the toolpath to follow the actual face contour at each depth.
// referenceContact = the nominal/expected flat face position (Y or X value).
// overrideAxis (optional): when 'X' or 'Y', use directly instead of auto-detecting.
function faceApplyCompensationCore(gcodeText, contactPoints, referenceContact, overrideAxis, uniformOffset) {

  // ── Detect face axis ──────────────────────────────────────────────────────
  // For a Y-axis face probe: the probe moved along Y, so:
  //   sampleCoord = r.x (position along the slab), contactVal = r.y (Y contact)
  // For an X-axis face probe: the probe moved along X, so:
  //   sampleCoord = r.y (position along the slab), contactVal = r.x (X contact)
  var faceAxis = 'Y';
  // Use explicit axis override if provided by caller (from Apply tab dropdown)
  if (overrideAxis && (overrideAxis === 'X' || overrideAxis === 'Y')) {
    faceAxis = overrideAxis;
  } else {
    var statusText = contactPoints.map(function(p){ return String(p.status || ''); }).join(' ');
    if (statusText.indexOf('FACE X') >= 0) faceAxis = 'X';
    else if (statusText.indexOf('FACE Y') >= 0) faceAxis = 'Y';
    else {
      var xr = Math.max.apply(null, contactPoints.map(function(p){ return Number(p.x); })) -
               Math.min.apply(null, contactPoints.map(function(p){ return Number(p.x); }));
      var yr = Math.max.apply(null, contactPoints.map(function(p){ return Number(p.y); })) -
               Math.min.apply(null, contactPoints.map(function(p){ return Number(p.y); }));
      faceAxis = xr >= yr ? 'X' : 'Y';
    }
  }

  var sampleFn   = faceAxis === 'X'
    ? function(p){ return Number(p.y); }   // X-face: sample coord is Y
    : function(p){ return Number(p.x); };  // Y-face: sample coord is X
  var contactFn  = faceAxis === 'X'
    ? function(p){ return Number(p.x); }   // X-face: contact value is X
    : function(p){ return Number(p.y); };  // Y-face: contact value is Y

  // ── Build 2D interpolation grid (sampleCoord × Z_depth → contactValue) ──────
  var sampleMap = {}, zMap = {};
  contactPoints.forEach(function(p) {
    var sk = sampleFn(p).toFixed(4), zk = Number(p.z).toFixed(4);
    if (!(sk in sampleMap)) sampleMap[sk] = sampleFn(p);
    if (!(zk in zMap))      zMap[zk]      = Number(p.z);
  });

  var sampleVals = Object.keys(sampleMap).map(function(k){ return sampleMap[k]; })
                         .sort(function(a, b){ return a - b; });
  var zVals      = Object.keys(zMap).map(function(k){ return zMap[k]; })
                         .sort(function(a, b){ return a - b; });

  var sIdxMap = {}, zIdxMap = {};
  sampleVals.forEach(function(v, i){ sIdxMap[v.toFixed(4)] = i; });
  zVals.forEach(function(v, i){ zIdxMap[v.toFixed(4)] = i; });

  // grid[zi][si] = contact value (or null if no data for that cell)
  var grid = [];
  for (var gi = 0; gi < zVals.length; gi++) {
    var row = [];
    for (var gj = 0; gj < sampleVals.length; gj++) row.push(null);
    grid.push(row);
  }
  contactPoints.forEach(function(p) {
    var si = sIdxMap[sampleFn(p).toFixed(4)];
    var zi = zIdxMap[Number(p.z).toFixed(4)];
    if (si != null && zi != null && grid[zi][si] === null) grid[zi][si] = contactFn(p); // si/zi come from object key lookup, != null is correct
  });

  // ── Lower-bound binary search helper ─────────────────────────────────────
  function lowerBound(arr, val) {
    if (val <= arr[0]) return 0;
    if (val >= arr[arr.length - 1]) return arr.length - 2;
    var lo = 0, hi = arr.length - 1;
    while (lo < hi - 1) {
      var mid = (lo + hi) >> 1;
      if (arr[mid] <= val) lo = mid; else hi = mid;
    }
    return lo;
  }

  // ── Bilinear interpolation at (qSample, qZ) ───────────────────────────────
  // When fewer than 2 unique values exist on an axis, degrades gracefully.
  function interpolateContact(qSample, qZ) {
    var sn = sampleVals.length, zn = zVals.length;

    // Degenerate cases
    if (sn === 0 || zn === 0) return null;
    if (sn === 1 && zn === 1) {
      var cv = grid[0][0];
      return cv !== null ? cv - referenceContact : null;
    }

    var si0, si1, fi;
    if (sn === 1) { si0 = si1 = 0; fi = 0; }
    else { si0 = lowerBound(sampleVals, qSample); si1 = si0 + 1; var sSpan = sampleVals[si1] - sampleVals[si0]; fi = sSpan > 0 ? Math.max(0, Math.min(1, (qSample - sampleVals[si0]) / sSpan)) : 0; }

    var zi0, zi1, fz;
    if (zn === 1) { zi0 = zi1 = 0; fz = 0; }
    else { zi0 = lowerBound(zVals, qZ); zi1 = zi0 + 1; var zSpan = zVals[zi1] - zVals[zi0]; fz = zSpan > 0 ? Math.max(0, Math.min(1, (qZ - zVals[zi0]) / zSpan)) : 0; }

    var c00 = grid[zi0][si0], c10 = (si1 < sn ? grid[zi0][si1] : null);
    var c01 = grid[zi1][si0], c11 = (si1 < sn ? grid[zi1][si1] : null);

    // Fill null corners from neighbours so interpolation always has a value
    var fallback = c00 !== null ? c00 : (c10 !== null ? c10 : (c01 !== null ? c01 : c11));
    if (fallback === null) return null;
    if (c00 === null) c00 = fallback;
    if (c10 === null) c10 = fallback;
    if (c01 === null) c01 = fallback;
    if (c11 === null) c11 = fallback;

    // Interpolate along sample axis at each Z row
    var c0 = c00 * (1 - fi) + c10 * fi;
    var c1 = c01 * (1 - fi) + c11 * fi;
    // Interpolate along Z axis between the two sample-axis results
    var contactVal = c0 * (1 - fz) + c1 * fz;
    return contactVal - referenceContact;
  }

  // ── Apply compensation to each G-code line ────────────────────────────────
  var lines = gcodeText.split('\n');
  var output = [];
  var currentX = 0, currentY = 0, currentZ = 0;
  var linesModified = 0;
  var totalSegments = 0;

  // Compute segment length from face mesh sample spacing (distance between consecutive sample coords)
  var segmentLength = 2.0; // default 2mm fallback
  if (sampleVals.length > 1) {
    var minSpacing = Infinity;
    for (var si = 1; si < sampleVals.length; si++) {
      var sp = sampleVals[si] - sampleVals[si - 1];
      if (sp > 0 && sp < minSpacing) minSpacing = sp;
    }
    if (minSpacing < Infinity) segmentLength = minSpacing;
  }

  // ── Pass 1 (uniform offset mode): pre-compute one offset per move group ──────
  // Groups are separated by G0 rapids, Z retracts (pz >= 0 catches V-carve retracts
  // to Z=0 between letter strokes), or non-move lines.  Every G1 line in a group
  // receives the same Y (or X) offset derived from the group centroid, preserving
  // the internal letter geometry.
  var lineGroupOffset = null; // null → per-point mode; array → uniform mode
  if (uniformOffset) {
    var p1X = 0, p1Y = 0, p1Z = 0;
    var grpLines = [], grpSamples = [], grpZs = [];
    lineGroupOffset = [];
    for (var pi = 0; pi < lines.length; pi++) lineGroupOffset.push(null);

    var finalizeGrp = function() {
      if (grpLines.length > 0 && grpSamples.length > 0) {
        var avgS = 0, avgGZ = 0;
        for (var gk = 0; gk < grpSamples.length; gk++) avgS += grpSamples[gk];
        for (var gk = 0; gk < grpZs.length; gk++) avgGZ += grpZs[gk];
        avgS  /= grpSamples.length;
        avgGZ /= grpZs.length;
        var grpOff = interpolateContact(avgS, avgGZ);
        for (var gk = 0; gk < grpLines.length; gk++) lineGroupOffset[grpLines[gk]] = grpOff;
      }
      grpLines = []; grpSamples = []; grpZs = [];
    };

    for (var pi = 0; pi < lines.length; pi++) {
      var pl = lines[pi].trim();
      if (!pl || pl.startsWith(';') || pl.startsWith('(')) continue;
      var plIsG0 = /^(?:N\d+\s+)?G0\b|^(?:N\d+\s+)?G00\b/i.test(pl);
      var plIsG1 = /^(?:N\d+\s+)?G1\b/i.test(pl);
      var pxM = pl.match(/X(-?[\d.]+)/i);
      var pyM = pl.match(/Y(-?[\d.]+)/i);
      var pzM = pl.match(/Z(-?[\d.]+)/i);
      var px = pxM ? parseFloat(pxM[1]) : p1X;
      var py = pyM ? parseFloat(pyM[1]) : p1Y;
      var pz = pzM ? parseFloat(pzM[1]) : p1Z;
      if (plIsG0) {
        finalizeGrp();
      } else if (plIsG1) {
        if (pz >= 0) {
          // Retract move — end current group but don't add this line to a group
          // (pz >= 0 catches V-carve retracts to Z=0 as well as clearance moves)
          finalizeGrp();
        } else {
          grpLines.push(pi);
          grpSamples.push(faceAxis === 'Y' ? px : py);
          grpZs.push(pz);
        }
      } else {
        // Non-move line (tool change, spindle command, etc.) — end group
        finalizeGrp();
      }
      p1X = px; p1Y = py; p1Z = pz;
    }
    finalizeGrp(); // finalize any trailing group
  }

  // Prepend informational header comments
  var viewOrientation = faceAxis === 'Y' ? 'XZ plane (side view) for best visualization' : 'YZ plane (side view) for best visualization';
  output.push('; Face-compensated G-code generated by 3D Live Edge Mesh');
  output.push('; Compensation type: Face (' + faceAxis + '-axis)');
  output.push('; Face probe data: ' + contactPoints.length + ' contact points');
  output.push('; Offset mode: ' + (uniformOffset ? 'uniform per move group (preserves letter shapes)' : 'per-point interpolation'));
  output.push('; Compensation axis: ' + faceAxis + ' adjusted based on face contour at each (sampleCoord, Z) position');
  output.push('; View orientation: ' + viewOrientation);
  output.push('; Subdivision: enabled (segment length=' + segmentLength.toFixed(2) + ')');
  output.push('; NOTE: ncSender shows XY plane (top-down). Use the plugin toolpath preview to verify face contour.');
  output.push('');

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) { output.push(lines[i]); continue; }
    var isMove = /^(?:N\d+\s+)?G[01]\b/i.test(line) || /\b[XYZ][-\d.]/i.test(line);
    if (!isMove) { output.push(lines[i]); continue; }

    var xMatch = line.match(/X(-?[\d.]+)/i);
    var yMatch = line.match(/Y(-?[\d.]+)/i);
    var zMatch = line.match(/Z(-?[\d.]+)/i);
    var fMatch = line.match(/F(-?[\d.]+)/i);

    var startX = currentX, startY = currentY, startZ = currentZ;
    var targetX = xMatch ? parseFloat(xMatch[1]) : currentX;
    var targetY = yMatch ? parseFloat(yMatch[1]) : currentY;
    var targetZ = zMatch ? parseFloat(zMatch[1]) : currentZ;

    currentX = targetX;
    currentY = targetY;
    currentZ = targetZ;

    // Compensate any G1 move that has an explicit face-axis coordinate, OR that moves
    // along the sample axis or changes Z (face position varies with both).
    // This ensures lines like "G1 X10 Z-2" (no Y) also get face compensation applied.
    var isG1Linear = /^(?:N\d+\s+)?G1\b/i.test(line);
    var hasFaceCoord = faceAxis === 'Y' ? !!yMatch : !!xMatch;
    var sampleAxisDist = faceAxis === 'Y' ? Math.abs(targetX - startX) : Math.abs(targetY - startY);
    var needsCompensation = hasFaceCoord || (isG1Linear && (sampleAxisDist > 0 || targetZ !== startZ));
    // In uniform mode only process G1 lines that belong to a cutting group
    if (lineGroupOffset !== null) needsCompensation = isG1Linear && lineGroupOffset[i] !== null;

    if (needsCompensation) {
      if (isG1Linear && sampleAxisDist > segmentLength) {
        // Subdivide into N segments for smooth face-contour following
        var nSegs = Math.ceil(sampleAxisDist / segmentLength);
        var dx = targetX - startX;
        var dy = targetY - startY;
        var dz = targetZ - startZ;
        var feedStr = fMatch ? (' F' + parseFloat(fMatch[1]).toFixed(0)) : '';

        for (var sn = 1; sn <= nSegs; sn++) {
          var t = sn / nSegs;
          var segX = startX + dx * t;
          var segY = startY + dy * t;
          var segZ = startZ + dz * t;
          var qSeg = faceAxis === 'Y' ? segX : segY;
          var offSeg = (lineGroupOffset !== null) ? lineGroupOffset[i] : interpolateContact(qSeg, segZ);
          var segLine;
          if (offSeg !== null) {
            if (faceAxis === 'Y') {
              segLine = 'G1 X' + segX.toFixed(3) + ' Y' + (segY + offSeg).toFixed(3) + ' Z' + segZ.toFixed(3);
            } else {
              segLine = 'G1 X' + (segX + offSeg).toFixed(3) + ' Y' + segY.toFixed(3) + ' Z' + segZ.toFixed(3);
            }
            linesModified++;
          } else {
            segLine = 'G1 X' + segX.toFixed(3) + ' Y' + segY.toFixed(3) + ' Z' + segZ.toFixed(3);
          }
          if (sn === 1) segLine += feedStr;
          output.push(segLine);
          totalSegments++;
        }
      } else {
        var qSample = faceAxis === 'Y' ? currentX : currentY;
        var offset  = (lineGroupOffset !== null) ? lineGroupOffset[i] : interpolateContact(qSample, currentZ);
        if (offset !== null) {
          if (faceAxis === 'Y') {
            var newY = currentY + offset;
            if (hasFaceCoord) {
              line = line.replace(/Y(-?[\d.]+)/i, 'Y' + newY.toFixed(3));
            } else {
              line = line + ' Y' + newY.toFixed(3);
            }
          } else {
            var newX = currentX + offset;
            if (hasFaceCoord) {
              line = line.replace(/X(-?[\d.]+)/i, 'X' + newX.toFixed(3));
            } else {
              line = line + ' X' + newX.toFixed(3);
            }
          }
          linesModified++;
        }
        output.push(line);
      }
    } else {
      output.push(line);
    }
  }
  return { gcode: output.join('\n'), modified: linesModified, faceAxis: faceAxis, segments: totalSegments };
}

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

  // Combined export panel — only visible in combined mode
  var combExport = document.getElementById('combined-export-panel');
  if (combExport) combExport.style.display = (type === 'combined') ? '' : 'none';

  // Combined settings panel — only visible in combined mode
  var combSettings = document.getElementById('combined-settings-panel');
  if (combSettings) combSettings.style.display = (type === 'combined') ? '' : 'none';

  // Auto-fill Bottom Z when switching into combined mode
  if (type === 'combined') _autoFillCombinedBottomZ();
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
  var btnFaceX = document.getElementById('btn-face-x');
  var btnFaceY = document.getElementById('btn-face-y');
  if (runBtn) runBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = false;
  if (btnFaceX) btnFaceX.disabled = true;
  if (btnFaceY) btnFaceY.disabled = true;

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
      _smSkipFinishMotion = true; // Skip home detour in combined mode — go directly to Phase 1.5/face probe
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

    smLogProbe('COMBINED: Phase 1.5 — probing top surface at face line Y coordinate...');
    setFooterStatus('Combined probe: running top-surface reference phase\u2026', 'warn');

    // Phase 1.5: Physically probe the top surface at the exact face line Y coordinate
    // for each face sample X position so the face probe gets real measured top-Z values
    // rather than interpolated grid row 0 values.
    topResults = [];
    var _phase15FallbackNeeded = false;
    try {
      var _p15Settings = getSettingsFromUI();
      var _p15FaceY = _p15Settings.faceFixedCoord;
      var _p15ClearanceZ = Number((document.getElementById('sm-clearanceZ') || {}).value) || 5;
      var _p15TravelFeed = Number((document.getElementById('sm-travelFeed') || {}).value) || 600;
      var _p15ProbeFeed = _p15Settings.topFeed;
      var _p15MaxPlunge = _p15Settings.topProbeDepth;
      var _p15Retract = _p15Settings.topRetract;

      // Compute face sample X positions — prefer fpBuildFaceSamplesFromConfig() when
      // mesh data is available (same logic used in runFaceProbe).
      var _p15Samples = null;
      if (smMeshData && smGridConfig) {
        _p15Samples = fpBuildFaceSamplesFromConfig();
      }
      // Fallback: use grid column X positions when face config is unavailable.
      if (!_p15Samples || _p15Samples.length === 0) {
        if (smGridConfig) {
          _p15Samples = [];
          for (var _p15ci = 0; _p15ci < smGridConfig.colCount; _p15ci++) {
            _p15Samples.push({ index: _p15ci + 1, sampleCoord: smGridConfig.minX + _p15ci * smGridConfig.colSpacing });
          }
        }
      }

      if (!_p15Samples || _p15Samples.length === 0) {
        throw new Error('No face sample X positions available for Phase 1.5');
      }

      var _p15Total = _p15Samples.length;
      pluginDebug('runCombinedProbeMode Phase 1.5: faceY=' + _p15FaceY + ' samples=' + _p15Total + ' maxPlunge=' + _p15MaxPlunge + ' probeFeed=' + _p15ProbeFeed);

      for (var _p15i = 0; _p15i < _p15Total; _p15i++) {
        if (_stopRequested) { checkStop(); }
        var _p15xPos = _p15Samples[_p15i].sampleCoord;
        smLogProbe('COMBINED Phase 1.5: probing top surface at X=' + _p15xPos.toFixed(3) + ' Y=' + _p15FaceY.toFixed(3) + ' (' + (_p15i + 1) + '/' + _p15Total + ')');
        pluginDebug('runCombinedProbeMode Phase 1.5: sample ' + (_p15i + 1) + '/' + _p15Total + ' X=' + _p15xPos.toFixed(3) + ' Y=' + _p15FaceY.toFixed(3));

        await smSafeLateralMove(_p15xPos, _p15FaceY, _p15TravelFeed, _p15ClearanceZ);
        await smEnsureProbeClear(_p15ClearanceZ, _p15TravelFeed);
        var _p15Contact = await smPlungeProbe(_p15MaxPlunge, _p15ProbeFeed);
        if (!_p15Contact || !isFinite(_p15Contact.z)) {
          throw new Error('Phase 1.5 probe returned invalid contact position at X=' + _p15xPos.toFixed(3));
        }

        topResults.push({
          type: 'top',
          index: _p15i + 1,
          sampleCoord: _p15xPos,
          targetSamplePos: _p15xPos,
          x: Number(_p15Contact.x),
          y: Number(_p15Contact.y),
          z: Number(_p15Contact.z),
          machineZ: _p15Contact.machineZ != null ? Number(_p15Contact.machineZ) : null,
          status: 'TOP'
        });

        smLogProbe('COMBINED Phase 1.5: contact at Z=' + _p15Contact.z.toFixed(3));
        await smRetractSmall(_p15Contact.z, _p15Retract, _p15TravelFeed);
      }

      smLogProbe('COMBINED Phase 1.5: measured ' + topResults.length + ' top-surface reference points at face line Y=' + _p15FaceY.toFixed(3));
      pluginDebug('runCombinedProbeMode Phase 1.5 complete: ' + topResults.length + ' points at faceY=' + _p15FaceY.toFixed(3));
      saveProbeResults();

    } catch (_p15Err) {
      smLogProbe('COMBINED Phase 1.5 ERROR: ' + (_p15Err && _p15Err.message ? _p15Err.message : String(_p15Err)) + ' — falling back to surface mesh row 0 interpolation.');
      pluginDebug('runCombinedProbeMode Phase 1.5 ERROR (fallback): ' + (_p15Err && _p15Err.message ? _p15Err.message : String(_p15Err)));
      console.error('COMBINED Phase 1.5 error (falling back to grid row 0):', _p15Err);
      _phase15FallbackNeeded = true;
    }

    // Fallback: populate topResults from surface mesh row 0 if Phase 1.5 failed.
    if (_phase15FallbackNeeded || topResults.length === 0) {
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
          smLogProbe('COMBINED: (fallback) populated ' + topResults.length + ' top-profile reference points from surface mesh row 0.');
          console.log('COMBINED: topResults (fallback) =', JSON.stringify(topResults.slice(0, 3)));
        }
      } else {
        smLogProbe('COMBINED: WARNING — smMeshData or smGridConfig is null; topResults will be empty.');
        pluginDebug('runCombinedProbeMode WARNING: smMeshData=' + smMeshData + ' smGridConfig=' + smGridConfig);
      }
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
    var combinedClearZ = Number((document.getElementById('sm-clearanceZ') || {}).value) || 5;
    var combinedTravelFeed = Number((document.getElementById('sm-travelFeed') || {}).value) || 600;
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

    // Configurable pause between surface probe phase and face probe phase
    var phasePauseMs = Math.max(0, Number((document.getElementById('combined-phase-pause') || {}).value) || 0);
    if (phasePauseMs > 0) {
      smLogProbe('COMBINED: surface probe row complete — pausing ' + phasePauseMs + 'ms before face probe...');
      logLine('face', 'COMBINED MODE: surface probe row complete — pausing ' + phasePauseMs + 'ms before face probe...');
      await sleep(phasePauseMs);
      smLogProbe('COMBINED: pause complete — starting face probe phase (axis=' + axis + ')...');
      logLine('face', 'COMBINED MODE: pause complete — starting face probe phase (axis=' + axis + ')...');
    }

    setFooterStatus('Combined probe: running face probe phase (' + axis + ')\u2026', 'warn');
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
    if (btnFaceX) btnFaceX.disabled = false;
    if (btnFaceY) btnFaceY.disabled = false;
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


