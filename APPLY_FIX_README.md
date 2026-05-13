# Standalone Fix - Quick Start Guide

This script automates the entire process of applying the G38.2 probe command fix to the Stand-alone repository.

## What it does

The script will:
1. ✓ Clone the Stand-alone repository
2. ✓ Create a new branch: `fix/match-plugin-g38-2-probe-command`
3. ✓ Change G38.3 to G38.2 in the probe command
4. ✓ Update the code comment
5. ✓ Rebuild both HTML files
6. ✓ Commit all changes
7. ✓ Push to GitHub (with your confirmation)
8. ✓ Provide PR creation instructions

## Usage

### Basic usage (creates workspace in current directory):
```bash
bash apply-standalone-fix.sh
```

### Specify custom workspace location:
```bash
bash apply-standalone-fix.sh /path/to/your/workspace
```

## Prerequisites

- Git installed
- GitHub authentication configured (for pushing)

## What happens

The script is fully interactive and will:
- Ask before removing existing workspace
- Ask before pushing to GitHub
- Show you the changes being made
- Provide complete PR instructions at the end

## Example run

```bash
$ bash apply-standalone-fix.sh

╔════════════════════════════════════════════════════════════════╗
║  Standalone Repository G38.2 Fix - Automated Script           ║
╚════════════════════════════════════════════════════════════════╝

▶ Checking prerequisites...
✓ git found

▶ Step 1: Cloning Stand-alone repository...
✓ Repository cloned

▶ Step 2: Creating fix branch...
✓ Branch 'fix/match-plugin-g38-2-probe-command' created

▶ Step 3: Applying G38.3 -> G38.2 fix...
✓ Successfully changed G38.3 to G38.2

▶ Step 4: Rebuilding HTML files...
✓ standalone.html rebuilt
✓ standalone-ws.html rebuilt

▶ Step 5: Committing changes...
✓ Changes committed

▶ Step 6: Pushing to remote...
Push changes to origin? (y/n) y
✓ Changes pushed successfully

▶ Step 7: Create Pull Request
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SUCCESS! All changes have been pushed.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Next steps:
1. Go to: https://github.com/Badgerk1/Stand-alone
2. You should see a banner to create a Pull Request
3. Click 'Compare & pull request'
```

## Troubleshooting

**Problem:** "Permission denied" when pushing

**Solution:** Make sure you have push access to the Stand-alone repository, or fork it first and update the REPO_URL in the script.

**Problem:** sed command not working properly

**Solution:** The script uses GNU sed syntax. On macOS, you may need to install GNU sed via `brew install gnu-sed`.

## Manual alternative

If you prefer to do it manually, see the full documentation in:
- `STANDALONE_FIX.md` - Complete documentation
- `standalone-g38.2-fix.patch` - Git patch file you can apply manually

## Files

- `apply-standalone-fix.sh` - Main automation script (this script)
- `STANDALONE_FIX.md` - Detailed documentation
- `standalone-g38.2-fix.patch` - Git patch format
- `standalone-changes.diff` - Diff format

## What gets changed

**File:** `src-standalone/js/top-probe.js`

**Line 244 changes from:**
```javascript
var probeCmd = 'G91 G38.3 Z-' + maxPlunge.toFixed(3) + ' F' + probeFeed;
```

**To:**
```javascript
var probeCmd = 'G91 G38.2 Z-' + maxPlunge.toFixed(3) + ' F' + probeFeed;
```

This makes the standalone version work exactly like the plugin version.
