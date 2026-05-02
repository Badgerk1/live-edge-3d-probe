#!/bin/bash
# Build standalone-ws.html — a self-contained, browser-openable version of the
# 3D Live Edge Probe tool that connects to a network-based GRBL controller via
# WebSocket (no USB / Web Serial required).
#
# How it works
# ────────────
# Identical to build-standalone.sh, except standalone/src/websocket-transport.js
# is appended AFTER all src/js/*.js files inside the same <script> block.
# JavaScript resolves duplicate function declarations last-wins, so the
# transport overrides in websocket-transport.js silently replace the
# fetch-based ncSender calls in src/js/core.js:
#
#   sendCommand()                   → WebSocket send + wait for GRBL 'ok'
#   _getState()                     → send '?' + parse GRBL status report
#   _trySafeStopEndpoints()         → send '!' feed-hold byte directly
#   requireStartupHomingPreflight() → relaxed (GRBL has no homed flag)
#
# Supported boards: any controller that speaks GRBL-protocol text over a plain
# WebSocket connection — FluidNC, Smoothieware, grblHAL network builds, etc.
# The default UI port is 8090 (changeable in the browser header bar).
#
# All probe math, visualisation, settings, and UI are shared unchanged.
#
# Usage
# ─────
#   bash build-standalone-ws.sh     → generates standalone-ws.html
#
# IMPORTANT
# ─────────
# • Do NOT edit standalone-ws.html directly — your changes will be overwritten.
# • Edit standalone/src/websocket-transport.js or any src/ file, then re-run.
# • This script never modifies config.html, standalone.html, or any source file.

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
    standalone/src/websocket-transport.js \
    src/config-footer.html \
    > standalone-ws.html

echo "standalone-ws.html built successfully"
