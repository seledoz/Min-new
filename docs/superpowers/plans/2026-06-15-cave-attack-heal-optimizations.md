# Cave/Attack/Heal Optimizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize cave bot pathfinding, auto-attack target selection, and auto-heal retry logic based on real session log analysis.

**Architecture:** Nine independent optimizations across three modules (`cave.js`, `auto-attack.js`, `heal.js`), each configurable and backward-compatible.

**Tech Stack:** JavaScript (browser extension/bundle via build.sh)

---

### Task 1: Increase repath threshold from 1500ms to 3000ms

**Files:**
- Modify: `src/modules/cave.js:42`

- [ ] **Step 1: Change default repathMs**

Change `repathMs: 1500` to `repathMs: 3000` in config defaults.

```js
// Before (line 42):
      repathMs: 1500,
// After:
      repathMs: 3000,
```

- [ ] **Step 2: Verify no other references to 1500 repath**

Run: `rg "repathMs|1500" src/modules/`
Expected: Only the config default and the `config.repathMs` usage in `shouldRepath` check (line ~1856).

- [ ] **Step 3: Commit**

```bash
git add src/modules/cave.js
git commit -m "aumenta repath threshold de 1500ms para 3000ms para reduzir recálculos A* desnecessários"
```

---

### Task 2: Fix chase/give-up cycle between auto-attack and cave

**Files:**
- Modify: `src/modules/auto-attack.js:800` (add exports)
- Modify: `src/modules/cave.js:494-498` (add skipTarget call)

- [ ] **Step 1: Expose skipTarget from auto-attack**

Add to `bot.attack` exports in `auto-attack.js` around line 800:

```js
  bot.attack = {
    start,
    stop,
    status,
    updateConfig,
    tryAttack,
    canAttack,
    triggerAttack,
    canUseRune,
    triggerRune,
    getNearbyMonsters,
    getCurrentTarget,
    getCurrentFollowTarget,
    isCombatActive,
    syncMeleeChase,
    normalizeHotbarSlot,
    skipTarget,        // ADD
    isTargetSkipped,   // ADD
    config,
  };
```

- [ ] **Step 2: Call skipTarget from cave's giveUpChase**

In `src/modules/cave.js`, modify `giveUpChase` function (line 494):

```js
  function giveUpChase(target, reason) {
    chaseState.targetId = null;
    bot.log("cave gave up chase", { targetId: target?.id, reason });
    // Prevent auto-attack from immediately re-selecting this target
    if (target && bot.attack?.skipTarget) {
      bot.attack.skipTarget(target, 'cave chase: ' + reason, Date.now(), 5000);
    }
    return false;
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/auto-attack.js src/modules/cave.js
git commit -m "corrige ciclo chase/give-up: expoe skipTarget do auto-attack e chama ao dar giveUp no cave"
```

---

### Task 3: Reduce stuck detection threshold from 5000ms to 3000ms

**Files:**
- Modify: `src/modules/cave.js:1827`

- [ ] **Step 1: Change stuck threshold**

```js
// Before (line 1827):
      const isStuck = timeSinceProgress >= 5000 &&
// After:
      const isStuck = timeSinceProgress >= 3000 &&
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/cave.js
git commit -m "reduz threshold de stuck detection de 5000ms para 3000ms para resposta mais rapida"
```

---

### Task 4: Improve heal retry logic

**Files:**
- Modify: `src/modules/heal.js`

- [ ] **Step 1: Add consecutive failure tracking and increase retryMs**

