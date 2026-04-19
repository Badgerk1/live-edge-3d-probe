// ─────────────────────────────────────────────────────────
//  outline-probe.js  –  360 outline capture
//  Uses existing sm* motion primitives.
//  Phase 1: Surface reference probe (standalone button)
//  Phase 2: X-axis edge scan (face-first, row by row)
//  Phase 3: Y-axis edge scan (face-first, col by col)
//  Phase 4: 360 face probe from edge grid
// ─────────────────────────────────────────────────────────

var outlineRowResults = [];   // {y, xLeft, xRight, hasLeft, hasRight}
var outlineColResults = [];   // {x, yBottom, yTop, hasBottom, hasTop}
var outlineSurfaceZ   = null;
var _outlineRunning   = false;
var _outlineStopFlag  = false;

// ── Stop control ──────────────────────────────────────────
function outlineCheckStop() {
  if (_outlineStopFlag || _stopRequested) throw new Error('STOP_REQUESTED');
  smCheckStop();
}

function stopOutlineScan() {
  _outlineStopFlag = true;
  _stopRequested   = true;
  smStopFlag       = true;
  outlineAppendLog('Stop requested.');
  outlineSetStatus('Stopping\u2026', 'warn');
  setFooterStatus('Stopping\u2026', 'warn');
}

// ── Log backup / recovery ─────────────────────────────────
function clearOutlineLogBackup() {
  try { localStorage.removeItem('outlineLogBackup'); } catch(e) {}
}

function recoverOutlineLog() {
  var saved = localStorage.getItem('outlineLogBackup');
  if (!saved) {
    outlineAppendLog('No saved log found in localStorage.');
    return;
  }
  var logEl = document.getElementById('outline-log');
  if (logEl) {
    logEl.innerHTML = '';
    var lines = saved.split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim()) logLine('outline', '[RECOVERED] ' + lines[i]);
    }
  }
  outlineAppendLog('Recovered ' + saved.split('\n').length + ' log lines from last session.');
}

// ── Read outline settings ─────────────────────────────────
function _outlineSettings() {
  function gn(id, def) { var el = document.getElementById(id); if (!el) return def; var v = Number(el.value); return isNaN(v) ? def : v; }
  function gb(id) { var el = document.getElementById(id); return el ? el.checked : false; }
  return {
    x0:                gn('outlineX0',               0),
    xLen:              gn('outlineXLen',             100),
    y0:                gn('outlineY0',               0),
    yLen:              gn('outlineYLen',             100),
    yStep:             gn('outlineYStep',            5),
    xStep:             gn('outlineXStep',            5),
    faceDepth:         gn('outlineFaceDepth',        3),
    faceFeed:          gn('outlineFaceFeed',         200),
    retractAbove:      gn('outlineRetractAbove',     2),
    overshoot:         gn('outlineOvershoot',        2),
    approachDist:      gn('outlineApproachDist',     10),
    safeTravelZ:       gn('outlineSafeTravelZ',      10),
    zStepDepth:        gn('outlineZStepDepth',       5),
    probeFeed:         gn('outlineProbeFeed',        200),
    fastFeed:          gn('outlineFastFeed',         800),
    retractFeed:       gn('outlineRetractFeed',      600),
    clearZ:            gn('outlineClearZ',           5),
    probeDown:         gn('outlineProbeDown',        5),
    skipSurfaceProbe:  gb('outlineSkipSurfaceProbe')
  };
}

// ── Get/set surface Z from UI field ───────────────────────
function _outlineGetSurfaceZ() {
  var el = document.getElementById('outlineSurfaceZ');
  if (!el || el.value === '') return null;
  var v = Number(el.value);
  return isNaN(v) ? null : v;
}

function _outlineSetSurfaceZField(z) {
  var el = document.getElementById('outlineSurfaceZ');
  if (el) el.value = z.toFixed(4);
  outlineSurfaceZ = z;
}

// ── Lower Z to absolute position (moves down or up) ───────
async function _outlineMoveToZ(targetZ, feed) {
  outlineAppendLog('LOWER: Z to ' + targetZ.toFixed(3) + ' at F' + feed.toFixed(0));
  await sendCommand('G90 G1 Z' + targetZ.toFixed(3) + ' F' + feed.toFixed(0));
  await sleep(50);
  await waitForIdleWithTimeout(30000);
}

// ── Safety retract helper ─────────────────────────────────
async function _outlineSafetyRetract() {
  try {
    var safeFeed = Number((document.getElementById('outlineFastFeed') || {}).value) || 800;
    outlineAppendLog('SAFETY RETRACT: Z to machine Z=0');
    await moveMachineZAbs(0, safeFeed);
    await sleep(50);
    await waitForIdleWithTimeout(30000);
    outlineAppendLog('SAFETY RETRACT: returning to X0 Y0');
    await moveAbs(0, 0, null, safeFeed);
  } catch(re) { pluginDebug('Safety retract failed: ' + re.message); }
}

// ── Absolute travel helper — retract Z first, then move X/Y diagonally ───────
// Uses G90 absolute moves so Z never exceeds soft limits regardless of start Z.
async function _outlineAbsTravel(targetX, targetY, safeTravelZ, fastFeed, retractFeed) {
  var pos = await getWorkPosition();
  outlineAppendLog('TRAVEL: current pos X=' + pos.x.toFixed(3) + ' Y=' + pos.y.toFixed(3) + ' Z=' + pos.z.toFixed(3));
  if (pos.z < safeTravelZ) {
    outlineAppendLog('RETRACT: Z to safeTravelZ=' + safeTravelZ.toFixed(3) + ' at F' + retractFeed.toFixed(0));
    await sendCommand('G90 G1 Z' + safeTravelZ.toFixed(3) + ' F' + retractFeed.toFixed(0));
    await sleep(50);
    await waitForIdleWithTimeout(30000);
  }
  outlineAppendLog('TRAVEL: diagonal to X=' + targetX.toFixed(3) + ' Y=' + targetY.toFixed(3) + ' at F' + fastFeed.toFixed(0));
  await moveAbs(targetX, targetY, null, fastFeed);
}

// ── Phase 1: Surface reference probe ─────────────────────
async function runOutlineSurfaceProbe() {
  if (_outlineRunning) { outlineAppendLog('Already running.'); return; }
  _outlineRunning  = true;
  _outlineStopFlag = false;
  _stopRequested   = false;
  _running         = true;

  clearLog('outline');
  outlineSetProgress(0);
  outlineSetStatus('Surface probe\u2026', '');
  setFooterStatus('Outline surface probe running\u2026', '');

  try {
    var cfg = _outlineSettings();
    outlineAppendLog('Phase 1: Surface Reference Probe');
    await requireStartupHomingPreflight('Outline Surface Probe');

    // 1. Retract to machine Z=0 (absolute ceiling) — guarantees clearance
    //    when surface Z is unknown and work Z zero may be below the wood.
    outlineAppendLog('RETRACT: Z to machine Z=0 (top of travel) for safe lateral move');
    await moveMachineZAbs(0, cfg.retractFeed);
    await sleep(50);
    await waitForIdleWithTimeout(30000);

    // 2. Diagonal move to grid center — already at max Z so no lift needed.
    //    Use moveAbs NOT smSafeLateralMove (which tries relative Z lift → soft limit alarm at ceiling).
    var cx = cfg.x0 + cfg.xLen / 2;
    var cy = cfg.y0 + cfg.yLen / 2;
    outlineAppendLog('TRAVEL: diagonal to center X=' + cx.toFixed(3) + ' Y=' + cy.toFixed(3) + ' at F' + cfg.fastFeed);
    await moveAbs(cx, cy, null, cfg.fastFeed);

    // 3. Read current work Z — this is the full travel distance available
    //    from machine ceiling to work zero. Probe the entire range so the
    //    probe finds the surface no matter how far down it is.
    var pos = await getWorkPosition();
    var fullPlunge = pos.z + 5;  // +5mm margin below work Z=0
    outlineAppendLog('PROBE: full Z plunge from Z=' + pos.z.toFixed(3) + ' distance=' + fullPlunge.toFixed(3));

    // 4. G38.2 plunge — stops on contact, errors only if nothing touched
    // Calculate timeout: travel time at probe feed rate + 10s buffer
    var probeTimeMs = Math.ceil((fullPlunge / cfg.probeFeed) * 60000) + 10000;
    outlineAppendLog('PROBE: G91 G38.2 Z-' + fullPlunge.toFixed(3) + ' F' + cfg.probeFeed.toFixed(0) + ' timeout=' + probeTimeMs + 'ms');
    await sendCommand('G91 G38.2 Z-' + fullPlunge.toFixed(3) + ' F' + cfg.probeFeed.toFixed(0), probeTimeMs);
    await sleep(50);
    await waitForIdleWithTimeout(30000);

    var endPos = await getWorkPosition();
    var pinTriggered = await smGetProbeTriggered();
    var distTraveled = pos.z - endPos.z;
    outlineAppendLog('PROBE RESULT: pinTriggered=' + pinTriggered +
      ' startZ=' + pos.z.toFixed(3) + ' endZ=' + endPos.z.toFixed(3) + ' traveled=' + distTraveled.toFixed(3));

    if (!pinTriggered && distTraveled >= (fullPlunge - 0.5)) {
      throw new Error('Surface probe: No contact in full Z travel range (' + fullPlunge.toFixed(1) + 'mm)');
    }

    var surfZ = endPos.z;
    outlineAppendLog('Surface Z established: ' + surfZ.toFixed(4));

    _outlineSetSurfaceZField(surfZ);
    outlineSetProgress(50);

    // 5. Retract to surfZ + retractAbove — gives proper clearance for diagonal return
    var retractZ = surfZ + cfg.retractAbove;
    outlineAppendLog('RETRACT: Z to surfZ+retractAbove=' + retractZ.toFixed(3) + ' at F' + cfg.retractFeed);
    await smRetractToZ(retractZ, cfg.retractFeed);

    // 6. Diagonal return to X0 Y0
    outlineAppendLog('TRAVEL: diagonal return to X0 Y0 at F' + cfg.fastFeed);
    await moveAbs(0, 0, null, cfg.fastFeed);

    outlineSetProgress(100);
    outlineSetStatus('Surface Z = ' + surfZ.toFixed(4) + ' \u2013 ready', 'good');
    outlineAppendLog('Phase 1 complete. Surface Z=' + surfZ.toFixed(4) + '. Returned to X0 Y0.');
    setFooterStatus('Surface probe done \u2013 Z=' + surfZ.toFixed(4), 'good');

  } catch(e) {
    if (e.message === 'STOP_REQUESTED' || e.message === 'Stopped by user') {
      outlineAppendLog('Stopped by user.');
      outlineSetStatus('Stopped', 'warn');
      setFooterStatus('Outline stopped', 'warn');
    } else {
      outlineAppendLog('ERROR: ' + e.message);
      outlineSetStatus('Error: ' + e.message, 'error');
      setFooterStatus('Outline error: ' + e.message, 'error');
    }
    await _outlineSafetyRetract();
  } finally {
    _outlineRunning  = false;
    _outlineStopFlag = false;
    _running         = false;
  }
}

