# Route Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Add on-demand route optimization button that removes redundant waypoints.

**Architecture:** New `optimizeRoute()` in cave.js (2-pass algorithm) + "Optimize" button in panel.js + version bump.

**Tech Stack:** JavaScript (browser bundle)

---

### Task 1: Write plan and read UI panel code

**Files:**
- Read: `src/ui/panel.js` — find button area and refresh functions

- [ ] **Read panel.js** to identify where buttons are rendered and what refresh functions exist

### Task 2: Add optimizeRoute() to cave.js

**Files:**
- Modify: `src/modules/cave.js` (add function + expose on `bot.cave`)

```js
function optimizeRoute() {
  const before = route.length;
  if (before < 2) {
    bot.log("cave route too short to optimize", { length: before });
    return { before, after: before };
  }

  // Pass 1: deduplicate consecutive same-tile waypoints
  const deduped = [route[0]];
  for (let i = 1; i < route.length; i++) {
    const prev = deduped[deduped.length - 1];
    const curr = route[i];
    if (prev.x !== curr.x || prev.y !== curr.y || prev.z !== curr.z) {
      deduped.push(curr);
    }
  }

  // Pass 2: collinear simplification (same floor only)
  if (deduped.length >= 3) {
    const simplified = [deduped[0]];
    for (let i = 1; i < deduped.length - 1; i++) {
      const prev = simplified[simplified.length - 1];
      const curr = deduped[i];
      const next = deduped[i + 1];

      // Preserve floor transition waypoints
      if (curr.z !== prev.z || next.z !== curr.z) {
        simplified.push(curr);
        continue;
      }

      // Collinearity check: area of triangle ABC
      const area = Math.abs(
        prev.x * (curr.y - next.y) +
        curr.x * (next.y - prev.y) +
        next.x * (prev.y - curr.y)
      );

      if (area !== 0) {
        simplified.push(curr);
      }
    }
    simplified.push(deduped[deduped.length - 1]);

    route.length = 0;
    route.push(...simplified);
  } else {
    route.length = 0;
    route.push(...deduped);
  }

  persistRoute();
  const after = route.length;
  bot.log("cave route optimized", { before, after });
  return { before, after };
}
```

Expose on `bot.cave`:
```js
optimizeRoute,
```

### Task 3: Add Optimize button to panel UI

**Files:**
- Modify: `src/ui/panel.js`

Find the existing buttons (Record Spot, Remove Last) and add an Optimize button after Remove Last.

```html
<button type="button" class="mb-small-button" id="minibia-bot-cave-optimize">Optimize</button>
```

Event listener:
```js
if (caveOptimizeButton) {
  caveOptimizeButton.addEventListener("click", () => {
    const result = bot.cave.optimizeRoute();
    refreshCavePresetControls();
    refreshCaveStatus();
    refreshCaveClosestStatus();
    refreshCaveTransitionStatus();
    if (result && result.before !== result.after) {
      alert(`Route optimized: ${result.before} → ${result.after} waypoints`);
    } else {
      alert("Route already optimal (no changes needed)");
    }
  });
}
```

### Task 4: Bump version

**Files:**
- Modify: `src/version.js:14` — change `"2.0.0"` to `"2.1.0"`
- Modify: `README.md:3` — change `2.0.0` to `2.1.0`

### Task 5: Build, commit, push

```bash
./build.sh
git add -A
git commit -m "adiciona optimize route: simplificacao colinear de waypoints + bump 2.1.0"
git push
```
