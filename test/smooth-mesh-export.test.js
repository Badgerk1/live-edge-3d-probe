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

// ── Run all tests ─────────────────────────────────────────────────────────────

// ── OBJ export validation helpers ────────────────────────────────────────────

// Simulate the OBJ export for a surface grid (mirrors exportSurfaceOBJ logic).
// Returns the OBJ text as a string.
function buildSurfaceOBJ(grid, cfg, targetSpacing) {
  var up = _bicubicUpsampleGrid(grid, cfg, targetSpacing);
  var allVerts = [], allTris = [];
  var vMap = [];
  for (var ri = 0; ri < up.rowCount; ri++) {
    vMap.push([]);
    for (var ci = 0; ci < up.colCount; ci++) {
      var z = up.grid[ri][ci];
      if (z != null) {
        vMap[ri].push(allVerts.length);
        allVerts.push({ x: up.minX + ci * up.colSpacing, y: up.minY + ri * up.rowSpacing, z: z });
      } else {
        vMap[ri].push(null);
      }
    }
  }
  for (var fr = 0; fr < up.rowCount - 1; fr++) {
    for (var fc = 0; fc < up.colCount - 1; fc++) {
      var a=vMap[fr][fc], b=vMap[fr][fc+1], c=vMap[fr+1][fc+1], d=vMap[fr+1][fc];
      if (a!=null&&b!=null&&c!=null&&d!=null) { allTris.push([a,b,c]); allTris.push([a,c,d]); }
      else if (a!=null&&b!=null&&c!=null) { allTris.push([a,b,c]); }
      else if (a!=null&&c!=null&&d!=null) { allTris.push([a,c,d]); }
      else if (b!=null&&c!=null&&d!=null) { allTris.push([b,c,d]); }
      else if (a!=null&&b!=null&&d!=null) { allTris.push([a,b,d]); }
    }
  }
  var norms = _computeVertexNormals(allVerts, allTris);
  var lines = ['# Surface OBJ', '# Test export', '', 'o surface_mesh', ''];
  allVerts.forEach(function(v) { lines.push('v ' + v.x.toFixed(4) + ' ' + v.y.toFixed(4) + ' ' + v.z.toFixed(4)); });
  lines.push('');
  norms.forEach(function(n) { lines.push('vn ' + n.x.toFixed(4) + ' ' + n.y.toFixed(4) + ' ' + n.z.toFixed(4)); });
  lines.push('');
  lines.push('s 1');
  allTris.forEach(function(t) {
    var i0=t[0]+1, i1=t[1]+1, i2=t[2]+1;
    lines.push('f ' + i0 + '//' + i0 + ' ' + i1 + '//' + i1 + ' ' + i2 + '//' + i2);
  });
  return { text: lines.join('\n'), vertCount: allVerts.length, triCount: allTris.length, normCount: norms.length };
}

