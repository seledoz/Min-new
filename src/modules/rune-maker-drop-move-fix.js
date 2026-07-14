(() => {
  function installRuneDropMoveAdapter() {
    const mouse = window.gameClient?.mouse;
    if (!mouse || typeof mouse.sendItemMove !== "function") return false;

    // The rune drop module prioritizes __handleItemMove. Point that name at
    // Minibia's real drag/drop API so the first attempted move uses the same
    // code path as manually dragging an item from a backpack onto a tile.
    mouse.__handleItemMove = function runeDropItemMove(fromObject, toObject, count) {
      if (!fromObject?.which || !toObject?.which) return false;
      const amount = Math.max(1, Math.trunc(Number(count) || 1));
      return mouse.sendItemMove(fromObject, toObject, amount);
    };

    console.log("[minibia-bot] rune drop item-move adapter installed");
    return true;
  }

  installRuneDropMoveAdapter();

  let attempts = 0;
  const timerId = window.setInterval(() => {
    attempts += 1;
    if (installRuneDropMoveAdapter() || attempts >= 40) {
      window.clearInterval(timerId);
    }
  }, 250);
})();
