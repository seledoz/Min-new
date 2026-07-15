window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installAutoInvisibleModule = function installAutoInvisibleModule(bot) {
  const configStorageKey = "minibiaBot.invisible.config";
  const INVISIBLE_CONDITION_ID = 4;
  const state = {
    running: false,
    timerId: null,
    lastCastAt: 0,
  };
  let resumeListenersAttached = false;

  const config = Object.assign(
    {
      tickMs: 500,
      spellWords: "utana vid",
      recastCooldownMs: 2000,
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );
  config.tickMs = 500;

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function getInvisibleConditionId() {
    return window.ConditionManager?.prototype?.INVISIBLE ?? INVISIBLE_CONDITION_ID;
  }

  function isInvisibleActive() {
    const player = window.gameClient?.player;
    const conditions = player?.conditions;
    const invisibleConditionId = getInvisibleConditionId();

    if (conditions?.has) {
      return conditions.has(invisibleConditionId);
    }

    if (player?.hasCondition) {
      return player.hasCondition(invisibleConditionId);
    }

    return false;
  }

  function getGateStatus(now = Date.now()) {
    const cooldownRemainingMs = Math.max(0, config.recastCooldownMs - (now - state.lastCastAt));
    const cooldownReady = cooldownRemainingMs === 0;
    const invisibleActive = isInvisibleActive();

    return {
      invisibleActive,
      cooldownReady,
      cooldownRemainingMs,
      canCast: !invisibleActive && cooldownReady,
    };
  }

  function canCastInvisible(now = Date.now()) {
    return getGateStatus(now).canCast;
  }

  function tryCastInvisible(now = Date.now()) {
    if (!config.enabled || !canCastInvisible(now)) {
      return false;
    }

    const sent = bot.sendChat(config.spellWords);
    if (sent) {
      state.lastCastAt = now;
      bot.log("cast invisible spell", { spellWords: config.spellWords });
    }

    return sent;
  }

  function scheduleNextTick() {
    if (!state.running) return;

    state.timerId = window.setTimeout(() => {
      tick();
    }, config.tickMs);
  }

  function runImmediateTick() {
    if (!state.running) return;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    tick();
  }

  function handleResume() {
    if (document.hidden) {
      return;
    }

    runImmediateTick();
  }

  function attachResumeListeners() {
    if (resumeListenersAttached) {
      return;
    }

    document.addEventListener("visibilitychange", handleResume);
    window.addEventListener("focus", handleResume);
    window.addEventListener("pageshow", handleResume);
    resumeListenersAttached = true;
  }

  function detachResumeListeners() {
    if (!resumeListenersAttached) {
      return;
    }

    document.removeEventListener("visibilitychange", handleResume);
    window.removeEventListener("focus", handleResume);
    window.removeEventListener("pageshow", handleResume);
    resumeListenersAttached = false;
  }

  function tick() {
    if (!state.running) return;

    try {
      tryCastInvisible();
    } catch (error) {
      bot.log("auto invisible tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    config.tickMs = 500;
    persistConfig();

    if (state.running) {
      bot.log("auto invisible already running");
      return false;
    }

    state.running = true;
    attachResumeListeners();
    bot.log("auto invisible started", { ...config });
    tick();
    return true;
  }

  function stop(options = {}) {
    const shouldPersistEnabled = options.persistEnabled !== false;
    state.running = false;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    detachResumeListeners();

    if (shouldPersistEnabled) {
      config.enabled = false;
      persistConfig();
    }

    bot.log("auto invisible stopped");
    return true;
  }

  function status() {
    return {
      running: state.running,
      config: { ...config },
      gates: getGateStatus(),
      lastCastAt: state.lastCastAt,
    };
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "spellWords")) {
      nextConfig.spellWords = String(nextConfig.spellWords || "").trim() || config.spellWords;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "recastCooldownMs")) {
      nextConfig.recastCooldownMs = Math.max(0, Number(nextConfig.recastCooldownMs) || 0);
    }

    Object.assign(config, nextConfig);
    config.tickMs = 500;
    persistConfig();
    bot.log("auto invisible config updated", { ...config });
    return { ...config };
  }

  if (config.enabled) {
    start();
  }

  bot.invisible = {
    start,
    stop,
    status,
    updateConfig,
    isInvisibleActive,
    canCastInvisible,
    tryCastInvisible,
    config,
  };

  installAntiParalyzeModule(bot);
};

