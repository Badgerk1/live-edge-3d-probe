#!/bin/bash

################################################################################
# Standalone Repository G38.2 Fix - Automated Application Script
#
# This script automates the process of:
# 1. Cloning the Stand-alone repository
# 2. Creating a fix branch
# 3. Applying the G38.3 -> G38.2 probe command change
# 4. Rebuilding HTML files
# 5. Committing and pushing changes
# 6. Providing PR creation instructions
#
# Usage: bash apply-standalone-fix.sh
################################################################################

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REPO_URL="https://github.com/Badgerk1/Stand-alone.git"
BRANCH_NAME="fix/match-plugin-g38-2-probe-command"
WORK_DIR="${1:-./standalone-fix-workspace}"
FILE_TO_EDIT="src-standalone/js/top-probe.js"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Standalone Repository G38.2 Fix - Automated Script           ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Function to print step headers
print_step() {
    echo ""
    echo -e "${GREEN}▶ $1${NC}"
    echo "────────────────────────────────────────────────────────────────"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
print_step "Checking prerequisites..."
if ! command_exists git; then
    echo -e "${RED}Error: git is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ git found${NC}"

# Step 1: Clone the repository
print_step "Step 1: Cloning Stand-alone repository..."
if [ -d "$WORK_DIR" ]; then
    echo -e "${YELLOW}⚠ Working directory already exists: $WORK_DIR${NC}"
    read -p "Remove and re-clone? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$WORK_DIR"
    else
        echo -e "${RED}Aborted. Please remove the directory manually or choose a different location.${NC}"
        exit 1
    fi
fi

git clone "$REPO_URL" "$WORK_DIR"
cd "$WORK_DIR"
echo -e "${GREEN}✓ Repository cloned${NC}"

# Step 2: Create and checkout branch
print_step "Step 2: Creating fix branch..."
git checkout -b "$BRANCH_NAME"
echo -e "${GREEN}✓ Branch '$BRANCH_NAME' created${NC}"

# Step 3: Apply the fix
print_step "Step 3: Applying G38.3 -> G38.2 fix..."

# Check if file exists
if [ ! -f "$FILE_TO_EDIT" ]; then
    echo -e "${RED}Error: File $FILE_TO_EDIT not found${NC}"
    exit 1
fi

# Create backup
cp "$FILE_TO_EDIT" "$FILE_TO_EDIT.backup"

# Apply the fix using sed
# This replaces the G38.3 command and updates the comment
sed -i.tmp '/Issue the probe move and require contact within maxPlunge/,/var probeCmd = / {
    /G38.3 is used instead of G38.2/,/without needing an \$X unlock cycle/ {
        c\  // G38.2 is used to match the plugin behavior - controller will alarm if no contact\
  // is made within maxPlunge distance, providing immediate feedback of probe issues.
    }
    s/G38\.3/G38.2/g
}' "$FILE_TO_EDIT"

# Remove the temp file created by sed
rm -f "$FILE_TO_EDIT.tmp"

# Verify the change was made
if grep -q "G38.2" "$FILE_TO_EDIT"; then
    echo -e "${GREEN}✓ Successfully changed G38.3 to G38.2${NC}"
else
    echo -e "${RED}Error: Failed to apply the fix${NC}"
    mv "$FILE_TO_EDIT.backup" "$FILE_TO_EDIT"
    exit 1
fi

# Show the diff
echo ""
echo -e "${BLUE}Changes made:${NC}"
git diff "$FILE_TO_EDIT" | head -30

# Step 4: Rebuild HTML files
print_step "Step 4: Rebuilding HTML files..."

if [ -f "build-standalone.sh" ]; then
    bash build-standalone.sh
    echo -e "${GREEN}✓ standalone.html rebuilt${NC}"
else
    echo -e "${YELLOW}⚠ build-standalone.sh not found, skipping${NC}"
fi

if [ -f "build-standalone-ws.sh" ]; then
    bash build-standalone-ws.sh
    echo -e "${GREEN}✓ standalone-ws.html rebuilt${NC}"
else
    echo -e "${YELLOW}⚠ build-standalone-ws.sh not found, skipping${NC}"
fi

# Step 5: Commit changes
print_step "Step 5: Committing changes..."

git add .

# Create commit message
git commit -m "Change surface probe from G38.3 to G38.2 to match plugin behavior

This change makes the standalone version function identically to the
live-edge-3d-probe plugin for surface probe operations.

Changes:
- Modified src-standalone/js/top-probe.js to use G38.2 instead of G38.3
- Updated comment to reflect new behavior
- Rebuilt standalone.html and standalone-ws.html

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

echo -e "${GREEN}✓ Changes committed${NC}"

# Step 6: Push to remote
print_step "Step 6: Pushing to remote..."

echo ""
echo -e "${YELLOW}Ready to push to remote repository.${NC}"
echo -e "${YELLOW}Note: You may need to authenticate with GitHub.${NC}"
echo ""
read -p "Push changes to origin? (y/n) " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    if git push -u origin "$BRANCH_NAME"; then
        echo -e "${GREEN}✓ Changes pushed successfully${NC}"

        # Step 7: PR instructions
        print_step "Step 7: Create Pull Request"
        echo ""
        echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${GREEN}SUCCESS! All changes have been pushed.${NC}"
        echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""
        echo -e "${BLUE}Next steps:${NC}"
        echo "1. Go to: https://github.com/Badgerk1/Stand-alone"
        echo "2. You should see a banner to create a Pull Request"
        echo "3. Click 'Compare & pull request'"
        echo ""
        echo -e "${BLUE}PR Title:${NC}"
        echo "Change surface probe from G38.3 to G38.2 to match plugin behavior"
        echo ""
        echo -e "${BLUE}PR Description:${NC}"
        echo "────────────────────────────────────────────────────────────────"
        cat <<'EOF'
## Summary
Changes the surface probe command from G38.3 to G38.2 to match the live-edge-3d-probe plugin behavior.

## Problem
The standalone version was using G38.3 (no-alarm probe) which caused issues with the surface probe in the Probing Control panel. The plugin version uses G38.2 (alarm-on-no-contact) which provides better error handling.

## Solution
- Changed probe command in `smPlungeProbe()` from G38.3 to G38.2
- Updated comment to reflect the new behavior
- Rebuilt both standalone HTML files

## Files Changed
- `src-standalone/js/top-probe.js` (line 244)
- `standalone.html` (rebuilt)
- `standalone-ws.html` (rebuilt)

## Testing
- [ ] Surface probe works correctly with contact detection
- [ ] GRBL alarms when no contact is made within maxPlunge
- [ ] Behavior matches live-edge-3d-probe plugin

## Related
- Comparison against: https://github.com/Badgerk1/live-edge-3d-probe
- Plugin reference: `src/js/top-probe.js` line 241
EOF
        echo "────────────────────────────────────────────────────────────────"
        echo ""
        echo -e "${GREEN}✓ Script completed successfully!${NC}"
    else
        echo -e "${RED}✗ Failed to push changes${NC}"
        echo -e "${YELLOW}You may need to set up authentication or push manually:${NC}"
        echo "  cd $WORK_DIR"
        echo "  git push -u origin $BRANCH_NAME"
        exit 1
    fi
else
    echo ""
    echo -e "${YELLOW}Changes not pushed. To push manually later:${NC}"
    echo "  cd $WORK_DIR"
    echo "  git push -u origin $BRANCH_NAME"
fi

echo ""
echo -e "${BLUE}Working directory: $WORK_DIR${NC}"
echo ""
