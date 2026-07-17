# Changelog

All notable changes to OpenAPI Lens are documented here.

## [1.4.0] - 2026-07-16

### Added
- **Spec diff / breaking-change detection** — When a spec opened from a URL has changed since your last visit, a "Δ Changes" button appears in the viewer top bar (red-accented if anything is breaking). It opens a "What changed" report split into **Breaking changes** (endpoints/responses/media types removed, parameters removed or newly required, type changes, response properties removed, enum values removed, request body newly required, …) and **Other changes** (additions, deprecations, format/version changes). Snapshots are kept per URL in `chrome.storage.local` (last 10 URLs, specs over 400 KB skipped; uploaded files are not tracked).
- **Deep search in the viewer** — The endpoint search now also matches operation descriptions, parameter names/descriptions, schema property names and titles, `$ref` schema names, and enum values across request and response bodies (resolved through `$ref`/`allOf`/`oneOf`/`anyOf`), so collapsed endpoints are found by their contents.
- **Search in the popup** — Filter the "Recent specs" list live by name or URL. The search box hides itself when the history is empty.
- **Delete confirmations** — Removing a recent spec now requires a second click ("Sure?", auto-reverts after 3 s), and "Clear all" opens a confirmation modal showing how many entries will be removed. Applies to both the popup and the viewer drawer.

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
