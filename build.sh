#!/bin/bash
# Build config.html from source partials in src/
# Usage: ./build.sh
#
# Edit files in src/config-header.html, src/styles.css, src/config-body.html,
# src/config-footer.html, or any file under src/js/ then run this script to
# regenerate config.html.
# Do NOT edit config.html directly — your changes will be overwritten.
#
# Source structure:
#   src/config-header.html  — HTML head/header (opens <html><head>...)
#   src/styles.css          — All CSS styles (included inline in the header)
#   src/config-body.html    — HTML body + UI markup (ends with opening <script> tag)
#   src/js/core.js          — Global vars, utilities, motion helpers
#   src/js/ui-helpers.js    — Settings, export functions, jog controls, results tables
#   src/js/face-probe.js    — Face probe logic (probeAbsAxis, runFaceProbe, etc.)
#   src/js/probe-engine.js  — Surface probe primitives (smPlungeProbe, smRetractUp, etc.)
#   src/js/visualization.js — 3D terrain rendering, heatmaps, Three.js scenes
#   src/js/top-probe.js     — Surface mesh probing (runSurfaceProbing) + apply tab
#   src/js/finish-motion.js — finishRunMotion, combined probe, face mesh, cleanup
#   src/config-footer.html  — Closes </script></body></html>

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

cat src/config-header.html \
    src/styles.css \
    src/config-body.html \
    src/js/core.js \
    src/js/ui-helpers.js \
    src/js/face-probe.js \
    src/js/probe-engine.js \
    src/js/visualization.js \
    src/js/top-probe.js \
    src/js/finish-motion.js \
    src/config-footer.html \
    > config.html

echo "config.html built successfully"
