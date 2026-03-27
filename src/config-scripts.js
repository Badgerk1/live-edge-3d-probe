var SM_VERSION = 'V19.0';
// ── State ─────────────────────────────────────────────────────────────────────
var _running = false;
var _stopRequested = false;
var topResults = [];
var faceResults = [];
var s = {}; // current run settings — set by runFaceProbe
var TOP_RESULTS_KEY = 'edgeProbeTopResults';
var FACE_RESULTS_KEY = 'edgeProbeFaceResults';
var FACE_LAYERED_RESULTS_KEY = 'edgeProbeFaceLayeredResults';
var FACE_MESH_STORAGE_KEY = 'faceProbe.faceMeshData';
var FACE_PROBE_DEFAULT_MAX_DEPTH = 14.75; // default probe stylus callout length (mm) — cap for Z End
var faceOriginalGcode = null;
var faceCompensatedGcode = null;
var faceLastAppliedAxis = 'Y'; // tracks face axis of most recently applied compensation
var _facePvizRotX = 20, _facePvizRotY = -25, _facePvizRotZ = 0, _faceDragActive = false, _faceDragLastX = 0, _faceDragLastY = 0;
var FACE_LOG_KEY = 'edgeProbeFaceLog';
var SAVED_LOCATION_KEY = 'edgeProbeSavedLocation';
var topLogLines = [];
var faceLogLines = [];
var layeredFaceResults = [];
var MESH_STORAGE_KEY = 'edgeProbeMeshData';
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
  for(var i = 0; i < 1800; i++){
    await sleep(100);
    checkStop();
    var state = await _getState();
    var ms = _machineStateFrom(state);
    var status = String(ms.status || '').toLowerCase();
    if(status !== lastStatus){
      pluginDebug('waitForIdle: status changed to "' + status + '" (poll #' + i + ')');
      lastStatus = status;
    }
    if(status === 'idle'){ pluginDebug('waitForIdle EXIT: idle confirmed'); return; }
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
  await waitForIdleWithTimeout();
  pluginDebug('moveAbs DONE: ' + cmd);
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

  logLine('face', label + ': raising to local safe Z ' + localSafeZ.toFixed(3) + ' (' + safeZSource + ' + ' + retractClearance.toFixed(1) + 'mm clearance)');
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
    logLine(logKind, 'Finish move: lowering to work Z0.000');
    await moveAbs(null, null, 0, s.travelFeedRate || 600);
    logLine(logKind, 'Finish move: at work origin X0.000 Y0.000 Z0.000');
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
  (topResults || []).forEach(function(r){ allRows.push({type:'Top', x:r.x, y:r.y, z:r.z, status:r.status}); });
  (faceResults || []).forEach(function(r){ allRows.push({type:'Face', x:r.x, y:r.y, z:r.z, status:r.status}); });
  if (allRows.length) {
    html += '<div style="max-height:180px;overflow-y:auto;border:1px solid var(--line);border-radius:6px">';
    html += '<table style="font-size:11px"><thead><tr><th>#</th><th>Type</th><th>X</th><th>Y</th><th>Z</th><th>Status</th></tr></thead><tbody>';
    var showMax = Math.min(allRows.length, 50);
    for (var i = 0; i < showMax; i++) {
      var r = allRows[i];
      html += '<tr><td>' + (i+1) + '</td><td>' + (r.type||'') + '</td>';
      html += '<td>' + (r.x != null ? Number(r.x).toFixed(3) : '') + '</td>';
      html += '<td>' + (r.y != null ? Number(r.y).toFixed(3) : '') + '</td>';
      html += '<td>' + (r.z != null ? Number(r.z).toFixed(3) : '') + '</td>';
      html += '<td>' + (r.status||'') + '</td></tr>';
    }
    if (allRows.length > showMax) {
      html += '<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:4px">... and ' + (allRows.length - showMax) + ' more</td></tr>';
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
  if(ut) ut.innerHTML = '<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:16px;">No probe data yet</td></tr>';
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

  var obj = '# 3D Live Edge Mesh - Face Profile\n';
  obj += '# Plugin Version: ' + SM_VERSION + '\n';
  obj += '# Generated ' + new Date().toISOString() + '\n';

  layerKeys.forEach(function(k){
    layerGroups[k].forEach(function(p){
      obj += 'v ' + p.x.toFixed(3) + ' ' + p.y.toFixed(3) + ' ' + p.z.toFixed(3) + '\n';
    });
  });

  var samplesPerLayer = (layerKeys.length > 0 && layerGroups[layerKeys[0]]) ? layerGroups[layerKeys[0]].length : 0;
  // Validate all layers have the same sample count before triangulating
  var canTriangulate = samplesPerLayer > 0 && layerKeys.every(function(k){ return layerGroups[k].length === samplesPerLayer; });
  if(canTriangulate){
    for(var i = 0; i < layerKeys.length - 1; i++){
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
async function probeAbsAxis(axis, target, feed){
    axis = String(axis || '').toUpperCase();
    if(axis !== 'X' && axis !== 'Y') throw new Error('Unsupported face probe axis');
    await sendCommand('G90 G38.2 ' + axis + Number(target).toFixed(3) + ' F' + Number(feed).toFixed(0));
    await waitForIdleWithTimeout();
    return await getWorkPosition();
  }

async function _clearTriggeredProbeByBackingOffGeneric(tab, currentPos, unitX, unitY, s, state){
    var backoff = Math.max(0.1, Number(s.travelContactBackoff) || 5);
    var lift = Math.max(0.1, Number(s.travelContactLift) || Number(s.topRetract) || 5);
    var maxRetries = Math.max(1, Math.round(Number(s.travelContactMaxRetries) || 5));
    if(state.recoveries >= maxRetries){
      throw new Error('Travel path blocked after ' + maxRetries + ' contact recoveries (max added lift ' + (maxRetries * lift).toFixed(3) + ' mm). Raise starting Z or reposition the work.');
    }
    state.recoveries += 1;
    state.totalLift += lift;
    var pos = currentPos;
    var backX = pos.x - unitX * backoff;
    var backY = pos.y - unitY * backoff;
    var liftZ = pos.z + lift;
    logLine(tab, 'TRAVEL CONTACT: recovery ' + state.recoveries + '/' + maxRetries + ' backoff to X=' + Number(backX).toFixed(3) + ' Y=' + Number(backY).toFixed(3) + ' at F' + Number(s.travelRecoveryFeedRate || s.travelFeedRate).toFixed(0) + ', then lift Z to ' + Number(liftZ).toFixed(3) + ' at F' + Number(s.travelRecoveryLiftFeedRate || s.travelRecoveryFeedRate || s.travelFeedRate).toFixed(0) + ' (cumulative added lift ' + Number(state.totalLift).toFixed(3) + ' mm).');
    await moveAbs(backX, backY, null, s.travelRecoveryFeedRate || s.travelFeedRate);
    await moveAbs(null, null, liftZ, s.travelRecoveryLiftFeedRate || s.travelRecoveryFeedRate || s.travelFeedRate);
    await sleep(120);
    pos = await getWorkPosition();
    if(pos.probeTriggered){
      logLine(tab, 'TRAVEL CONTACT WARNING: probe is still triggered after recovery ' + state.recoveries + '/' + maxRetries + '.');
    }
    return pos;
  }

async function segmentedFaceMoveWithRecovery(axis, targetCoord, fixedCoord, probeZ, s, mode, sampleLineCoord){
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
      await moveAbs(smoothX, smoothY, null, s.travelFeedRate);
      pos = await getWorkPosition();
      if(!pos.probeTriggered){
        return {position: pos, extras: extras, contact: null, reachedTarget: true};
      }
      logLine('face', 'FACE REPOSITION: probe was triggered at end of smooth move. Entering segmented recovery to clear path to start.');
    }
  }

  var moveFeed = mode === 'to_start' ? Number(s.travelFeedRate) : Number(s.faceFeed || s.topFeed || s.travelFeedRate);

  if(mode !== 'to_start'){
    logLine('face', 'FACE PROBE: smooth probe move toward ' + axis + ' ' + Number(targetCoord).toFixed(3) + ' at feed ' + moveFeed.toFixed(0) + ' mm/min.');
    var probePos = await probeAbsAxis(axis, Number(targetCoord), moveFeed);
    if(probePos.probeTriggered){
      var hit = makeFaceContactRecord(faceResults.length + extras.length + 1, probePos, axis, 'FACE ' + axis, targetCoord, sampleLineCoord);
      extras.push(hit);
      logLine('face', 'FACE CONTACT: first forward contact at ' + axis + '=' + Number(axis === 'X' ? probePos.x : probePos.y).toFixed(3) + ' on sample line ' + Number(sampleLineCoord).toFixed(3) + '. Stopping this face sample.');
      return {position: probePos, extras: extras, contact: probePos, reachedTarget: false};
    }
    logLine('face', 'FACE PROBE: reached target ' + axis + ' ' + Number(targetCoord).toFixed(3) + ' without contact.');
    return {position: probePos, extras: extras, contact: null, reachedTarget: true};
  }

  logLine('face', label + ': segmented move toward ' + axis + ' ' + Number(targetCoord).toFixed(3) + ' (step ' + stepLen.toFixed(3) + ' mm, feed ' + moveFeed.toFixed(0) + ' mm/min).');

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

    await moveAbs(nextX, nextY, null, (typeof moveFeed !== 'undefined' ? moveFeed : Number(s.travelFeedRate || 600)));
    pos = await getWorkPosition();

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
      if(pos.probeTriggered && recoveryState.recoveries >= maxRetries){
        throw new Error('Face reposition path blocked after ' + maxRetries + ' contact recoveries (max added lift ' + Number(recoveryState.totalLift).toFixed(3) + ' mm). Raise starting Z or reposition the work.');
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
    var startCoord = Number(s.faceStartOffset);
    var depthBelow = Number(s.faceDepthBelowSurface);
    var probeDist = Number(s.faceProbeDistance);
    var targetCoord = startCoord + probeDist;
    var sampledAxis = String(s.sampleAxis || 'X').toUpperCase();
    var fixedCoord = Number(s.faceFixedCoord);
    logLine('face', 'Probe axis ' + axis + ': start=' + startCoord.toFixed(3) + ' target=' + targetCoord.toFixed(3));
    pluginDebug('runFaceProbe: axis=' + axis + ' start=' + startCoord + ' target=' + targetCoord + ' depthBelow=' + depthBelow + ' fixedCoord=' + fixedCoord);

    var topPts = topResults.filter(function(r){ return r.status === 'TOP'; }).sort(function(a, b){
      return Number(a.sampleCoord) - Number(b.sampleCoord);
    });

    var faceSamples = [];
    if(topPts.length && sampledAxis !== axis){
      // When surface mesh data is available, use user-specified X samples count with
      // interpolated topZ so fp-xPoints is honoured instead of always using surface
      // probe column count.
      var configSamples = (smMeshData && smGridConfig) ? fpBuildFaceSamplesFromConfig() : null;
      if(configSamples && configSamples.length >= 2){
        faceSamples = configSamples;
        logLine('face', 'Face probe: user requested ' + faceSamples.length + ' X samples (fp-xPoints).');
        logLine('face', 'Face probe: X positions = [' + faceSamples.map(function(s){ return s.sampleCoord.toFixed(1); }).join(', ') + ']');
        logLine('face', 'Face probe: interpolated topZ = [' + faceSamples.map(function(s){ return s.topZ.toFixed(3); }).join(', ') + ']');
      } else {
        // No surface mesh data — fall back to topPts 1:1 mapping
        faceSamples = topPts.map(function(tp, idx){
          return { index: idx + 1, sampleCoord: Number(tp.sampleCoord), topZ: Number(tp.z) };
        });
        logLine('face', 'Using ' + faceSamples.length + ' indexed face sample(s) from top profile along ' + sampledAxis + ' (no mesh data for interpolation).');
      }
    } else {
      var curPos = await getWorkPosition();
      var fallbackTopZ = topPts.length ? Number(topPts[0].z) : Number(curPos.z);
      if(topPts.length && sampledAxis === axis){
        logLine('face', 'Sample axis matches face probe axis (' + axis + '), so indexed face stepping is unavailable. Falling back to single face line at fixed coordinate ' + fixedCoord.toFixed(3) + '.');
      } else {
        logLine('face', 'No usable top profile samples for indexed face stepping. Falling back to single face line at fixed coordinate ' + fixedCoord.toFixed(3) + '.');
      }
      faceSamples = [{ index: 1, sampleCoord: fixedCoord, topZ: fallbackTopZ }];
    }

    // ── Layered face probe mode ───────────────────────────────────────────────
    if(s.enableLayeredFace){
      var maxDepth = Number(s.faceMaxDepth) || 14.75;
      var layerCount = Math.max(2, Math.round(Number(s.faceLayerCount) || 3));
      var totalLayers = layerCount;

      logLine('face', 'Layered face probe: ' + totalLayers + ' layers, max depth ' + maxDepth.toFixed(3) + 'mm');
      layeredFaceResults = [];

      // Pre-calculate inter-sample retract Z for each layer.
      // For each non-last layer: find the shallowest (closest to zero / highest) next-layer Z
      // across all X samples, then add 2mm clearance buffer.
      // For the last layer: null (signals "use full safe Z").
      // Uses effectiveTopZ = sampleTopZ - 0.05 so the shallowest layer probes 0.05mm below surface.
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
          logLine('face', 'Layer ' + layerNum + '/' + totalLayers + ': probing face at per-sample depth (stylusLen=' + maxDepth.toFixed(3) + 'mm below topZ) across ' + faceSamples.length + ' X samples');
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
          // Shallowest layer probes at sampleTopZ - 0.05 (0.05mm below surface to ensure contact)
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
            await raiseFaceTravelSafeZ('Layer ' + layerNum + ' sample ' + sampleNum + ': safe retract');

            if(axis === 'X'){
              await moveAbs(null, lineCoord, null, 3000);
            } else {
              await moveAbs(lineCoord, null, null, 3000);
            }

            if(axis === 'X'){
              await moveAbs(startCoord, null, null, 3000);
            } else {
              await moveAbs(null, startCoord, null, 3000);
            }
          }
          didOptimizedRetract = false;

          await moveAbs(null, null, layerZ, s.travelRecoveryLiftFeedRate || s.travelFeedRate);

          var _layerFeedLog = Number(s.faceFeed || s.topFeed || s.travelFeedRate || 0);
          logLine('face', 'Layer ' + layerNum + ' sample ' + sampleNum + ': probing toward ' + axis + ' ' + targetCoord.toFixed(3) + ' at feed ' + _layerFeedLog.toFixed(0) + ' mm/min.');
          var faceAdv = await segmentedFaceMoveWithRecovery(axis, targetCoord, lineCoord, layerZ, s, 'probe', lineCoord);
          faceAdv.extras.forEach(function(ep){
            ep.sampleCoord = lineCoord;
            faceResults.push(ep);
          });
          if(faceAdv.extras.length) updateAllResultsUI();

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
              layer: layerNum,
              sampleTopZ: sampleTopZ
            });
          } else {
            logLine('face', 'Layer ' + layerNum + ' sample ' + sampleNum + ': reached target ' + axis + '=' + targetCoord.toFixed(3) + ' without contact.');
            var lMiss = makeFaceContactRecord(faceResults.length + 1, contact, axis, 'FACE ' + axis + ' MISS', targetCoord, lineCoord);
            faceResults.push(lMiss);
          }
          updateAllResultsUI();

          var isLastSampleInLayer = (si === sampleOrder.length - 1);
          var isLastLayer = (li === totalLayers - 1);
          if(!isLastSampleInLayer){
            // Inter-sample retract within a layer: diagonal Y+Z retract then fast X travel.
            // The face axis (Y for Y-probe) ALWAYS retracts fully to startCoord.
            var interRetractZ = layerRetractZ[li];
            var nextSampleCoord = Number(faceSamples[sampleOrder[si + 1]].sampleCoord);
            if(interRetractZ !== null){
              // Non-last layer: diagonal move — retract face axis to start AND raise Z simultaneously.
              logLine('face', 'Inter-sample return (layer ' + layerNum + '): diagonal retract to ' + axis + '=' + startCoord.toFixed(3) + ' Z=' + interRetractZ.toFixed(3) + ' then ' + sampledAxis + '=' + nextSampleCoord.toFixed(3) + '.');
              if(axis === 'X'){
                await moveAbs(startCoord, null, interRetractZ, 3000);
              } else {
                await moveAbs(null, startCoord, interRetractZ, 3000);
              }
            } else {
              // Last layer: full safe retract (no next layer to target).
              await clearFaceProbeAndReturnToStartThenRaise(axis, contact, startCoord, lineCoord, 'Inter-sample return (layer ' + layerNum + ')');
            }
            // Move to next sample position at fast travel speed.
            if(axis === 'X'){
              await moveAbs(null, nextSampleCoord, null, 3000);
            } else {
              await moveAbs(nextSampleCoord, null, null, 3000);
            }
            didOptimizedRetract = true;
          } else if(!isLastLayer){
            // Last sample of layer — transitioning to next layer.
            // Serpentine: next layer starts at this X position, so no X travel needed.
            // Diagonal move: retract face axis to start AND raise to next-layer clearance Z simultaneously.
            var layerTransitionZ = layerRetractZ[li];
            logLine('face', 'Layer ' + layerNum + ' \u2192 ' + (layerNum + 1) + ': diagonal retract to ' + axis + '=' + startCoord.toFixed(3) + ' Z=' + layerTransitionZ.toFixed(3) + ' (serpentine \u2014 next layer starts at ' + sampledAxis + '=' + lineCoord.toFixed(3) + ').');
            if(axis === 'X'){
              await moveAbs(startCoord, null, layerTransitionZ, 3000);
            } else {
              await moveAbs(null, startCoord, layerTransitionZ, 3000);
            }
            didOptimizedRetract = true;
          }
        }
        logLine('face', 'Layer ' + layerNum + '/' + totalLayers + ' complete: ' + layerContacts + ' contact(s)');
      }

      saveProbeResults();
      logLine('face', 'Layered face probe complete: ' + totalLayers + ' layers x ' + faceSamples.length + ' samples = ' + layeredFaceResults.length + ' total contacts');
      pluginDebug('runFaceProbe layered: faceResults=' + faceResults.length + ' layeredFaceResults=' + layeredFaceResults.length);
      await finishRunMotion('face');
      if (!_calledFromCombined) switchTab('results');
      setFooterStatus('Layered face probe ' + axis + ' complete: ' + totalLayers + ' layers x ' + faceSamples.length + ' samples = ' + layeredFaceResults.length + ' contacts', 'good');
      updateFaceMeshDataUI();
      // Re-render surface mesh visualizers to include face wall (even when no surface mesh is present)
      smPvizRenderMesh();
      renderSurfVizMesh();
      renderResVizMesh();
      populateUnifiedProbeTable();
      updateEdgeProbeStorageUI();
      return;
    }

    // ── Single-pass face probe mode (existing behavior unchanged) ─────────────
    for(var i = 0; i < faceSamples.length; i++){
      checkStop();
      var sample = faceSamples[i];
      var lineCoord = Number(sample.sampleCoord);
      var zForProbe = Number(sample.topZ) - depthBelow;
      logLine('face', 'Face sample ' + sample.index + '/' + faceSamples.length + ': line ' + sampledAxis + '=' + lineCoord.toFixed(3) + ' using top Z=' + Number(sample.topZ).toFixed(3) + ' depth below=' + depthBelow.toFixed(3) + ' probe Z=' + zForProbe.toFixed(3));

      await raiseFaceTravelSafeZ('Face sample ' + sample.index + ': safe retract before indexed move');

      if(axis === 'X'){
        logLine('face', 'Face sample ' + sample.index + ': moving to sample line Y=' + lineCoord.toFixed(3) + ' at safe travel Z.');
        await moveAbs(null, lineCoord, null, s.travelFeedRate);
      } else {
        logLine('face', 'Face sample ' + sample.index + ': moving to sample line X=' + lineCoord.toFixed(3) + ' at safe travel Z.');
        await moveAbs(lineCoord, null, null, s.travelFeedRate);
      }

      logLine('face', 'At face sample line. Moving to face start ' + axis + '=' + startCoord.toFixed(3) + ' at safe travel Z before lowering.');
      if(axis === 'X'){
        await moveAbs(startCoord, null, null, s.travelFeedRate);
      } else {
        await moveAbs(null, startCoord, null, s.travelFeedRate);
      }

      logLine('face', 'At face start. Lowering to face probe Z ' + zForProbe.toFixed(3));
      await moveAbs(null, null, zForProbe, s.travelRecoveryLiftFeedRate || s.travelFeedRate);

      var _faceFeedLog = Number(s.faceFeed || s.topFeed || s.travelFeedRate || 0); logLine('face', 'At face start. Probing toward ' + axis + ' ' + targetCoord.toFixed(3) + ' at feed ' + _faceFeedLog.toFixed(0) + ' mm/min.');
      var faceAdvance = await segmentedFaceMoveWithRecovery(axis, targetCoord, lineCoord, zForProbe, s, 'probe', lineCoord);
      faceAdvance.extras.forEach(function(ep){
        ep.sampleCoord = lineCoord;
        faceResults.push(ep);
      });
      if(faceAdvance.extras.length) updateAllResultsUI();

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
      updateAllResultsUI();

      if(i < faceSamples.length - 1){
        await clearFaceProbeAndReturnToStartThenRaise(axis, contact, startCoord, lineCoord, 'Inter-sample return before moving to next ' + sampledAxis + ' sample');
      }
    }

    await finishRunMotion('face');
    if (!_calledFromCombined) switchTab('results');
    pluginDebug('runFaceProbe COMPLETE: axis=' + axis + ' samples=' + faceSamples.length);
    setFooterStatus('Face probe ' + axis + ' complete: ' + faceSamples.length + ' sample(s)', 'good');
    updateFaceMeshDataUI();
    populateUnifiedProbeTable();
    saveProbeResults();
    updateEdgeProbeStorageUI();
    pluginDebug('runFaceProbe single-pass complete: faceResults=' + faceResults.length);

  } catch(e){
    logLine('face', 'ERROR: ' + e.message);
    pluginDebug('runFaceProbe ERROR: axis=' + axis + ' error="' + e.message + '"');
    setFooterStatus('Error: ' + e.message, 'bad');
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
// clearanceZ + 2mm and waits 200ms, then re-checks. Up to maxAttempts retries.
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
    var targetZ = Math.max(pos.z, clearanceZ) + 2; // 2mm above clearance to ensure probe clears
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

  smLogProbe('TRAVEL: lifting Z by ' + clearanceZ.toFixed(3) + 'mm (relative), then moving to X' + targetX.toFixed(3) + ' Y' + targetY.toFixed(3));

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

  // Lift Z by clearanceZ mm relative from current position (contact point), then travel X/Y.
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
  var clearanceZ = Number(document.getElementById('sm-clearanceZ').value) || 5;
  var liftFeed = Number(document.getElementById('travelRecoveryLiftFeedRate').value) ||
                 Number(document.getElementById('sm-travelFeed').value) || 600;

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
  smLogProbe('[PLUGIN DEBUG] smPlungeProbe: startZ=' + startZ.toFixed(3) + ' endZ=' + endPos.z.toFixed(3) + ' traveled=' + distanceTraveled.toFixed(3) + 'mm');
  pluginDebug('smPlungeProbe: travel startZ=' + startZ.toFixed(3) + ' endZ=' + endPos.z.toFixed(3) + ' traveled=' + distanceTraveled.toFixed(3) + 'mm');
  // Contact detected if machine stopped short of maxPlunge (position-based, robust when
  // probe pin clears before idle query) or if Pn still shows 'P' (pin-based)
  var probeContactTolerance = 0.5; // mm; machine must stop at least this far short of maxPlunge
  var stoppedShort = distanceTraveled < (maxPlunge - probeContactTolerance);
  var triggered = await smGetProbeTriggered();
  if (!triggered && !stoppedShort) {
    smLogProbe('[PLUGIN DEBUG] smPlungeProbe ERROR: No contact within max plunge ' + maxPlunge.toFixed(3) + ' mm');
    pluginDebug('smPlungeProbe ERROR: no contact within maxPlunge=' + maxPlunge.toFixed(3));
    throw new Error('No contact within max plunge');
  }
  if (!triggered && stoppedShort) {
    smLogProbe('[PLUGIN DEBUG] smPlungeProbe NOTE: probe pin not active after idle but machine stopped at Z=' + endPos.z.toFixed(3) + ' (' + distanceTraveled.toFixed(3) + 'mm/' + maxPlunge.toFixed(3) + 'mm) — contact detected by position');
    pluginDebug('smPlungeProbe: contact by position (pin cleared), Z=' + endPos.z.toFixed(3));
  }
  pluginDebug('smPlungeProbe EXIT: contact Z=' + endPos.z.toFixed(3));
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
  smLogProbe('[PLUGIN DEBUG] smRetractSmall: sending command: ' + cmd + ' (contact=' + contactZ.toFixed(3) + ' retract=' + retractMm + 'mm)');
  pluginDebug('smRetractSmall: contact=' + contactZ.toFixed(3) + ' retract=' + retractMm + 'mm cmd: ' + cmd);
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
  smLogProbe('[PLUGIN DEBUG] smRetractToZ: sending command: ' + cmd + ' (delta=' + delta.toFixed(3) + 'mm)');
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
        // scale depth over ~10 mm range: shallow (near 0) = green, deep = orange/red
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
  var hasFaceMesh = (typeof _getFaceMeshData === 'function') && !!_getFaceMeshData();

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
      ' &nbsp;|&nbsp; Size: ' + (bounds.max.x - bounds.min.x).toFixed(2) + ' &times; ' + (bounds.max.y - bounds.min.y).toFixed(2) + ' mm';
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
  output.push('(Segment length: ' + segmentLength.toFixed(2) + 'mm)');
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
        // Only add Z to rapid moves at working height (below safe retract threshold of 10mm)
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

function applyFaceCompensationFromTab() {
  if (!applyOriginalGcode) { alert('Load G-code first.'); return; }
  var faceData = (typeof _getFaceMeshData === 'function') ? _getFaceMeshData() : null;
  if (!faceData) { alert('No face mesh data. Run face probing first.'); return; }

  var refPos = Number(document.getElementById('apply-face-refPos').value) || 0;
  var axis = (document.getElementById('apply-face-axis').value || 'Y').toUpperCase();
  var statusEl = document.getElementById('apply-face-status');
  var faceLogEl = document.getElementById('apply-face-log');
  if (faceLogEl) faceLogEl.innerHTML = '';

  applyLogFace('Applying face compensation (axis=' + axis + ', refPos=' + refPos + ')...');

  try {
    if (typeof applyFaceCompensationCore !== 'function') {
      throw new Error('Face compensation core function not available');
    }
    var result = applyFaceCompensationCore(applyOriginalGcode, faceData, refPos, axis);
    applyFaceCompGcode = result.gcode;
    applyLogFace('Done! ' + result.modified + ' ' + axis + ' values adjusted.');
    if (statusEl) { statusEl.textContent = 'Face compensation applied: ' + result.modified + ' values adjusted.'; statusEl.className = 'status-line good'; }
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

function smSaveSettings() {
  var ids = ['sm-minX','sm-maxX','sm-spacingX','sm-minY','sm-maxY','sm-spacingY',
             'sm-probeFeed','sm-travelFeed','sm-clearanceZ','sm-maxPlunge','sm-referenceZ'];
  var data = {};
  ids.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) data[id] = el.value;
  });
  try {
    localStorage.setItem(SM_SURFACE_GRID_SETTINGS_KEY, JSON.stringify(data));
    console.log('[smSaveSettings] Saved 2D surface grid settings:', data);
  } catch(e) {
    console.warn('[smSaveSettings] Failed to save settings:', e);
    return;
  }
  var btn = document.getElementById('sm-btn-save-settings');
  if (btn) {
    var orig = btn.textContent;
    btn.textContent = '\u2713 Saved!';
    btn.style.color = 'var(--accent2)';
    setTimeout(function() { btn.textContent = orig; btn.style.color = ''; }, 1500);
  }
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
  });
  try { updateSurfaceGridSizeDisplay(); } catch(e) { console.warn('[smLoadSettings] updateSurfaceGridSizeDisplay error:', e); }
}

