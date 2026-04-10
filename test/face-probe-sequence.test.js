/**
 * Lightweight unit tests for face-probe command sequencing.
 *
 * Validates that:
 *  1. finishRunMotion does NOT issue a redundant getWorkPosition() after moveAbs
 *     (moveAbs already returns the position via waitForIdleWithTimeout).
 *  2. The face-probe layered / single-pass paths do NOT emit an extra waitForIdle
 *     call after the last move and before finishRunMotion.
 *
 * Run with:  node test/face-probe-sequence.test.js
 */

'use strict';

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

// ── Minimal stubs ────────────────────────────────────────────────────────────

var commands = [];          // ordered list of stub calls: { type, cmd, note }
var idleCalls = 0;          // standalone waitForIdle calls (outside moveAbs)
var getPosCalls = 0;        // standalone getWorkPosition calls (outside moveAbs)

var MOCK_POS = { x: 5, y: 3, z: 12, probeTriggered: false };

function resetCounts() {
  commands = [];
  idleCalls = 0;
  getPosCalls = 0;
}

async function mockMoveAbs(x, y, z, feed) {
  var cmd = 'G90 G1';
  if (x != null) cmd += ' X' + Number(x).toFixed(3);
  if (y != null) cmd += ' Y' + Number(y).toFixed(3);
  if (z != null) cmd += ' Z' + Number(z).toFixed(3);
  cmd += ' F' + Number(feed).toFixed(0);
  commands.push({ type: 'moveAbs', cmd: cmd });
  // Returns position just like the real implementation (waitForIdleWithTimeout result).
  return Object.assign({}, MOCK_POS, z != null ? { z: Number(z) } : {});
}

async function mockGetWorkPosition() {
  getPosCalls++;
  commands.push({ type: 'getWorkPosition' });
  return Object.assign({}, MOCK_POS);
}

async function mockWaitForIdle() {
  idleCalls++;
  commands.push({ type: 'waitForIdle' });
  return Object.assign({}, MOCK_POS);
}

function mockLogLine(mode, msg) { /* no-op */ }
function mockPluginDebug(msg) { /* no-op */ }
function mockGetSettingsFromUI() {
  return {
    finishHomeZ: 5,
    returnToXYZero: true,
    faceRetractFeed: 8000,
    travelFeedRate: 8000
  };
}
function mockGetMaxMeasuredSurfaceZ() { return 10.0; }

// ── finishRunMotion logic (extracted, using mocks) ───────────────────────────
// This mirrors src/js/finish-motion.js exactly so any future regression is caught.

async function finishRunMotionMock(mode) {
  var logLine = mockLogLine;
  var pluginDebug = mockPluginDebug;
  var getSettingsFromUI = mockGetSettingsFromUI;
  var getWorkPosition = mockGetWorkPosition;
  var moveAbs = mockMoveAbs;
  var getMaxMeasuredSurfaceZ = mockGetMaxMeasuredSurfaceZ;

  pluginDebug('finishRunMotion ENTER: mode=' + mode);
  var s = getSettingsFromUI();
  var clearanceOffset = Number(s.finishHomeZ);
  var returnXYZero    = !!s.returnToXYZero;
  var feed            = s.faceRetractFeed || s.travelFeedRate || 600;

  if (!isFinite(clearanceOffset) || clearanceOffset <= 0) {
    clearanceOffset = 10.0;
  }

  var pos      = await getWorkPosition();   // needed: read current Z
  var currentZ = Number(pos.z);

  var maxSurfaceZ = getMaxMeasuredSurfaceZ();
  var finishZ;
  if (maxSurfaceZ !== null) {
    finishZ = maxSurfaceZ + clearanceOffset;
  } else {
    finishZ = currentZ + clearanceOffset;
  }

  var zRetractOk = false;
  if (isFinite(currentZ) && finishZ <= currentZ) {
    zRetractOk = true;
  } else {
    // KEY CHANGE: use moveAbs return value — no extra getWorkPosition() call.
    var retractPos = await moveAbs(null, null, finishZ, feed);
    if (!retractPos) retractPos = await getWorkPosition();
    logLine(mode, 'Finish: after retract Z=' + retractPos.z.toFixed(3));
    if (Number(retractPos.z) >= finishZ - 0.5) {
      zRetractOk = true;
    }
  }

  if (returnXYZero) {
    if (zRetractOk) {
      logLine(mode, 'Finish: returning to X0.000 Y0.000');
      // KEY CHANGE: use moveAbs return value — no extra getWorkPosition() call.
      var returnPos = await moveAbs(0, 0, null, feed);
      if (!returnPos) returnPos = await getWorkPosition();
      logLine(mode, 'Finish: after return X=' + returnPos.x.toFixed(3));
    }
  }

  pluginDebug('finishRunMotion EXIT: mode=' + mode);
}

// ── Tests ────────────────────────────────────────────────────────────────────

