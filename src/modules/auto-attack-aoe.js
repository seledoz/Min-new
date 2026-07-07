window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installAutoAttackAoeModule = function installAutoAttackAoeModule(bot) {
  if (!bot || bot.attackAoe?.destroy) return bot?.attackAoe;

  const configStorageKey = "minibiaBot.attackAoe.config";
  const state = {
    running: false,
    timerId: null,
    uiTimerId: null,
    lastSpellHotkeyAt: 0,
    lastCastMonsterCount: 0,
    lastEnergyWaveHotkeyAt: 0,
    lastEnergyWaveMonsterCount: 0,
    lastEnergyWaveTargetName: "",
    lastGfbHotkeyAt: 0,
    lastGfbMonsterCount: 0,
    lastGfbTargetName: "",
  };

  const config = Object.assign({
    enabled: false,
    spellHotbarSlot: null,
    minMonsters: 3,
    squareRange: 3,
    cooldownMs: 2000,
    tickMs: 250,
    requireAutoAttackRunning: true,
    respectTargetFilters: true,
    energyWaveEnabled: false,
    energyWaveHotbarSlot: null,
    energyWaveMinMonsters: 3,
    energyWaveCooldownMs: 2000,
    gfbEnabled: false,
    gfbHotbarSlot: null,
    gfbMinMonsters: 4,
    gfbCooldownMs: 2000,
  }, bot.storage.get(configStorageKey, {}) || {});

  config.spellHotbarSlot = normalizeHotbarSlot(config.spellHotbarSlot);
  config.minMonsters = positiveInt(config.minMonsters, 3);
  config.squareRange = positiveInt(config.squareRange, 3);
  config.cooldownMs = nonNegativeInt(config.cooldownMs, 2000);
  config.tickMs = positiveInt(config.tickMs, 250);
  config.requireAutoAttackRunning = config.requireAutoAttackRunning !== false;
  config.respectTargetFilters = config.respectTargetFilters !== false;
  config.energyWaveEnabled = !!config.energyWaveEnabled;
  config.energyWaveHotbarSlot = normalizeHotbarSlot(config.energyWaveHotbarSlot);
  config.energyWaveMinMonsters = positiveInt(config.energyWaveMinMonsters, 3);
  config.energyWaveCooldownMs = nonNegativeInt(config.energyWaveCooldownMs, 2000);
  config.gfbEnabled = !!config.gfbEnabled;
  config.gfbHotbarSlot = normalizeHotbarSlot(config.gfbHotbarSlot);
  config.gfbMinMonsters = positiveInt(config.gfbMinMonsters, 4);
  config.gfbCooldownMs = nonNegativeInt(config.gfbCooldownMs, 2000);

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

  function getCandidateMonsters() {
    const playerPosition = getPosition(bot.getPlayerPosition?.());
    if (!playerPosition) return [];
    const range = positiveInt(config.squareRange, 3);
    return getVisibleMonsters().filter((monster) => tileDistance(playerPosition, getPosition(monster)) <= range);
  }

  function isAutoAttackRunning() {
    if (!config.requireAutoAttackRunning) return true;
    return !!bot.attack?.status?.().running;
  }

  function canCastSquare(now = Date.now()) {
    const slot = normalizeHotbarSlot(config.spellHotbarSlot);
    if (!config.enabled || !state.running || !slot || !isAutoAttackRunning()) return false;
    if (now - state.lastSpellHotkeyAt < nonNegativeInt(config.cooldownMs, 2000)) return false;
    return getCandidateMonsters().length >= positiveInt(config.minMonsters, 3);
  }

  function triggerSquareSpell(now = Date.now()) {
    if (!canCastSquare(now)) return false;
    const slot = normalizeHotbarSlot(config.spellHotbarSlot);
    const monsters = getCandidateMonsters();
    const clicked = bot.clickHotbar(slot - 1);
    if (clicked) {
      state.lastSpellHotkeyAt = now;
      state.lastCastMonsterCount = monsters.length;
      bot.log("used auto attack AoE spell hotkey", { slot, monsterCount: monsters.length, squareRange: config.squareRange });
    }
    refreshUiValues();
    return clicked;
  }

  function getCurrentTarget() {
    return bot.attack?.getCurrentTarget?.() || window.gameClient?.player?.__target || null;
  }

  function isSameCreature(left, right) {
    return !!left && !!right && (left === right || left.id === right.id);
  }

  function setCurrentTarget(target) {
    if (!target || isSameCreature(getCurrentTarget(), target)) return true;
    if (!window.gameClient?.player || typeof window.gameClient.send !== "function" || typeof TargetPacket !== "function") return false;
    window.gameClient.player.setTarget(target);
    window.gameClient.send(new TargetPacket(target.id));
    return true;
  }

  function getDirectionToTarget(playerPosition, targetPosition) {
    if (!playerPosition || !targetPosition || playerPosition.z !== targetPosition.z) return null;
    const dx = targetPosition.x - playerPosition.x;
    const dy = targetPosition.y - playerPosition.y;
    if (dx === 0 && dy === 0) return null;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "east" : "west";
    return dy > 0 ? "south" : "north";
  }

  function getEnergyWaveTiles(playerPosition, direction) {
    if (!playerPosition || !direction) return [];
    const forward = { north: { x: 0, y: -1 }, south: { x: 0, y: 1 }, east: { x: 1, y: 0 }, west: { x: -1, y: 0 } }[direction];
    const side = { north: { x: 1, y: 0 }, south: { x: 1, y: 0 }, east: { x: 0, y: 1 }, west: { x: 0, y: 1 } }[direction];
    if (!forward || !side) return [];

    const tiles = [];
    tiles.push({ x: playerPosition.x + forward.x, y: playerPosition.y + forward.y, z: playerPosition.z });
    for (let distance = 2; distance <= 4; distance += 1) {
      for (let offset = -1; offset <= 1; offset += 1) {
        tiles.push({
          x: playerPosition.x + forward.x * distance + side.x * offset,
          y: playerPosition.y + forward.y * distance + side.y * offset,
          z: playerPosition.z,
        });
      }
    }
    return tiles;
  }

  function evaluateEnergyWaveForTarget(target, monsters = getVisibleMonsters()) {
    const playerPosition = getPosition(bot.getPlayerPosition?.());
    const targetPosition = getPosition(target);
    const direction = getDirectionToTarget(playerPosition, targetPosition);
    if (!playerPosition || !targetPosition || !direction) return { target, direction, count: 0, monsters: [], tiles: [] };

    const tileKeys = new Set(getEnergyWaveTiles(playerPosition, direction).map(positionKey));
    const hitMonsters = monsters.filter((monster) => {
      const position = getPosition(monster);
      return position && position.z === playerPosition.z && tileKeys.has(positionKey(position));
    });

    return { target, direction, count: hitMonsters.length, monsters: hitMonsters, tiles: Array.from(tileKeys) };
  }

  function getBestEnergyWaveCandidate() {
    const playerPosition = getPosition(bot.getPlayerPosition?.());
    if (!playerPosition) return null;
    const monsters = getVisibleMonsters().filter((monster) => {
      const position = getPosition(monster);
      return position && position.z === playerPosition.z && tileDistance(playerPosition, position) <= 4;
    });
    if (!monsters.length) return null;

    const currentTarget = getCurrentTarget();
    const evaluations = monsters.map((monster) => evaluateEnergyWaveForTarget(monster, monsters));
    evaluations.sort((left, right) => {
      const countDiff = right.count - left.count;
      if (countDiff) return countDiff;
      const currentBias = (isSameCreature(right.target, currentTarget) ? 1 : 0) - (isSameCreature(left.target, currentTarget) ? 1 : 0);
      if (currentBias) return currentBias;
      return tileDistance(playerPosition, getPosition(left.target)) - tileDistance(playerPosition, getPosition(right.target));
    });
    return evaluations[0] || null;
  }

  function canCastEnergyWave(now = Date.now()) {
    const slot = normalizeHotbarSlot(config.energyWaveHotbarSlot);
    if (!config.enabled || !state.running || !config.energyWaveEnabled || !slot) return false;
    if (now - state.lastEnergyWaveHotkeyAt < nonNegativeInt(config.energyWaveCooldownMs, 2000)) return false;
    const best = getBestEnergyWaveCandidate();
    return !!best && best.count >= positiveInt(config.energyWaveMinMonsters, 3);
  }

  function triggerEnergyWave(now = Date.now()) {
    if (!canCastEnergyWave(now)) return false;
    const slot = normalizeHotbarSlot(config.energyWaveHotbarSlot);
    const best = getBestEnergyWaveCandidate();
    if (!best || best.count < positiveInt(config.energyWaveMinMonsters, 3)) return false;

    if (!setCurrentTarget(best.target)) {
      bot.log("energy wave target switch failed", { target: best.target?.name || "Mob", id: best.target?.id });
      return false;
    }

    const clicked = bot.clickHotbar(slot - 1);
    if (clicked) {
      state.lastEnergyWaveHotkeyAt = now;
      state.lastEnergyWaveMonsterCount = best.count;
      state.lastEnergyWaveTargetName = best.target?.name || "Mob";
      bot.log("used energy wave hotkey", { slot, monsterCount: best.count, target: state.lastEnergyWaveTargetName, direction: best.direction, shape: "1-3-3-3" });
    }
    refreshUiValues();
    return clicked;
  }

  function getGfbTiles(centerPosition) {
    if (!centerPosition) return [];
    const rowWidths = [1, 5, 5, 7, 5, 5, 1];
    const tiles = [];
    for (let row = 0; row < rowWidths.length; row += 1) {
      const half = Math.floor(rowWidths[row] / 2);
      const yOffset = row - 3;
      for (let xOffset = -half; xOffset <= half; xOffset += 1) {
        tiles.push({ x: centerPosition.x + xOffset, y: centerPosition.y + yOffset, z: centerPosition.z });
      }
    }
    return tiles;
  }

  function evaluateGfbAtPosition(centerPosition, monsters = getVisibleMonsters()) {
    if (!centerPosition) return { position: centerPosition, count: 0, monsters: [], tiles: [] };
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
    const slot = normalizeHotbarSlot(config.gfbHotbarSlot);
    if (!slot || !best?.position) return false;
    if (!bot.clickHotbar(slot - 1)) return false;

    const tile = getTileFromPosition(best.position);
    const target = best.target || best.monsters?.[0] || tile;
    const mouse = window.gameClient?.mouse;
    const targetRef = tile ? { which: tile, index: 0xFF } : target ? { which: target, index: 0xFF } : null;

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

    bot.log("GFB crosshair target could not be clicked by known mouse handlers", { position: best.position, target: best.target?.name || "Mob" });
    return false;
  }

  function canCastGfb(now = Date.now()) {
    const slot = normalizeHotbarSlot(config.gfbHotbarSlot);
    if (!config.enabled || !state.running || !config.gfbEnabled || !slot) return false;
    if (now - state.lastGfbHotkeyAt < nonNegativeInt(config.gfbCooldownMs, 2000)) return false;
    const best = getBestGfbCandidate();
    return !!best && best.count >= positiveInt(config.gfbMinMonsters, 4);
  }

  function triggerGfb(now = Date.now()) {
    if (!canCastGfb(now)) return false;
    const best = getBestGfbCandidate();
    if (!best || best.count < positiveInt(config.gfbMinMonsters, 4)) return false;

    const clicked = clickCrosshairTarget(best);
    if (clicked) {
      state.lastGfbHotkeyAt = now;
      state.lastGfbMonsterCount = best.count;
      state.lastGfbTargetName = best.target?.name || best.monsters?.[0]?.name || "Mob";
      bot.log("used great fireball hotkey", { slot: config.gfbHotbarSlot, monsterCount: best.count, target: state.lastGfbTargetName, position: best.position, shape: "1-5-5-7-5-5-1" });
    }
    refreshUiValues();
    return clicked;
  }

  function triggerSpell(now = Date.now()) {
    return triggerEnergyWave(now) || triggerGfb(now) || triggerSquareSpell(now);
  }

  function tick() {
    if (!state.running) return;
    try { triggerSpell(); } catch (error) { bot.log("auto attack AoE tick failed", error?.message || error); }
    state.timerId = window.setTimeout(tick, positiveInt(config.tickMs, 250));
  }

  function start(overrides = {}) {
    updateConfig(Object.assign({}, overrides, { enabled: true }), { silent: true });
    if (state.running) return false;
    state.running = true;
    bot.log("auto attack AoE started", { ...config });
    tick();
    refreshUiValues();
    return true;
  }

  function stop(options = {}) {
    state.running = false;
    if (state.timerId != null) window.clearTimeout(state.timerId);
    state.timerId = null;
    if (options.persistEnabled !== false) { config.enabled = false; persistConfig(); }
    bot.log("auto attack AoE stopped");
    refreshUiValues();
    return true;
  }

  function updateConfig(nextConfig = {}, options = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "spellHotbarSlot")) nextConfig.spellHotbarSlot = normalizeHotbarSlot(nextConfig.spellHotbarSlot);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "minMonsters")) nextConfig.minMonsters = positiveInt(nextConfig.minMonsters, config.minMonsters || 3);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "squareRange")) nextConfig.squareRange = positiveInt(nextConfig.squareRange, config.squareRange || 3);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "cooldownMs")) nextConfig.cooldownMs = nonNegativeInt(nextConfig.cooldownMs, config.cooldownMs || 2000);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "tickMs")) nextConfig.tickMs = positiveInt(nextConfig.tickMs, config.tickMs || 250);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "requireAutoAttackRunning")) nextConfig.requireAutoAttackRunning = nextConfig.requireAutoAttackRunning !== false;
    if (Object.prototype.hasOwnProperty.call(nextConfig, "respectTargetFilters")) nextConfig.respectTargetFilters = nextConfig.respectTargetFilters !== false;
    if (Object.prototype.hasOwnProperty.call(nextConfig, "energyWaveEnabled")) nextConfig.energyWaveEnabled = !!nextConfig.energyWaveEnabled;
    if (Object.prototype.hasOwnProperty.call(nextConfig, "energyWaveHotbarSlot")) nextConfig.energyWaveHotbarSlot = normalizeHotbarSlot(nextConfig.energyWaveHotbarSlot);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "energyWaveMinMonsters")) nextConfig.energyWaveMinMonsters = positiveInt(nextConfig.energyWaveMinMonsters, config.energyWaveMinMonsters || 3);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "energyWaveCooldownMs")) nextConfig.energyWaveCooldownMs = nonNegativeInt(nextConfig.energyWaveCooldownMs, config.energyWaveCooldownMs || 2000);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "gfbEnabled")) nextConfig.gfbEnabled = !!nextConfig.gfbEnabled;
    if (Object.prototype.hasOwnProperty.call(nextConfig, "gfbHotbarSlot")) nextConfig.gfbHotbarSlot = normalizeHotbarSlot(nextConfig.gfbHotbarSlot);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "gfbMinMonsters")) nextConfig.gfbMinMonsters = positiveInt(nextConfig.gfbMinMonsters, config.gfbMinMonsters || 4);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "gfbCooldownMs")) nextConfig.gfbCooldownMs = nonNegativeInt(nextConfig.gfbCooldownMs, config.gfbCooldownMs || 2000);
    Object.assign(config, nextConfig);
    persistConfig();
    if (!options.silent) refreshUiValues();
    return { ...config };
  }

  function status() {
    const monsters = getCandidateMonsters();
    const bestWave = getBestEnergyWaveCandidate();
    const bestGfb = getBestGfbCandidate();
    return {
      running: state.running,
      config: { ...config },
      nearbyMonsterCount: monsters.length,
      lastCastMonsterCount: state.lastCastMonsterCount,
      lastEnergyWaveMonsterCount: state.lastEnergyWaveMonsterCount,
      lastEnergyWaveTargetName: state.lastEnergyWaveTargetName,
      bestEnergyWaveCount: bestWave?.count || 0,
      bestEnergyWaveTargetName: bestWave?.target?.name || "",
      bestEnergyWaveDirection: bestWave?.direction || "",
      lastGfbMonsterCount: state.lastGfbMonsterCount,
      lastGfbTargetName: state.lastGfbTargetName,
      bestGfbCount: bestGfb?.count || 0,
      bestGfbTargetName: bestGfb?.target?.name || "",
      ready: canCastSquare(Date.now()) || canCastEnergyWave(Date.now()) || canCastGfb(Date.now()),
    };
  }

  function findAutoAttackAnchor(panel) {
    return document.getElementById("minibia-bot-auto-attack-enabled")?.closest(".mb-section") ||
      document.getElementById("minibia-bot-auto-attack-enabled")?.parentElement ||
      panel.querySelector(".mb-main-column") ||
      panel.querySelector(".mb-body") ||
      panel;
  }

  function ensureUi() {
    const panel = document.getElementById("minibia-bot-panel") || document.getElementById("k9x-panel");
    if (!panel || document.getElementById("minibia-bot-auto-attack-aoe-section")) return;
    const section = document.createElement("div");
    section.className = "mb-section mb-column-section";
    section.id = "minibia-bot-auto-attack-aoe-section";
    section.innerHTML = `
      <div class="mb-label">AoE Spell</div>
      <div class="mb-stack">
        <label class="mb-toggle"><input type="checkbox" id="minibia-bot-auto-attack-aoe-enabled" /><span>Enable AoE Spells</span></label>
        <div class="mb-field-grid">
          <label class="mb-field"><span class="mb-field-label">Square Hotkey</span><input type="number" id="minibia-bot-auto-attack-aoe-hotkey" min="1" max="12" placeholder="5" /></label>
          <label class="mb-field"><span class="mb-field-label">Square Min Monsters</span><input type="number" id="minibia-bot-auto-attack-aoe-monsters" min="1" placeholder="3" /></label>
          <label class="mb-field"><span class="mb-field-label">Square Range</span><input type="number" id="minibia-bot-auto-attack-aoe-range" min="1" placeholder="3" /></label>
          <label class="mb-field"><span class="mb-field-label">Square Cooldown MS</span><input type="number" id="minibia-bot-auto-attack-aoe-cooldown" min="0" placeholder="2000" /></label>
        </div>
        <div class="mb-section">
          <div class="mb-label">Energy Wave 1-3-3-3</div>
          <label class="mb-toggle"><input type="checkbox" id="minibia-bot-energy-wave-enabled" /><span>Enable Energy Wave</span></label>
          <div class="mb-field-grid">
            <label class="mb-field"><span class="mb-field-label">Wave Hotkey</span><input type="number" id="minibia-bot-energy-wave-hotkey" min="1" max="12" placeholder="6" /></label>
            <label class="mb-field"><span class="mb-field-label">Wave Min Creatures</span><input type="number" id="minibia-bot-energy-wave-monsters" min="1" placeholder="3" /></label>
            <label class="mb-field"><span class="mb-field-label">Wave Cooldown MS</span><input type="number" id="minibia-bot-energy-wave-cooldown" min="0" placeholder="2000" /></label>
          </div>
          <div class="mb-small-note">Works while manually hunting. Switches target if another monster gives a better wave, then uses the hotkey. Pattern: 1 tile forward, then 3 / 3 / 3.</div>
        </div>
        <div class="mb-section">
          <div class="mb-label">Great Fireball 1-5-5-7-5-5-1</div>
          <label class="mb-toggle"><input type="checkbox" id="minibia-bot-gfb-enabled" /><span>Enable Great Fireball</span></label>
          <div class="mb-field-grid">
            <label class="mb-field"><span class="mb-field-label">GFB Hotkey</span><input type="number" id="minibia-bot-gfb-hotkey" min="1" max="12" placeholder="8" /></label>
            <label class="mb-field"><span class="mb-field-label">GFB Min Creatures</span><input type="number" id="minibia-bot-gfb-monsters" min="1" placeholder="4" /></label>
            <label class="mb-field"><span class="mb-field-label">GFB Cooldown MS</span><input type="number" id="minibia-bot-gfb-cooldown" min="0" placeholder="2000" /></label>
          </div>
          <div class="mb-small-note">Hotkey should have Great Fireball selected on crosshairs. Picks the best 1-5-5-7-5-5-1 shot.</div>
        </div>
        <label class="mb-toggle"><input type="checkbox" id="minibia-bot-auto-attack-aoe-require-attack" /><span>Only square AoE while Auto Attack runs</span></label>
        <label class="mb-toggle"><input type="checkbox" id="minibia-bot-auto-attack-aoe-respect-filters" /><span>Use target filters</span></label>
        <div class="mb-small-note" id="minibia-bot-auto-attack-aoe-status">AoE: idle</div>
      </div>`;

    const anchor = findAutoAttackAnchor(panel);
    if (anchor && anchor.parentElement) anchor.insertAdjacentElement("afterend", section);
    else (panel.querySelector(".mb-main-column") || panel.querySelector(".mb-body") || panel).appendChild(section);

    const enabled = section.querySelector("#minibia-bot-auto-attack-aoe-enabled");
    const hotkey = section.querySelector("#minibia-bot-auto-attack-aoe-hotkey");
    const monsters = section.querySelector("#minibia-bot-auto-attack-aoe-monsters");
    const range = section.querySelector("#minibia-bot-auto-attack-aoe-range");
    const cooldown = section.querySelector("#minibia-bot-auto-attack-aoe-cooldown");
    const waveEnabled = section.querySelector("#minibia-bot-energy-wave-enabled");
    const waveHotkey = section.querySelector("#minibia-bot-energy-wave-hotkey");
    const waveMonsters = section.querySelector("#minibia-bot-energy-wave-monsters");
    const waveCooldown = section.querySelector("#minibia-bot-energy-wave-cooldown");
    const gfbEnabled = section.querySelector("#minibia-bot-gfb-enabled");
    const gfbHotkey = section.querySelector("#minibia-bot-gfb-hotkey");
    const gfbMonsters = section.querySelector("#minibia-bot-gfb-monsters");
    const gfbCooldown = section.querySelector("#minibia-bot-gfb-cooldown");
    const requireAttack = section.querySelector("#minibia-bot-auto-attack-aoe-require-attack");
    const filters = section.querySelector("#minibia-bot-auto-attack-aoe-respect-filters");
    enabled?.addEventListener("change", () => enabled.checked ? start() : stop());
    hotkey?.addEventListener("change", () => updateConfig({ spellHotbarSlot: hotkey.value }));
    monsters?.addEventListener("change", () => updateConfig({ minMonsters: monsters.value }));
    range?.addEventListener("change", () => updateConfig({ squareRange: range.value }));
    cooldown?.addEventListener("change", () => updateConfig({ cooldownMs: cooldown.value }));
    waveEnabled?.addEventListener("change", () => updateConfig({ energyWaveEnabled: waveEnabled.checked }));
    waveHotkey?.addEventListener("change", () => updateConfig({ energyWaveHotbarSlot: waveHotkey.value }));
    waveMonsters?.addEventListener("change", () => updateConfig({ energyWaveMinMonsters: waveMonsters.value }));
    waveCooldown?.addEventListener("change", () => updateConfig({ energyWaveCooldownMs: waveCooldown.value }));
    gfbEnabled?.addEventListener("change", () => updateConfig({ gfbEnabled: gfbEnabled.checked }));
    gfbHotkey?.addEventListener("change", () => updateConfig({ gfbHotbarSlot: gfbHotkey.value }));
    gfbMonsters?.addEventListener("change", () => updateConfig({ gfbMinMonsters: gfbMonsters.value }));
    gfbCooldown?.addEventListener("change", () => updateConfig({ gfbCooldownMs: gfbCooldown.value }));
    requireAttack?.addEventListener("change", () => updateConfig({ requireAutoAttackRunning: requireAttack.checked }));
    filters?.addEventListener("change", () => updateConfig({ respectTargetFilters: filters.checked }));
    refreshUiValues();
  }

  function refreshUiValues() {
    const enabled = document.getElementById("minibia-bot-auto-attack-aoe-enabled");
    const hotkey = document.getElementById("minibia-bot-auto-attack-aoe-hotkey");
    const monsters = document.getElementById("minibia-bot-auto-attack-aoe-monsters");
    const range = document.getElementById("minibia-bot-auto-attack-aoe-range");
    const cooldown = document.getElementById("minibia-bot-auto-attack-aoe-cooldown");
    const waveEnabled = document.getElementById("minibia-bot-energy-wave-enabled");
    const waveHotkey = document.getElementById("minibia-bot-energy-wave-hotkey");
    const waveMonsters = document.getElementById("minibia-bot-energy-wave-monsters");
    const waveCooldown = document.getElementById("minibia-bot-energy-wave-cooldown");
    const gfbEnabled = document.getElementById("minibia-bot-gfb-enabled");
    const gfbHotkey = document.getElementById("minibia-bot-gfb-hotkey");
    const gfbMonsters = document.getElementById("minibia-bot-gfb-monsters");
    const gfbCooldown = document.getElementById("minibia-bot-gfb-cooldown");
    const requireAttack = document.getElementById("minibia-bot-auto-attack-aoe-require-attack");
    const filters = document.getElementById("minibia-bot-auto-attack-aoe-respect-filters");
    const statusLabel = document.getElementById("minibia-bot-auto-attack-aoe-status");
    const bestWave = getBestEnergyWaveCandidate();
    const bestGfb = getBestGfbCandidate();
    if (enabled) enabled.checked = !!state.running;
    if (hotkey) hotkey.value = config.spellHotbarSlot || "";
    if (monsters) monsters.value = config.minMonsters;
    if (range) range.value = config.squareRange;
    if (cooldown) cooldown.value = config.cooldownMs;
    if (waveEnabled) waveEnabled.checked = !!config.energyWaveEnabled;
    if (waveHotkey) waveHotkey.value = config.energyWaveHotbarSlot || "";
    if (waveMonsters) waveMonsters.value = config.energyWaveMinMonsters;
    if (waveCooldown) waveCooldown.value = config.energyWaveCooldownMs;
    if (gfbEnabled) gfbEnabled.checked = !!config.gfbEnabled;
    if (gfbHotkey) gfbHotkey.value = config.gfbHotbarSlot || "";
    if (gfbMonsters) gfbMonsters.value = config.gfbMinMonsters;
    if (gfbCooldown) gfbCooldown.value = config.gfbCooldownMs;
    if (requireAttack) requireAttack.checked = !!config.requireAutoAttackRunning;
    if (filters) filters.checked = !!config.respectTargetFilters;
    if (statusLabel) {
      statusLabel.textContent = state.running
        ? `AoE: square ${getCandidateMonsters().length}/${config.minMonsters}; wave ${bestWave?.count || 0}/${config.energyWaveMinMonsters}; gfb ${bestGfb?.count || 0}/${config.gfbMinMonsters}`
        : "AoE: off";
    }
  }

  function destroy() {
    stop({ persistEnabled: false });
    if (state.uiTimerId != null) window.clearInterval(state.uiTimerId);
    document.getElementById("minibia-bot-auto-attack-aoe-section")?.remove();
  }

  bot.attackAoe = {
    start,
    stop,
    status,
    updateConfig,
    triggerSpell,
    triggerSquareSpell,
    triggerEnergyWave,
    triggerGfb,
    getBestEnergyWaveCandidate,
    evaluateEnergyWaveForTarget,
    getEnergyWaveTiles,
    getBestGfbCandidate,
    evaluateGfbAtPosition,
    getGfbTiles,
    destroy,
    config,
  };
  state.uiTimerId = window.setInterval(() => { ensureUi(); refreshUiValues(); }, 1000);
  bot.addCleanup(destroy);
  if (config.enabled) start(); else ensureUi();
  return bot.attackAoe;
};
