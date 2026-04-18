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
- **Problem:** `smSafeLateralMove` does `G91 G1 Z+clearanceZ` — a **relative** lift. The outline code passed `safeTravelZ=10` as the clearanceZ param, meaning it lifts +10mm from current position. If already near machine Z=0 ceiling, this exceeds soft limits → alarm.
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
- **Problem:** `_outlineMoveToZ(cfg.clearZ, cfg.retractFeed)` uses `G90 G1 Z5.000` — a blind move. G1 does NOT stop when probe pin triggers. Only G38.x commands stop on contact. When probe touches wood surface, G1 keeps driving down → user E-stops.
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
- **Fix:** Use `moveAbs(cx, null, null, feed)` for lateral travel after `moveMachineZAbs(0)` — no Z lift needed since we're at the ceiling. Use `getWorkPosition().z + 5` as probe distance to cover actual distance to surface.
- **Rule:** After `moveMachineZAbs(0)`, NEVER use functions that do relative Z lifts. Use `moveAbs` for lateral moves instead.

### Bug 7: Phase 1 lateral travel may clip wood when Z zero is below surface
- **Problem:** Phase 1's purpose is to find the surface Z, so it's unknown at this point. If the user sets work Z zero on the spoilboard (below the wood), `safeTravelZ` and `clearZ` are in work coordinates and may be inside the wood.
- **Example:** Z zero on spoilboard, wood at Z=9.8, safeTravelZ=10 → only 0.2mm clearance during lateral travel to grid center.
- **Fix:** Add `moveMachineZAbs(0, feed)` as the first action in Phase 1, before any lateral move. Machine Z=0 is always the top of travel (after homing), guaranteeing full clearance regardless of work Z zero position.
- **Rule:** When surface Z is unknown, always use machine coordinates (G53) for Z clearance, not work coordinates.

### Bug 9: `safeTravelZ` used as absolute Z instead of surface-relative offset — probe drags between rows
- **File:** `src/js/outline-probe.js` — `_runRowScan()`, `_runColScan()`, `runOutlineScan()`, `runOutline360FaceProbe()`
- **Problem:** `cfg.safeTravelZ` is the raw UI value (e.g. `10`), used directly as an **absolute Z coordinate**. With `surfaceZ ≈ 9.637`, this means the probe travels at Z=10.0 — only **0.363mm above the workpiece**. The probe drags across the surface between rows, risking probe damage. Meanwhile `clearZ` was correctly computed as `surfZ + cfg.retractAbove`.
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
- **Additional fix in PR #226:** "No edges found" retract replaced `smRetractToZ()` with explicit `sendCommand('G90 G1 Z...')` + `sleep(50)` + `waitForIdleWithTimeout(30000)` to guarantee the retract fires before next row approach (logs showed `smRetractToZ` may silently fail in this context)
- **PRs:** #225 and #226 both address this — **#226 is preferred** (explicit G-code retract for no-edges case, source-only change)

### Bug 10: `_outlineAbsTravel` made separate X then Y moves instead of diagonal
- **File:** `src/js/outline-probe.js` — `_outlineAbsTravel()` function
- **Problem:** Travel between rows used separate `moveAbs(x, null, ...)` then `moveAbs(null, y, ...)` commands — doubling travel time and moving along the surface edge unnecessarily.
- **Fix:** Changed to single diagonal `moveAbs(x, y, null, feed)` command for simultaneous X+Y travel.
- **PR:** #224

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

1. **No `smPlungeProbe` or `smSafeLateralMove` for outline operations** — these functions read from the Surface Probe tab's DOM fields, not the Outline tab's. All outline moves use direct G-code or `_outlineAbsTravel()`.

2. **All Z moves are absolute (G90)** — never relative G91 lifts that could exceed soft limits.

3. **Face-first scanning** — probes horizontally into the edge face first (not Z-down to find edges), then steps across the top surface to find the far edge.

4. **Log everything** — every travel, probe, retract, trigger state, row summary, and timing is logged for diagnostics. Logs persist to localStorage for crash recovery.

5. **`safeTravelZ` is ALWAYS computed as `surfZ + cfg.safeTravelZ`** — never use `cfg.safeTravelZ` directly as a Z coordinate. The UI value is an offset above surface, not an absolute position. (Bug 9 fix)

6. **Diagonal travel between rows/cols** — use single `moveAbs(x, y, null, feed)` for simultaneous X+Y movement instead of separate axis moves. (Bug 10 fix)

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
- Subsequent PR — Full rewrite with all fixes and UI fields (this session)

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