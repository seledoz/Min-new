window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installRedTextAlertModule = function installRedTextAlertModule(bot) {
  if (!bot || bot.redTextAlert?.destroy) return bot?.redTextAlert;

  const configStorageKey = "minibiaBot.redTextAlert.config";
  const state = {
    running: false,
    observer: null,
    alertTimerId: null,
    uiTimerId: null,
    scanTimerId: null,
    mode: "watching",
    alertStartedAt: 0,
    lastBeepAt: 0,
    lastSeenText: "",
    lastSeenAt: 0,
    lastNoRedAt: 0,
    audioContext: null,
    baselineRedTextKeys: new Set(),
  };

  const config = Object.assign(
    {
      enabled: false,
      beepIntervalMs: 3000,
      alertDurationMs: 30000,
      clearEventAfterNoRedMs: 1500,
      scanMs: 300,
      consoleSelector: "",
      scanExistingOnStart: false,
    },
    bot.storage.get(configStorageKey, {}) || {}
  );

  config.beepIntervalMs = positiveInt(config.beepIntervalMs, 3000);
  config.alertDurationMs = positiveInt(config.alertDurationMs, 30000);
  config.clearEventAfterNoRedMs = positiveInt(config.clearEventAfterNoRedMs, 1500);
  config.scanMs = Math.max(100, positiveInt(config.scanMs, 300));
  config.consoleSelector = String(config.consoleSelector || "").trim();
  config.scanExistingOnStart = false;

  function persistConfig() { bot.storage.set(configStorageKey, { ...config }); }
  function positiveInt(value, fallback) { const n = Math.trunc(Number(value)); return Number.isFinite(n) && n > 0 ? n : fallback; }

  function getAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!state.audioContext || state.audioContext.state === "closed") state.audioContext = new AudioContextClass();
    if (state.audioContext.state === "suspended") state.audioContext.resume?.().catch?.(() => {});
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

  function isIgnoredElement(element) {
    return !!element?.closest?.("#minibia-bot-panel, #k9x-panel, #minibia-bot-style, script, style");
  }

  function isVisibleElement(element) {
    if (!(element instanceof Element) || isIgnoredElement(element)) return false;
    const rect = element.getBoundingClientRect?.();
    const style = window.getComputedStyle(element);
    return !!rect && rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
  }

  function elementHasOwnRedText(element) {
    if (!isVisibleElement(element)) return false;
    const text = String(element.textContent || "").trim();
    if (!text || text.length > 500) return false;
    const childText = Array.from(element.children || []).map((child) => String(child.textContent || "").trim()).join("").trim();
    if (childText && childText.length >= text.length * 0.8) return false;
    const style = window.getComputedStyle(element);
    return isRedColor(style.color) || isRedColor(style.backgroundColor);
  }

  function getNodeText(node) { return String(node?.textContent || "").trim().replace(/\s+/g, " "); }
  function getRedKey(element) { return getNodeText(element).toLowerCase(); }

  function getConsoleRoots() {
    if (config.consoleSelector) {
      try {
        const customRoots = Array.from(document.querySelectorAll(config.consoleSelector)).filter(isVisibleElement);
        if (customRoots.length) return customRoots;
      } catch (error) {
        bot.log("red text alert console selector failed", { selector: config.consoleSelector, error: error?.message || String(error) });
      }
    }

    const selectors = [
      '[id*="console" i]', '[class*="console" i]',
      '[id*="chat" i]', '[class*="chat" i]'
    ];

    const roots = Array.from(document.querySelectorAll(selectors.join(",")))
      .filter(isVisibleElement)
      .filter((element) => String(element.textContent || "").trim().length > 0)
      .filter((element) => !element.closest?.("#minibia-bot-panel, #k9x-panel"));

    const leafiest = roots.filter((element) => !roots.some((other) => other !== element && element.contains(other)));
    return Array.from(new Set(leafiest.length ? leafiest : roots));
  }

  function getVisibleRedElements() {
    const found = [];
    const seen = new Set();
    for (const root of getConsoleRoots()) {
      const candidates = Array.from(root.querySelectorAll?.("*") || []).filter(elementHasOwnRedText);
      for (const candidate of candidates) {
        if (!seen.has(candidate)) {
          seen.add(candidate);
          found.push(candidate);
        }
      }
    }
    return found;
  }

  function refreshBaselineRedText() {
    const visibleKeys = new Set(getVisibleRedElements().map(getRedKey).filter(Boolean));
    for (const key of Array.from(state.baselineRedTextKeys)) {
      if (!visibleKeys.has(key)) state.baselineRedTextKeys.delete(key);
    }
    return visibleKeys;
  }

  function findFirstNewRedElement() {
    refreshBaselineRedText();
    return getVisibleRedElements().find((element) => {
      const key = getRedKey(element);
      return key && !state.baselineRedTextKeys.has(key);
    }) || null;
  }

  function hasVisibleRedText() { return getVisibleRedElements().length > 0; }

  function nodeIsInsideConsole(node) {
    const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!isVisibleElement(element)) return false;
    return getConsoleRoots().some((root) => root === element || root.contains(element));
  }

  function nodeHasRedText(node) {
    if (!node || !nodeIsInsideConsole(node)) return false;
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    return elementHasOwnRedText(element);
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
    state.baselineRedTextKeys.clear();
    bot.log("red text alert triggered", { text, beepIntervalMs: config.beepIntervalMs, alertDurationMs: config.alertDurationMs, consoleRoots: getConsoleRoots().length });
    tickAlert();
    refreshUiValues();
    return true;
  }

  function scanForRedText() {
    if (!config.enabled || !state.running) return;
    if (state.mode === "watching") {
      const redElement = findFirstNewRedElement();
      if (redElement) startAlert(getNodeText(redElement));
      return;
    }
    if (state.mode === "waiting-clear") checkForClear();
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
      state.baselineRedTextKeys = new Set(getVisibleRedElements().map(getRedKey).filter(Boolean));
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
      refreshBaselineRedText();
      return;
    }
    if (!state.lastNoRedAt) {
      state.lastNoRedAt = now;
      return;
    }
    if (now - state.lastNoRedAt >= positiveInt(config.clearEventAfterNoRedMs, 1500)) {
      state.mode = "watching";
      state.lastNoRedAt = 0;
      state.baselineRedTextKeys.clear();
      refreshUiValues();
    }
  }

  function startScanTimer() {
    stopScanTimer();
    state.scanTimerId = window.setInterval(scanForRedText, Math.max(100, positiveInt(config.scanMs, 300)));
  }

  function stopScanTimer() {
    if (state.scanTimerId != null) window.clearInterval(state.scanTimerId);
    state.scanTimerId = null;
  }

  function inspectAddedNode(node) {
    if (!config.enabled || !state.running || state.mode !== "watching") return false;
    if (!nodeHasRedText(node)) return false;
    const text = getRedTextFromNode(node);
    const key = String(text || "").toLowerCase();
    if (key && state.baselineRedTextKeys.has(key)) return false;
    return startAlert(text);
  }

  function startObserver() {
    stopObserver();
    state.observer = new MutationObserver((mutations) => {
      if (state.mode !== "watching") return;
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && inspectAddedNode(mutation.target)) return;
        if (mutation.type === "characterData" && inspectAddedNode(mutation.target)) return;
        for (const node of mutation.addedNodes) {
          if (inspectAddedNode(node)) return;
        }
      }
    });
    state.observer.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["style", "class"] });
  }

  function stopObserver() {
    if (state.observer) state.observer.disconnect();
    state.observer = null;
  }

  function start(overrides = {}) {
    updateConfig(Object.assign({}, overrides, { enabled: true, scanExistingOnStart: false }), { silent: true });
    if (state.running) return false;
    state.running = true;
    state.mode = "watching";
    state.alertStartedAt = 0;
    state.lastBeepAt = 0;
    state.lastNoRedAt = 0;
    state.baselineRedTextKeys = new Set(getVisibleRedElements().map(getRedKey).filter(Boolean));
    startObserver();
    startScanTimer();
    bot.log("red text alert started", { ...config, mode: state.mode, consoleRoots: getConsoleRoots().length, baselineRedTextCount: state.baselineRedTextKeys.size });
    refreshUiValues();
    return true;
  }

  function stop(options = {}) {
    state.running = false;
    state.mode = "watching";
    state.alertStartedAt = 0;
    state.lastBeepAt = 0;
    state.lastNoRedAt = 0;
    state.baselineRedTextKeys.clear();
    stopObserver();
    stopAlertTimer();
    stopScanTimer();
    if (options.persistEnabled !== false) {
      config.enabled = false;
      persistConfig();
    }
    bot.log("red text alert stopped");
    refreshUiValues();
    return true;
  }

  function updateConfig(nextConfig = {}, options = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "beepIntervalMs")) nextConfig.beepIntervalMs = positiveInt(nextConfig.beepIntervalMs, config.beepIntervalMs || 3000);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "alertDurationMs")) nextConfig.alertDurationMs = positiveInt(nextConfig.alertDurationMs, config.alertDurationMs || 30000);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "clearEventAfterNoRedMs")) nextConfig.clearEventAfterNoRedMs = positiveInt(nextConfig.clearEventAfterNoRedMs, config.clearEventAfterNoRedMs || 1500);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "scanMs")) nextConfig.scanMs = Math.max(100, positiveInt(nextConfig.scanMs, config.scanMs || 300));
    if (Object.prototype.hasOwnProperty.call(nextConfig, "consoleSelector")) nextConfig.consoleSelector = String(nextConfig.consoleSelector || "").trim();
    if (Object.prototype.hasOwnProperty.call(nextConfig, "scanExistingOnStart")) nextConfig.scanExistingOnStart = false;
    Object.assign(config, nextConfig);
    config.scanExistingOnStart = false;
    persistConfig();
    if (state.running && Object.prototype.hasOwnProperty.call(nextConfig, "scanMs")) startScanTimer();
    if (!options.silent) refreshUiValues();
    return { ...config };
  }

  function resetSeenMessages() {
    state.mode = "watching";
    state.alertStartedAt = 0;
    state.lastBeepAt = 0;
    state.lastNoRedAt = 0;
    state.baselineRedTextKeys.clear();
    stopAlertTimer();
    bot.log("red text alert state reset");
    refreshUiValues();
  }

  function status() {
    const now = Date.now();
    const remainingMs = state.mode === "beeping" && state.alertStartedAt ? Math.max(0, positiveInt(config.alertDurationMs, 30000) - (now - state.alertStartedAt)) : 0;
    const visibleRedCount = getVisibleRedElements().length;
    return {
      running: state.running,
      config: { ...config },
      mode: state.mode,
      alertActive: state.mode === "beeping" && remainingMs > 0,
      remainingMs,
      lastSeenText: state.lastSeenText,
      lastSeenAt: state.lastSeenAt,
      lastBeepAt: state.lastBeepAt,
      visibleRedTextNow: visibleRedCount > 0,
      visibleRedCount,
      baselineRedTextCount: state.baselineRedTextKeys.size,
      consoleRootCount: getConsoleRoots().length,
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
        <div class="mb-small-note">Beeps every 3 seconds for 30 seconds. Watches only console/chat line text.</div>
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
          : `Alert: watching (${current.consoleRootCount} console areas)`;
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
