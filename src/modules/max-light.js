window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installMaxLightModule = function installMaxLightModule(bot) {
  const configStorageKey = "minibiaBot.maxLight.config";
  const styleId = "minibia-bot-max-light-style";

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

  function apply() {
    ensureStyle();
    markGameCanvases();
    document.documentElement.dataset.minibiaMaxLight = config.enabled ? "true" : "false";
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

  const observer = new MutationObserver(() => {
    if (config.enabled) markGameCanvases();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  bot.addCleanup(() => {
    observer.disconnect();
    document.documentElement.removeAttribute("data-minibia-max-light");
    document.querySelectorAll('canvas[data-minibia-max-light-target="true"]').forEach((canvas) => {
      canvas.removeAttribute("data-minibia-max-light-target");
    });
    document.getElementById(styleId)?.remove();
  });

  bot.maxLight = {
    start,
    stop,
    toggle,
    updateConfig,
    config,
    status: () => ({ running: !!config.enabled, config: { ...config } }),
  };

  apply();
};
