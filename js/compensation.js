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

