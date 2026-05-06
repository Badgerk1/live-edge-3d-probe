/**
 * Unit tests for G-code bounds analysis (index.js analyzeGCodeBounds function).
 *
 * Validates that:
 *  1. Simple rectangular toolpath bounds are computed correctly
 *  2. G90/G91 mode switches are tracked correctly
 *  3. G53 machine coordinate moves are ignored
 *  4. Relative-mode incremental moves accumulate correctly
 *  5. Empty files or files with no motion return zero bounds
 *  6. Negative coordinates are handled correctly
 *  7. Comments and whitespace are properly ignored
 *  8. Mixed absolute/relative mode changes work correctly
 *
 * Run with:  node test/index-bounds-analysis.test.js
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

// ── Mock implementation of analyzeGCodeBounds ────────────────────────────────
// Inline the function from index.js for testing without requiring ESM module

function analyzeGCodeBounds(gcodeContent) {
  const bounds = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity }
  };

  let currentX = 0, currentY = 0, currentZ = 0;
  let isAbsolute = true;

  const lines = gcodeContent.split('\n');

  for (const line of lines) {
    const trimmed = line.trim().toUpperCase();

    if (trimmed.startsWith('(') || trimmed.startsWith(';') || trimmed.startsWith('%')) {
      continue;
    }

    if (trimmed.includes('G90') && !trimmed.includes('G90.1')) isAbsolute = true;
    if (trimmed.includes('G91') && !trimmed.includes('G91.1')) isAbsolute = false;

    if (trimmed.includes('G53')) continue;

    const xMatch = trimmed.match(/X([+-]?\d*\.?\d+)/);
    const yMatch = trimmed.match(/Y([+-]?\d*\.?\d+)/);
    const zMatch = trimmed.match(/Z([+-]?\d*\.?\d+)/);

    if (xMatch) {
      const val = parseFloat(xMatch[1]);
      currentX = isAbsolute ? val : currentX + val;
    }
    if (yMatch) {
      const val = parseFloat(yMatch[1]);
      currentY = isAbsolute ? val : currentY + val;
    }
    if (zMatch) {
      const val = parseFloat(zMatch[1]);
      currentZ = isAbsolute ? val : currentZ + val;
    }

    if (xMatch || yMatch || zMatch) {
      bounds.min.x = Math.min(bounds.min.x, currentX);
      bounds.min.y = Math.min(bounds.min.y, currentY);
      bounds.min.z = Math.min(bounds.min.z, currentZ);
      bounds.max.x = Math.max(bounds.max.x, currentX);
      bounds.max.y = Math.max(bounds.max.y, currentY);
      bounds.max.z = Math.max(bounds.max.z, currentZ);
    }
  }

  if (bounds.min.x === Infinity) bounds.min.x = 0;
  if (bounds.min.y === Infinity) bounds.min.y = 0;
  if (bounds.min.z === Infinity) bounds.min.z = 0;
  if (bounds.max.x === -Infinity) bounds.max.x = 0;
  if (bounds.max.y === -Infinity) bounds.max.y = 0;
  if (bounds.max.z === -Infinity) bounds.max.z = 0;

  return bounds;
}

// ── Test 1: Simple rectangular toolpath ──────────────────────────────────────

function testSimpleRectangularToolpath() {
  console.log('\nTest: Simple rectangular toolpath');

  const gcode = `
G90
G0 X0 Y0 Z5
G1 Z-1 F100
G1 X100
G1 Y50
G1 X0
G1 Y0
G0 Z5
  `.trim();

  const bounds = analyzeGCodeBounds(gcode);

  assertClose(bounds.min.x, 0, 0.001, 'Min X should be 0');
  assertClose(bounds.max.x, 100, 0.001, 'Max X should be 100');
  assertClose(bounds.min.y, 0, 0.001, 'Min Y should be 0');
  assertClose(bounds.max.y, 50, 0.001, 'Max Y should be 50');
  assertClose(bounds.min.z, -1, 0.001, 'Min Z should be -1');
  assertClose(bounds.max.z, 5, 0.001, 'Max Z should be 5');
}

// ── Test 2: G90/G91 mode switches ────────────────────────────────────────────

function testAbsoluteRelativeModeSwitches() {
  console.log('\nTest: G90/G91 mode switches');

  const gcode = `
G90
G0 X10 Y10
G91
G1 X5 Y5
G1 X5 Y5
G90
G1 X0 Y0
  `.trim();

  const bounds = analyzeGCodeBounds(gcode);

  // Absolute: X10 Y10
  // Relative: X15 Y15 (10+5, 10+5)
  // Relative: X20 Y20 (15+5, 15+5)
  // Absolute: X0 Y0

  assertClose(bounds.min.x, 0, 0.001, 'Min X should be 0');
  assertClose(bounds.max.x, 20, 0.001, 'Max X should be 20 (from relative moves)');
  assertClose(bounds.min.y, 0, 0.001, 'Min Y should be 0');
  assertClose(bounds.max.y, 20, 0.001, 'Max Y should be 20 (from relative moves)');
}

// ── Test 3: G53 machine coordinate moves ─────────────────────────────────────

function testMachineCoordinateMovesIgnored() {
  console.log('\nTest: G53 machine coordinate moves should be ignored');

  const gcode = `
G90
G0 X10 Y10 Z5
G53 G0 Z0
G1 X20 Y20
  `.trim();

  const bounds = analyzeGCodeBounds(gcode);

  // G53 Z0 should be ignored
  assertClose(bounds.min.x, 10, 0.001, 'Min X should be 10');
  assertClose(bounds.max.x, 20, 0.001, 'Max X should be 20');
  assertClose(bounds.min.z, 5, 0.001, 'Min Z should be 5 (G53 Z0 ignored)');
  assertClose(bounds.max.z, 5, 0.001, 'Max Z should be 5 (G53 Z0 ignored)');
}

// ── Test 4: Relative-mode incremental moves ──────────────────────────────────

function testRelativeModeIncrementalMoves() {
  console.log('\nTest: Relative-mode incremental moves accumulate correctly');

  const gcode = `
G91
G1 X10
G1 X10
G1 X-5
G1 Y20
G1 Y-10
  `.trim();

  const bounds = analyzeGCodeBounds(gcode);

  // Starts at (0,0), but first move goes to (10,0), so min X is 0 before that move
  // However, bounds are only updated when coordinates change, so:
  // X10 -> (10,0) - first recorded position
  // X10 -> (20,0)
  // X-5 -> (15,0)
  // Y20 -> (15,20)
  // Y-10 -> (15,10)
  // The initial (0,0) position is never explicitly moved to, so it's not in bounds

  assertClose(bounds.min.x, 10, 0.001, 'Min X should be 10 (first move from origin)');
  assertClose(bounds.max.x, 20, 0.001, 'Max X should be 20');
  assertClose(bounds.min.y, 0, 0.001, 'Min Y should be 0');
  assertClose(bounds.max.y, 20, 0.001, 'Max Y should be 20');
}

// ── Test 5: Empty file or no motion commands ─────────────────────────────────

function testEmptyFileOrNoMotion() {
  console.log('\nTest: Empty file or file with no motion commands returns zero bounds');

  const emptyGcode = '';
  const bounds1 = analyzeGCodeBounds(emptyGcode);

  assertClose(bounds1.min.x, 0, 0.001, 'Empty file: Min X should be 0');
  assertClose(bounds1.max.x, 0, 0.001, 'Empty file: Max X should be 0');

  const commentsOnlyGcode = `
(This is a comment)
; This is also a comment
% Program header
  `.trim();

  const bounds2 = analyzeGCodeBounds(commentsOnlyGcode);

  assertClose(bounds2.min.x, 0, 0.001, 'Comments only: Min X should be 0');
  assertClose(bounds2.max.x, 0, 0.001, 'Comments only: Max X should be 0');
  assertClose(bounds2.min.y, 0, 0.001, 'Comments only: Min Y should be 0');
  assertClose(bounds2.max.y, 0, 0.001, 'Comments only: Max Y should be 0');
}

// ── Test 6: Negative coordinates ─────────────────────────────────────────────

function testNegativeCoordinates() {
  console.log('\nTest: Negative coordinates are handled correctly');

  const gcode = `
G90
G0 X-10 Y-20 Z-5
G1 X10 Y20 Z5
  `.trim();

  const bounds = analyzeGCodeBounds(gcode);

  assertClose(bounds.min.x, -10, 0.001, 'Min X should be -10');
  assertClose(bounds.max.x, 10, 0.001, 'Max X should be 10');
  assertClose(bounds.min.y, -20, 0.001, 'Min Y should be -20');
  assertClose(bounds.max.y, 20, 0.001, 'Max Y should be 20');
  assertClose(bounds.min.z, -5, 0.001, 'Min Z should be -5');
  assertClose(bounds.max.z, 5, 0.001, 'Max Z should be 5');
}

// ── Test 7: Comments and whitespace ──────────────────────────────────────────

function testCommentsAndWhitespace() {
  console.log('\nTest: Comments and whitespace are properly ignored');

  const gcode = `
(Program start)
; Move to position
G90
  G0 X10 Y10
(Cut)
G1 Z-1 F100
G1 X20 (to the right)
; End
  `.trim();

  const bounds = analyzeGCodeBounds(gcode);

  assertClose(bounds.min.x, 10, 0.001, 'Min X should be 10');
  assertClose(bounds.max.x, 20, 0.001, 'Max X should be 20');
  assertClose(bounds.min.y, 10, 0.001, 'Min Y should be 10');
  assertClose(bounds.max.y, 10, 0.001, 'Max Y should be 10');
}

// ── Test 8: Mixed absolute/relative with Z moves ─────────────────────────────

function testMixedAbsoluteRelativeWithZ() {
  console.log('\nTest: Mixed absolute/relative mode changes work correctly');

  const gcode = `
G90
G0 X0 Y0 Z10
G91
G1 Z-5
G1 X10
G90
G1 Z2
G91
G1 Y5
G90
G1 X5 Y5
  `.trim();

  const bounds = analyzeGCodeBounds(gcode);

  // G90: (0,0,10)
  // G91 Z-5: (0,0,5)
  // G91 X10: (10,0,5)
  // G90 Z2: (10,0,2)
  // G91 Y5: (10,5,2)
  // G90 X5 Y5: (5,5,2)

  assertClose(bounds.min.x, 0, 0.001, 'Min X should be 0');
  assertClose(bounds.max.x, 10, 0.001, 'Max X should be 10');
  assertClose(bounds.min.y, 0, 0.001, 'Min Y should be 0');
  assertClose(bounds.max.y, 5, 0.001, 'Max Y should be 5');
  assertClose(bounds.min.z, 2, 0.001, 'Min Z should be 2');
  assertClose(bounds.max.z, 10, 0.001, 'Max Z should be 10');
}

// ── Test 9: G90.1 and G91.1 arc mode commands should not affect absolute/relative ──

function testArcModeCommandsIgnored() {
  console.log('\nTest: G90.1 and G91.1 arc commands should not affect linear mode');

  const gcode = `
G90
G0 X10 Y10
G91.1
G1 X20 Y20
G90.1
G1 X30 Y30
  `.trim();

  const bounds = analyzeGCodeBounds(gcode);

  // G91.1 and G90.1 are arc plane modes and should not switch linear mode
  // Should stay in G90 absolute mode for all linear moves
  assertClose(bounds.min.x, 10, 0.001, 'Min X should be 10');
  assertClose(bounds.max.x, 30, 0.001, 'Max X should be 30 (absolute mode maintained)');
  assertClose(bounds.min.y, 10, 0.001, 'Min Y should be 10');
  assertClose(bounds.max.y, 30, 0.001, 'Max Y should be 30 (absolute mode maintained)');
}

// ── Test 10: Decimal and precision handling ──────────────────────────────────

function testDecimalAndPrecision() {
  console.log('\nTest: Decimal coordinates are handled with precision');

  const gcode = `
G90
G0 X1.234 Y5.678 Z-2.345
G1 X99.999 Y100.001 Z0.001
  `.trim();

  const bounds = analyzeGCodeBounds(gcode);

  assertClose(bounds.min.x, 1.234, 0.001, 'Min X should be 1.234');
  assertClose(bounds.max.x, 99.999, 0.001, 'Max X should be 99.999');
  assertClose(bounds.min.y, 5.678, 0.001, 'Min Y should be 5.678');
  assertClose(bounds.max.y, 100.001, 0.001, 'Max Y should be 100.001');
  assertClose(bounds.min.z, -2.345, 0.001, 'Min Z should be -2.345');
  assertClose(bounds.max.z, 0.001, 0.001, 'Max Z should be 0.001');
}

// ── Run all tests ────────────────────────────────────────────────────────────

testSimpleRectangularToolpath();
testAbsoluteRelativeModeSwitches();
testMachineCoordinateMovesIgnored();
testRelativeModeIncrementalMoves();
testEmptyFileOrNoMotion();
testNegativeCoordinates();
testCommentsAndWhitespace();
testMixedAbsoluteRelativeWithZ();
testArcModeCommandsIgnored();
testDecimalAndPrecision();

console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---');
process.exit(failed > 0 ? 1 : 0);