// ── Horizontal edge probe (G38.3 — no error on miss) ──────
async function _probeHorizEdge(axis, targetCoord, feed, safeTravelZ) {
  var pos0 = await getWorkPosition();
  var pinState = await smGetProbeTriggered();
  outlineAppendLog('PROBE PIN STATE: triggered=' + pinState + ' before probe move');
  outlineAppendLog('PROBE: G38.3 ' + axis + targetCoord.toFixed(3) + ' F' + feed.toFixed(0) +
    ' from X=' + pos0.x.toFixed(3) + ' Y=' + pos0.y.toFixed(3) + ' Z=' + pos0.z.toFixed(3));
  await smEnsureProbeClear(safeTravelZ, feed);

  // Calculate travel distance for timeout
  var travelDist = (axis === 'X') ? Math.abs(targetCoord - pos0.x) : Math.abs(targetCoord - pos0.y);
  var probeTimeMs = Math.ceil((travelDist / feed) * 60000) + 10000;

  // G38.3 — probe without error on miss; machine just stops at target if no contact
  await sendCommand('G90 G38.3 ' + axis + targetCoord.toFixed(3) + ' F' + feed.toFixed(0), probeTimeMs);
  await sleep(50);
  await waitForIdleWithTimeout(probeTimeMs);

  var pos = await getWorkPosition();
  var pinAfter = await smGetProbeTriggered();

  // Position-based contact detection: stopped well short of target means probe triggered
  var endCoord = (axis === 'X') ? pos.x : pos.y;
  var distToTarget = Math.abs(targetCoord - endCoord);
  var stoppedShort = distToTarget > 0.5;
  var triggered = pinAfter || stoppedShort;

  // Attach triggered flag to pos object for callers
  pos.probeTriggered = triggered;

  outlineAppendLog('PROBE RESULT: triggered=' + triggered + ' pinAfter=' + pinAfter +
    ' stoppedShort=' + stoppedShort + ' distToTarget=' + distToTarget.toFixed(3) +
    ' X=' + pos.x.toFixed(3) + ' Y=' + pos.y.toFixed(3) + ' Z=' + pos.z.toFixed(3));
  return pos;
}

// ── Surface step probe (Z plunge, G38.3 — no error on miss) ──
async function _surfStepProbe(probeDown, probeFeed) {
  var startPos = await getWorkPosition();
  var startZ   = startPos.z;
  var pinBefore = await smGetProbeTriggered();
  outlineAppendLog('PROBE PIN STATE: triggered=' + pinBefore + ' before surface step probe');
  outlineAppendLog('PROBE: surface plunge at X=' + startPos.x.toFixed(3) +
    ' Y=' + startPos.y.toFixed(3) + ' Z=' + startZ.toFixed(3) +
    ' depth=' + probeDown.toFixed(3) + ' F' + probeFeed.toFixed(0));
  await sendCommand('G91 G38.3 Z-' + Math.abs(probeDown).toFixed(4) + ' F' + probeFeed.toFixed(0));
  await sleep(50);
  await waitForIdleWithTimeout(30000);
  var pos = await getWorkPosition();
  var distanceTraveled = startZ - pos.z;
  var stoppedShort = distanceTraveled < (probeDown - 0.5);
  var triggered = pos.probeTriggered || stoppedShort;
  var pinAfter = await smGetProbeTriggered();
  outlineAppendLog('PROBE RESULT: triggered=' + triggered + ' pinAfter=' + pinAfter +
    ' X=' + pos.x.toFixed(3) + ' Y=' + pos.y.toFixed(3) + ' Z=' + pos.z.toFixed(3) +
    ' traveled=' + distanceTraveled.toFixed(3));
  return { triggered: triggered, z: pos.z, x: pos.x, y: pos.y };
}

