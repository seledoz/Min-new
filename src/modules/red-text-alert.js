window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installRedTextAlertModule = function installRedTextAlertModule(bot) {
  if (!bot || bot.redTextAlert?.destroy) return bot?.redTextAlert;

  const configStorageKey = "minibiaBot.redTextAlert.config";
  const state = {
    running: false,
    observer: null,
    alertTimerId: null,
    uiTimerId: null,
    forgetTimerId: null,
    alertStartedAt: 0,
    lastBeepAt: 0,
    lastSeenText: "",
    lastSeenAt: 0,
    audioContext: null,
    seenRedTextKeys: new Set(),
    seenRedNodes: new WeakSet(),
  };

  const config = Object.assign({ enabled: false, beepIntervalMs: 5000, alertDurationMs: 30000, scanExistingOnStart: false }, bot.storage.get(configStorageKey, {}) || {});
  config.beepIntervalMs = positiveInt(config.beepIntervalMs, 5000);
  config.alertDurationMs = positiveInt(config.alertDurationMs, 30000);
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

  function getNodeText(node) { return String(node?.textContent || "").trim().replace(/\s+/g, " "); }
  function getRedTextKey(text) { return String(text || "").trim().replace(/\s+/g, " ").toLowerCase(); }

  function getVisibleRedTextKeys() {
    const keys = new Set();
    const elements = Array.from(document.body?.querySelectorAll?.("*") || []);

    elements.forEach((element) => {
      if (!elementHasRedText(element)) return;
      const key = getRedTextKey(getNodeText(element));
      if (key) keys.add(key);
    });

    return keys;
  }

  function forgetDisappearedMessages() {
    const visibleKeys = getVisibleRedTextKeys();
    let changed = false;

    Array.from(state.seenRedTextKeys).forEach((key) => {
      if (!visibleKeys.has(key)) {
        state.seenRedTextKeys.delete(key);
        changed = true;
      }
    });

    if (!visibleKeys.size) {
      state.seenRedNodes = new WeakSet();
    }

    if (changed) refreshUiValues();
  }

  function shouldIgnoreDuplicate(node, text, now = Date.now()) {
    forgetDisappearedMessages();

    const key = getRedTextKey(text);
    if (!key) return true;

    if (node && typeof node === "object") {
      if (state.seenRedNodes.has(node)) return true;
      state.seenRedNodes.add(node);
    }

    if (state.seenRedTextKeys.has(key)) return true;
    state.seenRedTextKeys.add(key);

    state.lastSeenText = text;
    state.lastSeenAt = now;
    return false;
  }

  function startAlert(now = Date.now(), text = "") {
    if (state.alertStartedAt) return;
    state.alertStartedAt = now;
    state.lastBeepAt = 0;
    bot.log("red text alert triggered", { text });
    tickAlert();
  }

  function inspectNode(node) {
    if (!config.enabled || !state.running || !node) return false;
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      if (parent && elementHasRedText(parent)) return handleRedText(parent, getNodeText(parent));
      return false;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || !elementHasRedText(node)) return false;
    return handleRedText(node, getNodeText(node));
  }

  function handleRedText(node, text = "") {
    const now = Date.now();
    if (shouldIgnoreDuplicate(node, text, now)) return false;
    startAlert(now, text);
    return true;
  }

  function stopAlertTimer() {
    if (state.alertTimerId != null) window.clearTimeout(state.alertTimerId);
    state.alertTimerId = null;
  }

  function tickAlert() {
    stopAlertTimer();
    if (!config.enabled || !state.running || !state.alertStartedAt) return;
    const now = Date.now();
    const durationMs = positiveInt(config.alertDurationMs, 30000);
    const intervalMs = positiveInt(config.beepIntervalMs, 5000);
    if (now - state.alertStartedAt >= durationMs) {
      state.alertStartedAt = 0;
      refreshUiValues();
      return;
    }
    if (!state.lastBeepAt || now - state.lastBeepAt >= intervalMs) {
      if (beep()) state.lastBeepAt = now;
    }
    state.alertTimerId = window.setTimeout(tickAlert, Math.max(250, Math.min(intervalMs, durationMs - (now - state.alertStartedAt))));
    refreshUiValues();
  }

  function startObserver() {
    stopObserver();
    state.observer = new MutationObserver((mutations) => {
      forgetDisappearedMessages();
      mutations.forEach((mutation) => mutation.addedNodes.forEach(inspectNode));
    });
    state.observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (state.observer) state.observer.disconnect();
    state.observer = null;
  }

  function startForgetTimer() {
    stopForgetTimer();
    state.forgetTimerId = window.setInterval(forgetDisappearedMessages, 1000);
  }

  function stopForgetTimer() {
    if (state.forgetTimerId != null) window.clearInterval(state.forgetTimerId);
    state.forgetTimerId = null;
  }

  function start(overrides = {}) {
    updateConfig(Object.assign({}, overrides, { enabled: true, scanExistingOnStart: false }), { silent: true });
    if (state.running) return false;
    state.running = true;
    startObserver();
    startForgetTimer();
    bot.log("red text alert started", { ...config });
    refreshUiValues();
    return true;
  }

  function stop(options = {}) {
    state.running = false;
    state.alertStartedAt = 0;
    state.lastBeepAt = 0;
    stopObserver();
    stopAlertTimer();
    stopForgetTimer();
    if (options.persistEnabled !== false) { config.enabled = false; persistConfig(); }
    bot.log("red text alert stopped");
    refreshUiValues();
    return true;
  }

  function updateConfig(nextConfig = {}, options = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "beepIntervalMs")) nextConfig.beepIntervalMs = positiveInt(nextConfig.beepIntervalMs, config.beepIntervalMs || 5000);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "alertDurationMs")) nextConfig.alertDurationMs = positiveInt(nextConfig.alertDurationMs, config.alertDurationMs || 30000);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "scanExistingOnStart")) nextConfig.scanExistingOnStart = false;
    Object.assign(config, nextConfig);
    config.scanExistingOnStart = false;
    persistConfig();
    if (!options.silent) refreshUiValues();
    return { ...config };
  }

  function resetSeenMessages() {
    state.seenRedTextKeys.clear();
    state.seenRedNodes = new WeakSet();
    bot.log("red text alert seen messages reset");
  }

  function status() {
    forgetDisappearedMessages();
    const now = Date.now();
    const remainingMs = state.alertStartedAt ? Math.max(0, positiveInt(config.alertDurationMs, 30000) - (now - state.alertStartedAt)) : 0;
    return { running: state.running, config: { ...config }, alertActive: remainingMs > 0, remainingMs, lastSeenText: state.lastSeenText, lastSeenAt: state.lastSeenAt, lastBeepAt: state.lastBeepAt, seenMessageCount: state.seenRedTextKeys.size };
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
        <div class="mb-small-note">Beeps when a new red console message first appears. If the message disappears, it can alert again next time.</div>
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
    if (label) label.textContent = !state.running ? "Alert: off" : current.alertActive ? `Alert: beeping (${Math.ceil(current.remainingMs / 1000)}s left)` : `Alert: watching (${current.seenMessageCount} visible seen)`;
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
