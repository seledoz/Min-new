window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(function installCaveWaypointTolerancePathingPatch(bundle) {
  const originalInstallCaveModule = bundle.installCaveModule;
  if (typeof originalInstallCaveModule !== "function") return;
  if (originalInstallCaveModule.__waypointTolerancePathingPatched) return;

  const configStorageKey = "minibiaBot.cave.config";

  function normalizePosition(value) {
    if (!value) return null;
    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) };
  }

  function getThingDefinition(itemId) {
    if (!itemId) return null;
    return (
      window.gameClient?.itemDefinitionsByCid?.[itemId] ||
      window.gameClient?.itemDefinitionsBySid?.[itemId] ||
      window.gameClient?.itemDefinitions?.[itemId] ||
      null
    );
  }

  function getThingName(thing) {
    const definition = getThingDefinition(thing?.id);
    return String(definition?.properties?.name || thing?.name || "").trim().toLowerCase();
  }

  function isExactActionTile(position) {
    const tile = position
      ? window.gameClient?.world?.getTileFromWorldPosition?.(
          new Position(position.x, position.y, position.z)
        )
      : null;
    if (!tile) return false;

    const things = [tile, ...(Array.isArray(tile.items) ? tile.items : [])];
    return things.some((thing) => {
      const definition = getThingDefinition(thing?.id);
      const name = getThingName(thing);
      return !!definition?.properties?.floorchange ||
        /\b(ladder|stairs|hole|rope spot|door|teleport)\b/i.test(name);
    });
  }

  function findClosestWalkableToleranceTile(from, waypoint, tolerance) {
    const candidates = [];

    for (let dx = -tolerance; dx <= tolerance; dx += 1) {
      for (let dy = -tolerance; dy <= tolerance; dy += 1) {
        if (dx === 0 && dy === 0) continue;

        const position = {
          x: waypoint.x + dx,
          y: waypoint.y + dy,
          z: waypoint.z,
        };
        const tile = window.gameClient?.world?.getTileFromWorldPosition?.(
          new Position(position.x, position.y, position.z)
        );
        if (!tile?.isWalkable?.()) continue;

        candidates.push({
          position,
          distanceFromPlayer:
            Math.abs(position.x - from.x) + Math.abs(position.y - from.y),
          distanceFromWaypoint: Math.max(Math.abs(dx), Math.abs(dy)),
        });
      }
    }

    candidates.sort((a, b) =>
      a.distanceFromPlayer - b.distanceFromPlayer ||
      a.distanceFromWaypoint - b.distanceFromWaypoint
    );
    return candidates[0]?.position || null;
  }

  function patchGamePathfinder(bot) {
    const pathfinder = window.gameClient?.world?.pathfinder;
    if (!pathfinder || typeof pathfinder.findPath !== "function") return false;
    if (pathfinder.findPath.__caveWaypointTolerancePatched) return true;

    const originalFindPath = pathfinder.findPath;

    function findPathWithWaypointTolerance(fromValue, toValue, ...args) {
      const from = normalizePosition(fromValue);
      const to = normalizePosition(toValue);
      const caveStatus = bot.cave?.status?.() || null;
      const waypoint = normalizePosition(caveStatus?.currentWaypoint);
      const configuredTolerance = Number(caveStatus?.config?.waypointTolerance);
      const tolerance = Math.max(1, Number.isFinite(configuredTolerance) ? configuredTolerance : 1);

      const isCurrentSameFloorWaypoint =
        from &&
        to &&
        waypoint &&
        from.z === waypoint.z &&
        to.x === waypoint.x &&
        to.y === waypoint.y &&
        to.z === waypoint.z;

      if (isCurrentSameFloorWaypoint && !isExactActionTile(waypoint)) {
        const toleranceTarget = findClosestWalkableToleranceTile(from, waypoint, tolerance);
        if (toleranceTarget) {
          const adjustedTarget = new Position(
            toleranceTarget.x,
            toleranceTarget.y,
            toleranceTarget.z
          );
          return originalFindPath.call(this, fromValue, adjustedTarget, ...args);
        }
      }

      return originalFindPath.call(this, fromValue, toValue, ...args);
    }

    findPathWithWaypointTolerance.__caveWaypointTolerancePatched = true;
    findPathWithWaypointTolerance.__originalFindPath = originalFindPath;
    pathfinder.findPath = findPathWithWaypointTolerance;
    return true;
  }

  function patchedInstallCaveModule(bot) {
    const savedConfig = bot.storage.get(configStorageKey, {}) || {};
    bot.storage.set(configStorageKey, {
      ...savedConfig,
      waypointTolerance: Math.max(1, Number(savedConfig.waypointTolerance) || 1),
    });

    const result = originalInstallCaveModule(bot);
    bot.cave?.updateConfig?.({ waypointTolerance: 1 });

    if (!patchGamePathfinder(bot)) {
      let attempts = 0;
      const timerId = window.setInterval(() => {
        attempts += 1;
        if (patchGamePathfinder(bot) || attempts >= 40) {
          window.clearInterval(timerId);
        }
      }, 250);
      bot.addCleanup?.(() => window.clearInterval(timerId));
    }

    return result;
  }

  patchedInstallCaveModule.__waypointTolerancePathingPatched = true;
  patchedInstallCaveModule.__originalInstallCaveModule = originalInstallCaveModule;
  bundle.installCaveModule = patchedInstallCaveModule;
})(window.__minibiaBotBundle);
