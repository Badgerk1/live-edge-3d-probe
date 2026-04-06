# 3D Live Edge Mesh Combined — Plugin for ncSender

> **Version 21.0** &nbsp;·&nbsp; CNC probe plugin for ncSender &nbsp;·&nbsp; Author: [Badgerk1](https://github.com/Badgerk1)

---

## Overview

**3D Live Edge Mesh Combined** is a professional-grade CNC probing and Z-compensation plugin for [ncSender](https://ncsender.com/). It was purpose-built for machining irregular, organic surfaces — live-edge wood slabs, stone, cast resin, and any workpiece whose top face is not perfectly flat or level.

The plugin automates the full probing workflow: it physically measures the surface topology of the workpiece with your 3D touch probe, builds an accurate height map, visualises that map in an interactive 3D viewer, and then rewrites the loaded G-code so every cutting move follows the real surface contour rather than an assumed flat plane. The result is consistent depth-of-cut across the entire part — with no manual shimming, no feeler gauges, and no trial cuts.

---

## Key Features

### 1 · Surface Mesh Probing (1D / 2D Grid)

- Configurable rectangular grid (columns × rows) over any XY area of the workpiece.
- Serpentine probe path minimises travel distance between points.
- Adjustable probe feed rate, travel feed rate, clearance height, and maximum plunge depth.
- Real-time progress visualisation — each probed cell is colour-coded on a live heat map as results come in.
- Mesh subdivision: raw grid points are automatically subdivided to a user-defined spacing (default 2 mm) using bilinear interpolation, giving a smooth, dense height map for high-quality compensation.

### 2 · Face Probing (Multi-Layer 3D Scanning)

- Probes the vertical face of the workpiece across configurable X columns and Z layers.
- Up to 50 sample columns and 20 Z layers per run (hardware limits configurable in UI).
- Segmented travel moves with automatic contact-detection recovery: if the probe touches an obstacle during travel, it backs off and lifts before retrying — no crashes, no operator intervention.
- Layered face results are stored separately from surface results and can be combined for full 3D mesh visualisation.

### 3 · Bilinear Z Compensation with Move Subdivision

- Server-side G-code post-processor rewrites the loaded NC file in memory — no disk clutter.
- Reads every G0/G1 linear move; for moves longer than the subdivision threshold the move is split into segments so each one accurately follows the measured surface.
- Bilinear interpolation handles full 2D grids, single-row (1×N) linear interpolation, and single-column (N×1) linear interpolation seamlessly.
- Machine-coordinate moves (`G53`) and relative-mode moves are passed through unchanged.
- Output G-code retains all original comments, feed rates, and non-motion lines.

### 4 · Interactive 3D Mesh Visualiser

- Powered by [Three.js](https://threejs.org/) r128, embedded entirely inside the plugin UI — no external dependencies at run time.
- Orbit, pan, and zoom controls for fully interactive inspection of the height map.
- Colour gradient (cool → warm) mapped to Z height, making high and low spots immediately obvious.
- Supports both surface-mesh and face-mesh views; toggle between them without leaving the plugin.
- OBJ export of the face mesh at configurable subdivision resolution (0.5 mm – 25 mm step, default 2 mm) for use in CAD/inspection tools.

### 5 · G-code Bounds Analysis

- One-click analysis of the currently loaded G-code file.
- Reports exact XYZ bounding box so you can confirm the probe grid covers the entire cutting area before running compensation.
- Handles G90/G91 (absolute/relative) mode switches correctly throughout the file.

### 6 · Server-Side Mesh Persistence

- Mesh data is saved to and loaded from a JSON file in the ncSender user-data directory.
- Survives plugin reloads and application restarts — no need to re-probe between sessions.
- Cross-platform paths are resolved automatically (Windows `%APPDATA%`, macOS `~/Library/Application Support`, Linux `~/.config`).

### 7 · Probe Dimension Preset

- Editable geometry preset stores your specific 3D probe dimensions (shank diameter, body diameter, upper length, lower length, stylus length, tip ball diameter).
- Preset values feed directly into Z-offset calculations and are displayed on a live SVG diagram in the Setup tab.

### 8 · Data Export

| Format | Contents |
|--------|----------|
| **JSON** | Full mesh snapshot — grid config, all probe results, plugin version, ISO timestamp. Schema version `1.7.0`. |
| **CSV** | Tabular surface probe results for import into Excel, MATLAB, or any spreadsheet. |
| **OBJ** | Triangulated 3D mesh of the face-probe surface for CAD or 3D-printing previews. |

### 9 · Workflow Management & Logging

- Named saved-location feature stores a probe reference position for quick re-homing between jobs.
- Per-session probe log for both surface and face probes — timestamped entries, scrollable in-UI, exportable.
- Optional debug log mode that writes detailed internal events to the browser console and the in-UI log panel.
- Stop button halts any probe cycle immediately and safely.

---

## Architecture

```
ncSender (host application)
│
├── index.js          Server-side plugin entry point (Node.js ESM)
│   ├── G-code bounds analysis
│   ├── Bilinear Z interpolation & move-subdivision post-processor
│   ├── Mesh file persistence (read / write JSON)
│   └── Settings bridge (applyCompensation, saveMeshFile, loadMeshFile flags)
│
└── config.html       Self-contained plugin UI (single HTML file)
    ├── Setup tab      — probe dimensions, grid configuration
    ├── Probe tab      — run surface probe, face probe, live log
    ├── Results tab    — per-point result table
    ├── Mesh Data tab  — save / load / export mesh
    └── Apply tab      — G-code bounds analysis + apply Z compensation
```

`config.html` is generated from source partials in `src/` — see [Contributing / Editing the UI](#contributing--editing-the-ui) below.

---

## Requirements

| Requirement | Details |
|-------------|---------|
| **ncSender** | v0.3.131 or later (platform `v1`); ncSender Pro v2.0.0+ for `pro-v2` features |
| **CNC controller** | Any GRBL-compatible controller; probe pin must be wired and functional |
| **3D touch probe** | Any probe that opens/closes the probe circuit on contact |
| **Operating system** | Windows, macOS, or Linux (all supported by ncSender) |

---

## Installation

1. Download or clone this repository.
2. Open ncSender and navigate to **Settings → Plugins → Install Plugin**.
3. Select the repository folder (or the zip). ncSender reads `manifest.json` to register the plugin.
4. Click the **3D Live Edge Mesh Combined** entry in the tool menu to open the UI.

---

## Typical Workflow

```
1. Setup tab
   └─ Enter your probe dimensions and save the preset.
   └─ Configure the surface grid: origin, size, column count, row count.

2. Probe tab
   └─ Zero your machine at the workpiece origin.
   └─ Click "Run Surface Probe" — the machine traverses the grid automatically.
   └─ (Optional) Run "Face Probe" for vertical face scanning.

3. Results tab
   └─ Review the per-point height table.
   └─ Inspect the 3D heat map for outliers or missed points.

4. Mesh Data tab
   └─ Save the mesh to disk for future sessions.
   └─ Export to CSV / OBJ as needed.

5. Apply tab
   └─ Click "Analyze G-code Bounds" and confirm the grid covers the toolpath.
   └─ Click "Apply Z Compensation" — the plugin rewrites the loaded file
      and loads the compensated version back into ncSender automatically.
   └─ Run the compensated program.
```

---

## Contributing / Editing the UI

`config.html` is the single self-contained HTML file that ncSender loads as the plugin UI. It is generated from smaller source files in the `src/` directory — **do not edit `config.html` directly**.

### Source files in `src/`

| File | Contents |
|---|---|
| `src/config-header.html` | Opening `<!doctype html>`, `<html>`, `<head>`, and `<style>` tag |
| `src/styles.css` | All CSS rules (without `<style>` tags) |
| `src/config-body.html` | Closing `</style>`, CDN `<script>` tags, `</head>`, `<body>`, all HTML markup, and opening `<script>` tag |
| `src/js/core.js` | Shared state, debug helpers, and CNC communication utilities |
| `src/js/top-probe.js` | Surface mesh probing engine |
| `src/js/face-probe.js` | Face (vertical) probing engine |
| `src/js/probe-engine.js` | Mesh data builder, JSON save/load, CSV/OBJ export |
| `src/js/visualization.js` | Three.js 3D mesh renderer and heat-map colouring |
| `src/js/ui-helpers.js` | Tab switching, form helpers, log rendering |
| `src/js/finish-motion.js` | Post-probe motion sequencing |
| `src/config-footer.html` | Closing `</script>`, `</body>`, `</html>` |

### Probe image asset (`probe.png`)

The **Surface Probe Visualizer** (Probe tab) uses `probe.png` as the animated probe graphic. The file lives in the repository root alongside `config.html` and is referenced as `src="probe.png"` from the HTML.

A placeholder image is included in the repository. To replace it with your own probe picture:

1. Prepare your image as a **transparent PNG** (remove the white background so it looks clean on the dark visualiser backdrop). A height-to-width ratio of roughly **3 : 1** works best at the default 46 px display width.
2. Name it `probe.png` and place it in the **repository root** (next to `config.html`).
3. The animated `#sm-pviz-probe-body` element inherits the existing `probe-plunging` / `probe-contact` CSS class animations automatically — no JS changes are needed.

To adjust the display size or shadow, edit the `.sm-probe-img` rule in `src/styles.css`, then rebuild:

```css
.sm-probe-img {
  width: 46px;          /* change this to resize the probe graphic */
  height: auto;
  display: block;
  transform-origin: 50% 90%;
  filter: drop-shadow(0 6px 10px rgba(0,0,0,.45));
}
```

If you change the width significantly, also update the `margin` on `#sm-pviz-probe-body` so the ball-tip still aligns with the contact-point anchor:

```css
#surface-edge-mesh-root #sm-pviz-probe-body {
  margin: -120px 0 0 -23px;   /* top ≈ -(image-height × 0.87), left ≈ -(width/2) */
}
```



```bash
./build.sh
```

This concatenates the source partials back into a single `config.html` that ncSender loads.

---

## License

See repository root for license information.

---

*Built with precision for craftspeople who demand accuracy on every cut.*