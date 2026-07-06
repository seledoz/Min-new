window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installRedTextAlertModule = function installRedTextAlertModule(bot) {
  if (!bot || bot.redTextAlert?.destroy) return bot?.redTextAlert;

  const configStorageKey = "minibiaBot.redTextAlert.config";
  const state = {
    running: false,
    observer: null,
    alertTimerId: null,
    uiTimerId: null,
    clearWatchTimerId: null,
    mode: "watching", // watching -> beeping -> waiting-clear -> watching
    alertStartedAt: 0,
    lastBeepAt: 0,
    lastSeenText: "",
    lastSeenAt: 0,
    lastNoRedAt: 0,
    audioContext: null,
  };

  const config = Object.assign(
    {
      enabled: false,
      beepIntervalMs: 3000,
      alertDurationMs: 30000,
      clearEventAfterNoRedMs: 1500,
      scanExistingOnStart: false,
    },
    bot.storage.get(configStorageKey, {}) || {}
  );

  config.beepIntervalMs = positiveInt(config.beepIntervalMs, 3000);
  config.alertDurationMs = positiveInt(config.alertDurationMs, 30000);
  config.clearEventAfterNoRedMs = positiveInt(config.clearEventAfterNoRedMs, 1500);
  config.scanExistingOnStart = false;

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function positiveInt(value, fallback) {
    const n = Math.trunc(Number(value));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function getAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!state.audioContext || state.audioContext.state === "closed") {
      state.audioContext = new AudioContextClass();
    }
    if (state.audioContext.state === "suspended") {
      state.audioContext.resume?.().catch?.(() => {});
    }
    return state.audioContext;
  }

  function beep() {
    const audioContext = getAudioContext();
    if (!audioContext) return false;

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.28);
    return true;
  }

  function isRedColor(value) {
    const color = String(value || "").trim().toLowerCase();
    if (!color || color === "transparent" || color === "inherit") return false;
    if (color.includes("red") || color.includes("#f00") || color.includes("#ff0000")) return true;

    const match = color.match(/rgba?\(([^)]+)\)/);
    if (!match) return false;

    const [r, g, b, a = 1] = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
    return [r, g, b, a].every(Number.isFinite) && a > 0.05 && r >= 150 && r > g * 1.4 && r > b * 1.4;
  }

  function elementHasRedText(element) {
    if (!(element instanceof Element)) return false;

    const candidates = [element, ...Array.from(element.querySelectorAll?.("*") || [])];
    return candidates.some((candidate) => {
      const text = String(candidate.textContent || "").trim();
      if (!text) return false;
      const style = window.getComputedStyle(candidate);
      return isRedColor(style.color) || isRedColor(style.backgroundColor);
    });
  }

  function getNodeText(node) {
    return String(node?.textContent || "").trim().replace(/\s+/g, " ");
  }

  function hasVisibleRedText() {
    return Array.from(document.body?.querySelectorAll?.("*") || []).some(elementHasRedText);
  }

  function nodeHasRedText(node) {
    if (!node) return false;
    if (node.nodeType === Node.TEXT_NODE) {
      return !!node.parentElement && elementHasRedText(node.parentElement);
    }
    return node.nodeType === Node.ELEMENT_NODE && elementHasRedText(node);
  }

  function getRedTextFromNode(node) {
    if (!node) return "";
    if (node.nodeType === Node.TEXT_NODE) return getNodeText(node.parentElement || node);
    return getNodeText(node);
  }

  function startAlert(text = "") {
    if (!config.enabled || !state.running || state.mode !== "watching") return false;

    const now = Date.now();
    state.mode = "beeping";
    state.alertStartedAt = now;
    state.lastBeepAt = 0;
    state.lastSeenText = text;
    state.lastSeenAt = now;

    bot.log("red text alert triggered", { text, beepIntervalMs: config.beepIntervalMs, alertDurationMs: config.alertDurationMs });
    tickAlert();
    refreshUiValues();
    return true;
  }

  function stopAlertTimer() {
    if (state.alertTimerId != null) window.clearTimeout(state.alertTimerId);
    state.alertTimerId = null;
  }

  function tickAlert() {
    stopAlertTimer();
    if (!config.enabled || !state.running || state.mode !== "beeping" || !state.alertStartedAt) return;

    const now = Date.now();
    const durationMs = positiveInt(config.alertDurationMs, 30000);
    const intervalMs = positiveInt(config.beepIntervalMs, 3000);
    const elapsedMs = now - state.alertStartedAt;

    if (elapsedMs >= durationMs) {
      state.alertStartedAt = 0;
      state.lastBeepAt = 0;
      state.mode = "waiting-clear";
      state.lastNoRedAt = 0;
      refreshUiValues();
      return;
    }

    if (!state.lastBeepAt || now - state.lastBeepAt >= intervalMs) {
      if (beep()) state.lastBeepAt = now;
    }

    state.alertTimerId = window.setTimeout(tickAlert, 250);
    refreshUiValues();
  }

  function checkForClear() {
    if (!state.running || state.mode !== "waiting-clear") return;

    const now = Date.now();
    if (hasVisibleRedText()) {
      state.lastNoRedAt = 0;
      return;
    }

    if (!state.lastNoRedAt) {
      state.lastNoRedAt = now;
      return;
    }

    if (now - state.lastNoRedAt >= positiveInt(config.clearEventAfterNoRedMs, 1500)) {
      state.mode = "watching";
      state.lastNoRedAt = 0;
      refreshUiValues();
    }
  }

  function startClearWatchTimer() {
    stopClearWatchTimer();
    state.clearWatchTimerId = window.setInterval(checkForClear, 500);
  }

  function stopClearWatchTimer() {
    if (state.clearWatchTimerId != null) window.clearInterval(state.clearWatchTimerId);
    state.clearWatchTimerId = null;
  }

  function inspectAddedNode(node) {
    if (!config.enabled || !state.running || state.mode !== "watching") return false;
    if (!nodeHasRedText(node)) return false;
    return startAlert(getRedTextFromNode(node));
  }

  function startObserver() {
    stopObserver();
    state.observer = new MutationObserver((mutations) => {
      if (state.mode !== "watching") return;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (inspectAddedNode(node)) return;
        }
      }
    });
    state.observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (state.observer) state.observer.disconnect();
    state.observer = null;
  }

  function start(overrides = {}) {
    updateConfig(Object.assign({}, overrides, { enabled: true, scanExistingOnStart: false }), { silent: true });
    if (state.running) return false;

    state.running = true;
    state.mode = hasVisibleRedText() ? "waiting-clear" : "watching";
    state.alertStartedAt = 0;
    state.lastBeepAt = 0;
    state.lastNoRedAt = 0;

    startObserver();
    startClearWatchTimer();
    bot.log("red text alert started", { ...config, mode: state.mode });
    refreshUiValues();
    return true;
  }

  function stop(options = {}) {
    state.running = false;
    state.mode = "watching";
    state.alertStartedAt = 0;
    state.lastBeepAt = 0;
    state.lastNoRedAt = 0;
    stopObserver();
    stopAlertTimer();
    stopClearWatchTimer();
    if (options.persistEnabled !== false) {
      config.enabled = false;
      persistConfig();
    }
    bot.log("red text alert stopped");
    refreshUiValues();
    return true;
  }

  function updateConfig(nextConfig = {}, options = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "beepIntervalMs")) {
      nextConfig.beepIntervalMs = positiveInt(nextConfig.beepIntervalMs, config.beepIntervalMs || 3000);
    }
    if (Object.prototype.hasOwnProperty.call(nextConfig, "alertDurationMs")) {
      nextConfig.alertDurationMs = positiveInt(nextConfig.alertDurationMs, config.alertDurationMs || 30000);
    }
    if (Object.prototype.hasOwnProperty.call(nextConfig, "clearEventAfterNoRedMs")) {
      nextConfig.clearEventAfterNoRedMs = positiveInt(nextConfig.clearEventAfterNoRedMs, config.clearEventAfterNoRedMs || 1500);
    }
    if (Object.prototype.hasOwnProperty.call(nextConfig, "scanExistingOnStart")) {
      nextConfig.scanExistingOnStart = false;
    }

    Object.assign(config, nextConfig);
    config.scanExistingOnStart = false;
    persistConfig();
    if (!options.silent) refreshUiValues();
    return { ...config };
  }

  function resetSeenMessages() {
    state.mode = "watching";
    state.alertStartedAt = 0;
    state.lastBeepAt = 0;
    state.lastNoRedAt = 0;
    stopAlertTimer();
    bot.log("red text alert state reset");
    refreshUiValues();
  }

  function status() {
    const now = Date.now();
    const remainingMs = state.mode === "beeping" && state.alertStartedAt
      ? Math.max(0, positiveInt(config.alertDurationMs, 30000) - (now - state.alertStartedAt))
      : 0;

    return {
      running: state.running,
      config: { ...config },
      mode: state.mode,
      alertActive: state.mode === "beeping" && remainingMs > 0,
      remainingMs,
      lastSeenText: state.lastSeenText,
      lastSeenAt: state.lastSeenAt,
      lastBeepAt: state.lastBeepAt,
    };
  }

  function ensureUi() {
    const panel = document.getElementById("k9x-panel");
    if (!panel || document.getElementById("k9x-red-text-alert-section")) return;

    const parent = panel.querySelector(".mb-side-column") || panel.querySelector(".mb-main-column") || panel.querySelector(".mb-body") || panel;
    const section = document.createElement("div");
    section.className = "mb-section mb-column-section";
    section.id = "k9x-red-text-alert-section";
    section.innerHTML = `
      <div class="mb-label">Red Text Alert</div>
      <div class="mb-stack">
        <label class="mb-toggle"><input type="checkbox" id="k9x-red-text-alert-enabled" /><span>Enable Red Text Alert</span></label>
        <div class="mb-small-note" id="k9x-red-text-alert-status">Alert: off</div>
        <div class="mb-small-note">Beeps every 3 seconds for 30 seconds. It waits for red text to clear before another alert.</div>
      </div>`;
    parent.appendChild(section);

    const enabled = section.querySelector("#k9x-red-text-alert-enabled");
    enabled?.addEventListener("change", () => enabled.checked ? start() : stop());
    refreshUiValues();
  }

  function refreshUiValues() {
    const enabled = document.getElementById("k9x-red-text-alert-enabled");
    const label = document.getElementById("k9x-red-text-alert-status");
    const current = status();

    if (enabled) enabled.checked = !!state.running;
    if (label) {
      label.textContent = !state.running
        ? "Alert: off"
        : current.alertActive
          ? `Alert: beeping (${Math.ceil(current.remainingMs / 1000)}s left)`
          : current.mode === "waiting-clear"
            ? "Alert: waiting for red text to clear"
            : "Alert: watching";
    }
  }

  function destroy() {
    stop({ persistEnabled: false });
    if (state.uiTimerId != null) window.clearInterval(state.uiTimerId);
    state.uiTimerId = null;
    document.getElementById("k9x-red-text-alert-section")?.remove();
  }

  bot.redTextAlert = { start, stop, status, updateConfig, beep, resetSeenMessages, destroy, config };
  state.uiTimerId = window.setInterval(() => { ensureUi(); refreshUiValues(); }, 1000);
  bot.addCleanup(destroy);
  if (config.enabled) start(); else ensureUi();
  return bot.redTextAlert;
};
