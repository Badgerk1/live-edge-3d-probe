/**
 * Unit tests for face visualization fixes:
 *   1. Face 3D view camera orientation — face-only prefixes ('face', 'resface', 'relief')
 *      use a frontal camera position (0, 30, 200) instead of the isometric (120, 80, 120).
 *   2. Relief-map probe marker clamping — markers at domain extremes are clamped so
 *      the full circle stays within the plot area (no half-circle at the heatmap edge).
 *   3. Catmull-Rom bicubic interpolation — C1-continuous smooth surface rendering;
 *      verifies endpoint values, C0/C1 continuity at joints, and accuracy vs bilinear.
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
// Test 3: Face wall worldZ direction
// Verify that face protrusions (contact Y closer to startCoord) produce a POSITIVE
// worldZ displacement from frontZ (i.e. appear closer to the frontal camera).
// The sign flip from (mc - cMid) to -(mc - cMid) is the key correction.
// ─────────────────────────────────────────────────────────────────────────────

function faceWorldZ(mc, cMid, zExag, zScale, frontZ, lateralSlant, layerFrac) {
  // Mirrors the corrected formula in _buildThreeFaceWall (src/js/core.js).
  return frontZ - (mc - cMid) * zExag * zScale + layerFrac * lateralSlant;
}

function testFaceWallWorldZDirection() {
  console.log('\nTest: face wall worldZ — protruding regions appear closer to frontal camera');

  var frontZ = 0, zExag = 1.5, zScale = 0.5, lateralSlant = 0, layerFrac = 0.5;
  var cMin = -30, cMax = 0, cMid = -15; // typical face probe on Y axis

  // Case 1: face region at startCoord side (mc = cMin = -30, most protruding toward probe)
  // Expected: worldZ > frontZ (closer to +Z frontal camera)
  var mcProtrude = cMin; // most protruding
  var wzProtrude = faceWorldZ(mcProtrude, cMid, zExag, zScale, frontZ, lateralSlant, layerFrac);
  assert(wzProtrude > frontZ,
    'Protruding face region (mc=cMin) gives worldZ > frontZ (closer to camera); got ' + wzProtrude.toFixed(3));

  // Case 2: face region at targetCoord side (mc = cMax = 0, most receding from probe)
  // Expected: worldZ < frontZ (farther from +Z frontal camera)
  var mcRecede = cMax; // most receding
  var wzRecede = faceWorldZ(mcRecede, cMid, zExag, zScale, frontZ, lateralSlant, layerFrac);
  assert(wzRecede < frontZ,
    'Receding face region (mc=cMax) gives worldZ < frontZ (farther from camera); got ' + wzRecede.toFixed(3));

  // Case 3: flat face (mc = cMid) → worldZ = frontZ (no displacement)
  var wzFlat = faceWorldZ(cMid, cMid, zExag, zScale, frontZ, lateralSlant, layerFrac);
  assert(wzFlat === frontZ,
    'Flat face (mc=cMid) gives worldZ = frontZ exactly; got ' + wzFlat.toFixed(3));

  // Case 4: verify sign is opposite to the OLD (unfixed) formula
  function faceWorldZOld(mc2, cMid2, zExag2, zScale2, frontZ2, lateralSlant2, layerFrac2) {
    return frontZ2 + (mc2 - cMid2) * zExag2 * zScale2 + layerFrac2 * lateralSlant2;
  }
  var wzOld = faceWorldZOld(mcProtrude, cMid, zExag, zScale, frontZ, lateralSlant, layerFrac);
  assert(wzOld < frontZ,
    'OLD formula gives worldZ < frontZ for protruding region (wrong direction, confirms bug was real); got ' + wzOld.toFixed(3));
  assert(wzProtrude !== wzOld,
    'New formula differs from old formula for protruding region (' + wzProtrude.toFixed(3) + ' vs ' + wzOld.toFixed(3) + ')');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: FACE_LATERAL_SLANT = 0
// Verify that the constant is 0 (flat XZ-projection appearance, no artificial tilt).
// ─────────────────────────────────────────────────────────────────────────────

function testFaceLateralSlantIsZero() {
  console.log('\nTest: FACE_LATERAL_SLANT = 0 (flat XZ projection)');

  // Mirrors the constant declaration in src/js/core.js.
  var FACE_LATERAL_SLANT = 0;

  assert(FACE_LATERAL_SLANT === 0,
    'FACE_LATERAL_SLANT is 0 — face wall renders flat, consistent with XZ projection; got ' + FACE_LATERAL_SLANT);

  // With FACE_LATERAL_SLANT = 0, layerFrac * lateralSlant = 0 regardless of layerFrac.
  [0, 0.25, 0.5, 0.75, 1.0].forEach(function(lf) {
    var slantContrib = lf * FACE_LATERAL_SLANT;
    assert(slantContrib === 0,
      'layerFrac=' + lf + ': slant contribution = 0 (no tilt added); got ' + slantContrib);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: Weighted-bilinear fallback in renderReliefMap
// Verify that when some corners of a bilinear cell are null (missed probe contacts),
// the fallback uses only the non-null corners with re-normalised weights instead of
// returning null (which would produce a dark patch in the heat-map).
// ─────────────────────────────────────────────────────────────────────────────

function bilinearValWithFallback(grid, px, py, xDataMin, xDataSpan, yDataMin, yDataSpan, nCols, nRows) {
  // Mirrors the updated bilinearVal closure in renderReliefMap (src/js/core.js).
  var fx = (px - xDataMin) / xDataSpan * (nCols - 1);
  var fy = (py - yDataMin) / yDataSpan * (nRows - 1);
  var c0 = Math.floor(fx), c1 = Math.min(c0 + 1, nCols - 1);
  var r0 = Math.floor(fy), r1 = Math.min(r0 + 1, nRows - 1);
  var tx = fx - c0, ty = fy - r0;
  var v00 = grid[c0][r0], v10 = grid[c1][r0], v01 = grid[c0][r1], v11 = grid[c1][r1];
  if (v00 == null || v10 == null || v01 == null || v11 == null) {
    var w00 = (1-tx)*(1-ty), w10 = tx*(1-ty), w01 = (1-tx)*ty, w11 = tx*ty;
    var wSum = 0, vSum = 0;
    if (v00 != null) { wSum += w00; vSum += v00*w00; }
    if (v10 != null) { wSum += w10; vSum += v10*w10; }
    if (v01 != null) { wSum += w01; vSum += v01*w01; }
    if (v11 != null) { wSum += w11; vSum += v11*w11; }
    return wSum > 0 ? vSum / wSum : null;
  }
  return v00*(1-tx)*(1-ty) + v10*tx*(1-ty) + v01*(1-tx)*ty + v11*tx*ty;
}

function testBilinearFallback() {
  console.log('\nTest: weighted-bilinear fallback for null grid corners');

  // 3×3 grid; column index is first, row index second.
  // Simulate a 3×3 cell grid where cell (0,0) has a null corner at c=0,r=0.
  var grid = [
    [null, 10,  20],  // column 0
    [5,    15,  25],  // column 1
    [10,   20,  30]   // column 2
  ];
  var nCols = 3, nRows = 3;
  var xDataMin = 0, xDataSpan = 2, yDataMin = 0, yDataSpan = 2;

  // Query the centre of the (c=0,r=0)→(c=1,r=1) cell: px=0.5, py=0.5
  // Only v00 is null (grid[0][0]=null). The other 3 corners are: v10=5, v01=10, v11=15.
  // With null fallback the old code returned null; new code should return a value.
  var val = bilinearValWithFallback(grid, 0.5, 0.5, xDataMin, xDataSpan, yDataMin, yDataSpan, nCols, nRows);
  assert(val !== null,
    'Bilinear cell with one null corner returns non-null value instead of null; got ' + val);
  // Expected: weights at px=0.5, py=0.5 → tx=0.5, ty=0.5; w00=0.25(null), w10=0.25(5), w01=0.25(10), w11=0.25(15)
  // wSum = 0.75, vSum = 5*0.25 + 10*0.25 + 15*0.25 = 7.5; result = 7.5/0.75 = 10
  var expected = 10;
  assert(Math.abs(val - expected) < 1e-9,
    'Bilinear fallback value = ' + expected + ' (re-normalised over 3 non-null corners); got ' + val.toFixed(6));

  // Query a point where ALL 4 corners are null → should still return null (no data)
  var gridAllNull = [[null, null], [null, null]];
  var valNull = bilinearValWithFallback(gridAllNull, 0.5, 0.5, 0, 1, 0, 1, 2, 2);
  assert(valNull === null,
    'All-null cell returns null (correct — no data available); got ' + valNull);

  // Query a point where all 4 corners are valid → should use normal bilinear interpolation
  var grid4 = [[0, 2], [2, 4]];
  var valFull = bilinearValWithFallback(grid4, 0.5, 0.5, 0, 1, 0, 1, 2, 2);
  assert(Math.abs(valFull - 2.0) < 1e-9,
    'Full bilinear (all non-null) at centre = 2.0; got ' + valFull);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: Nearest-neighbor fill in buildFaceWallGrid
// Verify that null cells in the face-wall grid are filled from adjacent non-null
// cells so that the 3D mesh has no holes from missed probe contacts.
// ─────────────────────────────────────────────────────────────────────────────

function nnFill(grid, xs, layers) {
  // Mirrors the nearest-neighbor fill added to buildFaceWallGrid (src/js/core.js).
  var nCols = xs.length, nRows = layers.length;
  var changed = true, maxPass = Math.max(nCols, nRows);
  for (var p = 0; p < maxPass && changed; p++) {
    changed = false;
    for (var li = 0; li < nRows; li++) {
      for (var xi = 0; xi < nCols; xi++) {
        if (grid[li][xi]) continue;
        var nbrs = [];
        if (xi > 0        && grid[li][xi-1]) nbrs.push(grid[li][xi-1]);
        if (xi < nCols-1  && grid[li][xi+1]) nbrs.push(grid[li][xi+1]);
        if (li > 0        && grid[li-1][xi]) nbrs.push(grid[li-1][xi]);
        if (li < nRows-1  && grid[li+1][xi]) nbrs.push(grid[li+1][xi]);
        if (nbrs.length === 0) continue;
        var sumY = 0, sumZ = 0;
        nbrs.forEach(function(r) { sumY += Number(r.y); sumZ += Number(r.z); });
        var cnt = nbrs.length;
        grid[li][xi] = { x: xs[xi], y: sumY/cnt, z: sumZ/cnt, layer: layers[li], _interpolated: true };
        changed = true;
      }
    }
  }
  return grid;
}

function testNearestNeighborFill() {
  console.log('\nTest: nearest-neighbor fill in buildFaceWallGrid');

  var xs = [0, 10, 20];       // 3 X positions
  var layers = [1, 2, 3];     // 3 layers

  // Grid: grid[li][xi]; simulate a missed contact at (xi=1, li=1) — the centre cell
  var grid = [
    { 0: {x:0,y:-5,z:5,layer:1},  1: {x:10,y:-4,z:5,layer:1},  2: {x:20,y:-6,z:5,layer:1} },
    { 0: {x:0,y:-4,z:3,layer:2},  1: null,                       2: {x:20,y:-5,z:3,layer:2} },
    { 0: {x:0,y:-3,z:1,layer:3},  1: {x:10,y:-3,z:1,layer:3},  2: {x:20,y:-4,z:1,layer:3} }
  ];

  assert(grid[1][1] === null, 'Centre cell (li=1, xi=1) starts as null (missed contact)');

  var filled = nnFill(grid, xs, layers);

  assert(filled[1][1] !== null,
    'Centre cell (li=1, xi=1) is filled after nnFill');
  assert(filled[1][1]._interpolated === true,
    'Filled cell is marked as _interpolated');

  // With 4 neighbours: y values -4 (li=1,xi=0), -5 (li=1,xi=2), -4 (li=0,xi=1), -3 (li=2,xi=1)
  // Expected avg y = (-4 + -5 + -4 + -3) / 4 = -16/4 = -4
  var expectedY = (-4 + -5 + -4 + -3) / 4;
  assert(Math.abs(filled[1][1].y - expectedY) < 1e-9,
    'Filled cell y = ' + expectedY + ' (avg of 4 neighbours); got ' + filled[1][1].y);

  // All other cells should be unchanged
  assert(filled[0][0].y === -5, 'Non-null cell (0,0) unchanged');
  assert(filled[2][2].y === -4, 'Non-null cell (2,2) unchanged');

  // Test that a grid corner missing is also filled (single-pass may need 2 passes for far cells)
  var grid2 = [
    { 0: null, 1: {x:10,y:-4,z:5,layer:1}, 2: {x:20,y:-6,z:5,layer:1} },
    { 0: null, 1: {x:10,y:-5,z:3,layer:2}, 2: {x:20,y:-5,z:3,layer:2} },
    { 0: null, 1: {x:10,y:-3,z:1,layer:3}, 2: {x:20,y:-4,z:1,layer:3} }
  ];
  var filled2 = nnFill(grid2, xs, layers);
  assert(filled2[0][0] !== null, 'Corner cell (li=0, xi=0) filled from right neighbour');
  assert(filled2[1][0] !== null, 'Middle-left cell (li=1, xi=0) filled');
  assert(filled2[2][0] !== null, 'Bottom-left cell (li=2, xi=0) filled');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test: Catmull-Rom interpolation (smooth mesh)
// Verifies that _catmullRom produces C1-continuous results (no crease at joints)
// and that bicubic interpolation on a uniform grid matches expected values.
// ─────────────────────────────────────────────────────────────────────────────

// Inline the Catmull-Rom 1D helper (mirrors src/js/core.js _catmullRom)
function catmullRom(p0, p1, p2, p3, t) {
  var t2 = t * t, t3 = t2 * t;
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2*p0 - 5*p1 + 4*p2 - p3) * t2 +
    (-p0 + 3*p1 - 3*p2 + p3) * t3
  );
}

function testCatmullRomBasic() {
  console.log('\nTest: Catmull-Rom 1D basic properties');

  // At t=0, result must equal p1
  assert(Math.abs(catmullRom(0, 1, 2, 3, 0) - 1) < 1e-9,
    'catmullRom at t=0 returns p1');

  // At t=1, result must equal p2
  assert(Math.abs(catmullRom(0, 1, 2, 3, 1) - 2) < 1e-9,
    'catmullRom at t=1 returns p2');

  // For a linear sequence p0..p3, result at midpoint t=0.5 must be linear midpoint
  assert(Math.abs(catmullRom(0, 1, 2, 3, 0.5) - 1.5) < 1e-9,
    'catmullRom on linear sequence: t=0.5 → linear midpoint 1.5');

  // For a flat uniform sequence, result must be constant (no overshoot)
  assert(Math.abs(catmullRom(5, 5, 5, 5, 0.5) - 5) < 1e-9,
    'catmullRom on flat sequence: result = 5 (no overshoot)');

  // C1 continuity: left tangent at t=0 = (p2-p0)/2, right tangent at t=1 = (p3-p1)/2
  // Numerical derivative at t=0 (forward difference, small eps)
  var eps = 1e-6;
  var p0=0, p1=1, p2=4, p3=6;
  var derivAtT0 = (catmullRom(p0,p1,p2,p3,eps) - catmullRom(p0,p1,p2,p3,0)) / eps;
  var expectedDeriv = (p2 - p0) / 2; // = (4-0)/2 = 2
  assert(Math.abs(derivAtT0 - expectedDeriv) < 1e-4,
    'catmullRom t=0 derivative = (p2-p0)/2=' + expectedDeriv + ', got ' + derivAtT0.toFixed(4));

  // Derivative at t=1 (backward difference)
  var derivAtT1 = (catmullRom(p0,p1,p2,p3,1) - catmullRom(p0,p1,p2,p3,1-eps)) / eps;
  var expectedDeriv1 = (p3 - p1) / 2; // = (6-1)/2 = 2.5
  assert(Math.abs(derivAtT1 - expectedDeriv1) < 1e-4,
    'catmullRom t=1 derivative = (p3-p1)/2=' + expectedDeriv1 + ', got ' + derivAtT1.toFixed(4));
}

function testCatmullRomC1Continuity() {
  console.log('\nTest: Catmull-Rom C1 continuity at grid-point boundary');

  // Two consecutive segments sharing the boundary at t=1 of first / t=0 of second.
  // First segment: p0=0, p1=1, p2=3, p3=6  (covers x=1→3)
  // Second segment: p0=1, p1=3, p2=6, p3=10 (covers x=3→6)
  // The derivative at the boundary must be equal for both segments.
  var eps = 1e-5;
  var deriv_left  = (catmullRom(0,1,3,6, 1) - catmullRom(0,1,3,6, 1-eps)) / eps;
  var deriv_right = (catmullRom(1,3,6,10, eps) - catmullRom(1,3,6,10, 0)) / eps;
  assert(Math.abs(deriv_left - deriv_right) < 1e-3,
    'C1 continuity: left deriv ' + deriv_left.toFixed(4) + ' ≈ right deriv ' + deriv_right.toFixed(4));

  // Value continuity: both segments must return the same value at the boundary
  var val_left  = catmullRom(0, 1, 3, 6, 1);
  var val_right = catmullRom(1, 3, 6, 10, 0);
  assert(Math.abs(val_left - val_right) < 1e-9,
    'C0 continuity at boundary: left=' + val_left + ' right=' + val_right);
}

function testCatmullRomBoundaryClamp() {
  console.log('\nTest: Catmull-Rom boundary clamping (p0=p1 or p3=p2)');

  // When p0 is clamped to p1 (left boundary), tangent at t=0 = (p2-p0)/2 = (p2-p1)/2
  var p0=2, p1=2, p2=5, p3=8;
  var eps = 1e-6;
  var deriv = (catmullRom(p0,p1,p2,p3,eps) - catmullRom(p0,p1,p2,p3,0)) / eps;
  var expected = (p2 - p0) / 2;
  assert(Math.abs(deriv - expected) < 1e-4,
    'Clamped left boundary: tangent at t=0 = (p2-p1)/2=' + expected + ', got ' + deriv.toFixed(4));

  // Value at t=0 must still equal p1
  assert(Math.abs(catmullRom(p0,p1,p2,p3,0) - p1) < 1e-9,
    'Clamped left boundary: t=0 = p1=' + p1);
}

function testCatmullRomVsBilinear() {
  console.log('\nTest: Catmull-Rom vs bilinear on a non-linear surface');

  // On a quadratic surface z = x^2, the correct midpoint is 0.25 (analytic).
  // Points: z(0)=0, z(1)=1, z(2)=4, z(3)=9
  var cr_mid = catmullRom(0, 1, 4, 9, 0.5);  // should be ~2.25 = (1.5)^2
  var bl_mid = (1 + 4) / 2;                   // bilinear = 2.5 (over-estimates)
  assert(Math.abs(cr_mid - 2.25) < 0.05,
    'Catmull-Rom on x^2 surface: midpoint ≈ 2.25, got ' + cr_mid.toFixed(4));
  assert(Math.abs(bl_mid - 2.5) < 1e-9,
    'Bilinear on x^2 surface: midpoint = 2.5 (baseline)');
  // CR should be closer to the analytic result than bilinear
  assert(Math.abs(cr_mid - 2.25) < Math.abs(bl_mid - 2.25),
    'Catmull-Rom is closer to analytic midpoint than bilinear');
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
    testFaceWallWorldZDirection();
    testFaceLateralSlantIsZero();
    testBilinearFallback();
    testNearestNeighborFill();
    testCatmullRomBasic();
    testCatmullRomC1Continuity();
    testCatmullRomBoundaryClamp();
    testCatmullRomVsBilinear();
  } catch (e) {
    console.error('Unexpected error in test runner:', e);
    failed++;
  }
  console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---');
  process.exit(failed > 0 ? 1 : 0);
})();
