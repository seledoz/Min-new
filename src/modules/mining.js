window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installMiningModule = function installMiningModule(bot) {
  if (!bot || bot.mining?.destroy) return bot?.mining;

  const configStorageKey = "minibiaBot.mining.config";
  const sectionId = "minibia-bot-mining-section";
  const enabledId = "minibia-bot-mining-enabled";
  const hotkeyId = "minibia-bot-mining-hotkey";
  const cooldownId = "minibia-bot-mining-cooldown";
  const rockNameId = "minibia-bot-mining-rock-name";
  const statusId = "minibia-bot-mining-status";

  const state = {
    timerId: null,
    uiTimerId: null,
    running: false,
    using: false,
    lastMineAt: 0,
    lastRockPosition: null,
    lastRockName: "",
    lastResult: "idle",
  };

  const config = Object.assign({
    enabled: false,
    pickHotbarSlot: null,
    cooldownMs: 1500,
    rockNameFilter: "rock",
    tickMs: 250,
    crosshairDelayMs: 125,
  }, bot.storage.get(configStorageKey, {}) || {});

  config.enabled = !!config.enabled;
  config.pickHotbarSlot = normalizeHotbarSlot(config.pickHotbarSlot);
  config.cooldownMs = nonNegativeInt(config.cooldownMs, 1500);
  config.rockNameFilter = String(config.rockNameFilter || "rock").trim() || "rock";
  config.tickMs = positiveInt(config.tickMs, 250);
  config.crosshairDelayMs = nonNegativeInt(config.crosshairDelayMs, 125);

  function persistConfig() { bot.storage.set(configStorageKey, { ...config }); }
  function normalizeHotbarSlot(slot) { const n = Math.trunc(Number(slot)); return Number.isFinite(n) && n >= 1 && n <= 12 ? n : null; }
  function positiveInt(value, fallback) { const n = Math.trunc(Number(value)); return Number.isFinite(n) && n > 0 ? n : fallback; }
  function nonNegativeInt(value, fallback) { const n = Math.trunc(Number(value)); return Number.isFinite(n) && n >= 0 ? n : fallback; }
  function normalizeName(value) { return String(value || "").trim().toLowerCase(); }

  function normalizePosition(value) {
    const raw = value?.getPosition?.() || value?.__position || value?.position || value;
    if (!raw) return null;
    const x = Number(raw.x), y = Number(raw.y), z = Number(raw.z);
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
      ? { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) }
      : null;
  }

  function positionKey(position) {
    return position ? `${position.x},${position.y},${position.z}` : "";
  }

  function getThingDefinition(itemId) {
    if (!itemId) return null;
    return (
      window.gameClient?.itemDefinitionsByCid?.[itemId] ||
      window.gameClient?.itemDefinitionsBySid?.[itemId] ||
      window.gameClient?.itemDefinitions?.[itemId] ||
      null
    );
  }

  function getThingName(thing) {
    const definition = getThingDefinition(thing?.id);
    return normalizeName(definition?.properties?.name || thing?.name || "");
  }

  function getTileThings(tile) {
    if (!tile) return [];
    const things = [];
    if (tile.id) things.push(tile);
    if (Array.isArray(tile.items)) {
      tile.items.forEach((item) => { if (item) things.push(item); });
    }
    return things;
  }

  function getTilePosition(tile) {
    return normalizePosition(tile?.__position || tile?.position);
  }

  function getLoadedTiles() {
    const chunks = window.gameClient?.world?.chunks || [];
    const tiles = [];
    for (const chunk of chunks) {
      if (!chunk?.tiles) continue;
      for (const tile of chunk.tiles) {
        if (tile?.__position) tiles.push(tile);
      }
    }
    return tiles;
  }

  function getAdjacentPositions(origin) {
    if (!origin) return [];
    const positions = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if (dx === 0 && dy === 0) continue;
        positions.push({ x: origin.x + dx, y: origin.y + dy, z: origin.z });
      }
    }
    return positions;
  }

  function tileMatchesRock(tile) {
    const filter = normalizeName(config.rockNameFilter);
    const names = getTileThings(tile).map(getThingName).filter(Boolean);
    if (!names.length) return false;
    if (filter) return names.some((name) => name.includes(filter));
    return names.some((name) => /\b(rock|ore|stone|mineral)\b/i.test(name));
  }

  function getMatchingRockName(tile) {
    const filter = normalizeName(config.rockNameFilter);
    const names = getTileThings(tile).map(getThingName).filter(Boolean);
    return names.find((name) => filter ? name.includes(filter) : /\b(rock|ore|stone|mineral)\b/i.test(name)) || names[0] || "rock";
  }

  function getAdjacentRockTiles() {
    const origin = normalizePosition(bot.getPlayerPosition?.());
    if (!origin) return [];
    const adjacentKeys = new Set(getAdjacentPositions(origin).map(positionKey));
    return getLoadedTiles()
      .map((tile) => ({ tile, position: getTilePosition(tile) }))
      .filter((entry) => entry.position && adjacentKeys.has(positionKey(entry.position)) && tileMatchesRock(entry.tile));
  }

  function chooseRandom(entries) {
    if (!entries.length) return null;
    return entries[Math.floor(Math.random() * entries.length)] || null;
  }

  function clickCrosshairOnTile(entry) {
    const mouse = window.gameClient?.mouse;
    const target = { which: entry.tile, index: 0xFF };

    if (typeof mouse?.__handleItemUseWith === "function") {
      try {
        mouse.__handleItemUseWith(null, target);
        return true;
      } catch (error) {}
    }

    if (typeof mouse?.__handleThingUse === "function") {
      try {
        mouse.__handleThingUse(target);
        return true;
      } catch (error) {}
    }

    if (typeof mouse?.__handleTileClick === "function") {
      try {
        mouse.__handleTileClick(entry.tile);
        return true;
      } catch (error) {}
    }

    return false;
  }

  function usePickOnRock(entry) {
    if (!entry?.tile || state.using) return false;
    const slot = normalizeHotbarSlot(config.pickHotbarSlot);
    if (!slot) {
      state.lastResult = "no pick hotkey";
      return false;
    }

    const pressed = bot.clickHotbar?.(slot - 1);
    if (!pressed) {
      state.lastResult = "hotkey failed";
      return false;
    }

    state.using = true;
    window.setTimeout(() => {
      try {
        const clicked = clickCrosshairOnTile(entry);
        state.lastRockPosition = entry.position;
        state.lastRockName = getMatchingRockName(entry.tile);
        state.lastResult = clicked ? "mined" : "tile click failed";
        bot.log(clicked ? "mined random adjacent rock" : "mining tile click failed", {
          position: entry.position,
          rockName: state.lastRockName,
          hotbarSlot: slot,
          crosshairDelayMs: config.crosshairDelayMs,
        });
      } finally {
        state.using = false;
        refreshUiValues();
      }
    }, config.crosshairDelayMs);

    return true;
  }

  function tick() {
    if (!state.running || !config.enabled || state.using) return;
    const now = Date.now();
    if (now - state.lastMineAt < config.cooldownMs) return;
    const rocks = getAdjacentRockTiles();
    if (!rocks.length) {
      state.lastResult = "no adjacent rock";
      refreshUiValues();
      return;
    }

    const entry = chooseRandom(rocks);
    if (usePickOnRock(entry)) {
      state.lastMineAt = now;
    }
    refreshUiValues();
  }

  function start(options = {}) {
    updateConfig({ ...options, enabled: options.enabled ?? true });
    if (state.running) return true;
    state.running = true;
    state.timerId = window.setInterval(tick, config.tickMs);
    tick();
    refreshUiValues();
    bot.log("mining started", { hotbarSlot: config.pickHotbarSlot, cooldownMs: config.cooldownMs, rockNameFilter: config.rockNameFilter });
    return true;
  }

  function stop(options = {}) {
    const persistEnabled = options.persistEnabled !== false;
    state.running = false;
    state.using = false;
    if (state.timerId) {
      window.clearInterval(state.timerId);
      state.timerId = null;
    }
    if (persistEnabled) {
      config.enabled = false;
      persistConfig();
    }
    refreshUiValues();
    bot.log("mining stopped");
    return true;
  }

  function updateConfig(next = {}) {
    if (Object.prototype.hasOwnProperty.call(next, "pickHotbarSlot")) config.pickHotbarSlot = normalizeHotbarSlot(next.pickHotbarSlot);
    if (Object.prototype.hasOwnProperty.call(next, "cooldownMs")) config.cooldownMs = nonNegativeInt(next.cooldownMs, config.cooldownMs);
    if (Object.prototype.hasOwnProperty.call(next, "rockNameFilter")) config.rockNameFilter = String(next.rockNameFilter || "").trim() || "rock";
    if (Object.prototype.hasOwnProperty.call(next, "crosshairDelayMs")) config.crosshairDelayMs = nonNegativeInt(next.crosshairDelayMs, config.crosshairDelayMs);
    if (Object.prototype.hasOwnProperty.call(next, "enabled")) config.enabled = !!next.enabled;
    persistConfig();
    refreshUiValues();
    return { ...config };
  }

  function status() {
    const rocks = getAdjacentRockTiles();
    return {
      running: state.running,
      using: state.using,
      config: { ...config },
      adjacentRockCount: rocks.length,
      lastRockPosition: state.lastRockPosition,
      lastRockName: state.lastRockName,
      lastResult: state.lastResult,
    };
  }

  function ensurePanelSection() {
    const panel = document.getElementById("minibia-bot-panel") || document.getElementById("k9x-panel");
    if (!panel || document.getElementById(sectionId)) return false;
    const firstColumn = panel.querySelector(".mb-main-column") || panel.querySelector(".mb-body") || panel;
    const section = document.createElement("div");
    section.id = sectionId;
    section.className = "mb-section mb-column-section";
    section.innerHTML = `
      <div class="mb-label">Mining</div>
      <div class="mb-stack">
        <label class="mb-toggle"><input type="checkbox" id="${enabledId}" /><span>Enable Mining</span></label>
        <div class="mb-field-grid">
          <label class="mb-field"><span class="mb-field-label">Pick Hotkey</span><input type="number" id="${hotkeyId}" min="1" max="12" step="1" /></label>
          <label class="mb-field"><span class="mb-field-label">Cooldown ms</span><input type="number" id="${cooldownId}" min="0" step="100" /></label>
        </div>
        <label class="mb-field"><span class="mb-field-label">Rock name contains</span><input type="text" id="${rockNameId}" /></label>
        <div class="mb-small-note" id="${statusId}">Status: idle</div>
      </div>`;
    firstColumn.prepend(section);

    const enabled = document.getElementById(enabledId);
    const hotkey = document.getElementById(hotkeyId);
    const cooldown = document.getElementById(cooldownId);
    const rockName = document.getElementById(rockNameId);

    enabled.addEventListener("change", () => enabled.checked ? start({ enabled: true }) : stop());
    hotkey.addEventListener("input", () => updateConfig({ pickHotbarSlot: hotkey.value }));
    cooldown.addEventListener("input", () => updateConfig({ cooldownMs: cooldown.value }));
    rockName.addEventListener("input", () => updateConfig({ rockNameFilter: rockName.value }));

    refreshUiValues();
    return true;
  }

  function refreshUiValues() {
    const enabled = document.getElementById(enabledId);
    const hotkey = document.getElementById(hotkeyId);
    const cooldown = document.getElementById(cooldownId);
    const rockName = document.getElementById(rockNameId);
    const statusLabel = document.getElementById(statusId);

    if (enabled) enabled.checked = !!config.enabled && !!state.running;
    if (hotkey && document.activeElement !== hotkey) hotkey.value = config.pickHotbarSlot == null ? "" : String(config.pickHotbarSlot);
    if (cooldown && document.activeElement !== cooldown) cooldown.value = String(config.cooldownMs);
    if (rockName && document.activeElement !== rockName) rockName.value = config.rockNameFilter;
    if (statusLabel) {
      const rocks = getAdjacentRockTiles();
      const last = state.lastRockPosition ? ` last ${state.lastRockName || "rock"} at ${state.lastRockPosition.x},${state.lastRockPosition.y},${state.lastRockPosition.z}` : "";
      statusLabel.textContent = state.running
        ? `Status: running, ${rocks.length} adjacent rock${rocks.length === 1 ? "" : "s"}, ${state.lastResult}${state.using ? "..." : ""}${last}`
        : `Status: idle, ${rocks.length} adjacent rock${rocks.length === 1 ? "" : "s"}`;
    }
  }

  function destroy() {
    stop({ persistEnabled: false });
    if (state.uiTimerId) {
      window.clearInterval(state.uiTimerId);
      state.uiTimerId = null;
    }
    document.getElementById(sectionId)?.remove();
  }

  bot.mining = { start, stop, updateConfig, status, destroy, getAdjacentRockTiles, config };

  state.uiTimerId = window.setInterval(() => {
    ensurePanelSection();
    refreshUiValues();
  }, 500);

  if (config.enabled) start({ enabled: true });
  ensurePanelSection();

  return bot.mining;
};
