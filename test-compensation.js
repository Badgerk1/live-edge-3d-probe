/**
 * test-compensation.js
 * Node.js test script for the Z compensation engine.
 *
 * Run with:  node test-compensation.js
 *
 * Tests:
 *  1. analyzeGCodeBounds — bounds detection, G90/G91, G53 passthrough
 *  2. interpolateZ       — single point, single row, single col, bilinear
 *  3. applyZCompensation — G53 passthrough, Z-only, G0 rapid, G1 subdivision,
 *                          G1 short move, G2 arc passthrough, G91 incremental
 */

// ── Inline the engine functions so the test runs without a bundler ────────────

function analyzeGCodeBounds(gcodeContent) {
  const bounds = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity }
  };
  let currentX = 0, currentY = 0, currentZ = 0;
  let isAbsolute = true;
  for (const line of gcodeContent.split('\n')) {
    const trimmed = line.trim().toUpperCase();
    if (!trimmed || trimmed.startsWith('(') || trimmed.startsWith(';') || trimmed.startsWith('%')) continue;
    if (trimmed.includes('G90') && !trimmed.includes('G90.1')) isAbsolute = true;
    if (trimmed.includes('G91') && !trimmed.includes('G91.1')) isAbsolute = false;
    if (trimmed.includes('G53')) continue;
    const xMatch = trimmed.match(/X([+-]?\d*\.?\d+)/);
    const yMatch = trimmed.match(/Y([+-]?\d*\.?\d+)/);
    const zMatch = trimmed.match(/Z([+-]?\d*\.?\d+)/);
    if (xMatch) { const v = parseFloat(xMatch[1]); currentX = isAbsolute ? v : currentX + v; }
    if (yMatch) { const v = parseFloat(yMatch[1]); currentY = isAbsolute ? v : currentY + v; }
    if (zMatch) { const v = parseFloat(zMatch[1]); currentZ = isAbsolute ? v : currentZ + v; }
    if (xMatch || yMatch || zMatch) {
      bounds.min.x = Math.min(bounds.min.x, currentX); bounds.min.y = Math.min(bounds.min.y, currentY); bounds.min.z = Math.min(bounds.min.z, currentZ);
      bounds.max.x = Math.max(bounds.max.x, currentX); bounds.max.y = Math.max(bounds.max.y, currentY); bounds.max.z = Math.max(bounds.max.z, currentZ);
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

function interpolateZ(x, y, mesh, gridParams) {
  const { startX, startY, spacingX, spacingY, rows, cols } = gridParams;
  if (cols === 1) {
    if (rows === 1) return mesh[0][0]?.z ?? 0;
    const rowFloat = spacingY > 0 ? (y - startY) / spacingY : 0;
    const row = Math.max(0, Math.min(rows - 2, Math.floor(rowFloat)));
    const z0 = mesh[row][0]?.z ?? 0;
    const z1 = mesh[row + 1]?.[0]?.z ?? z0;
    const ty = Math.max(0, Math.min(1, rowFloat - row));
    return z0 * (1 - ty) + z1 * ty;
  }
  if (rows === 1) {
    const colFloat = spacingX > 0 ? (x - startX) / spacingX : 0;
    const col = Math.max(0, Math.min(cols - 2, Math.floor(colFloat)));
    const z0 = mesh[0][col]?.z ?? 0;
    const z1 = mesh[0][col + 1]?.z ?? z0;
    const tx = Math.max(0, Math.min(1, colFloat - col));
    return z0 * (1 - tx) + z1 * tx;
  }
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

function applyZCompensation(gcodeContent, mesh, gridParams, referenceZ) {
  const lines = gcodeContent.split('\n');
  const output = [];
  let currentX = 0, currentY = 0, currentZ = 0;
  let isAbsolute = true;
  let currentFeedRate = null;
  let currentGMode = 'G1';
  const segmentLength = Math.min(gridParams.spacingX || 10, gridParams.spacingY || 10, 2);
  output.push('(Z-Compensated G-code — 3D Live Edge Mesh Combined Plugin)');
  output.push(`(Grid: ${gridParams.cols} x ${gridParams.rows} points)`);
  output.push(`(Reference Z: ${referenceZ.toFixed(3)})`);
  output.push(`(Segment length: ${segmentLength.toFixed(2)}mm)`);
  output.push('');
  for (const line of lines) {
    const trimmed = line.trim().toUpperCase();
    if (!trimmed || trimmed.startsWith('(') || trimmed.startsWith(';') || trimmed.startsWith('%')) { output.push(line); continue; }
    if (trimmed.includes('G90') && !trimmed.includes('G90.1')) isAbsolute = true;
    if (trimmed.includes('G91') && !trimmed.includes('G91.1')) isAbsolute = false;
    if (trimmed.includes('G53')) { output.push(line); continue; }
    if (trimmed.match(/^G0\b/) || trimmed.includes(' G0 ') || trimmed.endsWith(' G0')) currentGMode = 'G0';
    if (trimmed.match(/^G1\b/) || trimmed.includes(' G1 ') || trimmed.endsWith(' G1')) currentGMode = 'G1';
    if (trimmed.match(/^G2\b/) || trimmed.includes(' G2 ')) currentGMode = 'G2';
    if (trimmed.match(/^G3\b/) || trimmed.includes(' G3 ')) currentGMode = 'G3';
    const xMatch = line.match(/X([+-]?\d*\.?\d+)/i);
    const yMatch = line.match(/Y([+-]?\d*\.?\d+)/i);
    const zMatch = line.match(/Z([+-]?\d*\.?\d+)/i);
    const fMatch = line.match(/F([+-]?\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);
    let targetX = currentX, targetY = currentY, targetZ = currentZ;
    if (xMatch) targetX = isAbsolute ? parseFloat(xMatch[1]) : currentX + parseFloat(xMatch[1]);
    if (yMatch) targetY = isAbsolute ? parseFloat(yMatch[1]) : currentY + parseFloat(yMatch[1]);
    if (zMatch) targetZ = isAbsolute ? parseFloat(zMatch[1]) : currentZ + parseFloat(zMatch[1]);
    const isLinearMove = currentGMode === 'G1';
    const isRapidMove  = currentGMode === 'G0';
    const hasXY = xMatch || yMatch;
    const hasZ  = zMatch !== null;
    if (isLinearMove && hasXY && isAbsolute) {
      const dx = targetX - currentX, dy = targetY - currentY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > segmentLength) {
        const segments = Math.ceil(distance / segmentLength);
        const dz = targetZ - currentZ;
        for (let i = 1; i <= segments; i++) {
          const t = i / segments;
          const segX = currentX + dx * t, segY = currentY + dy * t, segZ = currentZ + dz * t;
          const meshZ = interpolateZ(segX, segY, mesh, gridParams);
          const compensatedZ = segZ + (meshZ - referenceZ);
          let segCmd = `G1 X${segX.toFixed(3)} Y${segY.toFixed(3)} Z${compensatedZ.toFixed(3)}`;
          if (i === 1 && currentFeedRate) segCmd += ` F${currentFeedRate.toFixed(0)}`;
          output.push(segCmd);
        }
      } else {
        const meshZ = interpolateZ(targetX, targetY, mesh, gridParams);
        const compensatedZ = targetZ + (meshZ - referenceZ);
        if (hasZ) {
          output.push(line.replace(/Z([+-]?\d*\.?\d+)/i, `Z${compensatedZ.toFixed(3)}`));
        } else {
          let newLine = line.trim();
          if (currentFeedRate && newLine.match(/F[\d.]+/i)) {
            newLine = newLine.replace(/(F[\d.]+)/i, `Z${compensatedZ.toFixed(3)} $1`);
          } else {
            newLine += ` Z${compensatedZ.toFixed(3)}`;
          }
          output.push(newLine);
        }
      }
    } else if (isRapidMove && hasXY && isAbsolute) {
      const meshZ = interpolateZ(targetX, targetY, mesh, gridParams);
      const compensatedZ = targetZ + (meshZ - referenceZ);
      if (hasZ) {
        output.push(line.replace(/Z([+-]?\d*\.?\d+)/i, `Z${compensatedZ.toFixed(3)}`));
      } else if (currentZ < 10) {
        output.push(line.trim() + ` Z${compensatedZ.toFixed(3)}`);
      } else {
        output.push(line);
      }
    } else if (hasZ && isAbsolute) {
      const meshZ = interpolateZ(targetX, targetY, mesh, gridParams);
      const compensatedZ = targetZ + (meshZ - referenceZ);
      output.push(line.replace(/Z([+-]?\d*\.?\d+)/i, `Z${compensatedZ.toFixed(3)}`));
    } else {
      output.push(line);
    }
    currentX = targetX; currentY = targetY; currentZ = targetZ;
  }
  return output.join('\n');
}

// ── Test helpers ──────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

function approx(a, b, tol = 0.001) {
  return Math.abs(a - b) <= tol;
}

// ── Build a 3×3 warped mesh ───────────────────────────────────────────────────
// gridParams: startX=0, startY=0, spacingX=10, spacingY=10, rows=3, cols=3
// mesh[row][col].z linearly rises from 0 at (0,0) to 1.0 at (20,20)
function makeTestMesh() {
  const gridParams = { startX: 0, startY: 0, spacingX: 10, spacingY: 10, rows: 3, cols: 3 };
  const mesh = [];
  for (let r = 0; r < 3; r++) {
    mesh.push([]);
    for (let c = 0; c < 3; c++) {
      const x = c * 10, y = r * 10;
      mesh[r].push({ x, y, z: (x + y) / 40 }); // z ramps from 0 → 1
    }
  }
  return { mesh, gridParams };
}

// ── Test 1: analyzeGCodeBounds ────────────────────────────────────────────────

console.log('\n── analyzeGCodeBounds ─────────────────────────────────────────');
{
  const gcode = `
G90
G0 X0 Y0 Z5
G1 X10 Y0 Z0 F300
G1 X10 Y10 Z-1
G1 X0 Y10 Z0
G1 X0 Y0 Z0
G0 Z5
`.trim();

  const b = analyzeGCodeBounds(gcode);
  assert(approx(b.min.x, 0), 'min X = 0');
  assert(approx(b.max.x, 10), 'max X = 10');
  assert(approx(b.min.y, 0), 'min Y = 0');
  assert(approx(b.max.y, 10), 'max Y = 10');
  assert(approx(b.min.z, -1), 'min Z = -1');
  assert(approx(b.max.z, 5), 'max Z = 5');
}

{
  // G53 machine moves should be skipped
  const gcode = `
G90
G53 X-100 Y-100 Z-100
G0 X5 Y5 Z3
`.trim();
  const b = analyzeGCodeBounds(gcode);
  assert(approx(b.min.x, 5), 'G53 skipped: min X = 5');
  assert(approx(b.max.z, 3), 'G53 skipped: max Z = 3');
}

{
  // G91 incremental mode
  const gcode = `
G91
G1 X5 Y0
G1 X5 Y5
`.trim();
  const b = analyzeGCodeBounds(gcode);
  assert(approx(b.max.x, 10), 'G91 incremental: max X = 10');
  assert(approx(b.max.y, 5), 'G91 incremental: max Y = 5');
}

{
  // Empty file should return zeros
  const b = analyzeGCodeBounds('');
  assert(approx(b.min.x, 0) && approx(b.max.x, 0), 'Empty file returns zero bounds');
}

// ── Test 2: interpolateZ ──────────────────────────────────────────────────────

console.log('\n── interpolateZ ───────────────────────────────────────────────');
{
  const { mesh, gridParams } = makeTestMesh();

  // Corner points should match exactly
  assert(approx(interpolateZ(0, 0, mesh, gridParams),   0),     'Corner (0,0) z=0');
  assert(approx(interpolateZ(20, 20, mesh, gridParams), 1),     'Corner (20,20) z=1');
  assert(approx(interpolateZ(20, 0, mesh, gridParams),  0.5),   'Corner (20,0) z=0.5');
  assert(approx(interpolateZ(0, 20, mesh, gridParams),  0.5),   'Corner (0,20) z=0.5');

  // Centre — bilinear of the four quadrant midpoints
  assert(approx(interpolateZ(10, 10, mesh, gridParams), 0.5),   'Centre (10,10) z=0.5');

  // Out-of-bounds clamped to mesh extents
  assert(approx(interpolateZ(-5, -5, mesh, gridParams), 0),     'Clamped below min: z=0');
  assert(approx(interpolateZ(25, 25, mesh, gridParams), 1),     'Clamped above max: z=1');
}

{
  // Single-point mesh (1×1)
  const mesh1x1 = [[{ x: 0, y: 0, z: 3.5 }]];
  const gp = { startX: 0, startY: 0, spacingX: 10, spacingY: 10, rows: 1, cols: 1 };
  assert(approx(interpolateZ(5, 5, mesh1x1, gp), 3.5), 'Single point 1×1 returns constant z');
}

{
  // Single-row mesh (1×3)
  const mesh1x3 = [[{ z: 0 }, { z: 1 }, { z: 2 }]];
  const gp = { startX: 0, startY: 0, spacingX: 10, spacingY: 10, rows: 1, cols: 3 };
  assert(approx(interpolateZ(5, 0, mesh1x3, gp), 0.5), 'Single row 1×3 midpoint z=0.5');
  assert(approx(interpolateZ(15, 0, mesh1x3, gp), 1.5), 'Single row 1×3 second midpoint z=1.5');
}

{
  // Single-column mesh (3×1)
  const mesh3x1 = [[{ z: 0 }], [{ z: 1 }], [{ z: 2 }]];
  const gp = { startX: 0, startY: 0, spacingX: 10, spacingY: 10, rows: 3, cols: 1 };
  assert(approx(interpolateZ(0, 5, mesh3x1, gp), 0.5), 'Single col 3×1 midpoint z=0.5');
  assert(approx(interpolateZ(0, 15, mesh3x1, gp), 1.5), 'Single col 3×1 second midpoint z=1.5');
}

// ── Test 3: applyZCompensation ────────────────────────────────────────────────

console.log('\n── applyZCompensation ─────────────────────────────────────────');
{
  // Flat mesh (all z=0) with referenceZ=0 — G-code should pass through unchanged (except header)
  const flatMesh = [[{ z: 0 }, { z: 0 }, { z: 0 }],
                    [{ z: 0 }, { z: 0 }, { z: 0 }],
                    [{ z: 0 }, { z: 0 }, { z: 0 }]];
  const gp = { startX: 0, startY: 0, spacingX: 10, spacingY: 10, rows: 3, cols: 3 };
  const gcode = 'G90\nG1 X5 Y5 Z-1 F300';
  const result = applyZCompensation(gcode, flatMesh, gp, 0);
  const lines = result.split('\n');
  // Find the compensated G1 line
  const g1Line = lines.find(l => /G1 X5/.test(l));
  assert(g1Line !== undefined, 'Flat mesh: G1 line present');
  if (g1Line) {
    const zm = g1Line.match(/Z([+-]?\d*\.?\d+)/i);
    assert(zm && approx(parseFloat(zm[1]), -1), 'Flat mesh: Z unchanged at -1');
  }
}

{
  // Z-only move — should be compensated at current XY position
  const { mesh, gridParams } = makeTestMesh(); // z ramps 0→1 over 20mm
  const gcode = 'G90\nG0 X10 Y10\nZ-2';
  const result = applyZCompensation(gcode, mesh, gridParams, 0);
  const lines = result.split('\n');
  // Match a bare Z-only move line (starts with Z, not a comment)
  const zLine = lines.find(l => /^Z[+-]?\d/.test(l.trim()));
  // At X=10, Y=10 mesh z = 0.5; offset = 0.5 - 0 = 0.5; compensated = -2 + 0.5 = -1.5
  if (zLine) {
    const zm = zLine.match(/Z([+-]?\d*\.?\d+)/i);
    assert(zm && approx(parseFloat(zm[1]), -1.5), 'Z-only move compensated: Z=-1.5');
  } else {
    assert(false, 'Z-only move line not found in output:\n' + result);
  }
}

{
  // G53 should pass through completely unchanged
  const { mesh, gridParams } = makeTestMesh();
  const gcode = 'G90\nG53 X0 Y0 Z-100';
  const result = applyZCompensation(gcode, mesh, gridParams, 0);
  assert(result.includes('G53 X0 Y0 Z-100'), 'G53 line passed through unchanged');
}

{
  // G2 arc move — should pass through with only endpoint Z compensated (no subdivision)
  const flatMesh = [[{ z: 0 }, { z: 0 }, { z: 0 }],
                    [{ z: 0 }, { z: 0 }, { z: 0 }],
                    [{ z: 0 }, { z: 0 }, { z: 0 }]];
  const gp = { startX: 0, startY: 0, spacingX: 10, spacingY: 10, rows: 3, cols: 3 };
  const gcode = 'G90\nG2 X10 Y10 I5 J0 Z0';
  const result = applyZCompensation(gcode, flatMesh, gp, 0);
  const g2Line = result.split('\n').find(l => /G2/.test(l));
  assert(g2Line !== undefined, 'G2 arc line present in output');
  if (g2Line) {
    // On a flat mesh with referenceZ=0 the Z should be unchanged (0.000)
    const zm = g2Line.match(/Z([+-]?\d*\.?\d+)/i);
    assert(!zm || approx(parseFloat(zm[1]), 0), 'G2 arc Z value unchanged on flat mesh (z=0)');
  }
}

{
  // Long G1 move should be subdivided
  const flatMesh = [[{ z: 0 }, { z: 0 }],
                    [{ z: 0 }, { z: 0 }]];
  const gp = { startX: 0, startY: 0, spacingX: 100, spacingY: 100, rows: 2, cols: 2 };
  const gcode = 'G90\nG1 X0 Y0\nG1 X20 Y0 Z-1 F300'; // 20mm move, segmentLength = min(100,100,2) = 2mm → 10 segments
  const result = applyZCompensation(gcode, flatMesh, gp, 0);
  const g1Lines = result.split('\n').filter(l => /^G1 X/.test(l.trim()));
  assert(g1Lines.length >= 10, 'Long G1 move subdivided into ≥10 segments (got ' + g1Lines.length + ')');
}

{
  // G91 incremental mode — pass through unchanged (no absolute-mode compensation)
  const { mesh, gridParams } = makeTestMesh();
  const gcode = 'G91\nG1 X5 Y0 Z-1';
  const result = applyZCompensation(gcode, mesh, gridParams, 0);
  const lines = result.split('\n');
  const g1Line = lines.find(l => /G1 X5/.test(l));
  assert(g1Line !== undefined, 'G91 incremental move passed through');
  // Z should NOT be compensated in incremental mode
  if (g1Line) {
    const zm = g1Line.match(/Z([+-]?\d*\.?\d+)/i);
    assert(zm && approx(parseFloat(zm[1]), -1), 'G91: Z value unchanged (no compensation)');
  }
}

{
  // Header comments should be present
  const { mesh, gridParams } = makeTestMesh();
  const result = applyZCompensation('G90\nG0 X0', mesh, gridParams, 0);
  assert(result.includes('(Z-Compensated G-code'), 'Header comment present');
  assert(result.includes('Grid: 3 x 3'), 'Grid info in header');
  assert(result.includes('Reference Z: 0.000'), 'Reference Z in header');
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(55)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('SOME TESTS FAILED');
  process.exitCode = 1;
} else {
  console.log('All tests passed ✓');
}
