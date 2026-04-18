// ─────────────────────────────────────────────────────────
//  outline-probe.js  –  360 outline capture
//  Ported from Badgerk1/Live-Edge-Outline-Surface.
//  Uses this repo's existing sm* motion primitives instead of probeEngine.
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

// ── Read outline settings ─────────────────────────────────
function _outlineSettings() {
  return {
    x0:          (Number((document.getElementById('outlineX0')          || {}).value) || 0),
    xLen:        (Number((document.getElementById('outlineXLen')        || {}).value) || 100),
    y0:          (Number((document.getElementById('outlineY0')          || {}).value) || 0),
    yLen:        (Number((document.getElementById('outlineYLen')        || {}).value) || 100),
    yStep:       (Number((document.getElementById('outlineYStep')       || {}).value) || 5),
    xStep:       (Number((document.getElementById('outlineXStep')       || {}).value) || 5),
    clearZ:      (Number((document.getElementById('outlineClearZ')      || {}).value) || 5),
    probeDown:   (Number((document.getElementById('outlineProbeDown')   || {}).value) || 5),
    probeFeed:   (Number((document.getElementById('outlineProbeFeed')   || {}).value) || 200),
    fastFeed:    (Number((document.getElementById('outlineFastFeed')    || {}).value) || 800),
    retractFeed: (Number((document.getElementById('outlineRetractFeed') || {}).value) || 600)
  };
}

// ── Center surface probe ──────────────────────────────────
async function _outlineCenterSurfProbe(cfg) {
  var cx = cfg.x0 + cfg.xLen / 2;
  var cy = cfg.y0 + cfg.yLen / 2;
  outlineAppendLog('Center surface probe at X' + cx.toFixed(3) + ' Y' + cy.toFixed(3));
  await smSafeLateralMove(cx, cy, cfg.fastFeed, cfg.clearZ + 5);
  await smRetractToZ(cfg.clearZ, cfg.fastFeed);
  var pos = await smPlungeProbe(cfg.probeDown + 5, cfg.probeFeed);
  var surfZ = pos.z;
  outlineAppendLog('Surface Z established: ' + surfZ.toFixed(4));
  await smRetractUp(cfg.clearZ, cfg.retractFeed);
  return surfZ;
}

// ── Horizontal edge-find probe ────────────────────────────
async function _probeHorizEdge(axis, targetCoord, feed) {
  await sendCommand('G90 G38.2 ' + axis + targetCoord.toFixed(4) + ' F' + feed.toFixed(0));
  await sleep(50);
  await waitForIdleWithTimeout(30000);
  return await getWorkPosition();
}

// ── Surface-probe step for off-part detection ─────────────
async function _surfStepProbe(probeDown, probeFeed) {
  var startPos = await getWorkPosition();
  var startZ = startPos.z;
  await sendCommand('G91 G38.3 Z-' + Math.abs(probeDown).toFixed(4) + ' F' + probeFeed.toFixed(0));
  await sleep(50);
  await waitForIdleWithTimeout(10000);
  var pos = await getWorkPosition();
  var distanceTraveled = startZ - pos.z;
  var stoppedShort = distanceTraveled < (probeDown - 0.5);
  var triggered = pos.probeTriggered || stoppedShort;
  return { triggered: triggered, z: pos.z, x: pos.x, y: pos.y };
}

