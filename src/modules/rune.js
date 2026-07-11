window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installRuneModule = function installRuneModule(bot) {
  const configStorageKey = "minibiaBot.rune.config";
  const state = {
    running: false,
    timerId: null,
    watchdogId: null,
    lastTickAt: 0,
    tickInProgress: false,
    lastRuneAt: 0,
  };
  let resumeListenersAttached = false;

  const config = Object.assign(
    {
      tickMs: 50,
      minHpPercent: 50,
      minFoodSeconds: 30,
      runeSpellWords: "adori vita vis",
      runeManaCost: 600,
      runeCooldownMs: 3500,
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );
  config.tickMs = 50;

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function readStats() {
    const playerState = bot.getPlayerState();

    const hp = playerState
      ? { current: playerState.health ?? 0, max: playerState.maxHealth ?? 0 }
      : null;

    const mana = playerState
      ? { current: playerState.mana ?? 0, max: playerState.maxMana ?? 0 }
      : null;

    const foodText =
      document.querySelector('#skill-window div[skill="food"] .skill')?.textContent?.trim() ||
      null;

    let food = null;
    if (foodText) {
      const match = foodText.match(/^(\d{1,2}):(\d{2})$/);
      food = match
        ? {
            text: foodText,
            seconds: Number(match[1]) * 60 + Number(match[2]),
          }
        : { text: foodText, seconds: null };
    }

    return { hp, mana, food };
  }

  function getGateStatus(now = Date.now()) {
    const { hp, mana, food } = readStats();
    if (!hp || !mana) {
      return {
        hasStats: false,
        enoughHp: false,
        enoughMana: false,
        enoughFood: false,
        cooldownReady: false,
        cooldownRemainingMs: config.runeCooldownMs,
        canMakeRune: false,
      };
    }

    const hpPercent = hp.max > 0 ? (hp.current / hp.max) * 100 : 0;
    const enoughHp = hpPercent >= config.minHpPercent;
    const enoughMana = mana.current >= config.runeManaCost;
    const enoughFood = food?.seconds == null || food.seconds >= config.minFoodSeconds;
    const cooldownElapsedMs = now - state.lastRuneAt;
    const cooldownRemainingMs = Math.max(0, config.runeCooldownMs - cooldownElapsedMs);
    const cooldownReady = cooldownRemainingMs === 0;

    return {
      hasStats: true,
      enoughHp,
      enoughMana,
      enoughFood,
      cooldownReady,
      cooldownRemainingMs,
      canMakeRune: enoughHp && enoughMana && enoughFood && cooldownReady,
    };
  }

  function canMakeRune(now = Date.now()) {
    return getGateStatus(now).canMakeRune;
  }

  function tryMakeRune(now = Date.now()) {
    const gateStatus = getGateStatus(now);
    if (!gateStatus.canMakeRune) {
      return false;
    }

    const sent = bot.sendChat(config.runeSpellWords);
    if (sent) {
      state.lastRuneAt = Date.now();
      return true;
    }

    bot.log("rune spell send failed, will retry", {
      mana: gateStatus.hasStats ? readStats().mana?.current : null,
      requiredMana: config.runeManaCost,
      spell: config.runeSpellWords,
    });
    return false;
  }

  function clearTickTimer() {
    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }
  }

  function scheduleNextTick() {
    if (!state.running) return;

    clearTickTimer();
    state.timerId = window.setTimeout(() => {
      state.timerId = null;
      tick();
    }, Math.max(25, Number(config.tickMs) || 50));
  }

  function runImmediateTick() {
    if (!state.running) return;

    clearTickTimer();
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

  function startWatchdog() {
    if (state.watchdogId != null) {
      return;
    }

    state.watchdogId = window.setInterval(() => {
      if (!state.running || state.tickInProgress) {
        return;
      }

      const staleForMs = Date.now() - state.lastTickAt;
      if (state.lastTickAt === 0 || staleForMs >= 2000 || state.timerId == null) {
        bot.log("rune loop watchdog restarting stalled timer", { staleForMs });
        runImmediateTick();
      }
    }, 1000);
  }

  function stopWatchdog() {
    if (state.watchdogId != null) {
      window.clearInterval(state.watchdogId);
      state.watchdogId = null;
    }
  }

  function tick() {
    if (!state.running || state.tickInProgress) return;

    state.tickInProgress = true;
    state.lastTickAt = Date.now();

    try {
      tryMakeRune();
    } catch (error) {
      bot.log("rune tick failed", error?.message || error);
    } finally {
      state.tickInProgress = false;
      state.lastTickAt = Date.now();
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    config.tickMs = 50;
    persistConfig();

    if (state.running) {
      bot.log("rune maker already running");
      runImmediateTick();
      return false;
    }

    state.running = true;
    state.lastTickAt = Date.now();
    attachResumeListeners();
    startWatchdog();
    bot.log("rune maker started", { ...config });
    tick();
    return true;
  }

  function stop(options = {}) {
    const shouldPersistEnabled = options.persistEnabled !== false;
    state.running = false;
    state.tickInProgress = false;

    clearTickTimer();
    stopWatchdog();
    detachResumeListeners();

    if (shouldPersistEnabled) {
      config.enabled = false;
      persistConfig();
    }
    bot.log("rune maker stopped");
    return true;
  }

  function status() {
    return {
      running: state.running,
      config: { ...config },
      stats: readStats(),
      gates: getGateStatus(),
      lastRuneAt: state.lastRuneAt,
      lastTickAt: state.lastTickAt,
      watchdogRunning: state.watchdogId != null,
    };
  }

  function updateConfig(nextConfig = {}) {
    Object.assign(config, nextConfig);
    config.tickMs = 50;
    persistConfig();
    bot.log("rune config updated", { ...config });
    return { ...config };
  }

  if (config.enabled) {
    start();
  }

  bot.rune = {
    start,
    stop,
    status,
    readStats,
    getGateStatus,
    canMakeRune,
    tryMakeRune,
    config,
    updateConfig,
  };

  bot.startRuneLoop = start;
  bot.stopRuneLoop = stop;
};