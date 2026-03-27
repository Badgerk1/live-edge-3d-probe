#!/bin/bash
# Build config.html from source partials in src/
# Usage: ./build.sh
#
# Edit files in src/, then run this script to regenerate config.html.
# Do NOT edit config.html directly — your changes will be overwritten.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

cat src/config-header.html \
    src/styles.css \
    src/config-body.html \
    src/config-scripts.js \
    src/config-footer.html \
    > config.html

echo "config.html built successfully"
