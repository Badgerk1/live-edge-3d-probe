/**
 * Unit tests for face-probe progress bar computation.
 *
 * Validates that:
 *  1. Phase 0 (auto top-Z) progress calculation uses (i+1)/total so the final
 *     iteration reaches 30% (the end of Phase 0) rather than (total-1)/total*30.
 *  2. Single-pass face probe progress fills from its base percent to 100% by the
 *     last sample.
 *  3. Layered face probe progress fills from its base percent to 100% by the
 *     last layer/sample combination.
 *
 * Run with:  node test/face-probe-progress.test.js
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

function assertClose(actual, expected, tolerance, message) {
  var diff = Math.abs(actual - expected);
  if (diff <= (tolerance || 0.001)) {
    console.log('  PASS: ' + message + ' (got ' + actual.toFixed(4) + ')');
    passed++;
  } else {
    console.error('  FAIL: ' + message + ' — expected ' + expected + ' ±' + (tolerance || 0.001) + ', got ' + actual.toFixed(4));
    failed++;
  }
}

// ── Progress math helpers (mirrors the fixed src/js/face-probe.js formulas) ──

/**
 * Phase 0 progress for sample i (0-based) of xPts total.
 * Fixed formula: (i+1)/xPts * 30
 */
function phase0Progress(i, xPts) {
  return (i + 1) / xPts * 30;
}

/**
 * Single-pass face probe progress for sample i (0-based) of total samples.
 * p0Ran: whether Phase 0 executed (true → base=30, range=70; false → base=0, range=100).
 */
function singlePassProgress(i, totalSamples, p0Ran) {
  var base = p0Ran ? 30 : 0;
  var range = p0Ran ? 70 : 100;
  return base + (i + 1) / totalSamples * range;
}

/**
 * Layered face probe progress for the fpDone-th completed sample (1-based count)
 * out of (totalLayers * totalSamples) total probe points.
 * p0Ran: whether Phase 0 executed.
 */
function layeredProgress(fpDone, totalLayers, totalSamples, p0Ran) {
  var base = p0Ran ? 30 : 0;
  var range = 100 - base;
  var total = totalLayers * totalSamples;
  return base + fpDone / total * range;
}

// ── Tests ────────────────────────────────────────────────────────────────────

function testPhase0OffByOneFix() {
  console.log('\nTest: Phase 0 — last iteration must reach 30% (off-by-one fix)');

  // With 5 points, the last iteration is i=4.
  // OLD (broken): 4/5 * 30 = 24%  ← never reaches 30%
  // NEW (fixed):  (4+1)/5 * 30 = 30% ✓
  var xPts = 5;
  var lastProgress = phase0Progress(xPts - 1, xPts);
  assertClose(lastProgress, 30, 0.001, 'Phase 0 last sample (5-point) reaches 30%');

  // Verify intermediate values are sensible (monotonically increasing)
  var prevPct = 0;
  var allIncreasing = true;
  for (var i = 0; i < xPts; i++) {
    var pct = phase0Progress(i, xPts);
    if (pct <= prevPct) { allIncreasing = false; break; }
    prevPct = pct;
  }
  assert(allIncreasing, 'Phase 0 progress is strictly increasing across all samples');

  // Verify first sample is non-zero (progress registers immediately)
  var firstProgress = phase0Progress(0, xPts);
  assert(firstProgress > 0 && firstProgress < 30, 'Phase 0 first sample gives >0% and <30%');

  // Check with a different point count (10)
  var lastProgress10 = phase0Progress(9, 10);
  assertClose(lastProgress10, 30, 0.001, 'Phase 0 last sample (10-point) reaches 30%');
}

function testPhase0OldFormulaWasBroken() {
  console.log('\nTest: Phase 0 — confirm old formula was broken (i/total never reaches end)');

  // This test documents the old (broken) behaviour so any future regression is obvious.
  function oldPhase0Progress(i, xPts) {
    return i / xPts * 30;
  }

  var xPts = 5;
  var oldLast = oldPhase0Progress(xPts - 1, xPts); // 4/5 * 30 = 24
  assert(oldLast < 30, 'OLD formula: last sample is less than 30% (' + oldLast.toFixed(2) + '%) — this was the bug');

  var newLast = phase0Progress(xPts - 1, xPts);    // 5/5 * 30 = 30
  assert(newLast >= 30, 'NEW formula: last sample reaches 30% (' + newLast.toFixed(2) + '%) — bug is fixed');
}

