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

    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? "east" : "west";
    }
    return dy > 0 ? "south" : "north";
  }

  function getEnergyWaveTiles(playerPosition, direction) {
    if (!playerPosition || !direction) return [];
    const forward = {
      north: { x: 0, y: -1 },
      south: { x: 0, y: 1 },
      east: { x: 1, y: 0 },
      west: { x: -1, y: 0 },
    }[direction];
    const side = {
      north: { x: 1, y: 0 },
      south: { x: 1, y: 0 },
      east: { x: 0, y: 1 },
      west: { x: 0, y: 1 },
    }[direction];
    if (!forward || !side) return [];

    const tiles = [];
    // Server-specific Energy Wave shape: 1 tile forward, then 3 / 3 / 3.
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

  function positionKey(position) {
    return position ? `${position.x},${position.y},${position.z}` : "";
  }

  function evaluateEnergyWaveForTarget(target, monsters = getVisibleMonsters()) {
    const playerPosition = getPosition(bot.getPlayerPosition?.());
    const targetPosition = getPosition(target);
    const direction = getDirectionToTarget(playerPosition, targetPosition);
    if (!playerPosition || !targetPosition || !direction) {
      return { target, direction, count: 0, monsters: [], tiles: [] };
    }

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
    if (!config.enabled || !state.running || !config.energyWaveEnabled || !slot || !isAutoAttackRunning()) return false;
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
      bot.log("used energy wave hotkey", {
        slot,
        monsterCount: best.count,
        target: state.lastEnergyWaveTargetName,
        direction: best.direction,
        shape: "1-3-3-3",
      });
    }
    refreshUiValues();
    return clicked;
  }

  function triggerSpell(now = Date.now()) {
    return triggerEnergyWave(now) || triggerSquareSpell(now);
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
    Object.assign(config, nextConfig);
    persistConfig();
    if (!options.silent) refreshUiValues();
    return { ...config };
  }

  function status() {
    const monsters = getCandidateMonsters();
    const bestWave = getBestEnergyWaveCandidate();
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
      ready: canCastSquare(Date.now()) || canCastEnergyWave(Date.now()),
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
          <div class="mb-small-note">Switches target if another monster gives a better wave. Uses the server pattern: 1 tile forward, then 3 / 3 / 3.</div>
        </div>
        <label class="mb-toggle"><input type="checkbox" id="minibia-bot-auto-attack-aoe-require-attack" /><span>Only while Auto Attack runs</span></label>
        <label class="mb-toggle"><input type="checkbox" id="minibia-bot-auto-attack-aoe-respect-filters" /><span>Use target filters</span></label>
        <div class="mb-small-note" id="minibia-bot-auto-attack-aoe-status">AoE: idle</div>
      </div>`;

    const anchor = findAutoAttackAnchor(panel);
    if (anchor && anchor.parentElement) {
      anchor.insertAdjacentElement("afterend", section);
    } else {
      (panel.querySelector(".mb-main-column") || panel.querySelector(".mb-body") || panel).appendChild(section);
    }

    const enabled = section.querySelector("#minibia-bot-auto-attack-aoe-enabled");
    const hotkey = section.querySelector("#minibia-bot-auto-attack-aoe-hotkey");
    const monsters = section.querySelector("#minibia-bot-auto-attack-aoe-monsters");
    const range = section.querySelector("#minibia-bot-auto-attack-aoe-range");
    const cooldown = section.querySelector("#minibia-bot-auto-attack-aoe-cooldown");
    const waveEnabled = section.querySelector("#minibia-bot-energy-wave-enabled");
    const waveHotkey = section.querySelector("#minibia-bot-energy-wave-hotkey");
    const waveMonsters = section.querySelector("#minibia-bot-energy-wave-monsters");
    const waveCooldown = section.querySelector("#minibia-bot-energy-wave-cooldown");
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
    const requireAttack = document.getElementById("minibia-bot-auto-attack-aoe-require-attack");
    const filters = document.getElementById("minibia-bot-auto-attack-aoe-respect-filters");
    const statusLabel = document.getElementById("minibia-bot-auto-attack-aoe-status");
    const bestWave = getBestEnergyWaveCandidate();
    if (enabled) enabled.checked = !!state.running;
    if (hotkey) hotkey.value = config.spellHotbarSlot || "";
    if (monsters) monsters.value = config.minMonsters;
    if (range) range.value = config.squareRange;
    if (cooldown) cooldown.value = config.cooldownMs;
    if (waveEnabled) waveEnabled.checked = !!config.energyWaveEnabled;
    if (waveHotkey) waveHotkey.value = config.energyWaveHotbarSlot || "";
    if (waveMonsters) waveMonsters.value = config.energyWaveMinMonsters;
    if (waveCooldown) waveCooldown.value = config.energyWaveCooldownMs;
    if (requireAttack) requireAttack.checked = !!config.requireAutoAttackRunning;
    if (filters) filters.checked = !!config.respectTargetFilters;
    if (statusLabel) {
      statusLabel.textContent = state.running
        ? `AoE: square ${getCandidateMonsters().length}/${config.minMonsters}; wave ${bestWave?.count || 0}/${config.energyWaveMinMonsters}${bestWave?.target ? ` via ${bestWave.target.name || "Mob"}` : ""}`
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
    getBestEnergyWaveCandidate,
    evaluateEnergyWaveForTarget,
    getEnergyWaveTiles,
    destroy,
    config,
  };
  state.uiTimerId = window.setInterval(() => { ensureUi(); refreshUiValues(); }, 1000);
  bot.addCleanup(destroy);
  if (config.enabled) start(); else ensureUi();
  return bot.attackAoe;
};
