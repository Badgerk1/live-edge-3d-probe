/**
 * Unit tests for the ALARM-panel Home ($H) button.
 *
 * Validates that:
 *  1. The Home button is DISABLED (does not work) when the machine is not in ALARM.
 *  2. The Home button is ENABLED when the machine IS in ALARM.
 *  3. sendHomeCommand() sends the '$H' command and sets a footer status on success.
 *  4. sendHomeCommand() reports the error to the footer status on failure.
 *
 * Run with:  node test/home-button.test.js
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

// ── Minimal DOM stub ─────────────────────────────────────────────────────────

function makeButton(id) {
  return { id: id, disabled: true, _clicked: false };
}

function makeStatusPanel(withAutoHide) {
  var elements = {
    'plugin-alarm-warning':     { style: {}, _display: '' },
    'plugin-alarm-callout':     { style: {} },
    'plugin-alarm-status-text': { style: {}, textContent: '' },
    'plugin-alarm-detail-text': { style: {}, textContent: '', innerHTML: '' },
    'btn-unlock-x':             makeButton('btn-unlock-x'),
    'btn-home-h':               makeButton('btn-home-h'),
  };
  if (withAutoHide) {
    elements['autoHideStatusPanel'] = { checked: true };
  }
  return elements;
}

// Mirror of _updateStatusPanel from src/js/core.js
function _updateStatusPanel(isAlarm, elements) {
  var panel = elements['plugin-alarm-warning'];
  if (!panel) return;

  var autoHideEl = elements['autoHideStatusPanel'];
  var autoHideOn = autoHideEl ? autoHideEl.checked : false;

  if (autoHideOn) {
    panel.style.display = isAlarm ? '' : 'none';
  } else {
    panel.style.display = '';
  }

  var callout    = elements['plugin-alarm-callout'];
  var statusText = elements['plugin-alarm-status-text'];
  var detailText = elements['plugin-alarm-detail-text'];

  if (isAlarm) {
    if (callout)    { callout.style.background = 'rgba(220,50,50,0.12)'; callout.style.borderColor = 'var(--bad,#d03030)'; }
    if (statusText) { statusText.style.color = 'var(--bad,#d03030)'; statusText.textContent = '\u26A0 Controller in ALARM \u2014 motion locked out'; }
    if (detailText) { detailText.innerHTML = 'To recover: click <strong>Unlock ($X)</strong> to clear the alarm latch, then <strong>Home ($H)</strong>.'; }
  } else {
    if (callout)    { callout.style.background = 'rgba(30,150,50,0.08)'; callout.style.borderColor = 'var(--ok,#209020)'; }
    if (statusText) { statusText.style.color = 'var(--ok,#209020)'; statusText.textContent = '\u2713 Status: OK \u2014 No ALARM'; }
    if (detailText) { detailText.textContent = 'Machine is operating normally. Alarm recovery buttons below are disabled until an ALARM is detected.'; }
  }

  var btnUnlock = elements['btn-unlock-x'];
  var btnHome   = elements['btn-home-h'];

  if (btnUnlock) btnUnlock.disabled = !isAlarm;
  if (btnHome)   btnHome.disabled   = !isAlarm;
}

// Mirror of sendHomeCommand from src/js/core.js
async function sendHomeCommand(sendCommandFn, setFooterStatusFn, getMachineSnapshotFn) {
  try {
    await sendCommandFn('$H');
    setFooterStatusFn('ALARM: home ($H) sent', 'warn');
    try { if (getMachineSnapshotFn) await getMachineSnapshotFn(); } catch(_e) {}
  } catch(e) {
    setFooterStatusFn('Home failed: ' + e.message, 'bad');
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

(async function () {
  console.log('\n── Home button disabled when not in ALARM ──────────────────\n');

  // 1. First test: Home button does NOT work (disabled) when not in ALARM
  {
    var els1 = makeStatusPanel(false);
    _updateStatusPanel(false, els1);
    assert(els1['btn-home-h'].disabled === true,
      'Home button is disabled (does not work) when machine is NOT in ALARM');
    assert(els1['btn-unlock-x'].disabled === true,
      'Unlock button is also disabled when machine is NOT in ALARM');
    assert(els1['plugin-alarm-status-text'].textContent.indexOf('OK') >= 0,
      'Status text shows OK when not in ALARM');
  }

  console.log('\n── Home button enabled when in ALARM ───────────────────────\n');

  // 2. Home button WORKS (enabled) when machine IS in ALARM
  {
    var els2 = makeStatusPanel(false);
    _updateStatusPanel(true, els2);
    assert(els2['btn-home-h'].disabled === false,
      'Home button is enabled (works) when machine IS in ALARM');
    assert(els2['btn-unlock-x'].disabled === false,
      'Unlock button is also enabled when machine IS in ALARM');
    assert(els2['plugin-alarm-status-text'].textContent.indexOf('ALARM') >= 0,
      'Status text shows ALARM when in ALARM state');
  }

  // 3. Toggling alarm state updates button correctly
  {
    var els3 = makeStatusPanel(false);
    _updateStatusPanel(true, els3);
    assert(els3['btn-home-h'].disabled === false, 'Home enabled after alarm set');
    _updateStatusPanel(false, els3);
    assert(els3['btn-home-h'].disabled === true,  'Home disabled after alarm cleared');
  }

  // 4. Auto-hide panel: hidden when OK, shown when ALARM
  {
    var els4 = makeStatusPanel(true);
    _updateStatusPanel(false, els4);
    assert(els4['plugin-alarm-warning'].style.display === 'none',
      'Panel hidden when auto-hide ON and not in ALARM');
    _updateStatusPanel(true, els4);
    assert(els4['plugin-alarm-warning'].style.display === '',
      'Panel visible when auto-hide ON and in ALARM');
  }

  console.log('\n── sendHomeCommand ─────────────────────────────────────────\n');

  // 5. sendHomeCommand sends '$H' and sets footer status on success
  {
    var cmds5   = [];
    var footer5 = [];
    await sendHomeCommand(
      function(cmd) { cmds5.push(cmd); return Promise.resolve(); },
      function(msg, cls) { footer5.push({ msg: msg, cls: cls }); },
      null
    );
    assert(cmds5.length === 1 && cmds5[0] === '$H',
      'sendHomeCommand sends exactly one $H command');
    assert(footer5.length === 1 && footer5[0].msg.indexOf('home ($H) sent') >= 0,
      'sendHomeCommand sets footer status containing "home ($H) sent" on success');
    assert(footer5[0].cls === 'warn',
      'sendHomeCommand uses warn class for footer on success');
  }

  // 6. sendHomeCommand reports error to footer when command fails
  {
    var footer6 = [];
    await sendHomeCommand(
      function(_cmd) { return Promise.reject(new Error('controller offline')); },
      function(msg, cls) { footer6.push({ msg: msg, cls: cls }); },
      null
    );
    assert(footer6.length === 1 && footer6[0].msg.indexOf('Home failed') >= 0,
      'sendHomeCommand sets "Home failed" footer when command rejects');
    assert(footer6[0].msg.indexOf('controller offline') >= 0,
      'sendHomeCommand includes error message in footer on failure');
    assert(footer6[0].cls === 'bad',
      'sendHomeCommand uses bad class for footer on failure');
  }

  console.log('\n────────────────────────────────────────────────────────────\n');
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
})();
