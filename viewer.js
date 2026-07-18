(() => {
  const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "head", "options"];
  // Inline Lucide-style icons (self-contained SVG, no external requests).
  const SVG_OPEN = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const ICON_COPY = `<svg class="icon-default" ${SVG_OPEN}><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
  const ICON_CHECK = `<svg class="icon-alt" ${SVG_OPEN}><polyline points="20 6 9 17 4 12"/></svg>`;
  const ICON_DOWNLOAD = `<svg ${SVG_OPEN}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`;
  const RECENT_SPECS_KEY = "recentSpecs";
  const MAX_RECENT_SPECS = 15;
  const SKIP_VIEWER_PARAM = "oal_skip_viewer";
  const endpointStore = new Map();
  let rawSpecText = "";
  let activeSpec = null;
  const schemaNodeStore = new Map();
  const schemaCopyStore = new Map();
  const valueTreeStore = new Map();
  let schemaNodeSeq = 0;
  let schemaCopySeq = 0;
  let valueTreeSeq = 0;
  let schemaDescSeq = 0;
  let activeMediaResize = null;
  let activeMediaVResize = null;
  let isEditMode = false;
  let editorDebounceTimer = null;
  const REMOVE_CONFIRM_TIMEOUT_MS = 3000;
  let recentItemCount = 0;
  let removeConfirmTimer = null;
  const SEARCH_SCHEMA_MAX_DEPTH = 5;
  const SEARCH_MAX_TOKENS = 400;
  const SEARCH_TEXT_MAX_CHARS = 6000;

  // ── Theme ────────────────────────────────────────────────────────────────

  function applyTheme(theme) {
    const isDark = theme === "dark";
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
    const btn = document.getElementById("theme-toggle");
    if (btn) {
      // is-active swaps the moon icon for the sun icon (see .icon-btn-square).
      btn.classList.toggle("is-active", isDark);
      const label = isDark ? "Switch to light theme" : "Switch to dark theme";
      btn.title = label;
      btn.setAttribute("aria-label", label);
    }
  }

  // ── Status / header helpers ──────────────────────────────────────────────

  function setStatus(msg, isError = false) {
    const el = document.getElementById("status");
    if (!el) return;
    const textEl = document.getElementById("status-text");
    if (textEl) {
      textEl.textContent = msg;
    } else {
      el.textContent = msg;
    }
    el.classList.toggle("error", isError);
  }

  function setStatusAuthor() {
    const el = document.getElementById("status-author");
    if (!el) return;
    try {
      const manifest = chrome.runtime.getManifest?.() || {};
      const authorRaw = typeof manifest.author === "string" ? manifest.author.trim() : "";
      const author = authorRaw || "@lhtu";
      el.textContent = author.startsWith("by ") ? author : `by ${author}`;
    } catch (_) {
      el.textContent = "by @lhtu";
    }
  }

  function setSourceUrl(url) {
    const el = document.getElementById("source-url");
    if (!el) return;
    el.href = buildSourceUrl(url) || "#";
    el.textContent = url;
    el.title = url;
  }

  function buildSourceUrl(url) {
    const value = String(url || "").trim();
    if (!value) return "";
    try {
      const nextUrl = new URL(value);
      nextUrl.searchParams.set(SKIP_VIEWER_PARAM, "1");
      return nextUrl.toString();
    } catch (_) {
      return value;
    }
  }

  function setSpecVersionTag(val) {
    const el = document.getElementById("spec-version");
    if (el) el.textContent = val || "SPEC";
  }

  function setAppVersion() {
    const el = document.getElementById("viewer-version");
    if (!el) return;
    try {
      const version = chrome.runtime.getManifest()?.version;
      if (version) el.textContent = `v${version}`;
    } catch (_) {
      // Ignore if runtime is unavailable.
    }
  }

  function recentSpecsFromData(data) {
    const list = Array.isArray(data?.[RECENT_SPECS_KEY]) ? data[RECENT_SPECS_KEY] : [];
    return list
      .filter((item) => item && typeof item.url === "string" && item.url.trim())
      .slice(0, MAX_RECENT_SPECS);
  }

  function setRecentBadge(count) {
    const badge = document.getElementById("recent-menu-badge");
    if (!badge) return;
    const num = Number.isFinite(count) ? Math.max(0, count) : 0;
    badge.textContent = num > 99 ? "99+" : String(num);
  }

  function renderRecentList(items) {
    const listEl = document.getElementById("viewer-recent-list");
    if (!listEl) return;

    if (!items.length) {
      listEl.innerHTML = '<div class="recent-drawer-empty">No recent specs yet.</div>';
      return;
    }

    listEl.innerHTML = items.map((item) => {
      const name = escapeHtml(item?.name || "Untitled spec");
      const url = escapeHtml(String(item?.url || ""));
      return `
        <div class="viewer-recent-item">
          <button class="viewer-recent-main" data-action="open-recent" data-url="${url}" title="Open spec">
            <div class="viewer-recent-name">${name}</div>
            <div class="viewer-recent-url">${url}</div>
          </button>
          <button class="viewer-recent-remove" data-action="remove-recent" data-url="${url}" title="Remove">✕</button>
        </div>
      `;
    }).join("");
  }

  function setRecentDrawerOpen(open) {
    const drawer = document.getElementById("recent-drawer");
    const backdrop = document.getElementById("recent-drawer-backdrop");
    const toggleBtn = document.getElementById("recent-menu-toggle");
    if (!drawer || !backdrop || !toggleBtn) return;

    drawer.classList.toggle("is-open", open);
    drawer.setAttribute("aria-hidden", open ? "false" : "true");
    backdrop.classList.toggle("is-open", open);
    backdrop.hidden = !open;
    toggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
    toggleBtn.classList.toggle("is-open", open);
  }

  function refreshRecentSpecs() {
    chrome.storage.local.get([RECENT_SPECS_KEY], (data) => {
      const items = recentSpecsFromData(data);
      recentItemCount = items.length;
      setRecentBadge(items.length);
      renderRecentList(items);
    });
  }

  function openRecentUrl(url) {
    if (!url) return;
    try {
      chrome.tabs.create({ url });
    } catch (_) {
      window.open(url, "_blank");
    }
    setRecentDrawerOpen(false);
  }

  function removeRecentSpec(url) {
    if (!url) return;
    chrome.storage.local.get([RECENT_SPECS_KEY], (data) => {
      const list = recentSpecsFromData(data);
      const next = list.filter((item) => item?.url !== url);
      chrome.storage.local.set({ [RECENT_SPECS_KEY]: next }, refreshRecentSpecs);
    });
  }

  function armRemoveConfirm(button) {
    resetRemoveConfirm();
    button.classList.add("is-confirm");
    button.textContent = "Sure?";
    removeConfirmTimer = setTimeout(resetRemoveConfirm, REMOVE_CONFIRM_TIMEOUT_MS);
  }

  function resetRemoveConfirm() {
    if (removeConfirmTimer) {
      clearTimeout(removeConfirmTimer);
      removeConfirmTimer = null;
    }
    document.querySelectorAll(".viewer-recent-remove.is-confirm").forEach((btn) => {
      btn.classList.remove("is-confirm");
      btn.textContent = "✕";
    });
  }

  function setConfirmModalOpen(open) {
    const modal = document.getElementById("confirm-modal");
    const backdrop = document.getElementById("confirm-backdrop");
    if (!modal || !backdrop) return;
    if (open) {
      const countEl = document.getElementById("confirm-count");
      if (countEl) countEl.textContent = String(recentItemCount);
    }
    modal.hidden = !open;
    backdrop.hidden = !open;
  }

  function bindConfirmModal() {
    document.getElementById("confirm-cancel")?.addEventListener("click", () => setConfirmModalOpen(false));
    document.getElementById("confirm-backdrop")?.addEventListener("click", () => setConfirmModalOpen(false));
    document.getElementById("confirm-ok")?.addEventListener("click", () => {
      chrome.storage.local.set({ [RECENT_SPECS_KEY]: [] }, refreshRecentSpecs);
      setConfirmModalOpen(false);
    });
  }

  function bindRecentDrawer() {
    const toggleBtn = document.getElementById("recent-menu-toggle");
    const closeBtn = document.getElementById("recent-drawer-close");
    const backdrop = document.getElementById("recent-drawer-backdrop");
    const clearBtn = document.getElementById("viewer-clear-recent");
    const listEl = document.getElementById("viewer-recent-list");

    toggleBtn?.addEventListener("click", () => {
      const isOpen = document.getElementById("recent-drawer")?.classList.contains("is-open");
      setRecentDrawerOpen(!isOpen);
    });

    closeBtn?.addEventListener("click", () => setRecentDrawerOpen(false));
    backdrop?.addEventListener("click", () => setRecentDrawerOpen(false));

    clearBtn?.addEventListener("click", () => {
      if (!recentItemCount) return;
      setConfirmModalOpen(true);
    });

    bindConfirmModal();

    listEl?.addEventListener("click", (event) => {
      const openTarget = event.target.closest('[data-action="open-recent"]');
      if (openTarget) {
        openRecentUrl(openTarget.dataset.url || "");
        return;
      }

      const removeTarget = event.target.closest('[data-action="remove-recent"]');
      if (removeTarget) {
        const url = removeTarget.dataset.url || "";
        if (!url) return;
        if (removeTarget.classList.contains("is-confirm")) {
          resetRemoveConfirm();
          removeRecentSpec(url);
        } else {
          armRemoveConfirm(removeTarget);
        }
        return;
      }

      resetRemoveConfirm();
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        setConfirmModalOpen(false);
        setRecentDrawerOpen(false);
        setFileModalOpen(false);
        if (isEditMode) setEditMode(false);
      }
    });

    refreshRecentSpecs();
  }

  // ── Clipboard ────────────────────────────────────────────────────────────

  function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
      if (!btn) return;
      btn.classList.add("copy-success");
      // Icon buttons show a check via CSS; don't overwrite their SVG contents.
      if (btn.classList.contains("icon-btn-square")) {
        setTimeout(() => btn.classList.remove("copy-success"), 1500);
        return;
      }
      const orig = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => {
        btn.textContent = orig;
        btn.classList.remove("copy-success");
      }, 1500);
    }).catch(() => {});
  }

  // ── Spec parsing ─────────────────────────────────────────────────────────

  function escapeHtml(v) {
    return String(v)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function sanitizeHref(href) {
    const value = String(href || "").trim();
    if (!value) return "";
    // Allow safe link targets used in API docs.
    if (/^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(value)) return value;
    return "";
  }

  function renderInlineText(text) {
    const value = String(text || "");
    const tokenRe = /`([^`]+)`|\[([^\]]+)\]\(([^\s)]+)\)|(https?:\/\/[^\s<]+)/g;
    let out = "";
    let index = 0;
    let match;

    while ((match = tokenRe.exec(value)) !== null) {
      out += escapeHtml(value.slice(index, match.index));

      if (match[1]) {
        out += `<code class="inline-code">${escapeHtml(match[1])}</code>`;
      } else if (match[2] && match[3]) {
        const href = sanitizeHref(match[3]);
        if (href) {
          out += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(match[2])}</a>`;
        } else {
          out += escapeHtml(match[0]);
        }
      } else if (match[4]) {
        const href = escapeHtml(match[4]);
        out += `<a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a>`;
      }

      index = tokenRe.lastIndex;
    }

    out += escapeHtml(value.slice(index));
    return out;
  }

  function looksLikeJsonBlock(text) {
    const t = String(text || "").trim();
    if (!t) return false;
    const starts = t.startsWith("{") || t.startsWith("[");
    const ends = t.endsWith("}") || t.endsWith("]");
    if (!starts || !ends) return false;
    try {
      JSON.parse(t);
      return true;
    } catch (_) {
      return false;
    }
  }

  function highlightScalarWithSpacing(text, className) {
    const raw = String(text || "");
    const lead = raw.match(/^\s*/)?.[0] || "";
    const tail = raw.match(/\s*$/)?.[0] || "";
    const core = raw.slice(lead.length, raw.length - tail.length);
    if (!core) return escapeHtml(raw);
    return `${escapeHtml(lead)}<span class="${className}">${escapeHtml(core)}</span>${escapeHtml(tail)}`;
  }

  function highlightYamlScalar(raw) {
    const value = String(raw || "");
    const trimmed = value.trim();
    if (!trimmed) return escapeHtml(value);
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return highlightScalarWithSpacing(value, "raw-token-string");
    }
    if (/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(trimmed)) {
      return highlightScalarWithSpacing(value, "raw-token-number");
    }
    if (/^(true|false|yes|no|on|off)$/i.test(trimmed)) {
      return highlightScalarWithSpacing(value, "raw-token-boolean");
    }
    if (/^(null|~)$/i.test(trimmed)) {
      return highlightScalarWithSpacing(value, "raw-token-null");
    }
    return escapeHtml(value);
  }

  function highlightYamlLine(line) {
    const raw = String(line || "");
    if (!raw) return "";

    if (/^\s*#/.test(raw)) {
      return `<span class="raw-token-comment">${escapeHtml(raw)}</span>`;
    }

    const keyValue = raw.match(/^(\s*-\s*)?([^:#\n][^:\n]*?)(\s*:\s*)(.*)$/);
    if (keyValue) {
      const [, listPrefix = "", key = "", separator = "", value = ""] = keyValue;
      const inlineComment = value.match(/^(.*?)(\s+#.*)$/);
      const scalarPart = inlineComment ? inlineComment[1] : value;
      const commentPart = inlineComment ? inlineComment[2] : "";
      return `${escapeHtml(listPrefix)}<span class="raw-token-key">${escapeHtml(key.trimEnd())}</span>${escapeHtml(separator)}${highlightYamlScalar(scalarPart)}${commentPart ? `<span class="raw-token-comment">${escapeHtml(commentPart)}</span>` : ""}`;
    }

    const listValue = raw.match(/^(\s*-\s+)(.+)$/);
    if (listValue) {
      return `${escapeHtml(listValue[1])}${highlightYamlScalar(listValue[2])}`;
    }

    return escapeHtml(raw);
  }

  function renderRawSpecWithHighlight(rawText) {
    const source = String(rawText || "");
    if (!source) return "";

    if (looksLikeJsonBlock(source)) {
      try {
        const parsed = JSON.parse(source);
        return renderExampleJsonRows(parsed, 0, "").join("\n");
      } catch (_) {
        return escapeHtml(source);
      }
    }

    return source
      .split(/\r?\n/)
      .map((line) => highlightYamlLine(line))
      .join("\n");
  }

  function parseDescriptionBlocks(raw) {
    const lines = String(raw || "").replace(/\r\n?/g, "\n").split("\n");
    const blocks = [];
    let paragraph = [];
    let fence = null;

    function flushParagraph() {
      if (!paragraph.length) return;
      const text = paragraph.join("\n").trim();
      paragraph = [];
      if (!text) return;
      if (looksLikeJsonBlock(text)) {
        blocks.push({ type: "code", content: text, language: "json" });
      } else {
        blocks.push({ type: "paragraph", content: text });
      }
    }

    for (const line of lines) {
      const fenceMatch = line.match(/^```\s*([a-zA-Z0-9_-]+)?\s*$/);
      if (fenceMatch) {
        if (fence) {
          blocks.push({ type: "code", content: fence.lines.join("\n"), language: fence.language });
          fence = null;
        } else {
          flushParagraph();
          fence = { language: fenceMatch[1] || "", lines: [] };
        }
        continue;
      }

      if (fence) {
        fence.lines.push(line);
        continue;
      }

      if (!line.trim()) {
        flushParagraph();
        continue;
      }

      const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
      if (headingMatch) {
        flushParagraph();
        blocks.push({ type: "heading", content: headingMatch[1].trim() });
        continue;
      }

      paragraph.push(line);
    }

    flushParagraph();
    if (fence) {
      blocks.push({ type: "code", content: fence.lines.join("\n"), language: fence.language });
    }

    return blocks;
  }

  function formatDescription(text, emptyText = "No description.") {
    const raw = String(text || "").trim();
    if (!raw) return `<div class="muted">${escapeHtml(emptyText)}</div>`;

    const blocks = parseDescriptionBlocks(raw);
    if (!blocks.length) return `<div class="muted">${escapeHtml(emptyText)}</div>`;

    return `
      <div class="description-flow">
        ${blocks.map((block) => {
          if (block.type === "heading") {
            return `<div class="description-heading">${renderInlineText(block.content)}</div>`;
          }
          if (block.type === "code") {
            const lang = block.language ? `<div class="description-code-lang">${escapeHtml(block.language)}</div>` : "";
            return `
              <div class="description-code-wrap">
                ${lang}
                <pre class="description-code">${escapeHtml(block.content || "")}</pre>
              </div>
            `;
          }
          const paragraphHtml = renderInlineText(block.content).replace(/\n/g, "<br>");
          return `<p class="description-paragraph">${paragraphHtml}</p>`;
        }).join("")}
      </div>
    `;
  }

  function formatDescriptionCompact(text, emptyText = "") {
    const raw = String(text || "").trim();
    if (!raw) return emptyText ? `<span class="muted">${escapeHtml(emptyText)}</span>` : "";
    const blocks = parseDescriptionBlocks(raw);
    if (!blocks.length) return emptyText ? `<span class="muted">${escapeHtml(emptyText)}</span>` : "";

    return blocks.map((block) => {
      if (block.type === "heading") {
        return `<div class="description-inline-heading">${renderInlineText(block.content)}</div>`;
      }
      if (block.type === "code") {
        return `<pre class="description-inline-code">${escapeHtml(block.content || "")}</pre>`;
      }
      return `<div class="description-inline-text">${renderInlineText(block.content).replace(/\n/g, "<br>")}</div>`;
    }).join("");
  }

  function parseSpec(text) {
    try { return JSON.parse(text); } catch (_) {}
    if (window.jsyaml?.load) {
      try { return window.jsyaml.load(text); } catch (_) {}
    }
    return null;
  }

  function validateSpecText(text) {
    if (!window.jsyaml?.load) return { valid: false, error: "YAML parser not available" };
    try {
      const spec = parseSpec(text);
      if (!spec || typeof spec !== "object") return { valid: false, error: "Cannot parse as JSON or YAML" };
      if (!spec.openapi && !spec.swagger) return { valid: false, error: "Missing 'openapi' or 'swagger' field" };
      if (!spec.paths) return { valid: false, error: "Missing required 'paths' field" };
      return { valid: true, spec };
    } catch (err) {
      return { valid: false, error: String(err?.message || err) };
    }
  }

  function specVersion(spec) {
    if (typeof spec?.openapi === "string") return `OPENAPI ${spec.openapi}`;
    if (typeof spec?.swagger === "string") return `SWAGGER ${spec.swagger}`;
    return "OPENAPI";
  }

  function getServerText(spec) {
    if (Array.isArray(spec?.servers) && spec.servers[0]?.url) return spec.servers[0].url;
    if (spec?.swagger && spec.host) {
      const scheme = Array.isArray(spec.schemes) && spec.schemes[0] ? spec.schemes[0] : "https";
      return `${scheme}://${spec.host}${spec.basePath || ""}`;
    }
    return "";
  }

  function buildRequestBodyFromSwagger2(op, allParams) {
    const bodyParam = allParams.find((p) => p && p.in === "body");
    if (bodyParam) {
      const mediaType = Array.isArray(op?.consumes) && op.consumes[0] ? op.consumes[0] : "application/json";
      return {
        description: bodyParam.description || "",
        required: !!bodyParam.required,
        content: {
          [mediaType]: {
            schema: bodyParam.schema || { type: "object" },
            example: bodyParam.example !== undefined ? bodyParam.example : bodyParam.schema?.example
          }
        }
      };
    }

    const formParams = allParams.filter((p) => p && p.in === "formData");
    if (!formParams.length) return null;

    const required = formParams.filter((p) => p.required).map((p) => p.name).filter(Boolean);
    const properties = {};

    for (const p of formParams) {
      if (!p?.name) continue;
      const prop = {};
      if (p.type) prop.type = p.type;
      if (p.format) prop.format = p.format;
      if (p.description) prop.description = p.description;
      if (p.default !== undefined) prop.default = p.default;
      if (p.example !== undefined) prop.example = p.example;
      if (Array.isArray(p.enum)) prop.enum = p.enum;
      if (p.items) prop.items = p.items;
      properties[p.name] = prop;
    }

    const mediaType = Array.isArray(op?.consumes) && op.consumes[0]
      ? op.consumes[0]
      : "application/x-www-form-urlencoded";

    return {
      description: "",
      required: required.length > 0,
      content: {
        [mediaType]: {
          schema: {
            type: "object",
            properties,
            ...(required.length ? { required } : {})
          }
        }
      }
    };
  }

  function resolveParameterRef(param, refTrail = new Set()) {
    if (!param || typeof param !== "object") return null;
    if (typeof param.$ref !== "string") return param;
    if (!activeSpec || !param.$ref.startsWith("#/")) return null;
    if (refTrail.has(param.$ref)) return null;

    const nextTrail = new Set(refTrail);
    nextTrail.add(param.$ref);

    const target = pointerGet(activeSpec, param.$ref);
    if (!target || typeof target !== "object") return null;

    const merged = { ...target, ...param };
    delete merged.$ref;
    return resolveParameterRef(merged, nextTrail) || merged;
  }

  function normalizeParameter(param) {
    const resolved = resolveParameterRef(param);
    if (!resolved || typeof resolved !== "object") return null;

    const name = typeof resolved.name === "string" ? resolved.name.trim() : "";
    const where = typeof resolved.in === "string" ? resolved.in.trim() : "";
    if (!name || !where) return null;

    return {
      ...resolved,
      name,
      in: where,
      required: where === "path" ? true : !!resolved.required
    };
  }

  function mergeOperationParameters(pathParams, opParams) {
    const merged = [];
    const indexByKey = new Map();
    const sources = [
      Array.isArray(pathParams) ? pathParams : [],
      Array.isArray(opParams) ? opParams : []
    ];

    for (const source of sources) {
      for (const rawParam of source) {
        const param = normalizeParameter(rawParam);
        if (!param) continue;
        const key = `${String(param.in).toLowerCase()}::${String(param.name).toLowerCase()}`;
        if (indexByKey.has(key)) {
          merged[indexByKey.get(key)] = param;
        } else {
          indexByKey.set(key, merged.length);
          merged.push(param);
        }
      }
    }

    return merged;
  }

  function normalizeOperations(spec) {
    const result = [];
    const paths = spec?.paths && typeof spec.paths === "object" ? spec.paths : {};
    for (const [pathKey, pathItem] of Object.entries(paths)) {
      if (!pathItem || typeof pathItem !== "object") continue;
      const shared = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
      for (const method of HTTP_METHODS) {
        const op = pathItem[method];
        if (!op || typeof op !== "object") continue;
        const mergedParams = mergeOperationParameters(shared, op.parameters);

        let requestBody = op.requestBody || null;
        if (!requestBody && typeof spec?.swagger === "string") {
          requestBody = buildRequestBodyFromSwagger2(op, mergedParams);
        }

        result.push({
          id: `${method}::${pathKey}`,
          method,
          path: pathKey,
          summary: op.summary || op.operationId || "No summary",
          tags: Array.isArray(op.tags) ? op.tags.filter((tag) => typeof tag === "string" && tag.trim()).map((tag) => tag.trim()) : [],
          description: op.description || "",
          parameters: mergedParams,
          requestBody,
          responses: typeof op.responses === "object" && op.responses ? op.responses : {}
        });
      }
    }
    return result;
  }

  function groupOperationsByTag(spec, operations) {
    const groupsByName = new Map();
    const orderedGroups = [];

    function ensureGroup(name, description = "") {
      if (groupsByName.has(name)) return groupsByName.get(name);
      const group = { name, description: String(description || ""), operations: [] };
      groupsByName.set(name, group);
      orderedGroups.push(group);
      return group;
    }

    const declaredTags = Array.isArray(spec?.tags) ? spec.tags : [];
    for (const tag of declaredTags) {
      if (!tag || typeof tag !== "object") continue;
      const name = typeof tag.name === "string" ? tag.name.trim() : "";
      if (!name) continue;
      ensureGroup(name, tag.description || "");
    }

    for (const op of operations) {
      const tagNames = Array.isArray(op.tags) && op.tags.length ? op.tags : ["default"];
      for (const tagName of tagNames) {
        ensureGroup(tagName).operations.push(op);
      }
    }

    return orderedGroups.filter((group) => group.operations.length > 0);
  }

  function stableJson(obj) {
    try { return JSON.stringify(obj, null, 2); } catch (_) { return String(obj); }
  }

  function pointerGet(obj, pointer) {
    if (!pointer || pointer === "#") return obj;
    if (!pointer.startsWith("#/")) return null;
    const parts = pointer
      .slice(2)
      .split("/")
      .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
    let cur = obj;
    for (const part of parts) {
      if (!cur || typeof cur !== "object" || !(part in cur)) return null;
      cur = cur[part];
    }
    return cur;
  }

  function resolveSchemaRef(schema, refTrail = new Set()) {
    if (!schema || typeof schema !== "object") return schema;

    let resolved = schema;
    if (typeof resolved.$ref === "string") {
      if (!activeSpec || !resolved.$ref.startsWith("#/")) return resolved;
      if (refTrail.has(resolved.$ref)) return resolved;

      const nextTrail = new Set(refTrail);
      nextTrail.add(resolved.$ref);

      const target = pointerGet(activeSpec, resolved.$ref);
      if (!target || typeof target !== "object") return resolved;

      // Keep sibling fields from the current schema while preferring explicit overrides.
      const merged = { ...target, ...resolved };
      delete merged.$ref;
      resolved = resolveSchemaRef(merged, nextTrail);
    }

    if (Array.isArray(resolved.allOf) && resolved.allOf.length) {
      const composed = {
        type: "object",
        properties: {},
        required: []
      };

      for (const part of resolved.allOf) {
        const r = resolveSchemaRef(part, refTrail);
        if (!r || typeof r !== "object") continue;

        if (r.type && !composed.type) composed.type = r.type;
        if (r.description && !composed.description) composed.description = r.description;
        if (r.example !== undefined && composed.example === undefined) composed.example = r.example;

        if (r.properties && typeof r.properties === "object") {
          composed.properties = { ...composed.properties, ...r.properties };
        }

        if (Array.isArray(r.required)) {
          composed.required.push(...r.required);
        }

        if (r.items && !composed.items) composed.items = r.items;
      }

      const withoutAllOf = { ...resolved };
      delete withoutAllOf.allOf;

      const merged = {
        ...composed,
        ...withoutAllOf,
        properties: {
          ...(composed.properties || {}),
          ...((withoutAllOf.properties && typeof withoutAllOf.properties === "object") ? withoutAllOf.properties : {})
        },
        required: Array.from(new Set([...(composed.required || []), ...(Array.isArray(withoutAllOf.required) ? withoutAllOf.required : [])]))
      };

      resolved = merged;
    }

    return resolved;
  }

  function hasExpandableSchema(schema) {
    const s = resolveSchemaRef(schema);
    if (!s || typeof s !== "object") return false;
    if (s.type === "object" && s.properties && Object.keys(s.properties).length) return true;
    if (s.type === "array" && s.items) return true;
    if (s.properties && Object.keys(s.properties).length) return true;
    if (s.items) return true;
    return false;
  }

  function resolveSchemaForCopy(schema, depth = 0, refTrail = new Set()) {
    if (!schema || typeof schema !== "object") return schema;
    if (depth > 10) return schema;

    const resolved = resolveSchemaRef(schema, refTrail);
    if (!resolved || typeof resolved !== "object") return resolved;

    const out = Array.isArray(resolved) ? [] : {};
    for (const [key, value] of Object.entries(resolved)) {
      if (key === "properties" && value && typeof value === "object") {
        const nextProps = {};
        for (const [propName, propSchema] of Object.entries(value)) {
          nextProps[propName] = resolveSchemaForCopy(propSchema, depth + 1, refTrail);
        }
        out[key] = nextProps;
        continue;
      }

      if (key === "items") {
        out[key] = resolveSchemaForCopy(value, depth + 1, refTrail);
        continue;
      }

      if (Array.isArray(value)) {
        out[key] = value.map((v) => (v && typeof v === "object" ? resolveSchemaForCopy(v, depth + 1, refTrail) : v));
        continue;
      }

      out[key] = value;
    }

    return out;
  }

  function schemaType(schema) {
    const s = resolveSchemaRef(schema);
    if (!s || typeof s !== "object") return "any";

    if (s.type) {
      if (s.type === "array") {
        const itemType = schemaType(s.items);
        const clean = String(itemType || "any").replace(/^\[|\]$/g, "");
        return `[${clean || "any"}]`;
      }
      return String(s.type);
    }

    if (s.properties && typeof s.properties === "object") return "object";
    if (s.items) {
      const itemType = schemaType(s.items);
      const clean = String(itemType || "any").replace(/^\[|\]$/g, "");
      return `[${clean || "any"}]`;
    }
    if (Array.isArray(s.enum)) return "enum";
    return "any";
  }

  function schemaExample(schema) {
    const s = resolveSchemaRef(schema);
    if (!s || typeof s !== "object") return null;
    if (s.example !== undefined) return s.example;
    if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
    if (s.type === "string") return "";
    if (s.type === "number" || s.type === "integer") return 0;
    if (s.type === "boolean") return false;
    if (s.type === "array") return [];
    if (s.type === "object" || (s.properties && typeof s.properties === "object")) return {};
    return null;
  }

  function buildExampleFromSchema(schema, depth = 0) {
    if (depth > 5) return null;
    const s = resolveSchemaRef(schema);
    if (!s || typeof s !== "object") return null;

    if (s.example !== undefined) return s.example;
    if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];

    if (s.type === "object" || (s.properties && typeof s.properties === "object")) {
      const props = s.properties && typeof s.properties === "object" ? s.properties : {};
      const out = {};
      for (const [key, child] of Object.entries(props)) {
        const childExample = buildExampleFromSchema(child, depth + 1);
        out[key] = childExample !== null ? childExample : "";
      }
      return out;
    }

    if (s.type === "array" || s.items) {
      const item = buildExampleFromSchema(s.items, depth + 1);
      return [item !== null ? item : ""];
    }

    if (s.type === "string") return "";
    if (s.type === "number" || s.type === "integer") return 0;
    if (s.type === "boolean") return false;
    return null;
  }

  function schemaChildren(schema, basePath = "") {
    const s = resolveSchemaRef(schema);
    if (!s || typeof s !== "object") return [];

    if ((s.type === "object" || (s.properties && typeof s.properties === "object")) && s.properties) {
      const required = new Set(Array.isArray(s.required) ? s.required : []);
      return Object.entries(s.properties).map(([name, child]) => ({
        name,
        schema: child,
        required: required.has(name),
        path: basePath ? `${basePath}.${name}` : name
      }));
    }

    if (s.type === "array" || s.items) {
      const itemSchema = resolveSchemaRef(s.items || {});
      if (!itemSchema || typeof itemSchema !== "object") return [];

      const itemHasChildren =
        (itemSchema.type === "object" && itemSchema.properties && Object.keys(itemSchema.properties).length > 0) ||
        (itemSchema.properties && typeof itemSchema.properties === "object" && Object.keys(itemSchema.properties).length > 0) ||
        itemSchema.type === "array" ||
        !!itemSchema.items;

      if (!itemHasChildren) return [];

      // For arrays, render child structure directly under the array field,
      // instead of introducing a synthetic "list/items" property row.
      return schemaChildren(itemSchema, `${basePath}[]`);
    }

    return [];
  }

  function schemaDisplayName(schema, fallback = "schema") {
    if (schema && typeof schema === "object" && typeof schema.$ref === "string") {
      const parts = schema.$ref.split("/");
      const last = parts[parts.length - 1];
      if (last) return last;
    }
    return fallback;
  }

  function toInlineValue(value) {
    if (value === null) return "null";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return `[${value.length} items]`;
    if (typeof value === "object") return "{...}";
    return String(value);
  }

  function registerSchemaNode(data) {
    const id = `schema-node-${++schemaNodeSeq}`;
    schemaNodeStore.set(id, data);
    return id;
  }

  function registerSchemaCopyPayload(payloadText) {
    const id = `schema-copy-${++schemaCopySeq}`;
    schemaCopyStore.set(id, payloadText);
    return id;
  }

  function registerValueTreeNode(data) {
    const id = `value-node-${++valueTreeSeq}`;
    valueTreeStore.set(id, data);
    return id;
  }

  function renderSchemaNode(entry, depth) {
    const nodeSchema = resolveSchemaRef(entry.schema);
    const children = schemaChildren(nodeSchema, entry.path || "");
    const expandable = children.length > 0;
    const expanded = depth === 0 || !expandable;
    const typeText = schemaType(nodeSchema);
    const rawDesc = String(nodeSchema?.description || "").trim();
    const normalizedDesc = rawDesc.replace(/\s+/g, " ").trim();
    const hasDesc = !!normalizedDesc;
    const longDesc = hasDesc && (normalizedDesc.length > 80 || /\r?\n/.test(rawDesc));
    const shortDesc = hasDesc
      ? (longDesc ? `${normalizedDesc.slice(0, 80).trimEnd()}...` : normalizedDesc)
      : "";

    const nodeId = registerSchemaNode({ schema: nodeSchema, depth: depth + 1, path: entry.path || "" });

    const toggle = expandable
      ? `<button class="schema-toggle" data-action="toggle-schema" title="Toggle" aria-label="Toggle">${expanded ? "▾" : "▸"}</button>`
      : `<span class="schema-toggle-spacer"></span>`;

    const requiredTag = entry.required ? '<span class="schema-required">required</span>' : "";
    const initialChildren = expanded
      ? `${children.map((child) => renderSchemaNode(child, depth + 1)).join("")}`
      : "";
    const inlineDescHtml = hasDesc
      ? `<span class="schema-inline-desc ${longDesc ? "is-collapsible" : ""}" ${longDesc ? 'data-action="toggle-field-desc"' : ""} ${longDesc ? `title="${escapeHtml(normalizedDesc)}"` : ""}>${escapeHtml(shortDesc)}</span>`
      : "";
    const inlineToggleHtml = longDesc
      ? '<button class="schema-inline-desc-toggle" data-action="toggle-field-desc">[expand ▼]</button>'
      : "";
    const fullDescHtml = longDesc
      ? `<div class="schema-description-full">${formatDescription(rawDesc, "")}</div>`
      : "";

    return `
      <div class="schema-node ${expanded ? "expanded" : ""} ${longDesc ? "desc-collapsed" : ""}" data-node-id="${nodeId}" data-key-path="${escapeHtml(entry.path || "")}" style="--schema-depth:${depth}">
        <div class="schema-row" data-action="select-schema-key">
          ${toggle}
          <span class="schema-key">${escapeHtml(entry.name)}</span>
          <span class="schema-sep">:</span>
          <span class="schema-type">${escapeHtml(typeText)}</span>
          ${requiredTag}
          ${inlineDescHtml}
          ${inlineToggleHtml}
        </div>
        ${fullDescHtml}
        <div class="schema-children" data-rendered="${expanded ? "true" : "false"}">${initialChildren}</div>
      </div>
    `;
  }

  function renderSchema(schema, depth = 0) {
    const resolved = resolveSchemaRef(schema);
    const rootChildren = schemaChildren(resolved, "");
    if (rootChildren.length) {
      return rootChildren.map((child) => renderSchemaNode(child, depth)).join("");
    }
    return renderSchemaNode({ name: "value", schema: resolved, required: true, path: "" }, depth);
  }

  function renderSchemaPanel(schema, options = {}) {
    if (!schema || typeof schema !== "object") {
      return '<div class="muted">No model schema.</div>';
    }

    const title = String(options.title || "").trim();
    const description = String(options.description || "").trim();
    const hasLongDescription = description.length > 260;
    const descId = `schema-desc-${++schemaDescSeq}`;
    const titleHtml = title ? `<div class="schema-head-title">${escapeHtml(title)}</div>` : "";
    const descriptionHtml = description
      ? `
        <div class="schema-head-desc ${hasLongDescription ? "is-collapsed" : ""}" data-schema-desc-id="${descId}">
          <div class="schema-head-desc-content">${formatDescription(description, "")}</div>
          ${hasLongDescription ? `<button class="schema-desc-toggle" data-action="toggle-schema-desc" data-schema-desc-id="${descId}">Show description</button>` : ""}
        </div>
      `
      : "";

    return `
      <div class="schema-panel" data-schema-panel="true">
        <div class="schema-panel-head">
          <span class="schema-panel-title">Schema</span>
        </div>
        ${titleHtml}
        ${descriptionHtml}
        <div class="schema-tree">${renderSchema(schema, 0)}</div>
      </div>
    `;
  }

  function renderSchemaChildrenForNode(nodeEl) {
    if (!nodeEl) return;
    const nodeId = nodeEl.dataset.nodeId;
    if (!nodeId) return;

    const container = nodeEl.querySelector(":scope > .schema-children");
    if (!container || container.dataset.rendered === "true") return;

    const nodeData = schemaNodeStore.get(nodeId);
    if (!nodeData) return;

    const children = schemaChildren(nodeData.schema, nodeData.path || "");
    container.innerHTML = `${children.map((child) => renderSchemaNode(child, nodeData.depth)).join("")}`;
    container.dataset.rendered = "true";
  }

  function jsonTokenPrimitive(value) {
    if (value === null) return '<span class="json-null">null</span>';
    if (typeof value === "string") return `<span class="json-string">${escapeHtml(JSON.stringify(value))}</span>`;
    if (typeof value === "number") return `<span class="json-number">${escapeHtml(String(value))}</span>`;
    if (typeof value === "boolean") return `<span class="json-boolean">${escapeHtml(String(value))}</span>`;
    return `<span class="json-string">${escapeHtml(JSON.stringify(String(value)))}</span>`;
  }

  function renderExampleJsonRows(value, depth = 0, path = "") {
    const indent = "  ".repeat(depth);

    function withComma(line) {
      return `${line}<span class="json-punc">,</span>`;
    }

    if (Array.isArray(value)) {
      const lines = [`${indent}<span class="json-brace">[</span>`];
      value.forEach((item, index) => {
        const itemLines = renderExampleJsonRows(item, depth + 1, path ? `${path}[]` : "[]");
        if (!itemLines.length) return;
        if (index < value.length - 1) {
          itemLines[itemLines.length - 1] = withComma(itemLines[itemLines.length - 1]);
        }
        lines.push(...itemLines);
      });
      lines.push(`${indent}<span class="json-brace">]</span>`);
      return lines;
    }

    if (value && typeof value === "object") {
      const lines = [`${indent}<span class="json-brace">{</span>`];
      const entries = Object.entries(value);
      entries.forEach(([key, child], index) => {
        const childPath = path ? `${path}.${key}` : key;
        const keyPrefix = `${"  ".repeat(depth + 1)}<span class="json-key" data-key-path="${escapeHtml(childPath)}">${escapeHtml(JSON.stringify(key))}</span><span class="json-punc">:</span> `;

        if (child && typeof child === "object") {
          const childLines = renderExampleJsonRows(child, depth + 1, childPath);
          if (childLines.length) {
            childLines[0] = `${keyPrefix}${childLines[0].trimStart()}`;
            if (index < entries.length - 1) {
              childLines[childLines.length - 1] = withComma(childLines[childLines.length - 1]);
            }
            lines.push(...childLines);
          }
        } else {
          const primitiveLine = `${keyPrefix}${jsonTokenPrimitive(child)}`;
          lines.push(index < entries.length - 1 ? withComma(primitiveLine) : primitiveLine);
        }
      });
      lines.push(`${indent}<span class="json-brace">}</span>`);
      return lines;
    }

    return [`${indent}${jsonTokenPrimitive(value)}`];
  }

  function escapeAttrValue(value) {
    const s = String(value || "");
    return s.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  }

  function renderExampleJsonPanel(exampleValue) {
    const normalized = normalizeExampleValue(exampleValue);
    const rows = renderExampleJsonRows(normalized, 0, "");
    const copyId = registerSchemaCopyPayload(stableJson(normalized));
    return `
      <div class="example-panel" data-example-panel="true">
        <div class="schema-panel-head">
          <span class="schema-panel-title">Example JSON</span>
          <button class="copy-btn icon-btn-square" data-action="copy-schema" data-schema-copy-id="${copyId}" title="Copy JSON" aria-label="Copy JSON">${ICON_COPY}${ICON_CHECK}</button>
        </div>
        <pre class="example-json-pre">${rows.join("\n")}</pre>
      </div>
    `;
  }

  function renderExampleSwitcher(exampleEntries) {
    if (!Array.isArray(exampleEntries) || exampleEntries.length <= 1) return "";
    const options = exampleEntries.map((entry, index) => `
      <option value="${index}" ${index === 0 ? "selected" : ""}>${escapeHtml(entry.label)}</option>
    `).join("");
    return `
      <div class="example-switcher">
        <label class="example-switcher-label">Examples</label>
        <select class="example-switcher-select" data-action="set-example">
          ${options}
        </select>
      </div>
    `;
  }

  function renderExampleViews(exampleEntries) {
    if (!Array.isArray(exampleEntries) || !exampleEntries.length) {
      return '<div class="muted">No example.</div>';
    }

    const views = exampleEntries.map((entry, index) => `
      <div class="example-view ${index === 0 ? "is-active" : ""}" data-example-view-index="${index}">
        ${renderExampleJsonPanel(entry.value)}
      </div>
    `).join("");

    return `
      ${renderExampleSwitcher(exampleEntries)}
      <div class="example-views">${views}</div>
    `;
  }

  function renderSplitMediaView(schemaHtml, exampleHtml) {
    return `
      <div class="split-media" data-split-mode="split" style="--split-left-width:50%">
        <div class="split-media-toolbar">
          <div class="split-toggle-group">
            <button class="icon-btn is-active" data-action="set-split-mode" data-mode="split">Split</button>
            <button class="icon-btn" data-action="set-split-mode" data-mode="schema">Schema only</button>
            <button class="icon-btn" data-action="set-split-mode" data-mode="example">Example only</button>
          </div>
        </div>
        <div class="split-media-body">
          <section class="split-pane split-pane-schema">${schemaHtml}</section>
          <div class="split-resizer" data-action="resize-split" role="separator" aria-orientation="vertical"></div>
          <section class="split-pane split-pane-example">${exampleHtml}</section>
        </div>
        <div class="split-media-vresizer" data-action="resize-split-v" role="separator" aria-orientation="horizontal" title="Drag to resize height"></div>
      </div>
    `;
  }

  function highlightExampleByPath(scopeEl, keyPath) {
    if (!scopeEl || !keyPath) return;
    const root = scopeEl.closest(".split-media") || scopeEl;
    root.querySelectorAll(".json-key.is-highlight").forEach((el) => el.classList.remove("is-highlight"));
    const activeExampleView = root.querySelector(".example-view.is-active");
    const target = (activeExampleView || root).querySelector(`.json-key[data-key-path="${escapeAttrValue(keyPath)}"]`)
      || root.querySelector(`.json-key[data-key-path="${escapeAttrValue(keyPath)}"]`);
    if (target) {
      target.classList.add("is-highlight");
      target.scrollIntoView({ block: "nearest" });
    }
  }

  function startSplitResize(resizerEl, startEvent) {
    const split = resizerEl.closest(".split-media");
    const body = split?.querySelector(".split-media-body");
    if (!split || !body) return;
    const rect = body.getBoundingClientRect();
    activeMediaResize = { split, body, rect };
    document.body.classList.add("is-resizing-panels");
    startEvent.preventDefault();
  }

  function startSplitVResize(resizerEl, startEvent) {
    const split = resizerEl.closest(".split-media");
    const body = split?.querySelector(".split-media-body");
    if (!split || !body) return;
    const startY = startEvent.clientY;
    const startHeight = body.getBoundingClientRect().height;
    activeMediaVResize = { split, resizerEl, startY, startHeight };
    resizerEl.classList.add("is-dragging");
    document.body.classList.add("is-resizing-split-v");
    startEvent.preventDefault();
  }

  function onGlobalMouseMove(event) {
    if (activeMediaResize) {
      const { split, rect } = activeMediaResize;
      const raw = ((event.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(80, Math.max(20, raw));
      split.style.setProperty("--split-left-width", `${clamped}%`);
    }
    if (activeMediaVResize) {
      const { split, startY, startHeight } = activeMediaVResize;
      const delta = event.clientY - startY;
      const newHeight = Math.max(120, Math.min(900, startHeight + delta));
      split.style.setProperty("--split-body-height", `${newHeight}px`);
    }
  }

  function onGlobalMouseUp() {
    if (activeMediaResize) {
      activeMediaResize = null;
      document.body.classList.remove("is-resizing-panels");
    }
    if (activeMediaVResize) {
      activeMediaVResize.resizerEl.classList.remove("is-dragging");
      activeMediaVResize = null;
      document.body.classList.remove("is-resizing-split-v");
    }
  }

  function onGlobalMouseDown(event) {
    const resizer = event.target.closest('[data-action="resize-split"]');
    if (resizer) {
      startSplitResize(resizer, event);
      return;
    }
    const vresizer = event.target.closest('[data-action="resize-split-v"]');
    if (vresizer) startSplitVResize(vresizer, event);
  }

  function normalizeExampleValue(value) {
    if (typeof value !== "string") return value;
    const t = value.trim();
    if (!t) return value;
    if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
      try {
        return JSON.parse(t);
      } catch (_) {
        return value;
      }
    }
    return value;
  }

  function valueType(value) {
    if (value === null) return "null";
    if (Array.isArray(value)) {
      const first = value[0];
      return `array<${valueType(first)}>`;
    }
    return typeof value;
  }

  function valueChildren(value) {
    if (Array.isArray(value)) {
      if (!value.length) return [];
      return [{ name: "items", value: value[0] }];
    }
    if (value && typeof value === "object") {
      return Object.entries(value).map(([name, child]) => ({ name, value: child }));
    }
    return [];
  }

  function renderTreeNode(entry, depth) {
    const children = valueChildren(entry.value);
    const expandable = children.length > 0;
    const expanded = depth === 0;
    const typeText = valueType(entry.value);
    const nodeId = registerValueTreeNode({ value: entry.value, depth: depth + 1 });

    const toggle = expandable
      ? `<button class="schema-toggle" data-action="toggle-tree" title="Toggle" aria-label="Toggle">${expanded ? "▾" : "▸"}</button>`
      : `<span class="schema-toggle-spacer"></span>`;

    const scalarExample = expandable ? "" : `<div class="schema-example"><span class="schema-example-label">example</span> <code class="inline-code">${escapeHtml(toInlineValue(entry.value))}</code></div>`;
    const initialChildren = expanded
      ? children.map((child) => renderTreeNode(child, depth + 1)).join("")
      : "";

    return `
      <div class="schema-node ${expanded ? "expanded" : ""}" data-value-node-id="${nodeId}" style="--schema-depth:${depth}">
        <div class="schema-row">
          ${toggle}
          <span class="schema-key">${escapeHtml(entry.name)}</span>
          <span class="schema-sep">:</span>
          <span class="schema-type">${escapeHtml(typeText)}</span>
        </div>
        ${scalarExample}
        <div class="schema-children" data-rendered="${expanded ? "true" : "false"}">${initialChildren}</div>
      </div>
    `;
  }

  function renderTree(data, depth = 0) {
    return renderTreeNode({ name: "root", value: data }, depth);
  }

  function renderTreePanel(title, data) {
    const normalized = normalizeExampleValue(data);
    const copyId = registerSchemaCopyPayload(stableJson(normalized));
    return `
      <div class="schema-panel" data-tree-panel="true">
        <div class="schema-panel-head">
          <span class="schema-panel-title">${escapeHtml(title)}</span>
          <button class="copy-btn icon-btn-square" data-action="copy-schema" data-schema-copy-id="${copyId}" title="Copy JSON" aria-label="Copy JSON">${ICON_COPY}${ICON_CHECK}</button>
        </div>
        <div class="schema-tree">${renderTree(normalized, 0)}</div>
      </div>
    `;
  }

  function renderTreeChildrenForNode(nodeEl) {
    if (!nodeEl) return;
    const nodeId = nodeEl.dataset.valueNodeId;
    if (!nodeId) return;

    const container = nodeEl.querySelector(":scope > .schema-children");
    if (!container || container.dataset.rendered === "true") return;

    const nodeData = valueTreeStore.get(nodeId);
    if (!nodeData) return;

    const children = valueChildren(nodeData.value);
    container.innerHTML = children.map((child) => renderTreeNode(child, nodeData.depth)).join("");
    container.dataset.rendered = "true";
  }

  function getMediaExamples(media) {
    if (!media || typeof media !== "object") return [];

    if (media.examples && typeof media.examples === "object") {
      const entries = Object.entries(media.examples).reduce((acc, [exampleKey, exampleDef]) => {
        let value;
        let label = "";

        if (exampleDef && typeof exampleDef === "object" && !Array.isArray(exampleDef)) {
          if (exampleDef.value !== undefined) {
            value = exampleDef.value;
          } else if (exampleDef.externalValue !== undefined) {
            value = `External example: ${String(exampleDef.externalValue)}`;
          } else {
            value = exampleDef;
          }

          const summary = typeof exampleDef.summary === "string" ? exampleDef.summary.trim() : "";
          const description = typeof exampleDef.description === "string" ? exampleDef.description.trim() : "";
          label = summary || description || String(exampleKey || "").trim();
        } else {
          value = exampleDef;
          label = String(exampleKey || "").trim();
        }

        if (value === undefined) return acc;
        acc.push({
          key: String(exampleKey || "").trim() || `example-${acc.length + 1}`,
          label: label || `Example ${acc.length + 1}`,
          value
        });
        return acc;
      }, []);

      if (entries.length) return entries;
    }

    if (media.example !== undefined) {
      return [{ key: "example", label: "Example", value: media.example }];
    }

    if (media.schema && typeof media.schema === "object" && media.schema.example !== undefined) {
      return [{ key: "schema-example", label: "Schema example", value: media.schema.example }];
    }

    return [];
  }

  function getMediaExample(media) {
    if (!media || typeof media !== "object") return null;
    const examples = getMediaExamples(media);
    return examples.length ? examples[0].value : null;
  }

  function renderMediaContent(content, emptyText, panelContext = {}) {
    const entries = Object.entries(content || {});
    if (!entries.length) return `<div class="muted">${escapeHtml(emptyText)}</div>`;

    const views = entries.map(([mediaType, media], index) => {
      let mediaExamples = getMediaExamples(media);
      if (!mediaExamples.length && media?.schema) {
        const inferred = buildExampleFromSchema(media.schema);
        if (inferred !== null) {
          mediaExamples = [{ key: "inferred-example", label: "Generated example", value: inferred }];
        }
      }
      const exampleValue = mediaExamples.length ? mediaExamples[0].value : null;

      const schemaTitle = String(panelContext.title || media?.schema?.title || "").trim();
      const schemaDescription = String(media?.schema?.description || panelContext.description || "").trim();
      const schemaUsable = !!media?.schema && hasExpandableSchema(media.schema);
      const schemaHtml = schemaUsable
        ? renderSchemaPanel(media.schema, {
          title: schemaTitle,
          description: schemaDescription
        })
        : (exampleValue !== null ? renderTreePanel("Inferred Model", exampleValue) : '<div class="muted">No model schema.</div>');
      const exampleHtml = renderExampleViews(mediaExamples);
      const splitHtml = renderSplitMediaView(schemaHtml, exampleHtml);

      return `
        <div class="media-view ${index === 0 ? "is-active" : ""}" data-media-view-index="${index}">
          <div class="media-type">${escapeHtml(mediaType)}</div>
          ${splitHtml}
        </div>
      `;
    });

    if (entries.length === 1) {
      return `
        <div class="media-block">
          ${views[0]}
        </div>
      `;
    }

    const selectorButtons = entries.map(([mediaType], index) => `
      <button
        class="media-type-btn ${index === 0 ? "is-active" : ""}"
        type="button"
        data-action="set-media-type"
        data-media-index="${index}"
        title="${escapeHtml(mediaType)}"
      >${escapeHtml(mediaType)}</button>
    `).join("");

    return `
      <div class="media-block media-block-selector">
        <div class="media-type-switch" role="tablist" aria-label="Content types">
          ${selectorButtons}
        </div>
        ${views.join("")}
      </div>
    `;
  }

  // ── Endpoint row ─────────────────────────────────────────────────────────

  // ── Deep search index ────────────────────────────────────────────────────

  function collectSchemaSearchTokens(schema, tokens, depth = 0) {
    if (!schema || typeof schema !== "object") return;
    if (depth > SEARCH_SCHEMA_MAX_DEPTH || tokens.size > SEARCH_MAX_TOKENS) return;

    if (typeof schema.$ref === "string") {
      const tail = schema.$ref.split("/").pop();
      if (tail) tokens.add(String(tail).toLowerCase());
    }

    const s = resolveSchemaRef(schema);
    if (!s || typeof s !== "object") return;

    if (typeof s.title === "string" && s.title) tokens.add(s.title.toLowerCase());
    if (Array.isArray(s.enum)) {
      for (const value of s.enum) {
        if (value !== null && value !== undefined) tokens.add(String(value).toLowerCase());
      }
    }

    if (s.properties && typeof s.properties === "object") {
      for (const [name, child] of Object.entries(s.properties)) {
        tokens.add(String(name).toLowerCase());
        collectSchemaSearchTokens(child, tokens, depth + 1);
      }
    }

    if (s.items) collectSchemaSearchTokens(s.items, tokens, depth + 1);

    for (const key of ["oneOf", "anyOf"]) {
      if (!Array.isArray(s[key])) continue;
      for (const part of s[key]) collectSchemaSearchTokens(part, tokens, depth + 1);
    }
  }

  function collectMediaSearchTokens(content, tokens) {
    if (!content || typeof content !== "object") return;
    for (const media of Object.values(content)) {
      if (media && typeof media === "object") collectSchemaSearchTokens(media.schema, tokens);
    }
  }

  function buildEndpointSearchText(op) {
    const tokens = new Set();
    const push = (value) => {
      const text = typeof value === "string" ? value.trim() : "";
      if (text) tokens.add(text.slice(0, 300).toLowerCase());
    };

    push(op.method);
    push(op.path);
    push(op.summary);
    (op.tags || []).forEach(push);
    push(op.description);

    for (const param of op.parameters || []) {
      if (!param || typeof param !== "object") continue;
      push(param.name);
      push(param.description);
      push(param.schema?.type || param.type);
      collectSchemaSearchTokens(param.schema, tokens);
    }

    if (op.requestBody && typeof op.requestBody === "object") {
      push(op.requestBody.description);
      collectMediaSearchTokens(op.requestBody.content, tokens);
    }

    for (const [code, rawResponse] of Object.entries(op.responses || {})) {
      push(code);
      const response = rawResponse && typeof rawResponse.$ref === "string"
        ? pointerGet(activeSpec, rawResponse.$ref) || rawResponse
        : rawResponse;
      if (!response || typeof response !== "object") continue;
      push(response.description);
      collectMediaSearchTokens(response.content, tokens);
      if (response.schema) collectSchemaSearchTokens(response.schema, tokens);
    }

    return Array.from(tokens).join(" ").slice(0, SEARCH_TEXT_MAX_CHARS);
  }

  function createEndpointRow(op) {
    const row = document.createElement("div");
    row.className = `endpoint-row endpoint-method-${op.method}`;
    row.dataset.endpointId = op.id;
    row.dataset.searchText = buildEndpointSearchText(op);

    row.innerHTML = `
      <div class="endpoint-summary" data-action="toggle">
        <span class="method-pill method-${op.method}">${escapeHtml(op.method.toUpperCase())}</span>
        <span class="endpoint-path">${escapeHtml(op.path)}</span>
        <span class="endpoint-summary-text" title="${escapeHtml(op.summary)}">${escapeHtml(op.summary)}</span>
        <button class="copy-btn icon-btn-square js-copy-path" title="Copy path" aria-label="Copy path">${ICON_COPY}${ICON_CHECK}</button>
        <span class="endpoint-chevron">›</span>
      </div>
      <div class="endpoint-details" data-details-container="true"></div>
    `;

    row.querySelector(".js-copy-path").addEventListener("click", (e) => {
      e.stopPropagation();
      copyText(op.path, e.currentTarget);
    });

    return row;
  }

  // ── Detail sections ──────────────────────────────────────────────────────

  function paramInlineValue(value) {
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  }

  function paramRow(p) {
    const schema = resolveSchemaRef(p.schema && typeof p.schema === "object" ? p.schema : null);
    const type = schemaType(p.schema || (p.type ? { type: p.type, items: p.items } : null));

    const badges = [`<span class="param-badge is-in">${escapeHtml(p.in)}</span>`];
    if (type && type !== "any") badges.push(`<span class="param-badge is-type">${escapeHtml(type)}</span>`);
    badges.push(p.required
      ? '<span class="param-badge is-required">required</span>'
      : '<span class="param-badge is-optional">optional</span>');

    const enumValues = Array.isArray(schema?.enum) ? schema.enum : (Array.isArray(p.enum) ? p.enum : []);
    if (enumValues.length) {
      const shown = enumValues.slice(0, 4).map((v) => paramInlineValue(v)).join(" | ");
      const suffix = enumValues.length > 4 ? " | …" : "";
      badges.push(`<span class="param-badge" title="${escapeHtml(enumValues.map((v) => paramInlineValue(v)).join(", "))}">enum: ${escapeHtml(shown)}${suffix}</span>`);
    }

    const defaultValue = schema?.default !== undefined ? schema.default : p.default;
    if (defaultValue !== undefined) {
      badges.push(`<span class="param-badge">default: ${escapeHtml(paramInlineValue(defaultValue))}</span>`);
    }

    if (p.deprecated) badges.push('<span class="param-badge is-deprecated">deprecated</span>');

    const description = p.description
      ? `<div class="param-desc">${formatDescriptionCompact(p.description, "")}</div>`
      : "";

    return `
      <div class="param-row">
        <div class="param-head">
          <span class="param-name">${escapeHtml(p.name)}</span>
          ${badges.join("")}
        </div>
        ${description}
      </div>`;
  }

  function paramsSection(params) {
    const safeParams = (Array.isArray(params) ? params : []).filter((p) => {
      if (!p || typeof p !== "object") return false;
      const name = typeof p.name === "string" ? p.name.trim() : "";
      const where = typeof p.in === "string" ? p.in.trim() : "";
      return !!name && !!where;
    });

    if (!safeParams.length) return '<div class="muted">No parameters.</div>';
    return `<div class="param-list">${safeParams.map(paramRow).join("")}</div>`;
  }

  function requestBodySection(requestBody) {
    if (!requestBody) return '<div class="muted">No request body.</div>';

    const summaryParts = [];
    if (requestBody.required) summaryParts.push('<div class="muted"><strong>Required:</strong> true</div>');

    return `
      <div class="request-body-wrap">
        ${summaryParts.join("")}
        ${renderMediaContent(requestBody.content, "No request media content.", {
          title: requestBody.description || "",
          description: ""
        })}
      </div>`;
  }

  function tableForResponses(responses) {
    const entries = Object.entries(responses || {});
    if (!entries.length) return '<div class="muted">No responses.</div>';
    return entries.map(([code, response]) => `
      <div class="response-block">
        <div class="response-head">${escapeHtml(code)}</div>
        ${formatDescription(response?.description, "No response description.")}
        ${renderMediaContent(response?.content, "No response media content.")}
      </div>
    `).join("");
  }

  function renderDetails(row) {
    const op = endpointStore.get(row.dataset.endpointId);
    if (!op) return;
    const container = row.querySelector('[data-details-container="true"]');
    if (!container || container.dataset.rendered === "true") return;

    container.innerHTML = `
      <div class="detail-title">Description</div>
      ${formatDescription(op.description || op.summary || "No description.")}
      <div class="detail-title">Parameters</div>
      ${paramsSection(op.parameters)}
      <div class="detail-title">Request Body</div>
      ${requestBodySection(op.requestBody)}
      <div class="detail-title">Responses</div>
      ${tableForResponses(op.responses)}
    `;

    container.dataset.rendered = "true";
  }

  // ── Docs render ──────────────────────────────────────────────────────────

  function renderDocsError(msg) {
    const root = document.getElementById("docs-root");
    if (root) root.innerHTML = `<div class="empty-state">${escapeHtml(msg)}</div>`;
    setStatus(msg, true);
  }

  function renderDocs(spec) {
    const root = document.getElementById("docs-root");
    if (!root) return;

    const info = spec?.info && typeof spec.info === "object" ? spec.info : {};
    const operations = normalizeOperations(spec);
    const serverText = getServerText(spec);

    root.innerHTML = `
      <div class="docs-header">
        <div>
          <h2 class="docs-title">${escapeHtml(info.title || "API Documentation")}</h2>
          <div class="docs-description">${formatDescription(info.description || "Lightweight OpenAPI viewer")}</div>
          ${serverText ? `<div class="docs-subtitle">Server: ${escapeHtml(serverText)}</div>` : ""}
        </div>
      </div>
      <div class="docs-search-sentinel" aria-hidden="true"></div>
      <div class="docs-search-bar">
        <div class="docs-search-inner">
          <input id="api-search" class="search-input" type="text" placeholder="Search endpoints, params, schemas…" title="Shortcut: /" />
        </div>
      </div>
      <div id="endpoint-list" class="endpoint-list"></div>
    `;

    bindStickySearch();

    const list = root.querySelector("#endpoint-list");

    if (!operations.length) {
      list.innerHTML = '<div class="empty-state">No API operations found in this spec.</div>';
      setStatus("No operations found.", true);
      return;
    }

    endpointStore.clear();
    const groups = groupOperationsByTag(spec, operations);
    const listFrag = document.createDocumentFragment();

    for (const group of groups) {
      const groupEl = document.createElement("section");
      groupEl.className = "tag-group";
      groupEl.dataset.tagName = group.name;
      groupEl.innerHTML = `
        <div class="tag-group-head">
          <h3 class="tag-group-title">${escapeHtml(group.name)}</h3>
          ${group.description ? `<div class="tag-group-desc">${formatDescriptionCompact(group.description, "")}</div>` : ""}
        </div>
        <div class="tag-group-list"></div>
      `;

      const groupList = groupEl.querySelector(".tag-group-list");
      const groupFrag = document.createDocumentFragment();
      for (const op of group.operations) {
        endpointStore.set(op.id, op);
        groupFrag.appendChild(createEndpointRow(op));
      }
      groupList?.appendChild(groupFrag);
      listFrag.appendChild(groupEl);
    }
    list.appendChild(listFrag);

    setStatus(`Loaded ${operations.length} endpoint(s).`);
  }

  // ── Sticky search bar ────────────────────────────────────────────────────

  let stickySearchObserver = null;
  let stickySearchResize = null;

  function bindStickySearch() {
    if (stickySearchObserver) {
      stickySearchObserver.disconnect();
      stickySearchObserver = null;
    }
    if (stickySearchResize) {
      stickySearchResize.disconnect();
      stickySearchResize = null;
    }

    const scrollRoot = document.querySelector(".docs-panel-body");
    const sentinel = document.querySelector(".docs-search-sentinel");
    const bar = document.querySelector(".docs-search-bar");
    const inner = document.querySelector(".docs-search-inner");
    if (!scrollRoot || !sentinel || !bar || !inner) return;

    if (typeof IntersectionObserver !== "function") return;

    // Pin the resting width (in px) so the shrink-to-pill transition animates
    // across its full duration instead of snapping at the end. Measured from
    // the container (whose width is stable) rather than the inner element,
    // which is itself mid-animation while (un)sticking.
    const updateRestWidth = () => {
      const style = getComputedStyle(bar);
      const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      const w = Math.round(bar.clientWidth - padX);
      if (w > 0) inner.style.setProperty("--search-rest-max", `${w}px`);
    };
    updateRestWidth();

    if (typeof ResizeObserver === "function") {
      stickySearchResize = new ResizeObserver(updateRestWidth);
      stickySearchResize.observe(bar);
    }

    stickySearchObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          bar.classList.toggle("is-stuck", !entry.isIntersecting);
        }
      },
      { root: scrollRoot, threshold: 0 }
    );
    stickySearchObserver.observe(sentinel);
  }

  // ── Docs event delegation (bound once) ───────────────────────────────────

  function bindDocsEvents() {
    const root = document.getElementById("docs-root");
    if (!root) return;

    root.addEventListener("click", (e) => {
      const copySchemaBtn = e.target.closest('[data-action="copy-schema"]');
      if (copySchemaBtn) {
        const copyId = copySchemaBtn.dataset.schemaCopyId;
        const text = copyId ? schemaCopyStore.get(copyId) : "";
        if (text) copyText(text, copySchemaBtn);
        return;
      }

      const schemaToggle = e.target.closest('[data-action="toggle-schema"]');
      if (schemaToggle) {
        const node = schemaToggle.closest(".schema-node");
        if (!node) return;
        const expanded = node.classList.toggle("expanded");
        schemaToggle.textContent = expanded ? "▾" : "▸";
        if (expanded) renderSchemaChildrenForNode(node);
        return;
      }

      const fieldDescToggle = e.target.closest('[data-action="toggle-field-desc"]');
      if (fieldDescToggle) {
        const node = fieldDescToggle.closest(".schema-node");
        if (!node) return;
        const expanded = node.classList.toggle("desc-expanded");
        node.classList.toggle("desc-collapsed", !expanded);
        const toggleBtn = node.querySelector(".schema-inline-desc-toggle");
        if (toggleBtn) toggleBtn.textContent = expanded ? "[collapse ▲]" : "[expand ▼]";
        return;
      }

      const selectSchemaKey = e.target.closest('[data-action="select-schema-key"]');
      if (selectSchemaKey) {
        const node = selectSchemaKey.closest(".schema-node");
        const keyPath = node?.dataset.keyPath || "";
        if (keyPath) highlightExampleByPath(selectSchemaKey, keyPath);
      }

      const treeToggle = e.target.closest('[data-action="toggle-tree"]');
      if (treeToggle) {
        const node = treeToggle.closest(".schema-node");
        if (!node) return;
        const expanded = node.classList.toggle("expanded");
        treeToggle.textContent = expanded ? "▾" : "▸";
        if (expanded) renderTreeChildrenForNode(node);
        return;
      }

      const mediaTypeBtn = e.target.closest('[data-action="set-media-type"]');
      if (mediaTypeBtn) {
        const mediaBlock = mediaTypeBtn.closest(".media-block-selector");
        if (!mediaBlock) return;
        const nextIndex = String(mediaTypeBtn.dataset.mediaIndex || "0");
        mediaBlock.querySelectorAll('[data-action="set-media-type"]').forEach((btn) => {
          btn.classList.toggle("is-active", btn === mediaTypeBtn);
        });
        mediaBlock.querySelectorAll(".media-view").forEach((view) => {
          view.classList.toggle("is-active", view.dataset.mediaViewIndex === nextIndex);
        });
        return;
      }

      const splitModeBtn = e.target.closest('[data-action="set-split-mode"]');
      if (splitModeBtn) {
        const split = splitModeBtn.closest(".split-media");
        if (!split) return;
        const mode = splitModeBtn.dataset.mode || "split";
        split.dataset.splitMode = mode;
        split.querySelectorAll('[data-action="set-split-mode"]').forEach((btn) => {
          btn.classList.toggle("is-active", btn === splitModeBtn);
        });
        return;
      }

      const descToggle = e.target.closest('[data-action="toggle-schema-desc"]');
      if (descToggle) {
        const descId = descToggle.dataset.schemaDescId || "";
        const descBlock = descId
          ? root.querySelector(`.schema-head-desc[data-schema-desc-id="${escapeAttrValue(descId)}"]`)
          : null;
        if (!descBlock) return;
        const collapsed = descBlock.classList.toggle("is-collapsed");
        descToggle.textContent = collapsed ? "Show description" : "Hide description";
        return;
      }

      if (e.target.closest(".copy-btn")) return;
      const summary = e.target.closest('[data-action="toggle"]');
      if (!summary) return;
      const row = summary.closest(".endpoint-row");
      if (!row) return;
      if (row.classList.toggle("expanded")) renderDetails(row);
    });

    root.addEventListener("change", (e) => {
      const exampleSwitcher = e.target.closest('[data-action="set-example"]');
      if (!exampleSwitcher) return;
      const split = exampleSwitcher.closest(".split-media");
      if (!split) return;
      const nextIndex = String(exampleSwitcher.value || "0");
      split.querySelectorAll(".example-view").forEach((view) => {
        view.classList.toggle("is-active", view.dataset.exampleViewIndex === nextIndex);
      });
    });

    root.addEventListener("input", (e) => {
      if (!e.target.matches("#api-search")) return;
      const q = e.target.value.trim().toLowerCase();
      const list = root.querySelector("#endpoint-list");
      if (!list) return;
      let visible = 0;
      list.querySelectorAll(".endpoint-row").forEach((r) => {
        const show = !q || (r.dataset.searchText || "").includes(q);
        r.style.display = show ? "" : "none";
        if (show) visible++;
      });
      list.querySelectorAll(".tag-group").forEach((groupEl) => {
        const hasVisibleRow = Array.from(groupEl.querySelectorAll(".endpoint-row"))
          .some((rowEl) => rowEl.style.display !== "none");
        groupEl.style.display = hasVisibleRow ? "" : "none";
      });
      setStatus(visible === 0 ? "No matches." : `Showing ${visible} endpoint(s).`, visible === 0);
    });

    // "/" focuses the endpoint search from anywhere (unless already typing).
    window.addEventListener("keydown", (event) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const search = document.getElementById("api-search");
      if (!search) return;
      event.preventDefault();
      search.focus();
      search.select();
    });
  }

  // ── Copy raw spec ────────────────────────────────────────────────────────

  function bindCopyRaw() {
    document.getElementById("copy-raw-btn")?.addEventListener("click", (e) => {
      copyText(rawSpecText, e.currentTarget);
    });
  }

  // ── Panel resize ─────────────────────────────────────────────────────────

  function bindPanelResize() {
    const grid = document.getElementById("content-grid");
    const divider = document.getElementById("panel-resizer");
    if (!grid || !divider) return;

    const storageKey = "leftPanelWidthPx";
    const minLeft = 280;
    const minRight = 360;

    function clampLeft(px) {
      const total = grid.clientWidth;
      const maxLeft = Math.max(minLeft, total - minRight - 8);
      return Math.min(maxLeft, Math.max(minLeft, px));
    }

    function setLeft(px) {
      const clamped = clampLeft(px);
      grid.style.setProperty("--left-panel-width", `${clamped}px`);
      divider.setAttribute("aria-valuemin", String(minLeft));
      divider.setAttribute("aria-valuemax", String(Math.round(Math.max(minLeft, grid.clientWidth - minRight - 8))));
      divider.setAttribute("aria-valuenow", String(Math.round(clamped)));
      return clamped;
    }

    chrome.storage.local.get([storageKey], (data) => {
      if (typeof data[storageKey] === "number") setLeft(data[storageKey]);
    });

    let dragging = false;

    function onMouseMove(event) {
      if (!dragging) return;
      const rect = grid.getBoundingClientRect();
      setLeft(event.clientX - rect.left);
    }

    function onMouseUp() {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("is-resizing-panels");
      divider.classList.remove("is-dragging");
      const left = parseFloat(getComputedStyle(grid).getPropertyValue("--left-panel-width"));
      if (!Number.isNaN(left)) chrome.storage.local.set({ [storageKey]: left });
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }

    divider.addEventListener("mousedown", (event) => {
      event.preventDefault();
      dragging = true;
      document.body.classList.add("is-resizing-panels");
      divider.classList.add("is-dragging");
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    });

    divider.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const step = event.shiftKey ? 32 : 16;
      const current = parseFloat(getComputedStyle(grid).getPropertyValue("--left-panel-width"));
      const base = Number.isNaN(current) ? grid.clientWidth * 0.34 : current;
      const next = event.key === "ArrowLeft" ? base - step : base + step;
      const applied = setLeft(next);
      chrome.storage.local.set({ [storageKey]: applied });
    });

    window.addEventListener("resize", () => {
      const left = parseFloat(getComputedStyle(grid).getPropertyValue("--left-panel-width"));
      if (!Number.isNaN(left)) setLeft(left);
    });
  }

  function applyRawSpec(rawText, sourceLabel) {
    rawSpecText = rawText;

    // Exit edit mode without re-validating (we handle that below)
    if (isEditMode) {
      isEditMode = false;
      clearTimeout(editorDebounceTimer);
      const editor = document.getElementById("raw-spec-editor");
      const editBtn = document.getElementById("edit-spec-btn");
      if (editor) editor.hidden = true;
      if (editBtn) {
        editBtn.title = "Edit spec inline";
        editBtn.setAttribute("aria-label", "Edit spec");
        editBtn.classList.remove("is-active");
      }
      const pre = document.getElementById("raw-spec");
      if (pre) pre.hidden = false;
    }

    setSourceUrl(sourceLabel || "");

    const rawEl = document.getElementById("raw-spec");
    if (rawEl) rawEl.innerHTML = renderRawSpecWithHighlight(rawText);

    if (!window.jsyaml?.load) {
      renderDocsError("YAML parser not found. Reload the extension.");
      return;
    }

    const spec = parseSpec(rawText);
    if (!spec || typeof spec !== "object" || !spec.paths) {
      renderDocsError("Invalid OpenAPI spec – missing paths.");
      return;
    }

    activeSpec = spec;
    schemaNodeStore.clear();
    schemaCopyStore.clear();
    valueTreeStore.clear();
    schemaNodeSeq = 0;
    schemaCopySeq = 0;
    valueTreeSeq = 0;
    schemaDescSeq = 0;

    setSpecVersionTag(specVersion(spec));
    renderDocs(spec);
  }

  function loadStoredSpec(stored) {
    if (!stored?.rawText) {
      renderDocsError("No spec found. Navigate to an OpenAPI/Swagger spec URL.");
      setStatus("No spec loaded.", true);
      return;
    }
    applyRawSpec(stored.rawText, stored.sourceUrl || "");
  }

  // ── File upload ──────────────────────────────────────────────────────────

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    });
  }

  function setFileModalOpen(open) {
    const modal = document.getElementById("file-modal");
    const backdrop = document.getElementById("file-modal-backdrop");
    if (!modal || !backdrop) return;
    modal.hidden = !open;
    backdrop.hidden = !open;
  }

  function bindFileUpload() {
    const uploadBtn = document.getElementById("upload-file-btn");
    const fileInput = document.getElementById("file-input");
    const closeBtn = document.getElementById("file-modal-close");
    const backdrop = document.getElementById("file-modal-backdrop");
    const listEl = document.getElementById("file-modal-list");

    uploadBtn?.addEventListener("click", () => fileInput?.click());
    closeBtn?.addEventListener("click", () => setFileModalOpen(false));
    backdrop?.addEventListener("click", () => setFileModalOpen(false));

    let fileResults = [];

    fileInput?.addEventListener("change", async () => {
      const files = Array.from(fileInput.files || []);
      if (!files.length) return;
      fileInput.value = "";

      fileResults = await Promise.all(files.map(async (file) => {
        try {
          const text = await readFileAsText(file);
          const validation = validateSpecText(text);
          return { name: file.name, text, ...validation };
        } catch (err) {
          return { name: file.name, valid: false, error: String(err?.message || "Failed to read file") };
        }
      }));

      const validResults = fileResults.filter((r) => r.valid);

      // Single valid file with no invalids → load immediately, no modal
      if (fileResults.length === 1 && validResults.length === 1) {
        applyRawSpec(fileResults[0].text, fileResults[0].name);
        return;
      }

      // Show modal for multiple files or any invalid
      if (!listEl) return;
      listEl.innerHTML = fileResults.map((r) => `
        <div class="file-result ${r.valid ? "is-valid" : "is-invalid"}">
          <div class="file-result-head">
            <span class="file-result-icon">${r.valid ? "✓" : "✗"}</span>
            <span class="file-result-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>
            ${r.valid ? `<button class="copy-btn icon-btn-square" data-action="load-file" data-file-name="${escapeHtml(r.name)}" title="Load spec" aria-label="Load spec">${ICON_DOWNLOAD}</button>` : ""}
          </div>
          ${!r.valid ? `<div class="file-result-error">${escapeHtml(r.error)}</div>` : ""}
        </div>
      `).join("");

      listEl.addEventListener("click", (e) => {
        const btn = e.target.closest('[data-action="load-file"]');
        if (!btn) return;
        const name = btn.dataset.fileName;
        const result = fileResults.find((r) => r.name === name && r.valid);
        if (result) {
          applyRawSpec(result.text, result.name);
          setFileModalOpen(false);
        }
      }, { once: true });

      setFileModalOpen(true);
    });
  }

  // ── Inline editor ────────────────────────────────────────────────────────

  function setEditMode(active) {
    isEditMode = active;
    const pre = document.getElementById("raw-spec");
    const editor = document.getElementById("raw-spec-editor");
    const btn = document.getElementById("edit-spec-btn");
    if (!pre || !editor || !btn) return;

    if (active) {
      editor.value = rawSpecText;
      pre.hidden = true;
      editor.hidden = false;
      btn.title = "Finish editing";
      btn.setAttribute("aria-label", "Finish editing");
      btn.classList.add("is-active");
      editor.focus();
    } else {
      clearTimeout(editorDebounceTimer);
      const text = editor.value;
      rawSpecText = text;
      pre.innerHTML = renderRawSpecWithHighlight(text);
      pre.hidden = false;
      editor.hidden = true;
      btn.title = "Edit spec inline";
      btn.setAttribute("aria-label", "Edit spec");
      btn.classList.remove("is-active");
      // Show validation status without wiping the docs panel
      const result = validateSpecText(text);
      if (!result.valid) setStatus("Invalid spec: " + result.error, true);
    }
  }

  function bindInlineEditor() {
    const btn = document.getElementById("edit-spec-btn");
    const editor = document.getElementById("raw-spec-editor");
    if (!btn || !editor) return;

    btn.addEventListener("click", () => setEditMode(!isEditMode));

    editor.addEventListener("input", () => {
      clearTimeout(editorDebounceTimer);
      editorDebounceTimer = setTimeout(() => {
        const text = editor.value;
        rawSpecText = text;
        const result = validateSpecText(text);
        if (result.valid) {
          activeSpec = result.spec;
          schemaNodeStore.clear();
          schemaCopyStore.clear();
          valueTreeStore.clear();
          schemaNodeSeq = 0;
          schemaCopySeq = 0;
          valueTreeSeq = 0;
          schemaDescSeq = 0;
          setSpecVersionTag(specVersion(result.spec));
          renderDocs(result.spec);
        } else {
          setStatus("Invalid spec: " + result.error, true);
        }
      }, 300);
    });
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────

  function init() {
    setAppVersion();
    setStatusAuthor();
    bindRecentDrawer();

    window.addEventListener("mousedown", onGlobalMouseDown);
    window.addEventListener("mousemove", onGlobalMouseMove);
    window.addEventListener("mouseup", onGlobalMouseUp);

    chrome.storage.local.get(["theme", "pendingSpec"], (data) => {
      applyTheme(data.theme || "light");
      loadStoredSpec(data.pendingSpec);
    });

    // Theme toggle in topbar.
    document.getElementById("theme-toggle")?.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") || "light";
      const next = cur === "dark" ? "light" : "dark";
      chrome.storage.local.set({ theme: next });
      applyTheme(next);
    });

    bindDocsEvents();
    bindCopyRaw();
    bindPanelResize();
    bindFileUpload();
    bindInlineEditor();

    // React to theme changes from popup without reloading.
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.theme) applyTheme(changes.theme.newValue);
      if (changes[RECENT_SPECS_KEY]) refreshRecentSpecs();
    });
  }

  init();
})();
