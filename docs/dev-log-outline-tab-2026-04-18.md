# Outline Tab Development Log — 2026-04-18

## Session Summary
Working session between @Badgerk1 and Copilot to build and debug the Outline tab
for 360 edge detection and face probing on live edge wood slabs.

---

## Bugs Found & Fixed

### Bug 1: `smPlungeProbe` reads the WRONG clearance field
- **File:** `src/js/outline-probe.js` → called `smPlungeProbe()` from `top-probe.js`
- **Problem:** `smPlungeProbe` internally reads `sm-clearanceZ` (the Surface Probe tab's field), not the Outline tab's fields. If `sm-clearanceZ` is low/0, `smEnsureProbeClear()` lifts to a Z that is too low.
- **Symptom:** User reported "probe keeps raising" and "machine alarm state" on surface probe.
- **Fix:** Do NOT use `smPlungeProbe` for outline operations. Use direct `G91 G38.2` plunge with `smEnsureProbeClear()` called with the **outline's own** `outlineSafeTravelZ` and `outlineClearZ` values.

### Bug 2: `smSafeLateralMove` uses RELATIVE Z lift → soft limit alarm
- **File:** `src/js/top-probe.js` line ~209
- **Problem:** `smSafeLateralMove` does `G91 G1 Z+clearanceZ` — a **relative** lift. The outline code passed `safeTravelZ=10` as the clearanceZ param, meaning it lifts +10mm from current position which can exceed soft limits.
- **Symptom:** `ERROR: Machine in alarm state` immediately on "Surface Probe" button press.
- **Log evidence:**
  ```
  [10:16:01.243] Phase 1: Surface Reference Probe
  [10:16:01.252] TRAVEL: moving to center X=100.000 Y=89.000 at F800
  [10:16:01.404] ERROR: Machine in alarm state
  ```
- **Fix:** Do NOT use `smSafeLateralMove` for outline operations. Write `_outlineAbsTravel()` using **absolute G90** moves only. Retract Z to safeTravelZ (absolute), then move X, then move Y — never relative lifts.

### Bug 3: `_outlineMoveToZ` timeout only 5 seconds
- **File:** `src/js/outline-probe.js` line 75
- **Problem:** `waitForIdleWithTimeout(5000)` — if the Z move takes longer than 5s, it times out and the next command fires while machine is still moving → alarm.
- **Fix:** All `waitForIdleWithTimeout()` calls set to 30000ms minimum.

### Bug 4: Log lost on E-stop
- **Problem:** When user E-stops and closes plugin, the outline log is gone. No way to diagnose what happened.
- **Fix:** Auto-save log to `localStorage` on every `outlineAppendLog()` call. Added "Recover Last Log" button that loads from localStorage.

### Bug 5: Duplicate log lines
- **Problem:** `runOutlineSurfaceProbe` logs "LOWER: Z to clearZ=..." then `_outlineMoveToZ` logs "LOWER: Z to ..." — same move logged twice (1ms apart).
- **Log evidence:**
  ````
  [10:19:36.144] LOWER: Z to clearZ=5.000 at F600
  [10:19:36.145] LOWER: Z to 5.000 at F600
  ````
- **Fix:** Remove the outer log line, let `_outlineMoveToZ` handle logging.

### Bug 6: Phase 1 blind G1 descent — probe keeps pushing through contact
- **File:** `src/js/outline-probe.js` line 155
- **Problem:** `_outlineMoveToZ(cfg.clearZ, cfg.retractFeed)` uses `G90 G1 Z5.000` — a blind move. G1 does NOT stop when probe pin triggers. Only G38.x commands stop on contact. When probe touches wood, it keeps pushing.
- **Symptom:** Log shows `PROBE PIN STATE: triggered=true` immediately after `LOWER: Z to 5.000`. User had to E-stop.
- **Log evidence:**
  ```
  [10:37:29.227] LOWER: Z to 5.000 at F600
  [10:37:30.782] PROBE PIN STATE: triggered=true before surface probe plunge
  [10:37:30.783] WARN: probe pin already triggered before plunge
  [10:37:31.085] Stop requested.
  ```
- **Root cause comparison:** The Probe tab (top-probe.js) NEVER moves Z downward with G1. It only uses G38.2 (smPlungeProbe) for downward probing. The outline code added `_outlineMoveToZ` which does blind G1 moves.
- **Fix:** Rewrite Phase 1 to reuse the same sm* functions as the Probe tab: `smSafeLateralMove` → `smPlungeProbe` → `smRetractToZ`. No custom motion functions needed for surface probing.

### Bug 8: smSafeLateralMove hits soft limit ceiling after moveMachineZAbs(0)
- **Problem:** After retracting to machine Z=0, `smSafeLateralMove` does a relative Z lift (`G91 G1 Z+clearanceZ`). Since Z is already at the absolute ceiling, this hits the soft limit → alarm.
- **Also:** `cfg.probeDown` (default 5mm) is far too short when starting from machine Z=0 which could be 50-100mm above the wood surface.
- **Fix:** Use `moveAbs(cx, null, null, feed)` for lateral travel after `moveMachineZAbs(0)` — no Z lift needed since we're at the ceiling. Use `getWorkPosition().z + 5` as probe distance to cover full range.
- **Rule:** After `moveMachineZAbs(0)`, NEVER use functions that do relative Z lifts. Use `moveAbs` for lateral moves instead.

### Bug 7: Phase 1 lateral travel may clip wood when Z zero is below surface
- **Problem:** Phase 1's purpose is to find the surface Z, so it's unknown at this point. If the user sets work Z zero on the spoilboard (below the wood), `safeTravelZ` and `clearZ` are in work coordinates relative to spoilboard, NOT the wood top.
- **Example:** Z zero on spoilboard, wood at Z=9.8, safeTravelZ=10 → only 0.2mm clearance during lateral travel to grid center.
- **Fix:** Add `moveMachineZAbs(0, feed)` as the first action in Phase 1, before any lateral move. Machine Z=0 is always the top of travel (after homing), guaranteeing full clearance regardless of work Z zero placement.
- **Rule:** When surface Z is unknown, always use machine coordinates (G53) for Z clearance, not work coordinates.

### Bug 9: `safeTravelZ` used as absolute Z instead of surface-relative offset — probe drags between rows
- **File:** `src/js/outline-probe.js` — `_runRowScan()`, `_runColScan()`, `runOutlineScan()`, `runOutline360FaceProbe()`
- **Problem:** `cfg.safeTravelZ` is the raw UI value (e.g. `10`), used directly as an **absolute Z coordinate**. With `surfaceZ ≈ 9.637`, this means the probe travels at Z=10.0 — only **0.363mm above the wood**.
- **Symptom:** User had to E-stop multiple times as probe dragged across wood surface during inter-row travel. Logs showed:
  ```
  Row Y=50.000 complete. Left=29.502 Right=163.502
  TRAVEL: current pos X=163.502 Y=50.000 Z=6.637   ← still at faceZ!
  RETRACT: Z to safeTravelZ=10.000 at F8000          ← only 0.36mm above surface!
  TRAVEL: diagonal to X=-10.000 Y=75.000 at F1000    ← drags probe across wood
  ```
- **Log files:**
  - `outline_log_2026-04-18_12-22-00.txt` — First run, probe depth=5mm, no surface contact on surface steps
  - `outline_log_2026-04-18_12-48-42.txt` — Second run, probe depth=10mm, surface steps work but Z too low between rows
  - `outline_log_2026-04-18_13-08-40.txt` — Bug 9: diagonal moves fixed but still dragging between rows
  - `outline_log_2026-04-18_13-34-20.txt` — Bug 9: stopped before probe damage, same Z issue
  - `outline_log_2026-04-18_13-51-16.txt` — fastFeed increased to 2000, same Z issue
- **Fix (PR #226):** Compute `safeTravelZ` as surface-relative in all 4 scan functions:
  ```javascript
  var safeTravelZ = surfZ + cfg.safeTravelZ;  // e.g. 9.637 + 10 = 19.637
  ```
  Applied to:
  - `_runRowScan()` — inter-row approach, `_probeHorizEdge` retract, no-edges retract, reverse probe approach, post-right-edge retract, return home
  - `_runColScan()` — same pattern for column scanning
  - `runOutlineScan()` — `smEnsureProbeClear` and final return home
  - `runOutline360FaceProbe()` — all `_outlineAbsTravel`, `smEnsureProbeClear`, and `smRetractToZ` calls
  - Intra-row step hops (overshoot, surface steps) keep `clearZ` since short lateral moves need less clearance
- **Additional fix in PR #226:** "No edges found" retract replaced `smRetractToZ()` with explicit `sendCommand('G90 G1 Z...')` + `sleep(50)` + `waitForIdleWithTimeout(30000)` to guarantee the retract completes.
- **PRs:** #225 and #226 both address this — **#226 is preferred** (explicit G-code retract for no-edges case, source-only change)

### Bug 10: `_outlineAbsTravel` made separate X then Y moves instead of diagonal
- **File:** `src/js/outline-probe.js` — `_outlineAbsTravel()` function
- **Problem:** Travel between rows used separate `moveAbs(x, null, ...)` then `moveAbs(null, y, ...)` commands — doubling travel time and moving along the surface edge unnecessarily.
- **Fix:** Changed to single diagonal `moveAbs(x, y, null, feed)` command for simultaneous X+Y travel.
- **PR:** #224

### Bug 11: `config.html` not rebuilt after PR #226 merge — plugin still running old code
- **File:** `config.html` (generated file) / `build.sh`
- **Problem:** PR #226 fixed `safeTravelZ` computation in `src/js/outline-probe.js`, but `config.html` was never regenerated via `bash build.sh`. The plugin runs from `config.html`, not the source files.
- **Symptom:** Log confirmed `safeTravelZ=10.000` (raw UI value) instead of `19.637` (surfZ + cfg.safeTravelZ):
  ```
  X-axis scan: surfZ=9.637 faceZ=6.637 clearZ=14.637 safeTravelZ=10.000 rows=9
  ```
- **Log file:** `outline_log_2026-04-18_14-21-49.txt` — confirmed safeTravelZ still showing raw UI value (10.000) instead of computed value (19.637) after PR #226 merge.
- **Fix:** Run `bash build.sh` from the repository root to rebuild `config.html` from all source partials in `src/`. After rebuild, `config.html` now contains `var safeTravelZ = surfZ + cfg.safeTravelZ`.
- **Rule added:** After any source file change in `src/`, always run `bash build.sh` before testing. The plugin only reads `config.html`.
- **Multiple Copilot coding agent attempts to create rebuild PR failed** — agent cannot run `build.sh` in its sandbox. Must be done locally.

### Bug 12: SVG outline polygon only connects left/right edges — top and bottom are straight lines
- **File:** `src/js/outline-probe.js` — `exportOutlineSVG()` function (lines ~891-932)
- **Problem:** The closed outline polygon (blue dashed line in SVG) only used **row results** (left/right X edges from Phase 2). It traced left edge going up in Y, right edge going down in Y, then closed with straight `Z` lines — creating straight lines across the top and bottom instead of following the actual scanned contour from column results (Phase 3).
- **Root cause (lines 891-901 original code):**
  ```javascript
  // Old code — only left+right edges
  var polyPts = leftPts.map(function(r){ return [r.xLeft, r.y]; });
  var revRight = rightPts.slice().reverse();
  revRight.forEach(function(r){ polyPts.push([r.xRight, r.y]); });
  // Z close → straight line across top and bottom
  ```
  Column results (`yBottom`, `yTop`) were only drawn as individual dots, never incorporated into the closed polygon.
- **Visual evidence:** Top and bottom of outline were straight dashed lines while left and right followed the wood contour correctly.
- **Status:** IDENTIFIED, FIX IN PROGRESS

### Bug 12 Fix Attempts:

#### Attempt 1: 4-segment polygon (bottom → right → top → left)
- **Approach:** Build polygon using all 4 edge sets in order: bottom edge left→right, right edge bottom→top, top edge right→left, left edge top→bottom.
- **Result:** FAILED — corners don't connect properly. Bottom/top edge polylines from column results and left/right edge polylines from row results meet at different coordinates, creating zigzag crossovers at all 4 corners.
- **PR created by coding agent** targeting main.

#### Attempt 2: `atan2` angular sort from centroid
- **Approach:** Collect ALL edge points (left, right, bottom, top) into one array, compute centroid, sort by `Math.atan2(y - centerY, x - centerX)`, draw single closed polygon.
- **Code (currently on main, lines 914-932):**
  ```javascript
  var allEdgePts = [];
  leftPts.forEach(function(r)   { allEdgePts.push([r.xLeft,  r.y]);       });
  rightPts.forEach(function(r)  { allEdgePts.push([r.xRight, r.y]);       });
  bottomPts.forEach(function(c) { allEdgePts.push([c.x,      c.yBottom]); });
  topPts.forEach(function(c)    { allEdgePts.push([c.x,      c.yTop]);    });
  // ... centroid calculation, atan2 sort, draw polygon
  ```
- **Result:** PARTIALLY WORKS — connects most points but still has zigzag crossovers at corners where points from different edges have similar angles from the centroid. The angular sort miorders nearby points.

#### Attempt 3: Convex hull (Graham scan)
- **Approach:** Replace `atan2` sort with a proper convex hull algorithm. Convex hull by definition traces the outermost perimeter with no crossovers.
- **Result:** ATTEMPTED — Copilot coding agent PR was created but **agent session crashed** before completing. Need to retry or implement locally.
- **Potential issue with convex hull:** A live edge slab may have **concave** sections (e.g. a waist or notch in the wood). Convex hull would skip those indentations and draw a straight line across them. For most slabs this is fine, but for heavily curved pieces it could miss detail.

#### Next approach to try: Ordered perimeter walk
- **Concept:** Instead of sorting all points together, walk the perimeter in order using the known structure of the data:
  1. Start at bottom-left corner (leftmost bottom point or bottommost left point)
  2. Walk bottom edge left→right (column results sorted by X)
  3. At bottom-right corner, transition to right edge
  4. Walk right edge bottom→top (row results sorted by Y)
  5. At top-right corner, transition to top edge
  6. Walk top edge right→left (column results sorted by X descending)
  7. At top-left corner, transition to left edge
  8. Walk left edge top→bottom (row results sorted by Y descending)
  9. Close polygon
- **Key difference from Attempt 1:** At each corner, pick the point from the next edge that is CLOSEST to the last point of the current edge, avoiding the zigzag crossover problem.
- **Status:** NOT YET IMPLEMENTED

---

## How the Outline Scan Should Work

### Phase 1: Surface Reference Probe
1. User clicks "▼ Surface Probe" button
2. Probe travels to **center of outline grid bounds** (calculated from X Origin, X Length, Y Origin, Y Length)
3. `outlineSurfaceZ` is populated in the UI field — user can also **manually type a value** to skip probing
4. Probe returns to X0 Y0

### Phase 2: X-Axis Edge Scan (row by row, stepping in Y)
For each row at Y = Y0, Y0+yStep, Y0+2*yStep... up to Y0+yLen:
1. Start at X origin minus approach distance, Z at **surface Z minus "Face Probe Depth Below Surface"** (user-set field)
2. Probe **+X** horizontally (G38.2) — looking for the left face/edge of the wood
3. On trigger → record X contact point as **left edge**
4. Back off from trigger
5. Retract Z above surface by **"Retract Above Surface"** amount
6. Move **+X** past the trigger point by **"Overshoot Past Trigger"** distance (default 2mm, user-configurable)
7. Now on top of the wood — step across in X, plunging Z at each X step, until Z probe does **NOT trigger** (meaning past the right edge, no more wood)
8. Once no-trigger confirmed (2 consecutive misses), reverse probe **-X** (G38.2) to find exact right edge
9. On trigger → record X contact point as **right edge**
10. Retract, move to next row
11. Return to X0 Y0 after all rows done

### Phase 3: Y-Axis Edge Scan (column by column, stepping in X)
Identical to Phase 2 but rotated 90° — probing along Y for bottom/top edges at each X column.

### Phase 4: Build Grid + 360 Face Probe
- Compile all edge points into a grid
- Use that grid to run the 360 face probe at each known edge location

---

## UI Fields Added to Outline Tab

| Field ID | Label | Default | Purpose |
|---|---|---|---|
| `outlineSurfaceZ` | Surface Z (coords) | (empty) | Read/write — auto-filled by probe OR manual entry |
| `outlineFaceDepth` | Face Probe Depth Below Surface | 3 | Z depth for horizontal edge probing |
| `outlineFaceFeed` | Face Probe Feed (mm/min) | 200 | Feed for horizontal G38.2 |
| `outlineRetractAbove` | Retract Above Surface | 2 | Z retract after face contact |
| `outlineOvershoot` | Overshoot Past Trigger | 2 | Distance past trigger onto wood |
| `outlineApproachDist` | Approach Distance | 10 | How far outside edge to start |
| `outlineSafeTravelZ` | Safe Travel Z | 10 | **Relative** — added to surfaceZ for safe travel height |
| `outlineZStepDepth` | Z Step Probe Depth | 5 | Plunge depth when scanning surface |
| `outlineProbeFeed` | Surface Probe Feed | 200 | Feed for Z plunge probes |
| `outlineFastFeed` | Fast Feed / Travel | 800 | Feed for travel moves |
| `outlineRetractFeed` | Retract Feed | 600 | Feed for Z retract |
| `outlineClearZ` | Clear Z | 5 | Clearance above surface |
| `outlineProbeDown` | Probe Down | 5 | Max plunge depth |

Plus:
- **Probe Center (auto)** — read-only field showing calculated center, updates live as grid fields change
- **Recover Last Log** button for crash recovery

---

## Key Architecture Decisions

1. **No `smPlungeProbe` or `smSafeLateralMove` for outline operations** — these functions read from the Surface Probe tab's DOM fields, not the Outline tab's. All outline moves use direct G-code with outline-specific parameters.

2. **All Z moves are absolute (G90)** — never relative G91 lifts that could exceed soft limits.

3. **Face-first scanning** — probes horizontally into the edge face first (not Z-down to find edges), then steps across the top surface to find the far edge.

4. **Log everything** — every travel, probe, retract, trigger state, row summary, and timing is logged for diagnostics. Logs persist to localStorage for crash recovery.

5. **`safeTravelZ` is ALWAYS computed as `surfZ + cfg.safeTravelZ`** — never use `cfg.safeTravelZ` directly as a Z coordinate. The UI value is an offset above surface, not an absolute position.

6. **Diagonal travel between rows/cols** — use single `moveAbs(x, y, null, feed)` for simultaneous X+Y movement instead of separate axis moves. (Bug 10 fix)

7. **Surface Z field auto-populated** — `_outlineSetSurfaceZField(z)` writes to `#outlineSurfaceZ` after Phase 1 surface probe completes. User can also manually enter a value to skip probing.

---

## RULE: Update this dev log with every fix/change

**From 2026-04-18 onward:** Every bug fix, feature change, or architectural decision affecting the outline tab MUST be documented here before or alongside the code PR. Include:
- Bug number (sequential)
- File(s) affected
- Problem description with log evidence where available
- Fix applied
- PR number

---

## RULE: Back up full conversation context to this dev log

**From 2026-04-18 onward:** When working on multi-step debugging sessions, update this dev log with the full context of what was discussed, what was tried, what failed, and what the next steps are. This ensures that if the browser is closed or the chat is lost, a new Copilot session can read this file and pick up exactly where we left off.

---

## Related PRs
- PR #211 — Initial Outline tab (merged, had bugs above)
- PR #224 — Diagonal travel moves for `_outlineAbsTravel`
- PR #225 — safeTravelZ surface-relative fix (superseded by #226)
- PR #226 — safeTravelZ surface-relative fix + explicit G-code retract for no-edges case (preferred)
- Subsequent PR — Full rewrite with all fixes and UI fields (this session)
- Multiple failed Copilot agent PRs — config.html rebuild attempts (agent can't run build.sh)
- Copilot agent PR — Bug 12 Attempt 1 (4-segment polygon, merged but had corner issues)
- Copilot agent PR — Bug 12 Attempt 2 (atan2 sort, currently on main, has zigzag issues)
- Copilot agent PR — Bug 12 Attempt 3 (convex hull, agent crashed before completing)

---

## Log Files Referenced
- `outline_log_2026-04-18_08-51-25.txt` — First alarm (smSafeLateralMove relative lift)
- `outline_log_2026-04-18_10-16-22.txt` — Second alarm (same root cause, before fix)
- `outline_log_2026-04-18_10-20-08.txt` — Successful surface probe after lowering Z manually
- `outline_log_2026-04-18_10-37-39.txt` — Bug 6: blind G1 descent triggered probe, user E-stopped
- `outline_log_2026-04-18_12-22-00.txt` — Bug 9: first outline scan, safeTravelZ too low, no surface contact
- `outline_log_2026-04-18_12-48-42.txt` — Bug 9: second run, probe depth=10mm, surface steps work but Z too low between rows
- `outline_log_2026-04-18_13-08-40.txt` — Bug 9: diagonal moves fixed but still dragging between rows
- `outline_log_2026-04-18_13-34-20.txt` — Bug 9: stopped before probe damage, same Z issue
- `outline_log_2026-04-18_13-51-16.txt` — fastFeed increased to 2000, same Z issue
- `outline_log_2026-04-18_14-21-49.txt` — Bug 11: confirmed safeTravelZ still showing raw UI value (10.000) instead of computed value (19.637) after PR #226 merge;
  config.html had not been rebuilt

---

## Current State (end of session 2026-04-18)

### What's working:
- Phase 1 surface probe — auto-populates Surface Z field
- Phase 2 X-axis row scan — finds left/right edges correctly
- Phase 3 Y-axis column scan — finds bottom/top edges correctly
- Phase 4 360 face probe — probes all edges from outline data
- SVG export — exports all edge points with colored polylines (green=left, orange=right, blue=bottom, red=top)
- JSON export — exports raw scan data
- Log recovery from localStorage

### What's broken / in progress:
1. **Bug 12: SVG closed polygon** — the blue dashed outline polygon does not cleanly connect all probe points. Three approaches tried (4-segment, atan2 sort, convex hull), none fully working. Next approach: ordered perimeter walk with closest-point corner transitions.
2. **config.html rebuild** — Copilot agent cannot run `build.sh`. User must rebuild locally after any source change. Current `config.html` may or may not have latest source changes bundled.
3. **`drawOutlineCanvas()` in `visualization.js`** — may have the same polygon issue as the SVG export. Needs to be checked and fixed alongside Bug 12.
