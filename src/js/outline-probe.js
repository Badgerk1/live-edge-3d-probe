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
  return {
    x0:           gn('outlineX0',          0),
    xLen:         gn('outlineXLen',        100),
    y0:           gn('outlineY0',          0),
    yLen:         gn('outlineYLen',        100),
    yStep:        gn('outlineYStep',       5),
    xStep:        gn('outlineXStep',       5),
    faceDepth:    gn('outlineFaceDepth',   3),
    faceFeed:     gn('outlineFaceFeed',    200),
    retractAbove: gn('outlineRetractAbove',2),
    overshoot:    gn('outlineOvershoot',   2),
    approachDist: gn('outlineApproachDist',10),
    safeTravelZ:  gn('outlineSafeTravelZ', 10),
    zStepDepth:   gn('outlineZStepDepth',  5),
    probeFeed:    gn('outlineProbeFeed',   200),
    fastFeed:     gn('outlineFastFeed',    800),
    retractFeed:  gn('outlineRetractFeed', 600),
    clearZ:       gn('outlineClearZ',      5),
    probeDown:    gn('outlineProbeDown',   5)
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
    // Always retract to machine Z=0 first — guarantees clearance even if work Z zero
    // is set below the wood surface and safeTravelZ wouldn't clear it.
    var safeFeed = Number((document.getElementById('outlineFastFeed') || {}).value) || 800;
    outlineAppendLog('SAFETY RETRACT: Z to machine Z=0');
    await moveMachineZAbs(0, safeFeed);
    await sleep(50);
    await waitForIdleWithTimeout(30000);
  } catch(re) { pluginDebug('Safety retract failed: ' + re.message); }
}

// ── Absolute travel helper — retract Z first, then move X then Y ─────────────
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
  outlineAppendLog('TRAVEL: X to ' + targetX.toFixed(3) + ' at F' + fastFeed.toFixed(0));
  await sendCommand('G90 G1 X' + targetX.toFixed(3) + ' F' + fastFeed.toFixed(0));
  await sleep(50);
  await waitForIdleWithTimeout(30000);
  outlineAppendLog('TRAVEL: Y to ' + targetY.toFixed(3) + ' at F' + fastFeed.toFixed(0));
  await sendCommand('G90 G1 Y' + targetY.toFixed(3) + ' F' + fastFeed.toFixed(0));
  await sleep(50);
  await waitForIdleWithTimeout(30000);
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

    await smEnsureProbeClear(cfg.clearZ, cfg.fastFeed);

    // 1. Retract to machine Z=0 (top of travel) for guaranteed clearance
    //    Surface Z is unknown — safeTravelZ/clearZ may be below the wood
    outlineAppendLog('RETRACT: Z to machine Z=0 (top of travel) for safe lateral move');
    await moveMachineZAbs(0, cfg.retractFeed);
    await sleep(50);
    await waitForIdleWithTimeout(30000);

    // 2. Now safe to travel laterally to grid center
    var cx = cfg.x0 + cfg.xLen / 2;
    var cy = cfg.y0 + cfg.yLen / 2;
    outlineAppendLog('TRAVEL: moving to center X=' + cx.toFixed(3) + ' Y=' + cy.toFixed(3));
    await smSafeLateralMove(cx, cy, cfg.fastFeed, cfg.clearZ);

    // Temporarily set sm-clearanceZ so smPlungeProbe's internal smEnsureProbeClear uses the outline's value
    var smClearEl    = document.getElementById('sm-clearanceZ');
    var origClearVal = smClearEl ? smClearEl.value : '5';
    if (smClearEl) smClearEl.value = String(cfg.clearZ);

    var pos = await smPlungeProbe(cfg.probeDown, cfg.probeFeed);

    if (smClearEl) smClearEl.value = origClearVal;

    var surfZ = pos.z;
    outlineAppendLog('Surface Z established: ' + surfZ.toFixed(4));

    _outlineSetSurfaceZField(surfZ);
    outlineSetProgress(50);

    await smRetractToZ(cfg.safeTravelZ, cfg.retractFeed);

    outlineAppendLog('TRAVEL: returning to X0 Y0 at F' + cfg.fastFeed);
    await smSafeLateralMove(0, 0, cfg.fastFeed, cfg.clearZ);

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

