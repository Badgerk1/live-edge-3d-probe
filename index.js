import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// ── Paths ────────────────────────────────────────────────────────────────────

function getUserDataDir() {
  const platform = os.platform();
  const appName = 'ncSender';
  switch (platform) {
    case 'win32':
      return path.join(os.homedir(), 'AppData', 'Roaming', appName);
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', appName);
    case 'linux':
      return path.join(os.homedir(), '.config', appName);
    default:
      return path.join(os.homedir(), `.${appName}`);
  }
}

function getMeshFilePath() {
  return path.join(getUserDataDir(), 'plugin-config', 'com.ncsender.edgeprobe.combined', 'mesh.json');
}

// ── In-memory mesh storage ───────────────────────────────────────────────────

let currentMesh = null;
let meshGridParams = null;

// ── G-code bounds analysis ───────────────────────────────────────────────────

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

// ── Bilinear interpolation for Z lookup ──────────────────────────────────────
// Handles special cases: single row (1xN), single column (Nx1)

function interpolateZ(x, y, mesh, gridParams) {
  const { startX, startY, spacingX, spacingY, rows, cols } = gridParams;

  // Single column (Nx1): linear interpolation in Y only
  if (cols === 1) {
    if (rows === 1) return mesh[0][0]?.z ?? 0;
    const rowFloat = spacingY > 0 ? (y - startY) / spacingY : 0;
    const row = Math.max(0, Math.min(rows - 2, Math.floor(rowFloat)));
    const z0 = mesh[row][0]?.z ?? 0;
    const z1 = mesh[row + 1]?.[0]?.z ?? z0;
    const ty = Math.max(0, Math.min(1, rowFloat - row));
    return z0 * (1 - ty) + z1 * ty;
  }

  // Single row (1xN): linear interpolation in X only
  if (rows === 1) {
    const colFloat = spacingX > 0 ? (x - startX) / spacingX : 0;
    const col = Math.max(0, Math.min(cols - 2, Math.floor(colFloat)));
    const z0 = mesh[0][col]?.z ?? 0;
    const z1 = mesh[0][col + 1]?.z ?? z0;
    const tx = Math.max(0, Math.min(1, colFloat - col));
    return z0 * (1 - tx) + z1 * tx;
  }

  // Standard bilinear interpolation for 2D grid
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

// ── Z compensation with move subdivision ─────────────────────────────────────

function applyZCompensation(gcodeContent, mesh, gridParams, referenceZ) {
  const lines = gcodeContent.split('\n');
  const output = [];

  let currentX = 0, currentY = 0, currentZ = 0;
  let isAbsolute = true;
  let currentFeedRate = null;
  let currentGMode = 'G1';

  // Segment length for subdivision — use smaller of mesh spacing or 2mm
  const segmentLength = Math.min(
    gridParams.spacingX || 10,
    gridParams.spacingY || 10,
    2
  );

  output.push('(Z-Compensated G-code generated by 3D Live Edge Mesh Combined Plugin)');
  output.push(`(Grid: ${gridParams.cols} x ${gridParams.rows} points)`);
  output.push(`(Reference Z: ${referenceZ.toFixed(3)})`);
  output.push(`(Segment length: ${segmentLength.toFixed(2)}mm)`);
  output.push('');

  for (const line of lines) {
    const trimmed = line.trim().toUpperCase();

    // Pass through comments and empty lines
    if (!trimmed || trimmed.startsWith('(') || trimmed.startsWith(';') || trimmed.startsWith('%')) {
      output.push(line);
      continue;
    }

    // Track coordinate mode
    if (trimmed.includes('G90') && !trimmed.includes('G90.1')) isAbsolute = true;
    if (trimmed.includes('G91') && !trimmed.includes('G91.1')) isAbsolute = false;

    // Pass through machine coordinate moves unchanged
    if (trimmed.includes('G53')) {
      output.push(line);
      continue;
    }

    // Track motion mode
    if (trimmed.match(/^G0\b/) || trimmed.includes(' G0 ') || trimmed.includes(' G0')) currentGMode = 'G0';
    if (trimmed.match(/^G1\b/) || trimmed.includes(' G1 ') || trimmed.includes(' G1')) currentGMode = 'G1';
    if (trimmed.match(/^G2\b/) || trimmed.includes(' G2 ')) currentGMode = 'G2';
    if (trimmed.match(/^G3\b/) || trimmed.includes(' G3 ')) currentGMode = 'G3';

    // Extract coordinates and feed rate
    const xMatch = line.match(/X([+-]?\d*\.?\d+)/i);
    const yMatch = line.match(/Y([+-]?\d*\.?\d+)/i);
    const zMatch = line.match(/Z([+-]?\d*\.?\d+)/i);
    const fMatch = line.match(/F([+-]?\d*\.?\d+)/i);

    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    // Calculate target position
    let targetX = currentX, targetY = currentY, targetZ = currentZ;
    if (xMatch) targetX = isAbsolute ? parseFloat(xMatch[1]) : currentX + parseFloat(xMatch[1]);
    if (yMatch) targetY = isAbsolute ? parseFloat(yMatch[1]) : currentY + parseFloat(yMatch[1]);
    if (zMatch) targetZ = isAbsolute ? parseFloat(zMatch[1]) : currentZ + parseFloat(zMatch[1]);

    const isLinearMove = currentGMode === 'G1';
    const isRapidMove = currentGMode === 'G0';
    const hasXY = xMatch || yMatch;
    const hasZ = zMatch !== null;

    if (isLinearMove && hasXY && isAbsolute) {
      // Calculate move distance in XY plane
      const dx = targetX - currentX;
      const dy = targetY - currentY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > segmentLength) {
        // Subdivide the move for smooth surface following
        const segments = Math.ceil(distance / segmentLength);
        const dz = targetZ - currentZ;

        for (let i = 1; i <= segments; i++) {
          const t = i / segments;
          const segX = currentX + dx * t;
          const segY = currentY + dy * t;
          const segZ = currentZ + dz * t;

          const meshZ = interpolateZ(segX, segY, mesh, gridParams);
          const zOffset = meshZ - referenceZ;
          const compensatedZ = segZ + zOffset;

          let segCmd = 'G1';
          segCmd += ` X${segX.toFixed(3)}`;
          segCmd += ` Y${segY.toFixed(3)}`;
          segCmd += ` Z${compensatedZ.toFixed(3)}`;
          if (i === 1 && currentFeedRate) segCmd += ` F${currentFeedRate.toFixed(0)}`;

          output.push(segCmd);
        }
      } else {
        // Short move — compensate endpoint, always add Z for surface following
        const meshZ = interpolateZ(targetX, targetY, mesh, gridParams);
        const zOffset = meshZ - referenceZ;
        const compensatedZ = targetZ + zOffset;

        if (hasZ) {
          const newLine = line.replace(/Z([+-]?\d*\.?\d+)/i, `Z${compensatedZ.toFixed(3)}`);
          output.push(newLine);
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
      // Rapid move with XY — compensate Z at endpoint
      const meshZ = interpolateZ(targetX, targetY, mesh, gridParams);
      const zOffset = meshZ - referenceZ;
      const compensatedZ = targetZ + zOffset;

      if (hasZ) {
        const newLine = line.replace(/Z([+-]?\d*\.?\d+)/i, `Z${compensatedZ.toFixed(3)}`);
        output.push(newLine);
      } else {
        if (currentZ < 10) {
          const newLine = line.trim() + ` Z${compensatedZ.toFixed(3)}`;
          output.push(newLine);
        } else {
          output.push(line);
        }
      }
    } else if (hasZ && isAbsolute) {
      // Z-only move — compensate at current XY position
      const meshZ = interpolateZ(targetX, targetY, mesh, gridParams);
      const zOffset = meshZ - referenceZ;
      const compensatedZ = targetZ + zOffset;
      const newLine = line.replace(/Z([+-]?\d*\.?\d+)/i, `Z${compensatedZ.toFixed(3)}`);
      output.push(newLine);
    } else {
      // No coordinates or not absolute — pass through
      output.push(line);
    }

    // Update current position
    currentX = targetX;
    currentY = targetY;
    currentZ = targetZ;
  }

  return output.join('\n');
}

// ── Mesh file persistence ────────────────────────────────────────────────────

async function saveMeshToFile(mesh, gridParams) {
  const filePath = getMeshFilePath();
  const dir = path.dirname(filePath);

  await fs.mkdir(dir, { recursive: true });

  const data = {
    version: 1,
    timestamp: new Date().toISOString(),
    gridParams,
    mesh
  };

  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  return filePath;
}

async function loadMeshFromFile() {
  const filePath = getMeshFilePath();

  const content = await fs.readFile(filePath, 'utf8');
  const data = JSON.parse(content);

  return {
    mesh: data.mesh,
    gridParams: data.gridParams
  };
}

// ── Plugin lifecycle ─────────────────────────────────────────────────────────

let lastProcessedTimestamp = 0;
let checkIntervalId = null;
let __edgeProbeTimer = null;

export async function onLoad(ctx) {
  ctx.log('3D Live Edge Mesh Combined v2.1.0 plugin loaded');

  // Try to load saved mesh on startup
  try {
    const { mesh, gridParams } = await loadMeshFromFile();
    currentMesh = mesh;
    meshGridParams = gridParams;
    ctx.log('Loaded saved mesh:', gridParams.cols, 'x', gridParams.rows);
  } catch (error) {
    // No saved mesh — that's fine
  }

  // Periodically check for applyCompensation flag in settings
  checkIntervalId = setInterval(async () => {
    try {
      const settings = ctx.getSettings() || {};

      if (settings.applyCompensation && settings.applyTimestamp && settings.applyTimestamp > lastProcessedTimestamp) {
        ctx.log('Processing applyCompensation request, timestamp:', settings.applyTimestamp);
        lastProcessedTimestamp = settings.applyTimestamp;

        const mesh = settings.meshData?.mesh || currentMesh;
        const gridParams = settings.meshData?.gridParams || meshGridParams;

        if (!mesh || !gridParams) {
          ctx.log('No mesh data available for compensation');
          ctx.setSettings({
            ...settings,
            applyCompensation: false,
            lastApplyResult: { success: false, error: 'No mesh data available' }
          });
          return;
        }

        // Update in-memory mesh
        if (settings.meshData) {
          currentMesh = settings.meshData.mesh;
          meshGridParams = settings.meshData.gridParams;
        }

        try {
          const cacheFilePath = path.join(getUserDataDir(), 'gcode-cache', 'current.gcode');
          const gcodeContent = await fs.readFile(cacheFilePath, 'utf8');

          const referenceZ = settings.referenceZ ?? 0;
          ctx.log('Applying Z compensation with referenceZ:', referenceZ);
          ctx.log('Grid:', gridParams.cols, 'x', gridParams.rows);

          const compensatedGcode = applyZCompensation(gcodeContent, mesh, gridParams, referenceZ);

          const serverState = ctx.getServerState();
          const originalFilename = serverState?.jobLoaded?.filename || 'program.nc';
          const outputFilename = originalFilename.replace(/\.[^.]+$/, '') + '_compensated.nc';

          ctx.log('Loading compensated file:', outputFilename);

          const response = await fetch('http://localhost:8090/api/gcode-files/load-temp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: compensatedGcode,
              filename: outputFilename,
              sourceFile: originalFilename
            })
          });

          if (response.ok) {
            ctx.log('Compensation applied successfully');
            ctx.setSettings({
              ...settings,
              applyCompensation: false,
              lastApplyResult: { success: true, filename: outputFilename }
            });
          } else {
            ctx.log('Failed to load compensated file:', response.status);
            ctx.setSettings({
              ...settings,
              applyCompensation: false,
              lastApplyResult: { success: false, error: 'Failed to load compensated file' }
            });
          }
        } catch (error) {
          ctx.log('Apply compensation error:', error.message);
          ctx.setSettings({
            ...settings,
            applyCompensation: false,
            lastApplyResult: { success: false, error: error.message }
          });
        }
      }

      // Handle saveMeshFile requests
      if (settings.saveMeshFile && settings.meshData) {
        try {
          currentMesh = settings.meshData.mesh;
          meshGridParams = settings.meshData.gridParams;
          const filePath = await saveMeshToFile(currentMesh, meshGridParams);
          ctx.log('Mesh saved to file:', filePath);
          ctx.setSettings({
            ...settings,
            saveMeshFile: false
          });
        } catch (error) {
          ctx.log('Failed to save mesh file:', error.message);
          ctx.setSettings({
            ...settings,
            saveMeshFile: false
          });
        }
      }

      // Handle loadMeshFile requests
      if (settings.loadMeshFile) {
        try {
          const { mesh: loadedMesh, gridParams: loadedParams } = await loadMeshFromFile();
          currentMesh = loadedMesh;
          meshGridParams = loadedParams;
          ctx.log('Loaded mesh from file:', loadedParams.cols, 'x', loadedParams.rows);
          ctx.setSettings({
            ...settings,
            loadMeshFile: false,
            meshData: { mesh: currentMesh, gridParams: meshGridParams },
            lastLoadResult: { success: true, cols: loadedParams.cols, rows: loadedParams.rows }
          });
        } catch (error) {
          ctx.log('Failed to load mesh from file:', error.message);
          ctx.setSettings({
            ...settings,
            loadMeshFile: false,
            lastLoadResult: { success: false, error: error.message }
          });
        }
      }

      // Handle analyzeGCode requests
      if (settings.analyzeGCode && settings.analyzeTimestamp && settings.analyzeTimestamp > (settings.lastAnalyzeTimestamp || 0)) {
        try {
          const cacheFilePath = path.join(getUserDataDir(), 'gcode-cache', 'current.gcode');
          const gcodeContent = await fs.readFile(cacheFilePath, 'utf8');
          const bounds = analyzeGCodeBounds(gcodeContent);
          ctx.log('G-code bounds:', JSON.stringify(bounds));
          ctx.setSettings({
            ...settings,
            analyzeGCode: false,
            lastAnalyzeTimestamp: settings.analyzeTimestamp,
            gcodeBounds: bounds
          });
        } catch (error) {
          ctx.log('Failed to analyze G-code:', error.message);
          ctx.setSettings({
            ...settings,
            analyzeGCode: false,
            lastAnalyzeTimestamp: settings.analyzeTimestamp,
            gcodeBounds: null
          });
        }
      }
    } catch (error) {
      // Ignore check errors
    }
  }, 500);
}

export async function onUnload(ctx) {
  try { if (__edgeProbeTimer) clearInterval(__edgeProbeTimer); } catch (e) {}
  __edgeProbeTimer = null;

  if (checkIntervalId) {
    clearInterval(checkIntervalId);
    checkIntervalId = null;
  }

  ctx.log('3D Live Edge Mesh Combined v2.1.0 plugin unloaded');
}
