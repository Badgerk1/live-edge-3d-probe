// ── WebSocket Transport for Standalone Mode ───────────────────────────────────
//
// This file is appended AFTER all src/js/*.js files in the standalone-ws build.
// JavaScript function declarations at the same scope level are resolved
// last-wins, so the definitions here silently replace the fetch-based versions
// from src/js/core.js:
//
//   sendCommand()                  → WebSocket send + wait for 'ok'/'error'
//   _getState()                    → send '?' + parse GRBL status report
//   _trySafeStopEndpoints()        → send '!' feed-hold byte directly
//   requireStartupHomingPreflight()→ relaxed: GRBL doesn't expose homed state
//
// Supported boards: any controller that speaks GRBL-protocol text over a plain
// WebSocket connection (FluidNC, Smoothieware, grblHAL network builds, etc.).
// The default port 8090 matches common network controller configurations.
//
// Everything else (probe math, visualization, settings, UI) is unchanged.
//
// DO NOT edit standalone-ws.html directly — run build-standalone-ws.sh instead.
// ─────────────────────────────────────────────────────────────────────────────

// ── WebSocket connection state ────────────────────────────────────────────────
var _wsSocket    = null;
var _wsConnected = false;
var _wsLineBuf   = '';

// Response queues (FIFO — GRBL responds in command order)
var _wsOkQueue     = []; // [{resolve, reject, _tid}] waiting for 'ok' or 'error'
var _wsStatusQueue = []; // [{resolve, reject, _tid}] waiting for '<…>' status line

// Last probe result received on a [PRB:x,y,z:n] line
var _wsProbeTriggered = false; // true when most recent [PRB:…:1] not yet consumed

// ── Connection UI injection ───────────────────────────────────────────────────
// Replaces the existing "Ready" span in #hdr-conn with host/port inputs,
// a Connect/Disconnect button, and a live status indicator.
(function _wsInjectUI() {
  document.title = '3D Live Edge Probe — Standalone (Network)';
  var hdr = document.getElementById('hdr-conn');
  if (!hdr) return;
  hdr.style.cssText = 'display:flex;align-items:center;gap:6px;flex-shrink:0';
  hdr.innerHTML =
    '<input id="ws-host" type="text" value="192.168.1.100" placeholder="Controller IP" title="Controller IP address" ' +
      'style="background:#131824;color:var(--text);border:1px solid var(--line);border-radius:6px;' +
             'padding:3px 6px;font-size:12px;width:120px">' +
    '<span style="font-size:12px;color:var(--muted)">:</span>' +
    '<input id="ws-port" type="number" value="8090" min="1" max="65535" title="WebSocket port" ' +
      'style="background:#131824;color:var(--text);border:1px solid var(--line);border-radius:6px;' +
             'padding:3px 6px;font-size:12px;width:60px">' +
    '<button id="ws-connect-btn" onclick="wsToggleConnect()" ' +
      'style="background:#1b2740;border:1px solid var(--line);color:var(--text);' +
             'padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;white-space:nowrap">' +
      'Connect' +
    '</button>' +
    '<span id="ws-status" style="font-size:12px;color:var(--muted);white-space:nowrap">&#9675; Not connected</span>';
})();

function _wsSetUI(connected) {
  var btn  = document.getElementById('ws-connect-btn');
  var st   = document.getElementById('ws-status');
  var host = document.getElementById('ws-host');
  var port = document.getElementById('ws-port');
  if (btn)  btn.textContent = connected ? 'Disconnect' : 'Connect';
  if (host) host.disabled = connected;
  if (port) port.disabled = connected;
  if (st) {
    st.textContent = connected ? '\u25cf Connected' : '\u25cb Not connected';
    st.style.color = connected ? 'var(--good,#5fd38d)' : 'var(--muted)';
  }
}

// ── Public connection API (called from injected button) ───────────────────────
async function wsToggleConnect() {
  if (_wsConnected) { wsDisconnect(); } else { wsConnect(); }
}

