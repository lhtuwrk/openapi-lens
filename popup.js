(() => {
  const autoOpenToggle = document.getElementById("auto-open-toggle");
  const themeSelect    = document.getElementById("theme-select");
  const versionEl      = document.getElementById("header-version");
  const recentListEl   = document.getElementById("recent-specs-list");
  const clearRecentBtn = document.getElementById("clear-recent-btn");

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

  function escapeHtml(v) {
    return String(v)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
})();
