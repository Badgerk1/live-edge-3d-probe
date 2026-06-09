import fs from 'node:fs';

var passed = 0;
var failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log('  PASS: ' + message);
    passed++;
  } else {
    console.error('  FAIL: ' + message);
    failed++;
  }
}

function extractFunction(source, name) {
  var start = source.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('Could not find function ' + name);
  var braceStart = source.indexOf('{', start);
  if (braceStart === -1) throw new Error('Could not find function body for ' + name);

  var depth = 0;
  var inSingle = false;
  var inDouble = false;
  var inLineComment = false;
  var inBlockComment = false;

  for (var i = braceStart; i < source.length; i++) {
    var ch = source[i];
    var next = source[i + 1];
    var prev = source[i - 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (prev === '*' && ch === '/') inBlockComment = false;
      continue;
    }
    if (inSingle) {
      if (ch === '\'' && prev !== '\\') inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"' && prev !== '\\') inDouble = false;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '\'') {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }

    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  throw new Error('Unterminated function ' + name);
}

function loadFunction(source, name) {
  var fnSource = extractFunction(source, name);
  return new Function(fnSource + '\nreturn ' + name + ';')();
}

var outlineProbeSource = fs.readFileSync(new URL('../src/js/outline-probe.js', import.meta.url), 'utf8');
var validateSurfaceProbeResult = loadFunction(outlineProbeSource, '_outlineValidateSurfaceProbeResult');
var getZMoveDirection = loadFunction(outlineProbeSource, '_outlineGetZMoveDirection');
var formatWorkPos = loadFunction(outlineProbeSource, '_outlineFormatWorkPos');
var formatMachineState = loadFunction(outlineProbeSource, '_outlineFormatMachineState');
var formatRawControllerState = loadFunction(outlineProbeSource, '_outlineFormatRawControllerState');
var validateCenterTravel = loadFunction(outlineProbeSource, '_outlineValidateCenterTravel');
var buildCenterTravelWarning = new Function('_outlineValidateCenterTravel', '_outlineFormatWorkPos', extractFunction(outlineProbeSource, '_outlineBuildCenterTravelWarning') + '\nreturn _outlineBuildCenterTravelWarning;')(validateCenterTravel, formatWorkPos);

console.log('=== outline-surface-probe-phase1 tests ===');

console.log('\nTest: no-motion + no-trigger probe result fails fast');
var noMotionMiss = validateSurfaceProbeResult({ z: 0 }, { z: 0 }, false, false, 165);
assert(!noMotionMiss.ok, 'no-motion/no-trigger result is rejected');
assert(noMotionMiss.noMotion, 'no-motion flag is set');
assert(!noMotionMiss.fullTravelMiss, 'full-travel miss flag stays false when machine never moved');
assert(/aborting before retract/.test(noMotionMiss.error), 'operator error explains retract is skipped');

console.log('\nTest: full-travel no-contact result still fails');
var fullTravelMiss = validateSurfaceProbeResult({ z: 5 }, { z: -160 }, false, false, 165);
assert(!fullTravelMiss.ok, 'full-travel miss is rejected');
assert(fullTravelMiss.fullTravelMiss, 'full-travel miss flag is set');
assert(/No contact in full Z travel range/.test(fullTravelMiss.error), 'full-travel miss keeps existing no-contact message');

console.log('\nTest: triggered result remains valid');
var triggeredHit = validateSurfaceProbeResult({ z: 10 }, { z: 2.25 }, false, true, 165);
assert(triggeredHit.ok, 'pin-triggered result is accepted');
assert(!triggeredHit.noMotion, 'triggered hit records motion');
assert(triggeredHit.distTraveled > 0, 'triggered hit reports positive travel distance');

console.log('\nTest: retract logging direction is explicit');
assert(getZMoveDirection(0, 2) === 'upward', 'upward retract is labeled upward');
assert(getZMoveDirection(2, 0) === 'downward', 'downward retract is labeled downward');
assert(getZMoveDirection(2, 2) === 'level', 'same-height retract is labeled level');

console.log('\nTest: center travel verification requires target tolerance');
var centered = validateCenterTravel({ x: 304.75, y: 138.20 }, 304.80, 138.11, 0.5);
assert(centered.ok, 'position inside tolerance is accepted as centered');
assert(centered.dx <= 0.5 && centered.dy <= 0.5, 'center deltas are computed from X/Y target');

var offCenter = validateCenterTravel({ x: 300, y: 138.11 }, 304.80, 138.11, 0.5);
assert(!offCenter.ok, 'position outside tolerance is rejected before probe start');
assert(offCenter.dx > 0.5, 'off-center X delta is reported');

console.log('\nTest: center travel mismatch becomes warning-only diagnostic');
var centerWarning = buildCenterTravelWarning({ x: 0, y: 0, z: 0 }, 304.80, 138.11, 0.5);
assert(/WARNING: center travel verification mismatch/.test(centerWarning), 'warning identifies center verification mismatch');
assert(/reported work position may be stale after move/.test(centerWarning), 'warning explains stale position source');
assert(/continuing with probe/.test(centerWarning), 'warning confirms the probe sequence continues');
assert(/target X=304.800 Y=138.110/.test(centerWarning), 'warning keeps explicit center target in the log');

console.log('\nTest: machine state formatter includes alarm reason when present');
var stateWithAlarm = formatMachineState({ status: 'alarm', probeTriggered: false, alarmReason: 'Probe fail' });
assert(/alarm=Probe fail/.test(stateWithAlarm), 'alarm reason is included in machine state log');
assert(/status=alarm/.test(stateWithAlarm), 'status field is present in machine state log');

var stateNoAlarm = formatMachineState({ status: 'idle', probeTriggered: true });
assert(!/alarm=/.test(stateNoAlarm), 'alarm= field is absent when there is no alarm reason');
assert(/probe=true/.test(stateNoAlarm), 'probe triggered flag is included in state log');

console.log('\nTest: raw controller state formatter surfaces alarm message');
var rawWithAlarm = formatRawControllerState({ status: 'Alarm', alarmMessage: 'Alarm:5 Probe fail', WPos: '0,0,0', MPos: null, WCO: null, Pn: '' });
assert(/rawAlarm=Alarm:5 Probe fail/.test(rawWithAlarm), 'raw alarm message is surfaced in controller state log');
assert(/rawStatus=Alarm/.test(rawWithAlarm), 'raw status is included in controller state log');

var rawNoAlarm = formatRawControllerState({ status: 'Idle', WPos: '10,20,5', MPos: null, WCO: null, Pn: 'P' });
assert(!/rawAlarm=/.test(rawNoAlarm), 'rawAlarm= field is absent when there is no alarm message');
assert(/rawWPos=10,20,5/.test(rawNoAlarm), 'raw WPos is surfaced in controller state log');

console.log('\nTest: no-motion result (alarm-like symptom) yields non-generic error distinguishable from full-travel miss');
var alarmLikeNoMotion = validateSurfaceProbeResult({ z: 5 }, { z: 5 }, false, false, 165);
assert(!alarmLikeNoMotion.ok, 'no-motion alarm-like result is rejected');
assert(alarmLikeNoMotion.noMotion, 'no-motion flag set for alarm-like case');
assert(!alarmLikeNoMotion.fullTravelMiss, 'full-travel miss flag clear when machine did not move at all');
assert(/no Z motion/.test(alarmLikeNoMotion.error) || /no probe trigger/.test(alarmLikeNoMotion.error),
  'error message distinguishes no-motion from full-travel miss');

console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---');
process.exit(failed > 0 ? 1 : 0);
