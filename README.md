# Live Edge 3D Probe – ncSender Plugin

A plugin for [ncSender](https://ncsender.com) that probes workpiece surfaces and faces, builds a 3D mesh from the measurements, and applies mesh-based Z-compensation to G-code toolpaths before sending them to the controller.

---

## Table of Contents

1. [Overview](#overview)
2. [Tabs and Workflow](#tabs-and-workflow)
3. [Surface Mesh](#surface-mesh)
4. [Face Probe](#face-probe)
5. [Apply Compensation](#apply-compensation)
6. [Send to ncSender – Coordinate Reference](#send-to-ncsender--coordinate-reference)
7. [Saved Location X/Y/Z](#saved-location-xyz)
8. [Setting Work Zero Before Sending](#setting-work-zero-before-sending)

---

## Overview

The plugin probes a grid of points on your workpiece, stores the Z (or Y for face probes) heights, and uses bilinear interpolation to compute mesh offsets for every move in a loaded G-code file. The compensated file is then sent to ncSender or downloaded for manual loading.

---

## Tabs and Workflow

| Tab | Purpose |
|-----|---------|
| **Setup** | Enter probe dimensions, feeds, clearance, and save/recall a reference position |
| **Surface Probe** | Run an automated grid probe of the top surface and view the resulting Z-height mesh |
| **Face Probe** | Run a layered probe of a vertical face and view the resulting depth mesh |
| **Apply** | Load a G-code file, apply the recorded mesh compensation, preview results, then download or send |

---

## Surface Mesh

- The plugin probes a rectangular grid of points defined by **X min/max**, **Y min/max**, **column count**, and **row count**.
- Each probe records the actual machine Z at that (X, Y) work-coordinate position.
- The resulting mesh is stored as a 2-D array indexed by `[row][column]`.
- **Mesh origin:** `(minX, minY)` in **work coordinates**. Column `c` corresponds to `X = minX + c × colSpacing`; row `r` to `Y = minY + r × rowSpacing`.

---

## Face Probe

- The face probe samples a vertical face wall in the X–Z plane (columns = X positions, rows = Z layers).
- Measured values represent the **Y depth** into the face at each (X, Z) sample point.
- The mesh is stored and interpolated the same way as the surface mesh.

---

## Apply Compensation

### Reference Z

The **Reference Z** field (default `0`) is the expected flat Z level of your surface in work coordinates. It represents the "baseline" against which mesh offsets are calculated:

```
offset = meshZ_at(X,Y) − referenceZ
newZ   = originalZ + offset
```

- If your work zero is the top surface and the surface is perfectly flat, `referenceZ = 0`.
- If the surface was probed with the origin at a known Z (e.g. `Z = 5.0`), set **Reference Z** to that value.

### What is modified

Only `G0`/`G1` moves that contain an explicit `Z` word are modified. The current X and Y of the tool are tracked across moves. If the (X, Y) position at a Z-move is **inside the probed grid bounds**, the Z value is offset by the interpolated mesh value; moves outside the bounds pass through unchanged.

### Apply Parameters (xStep, zStep, feedCut, feedTravel)

These four fields appear in the Apply tab above the compensation buttons and are saved to browser `localStorage` so they persist between sessions:

| Field | Description |
|-------|-------------|
| **xStep (mm)** | X-axis step size used when generating face toolpaths |
| **zStep (mm)** | Z-layer step size used when generating face toolpaths |
| **feedCut (mm/min)** | Feed rate for cutting moves |
| **feedTravel (mm/min)** | Feed rate for rapid/travel moves |

---

## Send to ncSender – Coordinate Reference

### Short answer

> **Send to ncSender sends the compensated G-code exactly as generated — in work coordinates — without applying any additional offsets or using the Saved Location values.**

### Detailed explanation

When you click **Send to ncSender**:

1. The plugin takes the in-memory compensated G-code string (`smCompensatedGcode` for surface, `faceCompensatedGcode` for face).
2. It **POSTs** that string directly to ncSender via `/api/gcode-files/load-temp` (or falls back to `/api/gcode-files` file upload).
3. ncSender loads the file into its workspace as the active program.
4. **No offsets are added.** The X, Y, and Z values in the sent file are exactly the work-coordinate values that the compensation step produced.

### Coordinate system used

All probe moves and all generated/compensated G-code use **absolute work coordinates (`G90`)**, i.e. the same coordinate system that is active on the controller at the time of probing and running (G54, G55, G56, … any of the standard work offsets). The plugin never issues a work-offset selection command itself — it assumes the controller's active work offset is already set correctly and remains unchanged between probing and running.

The G-code lines look like:

```gcode
G90 G1 X50.000 Y25.000 Z-1.602 F300
```

`X50, Y25` here are **real work-coordinate positions** matching where the mesh was probed, **not** positions relative to the probe start point.

### Does the data start point become X0/Y0?

**No.** The mesh origin is `(minX, minY)` from your grid setup — these are actual work-coordinate values (e.g. `X = 10.0, Y = 5.0`). The generated G-code references those real coordinates, so if you set your grid start to `X = 10`, all moves in the file will also contain `X = 10` (plus offsets along the grid). The start point is **not** re-zeroed to X0/Y0 in the sent file.

---

## Saved Location X/Y/Z

The **Saved Location** (stored in browser `localStorage` under the key `edgeProbeSavedLocation`) is a convenience feature in the **Setup** tab only:

| Button | What it does |
|--------|-------------|
| **Save Current Location** | Captures the current machine work position (X, Y, Z) and stores it |
| **Go to Saved Location** | Sends a `G90 G1 X… Y… Z…` move command to return the tool to the saved position |

**The Saved Location X/Y/Z values are NOT used when generating or sending G-code compensation.** They do not shift or offset the mesh data, and they are not written into the compensated G-code file that is sent to ncSender.

---

## Setting Work Zero Before Sending

Because all coordinates in the compensated file are in work coordinates, the controller's work zero (G54 or active offset) must match the coordinate frame used during probing.

### Recommended setup procedure

1. **Jog** the spindle to the corner of the workpiece you want to be `X0 Y0 Z0` (or whatever origin you intend to use).
2. **Zero all work axes** in ncSender (set G54 X=0, Y=0, Z=0, or use your preferred datum).
3. Open the plugin and configure the **Surface/Face grid** so that `minX` and `minY` match the expected work-coordinate positions of your probe start corner (e.g. `minX = 0, minY = 0` if you are probing from your work origin, or `minX = 10, minY = 5` if the grid starts 10 mm to the right and 5 mm up from your origin).
4. Run the probe cycle.
5. Load your G-code toolpath into the **Apply** tab, set **Reference Z** to the surface height you expect (usually `0`), and apply compensation.
6. Click **Send to ncSender** (or download and load the file manually).
7. **Do not re-zero or jog the axes between probing and running** — the compensated file assumes the same work zero that was active when you probed.

### Common pitfall

If the probed grid started at `X = 0, Y = 0` but the operator re-zeroed the machine between probing and running, the compensated toolpath will cut in the wrong position. Always verify that the work zero has not changed before running a compensated file.