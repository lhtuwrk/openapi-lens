(() => {
  const autoOpenToggle = document.getElementById("auto-open-toggle");
  const themeSelect    = document.getElementById("theme-select");
  const versionEl      = document.getElementById("header-version");

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

  // Save on change.
  autoOpenToggle.addEventListener("change", () => {
    chrome.storage.local.set({ autoOpen: autoOpenToggle.checked });
  });

  themeSelect.addEventListener("change", () => {
    const theme = themeSelect.value;
    chrome.storage.local.set({ theme });
    applyPopupTheme(theme);
  });

  function applyPopupTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
  }
})();
