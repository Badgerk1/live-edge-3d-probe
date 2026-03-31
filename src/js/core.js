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
  smStopFlag = true;
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

function getSettingsFromUI(){
  function _val(id){ var el = document.getElementById(id); return el ? el.value : null; }
  function _num(id, def){ var v = parseFloat(_val(id)); return isFinite(v) ? v : (def !== undefined ? def : 0); }
  function _bool(id){ var v = _val(id); return v === 'yes' || v === 'true' || v === true; }
  function _chk(id){ var el = document.getElementById(id); return el ? el.checked : false; }
  function _str(id, def){ var v = _val(id); return (v != null && v !== '') ? v : (def !== undefined ? def : ''); }
  return {
    // Travel / recovery feeds
    travelFeedRate:             _num('travelFeedRate', 600),
    travelRecoveryFeedRate:     _num('travelRecoveryFeedRate', 1500),
    travelRecoveryLiftFeedRate: _num('travelRecoveryLiftFeedRate', 1000),
    travelContactLift:          _num('travelContactLift', 5),
    travelContactStep:          _num('travelContactStep', 5),
    travelContactBackoff:       _num('travelContactBackoff', 5),
    travelContactMaxRetries:    _num('travelContactMaxRetries', 5),
    // Finish motion
    finishHomeZ:            _num('finishHomeZ', 10),
    useMachineHomeRetract:  _bool('useMachineHomeRetract'),
    machineSafeTopZ:        _num('machineSafeTopZ', 0),
    returnToXYZero:         _bool('returnToXYZero'),
    // Mesh subdivision
    meshSubdivisionSpacing: _num('meshSubdivisionSpacing', 2),
    // Top profile settings
    sampleAxis:     _str('sampleAxis', 'X'),
    topFixedCoord:  _num('topFixedCoord', 0),
    topFeed:        _num('topFeed', 200),
    topProbeDepth:  _num('topProbeDepth', 5),
    topRetract:     _num('topRetract', 2),
    topClearZ:      _num('topClearZ', 5),
    // Face probe settings
    faceStartOffset:        _num('faceStartOffset', -10),
    faceFeed:               _num('faceFeed', 150),
    faceRetractFeed:        _num('faceRetractFeed', 1000),
    faceDepthBelowSurface:  _num('faceDepthBelowSurface', 2),
    faceProbeDistance:      _num('faceProbeDistance', 20),
    faceFixedCoord:         _num('faceFixedCoord', 0),
    faceMaxDepth:           _num('faceMaxDepth', 14.75),
    faceLayerCount:         _num('faceLayerCount', 3),
    enableLayeredFace:      _chk('enableLayeredFace'),
    // Probe dimensions
    probeShankDiameter:         _val('probeShankDiameter'),
    probeBodyDiameter:          _val('probeBodyDiameter'),
    probeUpperHeight:           _val('probeUpperHeight'),
    probeMainBodyHeight:        _val('probeMainBodyHeight'),
    probeStylusLength:          _val('probeStylusLength'),
    probeStylusCalloutLength:   _val('probeStylusCalloutLength'),
    probeBallTipDiameter:       _val('probeBallTipDiameter'),
    probeTotalLength:           _val('probeTotalLength')
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
  for(var i = 0; i < 6000; i++){
    await sleep(30);
    checkStop();
    var state = await _getState();
    var ms = _machineStateFrom(state);
    var status = String(ms.status || '').toLowerCase();
    if(status !== lastStatus){
      pluginDebug('waitForIdle: status changed to "' + status + '" (poll #' + i + ')');
      lastStatus = status;
    }
    if(status === 'idle'){
      pluginDebug('waitForIdle EXIT: idle confirmed');
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
  var pos = await waitForIdleWithTimeout();
  pluginDebug('moveMachineZAbs DONE: ' + cmd);
  return pos;
}

// ── Settings helpers ──────────────────────────────────────────────────────────
