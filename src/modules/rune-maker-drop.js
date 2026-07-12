window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installRuneMakerDropModule = function installRuneMakerDropModule(bot) {
  const configStorageKey = "minibiaBot.runeMakerDrop.config";
  const sectionId = "minibia-bot-rune-maker-drop-section";
  const enabledId = "minibia-bot-rune-maker-drop-enabled";
  const thresholdId = "minibia-bot-rune-maker-drop-threshold";
  const setPositionId = "minibia-bot-rune-maker-drop-set-position";
  const statusId = "minibia-bot-rune-maker-drop-status";

  const state = {
    running: false,
    timerId: null,
    phase: "idle",
    returnPosition: null,
    exitFromPosition: null,
    lastPathAt: 0,
    lastDropAt: 0,
    lastExitAt: 0,
    cycleStartedAt: 0,
    droppedStacks: 0,
  };

  const config = Object.assign(
    {
      enabled: false,
      lowCap: 50,
      dropPosition: null,
      tickMs: 500,
      repathMs: 1500,
      dropDelayMs: 350,
      teleportWaitMs: 1200,
    },
    bot.storage.get(configStorageKey, {})
  );

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
    return String(
      item?.getName?.() ||
      item?.name ||
      item?.type?.name ||
      item?.data?.name ||
      item?.itemType?.name ||
      ""
    ).trim();
  }

  function getItemCount(item) {
    const value = Number(
      item?.getCount?.() ??
      item?.count ??
      item?.amount ??
      item?.quantity ??
      item?.stackCount ??
      1
    );
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 1;
  }

  function isDroppableRune(item) {
    const name = getItemName(item);
    return /\brune\b/i.test(name) && !/\bblank rune\b/i.test(name);
  }

  function getOpenContainers() {
    return Array.from(window.gameClient?.player?.__openedContainers || []);
  }

  function findNextRune() {
    for (const container of getOpenContainers()) {
      const slots = container?.slots || [];
      for (let index = 0; index < slots.length; index += 1) {
        const item = container.getSlotItem?.(index);
        if (item && isDroppableRune(item)) {
          return { container, index, item, name: getItemName(item), count: getItemCount(item) };
        }
      }
    }
    return null;
  }

  function getTile(position) {
    const normalized = normalizePosition(position);
    if (!normalized) return null;
    try {
      return window.gameClient?.world?.getTileFromWorldPosition?.(
        new Position(normalized.x, normalized.y, normalized.z)
      ) || null;
    } catch (error) {
      return null;
    }
  }

  function walkTo(position) {
    const from = bot.getPlayerPosition?.();
    const target = normalizePosition(position);
    if (!from || !target) return false;
    try {
      window.gameClient?.world?.pathfinder?.findPath?.(
        from,
        new Position(target.x, target.y, target.z)
      );
      state.lastPathAt = Date.now();
      return true;
    } catch (error) {
      bot.log("rune maker drop path failed", { target, error: error?.message || error });
      return false;
    }
  }

  function moveRuneToGround(entry) {
    const tile = getTile(config.dropPosition);
    const mouse = window.gameClient?.mouse;
    if (!entry || !tile || !mouse) return false;

    const source = { which: entry.container, index: entry.index };
    const destination = { which: tile, index: 0xFF };
    const count = entry.count;

    try {
      if (typeof mouse.__handleItemMove === "function") {
        mouse.__handleItemMove(source, destination, count);
        return true;
      }
      if (typeof mouse.moveItem === "function") {
        mouse.moveItem(source, destination, count);
        return true;
      }
      if (typeof mouse.move === "function") {
        mouse.move(source, destination, count);
        return true;
      }
      if (typeof mouse.__moveItem === "function") {
        mouse.__moveItem(source, destination, count);
        return true;
      }
    } catch (error) {
      bot.log("rune maker drop item move failed", {
        rune: entry.name,
        count,
        error: error?.message || error,
      });
      return false;
    }

    bot.log("rune maker drop could not find the game's item move method");
    return false;
  }

  function resetCycle(message = null) {
    state.phase = "idle";
    state.returnPosition = null;
    state.exitFromPosition = null;
    state.lastPathAt = 0;
    state.lastDropAt = 0;
    state.lastExitAt = 0;
    state.cycleStartedAt = 0;
    state.droppedStacks = 0;
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
    state.cycleStartedAt = Date.now();
    state.droppedStacks = 0;
    bot.log("rune maker drop cycle started", {
      capacity: getCapacity(),
      returnPosition: state.returnPosition,
      dropPosition: config.dropPosition,
    });
    walkTo(config.dropPosition);
    return true;
  }

  function tickCycle(now) {
    const current = normalizePosition(bot.getPlayerPosition?.());
    if (!current) return;

    if (state.phase === "walking-to-drop") {
      if (samePosition(current, config.dropPosition)) {
        state.phase = "dropping";
        state.lastDropAt = 0;
        return;
      }
      if (now - state.lastPathAt >= config.repathMs) walkTo(config.dropPosition);
      return;
    }

    if (state.phase === "dropping") {
      if (!samePosition(current, config.dropPosition)) {
        state.phase = "walking-to-drop";
        walkTo(config.dropPosition);
        return;
      }
      if (now - state.lastDropAt < config.dropDelayMs) return;

      const rune = findNextRune();
      if (rune) {
        if (moveRuneToGround(rune)) {
          state.lastDropAt = now;
          state.droppedStacks += 1;
          bot.log("rune maker dropped rune stack", { rune: rune.name, count: rune.count });
        }
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
        return;
      }
      if (teleported && now - state.lastExitAt >= config.teleportWaitMs) {
        if (samePosition(current, state.returnPosition)) {
          resetCycle("rune maker drop cycle complete");
        } else {
          state.phase = "returning";
          walkTo(state.returnPosition);
        }
      }
      return;
    }

    if (state.phase === "returning") {
      if (samePosition(current, state.returnPosition)) {
        resetCycle("rune maker drop cycle complete");
        return;
      }
      if (now - state.lastPathAt >= config.repathMs) walkTo(state.returnPosition);
    }
  }

  function tick() {
    if (!state.running) return;
    try {
      ensureUi();
      const now = Date.now();
      if (state.phase !== "idle") {
        tickCycle(now);
      } else if (config.enabled && normalizePosition(config.dropPosition)) {
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
    const shouldPersistEnabled = options.persistEnabled !== false;
    state.running = false;
    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }
    if (shouldPersistEnabled) {
      config.enabled = false;
      persistConfig();
    }
    resetCycle();
    refreshUi();
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
    if (!drop) {
      statusLabel.textContent = "Drop position: not set";
    } else if (state.phase !== "idle") {
      statusLabel.textContent = `Status: ${state.phase} • cap ${capacity ?? "?"} • ${drop.x}, ${drop.y}, ${drop.z}`;
    } else {
      statusLabel.textContent = `Status: ${config.enabled ? "on" : "off"} • cap ${capacity ?? "?"} / ${config.lowCap} • drop ${drop.x}, ${drop.y}, ${drop.z}`;
    }
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
    section.innerHTML = `
      <div class="mb-label">Rune Maker Drop</div>
      <div class="mb-stack">
        <label class="mb-toggle">
          <input type="checkbox" id="${enabledId}" />
          <span>Rune Maker Drop</span>
        </label>
        <div class="mb-row-three">
          <span>Low Cap</span>
          <input type="number" id="${thresholdId}" min="0" step="1" />
          <span>cap</span>
        </div>
        <button type="button" id="${setPositionId}">Set Drop Position</button>
        <div class="mb-small-note" id="${statusId}"></div>
      </div>`;

    if (parentSection?.nextSibling) targetColumn.insertBefore(section, parentSection.nextSibling);
    else targetColumn.appendChild(section);

    document.getElementById(enabledId)?.addEventListener("change", (event) => {
      if (event.target.checked) start();
      else stop();
    });

    document.getElementById(thresholdId)?.addEventListener("change", (event) => {
      updateConfig({ lowCap: Math.max(0, Number(event.target.value) || 0) });
    });

    document.getElementById(setPositionId)?.addEventListener("click", () => {
      setDropPosition();
    });

    refreshUi();
  }

  bot.runeMakerDrop = {
    start,
    stop,
    status,
    updateConfig,
    setDropPosition,
    config,
  };

  if (config.enabled) start();
  else {
    state.running = true;
    tick();
  }
};
