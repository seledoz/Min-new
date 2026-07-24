window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(() => {
  const bundle = window.__minibiaBotBundle;
  const originalInstallAutoAttackModule = bundle.installAutoAttackModule;
  const DEFAULT_RUNE_COOLDOWN_MS = 2050;

  if (typeof originalInstallAutoAttackModule !== "function") {
    return;
  }

  function normalizeCooldown(value, fallback = DEFAULT_RUNE_COOLDOWN_MS) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : fallback;
  }

  function normalizeRuneCooldown(config) {
    if (!config) return;
    config.runeCooldownMs = normalizeCooldown(config.runeCooldownMs);
  }

  function ensureRuneCooldownInput(bot) {
    const panel = document.getElementById("minibia-bot-panel");
    const runeHotkeyInput = document.getElementById("minibia-bot-auto-attack-rune-hotkey");
    if (!panel || !runeHotkeyInput || document.getElementById("minibia-bot-auto-attack-rune-cooldown")) {
      return false;
    }

    const hotkeyField = runeHotkeyInput.closest("label.mb-field") || runeHotkeyInput.parentElement;
    if (!hotkeyField) return false;

    const cooldownField = document.createElement("label");
    cooldownField.className = "mb-field";
    cooldownField.setAttribute("for", "minibia-bot-auto-attack-rune-cooldown");
    cooldownField.innerHTML = `
      <span class="mb-field-label">Rune Cooldown (ms)</span>
      <input type="number" id="minibia-bot-auto-attack-rune-cooldown" min="0" step="50" placeholder="${DEFAULT_RUNE_COOLDOWN_MS}" />
    `;
    hotkeyField.insertAdjacentElement("afterend", cooldownField);

    const cooldownInput = cooldownField.querySelector("input");
    const refreshValue = () => {
      const current = normalizeCooldown(bot.attack?.config?.runeCooldownMs);
      cooldownInput.value = String(current);
    };

    refreshValue();
    cooldownInput.addEventListener("change", () => {
      const runeCooldownMs = normalizeCooldown(cooldownInput.value);
      cooldownInput.value = String(runeCooldownMs);
      bot.attack?.updateConfig?.({ runeCooldownMs });
    });

    return true;
  }

  function watchForPanel(bot) {
    if (ensureRuneCooldownInput(bot)) return;

    const observer = new MutationObserver(() => {
      if (ensureRuneCooldownInput(bot)) {
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    bot.addCleanup?.(() => observer.disconnect());
  }

  bundle.installAutoAttackModule = function installAutoAttackModuleWithRuneCooldown(bot) {
    const result = originalInstallAutoAttackModule(bot);
    const attack = bot?.attack;

    normalizeRuneCooldown(attack?.config);

    if (attack?.start && !attack.__customRuneCooldownStartWrapped) {
      const originalStart = attack.start;
      attack.start = function startWithRuneCooldown(overrides = {}) {
        if (Object.prototype.hasOwnProperty.call(overrides, "runeCooldownMs")) {
          overrides = { ...overrides, runeCooldownMs: normalizeCooldown(overrides.runeCooldownMs) };
        }

        const startResult = originalStart.call(this, overrides);
        normalizeRuneCooldown(attack.config);
        return startResult;
      };
      attack.__customRuneCooldownStartWrapped = true;
    }

    if (attack?.updateConfig && !attack.__customRuneCooldownUpdateWrapped) {
      const originalUpdateConfig = attack.updateConfig;
      attack.updateConfig = function updateConfigWithRuneCooldown(nextConfig = {}) {
        if (Object.prototype.hasOwnProperty.call(nextConfig, "runeCooldownMs")) {
          nextConfig = {
            ...nextConfig,
            runeCooldownMs: normalizeCooldown(nextConfig.runeCooldownMs),
          };
        }

        const updatedConfig = originalUpdateConfig.call(this, nextConfig);
        normalizeRuneCooldown(attack.config);
        return updatedConfig;
      };
      attack.__customRuneCooldownUpdateWrapped = true;
    }

    watchForPanel(bot);
    return result;
  };
})();
