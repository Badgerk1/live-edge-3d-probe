# README

This section describes the Surface Grid...

## Surface Mesh
This part is about the Surface Mesh...

### Run Surface Probe
To run the surface probe...

### Surface Probe
Details about the Surface Probe...

## Apply Tab

The **Apply** tab lets you apply Z compensation to a loaded G-code file using the probed surface mesh. It contains the following sections:

### Apply Z Compensation to G-code
A status panel that shows readiness indicators:
- **Mesh status** – whether a valid surface mesh is available (from probing or a loaded mesh).
- **G-code status** – whether a G-code file is currently loaded in ncSender.
- **Ready status** – overall readiness to apply compensation.

A brief description reminds the user to load a G-code file in ncSender and run surface probing first. The server-side engine subdivides long moves for smooth surface following.

### G-code Information
Displays details about the currently loaded G-code file:
- **Loaded file** – read-only field showing the filename of the loaded G-code.
- **XY Bounds** – read-only field showing the XY bounding box of the loaded G-code.
- **Auto Grid from G-code** button – automatically sets the probe grid Min/Max values from the loaded G-code bounds.
- **Refresh Status** button – manually refreshes the G-code and mesh status indicators.

### Compensation Settings
- **Reference Z (mm)** – the Z value in the mesh that represents the flat datum (usually 0). This value is subtracted from the mesh Z at each point to compute the height offset. Leave at 0 if the probe touched the surface at Z = 0 in machine coordinates.

### Apply
- **Apply Z Compensation** button – triggers the compensation engine. This button is disabled until both a valid mesh and a loaded G-code file are detected.
- **Result status** – shows the outcome of the last compensation attempt (success with the output filename, or an error message).
- **Apply log** – a scrollable log area that displays detailed messages from the compensation process.