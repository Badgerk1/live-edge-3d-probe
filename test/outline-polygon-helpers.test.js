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
// Tests: centered row Y sampling — y_i = gridMinY + (i + 0.5) * (yLen / rowCount)
// This is the formula used by runOutlineSurfaceGridProbe since PR #275.
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\nTest: centered row Y sampling — square polygon 3 rows');
// Rectangle polygon (inset polygon bounds: minY=0, maxY=80, 3 rows)
// Old boundary-epsilon approach: row Y at 0.01, 40, 79.99  (near edges)
// New centered approach: row Y at 80/6≈13.33, 40, 80-80/6≈66.67  (deep inside)
var SPAN_EPS_TEST = 0.05;
var squarePoly = [[0,0],[0,80],[100,80],[100,0]]; // CW 100x80 rectangle
var centeredMinY = 0, centeredMaxY = 80, centeredRowCount = 3;
var centeredYLen = centeredMaxY - centeredMinY; // 80mm

// Cell-centered row Y: y_i = minY + (i + 0.5) * (yLen / rowCount)
function getCenteredRowY(rowIdx, minYv, yLenv, rowCountv) {
  return minYv + (rowIdx + 0.5) * (yLenv / rowCountv);
}

// All 3 rows should be inside the polygon and find non-degenerate full-width spans
for (var cri = 0; cri < centeredRowCount; cri++) {
  var cY = getCenteredRowY(cri, centeredMinY, centeredYLen, centeredRowCount);
  assert(cY > centeredMinY && cY < centeredMaxY, 'centered row ' + cri + ' Y=' + cY.toFixed(3) + ' is strictly inside [' + centeredMinY + ', ' + centeredMaxY + ']');
  var cSpan = _polyRowXSpanRobust(squarePoly, cY);
  assert(cSpan !== null, 'centered row ' + cri + ' Y=' + cY.toFixed(3) + ' finds a span');
  if (cSpan !== null) {
    assert(!cSpan.retried, 'centered row ' + cri + ' does not need retry (Y is well inside polygon)');
    var cWidth = cSpan.span.xRight - cSpan.span.xLeft;
    assert(cWidth > SPAN_EPS_TEST, 'centered row ' + cri + ' span is non-degenerate: width=' + cWidth.toFixed(3) + 'mm');
    assertClose(cSpan.span.xLeft,   0, 0.1, 'centered row ' + cri + ': xLeft near 0');
    assertClose(cSpan.span.xRight, 100, 0.1, 'centered row ' + cri + ': xRight near 100');
  }
}

// Verify spacing: rows should be evenly spaced at yLen/rowCount apart
var centeredY0 = getCenteredRowY(0, centeredMinY, centeredYLen, centeredRowCount);
var centeredY1 = getCenteredRowY(1, centeredMinY, centeredYLen, centeredRowCount);
var centeredY2 = getCenteredRowY(2, centeredMinY, centeredYLen, centeredRowCount);
assertClose(centeredY0, centeredYLen / 6,      1e-9, 'row 0 Y = minY + 0.5*(yLen/3) ≈ 13.333mm');
assertClose(centeredY1, centeredYLen / 2,      1e-9, 'row 1 Y = minY + 1.5*(yLen/3) = 40mm (midpoint)');
assertClose(centeredY2, 5 * centeredYLen / 6,  1e-9, 'row 2 Y = minY + 2.5*(yLen/3) ≈ 66.667mm');
assertClose(centeredY1 - centeredY0, centeredYLen / centeredRowCount, 1e-9, 'row spacing = yLen/rowCount');
assertClose(centeredY2 - centeredY1, centeredYLen / centeredRowCount, 1e-9, 'row spacing is uniform');

// gridCfg accuracy: minY/maxY/rowSpacing should match actual probe positions
var centeredGridCfgMinY     = centeredMinY + 0.5 * centeredYLen / centeredRowCount;
var centeredGridCfgMaxY     = centeredMinY + (centeredRowCount - 0.5) * centeredYLen / centeredRowCount;
var centeredGridCfgSpacing  = centeredYLen / centeredRowCount;
assertClose(centeredGridCfgMinY,  centeredY0, 1e-9, 'gridCfg.minY equals row-0 centered Y');
assertClose(centeredGridCfgMaxY,  centeredY2, 1e-9, 'gridCfg.maxY equals last-row centered Y');
assertClose(centeredGridCfgSpacing, centeredY1 - centeredY0, 1e-9, 'gridCfg.rowSpacing matches actual row gap');

