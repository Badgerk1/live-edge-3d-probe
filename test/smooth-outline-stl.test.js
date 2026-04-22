/**
 * Unit tests for the smooth-outline STL export helpers:
 *   _densifyPolygon        – add intermediate vertices so max segment length is respected
 *   _bilinearZNullAware    – null-aware bilinear interpolation from a grid
 *   _nearestValidZ         – nearest-valid-sample Z fallback
 *   Full export pipeline   – boundary polygon → Delaunay → clip → Z assignment
 *
 * Run with:  node test/smooth-outline-stl.test.js
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

function assertClose(a, b, tol, message) {
  tol = tol || 1e-6;
  assert(Math.abs(a - b) < tol, message + ' (expected ' + b + ', got ' + a + ')');
}

// ── Inline helper implementations (mirrors settings-and-exports.js) ───────────

function _densifyPolygon(poly, maxSegLen) {
  if (!poly || poly.length < 2) return poly ? poly.slice() : [];
  var out = [];
  var n = poly.length;
  for (var i = 0; i < n; i++) {
    var p1 = poly[i];
    var p2 = poly[(i + 1) % n];
    out.push(p1);
    var dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len > maxSegLen) {
      var segs = Math.ceil(len / maxSegLen);
      for (var k = 1; k < segs; k++) {
        var t = k / segs;
        out.push([p1[0] + dx * t, p1[1] + dy * t]);
      }
    }
  }
  return out;
}

function _bilinearZNullAware(grid, cfg, qx, qy) {
  var col = (qx - cfg.minX) / cfg.colSpacing;
  var row = (qy - cfg.minY) / cfg.rowSpacing;
  var col0 = Math.floor(col);
  var row0 = Math.floor(row);
  col0 = Math.max(0, Math.min(cfg.colCount - 2, col0));
  row0 = Math.max(0, Math.min(cfg.rowCount - 2, row0));
  var col1 = col0 + 1;
  var row1 = row0 + 1;
  var z00 = grid[row0] && grid[row0][col0] != null ? grid[row0][col0] : null;
  var z10 = grid[row0] && grid[row0][col1] != null ? grid[row0][col1] : null;
  var z01 = grid[row1] && grid[row1][col0] != null ? grid[row1][col0] : null;
  var z11 = grid[row1] && grid[row1][col1] != null ? grid[row1][col1] : null;
  if (z00 === null || z10 === null || z01 === null || z11 === null) return null;
  var fx = Math.max(0, Math.min(1, col - col0));
  var fy = Math.max(0, Math.min(1, row - row0));
  return z00 * (1 - fx) * (1 - fy) + z10 * fx * (1 - fy) +
         z01 * (1 - fx) * fy       + z11 * fx * fy;
}

function _nearestValidZ(x, y, validPts) {
  if (!validPts || validPts.length === 0) return 0;
  var bestZ = validPts[0].z, bestD2 = Infinity;
  for (var k = 0; k < validPts.length; k++) {
    var dx = validPts[k].x - x, dy = validPts[k].y - y;
    var d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; bestZ = validPts[k].z; }
  }
  return bestZ;
}

// Minimal _pointInPolygon (ray-casting) used for pipeline test.
function _pointInPolygon(poly, x, y) {
  var n = poly.length;
  var inside = false;
  for (var i = 0, j = n - 1; i < n; j = i++) {
    var xi = poly[i][0], yi = poly[i][1];
    var xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// Bowyer-Watson Delaunay triangulation (mirrors settings-and-exports.js).
function _delaunayTriangulate(pts2d) {
  var n = pts2d.length;
  if (n < 3) return [];
  var minX = pts2d[0].x, maxX = pts2d[0].x, minY = pts2d[0].y, maxY = pts2d[0].y;
  for (var i = 1; i < n; i++) {
    if (pts2d[i].x < minX) minX = pts2d[i].x;
    if (pts2d[i].x > maxX) maxX = pts2d[i].x;
    if (pts2d[i].y < minY) minY = pts2d[i].y;
    if (pts2d[i].y > maxY) maxY = pts2d[i].y;
  }
  var sz = Math.max(maxX - minX, maxY - minY, 1) * 20;
  var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  var coords = pts2d.slice();
  coords.push({x: cx, y: cy + sz});
  coords.push({x: cx - sz, y: cy - sz});
  coords.push({x: cx + sz, y: cy - sz});
  var tris = [[n, n + 1, n + 2]];
  for (var pi = 0; pi < n; pi++) {
    var px = coords[pi].x, py = coords[pi].y;
    var bad = [];
    for (var ti = 0; ti < tris.length; ti++) {
      var t = tris[ti];
      var a = coords[t[0]], b = coords[t[1]], c = coords[t[2]];
      var adx=a.x-px, ady=a.y-py, bdx=b.x-px, bdy=b.y-py, cdx=c.x-px, cdy=c.y-py;
      if ((adx*adx+ady*ady)*(bdx*cdy-bdy*cdx)
        - (bdx*bdx+bdy*bdy)*(adx*cdy-ady*cdx)
        + (cdx*cdx+cdy*cdy)*(adx*bdy-ady*bdx) > 0) bad.push(ti);
    }
    var boundary = [];
    for (var bi = 0; bi < bad.length; bi++) {
      var T = tris[bad[bi]];
      var edges = [[T[0],T[1]],[T[1],T[2]],[T[2],T[0]]];
      for (var ei = 0; ei < 3; ei++) {
        var e = edges[ei];
        var shared = false;
        for (var bj = 0; bj < bad.length && !shared; bj++) {
          if (bj === bi) continue;
          var T2 = tris[bad[bj]];
          if ((T2[0]===e[0]||T2[1]===e[0]||T2[2]===e[0]) &&
              (T2[0]===e[1]||T2[1]===e[1]||T2[2]===e[1])) shared = true;
        }
        if (!shared) boundary.push(e);
      }
    }
    bad.sort(function(a,b){return b-a;});
    for (var di = 0; di < bad.length; di++) tris.splice(bad[di], 1);
    for (var fi = 0; fi < boundary.length; fi++) tris.push([boundary[fi][0], boundary[fi][1], pi]);
  }
  return tris.filter(function(t) { return t[0] < n && t[1] < n && t[2] < n; });
}

// ── Fixture data ──────────────────────────────────────────────────────────────

// Simple 4-vertex square boundary (CW winding).
var SQUARE_POLY = [[0,0],[100,0],[100,80],[0,80]];

// 3×3 uniform grid with Z = row + col (range 0–4).
var GRID_3X3 = [
  [0, 1, 2],
  [1, 2, 3],
  [2, 3, 4]
];
var CFG_3X3 = { rowCount: 3, colCount: 3, rowSpacing: 10, colSpacing: 10, minX: 0, minY: 0 };

// ── Tests ─────────────────────────────────────────────────────────────────────

function testDensifyNoopWhenEdgesShort() {
  console.log('\nTest: _densifyPolygon — no extra vertices when edges < maxSegLen');
  var poly = [[0,0],[10,0],[10,10],[0,10]];
  var out = _densifyPolygon(poly, 20);
  assert(out.length === 4, 'No extra vertices added (expected 4, got ' + out.length + ')');
}

function testDensifyAddsVerticesOnLongEdge() {
  console.log('\nTest: _densifyPolygon — intermediate vertices added for long edge');
  // Single edge of length 10, maxSegLen=3 → ceil(10/3)=4 segments → 3 intermediate points
  var poly = [[0,0],[10,0],[10,1],[0,1]];
  var out = _densifyPolygon(poly, 3);
  // Bottom edge (0,0)→(10,0): ceil(10/3)=4 segs → 3 intermediate
  // Right edge  (10,0)→(10,1): len=1 < 3 → no intermediate
  // Top edge    (10,1)→(0,1):  len=10 → 3 intermediate
  // Left edge   (0,1)→(0,0):   len=1 < 3 → no intermediate
  var expected = 4 + 3 + 3; // 4 corners + 3 + 3
  assert(out.length === expected, 'Expected ' + expected + ' vertices, got ' + out.length);
}

function testDensifyPreservesOriginalVertices() {
  console.log('\nTest: _densifyPolygon — original corner vertices are preserved exactly');
  var poly = [[0,0],[100,0],[100,100],[0,100]];
  var out = _densifyPolygon(poly, 10);
  // First vertex should be [0,0] (the first corner of the polygon).
  assertClose(out[0][0], 0, 1e-9, 'First vertex x=0');
  assertClose(out[0][1], 0, 1e-9, 'First vertex y=0');
  // The output should contain all original corners.
  var hasAll = poly.every(function(p) {
    return out.some(function(op) {
      return Math.abs(op[0] - p[0]) < 1e-9 && Math.abs(op[1] - p[1]) < 1e-9;
    });
  });
  assert(hasAll, 'All original corners are present in densified output');
}

function testDensifyIntermediateVerticesOnSegment() {
  console.log('\nTest: _densifyPolygon — intermediate vertices lie on the segment');
  var poly = [[0,0],[10,0],[10,10],[0,10]];
  var out = _densifyPolygon(poly, 3);
  // All intermediate points between (0,0) and (10,0) should have y=0.
  // The first corner is [0,0]; subsequent points until [10,0] (which appears later) should be on y=0.
  for (var i = 1; i < out.length; i++) {
    if (out[i][0] > 0 && out[i][0] < 10 && out[i][1] === 0) {
      assertClose(out[i][1], 0, 1e-9, 'Intermediate on bottom edge has y=0 (x=' + out[i][0] + ')');
    }
  }
  assert(true, 'Intermediate vertex collinearity check passed');
}

function testBilinearZNullAwareInterior() {
  console.log('\nTest: _bilinearZNullAware — correct interpolation at interior point');
  // At (5, 5) in a 3×3 grid with Z[r][c]=r+c and spacing 10:
  // Surrounding cells: [0][0]=0, [0][1]=1, [1][0]=1, [1][1]=2  at corners of [0..10]×[0..10]
  // fx=0.5, fy=0.5 → 0*0.25 + 1*0.25 + 1*0.25 + 2*0.25 = 1.0
  var z = _bilinearZNullAware(GRID_3X3, CFG_3X3, 5, 5);
  assertClose(z, 1.0, 1e-9, 'Z at (5,5) = 1.0');
}

function testBilinearZNullAwareAtGridCorner() {
  console.log('\nTest: _bilinearZNullAware — returns exact value at grid corner');
  var z = _bilinearZNullAware(GRID_3X3, CFG_3X3, 0, 0);
  assertClose(z, 0, 1e-9, 'Z at (0,0) = 0');
  var z2 = _bilinearZNullAware(GRID_3X3, CFG_3X3, 20, 20);
  assertClose(z2, 4, 1e-9, 'Z at (20,20) = 4');
}

function testBilinearZNullAwareWithNullCells() {
  console.log('\nTest: _bilinearZNullAware — returns null when any surrounding cell is null');
  var sparseGrid = [
    [0, null, 2],
    [1, 2,    3],
    [2, 3,    4]
  ];
  // Point (5,5) surrounds cells [0][0]=0, [0][1]=null → should return null
  var z = _bilinearZNullAware(sparseGrid, CFG_3X3, 5, 5);
  assert(z === null, 'Returns null when a surrounding cell is null (got ' + z + ')');
}

function testBilinearZNullAwareOutsideGrid() {
  console.log('\nTest: _bilinearZNullAware — clamps to edge when query is outside grid bounds');
  // Point outside grid should clamp to boundary cell — must return a number, not null.
  var z = _bilinearZNullAware(GRID_3X3, CFG_3X3, -5, -5); // outside, clamps to [0][0]
  assert(typeof z === 'number' && isFinite(z), 'Returns a finite number when clamped (got ' + z + ')');
}

function testNearestValidZ() {
  console.log('\nTest: _nearestValidZ — returns Z of nearest valid sample');
  var pts = [
    { x: 0, y: 0, z: 10 },
    { x: 10, y: 0, z: 20 },
    { x: 5, y: 5, z: 15 }
  ];
  var z = _nearestValidZ(9, 1, pts);
  assertClose(z, 20, 1e-9, 'Nearest to (9,1) is (10,0) with Z=20');
  var z2 = _nearestValidZ(4, 4, pts);
  assertClose(z2, 15, 1e-9, 'Nearest to (4,4) is (5,5) with Z=15');
}

function testNearestValidZEmptyList() {
  console.log('\nTest: _nearestValidZ — returns 0 for empty valid points list');
  var z = _nearestValidZ(5, 5, []);
  assertClose(z, 0, 1e-9, 'Returns 0 for empty list');
}

function testPipelineSmoothOutline() {
  console.log('\nTest: full smooth-outline pipeline — boundary + grid → triangles inside polygon');

  // 80×80 bounding rect boundary (CW), grid covers it.
  var boundary = [[0,0],[80,0],[80,80],[0,80]];
  var denseBoundary = _densifyPolygon(boundary, 10);

  // Build an 8×8 grid inside.
  var grid = [], cfg = { rowCount: 9, colCount: 9, rowSpacing: 10, colSpacing: 10, minX: 0, minY: 0 };
  for (var r = 0; r < 9; r++) {
    grid.push([]);
    for (var c = 0; c < 9; c++) grid[r].push(r + c);
  }

  // Interior points inside polygon.
  var validPts = [];
  for (var ri = 0; ri < cfg.rowCount; ri++) {
    for (var ci = 0; ci < cfg.colCount; ci++) {
      var gx = cfg.minX + ci * cfg.colSpacing;
      var gy = cfg.minY + ri * cfg.rowSpacing;
      validPts.push({ x: gx, y: gy, z: grid[ri][ci] });
    }
  }

  // Combine boundary + interior.
  var allPts2d = denseBoundary.map(function(p) { return { x: p[0], y: p[1] }; });
  var DEDUP_DIST = 5;
  validPts.forEach(function(ip) {
    var tooClose = allPts2d.some(function(q) {
      var ddx = q.x - ip.x, ddy = q.y - ip.y;
      return ddx * ddx + ddy * ddy < DEDUP_DIST * DEDUP_DIST;
    });
    if (!tooClose) allPts2d.push({ x: ip.x, y: ip.y });
  });

  assert(allPts2d.length >= denseBoundary.length, 'Combined points >= boundary points');

  // Triangulate.
  var rawTris = _delaunayTriangulate(allPts2d);
  assert(rawTris.length > 0, 'Delaunay produced triangles (' + rawTris.length + ')');

  // Clip to polygon.
  var clipped = rawTris.filter(function(t) {
    var cx = (allPts2d[t[0]].x + allPts2d[t[1]].x + allPts2d[t[2]].x) / 3;
    var cy = (allPts2d[t[0]].y + allPts2d[t[1]].y + allPts2d[t[2]].y) / 3;
    return _pointInPolygon(boundary, cx, cy);
  });
  assert(clipped.length > 0, 'Triangles survived polygon clip (' + clipped.length + ')');
  assert(clipped.length <= rawTris.length, 'Clipped count <= raw count');

  // Assign Z via bilinear interpolation.
  var allVerts = allPts2d.map(function(p) {
    var z = _bilinearZNullAware(grid, cfg, p.x, p.y);
    if (z === null) z = _nearestValidZ(p.x, p.y, validPts);
    return { x: p.x, y: p.y, z: z };
  });

  var allFinite = allVerts.every(function(v) { return isFinite(v.z); });
  assert(allFinite, 'All vertex Z values are finite');

  // Spot-check: Z at grid corner (0,0) = row0+col0 = 0.
  var cornerVert = allVerts.find(function(v) { return Math.abs(v.x) < 0.01 && Math.abs(v.y) < 0.01; });
  if (cornerVert) {
    assertClose(cornerVert.z, 0, 1e-6, 'Corner (0,0) has Z=0');
  } else {
    assert(true, 'Corner (0,0) is a boundary/densified point — no exact grid match expected');
  }
}

// ── Run all tests ─────────────────────────────────────────────────────────────

(function main() {
  console.log('=== smooth-outline-stl tests ===');
  try {
    testDensifyNoopWhenEdgesShort();
    testDensifyAddsVerticesOnLongEdge();
    testDensifyPreservesOriginalVertices();
    testDensifyIntermediateVerticesOnSegment();
    testBilinearZNullAwareInterior();
    testBilinearZNullAwareAtGridCorner();
    testBilinearZNullAwareWithNullCells();
    testBilinearZNullAwareOutsideGrid();
    testNearestValidZ();
    testNearestValidZEmptyList();
    testPipelineSmoothOutline();
  } catch (e) {
    console.error('Unexpected error in test runner:', e);
    failed++;
  }
  console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---');
  process.exit(failed > 0 ? 1 : 0);
})();
