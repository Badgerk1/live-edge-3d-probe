#!/bin/bash
# Build standalone.html — a self-contained, browser-openable version of the
# 3D Live Edge Probe tool that connects directly to GRBL via the Web Serial API.
#
# How it works
# ────────────
# Identical to build.sh, except standalone/src/webserial-transport.js is
# appended AFTER all src/js/*.js files inside the same <script> block.
# JavaScript resolves duplicate function declarations last-wins, so the
# transport overrides in webserial-transport.js silently replace the
# fetch-based ncSender calls in src/js/core.js:
#
#   sendCommand()                   → serial write + wait for GRBL 'ok'
#   _getState()                     → send '?' + parse GRBL status report
#   _trySafeStopEndpoints()         → send '!' feed-hold byte directly
#   requireStartupHomingPreflight() → relaxed (GRBL has no homed flag)
#
# All probe math, visualisation, settings, and UI are shared unchanged.
#
# Usage
# ─────
#   bash build-standalone.sh        → generates standalone.html
#
# IMPORTANT
# ─────────
# • Do NOT edit standalone.html directly — your changes will be overwritten.
# • Edit standalone/src/webserial-transport.js or any src/ file, then re-run.
# • This script never modifies config.html or any existing source file.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

cat src/config-header.html \
    src/styles.css \
    src/config-body.html \
    src/js/core.js \
    src/js/ui-helpers.js \
    src/js/probe-engine.js \
    src/js/visualization.js \
    src/js/top-probe.js \
    src/js/face-probe.js \
    src/js/outline-probe.js \
    src/js/finish-motion.js \
    src/js/settings-and-exports.js \
    src/js/diagnostics.js \
    src/js/layout-editor.js \
    standalone/src/webserial-transport.js \
    src/config-footer.html \
    > standalone.html

echo "standalone.html built successfully"
