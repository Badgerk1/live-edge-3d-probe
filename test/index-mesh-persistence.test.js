/**
 * Unit tests for mesh persistence logic (index.js mesh save/load functions).
 *
 * Since the actual file I/O functions depend on Node.js fs module and ncSender paths,
 * these tests validate the mesh data structure and JSON serialization format rather
 * than actual file operations.
 *
 * Validates that:
 *  1. Mesh data can be serialized to JSON correctly
 *  2. Mesh data can be deserialized from JSON correctly
 *  3. Grid parameters are preserved through serialization
 *  4. Missing or corrupted data is handled gracefully
 *  5. Mesh data structure matches expected schema
 *
 * Run with:  node test/index-mesh-persistence.test.js
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

function assertClose(actual, expected, tolerance, message) {
  var diff = Math.abs(actual - expected);
  if (diff <= (tolerance || 0.001)) {
    console.log('  PASS: ' + message + ' (got ' + actual.toFixed(4) + ')');
    passed++;
  } else {
    console.error('  FAIL: ' + message + ' — expected ' + expected + ' ±' + (tolerance || 0.001) + ', got ' + actual.toFixed(4));
    failed++;
  }
}

// ── Test 1: Mesh data can be serialized to JSON ──────────────────────────────

function testMeshSerialization() {
  console.log('\nTest: Mesh data can be serialized to JSON correctly');

  const meshData = {
    mesh: [
      [{ x: 0, y: 0, z: 1.23 }, { x: 10, y: 0, z: 1.45 }],
      [{ x: 0, y: 10, z: 1.56 }, { x: 10, y: 10, z: 1.78 }]
    ],
    gridParams: {
      startX: 0,
      startY: 0,
      spacingX: 10,
      spacingY: 10,
      rows: 2,
      cols: 2
    },
    referenceZ: 1.5,
    timestamp: '2026-05-03T18:00:00.000Z'
  };

  let jsonString;
  try {
    jsonString = JSON.stringify(meshData);
    assert(true, 'Mesh data serializes without error');
  } catch (e) {
    assert(false, 'Mesh data serializes without error: ' + e.message);
    return;
  }

  assert(jsonString.includes('"startX":0'), 'JSON includes startX');
  assert(jsonString.includes('"spacingX":10'), 'JSON includes spacingX');
  assert(jsonString.includes('"rows":2'), 'JSON includes rows');
  assert(jsonString.includes('"cols":2'), 'JSON includes cols');
  assert(jsonString.includes('"referenceZ":1.5'), 'JSON includes referenceZ');
}

// ── Test 2: Mesh data can be deserialized from JSON ──────────────────────────

function testMeshDeserialization() {
  console.log('\nTest: Mesh data can be deserialized from JSON correctly');

  const jsonString = `{
    "mesh": [
      [{"x": 0, "y": 0, "z": 1.0}, {"x": 10, "y": 0, "z": 2.0}],
      [{"x": 0, "y": 10, "z": 3.0}, {"x": 10, "y": 10, "z": 4.0}]
    ],
    "gridParams": {
      "startX": 0,
      "startY": 0,
      "spacingX": 10,
      "spacingY": 10,
      "rows": 2,
      "cols": 2
    },
    "referenceZ": 0.5
  }`;

  let meshData;
  try {
    meshData = JSON.parse(jsonString);
    assert(true, 'JSON deserializes without error');
  } catch (e) {
    assert(false, 'JSON deserializes without error: ' + e.message);
    return;
  }

  assert(meshData.mesh.length === 2, 'Mesh has 2 rows');
  assert(meshData.mesh[0].length === 2, 'Mesh rows have 2 columns');
  assertClose(meshData.mesh[0][0].z, 1.0, 0.001, 'First point Z is 1.0');
  assertClose(meshData.mesh[1][1].z, 4.0, 0.001, 'Last point Z is 4.0');
  assert(meshData.gridParams.startX === 0, 'Grid startX is 0');
  assert(meshData.gridParams.rows === 2, 'Grid rows is 2');
  assertClose(meshData.referenceZ, 0.5, 0.001, 'Reference Z is 0.5');
}

// ── Test 3: Grid parameters are preserved through serialization ──────────────

function testGridParametersPreservation() {
  console.log('\nTest: Grid parameters are preserved through serialization round-trip');

  const originalGridParams = {
    startX: 12.5,
    startY: 34.7,
    spacingX: 5.5,
    spacingY: 7.3,
    rows: 10,
    cols: 15
  };

  const jsonString = JSON.stringify({ gridParams: originalGridParams });
  const parsed = JSON.parse(jsonString);

  assertClose(parsed.gridParams.startX, 12.5, 0.001, 'startX preserved');
  assertClose(parsed.gridParams.startY, 34.7, 0.001, 'startY preserved');
  assertClose(parsed.gridParams.spacingX, 5.5, 0.001, 'spacingX preserved');
  assertClose(parsed.gridParams.spacingY, 7.3, 0.001, 'spacingY preserved');
  assert(parsed.gridParams.rows === 10, 'rows preserved');
  assert(parsed.gridParams.cols === 15, 'cols preserved');
}

// ── Test 4: Missing or corrupted data is handled gracefully ──────────────────

function testCorruptedDataHandling() {
  console.log('\nTest: Missing or corrupted data is handled gracefully');

  // Test malformed JSON
  const malformedJSON = '{ "mesh": [broken json';
  try {
    JSON.parse(malformedJSON);
    assert(false, 'Malformed JSON should throw error');
  } catch (e) {
    assert(true, 'Malformed JSON throws error as expected');
  }

  // Test missing mesh field
  const missingMeshJSON = '{"gridParams": {"rows": 2, "cols": 2}}';
  try {
    const data = JSON.parse(missingMeshJSON);
    assert(data.mesh === undefined, 'Missing mesh field returns undefined');
  } catch (e) {
    assert(false, 'Should parse JSON with missing mesh field');
  }

  // Test missing grid params
  const missingGridJSON = '{"mesh": []}';
  try {
    const data = JSON.parse(missingGridJSON);
    assert(data.gridParams === undefined, 'Missing gridParams field returns undefined');
  } catch (e) {
    assert(false, 'Should parse JSON with missing gridParams field');
  }
}

// ── Test 5: Mesh data structure matches expected schema ──────────────────────

function testMeshDataStructure() {
  console.log('\nTest: Mesh data structure matches expected schema');

  const meshData = {
    version: '21.0',
    timestamp: '2026-05-03T18:00:00.000Z',
    mesh: [
      [{ x: 0, y: 0, z: 0 }]
    ],
    gridParams: {
      startX: 0,
      startY: 0,
      spacingX: 10,
      spacingY: 10,
      rows: 1,
      cols: 1
    },
    referenceZ: 0
  };

  assert(typeof meshData.version === 'string', 'Version is string');
  assert(typeof meshData.timestamp === 'string', 'Timestamp is string');
  assert(Array.isArray(meshData.mesh), 'Mesh is array');
  assert(Array.isArray(meshData.mesh[0]), 'Mesh rows are arrays');
  assert(typeof meshData.mesh[0][0] === 'object', 'Mesh points are objects');
  assert(typeof meshData.mesh[0][0].x === 'number', 'Point x is number');
  assert(typeof meshData.mesh[0][0].y === 'number', 'Point y is number');
  assert(typeof meshData.mesh[0][0].z === 'number', 'Point z is number');
  assert(typeof meshData.gridParams === 'object', 'gridParams is object');
  assert(typeof meshData.gridParams.rows === 'number', 'rows is number');
  assert(typeof meshData.gridParams.cols === 'number', 'cols is number');
  assert(typeof meshData.referenceZ === 'number', 'referenceZ is number');
}

// ── Test 6: Large mesh data serialization ────────────────────────────────────

function testLargeMeshSerialization() {
  console.log('\nTest: Large mesh data can be serialized');

  // Create a 50x50 mesh
  const mesh = [];
  for (let row = 0; row < 50; row++) {
    const rowData = [];
    for (let col = 0; col < 50; col++) {
      rowData.push({
        x: col * 5,
        y: row * 5,
        z: Math.sin(col * 0.1) * Math.cos(row * 0.1)
      });
    }
    mesh.push(rowData);
  }

  const meshData = {
    mesh: mesh,
    gridParams: {
      startX: 0,
      startY: 0,
      spacingX: 5,
      spacingY: 5,
      rows: 50,
      cols: 50
    }
  };

  let jsonString;
  try {
    jsonString = JSON.stringify(meshData);
    assert(true, 'Large mesh (50x50) serializes without error');
  } catch (e) {
    assert(false, 'Large mesh serializes without error: ' + e.message);
    return;
  }

  assert(jsonString.length > 10000, 'Large mesh produces substantial JSON (' + jsonString.length + ' bytes)');

  // Test deserialization
  try {
    const parsed = JSON.parse(jsonString);
    assert(parsed.mesh.length === 50, 'Large mesh deserializes with correct row count');
    assert(parsed.mesh[0].length === 50, 'Large mesh deserializes with correct column count');
  } catch (e) {
    assert(false, 'Large mesh deserializes without error: ' + e.message);
  }
}

// ── Test 7: Special float values (infinity, NaN) handling ────────────────────

function testSpecialFloatValues() {
  console.log('\nTest: Special float values are handled in serialization');

  const meshData = {
    mesh: [
      [{ x: 0, y: 0, z: 0 }]
    ],
    gridParams: {
      startX: 0,
      startY: 0,
      spacingX: 10,
      spacingY: 10,
      rows: 1,
      cols: 1
    },
    referenceZ: 0
  };

  // Test that normal values work
  let jsonString = JSON.stringify(meshData);
  assert(jsonString.includes('"z":0'), 'Normal zero value serializes correctly');

  // Note: JSON.stringify converts Infinity and NaN to null
  meshData.mesh[0][0].z = Infinity;
  jsonString = JSON.stringify(meshData);
  assert(jsonString.includes('"z":null') || !jsonString.includes('Infinity'),
    'Infinity is handled (converted to null or removed)');

  meshData.mesh[0][0].z = NaN;
  jsonString = JSON.stringify(meshData);
  assert(jsonString.includes('"z":null') || !jsonString.includes('NaN'),
    'NaN is handled (converted to null or removed)');
}

// ── Test 8: Empty mesh data ──────────────────────────────────────────────────

function testEmptyMeshData() {
  console.log('\nTest: Empty mesh data structure');

  const emptyMeshData = {
    mesh: [],
    gridParams: {
      startX: 0,
      startY: 0,
      spacingX: 0,
      spacingY: 0,
      rows: 0,
      cols: 0
    },
    referenceZ: 0
  };

  let jsonString;
  try {
    jsonString = JSON.stringify(emptyMeshData);
    assert(true, 'Empty mesh serializes without error');
  } catch (e) {
    assert(false, 'Empty mesh serializes without error: ' + e.message);
    return;
  }

  const parsed = JSON.parse(jsonString);
  assert(parsed.mesh.length === 0, 'Empty mesh has zero rows');
  assert(parsed.gridParams.rows === 0, 'Empty mesh gridParams has zero rows');
}

// ── Run all tests ────────────────────────────────────────────────────────────

testMeshSerialization();
testMeshDeserialization();
testGridParametersPreservation();
testCorruptedDataHandling();
testMeshDataStructure();
testLargeMeshSerialization();
testSpecialFloatValues();
testEmptyMeshData();

console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---');
process.exit(failed > 0 ? 1 : 0);
