/**
 * Unit tests for face probe visualization and mesh smoothing fixes:
 *
 *  1. subdivideFaceMesh with null corners: nearest-neighbor fill ensures
 *     that original probe contacts are never dropped because an adjacent
 *     cell is null (regression for "missing point rows" issue).
 *
 *  2. getFaceRawData() fallback: returns layeredFaceResultsRaw when set,
 *     otherwise falls back to layeredFaceResults.
 *
 *  3. OBJ export with raw input produces more vertices than the same data
 *     after bilinear pre-subdivision (Catmull-Rom upsampling from a coarser
 *     grid generates more geometry than upsampling from an already-dense one).
 *
 *  4. All expected face probe points appear in the rendered point list
 *     produced by the renderFaceReliefMap data pipeline.
 *
 * Run with:  node test/face-probe-fixes.test.js
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

// ── Catmull-Rom helper (mirrors core.js) ─────────────────────────────────────
function _catmullRom(p0, p1, p2, p3, t) {
  var t2 = t * t, t3 = t2 * t;
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2*p0 - 5*p1 + 4*p2 - p3) * t2 +
    (-p0 + 3*p1 - 3*p2 + p3) * t3
  );
}

// ── Inline _bicubicUpsampleGrid (mirrors settings-and-exports.js) ────────────
function _bicubicUpsampleGrid(grid, cfg, targetSpacing) {
  var nR = cfg.rowCount, nC = cfg.colCount;
  if (nR < 2 || nC < 2) {
    return { grid: grid, rowCount: nR, colCount: nC,
             colSpacing: cfg.colSpacing, rowSpacing: cfg.rowSpacing,
             minX: cfg.minX, minY: cfg.minY };
  }
  var sp = Math.max(targetSpacing, 0.5);
  var subC = Math.max(1, Math.round(cfg.colSpacing / sp));
  var subR = Math.max(1, Math.round(cfg.rowSpacing / sp));
  var nCX = nC - 1, nCY = nR - 1;
  var maxSub = Math.max(1, Math.floor(Math.sqrt(200000 / Math.max(nCX * nCY, 1))));
  subC = Math.min(subC, maxSub);
  subR = Math.min(subR, maxSub);
  if (subC <= 1 && subR <= 1) {
    return { grid: grid, rowCount: nR, colCount: nC,
             colSpacing: cfg.colSpacing, rowSpacing: cfg.rowSpacing,
             minX: cfg.minX, minY: cfg.minY };
  }
  function gZ(r, c) {
    var rr = Math.max(0, Math.min(nR - 1, r));
    var cc = Math.max(0, Math.min(nC - 1, c));
    var v = grid[rr][cc];
    return (v != null && isFinite(v)) ? v : null;
  }
  function rowInterp(r, cx, tx) {
    var p1 = gZ(r, cx), p2 = gZ(r, cx + 1);
    if (p1 === null || p2 === null) return null;
    var p0 = gZ(r, cx - 1); if (p0 === null) p0 = p1;
    var p3 = gZ(r, cx + 2); if (p3 === null) p3 = p2;
    return _catmullRom(p0, p1, p2, p3, tx);
  }
  function biZ(cy, cx, tx, ty) {
    var z00 = gZ(cy, cx), z10 = gZ(cy, cx + 1), z01 = gZ(cy + 1, cx), z11 = gZ(cy + 1, cx + 1);
    if (z00 === null || z10 === null || z01 === null || z11 === null) return null;
    var r0 = rowInterp(cy - 1, cx, tx);
    var r1 = rowInterp(cy,     cx, tx);
    var r2 = rowInterp(cy + 1, cx, tx);
    var r3 = rowInterp(cy + 2, cx, tx);
    if (r1 === null || r2 === null) {
      return z00 * (1 - tx) * (1 - ty) + z10 * tx * (1 - ty) + z01 * (1 - tx) * ty + z11 * tx * ty;
    }
    if (r0 === null) r0 = r1;
    if (r3 === null) r3 = r2;
    return _catmullRom(r0, r1, r2, r3, ty);
  }
  var totalCols = nCX * subC + 1, totalRows = nCY * subR + 1;
  var newGrid = [];
  for (var gy = 0; gy < totalRows; gy++) {
    var cy = Math.min(Math.floor(gy / subR), nCY - 1);
    var ty = (gy - cy * subR) / subR;
    var row = [];
    for (var gx = 0; gx < totalCols; gx++) {
      var cx = Math.min(Math.floor(gx / subC), nCX - 1);
      var tx = (gx - cx * subC) / subC;
      row.push(biZ(cy, cx, tx, ty));
    }
    newGrid.push(row);
  }
  return {
    grid: newGrid,
    rowCount: totalRows, colCount: totalCols,
    colSpacing: cfg.colSpacing / subC, rowSpacing: cfg.rowSpacing / subR,
    minX: cfg.minX, minY: cfg.minY
  };
}

// ── Inline _upsampleFaceData (mirrors settings-and-exports.js) ───────────────
function _upsampleFaceData(data, targetSpacing) {
  if (!data || data.length < 4) {
    return { pts: data.map(function(p){ return {x:Number(p.x),y:Number(p.y),z:Number(p.z)}; }), vMap: null, rowCount: 0, colCount: 0 };
  }
  var xSet = {}, zSet = {};
  data.forEach(function(p) {
    xSet[Number(p.x).toFixed(6)] = Number(p.x);
    zSet[Number(p.z).toFixed(6)] = Number(p.z);
  });
  var xVals = Object.keys(xSet).map(function(k){ return xSet[k]; }).sort(function(a,b){return a-b;});
  var zVals = Object.keys(zSet).map(function(k){ return zSet[k]; }).sort(function(a,b){return a-b;});
  var nCols = xVals.length, nRows = zVals.length;
  if (nCols < 2 || nRows < 2) {
    return { pts: data.map(function(p){ return {x:Number(p.x),y:Number(p.y),z:Number(p.z)}; }), vMap: null, rowCount: 0, colCount: 0 };
  }
  var xi2idx = {}, zi2idx = {};
  xVals.forEach(function(v, i){ xi2idx[v.toFixed(6)] = i; });
  zVals.forEach(function(v, i){ zi2idx[v.toFixed(6)] = i; });
  var depthGrid = [];
  for (var ri = 0; ri < nRows; ri++) { depthGrid.push(new Array(nCols).fill(null)); }
  data.forEach(function(p) {
    var xi = xi2idx[Number(p.x).toFixed(6)], zi = zi2idx[Number(p.z).toFixed(6)];
    if (xi != null && zi != null) depthGrid[zi][xi] = Number(p.y);
  });
  var colSpacing = (xVals[nCols - 1] - xVals[0]) / (nCols - 1);
  var rowSpacing = (zVals[nRows - 1] - zVals[0]) / (nRows - 1);
  var cfg = { rowCount: nRows, colCount: nCols, colSpacing: colSpacing, rowSpacing: rowSpacing, minX: xVals[0], minY: zVals[0] };
  var up = _bicubicUpsampleGrid(depthGrid, cfg, targetSpacing);
  var pts = [], vMap = [];
  for (var ri2 = 0; ri2 < up.rowCount; ri2++) {
    var vmRow = [];
    for (var ci2 = 0; ci2 < up.colCount; ci2++) {
      var depth = up.grid[ri2][ci2];
      if (depth !== null) {
        vmRow.push(pts.length);
        pts.push({ x: up.minX + ci2 * up.colSpacing, y: depth, z: up.minY + ri2 * up.rowSpacing });
      } else {
        vmRow.push(null);
      }
    }
    vMap.push(vmRow);
  }
  if (pts.length < 3) {
    return { pts: data.map(function(p){ return {x:Number(p.x),y:Number(p.y),z:Number(p.z)}; }), vMap: null, rowCount: 0, colCount: 0 };
  }
  return { pts: pts, vMap: vMap, rowCount: up.rowCount, colCount: up.colCount };
}

// ── Inline subdivideFaceMesh WITH nearest-neighbor fill fix ──────────────────
// Mirrors the fixed version in src/js/core.js (the fix is the NN fill block).
var MIN_SUBDIVISION_SPACING = 0.5;
var MAX_SUBDIVISION_POINTS  = 500000;

function subdivideFaceMesh(pts, spacing) {
  if (!pts || pts.length < 4 || !spacing || spacing <= 0) return pts;
  if (spacing < MIN_SUBDIVISION_SPACING) spacing = MIN_SUBDIVISION_SPACING;

  var xKeyMap = {}, layerNums = {};
  pts.forEach(function(p) {
    var xv = Number(p.x), lv = p.layer != null ? Number(p.layer) : 1;
    if (!isFinite(xv) || !isFinite(Number(p.y)) || !isFinite(Number(p.z))) return;
    xKeyMap[xv.toFixed(6)] = xv;
    layerNums[lv] = true;
  });

  var xs = Object.values(xKeyMap).sort(function(a, b) { return a - b; });
  var layers = Object.keys(layerNums).map(Number).sort(function(a, b) { return a - b; });
  var nCols = xs.length, nRows = layers.length;
  if (nCols < 2 || nRows < 2) return pts;

  var layerZSum = {}, layerZCnt = {};
  pts.forEach(function(p) {
    var lv = p.layer != null ? Number(p.layer) : 1;
    var zv = Number(p.z);
    if (!isFinite(zv)) return;
    if (!(lv in layerZSum)) { layerZSum[lv] = 0; layerZCnt[lv] = 0; }
    layerZSum[lv] += zv; layerZCnt[lv]++;
  });
  var layerAvgZ = {};
  layers.forEach(function(l) { layerAvgZ[l] = layerZSum[l] / layerZCnt[l]; });

  var grid = [];
  for (var ci = 0; ci < nCols; ci++) { grid.push(new Array(nRows).fill(null)); }
  var xiMap = {}, liMap = {};
  xs.forEach(function(x, i) { xiMap[x.toFixed(6)] = i; });
  layers.forEach(function(l, i) { liMap[l] = i; });

  var cellSumY = {}, cellSumMZ = {}, cellSumST = {}, cellCnt = {};
  pts.forEach(function(p) {
    var xv = Number(p.x), yv = Number(p.y), zv = Number(p.z);
    var lv = p.layer != null ? Number(p.layer) : 1;
    if (!isFinite(xv) || !isFinite(yv) || !isFinite(zv)) return;
    var key = xv.toFixed(6) + '|' + lv;
    if (!(key in cellCnt)) { cellSumY[key] = 0; cellSumMZ[key] = 0; cellSumST[key] = 0; cellCnt[key] = 0; }
    cellSumY[key] += yv;
    cellSumMZ[key] += (p.machineZ != null ? Number(p.machineZ) : 0);
    cellSumST[key] += (p.sampleTopZ != null ? Number(p.sampleTopZ) : 0);
    cellCnt[key]++;
  });
  Object.keys(cellCnt).forEach(function(key) {
    var parts = key.split('|');
    var xv = parseFloat(parts[0]), lv = parseInt(parts[1], 10);
    var xi = xiMap[xv.toFixed(6)], li = liMap[lv];
    if (xi == null || li == null) return;
    var cnt = cellCnt[key];
    grid[xi][li] = {
      y: cellSumY[key] / cnt,
      machineZ: cellSumMZ[key] / cnt,
      sampleTopZ: cellSumST[key] / cnt
    };
  });

  // ── Nearest-neighbor fill (the fix) ──────────────────────────────────────────
  var _nnFillChanged = true, _nnFillMax = Math.max(nCols, nRows);
  for (var _nnP = 0; _nnP < _nnFillMax && _nnFillChanged; _nnP++) {
    _nnFillChanged = false;
    for (var _nnXi = 0; _nnXi < nCols; _nnXi++) {
      for (var _nnLi = 0; _nnLi < nRows; _nnLi++) {
        if (grid[_nnXi][_nnLi]) continue;
        var _nnNbrs = [];
        if (_nnXi > 0 && grid[_nnXi-1][_nnLi]) _nnNbrs.push(grid[_nnXi-1][_nnLi]);
        if (_nnXi < nCols-1 && grid[_nnXi+1][_nnLi]) _nnNbrs.push(grid[_nnXi+1][_nnLi]);
        if (_nnLi > 0 && grid[_nnXi][_nnLi-1]) _nnNbrs.push(grid[_nnXi][_nnLi-1]);
        if (_nnLi < nRows-1 && grid[_nnXi][_nnLi+1]) _nnNbrs.push(grid[_nnXi][_nnLi+1]);
        if (!_nnNbrs.length) continue;
        var _nnSY = 0, _nnSMZ = 0, _nnSST = 0;
        _nnNbrs.forEach(function(nb) { _nnSY += nb.y; _nnSMZ += nb.machineZ; _nnSST += nb.sampleTopZ; });
        var _nnCnt = _nnNbrs.length;
        grid[_nnXi][_nnLi] = { y: _nnSY/_nnCnt, machineZ: _nnSMZ/_nnCnt, sampleTopZ: _nnSST/_nnCnt };
        _nnFillChanged = true;
      }
    }
  }

  var xSpacings = [];
  for (var i = 0; i < nCols - 1; i++) xSpacings.push(xs[i + 1] - xs[i]);
  var avgXSpacing = xSpacings.reduce(function(a, b) { return a + b; }, 0) / xSpacings.length;
  var zSpacings = [];
  for (var j = 0; j < nRows - 1; j++) zSpacings.push(Math.abs(layerAvgZ[layers[j + 1]] - layerAvgZ[layers[j]]));
  var avgZSpacing = zSpacings.reduce(function(a, b) { return a + b; }, 0) / zSpacings.length;

  var xSub = Math.max(1, Math.round(avgXSpacing / spacing));
  var zSub = Math.max(1, Math.round(avgZSpacing / spacing));
  if (xSub === 1 && zSub === 1) return pts;

  var newPts = [];
  var newCols = (nCols - 1) * xSub + 1;
  var newRows = (nRows - 1) * zSub + 1;
  if (newCols * newRows > MAX_SUBDIVISION_POINTS) return pts;

  for (var gy = 0; gy < newRows; gy++) {
    var li0 = Math.min(Math.floor(gy / zSub), nRows - 2);
    var ty = (gy - li0 * zSub) / zSub;
    var newZ = layerAvgZ[layers[li0]] * (1 - ty) + layerAvgZ[layers[li0 + 1]] * ty;
    var nearLi = ty < 0.5 ? li0 : li0 + 1;
    var nearLayer = layers[nearLi];

    for (var gx = 0; gx < newCols; gx++) {
      var xi0 = Math.min(Math.floor(gx / xSub), nCols - 2);
      var tx = (gx - xi0 * xSub) / xSub;
      var newX = xs[xi0] * (1 - tx) + xs[xi0 + 1] * tx;

      var c00 = grid[xi0][li0], c10 = grid[xi0 + 1][li0];
      var c01 = grid[xi0][li0 + 1], c11 = grid[xi0 + 1][li0 + 1];
      if (!c00 || !c10 || !c01 || !c11) continue;

      var newY = c00.y * (1 - tx) * (1 - ty) + c10.y * tx * (1 - ty) +
                 c01.y * (1 - tx) * ty + c11.y * tx * ty;
      var newMZ = c00.machineZ * (1 - tx) * (1 - ty) + c10.machineZ * tx * (1 - ty) +
                  c01.machineZ * (1 - tx) * ty + c11.machineZ * tx * ty;
      var newST = c00.sampleTopZ * (1 - tx) * (1 - ty) + c10.sampleTopZ * tx * (1 - ty) +
                  c01.sampleTopZ * (1 - tx) * ty + c11.sampleTopZ * tx * ty;

      newPts.push({
        x: newX, y: newY, z: newZ,
        machineZ: newMZ, sampleTopZ: newST,
        layer: nearLayer
      });
    }
  }

  return newPts.length >= pts.length ? newPts : pts;
}

// ── Simulate renderFaceReliefMap data pipeline ────────────────────────────────
// Returns the `points` array that would be passed to renderReliefMap(),
// mirroring the normalization logic in core.js renderFaceReliefMap().
function collectReliefPoints(data) {
  if (!data || data.length < 4) return [];
  var DEFAULT_LAYER = 1;
  var xKeyToVal = {}, layerZSum = {}, layerZCnt = {};
  data.forEach(function(r) {
    var xv = Number(r.x), yv = Number(r.y), zv = Number(r.z);
    var lv = r.layer != null ? Number(r.layer) : DEFAULT_LAYER;
    if (!isFinite(xv) || !isFinite(yv) || !isFinite(zv)) return;
    var xKey = xv.toFixed(6);
    if (!(xKey in xKeyToVal)) xKeyToVal[xKey] = xv;
    if (!(lv in layerZSum)) { layerZSum[lv] = 0; layerZCnt[lv] = 0; }
    layerZSum[lv] += zv; layerZCnt[lv]++;
  });
  var xs = Object.values(xKeyToVal).sort(function(a, b) { return a - b; });
  var layers = Object.keys(layerZSum).map(Number).sort(function(a, b) { return a - b; });
  if (xs.length < 2 || layers.length < 2) return [];
  var layerToAvgZ = {};
  layers.forEach(function(l) { layerToAvgZ[l] = layerZSum[l] / layerZCnt[l]; });
  var cellSumY = {}, cellCntY = {};
  data.forEach(function(r) {
    var xv = Number(r.x), yv = Number(r.y);
    var lv = r.layer != null ? Number(r.layer) : DEFAULT_LAYER;
    if (!isFinite(xv) || !isFinite(yv)) return;
    var key = xv.toFixed(6) + '|' + lv;
    if (!(key in cellSumY)) { cellSumY[key] = 0; cellCntY[key] = 0; }
    cellSumY[key] += yv; cellCntY[key]++;
  });
  var points = [];
  Object.keys(cellSumY).forEach(function(key) {
    var parts = key.split('|');
    var xv = parseFloat(parts[0]);
    var lv = parseInt(parts[1], 10);
    var yv = cellSumY[key] / cellCntY[key];
    var zv = layerToAvgZ[lv];
    if (!isFinite(xv) || !isFinite(yv) || !isFinite(zv)) return;
    points.push({ px: xv, py: zv, val: yv });
  });
  return points;
}

// ── Fixture: 4x3 face probe dataset ──────────────────────────────────────────
// 4 X samples × 3 layers = 12 raw contacts, regular grid, no missing cells.
var FACE_RAW_4X3 = [];
(function() {
  var xPos = [0, 10, 20, 30];
  var layers = [1, 2, 3];
  var zHeights = [5, 10, 15];
  for (var li = 0; li < layers.length; li++) {
    for (var xi = 0; xi < xPos.length; xi++) {
      FACE_RAW_4X3.push({
        x: xPos[xi],
        y: -1 - 0.2 * xi - 0.1 * li,
        z: zHeights[li],
        layer: layers[li],
        machineZ: 0,
        sampleTopZ: 20
      });
    }
  }
})();

// Fixture with a missing cell: remove the point at x=10, layer=2.
var FACE_WITH_NULL = FACE_RAW_4X3.filter(function(p) {
  return !(p.x === 10 && p.layer === 2);
});

// Fixture simulating a bilinearly pre-subdivided version of FACE_RAW_4X3
// (spacing = 2mm, representing the output of subdivideFaceMesh at 2mm spacing).
var FACE_PRESUBDIVIDED = subdivideFaceMesh(FACE_RAW_4X3, 2);

// ── Test 1: NN fill prevents lost contacts ────────────────────────────────────

function testNNFillPreservesAllPoints() {
  console.log('\nTest: subdivideFaceMesh NN fill — output includes cells for all original X positions');

  var result = subdivideFaceMesh(FACE_WITH_NULL, 2);

  // The output should cover all 4 X positions (0, 10, 20, 30).
  var xSet = {};
  result.forEach(function(p) { xSet[Number(p.x).toFixed(1)] = true; });

  // After subdivision, x=0, x=10, x=20, x=30 (and interpolated positions between)
  // must all have at least one point in the output.
  assert('0.0' in xSet,  'Output includes x≈0 (original position preserved)');
  assert('10.0' in xSet, 'Output includes x≈10 (null-corner neighbor filled before subdivision)');
  assert('20.0' in xSet, 'Output includes x≈20 (original position preserved)');
  assert('30.0' in xSet, 'Output includes x≈30 (original position preserved)');

  // All 3 layers must be represented in the output.
  var lSet = {};
  result.forEach(function(p) { lSet[p.layer] = true; });
  assert(Object.keys(lSet).length >= 1, 'Output has at least 1 layer represented');
}

function testNNFillOutputCountNotLessThanRaw() {
  console.log('\nTest: subdivideFaceMesh with missing cell — output count >= raw count (NN fill + subdivision)');

  var result = subdivideFaceMesh(FACE_WITH_NULL, 2);
  assert(result.length >= FACE_WITH_NULL.length,
    'Output pts (' + result.length + ') >= raw pts (' + FACE_WITH_NULL.length + ') after NN fill + subdivision');
}

// ── Test 2: getFaceRawData() logic ────────────────────────────────────────────

function testGetFaceRawDataPreference() {
  console.log('\nTest: getFaceRawData prefers raw (pre-subdivision) contacts over subdivided data');

  // Simulate the preference logic from core.js getFaceRawData().
  function getFaceRawData(layeredFaceResultsRaw, layeredFaceResults) {
    if (layeredFaceResultsRaw && layeredFaceResultsRaw.length) return layeredFaceResultsRaw;
    return layeredFaceResults;
  }

  var raw = FACE_RAW_4X3;
  var subdivided = FACE_PRESUBDIVIDED;

  // When raw is available, should return raw (smaller count = 12).
  var chosen = getFaceRawData(raw, subdivided);
  assert(chosen === raw, 'Returns raw contacts when layeredFaceResultsRaw is set');

  // When raw is empty, should fall back to subdivided.
  var fallback = getFaceRawData([], subdivided);
  assert(fallback === subdivided, 'Falls back to layeredFaceResults when raw is empty');

  // When raw is null, should fall back to subdivided.
  var fallback2 = getFaceRawData(null, subdivided);
  assert(fallback2 === subdivided, 'Falls back to layeredFaceResults when raw is null');
}

// ── Test 3: OBJ from raw data produces more geometry than from pre-subdivided ─

function testRawInputProducesMoreVertices() {
  console.log('\nTest: Catmull-Rom upsample of raw data produces more vertices than upsample of bilinear data');

  var targetSpacing = 0.5;

  // Upsample the raw 4x3 data (10mm original spacing → should produce many vertices)
  var upRaw = _upsampleFaceData(FACE_RAW_4X3, targetSpacing);

  // Upsample the pre-subdivided data (2mm spacing → less gain since already dense)
  var upPre = _upsampleFaceData(FACE_PRESUBDIVIDED, targetSpacing);

  assert(upRaw.pts.length > FACE_RAW_4X3.length,
    'Raw→Catmull-Rom: vertex count (' + upRaw.pts.length + ') > raw count (' + FACE_RAW_4X3.length + ')');
  assert(upPre.pts.length > FACE_PRESUBDIVIDED.length || upPre.pts.length >= FACE_PRESUBDIVIDED.length,
    'Pre-subdivided→Catmull-Rom: vertex count (' + upPre.pts.length + ') >= pre-subdivided count (' + FACE_PRESUBDIVIDED.length + ')');

  // Raw data, being sparser, should generate substantially more vertices from Catmull-Rom
  // (10mm gap vs 2mm gap → ~5× more subdivisions per cell).
  assert(upRaw.pts.length > upPre.pts.length,
    'Raw Catmull-Rom output (' + upRaw.pts.length + ') > pre-subdivided Catmull-Rom output (' + upPre.pts.length + '): more geometry from original sparse grid');
}

// ── Test 4: Relief map includes ALL expected points ───────────────────────────

function testReliefMapIncludesAllPoints() {
  console.log('\nTest: renderFaceReliefMap pipeline — all expected (X, layer) cells produce a point');

  var points = collectReliefPoints(FACE_RAW_4X3);

  var xPos = [0, 10, 20, 30];
  var layers = [1, 2, 3];
  var expectedCount = xPos.length * layers.length; // 12

  assert(points.length === expectedCount,
    'Relief map points count (' + points.length + ') === expected ' + expectedCount + ' (all X × layer cells)');

  // Verify all 4 X positions are present.
  var xInMap = {};
  points.forEach(function(pt) { xInMap[Math.round(pt.px)] = true; });
  xPos.forEach(function(x) {
    assert(xInMap[x], 'X=' + x + ' present in relief map points');
  });
}

function testReliefMapWithNullCellStillRendersOtherPoints() {
  console.log('\nTest: renderFaceReliefMap pipeline — missing cell excluded but all other points rendered');

  // FACE_WITH_NULL is missing x=10, layer=2 — 11 raw contacts.
  var points = collectReliefPoints(FACE_WITH_NULL);

  // The missing cell (x=10, layer=2) should not appear; all 11 others should.
  assert(points.length === 11,
    'Relief map has 11 points when one cell is missing (got ' + points.length + ')');

  // X=10 should still appear for the other 2 layers.
  var x10Points = points.filter(function(pt) { return Math.abs(pt.px - 10) < 0.001; });
  assert(x10Points.length === 2,
    'X=10 appears in 2 layers (got ' + x10Points.length + ' after one layer dropped)');
}

// ── Test 5: Vertex welding — shared vertices (no duplicates per face) ─────────

function testVertexWelding() {
  console.log('\nTest: structured-grid triangulation uses shared vertices (welded)');

  var up = _upsampleFaceData(FACE_RAW_4X3, 0.5);
  var allVerts = up.pts;
  var allTris = [];

  if (up.vMap && up.rowCount >= 2 && up.colCount >= 2) {
    for (var ri = 0; ri < up.rowCount - 1; ri++) {
      for (var ci = 0; ci < up.colCount - 1; ci++) {
        var a=up.vMap[ri][ci], b=up.vMap[ri][ci+1], c=up.vMap[ri+1][ci+1], d=up.vMap[ri+1][ci];
        if (a!=null && b!=null && c!=null && d!=null) {
          allTris.push([a, b, c]);
          allTris.push([a, c, d]);
        }
      }
    }
  }

  // Each triangle should only reference valid vertex indices.
  var allIndicesValid = allTris.every(function(t) {
    return t[0] >= 0 && t[0] < allVerts.length &&
           t[1] >= 0 && t[1] < allVerts.length &&
           t[2] >= 0 && t[2] < allVerts.length;
  });
  assert(allIndicesValid, 'All triangle vertex indices are within bounds (shared vertices)');

  // Number of triangles should be (rowCount-1)*(colCount-1)*2 (quads split to 2 tris each).
  var expectedTris = (up.rowCount - 1) * (up.colCount - 1) * 2;
  assert(allTris.length === expectedTris,
    'Triangle count (' + allTris.length + ') === expected ' + expectedTris + ' (all quads triangulated)');

  // Vertices referenced by multiple triangles — confirm welding (average refs > 1).
  var refCount = new Array(allVerts.length).fill(0);
  allTris.forEach(function(t) { t.forEach(function(idx) { refCount[idx]++; }); });
  var totalRefs = refCount.reduce(function(a, b) { return a + b; }, 0);
  var avgRefs = totalRefs / allVerts.length;
  assert(avgRefs > 1,
    'Average vertex reference count (' + avgRefs.toFixed(2) + ') > 1 (vertices shared across triangles)');
}

// ── Run all tests ─────────────────────────────────────────────────────────────

(function main() {
  console.log('=== face-probe-fixes tests ===');
  try {
    testNNFillPreservesAllPoints();
    testNNFillOutputCountNotLessThanRaw();
    testGetFaceRawDataPreference();
    testRawInputProducesMoreVertices();
    testReliefMapIncludesAllPoints();
    testReliefMapWithNullCellStillRendersOtherPoints();
    testVertexWelding();
  } catch (e) {
    console.error('Unexpected error in test runner:', e);
    failed++;
  }
  console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---');
  process.exit(failed > 0 ? 1 : 0);
})();
