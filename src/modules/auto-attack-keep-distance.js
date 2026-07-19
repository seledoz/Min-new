window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installAutoAttackKeepDistanceModule = function installAutoAttackKeepDistanceModule(bot) {
  const configStorageKey = "minibiaBot.attackKeepDistance.config";
  const config = Object.assign(
    {
      enabled: false,
      distance: 3,
      tickMs: 200,
    },
    bot.storage.get(configStorageKey, {}) || {}
  );

  const state = {
    timerId: null,
    previousMeleeMode: null,
    lastMoveAt: 0,
    lastDestinationKey: null,
    lastTargetId: null,
  };

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function normalizePosition(value) {
    if (!value) return null;
    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) };
  }

  function getTileDistance(from, to) {
    if (!from || !to || from.z !== to.z) return Number.POSITIVE_INFINITY;
    return Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y));
  }

  function getTile(position) {
    if (!position || typeof Position !== "function") return null;
    return window.gameClient?.world?.getTileFromWorldPosition?.(
      new Position(position.x, position.y, position.z)
    ) || null;
  }

  function clearFollowTarget() {
    const player = window.gameClient?.player;
    if (!player?.__followTarget || typeof window.gameClient?.send !== "function" || typeof FollowPacket !== "function") {
      return false;
    }
    player.setFollowTarget(null);
    window.gameClient.send(new FollowPacket(0));
    return true;
  }

  function canReach(playerPosition, candidatePosition) {
    const pathfinder = window.gameClient?.world?.pathfinder;
    const startTile = getTile(playerPosition);
    const candidateTile = getTile(candidatePosition);
    if (!candidateTile?.isWalkable?.()) return false;
    if (candidatePosition.x === playerPosition.x && candidatePosition.y === playerPosition.y) return true;
    if (!pathfinder || !startTile || typeof pathfinder.search !== "function") return true;
    try {
      const path = pathfinder.search(startTile, candidateTile);
      return Array.isArray(path) && path.length > 0;
    } catch (error) {
      return false;
    }
  }

  function getRetreatCandidates(playerPosition, targetPosition) {
    const candidates = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if (dx === 0 && dy === 0) continue;
        const candidate = {
          x: playerPosition.x + dx,
          y: playerPosition.y + dy,
          z: playerPosition.z,
        };
        if (!canReach(playerPosition, candidate)) continue;
        candidates.push(candidate);
      }
    }

    return candidates.sort((left, right) => {
      const leftDistance = getTileDistance(left, targetPosition);
      const rightDistance = getTileDistance(right, targetPosition);
      if (rightDistance !== leftDistance) return rightDistance - leftDistance;

      const leftAxisGain =
        Math.abs(left.x - targetPosition.x) + Math.abs(left.y - targetPosition.y);
      const rightAxisGain =
        Math.abs(right.x - targetPosition.x) + Math.abs(right.y - targetPosition.y);
      return rightAxisGain - leftAxisGain;
    });
  }

  function findBestRetreatPosition(playerPosition, targetPosition, currentDistance) {
    const candidates = getRetreatCandidates(playerPosition, targetPosition);
    return candidates.find((candidate) => getTileDistance(candidate, targetPosition) > currentDistance) || null;
  }

  function moveTo(position, now = Date.now()) {
    if (!position || typeof Position !== "function") return false;
    const destinationKey = `${position.x},${position.y},${position.z}`;
    if (state.lastDestinationKey === destinationKey && now - state.lastMoveAt < 450) return false;
    if (now - state.lastMoveAt < 180) return false;

    try {
      clearFollowTarget();
      const playerPosition = normalizePosition(bot.getPlayerPosition?.());
      const destination = new Position(position.x, position.y, position.z);
      window.gameClient?.world?.pathfinder?.findPath?.(playerPosition, destination);
      state.lastMoveAt = now;
      state.lastDestinationKey = destinationKey;
      return true;
    } catch (error) {
      bot.log("keep distance pathing failed", { destination: position, error: error?.message || error });
      return false;
    }
  }

  function syncAttackMode() {
    const attackConfig = bot.attack?.status?.().config;
    if (!attackConfig) return;

    if (config.enabled) {
      if (state.previousMeleeMode == null) state.previousMeleeMode = !!attackConfig.meleeMode;
      if (attackConfig.meleeMode) bot.attack.updateConfig({ meleeMode: false });
    } else if (state.previousMeleeMode != null) {
      bot.attack.updateConfig({ meleeMode: state.previousMeleeMode });
      state.previousMeleeMode = null;
    }
  }

  function tick() {
    if (!config.enabled) return;
    syncAttackMode();

    const attackStatus = bot.attack?.status?.();
    if (!attackStatus?.running) return;

    const target = bot.attack?.getCurrentTarget?.() || window.gameClient?.player?.__target || null;
    const playerPosition = normalizePosition(bot.getPlayerPosition?.());
    const targetPosition = normalizePosition(target?.getPosition?.() || target?.__position);
    if (!target || !playerPosition || !targetPosition || playerPosition.z !== targetPosition.z) {
      state.lastTargetId = null;
      state.lastDestinationKey = null;
      return;
    }

    if (state.lastTargetId !== target.id) {
      state.lastTargetId = target.id;
      state.lastDestinationKey = null;
    }

    const desiredDistance = Math.max(1, Math.min(7, Math.trunc(Number(config.distance) || 3)));
    const currentDistance = getTileDistance(playerPosition, targetPosition);

    // Never run toward a target in keep-distance mode. At or beyond the selected
    // range, hold position and let the target approach.
    if (currentDistance >= desiredDistance) {
      clearFollowTarget();
      state.lastDestinationKey = null;
      return;
    }

    // Too close: move only one square at a time, directly increasing distance.
    const destination = findBestRetreatPosition(playerPosition, targetPosition, currentDistance);
    if (destination) {
      moveTo(destination);
      bot.logDebug?.("retreating from auto attack target", {
        targetId: target.id,
        targetName: target.name || "Mob",
        desiredDistance,
        currentDistance,
        destination,
      });
    } else {
      clearFollowTarget();
    }
  }

  function schedule() {
    window.clearInterval(state.timerId);
    state.timerId = window.setInterval(tick, Math.max(100, Number(config.tickMs) || 200));
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "enabled")) {
      nextConfig.enabled = !!nextConfig.enabled;
    }
    if (Object.prototype.hasOwnProperty.call(nextConfig, "distance")) {
      nextConfig.distance = Math.max(1, Math.min(7, Math.trunc(Number(nextConfig.distance) || config.distance || 3)));
    }
    Object.assign(config, nextConfig);
    persistConfig();
    syncAttackMode();
    refreshUi();
    return { ...config };
  }

  function status() {
    return {
      config: { ...config },
      lastMoveAt: state.lastMoveAt,
      lastDestinationKey: state.lastDestinationKey,
      lastTargetId: state.lastTargetId,
    };
  }

  function refreshUi() {
    const enabledInput = document.getElementById("minibia-bot-auto-attack-keep-distance-enabled");
    const distanceInput = document.getElementById("minibia-bot-auto-attack-keep-distance-squares");
    if (enabledInput) enabledInput.checked = !!config.enabled;
    if (distanceInput && document.activeElement !== distanceInput) distanceInput.value = String(config.distance);
  }

  function injectUi() {
    const attackToggle = document.getElementById("minibia-bot-auto-attack-enabled");
    const section = attackToggle?.closest?.(".mb-section");
    const stack = section?.querySelector?.(".mb-stack");
    if (!stack || document.getElementById("minibia-bot-auto-attack-keep-distance-enabled")) return false;

    const row = document.createElement("div");
    row.className = "mb-row";
    row.innerHTML = `
      <label class="mb-toggle">
        <input type="checkbox" id="minibia-bot-auto-attack-keep-distance-enabled" />
        <span>Keep Distance</span>
      </label>
      <label class="mb-field mb-field-compact" for="minibia-bot-auto-attack-keep-distance-squares">
        <span class="mb-field-label">Squares (1-7)</span>
        <input type="number" id="minibia-bot-auto-attack-keep-distance-squares" min="1" max="7" step="1" />
      </label>
    `;

    const meleeToggle = document.getElementById("minibia-bot-auto-attack-melee")?.closest?.("label");
    if (meleeToggle?.nextSibling) stack.insertBefore(row, meleeToggle.nextSibling);
    else stack.appendChild(row);

    const enabledInput = row.querySelector("#minibia-bot-auto-attack-keep-distance-enabled");
    const distanceInput = row.querySelector("#minibia-bot-auto-attack-keep-distance-squares");
    enabledInput?.addEventListener("change", () => updateConfig({ enabled: enabledInput.checked }));
    distanceInput?.addEventListener("change", () => updateConfig({ distance: distanceInput.value }));
    refreshUi();
    return true;
  }

  bot.attackKeepDistance = { updateConfig, status, injectUi, tick };
  injectUi();
  schedule();
  syncAttackMode();

  bot.addCleanup(() => {
    window.clearInterval(state.timerId);
    state.timerId = null;
    if (state.previousMeleeMode != null) {
      bot.attack?.updateConfig?.({ meleeMode: state.previousMeleeMode });
      state.previousMeleeMode = null;
    }
  });
};