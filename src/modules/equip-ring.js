window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installEquipRingModule = function installEquipRingModule(bot) {
  const configStorageKey = "minibiaBot.equipRing.config";
  const RING_SLOT = 8;
  const PZ_FLAG = 1;
  const ALLOWED_RINGS = [
    { name: "ring of healing", priority: 1 },
    { name: "life ring", priority: 2 },
  ];
  const state = {
    running: false,
    timerId: null,
    lastEquipAt: 0,
    lastUnequipAt: 0,
  };
  let resumeListenersAttached = false;

  const config = Object.assign(
    {
      tickMs: 1000,
      equipCooldownMs: 1500,
      unequipCooldownMs: 1500,
      unequipInProtectionZone: true,
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );
  config.tickMs = 1000;
  config.unequipInProtectionZone = config.unequipInProtectionZone !== false;

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function getEquipment() {
    return window.gameClient?.player?.equipment || null;
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

  function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
  }

  function getAllowedRingInfo(item) {
    const itemName = normalizeName(getItemName(item));
    return ALLOWED_RINGS.find((ring) => itemName === ring.name) || null;
  }

  function isRingItem(item) {
    return !!getAllowedRingInfo(item);
  }

  function getEquippedRing() {
    const equipment = getEquipment();
    return equipment?.getSlotItem?.(RING_SLOT) || null;
  }

  function hasEquippedRing() {
    return !!getEquippedRing();
  }

  function getLoadedTiles() {
    return bot.pz?.getLoadedTiles?.() || [];
  }

  function isPlayerInProtectionZone() {
    const position = bot.getPlayerPosition?.();
    if (!position) return false;
    return getLoadedTiles().some((tile) => {
      const tilePosition = tile?.__position;
      return tilePosition &&
        tilePosition.x === position.x &&
        tilePosition.y === position.y &&
        tilePosition.z === position.z &&
        ((tile.flags || 0) & PZ_FLAG) !== 0;
    });
  }

  function findFirstEmptyContainerSlot() {
    for (const container of getOpenContainers()) {
      const slots = container?.slots || [];
      for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
        if (!container.getSlotItem?.(slotIndex)) {
          return { container, slotIndex };
        }
      }
    }
    return null;
  }

  function findBestRingSource() {
    const equipment = getEquipment();
    if (!equipment) {
      return null;
    }

    let best = null;

    const consider = (container, slotIndex, item) => {
      const allowedRing = getAllowedRingInfo(item);
      if (!allowedRing) {
        return;
      }

      const count = (typeof item.getCount === "function" ? item.getCount() : item.count) || 1;
      const candidate = {
        container,
        slotIndex,
        item,
        count,
        name: getItemName(item),
        priority: allowedRing.priority,
      };

      if (!best || candidate.priority < best.priority || (candidate.priority === best.priority && candidate.count > best.count)) {
        best = candidate;
      }
    };

    for (let slotIndex = 0; slotIndex < equipment.slots.length; slotIndex += 1) {
      if (slotIndex === RING_SLOT) continue;
      consider(equipment, slotIndex, equipment.getSlotItem(slotIndex));
    }

    getOpenContainers().forEach((container) => {
      (container?.slots || []).forEach((slot, slotIndex) => {
        consider(container, slotIndex, container.getSlotItem(slotIndex));
      });
    });

    return best;
  }

  function canUnequipRingInProtectionZone(now = Date.now()) {
    if (!config.enabled || !config.unequipInProtectionZone || !isPlayerInProtectionZone()) return false;
    if (now - state.lastUnequipAt < (config.unequipCooldownMs || 1500)) return false;
    const equippedRing = getEquippedRing();
    return !!getAllowedRingInfo(equippedRing) && !!findFirstEmptyContainerSlot();
  }

  function tryUnequipRingInProtectionZone(now = Date.now()) {
    if (!canUnequipRingInProtectionZone(now)) return false;
    const equipment = getEquipment();
    const equippedRing = getEquippedRing();
    const destination = findFirstEmptyContainerSlot();
    if (!equipment || !equippedRing || !destination) return false;

    const from = { which: equipment, index: RING_SLOT };
    const to = { which: destination.container, index: destination.slotIndex };
    const count = (typeof equippedRing.getCount === "function" ? equippedRing.getCount() : equippedRing.count) || 1;

    window.gameClient.send(new ItemMovePacket(from, to, count));
    state.lastUnequipAt = now;
    bot.log("unequipped ring in protection zone", {
      name: getItemName(equippedRing),
      toContainerId: destination.container?.__containerId ?? null,
      toSlot: destination.slotIndex,
    });
    return true;
  }

  function getGateStatus(now = Date.now()) {
    const equipment = getEquipment();
    const source = findBestRingSource();
    const inProtectionZone = isPlayerInProtectionZone();
    const cooldownRemainingMs = Math.max(0, config.equipCooldownMs - (now - state.lastEquipAt));
    const unequipCooldownRemainingMs = Math.max(0, (config.unequipCooldownMs || 1500) - (now - state.lastUnequipAt));

    return {
      hasEquipment: !!equipment,
      hasRingEquipped: hasEquippedRing(),
      hasRingAvailable: !!source,
      inProtectionZone,
      cooldownReady: cooldownRemainingMs === 0,
      cooldownRemainingMs,
      unequipCooldownRemainingMs,
      source,
      canEquip: !!equipment && !inProtectionZone && !hasEquippedRing() && !!source && cooldownRemainingMs === 0,
      canUnequipInProtectionZone: canUnequipRingInProtectionZone(now),
    };
  }

  function canEquipRing(now = Date.now()) {
    return getGateStatus(now).canEquip;
  }

  function tryEquipRing(now = Date.now()) {
    if (!config.enabled || !canEquipRing(now)) {
      return false;
    }

    const equipment = getEquipment();
    const source = findBestRingSource();
    if (!equipment || !source) {
      return false;
    }

    const from = {
      which: source.container,
      index: source.slotIndex,
    };
    const to = {
      which: equipment,
      index: RING_SLOT,
    };
    const count = source.count || 1;

    window.gameClient.send(new ItemMovePacket(from, to, count));
    state.lastEquipAt = now;
    bot.log("equipped ring", {
      name: source.name,
      priority: source.priority,
      fromContainerId: source.container?.__containerId ?? null,
      fromSlot: source.slotIndex,
    });
    return true;
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
      if (!tryUnequipRingInProtectionZone()) {
        tryEquipRing();
      }
    } catch (error) {
      bot.log("equip ring tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    config.tickMs = 1000;
    config.unequipInProtectionZone = config.unequipInProtectionZone !== false;
    persistConfig();

    if (state.running) {
      bot.log("equip ring already running");
      return false;
    }

    state.running = true;
    attachResumeListeners();
    bot.log("equip ring started", { ...config });
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
    bot.log("equip ring stopped");
    return true;
  }

  function status() {
    return {
      running: state.running,
      config: { ...config },
      gates: getGateStatus(),
      equippedRing: getEquippedRing(),
      lastEquipAt: state.lastEquipAt,
      lastUnequipAt: state.lastUnequipAt,
      allowedRings: ALLOWED_RINGS.map((ring) => ring.name),
    };
  }

  function updateConfig(nextConfig = {}) {
    Object.assign(config, nextConfig);
    config.tickMs = 1000;
    config.unequipInProtectionZone = config.unequipInProtectionZone !== false;
    persistConfig();
    bot.log("equip ring config updated", { ...config });
    return { ...config };
  }

  if (config.enabled) {
    start();
  }

  bot.equipRing = {
    start,
    stop,
    status,
    updateConfig,
    config,
    getEquippedRing,
    hasEquippedRing,
    findBestRingSource,
    getGateStatus,
    canEquipRing,
    tryEquipRing,
    isPlayerInProtectionZone,
    tryUnequipRingInProtectionZone,
  };
};
