window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installLureModeModule = function installLureModeModule(bot) {
  const configStorageKey = "minibiaBot.lure.config";
  const COUNT_RANGE = 7;
  const TICK_MS = 150;

  const config = Object.assign(
    {
      enabled: false,
      minMonsters: 3,
      maxDistance: 4,
    },
    bot.storage.get(configStorageKey, {}) || {}
  );

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

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function normalizePositiveInt(value, fallback, min = 1, max = 99) {
    const number = Math.trunc(Number(value));
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  function normalizePosition(value) {
    if (!value) return null;
    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) };
  }

  function getDistance(from, to) {
    if (!from || !to || Number(from.z) !== Number(to.z)) return Number.POSITIVE_INFINITY;
    return Math.max(Math.abs(Number(from.x) - Number(to.x)), Math.abs(Number(from.y) - Number(to.y)));
  }

  function getPlayerPosition() {
    return normalizePosition(bot.getPlayerPosition?.() || window.gameClient?.player?.__position);
  }

  function getMonsterPosition(monster) {
    return normalizePosition(monster?.getPosition?.() || monster?.__position);
  }

  function getCurrentTarget() {
    return bot.attack?.getCurrentTarget?.() || window.gameClient?.player?.__target || null;
  }

  function getVisibleMonsters() {
    return bot.attack?.getNearbyMonsters?.() || bot.xray?.getVisibleMonsters?.({ sameFloorOnly: true }) || [];
  }

  function getLureMonsters() {
    const playerPosition = getPlayerPosition();
    if (!playerPosition) return [];

    return getVisibleMonsters()
      .map((monster) => {
        const position = getMonsterPosition(monster);
        const distance = getDistance(playerPosition, position);
        return { monster, position, distance };
      })
      .filter((entry) => entry.position && entry.distance <= COUNT_RANGE)
      .sort((left, right) => left.distance - right.distance || Number(left.monster?.id || 0) - Number(right.monster?.id || 0));
  }

  function getLureStatus() {
    const monsters = getLureMonsters();
    const minMonsters = normalizePositiveInt(config.minMonsters, 3, 1, 20);
    const maxDistance = normalizePositiveInt(config.maxDistance, 4, 1, COUNT_RANGE);
    const hasTarget = !!getCurrentTarget();
    const combatActive = !!bot.attack?.status?.()?.combatActive;
    const closestDistance = monsters.length ? monsters[0].distance : Number.POSITIVE_INFINITY;
    const readyToEngage = !!config.enabled && monsters.length >= minMonsters;
    const luring = !!config.enabled && monsters.length > 0 && !readyToEngage && !hasTarget && !combatActive;
    const shouldHoldWalking = luring && closestDistance > maxDistance;

    return {
      enabled: !!config.enabled,
      countRange: COUNT_RANGE,
      minMonsters,
      maxDistance,
      monsterCount: monsters.length,
      closestDistance: Number.isFinite(closestDistance) ? closestDistance : null,
      readyToEngage,
      luring,
      shouldHoldWalking,
      hasTarget,
      combatActive,
      monsters: monsters.map((entry) => ({
        id: entry.monster?.id,
        name: entry.monster?.name || "Mob",
        distance: entry.distance,
        position: entry.position,
      })),
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
      if (state.restoreAttackEnabled) {
        attackConfig.enabled = true;
      }
      state.suppressingAttack = false;
      state.restoreAttackEnabled = false;
      return true;
    }

    return false;
  }

  function stopCurrentPath() {
    const pathfinder = window.gameClient?.world?.pathfinder;
    if (!pathfinder) return false;

    let stopped = false;
    ["stop", "cancel", "clear", "clearPath", "stopWalking", "reset"].forEach((methodName) => {
      if (typeof pathfinder[methodName] !== "function") return;
      try {
        pathfinder[methodName]();
        stopped = true;
      } catch (error) {}
    });

    return stopped;
  }

  function shouldBlockPathing() {
    const status = getLureStatus();
    state.lastStatus = status;
    return status.shouldHoldWalking;
  }

  function patchPathfinder() {
    const pathfinder = window.gameClient?.world?.pathfinder;
    if (!pathfinder || typeof pathfinder.findPath !== "function") return false;
    if (state.pathfinder === pathfinder && state.originalFindPath) return true;

    if (state.pathfinder && state.originalFindPath && state.pathfinder.findPath !== state.originalFindPath) {
      state.pathfinder.findPath = state.originalFindPath;
    }

    state.pathfinder = pathfinder;
    state.originalFindPath = pathfinder.findPath.bind(pathfinder);

    pathfinder.findPath = function lureModeFindPathGuard(...args) {
      if (shouldBlockPathing()) {
        const now = Date.now();
        stopCurrentPath();
        if (now - state.lastHoldLogAt > 1500) {
          state.lastHoldLogAt = now;
          bot.log?.("lure mode holding path until monster catches up", {
            monsterCount: state.lastStatus?.monsterCount || 0,
            closestDistance: state.lastStatus?.closestDistance,
            maxDistance: state.lastStatus?.maxDistance,
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
      try {
        state.pathfinder.findPath = state.originalFindPath;
      } catch (error) {}
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
      bot.log?.("lure mode engaging monsters", {
        monsterCount: status.monsterCount,
        minMonsters: status.minMonsters,
        countRange: COUNT_RANGE,
      });
      updateStatusUi(status);
      return status;
    }

    if (status.monsterCount > 0) {
      setAttackSuppressed(true);
      if (status.shouldHoldWalking) stopCurrentPath();
    } else {
      setAttackSuppressed(true);
    }

    updateStatusUi(status);
    return status;
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "enabled")) {
      config.enabled = !!nextConfig.enabled;
    }
    if (Object.prototype.hasOwnProperty.call(nextConfig, "minMonsters")) {
      config.minMonsters = normalizePositiveInt(nextConfig.minMonsters, config.minMonsters || 3, 1, 20);
    }
    if (Object.prototype.hasOwnProperty.call(nextConfig, "maxDistance")) {
      config.maxDistance = normalizePositiveInt(nextConfig.maxDistance, config.maxDistance || 4, 1, COUNT_RANGE);
    }

    persistConfig();
    if (!config.enabled) setAttackSuppressed(false);
    bot.log?.("lure mode config updated", { ...config, countRange: COUNT_RANGE });
    updateUiValues();
    return { ...config };
  }

  function start() {
    if (state.timerId != null) return false;
    patchPathfinder();
    state.timerId = window.setInterval(() => {
      try {
        tick();
      } catch (error) {
        bot.log?.("lure mode tick failed", error?.message || error);
      }
    }, TICK_MS);
    return true;
  }

  function stop() {
    if (state.timerId != null) {
      window.clearInterval(state.timerId);
      state.timerId = null;
    }
    if (state.uiTimerId != null) {
      window.clearInterval(state.uiTimerId);
      state.uiTimerId = null;
    }
    setAttackSuppressed(false);
    restorePathfinder();
    return true;
  }

  function status() {
    return {
      running: state.timerId != null,
      config: { ...config, countRange: COUNT_RANGE },
      lure: getLureStatus(),
      suppressingAttack: state.suppressingAttack,
    };
  }

  function updateStatusUi(lureStatus = state.lastStatus || getLureStatus()) {
    const label = document.getElementById("minibia-bot-lure-status");
    if (!label) return;

    if (!lureStatus.enabled) {
      label.textContent = "Lure: off";
    } else if (lureStatus.readyToEngage) {
      label.textContent = `Lure: engaging ${lureStatus.monsterCount}/${lureStatus.minMonsters}`;
    } else if (lureStatus.shouldHoldWalking) {
      label.textContent = `Lure: waiting, closest ${lureStatus.closestDistance}/${lureStatus.maxDistance}`;
    } else if (lureStatus.monsterCount > 0) {
      label.textContent = `Lure: walking ${lureStatus.monsterCount}/${lureStatus.minMonsters}`;
    } else {
      label.textContent = `Lure: looking 0/${lureStatus.minMonsters}`;
    }
  }

  function updateUiValues() {
    const enabled = document.getElementById("minibia-bot-lure-enabled");
    const min = document.getElementById("minibia-bot-lure-min-monsters");
    const max = document.getElementById("minibia-bot-lure-max-distance");
    if (enabled) enabled.checked = !!config.enabled;
    if (min && document.activeElement !== min) min.value = String(normalizePositiveInt(config.minMonsters, 3, 1, 20));
    if (max && document.activeElement !== max) max.value = String(normalizePositiveInt(config.maxDistance, 4, 1, COUNT_RANGE));
  }

  function injectUi() {
    if (document.getElementById("minibia-bot-lure-section")) {
      updateUiValues();
      updateStatusUi();
      return true;
    }

    const aoeSection = document.getElementById("minibia-bot-auto-attack-aoe-section");
    const column = document.getElementById("minibia-bot-aoe-column") || aoeSection?.parentElement;
    if (!aoeSection || !column) return false;

    const section = document.createElement("div");
    section.className = "mb-section mb-column-section";
    section.id = "minibia-bot-lure-section";
    section.innerHTML = `
      <div class="mb-label">Lure Mode</div>
      <div class="mb-stack">
        <label class="mb-toggle">
          <input type="checkbox" id="minibia-bot-lure-enabled" />
          <span>Enable Lure Mode</span>
        </label>
        <div class="mb-field-grid">
          <label>Min Monsters</label>
          <input type="number" id="minibia-bot-lure-min-monsters" min="1" max="20" step="1" />
          <label>Max Distance</label>
          <input type="number" id="minibia-bot-lure-max-distance" min="1" max="7" step="1" />
        </div>
        <div class="mb-small-note">Counts monsters within 7 sqm. Holds walking until the closest lured monster is within Max Distance.</div>
        <div class="mb-small-note" id="minibia-bot-lure-status">Lure: off</div>
      </div>
    `;

    if (aoeSection.nextSibling) {
      column.insertBefore(section, aoeSection.nextSibling);
    } else {
      column.appendChild(section);
    }

    const enabled = section.querySelector("#minibia-bot-lure-enabled");
    const min = section.querySelector("#minibia-bot-lure-min-monsters");
    const max = section.querySelector("#minibia-bot-lure-max-distance");

    enabled?.addEventListener("change", () => updateConfig({ enabled: enabled.checked }));
    min?.addEventListener("change", () => updateConfig({ minMonsters: min.value }));
    min?.addEventListener("input", () => updateConfig({ minMonsters: min.value }));
    max?.addEventListener("change", () => updateConfig({ maxDistance: max.value }));
    max?.addEventListener("input", () => updateConfig({ maxDistance: max.value }));

    updateUiValues();
    updateStatusUi();
    return true;
  }

  function startUiInjector() {
    let attempts = 0;
    state.uiTimerId = window.setInterval(() => {
      attempts += 1;
      const injected = injectUi();
      if (injected || attempts >= 60) {
        window.clearInterval(state.uiTimerId);
        state.uiTimerId = null;
      }
    }, 500);
    injectUi();
  }

  bot.lureMode = {
    start,
    stop,
    status,
    updateConfig,
    getLureStatus,
    config,
  };

  start();
  startUiInjector();
  bot.addCleanup?.(stop);
};
