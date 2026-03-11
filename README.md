# PDF Page Numbers — Obsidian Plugin

Adds configurable page numbers to your PDF exports from Obsidian.

## Features

- **Automatic page numbering** — every page in your exported PDF gets a number
- **Built into the native export flow** — adds a page-number toggle to Obsidian's PDF export dialog
- **Multiple positions** — bottom-center, bottom-left, bottom-right, top-center, top-left, top-right
- **Flexible formats** — "1", "Page 1 of 5", or a custom template
- **Skip first page** — optionally hide the number on page 1 (title pages)
- **Configurable style** — font size, color, and margins

## Requirements

- Obsidian desktop `1.12.4` or newer

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
2. Choose **Export to PDF**
3. Enable or disable **Page numbers** in the export dialog
4. Export the PDF

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Enable page numbers | Turn page numbers on or off | On |
| Position | Where on the page | Bottom Center |
| Format | Number format | Page X of Y |
| Custom format | Template with `{{page}}` and `{{total}}` | `Page {{page}} of {{total}}` |
| Font size | Size in points | 10 |
| Font family | Font used for page numbers | `sans-serif` |
| Color | Hex color | `#666666` |
| Skip first page | Hide number on page 1 | Off |
| Bottom margin | Pixels from bottom edge | 20 |
| Top margin | Pixels from top edge | 20 |
| Side margin | Pixels from left/right edge | 20 |

## How It Works

Obsidian `1.12.4` exports PDFs from a hidden popup window rather than the main note view. This plugin patches that popup's print flow so it can inject page-number header/footer options at export time.

The plugin also keeps a DOM-based fallback for Obsidian print views, but the primary path is the hidden export popup used by the built-in PDF dialog.

## License

MIT
