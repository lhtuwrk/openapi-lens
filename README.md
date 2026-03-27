# OpenAPI Lens

OpenAPI Lens is a lightweight Chrome extension that detects OpenAPI and Swagger specifications directly from page content and opens a fast, themeable docs viewer.

Chrome Web Store: https://chromewebstore.google.com/detail/openapi-lens/mokdlalbbecceccbcjkgcmbkmfdjmekj

## Highlights

- DOM-first detection for OpenAPI/Swagger specs
- Supports JSON and YAML specs
- Raw Spec panel + Parsed Docs panel
- Search endpoints by method, path, or summary
- Request/Response model viewer with collapsible schema tree
- Split view for Schema and Example JSON
- Raw/Parsed toggle in docs panel
- Light and dark themes
- Recent specs history (up to 15), available in:
  - Popup settings
  - Viewer slide-over panel from the left menu button (with count badge)

## How It Works

1. The content script scans the current page for OpenAPI/Swagger content in the DOM.
2. When a valid spec is found, it stores the spec text in local storage.
3. The extension opens `viewer.html` and renders:
   - Raw specification
   - Parsed API documentation

No external API call is required for the viewer workflow.

## Usage

1. Open any page that contains a full OpenAPI or Swagger spec.
2. If auto-open is enabled, the viewer opens automatically.
3. If auto-open is disabled, click Open in the banner.
4. In the viewer:
   - Use the search box to filter endpoints.
   - Expand endpoints to inspect parameters, body, and responses.
   - Use the left floating menu button (`>`) to open the Recent specs drawer.

## Popup Settings

From the extension popup you can:

- Toggle auto-open behavior
- Switch theme preference
- Open recent specs quickly
- Remove one recent item or clear all

## Permissions

The extension uses:

- `storage` to persist settings and recent history
- Host permissions for:
  - `http://*/*`
  - `https://*/*`
  - `file:///*`

## Version

Current version: `1.1.0`

## Project Structure

- `manifest.json`: Extension configuration (MV3)
- `content.js`: DOM detection and viewer handoff
- `viewer.html`, `viewer.js`, `styles.css`: Main docs viewer UI and logic
- `popup.html`, `popup.js`: Settings and recent specs UI
- `libs/js-yaml.min.js`: YAML parsing support

## Notes

- For local files (`file://`), make sure Chrome extension access to file URLs is enabled.
- Very large specs may take longer to parse and render.
