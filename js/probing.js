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