```js
// In state object (around line 12), add:
      hpFailCount: 0,
      manaFailCount: 0,

// Change healRetryMs from 200 to 400 (line 20):
      healRetryMs: 400,

// In resolvePendingAttempts, when heal does not register (lines 99-101):
      } else if (now - hpAttempt.attemptedAt >= Math.max(50, Number(config.healConfirmMs) || 0)) {
        state.pendingHpAttempt = null;
        state.hpFailCount = (state.hpFailCount || 0) + 1;
        bot.log("hp heal did not register", { slot: hpAttempt.slot, failCount: state.hpFailCount });

// And for mana (lines 111-113):
      } else if (now - manaAttempt.attemptedAt >= Math.max(50, Number(config.healConfirmMs) || 0)) {
        state.pendingManaAttempt = null;
        state.manaFailCount = (state.manaFailCount || 0) + 1;
        bot.log("mana heal did not register", { slot: manaAttempt.slot, failCount: state.manaFailCount });

// In canUseHpHeal (line 127), add max retry check after the healRetryMs check:
      hp.current > 0 &&
      hp.current <= Math.max(0, Number(config.minHp) || 0) &&
      now - state.lastHpHealAt >= config.healCooldownMs &&
      now - state.lastHpAttemptAt >= Math.max(50, Number(config.healRetryMs) || 0) &&
      (state.hpFailCount || 0) < 3

// In canUseManaHeal (line 139), add max retry check after healRetryMs check:
      mana.current <= Math.max(0, Number(config.minMana) || 0) &&
      now - state.lastManaHealAt >= config.healCooldownMs &&
      now - state.lastManaAttemptAt >= Math.max(50, Number(config.healRetryMs) || 0) &&
      (state.manaFailCount || 0) < 3

// In didHpHealSucceed (line 71-78), when heal succeeds, reset fail count:
// (function already returns bool, add state.hpFailCount = 0 at call site)
// In resolvePendingAttempts (line 96):
        state.lastHpHealAt = hpAttempt.attemptedAt;
        state.pendingHpAttempt = null;
        state.hpFailCount = 0;   // ADD
        bot.log("confirmed hp heal", { slot: hpAttempt.slot });

// Same for mana (line 109):
        state.lastManaHealAt = manaAttempt.attemptedAt;
        state.pendingManaAttempt = null;
        state.manaFailCount = 0;   // ADD
        bot.log("confirmed mana heal", { slot: manaAttempt.slot });
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/heal.js
git commit -m "melhora heal retry: increase retryMs para 400ms, adiciona max 3 consecutive failures"
```

---

### Task 5: Rate-limit debug logging

**Files:**
- Modify: `src/modules/cave.js:1730`

- [ ] **Step 1: Reduce tick summary frequency from 5 to 15 ticks**

```js
// Before (line 1730):
      if (state.tickCount % 5 === 0) {
// After:
      if (state.tickCount % 15 === 0) {
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/cave.js
git commit -m "reduz frequencia de debug tick summary de 5 para 15 ticks para diminuir ruido"
```

---

### Task 6: Prioritize learned transitions over live probe in floor changes

**Files:**
- Modify: `src/modules/cave.js:1626-1669`

- [ ] **Step 1: Check learned transitions first in handleFloorChange**

```js
  function handleFloorChange(waypoint, now = Date.now()) {
    const position = normalizePosition(bot.getPlayerPosition());
    if (!position || !waypoint || position.z === waypoint.z) {
      return false;
    }

    // Check learned transitions FIRST (before live probe)
    const knownTransition = findBestKnownTransition(position, waypoint);
    if (knownTransition && knownTransition.count >= 2) {
      const target = {
        tile: getTileAt(knownTransition.from),
        position: knownTransition.from,
      };
      const moved = useFloorChangeTile(target, waypoint, now);
      if (moved) {
        bot.log("cave using learned floor transition", {
          from: knownTransition.from,
          to: knownTransition.to,
          waypoint,
        });
        return true;
      }

      bot.log("cave learned transition unavailable, falling back to live scan", {
        from: knownTransition.from,
        to: knownTransition.to,
        waypoint,
      });
    }

    const visibleCandidate = findNearbyTransitionTile(position, waypoint);
    if (visibleCandidate) {
      const moved = useFloorChangeTile(visibleCandidate, waypoint, now);
      if (moved) {
        bot.log("cave probing visible floor-change tile", {
          tileX: visibleCandidate.position.x,
          tileY: visibleCandidate.position.y,
          tileZ: visibleCandidate.position.z,
          targetZ: waypoint.z,
        });
        return true;
      }
    }

    // Fallback for transitions learned only once (less reliable)
    if (knownTransition) {
      const target = {
        tile: getTileAt(knownTransition.from),
        position: knownTransition.from,
      };
      const moved = useFloorChangeTile(target, waypoint, now);
      if (moved) {
        bot.log("cave using learned floor transition (single use)", {
          from: knownTransition.from,
          to: knownTransition.to,
          waypoint,
        });
        return true;
      }
    }

    return false;
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/cave.js
git commit -m "otimiza floor change: prioriza transicoes aprendidas (count>=2) sobre live probe"
```

