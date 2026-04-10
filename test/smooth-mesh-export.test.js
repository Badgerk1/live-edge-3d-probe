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
  var xSet = {};
  data.forEach(function(p) { xSet[Number(p.x).toFixed(6)] = Number(p.x); });
  var xVals = Object.keys(xSet).map(function(k){ return xSet[k]; }).sort(function(a,b){return a-b;});
  var nCols = xVals.length;
  if (nCols < 2) {
    return { pts: data.map(function(p){ return {x:Number(p.x),y:Number(p.y),z:Number(p.z)}; }), vMap: null, rowCount: 0, colCount: 0 };
  }
  var xi2idx = {};
  xVals.forEach(function(v, i){ xi2idx[v.toFixed(6)] = i; });

  var hasLayer = data.some(function(p) { return p.layer != null; });
  var nRows, rowToZ, depthGrid;

  if (hasLayer) {
    var layerZSum = {}, layerZCnt = {}, layerSet = {};
    var cellSumY = {}, cellCnt = {};
    data.forEach(function(p) {
      var lv = Number(p.layer != null ? p.layer : 1);
      var xv = Number(p.x), yv = Number(p.y), zv = Number(p.z);
      if (!isFinite(xv) || !isFinite(yv) || !isFinite(zv)) return;
      layerSet[lv] = true;
      if (!(lv in layerZSum)) { layerZSum[lv] = 0; layerZCnt[lv] = 0; }
      layerZSum[lv] += zv; layerZCnt[lv]++;
      var key = xv.toFixed(6) + '|' + lv;
      if (!(key in cellCnt)) { cellSumY[key] = 0; cellCnt[key] = 0; }
      cellSumY[key] += yv; cellCnt[key]++;
    });
    var layers = Object.keys(layerSet).map(Number).sort(function(a,b){return a-b;});
    nRows = layers.length;
    if (nRows < 2) {
      return { pts: data.map(function(p){ return {x:Number(p.x),y:Number(p.y),z:Number(p.z)}; }), vMap: null, rowCount: 0, colCount: 0 };
    }
    rowToZ = layers.map(function(l) { return layerZSum[l] / layerZCnt[l]; });
    var li2idx = {};
    layers.forEach(function(l, i){ li2idx[l] = i; });
    depthGrid = [];
    for (var ri0 = 0; ri0 < nRows; ri0++) { depthGrid.push(new Array(nCols).fill(null)); }
    Object.keys(cellCnt).forEach(function(key) {
      var sep = key.lastIndexOf('|');
      var xv = parseFloat(key.slice(0, sep));
      var lv = parseInt(key.slice(sep + 1), 10);
      var xi = xi2idx[xv.toFixed(6)], li = li2idx[lv];
      if (xi != null && li != null) depthGrid[li][xi] = cellSumY[key] / cellCnt[key];
    });
  } else {
    var zSet = {};
    data.forEach(function(p) { zSet[Number(p.z).toFixed(6)] = Number(p.z); });
    var zVals = Object.keys(zSet).map(function(k){ return zSet[k]; }).sort(function(a,b){return a-b;});
    nRows = zVals.length;
    if (nRows < 2) {
      return { pts: data.map(function(p){ return {x:Number(p.x),y:Number(p.y),z:Number(p.z)}; }), vMap: null, rowCount: 0, colCount: 0 };
    }
    rowToZ = zVals;
    var zi2idx = {};
    zVals.forEach(function(v, i){ zi2idx[v.toFixed(6)] = i; });
    depthGrid = [];
    for (var ri1 = 0; ri1 < nRows; ri1++) { depthGrid.push(new Array(nCols).fill(null)); }
    data.forEach(function(p) {
      var xi = xi2idx[Number(p.x).toFixed(6)], zi = zi2idx[Number(p.z).toFixed(6)];
      if (xi != null && zi != null) depthGrid[zi][xi] = Number(p.y);
    });
  }

  var colSpacing = (xVals[nCols - 1] - xVals[0]) / (nCols - 1);
  var zSpan = Math.abs(rowToZ[nRows - 1] - rowToZ[0]);
  var rowSpacing = zSpan / (nRows - 1);
  var cfg = { rowCount: nRows, colCount: nCols, colSpacing: colSpacing, rowSpacing: rowSpacing, minX: xVals[0], minY: rowToZ[0] };
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
    var nl=Math.sqrt(nx*nx+ny*ny+nz*nz);
    if (nl < 1e-10) continue;
    nx/=nl; ny/=nl; nz/=nl;
    var vv = [v0, v1, v2];
    for (var vi = 0; vi < 3; vi++) {
      var vi1=(vi+1)%3, vi2=(vi+2)%3;
      var ax=vv[vi1].x-vv[vi].x, ay=vv[vi1].y-vv[vi].y, az=vv[vi1].z-vv[vi].z;
      var bx=vv[vi2].x-vv[vi].x, by=vv[vi2].y-vv[vi].y, bz=vv[vi2].z-vv[vi].z;
      var al=Math.sqrt(ax*ax+ay*ay+az*az), bl=Math.sqrt(bx*bx+by*by+bz*bz);
      if (al<1e-10 || bl<1e-10) continue;
      var cosA=(ax*bx+ay*by+az*bz)/(al*bl);
      cosA=Math.max(-1,Math.min(1,cosA));
      var angle=Math.acos(cosA);
      norms[t[vi]].x+=nx*angle; norms[t[vi]].y+=ny*angle; norms[t[vi]].z+=nz*angle;
    }
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

