window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installAutoHasteModule = function installAutoHasteModule(bot) {
  const configStorageKey = "minibiaBot.autoHaste.config";
  const HASTE_PATTERN = /(haste|hasted|speed|swift|utani)/i;
  const state = {
    running: false,
    timerId: null,
    lastCastAt: 0,
    assumedActiveUntil: 0,
    detectionSource: null,
    detectedElement: null,
    uiObserver: null,
  };

  const config = Object.assign(
    {
      enabled: false,
      spellWords: "",
      tickMs: 100,
      recastCooldownMs: 2100,
      assumedActiveMs: 15000,
    },
    bot.storage.get(configStorageKey, {})
  );
  config.tickMs = 100;
  config.recastCooldownMs = 2100;
  config.assumedActiveMs = 15000;

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    if (element.closest("#minibia-bot-panel")) return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width < 8 || rect.height < 8) return false;
    const style = window.getComputedStyle?.(element);
    return !style || (style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0);
  }

  function getElementSignals(element) {
    if (!(element instanceof Element)) return "";
    const values = [
      element.id,
      element.className,
      element.getAttribute("title"),
      element.getAttribute("aria-label"),
      element.getAttribute("alt"),
      element.getAttribute("src"),
      element.getAttribute("data-condition"),
      element.getAttribute("data-status"),
      element.getAttribute("data-effect"),
      element.getAttribute("data-tooltip"),
    ];
    try {
      values.push(window.getComputedStyle(element).backgroundImage);
    } catch (_error) {}
    return values.filter(Boolean).map(String).join(" ");
  }

  function getHasteConditionId() {
    const conditionManagerPrototype = window.ConditionManager?.prototype;
    const playerConditions = window.gameClient?.player?.conditions;
    const candidateKeys = ["HASTE", "HASTED", "SPEED", "SWIFTNESS", "UTANI_HUR", "UTANI_GRAN_HUR"];
    for (const key of candidateKeys) {
      const value = conditionManagerPrototype?.[key] ?? playerConditions?.[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return null;
  }

  function hasHasteCondition() {
    const player = window.gameClient?.player;
    const conditions = player?.conditions;
    const conditionId = getHasteConditionId();
    if (conditionId == null) return false;
    if (typeof conditions?.has === "function" && conditions.has(conditionId)) {
      state.detectionSource = `condition:${conditionId}`;
      return true;
    }
    if (typeof player?.hasCondition === "function" && player.hasCondition(conditionId)) {
      state.detectionSource = `player-condition:${conditionId}`;
      return true;
    }
    return false;
  }

  function findHasteStatusIcon() {
    state.detectionSource = null;
    state.detectedElement = null;

    const statusRoots = Array.from(document.querySelectorAll([
      "#conditions",
      "#condition-bar",
      "#conditionBar",
      "#status-effects",
      "#statusEffects",
      ".conditions",
      ".condition-bar",
      ".status-effects",
      ".status-icons",
      ".buffs",
      '[data-role="conditions"]',
      '[data-role="status-effects"]',
    ].join(","))).filter(isVisible);

    const candidateSelector = [
      '[title*="haste" i]',
      '[aria-label*="haste" i]',
      '[alt*="haste" i]',
      '[data-condition*="haste" i]',
      '[data-status*="haste" i]',
      '[data-effect*="haste" i]',
      '[title*="speed" i]',
      '[aria-label*="speed" i]',
      '[alt*="speed" i]',
      '[title*="utani" i]',
      '[aria-label*="utani" i]',
      '[alt*="utani" i]',
      "img",
      '[class*="icon" i]',
    ].join(",");

    for (const root of statusRoots) {
      for (const element of [root, ...root.querySelectorAll(candidateSelector)]) {
        if (!isVisible(element) || !HASTE_PATTERN.test(getElementSignals(element))) continue;
        state.detectedElement = element;
        state.detectionSource = `status-area:${element.id || element.className || element.tagName}`;
        return element;
      }
    }
    return null;
  }

  function isHasteActive(now = Date.now()) {
    if (hasHasteCondition()) return true;
    if (findHasteStatusIcon()) return true;
    if (now < state.assumedActiveUntil) {
      state.detectionSource = "post-cast-hold";
      return true;
    }
    return false;
  }

  function shouldPrioritizeHpHeal() {
    const healStatus = bot.heal?.status?.();
    const hp = Number(healStatus?.stats?.hp?.current);
    const minHp = Math.max(0, Number(bot.heal?.config?.minHp) || 0);
    return !!healStatus?.running && !!bot.heal?.config?.enabled && Number.isFinite(hp) && hp > 0 && hp <= minHp;
  }

  function tryAutoHaste(now = Date.now()) {
    if (!state.running || !config.enabled) return false;
    const spellWords = String(config.spellWords || "").trim();
    if (!spellWords || isHasteActive(now)) return false;
    if (shouldPrioritizeHpHeal()) {
      bot.heal?.tryHeal?.();
      return false;
    }
    if (now - state.lastCastAt < config.recastCooldownMs) return false;

    const sent = bot.sendChat(spellWords);
    if (sent) {
      state.lastCastAt = now;
      state.assumedActiveUntil = now + config.assumedActiveMs;
      state.detectionSource = "post-cast-hold";
      bot.log("cast auto haste spell", {
        spellWords,
        cooldownMs: config.recastCooldownMs,
        assumedActiveMs: config.assumedActiveMs,
      });
    }
    return sent;
  }

  function clearTimer() {
    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }
  }

  function tick() {
    if (!state.running) return;
    try {
      tryAutoHaste();
    } catch (error) {
      bot.log("auto haste tick failed", error?.message || error);
    } finally {
      clearTimer();
      if (state.running) state.timerId = window.setTimeout(tick, config.tickMs);
    }
  }

  function syncUi() {
    const toggle = document.getElementById("minibia-bot-auto-haste-enabled");
    const spellInput = document.getElementById("minibia-bot-auto-haste-spell");
    if (toggle) toggle.checked = state.running && config.enabled;
    if (spellInput && document.activeElement !== spellInput) spellInput.value = config.spellWords || "";
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, {
      enabled: true,
      tickMs: 100,
      recastCooldownMs: 2100,
      assumedActiveMs: 15000,
    });
    config.spellWords = String(config.spellWords || "").trim();
    persistConfig();
    if (state.running) {
      syncUi();
      tryAutoHaste();
      return false;
    }
    state.running = true;
    tick();
    syncUi();
    bot.log("auto haste started", { ...config });
    return true;
  }

  function stop(options = {}) {
    state.running = false;
    config.enabled = false;
    state.assumedActiveUntil = 0;
    clearTimer();
    if (options.persistEnabled !== false) persistConfig();
    syncUi();
    bot.log("auto haste stopped");
    return true;
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "spellWords")) {
      nextConfig.spellWords = String(nextConfig.spellWords || "").trim();
    }
    Object.assign(config, nextConfig, {
      tickMs: 100,
      recastCooldownMs: 2100,
      assumedActiveMs: 15000,
    });
    persistConfig();
    syncUi();
    return { ...config };
  }

  function installUi() {
    if (document.getElementById("minibia-bot-auto-haste-enabled")) {
      syncUi();
      return true;
    }
    const autoHealToggle = document.getElementById("minibia-bot-auto-heal-enabled");
    const autoHealStack = autoHealToggle?.closest?.(".mb-section")?.querySelector?.(".mb-stack");
    if (!autoHealStack) return false;

    const wrapper = document.createElement("div");
    wrapper.className = "mb-stack";
    wrapper.style.paddingTop = "8px";
    wrapper.style.borderTop = "1px solid rgba(224, 200, 148, 0.16)";
    wrapper.innerHTML = `
      <div class="mb-row">
        <label class="mb-toggle">
          <input type="checkbox" id="minibia-bot-auto-haste-enabled" />
          <span>Auto Haste</span>
        </label>
        <input type="text" id="minibia-bot-auto-haste-spell" placeholder="Spell words" />
      </div>
      <div class="mb-small-note">Casts when haste is inactive. Holds for 15 seconds after a successful cast. Auto Heal has priority. Does not cast with monsters within 4 squares.</div>
    `;
    autoHealStack.appendChild(wrapper);

    const toggle = wrapper.querySelector("#minibia-bot-auto-haste-enabled");
    const spellInput = wrapper.querySelector("#minibia-bot-auto-haste-spell");
    spellInput.value = config.spellWords || "";
    toggle.checked = state.running && config.enabled;
    spellInput.addEventListener("change", () => {
      config.spellWords = String(spellInput.value || "").trim();
      persistConfig();
    });
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const spellWords = String(spellInput.value || "").trim();
      if (state.running || config.enabled) {
        config.spellWords = spellWords;
        stop();
      } else {
        updateConfig({ spellWords });
        start({ spellWords });
      }
      syncUi();
    });
    return true;
  }

  function status() {
    const hasteActive = isHasteActive();
    return {
      running: state.running,
      config: { ...config },
      hasteActive,
      healPriorityActive: shouldPrioritizeHpHeal(),
      detectionSource: state.detectionSource,
      detectedElement: state.detectedElement ? {
        tag: state.detectedElement.tagName,
        id: state.detectedElement.id || null,
        className: String(state.detectedElement.className || "") || null,
      } : null,
      lastCastAt: state.lastCastAt,
      assumedActiveUntil: state.assumedActiveUntil,
    };
  }

  state.uiObserver = new MutationObserver(() => installUi());
  state.uiObserver.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(installUi, 0);

  bot.addCleanup?.(() => {
    stop({ persistEnabled: false });
    state.uiObserver?.disconnect();
  });

  bot.autoHaste = {
    start,
    stop,
    status,
    updateConfig,
    isHasteActive,
    shouldPrioritizeHpHeal,
    tryAutoHaste,
    config,
  };

  if (config.enabled) start();
};