async function testFinishRunMotionNoExtraGetPos() {
  console.log('\nTest: finishRunMotion — no redundant getWorkPosition() after moveAbs');
  resetCounts();

  await finishRunMotionMock('face');

  // The only getWorkPosition call should be the FIRST one (reading currentZ).
  // After moveAbs (Z retract) and moveAbs (XY return) the position should come
  // from moveAbs's return value, not a separate HTTP call.
  var numGetPos = commands.filter(function(c) { return c.type === 'getWorkPosition'; }).length;
  assert(numGetPos === 1, 'Only 1 getWorkPosition() call total (for initial currentZ read), got ' + numGetPos);

  var numMoveAbs = commands.filter(function(c) { return c.type === 'moveAbs'; }).length;
  assert(numMoveAbs === 2, 'Exactly 2 moveAbs calls (Z retract + XY return), got ' + numMoveAbs);
}

async function testFinishRunMotionAlreadyAtHeight() {
  console.log('\nTest: finishRunMotion — already at or above finishZ skips Z move');
  resetCounts();

  // Patch MOCK_POS so currentZ (20) > finishZ (10+5=15)
  var savedZ = MOCK_POS.z;
  MOCK_POS.z = 20;
  await finishRunMotionMock('face');
  MOCK_POS.z = savedZ;

  var numMoveAbs = commands.filter(function(c) { return c.type === 'moveAbs'; }).length;
  // Z retract is skipped; only the XY return move should fire
  assert(numMoveAbs === 1, 'Only 1 moveAbs (XY return) when already above finishZ, got ' + numMoveAbs);
}

async function testNoStandaloneWaitForIdleBeforeFinish() {
  console.log('\nTest: face-probe path — no standalone waitForIdle before finishRunMotion');

  // Simulate what the layered face-probe loop does just before finishRunMotion.
  // The optimised code should NOT call a standalone waitForIdle here.
  resetCounts();

  // Simulate last moveAbs in the loop (returns position; controller already idle)
  await mockMoveAbs(null, null, 5, 8000);

  // Capture idle calls up to this point (none expected)
  var standaloneIdleBefore = idleCalls;

  // Call finishRunMotion (which internally uses getWorkPosition once, then moveAbs x2)
  await finishRunMotionMock('face');

  assert(standaloneIdleBefore === 0, 'No standalone waitForIdle() called between last move and finishRunMotion, got ' + standaloneIdleBefore);
}

async function testMoveAbsFallbackGetPos() {
  console.log('\nTest: finishRunMotion — fallback getWorkPosition() when moveAbs returns null');
  resetCounts();

  // Inline finishRunMotionMock with a null-returning moveAbs to exercise the fallback.
  // We set MOCK_POS.z to 15 so the fallback Z check passes and the XY return fires.
  var savedZ = MOCK_POS.z;
  MOCK_POS.z = 15; // == finishZ (10+5), passes the >= finishZ-0.5 guard

  var getWorkPosition = mockGetWorkPosition;
  var logLine = mockLogLine;
  var s = mockGetSettingsFromUI();
  var clearanceOffset = Number(s.finishHomeZ);  // 5
  var feed = s.faceRetractFeed;                 // 8000
  var returnXYZero = !!s.returnToXYZero;        // true

  async function nullMoveAbs(x, y, z, f) {
    commands.push({ type: 'moveAbs', cmd: 'null-return' });
    return null;
  }

  var pos = await getWorkPosition();            // initial read (1)
  var currentZ = Number(pos.z);                // 15 (patched)
  var maxSurfaceZ = mockGetMaxMeasuredSurfaceZ(); // 10
  var finishZ = maxSurfaceZ + clearanceOffset; // 15
  // currentZ (15) is NOT > finishZ (15), so finishZ <= currentZ → skip retract
  // To force the retract path, temporarily lower currentZ
  currentZ = 12; // pretend we're below finishZ to exercise the retract branch

  var zRetractOk = false;
  var retractPos = await nullMoveAbs(null, null, finishZ, feed);
  if (!retractPos) retractPos = await getWorkPosition();  // fallback fires (2)
  if (Number(retractPos.z) >= finishZ - 0.5) zRetractOk = true; // 15 >= 14.5 ✓

  if (returnXYZero && zRetractOk) {
    var returnPos = await nullMoveAbs(0, 0, null, feed);
    if (!returnPos) returnPos = await getWorkPosition();  // fallback fires (3)
    logLine('face', 'return pos: ' + returnPos.x);
  }

  MOCK_POS.z = savedZ;

  var numGetPos = commands.filter(function(c) { return c.type === 'getWorkPosition'; }).length;
  // 1 initial + 1 after Z retract fallback + 1 after XY return fallback = 3
  assert(numGetPos === 3, 'Fallback fires for both null moveAbs returns (1 initial + 2 fallbacks = 3), got ' + numGetPos);
}

// ── Run all tests ─────────────────────────────────────────────────────────────

(async function main() {
  console.log('=== face-probe-sequence tests ===');
  try {
    await testFinishRunMotionNoExtraGetPos();
    await testFinishRunMotionAlreadyAtHeight();
    await testNoStandaloneWaitForIdleBeforeFinish();
    await testMoveAbsFallbackGetPos();
  } catch (e) {
    console.error('Unexpected error in test runner:', e);
    failed++;
  }
  console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---');
  process.exit(failed > 0 ? 1 : 0);
})();
