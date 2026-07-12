(() => {
  const bundle = window.__minibiaBotBundle || window.__minibiaBotReloadBundle;
  const install = bundle?.installRuneMakerDropModule;
  if (typeof install !== "function") return;

  function installOnBot(bot) {
    if (!bot || bot.runeMakerDrop) return bot;
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