function wsConnect() {
  var host = ((document.getElementById('ws-host') || {}).value || '').trim();
  var port = Number((document.getElementById('ws-port') || {}).value) || 8090;
  if (!host) {
    setFooterStatus('Enter the controller IP address before connecting.', 'bad');
    return;
  }
  var url = 'ws://' + host + ':' + port;
  try {
    var sock = new WebSocket(url);
    sock.binaryType = 'arraybuffer';

    sock.onopen = function () {
      _wsSocket    = sock;
      _wsConnected = true;
      _wsLineBuf   = '';
      _wsOkQueue     = [];
      _wsStatusQueue = [];
      _wsProbeTriggered = false;
      _wsSetUI(true);
      setFooterStatus('WebSocket connected to ' + url + ' \u2014 sending soft reset\u2026', 'ok');
      // Ctrl-X soft reset — puts GRBL into a known idle state
      _wsSend('\x18');
      setTimeout(function () {
        if (_wsConnected) {
          setFooterStatus('WebSocket connected \u2014 ready.', 'ok');
        }
      }, 1200);
    };

    sock.onmessage = function (evt) {
      var text = (evt.data instanceof ArrayBuffer)
        ? new TextDecoder().decode(evt.data)
        : String(evt.data);
      _wsLineBuf += text;
      var idx;
      while ((idx = _wsLineBuf.indexOf('\n')) >= 0) {
        var line = _wsLineBuf.slice(0, idx).replace(/\r$/, '').trim();
        _wsLineBuf = _wsLineBuf.slice(idx + 1);
        if (line) _wsHandleLine(line);
      }
    };

    sock.onerror = function () {
      if (!_wsConnected) {
        setFooterStatus('Could not connect to ' + url + '. Check the IP, port, and that the controller is reachable.', 'bad');
        _wsSetUI(false);
      }
    };

    sock.onclose = function () {
      if (_wsConnected) {
        _wsConnected = false;
        _wsFlushQueues(new Error('WebSocket connection lost'));
        _wsSocket = null;
        _wsSetUI(false);
        setFooterStatus('WebSocket connection lost.', 'bad');
      }
    };

    setFooterStatus('Connecting to ' + url + '\u2026', 'ok');
  } catch (e) {
    setFooterStatus('Connect error: ' + e.message, 'bad');
  }
}

function wsDisconnect() {
  _wsConnected = false;
  _wsFlushQueues(new Error('WebSocket disconnected'));
  try { if (_wsSocket) { _wsSocket.close(); } } catch (_e) {}
  _wsSocket = null;
  _wsSetUI(false);
  setFooterStatus('WebSocket disconnected.', 'warn');
}

function _wsFlushQueues(err) {
  _wsOkQueue.forEach(function (r) { try { r.reject(err); } catch (_e) {} });
  _wsStatusQueue.forEach(function (r) { try { r.reject(err); } catch (_e) {} });
  _wsOkQueue     = [];
  _wsStatusQueue = [];
}

// ── Line dispatcher ───────────────────────────────────────────────────────────
function _wsHandleLine(line) {
  pluginDebug('[ws \u2190] ' + line);

  // GRBL status report  <Status|Key:Val|…>
  if (line.charAt(0) === '<') {
    var r = _wsStatusQueue.shift();
    if (r) { clearTimeout(r._tid); r.resolve(line); }
    return;
  }

  // Probe result  [PRB:x,y,z:1]
  if (line.charAt(0) === '[' && line.indexOf('PRB:') === 1) {
    var inner = line.slice(1, line.length - 1); // strip [ ]
    var colonIdx = inner.lastIndexOf(':');
    if (colonIdx >= 0 && inner.charAt(colonIdx + 1) === '1') {
      _wsProbeTriggered = true;
    }
    return;
  }

  // ok
  if (line === 'ok') {
    var r = _wsOkQueue.shift();
    if (r) { clearTimeout(r._tid); r.resolve(); }
    return;
  }

  // error:N
  if (line.toLowerCase().indexOf('error:') === 0) {
    var r = _wsOkQueue.shift();
    if (r) { clearTimeout(r._tid); r.reject(new Error(line)); }
    return;
  }

  // ALARM:N — reject all pending commands
  if (line.toUpperCase().indexOf('ALARM:') === 0) {
    var err = new Error('Machine in alarm state: ' + line);
    _wsOkQueue.forEach(function (r) { clearTimeout(r._tid); r.reject(err); });
    _wsOkQueue = [];
    return;
  }

  // Everything else (Grbl banner, [MSG:…], [GC:…], etc.) — informational only
  console.log('[ws] ' + line);
}