// ── Row scan (X scanlines at fixed Y) ─────────────────────
async function _runRowScan(cfg, clearZ) {
  var totalRows = Math.ceil(cfg.yLen / cfg.yStep) + 1;
  var rowIdx = 0;

  for (var y = cfg.y0; y <= cfg.y0 + cfg.yLen + 1e-9; y += cfg.yStep) {
    outlineCheckStop();
    var rowY = parseFloat(y.toFixed(6));
    rowIdx++;
    outlineAppendLog('Row scan Y=' + rowY.toFixed(3) + ' (' + rowIdx + '/' + totalRows + ')');

    // Move to left edge of search area at clearZ
    await smSafeLateralMove(cfg.x0, rowY, cfg.fastFeed, clearZ);
    await smRetractToZ(clearZ, cfg.fastFeed);

    // Probe +X to find left edge contact
    var probeZ = clearZ - 1;
    await smRetractToZ(probeZ, cfg.fastFeed);
    var edgePos = await _probeHorizEdge('X', cfg.x0 + cfg.xLen, cfg.probeFeed);

    if (!edgePos.probeTriggered) {
      outlineAppendLog('  No left edge found \u2013 empty row');
      outlineRowResults.push({ y: rowY, xLeft: null, xRight: null, hasLeft: false, hasRight: false });
      await smRetractToZ(clearZ, cfg.fastFeed);
      continue;
    }

    var xLeft = edgePos.x;
    outlineAppendLog('  Left edge X=' + xLeft.toFixed(3));

    // Retract and approach from inside to find right edge via off-part detection
    await smRetractToZ(clearZ, cfg.fastFeed);

    var scanStartX = Math.min(xLeft + 5, cfg.x0 + cfg.xLen - 1);
    await smSafeLateralMove(scanStartX, rowY, cfg.fastFeed, clearZ);

    var xRight = null;
    var missCount = 0;
    var scanX = scanStartX;
    var scanStep = Math.max(1, cfg.xStep / 2);
    var lastHitX = scanStartX;

    while (scanX <= cfg.x0 + cfg.xLen + 1e-9) {
      outlineCheckStop();
      await smRetractToZ(clearZ, cfg.fastFeed);
      await smSafeLateralMove(scanX, rowY, cfg.fastFeed, clearZ);
      await smRetractToZ(probeZ, cfg.fastFeed);

      var stepResult = await _surfStepProbe(cfg.probeDown, cfg.probeFeed);

      await smRetractToZ(clearZ, cfg.fastFeed);

      if (stepResult.triggered) {
        missCount = 0;
        lastHitX  = scanX;
      } else {
        missCount++;
        if (missCount >= 2) {
          xRight = lastHitX + scanStep;
          outlineAppendLog('  Right edge X\u2248' + xRight.toFixed(3));
          break;
        }
      }
      scanX += scanStep;
    }

    if (xRight === null) {
      xRight = cfg.x0 + cfg.xLen;
      outlineAppendLog('  Right edge at boundary X=' + xRight.toFixed(3));
    }

    // Probe back -X from xRight to confirm exact right edge
    await smSafeLateralMove(Math.min(xRight + 5, cfg.x0 + cfg.xLen), rowY, cfg.fastFeed, clearZ);
    await smRetractToZ(probeZ, cfg.fastFeed);
    var rightEdgePos = await _probeHorizEdge('X', xLeft - 1, cfg.probeFeed);
    if (rightEdgePos.probeTriggered) {
      xRight = rightEdgePos.x;
      outlineAppendLog('  Right edge confirmed X=' + xRight.toFixed(3));
    }

    outlineRowResults.push({ y: rowY, xLeft: xLeft, xRight: xRight, hasLeft: true, hasRight: true });
    await smRetractToZ(clearZ, cfg.fastFeed);
    await smSafeLateralMove(cfg.x0, rowY, cfg.fastFeed, clearZ);

    outlineSetProgress(((rowIdx / totalRows) * 50));
  }
}

