/**
 * Unit tests for outline polygon helper functions:
 *   _buildOutlinePolygon  – collect + deduplicate + NN-order + CW winding
 *   _insetPolygon         – edge-offset miter-limit inset, area validation
 *   _pointInPolygon       – ray-casting PIP test
 *
 * Run with:  node test/outline-polygon-helpers.test.js
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

// ── Stubs required by the functions ──────────────────────────────────────────
var outlineRowResults = [];
var outlineColResults = [];

// ── Extract the three helper functions from outline-probe.js ─────────────────
// We inline minimal implementations here to keep the test self-contained and
// independent of the full plugin environment.

function _buildOutlinePolygon() {
  var allPts = [];
  outlineRowResults.forEach(function(r) {
    if (r.hasLeft  && r.xLeft  !== null) allPts.push([r.xLeft,  r.y]);
    if (r.hasRight && r.xRight !== null) allPts.push([r.xRight, r.y]);
  });
  outlineColResults.forEach(function(c) {
    if (c.hasBottom && c.yBottom !== null) allPts.push([c.x, c.yBottom]);
    if (c.hasTop    && c.yTop    !== null) allPts.push([c.x, c.yTop]);
  });

  var dedupPts = [];
  allPts.forEach(function(pt) {
    var dup = dedupPts.some(function(p) {
      return Math.abs(p[0] - pt[0]) < 0.1 && Math.abs(p[1] - pt[1]) < 0.1;
    });
    if (!dup) dedupPts.push(pt);
  });

  if (dedupPts.length < 3) return null;

  var blIdx = 0;
  dedupPts.forEach(function(p, i) {
    var b = dedupPts[blIdx];
    if (p[1] < b[1] || (p[1] === b[1] && p[0] < b[0])) blIdx = i;
  });

  var nnOrdered = [];
  var nnUsed = new Array(dedupPts.length).fill(false);
  var nnCur = blIdx;
  nnUsed[nnCur] = true;
  nnOrdered.push(dedupPts[nnCur]);
  while (nnOrdered.length < dedupPts.length) {
    var nnBest = -1, nnBestD = Infinity;
    for (var j = 0; j < dedupPts.length; j++) {
      if (nnUsed[j]) continue;
      var ddx = dedupPts[j][0] - dedupPts[nnCur][0];
      var ddy = dedupPts[j][1] - dedupPts[nnCur][1];
      var d2 = ddx * ddx + ddy * ddy;
      if (d2 < nnBestD) { nnBestD = d2; nnBest = j; }
    }
    if (nnBest === -1) break;
    nnUsed[nnBest] = true;
    nnCur = nnBest;
    nnOrdered.push(dedupPts[nnCur]);
  }

  var area = 0;
  for (var i = 0; i < nnOrdered.length; i++) {
    var j2 = (i + 1) % nnOrdered.length;
    area += nnOrdered[i][0] * nnOrdered[j2][1] - nnOrdered[j2][0] * nnOrdered[i][1];
  }
  if (area > 0) nnOrdered.reverse();

  return nnOrdered;
}

function _insetPolygon(poly, margin) {
  var n = poly.length;
  if (n < 3) throw new Error('Polygon must have at least 3 vertices');
  if (margin <= 0) return poly.slice();

  var offLines = [];
  for (var i = 0; i < n; i++) {
    var p1 = poly[i];
    var p2 = poly[(i + 1) % n];
    var edx = p2[0] - p1[0];
    var edy = p2[1] - p1[1];
    var len = Math.sqrt(edx * edx + edy * edy);
    if (len < 1e-10) len = 1e-10;
    var nx = edy / len;
    var ny = -edx / len;
    offLines.push({ ax: p1[0] + nx * margin, ay: p1[1] + ny * margin, dx: edx, dy: edy });
  }

  var MITER_LIMIT = margin * 4;
  var inset = [];
  for (var i = 0; i < n; i++) {
    var prev = (i - 1 + n) % n;
    var L1 = offLines[prev];
    var L2 = offLines[i];
    var det = L1.dx * (-L2.dy) - (-L2.dx) * L1.dy;
    var vx, vy;
    if (Math.abs(det) < 1e-8) {
      vx = L2.ax; vy = L2.ay;
    } else {
      var rx = L2.ax - L1.ax, ry = L2.ay - L1.ay;
      var t = (rx * (-L2.dy) - ry * (-L2.dx)) / det;
      vx = L1.ax + t * L1.dx;
      vy = L1.ay + t * L1.dy;
      var dist = Math.sqrt(Math.pow(vx - poly[i][0], 2) + Math.pow(vy - poly[i][1], 2));
      if (dist > MITER_LIMIT) { vx = L2.ax; vy = L2.ay; }
    }
    inset.push([vx, vy]);
  }

  var insetArea = 0;
  for (var i = 0; i < inset.length; i++) {
    var j2 = (i + 1) % inset.length;
    insetArea += inset[i][0] * inset[j2][1] - inset[j2][0] * inset[i][1];
  }
  insetArea = Math.abs(insetArea) / 2;
  if (insetArea < 1.0) {
    throw new Error('Polygon inset by ' + margin + 'mm collapsed to ' + insetArea.toFixed(2) +
      ' mm² — reduce Inset Margin or re-run Outline Scan');
  }

  return inset;
}

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

// ── Helper: shoelace signed area ──────────────────────────────────────────────
function signedArea(poly) {
  var area = 0;
  for (var i = 0; i < poly.length; i++) {
    var j = (i + 1) % poly.length;
    area += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
  }
  return area / 2;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests: _buildOutlinePolygon
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\nTest: _buildOutlinePolygon — returns null when no data');
outlineRowResults = [];
outlineColResults = [];
assert(_buildOutlinePolygon() === null, 'null returned for empty scan data');

console.log('\nTest: _buildOutlinePolygon — rectangle from row scans');
// Simulate a 100×80 rectangle detected via row and col scans
outlineRowResults = [
  { hasLeft: true, xLeft: 10, hasRight: true, xRight: 110, y: 5 },
  { hasLeft: true, xLeft: 10, hasRight: true, xRight: 110, y: 85 }
];
outlineColResults = [
  { hasBottom: true, yBottom: 5, hasTop: true, yTop: 85, x: 10 },
  { hasBottom: true, yBottom: 5, hasTop: true, yTop: 85, x: 110 }
];
var rectPoly = _buildOutlinePolygon();
assert(rectPoly !== null, 'polygon built for rectangle data');
// Deduplication: corners shared by row+col scans → should have 4 unique points
assert(rectPoly.length === 4, 'rectangle has 4 vertices after dedup, got ' + rectPoly.length);
// CW winding → signed area is negative
assert(signedArea(rectPoly) < 0, 'polygon has CW winding (negative signed area)');

console.log('\nTest: _buildOutlinePolygon — deduplication within 0.1mm');
outlineRowResults = [
  { hasLeft: true, xLeft: 0, hasRight: true, xRight: 50, y: 0 },
  { hasLeft: true, xLeft: 0, hasRight: true, xRight: 50, y: 40 }
];
outlineColResults = [
  // xLeft/xRight at same x as row results — duplicates within 0.05mm
  { hasBottom: true, yBottom: 0.02, hasTop: true, yTop: 39.98, x: 0.03 },
  { hasBottom: true, yBottom: 0.02, hasTop: true, yTop: 39.98, x: 49.98 }
];
var dedupPoly = _buildOutlinePolygon();
assert(dedupPoly !== null, 'polygon built');
assert(dedupPoly.length === 4, 'near-duplicate corners deduped to 4 vertices, got ' + dedupPoly.length);

// ═══════════════════════════════════════════════════════════════════════════════
// Tests: _insetPolygon
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\nTest: _insetPolygon — rectangle inset by 5mm');
// CW rectangle: (0,0)→(100,0)→(100,80)→(0,80) [reversed for CW in Y-up]
var cwRect = [[0,0],[0,80],[100,80],[100,0]]; // CW in Y-up: area should be negative
assert(signedArea(cwRect) < 0, 'cwRect has CW winding');
var inset5 = _insetPolygon(cwRect, 5);
assert(inset5.length === 4, 'inset rectangle still has 4 vertices');
// Each side should move inward by 5mm
var xs = inset5.map(function(p){return p[0];});
var ys = inset5.map(function(p){return p[1];});
assertClose(Math.min.apply(null, xs), 5, 0.5, 'left side inset by 5mm');
assertClose(Math.max.apply(null, xs), 95, 0.5, 'right side inset by 5mm');
assertClose(Math.min.apply(null, ys), 5, 0.5, 'bottom side inset by 5mm');
assertClose(Math.max.apply(null, ys), 75, 0.5, 'top side inset by 5mm');

console.log('\nTest: _insetPolygon — margin=0 returns copy unchanged');
var noInset = _insetPolygon(cwRect, 0);
assert(noInset.length === cwRect.length, 'same length');
assertClose(noInset[0][0], cwRect[0][0], 1e-9, 'first vertex x unchanged');

console.log('\nTest: _insetPolygon — throws when margin collapses polygon');
// 2.5×2.5mm square inset by 1.5mm → remaining 0.5×0.5=0.25mm² < threshold
var tinyRect = [[0,0],[0,2.5],[2.5,2.5],[2.5,0]];
var threw = false;
try { _insetPolygon(tinyRect, 1.5); } catch(e) { threw = true; }
assert(threw, 'throws when inset collapses the polygon');

// ═══════════════════════════════════════════════════════════════════════════════
// Tests: _pointInPolygon
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\nTest: _pointInPolygon — simple axis-aligned rectangle');
// CW rectangle 0,0 → 100,0 → 100,80 → 0,80 (in Y-up CW order)
var testPoly = [[0,0],[0,80],[100,80],[100,0]];
assert(_pointInPolygon(testPoly, 50, 40),  'centre is inside');
assert(!_pointInPolygon(testPoly, -1, 40), 'left of rect is outside');
assert(!_pointInPolygon(testPoly, 101, 40),'right of rect is outside');
assert(!_pointInPolygon(testPoly, 50, -1), 'below rect is outside');
assert(!_pointInPolygon(testPoly, 50, 81), 'above rect is outside');

console.log('\nTest: _pointInPolygon — inset polygon boundary');
var insetPoly = _insetPolygon(cwRect, 5);
// Points well inside the inset polygon should be inside
assert(_pointInPolygon(insetPoly, 50, 40), 'centre of inset rect is inside');
// Points between original edge and inset edge should be outside
assert(!_pointInPolygon(insetPoly, 2, 40),  'near-left-edge (in orig, outside inset) is outside');
assert(!_pointInPolygon(insetPoly, 98, 40), 'near-right-edge (in orig, outside inset) is outside');

console.log('\nTest: _pointInPolygon — L-shaped polygon (concave)');
// L-shape: bottom-left quadrant missing from 50×50 grid
var lShape = [[0,0],[0,100],[100,100],[100,50],[50,50],[50,0]];
assert(_pointInPolygon(lShape, 25, 25),   'lower-left arm interior is inside');
assert(_pointInPolygon(lShape, 75, 75),   'upper-right arm interior is inside');
assert(!_pointInPolygon(lShape, 75, 25),  'missing quadrant (lower-right) is outside');

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