---

### Task 7: Skip A* pathfinding for very short distances (<=3 tiles)

**Files:**
- Modify: `src/modules/cave.js:1281-1316`

- [ ] **Step 1: Add early return for short paths in A* mode**

In `goToWaypoint`, inside the A* block:

```js
      if (path && path.length > 0) {
        // For very short paths (<=3 tiles), use game pathfinder directly
        if (path.length <= 3) {
          const to = new Position(waypoint.x, waypoint.y, waypoint.z);
          try {
            window.gameClient?.world?.pathfinder?.findPath?.(from, to);
            state.lastPathAt = now;
            bot.log("cave A* short path, using game pathfinder", {
              ...waypoint,
              index: state.currentIndex + 1,
              total: route.length,
              pathLength: path.length,
            });
            return true;
          } catch (error) {
            bot.log("cave A* short path fallback failed", {
              ...waypoint, error: error?.message || error,
            });
          }
        }

        const playerPos = fromPos;
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/cave.js
git commit -m "otimiza A*: usa game pathfinder direto para paths <=3 tiles para evitar custo do A*"
```

---

### Task 8: Cache path state across combat pauses

**Files:**
- Modify: `src/modules/cave.js`

- [ ] **Step 1: Add path cache state**

Add to state object (around line 34):
```js
    savedPathState: null,    // cached waypoint/direction before combat pause
```

- [ ] **Step 2: Save path state before combat pause**

In the combat pause block (around line 1751-1756):
```js
      if (shouldPauseForCombat) {
        if (!state.pausedForCombat) {
          state.pausedForCombat = true;
          // Cache current path state for efficient resume
          state.savedPathState = {
            waypoint: getCurrentWaypoint(),
            index: state.currentIndex,
            direction: state.direction,
          };
          resetStuckCounts();
          bot.log("cave paused for auto attack", {
            combatDurationMs: Number(attackStatus?.combatDurationMs || 0),
            targetCount: Number(attackStatus?.targetCount || 0),
          });
        }
```

- [ ] **Step 3: Trigger immediate repath on resume**

In the resume block (around line 1779-1786):
```js
      if (state.pausedForCombat) {
        state.pausedForCombat = false;
        resetStuckCounts();
        // Force immediate repath on resume (don't wait for repathMs)
        state.lastPathAt = 0;
        bot.log("cave resumed after auto attack", {
          combatDurationMs: Number(attackStatus?.combatDurationMs || 0),
          targetCount: Number(attackStatus?.targetCount || 0),
          savedWaypoint: state.savedPathState?.waypoint || null,
        });
        state.savedPathState = null;
      }
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/cave.js
git commit -m "cacheia estado do path durante pausa de combate e força repath imediato ao resume"
```

---

### Task 9: Stabilize direction after floor transitions

**Files:**
- Modify: `src/modules/cave.js`

- [ ] **Step 1: Re-evaluate direction after floor change in tick()**

In the tick function, after `handleFloorChange` returns (around line 1824), add direction validation:

```js
        handleFloorChange(waypoint, now);
        // Re-evaluate direction after floor change to prevent reversal loops
        const newPosition = normalizePosition(bot.getPlayerPosition());
        if (newPosition && newPosition.z !== position.z) {
          const bestIndex = findClosestWaypointIndex(newPosition);
          const wouldReverse = bestIndex < state.currentIndex && state.direction === 1 ||
                               bestIndex > state.currentIndex && state.direction === -1;
          if (wouldReverse && !isAtWaypoint(newPosition, waypoint)) {
            const nextWp = route[bestIndex];
            if (nextWp && nextWp.z === newPosition.z) {
              state.currentIndex = bestIndex;
              state.direction = bestIndex >= route.length - 1 ? -1 : 1;
              if (route.length <= 1) state.direction = 1;
              bot.log("cave adjusted direction after floor change", {
                newIndex: state.currentIndex + 1,
                newDirection: state.direction,
                total: route.length,
              });
            }
          }
        }
        return;
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/cave.js
git commit -m "estabiliza direcao apos floor change: reavalia closest waypoint no novo andar"
```

---

## Build and Final Steps

- [ ] **Build bundle after all changes**

```bash
./build.sh
```

- [ ] **Verify bundle was generated**

```bash
git diff --stat HEAD  # Should show pz-bot.js updated
```