// ── Phase 2: Row scan (X scanlines at fixed Y) ────────────
async function _runRowScan(cfg, surfZ) {
  var totalRows = Math.ceil(cfg.yLen / cfg.yStep) + 1;
  var rowIdx    = 0;
  var faceZ       = surfZ - cfg.faceDepth;    // absolute Z below surface for face probe
  var clearZ      = surfZ + cfg.retractAbove; // absolute Z above surface after contact
  var safeTravelZ = surfZ + cfg.safeTravelZ;  // absolute Z for inter-row travel (offset from surface)

  outlineAppendLog('X-axis scan: surfZ=' + surfZ.toFixed(3) +
    ' faceZ=' + faceZ.toFixed(3) + ' clearZ=' + clearZ.toFixed(3) +
    ' safeTravelZ=' + safeTravelZ.toFixed(3) + ' rows=' + totalRows);

  for (var y = cfg.y0; y <= cfg.y0 + cfg.yLen + 1e-9; y += cfg.yStep) {
    outlineCheckStop();
    var rowY     = parseFloat(y.toFixed(6));
    rowIdx++;
    var rowStart = Date.now();
    outlineAppendLog('\u2500\u2500 Row ' + rowIdx + '/' + totalRows + ' Y=' + rowY.toFixed(3) + ' \u2500\u2500');

    // 1. Travel to approach position (outside bounds on -X side)
    var approachX = cfg.x0 - cfg.approachDist;
    outlineAppendLog('TRAVEL: approach X=' + approachX.toFixed(3) + ' Y=' + rowY.toFixed(3) + ' at F' + cfg.fastFeed);
    await _outlineAbsTravel(approachX, rowY, safeTravelZ, cfg.fastFeed, cfg.retractFeed);

    // 2. Lower Z to face probe depth (below surface)
    outlineAppendLog('LOWER: Z to faceZ=' + faceZ.toFixed(3) + ' at F' + cfg.retractFeed);
    await _outlineMoveToZ(faceZ, cfg.retractFeed);

    // 3. Probe +X for left (near) edge
    var leftTarget = cfg.x0 + cfg.xLen + cfg.approachDist;
    var edgePos    = await _probeHorizEdge('X', leftTarget, cfg.faceFeed, safeTravelZ);

    if (!edgePos.probeTriggered) {
      outlineAppendLog('Row Y=' + rowY.toFixed(3) + ' complete. No edges found.');
      outlineRowResults.push({ y: rowY, xLeft: null, xRight: null, hasLeft: false, hasRight: false });
      outlineAppendLog('RETRACT: Z to safeTravelZ=' + safeTravelZ.toFixed(3) + ' at F' + cfg.retractFeed);
      await sendCommand('G90 G1 Z' + safeTravelZ.toFixed(3) + ' F' + cfg.retractFeed.toFixed(0));
      await sleep(50);
      await waitForIdleWithTimeout(30000);
      continue;
    }

    var xLeft = edgePos.x;
    outlineAppendLog('Row Y=' + rowY.toFixed(3) + ' Left edge TRIGGERED at X=' + xLeft.toFixed(3) + ' Z=' + edgePos.z.toFixed(3));

    var xRight = null;

    if (cfg.skipSurfaceProbe) {
      // ── Skip Surface Probe mode ──────────────────────────────────────────────
      // Retract to safe travel Z, go directly to the far end of the row, lower,
      // then back-probe -X to find the opposing (right) edge.
      outlineAppendLog('SKIP SURFACE PROBE: retracting to safeTravelZ=' + safeTravelZ.toFixed(3) + ' and travelling to row far end.');
      await smRetractToZ(safeTravelZ, cfg.retractFeed);

      var skipReverseX = cfg.x0 + cfg.xLen + cfg.approachDist;
      outlineAppendLog('SKIP SURFACE PROBE: TRAVEL to X=' + skipReverseX.toFixed(3) + ' Y=' + rowY.toFixed(3) + ' at F' + cfg.fastFeed);
      await _outlineAbsTravel(skipReverseX, rowY, safeTravelZ, cfg.fastFeed, cfg.retractFeed);

      outlineAppendLog('SKIP SURFACE PROBE: LOWER Z to faceZ=' + faceZ.toFixed(3) + ' at F' + cfg.retractFeed);
      await _outlineMoveToZ(faceZ, cfg.retractFeed);

      var skipRightEdgePos = await _probeHorizEdge('X', xLeft - 1, cfg.faceFeed, safeTravelZ);
      if (skipRightEdgePos.probeTriggered) {
        xRight = skipRightEdgePos.x;
        outlineAppendLog('SKIP SURFACE PROBE: Row Y=' + rowY.toFixed(3) + ' Right edge TRIGGERED at X=' + xRight.toFixed(3) + ' Z=' + skipRightEdgePos.z.toFixed(3));
      } else {
        outlineAppendLog('SKIP SURFACE PROBE: Row Y=' + rowY.toFixed(3) + ' Right edge not found from far end.');
      }

      outlineAppendLog('RETRACT: Z to safeTravelZ=' + safeTravelZ.toFixed(3) + ' at F' + cfg.retractFeed);
      await smRetractToZ(safeTravelZ, cfg.retractFeed);

    } else {
      // ── Standard surface step mode ───────────────────────────────────────────
      // 4. Back off -X from trigger
      var backoffX = xLeft - 2;
      outlineAppendLog('TRAVEL: backoff -X to X=' + backoffX.toFixed(3) + ' at F' + cfg.fastFeed);
      await sendCommand('G90 G1 X' + backoffX.toFixed(3) + ' F' + cfg.fastFeed.toFixed(0));
      await sleep(50);
      await waitForIdleWithTimeout(30000);

      // 5. Retract Z above surface
      outlineAppendLog('RETRACT: Z to clearZ=' + clearZ.toFixed(3) + ' at F' + cfg.retractFeed);
      await smRetractToZ(clearZ, cfg.retractFeed);

      // 6. Move +X past trigger by overshoot (now on top of wood)
      var overshootX = xLeft + cfg.overshoot;
      outlineAppendLog('TRAVEL: overshoot to X=' + overshootX.toFixed(3) + ' Y=' + rowY.toFixed(3) + ' at F' + cfg.fastFeed);
      await _outlineAbsTravel(overshootX, rowY, clearZ, cfg.fastFeed, cfg.retractFeed);

      // 7. Step +X across surface, plunge Z at each step until 2 consecutive misses
      var missCount = 0;
      var scanX     = overshootX;
      var scanStep  = Math.max(1, cfg.xStep / 2);
      var lastHitX  = overshootX;
      outlineAppendLog('Row Y=' + rowY.toFixed(3) + ' stepping +X from X=' + scanX.toFixed(3) + ' step=' + scanStep.toFixed(3));

      while (scanX <= cfg.x0 + cfg.xLen + cfg.approachDist + 1e-9) {
        outlineCheckStop();
        outlineAppendLog('TRAVEL: step to X=' + scanX.toFixed(3) + ' Y=' + rowY.toFixed(3) + ' at F' + cfg.fastFeed);
        await _outlineAbsTravel(scanX, rowY, clearZ, cfg.fastFeed, cfg.retractFeed);

        var stepResult = await _surfStepProbe(cfg.retractAbove + cfg.zStepDepth, cfg.probeFeed);
        outlineAppendLog('Row Y=' + rowY.toFixed(3) + ' surface step X=' + scanX.toFixed(3) +
          ' Z=' + stepResult.z.toFixed(3) + ' triggered=' + stepResult.triggered);

        outlineAppendLog('RETRACT: Z to clearZ=' + clearZ.toFixed(3) + ' at F' + cfg.retractFeed);
        await smRetractToZ(clearZ, cfg.retractFeed);

        if (stepResult.triggered) {
          missCount = 0;
          lastHitX  = scanX;
        } else {
          missCount++;
          outlineAppendLog('Row Y=' + rowY.toFixed(3) + ' miss #' + missCount + ' at X=' + scanX.toFixed(3));
          if (missCount >= 2) {
            outlineAppendLog('Row Y=' + rowY.toFixed(3) + ' off-part confirmed. Last hit X=' + lastHitX.toFixed(3));
            break;
          }
        }
        scanX += scanStep;
      }

      // 8. Reverse probe -X for exact right edge
      var reverseStartX = Math.min(lastHitX + scanStep * 2, cfg.x0 + cfg.xLen + cfg.approachDist);
      outlineAppendLog('TRAVEL: reverse probe start X=' + reverseStartX.toFixed(3) + ' at F' + cfg.fastFeed);
      await _outlineAbsTravel(reverseStartX, rowY, safeTravelZ, cfg.fastFeed, cfg.retractFeed);

      outlineAppendLog('LOWER: Z to faceZ=' + faceZ.toFixed(3) + ' at F' + cfg.retractFeed);
      await _outlineMoveToZ(faceZ, cfg.retractFeed);

      var rightEdgePos = await _probeHorizEdge('X', xLeft - 1, cfg.faceFeed, safeTravelZ);
      if (rightEdgePos.probeTriggered) {
        xRight = rightEdgePos.x;
        outlineAppendLog('Row Y=' + rowY.toFixed(3) + ' Right edge TRIGGERED at X=' + xRight.toFixed(3) + ' Z=' + rightEdgePos.z.toFixed(3));
      } else {
        xRight = lastHitX;
        outlineAppendLog('Row Y=' + rowY.toFixed(3) + ' Right edge not confirmed, using lastHitX=' + xRight.toFixed(3));
      }

      // 9. Retract to safeTravelZ
      outlineAppendLog('RETRACT: Z to safeTravelZ=' + safeTravelZ.toFixed(3) + ' at F' + cfg.retractFeed);
      await smRetractToZ(safeTravelZ, cfg.retractFeed);
    }

    outlineRowResults.push({ y: rowY, xLeft: xLeft, xRight: xRight, hasLeft: true, hasRight: xRight !== null });
    var rowMs = Date.now() - rowStart;
    outlineAppendLog('Row Y=' + rowY.toFixed(3) + ' complete. Left=' + xLeft.toFixed(3) +
      ' Right=' + (xRight !== null ? xRight.toFixed(3) : 'n/a') + ' in ' + rowMs + 'ms');
    outlineSetProgress((rowIdx / totalRows) * 50);
  }

  outlineAppendLog('X-axis scan complete. ' + outlineRowResults.length + ' rows scanned. Returning to X0 Y0.');
  await _outlineAbsTravel(0, 0, safeTravelZ, cfg.fastFeed, cfg.retractFeed);
}

