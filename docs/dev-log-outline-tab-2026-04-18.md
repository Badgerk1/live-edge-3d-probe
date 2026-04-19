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
- **Fix:** Do NOT use `smSafeLateralMove` for outline operations. Write `_outlineAbsTravel()` using **absolute G90** moves only. Retract Z to safeTravelZ (absolute), then move X, then move Y — no relative lifts.

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
  ```
  [10:19:36.144] LOWER: Z to clearZ=5.000 at F600
  [10:19:36.145] LOWER: Z to 5.000 at F600
  ```
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
- **Root cause comparison:** The Probe tab (top-probe.js) NEVER moves Z downward with G1. It only uses G38.2 (smPlungeProbe) for downward probing. The outline code added `_outlineMoveToZ` which does blind G1 descent.
- **Fix:** Rewrite Phase 1 to reuse the same sm* functions as the Probe tab: `smSafeLateralMove` → `smPlungeProbe` → `smRetractToZ`. No custom motion functions needed for surface probing.

### Bug 8: smSafeLateralMove hits soft limit ceiling after moveMachineZAbs(0)
- **Problem:** After retracting to machine Z=0, `smSafeLateralMove` does a relative Z lift (`G91 G1 Z+clearanceZ`). Since Z is already at the absolute ceiling, this hits the soft limit → alarm.
- **Also:** `cfg.probeDown` (default 5mm) is far too short when starting from machine Z=0 which could be 50-100mm above the wood surface.
- **Fix:** Use `moveAbs(cx, null, null, feed)` for lateral travel after `moveMachineZAbs(0)` — no Z lift needed since we're at the ceiling. Use `getWorkPosition().z + 5` as probe distance to cover full range.
- **Rule:** After `moveMachineZAbs(0)`, NEVER use functions that do relative Z lifts. Use `moveAbs` for lateral moves instead.

### Bug 7: Phase 1 lateral travel may clip wood when Z zero is below surface
- **Problem:** Phase 1's purpose is to find the surface Z, so it's unknown at this point. If the user sets work Z zero on the spoilboard (below the wood), `safeTravelZ` and `clearZ` are in work coordinates and may be below/at the wood surface.
- **Example:** Z zero on spoilboard, wood at Z=9.8, safeTravelZ=10 → only 0.2mm clearance during lateral travel to grid center.
- **Fix:** Add `moveMachineZAbs(0, feed)` as the first action in Phase 1, before any lateral move. Machine Z=0 is always the top of travel (after homing), guaranteeing full clearance regardless of work coordinate origin.
- **Rule:** When surface Z is unknown, always use machine coordinates (G53) for Z clearance, not work coordinates.

### Bug 9: `safeTravelZ` used as absolute Z instead of surface-relative offset — probe drags between rows
- **File:** `src/js/outline-probe.js` — `_runRowScan()`, `_runColScan()`, `runOutlineScan()`, `runOutline360FaceProbe()`
- **Problem:** `cfg.safeTravelZ` is the raw UI value (e.g. `10`), used directly as an **absolute Z coordinate**. With `surfaceZ ≈ 9.637`, this means the probe travels at Z=10.0 — only **0.363mm** above the wood surface.
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
- **Additional fix in PR #226:** "No edges found" retract replaced `smRetractToZ()` with explicit `sendCommand('G90 G1 Z...')` + `sleep(50)` + `waitForIdleWithTimeout(30000)` to guarantee the retract completes before next move.
- **PRs:** #225 and #226 both address this — **#226 is preferred** (explicit G-code retract for no-edges case, source-only change)

### Bug 11: `config.html` not rebuilt after PR #226 merge — plugin still running old code
- **File:** `config.html` (generated file) / `build.sh`
- **Problem:** PR #226 fixed `safeTravelZ` computation in `src/js/outline-probe.js`, but `config.html` was never regenerated via `bash build.sh`. The plugin runs from `config.html`, not the source files directly.
- **Symptom:** Log confirmed `safeTravelZ=10.000` (raw UI value) instead of `19.637` (surfZ + cfg.safeTravelZ):
  ```
  X-axis scan: surfZ=9.637 faceZ=6.637 clearZ=14.637 safeTravelZ=10.000 rows=9
  ```
