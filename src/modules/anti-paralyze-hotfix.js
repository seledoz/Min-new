window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(() => {
  const STORAGE_KEY = "minibiaBot.antiParalyze.config";
  const INSTALL_RETRY_MS = 250;
  const MAX_INSTALL_ATTEMPTS = 80;

  function install(bot) {
    if (!bot || bot.__antiParalyzeHotfixInstalled) return !!bot;

    bot.antiParalyze?.stop?.({ persistEnabled: false });

    const previousConfig = bot.storage.get(STORAGE_KEY, {}) || {};
    const config = Object.assign(
      {
        tickMs: 50,
        spellWords: "",
        recastCooldownMs: 2040,
        enabled: false,
      },
      previousConfig
    );

    const state = {
      running: false,
      timerId: null,
      lastCastAt: 0,
      detectionSource: null,
    };

    function persistConfig() {
      bot.storage.set(STORAGE_KEY, { ...config });
    }

    function addNamedConditionIds(source, ids) {
      if (!source) return;

      let keys = [];
      try {
        keys = Object.getOwnPropertyNames(source);
      } catch (_error) {
        return;
      }

      keys.forEach((key) => {
        if (!/(paraly|paralys|slow)/i.test(key)) return;

        let value;
        try {
          value = source[key];
        } catch (_error) {
          return;
        }

        const numericValue = Number(value);
        if (Number.isFinite(numericValue)) ids.add(numericValue);
      });
    }

    function getParalyzeConditionIds(player, conditions) {
      const ids = new Set();
      const sources = [
        window.ConditionManager,
        window.ConditionManager?.prototype,
        conditions?.constructor,
        conditions?.constructor?.prototype,
        player?.constructor,
        player?.constructor?.prototype,
      ];

      sources.forEach((source) => addNamedConditionIds(source, ids));
      return ids;
    }

    function valueLooksParalyzed(value, depth = 0) {
      if (value == null || depth > 1) return false;
      if (typeof value === "string") return /(paraly|paralys)/i.test(value);
      if (typeof value !== "object") return false;

      const fields = [
        value.name,
        value.type,
        value.condition,
        value.conditionName,
        value.status,
        value.label,
        value.title,
        value.constructor?.name,
      ];

      if (fields.some((entry) => typeof entry === "string" && /(paraly|paralys)/i.test(entry))) {
        return true;
      }

      if (depth === 0) {
        for (const key of Object.keys(value).slice(0, 30)) {
          if (/(paraly|paralys)/i.test(key)) return true;
          try {
            if (valueLooksParalyzed(value[key], depth + 1)) return true;
          } catch (_error) {
            // Ignore unreadable runtime fields.
          }
        }
      }

      return false;
    }

    function conditionCollectionHasParalyze(player, conditions) {
      const conditionIds = getParalyzeConditionIds(player, conditions);

      for (const conditionId of conditionIds) {
        try {
          if (conditions?.has?.(conditionId) || player?.hasCondition?.(conditionId)) {
            state.detectionSource = `condition:${conditionId}`;
            return true;
          }
        } catch (_error) {
          // Continue through the other detection methods.
        }
      }

      if (conditions instanceof Map) {
        for (const [key, value] of conditions.entries()) {
          if (valueLooksParalyzed(key) || valueLooksParalyzed(value)) {
            state.detectionSource = "condition-map";
            return true;
          }
        }
      } else if (conditions && typeof conditions[Symbol.iterator] === "function") {
        try {
          for (const value of conditions) {
            if (valueLooksParalyzed(value)) {
              state.detectionSource = "condition-list";
              return true;
            }
          }
        } catch (_error) {
          // Some game collections expose an iterator that can throw while updating.
        }
      } else if (conditions && typeof conditions === "object") {
        for (const [key, value] of Object.entries(conditions)) {
          if (/(paraly|paralys)/i.test(key) || valueLooksParalyzed(value)) {
            state.detectionSource = "condition-object";
            return true;
          }
        }
      }

      return false;
    }

    function readFiniteNumber(object, keys) {
      for (const key of keys) {
        let value;
        try {
          value = Number(object?.[key]);
        } catch (_error) {
          continue;
        }
        if (Number.isFinite(value) && value > 0) return value;
      }
      return null;
    }

    function speedLooksParalyzed(player) {
      const currentSpeed = readFiniteNumber(player, [
        "speed",
        "currentSpeed",
        "movementSpeed",
        "walkSpeed",
      ]);
      const normalSpeed = readFiniteNumber(player, [
        "baseSpeed",
        "normalSpeed",
        "defaultSpeed",
        "originalSpeed",
      ]);

      if (currentSpeed == null || normalSpeed == null) return false;
      if (currentSpeed >= normalSpeed) return false;

      const reduction = normalSpeed - currentSpeed;
      const reductionRatio = reduction / normalSpeed;
      if (reduction >= 10 || reductionRatio >= 0.08) {
        state.detectionSource = `speed:${currentSpeed}/${normalSpeed}`;
        return true;
      }

      return false;
    }

    function statusIconLooksParalyzed() {
      const selectors = [
        '[title*="paraly" i]',
        '[aria-label*="paraly" i]',
        '[data-condition*="paraly" i]',
        '[class*="paraly" i]',
        '[title*="paralis" i]',
        '[aria-label*="paralis" i]',
      ];

      if (document.querySelector(selectors.join(","))) {
        state.detectionSource = "status-icon";
        return true;
      }

      return false;
    }

    function isParalyzedActive() {
      state.detectionSource = null;
      const player = window.gameClient?.player;
      if (!player) return false;

      return (
        conditionCollectionHasParalyze(player, player.conditions) ||
        speedLooksParalyzed(player) ||
        statusIconLooksParalyzed()
      );
    }

    function shouldPrioritizeHeal() {
      const healStatus = bot.heal?.status?.();
      const stats = bot.heal?.readStats?.();
      const hp = Number(stats?.hp?.current);
      const minHp = Math.max(0, Number(bot.heal?.config?.minHp) || 0);

      return !!healStatus?.running && Number.isFinite(hp) && hp > 0 && hp <= minHp;
    }

    function tryAntiParalyze(now = Date.now()) {
      if (!config.enabled || !state.running) return false;
      const spellWords = String(config.spellWords || "").trim();
      if (!spellWords || !isParalyzedActive()) return false;

      if (shouldPrioritizeHeal()) {
        bot.heal?.tryHeal?.();
        return false;
      }

      const cooldown = Math.max(0, Number(config.recastCooldownMs) || 0);
      if (now - state.lastCastAt < cooldown) return false;

      const sent = bot.sendChat(spellWords);
      if (sent) {
        state.lastCastAt = now;
        bot.log("cast anti-paralyze spell", {
          spellWords,
          detectionSource: state.detectionSource,
        });
      }
      return sent;
    }

    function scheduleNextTick() {
      if (!state.running) return;
      state.timerId = window.setTimeout(tick, Math.max(25, Number(config.tickMs) || 50));
    }

    function tick() {
      if (!state.running) return;
      try {
        tryAntiParalyze();
      } catch (error) {
        bot.log("anti-paralyze hotfix tick failed", error?.message || error);
      } finally {
        scheduleNextTick();
      }
    }

    function start(overrides = {}) {
      Object.assign(config, overrides, { enabled: true });
      config.spellWords = String(config.spellWords || "").trim();
      persistConfig();
      if (state.running) return false;
      state.running = true;
      tick();
      bot.log("anti-paralyze hotfix started", { ...config });
      return true;
    }

    function stop(options = {}) {
      state.running = false;
      if (state.timerId != null) {
        window.clearTimeout(state.timerId);
        state.timerId = null;
      }
      if (options.persistEnabled !== false) {
        config.enabled = false;
        persistConfig();
      }
      return true;
    }

    function updateConfig(nextConfig = {}) {
      if (Object.prototype.hasOwnProperty.call(nextConfig, "spellWords")) {
        nextConfig.spellWords = String(nextConfig.spellWords || "").trim();
      }
      Object.assign(config, nextConfig);
      persistConfig();
      return { ...config };
    }

    function status() {
      const paralyzed = isParalyzedActive();
      return {
        running: state.running,
        config: { ...config },
        paralyzed,
        detectionSource: state.detectionSource,
        healPriorityActive: shouldPrioritizeHeal(),
        lastCastAt: state.lastCastAt,
      };
    }

    bot.antiParalyze = {
      start,
      stop,
      status,
      updateConfig,
      isParalyzedActive,
      shouldPrioritizeHeal,
      tryAntiParalyze,
      config,
    };
    bot.__antiParalyzeHotfixInstalled = true;

    if (config.enabled) start();
    bot.log("anti-paralyze detection hotfix installed");
    return true;
  }

  let attempts = 0;
  const timerId = window.setInterval(() => {
    attempts += 1;
    const bot = window.minibiaBot;
    if (install(bot) || attempts >= MAX_INSTALL_ATTEMPTS) {
      window.clearInterval(timerId);
    }
  }, INSTALL_RETRY_MS);
})();
