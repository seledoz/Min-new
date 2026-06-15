# A* Pathfinder Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix step-by-step walking ("soquinhos"), "there is no way" errors, and lack of waypoint tolerance in the A* pathfinder mode for cave bot.

**Architecture:** Single-file changes to `src/modules/cave.js` focused on `goToWaypoint()`, `filterPathToViewport()`, and `aStarPath()`. The A* mode will route to the farthest visible tile (not just the next tile), fall back to game pathfinder on failure, and respect `waypointTolerance`.

**Tech Stack:** JavaScript (browser), Tibia game client API

---

## File Structure

- `src/modules/cave.js` — All changes in one file:
  - `goToWaypoint()` — Fix A* mode to route farthest visible tile + game fallback
  - `filterPathToViewport()` — Return first screen-edge tile instead of null when nothing is fully on-screen
  - `aStarPath()` — Accept distance tolerance for goal check
  - `getAStarWalkabilityMatrix()` — Fix cache key to include floor z instead of relative z
  - `isAtWaypoint()` — Already uses tolerance, no change needed
  - `antiStuckFallback()` — No change needed, but anti-stuck may trigger less after fixes

---

### Task 1: Fix `goToWaypoint` in A* mode — route to farthest visible tile + game fallback

**File:** `src/modules/cave.js:1270-1324`

**Problem:** Current code finds the A* path, filters to viewport, picks the FIRST non-player tile, and routes to only that tile. This causes:
- Step-by-step walking (1 tile per tick at 500ms)
- "There is no way" when the game pathfinder rejects the single next tile
- Path rejected entirely when `filterPathToViewport` returns null

**Fix logic:**
1. Find A* path from player to waypoint
2. If A* fails (no path), fall through to game pathfinder (line 1309-1323)
3. Since A* success, pick the **last** tile in the visible path (farthest on-screen), or the waypoint itself if on-screen
4. Route to that target tile using game pathfinder
5. If even that fails, fall through to game pathfinder directly to waypoint

- [ ] **Step 1: Replace the A* routing block in `goToWaypoint`**

Replace lines 1273-1307 with:

```js
    if (config.pathfinderMode === 'astar') {
      const fromPos = normalizePosition(from);
      const waypointPos = normalizePosition(waypoint);
      const path = findPathAStar(fromPos, waypointPos);

      if (path && path.length > 0) {
        const playerPos = fromPos;
        const waypointOnScreen = isOnScreen(waypointPos, playerPos);
        let targetTile = null;

        if (waypointOnScreen) {
          targetTile = waypointPos;
        } else {
          const visiblePath = filterPathToViewport(path, playerPos);
          if (visiblePath && visiblePath.length > 0) {
            targetTile = visiblePath[visiblePath.length - 1];
          } else {
            targetTile = path[Math.min(VIEWPORT_DX, path.length - 1)];
          }
        }

        if (targetTile && !(targetTile.x === playerPos.x && targetTile.y === playerPos.y)) {
          const to = new Position(targetTile.x, targetTile.y, playerPos.z);
          try {
            window.gameClient?.world?.pathfinder?.findPath?.(from, to);
            state.lastPathAt = now;
            bot.log("cave A* pathing to waypoint", {
              ...waypoint,
              index: state.currentIndex + 1,
              total: route.length,
              targetTile,
              pathLength: path.length,
              waypointOnScreen,
            });
            return true;
          } catch (error) {
            bot.log("cave A* pathing failed to target tile, falling back to game pathfinder", {
              waypoint,
              targetTile,
              error: error?.message || error,
            });
          }
        }
      } else {
        bot.log("cave A* pathfinding failed, falling back to game pathfinder", {
          ...waypoint,
          index: state.currentIndex + 1,
        });
      }
    }

    // Default: game pathfinder (fallback for A* failure)
    const to = new Position(waypoint.x, waypoint.y, waypoint.z);
    try {
      window.gameClient?.world?.pathfinder?.findPath?.(from, to);
      state.lastPathAt = now;
      bot.log("cave pathing to waypoint", {
        ...waypoint,
        index: state.currentIndex + 1,
        total: route.length,
      });
      return true;
    } catch (error) {
      bot.log("cave pathing failed", { ...waypoint, error: error?.message || error });
      return false;
    }
```

- [ ] **Step 2: Verify the edit in context**

Run: `cd C:\Users\Administrator\Documents\github\minibia-bot && git diff src/modules/cave.js`

Expected: The A* block in `goToWaypoint` now routes to farthest visible tile or waypoint, with fallback to game pathfinder.

