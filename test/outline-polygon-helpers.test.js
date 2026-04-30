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

function _polyRowXSpan(poly, targetY) {
  var xs = [];
  var n = poly.length;
  for (var i = 0, j = n - 1; i < n; j = i++) {
    var x0 = poly[j][0], y0 = poly[j][1];
    var x1 = poly[i][0], y1 = poly[i][1];
    if ((y0 <= targetY && y1 > targetY) || (y1 <= targetY && y0 > targetY)) {
      var t = (targetY - y0) / (y1 - y0);
      xs.push(x0 + t * (x1 - x0));
    }
  }
  if (xs.length < 2) return null;
  return { xLeft: Math.min.apply(null, xs), xRight: Math.max.apply(null, xs) };
}

var _SPAN_EPS_Y = 0.01;
function _polyRowXSpanRobust(poly, targetY, epsY) {
  epsY = epsY || _SPAN_EPS_Y;
  var span = _polyRowXSpan(poly, targetY);
  if (span !== null) return { span: span, retried: false, retryY: null };
  span = _polyRowXSpan(poly, targetY - epsY);
  if (span !== null) return { span: span, retried: true, retryY: targetY - epsY };
  span = _polyRowXSpan(poly, targetY + epsY);
  if (span !== null) return { span: span, retried: true, retryY: targetY + epsY };
  return null;
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
// Tests: _polyRowXSpan
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\nTest: _polyRowXSpan — axis-aligned rectangle');
// Rectangle from (10,5) to (110,85)
var spanRect = [[10,5],[10,85],[110,85],[110,5]];
var spanMid = _polyRowXSpan(spanRect, 40);
assert(spanMid !== null, 'span found at mid-height of rectangle');
assertClose(spanMid.xLeft,  10,  0.01, 'xLeft = left edge of rectangle');
assertClose(spanMid.xRight, 110, 0.01, 'xRight = right edge of rectangle');

console.log('\nTest: _polyRowXSpan — returns null above/below polygon');
var spanAbove = _polyRowXSpan(spanRect, 90); // above yMax=85
assert(spanAbove === null, 'null when scanline is above polygon');
var spanBelow = _polyRowXSpan(spanRect, 3);  // below yMin=5
assert(spanBelow === null, 'null when scanline is below polygon');

console.log('\nTest: _polyRowXSpan — circle-like polygon (octagon)');
// Approximate a circle with a regular octagon centred at (50,50) radius=40
var r = 40, cx = 50, cy = 50;
var octagon = [];
for (var oi = 0; oi < 8; oi++) {
  var ang = (oi / 8) * 2 * Math.PI;
  octagon.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
}
// At the centre Y, the span should be approximately 2*radius wide
var spanCentre = _polyRowXSpan(octagon, cy);
assert(spanCentre !== null, 'span found at centre of octagon');
assert(spanCentre.xRight - spanCentre.xLeft > 70, 'octagon span at centre is close to diameter (' + (spanCentre.xRight - spanCentre.xLeft).toFixed(2) + 'mm)');
// xLeft should be less than centre X and xRight greater
assert(spanCentre.xLeft < cx, 'octagon xLeft is left of centre');
assert(spanCentre.xRight > cx, 'octagon xRight is right of centre');

console.log('\nTest: _polyRowXSpan — span narrows towards top of octagon');
var spanNearTop = _polyRowXSpan(octagon, cy + r * 0.9);
assert(spanNearTop !== null, 'span found near top of octagon');
assert(spanNearTop.xRight - spanNearTop.xLeft < spanCentre.xRight - spanCentre.xLeft,
  'span near top is narrower than at centre');

console.log('\nTest: _polyRowXSpan — inset rectangle span');
// 100×80 rect inset by 5mm → 90×70 inner rect
var outerRect = [[0,0],[0,80],[100,80],[100,0]];
var insetRect5 = _insetPolygon(outerRect, 5);
var insetSpan = _polyRowXSpan(insetRect5, 40);
assert(insetSpan !== null, 'span found inside inset rectangle');
assertClose(insetSpan.xLeft,  5,  0.5, 'inset rect xLeft ≈ 5mm');
assertClose(insetSpan.xRight, 95, 0.5, 'inset rect xRight ≈ 95mm');

// ═══════════════════════════════════════════════════════════════════════════════
// Tests: _polyRowXSpanRobust
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\nTest: _polyRowXSpanRobust — normal span, no retry needed');
var robustMid = _polyRowXSpanRobust(spanRect, 40);
assert(robustMid !== null, 'robust span found at mid-height');
assert(!robustMid.retried, 'no retry needed at mid-height');
assertClose(robustMid.span.xLeft,  10,  0.01, 'robust xLeft = left edge');
assertClose(robustMid.span.xRight, 110, 0.01, 'robust xRight = right edge');

console.log('\nTest: _polyRowXSpanRobust — scanline exactly on bottom edge (Y=5) — primary or retry finds span');
// spanRect bottom edge is at Y=5; the half-open interval y0<=Y && y1>Y finds the
// vertical edges adjacent to the bottom corners, so the primary scan succeeds.
var robustBottom = _polyRowXSpanRobust(spanRect, 5);
assert(robustBottom !== null, 'robust span found at bottom edge Y=5 (primary or retry)');
assertClose(robustBottom.span.xLeft,  10,  0.1, 'bottom-edge: xLeft ≈ 10');
assertClose(robustBottom.span.xRight, 110, 0.1, 'bottom-edge: xRight ≈ 110');

console.log('\nTest: _polyRowXSpanRobust — scanline exactly on top edge (Y=85) requires retry');
// At the top edge the half-open interval fails for both adjacent vertical edges,
// so the primary scan returns null and the robust wrapper must retry at Y-eps.
var robustTop = _polyRowXSpanRobust(spanRect, 85);
assert(robustTop !== null, 'robust span found at top edge Y=85 via retry');
assert(robustTop.retried, 'retry was used for top edge');
assertClose(robustTop.span.xLeft,  10,  0.1, 'top-edge retry: xLeft ≈ 10');
assertClose(robustTop.span.xRight, 110, 0.1, 'top-edge retry: xRight ≈ 110');

console.log('\nTest: _polyRowXSpanRobust — returns null when scanline is well outside polygon');
var robustAbove = _polyRowXSpanRobust(spanRect, 200);
assert(robustAbove === null, 'null returned when well above polygon');
var robustBelow = _polyRowXSpanRobust(spanRect, -10);
assert(robustBelow === null, 'null returned when well below polygon');

console.log('\nTest: _polyRowXSpanRobust — degenerate span detection (xRight - xLeft < SPAN_EPS)');
// A very narrow triangle tip should produce a near-zero span close to the apex
var SPAN_EPS = 0.05;
// Isoceles triangle with apex at (50, 100) and base from (0,0) to (100,0)
var triangle = [[0,0],[100,0],[50,100]];
// At Y=99 the span should be very narrow (about 1mm wide)
var tipSpan = _polyRowXSpan(triangle, 99);
assert(tipSpan !== null, 'tip span found');
var tipWidth = tipSpan.xRight - tipSpan.xLeft;
assert(tipWidth < 2, 'tip span is very narrow (' + tipWidth.toFixed(3) + 'mm)');
// Flag as degenerate if below SPAN_EPS
if (tipWidth < SPAN_EPS) {
  assert(tipWidth < SPAN_EPS, 'tip span is degenerate (<' + SPAN_EPS + 'mm)');
}

console.log('\nTest: _polyRowXSpanRobust — rectangle 3x3 grid: top/bottom rows find span');
// Simulate a 3x3 surface grid on a 100×80 rectangle; rows at Y=0, 40, 80
var gridRect = [[0,0],[0,80],[100,80],[100,0]]; // CW rectangle
var rows3 = [0, 40, 80];
rows3.forEach(function(ry) {
  var r = _polyRowXSpanRobust(gridRect, ry);
  assert(r !== null, '3x3 grid row Y=' + ry + ' finds a span (possibly via retry)');
  if (r !== null) {
    assert(r.span.xRight - r.span.xLeft > 90, 'span at Y=' + ry + ' is wide (' + (r.span.xRight - r.span.xLeft).toFixed(2) + 'mm)');
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tests: _ROW_BOUNDARY_EPS — first/last row Y offset in polygon mode
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\nTest: row boundary epsilon — first/last row Y inset prevents degenerate span');
// Rectangle polygon (inset polygon bounds: minY=0, maxY=80, 3 rows)
// Without epsilon: row 0 at Y=0, row 2 at Y=80
// With epsilon:    row 0 at Y=0+0.01=0.01, row 2 at Y=80-0.01=79.99
var _ROW_BOUNDARY_EPS_TEST = 0.01;
var SPAN_EPS_TEST = 0.05;
var squarePoly = [[0,0],[0,80],[100,80],[100,0]]; // CW 100x80 rectangle
var minY = 0, maxY = 80, rowCount = 3;
var rowSpacing = (maxY - minY) / (rowCount - 1); // 40mm

// Simulate the adjusted row Y computation for polygon mode
function getAdjustedRowY(rowIdx, minYv, rowSpacingv, rowCountv) {
  var y = minYv + rowIdx * rowSpacingv;
  if (rowIdx === 0) y += _ROW_BOUNDARY_EPS_TEST;
  else if (rowIdx === rowCountv - 1) y -= _ROW_BOUNDARY_EPS_TEST;
  return y;
}

// Row 0 with epsilon should produce a non-degenerate span on the square polygon
var row0Y = getAdjustedRowY(0, minY, rowSpacing, rowCount); // 0.01
assert(row0Y > minY, 'row 0 Y is inset above minY (' + row0Y + ' > ' + minY + ')');
var row0Span = _polyRowXSpanRobust(squarePoly, row0Y);
assert(row0Span !== null, 'row 0 inset Y=' + row0Y + ' finds a valid span');
if (row0Span !== null) {
  var row0Width = row0Span.span.xRight - row0Span.span.xLeft;
  assert(row0Width > SPAN_EPS_TEST, 'row 0 span is non-degenerate: width=' + row0Width.toFixed(3) + 'mm');
  assertClose(row0Span.span.xLeft,   0, 0.1, 'row 0 inset: xLeft near 0');
  assertClose(row0Span.span.xRight, 100, 0.1, 'row 0 inset: xRight near 100');
}

// Row 2 (last) with epsilon should produce a non-degenerate span
var row2Y = getAdjustedRowY(2, minY, rowSpacing, rowCount); // 79.99
assert(row2Y < maxY, 'row 2 Y is inset below maxY (' + row2Y + ' < ' + maxY + ')');
var row2Span = _polyRowXSpanRobust(squarePoly, row2Y);
assert(row2Span !== null, 'row 2 inset Y=' + row2Y + ' finds a valid span');
if (row2Span !== null) {
  var row2Width = row2Span.span.xRight - row2Span.span.xLeft;
  assert(row2Width > SPAN_EPS_TEST, 'row 2 span is non-degenerate: width=' + row2Width.toFixed(3) + 'mm');
  assert(!row2Span.retried, 'row 2 inset Y does not need retry (Y is inside polygon)');
}

// Middle row (row 1) should be unchanged
var row1Y = getAdjustedRowY(1, minY, rowSpacing, rowCount); // 40
assertClose(row1Y, 40, 1e-9, 'middle row Y is unchanged');

console.log('\nTest: row boundary epsilon — round polygon (octagon) is unaffected');
// For a round shape, first/last row Y values with epsilon should still find spans
var r2 = 40, cx2 = 50, cy2 = 50;
var octagon2 = [];
for (var oi2 = 0; oi2 < 8; oi2++) {
  var ang2 = (oi2 / 8) * 2 * Math.PI;
  octagon2.push([cx2 + r2 * Math.cos(ang2), cy2 + r2 * Math.sin(ang2)]);
}
var octMinY = Math.min.apply(null, octagon2.map(function(p){return p[1];}));
var octMaxY = Math.max.apply(null, octagon2.map(function(p){return p[1];}));
var octRowSpacing = (octMaxY - octMinY) / 2; // 3 rows
var octRow0Y = getAdjustedRowY(0, octMinY, octRowSpacing, 3);
var octRow2Y = getAdjustedRowY(2, octMinY, octRowSpacing, 3);
var octRow0Span = _polyRowXSpanRobust(octagon2, octRow0Y);
var octRow2Span = _polyRowXSpanRobust(octagon2, octRow2Y);
assert(octRow0Span !== null, 'octagon first row (inset Y) finds span');
assert(octRow2Span !== null, 'octagon last row (inset Y) finds span');
if (octRow0Span !== null) {
  assert(octRow0Span.span.xRight - octRow0Span.span.xLeft > 0, 'octagon first row span is positive');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests: Centered row sampling — production formula y_i = minY + (i+0.5)*(h/n)
// This is the formula used in runOutlineSurfaceGridProbe.  It ensures first/last
// rows are always strictly inside [minY, maxY] and never land on the boundary.
// ═══════════════════════════════════════════════════════════════════════════════

// Helper: compute centered row Y values (same formula as production code)
function centeredRowY(rowIdx, minYv, height, rowCountv) {
  return minYv + (rowIdx + 0.5) * (height / rowCountv);
}

// Helper: compute centered column X values (same formula as production code)
function centeredColX(colIdx, xLeft, spanWidth, colCountv) {
  if (colCountv === 1) return (xLeft + (xLeft + spanWidth)) / 2;
  return xLeft + (colIdx + 0.5) * (spanWidth / colCountv);
}

console.log('\nTest: centered row sampling — 3-row rectangle: all rows strictly inside [minY, maxY]');
// Rectangle 100x80 (minY=0, maxY=80), 3 rows:
//   row 0: 0 + 0.5*(80/3) ≈ 13.33  (was 0 with old formula → boundary!)
//   row 1: 0 + 1.5*(80/3) ≈ 40.00
//   row 2: 0 + 2.5*(80/3) ≈ 66.67  (was 80 with old formula → boundary!)
var csPoly = [[0,0],[0,80],[100,80],[100,0]]; // CW 100x80 rectangle
var csMinY = 0, csMaxY = 80, csHeight = csMaxY - csMinY;
var csRows3 = 3;
for (var cri = 0; cri < csRows3; cri++) {
  var csY = centeredRowY(cri, csMinY, csHeight, csRows3);
  assert(csY > csMinY, 'centered row ' + cri + ' Y=' + csY.toFixed(4) + ' > minY=' + csMinY);
  assert(csY < csMaxY, 'centered row ' + cri + ' Y=' + csY.toFixed(4) + ' < maxY=' + csMaxY);
  var csSpan = _polyRowXSpanRobust(csPoly, csY);
  assert(csSpan !== null, 'centered row ' + cri + ' (Y=' + csY.toFixed(3) + ') produces valid span');
  if (csSpan !== null) {
    var csWidth = csSpan.span.xRight - csSpan.span.xLeft;
    assert(csWidth > 0.05, 'centered row ' + cri + ' span is non-degenerate: ' + csWidth.toFixed(3) + 'mm');
    assert(!csSpan.retried, 'centered row ' + cri + ' does not need Y±eps retry (interior point)');
  }
}

console.log('\nTest: centered row sampling — 5-row rectangle: all rows strictly inside [minY, maxY]');
// Rectangle 304x234 (approximating user scenario), 5 rows:
//   row 0: minY + 0.5*(234/5) = minY+23.4  ← previously ≈ minY (corner/degenerate!)
//   row 4: minY + 4.5*(234/5) = maxY-23.4  ← previously ≈ maxY (corner/degenerate!)
var cs5MinY = -0.084, cs5MaxY = 233.998, cs5Height = cs5MaxY - cs5MinY;
// Use a simple axis-aligned rectangle matching the user's workpiece dimensions
var cs5Poly = [
  [cs5MinY, cs5MinY], // reuse as [x,y] placeholder — use actual representative polygon
];
// Build a representative inset rectangle: minX=−2, maxX=304, minY=−0.1, maxY=234
var cs5Rect = [[-2,-0.1],[-2,234],[304,234],[304,-0.1]]; // CW rectangle
var cs5Rows = 5;
for (var cr5i = 0; cr5i < cs5Rows; cr5i++) {
  var cs5Y = centeredRowY(cr5i, cs5MinY, cs5Height, cs5Rows);
  assert(cs5Y > cs5MinY, '5-row: centered row ' + cr5i + ' Y=' + cs5Y.toFixed(3) + ' > minY=' + cs5MinY.toFixed(3));
  assert(cs5Y < cs5MaxY, '5-row: centered row ' + cr5i + ' Y=' + cs5Y.toFixed(3) + ' < maxY=' + cs5MaxY.toFixed(3));
  var cs5Span = _polyRowXSpanRobust(cs5Rect, cs5Y);
  assert(cs5Span !== null, '5-row: centered row ' + cr5i + ' (Y=' + cs5Y.toFixed(3) + ') produces valid span on rectangle');
  if (cs5Span !== null) {
    var cs5Width = cs5Span.span.xRight - cs5Span.span.xLeft;
    assert(cs5Width > 0.05, '5-row: centered row ' + cr5i + ' span is non-degenerate: ' + cs5Width.toFixed(3) + 'mm');
  }
}

console.log('\nTest: centered row sampling — 4x5 grid (user scenario): all 5 rows produce wide spans');
// 4 cols × 5 rows on inset polygon: minX=-1.978, maxX=304.013, minY=-0.084, maxY=233.998
// Row Y values (centered):
//   row 0: -0.084 + 0.5*(234.082/5) ≈  23.324  (was -0.074 boundary → tiny corner span!)
//   row 1: -0.084 + 1.5*(234.082/5) ≈  70.141
//   row 2: -0.084 + 2.5*(234.082/5) ≈ 116.957
//   row 3: -0.084 + 3.5*(234.082/5) ≈ 163.773
//   row 4: -0.084 + 4.5*(234.082/5) ≈ 210.590  (was 233.988 boundary → degenerate!)
var userMinX = -1.978, userMaxX = 304.013;
var userMinY = -0.084, userMaxY = 233.998;
var userHeight = userMaxY - userMinY;
var userPoly = [[userMinX,userMinY],[userMinX,userMaxY],[userMaxX,userMaxY],[userMaxX,userMinY]];
var userRows = 5, userCols = 4;
for (var uri = 0; uri < userRows; uri++) {
  var urY = centeredRowY(uri, userMinY, userHeight, userRows);
  assert(urY > userMinY, '4x5 user scenario: row ' + uri + ' Y=' + urY.toFixed(3) + ' strictly above minY');
  assert(urY < userMaxY, '4x5 user scenario: row ' + uri + ' Y=' + urY.toFixed(3) + ' strictly below maxY');
  var urSpan = _polyRowXSpanRobust(userPoly, urY);
  assert(urSpan !== null, '4x5 user scenario: row ' + uri + ' Y=' + urY.toFixed(3) + ' has valid span');
  if (urSpan !== null) {
    var urWidth = urSpan.span.xRight - urSpan.span.xLeft;
    // Full width of rectangle: ~306mm; expect non-degenerate wide span
    assert(urWidth > 100, '4x5 user scenario: row ' + uri + ' span is wide: ' + urWidth.toFixed(3) + 'mm (not tiny corner)');
  }
}

console.log('\nTest: centered column sampling — 4 cols formula produces correct X values');
// xLeft=10, xRight=110, colCount=4: span=100mm, cellWidth=25mm
//   col 0: x = 10 + 0.5*25 = 22.5
//   col 1: x = 10 + 1.5*25 = 47.5
//   col 2: x = 10 + 2.5*25 = 72.5
//   col 3: x = 10 + 3.5*25 = 97.5
var ccXLeft = 10, ccXRight = 110, ccSpanW = ccXRight - ccXLeft, ccCols = 4;
var ccCellW = ccSpanW / ccCols;
var expectedCols = [22.5, 47.5, 72.5, 97.5];
for (var cci = 0; cci < ccCols; cci++) {
  var ccX = centeredColX(cci, ccXLeft, ccSpanW, ccCols);
  assertClose(ccX, expectedCols[cci], 1e-6, 'col ' + cci + ' centered X=' + ccX.toFixed(4) + ' (expected ' + expectedCols[cci] + ')');
  // All centered col X values must be strictly inside [xLeft, xRight]
  assert(ccX > ccXLeft,  'col ' + cci + ' X=' + ccX.toFixed(3) + ' > xLeft=' + ccXLeft);
  assert(ccX < ccXRight, 'col ' + cci + ' X=' + ccX.toFixed(3) + ' < xRight=' + ccXRight);
}

console.log('\nTest: centered column sampling — single-column uses midpoint');
// cols=1: x = (xLeft + xRight)/2 = 60
var ccMid = centeredColX(0, 10, 100, 1);
assertClose(ccMid, 60, 1e-6, 'single-column centred X = midpoint 60');

console.log('\nTest: centered sampling — first/last rows are far from boundary (not corner-adjacent)');
// With centered sampling, first/last rows must be at least height/(2*rows) away from boundary.
// For 5 rows over height=80: each band=16mm, first row center=8mm from minY.
var farTestHeight = 80, farTestRows = 5, farTestMinY = 0;
var farTestBand = farTestHeight / farTestRows; // 16mm
var farRow0Y = centeredRowY(0, farTestMinY, farTestHeight, farTestRows); // 8.0
var farRowLastY = centeredRowY(farTestRows - 1, farTestMinY, farTestHeight, farTestRows); // 72.0
assertClose(farRow0Y, farTestMinY + farTestBand / 2, 1e-6, 'first row Y = minY + band/2 (8mm from minY)');
assertClose(farRowLastY, farTestMinY + farTestHeight - farTestBand / 2, 1e-6, 'last row Y = maxY - band/2 (8mm from maxY)');
assert(farRow0Y - farTestMinY > 1.0, 'first centered row is >1mm above minY (not a corner)');
assert((farTestMinY + farTestHeight) - farRowLastY > 1.0, 'last centered row is >1mm below maxY (not a corner)');

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
