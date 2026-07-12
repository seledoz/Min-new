window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installRuneMakerDropModule = function installRuneMakerDropModule(bot) {
  const configStorageKey = "minibiaBot.runeMakerDrop.config";
  const sectionId = "minibia-bot-rune-maker-drop-section";
  const enabledId = "minibia-bot-rune-maker-drop-enabled";
  const thresholdId = "minibia-bot-rune-maker-drop-threshold";
  const setPositionId = "minibia-bot-rune-maker-drop-set-position";
  const statusId = "minibia-bot-rune-maker-drop-status";
  const BLANK_RUNE_ID = 2260;
  const RUNE_ID_MIN = 2260;
  const RUNE_ID_MAX = 2316;

  const state = {
    running: false,
    timerId: null,
    phase: "idle",
    returnPosition: null,
    exitFromPosition: null,
    lastPathAt: 0,
    lastDropAt: 0,
    lastExitAt: 0,
    droppedStacks: 0,
    emptyScanCount: 0,
    pendingDrop: null,
    lastDropError: null,
  };

  const config = Object.assign({
    enabled: false,
    lowCap: 50,
    dropPosition: null,
    tickMs: 500,
    repathMs: 1500,
    dropDelayMs: 700,
    dropVerifyMs: 1400,
    teleportWaitMs: 1200,
  }, bot.storage.get(configStorageKey, {}) || {});

  function normalizePosition(value) {
    if (!value) return null;
    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) };
  }

  function samePosition(a, b) {
    const left = normalizePosition(a);
    const right = normalizePosition(b);
    return !!left && !!right && left.x === right.x && left.y === right.y && left.z === right.z;
  }

  function persistConfig() {
    config.dropPosition = normalizePosition(config.dropPosition);
    config.lowCap = Math.max(0, Number(config.lowCap) || 0);
    bot.storage.set(configStorageKey, { ...config });
  }

  function getCapacity() {
    return bot.getPlayerSnapshot?.().capacity ?? null;
  }

  function getItemName(item) {
    const values = [
      item?.getName?.(), item?.name, item?.type?.name, item?.data?.name,
      item?.itemType?.name, item?.__name, item?.__type?.name,
      item?.getType?.()?.name, item?.getItemType?.()?.name,
    ];
    return String(values.find((value) => value != null && String(value).trim()) || "").trim();
  }

  function getItemId(item) {
    const values = [
      item?.getId?.(), item?.getID?.(), item?.id, item?.itemId, item?.itemID,
      item?.type?.id, item?.data?.id, item?.itemType?.id, item?.__id,
      item?.getType?.()?.id, item?.getItemType?.()?.id,
    ];
    for (const value of values) {
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) return Math.trunc(number);
    }
    return null;
  }

  function getItemCount(item) {
    const values = [
      item?.getCount?.(), item?.count, item?.amount, item?.quantity,
      item?.stackCount, item?.__count, item?.data?.count,
    ];
    for (const value of values) {
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) return Math.trunc(number);
    }
    return 1;
  }

  function isDroppableRune(item) {
    const id = getItemId(item);
    const name = getItemName(item);
    if (id === BLANK_RUNE_ID || /\bblank rune\b/i.test(name)) return false;
    return /\brune\b/i.test(name) || (id != null && id >= RUNE_ID_MIN && id <= RUNE_ID_MAX);
  }

  function getOpenContainers() {
    const opened = window.gameClient?.player?.__openedContainers;
    if (!opened) return [];
    if (Array.isArray(opened)) return opened.filter(Boolean);
    if (typeof opened.values === "function") return Array.from(opened.values()).filter(Boolean);
    if (typeof opened[Symbol.iterator] === "function") return Array.from(opened).filter(Boolean);
    return Object.values(opened).filter(Boolean);
  }

  function getContainerSlotCount(container) {
    if (Array.isArray(container?.slots)) return container.slots.length;
    const values = [container?.size, container?.capacity, container?.slotCount, container?.getSize?.()];
    for (const value of values) {
      const number = Number(value);
      if (Number.isFinite(number) && number >= 0) return Math.trunc(number);
    }
    return 40;
  }

  function getSlotItem(container, index) {
    return container?.getSlotItem?.(index) || container?.slots?.[index]?.item || container?.slots?.[index] || null;
  }

  function findNextRune() {
    const containers = getOpenContainers();
    for (const container of containers) {
      for (let index = 0; index < getContainerSlotCount(container); index += 1) {
        const item = getSlotItem(container, index);
        if (!item || !isDroppableRune(item)) continue;
        return {
          container,
          index,
          item,
          id: getItemId(item),
          name: getItemName(item) || `rune ${getItemId(item) ?? "unknown"}`,
          count: getItemCount(item),
        };
      }
    }
    return { containersScanned: containers.length, entry: null };
  }

  function getTile(position) {
    const p = normalizePosition(position);
    if (!p) return null;
    try {
      return window.gameClient?.world?.getTileFromWorldPosition?.(new Position(p.x, p.y, p.z)) || null;
    } catch (_) {
      return null;
    }
  }

  function walkTo(position) {
    const from = bot.getPlayerPosition?.();
    const target = normalizePosition(position);
    if (!from || !target) return false;
    try {
      window.gameClient?.world?.pathfinder?.findPath?.(from, new Position(target.x, target.y, target.z));
      state.lastPathAt = Date.now();
      return true;
    } catch (error) {
      bot.log("rune maker drop path failed", { target, error: error?.message || error });
      return false;
    }
  }

  function methodNames(object) {
    const names = new Set();
    let current = object;
    for (let depth = 0; current && depth < 4; depth += 1) {
      Object.getOwnPropertyNames(current).forEach((name) => names.add(name));
      current = Object.getPrototypeOf(current);
    }
    return [...names];
  }

  function buildMoveAttempts(entry, tile) {
    const game = window.gameClient;
    const objects = [
      ["mouse", game?.mouse],
      ["client", game],
      ["player", game?.player],
      ["world", game?.world],
      ["interface", game?.interface],
      ["container", entry.container],
    ].filter(([, object]) => object);

    const preferred = [
      "__handleItemMove", "handleItemMove", "moveItem", "__moveItem",
      "moveThing", "__moveThing", "dropItem", "dragItem", "move",
    ];
    const attempts = [];
    const sourceContainer = { which: entry.container, index: entry.index };
    const sourceItem = { which: entry.item, index: entry.index };
    const destination = { which: tile, index: 0xFF };
    const variants = [
      [sourceContainer, destination, entry.count],
      [sourceContainer, destination],
      [sourceItem, destination, entry.count],
      [sourceItem, destination],
      [entry.container, entry.index, tile, 0xFF, entry.count],
      [entry.container, entry.index, tile, entry.count],
      [entry.item, tile, entry.count],
      [entry.item, destination, entry.count],
      [entry.item, sourceContainer, destination, entry.count],
    ];

    for (const [label, object] of objects) {
      const names = methodNames(object)
        .filter((name) => typeof object[name] === "function")
        .filter((name) => preferred.includes(name) || /(?:move|drop|drag).*(?:item|thing)|(?:item|thing).*(?:move|drop|drag)/i.test(name));
      names.sort((a, b) => preferred.indexOf(a) - preferred.indexOf(b));
      for (const name of names) {
        for (let variant = 0; variant < variants.length; variant += 1) {
          attempts.push({ label: `${label}.${name}#${variant + 1}`, run: () => object[name](...variants[variant]) });
        }
      }
    }
    return attempts;
  }

  function slotChanged(pending) {
    const item = getSlotItem(pending.entry.container, pending.entry.index);
    if (!item) return true;
    const id = getItemId(item);
    const count = getItemCount(item);
    return id !== pending.entry.id || count < pending.entry.count || !isDroppableRune(item);
  }

  function beginDropAttempt(entry, now) {
    const tile = getTile(config.dropPosition);
    if (!tile) {
      state.lastDropError = "drop tile unavailable";
      return false;
    }
    const attempts = buildMoveAttempts(entry, tile);
    if (!attempts.length) {
      state.lastDropError = "no item move API found";
      bot.log("rune maker drop: no item move API found", {
        mouseMethods: methodNames(window.gameClient?.mouse || {}).filter((name) => /move|drop|drag/i.test(name)),
      });
      return false;
    }
    state.pendingDrop = { entry, attempts, attemptIndex: 0, attemptedAt: 0, lastMethod: null };
    return runNextDropAttempt(now);
  }

  function runNextDropAttempt(now) {
    const pending = state.pendingDrop;
    if (!pending || pending.attemptIndex >= pending.attempts.length) {
      state.lastDropError = "all item move methods failed";
      state.phase = "drop-error";
      bot.log("rune maker drop failed: all move methods had no effect", {
        rune: pending?.entry?.name,
        id: pending?.entry?.id,
        attempts: pending?.attemptIndex || 0,
      });
      return false;
    }
    const attempt = pending.attempts[pending.attemptIndex++];
    try {
      attempt.run();
      pending.attemptedAt = now;
      pending.lastMethod = attempt.label;
      state.lastDropAt = now;
      bot.log("rune maker drop attempt", { method: attempt.label, rune: pending.entry.name, count: pending.entry.count });
      return true;
    } catch (error) {
      bot.log("rune maker drop attempt threw", { method: attempt.label, error: error?.message || error });
      return runNextDropAttempt(now);
    }
  }

  function verifyPendingDrop(now) {
    const pending = state.pendingDrop;
    if (!pending) return false;
    if (slotChanged(pending)) {
      bot.log("rune maker drop confirmed", { method: pending.lastMethod, rune: pending.entry.name });
      state.pendingDrop = null;
      state.lastDropError = null;
      state.droppedStacks += 1;
      state.lastDropAt = now;
      return true;
    }
    if (now - pending.attemptedAt >= config.dropVerifyMs) runNextDropAttempt(now);
    return false;
  }

  function resetCycle(message = null) {
    state.phase = "idle";
    state.returnPosition = null;
    state.exitFromPosition = null;
    state.lastPathAt = 0;
    state.lastDropAt = 0;
    state.lastExitAt = 0;
    state.droppedStacks = 0;
    state.emptyScanCount = 0;
    state.pendingDrop = null;
    state.lastDropError = null;
    if (message) bot.log(message);
  }

  function setDropPosition(position = bot.getPlayerPosition?.()) {
    const normalized = normalizePosition(position);
    if (!normalized) return false;
    config.dropPosition = normalized;
    persistConfig();
    bot.log("rune maker drop position saved", normalized);
    refreshUi();
    return normalized;
  }

  function beginCycle() {
    const current = normalizePosition(bot.getPlayerPosition?.());
    if (!current || !normalizePosition(config.dropPosition)) return false;
    state.returnPosition = current;
    state.phase = "walking-to-drop";
    state.droppedStacks = 0;
    state.emptyScanCount = 0;
    state.pendingDrop = null;
    state.lastDropError = null;
    bot.log("rune maker drop cycle started", { capacity: getCapacity(), returnPosition: current, dropPosition: config.dropPosition });
    return walkTo(config.dropPosition);
  }

  function tickCycle(now) {
    const current = normalizePosition(bot.getPlayerPosition?.());
    if (!current) return;

    if (state.phase === "walking-to-drop") {
      if (samePosition(current, config.dropPosition)) {
        state.phase = "dropping";
        state.lastDropAt = 0;
        state.emptyScanCount = 0;
      } else if (now - state.lastPathAt >= config.repathMs) walkTo(config.dropPosition);
      return;
    }

    if (state.phase === "drop-error") return;

    if (state.phase === "dropping") {
      if (!samePosition(current, config.dropPosition)) {
        state.phase = "walking-to-drop";
        walkTo(config.dropPosition);
        return;
      }

      if (state.pendingDrop) {
        verifyPendingDrop(now);
        return;
      }
      if (now - state.lastDropAt < config.dropDelayMs) return;

      const result = findNextRune();
      const rune = result?.entry === null ? null : result;
      const containersScanned = result?.containersScanned ?? getOpenContainers().length;

      if (rune) {
        state.emptyScanCount = 0;
        beginDropAttempt(rune, now);
        return;
      }

      if (containersScanned === 0) {
        state.lastDropError = "open the backpack containing the runes";
        state.lastDropAt = now;
        return;
      }

      state.emptyScanCount += 1;
      if (state.emptyScanCount < 3) {
        state.lastDropAt = now;
        return;
      }

      state.exitFromPosition = current;
      state.phase = "exiting";
      state.lastExitAt = now;
      bot.sendChat("/exithouse");
      return;
    }

    if (state.phase === "exiting") {
      const teleported = !samePosition(current, state.exitFromPosition);
      if (!teleported && now - state.lastExitAt >= 4000) {
        state.lastExitAt = now;
        bot.sendChat("/exithouse");
      } else if (teleported && now - state.lastExitAt >= config.teleportWaitMs) {
        if (samePosition(current, state.returnPosition)) resetCycle("rune maker drop cycle complete");
        else {
          state.phase = "returning";
          walkTo(state.returnPosition);
        }
      }
      return;
    }

    if (state.phase === "returning") {
      if (samePosition(current, state.returnPosition)) resetCycle("rune maker drop cycle complete");
      else if (now - state.lastPathAt >= config.repathMs) walkTo(state.returnPosition);
    }
  }

  function tick() {
    if (!state.running) return;
    try {
      ensureUi();
      const now = Date.now();
      if (state.phase !== "idle") tickCycle(now);
      else if (config.enabled && normalizePosition(config.dropPosition)) {
        const capacity = getCapacity();
        if (capacity != null && capacity <= Number(config.lowCap || 0)) beginCycle();
      }
      refreshUi();
    } catch (error) {
      bot.log("rune maker drop tick failed", error?.message || error);
    } finally {
      state.timerId = window.setTimeout(tick, Math.max(250, Number(config.tickMs) || 500));
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    persistConfig();
    state.running = true;
    if (state.timerId == null) tick();
    refreshUi();
    return true;
  }

  function stop(options = {}) {
    state.running = false;
    if (state.timerId != null) window.clearTimeout(state.timerId);
    state.timerId = null;
    if (options.persistEnabled !== false) {
      config.enabled = false;
      persistConfig();
    }
    resetCycle();
    refreshUi();
    return true;
  }

  function retryDrop() {
    if (state.phase !== "drop-error") return false;
    state.phase = "dropping";
    state.pendingDrop = null;
    state.lastDropError = null;
    state.lastDropAt = 0;
    return true;
  }

  function updateConfig(nextConfig = {}) {
    Object.assign(config, nextConfig);
    persistConfig();
    if (config.enabled && !state.running) start();
    refreshUi();
    return { ...config };
  }

  function status() {
    return {
      running: state.running,
      phase: state.phase,
      capacity: getCapacity(),
      returnPosition: normalizePosition(state.returnPosition),
      droppedStacks: state.droppedStacks,
      pendingMethod: state.pendingDrop?.lastMethod || null,
      lastDropError: state.lastDropError,
      config: { ...config, dropPosition: normalizePosition(config.dropPosition) },
    };
  }

  function refreshUi() {
    const enabled = document.getElementById(enabledId);
    const threshold = document.getElementById(thresholdId);
    const statusLabel = document.getElementById(statusId);
    if (enabled) enabled.checked = !!config.enabled;
    if (threshold && document.activeElement !== threshold) threshold.value = String(config.lowCap);
    if (!statusLabel) return;
    const drop = normalizePosition(config.dropPosition);
    const capacity = getCapacity();
    if (!drop) statusLabel.textContent = "Drop position: not set";
    else if (state.phase === "drop-error") statusLabel.textContent = `Status: DROP FAILED • ${state.lastDropError || "unknown move API"}`;
    else if (state.phase !== "idle") statusLabel.textContent = `Status: ${state.phase} • cap ${capacity ?? "?"} • dropped ${state.droppedStacks}${state.pendingDrop?.lastMethod ? ` • ${state.pendingDrop.lastMethod}` : ""}`;
    else statusLabel.textContent = `Status: ${config.enabled ? "on" : "off"} • cap ${capacity ?? "?"} / ${config.lowCap} • drop ${drop.x}, ${drop.y}, ${drop.z}`;
  }

  function ensureUi() {
    if (document.getElementById(sectionId)) return;
    const panel = document.getElementById("minibia-bot-panel") || document.getElementById("k9x-panel");
    if (!panel) return;
    const runeToggle = document.getElementById("minibia-bot-rune-enabled");
    const parentSection = runeToggle?.closest?.(".mb-section");
    const targetColumn = parentSection?.parentElement || panel.querySelector(".mb-main-column") || panel;
    const section = document.createElement("div");
    section.id = sectionId;
    section.className = "mb-section mb-column-section";
    section.innerHTML = `<div class="mb-label">Rune Maker Drop</div><div class="mb-stack"><label class="mb-toggle"><input type="checkbox" id="${enabledId}" /><span>Rune Maker Drop</span></label><div class="mb-row-three"><span>Low Cap</span><input type="number" id="${thresholdId}" min="0" step="1" /><span>cap</span></div><button type="button" id="${setPositionId}">Set Drop Position</button><div class="mb-small-note" id="${statusId}"></div></div>`;
    if (parentSection?.nextSibling) targetColumn.insertBefore(section, parentSection.nextSibling);
    else targetColumn.appendChild(section);
    document.getElementById(enabledId)?.addEventListener("change", (event) => event.target.checked ? start() : stop());
    document.getElementById(thresholdId)?.addEventListener("change", (event) => updateConfig({ lowCap: Math.max(0, Number(event.target.value) || 0) }));
    document.getElementById(setPositionId)?.addEventListener("click", () => setDropPosition());
    refreshUi();
  }

  bot.runeMakerDrop = { start, stop, status, updateConfig, setDropPosition, retryDrop, config };
  if (config.enabled) start();
  else { state.running = true; tick(); }
};
