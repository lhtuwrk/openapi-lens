(() => {
  const pageUrl = window.location.href;

  // Never run inside the viewer itself.
  if (pageUrl.startsWith("chrome-extension://")) return;

  const RECENT_SPECS_KEY = "recentSpecs";
  const MAX_RECENT_SPECS = 15;
  const SKIP_VIEWER_PARAM = "oal_skip_viewer";
  const ALLOWED_CONTENT_TYPES = new Set([
    "application/json",
    "text/plain",
    "application/yaml",
    "text/yaml"
  ]);
  let hasDetected = false;
  let hasRenderedUi = false;

  function shouldSkipViewerOnThisPage() {
    try {
      const current = new URL(window.location.href);
      return current.searchParams.get(SKIP_VIEWER_PARAM) === "1";
    } catch (_) {
      return false;
    }
  }

  // ── DOM extraction (no fetch) ───────────────────────────────────────────

  function sanitizeViewerLinePrefixes(text) {
    const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    if (!lines.length) return "";

    // Only strip prefixes when text really looks like SCM line-number output.
    const linePrefixRe = /^\s*\d+\s*\|\s?/;
    const prefixedCount = lines.reduce((sum, line) => sum + (linePrefixRe.test(line) ? 1 : 0), 0);
    const ratio = prefixedCount / lines.length;

    if (prefixedCount < 3 || ratio < 0.25) {
      return lines.join("\n").trim();
    }

    return lines
      .map((line) => line.replace(linePrefixRe, ""))
      .join("\n")
      .trim();
  }

  function collectCodeLines() {
    const selectors = [
      "table td.blob-code",
      "table td.code",
      "table td.line",
      ".blob-code-inner",
      "[data-testid='code-cell']"
    ];

    for (const selector of selectors) {
      const nodes = document.querySelectorAll(selector);
      if (!nodes || nodes.length < 2) continue;
      const joined = Array.from(nodes)
        .map((node) => (node.innerText || node.textContent || "").trimEnd())
        .join("\n")
        .trim();
      if (joined.length > 20) return sanitizeViewerLinePrefixes(joined);
    }

    return "";
  }

  function extractText() {
    // Some SCM viewers render source lines in table cells rather than a single <pre>.
    const fromCodeLines = collectCodeLines();
    if (fromCodeLines) return fromCodeLines;

    const preCode = document.querySelector("pre code");
    if (preCode) {
      const text = (preCode.innerText || preCode.textContent || "").trim();
      if (text) return sanitizeViewerLinePrefixes(text);
    }

    // Prefer <pre> content – covers GitHub raw, GitLab, browser JSON views.
    const pre = document.querySelector("pre");
    if (pre) return sanitizeViewerLinePrefixes(pre.innerText || pre.textContent || "");

    // Fallback: full body text.
    return sanitizeViewerLinePrefixes((document.body && (document.body.innerText || document.body.textContent)) || "");
  }

  // ── Guard: detect HTML pages / SPAs ─────────────────────────────────────

  function isHTML(text) {
    const sample = String(text || "").slice(0, 5000).toLowerCase();
    const hasHtmlShell =
      sample.includes("<html") ||
      sample.includes("<!doctype") ||
      sample.includes("<body");
    const hasScriptSpaMarkers =
      sample.includes("<script") &&
      (sample.includes("window.") || sample.includes("document."));
    return hasHtmlShell || hasScriptSpaMarkers;
  }

  function hasMinimumStructure(obj) {
    if (!obj || typeof obj !== "object") return false;
    if (!obj.paths || typeof obj.paths !== "object") return false;
    if (Object.keys(obj.paths).length === 0) return false;
    if (!obj.info) return false;
    return true;
  }

  // ── Spec detection ───────────────────────────────────────────────────────

  function parseSpec(text) {
    if (!text || text.length < 50) return null;
    if (isHTML(text)) return null;

    // Try JSON – require openapi/swagger AND paths.
    try {
      const obj = JSON.parse(text);
      if (
        obj &&
        typeof obj === "object" &&
        (obj.openapi || obj.swagger) &&
        obj.paths &&
        typeof obj.paths === "object"
      ) {
        if (!hasMinimumStructure(obj)) return null;
        return obj;
      }
    } catch (_) {
      // Not JSON.
    }

    // YAML heuristic – require both version marker AND paths key.
    const hasOpenapi = /(^|\n)\s*openapi\s*:\s*['"]?\d/.test(text);
    const hasSwagger = /(^|\n)\s*swagger\s*:\s*['"]?\d/.test(text);
    const hasPaths = /(^|\n)\s*paths\s*:/m.test(text);
    const hasInfo = /(^|\n)\s*info\s*:/m.test(text);
    if ((hasOpenapi || hasSwagger) && hasPaths && hasInfo) {
      return { _yamlDetected: true };
    }

    return null;
  }

  function shouldInspect() {
    const ct = (document.contentType || "").toLowerCase();
    const mime = ct.split(";")[0].trim();
    if (!mime || mime === "text/html") return false;
    return ALLOWED_CONTENT_TYPES.has(mime);
  }

  // ── Open viewer ──────────────────────────────────────────────────────────

  function normalizedUrl(url) {
    try {
      const u = new URL(url);
      u.hash = "";
      return u.toString();
    } catch (_) {
      return String(url || "");
    }
  }

  function fallbackNameFromUrl(url) {
    try {
      const u = new URL(url);
      const parts = u.pathname.split("/").filter(Boolean);
      const last = parts[parts.length - 1];
      if (last) return decodeURIComponent(last);
      return u.hostname || "OpenAPI spec";
    } catch (_) {
      return "OpenAPI spec";
    }
  }

  function titleFromRawSpec(rawText) {
    const text = String(rawText || "");
    if (!text) return "";

    try {
      const obj = JSON.parse(text);
      const title = obj?.info?.title;
      if (typeof title === "string" && title.trim()) return title.trim();
    } catch (_) {
      // Not JSON.
    }

    const yamlInfoTitle = text.match(/(^|\n)\s*title\s*:\s*["']?([^"'\n]+)["']?/m);
    if (yamlInfoTitle && yamlInfoTitle[2]) return yamlInfoTitle[2].trim();

    return "";
  }

  function saveRecentSpec(rawText, sourceUrl) {
    const url = normalizedUrl(sourceUrl);
    if (!url) return;

    const title = titleFromRawSpec(rawText);
    const name = title || fallbackNameFromUrl(url);
    const entry = { url, name, lastOpenedAt: Date.now() };

    chrome.storage.local.get([RECENT_SPECS_KEY], (data) => {
      if (chrome.runtime.lastError) return;
      const list = Array.isArray(data[RECENT_SPECS_KEY]) ? data[RECENT_SPECS_KEY] : [];
      const deduped = [entry, ...list.filter((item) => item?.url !== url)].slice(0, MAX_RECENT_SPECS);
      chrome.storage.local.set({ [RECENT_SPECS_KEY]: deduped });
    });
  }

  function openViewer(rawText) {
    try {
      const id = chrome?.runtime?.id;
      if (!id) return;
      const base = chrome.runtime.getURL("viewer.html");
      if (!base || base.includes("chrome-extension://invalid/")) return;
      hasRenderedUi = true;

      saveRecentSpec(rawText, pageUrl);

      chrome.storage.local.set(
        { pendingSpec: { rawText, sourceUrl: pageUrl } },
        () => window.location.replace(base)
      );
    } catch (_) {
      // Extension context may be invalid after reload.
    }
  }

  // ── Confirmation banner (autoOpen = false) ───────────────────────────────

  function showBanner(rawText) {
    if (document.getElementById("oal-banner")) return;
    hasRenderedUi = true;

    const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const banner = document.createElement("div");
    banner.id = "oal-banner";
    banner.style.cssText = [
      "position:fixed", "top:18px", "left:50%", "transform:translateX(-50%)", "z-index:2147483647",
      `background:${dark ? "#0f1923" : "#ffffff"}`,
      `border:1px solid ${dark ? "rgba(34,197,94,.4)" : "#d1fae5"}`,
      "border-radius:14px", "padding:14px 16px",
      "display:flex", "align-items:center", "justify-content:space-between", "gap:14px",
      "font-family:system-ui,-apple-system,sans-serif", "font-size:13px",
      `color:${dark ? "#d8e3ec" : "#1a2332"}`,
      "box-shadow:0 4px 24px rgba(0,0,0,.28)",
      "min-width:520px", "max-width:min(760px,calc(100vw - 32px))"
    ].join(";");

    const left = document.createElement("div");
    left.style.cssText = "display:flex;align-items:center;gap:10px;min-width:0;flex:1";

    const logo = document.createElement("img");
    logo.src = chrome.runtime.getURL("icons/icon-32.png");
    logo.alt = "OpenAPI Lens";
    logo.style.cssText = "width:24px;height:24px;flex-shrink:0";

    const textWrap = document.createElement("div");
    textWrap.style.cssText = "display:flex;flex-direction:column;gap:2px;min-width:0";

    const title = document.createElement("div");
    title.textContent = "OpenAPI Lens";
    title.style.cssText = "font-size:13px;font-weight:700;letter-spacing:.2px;line-height:1.2";

    const label = document.createElement("div");
    label.textContent = "OpenAPI spec detected on this page.";
    label.style.cssText = `font-size:12px;color:${dark ? "#9fb2c2" : "#5b6d7d"};line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`;

    textWrap.appendChild(title);
    textWrap.appendChild(label);
    left.appendChild(logo);
    left.appendChild(textWrap);

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;align-items:center;gap:8px;flex-shrink:0";

    const openBtn = document.createElement("button");
    openBtn.textContent = "Open viewer";
    openBtn.style.cssText = "background:#16a34a;color:#fff;border:none;border-radius:8px;padding:7px 14px;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap";

    const dismissBtn = document.createElement("button");
    dismissBtn.textContent = "✕";
    dismissBtn.style.cssText = `background:transparent;color:${dark ? "#8ea1b2" : "#94a3b8"};border:1px solid ${dark ? "#374151" : "#e2e8f0"};border-radius:8px;padding:6px 10px;cursor:pointer;font-size:12px`;

    actions.appendChild(openBtn);
    actions.appendChild(dismissBtn);
    banner.appendChild(left);
    banner.appendChild(actions);
    document.body.appendChild(banner);

    openBtn.addEventListener("click", () => { banner.remove(); openViewer(rawText); });
    dismissBtn.addEventListener("click", () => banner.remove());
  }

  // ── Main ─────────────────────────────────────────────────────────────────

  function detect() {
    if (hasDetected) return;
    hasDetected = true;
    if (shouldSkipViewerOnThisPage()) return;
    if (hasRenderedUi || document.getElementById("oal-banner")) {
      return;
    }
    if (!shouldInspect()) return;
    const rawText = extractText();
    if (!rawText) return;
    const result = parseSpec(rawText);
    console.log("OpenAPI detection:", result);
    if (!result) return;
    if (hasRenderedUi || document.getElementById("oal-banner")) return;

    chrome.storage.local.get(["autoOpen"], (settings) => {
      if (chrome.runtime.lastError) return;
      if (settings.autoOpen === true) {
        openViewer(rawText);
      } else {
        showBanner(rawText);
      }
    });
  }

  detect();
})();