- **Log file:** `outline_log_2026-04-18_14-21-49.txt` — confirmed safeTravelZ still showing raw UI value (10.000) instead of computed value (19.637) after PR #226 merge.
- **Fix:** Run `bash build.sh` from the repository root to rebuild `config.html` from all source partials in `src/`. After rebuild, `config.html` now contains `var safeTravelZ = surfZ + cfg.safeTravelZ;`.
- **Rule added:** After any source file change in `src/`, always run `bash build.sh` before testing. The plugin only reads `config.html`.

### Bug 10: `_outlineAbsTravel` made separate X then Y moves instead of diagonal
- **File:** `src/js/outline-probe.js` — `_outlineAbsTravel()` function
- **Problem:** Travel between rows used separate `moveAbs(x, null, ...)` then `moveAbs(null, y, ...)` commands — doubling travel time and moving along the surface edge unnecessarily.
- **Fix:** Changed to single diagonal `moveAbs(x, y, null, feed)` command for simultaneous X+Y travel.
- **PR:** #224

### Bug 12: SVG/Canvas closed polygon doesn't follow actual slab contour
- **File:** `src/js/outline-probe.js` — `exportOutlineSVG()` function; `src/js/visualization.js` — `_vizDrawOutlineCanvas()` function
- **Problem:** The closed outline polygon (blue dashed line) connecting all probe points did not cleanly follow the slab contour. Multiple approaches were tried:
  1. **4-segment approach** — traced left→top→right→bottom separately, but straight lines at corners didn't connect properly
  2. **atan2 angular sort** — sorted all points by angle around centroid, caused zigzag crossovers between nearby points
  3. **Convex hull (Graham scan)** — lost all concave features of the live edge slab (wood slabs are inherently concave/irregular)
  4. **Ordered perimeter walk** — attempted clockwise walk with closest-point corner transitions, still produced crossing lines