(function init(){
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
  if(btnSave) btnSave.addEventListener('click', function(){ pluginDebug('btn-save-settings clicked'); saveSettings(); });
  var btnLoad = document.getElementById('btn-load-settings');
  if(btnLoad) btnLoad.addEventListener('click', function(){ pluginDebug('btn-load-settings clicked'); loadSettings(); });
  var btnReset = document.getElementById('btn-reset-settings');
  if(btnReset) btnReset.addEventListener('click', function(){ pluginDebug('btn-reset-settings clicked'); resetSettings(); });
  var btnSaveProbeDims = document.getElementById('btn-save-probe-dims');
  if(btnSaveProbeDims) btnSaveProbeDims.addEventListener('click', function(){ pluginDebug('btn-save-probe-dims clicked'); saveProbeDimensions(); });
  var btnSaveLocation = document.getElementById('btn-save-location');
  if(btnSaveLocation) btnSaveLocation.addEventListener('click', function(){ pluginDebug('btn-save-location clicked'); saveCurrentLocation(); });
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
  if(btnFaceX) btnFaceX.addEventListener('click', function(){ pluginDebug('btn-face-x clicked'); runFaceProbe('X'); });
  var btnFaceY = document.getElementById('btn-face-y');
  if(btnFaceY) btnFaceY.addEventListener('click', function(){ pluginDebug('btn-face-y clicked'); runFaceProbe('Y'); });
  var btnStopFace = document.getElementById('btn-stop-face');
  if(btnStopFace) btnStopFace.addEventListener('click', function(){ pluginDebug('btn-stop-face clicked'); stopAll(); });
  var btnSaveFaceLog = document.getElementById('btn-save-face-log');
  if(btnSaveFaceLog) btnSaveFaceLog.addEventListener('click', function(){ pluginDebug('btn-save-face-log clicked'); saveLog('face'); });
  var btnClearFaceLog = document.getElementById('btn-clear-face-log');
  if(btnClearFaceLog) btnClearFaceLog.addEventListener('click', function(){ pluginDebug('btn-clear-face-log clicked'); clearLog('face'); });
  var btnExportFaceCsv = document.getElementById('btn-export-face-csv');
  if(btnExportFaceCsv) btnExportFaceCsv.addEventListener('click', function(){ pluginDebug('btn-export-face-csv clicked'); exportFaceCSV(); });
  var btnExportFaceDxf = document.getElementById('btn-export-face-dxf');
  if(btnExportFaceDxf) btnExportFaceDxf.addEventListener('click', function(){ pluginDebug('btn-export-face-dxf clicked'); exportFaceDXF(); });
  var btnExportFaceObj = document.getElementById('btn-export-face-obj');
  if(btnExportFaceObj) btnExportFaceObj.addEventListener('click', function(){ pluginDebug('btn-export-face-obj clicked'); exportFaceOBJ(); });

  // Results buttons
  var btnExportCsv = document.getElementById('btn-export-csv');
  if(btnExportCsv) btnExportCsv.addEventListener('click', function(){ pluginDebug('btn-export-csv clicked'); exportCSV(); });
  var btnClearAll = document.getElementById('btn-clear-all-results');
  if(btnClearAll) btnClearAll.addEventListener('click', function(){ pluginDebug('btn-clear-all-results clicked'); clearAllResults(); });
  var btnCopyResults = document.getElementById('btn-copy-results');
  if(btnCopyResults) btnCopyResults.addEventListener('click', function() {
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
  if(btnSaveWf) btnSaveWf.addEventListener('click', function(){ pluginDebug('btn-save-workflow clicked'); saveWorkflow(); });
  var btnLoadWf = document.getElementById('btn-load-workflow');
  if(btnLoadWf) btnLoadWf.addEventListener('click', function(){ pluginDebug('btn-load-workflow clicked'); loadWorkflow(); });
  var btnExportWf = document.getElementById('btn-export-workflows');
  if(btnExportWf) btnExportWf.addEventListener('click', function(){ pluginDebug('btn-export-workflows clicked'); exportWorkflows(); });
  var btnImportWf = document.getElementById('btn-import-workflows');
  if(btnImportWf) btnImportWf.addEventListener('click', function(){ pluginDebug('btn-import-workflows clicked'); importWorkflows(); });
  var btnSaveAllLogs = document.getElementById('btn-save-all-logs');
  if(btnSaveAllLogs) btnSaveAllLogs.addEventListener('click', function(){ pluginDebug('btn-save-all-logs clicked'); saveAllLogs(); });
  var btnClearAll2 = document.getElementById('btn-clear-all-results-2');
  if(btnClearAll2) btnClearAll2.addEventListener('click', function(){ pluginDebug('btn-clear-all-results-2 clicked'); clearAllResults(); });

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
  if(btnSaveMeshFile) btnSaveMeshFile.addEventListener('click', function(){ pluginDebug('btn-save-mesh-file clicked'); saveMeshToFile(); });
  var btnLoadMeshFile = document.getElementById('btn-load-mesh-file');
  if(btnLoadMeshFile) btnLoadMeshFile.addEventListener('click', function(){ pluginDebug('btn-load-mesh-file clicked'); loadMeshFromFile(); });
  var btnSaveMeshStorage = document.getElementById('btn-save-mesh-storage');
  if(btnSaveMeshStorage) btnSaveMeshStorage.addEventListener('click', function(){ pluginDebug('btn-save-mesh-storage clicked'); saveMeshToStorage(); });
  var btnLoadMeshStorage = document.getElementById('btn-load-mesh-storage');
  if(btnLoadMeshStorage) btnLoadMeshStorage.addEventListener('click', function(){ pluginDebug('btn-load-mesh-storage clicked'); loadMeshFromStorage(); });
  var btnClearMeshStorage = document.getElementById('btn-clear-mesh-storage');
  if(btnClearMeshStorage) btnClearMeshStorage.addEventListener('click', function(){ pluginDebug('btn-clear-mesh-storage clicked'); clearMeshStorage(); });

  // 2D Surface Compensation buttons (legacy — kept for backward compatibility)
  var btnApply2d = document.getElementById('sm-btn-apply-comp');
  if(btnApply2d) btnApply2d.addEventListener('click', function(){ pluginDebug('sm-btn-apply-comp clicked'); applySurfaceCompensation(); });
  var btnDownload2d = document.getElementById('sm-btn-download-comp');
  if(btnDownload2d) btnDownload2d.addEventListener('click', function(){ pluginDebug('sm-btn-download-comp clicked'); smDownloadCompensatedGcode(); });
  var btnSendNcSender2d = document.getElementById('sm-btn-send-ncsender');
  if(btnSendNcSender2d) btnSendNcSender2d.addEventListener('click', function(){ pluginDebug('sm-btn-send-ncsender clicked'); sendCompToNcSender(smCompensatedGcode, 'compensated_surface'); });

  // Face Probe Tab — Mesh Data Management buttons
  var faceBtnSaveMesh = document.getElementById('face-btn-save-mesh');
  if (faceBtnSaveMesh) faceBtnSaveMesh.addEventListener('click', function(){ pluginDebug('face-btn-save-mesh clicked'); saveFaceMeshData(); });
  var faceBtnLoadMesh = document.getElementById('face-btn-load-mesh');
  if (faceBtnLoadMesh) faceBtnLoadMesh.addEventListener('click', function(){ pluginDebug('face-btn-load-mesh clicked'); loadFaceMeshData(); });
  var faceBtnClearMesh = document.getElementById('face-btn-clear-mesh');
  if (faceBtnClearMesh) faceBtnClearMesh.addEventListener('click', function(){ pluginDebug('face-btn-clear-mesh clicked'); clearFaceMeshData(); });
  var faceBtnExportJson = document.getElementById('face-btn-export-json');
  if (faceBtnExportJson) faceBtnExportJson.addEventListener('click', function(){ pluginDebug('face-btn-export-json clicked'); exportFaceMeshJSON(); });
  var faceBtnExportCsvNew = document.getElementById('face-btn-export-csv-new');
  if (faceBtnExportCsvNew) faceBtnExportCsvNew.addEventListener('click', function(){ pluginDebug('face-btn-export-csv-new clicked'); exportFaceMeshCSVNew(); });
  var faceBtnImportMesh = document.getElementById('face-btn-import-mesh');
  if (faceBtnImportMesh) faceBtnImportMesh.addEventListener('click', function(){ pluginDebug('face-btn-import-mesh clicked'); importFaceMeshData(); });

  // Face Probe Apply / Compensation buttons (legacy — elements no longer in DOM after Apply tab redesign)
  // These are kept in case of DOM restoration; they fail silently when elements don't exist.
  var faceBtnApplyComp = document.getElementById('face-btn-apply-comp');
  if (faceBtnApplyComp) faceBtnApplyComp.addEventListener('click', function(){ pluginDebug('face-btn-apply-comp clicked'); applyFaceProbeCompensation(); });
  var faceBtnDownloadComp = document.getElementById('face-btn-download-comp');
  if (faceBtnDownloadComp) faceBtnDownloadComp.addEventListener('click', function(){ pluginDebug('face-btn-download-comp clicked'); faceDownloadCompensatedGcode(); });
  var faceBtnSendNcSender = document.getElementById('face-btn-send-ncsender');
  if (faceBtnSendNcSender) faceBtnSendNcSender.addEventListener('click', function(){ pluginDebug('face-btn-send-ncsender clicked'); sendCompToNcSender(faceCompensatedGcode, 'compensated_face'); });
  var faceBtnPreviewToolpath = document.getElementById('face-btn-preview-toolpath');
  if (faceBtnPreviewToolpath) faceBtnPreviewToolpath.addEventListener('click', function(){ pluginDebug('face-btn-preview-toolpath clicked'); renderFaceGcodePreview(); });

  // Face probe stylus cap sync on Setup tab change
  var probeStylusEl = document.getElementById('probeStylusCalloutLength');
  if (probeStylusEl) probeStylusEl.addEventListener('input', fpUpdateStylusCapInfo);

  // Initialize face probe tab on page load
  fpUpdateStylusCapInfo();
  fpSyncFromSetup();
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

  // Build grid: grid[xi][li] = {x, y, z, layer, sampleTopZ}
  var grid = [];
  for (var xi = 0; xi < xs.length; xi++) { grid.push({}); }

  data.forEach(function(r) {
    var xi = xIndexMap[Number(r.x).toFixed(3)];
    if (xi == null) return;
    var l = r.layer != null ? r.layer : 1;
    var li = layerIndexMap[l];
    if (li == null) return;
    if (!grid[xi][li]) grid[xi][li] = r;
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
  if (statusEl) statusEl.textContent = 'Z Start loaded from Row 1 average: ' + avgZ.toFixed(3) + ' mm (' + validZ.length + ' points).';
}

function fpUpdateStylusCapInfo() {
  var stylusLen = Number((document.getElementById('probeStylusCalloutLength') || {}).value) || FACE_PROBE_DEFAULT_MAX_DEPTH;
  var infoEl = document.getElementById('fp-stylus-cap-info');
  if (infoEl) infoEl.textContent = 'Max = ' + stylusLen.toFixed(3) + ' mm (probe stylus callout length from Setup)';
  fpValidateZEnd();
}

function fpValidateZEnd() {
  var stylusLen = Number((document.getElementById('probeStylusCalloutLength') || {}).value) || FACE_PROBE_DEFAULT_MAX_DEPTH;
  var zEndEl = document.getElementById('fp-zEnd');
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

function fpSyncToSetup() {
  var map = {
    'fp-yStart': 'faceStartOffset',
    'fp-feedRate': 'faceFeed',
    'fp-zEnd': 'faceMaxDepth',
    'fp-zLayers': 'faceLayerCount',
    'fp-retractDist': 'topRetract'
  };
  Object.keys(map).forEach(function(src) {
    var srcEl = document.getElementById(src);
    var dstEl = document.getElementById(map[src]);
    if (srcEl && dstEl) dstEl.value = srcEl.value;
  });
  var layersEl = document.getElementById('fp-zLayers');
  var enableEl = document.getElementById('enableLayeredFace');
  if (layersEl && enableEl) enableEl.checked = Number(layersEl.value) > 1;
  var statusEl = document.getElementById('face-meshStorageStatus');
  if (statusEl) statusEl.textContent = 'Values synced to Setup tab.';
}

function fpSyncFromSetup() {
  var map = {
    'faceStartOffset': 'fp-yStart',
    'faceFeed': 'fp-feedRate',
    'faceMaxDepth': 'fp-zEnd',
    'faceLayerCount': 'fp-zLayers',
    'topRetract': 'fp-retractDist'
  };
  Object.keys(map).forEach(function(src) {
    var srcEl = document.getElementById(src);
    var dstEl = document.getElementById(map[src]);
    if (srcEl && dstEl) dstEl.value = srcEl.value;
  });
  fpUpdateStylusCapInfo();
  var statusEl = document.getElementById('face-meshStorageStatus');
  if (statusEl) statusEl.textContent = 'Values loaded from Setup tab.';
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
      layeredFaceResults = data.faceMeshData;
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
        layeredFaceResults = pts;
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

function faceLogApply(msg) {
  var el = document.getElementById('face-applyLog');
  if (!el) return;
  el.textContent += msg + '\n';
  el.scrollTop = el.scrollHeight;
}

function applyFaceProbeCompensation() {
  if (!faceOriginalGcode) { alert('No G-code loaded. Load a G-code file first.'); return; }
  var data = getFaceMeshData();
  if (!data || !data.length) { alert('No face mesh data. Run a face probe or load face mesh first.'); return; }
  var refPos = Number((document.getElementById('face-compRefPos') || {value: 0}).value);
  faceLogApply('Applying face compensation with Reference Face Position=' + refPos + '...');
  try {
    var result = faceApplyCompensationCore(faceOriginalGcode, data, refPos);
    faceCompensatedGcode = result.gcode;
    faceLastAppliedAxis = result.faceAxis || 'Y';
    var statusEl = document.getElementById('face-applyStatus');
    if (statusEl) statusEl.textContent = 'Done. ' + result.modified + ' ' + result.faceAxis + ' values adjusted using bilinear face mesh interpolation.';
    faceLogApply('Compensation applied. ' + result.modified + ' lines modified. Face axis: ' + result.faceAxis + '.');
    var preview = faceCompensatedGcode.split('\n').slice(0, 30).join('\n');
    var previewEl = document.getElementById('face-apply-preview');
    if (previewEl) previewEl.textContent = preview;
    var ncBtn = document.getElementById('face-btn-send-ncsender');
    if (ncBtn) ncBtn.disabled = false;
    var prevBtn = document.getElementById('face-btn-preview-toolpath');
    if (prevBtn) prevBtn.disabled = false;
    var noteEl = document.getElementById('face-ncsender-note');
    if (noteEl) {
      var depthAxis = faceLastAppliedAxis === 'Y' ? 'Y' : 'X';
      var planeName = faceLastAppliedAxis === 'Y' ? 'XZ' : 'YZ';
      noteEl.innerHTML = '&#9888; Note: ncSender&#39;s toolpath preview shows the XY plane (top-down view). Face compensation adjusts the <strong>' + depthAxis + ' axis</strong> at varying Z depths &mdash; the toolpath will appear flat in ncSender&#39;s default view. Use the &ldquo;Preview Toolpath&rdquo; button above to verify the face contour from the correct <strong>' + planeName + ' plane</strong> viewing angle.';
      noteEl.style.display = '';
    }
  } catch(e) {
    var statusEl2 = document.getElementById('face-applyStatus');
    if (statusEl2) statusEl2.textContent = 'Error: ' + e.message;
    faceLogApply('ERROR: ' + e.message);
  }
}

// ── Face Compensation — 2D bilinear interpolation ────────────────────────────
// Adjusts the lateral axis (Y for Y-face probe, X for X-face probe) in G-code
// by interpolating the face mesh at each (sampleCoord, Z) position.
// This corrects the toolpath to follow the actual face contour at each depth.
// referenceContact = the nominal/expected flat face position (Y or X value).
function faceApplyCompensationCore(gcodeText, contactPoints, referenceContact) {

  // ── Detect face axis ──────────────────────────────────────────────────────
  // For a Y-axis face probe: the probe moved along Y, so:
  //   sampleCoord = r.x (position along the slab), contactVal = r.y (Y contact)
  // For an X-axis face probe: the probe moved along X, so:
  //   sampleCoord = r.y (position along the slab), contactVal = r.x (X contact)
  var faceAxis = 'Y';
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

  // grid[si][zi] = contact value (or null if no data for that cell)
  var grid = [];
  for (var gi = 0; gi < sampleVals.length; gi++) {
    var row = [];
    for (var gj = 0; gj < zVals.length; gj++) row.push(null);
    grid.push(row);
  }
  contactPoints.forEach(function(p) {
    var si = sIdxMap[sampleFn(p).toFixed(4)];
    var zi = zIdxMap[Number(p.z).toFixed(4)];
    if (si != null && zi != null && grid[si][zi] === null) grid[si][zi] = contactFn(p); // si/zi come from object key lookup, != null is correct
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

    var c00 = grid[si0][zi0], c10 = (si1 < sn ? grid[si1][zi0] : null);
    var c01 = grid[si0][zi1], c11 = (si1 < sn ? grid[si1][zi1] : null);

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

  // Prepend informational header comments
  var viewOrientation = faceAxis === 'Y' ? 'XZ plane (side view) for best visualization' : 'YZ plane (side view) for best visualization';
  output.push('; Face-compensated G-code generated by 3D Live Edge Mesh');
  output.push('; Compensation type: Face (' + faceAxis + '-axis)');
  output.push('; Face probe data: ' + contactPoints.length + ' contact points');
  output.push('; Compensation axis: ' + faceAxis + ' adjusted based on face contour at each (sampleCoord, Z) position');
  output.push('; View orientation: ' + viewOrientation);
  output.push('; NOTE: ncSender shows XY plane (top-down). Use the plugin toolpath preview to verify face contour.');
  output.push('');

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
    if (zMatch) currentZ = parseFloat(zMatch[1]);

    // Only compensate lines that have an explicit face-axis coordinate
    var hasFaceCoord = faceAxis === 'Y' ? !!yMatch : !!xMatch;
    if (hasFaceCoord) {
      var qSample = faceAxis === 'Y' ? currentX : currentY;
      var offset  = interpolateContact(qSample, currentZ);
      if (offset !== null) {
        if (faceAxis === 'Y') {
          var newY = currentY + offset;
          line = line.replace(/Y(-?[\d.]+)/i, 'Y' + newY.toFixed(3));
        } else {
          var newX = currentX + offset;
          line = line.replace(/X(-?[\d.]+)/i, 'X' + newX.toFixed(3));
        }
        linesModified++;
      }
    }
    output.push(line);
  }
  return { gcode: output.join('\n'), modified: linesModified, faceAxis: faceAxis };
}

function faceDownloadCompensatedGcode() {
  if (!faceCompensatedGcode) { alert('No compensated G-code. Apply compensation first.'); return; }
  var blob = new Blob([faceCompensatedGcode], { type: 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'compensated_face_' + Date.now() + '.nc';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

// ── Face G-code Toolpath Preview (XZ or YZ plane SVG) ────────────────────────
// Parses compensated G-code and renders the toolpath from the correct viewing
// angle for face operations (XZ plane for Y-axis face, YZ plane for X-axis face).
// Y (or X) depth is shown as color (blue=shallow/near face, red=deep/far from face).
function renderFaceGcodePreview() {
  if (!faceCompensatedGcode) { return; }
  var svg = document.getElementById('face-toolpath-svg');
  var wrapEl = document.getElementById('face-toolpath-preview-wrap');
  var axisLabel = document.getElementById('face-tp-axis-label');
  var legendEl = document.getElementById('face-tp-legend');
  if (!svg || !wrapEl) return;

  // Parse G-code: extract move coordinates
  var lines = faceCompensatedGcode.split('\n');
  var cx = 0, cy = 0, cz = 0;
  var moves = [];
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i].trim();
    if (!ln || ln.startsWith(';') || ln.startsWith('(')) continue;
    var isMove = /^G[01]\b/i.test(ln) || /\b[XYZ][-\d.]/i.test(ln);
    if (!isMove) continue;
    var xm = ln.match(/X(-?[\d.]+)/i);
    var ym = ln.match(/Y(-?[\d.]+)/i);
    var zm = ln.match(/Z(-?[\d.]+)/i);
    if (xm) cx = parseFloat(xm[1]);
    if (ym) cy = parseFloat(ym[1]);
    if (zm) cz = parseFloat(zm[1]);
    if (xm || ym || zm) moves.push({ x: cx, y: cy, z: cz });
  }
  if (moves.length < 2) {
    wrapEl.style.display = 'none';
    return;
  }

  // Use stored face axis from most recently applied compensation (reliable, no header parsing)
  var faceAxis = faceLastAppliedAxis || 'Y';

  // For Y-axis face: plot X (horizontal) vs Z (vertical), color by Y (depth)
  // For X-axis face: plot Y (horizontal) vs Z (vertical), color by X (depth)
  var hVals = moves.map(function(m){ return faceAxis === 'Y' ? m.x : m.y; });
  var vVals = moves.map(function(m){ return m.z; });
  var dVals = moves.map(function(m){ return faceAxis === 'Y' ? m.y : m.x; });

  var hMin = Math.min.apply(null, hVals), hMax = Math.max.apply(null, hVals);
  var vMin = Math.min.apply(null, vVals), vMax = Math.max.apply(null, vVals);
  var dMin = Math.min.apply(null, dVals), dMax = Math.max.apply(null, dVals);
  var hSpan = hMax - hMin || 1, vSpan = vMax - vMin || 1, dSpan = dMax - dMin || 1;

  // Show wrapper first so getBoundingClientRect returns the actual rendered width
  wrapEl.style.display = '';
  var W = svg.getBoundingClientRect().width || svg.parentElement && svg.parentElement.getBoundingClientRect().width || 600;
  var H = 220;
  var pad = { l: 42, r: 14, t: 14, b: 32 };
  var pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;

  function toSvgX(h){ return pad.l + (h - hMin) / hSpan * pw; }
  function toSvgY(v){ return pad.t + ph - (v - vMin) / vSpan * ph; }
  function depthColor(d){
    var t = dSpan > 0 ? (d - dMin) / dSpan : 0.5;
    // Shallow (near face) = blue: rgb(30, 80, 200); Deep (far from face) = red: rgb(230, 20, 30)
    var r = Math.round(30 + t * 200), g = Math.round(80 - t * 60), b = Math.round(200 - t * 170);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  // Build SVG content
  var svgParts = [];
  // Grid lines
  svgParts.push('<line x1="' + pad.l + '" y1="' + (H - pad.b) + '" x2="' + (W - pad.r) + '" y2="' + (H - pad.b) + '" stroke="#334" stroke-width="1"/>');
  svgParts.push('<line x1="' + pad.l + '" y1="' + pad.t + '" x2="' + pad.l + '" y2="' + (H - pad.b) + '" stroke="#334" stroke-width="1"/>');
  // Axis labels
  var hAxisLbl = faceAxis === 'Y' ? 'X (mm)' : 'Y (mm)';
  var vAxisLbl = 'Z (mm)';
  svgParts.push('<text x="' + (pad.l + pw / 2) + '" y="' + (H - 4) + '" text-anchor="middle" font-size="10" fill="#8899aa">' + hAxisLbl + '</text>');
  svgParts.push('<text x="10" y="' + (pad.t + ph / 2) + '" text-anchor="middle" font-size="10" fill="#8899aa" transform="rotate(-90,10,' + (pad.t + ph / 2) + ')">' + vAxisLbl + '</text>');
  // Tick values
  svgParts.push('<text x="' + pad.l + '" y="' + (H - pad.b + 12) + '" text-anchor="middle" font-size="9" fill="#667">' + hMin.toFixed(0) + '</text>');
  svgParts.push('<text x="' + (pad.l + pw) + '" y="' + (H - pad.b + 12) + '" text-anchor="middle" font-size="9" fill="#667">' + hMax.toFixed(0) + '</text>');
  svgParts.push('<text x="' + (pad.l - 4) + '" y="' + (pad.t + ph) + '" text-anchor="end" font-size="9" fill="#667">' + vMin.toFixed(1) + '</text>');
  svgParts.push('<text x="' + (pad.l - 4) + '" y="' + pad.t + '" text-anchor="end" font-size="9" fill="#667">' + vMax.toFixed(1) + '</text>');

  // Draw toolpath as colored line segments
  for (var j = 1; j < moves.length; j++) {
    var x1 = toSvgX(hVals[j-1]), y1 = toSvgY(vVals[j-1]);
    var x2 = toSvgX(hVals[j]),   y2 = toSvgY(vVals[j]);
    var col = depthColor(dVals[j]);
    svgParts.push('<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="' + col + '" stroke-width="1.5" opacity="0.85"/>');
  }
  // Start/end markers
  svgParts.push('<circle cx="' + toSvgX(hVals[0]).toFixed(1) + '" cy="' + toSvgY(vVals[0]).toFixed(1) + '" r="3" fill="#00e676" opacity="0.9"/>');
  svgParts.push('<circle cx="' + toSvgX(hVals[moves.length-1]).toFixed(1) + '" cy="' + toSvgY(vVals[moves.length-1]).toFixed(1) + '" r="3" fill="#ff5252" opacity="0.9"/>');

  svg.innerHTML = svgParts.join('');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

  var depthAxisName = faceAxis === 'Y' ? 'Y' : 'X';
  var planeName = faceAxis === 'Y' ? 'XZ' : 'YZ';
  if (axisLabel) axisLabel.textContent = planeName + ' plane (side view, ' + depthAxisName + '=depth shown as color)';
  if (legendEl) legendEl.innerHTML =
    '<span style="color:#1e50c8">&#9632;</span> shallow (near face)&nbsp;&nbsp;' +
    '<span style="color:#c83220">&#9632;</span> deep (far from face)&nbsp;&nbsp;' +
    '&#9679; <span style="color:#00e676">start</span>&nbsp;&nbsp;' +
    '&#9679; <span style="color:#ff5252">end</span>&nbsp;&nbsp;' +
    moves.length + ' moves &middot; ' +
    (faceAxis === 'Y' ? 'X' : 'Y') + ': ' + hMin.toFixed(1) + '&ndash;' + hMax.toFixed(1) + 'mm &middot; ' +
    'Z: ' + vMin.toFixed(1) + '&ndash;' + vMax.toFixed(1) + 'mm &middot; ' +
    depthAxisName + ': ' + dMin.toFixed(2) + '&ndash;' + dMax.toFixed(2) + 'mm';
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
    if (ut) ut.innerHTML = '<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:16px;">No probe data yet</td></tr>';
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


