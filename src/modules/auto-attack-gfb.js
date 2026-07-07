window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installAutoAttackGfbModule = function installAutoAttackGfbModule(bot) {
  if (!bot || bot.attackGfb?.destroy) return bot?.attackGfb;

  const configStorageKey = "minibiaBot.attackGfb.config";
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
    respectTargetFilters: true,
  }, bot.storage.get(configStorageKey, {}) || {});

  config.enabled = !!config.enabled;
  config.hotbarSlot = normalizeHotbarSlot(config.hotbarSlot);
  config.minMonsters = positiveInt(config.minMonsters, 4);
  config.cooldownMs = nonNegativeInt(config.cooldownMs, 2000);
  config.scanMs = Math.max(100, positiveInt(config.scanMs, 250));
  config.respectTargetFilters = config.respectTargetFilters !== false;

  function persistConfig() { bot.storage.set(configStorageKey, { ...config }); }
  function normalizeHotbarSlot(slot) { const n = Math.trunc(Number(slot)); return Number.isFinite(n) && n >= 1 && n <= 12 ? n : null; }
  function positiveInt(value, fallback) { const n = Math.trunc(Number(value)); return Number.isFinite(n) && n > 0 ? n : fallback; }
  function nonNegativeInt(value, fallback) { const n = Math.trunc(Number(value)); return Number.isFinite(n) && n >= 0 ? n : fallback; }
  function normalizeName(name) { return String(name || "").trim().toLowerCase(); }

  function getPosition(value) {
    const raw = value?.getPosition?.() || value?.__position || value?.position || value;
    if (!raw) return null;
    const x = Number(raw.x), y = Number(raw.y), z = Number(raw.z);
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
      ? { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) }
      : null;
  }

  function tileDistance(a, b) {
    if (!a || !b || Number(a.z) !== Number(b.z)) return Number.POSITIVE_INFINITY;
    return Math.max(Math.abs(Number(a.x) - Number(b.x)), Math.abs(Number(a.y) - Number(b.y)));
  }

  function positionKey(position) {
    return position ? `${position.x},${position.y},${position.z}` : "";
  }

  function passesTargetFilters(monster) {
    if (!config.respectTargetFilters) return true;
    const attackConfig = bot.attack?.config || {};
    const mode = attackConfig.targetFilterMode === "include" || attackConfig.targetFilterMode === "exclude" ? attackConfig.targetFilterMode : "all";
    const monsterName = normalizeName(monster?.name || "Mob");
    const included = new Set((attackConfig.includedCreatureNames || []).map(normalizeName));
    const excluded = new Set((attackConfig.excludedCreatureNames || []).map(normalizeName));
    if (mode === "include") return (!included.size || included.has(monsterName)) && !excluded.has(monsterName);
    if (mode === "exclude") return !excluded.has(monsterName);
    return !excluded.has(monsterName);
  }

  function getVisibleMonsters() {
    return (bot.xray?.getVisibleMonsters?.({ sameFloorOnly: true }) || []).filter(passesTargetFilters);
  }

  function getGfbTiles(centerPosition) {
    if (!centerPosition) return [];
    const rowWidths = [1, 5, 5, 7, 5, 5, 1];
    const tiles = [];
    for (let row = 0; row < rowWidths.length; row += 1) {
      const width = rowWidths[row];
      const yOffset = row - 3;
      const half = Math.floor(width / 2);
      for (let xOffset = -half; xOffset <= half; xOffset += 1) {
        tiles.push({ x: centerPosition.x + xOffset, y: centerPosition.y + yOffset, z: centerPosition.z });
      }
    }
    return tiles;
  }

  function evaluateGfbAtPosition(centerPosition, monsters = getVisibleMonsters()) {
    const tileKeys = new Set(getGfbTiles(centerPosition).map(positionKey));
    const hitMonsters = monsters.filter((monster) => {
      const position = getPosition(monster);
      return position && position.z === centerPosition.z && tileKeys.has(positionKey(position));
    });
    return { position: centerPosition, count: hitMonsters.length, monsters: hitMonsters, tiles: Array.from(tileKeys) };
  }

  function getBestGfbCandidate() {
    const playerPosition = getPosition(bot.getPlayerPosition?.());
    if (!playerPosition) return null;

    const monsters = getVisibleMonsters().filter((monster) => {
      const position = getPosition(monster);
      return position && position.z === playerPosition.z && tileDistance(playerPosition, position) <= 7;
    });
    if (!monsters.length) return null;

    const candidatesByKey = new Map();
    monsters.forEach((monster) => {
      const position = getPosition(monster);
      if (position) candidatesByKey.set(positionKey(position), { position, target: monster });
    });

    const evaluations = Array.from(candidatesByKey.values()).map((candidate) => ({
      ...evaluateGfbAtPosition(candidate.position, monsters),
      target: candidate.target,
    }));

    evaluations.sort((left, right) => {
      const countDiff = right.count - left.count;
      if (countDiff) return countDiff;
      return tileDistance(playerPosition, left.position) - tileDistance(playerPosition, right.position);
    });

    return evaluations[0] || null;
  }

  function getTileFromPosition(position) {
    if (!position) return null;
    if (typeof Position === "function") {
      return window.gameClient?.world?.getTileFromWorldPosition?.(new Position(position.x, position.y, position.z)) || null;
    }
    return window.gameClient?.world?.getTileFromWorldPosition?.(position) || null;
  }

  function clickCrosshairTarget(best) {
    const slot = normalizeHotbarSlot(config.hotbarSlot);
    if (!slot || !best?.position) return false;

    if (!bot.clickHotbar(slot - 1)) return false;

    const tile = getTileFromPosition(best.position);
    const target = best.target || best.monsters?.[0] || tile;
    const mouse = window.gameClient?.mouse;
    const targetRef = tile ? { which: tile, index: 0xFF } : target ? { which: target, index: 0xFF } : null;

    const fireTarget = () => {
      if (targetRef && typeof mouse?.__handleItemUseWith === "function") {
        try { mouse.__handleItemUseWith(null, targetRef); return true; } catch (error) {}
      }
      if (targetRef && typeof mouse?.__handleThingUse === "function") {
        try { mouse.__handleThingUse(targetRef); return true; } catch (error) {}
      }
      if (tile && typeof mouse?.__handleTileClick === "function") {
        try { mouse.__handleTileClick(tile); return true; } catch (error) {}
      }
      if (target && typeof mouse?.__handleCreatureClick === "function") {
        try { mouse.__handleCreatureClick(target); return true; } catch (error) {}
      }
      return false;
    };

    if (fireTarget()) return true;

    bot.log("GFB crosshair target could not be clicked by known mouse handlers", { position: best.position, target: best.target?.name || "Mob" });
    return false;
  }

  function canCast(now = Date.now()) {
    const slot = normalizeHotbarSlot(config.hotbarSlot);
    if (!state.running || !config.enabled || !slot) return false;
    if (now - state.lastCastAt < nonNegativeInt(config.cooldownMs, 2000)) return false;
    const best = getBestGfbCandidate();
    return !!best && best.count >= positiveInt(config.minMonsters, 4);
  }

  function triggerGreatFireball(now = Date.now()) {
    if (!canCast(now)) return false;
    const best = getBestGfbCandidate();
    if (!best || best.count < positiveInt(config.minMonsters, 4)) return false;

    const casted = clickCrosshairTarget(best);
    if (casted) {
      state.lastCastAt = now;
      state.lastMonsterCount = best.count;
      state.lastTargetName = best.target?.name || best.monsters?.[0]?.name || "Mob";
      state.lastTargetPosition = best.position;
      bot.log("used great fireball hotkey", { slot: config.hotbarSlot, monsterCount: best.count, target: state.lastTargetName, position: best.position, shape: "1-5-5-7-5-5-1" });
    }
    refreshUiValues();
    return casted;
  }

  function tick() {
    if (!state.running) return;
    try { triggerGreatFireball(); } catch (error) { bot.log("great fireball tick failed", error?.message || error); }
    state.timerId = window.setTimeout(tick, Math.max(100, positiveInt(config.scanMs, 250)));
  }

  function start(overrides = {}) {
    updateConfig(Object.assign({}, overrides, { enabled: true }), { silent: true });
    if (state.running) return false;
    state.running = true;
    bot.log("great fireball started", { ...config });
    tick();
    refreshUiValues();
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
    bot.log("great fireball stopped");
    refreshUiValues();
    return true;
  }

  function updateConfig(nextConfig = {}, options = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "enabled")) nextConfig.enabled = !!nextConfig.enabled;
    if (Object.prototype.hasOwnProperty.call(nextConfig, "hotbarSlot")) nextConfig.hotbarSlot = normalizeHotbarSlot(nextConfig.hotbarSlot);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "minMonsters")) nextConfig.minMonsters = positiveInt(nextConfig.minMonsters, config.minMonsters || 4);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "cooldownMs")) nextConfig.cooldownMs = nonNegativeInt(nextConfig.cooldownMs, config.cooldownMs || 2000);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "scanMs")) nextConfig.scanMs = Math.max(100, positiveInt(nextConfig.scanMs, config.scanMs || 250));
    if (Object.prototype.hasOwnProperty.call(nextConfig, "respectTargetFilters")) nextConfig.respectTargetFilters = nextConfig.respectTargetFilters !== false;
    Object.assign(config, nextConfig);
    persistConfig();
    if (!options.silent) refreshUiValues();
    return { ...config };
  }

  function status() {
    const best = getBestGfbCandidate();
    return {
      running: state.running,
      config: { ...config },
      lastMonsterCount: state.lastMonsterCount,
      lastTargetName: state.lastTargetName,
      lastTargetPosition: state.lastTargetPosition,
      bestMonsterCount: best?.count || 0,
      bestTargetName: best?.target?.name || "",
      bestTargetPosition: best?.position || null,
      ready: canCast(Date.now()),
    };
  }

  function ensureUi() {
    const aoeSection = document.getElementById("minibia-bot-auto-attack-aoe-section");
    if (!aoeSection || document.getElementById("minibia-bot-gfb-section")) return;

    const section = document.createElement("div");
    section.className = "mb-section";
    section.id = "minibia-bot-gfb-section";
    section.innerHTML = `
      <div class="mb-label">Great Fireball 1-5-5-7-5-5-1</div>
      <label class="mb-toggle"><input type="checkbox" id="minibia-bot-gfb-enabled" /><span>Enable Great Fireball</span></label>
      <div class="mb-field-grid">
        <label class="mb-field"><span class="mb-field-label">GFB Hotkey</span><input type="number" id="minibia-bot-gfb-hotkey" min="1" max="12" placeholder="8" /></label>
        <label class="mb-field"><span class="mb-field-label">GFB Min Creatures</span><input type="number" id="minibia-bot-gfb-monsters" min="1" placeholder="4" /></label>
        <label class="mb-field"><span class="mb-field-label">GFB Cooldown MS</span><input type="number" id="minibia-bot-gfb-cooldown" min="0" placeholder="2000" /></label>
      </div>
      <div class="mb-small-note">Hotkey should have Great Fireball selected on crosshairs. Picks the best 1-5-5-7-5-5-1 shot and casts only if it hits the minimum.</div>
      <div class="mb-small-note" id="minibia-bot-gfb-status">GFB: idle</div>`;

    const energySection = document.getElementById("minibia-bot-energy-wave-enabled")?.closest?.(".mb-section");
    if (energySection?.parentElement) {
      energySection.insertAdjacentElement("afterend", section);
    } else {
      aoeSection.querySelector(".mb-stack")?.appendChild(section);
    }

    const enabled = section.querySelector("#minibia-bot-gfb-enabled");
    const hotkey = section.querySelector("#minibia-bot-gfb-hotkey");
    const monsters = section.querySelector("#minibia-bot-gfb-monsters");
    const cooldown = section.querySelector("#minibia-bot-gfb-cooldown");
    enabled?.addEventListener("change", () => enabled.checked ? start() : stop());
    hotkey?.addEventListener("change", () => updateConfig({ hotbarSlot: hotkey.value }));
    monsters?.addEventListener("change", () => updateConfig({ minMonsters: monsters.value }));
    cooldown?.addEventListener("change", () => updateConfig({ cooldownMs: cooldown.value }));
    refreshUiValues();
  }

  function refreshUiValues() {
    const enabled = document.getElementById("minibia-bot-gfb-enabled");
    const hotkey = document.getElementById("minibia-bot-gfb-hotkey");
    const monsters = document.getElementById("minibia-bot-gfb-monsters");
    const cooldown = document.getElementById("minibia-bot-gfb-cooldown");
    const statusLabel = document.getElementById("minibia-bot-gfb-status");
    const best = getBestGfbCandidate();
    if (enabled) enabled.checked = !!state.running;
    if (hotkey) hotkey.value = config.hotbarSlot || "";
    if (monsters) monsters.value = config.minMonsters;
    if (cooldown) cooldown.value = config.cooldownMs;
    if (statusLabel) statusLabel.textContent = state.running
      ? `GFB: best ${best?.count || 0}/${config.minMonsters}${best?.target ? ` via ${best.target.name || "Mob"}` : ""}`
      : "GFB: off";
  }

  function destroy() {
    stop({ persistEnabled: false });
    if (state.uiTimerId != null) window.clearInterval(state.uiTimerId);
    document.getElementById("minibia-bot-gfb-section")?.remove();
  }

  bot.attackGfb = { start, stop, status, updateConfig, triggerGreatFireball, getBestGfbCandidate, evaluateGfbAtPosition, getGfbTiles, destroy, config };
  state.uiTimerId = window.setInterval(() => { ensureUi(); refreshUiValues(); }, 1000);
  bot.addCleanup(destroy);
  if (config.enabled) start(); else ensureUi();
  return bot.attackGfb;
};
