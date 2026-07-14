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

  function itemBlocksSight(item) {
    if (!item) return false;
    try {
      if (typeof item.isWalkable === "function" && !item.isWalkable()) return true;
      if (typeof item.isMoveable === "function" && !item.isMoveable()) return true;
    } catch (_) {}
    return false;
  }

  function tileIsBlocked(position) {
    const tile = getTile(position);
    if (!tile || Number(tile.id) === 0) return true;

    try {
      if (typeof tile.isItemBlocked === "function" && tile.isItemBlocked()) return true;
      if (typeof tile.isWalkable === "function" && !tile.isWalkable()) return true;
      if (Array.isArray(tile.items) && tile.items.some(itemBlocksSight)) return true;
    } catch (_) {
      return true;
    }

    return false;
  }

  function getSupercoverTiles(from, to) {
    const tiles = [];
    let x = from.x;
    let y = from.y;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const nx = Math.abs(dx);
    const ny = Math.abs(dy);
    const signX = dx === 0 ? 0 : dx > 0 ? 1 : -1;
    const signY = dy === 0 ? 0 : dy > 0 ? 1 : -1;
    let ix = 0;
    let iy = 0;

    while (ix < nx || iy < ny) {
      const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
      if (decision === 0) {
        x += signX;
        y += signY;
        ix += 1;
        iy += 1;
      } else if (decision < 0) {
        x += signX;
        ix += 1;
      } else {
        y += signY;
        iy += 1;
      }
      tiles.push({ x, y, z: from.z });
    }

    return tiles;
  }

  function hasClearLineOfSight(from, to) {
    const start = normalizePosition(from);
    const end = normalizePosition(to);
    if (!start || !end || start.z !== end.z) return false;

    const tiles = getSupercoverTiles(start, end);
    if (tiles.length <= 1) return true;

    for (let index = 0; index < tiles.length - 1; index += 1) {
      if (tileIsBlocked(tiles[index])) return false;
    }
    return true;
  }

  function hasReachableAdjacentTile(playerPosition, monsterPosition) {
    const world = window.gameClient?.world;
    const pathfinder = world?.pathfinder;
    const startTile = getTile(playerPosition);
    if (!startTile || !pathfinder || typeof pathfinder.search !== "function") {
      return false;
    }

    const offsets = [
      { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
      { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 },
    ];

    offsets.sort((left, right) => {
      const leftDistance = Math.abs(monsterPosition.x + left.x - playerPosition.x) +
        Math.abs(monsterPosition.y + left.y - playerPosition.y);
      const rightDistance = Math.abs(monsterPosition.x + right.x - playerPosition.x) +
        Math.abs(monsterPosition.y + right.y - playerPosition.y);
      return leftDistance - rightDistance;
    });

    for (const offset of offsets) {
      const adjacentPosition = {
        x: monsterPosition.x + offset.x,
        y: monsterPosition.y + offset.y,
        z: monsterPosition.z,
      };

      if (adjacentPosition.x === playerPosition.x &&
          adjacentPosition.y === playerPosition.y &&
          adjacentPosition.z === playerPosition.z) {
        return true;
      }

      if (tileIsBlocked(adjacentPosition)) continue;
      const destinationTile = getTile(adjacentPosition);
      if (!destinationTile) continue;

      try {
        const path = pathfinder.search(startTile, destinationTile);
        if ((Array.isArray(path) && path.length > 0) ||
            (!Array.isArray(path) && path && Number(path.length) > 0)) {
          return true;
        }
      } catch (_) {}
    }

    return false;
  }

  function isEligibleNewTarget(playerPosition, monsterPosition) {
    return !!monsterPosition &&
      playerPosition.z === monsterPosition.z &&
      hasClearLineOfSight(playerPosition, monsterPosition) &&
      hasReachableAdjacentTile(playerPosition, monsterPosition);
  }

  function calledFromAutoAttack() {
    try {
      const stack = String(new Error().stack || "");
      return stack.includes("auto-attack.js") ||
        stack.includes("getMonsterCandidates") ||
        stack.includes("getNearbyMonsters") ||
        stack.includes("triggerAttack") ||
        stack.includes("canAttack") ||
        stack.includes("tryAttack");
    } catch (_) {
      return false;
    }
  }

  xray.getVisibleMonsters = function getVisibleMonstersWithReachabilityFilter(options) {
    const monsters = originalGetVisibleMonsters(options) || [];
    if (!calledFromAutoAttack()) return monsters;

    const playerPosition = normalizePosition(window.minibiaBot?.getPlayerPosition?.());
    const currentTargetId = window.gameClient?.player?.__target?.id ?? null;
    if (!playerPosition) return monsters;

    return monsters.filter((monster) => {
      if (currentTargetId != null && monster?.id === currentTargetId) return true;
      const monsterPosition = normalizePosition(monster?.getPosition?.() || monster?.__position);
      return isEligibleNewTarget(playerPosition, monsterPosition);
    });
  };

  xray.__wallFilterInstalled = true;
  console.log("[minibia-bot] reachable auto target filter ready");
})();