// ── Horizontal edge probe (G38.2) ─────────────────────────
async function _probeHorizEdge(axis, targetCoord, feed, safeTravelZ) {
  var pos0 = await getWorkPosition();
  var pinState = await smGetProbeTriggered();
  outlineAppendLog('PROBE PIN STATE: triggered=' + pinState + ' before probe move');
  outlineAppendLog('PROBE: G38.2 ' + axis + targetCoord.toFixed(3) + ' F' + feed.toFixed(0) +
    ' from X=' + pos0.x.toFixed(3) + ' Y=' + pos0.y.toFixed(3) + ' Z=' + pos0.z.toFixed(3));
  await smEnsureProbeClear(safeTravelZ, feed);
  await sendCommand('G90 G38.2 ' + axis + targetCoord.toFixed(3) + ' F' + feed.toFixed(0));
  await sleep(50);
  await waitForIdleWithTimeout(30000);
  var pos = await getWorkPosition();
  var pinAfter = await smGetProbeTriggered();
  outlineAppendLog('PROBE RESULT: triggered=' + !!pos.probeTriggered + ' pinAfter=' + pinAfter +
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
  var faceZ     = surfZ - cfg.faceDepth;    // absolute Z below surface for face probe
  var clearZ    = surfZ + cfg.retractAbove; // absolute Z above surface after contact

  outlineAppendLog('X-axis scan: surfZ=' + surfZ.toFixed(3) +
    ' faceZ=' + faceZ.toFixed(3) + ' clearZ=' + clearZ.toFixed(3) +
    ' safeTravelZ=' + cfg.safeTravelZ.toFixed(3) + ' rows=' + totalRows);

  for (var y = cfg.y0; y <= cfg.y0 + cfg.yLen + 1e-9; y += cfg.yStep) {
    outlineCheckStop();
    var rowY     = parseFloat(y.toFixed(6));
    rowIdx++;
    var rowStart = Date.now();
    outlineAppendLog('\u2500\u2500 Row ' + rowIdx + '/' + totalRows + ' Y=' + rowY.toFixed(3) + ' \u2500\u2500');

    // 1. Travel to approach position (outside bounds on -X side)
    var approachX = cfg.x0 - cfg.approachDist;
    outlineAppendLog('TRAVEL: approach X=' + approachX.toFixed(3) + ' Y=' + rowY.toFixed(3) + ' at F' + cfg.fastFeed);
    await _outlineAbsTravel(approachX, rowY, cfg.safeTravelZ, cfg.fastFeed, cfg.retractFeed);

    // 2. Lower Z to face probe depth (below surface)
    outlineAppendLog('LOWER: Z to faceZ=' + faceZ.toFixed(3) + ' at F' + cfg.retractFeed);
    await _outlineMoveToZ(faceZ, cfg.retractFeed);

    // 3. Probe +X for left (near) edge
    var leftTarget = cfg.x0 + cfg.xLen + cfg.approachDist;
    var edgePos    = await _probeHorizEdge('X', leftTarget, cfg.faceFeed, cfg.safeTravelZ);

    if (!edgePos.probeTriggered) {
      outlineAppendLog('Row Y=' + rowY.toFixed(3) + ' complete. No edges found.');
      outlineRowResults.push({ y: rowY, xLeft: null, xRight: null, hasLeft: false, hasRight: false });
      await smRetractToZ(cfg.safeTravelZ, cfg.retractFeed);
      continue;
    }

    var xLeft = edgePos.x;
    outlineAppendLog('Row Y=' + rowY.toFixed(3) + ' Left edge TRIGGERED at X=' + xLeft.toFixed(3) + ' Z=' + edgePos.z.toFixed(3));

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
    var xRight    = null;
    var missCount = 0;
    var scanX     = overshootX;
    var scanStep  = Math.max(1, cfg.xStep / 2);
    var lastHitX  = overshootX;
    outlineAppendLog('Row Y=' + rowY.toFixed(3) + ' stepping +X from X=' + scanX.toFixed(3) + ' step=' + scanStep.toFixed(3));

    while (scanX <= cfg.x0 + cfg.xLen + cfg.approachDist + 1e-9) {
      outlineCheckStop();
      outlineAppendLog('TRAVEL: step to X=' + scanX.toFixed(3) + ' Y=' + rowY.toFixed(3) + ' at F' + cfg.fastFeed);
      await _outlineAbsTravel(scanX, rowY, clearZ, cfg.fastFeed, cfg.retractFeed);

      var stepResult = await _surfStepProbe(cfg.zStepDepth, cfg.probeFeed);
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
    await _outlineAbsTravel(reverseStartX, rowY, clearZ, cfg.fastFeed, cfg.retractFeed);

    outlineAppendLog('LOWER: Z to faceZ=' + faceZ.toFixed(3) + ' at F' + cfg.retractFeed);
    await _outlineMoveToZ(faceZ, cfg.retractFeed);

    var rightEdgePos = await _probeHorizEdge('X', xLeft - 1, cfg.faceFeed, cfg.safeTravelZ);
    if (rightEdgePos.probeTriggered) {
      xRight = rightEdgePos.x;
      outlineAppendLog('Row Y=' + rowY.toFixed(3) + ' Right edge TRIGGERED at X=' + xRight.toFixed(3) + ' Z=' + rightEdgePos.z.toFixed(3));
    } else {
      xRight = lastHitX;
      outlineAppendLog('Row Y=' + rowY.toFixed(3) + ' Right edge not confirmed, using lastHitX=' + xRight.toFixed(3));
    }

    // 9. Retract to safe travel Z
    outlineAppendLog('RETRACT: Z to safeTravelZ=' + cfg.safeTravelZ.toFixed(3) + ' at F' + cfg.retractFeed);
    await smRetractToZ(cfg.safeTravelZ, cfg.retractFeed);

    outlineRowResults.push({ y: rowY, xLeft: xLeft, xRight: xRight, hasLeft: true, hasRight: xRight !== null });
    var rowMs = Date.now() - rowStart;
    outlineAppendLog('Row Y=' + rowY.toFixed(3) + ' complete. Left=' + xLeft.toFixed(3) +
      ' Right=' + (xRight !== null ? xRight.toFixed(3) : 'n/a') + ' in ' + rowMs + 'ms');
    outlineSetProgress((rowIdx / totalRows) * 50);
  }

  outlineAppendLog('X-axis scan complete. ' + outlineRowResults.length + ' rows scanned. Returning to X0 Y0.');
  await _outlineAbsTravel(0, 0, cfg.safeTravelZ, cfg.fastFeed, cfg.retractFeed);
}

// ── Phase 3: Column scan (Y scanlines at fixed X) ─────────
async function _runColScan(cfg, surfZ) {
  var totalCols = Math.ceil(cfg.xLen / cfg.xStep) + 1;
  var colIdx    = 0;
  var faceZ     = surfZ - cfg.faceDepth;
  var clearZ    = surfZ + cfg.retractAbove;

  outlineAppendLog('Y-axis scan: surfZ=' + surfZ.toFixed(3) +
    ' faceZ=' + faceZ.toFixed(3) + ' clearZ=' + clearZ.toFixed(3) +
    ' safeTravelZ=' + cfg.safeTravelZ.toFixed(3) + ' cols=' + totalCols);

  for (var x = cfg.x0; x <= cfg.x0 + cfg.xLen + 1e-9; x += cfg.xStep) {
    outlineCheckStop();
    var colX     = parseFloat(x.toFixed(6));
    colIdx++;
    var colStart = Date.now();
    outlineAppendLog('\u2500\u2500 Col ' + colIdx + '/' + totalCols + ' X=' + colX.toFixed(3) + ' \u2500\u2500');

    // 1. Travel to approach position (outside bounds on -Y side)
    var approachY = cfg.y0 - cfg.approachDist;
    outlineAppendLog('TRAVEL: approach X=' + colX.toFixed(3) + ' Y=' + approachY.toFixed(3) + ' at F' + cfg.fastFeed);
    await _outlineAbsTravel(colX, approachY, cfg.safeTravelZ, cfg.fastFeed, cfg.retractFeed);

    // 2. Lower Z to face probe depth (below surface)
    outlineAppendLog('LOWER: Z to faceZ=' + faceZ.toFixed(3) + ' at F' + cfg.retractFeed);
    await _outlineMoveToZ(faceZ, cfg.retractFeed);

    // 3. Probe +Y for bottom (near) edge
    var bottomTarget = cfg.y0 + cfg.yLen + cfg.approachDist;
    var edgePos      = await _probeHorizEdge('Y', bottomTarget, cfg.faceFeed, cfg.safeTravelZ);

    if (!edgePos.probeTriggered) {
      outlineAppendLog('Col X=' + colX.toFixed(3) + ' complete. No edges found.');
      outlineColResults.push({ x: colX, yBottom: null, yTop: null, hasBottom: false, hasTop: false });
      await smRetractToZ(cfg.safeTravelZ, cfg.retractFeed);
      continue;
    }

    var yBottom = edgePos.y;
    outlineAppendLog('Col X=' + colX.toFixed(3) + ' Bottom edge TRIGGERED at Y=' + yBottom.toFixed(3) + ' Z=' + edgePos.z.toFixed(3));

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
    var yTop      = null;
    var missCount = 0;
    var scanY     = overshootY;
    var scanStep  = Math.max(1, cfg.yStep / 2);
    var lastHitY  = overshootY;
    outlineAppendLog('Col X=' + colX.toFixed(3) + ' stepping +Y from Y=' + scanY.toFixed(3) + ' step=' + scanStep.toFixed(3));

    while (scanY <= cfg.y0 + cfg.yLen + cfg.approachDist + 1e-9) {
      outlineCheckStop();
      outlineAppendLog('TRAVEL: step to X=' + colX.toFixed(3) + ' Y=' + scanY.toFixed(3) + ' at F' + cfg.fastFeed);
      await _outlineAbsTravel(colX, scanY, clearZ, cfg.fastFeed, cfg.retractFeed);

      var stepResult = await _surfStepProbe(cfg.zStepDepth, cfg.probeFeed);
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
    await _outlineAbsTravel(colX, reverseStartY, clearZ, cfg.fastFeed, cfg.retractFeed);

    outlineAppendLog('LOWER: Z to faceZ=' + faceZ.toFixed(3) + ' at F' + cfg.retractFeed);
    await _outlineMoveToZ(faceZ, cfg.retractFeed);

    var topEdgePos = await _probeHorizEdge('Y', yBottom - 1, cfg.faceFeed, cfg.safeTravelZ);
    if (topEdgePos.probeTriggered) {
      yTop = topEdgePos.y;
      outlineAppendLog('Col X=' + colX.toFixed(3) + ' Top edge TRIGGERED at Y=' + yTop.toFixed(3) + ' Z=' + topEdgePos.z.toFixed(3));
    } else {
      yTop = lastHitY;
      outlineAppendLog('Col X=' + colX.toFixed(3) + ' Top edge not confirmed, using lastHitY=' + yTop.toFixed(3));
    }

    // 9. Retract to safe travel Z
    outlineAppendLog('RETRACT: Z to safeTravelZ=' + cfg.safeTravelZ.toFixed(3) + ' at F' + cfg.retractFeed);
    await smRetractToZ(cfg.safeTravelZ, cfg.retractFeed);

    outlineColResults.push({ x: colX, yBottom: yBottom, yTop: yTop, hasBottom: true, hasTop: yTop !== null });
    var colMs = Date.now() - colStart;
    outlineAppendLog('Col X=' + colX.toFixed(3) + ' complete. Bottom=' + yBottom.toFixed(3) +
      ' Top=' + (yTop !== null ? yTop.toFixed(3) : 'n/a') + ' in ' + colMs + 'ms');
    outlineSetProgress(50 + (colIdx / totalCols) * 50);
  }

  outlineAppendLog('Y-axis scan complete. ' + outlineColResults.length + ' cols scanned. Returning to X0 Y0.');
  await _outlineAbsTravel(0, 0, cfg.safeTravelZ, cfg.fastFeed, cfg.retractFeed);
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
    await smEnsureProbeClear(cfg.safeTravelZ, cfg.fastFeed);

    // Phase 2: X-axis edge scan
    outlineAppendLog('\u2500\u2500 Phase 2: X-axis edge scan \u2500\u2500');
    await _runRowScan(cfg, surfZ);

    // Phase 3: Y-axis edge scan
    outlineCheckStop();
    outlineAppendLog('\u2500\u2500 Phase 3: Y-axis edge scan \u2500\u2500');
    await _runColScan(cfg, surfZ);

    // Return home
    outlineCheckStop();
    await _outlineAbsTravel(0, 0, cfg.safeTravelZ, cfg.fastFeed, cfg.retractFeed);

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
    var travelFeed  = cfg.fastFeed;
    var feed        = cfg.faceFeed;
    var retFeed     = cfg.retractFeed;
    var n           = 0;
    var totalOps    = outlineRowResults.length * 2 + outlineColResults.length * 2;
    var done        = 0;

    await smEnsureProbeClear(cfg.safeTravelZ, travelFeed);
    outlineAppendLog('360 face probe: surfZ=' + outlineSurfaceZ.toFixed(3) +
      ' faceZ=' + faceZ.toFixed(3) + ' approachDist=' + cfg.approachDist.toFixed(1));

    // ── Probe left and right X edges from row results ──────────
    for (var ri = 0; ri < outlineRowResults.length; ri++) {
      var row = outlineRowResults[ri];
      outlineCheckStop();

      if (row.hasLeft && row.xLeft !== null) {
        var approachX = row.xLeft - cfg.approachDist;
        outlineAppendLog('360 Face: edge #' + (n + 1) + ' axis=X dir=+X at X=' + row.xLeft.toFixed(3) + ' Y=' + row.y.toFixed(3));
        outlineAppendLog('TRAVEL: approach X=' + approachX.toFixed(3) + ' Y=' + row.y.toFixed(3) + ' at F' + travelFeed);
        await _outlineAbsTravel(approachX, row.y, cfg.safeTravelZ, travelFeed, retFeed);
        outlineAppendLog('LOWER: Z to faceZ=' + faceZ.toFixed(3) + ' at F' + retFeed);
        await _outlineMoveToZ(faceZ, retFeed);
        await smEnsureProbeClear(cfg.safeTravelZ, travelFeed);
        var _lStartPos = await getWorkPosition();
        var _lStartX   = Number(_lStartPos.x);
        var _lTarget   = row.xLeft + cfg.approachDist * 2;
        outlineAppendLog('PROBE: G38.2 X' + _lTarget.toFixed(3) + ' F' + feed +
          ' from X=' + _lStartPos.x.toFixed(3) + ' Y=' + _lStartPos.y.toFixed(3) + ' Z=' + _lStartPos.z.toFixed(3));
        await sendCommand('G90 G38.2 X' + _lTarget.toFixed(3) + ' F' + feed.toFixed(0));
        await sleep(50);
        var lpos = await waitForIdleWithTimeout();
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
        outlineAppendLog('RETRACT: Z to safeTravelZ=' + cfg.safeTravelZ.toFixed(3) + ' at F' + retFeed);
        await smRetractToZ(cfg.safeTravelZ, retFeed);
      }
      done++;
      outlineSetProgress((done / totalOps) * 100);

      outlineCheckStop();
      if (row.hasRight && row.xRight !== null) {
        var approachXR = row.xRight + cfg.approachDist;
        outlineAppendLog('360 Face: edge #' + (n + 1) + ' axis=X dir=-X at X=' + row.xRight.toFixed(3) + ' Y=' + row.y.toFixed(3));
        outlineAppendLog('TRAVEL: approach X=' + approachXR.toFixed(3) + ' Y=' + row.y.toFixed(3) + ' at F' + travelFeed);
        await _outlineAbsTravel(approachXR, row.y, cfg.safeTravelZ, travelFeed, retFeed);
        outlineAppendLog('LOWER: Z to faceZ=' + faceZ.toFixed(3) + ' at F' + retFeed);
        await _outlineMoveToZ(faceZ, retFeed);
        await smEnsureProbeClear(cfg.safeTravelZ, travelFeed);
        var _rStartPos = await getWorkPosition();
        var _rStartX   = Number(_rStartPos.x);
        var _rTarget   = row.xRight - cfg.approachDist * 2;
        outlineAppendLog('PROBE: G38.2 X' + _rTarget.toFixed(3) + ' F' + feed +
          ' from X=' + _rStartPos.x.toFixed(3) + ' Y=' + _rStartPos.y.toFixed(3) + ' Z=' + _rStartPos.z.toFixed(3));
        await sendCommand('G90 G38.2 X' + _rTarget.toFixed(3) + ' F' + feed.toFixed(0));
        await sleep(50);
        var rpos = await waitForIdleWithTimeout();
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
        outlineAppendLog('RETRACT: Z to safeTravelZ=' + cfg.safeTravelZ.toFixed(3) + ' at F' + retFeed);
        await smRetractToZ(cfg.safeTravelZ, retFeed);
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
        await _outlineAbsTravel(col.x, approachYB, cfg.safeTravelZ, travelFeed, retFeed);
        outlineAppendLog('LOWER: Z to faceZ=' + faceZ.toFixed(3) + ' at F' + retFeed);
        await _outlineMoveToZ(faceZ, retFeed);
        await smEnsureProbeClear(cfg.safeTravelZ, travelFeed);
        var _bStartPos = await getWorkPosition();
        var _bStartY   = Number(_bStartPos.y);
        var _bTarget   = col.yBottom + cfg.approachDist * 2;
        outlineAppendLog('PROBE: G38.2 Y' + _bTarget.toFixed(3) + ' F' + feed +
          ' from X=' + _bStartPos.x.toFixed(3) + ' Y=' + _bStartPos.y.toFixed(3) + ' Z=' + _bStartPos.z.toFixed(3));
        await sendCommand('G90 G38.2 Y' + _bTarget.toFixed(3) + ' F' + feed.toFixed(0));
        await sleep(50);
        var bpos = await waitForIdleWithTimeout();
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
        outlineAppendLog('RETRACT: Z to safeTravelZ=' + cfg.safeTravelZ.toFixed(3) + ' at F' + retFeed);
        await smRetractToZ(cfg.safeTravelZ, retFeed);
      }
      done++;
      outlineSetProgress((done / totalOps) * 100);

      outlineCheckStop();
      if (col.hasTop && col.yTop !== null) {
        var approachYT = col.yTop + cfg.approachDist;
        outlineAppendLog('360 Face: edge #' + (n + 1) + ' axis=Y dir=-Y at X=' + col.x.toFixed(3) + ' Y=' + col.yTop.toFixed(3));
        outlineAppendLog('TRAVEL: approach X=' + col.x.toFixed(3) + ' Y=' + approachYT.toFixed(3) + ' at F' + travelFeed);
        await _outlineAbsTravel(col.x, approachYT, cfg.safeTravelZ, travelFeed, retFeed);
        outlineAppendLog('LOWER: Z to faceZ=' + faceZ.toFixed(3) + ' at F' + retFeed);
        await _outlineMoveToZ(faceZ, retFeed);
        await smEnsureProbeClear(cfg.safeTravelZ, travelFeed);
        var _tStartPos = await getWorkPosition();
        var _tStartY   = Number(_tStartPos.y);
        var _tTarget   = col.yTop - cfg.approachDist * 2;
        outlineAppendLog('PROBE: G38.2 Y' + _tTarget.toFixed(3) + ' F' + feed +
          ' from X=' + _tStartPos.x.toFixed(3) + ' Y=' + _tStartPos.y.toFixed(3) + ' Z=' + _tStartPos.z.toFixed(3));
        await sendCommand('G90 G38.2 Y' + _tTarget.toFixed(3) + ' F' + feed.toFixed(0));
        await sleep(50);
        var tpos = await waitForIdleWithTimeout();
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
        outlineAppendLog('RETRACT: Z to safeTravelZ=' + cfg.safeTravelZ.toFixed(3) + ' at F' + retFeed);
        await smRetractToZ(cfg.safeTravelZ, retFeed);
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

// ── Draw outline canvas ───────────────────────────────────
function drawOutlineCanvas() {
  if (window.probeViz && typeof window.probeViz.drawOutlineCanvas === 'function') {
    window.probeViz.drawOutlineCanvas();
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
  lines.push('  <style>circle { fill-opacity:0.8; } path { fill:none; stroke-width:0.5; }</style>');

  // Left edge polyline
  var leftPts = outlineRowResults
    .filter(function(r){ return r.hasLeft && r.xLeft !== null; })
    .sort(function(a,b){ return a.y - b.y; });
  if (leftPts.length > 0) {
    var d = 'M ' + svgX(leftPts[0].xLeft) + ',' + svgY(leftPts[0].y);
    for (var i = 1; i < leftPts.length; i++) {
      d += ' L ' + svgX(leftPts[i].xLeft) + ',' + svgY(leftPts[i].y);
    }
    lines.push('  <path d="' + d + '" stroke="#44cc77" />');
  }

  // Right edge polyline
  var rightPts = outlineRowResults
    .filter(function(r){ return r.hasRight && r.xRight !== null; })
    .sort(function(a,b){ return a.y - b.y; });
  if (rightPts.length > 0) {
    var d2 = 'M ' + svgX(rightPts[0].xRight) + ',' + svgY(rightPts[0].y);
    for (var j = 1; j < rightPts.length; j++) {
      d2 += ' L ' + svgX(rightPts[j].xRight) + ',' + svgY(rightPts[j].y);
    }
    lines.push('  <path d="' + d2 + '" stroke="#ffaa33" />');
  }

  // Closed outline polygon (left edge up, right edge down)
  if (leftPts.length > 0 && rightPts.length > 0) {
    var polyPts = leftPts.map(function(r){ return [r.xLeft, r.y]; });
    var revRight = rightPts.slice().reverse();
    revRight.forEach(function(r){ polyPts.push([r.xRight, r.y]); });
    var dPoly = 'M ' + svgX(polyPts[0][0]) + ',' + svgY(polyPts[0][1]);
    for (var k = 1; k < polyPts.length; k++) {
      dPoly += ' L ' + svgX(polyPts[k][0]) + ',' + svgY(polyPts[k][1]);
    }
    dPoly += ' Z';
    lines.push('  <path d="' + dPoly + '" stroke="#4da6ff" stroke-width="0.8" stroke-dasharray="2,1" />');
  }

  // Bottom / top edge points
  outlineColResults.forEach(function(col) {
    if (col.hasBottom && col.yBottom !== null) {
      lines.push('  <circle cx="' + svgX(col.x) + '" cy="' + svgY(col.yBottom) + '" r="0.8" fill="#4da6ff" />');
    }
    if (col.hasTop && col.yTop !== null) {
      lines.push('  <circle cx="' + svgX(col.x) + '" cy="' + svgY(col.yTop) + '" r="0.8" fill="#e05555" />');
    }
  });

  // Row edge points
  outlineRowResults.forEach(function(row) {
    if (row.hasLeft && row.xLeft !== null) {
      lines.push('  <circle cx="' + svgX(row.xLeft) + '" cy="' + svgY(row.y) + '" r="0.6" fill="#44cc77" />');
    }
    if (row.hasRight && row.xRight !== null) {
      lines.push('  <circle cx="' + svgX(row.xRight) + '" cy="' + svgY(row.y) + '" r="0.6" fill="#ffaa33" />');
    }
  });

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