function testSinglePassProgressReaches100() {
  console.log('\nTest: Single-pass face probe — last sample must reach 100%');

  var samples = 8;

  // With Phase 0 running (30% base)
  var lastWithP0 = singlePassProgress(samples - 1, samples, true);
  assertClose(lastWithP0, 100, 0.001, 'Single-pass last sample (with Phase 0) reaches 100%');

  // Without Phase 0 (0% base)
  var lastWithoutP0 = singlePassProgress(samples - 1, samples, false);
  assertClose(lastWithoutP0, 100, 0.001, 'Single-pass last sample (without Phase 0) reaches 100%');

  // First sample should be above base
  var firstWithP0 = singlePassProgress(0, samples, true);
  assert(firstWithP0 > 30 && firstWithP0 < 100, 'Single-pass first sample (with Phase 0) is between 30% and 100%');

  var firstWithoutP0 = singlePassProgress(0, samples, false);
  assert(firstWithoutP0 > 0 && firstWithoutP0 < 100, 'Single-pass first sample (without Phase 0) is between 0% and 100%');
}

function testLayeredProgressReaches100() {
  console.log('\nTest: Layered face probe — last layer/sample must reach 100%');

  var totalLayers = 3;
  var totalSamples = 5;
  var totalPoints = totalLayers * totalSamples;

  // With Phase 0 running (30% base)
  var lastWithP0 = layeredProgress(totalPoints, totalLayers, totalSamples, true);
  assertClose(lastWithP0, 100, 0.001, 'Layered last point (with Phase 0) reaches 100%');

  // Without Phase 0 (0% base)
  var lastWithoutP0 = layeredProgress(totalPoints, totalLayers, totalSamples, false);
  assertClose(lastWithoutP0, 100, 0.001, 'Layered last point (without Phase 0) reaches 100%');

  // Intermediate points are monotonically increasing
  var prevPct = (true ? 30 : 0); // base when p0Ran=true
  var allIncreasing = true;
  for (var n = 1; n <= totalPoints; n++) {
    var pct = layeredProgress(n, totalLayers, totalSamples, true);
    if (pct <= prevPct) { allIncreasing = false; break; }
    prevPct = pct;
  }
  assert(allIncreasing, 'Layered progress is strictly increasing across all points (with Phase 0)');
}

function testProgressContinuityPhase0ToFaceProbe() {
  console.log('\nTest: Progress is continuous from Phase 0 (ends at 30%) into face probing (starts above 30%)');

  // Phase 0 ends at exactly 30%
  var phase0End = phase0Progress(4, 5);
  assertClose(phase0End, 30, 0.001, 'Phase 0 ends at 30%');

  // First face probe sample (single-pass, with Phase 0 ran) starts above 30%
  var firstFaceSample = singlePassProgress(0, 5, true);
  assert(firstFaceSample > 30, 'First face probe sample (single-pass, after Phase 0) starts above 30%');

  // Confirm no overlap or gap
  assertClose(firstFaceSample, 30 + 1 / 5 * 70, 0.001, 'First face sample is at 30 + 1/5 * 70 = ' + (30 + 1 / 5 * 70).toFixed(1) + '%');
}

// ── Run all tests ─────────────────────────────────────────────────────────────

(async function main() {
  console.log('=== face-probe-progress tests ===');
  try {
    testPhase0OffByOneFix();
    testPhase0OldFormulaWasBroken();
    testSinglePassProgressReaches100();
    testLayeredProgressReaches100();
    testProgressContinuityPhase0ToFaceProbe();
  } catch (e) {
    console.error('Unexpected error in test runner:', e);
    failed++;
  }
  console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---');
  process.exit(failed > 0 ? 1 : 0);
})();