function installAntiParalyzeModule(bot) {
  const configStorageKey = "minibiaBot.antiParalyze.config";
  const state = {
    running: false,
    timerId: null,
    lastCastAt: 0,
  };

  const config = Object.assign(
    {
      tickMs: 50,
      spellWords: "",
      recastCooldownMs: 2040,
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function getParalyzeConditionIds() {
    const ids = new Set();
    const sources = [window.ConditionManager, window.ConditionManager?.prototype];

    sources.forEach((source) => {
      if (!source) return;

      Object.getOwnPropertyNames(source).forEach((key) => {
        if (!/paraly/i.test(key)) return;
        const value = source[key];
        if (Number.isFinite(Number(value))) ids.add(Number(value));
      });
    });

    return ids;
  }

  function valueLooksParalyzed(value) {
    if (value == null) return false;
    if (typeof value === "string") return /paraly/i.test(value);
    if (typeof value !== "object") return false;

    return [
      value.name,
      value.type,
      value.condition,
      value.conditionName,
      value.constructor?.name,
    ].some((entry) => typeof entry === "string" && /paraly/i.test(entry));
  }

  function isParalyzedActive() {
    const player = window.gameClient?.player;
    const conditions = player?.conditions;
    const conditionIds = getParalyzeConditionIds();

    for (const conditionId of conditionIds) {
      if (conditions?.has?.(conditionId) || player?.hasCondition?.(conditionId)) {
        return true;
      }
    }

    if (conditions instanceof Map) {
      for (const [key, value] of conditions.entries()) {
        if (valueLooksParalyzed(key) || valueLooksParalyzed(value)) return true;
      }
    } else if (conditions && typeof conditions[Symbol.iterator] === "function") {
      for (const value of conditions) {
        if (valueLooksParalyzed(value)) return true;
      }
    } else if (conditions && typeof conditions === "object") {
      return Object.entries(conditions).some(
        ([key, value]) => /paraly/i.test(key) || valueLooksParalyzed(value)
      );
    }

    return false;
  }

  function shouldPrioritizeHeal() {
    const healStatus = bot.heal?.status?.();
    const stats = bot.heal?.readStats?.();
    const hp = Number(stats?.hp?.current);
    const minHp = Math.max(0, Number(bot.heal?.config?.minHp) || 0);

    return !!healStatus?.running && Number.isFinite(hp) && hp > 0 && hp <= minHp;
  }

  function tryAntiParalyze(now = Date.now()) {
    if (!config.enabled || !state.running) return false;
    if (!String(config.spellWords || "").trim()) return false;
    if (!isParalyzedActive()) return false;

    if (shouldPrioritizeHeal()) {
      bot.heal?.tryHeal?.();
      return false;
    }

    if (now - state.lastCastAt < Math.max(0, Number(config.recastCooldownMs) || 0)) {
      return false;
    }

    const sent = bot.sendChat(String(config.spellWords).trim());
    if (sent) {
      state.lastCastAt = now;
      bot.log("cast anti-paralyze spell", { spellWords: config.spellWords });
    }

    return sent;
  }

  function scheduleNextTick() {
    if (!state.running) return;
    state.timerId = window.setTimeout(tick, Math.max(25, Number(config.tickMs) || 50));
  }

  function tick() {
    if (!state.running) return;

    try {
      tryAntiParalyze();
    } catch (error) {
      bot.log("anti-paralyze tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    config.spellWords = String(config.spellWords || "").trim();
    persistConfig();

    if (state.running) return false;
    state.running = true;
    bot.log("anti-paralyze started", { ...config });
    tick();
    return true;
  }

  function stop(options = {}) {
    state.running = false;
    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    if (options.persistEnabled !== false) {
      config.enabled = false;
      persistConfig();
    }

    bot.log("anti-paralyze stopped");
    return true;
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "spellWords")) {
      nextConfig.spellWords = String(nextConfig.spellWords || "").trim();
    }

    Object.assign(config, nextConfig);
    persistConfig();
    return { ...config };
  }

  function status() {
    return {
      running: state.running,
      config: { ...config },
      paralyzed: isParalyzedActive(),
      healPriorityActive: shouldPrioritizeHeal(),
      lastCastAt: state.lastCastAt,
    };
  }

  function installUi() {
    if (document.getElementById("minibia-bot-anti-paralyze-enabled")) return true;

    const healToggle = document.getElementById("minibia-bot-auto-heal-enabled");
    const healSection = healToggle?.closest?.(".mb-section");
    const healStack = healSection?.querySelector?.(".mb-stack");
    if (!healStack) return false;

    const wrapper = document.createElement("div");
    wrapper.className = "mb-stack";
    wrapper.style.paddingTop = "8px";
    wrapper.style.borderTop = "1px solid rgba(224, 200, 148, 0.16)";
    wrapper.innerHTML = `
      <div class="mb-row">
        <label class="mb-toggle">
          <input type="checkbox" id="minibia-bot-anti-paralyze-enabled" />
          <span>Anti Paralyze</span>
        </label>
        <input type="text" id="minibia-bot-anti-paralyze-spell" placeholder="Spell words" />
      </div>
      <div class="mb-small-note">When HP is at or below the Auto Heal amount, the heal is prioritized and this spell waits.</div>
    `;
    healStack.appendChild(wrapper);

    const enabledInput = wrapper.querySelector("#minibia-bot-anti-paralyze-enabled");
    const spellInput = wrapper.querySelector("#minibia-bot-anti-paralyze-spell");
    spellInput.value = config.spellWords || "";
    enabledInput.checked = state.running;

    spellInput.addEventListener("change", () => {
      updateConfig({ spellWords: spellInput.value });
    });

    enabledInput.addEventListener("change", () => {
      const spellWords = spellInput.value.trim();
      updateConfig({ spellWords });
      if (enabledInput.checked) start({ spellWords });
      else stop();
      enabledInput.checked = state.running;
    });

    return true;
  }

  const uiObserver = new MutationObserver(() => {
    if (installUi()) uiObserver.disconnect();
  });
  uiObserver.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(installUi, 0);
  bot.addCleanup?.(() => uiObserver.disconnect());

  bot.antiParalyze = {
    start,
    stop,
    status,
    updateConfig,
    isParalyzedActive,
    shouldPrioritizeHeal,
    tryAntiParalyze,
    config,
  };

  if (config.enabled) start();
}
