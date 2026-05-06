/**
 * Unit tests for Z interpolation logic (index.js interpolateZ function).
 *
 * Validates that:
 *  1. Standard 2D bilinear interpolation works correctly
 *  2. Single-row (1×N) linear interpolation works
 *  3. Single-column (N×1) linear interpolation works
 *  4. Single-point grid returns that point's Z value
 *  5. Boundary clamping works for points outside the grid
 *  6. Exact probe point lookup (no interpolation needed)
 *  7. Edge cases: zero spacing, missing data points
 *  8. Interpolation at grid cell corners and centers
 *
 * Run with:  node test/index-interpolation.test.js
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

// ── Mock implementation of interpolateZ ──────────────────────────────────────
// Inline the function from index.js for testing without requiring ESM module

function interpolateZ(x, y, mesh, gridParams) {
  const { startX, startY, spacingX, spacingY, rows, cols } = gridParams;

  // Single column (Nx1): linear interpolation in Y only
  if (cols === 1) {
    if (rows === 1) return mesh[0][0]?.z ?? 0;
    const rowFloat = spacingY > 0 ? (y - startY) / spacingY : 0;
    const row = Math.max(0, Math.min(rows - 2, Math.floor(rowFloat)));
    const z0 = mesh[row][0]?.z ?? 0;
    const z1 = mesh[row + 1]?.[0]?.z ?? z0;
    const ty = Math.max(0, Math.min(1, rowFloat - row));
    return z0 * (1 - ty) + z1 * ty;
  }

  // Single row (1xN): linear interpolation in X only
  if (rows === 1) {
    const colFloat = spacingX > 0 ? (x - startX) / spacingX : 0;
    const col = Math.max(0, Math.min(cols - 2, Math.floor(colFloat)));
    const z0 = mesh[0][col]?.z ?? 0;
    const z1 = mesh[0][col + 1]?.z ?? z0;
    const tx = Math.max(0, Math.min(1, colFloat - col));
    return z0 * (1 - tx) + z1 * tx;
  }

  // Standard bilinear interpolation for 2D grid
  const colFloat = (x - startX) / spacingX;
  const rowFloat = (y - startY) / spacingY;

  const col = Math.max(0, Math.min(cols - 2, Math.floor(colFloat)));
  const row = Math.max(0, Math.min(rows - 2, Math.floor(rowFloat)));

  const z00 = mesh[row][col]?.z ?? 0;
  const z10 = mesh[row][col + 1]?.z ?? z00;
  const z01 = mesh[row + 1]?.[col]?.z ?? z00;
  const z11 = mesh[row + 1]?.[col + 1]?.z ?? z00;

  const tx = Math.max(0, Math.min(1, colFloat - col));
  const ty = Math.max(0, Math.min(1, rowFloat - row));

  return z00 * (1 - tx) * (1 - ty) + z10 * tx * (1 - ty) + z01 * (1 - tx) * ty + z11 * tx * ty;
}

// ── Test 1: Standard 2D bilinear interpolation ──────────────────────────────

function testStandard2DBilinearInterpolation() {
  console.log('\nTest: Standard 2D bilinear interpolation');

  // 3x3 grid: 0,0 to 20,20 with 10mm spacing
  // Z values:
  //   [0,0]=0  [10,0]=1  [20,0]=2
  //   [0,10]=3 [10,10]=4 [20,10]=5
  //   [0,20]=6 [10,20]=7 [20,20]=8

  const mesh = [
    [{ z: 0 }, { z: 1 }, { z: 2 }],
    [{ z: 3 }, { z: 4 }, { z: 5 }],
    [{ z: 6 }, { z: 7 }, { z: 8 }]
  ];

  const gridParams = {
    startX: 0,
    startY: 0,
    spacingX: 10,
    spacingY: 10,
    rows: 3,
    cols: 3
  };

  // Test exact probe points
  assertClose(interpolateZ(0, 0, mesh, gridParams), 0, 0.001, 'Exact point [0,0] should be 0');
  assertClose(interpolateZ(10, 10, mesh, gridParams), 4, 0.001, 'Exact point [10,10] should be 4');
  assertClose(interpolateZ(20, 20, mesh, gridParams), 8, 0.001, 'Exact point [20,20] should be 8');

  // Test interpolation at cell center (5,5) between corners 0,1,3,4
  // Expected: (0+1+3+4)/4 = 2.0
  assertClose(interpolateZ(5, 5, mesh, gridParams), 2.0, 0.001, 'Center of first cell [5,5] should be 2.0');

  // Test interpolation at (15,5) - 75% along X in first row
  // Between z=1 (10,0), z=2 (20,0), z=4 (10,10), z=5 (20,10)
  // At tx=0.5, ty=0.5: (1+2+4+5)/4 = 3.0
  assertClose(interpolateZ(15, 5, mesh, gridParams), 3.0, 0.001, 'Point [15,5] should be 3.0');
}

// ── Test 2: Single-row (1×N) linear interpolation ───────────────────────────

function testSingleRowLinearInterpolation() {
  console.log('\nTest: Single-row (1×N) linear interpolation in X only');

  // 1x5 grid: X from 0 to 40 with 10mm spacing, single row
  const mesh = [
    [{ z: 0 }, { z: 10 }, { z: 20 }, { z: 30 }, { z: 40 }]
  ];

  const gridParams = {
    startX: 0,
    startY: 0,
    spacingX: 10,
    spacingY: 0,
    rows: 1,
    cols: 5
  };

  // Test exact points
  assertClose(interpolateZ(0, 0, mesh, gridParams), 0, 0.001, 'Exact point X=0 should be 0');
  assertClose(interpolateZ(40, 0, mesh, gridParams), 40, 0.001, 'Exact point X=40 should be 40');

  // Test interpolation at midpoint X=5 (between 0 and 10)
  assertClose(interpolateZ(5, 0, mesh, gridParams), 5, 0.001, 'Midpoint X=5 should be 5');

  // Test interpolation at X=25 (between 20 and 30)
  assertClose(interpolateZ(25, 0, mesh, gridParams), 25, 0.001, 'Point X=25 should be 25');

  // Y coordinate should be ignored in single-row grid
  assertClose(interpolateZ(15, 100, mesh, gridParams), 15, 0.001, 'Y coordinate should be ignored');
}

// ── Test 3: Single-column (N×1) linear interpolation ────────────────────────

function testSingleColumnLinearInterpolation() {
  console.log('\nTest: Single-column (N×1) linear interpolation in Y only');

  // 5x1 grid: Y from 0 to 40 with 10mm spacing, single column
  const mesh = [
    [{ z: 0 }],
    [{ z: 10 }],
    [{ z: 20 }],
    [{ z: 30 }],
    [{ z: 40 }]
  ];

  const gridParams = {
    startX: 0,
    startY: 0,
    spacingX: 0,
    spacingY: 10,
    rows: 5,
    cols: 1
  };

  // Test exact points
  assertClose(interpolateZ(0, 0, mesh, gridParams), 0, 0.001, 'Exact point Y=0 should be 0');
  assertClose(interpolateZ(0, 40, mesh, gridParams), 40, 0.001, 'Exact point Y=40 should be 40');

  // Test interpolation at midpoint Y=5 (between 0 and 10)
  assertClose(interpolateZ(0, 5, mesh, gridParams), 5, 0.001, 'Midpoint Y=5 should be 5');

  // Test interpolation at Y=35 (between 30 and 40)
  assertClose(interpolateZ(0, 35, mesh, gridParams), 35, 0.001, 'Point Y=35 should be 35');

  // X coordinate should be ignored in single-column grid
  assertClose(interpolateZ(100, 15, mesh, gridParams), 15, 0.001, 'X coordinate should be ignored');
}

// ── Test 4: Single-point grid ───────────────────────────────────────────────

function testSinglePointGrid() {
  console.log('\nTest: Single-point grid returns that point\'s Z value');

  const mesh = [
    [{ z: 42.5 }]
  ];

  const gridParams = {
    startX: 10,
    startY: 20,
    spacingX: 0,
    spacingY: 0,
    rows: 1,
    cols: 1
  };

  // Any query should return the single point's Z value
  assertClose(interpolateZ(10, 20, mesh, gridParams), 42.5, 0.001, 'At grid point should be 42.5');
  assertClose(interpolateZ(0, 0, mesh, gridParams), 42.5, 0.001, 'Outside grid should still be 42.5');
  assertClose(interpolateZ(100, 100, mesh, gridParams), 42.5, 0.001, 'Far outside should still be 42.5');
}

// ── Test 5: Boundary clamping for points outside grid ───────────────────────

function testBoundaryClamping() {
  console.log('\nTest: Boundary clamping for points outside the grid');

  // 2x2 grid from (0,0) to (10,10)
  const mesh = [
    [{ z: 1 }, { z: 2 }],
    [{ z: 3 }, { z: 4 }]
  ];

  const gridParams = {
    startX: 0,
    startY: 0,
    spacingX: 10,
    spacingY: 10,
    rows: 2,
    cols: 2
  };

  // Point before grid start should clamp to first cell
  const zBeforeStart = interpolateZ(-5, -5, mesh, gridParams);
  assertClose(zBeforeStart, 1, 0.001, 'Point before grid should clamp to corner [0,0]=1');

  // Point beyond grid end should clamp to last cell
  const zBeyondEnd = interpolateZ(20, 20, mesh, gridParams);
  assertClose(zBeyondEnd, 4, 0.001, 'Point beyond grid should clamp to corner [10,10]=4');

  // Point beyond X but within Y
  const zBeyondX = interpolateZ(20, 5, mesh, gridParams);
  // Clamped to last column, interpolates between z=2 and z=4
  assertClose(zBeyondX, 3, 0.001, 'Point beyond X should clamp and interpolate Y');
}

// ── Test 6: Exact probe point lookup (no interpolation) ─────────────────────

function testExactProbePointLookup() {
  console.log('\nTest: Exact probe point lookup returns exact Z without interpolation');

  // 4x4 grid with non-uniform Z values
  const mesh = [
    [{ z: 1.1 }, { z: 2.2 }, { z: 3.3 }, { z: 4.4 }],
    [{ z: 5.5 }, { z: 6.6 }, { z: 7.7 }, { z: 8.8 }],
    [{ z: 9.9 }, { z: 10.1 }, { z: 11.2 }, { z: 12.3 }],
    [{ z: 13.4 }, { z: 14.5 }, { z: 15.6 }, { z: 16.7 }]
  ];

  const gridParams = {
    startX: 0,
    startY: 0,
    spacingX: 5,
    spacingY: 5,
    rows: 4,
    cols: 4
  };

  // Test all corner points
  assertClose(interpolateZ(0, 0, mesh, gridParams), 1.1, 0.001, 'Corner [0,0] exact');
  assertClose(interpolateZ(15, 0, mesh, gridParams), 4.4, 0.001, 'Corner [15,0] exact');
  assertClose(interpolateZ(0, 15, mesh, gridParams), 13.4, 0.001, 'Corner [0,15] exact');
  assertClose(interpolateZ(15, 15, mesh, gridParams), 16.7, 0.001, 'Corner [15,15] exact');

  // Test center point
  assertClose(interpolateZ(10, 10, mesh, gridParams), 11.2, 0.001, 'Center [10,10] exact');
}

// ── Test 7: Edge cases with missing data points ─────────────────────────────

function testMissingDataPoints() {
  console.log('\nTest: Missing data points use fallback values');

  // 2x2 grid with one missing point (undefined)
  const mesh = [
    [{ z: 1 }, { z: 2 }],
    [{ z: 3 }, undefined]  // Missing [1,1]
  ];

  const gridParams = {
    startX: 0,
    startY: 0,
    spacingX: 10,
    spacingY: 10,
    rows: 2,
    cols: 2
  };

  // Point at [5,5] should interpolate with missing point
  const z = interpolateZ(5, 5, mesh, gridParams);
  // Corners: z00=1, z10=2, z01=3, z11=undefined→z00=1 (fallback to z00)
  // At center: (1+2+3+1)/4 = 1.75
  assertClose(z, 1.75, 0.001, 'Missing point should fall back to z00');
}

// ── Test 8: Zero spacing edge case ──────────────────────────────────────────

function testZeroSpacing() {
  console.log('\nTest: Zero spacing in single row/column grids');

  // Single row with zero Y spacing
  const meshRow = [
    [{ z: 5 }, { z: 10 }, { z: 15 }]
  ];

  const gridParamsRow = {
    startX: 0,
    startY: 0,
    spacingX: 10,
    spacingY: 0,
    rows: 1,
    cols: 3
  };

  assertClose(interpolateZ(5, 0, meshRow, gridParamsRow), 7.5, 0.001, 'Single row with zero Y spacing works');

  // Single column with zero X spacing
  const meshCol = [
    [{ z: 5 }],
    [{ z: 10 }],
    [{ z: 15 }]
  ];

  const gridParamsCol = {
    startX: 0,
    startY: 0,
    spacingX: 0,
    spacingY: 10,
    rows: 3,
    cols: 1
  };

  assertClose(interpolateZ(0, 5, meshCol, gridParamsCol), 7.5, 0.001, 'Single column with zero X spacing works');
}

// ── Test 9: Non-zero grid origin ────────────────────────────────────────────

function testNonZeroGridOrigin() {
  console.log('\nTest: Grid with non-zero origin coordinates');

  // 2x2 grid starting at (50, 100)
  const mesh = [
    [{ z: 10 }, { z: 20 }],
    [{ z: 30 }, { z: 40 }]
  ];

  const gridParams = {
    startX: 50,
    startY: 100,
    spacingX: 10,
    spacingY: 10,
    rows: 2,
    cols: 2
  };

  assertClose(interpolateZ(50, 100, mesh, gridParams), 10, 0.001, 'Origin point [50,100] should be 10');
  assertClose(interpolateZ(60, 110, mesh, gridParams), 40, 0.001, 'Far corner [60,110] should be 40');
  assertClose(interpolateZ(55, 105, mesh, gridParams), 25, 0.001, 'Center [55,105] should be 25');
}

// ── Test 10: Asymmetric spacing ─────────────────────────────────────────────

function testAsymmetricSpacing() {
  console.log('\nTest: Grid with different X and Y spacing');

  // 2x3 grid with 10mm X spacing and 20mm Y spacing
  const mesh = [
    [{ z: 0 }, { z: 1 }],
    [{ z: 2 }, { z: 3 }],
    [{ z: 4 }, { z: 5 }]
  ];

  const gridParams = {
    startX: 0,
    startY: 0,
    spacingX: 10,
    spacingY: 20,
    rows: 3,
    cols: 2
  };

  // Test exact points
  assertClose(interpolateZ(0, 0, mesh, gridParams), 0, 0.001, 'Origin [0,0] should be 0');
  assertClose(interpolateZ(10, 40, mesh, gridParams), 5, 0.001, 'Corner [10,40] should be 5');

  // Test interpolation at (5, 10) - center of first cell
  assertClose(interpolateZ(5, 10, mesh, gridParams), 1.5, 0.001, 'Center of first cell should be 1.5');
}

// ── Run all tests ────────────────────────────────────────────────────────────

testStandard2DBilinearInterpolation();
testSingleRowLinearInterpolation();
testSingleColumnLinearInterpolation();
testSinglePointGrid();
testBoundaryClamping();
testExactProbePointLookup();
testMissingDataPoints();
testZeroSpacing();
testNonZeroGridOrigin();
testAsymmetricSpacing();

console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---');
process.exit(failed > 0 ? 1 : 0);
