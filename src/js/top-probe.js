function runSurfaceProbing() {
  pluginDebug('runSurfaceProbing ENTER');
  if (_running) { smSetProbeStatus('Already running', 'err'); return; }
  _running = true;
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
    _running = false;
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
    smPvizUpdate('complete', { point: totalPoints, total: totalPoints, pct: 100 });
    smSaveMeshToStorage();
    try { updateSurfaceMeshUI(); } catch(vizErr) { console.warn('Surface probe: updateSurfaceMeshUI error (non-fatal):', vizErr); }
    try { populateSurfaceResults(); } catch(vizErr) { console.warn('Surface probe: populateSurfaceResults error (non-fatal):', vizErr); }
    var skipFinish = _smSkipFinishMotion;
    _smSkipFinishMotion = false;
    if (!skipFinish) {
      return smFinishMotion(travelFeed);
    }
    smLogProbe('COMBINED: Skipping smFinishMotion (going directly to face probe phase).');
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
    _running = false;
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

