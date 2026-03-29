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
      // When Phase 0 has already measured real top-Z values at the exact face X
      // positions, use those directly instead of re-interpolating from the mesh.
      // Only fall back to fpBuildFaceSamplesFromConfig() when no auto top-Z pass
      // was made (e.g. called from combined mode or fp-xStart/fp-xEnd missing).
      var configSamples = (!_p0Ran && smMeshData && smGridConfig) ? fpBuildFaceSamplesFromConfig() : null;
      if(configSamples && configSamples.length >= 2){
        faceSamples = configSamples;
        logLine('face', 'Face probe: user requested ' + faceSamples.length + ' X samples (fp-xPoints).');
        logLine('face', 'Face probe: X positions = [' + faceSamples.map(function(s){ return s.sampleCoord.toFixed(1); }).join(', ') + ']');
        logLine('face', 'Face probe: interpolated topZ = [' + faceSamples.map(function(s){ return s.topZ.toFixed(3); }).join(', ') + ']');
      } else {
        // Use topPts directly — these are real measured values when Phase 0 ran,
        // or the best available data when it did not.
        faceSamples = topPts.map(function(tp, idx){
          return { index: idx + 1, sampleCoord: Number(tp.sampleCoord), topZ: Number(tp.z) };
        });
        if(_p0Ran){
          logLine('face', 'Face probe: using ' + faceSamples.length + ' measured top-Z reference points from Phase 0 auto top-Z pass.');
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
              await moveAbs(null, lineCoord, null, s.travelFeedRate);
            } else {
              await moveAbs(lineCoord, null, null, s.travelFeedRate);
            }

            if(axis === 'X'){
              await moveAbs(startCoord, null, null, s.travelFeedRate);
            } else {
              await moveAbs(null, startCoord, null, s.travelFeedRate);
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
              machineZ: contact.machineZ != null ? Number(contact.machineZ) : null,
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
            var nextSampleCoord = Number(faceSamples[sampleOrder[si + 1]].sampleCoord);
            // Two-step retract: (1) G1 retract on face axis to clear wall, then (2) G38.3 travel
            // on sample axis to detect live-edge bumps during the hop to the next sample position.
            logLine('face', 'Inter-sample return (layer ' + layerNum + '): G1 retract ' + axis + '=' + startCoord.toFixed(3) + ', then G38.3 travel ' + sampledAxis + '=' + nextSampleCoord.toFixed(3) + ' at Z=' + layerZ.toFixed(3) + ' (F3000 / F' + Number(s.travelFeedRate).toFixed(0) + ').');
            // Step 1: G1 retract on face axis — MUST complete fully to clear probe from wall.
            if(axis === 'X'){
              await moveAbs(startCoord, null, null, 3000);
            } else {
              await moveAbs(null, startCoord, null, 3000);
            }
            // Step 2: G38.3 travel on sample axis — detect live-edge bumps during lateral hop.
            var _isrPos;
            if(axis === 'X'){
              _isrPos = await probeSafeMove(null, nextSampleCoord, null, s.travelFeedRate);
            } else {
              _isrPos = await probeSafeMove(nextSampleCoord, null, null, s.travelFeedRate);
            }
            if(_isrPos.probeTriggered){
              logLine('face', 'INTER-SAMPLE TRAVEL CONTACT: probe triggered during diagonal retract at X=' + Number(_isrPos.x).toFixed(3) + ' Y=' + Number(_isrPos.y).toFixed(3) + ' Z=' + Number(_isrPos.z).toFixed(3));
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
              updateAllResultsUI();
              var _isrRecovery = {recoveries: 0, totalLift: 0};
              var _isrUnitX = axis === 'X' ? Math.sign(startCoord - targetCoord) : 0;
              var _isrUnitY = axis === 'X' ? 0 : Math.sign(startCoord - targetCoord);
              await _clearTriggeredProbeByBackingOffGeneric('face', _isrPos, _isrUnitX, _isrUnitY, s, _isrRecovery);
              didOptimizedRetract = false;
            } else {
              didOptimizedRetract = true;
            }
          } else if(!isLastLayer){
            // Layer transition: G1 retract on face axis + Z raise simultaneously (safe diagonal G1),
            // then check position. No sample-axis travel needed — serpentine means next layer starts here.
            var layerTransitionZ = layerRetractZ[li];
            logLine('face', 'Layer ' + layerNum + ' \u2192 ' + (layerNum + 1) + ': G1 retract ' + axis + '=' + startCoord.toFixed(3) + ' Z=' + layerTransitionZ.toFixed(3) + ' (F3000).');
            var _ltrPos;
            if(axis === 'X'){
              await moveAbs(startCoord, null, layerTransitionZ, 3000);
            } else {
              await moveAbs(null, startCoord, layerTransitionZ, 3000);
            }
            _ltrPos = await getWorkPosition();
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
              updateAllResultsUI();
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
        logLine('face', 'Layer ' + layerNum + '/' + totalLayers + ' complete: ' + layerContacts + ' contact(s)');
      }

      saveProbeResults();
      logLine('face', 'Layered face probe complete: ' + totalLayers + ' layers x ' + faceSamples.length + ' samples = ' + layeredFaceResults.length + ' total contacts');
      pluginDebug('runFaceProbe layered: faceResults=' + faceResults.length + ' layeredFaceResults=' + layeredFaceResults.length);
      logLine('face', 'Waiting for controller idle before finish motion...');
      await waitForIdle();
      await sleep(200);
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
      }
      // Consume the flag — set to true at end of previous iteration after a diagonal retract.
      // The check above already used it; reset so the default (full positioning) applies next time.
      spDidOptimizedRetract = false;

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
        var nextLineCoord = Number(faceSamples[i + 1].sampleCoord);
        // Two-step retract: (1) G1 retract on face axis to clear wall, then (2) G38.3 travel
        // on sample axis to detect live-edge bumps during the hop to the next sample position.
        logLine('face', 'Inter-sample return: G1 retract ' + axis + '=' + startCoord.toFixed(3) + ', then G38.3 travel ' + sampledAxis + '=' + nextLineCoord.toFixed(3) + ' at same Z (F3000 / F' + Number(s.travelFeedRate).toFixed(0) + ').');
        // Step 1: G1 retract on face axis — MUST complete fully to clear probe from wall.
        if(axis === 'X'){
          await moveAbs(startCoord, null, null, 3000);
        } else {
          await moveAbs(null, startCoord, null, 3000);
        }
        // Step 2: G38.3 travel on sample axis — detect live-edge bumps during lateral hop.
        var _spIsrPos;
        if(axis === 'X'){
          _spIsrPos = await probeSafeMove(null, nextLineCoord, null, s.travelFeedRate);
        } else {
          _spIsrPos = await probeSafeMove(nextLineCoord, null, null, s.travelFeedRate);
        }
        if(_spIsrPos.probeTriggered){
          logLine('face', 'INTER-SAMPLE TRAVEL CONTACT: probe triggered during diagonal retract at X=' + Number(_spIsrPos.x).toFixed(3) + ' Y=' + Number(_spIsrPos.y).toFixed(3) + ' Z=' + Number(_spIsrPos.z).toFixed(3));
          var _spIsrRec = makeFaceContactRecord(faceResults.length + 1, _spIsrPos, axis, 'EARLY_CONTACT_INTER_SAMPLE_RETRACT_' + axis, targetCoord, lineCoord);
          faceResults.push(_spIsrRec);
          updateAllResultsUI();
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
    await sleep(200);
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