// ── Phase 3: Column scan (Y scanlines at fixed X) ─────────
async function _runColScan(cfg, surfZ) {
  var totalCols = Math.ceil(cfg.xLen / cfg.xStep) + 1;
  var colIdx    = 0;
  var faceZ       = surfZ - cfg.faceDepth;
  var clearZ      = surfZ + cfg.retractAbove;
  var safeTravelZ = surfZ + cfg.safeTravelZ;  // absolute Z for inter-col travel (offset from surface)

  outlineAppendLog('Y-axis scan: surfZ=' + surfZ.toFixed(3) +
    ' faceZ=' + faceZ.toFixed(3) + ' clearZ=' + clearZ.toFixed(3) +
    ' safeTravelZ=' + safeTravelZ.toFixed(3) + ' cols=' + totalCols);

  for (var x = cfg.x0; x <= cfg.x0 + cfg.xLen + 1e-9; x += cfg.xStep) {
    outlineCheckStop();
    var colX     = parseFloat(x.toFixed(6));
    colIdx++;
    var colStart = Date.now();
    outlineAppendLog('\u2500\u2500 Col ' + colIdx + '/' + totalCols + ' X=' + colX.toFixed(3) + ' \u2500\u2500');

    // 1. Travel to approach position (outside bounds on -Y side)
    var approachY = cfg.y0 - cfg.approachDist;
    outlineAppendLog('TRAVEL: approach X=' + colX.toFixed(3) + ' Y=' + approachY.toFixed(3) + ' at F' + cfg.fastFeed);
    await _outlineAbsTravel(colX, approachY, safeTravelZ, cfg.fastFeed, cfg.retractFeed);

    // 2. Lower Z to face probe depth (below surface)
    outlineAppendLog('LOWER: Z to faceZ=' + faceZ.toFixed(3) + ' at F' + cfg.retractFeed);
    await _outlineMoveToZ(faceZ, cfg.retractFeed);

    // 3. Probe +Y for bottom (near) edge
    var bottomTarget = cfg.y0 + cfg.yLen + cfg.approachDist;
    var edgePos      = await _probeHorizEdge('Y', bottomTarget, cfg.faceFeed, safeTravelZ);

    if (!edgePos.probeTriggered) {
      outlineAppendLog('Col X=' + colX.toFixed(3) + ' complete. No edges found.');
      outlineColResults.push({ x: colX, yBottom: null, yTop: null, hasBottom: false, hasTop: false });
      outlineAppendLog('RETRACT: Z to safeTravelZ=' + safeTravelZ.toFixed(3) + ' at F' + cfg.retractFeed);
      await sendCommand('G90 G1 Z' + safeTravelZ.toFixed(3) + ' F' + cfg.retractFeed.toFixed(0));
      await sleep(50);
      await waitForIdleWithTimeout(30000);
      continue;
    }

    var yBottom = edgePos.y;
    outlineAppendLog('Col X=' + colX.toFixed(3) + ' Bottom edge TRIGGERED at Y=' + yBottom.toFixed(3) + ' Z=' + edgePos.z.toFixed(3));

    var yTop = null;

    if (cfg.skipSurfaceProbe) {
      // ── Skip Surface Probe mode ──────────────────────────────────────────────
      // Retract to safe travel Z, go directly to the far end of the column, lower,
      // then back-probe -Y to find the opposing (top) edge.
      outlineAppendLog('SKIP SURFACE PROBE: retracting to safeTravelZ=' + safeTravelZ.toFixed(3) + ' and travelling to col far end.');
      await smRetractToZ(safeTravelZ, cfg.retractFeed);

      var skipReverseY = cfg.y0 + cfg.yLen + cfg.approachDist;
      outlineAppendLog('SKIP SURFACE PROBE: TRAVEL to X=' + colX.toFixed(3) + ' Y=' + skipReverseY.toFixed(3) + ' at F' + cfg.fastFeed);
      await _outlineAbsTravel(colX, skipReverseY, safeTravelZ, cfg.fastFeed, cfg.retractFeed);

      outlineAppendLog('SKIP SURFACE PROBE: LOWER Z to faceZ=' + faceZ.toFixed(3) + ' at F' + cfg.retractFeed);
      await _outlineMoveToZ(faceZ, cfg.retractFeed);

      var skipTopEdgePos = await _probeHorizEdge('Y', yBottom - 1, cfg.faceFeed, safeTravelZ);
      if (skipTopEdgePos.probeTriggered) {
        yTop = skipTopEdgePos.y;
        outlineAppendLog('SKIP SURFACE PROBE: Col X=' + colX.toFixed(3) + ' Top edge TRIGGERED at Y=' + yTop.toFixed(3) + ' Z=' + skipTopEdgePos.z.toFixed(3));
      } else {
        outlineAppendLog('SKIP SURFACE PROBE: Col X=' + colX.toFixed(3) + ' Top edge not found from far end.');
      }

      outlineAppendLog('RETRACT: Z to safeTravelZ=' + safeTravelZ.toFixed(3) + ' at F' + cfg.retractFeed);
      await smRetractToZ(safeTravelZ, cfg.retractFeed);

    } else {
      // ── Standard surface step mode ───────────────────────────────────────────
      // 4. Back off -Y from trigger
      var backoffY = yBottom - 2;
      outlineAppendLog('TRAVEL: backoff -Y to Y=' + backoffY.toFixed(3) + ' at F' + cfg.fastFeed);
      await sendCommand('G90 G1 Y' + backoffY.toFixed(3) + ' F' + cfg.fastFeed.toFixed(0));
      await sleep(50);
      await waitForIdleWithTimeout(30000);

      // 5. Retract Z above surface
      outlineAppendLog('RETRACT: Z to clearZ=' + clearZ.toFixed(3) + ' at F' + cfg.retractFeed);
      await smRetractToZ(clearZ, cfg.retractFeed);

      // 6. Move +Y past bottom edge by overshoot
      var overshootY = yBottom + cfg.overshoot;
      outlineAppendLog('TRAVEL: overshoot to X=' + colX.toFixed(3) + ' Y=' + overshootY.toFixed(3) + ' at F' + cfg.fastFeed);
      await _outlineAbsTravel(colX, overshootY, clearZ, cfg.fastFeed, cfg.retractFeed);

      // 7. Step +Y across surface, plunge Z at each step until 2 consecutive misses
      var missCount = 0;
      var scanY     = overshootY;
      var scanStep  = Math.max(1, cfg.yStep / 2);
      var lastHitY  = overshootY;
      outlineAppendLog('Col X=' + colX.toFixed(3) + ' stepping +Y from Y=' + scanY.toFixed(3) + ' step=' + scanStep.toFixed(3));

      while (scanY <= cfg.y0 + cfg.yLen + cfg.approachDist + 1e-9) {
        outlineCheckStop();
        outlineAppendLog('TRAVEL: step to X=' + colX.toFixed(3) + ' Y=' + scanY.toFixed(3) + ' at F' + cfg.fastFeed);
        await _outlineAbsTravel(colX, scanY, clearZ, cfg.fastFeed, cfg.retractFeed);

        var stepResult = await _surfStepProbe(cfg.retractAbove + cfg.zStepDepth, cfg.probeFeed);
        outlineAppendLog('Col X=' + colX.toFixed(3) + ' surface step Y=' + scanY.toFixed(3) +
          ' Z=' + stepResult.z.toFixed(3) + ' triggered=' + stepResult.triggered);

        outlineAppendLog('RETRACT: Z to clearZ=' + clearZ.toFixed(3) + ' at F' + cfg.retractFeed);
        await smRetractToZ(clearZ, cfg.retractFeed);

        if (stepResult.triggered) {
          missCount = 0;
          lastHitY  = scanY;
        } else {
          missCount++;
          outlineAppendLog('Col X=' + colX.toFixed(3) + ' miss #' + missCount + ' at Y=' + scanY.toFixed(3));
          if (missCount >= 2) {
            outlineAppendLog('Col X=' + colX.toFixed(3) + ' off-part confirmed. Last hit Y=' + lastHitY.toFixed(3));
            break;
          }
        }
        scanY += scanStep;
      }

      // 8. Reverse probe -Y for exact top edge
      var reverseStartY = Math.min(lastHitY + scanStep * 2, cfg.y0 + cfg.yLen + cfg.approachDist);
      outlineAppendLog('TRAVEL: reverse probe start Y=' + reverseStartY.toFixed(3) + ' at F' + cfg.fastFeed);
      await _outlineAbsTravel(colX, reverseStartY, safeTravelZ, cfg.fastFeed, cfg.retractFeed);

      outlineAppendLog('LOWER: Z to faceZ=' + faceZ.toFixed(3) + ' at F' + cfg.retractFeed);
      await _outlineMoveToZ(faceZ, cfg.retractFeed);

      var topEdgePos = await _probeHorizEdge('Y', yBottom - 1, cfg.faceFeed, safeTravelZ);
      if (topEdgePos.probeTriggered) {
        yTop = topEdgePos.y;
        outlineAppendLog('Col X=' + colX.toFixed(3) + ' Top edge TRIGGERED at Y=' + yTop.toFixed(3) + ' Z=' + topEdgePos.z.toFixed(3));
      } else {
        yTop = lastHitY;
        outlineAppendLog('Col X=' + colX.toFixed(3) + ' Top edge not confirmed, using lastHitY=' + yTop.toFixed(3));
      }

      // 9. Retract to safeTravelZ
      outlineAppendLog('RETRACT: Z to safeTravelZ=' + safeTravelZ.toFixed(3) + ' at F' + cfg.retractFeed);
      await smRetractToZ(safeTravelZ, cfg.retractFeed);
    }

    outlineColResults.push({ x: colX, yBottom: yBottom, yTop: yTop, hasBottom: true, hasTop: yTop !== null });
    var colMs = Date.now() - colStart;
    outlineAppendLog('Col X=' + colX.toFixed(3) + ' complete. Bottom=' + yBottom.toFixed(3) +
      ' Top=' + (yTop !== null ? yTop.toFixed(3) : 'n/a') + ' in ' + colMs + 'ms');
    outlineSetProgress(50 + (colIdx / totalCols) * 50);
  }

  outlineAppendLog('Y-axis scan complete. ' + outlineColResults.length + ' cols scanned. Returning to X0 Y0.');
  await _outlineAbsTravel(0, 0, safeTravelZ, cfg.fastFeed, cfg.retractFeed);
}

// ── Main outline scan (Phases 2 + 3) ─────────────────────
async function runOutlineScan() {
  if (_outlineRunning) { outlineAppendLog('Already running.'); return; }
  _outlineRunning   = true;
  _outlineStopFlag  = false;
  _stopRequested    = false;
  _running          = true;
  outlineRowResults = [];
  outlineColResults = [];

  clearLog('outline');
  outlineSetProgress(0);
  outlineSetStatus('Running\u2026', '');
  setFooterStatus('Outline scan running\u2026', '');

  try {
    var cfg = _outlineSettings();
    if (cfg.xLen <= 0 || cfg.yLen <= 0) throw new Error('Outline bounds invalid (XLen/YLen must be > 0)');
    if (cfg.yStep <= 0) cfg.yStep = 5;
    if (cfg.xStep <= 0) cfg.xStep = 5;

    // Surface Z from UI field (probed or manually entered)
    var surfZ = _outlineGetSurfaceZ();
    if (surfZ === null) {
      throw new Error('Surface Z not set. Run \u25bc Surface Probe first or enter a value in the Surface Z field.');
    }
    outlineSurfaceZ = surfZ;

    outlineAppendLog('Outline scan start. SurfaceZ=' + surfZ.toFixed(4) +
      ' Bounds: X' + cfg.x0.toFixed(2) + '+' + cfg.xLen.toFixed(2) +
      '  Y' + cfg.y0.toFixed(2) + '+' + cfg.yLen.toFixed(2));
    outlineAppendLog('Settings: ' + JSON.stringify(cfg, null, 0));

    await requireStartupHomingPreflight('Outline Scan');
    var safeTravelZ = surfZ + cfg.safeTravelZ;
    await smEnsureProbeClear(safeTravelZ, cfg.fastFeed);

    // Phase 2: X-axis edge scan
    outlineAppendLog('\u2500\u2500 Phase 2: X-axis edge scan \u2500\u2500');
    await _runRowScan(cfg, surfZ);

    // Phase 3: Y-axis edge scan
    outlineCheckStop();
    outlineAppendLog('\u2500\u2500 Phase 3: Y-axis edge scan \u2500\u2500');
    await _runColScan(cfg, surfZ);

    // Return home
    outlineCheckStop();
    await _outlineAbsTravel(0, 0, safeTravelZ, cfg.fastFeed, cfg.retractFeed);

    outlineSetProgress(100);
    outlineSetStatus('Done \u2013 ' + outlineRowResults.length + ' rows, ' + outlineColResults.length + ' cols', 'good');
    outlineAppendLog('Outline scan complete.');
    outlineAppendLog('Rows: ' + outlineRowResults.length + '  Cols: ' + outlineColResults.length);
    setFooterStatus('Outline scan done', 'good');
    drawOutlineCanvas();

  } catch(e) {
    if (e.message === 'STOP_REQUESTED' || e.message === 'Stopped by user') {
      outlineAppendLog('Stopped by user.');
      outlineSetStatus('Stopped', 'warn');
      setFooterStatus('Outline stopped', 'warn');
    } else {
      outlineAppendLog('ERROR: ' + e.message);
      outlineSetStatus('Error: ' + e.message, 'error');
      setFooterStatus('Outline error: ' + e.message, 'error');
    }
    await _outlineSafetyRetract();
  } finally {
    _outlineRunning  = false;
    _outlineStopFlag = false;
    _running         = false;
  }
}

