window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installMaxLightModule = function installMaxLightModule(bot) {
  const configStorageKey = "minibiaBot.maxLight.config";
  const styleId = "minibia-bot-max-light-style";
  const controlsId = "minibia-bot-max-light-section";

  const config = Object.assign(
    {
      enabled: false,
      brightness: 1.85,
      contrast: 1.08,
    },
    bot.storage.get(configStorageKey, {})
  );

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function getGameCanvasCandidates() {
    const selectors = [
      "#game canvas",
      "#gameCanvas",
      "#game-canvas",
      ".game-canvas",
      ".game canvas",
      "canvas#canvas",
      "canvas",
    ];

    const seen = new Set();
    const candidates = [];
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((element) => {
        if (!(element instanceof HTMLCanvasElement) || seen.has(element)) return;
        seen.add(element);
        candidates.push(element);
      });
    });

    return candidates.filter((canvas) => {
      if (canvas.closest("#minibia-bot-panel")) return false;
      const rect = canvas.getBoundingClientRect();
      return rect.width >= 240 && rect.height >= 160;
    });
  }

  function ensureStyle() {
    let style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement("style");
      style.id = styleId;
      document.head.appendChild(style);
    }

    style.textContent = `
      html[data-minibia-max-light="true"] canvas[data-minibia-max-light-target="true"] {
        filter: brightness(${Number(config.brightness) || 1.85}) contrast(${Number(config.contrast) || 1.08}) !important;
      }
    `;
  }

  function markGameCanvases() {
    document.querySelectorAll('canvas[data-minibia-max-light-target="true"]').forEach((canvas) => {
      canvas.removeAttribute("data-minibia-max-light-target");
    });

    getGameCanvasCandidates().forEach((canvas) => {
      canvas.setAttribute("data-minibia-max-light-target", "true");
    });
  }

  function refreshControls() {
    const enabledInput = document.getElementById("minibia-bot-max-light-enabled");
    const brightnessInput = document.getElementById("minibia-bot-max-light-brightness");
    const contrastInput = document.getElementById("minibia-bot-max-light-contrast");

    if (enabledInput) enabledInput.checked = !!config.enabled;
    if (brightnessInput && document.activeElement !== brightnessInput) brightnessInput.value = String(config.brightness);
    if (contrastInput && document.activeElement !== contrastInput) contrastInput.value = String(config.contrast);
  }

  function apply() {
    ensureStyle();
    markGameCanvases();
    document.documentElement.dataset.minibiaMaxLight = config.enabled ? "true" : "false";
    refreshControls();
  }

  function updateConfig(nextConfig = {}) {
    Object.assign(config, nextConfig);
    config.enabled = !!config.enabled;
    config.brightness = Math.max(1, Math.min(3, Number(config.brightness) || 1.85));
    config.contrast = Math.max(0.5, Math.min(2, Number(config.contrast) || 1.08));
    persistConfig();
    apply();
    bot.log("max light config updated", { ...config });
    return { ...config };
  }

  function start() {
    return updateConfig({ enabled: true });
  }

  function stop() {
    return updateConfig({ enabled: false });
  }

  function toggle() {
    return updateConfig({ enabled: !config.enabled });
  }

  function injectControls() {
    if (document.getElementById(controlsId)) {
      refreshControls();
      return true;
    }

    const mainColumn = document.querySelector("#minibia-bot-panel .mb-main-column");
    if (!mainColumn) return false;

    const section = document.createElement("div");
    section.id = controlsId;
    section.className = "mb-section mb-column-section";
    section.innerHTML = `
      <div class="mb-label">Max Light</div>
      <div class="mb-stack">
        <label class="mb-toggle">
          <input type="checkbox" id="minibia-bot-max-light-enabled" />
          <span>Enable Max Light</span>
        </label>
        <div class="mb-field-grid">
          <label class="mb-field" for="minibia-bot-max-light-brightness">
            <span class="mb-field-label">Brightness</span>
            <input type="number" id="minibia-bot-max-light-brightness" min="1" max="3" step="0.05" />
          </label>
          <label class="mb-field" for="minibia-bot-max-light-contrast">
            <span class="mb-field-label">Contrast</span>
            <input type="number" id="minibia-bot-max-light-contrast" min="0.5" max="2" step="0.05" />
          </label>
        </div>
      </div>
    `;

    mainColumn.appendChild(section);

    section.querySelector("#minibia-bot-max-light-enabled")?.addEventListener("change", (event) => {
      updateConfig({ enabled: !!event.target.checked });
    });
    section.querySelector("#minibia-bot-max-light-brightness")?.addEventListener("change", (event) => {
      updateConfig({ brightness: event.target.value });
    });
    section.querySelector("#minibia-bot-max-light-contrast")?.addEventListener("change", (event) => {
      updateConfig({ contrast: event.target.value });
    });

    refreshControls();
    return true;
  }

  const observer = new MutationObserver(() => {
    if (config.enabled) markGameCanvases();
    injectControls();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  bot.addCleanup(() => {
    observer.disconnect();
    document.documentElement.removeAttribute("data-minibia-max-light");
    document.querySelectorAll('canvas[data-minibia-max-light-target="true"]').forEach((canvas) => {
      canvas.removeAttribute("data-minibia-max-light-target");
    });
    document.getElementById(styleId)?.remove();
    document.getElementById(controlsId)?.remove();
  });

  bot.maxLight = {
    start,
    stop,
    toggle,
    updateConfig,
    injectControls,
    config,
    status: () => ({ running: !!config.enabled, config: { ...config } }),
  };

  apply();
  window.setTimeout(injectControls, 0);
};