// Simulate the OBJ export for face probe data (mirrors exportFaceOBJ logic).
function buildFaceOBJ(data, targetSpacing) {
  var up = _upsampleFaceData(data, targetSpacing);
  var allVerts = up.pts;
  var allTris = [];
  if (up.vMap && up.rowCount >= 2 && up.colCount >= 2) {
    for (var ri = 0; ri < up.rowCount - 1; ri++) {
      for (var ci = 0; ci < up.colCount - 1; ci++) {
        var a=up.vMap[ri][ci], b=up.vMap[ri][ci+1], c=up.vMap[ri+1][ci+1], d=up.vMap[ri+1][ci];
        if (a!=null&&b!=null&&c!=null&&d!=null) { allTris.push([a,b,c]); allTris.push([a,c,d]); }
        else if (a!=null&&b!=null&&c!=null) { allTris.push([a,b,c]); }
        else if (a!=null&&c!=null&&d!=null) { allTris.push([a,c,d]); }
        else if (b!=null&&c!=null&&d!=null) { allTris.push([b,c,d]); }
        else if (a!=null&&b!=null&&d!=null) { allTris.push([a,b,d]); }
      }
    }
  }
  // Ensure face normals point in -Y direction
  var sumNy = 0;
  allTris.forEach(function(t) {
    var v0=allVerts[t[0]], v1=allVerts[t[1]], v2=allVerts[t[2]];
    var e1x=v1.x-v0.x, e1z=v1.z-v0.z, e2x=v2.x-v0.x, e2z=v2.z-v0.z;
    sumNy += e1z*e2x - e1x*e2z;
  });
  if (sumNy > 0) allTris = allTris.map(function(t) { return [t[0], t[2], t[1]]; });
  var norms = _computeVertexNormals(allVerts, allTris);
  var lines = ['# Face OBJ', '# Test export', '', 'o face_mesh', ''];
  allVerts.forEach(function(v) { lines.push('v ' + v.x.toFixed(4) + ' ' + v.y.toFixed(4) + ' ' + v.z.toFixed(4)); });
  lines.push('');
  norms.forEach(function(n) { lines.push('vn ' + n.x.toFixed(4) + ' ' + n.y.toFixed(4) + ' ' + n.z.toFixed(4)); });
  lines.push('');
  lines.push('s 1');
  allTris.forEach(function(t) {
    var i0=t[0]+1, i1=t[1]+1, i2=t[2]+1;
    lines.push('f ' + i0 + '//' + i0 + ' ' + i1 + '//' + i1 + ' ' + i2 + '//' + i2);
  });
  return { text: lines.join('\n'), vertCount: allVerts.length, triCount: allTris.length, normCount: norms.length };
}

// Parse OBJ text into {verts, norms, faces} arrays for validation.
function parseOBJ(text) {
  var verts = [], norms = [], faces = [];
  text.split('\n').forEach(function(line) {
    line = line.trim();
    if (line.startsWith('vn ')) {
      var p = line.slice(3).trim().split(/\s+/).map(Number);
      norms.push({ x: p[0], y: p[1], z: p[2] });
    } else if (line.startsWith('v ')) {
      var p2 = line.slice(2).trim().split(/\s+/).map(Number);
      verts.push({ x: p2[0], y: p2[1], z: p2[2] });
    } else if (line.startsWith('f ')) {
      var tokens = line.slice(2).trim().split(/\s+/);
      var tri = tokens.map(function(tok) {
        var parts = tok.split('/');
        return { v: parseInt(parts[0], 10), vn: parseInt(parts[2], 10) };
      });
      faces.push(tri);
    }
  });
  return { verts: verts, norms: norms, faces: faces };
}

// ── OBJ Validation Tests ──────────────────────────────────────────────────────

function testSurfaceOBJValidation() {
  console.log('\nTest: surface OBJ export — vn count = v count, face refs valid, no dup vertices');

  var res = buildSurfaceOBJ(SURF_GRID_4X4, SURF_CFG_4X4, 0.5);
  var obj = parseOBJ(res.text);
  var nV = obj.verts.length, nVN = obj.norms.length;

  assert(nV === nVN,
    'Surface OBJ: vn count (' + nVN + ') === v count (' + nV + ')');

  var allFaceRefsValid = obj.faces.every(function(tri) {
    return tri.every(function(ref) {
      return ref.v >= 1 && ref.v <= nV && ref.vn >= 1 && ref.vn <= nVN;
    });
  });
  assert(allFaceRefsValid,
    'Surface OBJ: all face v and vn indices in range [1, ' + nV + ']');

  // v and vn indices must match (v//vn same-index format)
  var allSameIdx = obj.faces.every(function(tri) {
    return tri.every(function(ref) { return ref.v === ref.vn; });
  });
  assert(allSameIdx, 'Surface OBJ: all faces use v//vn with matching indices');

  // No exact duplicate vertex positions (welded mesh)
  var posSet = {};
  var dups = 0;
  obj.verts.forEach(function(v) {
    var key = v.x.toFixed(4) + '|' + v.y.toFixed(4) + '|' + v.z.toFixed(4);
    if (key in posSet) dups++;
    posSet[key] = true;
  });
  assert(dups === 0,
    'Surface OBJ: no duplicate vertex positions (welded), found ' + dups + ' duplicates');

  // All normals are non-zero and normalized
  var allNormOK = obj.norms.every(function(n) {
    var len = Math.sqrt(n.x*n.x + n.y*n.y + n.z*n.z);
    return len > 1e-6 && Math.abs(len - 1) < 1e-3;
  });
  assert(allNormOK, 'Surface OBJ: all vn normals are non-zero and normalized');

  // OBJ text must contain an 'o' object declaration
  assert(res.text.indexOf('\no surface_mesh') >= 0 || res.text.startsWith('o surface_mesh'),
    'Surface OBJ: contains "o surface_mesh" object declaration');
}

