# Fix for Stand-alone Repository Surface Probe Issue

## Problem
The standalone version (https://github.com/Badgerk1/Stand-alone) uses G38.3 probe command instead of G38.2, causing surface probe issues in the Probing Control panel.

## Solution
Change the probe command from G38.3 to G38.2 to match the plugin behavior.

## Changes Made

### File: `src-standalone/js/top-probe.js`

**Line 240-244 (old):**
```javascript
  // Issue the probe move and require contact within maxPlunge.
  // G38.3 is used instead of G38.2 so the controller does not alarm when the
  // surface is not found within maxPlunge — the JS error handling below reports
  // "No contact within max plunge" cleanly without needing an $X unlock cycle.
  var probeCmd = 'G91 G38.3 Z-' + maxPlunge.toFixed(3) + ' F' + probeFeed;
```

**Line 240-243 (new):**
```javascript
  // Issue the probe move and require contact within maxPlunge.
  // G38.2 is used to match the plugin behavior - controller will alarm if no contact
  // is made within maxPlunge distance, providing immediate feedback of probe issues.
  var probeCmd = 'G91 G38.2 Z-' + maxPlunge.toFixed(3) + ' F' + probeFeed;
```

## Impact
- Standalone now behaves identically to the plugin for surface probe operations
- GRBL will alarm if probe doesn't make contact (immediate feedback)
- More reliable error detection compared to G38.3 which relies on JavaScript position checking

## Build Instructions
After making the source change, rebuild both HTML files:
```bash
bash build-standalone.sh
bash build-standalone-ws.sh
```

## Files Modified
1. `src-standalone/js/top-probe.js` - Source file with probe command change
2. `standalone.html` - Rebuilt from sources (line 9034)
3. `standalone-ws.html` - Rebuilt from sources (line 9034)

## Testing
Test the surface probe in the Probing Control panel to verify:
1. Probe operates correctly when contact is made
2. GRBL alarms appropriately when no contact is detected within maxPlunge distance
3. Behavior matches the live-edge-3d-probe plugin

## Branch Information
- Branch name: `fix/match-plugin-g38-2-probe-command`
- Base: `main`
- Repository: Badgerk1/Stand-alone

## Commit Message
```
Change surface probe from G38.3 to G38.2 to match plugin behavior

This change makes the standalone version function identically to the
live-edge-3d-probe plugin for surface probe operations.

Changes:
- Modified src-standalone/js/top-probe.js to use G38.2 instead of G38.3
- Updated comment to reflect new behavior
- Rebuilt standalone.html and standalone-ws.html
```

## PR Description Template
```markdown
## Summary
Changes the surface probe command from G38.3 to G38.2 to match the live-edge-3d-probe plugin behavior.

## Problem
The standalone version was using G38.3 (no-alarm probe) which caused issues with the surface probe in the Probing Control panel. The plugin version uses G38.2 (alarm-on-no-contact) which provides better error handling.

## Solution
- Changed probe command in `smPlungeProbe()` from G38.3 to G38.2
- Updated comment to reflect the new behavior
- Rebuilt both standalone HTML files

## Testing
- [ ] Surface probe works correctly with contact detection
- [ ] GRBL alarms when no contact is made within maxPlunge
- [ ] Behavior matches live-edge-3d-probe plugin

## Related
- Comparison done against: https://github.com/Badgerk1/live-edge-3d-probe
- Plugin file reference: `src/js/top-probe.js` line 241
```

## Patch File
A Git patch file has been created and is available in the branch for easy application.
