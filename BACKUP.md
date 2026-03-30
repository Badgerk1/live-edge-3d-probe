# Repository Backup Information

## Backup Created
- **Date**: 2026-03-30
- **Backup Reference**: Commit `d2415db` on `main` branch
- **Tag Name** (to create): `backup-20260330`

## Purpose
This backup preserves the complete state of the repository before any future changes. If things don't work out with upcoming modifications, you have a complete backup to restore from.

## Creating the Backup Tag
After merging this PR, run the following command to create the permanent backup tag:

```bash
# Create the backup tag pointing to the backup commit
git tag -a backup-20260330 d2415db -m "Complete repository backup - 2026-03-30"

# Push the tag to remote
git push origin backup-20260330
```

Alternatively, you can create the tag through GitHub's web interface:
1. Go to the repository's Releases page
2. Click "Create a new release"
3. Enter `backup-20260330` as the tag
4. Select the commit `d2415db` as the target
5. Add a title like "Complete Repository Backup - March 30, 2026"

## What's Backed Up
The backup includes all files in the repository:

### Root Files
- `config.html` - Main generated configuration file
- `index.js` - Plugin entry point
- `manifest.json` - Plugin manifest
- `build.sh` - Build script
- `README.md` - Documentation
- `SECURITY.md` - Security policy
- `live_edge_icon.png` / `live_edge_icon_small.png` - Plugin icons

### Source Files (`src/`)
- `config-header.html` - HTML header partial
- `config-body.html` - HTML body partial  
- `config-footer.html` - HTML footer partial
- `styles.css` - Stylesheet

### JavaScript Source (`src/js/`)
- `core.js` - Core functionality and utilities
- `face-probe.js` - Face probing logic
- `finish-motion.js` - Finish motion handling
- `probe-engine.js` - Probe engine implementation
- `top-probe.js` - Top/surface probing logic
- `ui-helpers.js` - UI helper functions
- `visualization.js` - 3D visualization code

## How to Restore

### Option 1: Restore to backup tag
```bash
# View the backup tag
git show backup-20260330

# Checkout the backup tag (read-only state)
git checkout backup-20260330

# Or create a new branch from the backup
git checkout -b restore-from-backup backup-20260330
```

### Option 2: Restore specific files
```bash
# Restore a specific file from the backup
git checkout backup-20260330 -- path/to/file

# Restore all files from backup
git checkout backup-20260330 -- .
```

### Option 3: Hard reset to backup (WARNING: destroys uncommitted changes)
```bash
git reset --hard backup-20260330
```

## Verification
After restoring, verify the backup by:
1. Running `./build.sh` to rebuild config.html
2. Loading the plugin in your CNC software
3. Testing basic functionality

## Notes
- This backup is stored as a git tag, which is a permanent reference point
- The tag will persist even if branches are deleted
- Always verify your restore worked before making new changes
