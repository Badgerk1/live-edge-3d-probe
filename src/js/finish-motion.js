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
  var hAxisLbl = faceAxis === 'Y' ? 'X (coords)' : 'Y (coords)';
  var vAxisLbl = 'Z (coords)';
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
    (faceAxis === 'Y' ? 'X' : 'Y') + ': ' + hMin.toFixed(1) + '&ndash;' + hMax.toFixed(1) + ' coords &middot; ' +
    'Z: ' + vMin.toFixed(1) + '&ndash;' + vMax.toFixed(1) + ' coords &middot; ' +
    depthAxisName + ': ' + dMin.toFixed(2) + '&ndash;' + dMax.toFixed(2) + ' coords';
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
      var _p15ClearanceZ = Number(document.getElementById('sm-clearanceZ').value) || 5;
      var _p15TravelFeed = Number(document.getElementById('sm-travelFeed').value) || 600;
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


