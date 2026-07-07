window.__minibiaBotBundle = window.__minibiaBotBundle || {};

// Layout helper disabled: previous panel-moving code caused browser freezes on some clients.
// Keep this file lightweight because pz-bot.js still loads it.
(function forceNormalAutoAttackRangeSix() {
  const storageKey = "minibiaBot.attack.config";

  function applySix() {
    try {
      const rawValue = window.localStorage.getItem(storageKey);
      const config = rawValue ? JSON.parse(rawValue) : {};
      if (config.maxTargetDistance !== 6) {
        config.maxTargetDistance = 6;
        window.localStorage.setItem(storageKey, JSON.stringify(config));
      }
      const attackConfig = window.minibiaBot?.attack?.config;
      if (attackConfig && attackConfig.maxTargetDistance !== 6) {
        attackConfig.maxTargetDistance = 6;
      }
    } catch (error) {}
  }

  applySix();
  window.setTimeout(applySix, 500);
})();
