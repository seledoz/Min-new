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
    lastNoCaptchaAt: 0,
    audioContext: null,
    baselineCaptchaKeys: new Set(),
  };

  const config = Object.assign(
    {
      enabled: false,
      beepIntervalMs: 1000,
      alertDurationMs: 60000,
      clearEventAfterNoCaptchaMs: 1500,
      scanMs: 250,
      minChoiceCount: 5,
      maxChoiceCount: 9,
      scanExistingOnStart: false,
    },
    bot.storage.get(configStorageKey, {}) || {}
  );

  config.beepIntervalMs = positiveInt(config.beepIntervalMs, 1000);
  config.alertDurationMs = positiveInt(config.alertDurationMs, 60000);
  config.clearEventAfterNoCaptchaMs = positiveInt(config.clearEventAfterNoCaptchaMs, 1500);
  config.scanMs = Math.max(100, positiveInt(config.scanMs, 250));
  config.minChoiceCount = Math.max(3, positiveInt(config.minChoiceCount, 5));
  config.maxChoiceCount = Math.max(config.minChoiceCount, positiveInt(config.maxChoiceCount, 9));
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
    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(980, now);
    oscillator.frequency.setValueAtTime(740, now + 0.18);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.38);
    return true;
  }

  function isIgnoredElement(element) {
    return !!element?.closest?.("#minibia-bot-panel, #k9x-panel, #minibia-bot-style, script, style");
  }

  function isVisibleElement(element) {
    if (!(element instanceof Element) || isIgnoredElement(element)) return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0.02;
  }

  function hasImageLikeContent(element) {
    if (!(element instanceof Element)) return false;
    const tagName = element.tagName?.toLowerCase?.() || "";
    if (["canvas", "img", "svg", "picture"].includes(tagName)) return true;
    const style = window.getComputedStyle(element);
    return !!style.backgroundImage && style.backgroundImage !== "none";
  }

  function getZIndexValue(element) {
    const value = Number.parseInt(window.getComputedStyle(element).zIndex, 10);
    return Number.isFinite(value) ? value : 0;
  }

  function isPopupCandidate(element) {
    if (!isVisibleElement(element)) return false;
    const rect = element.getBoundingClientRect();
    const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
    const style = window.getComputedStyle(element);
    const position = style.position;
    const zIndex = getZIndexValue(element);
    if (rect.width < 180 || rect.width > Math.min(760, viewportWidth * 0.95)) return false;
    if (rect.height < 160 || rect.height > Math.min(720, viewportHeight * 0.95)) return false;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const nearCenter = Math.abs(centerX - viewportWidth / 2) <= viewportWidth * 0.38 && Math.abs(centerY - viewportHeight / 2) <= viewportHeight * 0.38;
    const overlayLike = ["fixed", "absolute", "sticky"].includes(position) || zIndex >= 10;
    const visibleBorderOrBg = style.backgroundColor !== "rgba(0, 0, 0, 0)" || style.borderStyle !== "none";
    return nearCenter && overlayLike && visibleBorderOrBg;
  }

  function getChoiceElements(root) {
    const choices = [];
    const seen = new Set();
    const elements = Array.from(root.querySelectorAll?.("*") || []);
    for (const element of elements) {
      if (!isVisibleElement(element) || seen.has(element)) continue;
      if (!hasImageLikeContent(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 24 || rect.width > 140 || rect.height > 140) continue;
      const ratio = rect.width / rect.height;
      if (ratio < 0.55 || ratio > 1.85) continue;
      const parent = element.closest?.("button, [role='button'], a, label") || element.parentElement || element;
      const choice = parent instanceof Element && isVisibleElement(parent) ? parent : element;
      const choiceRect = choice.getBoundingClientRect();
      if (choiceRect.width < 28 || choiceRect.height < 28 || choiceRect.width > 170 || choiceRect.height > 170) continue;
      if (!seen.has(choice)) {
        seen.add(choice);
        choices.push(choice);
      }
    }
    return choices;
  }

  function hasGridLikeLayout(elements) {
    if (!elements.length) return false;
    const centers = elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), width: rect.width, height: rect.height };
    });
    const rows = [];
    for (const center of centers) {
      let row = rows.find((candidate) => Math.abs(candidate.y - center.y) <= Math.max(12, center.height * 0.45));
      if (!row) {
        row = { y: center.y, items: [] };
        rows.push(row);
      }
      row.items.push(center);
      row.y = row.items.reduce((sum, item) => sum + item.y, 0) / row.items.length;
    }
    const rowCounts = rows.map((row) => row.items.length).sort((a, b) => b - a);
    return rowCounts.filter((count) => count >= 2).length >= 2 && (rowCounts[0] || 0) >= 2;
  }

  function getCaptchaKey(element, choices) {
    const rect = element.getBoundingClientRect();
    return [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height), choices.length].join(":");
  }

  function getCaptchaCandidates() {
    const candidates = [];
    const roots = Array.from(document.body?.querySelectorAll?.("*") || []).filter(isPopupCandidate).sort((a, b) => getZIndexValue(b) - getZIndexValue(a));
    for (const root of roots) {
      const choices = getChoiceElements(root);
      if (choices.length < config.minChoiceCount || choices.length > config.maxChoiceCount) continue;
      if (!hasGridLikeLayout(choices)) continue;
      candidates.push({ element: root, choices, key: getCaptchaKey(root, choices) });
    }
    return candidates;
  }

  function refreshBaselineCaptchas() {
    const visibleKeys = new Set(getCaptchaCandidates().map((candidate) => candidate.key).filter(Boolean));
    for (const key of Array.from(state.baselineCaptchaKeys)) if (!visibleKeys.has(key)) state.baselineCaptchaKeys.delete(key);
    return visibleKeys;
  }

  function findFirstNewCaptcha() {
    refreshBaselineCaptchas();
    return getCaptchaCandidates().find((candidate) => candidate.key && !state.baselineCaptchaKeys.has(candidate.key)) || null;
  }

  function hasCaptchaNow() { return getCaptchaCandidates().length > 0; }

  function startAlert(text = "Captcha popup detected") {
    if (!config.enabled || !state.running || state.mode !== "watching") return false;
    const now = Date.now();
    state.mode = "beeping";
    state.alertStartedAt = now;
    state.lastBeepAt = 0;
    state.lastSeenText = text;
    state.lastSeenAt = now;
    state.baselineCaptchaKeys.clear();
    bot.log("captcha alarm triggered", { text, beepIntervalMs: config.beepIntervalMs, alertDurationMs: config.alertDurationMs });
    tickAlert();
    refreshUiValues();
    return true;
  }

  function scanForCaptcha() {
    if (!config.enabled || !state.running) return;
    if (state.mode === "watching") {
      const captcha = findFirstNewCaptcha();
      if (captcha) startAlert(`Captcha popup detected (${captcha.choices.length} choices)`);
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
    const durationMs = positiveInt(config.alertDurationMs, 60000);
    const intervalMs = positiveInt(config.beepIntervalMs, 1000);
    const elapsedMs = now - state.alertStartedAt;
    if (elapsedMs >= durationMs) {
      state.alertStartedAt = 0;
      state.lastBeepAt = 0;
      state.mode = "waiting-clear";
      state.lastNoCaptchaAt = 0;
      state.baselineCaptchaKeys = new Set(getCaptchaCandidates().map((candidate) => candidate.key).filter(Boolean));
      refreshUiValues();
      return;
    }
    if (!state.lastBeepAt || now - state.lastBeepAt >= intervalMs) {
      if (beep()) state.lastBeepAt = now;
    }
    state.alertTimerId = window.setTimeout(tickAlert, 200);
    refreshUiValues();
  }

  function checkForClear() {
    if (!state.running || state.mode !== "waiting-clear") return;
    const now = Date.now();
    if (hasCaptchaNow()) {
      state.lastNoCaptchaAt = 0;
      refreshBaselineCaptchas();
      return;
    }
    if (!state.lastNoCaptchaAt) {
      state.lastNoCaptchaAt = now;
      return;
    }
    if (now - state.lastNoCaptchaAt >= positiveInt(config.clearEventAfterNoCaptchaMs, 1500)) {
      state.mode = "watching";
      state.lastNoCaptchaAt = 0;
      state.baselineCaptchaKeys.clear();
      refreshUiValues();
    }
  }

  function startScanTimer() {
    stopScanTimer();
    state.scanTimerId = window.setInterval(scanForCaptcha, Math.max(100, positiveInt(config.scanMs, 250)));
  }

  function stopScanTimer() {
    if (state.scanTimerId != null) window.clearInterval(state.scanTimerId);
    state.scanTimerId = null;
  }

  function inspectAddedNode(node) {
    if (!config.enabled || !state.running || state.mode !== "watching") return false;
    const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!(element instanceof Element)) return false;
    const roots = [element, ...Array.from(element.querySelectorAll?.("*") || [])];
    for (const root of roots) {
      if (!isPopupCandidate(root)) continue;
      const choices = getChoiceElements(root);
      if (choices.length < config.minChoiceCount || choices.length > config.maxChoiceCount) continue;
      if (!hasGridLikeLayout(choices)) continue;
      const key = getCaptchaKey(root, choices);
      if (key && state.baselineCaptchaKeys.has(key)) return false;
      return startAlert(`Captcha popup detected (${choices.length} choices)`);
    }
    return false;
  }

  function startObserver() {
    stopObserver();
    state.observer = new MutationObserver((mutations) => {
      if (state.mode !== "watching") return;
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && inspectAddedNode(mutation.target)) return;
        for (const node of mutation.addedNodes) if (inspectAddedNode(node)) return;
      }
    });
    state.observer.observe(document.body || document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden", "aria-hidden"] });
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
    state.lastNoCaptchaAt = 0;
    state.baselineCaptchaKeys = new Set(getCaptchaCandidates().map((candidate) => candidate.key).filter(Boolean));
    startObserver();
    startScanTimer();
    bot.log("captcha alarm started", { ...config, mode: state.mode, baselineCaptchaCount: state.baselineCaptchaKeys.size });
    refreshUiValues();
    return true;
  }

  function stop(options = {}) {
    state.running = false;
    state.mode = "watching";
    state.alertStartedAt = 0;
    state.lastBeepAt = 0;
    state.lastNoCaptchaAt = 0;
    state.baselineCaptchaKeys.clear();
    stopObserver();
    stopAlertTimer();
    stopScanTimer();
    if (options.persistEnabled !== false) {
      config.enabled = false;
      persistConfig();
    }
    bot.log("captcha alarm stopped");
    refreshUiValues();
    return true;
  }

  function updateConfig(nextConfig = {}, options = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "beepIntervalMs")) nextConfig.beepIntervalMs = positiveInt(nextConfig.beepIntervalMs, config.beepIntervalMs || 1000);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "alertDurationMs")) nextConfig.alertDurationMs = positiveInt(nextConfig.alertDurationMs, config.alertDurationMs || 60000);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "clearEventAfterNoCaptchaMs")) nextConfig.clearEventAfterNoCaptchaMs = positiveInt(nextConfig.clearEventAfterNoCaptchaMs, config.clearEventAfterNoCaptchaMs || 1500);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "clearEventAfterNoRedMs")) nextConfig.clearEventAfterNoCaptchaMs = positiveInt(nextConfig.clearEventAfterNoRedMs, config.clearEventAfterNoCaptchaMs || 1500);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "scanMs")) nextConfig.scanMs = Math.max(100, positiveInt(nextConfig.scanMs, config.scanMs || 250));
    if (Object.prototype.hasOwnProperty.call(nextConfig, "minChoiceCount")) nextConfig.minChoiceCount = Math.max(3, positiveInt(nextConfig.minChoiceCount, config.minChoiceCount || 5));
    if (Object.prototype.hasOwnProperty.call(nextConfig, "maxChoiceCount")) nextConfig.maxChoiceCount = Math.max(config.minChoiceCount, positiveInt(nextConfig.maxChoiceCount, config.maxChoiceCount || 9));
    if (Object.prototype.hasOwnProperty.call(nextConfig, "scanExistingOnStart")) nextConfig.scanExistingOnStart = false;
    Object.assign(config, nextConfig);
    config.scanExistingOnStart = false;
    config.minChoiceCount = Math.max(3, positiveInt(config.minChoiceCount, 5));
    config.maxChoiceCount = Math.max(config.minChoiceCount, positiveInt(config.maxChoiceCount, 9));
    persistConfig();
    if (state.running && Object.prototype.hasOwnProperty.call(nextConfig, "scanMs")) startScanTimer();
    if (!options.silent) refreshUiValues();
    return { ...config };
  }

  function resetSeenMessages() {
    state.mode = "watching";
    state.alertStartedAt = 0;
    state.lastBeepAt = 0;
    state.lastNoCaptchaAt = 0;
    state.baselineCaptchaKeys.clear();
    stopAlertTimer();
    bot.log("captcha alarm state reset");
    refreshUiValues();
  }

  function status() {
    const now = Date.now();
    const remainingMs = state.mode === "beeping" && state.alertStartedAt ? Math.max(0, positiveInt(config.alertDurationMs, 60000) - (now - state.alertStartedAt)) : 0;
    const candidates = getCaptchaCandidates();
    return {
      running: state.running,
      config: { ...config },
      mode: state.mode,
      alertActive: state.mode === "beeping" && remainingMs > 0,
      remainingMs,
      lastSeenText: state.lastSeenText,
      lastSeenAt: state.lastSeenAt,
      lastBeepAt: state.lastBeepAt,
      captchaVisibleNow: candidates.length > 0,
      captchaCandidateCount: candidates.length,
      visibleRedTextNow: false,
      visibleRedCount: 0,
      baselineCaptchaCount: state.baselineCaptchaKeys.size,
      baselineRedTextCount: state.baselineCaptchaKeys.size,
      consoleRootCount: candidates.length,
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
      <div class="mb-label">Captcha Alarm</div>
      <div class="mb-stack">
        <label class="mb-toggle"><input type="checkbox" id="k9x-red-text-alert-enabled" /><span>Enable Captcha Alarm</span></label>
        <div class="mb-small-note" id="k9x-red-text-alert-status">Alert: off</div>
        <div class="mb-small-note">Alarms when a verification popup with a creature-choice grid appears. It does not click or solve it.</div>
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
          ? `Alert: CAPTCHA (${Math.ceil(current.remainingMs / 1000)}s left)`
          : `Alert: watching for popup (${current.captchaCandidateCount} visible)`;
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
