# Changelog

All notable changes to OpenAPI Lens are documented here.

## [1.4.0] - 2026-07-16

### Added
- **Deep search in the viewer** — The endpoint search now also matches operation descriptions, parameter names/descriptions, schema property names and titles, `$ref` schema names, and enum values across request and response bodies (resolved through `$ref`/`allOf`/`oneOf`/`anyOf`), so collapsed endpoints are found by their contents.
- **Search in the popup** — Filter the "Recent specs" list live by name or URL. The search box hides itself when the history is empty.
- **Delete confirmations** — Removing a recent spec now requires a second click ("Sure?", auto-reverts after 3 s), and "Clear all" opens a confirmation modal showing how many entries will be removed. Applies to both the popup and the viewer drawer.

### Changed
- **Denser top and status bars** — The viewer's top bar and bottom status bar were slimmed down (and the surrounding padding/gaps tightened), reclaiming ~30% of the vertical chrome for the actual spec/docs panels. The top bar now separates the app name from the source URL with a divider, and the status bar shows a small ready/error state dot (green/red) alongside its text.
- **Action buttons are now icons app-wide** — Toolbar and inline action buttons across the viewer and popup use compact icons (with tooltips and accessible `aria-label`s) instead of text: raw-spec Upload/Edit/Copy, the theme toggle (moon/sun), endpoint "Copy path", schema/example "Copy JSON", recent-drawer close and "Clear all", the file-modal close and "Load", and the popup's Upload/Clear/Open. This fixes the button/title overlap when the raw-spec panel is resized narrow. Copy and Edit buttons swap to a check icon for their copied/active state. Confirmation-dialog buttons (Cancel / Clear all) and the Split / Schema only / Example only control keep their text labels for clarity.
- **Search bar stays visible while scrolling** — The viewer's endpoint search is now a sticky bar pinned to the top of the docs panel, so you can search from anywhere in a long spec without scrolling back up. At rest it spans the full width of the endpoint list; once pinned, a full-width translucent frosted-glass strip appears across the top and the input shrinks to a centered, fully-rounded pill within it. Pressing `/` focuses it from anywhere in the page.
- **Parameter display redesigned** — Parameters are now stacked rows instead of a 5-column table: bold name with pill badges for location, type, and required/optional, and the description on its own full-width line. Enum values, defaults, and deprecation are now surfaced as badges (previously dropped). Handles narrow panel widths without column squeeze.

### Fixed
- `hidden` attribute on `.icon-btn` elements was overridden by `display: inline-flex`, so conditionally-hidden top-bar buttons could stay visible.

---

## [1.3.0] - 2026-05-14

### Added
- **Open from file (popup)** — Upload a local `.json`, `.yaml`, or `.yml` spec directly from the extension popup. Single-file uploads open the viewer immediately; multi-file or partially-invalid batches show a result list.
- **Upload in viewer** — "Upload" button in the Raw Spec panel header lets you load a local spec file without leaving the viewer.
- **Inline spec editor** — "Edit" button in the Raw Spec panel opens the raw text in an editable textarea. Edits are validated and the Docs panel re-renders live (300 ms debounce). Pressing "Done" or Escape exits edit mode.
- Escape key now also closes the file-upload results modal and exits inline edit mode.
- Endpoint summary text now shows a tooltip (`title`) for long summaries that are truncated.

### Fixed
- Raw spec panel scroll overflow — `overflow` is now properly contained so the panel scrolls independently without affecting the page layout.
- Endpoint path column no longer over-shrinks on narrow viewports (`max-width: min(420px, 40%)`).

### Changed
- Docs event listeners (endpoint toggle, search, media-type selector, copy-schema) are now bound once via a single delegated listener on `#docs-root` instead of being re-bound on every spec load.

---

## [1.2.0] - 2026-04-24

### Added
- **Source URL as clickable link** — The spec URL in the viewer header is now an `<a>` element. Clicking it navigates back to the original page.
- **Skip-viewer param** (`oal_skip_viewer=1`) — The link back to the source URL includes this query param so the content script does not re-intercept the navigation and open the viewer again.

### Removed
- Raw/Parsed toggle button removed from the Docs panel header (always shows parsed view).

---

## [1.1.0] - Initial release

- DOM-first detection for OpenAPI/Swagger specs (JSON and YAML).
- Auto-open setting and banner for manual open.
- Viewer with Raw Spec panel and Parsed Docs panel.
- Endpoint search by method, path, or summary.
- Request/Response schema tree with collapsible nodes and copy support.
- Split view for Schema and Example JSON.
- Light and dark themes.
- Recent specs history (up to 15 entries), accessible from popup and viewer slide-over drawer.
- `storage` permission only — no external API calls.
