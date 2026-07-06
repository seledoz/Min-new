window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installAutoAttackAoeModule = function installAutoAttackAoeModule(bot) {
  if (!bot || bot.attackAoe?.destroy) return bot?.attackAoe;

  const configStorageKey = "minibiaBot.attackAoe.config";
  const state = { running: false, timerId: null, uiTimerId: null, lastSpellHotkeyAt: 0, lastCastMonsterCount: 0 };
  const config = Object.assign({
    enabled: false,
    spellHotbarSlot: null,
    minMonsters: 3,
    squareRange: 3,
    cooldownMs: 2000,
    tickMs: 250,
    requireAutoAttackRunning: true,
    respectTargetFilters: true,
  }, bot.storage.get(configStorageKey, {}) || {});

  config.spellHotbarSlot = normalizeHotbarSlot(config.spellHotbarSlot);
  config.minMonsters = positiveInt(config.minMonsters, 3);
  config.squareRange = positiveInt(config.squareRange, 3);
  config.cooldownMs = nonNegativeInt(config.cooldownMs, 2000);
  config.tickMs = positiveInt(config.tickMs, 250);
  config.requireAutoAttackRunning = config.requireAutoAttackRunning !== false;
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

  function getCandidateMonsters() {
    const playerPosition = getPosition(bot.getPlayerPosition?.());
    if (!playerPosition) return [];
    const range = positiveInt(config.squareRange, 3);
    return (bot.xray?.getVisibleMonsters?.({ sameFloorOnly: true }) || [])
      .filter(passesTargetFilters)
      .filter((monster) => tileDistance(playerPosition, getPosition(monster)) <= range);
  }

  function isAutoAttackRunning() {
    if (!config.requireAutoAttackRunning) return true;
    return !!bot.attack?.status?.().running;
  }

  function canCast(now = Date.now()) {
    const slot = normalizeHotbarSlot(config.spellHotbarSlot);
    if (!config.enabled || !state.running || !slot || !isAutoAttackRunning()) return false;
    if (now - state.lastSpellHotkeyAt < nonNegativeInt(config.cooldownMs, 2000)) return false;
    return getCandidateMonsters().length >= positiveInt(config.minMonsters, 3);
  }

  function triggerSpell(now = Date.now()) {
    if (!canCast(now)) return false;
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
    Object.assign(config, nextConfig);
    persistConfig();
    if (!options.silent) refreshUiValues();
    return { ...config };
  }

  function status() {
    const monsters = getCandidateMonsters();
    return { running: state.running, config: { ...config }, nearbyMonsterCount: monsters.length, lastCastMonsterCount: state.lastCastMonsterCount, ready: canCast(Date.now()) };
  }

  function ensureUi() {
    const panel = document.getElementById("k9x-panel");
    if (!panel || document.getElementById("k9x-auto-attack-aoe-section")) return;
    const parent = panel.querySelector(".mb-talk-column") || panel.querySelector(".mb-main-column") || panel.querySelector(".mb-body") || panel;
    const section = document.createElement("div");
    section.className = "mb-section mb-column-section";
    section.id = "k9x-auto-attack-aoe-section";
    section.innerHTML = `
      <div class="mb-label">AoE Spell</div>
      <div class="mb-stack">
        <label class="mb-toggle"><input type="checkbox" id="k9x-auto-attack-aoe-enabled" /><span>Enable AoE Spell</span></label>
        <div class="mb-field-grid">
          <label class="mb-field"><span class="mb-field-label">Spell Hotkey (1-12)</span><input type="number" id="k9x-auto-attack-aoe-hotkey" min="1" max="12" placeholder="5" /></label>
          <label class="mb-field"><span class="mb-field-label">Min Monsters</span><input type="number" id="k9x-auto-attack-aoe-monsters" min="1" placeholder="3" /></label>
          <label class="mb-field"><span class="mb-field-label">Square Range</span><input type="number" id="k9x-auto-attack-aoe-range" min="1" placeholder="3" /></label>
          <label class="mb-field"><span class="mb-field-label">Cooldown MS</span><input type="number" id="k9x-auto-attack-aoe-cooldown" min="0" placeholder="2000" /></label>
        </div>
        <label class="mb-toggle"><input type="checkbox" id="k9x-auto-attack-aoe-require-attack" /><span>Only while Auto Attack runs</span></label>
        <label class="mb-toggle"><input type="checkbox" id="k9x-auto-attack-aoe-respect-filters" /><span>Use target filters</span></label>
        <div class="mb-small-note" id="k9x-auto-attack-aoe-status">AoE: idle</div>
      </div>`;
    parent.appendChild(section);
    const enabled = section.querySelector("#k9x-auto-attack-aoe-enabled");
    const hotkey = section.querySelector("#k9x-auto-attack-aoe-hotkey");
    const monsters = section.querySelector("#k9x-auto-attack-aoe-monsters");
    const range = section.querySelector("#k9x-auto-attack-aoe-range");
    const cooldown = section.querySelector("#k9x-auto-attack-aoe-cooldown");
    const requireAttack = section.querySelector("#k9x-auto-attack-aoe-require-attack");
    const filters = section.querySelector("#k9x-auto-attack-aoe-respect-filters");
    enabled?.addEventListener("change", () => enabled.checked ? start() : stop());
    hotkey?.addEventListener("change", () => updateConfig({ spellHotbarSlot: hotkey.value }));
    monsters?.addEventListener("change", () => updateConfig({ minMonsters: monsters.value }));
    range?.addEventListener("change", () => updateConfig({ squareRange: range.value }));
    cooldown?.addEventListener("change", () => updateConfig({ cooldownMs: cooldown.value }));
    requireAttack?.addEventListener("change", () => updateConfig({ requireAutoAttackRunning: requireAttack.checked }));
    filters?.addEventListener("change", () => updateConfig({ respectTargetFilters: filters.checked }));
    refreshUiValues();
  }

  function refreshUiValues() {
    const enabled = document.getElementById("k9x-auto-attack-aoe-enabled");
    const hotkey = document.getElementById("k9x-auto-attack-aoe-hotkey");
    const monsters = document.getElementById("k9x-auto-attack-aoe-monsters");
    const range = document.getElementById("k9x-auto-attack-aoe-range");
    const cooldown = document.getElementById("k9x-auto-attack-aoe-cooldown");
    const requireAttack = document.getElementById("k9x-auto-attack-aoe-require-attack");
    const filters = document.getElementById("k9x-auto-attack-aoe-respect-filters");
    const statusLabel = document.getElementById("k9x-auto-attack-aoe-status");
    if (enabled) enabled.checked = !!state.running;
    if (hotkey) hotkey.value = config.spellHotbarSlot || "";
    if (monsters) monsters.value = config.minMonsters;
    if (range) range.value = config.squareRange;
    if (cooldown) cooldown.value = config.cooldownMs;
    if (requireAttack) requireAttack.checked = !!config.requireAutoAttackRunning;
    if (filters) filters.checked = !!config.respectTargetFilters;
    if (statusLabel) statusLabel.textContent = state.running ? `AoE: watching (${getCandidateMonsters().length}/${config.minMonsters})` : "AoE: off";
  }

  function destroy() {
    stop({ persistEnabled: false });
    if (state.uiTimerId != null) window.clearInterval(state.uiTimerId);
    document.getElementById("k9x-auto-attack-aoe-section")?.remove();
  }

  bot.attackAoe = { start, stop, status, updateConfig, triggerSpell, destroy, config };
  state.uiTimerId = window.setInterval(() => { ensureUi(); refreshUiValues(); }, 1000);
  bot.addCleanup(destroy);
  if (config.enabled) start(); else ensureUi();
  return bot.attackAoe;
};
