(() => {
  const clickDelayMs = 100;
  let installedBot = null;
  let originalClickHotbar = null;
  let pendingClickId = null;

  function getGameCanvas() {
    return Array.from(document.querySelectorAll("canvas"))
      .map((canvas) => ({ canvas, rect: canvas.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width >= 200 && rect.height >= 150)
      .sort((left, right) => (right.rect.width * right.rect.height) - (left.rect.width * left.rect.height))[0] || null;
  }

  function getPosition(value) {
    const raw = value?.getPosition?.() || value?.__position || value?.position || value;
    if (!raw) return null;
    const x = Number(raw.x);
    const y = Number(raw.y);
    const z = Number(raw.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) };
  }

  function dispatchScreenClick(canvas, clientX, clientY) {
    const common = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX,
      clientY,
      screenX: clientX,
      screenY: clientY,
      button: 0,
      buttons: 1,
      detail: 1,
      view: window,
    };

    try {
      if (typeof PointerEvent === "function") {
        canvas.dispatchEvent(new PointerEvent("pointermove", { ...common, pointerId: 1, pointerType: "mouse", isPrimary: true }));
        canvas.dispatchEvent(new PointerEvent("pointerdown", { ...common, pointerId: 1, pointerType: "mouse", isPrimary: true }));
        canvas.dispatchEvent(new PointerEvent("pointerup", { ...common, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true }));
      }
      canvas.dispatchEvent(new MouseEvent("mousemove", common));
      canvas.dispatchEvent(new MouseEvent("mousedown", common));
      canvas.dispatchEvent(new MouseEvent("mouseup", { ...common, buttons: 0 }));
      canvas.dispatchEvent(new MouseEvent("click", { ...common, buttons: 0 }));
      return true;
    } catch (error) {
      return false;
    }
  }

  function clickBestGfbTile(bot) {
    const module = bot?.greatFireballV2;
    const best = module?.getBestCandidate?.();
    const player = getPosition(bot?.getPlayerPosition?.());
    const target = getPosition(best?.position);
    const canvasInfo = getGameCanvas();
    if (!module || !module.status?.().running || !player || !target || !canvasInfo) return false;
    if (target.z !== player.z || (best?.count || 0) < Number(module.config?.minMonsters || 1)) return false;

    const { canvas, rect } = canvasInfo;
    const tileWidth = rect.width / 17;
    const tileHeight = rect.height / 13;
    const clientX = rect.left + ((target.x - player.x + 8.5) * tileWidth);
    const clientY = rect.top + ((target.y - player.y + 6.5) * tileHeight);

    const inside = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    if (!inside) {
      bot.log?.("great fireball 2.0 target tile is outside game screen", { player, target, clientX, clientY });
      return false;
    }

    const clicked = dispatchScreenClick(canvas, clientX, clientY);
    bot.log?.(clicked ? "great fireball 2.0 clicked target tile on screen" : "great fireball 2.0 screen click failed", {
      monsterCount: best.count,
      target,
      clientX: Math.round(clientX),
      clientY: Math.round(clientY),
      delayMs: clickDelayMs,
    });
    return clicked;
  }

  function install() {
    const bot = window.minibiaBot;
    if (!bot?.clickHotbar || !bot?.greatFireballV2 || bot === installedBot) return false;

    if (installedBot && originalClickHotbar && installedBot.clickHotbar !== originalClickHotbar) {
      installedBot.clickHotbar = originalClickHotbar;
    }

    installedBot = bot;
    originalClickHotbar = bot.clickHotbar.bind(bot);
    bot.clickHotbar = (...args) => {
      const result = originalClickHotbar(...args);
      const slotIndex = Number(args[0]);
      const gfbSlotIndex = Number(bot.greatFireballV2?.config?.hotbarSlot) - 1;
      const gfbRunning = !!bot.greatFireballV2?.status?.().running;

      if (result && gfbRunning && Number.isFinite(slotIndex) && slotIndex === gfbSlotIndex) {
        if (pendingClickId != null) window.clearTimeout(pendingClickId);
        pendingClickId = window.setTimeout(() => {
          pendingClickId = null;
          clickBestGfbTile(bot);
        }, clickDelayMs);
      }
      return result;
    };

    bot.addCleanup?.(() => {
      if (pendingClickId != null) window.clearTimeout(pendingClickId);
      pendingClickId = null;
      if (bot.clickHotbar !== originalClickHotbar) bot.clickHotbar = originalClickHotbar;
      if (installedBot === bot) installedBot = null;
    });
    return true;
  }

  install();
  const installerId = window.setInterval(() => {
    if (install()) window.clearInterval(installerId);
  }, 100);
})();