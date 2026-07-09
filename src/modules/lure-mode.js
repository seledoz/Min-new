window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installLureModeModule = function installLureModeModule(bot) {
  const configStorageKey = "minibiaBot.lure.config";
  const COUNT_RANGE = 7;
  const TICK_MS = 150;

  const config = Object.assign({ enabled: false, minMonsters: 3, maxDistance: 4 }, bot.storage.get(configStorageKey, {}) || {});
  const state = {
    timerId: null,
    uiTimerId: null,
    pathfinder: null,
    originalFindPath: null,
    suppressingAttack: false,
    restoreAttackEnabled: false,
    lastHoldLogAt: 0,
    lastStatus: null,
  };

  function persistConfig() { bot.storage.set(configStorageKey, { ...config }); }
  function intValue(value, fallback, min = 1, max = 99) {
    const n = Math.trunc(Number(value));
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  }
  function pos(value) {
    if (!value) return null;
    const x = Number(value.x), y = Number(value.y), z = Number(value.z);
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
      ? { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) }
      : null;
  }
  function dist(a, b) {
    if (!a || !b || Number(a.z) !== Number(b.z)) return Infinity;
    return Math.max(Math.abs(Number(a.x) - Number(b.x)), Math.abs(Number(a.y) - Number(b.y)));
  }
  function playerPos() { return pos(bot.getPlayerPosition?.() || window.gameClient?.player?.__position); }
  function monsterPos(monster) { return pos(monster?.getPosition?.() || monster?.__position); }
  function currentTarget() { return bot.attack?.getCurrentTarget?.() || window.gameClient?.player?.__target || null; }
  function visibleMonsters() { return bot.attack?.getNearbyMonsters?.() || bot.xray?.getVisibleMonsters?.({ sameFloorOnly: true }) || []; }

  function getLureMonsters() {
    const me = playerPos();
    if (!me) return [];
    return visibleMonsters()
      .map((monster) => ({ monster, position: monsterPos(monster) }))
      .map((entry) => ({ ...entry, distance: dist(me, entry.position) }))
      .filter((entry) => entry.position && entry.distance <= COUNT_RANGE)
      .sort((a, b) => a.distance - b.distance || Number(a.monster?.id || 0) - Number(b.monster?.id || 0));
  }

  function getLureStatus() {
    const monsters = getLureMonsters();
    const minMonsters = intValue(config.minMonsters, 3, 1, 20);
    const maxDistance = intValue(config.maxDistance, 4, 1, COUNT_RANGE);
    const hasTarget = !!currentTarget();
    const combatActive = !!bot.attack?.status?.()?.combatActive;
    const closestDistance = monsters.length ? monsters[0].distance : Infinity;
    const readyToEngage = !!config.enabled && monsters.length >= minMonsters;
    const luring = !!config.enabled && monsters.length > 0 && !readyToEngage && !hasTarget && !combatActive;

    return {
      enabled: !!config.enabled,
      countRange: COUNT_RANGE,
      minMonsters,
      maxDistance,
      monsterCount: monsters.length,
      closestDistance: Number.isFinite(closestDistance) ? closestDistance : null,
      readyToEngage,
      luring,
      shouldHoldWalking: luring && closestDistance > maxDistance,
      hasTarget,
      combatActive,
    };
  }

  function setAttackSuppressed(shouldSuppress) {
    const attackConfig = bot.attack?.config;
    if (!attackConfig) return false;
    if (shouldSuppress) {
      if (!state.suppressingAttack) {
        state.restoreAttackEnabled = !!attackConfig.enabled;
        state.suppressingAttack = true;
      }
      attackConfig.enabled = false;
      return true;
    }
    if (state.suppressingAttack) {
      if (state.restoreAttackEnabled) attackConfig.enabled = true;
      state.suppressingAttack = false;
      state.restoreAttackEnabled = false;
      return true;
    }
    return false;
  }

  function stopCurrentPath() {
    const pf = window.gameClient?.world?.pathfinder;
    if (!pf) return false;
    let stopped = false;
    ["stop", "cancel", "clear", "clearPath", "stopWalking", "reset"].forEach((name) => {
      if (typeof pf[name] !== "function") return;
      try { pf[name](); stopped = true; } catch (error) {}
    });
    return stopped;
  }

  function patchPathfinder() {
    const pf = window.gameClient?.world?.pathfinder;
    if (!pf || typeof pf.findPath !== "function") return false;
    if (state.pathfinder === pf && state.originalFindPath) return true;
    if (state.pathfinder && state.originalFindPath) {
      try { state.pathfinder.findPath = state.originalFindPath; } catch (error) {}
    }
    state.pathfinder = pf;
    state.originalFindPath = pf.findPath.bind(pf);
    pf.findPath = function lureModeFindPathGuard(...args) {
      const status = getLureStatus();
      state.lastStatus = status;
      if (status.shouldHoldWalking) {
        const now = Date.now();
        stopCurrentPath();
        if (now - state.lastHoldLogAt > 1500) {
          state.lastHoldLogAt = now;
          bot.log?.("lure mode holding path until monster catches up", {
            monsterCount: status.monsterCount,
            closestDistance: status.closestDistance,
            maxDistance: status.maxDistance,
            countRange: COUNT_RANGE,
          });
        }
        return null;
      }
      return state.originalFindPath(...args);
    };
    return true;
  }

  function restorePathfinder() {
    if (state.pathfinder && state.originalFindPath) {
      try { state.pathfinder.findPath = state.originalFindPath; } catch (error) {}
    }
    state.pathfinder = null;
    state.originalFindPath = null;
  }

  function tick() {
    patchPathfinder();
    const status = getLureStatus();
    state.lastStatus = status;

    if (!status.enabled || status.hasTarget || status.combatActive) {
      setAttackSuppressed(false);
      updateStatusUi(status);
      return status;
    }

    if (status.readyToEngage) {
      setAttackSuppressed(false);
      bot.attack?.triggerAttack?.();
      bot.log?.("lure mode engaging monsters", { monsterCount: status.monsterCount, minMonsters: status.minMonsters, countRange: COUNT_RANGE });
      updateStatusUi(status);
      return status;
    }

    setAttackSuppressed(true);
    if (status.shouldHoldWalking) stopCurrentPath();
    updateStatusUi(status);
    return status;
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "enabled")) config.enabled = !!nextConfig.enabled;
    if (Object.prototype.hasOwnProperty.call(nextConfig, "minMonsters")) config.minMonsters = intValue(nextConfig.minMonsters, config.minMonsters || 3, 1, 20);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "maxDistance")) config.maxDistance = intValue(nextConfig.maxDistance, config.maxDistance || 4, 1, COUNT_RANGE);
    persistConfig();
    if (!config.enabled) setAttackSuppressed(false);
    bot.log?.("lure mode config updated", { ...config, countRange: COUNT_RANGE });
    updateUiValues();
    updateStatusUi();
    return { ...config };
  }

  function updateStatusUi(status = state.lastStatus || getLureStatus()) {
    const label = document.getElementById("minibia-bot-lure-status");
    if (!label) return;
    if (!status.enabled) label.textContent = "Lure: off";
    else if (status.readyToEngage) label.textContent = `Lure: engaging ${status.monsterCount}/${status.minMonsters}`;
    else if (status.shouldHoldWalking) label.textContent = `Lure: waiting, closest ${status.closestDistance}/${status.maxDistance}`;
    else if (status.monsterCount > 0) label.textContent = `Lure: walking ${status.monsterCount}/${status.minMonsters}`;
    else label.textContent = `Lure: looking 0/${status.minMonsters}`;
  }

  function updateUiValues() {
    const enabled = document.getElementById("minibia-bot-lure-enabled");
    const min = document.getElementById("minibia-bot-lure-min-monsters");
    const max = document.getElementById("minibia-bot-lure-max-distance");
    if (enabled) enabled.checked = !!config.enabled;
    if (min && document.activeElement !== min) min.value = String(intValue(config.minMonsters, 3, 1, 20));
    if (max && document.activeElement !== max) max.value = String(intValue(config.maxDistance, 4, 1, COUNT_RANGE));
  }

  function installLureStyle() {
    if (document.getElementById("minibia-bot-lure-style")) return;
    const style = document.createElement("style");
    style.id = "minibia-bot-lure-style";
    style.textContent = `
      #minibia-bot-lure-section { order: 1; }
      #minibia-bot-lure-section .mb-field-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      #minibia-bot-lure-standalone {
        position: fixed;
        top: 84px;
        left: 16px;
        z-index: 999999;
        width: 280px;
        padding: 12px;
        border: 1px solid rgba(224, 200, 148, 0.45);
        border-radius: 10px;
        background: linear-gradient(180deg, rgba(30, 23, 15, 0.95), rgba(15, 11, 8, 0.97));
        color: #f1e2b8;
        font: 12px/1.35 Verdana, sans-serif;
      }
      #minibia-bot-lure-standalone input { box-sizing: border-box; width: 100%; padding: 6px 8px; border-radius: 8px; background: rgba(16, 12, 8, 0.88); color: #f7eccf; border: 1px solid rgba(224, 200, 148, 0.35); }
      #minibia-bot-lure-standalone .mb-stack { display: grid; gap: 8px; }
      #minibia-bot-lure-standalone .mb-toggle { display: flex; align-items: center; gap: 8px; color: #d3c49d; }
      #minibia-bot-lure-standalone .mb-toggle input { width: auto; }
      #minibia-bot-lure-standalone .mb-field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      #minibia-bot-lure-standalone .mb-label { margin: 0 0 8px; color: #d3c49d; }
      #minibia-bot-lure-standalone .mb-field-label, #minibia-bot-lure-standalone .mb-small-note { color: #b7a67d; font-size: 11px; }
    `;
    document.head.appendChild(style);
  }

  function makeSection() {
    const section = document.createElement("div");
    section.className = "mb-section mb-column-section";
    section.id = "minibia-bot-lure-section";
    section.innerHTML = `
      <div class="mb-label">Lure Mode</div>
      <div class="mb-stack">
        <label class="mb-toggle"><input type="checkbox" id="minibia-bot-lure-enabled" /><span>Enable Lure Mode</span></label>
        <div class="mb-field-grid">
          <label class="mb-field" for="minibia-bot-lure-min-monsters"><span class="mb-field-label">Min Monsters</span><input type="number" id="minibia-bot-lure-min-monsters" min="1" max="20" step="1" /></label>
          <label class="mb-field" for="minibia-bot-lure-max-distance"><span class="mb-field-label">Max Distance</span><input type="number" id="minibia-bot-lure-max-distance" min="1" max="7" step="1" /></label>
        </div>
        <div class="mb-small-note">Counts monsters within 7 sqm. Holds walking until closest lured monster is within Max Distance.</div>
        <div class="mb-small-note" id="minibia-bot-lure-status">Lure: off</div>
      </div>
    `;
    section.querySelector("#minibia-bot-lure-enabled")?.addEventListener("change", (event) => updateConfig({ enabled: event.target.checked }));
    section.querySelector("#minibia-bot-lure-min-monsters")?.addEventListener("input", (event) => updateConfig({ minMonsters: event.target.value }));
    section.querySelector("#minibia-bot-lure-max-distance")?.addEventListener("input", (event) => updateConfig({ maxDistance: event.target.value }));
    return section;
  }

  function injectUi() {
    if (document.getElementById("minibia-bot-lure-section")) {
      updateUiValues();
      updateStatusUi();
      return true;
    }

    installLureStyle();
    const panel = document.getElementById("minibia-bot-panel") || document.getElementById("k9x-panel");
    const mainColumn = panel?.querySelector?.(".mb-main-column");
    const caveColumn = panel?.querySelector?.(".mb-cave-column");
    const body = panel?.querySelector?.(".mb-body");
    const section = makeSection();

    const reloadBlock = document.getElementById("minibia-bot-reload")?.closest?.(".mb-actions");
    if (mainColumn && reloadBlock?.parentElement === mainColumn) {
      mainColumn.insertBefore(section, reloadBlock.nextSibling);
    } else if (mainColumn) {
      mainColumn.prepend(section);
    } else if (caveColumn) {
      caveColumn.prepend(section);
    } else if (body) {
      body.prepend(section);
    } else {
      section.id = "minibia-bot-lure-standalone";
      document.body.appendChild(section);
    }

    updateUiValues();
    updateStatusUi();
    return true;
  }

  function startUiInjector() {
    let attempts = 0;
    state.uiTimerId = window.setInterval(() => {
      attempts += 1;
      const injected = injectUi();
      if (injected || attempts >= 80) {
        window.clearInterval(state.uiTimerId);
        state.uiTimerId = null;
      }
    }, 250);
    injectUi();
  }

  function start() {
    if (state.timerId != null) return false;
    patchPathfinder();
    state.timerId = window.setInterval(() => { try { tick(); } catch (error) { bot.log?.("lure mode tick failed", error?.message || error); } }, TICK_MS);
    return true;
  }

  function stop() {
    if (state.timerId != null) window.clearInterval(state.timerId);
    if (state.uiTimerId != null) window.clearInterval(state.uiTimerId);
    state.timerId = null;
    state.uiTimerId = null;
    setAttackSuppressed(false);
    restorePathfinder();
    return true;
  }

  function status() {
    return { running: state.timerId != null, config: { ...config, countRange: COUNT_RANGE }, lure: getLureStatus(), suppressingAttack: state.suppressingAttack };
  }

  bot.lureMode = { start, stop, status, updateConfig, getLureStatus, config };
  start();
  startUiInjector();
  bot.addCleanup?.(stop);
};
