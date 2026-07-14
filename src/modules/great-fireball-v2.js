window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installGreatFireballV2Module = function installGreatFireballV2Module(bot) {
  if (!bot || bot.greatFireballV2?.destroy) return bot?.greatFireballV2;

  const configStorageKey = "minibiaBot.greatFireballV2.config";
  const sectionId = "minibia-bot-gfb-v2-section";
  const state = {
    running: false,
    timerId: null,
    uiTimerId: null,
    lastCastAt: 0,
    lastMonsterCount: 0,
    lastTargetName: "",
    lastTargetPosition: null,
  };

  const config = Object.assign({
    enabled: false,
    hotbarSlot: null,
    minMonsters: 4,
    cooldownMs: 2000,
    scanMs: 250,
    maxRange: 7,
    respectTargetFilters: true,
  }, bot.storage.get(configStorageKey, {}) || {});

  function normalizeHotbarSlot(value) {
    const slot = Math.trunc(Number(value));
    return Number.isFinite(slot) && slot >= 1 && slot <= 12 ? slot : null;
  }

  function positiveInt(value, fallback) {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function nonNegativeInt(value, fallback) {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }

  function normalizeName(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getPosition(value) {
    const raw = value?.getPosition?.() || value?.__position || value?.position || value;
    if (!raw) return null;
    const x = Number(raw.x);
    const y = Number(raw.y);
    const z = Number(raw.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) };
  }

  function tileDistance(left, right) {
    if (!left || !right || Number(left.z) !== Number(right.z)) return Number.POSITIVE_INFINITY;
    return Math.max(Math.abs(Number(left.x) - Number(right.x)), Math.abs(Number(left.y) - Number(right.y)));
  }

  function positionKey(position) {
    return position ? `${position.x},${position.y},${position.z}` : "";
  }

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  config.enabled = !!config.enabled;
  config.hotbarSlot = normalizeHotbarSlot(config.hotbarSlot);
  config.minMonsters = positiveInt(config.minMonsters, 4);
  config.cooldownMs = nonNegativeInt(config.cooldownMs, 2000);
  config.scanMs = Math.max(100, positiveInt(config.scanMs, 250));
  config.maxRange = Math.min(7, positiveInt(config.maxRange, 7));
  config.respectTargetFilters = config.respectTargetFilters !== false;

  function passesTargetFilters(monster) {
    if (!config.respectTargetFilters) return true;
    const attackConfig = bot.attack?.config || {};
    const mode = ["include", "exclude"].includes(attackConfig.targetFilterMode)
      ? attackConfig.targetFilterMode
      : "all";
    const name = normalizeName(monster?.name || "Mob");
    const included = new Set((attackConfig.includedCreatureNames || []).map(normalizeName));
    const excluded = new Set((attackConfig.excludedCreatureNames || []).map(normalizeName));
    if (excluded.has(name)) return false;
    if (mode === "include" && included.size) return included.has(name);
    return true;
  }

  function getVisibleMonsters() {
    return (bot.xray?.getVisibleMonsters?.({ sameFloorOnly: true }) || []).filter(passesTargetFilters);
  }

  function getGfbTiles(centerPosition) {
    if (!centerPosition) return [];
    const rowWidths = [1, 5, 5, 7, 5, 5, 1];
    const tiles = [];
    rowWidths.forEach((width, row) => {
      const half = Math.floor(width / 2);
      const yOffset = row - 3;
      for (let xOffset = -half; xOffset <= half; xOffset += 1) {
        tiles.push({
          x: centerPosition.x + xOffset,
          y: centerPosition.y + yOffset,
          z: centerPosition.z,
        });
      }
    });
    return tiles;
  }

  function evaluateAtPosition(centerPosition, monsters) {
    const tileKeys = new Set(getGfbTiles(centerPosition).map(positionKey));
    const hitMonsters = monsters.filter((monster) => {
      const position = getPosition(monster);
      return position && position.z === centerPosition.z && tileKeys.has(positionKey(position));
    });
    return {
      position: centerPosition,
      count: hitMonsters.length,
      monsters: hitMonsters,
      target: hitMonsters[0] || null,
    };
  }

  function getBestCandidate() {
    const playerPosition = getPosition(bot.getPlayerPosition?.());
    if (!playerPosition) return null;

    const monsters = getVisibleMonsters().filter((monster) => {
      const position = getPosition(monster);
      return position &&
        position.z === playerPosition.z &&
        tileDistance(playerPosition, position) <= config.maxRange;
    });
    if (!monsters.length) return null;

    const candidates = new Map();
    monsters.forEach((monster) => {
      const position = getPosition(monster);
      if (position) candidates.set(positionKey(position), position);
    });

    const evaluations = Array.from(candidates.values()).map((position) => evaluateAtPosition(position, monsters));
    evaluations.sort((left, right) => {
      const countDifference = right.count - left.count;
      if (countDifference) return countDifference;
      return tileDistance(playerPosition, left.position) - tileDistance(playerPosition, right.position);
    });
    return evaluations[0] || null;
  }

  function getTile(position) {
    if (!position) return null;
    try {
      const worldPosition = typeof Position === "function"
        ? new Position(position.x, position.y, position.z)
        : position;
      return window.gameClient?.world?.getTileFromWorldPosition?.(worldPosition) || null;
    } catch (error) {
      return null;
    }
  }

  function fireCrosshairAt(best) {
    const slot = normalizeHotbarSlot(config.hotbarSlot);
    if (!slot || !best?.position) return false;
    if (!bot.clickHotbar?.(slot - 1)) return false;

    const tile = getTile(best.position);
    const target = best.target || best.monsters?.[0] || null;
    const mouse = window.gameClient?.mouse;
    const targetRef = tile
      ? { which: tile, index: 0xFF }
      : target
        ? { which: target, index: 0xFF }
        : null;

    if (targetRef && typeof mouse?.__handleItemUseWith === "function") {
      try {
        mouse.__handleItemUseWith(null, targetRef);
        return true;
      } catch (error) {}
    }
    if (targetRef && typeof mouse?.__handleThingUse === "function") {
      try {
        mouse.__handleThingUse(targetRef);
        return true;
      } catch (error) {}
    }
    if (tile && typeof mouse?.__handleTileClick === "function") {
      try {
        mouse.__handleTileClick(tile);
        return true;
      } catch (error) {}
    }
    if (target && typeof mouse?.__handleCreatureClick === "function") {
      try {
        mouse.__handleCreatureClick(target);
        return true;
      } catch (error) {}
    }

    bot.log("great fireball 2.0 could not click crosshair target", {
      position: best.position,
      target: target?.name || "Mob",
    });
    return false;
  }

  function canCast(now = Date.now()) {
    if (!state.running || !config.enabled || !normalizeHotbarSlot(config.hotbarSlot)) return false;
    if (now - state.lastCastAt < config.cooldownMs) return false;
    const best = getBestCandidate();
    return !!best && best.count >= config.minMonsters;
  }

  function trigger(now = Date.now()) {
    if (!canCast(now)) return false;
    const best = getBestCandidate();
    if (!best || best.count < config.minMonsters) return false;

    const fired = fireCrosshairAt(best);
    if (fired) {
      state.lastCastAt = now;
      state.lastMonsterCount = best.count;
      state.lastTargetName = best.target?.name || best.monsters?.[0]?.name || "Mob";
      state.lastTargetPosition = best.position;
      bot.log("used great fireball 2.0 at biggest group", {
        slot: config.hotbarSlot,
        monsterCount: best.count,
        target: state.lastTargetName,
        position: best.position,
        minimum: config.minMonsters,
      });
    }
    refreshUi();
    return fired;
  }

  function tick() {
    if (!state.running) return;
    try {
      trigger();
    } catch (error) {
      bot.log("great fireball 2.0 tick failed", error?.message || error);
    }
    state.timerId = window.setTimeout(tick, config.scanMs);
  }

  function start(overrides = {}) {
    updateConfig({ ...overrides, enabled: true }, { silent: true });
    if (state.running) return false;
    state.running = true;
    tick();
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
    refreshUi();
    return true;
  }

  function updateConfig(nextConfig = {}, options = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "enabled")) nextConfig.enabled = !!nextConfig.enabled;
    if (Object.prototype.hasOwnProperty.call(nextConfig, "hotbarSlot")) nextConfig.hotbarSlot = normalizeHotbarSlot(nextConfig.hotbarSlot);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "minMonsters")) nextConfig.minMonsters = positiveInt(nextConfig.minMonsters, config.minMonsters || 4);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "cooldownMs")) nextConfig.cooldownMs = nonNegativeInt(nextConfig.cooldownMs, config.cooldownMs || 2000);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "scanMs")) nextConfig.scanMs = Math.max(100, positiveInt(nextConfig.scanMs, config.scanMs || 250));
    if (Object.prototype.hasOwnProperty.call(nextConfig, "maxRange")) nextConfig.maxRange = Math.min(7, positiveInt(nextConfig.maxRange, config.maxRange || 7));
    if (Object.prototype.hasOwnProperty.call(nextConfig, "respectTargetFilters")) nextConfig.respectTargetFilters = nextConfig.respectTargetFilters !== false;
    Object.assign(config, nextConfig);
    persistConfig();
    if (!options.silent) refreshUi();
    return { ...config };
  }

  function status() {
    const best = getBestCandidate();
    return {
      running: state.running,
      config: { ...config },
      bestMonsterCount: best?.count || 0,
      bestTargetName: best?.target?.name || "",
      bestTargetPosition: best?.position || null,
      lastMonsterCount: state.lastMonsterCount,
      lastTargetName: state.lastTargetName,
      lastTargetPosition: state.lastTargetPosition,
      ready: canCast(Date.now()),
    };
  }

  function ensureUi() {
    const aoeSection = document.getElementById("minibia-bot-auto-attack-aoe-section");
    if (!aoeSection || document.getElementById(sectionId)) return;

    const section = document.createElement("div");
    section.id = sectionId;
    section.className = "mb-section";
    section.innerHTML = `
      <div class="mb-label">Great Fireball 2.0 — Crosshairs</div>
      <label class="mb-toggle"><input type="checkbox" id="minibia-bot-gfb-v2-enabled" /><span>Enable Great Fireball 2.0</span></label>
      <div class="mb-field-grid">
        <label class="mb-field"><span class="mb-field-label">GFB 2.0 Hotkey</span><input type="number" id="minibia-bot-gfb-v2-hotkey" min="1" max="12" placeholder="8" /></label>
        <label class="mb-field"><span class="mb-field-label">Minimum Creatures</span><input type="number" id="minibia-bot-gfb-v2-monsters" min="1" placeholder="4" /></label>
        <label class="mb-field"><span class="mb-field-label">Cooldown MS</span><input type="number" id="minibia-bot-gfb-v2-cooldown" min="0" placeholder="2000" /></label>
      </div>
      <div class="mb-small-note">Set the Great Fireball hotkey to Use with Crosshairs. The bot shoots the tile that hits the biggest group and waits until the minimum is met.</div>
      <div class="mb-small-note" id="minibia-bot-gfb-v2-status">GFB 2.0: off</div>`;

    const originalGfb = document.getElementById("minibia-bot-gfb-section") ||
      document.getElementById("minibia-bot-gfb-enabled")?.closest?.(".mb-section");
    if (originalGfb?.parentElement) originalGfb.insertAdjacentElement("afterend", section);
    else aoeSection.querySelector(".mb-stack")?.appendChild(section);

    const enabled = section.querySelector("#minibia-bot-gfb-v2-enabled");
    const hotkey = section.querySelector("#minibia-bot-gfb-v2-hotkey");
    const monsters = section.querySelector("#minibia-bot-gfb-v2-monsters");
    const cooldown = section.querySelector("#minibia-bot-gfb-v2-cooldown");
    enabled?.addEventListener("change", () => enabled.checked ? start() : stop());
    hotkey?.addEventListener("change", () => updateConfig({ hotbarSlot: hotkey.value }));
    monsters?.addEventListener("change", () => updateConfig({ minMonsters: monsters.value }));
    cooldown?.addEventListener("change", () => updateConfig({ cooldownMs: cooldown.value }));
    refreshUi();
  }

  function refreshUi() {
    const enabled = document.getElementById("minibia-bot-gfb-v2-enabled");
    const hotkey = document.getElementById("minibia-bot-gfb-v2-hotkey");
    const monsters = document.getElementById("minibia-bot-gfb-v2-monsters");
    const cooldown = document.getElementById("minibia-bot-gfb-v2-cooldown");
    const statusLabel = document.getElementById("minibia-bot-gfb-v2-status");
    const best = getBestCandidate();
    if (enabled) enabled.checked = !!state.running;
    if (hotkey && document.activeElement !== hotkey) hotkey.value = config.hotbarSlot || "";
    if (monsters && document.activeElement !== monsters) monsters.value = config.minMonsters;
    if (cooldown && document.activeElement !== cooldown) cooldown.value = config.cooldownMs;
    if (statusLabel) {
      statusLabel.textContent = state.running
        ? `GFB 2.0: biggest group ${best?.count || 0}/${config.minMonsters}`
        : "GFB 2.0: off";
    }
  }

  function destroy() {
    stop({ persistEnabled: false });
    if (state.uiTimerId != null) window.clearInterval(state.uiTimerId);
    document.getElementById(sectionId)?.remove();
  }

  bot.greatFireballV2 = {
    start,
    stop,
    trigger,
    status,
    updateConfig,
    getBestCandidate,
    evaluateAtPosition,
    getGfbTiles,
    destroy,
    config,
  };

  state.uiTimerId = window.setInterval(() => {
    ensureUi();
    refreshUi();
  }, 1000);
  bot.addCleanup(destroy);
  if (config.enabled) start(); else ensureUi();
  return bot.greatFireballV2;
};
