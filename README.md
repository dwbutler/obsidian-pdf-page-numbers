# PDF Page Numbers — Obsidian Plugin

Adds configurable page numbers to your PDF exports from Obsidian.

## Features

- **Automatic page numbering** — every page in your exported PDF gets a number
- **Multiple positions** — bottom-center, bottom-left, bottom-right, top-center, top-left, top-right
- **Flexible formats** — "1", "Page 1 of 5", or a custom template
- **Skip first page** — optionally hide the number on page 1 (title pages)
- **Configurable style** — font size, color, margins

## Installation

### Manual
1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release
2. Create a folder `your-vault/.obsidian/plugins/pdf-page-numbers/`
3. Copy the three files into that folder
4. Enable the plugin in **Settings → Community Plugins**

### From source
```bash
cd obsidian-pdf-page-numbers
npm install
npm run build
```
Then copy `main.js`, `manifest.json`, and `styles.css` into your vault's plugin folder.

## Usage

1. Open a note
2. Use the command palette → **"Export to PDF with page numbers"**
3. Or use the normal **Export to PDF** — the plugin hooks into the print pipeline automatically

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Position | Where on the page | Bottom Center |
| Format | Number format | Page X of Y |
| Custom format | Template with `{{page}}` and `{{total}}` | `Page {{page}} of {{total}}` |
| Font size | Size in points | 10 |
| Color | Hex color | `#666666` |
| Skip first page | Hide number on page 1 | Off |
| Bottom margin | Pixels from bottom edge | 20 |
| Top margin | Pixels from top edge | 20 |
| Side margin | Pixels from left/right edge | 20 |

## How It Works

The plugin uses two strategies to ensure page numbers appear reliably:

1. **`beforeprint` / `afterprint` events** — Injects page-number elements into the print DOM just before rendering, then cleans them up afterward.
2. **Workspace method patching** — Wraps Obsidian's internal PDF export method as a fallback for cases where window print events aren't fired.

Page numbers are injected as DOM elements (`.pdf-page-number`) that are only visible in `@media print`. They're placed at each page boundary detected through Obsidian's page-break markers.

## License

MIT
