# Outline Tab Development Log — 2026-04-18

## Session Summary
Working session between @Badgerk1 and Copilot to build and debug the Outline tab
for 360 edge detection and face probing on live edge wood slabs.

---

## Bugs Found & Fixed

### Bug 1: `smPlungeProbe` reads the WRONG clearance field
- **File:** `src/js/outline-probe.js` → called `smPlungeProbe()` from `top-probe.js`
- **Problem:** `smPlungeProbe` internally reads `sm-clearanceZ` (the Surface Probe tab's field), not the Outline tab's fields. If `sm-clearanceZ` is low/0, `smEnsureProbeClear()` lifts to a Z that's still on the surface, probe stays triggered, retries 3× lifting tiny amounts each time, then throws or fires the plunge while probe is still triggered → **machine alarm**.
- **Symptom:** User reported "probe keeps raising" and "machine alarm state" on surface probe.
- **Fix:** Do NOT use `smPlungeProbe` for outline operations. Use direct `G91 G38.2` plunge with `smEnsureProbeClear()` called with the **outline's own** `outlineSafeTravelZ` and `outlineClearZ` values.

### Bug 2: `smSafeLateralMove` uses RELATIVE Z lift → soft limit alarm
- **File:** `src/js/top-probe.js` line ~209
- **Problem:** `smSafeLateralMove` does `G91 G1 Z+clearanceZ` — a **relative** lift. The outline code passed `safeTravelZ=10` as the clearanceZ param, meaning it lifts +10mm from current position. If near top of travel, this exceeds soft limits → **instant alarm**.
- **Symptom:** `ERROR: Machine in alarm state` immediately on "Surface Probe" button press.
- **Log evidence:**
  ```
  [10:16:01.243] Phase 1: Surface Reference Probe
  [10:16:01.252] TRAVEL: moving to center X=100.000 Y=89.000 at F800
  [10:16:01.404] ERROR: Machine in alarm state
  ```
- **Fix:** Do NOT use `smSafeLateralMove` for outline operations. Write `_outlineAbsTravel()` using **absolute G90** moves only. Retract Z to safeTravelZ (absolute), then move X, then move Y — never exceeds soft limits.

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
- **Problem:** `_outlineMoveToZ(cfg.clearZ, cfg.retractFeed)` uses `G90 G1 Z5.000` — a blind move. G1 does NOT stop when probe pin triggers. Only G38.x commands stop on contact. When probe touched surface during descent, G1 kept pushing, nearly breaking stylus.
- **Symptom:** Log shows `PROBE PIN STATE: triggered=true` immediately after `LOWER: Z to 5.000`. User had to E-stop.
- **Log evidence:**
  ```
  [10:37:29.227] LOWER: Z to 5.000 at F600
  [10:37:30.782] PROBE PIN STATE: triggered=true before surface probe plunge
  [10:37:30.783] WARN: probe pin already triggered before plunge
  [10:37:31.085] Stop requested.
  ```
- **Root cause comparison:** The Probe tab (top-probe.js) NEVER moves Z downward with G1. It only uses G38.2 (smPlungeProbe) for downward probing. The outline code added `_outlineMoveToZ` which does blind G1.
- **Fix:** Rewrite Phase 1 to reuse the same sm* functions as the Probe tab: `smSafeLateralMove` → `smPlungeProbe` → `smRetractToZ`. No custom motion functions needed for surface probing.

### Bug 7: Phase 1 lateral travel may clip wood when Z zero is below surface
- **Problem:** Phase 1's purpose is to find the surface Z, so it's unknown at this point. If the user sets work Z zero on the spoilboard (below the wood), `safeTravelZ` and `clearZ` are in work coordinates relative to that zero — they may not clear the actual wood surface.
- **Example:** Z zero on spoilboard, wood at Z=9.8, safeTravelZ=10 → only 0.2mm clearance during lateral travel to grid center.
- **Fix:** Add `moveMachineZAbs(0, feed)` as the first action in Phase 1, before any lateral move. Machine Z=0 is always the top of travel (after homing), guaranteeing full clearance regardless of work coordinate Z zero placement.
- **Rule:** When surface Z is unknown, always use machine coordinates (G53) for Z clearance, not work coordinates.

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
| `outlineSafeTravelZ` | Safe Travel Z | 10 | Absolute Z for safe travel |
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

1. **No `smPlungeProbe` or `smSafeLateralMove` for outline operations** — these functions read from the Surface Probe tab's DOM fields, not the Outline tab's. All outline moves use direct G-code commands with the outline's own settings.

2. **All Z moves are absolute (G90)** — never relative G91 lifts that could exceed soft limits.

3. **Face-first scanning** — probes horizontally into the edge face first (not Z-down to find edges), then steps across the top surface to find the far edge.

4. **Log everything** — every travel, probe, retract, trigger state, row summary, and timing is logged for diagnostics. Logs persist to localStorage for crash recovery.

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

---

## Related PRs
- PR #211 — Initial Outline tab (merged, had bugs above)
- Subsequent PR — Full rewrite with all fixes and UI fields (this session)

---

## Log Files Referenced
- `outline_log_2026-04-18_08-51-25.txt` — First alarm (smSafeLateralMove relative lift)
- `outline_log_2026-04-18_10-16-22.txt` — Second alarm (same root cause, before fix)
- `outline_log_2026-04-18_10-20-08.txt` — Successful surface probe after lowering Z manually
- `outline_log_2026-04-18_10-37-39.txt` — Bug 6: blind G1 descent triggered probe, user E-stopped