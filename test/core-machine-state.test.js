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
  for (var i = braceStart; i < source.length; i++) {
    var ch = source[i];
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('Unterminated function ' + name);
}

function loadFunctions(source, names) {
  var fnBody = names.map(function(name) { return extractFunction(source, name); }).join('\n\n');
  return new Function(fnBody + '\nreturn {' + names.map(function(name) { return name + ':' + name; }).join(',') + '};')();
}

var coreSource = fs.readFileSync(new URL('../src/js/core.js', import.meta.url), 'utf8');
var loaded = loadFunctions(coreSource, [
  '_parsePos',
  '_pickMsField',
  '_normalizeMsPos',
  '_normalizeMachineState',
  '_machineStateScore',
  '_machineStateFrom',
  '_machineAlarmReason'
]);

console.log('=== core-machine-state tests ===');

console.log('\nTest: _parsePos accepts string/array/object formats');
var posFromString = loaded._parsePos('1.25,2.5,-3.75');
var posFromArray = loaded._parsePos([1.25, 2.5, -3.75]);
var posFromObject = loaded._parsePos({ x: 1.25, y: 2.5, z: -3.75 });
assert(posFromString && posFromString.x === 1.25 && posFromString.y === 2.5 && posFromString.z === -3.75, 'string position parses');
assert(posFromArray && posFromArray.x === 1.25 && posFromArray.y === 2.5 && posFromArray.z === -3.75, 'array position parses');
assert(posFromObject && posFromObject.x === 1.25 && posFromObject.y === 2.5 && posFromObject.z === -3.75, 'object position parses');

console.log('\nTest: _machineStateFrom prefers richer normalized machine state');
var mixedState = {
  machineState: { status: 'Idle', WPos: '0,0,0', MPos: '0,0,0', WCO: '0,0,0', Pn: '' },
  cnc: {
    state: {
      status: 'Run',
      wpos: [304.8, 138.11, -2],
      mpos: [304.8, 138.11, 10],
      wco: [0, 0, 12],
      pn: 'P'
    }
  }
};
var selected = loaded._machineStateFrom(mixedState);
assert(selected.status === 'Run', 'selected state keeps active status from richer candidate');
assert(selected.WPos === '304.800,138.110,-2.000', 'selected state normalizes lowercase wpos');
assert(selected.MPos === '304.800,138.110,10.000', 'selected state normalizes lowercase mpos');
assert(selected.Pn === 'P', 'selected state normalizes lowercase probe pin');

console.log('\nTest: _machineAlarmReason surfaces alarm detail text');
var alarmReason = loaded._machineAlarmReason(
  { status: 'Alarm', error: 'error: Probe fail' },
  { lastAlarm: 'ALARM:2 Soft limit' }
);
assert(/ALARM:2/.test(alarmReason), 'alarm reason includes specific alarm code');
assert(/Probe fail/.test(alarmReason), 'alarm reason includes controller error detail');

console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---');
process.exit(failed > 0 ? 1 : 0);
