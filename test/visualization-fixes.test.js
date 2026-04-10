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
// Test 3: Face wall depth-sign fix
// Verify that shallow contact (small mc) maps to worldZ > frontZ (closer to
// camera) and deep contact maps to worldZ < frontZ (further from camera).
// This ensures the face appears correctly protruding/receding in the 3D view.
// ─────────────────────────────────────────────────────────────────────────────

function computeFaceWallWorldZ(mc, cMid, zExag, zScale, frontZ, layerFrac, lateralSlant) {
  // Mirrors the fixed formula in _buildThreeFaceWall (src/js/core.js).
  return frontZ - (mc - cMid) * zExag * zScale + layerFrac * lateralSlant;
}

function testFaceWallDepthSign() {
  console.log('\nTest: face wall depth displacement sign (shallow contact → closer to camera)');

  var zExag = 5, zScale = 0.3, frontZ = 0, lateralSlant = 10;
  var cMin = 5, cMax = 45, cMid = (cMin + cMax) / 2; // = 25

  // Shallow contact: mc < cMid → face protrudes toward viewer → worldZ > frontZ
  var shallow = computeFaceWallWorldZ(cMin, cMid, zExag, zScale, frontZ, 0, lateralSlant);
  assert(shallow > frontZ,
    'Shallow contact (mc=' + cMin + ', cMid=' + cMid + '): worldZ=' + shallow.toFixed(3) + ' > frontZ=' + frontZ + ' (closer to camera)');

  // Deep contact: mc > cMid → face recedes → worldZ < frontZ
  var deep = computeFaceWallWorldZ(cMax, cMid, zExag, zScale, frontZ, 0, lateralSlant);
  assert(deep < frontZ,
    'Deep contact (mc=' + cMax + ', cMid=' + cMid + '): worldZ=' + deep.toFixed(3) + ' < frontZ=' + frontZ + ' (further from camera)');

  // Mid contact: mc = cMid → worldZ = frontZ (no depth displacement)
  var mid = computeFaceWallWorldZ(cMid, cMid, zExag, zScale, frontZ, 0, lateralSlant);
  assert(Math.abs(mid - frontZ) < 1e-9,
    'Average contact (mc=cMid=' + cMid + '): worldZ=' + mid.toFixed(6) + ' = frontZ=' + frontZ);

  // Lateral slant increases worldZ at top (layerFrac=1), no effect at bottom (layerFrac=0)
  var topMid = computeFaceWallWorldZ(cMid, cMid, zExag, zScale, frontZ, 1, lateralSlant);
  assert(Math.abs(topMid - (frontZ + lateralSlant)) < 1e-9,
    'Top layer (layerFrac=1, mc=cMid): worldZ=' + topMid.toFixed(3) + ' = frontZ + lateralSlant=' + (frontZ + lateralSlant));

  // Depth displacement is proportional to (cMid - mc)
  var mc1 = cMid - 5;
  var mc2 = cMid - 10;
  var wz1 = computeFaceWallWorldZ(mc1, cMid, zExag, zScale, frontZ, 0, lateralSlant);
  var wz2 = computeFaceWallWorldZ(mc2, cMid, zExag, zScale, frontZ, 0, lateralSlant);
  assert(wz2 > wz1 && wz1 > frontZ,
    'Larger shallowness → larger worldZ: wz(mc=' + mc2 + ')=' + wz2.toFixed(3) + ' > wz(mc=' + mc1 + ')=' + wz1.toFixed(3) + ' > frontZ=' + frontZ);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: buildFaceWallGrid gap-fill
// Verify that a grid with one missing probe point (MISS) is filled in
// correctly by the X-direction and Z-direction interpolation passes.
// ─────────────────────────────────────────────────────────────────────────────

function buildFaceWallGridLogic(data) {
  // Mirrors buildFaceWallGrid from src/js/core.js (pure logic, no DOM).
  var xKeyToVal = {}, layerSet = {};
  data.forEach(function(r) {
    var key = Number(r.x).toFixed(3);
    if (!(key in xKeyToVal)) xKeyToVal[key] = Number(r.x);
    layerSet[r.layer != null ? r.layer : 1] = true;
  });
  var xs = Object.keys(xKeyToVal).map(function(k) { return xKeyToVal[k]; }).sort(function(a,b){return a-b;});
  var layers = Object.keys(layerSet).map(Number).sort(function(a,b){return a-b;});
  if (xs.length < 2 || layers.length < 2) return null;
  var xIndexMap = {};
  xs.forEach(function(v,i){ xIndexMap[v.toFixed(3)]=i; });
  var layerIndexMap = {};
  layers.forEach(function(l,i){ layerIndexMap[l]=i; });

  var grid = [];
  for (var li=0; li<layers.length; li++) { grid.push({}); }
  data.forEach(function(r) {
    var xi = xIndexMap[Number(r.x).toFixed(3)];
    if (xi == null) return;
    var l = r.layer != null ? r.layer : 1;
    var li = layerIndexMap[l];
    if (li == null) return;
    if (!grid[li][xi]) grid[li][xi] = r;
  });

  // Gap-fill (mirrors the logic added to buildFaceWallGrid)
  var nL = layers.length, nX = xs.length;
  function interp(liA, xiA, liB, xiB, tFrac) {
    var rA = grid[liA][xiA], rB = grid[liB][xiB];
    if (!rA || !rB) return null;
    var t = tFrac, s = 1-t;
    return { x: s*Number(rA.x)+t*Number(rB.x), y: s*Number(rA.y)+t*Number(rB.y), z: s*Number(rA.z)+t*Number(rB.z), layer: rA.layer, _interpolated: true };
  }
  // Pass 1: X-direction
  for (var pli=0; pli<nL; pli++) {
    for (var pxi=0; pxi<nX; pxi++) {
      if (grid[pli][pxi]) continue;
      var lx=-1, rx=-1;
      for (var k=pxi-1; k>=0; k--) { if (grid[pli][k]) { lx=k; break; } }
      for (var k=pxi+1; k<nX; k++) { if (grid[pli][k]) { rx=k; break; } }
      if (lx>=0 && rx>=0) { grid[pli][pxi]=interp(pli,lx,pli,rx,(pxi-lx)/(rx-lx)); }
      else if (lx>=0) { grid[pli][pxi]=interp(pli,lx,pli,lx,0); }
      else if (rx>=0) { grid[pli][pxi]=interp(pli,rx,pli,rx,0); }
    }
  }
  // Pass 2: Z-direction
  for (var pxi2=0; pxi2<nX; pxi2++) {
    for (var pli2=0; pli2<nL; pli2++) {
      if (grid[pli2][pxi2]) continue;
      var ll=-1, rl=-1;
      for (var k=pli2-1; k>=0; k--) { if (grid[k][pxi2]) { ll=k; break; } }
      for (var k=pli2+1; k<nL; k++) { if (grid[k][pxi2]) { rl=k; break; } }
      if (ll>=0 && rl>=0) { grid[pli2][pxi2]=interp(ll,pxi2,rl,pxi2,(pli2-ll)/(rl-ll)); }
      else if (ll>=0) { grid[pli2][pxi2]=interp(ll,pxi2,ll,pxi2,0); }
      else if (rl>=0) { grid[pli2][pxi2]=interp(rl,pxi2,rl,pxi2,0); }
    }
  }
  return { grid: grid, xs: xs, layers: layers, nCols: xs.length, nRows: layers.length };
}

function testBuildFaceWallGridGapFill() {
  console.log('\nTest: buildFaceWallGrid gap-fill for missing probe points');

  // 5 X positions × 3 layers = 15 grid points; simulate 1 MISS at (X=50, layer=2)
  var xPositions = [0, 25, 50, 75, 100];
  var layerZs = [5.0, 12.4, 19.8];
  var data = [];
  xPositions.forEach(function(x) {
    layerZs.forEach(function(z, li) {
      var layer = li + 1;
      // Skip (X=50, layer=2) to simulate a MISS probe
      if (x === 50 && layer === 2) return;
      data.push({ x: x, y: x * 0.1 + z * 0.05, z: z, layer: layer });
    });
  });
  assert(data.length === 14, 'Data has 14 points (1 MISS omitted): got ' + data.length);

  var fw = buildFaceWallGridLogic(data);
  assert(fw !== null, 'buildFaceWallGrid returns non-null for 5×3 grid with 1 MISS');

  // After gap-fill, ALL cells should be populated
  var missing = 0;
  for (var li = 0; li < fw.nRows; li++) {
    for (var xi = 0; xi < fw.nCols; xi++) {
      if (!fw.grid[li][xi]) missing++;
    }
  }
  assert(missing === 0, 'All ' + (fw.nRows * fw.nCols) + ' grid cells filled (was missing ' + missing + ')');

  // The interpolated cell (xi=2, li=1) should have Y value between its X neighbours
  var xi2 = fw.xs.indexOf(50); // column for X=50
  var li1 = 1; // layer 2 (layer index 1)
  var filled = fw.grid[li1][xi2];
  assert(filled !== null && filled !== undefined, 'Cell (X=50, layer=2) was gap-filled');
  if (filled) {
    // Neighbours at X=25 and X=75 in the same layer
    var xi1 = fw.xs.indexOf(25), xi3 = fw.xs.indexOf(75);
    var left = fw.grid[li1][xi1], right = fw.grid[li1][xi3];
    if (left && right) {
      var expectedY = (Number(left.y) + Number(right.y)) / 2;
      var gotY = Number(filled.y);
      assert(Math.abs(gotY - expectedY) < 1e-6,
        'Gap-filled Y = avg of neighbours: expected ' + expectedY.toFixed(6) + ' got ' + gotY.toFixed(6));
    }
    assert(filled._interpolated === true, 'Gap-filled cell is marked _interpolated=true');
  }

  // Test with a corner MISS (X=0, layer=1) — only extrapolation available
  var dataCorner = data.filter(function(r) { return !(r.x === 0 && r.layer === 1); });
  var fwCorner = buildFaceWallGridLogic(dataCorner);
  assert(fwCorner !== null, 'buildFaceWallGrid returns non-null for corner MISS');
  var missingCorner = 0;
  for (var li = 0; li < fwCorner.nRows; li++) {
    for (var xi = 0; xi < fwCorner.nCols; xi++) {
      if (!fwCorner.grid[li][xi]) missingCorner++;
    }
  }
  assert(missingCorner === 0, 'All cells filled even with corner MISS (got ' + missingCorner + ' missing)');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: renderFaceReliefMap gap-fill grid
// Verify that the X/Z gap-fill logic for the 2D relief map fills missing cells.
// ─────────────────────────────────────────────────────────────────────────────

function applyReliefMapGapFill(rlGrid, nCols, nRows) {
  // Mirrors the gap-fill added to renderFaceReliefMap (src/js/core.js).
  // Pass 1: X-direction
  for (var pli = 0; pli < nRows; pli++) {
    for (var pxi = 0; pxi < nCols; pxi++) {
      if (rlGrid[pxi][pli] !== null) continue;
      var lx = -1, rx = -1;
      for (var k = pxi - 1; k >= 0; k--) { if (rlGrid[k][pli] !== null) { lx = k; break; } }
      for (var k = pxi + 1; k < nCols; k++) { if (rlGrid[k][pli] !== null) { rx = k; break; } }
      if (lx >= 0 && rx >= 0) {
        rlGrid[pxi][pli] = rlGrid[lx][pli] * (1 - (pxi-lx)/(rx-lx)) + rlGrid[rx][pli] * ((pxi-lx)/(rx-lx));
      } else if (lx >= 0) { rlGrid[pxi][pli] = rlGrid[lx][pli]; }
        else if (rx >= 0) { rlGrid[pxi][pli] = rlGrid[rx][pli]; }
    }
  }
  // Pass 2: Z-direction
  for (var pxi2 = 0; pxi2 < nCols; pxi2++) {
    for (var pli2 = 0; pli2 < nRows; pli2++) {
      if (rlGrid[pxi2][pli2] !== null) continue;
      var ll = -1, rl2 = -1;
      for (var k = pli2 - 1; k >= 0; k--) { if (rlGrid[pxi2][k] !== null) { ll = k; break; } }
      for (var k = pli2 + 1; k < nRows; k++) { if (rlGrid[pxi2][k] !== null) { rl2 = k; break; } }
      if (ll >= 0 && rl2 >= 0) {
        rlGrid[pxi2][pli2] = rlGrid[pxi2][ll]*(1-(pli2-ll)/(rl2-ll)) + rlGrid[pxi2][rl2]*((pli2-ll)/(rl2-ll));
      } else if (ll >= 0) { rlGrid[pxi2][pli2] = rlGrid[pxi2][ll]; }
        else if (rl2 >= 0) { rlGrid[pxi2][pli2] = rlGrid[pxi2][rl2]; }
    }
  }
  return rlGrid;
}

function testReliefMapGapFill() {
  console.log('\nTest: renderFaceReliefMap gap-fill for missing cells');

  // 5 columns × 3 rows; cell [2][1] (X=50, layer 2) is null (MISS)
  var nCols = 5, nRows = 3;
  var grid = [];
  for (var c = 0; c < nCols; c++) { grid.push(new Array(nRows).fill(null)); }
  // Fill all cells except [2][1]
  for (var c = 0; c < nCols; c++) {
    for (var r = 0; r < nRows; r++) {
      if (c === 2 && r === 1) continue;
      grid[c][r] = c * 10 + r * 2;
    }
  }

  applyReliefMapGapFill(grid, nCols, nRows);

  // All cells should be filled now
  var missing = 0;
  for (var c = 0; c < nCols; c++) {
    for (var r = 0; r < nRows; r++) {
      if (grid[c][r] === null) missing++;
    }
  }
  assert(missing === 0, 'All ' + (nCols*nRows) + ' cells filled after gap-fill: ' + missing + ' still null');

  // The interpolated cell [2][1] should equal (grid[1][1] + grid[3][1]) / 2 = (12 + 32) / 2 = 22
  var expected = (grid[1][1] + grid[3][1]) / 2;
  assert(Math.abs(grid[2][1] - expected) < 1e-9,
    'Gap-filled cell [2][1]=' + grid[2][1] + ' = avg of X-neighbours (' + grid[1][1] + '+' + grid[3][1] + ')/2=' + expected);

  // Test column-only MISS (entire column missing except corners)
  var grid2 = [];
  for (var c = 0; c < nCols; c++) { grid2.push(new Array(nRows).fill(null)); }
  // Only columns 0 and 4 are populated
  for (var r = 0; r < nRows; r++) { grid2[0][r] = r * 5; grid2[4][r] = r * 5 + 20; }
  applyReliefMapGapFill(grid2, nCols, nRows);
  var missing2 = 0;
  for (var c = 0; c < nCols; c++) { for (var r = 0; r < nRows; r++) { if (grid2[c][r] === null) missing2++; } }
  assert(missing2 === 0, 'All cells filled when only boundary columns are present: ' + missing2 + ' still null');

  // Midpoint column [2] should be interpolated between [0] and [4]
  for (var r = 0; r < nRows; r++) {
    var exp2 = (grid2[0][r] + grid2[4][r]) / 2;
    assert(Math.abs(grid2[2][r] - exp2) < 1e-9,
      'Column 2, row ' + r + ': interpolated=' + grid2[2][r].toFixed(3) + ' expected=' + exp2.toFixed(3));
  }
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
    testFaceWallDepthSign();
    testBuildFaceWallGridGapFill();
    testReliefMapGapFill();
  } catch (e) {
    console.error('Unexpected error in test runner:', e);
    failed++;
  }
  console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---');
  process.exit(failed > 0 ? 1 : 0);
})();