// ── Phase 4: 360 face probe from outline edge grid ────────
async function runOutline360FaceProbe() {
  if (_outlineRunning) { outlineAppendLog('Scan still running.'); return; }

  if (outlineRowResults.length === 0 || outlineSurfaceZ === null) {
    outlineAppendLog('No outline scan data. Run Outline Scan first.');
    outlineSetStatus('No outline data \u2013 run Outline Scan first', 'warn');
    return;
  }

  _outlineRunning  = true;
  _outlineStopFlag = false;
  _stopRequested   = false;
  _running         = true;
  faceResults      = [];

  clearLog('outline');
  outlineSetStatus('Running 360 face probe\u2026', '');
  setFooterStatus('360 face probe running\u2026', '');

  try {
    await requireStartupHomingPreflight('360 Face Probe');

    var cfg         = _outlineSettings();
    var faceZ       = outlineSurfaceZ - cfg.faceDepth;
    var safeTravelZ = outlineSurfaceZ + cfg.safeTravelZ;  // absolute Z for travel (offset from surface)
    var travelFeed  = cfg.fastFeed;
    var feed        = cfg.faceFeed;
    var retFeed     = cfg.retractFeed;
    var n           = 0;
    var totalOps    = outlineRowResults.length * 2 + outlineColResults.length * 2;
    var done        = 0;

    await smEnsureProbeClear(safeTravelZ, travelFeed);
    outlineAppendLog('360 face probe: surfZ=' + outlineSurfaceZ.toFixed(3) +
      ' faceZ=' + faceZ.toFixed(3) + ' safeTravelZ=' + safeTravelZ.toFixed(3) + ' approachDist=' + cfg.approachDist.toFixed(1));

    // ── Probe left and right X edges from row results ──────────
    for (var ri = 0; ri < outlineRowResults.length; ri++) {
      var row = outlineRowResults[ri];
      outlineCheckStop();

      if (row.hasLeft && row.xLeft !== null) {
        var approachX = row.xLeft - cfg.approachDist;
        outlineAppendLog('360 Face: edge #' + (n + 1) + ' axis=X dir=+X at X=' + row.xLeft.toFixed(3) + ' Y=' + row.y.toFixed(3));
        outlineAppendLog('TRAVEL: approach X=' + approachX.toFixed(3) + ' Y=' + row.y.toFixed(3) + ' at F' + travelFeed);
        await _outlineAbsTravel(approachX, row.y, safeTravelZ, travelFeed, retFeed);
        outlineAppendLog('LOWER: Z to faceZ=' + faceZ.toFixed(3) + ' at F' + retFeed);
        await _outlineMoveToZ(faceZ, retFeed);
        await smEnsureProbeClear(safeTravelZ, travelFeed);
        var _lStartPos = await getWorkPosition();
        var _lStartX   = Number(_lStartPos.x);
        var _lTarget   = row.xLeft + cfg.approachDist * 2;
        var _lProbeTimeMs = Math.ceil((Math.abs(_lTarget - _lStartX) / feed) * 60000) + 10000;
        outlineAppendLog('PROBE: G38.2 X' + _lTarget.toFixed(3) + ' F' + feed +
          ' from X=' + _lStartPos.x.toFixed(3) + ' Y=' + _lStartPos.y.toFixed(3) + ' Z=' + _lStartPos.z.toFixed(3));
        await sendCommand('G90 G38.2 X' + _lTarget.toFixed(3) + ' F' + feed.toFixed(0), _lProbeTimeMs);
        await sleep(50);
        var lpos = await waitForIdleWithTimeout(_lProbeTimeMs);
        if (!lpos) lpos = await getWorkPosition();
        var _lEndX = Number(lpos.x);
        var _lDist = Math.abs(_lTarget - _lStartX);
        var _lTrav = Math.abs(_lEndX - _lStartX);
        if (!lpos.probeTriggered && _lDist > 0.5 && _lTrav < (_lDist - 0.5)) {
          lpos = Object.assign({}, lpos, { probeTriggered: true });
        }
        outlineAppendLog('PROBE RESULT: triggered=' + !!lpos.probeTriggered +
          ' X=' + lpos.x.toFixed(3) + ' Y=' + lpos.y.toFixed(3) + ' Z=' + lpos.z.toFixed(3));
        if (lpos.probeTriggered) {
          n++;
          faceResults.push(makeFaceContactRecord(n, lpos, 'X', 'triggered', row.xLeft, row.y));
          outlineAppendLog('360 Face: edge #' + n + ' axis=X dir=+X at X=' + lpos.x.toFixed(3) +
            ' Y=' + lpos.y.toFixed(3) + ' Z=' + lpos.z.toFixed(3) + ' TRIGGERED');
        }
        outlineAppendLog('RETRACT: Z to safeTravelZ=' + safeTravelZ.toFixed(3) + ' at F' + retFeed);
        await smRetractToZ(safeTravelZ, retFeed);
      }
      done++;
      outlineSetProgress((done / totalOps) * 100);

      outlineCheckStop();
      if (row.hasRight && row.xRight !== null) {
        var approachXR = row.xRight + cfg.approachDist;
        outlineAppendLog('360 Face: edge #' + (n + 1) + ' axis=X dir=-X at X=' + row.xRight.toFixed(3) + ' Y=' + row.y.toFixed(3));
        outlineAppendLog('TRAVEL: approach X=' + approachXR.toFixed(3) + ' Y=' + row.y.toFixed(3) + ' at F' + travelFeed);
        await _outlineAbsTravel(approachXR, row.y, safeTravelZ, travelFeed, retFeed);
        outlineAppendLog('LOWER: Z to faceZ=' + faceZ.toFixed(3) + ' at F' + retFeed);
        await _outlineMoveToZ(faceZ, retFeed);
        await smEnsureProbeClear(safeTravelZ, travelFeed);
        var _rStartPos = await getWorkPosition();
        var _rStartX   = Number(_rStartPos.x);
        var _rTarget   = row.xRight - cfg.approachDist * 2;
        var _rProbeTimeMs = Math.ceil((Math.abs(_rTarget - _rStartX) / feed) * 60000) + 10000;
        outlineAppendLog('PROBE: G38.2 X' + _rTarget.toFixed(3) + ' F' + feed +
          ' from X=' + _rStartPos.x.toFixed(3) + ' Y=' + _rStartPos.y.toFixed(3) + ' Z=' + _rStartPos.z.toFixed(3));
        await sendCommand('G90 G38.2 X' + _rTarget.toFixed(3) + ' F' + feed.toFixed(0), _rProbeTimeMs);
        await sleep(50);
        var rpos = await waitForIdleWithTimeout(_rProbeTimeMs);
        if (!rpos) rpos = await getWorkPosition();
        var _rEndX = Number(rpos.x);
        var _rDist = Math.abs(_rTarget - _rStartX);
        var _rTrav = Math.abs(_rEndX - _rStartX);
        if (!rpos.probeTriggered && _rDist > 0.5 && _rTrav < (_rDist - 0.5)) {
          rpos = Object.assign({}, rpos, { probeTriggered: true });
        }
        outlineAppendLog('PROBE RESULT: triggered=' + !!rpos.probeTriggered +
          ' X=' + rpos.x.toFixed(3) + ' Y=' + rpos.y.toFixed(3) + ' Z=' + rpos.z.toFixed(3));
        if (rpos.probeTriggered) {
          n++;
          faceResults.push(makeFaceContactRecord(n, rpos, 'X', 'triggered', row.xRight, row.y));
          outlineAppendLog('360 Face: edge #' + n + ' axis=X dir=-X at X=' + rpos.x.toFixed(3) +
            ' Y=' + rpos.y.toFixed(3) + ' Z=' + rpos.z.toFixed(3) + ' TRIGGERED');
        }
        outlineAppendLog('RETRACT: Z to safeTravelZ=' + safeTravelZ.toFixed(3) + ' at F' + retFeed);
        await smRetractToZ(safeTravelZ, retFeed);
      }
      done++;
      outlineSetProgress((done / totalOps) * 100);
    }

    // ── Probe bottom and top Y edges from col results ──────────
    for (var ci = 0; ci < outlineColResults.length; ci++) {
      var col = outlineColResults[ci];
      outlineCheckStop();

      if (col.hasBottom && col.yBottom !== null) {
        var approachYB = col.yBottom - cfg.approachDist;
        outlineAppendLog('360 Face: edge #' + (n + 1) + ' axis=Y dir=+Y at X=' + col.x.toFixed(3) + ' Y=' + col.yBottom.toFixed(3));
        outlineAppendLog('TRAVEL: approach X=' + col.x.toFixed(3) + ' Y=' + approachYB.toFixed(3) + ' at F' + travelFeed);
        await _outlineAbsTravel(col.x, approachYB, safeTravelZ, travelFeed, retFeed);
        outlineAppendLog('LOWER: Z to faceZ=' + faceZ.toFixed(3) + ' at F' + retFeed);
        await _outlineMoveToZ(faceZ, retFeed);
        await smEnsureProbeClear(safeTravelZ, travelFeed);
        var _bStartPos = await getWorkPosition();
        var _bStartY   = Number(_bStartPos.y);
        var _bTarget   = col.yBottom + cfg.approachDist * 2;
        var _bProbeTimeMs = Math.ceil((Math.abs(_bTarget - _bStartY) / feed) * 60000) + 10000;
        outlineAppendLog('PROBE: G38.2 Y' + _bTarget.toFixed(3) + ' F' + feed +
          ' from X=' + _bStartPos.x.toFixed(3) + ' Y=' + _bStartPos.y.toFixed(3) + ' Z=' + _bStartPos.z.toFixed(3));
        await sendCommand('G90 G38.2 Y' + _bTarget.toFixed(3) + ' F' + feed.toFixed(0), _bProbeTimeMs);
        await sleep(50);
        var bpos = await waitForIdleWithTimeout(_bProbeTimeMs);
        if (!bpos) bpos = await getWorkPosition();
        var _bEndY = Number(bpos.y);
        var _bDist = Math.abs(_bTarget - _bStartY);
        var _bTrav = Math.abs(_bEndY - _bStartY);
        if (!bpos.probeTriggered && _bDist > 0.5 && _bTrav < (_bDist - 0.5)) {
          bpos = Object.assign({}, bpos, { probeTriggered: true });
        }
        outlineAppendLog('PROBE RESULT: triggered=' + !!bpos.probeTriggered +
          ' X=' + bpos.x.toFixed(3) + ' Y=' + bpos.y.toFixed(3) + ' Z=' + bpos.z.toFixed(3));
        if (bpos.probeTriggered) {
          n++;
          faceResults.push(makeFaceContactRecord(n, bpos, 'Y', 'triggered', col.yBottom, col.x));
          outlineAppendLog('360 Face: edge #' + n + ' axis=Y dir=+Y at X=' + col.x.toFixed(3) +
            ' Y=' + bpos.y.toFixed(3) + ' Z=' + bpos.z.toFixed(3) + ' TRIGGERED');
        }
        outlineAppendLog('RETRACT: Z to safeTravelZ=' + safeTravelZ.toFixed(3) + ' at F' + retFeed);
        await smRetractToZ(safeTravelZ, retFeed);
      }
      done++;
      outlineSetProgress((done / totalOps) * 100);

      outlineCheckStop();
      if (col.hasTop && col.yTop !== null) {
        var approachYT = col.yTop + cfg.approachDist;
        outlineAppendLog('360 Face: edge #' + (n + 1) + ' axis=Y dir=-Y at X=' + col.x.toFixed(3) + ' Y=' + col.yTop.toFixed(3));
        outlineAppendLog('TRAVEL: approach X=' + col.x.toFixed(3) + ' Y=' + approachYT.toFixed(3) + ' at F' + travelFeed);
        await _outlineAbsTravel(col.x, approachYT, safeTravelZ, travelFeed, retFeed);
        outlineAppendLog('LOWER: Z to faceZ=' + faceZ.toFixed(3) + ' at F' + retFeed);
        await _outlineMoveToZ(faceZ, retFeed);
        await smEnsureProbeClear(safeTravelZ, travelFeed);
        var _tStartPos = await getWorkPosition();
        var _tStartY   = Number(_tStartPos.y);
        var _tTarget   = col.yTop - cfg.approachDist * 2;
        var _tProbeTimeMs = Math.ceil((Math.abs(_tTarget - _tStartY) / feed) * 60000) + 10000;
        outlineAppendLog('PROBE: G38.2 Y' + _tTarget.toFixed(3) + ' F' + feed +
          ' from X=' + _tStartPos.x.toFixed(3) + ' Y=' + _tStartPos.y.toFixed(3) + ' Z=' + _tStartPos.z.toFixed(3));
        await sendCommand('G90 G38.2 Y' + _tTarget.toFixed(3) + ' F' + feed.toFixed(0), _tProbeTimeMs);
        await sleep(50);
        var tpos = await waitForIdleWithTimeout(_tProbeTimeMs);
        if (!tpos) tpos = await getWorkPosition();
        var _tEndY = Number(tpos.y);
        var _tDist = Math.abs(_tTarget - _tStartY);
        var _tTrav = Math.abs(_tEndY - _tStartY);
        if (!tpos.probeTriggered && _tDist > 0.5 && _tTrav < (_tDist - 0.5)) {
          tpos = Object.assign({}, tpos, { probeTriggered: true });
        }
        outlineAppendLog('PROBE RESULT: triggered=' + !!tpos.probeTriggered +
          ' X=' + tpos.x.toFixed(3) + ' Y=' + tpos.y.toFixed(3) + ' Z=' + tpos.z.toFixed(3));
        if (tpos.probeTriggered) {
          n++;
          faceResults.push(makeFaceContactRecord(n, tpos, 'Y', 'triggered', col.yTop, col.x));
          outlineAppendLog('360 Face: edge #' + n + ' axis=Y dir=-Y at X=' + col.x.toFixed(3) +
            ' Y=' + tpos.y.toFixed(3) + ' Z=' + tpos.z.toFixed(3) + ' TRIGGERED');
        }
        outlineAppendLog('RETRACT: Z to safeTravelZ=' + safeTravelZ.toFixed(3) + ' at F' + retFeed);
        await smRetractToZ(safeTravelZ, retFeed);
      }
      done++;
      outlineSetProgress((done / totalOps) * 100);
    }

    outlineSetProgress(100);
    outlineAppendLog('360 face probe complete. ' + n + ' contacts recorded.');
    outlineSetStatus('360 face probe done \u2013 ' + n + ' contacts', 'good');
    setFooterStatus('360 face probe done', 'good');
    drawFaceCanvas();

  } catch(e) {
    if (e.message === 'STOP_REQUESTED' || e.message === 'Stopped by user') {
      outlineAppendLog('Stopped by user.');
      outlineSetStatus('Stopped', 'warn');
      setFooterStatus('360 face probe stopped', 'warn');
    } else {
      outlineAppendLog('ERROR: ' + e.message);
      outlineSetStatus('Error', 'error');
      setFooterStatus('360 face probe error', 'error');
    }
    await _outlineSafetyRetract();
  } finally {
    _outlineRunning  = false;
    _outlineStopFlag = false;
    _running         = false;
  }
}

