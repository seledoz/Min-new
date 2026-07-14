(() => {
  const xray = window.minibiaBot?.xray;
  if (!xray || typeof xray.getVisibleMonsters !== "function" || xray.__wallFilterInstalled) return;

  const originalGetVisibleMonsters = xray.getVisibleMonsters.bind(xray);

  function normalizePosition(value) {
    if (!value) return null;
    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) };
  }

  function getTile(position) {
    if (!position || typeof Position !== "function") return null;
    try {
      return window.gameClient?.world?.getTileFromWorldPosition?.(
        new Position(position.x, position.y, position.z)
      ) || null;
    } catch (_) {
      return null;
    }
  }

  function blocksLineOfSight(position) {
    const tile = getTile(position);
    if (!tile || Number(tile.id) === 0) return true;
    try {
      if (typeof tile.isItemBlocked === "function" && tile.isItemBlocked()) return true;
      if (typeof tile.isWalkable === "function" && !tile.isWalkable()) return true;
    } catch (_) {
      return true;
    }
    return false;
  }

  function hasClearLineOfSight(from, to) {
    const start = normalizePosition(from);
    const end = normalizePosition(to);
    if (!start || !end || start.z !== end.z) return false;

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    if (steps <= 1) return true;

    let previousKey = null;
    for (let step = 1; step < steps; step += 1) {
      const position = {
        x: Math.round(start.x + (dx * step) / steps),
        y: Math.round(start.y + (dy * step) / steps),
        z: start.z,
      };
      const key = `${position.x},${position.y},${position.z}`;
      if (key === previousKey) continue;
      previousKey = key;
      if (blocksLineOfSight(position)) return false;
    }
    return true;
  }

  function calledFromAutoAttack() {
    try {
      return String(new Error().stack || "").includes("src/modules/auto-attack.js");
    } catch (_) {
      return false;
    }
  }

  xray.getVisibleMonsters = function getVisibleMonstersWithWallFilter(options) {
    const monsters = originalGetVisibleMonsters(options) || [];
    if (!calledFromAutoAttack()) return monsters;

    const playerPosition = normalizePosition(window.minibiaBot?.getPlayerPosition?.());
    const currentTargetId = window.gameClient?.player?.__target?.id ?? null;
    if (!playerPosition) return monsters;

    return monsters.filter((monster) => {
      if (currentTargetId != null && monster?.id === currentTargetId) return true;
      const monsterPosition = normalizePosition(monster?.getPosition?.() || monster?.__position);
      return hasClearLineOfSight(playerPosition, monsterPosition);
    });
  };

  xray.__wallFilterInstalled = true;
  console.log("[minibia-bot] auto attack wall filter ready");
})();