// ── Low-level send helper ─────────────────────────────────────────────────────
function _wsSend(text) {
  if (!_wsSocket || _wsSocket.readyState !== WebSocket.OPEN) {
    throw new Error('WebSocket not connected');
  }
  _wsSocket.send(text);
}

// ── GRBL real-time command bytes (no 'ok' response generated) ─────────────────
var _WS_REALTIME = { '!': true, '~': true, '?': true, '\x18': true };

// ── Override: sendCommand ─────────────────────────────────────────────────────
async function sendCommand(gcode, timeoutMs) {
  if (!_wsConnected) {
    throw new Error('Not connected. Click \u201cConnect\u201d and enter the controller IP.');
  }
  var ms = (timeoutMs != null) ? timeoutMs : 15000;
  pluginDebug('sendCommand: ' + gcode);
  console.log('[' + tsMs() + '] SEND: ' + gcode);

  // Real-time single-character commands are sent raw; GRBL never echoes an 'ok'
  if (_WS_REALTIME[gcode]) {
    _wsSend(gcode);
    return {};
  }

  var okPromise = new Promise(function (resolve, reject) {
    var tid = setTimeout(function () {
      for (var i = 0; i < _wsOkQueue.length; i++) {
        if (_wsOkQueue[i]._tid === tid) { _wsOkQueue.splice(i, 1); break; }
      }
      reject(new Error('sendCommand timed out after ' + ms + 'ms for: ' + gcode));
    }, ms);
    _wsOkQueue.push({ resolve: resolve, reject: reject, _tid: tid });
  });

  pluginDebug('[ws \u2192] ' + gcode);
  _wsSend(gcode + '\n');
  await okPromise;
  console.log('[' + tsMs() + '] DONE: ' + gcode);
  return {};
}

// ── Override: _getState ───────────────────────────────────────────────────────
async function _getState() {
  if (!_wsConnected) {
    return { machineState: { status: 'Disconnected' } };
  }

  var statusPromise = new Promise(function (resolve, reject) {
    var tid = setTimeout(function () {
      for (var i = 0; i < _wsStatusQueue.length; i++) {
        if (_wsStatusQueue[i]._tid === tid) { _wsStatusQueue.splice(i, 1); break; }
      }
      reject(new Error('Status query timed out'));
    }, 3000);
    _wsStatusQueue.push({ resolve: resolve, reject: reject, _tid: tid });
  });

  try {
    _wsSend('?');
  } catch (e) {
    return { machineState: { status: 'Unknown' } };
  }

  var line;
  try {
    line = await statusPromise;
  } catch (_e) {
    pluginDebug('_getState: status query timed out');
    return { machineState: { status: 'Unknown' } };
  }

  var machineState = _wsParseStatus(line);

  // Inject probe-triggered flag from the last [PRB:…:1] line (consumed once)
  if (_wsProbeTriggered) {
    _wsProbeTriggered = false;
    if (!machineState.Pn) {
      machineState.Pn = 'P';
    } else if (machineState.Pn.indexOf('P') < 0) {
      machineState.Pn += 'P';
    }
  }

  pluginDebug('_getState: status=' + machineState.status +
    ' WPos=' + (machineState.WPos || '') + ' MPos=' + (machineState.MPos || '') +
    ' Pn=' + (machineState.Pn || ''));
  return { machineState: machineState };
}

