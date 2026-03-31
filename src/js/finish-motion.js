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
  var finishZ             = Number(s.finishHomeZ);
  var useMachineRetract   = !!s.useMachineHomeRetract;
  var machineSafeTopZ     = Number(s.machineSafeTopZ);
  var returnXYZero        = !!s.returnToXYZero;
  var feed                = s.faceRetractFeed || s.travelFeedRate || 600;

  // Guard: if finishHomeZ is 0 or not a valid number, use a safe fallback and warn.
  if (!isFinite(finishZ) || finishZ === 0) {
    logLine(mode, 'Finish: WARNING — finishHomeZ is ' + finishZ + ' (unset or zero); using safe fallback of 10.0mm work Z.');
    finishZ = 10.0;
  }

  // Guard: if machine-home retract is enabled but machineSafeTopZ is 0 (default/unset),
  // the machine would retract to the absolute top of travel which is usually not intended.
  // Disable machine-home retract and fall back to work Z retract using finishHomeZ.
  if (useMachineRetract && (!isFinite(machineSafeTopZ) || machineSafeTopZ === 0)) {
    logLine(mode, 'Finish: WARNING — machineSafeTopZ is ' + machineSafeTopZ + ' (unset or zero); disabling machine-home Z retract and falling back to work Z ' + finishZ.toFixed(3) + '. Set machineSafeTopZ to a non-zero machine coordinate in Setup.');
    useMachineRetract = false;
  }

  var pos        = await getWorkPosition();
  var currentZ   = Number(pos.z);
  var safeTravelZ = isFinite(currentZ) ? Math.max(currentZ, finishZ) : finishZ;

  var state  = await _getState();
  var ms     = _machineStateFrom(state);
  var homed  = _detectHomed(ms, state);

  if (useMachineRetract) {
    if (homed === true) {
      var mPos = _parsePos(ms.MPos);
      var wco  = _parsePos(ms.WCO);
      var currentMachineZ = null;
      if (mPos) {
        currentMachineZ = mPos.z;
      } else if (wco && isFinite(currentZ)) {
        currentMachineZ = currentZ + wco.z;
      }
      if (currentMachineZ !== null && machineSafeTopZ <= currentMachineZ) {
        logLine(mode, 'Finish: machine Z ' + currentMachineZ.toFixed(3) + ' is already at or above safe target ' + machineSafeTopZ.toFixed(3) + '; skipping G53 retract');
      } else {
        logLine(mode, 'Finish: retracting to machine safe Z ' + machineSafeTopZ.toFixed(3));
        try {
          await moveMachineZAbs(machineSafeTopZ, feed);
        } catch(retractErr) {
          logLine(mode, 'Finish: G53 retract error (' + retractErr.message + '); continuing with return');
        }
        var retractPos = await getWorkPosition();
        logLine(mode, 'Finish: after retract X=' + retractPos.x.toFixed(3) + ' Y=' + retractPos.y.toFixed(3) + ' Z=' + retractPos.z.toFixed(3));
      }
    } else {
      logLine(mode, 'Finish: machine-home retract enabled but homed state unavailable; falling back to work Z ' + safeTravelZ.toFixed(3));
      if (isFinite(currentZ) && finishZ <= currentZ) {
        logLine(mode, 'Finish: current work Z ' + currentZ.toFixed(3) + ' is already above fallback target ' + finishZ.toFixed(3) + '; keeping current Z');
      } else {
        logLine(mode, 'Finish: raising Z to fallback ' + safeTravelZ.toFixed(3));
        await moveAbs(null, null, safeTravelZ, feed);
        var retractPos = await getWorkPosition();
        logLine(mode, 'Finish: after retract X=' + retractPos.x.toFixed(3) + ' Y=' + retractPos.y.toFixed(3) + ' Z=' + retractPos.z.toFixed(3));
      }
    }
  } else {
    if (isFinite(currentZ) && finishZ <= currentZ) {
      logLine(mode, 'Finish: current work Z ' + currentZ.toFixed(3) + ' is already above target ' + finishZ.toFixed(3) + '; keeping current Z');
    } else {
      logLine(mode, 'Finish: raising Z to ' + safeTravelZ.toFixed(3));
      await moveAbs(null, null, safeTravelZ, feed);
      var retractPos = await getWorkPosition();
      logLine(mode, 'Finish: after retract X=' + retractPos.x.toFixed(3) + ' Y=' + retractPos.y.toFixed(3) + ' Z=' + retractPos.z.toFixed(3));
    }
  }

  if (returnXYZero) {
    logLine(mode, 'Finish: returning to X0.000 Y0.000');
    await moveAbs(0, 0, null, feed);
    var returnPos = await getWorkPosition();
    logLine(mode, 'Finish: after return X=' + returnPos.x.toFixed(3) + ' Y=' + returnPos.y.toFixed(3) + ' Z=' + returnPos.z.toFixed(3));
  } else {
    logLine(mode, 'Finish: X/Y return to home disabled');
  }

  pluginDebug('finishRunMotion EXIT: mode=' + mode);
}