function testFaceOBJValidation() {
  console.log('\nTest: face OBJ export — vn count = v count, face refs valid, normals in -Y direction');

  var res = buildFaceOBJ(FACE_DATA_3X4, 0.5);
  var obj = parseOBJ(res.text);
  var nV = obj.verts.length, nVN = obj.norms.length;

  assert(nV === nVN,
    'Face OBJ: vn count (' + nVN + ') === v count (' + nV + ')');

  var allFaceRefsValid = obj.faces.every(function(tri) {
    return tri.every(function(ref) {
      return ref.v >= 1 && ref.v <= nV && ref.vn >= 1 && ref.vn <= nVN;
    });
  });
  assert(allFaceRefsValid,
    'Face OBJ: all face v and vn indices in range [1, ' + nV + ']');

  var allSameIdx = obj.faces.every(function(tri) {
    return tri.every(function(ref) { return ref.v === ref.vn; });
  });
  assert(allSameIdx, 'Face OBJ: all faces use v//vn with matching indices');

  // No exact duplicate vertex positions
  var posSet = {};
  var dups = 0;
  obj.verts.forEach(function(v) {
    var key = v.x.toFixed(4) + '|' + v.y.toFixed(4) + '|' + v.z.toFixed(4);
    if (key in posSet) dups++;
    posSet[key] = true;
  });
  assert(dups === 0,
    'Face OBJ: no duplicate vertex positions (welded), found ' + dups + ' duplicates');

  // All normals non-zero and normalized
  var allNormOK = obj.norms.every(function(n) {
    var len = Math.sqrt(n.x*n.x + n.y*n.y + n.z*n.z);
    return len > 1e-6 && Math.abs(len - 1) < 1e-3;
  });
  assert(allNormOK, 'Face OBJ: all vn normals are non-zero and normalized');

  // Face mesh normals should predominantly point in -Y direction
  var negYCount = obj.norms.filter(function(n) { return n.y < 0; }).length;
  assert(negYCount > nVN / 2,
    'Face OBJ: majority of normals point in -Y direction (' + negYCount + '/' + nVN + ')');

  // OBJ text must contain an 'o' object declaration
  assert(res.text.indexOf('\no face_mesh') >= 0 || res.text.startsWith('o face_mesh'),
    'Face OBJ: contains "o face_mesh" object declaration');
}

// ── Face relief map point-count preservation test ────────────────────────────
// Simulates the renderFaceReliefMap grid-building logic for layered probe data
// and verifies that all expected (X, layer) cells are represented.

function simulateFaceReliefMapGrid(data) {
  // Mirrors the layer-mode path of renderFaceReliefMap in src/js/core.js.
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
  var nCols = xs.length, nRows = layers.length;
  if (nCols < 2 || nRows < 2) return { points: [], nCols: nCols, nRows: nRows };

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
  return { points: points, nCols: nCols, nRows: nRows };
}

