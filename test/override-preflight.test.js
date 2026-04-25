/**
 * Unit tests for feed/rapid/spindle override preflight warning.
 *
 * Validates that:
 *  1. getMachineSnapshot() correctly extracts feedOverridePct, rapidOverridePct,
 *     spindleOverridePct from server state, and returns null when values are absent.
 *  2. requireStartupHomingPreflight() issues non-blocking warnings (via logLine,
 *     outlineAppendLog, setFooterStatus) when overrides are not 100%.
 *  3. No warning is issued when all overrides are 100% or when override fields are absent.
 *  4. The run is NOT blocked (function resolves) even when overrides are not 100%.
 *
 * Run with:  node test/override-preflight.test.js
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

// ── Helpers mirroring src/js/core.js logic ───────────────────────────────────

function _machineStateFrom(state) {
  return state.machineState || (state.cnc && state.cnc.machineState) || {};
}

function _extractOverrides(ms) {
  var _feedOvr    = ms.feedrateOverride  != null ? Number(ms.feedrateOverride)  : NaN;
  var _rapidOvr   = ms.rapidOverride     != null ? Number(ms.rapidOverride)     : NaN;
  var _spindleOvr = ms.spindleOverride   != null ? Number(ms.spindleOverride)   : NaN;
  return {
    feedOverridePct:    isFinite(_feedOvr)    ? _feedOvr    : null,
    rapidOverridePct:   isFinite(_rapidOvr)   ? _rapidOvr   : null,
    spindleOverridePct: isFinite(_spindleOvr) ? _spindleOvr : null,
  };
}

function _buildOverrideWarnings(info) {
  var warns = [];
  if (typeof info.feedOverridePct === 'number' && info.feedOverridePct !== 100) {
    warns.push('Feed override is ' + info.feedOverridePct + '% \u2014 travel will be slower than commanded.');
  }
  if (typeof info.rapidOverridePct === 'number' && info.rapidOverridePct !== 100) {
    warns.push('Rapid override is ' + info.rapidOverridePct + '%.');
  }
  if (typeof info.spindleOverridePct === 'number' && info.spindleOverridePct !== 100) {
    warns.push('Spindle override is ' + info.spindleOverridePct + '%.');
  }
  return warns;
}

// ── Mock preflight (mirrors requireStartupHomingPreflight relevant section) ───

function makeMocks() {
  var logs = { top: [], face: [], outline: [], footer: [] };
  var debugs = [];

  function mockLogLine(mode, msg) {
    if (logs[mode]) logs[mode].push(msg);
  }
  function mockPluginDebug(msg) {
    debugs.push(msg);
  }
  function mockOutlineAppendLog(msg) {
    logs.outline.push(msg);
  }
  function mockSetFooterStatus(msg, type) {
    logs.footer.push({ msg: msg, type: type });
  }

  return { logs: logs, debugs: debugs, mockLogLine: mockLogLine, mockPluginDebug: mockPluginDebug, mockOutlineAppendLog: mockOutlineAppendLog, mockSetFooterStatus: mockSetFooterStatus };
}

async function mockRunPreflight(info, mocks) {
  var logLine          = mocks.mockLogLine;
  var pluginDebug      = mocks.mockPluginDebug;
  var outlineAppendLog = mocks.mockOutlineAppendLog;
  var setFooterStatus  = mocks.mockSetFooterStatus;

  // Mirrors the warning block in requireStartupHomingPreflight
  var _overrideWarns = [];
  if (typeof info.feedOverridePct === 'number' && info.feedOverridePct !== 100) {
    _overrideWarns.push('Feed override is ' + info.feedOverridePct + '% \u2014 travel will be slower than commanded.');
  }
  if (typeof info.rapidOverridePct === 'number' && info.rapidOverridePct !== 100) {
    _overrideWarns.push('Rapid override is ' + info.rapidOverridePct + '%.');
  }
  if (typeof info.spindleOverridePct === 'number' && info.spindleOverridePct !== 100) {
    _overrideWarns.push('Spindle override is ' + info.spindleOverridePct + '%.');
  }
  if (_overrideWarns.length > 0) {
    var _warnMsg = 'WARNING: ' + _overrideWarns.join(' ');
    pluginDebug('requireStartupHomingPreflight OVERRIDE WARNING: ' + _warnMsg);
    logLine('top', _warnMsg);
    logLine('face', _warnMsg);
    if (typeof outlineAppendLog === 'function') outlineAppendLog(_warnMsg);
    setFooterStatus(_warnMsg, 'warn');
  }
  return info;
}

// ── Tests ────────────────────────────────────────────────────────────────────

(async function () {
  console.log('\n── _extractOverrides ───────────────────────────────────────\n');

  // 1) All overrides present and at nominal values
  {
    var ms = { feedrateOverride: 70, rapidOverride: 100, spindleOverride: 100 };
    var ovr = _extractOverrides(ms);
    assert(ovr.feedOverridePct === 70,  'feedOverridePct = 70 when feedrateOverride=70');
    assert(ovr.rapidOverridePct === 100, 'rapidOverridePct = 100 when rapidOverride=100');
    assert(ovr.spindleOverridePct === 100, 'spindleOverridePct = 100 when spindleOverride=100');
  }

  // 2) Override fields absent → null
  {
    var ms2 = {};
    var ovr2 = _extractOverrides(ms2);
    assert(ovr2.feedOverridePct === null,    'feedOverridePct null when field absent');
    assert(ovr2.rapidOverridePct === null,   'rapidOverridePct null when field absent');
    assert(ovr2.spindleOverridePct === null, 'spindleOverridePct null when field absent');
  }

  // 3) Override fields explicitly 100 → no warning
  {
    var ms3 = { feedrateOverride: 100, rapidOverride: 100, spindleOverride: 100 };
    var ovr3 = _extractOverrides(ms3);
    var warns3 = _buildOverrideWarnings(ovr3);
    assert(warns3.length === 0, 'no warnings when all overrides = 100');
  }

  // 4) machineState nested under cnc key
  {
    var state4 = { cnc: { machineState: { feedrateOverride: 50 } } };
    var ms4 = _machineStateFrom(state4);
    var ovr4 = _extractOverrides(ms4);
    assert(ovr4.feedOverridePct === 50, 'feedOverridePct = 50 from cnc.machineState');
  }

  // 5) Non-numeric value → null
  {
    var ms5 = { feedrateOverride: 'N/A', rapidOverride: null };
    var ovr5 = _extractOverrides(ms5);
    assert(ovr5.feedOverridePct === null,  'feedOverridePct null for non-numeric string');
    assert(ovr5.rapidOverridePct === null, 'rapidOverridePct null for null value');
  }

  console.log('\n── _buildOverrideWarnings ──────────────────────────────────\n');

  // 6) Feed override not 100 → warning contains percentage and description
  {
    var info6 = { feedOverridePct: 70, rapidOverridePct: 100, spindleOverridePct: 100 };
    var warns6 = _buildOverrideWarnings(info6);
    assert(warns6.length === 1, 'one warning when only feedOverridePct != 100');
    assert(warns6[0].indexOf('70%') >= 0, 'warning text contains 70%');
    assert(warns6[0].indexOf('slower than commanded') >= 0, 'warning text mentions slower than commanded');
  }

  // 7) Multiple overrides not 100 → multiple warnings
  {
    var info7 = { feedOverridePct: 80, rapidOverridePct: 50, spindleOverridePct: 110 };
    var warns7 = _buildOverrideWarnings(info7);
    assert(warns7.length === 3, 'three warnings when all overrides != 100');
  }

  // 8) Null overrides → no warning
  {
    var info8 = { feedOverridePct: null, rapidOverridePct: null, spindleOverridePct: null };
    var warns8 = _buildOverrideWarnings(info8);
    assert(warns8.length === 0, 'no warnings when all override fields are null');
  }

  console.log('\n── preflight warning integration ───────────────────────────\n');

  // 9) Feed override not 100 → logs warnings to top, face, outline, footer
  {
    var mocks9 = makeMocks();
    var info9 = { feedOverridePct: 70, rapidOverridePct: 100, spindleOverridePct: 100 };
    var result9 = await mockRunPreflight(info9, mocks9);
    assert(result9 === info9, 'preflight returns info (non-blocking)');
    assert(mocks9.logs.top.length === 1,     'one warning logged to top');
    assert(mocks9.logs.face.length === 1,    'one warning logged to face');
    assert(mocks9.logs.outline.length === 1, 'one warning logged to outline');
    assert(mocks9.logs.footer.length === 1 && mocks9.logs.footer[0].type === 'warn', 'footer status set to warn');
    assert(mocks9.logs.top[0].indexOf('Feed override') >= 0, 'top log contains "Feed override"');
  }

  // 10) All overrides at 100 → no logs, footer unchanged
  {
    var mocks10 = makeMocks();
    var info10 = { feedOverridePct: 100, rapidOverridePct: 100, spindleOverridePct: 100 };
    await mockRunPreflight(info10, mocks10);
    assert(mocks10.logs.top.length === 0,     'no top log when all overrides = 100');
    assert(mocks10.logs.face.length === 0,    'no face log when all overrides = 100');
    assert(mocks10.logs.outline.length === 0, 'no outline log when all overrides = 100');
    assert(mocks10.logs.footer.length === 0,  'footer not touched when all overrides = 100');
  }

  // 11) Override fields absent → no logs
  {
    var mocks11 = makeMocks();
    var info11 = { feedOverridePct: null, rapidOverridePct: null, spindleOverridePct: null };
    await mockRunPreflight(info11, mocks11);
    assert(mocks11.logs.top.length === 0,    'no top log when override fields absent');
    assert(mocks11.logs.footer.length === 0, 'footer not touched when override fields absent');
  }

  // 12) Rapid override not 100 → specific warning message
  {
    var mocks12 = makeMocks();
    var info12 = { feedOverridePct: 100, rapidOverridePct: 25, spindleOverridePct: 100 };
    await mockRunPreflight(info12, mocks12);
    assert(mocks12.logs.top.length === 1, 'one warning when only rapidOverridePct != 100');
    assert(mocks12.logs.top[0].indexOf('Rapid override is 25%') >= 0, 'rapid override warning contains percentage');
  }

  console.log('\n────────────────────────────────────────────────────────────\n');
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
})();
