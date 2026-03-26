# 3D Live Edge Mesh — Plugin Documentation

## Overview

This ncSender plugin probes a live-edge slab (top surface and/or vertical face) with a 3D touch probe, builds a mesh, and then applies that mesh as a compensation offset to G-code toolpaths so your cuts follow the natural contour of the wood.

---

## Coordinate System & Work Zero — How It Works

### How "Send to ncSender" uses coordinates

When you click **Send to ncSender**, the plugin sends the compensated G-code text directly to ncSender **without adding any G92/G10 offset commands or modifying the Work Coordinate System (WCS)**. The generated G-code header comments confirm this:

```
; COORDINATE SYSTEM: No G92/G10 offsets are applied. All coordinates are in your
;   active Work Coordinate System (WCS, e.g. G54). Probe and job must share the
;   same work zero. Saved Location X/Y/Z does not affect these coordinates.
```

This means:
- **X0/Y0/Z0 in the output G-code = whatever your machine's active WCS (e.g. G54) says at run time.**
- The plugin does **not** use Saved Location X/Y/Z as an origin offset.
- The plugin does **not** re-zero the machine before running.

### What "Saved Location X/Y/Z" does

The **Saved Location X/Y/Z** fields in the Setup tab are a **jog helper (movement assistant) only**:
- **Save Current Location** — records the current work position to browser storage.
- **Go To Saved Location** — jogs (moves) the machine back to that saved position.

Saved Location has **no effect** on any generated or compensated G-code. It does not shift coordinates and is not referenced during Apply or Send to ncSender.

### How the mesh origin works

The surface mesh origin is the **MinX/MinY corner of your probe grid** (set in the Probe tab → 2D Grid Configuration). All probe contact points are recorded in **work coordinates (WPos)** as reported by ncSender. The face mesh uses the same work coordinate space.

**Because probe data is recorded in work coordinates, the entire workflow must stay in the same WCS:**

### Operator checklist — set up correctly every time

1. **Set your work zero (X0/Y0/Z0) on the machine** where you want it for the job.
2. **Run the surface and/or face probe in that same WCS** — do not re-zero between probing and running.
3. **Load your CAM G-code in the Apply tab**, set the Reference Z (for surface) or Reference Face Position (for face), then click **Apply Compensation**.
4. **Click Send to ncSender** (or Download) — the compensated file is now ready to run.
5. **Run the job without changing the WCS** between probing and running.

If you change work zero between probing and running, the mesh offsets will be applied to the wrong coordinates.

---

## Tabs

### Setup
Global probe settings, machine helpers, jog controls, and Saved Location (jog reference only).

### Probe
Select probe mode (Surface, Face, or Combined), configure grid/face parameters, and run the probe.

### Results
View all probe contact points in a unified table with 3D and heatmap visualisations.

### Mesh Data
View and manage surface mesh and face mesh data (save/load/export/import).

### Apply *(compensation workflow)*
Load a G-code file and apply the probed mesh as a Z-height (surface) or face-depth (face) compensation offset.

#### Surface Compensation
- **G-code File** — load the CAM toolpath you want to compensate.
- **Reference Z (mm)** — the mesh Z value that corresponds to your work Z=0. Any probe point at this Z will receive zero offset; points higher add positive offset, lower add negative.
- **Apply Surface Compensation** — modifies every Z move within the probed grid area.
- **Download / Send to ncSender** — export or load the compensated file.

#### Face Compensation
- **G-code File** — load the CAM toolpath for the face cut.
- **Reference Face Position (mm)** — the nominal flat face Y (or X) position in work coordinates. Acts as the baseline; each point is offset by `(measured contact) − reference`.
- **Face Toolpath Parameters** (saved to browser storage):
  - **X Step (mm)** — sampling interval along the face-horizontal axis.
  - **Z Step (mm)** — layer step in Z depth.
  - **Cut Feed (mm/min)** — feed rate for cutting moves.
  - **Travel Feed (mm/min)** — feed rate for clearance/travel moves.
- **Apply Face Compensation** — adjusts the face-depth axis (Y for Y-face, X for X-face) at each (position, Z) using bilinear interpolation of the face mesh.
- **Preview Toolpath** — renders the compensated toolpath from the correct viewing angle (XZ or YZ plane).
- **Download / Send to ncSender** — export or load the compensated file.

> **Note:** ncSender's toolpath preview shows the XY plane (top-down view). Face compensation adjusts the depth axis — use the plugin's **Preview Toolpath** button to verify the face contour from the correct viewing angle.

---

## Probe Types

### Surface Probe
Probes a rectangular grid of points on the top surface. Records Z contact at each (X, Y) position. Used to compensate Z height across a warped or curved slab top.

### Face Probe
Probes a layered grid of points on the vertical face (the live edge wall). Records contact position (Y for Y-face, X for X-face) at each (position, Z-depth) combination. Used to compensate face cuts to follow the actual wall contour.

### Combined (Surface + Face)
Runs both probes sequentially in one operation.

---

## Troubleshooting

### "0 lines modified" after Apply Face Compensation
This means no G-code lines matched the face compensation criteria. The face compensation only modifies lines that contain an **explicit** face-axis coordinate word (`Y...` for Y-face, `X...` for X-face) on a G0/G1 move line. Check that:
- Your loaded G-code actually uses the expected axis.
- The Probe Mode matches your actual face axis.
- Lines use standard G0/G1 format with explicit axis words.

### Compensated output looks wrong in ncSender preview
ncSender's default toolpath preview shows the XY (top-down) plane. Face compensation changes the depth axis (Y or X), so the toolpath will appear flat in ncSender's default view. Use the **Preview Toolpath** button in the Apply tab to verify the correct XZ or YZ view.

### Work zero drifted between probe and run
If the compensated toolpath is cutting at the wrong depth, verify that the machine's active WCS (G54 or equivalent) has the same work zero as when you probed. The plugin cannot detect or compensate for WCS changes after probing.
