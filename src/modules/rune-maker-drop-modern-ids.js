(() => {
  const MODERN_BLANK_RUNE_ID = 3147;
  const MODERN_RUNE_ID_MIN = 3148;
  const MODERN_RUNE_ID_MAX = 3200;

  function getItem(container, slot) {
    try {
      return container?.peekItem?.(slot) ||
        container?.getSlotItem?.(slot) ||
        container?.slots?.[slot]?.item ||
        null;
    } catch (_) {
      return null;
    }
  }

  function getContainers() {
    const player = window.gameClient?.player;
    const containers = [];
    const seen = new Set();
    const add = (container) => {
      if (!container || seen.has(container)) return;
      seen.add(container);
      containers.push(container);
    };

    if (typeof player?.getContainer === "function") {
      for (let index = 0; index < 256; index += 1) {
        try { add(player.getContainer(index)); } catch (_) {}
      }
    }

    const opened = player?.__openedContainers || player?.openedContainers;
    if (opened) {
      const values = Array.isArray(opened)
        ? opened
        : typeof opened.values === "function"
          ? Array.from(opened.values())
          : Object.values(opened);
      values.forEach(add);
    }

    return containers;
  }

  function markModernRunes() {
    for (const container of getContainers()) {
      const slotCount = Number(container?.slots?.length ?? container?.size ?? 0);
      for (let slot = 0; slot < slotCount; slot += 1) {
        const item = getItem(container, slot);
        const id = Number(item?.id);
        if (!item || !Number.isFinite(id)) continue;

        if (id === MODERN_BLANK_RUNE_ID) {
          item.name = "blank rune";
        } else if (id >= MODERN_RUNE_ID_MIN && id <= MODERN_RUNE_ID_MAX) {
          item.name = item.name || "rune";
        }
      }
    }
  }

  markModernRunes();
  const timer = window.setInterval(markModernRunes, 500);
  window.minibiaBot?.addCleanup?.(() => window.clearInterval(timer));

  console.log("[minibia-bot] modern rune id compatibility enabled", {
    blankRune: MODERN_BLANK_RUNE_ID,
    runeRange: [MODERN_RUNE_ID_MIN, MODERN_RUNE_ID_MAX],
  });
})();
