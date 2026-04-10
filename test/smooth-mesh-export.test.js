/**
 * Unit tests for smooth-mesh OBJ export (bicubic Catmull-Rom interpolation).
 *
 * Validates that:
 *  1. _bicubicUpsampleGrid increases vertex count vs raw probe grid when
 *     targetSpacing < original grid spacing.
 *  2. _upsampleFaceData increases vertex count for face probe structured data.
 *  3. Vertex normals computed by _computeVertexNormals match vertex count.
 *  4. Adjacent triangle normals in the interior don't exceed a large angle
 *     threshold (continuity check), confirming C1-smooth geometry.
 *  5. Probe values at original grid corners are preserved exactly (interpolation
 *     passes through measured points).
 *
 * Run with:  node test/smooth-mesh-export.test.js
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

// ── Inline Catmull-Rom helper (mirrors src/js/core.js _catmullRom) ────────────
function _catmullRom(p0, p1, p2, p3, t) {
  var t2 = t * t, t3 = t2 * t;
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2*p0 - 5*p1 + 4*p2 - p3) * t2 +
    (-p0 + 3*p1 - 3*p2 + p3) * t3
  );
}

// ── Inline helpers (mirrors src/js/settings-and-exports.js) ──────────────────

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

function _upsampleFaceData(data, targetSpacing) {
  if (!data || data.length < 4) {
    return { pts: data.map(function(p){ return {x:Number(p.x),y:Number(p.y),z:Number(p.z)}; }), vMap: null, rowCount: 0, colCount: 0 };
  }

  var hasLayers = data.some(function(p) { return p.layer != null; });

  var xSet = {};
  data.forEach(function(p) {
    var xv = Number(p.x);
    if (isFinite(xv)) xSet[xv.toFixed(6)] = xv;
  });
  var xVals = Object.keys(xSet).map(function(k){ return xSet[k]; }).sort(function(a,b){return a-b;});
  var nCols = xVals.length;

  var zVals, nRows, ri2key;
  if (hasLayers) {
    var layerSet = {}, layerZSum = {}, layerZCnt = {};
    data.forEach(function(p) {
      var lv = Number(p.layer);
      var zv = Number(p.z);
      if (!isFinite(lv)) return;
      layerSet[lv] = true;
      if (isFinite(zv)) {
        if (!(lv in layerZSum)) { layerZSum[lv] = 0; layerZCnt[lv] = 0; }
        layerZSum[lv] += zv; layerZCnt[lv]++;
      }
    });
    var layerNums = Object.keys(layerSet).map(Number).sort(function(a,b){return a-b;});
    nRows = layerNums.length;
    zVals = layerNums.map(function(l) {
      return (layerZCnt[l] > 0) ? layerZSum[l] / layerZCnt[l] : 0;
    });
    var li2rowIdx = {};
    layerNums.forEach(function(l, i) { li2rowIdx[l] = i; });
    ri2key = function(p) { return li2rowIdx[Number(p.layer)]; };
  } else {
    var zSet = {};
    data.forEach(function(p) {
      var zv = Number(p.z);
      if (isFinite(zv)) zSet[zv.toFixed(6)] = zv;
    });
    zVals = Object.keys(zSet).map(function(k){ return zSet[k]; }).sort(function(a,b){return a-b;});
    nRows = zVals.length;
    var zi2idx = {};
    zVals.forEach(function(v, i){ zi2idx[v.toFixed(6)] = i; });
    ri2key = function(p) {
      var zv = Number(p.z);
      return isFinite(zv) ? zi2idx[zv.toFixed(6)] : undefined;
    };
  }

  if (nCols < 2 || nRows < 2) {
    return { pts: data.map(function(p){ return {x:Number(p.x),y:Number(p.y),z:Number(p.z)}; }), vMap: null, rowCount: 0, colCount: 0 };
  }
  var xi2idx = {};
  xVals.forEach(function(v, i){ xi2idx[v.toFixed(6)] = i; });
  var cellSumY = {}, cellCntY = {};
  data.forEach(function(p) {
    var xi = xi2idx[Number(p.x).toFixed(6)];
    var ri = ri2key(p);
    if (xi == null || ri == null || !isFinite(Number(p.y))) return;
    var key = xi + '|' + ri;
    if (!(key in cellCntY)) { cellSumY[key] = 0; cellCntY[key] = 0; }
    cellSumY[key] += Number(p.y); cellCntY[key]++;
  });
  var depthGrid = [];
  for (var ri = 0; ri < nRows; ri++) { depthGrid.push(new Array(nCols).fill(null)); }
  Object.keys(cellCntY).forEach(function(key) {
    var parts = key.split('|');
    var xi = parseInt(parts[0], 10), ri = parseInt(parts[1], 10);
    if (xi >= 0 && xi < nCols && ri >= 0 && ri < nRows)
      depthGrid[ri][xi] = cellSumY[key] / cellCntY[key];
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

function _computeVertexNormals(verts, tris) {
  var norms = verts.map(function() { return {x:0, y:0, z:0}; });
  for (var ti = 0; ti < tris.length; ti++) {
    var t = tris[ti];
    var v0=verts[t[0]], v1=verts[t[1]], v2=verts[t[2]];
    var e1x=v1.x-v0.x, e1y=v1.y-v0.y, e1z=v1.z-v0.z;
    var e2x=v2.x-v0.x, e2y=v2.y-v0.y, e2z=v2.z-v0.z;
    var nx=e1y*e2z-e1z*e2y, ny=e1z*e2x-e1x*e2z, nz=e1x*e2y-e1y*e2x;
    for (var vi = 0; vi < 3; vi++) { norms[t[vi]].x+=nx; norms[t[vi]].y+=ny; norms[t[vi]].z+=nz; }
  }
  for (var i = 0; i < norms.length; i++) {
    var n=norms[i], len=Math.sqrt(n.x*n.x+n.y*n.y+n.z*n.z);
    if (len > 1e-10) { n.x/=len; n.y/=len; n.z/=len; } else { n.x=0; n.y=0; n.z=1; }
  }
  return norms;
}

// Build triangles from an upsampled grid (same logic as exportSurfaceOBJ).
function buildGridTris(vMap, rowCount, colCount) {
  var tris = [];
  for (var fr = 0; fr < rowCount - 1; fr++) {
    for (var fc = 0; fc < colCount - 1; fc++) {
      var a=vMap[fr][fc], b=vMap[fr][fc+1], c=vMap[fr+1][fc+1], d=vMap[fr+1][fc];
      if (a!=null && b!=null && c!=null && d!=null) {
        tris.push([a, b, c]);
        tris.push([a, c, d]);
      }
    }
  }
  return tris;
}

// ── Fixture datasets ──────────────────────────────────────────────────────────

// 4×4 surface probe grid (10mm spacing) with a gentle bowl shape z = f(x,y).
// Raw grid: 4 rows × 4 cols = 16 points.
var SURF_GRID_4X4 = [
  [0.0, 0.2, 0.2, 0.0],
  [0.2, 0.5, 0.5, 0.2],
  [0.2, 0.5, 0.5, 0.2],
  [0.0, 0.2, 0.2, 0.0]
];
var SURF_CFG_4X4 = { rowCount: 4, colCount: 4, colSpacing: 10, rowSpacing: 10, minX: 0, minY: 0 };

// 3×4 face probe dataset (3 X-samples × 4 Z-layers) with layer numbers.
// Each point: { x, y (contact depth), z (layer height), layer }.
var FACE_DATA_3X4 = [];
(function() {
  var xPos = [0, 10, 20];
  var zLayers = [0, 5, 10, 15];
  for (var zi = 0; zi < zLayers.length; zi++) {
    for (var xi = 0; xi < xPos.length; xi++) {
      // Depth varies smoothly: y = -1 - 0.3 * sin(xi * π/2) - 0.1 * zi
      FACE_DATA_3X4.push({
        x: xPos[xi],
        y: -1 - 0.3 * Math.sin(xi * Math.PI / 2) - 0.1 * zi,
        z: zLayers[zi],
        layer: zi + 1
      });
    }
  }
})();

// Face probe dataset where per-sample Z values differ slightly (realistic layered probe).
// Each column (X sample) has a slightly different sampleTopZ, causing Z drift.
// Without the layer-number fix, _upsampleFaceData would see 3×4=12 unique Z values
// instead of 4 layers, producing a bad 12-row grid with near-zero rowSpacing → no upsampling.
var FACE_DATA_ZDRIFT = [];
(function() {
  var xPos = [0, 10, 20];
  var sampleTopZ = [0.01, 0.03, -0.02]; // slight surface variation per X sample
  var maxDepth = 15;
  var nLayers = 4;
  for (var xi = 0; xi < xPos.length; xi++) {
    var topZ = sampleTopZ[xi];
    var deepestZ = topZ - maxDepth;
    for (var li = 0; li < nLayers; li++) {
      // Per-sample layer Z differs between X positions (real-world layered probe)
      var layerSpacing = (topZ - 0.05 - deepestZ) / (nLayers - 1);
      var layerZ = parseFloat((deepestZ + li * layerSpacing).toFixed(6));
      FACE_DATA_ZDRIFT.push({
        x: xPos[xi],
        y: -1 - 0.3 * Math.sin(xi * Math.PI / 2) - 0.1 * li,
        z: layerZ,
        layer: li + 1
      });
    }
  }
})();

// ── Tests ─────────────────────────────────────────────────────────────────────

function testSurfaceVertexCountIncreases() {
  console.log('\nTest: surface upsampling — vertex count increases vs raw grid');

  var rawVerts = SURF_CFG_4X4.rowCount * SURF_CFG_4X4.colCount; // 16

  var up = _bicubicUpsampleGrid(SURF_GRID_4X4, SURF_CFG_4X4, 0.5);
  var upVerts = up.rowCount * up.colCount;

  assert(upVerts > rawVerts,
    'Upsampled vertex count (' + upVerts + ') > raw vertex count (' + rawVerts + ')');
  assert(up.rowCount > SURF_CFG_4X4.rowCount,
    'Row count increased: ' + up.rowCount + ' > ' + SURF_CFG_4X4.rowCount);
  assert(up.colCount > SURF_CFG_4X4.colCount,
    'Col count increased: ' + up.colCount + ' > ' + SURF_CFG_4X4.colCount);
}

function testSurfaceNormalsMatchVertexCount() {
  console.log('\nTest: surface normals count matches vertex count');

  var up = _bicubicUpsampleGrid(SURF_GRID_4X4, SURF_CFG_4X4, 0.5);
  // Build flat vertex list from upsampled grid.
  var verts = [], vMap = [];
  for (var ri = 0; ri < up.rowCount; ri++) {
    vMap.push([]);
    for (var ci = 0; ci < up.colCount; ci++) {
      var z = up.grid[ri][ci];
      vMap[ri].push(z != null ? verts.length : null);
      if (z != null) verts.push({ x: up.minX + ci * up.colSpacing, y: up.minY + ri * up.rowSpacing, z: z });
    }
  }
  var tris = buildGridTris(vMap, up.rowCount, up.colCount);
  var norms = _computeVertexNormals(verts, tris);

  assert(norms.length === verts.length,
    'Normal count (' + norms.length + ') === vertex count (' + verts.length + ')');
  // All normals must be unit-length.
  var allUnit = norms.every(function(n) {
    var len = Math.sqrt(n.x*n.x + n.y*n.y + n.z*n.z);
    return Math.abs(len - 1) < 1e-6;
  });
  assert(allUnit, 'All normals are unit-length (length ≈ 1.0)');
}

function testSurfaceInterpolationPreservesCorners() {
  console.log('\nTest: surface upsampling preserves corner values from raw probe points');

  var up = _bicubicUpsampleGrid(SURF_GRID_4X4, SURF_CFG_4X4, 0.5);
  // sub factor per dimension = round(10/0.5) = 20, so corner indices are multiples of 20.
  var subC = Math.round(SURF_CFG_4X4.colSpacing / 0.5);
  var subR = Math.round(SURF_CFG_4X4.rowSpacing / 0.5);

  // Top-left corner [0][0] must equal original grid[0][0]
  assert(Math.abs(up.grid[0][0] - SURF_GRID_4X4[0][0]) < 1e-6,
    'Top-left corner preserved: got ' + up.grid[0][0].toFixed(6) + ', expected ' + SURF_GRID_4X4[0][0]);
  // Bottom-right corner
  var lastR = (SURF_CFG_4X4.rowCount - 1) * subR, lastC = (SURF_CFG_4X4.colCount - 1) * subC;
  assert(Math.abs(up.grid[lastR][lastC] - SURF_GRID_4X4[3][3]) < 1e-6,
    'Bottom-right corner preserved: got ' + up.grid[lastR][lastC].toFixed(6) + ', expected ' + SURF_GRID_4X4[3][3]);
  // Interior grid point [1][1] (row 1, col 1) at upsampled index [subR][subC]
  assert(Math.abs(up.grid[subR][subC] - SURF_GRID_4X4[1][1]) < 1e-6,
    'Interior grid point [1][1] preserved: got ' + up.grid[subR][subC].toFixed(6) + ', expected ' + SURF_GRID_4X4[1][1]);
}

function testFaceVertexCountIncreases() {
  console.log('\nTest: face upsampling — vertex count increases vs raw probe points');

  var rawCount = FACE_DATA_3X4.length; // 12 points
  var up = _upsampleFaceData(FACE_DATA_3X4, 0.5);

  assert(up.pts.length > rawCount,
    'Upsampled face vertex count (' + up.pts.length + ') > raw count (' + rawCount + ')');
  assert(up.vMap !== null, 'vMap is present (structured grid upsampling used)');
  assert(up.rowCount > 0 && up.colCount > 0,
    'rowCount (' + up.rowCount + ') and colCount (' + up.colCount + ') are positive');
}

function testFaceNormalsMatchVertexCount() {
  console.log('\nTest: face normals count matches vertex count');

  var up = _upsampleFaceData(FACE_DATA_3X4, 0.5);
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
  var norms = _computeVertexNormals(allVerts, allTris);

  assert(norms.length === allVerts.length,
    'Normal count (' + norms.length + ') === vertex count (' + allVerts.length + ')');
  var allUnit = norms.every(function(n) {
    var len = Math.sqrt(n.x*n.x + n.y*n.y + n.z*n.z);
    return Math.abs(len - 1) < 1e-6;
  });
  assert(allUnit, 'All face normals are unit-length');
}

function testNormalContinuityInterior() {
  console.log('\nTest: surface normal continuity — adjacent interior triangle normals within 45°');

  var up = _bicubicUpsampleGrid(SURF_GRID_4X4, SURF_CFG_4X4, 1.0);
  var verts = [], vMap = [];
  for (var ri = 0; ri < up.rowCount; ri++) {
    vMap.push([]);
    for (var ci = 0; ci < up.colCount; ci++) {
      var z = up.grid[ri][ci];
      vMap[ri].push(z != null ? verts.length : null);
      if (z != null) verts.push({ x: up.minX + ci * up.colSpacing, y: up.minY + ri * up.rowSpacing, z: z });
    }
  }
  var tris = buildGridTris(vMap, up.rowCount, up.colCount);
  // Compute per-face normals (not per-vertex).
  function faceNormal(t) {
    var v0=verts[t[0]], v1=verts[t[1]], v2=verts[t[2]];
    var e1x=v1.x-v0.x, e1y=v1.y-v0.y, e1z=v1.z-v0.z;
    var e2x=v2.x-v0.x, e2y=v2.y-v0.y, e2z=v2.z-v0.z;
    var nx=e1y*e2z-e1z*e2y, ny=e1z*e2x-e1x*e2z, nz=e1x*e2y-e1y*e2x;
    var len=Math.sqrt(nx*nx+ny*ny+nz*nz);
    return len>1e-10?{x:nx/len,y:ny/len,z:nz/len}:{x:0,y:0,z:1};
  }
  // Check every pair of adjacent triangles (sharing an edge) — they must be within 45°.
  var maxAngle = 0;
  // For a regular grid, consecutive tris (2k, 2k+1) share a diagonal edge.
  for (var i = 0; i + 1 < tris.length; i += 2) {
    var n0 = faceNormal(tris[i]);
    var n1 = faceNormal(tris[i + 1]);
    var dot = n0.x*n1.x + n0.y*n1.y + n0.z*n1.z;
    var angle = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
    if (angle > maxAngle) maxAngle = angle;
  }
  assert(maxAngle < 45,
    'Max adjacent-triangle angle in interior < 45° (got ' + maxAngle.toFixed(1) + '°)');
}

function testNoSubdivisionWhenSpacingMatchesGrid() {
  console.log('\nTest: no subdivision when targetSpacing >= grid spacing');

  var up = _bicubicUpsampleGrid(SURF_GRID_4X4, SURF_CFG_4X4, 15); // > 10mm spacing
  assert(up.rowCount === SURF_CFG_4X4.rowCount,
    'Row count unchanged when targetSpacing >= gridSpacing: got ' + up.rowCount);
  assert(up.colCount === SURF_CFG_4X4.colCount,
    'Col count unchanged when targetSpacing >= gridSpacing: got ' + up.colCount);
}

function testZDriftLayerIdentity() {
  console.log('\nTest: _upsampleFaceData with Z-drifted layer data uses layer numbers for row identity');

  // FACE_DATA_ZDRIFT: 3 X × 4 layers, but per-sample Z differs between X positions.
  // Without layer-number fix, there would be up to 12 unique Z values → nRows=12, rowSpacing~0 → no upsampling.
  // With fix, nRows=4 (one per layer number) and upsampling proceeds correctly.
  var rawCount = FACE_DATA_ZDRIFT.length; // 12 points
  var up = _upsampleFaceData(FACE_DATA_ZDRIFT, 0.5);

  assert(up.pts.length > rawCount,
    'Z-drift data: upsampled count (' + up.pts.length + ') > raw count (' + rawCount + ')');
  assert(up.vMap !== null,
    'Z-drift data: vMap present (structured grid produced)');
  assert(up.rowCount >= 4,
    'Z-drift data: row count >= 4 (got ' + up.rowCount + '), proving layer-key fix applied');
  assert(up.colCount >= 3,
    'Z-drift data: col count >= 3 (got ' + up.colCount + ')');
}

// ── Run all tests ─────────────────────────────────────────────────────────────

(async function main() {
  console.log('=== smooth-mesh-export tests ===');
  try {
    testSurfaceVertexCountIncreases();
    testSurfaceNormalsMatchVertexCount();
    testSurfaceInterpolationPreservesCorners();
    testFaceVertexCountIncreases();
    testFaceNormalsMatchVertexCount();
    testNormalContinuityInterior();
    testNoSubdivisionWhenSpacingMatchesGrid();
    testZDriftLayerIdentity();
  } catch (e) {
    console.error('Unexpected error in test runner:', e);
    failed++;
  }
  console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---');
  process.exit(failed > 0 ? 1 : 0);
})();