// ── Column scan (Y scanlines at fixed X) ──────────────────
async function _runColScan(cfg, clearZ) {
  var totalCols = Math.ceil(cfg.xLen / cfg.xStep) + 1;
  var colIdx = 0;

  for (var x = cfg.x0; x <= cfg.x0 + cfg.xLen + 1e-9; x += cfg.xStep) {
    outlineCheckStop();
    var colX = parseFloat(x.toFixed(6));
    colIdx++;
    outlineAppendLog('Col scan X=' + colX.toFixed(3) + ' (' + colIdx + '/' + totalCols + ')');

    // Move to bottom of search area
    await smSafeLateralMove(colX, cfg.y0, cfg.fastFeed, clearZ);
    var probeZ = clearZ - 1;
    await smRetractToZ(probeZ, cfg.fastFeed);

    // Probe +Y to find bottom edge
    var edgePos = await _probeHorizEdge('Y', cfg.y0 + cfg.yLen, cfg.probeFeed);

    if (!edgePos.probeTriggered) {
      outlineAppendLog('  No bottom edge \u2013 empty col');
      outlineColResults.push({ x: colX, yBottom: null, yTop: null, hasBottom: false, hasTop: false });
      await smRetractToZ(clearZ, cfg.fastFeed);
      continue;
    }

    var yBottom = edgePos.y;
    outlineAppendLog('  Bottom edge Y=' + yBottom.toFixed(3));

    // Retract and scan from inside to find top edge
    await smRetractToZ(clearZ, cfg.fastFeed);
    var scanStartY = Math.min(yBottom + 5, cfg.y0 + cfg.yLen - 1);
    await smSafeLateralMove(colX, scanStartY, cfg.fastFeed, clearZ);

    var yTop = null;
    var missCount = 0;
    var scanY = scanStartY;
    var scanStep = Math.max(1, cfg.yStep / 2);
    var lastHitY = scanStartY;

    while (scanY <= cfg.y0 + cfg.yLen + 1e-9) {
      outlineCheckStop();
      await smRetractToZ(clearZ, cfg.fastFeed);
      await smSafeLateralMove(colX, scanY, cfg.fastFeed, clearZ);
      await smRetractToZ(probeZ, cfg.fastFeed);

      var stepResult = await _surfStepProbe(cfg.probeDown, cfg.probeFeed);
      await smRetractToZ(clearZ, cfg.fastFeed);

      if (stepResult.triggered) {
        missCount = 0;
        lastHitY  = scanY;
      } else {
        missCount++;
        if (missCount >= 2) {
          yTop = lastHitY + scanStep;
          outlineAppendLog('  Top edge Y\u2248' + yTop.toFixed(3));
          break;
        }
      }
      scanY += scanStep;
    }

    if (yTop === null) {
      yTop = cfg.y0 + cfg.yLen;
      outlineAppendLog('  Top edge at boundary Y=' + yTop.toFixed(3));
    }

    // Confirm top edge by probing back -Y
    await smSafeLateralMove(colX, Math.min(yTop + 5, cfg.y0 + cfg.yLen), cfg.fastFeed, clearZ);
    await smRetractToZ(probeZ, cfg.fastFeed);
    var topEdgePos = await _probeHorizEdge('Y', yBottom - 1, cfg.probeFeed);
    if (topEdgePos.probeTriggered) {
      yTop = topEdgePos.y;
      outlineAppendLog('  Top edge confirmed Y=' + yTop.toFixed(3));
    }

    outlineColResults.push({ x: colX, yBottom: yBottom, yTop: yTop, hasBottom: true, hasTop: true });
    await smRetractToZ(clearZ, cfg.fastFeed);
    await smSafeLateralMove(colX, cfg.y0, cfg.fastFeed, clearZ);

    outlineSetProgress(50 + ((colIdx / totalCols) * 50));
  }
}

// ── Main outline scan ─────────────────────────────────────
async function runOutlineScan() {
  if (_outlineRunning) { outlineAppendLog('Already running.'); return; }
  _outlineRunning  = true;
  _outlineStopFlag = false;
  _stopRequested   = false;
  _running         = true;
  outlineRowResults = [];
  outlineColResults = [];
  outlineSurfaceZ   = null;

  clearLog('outline');
  outlineSetProgress(0);
  outlineSetStatus('Running\u2026', '');
  setFooterStatus('Outline scan running\u2026', '');

  try {
    var cfg = _outlineSettings();
    if (cfg.xLen <= 0 || cfg.yLen <= 0) throw new Error('Outline bounds invalid (XLen/YLen must be > 0)');
    if (cfg.yStep <= 0) cfg.yStep = 5;
    if (cfg.xStep <= 0) cfg.xStep = 5;

    outlineAppendLog('Outline scan start. Bounds: X' + cfg.x0.toFixed(2) + '+' + cfg.xLen.toFixed(2) +
                     '  Y' + cfg.y0.toFixed(2) + '+' + cfg.yLen.toFixed(2));

    await requireStartupHomingPreflight('Outline Scan');

    // Center surface probe
    outlineSurfaceZ = await _outlineCenterSurfProbe(cfg);
    var clearZ = outlineSurfaceZ + cfg.clearZ;
    outlineAppendLog('Working clearZ: ' + clearZ.toFixed(3));

    // Row scan
    outlineAppendLog('\u2500\u2500 Starting row scans (X scanlines) \u2500\u2500');
    await _runRowScan(cfg, clearZ);

    // Column scan
    outlineAppendLog('\u2500\u2500 Starting column scans (Y scanlines) \u2500\u2500');
    await _runColScan(cfg, clearZ);

    // Return home
    outlineCheckStop();
    await smRetractToZ(clearZ + 5, cfg.fastFeed);
    await smSafeLateralMove(cfg.x0, cfg.y0, cfg.fastFeed, clearZ + 5);

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
    // Safety retract after any error or stop
    try {
      var safeZ = (Number((document.getElementById('outlineClearZ') || {}).value) || 5) + 5;
      var safeFeed = Number((document.getElementById('outlineFastFeed') || {}).value) || 800;
      await smRetractToZ(safeZ, safeFeed);
    } catch(re) { pluginDebug('Safety retract failed: ' + re.message); }
  } finally {
    _outlineRunning  = false;
    _outlineStopFlag = false;
    _running         = false;
  }
}

