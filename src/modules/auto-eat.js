window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installAutoEatModule = function installAutoEatModule(bot) {
  const configStorageKey = "minibiaBot.eat.config";
  const state = {
    running: false,
    timerId: null,
    lastFoodAt: 0,
    eatAtSecondsRemaining: null,
    lastObservedFoodSeconds: null,
    waitingForTimerReset: false,
  };

  const config = Object.assign(
    {
      tickMs: 1000,
      eatCooldownMs: 60000,
      eatHotbarSlot: 10,
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );
  config.tickMs = 1000;

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function normalizeHotbarSlot(slot) {
    const value = Number(slot);
    if (!Number.isFinite(value)) {
      return null;
    }

    const normalized = Math.trunc(value);
    if (normalized < 1 || normalized > 12) {
      return null;
    }

    return normalized;
  }

  function readFoodTimer() {
    const foodText =
      document.querySelector('#skill-window div[skill="food"] .skill')?.textContent?.trim() ||
      null;

    if (!foodText) return null;

    const match = foodText.match(/^(\d{1,2}):(\d{2})$/);
    return match
      ? {
          text: foodText,
          seconds: Number(match[1]) * 60 + Number(match[2]),
        }
      : { text: foodText, seconds: null };
  }

  function isSated() {
    const player = window.gameClient?.player;
    const conditions = player?.conditions;

    if (conditions?.has && conditions.SATED != null) {
      return conditions.has(conditions.SATED);
    }

    const food = readFoodTimer();
    if (food?.seconds != null) {
      return food.seconds > 0;
    }

    return true;
  }

  function chooseRandomEatTime(maxSeconds = 300) {
    const maximum = Math.max(0, Math.min(300, Math.trunc(Number(maxSeconds) || 0)));
    state.eatAtSecondsRemaining = Math.floor(Math.random() * (maximum + 1));
    bot.log("auto eat random time selected", {
      secondsRemaining: state.eatAtSecondsRemaining,
    });
    return state.eatAtSecondsRemaining;
  }

  function updateRandomEatTarget(foodSeconds) {
    const previousSeconds = state.lastObservedFoodSeconds;
    const timerRefilled =
      previousSeconds != null && foodSeconds > previousSeconds + 5;

    if (state.waitingForTimerReset) {
      if (!timerRefilled && foodSeconds <= 300) {
        state.lastObservedFoodSeconds = foodSeconds;
        return false;
      }

      state.waitingForTimerReset = false;
      state.eatAtSecondsRemaining = null;
    }

    if (timerRefilled) {
      state.eatAtSecondsRemaining = null;
    }

    if (state.eatAtSecondsRemaining == null) {
      chooseRandomEatTime(Math.min(300, foodSeconds));
    }

    state.lastObservedFoodSeconds = foodSeconds;
    return true;
  }

  function tryEat() {
    if (!config.enabled) {
      return false;
    }

    const food = readFoodTimer();

    if (food?.seconds != null) {
      if (!updateRandomEatTarget(food.seconds)) {
        return false;
      }

      if (food.seconds > state.eatAtSecondsRemaining) {
        return false;
      }
    } else if (isSated()) {
      return false;
    }

    if (Date.now() - state.lastFoodAt < config.eatCooldownMs) {
      return false;
    }

    const slot = normalizeHotbarSlot(config.eatHotbarSlot);
    if (!slot) {
      return false;
    }

    const slotIndex = slot - 1;
    const clicked = bot.clickHotbar(slotIndex);

    if (clicked) {
      state.lastFoodAt = Date.now();
      state.waitingForTimerReset = true;
      state.eatAtSecondsRemaining = null;
      bot.log("used eat hotkey", { slot, foodTimer: food?.text || null });
    }

    return clicked;
  }

  function scheduleNextTick() {
    if (!state.running) return;

    state.timerId = window.setTimeout(() => {
      tick();
    }, config.tickMs);
  }

  function tick() {
    if (!state.running) return;

    try {
      tryEat();
    } catch (error) {
      bot.log("auto eat tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    config.tickMs = 1000;
    persistConfig();

    if (state.running) {
      bot.log("auto eat already running");
      return false;
    }

    state.running = true;
    state.eatAtSecondsRemaining = null;
    state.lastObservedFoodSeconds = null;
    state.waitingForTimerReset = false;
    bot.log("auto eat started", { eatCooldownMs: config.eatCooldownMs, eatHotbarSlot: config.eatHotbarSlot });
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

    state.eatAtSecondsRemaining = null;
    state.lastObservedFoodSeconds = null;
    state.waitingForTimerReset = false;

    if (shouldPersistEnabled) {
      config.enabled = false;
      persistConfig();
    }
    bot.log("auto eat stopped");
    return true;
  }

  function status() {
    return {
      running: state.running,
      config: { ...config },
      lastFoodAt: state.lastFoodAt,
      eatAtSecondsRemaining: state.eatAtSecondsRemaining,
      waitingForTimerReset: state.waitingForTimerReset,
      isSated: isSated(),
    };
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "eatHotbarSlot")) {
      nextConfig.eatHotbarSlot = normalizeHotbarSlot(nextConfig.eatHotbarSlot) ?? config.eatHotbarSlot;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "eatCooldownMs")) {
      nextConfig.eatCooldownMs = Math.max(0, Number(nextConfig.eatCooldownMs) || 0);
    }

    Object.assign(config, nextConfig);
    config.tickMs = 1000;
    persistConfig();
    bot.log("auto eat config updated", { ...config });
    return { ...config };
  }

  if (config.enabled) {
    start();
  }

  bot.eat = {
    start,
    stop,
    status,
    updateConfig,
    isSated,
    tryEat,
    normalizeHotbarSlot,
    config,
  };

  bot.startAutoEat = start;
  bot.stopAutoEat = stop;

  if (bot.rune) {
    bot.rune.startAutoEat = start;
    bot.rune.stopAutoEat = stop;
    bot.rune.tryEat = tryEat;
    bot.rune.isSated = isSated;
  }
};