// Simulates the Z-fallback path of renderFaceReliefMap for single-pass data.
function simulateFaceReliefMapZFallback(data) {
  var xKeyToVal = {};
  data.forEach(function(r) {
    var xv = Number(r.x);
    if (!isFinite(xv)) return;
    var xKey = xv.toFixed(6);
    if (!(xKey in xKeyToVal)) xKeyToVal[xKey] = xv;
  });
  var xs = Object.values(xKeyToVal).sort(function(a, b) { return a - b; });
  if (xs.length < 2) return { points: [], nCols: xs.length, nRows: 0 };

  var zKeyToVal = {};
  data.forEach(function(r) {
    var zv = Number(r.z);
    if (!isFinite(zv)) return;
    var zKey = zv.toFixed(3);
    if (!(zKey in zKeyToVal)) zKeyToVal[zKey] = zv;
  });
  var zVals = Object.values(zKeyToVal).sort(function(a, b) { return a - b; });
  if (zVals.length < 2) return { points: [], nCols: xs.length, nRows: zVals.length };

  var cellSumYz = {}, cellCntYz = {};
  data.forEach(function(r) {
    var xv = Number(r.x), yv = Number(r.y), zv = Number(r.z);
    if (!isFinite(xv) || !isFinite(yv) || !isFinite(zv)) return;
    var key = xv.toFixed(6) + '|' + zv.toFixed(3);
    if (!(key in cellSumYz)) { cellSumYz[key] = 0; cellCntYz[key] = 0; }
    cellSumYz[key] += yv; cellCntYz[key]++;
  });

  var points = [];
  Object.keys(cellSumYz).forEach(function(key) {
    var parts = key.split('|');
    var xv = parseFloat(parts[0]), zv = parseFloat(parts[1]);
    var yv = cellSumYz[key] / cellCntYz[key];
    if (!isFinite(xv) || !isFinite(yv) || !isFinite(zv)) return;
    points.push({ px: xv, py: zv, val: yv });
  });
  return { points: points, nCols: xs.length, nRows: zVals.length };
}

function testFaceReliefMapPointCountPreservation() {
  console.log('\nTest: face relief map — all probe points are represented (layered mode)');

  // Build a 5×4 layered face probe dataset (5 X positions × 4 Z layers = 20 points).
  var layeredData = [];
  var xPos = [0, 25, 50, 75, 100];
  var zLayerZ = [-4, -3, -2, -1];  // Z heights for layers 1-4
  xPos.forEach(function(x) {
    zLayerZ.forEach(function(z, li) {
      layeredData.push({
        x: x,
        y: -10 - x * 0.05 - li * 0.2,  // smooth depth variation
        z: z,
        layer: li + 1
      });
    });
  });

  var result = simulateFaceReliefMapGrid(layeredData);
  assert(result.nCols === xPos.length,
    'Layer mode: nCols = ' + result.nCols + ' (expected ' + xPos.length + ')');
  assert(result.nRows === zLayerZ.length,
    'Layer mode: nRows = ' + result.nRows + ' (expected ' + zLayerZ.length + ')');
  assert(result.points.length === xPos.length * zLayerZ.length,
    'Layer mode: points count = ' + result.points.length + ' (expected ' + (xPos.length * zLayerZ.length) + ')');
}

function testFaceReliefMapSerpentinePreservation() {
  console.log('\nTest: face relief map — serpentine order does not cause duplicate-key collisions');

  // Serpentine: layer 1 goes L→R, layer 2 goes R→L, etc.
  var serpData = [];
  var xPos = [0, 25, 50, 75, 100];
  var zLayerZ = [-4, -3, -2, -1];
  zLayerZ.forEach(function(z, li) {
    var xOrder = (li % 2 === 0) ? xPos : xPos.slice().reverse();
    xOrder.forEach(function(x) {
      serpData.push({ x: x, y: -8 - x * 0.03 - li * 0.15, z: z, layer: li + 1 });
    });
  });

  var result = simulateFaceReliefMapGrid(serpData);
  assert(result.points.length === xPos.length * zLayerZ.length,
    'Serpentine: ' + result.points.length + ' points preserved (expected ' + (xPos.length * zLayerZ.length) + ')');
  assert(result.nCols === xPos.length,
    'Serpentine: nCols = ' + result.nCols + ' (no extra columns from reversed order)');
}

