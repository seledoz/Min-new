window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(() => {
  const bot = window.minibiaBot;
  if (!bot || bot.__caveChaseAntiStuckInstalled) return;

  bot.__caveChaseAntiStuckInstalled = true;

  const STUCK_MS = 3000;
  const CHECK_MS = 250;
  const FORCE_COMBAT_CLEAR_MS = 1500;

  const state = {
    timerId: null,
    targetId: null,
    lastPlayerPositionKey: null,
    stationarySince: 0,
    forceCombatClearUntil: 0,
  };

  function normalizePosition(value) {
    if (!value) return null;

    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }

    return {
      x: Math.trunc(x),
      y: Math.trunc(y),
      z: Math.trunc(z),
    };
  }

  function getPositionKey(position) {
    return position ? `${position.x},${position.y},${position.z}` : null;
  }

  function isAdjacentTile(from, to) {
    if (!from || !to || Number(from.z) !== Number(to.z)) {
      return false;
    }

    const dx = Math.abs(Number(from.x) - Number(to.x));
    const dy = Math.abs(Number(from.y) - Number(to.y));
    return (dx !== 0 || dy !== 0) && dx <= 1 && dy <= 1;
  }

  function getPlayerPosition() {
    return normalizePosition(bot.getPlayerPosition?.() || window.gameClient?.player?.__position);
  }

  function getTargetPosition(target) {
    return normalizePosition(target?.getPosition?.() || target?.__position);
  }

  function getCurrentTarget() {
    return bot.attack?.getCurrentTarget?.() || window.gameClient?.player?.__target || null;
  }

  function getCurrentFollowTarget() {
    return bot.attack?.getCurrentFollowTarget?.() || window.gameClient?.player?.__followTarget || null;
  }

  function isSameCreature(left, right) {
    if (!left || !right) return false;
    return left === right || left.id === right.id;
  }

  function resetTracking(target = null, now = Date.now()) {
    state.targetId = target?.id ?? null;
    state.lastPlayerPositionKey = getPositionKey(getPlayerPosition());
    state.stationarySince = now;
  }

  function clearTargetAndFollow(target) {
    const player = window.gameClient?.player;
    const send = window.gameClient?.send;
    let clearedTarget = false;
    let clearedFollow = false;

    if (player && typeof send === "function" && typeof TargetPacket === "function") {
      if (!target || isSameCreature(getCurrentTarget(), target)) {
        player.setTarget?.(null);
        send(new TargetPacket(0));
        clearedTarget = true;
      }
    }

    if (player && typeof send === "function" && typeof FollowPacket === "function") {
      if (!target || isSameCreature(getCurrentFollowTarget(), target)) {
        player.setFollowTarget?.(null);
        send(new FollowPacket(0));
        clearedFollow = true;
      }
    }

    return { clearedTarget, clearedFollow };
  }

  function getNextWaypointIndex(caveStatus) {
    const routeLength = Array.isArray(caveStatus?.route) ? caveStatus.route.length : 0;
    if (routeLength <= 1) return Number(caveStatus?.currentIndex) || 0;

    const currentIndex = Math.max(0, Math.min(routeLength - 1, Math.trunc(Number(caveStatus.currentIndex) || 0)));
    const direction = Number(caveStatus.direction) || 1;

    // Respect the forward-loop helper when it is enabled: last waypoint wraps back to first.
    const forwardLoopEnabled = bot.caveForwardLoop?.status?.()?.config?.enabled !== false;
    if (forwardLoopEnabled && currentIndex >= routeLength - 1) {
      return 0;
    }

    let nextIndex = currentIndex + direction;
    if (nextIndex >= routeLength) {
      nextIndex = routeLength - 2;
    } else if (nextIndex < 0) {
      nextIndex = 1;
    }

    return Math.max(0, Math.min(routeLength - 1, nextIndex));
  }

  function advanceCaveWaypoint(reason, target, stuckForMs) {
    if (!bot.cave?.status || !bot.cave?.setCurrentIndex) return false;

    const caveStatus = bot.cave.status();
    if (!caveStatus?.running) return false;

    const routeLength = Array.isArray(caveStatus.route) ? caveStatus.route.length : 0;
    if (!routeLength) return false;

    const previousIndex = Math.max(0, Math.trunc(Number(caveStatus.currentIndex) || 0));
    const nextIndex = getNextWaypointIndex(caveStatus);
    bot.cave.setCurrentIndex(nextIndex);

    const nextWaypoint = bot.cave.getCurrentWaypoint?.() || null;
    if (nextWaypoint) {
      bot.cave.goToWaypoint?.(nextWaypoint);
    }

    bot.log("cave chase anti-stuck advanced waypoint", {
      reason,
      targetId: target?.id,
      targetName: target?.name || "Mob",
      previousIndex: previousIndex + 1,
      nextIndex: nextIndex + 1,
      routeLength,
      stuckForMs,
      nextWaypoint,
    });

    return true;
  }

  function patchAttackStatus() {
    if (!bot.attack?.status || bot.attack.__caveChaseAntiStuckStatusPatched) return;

    const originalStatus = bot.attack.status.bind(bot.attack);
    bot.attack.status = (...args) => {
      const status = originalStatus(...args);
      if (Date.now() >= state.forceCombatClearUntil) {
        return status;
      }

      return {
        ...status,
        combatActive: false,
        combatStartedAt: 0,
        combatDurationMs: 0,
        targetCount: 0,
        currentTarget: null,
      };
    };

    bot.attack.__caveChaseAntiStuckStatusPatched = true;
  }

  function checkChaseStuck(now = Date.now()) {
    patchAttackStatus();

    const target = getCurrentTarget() || getCurrentFollowTarget();
    if (!target?.id) {
      resetTracking(null, now);
      return false;
    }

    const playerPosition = getPlayerPosition();
    const targetPosition = getTargetPosition(target);
    if (!playerPosition || !targetPosition || playerPosition.z !== targetPosition.z) {
      resetTracking(target, now);
      return false;
    }

    const playerPositionKey = getPositionKey(playerPosition);
    if (state.targetId !== target.id || state.lastPlayerPositionKey !== playerPositionKey) {
      state.targetId = target.id;
      state.lastPlayerPositionKey = playerPositionKey;
      state.stationarySince = now;
      return false;
    }

    if (isAdjacentTile(playerPosition, targetPosition)) {
      state.stationarySince = now;
      return false;
    }

    const stuckForMs = now - (state.stationarySince || now);
    if (stuckForMs < STUCK_MS) {
      return false;
    }

    const cleared = clearTargetAndFollow(target);
    state.forceCombatClearUntil = now + FORCE_COMBAT_CLEAR_MS;
    advanceCaveWaypoint("target not adjacent and player tile did not change", target, stuckForMs);

    bot.log("cave chase anti-stuck cleared target", {
      targetId: target.id,
      targetName: target.name || "Mob",
      playerPosition,
      targetPosition,
      stuckForMs,
      clearedTarget: cleared.clearedTarget,
      clearedFollow: cleared.clearedFollow,
    });

    resetTracking(null, now);
    return true;
  }

  function start() {
    if (state.timerId != null) return false;
    patchAttackStatus();
    state.timerId = window.setInterval(() => {
      try {
        checkChaseStuck();
      } catch (error) {
        bot.log("cave chase anti-stuck failed", error?.message || error);
      }
    }, CHECK_MS);
    return true;
  }

  function stop() {
    if (state.timerId == null) return false;
    window.clearInterval(state.timerId);
    state.timerId = null;
    return true;
  }

  function status() {
    return {
      running: state.timerId != null,
      targetId: state.targetId,
      stationaryForMs: state.stationarySince ? Math.max(0, Date.now() - state.stationarySince) : 0,
      forceCombatClearUntil: state.forceCombatClearUntil,
      config: {
        stuckMs: STUCK_MS,
        checkMs: CHECK_MS,
      },
    };
  }

  function destroy() {
    stop();
  }

  bot.caveChaseAntiStuck = {
    start,
    stop,
    status,
    checkChaseStuck,
    destroy,
  };

  start();
  bot.addCleanup?.(destroy);
})();
