import fs from 'node:fs';

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

function extractFunction(source, name) {
  var start = source.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('Could not find function ' + name);
  var braceStart = source.indexOf('{', start);
  if (braceStart === -1) throw new Error('Could not find function body for ' + name);

  var depth = 0;
  var inSingle = false;
  var inDouble = false;
  var inLineComment = false;
  var inBlockComment = false;

  for (var i = braceStart; i < source.length; i++) {
    var ch = source[i];
    var next = source[i + 1];
    var prev = source[i - 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (prev === '*' && ch === '/') inBlockComment = false;
      continue;
    }
    if (inSingle) {
      if (ch === '\'' && prev !== '\\') inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"' && prev !== '\\') inDouble = false;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '\'') {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }

    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  throw new Error('Unterminated function ' + name);
}

function loadFunction(source, name) {
  var fnSource = extractFunction(source, name);
  return new Function(fnSource + '\nreturn ' + name + ';')();
}

var outlineProbeSource = fs.readFileSync(new URL('../src/js/outline-probe.js', import.meta.url), 'utf8');
var validateSurfaceProbeResult = loadFunction(outlineProbeSource, '_outlineValidateSurfaceProbeResult');
var getZMoveDirection = loadFunction(outlineProbeSource, '_outlineGetZMoveDirection');

console.log('=== outline-surface-probe-phase1 tests ===');

console.log('\nTest: no-motion + no-trigger probe result fails fast');
var noMotionMiss = validateSurfaceProbeResult({ z: 0 }, { z: 0 }, false, false, 165);
assert(!noMotionMiss.ok, 'no-motion/no-trigger result is rejected');
assert(noMotionMiss.noMotion, 'no-motion flag is set');
assert(!noMotionMiss.fullTravelMiss, 'full-travel miss flag stays false when machine never moved');
assert(/aborting before retract/.test(noMotionMiss.error), 'operator error explains retract is skipped');

console.log('\nTest: full-travel no-contact result still fails');
var fullTravelMiss = validateSurfaceProbeResult({ z: 5 }, { z: -160 }, false, false, 165);
assert(!fullTravelMiss.ok, 'full-travel miss is rejected');
assert(fullTravelMiss.fullTravelMiss, 'full-travel miss flag is set');
assert(/No contact in full Z travel range/.test(fullTravelMiss.error), 'full-travel miss keeps existing no-contact message');

console.log('\nTest: triggered result remains valid');
var triggeredHit = validateSurfaceProbeResult({ z: 10 }, { z: 2.25 }, false, true, 165);
assert(triggeredHit.ok, 'pin-triggered result is accepted');
assert(!triggeredHit.noMotion, 'triggered hit records motion');
assert(triggeredHit.distTraveled > 0, 'triggered hit reports positive travel distance');

console.log('\nTest: retract logging direction is explicit');
assert(getZMoveDirection(0, 2) === 'upward', 'upward retract is labeled upward');
assert(getZMoveDirection(2, 0) === 'downward', 'downward retract is labeled downward');
assert(getZMoveDirection(2, 2) === 'level', 'same-height retract is labeled level');

console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---');
process.exit(failed > 0 ? 1 : 0);