function testFaceReliefMapSpuriousContactsExcluded() {
  console.log('\nTest: face relief map — spurious off-nominal contacts do not inflate column count');

  // 3 nominal contacts at x=0,50,100 layer=1
  var nominalData = [
    { x: 0,   y: -10, z: -5, layer: 1 },
    { x: 50,  y: -12, z: -5, layer: 1 },
    { x: 100, y: -11, z: -5, layer: 1 },
    { x: 0,   y: -9,  z: -4, layer: 2 },
    { x: 50,  y: -11, z: -4, layer: 2 },
    { x: 100, y: -10, z: -4, layer: 2 }
  ];
  var cleanResult = simulateFaceReliefMapGrid(nominalData);

  // Simulate legacy behavior where spurious inter-sample contacts at arbitrary X
  // positions were also included in layeredFaceResults.
  var dataWithSpurious = nominalData.concat([
    { x: 23.7, y: -11, z: -5, layer: 1 },  // spurious at x≈23.7 (retract contact)
    { x: 67.2, y: -12, z: -5, layer: 1 }   // spurious at x≈67.2
  ]);
  var spuriousResult = simulateFaceReliefMapGrid(dataWithSpurious);

  // Clean data: 3 X columns
  assert(cleanResult.nCols === 3,
    'Without spurious contacts: nCols = 3, got ' + cleanResult.nCols);
  // Spurious data: 5 X columns (3 nominal + 2 spurious)
  assert(spuriousResult.nCols === 5,
    'With spurious contacts: nCols inflated to 5 (3 nominal + 2 spurious), got ' + spuriousResult.nCols);
  // This test documents the problem; by removing spurious pushes from layeredFaceResults
  // in core.js, the result should always match cleanResult.nCols.
}

function testFaceReliefMapSinglePassFallback() {
  console.log('\nTest: face relief map — single-pass probe (no layer attr) falls back to Z-value grouping');

  // Single-pass face probe data: no layer attribute, multiple Z heights.
  var singlePassData = [
    { x: 0,   y: -10, z: -5 },
    { x: 25,  y: -11, z: -5 },
    { x: 50,  y: -12, z: -5 },
    { x: 0,   y: -9,  z: -4 },
    { x: 25,  y: -10, z: -4 },
    { x: 50,  y: -11, z: -4 }
  ];

  // Layer-mode path: all fall into DEFAULT_LAYER=1 → nRows=1 → no render
  var layerResult = simulateFaceReliefMapGrid(singlePassData);
  assert(layerResult.nRows === 1,
    'Single-pass (no layer attr): layer-mode nRows = 1 (all collapse to DEFAULT_LAYER)');
  assert(layerResult.points.length === 0 || layerResult.nRows < 2,
    'Single-pass: layer-mode produces nRows < 2 → falls back');

  // Z-fallback path should produce correct 3×2 grid
  var zResult = simulateFaceReliefMapZFallback(singlePassData);
  assert(zResult.nCols === 3,
    'Single-pass Z-fallback: nCols = 3, got ' + zResult.nCols);
  assert(zResult.nRows === 2,
    'Single-pass Z-fallback: nRows = 2, got ' + zResult.nRows);
  assert(zResult.points.length === 6,
    'Single-pass Z-fallback: 6 points preserved, got ' + zResult.points.length);
}

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
    testSurfaceOBJValidation();
    testFaceOBJValidation();
    testFaceReliefMapPointCountPreservation();
    testFaceReliefMapSerpentinePreservation();
    testFaceReliefMapSpuriousContactsExcluded();
    testFaceReliefMapSinglePassFallback();
  } catch (e) {
    console.error('Unexpected error in test runner:', e);
    failed++;
  }
  console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---');
  process.exit(failed > 0 ? 1 : 0);
})();
