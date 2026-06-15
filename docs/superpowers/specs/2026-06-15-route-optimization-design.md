# Route Optimization Design

**Goal:** Add an on-demand route optimization feature that simplifies waypoint paths by removing redundant intermediate points.

**Trigger:** Button "Optimize" in the cave panel UI, next to "Remove Last".

**Algorithm (2 passes):**

1. **Deduplication** — remove consecutive waypoints on the same tile (same x,y,z).
2. **Collinear simplification** — for each trio (A,B,C) on the same floor (same z), if B lies on the straight line between A and C (triangle area = 0), remove B. Waypoints at different Z values (floor transitions) are preserved.

**Output:** `{ before: number, after: number }` logged and displayed in UI.

**Version bump:** 2.0.0 → 2.1.0

**Files:**
- Modify: `src/modules/cave.js` — add `optimizeRoute()`
- Modify: `src/ui/panel.js` — add "Optimize" button + status feedback
- Modify: `src/version.js` — bump number to 2.1.0
- Modify: `README.md` — bump version on line 3