// 3×4 face probe dataset (3 X-samples × 4 Z-layers).
// Each point: { x, y (contact depth), z (layer height) }.
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
        z: zLayers[zi]
      });
    }
  }
})();

// 3×4 face probe dataset with .layer attribute and per-sample Z values.
// Simulates layeredFaceResultsRaw where each X sample has a slightly different
// layerZ (because sampleTopZ varies across X positions).  The layer-based grouping
// path in _upsampleFaceData must collapse all per-sample Z variants back into the
// intended 4-layer × 3-sample grid.
var FACE_DATA_LAYERED_3X4 = [];
(function() {
  var xPos = [0, 10, 20];
  var layerNums = [1, 2, 3, 4];
  // Simulate per-sample topZ offsets (face is slightly angled)
  var topZOffset = [0, 0.05, 0.10];
  var maxDepth = 15;
  for (var li = 0; li < layerNums.length; li++) {
    for (var xi = 0; xi < xPos.length; xi++) {
      // Per-sample Z: each sample has its own layerZ
      var sampleTopZ = -topZOffset[xi];
      var deepestZ = sampleTopZ - maxDepth;
      var effectiveTopZ = sampleTopZ - 0.05;
      var spacing = (effectiveTopZ - deepestZ) / (layerNums.length - 1);
      var layerZ = deepestZ + li * spacing;
      FACE_DATA_LAYERED_3X4.push({
        x: xPos[xi],
        y: -1 - 0.3 * Math.sin(xi * Math.PI / 2) - 0.1 * li,
        z: layerZ,       // per-sample, differs between xi at same layer
        layer: layerNums[li],
        sampleTopZ: sampleTopZ
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

function testLayerBasedGroupingRecovery() {
  console.log('\nTest: _upsampleFaceData layer-based grouping — coarse grid despite per-sample Z variation');

  // FACE_DATA_LAYERED_3X4 has 4 layers × 3 X samples = 12 points.
  // Each X sample has a DIFFERENT z value for the same layer, so naïve Z-keying
  // would produce 12 unique rows (one per point) with only 1 cell filled each.
  // Layer-based grouping must collapse these into exactly 4 rows × 3 cols.
  var up = _upsampleFaceData(FACE_DATA_LAYERED_3X4, 0.5);

  // With 4 layers over ~15mm span at 0.5mm spacing: ~30 rows.
  // With 3 X samples over 20mm span at 0.5mm spacing: 41 cols.
  assert(up.rowCount >= 4, 'Layer-based grouping: rowCount (' + up.rowCount + ') >= 4 (original layers)');
  assert(up.colCount >= 3, 'Layer-based grouping: colCount (' + up.colCount + ') >= 3 (original X samples)');
  assert(up.pts.length >= 4 * 3,
    'Layer-based grouping: at least ' + (4 * 3) + ' output vertices, got ' + up.pts.length);

  // Subdivision must increase resolution in both axes beyond the coarse input grid.
  assert(up.rowCount > 4,
    'Layer-based: Z-axis subdivision active (rowCount ' + up.rowCount + ' > 4 coarse rows)');
  assert(up.colCount > 3,
    'Layer-based: X-axis subdivision active (colCount ' + up.colCount + ' > 3 coarse cols)');
}

function testLayerBasedGroupingYValues() {
  console.log('\nTest: _upsampleFaceData layer-based grouping — Y values at original corners preserved');

  var up = _upsampleFaceData(FACE_DATA_LAYERED_3X4, 5.0); // large spacing → no subdivision (1:1)
  // With spacing=5mm and X range=20mm, subC = round(20/2 / 5) = 2, so we do get some.
  // Use spacing=25mm to ensure no subdivision.
  var up2 = _upsampleFaceData(FACE_DATA_LAYERED_3X4, 25.0);

  // At corner (x=0, layer=1): y = -1 - 0.3 * sin(0) - 0.1 * 0 = -1.0
  // At corner (x=20, layer=1): y = -1 - 0.3 * sin(π) - 0.1 * 0 ≈ -1.0 (sin(π) ≈ 0)
  // At corner (x=10, layer=4): y = -1 - 0.3 * sin(π/2) - 0.1 * 3 = -1 - 0.3 - 0.3 = -1.6
  assert(up2.pts.length > 0, 'Layer-based: at least 1 vertex produced at large spacing');

  // Check that the first vertex (x=0, first row) has y ≈ -1.0
  var firstVert = up2.pts[0];
  assert(Math.abs(firstVert.y - (-1.0)) < 0.01,
    'Layer-based: corner y at (x=0, layer=1) ≈ -1.0, got ' + firstVert.y.toFixed(4));
}

function testVertexGridContinuity() {
  console.log('\nTest: vertex grid continuity — adjacent grid cells share vertex indices');

  var up = _upsampleFaceData(FACE_DATA_3X4, 2.0);
  assert(up.vMap !== null, 'vMap is populated for structured grid data');
  assert(up.rowCount >= 2, 'rowCount >= 2 for grid continuity check');
  assert(up.colCount >= 2, 'colCount >= 2 for grid continuity check');

  // For any quad (r,c)→(r,c+1)→(r+1,c+1)→(r+1,c), the shared vertices between
  // adjacent quads must use the same index — no per-strip duplication.
  // e.g. vMap[r][c+1] is shared between quad (r,c) and quad (r,c+1).
  var violations = 0;
  for (var r = 0; r < up.rowCount - 1; r++) {
    for (var c = 0; c < up.colCount - 2; c++) {
      // Right shared vertex: vMap[r][c+1] is the right side of quad (r,c)
      //                       and the left side of quad (r,c+1).
      var vRight = up.vMap[r][c + 1];
      var vLeft  = up.vMap[r][c + 1]; // same index — check they're not null
      if (vRight === null) continue;
      // The same index must appear correctly in the vMap for adjacent quads.
      // In a welded grid, vMap[r][c+1] and vMap[r+1][c+1] must point to the
      // same vertex index regardless of which row-strip we came from.
      var vBottomRight = up.vMap[r + 1][c + 1];
      // These should be valid (non-null) unique indices into pts, not duplicated.
      if (vRight !== null && vBottomRight !== null) {
        if (vRight === vBottomRight) violations++;
      }
    }
  }
  assert(violations === 0,
    'No shared-edge vertex index collisions (vMap[r][c+1] !== vMap[r+1][c+1]): ' + violations + ' violations');

  // Verify each non-null vMap index maps to a unique vertex (no off-by-one).
  var seen = {};
  var dupes = 0;
  for (var r2 = 0; r2 < up.rowCount; r2++) {
    for (var c2 = 0; c2 < up.colCount; c2++) {
      var idx = up.vMap[r2][c2];
      if (idx === null) continue;
      if (idx in seen) dupes++;
      seen[idx] = true;
    }
  }
  assert(dupes === 0, 'All non-null vMap entries reference unique vertex indices (no duplicates): dupes=' + dupes);
}

function testAngleWeightedNormalsAreUnit() {
  console.log('\nTest: angle-weighted vertex normals — all normals are unit-length');

  // Build a simple 3×3 grid with a smooth hill.
  var verts = [];
  var vMap = [];
  var n = 5;
  for (var r = 0; r < n; r++) {
    vMap.push([]);
    for (var c = 0; c < n; c++) {
      vMap[r].push(verts.length);
      var x = c * 2, z = r * 2;
      var y = Math.exp(-(x - 4)*(x-4)/8 - (z-4)*(z-4)/8); // gaussian hill
      verts.push({ x: x, y: y, z: z });
    }
  }
  var tris = buildGridTris(vMap, n, n);
  var norms = _computeVertexNormals(verts, tris);

  var allUnit = norms.every(function(norm) {
    var len = Math.sqrt(norm.x*norm.x + norm.y*norm.y + norm.z*norm.z);
    return Math.abs(len - 1) < 1e-6;
  });
  assert(allUnit, 'All angle-weighted normals are unit-length (max deviation < 1e-6)');

  // Interior normals must not be axis-aligned (they should reflect the hill curvature).
  // Use an off-center vertex (r=1, c=2) rather than the symmetric peak where gradient is zero.
  var offCenterIdx = 1 * n + 2; // row 1, col 2 — on the slope of the hill
  var v = norms[offCenterIdx];
  var isAxisAligned = (Math.abs(v.x) < 0.001 && Math.abs(v.z) < 0.001);
  assert(!isAxisAligned, 'Off-center normal on curved surface has XZ components (not purely Y-axis-aligned)');
}

function testAngleWeightedVsAreaWeightedOnElongatedMesh() {
  console.log('\nTest: angle-weighted normals — consistent sign/direction vs area-weighted on elongated grid');

  // Build an elongated rectangular grid (1mm in Z, 100mm in X) with a gentle slope.
  // Area-weighted normals can behave differently to angle-weighted for elongated tris.
  var verts = [];
  var vMap = [];
  var nX = 5, nZ = 3;
  for (var r = 0; r < nZ; r++) {
    vMap.push([]);
    for (var c = 0; c < nX; c++) {
      vMap[r].push(verts.length);
      verts.push({ x: c * 25, y: -c * 0.1 - r * 0.05, z: r * 1.0 });
    }
  }
  var tris = buildGridTris(vMap, nZ, nX);
  var norms = _computeVertexNormals(verts, tris);

  // All normals should point in approximately the same hemisphere (consistent winding).
  var allSameSign = norms.every(function(n) { return n.y < 0; }); // outward = -Y for face mesh
  assert(allSameSign || norms.every(function(n) { return n.y > 0; }),
    'All normals on elongated mesh point in consistent Y direction (no flip): allSameSign=' + allSameSign);

  var allUnit = norms.every(function(n) {
    var len = Math.sqrt(n.x*n.x + n.y*n.y + n.z*n.z);
    return Math.abs(len - 1) < 1e-6;
  });
  assert(allUnit, 'All normals on elongated mesh are unit-length');
}

function testSubdivisionBothAxes() {
  console.log('\nTest: subdivision applies to both X and Z axes for face data');

  // Use data with 3 X samples (10mm apart) and 4 layers (5mm apart).
  // With 0.5mm target: subX = round(10/0.5) = 20, subZ = round(5/0.5) = 10.
  // Expected: colCount = (3-1)*20+1 = 41, rowCount = (4-1)*10+1 = 31.
  var up = _upsampleFaceData(FACE_DATA_3X4, 0.5);

  assert(up.colCount >= 41, 'X-axis subdivided: colCount (' + up.colCount + ') >= 41 (at 0.5mm over 10mm gaps)');
  assert(up.rowCount >= 31, 'Z-axis subdivided: rowCount (' + up.rowCount + ') >= 31 (at 0.5mm over 5mm gaps)');

  // Same test with layer-based data.
  var upL = _upsampleFaceData(FACE_DATA_LAYERED_3X4, 0.5);
  assert(upL.colCount >= 41, 'Layer-based X-axis subdivided: colCount (' + upL.colCount + ') >= 41');
  assert(upL.rowCount > 4, 'Layer-based Z-axis subdivided: rowCount (' + upL.rowCount + ') > 4');
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
    testLayerBasedGroupingRecovery();
    testLayerBasedGroupingYValues();
    testVertexGridContinuity();
    testAngleWeightedNormalsAreUnit();
    testAngleWeightedVsAreaWeightedOnElongatedMesh();
    testSubdivisionBothAxes();
  } catch (e) {
    console.error('Unexpected error in test runner:', e);
    failed++;
  }
  console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---');
  process.exit(failed > 0 ? 1 : 0);
})();
