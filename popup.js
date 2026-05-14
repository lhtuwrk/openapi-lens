(() => {
  const autoOpenToggle  = document.getElementById("auto-open-toggle");
  const themeSelect     = document.getElementById("theme-select");
  const versionEl       = document.getElementById("header-version");
  const recentListEl    = document.getElementById("recent-specs-list");
  const clearRecentBtn  = document.getElementById("clear-recent-btn");
  const uploadBtn       = document.getElementById("popup-upload-btn");
  const fileInput       = document.getElementById("popup-file-input");
  const uploadResultEl  = document.getElementById("upload-result");

  const RECENT_SPECS_KEY = "recentSpecs";
  const MAX_RECENT_SPECS = 15;

  try {
    const version = chrome.runtime.getManifest()?.version;
    if (versionEl && version) versionEl.textContent = `v${version}`;
  } catch (_) {
    // Ignore if runtime is unavailable.
  }

  // Load saved settings.
  chrome.storage.local.get(["autoOpen", "theme"], (data) => {
    autoOpenToggle.checked = data.autoOpen === true;
    themeSelect.value = data.theme === "dark" ? "dark" : "light";
    applyPopupTheme(themeSelect.value);
  });

  loadRecentSpecs();

  // Save on change.
  autoOpenToggle.addEventListener("change", () => {
    chrome.storage.local.set({ autoOpen: autoOpenToggle.checked });
  });

  themeSelect.addEventListener("change", () => {
    const theme = themeSelect.value;
    chrome.storage.local.set({ theme });
    applyPopupTheme(theme);
  });

  recentListEl?.addEventListener("click", (event) => {
    const openTarget = event.target.closest("[data-action='open-recent']");
    if (openTarget) {
      const url = openTarget.dataset.url;
      if (url) {
        try {
          chrome.tabs.create({ url });
        } catch (_) {
          window.open(url, "_blank");
        }
      }
      return;
    }

    const removeTarget = event.target.closest("[data-action='remove-recent']");
    if (removeTarget) {
      const url = removeTarget.dataset.url;
      if (url) removeRecentSpec(url);
    }
  });

  clearRecentBtn?.addEventListener("click", () => {
    chrome.storage.local.set({ [RECENT_SPECS_KEY]: [] }, loadRecentSpecs);
  });

  function applyPopupTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
  }

  function loadRecentSpecs() {
    chrome.storage.local.get([RECENT_SPECS_KEY], (data) => {
      const list = Array.isArray(data[RECENT_SPECS_KEY]) ? data[RECENT_SPECS_KEY] : [];
      renderRecentSpecs(list.slice(0, MAX_RECENT_SPECS));
    });
  }

  function renderRecentSpecs(items) {
    if (!recentListEl) return;

    if (!items.length) {
      recentListEl.innerHTML = '<div class="recent-empty">No recent specs yet.</div>';
      return;
    }

    recentListEl.innerHTML = items.map((item) => {
      const name = escapeHtml(item?.name || "Untitled spec");
      const url = String(item?.url || "");
      const safeUrl = escapeHtml(url);
      return `
        <div class="recent-item">
          <div class="recent-main" data-action="open-recent" data-url="${safeUrl}" title="Open spec">
            <div class="recent-name">${name}</div>
            <div class="recent-url">${safeUrl}</div>
          </div>
          <button class="recent-remove" data-action="remove-recent" data-url="${safeUrl}" title="Remove">✕</button>
        </div>
      `;
    }).join("");
  }

  function removeRecentSpec(url) {
    chrome.storage.local.get([RECENT_SPECS_KEY], (data) => {
      const list = Array.isArray(data[RECENT_SPECS_KEY]) ? data[RECENT_SPECS_KEY] : [];
      const next = list.filter((item) => item?.url !== url);
      chrome.storage.local.set({ [RECENT_SPECS_KEY]: next }, loadRecentSpecs);
    });
  }

  // ── File upload ────────────────────────────────────────────────────────

  function parseSpec(text) {
    try { return JSON.parse(text); } catch (_) {}
    if (window.jsyaml?.load) {
      try { return window.jsyaml.load(text); } catch (_) {}
    }
    return null;
  }

  function validateSpecText(text) {
    try {
      const spec = parseSpec(text);
      if (!spec || typeof spec !== "object") return { valid: false, error: "Cannot parse as JSON or YAML" };
      if (!spec.openapi && !spec.swagger) return { valid: false, error: "Missing 'openapi' or 'swagger' field" };
      if (!spec.paths) return { valid: false, error: "Missing 'paths' field" };
      return { valid: true };
    } catch (err) {
      return { valid: false, error: String(err?.message || err) };
    }
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    });
  }

  function openSpecInViewer(rawText, filename) {
    chrome.storage.local.set(
      { pendingSpec: { rawText, sourceUrl: filename } },
      () => {
        const viewerUrl = chrome.runtime.getURL("viewer.html");
        chrome.tabs.create({ url: viewerUrl });
      }
    );
  }

  function showUploadResults(results) {
    if (!uploadResultEl) return;
    uploadResultEl.hidden = false;
    uploadResultEl.innerHTML = results.map((r) => `
      <div class="upload-item ${r.valid ? "is-valid" : "is-invalid"}">
        <span class="upload-item-icon">${r.valid ? "✓" : "✗"}</span>
        <div class="upload-item-body">
          <div class="upload-item-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</div>
          ${!r.valid ? `<div class="upload-item-error">${escapeHtml(r.error)}</div>` : ""}
        </div>
        ${r.valid ? `<button class="upload-open-btn" data-action="open-upload" data-file-name="${escapeHtml(r.name)}">Open</button>` : ""}
      </div>
    `).join("");

    uploadResultEl.addEventListener("click", (e) => {
      const btn = e.target.closest('[data-action="open-upload"]');
      if (!btn) return;
      const name = btn.dataset.fileName;
      const result = results.find((r) => r.name === name && r.valid);
      if (result) openSpecInViewer(result.text, result.name);
    }, { once: true });
  }

  uploadBtn?.addEventListener("click", () => fileInput?.click());

  fileInput?.addEventListener("change", async () => {
    const files = Array.from(fileInput.files || []);
    if (!files.length) return;
    fileInput.value = "";
    if (uploadResultEl) uploadResultEl.hidden = true;

    const results = await Promise.all(files.map(async (file) => {
      try {
        const text = await readFileAsText(file);
        const validation = validateSpecText(text);
        return { name: file.name, text, ...validation };
      } catch (err) {
        return { name: file.name, valid: false, error: String(err?.message || "Failed to read file") };
      }
    }));

    const validResults = results.filter((r) => r.valid);

    // Single valid file, no invalids → open immediately
    if (results.length === 1 && validResults.length === 1) {
      openSpecInViewer(results[0].text, results[0].name);
      return;
    }

    showUploadResults(results);
  });

  function escapeHtml(v) {
    return String(v)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
})();
