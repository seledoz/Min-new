window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(() => {
  const bundle = window.__minibiaBotBundle;
  const originalInstallAutoAttackModule = bundle.installAutoAttackModule;

  if (typeof originalInstallAutoAttackModule !== "function") {
    return;
  }

  const RUNE_COOLDOWN_MS = 2040;

  function normalizeRuneCooldown(config) {
    if (!config) return;

    if (!Number.isFinite(Number(config.runeCooldownMs)) || Number(config.runeCooldownMs) < RUNE_COOLDOWN_MS) {
      config.runeCooldownMs = RUNE_COOLDOWN_MS;
    }
  }

  bundle.installAutoAttackModule = function installAutoAttackModuleWithRuneCooldown(bot) {
    const result = originalInstallAutoAttackModule(bot);
    const attack = bot?.attack;

    normalizeRuneCooldown(attack?.config);

    if (attack?.start && !attack.__runeCooldown2040StartWrapped) {
      const originalStart = attack.start;
      attack.start = function startWithRuneCooldown(overrides = {}) {
        if (!Number.isFinite(Number(overrides.runeCooldownMs)) || Number(overrides.runeCooldownMs) < RUNE_COOLDOWN_MS) {
          overrides = { ...overrides, runeCooldownMs: RUNE_COOLDOWN_MS };
        }

        const startResult = originalStart.call(this, overrides);
        normalizeRuneCooldown(attack.config);
        return startResult;
      };
      attack.__runeCooldown2040StartWrapped = true;
    }

    if (attack?.updateConfig && !attack.__runeCooldown2040UpdateWrapped) {
      const originalUpdateConfig = attack.updateConfig;
      attack.updateConfig = function updateConfigWithRuneCooldown(nextConfig = {}) {
        if (Object.prototype.hasOwnProperty.call(nextConfig, "runeCooldownMs")) {
          nextConfig = {
            ...nextConfig,
            runeCooldownMs: Math.max(RUNE_COOLDOWN_MS, Number(nextConfig.runeCooldownMs) || RUNE_COOLDOWN_MS),
          };
        }

        const updatedConfig = originalUpdateConfig.call(this, nextConfig);
        normalizeRuneCooldown(attack.config);
        return updatedConfig;
      };
      attack.__runeCooldown2040UpdateWrapped = true;
    }

    return result;
  };
})();