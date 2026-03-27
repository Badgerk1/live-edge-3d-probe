# README

This section describes the Surface Grid...

## Surface Mesh
This part is about the Surface Mesh...

### Run Surface Probe
To run the surface probe...

### Surface Probe
Details about the Surface Probe...

## Contributing / Editing the UI

`config.html` is the single self-contained HTML file that ncSender loads as the plugin UI. It is generated from smaller source files in the `src/` directory — **do not edit `config.html` directly**.

### Source files in `src/`

| File | Contents |
|---|---|
| `src/config-header.html` | Opening `<!doctype html>`, `<html>`, `<head>`, and `<style>` tag |
| `src/styles.css` | All CSS rules (without `<style>` tags) |
| `src/config-body.html` | Closing `</style>`, CDN `<script>` tags, `</head>`, `<body>`, all HTML markup, and opening `<script>` tag |
| `src/config-scripts.js` | All JavaScript (without `<script>` tags) |
| `src/config-footer.html` | Closing `</script>`, `</body>`, `</html>` |

### Rebuilding `config.html`

After editing any file in `src/`, run:

```bash
./build.sh
```

This concatenates the source partials back into a single `config.html` that ncSender loads.