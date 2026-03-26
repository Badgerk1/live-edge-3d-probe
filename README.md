# 3D Live Edge Mesh Combined

**V19.0.0** — Surface & Face probe · Unified 3D visualizer · 2D bilinear Z compensation

An ncSender plugin for CNC probe-based surface mapping and G-code Z compensation, designed for live edge wood slab profiling.

## Features

- **Surface Probing** — 1D linear or 2D grid probe patterns with configurable spacing
- **Face Probing** — Single-pass or layered multi-depth face edge detection
- **3D Visualization** — Interactive WebGL surface mesh viewer with rotation, zoom, and contour overlay
- **Surface Relief Map** — Top-down heatmap with bilinear interpolation between probe points
- **Z Compensation** — Server-side G-code processing with move subdivision for smooth surface following
- **Mesh Data Management** — Save/load mesh data to file or browser storage for reuse across sessions
- **Workflow Manager** — Save and recall named probe configurations for different jobs
- **Apply Tab** — Select top surface or face surface mesh, apply Z compensation, preview toolpath, and send to ncSender

## Tabs

| Tab | Purpose |
|-----|---------|
| **Setup** | Probe dimensions, grid configuration, machine helpers, jog controls |
| **Probe** | Probe mode selection, 2D grid config, probe settings, run/stop controls |
| **Results** | 3D view, surface relief map, probe results table, export |
| **Mesh Data** | Surface mesh visualizer, heatmap, mesh save/load/export |
| **Apply** | Z compensation engine — load G-code, select mesh source, apply and send |

## Files

| File | Purpose |
|------|---------|
| `config.html` | Complete plugin UI (HTML + CSS + JavaScript) |
| `index.js` | Server-side engine — Z compensation, mesh persistence, G-code processing |
| `manifest.json` | ncSender plugin manifest |
| `test-compensation.js` | Unit tests for Z compensation engine |

## Installation

1. Copy the plugin folder into your ncSender plugins directory
2. Restart ncSender
3. Open the plugin from the tool menu: **3D Live Edge Mesh Combined**

## Version History

- **V19.0.0** — Solid baseline. Server-side Z compensation engine with bilinear interpolation and move subdivision. Face compensation UI. Mesh source selector (top surface / face surface). XY-only cutting move fix. Version consistency across all files.
- **V18.2** — Combined Surface & Face probe with unified 3D visualizer and 2D bilinear Z compensation.

## Author

Badgerk1

## License

See repository for license details.
