(() => {
  const installer = window.__minibiaBotBundle?.installAutoAttackKeepDistanceModule;
  const bot = window.minibiaBot;
  if (typeof installer !== "function" || !bot || bot.attackKeepDistance) return;

  installer(bot);

  const originalStatus = bot.status;
  if (typeof originalStatus === "function") {
    bot.status = () => ({
      ...originalStatus(),
      attackKeepDistance: bot.attackKeepDistance?.status?.() || null,
    });
  }

  console.log("[minibia-bot] auto attack keep-distance ready");
})();