// ── Outline Surface Grid Probe (full heightmap over outline bounds) ────────────
async function runOutlineSurfaceGridProbe() {
  if (_outlineRunning) { outlineAppendLog('Already running.'); return; }
  _outlineRunning  = true;
  _outlineStopFlag = false;
  _stopRequested   = false;
  _running         = true;

  var runBtn  = document.getElementById('outline-grid-run-btn');
  var stopBtn = document.getElementById('outline-grid-stop-btn');
  if (runBtn)  runBtn.disabled  = true;
  if (stopBtn) stopBtn.disabled = false;

  clearLog('outline');
  outlineSetProgress(0);
  outlineSetStatus('Surface grid probe running\u2026', '');
  setFooterStatus('Outline surface grid probe running\u2026', '');

  try {
    var cfg = _outlineSettings();
    if (cfg.xStep <= 0) cfg.xStep = 5;
    if (cfg.yStep <= 0) cfg.yStep = 5;

    // Surface Z must be known before probing — either from running ▼ Surface Probe or
    // entered manually.  The clearance height and plunge depth are computed relative to
    // the measured surface so the probe always starts safely above the wood regardless
    // of where the machine's work Z=0 is set.
    var surfZ = _outlineGetSurfaceZ();
    if (surfZ === null) {
      throw new Error('Surface Z not set. Run \u25bc Surface Probe first or enter a value in the Surface Z field.');
    }
    outlineSurfaceZ = surfZ;

    var clearanceZ = surfZ + cfg.retractAbove;          // absolute work Z above the known surface
    var maxPlunge  = cfg.retractAbove + cfg.probeDown;  // relative plunge: clear above + search below surface
    var probeFeed  = cfg.probeFeed;
    var travelFeed = cfg.fastFeed;

    // Sync meshSubdivisionSpacing from UI before using it
    meshSubdivisionSpacing = (function() {
      var el = document.getElementById('meshSubdivisionSpacing');
      return el ? (Number(el.value) || meshSubdivisionSpacing) : meshSubdivisionSpacing;
    })();

    // Determine grid bounds: from detected outline (inset by margin) or fallback to search bounds
    var gridSource = (function() { var el = document.getElementById('outlineGridSource'); return el ? el.value : 'detected'; })();
    var gridMargin = (function() { var el = document.getElementById('outlineGridMargin'); return el ? (Number(el.value) || 2) : 2; })();
    var hasOutlineData = (outlineRowResults.length > 0 || outlineColResults.length > 0);

    var gridMinX, gridMaxX, gridMinY, gridMaxY;

    if (gridSource === 'detected' && hasOutlineData) {
      // Compute bounds from actual measured edge points and row/col coordinates
      var allX = [], allY = [];
      outlineRowResults.forEach(function(r) {
        if (r.hasLeft  && r.xLeft  !== null) { allX.push(r.xLeft);  allY.push(r.y); }
        if (r.hasRight && r.xRight !== null) { allX.push(r.xRight); allY.push(r.y); }
      });
      outlineColResults.forEach(function(c) {
        if (c.hasBottom && c.yBottom !== null) { allX.push(c.x); allY.push(c.yBottom); }
        if (c.hasTop    && c.yTop    !== null) { allX.push(c.x); allY.push(c.yTop); }
      });
      if (allX.length === 0 || allY.length === 0) throw new Error('Outline scan data present but no valid edge points found');
      gridMinX = Math.min.apply(null, allX) + gridMargin;
      gridMaxX = Math.max.apply(null, allX) - gridMargin;
      gridMinY = Math.min.apply(null, allY) + gridMargin;
      gridMaxY = Math.max.apply(null, allY) - gridMargin;
      if (gridMinX >= gridMaxX) throw new Error('Outline X bounds too narrow after applying ' + gridMargin + 'mm margin (minX=' + gridMinX.toFixed(3) + ' maxX=' + gridMaxX.toFixed(3) + ')');
      if (gridMinY >= gridMaxY) throw new Error('Outline Y bounds too narrow after applying ' + gridMargin + 'mm margin (minY=' + gridMinY.toFixed(3) + ' maxY=' + gridMaxY.toFixed(3) + ')');
      outlineAppendLog('Grid bounds from detected outline (margin=' + gridMargin + 'mm): X' + gridMinX.toFixed(3) + '\u2192' + gridMaxX.toFixed(3) + '  Y' + gridMinY.toFixed(3) + '\u2192' + gridMaxY.toFixed(3));
    } else {
      if (gridSource === 'detected') outlineAppendLog('No outline scan data \u2014 falling back to Outline Search Bounds.');
      if (cfg.xLen <= 0 || cfg.yLen <= 0) throw new Error('Outline bounds invalid (XLen/YLen must be > 0)');
      gridMinX = cfg.x0;
      gridMaxX = cfg.x0 + cfg.xLen;
      gridMinY = cfg.y0;
      gridMaxY = cfg.y0 + cfg.yLen;
    }

    var xLen = gridMaxX - gridMinX;
    var yLen = gridMaxY - gridMinY;

    var gridCfg = {
      minX:       gridMinX,
      maxX:       gridMaxX,
      colSpacing: cfg.xStep,
      minY:       gridMinY,
      maxY:       gridMaxY,
      rowSpacing: cfg.yStep,
      colCount:   Math.floor(xLen / cfg.xStep) + 1,
      rowCount:   Math.floor(yLen / cfg.yStep) + 1
    };

    var totalPoints = gridCfg.colCount * gridCfg.rowCount;
    var probed = 0;
    var result = [];
    for (var ri = 0; ri < gridCfg.rowCount; ri++) {
      result.push([]);
      for (var ci = 0; ci < gridCfg.colCount; ci++) result[ri].push(null);
    }

    outlineAppendLog('=== Outline Surface Grid Probe ===');
    outlineAppendLog('Grid: ' + gridCfg.colCount + 'x' + gridCfg.rowCount + ' = ' + totalPoints + ' points');
    outlineAppendLog('Bounds: X' + gridCfg.minX.toFixed(3) + '\u2192' + gridCfg.maxX.toFixed(3) +
      '  Y' + gridCfg.minY.toFixed(3) + '\u2192' + gridCfg.maxY.toFixed(3));
    outlineAppendLog('Surface Z: ' + surfZ.toFixed(3) + ' (from Surface Probe) \u2192 clearanceZ=' + clearanceZ.toFixed(3) +
      ' maxPlunge=' + maxPlunge.toFixed(3));
    outlineAppendLog('Settings: probeFeed=' + probeFeed + ' travelFeed=' + travelFeed);

    await requireStartupHomingPreflight('Outline Surface Grid Probe');

    // Move Z to clearanceZ (= surfZ + retractAbove) before the first lateral travel.
    // Using an absolute target ensures the machine is safely above the surface regardless
    // of where the outline scan left it.  clearanceZ is computed from the measured surface
    // Z so it is always the correct absolute height, not a raw field value.
    outlineAppendLog('INITIAL RETRACT: Z to clearanceZ=' + clearanceZ.toFixed(3));
    await sendCommand('G90 G1 Z' + clearanceZ.toFixed(3) + ' F' + travelFeed);
    await sleep(50);
    await waitForIdleWithTimeout();

    for (var row = 0; row < gridCfg.rowCount; row++) {
      outlineCheckStop();
      var rowY = gridCfg.minY + row * gridCfg.rowSpacing;
      var reversed = (row % 2 !== 0);

      for (var step = 0; step < gridCfg.colCount; step++) {
        outlineCheckStop();
        var col = reversed ? (gridCfg.colCount - 1 - step) : step;
        var colX = gridCfg.minX + col * gridCfg.colSpacing;
        outlineAppendLog('Probing [' + row + ',' + col + '] X' + colX.toFixed(3) + ' Y' + rowY.toFixed(3));

        // Lateral travel to next probe point using absolute-retract-then-XY pattern:
        // - row=0, step=0: machine is already at clearanceZ from the absolute retract above;
        //   use a plain XY move (no extra Z needed).
        // - row>0, step=0: row-transition _outlineAbsTravel already positioned the machine here.
        // - all other points: coming from a probe contact (Z ≈ surfZ); _outlineAbsTravel
        //   raises to clearanceZ (absolute) before moving laterally, matching the outline
        //   edge scan pattern and avoiding the relative-lift overshoot of smSafeLateralMove.
        if (row === 0 && step === 0) {
          await moveAbs(colX, rowY, null, travelFeed);
        } else if (!(step === 0 && row > 0)) {
          await _outlineAbsTravel(colX, rowY, clearanceZ, travelFeed, travelFeed);
        }

        // Ensure probe pin is not already triggered before plunging
        await smEnsureProbeClear(clearanceZ, travelFeed);

        // Plunge probe
        var pos = await smPlungeProbe(maxPlunge, probeFeed);
        result[row][col] = pos.z;
        probed++;
        outlineSetProgress(probed / totalPoints * 100);
        outlineAppendLog('  -> Z=' + pos.z.toFixed(4));
      }

      // Row transition: position at start of next row
      if (row + 1 < gridCfg.rowCount) {
        outlineCheckStop();
        var nextY = gridCfg.minY + (row + 1) * gridCfg.rowSpacing;
        var nextStartX = reversed ? gridCfg.minX : gridCfg.maxX;
        outlineAppendLog('ROW TRANSITION: row ' + row + ' done; moving to start of row ' + (row + 1) +
          ' X=' + nextStartX.toFixed(3) + ' Y=' + nextY.toFixed(3));
        await _outlineAbsTravel(nextStartX, nextY, clearanceZ, travelFeed, travelFeed);
        await smEnsureProbeClear(clearanceZ, travelFeed);
      }
    }

    // Store results in the global surface mesh variables (same as Probe tab)
    smMeshDataRaw   = result;
    smGridConfigRaw = gridCfg;
    var subdivided  = subdivideSurfaceMesh(result, gridCfg, meshSubdivisionSpacing);
    smMeshData      = subdivided.grid;
    smGridConfig    = subdivided.config;

    outlineSetProgress(100);
    outlineAppendLog('Surface grid probe complete! ' + probed + ' points captured.');
    outlineSetStatus('Grid probe done \u2013 ' + probed + ' points', 'good');
    setFooterStatus('Outline surface grid probe complete', 'good');

    // Finish motion: retract Z, then always return to work origin X0 Y0
    await finishRunMotion('outline');
    outlineAppendLog('Returning to work origin X0 Y0\u2026');
    await moveAbs(0, 0, null, travelFeed);

    // Persist mesh and refresh UI (enables DXF/OBJ/STL exports and Apply tab)
    smSaveMeshToStorage();
    try { updateSurfaceMeshUI(); }    catch(e) { console.warn('updateSurfaceMeshUI error (non-fatal):', e); }
    try { populateSurfaceResults(); } catch(e) { console.warn('populateSurfaceResults error (non-fatal):', e); }

  } catch(e) {
    var msg;
    if (e && e.message) { msg = e.message; }
    else if (e == null)  { msg = 'Unknown error'; }
    else                 { msg = String(e); }
    if (msg === 'STOP_REQUESTED' || msg === 'Stopped by user') {
      outlineAppendLog('Stopped by user.');
      outlineSetStatus('Stopped', 'warn');
      setFooterStatus('Outline grid probe stopped', 'warn');
    } else {
      outlineAppendLog('ERROR: ' + msg);
      outlineSetStatus('Error: ' + msg, 'error');
      setFooterStatus('Outline grid probe error: ' + msg, 'error');
      console.error('Outline surface grid probe error:', e);
    }
    await _outlineSafetyRetract();
  } finally {
    _outlineRunning  = false;
    _outlineStopFlag = false;
    _running         = false;
    var runBtnF  = document.getElementById('outline-grid-run-btn');
    var stopBtnF = document.getElementById('outline-grid-stop-btn');
    if (runBtnF)  runBtnF.disabled  = false;
    if (stopBtnF) stopBtnF.disabled = true;
  }
}