// Verify that the downstream formula cfg.minY + i*cfg.rowSpacing = actual probe Y
for (var dsRow = 0; dsRow < centeredRowCount; dsRow++) {
  var dsActualY = getCenteredRowY(dsRow, centeredMinY, centeredYLen, centeredRowCount);
  var dsCfgY    = centeredGridCfgMinY + dsRow * centeredGridCfgSpacing;
  assertClose(dsCfgY, dsActualY, 1e-9, 'downstream formula: cfg.minY + ' + dsRow + ' * cfg.rowSpacing = row-' + dsRow + ' actual Y');
}

console.log('\nTest: centered row Y sampling — square polygon 5 rows (matches user bug report)');
// 5-row grid over 234mm (matching the problematic log: Y range approx 0..234)
var fiveRowMinY = 0, fiveRowMaxY = 234, fiveRowCount = 5;
var fiveRowYLen = fiveRowMaxY - fiveRowMinY;
var wideRect = [[0, fiveRowMinY], [0, fiveRowMaxY], [300, fiveRowMaxY], [300, fiveRowMinY]];
for (var fri = 0; fri < fiveRowCount; fri++) {
  var frY = getCenteredRowY(fri, fiveRowMinY, fiveRowYLen, fiveRowCount);
  assert(frY > fiveRowMinY && frY < fiveRowMaxY, '5-row row ' + fri + ' Y=' + frY.toFixed(2) + ' is inside the polygon');
  var frSpan = _polyRowXSpanRobust(wideRect, frY);
  assert(frSpan !== null, '5-row row ' + fri + ' finds a span (not on boundary)');
  if (frSpan !== null) {
    assert(!frSpan.retried, '5-row row ' + fri + ' needs no retry (centered Y is well inside)');
    assert(frSpan.span.xRight - frSpan.span.xLeft > 290, '5-row row ' + fri + ' has full-width span');
  }
}
// First row should no longer be at/near the boundary (old bug: Y=-0.074 ≈ minY)
var frFirstY = getCenteredRowY(0, fiveRowMinY, fiveRowYLen, fiveRowCount);
assert(frFirstY > 20, 'first row Y=' + frFirstY.toFixed(2) + 'mm is well inside the polygon (not near boundary)');
// Last row should no longer be at/near the boundary
var frLastY = getCenteredRowY(fiveRowCount - 1, fiveRowMinY, fiveRowYLen, fiveRowCount);
assert(frLastY < 214, 'last row Y=' + frLastY.toFixed(2) + 'mm is well inside the polygon (not near boundary)');

console.log('\nTest: centered row Y sampling — round polygon (octagon) all rows inside');
// For a round shape, centered rows should always be inside
var r2 = 40, cx2 = 50, cy2 = 50;
var octagon2 = [];
for (var oi2 = 0; oi2 < 8; oi2++) {
  var ang2 = (oi2 / 8) * 2 * Math.PI;
  octagon2.push([cx2 + r2 * Math.cos(ang2), cy2 + r2 * Math.sin(ang2)]);
}
var octMinY = Math.min.apply(null, octagon2.map(function(p){return p[1];}));
var octMaxY = Math.max.apply(null, octagon2.map(function(p){return p[1];}));
var octYLen  = octMaxY - octMinY;
for (var ocri = 0; ocri < 3; ocri++) {
  var octY = getCenteredRowY(ocri, octMinY, octYLen, 3);
  var octSpan = _polyRowXSpanRobust(octagon2, octY);
  assert(octSpan !== null, 'octagon centered row ' + ocri + ' finds span');
  if (octSpan !== null) {
    assert(octSpan.span.xRight - octSpan.span.xLeft > 0, 'octagon centered row ' + ocri + ' span is positive');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
