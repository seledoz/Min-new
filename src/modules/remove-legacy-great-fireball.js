window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(function removeLegacyGreatFireball() {
  const legacyStandaloneStorageKey = "minibiaBot.attackGfb.config";
  const aoeStorageKey = "minibiaBot.attackAoe.config";

  function disableLegacyConfig() {
    try {
      window.localStorage.removeItem(legacyStandaloneStorageKey);

      const rawValue = window.localStorage.getItem(aoeStorageKey);
      const config = rawValue ? JSON.parse(rawValue) : {};
      config.gfbEnabled = false;
      config.gfbHotbarSlot = null;
      window.localStorage.setItem(aoeStorageKey, JSON.stringify(config));

      window.minibiaBot?.attackAoe?.updateConfig?.({
        gfbEnabled: false,
        gfbHotbarSlot: null,
      }, { silent: true });

      window.minibiaBot?.attackGfb?.stop?.({ persistEnabled: false });
      window.minibiaBot?.attackGfb?.destroy?.();
      if (window.minibiaBot) delete window.minibiaBot.attackGfb;
    } catch (error) {
      console.error("[minibia-bot] failed to disable legacy Great Fireball", error);
    }
  }

  function removeLegacyUi() {
    const legacyToggle = document.getElementById("minibia-bot-gfb-enabled");
    legacyToggle?.closest?.(".mb-section")?.remove();
    document.getElementById("minibia-bot-gfb-section")?.remove();
  }

  disableLegacyConfig();
  removeLegacyUi();

  let attempts = 0;
  const timerId = window.setInterval(() => {
    attempts += 1;
    disableLegacyConfig();
    removeLegacyUi();
    if (attempts >= 20) window.clearInterval(timerId);
  }, 250);
})();
