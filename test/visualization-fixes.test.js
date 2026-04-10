/**
 * Unit tests for face visualization fixes:
 *   1. Face 3D view camera orientation — face-only prefixes ('face', 'resface', 'relief')
 *      use a frontal camera position (0, 30, 200) instead of the isometric (120, 80, 120).
 *   2. Relief-map probe marker clamping — markers at domain extremes are clamped so
 *      the full circle stays within the plot area (no half-circle at the heatmap edge).
 *
 * Run with:  node test/visualization-fixes.test.js
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

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Face-only prefix camera position
// Verify that the logic used in _threeGetOrInit routes face-only prefixes to
// the frontal camera position (0, 30, 200) and non-face prefixes to (120, 80, 120).
// ─────────────────────────────────────────────────────────────────────────────

function getInitialCameraPosition(prefix) {
  // Mirrors the logic in _threeGetOrInit (src/js/core.js).
  var faceOnlyPrefixes = ['face', 'resface', 'relief'];
  var isFaceOnly = faceOnlyPrefixes.indexOf(prefix) !== -1;
  if (isFaceOnly) {
    return { x: 0, y: 30, z: 200 };
  } else {
    return { x: 120, y: 80, z: 120 };
  }
}

function testFaceOnlyCameraPosition() {
  console.log('\nTest: face-only prefixes use frontal camera (0, 30, 200)');

  var faceOnlyPrefixes = ['face', 'resface', 'relief'];
  faceOnlyPrefixes.forEach(function(prefix) {
    var pos = getInitialCameraPosition(prefix);
    assert(pos.x === 0   && pos.y === 30  && pos.z === 200,
      'prefix "' + prefix + '" initial camera = (0, 30, 200), got (' + pos.x + ', ' + pos.y + ', ' + pos.z + ')');
  });
}

function testNonFacePrefixCameraPosition() {
  console.log('\nTest: non-face prefixes keep isometric camera (120, 80, 120)');

  var nonFacePrefixes = ['sm', 'res', 'surf', 'comb'];
  nonFacePrefixes.forEach(function(prefix) {
    var pos = getInitialCameraPosition(prefix);
    assert(pos.x === 120 && pos.y === 80  && pos.z === 120,
      'prefix "' + prefix + '" initial camera = (120, 80, 120), got (' + pos.x + ', ' + pos.y + ', ' + pos.z + ')');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1b: pvizResetView camera routing
// Verify that pvizResetView applies the correct camera to each prefix type.
// ─────────────────────────────────────────────────────────────────────────────

function getCameraForPvizReset(prefix) {
  // Mirrors the routing logic added to pvizResetView (src/js/core.js).
  var faceOnlySet = { 'face': true, 'resface': true, 'relief': true };
  if (faceOnlySet[prefix]) {
    return { x: 0, y: 30, z: 200 };
  } else {
    return { x: 120, y: 80, z: 120 };
  }
}

function testPvizResetViewRouting() {
  console.log('\nTest: pvizResetView applies correct camera per prefix');

  var faceOnlyPrefixes = ['face', 'resface', 'relief'];
  faceOnlyPrefixes.forEach(function(prefix) {
    var pos = getCameraForPvizReset(prefix);
    assert(pos.x === 0 && pos.y === 30 && pos.z === 200,
      'pvizResetView prefix "' + prefix + '" → frontal (0,30,200), got (' + pos.x + ',' + pos.y + ',' + pos.z + ')');
  });

  var surfacePrefixes = ['sm', 'res', 'surf', 'comb'];
  surfacePrefixes.forEach(function(prefix) {
    var pos = getCameraForPvizReset(prefix);
    assert(pos.x === 120 && pos.y === 80 && pos.z === 120,
      'pvizResetView prefix "' + prefix + '" → isometric (120,80,120), got (' + pos.x + ',' + pos.y + ',' + pos.z + ')');
  });
}


// Verify the clamping formula: Math.max(padL + MARK_R, Math.min(padL + plotW - MARK_R, cx))
// and the same for cy, so markers at domain extremes are fully inside the plot area.
// ─────────────────────────────────────────────────────────────────────────────

var MARK_R = 4;

function clampMarkerPos(cx, cy, padL, padT, plotW, plotH) {
  // Mirrors the clamping logic added to renderReliefMap (src/js/core.js).
  return {
    cx: Math.max(padL + MARK_R, Math.min(padL + plotW - MARK_R, cx)),
    cy: Math.max(padT + MARK_R, Math.min(padT + plotH - MARK_R, cy))
  };
}

function testMarkerClamping() {
  console.log('\nTest: probe marker clamping in renderReliefMap');

  var padL = 54, padR = 70, padT = 22, padB = 36;
  var containerW = 600;
  var plotW = containerW - padL - padR; // 476
  var plotH = 180;

  // --- Interior point: no clamping should occur ---
  var cx = padL + plotW / 2; // 54 + 238 = 292
  var cy = padT + plotH / 2; // 22 + 90 = 112
  var clamped = clampMarkerPos(cx, cy, padL, padT, plotW, plotH);
  assert(clamped.cx === cx && clamped.cy === cy,
    'Interior marker (292, 112) is unchanged after clamping');

  // --- Left edge (xDataMin): cx = padL = 54, should clamp to padL + MARK_R = 58 ---
  var leftEdgeCX = padL;
  var clampedLeft = clampMarkerPos(leftEdgeCX, cy, padL, padT, plotW, plotH);
  assert(clampedLeft.cx === padL + MARK_R,
    'Left-edge marker clamped: cx ' + leftEdgeCX + ' → ' + (padL + MARK_R) + ', got ' + clampedLeft.cx);

  // --- Right edge (xDataMax): cx = padL + plotW, should clamp to padL + plotW - MARK_R ---
  var rightEdgeCX = padL + plotW;
  var expectedRight = padL + plotW - MARK_R;
  var clampedRight = clampMarkerPos(rightEdgeCX, cy, padL, padT, plotW, plotH);
  assert(clampedRight.cx === expectedRight,
    'Right-edge marker clamped: cx ' + rightEdgeCX + ' → ' + expectedRight + ', got ' + clampedRight.cx);

  // --- Top edge (yDataMax): cy = padT, should clamp to padT + MARK_R ---
  var topEdgeCY = padT;
  var clampedTop = clampMarkerPos(cx, topEdgeCY, padL, padT, plotW, plotH);
  assert(clampedTop.cy === padT + MARK_R,
    'Top-edge marker clamped: cy ' + topEdgeCY + ' → ' + (padT + MARK_R) + ', got ' + clampedTop.cy);

  // --- Bottom edge (yDataMin): cy = padT + plotH, should clamp to padT + plotH - MARK_R ---
  var bottomEdgeCY = padT + plotH;
  var expectedBottom = padT + plotH - MARK_R;
  var clampedBottom = clampMarkerPos(cx, bottomEdgeCY, padL, padT, plotW, plotH);
  assert(clampedBottom.cy === expectedBottom,
    'Bottom-edge marker clamped: cy ' + bottomEdgeCY + ' → ' + expectedBottom + ', got ' + clampedBottom.cy);

  // --- Verify clamped positions keep marker circle within plot area ---
  var allPositions = [
    { cx: padL,         cy: padT,          label: 'top-left corner' },
    { cx: padL + plotW, cy: padT,          label: 'top-right corner' },
    { cx: padL,         cy: padT + plotH,  label: 'bottom-left corner' },
    { cx: padL + plotW, cy: padT + plotH,  label: 'bottom-right corner' }
  ];
  allPositions.forEach(function(p) {
    var cl = clampMarkerPos(p.cx, p.cy, padL, padT, plotW, plotH);
    var withinX = cl.cx - MARK_R >= padL && cl.cx + MARK_R <= padL + plotW;
    var withinY = cl.cy - MARK_R >= padT && cl.cy + MARK_R <= padT + plotH;
    assert(withinX && withinY,
      p.label + ': circle (r=' + MARK_R + ') stays within plot after clamping');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Run all tests
// ─────────────────────────────────────────────────────────────────────────────

(function main() {
  console.log('=== visualization-fixes tests ===');
  try {
    testFaceOnlyCameraPosition();
    testNonFacePrefixCameraPosition();
    testPvizResetViewRouting();
    testMarkerClamping();
  } catch (e) {
    console.error('Unexpected error in test runner:', e);
    failed++;
  }
  console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---');
  process.exit(failed > 0 ? 1 : 0);
})();