// ── Draw outline canvas ───────────────────────────────────
function drawOutlineCanvas() {
  if (window.probeViz && typeof window.probeViz.drawOutlineCanvas === 'function') {
    window.probeViz.drawOutlineCanvas();
  }
}

// ── Move probe to absolute centre of outline ──────────────
async function moveToCentre() {
  if (outlineRowResults.length === 0 && outlineColResults.length === 0) {
    outlineAppendLog('No outline data — run Outline Scan first.');
    outlineSetStatus('No outline data – run Outline Scan first', 'warn');
    return;
  }

  var allX = [], allY = [];
  outlineRowResults.forEach(function(r) {
    if (r.hasLeft  && r.xLeft  !== null) { allX.push(r.xLeft);  allY.push(r.y); }
    if (r.hasRight && r.xRight !== null) { allX.push(r.xRight); allY.push(r.y); }
  });
  outlineColResults.forEach(function(c) {
    if (c.hasBottom && c.yBottom !== null) { allX.push(c.x); allY.push(c.yBottom); }
    if (c.hasTop    && c.yTop    !== null) { allX.push(c.x); allY.push(c.yTop); }
  });

  if (allX.length === 0) {
    outlineAppendLog('No valid edge points to compute centre.');
    return;
  }

  var xMin = Math.min.apply(null, allX);
  var xMax = Math.max.apply(null, allX);
  var yMin = Math.min.apply(null, allY);
  var yMax = Math.max.apply(null, allY);
  var cx = (xMin + xMax) / 2;
  var cy = (yMin + yMax) / 2;

  var cfg = _outlineSettings();
  var surfZ = (typeof outlineSurfaceZ !== 'undefined' && outlineSurfaceZ !== null) ? outlineSurfaceZ : 0;
  var safeTravelZ = surfZ + cfg.safeTravelZ;

  outlineAppendLog('MOVE TO CENTRE: X=' + cx.toFixed(3) + ' Y=' + cy.toFixed(3) + ' via safeTravelZ=' + safeTravelZ.toFixed(3));
  try {
    await _outlineAbsTravel(cx, cy, safeTravelZ, cfg.fastFeed, cfg.retractFeed);
    outlineAppendLog('Arrived at outline centre X=' + cx.toFixed(3) + ' Y=' + cy.toFixed(3));
    outlineSetStatus('At centre X=' + cx.toFixed(3) + ' Y=' + cy.toFixed(3), 'good');
    setFooterStatus('Probe moved to outline centre', 'good');
  } catch(e) {
    outlineAppendLog('ERROR moving to centre: ' + e.message);
    outlineSetStatus('Error moving to centre: ' + e.message, 'error');
  }
}