- **Symptom:** Overlapping colored polylines (green/orange/blue/red for 4 edges) plus a dashed polygon created a confusing mess of crossing lines. User screenshot confirmed the polygon was unusable.
- **Fix (PR #234):** Replaced the entire visualization approach:
  - **Removed:** All 4 separate colored edge polylines (left=green, right=orange, bottom=blue, top=red) and the dashed perimeter polygon
  - **Replaced with:** Single solid **black** closed polyline connecting ALL edge points via clockwise angular sort:
    1. Collect all edge points from `outlineRowResults` (xLeft, xRight) and `outlineColResults` (yBottom, yTop) into single `[x, y]` array
    2. Deduplicate points within 0.1mm
    3. Compute centroid of all points; find bottom-left point (min Y, then min X) as start
    4. Sort by `atan2(y − centroidY, x − centroidX)` descending (clockwise), normalized to start angle
    5. Draw closed polyline + small black dot at each point
  - **SVG:** `stroke="#000000"`, `stroke-width="0.8"`, path closed with `Z`; black `<circle r="0.6">` at each point
  - **Canvas:** Legend simplified to single "Outline" entry in black; search boundary dashed rectangle preserved
  - `convexHull()` function left intact in codebase (may be used elsewhere) but no longer used for outline polygon
- **Files changed:** `src/js/outline-probe.js` (+55 −104 lines), `src/js/visualization.js` (+60 −104 lines)
- **PR:** #234 (merged to `main` 2026-04-19)
- **Note:** After merge, user must run `bash build.sh` to rebuild `config.html`.

### Bug 13 / Feature: Catmull-Rom spline smoothing for outline (PR #236)
- **Files:** `src/js/outline-probe.js` (SVG export), `src/js/visualization.js` (canvas preview)
- **Problem:** Outline probe points were connected with straight-line segments (`L` in SVG, `lineTo` on canvas), producing a jagged polygon that didn't represent the natural wood slab contour.
- **Fix:** Replaced straight segments with Catmull-Rom → cubic Bézier curves. For each segment P[i]→P[i+1] on the closed polygon, control points are computed as:
  - CP1 = P[i] + (P[i+1] − P[i−1]) / 6
  - CP2 = P[i+1] − (P[i+2] − P[i]) / 6
- SVG uses `C` (cubic Bézier) commands; canvas uses `bezierCurveTo()`
- Removed `<circle>` marker elements from SVG so Aspire v12 imports one clean `<path>`
- **PR:** #236 (merged 2026-04-19)
- **Files changed:** `src/js/outline-probe.js`, `src/js/visualization.js`, `config.html` (+62 −22)

### Bug 14: Catmull-Rom spline still shows visible kinks at probe points (follow-up to PR #236)
- **Files:** `src/js/outline-probe.js` (SVG export), `src/js/visualization.js` (canvas preview)
- **Problem:** PR #236 added subdivision (12 steps per segment) but still produced visible kinks/corners at probe point locations. Root cause: **uniform Catmull-Rom** assumes equally-spaced control points. When probe points are non-uniformly spaced (e.g. corner vs. edge points of a live-edge slab vary widely in arc-length), the tangent vectors at each point are dominated by the longer neighbouring chord, bending the curve sharply at that point rather than passing through smoothly.
- **Image evidence:** Screenshot after PR #236 shows ~8–12 sharp kinks at probe positions even with 12 subdivisions per segment. Kinks match exactly the locations of probe contact dots.
- **Root cause comparison:** `visualization.js` already has `_chordHermite()` (chord-length-parameterised Hermite) for the surface mesh for exactly this reason — uniform splines on non-uniform grids produce creases. The outline code was using the simpler uniform CR formula.
- **Fix:** Replaced the uniform Catmull-Rom `crPoint` function in both `outline-probe.js` and `visualization.js` with **centripetal Catmull-Rom (alpha=0.5)** using the Barry-Goldman algorithm:
  1. Compute knot intervals as `(chord_length)^0.5` between each pair of consecutive control points
  2. Map the local parameter `t ∈ [0,1]` to the actual knot span `[t1, t2]` (the current segment)
  3. Apply three levels of linear interpolation (Barry-Goldman pyramid) using the remapped parameter
  - This guarantees the curve passes through each probe point with a C1-continuous tangent that is proportional to the local spacing — no cusps, no kinks regardless of how unevenly the probe points are distributed around the perimeter
- **SUBDIVISIONS** kept at 12 per segment (sufficient with centripetal CR)
- **PR:** #239 (merged 2026-04-19)

### Bug 15: Centripetal CR subdivision still shows subtle flat spots / chord faceting (PR #240)
- **Files:** `src/js/outline-probe.js` (SVG export), `src/js/visualization.js` (canvas preview)
- **Problem:** Even after centripetal CR (#239), the outline still showed subtle flat spots and kinks, especially at the top and bottom of wide oval shapes. Root cause: the curve was represented as a 12-segment polyline per probe interval — chord linearisation leaves visible faceting between widely-spaced control points regardless of spline parameterisation quality.
- **Fix:** Replaced `crPoint` + 12× `lineTo`/`L` loop with `crBezier`, which analytically derives the exact cubic Bézier control points from the centripetal CR tangent formula:
  ```js
  T1 = (p1-p0)/(t1-t0) - (p2-p0)/(t2-t0) + (p2-p1)/dt
  T2 = (p2-p1)/dt      - (p3-p1)/(t3-t1) + (p3-p2)/(t3-t2)
  cp1 = p1 + T1·dt/3
  cp2 = p2 - T2·dt/3
  ```
  A single `C cp1 cp2 p2` (SVG) / `bezierCurveTo(cp1, cp2, p2)` (canvas) per segment gives an exact cubic curve — no polyline approximation, no faceting.
- **PR:** #240 (merged 2026-04-19)

### Bug 16: Outline canvas preview invisible on dark background (PR #241)
- **Files:** `src/js/visualization.js` — `_vizDrawOutlineCanvas()`
- **Problem:** The outline spline, edge point dots, and legend swatch were all drawn in `#000000` (black), making them invisible against the dark plugin UI background.
- **Fix:** Changed all three from `#000000` to `#ffffff` (white).
- **PR:** #241 (merged 2026-04-19)

### Bug 17: Centroid-angle sort misordered outline points near top of wide ovals (PR #242)
- **Files:** `src/js/visualization.js`, `src/js/outline-probe.js`
- **Problem:** The `atan2`-based clockwise sort failed when row-scan edge points and column-scan edge points cluster at similar centroid angles — e.g. near the top of a wide oval, multiple points from different phases shared nearly identical angles and were placed adjacently in sort order despite being on opposite sides of the perimeter. This produced a visible flat or mis-ordered segment in the rendered outline.
- **Fix:** Replaced centroid-angle sort with a **greedy nearest-neighbour traversal**:
  1. Start from the bottom-left point (min Y, then min X as tiebreak)
  2. At each step, pick the physically closest unvisited point
  3. A signed-area (shoelace) check enforces clockwise winding
  This produces the correct perimeter order regardless of centroid geometry.
- **PR:** #242 (merged 2026-04-19)

### Feature: Compute absolute centre and add Set WCS Zero to Centre (PR #243)
- **Files:** `src/js/ui-helpers.js`, `src/js/outline-probe.js`
- **New capability:** After scanning, the plugin now computes and displays the bounding-box centre and overall dimensions of the scanned slab:
  ```
  Centre  X=142.500  Y=87.250   (Width=85.000  Height=62.500)
  ```
  rendered in the `#outline-centre-display` element inside the Results Summary panel.
- **Set WCS Zero to Centre button** — issues `G10 L20 P1 X<centreX> Y<centreY>` to zero the WCS at the detected slab centre. Button is hidden until scan data is present.
- **Implementation:** `_outlineUpdateResultsSummary()` (in `ui-helpers.js`) computes centre from all probed edge points (xLeft/xRight from rows + yBottom/yTop from columns). `setWCSToCentre()` (in `outline-probe.js`) recomputes the same centre and issues the G10 command.
- **PR:** #243 (merged 2026-04-19)

### Feature: Move to Centre jog button and Results Summary panel promotion (PR #244)
- **Files:** `src/js/outline-probe.js`, `src/js/ui-helpers.js`
- **New capability:** A **Move to Centre** button (`btn-outline-move-centre`) appears alongside the Set WCS Zero to Centre button after scanning. Clicking it:
  1. Computes bounding-box centre from current scan results
  2. Reads `safeTravelZ` and `fastFeed` from outline settings
  3. Delegates to `_outlineAbsTravel()` — Z-retract first, then XY move to centre
  4. Logs travel intent and final position; errors surface via `outlineSetStatus`/`outlineAppendLog`
- **Panel promotion:** The Results Summary panel was moved up in the Outline tab to appear immediately below the scan controls rather than below the preview and log panels, so centre/dimension data is visible right after a scan without scrolling.
- `_outlineUpdateResultsSummary()` now tracks `btn-outline-move-centre` alongside `btn-outline-set-wcs-centre` — both appear/hide together based on scan data presence.
- **PR:** #244 (merged 2026-04-19)

### Feature: Skip Surface Probe toggle (PR #245 + #246)
- **Files:** `src/config-body.html`, `src/js/outline-probe.js`, `config.html`
- **Problem:** The surface step-probe phase (repeated Z plunges across the workpiece top to locate the far edge) is slow and unnecessary for workpieces where the far edge position is predictable.
- **New capability:** A **Skip Surface Probe** checkbox (`id="outlineSkipSurfaceProbe"`) at the bottom of the Probe Parameters grid enables a faster scan path:
  - **OFF (default):** Normal behaviour — after finding the near edge the probe steps across the top surface probing Z to locate the far edge.
  - **ON:** After finding the near edge, the probe retracts to `safeTravelZ`, travels directly to the far end of the row/column, lowers, and back-probes to find the opposing edge. The Overshoot, Z Step Probe Depth, and Surface Probe Feed fields are unused in this mode.
- **Implementation:** `_outlineSettings()` gains a `gb()` boolean helper that reads the checkbox. `_runRowScan()` and `_runColScan()` branch on `skipSurfaceProbe` after finding the near edge.
- **Build note:** PR #246 rebuilt `config.html` after #245 because the build artifact was not regenerated at merge time.
- **PRs:** #245 (source), #246 (rebuild, merged 2026-04-19)

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

1. **No `smPlungeProbe` or `smSafeLateralMove` for outline operations** — these functions read from the Surface Probe tab's DOM fields, not the Outline tab's. All outline moves use direct G-code or outline-specific wrappers.

2. **All Z moves are absolute (G90)** — never relative G91 lifts that could exceed soft limits.

3. **Face-first scanning** — probes horizontally into the edge face first (not Z-down to find edges), then steps across the top surface to find the far edge.

4. **Log everything** — every travel, probe, retract, trigger state, row summary, and timing is logged for diagnostics. Logs persist to localStorage for crash recovery.

5. **`safeTravelZ` is ALWAYS computed as `surfZ + cfg.safeTravelZ`** — never use `cfg.safeTravelZ` directly as a Z coordinate. The UI value is an offset above surface, not an absolute position.

6. **Diagonal travel between rows/cols** — use single `moveAbs(x, y, null, feed)` for simultaneous X+Y movement instead of separate axis moves. (Bug 10 fix)

7. **Single white outline polygon using nearest-neighbour traversal** — all edge points (left, right, bottom, top) rendered as one smooth closed centripetal CR spline in white. Point ordering uses greedy nearest-neighbour traversal (starting bottom-left) with a signed-area clockwise check — not centroid-angle sort, which fails when points cluster at similar angles. (Bug 12 fix PR #234, colour fix PR #241, ordering fix PR #242)

8. **Exact cubic Bézier per segment** — centripetal Catmull-Rom tangents are converted analytically to a single cubic Bézier per segment (`crBezier`), not approximated as a polyline. This eliminates chord faceting regardless of control-point spacing. (PR #240)

---

## RULE: Always compare with Probe tab before writing outline motion code

Before writing ANY new motion code for the outline tab, check how the Probe tab (top-probe.js) and Face Probe tab (face-probe.js) handle the equivalent operation:
- Surface probing → see `runSurfaceProbing()` in top-probe.js
- Face probing → see `runFaceProbe()` in face-probe.js
- Combined mode → see combined-probe.js
- Travel moves → see `smSafeLateralMove()` in top-probe.js
- Z descent → see `smPlungeProbe()` (G38.2) and `moveAbs()` (G1 to known-safe Z)
- Retract → see `smRetractToZ()`, `smRetractUp()`, `smRetractSmall()`

Key rules learned:
1. **Downward Z to unknown surface** → G38.2 only (smPlungeProbe). NEVER G1.
2. **Downward Z to known-safe depth** → G1/moveAbs is OK (face probe does this)
3. **Lateral travel** → G38.3 (smSafeLateralMove) with contact recovery
4. **Upward retract** → G1 (smRetractToZ, smRetractUp) — always safe
5. **Reuse sm* functions** — don't reinvent motion primitives
6. **safeTravelZ must be surfZ + cfg.safeTravelZ** — never raw UI value as absolute Z

---

## RULE: Update this dev log with every fix/change

**From 2026-04-18 onward:** Every bug fix, feature change, or architectural decision affecting the outline tab MUST be documented here before or alongside the code PR. Include:
- Bug number (sequential)
- File(s) affected
- Problem description with log evidence where available
- Fix applied
- PR number

---

## Related PRs
- PR #211 — Initial Outline tab (merged, had bugs above)
- PR #224 — Diagonal travel moves for `_outlineAbsTravel`
- PR #225 — safeTravelZ surface-relative fix (superseded by #226)
- PR #226 — safeTravelZ surface-relative fix + explicit G-code retract for no-edges case (preferred)
- PR #234 — Bug 12: Replace outline visualization with single black clockwise polyline (removed colored edges + convex hull, merged 2026-04-19)
- PR #236 — Catmull-Rom spline smoothing for outline SVG export and canvas preview (merged 2026-04-19)
- PR #TBD — Subdivided Catmull-Rom spline refinement: eliminate kinks by evaluating 8–16 intermediate points per segment (in progress)
- Subsequent PR — Full rewrite with all fixes and UI fields (this session)

---

## What's working now:
1. **Phase 1** — Surface reference probe works reliably with machine-coordinate safety
2. **Phase 2** — X-axis row scanning finds left/right edges correctly
3. **Phase 3** — Y-axis column scanning finds bottom/top edges correctly
4. **Phase 4** — 360 face probe runs from outline edge grid
5. **SVG export** — Single smooth closed vector path using centripetal Catmull-Rom (alpha=0.5, Barry-Goldman, 12 subdivisions/segment); no stray `<circle>` elements; Aspire/VCarve compatible
6. **Canvas visualization** — Matches SVG: smooth centripetal Catmull-Rom spline; no kinks at probe points
7. **Log recovery** — localStorage auto-save + "Recover Last Log" button
8. **safeTravelZ** — Correctly computed as surfZ + offset in all scan functions

### What's broken / in progress:
1. **config.html rebuild** — Copilot agent CAN run `build.sh` (already done). After any future source change in `src/`, run `bash build.sh` before testing.

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
- `outline_log_2026-04-18_14-21-49.txt` — Bug 11: confirmed safeTravelZ still showing raw UI value (10.000) instead of computed value (19.637) after PR #226 merge.