---

### Task 2: Fix `filterPathToViewport` — return first tile near screen edge instead of null

**File:** `src/modules/cave.js:510-515`

**Problem:** When all A* path tiles are outside the 8x6 viewport rectangle, returns `null`. This discards the entire A* path. Better to return the first tile that's closest to being visible.

- [ ] **Step 1: Replace `filterPathToViewport`**

Replace with:

```js
  function filterPathToViewport(path, playerPos) {
    if (!path || !path.length) return path;
    const onScreen = path.filter(p => isOnScreen(p, playerPos));
    if (onScreen.length > 0) return onScreen;
    const extended = path.filter(p =>
      Math.abs(p.x - playerPos.x) <= VIEWPORT_DX * 2 &&
      Math.abs(p.y - playerPos.y) <= VIEWPORT_DY * 2 &&
      p.z === playerPos.z
    );
    if (extended.length > 0) return [extended[0]];
    return path.slice(0, 1);
  }
```

- [ ] **Step 2: Verify the edit**

Run: `cd C:\Users\Administrator\Documents\github\minibia-bot && git diff src/modules/cave.js`

Expected: `filterPathToViewport` now returns at least 1 tile instead of `null`.

---

### Task 3: Fix `getAStarWalkabilityMatrix` — use absolute z for cache key

**File:** `src/modules/cave.js:298-322`

**Problem:** Cache key uses `matrix_${z}` where `z` is the floor level. This is actually correct — the matrix is per-floor. But the matrix might include stale data if tiles change (mobs walking). The cache TTL is 1000ms which is reasonable.

Actually, the issue is that `matrixCacheTTL` is 1000ms but `cleanupPathCache()` only runs every tick (500ms). The matrix might be stale for the second half of the tick. But this isn't the main issue.

The real issue is **not** in `getAStarWalkabilityMatrix` — the issue is that `findPathAStar` caches the entire path for 5000ms (`pathCacheTTL`) and the walkability matrix for 1000ms. If the game world changes (e.g., a mob walks onto a tile), the cached data is wrong.

Fix: Lower `pathCacheTTL` to 2000ms and increase `matrixCacheTTL` to 2000ms so they're in sync.

- [ ] **Step 1: Update PATHFINDER_CONFIG**

```js
  const PATHFINDER_CONFIG = {
    pathCacheTTL: 2000,
    matrixCacheTTL: 2000,
  };
```

---

### Task 4: Add waypoint tolerance to `aStarPath` success condition

**File:** `src/modules/cave.js:249-296`

**Problem:** `aStarPath` requires exact match `current.x === goal.x && current.y === goal.y`. The `config.waypointTolerance` exists but isn't used by A*.

- [ ] **Step 1: Modify `aStarPath` to accept an optional tolerance parameter**

```js
  function aStarPath(start, goal, getWalkable, getNeighbors, tolerance = 0) {
```

Wire it in at line 262:

```js
      if (Math.abs(current.x - goal.x) + Math.abs(current.y - goal.y) <= tolerance) {
```

- [ ] **Step 2: Update `findPathAStar` to pass the tolerance**

```js
  function findPathAStar(from, to) {
    from = normalizePosition(from);
    to = normalizePosition(to);
    if (!from || !to) return null;
    if (from.x === to.x && from.y === to.y && from.z === to.z) return [];
    if (from.z !== to.z) return null;

    const cached = getCachedPath(from, to);
    if (cached) return cached;

    const matrix = getAStarWalkabilityMatrix(from, from.z);
    const tolerance = Math.max(0, Number(config.waypointTolerance) || 0);
    const path = aStarPath(from, to,
      (x, y) => matrix.get(`${x},${y}`) === true,
      (node) => getAStarNeighbors(node, matrix),
      tolerance
    );

    if (path) setCachedPath(from, to, path);
    return path;
  }
```

---

### Task 5: Rebuild and test

- [ ] **Step 1: Run build.sh**

```bash
cd C:\Users\Administrator\Documents\github\minibia-bot && ./build.sh
```

Expected: No output, bundle rebuilt.

- [ ] **Step 2: Verify diff**

```bash
cd C:\Users\Administrator\Documents\github\minibia-bot && git diff --stat
```

Expected: Changes only to `src/modules/cave.js` and `pz-bot.js`.

- [ ] **Step 3: Commit**

```bash
cd C:\Users\Administrator\Documents\github\minibia-bot && git add -A && git commit -m "corrige A* pathfinder: roteia para tile mais distante na tela, fallback game pathfinder, tolerancia waypointTolerance"
```
