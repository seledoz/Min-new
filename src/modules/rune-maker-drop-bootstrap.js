(() => {
  const bundle = window.__minibiaBotBundle || window.__minibiaBotReloadBundle;
  const install = bundle?.installRuneMakerDropModule;
  if (typeof install !== "function") return;

  function installOnBot(bot) {
    if (!bot) return bot;

    // The panel is rebuilt during reloads, but the existing runeMakerDrop
    // object can survive long enough for this bootstrap to skip installation.
    // Stop that stale instance and reinstall it so its UI injection loop runs
    // again and restores the Rune Maker Drop section.
    if (bot.runeMakerDrop) {
      try {
        bot.runeMakerDrop.stop?.({ persistEnabled: false });
      } catch (_) {
        // Continue with a fresh installation even if the stale instance fails.
      }
      try {
        delete bot.runeMakerDrop;
      } catch (_) {
        bot.runeMakerDrop = null;
      }
    }

    install(bot);
    bot.addCleanup?.(() => bot.runeMakerDrop?.stop?.({ persistEnabled: false }));
    return bot;
  }

  installOnBot(window.minibiaBot);

  const originalReload = window.minibiaBotReload;
  if (typeof originalReload === "function" && !originalReload.__runeMakerDropWrapped) {
    const wrappedReload = (...args) => installOnBot(originalReload(...args));
    wrappedReload.__runeMakerDropWrapped = true;
    window.minibiaBotReload = wrappedReload;
    if (window.minibiaBot) window.minibiaBot.reload = wrappedReload;
  }
})();