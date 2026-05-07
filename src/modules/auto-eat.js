window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installAutoEatModule = function installAutoEatModule(bot) {
  const configStorageKey = "minibiaBot.eat.config";
  const state = {
    running: false,
    timerId: null,
    lastFoodAt: 0,
    pendingContainerUse: null,
  };
  let resumeListenersAttached = false;

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

  function getOpenContainers() {
    return Array.from(window.gameClient?.player?.__openedContainers || []);
  }

  function getItemDefinition(item) {
    if (!item) return null;

    return (
      window.gameClient?.itemDefinitionsBySid?.[item.sid] ||
      window.gameClient?.itemDefinitions?.[item.id] ||
      null
    );
  }

  function getItemName(item) {
    const definition = getItemDefinition(item);
    return definition?.properties?.name || item?.name || "";
  }

  function isFoodItem(item) {
    const name = getItemName(item).toLowerCase();
    return /(ham|meat|mushroom|fish|egg|pear|toast|shrimp|food)/i.test(name);
  }

  function getFoodSlots() {
    return getOpenContainers().flatMap((container) =>
      (container?.slots || [])
        .filter((slot) => slot?.item && slot?.element && isFoodItem(slot.item))
        .map((slot) => ({
          container,
          slot,
          item: slot.item,
          name: getItemName(slot.item),
          count: slot.item.count || 0,
        }))
    );
  }

  function dispatchMouseEvent(element, type, options) {
    element.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        ...options,
      })
    );
  }

  function openSlotContextMenu(slot) {
    if (!slot?.element) return false;

    const rect = slot.element.getBoundingClientRect();
    const clientX = rect.left + 5;
    const clientY = rect.top + 5;

    dispatchMouseEvent(slot.element, "pointerdown", {
      button: 2,
      buttons: 2,
      clientX,
      clientY,
      pointerType: "mouse",
      isPrimary: false,
    });
    dispatchMouseEvent(slot.element, "mousedown", {
      button: 2,
      buttons: 2,
      clientX,
      clientY,
    });
    dispatchMouseEvent(slot.element, "mouseup", {
      button: 2,
      buttons: 0,
      clientX,
      clientY,
    });
    dispatchMouseEvent(slot.element, "pointerup", {
      button: 2,
      buttons: 0,
      clientX,
      clientY,
      pointerType: "mouse",
      isPrimary: false,
    });
    dispatchMouseEvent(slot.element, "contextmenu", {
      button: 2,
      buttons: 0,
      clientX,
      clientY,
    });

    return true;
  }

  function getVisibleMenuRoots() {
    return Object.values(window.gameClient?.interface?.menuManager?.menus || {})
      .map((menu) => menu?.element)
      .filter((element) => element instanceof Element);
  }

  function findUseEntry() {
    for (const root of getVisibleMenuRoots()) {
      const useEntry = Array.from(root.querySelectorAll("*")).find((element) =>
        /^use$/i.test((element.textContent || "").trim())
      );
      if (useEntry) {
        return useEntry;
      }
    }

    return null;
  }

  function clearPendingContainerUse() {
    if (state.pendingContainerUse?.timerId != null) {
      window.clearTimeout(state.pendingContainerUse.timerId);
    }

    state.pendingContainerUse = null;
  }

  function clickPendingContainerUse(attempt = 0) {
    const pending = state.pendingContainerUse;
    if (!pending) {
      return false;
    }

    const useEntry = findUseEntry();

    if (!useEntry) {
      if (attempt >= 20) {
        bot.log("auto eat failed to find container use entry", {
          name: pending.target.name,
          sid: pending.target.item.sid,
        });
        clearPendingContainerUse();
        return false;
      }

      pending.timerId = window.setTimeout(() => {
        clickPendingContainerUse(attempt + 1);
      }, 50);
      return false;
    }

    useEntry.click();
    state.lastFoodAt = Date.now();
    bot.log("used food from open container", {
      name: pending.target.name,
      count: pending.target.count,
      sid: pending.target.item.sid,
    });
    clearPendingContainerUse();
    return true;
  }

  function eatFromOpenContainers() {
    if (state.pendingContainerUse) {
      return true;
    }

    const foodSlots = getFoodSlots().sort((a, b) => a.count - b.count);
    const target = foodSlots[0];

    if (!target) {
      return false;
    }

    if (!openSlotContextMenu(target.slot)) {
      return false;
    }

    state.pendingContainerUse = {
      target,
      timerId: null,
    };
    clickPendingContainerUse();
    return true;
  }

  function tryEat() {
    if (!config.enabled) {
      return false;
    }

    if (isSated()) {
      return false;
    }

    if (Date.now() - state.lastFoodAt < config.eatCooldownMs) {
      return false;
    }

    if (eatFromOpenContainers()) {
      return true;
    }

    const slotIndex = Math.max(0, Number(config.eatHotbarSlot) - 1);
    const clicked = bot.clickHotbar(slotIndex);

    if (clicked) {
      state.lastFoodAt = Date.now();
      bot.log("clicked food hotbar slot", config.eatHotbarSlot);
    }

    return clicked;
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
    attachResumeListeners();
    bot.log("auto eat started", { eatCooldownMs: config.eatCooldownMs });
    tick();
    return true;
  }

  function stop() {
    state.running = false;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    clearPendingContainerUse();
    detachResumeListeners();

    config.enabled = false;
    persistConfig();
    bot.log("auto eat stopped");
    return true;
  }

  function status() {
    return {
      running: state.running,
      config: { ...config },
      lastFoodAt: state.lastFoodAt,
      isSated: isSated(),
    };
  }

  function updateConfig(nextConfig = {}) {
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
    getOpenContainers,
    getFoodSlots,
    eatFromOpenContainers,
    config,
  };

  bot.startAutoEat = start;
  bot.stopAutoEat = stop;

  if (bot.rune) {
    bot.rune.startAutoEat = start;
    bot.rune.stopAutoEat = stop;
    bot.rune.tryEat = tryEat;
    bot.rune.getOpenContainers = getOpenContainers;
    bot.rune.getFoodSlots = getFoodSlots;
    bot.rune.eatFromOpenContainers = eatFromOpenContainers;
    bot.rune.isSated = isSated;
  }
};