// Parses a GRBL status report line into a machineState object.
// Handles both <Status|WPos:x,y,z|…> and <Status|MPos:x,y,z|WCO:x,y,z|…> formats.
function _wsParseStatus(line) {
  var ms = {};
  var inner = line.replace(/^<|>$/g, '');
  var parts = inner.split('|');
  ms.status = (parts[0] || 'Unknown').trim();
  for (var i = 1; i < parts.length; i++) {
    var colon = parts[i].indexOf(':');
    if (colon < 0) continue;
    var key = parts[i].slice(0, colon).trim();
    var val = parts[i].slice(colon + 1).trim();
    switch (key) {
      case 'MPos': ms.MPos = val; break;
      case 'WPos': ms.WPos = val; break;
      case 'WCO':  ms.WCO  = val; break;
      case 'Pn':   ms.Pn   = val; break;
      case 'Bf':   ms.Bf   = val; break;
      case 'Ln':   ms.Ln   = val; break;
      case 'F':    ms.feedRate = Number(val); break;
      case 'FS':
        var fs = val.split(',');
        ms.feedRate     = Number(fs[0]);
        ms.spindleSpeed = Number(fs[1]);
        break;
      case 'Ov':
        var ov = val.split(',');
        ms.feedrateOverride  = Number(ov[0]);
        ms.rapidOverride     = Number(ov[1]);
        ms.spindleOverride   = Number(ov[2]);
        break;
    }
  }
  return ms;
}

// ── Override: _trySafeStopEndpoints ──────────────────────────────────────────
// Sends GRBL real-time feed-hold byte directly instead of trying HTTP endpoints.
async function _trySafeStopEndpoints(label) {
  try {
    pluginDebug((label || 'STOP') + ': sending feed hold (0x21) via WebSocket');
    _wsSend('!');
    return true;
  } catch (e) {
    pluginDebug((label || 'STOP') + ': WebSocket send error: ' + e.message);
    return false;
  }
}

// ── Override: requireStartupHomingPreflight ───────────────────────────────────
// GRBL does not report homed state in the real-time status report, so the
// original homed-check would always block. This override skips that check while
// still guarding against ALARM and pre-triggered probe states.
async function requireStartupHomingPreflight(runLabel) {
  pluginDebug('requireStartupHomingPreflight (standalone-ws) ENTER');
  if (!_wsConnected) {
    throw new Error('Not connected. Click \u201cConnect\u201d and enter the controller IP.');
  }
  var info = await getMachineSnapshot();
  updateMachineHelperUI(info);
  var label = runLabel || 'probe run';
  if (_isAlarmStatus(info.status)) {
    throw new Error('Controller is in ALARM. Reset/unlock and home before ' + label + '.');
  }
  if (info.probeTriggered) {
    throw new Error('Probe input is already triggered. Clear the probe before ' + label + '.');
  }
  pluginDebug('requireStartupHomingPreflight (standalone-ws) OK: status=' + info.status);
  var note = '(standalone-ws \u2014 homed check skipped; ensure machine is homed before probing)';
  logLine('top',  'Preflight OK: status=' + (info.status || 'Unknown') + ', probe=open ' + note);
  logLine('face', 'Preflight OK: status=' + (info.status || 'Unknown') + ', probe=open ' + note);
  var _warns = [];
  if (typeof info.feedOverridePct    === 'number' && info.feedOverridePct    !== 100) _warns.push('Feed override is '    + info.feedOverridePct    + '%.');
  if (typeof info.rapidOverridePct   === 'number' && info.rapidOverridePct   !== 100) _warns.push('Rapid override is '   + info.rapidOverridePct   + '%.');
  if (typeof info.spindleOverridePct === 'number' && info.spindleOverridePct !== 100) _warns.push('Spindle override is ' + info.spindleOverridePct + '%.');
  if (_warns.length > 0) {
    var _warnMsg = 'WARNING: ' + _warns.join(' ');
    pluginDebug('requireStartupHomingPreflight (standalone-ws) OVERRIDE WARNING: ' + _warnMsg);
    logLine('top',  _warnMsg);
    logLine('face', _warnMsg);
    if (typeof outlineAppendLog === 'function') outlineAppendLog(_warnMsg);
    setFooterStatus(_warnMsg, 'warn');
  }
  return info;
}
