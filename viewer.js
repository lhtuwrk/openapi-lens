(() => {
  const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "head", "options"];
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

  // ── Theme ────────────────────────────────────────────────────────────────

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
    const btn = document.getElementById("theme-toggle");
    if (btn) btn.textContent = theme === "dark" ? "☀ Light" : "☾ Dark";
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
      chrome.storage.local.set({ [RECENT_SPECS_KEY]: [] }, refreshRecentSpecs);
    });

    listEl?.addEventListener("click", (event) => {
      const openTarget = event.target.closest('[data-action="open-recent"]');
      if (openTarget) {
        openRecentUrl(openTarget.dataset.url || "");
        return;
      }

      const removeTarget = event.target.closest('[data-action="remove-recent"]');
      if (removeTarget) {
        removeRecentSpec(removeTarget.dataset.url || "");
      }
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setRecentDrawerOpen(false);
    });

    refreshRecentSpecs();
  }

  // ── Clipboard ────────────────────────────────────────────────────────────

  function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
      if (!btn) return;
      const orig = btn.textContent;
      btn.textContent = "Copied!";
      btn.classList.add("copy-success");
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
          <button class="copy-btn" data-action="copy-schema" data-schema-copy-id="${copyId}" title="Copy JSON">Copy JSON</button>
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
          <button class="copy-btn" data-action="copy-schema" data-schema-copy-id="${copyId}" title="Copy JSON">Copy JSON</button>
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

  function createEndpointRow(op) {
    const row = document.createElement("div");
    row.className = `endpoint-row endpoint-method-${op.method}`;
    row.dataset.endpointId = op.id;
    row.dataset.searchText = `${op.method} ${op.path} ${op.summary} ${(op.tags || []).join(" ")}`.toLowerCase();

    row.innerHTML = `
      <div class="endpoint-summary" data-action="toggle">
        <span class="method-pill method-${op.method}">${escapeHtml(op.method.toUpperCase())}</span>
        <span class="endpoint-path">${escapeHtml(op.path)}</span>
        <span class="endpoint-summary-text">${escapeHtml(op.summary)}</span>
        <button class="copy-btn js-copy-path" title="Copy path">Copy path</button>
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

  function tableForParams(params) {
    const safeParams = (Array.isArray(params) ? params : []).filter((p) => {
      if (!p || typeof p !== "object") return false;
      const name = typeof p.name === "string" ? p.name.trim() : "";
      const where = typeof p.in === "string" ? p.in.trim() : "";
      return !!name && !!where;
    });

    if (!safeParams.length) return '<div class="muted">No parameters.</div>';
    const rows = safeParams.map((p) => `
      <tr>
        <td><strong>${escapeHtml(p.name || "-")}</strong></td>
        <td>${escapeHtml(p.in || "-")}</td>
        <td>${escapeHtml(p.schema?.type || p.type || "-")}</td>
        <td>${escapeHtml(p.required ? "required" : "optional")}</td>
        <td>${formatDescriptionCompact(p.description || "", "")}</td>
      </tr>`).join("");
    return `
      <table class="kv-table">
        <thead><tr><th>Name</th><th>In</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
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
      ${tableForParams(op.parameters)}
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
        <div>
          <input id="api-search" class="search-input" type="text" placeholder="Search endpoints…" />
        </div>
      </div>
      <div id="endpoint-list" class="endpoint-list"></div>
    `;

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

    // Delegated toggle – skip if click originated from a copy button.
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

    // Search filter.
    root.querySelector("#api-search")?.addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
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

    setStatus(`Loaded ${operations.length} endpoint(s).`);
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

  function loadStoredSpec(stored) {
    if (!stored?.rawText) {
      renderDocsError("No spec found. Navigate to an OpenAPI/Swagger spec URL.");
      setStatus("No spec loaded.", true);
      return;
    }

    rawSpecText = stored.rawText;
    setSourceUrl(stored.sourceUrl || "");

    const rawEl = document.getElementById("raw-spec");
    if (rawEl) rawEl.innerHTML = renderRawSpecWithHighlight(rawSpecText);

    if (!window.jsyaml?.load) {
      renderDocsError("YAML parser not found. Reload the extension.");
      return;
    }

    const spec = parseSpec(rawSpecText);
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

    bindCopyRaw();
    bindPanelResize();

    // React to theme changes from popup without reloading.
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.theme) applyTheme(changes.theme.newValue);
      if (changes[RECENT_SPECS_KEY]) refreshRecentSpecs();
    });
  }

  init();
})();