// ── Set WCS zero to absolute centre of outline ────────────
async function setWCSToCentre() {
  if (outlineRowResults.length === 0 && outlineColResults.length === 0) {
    outlineAppendLog('No outline data — run Outline Scan first.');
    outlineSetStatus('No outline data – run Outline Scan first', 'warn');
    return;
  }

  var allX = [], allY = [];
  outlineRowResults.forEach(function(r) {
    if (r.hasLeft  && r.xLeft  !== null) { allX.push(r.xLeft);  allY.push(r.y); }
    if (r.hasRight && r.xRight !== null) { allX.push(r.xRight); allY.push(r.y); }
  });
  outlineColResults.forEach(function(c) {
    if (c.hasBottom && c.yBottom !== null) { allX.push(c.x); allY.push(c.yBottom); }
    if (c.hasTop    && c.yTop    !== null) { allX.push(c.x); allY.push(c.yTop); }
  });

  if (allX.length === 0) {
    outlineAppendLog('No valid edge points to compute centre.');
    return;
  }

  var xMin = Math.min.apply(null, allX);
  var xMax = Math.max.apply(null, allX);
  var yMin = Math.min.apply(null, allY);
  var yMax = Math.max.apply(null, allY);
  var cx = (xMin + xMax) / 2;
  var cy = (yMin + yMax) / 2;

  var cmd = 'G10 L20 P1 X' + cx.toFixed(3) + ' Y' + cy.toFixed(3);
  outlineAppendLog('Set WCS zero to outline centre: ' + cmd);
  try {
    await sendCommand(cmd);
    outlineAppendLog('WCS X/Y zeroed at centre X=' + cx.toFixed(3) + ' Y=' + cy.toFixed(3));
    outlineSetStatus('WCS zeroed at centre X=' + cx.toFixed(3) + ' Y=' + cy.toFixed(3), 'good');
    setFooterStatus('WCS X/Y set to outline centre', 'good');
  } catch(e) {
    outlineAppendLog('ERROR setting WCS: ' + e.message);
    outlineSetStatus('Error setting WCS: ' + e.message, 'error');
  }
}

// ── Export SVG ────────────────────────────────────────────
function exportOutlineSVG() {
  if (outlineRowResults.length === 0 && outlineColResults.length === 0) {
    outlineAppendLog('No outline data to export.');
    return;
  }

  var cfg    = _outlineSettings();
  var margin = 10;
  var svgW   = cfg.xLen + 2 * margin;
  var svgH   = cfg.yLen + 2 * margin;

  function svgX(worldX) { return (worldX - cfg.x0 + margin).toFixed(3); }
  function svgY(worldY) { return (svgH - (worldY - cfg.y0 + margin)).toFixed(3); }

  var lines = [];
  lines.push('<?xml version="1.0" encoding="utf-8"?>');
  lines.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + svgW + 'mm" height="' + svgH + 'mm" viewBox="0 0 ' + svgW + ' ' + svgH + '">');
  lines.push('  <title>Live Edge Outline \u2013 ' + tsForFilename() + '</title>');
  lines.push('  <style>path { fill:none; }</style>');

  // Collect all edge points
  var allPts = [];
  outlineRowResults.forEach(function(r) {
    if (r.hasLeft  && r.xLeft  !== null) allPts.push([r.xLeft,  r.y]);
    if (r.hasRight && r.xRight !== null) allPts.push([r.xRight, r.y]);
  });
  outlineColResults.forEach(function(c) {
    if (c.hasBottom && c.yBottom !== null) allPts.push([c.x, c.yBottom]);
    if (c.hasTop    && c.yTop    !== null) allPts.push([c.x, c.yTop]);
  });

  // Deduplicate points within 0.1mm
  var dedupPts = [];
  allPts.forEach(function(pt) {
    var dup = dedupPts.some(function(p) {
      return Math.abs(p[0] - pt[0]) < 0.1 && Math.abs(p[1] - pt[1]) < 0.1;
    });
    if (!dup) dedupPts.push(pt);
  });

  if (dedupPts.length > 2) {
    // Find bottom-left point (lowest Y, then lowest X as tiebreaker) as the start.
    var blIdx = 0;
    dedupPts.forEach(function(p, i) {
      var b = dedupPts[blIdx];
      if (p[1] < b[1] || (p[1] === b[1] && p[0] < b[0])) blIdx = i;
    });

    // Order points using greedy nearest-neighbour traversal starting from blIdx.
    // More robust than a pure angular sort when probe points cluster at similar
    // centroid angles (e.g. row-scan and column-scan points mixing near the top
    // of a wide oval), because it always picks the physically closest unvisited
    // point rather than relying on angle from a distant centroid.
    var nnOrdered = [];
    var nnUsed = new Array(dedupPts.length).fill(false);
    var nnCur = blIdx;
    nnUsed[nnCur] = true;
    nnOrdered.push(dedupPts[nnCur]);
    while (nnOrdered.length < dedupPts.length) {
      var nnBest = -1, nnBestD = Infinity;
      for (var j = 0; j < dedupPts.length; j++) {
        if (nnUsed[j]) continue;
        var ddx = dedupPts[j][0] - dedupPts[nnCur][0];
        var ddy = dedupPts[j][1] - dedupPts[nnCur][1];
        var d2 = ddx * ddx + ddy * ddy;
        if (d2 < nnBestD) { nnBestD = d2; nnBest = j; }
      }
      if (nnBest === -1) break;
      nnUsed[nnBest] = true;
      nnCur = nnBest;
      nnOrdered.push(dedupPts[nnCur]);
    }
    // Ensure clockwise winding (negative signed area in world Y-up coords).
    var nnArea = 0;
    for (var i = 0; i < nnOrdered.length; i++) {
      var j2 = (i + 1) % nnOrdered.length;
      nnArea += nnOrdered[i][0] * nnOrdered[j2][1] - nnOrdered[j2][0] * nnOrdered[i][1];
    }
    if (nnArea > 0) nnOrdered.reverse(); // CCW → flip to CW
    dedupPts = nnOrdered;

    // Smooth closed centripetal Catmull-Rom spline (alpha=0.5).
    // Converts each segment directly to an exact cubic bezier ('C' SVG command)
    // using the centripetal-CR tangent formula — no polyline subdivision needed,
    // giving a mathematically perfect smooth curve in the exported SVG.
    function crBezier(p0, p1, p2, p3) {
      // knot interval = (chord_length)^0.5 (centripetal, alpha=0.5)
      function knot(a, b) {
        var dx = b[0]-a[0], dy = b[1]-a[1];
        return Math.pow(dx*dx + dy*dy, 0.25);
      }
      var t0 = 0;
      var t1 = t0 + Math.max(knot(p0, p1), 1e-4);
      var t2 = t1 + Math.max(knot(p1, p2), 1e-4);
      var t3 = t2 + Math.max(knot(p2, p3), 1e-4);
      var dt = t2 - t1;
      // Centripetal CR derivative at p1 and p2 (w.r.t. knot parameter t)
      var T1x = (p1[0]-p0[0])/(t1-t0) - (p2[0]-p0[0])/(t2-t0) + (p2[0]-p1[0])/dt;
      var T1y = (p1[1]-p0[1])/(t1-t0) - (p2[1]-p0[1])/(t2-t0) + (p2[1]-p1[1])/dt;
      var T2x = (p2[0]-p1[0])/dt - (p3[0]-p1[0])/(t3-t1) + (p3[0]-p2[0])/(t3-t2);
      var T2y = (p2[1]-p1[1])/dt - (p3[1]-p1[1])/(t3-t1) + (p3[1]-p2[1])/(t3-t2);
      // Cubic bezier control points: cp1 = p1 + T1*dt/3,  cp2 = p2 - T2*dt/3
      return [
        [p1[0] + T1x*dt/3, p1[1] + T1y*dt/3],
        [p2[0] - T2x*dt/3, p2[1] - T2y*dt/3]
      ];
    }
    var n = dedupPts.length;
    function wIdx(i) { return ((i % n) + n) % n; } // wrap index for closed loop
    var dPoly = 'M ' + svgX(dedupPts[0][0]) + ',' + svgY(dedupPts[0][1]);
    for (var k = 0; k < n; k++) {
      var p0 = dedupPts[wIdx(k - 1)];
      var p1 = dedupPts[wIdx(k)];
      var p2 = dedupPts[wIdx(k + 1)];
      var p3 = dedupPts[wIdx(k + 2)];
      var bz = crBezier(p0, p1, p2, p3);
      dPoly += ' C ' + svgX(bz[0][0]) + ',' + svgY(bz[0][1]) +
               ' '   + svgX(bz[1][0]) + ',' + svgY(bz[1][1]) +
               ' '   + svgX(p2[0])    + ',' + svgY(p2[1]);
    }
    dPoly += ' Z';
    lines.push('  <path d="' + dPoly + '" stroke="#000000" stroke-width="0.8" />');
  }

  lines.push('</svg>');

  saveTextFile('outline_' + tsForFilename() + '.svg', lines.join('\n'));
  outlineAppendLog('SVG exported.');
}

// ── Export outline JSON ───────────────────────────────────
function exportOutlineJSON() {
  var payload = {
    generated: new Date().toISOString(),
    settings: _outlineSettings(),
    surfaceZ: outlineSurfaceZ,
    rowResults: outlineRowResults,
    colResults: outlineColResults
  };
  saveTextFile('outline_data_' + tsForFilename() + '.json', JSON.stringify(payload, null, 2));
  outlineAppendLog('Outline data exported as JSON.');
}
