(() => {
  const installer = window.__minibiaBotBundle?.installAutoAttackKeepDistanceModule;
  const bot = window.minibiaBot;
  if (typeof installer !== "function" || !bot || bot.attackKeepDistance) return;

  installer(bot);

  function clearFollowTarget() {
    const enabled = !!bot.attackKeepDistance?.status?.().config?.enabled;
    const player = window.gameClient?.player;
    if (!enabled || !player?.__followTarget) return false;

    try {
      player.setFollowTarget?.(null);
      if (typeof window.gameClient?.send === "function" && typeof FollowPacket === "function") {
        window.gameClient.send(new FollowPacket(0));
      }
      return true;
    } catch (error) {
      bot.log?.("keep distance follow guard failed", error?.message || error);
      return false;
    }
  }

  // The game can apply follow immediately after selecting an attack target. Run
  // this faster than the normal keep-distance pathing tick so the character does
  // not begin walking toward the monster before the retreat logic takes control.
  const followGuardTimerId = window.setInterval(clearFollowTarget, 25);
  bot.addCleanup?.(() => window.clearInterval(followGuardTimerId));

  const originalStatus = bot.status;
  if (typeof originalStatus === "function") {
    bot.status = () => ({
      ...originalStatus(),
      attackKeepDistance: bot.attackKeepDistance?.status?.() || null,
    });
  }

  console.log("[minibia-bot] auto attack keep-distance ready");
})();