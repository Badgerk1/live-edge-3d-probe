// ── finishRunMotion: post-probe retract and home for all run modes ─────────────
//
// Called after every probe run (face, top, etc.) to:
//   1. Raise Z to a safe travel height
//   2. Optionally return X/Y to the origin (X0 Y0)
//
// Parameters:
//   mode  – string key used for logLine ('face', 'top', etc.)
//
async function finishRunMotion(mode) {
  pluginDebug('finishRunMotion ENTER: mode=' + mode);
  var s = getSettingsFromUI();
  var finishZ      = Number(s.finishHomeZ);
  var returnXYZero = !!s.returnToXYZero;
  var feed         = s.faceRetractFeed || s.travelFeedRate || 600;

  // Guard: if finishHomeZ is 0 or not a valid number, use a safe fallback and warn.
  if (!isFinite(finishZ) || finishZ === 0) {
    logLine(mode, 'Finish: WARNING — finishHomeZ is ' + finishZ + ' (unset or zero); using safe fallback of 10.0mm work Z.');
    finishZ = 10.0;
  }

  var pos      = await getWorkPosition();
  var currentZ = Number(pos.z);

  // Z retract — always use work coordinates (G0 Z{finishZ}), never G53 machine coords.
  // Only move if finishZ is actually higher than the current position.
  var zRetractOk = false;
  if (isFinite(currentZ) && finishZ <= currentZ) {
    logLine(mode, 'Finish: current work Z ' + currentZ.toFixed(3) + ' is already at or above target work Z ' + finishZ.toFixed(3) + '; no Z retract needed');
    zRetractOk = true;
  } else {
    logLine(mode, 'Finish: retracting to work Z ' + finishZ.toFixed(3));
    await moveAbs(null, null, finishZ, feed);
    var retractPos = await getWorkPosition();
    logLine(mode, 'Finish: after retract X=' + retractPos.x.toFixed(3) + ' Y=' + retractPos.y.toFixed(3) + ' Z=' + retractPos.z.toFixed(3));
    if (Number(retractPos.z) >= finishZ - 0.5) {
      zRetractOk = true;
    } else {
      logLine(mode, 'Finish: ERROR — Z retract did not reach target (got Z=' + Number(retractPos.z).toFixed(3) + ', expected >= ' + (finishZ - 0.5).toFixed(3) + '); aborting XY return to prevent collision');
    }
  }

  if (returnXYZero) {
    if (!zRetractOk) {
      logLine(mode, 'Finish: skipping X/Y return — Z retract did not succeed');
    } else {
      logLine(mode, 'Finish: returning to X0.000 Y0.000');
      await moveAbs(0, 0, null, feed);
      var returnPos = await getWorkPosition();
      logLine(mode, 'Finish: after return X=' + returnPos.x.toFixed(3) + ' Y=' + returnPos.y.toFixed(3) + ' Z=' + returnPos.z.toFixed(3));
    }
  } else {
    logLine(mode, 'Finish: X/Y return to home disabled');
  }

  pluginDebug('finishRunMotion EXIT: mode=' + mode);
}