// ── 360 face probe from outline results ───────────────────
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

    var cfg        = _outlineSettings();
    var clearZ     = outlineSurfaceZ + cfg.clearZ;
    var feed       = Number((document.getElementById('faceFeed')        || {}).value) || 200;
    var retFeed    = Number((document.getElementById('faceRetractFeed') || {}).value) || 600;
    var travelFeed = Number((document.getElementById('travelFeedRate')  || {}).value) || 1000;
    var retractD   = Number((document.getElementById('retractDist')     || {}).value) || 2;
    var n          = 0;
    var totalOps   = outlineRowResults.length * 2 + outlineColResults.length * 2;
    var done       = 0;

    // ── Probe left and right X edges from row results ──────────
    for (var ri = 0; ri < outlineRowResults.length; ri++) {
      var row = outlineRowResults[ri];
      outlineCheckStop();

      if (row.hasLeft && row.xLeft !== null) {
        var approachX = row.xLeft - 10;
        await smSafeLateralMove(approachX, row.y, travelFeed, clearZ);
        await smRetractToZ(clearZ - 1, travelFeed);
        // Inline G38.2 probe — equivalent to probeEngine.probeAxis('X', row.xLeft + 20, feed)
        await smEnsureProbeClear(clearZ, travelFeed);
        var _lStartPos = await getWorkPosition();
        var _lStartX   = Number(_lStartPos.x);
        await sendCommand('G90 G38.2 X' + (row.xLeft + 20).toFixed(3) + ' F' + feed.toFixed(0));
        await sleep(50);
        var lpos = await waitForIdleWithTimeout();
        if (!lpos) lpos = await getWorkPosition();
        var _lEndX = Number(lpos.x);
        var _lDist = Math.abs(row.xLeft + 20 - _lStartX);
        var _lTrav = Math.abs(_lEndX - _lStartX);
        if (!lpos.probeTriggered && _lDist > 0.5 && _lTrav < (_lDist - 0.5)) {
          lpos = Object.assign({}, lpos, { probeTriggered: true });
        }
        if (lpos.probeTriggered) {
          n++;
          faceResults.push(makeFaceContactRecord(n, lpos, 'X', 'triggered', row.xLeft, row.y));
          outlineAppendLog('Left edge contact at X=' + lpos.x.toFixed(3) + ' Y=' + row.y.toFixed(3));
        }
        await smRetractToZ(clearZ, travelFeed);
      }
      done++;
      outlineSetProgress((done / totalOps) * 100);

      outlineCheckStop();
      if (row.hasRight && row.xRight !== null) {
        var approachXR = row.xRight + 10;
        if (approachXR <= cfg.x0 + cfg.xLen + 5) {
          await smSafeLateralMove(approachXR, row.y, travelFeed, clearZ);
          await smRetractToZ(clearZ - 1, travelFeed);
          await smEnsureProbeClear(clearZ, travelFeed);
          var _rStartPos = await getWorkPosition();
          var _rStartX   = Number(_rStartPos.x);
          await sendCommand('G90 G38.2 X' + (row.xRight - 20).toFixed(3) + ' F' + feed.toFixed(0));
          await sleep(50);
          var rpos = await waitForIdleWithTimeout();
          if (!rpos) rpos = await getWorkPosition();
          var _rEndX = Number(rpos.x);
          var _rDist = Math.abs(row.xRight - 20 - _rStartX);
          var _rTrav = Math.abs(_rEndX - _rStartX);
          if (!rpos.probeTriggered && _rDist > 0.5 && _rTrav < (_rDist - 0.5)) {
            rpos = Object.assign({}, rpos, { probeTriggered: true });
          }
          if (rpos.probeTriggered) {
            n++;
            faceResults.push(makeFaceContactRecord(n, rpos, 'X', 'triggered', row.xRight, row.y));
            outlineAppendLog('Right edge contact at X=' + rpos.x.toFixed(3) + ' Y=' + row.y.toFixed(3));
          }
          await smRetractToZ(clearZ, travelFeed);
        }
      }
      done++;
      outlineSetProgress((done / totalOps) * 100);
    }

    // ── Probe bottom and top Y edges from col results ──────────
    for (var ci = 0; ci < outlineColResults.length; ci++) {
      var col = outlineColResults[ci];
      outlineCheckStop();

      if (col.hasBottom && col.yBottom !== null) {
        var approachYB = col.yBottom - 10;
        await smSafeLateralMove(col.x, approachYB, travelFeed, clearZ);
        await smRetractToZ(clearZ - 1, travelFeed);
        await smEnsureProbeClear(clearZ, travelFeed);
        var _bStartPos = await getWorkPosition();
        var _bStartY   = Number(_bStartPos.y);
        await sendCommand('G90 G38.2 Y' + (col.yBottom + 20).toFixed(3) + ' F' + feed.toFixed(0));
        await sleep(50);
        var bpos = await waitForIdleWithTimeout();
        if (!bpos) bpos = await getWorkPosition();
        var _bEndY = Number(bpos.y);
        var _bDist = Math.abs(col.yBottom + 20 - _bStartY);
        var _bTrav = Math.abs(_bEndY - _bStartY);
        if (!bpos.probeTriggered && _bDist > 0.5 && _bTrav < (_bDist - 0.5)) {
          bpos = Object.assign({}, bpos, { probeTriggered: true });
        }
        if (bpos.probeTriggered) {
          n++;
          faceResults.push(makeFaceContactRecord(n, bpos, 'Y', 'triggered', col.yBottom, col.x));
          outlineAppendLog('Bottom edge contact at X=' + col.x.toFixed(3) + ' Y=' + bpos.y.toFixed(3));
        }
        await smRetractToZ(clearZ, travelFeed);
      }
      done++;
      outlineSetProgress((done / totalOps) * 100);

      outlineCheckStop();
      if (col.hasTop && col.yTop !== null) {
        var approachYT = col.yTop + 10;
        if (approachYT <= cfg.y0 + cfg.yLen + 5) {
          await smSafeLateralMove(col.x, approachYT, travelFeed, clearZ);
          await smRetractToZ(clearZ - 1, travelFeed);
          await smEnsureProbeClear(clearZ, travelFeed);
          var _tStartPos = await getWorkPosition();
          var _tStartY   = Number(_tStartPos.y);
          await sendCommand('G90 G38.2 Y' + (col.yTop - 20).toFixed(3) + ' F' + feed.toFixed(0));
          await sleep(50);
          var tpos = await waitForIdleWithTimeout();
          if (!tpos) tpos = await getWorkPosition();
          var _tEndY = Number(tpos.y);
          var _tDist = Math.abs(col.yTop - 20 - _tStartY);
          var _tTrav = Math.abs(_tEndY - _tStartY);
          if (!tpos.probeTriggered && _tDist > 0.5 && _tTrav < (_tDist - 0.5)) {
            tpos = Object.assign({}, tpos, { probeTriggered: true });
          }
          if (tpos.probeTriggered) {
            n++;
            faceResults.push(makeFaceContactRecord(n, tpos, 'Y', 'triggered', col.yTop, col.x));
            outlineAppendLog('Top edge contact at X=' + col.x.toFixed(3) + ' Y=' + tpos.y.toFixed(3));
          }
          await smRetractToZ(clearZ, travelFeed);
        }
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
